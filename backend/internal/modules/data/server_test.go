package data

import (
	"net/http"
	"net/http/httptest"
	"testing"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// A field error is the 422 of the example queryDataset/validation_failed: Problem with its violation.
func TestValidationResponse(t *testing.T) {
	t.Parallel()
	var resp dataapi.QueryDataset422ApplicationProblemPlusJSONResponse
	w := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", http.NoBody)
	r.Header.Set(requestid.Header, "01J9Z4QK8M6T2V5X7Y9A1B3C5D")
	requestid.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp = validation(r.Context(), &fieldError{Detail: "Поле недоступно: plate.", Field: "select[0]", Code: "unknown_field", Message: "Поле недоступно"})
		if err := resp.VisitQueryDatasetResponse(w); err != nil {
			t.Error(err)
		}
	})).ServeHTTP(w, r)
	if w.Code != http.StatusUnprocessableEntity || w.Header().Get("Content-Type") != "application/problem+json" ||
		w.Header().Get("X-Request-Id") != "01J9Z4QK8M6T2V5X7Y9A1B3C5D" {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
	sameJSON(t, resp.Body, `{
		"type": "https://docs.ortus.example/errors/validation_failed",
		"title": "Ошибки полей",
		"status": 422,
		"code": "validation_failed",
		"detail": "Поле недоступно: plate.",
		"requestId": "01J9Z4QK8M6T2V5X7Y9A1B3C5D",
		"violations": [{"field": "select[0]", "code": "unknown_field", "message": "Поле недоступно"}]
	}`)
}
