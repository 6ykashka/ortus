//go:build integration

package idem

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AC-07 (design/docs/15-quality-security.md:41): «100 повторов команды с одним ключом → один эффект».
// 100 параллельных запросов с одним ключом и телом через Guard на tenant DB: эффект (событие outbox и запись
// аудита) и итог команды пишутся в одной транзакции (CompleteInTx).
func TestAC07HundredRepeatsOneEffect(t *testing.T) {
	t.Parallel()
	pool := apiPool(t)
	g := guardOn(pool, time.Now)
	cmd := effectWithAudit(t, pool)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { g.Serve(w, r, nsA1, cmd) }))
	t.Cleanup(srv.Close)

	const repeats = 100
	results := make([]ac07Result, repeats)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range repeats {
		wg.Go(func() {
			<-start
			results[i] = post(t, srv.URL)
		})
	}
	close(start)
	wg.Wait()

	if n := countRows(t, pool, "outbox.events"); n != 1 {
		t.Fatalf("outbox.events = %d after %d repeats, want 1", n, repeats)
	}
	if n := countRows(t, pool, "audit.events"); n != 1 {
		t.Fatalf("audit.events = %d after %d repeats, want 1", n, repeats)
	}
	created := checkRepeats(t, results)
	// After completion every repeat replays the one outcome.
	for range 3 {
		r := post(t, srv.URL)
		if r.status != http.StatusCreated || !r.replayed || (created != "" && r.body != created) {
			t.Fatalf("repeat after completion: %d replayed=%v %s (first %s)", r.status, r.replayed, r.body, created)
		}
	}
}

type ac07Result struct {
	status   int
	body     string
	replayed bool
}

// checkRepeats accepts 201 with one body and 409 idempotency_in_progress; it returns the body of 201.
func checkRepeats(t *testing.T, results []ac07Result) string {
	t.Helper()
	var created string
	for i, r := range results {
		switch r.status {
		case http.StatusCreated:
			if created == "" {
				created = r.body
			}
			if r.body != created {
				t.Errorf("repeat %d: body %s, want %s", i, r.body, created)
			}
		case http.StatusConflict:
			var p struct{ Code string }
			if err := json.Unmarshal([]byte(r.body), &p); err != nil || p.Code != codeInProgress {
				t.Errorf("repeat %d: 409 %s, want %s", i, r.body, codeInProgress)
			}
		default:
			t.Errorf("repeat %d: status %d %s", i, r.status, r.body)
		}
	}
	return created
}
func post(t *testing.T, url string) (r ac07Result) {
	t.Helper()

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url+"/api/v1/tenants/a/things", strings.NewReader(`{"name":"Р-208"}`))
	if err != nil {
		t.Error(err)
		return r
	}
	req.Header.Set(HeaderKey, "ac07-0123456789abcdef")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Error(err)
		return r
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	r.status, r.body, r.replayed = resp.StatusCode, string(b), resp.Header.Get(HeaderReplayed) == "true"
	return r
}

// effectWithAudit is a create command: an outbox event and an audit record in one transaction with the outcome.
func effectWithAudit(t *testing.T, pool *pgxpool.Pool) http.HandlerFunc {
	t.Helper()
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		tx, err := pool.Begin(ctx)
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
		var id int64
		if err := tx.QueryRow(ctx, `insert into outbox.events (type, aggregate, aggregate_id, payload)
values ('test.thing.created.v1', 'thing', gen_random_uuid(), '{}') returning id`).Scan(&id); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		if _, err := tx.Exec(ctx, `insert into audit.events (actor_kind, actor_id, action, target_type, result, request_id)
values ('person', $1, 'test.thing.create', 'thing', 'ok', 'ac07')`, actor1); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		time.Sleep(20 * time.Millisecond) // a command takes time: repeats arrive while it runs
		body := fmt.Appendf(nil, `{"id":%d}`, id)
		if err := CompleteInTx(ctx, tx, http.StatusCreated, http.Header{"Content-Type": {"application/json"}}, body); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write(body)
	}
}
