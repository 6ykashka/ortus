package files

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Usage is the storage of the tenant (StorageUsage, PLAT-08). The quota is files.usage.limit_bytes; files count
// by the ledger (committed_bytes), the database by its size (an estimate).
type Usage struct {
	QuotaBytes    int64
	FilesBytes    int64
	DatabaseBytes int64
	ReservedBytes int64
	MeasuredAt    time.Time
}

// Committed is the billable committed bytes: files and the estimate of the database.
func (u Usage) Committed() int64 { return u.FilesBytes + u.DatabaseBytes }

// WriteBlocked reports whether new uploads are refused (StorageUsage.writeStatus): the one billable total —
// committed bytes (files and the estimate of the database) plus reservations — reached the quota. The reservation
// of initiateUpload counts the same total (reserveSQL), so blocked means quota_exceeded for any upload.
func (u Usage) WriteBlocked() bool { return u.Committed()+u.ReservedBytes >= u.QuotaBytes }

// Bucket is a group or a module of the breakdown.
type Bucket struct {
	Key   string
	Bytes int64
	Count int64
}

// Breakdown explains the committed bytes by group and by module (StorageBreakdown).
type Breakdown struct {
	Committed     int64
	DatabaseBytes int64
	Groups        []Bucket
	Modules       []Bucket
	MeasuredAt    time.Time
}

// ChangeRequest is the body of requestStorageChange: a quote, or a commit of an accepted quote.
type ChangeRequest struct {
	Requested int64
	Commit    bool
	QuoteID   uuid.UUID
}

// Change is the answer of requestStorageChange (StorageChange).
type Change struct {
	ID, QuoteID    uuid.UUID
	State          string
	Requested      int64
	ChargeMinor    int64
	QuoteExpiresAt *time.Time
	EffectiveAt    *time.Time
}

// Group keys of the prototype (StorageBreakdownGroup.key) and the group of each purpose.
const (
	groupPhotos      = "photos"
	groupDocuments   = "documents"
	groupAttachments = "attachments"
	groupOther       = "other"
	moduleCore       = "core" // the database
	maxModules       = 50
)

var (
	groupKeys      = []string{groupPhotos, groupDocuments, groupAttachments, groupOther}
	groupOfPurpose = map[Purpose]string{
		PurposeInspection: groupPhotos, PurposeRepairEvidence: groupPhotos,
		PurposeKnowledgeAttachment: groupAttachments, PurposeFormAttachment: groupAttachments, PurposeChatAttachment: groupAttachments,
		PurposeExpenseReceipt: groupOther, // «receipts outside documents»
	}
)

const databaseSizeSQL = `select pg_database_size(current_database())`

// Usage returns the storage of the tenant (getStorageUsage). Before the first upload the quota is the default.
func (s *Service) Usage(ctx context.Context, tc tenantctx.TenantContext) (Usage, error) {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return Usage{}, err
	}
	u := Usage{QuotaBytes: DefaultQuotaBytes, MeasuredAt: s.now()}
	err = pool.QueryRow(ctx, `select limit_bytes, committed_bytes, reserved_bytes from files.usage where singleton`).
		Scan(&u.QuotaBytes, &u.FilesBytes, &u.ReservedBytes)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Usage{}, fmt.Errorf("files: usage: %w", err)
	}
	if err := pool.QueryRow(ctx, databaseSizeSQL).Scan(&u.DatabaseBytes); err != nil {
		return Usage{}, fmt.Errorf("files: database size: %w", err)
	}
	return u, nil
}

// Breakdown explains the committed bytes twice — by the four groups of the prototype and by the modules that own
// the parents (getStorageBreakdown, S1-22); each list adds up to Committed. Disabled modules keep their bytes.
func (s *Service) Breakdown(ctx context.Context, tc tenantctx.TenantContext) (Breakdown, error) {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return Breakdown{}, err
	}
	b := Breakdown{MeasuredAt: s.now()}
	if err := pool.QueryRow(ctx, databaseSizeSQL).Scan(&b.DatabaseBytes); err != nil {
		return Breakdown{}, fmt.Errorf("files: database size: %w", err)
	}
	rows, err := pool.Query(ctx, `select purpose, owner_type, coalesce(sum(bytes), 0)::bigint, count(*)
	                                from files.objects where state in ('scanning', 'ready') group by 1, 2`)
	if err != nil {
		return Breakdown{}, fmt.Errorf("files: breakdown: %w", err)
	}
	groups := map[string]*Bucket{}
	for _, k := range groupKeys {
		groups[k] = &Bucket{Key: k}
	}
	modules := map[string]*Bucket{moduleCore: {Key: moduleCore}}
	var purpose, ownerType string
	var bytes, count int64
	_, err = pgx.ForEachRow(rows, []any{&purpose, &ownerType, &bytes, &count}, func() error {
		g := groups[cmp.Or(groupOfPurpose[Purpose(purpose)], groupOther)]
		g.Bytes += bytes
		g.Count += count
		module, _, _ := strings.Cut(ownerType, ".")
		if modules[module] == nil {
			modules[module] = &Bucket{Key: module}
		}
		modules[module].Bytes += bytes
		modules[module].Count += count
		b.Committed += bytes
		return nil
	})
	if err != nil {
		return Breakdown{}, fmt.Errorf("files: breakdown: %w", err)
	}
	groups[groupOther].Bytes += b.DatabaseBytes
	modules[moduleCore].Bytes += b.DatabaseBytes
	b.Committed += b.DatabaseBytes
	for _, k := range groupKeys {
		b.Groups = append(b.Groups, *groups[k])
	}
	for _, m := range modules {
		b.Modules = append(b.Modules, *m)
	}
	slices.SortFunc(b.Modules, func(x, y Bucket) int { return cmp.Or(cmp.Compare(y.Bytes, x.Bytes), cmp.Compare(x.Key, y.Key)) })
	if len(b.Modules) > maxModules {
		b.Modules = b.Modules[:maxModules]
	}
	return b, nil
}

// RequestChange quotes or commits a quota change (requestStorageChange, PLAT-06). The new quota must hold the
// committed bytes and the upload reservations (409 downgrade_below_usage). A commit takes a quote of the last
// hour for the same volume and the current quota and applies at once (Q-12); it is audited.
func (s *Service) RequestChange(ctx context.Context, tc tenantctx.TenantContext, r ChangeRequest) (Change, error) {
	if r.Requested < 1 {
		return Change{}, invalid("Укажите новую квоту.")
	}
	u, err := s.Usage(ctx, tc)
	if err != nil {
		return Change{}, err
	}
	if used := u.Committed() + u.ReservedBytes; r.Requested < used {
		return Change{}, problem.New(codeDowngrade, DowngradeDetail(r.Requested, used))
	}
	now := s.now()
	if !r.Commit {
		q := QuoteID(tc.TenantID, r.Requested, u.QuotaBytes, now)
		exp := QuoteExpiresAt(now)
		return Change{ID: ChangeID(q), QuoteID: q, State: "quoted", Requested: r.Requested,
			ChargeMinor: QuoteCharge(r.Requested), QuoteExpiresAt: &exp}, nil
	}
	if r.QuoteID == uuid.Nil || !QuoteValid(r.QuoteID, tc.TenantID, r.Requested, u.QuotaBytes, now) {
		return Change{}, invalid("Подтвердите действующий расчёт.")
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return Change{}, err
	}
	err = inTx(ctx, pool, func(tx pgx.Tx) error {
		return applyQuota(ctx, tx, tc, u, r)
	})
	if err != nil {
		return Change{}, err
	}
	return Change{ID: ChangeID(r.QuoteID), QuoteID: r.QuoteID, State: "applied", Requested: r.Requested,
		ChargeMinor: QuoteCharge(r.Requested), EffectiveAt: &now}, nil
}

// applyQuota sets the new quota if the quote still matches it and the usage fits, and audits the change.
func applyQuota(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, u Usage, r ChangeRequest) error {
	if _, err := tx.Exec(ctx, ensureUsageSQL, DefaultQuotaBytes); err != nil {
		return fmt.Errorf("files: usage: %w", err)
	}
	tag, err := tx.Exec(ctx, `update files.usage set limit_bytes = $1, updated_at = now()
	                           where singleton and limit_bytes = $2 and committed_bytes + reserved_bytes + $3 <= $1`,
		r.Requested, u.QuotaBytes, u.DatabaseBytes)
	if err != nil {
		return fmt.Errorf("files: quota: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var current int64
		if err := tx.QueryRow(ctx, `select limit_bytes from files.usage where singleton`).Scan(&current); err != nil {
			return fmt.Errorf("files: quota: %w", err)
		}
		if current != u.QuotaBytes {
			return invalid("Подтвердите действующий расчёт.")
		}
		return problem.New(codeDowngrade, DowngradeDetail(r.Requested, u.Committed()+u.ReservedBytes))
	}
	reqID := requestid.FromContext(ctx)
	if reqID == "" {
		reqID = "files:" + uuid.NewString()
	}
	return audit.Record(ctx, tx, audit.Event{
		ActorKind: audit.ActorPerson, ActorID: tc.PersonID, Action: "billing.storage.change", TargetType: "files.usage",
		TargetID: tc.TenantID, Sensitivity: audit.Sensitive, Result: audit.OK, RequestID: reqID,
		Diff: map[string]any{"fromBytes": u.QuotaBytes, "toBytes": r.Requested, "quoteId": r.QuoteID.String()},
	})
}
