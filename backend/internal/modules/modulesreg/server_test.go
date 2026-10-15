package modulesreg

import (
	"context"
	"encoding/json"
	"testing"

	modulesapi "github.com/ortus/ortus-crm/backend/internal/api/modules"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func admitted(ctx context.Context) context.Context { return tenantctx.WithTenant(ctx, ownerCtx) }

func TestServerReads(t *testing.T) {
	t.Parallel()
	srv := &Server{S: service(t, newStore(Installation{Key: "spa", StoredKey: "spa", State: StateActive, Revision: 3}))}
	ctx := admitted(t.Context())
	list, err := srv.ListModuleCatalog(ctx, modulesapi.ListModuleCatalogRequestObject{TenantId: tenantA})
	if err != nil {
		t.Fatal(err)
	}
	cat, ok := list.(modulesapi.ListModuleCatalog200JSONResponse)
	if !ok || len(cat.Body.Items) != 3 || cat.Headers.CacheControl == nil || *cat.Headers.CacheControl != "private, no-store" {
		t.Fatalf("catalog %+v", list)
	}
	got, err := srv.GetModuleInstallation(ctx, modulesapi.GetModuleInstallationRequestObject{TenantId: tenantA, ModuleKey: "spa"})
	if err != nil {
		t.Fatal(err)
	}
	inst, ok := got.(modulesapi.GetModuleInstallation200JSONResponse)
	if !ok || inst.Body.State != StateActive || inst.Headers.ETag == nil || *inst.Headers.ETag != `"rev-3"` {
		t.Fatalf("installation %+v", got)
	}
	_, err = srv.GetModuleInstallation(ctx, modulesapi.GetModuleInstallationRequestObject{TenantId: tenantA, ModuleKey: "chat"})
	wantCode(t, err, problem.CodeNotFound)
}

func TestServerPreviewAndSettings(t *testing.T) {
	t.Parallel()
	srv := &Server{S: service(t, newStore(Installation{Key: "spa", StoredKey: "spa", State: StateActive, Revision: 3}))}
	ctx := admitted(t.Context())
	prev, err := srv.PreviewModuleDeactivation(ctx, modulesapi.PreviewModuleDeactivationRequestObject{TenantId: tenantA, ModuleKey: "spa"})
	if err != nil {
		t.Fatal(err)
	}
	if p, ok := prev.(modulesapi.PreviewModuleDeactivation200JSONResponse); !ok || p.Body.ModuleKey != "spa" ||
		len(p.Body.ActiveItems) != 0 || p.Headers.CacheControl == nil {
		t.Fatalf("preview %+v", prev)
	}
	set, err := srv.GetModuleSettings(ctx, modulesapi.GetModuleSettingsRequestObject{TenantId: tenantA, ModuleKey: "spa"})
	if err != nil {
		t.Fatal(err)
	}
	st, ok := set.(modulesapi.GetModuleSettings200JSONResponse)
	raw, _ := json.Marshal(st.Body)
	if want := normalized(t, example(t, "getModuleSettings", "ok")); !ok || normalized(t, raw) != want ||
		*st.Headers.ETag != `"rev-3"` {
		t.Errorf("settings %s, want %s", raw, want)
	}
}

func TestServerWrites(t *testing.T) {
	t.Parallel()
	store := newStore(Installation{Key: "spa", StoredKey: "spa", State: StateActive, Revision: 3})
	srv := &Server{S: service(t, store)}
	ctx := admitted(t.Context())
	reason := "сезон закрыт"
	resp, err := srv.SetModuleInstallation(ctx, modulesapi.SetModuleInstallationRequestObject{
		TenantId: tenantA, ModuleKey: "spa", Params: modulesapi.SetModuleInstallationParams{IfMatch: `"rev-3"`},
		Body: &modulesapi.ModuleInstallationUpdate{Enabled: false, Reason: &reason},
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, isOK := resp.(modulesapi.SetModuleInstallation200JSONResponse)
	if !isOK || ok.Body.State != StateReadOnly || *ok.Headers.ETag != `"rev-4"` || store.changes[0].Reason != reason {
		t.Fatalf("set %+v", resp)
	}
	var body modulesapi.ModuleSettings
	if err := body.UnmarshalJSON([]byte(`{"moduleKey":"spa","cancellationMinutes":180,"allowNegativeStock":false,"defaultTimeZone":"Europe/Moscow"}`)); err != nil {
		t.Fatal(err)
	}
	upd, err := srv.UpdateModuleSettings(ctx, modulesapi.UpdateModuleSettingsRequestObject{
		TenantId: tenantA, ModuleKey: "spa", Params: modulesapi.UpdateModuleSettingsParams{IfMatch: `"rev-4"`}, Body: &body,
	})
	if err != nil {
		t.Fatal(err)
	}
	if u, isOK := upd.(modulesapi.UpdateModuleSettings200JSONResponse); !isOK || *u.Headers.ETag != `"rev-5"` {
		t.Fatalf("update %+v", upd)
	}
	_, err = srv.SetModuleInstallation(ctx, modulesapi.SetModuleInstallationRequestObject{TenantId: tenantA, ModuleKey: "spa"})
	wantCode(t, err, problem.CodeMalformedRequest)
	_, err = srv.SetModuleInstallation(t.Context(), modulesapi.SetModuleInstallationRequestObject{
		TenantId: tenantA, ModuleKey: "spa", Body: &modulesapi.ModuleInstallationUpdate{},
	})
	wantCode(t, err, problem.CodeNotFound) // без контекста организации (шлюз не пропускал) — как чужая
}
