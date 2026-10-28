package service

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// do runs a command that gives a value in one transaction of the tenant DB.
func do[T any](ctx context.Context, s *Service, tc tenantctx.TenantContext, fn func(*req) (T, error)) (T, error) {
	var out T
	err := s.run(ctx, tc, func(r *req) (err error) {
		out, err = fn(r)
		return err
	})
	return out, err
}

// fileRefs checks the files of a message (ids of files.objects that are not rejected) and gives their references.
func (r *req) fileRefs(ctx context.Context, ids []uuid.UUID) ([]FileRef, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.tx.Query(ctx, `select id, coalesce(bytes, 0) from files.objects where id = any($1) and state <> 'rejected'`, ids)
	if err != nil {
		return nil, store("files", err)
	}
	defer rows.Close()
	var out []FileRef
	for rows.Next() {
		f := FileRef{FileName: "Файл"}
		if err := rows.Scan(&f.ID, &f.SizeBytes); err != nil {
			return nil, store("file", err)
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, store("files", err)
	}
	if len(out) != len(uniq(ids)) {
		return nil, invalid("Файл не найден или не прошёл проверку")
	}
	return out, nil
}

func uniq(ids []uuid.UUID) []uuid.UUID {
	out := slices.Clone(ids)
	slices.SortFunc(out, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	return slices.Compact(out)
}

// draft is a checked message of the staff.
type draft struct {
	note  bool
	text  string
	ids   []uuid.UUID
	files []FileRef
}

// PostMessage is postServiceMessage: a reply to the client (needs «Отвечать»; the first reply stops the first timer,
// «Новое» becomes «В работе», the author takes an unassigned request) or an internal note (needs «Видеть», Q-5). The
// reply is saved with the delivery «queued»: the channels are W7.37 (Q-W4.00-service-8).
func (s *Service) PostMessage(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b *api.ServiceMessageCreate) (api.ServiceMessage, error) {
	if b == nil {
		return api.ServiceMessage{}, problem.New(problem.CodeMalformedRequest, "")
	}
	return do(ctx, s, tc, func(r *req) (api.ServiceMessage, error) { return r.postMessage(ctx, id, b) })
}

func (r *req) postMessage(ctx context.Context, id uuid.UUID, b *api.ServiceMessageCreate) (api.ServiceMessage, error) {
	x, d, err := r.open(ctx, id, true)
	if err != nil {
		return api.ServiceMessage{}, err
	}
	dr, err := r.checkMessage(ctx, x, d, b)
	if err != nil {
		return api.ServiceMessage{}, err
	}
	m, first, err := r.addMessage(ctx, x, dr)
	if err != nil {
		return api.ServiceMessage{}, err
	}
	if !dr.note {
		if _, err := r.publish(ctx, evReplied, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, keyDirectionID: x.DirectionID, "firstResponse": first}); err != nil {
			return api.ServiceMessage{}, err
		}
	}
	if err := r.record(ctx, "service.request.message", targetRequest, x.ID, audit.Normal, map[string]any{keyKind: m.Kind}); err != nil {
		return api.ServiceMessage{}, err
	}
	names, err := r.names(ctx, []uuid.UUID{r.tc.PersonID})
	if err != nil {
		return api.ServiceMessage{}, err
	}
	out := messageDTO(m, x, names)
	return out, complete(ctx, r.tx, http.StatusCreated, "", out)
}

// checkMessage checks the kind, the right, the status, the text and the files of a message.
func (r *req) checkMessage(ctx context.Context, x *Request, d *Direction, b *api.ServiceMessageCreate) (draft, error) {
	note := b.Kind == api.ServiceMessageCreateKind(msgNote)
	if !note && b.Kind != api.ServiceMessageCreateKind(msgPublic) {
		return draft{}, invalid("Неизвестный вид сообщения")
	}
	if !note {
		if err := r.need(ctx, actReply, d); err != nil {
			return draft{}, err
		}
	}
	if x.Status == StatusClosed {
		return draft{}, conflict("Обращение закрыто")
	}
	text, err := CheckReplyText(b.Text, note)
	if err != nil {
		return draft{}, err
	}
	var ids []uuid.UUID
	if b.FileIds != nil {
		ids = *b.FileIds
	}
	files, err := r.fileRefs(ctx, ids)
	return draft{note: note, text: text, ids: ids, files: files}, err
}

// addMessage writes a checked message and the change of the request it brings; it reports whether this was the first
// reply to the client.
func (r *req) addMessage(ctx context.Context, x *Request, dr draft) (Message, bool, error) {
	m := Message{ID: uuid.New(), RequestID: x.ID, Kind: msgNote, Author: r.tc.PersonID, Text: dr.text, Files: dr.ids}
	first := false
	if !dr.note {
		m.Kind, m.Channel, m.Delivery = msgPublic, x.Channel, DeliveryQueued
		first = r.reply(x)
	}
	if err := r.insertMessage(ctx, m); err != nil {
		return m, false, err
	}
	if len(dr.files) > 0 {
		if x.Details.Files == nil {
			x.Details.Files = map[string][]FileRef{}
		}
		x.Details.Files[m.ID.String()] = dr.files
	}
	return m, first, r.save(ctx, x)
}

// reply applies a reply to the client to the request: the first reply stops the first timer, «Новое» becomes «В работе»,
// the author takes an unassigned request. It reports whether this was the first reply.
func (r *req) reply(x *Request) bool {
	first := false
	if t := x.SLA.First; t != nil && t.Stopped == nil {
		at := r.now
		t.Stopped, first = &at, true
	}
	if x.Status == StatusNew {
		x.Status = StatusWork
	}
	if x.Assignee == uuid.Nil {
		x.Assignee = r.tc.PersonID
	}
	return first
}

// Transition is transitionServiceRequest: a status by SVC_FLOW. «Решено» needs an outcome and stops the timers,
// «Ждёт клиента» pauses the first reply and the resolution (not the legal term), a return to work moves them by the
// idle working minutes.
func (s *Service) Transition(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b *api.ServiceTransition) (api.ServiceRequest, error) {
	if b == nil {
		return api.ServiceRequest{}, problem.New(problem.CodeMalformedRequest, "")
	}
	return do(ctx, s, tc, func(r *req) (api.ServiceRequest, error) { return r.transition(ctx, id, ifMatch, b) })
}

func (r *req) transition(ctx context.Context, id uuid.UUID, ifMatch string, b *api.ServiceTransition) (api.ServiceRequest, error) {
	x, d, err := r.open(ctx, id, true)
	if err != nil {
		return api.ServiceRequest{}, err
	}
	to := string(b.To)
	if err := r.checkTransition(ctx, x, d, to, ifMatch); err != nil {
		return api.ServiceRequest{}, err
	}
	from := x.Status
	if err := r.move(ctx, x, d, to, deref(b.Outcome)); err != nil {
		return api.ServiceRequest{}, err
	}
	if err := r.save(ctx, x); err != nil {
		return api.ServiceRequest{}, err
	}
	if err := r.transitionEvents(ctx, x, from, to); err != nil {
		return api.ServiceRequest{}, err
	}
	if err := r.record(ctx, "service.request.transition", targetRequest, x.ID, audit.Normal, map[string]any{"from": from, "to": to}); err != nil {
		return api.ServiceRequest{}, err
	}
	out, err := r.reload(ctx, x.ID)
	if err != nil {
		return out, err
	}
	return out, complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
}

// checkTransition checks the status, the flow, the right and the revision of a transition.
func (r *req) checkTransition(ctx context.Context, x *Request, d *Direction, to, ifMatch string) error {
	if !KnownStatus(to) {
		return invalid("Неизвестный статус")
	}
	if text := FlowError(x.Status, to); text != "" {
		return conflict(text)
	}
	action := actReply
	if to == StatusResolved || to == StatusClosed {
		action = actResolve
	}
	if err := r.need(ctx, action, d); err != nil {
		return err
	}
	return checkRevision(ifMatch, x.Revision)
}

// move changes the status of x and writes the record of the feed (svcTransition).
func (r *req) move(ctx context.Context, x *Request, d *Direction, to, outcome string) error {
	by, err := r.name(ctx, r.tc.PersonID)
	if err != nil {
		return err
	}
	var line string
	switch to {
	case StatusResolved:
		line, err = r.resolve(ctx, x, d, outcome, by)
	case StatusWait:
		line = r.pause(x, by)
	case StatusWork:
		line = r.resume(x, d, by)
	default:
		line = "Закрыто · " + by
	}
	if err != nil {
		return err
	}
	x.Status = to
	return r.system(ctx, x.ID, line)
}

// resolve resolves x: the timers stop, the survey «Довольны ли решением?» is sent; it returns the line of the feed.
func (r *req) resolve(ctx context.Context, x *Request, d *Direction, outcome, by string) (string, error) {
	if err := CheckOutcome(x.About != uuid.Nil, outcome); err != nil {
		return "", err
	}
	if x.Status == StatusWait {
		ResumeTimers(&x.SLA, d.Calendar, x.PausedAt, r.now)
	}
	x.PausedAt, x.Outcome, x.ResolvedAt = nil, outcome, new(r.now)
	stopAll(&x.SLA, r.now)
	if _, err := r.tx.Exec(ctx, `insert into service.surveys (request_id, sent_at) values ($1, $2) on conflict (request_id) do nothing`, x.ID, r.now); err != nil {
		return "", store("survey", err)
	}
	return "Решено · " + outcome + " · " + by + ". Клиенту отправлен вопрос «Довольны ли решением?»", nil
}

// pause puts x on «Ждёт клиента»: the first reply and the resolution stand, the legal term runs.
func (r *req) pause(x *Request, by string) string {
	x.PausedAt = new(r.now)
	line := "Ждёт клиента · " + by + " — срок на паузе"
	if x.SLA.Legal != nil {
		line += ", срок по закону идёт"
	}
	return line
}

// resume takes x to work from «Ждёт клиента» (the timers move by the idle time) or from «Решено» (the resolution and
// the legal term run again).
func (r *req) resume(x *Request, d *Direction, by string) string {
	if x.Status == StatusWait {
		ResumeTimers(&x.SLA, d.Calendar, x.PausedAt, r.now)
		x.PausedAt = nil
	}
	line := "Взято в работу · " + by
	if x.Status == StatusResolved {
		x.Outcome, x.ResolvedAt = "", nil
		x.SLA.restart()
		line = "Возвращено в работу · " + by
	}
	if x.Assignee == uuid.Nil {
		x.Assignee = r.tc.PersonID
	}
	return line
}
