package kit_test

import (
	"context"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var (
	now    = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	tenant = uuid.New()
	region = uuid.New() // Москва
	firm1  = uuid.New() // Москва-1
	firm2  = uuid.New() // Москва-2
)

// source is a fake authz.Source: subjects by person, a call counter.
type source struct {
	subjects map[uuid.UUID]authz.Subject
	calls    int
	err      error
}

func (s *source) Subject(_ context.Context, tc tenantctx.TenantContext, _ time.Time, _ bool) (authz.Subject, error) {
	s.calls++
	if s.err != nil {
		return authz.Subject{}, s.err
	}
	sub := s.subjects[tc.PersonID]
	sub.TenantID, sub.PersonID, sub.Owner = tc.TenantID, tc.PersonID, tc.Owner
	return sub, nil
}

func (s *source) InstalledModules(context.Context, tenantctx.TenantContext) ([]string, error) {
	return nil, nil
}

// tree: Москва → Москва-1, Москва-2.
type tree struct{}

func (tree) Ancestors(_ context.Context, _, unit uuid.UUID) ([]uuid.UUID, error) {
	if unit == firm1 || unit == firm2 {
		return []uuid.UUID{unit, region}, nil
	}
	return []uuid.UUID{unit}, nil
}

func evaluator(src *source) *authz.Evaluator {
	return authz.New(src, tree{}, func() time.Time { return now })
}

func grant(scope authz.Scope, actions ...string) authz.Grant {
	return authz.Grant{AssignmentID: uuid.New(), RoleID: uuid.New(), Actions: actions, Scope: scope, From: now.Add(-time.Hour)}
}

func tcOf(person uuid.UUID, owner bool) tenantctx.TenantContext {
	return tenantctx.TenantContext{TenantID: tenant, PersonID: person, Owner: owner}
}

func code(err error) string {
	if pe, ok := errors.AsType[*problem.Error](err); ok {
		return pe.Code
	}
	if err == nil {
		return ""
	}
	return "?" + err.Error()
}

// Свежий вход владельческих команд: не старше 10 минут по часам сессий, иначе 401 session_expired.
func TestFresh(t *testing.T) {
	t.Parallel()
	at := func(d time.Duration, ok bool) kit.Deps {
		return kit.Deps{
			AuthTime:   func(context.Context) (time.Time, bool) { return now.Add(-d), ok },
			SessionNow: func() time.Time { return now },
		}
	}
	for name, tc := range map[string]struct {
		d    kit.Deps
		want string
	}{
		"5 минут":         {at(5*time.Minute, true), ""},
		"ровно 10 минут":  {at(10*time.Minute, true), ""},
		"11 минут":        {at(11*time.Minute, true), problem.CodeSessionExpired},
		"нет сессии":      {at(0, false), problem.CodeSessionExpired},
		"сессия из ctx":   {kit.Deps{SessionNow: func() time.Time { return now }}, ""},
		"старая из ctx":   {kit.Deps{SessionNow: func() time.Time { return now.Add(time.Hour) }}, problem.CodeSessionExpired},
		"ctx без сессии ": {kit.Deps{}, problem.CodeSessionExpired},
	} {
		ctx := t.Context()
		if name == "сессия из ctx" || name == "старая из ctx" {
			ctx = session.WithSession(ctx, session.Session{IssuedAt: now.Add(-time.Minute)})
		}
		if got := code(tc.d.Fresh(ctx)); got != tc.want {
			t.Errorf("%s: %q, want %q", name, got, tc.want)
		}
	}
}

// Область контракта ↔ область tenant DB: org_unit ↔ unit, resource_pool ↔ resource; tenant и self без id,
// остальные — ровно один id; поддерево — только у подразделения.
func TestScopeFromAPI(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	ids := func(n int) []uuid.UUID {
		out := make([]uuid.UUID, n)
		for i := range out {
			out[i] = uuid.New()
		}
		return out
	}
	for name, tc := range map[string]struct {
		in   accessapi.Scope
		want authz.Scope
		err  string
	}{
		"организация":         {accessapi.Scope{Kind: accessapi.ScopeKindTenant, ResourceIds: []uuid.UUID{}}, authz.Scope{Kind: authz.KindTenant, Descendants: true}, ""},
		"своё":                {accessapi.Scope{Kind: accessapi.ScopeKindSelf, IncludeDescendants: true}, authz.Scope{Kind: authz.KindSelf}, ""},
		"фирма с поддеревом":  {accessapi.Scope{Kind: accessapi.ScopeKindOrgUnit, ResourceIds: []uuid.UUID{id}, IncludeDescendants: true}, authz.Scope{Kind: authz.KindUnit, Ref: id, Descendants: true}, ""},
		"фирма без поддерева": {accessapi.Scope{Kind: accessapi.ScopeKindOrgUnit, ResourceIds: []uuid.UUID{id}}, authz.Scope{Kind: authz.KindUnit, Ref: id}, ""},
		"проект":              {accessapi.Scope{Kind: accessapi.ScopeKindProject, ResourceIds: []uuid.UUID{id}, IncludeDescendants: true}, authz.Scope{Kind: authz.KindProject, Ref: id}, ""},
		"пул ресурсов":        {accessapi.Scope{Kind: accessapi.ScopeKindResourcePool, ResourceIds: []uuid.UUID{id}}, authz.Scope{Kind: authz.KindResource, Ref: id}, ""},
		"организация с id":    {accessapi.Scope{Kind: accessapi.ScopeKindTenant, ResourceIds: ids(1)}, authz.Scope{}, kit.CodeValidation},
		"фирма без id":        {accessapi.Scope{Kind: accessapi.ScopeKindOrgUnit}, authz.Scope{}, kit.CodeValidation},
		"две фирмы":           {accessapi.Scope{Kind: accessapi.ScopeKindOrgUnit, ResourceIds: ids(2)}, authz.Scope{}, kit.CodeValidation},
		"нулевой id":          {accessapi.Scope{Kind: accessapi.ScopeKindProject, ResourceIds: []uuid.UUID{uuid.Nil}}, authz.Scope{}, kit.CodeValidation},
		"касса (W4.01)":       {accessapi.Scope{Kind: accessapi.ScopeKindAccount, ResourceIds: []uuid.UUID{id}}, authz.Scope{Kind: authz.KindAccount, Ref: id}, ""},
		"неизвестный вид":     {accessapi.Scope{Kind: "galaxy", ResourceIds: ids(1)}, authz.Scope{}, kit.CodeValidation},
		"связь":               {accessapi.Scope{Kind: accessapi.ScopeKindRelation, ResourceIds: []uuid.UUID{}, IncludeDescendants: true}, authz.Scope{Kind: authz.KindRelation}, ""},
		"связь с id":          {accessapi.Scope{Kind: accessapi.ScopeKindRelation, ResourceIds: ids(1)}, authz.Scope{}, kit.CodeValidation},
		"пространство без id": {accessapi.Scope{Kind: accessapi.ScopeKindSpace}, authz.Scope{}, kit.CodeValidation},
	} {
		got, err := kit.ScopeFromAPI(tc.in)
		if code(err) != tc.err || (tc.err == "" && got != tc.want) {
			t.Errorf("%s: %+v %v, want %+v %s", name, got, err, tc.want, tc.err)
		}
	}
	// Объектные виды этапов 4–7 (W4.01): ровно один объект своего вида, без поддерева; имя API = ключ каталога.
	for _, kind := range []accessapi.ScopeKind{accessapi.ScopeKindSpace, accessapi.ScopeKindPage, accessapi.ScopeKindFolder,
		accessapi.ScopeKindDoc, accessapi.ScopeKindAccount, accessapi.ScopeKindChat, accessapi.ScopeKindRepairProject} {
		got, err := kit.ScopeFromAPI(accessapi.Scope{Kind: kind, ResourceIds: []uuid.UUID{id}, IncludeDescendants: true})
		if err != nil || got != (authz.Scope{Kind: string(kind), Ref: id}) {
			t.Errorf("%s: %+v %v", kind, got, err)
		}
		if back := kit.ScopeToAPI(got); back.Kind != kind || !slices.Equal(back.ResourceIds, []uuid.UUID{id}) || back.IncludeDescendants {
			t.Errorf("%s back: %+v", kind, back)
		}
	}
}

// Цели делегирования области «связь» — как у «своего»: подразделение назначения (W4.01).
func TestTargetsRelation(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{authz.KindSelf, authz.KindRelation} {
		got, err := kit.Targets(t.Context(), nil, authz.Scope{Kind: kind}, firm1)
		if err != nil || len(got) != 1 || got[0].Unit != firm1 || len(got[0].Objects) != 0 {
			t.Errorf("%s: %+v %v", kind, got, err)
		}
	}
}

func TestScopeToAPIRelation(t *testing.T) {
	t.Parallel()
	got := kit.ScopeToAPI(authz.Scope{Kind: authz.KindRelation})
	if got.Kind != accessapi.ScopeKindRelation || got.ResourceIds == nil || len(got.ResourceIds) != 0 || got.IncludeDescendants {
		t.Errorf("relation: %+v", got)
	}
}

func TestScopeToAPI(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	for _, tc := range []struct {
		in   authz.Scope
		want accessapi.Scope
	}{
		{authz.Scope{Kind: authz.KindTenant}, accessapi.Scope{Kind: accessapi.ScopeKindTenant, ResourceIds: []uuid.UUID{}, IncludeDescendants: true}},
		{authz.Scope{Kind: authz.KindSelf, Descendants: true}, accessapi.Scope{Kind: accessapi.ScopeKindSelf, ResourceIds: []uuid.UUID{}}},
		{authz.Scope{Kind: authz.KindUnit, Ref: id, Descendants: true}, accessapi.Scope{Kind: accessapi.ScopeKindOrgUnit, ResourceIds: []uuid.UUID{id}, IncludeDescendants: true}},
		{authz.Scope{Kind: authz.KindProject, Ref: id, Descendants: true}, accessapi.Scope{Kind: accessapi.ScopeKindProject, ResourceIds: []uuid.UUID{id}}},
		{authz.Scope{Kind: authz.KindResource, Ref: id}, accessapi.Scope{Kind: accessapi.ScopeKindResourcePool, ResourceIds: []uuid.UUID{id}}},
	} {
		got := kit.ScopeToAPI(tc.in)
		if got.Kind != tc.want.Kind || got.IncludeDescendants != tc.want.IncludeDescendants || !slices.Equal(got.ResourceIds, tc.want.ResourceIds) || got.ResourceIds == nil {
			t.Errorf("%+v: %+v, want %+v", tc.in, got, tc.want)
		}
	}
}

func TestETagIfMatch(t *testing.T) {
	t.Parallel()
	if got := kit.ETag(7); got != `"7"` {
		t.Fatalf("ETag = %s", got)
	}
	for h, want := range map[string]string{
		`"7"`: "", `"6"`: kit.CodeRevisionMismatch, `W/"7"`: kit.CodeRevisionMismatch, `7`: kit.CodeRevisionMismatch,
		`"x"`: kit.CodeRevisionMismatch, `*`: kit.CodeRevisionMismatch, ``: kit.CodeRevisionMismatch,
	} {
		if got := code(kit.IfMatch(h, 7)); got != want {
			t.Errorf("If-Match %q: %q, want %q", h, got, want)
		}
	}
}

func TestLimitAndCursor(t *testing.T) {
	t.Parallel()
	one, zero, big, top := 1, 0, 201, 200
	for p, want := range map[*int]int{nil: 50, &one: 1, &top: 200} {
		if got, err := kit.Limit(p); err != nil || got != want {
			t.Errorf("Limit: %d %v, want %d", got, err, want)
		}
	}
	for _, p := range []*int{&zero, &big} {
		if _, err := kit.Limit(p); code(err) != problem.CodeMalformedRequest {
			t.Errorf("Limit(%d): %v", *p, err)
		}
	}
	c := kit.Cursor{Key: "диспетчер\x00", ID: uuid.New()}
	s := c.Encode()
	got, err := kit.DecodeCursor(&s)
	if err != nil || got == nil || *got != c {
		t.Fatalf("roundtrip: %+v %v", got, err)
	}
	if got, err := kit.DecodeCursor(nil); got != nil || err != nil {
		t.Errorf("nil cursor: %+v %v", got, err)
	}
	for _, bad := range []string{"!!!", "e30", "eyJrIjoiYSJ9"} { // not base64; {}; {"k":"a"} without id
		if _, err := kit.DecodeCursor(&bad); code(err) != problem.CodeMalformedRequest {
			t.Errorf("cursor %q: %v", bad, err)
		}
	}
}

// Делегирование (AUTH-08): участник выдаёт только то, что имеет сам, в той области, где может назначать;
// поддерево требует права над каждым подразделением; owner_only и закрытое функцией не делегируются; владелец —
// без проверки; сбой источника — 503, а не 409.
func TestDelegate(t *testing.T) {
	t.Parallel()
	regionAdmin, firmAdmin, tenantAdmin, driver := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	src := &source{subjects: map[uuid.UUID]authz.Subject{
		regionAdmin: {Grants: []authz.Grant{grant(authz.Scope{Kind: authz.KindUnit, Ref: region, Descendants: true}, kit.ActionAssign, "fleet.trips.read")}},
		firmAdmin:   {Grants: []authz.Grant{grant(authz.Scope{Kind: authz.KindUnit, Ref: firm1}, kit.ActionAssign, "fleet.trips.read")}},
		tenantAdmin: {Grants: []authz.Grant{grant(authz.Scope{Kind: authz.KindTenant}, kit.ActionAssign, "fleet.trips.read", "modules.manage", "fleet.earnings.read")}},
		driver: {Functions: []string{authz.FunctionDriver}, Grants: []authz.Grant{
			grant(authz.Scope{Kind: authz.KindTenant}, kit.ActionAssign, "fleet.earnings.read")}},
	}}
	ev := evaluator(src)
	project := uuid.New()
	unit := func(u uuid.UUID) authz.Resource { return authz.Resource{Unit: u} }
	for name, tc := range map[string]struct {
		person  uuid.UUID
		owner   bool
		actions []string
		targets []authz.Resource
		want    string
	}{
		"владелец — всё":                         {uuid.New(), true, []string{"modules.manage", "fleet.earnings.read"}, []authz.Resource{{}}, ""},
		"регион → фирма":                         {regionAdmin, false, []string{"fleet.trips.read"}, []authz.Resource{unit(firm1)}, ""},
		"регион → поддерево региона":             {regionAdmin, false, []string{"fleet.trips.read"}, []authz.Resource{unit(region), unit(firm1), unit(firm2)}, ""},
		"фирма → своя фирма":                     {firmAdmin, false, []string{"fleet.trips.read"}, []authz.Resource{unit(firm1)}, ""},
		"фирма → соседняя фирма":                 {firmAdmin, false, []string{"fleet.trips.read"}, []authz.Resource{unit(firm2)}, kit.CodeDelegation},
		"фирма → весь регион":                    {firmAdmin, false, []string{"fleet.trips.read"}, []authz.Resource{unit(region), unit(firm1)}, kit.CodeDelegation},
		"фирма → вся организация":                {firmAdmin, false, []string{"fleet.trips.read"}, []authz.Resource{{}}, kit.CodeDelegation},
		"фирма → действие, которого нет":         {firmAdmin, false, []string{"fleet.trips.read", "fleet.trips.review"}, []authz.Resource{unit(firm1)}, kit.CodeDelegation},
		"организация → проект":                   {tenantAdmin, false, []string{"fleet.trips.read"}, []authz.Resource{{Objects: map[string]uuid.UUID{authz.KindProject: project}}}, ""},
		"регион → проект (PD-53, нет гранта)":    {regionAdmin, false, []string{"fleet.trips.read"}, []authz.Resource{{Objects: map[string]uuid.UUID{authz.KindProject: project}}}, kit.CodeDelegation},
		"owner_only не делегируется":             {tenantAdmin, false, []string{"modules.manage"}, []authz.Resource{{}}, kit.CodeDelegation},
		"начисления водитель не делегирует":      {driver, false, []string{"fleet.earnings.read"}, []authz.Resource{{}}, kit.CodeDelegation},
		"неизвестное действие не делегируется":   {tenantAdmin, false, []string{"fleet.weird"}, []authz.Resource{{}}, kit.CodeDelegation},
		"пустая роль — только право назначать":   {firmAdmin, false, nil, []authz.Resource{unit(firm1)}, ""},
		"пустая роль вне области назначающего":   {firmAdmin, false, nil, []authz.Resource{unit(firm2)}, kit.CodeDelegation},
		"организация с действием на организацию": {tenantAdmin, false, []string{"fleet.earnings.read"}, []authz.Resource{{}}, ""},
	} {
		err := kit.Delegate(t.Context(), ev, tcOf(tc.person, tc.owner), tc.actions, tc.targets, "")
		if code(err) != tc.want {
			t.Errorf("%s: %v, want %q", name, err, tc.want)
		}
		if tc.want == kit.CodeDelegation {
			if pe, _ := errors.AsType[*problem.Error](err); pe == nil || pe.Detail != kit.DetailDelegation {
				t.Errorf("%s: detail %v", name, err)
			}
		}
	}
	failing := evaluator(&source{err: errors.New("db down")})
	if err := kit.Delegate(t.Context(), failing, tcOf(regionAdmin, false), []string{"fleet.trips.read"}, []authz.Resource{unit(firm1)}, "x"); code(err) != problem.CodeDependencyUnavailable {
		t.Errorf("source failure: %v", err)
	}
}

func TestCovers(t *testing.T) {
	t.Parallel()
	firmReader, tenantReader := uuid.New(), uuid.New()
	ev := evaluator(&source{subjects: map[uuid.UUID]authz.Subject{
		firmReader:   {Grants: []authz.Grant{grant(authz.Scope{Kind: authz.KindUnit, Ref: firm1, Descendants: true}, "roles.read")}},
		tenantReader: {Grants: []authz.Grant{grant(authz.Scope{Kind: authz.KindTenant}, "roles.read")}},
	}})
	for name, tc := range map[string]struct {
		person uuid.UUID
		owner  bool
		unit   uuid.UUID
		want   bool
	}{
		"фирма видит свою фирму":        {firmReader, false, firm1, true},
		"фирма не видит соседнюю":       {firmReader, false, firm2, false},
		"фирма не видит организацию":    {firmReader, false, uuid.Nil, false},
		"организация видит фирму":       {tenantReader, false, firm2, true},
		"организация видит организацию": {tenantReader, false, uuid.Nil, true},
		"владелец видит всё":            {uuid.New(), true, uuid.Nil, true},
		"без грантов не видит ничего":   {uuid.New(), false, firm1, false},
	} {
		got, err := kit.Covers(t.Context(), ev, tcOf(tc.person, tc.owner), "roles.read", tc.unit)
		if err != nil || got != tc.want {
			t.Errorf("%s: %v %v, want %v", name, got, err, tc.want)
		}
	}
	if _, err := kit.Covers(t.Context(), evaluator(&source{err: errors.New("down")}), tcOf(firmReader, false), "roles.read", firm1); code(err) != problem.CodeDependencyUnavailable {
		t.Errorf("failure: %v", err)
	}
}

// Request читает субъекта один раз на запрос, как бы много проверок ни делала команда.
func TestRequestReadsSubjectOnce(t *testing.T) {
	t.Parallel()
	admin := uuid.New()
	src := &source{subjects: map[uuid.UUID]authz.Subject{
		admin: {Grants: []authz.Grant{grant(authz.Scope{Kind: authz.KindTenant}, kit.ActionAssign, "a.b", "fleet.trips.read")}},
	}}
	ev := kit.Request(evaluator(src))
	for range 5 {
		_ = kit.Delegate(t.Context(), ev, tcOf(admin, false), []string{"fleet.trips.read"}, []authz.Resource{{}, {Unit: firm1}}, "")
	}
	if src.calls != 1 {
		t.Errorf("subject read %d times, want 1", src.calls)
	}
}

func TestDriverClosed(t *testing.T) {
	t.Parallel()
	p := authz.DefaultPolicy()
	if got := kit.ClosedByDriver(p); !slices.Equal(got, []string{"chat.pdn.read", "fleet.earnings.manage", "fleet.earnings.read"}) {
		t.Errorf("ClosedByDriver = %v", got)
	}
	if got := kit.DriverClosed(p, []string{"fleet.trips.read", "fleet.earnings.read", "members.read"}); !slices.Equal(got, []string{"fleet.earnings.read"}) {
		t.Errorf("DriverClosed = %v", got)
	}
}

var (
	moduleLine      = regexp.MustCompile(`^  ([a-z][a-z0-9_.]*):\s*$`)
	actionLine      = regexp.MustCompile(`^      ([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+):`)
	sensitivityLine = regexp.MustCompile(`sensitivity:\s*(sensitive|restricted)`)
)

// catalogSensitivity reads the level of every tenant action of api/permissions.yaml (section modules, platform
// excluded). The file is read as text: depguard keeps YAML libraries out of internal/modules.
func catalogSensitivity(t *testing.T) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "..", "..", "api", "permissions.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	_, modules, _ := strings.Cut(text, "\nmodules:\n")
	modules, _, _ = strings.Cut(modules, "\nrole_templates:")
	out := map[string]string{}
	module, action := "", ""
	for line := range strings.SplitSeq(modules, "\n") {
		if i := strings.Index(line, " #"); i >= 0 {
			line = line[:i] // comments: «# PROPOSED: … sensitivity: restricted» is not a level
		}
		if m := moduleLine.FindStringSubmatch(line); m != nil {
			module, action = m[1], ""
			continue
		}
		if module == "platform" {
			continue
		}
		if m := actionLine.FindStringSubmatch(line); m != nil {
			action = m[1]
			out[action] = kit.Normal
		}
		if m := sensitivityLine.FindStringSubmatch(line); m != nil && action != "" {
			out[action] = m[1]
		}
	}
	return out
}

// Чувствительность прав совпадает с каталогом (sensitive и restricted — отдельно, AUTH-03).
func TestSensitivityMatchesCatalog(t *testing.T) {
	t.Parallel()
	want := catalogSensitivity(t)
	got := map[string]string{}
	for a := range want {
		got[a] = kit.Sensitivity(a)
	}
	if len(want) < 100 || !maps.Equal(got, want) {
		for a := range want {
			if got[a] != want[a] {
				t.Errorf("%s: %s, want %s", a, got[a], want[a])
			}
		}
	}
	if kit.MaxSensitivity([]string{"members.read"}) != kit.Normal || kit.MaxSensitivity([]string{"members.read", "roles.manage"}) != kit.Sensitive ||
		kit.MaxSensitivity([]string{"roles.manage", "fleet.earnings.read", "members.read"}) != kit.Restricted {
		t.Error("MaxSensitivity")
	}
	s, r := kit.SplitSensitivity([]string{"fleet.earnings.read", "members.read", "roles.assign", "chat.pdn.read"})
	if !slices.Equal(s, []string{"roles.assign"}) || !slices.Equal(r, []string{"fleet.earnings.read", "chat.pdn.read"}) {
		t.Errorf("SplitSensitivity = %v %v", s, r)
	}
}

// groupSource is source with the groups of access lists (authz.GroupSource).
type groupSource struct {
	*source
	groups map[uuid.UUID][]uuid.UUID
}

func (g groupSource) Groups(_ context.Context, _, person uuid.UUID) ([]uuid.UUID, error) {
	return g.groups[person], nil
}

// Копия оценщика на запрос (Request, Within) не теряет групп источника: запись «группа» списка узла (W4.01)
// совпадает и через запоминающий источник.
func TestRequestKeepsGroups(t *testing.T) {
	t.Parallel()
	person, group := uuid.New(), uuid.New()
	src := &source{subjects: map[uuid.UUID]authz.Subject{person: {Grants: []authz.Grant{
		grant(authz.Scope{Kind: authz.KindUnit, Ref: firm1, Descendants: true}, "knowledge.read")}}}}
	ev := authz.New(groupSource{source: src, groups: map[uuid.UUID][]uuid.UUID{person: {group}}}, tree{}, func() time.Time { return now })
	page := authz.Resource{Unit: firm1, ReadAction: "knowledge.read", Nodes: []authz.Node{{ID: uuid.New(), Kind: authz.KindPage,
		Mode: authz.NodeListed, Entries: []authz.Entry{{Kind: authz.EntryGroup, Ref: group}}}}}
	if err := ev.Permit(t.Context(), tcOf(person, false), "knowledge.read", page); err != nil {
		t.Fatalf("evaluator: %v", err)
	}
	if err := kit.Request(ev).Permit(t.Context(), tcOf(person, false), "knowledge.read", page); err != nil {
		t.Errorf("Request: %v (the memo source lost the groups)", err)
	}
}
