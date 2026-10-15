package audit

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Тест A-1 брифа W1.01: поля по CHECK-ограничениям audit.events и platform_audit, request_id, Redact.

type fakeDB struct {
	calls int
	sql   string
	args  []any
}

func (f *fakeDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.calls++
	f.sql, f.args = sql, args
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

var person = uuid.MustParse("00000000-0000-0000-0000-0000000000a1")

// withRequestID returns a context carrying the request id id, as requestid.Middleware sets it.
func withRequestID(t *testing.T, id string) context.Context {
	t.Helper()
	got := make(chan context.Context, 1)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", http.NoBody)
	r.Header.Set(requestid.Header, id)
	requestid.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got <- r.Context() })).
		ServeHTTP(httptest.NewRecorder(), r)
	return <-got
}

func valid() Event {
	return Event{
		ActorKind: ActorPerson, ActorID: person, Action: "access.assignment.create", TargetType: "access.assignment",
		TargetID: uuid.New(), Result: OK, RequestID: "req-1",
	}
}

func TestRecordValidation(t *testing.T) {
	t.Parallel()
	for name, mutate := range map[string]func(*Event){
		"actor kind":           func(e *Event) { e.ActorKind = "robot" },
		"person without id":    func(e *Event) { e.ActorID = uuid.Nil },
		"empty action":         func(e *Event) { e.Action = "" },
		"action without verb":  func(e *Event) { e.Action = "access" },
		"action upper case":    func(e *Event) { e.Action = "Access.Assignment.Create" },
		"empty target type":    func(e *Event) { e.TargetType = "" },
		"result":               func(e *Event) { e.Result = "maybe" },
		"empty result":         func(e *Event) { e.Result = "" },
		"sensitivity":          func(e *Event) { e.Sensitivity = "secret" },
		"no request id at all": func(e *Event) { e.RequestID = "" },
	} {
		e := valid()
		mutate(&e)
		db := &fakeDB{}
		if err := Record(t.Context(), db, e); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: Record = %v, want ErrInvalid", name, err)
		}
		if db.calls != 0 {
			t.Errorf("%s: invalid event written", name)
		}
	}
	for name, mutate := range map[string]func(*Event){
		"valid":                   func(*Event) {},
		"service without actor":   func(e *Event) { e.ActorKind, e.ActorID = ActorService, uuid.Nil },
		"support":                 func(e *Event) { e.ActorKind = ActorSupport },
		"restricted with diff":    func(e *Event) { e.Sensitivity, e.Diff = Restricted, map[string]any{"amount": RedactedValue} },
		"denied":                  func(e *Event) { e.Result = Denied },
		"request id from context": func(e *Event) { e.RequestID = "" },
	} {
		e := valid()
		mutate(&e)
		db := &fakeDB{}
		if err := Record(withRequestID(t, "req-ctx"), db, e); err != nil {
			t.Errorf("%s: Record = %v", name, err)
		}
		if db.calls != 1 {
			t.Errorf("%s: %d inserts, want 1", name, db.calls)
		}
	}
}

func TestRecordPlatformValidation(t *testing.T) {
	t.Parallel()
	ok := PlatformEvent{
		ActorKind: PlatformOperator, ActorID: person, Action: "platform.tenant.suspend", TargetType: "tenant",
		TargetID: uuid.New(), Reason: "Неоплата", Result: OK, RequestID: "req-2",
	}
	if err := RecordPlatform(t.Context(), &fakeDB{}, ok); err != nil {
		t.Fatalf("RecordPlatform = %v", err)
	}
	sys := ok
	sys.ActorKind, sys.ActorID = PlatformSystem, uuid.Nil
	if err := RecordPlatform(t.Context(), &fakeDB{}, sys); err != nil {
		t.Fatalf("system actor: %v", err)
	}
	for name, mutate := range map[string]func(*PlatformEvent){
		"person kind is tenant-only": func(e *PlatformEvent) { e.ActorKind = ActorPerson },
		"operator without id":        func(e *PlatformEvent) { e.ActorID = uuid.Nil },
		"action":                     func(e *PlatformEvent) { e.Action = "suspend" },
		"result":                     func(e *PlatformEvent) { e.Result = "" },
		"request id":                 func(e *PlatformEvent) { e.RequestID = "" },
	} {
		e := ok
		mutate(&e)
		if err := RecordPlatform(t.Context(), &fakeDB{}, e); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: RecordPlatform = %v, want ErrInvalid", name, err)
		}
	}
}

func TestForRequest(t *testing.T) {
	t.Parallel()
	tc := tenantctx.TenantContext{TenantID: uuid.New(), PersonID: person, AccountID: uuid.New()}
	e := ForRequest(tenantctx.WithTenant(withRequestID(t, "req-42"), tc))
	want := Event{ActorKind: ActorPerson, ActorID: person, Sensitivity: Normal, Result: OK, RequestID: "req-42"}
	if !reflect.DeepEqual(e, want) {
		t.Fatalf("ForRequest = %+v, want %+v", e, want)
	}
	if e := ForRequest(t.Context()); e.ActorKind != ActorService || e.ActorID != uuid.Nil {
		t.Fatalf("ForRequest without a tenant = %+v, want a service actor", e)
	}
}

func TestRedact(t *testing.T) {
	t.Parallel()
	diff := map[string]any{"amount": 1500, "note": "x", "iban": "RU00"}
	got := Redact(diff, "amount", "iban", "missing")
	want := map[string]any{"amount": RedactedValue, "note": "x", "iban": RedactedValue}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Redact = %v, want %v", got, want)
	}
	if diff["amount"] != 1500 {
		t.Fatal("Redact changed its argument")
	}
	if Redact(nil, "amount") != nil {
		t.Fatal("Redact(nil) must stay nil")
	}
}
