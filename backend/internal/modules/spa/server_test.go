package spa

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// A taken resource is a retryable 409 that names the fields of the request and nothing of the other bookings.
func TestBodyOfUnavailable(t *testing.T) {
	t.Parallel()
	b := body(context.Background(), unavailable(textBusy, "roomId", "equipmentIds[0]"))
	if b.Code != "resources_unavailable" || b.Status != 409 || b.Retryable == nil || !*b.Retryable {
		t.Fatalf("problem: %+v", b)
	}
	if b.Violations == nil || len(*b.Violations) != 2 || (*b.Violations)[0].Field != "roomId" || (*b.Violations)[1].Field != "equipmentIds[0]" {
		t.Fatalf("violations: %+v", b.Violations)
	}
}

// A refusal with a reason carries it and nothing else: no fields, not retryable.
func TestBodyOfConflict(t *testing.T) {
	t.Parallel()
	c := body(context.Background(), conflict(ReasonInsufficientStock, "Не хватает материала"))
	if c.Code != "invalid_transition" || c.Reason == nil || *c.Reason != "insufficient_stock" || c.Violations != nil || c.Retryable != nil {
		t.Fatalf("conflict: %+v", c)
	}
}

// reply turns a refusal into the typed 422 or 409 of the operation and leaves any other error to problem.Write.
func TestReplyMapsRefusals(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var ok api.CreateAppointmentResponseObject = api.CreateAppointment201JSONResponse{}
	got, err := reply(ctx, invalid("roomId", "x"), ok, api.CreateAppointment422ApplicationProblemPlusJSONResponse{}, api.CreateAppointment409ApplicationProblemPlusJSONResponse{})
	if _, is := got.(api.CreateAppointment422ApplicationProblemPlusJSONResponse); !is || err != nil {
		t.Fatalf("422: %T %v", got, err)
	}
	got, err = reply(ctx, unavailable(textBusy, "roomId"), ok, api.CreateAppointment422ApplicationProblemPlusJSONResponse{}, api.CreateAppointment409ApplicationProblemPlusJSONResponse{})
	if _, is := got.(api.CreateAppointment409ApplicationProblemPlusJSONResponse); !is || err != nil {
		t.Fatalf("409: %T %v", got, err)
	}
	boom := errors.New("boom")
	if got, err = reply(ctx, boom, ok, api.CreateAppointment422ApplicationProblemPlusJSONResponse{}, api.CreateAppointment409ApplicationProblemPlusJSONResponse{}); got != nil || !errors.Is(err, boom) {
		t.Fatalf("other error: %T %v", got, err)
	}
	got, err = reply(ctx, nil, ok, api.CreateAppointment422ApplicationProblemPlusJSONResponse{}, api.CreateAppointment409ApplicationProblemPlusJSONResponse{})
	if _, is := got.(api.CreateAppointment201JSONResponse); !is || err != nil {
		t.Fatalf("success: %T %v", got, err)
	}
}

func TestQueryOf(t *testing.T) {
	t.Parallel()
	zero, five, cursor := 0, 5, "abc"
	if q := queryOf(nil, nil); q.Limit != 0 || q.Cursor != "" {
		t.Fatalf("defaults: %+v", q)
	}
	if q := queryOf(&cursor, &five); q.Limit != 5 || q.Cursor != "abc" {
		t.Fatalf("given: %+v", q)
	}
	if _, err := limitOf(queryOf(nil, &zero)); err == nil {
		t.Fatal("an explicit zero is out of the page sizes")
	}
}

// Revisions: none — 428, a stale or foreign one — 412, «rev-N» with or without quotes and W/ matches.
func TestCheckRevision(t *testing.T) {
	t.Parallel()
	for _, ok := range []string{`"rev-3"`, `rev-3`, `W/"rev-3"`} {
		if err := checkRevision(ok, 3); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
	if err := checkRevision("", 3); !problem.Is(err, "revision_required") {
		t.Errorf("none: %v", err)
	}
	for _, stale := range []string{`"rev-2"`, `"3"`, `*`} {
		if err := checkRevision(stale, 3); !problem.Is(err, "revision_mismatch") {
			t.Errorf("%s: %v", stale, err)
		}
	}
}

// Without a tenant on the context every handler answers not_found before it reaches the service.
func TestServerWithoutTenant(t *testing.T) {
	t.Parallel()
	s, ctx, id := Server{}, context.Background(), uuid.New()
	_, err := s.CreateSpaService(ctx, api.CreateSpaServiceRequestObject{})
	if !problem.Is(err, "not_found") {
		t.Errorf("createSpaService: %v", err)
	}
	_, err = s.GetAppointment(ctx, api.GetAppointmentRequestObject{AppointmentId: id})
	if !problem.Is(err, "not_found") {
		t.Errorf("getAppointment: %v", err)
	}
	_, err = s.CompleteAppointment(ctx, api.CompleteAppointmentRequestObject{AppointmentId: id})
	if !problem.Is(err, "not_found") {
		t.Errorf("completeAppointment: %v", err)
	}
}
