package repairs

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Pools reaches the database of a tenant (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Service answers the operations of the tag Repairs of steps 6.1–6.2 (W6.11): objects, the foreman and the crew without
// accounts, the works with the accepted fact, the marks of the foreman and their acceptance.
type Service struct {
	Pools Pools
	Now   func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now

	// Codes delivers the code of a signature by SMS to the phone of the client (D-31, W6.12); nil — a request for a
	// signature is refused with dependency_unavailable. SignKey hashes the codes; empty — a key of the process.
	Codes   CodeSender
	SignKey []byte

	// Links is the control index of the links of the cabinet of the client (control 0010); nil — the cabinet and its
	// links answer dependency_unavailable (W6.15). Offers hands the payouts to the crew to the proposals of the cash
	// desks (W5.31); nil — a payout is refused with dependency_unavailable. PublicBase is the origin of the deployment
	// the address of the cabinet starts with; CrewSharePct is the share of the sum of an act the crew gets (0 — the
	// default of the module, Q-W6.15-1).
	Links        Links
	Offers       PayrollOffers
	PublicBase   string
	CrewSharePct int
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Problem codes of the contract (api/errors.yaml) the module answers.
const (
	codeValidation = "validation_failed"
	codeTransition = "invalid_transition"
	codeRevision   = "revision_mismatch"
	codeForbidden  = problem.CodeForbiddenAction
	codeNotFound   = problem.CodeNotFound
	codeMalformed  = problem.CodeMalformedRequest
)

// Reasons of invalid_transition and validation_failed (api/errors.yaml, W6.00).
const (
	reasonForemanAssigned = "foreman_already_assigned"
	reasonLogReviewed     = "work_log_already_reviewed"
	reasonHandedOver      = "project_handed_over"
	reasonNotDraft        = "repair_project_not_draft"
	reasonNoEstimate      = "repair_estimate_not_approved"
	reasonActNotSigned    = "repair_act_not_signed"
	reasonOverPlan        = "work_volume_exceeds_plan"
)

// violation is a field of a 422 with the code and the text.
type violation struct{ field, code, message string }

// failure is a refusal whose Problem carries more than a code and a detail: the violations of a 422 validation_failed
// or the reason of a 409 (and of the 422 of an excess volume). The strict server writes it as the typed 422 or 409.
type failure struct {
	code, detail, reason string
	violations           []violation
}

func (f *failure) Error() string { return f.code + ": " + f.detail }

// codeInvalid is the code of a violation of a field without its own.
const codeInvalid = "invalid"

// invalid is 422 validation_failed with one violation of field (code invalid unless given).
func invalid(field, message string, code ...string) *failure {
	c := codeInvalid
	if len(code) > 0 {
		c = code[0]
	}
	return &failure{code: codeValidation, detail: message, violations: []violation{{field, c, message}}}
}

// conflict is 409 invalid_transition with a reason and the text.
func conflict(reason, detail string) *failure {
	return &failure{code: codeTransition, detail: detail, reason: reason}
}

func forbidden(detail string) error { return problem.New(codeForbidden, detail) }
func notFound(detail string) error  { return problem.New(codeNotFound, detail) }
func malformed(detail string) error { return problem.New(codeMalformed, detail) }

func asFailure(err error) (*failure, bool) { return errors.AsType[*failure](err) }

// dependency keeps a failure or a Problem error and reports anything else as dependency_unavailable.
func dependency(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := asFailure(err); ok {
		return err
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// store wraps a failure of a statement of the module.
func store(what string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("repairs: %s: %w", what, err)
}

func noRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// run runs fn in one transaction of the tenant DB of tc (read only unless write); an error rolls it back, a failure or
// a Problem error keeps its code and anything else is dependency_unavailable.
func (s *Service) run(ctx context.Context, tc tenantctx.TenantContext, write bool, fn func(*req) error) error {
	if tc.TenantID == uuid.Nil {
		return problem.New(codeNotFound, "")
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	opts := pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}
	if write {
		opts = pgx.TxOptions{}
	}
	tx, err := pool.BeginTx(ctx, opts)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	if err := fn(&req{s: s, tc: tc, tx: tx, now: s.now()}); err != nil {
		return dependency(err)
	}
	return dependency(tx.Commit(ctx))
}

// etag is the entity tag of a revision.
func etag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

// checkRev requires If-Match to name the revision current ("rev-N", quoted or not): 412 revision_mismatch.
func checkRev(ifMatch string, current int64, text string) error {
	tag := strings.Trim(strings.TrimPrefix(strings.TrimSpace(ifMatch), "W/"), `"`)
	if n, err := strconv.ParseInt(strings.TrimPrefix(tag, "rev-"), 10, 64); err != nil || n != current || !strings.HasPrefix(tag, "rev-") {
		return problem.New(codeRevision, text)
	}
	return nil
}

// Texts of the refusals (the prototype api.js:899–942 and its MSW port).
const (
	textObjectChanged    = "Объект уже изменили — обновите страницу"
	textLogChanged       = "Отметку уже изменили — обновите страницу"
	textObjectNotFound   = "Объект не найден."
	textLogNotFound      = "Отметка не найдена."
	textUnitMissing      = "Подразделения нет в организации."
	textMemberMissing    = "Сотрудника нет в организации."
	textNeedReview       = "Нужно право «Принимать объём»."
	textForemanOnly      = "Отметку по объекту отправляет его прораб."
	textLogReviewed      = "Отметка уже обработана."
	textHandedOver       = "Объект сдан: новые отметки не принимаются."
	textHandedOverEdit   = "Объект сдан: изменения не принимаются."
	textLeadHasObject    = "По заявке уже есть объект."
	textDraftNoForeman   = "Объект-черновик: прораб назначается после договора."
	textOnlyDraft        = "Активировать можно только объект-черновик."
	textNoApproved       = "Нет согласованной версии сметы: объект не активируется."
	textActNotSigned     = "Акт сдачи не подписан заказчиком."
	textActMissing       = "Акт сдачи объекта не найден."
	textNameShort        = "Введите название объекта."
	textWorkPick         = "Выберите работу этого объекта."
	textQtyPositive      = "Объём должен быть больше нуля."
	textCrewPick         = "Отметьте работников."
	textPhotoPick        = "Добавьте хотя бы одно фото."
	textPhotoUnknown     = "Файл фото не найден: загрузите его заново."
	textZoneUnknown      = "Неизвестный часовой пояс."
	textDateFuture       = "Дата отметки не может быть в будущем."
	textHandedOverReview = "Объект сдан: приёмка и возврат отметок закрыты."
	textMaterialMissing  = "Материала нет в справочнике."
	textReasonRequired   = "Укажите причину возврата."
	textLinesRequired    = "Добавьте хотя бы одну работу."
	textUnknownFilter    = "Неизвестный фильтр."
	textUnknownStatus    = "Неизвестный статус отметки."
	textBadCursor        = "Неверный курсор."
)
