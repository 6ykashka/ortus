//nolint:dupl // one handler per operation of the generated strict interface: the same shape over the types of each operation
package repairs

import (
	"context"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// The operations of step 6.3 of the tag Repairs (W6.12): the change orders, the measurement, the versions of the
// estimate, the price list, the templates and the code of the signature.

// ListChangeOrders implements rapi.StrictServerInterface.
func (s Server) ListChangeOrders(ctx context.Context, req rapi.ListChangeOrdersRequestObject) (rapi.ListChangeOrdersResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ChangeOrders(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.ListChangeOrdersResponseObject {
		return rapi.ListChangeOrders200JSONResponse{Body: out, Headers: rapi.ListChangeOrders200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListChangeOrders422ApplicationProblemPlusJSONResponse{})
}

// ProposeChangeOrder implements rapi.StrictServerInterface.
func (s Server) ProposeChangeOrder(ctx context.Context, req rapi.ProposeChangeOrderRequestObject) (rapi.ProposeChangeOrderResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ProposeChangeOrder(ctx, tc, req.ProjectId, b)
	return reply(ctx, err, func() rapi.ProposeChangeOrderResponseObject {
		return rapi.ProposeChangeOrder201JSONResponse{Body: out, Headers: rapi.ProposeChangeOrder201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.ProposeChangeOrder422ApplicationProblemPlusJSONResponse{}, rapi.ProposeChangeOrder409ApplicationProblemPlusJSONResponse{})
}

// RejectChangeOrder implements rapi.StrictServerInterface.
func (s Server) RejectChangeOrder(ctx context.Context, req rapi.RejectChangeOrderRequestObject) (rapi.RejectChangeOrderResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.RejectChangeOrder(ctx, tc, req.ChangeOrderId, req.Params.IfMatch, b.Reason)
	return reply(ctx, err, func() rapi.RejectChangeOrderResponseObject {
		return rapi.RejectChangeOrder200JSONResponse{Body: out, Headers: rapi.RejectChangeOrder200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.RejectChangeOrder422ApplicationProblemPlusJSONResponse{}, rapi.RejectChangeOrder409ApplicationProblemPlusJSONResponse{})
}

// GetMeasurement implements rapi.StrictServerInterface.
func (s Server) GetMeasurement(ctx context.Context, req rapi.GetMeasurementRequestObject) (rapi.GetMeasurementResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Measurement(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.GetMeasurementResponseObject {
		return rapi.GetMeasurement200JSONResponse{Body: out, Headers: rapi.GetMeasurement200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	}, rapi.GetMeasurement422ApplicationProblemPlusJSONResponse{})
}

// PutMeasurement implements rapi.StrictServerInterface.
func (s Server) PutMeasurement(ctx context.Context, req rapi.PutMeasurementRequestObject) (rapi.PutMeasurementResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.PutMeasurement(ctx, tc, req.ProjectId, req.Params.IfMatch, b)
	return reply(ctx, err, func() rapi.PutMeasurementResponseObject {
		return rapi.PutMeasurement200JSONResponse{Body: out, Headers: rapi.PutMeasurement200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.PutMeasurement422ApplicationProblemPlusJSONResponse{}, rapi.PutMeasurement409ApplicationProblemPlusJSONResponse{})
}

// ListEstimates implements rapi.StrictServerInterface.
func (s Server) ListEstimates(ctx context.Context, req rapi.ListEstimatesRequestObject) (rapi.ListEstimatesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Estimates(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.ListEstimatesResponseObject {
		return rapi.ListEstimates200JSONResponse{Body: out, Headers: rapi.ListEstimates200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListEstimates422ApplicationProblemPlusJSONResponse{})
}

// GetEstimate implements rapi.StrictServerInterface.
func (s Server) GetEstimate(ctx context.Context, req rapi.GetEstimateRequestObject) (rapi.GetEstimateResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Estimate(ctx, tc, req.ProjectId, req.Version)
	return read(ctx, err, func() rapi.GetEstimateResponseObject {
		return rapi.GetEstimate200JSONResponse{Body: out, Headers: rapi.GetEstimate200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	}, rapi.GetEstimate422ApplicationProblemPlusJSONResponse{})
}

// CreateEstimateFromTemplate implements rapi.StrictServerInterface.
func (s Server) CreateEstimateFromTemplate(ctx context.Context, req rapi.CreateEstimateFromTemplateRequestObject) (rapi.CreateEstimateFromTemplateResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.EstimateFromTemplate(ctx, tc, req.ProjectId, b.TemplateId)
	return reply(ctx, err, func() rapi.CreateEstimateFromTemplateResponseObject {
		return rapi.CreateEstimateFromTemplate201JSONResponse{Body: out, Headers: rapi.CreateEstimateFromTemplate201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.CreateEstimateFromTemplate422ApplicationProblemPlusJSONResponse{}, rapi.CreateEstimateFromTemplate409ApplicationProblemPlusJSONResponse{})
}

// CreateEstimateRevision implements rapi.StrictServerInterface.
func (s Server) CreateEstimateRevision(ctx context.Context, req rapi.CreateEstimateRevisionRequestObject) (rapi.CreateEstimateRevisionResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.EstimateRevision(ctx, tc, req.ProjectId, b)
	return reply(ctx, err, func() rapi.CreateEstimateRevisionResponseObject {
		return rapi.CreateEstimateRevision201JSONResponse{Body: out, Headers: rapi.CreateEstimateRevision201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.CreateEstimateRevision422ApplicationProblemPlusJSONResponse{}, rapi.CreateEstimateRevision409ApplicationProblemPlusJSONResponse{})
}

// UpdateEstimateDraft implements rapi.StrictServerInterface.
func (s Server) UpdateEstimateDraft(ctx context.Context, req rapi.UpdateEstimateDraftRequestObject) (rapi.UpdateEstimateDraftResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.PatchEstimate(ctx, tc, req.ProjectId, req.Version, req.Params.IfMatch, b)
	return reply(ctx, err, func() rapi.UpdateEstimateDraftResponseObject {
		return rapi.UpdateEstimateDraft200JSONResponse{Body: out, Headers: rapi.UpdateEstimateDraft200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.UpdateEstimateDraft422ApplicationProblemPlusJSONResponse{}, rapi.UpdateEstimateDraft409ApplicationProblemPlusJSONResponse{})
}

// SendEstimate implements rapi.StrictServerInterface.
func (s Server) SendEstimate(ctx context.Context, req rapi.SendEstimateRequestObject) (rapi.SendEstimateResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.SendEstimate(ctx, tc, req.ProjectId, req.Version, req.Params.IfMatch)
	return reply(ctx, err, func() rapi.SendEstimateResponseObject {
		return rapi.SendEstimate200JSONResponse{Body: out, Headers: rapi.SendEstimate200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.SendEstimate422ApplicationProblemPlusJSONResponse{}, rapi.SendEstimate409ApplicationProblemPlusJSONResponse{})
}

// RecallEstimate implements rapi.StrictServerInterface.
func (s Server) RecallEstimate(ctx context.Context, req rapi.RecallEstimateRequestObject) (rapi.RecallEstimateResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.RecallEstimate(ctx, tc, req.ProjectId, req.Version, req.Params.IfMatch)
	return reply(ctx, err, func() rapi.RecallEstimateResponseObject {
		return rapi.RecallEstimate200JSONResponse{Body: out, Headers: rapi.RecallEstimate200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.RecallEstimate422ApplicationProblemPlusJSONResponse{}, rapi.RecallEstimate409ApplicationProblemPlusJSONResponse{})
}

// DeleteEstimateDraft implements rapi.StrictServerInterface.
func (s Server) DeleteEstimateDraft(ctx context.Context, req rapi.DeleteEstimateDraftRequestObject) (rapi.DeleteEstimateDraftResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	err = s.S.DeleteEstimate(ctx, tc, req.ProjectId, req.Version, req.Params.IfMatch)
	return reply(ctx, err, func() rapi.DeleteEstimateDraftResponseObject {
		return rapi.DeleteEstimateDraft204Response{Headers: rapi.DeleteEstimateDraft204ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.DeleteEstimateDraft422ApplicationProblemPlusJSONResponse{}, rapi.DeleteEstimateDraft409ApplicationProblemPlusJSONResponse{})
}

// DiffEstimates implements rapi.StrictServerInterface.
func (s Server) DiffEstimates(ctx context.Context, req rapi.DiffEstimatesRequestObject) (rapi.DiffEstimatesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.DiffEstimates(ctx, tc, req.ProjectId, req.Version, req.Params.To)
	return read(ctx, err, func() rapi.DiffEstimatesResponseObject {
		return rapi.DiffEstimates200JSONResponse{Body: out, Headers: rapi.DiffEstimates200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.DiffEstimates422ApplicationProblemPlusJSONResponse{})
}

// templateName is the name asked for a copy: the body of copyTemplate and saveProjectAsTemplate may be empty.
func templateName(b *rapi.TemplateCopy) *string {
	if b == nil {
		return nil
	}
	return b.Name
}

// SaveProjectAsTemplate implements rapi.StrictServerInterface.
func (s Server) SaveProjectAsTemplate(ctx context.Context, req rapi.SaveProjectAsTemplateRequestObject) (rapi.SaveProjectAsTemplateResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.SaveProjectAsTemplate(ctx, tc, req.ProjectId, templateName(req.Body))
	return reply(ctx, err, func() rapi.SaveProjectAsTemplateResponseObject {
		return rapi.SaveProjectAsTemplate201JSONResponse{Body: out, Headers: rapi.SaveProjectAsTemplate201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.SaveProjectAsTemplate422ApplicationProblemPlusJSONResponse{}, rapi.SaveProjectAsTemplate409ApplicationProblemPlusJSONResponse{})
}

// ListPriceItems implements rapi.StrictServerInterface.
func (s Server) ListPriceItems(ctx context.Context, req rapi.ListPriceItemsRequestObject) (rapi.ListPriceItemsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	p := req.Params
	q := PriceQuery{Q: p.Q, Cursor: p.Cursor, Limit: p.Limit}
	if p.Kind != nil {
		q.Kind = new(string(*p.Kind))
	}
	out, err := s.S.PriceItems(ctx, tc, q)
	return read(ctx, err, func() rapi.ListPriceItemsResponseObject {
		return rapi.ListPriceItems200JSONResponse{Body: out, Headers: rapi.ListPriceItems200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListPriceItems422ApplicationProblemPlusJSONResponse{})
}

// CreatePriceItem implements rapi.StrictServerInterface.
func (s Server) CreatePriceItem(ctx context.Context, req rapi.CreatePriceItemRequestObject) (rapi.CreatePriceItemResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreatePriceItem(ctx, tc, b)
	return reply(ctx, err, func() rapi.CreatePriceItemResponseObject {
		return rapi.CreatePriceItem201JSONResponse{Body: out, Headers: rapi.CreatePriceItem201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.CreatePriceItem422ApplicationProblemPlusJSONResponse{}, rapi.CreatePriceItem409ApplicationProblemPlusJSONResponse{})
}

// UpdatePriceItem implements rapi.StrictServerInterface.
func (s Server) UpdatePriceItem(ctx context.Context, req rapi.UpdatePriceItemRequestObject) (rapi.UpdatePriceItemResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.UpdatePriceItem(ctx, tc, req.PriceItemId, req.Params.IfMatch, b)
	return reply(ctx, err, func() rapi.UpdatePriceItemResponseObject {
		return rapi.UpdatePriceItem200JSONResponse{Body: out, Headers: rapi.UpdatePriceItem200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.UpdatePriceItem422ApplicationProblemPlusJSONResponse{}, rapi.UpdatePriceItem409ApplicationProblemPlusJSONResponse{})
}

// ListTemplates implements rapi.StrictServerInterface.
func (s Server) ListTemplates(ctx context.Context, _ rapi.ListTemplatesRequestObject) (rapi.ListTemplatesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Templates(ctx, tc)
	return read(ctx, err, func() rapi.ListTemplatesResponseObject {
		return rapi.ListTemplates200JSONResponse{Body: out, Headers: rapi.ListTemplates200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListTemplates422ApplicationProblemPlusJSONResponse{})
}

// GetTemplate implements rapi.StrictServerInterface.
func (s Server) GetTemplate(ctx context.Context, req rapi.GetTemplateRequestObject) (rapi.GetTemplateResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Template(ctx, tc, req.TemplateId)
	return read(ctx, err, func() rapi.GetTemplateResponseObject {
		return rapi.GetTemplate200JSONResponse{Body: out, Headers: rapi.GetTemplate200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	}, rapi.GetTemplate422ApplicationProblemPlusJSONResponse{})
}

// UpdateTemplate implements rapi.StrictServerInterface.
func (s Server) UpdateTemplate(ctx context.Context, req rapi.UpdateTemplateRequestObject) (rapi.UpdateTemplateResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.UpdateTemplate(ctx, tc, req.TemplateId, req.Params.IfMatch, b)
	return reply(ctx, err, func() rapi.UpdateTemplateResponseObject {
		return rapi.UpdateTemplate200JSONResponse{Body: out, Headers: rapi.UpdateTemplate200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.UpdateTemplate422ApplicationProblemPlusJSONResponse{}, rapi.UpdateTemplate409ApplicationProblemPlusJSONResponse{})
}

// CopyTemplate implements rapi.StrictServerInterface.
func (s Server) CopyTemplate(ctx context.Context, req rapi.CopyTemplateRequestObject) (rapi.CopyTemplateResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CopyTemplate(ctx, tc, req.TemplateId, templateName(req.Body))
	return reply(ctx, err, func() rapi.CopyTemplateResponseObject {
		return rapi.CopyTemplate201JSONResponse{Body: out, Headers: rapi.CopyTemplate201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.CopyTemplate422ApplicationProblemPlusJSONResponse{}, rapi.CopyTemplate409ApplicationProblemPlusJSONResponse{})
}

// RequestDocumentSignature implements rapi.StrictServerInterface.
func (s Server) RequestDocumentSignature(ctx context.Context, req rapi.RequestDocumentSignatureRequestObject) (rapi.RequestDocumentSignatureResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.RequestSignature(ctx, tc, req.DocumentId)
	return reply(ctx, err, func() rapi.RequestDocumentSignatureResponseObject {
		return rapi.RequestDocumentSignature201JSONResponse{Body: out, Headers: rapi.RequestDocumentSignature201ResponseHeaders{CacheControl: cache(),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.RequestDocumentSignature422ApplicationProblemPlusJSONResponse{}, rapi.RequestDocumentSignature409ApplicationProblemPlusJSONResponse{})
}
