package platformhttp

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// Операции оператора второго контрактного PR этапа 1 (W1.00, 0.4.0-stage1) — у W1.11: до его шага тег Platform
// собирается и отвечает 501 not_implemented, как другие чужие операции тега.
func TestStage1bOperatorCommandsNotImplemented(t *testing.T) {
	t.Parallel()
	id := uuid.NewString()
	reason := `{"reason": "Неоплата счёта за октябрь"}`
	for _, c := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/v1/platform/tenants/" + id + "/suspend", reason},
		{http.MethodPost, "/api/v1/platform/tenants/" + id + "/resume", reason},
		{http.MethodPost, "/api/v1/platform/tenants/" + id + "/trial-extensions", `{"days": 14, "reason": "Пилот продлён"}`},
		{http.MethodGet, "/api/v1/platform/audit-events", ""},
	} {
		rec := serve(t, seeded(1), c.method, c.path, c.body, map[string]string{"Idempotency-Key": "k-0000000000000001", "If-Match": `"1"`})
		if rec.Code != http.StatusNotImplemented || code(t, rec) != "not_implemented" {
			t.Errorf("%s %s: %d %s", c.method, c.path, rec.Code, rec.Body)
		}
	}
}
