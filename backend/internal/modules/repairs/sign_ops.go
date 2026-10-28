package repairs

import (
	"context"
	"crypto/rand"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// CodeSender is the port of the delivery of the code of a signature to the phone of the client (D-31): the provider of
// SMS is not chosen yet, a stub stands in. The code is never returned by the API.
type CodeSender interface {
	SendSignCode(ctx context.Context, phone, code string, expires time.Time) error
}

// LogCodes is the stub of the port for a stand: the code goes to the log of the server — the inbox of the developer.
// A real provider replaces it before production; the phone is masked, the code is only for the stand.
type LogCodes struct{ Log *slog.Logger }

// SendSignCode writes the code to the log.
func (l LogCodes) SendSignCode(ctx context.Context, phone, code string, expires time.Time) error {
	log := l.Log
	if log == nil {
		log = slog.Default()
	}
	log.InfoContext(ctx, "repairs: code of the signature (stub of the SMS port)", "phone", maskPhone(phone), "code", code, "expires", expires.UTC().Format(time.RFC3339))
	return nil
}

var processKey = sync.OnceValue(func() []byte {
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		panic("repairs: no randomness for the key of the signatures: " + err.Error()) // the process cannot sign anything without it
	}
	return k
})

// signKey is the key the codes are hashed with: the configured one, else a key of this process (the codes live ten
// minutes, a restart only asks the client for a new one).
func (s *Service) signKey() []byte {
	if len(s.SignKey) > 0 {
		return s.SignKey
	}
	return processKey()
}

// Texts of the signature (the prototype and the contract: «Ремонт и стройка.dc.html» «Документы»).
const (
	textNeedSend      = "Нужно право «Отправлять документы на подпись»."
	textDocNotFound   = "Документ не найден."
	textDocState      = "Документ не в том состоянии для запроса подписи."
	textDocNoCode     = "Документ не ждёт подписи по коду."
	textClientPhone   = "Укажите телефон заказчика: код подписи отправляется ему."
	textCodeExpired   = "Срок кода истёк — запросите новый."
	textCodeTooMany   = "Слишком много попыток — запросите новый код."
	textCodeWrong     = "Код не совпал."
	textCannotApprove = "Версию нельзя согласовать: она не отправлена заказчику или это допсоглашение (его подписывают кодом из SMS)."
	textNoDelivery    = "Доставка кода подписи не настроена."
	reasonCodeInvalid = "sms_code_invalid"
	reasonCodeExpired = "sms_code_expired"
	fieldSMSCode      = "smsCode"
)

// docRow is a document of an object (repairs.documents).
type docRow struct {
	id, project      uuid.UUID
	kind, title      string
	state            string
	version, act     *int
	amount           *int64
	hash             *string
	expires          *time.Time
	attempts         int
	sentAt, signedAt *time.Time
}

const docCols = `id, project_id, kind, title, state, estimate_version, act_no, amount_minor, sign_code_hash, sign_code_expires_at, sign_attempts, sent_at, signed_at`

func (d *docRow) scan(row interface{ Scan(...any) error }) error {
	return row.Scan(&d.id, &d.project, &d.kind, &d.title, &d.state, &d.version, &d.act, &d.amount, &d.hash, &d.expires, &d.attempts, &d.sentAt, &d.signedAt)
}

func (r *req) document(ctx context.Context, id uuid.UUID, lock bool) (*docRow, error) {
	q := `select ` + docCols + ` from repairs.documents where id = $1`
	if lock {
		q += ` for update`
	}
	d := &docRow{}
	if err := d.scan(r.tx.QueryRow(ctx, q, id)); err != nil {
		if noRows(err) {
			return nil, nil
		}
		return nil, store("document", err)
	}
	return d, nil
}

// docOut is a document; the amount is for those who read the finance of the object (the client reads it too).
func docOut(d *docRow, finance bool) rapi.RepairDocument {
	out := rapi.RepairDocument{Id: d.id, ProjectId: d.project, Kind: rapi.RepairDocumentKind(d.kind), Title: d.title, State: rapi.RepairDocumentState(d.state),
		EstimateVersion: d.version, ActNo: d.act, SentAt: d.sentAt, SignedAt: d.signedAt}
	if finance && d.amount != nil {
		out.Amount = new(moneyOut(*d.amount))
	}
	return out
}

// RequestSignature answers requestDocumentSignature: the code from SMS goes to the client and the document waits for it.
// A draft or a document that waits for the signature may be sent; one that already has a code gets a new code (the old
// one stops working, the attempts start again); a signed or paid document is not sent again.
func (s *Service) RequestSignature(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (rapi.RepairSignRequestResult, error) {
	var out rapi.RepairSignRequestResult
	err := s.run(ctx, tc, true, func(r *req) error {
		d, err := r.document(ctx, id, true)
		if err != nil {
			return err
		}
		if d == nil {
			return notFound(textDocNotFound)
		}
		p, err := r.visibleProject(ctx, d.project, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actDocSend, textNeedSend); err != nil {
			return err
		}
		if !slices.Contains([]string{"draft", "wait", "sms"}, d.state) {
			return conflict(reasonDocumentState, textDocState)
		}
		expires, err := s.mintCode(ctx, r, p, d)
		if err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evSignRequested, "на подпись отправлен документ: "+truncate(d.title, 200)); err != nil {
			return err
		}
		fresh, err := r.document(ctx, d.id, false)
		if err != nil {
			return err
		}
		finance, err := r.can(ctx, p, actFinance)
		if err != nil {
			return err
		}
		out = rapi.RepairSignRequestResult{Document: docOut(fresh, finance), CodeExpiresAt: expires, DeliveredTo: maskPhone(*p.clientPhone)}
		return nil
	})
	return out, err
}

// mintCode draws a code, keeps its hash with the document (the attempts start again) and sends it to the phone of the
// client through the port. A failed delivery fails the request: the transaction is rolled back and nothing is kept.
func (s *Service) mintCode(ctx context.Context, r *req, p *projectRow, d *docRow) (time.Time, error) {
	if p.clientPhone == nil || strings.TrimSpace(*p.clientPhone) == "" {
		return time.Time{}, invalid("clientPhone", textClientPhone, "required")
	}
	if s.Codes == nil {
		return time.Time{}, problem.New(problem.CodeDependencyUnavailable, textNoDelivery)
	}
	code, err := newSignCode(rand.Reader)
	if err != nil {
		return time.Time{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	expires := r.now.Add(signTTLMinutes * time.Minute)
	if _, err := r.tx.Exec(ctx, `update repairs.documents set state = 'sms', sign_code_hash = $2, sign_code_expires_at = $3, sign_attempts = 0, signer_phone_hash = $4,
		sent_at = $5, revision = revision + 1 where id = $1`, d.id, signHash(s.signKey(), d.id, code), expires, signHash(s.signKey(), uuid.Nil, "phone:"+*p.clientPhone), r.now); err != nil {
		return time.Time{}, store("request signature", err)
	}
	if err := s.Codes.SendSignCode(ctx, *p.clientPhone, code, expires); err != nil {
		return time.Time{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return expires, nil
}

// SignDocument is the entry of the code from SMS into the cabinet of the client (the public route of W6.15 resolves the
// organization and the object by the link and calls it): the right code signs the document; an agreement puts its
// version of the estimate into force. A wrong code is counted (the count is kept although the answer is a refusal) and
// the fifth puts the code out; an expired one is refused until a new one is asked.
func (s *Service) SignDocument(ctx context.Context, tc tenantctx.TenantContext, project, id uuid.UUID, code string) (rapi.RepairDocument, error) {
	var (
		out    rapi.RepairDocument
		refuse *failure
	)
	err := s.run(ctx, tc, true, func(r *req) error {
		d, err := r.document(ctx, id, true)
		if err != nil {
			return err
		}
		if d == nil || d.project != project {
			return notFound(textDocNotFound)
		}
		p, err := r.project(ctx, project, true)
		if err != nil {
			return err
		}
		if p == nil {
			return notFound(textObjectNotFound)
		}
		if refuse, err = s.checkCode(ctx, r, d, code); err != nil || refuse != nil {
			return err
		}
		if out, err = r.signed(ctx, p, d); err != nil {
			return err
		}
		return nil
	})
	if err == nil && refuse != nil {
		return out, refuse
	}
	return out, err
}

// checkCode checks the code against the document: a refusal (nil if the code is right) or an error. A wrong code is
// counted in the transaction, which the caller commits.
func (s *Service) checkCode(ctx context.Context, r *req, d *docRow, code string) (*failure, error) {
	switch {
	case d.state != "sms":
		return nil, conflict(reasonDocumentState, textDocNoCode)
	case d.expires == nil || !d.expires.After(r.now):
		return codeFailure(textCodeExpired, "expired", reasonCodeExpired), nil
	case signMatches(s.signKey(), d.id, strings.TrimSpace(code), deref(d.hash)):
		return nil, nil
	}
	return r.wrongCode(ctx, d)
}

// signed signs the document; an agreement puts its version of the estimate into force.
func (r *req) signed(ctx context.Context, p *projectRow, d *docRow) (rapi.RepairDocument, error) {
	if _, err := r.tx.Exec(ctx, `update repairs.documents set state = 'signed', signed_at = $2, sign_code_hash = null, sign_code_expires_at = null, sign_attempts = 0,
		revision = revision + 1 where id = $1`, d.id, r.now); err != nil {
		return rapi.RepairDocument{}, store("sign document", err)
	}
	if err := r.event(ctx, p.id, evDocumentSigned, "заказчик подписал: "+truncate(d.title, 200)); err != nil {
		return rapi.RepairDocument{}, err
	}
	if d.kind == docAgreement && d.version != nil {
		e, err := r.estimate(ctx, p.id, *d.version)
		if err != nil {
			return rapi.RepairDocument{}, err
		}
		if e != nil && e.state == stateSent {
			if err := r.approve(ctx, p, e); err != nil {
				return rapi.RepairDocument{}, err
			}
		}
	}
	fresh, err := r.document(ctx, d.id, false)
	if err != nil {
		return rapi.RepairDocument{}, err
	}
	return docOut(fresh, true), nil
}
func codeFailure(text, code, reason string) *failure {
	f := invalid(fieldSMSCode, text, code)
	f.reason = reason
	return f
}

// wrongCode counts a wrong code; the fifth puts the code out and returns the document to «ждёт подписи».
func (r *req) wrongCode(ctx context.Context, d *docRow) (*failure, error) {
	if d.attempts+1 >= signRetries {
		_, err := r.tx.Exec(ctx, `update repairs.documents set state = 'wait', sign_code_hash = null, sign_code_expires_at = null, sign_attempts = 0, revision = revision + 1 where id = $1`, d.id)
		return codeFailure(textCodeTooMany, "expired", reasonCodeExpired), store("put the code out", err)
	}
	_, err := r.tx.Exec(ctx, `update repairs.documents set sign_attempts = sign_attempts + 1 where id = $1`, d.id)
	return codeFailure(textCodeWrong, "invalid", reasonCodeInvalid), store("count the code", err)
}

// ApproveEstimate is the approval of a sent version by the client in the cabinet (the public route of W6.15 resolves the
// organization and the object by the link and calls it). An additional agreement is not approved this way: the client
// signs it with the code (SignDocument).
func (s *Service) ApproveEstimate(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID, version int) (rapi.Estimate, error) {
	var out rapi.Estimate
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.project(ctx, project, true)
		if err != nil {
			return err
		}
		if p == nil {
			return notFound(textObjectNotFound)
		}
		e, err := r.estimateOr404(ctx, p.id, version)
		if err != nil {
			return err
		}
		if e.state != stateSent || e.kind == kindChange {
			return conflict("", textCannotApprove)
		}
		if err := r.approve(ctx, p, e); err != nil {
			return err
		}
		out, err = r.estimateOut(ctx, e)
		return err
	})
	return out, err
}

// approve puts a sent version into force: the one before it is replaced, the contract sum becomes its total, the change
// orders of an agreement are signed and become works of the foreman.
func (r *req) approve(ctx context.Context, p *projectRow, e *estRow) error {
	lines, err := r.lines(ctx, e.id)
	if err != nil {
		return err
	}
	total, ok := totalOf(lines, e.discount)
	if !ok {
		return invalid("lines", textTotalTooBig, "max")
	}
	if _, err := r.tx.Exec(ctx, `update repairs.estimates set state = 'replaced', revision = revision + 1 where project_id = $1 and state = 'approved'`, p.id); err != nil {
		return store("replace the version in force", err)
	}
	if _, err := r.tx.Exec(ctx, `update repairs.estimates set state = 'approved', approved_at = $2, revision = revision + 1 where id = $1`, e.id, r.now); err != nil {
		return store("approve estimate", err)
	}
	e.state, e.approvedAt = stateApproved, new(r.now)
	e.revision++
	if _, err := r.tx.Exec(ctx, `update repairs.projects set budget_minor = $2, revision = revision + 1, updated_at = $3 where id = $1`, p.id, total, r.now); err != nil {
		return store("contract sum", err)
	}
	if err := r.signChanges(ctx, p, e); err != nil {
		return err
	}
	text := "версия " + strconv.Itoa(e.version) + " сметы согласована"
	if e.agreementNo != nil {
		text = "подписано допсоглашение № " + strconv.Itoa(*e.agreementNo) + ": версия " + strconv.Itoa(e.version) + " сметы действует"
	}
	return r.event(ctx, p.id, evEstimateApproved, text)
}

// signChanges signs the change orders of an agreement and adds a work to the object for each of them.
func (r *req) signChanges(ctx context.Context, p *projectRow, e *estRow) error {
	if len(e.changes) == 0 {
		return nil
	}
	rows, err := r.tx.Query(ctx, `update repairs.change_orders set status = 'signed', estimate_version = $2, revision = revision + 1, updated_at = $3
		where id = any($1) returning seq, title, unit, (quantity * 1000)::bigint`, e.changes, e.version, r.now)
	if err != nil {
		return store("sign change orders", err)
	}
	type work struct {
		seq         int
		title, unit string
		qty         int64
	}
	var ws []work
	for rows.Next() {
		var w work
		if err := rows.Scan(&w.seq, &w.title, &w.unit, &w.qty); err != nil {
			rows.Close()
			return store("sign change orders", err)
		}
		ws = append(ws, w)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return store("sign change orders", err)
	}
	slices.SortFunc(ws, func(a, b work) int { return a.seq - b.seq })
	for _, w := range ws {
		if _, err := r.tx.Exec(ctx, `insert into repairs.works (project_id, name, unit, plan_qty, sort)
			values ($1, left($2, 200), $3, $4::bigint::numeric / 1000, (select coalesce(max(sort), 0) + 1 from repairs.works where project_id = $1))`, p.id, w.title, w.unit, w.qty); err != nil {
			return store("work of a change order", err)
		}
	}
	return nil
}
