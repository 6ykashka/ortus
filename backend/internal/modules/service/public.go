package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"time"

	"github.com/google/uuid"

	psapi "github.com/ortus/ortus-crm/backend/internal/api/publicservice"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The client of a request has no account: his personal link carries a token, the page of a direction is found by its
// slug. The token is not kept anywhere, only its digest — in the tenant (service.portal_tokens) and in the control
// index (public_service_tokens) that routes a request without a tenant in the path to its database.

const (
	// reopenWindow is how long after the resolution the client may say «Вопрос не решён» (Q-W4.00-service-3).
	reopenWindow = 5 * 24 * time.Hour
	// tokenLife is the life of a personal link (a year).
	tokenLife = 365 * 24 * time.Hour
	// submitLimit is how many requests one client may send from the page in an hour (FORM-07).
	submitLimit = 5
	textNoLink  = "Обращение не найдено"
)

var errRateLimited = problem.New("rate_limited", "Слишком много обращений: попробуйте позже")

// newToken is a token of the portal: 24 random bytes.
func newToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "tok_" + base64.RawURLEncoding.EncodeToString(b), nil
}

// asPortal runs fn for the personal link: the control index, the tenant DB, the token of the tenant (not revoked, the
// same digest) and its request. An unknown, revoked or orphan token is 404; an expired one is 410 public_token_expired.
func (s *Service) asPortal(ctx context.Context, token string, write bool, fn func(*req, *Request, *Direction) error) error {
	if s.Index == nil {
		return problem.New(codeUnavailable, "Портал клиента не настроен на сервере")
	}
	digest := TokenDigest(token)
	row, ok, err := s.Index.FindToken(ctx, digest)
	switch {
	case err != nil:
		return problem.Wrap(codeUnavailable, err)
	case !ok:
		return notFound(textNoLink)
	case !row.ExpiresAt.After(s.now()):
		return problem.New(codeExpired, "")
	}
	tc := tenantctx.TenantContext{TenantID: row.Tenant}
	return s.run(ctx, tc, func(r *req) error {
		var live bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from service.portal_tokens where id = $1 and request_id = $2 and token_digest = $3
			and revoked_at is null and expires_at > $4)`, row.ID, row.Request, digest, r.now).Scan(&live); err != nil {
			return store("portal token", err)
		}
		if !live {
			return notFound(textNoLink)
		}
		x, err := r.request(ctx, row.Request, write)
		if err != nil {
			return err
		}
		if x == nil {
			return notFound(textNoLink)
		}
		d, err := r.direction(ctx, x.DirectionID, false)
		if err != nil || d == nil {
			return notFound(textNoLink)
		}
		return fn(r, x, d)
	})
}

// portalDTO is the request as the client sees it: the public messages and the labels of the clients (1a).
func (r *req) portalDTO(ctx context.Context, x *Request, d *Direction) (psapi.PublicServiceRequest, error) {
	msgs, err := r.messages(ctx, x.ID)
	if err != nil {
		return psapi.PublicServiceRequest{}, err
	}
	resolved := x.Status == StatusResolved && x.ResolvedAt != nil
	out := psapi.PublicServiceRequest{Key: x.Key, Title: x.Title, Status: psapi.PublicServiceRequestStatus(x.Status), StatusLabel: StatusOf(x.Status).Client,
		Messages: portalMessages(x, msgs), Rating: x.Details.Rated64()}
	if x.Status == StatusNew || x.Status == StatusWork {
		if h := SLAHeadOf(x.sla(), d.Calendar, r.now); h.Until != "" && h.State != stateDone && h.State != statePause && h.State != stateLate {
			text := "Ответим " + h.Until
			out.DueText = &text
		}
	}
	if resolved {
		until := x.ResolvedAt.Add(reopenWindow).UTC()
		out.ReopenUntil = &until
		out.CanRate = x.Details.Rated == nil
		out.CanReopen = !r.now.After(until)
	}
	return out, nil
}

// portalMessages are the public messages of the feed: what the client wrote and what was written to him.
func portalMessages(x *Request, msgs []Message) []psapi.PublicServiceMessage {
	out := []psapi.PublicServiceMessage{}
	for _, m := range msgs {
		if m.Kind != msgClient && m.Kind != msgPublic {
			continue
		}
		files := []psapi.ServiceFile{}
		for _, f := range x.Details.Files[m.ID.String()] {
			files = append(files, psapi.ServiceFile{Id: f.ID, FileName: f.FileName, SizeBytes: f.SizeBytes, Status: psapi.ServiceFileStatus("ready")})
		}
		out = append(out, psapi.PublicServiceMessage{Id: m.ID, At: m.At.UTC(), Text: m.Text, FromClient: m.Kind == msgClient, Files: files})
	}
	return out
}

// Rated64 is the rating of the resolution given by the client (nil — none).
func (d Details) Rated64() *int64 {
	if d.Rated == nil {
		return nil
	}
	v := int64(*d.Rated)
	return &v
}

// PortalRequest is getPublicServiceRequest.
func (s *Service) PortalRequest(ctx context.Context, token string) (psapi.PublicServiceRequest, error) {
	var out psapi.PublicServiceRequest
	err := s.asPortal(ctx, token, false, func(r *req, x *Request, d *Direction) (err error) {
		out, err = r.portalDTO(ctx, x, d)
		return err
	})
	return out, err
}

// PortalMessage is postPublicServiceMessage: a message of the client; it takes the request off «Ждёт клиента».
func (s *Service) PortalMessage(ctx context.Context, token string, b *psapi.PublicServiceMessageCreate) (psapi.PublicServiceMessage, error) {
	var out psapi.PublicServiceMessage
	if b == nil {
		return out, problem.New(problem.CodeMalformedRequest, "")
	}
	err := s.asPortal(ctx, token, true, func(r *req, x *Request, d *Direction) error {
		if x.Status == StatusClosed {
			return conflict("Обращение закрыто")
		}
		text := strings.TrimSpace(b.Text)
		if runes(text) < 2 {
			return invalid("Напишите текст сообщения")
		}
		m := Message{ID: uuid.New(), RequestID: x.ID, Kind: msgClient, Text: text, Channel: x.Channel}
		if err := r.insertMessage(ctx, m); err != nil {
			return err
		}
		if x.Status == StatusWait {
			ResumeTimers(&x.SLA, d.Calendar, x.PausedAt, r.now)
			x.PausedAt, x.Status = nil, StatusWork
		}
		if err := r.save(ctx, x); err != nil {
			return err
		}
		if err := r.notifyTeam(ctx, x, d, "service.request.client_replied", "Клиент ответил по обращению "+x.Key); err != nil {
			return err
		}
		out = psapi.PublicServiceMessage{Id: m.ID, At: m.At, Text: text, FromClient: true, Files: []psapi.ServiceFile{}}
		if out.At.IsZero() {
			out.At = r.now
		}
		return nil
	})
	return out, err
}

// notifyTeam tells the performer (or the lead of the direction) of a request that the client wrote.
func (r *req) notifyTeam(ctx context.Context, x *Request, d *Direction, kind, title string) error {
	to := x.Assignee
	if to == uuid.Nil && d.LeadID != nil {
		to = *d.LeadID
	}
	return r.notify(ctx, to, inbox.Notice{Kind: kind, Title: title, Object: &inbox.Object{ModuleKey: moduleService, EntityType: entityRequest, EntityID: x.ID},
		Link: "/service?request=" + x.ID.String()})
}

// PortalRate is ratePublicServiceResolution: one rating of the resolution per request («Довольны ли решением?»).
func (s *Service) PortalRate(ctx context.Context, token string, b *psapi.PublicServiceCsat) (psapi.PublicServiceRequest, error) {
	var out psapi.PublicServiceRequest
	if b == nil {
		return out, problem.New(problem.CodeMalformedRequest, "")
	}
	err := s.asPortal(ctx, token, true, func(r *req, x *Request, d *Direction) error {
		switch {
		case x.Status != StatusResolved:
			return conflict("Оценить можно решённое обращение")
		case x.Details.Rated != nil:
			return conflict("Оценка уже поставлена")
		case b.Score < 1 || b.Score > 5:
			return invalid("Оценка — от 1 до 5")
		}
		score := int(b.Score)
		rating := uuid.New()
		status := "seen"
		if score <= 3 {
			status = ratingOpen
		}
		comment := ""
		if b.Comment != nil {
			comment = trimTo(strings.TrimSpace(*b.Comment), 1000)
		}
		if _, err := r.tx.Exec(ctx, `insert into service.ratings (id, direction_id, request_id, client_id, score, reasons, comment, work, status, at)
			values ($1, $2, $3, $4, $5, '{}', $6, $7, $8, $9)`, rating, d.ID, x.ID, x.Client.ID, score, comment, "Решение "+x.Key, status, r.now); err != nil {
			return store("rating", err)
		}
		if _, err := r.tx.Exec(ctx, `update service.surveys set answered_at = $2, rating_id = $3 where request_id = $1`, x.ID, r.now, rating); err != nil {
			return store("survey", err)
		}
		x.Details.Rated = &score
		if err := r.save(ctx, x); err != nil {
			return err
		}
		if _, err := r.publish(ctx, evSurvey, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, "score": score}); err != nil {
			return err
		}
		var err error
		out, err = r.portalDTO(ctx, x, d)
		return err
	})
	return out, err
}

// PortalReopen is reopenPublicServiceRequest: «Вопрос не решён» within five days returns the request to work.
func (s *Service) PortalReopen(ctx context.Context, token string, b *psapi.PublicServiceReopen) (psapi.PublicServiceRequest, error) {
	return doPortal(ctx, s, token, func(r *req, x *Request, d *Direction) (psapi.PublicServiceRequest, error) {
		return r.reopen(ctx, x, d, b)
	})
}

// doPortal runs a command of the client that gives a value, for the request of his personal link.
func doPortal[T any](ctx context.Context, s *Service, token string, fn func(*req, *Request, *Direction) (T, error)) (T, error) {
	var out T
	err := s.asPortal(ctx, token, true, func(r *req, x *Request, d *Direction) (err error) {
		out, err = fn(r, x, d)
		return err
	})
	return out, err
}

func (r *req) reopen(ctx context.Context, x *Request, d *Direction, b *psapi.PublicServiceReopen) (psapi.PublicServiceRequest, error) {
	if x.Status != StatusResolved || x.ResolvedAt == nil || r.now.After(x.ResolvedAt.Add(reopenWindow)) {
		return psapi.PublicServiceRequest{}, conflict("Вопрос можно вернуть в течение 5 дней после решения")
	}
	text := "Вопрос не решён"
	if b != nil && b.Text != nil && strings.TrimSpace(*b.Text) != "" {
		text = strings.TrimSpace(*b.Text)
	}
	x.Status, x.Outcome, x.ResolvedAt = StatusWork, "", nil
	x.SLA.restart()
	x.Details.ReopenedAt = new(r.now)
	if err := r.insertMessage(ctx, Message{RequestID: x.ID, Kind: msgClient, Text: text, Channel: x.Channel}); err != nil {
		return psapi.PublicServiceRequest{}, err
	}
	if err := r.system(ctx, x.ID, "Клиент: вопрос не решён — обращение возвращено в работу"); err != nil {
		return psapi.PublicServiceRequest{}, err
	}
	if err := r.save(ctx, x); err != nil {
		return psapi.PublicServiceRequest{}, err
	}
	if _, err := r.publish(ctx, evReopened, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, keyDirectionID: x.DirectionID, "status": StatusWork, "outcome": ""}); err != nil {
		return psapi.PublicServiceRequest{}, err
	}
	if err := r.notifyTeam(ctx, x, d, "service.request.reopened", "Клиент вернул обращение "+x.Key+": вопрос не решён"); err != nil {
		return psapi.PublicServiceRequest{}, err
	}
	return r.portalDTO(ctx, x, d)
}

// PortalOptOut is optOutPublicSurveys («СТОП»): no more surveys for the client (FB-01).
func (s *Service) PortalOptOut(ctx context.Context, token string) (psapi.PublicServiceOptOut, error) {
	var out psapi.PublicServiceOptOut
	err := s.asPortal(ctx, token, true, func(r *req, x *Request, _ *Direction) error {
		if _, err := r.tx.Exec(ctx, `update service.clients set opted_out = true where id = $1`, x.Client.ID); err != nil {
			return store("opt out", err)
		}
		out.OptedOut = true
		return nil
	})
	return out, err
}

// asDirection runs fn for the page of a direction found by its slug.
func (s *Service) asDirection(ctx context.Context, slug string, fn func(*req, *Direction, string) error) error {
	if s.Index == nil {
		return problem.New(codeUnavailable, "Портал клиента не настроен на сервере")
	}
	row, ok, err := s.Index.FindSlug(ctx, slug)
	switch {
	case err != nil:
		return problem.Wrap(codeUnavailable, err)
	case !ok:
		return notFound("Страница не найдена")
	}
	return s.run(ctx, tenantctx.TenantContext{TenantID: row.Tenant}, func(r *req) error {
		list, err := r.directions(ctx, "d.id = $1 and d.public_slug = $2 and d.status = 'active'", row.Direction, slug)
		if err != nil {
			return err
		}
		if len(list) == 0 {
			return notFound("Страница не найдена")
		}
		return fn(r, &list[0], row.TenantName)
	})
}

// PortalPage is getPublicServicePage (1a): the types, the working hours, no data of clients.
func (s *Service) PortalPage(ctx context.Context, slug string) (psapi.PublicServicePage, error) {
	var out psapi.PublicServicePage
	err := s.asDirection(ctx, slug, func(r *req, d *Direction, brand string) error {
		types, err := r.types(ctx, []uuid.UUID{d.ID})
		if err != nil {
			return err
		}
		out = psapi.PublicServicePage{Slug: slug, DirectionName: d.Name, Color: d.Color, BrandName: brand, WorkHours: d.Calendar.Label,
			Types: make([]psapi.PublicServiceType, 0, len(types))}
		for _, t := range types {
			out.Types = append(out.Types, psapi.PublicServiceType{Id: t.ID, Kind: psapi.PublicServiceTypeKind(t.Kind), Name: t.Name})
		}
		return nil
	})
	return out, err
}

// PortalSubmit is submitPublicServiceRequest: a request from the page of a direction. It is «Новое» with no performer;
// the personal link is returned once (the token is not kept). The consent to the processing of the personal data is
// required (FB-05); a client sends no more than submitLimit requests an hour.
func (s *Service) PortalSubmit(ctx context.Context, slug string, b *psapi.PublicServiceSubmit) (psapi.PublicServiceReceipt, error) {
	var out psapi.PublicServiceReceipt
	if b == nil {
		return out, problem.New(problem.CodeMalformedRequest, "")
	}
	err := s.asDirection(ctx, slug, func(r *req, d *Direction, _ string) error {
		if !b.Consent {
			return invalid("Нужно согласие на обработку персональных данных")
		}
		ty, err := r.typeOf(ctx, d.ID, b.TypeId)
		if err != nil {
			return err
		}
		if ty == nil {
			return invalid("Выберите тип обращения")
		}
		if runes(b.Text) < 5 {
			return invalid("Опишите, что случилось")
		}
		name := strings.TrimSpace(deref(b.ClientName))
		if runes(name) < 2 {
			name = "Клиент"
		}
		if len(digitsOf(deref(b.Phone))) < 10 {
			return invalid("Телефон — не меньше 10 цифр")
		}
		x, token, err := r.submit(ctx, d, ty, name, b)
		if err != nil {
			return err
		}
		out = psapi.PublicServiceReceipt{Key: x.Key, StatusLabel: StatusOf(StatusNew).Client, Token: token}
		return nil
	})
	return out, err
}

func (r *req) submit(ctx context.Context, d *Direction, ty *Type, name string, b *psapi.PublicServiceSubmit) (*Request, string, error) {
	client, err := r.upsertClient(ctx, name, "", deref(b.Phone))
	if err != nil {
		return nil, "", err
	}
	var recent int
	if err := r.tx.QueryRow(ctx, `select count(*) from service.requests where client_id = $1 and created_at > $2 and channel in ('widget', 'cabinet')`,
		client.ID, r.now.Add(-time.Hour)).Scan(&recent); err != nil {
		return nil, "", store("rate", err)
	}
	if recent >= submitLimit {
		return nil, "", errRateLimited
	}
	text := strings.TrimSpace(b.Text)
	x, err := r.insertRequest(ctx, d, spec{Type: ty, Client: client, Title: TitleOf(text), Channel: ChannelWidget, Status: StatusNew, Priority: ty.Priority,
		Details: Details{ClientSince: textNewClient}, Messages: []Message{{Kind: msgClient, Text: text, Channel: ChannelWidget}}})
	if err != nil {
		return nil, "", err
	}
	if err := r.acknowledge(ctx, x, d); err != nil {
		return nil, "", err
	}
	if ty.Kind == KindThanks {
		if err := r.passThanks(ctx, x, d); err != nil {
			return nil, "", err
		}
	}
	token, err := r.issueToken(ctx, x)
	if err != nil {
		return nil, "", err
	}
	if err := r.record(ctx, "service.request.submit", targetRequest, x.ID, audit.Normal, map[string]any{keyKey: x.Key, keyChannel: ChannelWidget}); err != nil {
		return nil, "", err
	}
	if _, err := r.publish(ctx, evCreated, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, keyDirectionID: d.ID, keyKind: x.Kind, keyChannel: x.Channel}); err != nil {
		return nil, "", err
	}
	if d.LeadID != nil {
		if err := r.notify(ctx, *d.LeadID, inbox.Notice{Kind: inbox.KindOf(evCreated), Title: "Новое обращение " + x.Key + " · " + d.Name,
			Object: &inbox.Object{ModuleKey: moduleService, EntityType: entityRequest, EntityID: x.ID}, Link: "/service?request=" + x.ID.String()}); err != nil {
			return nil, "", err
		}
	}
	return x, token, nil
}

// passThanks closes a thanks by itself with the outcome «Передано мастеру» and tells the lead of the direction, who passes it on
// (Q-W4.00-service-18): the notice carries the words of the client and no contact of his.
func (r *req) passThanks(ctx context.Context, x *Request, d *Direction) error {
	x.Status, x.Outcome, x.ResolvedAt = StatusResolved, OutcomeThanks, new(r.now)
	stopAll(&x.SLA, r.now)
	if err := r.system(ctx, x.ID, "Благодарность передана: закрыта автоматически"); err != nil {
		return err
	}
	if err := r.save(ctx, x); err != nil {
		return err
	}
	return r.notifyTeam(ctx, x, d, "service.thanks.received", trimTo("Благодарность "+x.Key+": "+x.Title, 300))
}

// acknowledge writes the automatic reply to the client: the number and the term of the first reply.
func (r *req) acknowledge(ctx context.Context, x *Request, d *Direction) error {
	head := SLAHeadOf(x.sla(), d.Calendar, r.now)
	ack := "Приняли обращение " + x.Key + "."
	if head.Until != "" && head.State != stateNone && head.State != statePause {
		ack += " Ответим " + head.Until + "."
	}
	return r.insertMessage(ctx, Message{RequestID: x.ID, Kind: msgPublic, Text: ack, Auto: true, Channel: ChannelWidget, Delivery: DeliveryQueued})
}

// issueToken makes the personal link of a request: the control index first, then the tenant (a failed command drops the
// index row).
func (r *req) issueToken(ctx context.Context, x *Request) (string, error) {
	token, err := newToken()
	if err != nil {
		return "", err
	}
	row := TokenRow{Digest: TokenDigest(token), Tenant: r.tc.TenantID, Request: x.ID, ID: uuid.New(), KeyVersion: 1, ExpiresAt: r.now.Add(tokenLife)}
	if err := r.s.Index.IssueToken(ctx, row); err != nil {
		return "", problem.Wrap(codeUnavailable, err)
	}
	r.undo = append(r.undo, func(ctx context.Context) { _ = r.s.Index.DropToken(ctx, row.Digest) })
	if _, err := r.tx.Exec(ctx, `insert into service.portal_tokens (id, request_id, token_digest, expires_at, created_at) values ($1, $2, $3, $4, $5)`,
		row.ID, x.ID, row.Digest, row.ExpiresAt, r.now); err != nil {
		return "", store("portal token", err)
	}
	return token, nil
}
