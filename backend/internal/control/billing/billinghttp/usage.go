package billinghttp

import (
	"context"
	"time"

	"github.com/google/uuid"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

type seatsView struct {
	Limit     *int `json:"limit"`
	Used      int  `json:"used"`
	Active    int  `json:"active"`
	Invited   int  `json:"invited"`
	Available *int `json:"available"`
}

func seats(s billing.Seats) seatsView {
	return seatsView{Limit: s.Limit, Used: s.Used(), Active: s.Active, Invited: s.Invited, Available: s.Available()}
}

type usageTenantView struct {
	TenantID        uuid.UUID                    `json:"tenantId"`
	Name            string                       `json:"name"`
	Status          string                       `json:"status"`
	OwnerName       string                       `json:"ownerName,omitempty"`
	TierCode        string                       `json:"tierCode,omitempty"`
	TierName        string                       `json:"tierName,omitempty"`
	Seats           seatsView                    `json:"seats"`
	StorageUsed     int64                        `json:"storageUsedBytes"`
	StorageQuota    int64                        `json:"storageQuotaBytes"`
	ModuleKeys      []string                     `json:"moduleKeys"`
	MemberCount     int                          `json:"memberCount"`
	ActiveMembers   int                          `json:"activeMembers"`
	ActiveMembers7d int                          `json:"activeMembers7d"`
	LastSignInAt    *time.Time                   `json:"lastSignInAt,omitempty"`
	Brand           *platformapi.TenantBrandMark `json:"brand,omitempty"`
}

type signalView struct {
	TenantID            uuid.UUID  `json:"tenantId"`
	TenantName          string     `json:"tenantName"`
	Kind                string     `json:"kind"`
	Level               string     `json:"level"`
	SeatsUsed           *int       `json:"seatsUsed,omitempty"`
	SeatsLimit          *int       `json:"seatsLimit,omitempty"`
	StorageUsedBytes    *int64     `json:"storageUsedBytes,omitempty"`
	StorageQuotaBytes   *int64     `json:"storageQuotaBytes,omitempty"`
	StoragePercent      *int       `json:"storagePercent,omitempty"`
	TrialEndsAt         *time.Time `json:"trialEndsAt,omitempty"`
	DaysLeft            *int       `json:"daysLeft,omitempty"`
	LastSignInDays      *int       `json:"lastSignInDays,omitempty"`
	ChangeRequestID     *uuid.UUID `json:"changeRequestId,omitempty"`
	ChangeRequestNumber *string    `json:"changeRequestNumber,omitempty"`
}

type namedTenantView struct {
	TenantID uuid.UUID `json:"tenantId"`
	Name     string    `json:"name"`
}

type moduleView struct {
	ModuleKey        string            `json:"moduleKey"`
	TenantCount      int               `json:"tenantCount"`
	SeatsUsed        int               `json:"seatsUsed"`
	StorageUsedBytes int64             `json:"storageUsedBytes"`
	Tenants          []namedTenantView `json:"tenants"`
}

type statusCountView struct {
	Status string `json:"status"`
	Count  int    `json:"count"`
}

type summaryView struct {
	TenantCount       int               `json:"tenantCount"`
	TenantsByStatus   []statusCountView `json:"tenantsByStatus"`
	SeatsUsed         int               `json:"seatsUsed"`
	SeatsSold         int               `json:"seatsSold"`
	StorageUsedBytes  int64             `json:"storageUsedBytes"`
	StorageQuotaBytes int64             `json:"storageQuotaBytes"`
	ActiveMembers     int               `json:"activeMembers"`
	ActiveMembers7d   int               `json:"activeMembers7d"`
}

type usageView struct {
	MeasuredAt time.Time         `json:"measuredAt"`
	Summary    summaryView       `json:"summary"`
	Signals    []signalView      `json:"signals"`
	Modules    []moduleView      `json:"modules"`
	Tenants    []usageTenantView `json:"tenants"`
}

// usageOf is the Использование screen with the signs of marks.
func usageOf(u billing.Usage, marks map[uuid.UUID]platformapi.TenantBrandMark) usageView {
	s := u.Summary
	out := usageView{
		MeasuredAt: u.MeasuredAt,
		Summary: summaryView{
			TenantCount: s.TenantCount, TenantsByStatus: make([]statusCountView, 0, len(s.TenantsByStatus)), SeatsUsed: s.SeatsUsed,
			SeatsSold: s.SeatsSold, StorageUsedBytes: s.StorageUsedBytes, StorageQuotaBytes: s.StorageQuotaBytes,
			ActiveMembers: s.ActiveMembers, ActiveMembers7d: s.ActiveMembers7d,
		},
		Signals: make([]signalView, 0, len(u.Signals)), Modules: make([]moduleView, 0, len(u.Modules)),
		Tenants: make([]usageTenantView, 0, len(u.Tenants)),
	}
	for _, b := range s.TenantsByStatus {
		out.Summary.TenantsByStatus = append(out.Summary.TenantsByStatus, statusCountView(b))
	}
	for _, sig := range u.Signals {
		out.Signals = append(out.Signals, signalOf(sig))
	}
	for _, m := range u.Modules {
		mv := moduleView{ModuleKey: m.ModuleKey, TenantCount: m.TenantCount, SeatsUsed: m.SeatsUsed, StorageUsedBytes: m.StorageUsedBytes,
			Tenants: make([]namedTenantView, 0, len(m.Tenants))}
		for _, r := range m.Tenants {
			mv.Tenants = append(mv.Tenants, namedTenantView{TenantID: r.ID, Name: r.Name})
		}
		out.Modules = append(out.Modules, mv)
	}
	for _, r := range u.Tenants {
		row := usageTenantView{
			TenantID: r.ID, Name: r.Name, Status: r.Status, OwnerName: r.OwnerName, TierCode: r.TierCode, TierName: r.TierName,
			Seats: seats(r.Seats), StorageUsed: r.StorageUsed, StorageQuota: r.StorageQuota, ModuleKeys: r.ModuleKeys,
			MemberCount: r.MemberCount, ActiveMembers: r.ActiveMembers, ActiveMembers7d: r.ActiveMembers7d, LastSignInAt: r.LastSignIn,
		}
		if row.ModuleKeys == nil {
			row.ModuleKeys = []string{}
		}
		if m, ok := marks[r.ID]; ok {
			row.Brand = &m
		}
		out.Tenants = append(out.Tenants, row)
	}
	return out
}

func signalOf(s billing.Signal) signalView {
	out := signalView{
		TenantID: s.TenantID, TenantName: s.TenantName, Kind: s.Kind, Level: s.Level, SeatsUsed: s.SeatsUsed, SeatsLimit: s.SeatsLimit,
		StorageUsedBytes: s.StorageUsed, StorageQuotaBytes: s.StorageQuota, StoragePercent: s.StoragePercent, TrialEndsAt: s.TrialEndsAt,
		DaysLeft: s.DaysLeft, LastSignInDays: s.LastSignInDays,
	}
	if s.Request != nil {
		out.ChangeRequestID, out.ChangeRequestNumber = &s.Request.ID, &s.Request.Number
	}
	return out
}

// GetPlatformUsage implements platformapi.StrictServerInterface: the Использование screen from the metadata of the
// control DB with the signs of the tenants.
func (s PlatformServer) GetPlatformUsage(ctx context.Context, _ platformapi.GetPlatformUsageRequestObject) (platformapi.GetPlatformUsageResponseObject, error) {
	u, err := s.Store.Usage(ctx, s.Modules, s.ModuleOrder)
	if err != nil {
		return nil, storeError(err)
	}
	ids := make([]uuid.UUID, 0, len(u.Tenants))
	for _, r := range u.Tenants {
		ids = append(ids, r.ID)
	}
	marks, err := s.marks(ctx, ids)
	if err != nil {
		return nil, err
	}
	body, err := recast[platformapi.PlatformUsage](usageOf(u, marks))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid := headers(ctx)
	return platformapi.GetPlatformUsage200JSONResponse{Body: body,
		Headers: platformapi.GetPlatformUsage200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// marks are the signs of ids (none without Marks); a failure is dependency_unavailable.
func (s PlatformServer) marks(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]platformapi.TenantBrandMark, error) {
	if s.Marks == nil || len(ids) == 0 {
		return nil, nil
	}
	m, err := s.Marks.Marks(ctx, ids)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return m, nil
}
