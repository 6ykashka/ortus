//go:build integration

package main

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// «Обращения» of «Альта» (W7.31, service.js 19.10) are written into a fresh tenant DB after its units, people and access,
// twice without duplicates, with the ids of PD-30: the four directions as service projects of «Задачи», 21 types, four
// templates, eight requests with their feed, three ratings, a link for every request and the dispatchers of ГРЗ with the
// role of the project. «Лотос» has none.
func TestWriteServiceTwice(t *testing.T) {
	t.Parallel()
	for _, td := range []tenantData{alta, lotosData} {
		name := cluster.NewDatabase(t, "service_seed_"+td.tenant.proto[2:])
		db := cluster.DB(t, name, migrations.RoleMigrator)
		if _, err := migrations.Up(t.Context(), db, migrations.Tenant); err != nil {
			t.Fatal(err)
		}
		for pass := 1; pass <= 2; pass++ {
			tx, err := db.BeginTx(t.Context(), nil)
			if err != nil {
				t.Fatal(err)
			}
			for _, step := range []func() error{
				func() error { return writeUnits(t.Context(), tx, td) },
				func() error { return writePeople(t.Context(), tx, td) },
				func() error { return writeAccess(t.Context(), tx, td) },
				func() error { return writeService(t.Context(), tx, td) },
			} {
				if err := step(); err != nil {
					_ = tx.Rollback()
					t.Fatalf("%s pass %d: %v", td.tenant.proto, pass, err)
				}
			}
			if err := tx.Commit(); err != nil {
				t.Fatalf("%s pass %d: %v", td.tenant.proto, pass, err)
			}
		}
		want := map[string]int{`select count(*) from service.directions`: 0, `select count(*) from service.requests`: 0}
		if td.tenant.proto == protoAlta {
			grz := seedID(protoAlta, "svc-grz").String()
			want = map[string]int{
				`select count(*) from service.directions`:                                            4,
				`select count(*) from service.request_types`:                                         21,
				`select count(*) from service.reply_templates`:                                       16,
				`select count(*) from service.requests`:                                              8,
				`select count(*) from service.sla_timers`:                                            13,
				`select count(*) from service.portal_tokens`:                                         8,
				`select count(*) from service.ratings where status = 'open'`:                         2,
				`select count(*) from service.ratings`:                                               3,
				`select count(*) from service.clients`:                                               9,
				`select count(*) from tasks.projects where id::text = '` + grz + `' and key = 'ГРЗ'`: 1,
				`select count(*) from service.directions where key = 'ГРЗ' and project_id::text = '` + grz + `' and next_number = 58 and public_slug = 'grz'`:                        1,
				`select count(*) from service.requests where key = 'ГРЗ-55' and status = 'wait' and assignee_id = '` + seedID(protoAlta, "m-kotelnikova").String() + `'`:             1,
				`select count(*) from service.requests where key = 'МАС-41' and about_member_id = '` + seedID(protoAlta, "m-morozova").String() + `' and from_rating_id is not null`: 1,
				`select count(*) from service.messages where kind = 'public' and auto and author_id is null`:                                                                         2,
				`select count(*) from service.sla_timers where stopped_at is not null`:                                                                                               3,
				`select count(*) from access.role_assignments a join access.roles r on r.id = a.role_id
				  where r.name = 'Специалист по обращениям' and a.scope_kind = 'project' and a.scope_ref::text = '` + grz + `'`: 2,
				`select count(*) from service.requests r join service.request_details d on d.request_id = r.id where d.details->>'clientSince' is not null`: 8,
			}
		}
		for q, n := range want {
			var got int
			if err := db.QueryRowContext(t.Context(), q).Scan(&got); err != nil {
				t.Fatalf("%s: %s: %v", td.tenant.proto, q, err)
			}
			if got != n {
				t.Errorf("%s: %s = %d, want %d", td.tenant.proto, q, got, n)
			}
		}
	}
}
