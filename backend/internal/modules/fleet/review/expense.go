package review

import (
	"context"
	"fmt"
	"net/http"
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

// reviewable are the states of a trip whose expenses the manager checks one by one: started and not accepted yet
// (the acceptance confirms the waiting ones itself).
var reviewable = map[string]bool{"on_route": true, "returning": true, stateSubmitted: true, stateRework: true}

const lockExpenseSQL = `select state, revision from fleet.expenses where id = $1 and trip_id = $2 for update`

const expenseSQL = `
select e.id, e.trip_id, e.category, e.amount_minor, e.currency, trim_scale(e.liters)::text, e.occurred_on, e.comment,
       e.receipt_file_id, e.state, e.revision, u.time_zone
  from fleet.expenses e
  join fleet.trips t on t.id = e.trip_id
  join org.units u on u.id = t.unit_id
 where e.id = $1`

// ReviewExpense is the decision of the manager on one expense of a trip (reviewTripExpense, S2-11): approve or reject
// an expense that waits (claimed), with the If-Match of the expense, while the shift is not accepted. Locks: the trip,
// then the expense (the order of createTripExpense and reviewTrip).
func (s *Service) ReviewExpense(ctx context.Context, tc tenantctx.TenantContext, tripID, expenseID uuid.UUID, ifMatch string, b fleetapi.ExpenseReview) (fleetapi.TripExpense, error) {
	if err := checkExpenseReview(&b); err != nil {
		return fleetapi.TripExpense{}, err
	}
	var out fleetapi.TripExpense
	err := s.inTx(ctx, tc, func(s *Service, tx pgx.Tx) error {
		t, err := lockTrip(ctx, tx, tripID)
		if err != nil {
			return err
		}
		if err := s.authorize(ctx, tx, tc, t, actionExpenseReview, textOwnExpense); err != nil {
			return err
		}
		var (
			state    string
			revision int64
		)
		if err := tx.QueryRow(ctx, lockExpenseSQL, expenseID, t.id).Scan(&state, &revision); errNoRows(err) {
			return problem.New(problem.CodeNotFound, textExpenseNotFound)
		} else if err != nil {
			return fmt.Errorf("review: expense: %w", err)
		}
		if err := checkRevision(ifMatch, revision); err != nil {
			return err
		}
		switch {
		case state != "claimed":
			return problem.New(codeInvalidTransition, textExpenseDone)
		case !reviewable[t.state]:
			return problem.New(codeInvalidTransition, textExpenseClosed)
		}
		now := s.now()
		if _, err := tx.Exec(ctx, `update fleet.expenses set state = $2, reviewed_by = $3, reviewed_at = $4, revision = revision + 1
			 where id = $1`, expenseID, decided(b.Decision), tc.PersonID, now); err != nil {
			return fmt.Errorf("review: expense decision: %w", err)
		}
		if out, err = readExpense(ctx, tx, expenseID); err != nil {
			return err
		}
		diff := map[string]any{"tripId": t.id, fieldDecision: b.Decision}
		if !blank(b.Comment) {
			diff["comment"] = strings.TrimSpace(*b.Comment)
		}
		if _, err := record(ctx, tx, tc, audit.Event{Action: "fleet.expense.review", TargetType: targetExpense, TargetID: expenseID,
			UnitID: t.unit, Diff: diff}, events.Event{Type: eventExpenseChecked, Aggregate: targetExpense, AggregateID: expenseID,
			Payload: map[string]any{"expenseId": expenseID, "tripId": t.id, "unitId": t.unit, "tripNumber": t.number,
				fieldDecision: b.Decision}}); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// readExpense reads TripExpense id in the transaction of a command that checked access (as W2.05 fleet/expenses:
// the day of the expense is noon of that day in the time zone of the trip unit).
func readExpense(ctx context.Context, tx pgx.Tx, id uuid.UUID) (fleetapi.TripExpense, error) {
	var (
		x       fleetapi.TripExpense
		kind    string
		day     time.Time
		receipt *uuid.UUID
		state   string
		zone    string
	)
	if err := tx.QueryRow(ctx, expenseSQL, id).Scan(&x.Id, &x.TripId, &kind, &x.Amount.AmountMinor, &x.Amount.Currency, &x.Quantity,
		&day, &x.Comment, &receipt, &state, &x.Revision, &zone); err != nil {
		return fleetapi.TripExpense{}, fmt.Errorf("review: read expense: %w", err)
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		loc = time.UTC
	}
	y, m, d := day.Date()
	x.Kind, x.ReviewState = kind, reviewState(state)
	x.OccurredAt = time.Date(y, m, d, 12, 0, 0, 0, loc).UTC()
	x.Amount.Currency = strings.TrimSpace(x.Amount.Currency)
	x.ReceiptFileIds = []uuid.UUID{}
	if receipt != nil {
		x.ReceiptFileIds = append(x.ReceiptFileIds, *receipt)
	}
	return x, nil
}
