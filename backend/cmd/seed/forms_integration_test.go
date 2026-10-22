//go:build integration

package main

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// The forms of «Альта» (W4.21, domain W4.20) are written into a fresh tenant DB after its units, people and access,
// twice without duplicates, with the ids of PD-30 (as seedUuid of MSW): «Осмотр машины» v1–v3 acting v3 with its rules
// au-1 and au-2, the draft of the report of the foreman, R-0988 and R-1012 with their lines of the journal; the next
// response of the stand is R-1013. «Лотос» has none.
func TestWriteFormsTwice(t *testing.T) {
	t.Parallel()
	for _, td := range []tenantData{alta, lotosData} {
		name := cluster.NewDatabase(t, "forms_seed_"+td.tenant.proto[2:])
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
				func() error { return writeForms(t.Context(), tx, td) },
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
		insp := seedID(td.tenant.proto, "fm-insp").String()
		want := map[string]int{`select count(*) from forms.forms`: 0, `select count(*) from forms.responses`: 0}
		if td.tenant.proto == protoAlta {
			want = map[string]int{
				`select count(*) from forms.forms`:    2,
				`select count(*) from forms.versions`: 3,
				`select count(*) from forms.drafts`:   2,
				`select count(*) from forms.rules`:    2,
				`select count(*) from forms.response_actions where ok and kb_node_id = '` + seedID(protoAlta, "kb-5").String() + `'`: 2,
				`select count(*) from forms.forms where id = '` + insp + `' and status = 'published' and current_version = 3
				   and module_key = 'fleet' and owner_id = '` + seedID(protoAlta, "m-owner").String() + `'`: 1,
				`select count(*) from forms.forms where id = '` + seedID(protoAlta, "fm-foreman").String() + `' and status = 'draft'
				   and module_key = 'repairs'`: 1,
				`select count(*) from forms.responses where number in (988, 1012) and review_status = 'accepted' and channel = 'inspection'`: 2,
				`select count(*) from forms.responses where number = 1012 and version_number = 3 and author_id = '` +
					seedID(protoAlta, "m-vasiliev").String() + `' and subject_label = 'Рейс Р-196'`: 1,
				`select count(*) from forms.rules where kind = 'task' and config->'task'->>'assigneeMemberId' = '` +
					seedID(protoAlta, "m-kotova").String() + `' and config->'task'->>'title' = 'Проверить осмотр'`: 1,
				`select count(*) from forms.rules where kind = 'kb' and config->'kb'->>'tableId' = '` + seedID(protoAlta, "kt-insp").String() + `'
				   and jsonb_array_length(config->'kb'->'fields') = 7`: 1,
				`select count(*) from forms.versions where form_id = '` + insp + `' and number = 3 and question_count = 7`: 1,
				`select (nextval('forms.response_number_seq') > 1012)::int`:                                                1,
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
