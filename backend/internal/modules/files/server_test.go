package files_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	filesapi "github.com/ortus/ortus-crm/backend/internal/api/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// errDown is a tenant DB that does not answer.
var errDown = problem.New(problem.CodeDependencyUnavailable, "")

type downPools struct{}

func (downPools) For(context.Context, uuid.UUID) (*pgxpool.Pool, error) { return nil, errDown }

// allow is an evaluator that allows everything (the decisions are tested with the real one in integration).
type allow struct{}

func (allow) Permit(context.Context, tenantctx.TenantContext, string, authz.Resource) error {
	return nil
}

func (allow) ScopeQuery(context.Context, tenantctx.TenantContext, string, authz.Columns, int) (authz.Predicate, error) {
	return authz.Predicate{SQL: "true"}, nil
}

func downService(t *testing.T, store storage.Store) *files.Service {
	t.Helper()
	parents, err := files.NewParents(files.FleetParents()...)
	if err != nil {
		t.Fatal(err)
	}
	return &files.Service{Pools: downPools{}, Authz: allow{}, Store: store, Parents: parents}
}

func body() *filesapi.UploadCreate {
	return &filesapi.UploadCreate{
		FileName: "a.jpg", ContentType: "image/jpeg", SizeBytes: 10, Sha256: sha, Purpose: "inspection",
		Owner: filesapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: uuid.New()},
	}
}

// Every operation of the servers answers not_found without the tenant of the gateway, malformed_request without a
// body, and passes the errors of the tenant DB through (503, never a guess).
func TestServersPassErrors(t *testing.T) {
	t.Parallel()
	svc := downService(t, storage.NewMem())
	srv, bill := files.Server{S: svc}, files.Billing{S: svc}
	in := tenantctx.WithTenant(t.Context(), tenantctx.TenantContext{TenantID: uuid.New(), PersonID: uuid.New()})
	id := uuid.New()
	limit := 10
	calls := map[string]func(context.Context) error{
		"ListFiles": func(c context.Context) error {
			_, err := srv.ListFiles(c, filesapi.ListFilesRequestObject{Params: filesapi.ListFilesParams{Limit: &limit}})
			return err
		},
		"InitiateUpload": func(c context.Context) error {
			_, err := srv.InitiateUpload(c, filesapi.InitiateUploadRequestObject{Body: body()})
			return err
		},
		"AbortUpload": func(c context.Context) error {
			_, err := srv.AbortUpload(c, filesapi.AbortUploadRequestObject{UploadId: id})
			return err
		},
		"GetUploadSession": func(c context.Context) error {
			_, err := srv.GetUploadSession(c, filesapi.GetUploadSessionRequestObject{UploadId: id})
			return err
		},
		"CompleteUpload": func(c context.Context) error {
			_, err := srv.CompleteUpload(c, filesapi.CompleteUploadRequestObject{UploadId: id, Body: &filesapi.UploadComplete{Sha256: sha}})
			return err
		},
		"GetFile": func(c context.Context) error {
			_, err := srv.GetFile(c, filesapi.GetFileRequestObject{FileId: id})
			return err
		},
		"GetFileDownload": func(c context.Context) error {
			_, err := srv.GetFileDownload(c, filesapi.GetFileDownloadRequestObject{FileId: id})
			return err
		},
		"GetStorageUsage": func(c context.Context) error {
			_, err := bill.GetStorageUsage(c, billingapi.GetStorageUsageRequestObject{})
			return err
		},
		"GetStorageBreakdown": func(c context.Context) error {
			_, err := bill.GetStorageBreakdown(c, billingapi.GetStorageBreakdownRequestObject{})
			return err
		},
		"RequestStorageChange": func(c context.Context) error {
			_, err := bill.RequestStorageChange(c, billingapi.RequestStorageChangeRequestObject{
				Body: &billingapi.StorageChangeRequest{RequestedQuotaBytes: 1 << 30, Mode: billingapi.Commit, AcceptedQuoteId: &id}})
			return err
		},
	}
	for name, call := range calls {
		if err := call(t.Context()); !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s without a tenant: %v", name, err)
		}
		if err := call(in); !errors.Is(err, errDown) {
			t.Errorf("%s with the tenant DB down: %v", name, err)
		}
	}
}

func TestServersRejectMissingBodies(t *testing.T) {
	t.Parallel()
	svc := downService(t, nil)
	srv, bill := files.Server{S: svc}, files.Billing{S: svc}
	ctx := tenantctx.WithTenant(t.Context(), tenantctx.TenantContext{TenantID: uuid.New()})
	_, err := srv.InitiateUpload(ctx, filesapi.InitiateUploadRequestObject{})
	wantProblem(t, "initiate", err, problem.CodeMalformedRequest)
	_, err = srv.CompleteUpload(ctx, filesapi.CompleteUploadRequestObject{})
	wantProblem(t, "complete", err, problem.CodeMalformedRequest)
	_, err = bill.RequestStorageChange(ctx, billingapi.RequestStorageChangeRequestObject{})
	wantProblem(t, "change", err, problem.CodeMalformedRequest)
	_, err = bill.RequestStorageChange(ctx, billingapi.RequestStorageChangeRequestObject{
		Body: &billingapi.StorageChangeRequest{RequestedQuotaBytes: 1, Mode: "maybe"}})
	wantProblem(t, "mode", err, "validation_failed")
	zero := 0
	_, err = srv.ListFiles(ctx, filesapi.ListFilesRequestObject{Params: filesapi.ListFilesParams{Limit: &zero}})
	wantProblem(t, "limit 0", err, "validation_failed")
	_, err = bill.RequestSubscriptionChange(ctx, billingapi.RequestSubscriptionChangeRequestObject{})
	wantProblem(t, "subscription change without W1.08", err, problem.CodeNotImplemented)
	// Without object storage uploads are 503 before any database work.
	_, err = srv.InitiateUpload(ctx, filesapi.InitiateUploadRequestObject{Body: body()})
	wantProblem(t, "initiate without storage", err, problem.CodeDependencyUnavailable)
}

// List validates its parameters before touching the database.
func TestListParameters(t *testing.T) {
	t.Parallel()
	svc := downService(t, nil)
	tc := tenantctx.TenantContext{TenantID: uuid.New()}
	for name, q := range map[string]files.ListQuery{
		"limit 201": {Limit: 201}, "limit -1": {Limit: -1}, "status": {Status: "deleted"}, "purpose": {Purpose: "avatar"},
	} {
		_, err := svc.List(t.Context(), tc, q)
		wantProblem(t, name, err, "validation_failed")
	}
	_, err := svc.List(t.Context(), tc, files.ListQuery{Cursor: "%%%"})
	wantProblem(t, "cursor", err, problem.CodeMalformedRequest)
	// No registered parent kind: nothing is visible, the database is not asked.
	svc.Parents = nil
	page, err := svc.List(t.Context(), tc, files.ListQuery{})
	if err != nil || len(page.Items) != 0 || page.Next != "" {
		t.Fatalf("list without parents: %+v %v", page, err)
	}
	_, err = svc.Initiate(t.Context(), tc, upload())
	wantProblem(t, "initiate without parents", err, "validation_failed")
}

// The worker registers both handlers; without storage a check is retried, a missing tenant pool is an error.
func TestWorkerWithoutStorage(t *testing.T) {
	t.Parallel()
	w := &files.Worker{Pools: downPools{}}
	reg := events.NewRegistry()
	w.Register(reg)
	for _, typ := range []string{files.EventUploaded, files.EventDeadline} {
		if err := reg.Dispatch(t.Context(), events.Message{Type: typ, TenantID: uuid.New()}); !errors.Is(err, errDown) {
			t.Errorf("%s: %v", typ, err)
		}
	}
}

func TestRequestChangeValidation(t *testing.T) {
	t.Parallel()
	_, err := downService(t, nil).RequestChange(t.Context(), tenantctx.TenantContext{TenantID: uuid.New()}, files.ChangeRequest{})
	wantProblem(t, "zero quota", err, "validation_failed")
}

func TestEncodeMIMEWithoutName(t *testing.T) {
	t.Parallel()
	if got := files.EncodeMIME("image/png", ""); got != "image/png" {
		t.Errorf("EncodeMIME without a name = %q", got)
	}
	if ct, name := files.DecodeMIME("not a / type;;"); ct != "not a / type;;" || name != "" {
		t.Errorf("DecodeMIME of garbage = %q, %q", ct, name)
	}
}

func wantProblem(t *testing.T, what string, err error, code string) {
	t.Helper()
	if !problem.Is(err, code) {
		t.Errorf("%s: %v, want %s", what, err, code)
	}
}

// The tenant id is required (no default database); a nil registry knows no parent kind.
func TestServiceEdges(t *testing.T) {
	t.Parallel()
	svc := downService(t, nil)
	_, err := svc.Usage(t.Context(), tenantctx.TenantContext{})
	wantProblem(t, "usage without a tenant", err, problem.CodeNotFound)
	var none *files.Parents
	if _, ok := none.Kind("fleet", "trip"); ok || none.Keys() != nil {
		t.Error("a nil registry knows kinds")
	}
}

// ListFiles passes its filters to the service: a cursor of other filters is refused there.
func TestServerListFilters(t *testing.T) {
	t.Parallel()
	srv := files.Server{S: downService(t, nil)}
	ctx := tenantctx.WithTenant(t.Context(), tenantctx.TenantContext{TenantID: uuid.New()})
	status, purpose, cur := filesapi.ListFilesParamsStatus("ready"), filesapi.ListFilesParamsPurpose("inspection"), "bad"
	_, err := srv.ListFiles(ctx, filesapi.ListFilesRequestObject{Params: filesapi.ListFilesParams{Status: &status, Purpose: &purpose, Cursor: &cur}})
	wantProblem(t, "list with a bad cursor", err, problem.CodeMalformedRequest)
}

// Billing is the base of the tag: the subscription operations answer 501 here — W1.08 overlays them
// (subshttp.NewBillingServer(base, subs)), so there is one composition and no delegation back.
func TestBillingSubscriptionIsNotHere(t *testing.T) {
	t.Parallel()
	b := files.Billing{}
	_, err := b.GetTenantSubscription(t.Context(), billingapi.GetTenantSubscriptionRequestObject{})
	wantProblem(t, "getTenantSubscription", err, problem.CodeNotImplemented)
	_, err = b.RequestSubscriptionChange(t.Context(), billingapi.RequestSubscriptionChangeRequestObject{})
	wantProblem(t, "requestSubscriptionChange", err, problem.CodeNotImplemented)
}
