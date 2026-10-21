package billing

import (
	"cmp"
	"math"
	"slices"
	"time"

	"github.com/google/uuid"
)

// RequestRef is the pending tier request of a tenant (the action Открыть заявку of a seats signal).
type RequestRef struct {
	ID     uuid.UUID
	Number string
}

// UsageTenant is one organization of the Использование screen: control DB metadata only (seats, the latest storage
// snapshot, installed modules, sign-in dates), never the content of the organization.
type UsageTenant struct {
	ID                                          uuid.UUID
	Name, Status, OwnerName                     string
	TierCode, TierName                          string
	Seats                                       Seats
	StorageUsed, StorageQuota                   int64
	ModuleKeys                                  []string
	MemberCount, ActiveMembers, ActiveMembers7d int
	LastSignIn                                  *time.Time // the last sign-in of an active member; nil — nobody ever
	TrialEndsAt                                 *time.Time // the end of a trial subscription
	Pending                                     *RequestRef
}

// Kinds and levels of a signal (PlatformUsageSignal).
const (
	KindSeatsFull    = "seats_full"
	KindSeatsLow     = "seats_low"
	KindStorageHigh  = "storage_high"
	KindTrialEnding  = "trial_ending"
	KindTrialExpired = "trial_expired"
	KindSuspended    = "suspended"
	KindInactive     = "inactive"

	LevelHigh   = "high"
	LevelMedium = "medium"
	LevelLow    = "low"
)

// Thresholds of the signals (17-users-and-billing «Использование»: a hypothesis, may move to platform settings).
const (
	seatsLowShare    = 0.85
	storageHighShare = 0.75
	storageFullShare = 0.95
	trialEndingDays  = 14
	inactiveDays     = 7
)

var (
	kindOrder   = []string{KindSeatsFull, KindSeatsLow, KindStorageHigh, KindTrialEnding, KindTrialExpired, KindSuspended, KindInactive}
	levelOrder  = []string{LevelHigh, LevelMedium, LevelLow}
	statusOrder = []string{"provisioning", "trial", "active", "grace", "read_only", "suspended", "closing", "closed"}
)

// Signal is one line of Требуют внимания; the client builds the text from the kind and its parameters.
type Signal struct {
	TenantID                  uuid.UUID
	TenantName, Kind, Level   string
	SeatsUsed, SeatsLimit     *int
	StorageUsed, StorageQuota *int64
	StoragePercent            *int
	TrialEndsAt               *time.Time
	DaysLeft, LastSignInDays  *int
	Request                   *RequestRef
}

const day = 24 * time.Hour

// Signals are the signals of rows at now, the most urgent first (level, then the name of the organization, then the
// kind; MSW usage.ts). Organizations being created or closed give none.
func Signals(rows []UsageTenant, now time.Time) []Signal {
	var out []Signal
	for _, r := range rows {
		if r.Status == "closed" || r.Status == "provisioning" {
			continue
		}
		out = append(out, signalsOf(r, now)...)
	}
	slices.SortStableFunc(out, func(a, b Signal) int {
		return cmp.Or(
			slices.Index(levelOrder, a.Level)-slices.Index(levelOrder, b.Level),
			cmp.Compare(a.TenantName, b.TenantName),
			slices.Index(kindOrder, a.Kind)-slices.Index(kindOrder, b.Kind),
		)
	})
	return out
}

// signalsOf are the signals of one organization in the order of the kinds.
func signalsOf(r UsageTenant, now time.Time) []Signal {
	var out []Signal
	for _, check := range []func(UsageTenant, time.Time) (Signal, bool){seatsSignal, storageSignal, trialSignal, stateSignal, idleSignal} {
		if s, ok := check(r, now); ok {
			s.TenantID, s.TenantName = r.ID, r.Name
			out = append(out, s)
		}
	}
	return out
}

// seatsSignal: occupied seats reach 85% of the limit (seats_low) or the whole of it (seats_full), with the pending
// request of the tenant.
func seatsSignal(r UsageTenant, _ time.Time) (Signal, bool) {
	lim := r.Seats.Limit
	if lim == nil || *lim <= 0 || float64(r.Seats.Used())/float64(*lim) < seatsLowShare {
		return Signal{}, false
	}
	s := Signal{Kind: KindSeatsLow, Level: LevelMedium, SeatsUsed: new(r.Seats.Used()), SeatsLimit: new(*lim), Request: r.Pending}
	if r.Seats.Used() >= *lim {
		s.Kind, s.Level = KindSeatsFull, LevelHigh
	}
	return s, true
}

// storageSignal: storage in use reaches 75% of the quota (medium) or 95% (high).
func storageSignal(r UsageTenant, _ time.Time) (Signal, bool) {
	if r.StorageQuota <= 0 {
		return Signal{}, false
	}
	share := float64(r.StorageUsed) / float64(r.StorageQuota)
	if share < storageHighShare {
		return Signal{}, false
	}
	s := Signal{
		Kind: KindStorageHigh, Level: LevelMedium, StorageUsed: new(r.StorageUsed), StorageQuota: new(r.StorageQuota),
		StoragePercent: new(int(math.Round(share * 100))),
	}
	if share >= storageFullShare {
		s.Level = LevelHigh
	}
	return s, true
}

// trialSignal: a trial ends in 14 days or less.
func trialSignal(r UsageTenant, now time.Time) (Signal, bool) {
	if r.Status != "trial" || r.TrialEndsAt == nil || !r.TrialEndsAt.After(now) {
		return Signal{}, false
	}
	left := int(r.TrialEndsAt.Sub(now) / day)
	if left > trialEndingDays {
		return Signal{}, false
	}
	return Signal{Kind: KindTrialEnding, Level: LevelLow, TrialEndsAt: new(*r.TrialEndsAt), DaysLeft: &left}, true
}

// stateSignal: read_only after an unpaid trial, suspended.
func stateSignal(r UsageTenant, _ time.Time) (Signal, bool) {
	switch r.Status {
	case "read_only":
		return Signal{Kind: KindTrialExpired, Level: LevelMedium}, true
	case "suspended":
		return Signal{Kind: KindSuspended, Level: LevelMedium}, true
	}
	return Signal{}, false
}

// idleSignal: nobody signed in for more than 7 days, or ever.
func idleSignal(r UsageTenant, now time.Time) (Signal, bool) {
	if r.LastSignIn == nil {
		return Signal{Kind: KindInactive, Level: LevelMedium}, true
	}
	idle := int(now.Sub(*r.LastSignIn) / day)
	if idle <= inactiveDays {
		return Signal{}, false
	}
	return Signal{Kind: KindInactive, Level: LevelMedium, LastSignInDays: &idle}, true
}

// StatusCount is the number of organizations in one status.
type StatusCount struct {
	Status string
	Count  int
}

// Summary is the summary of the platform (PlatformUsageSummary).
type Summary struct {
	TenantCount                         int
	TenantsByStatus                     []StatusCount
	SeatsUsed, SeatsSold                int
	StorageUsedBytes, StorageQuotaBytes int64
	ActiveMembers, ActiveMembers7d      int
}

// ModuleUsage is an industry module with its organizations (PlatformUsageModule).
type ModuleUsage struct {
	ModuleKey        string
	TenantCount      int
	SeatsUsed        int
	StorageUsedBytes int64
	Tenants          []UsageTenant
}

// Usage is the Использование screen (PlatformUsage).
type Usage struct {
	MeasuredAt time.Time
	Summary    Summary
	Signals    []Signal
	Modules    []ModuleUsage
	Tenants    []UsageTenant
}

// Summarize builds the screen of rows at now: the summary (statuses in the order of PLAT-02, seats sold — the sum of
// the limits of the tenants with a limit), the signals, the installed modules in moduleOrder and the rows.
func Summarize(rows []UsageTenant, moduleOrder []string, now time.Time) Usage {
	u := Usage{MeasuredAt: now, Signals: Signals(rows, now), Tenants: rows, Modules: []ModuleUsage{}}
	s := Summary{TenantCount: len(rows), TenantsByStatus: []StatusCount{}}
	for _, r := range rows {
		s.SeatsUsed += r.Seats.Used()
		if r.Seats.Limit != nil {
			s.SeatsSold += *r.Seats.Limit
		}
		s.StorageUsedBytes += r.StorageUsed
		s.StorageQuotaBytes += r.StorageQuota
		s.ActiveMembers += r.ActiveMembers
		s.ActiveMembers7d += r.ActiveMembers7d
	}
	for _, st := range statusOrder {
		if n := countFunc(rows, func(r UsageTenant) bool { return r.Status == st }); n > 0 {
			s.TenantsByStatus = append(s.TenantsByStatus, StatusCount{Status: st, Count: n})
		}
	}
	u.Summary = s
	for _, key := range moduleOrder {
		m := ModuleUsage{ModuleKey: key}
		for _, r := range rows {
			if slices.Contains(r.ModuleKeys, key) {
				m.TenantCount++
				m.SeatsUsed += r.Seats.Used()
				m.StorageUsedBytes += r.StorageUsed
				m.Tenants = append(m.Tenants, r)
			}
		}
		if m.TenantCount > 0 {
			u.Modules = append(u.Modules, m)
		}
	}
	return u
}

func countFunc[T any](s []T, f func(T) bool) int {
	n := 0
	for _, v := range s {
		if f(v) {
			n++
		}
	}
	return n
}
