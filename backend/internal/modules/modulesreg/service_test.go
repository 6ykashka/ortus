package modulesreg

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"testing"
	"time"

	"github.com/google/uuid"

	modulesapi "github.com/ortus/ortus-crm/backend/internal/api/modules"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var (
	tenantA  = uuid.MustParse("6c1e52c4-1a51-5a8e-9a4c-0f2f1ab0a001")
	ownerA   = uuid.MustParse("6c1e52c4-1a51-5a8e-9a4c-0f2f1ab0a0ff")
	seedNow  = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	ownerCtx = tenantctx.TenantContext{TenantID: tenantA, PersonID: ownerA, Owner: true}
)

// fakeStore keeps installations in memory and records the applied changes.
type fakeStore struct {
	rows    map[string]Installation // by contract key
	changes []Change
	err     error // returned by every call
	race    bool  // Apply answers ErrConflict
}

func newStore(rows ...Installation) *fakeStore {
	s := &fakeStore{rows: map[string]Installation{}}
	for _, r := range rows {
		s.rows[r.Key] = r
	}
	return s
}

func (s *fakeStore) Installations(context.Context, uuid.UUID) (map[string]Installation, error) {
	if s.err != nil {
		return nil, s.err
	}
	return maps.Clone(s.rows), nil
}

func (s *fakeStore) Apply(_ context.Context, _ uuid.UUID, ch Change) (Installation, error) {
	if s.err != nil {
		return Installation{}, s.err
	}
	cur, ok := s.rows[ch.Key]
	rev := int64(revisionNone)
	if ok {
		rev = cur.Revision
	}
	if s.race || ch.From != rev {
		return Installation{}, ErrConflict
	}
	next := Installation{Key: ch.Key, StoredKey: ch.StoredKey, State: ch.State, RetainedAccess: ch.Retained,
		Revision: rev + 1, Settings: cur.Settings}
	if ch.Settings != nil {
		next.Settings = ch.Settings
	}
	s.rows[ch.Key] = next
	s.changes = append(s.changes, ch)
	return next, nil
}

func (s *fakeStore) Querier(context.Context, uuid.UUID) (Querier, error) { return nil, s.err }

// fakeActivity is the activity of one module with fixed items.
type fakeActivity struct {
	module  string
	items   []Item
	total   int64
	started bool
}

func (a *fakeActivity) Module() string { return a.module }

func (a *fakeActivity) Items(_ context.Context, _ Querier, limit int) ([]Item, int64, error) {
	return a.items[:min(limit, len(a.items))], a.total, nil
}

func (a *fakeActivity) Started(context.Context, Querier) (bool, error) { return a.started, nil }

func service(t *testing.T, store *fakeStore, acts ...Activity) *Service {
	t.Helper()
	reg, err := NewRegistry(acts...)
	if err != nil {
		t.Fatal(err)
	}
	return &Service{Store: store, Activity: reg, Now: func() time.Time { return seedNow }}
}

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	if !problem.Is(err, code) {
		t.Fatalf("err = %v, want %s", err, code)
	}
}

var trip = Item{Kind: "active_process", EntityType: "fleet.trip", EntityID: uuid.MustParse("9a8f8c1e-0000-5000-8000-000000000001"),
	Title: "Рейс TR-2026-000123", State: "on_route", Assignee: "Илья Васильев", Effect: EffectFinishAllowed}

func TestSetEnablesUninstalledModule(t *testing.T) {
	t.Parallel()
	store := newStore()
	m, err := service(t, store).Set(t.Context(), ownerCtx, "fleet", Update{Enabled: true}, `"rev-1"`)
	if err != nil {
		t.Fatal(err)
	}
	if m.ModuleKey != "fleet" || m.State != StateActive || m.Revision != 2 || m.Name != "Логистика" {
		t.Fatalf("manifest %+v", m)
	}
	if len(store.changes) != 1 {
		t.Fatalf("changes %+v", store.changes)
	}
	ch := store.changes[0]
	if ch.StoredKey != "fleet" || ch.From != 1 || ch.State != StateActive || !ch.PolicyChange || ch.ActorID != ownerA ||
		ch.Action != "modules.module.enable" {
		t.Errorf("change %+v", ch)
	}
}

func TestSetDisablesWithoutProcesses(t *testing.T) {
	t.Parallel()
	for retained, want := range map[string]string{"": StateReadOnly, RetainHistory: StateReadOnly, RetainExport: StateDisabled} {
		store := newStore(Installation{Key: "spa", StoredKey: "spa", State: StateActive, Revision: 4})
		m, err := service(t, store).Set(t.Context(), ownerCtx, "spa", Update{Retained: retained, Reason: "сезон закрыт"}, `"rev-4"`)
		if err != nil {
			t.Fatal(err)
		}
		ch := store.changes[0]
		if m.State == "" || string(m.State) != want || m.Revision != 5 || ch.Action != "modules.module.disable" ||
			ch.Reason != "сезон закрыт" || ch.Retained == "" || !ch.PolicyChange {
			t.Errorf("retained %q: manifest %+v, change %+v", retained, m, ch)
		}
	}
}

// AC-12: отключение при начатом рейсе — draining; когда начатых процессов не осталось, следующее чтение состояния
// переводит модуль в итог (read_only или disabled) от имени сервиса, с аудитом и policy_version.
func TestDrainingSettlesWhenProcessesFinish(t *testing.T) {
	t.Parallel()
	for retained, final := range map[string]string{RetainHistory: StateReadOnly, RetainExport: StateDisabled} {
		checkDrainingSettles(t, retained, final)
	}
}

func checkDrainingSettles(t *testing.T, retained, final string) {
	t.Helper()
	store := newStore(Installation{Key: "fleet", StoredKey: "logistics", State: StateActive, Revision: 2})
	act := &fakeActivity{module: "fleet", items: []Item{trip}, total: 1, started: true}
	svc := service(t, store, act)
	m, err := svc.Set(t.Context(), ownerCtx, "fleet", Update{Retained: retained}, `"rev-2"`)
	if err != nil {
		t.Fatal(err)
	}
	if m.State != StateDraining || store.rows["fleet"].RetainedAccess != retained || store.changes[0].StoredKey != "logistics" {
		t.Fatalf("%s: manifest %+v, row %+v", retained, m, store.rows["fleet"])
	}
	inst, err := svc.Installations(t.Context(), tenantA)
	if err != nil || inst["fleet"].State != StateDraining {
		t.Fatalf("still started: %+v %v", inst, err)
	}
	act.started = false
	inst, err = svc.Installations(t.Context(), tenantA)
	if err != nil || inst["fleet"].State != final || inst["fleet"].Revision != 4 {
		t.Fatalf("%s: settled %+v %v", retained, inst, err)
	}
	checkSettleChange(t, store.changes[1])
}

// checkSettleChange: the service ends draining with its own audit action and a new policy version.
func checkSettleChange(t *testing.T, ch Change) {
	t.Helper()
	if ch.ActorID != uuid.Nil || ch.Action != "modules.module.drained" || !ch.PolicyChange || ch.From != 3 {
		t.Errorf("settle change %+v", ch)
	}
}

func TestSetReenables(t *testing.T) {
	t.Parallel()
	for _, from := range []string{StateReadOnly, StateDisabled, StateDraining} {
		store := newStore(Installation{Key: "fleet", StoredKey: "fleet", State: from, RetainedAccess: RetainHistory, Revision: 7})
		started := &fakeActivity{module: "fleet", started: true} // draining держится, пока рейсы не сданы
		m, err := service(t, store, started).Set(t.Context(), ownerCtx, "fleet", Update{Enabled: true}, `"7"`)
		if err != nil || m.State != StateActive || m.Revision != 8 || store.changes[0].Action != "modules.module.enable" {
			t.Errorf("%s → active: %+v %v", from, m, err)
		}
	}
}

func TestSetKeepsSameState(t *testing.T) {
	t.Parallel()
	// Желаемое состояние уже достигнуто: без записи, ревизия та же.
	store := newStore(Installation{Key: "spa", StoredKey: "spa", State: StateActive, Revision: 3})
	m, err := service(t, store).Set(t.Context(), ownerCtx, "spa", Update{Enabled: true}, `"rev-3"`)
	if err != nil || m.Revision != 3 || len(store.changes) != 0 {
		t.Errorf("active → active: %+v %v %+v", m, err, store.changes)
	}
	m, err = service(t, newStore()).Set(t.Context(), ownerCtx, "repairs", Update{}, `"rev-1"`)
	if err != nil || m.State != StateUninstalled || m.Revision != 1 {
		t.Errorf("disable uninstalled: %+v %v", m, err)
	}
	// read_only → disabled: смена сохраняемого доступа без draining.
	store = newStore(Installation{Key: "spa", StoredKey: "spa", State: StateReadOnly, RetainedAccess: RetainHistory, Revision: 3})
	m, err = service(t, store).Set(t.Context(), ownerCtx, "spa", Update{Retained: RetainExport}, `"rev-3"`)
	if err != nil || m.State != StateDisabled {
		t.Errorf("read_only → disabled: %+v %v", m, err)
	}
}

func TestSetRefusals(t *testing.T) {
	t.Parallel()
	row := Installation{Key: "spa", StoredKey: "spa", State: StateActive, Revision: 3}
	cases := []struct {
		name, key, ifMatch, code string
		race                     bool
	}{
		{"устаревшая ревизия", "spa", `"rev-2"`, "revision_mismatch", false},
		{"гонка записи", "spa", `"rev-3"`, "revision_mismatch", true},
		{"слабый ETag", "spa", `W/"rev-3"`, problem.CodeMalformedRequest, false},
		{"пустой If-Match", "spa", "", problem.CodeMalformedRequest, false},
		{"модуль ядра", "tasks", `"rev-1"`, "validation_failed", false},
		{"неизвестный модуль", "chat", `"rev-1"`, problem.CodeNotFound, false},
	}
	for _, c := range cases {
		store := newStore(row)
		store.race = c.race
		_, err := service(t, store).Set(t.Context(), ownerCtx, c.key, Update{}, c.ifMatch)
		if !problem.Is(err, c.code) {
			t.Errorf("%s: %v, want %s", c.name, err, c.code)
		}
	}
	store := newStore(row)
	store.err = errors.New("pool closed")
	_, err := service(t, store).Set(t.Context(), ownerCtx, "spa", Update{}, `"rev-3"`)
	wantCode(t, err, problem.CodeDependencyUnavailable)
}

func TestCatalogAndGet(t *testing.T) {
	t.Parallel()
	svc := service(t, newStore(Installation{Key: "spa", StoredKey: "spa", State: StateActive, Revision: 3}))
	items, err := svc.Catalog(t.Context(), tenantA)
	if err != nil || len(items) != 3 {
		t.Fatalf("%+v %v", items, err)
	}
	if items[0].ModuleKey != "fleet" || items[0].State != StateUninstalled || items[0].Revision != 1 ||
		items[1].ModuleKey != "spa" || items[1].State != StateActive || items[1].Revision != 3 {
		t.Errorf("catalog %+v", items)
	}
	m, err := svc.Get(t.Context(), tenantA, "spa")
	if err != nil || m.Revision != 3 {
		t.Errorf("get spa: %+v %v", m, err)
	}
	for _, key := range []string{"tasks", "chat", "logistics"} {
		_, err := svc.Get(t.Context(), tenantA, key)
		wantCode(t, err, problem.CodeNotFound)
	}
}

func TestPreview(t *testing.T) {
	t.Parallel()
	act := &fakeActivity{module: "fleet", items: []Item{trip, {Kind: "active_process", EntityType: "fleet.trip",
		EntityID: uuid.New(), Title: "Рейс TR-2026-000124", State: "assigned", Effect: EffectClosed}}, total: 57, started: true}
	svc := service(t, newStore(
		Installation{Key: "fleet", StoredKey: "fleet", State: StateActive, Revision: 2},
		Installation{Key: "spa", StoredKey: "spa", State: StateActive, Revision: 1},
	), act)
	p, err := svc.Preview(t.Context(), tenantA, "fleet")
	if err != nil {
		t.Fatal(err)
	}
	if p.ModuleKey != "fleet" || p.RetainedAccess != RetainHistory || p.HiddenCount != 55 || !p.GeneratedAt.Equal(seedNow) ||
		len(p.ActiveItems) != 2 {
		t.Fatalf("preview %+v", p)
	}
	checkPreviewItems(t, p.ActiveItems)
	empty, err := svc.Preview(t.Context(), tenantA, "spa")
	if err != nil || empty.ActiveItems == nil || len(empty.ActiveItems) != 0 || empty.HiddenCount != 0 {
		t.Errorf("Активных процессов нет: %+v %v", empty, err)
	}
	_, err = svc.Preview(t.Context(), tenantA, "repairs")
	wantCode(t, err, "module_not_installed")
	if pe, _ := errors.AsType[*problem.Error](err); pe.Detail != "Модуль «Ремонт и стройка» не подключён организацией." {
		t.Errorf("detail %q", pe.Detail)
	}
	_, err = svc.Preview(t.Context(), tenantA, "tasks")
	wantCode(t, err, problem.CodeNotFound)
}

func checkPreviewItems(t *testing.T, items []modulesapi.ModuleDeactivationItem) {
	t.Helper()
	first := items[0]
	if first.Kind != "active_process" || first.Object.EntityType != "fleet.trip" || first.Object.EntityId != trip.EntityID ||
		first.Title != trip.Title || first.State != "on_route" || first.AssigneeName == nil ||
		*first.AssigneeName != "Илья Васильев" || first.Effect != EffectFinishAllowed {
		t.Errorf("item %+v", first)
	}
	if items[1].AssigneeName != nil || items[1].Effect != EffectClosed {
		t.Errorf("item without assignee %+v", items[1])
	}
}

func TestRegistry(t *testing.T) {
	t.Parallel()
	if _, err := NewRegistry(&fakeActivity{module: "fleet"}, &fakeActivity{module: "fleet"}); err == nil {
		t.Error("duplicate provider accepted")
	}
	if _, err := NewRegistry(&fakeActivity{module: "tasks"}); err == nil {
		t.Error("provider of a core module accepted")
	}
	if reg := DefaultRegistry(); reg == nil || reg.byModule["fleet"] == nil || reg.byModule["fleet"].Module() != "fleet" {
		t.Errorf("DefaultRegistry = %+v", reg)
	}
}

func settingsOf(t *testing.T, s Settings) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(s.Body, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestSettings(t *testing.T) {
	t.Parallel()
	svc := service(t, newStore(
		Installation{Key: "fleet", StoredKey: "fleet", State: StateActive, Revision: 2},
		Installation{Key: "spa", StoredKey: "spa", State: StateReadOnly, Revision: 5},
	))
	for key, want := range map[string]string{
		"fleet": `{"moduleKey":"fleet","reservationTtlMinutes":30,"requirePhotoRoles":["front","rear","left","right","odometer"],"managerApprovalForRelease":false,"maxOfflineDraftHours":24}`,
		"spa":   `{"moduleKey":"spa","cancellationMinutes":120,"allowNegativeStock":false,"defaultTimeZone":"Europe/Moscow"}`,
		"forms": `{"moduleKey":"forms","allowPublicForms":true,"maxPublicUploadBytes":10485760,"defaultRetentionDays":365}`,
		"tasks": `{"moduleKey":"tasks","allowUnassignedTasks":true}`,
	} {
		s, err := svc.Settings(t.Context(), tenantA, key)
		if err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		var w map[string]any
		_ = json.Unmarshal([]byte(want), &w)
		if got := settingsOf(t, s); !maps.EqualFunc(got, w, jsonEqual) {
			t.Errorf("%s: %s", key, s.Body)
		}
	}
	if s, _ := svc.Settings(t.Context(), tenantA, "spa"); s.Revision != 5 {
		t.Errorf("spa revision %d", s.Revision)
	}
	if s, _ := svc.Settings(t.Context(), tenantA, "forms"); s.Revision != 1 {
		t.Errorf("forms revision %d", s.Revision)
	}
	_, err := service(t, newStore()).Settings(t.Context(), tenantA, "fleet")
	wantCode(t, err, "module_not_installed")
	for _, key := range []string{"repairs", "calendar", "chat"} {
		_, err := svc.Settings(t.Context(), tenantA, key)
		if !problem.Is(err, problem.CodeNotFound) && !problem.Is(err, "module_not_installed") {
			t.Errorf("%s: %v", key, err)
		}
	}
}

func jsonEqual(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

func TestUpdateSettings(t *testing.T) {
	t.Parallel()
	store := newStore(Installation{Key: "spa", StoredKey: "spa", State: StateActive, Revision: 3})
	svc := service(t, store)
	body := []byte(`{"moduleKey":"spa","cancellationMinutes":180,"allowNegativeStock":false,"defaultTimeZone":"Europe/Moscow"}`)
	s, err := svc.UpdateSettings(t.Context(), ownerCtx, "spa", body, `"rev-3"`)
	if err != nil || s.Revision != 4 || settingsOf(t, s)["cancellationMinutes"] != float64(180) {
		t.Fatalf("%s %v", s.Body, err)
	}
	ch := store.changes[0]
	if ch.Action != "modules.settings.update" || ch.PolicyChange || ch.State != StateActive || ch.Settings == nil {
		t.Errorf("change %+v", ch)
	}
	if got, _ := svc.Settings(t.Context(), tenantA, "spa"); got.Revision != 4 || settingsOf(t, got)["cancellationMinutes"] != float64(180) {
		t.Errorf("read back %s", got.Body)
	}
	// Модуль ядра без строки: первая запись создаёт строку состояния active.
	forms := []byte(`{"moduleKey":"forms","allowPublicForms":false,"maxPublicUploadBytes":1048576,"defaultRetentionDays":30}`)
	if s, err := svc.UpdateSettings(t.Context(), ownerCtx, "forms", forms, `"rev-1"`); err != nil || s.Revision != 2 ||
		store.rows["forms"].State != StateActive {
		t.Errorf("forms: %s %v", s.Body, err)
	}
	checkSettingsRefusals(t, svc, body)
}

// checkSettingsRefusals: spa at revision 4, forms at 2 (after TestUpdateSettings), fleet not installed.
func checkSettingsRefusals(t *testing.T, svc *Service, body []byte) {
	t.Helper()
	for name, c := range map[string]struct {
		key, body, ifMatch, code string
	}{
		"чужой модуль в теле":   {"spa", `{"moduleKey":"tasks","allowUnassignedTasks":true}`, `"rev-4"`, "validation_failed"},
		"минимум":               {"spa", `{"moduleKey":"spa","cancellationMinutes":-1,"allowNegativeStock":false,"defaultTimeZone":"Europe/Moscow"}`, `"rev-4"`, "validation_failed"},
		"зона":                  {"spa", `{"moduleKey":"spa","cancellationMinutes":0,"allowNegativeStock":false,"defaultTimeZone":"Mars/Base"}`, `"rev-4"`, "validation_failed"},
		"ttl брони":             {"fleet", `{"moduleKey":"fleet","reservationTtlMinutes":4,"requirePhotoRoles":[],"managerApprovalForRelease":false,"maxOfflineDraftHours":24}`, `"rev-1"`, "module_not_installed"},
		"устаревшая ревизия":    {"spa", string(body), `"rev-3"`, "revision_mismatch"},
		"без типа настроек":     {"calendar", `{"moduleKey":"calendar"}`, `"rev-1"`, "validation_failed"},
		"битый JSON":            {"tasks", `{"moduleKey":`, `"rev-1"`, "validation_failed"},
		"задачи — лишнее поле":  {"tasks", `{"moduleKey":"tasks","allowUnassignedTasks":true,"x":1}`, `"rev-1"`, "validation_failed"},
		"отрицательный остаток": {"spa", `{"moduleKey":"spa","cancellationMinutes":0,"allowNegativeStock":true,"defaultTimeZone":"Europe/Moscow"}`, `"rev-4"`, "validation_failed"},
		"неизвестный модуль":    {"chat", `{"moduleKey":"chat"}`, `"rev-1"`, problem.CodeNotFound},
		"формы — нулевой срок":  {"forms", `{"moduleKey":"forms","allowPublicForms":true,"maxPublicUploadBytes":1,"defaultRetentionDays":0}`, `"rev-2"`, "validation_failed"},
		"задачи — без If-Match": {"tasks", `{"moduleKey":"tasks","allowUnassignedTasks":true}`, ``, problem.CodeMalformedRequest},
	} {
		_, err := svc.UpdateSettings(t.Context(), ownerCtx, c.key, []byte(c.body), c.ifMatch)
		if !problem.Is(err, c.code) {
			t.Errorf("%s: %v, want %s", name, err, c.code)
		}
	}
}

func TestUpdateFleetSettingsRefusals(t *testing.T) {
	t.Parallel()
	fleet := newStore(Installation{Key: "fleet", StoredKey: "fleet", State: StateActive, Revision: 2})
	for _, b := range []string{
		`{"moduleKey":"fleet","reservationTtlMinutes":4,"requirePhotoRoles":[],"managerApprovalForRelease":false,"maxOfflineDraftHours":24}`,
		`{"moduleKey":"fleet","reservationTtlMinutes":30,"requirePhotoRoles":["front","front"],"managerApprovalForRelease":false,"maxOfflineDraftHours":24}`,
		`{"moduleKey":"fleet","reservationTtlMinutes":30,"requirePhotoRoles":["roof"],"managerApprovalForRelease":false,"maxOfflineDraftHours":24}`,
		`{"moduleKey":"fleet","reservationTtlMinutes":30,"requirePhotoRoles":[],"managerApprovalForRelease":false,"maxOfflineDraftHours":73}`,
	} {
		_, err := service(t, fleet).UpdateSettings(t.Context(), ownerCtx, "fleet", []byte(b), `"rev-2"`)
		wantCode(t, err, "validation_failed")
	}
}

func TestETag(t *testing.T) {
	t.Parallel()
	if got := ETag(7); got != `"rev-7"` {
		t.Errorf("ETag(7) = %s", got)
	}
}
