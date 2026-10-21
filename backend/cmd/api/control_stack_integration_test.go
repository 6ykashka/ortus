//go:build integration

package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// W4.60 end to end over the Go seed: the owner of «Лотос» reads the branding v3 (and its theme in /me/context), the
// price book and SR-12; the operators see the queue by their role (support — 403 before the handler), the usage of
// the four tenants; a rejection reaches the inbox of the owner. Without S3 an upload answers 503, an unknown public
// file 404.
func TestStackBillingAndBranding(t *testing.T) { //nolint:paralleltest // one seeded stack; decides SR-12 and restores it
	srv := server(t)
	owner := newBrowser(t, srv).login("owner@t-lotos")
	lotos := "/api/v1/tenants/" + seedLotos.String()
	status, hdr, brand := owner.do(http.MethodGet, lotos+"/branding", "", nil)
	if status != http.StatusOK || hdr.Get("ETag") != `"rev-3"` || brand["accentUsed"] != "#7A3E79" || brand["shortName"] != "Лотос" {
		t.Fatalf("branding: %d %v %v", status, hdr, brand)
	}
	_, _, me := owner.do(http.MethodGet, "/api/v1/me/context", "", nil)
	tenants, _ := me["tenants"].([]any)
	first, _ := tenants[0].(map[string]any)
	theme, _ := first["branding"].(map[string]any)
	if theme["version"] != float64(3) || theme["updatedBy"] != nil {
		t.Fatalf("theme of the shell: %v", first)
	}
	checkOwnerBilling(t, owner, lotos)
	status, _, upload := owner.do(http.MethodPost, lotos+"/branding/assets",
		`{"kind": "logo", "fileName": "l.svg", "contentType": "image/svg+xml", "contentBase64": "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIvPg=="}`,
		map[string]string{"Idempotency-Key": "w460-stack-upload-" + uuid.NewString()[:8]})
	if status != http.StatusServiceUnavailable {
		t.Fatalf("upload without S3: %d %v", status, upload)
	}
	if status, _, _ := owner.do(http.MethodGet, "/brand-assets/"+strings.Repeat("ab", 32)+".png", "", nil); status != http.StatusNotFound {
		t.Fatalf("unknown public file: %d", status)
	}
	checkOperators(t, srv)
	rejectSR12(t, newBrowser(t, srv).login("op-3"))
}

// checkOwnerBilling: the price book v2 and the pending SR-12 of the owner.
func checkOwnerBilling(t *testing.T, owner *browser, lotos string) {
	t.Helper()
	status, _, book := owner.do(http.MethodGet, lotos+"/price-book", "", nil)
	current, _ := book["current"].(map[string]any)
	if status != http.StatusOK || current["version"] != float64(2) {
		t.Fatalf("price book: %d %v", status, book)
	}
	status, _, mine := owner.do(http.MethodGet, lotos+"/subscription/change-requests", "", nil)
	if status != http.StatusOK || strings.Join(itemsOf(mine, "number"), ",") != "SR-12" || mine["pendingCount"] != float64(1) {
		t.Fatalf("requests of the owner: %d %v", status, mine)
	}
}

// checkOperators: the queue for billing, 403 for support, the usage for the owner of the platform.
func checkOperators(t *testing.T, srv *httptest.Server) {
	t.Helper()
	status, _, queue := newBrowser(t, srv).login("op-3").do(http.MethodGet, "/api/v1/platform/subscription-requests", "", nil)
	if status != http.StatusOK || strings.Join(itemsOf(queue, "number"), ",") != "SR-12" {
		t.Fatalf("queue of billing: %d %v", status, queue)
	}
	if status, _, body := newBrowser(t, srv).login("op-4").do(http.MethodGet, "/api/v1/platform/subscription-requests", "", nil); status != http.StatusForbidden {
		t.Fatalf("queue of support: %d %v", status, body)
	}
	status, _, usage := newBrowser(t, srv).login("operator").do(http.MethodGet, "/api/v1/platform/usage", "", nil)
	rows, _ := usage["tenants"].([]any)
	if status != http.StatusOK || len(rows) != 4 {
		t.Fatalf("usage: %d %v", status, usage)
	}
}

// rejectSR12 rejects SR-12 as op-3: the owner of «Лотос» gets the notice; the request is restored for the other tests.
func rejectSR12(t *testing.T, op *browser) {
	t.Helper()
	ctl, lotosDB := super(t, controlDB), stack.DB(t, "t_lotos", migratetest.Super)
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		_, _ = ctl.ExecContext(ctx, `update subscription_change_requests set status = 'pending', decided_by = null, decided_at = null,
  decision_note = null, revision = 1 where number = 'SR-12'`)
		_, _ = lotosDB.ExecContext(ctx, `delete from notify.notifications where kind like 'billing.subscription_request.%'`)
	})
	id := "d5748522-e6b8-5df4-8a9f-1cbdfef46ed3"
	status, _, decided := op.do(http.MethodPost, "/api/v1/platform/subscription-requests/"+id+"/decision",
		`{"decision": "reject", "note": "Сначала оплатите счёт за сентябрь"}`,
		map[string]string{"Idempotency-Key": "w460-stack-reject-" + uuid.NewString()[:8]})
	if status != http.StatusOK || decided["status"] != "rejected" {
		t.Fatalf("reject: %d %v", status, decided)
	}
	var title, body string
	if err := lotosDB.QueryRowContext(t.Context(), `select title, coalesce(body, '') from notify.notifications
 where kind = 'billing.subscription_request.rejected'`).Scan(&title, &body); err != nil {
		t.Fatalf("notice of the owner: %v", err)
	}
	if title != "Заявка SR-12 отклонена: Сначала оплатите счёт за сентябрь" || body != "" {
		t.Fatalf("notice: %q %q", title, body)
	}
}
