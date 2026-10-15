//go:build isolation

// Target of the isolation suite (W0.09, contract matrix.Factory of docs/plan/v2/ws/W0.15.md §4.4): the whole API,
// the binary of cmd/api built from this tree and started on a free loopback port against the fixtures (control DB
// and tenant DBs as ortus_api). Requests of the suite reach it through a reverse proxy; an actor signs in through
// the dev provider of the BFF (POST /api/v1/dev/login with the subject of its dev identity) and the request carries
// its session cookie, Origin and X-CSRF-Token.

package isolation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
	"github.com/ortus/ortus-crm/backend/test/isolation/matrix"
)

// targetOrigin is the only allowed Origin of the API under test (CSRF of cookie mutations).
const targetOrigin = "http://isolation.test"

var newTarget matrix.Factory = func(ctx context.Context, env matrix.Env) (matrix.Target, func(), error) {
	dir, err := os.MkdirTemp("", "ortus-isolation-api-")
	if err != nil {
		return matrix.Target{}, nil, err
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
		return matrix.Target{}, nil, fmt.Errorf("build cmd/api: %w\n%s", err, out)
	}
	addr, err := freeAddr(ctx)
	if err != nil {
		cleanup()
		return matrix.Target{}, nil, err
	}
	stop, err := startAPI(ctx, bin, addr, env)
	if err != nil {
		cleanup()
		return matrix.Target{}, nil, err
	}
	base := &url.URL{Scheme: "http", Host: addr}
	s := &sessions{base: base.String(), byActor: map[string]session{}}
	return matrix.Target{
			Handler:      httputil.NewSingleHostReverseProxy(base),
			Authenticate: s.authenticate,
		}, func() {
			stop()
			cleanup()
		}, nil
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

// startAPI runs cmd/api with the environment of the fixtures and waits for /healthz.
//
// env.Clock (harness.Now, 01.10.2026 10:30 MSK) goes to APP_FIXED_NOW (W1.04): the evaluator checks grant
// periods against the fixtures' «now», not against the wall clock or now() of the tenant DB.
func startAPI(ctx context.Context, bin, addr string, env matrix.Env) (func(), error) {
	getenv := env.Getenv
	cmd := exec.CommandContext(ctx, bin)
	cmd.Env = append(os.Environ(),
		"APP_ENV=e2e", // cmd/api knows dev | e2e | prod; the suite runs it like the e2e stand
		"AUTH_PROVIDER=dev",
		"HTTP_ADDR="+addr,
		"CONTROL_DB_URL="+getenv("CONTROL_DB_URL"),
		"TENANT_DB_URL="+getenv("TENANT_DB_URL"),
		"TENANT_DB_HOST="+getenv("TENANT_DB_HOST"),
		"ALLOWED_ORIGINS="+targetOrigin,
		"LOG_LEVEL=warn",
		// W1.43 (Q-W1.41-8, Q-W1.47-2): no SMTP whatever the environment of the run (a loaded env of the stand sets
		// SMTP_HOST): the letters are off (mail.Off), the row inviteMember → 201 does not depend on a mail server, and
		// the outcome of the command is stored with its effect (Q-W1.41-10). exec keeps the last value of a key.
		"SMTP_HOST=",
	)
	cmd.Env = append(cmd.Env, storageEnv...)
	if env.Clock != nil {
		cmd.Env = append(cmd.Env, "APP_FIXED_NOW="+env.Clock().Format(time.RFC3339Nano))
	}
	var logs bytes.Buffer
	cmd.Stdout, cmd.Stderr = &logs, &logs
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start cmd/api: %w", err)
	}
	stop := func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+addr+"/healthz", nil)
		if resp, err := http.DefaultClient.Do(req); err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return stop, nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	stop()
	return nil, fmt.Errorf("cmd/api did not answer /healthz on %s:\n%s", addr, logs.String())
}

// storageEnv is an object storage that is never reached (W1.44): getFileDownload only signs a URL locally
// (storage.S3.PresignGet), so the rows of files.yaml get 200 for a visible ready file instead of 503
// dependency_unavailable. Uploads stop at the gateway in the rows (files_gate.yaml) and never call it.
var storageEnv = []string{
	"S3_ENDPOINT=http://127.0.0.1:9", "S3_PUBLIC_ENDPOINT=http://127.0.0.1:9", "S3_REGION=us-east-1", "S3_BUCKET=ortus-isolation",
	"S3_ACCESS_KEY=isolation", "S3_SECRET_KEY=isolation",
}

type session struct{ cookies []*http.Cookie }

// sessions signs every actor in once (dev provider) and reuses its session.
type sessions struct {
	base    string
	mu      sync.Mutex
	byActor map[string]session
}

func (s *sessions) authenticate(r *http.Request, a fixtures.Actor) error {
	if a.Issuer != fixtures.IssuerDev {
		return fmt.Errorf("actor %s: issuer %s has no dev sign-in", a.Key, a.Issuer)
	}
	sess, err := s.get(r.Context(), a)
	if err != nil {
		return err
	}
	for _, c := range sess.cookies {
		r.AddCookie(c)
		if c.Name == "ortus_csrf" {
			r.Header.Set("X-CSRF-Token", c.Value)
		}
	}
	r.Header.Set("Origin", targetOrigin)
	// Every mutation of the contract requires Idempotency-Key (the strict server answers 400 without it, before
	// the handler); each request of a row is a new command (W1.03: selectTenant, acceptInvitation, logout).
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		r.Header.Set("Idempotency-Key", "isolation-"+uuid.NewString())
	}
	return nil
}

func (s *sessions) get(ctx context.Context, a fixtures.Actor) (session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sess, ok := s.byActor[a.Key]; ok {
		return sess, nil
	}
	body, _ := json.Marshal(map[string]string{"persona": a.Subject})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.base+"/api/v1/dev/login", bytes.NewReader(body))
	if err != nil {
		return session{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", targetOrigin)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return session{}, fmt.Errorf("dev login %s: %w", a.Key, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return session{}, errors.New("dev login " + a.Key + ": " + resp.Status)
	}
	sess := session{cookies: resp.Cookies()}
	s.byActor[a.Key] = sess
	return sess, nil
}
