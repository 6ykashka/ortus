//go:build integration

package main

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// The knowledge base of «Альта» and «Лотос» (W4.31) is written into fresh tenant DBs after their units, people and
// access, twice without duplicates, with the ids of PD-30 (as seedUuid of MSW): the spaces, the tree with the depth of
// every node (the deferred FK of tenant 0024 holds at commit), the lists, the acknowledgements, the roles of spaces.
func TestWriteKnowledgeTwice(t *testing.T) {
	t.Parallel()
	for _, td := range []tenantData{alta, lotosData} {
		name := cluster.NewDatabase(t, "knowledge_seed_"+td.tenant.proto[2:])
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
				func() error { return writeKnowledge(t.Context(), tx, td) },
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
		want := map[string]int{
			`select count(*) from kb.spaces`:   1,
			`select count(*) from kb.nodes`:    2,
			`select count(*) from kb.versions`: 2,
			`select count(*) from kb.nodes where is_home and id = '` + seedID(td.tenant.proto, "kb-home-sp-spa").String() + `'`: 1,
		}
		if td.tenant.proto == protoAlta {
			want = map[string]int{
				`select count(*) from kb.spaces`:                                          5,
				`select count(*) from kb.nodes`:                                           35,
				`select count(*) from kb.versions`:                                        36,
				`select count(*) from kb.node_access`:                                     11,
				`select count(*) from kb.ack_log`:                                         1,
				`select count(*) from kb.rules`:                                           5,
				`select count(*) from kb.runs`:                                            3,
				`select count(*) from kb.table_rows`:                                      2,
				`select count(*) from access.role_assignments where scope_kind = 'space'`: 0, // the members of spaces wait for the examples (П-14)
				`select count(*) from access.roles where template_key in ('kb_space_lead', 'kb_space_editor', 'kb_space_reader')`: 3,
				`select count(*) from kb.nodes n join kb.nodes f on f.id = '` + seedID(protoAlta, "kb-rep-obj").String() + `'
				  where n.id = '` + seedID(protoAlta, "kb-o-obj-42-5").String() + `' and n.depth = f.depth + 2`: 1,
				`select count(*) from kb.nodes where id = '` + seedID(protoAlta, "kb-1").String() + `' and parent_id = '` +
					seedID(protoAlta, "kb-f-reg").String() + `' and review_by = '2027-03-24'`: 1,
				`select count(*) from files.objects where purpose = 'knowledge_attachment' and bytes = 1258291`: 1,
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
