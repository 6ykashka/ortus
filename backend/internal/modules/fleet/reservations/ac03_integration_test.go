//go:build integration

package reservations

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5" //nolint:depguard // integration test: the router of the generated strict server, as cmd/api mounts it
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// rest puts the other operations of the tag one level below the reservations: they are never called here.
type rest struct{ fleetapi.StrictServerInterface }

type onlyReservations struct {
	rest
	*Server
}

// handler is the HTTP handler of the generated strict server of the tag Fleet over the reservations, behind a
// gateway that admits every request of ctx (the tenant context of the actor).
func (e env) handler(t *testing.T, tc tenantctx.TenantContext) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	fleetapi.HandlerWithOptions(fleetapi.NewStrictHandlerWithOptions(onlyReservations{Server: e.srv}, nil, fleetapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, req *http.Request, err error) {
			problem.Write(w, req, problem.Wrap(problem.CodeMalformedRequest, err))
		},
		ResponseErrorHandlerFunc: problem.Write,
	}), fleetapi.ChiServerOptions{BaseRouter: r})
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.ServeHTTP(w, req.WithContext(tenantctx.WithTenant(req.Context(), tc)))
	})
}

// AC-03: 100 parallel reservations of one vehicle for one window (each with its own driver) → exactly one 201 and
// 99 × 409 reservation_overlap, on a tenant pool of 4 connections (tenantctx.DefaultMaxConns, as cmd/api), without a
// deadlock and with one live hold of the vehicle in the database.
func TestAC03ParallelReservations(t *testing.T) {
	t.Parallel()
	const n = 100
	e := newEnv(t)
	ctx := e.as(t, "a.owner")
	tc, _ := tenantctx.FromContext(ctx)
	h := e.handler(t, tc)
	v := e.vehicle(t)
	drivers := make([]uuid.UUID, n)
	for i := range drivers {
		drivers[i] = e.driver(t)
	}
	path := "/api/v1/tenants/" + tc.TenantID.String() + "/fleet/reservations"

	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		statuses = map[int]int{}
		codes    = map[string]int{}
		start    = make(chan struct{})
	)
	began := time.Now()
	for i := range n {
		payload, err := json.Marshal(body(v, drivers[i], day(20, 6), day(20, 10)))
		require.NoError(t, err)
		wg.Go(func() {
			<-start
			req := httptest.NewRequestWithContext(ctx, http.MethodPost, path, bytes.NewReader(payload))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", "ac03-"+strconv.Itoa(i)+"-"+uuid.NewString())
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			var p struct {
				Code string `json:"code"`
			}
			if rec.Code >= http.StatusBadRequest && rec.Header().Get("Content-Type") == problem.ContentType {
				_ = json.Unmarshal(rec.Body.Bytes(), &p)
			}
			code := p.Code
			mu.Lock()
			defer mu.Unlock()
			statuses[rec.Code]++
			codes[code]++
		})
	}
	close(start)
	wg.Wait()
	elapsed := time.Since(began)
	t.Logf("AC-03: %d requests in %s: statuses %v, codes %v", n, elapsed, statuses, codes)
	require.Equal(t, map[int]int{http.StatusCreated: 1, http.StatusConflict: n - 1}, statuses)
	require.Equal(t, n-1, codes[codeOverlap])
	require.Less(t, elapsed, time.Minute)
	require.Equal(t, 1, e.count(t, `select count(*) from sched.reservations r join sched.resources s on s.id = r.resource_id
		where s.kind = 'vehicle' and s.ref_id = $1 and r.state = 'hold'`, v))
	require.Equal(t, 1, e.count(t, `select count(distinct r.bundle_id) from sched.reservations r
		join sched.resources s on s.id = r.resource_id where s.kind = 'person' and s.ref_id = any($1)`, drivers),
		"the drivers of the refused reservations hold nothing")
}
