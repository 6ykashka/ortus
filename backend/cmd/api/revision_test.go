package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants/platformhttp"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Q-W1.11-9 (W1.48): команда без If-Match — 428 revision_required по контракту (PreconditionRequired), а не 400
// привязки strict server; без Idempotency-Key и с If-Match не того вида ответ прежний — 400 malformed_request.
func TestMissingIfMatchIsRevisionRequired(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Platform: &platformhttp.Server{}}})
	tenant := "/api/v1/platform/tenants/" + uuid.NewString()
	cases := []struct {
		name, method, path, body string
		header                   map[string]string
		status                   int
		code                     string
	}{
		{"suspend без If-Match", http.MethodPost, tenant + "/suspend", `{"reason":"Неоплата счёта"}`,
			map[string]string{"Idempotency-Key": "key-0000000000000001"}, http.StatusPreconditionRequired, "revision_required"},
		{"rename без If-Match", http.MethodPatch, tenant, `{"name":"Альта"}`,
			map[string]string{"Idempotency-Key": "key-0000000000000001"}, http.StatusPreconditionRequired, "revision_required"},
		{"trial без If-Match", http.MethodPost, tenant + "/trial-extensions", `{"days":14,"reason":"Пилот продлён"}`,
			map[string]string{"Idempotency-Key": "key-0000000000000001"}, http.StatusPreconditionRequired, "revision_required"},
		{"без Idempotency-Key", http.MethodPost, tenant + "/suspend", `{"reason":"Неоплата счёта"}`,
			map[string]string{"If-Match": `"1"`}, http.StatusBadRequest, problem.CodeMalformedRequest},
		{"с If-Match", http.MethodPost, tenant + "/suspend", `{"reason":"Неоплата счёта"}`,
			map[string]string{"Idempotency-Key": "key-0000000000000001", "If-Match": `"1"`}, http.StatusNotImplemented, problem.CodeNotImplemented},
	}
	for _, c := range cases {
		req := httptest.NewRequestWithContext(t.Context(), c.method, c.path, strings.NewReader(c.body))
		req.Header.Set("Content-Type", "application/json")
		for k, v := range c.header {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.status || codeOf(rec) != c.code {
			t.Errorf("%s: %d %s", c.name, rec.Code, rec.Body)
		}
	}
}
