package docs

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const codeSignInvalid = "sign_code_invalid"

// activeRoute is the active route of d with its row locked, 409 invalid_transition «Документ не на маршруте» otherwise.
func (r *req) activeRoute(ctx context.Context, d *document) (*routeData, error) {
	rd, err := r.loadRoute(ctx, d.id, true)
	if err != nil {
		return nil, err
	}
	if rd == nil || rd.status != routeActive || rd.step() == nil {
		return nil, transition(textNotOnRoute)
	}
	return rd, nil
}

// waitText is the text of a refusal of a decision of a member the step does not wait for.
func (r *req) waitText(s *routeStep) string {
	var names []string
	for _, id := range s.waiting() {
		names = append(names, r.w.names[id])
	}
	if s.externalWaiting() {
		names = append(names, s.ext.name+" (заказчик подписывает по ссылке из SMS)")
	}
	if len(names) == 0 {
		return "Сейчас ваше решение не нужно"
	}
	return "Сейчас решение ждут: " + strings.Join(names, ", ")
}

// authorOrOwner reports whether the member started the route or owns the business.
func (r *req) authorOrOwner(rd *routeData) bool { return r.me.id == rd.startedBy || r.me.owner }

// routeAnswer is the route of d after an operation, as the card shows it.
func (r *req) routeAnswer(ctx context.Context, d *document) (dapi.DocRoute, error) {
	route, err := r.routeDTO(ctx, d)
	if err != nil || route == nil {
		return dapi.DocRoute{}, err
	}
	return *route, nil
}

// DecideRoute approves the current step or returns the document for rework (decideDocRoute — docRouteDecide): only a
// member the step waits for; a return needs a comment unless the route lets it go without one.
func (s *Service) DecideRoute(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocRouteDecide) (dapi.DocRoute, error) {
	var out dapi.DocRoute
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, _, err := r.doc(id)
		if err != nil {
			return err
		}
		rd, err := r.activeRoute(ctx, d)
		if err != nil {
			return err
		}
		st := rd.step()
		if !slices.Contains(st.waiting(), r.me.id) {
			return forbidden(r.waitText(st))
		}
		if st.kind == stepAck {
			return failed(textAckByMember)
		}
		comment := ""
		if b.Comment != nil {
			comment = clip(strings.TrimSpace(*b.Comment), 1000)
		}
		if b.Decision == dapi.DocRouteDecideDecisionReturn {
			err = r.returnRoute(ctx, d, rd, st, comment)
		} else {
			err = r.approveStep(ctx, d, rd, st, comment)
		}
		if err != nil {
			return err
		}
		out, err = r.routeAnswer(ctx, d)
		return err
	})
	return out, err
}

// approveStep is the decision «ok» of a member of the step; the step is over when nobody waits any more.
func (r *req) approveStep(ctx context.Context, d *document, rd *routeData, st *routeStep, comment string) error {
	if st.kind == stepSign {
		return failed(textSignByCode)
	}
	if err := r.addDecision(ctx, rd, st, decision{member: r.me.id, kind: decisionOK, method: methodClick, comment: comment}); err != nil {
		return err
	}
	note := r.me.name + ": согласовал(а) v" + strconv.Itoa(rd.version) + commentTail(comment)
	if err := r.record(ctx, "docs.route.approve", d.id, r.me.name+" согласовал(а) v"+strconv.Itoa(rd.version), false, nil); err != nil {
		return err
	}
	if len(st.waiting()) == 0 {
		if err := r.syncTask(ctx, d, rd, note); err != nil {
			return err
		}
		return r.advance(ctx, d, rd)
	}
	if st.mode == modeSeq {
		if err := r.askStep(ctx, d, rd, st); err != nil {
			return err
		}
	}
	return r.syncTask(ctx, d, rd, note)
}

func commentTail(comment string) string {
	if comment == "" {
		return ""
	}
	return " — " + comment
}

// returnRoute sends the document back to its author: the route waits for the new version, the author edits again.
func (r *req) returnRoute(ctx context.Context, d *document, rd *routeData, st *routeStep, comment string) error {
	if rd.rules.CommentOnBack && comment == "" {
		return invalid("comment", textWriteWhat, "required")
	}
	if err := r.addDecision(ctx, rd, st, decision{member: r.me.id, kind: decisionBack, method: methodClick, comment: comment}); err != nil {
		return err
	}
	rd.status = routeReturned
	rd.back = &backJSON{Step: rd.current, By: r.me.id, Name: r.me.name, Comment: comment, At: r.now}
	rd.rules.Sign = nil
	if err := r.saveRoute(ctx, rd); err != nil {
		return err
	}
	if err := r.revokeTemps(ctx, d); err != nil {
		return err
	}
	if err := r.saveDoc(ctx, d, statusReturned, nil); err != nil {
		return err
	}
	d.lock = false
	if err := r.record(ctx, "docs.route.return", d.id, r.me.name+" вернул(а) на доработку: "+orDefault(comment, "без комментария"), false, nil); err != nil {
		return err
	}
	ev, err := r.publish(ctx, "docs.route.returned", aggDocument, d.id, map[string]any{keyRouteID: rd.id, keyStep: rd.back.Step})
	if err != nil {
		return err
	}
	if err := r.notify(ctx, "docs.route.returned", "«"+d.title+"» вернули на доработку: "+orDefault(comment, "без комментария"), d.id, ev, []uuid.UUID{rd.startedBy}); err != nil {
		return err
	}
	return r.syncTask(ctx, d, rd, r.me.name+": вернул(а) на доработку v"+strconv.Itoa(rd.version)+commentTail(comment))
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// ResumeRoute sends a returned document again (resumeDocRoute — docRouteResume): only the author of the route, only
// after new edits; the step that returned it starts over for the new version.
func (s *Service) ResumeRoute(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.DocRoute, error) {
	var out dapi.DocRoute
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, _, err := r.doc(id)
		if err != nil {
			return err
		}
		rd, err := r.loadRoute(ctx, d.id, true)
		if err != nil {
			return err
		}
		if rd == nil || rd.status != routeReturned || rd.back == nil || rd.back.Step >= len(rd.steps) {
			return transition("Документ не на доработке")
		}
		if !r.authorOrOwner(rd) {
			return forbidden(textRouteAuthor)
		}
		if d.version == rd.version {
			return failed(textNeedFixes)
		}
		if err := r.resume(ctx, d, rd); err != nil {
			return err
		}
		out, err = r.routeAnswer(ctx, d)
		return err
	})
	return out, err
}

func (r *req) resume(ctx context.Context, d *document, rd *routeData) error {
	i := rd.back.Step
	if _, err := r.tx.Exec(ctx, `update docs.versions set name = $3 where document_id = $1 and number = $2 and name is null`, d.id, d.version, textVersionFixed); err != nil {
		return fmt.Errorf("docs: name version: %w", err)
	}
	if _, err := r.tx.Exec(ctx, `delete from docs.route_decisions where route_id = $1 and position = $2`, rd.id, i); err != nil {
		return fmt.Errorf("docs: reset decisions: %w", err)
	}
	st := rd.steps[i]
	st.decisions, st.status = nil, stepStatusWait
	rd.version, rd.status, rd.back = d.version, routeActive, nil
	if err := r.saveDoc(ctx, d, statusInRoute, nil); err != nil {
		return err
	}
	d.lock = true
	if err := r.record(ctx, "docs.route.resume", d.id, fmt.Sprintf("Снова на согласовании: v%d с шага «%s»", d.version, st.name), false, nil); err != nil {
		return err
	}
	if _, err := r.publish(ctx, "docs.route.resumed", aggDocument, d.id, map[string]any{keyRouteID: rd.id, keyVersion: rd.version, keyStep: i}); err != nil {
		return err
	}
	if err := r.syncTask(ctx, d, rd, fmt.Sprintf("После доработки: v%d, маршрут продолжен с шага «%s»", d.version, st.name)); err != nil {
		return err
	}
	return r.activate(ctx, d, rd, i)
}

// CancelRoute cancels an active or returned route (cancelDocRoute — docRouteCancel): the author or the owner of the
// business; the temporary accesses are taken back, the mirror task closes.
func (s *Service) CancelRoute(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.DocRoute, error) {
	var out dapi.DocRoute
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, _, err := r.doc(id)
		if err != nil {
			return err
		}
		rd, err := r.loadRoute(ctx, d.id, true)
		if err != nil {
			return err
		}
		if rd == nil || (rd.status != routeActive && rd.status != routeReturned) {
			return transition("Маршрут уже завершён")
		}
		if !r.authorOrOwner(rd) {
			return forbidden(textCancelAuthor)
		}
		if err := r.cancel(ctx, d, rd); err != nil {
			return err
		}
		out, err = r.routeAnswer(ctx, d)
		return err
	})
	return out, err
}

func (r *req) cancel(ctx context.Context, d *document, rd *routeData) error {
	rd.status, rd.rules.Sign = routeCancelled, nil
	if err := r.saveRoute(ctx, rd); err != nil {
		return err
	}
	if err := r.revokeTemps(ctx, d); err != nil {
		return err
	}
	status := d.status
	if status == statusInRoute || status == statusReturned {
		status = statusDraft
	}
	if err := r.saveDoc(ctx, d, status, nil); err != nil {
		return err
	}
	d.lock = false
	if err := r.record(ctx, "docs.route.cancel", d.id, "Маршрут отменён", false, nil); err != nil {
		return err
	}
	if _, err := r.publish(ctx, "docs.route.cancelled", aggDocument, d.id, map[string]any{keyRouteID: rd.id}); err != nil {
		return err
	}
	return r.syncTask(ctx, d, rd, r.me.name+": маршрут отменён")
}

// Ack is the acknowledgement of the addressee (ackDocument — docAck): the version, the time and the device are kept;
// the step is over when everyone has acknowledged.
func (s *Service) Ack(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocAck) (dapi.DocAckResult, error) {
	var out dapi.DocAckResult
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, _, err := r.doc(id)
		if err != nil {
			return err
		}
		rd, err := r.loadRoute(ctx, d.id, true)
		if err != nil {
			return err
		}
		if rd == nil || rd.status != routeActive || rd.step() == nil || rd.step().kind != stepAck {
			return failed(textAckNotAsked)
		}
		st := rd.step()
		if !slices.Contains(st.who, r.me.id) {
			return failed(textAckOthers)
		}
		device := defaultDevice
		if b.Device != nil && strings.TrimSpace(*b.Device) != "" {
			device = clip(strings.TrimSpace(*b.Device), 100)
		}
		if err := r.acknowledge(ctx, d, rd, st, device); err != nil {
			return err
		}
		out = dapi.DocAckResult{Acked: true, At: instant(r.now), Version: int64(rd.version)}
		return nil
	})
	return out, err
}

func (r *req) acknowledge(ctx context.Context, d *document, rd *routeData, st *routeStep, device string) error {
	tag, err := r.tx.Exec(ctx, `insert into docs.acks (document_id, member_id, version, device, at) values ($1, $2, $3, $4, $5)
		on conflict do nothing`, d.id, r.me.id, rd.version, device, r.now)
	if err != nil {
		return fmt.Errorf("docs: ack: %w", err)
	}
	if tag.RowsAffected() > 0 {
		st.acked = append(st.acked, r.me.id)
		if err := r.record(ctx, "docs.ack", d.id, fmt.Sprintf("%s ознакомился с v%d · %s", r.me.name, rd.version, device), false, nil); err != nil {
			return err
		}
		if _, err := r.publish(ctx, "docs.ack.done", aggDocument, d.id, map[string]any{keyRouteID: rd.id, keyVersion: rd.version, "device": device}); err != nil {
			return err
		}
	}
	note := fmt.Sprintf("%s: ознакомлен(а) с v%d", r.me.name, rd.version)
	if len(st.waiting()) == 0 {
		if err := r.syncTask(ctx, d, rd, note); err != nil {
			return err
		}
		return r.advance(ctx, d, rd)
	}
	return r.syncTask(ctx, d, rd, note)
}

// CloseAck ends the acknowledgement early (closeDocAck — docAckClose): the author or the owner of the business; those
// who have not acknowledged stay in the sheet as «не ознакомлен(а)» (Q-W4.00-documents-17).
func (s *Service) CloseAck(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.DocRoute, error) {
	var out dapi.DocRoute
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, _, err := r.doc(id)
		if err != nil {
			return err
		}
		rd, err := r.loadRoute(ctx, d.id, true)
		if err != nil {
			return err
		}
		if rd == nil || rd.status != routeActive {
			return transition(textNotOnRoute)
		}
		if !r.authorOrOwner(rd) {
			return forbidden(textAckCloseRight)
		}
		st := rd.step()
		if st == nil || st.kind != stepAck {
			return transition(textAckNotNow)
		}
		st.closed = true
		if err := r.saveStep(ctx, rd, st); err != nil {
			return err
		}
		done := len(st.acked)
		if err := r.record(ctx, "docs.ack.close", d.id, fmt.Sprintf("Ознакомление завершено: %d из %d", done, len(st.who)), false, nil); err != nil {
			return err
		}
		if _, err := r.publish(ctx, "docs.ack.closed", aggDocument, d.id, map[string]any{keyRouteID: rd.id, "done": done, "of": len(st.who)}); err != nil {
			return err
		}
		if err := r.advance(ctx, d, rd); err != nil {
			return err
		}
		out, err = r.routeAnswer(ctx, d)
		return err
	})
	return out, err
}

// RequestSignCode asks the second confirmation of a signature (requestDocSignCode — docSignStart): the repeated sign-in
// or a code through the delivery port. Without a provider the answer is dependency_unavailable (D-31).
func (s *Service) RequestSignCode(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocSignCodeRequest) (dapi.DocSignChallenge, error) {
	var out dapi.DocSignChallenge
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		rd, err := r.signRoute(ctx, d, rt)
		if err != nil {
			return err
		}
		if r.s.Signer == nil {
			return problem.New(problem.CodeDependencyUnavailable, "Подтверждение подписи подключается")
		}
		method, code, sentTo := string(b.Method), "", ""
		if method == methodPEPSMS {
			code = signCode(r.s.linkKey(), rd.id, r.me.id, int(r.now.UnixNano()&0x7fffffffffffffff))
			if sentTo, err = r.s.Signer.SendCode(ctx, r.tc.TenantID, r.me.id, code); err != nil {
				if errors.Is(err, ErrNoDelivery) {
					return problem.Wrap(problem.CodeDependencyUnavailable, err)
				}
				return fmt.Errorf("docs: sign code: %w", err)
			}
		}
		ch := newChallenge(r.s.linkKey(), rd.id, r.me.id, method, code, r.now)
		rd.rules.Sign = ch.marshal()
		if err := r.saveRoute(ctx, rd); err != nil {
			return err
		}
		if err := r.record(ctx, "docs.route.sign.request", d.id, "Запрошено подтверждение подписи: "+method, true, nil); err != nil {
			return err
		}
		out = dapi.DocSignChallenge{Method: dapi.DocSignChallengeMethod(method), ExpiresAt: instant(ch.expires), AttemptsLeft: signTries}
		if sentTo != "" {
			out.SentTo = &sentTo
		}
		return nil
	})
	return out, err
}

// signRoute is the active route whose current step the member signs: the step «Утвердить» waits for him, he is not the
// author of the route unless the rule is off, and he holds the right to sign.
func (r *req) signRoute(ctx context.Context, d *document, rt rights) (*routeData, error) {
	rd, err := r.activeRoute(ctx, d)
	if err != nil {
		return nil, err
	}
	if st := rd.step(); st.kind != stepSign || !slices.Contains(st.waiting(), r.me.id) {
		return nil, forbidden("Сейчас ваша подпись не нужна")
	}
	if rd.rules.NotAuthor && r.me.id == rd.startedBy {
		return nil, separation("Автор не подписывает свой документ")
	}
	if !rt.sign {
		return nil, forbidden("Нет права «Документы · Утверждать»")
	}
	return rd, nil
}

// ConfirmSign signs (confirmDocSign — docSign): the challenge must be asked and alive, three wrong tries close it
// (429), a right one approves the document, freezes its fields and queues the PDF/A copy with the approval sheet.
func (s *Service) ConfirmSign(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocSignConfirm) (dapi.DocSignResult, error) {
	var (
		out     dapi.DocSignResult
		refusal error
	)
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		rd, err := r.signRoute(ctx, d, rt)
		if err != nil {
			return err
		}
		ch, err := r.liveChallenge(rd, string(b.Method))
		if err != nil {
			return err
		}
		good, err := r.verifySign(ctx, rd, ch, b)
		if err != nil {
			return err
		}
		if !good {
			// the wrong try is kept: the transaction commits, the answer is the refusal
			ch.tries++
			rd.rules.Sign = ch.marshal()
			if err := r.saveRoute(ctx, rd); err != nil {
				return err
			}
			if err := r.record(ctx, "docs.route.sign.refused", d.id, fmt.Sprintf("Неверное подтверждение подписи: попытка %d", ch.tries), true, nil); err != nil {
				return err
			}
			refusal = problem.New(codeSignInvalid, fmt.Sprintf("Неверный код. Осталось попыток: %d", signTries-ch.tries))
			return nil
		}
		rd.rules.Sign = nil
		st := rd.step()
		if err := r.addDecision(ctx, rd, st, decision{member: r.me.id, kind: decisionOK, method: string(b.Method)}); err != nil {
			return err
		}
		if err := r.syncTask(ctx, d, rd, fmt.Sprintf("%s: утвердил(а) v%d · ПЭП", r.me.name, rd.version)); err != nil {
			return err
		}
		if err := r.advance(ctx, d, rd); err != nil {
			return err
		}
		out = dapi.DocSignResult{Status: dapi.DocSignResultStatus(d.status), SignedAt: instant(r.now)}
		return nil
	})
	if err == nil && refusal != nil {
		err = refusal
	}
	return out, err
}

// liveChallenge is the challenge the member asked: «Сначала запросите код» without one, expired, used up (429) or
// asked by another method.
func (r *req) liveChallenge(rd *routeData, method string) (challenge, error) {
	ch, ok := parseChallenge(rd.rules.Sign)
	switch {
	case !ok || ch.member != r.me.id:
		return ch, failed("Сначала запросите код")
	case r.now.After(ch.expires):
		return ch, failed("Код устарел — запросите новый")
	case ch.tries >= signTries:
		return ch, problem.New(codeRateLimited, "Попытки закончились — запросите новый код")
	case ch.method != method:
		return ch, failed("Подтверждение запрошено другим способом")
	}
	return ch, nil
}

// verifySign checks the second confirmation: the code of the SMS by its digest, the repeated sign-in by the signer.
func (r *req) verifySign(ctx context.Context, rd *routeData, ch challenge, b dapi.DocSignConfirm) (bool, error) {
	if ch.method == methodPEPSMS {
		code := ""
		if b.Code != nil {
			code = *b.Code
		}
		return ch.matches(r.s.linkKey(), rd.id, r.me.id, code), nil
	}
	if r.s.Signer == nil {
		return false, problem.New(problem.CodeDependencyUnavailable, "Подтверждение подписи подключается")
	}
	password, totp := "", ""
	if b.Password != nil {
		password = *b.Password
	}
	if b.Totp != nil {
		totp = *b.Totp
	}
	ok, err := r.s.Signer.ConfirmLogin(ctx, r.tc.TenantID, r.me.id, password, totp)
	if err != nil {
		return false, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return ok, nil
}
