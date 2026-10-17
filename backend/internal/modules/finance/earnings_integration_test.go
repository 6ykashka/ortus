//go:build integration

package finance_test

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	earningsapi "github.com/ortus/ortus-crm/backend/internal/api/earnings"
	"github.com/ortus/ortus-crm/backend/internal/modules/finance" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func rub(minor int) earningsapi.Money { return earningsapi.Money{AmountMinor: minor, Currency: "RUB"} }

// finance0 is the first page of listTripEarnings without filters.
func finance0() finance.ListQuery { return finance.ListQuery{} }

// TestEarningsDraft: an accepted trip has the draft of 0 ₽ at revision 1 by its reviewer at the acceptance, until the
// manager writes the amount (Q-55: the acceptance sets no amount).
func TestEarningsDraft(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr := seedTrip(t, "a", "msk1", "accepted", person("a.driver-msk1"), person("a.manager-msk1"), 30*time.Minute)
	got, err := e.svc.Earnings(t.Context(), e.tc(t, "a.owner", "a"), tr.ID)
	if err != nil {
		t.Fatalf("Earnings: %v", err)
	}
	expect(t, "draft", got, got.TripId == tr.ID, got.DriverMemberId == tr.Driver, got.Amount == rub(0), got.Revision == 1,
		got.UpdatedByMemberId == tr.Reviewer, got.UpdatedAt.Equal(tr.ReviewedAt), got.CalculationNote == nil)
	if n := scalar[int](t, db(t, "a"), `select count(*) from finance.earnings where trip_id = $1`, tr.ID); n != 0 {
		t.Fatalf("a read wrote %d rows, want none", n)
	}
}

// TestEarningsSet: the owner writes the amount with the If-Match of the draft (revision 2, state approved), corrects
// it (revision 3, corrected); every write is a restricted row of the ledger with the amount before and after; the
// note is the one of the latest write. A stale or missing If-Match is 412 or 428.
func TestEarningsSet(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	d := db(t, "a")
	tr := seedTrip(t, "a", "msk1", "accepted", person("a.driver-msk1"), person("a.manager-msk1"), time.Hour)
	owner := e.tc(t, "a.owner", "a")
	_, err := e.svc.Set(t.Context(), owner, tr.ID, "", earningsapi.EarningsUpdate{Amount: rub(450000)})
	wantProblem(t, err, "revision_required", "")
	_, err = e.svc.Set(t.Context(), owner, tr.ID, etag(2), earningsapi.EarningsUpdate{Amount: rub(450000)})
	wantProblem(t, err, "revision_mismatch", "Данные изменились. Обновите страницу и повторите.")
	firstWrite(t, e, tr)
	_, err = e.svc.Set(t.Context(), owner, tr.ID, etag(1), earningsapi.EarningsUpdate{Amount: rub(1)})
	wantProblem(t, err, "revision_mismatch", "")
	got, err := e.svc.Set(t.Context(), owner, tr.ID, etag(2), earningsapi.EarningsUpdate{Amount: rub(480000)})
	if err != nil || got.Revision != 3 || got.Amount != rub(480000) || got.CalculationNote != nil {
		t.Fatalf("correction: %+v %v", got, err)
	}
	if st := scalar[string](t, d, `select state from finance.earnings where trip_id = $1`, tr.ID); st != "corrected" {
		t.Fatalf("state %s, want corrected", st)
	}
	ledger := scalar[string](t, d, `select string_agg(concat_ws(':', sensitivity, diff->>'previousAmountMinor', diff->>'amountMinor',
	    diff->>'revision'), ',' order by id) from audit.events where action = 'finance.earnings.set' and diff->>'tripId' = $1::text`, tr.ID)
	if ledger != "restricted:0:450000:2,restricted:450000:480000:3" {
		t.Fatalf("ledger %q", ledger)
	}
}

// firstWrite: the owner writes 4 500 ₽ with a note over the draft — revision 2, row approved, read back the same.
func firstWrite(t *testing.T, e env, tr trip) {
	t.Helper()
	owner := e.tc(t, "a.owner", "a")
	got, err := e.svc.Set(t.Context(), owner, tr.ID, etag(1), earningsapi.EarningsUpdate{Amount: rub(450000),
		CalculationNote: new("Доплата за выходной")})
	if err != nil {
		t.Fatalf("Set: %v", err)
	}
	expect(t, "written", got, got.Amount == rub(450000), got.Revision == 2, got.UpdatedByMemberId == owner.PersonID,
		got.UpdatedAt.Equal(e.now), got.CalculationNote != nil && *got.CalculationNote == "Доплата за выходной")
	read, err := e.svc.Earnings(t.Context(), owner, tr.ID)
	if err != nil || read.Amount != got.Amount || read.Revision != 2 || read.CalculationNote == nil || *read.CalculationNote != "Доплата за выходной" {
		t.Fatalf("Earnings after the write: %+v %v", read, err)
	}
	if st := scalar[string](t, db(t, "a"), `select state from finance.earnings where trip_id = $1 and person_id = $2 and unit_id = $3`,
		tr.ID, tr.Driver, tr.Unit); st != "approved" {
		t.Fatalf("state %s, want approved", st)
	}
}

// TestEarningsAccess: only an accepted trip has earnings (404 before); a missing or foreign trip is 404; the manager
// of the template without fleet.earnings.read is 403 (Q-22); the work function «Водитель» closes the earnings, even
// the own ones (403 function_blocked, D-10, AC-05).
func TestEarningsAccess(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	submitted := seedTrip(t, "a", "msk1", "submitted", person("a.driver-msk2"), uuid.Nil, 0)
	_, err := e.svc.Earnings(t.Context(), owner, submitted.ID)
	wantProblem(t, err, problem.CodeNotFound, "Начисления по рейсу нет: оно появляется при приёмке смены.")
	_, err = e.svc.Set(t.Context(), owner, submitted.ID, etag(1), earningsapi.EarningsUpdate{Amount: rub(1)})
	wantProblem(t, err, problem.CodeNotFound, "Начисления по рейсу нет: оно появляется при приёмке смены.")
	_, err = e.svc.Earnings(t.Context(), owner, uuid.New())
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	tr := seedTrip(t, "a", "msk1", "accepted", person("a.driver-msk1"), person("a.manager-msk1"), time.Hour)
	_, err = e.svc.Earnings(t.Context(), e.tc(t, "b.owner", "b"), tr.ID)
	wantProblem(t, err, problem.CodeNotFound, "")
	_, err = e.svc.Earnings(t.Context(), e.tc(t, "a.manager-msk1", "a"), tr.ID)
	wantProblem(t, err, problem.CodeForbiddenAction, "")
	_, err = e.svc.Set(t.Context(), e.tc(t, "a.manager-msk1", "a"), tr.ID, etag(1), earningsapi.EarningsUpdate{Amount: rub(1)})
	wantProblem(t, err, problem.CodeForbiddenAction, "")
	for _, actor := range []string{"a.driver-msk1", "a.driver-earnings"} {
		_, err = e.svc.Earnings(t.Context(), e.tc(t, actor, "a"), tr.ID)
		wantProblem(t, err, "function_blocked", "")
		_, err = e.svc.List(t.Context(), e.tc(t, actor, "a"), finance0())
		wantProblem(t, err, "function_blocked", "")
	}
	_, err = e.svc.Set(t.Context(), e.tc(t, "a.driver-msk1", "a"), tr.ID, etag(1), earningsapi.EarningsUpdate{Amount: rub(1)})
	wantProblem(t, err, "function_blocked", "")
	if n := scalar[int](t, db(t, "a"), `select count(*) from finance.earnings where trip_id = any($1::uuid[])`,
		[]uuid.UUID{tr.ID, submitted.ID}); n != 0 {
		t.Fatalf("refused writes left %d rows", n)
	}
}

// pages lists the earnings of unit page by page (one item a page) and returns the trips in order; the written
// earnings of trip written carry 3 000 ₽ at revision 2.
func pages(t *testing.T, e env, tc tenantctx.TenantContext, unit, written uuid.UUID) []uuid.UUID {
	t.Helper()
	q := finance.ListQuery{Unit: unit, Limit: 1}
	var ids []uuid.UUID
	for range 5 {
		got, err := e.svc.List(t.Context(), tc, q)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		for _, it := range got.Items {
			ids = append(ids, it.TripId)
			if it.TripId == written && (it.Amount != rub(300000) || it.Revision != 2) {
				t.Fatalf("written earnings in the list: %+v", it)
			}
		}
		if got.NextCursor == nil {
			break
		}
		q.Cursor = *got.NextCursor
	}
	return ids
}

// TestEarningsList: the earnings of the accepted trips of the subject's scope, newest first, the unit with its
// descendants, keyset pages; trips that are not accepted are not listed; the manager without the right sees none.
func TestEarningsList(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	older := seedTrip(t, "a", "smr2", "accepted", person("a.driver-msk1"), person("a.manager-msk1"), 3*time.Hour)
	newer := seedTrip(t, "a", "smr2", "accepted", person("a.driver-msk2"), person("a.manager-msk1"), 2*time.Hour)
	written := seedTrip(t, "a", "smr2", "accepted", person("a.driver-msk1"), person("a.manager-msk1"), 4*time.Hour)
	seedTrip(t, "a", "smr2", "submitted", person("a.two-roles"), uuid.Nil, 0)
	if _, err := e.svc.Set(t.Context(), owner, written.ID, etag(1), earningsapi.EarningsUpdate{Amount: rub(300000)}); err != nil {
		t.Fatalf("Set: %v", err)
	}
	ids := pages(t, e, owner, ref("unit:a.smr"), written.ID)
	want := []uuid.UUID{written.ID, newer.ID, older.ID} // the write is the newest change, then the acceptances
	if !slices.Equal(ids, want) {
		t.Fatalf("list %v, want %v", ids, want)
	}
	q := finance0()
	q.Unit = ref("unit:a.msk1")
	got, err := e.svc.List(t.Context(), owner, q)
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range got.Items {
		if it.TripId == older.ID || it.TripId == newer.ID || it.TripId == written.ID {
			t.Fatalf("Москва-1 lists a trip of Самара-2: %+v", it)
		}
	}
	got, err = e.svc.List(t.Context(), e.tc(t, "a.manager-msk1", "a"), finance0())
	if err != nil || len(got.Items) != 0 {
		t.Fatalf("manager without fleet.earnings.read: %+v %v, want no earnings", got, err)
	}
}
