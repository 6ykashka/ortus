// Package httpx holds the HTTP building blocks of cmd/api (W0.09): security headers, panic recovery, request
// logging (slog JSON without secrets), strict JSON decoding and JSON responses.
package httpx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// MaxBody limits request bodies read by DecodeStrict.
const MaxBody = 1 << 20

// SecurityHeaders sets the headers every response carries: authenticated API responses are never cached in shared
// caches (contract: Cache-Control: private, no-store) and are not content-sniffed.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cache-Control", "private, no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// Recover turns a panic of the handler into a Problem response and logs it with the stack. The request body is
// never logged.
func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if v == http.ErrAbortHandler { //nolint:errorlint // sentinel panic value of net/http, compared as documented
					panic(v)
				}
				log.ErrorContext(r.Context(), "panic",
					slog.String("request_id", requestid.FromContext(r.Context())),
					slog.Any("value", v),
					slog.String("stack", string(debug.Stack())))
				problem.Write(w, r, errors.New("panic"))
			}()
			next.ServeHTTP(w, r)
		})
	}
}

type attrsKey struct{}

type attrs struct {
	mu    sync.Mutex
	a     []slog.Attr
	cause string // error behind a 5xx Problem response (problem.WithReporter)
}

// AddAttrs adds attributes (tenant_id, actor_id…) to the access-log record of the current request.
func AddAttrs(ctx context.Context, a ...slog.Attr) {
	if h, ok := ctx.Value(attrsKey{}).(*attrs); ok {
		h.mu.Lock()
		h.a = append(h.a, a...)
		h.mu.Unlock()
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// Logging writes one slog record per request: request_id, method, path (without the query), status, duration and
// the attributes added by AddAttrs. A Problem response with status ≥ 500 adds the text of its cause as error and
// raises the record to ERROR. Headers, cookies and bodies are never logged.
func Logging(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			extra := &attrs{}
			sw := &statusWriter{ResponseWriter: w}
			ctx := context.WithValue(r.Context(), attrsKey{}, extra)
			ctx = problem.WithReporter(ctx, func(err error) {
				extra.mu.Lock()
				extra.cause = err.Error()
				extra.mu.Unlock()
			})
			next.ServeHTTP(sw, r.WithContext(ctx))
			if sw.status == 0 {
				sw.status = http.StatusOK
			}
			base := []slog.Attr{
				slog.String("request_id", requestid.FromContext(r.Context())),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", sw.status),
				slog.Int64("duration_ms", time.Since(start).Milliseconds()),
			}
			level := slog.LevelInfo
			extra.mu.Lock()
			base = append(base, extra.a...)
			if extra.cause != "" {
				base = append(base, slog.String("error", extra.cause))
			}
			extra.mu.Unlock()
			// 501 marks a contract operation whose owner has not landed yet: expected, not a failure.
			if sw.status >= http.StatusInternalServerError && sw.status != http.StatusNotImplemented {
				level = slog.LevelError
			}
			log.LogAttrs(r.Context(), level, "http request", base...)
		})
	}
}

// DecodeStrict decodes one JSON object of r's body into dst. Unknown fields → unknown_field; empty, malformed,
// mistyped or trailing data → malformed_request.
func DecodeStrict(r *http.Request, dst any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxBody))
	if err != nil {
		return problem.Wrap(problem.CodeMalformedRequest, err)
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if strings.HasPrefix(err.Error(), "json: unknown field ") {
			return problem.Wrap(problem.CodeUnknownField, err)
		}
		return problem.Wrap(problem.CodeMalformedRequest, err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return problem.New(problem.CodeMalformedRequest, "")
	}
	return nil
}

// JSON writes v as application/json with status.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v) // the client is gone if the write fails
}
