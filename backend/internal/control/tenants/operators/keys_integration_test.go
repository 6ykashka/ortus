//go:build integration

package operators

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants/platformhttp"
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

func record(actor, tenant uuid.UUID, op, key, hash string) idem.Record {
	return idem.Record{Namespace: idem.Namespace{TenantID: tenant, ActorID: actor, Operation: op}, Key: key, Hash: []byte(hash)}
}

// outcome is what a test checks of Begin: the stored answer or the error.
type outcome struct {
	Status int
	ETag   string
	Type   string
	Other  string
	Body   string
	Err    error
}

func begin(t *testing.T, k Keys, rec idem.Record, at time.Time) outcome {
	t.Helper()
	out, err := k.Begin(t.Context(), rec, at, at.Add(2*time.Minute))
	if out == nil {
		return outcome{Err: err}
	}
	return outcome{Status: out.Status, ETag: out.Header.Get("ETag"), Type: out.Header.Get("Content-Type"), Other: out.Header.Get("X-Other"),
		Body: string(out.Body), Err: err}
}

// T-05: ключи identity- и platform-операций в control 0005: захват (tenant null), «ещё выполняется», сохранённый ответ
// с заголовками контракта, другой запрос с тем же ключом, протухший ключ.
func TestKeys(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	keys := Keys{DB: s.api}
	actor := uuid.New()
	rec := record(actor, uuid.Nil, "suspendPlatformTenant", "key-0000000000000001", "hash-1")
	expires := now.Add(7 * 24 * time.Hour)

	eq(t, "claim", begin(t, keys, rec, now), outcome{})
	eq(t, "in progress row", s.count(`select count(*) from idempotency_keys where actor_id = $1 and tenant_id is null
		and operation = 'suspendPlatformTenant' and key = 'key-0000000000000001' and state = 'in_progress'`, actor), 1)
	eq(t, "repeat in progress", begin(t, keys, rec, now), outcome{Err: idem.ErrInProgress})
	header := http.Header{"Etag": {`"2"`}, "Content-Type": {"application/json"}, "X-Other": {"dropped"}}
	body := `{"id":"x","name":"Альта"}`
	must(t, keys.Complete(t.Context(), rec, idem.Outcome{Status: 200, Header: header, Body: []byte(body)}, expires))
	eq(t, "replay", begin(t, keys, rec, now), outcome{Status: 200, ETag: `"2"`, Type: "application/json", Body: body})
	eq(t, "other request", begin(t, keys, record(actor, uuid.Nil, "suspendPlatformTenant", "key-0000000000000001", "hash-2"), now),
		outcome{Err: idem.ErrKeyReused})
	eq(t, "expired", begin(t, keys, record(actor, uuid.Nil, "suspendPlatformTenant", "key-0000000000000001", "hash-3"), expires.Add(time.Second)),
		outcome{})
}

// T-05: пространство тенант + actor + операция: другой актор, операция или тенант — свой ключ.
func TestKeysNamespace(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	keys := Keys{DB: s.api}
	actor := uuid.New()
	eq(t, "first", begin(t, keys, record(actor, uuid.Nil, "suspendPlatformTenant", "key-0000000000000001", "hash-1"), now), outcome{})
	for _, other := range []idem.Record{
		record(uuid.New(), uuid.Nil, "suspendPlatformTenant", "key-0000000000000001", "hash-2"),
		record(actor, uuid.Nil, "resumePlatformTenant", "key-0000000000000001", "hash-2"),
		record(actor, uuid.New(), "suspendPlatformTenant", "key-0000000000000001", "hash-2"),
	} {
		eq(t, "namespace "+other.Operation, begin(t, keys, other, now), outcome{})
	}
	eq(t, "rows", [2]int{s.count(`select count(*) from idempotency_keys`), s.count(`select count(*) from idempotency_keys where tenant_id is not null`)},
		[2]int{4, 1})
}

// T-05: освобождение незавершённого — повтор выполняется снова; завершение освобождённого — без следа; просроченная
// аренда незавершённой команды захватывается.
func TestKeysRelease(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	keys := Keys{DB: s.api}
	free := record(uuid.New(), uuid.Nil, "extendPlatformTrial", "key-0000000000000002", "hash-1")
	eq(t, "claim", begin(t, keys, free, now), outcome{})
	must(t, keys.Release(t.Context(), free))
	must(t, keys.Complete(t.Context(), free, idem.Outcome{Status: 200}, now.Add(time.Hour)))
	eq(t, "released rows", s.count(`select count(*) from idempotency_keys`), 0)
	eq(t, "after release", begin(t, keys, free, now), outcome{})
	eq(t, "lease taken over", begin(t, keys, free, now.Add(3*time.Minute)), outcome{})
}

// commandHandler is the tag Platform over the control DB behind a gateway stand-in: the session of the operator and
// the idempotency guard with Keys, as cmd/api mounts them.
func commandHandler(s *stand, operator uuid.UUID) http.Handler {
	r := chi.NewRouter()
	requestError := func(w http.ResponseWriter, req *http.Request, err error) {
		problem.Write(w, req, problem.Wrap(problem.CodeMalformedRequest, err))
	}
	srv := &Server{Server: &platformhttp.Server{Store: platformhttp.SQLStore{Control: s.api}}, Commands: s.svc}
	platformapi.HandlerWithOptions(platformapi.NewStrictHandlerWithOptions(srv, nil, platformapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: requestError, ResponseErrorHandlerFunc: problem.Write,
	}), platformapi.ChiServerOptions{BaseRouter: r, ErrorHandlerFunc: requestError})
	guard := &idem.Guard{Stores: idem.TenantStores{Platform: Keys{DB: s.api}}, Now: func() time.Time { return now }}
	return requestid.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		req = req.WithContext(session.WithSession(req.Context(), session.Session{AccountID: operator}))
		if req.Method == http.MethodGet {
			r.ServeHTTP(w, req)
			return
		}
		op := req.URL.Path[strings.LastIndex(req.URL.Path, "/")+1:] + "PlatformTenant"
		guard.Serve(w, req, idem.Namespace{ActorID: operator, Operation: op}, r)
	}))
}

// answer is what a test checks of an HTTP answer.
type answer struct {
	Status         int
	ETag, Replayed string
	Body           string
}

func call(t *testing.T, h http.Handler, method, path, body string, header map[string]string) answer {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return answer{Status: rec.Code, ETag: rec.Header().Get("ETag"), Replayed: rec.Header().Get("Idempotency-Replayed"), Body: rec.Body.String()}
}

// T-05: сквозь HTTP поверх control DB — карточка → ETag → приостановка → повтор с тем же ключом отдаёт сохранённый
// ответ (Idempotency-Replayed: true) без второй записи аудита → тот же ключ с другим телом — 409 → возобновление по
// новому ETag → старый ETag — 412.
func TestCommandsOverHTTP(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	op := s.operator(RoleOwner, "active")
	id := s.tenant("http", StateActive, now.Add(-day))
	path := "/api/v1/platform/tenants/" + id.String()
	h := commandHandler(s, op)

	card := call(t, h, http.MethodGet, path, "", nil)
	eq(t, "card", [2]any{card.Status, card.ETag}, [2]any{http.StatusOK, `"1"`})
	cmd := map[string]string{"Idempotency-Key": "key-http-000000000001", "If-Match": card.ETag}
	first := call(t, h, http.MethodPost, path+"/suspend", `{"reason":"Неоплата счёта"}`, cmd)
	eq(t, "suspend", [3]any{first.Status, first.ETag, first.Replayed}, [3]any{http.StatusOK, `"2"`, "false"})
	again := call(t, h, http.MethodPost, path+"/suspend", `{"reason":"Неоплата счёта"}`, cmd)
	eq(t, "replay", again, answer{Status: http.StatusOK, ETag: `"2"`, Replayed: "true", Body: first.Body})
	eq(t, "audit rows after replay", len(s.audits(id)), 1)
	eq(t, "stored keys", s.count(`select count(*) from idempotency_keys where key = 'key-http-000000000001' and state = 'completed' and tenant_id is null`), 1)
	reused := call(t, h, http.MethodPost, path+"/suspend", `{"reason":"Другая причина"}`, cmd)
	eq(t, "reused", [2]any{reused.Status, strings.Contains(reused.Body, "idempotency_key_reused")}, [2]any{http.StatusConflict, true})
	resume := call(t, h, http.MethodPost, path+"/resume", `{"reason":"Оплата пришла"}`,
		map[string]string{"Idempotency-Key": "key-http-000000000002", "If-Match": first.ETag})
	eq(t, "resume", [2]any{resume.Status, strings.Contains(resume.Body, `"status":"active"`)}, [2]any{http.StatusOK, true})
	stale := call(t, h, http.MethodPost, path+"/suspend", `{"reason":"Неоплата счёта"}`,
		map[string]string{"Idempotency-Key": "key-http-000000000003", "If-Match": card.ETag})
	eq(t, "stale", [2]any{stale.Status, strings.Contains(stale.Body, "revision_mismatch")}, [2]any{http.StatusPreconditionFailed, true})
}
