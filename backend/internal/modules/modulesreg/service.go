package modulesreg

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	modulesapi "github.com/ortus/ortus-crm/backend/internal/api/modules"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Querier reads a tenant DB (a pgx pool, connection or transaction).
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Change is one change of a row of modules.installations, applied in one transaction with its audit record and,
// when the state changes, policy_version + 1 (tenant 0001: «+1 при любом изменении … модулей»).
type Change struct {
	Key, StoredKey  string    // contract key; module_key of the row (the contract key for a new row)
	From            int64     // revision the change is based on (revisionNone: no row yet)
	State, Retained string    // new state and retained access
	Settings        []byte    // nil: unchanged
	ActorID         uuid.UUID // person; uuid.Nil: the service (draining settled)
	Action, Reason  string    // audit.events action and the reason of the owner
	PolicyChange    bool      // the state changes: policy_version + 1
}

// ErrConflict: the row changed between the read and the write (revision race or a concurrent insert).
var ErrConflict = errors.New("modulesreg: installation changed concurrently")

// Store reads and writes modules.installations of a tenant DB.
type Store interface {
	Installations(ctx context.Context, tenantID uuid.UUID) (map[string]Installation, error)
	Apply(ctx context.Context, tenantID uuid.UUID, ch Change) (Installation, error)
	Querier(ctx context.Context, tenantID uuid.UUID) (Querier, error)
}

// revisionNone is the revision of a module without a row: manifests start at 1, the first change writes 2 (MSW).
const revisionNone = 1

// previewLimit is the number of listed items of a deactivation preview (ModuleDeactivationPreview.activeItems).
const previewLimit = 50

// Audit actions of the registry (audit.events, target type module).
const (
	ActionEnable   = "modules.module.enable"
	ActionDisable  = "modules.module.disable"
	ActionDrained  = "modules.module.drained"
	ActionSettings = "modules.settings.update"
)

const (
	codeModuleNotInstalled = "module_not_installed"
	codeModuleReadOnly     = "module_read_only"
	codeRevisionMismatch   = "revision_mismatch"
	codeValidationFailed   = "validation_failed"
	maxReason              = 500
)

// Update is the desired state of setModuleInstallation.
type Update struct {
	Enabled  bool
	Retained string // "": history_read
	Reason   string
}

// Settings is the typed settings document of a module and the revision it was read at.
type Settings struct {
	Body     []byte // JSON of ModuleSettings
	Revision int64
}

// Service is the module registry of tenants.
type Service struct {
	Store    Store
	Activity *Registry
	Now      func() time.Time
}

// dependency maps a store failure to dependency_unavailable; Problem errors pass as they are.
func dependency(err error) error {
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

func notFound() error { return problem.New(problem.CodeNotFound, "Модуль не найден.") }

func moduleName(key string) string {
	if m, ok := Manifest(key, StateUninstalled, revisionNone); ok {
		return m.Name
	}
	return key
}

func notInstalled(key string) error {
	return problem.New(codeModuleNotInstalled, "Модуль «"+moduleName(key)+"» не подключён организацией.")
}

func finalState(retained string) string {
	if retained == RetainExport {
		return StateDisabled
	}
	return StateReadOnly
}

// Installations returns the installations of a tenant keyed by contract key; a draining module without started
// processes is settled into its final state first.
func (s *Service) Installations(ctx context.Context, tenantID uuid.UUID) (map[string]Installation, error) {
	inst, err := s.Store.Installations(ctx, tenantID)
	if err != nil {
		return nil, dependency(err)
	}
	for key, in := range inst {
		if in.State != StateDraining {
			continue
		}
		if inst[key], err = s.settle(ctx, tenantID, in); err != nil {
			return nil, err
		}
	}
	return inst, nil
}

// settle ends the draining of in when no started process is left (actor: the service).
func (s *Service) settle(ctx context.Context, tenantID uuid.UUID, in Installation) (Installation, error) {
	started, err := s.started(ctx, tenantID, in.Key)
	if err != nil || started {
		return in, err
	}
	next, err := s.Store.Apply(ctx, tenantID, Change{
		Key: in.Key, StoredKey: in.StoredKey, From: in.Revision, State: finalState(in.RetainedAccess),
		Retained: in.RetainedAccess, Action: ActionDrained, PolicyChange: true,
	})
	if errors.Is(err, ErrConflict) { // settled or changed by another request: take what is stored now
		cur, err := s.Store.Installations(ctx, tenantID)
		if err != nil {
			return in, dependency(err)
		}
		return cur[in.Key], nil
	}
	if err != nil {
		return in, dependency(err)
	}
	return next, nil
}

func (s *Service) started(ctx context.Context, tenantID uuid.UUID, key string) (bool, error) {
	act := s.Activity.of(key)
	if act == nil {
		return false, nil
	}
	q, err := s.Store.Querier(ctx, tenantID)
	if err != nil {
		return false, dependency(err)
	}
	started, err := act.Started(ctx, q)
	if err != nil {
		return false, dependency(err)
	}
	return started, nil
}

// current returns the state, revision and stored key of an installable module (uninstalled: no row).
func current(inst map[string]Installation, key string) (Installation, bool) {
	in, ok := inst[key]
	if !ok {
		return Installation{Key: key, StoredKey: key, State: StateUninstalled, Revision: revisionNone}, false
	}
	return in, true
}

// Catalog returns the manifests of the installable modules (listModuleCatalog).
func (s *Service) Catalog(ctx context.Context, tenantID uuid.UUID) ([]modulesapi.ModuleManifest, error) {
	inst, err := s.Installations(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make([]modulesapi.ModuleManifest, 0, len(installable))
	for _, key := range InstallableKeys() {
		in, _ := current(inst, key)
		m, _ := Manifest(key, in.State, in.Revision)
		out = append(out, m)
	}
	return out, nil
}

// Get returns the manifest of one installable module (getModuleInstallation).
func (s *Service) Get(ctx context.Context, tenantID uuid.UUID, key string) (modulesapi.ModuleManifest, error) {
	if !IsInstallable(key) {
		return modulesapi.ModuleManifest{}, notFound()
	}
	inst, err := s.Installations(ctx, tenantID)
	if err != nil {
		return modulesapi.ModuleManifest{}, err
	}
	in, _ := current(inst, key)
	m, _ := Manifest(key, in.State, in.Revision)
	return m, nil
}

var etagRE = regexp.MustCompile(`^"(?:rev-)?([1-9][0-9]{0,17})"$`)

// parseIfMatch reads a strong ETag "rev-N" (also "N"); anything else is malformed_request.
func parseIfMatch(raw string) (int64, error) {
	m := etagRE.FindStringSubmatch(raw)
	if m == nil {
		return 0, problem.New(problem.CodeMalformedRequest, "If-Match: нужен ETag последнего ответа.")
	}
	n, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return 0, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	return n, nil
}

func revisionMismatch() error {
	return problem.New(codeRevisionMismatch, "Состояние модуля уже изменили. Обновите и повторите.")
}

// ETag is the strong entity tag of a revision ("rev-N", as MSW W0.13).
func ETag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

func validateUpdate(u Update) error {
	switch {
	case u.Retained != "" && u.Retained != RetainHistory && u.Retained != RetainExport:
		return problem.New(codeValidationFailed, "retainedAccess: history_read или owner_export.")
	case utf8.RuneCountInString(u.Reason) > maxReason:
		return problem.New(codeValidationFailed, "Причина — не длиннее 500 символов.")
	}
	return nil
}

// Set applies the desired state of setModuleInstallation (tenant-owner: the gateway checked it).
func (s *Service) Set(ctx context.Context, tc tenantctx.TenantContext, key string, u Update, ifMatch string) (modulesapi.ModuleManifest, error) {
	switch {
	case isCore(key):
		return modulesapi.ModuleManifest{}, problem.New(codeValidationFailed, "Модули ядра подключены всегда.")
	case !IsInstallable(key):
		return modulesapi.ModuleManifest{}, notFound()
	}
	want, err := parseIfMatch(ifMatch)
	if err != nil {
		return modulesapi.ModuleManifest{}, err
	}
	if err := validateUpdate(u); err != nil {
		return modulesapi.ModuleManifest{}, err
	}
	inst, err := s.Installations(ctx, tc.TenantID)
	if err != nil {
		return modulesapi.ModuleManifest{}, err
	}
	cur, _ := current(inst, key)
	if want != cur.Revision {
		return modulesapi.ModuleManifest{}, revisionMismatch()
	}
	ch, err := s.target(ctx, tc.TenantID, cur, u)
	if err != nil {
		return modulesapi.ModuleManifest{}, err
	}
	if ch.State == cur.State && ch.Retained == cur.RetainedAccess {
		m, _ := Manifest(key, cur.State, cur.Revision)
		return m, nil
	}
	ch.ActorID, ch.Reason, ch.PolicyChange = tc.PersonID, u.Reason, ch.State != cur.State
	next, err := s.Store.Apply(ctx, tc.TenantID, ch)
	switch {
	case errors.Is(err, ErrConflict):
		return modulesapi.ModuleManifest{}, revisionMismatch()
	case err != nil:
		return modulesapi.ModuleManifest{}, dependency(err)
	}
	m, _ := Manifest(key, next.State, next.Revision)
	return m, nil
}

// target is the change that brings cur to the desired state u (no change: the same state and retained access).
func (s *Service) target(ctx context.Context, tenantID uuid.UUID, cur Installation, u Update) (Change, error) {
	ch := Change{Key: cur.Key, StoredKey: cur.StoredKey, From: cur.Revision, State: cur.State, Retained: cur.RetainedAccess}
	if u.Enabled {
		if cur.State == StateActive { // already enabled
			return ch, nil
		}
		ch.State, ch.Action = StateActive, ActionEnable
		if ch.Retained == "" {
			ch.Retained = RetainHistory
		}
		return ch, nil
	}
	if cur.State == StateUninstalled { // nothing to disable
		return ch, nil
	}
	ch.Action, ch.Retained = ActionDisable, u.Retained
	if ch.Retained == "" {
		ch.Retained = RetainHistory
	}
	ch.State = finalState(ch.Retained)
	if cur.State == StateActive || cur.State == StateDraining {
		started, err := s.started(ctx, tenantID, cur.Key)
		if err != nil {
			return Change{}, err
		}
		if started {
			ch.State = StateDraining
		}
	}
	return ch, nil
}

// Preview lists what disabling a module affects now (previewModuleDeactivation).
func (s *Service) Preview(ctx context.Context, tenantID uuid.UUID, key string) (modulesapi.ModuleDeactivationPreview, error) {
	if !IsInstallable(key) {
		return modulesapi.ModuleDeactivationPreview{}, notFound()
	}
	inst, err := s.Installations(ctx, tenantID)
	if err != nil {
		return modulesapi.ModuleDeactivationPreview{}, err
	}
	if in, _ := current(inst, key); in.State != StateActive && in.State != StateDraining {
		return modulesapi.ModuleDeactivationPreview{}, notInstalled(key)
	}
	p := modulesapi.ModuleDeactivationPreview{
		ModuleKey: key, RetainedAccess: RetainHistory, ActiveItems: []modulesapi.ModuleDeactivationItem{},
		GeneratedAt: s.Now().UTC(),
	}
	act := s.Activity.of(key)
	if act == nil {
		return p, nil
	}
	q, err := s.Store.Querier(ctx, tenantID)
	if err != nil {
		return modulesapi.ModuleDeactivationPreview{}, dependency(err)
	}
	items, total, err := act.Items(ctx, q, previewLimit)
	if err != nil {
		return modulesapi.ModuleDeactivationPreview{}, dependency(err)
	}
	for _, it := range items {
		item := modulesapi.ModuleDeactivationItem{
			Kind: modulesapi.ModuleDeactivationItemKind(it.Kind), Title: it.Title, State: it.State,
			Object: modulesapi.ObjectRef{EntityType: it.EntityType, EntityId: it.EntityID},
			Effect: modulesapi.ModuleDeactivationItemEffect(it.Effect),
		}
		if it.Assignee != "" {
			item.AssigneeName = &it.Assignee
		}
		p.ActiveItems = append(p.ActiveItems, item)
	}
	p.HiddenCount = max(total-int64(len(items)), 0)
	return p, nil
}
