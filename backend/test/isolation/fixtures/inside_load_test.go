//go:build isolation

package fixtures

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	harness "github.com/ortus/ortus-crm/backend/test"
)

// insideCount counts what WithInTenant adds to tenant A: the resources and the bookings of the calendar with their
// reservations, the trips, the forms and the responses of the inside content, the knowledge base beyond «Регламенты».
const insideCount = `select (select count(*) from sched.resources) + (select count(*) from sched.bookings)
	+ (select count(*) from sched.reservations) + (select count(*) from fleet.trips)
	+ (select count(*) from forms.forms where org_unit_id is not null) + (select count(*) from forms.responses where id <> $1)
	+ (select count(*) from kb.spaces where id <> $2) + (select count(*) from kb.nodes where id <> $3)
	+ (select count(*) from kb.node_access)`

// W4.82: WithInTenant writes the inside actors with their roles and the inside content of A on top of WithContent;
// WithContent alone writes none of it (the integration tests of tasks and of the calendar load it).
func TestLoadInside(t *testing.T) {
	t.Parallel()
	now := harness.Now()
	w, err := Load(t.Context(), cluster, "fx_inside", now, WithInTenant())
	if err != nil {
		t.Fatal(err)
	}
	a := cluster.DB(t, w.TenantDBs[TenantA], migrations.RoleAPI)
	control := cluster.DB(t, w.ControlDB, migrations.RoleAPI)
	if n := count(t, control, `select count(*) from accounts where issuer = $1`, IssuerDev); n != len(w.Catalog.Actors) {
		t.Errorf("accounts = %d, want %d (every actor WithInTenant)", n, len(w.Catalog.Actors))
	}
	// Календарь: бронь Москвы-2 на помещении Москвы-2 в текущих сутках.
	if n := count(t, a, `select count(*) from sched.bookings b join sched.reservations x on x.bundle_id = b.id and x.state = 'confirmed'
		join sched.resources r on r.id = x.resource_id
		where b.id = $1 and b.org_unit_id = $2 and r.id = $3 and r.home_unit_id = $2 and b.status = 'confirmed'
		  and lower(b.during) > $4 and lower(b.during) < $4::timestamptz + interval '12 hours'`,
		id(t, w, "booking:a.msk2"), id(t, w, "unit:a.msk2"), id(t, w, "cal_resource:a.room-msk2"), now); n != 1 {
		t.Errorf("booking:a.msk2 on cal_resource:a.room-msk2 today = %d, want 1", n)
	}
	// Роль «Календарь» на Москва-1.
	if n := count(t, a, `select count(*) from access.role_assignments ra join access.role_versions v on v.role_id = ra.role_id
		and v.version = ra.role_version where ra.principal_id = $1 and ra.scope_ref = $2 and 'calendar.bookings.read' = any(v.actions)`,
		id(t, w, "person:a.calendar-msk1@a"), id(t, w, "unit:a.msk1")); n != 1 {
		t.Error("a.calendar-msk1 has no calendar grant on Москва-1")
	}
	// Ответ о рейсе Москвы-2 и форма подразделения.
	if n := count(t, a, `select count(*) from forms.responses x join fleet.trips t on t.id = x.subject_id
		where x.id = $1 and x.subject_module = 'fleet' and x.subject_type = 'trip' and t.unit_id = $2`,
		id(t, w, "form_response:a.insp-trip-msk2"), id(t, w, "unit:a.msk2")); n != 1 {
		t.Error("form_response:a.insp-trip-msk2 is not about the trip of Москва-2")
	}
	if n := count(t, a, `select count(*) from forms.forms where id = $1 and org_unit_id = $2 and status = 'published'`,
		id(t, w, "form:a.msk2-check"), id(t, w, "unit:a.msk2")); n != 1 {
		t.Error("form:a.msk2-check is not a published form of Москва-2")
	}
	// Закрытое пространство и узел «Только выбранные» со списком.
	if n := count(t, a, `select count(*) from kb.spaces where id = $1 and access = 'closed'`, id(t, w, "kb_space:a.closed")); n != 1 {
		t.Error("kb_space:a.closed is not a closed space")
	}
	if n := count(t, a, `select count(*) from kb.nodes n join kb.node_access e on e.node_id = n.id
		where n.id = $1 and n.space_id = $2 and n.access_mode = 'listed' and e.who = 'member' and e.ref_id = $3 and e.can = 'view'`,
		id(t, w, "kb_node:a.listed"), id(t, w, "space:a.rules"), id(t, w, "person:a.manager-msk2@a")); n != 1 {
		t.Error("kb_node:a.listed is not «Только выбранные» of «Регламенты» with a.manager-msk2")
	}

	content, err := Load(t.Context(), cluster, "fx_inside_off", now, WithContent())
	if err != nil {
		t.Fatal(err)
	}
	plain := cluster.DB(t, content.TenantDBs[TenantA], migrations.RoleAPI)
	if n := count(t, plain, insideCount, id(t, w, "form_response:a.insp-1"), id(t, w, "space:a.rules"),
		id(t, w, "page:a.rules-intro")); n != 0 {
		t.Errorf("WithContent wrote %d rows of the inside content, want 0", n)
	}
	if n := count(t, plain, `select count(*) from people.person_profiles where id = $1`, id(t, w, "person:a.forms-self@a")); n != 0 {
		t.Error("WithContent wrote an inside actor")
	}
	if n := count(t, cluster.DB(t, content.ControlDB, migrations.RoleAPI), `select count(*) from accounts where subject = 'iso-a.kb-editor'`); n != 0 {
		t.Error("WithContent wrote the account of an inside actor")
	}
}
