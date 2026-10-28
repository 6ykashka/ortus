package service

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// transitionEvents publishes the events of a change of the status: resolved, reopened (resolved → work), closed.
func (r *req) transitionEvents(ctx context.Context, x *Request, from, to string) error {
	typ := ""
	switch {
	case to == StatusResolved:
		typ = evResolved
	case to == StatusClosed:
		typ = evClosed
	case to == StatusWork && from == StatusResolved:
		typ = evReopened
	}
	if typ == "" {
		return nil
	}
	_, err := r.publish(ctx, typ, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, keyDirectionID: x.DirectionID, "status": to, "outcome": x.Outcome})
	return err
}

// Patch is updateServiceRequest: the performer (a person who sees the direction and may reply in it; null takes him
// off) and the priority. unassign is true when the body had assigneeId: null.
func (s *Service) Patch(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b *api.ServiceRequestPatch, unassign bool) (api.ServiceRequest, error) {
	if b == nil {
		return api.ServiceRequest{}, problem.New(problem.CodeMalformedRequest, "")
	}
	return do(ctx, s, tc, func(r *req) (api.ServiceRequest, error) { return r.patch(ctx, id, ifMatch, b, unassign) })
}

func (r *req) patch(ctx context.Context, id uuid.UUID, ifMatch string, b *api.ServiceRequestPatch, unassign bool) (api.ServiceRequest, error) {
	x, d, err := r.open(ctx, id, true)
	if err != nil {
		return api.ServiceRequest{}, err
	}
	if err := r.need(ctx, actReply, d); err != nil {
		return api.ServiceRequest{}, err
	}
	if err := checkRevision(ifMatch, x.Revision); err != nil {
		return api.ServiceRequest{}, err
	}
	changed, err := r.patchFields(ctx, x, d, b, unassign)
	if err != nil {
		return api.ServiceRequest{}, err
	}
	if changed {
		if err := r.save(ctx, x); err != nil {
			return api.ServiceRequest{}, err
		}
		if err := r.record(ctx, "service.request.update", targetRequest, x.ID, audit.Normal, map[string]any{"priority": x.Priority}); err != nil {
			return api.ServiceRequest{}, err
		}
	}
	out, err := r.reload(ctx, x.ID)
	if err != nil {
		return out, err
	}
	return out, complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
}

// patchFields applies the performer and the priority of a patch; it reports whether anything changed.
func (r *req) patchFields(ctx context.Context, x *Request, d *Direction, b *api.ServiceRequestPatch, unassign bool) (bool, error) {
	changed := false
	if b.AssigneeId != nil || unassign {
		if err := r.assign(ctx, x, d, b.AssigneeId); err != nil {
			return false, err
		}
		changed = true
	}
	if b.Priority != nil {
		if err := CheckPriority(string(*b.Priority)); err != nil {
			return false, err
		}
		x.Priority = string(*b.Priority)
		if err := r.system(ctx, x.ID, "Приоритет: "+strings.ToLower(PriorityLabel(x.Priority))); err != nil {
			return false, err
		}
		changed = true
	}
	return changed, nil
}

// assign sets the performer of x (nil — nobody).
func (r *req) assign(ctx context.Context, x *Request, d *Direction, to *uuid.UUID) error {
	if to == nil {
		x.Assignee = uuid.Nil
		return r.system(ctx, x.ID, "Исполнитель снят")
	}
	name, err := r.name(ctx, *to)
	if err != nil {
		return err
	}
	if name == "" {
		return invalid("Сотрудник не найден")
	}
	members, err := r.members(ctx)
	if err != nil {
		return err
	}
	m := members[*to]
	if known := members[*to]; known != (Member{}) && !known.Active {
		return problem.New(codeOutOfScope, name+" не видит направление «"+d.Name+"» — назначить нельзя")
	}
	in, err := r.inTeam(ctx, tenantctx.TenantContext{TenantID: r.tc.TenantID, PersonID: *to, Owner: m.Owner}, d)
	if err != nil {
		return err
	}
	if !in {
		return problem.New(codeOutOfScope, name+" не видит направление «"+d.Name+"» — назначить нельзя")
	}
	x.Assignee = *to
	if err := r.system(ctx, x.ID, "Исполнитель: "+name); err != nil {
		return err
	}
	ev, err := r.publish(ctx, evAssigned, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, keyDirectionID: x.DirectionID, "assigneeId": *to})
	if err != nil || *to == r.tc.PersonID {
		return err
	}
	return r.notify(ctx, *to, inbox.Notice{Kind: inbox.KindOf(evAssigned), Title: "Вам назначено обращение " + x.Key + " · " + d.Name,
		Object: &inbox.Object{ModuleKey: moduleService, EntityType: entityRequest, EntityID: x.ID}, Link: "/service?request=" + x.ID.String(), SourceEvent: ev})
}

// Move is moveServiceRequest: the request gets the next number of the other direction, the old number leads to the new
// one (FB-09); the terms are counted again from the creation by the type of the new direction (Q-W4.00-service-11).
func (s *Service) Move(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b *api.ServiceMove) (api.ServiceRequest, error) {
	var out api.ServiceRequest
	if b == nil {
		return out, problem.New(problem.CodeMalformedRequest, "")
	}
	err := s.run(ctx, tc, func(r *req) error {
		x, from, err := r.open(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, actReply, from); err != nil {
			return err
		}
		if err := checkRevision(ifMatch, x.Revision); err != nil {
			return err
		}
		to, err := r.target(ctx, x, b.DirectionId)
		if err != nil {
			return err
		}
		old := x.Key
		if err := r.renumber(ctx, x, to); err != nil {
			return err
		}
		if err := r.save(ctx, x); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `insert into service.key_aliases (key, request_id, created_at) values ($1, $2, $3)`, old, x.ID, r.now); err != nil {
			return store("alias", err)
		}
		if err := r.system(ctx, x.ID, "Перенесено из «"+from.Name+"» в «"+to.Name+"»: "+old+" → "+x.Key+". Клиент получил новый номер, старый ведёт сюда"); err != nil {
			return err
		}
		if _, err := r.publish(ctx, evMoved, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, "from": from.ID, "to": to.ID, keyKey: x.Key, "oldKey": old}); err != nil {
			return err
		}
		if err := r.record(ctx, "service.request.move", targetRequest, x.ID, audit.Normal, map[string]any{"from": old, "to": x.Key}); err != nil {
			return err
		}
		if out, err = r.reload(ctx, x.ID); err != nil {
			return err
		}
		return complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// target is the direction a request moves to: another one, which the actor reads and may reply in.
func (r *req) target(ctx context.Context, x *Request, id uuid.UUID) (*Direction, error) {
	to, err := r.direction(ctx, id, true)
	if err != nil {
		return nil, err
	}
	if to == nil || to.ID == x.DirectionID {
		return nil, invalid("Выберите другое направление")
	}
	for _, a := range []string{actRead, actReply} {
		ok, err := r.mayIn(ctx, a, to)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, forbidden("Нет доступа к направлению «" + to.Name + "»")
		}
	}
	return to, nil
}

// renumber puts x into the direction to: the next number, the type of its kind (or «Вопрос»), the terms again.
func (r *req) renumber(ctx context.Context, x *Request, to *Direction) error {
	types, err := r.types(ctx, []uuid.UUID{to.ID})
	if err != nil {
		return err
	}
	pick := func(kind string) *Type {
		for i := range types {
			if types[i].Kind == kind {
				return &types[i]
			}
		}
		return nil
	}
	ty := pick(x.Kind)
	if ty == nil {
		ty = pick(KindQuestion)
	}
	n := to.Next
	if _, err := r.tx.Exec(ctx, `update service.directions set next_number = $2, updated_at = $3 where id = $1`, to.ID, n+1, r.now); err != nil {
		return store("number", err)
	}
	x.DirectionID, x.Number, x.Key = to.ID, n, to.Key+"-"+itoaN(n)
	if ty == nil {
		x.TypeID = ""
		return nil
	}
	x.Kind, x.TypeID = ty.Kind, ty.ID
	next := SLAFor(to.Calendar, ty.Goals, x.CreatedAt)
	for _, p := range [][2]*Timer{{x.SLA.First, next.First}, {x.SLA.Resolve, next.Resolve}, {x.SLA.Legal, next.Legal}} {
		if p[0] != nil && p[1] != nil {
			p[1].Stopped = p[0].Stopped
		}
	}
	x.SLA = next
	return nil
}

// RevealPhone is revealServiceClientPhone: the whole number to the actor (service.clients.contacts), once for good;
// every reveal is an audit record of the level «sensitive» and a line of the feed.
func (s *Service) RevealPhone(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.ServicePhoneReveal, error) {
	var out api.ServicePhoneReveal
	err := s.run(ctx, tc, func(r *req) error {
		x, d, err := r.open(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, actContacts, d); err != nil {
			return err
		}
		if !slices.Contains(x.Details.Shown, r.tc.PersonID) {
			x.Details.Shown = append(x.Details.Shown, r.tc.PersonID)
			by, err := r.name(ctx, r.tc.PersonID)
			if err != nil {
				return err
			}
			if err := r.system(ctx, x.ID, "Телефон клиента показан: "+by); err != nil {
				return err
			}
			if err := r.save(ctx, x); err != nil {
				return err
			}
		}
		if err := r.record(ctx, "service.client.phone.reveal", targetRequest, x.ID, audit.Sensitive, map[string]any{"clientId": x.Client.ID}); err != nil {
			return err
		}
		out = api.ServicePhoneReveal{Phone: FormatPhone(x.Client.Phone), ShownAt: r.now}
		return complete(ctx, r.tx, http.StatusOK, "", out)
	})
	return out, err
}

// ShareConclusion is shareServiceConclusion: the conclusion of a resolved complaint goes to the employee it is about,
// without the contacts of the client.
func (s *Service) ShareConclusion(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b *api.ServiceConclusion) (api.ServiceRequest, error) {
	if b == nil {
		return api.ServiceRequest{}, problem.New(problem.CodeMalformedRequest, "")
	}
	return do(ctx, s, tc, func(r *req) (api.ServiceRequest, error) { return r.shareConclusion(ctx, id, ifMatch, b) })
}

func (r *req) shareConclusion(ctx context.Context, id uuid.UUID, ifMatch string, b *api.ServiceConclusion) (api.ServiceRequest, error) {
	x, d, err := r.open(ctx, id, true)
	if err != nil {
		return api.ServiceRequest{}, err
	}
	if err := r.need(ctx, actResolve, d); err != nil {
		return api.ServiceRequest{}, err
	}
	if err := checkRevision(ifMatch, x.Revision); err != nil {
		return api.ServiceRequest{}, err
	}
	switch {
	case x.About == uuid.Nil:
		return api.ServiceRequest{}, invalid("Обращение не касается сотрудника")
	case IsOpen(x.Status):
		return api.ServiceRequest{}, invalid("Поделиться выводом можно после решения")
	}
	text, err := CheckConclusion(b.Text)
	if err != nil {
		return api.ServiceRequest{}, err
	}
	if err := r.shareWith(ctx, x, text); err != nil {
		return api.ServiceRequest{}, err
	}
	out, err := r.reload(ctx, x.ID)
	if err != nil {
		return out, err
	}
	return out, complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
}

// shareWith puts the conclusion into the request and tells the employee it is about, without the contacts of the client.
func (r *req) shareWith(ctx context.Context, x *Request, text string) error {
	x.Shared = &Shared{Text: text, At: r.now, By: r.tc.PersonID}
	about, err := r.name(ctx, x.About)
	if err != nil {
		return err
	}
	if err := r.system(ctx, x.ID, "Вывод отправлен сотруднику: "+about+" · без контактов клиента"); err != nil {
		return err
	}
	if err := r.save(ctx, x); err != nil {
		return err
	}
	ev, err := r.publish(ctx, evConclusion, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, "about": x.About})
	if err != nil {
		return err
	}
	if err := r.notify(ctx, x.About, inbox.Notice{Kind: inbox.KindOf(evConclusion), Title: trimTo("Вывод по обращению "+x.Key+": "+text, 300), SourceEvent: ev}); err != nil {
		return err
	}
	return r.record(ctx, "service.conclusion.share", targetRequest, x.ID, audit.Normal, nil)
}

// SetCompensation is setServiceCompensation (service.compensation.manage, sensitive, PD-60): the discount stays in the
// card of the client; a refund is offered to the cash with the key of the request as the basis, or only written down.
func (s *Service) SetCompensation(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b *api.ServiceCompensationSet) (api.ServiceRequest, error) {
	var out api.ServiceRequest
	if b == nil {
		return out, problem.New(problem.CodeMalformedRequest, "")
	}
	err := s.run(ctx, tc, func(r *req) error {
		x, d, err := r.open(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, actCompensation, d); err != nil {
			return err
		}
		if err := checkRevision(ifMatch, x.Revision); err != nil {
			return err
		}
		label, ok := CompensationOf(string(b.Kind))
		if !ok {
			return invalid("Неизвестная компенсация")
		}
		if x.Status == StatusClosed {
			return conflict("Обращение закрыто")
		}
		if err := r.compensate(ctx, x, label, deref(b.Text)); err != nil {
			return err
		}
		if err := r.save(ctx, x); err != nil {
			return err
		}
		if _, err := r.publish(ctx, evCompensation, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, keyKind: string(b.Kind)}); err != nil {
			return err
		}
		if err := r.record(ctx, "service.compensation.set", targetRequest, x.ID, audit.Sensitive, map[string]any{keyKind: string(b.Kind)}); err != nil {
			return err
		}
		if out, err = r.reload(ctx, x.ID); err != nil {
			return err
		}
		return complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// compensate puts a compensation into x: a note with the words of the author, a line of the feed, a proposal to the cash.
func (r *req) compensate(ctx context.Context, x *Request, label, text string) error {
	if t := strings.TrimSpace(text); t != "" {
		if err := r.insertMessage(ctx, Message{RequestID: x.ID, Kind: "note", Author: r.tc.PersonID, Text: t}); err != nil {
			return err
		}
	}
	x.Compensation = label
	line := "Компенсация: " + label + " — сохранена в карточке клиента"
	if label == RefundCompensation {
		line = "Компенсация: " + label + " — возврат проводится только кассой с основанием " + x.Key
		if r.s.Cash != nil {
			if err := r.s.Cash.OfferRefund(ctx, r.tx, r.tc.TenantID, RefundOffer{Request: x.ID, Key: x.Key, By: r.tc.PersonID}); err != nil {
				return err
			}
			line = "Компенсация: " + label + " — предложение операции отправлено в кассу, основание " + x.Key
		}
	}
	return r.system(ctx, x.ID, line)
}

// CreateTask is createServiceRequestTask: a task of the project of the direction (or the one given) made through the
// port of «Задачи»; the client does not see it.
func (s *Service) CreateTask(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b *api.ServiceTaskCreate) (api.ServiceTaskRef, error) {
	var out api.ServiceTaskRef
	if b == nil {
		return out, problem.New(problem.CodeMalformedRequest, "")
	}
	err := s.run(ctx, tc, func(r *req) error {
		x, d, err := r.open(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, actReply, d); err != nil {
			return err
		}
		title, err := CheckTaskTitle(b.Title)
		if err != nil {
			return err
		}
		if r.s.Tasks == nil {
			return problem.New(problem.CodeDependencyUnavailable, "Задачи не подключены")
		}
		by, err := r.name(ctx, r.tc.PersonID)
		if err != nil {
			return err
		}
		project := d.ProjectID
		if b.ProjectId != nil {
			project = *b.ProjectId
		}
		assignee := x.Assignee
		if assignee == uuid.Nil {
			assignee = r.tc.PersonID
		}
		res, err := r.s.Tasks.CreateTask(ctx, r.tx, r.tc.TenantID, TaskInput{Project: project, Author: r.tc.PersonID, Assignee: assignee,
			AuthorOwner: r.tc.Owner, AuthorName: by, Title: title, Description: "Обращение " + x.Key + ": " + x.Title, Request: x.ID, Origin: "обращение " + x.Key})
		if err != nil {
			return err
		}
		if res.Refused != "" {
			return forbidden(res.Refused)
		}
		x.Details.Tasks = append(x.Details.Tasks, TaskRef{ID: res.ID, Key: res.Key, Title: title, Status: res.Status})
		if err := r.system(ctx, x.ID, "Создана задача "+res.Key+" «"+title+"» · клиент её не видит"); err != nil {
			return err
		}
		if err := r.save(ctx, x); err != nil {
			return err
		}
		out = api.ServiceTaskRef{Id: res.ID, Key: res.Key, Title: title, Status: res.Status}
		return complete(ctx, r.tx, http.StatusCreated, "", out)
	})
	return out, err
}
