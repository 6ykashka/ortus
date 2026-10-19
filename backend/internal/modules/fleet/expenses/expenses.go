package expenses

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Audit and outbox names of the module.
const (
	targetExpense = "fleet.expense"
	eventClaimed  = "fleet.expense.claimed.v1"
)

// open are the states of a trip that take expenses: on the route and while the shift is returned (dr.showExp of the
// prototype); after the submission the manager reviews them.
var open = map[string]bool{"on_route": true, "returning": true, "rework": true}

// Page sizes (common/parameters.yaml Limit).
const (
	defaultPageLimit = 50
	maxPageLimit     = 200
)

const expenseSelect = `
select e.id, e.trip_id, e.category, e.amount_minor, e.currency, trim_scale(e.liters)::text, e.occurred_on, e.comment,
       e.receipt_file_id, e.state, e.revision, e.created_at
  from fleet.expenses e`

func scanExpense(row pgx.Row, zone *time.Location) (fleetapi.TripExpense, time.Time, error) {
	var (
		x       fleetapi.TripExpense
		kind    string
		day     time.Time
		receipt *uuid.UUID
		state   string
		created time.Time
	)
	if err := row.Scan(&x.Id, &x.TripId, &kind, &x.Amount.AmountMinor, &x.Amount.Currency, &x.Quantity, &day, &x.Comment,
		&receipt, &state, &x.Revision, &created); err != nil {
		return fleetapi.TripExpense{}, time.Time{}, err
	}
	x.Kind, x.OccurredAt, x.ReviewState = kind, occurredAt(day, zone), reviewState(state)
	x.Amount.Currency = strings.TrimSpace(x.Amount.Currency)
	x.ReceiptFileIds = []uuid.UUID{}
	if receipt != nil {
		x.ReceiptFileIds = append(x.ReceiptFileIds, *receipt)
	}
	return x, created, nil
}

// Create records an expense of a started trip (createTripExpense, S2-08): the driver of the trip (the owner for
// anyone), a trip on the route or returned, an active category of the tenant catalogue with its comment when
// commentRequired (W2.41), one ready receipt of the trip (purpose expense_receipt, not attached to another expense). The expense waits for the manager (claimed → pending); the audit row and the outbox event carry
// no restricted field.
func (s *Service) Create(ctx context.Context, tc tenantctx.TenantContext, tripID uuid.UUID, b fleetapi.TripExpenseCreate) (fleetapi.TripExpense, error) {
	if err := validateCreate(&b); err != nil {
		return fleetapi.TripExpense{}, err
	}
	var out fleetapi.TripExpense
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		t, err := s.readTrip(ctx, tx, s.evaluator(tx), tc, tripID, actionCreate, true)
		if err != nil {
			return err
		}
		switch {
		case !tc.Owner && (t.driver == nil || *t.driver != tc.PersonID):
			return problem.New(problem.CodeForbiddenAction, textDriverOnly)
		case !open[t.state]:
			return problem.New(codeInvalidTransition, textClosed)
		}
		c, err := kindOf(ctx, tx, b.Kind) // W2.41: the category of the tenant catalogue
		if err != nil {
			return err
		}
		if err := checkKind(c, &b); err != nil {
			return err
		}
		if err := checkReceipt(ctx, tx, t, b.ReceiptFileIds[0]); err != nil {
			return err
		}
		if out, err = insert(ctx, tx, tc, t, b); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

// checkReceipt checks the receipt of an expense: a file of the trip with the purpose expense_receipt, not the receipt
// of another expense, uploaded (ready).
func checkReceipt(ctx context.Context, tx pgx.Tx, t trip, id uuid.UUID) error {
	var (
		state, purpose, ownerType string
		owner                     *uuid.UUID
		used                      bool
	)
	err := tx.QueryRow(ctx, `select o.state, o.purpose, o.owner_type, o.owner_id,
	       exists (select 1 from fleet.expenses e where e.receipt_file_id = o.id)
	  from files.objects o where o.id = $1`, id).Scan(&state, &purpose, &ownerType, &owner, &used)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return invalid(textForeign)
	case err != nil:
		return fmt.Errorf("expenses: receipt: %w", err)
	case purpose != "expense_receipt" || ownerType != "fleet.trip" || owner == nil || *owner != t.id:
		return invalid(textForeign)
	case used:
		return invalid(textUsed)
	case state != "ready":
		return problem.New(codePhotoNotReady, textReceiptNotYet)
	}
	return nil
}

func insert(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, t trip, b fleetapi.TripExpenseCreate) (fleetapi.TripExpense, error) {
	var comment, liters any
	if !blank(b.Comment) {
		comment = strings.TrimSpace(*b.Comment)
	}
	if b.Quantity != nil {
		liters = strings.TrimSpace(*b.Quantity)
	}
	day := occurredDay(b.OccurredAt, t.zone).Format(time.DateOnly)
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `insert into fleet.expenses (trip_id, category, amount_minor, currency, liters, occurred_on,
	        comment, receipt_file_id, claimed_by)
	      values ($1, $2, $3, $4, $5::numeric, $6::date, $7, $8, $9) returning id`,
		t.id, b.Kind, b.Amount.AmountMinor, b.Amount.Currency, liters, day, comment, b.ReceiptFileIds[0], tc.PersonID).
		Scan(&id); err != nil {
		return fleetapi.TripExpense{}, fmt.Errorf("expenses: insert: %w", err)
	}
	out, _, err := scanExpense(tx.QueryRow(ctx, expenseSelect+` where e.id = $1`, id), t.zone)
	if err != nil {
		return fleetapi.TripExpense{}, fmt.Errorf("expenses: read back: %w", err)
	}
	diff := map[string]any{"tripId": t.id, "kind": out.Kind, "amountMinor": out.Amount.AmountMinor,
		"currency": out.Amount.Currency, "occurredOn": day}
	if err := audit.Record(ctx, tx, audit.Event{ActorKind: audit.ActorPerson, ActorID: tc.PersonID, Action: "fleet.expense.create",
		TargetType: targetExpense, TargetID: id, UnitID: t.unit, Result: audit.OK, RequestID: requestID(ctx), Diff: diff}); err != nil {
		return fleetapi.TripExpense{}, fmt.Errorf("expenses: audit: %w", err)
	}
	payload := map[string]any{"expenseId": id, "unitId": t.unit, "tripNumber": t.number}
	maps.Copy(payload, diff)
	if _, err := events.Publish(ctx, tx, events.Event{Type: eventClaimed, Aggregate: targetExpense, AggregateID: id,
		Payload: payload}); err != nil {
		return fleetapi.TripExpense{}, fmt.Errorf("expenses: event: %w", err)
	}
	return out, nil
}

// cursor is the keyset position after the last expense of a page.
type cursor struct {
	At time.Time `json:"t"`
	ID uuid.UUID `json:"i"`
}

func encodeCursor(at time.Time, id uuid.UUID) string {
	b, _ := json.Marshal(cursor{At: at.UTC(), ID: id}) // plain fields always marshal
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw string) (cursor, error) {
	var c cursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err == nil {
		err = json.Unmarshal(b, &c)
	}
	if err != nil || c.ID == uuid.Nil {
		return cursor{}, problem.New(problem.CodeMalformedRequest, "Курсор не подходит к запросу.")
	}
	return c, nil
}

// List returns the expenses of a trip the subject reads (listTripExpenses), oldest first.
func (s *Service) List(ctx context.Context, tc tenantctx.TenantContext, tripID uuid.UUID, q PageQuery) (fleetapi.TripExpensePage, error) {
	limit := q.Limit
	switch {
	case limit == 0:
		limit = defaultPageLimit
	case limit < 1 || limit > maxPageLimit:
		return fleetapi.TripExpensePage{}, problem.New(problem.CodeMalformedRequest, "Размер страницы — от 1 до 200.")
	}
	var (
		at    any
		after = uuid.Nil
	)
	if q.Cursor != "" {
		c, err := decodeCursor(q.Cursor)
		if err != nil {
			return fleetapi.TripExpensePage{}, err
		}
		at, after = c.At, c.ID
	}
	var page fleetapi.TripExpensePage
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		t, err := s.readTrip(ctx, tx, s.evaluator(tx), tc, tripID, actionRead, false)
		if err != nil {
			return err
		}
		page, err = list(ctx, tx, t, at, after, limit)
		return err
	})
	return page, err
}

func list(ctx context.Context, tx pgx.Tx, t trip, at any, after uuid.UUID, limit int) (fleetapi.TripExpensePage, error) {
	rows, err := tx.Query(ctx, expenseSelect+`
	 where e.trip_id = $1 and ($2::timestamptz is null or (e.created_at, e.id) > ($2::timestamptz, $3::uuid))
	 order by e.created_at, e.id limit $4`, t.id, at, after, limit+1)
	if err != nil {
		return fleetapi.TripExpensePage{}, fmt.Errorf("expenses: list: %w", err)
	}
	defer rows.Close()
	page := fleetapi.TripExpensePage{Items: []fleetapi.TripExpense{}}
	var last time.Time
	for rows.Next() {
		x, created, err := scanExpense(rows, t.zone)
		if err != nil {
			return fleetapi.TripExpensePage{}, fmt.Errorf("expenses: list: %w", err)
		}
		if len(page.Items) == limit {
			next := encodeCursor(last, page.Items[limit-1].Id)
			page.NextCursor = &next
			break
		}
		page.Items, last = append(page.Items, x), created
	}
	if err := rows.Err(); err != nil {
		return fleetapi.TripExpensePage{}, fmt.Errorf("expenses: list: %w", err)
	}
	return page, nil
}

// Get returns an expense of a trip the subject reads (getTripExpense); a missing one or one of another trip is 404.
func (s *Service) Get(ctx context.Context, tc tenantctx.TenantContext, tripID, id uuid.UUID) (fleetapi.TripExpense, error) {
	var out fleetapi.TripExpense
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		t, err := s.readTrip(ctx, tx, s.evaluator(tx), tc, tripID, actionRead, false)
		if err != nil {
			return err
		}
		out, _, err = scanExpense(tx.QueryRow(ctx, expenseSelect+` where e.id = $1 and e.trip_id = $2`, id, t.id), t.zone)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New(problem.CodeNotFound, textNotFound)
		}
		return err
	})
	return out, err
}

// etag is the strong ETag of a revision.
func etag(revision int64) string { return `"` + strconv.FormatInt(revision, 10) + `"` }
