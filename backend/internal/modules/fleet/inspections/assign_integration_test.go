//go:build integration

package inspections_test

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/inspections" //nolint:depguard // the package under test
	harness "github.com/ortus/ortus-crm/backend/test"                       //nolint:depguard // integration test: clock of the suites
)

// assignTo is the body of assignInspectionDefect: the assignee and the deadline in hours from the clock of the suite.
func assignTo(who uuid.UUID, hours int, comment string) fleetapi.DefectAssignment {
	b := fleetapi.DefectAssignment{AssigneeMemberId: who, DueAt: harness.Now().Add(time.Duration(hours) * time.Hour)}
	if comment != "" {
		b.Comment = &comment
	}
	return b
}

// assigned is the number of the notifications fleet.defect.assigned about the trip for the person.
func assigned(t *testing.T, tr trip, who string) int {
	t.Helper()
	return len(notices(t, tr.tenant, person(who), "fleet.defect.assigned", tr.ID))
}

// is, at and named compare an optional field of the answer with what the test wants.
func is(p *uuid.UUID, want uuid.UUID) bool { return p != nil && *p == want }
func sameInstant(p *time.Time, want time.Time) bool {
	return p != nil && p.Equal(want) && p.Location() == time.UTC
}
func named(p *string, want string) bool { return p != nil && *p == want }

// D-29 комплекта (W2.46): the responsible manager assigns a blocking defect of the queue — the assignee, the deadline,
// who assigned and when are kept by the defect and read by the queue, the card and the inspection; the assignee
// gets «Вам назначен дефект: …» with the comment; the assignment is audited and published. Re-assignment replaces
// both fields and tells nobody when the actor assigns himself; the decision keeps the fields of the task, and a
// decided defect cannot be assigned (409).
func TestAssignDefect(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	insp := e.blocked(t, tr)
	defect := (*insp.Defects)[0]
	expect(t, "not assigned yet", defect, defect.AssigneeMemberId == nil, defect.DueAt == nil, defect.AssignedAt == nil)
	manager := e.tc(t, "a.manager-msk1", "a")
	d := db(t, "a")
	region := person("a.region-msk")
	regionName := scalar[string](t, d, `select full_name from people.person_profiles where id = $1`, region)
	got, err := e.svc.Assign(ctx, manager, defect.Id, etag(defect.Revision), assignTo(region, 4, "Проверить шину до обеда"))
	if err != nil {
		t.Fatal(err)
	}
	due := harness.Now().Add(4 * time.Hour)
	expect(t, "assigned", got, got.State == "in_review", got.Revision == 2, is(got.AssigneeMemberId, region),
		named(got.AssigneeDisplayName, regionName), sameInstant(got.DueAt, due), is(got.AssignedByMemberId, person("a.manager-msk1")),
		sameInstant(got.AssignedAt, harness.Now()))
	title := "Вам назначен дефект: Газель Next " + tr.Plate + " — Шины и колёса"
	wantNotice(t, tr, "fleet.defect.assigned", title, []string{"a.region-msk"}, []string{"a.manager-msk1", "a.owner", "a.driver-msk1"})
	body := scalar[string](t, d, `select coalesce(body, '') from notify.notifications where kind = 'fleet.defect.assigned' and recipient_person_id = $1 and entity_id = $2`,
		region, tr.ID)
	expect(t, "comment is the body", body, body == "Проверить шину до обеда")
	audit := scalar[int](t, d, `select count(*) from audit.events where action = 'fleet.defect.assign' and target_id = $1 and actor_id = $2`,
		defect.Id, person("a.manager-msk1"))
	events := scalar[int](t, d, `select count(*) from outbox.events where type = 'fleet.defect.assigned.v1' and aggregate_id = $1`, defect.Id)
	expect(t, "audit and event", []int{audit, events}, audit == 1, events == 1)
	e.wantTaskRead(t, tr, insp.Id, defect.Id, region, regionName, due)

	// Re-assignment by the owner to himself: both fields replaced, no notification (to himself or to the previous one).
	owner := e.tc(t, "a.owner", "a")
	again, err := e.svc.Assign(ctx, owner, defect.Id, etag(got.Revision), assignTo(person("a.owner"), 1, ""))
	expect(t, "re-assigned", again, err == nil, again.Revision == 3, is(again.AssigneeMemberId, person("a.owner")),
		sameInstant(again.DueAt, harness.Now().Add(time.Hour)), is(again.AssignedByMemberId, person("a.owner")))
	notified := []int{assigned(t, tr, "a.owner"), assigned(t, tr, "a.region-msk")}
	expect(t, "no notice to oneself", notified, notified[0] == 0, notified[1] == 1)
	prev := scalar[string](t, d, `select diff->>'previousAssignee' from audit.events where action = 'fleet.defect.assign' and target_id = $1 and actor_id = $2`,
		defect.Id, person("a.owner"))
	expect(t, "audit of the re-assignment", prev, prev == region.String())

	// The decision stays decideInspectionDefect and keeps the fields of the task; a decided defect is not assigned.
	decided, err := e.svc.Decide(ctx, owner, defect.Id, etag(again.Revision), fleetapi.DefectDecision{Decision: "allow_departure"})
	expect(t, "decided", decided, err == nil, decided.State == "resolved", is(decided.AssigneeMemberId, person("a.owner")))
	_, err = e.svc.Assign(ctx, manager, defect.Id, etag(decided.Revision), assignTo(region, 2, ""))
	wantCode(t, err, "invalid_transition")
	_, err = e.svc.Assign(ctx, manager, defect.Id, etag(defect.Revision), assignTo(region, 2, ""))
	wantCode(t, err, "invalid_transition") // the state goes first: a stale If-Match after the decision is 409
}

// wantTaskRead: the queue of the manager, the card of the driver and the inspection read the fields of the task.
func (e env) wantTaskRead(t *testing.T, tr trip, inspection, defect, assignee uuid.UUID, name string, due time.Time) {
	t.Helper()
	ctx := t.Context()
	manager := e.tc(t, "a.manager-msk1", "a")
	page, err := e.svc.Defects(ctx, manager, inspections.DefectQuery{States: []string{"in_review"}, TripID: tr.ID})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("queue %+v: %v", page, err)
	}
	q := page.Items[0]
	expect(t, "queue", q, is(q.AssigneeMemberId, assignee), named(q.AssigneeDisplayName, name), sameInstant(q.DueAt, due))
	card, err := e.svc.Defect(ctx, e.tc(t, "a.driver-msk1", "a"), defect)
	expect(t, "card", card, err == nil, named(card.AssigneeDisplayName, name), sameInstant(card.DueAt, due))
	read, err := e.svc.Inspection(ctx, manager, inspection)
	if err != nil || read.Defects == nil || len(*read.Defects) != 1 {
		t.Fatalf("inspection %+v: %v", read, err)
	}
	expect(t, "inspection", read, is((*read.Defects)[0].AssigneeMemberId, assignee))
}

// The scope, If-Match and the body of an assignment: another firm and another tenant 404, the driver who sees his
// defect but cannot decide 403, 428 and 412; an assignee who is unknown, of another tenant, archived, without a
// membership, a driver or the manager of another firm — one and the same 422 «Сотрудник не найден.»; a deadline in
// the past 422. Nothing changes.
func TestAssignRejects(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	defect := (*e.blocked(t, tr).Defects)[0]
	region := assignTo(person("a.region-msk"), 2, "")
	ok := etag(defect.Revision)
	scope := []struct {
		name, actor, tenant, ifMatch, code string
	}{
		{"без If-Match", "a.manager-msk1", "a", "", "revision_required"},
		{"устаревший If-Match", "a.manager-msk1", "a", etag(defect.Revision + 1), "revision_mismatch"},
		{"соседняя фирма", "a.manager-msk2", "a", ok, "not_found"},
		{"водитель", "a.driver-msk1", "a", ok, "forbidden_action"},
		{"другой тенант", "b.owner", "b", ok, "not_found"},
	}
	for _, c := range scope {
		if _, err := e.svc.Assign(ctx, e.tc(t, c.actor, c.tenant), defect.Id, c.ifMatch, region); !isCode(err, c.code) {
			t.Errorf("%s: %v, want %s", c.name, err, c.code)
		}
	}
	manager := e.tc(t, "a.manager-msk1", "a")
	if _, err := e.svc.Assign(ctx, manager, uuid.New(), ok, region); !isCode(err, "not_found") {
		t.Errorf("missing defect: %v", err)
	}
	d := db(t, "a")
	unit := ref("unit:a.msk1")
	archived, stranger := uuid.New(), uuid.New()
	exec(t, d, `insert into people.person_profiles (id, full_name, home_unit_id, archived_at) values ($1, 'Архивный менеджер', $2, now())`, archived, unit)
	exec(t, d, `insert into people.person_profiles (id, full_name, home_unit_id) values ($1, 'Без членства', $2)`, stranger, unit)
	var first string
	for name, who := range map[string]uuid.UUID{
		"неизвестный":             uuid.New(),
		"пустой id":               uuid.Nil,
		"человек другого тенанта": ref("person:b.owner@b"),
		"архивный профиль":        archived,
		"профиль без членства":    stranger,
		"водитель":                person("a.driver-msk1"),
		"менеджер соседней фирмы": person("a.manager-msk2"),
	} {
		_, err := e.svc.Assign(ctx, manager, defect.Id, ok, assignTo(who, 2, ""))
		if !isCode(err, "validation_failed") {
			t.Errorf("assignee %s: %v, want validation_failed", name, err)
			continue
		}
		if first == "" {
			first = err.Error()
		}
		if err.Error() != first || err.Error() != "validation_failed: Сотрудник не найден." {
			t.Errorf("assignee %s: %q, want the same «Сотрудник не найден.» (first %q)", name, err.Error(), first)
		}
	}
	_, err := e.svc.Assign(ctx, manager, defect.Id, ok, assignTo(person("a.region-msk"), -1, ""))
	if !isCode(err, "validation_failed") || err.Error() != "validation_failed: Срок решения уже прошёл." {
		t.Errorf("deadline in the past: %v", err)
	}
	still := scalar[string](t, d, `select revision||'/'||coalesce(assignee_id::text, '-')||'/'||coalesce(due_at::text, '-') from fleet.defects where id = $1`, defect.Id)
	expect(t, "defect untouched", still, still == "1/-/-")
	n := scalar[int](t, d, `select count(*) from audit.events where action = 'fleet.defect.assign' and target_id = $1`, defect.Id)
	expect(t, "no audit row", n, n == 0)
}

// An assignment and a decision of one defect at once with the same If-Match: exactly one of them wins (both lock the
// inspection, then the defect); the other is 409 (decided first) or 412 (assigned first).
func TestAssignDecideConcurrent(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	defect := (*e.blocked(t, tr).Defects)[0]
	manager, owner := e.tc(t, "a.manager-msk1", "a"), e.tc(t, "a.owner", "a")
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		wins int
	)
	result := func(name string, err error) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case err == nil:
			wins++
		case isCode(err, "invalid_transition"), isCode(err, "revision_mismatch"):
		default:
			t.Errorf("%s: %v", name, err)
		}
	}
	wg.Go(func() {
		_, err := e.svc.Assign(t.Context(), manager, defect.Id, etag(defect.Revision), assignTo(person("a.region-msk"), 3, ""))
		result("assign", err)
	})
	wg.Go(func() {
		_, err := e.svc.Decide(t.Context(), owner, defect.Id, etag(defect.Revision), fleetapi.DefectDecision{Decision: "confirm_out_of_service"})
		result("decide", err)
	})
	wg.Wait()
	rev := scalar[int](t, db(t, "a"), `select revision from fleet.defects where id = $1`, defect.Id)
	expect(t, "one winner", []int{wins, rev}, wins == 1, rev == 2)
}
