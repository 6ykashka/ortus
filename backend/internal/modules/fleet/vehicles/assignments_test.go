package vehicles

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.42: cursor of the shared helpers (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func TestCheckMove(t *testing.T) {
	t.Parallel()
	unit := uuid.New()
	in, err := checkMove(&fleetapi.VehicleMove{OrgUnitId: unit, Reason: "  Передана в Самару-2 \n"})
	if err != nil || in.unit != unit || in.reason != "Передана в Самару-2" {
		t.Fatalf("checkMove = %+v, %v; want the unit and the trimmed reason", in, err)
	}
	if _, err := checkMove(&fleetapi.VehicleMove{OrgUnitId: unit, Reason: strings.Repeat("я", maxReason)}); err != nil {
		t.Errorf("a reason of %d runes: %v, want accepted", maxReason, err)
	}
	for name, c := range map[string]struct {
		body *fleetapi.VehicleMove
		code string
	}{
		"без тела":        {nil, problem.CodeMalformedRequest},
		"пустая причина":  {&fleetapi.VehicleMove{OrgUnitId: unit, Reason: " \t "}, kit.CodeValidationFailed},
		"длинная причина": {&fleetapi.VehicleMove{OrgUnitId: unit, Reason: strings.Repeat("я", maxReason+1)}, kit.CodeValidationFailed},
	} {
		_, err := checkMove(c.body)
		if !problem.Is(err, c.code) {
			t.Errorf("%s: %v, want %s", name, err, c.code)
		}
	}
	_, err = checkMove(&fleetapi.VehicleMove{OrgUnitId: unit})
	if pe, ok := errors.AsType[*problem.Error](err); !ok || pe.Detail != textMoveReason {
		t.Errorf("no reason: %v, want %q", err, textMoveReason)
	}
}

// A vehicle moves only when nothing holds it: a trip that is not closed (assigned … rework) or a live hold or a
// confirmed reservation (the contract: «held, reserved or on a trip that is not closed» — 409).
func TestStateBusy(t *testing.T) {
	t.Parallel()
	trip := uuid.New()
	for name, c := range map[string]struct {
		s    State
		busy bool
	}{
		"свободна":             {State{Service: ServiceOK}, false},
		"на ТО":                {State{Service: ServiceMaintenance}, false},
		"блокирующий дефект":   {State{Service: ServiceOK, Defect: DefectInReview}, false},
		"бронь":                {State{Service: ServiceOK, Held: true}, true},
		"бронь за рейсом":      {State{Service: ServiceOK, Held: true, HoldTripID: &trip}, true},
		"назначена на рейс":    {State{Service: ServiceOK, TripID: &trip, TripState: TripAssigned}, true},
		"на маршруте":          {State{Service: ServiceOK, TripID: &trip, TripState: TripOnRoute}, true},
		"смена на приёмке":     {State{Service: ServiceOK, TripID: &trip, TripState: TripSubmitted}, true},
		"доработка":            {State{Service: ServiceOK, TripID: &trip, TripState: TripRework}, true},
		"на ТО и в рейсе":      {State{Service: ServiceMaintenance, TripID: &trip, TripState: TripReturning}, true},
		"дефект на осмотре":    {State{Service: ServiceOK, TripID: &trip, TripState: TripDefectReview}, true},
		"осмотр перед выездом": {State{Service: ServiceOK, TripID: &trip, TripState: TripInspection}, true},
	} {
		if got := c.s.Busy(); got != c.busy {
			t.Errorf("%s: Busy() = %v, want %v", name, got, c.busy)
		}
	}
}

// The move happens at the clock of the application; a period that opened later (the vehicle was registered by the
// clock of the database while the application clock is fixed in the past) ends a microsecond after its start, so that
// the periods stay ordered (vehicle_assignments_period). The database keeps microseconds.
func TestMoveInstant(t *testing.T) {
	t.Parallel()
	opened := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	for name, c := range map[string]struct {
		now, want time.Time
	}{
		"позже начала":              {opened.Add(time.Hour), opened.Add(time.Hour)},
		"наносекунды отбрасываются": {opened.Add(time.Hour + 999), opened.Add(time.Hour)},
		"в момент начала":           {opened, opened.Add(time.Microsecond)},
		"меньше микросекунды":       {opened.Add(500), opened.Add(time.Microsecond)},
		"часы в прошлом":            {opened.Add(-24 * time.Hour), opened.Add(time.Microsecond)},
	} {
		if got := moveInstant(c.now, opened); !got.Equal(c.want) {
			t.Errorf("%s: moveInstant = %s, want %s", name, got, c.want)
		}
	}
}

func TestParseHistoryPage(t *testing.T) {
	t.Parallel()
	p, err := parseHistoryPage(fleetapi.ListVehicleAssignmentsParams{})
	if err != nil || p.limit != kit.DefaultLimit || p.afterAt != nil || p.afterID != nil {
		t.Fatalf("no parameters: %+v %v, want the default page", p, err)
	}
	at, id, limit := time.Date(2026, 9, 1, 6, 0, 0, 123000, time.UTC), uuid.New(), 2
	cursor := kit.EncodeCursor(at.Format(time.RFC3339Nano), id.String())
	p, err = parseHistoryPage(fleetapi.ListVehicleAssignmentsParams{Cursor: &cursor, Limit: &limit})
	if err != nil || p.limit != 2 || !p.afterAt.Equal(at) || *p.afterID != id {
		t.Fatalf("cursor: %+v %v", p, err)
	}
	zero, bad, notTime, notID := 0, "eyJ4Ijox", kit.EncodeCursor("вчера", id.String()), kit.EncodeCursor(at.Format(time.RFC3339Nano), "x")
	for name, params := range map[string]fleetapi.ListVehicleAssignmentsParams{
		"лимит 0":          {Limit: &zero},
		"чужой курсор":     {Cursor: &bad},
		"не время":         {Cursor: &notTime},
		"не идентификатор": {Cursor: &notID},
	} {
		if _, err := parseHistoryPage(params); !problem.Is(err, problem.CodeMalformedRequest) {
			t.Errorf("%s: %v, want malformed_request", name, err)
		}
	}
}

func TestAssignmentDTO(t *testing.T) {
	t.Parallel()
	from, to := time.Date(2026, 9, 1, 9, 0, 0, 0, time.FixedZone("MSK", 3*3600)), time.Date(2026, 10, 1, 6, 0, 0, 0, time.UTC)
	by, reason := uuid.New(), "Передана в Самару-2"
	a := Assignment{ID: uuid.New(), Vehicle: uuid.New(), Unit: uuid.New(), UnitName: "Самара-2", From: from, To: &to, Reason: &reason, By: &by}
	got := a.DTO()
	if got.Id != a.ID || got.VehicleId != a.Vehicle || got.OrgUnitId != a.Unit || *got.OrgUnitName != "Самара-2" ||
		got.ValidFrom.Location() != time.UTC || !got.ValidFrom.Equal(from) || !got.ValidTo.Equal(to) ||
		*got.Reason != reason || *got.AssignedByMemberId != by {
		t.Fatalf("DTO = %+v", got)
	}
	open := Assignment{ID: uuid.New(), Vehicle: a.Vehicle, Unit: a.Unit, UnitName: "Москва-1", From: from}
	if got := open.DTO(); got.ValidTo != nil || got.Reason != nil || got.AssignedByMemberId != nil {
		t.Fatalf("the open period of the registration: %+v, want no end, reason and author", got)
	}
}

// UnitAtSQL is the unit a vehicle belonged to at an instant, for the scope predicates (authz.Columns.Unit) and the
// reports of the modules whose rows are dated: the first period that ends after the instant — the period of the
// instant, or the first period when the instant comes before the registration.
func TestUnitAtSQL(t *testing.T) {
	t.Parallel()
	got := UnitAtSQL("i.vehicle_id", "i.submitted_at")
	for _, want := range []string{
		"select a.unit_id from fleet.vehicle_assignments a",
		"a.vehicle_id = i.vehicle_id",
		"(a.valid_to is null or i.submitted_at < a.valid_to)",
		"order by a.valid_from",
		"limit 1",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("UnitAtSQL = %s, want %q in it", got, want)
		}
	}
	if !strings.HasPrefix(got, "(") || !strings.HasSuffix(got, ")") {
		t.Errorf("UnitAtSQL = %s, want a parenthesized expression", got)
	}
}
