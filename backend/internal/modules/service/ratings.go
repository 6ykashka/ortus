package service

import (
	"context"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func itoaN(n int) string { return strconv.Itoa(n) }

// ratings loads the ratings of the directions with the status ("" — any), the newest first.
func (r *req) ratings(ctx context.Context, dirs []uuid.UUID, status string) ([]Rating, error) {
	rows, err := r.tx.Query(ctx, `select x.id, x.direction_id, x.request_id, x.client_id, c.name, x.score, x.reasons, x.comment, x.work, x.status, x.at
		from service.ratings x join service.clients c on c.id = x.client_id
		where x.direction_id = any($1) and ($2 = '' or x.status = $2) order by x.at desc, x.id`, dirs, status)
	if err != nil {
		return nil, store("ratings", err)
	}
	defer rows.Close()
	var out []Rating
	for rows.Next() {
		var (
			x   Rating
			req *uuid.UUID
		)
		if err := rows.Scan(&x.ID, &x.DirectionID, &req, &x.ClientID, &x.ClientName, &x.Score, &x.Reasons, &x.Comment, &x.Work, &x.Status, &x.At); err != nil {
			return nil, store("rating", err)
		}
		if req != nil {
			x.RequestID = *req
		}
		out = append(out, x)
	}
	return out, store("ratings", rows.Err())
}

// ListRatings is listServiceRatings: the ratings of the directions the actor reads (open by default).
func (s *Service) ListRatings(ctx context.Context, tc tenantctx.TenantContext, status string, q PageQuery) (api.ServiceRatingList, error) {
	out := api.ServiceRatingList{Items: []api.ServiceRating{}}
	offset, limit, err := q.window()
	if err != nil {
		return out, err
	}
	if status == "" {
		status = ratingOpen
	}
	err = s.run(ctx, tc, func(r *req) error {
		dirs, err := r.visible(ctx, actRead)
		if err != nil {
			return err
		}
		list, err := r.ratings(ctx, idsOf(dirs), status)
		if err != nil {
			return err
		}
		from, to, next := pageOf(offset, limit, len(list))
		out.NextCursor = next
		for _, x := range list[from:to] {
			out.Items = append(out.Items, ratingDTO(x))
		}
		return nil
	})
	return out, err
}

// DecideRating is decideServiceRating: «Просмотрено» (needs «Отвечать») or «Открыть жалобу» (needs «Заводить»): a
// complaint in work on the author, the priority high for a score of 2 or less; the phone is the client's own.
func (s *Service) DecideRating(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b *api.ServiceRatingDecision) (api.ServiceRatingDecisionResult, error) {
	if b == nil {
		return api.ServiceRatingDecisionResult{}, problem.New(problem.CodeMalformedRequest, "")
	}
	return do(ctx, s, tc, func(r *req) (api.ServiceRatingDecisionResult, error) { return r.decideRating(ctx, id, b) })
}

// ratingOf is an open rating of the directions the actor reads, with its direction (404 for any other).
func (r *req) ratingOf(ctx context.Context, id uuid.UUID) (*Rating, *Direction, error) {
	dirs, err := r.visible(ctx, actRead)
	if err != nil {
		return nil, nil, err
	}
	all, err := r.ratings(ctx, idsOf(dirs), "")
	if err != nil {
		return nil, nil, err
	}
	i := slices.IndexFunc(all, func(x Rating) bool { return x.ID == id })
	if i < 0 {
		return nil, nil, notFound("Оценка не найдена")
	}
	if all[i].Status != ratingOpen {
		return nil, nil, conflict("Оценка уже разобрана")
	}
	return &all[i], find(dirs, all[i].DirectionID), nil
}

func (r *req) decideRating(ctx context.Context, id uuid.UUID, b *api.ServiceRatingDecision) (api.ServiceRatingDecisionResult, error) {
	rating, d, err := r.ratingOf(ctx, id)
	if err != nil {
		return api.ServiceRatingDecisionResult{}, err
	}
	created, err := r.applyDecision(ctx, rating, d, b.Action)
	if err != nil {
		return api.ServiceRatingDecisionResult{}, err
	}
	if _, err := r.tx.Exec(ctx, `update service.ratings set status = $2, request_id = $3 where id = $1`, rating.ID, rating.Status, nullID(rating.RequestID)); err != nil {
		return api.ServiceRatingDecisionResult{}, store("rating", err)
	}
	if err := r.record(ctx, "service.rating.decide", targetRating, rating.ID, audit.Normal, map[string]any{"action": string(b.Action)}); err != nil {
		return api.ServiceRatingDecisionResult{}, err
	}
	out := api.ServiceRatingDecisionResult{Rating: ratingDTO(*rating)}
	if created != nil {
		if out.Request, err = r.summaryOf(ctx, created.ID, d); err != nil {
			return out, err
		}
	}
	return out, complete(ctx, r.tx, http.StatusOK, "", out)
}

// applyDecision marks the rating seen or opens a complaint from it (the request made, nil for «seen»).
func (r *req) applyDecision(ctx context.Context, rating *Rating, d *Direction, action api.ServiceRatingDecisionAction) (*Request, error) {
	switch action {
	case api.ServiceRatingDecisionActionSeen:
		if err := r.need(ctx, actReply, d); err != nil {
			return nil, err
		}
		rating.Status = ratingSeen
		return nil, nil //nolint:nilnil // «seen» makes no request
	case api.ServiceRatingDecisionActionComplaint:
		if err := r.need(ctx, actCreate, d); err != nil {
			return nil, err
		}
		created, err := r.complaintOf(ctx, d, rating)
		if err != nil {
			return nil, err
		}
		rating.Status, rating.RequestID = ratingRequest, created.ID
		return created, nil
	}
	return nil, invalid("Неизвестное действие")
}

// summaryOf is the row of the queue of a request.
func (r *req) summaryOf(ctx context.Context, id uuid.UUID, d *Direction) (*api.ServiceRequestSummary, error) {
	full, err := r.requests(ctx, "r.id = $1", id)
	if err != nil || len(full) == 0 {
		return nil, err
	}
	names, err := r.names(ctx, []uuid.UUID{r.tc.PersonID})
	if err != nil {
		return nil, err
	}
	sum := summaryDTO(full[0], d.Calendar, names, viewer{r.tc.PersonID}, r.now)
	return &sum, nil
}

// complaintOf opens a complaint from a low rating (svcRating of the prototype; the phone is the one of the client of
// the survey, not a made-up one — Q-W7.30-3).
func (r *req) complaintOf(ctx context.Context, d *Direction, x *Rating) (*Request, error) {
	ty, err := r.byKind(ctx, d.ID, KindComplaint)
	if err != nil {
		return nil, err
	}
	if ty == nil {
		return nil, invalid("Выберите тип обращения")
	}
	var c Client
	if err := r.tx.QueryRow(ctx, `select id, name, coalesce(company, ''), phone, opted_out, since::timestamptz, created_at from service.clients where id = $1`, x.ClientID).
		Scan(&c.ID, &c.Name, &c.Company, &c.Phone, &c.OptedOut, &c.Since, &c.CreatedAt); err != nil {
		return nil, store("client", err)
	}
	by, err := r.name(ctx, r.tc.PersonID)
	if err != nil {
		return nil, err
	}
	title := TitleOf(x.Comment)
	if title == "" {
		title = TitleOf(strings.Join(x.Reasons, ", "))
	}
	if title == "" {
		title = "Низкая оценка " + itoaN(x.Score) + " из 5"
	}
	prio := PriorityNormal
	if x.Score <= 2 {
		prio = PriorityHigh
	}
	link := &Link{Kind: "manual", Label: x.Work, Lines: []string{"Оценка " + itoaN(x.Score) + " из 5 · " + DayLabel(x.At)}}
	return r.insertRequest(ctx, d, spec{Type: ty, Client: c, Title: title, Channel: ChannelSMS, Status: StatusWork, Assignee: r.tc.PersonID,
		Priority: prio, Link: link, FromRating: x.ID, Details: Details{ClientSince: "Клиент из опроса", Author: r.tc.PersonID}, Messages: []Message{
			{Kind: "rating", Text: x.Comment, Score: x.Score, Reasons: x.Reasons, At: x.At},
			{Kind: "system", Text: "Жалоба открыта из низкой оценки · " + by + ". Клиент не просил связаться — первым ответом позвоните или напишите"},
		}})
}

// byKind is the type of a kind in the direction (nil — none).
func (r *req) byKind(ctx context.Context, dir uuid.UUID, kind string) (*Type, error) {
	list, err := r.types(ctx, []uuid.UUID{dir})
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].Kind == kind {
			return &list[i], nil
		}
	}
	return nil, nil //nolint:nilnil // no such type is the caller's 422
}
