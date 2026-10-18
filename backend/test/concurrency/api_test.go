//go:build concurrency

// Target of the suite: the binary of cmd/api built from this tree and started on a free loopback port against the
// fixtures (control DB and tenant DBs as ortus_api), as the isolation suite runs it (W0.09, W1.04). An actor signs in
// through the dev provider of the BFF and every request carries its session cookie, Origin and X-CSRF-Token; commands
// carry an Idempotency-Key and, when given, an If-Match.

package concurrency

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	harness "github.com/ortus/ortus-crm/backend/test"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// targetOrigin is the only allowed Origin of the API under test (CSRF of cookie mutations).
const targetOrigin = "http://concurrency.test"

// target is the running API: its base URL, one HTTP client for every actor and the signed-in sessions.
type target struct {
	base     string
	client   *http.Client
	mu       sync.Mutex
	sessions map[string][]*http.Cookie
}

// startTarget builds cmd/api, starts it with the environment of the world on the clock of the suite
// (APP_FIXED_NOW = harness.Now: the evaluator checks grant periods of the fixtures against it) and waits for /healthz.
func startTarget(ctx context.Context, w *fixtures.World) (*target, func(), error) {
	dir, err := os.MkdirTemp("", "ortus-concurrency-api-")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { _ = os.RemoveAll(dir) }
	bin := filepath.Join(dir, "api")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	build := exec.CommandContext(ctx, "go", "build", "-o", bin, "./cmd/api") //nolint:gosec // G204: fixed command, temp output path
	build.Dir = filepath.Join("..", "..")                                    // backend/
	if out, err := build.CombinedOutput(); err != nil {
		cleanup()
		return nil, nil, fmt.Errorf("build cmd/api: %w\n%s", err, out)
	}
	addr, err := freeAddr(ctx)
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	env := w.Env()
	cmd := exec.CommandContext(ctx, bin) //nolint:gosec // G204: the binary the suite has just built
	cmd.Env = append(os.Environ(),
		"APP_ENV=e2e",
		"AUTH_PROVIDER=dev",
		"HTTP_ADDR="+addr,
		"CONTROL_DB_URL="+env["CONTROL_DB_URL"],
		"TENANT_DB_URL="+env["TENANT_DB_URL"],
		"TENANT_DB_HOST="+env["TENANT_DB_HOST"],
		"ALLOWED_ORIGINS="+targetOrigin,
		"LOG_LEVEL=warn",
		"SMTP_HOST=",
		"APP_FIXED_NOW="+harness.Now().Format(time.RFC3339Nano),
		// An object storage that is never reached: photos and receipts are ready rows of files.objects.
		"S3_ENDPOINT=http://127.0.0.1:9", "S3_PUBLIC_ENDPOINT=http://127.0.0.1:9", "S3_REGION=us-east-1",
		"S3_BUCKET=ortus-concurrency", "S3_ACCESS_KEY=concurrency", "S3_SECRET_KEY=concurrency",
	)
	var logs syncBuffer
	cmd.Stdout, cmd.Stderr = &logs, &logs
	if err := cmd.Start(); err != nil {
		cleanup()
		return nil, nil, fmt.Errorf("start cmd/api: %w", err)
	}
	stop := func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		if s := logs.String(); s != "" && os.Getenv("CONCURRENCY_API_LOGS") != "" {
			fmt.Fprintln(os.Stderr, "cmd/api:\n"+s)
		}
		cleanup()
	}
	t := &target{
		base: "http://" + addr,
		client: &http.Client{Timeout: 90 * time.Second, Transport: &http.Transport{
			MaxIdleConns: 256, MaxIdleConnsPerHost: 256, IdleConnTimeout: time.Minute,
		}},
		sessions: map[string][]*http.Cookie{},
	}
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, t.base+"/healthz", nil)
		if resp, err := t.client.Do(req); err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return t, stop, nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	stop()
	return nil, nil, fmt.Errorf("cmd/api did not answer /healthz on %s:\n%s", addr, logs.String())
}

func freeAddr(ctx context.Context) (string, error) {
	var lc net.ListenConfig
	l, err := lc.Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	defer l.Close()
	return l.Addr().String(), nil
}

// syncBuffer is the log of the API process, written by its stdout and stderr copiers at once.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// session signs actor in once (dev provider, the subject of its fixture identity) and returns its cookies.
func (a *target) session(ctx context.Context, actor string) ([]*http.Cookie, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if c, ok := a.sessions[actor]; ok {
		return c, nil
	}
	who, err := world.Actor(actor)
	if err != nil {
		return nil, err
	}
	body, _ := json.Marshal(map[string]string{"persona": who.Subject})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.base+"/api/v1/dev/login", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", targetOrigin)
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dev login %s: %w", actor, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("dev login " + actor + ": " + resp.Status)
	}
	a.sessions[actor] = resp.Cookies()
	return resp.Cookies(), nil
}

// reply is an answer of the API: the status, the headers, the raw body and the body as a JSON object.
type reply struct {
	Status int
	Header http.Header
	Raw    []byte
	Body   map[string]any
}

// Code is the Problem.code of an error answer ("" for a success).
func (r reply) Code() string {
	c, _ := r.Body["code"].(string)
	return c
}

// ETag is the ETag header of the answer.
func (r reply) ETag() string { return r.Header.Get("ETag") }

// String is the answer for a failure message.
func (r reply) String() string {
	return fmt.Sprintf("%d %s", r.Status, strings.TrimSpace(string(r.Raw)))
}

// req is one request of an actor.
type req struct {
	Actor   string
	Method  string
	Path    string // /api/v1/…
	Body    any    // marshalled as JSON when not nil
	IfMatch string
	Key     string // Idempotency-Key of a command; a new one when empty
}

// do sends r and returns the answer; a transport failure is an error (the caller decides how to fail).
func (a *target) do(ctx context.Context, r req) (reply, error) {
	cookies, err := a.session(ctx, r.Actor)
	if err != nil {
		return reply{}, err
	}
	var raw []byte
	if r.Body != nil {
		if raw, err = json.Marshal(r.Body); err != nil {
			return reply{}, err
		}
	}
	hr, err := http.NewRequestWithContext(ctx, r.Method, a.base+r.Path, bytes.NewReader(raw))
	if err != nil {
		return reply{}, err
	}
	sign(hr, cookies, r, raw != nil)
	resp, err := a.client.Do(hr)
	if err != nil {
		return reply{}, fmt.Errorf("%s %s as %s: %w", r.Method, r.Path, r.Actor, err)
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	if err != nil {
		return reply{}, err
	}
	rep := reply{Status: resp.StatusCode, Header: resp.Header, Raw: out}
	_ = json.Unmarshal(out, &rep.Body)
	return rep, nil
}

// sign puts the session of the actor on hr (cookies, X-CSRF-Token, Origin) and the headers of the request r: the
// content type of a body, a new Idempotency-Key of a command unless r carries one, the If-Match of r.
func sign(hr *http.Request, cookies []*http.Cookie, r req, body bool) {
	for _, c := range cookies {
		hr.AddCookie(c)
		if c.Name == "ortus_csrf" {
			hr.Header.Set("X-CSRF-Token", c.Value)
		}
	}
	hr.Header.Set("Origin", targetOrigin)
	if body {
		hr.Header.Set("Content-Type", "application/json")
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		key := r.Key
		if key == "" {
			key = "w230-" + uuid.NewString()
		}
		hr.Header.Set("Idempotency-Key", key)
	}
	if r.IfMatch != "" {
		hr.Header.Set("If-Match", r.IfMatch)
	}
}

// call sends r and fails the test on a transport failure.
func call(t *testing.T, r req) reply {
	t.Helper()
	rep, err := api.do(t.Context(), r)
	if err != nil {
		t.Fatal(err)
	}
	return rep
}

// pages reads every page of the list r (limit 200, then nextCursor) and returns the answers; it stops at the first
// answer that is not 200. The objects of the suite pile up in tenant A, so a check of a list never trusts one page.
func pages(t *testing.T, r req) []reply {
	t.Helper()
	sep := "?"
	if strings.Contains(r.Path, "?") {
		sep = "&"
	}
	first := r.Path + sep + "limit=200"
	r.Path = first
	var out []reply
	for range 50 {
		rep := call(t, r)
		out = append(out, rep)
		next, _ := rep.Body["nextCursor"].(string)
		if rep.Status != http.StatusOK || next == "" {
			return out
		}
		r.Path = first + "&cursor=" + url.QueryEscape(next)
	}
	t.Fatalf("list %s: more than 50 pages", first)
	return out
}

// want sends r and fails the test unless the status is status.
func want(t *testing.T, status int, r req) reply {
	t.Helper()
	rep := call(t, r)
	if rep.Status != status {
		t.Fatalf("%s %s as %s: %s, want %d", r.Method, r.Path, r.Actor, rep, status)
	}
	return rep
}

// race sends every request at once (after all goroutines are ready) and returns the answers in the order of rs.
func race(t *testing.T, rs ...req) []reply {
	t.Helper()
	out := make([]reply, len(rs))
	errs := make([]error, len(rs))
	for _, r := range rs { // sign every actor in before the start: the race is about the command, not the login
		if _, err := api.session(t.Context(), r.Actor); err != nil {
			t.Fatal(err)
		}
	}
	var (
		wg    sync.WaitGroup
		ready sync.WaitGroup
		start = make(chan struct{})
	)
	ready.Add(len(rs))
	for i, r := range rs {
		wg.Go(func() {
			ready.Done()
			<-start
			out[i], errs[i] = api.do(t.Context(), r)
		})
	}
	ready.Wait()
	close(start)
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		t.Fatal(err)
	}
	return out
}

// tally counts the answers by «status code» (code only for errors), e.g. {"201": 1, "409 reservation_overlap": 99}.
func tally(rs []reply) map[string]int {
	m := map[string]int{}
	for _, r := range rs {
		k := strconv.Itoa(r.Status)
		if c := r.Code(); c != "" && r.Status >= http.StatusBadRequest {
			k += " " + c
		}
		m[k]++
	}
	return m
}
