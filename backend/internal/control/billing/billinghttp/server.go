// Package billinghttp serves the billing of the control DB (W4.60, contract 0.8.0-stage4 of W4.07) inside the strict
// servers of the tags Billing (the price book of the owner and his tier requests) and Platform (the queue of requests
// and the decision, the price book versions, the usage of the platform and the seats, members, tier and sign of the
// tenants of the operator lists). Each server embeds the composed server of its tag and overrides only these
// operations.
package billinghttp

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Store is the billing store (billing.Store).
type Store interface {
	PriceBook(ctx context.Context, tenantID uuid.UUID) (billing.TenantPriceBook, error)
	Requests(ctx context.Context, q billing.RequestQuery) (billing.RequestPage, error)
	CreateRequest(ctx context.Context, c billing.CreateRequest) (billing.Request, error)
	CancelRequest(ctx context.Context, c billing.CancelRequest) (billing.Request, error)
	Decide(ctx context.Context, c billing.Decision) (billing.Request, error)
	Versions(ctx context.Context, includeCancelled bool) ([]billing.Version, error)
	Publish(ctx context.Context, c billing.Publish) (billing.Version, error)
	CancelVersion(ctx context.Context, c billing.CancelVersion) (billing.Version, error)
	Usage(ctx context.Context, modules billing.Modules, moduleOrder []string) (billing.Usage, error)
	Facts(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]billing.Facts, error)
}

// Events follow a committed command (cmd/api: the notifications of the owners and context.changed, ADR-0015); they
// are best effort and never fail the command.
type Events interface {
	RequestCreated(ctx context.Context, r billing.Request)
	RequestDecided(ctx context.Context, r billing.Request)
}

// Marks are the signs of tenants for the operator lists (TenantBrandMark of the branding).
type Marks interface {
	Marks(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]platformapi.TenantBrandMark, error)
}

// TenantServer is the tag Billing with the price book and the tier requests of the owner.
type TenantServer struct {
	billingapi.StrictServerInterface
	Store  Store
	Events Events           // nil — none
	Now    func() time.Time // nil — time.Now
}

// PlatformServer is the tag Platform with the requests, the price book, the usage and the facts of the tenants.
type PlatformServer struct {
	platformapi.StrictServerInterface
	Store       Store
	Events      Events
	Marks       Marks           // nil — tenants without a sign
	Modules     billing.Modules // the installed modules of a tenant (getPlatformUsage); nil — none
	ModuleOrder []string        // the industry modules in the order of the catalog
	Now         func() time.Time
}

const noStore = "private, no-store"

// Page size of the lists (common/parameters.yaml Limit).
const (
	defaultLimit = 50
	maxLimit     = 200
)

func clockOf(now func() time.Time) time.Time {
	if now != nil {
		return now().UTC()
	}
	return time.Now().UTC()
}

// headers are the Cache-Control and X-Request-Id of an answer.
func headers(ctx context.Context) (cache, rid *string) {
	c, id := noStore, requestid.FromContext(ctx)
	return &c, &id
}

// storeError maps the errors of the store to Problem codes; a RefusalError keeps its code and detail (a 422 with
// violations is answered by the typed response of the operation); anything unexpected is dependency_unavailable.
func storeError(err error) error {
	var refusal *billing.RefusalError
	switch {
	case errors.As(err, &refusal):
		return problem.New(refusal.Code, refusal.Detail)
	case errors.Is(err, billing.ErrNotFound), errors.Is(err, billing.ErrNotOperator):
		return problem.New(problem.CodeNotFound, "")
	case errors.Is(err, billing.ErrForbidden):
		return problem.New(problem.CodeForbiddenAction, "")
	case errors.Is(err, billing.ErrBadCursor):
		return problem.New(problem.CodeMalformedRequest, "cursor")
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// validation is the Problem body of a refusal with violations (422), nil for any other error.
func validation(ctx context.Context, err error) *problemView {
	var refusal *billing.RefusalError
	if !errors.As(err, &refusal) || len(refusal.Violations) == 0 {
		return nil
	}
	p := catalog.Problems[refusal.Code]
	if p.Status != http.StatusUnprocessableEntity {
		return nil
	}
	out := &problemView{
		Type: problem.TypeBase + refusal.Code, Title: p.Title, Status: p.Status, Code: refusal.Code, Detail: refusal.Detail,
		RequestID: requestid.FromContext(ctx),
	}
	for _, v := range refusal.Violations {
		out.Violations = append(out.Violations, violationView(v))
	}
	return out
}

// pageOf checks limit and cursor of a list.
func pageOf(limit *int, cursor *string) (int, string, error) {
	n := defaultLimit
	if limit != nil {
		n = *limit
	}
	if n < 1 || n > maxLimit {
		return 0, "", problem.New(problem.CodeMalformedRequest, "limit: 1…200")
	}
	c := ""
	if cursor != nil {
		c = *cursor
	}
	return n, c, nil
}

// statuses of the status filter of the lists of requests.
var statuses = map[string]bool{billing.StatusPending: true, billing.StatusApproved: true, billing.StatusRejected: true, billing.StatusCancelled: true}

func statusOf(raw *string) (string, error) {
	if raw == nil {
		return "", nil
	}
	if !statuses[*raw] {
		return "", problem.New(problem.CodeMalformedRequest, "Неизвестный статус заявки.")
	}
	return *raw, nil
}

// ownerOf is the owner of the request (the TenantContext of the gateway).
func ownerOf(ctx context.Context) (billing.Owner, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return billing.Owner{}, problem.New(problem.CodeNotFound, "")
	}
	return billing.Owner{TenantID: tc.TenantID, MembershipID: tc.MembershipID, AccountID: tc.AccountID}, nil
}

// actorOf is the account of the operator of the request (the gateway admitted an active one).
func actorOf(ctx context.Context) (uuid.UUID, error) {
	sess, ok := session.FromContext(ctx)
	if !ok {
		return uuid.Nil, problem.New(problem.CodeSessionExpired, "")
	}
	return sess.AccountID, nil
}
