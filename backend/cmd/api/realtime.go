package main

// W1.42: the realtime channel of ADR-0015 (platform/notify/realtime, W1.07) in cmd/api — the permission cache over
// policy_version, the hub, the WebSocket gateway GET /api/v1/realtime, the tickets of createRealtimeTicket and the
// LISTEN of the hints the worker publishes; context.changed after the operator commands that change the state of a
// tenant (Q-W1.48-12).

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	authapi "github.com/ortus/ortus-crm/backend/internal/api/auth"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants/operators"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc/authhttp"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// realtimeTickets issues the tickets of createRealtimeTicket (authhttp.RealtimeTickets): a single-use ticket of the
// account and the session of the request, with the heartbeat of the gateway that redeems it (Q-W1.07-14).
type realtimeTickets struct {
	tickets   realtime.Tickets
	heartbeat time.Duration // 0: realtime.DefaultHeartbeat, as the gateway
}

var _ authhttp.RealtimeTickets = realtimeTickets{}

// Issue implements authhttp.RealtimeTickets.
func (t realtimeTickets) Issue(ctx context.Context, sess session.Session) (authapi.RealtimeTicket, error) {
	tk, err := t.tickets.Issue(ctx, realtime.Principal{AccountID: sess.AccountID, SessionID: sess.ID})
	if err != nil {
		return authapi.RealtimeTicket{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return realtime.TicketResponse(tk, t.heartbeat), nil
}

// channel is the realtime channel of one cmd/api process (Q-W1.07-11).
type channel struct {
	cache    *realtime.PolicyCache // the authz.Source of the evaluator
	hub      *realtime.Hub
	gateway  *realtime.Gateway
	sockets  *sockets // the gateway as mounted: it counts the live sockets for stop
	tickets  realtimeTickets
	listener *realtime.Listener
	relay    realtime.Relay // hints of cmd/api itself (operator commands)
}

// handler is GET /api/v1/realtime.
func (c channel) handler() http.Handler { return c.sockets }

// stop closes every socket with 1001 («going away») and waits until their handlers return or ctx ends:
// http.Server.Shutdown does not track hijacked connections, and the process exits right after it (ADR-0015).
func (c channel) stop(ctx context.Context) {
	c.hub.Close()
	c.sockets.wait(ctx)
}

// sockets counts the requests of a handler in flight — for the gateway, the live sockets.
type sockets struct {
	http.Handler

	mu   sync.Mutex
	live int
	idle chan struct{} // closed when live drops to 0; nil while nobody waits
}

// ServeHTTP implements http.Handler.
func (s *sockets) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.live++
	s.mu.Unlock()
	defer s.done()
	s.Handler.ServeHTTP(w, r)
}

func (s *sockets) done() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.live--
	if s.live == 0 && s.idle != nil {
		close(s.idle)
		s.idle = nil
	}
}

// wait returns once no request is in flight, or when ctx ends.
func (s *sockets) wait(ctx context.Context) {
	s.mu.Lock()
	if s.live == 0 {
		s.mu.Unlock()
		return
	}
	if s.idle == nil {
		s.idle = make(chan struct{})
	}
	idle := s.idle
	s.mu.Unlock()
	select {
	case <-idle:
	case <-ctx.Done():
	}
}

// newChannel builds the channel over the tenant pools and the control DB. sessions must be the store of the BFF
// sessions (the one of session.Manager): the gateway checks the session of a ticket there. The tickets live in the
// memory of the process (Q-W1.07-9); the clocks are the system ones — sessions expire by them, never by
// APP_FIXED_NOW (Q-W1.07-4).
func newChannel(pools *tenantctx.Pools, control *pgxpool.Pool, sessions realtime.SessionStore, cfg config, log *slog.Logger) channel {
	cache := &realtime.PolicyCache{Inner: authz.PGSource{Pools: pools}, Versions: realtime.PGVersions{Pools: pools}}
	hub := realtime.NewHub(realtime.HubOptions{})
	tickets := realtime.NewMemTickets(nil)
	gw := &realtime.Gateway{Hub: hub, Tickets: tickets, Sessions: sessions, AllowedOrigins: cfg.AllowedOrigins, Log: log}
	sink, resync := realtime.Fanout(hub, cache)
	return channel{
		cache: cache, hub: hub, gateway: gw, sockets: &sockets{Handler: gw},
		tickets:  realtimeTickets{tickets: tickets, heartbeat: gw.Heartbeat},
		listener: &realtime.Listener{Dial: realtime.PoolDialer(control), Sink: sink, Resync: resync, Log: log},
		relay:    realtime.Relay{Control: control, Notifier: realtime.Notifier{DB: control}, Log: log},
	}
}

// listen runs the LISTEN of the hints until ctx ends (a background job of run).
func (c channel) listen(ctx context.Context) { _ = c.listener.Run(ctx) }

// tenantChanged tells every active member of tenantID that its context changed.
func (c channel) tenantChanged(ctx context.Context, tenantID uuid.UUID) error {
	return c.relay.HintPersons(ctx, tenantID, nil, realtime.TypeContextChanged)
}

// hintTimeout bounds the hint after an operator command: it runs in the HTTP request after the commit, and a stalled
// control DB must not hold the answer of a committed command.
const hintTimeout = 2 * time.Second

// hintingCommands are the operator commands with context.changed for the members of the tenant they change
// (suspension, resumption, trial extension, renaming: the state and the name of the tenant in /me/context). The hint
// follows the commit and is best effort: it is bounded by hintTimeout, its failure is logged and never fails the
// command.
type hintingCommands struct {
	operators.Commands
	hint func(ctx context.Context, tenantID uuid.UUID) error
	log  *slog.Logger
}

// Suspend implements operators.Commands.
func (c hintingCommands) Suspend(ctx context.Context, sc operators.StatusChange) (tenants.Tenant, error) {
	tn, err := c.Commands.Suspend(ctx, sc)
	if err == nil {
		c.changed(ctx, sc.TenantID)
	}
	return tn, err
}

// Resume implements operators.Commands.
func (c hintingCommands) Resume(ctx context.Context, sc operators.StatusChange) (tenants.Tenant, error) {
	tn, err := c.Commands.Resume(ctx, sc)
	if err == nil {
		c.changed(ctx, sc.TenantID)
	}
	return tn, err
}

// ExtendTrial implements operators.Commands.
func (c hintingCommands) ExtendTrial(ctx context.Context, te operators.TrialExtension) (subscriptions.Subscription, error) {
	sub, err := c.Commands.ExtendTrial(ctx, te)
	if err == nil {
		c.changed(ctx, te.TenantID)
	}
	return sub, err
}

// Rename implements operators.Commands.
func (c hintingCommands) Rename(ctx context.Context, rn operators.Rename) (tenants.Tenant, error) {
	tn, err := c.Commands.Rename(ctx, rn)
	if err == nil {
		c.changed(ctx, rn.TenantID)
	}
	return tn, err
}

// changed hints after the commit: the request may already be cancelled (the client went away), the hint is not.
func (c hintingCommands) changed(ctx context.Context, tenantID uuid.UUID) {
	hctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), hintTimeout)
	defer cancel()
	if err := c.hint(hctx, tenantID); err != nil {
		c.log.WarnContext(ctx, "realtime: context.changed after an operator command", slog.String("tenant_id", tenantID.String()),
			slog.String("error", err.Error()))
	}
}

// together runs the jobs that are not nil side by side until ctx ends; nil when there is none.
func together(jobs ...func(context.Context)) func(context.Context) {
	var live []func(context.Context)
	for _, j := range jobs {
		if j != nil {
			live = append(live, j)
		}
	}
	if len(live) == 0 {
		return nil
	}
	return func(ctx context.Context) {
		var wg sync.WaitGroup
		for _, j := range live {
			wg.Go(func() { j(ctx) })
		}
		wg.Wait()
	}
}
