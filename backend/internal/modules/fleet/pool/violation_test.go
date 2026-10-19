package pool

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W2.57 (review of return 1, decide.go): the 422 of the body of decideDriverTransfer names its field as the contract
// says and as MSW answers (fleet/pool.ts): endsAt without extend or extend without endsAt — field endsAt, code extend,
// before the other checks (no DB is read).
func TestDecideNamesTheField(t *testing.T) {
	t.Parallel()
	h := NewServer(nil, &Service{})
	ctx := tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New(), PersonID: uuid.New()})
	until := time.Date(2026, 10, 2, 7, 0, 0, 0, time.UTC)
	for name, b := range map[string]fleetapi.DriverTransferDecision{
		"endsAt без продления": {Decision: fleetapi.DriverTransferDecisionDecisionApprove, EndsAt: &until},
		"продление без endsAt": {Decision: fleetapi.DriverTransferDecisionDecisionExtend},
	} {
		out, err := h.DecideDriverTransfer(ctx, fleetapi.DecideDriverTransferRequestObject{RequestId: uuid.New(), Body: &b})
		res, ok := out.(fleetapi.DecideDriverTransfer422ApplicationProblemPlusJSONResponse)
		if err != nil || !ok {
			t.Fatalf("%s: %#v %v, want the 422 with its violation", name, out, err)
		}
		wantViolation(t, name, res.Body, textWindow, fleetapi.ProblemViolation{Field: "endsAt", Code: "extend",
			Message: "Новый конец окна — только у продления"})
	}
}

// The refusals of an extension name their field (Extension → fieldError): the end — endsAt, code range; outside
// the free window — window, code outside_free_window (MSW extendTransfer).
func TestExtensionNamesTheField(t *testing.T) {
	t.Parallel()
	at := func(h int) time.Time { return time.Date(2026, 10, 1, h, 0, 0, 0, time.UTC) }
	period, free := Window{Start: at(8), End: at(12)}, Window{Start: at(6), End: at(20)}
	for name, c := range map[string]struct {
		until, now time.Time
		detail     string
		want       fleetapi.ProblemViolation
	}{
		"не позже конца": {at(11), at(9), textWindow, fleetapi.ProblemViolation{Field: "endsAt", Code: "range",
			Message: "Конец окна — позже нынешнего и позже текущего момента"}},
		"окно прошло": {at(13), at(14), textWindowPast, fleetapi.ProblemViolation{Field: "endsAt", Code: "range",
			Message: "Конец окна — позже нынешнего и позже текущего момента"}},
		"вне свободного окна": {at(21), at(9), textOutside, fleetapi.ProblemViolation{Field: "window",
			Code: "outside_free_window", Message: "Вне свободного окна водителя"}},
	} {
		_, err := Extension(period, free, c.until, c.now)
		res, ok := validation(context.Background(), err)
		if !ok {
			t.Fatalf("%s: %v, want a refusal of a field", name, err)
		}
		wantViolation(t, name, res.Body, c.detail, c.want)
	}
}

func wantViolation(t *testing.T, name string, p fleetapi.Problem, detail string, want fleetapi.ProblemViolation) {
	t.Helper()
	if p.Code != "validation_failed" || p.Status != 422 || p.Detail == nil || *p.Detail != detail || p.Violations == nil ||
		len(*p.Violations) != 1 || (*p.Violations)[0] != want {
		t.Errorf("%s: %+v (violations %v), want %q and %+v", name, p, p.Violations, detail, want)
	}
}
