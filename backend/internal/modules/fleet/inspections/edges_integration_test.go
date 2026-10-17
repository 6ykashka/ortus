//go:build integration

package inspections_test

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/inspections" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Two blocking defects of one departure: the first decision leaves the trip in review while the other waits; the
// confirmation of the second sends the trip back to planning. One notification for the inspection (the first zone).
func TestTwoBlockingDefects(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	got, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, tr, critical("Шины и колёса"), critical("Тормоза и ходовая")))
	if err != nil {
		t.Fatal(err)
	}
	defects := *got.Defects
	expect(t, "defects", defects, len(defects) == 2, defects[0].State == "in_review", defects[1].State == "in_review")
	manager := e.tc(t, "a.manager-msk1", "a")
	if _, err := e.svc.Decide(ctx, manager, defects[0].Id, etag(1), fleetapi.DefectDecision{Decision: "allow_departure"}); err != nil {
		t.Fatal(err)
	}
	d := db(t, "a")
	state := scalar[string](t, d, `select t.state||'/'||i.state||'/'||r.state from fleet.trips t join fleet.inspections i on i.id = t.departure_inspection_id
	                                 join sched.reservations r on r.source_id = t.id where t.id = $1`, tr.ID)
	expect(t, "still in review", state, state == "defect_review/blocked/confirmed")
	if _, err := e.svc.Decide(ctx, manager, defects[1].Id, etag(1), fleetapi.DefectDecision{Decision: "confirm_out_of_service"}); err != nil {
		t.Fatal(err)
	}
	trip := scalar[string](t, d, `select state from fleet.trips where id = $1`, tr.ID)
	expect(t, "back to planning", trip, trip == "planned")
	read, err := e.svc.Inspection(ctx, manager, got.Id)
	expect(t, "inspection", read, err == nil, read.Status == "rejected", len(*read.Defects) == 2)
	titles := notices(t, "a", person("a.manager-msk1"), "fleet.defect.blocking_reported", tr.ID)
	expect(t, "one notification", titles, len(titles) == 1, len(titles) == 1 && titles[0] == "Критический дефект: Газель Next "+tr.Plate+" — Шины и колёса. Выезд заблокирован.")
}

// Review round 1: two managers allow the two blocking defects of one inspection at once. Each decision sees the
// other one: exactly one of them finds no defect waiting, so the inspection is approved and the trip goes back to
// the departure with the hold — never both in_review forever. Several trips at once widen the race window.
func TestDecideTwoBlockingConcurrent(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	d := db(t, "a")
	driver := e.tc(t, "a.driver-msk1", "a")
	managers := []tenantctx.TenantContext{e.tc(t, "a.manager-msk1", "a"), e.tc(t, "a.region-msk", "a")}
	type pair struct {
		tr      trip
		defects []fleetapi.InspectionDefect
	}
	pairs := make([]pair, 6)
	for i := range pairs {
		tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
		got, err := e.svc.Submit(ctx, driver, e.departure(t, tr, critical("Шины и колёса"), critical("Тормоза и ходовая")))
		if err != nil {
			t.Fatal(err)
		}
		pairs[i] = pair{tr: tr, defects: *got.Defects}
	}
	var wg sync.WaitGroup
	for _, p := range pairs {
		for j, defect := range p.defects {
			wg.Go(func() {
				if _, err := e.svc.Decide(ctx, managers[j%2], defect.Id, etag(defect.Revision),
					fleetapi.DefectDecision{Decision: "allow_departure"}); err != nil {
					t.Errorf("trip %s, defect %d: %v", p.tr.Number, j, err)
				}
			})
		}
	}
	wg.Wait()
	for _, p := range pairs {
		state := scalar[string](t, d, `select t.state||'/'||i.state||'/'||r.state||'/'||coalesce(v.service_note, '-')
		                                 from fleet.trips t join fleet.inspections i on i.id = t.departure_inspection_id
		                                 join sched.reservations r on r.source_id = t.id join fleet.vehicles v on v.id = t.vehicle_id
		                                where t.id = $1`, p.tr.ID)
		expect(t, "trip "+p.tr.Number+" back to the departure", state, state == "inspection/approved/hold/-")
	}
}

// Review round 1 (minor): a confirmed fault and then an allowed one — the inspection stays rejected, the trip stays
// in planning without the vehicle, the vehicle stays out of service with its note.
func TestDecideConfirmThenAllow(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	got, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, tr, critical("Шины и колёса"), critical("Тормоза и ходовая")))
	if err != nil {
		t.Fatal(err)
	}
	defects := *got.Defects
	manager := e.tc(t, "a.manager-msk1", "a")
	if _, err := e.svc.Decide(ctx, manager, defects[0].Id, etag(1), fleetapi.DefectDecision{Decision: "confirm_out_of_service"}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Decide(ctx, manager, defects[1].Id, etag(1), fleetapi.DefectDecision{Decision: "allow_departure"}); err != nil {
		t.Fatal(err)
	}
	read, err := e.svc.Inspection(ctx, manager, got.Id)
	expect(t, "inspection", read, err == nil, read.Status == "rejected")
	d := db(t, "a")
	trip := scalar[string](t, d, `select state||'/'||coalesce(vehicle_id::text, '-') from fleet.trips where id = $1`, tr.ID)
	vehicle := scalar[string](t, d, `select service_state||'/'||coalesce(service_note, '-') from fleet.vehicles where id = $1`, tr.Vehicle)
	hold := scalar[string](t, d, `select state from sched.reservations where id = $1`, tr.Reservation)
	expect(t, "trip, vehicle, reservation", []string{trip, vehicle, hold}, trip == "planned/-",
		vehicle == "out_of_service/неисправность подтверждена", hold == "released")
}

// A decision on a defect whose trip has left the review (the reservation was released by the manager, W2.02): the
// defect and the vehicle change, the trip stays where it is.
func TestDecideAfterTripLeftReview(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	d := db(t, "a")
	for _, dec := range []string{"confirm_out_of_service", "allow_departure"} {
		tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
		defect := (*e.blocked(t, tr).Defects)[0]
		exec(t, d, `update fleet.trips set state = 'planned', vehicle_id = null, departure_inspection_id = null where id = $1`, tr.ID)
		exec(t, d, `update sched.reservations set state = 'released' where id = $1`, tr.Reservation)
		got, err := e.svc.Decide(ctx, e.tc(t, "a.owner", "a"), defect.Id, etag(1), fleetapi.DefectDecision{Decision: fleetapi.DefectDecisionDecision(dec)})
		expect(t, dec, got, err == nil, got.Decision != nil && string(*got.Decision) == dec)
		trip := scalar[string](t, d, `select state||'/'||coalesce(vehicle_id::text, '-') from fleet.trips where id = $1`, tr.ID)
		hold := scalar[string](t, d, `select state from sched.reservations where id = $1`, tr.Reservation)
		expect(t, dec+": trip and reservation", []string{trip, hold}, trip == "planned/-", hold == "released")
	}
}

// The queue pages oldest first by one item; a cursor of other filters and a page size outside 1…200 are 400.
func TestDefectQueuePaging(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	got, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, tr, critical("Кузов"), critical("Стёкла"), critical("Салон")))
	if err != nil {
		t.Fatal(err)
	}
	owner := e.tc(t, "a.owner", "a")
	q := inspections.DefectQuery{PageQuery: inspections.PageQuery{Limit: 1}, States: []string{"in_review"}, TripID: tr.ID}
	var zones []string
	for range 5 {
		page, err := e.svc.Defects(ctx, owner, q)
		if err != nil {
			t.Fatal(err)
		}
		for _, it := range page.Items {
			zones = append(zones, it.Zone)
		}
		if page.NextCursor == nil {
			break
		}
		q.Cursor = *page.NextCursor
	}
	expect(t, "oldest first", zones, slices.Equal(zones, []string{"Кузов", "Стёкла", "Салон"}), len(*got.Defects) == 3)
	page, err := e.svc.Defects(ctx, owner, inspections.DefectQuery{PageQuery: inspections.PageQuery{Limit: 1}, TripID: tr.ID})
	if err != nil || page.NextCursor == nil {
		t.Fatalf("first page: %v %+v", err, page)
	}
	other := inspections.DefectQuery{PageQuery: inspections.PageQuery{Cursor: *page.NextCursor}, VehicleID: tr.Vehicle}
	if _, err := e.svc.Defects(ctx, owner, other); !isCode(err, "malformed_request") {
		t.Errorf("cursor of other filters: %v", err)
	}
	if _, err := e.svc.Defects(ctx, owner, inspections.DefectQuery{PageQuery: inspections.PageQuery{Limit: 300}}); !isCode(err, "malformed_request") {
		t.Errorf("limit 300: %v", err)
	}
	if _, err := e.svc.Inspections(ctx, owner, inspections.PageQuery{Limit: -1}); !isCode(err, "malformed_request") {
		t.Errorf("inspections limit -1: %v", err)
	}
}

// recipients wraps the memberships of the control DB: skip has no active membership, fail — the control DB is down.
type recipients struct {
	inner inbox.Recipients
	skip  uuid.UUID
	fail  bool
}

func (r recipients) Recipient(ctx context.Context, tenant, person uuid.UUID) (tenantctx.TenantContext, error) {
	switch {
	case r.fail:
		return tenantctx.TenantContext{}, errors.New("control DB is down")
	case person == r.skip:
		return tenantctx.TenantContext{}, inbox.ErrNoRecipient
	}
	return r.inner.Recipient(ctx, tenant, person)
}

// The recipients of the notification of a blocking defect: a person without a membership is skipped, the others get
// it; a failing control DB rolls the inspection back (the notification is part of the command); without the inbox
// wired the inspection is recorded without notifications.
func TestBlockingNotificationRecipients(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	driver := e.tc(t, "a.driver-msk1", "a")
	with := func(r inbox.Recipients) *inspections.Service {
		cp := *e.svc
		cp.Recipients = r
		return &cp
	}
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	svc := with(recipients{inner: e.svc.Recipients, skip: person("a.manager-msk1")})
	if _, err := svc.Submit(ctx, driver, e.departure(t, tr, critical("Кузов"))); err != nil {
		t.Fatal(err)
	}
	expect(t, "skipped", tr, len(notices(t, "a", person("a.manager-msk1"), "fleet.defect.blocking_reported", tr.ID)) == 0,
		len(notices(t, "a", person("a.owner"), "fleet.defect.blocking_reported", tr.ID)) == 1)

	down := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	if _, err := with(recipients{fail: true}).Submit(ctx, driver, e.departure(t, down, critical("Кузов"))); err == nil {
		t.Fatal("submit with the control DB down succeeded")
	}
	n := scalar[int](t, db(t, "a"), `select count(*) from fleet.inspections where trip_id = $1`, down.ID)
	expect(t, "rolled back", n, n == 0)

	quiet := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	if _, err := with(nil).Submit(ctx, driver, e.departure(t, quiet, critical("Кузов"))); err != nil {
		t.Fatal(err)
	}
	expect(t, "no inbox", quiet, len(notices(t, "a", person("a.owner"), "fleet.defect.blocking_reported", quiet.ID)) == 0)
}
