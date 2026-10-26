package problem

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

func write(t *testing.T, err error, rid string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil)
	req.Header.Set(requestid.Header, rid)
	rec := httptest.NewRecorder()
	requestid.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		Write(w, r, err)
	})).ServeHTTP(rec, req)
	return rec
}

// K-08 (WS-40): problem+json, type = https://docs.ortus.example/errors/<code>, title из errors.yaml,
// requestId = заголовку, полей вне схемы Problem нет, тело завершается '\n' (байт-в-байт для K-09).
func TestWriteBody(t *testing.T) {
	t.Parallel()
	rec := write(t, New(CodeNotFound, ""), "rid-1")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q", ct)
	}
	want := `{"type":"https://docs.ortus.example/errors/not_found","title":"Нет объекта или он вне области",` +
		`"status":404,"code":"not_found","requestId":"rid-1"}` + "\n"
	if got := rec.Body.String(); got != want {
		t.Fatalf("body =\n%s\nwant\n%s", got, want)
	}
}

func TestWriteDetailAndWrapped(t *testing.T) {
	t.Parallel()
	err := fmt.Errorf("load: %w", New(CodeSessionExpired, "Сессия истекла. Войдите снова."))
	rec := write(t, err, "rid-2")
	var body map[string]any
	if e := json.Unmarshal(rec.Body.Bytes(), &body); e != nil {
		t.Fatal(e)
	}
	if rec.Code != http.StatusUnauthorized || body["code"] != "session_expired" ||
		body["detail"] != "Сессия истекла. Войдите снова." {
		t.Fatalf("status %d body %v", rec.Code, body)
	}
}

// Непредвиденная ошибка не раскрывает текст (12: «нет SQL и внутренностей в ошибках»). Кода 500 в реестре
// нет — до решения стюарда 503 dependency_unavailable с detail «Внутренняя ошибка» (бриф W0.09 §10 п.3).
func TestUnexpectedErrors(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		err  error
	}{
		{"обычная ошибка", errors.New("boom: pq secret")},
		{"истёк дедлайн", fmt.Errorf("query: %w", context.DeadlineExceeded)},
		{"неизвестный код — ошибка программиста", New("no_such_code", "")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := write(t, tc.err, "rid-3")
			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503", rec.Code)
			}
			if !strings.Contains(rec.Body.String(), `"code":"dependency_unavailable"`) ||
				strings.Contains(rec.Body.String(), "secret") || strings.Contains(rec.Body.String(), "no_such_code") {
				t.Fatalf("body = %s", rec.Body.String())
			}
		})
	}
}

// Ревью W0.09: Write передаёт ошибку ответа 5xx (с причиной) наблюдателю из контекста — для логов; 4xx — нет.
func TestWriteReportsServerErrors(t *testing.T) {
	t.Parallel()
	cause := errors.New("tenant DB: connection refused")
	for _, tc := range []struct {
		err    error
		report bool
	}{
		{Wrap(CodeDependencyUnavailable, cause), true},
		{cause, true},
		{New(CodeNotImplemented, ""), true},
		{New(CodeNotFound, ""), false},
	} {
		var got error
		req := httptest.NewRequestWithContext(WithReporter(t.Context(), func(err error) { got = err }), http.MethodGet, "/x", nil)
		Write(httptest.NewRecorder(), req, tc.err)
		if (got != nil) != tc.report || (got != nil && !errors.Is(got, tc.err)) {
			t.Errorf("%v: reported %v, want report=%v", tc.err, got, tc.report)
		}
	}
	// Без наблюдателя Write работает как прежде.
	if rec := write(t, Wrap(CodeDependencyUnavailable, cause), "rid-r"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
}

// Каждый код реестра (api/errors.yaml → catalog.Problems) отдаётся со своим статусом и title.
func TestEveryCatalogCode(t *testing.T) {
	t.Parallel()
	if len(catalog.Problems) != 66 { // 52 of W0.07, offer_closed of W2.71 (contract 0.6.3-stage2), 5 cash codes of W5.00 (0.12.0-stage5) and 8 of W7.00 (0.12.0-stage7)
		t.Fatalf("catalog has %d codes, want 66", len(catalog.Problems))
	}
	for code, p := range catalog.Problems {
		b := From(t.Context(), New(code, ""))
		if b.Code != code || b.Status != p.Status || b.Title != p.Title || b.Type != TypeBase+code {
			t.Errorf("%s → %+v, want status %d title %q", code, b, p.Status, p.Title)
		}
	}
}

func TestErrorIsAndText(t *testing.T) {
	t.Parallel()
	err := fmt.Errorf("x: %w", New(CodeForbiddenAction, "нет права"))
	if !Is(err, CodeForbiddenAction) || Is(err, CodeNotFound) {
		t.Fatal("Is: wrong match")
	}
	cause := errors.New("pool closed")
	w := Wrap(CodeDependencyUnavailable, cause)
	if !errors.Is(w, cause) {
		t.Fatal("Wrap must keep the cause for errors.Is")
	}
	if w.Error() == "" {
		t.Fatal("empty Error()")
	}
}
