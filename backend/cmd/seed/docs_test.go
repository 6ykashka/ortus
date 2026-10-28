package main

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

// The documents of the demo (W7.23) are written for «Альта» only: six folders with their lists, three templates and two
// route templates, six documents with their versions, a comment with a mention, the words of a scan and its two jobs, and
// the finished route of the lease (W7.24: approve, sign — the prototype rt-0).
func TestDocsSeedStatements(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		td   tenantData
		want map[string]int
	}{
		{alta, map[string]int{"docs.folders": 6, "docs.shares": 3, "docs.templates": 3, "docs.route_templates": 2, "docs.documents": 6,
			"docs.versions": 11, "docs.comments": 1, "docs.ocr_words": 3, "docs.jobs": 2, "docs.routes": 1, "docs.route_steps": 2,
			"docs.route_decisions": 2}},
		{lotosData, map[string]int{}},
	} {
		got := map[string]int{}
		ex := func(_ context.Context, q string, _ ...any) error {
			if f := strings.Fields(q); len(f) > 2 && f[0] == "insert" {
				got[f[2]]++
				if !strings.Contains(q, "on conflict") {
					t.Errorf("%s: an insert that is not repeatable: %.60s", c.td.tenant.proto, q)
				}
			}
			return nil
		}
		if err := writeDocsWith(t.Context(), ex, c.td); err != nil {
			t.Fatal(err)
		}
		if len(got) != len(c.want) {
			t.Errorf("%s: inserts %v, want %v", c.td.tenant.proto, got, c.want)
		}
		for table, n := range c.want {
			if got[table] != n {
				t.Errorf("%s: inserts into %s = %d, want %d", c.td.tenant.proto, table, got[table], n)
			}
		}
	}
}

// writeDocs goes through the transaction of the tenant (database/sql).
func TestWriteDocsUsesTx(t *testing.T) {
	t.Parallel()
	var tx *sql.Tx
	if err := writeDocs(t.Context(), tx, tenantData{tenant: tenantDef{proto: "t-none"}}); err != nil {
		t.Fatalf("a tenant without documents: %v", err)
	}
}
