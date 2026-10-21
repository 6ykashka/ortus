package idem

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/httpx"
)

// W4.60: операция со своим пределом тела (файл оформления в base64 ≈ 1,4 МБ) проходит Guard; больше её предела — 413
// payload_too_large; у остальных операций предел прежний (1 МиБ → 400).
func TestBodyLimitPerOperation(t *testing.T) {
	t.Parallel()
	g, _ := newGuard(NewMemStore())
	g.Bodies = map[string]int{"uploadBrandingAsset": 2 << 20}
	upload := Namespace{TenantID: tenantA, ActorID: actor1, Operation: "uploadBrandingAsset"}
	big := `{"x":"` + strings.Repeat("a", httpx.MaxBody+1000) + `"}`
	if w := do(g, upload, testKey, big, &counter{}); w.Code != http.StatusCreated {
		t.Errorf("upload of 1 MiB+: %d %s", w.Code, w.Body)
	}
	huge := `{"x":"` + strings.Repeat("a", 2<<20) + `"}`
	if w := do(g, upload, testKey+"-2", huge, &counter{}); w.Code != http.StatusRequestEntityTooLarge || problemCode(t, w) != "payload_too_large" {
		t.Errorf("upload over its limit: %d %s", w.Code, w.Body)
	}
	if w := do(g, nsA1, testKey, big, &counter{}); w.Code != http.StatusBadRequest {
		t.Errorf("other operation over 1 MiB: %d", w.Code)
	}
}
