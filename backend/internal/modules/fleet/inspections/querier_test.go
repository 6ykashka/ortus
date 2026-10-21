package inspections

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var errDB = errors.New("connection reset")

// brokenQ is a tenant DB whose every statement fails; row, when set, answers QueryRow instead.
type brokenQ struct{ row pgx.Row }

func (brokenQ) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errDB
}

func (brokenQ) Query(context.Context, string, ...any) (pgx.Rows, error) { return nil, errDB }

func (q brokenQ) QueryRow(context.Context, string, ...any) pgx.Row {
	if q.row != nil {
		return q.row
	}
	return errRow{}
}

type errRow struct{}

func (errRow) Scan(...any) error { return errDB }

// badItems is a checklist version whose definition and items are not JSON.
type badItems struct{}

func (badItems) Scan(dest ...any) error {
	*dest[0].(*uuid.UUID) = uuid.New()      //nolint:forcetypeassert // the columns of currentChecklistSQL
	*dest[1].(*int) = 1                     //nolint:forcetypeassert // the columns of currentChecklistSQL
	*dest[2].(*[]byte) = []byte("not json") //nolint:forcetypeassert // the columns of currentChecklistSQL
	if len(dest) < 5 {
		return errors.New("currentChecklistSQL reads id, version, items, required_photo_roles, definition")
	}
	*dest[4].(*[]byte) = []byte("not json") //nolint:forcetypeassert // the columns of currentChecklistSQL
	return nil
}

// A failing statement of the tenant DB is an error of the operation, never a partial answer.
func TestQueriesFail(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	checks := map[string]error{}
	_, checks["currentChecklist"] = currentChecklist(ctx, brokenQ{}, kindDeparture)
	_, _, checks["latestChecklist items"] = latestChecklist(ctx, brokenQ{row: badItems{}}, kindDeparture)
	_, checks["photoFiles"] = photoFiles(ctx, brokenQ{}, []uuid.UUID{uuid.New()})
	_, checks["vehicleOf"] = vehicleOf(ctx, brokenQ{}, uuid.New())
	_, checks["loadInspection"] = loadInspection(ctx, brokenQ{}, uuid.New())
	checks["attachDefects"] = attachDefects(ctx, brokenQ{}, []fleetapi.Inspection{{Id: uuid.New()}})
	_, checks["checkEvidence"] = checkEvidence(ctx, brokenQ{}, target{}, vehicleRow{}, validCreate(kindDeparture))
	checks["checkPhotos"] = checkPhotos(ctx, brokenQ{}, target{}, validCreate(kindDeparture))
	for name, err := range checks {
		if err == nil {
			t.Errorf("%s: no error", name)
		}
	}
	if err := attachDefects(ctx, brokenQ{}, nil); err != nil {
		t.Errorf("no inspections — no query: %v", err)
	}
}

// The writes of the commands stop at the first failing statement (the transaction rolls back).
func TestCommandsFail(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	s := &Service{Authz: allowAll{}}
	tc := tenantctx.TenantContext{TenantID: uuid.New(), PersonID: uuid.New()}
	trip := uuid.New()
	tripState := "defect_review"
	d := decision{id: uuid.New(), inspection: uuid.New(), vehicle: uuid.New(), trip: &trip, tripState: &tripState}
	checks := map[string]error{}
	_, checks["lockTarget departure"] = s.lockTarget(ctx, brokenQ{}, tc, validCreate(kindDeparture))
	_, checks["lockTarget return"] = s.lockTarget(ctx, brokenQ{}, tc, validCreate(kindReturn))
	_, checks["lockDefect"] = s.lockDefect(ctx, brokenQ{}, tc, uuid.New())
	_, checks["record"] = s.record(ctx, brokenQ{}, tc, target{trip: trip}, vehicleRow{}, validCreate(kindDeparture))
	checks["moveTrip"] = moveTrip(ctx, brokenQ{}, target{trip: trip}, validCreate(kindReturn), uuid.New(), false)
	checks["reportBlocking"] = s.reportBlocking(ctx, brokenQ{}, tc.TenantID, target{trip: trip}, vehicleRow{}, uuid.New(), "Кузов")
	checks["apply"] = s.apply(ctx, brokenQ{}, tc, d, fleetapi.DefectDecision{Decision: decisionAllow})
	checks["allow"] = allow(ctx, brokenQ{}, d, time.Now())
	checks["confirm"] = confirm(ctx, brokenQ{}, d, time.Now())
	checks["notifyManagers"] = (&Service{Recipients: recipientsOff{}, Audience: audienceOff{}}).notifyManagers(ctx, brokenQ{}, tc.TenantID, target{}, uuid.Nil, uuid.New(), "x")
	for name, err := range checks {
		if err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

type recipientsOff struct{}

func (recipientsOff) Recipient(context.Context, uuid.UUID, uuid.UUID) (tenantctx.TenantContext, error) {
	return tenantctx.TenantContext{}, errDB
}

type audienceOff struct{}

func (audienceOff) Admits(context.Context, tenantctx.TenantContext, inbox.Rule) (bool, error) {
	return false, errDB
}
