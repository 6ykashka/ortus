package main

import (
	"context"
	"database/sql"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/forms"
)

// writeForms writes the forms of td (W4.21): the seed of the domain W4.20 for «Альта» — «Осмотр машины» v1–v3 with
// its rules au-1 and au-2, the draft of the report of the foreman, the responses R-0988 and R-1012 with their lines of
// the journal; the rows already there are kept (a second run changes nothing).
func writeForms(ctx context.Context, tx *sql.Tx, td tenantData) error {
	id := func(proto string) uuid.UUID { return seedID(td.tenant.proto, proto) }
	return forms.WriteDemo(ctx, func(ctx context.Context, q string, args ...any) error {
		_, err := tx.ExecContext(ctx, q, args...)
		return err
	}, td.tenant.proto, id)
}
