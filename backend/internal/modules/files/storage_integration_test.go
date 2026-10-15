//go:build integration

package files_test

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// S1-22, PLAT-08 on tenant B (sequential: the counters of B are exact). Usage before any file and after a ready
// file; the breakdown adds up twice to the committed bytes.
func TestStorageUsageAndBreakdown(t *testing.T) { //nolint:paralleltest // exact counters of tenant B
	e := newEnv(t)
	ctx := t.Context()
	owner := e.tc(t, "b.owner", "b")
	u0, err := e.svc.Usage(ctx, owner)
	expect(t, "usage before files", u0, err == nil, u0.QuotaBytes == files.DefaultQuotaBytes, u0.FilesBytes == 0,
		u0.ReservedBytes == 0, u0.DatabaseBytes > 0, u0.Committed() == u0.DatabaseBytes, !u0.WriteBlocked(),
		time.Since(u0.MeasuredAt) < time.Minute)

	size := int64(len(jpeg))
	e.ready(t, e.tc(t, "b.manager-msk1", "b"), newUpload("trip:b1", "trip", files.PurposeInspection, "image/jpeg", "B.jpg", jpeg), jpeg)
	u1, _ := e.svc.Usage(ctx, owner)
	expect(t, "usage after a file", u1, u1.FilesBytes == size, u1.ReservedBytes == 0)

	b, err := e.svc.Breakdown(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	groups := map[string]files.Bucket{}
	var gsum, msum int64
	for _, g := range b.Groups {
		groups[g.Key] = g
		gsum += g.Bytes
	}
	modules := map[string]files.Bucket{}
	for _, m := range b.Modules {
		modules[m.Key] = m
		msum += m.Bytes
	}
	expect(t, "groups", b.Groups, len(b.Groups) == 4, groups["photos"].Bytes == size, groups["photos"].Count == 1,
		groups["documents"].Bytes == 0, groups["attachments"].Bytes == 0, groups["other"].Bytes == b.DatabaseBytes)
	expect(t, "modules", b.Modules, modules["fleet"].Bytes == size, modules["fleet"].Count == 1, modules["core"].Bytes == b.DatabaseBytes)
	expect(t, "sums", b, gsum == b.Committed, msum == b.Committed, b.Committed == b.DatabaseBytes+size)
}

// setRoom sets the quota of tenant B to what is used now — files, the estimate of the database and reservations,
// the one total of StorageUsage — plus room bytes.
func setRoom(t *testing.T, room int64) {
	t.Helper()
	q := `update files.usage set limit_bytes = committed_bytes + reserved_bytes + pg_database_size(current_database()) + $1`
	if _, err := db(t, "b").ExecContext(t.Context(), q, room); err != nil {
		t.Fatal(err)
	}
}

// PLAT-07: StorageUsage has one total (committedBytes — files and the database — plus reservedBytes). writeStatus
// is blocked when it reached the quota, and exactly then initiateUpload refuses (quota_exceeded): the screen and
// the reservation count the same bytes.
func TestStorageFullBlocksWrites(t *testing.T) { //nolint:paralleltest // changes the quota of tenant B
	e := newEnv(t)
	ctx := t.Context()
	owner, manager := e.tc(t, "b.owner", "b"), e.tc(t, "b.manager-msk1", "b")
	e.ready(t, manager, newUpload("trip:b1", "trip", files.PurposeInspection, "image/jpeg", "B3.jpg", jpeg), jpeg) // files.usage exists
	setRoom(t, 0)
	u, err := e.svc.Usage(ctx, owner)
	expect(t, "usage at the quota", u, err == nil, u.Committed()+u.ReservedBytes >= u.QuotaBytes, u.WriteBlocked())
	_, err = e.svc.Initiate(ctx, manager, newUpload("trip:b1", "trip", files.PurposeInspection, "image/jpeg", "Полно.jpg", jpeg))
	wantCode(t, err, "quota_exceeded")

	setRoom(t, 64<<20)
	u, _ = e.svc.Usage(ctx, owner)
	expect(t, "usage with room", u, u.Committed()+u.ReservedBytes < u.QuotaBytes, !u.WriteBlocked())
	tk, err := e.svc.Initiate(ctx, manager, newUpload("trip:b1", "trip", files.PurposeInspection, "image/jpeg", "Есть место.jpg", jpeg))
	if err != nil {
		t.Fatalf("Initiate with room: %v", err)
	}
	if err := e.svc.Abort(ctx, manager, tk.UploadID); err != nil {
		t.Fatal(err)
	}
}

// PLAT-07, A-10 (brief T-5): 20 parallel reservations of 2 MiB into room for 5 — exactly 5 reservations and 15 ×
// quota_exceeded; the reservations count against the quota until they are released. The declared size is large
// against the growth of the database during the run (pages of the new rows).
func TestStorageQuotaUnderConcurrency(t *testing.T) { //nolint:paralleltest // changes the quota of tenant B
	e := newEnv(t)
	ctx := t.Context()
	owner, manager := e.tc(t, "b.owner", "b"), e.tc(t, "b.manager-msk1", "b")
	const size = 2 << 20
	e.ready(t, manager, newUpload("trip:b1", "trip", files.PurposeInspection, "image/jpeg", "B2.jpg", jpeg), jpeg) // files.usage exists
	setRoom(t, 5*size+size/2)
	tickets, full := initiateMany(t, e, manager, 20, size)
	expect(t, "reservations", []int{len(tickets), full}, len(tickets) == 5, full == 15)
	u, _ := e.svc.Usage(ctx, owner)
	expect(t, "usage with reservations", u, u.ReservedBytes == 5*size)
	for _, tk := range tickets {
		if err := e.svc.Abort(ctx, manager, tk.UploadID); err != nil {
			t.Fatal(err)
		}
	}
	u, _ = e.svc.Usage(ctx, owner)
	expect(t, "usage after aborts", u, u.ReservedBytes == 0, !u.WriteBlocked())
}

// initiateMany starts n uploads of size declared bytes concurrently and returns the tickets and the number of
// quota_exceeded.
func initiateMany(t *testing.T, e env, tc tenantctx.TenantContext, n int, size int64) ([]files.Ticket, int) {
	t.Helper()
	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		tickets []files.Ticket
		full    int
	)
	for range n {
		wg.Go(func() {
			u := newUpload("trip:b1", "trip", files.PurposeInspection, "image/jpeg", "q.jpg", jpeg)
			u.SizeBytes = size
			tk, err := e.svc.Initiate(t.Context(), tc, u)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				tickets = append(tickets, tk)
			case isCode(err, "quota_exceeded"):
				full++
			default:
				t.Errorf("Initiate: %v", err)
			}
		})
	}
	wg.Wait()
	return tickets, full
}

// requestStorageChange: a quote, its commit (applied at once — Q-12), a stale quote, a downgrade below usage.
func TestStorageChange(t *testing.T) { //nolint:paralleltest // changes the quota of tenant B
	e := newEnv(t)
	ctx := t.Context()
	owner := e.tc(t, "b.owner", "b")
	const requested = 200 << 30
	q, err := e.svc.RequestChange(ctx, owner, files.ChangeRequest{Requested: requested})
	expect(t, "quote", q, err == nil, q.State == "quoted", q.QuoteID != uuid.Nil, q.ChargeMinor == 200000,
		q.QuoteExpiresAt != nil, q.EffectiveAt == nil)
	expect(t, "quote expiry", q.QuoteExpiresAt, time.Until(*q.QuoteExpiresAt) <= files.QuoteTTL)

	_, err = e.svc.RequestChange(ctx, owner, files.ChangeRequest{Requested: requested, Commit: true})
	wantCode(t, err, "validation_failed") // no quote
	_, err = e.svc.RequestChange(ctx, owner, files.ChangeRequest{Requested: requested + 1, Commit: true, QuoteID: q.QuoteID})
	wantCode(t, err, "validation_failed") // another volume

	c, err := e.svc.RequestChange(ctx, owner, files.ChangeRequest{Requested: requested, Commit: true, QuoteID: q.QuoteID})
	expect(t, "commit", c, err == nil, c.State == "applied", c.ID == q.ID, c.EffectiveAt != nil, c.ChargeMinor == 200000)
	u, _ := e.svc.Usage(ctx, owner)
	expect(t, "quota after commit", u, u.QuotaBytes == requested)

	_, err = e.svc.RequestChange(ctx, owner, files.ChangeRequest{Requested: requested, Commit: true, QuoteID: q.QuoteID})
	wantCode(t, err, "validation_failed") // a quote of the previous quota
	_, err = e.svc.RequestChange(ctx, owner, files.ChangeRequest{Requested: 1})
	wantCode(t, err, "downgrade_below_usage")
	n := scalar[int](t, db(t, "b"), `select count(*) from audit.events where action = 'billing.storage.change' and result = 'ok'`)
	expect(t, "audit events", n, n == 1)
}
