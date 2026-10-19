package expenses

import (
	"context"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// CategoryServer overlays the catalogue of expense categories (W2.41) on a strict server of the tag Fleet:
// listExpenseCategories, createExpenseCategory, archiveExpenseCategory; the other operations go to the base.
type CategoryServer struct {
	fleetapi.StrictServerInterface
	S *Service
}

var _ fleetapi.StrictServerInterface = CategoryServer{}

// NewCategoryServer returns the overlay on base (nil: the other operations of the tag answer 501).
func NewCategoryServer(base fleetapi.StrictServerInterface, s *Service) CategoryServer {
	if base == nil {
		base = unimplemented{}
	}
	return CategoryServer{StrictServerInterface: base, S: s}
}

// ListExpenseCategories implements fleetapi.StrictServerInterface.
func (h CategoryServer) ListExpenseCategories(ctx context.Context, r fleetapi.ListExpenseCategoriesRequestObject) (fleetapi.ListExpenseCategoriesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Categories(ctx, tc, r.Params.IncludeArchived != nil && *r.Params.IncludeArchived)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return fleetapi.ListExpenseCategories200JSONResponse{Body: out,
		Headers: fleetapi.ListExpenseCategories200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// CreateExpenseCategory implements fleetapi.StrictServerInterface.
func (h CategoryServer) CreateExpenseCategory(ctx context.Context, r fleetapi.CreateExpenseCategoryRequestObject) (fleetapi.CreateExpenseCategoryResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := h.S.CreateCategory(ctx, tc, *r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := categoryETag(out.Revision), false
	return fleetapi.CreateExpenseCategory201JSONResponse{Body: out, Headers: fleetapi.CreateExpenseCategory201ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ArchiveExpenseCategory implements fleetapi.StrictServerInterface.
func (h CategoryServer) ArchiveExpenseCategory(ctx context.Context, r fleetapi.ArchiveExpenseCategoryRequestObject) (fleetapi.ArchiveExpenseCategoryResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ArchiveCategory(ctx, tc, r.CategoryCode, r.Params.IfMatch)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := categoryETag(out.Revision), false
	return fleetapi.ArchiveExpenseCategory200JSONResponse{Body: out, Headers: fleetapi.ArchiveExpenseCategory200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
