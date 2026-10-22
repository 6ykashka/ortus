package main

import (
	"database/sql"
	"testing"
)

// writeForms goes through the transaction of the tenant (database/sql); a tenant without forms writes nothing.
func TestWriteFormsUsesTx(t *testing.T) {
	t.Parallel()
	var tx *sql.Tx
	if err := writeForms(t.Context(), tx, tenantData{tenant: tenantDef{proto: "t-none"}}); err != nil {
		t.Fatalf("a tenant without forms: %v", err)
	}
}
