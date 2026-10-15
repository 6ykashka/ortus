// Package platformhttp implements the OpenAPI tag Platform for the tenant registry (W1.02, S1-01):
// listPlatformTenants, getPlatformTenant and createPlatformTenant. The gateway of cmd/api admits only platform
// operators (others get 404). The other operations of the tag answer 501 until their owners take them
// (updatePlatformTenant — W1.11, subscriptions — W1.08, listPlatformUsers — not assigned): each owner replaces the
// method in a file of its own, as with the stubs of mehttp (Q-W0.18-2).
package platformhttp

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"github.com/google/uuid"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/provisioning"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// Store is the tenant registry of the control DB.
type Store interface {
	ListTenants(ctx context.Context, after *tenants.Cursor, limit int) ([]tenants.Tenant, *tenants.Cursor, error)
	GetTenant(ctx context.Context, id uuid.UUID) (tenants.Tenant, error)
	Register(ctx context.Context, req provisioning.Request) (tenants.Tenant, bool, error)
}

// SQLStore is the Store over the control DB as ortus_api (DML only: the provisioner creates the database).
type SQLStore struct {
	Control   *sql.DB
	Registrar provisioning.Registrar // Control of the registrar defaults to Control
}

// ListTenants implements Store.
func (s SQLStore) ListTenants(ctx context.Context, after *tenants.Cursor, limit int) ([]tenants.Tenant, *tenants.Cursor, error) {
	return tenants.ListTenants(ctx, s.Control, after, limit)
}

// GetTenant implements Store.
func (s SQLStore) GetTenant(ctx context.Context, id uuid.UUID) (tenants.Tenant, error) {
	return tenants.GetTenant(ctx, s.Control, id)
}

// Register implements Store.
func (s SQLStore) Register(ctx context.Context, req provisioning.Request) (tenants.Tenant, bool, error) {
	r := s.Registrar
	if r.Control == nil {
		r.Control = s.Control
	}
	return r.Register(ctx, req)
}

// Server is the strict server of the tag Platform.
type Server struct {
	Store Store
}

var _ platformapi.StrictServerInterface = (*Server)(nil)

// Page size of listPlatformTenants (common/parameters.yaml Limit).
const (
	defaultLimit = 50
	maxLimit     = 200
)

// Problem codes of this package beyond the platform ones (api/errors.yaml).
const (
	codeValidationFailed     = "validation_failed"
	codeIdempotencyKeyReused = "idempotency_key_reused"
)

const noStore = "private, no-store"

func etag(revision int64) string { return `"` + strconv.FormatInt(revision, 10) + `"` }

func toAPI(tn tenants.Tenant) platformapi.Tenant {
	owners := tn.OwnerAccountIDs
	if owners == nil {
		owners = []uuid.UUID{}
	}
	return platformapi.Tenant{
		Id: tn.ID, Name: tn.Name, Status: platformapi.TenantStatus(tn.State), OwnerUserIds: owners,
		CreatedAt: tn.CreatedAt.UTC(), Revision: tn.Revision,
	}
}

// storeError maps registry errors to Problem codes; anything unexpected is dependency_unavailable without its text.
func storeError(err error) error {
	var ve *provisioning.ValidationError
	switch {
	case errors.Is(err, tenants.ErrUnknownTenant):
		return problem.New(problem.CodeNotFound, "")
	case errors.As(err, &ve):
		return problem.New(codeValidationFailed, "Неверные поля: "+strings.Join(ve.Fields, ", "))
	case errors.Is(err, provisioning.ErrIdempotencyConflict):
		return problem.New(codeIdempotencyKeyReused, "")
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// ListPlatformTenants implements platformapi.StrictServerInterface.
func (s *Server) ListPlatformTenants(ctx context.Context, req platformapi.ListPlatformTenantsRequestObject) (platformapi.ListPlatformTenantsResponseObject, error) {
	limit := defaultLimit
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	if limit < 1 || limit > maxLimit {
		return nil, problem.New(problem.CodeMalformedRequest, "limit: 1…200")
	}
	var after *tenants.Cursor
	if req.Params.Cursor != nil {
		c, err := tenants.DecodeCursor(*req.Params.Cursor)
		if err != nil {
			return nil, problem.Wrap(problem.CodeMalformedRequest, err)
		}
		after = &c
	}
	items, next, err := s.Store.ListTenants(ctx, after, limit)
	if err != nil {
		return nil, storeError(err)
	}
	page := platformapi.TenantPage{Items: make([]platformapi.Tenant, 0, len(items))}
	for _, tn := range items {
		page.Items = append(page.Items, toAPI(tn))
	}
	if next != nil {
		s := next.Encode()
		page.NextCursor = &s
	}
	cc, rid := noStore, requestid.FromContext(ctx)
	return platformapi.ListPlatformTenants200JSONResponse{
		Body: page, Headers: platformapi.ListPlatformTenants200ResponseHeaders{CacheControl: &cc, XRequestId: &rid},
	}, nil
}

// GetPlatformTenant implements platformapi.StrictServerInterface.
func (s *Server) GetPlatformTenant(ctx context.Context, req platformapi.GetPlatformTenantRequestObject) (platformapi.GetPlatformTenantResponseObject, error) {
	tn, err := s.Store.GetTenant(ctx, req.TenantId)
	if err != nil {
		return nil, storeError(err)
	}
	cc, rid, tag := noStore, requestid.FromContext(ctx), etag(tn.Revision)
	return platformapi.GetPlatformTenant200JSONResponse{
		Body:    toAPI(tn),
		Headers: platformapi.GetPlatformTenant200ResponseHeaders{CacheControl: &cc, ETag: &tag, XRequestId: &rid},
	}, nil
}

// CreatePlatformTenant implements platformapi.StrictServerInterface: the tenant is registered in provisioning; the
// provisioner process creates its database (cmd/provisioner).
func (s *Server) CreatePlatformTenant(ctx context.Context, req platformapi.CreatePlatformTenantRequestObject) (platformapi.CreatePlatformTenantResponseObject, error) {
	sess, ok := session.FromContext(ctx)
	if !ok {
		return nil, problem.New(problem.CodeSessionExpired, "")
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	rid := requestid.FromContext(ctx)
	tn, replayed, err := s.Store.Register(ctx, provisioning.Request{
		Name: req.Body.Name, OwnerEmail: string(req.Body.OwnerEmail), TimeZone: req.Body.TimeZone, PlanKey: req.Body.PlanKey,
		ActorID: sess.AccountID, IdempotencyKey: req.Params.IdempotencyKey, RequestID: rid,
	})
	if err != nil {
		return nil, storeError(err)
	}
	cc, tag := noStore, etag(tn.Revision)
	return platformapi.CreatePlatformTenant201JSONResponse{
		Body: toAPI(tn),
		Headers: platformapi.CreatePlatformTenant201ResponseHeaders{
			CacheControl: &cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: &rid,
		},
	}, nil
}

// The operations below belong to other stage 1 owners; until then they answer 501 not_implemented.

// UpdatePlatformTenant implements platformapi.StrictServerInterface (W1.11).
func (s *Server) UpdatePlatformTenant(context.Context, platformapi.UpdatePlatformTenantRequestObject) (platformapi.UpdatePlatformTenantResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// GetPlatformSubscription implements platformapi.StrictServerInterface (W1.08).
func (s *Server) GetPlatformSubscription(context.Context, platformapi.GetPlatformSubscriptionRequestObject) (platformapi.GetPlatformSubscriptionResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// UpdatePlatformSubscription implements platformapi.StrictServerInterface (W1.08).
func (s *Server) UpdatePlatformSubscription(context.Context, platformapi.UpdatePlatformSubscriptionRequestObject) (platformapi.UpdatePlatformSubscriptionResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ListPlatformUsers implements platformapi.StrictServerInterface (no owner in stage 1).
func (s *Server) ListPlatformUsers(context.Context, platformapi.ListPlatformUsersRequestObject) (platformapi.ListPlatformUsersResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}
