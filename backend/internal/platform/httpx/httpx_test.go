package httpx

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

func newReq(t *testing.T, method, target, body string) *http.Request {
	t.Helper()
	return httptest.NewRequestWithContext(t.Context(), method, target, strings.NewReader(body))
}

// K-07 (WS-40, 10 §12 п.17): Cache-Control: private, no-store и nosniff — на каждом ответе, в том числе на ошибке.
func TestSecurityHeaders(t *testing.T) {
	t.Parallel()
	for _, status := range []int{http.StatusOK, http.StatusNotFound, http.StatusNotImplemented} {
		rec := httptest.NewRecorder()
		SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
		})).ServeHTTP(rec, newReq(t, http.MethodGet, "/", ""))
		if rec.Header().Get("Cache-Control") != "private, no-store" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%d: headers %v", status, rec.Header())
		}
	}
}

// K-38 (WS-40): паника хендлера → problem+json с requestId; лог содержит panic и stack, но не тело запроса.
func TestRecover(t *testing.T) {
	t.Parallel()
	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	h := requestid.Middleware(Recover(log)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})))
	rec := httptest.NewRecorder()
	req := newReq(t, http.MethodPost, "/x", `{"password":"s3cr3t"}`)
	req.Header.Set(requestid.Header, "rid-panic")
	h.ServeHTTP(rec, req)

	var body problem.Body
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	if rec.Code != http.StatusServiceUnavailable || body.RequestID != "rid-panic" || body.Code != problem.CodeDependencyUnavailable {
		t.Fatalf("status %d body %+v", rec.Code, body)
	}
	out := logs.String()
	if !strings.Contains(out, `"msg":"panic"`) || !strings.Contains(out, "stack") || !strings.Contains(out, "rid-panic") {
		t.Fatalf("log = %s", out)
	}
	if strings.Contains(out, "s3cr3t") {
		t.Fatalf("log leaks the request body: %s", out)
	}
}

// K-33 (WS-40; 14-engineering.md:114): у записи есть request_id, атрибуты AddAttrs (tenant_id, actor_id);
// значений cookie, CSRF-токена, Authorization и тела запроса в логе нет.
func TestLogging(t *testing.T) {
	t.Parallel()
	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	h := requestid.Middleware(Logging(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		AddAttrs(r.Context(), slog.String("tenant_id", "t-1"), slog.String("actor_id", "a-1"))
		w.WriteHeader(http.StatusTeapot)
	})))
	req := newReq(t, http.MethodPost, "/api/v1/x?q=1", `{"secret":"body-value"}`)
	req.Header.Set(requestid.Header, "rid-log")
	req.Header.Set("Cookie", "ortus_sid=cookie-value; ortus_csrf=csrf-value")
	req.Header.Set("X-CSRF-Token", "csrf-value")
	req.Header.Set("Authorization", "Bearer token-value")
	h.ServeHTTP(httptest.NewRecorder(), req)

	var rec map[string]any
	if err := json.Unmarshal(logs.Bytes(), &rec); err != nil {
		t.Fatalf("log %q: %v", logs.String(), err)
	}
	for k, want := range map[string]any{
		"request_id": "rid-log", "method": "POST", "path": "/api/v1/x", "status": float64(http.StatusTeapot),
		"tenant_id": "t-1", "actor_id": "a-1",
	} {
		if rec[k] != want {
			t.Errorf("%s = %v, want %v", k, rec[k], want)
		}
	}
	for _, leak := range []string{"cookie-value", "csrf-value", "token-value", "body-value"} {
		if strings.Contains(logs.String(), leak) {
			t.Errorf("log leaks %q: %s", leak, logs.String())
		}
	}
}

// Ревью W0.09: у ответа 5xx причина ошибки (cause у problem.Wrap, неизвестная ошибка) попадает в запись
// access-лога уровня ERROR полем error; клиенту текст причины не уходит. У 4xx поля error нет.
func TestLoggingServerErrorCause(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		err   error
		level string
		cause string
	}{
		{"wrap", problem.Wrap(problem.CodeDependencyUnavailable, errors.New("tenant t-1: open pool: connection refused")),
			"ERROR", "connection refused"},
		{"unknown", errors.New("sentinel mismatch"), "ERROR", "sentinel mismatch"},
		{"4xx", problem.New(problem.CodeForbiddenAction, ""), "INFO", ""},
		{"501 — операция ждёт владельца, не сбой", problem.New(problem.CodeNotImplemented, ""), "INFO", "not_implemented"},
	}
	for _, tc := range cases {
		var logs bytes.Buffer
		log := slog.New(slog.NewJSONHandler(&logs, nil))
		h := requestid.Middleware(Logging(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			problem.Write(w, r, tc.err)
		})))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, newReq(t, http.MethodGet, "/api/v1/me/context", ""))

		var entry map[string]any
		if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
			t.Fatalf("%s: log %q: %v", tc.name, logs.String(), err)
		}
		got, _ := entry["error"].(string)
		if entry["level"] != tc.level || (tc.cause == "") != (got == "") || !strings.Contains(got, tc.cause) {
			t.Errorf("%s: level %v error %q, want %s %q", tc.name, entry["level"], got, tc.level, tc.cause)
		}
		// The 501 "cause" is its own code, which the body carries by design; real causes must never leak.
		if tc.level == "ERROR" && strings.Contains(rec.Body.String(), tc.cause) {
			t.Errorf("%s: response leaks the cause: %s", tc.name, rec.Body)
		}
	}
}

// DTO (10 §9 п.7; 12:30–31): лишнее поле → unknown_field, неразбираемое или пустое тело → malformed_request.
func TestDecodeStrict(t *testing.T) {
	t.Parallel()
	type dto struct {
		Persona string `json:"persona"`
	}
	cases := []struct {
		name, body, code string
	}{
		{"ok", `{"persona":"owner"}`, ""},
		{"лишнее поле", `{"persona":"owner","extra":1}`, problem.CodeUnknownField},
		{"битый JSON", `{`, problem.CodeMalformedRequest},
		{"пустое тело", ``, problem.CodeMalformedRequest},
		{"данные после объекта", `{"persona":"a"} {}`, problem.CodeMalformedRequest},
		{"не тот тип", `{"persona":1}`, problem.CodeMalformedRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var d dto
			err := DecodeStrict(newReq(t, http.MethodPost, "/", tc.body), &d)
			if tc.code == "" {
				if err != nil || d.Persona != "owner" {
					t.Fatalf("err %v, dto %+v", err, d)
				}
				return
			}
			if !problem.Is(err, tc.code) {
				t.Fatalf("err = %v, want %s", err, tc.code)
			}
		})
	}
}

func TestJSON(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	JSON(rec, http.StatusCreated, map[string]string{"a": "б"})
	if rec.Code != http.StatusCreated || rec.Header().Get("Content-Type") != "application/json" || rec.Body.String() != `{"a":"б"}`+"\n" {
		t.Fatalf("status %d headers %v body %q", rec.Code, rec.Header(), rec.Body.String())
	}
}
