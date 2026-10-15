package operators

import (
	"errors"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
)

var (
	tenantID = uuid.MustParse("4a0c6a4e-1f3b-5d2a-8c7e-9b1d2e3f4a50")
	actorID  = uuid.MustParse("0b6e8c58-5d0f-5e5b-9f39-2f5d6f0c1a01")
)

func fields(err error) []string {
	var ve *ValidationError
	if !errors.As(err, &ve) {
		return nil
	}
	return ve.Fields
}

// T-02: причина 5–500 символов после trim обязательна у трёх команд (Q-W1.00-1), дни продления 1–30, имя 1–150.
func TestValidateCommands(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("я", 501)
	name := func(s string) *string { return &s }
	cases := []struct {
		name string
		err  error
		want []string
	}{
		{"приостановка", StatusChange{TenantID: tenantID, ActorID: actorID, Reason: "Неоплата счёта"}.Validate(), nil},
		{"причина из пробелов", StatusChange{TenantID: tenantID, ActorID: actorID, Reason: "  абв  "}.Validate(), []string{"reason"}},
		{"причина 500 символов", StatusChange{TenantID: tenantID, ActorID: actorID, Reason: long[:len(long)-len("я")]}.Validate(), nil},
		{"причина длиннее 500", StatusChange{TenantID: tenantID, ActorID: actorID, Reason: long}.Validate(), []string{"reason"}},
		{"без организации и актора", StatusChange{Reason: "Неоплата счёта"}.Validate(), []string{"tenantId", "actor"}},
		{"продление на 14 дней", TrialExtension{TenantID: tenantID, ActorID: actorID, Days: 14, Reason: "Пилот продлён"}.Validate(), nil},
		{"продление на 30 дней", TrialExtension{TenantID: tenantID, ActorID: actorID, Days: 30, Reason: "Пилот продлён"}.Validate(), nil},
		{"0 дней", TrialExtension{TenantID: tenantID, ActorID: actorID, Days: 0, Reason: "Пилот продлён"}.Validate(), []string{"days"}},
		{"31 день", TrialExtension{TenantID: tenantID, ActorID: actorID, Days: 31, Reason: "Пил"}.Validate(), []string{"days", "reason"}},
		{"переименование", Rename{TenantID: tenantID, ActorID: actorID, Name: "Альта"}.Validate(), nil},
		{"имя из пробелов", Rename{TenantID: tenantID, ActorID: actorID, Name: "   "}.Validate(), []string{"name"}},
		{"имя 151 символ", Rename{TenantID: tenantID, ActorID: actorID, Name: strings.Repeat("ы", 151)}.Validate(), []string{"name"}},
		{"переименование с короткой причиной", Rename{TenantID: tenantID, ActorID: actorID, Name: "Альта", Reason: name("abc")}.Validate(), []string{"reason"}},
	}
	for _, c := range cases {
		if got := fields(c.err); !slices.Equal(got, c.want) {
			t.Errorf("%s: fields %v (err %v), want %v", c.name, got, c.err, c.want)
		}
	}
}

// T-02: If-Match — сильный ETag ревизии: "N" организации (W1.02) и "rev-N" подписки (W1.08); пусто — 428, иное — 412.
func TestParseETag(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]int64{`"7"`: 7, `"rev-7"`: 7, `"123456789"`: 123456789} {
		if got, err := ParseETag(in); err != nil || got != want {
			t.Errorf("%s → %d, %v; want %d", in, got, err, want)
		}
	}
	if _, err := ParseETag("  "); !errors.Is(err, ErrRevisionRequired) {
		t.Errorf("empty: %v", err)
	}
	for _, in := range []string{`7`, `W/"7"`, `"0"`, `"rev-"`, `"-1"`, `"7", "8"`, `*`} {
		if _, err := ParseETag(in); !errors.Is(err, ErrRevisionMismatch) {
			t.Errorf("%s: %v, want ErrRevisionMismatch", in, err)
		}
	}
	if TenantETag(8) != `"8"` || SubscriptionETag(3) != `"rev-3"` {
		t.Errorf("etags %s %s", TenantETag(8), SubscriptionETag(3))
	}
}

// T-02: роли операторов (design/docs/17 «Права», «Роли»).
func TestAllowed(t *testing.T) {
	t.Parallel()
	want := map[string][]string{
		PermTenantsRead:     {RoleOwner, RoleAdmin, RoleBilling, RoleSupport},
		PermUsersRead:       {RoleOwner, RoleAdmin, RoleBilling, RoleSupport},
		PermTenantsManage:   {RoleOwner, RoleAdmin},
		PermBillingManage:   {RoleOwner, RoleAdmin, RoleBilling},
		PermPricingManage:   {RoleOwner, RoleAdmin},
		PermOperatorsManage: {RoleOwner},
	}
	for perm, roles := range want {
		for _, role := range []string{RoleOwner, RoleAdmin, RoleBilling, RoleSupport, "intruder"} {
			if got := Allowed(role, perm); got != slices.Contains(roles, role) {
				t.Errorf("%s %s: %v", role, perm, got)
			}
		}
	}
	if Allowed(RoleOwner, "platform.unknown") {
		t.Error("unknown permission granted")
	}
}

// T-02: приостановка из рабочих состояний (PLAT-02); возобновление — только из suspended, в состояние по подписке
// (Q-W1.00-3: past_due → grace).
func TestSuspendResumeTransitions(t *testing.T) {
	t.Parallel()
	for _, from := range []string{StateTrial, StateActive, StateGrace, StateReadOnly} {
		if to, err := SuspendTo(from); err != nil || to != StateSuspended {
			t.Errorf("suspend from %s: %s %v", from, to, err)
		}
	}
	for _, from := range []string{StateSuspended, StateProvisioning, StateClosing, StateClosed, "unknown"} {
		if _, err := SuspendTo(from); !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("suspend from %s: %v", from, err)
		}
	}
	for status, want := range map[string]string{
		subscriptions.StatusTrialing: StateTrial, subscriptions.StatusActive: StateActive, subscriptions.StatusGrace: StateGrace,
		subscriptions.StatusPastDue: StateGrace, subscriptions.StatusReadOnly: StateReadOnly, subscriptions.StatusCancelled: StateReadOnly,
		"": StateActive,
	} {
		if to, err := ResumeTo(StateSuspended, status); err != nil || to != want {
			t.Errorf("resume with %q: %s %v, want %s", status, to, err, want)
		}
	}
	for _, from := range []string{StateTrial, StateActive, StateGrace, StateReadOnly, StateProvisioning, StateClosed} {
		if _, err := ResumeTo(from, subscriptions.StatusActive); !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("resume from %s: %v", from, err)
		}
	}
}

func ents(sources ...string) []subscriptions.Entitlement {
	out := make([]subscriptions.Entitlement, 0, len(sources))
	for i, s := range sources {
		out = append(out, subscriptions.Entitlement{Key: []string{"seats", "storage_quota_bytes", "extra"}[i], SourceType: s})
	}
	return out
}

// T-02: продление — из trialing, или grace/read_only после неоплаченного пробного периода (Q-W1.00-6); оплаченная
// подписка и организация вне жизненного цикла — 409.
func TestTrialEligibility(t *testing.T) {
	t.Parallel()
	sub := func(status string, e []subscriptions.Entitlement) subscriptions.Subscription {
		return subscriptions.Subscription{Status: status, Entitlements: e}
	}
	ok := []subscriptions.Subscription{
		sub(subscriptions.StatusTrialing, ents("trial", "trial")),
		sub(subscriptions.StatusTrialing, ents("plan", "plan")), // trialing — всегда
		sub(subscriptions.StatusGrace, ents("trial", "trial")),
		sub(subscriptions.StatusReadOnly, ents("trial", "trial", "manual")),
	}
	for _, s := range ok {
		if err := CanExtendTrial(StateTrial, s); err != nil {
			t.Errorf("%s %v: %v", s.Status, s.Entitlements, err)
		}
	}
	refused := []subscriptions.Subscription{
		sub(subscriptions.StatusActive, ents("plan", "plan")),
		sub(subscriptions.StatusPastDue, ents("plan", "plan")),
		sub(subscriptions.StatusCancelled, ents("plan", "plan")),
		sub(subscriptions.StatusGrace, ents("plan", "plan")),      // Карго Сити: после оплаченного периода
		sub(subscriptions.StatusReadOnly, ents("trial", "addon")), // оплаченная надстройка
		sub(subscriptions.StatusGrace, ents("manual")),            // нет прав тарифа — линия неизвестна
		sub(subscriptions.StatusGrace, nil),
	}
	for _, s := range refused {
		if err := CanExtendTrial(StateGrace, s); !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("%s %v: %v, want ErrInvalidTransition", s.Status, s.Entitlements, err)
		}
	}
	for _, st := range []string{StateProvisioning, StateClosing, StateClosed} {
		if err := CanExtendTrial(st, sub(subscriptions.StatusTrialing, ents("trial"))); !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("tenant %s: %v", st, err)
		}
	}
	if err := CanExtendTrial(StateSuspended, sub(subscriptions.StatusTrialing, ents("trial"))); err != nil {
		t.Errorf("suspended trial: %v", err)
	}
}

// T-02: новый срок — от позднейшего из текущего trialEndsAt и «сейчас» (MSW W0.13); у grace/read_only — от «сейчас»:
// истёкшая строка trial назад не растягивается (ревью W1.11).
func TestNextTrialEnd(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.October, 1, 7, 30, 0, 0, time.UTC)
	later := now.Add(5 * 24 * time.Hour)
	earlier := now.Add(-3 * 24 * time.Hour)
	cases := []struct {
		name string
		sub  subscriptions.Subscription
		want time.Time
	}{
		{"срок впереди", subscriptions.Subscription{Status: subscriptions.StatusTrialing, TrialEndsAt: &later}, later.AddDate(0, 0, 14)},
		{"срок прошёл, ещё trialing", subscriptions.Subscription{Status: subscriptions.StatusTrialing, TrialEndsAt: &earlier}, now.AddDate(0, 0, 14)},
		{"grace после trial", subscriptions.Subscription{Status: subscriptions.StatusGrace, TrialEndsAt: &later}, now.AddDate(0, 0, 14)},
		{"read_only", subscriptions.Subscription{Status: subscriptions.StatusReadOnly}, now.AddDate(0, 0, 14)},
	}
	for _, c := range cases {
		if got := NextTrialEnd(c.sub, now, 14); !got.Equal(c.want) {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
}

// T-02: в журнал попадают только скалярные параметры из белого списка; e-mail, хеш заявки и тексты ошибок — нет.
func TestPublicDetails(t *testing.T) {
	t.Parallel()
	raw := []byte(`{"days": 14, "trialEndsAt": "2026-10-15T00:00:00Z", "fromStatus": "trial", "toStatus": "suspended",
		"ownerEmail": "owner@alta.example", "requestHash": "abc", "error": "connect host=secret", "planKey": "start",
		"quotaBytes": 107374182400, "nested": {"a": 1}, "permission": "platform.tenants.manage", "empty": "", "graceEndsAt": "",
		"flag": true}`)
	got := PublicDetails(raw)
	want := map[string]string{
		"days": "14", "trialEndsAt": "2026-10-15T00:00:00Z", "fromStatus": "trial", "toStatus": "suspended", "planKey": "start",
		"quotaBytes": "107374182400", "permission": "platform.tenants.manage",
	}
	if !maps.Equal(got, want) {
		t.Errorf("details %v, want %v", got, want)
	}
	if PublicDetails([]byte(`[1]`)) != nil || PublicDetails(nil) != nil || PublicDetails([]byte(`{"ownerEmail": "x"}`)) != nil {
		t.Error("no public details must be nil")
	}
}

// T-02: курсор журнала непрозрачен и привязан к оператору и фильтру (PlatformAuditPage).
func TestAuditCursor(t *testing.T) {
	t.Parallel()
	other := uuid.MustParse("6f1b8e2a-3c4d-5e6f-8a9b-0c1d2e3f4a5b")
	c := EncodeCursor(123, actorID, &tenantID)
	if strings.Contains(c, "123") || strings.ContainsAny(c, "+/=") {
		t.Errorf("cursor is not opaque URL-safe: %s", c)
	}
	if id, err := DecodeCursor(c, actorID, &tenantID); err != nil || id != 123 {
		t.Errorf("decode: %d %v", id, err)
	}
	for name, decode := range map[string]func() (int64, error){
		"другой оператор": func() (int64, error) { return DecodeCursor(c, other, &tenantID) },
		"без фильтра":     func() (int64, error) { return DecodeCursor(c, actorID, nil) },
		"другой фильтр":   func() (int64, error) { return DecodeCursor(c, actorID, &other) },
		"мусор":           func() (int64, error) { return DecodeCursor("!!!", actorID, nil) },
		"пустой":          func() (int64, error) { return DecodeCursor("", actorID, nil) },
		"слишком длинный": func() (int64, error) { return DecodeCursor(strings.Repeat("a", 3000), actorID, nil) },
		"чужой формат":    func() (int64, error) { return DecodeCursor("eyJpIjowfQ", actorID, nil) },
	} {
		if _, err := decode(); !errors.Is(err, ErrBadCursor) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// T-02: тип цели журнала виден по праву роли на него (описание listPlatformAuditEvents).
func TestVisibleTargets(t *testing.T) {
	t.Parallel()
	for role, want := range map[string][]string{
		RoleOwner:   {"account", "operator", "price_book", "subscription", "tenant"},
		RoleAdmin:   {"account", "price_book", "subscription", "tenant"},
		RoleBilling: {"account", "subscription", "tenant"},
		RoleSupport: {"account", "subscription", "tenant"},
		"intruder":  {},
	} {
		if got := VisibleTargets(role); !slices.Equal(got, want) {
			t.Errorf("%s: %v, want %v", role, got, want)
		}
	}
}
