package main

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

// The knowledge base of the stand (W4.31) is the migration v2 of the domain W4.30 (knowledge.WriteDemo): «Альта» —
// five spaces, 35 nodes, three roles of spaces, five rules, three runs and the table of inspections; «Лотос» — «Салон и
// SPA» with its home page; other tenants — none. The roles of spaces are written without their members (Марина Котова
// and Вера Котельникова): /me/context of the stand must match the examples of getMyContext (П-14), whose manager has
// no space roles — until the steward adds them (decision of W4.31).
func TestKnowledgeSeedStatements(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		td   tenantData
		want map[string]int
	}{
		{alta, map[string]int{"kb.spaces": 5, "kb.nodes": 35, "kb.versions": 36, "kb.node_access": 11, "kb.acks": 3, "kb.ack_log": 1,
			"access.roles": 3, "access.role_assignments": 0, "kb.rules": 5, "kb.runs": 3, "kb.tables": 1, "kb.table_rows": 2,
			"files.objects": 1}},
		{lotosData, map[string]int{"kb.spaces": 1, "kb.nodes": 2, "kb.versions": 2, "access.roles": 3}},
	} {
		got := map[string]int{}
		ex := func(_ context.Context, q string, _ ...any) error {
			if f := strings.Fields(q); len(f) > 2 && f[0] == "insert" {
				got[f[2]]++
			}
			return nil
		}
		if err := writeKnowledgeWith(t.Context(), ex, c.td); err != nil {
			t.Fatal(err)
		}
		for table, n := range c.want {
			if got[table] != n {
				t.Errorf("%s: inserts into %s = %d, want %d", c.td.tenant.proto, table, got[table], n)
			}
		}
	}
}

// writeKnowledge goes through the transaction of the tenant (database/sql).
func TestWriteKnowledgeUsesTx(t *testing.T) {
	t.Parallel()
	var tx *sql.Tx
	if err := writeKnowledge(t.Context(), tx, tenantData{tenant: tenantDef{proto: "t-none"}}); err != nil {
		t.Fatalf("a tenant without a knowledge base: %v", err)
	}
}
