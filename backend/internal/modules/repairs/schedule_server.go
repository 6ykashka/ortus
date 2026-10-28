//nolint:dupl // one handler per operation of the generated strict interface: the same shape over the types of each operation
package repairs

import (
	"context"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// ScheduleServer answers the operations of step 6.5 of the tag Repairs over the service: the schedule of an object, its
// forecast and critical path, the move with a reason, the executor of a stage and the baseline (W6.14). It is embedded in
// the server of the tag next to Server (cmd/api/repairs.go); the answers follow the rules of Server (server.go).
type ScheduleServer struct{ S *Service }

// GetSchedule implements rapi.StrictServerInterface.
func (s ScheduleServer) GetSchedule(ctx context.Context, req rapi.GetScheduleRequestObject) (rapi.GetScheduleResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Schedule(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.GetScheduleResponseObject {
		return rapi.GetSchedule200JSONResponse{Body: out, Headers: rapi.GetSchedule200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	}, rapi.GetSchedule422ApplicationProblemPlusJSONResponse{})
}

// CreateScheduleFromEstimate implements rapi.StrictServerInterface.
func (s ScheduleServer) CreateScheduleFromEstimate(ctx context.Context, req rapi.CreateScheduleFromEstimateRequestObject) (rapi.CreateScheduleFromEstimateResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreateSchedule(ctx, tc, req.ProjectId, b.EstimateVersion)
	return reply(ctx, err, func() rapi.CreateScheduleFromEstimateResponseObject {
		return rapi.CreateScheduleFromEstimate201JSONResponse{Body: out, Headers: rapi.CreateScheduleFromEstimate201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.CreateScheduleFromEstimate422ApplicationProblemPlusJSONResponse{}, rapi.CreateScheduleFromEstimate409ApplicationProblemPlusJSONResponse{})
}

// PreviewScheduleChange implements rapi.StrictServerInterface.
func (s ScheduleServer) PreviewScheduleChange(ctx context.Context, req rapi.PreviewScheduleChangeRequestObject) (rapi.PreviewScheduleChangeResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.PreviewSchedule(ctx, tc, req.ProjectId, b.Changes)
	return reply(ctx, err, func() rapi.PreviewScheduleChangeResponseObject {
		return rapi.PreviewScheduleChange200JSONResponse{Body: out, Headers: rapi.PreviewScheduleChange200ResponseHeaders{CacheControl: cache(),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.PreviewScheduleChange422ApplicationProblemPlusJSONResponse{}, rapi.PreviewScheduleChange409ApplicationProblemPlusJSONResponse{})
}

// ApplyScheduleChange implements rapi.StrictServerInterface.
func (s ScheduleServer) ApplyScheduleChange(ctx context.Context, req rapi.ApplyScheduleChangeRequestObject) (rapi.ApplyScheduleChangeResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ApplySchedule(ctx, tc, req.ProjectId, req.Params.IfMatch, b)
	return reply(ctx, err, func() rapi.ApplyScheduleChangeResponseObject {
		return rapi.ApplyScheduleChange200JSONResponse{Body: out, Headers: rapi.ApplyScheduleChange200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.ApplyScheduleChange422ApplicationProblemPlusJSONResponse{}, rapi.ApplyScheduleChange409ApplicationProblemPlusJSONResponse{})
}

// SetScheduleStageExecutor implements rapi.StrictServerInterface.
func (s ScheduleServer) SetScheduleStageExecutor(ctx context.Context, req rapi.SetScheduleStageExecutorRequestObject) (rapi.SetScheduleStageExecutorResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.SetStageExecutor(ctx, tc, req.ProjectId, req.StageId, req.Params.IfMatch, b)
	return reply(ctx, err, func() rapi.SetScheduleStageExecutorResponseObject {
		return rapi.SetScheduleStageExecutor200JSONResponse{Body: out, Headers: rapi.SetScheduleStageExecutor200ResponseHeaders{CacheControl: cache(),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.SetScheduleStageExecutor422ApplicationProblemPlusJSONResponse{}, rapi.SetScheduleStageExecutor409ApplicationProblemPlusJSONResponse{})
}

// CreateScheduleBaseline implements rapi.StrictServerInterface.
func (s ScheduleServer) CreateScheduleBaseline(ctx context.Context, req rapi.CreateScheduleBaselineRequestObject) (rapi.CreateScheduleBaselineResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreateBaseline(ctx, tc, req.ProjectId, req.Params.IfMatch, b.AgreementNo)
	return reply(ctx, err, func() rapi.CreateScheduleBaselineResponseObject {
		return rapi.CreateScheduleBaseline201JSONResponse{Body: out, Headers: rapi.CreateScheduleBaseline201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.CreateScheduleBaseline422ApplicationProblemPlusJSONResponse{}, rapi.CreateScheduleBaseline409ApplicationProblemPlusJSONResponse{})
}
