package service

import (
	"context"
	"slices"

	psapi "github.com/ortus/ortus-crm/backend/internal/api/publicservice"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Origins is the allowlist of the deployment for the Origin of the browser commands of the clients of the portal:
// exact serialized origins «scheme://host[:port]», no wildcard. A request without Origin is no browser one.
type Origins []string

// Admit checks the Origin of a command of a client before the token and the body: nil for an origin of the list or for
// a request without Origin; any other value is 403 origin_not_allowed.
func (o Origins) Admit(origin *string) error {
	if origin == nil || slices.Contains(o, *origin) {
		return nil
	}
	return problem.New(problem.CodeOriginNotAllowed, "")
}

// PublicServer is the strict server of the tag PublicService over the Service.
type PublicServer struct {
	S       *Service
	Origins Origins
}

var _ psapi.StrictServerInterface = PublicServer{}

func cache() *string { c := "private, no-store"; return &c }

func notReplayed() *bool { f := false; return &f }

// textUploadsOff is 503 of the uploads of the client until the purpose of the file of a request is in the contract of
// the module of files (Q-W7.31-3).
const textUploadsOff = "Загрузка файлов клиента пока не подключена"

// GetPublicServicePage implements psapi.StrictServerInterface.
func (h PublicServer) GetPublicServicePage(ctx context.Context, r psapi.GetPublicServicePageRequestObject) (psapi.GetPublicServicePageResponseObject, error) {
	out, err := h.S.PortalPage(ctx, r.Slug)
	if err != nil {
		return nil, err
	}
	return psapi.GetPublicServicePage200JSONResponse{Body: out, Headers: psapi.GetPublicServicePage200ResponseHeaders{CacheControl: cache(), XRequestId: ridOf(ctx)}}, nil
}

// SubmitPublicServiceRequest implements psapi.StrictServerInterface.
func (h PublicServer) SubmitPublicServiceRequest(ctx context.Context, r psapi.SubmitPublicServiceRequestRequestObject) (psapi.SubmitPublicServiceRequestResponseObject, error) {
	if err := h.Origins.Admit(r.Params.Origin); err != nil {
		return nil, err
	}
	out, err := h.S.PortalSubmit(ctx, r.Slug, r.Body)
	if err != nil {
		return nil, err
	}
	return psapi.SubmitPublicServiceRequest201JSONResponse{Body: out, Headers: psapi.SubmitPublicServiceRequest201ResponseHeaders{CacheControl: cache(),
		IdempotencyReplayed: notReplayed(), XRequestId: ridOf(ctx)}}, nil
}

// GetPublicServiceRequest implements psapi.StrictServerInterface.
func (h PublicServer) GetPublicServiceRequest(ctx context.Context, r psapi.GetPublicServiceRequestRequestObject) (psapi.GetPublicServiceRequestResponseObject, error) {
	out, err := h.S.PortalRequest(ctx, r.Token)
	if err != nil {
		return nil, err
	}
	return psapi.GetPublicServiceRequest200JSONResponse{Body: out, Headers: psapi.GetPublicServiceRequest200ResponseHeaders{CacheControl: cache(), XRequestId: ridOf(ctx)}}, nil
}

// PostPublicServiceMessage implements psapi.StrictServerInterface.
func (h PublicServer) PostPublicServiceMessage(ctx context.Context, r psapi.PostPublicServiceMessageRequestObject) (psapi.PostPublicServiceMessageResponseObject, error) {
	if err := h.Origins.Admit(r.Params.Origin); err != nil {
		return nil, err
	}
	out, err := h.S.PortalMessage(ctx, r.Token, r.Body)
	if err != nil {
		return nil, err
	}
	return psapi.PostPublicServiceMessage201JSONResponse{Body: out, Headers: psapi.PostPublicServiceMessage201ResponseHeaders{CacheControl: cache(),
		IdempotencyReplayed: notReplayed(), XRequestId: ridOf(ctx)}}, nil
}

// RatePublicServiceResolution implements psapi.StrictServerInterface.
func (h PublicServer) RatePublicServiceResolution(ctx context.Context, r psapi.RatePublicServiceResolutionRequestObject) (psapi.RatePublicServiceResolutionResponseObject, error) {
	if err := h.Origins.Admit(r.Params.Origin); err != nil {
		return nil, err
	}
	out, err := h.S.PortalRate(ctx, r.Token, r.Body)
	if err != nil {
		return nil, err
	}
	return psapi.RatePublicServiceResolution200JSONResponse{Body: out, Headers: psapi.RatePublicServiceResolution200ResponseHeaders{CacheControl: cache(),
		IdempotencyReplayed: notReplayed(), XRequestId: ridOf(ctx)}}, nil
}

// ReopenPublicServiceRequest implements psapi.StrictServerInterface.
func (h PublicServer) ReopenPublicServiceRequest(ctx context.Context, r psapi.ReopenPublicServiceRequestRequestObject) (psapi.ReopenPublicServiceRequestResponseObject, error) {
	if err := h.Origins.Admit(r.Params.Origin); err != nil {
		return nil, err
	}
	out, err := h.S.PortalReopen(ctx, r.Token, r.Body)
	if err != nil {
		return nil, err
	}
	return psapi.ReopenPublicServiceRequest200JSONResponse{Body: out, Headers: psapi.ReopenPublicServiceRequest200ResponseHeaders{CacheControl: cache(),
		IdempotencyReplayed: notReplayed(), XRequestId: ridOf(ctx)}}, nil
}

// OptOutPublicSurveys implements psapi.StrictServerInterface.
func (h PublicServer) OptOutPublicSurveys(ctx context.Context, r psapi.OptOutPublicSurveysRequestObject) (psapi.OptOutPublicSurveysResponseObject, error) {
	if err := h.Origins.Admit(r.Params.Origin); err != nil {
		return nil, err
	}
	out, err := h.S.PortalOptOut(ctx, r.Token)
	if err != nil {
		return nil, err
	}
	return psapi.OptOutPublicSurveys200JSONResponse{Body: out, Headers: psapi.OptOutPublicSurveys200ResponseHeaders{CacheControl: cache(),
		IdempotencyReplayed: notReplayed(), XRequestId: ridOf(ctx)}}, nil
}

// InitiatePublicServiceUpload implements psapi.StrictServerInterface.
func (h PublicServer) InitiatePublicServiceUpload(ctx context.Context, r psapi.InitiatePublicServiceUploadRequestObject) (psapi.InitiatePublicServiceUploadResponseObject, error) {
	if err := h.Origins.Admit(r.Params.Origin); err != nil {
		return nil, err
	}
	if err := h.S.PortalCheck(ctx, r.Token); err != nil {
		return nil, err
	}
	return nil, problem.New(problem.CodeDependencyUnavailable, textUploadsOff)
}

// CompletePublicServiceUpload implements psapi.StrictServerInterface.
func (h PublicServer) CompletePublicServiceUpload(ctx context.Context, r psapi.CompletePublicServiceUploadRequestObject) (psapi.CompletePublicServiceUploadResponseObject, error) {
	if err := h.Origins.Admit(r.Params.Origin); err != nil {
		return nil, err
	}
	if err := h.S.PortalCheck(ctx, r.Token); err != nil {
		return nil, err
	}
	return nil, problem.New(problem.CodeDependencyUnavailable, textUploadsOff)
}

func ridOf(ctx context.Context) *string {
	_, rid := headers(ctx)
	return rid
}

// PortalCheck is the check of a personal link without a command: an unknown token is 404, an expired one is 410.
func (s *Service) PortalCheck(ctx context.Context, token string) error {
	return s.asPortal(ctx, token, false, func(*req, *Request, *Direction) error { return nil })
}
