//go:build integration

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"image"
	"image/png"
	"io"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// W4.60 with MinIO: the owner of «Лотос» uploads a square sign 512×512, the file is public at its content address
// (stored content type, nosniff, CSP sandbox, immutable cache); the new version v4 refers to it and the theme of the
// shell carries its address. The version and the file record are removed afterwards (the stack is shared).
func TestStackBrandingFiles(t *testing.T) { //nolint:paralleltest // one seeded stack; saves a branding version of t-lotos
	srv, _, _ := filesStack(t)
	owner := newBrowser(t, srv).login("owner@t-lotos")
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 512, 512))); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(buf.Bytes())
	ctl := super(t, controlDB)
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		_, _ = ctl.ExecContext(ctx, `delete from tenant_branding_versions where tenant_id = $1 and version > 3`, seedLotos)
		_, _ = ctl.ExecContext(ctx, `delete from branding_assets where tenant_id = $1`, seedLotos)
		_, _ = ctl.ExecContext(ctx, `delete from platform_audit where action = 'branding.updated'`)
	})
	lotos := "/api/v1/tenants/" + seedLotos.String()
	status, asset := owner.send(http.MethodPost, lotos+"/branding/assets", map[string]any{
		"kind": "mark", "fileName": "mark.png", "contentType": "image/png", "contentBase64": base64.StdEncoding.EncodeToString(buf.Bytes()),
	})
	url := "/brand-assets/" + hex.EncodeToString(sum[:]) + ".png"
	if status != http.StatusCreated || asset["url"] != url || asset["width"] != float64(512) {
		t.Fatalf("upload: %d %v", status, asset)
	}
	if code, hdr, got := fetch(t, srv.URL+url); code != http.StatusOK || !bytes.Equal(got, buf.Bytes()) || hdr.Get("Content-Type") != "image/png" ||
		hdr.Get("Content-Security-Policy") != "sandbox" || hdr.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("public file: %d %v (%d bytes)", code, hdr, len(got))
	}
	id, _ := asset["id"].(string)
	status, hdr, saved := owner.do(http.MethodPut, lotos+"/branding", `{"displayName": "SPA «Лотос»", "shortName": "Лотос",
		"accentHex": "#7A3E79", "logoAssetId": null, "markAssetId": "`+id+`", "poweredBy": true,
		"terms": {"visit": {"one": "сеанс", "plural": "сеансы", "few": "сеанса", "many": "сеансов"}}, "menu": {"items": {}, "order": []}}`,
		map[string]string{"Idempotency-Key": "w460-stack-brand-" + uuid.NewString()[:8], "If-Match": `"rev-3"`})
	mark, _ := saved["mark"].(map[string]any)
	if status != http.StatusOK || hdr.Get("ETag") != `"rev-4"` || mark["url"] != url {
		t.Fatalf("save: %d %v %v", status, hdr, saved)
	}
}

// fetch gets a public URL without a session.
func fetch(t *testing.T, url string) (int, http.Header, []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, resp.Header, body
}
