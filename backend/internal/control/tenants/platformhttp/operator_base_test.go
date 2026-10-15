package platformhttp

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// Без сервиса операторов (operators.Server, W1.48) реестр W1.02 остаётся полным strict server тега Platform: команды
// оператора и журнал отвечают 501 not_implemented. cmd/api монтирует operators.Server, который их перекрывает.
func TestOperatorOperationsWithoutOperatorService(t *testing.T) {
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
