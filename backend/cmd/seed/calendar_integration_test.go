//go:build integration

package main

import (
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// The calendar of «Альта» and «Лотос» (W4.40) is written into fresh tenant DBs with the ids of PD-30 on the day of
// the run, twice without duplicates: the resources with their labels, the bookings with their buffers and their
// confirmed reservations — a bundle per booking.
func TestWriteCalendarTwice(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 18, 12, 40, 0, 0, msk)
	for _, td := range []tenantData{alta, lotosData} {
		name := cluster.NewDatabase(t, "calendar_seed_"+td.tenant.proto[2:])
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
				func() error { return writeFleet(t.Context(), tx, td) },
				func() error { return writeCalendarAt(t.Context(), tx, td, now.Add(time.Duration(pass)*24*time.Hour)) },
			} {
				if err := step(); err != nil {
					_ = tx.Rollback()
					t.Fatalf("%s pass %d: %v", td.tenant.proto, pass, err)
				}
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
		}
		a2 := seedID(td.tenant.proto, "b-a2").String()
		want := map[string]int{
			`select count(*) from sched.bookings where status = 'confirmed'`:                                      4,
			`select count(*) from sched.reservations where state = 'confirmed' and source_type = 'sched.booking'`: 8,
			`select count(*) from sched.resources where kind = 'vehicle'`:                                         0,
			`select count(*) from sched.resources`:                                                                4,
			// The first pass decides the day: 18.10 + 1 day → SPA-ритуал 11:30–13:00 MSK on 19.10, 15 + 15 minutes.
			`select count(*) from sched.bookings where id = '` + a2 + `' and lower(during) = '2026-10-19 11:30+03'
			   and upper(during) = '2026-10-19 13:00+03' and prep_minutes = 15 and cleanup_minutes = 15
			   and source_module = 'spa' and source_type = 'appointment'`: 1,
			`select count(*) from sched.reservations where bundle_id = '` + a2 + `'
			   and lower(occupied) = '2026-10-19 11:15+03' and upper(occupied) = '2026-10-19 13:15+03'`: 3,
			`select count(*) from sched.resources where kind = 'person' and ref_id = '` +
				seedID(td.tenant.proto, "m-morozova").String() + `' and label = 'Анна Морозова · массажист'`: 1,
		}
		if td.tenant.proto == protoAlta {
			want[`select count(*) from sched.bookings where status = 'confirmed'`] = 5
			want[`select count(*) from sched.reservations where state = 'confirmed' and source_type = 'sched.booking'`] = 9
			want[`select count(*) from sched.resources where kind = 'vehicle'`] = 3
			want[`select count(*) from sched.resources`] = 8
			want[`select count(*) from sched.bookings where title = 'Плановое ТО' and source_kind = 'maintenance'
			   and source_id = '`+seedID(protoAlta, "v4").String()+`'`] = 1
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
