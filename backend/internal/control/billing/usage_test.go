package billing

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

const gib = int64(1) << 30

// usageRows — организации сида W0.12 глазами «Использования» (места, место, входы) на 01.10 10:30.
func usageRows() []UsageTenant {
	sr12 := uuid.MustParse("d5748522-e6b8-5df4-8a9f-1cbdfef46ed3")
	return []UsageTenant{
		{
			ID: uuid.New(), Name: "Альта Групп", Status: "trial", TierCode: "start", Seats: Seats{Limit: new(10), Active: 7, Invited: 2},
			StorageUsed: 46 * gib, StorageQuota: 100 * gib, ModuleKeys: []string{"fleet"}, MemberCount: 10, ActiveMembers: 7,
			ActiveMembers7d: 7, LastSignIn: new(seedNow.Add(-78 * time.Minute)), TrialEndsAt: new(time.Date(2026, 10, 13, 21, 0, 0, 0, time.UTC)),
		},
		{
			ID: uuid.New(), Name: "SPA «Лотос»", Status: "active", TierCode: "team", Seats: Seats{Limit: new(25), Active: 23},
			StorageUsed: 12 * gib, StorageQuota: 50 * gib, ModuleKeys: []string{"spa"}, MemberCount: 23, ActiveMembers: 23,
			ActiveMembers7d: 12, LastSignIn: new(seedNow.Add(-29 * time.Minute)), Pending: &RequestRef{ID: sr12, Number: "SR-12"},
		},
		{
			ID: uuid.New(), Name: "Ремстрой Плюс", Status: "read_only", TierCode: "start", Seats: Seats{Limit: new(10), Active: 5},
			StorageUsed: 19 * gib, StorageQuota: 25 * gib, ModuleKeys: []string{"repairs"}, MemberCount: 5, ActiveMembers: 5,
			LastSignIn: new(seedNow.Add(-11 * 24 * time.Hour)),
		},
		{
			ID: uuid.New(), Name: "Карго Сити", Status: "suspended", TierCode: "team", Seats: Seats{Limit: new(25), Active: 22},
			StorageUsed: 98 * gib, StorageQuota: 100 * gib, ModuleKeys: []string{"fleet"}, MemberCount: 22, ActiveMembers: 22,
		},
	}
}

type signalKey struct{ tenant, kind, level string }

// signalView is a signal with its parameters as values (nil — absent).
type signalView struct {
	Key                                  signalKey
	SeatsUsed, SeatsLimit, Percent, Days int
	Idle                                 *int
	Request                              string
	Trial                                bool
}

func viewOf(s Signal) signalView {
	v := signalView{
		Key: signalKey{s.TenantName, s.Kind, s.Level}, SeatsUsed: val(s.SeatsUsed), SeatsLimit: val(s.SeatsLimit),
		Percent: val(s.StoragePercent), Days: val(s.DaysLeft), Idle: s.LastSignInDays, Trial: s.TrialEndsAt != nil,
	}
	if s.Request != nil {
		v.Request = s.Request.Number
	}
	return v
}

// Сигналы «Требуют внимания» (17-й документ, пороги — гипотеза): места = лимит — high, ≥ 85% — medium; место ≥ 75% —
// medium, ≥ 95% — high; пробный период ≤ 14 дней — low; read_only — medium; suspended — medium; никто не входил
// больше 7 дней — medium. Порядок — уровень, имя организации, вид.
func TestSignals(t *testing.T) {
	t.Parallel()
	got := []signalView{}
	for _, s := range Signals(usageRows(), seedNow) {
		got = append(got, viewOf(s))
	}
	eq(t, "signals", got, []signalView{
		{Key: signalKey{"Карго Сити", KindStorageHigh, LevelHigh}, Percent: 98},
		{Key: signalKey{"SPA «Лотос»", KindSeatsLow, LevelMedium}, SeatsUsed: 23, SeatsLimit: 25, Request: "SR-12"},
		{Key: signalKey{"Альта Групп", KindSeatsLow, LevelMedium}, SeatsUsed: 9, SeatsLimit: 10},
		{Key: signalKey{"Карго Сити", KindSeatsLow, LevelMedium}, SeatsUsed: 22, SeatsLimit: 25},
		{Key: signalKey{"Карго Сити", KindSuspended, LevelMedium}},
		{Key: signalKey{"Карго Сити", KindInactive, LevelMedium}},
		{Key: signalKey{"Ремстрой Плюс", KindStorageHigh, LevelMedium}, Percent: 76},
		{Key: signalKey{"Ремстрой Плюс", KindTrialExpired, LevelMedium}},
		{Key: signalKey{"Ремстрой Плюс", KindInactive, LevelMedium}, Idle: new(11)},
		{Key: signalKey{"Альта Групп", KindTrialEnding, LevelLow}, Days: 12, Trial: true},
	})
}

// Места заняты полностью — seats_full (high); безлимит и организации вне цикла сигналов мест не дают.
func TestSignalsEdges(t *testing.T) {
	t.Parallel()
	recent := new(seedNow.Add(-time.Hour))
	rows := []UsageTenant{
		{ID: uuid.New(), Name: "Полная", Status: "active", Seats: Seats{Limit: new(10), Active: 10}, StorageQuota: 100 * gib, LastSignIn: recent},
		{ID: uuid.New(), Name: "Безлимит", Status: "active", Seats: Seats{Active: 500}, StorageQuota: 100 * gib, LastSignIn: recent},
		{ID: uuid.New(), Name: "Создаётся", Status: "provisioning", Seats: Seats{Limit: new(1), Active: 1}},
		{ID: uuid.New(), Name: "Без квоты", Status: "active", Seats: Seats{Limit: new(10)}, StorageUsed: 5, LastSignIn: recent},
	}
	got := []signalView{}
	for _, s := range Signals(rows, seedNow) {
		got = append(got, viewOf(s))
	}
	eq(t, "signals", got, []signalView{{Key: signalKey{"Полная", KindSeatsFull, LevelHigh}, SeatsUsed: 10, SeatsLimit: 10}})
}

// Сводка: организации по статусам (порядок PLAT-02), занятые из проданных мест, место, входы за 7 дней; модули — в
// порядке каталога, только подключённые; строки — организации как есть.
func TestSummarize(t *testing.T) {
	t.Parallel()
	u := Summarize(usageRows(), []string{"fleet", "spa", "repairs", "warehouse"}, seedNow)
	eq(t, "summary", u.Summary, Summary{
		TenantCount: 4,
		TenantsByStatus: []StatusCount{
			{Status: "trial", Count: 1}, {Status: "active", Count: 1}, {Status: "read_only", Count: 1}, {Status: "suspended", Count: 1},
		},
		SeatsUsed: 59, SeatsSold: 70, StorageUsedBytes: 175 * gib, StorageQuotaBytes: 275 * gib, ActiveMembers: 57, ActiveMembers7d: 19,
	})
	type moduleView struct {
		Key           string
		Tenants, Used int
		Storage       int64
		Names         []string
	}
	mods := []moduleView{}
	for _, m := range u.Modules {
		names := []string{}
		for _, r := range m.Tenants {
			names = append(names, r.Name)
		}
		mods = append(mods, moduleView{m.ModuleKey, m.TenantCount, m.SeatsUsed, m.StorageUsedBytes, names})
	}
	eq(t, "modules", mods, []moduleView{
		{"fleet", 2, 31, 144 * gib, []string{"Альта Групп", "Карго Сити"}},
		{"spa", 1, 23, 12 * gib, []string{"SPA «Лотос»"}},
		{"repairs", 1, 5, 19 * gib, []string{"Ремстрой Плюс"}},
	})
	eq(t, "measured", u.MeasuredAt, seedNow)
	eq(t, "rows and signals", [2]int{len(u.Tenants), len(u.Signals)}, [2]int{4, 10})
	if !slices.EqualFunc(u.Tenants, usageRows(), func(a, b UsageTenant) bool { return a.Name == b.Name }) {
		t.Error("rows keep their order")
	}
}
