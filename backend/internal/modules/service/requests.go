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

// ListQuery is a page of the queue.
type ListQuery struct {
	PageQuery
	Direction uuid.UUID
	Queue     string
	Kind      string
	Channel   string
	Q         string
}

// meOrNil is the actor for a query argument (nil — none, so that «is distinct from» keeps every row).
func (r *req) meOrNil() any { return nullID(r.tc.PersonID) }

// source loads what the queues are counted over: the requests of the directions the actor reads, but not the
// complaints about him, and the open low ratings.
func (r *req) source(ctx context.Context, dirs []Direction) (Source, error) {
	list, err := r.requests(ctx, "r.direction_id = any($1) and r.about_member_id is distinct from $2", idsOf(dirs), r.meOrNil())
	if err != nil {
		return Source{}, err
	}
	ratings, err := r.ratings(ctx, idsOf(dirs), "open")
	if err != nil {
		return Source{}, err
	}
	return Source{Requests: list, Calendars: calendarsOf(dirs), Ratings: ratings}, nil
}

// scoped is the directions of a list: all visible, or the one asked (404 if the actor does not read it).
func (r *req) scoped(ctx context.Context, direction uuid.UUID) ([]Direction, error) {
	dirs, err := r.visible(ctx, actRead)
	if err != nil {
		return nil, err
	}
	if direction == uuid.Nil {
		return dirs, nil
	}
	d := find(dirs, direction)
	if d == nil {
		return nil, notFound(textDirectionMissing)
	}
	return []Direction{*d}, nil
}

// ListRequests is listServiceRequests: a page of the queue sorted by the main term, with the counters.
func (s *Service) ListRequests(ctx context.Context, tc tenantctx.TenantContext, q ListQuery) (api.ServiceRequestList, error) {
	out := api.ServiceRequestList{Items: []api.ServiceRequestSummary{}}
	offset, limit, err := q.window()
	if err != nil {
		return out, err
	}
	err = s.run(ctx, tc, func(r *req) error {
		dirs, err := r.scoped(ctx, q.Direction)
		if err != nil {
			return err
		}
		src, err := r.source(ctx, dirs)
		if err != nil {
			return err
		}
		now := r.now
		rows, _ := src.Queue(QueueQuery{Queue: q.Queue, Direction: q.Direction, Kind: q.Kind, Channel: q.Channel, Q: q.Q, Me: r.tc.PersonID, Now: now})
		out.Counts = countsDTO(src.Counts(q.Direction, r.tc.PersonID, now))
		from, to, next := pageOf(offset, limit, len(rows))
		out.NextCursor = next
		names, err := r.assigneeNames(ctx, rows[from:to])
		if err != nil {
			return err
		}
		for _, row := range rows[from:to] {
			out.Items = append(out.Items, summaryDTO(row.Request, src.Calendars[row.Request.DirectionID], names, viewer{r.tc.PersonID}, now))
		}
		return nil
	})
	return out, err
}

func (r *req) assigneeNames(ctx context.Context, rows []Row) (map[uuid.UUID]string, error) {
	var ids []uuid.UUID
	for _, row := range rows {
		if row.Request.Assignee != uuid.Nil {
			ids = append(ids, row.Request.Assignee)
		}
	}
	return r.names(ctx, ids)
}

// QueueCounts is getServiceQueueCounts.
func (s *Service) QueueCounts(ctx context.Context, tc tenantctx.TenantContext, direction uuid.UUID) (api.ServiceQueueCounts, error) {
	var out api.ServiceQueueCounts
	err := s.run(ctx, tc, func(r *req) error {
		dirs, err := r.scoped(ctx, direction)
		if err != nil {
			return err
		}
		src, err := r.source(ctx, dirs)
		if err != nil {
			return err
		}
		out = countsDTO(src.Counts(direction, r.tc.PersonID, r.now))
		return nil
	})
	return out, err
}

// requestDTO is the card of a request with the feed, the tasks and the terms for the actor.
func (r *req) requestDTO(ctx context.Context, x *Request, d *Direction) (api.ServiceRequest, error) {
	msgs, err := r.messages(ctx, x.ID)
	if err != nil {
		return api.ServiceRequest{}, err
	}
	ids := []uuid.UUID{x.Assignee, x.About}
	if x.Shared != nil {
		ids = append(ids, x.Shared.By)
	}
	for _, m := range msgs {
		ids = append(ids, m.Author)
	}
	names, err := r.names(ctx, slices.DeleteFunc(ids, func(id uuid.UUID) bool { return id == uuid.Nil }))
	if err != nil {
		return api.ServiceRequest{}, err
	}
	sum := summaryDTO(x, d.Calendar, names, viewer{r.tc.PersonID}, r.now)
	out := api.ServiceRequest{Id: sum.Id, Key: sum.Key, DirectionId: sum.DirectionId, Kind: api.ServiceRequestKind(sum.Kind), Title: sum.Title,
		Status: api.ServiceRequestStatus(sum.Status), Priority: api.ServiceRequestPriority(sum.Priority), Assignee: sum.Assignee,
		CreatedAt: sum.CreatedAt, Channel: api.ServiceRequestChannel(sum.Channel), Client: sum.Client, Link: sum.Link, Sla: sum.Sla,
		Head: sum.Head, Labels: sum.Labels, TaskCount: sum.TaskCount, OldKeys: sum.OldKeys, FromRating: sum.FromRating,
		Outcome: sum.Outcome, ResolvedAt: sum.ResolvedAt, Revision: x.Revision, Messages: make([]api.ServiceMessage, 0, len(msgs)),
		Tasks: make([]api.ServiceTaskRef, 0, len(x.Details.Tasks)), Compensation: opt(x.Compensation)}
	for _, m := range msgs {
		out.Messages = append(out.Messages, messageDTO(m, x, names))
	}
	for _, t := range x.Details.Tasks {
		out.Tasks = append(out.Tasks, api.ServiceTaskRef{Id: t.ID, Key: t.Key, Title: t.Title, Status: t.Status})
	}
	if out.AllowedStatuses, err = r.allowed(ctx, x, d); err != nil {
		return out, err
	}
	if x.Shared != nil {
		by := ref(names, x.Shared.By)
		out.Shared = &struct {
			At   api.Instant          `json:"at"`
			By   api.ServiceMemberRef `json:"by"`
			Text string               `json:"text"`
		}{At: x.Shared.At.UTC(), By: *by, Text: x.Shared.Text}
	}
	if x.About != uuid.Nil && (r.tc.Owner || (d.LeadID != nil && *d.LeadID == r.tc.PersonID)) {
		out.AboutMember = ref(names, x.About)
	}
	return out, nil
}

// allowed are the statuses the actor may move the request to (SVC_FLOW cut by the rights).
func (r *req) allowed(ctx context.Context, x *Request, d *Direction) ([]api.ServiceRequestAllowedStatuses, error) {
	out := []api.ServiceRequestAllowedStatuses{}
	reply, err := r.mayIn(ctx, actReply, d)
	if err != nil {
		return nil, err
	}
	resolve, err := r.mayIn(ctx, actResolve, d)
	if err != nil {
		return nil, err
	}
	for _, to := range Flow(x.Status) {
		if (to == StatusResolved || to == StatusClosed) && resolve || (to != StatusResolved && to != StatusClosed) && reply {
			out = append(out, api.ServiceRequestAllowedStatuses(to))
		}
	}
	return out, nil
}

// GetRequest is getServiceRequest.
func (s *Service) GetRequest(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.ServiceRequest, error) {
	var out api.ServiceRequest
	err := s.run(ctx, tc, func(r *req) error {
		x, d, err := r.open(ctx, id, false)
		if err != nil {
			return err
		}
		out, err = r.requestDTO(ctx, x, d)
		return err
	})
	return out, err
}

// reload gives the request after a command as the card.
func (r *req) reload(ctx context.Context, id uuid.UUID) (api.ServiceRequest, error) {
	x, d, err := r.open(ctx, id, false)
	if err != nil {
		return api.ServiceRequest{}, err
	}
	return r.requestDTO(ctx, x, d)
}

// spec is a new request: what the caller of insertRequest decides, the rest follows from the type.
type spec struct {
	Type       *Type
	Client     Client
	Title      string
	Channel    string
	Status     string
	Assignee   uuid.UUID
	Priority   string
	Link       *Link
	FromRating uuid.UUID
	Details    Details
	Messages   []Message
}

// insertRequest numbers a request in its direction, writes it with its timers, details and feed and returns it. The
// direction row is locked: the numbers of a direction are consecutive.
func (r *req) insertRequest(ctx context.Context, d *Direction, sp spec) (*Request, error) {
	locked, err := r.direction(ctx, d.ID, true)
	if err != nil {
		return nil, err
	}
	n := locked.Next
	if _, err := r.tx.Exec(ctx, `update service.directions set next_number = $2, updated_at = $3 where id = $1`, d.ID, n+1, r.now); err != nil {
		return nil, store("number", err)
	}
	id, key := uuid.New(), d.Key+"-"+strconv.Itoa(n)
	var fromRating any
	if sp.FromRating != uuid.Nil {
		fromRating = sp.FromRating
	}
	if _, err := r.tx.Exec(ctx, `insert into service.requests (id, direction_id, number, key, kind, type_id, title, status, priority, assignee_id,
		client_id, channel, link_ref, labels, from_rating_id, created_at, updated_at, revision)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '{}', $14, $15, $15, 1)`,
		id, d.ID, n, key, sp.Type.Kind, sp.Type.ID, sp.Title, sp.Status, sp.Priority, nullID(sp.Assignee), sp.Client.ID, sp.Channel,
		jsonOrNil(sp.Link), fromRating, r.now); err != nil {
		return nil, store("insert request", err)
	}
	x := &Request{ID: id, DirectionID: d.ID, Number: n, Key: key, Kind: sp.Type.Kind, TypeID: sp.Type.ID, Title: sp.Title, Status: sp.Status,
		Priority: sp.Priority, Assignee: sp.Assignee, Channel: sp.Channel, Client: sp.Client, Link: sp.Link, Labels: []string{},
		CreatedAt: r.now, UpdatedAt: r.now, Revision: 1, SLA: SLAFor(d.Calendar, sp.Type.Goals, r.now), Details: sp.Details}
	if err := r.saveDetails(ctx, x); err != nil {
		return nil, err
	}
	if err := r.saveTimers(ctx, x); err != nil {
		return nil, err
	}
	for _, m := range sp.Messages {
		m.RequestID = id
		if err := r.insertMessage(ctx, m); err != nil {
			return nil, err
		}
	}
	return x, nil
}

// upsertClient finds the client by the phone (the server joins the calls of one number, Q-W4.00-service-7) or makes him.
func (r *req) upsertClient(ctx context.Context, name, company, phone string) (Client, error) {
	var c Client
	err := r.tx.QueryRow(ctx, `insert into service.clients (name, company, phone, since, created_at) values ($1, nullif($2, ''), $3, $4::timestamptz::date, $4::timestamptz)
		on conflict (phone) do update set company = coalesce(service.clients.company, excluded.company)
		returning id, name, coalesce(company, ''), phone, opted_out, since::timestamptz, created_at`,
		strings.TrimSpace(name), strings.TrimSpace(company), NormalizePhone(phone), r.now).
		Scan(&c.ID, &c.Name, &c.Company, &c.Phone, &c.OptedOut, &c.Since, &c.CreatedAt)
	if err != nil {
		if code, _ := pgCode(err); code == "23514" {
			return c, invalid("Телефон — не меньше 10 цифр")
		}
		return c, store(msgClient, err)
	}
	return c, nil
}

// linkOf is the work picked at a call: a record of the CRM or a text (the lines say it was linked by hand).
func linkOf(in *api.ServiceLinkInput) (*Link, error) {
	if in == nil || (in.Object == nil && (in.Label == nil || strings.TrimSpace(*in.Label) == "")) {
		return nil, nil //nolint:nilnil // no link is not an error
	}
	label := ""
	if in.Label != nil {
		label = strings.TrimSpace(*in.Label)
	}
	if in.Object != nil {
		o := in.Object
		if o.ModuleKey == "" || o.EntityType == "" || o.EntityId == uuid.Nil {
			return nil, invalid("Связанная запись указана неверно")
		}
		if label == "" {
			label = "Связанная запись"
		}
		return &Link{Kind: "object", Label: label, Lines: []string{}, Object: &ObjectRef{ModuleKey: o.ModuleKey, EntityType: o.EntityType, EntityID: o.EntityId}}, nil
	}
	return &Link{Kind: "manual", Label: label, Lines: []string{"Привязано вручную при звонке"}}, nil
}

// typeOf is the type of a direction by id.
func (r *req) typeOf(ctx context.Context, dir uuid.UUID, id string) (*Type, error) {
	list, err := r.types(ctx, []uuid.UUID{dir})
	if err != nil {
		return nil, err
	}
	i := slices.IndexFunc(list, func(t Type) bool { return t.ID == id })
	if i < 0 {
		return nil, nil //nolint:nilnil // an unknown type is the caller's 422
	}
	return &list[i], nil
}

// CreateRequest is createServiceRequest: a request by a call (channel phone, status «В работе», the author is the
// performer; the call is the first message, the first reply still has to be given).
func (s *Service) CreateRequest(ctx context.Context, tc tenantctx.TenantContext, b *api.ServiceRequestCreate) (api.ServiceRequest, error) {
	if b == nil {
		return api.ServiceRequest{}, problem.New(problem.CodeMalformedRequest, "")
	}
	return do(ctx, s, tc, func(r *req) (api.ServiceRequest, error) { return r.createRequest(ctx, b) })
}

// callTarget checks the direction and the type of a request by a call: the direction the actor does not see is the
// same «Выберите направление» as a missing one.
func (r *req) callTarget(ctx context.Context, b *api.ServiceRequestCreate) (*Direction, *Type, error) {
	d, err := r.direction(ctx, b.DirectionId, false)
	if err != nil {
		return nil, nil, err
	}
	if d == nil {
		return nil, nil, invalid("Выберите направление")
	}
	if err := r.need(ctx, actCreate, d); err != nil {
		if problem.Is(err, problem.CodeNotFound) {
			return nil, nil, invalid("Выберите направление")
		}
		return nil, nil, err
	}
	ty, err := r.typeOf(ctx, d.ID, b.TypeId)
	if err != nil {
		return nil, nil, err
	}
	if ty == nil {
		return nil, nil, invalid("Выберите тип обращения")
	}
	return d, ty, nil
}

func (r *req) createRequest(ctx context.Context, b *api.ServiceRequestCreate) (api.ServiceRequest, error) {
	d, ty, err := r.callTarget(ctx, b)
	if err != nil {
		return api.ServiceRequest{}, err
	}
	if err := CheckCall(b.ClientName, b.Phone, b.Text); err != nil {
		return api.ServiceRequest{}, err
	}
	link, err := linkOf(b.Link)
	if err != nil {
		return api.ServiceRequest{}, err
	}
	x, err := r.createByCall(ctx, d, ty, b, link)
	if err != nil {
		return api.ServiceRequest{}, err
	}
	if err := r.record(ctx, "service.request.create", targetRequest, x.ID, audit.Normal, map[string]any{keyKey: x.Key, keyChannel: ChannelPhone}); err != nil {
		return api.ServiceRequest{}, err
	}
	if _, err := r.publish(ctx, evCreated, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, keyDirectionID: d.ID, keyKind: x.Kind, keyChannel: x.Channel}); err != nil {
		return api.ServiceRequest{}, err
	}
	out, err := r.reload(ctx, x.ID)
	if err != nil {
		return out, err
	}
	return out, complete(ctx, r.tx, http.StatusCreated, etag(out.Revision), out)
}
func (r *req) createByCall(ctx context.Context, d *Direction, ty *Type, b *api.ServiceRequestCreate, link *Link) (*Request, error) {
	client, err := r.upsertClient(ctx, b.ClientName, deref(b.Company), b.Phone)
	if err != nil {
		return nil, err
	}
	by, err := r.name(ctx, r.tc.PersonID)
	if err != nil {
		return nil, err
	}
	title := TitleOf(b.Text)
	if b.Title != nil && strings.TrimSpace(*b.Title) != "" {
		title = trimTo(strings.TrimSpace(*b.Title), 200)
	}
	details := Details{ClientSince: textNewClient, Author: r.tc.PersonID, Shown: []uuid.UUID{r.tc.PersonID}}
	return r.insertRequest(ctx, d, spec{Type: ty, Client: client, Title: title, Channel: ChannelPhone, Status: StatusWork, Assignee: r.tc.PersonID,
		Priority: ty.Priority, Link: link, Details: details, Messages: []Message{
			{Kind: "system", Text: "Заведено по звонку · " + by},
			{Kind: msgClient, Text: strings.TrimSpace(b.Text), Channel: ChannelPhone},
		}})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
