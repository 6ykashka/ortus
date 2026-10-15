package idem

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Тесты I-1…I-9 брифа W1.01 (K-24…K-27 WS-40): Guard на MemStore без HTTP-сервера.

const testKey = "k-0123456789abcdef"

var (
	tenantA = uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	tenantB = uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	actor1  = uuid.MustParse("00000000-0000-0000-0000-000000000001")
	actor2  = uuid.MustParse("00000000-0000-0000-0000-000000000002")
	nsA1    = Namespace{TenantID: tenantA, ActorID: actor1, Operation: "createThing"}
)

type single struct{ s Store }

func (s single) For(context.Context, uuid.UUID) (Store, error) { return s.s, nil }

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newGuard(st Store) (*Guard, *clock) {
	c := &clock{t: time.Date(2026, time.October, 1, 10, 30, 0, 0, time.UTC)}
	return &Guard{Stores: single{st}, Now: c.now}, c
}

// counter answers 201 {"n": <call number>} with an ETag, like a create command.
type counter struct{ n atomic.Int64 }

func (c *counter) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	n := c.n.Add(1)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", fmt.Sprintf(`"rev-%d"`, n))
	w.Header().Set("X-Other", "not stored")
	w.WriteHeader(http.StatusCreated)
	_, _ = fmt.Fprintf(w, `{"n":%d}`, n)
}

func do(g *Guard, ns Namespace, key, body string, h http.Handler) *httptest.ResponseRecorder {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/tenants/a/things", strings.NewReader(body))
	if key != "" {
		r.Header.Set(HeaderKey, key)
	}
	w := httptest.NewRecorder()
	g.Serve(w, r, ns, h)
	return w
}

func problemCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("Content-Type = %q, want problem+json (status %d, body %s)", ct, w.Code, w.Body)
	}
	var p struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatalf("problem body: %v", err)
	}
	return p.Code
}

func TestValidKey(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		key  string
		want bool
	}{
		{strings.Repeat("a", 16), true},
		{strings.Repeat("Z", 128), true},
		{"abc.DEF_123:xyz-0", true},
		{strings.Repeat("a", 15), false},
		{strings.Repeat("a", 129), false},
		{"k-0123456789abcd#", false},
		{"k-0123456789abc d", false},
		{"ключ-0123456789abcdef", false},
		{"", false},
	} {
		if got := ValidKey(tc.key); got != tc.want {
			t.Errorf("ValidKey(%q) = %v, want %v", tc.key, got, tc.want)
		}
	}
}

func TestRequestHashCoversMethodPathQueryBody(t *testing.T) {
	t.Parallel()
	req := func(method, target string) *http.Request {
		return httptest.NewRequestWithContext(t.Context(), method, target, http.NoBody)
	}
	base := requestHash(req(http.MethodPost, "/a/b"), []byte(`{"x":1}`))
	if len(base) == 0 {
		t.Fatal("empty hash")
	}
	if !bytes.Equal(base, requestHash(req(http.MethodPost, "/a/b"), []byte(`{"x":1}`))) {
		t.Error("same request: different hash")
	}
	for name, h := range map[string][]byte{
		"method":     requestHash(req(http.MethodPut, "/a/b"), []byte(`{"x":1}`)),
		"path":       requestHash(req(http.MethodPost, "/a/c"), []byte(`{"x":1}`)),
		"query":      requestHash(req(http.MethodPost, "/a/b?q=1"), []byte(`{"x":1}`)),
		"body":       requestHash(req(http.MethodPost, "/a/b"), []byte(`{"x":2}`)),
		"whitespace": requestHash(req(http.MethodPost, "/a/b"), []byte(`{"x": 1}`)),
	} {
		if bytes.Equal(base, h) {
			t.Errorf("%s does not change the hash", name)
		}
	}
}

func checkReplayHeaders(t *testing.T, h http.Header) {
	t.Helper()
	for name, want := range map[string]string{
		HeaderReplayed: "true", "ETag": `"rev-1"`, "Content-Type": "application/json", "X-Other": "",
	} {
		if got := h.Get(name); got != want {
			t.Errorf("replay header %s = %q, want %q", name, got, want)
		}
	}
}

// K-24: повтор с тем же телом — тот же ответ и Idempotency-Replayed; другое тело — 409 idempotency_key_reused.
func TestReplayAndReuse(t *testing.T) {
	t.Parallel()
	g, _ := newGuard(NewMemStore())
	h := &counter{}
	first := do(g, nsA1, testKey, `{"name":"x"}`, h)
	if first.Code != http.StatusCreated || first.Body.String() != `{"n":1}` {
		t.Fatalf("first: %d %s", first.Code, first.Body)
	}
	if first.Header().Get(HeaderReplayed) != "" {
		t.Error("first response marked as replayed")
	}
	again := do(g, nsA1, testKey, `{"name":"x"}`, h)
	if again.Code != http.StatusCreated || again.Body.String() != `{"n":1}` {
		t.Fatalf("replay: %d %s", again.Code, again.Body)
	}
	checkReplayHeaders(t, again.Header())
	if n := h.n.Load(); n != 1 {
		t.Fatalf("handler called %d times, want 1", n)
	}
	other := do(g, nsA1, testKey, `{"name":"y"}`, h)
	if other.Code != http.StatusConflict || problemCode(t, other) != "idempotency_key_reused" {
		t.Fatalf("other body: %d %s", other.Code, other.Body)
	}
	if n := h.n.Load(); n != 1 {
		t.Fatalf("handler called %d times after reuse, want 1", n)
	}
}

// K-25: повтор во время выполнения — 409 idempotency_in_progress и Retry-After ≥ 1.
func TestInProgress(t *testing.T) {
	t.Parallel()
	g, _ := newGuard(NewMemStore())
	entered, release := make(chan struct{}), make(chan struct{})
	blocking := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(entered)
		<-release
		w.WriteHeader(http.StatusNoContent)
	})
	done := make(chan *httptest.ResponseRecorder)
	go func() { done <- do(g, nsA1, testKey, `{}`, blocking) }()
	<-entered
	w := do(g, nsA1, testKey, `{}`, &counter{})
	if w.Code != http.StatusConflict || problemCode(t, w) != "idempotency_in_progress" {
		t.Fatalf("repeat while running: %d %s", w.Code, w.Body)
	}
	if s, err := strconv.Atoi(w.Header().Get("Retry-After")); err != nil || s < 1 {
		t.Errorf("Retry-After = %q, want ≥ 1", w.Header().Get("Retry-After"))
	}
	close(release)
	if first := <-done; first.Code != http.StatusNoContent {
		t.Fatalf("first: %d", first.Code)
	}
	if w := do(g, nsA1, testKey, `{}`, &counter{}); w.Code != http.StatusNoContent || w.Header().Get(HeaderReplayed) != "true" {
		t.Fatalf("after completion: %d replayed=%q", w.Code, w.Header().Get(HeaderReplayed))
	}
}

// K-26: ключ вне контракта — 400 malformed_request; без ключа Guard не участвует.
func TestKeyValidation(t *testing.T) {
	t.Parallel()
	g, _ := newGuard(NewMemStore())
	h := &counter{}
	for _, key := range []string{strings.Repeat("a", 15), strings.Repeat("a", 129), "k-0123456789abcd#"} {
		w := do(g, nsA1, key, `{}`, h)
		if w.Code != http.StatusBadRequest || problemCode(t, w) != "malformed_request" {
			t.Errorf("key %q: %d %s", key, w.Code, w.Body)
		}
	}
	if n := h.n.Load(); n != 0 {
		t.Fatalf("handler called %d times for invalid keys", n)
	}
	for range 2 {
		if w := do(g, nsA1, "", `{}`, h); w.Code != http.StatusCreated || w.Header().Get(HeaderReplayed) != "" {
			t.Fatalf("without key: %d replayed=%q", w.Code, w.Header().Get(HeaderReplayed))
		}
	}
	if n := h.n.Load(); n != 2 {
		t.Fatalf("without key the handler ran %d times, want 2", n)
	}
}

// K-27: тот же ключ у другого актора или в другой организации — другое пространство.
func TestNamespaces(t *testing.T) {
	t.Parallel()
	g, _ := newGuard(NewMemStore())
	h := &counter{}
	for i, ns := range []Namespace{
		nsA1,
		{TenantID: tenantA, ActorID: actor2, Operation: nsA1.Operation},
		{TenantID: tenantB, ActorID: actor1, Operation: nsA1.Operation},
		{TenantID: tenantA, ActorID: actor1, Operation: "otherOperation"},
		{ActorID: actor1, Operation: nsA1.Operation},
	} {
		w := do(g, ns, testKey, fmt.Sprintf(`{"i":%d}`, i), h)
		if w.Code != http.StatusCreated || w.Header().Get(HeaderReplayed) != "" {
			t.Fatalf("namespace %+v: %d replayed=%q %s", ns, w.Code, w.Header().Get(HeaderReplayed), w.Body)
		}
	}
	if n := h.n.Load(); n != 5 {
		t.Fatalf("handler ran %d times, want 5", n)
	}
}

func problemHandler(status int, code string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(status)
		_, _ = fmt.Fprintf(w, `{"code":%q,"status":%d}`, code, status)
	}
}

// Повторяемые ответы не сохраняются: повтор выполняется заново. Ошибки клиента (422) — сохраняются.
func TestRetryableOutcomesAreReleased(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name  string
		first http.Handler
		store bool
	}{
		{"503", problemHandler(http.StatusServiceUnavailable, "dependency_unavailable"), false},
		{"500", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }), false},
		{"429", problemHandler(http.StatusTooManyRequests, "rate_limited"), false},
		{"409 reservation_overlap", problemHandler(http.StatusConflict, "reservation_overlap"), false},
		{"409 resources_unavailable", problemHandler(http.StatusConflict, "resources_unavailable"), false},
		{"409 invalid_transition", problemHandler(http.StatusConflict, "invalid_transition"), true},
		{"422", problemHandler(http.StatusUnprocessableEntity, "validation_failed"), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			g, _ := newGuard(NewMemStore())
			first := do(g, nsA1, testKey, `{}`, tc.first)
			h := &counter{}
			again := do(g, nsA1, testKey, `{}`, h)
			if tc.store {
				if again.Code != first.Code || again.Body.String() != first.Body.String() || h.n.Load() != 0 {
					t.Fatalf("stored outcome not replayed: %d %s, handler %d", again.Code, again.Body, h.n.Load())
				}
				return
			}
			if again.Code != http.StatusCreated || h.n.Load() != 1 {
				t.Fatalf("retryable outcome was stored: %d %s", again.Code, again.Body)
			}
		})
	}
}

func TestPanicReleasesKey(t *testing.T) {
	t.Parallel()
	g, _ := newGuard(NewMemStore())
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("the panic of the handler was swallowed")
			}
		}()
		do(g, nsA1, testKey, `{}`, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }))
	}()
	h := &counter{}
	if w := do(g, nsA1, testKey, `{}`, h); w.Code != http.StatusCreated || h.n.Load() != 1 {
		t.Fatalf("after panic: %d, handler %d", w.Code, h.n.Load())
	}
}

func TestExpiry(t *testing.T) {
	t.Parallel()
	g, c := newGuard(NewMemStore())
	h := &counter{}
	do(g, nsA1, testKey, `{}`, h)
	c.add(DefaultTTL - time.Second)
	if w := do(g, nsA1, testKey, `{}`, h); w.Header().Get(HeaderReplayed) != "true" {
		t.Fatal("record expired before the TTL")
	}
	c.add(2 * time.Second)
	if w := do(g, nsA1, testKey, `{"other":1}`, h); w.Code != http.StatusCreated || w.Body.String() != `{"n":2}` {
		t.Fatalf("expired record: %d %s", w.Code, w.Body)
	}
}

// Запись in_progress старше аренды захватывается заново (процесс упал после Begin).
func TestStaleLeaseIsTakenOver(t *testing.T) {
	t.Parallel()
	st := NewMemStore()
	g, c := newGuard(st)
	rec := Record{Namespace: nsA1, Key: testKey, Hash: []byte("other request")}
	if out, err := st.Begin(t.Context(), rec, c.now(), c.now().Add(DefaultLease)); out != nil || err != nil {
		t.Fatalf("Begin: %v %v", out, err)
	}
	if w := do(g, nsA1, testKey, `{}`, &counter{}); w.Code != http.StatusConflict {
		t.Fatalf("live lease: %d, want 409", w.Code)
	}
	c.add(DefaultLease)
	if w := do(g, nsA1, testKey, `{}`, &counter{}); w.Code != http.StatusCreated {
		t.Fatalf("stale lease: %d %s", w.Code, w.Body)
	}
}

type failingStores struct{ err error }

func (f failingStores) For(context.Context, uuid.UUID) (Store, error) { return nil, f.err }

type failingStore struct{ MemStore }

func (*failingStore) Begin(context.Context, Record, time.Time, time.Time) (*Outcome, error) {
	return nil, errors.New("connection refused")
}

func TestStoreFailure(t *testing.T) {
	t.Parallel()
	h := &counter{}
	for name, g := range map[string]*Guard{
		"stores": {Stores: failingStores{errors.New("pool")}},
		"begin":  {Stores: single{&failingStore{}}},
	} {
		w := do(g, nsA1, testKey, `{}`, h)
		if w.Code != http.StatusServiceUnavailable || problemCode(t, w) != "dependency_unavailable" {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	if h.n.Load() != 0 {
		t.Fatal("handler ran without a claimed key")
	}
}

// Хендлер видит запись и полное тело; итог, записанный сервисом, middleware не перезаписывает.
func TestServiceOutcomeWins(t *testing.T) {
	t.Parallel()
	st := NewMemStore()
	g, c := newGuard(st)
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec, ok := FromContext(r.Context())
		if !ok || rec.Namespace != nsA1 || rec.Key != testKey || len(rec.Hash) == 0 {
			t.Errorf("FromContext = %+v, %v", rec, ok)
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != `{"name":"x"}` {
			t.Errorf("handler body = %q", body)
		}
		out := Outcome{Status: http.StatusCreated, Header: http.Header{"Content-Type": {"application/json"}}, Body: []byte(`{"from":"service"}`)}
		if err := st.Complete(r.Context(), rec, out, c.now().Add(DefaultTTL)); err != nil {
			t.Errorf("Complete: %v", err)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"from":"handler"}`)
	})
	do(g, nsA1, testKey, `{"name":"x"}`, h)
	if w := do(g, nsA1, testKey, `{"name":"x"}`, &counter{}); w.Body.String() != `{"from":"service"}` {
		t.Fatalf("replay = %s, want the outcome of the service", w.Body)
	}
}

func TestCompleteInTxWithoutRecord(t *testing.T) {
	t.Parallel()
	if err := CompleteInTx(t.Context(), nil, http.StatusOK, nil, nil); !errors.Is(err, ErrNoRecord) {
		t.Fatalf("CompleteInTx outside Guard = %v, want ErrNoRecord", err)
	}
}
