//nolint:dupl // one handler per operation of the generated strict interface: the same shape over the types of each operation
package tasks

import (
	"context"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// noStore is Cache-Control of every answer (the contract: «private, no-store»).
const noStore = "private, no-store"

// Server implements tasksapi.StrictServerInterface over the service. A failure (a 422 with violations, a 409 with a
// reason) is the typed answer of the operation; any other error goes to problem.Write.
type Server struct{ S *Service }

var _ tasksapi.StrictServerInterface = Server{}

// in is the tenant of the request and its body (a missing body is malformed_request).
func in[T any](ctx context.Context, b *T) (tenantctx.TenantContext, T, error) {
	var zero T
	tc, ok := tenantctx.FromContext(ctx)
	switch {
	case !ok:
		return tc, zero, problem.New(codeNotFound, "")
	case b == nil:
		return tc, zero, problem.New(codeMalformed, "")
	}
	return tc, *b, nil
}

// tenant is the tenant of a request without a body.
func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, _, err := in(ctx, &struct{}{})
	return tc, err
}

func cache() *string { return new(noStore) }

func rid(ctx context.Context) *string { return new(requestid.FromContext(ctx)) }

func notReplayed() *bool { return new(false) }

func tagOf(revision int64) *string { return new(etag(revision)) }

// body is the Problem of a failure with its reason and violations.
func body(ctx context.Context, f *failure) tasksapi.Problem {
	p := catalog.Problems[f.code]
	out := tasksapi.Problem{Type: problem.TypeBase + f.code, Title: p.Title, Status: int64(p.Status),
		Code: tasksapi.ProblemCode(f.code), Detail: new(f.detail), RequestId: requestid.FromContext(ctx)}
	if f.reason != "" {
		out.Reason = new(f.reason)
	}
	if len(f.violations) > 0 {
		out.Violations = new(f.violations)
	}
	return out
}

// invalidOf and conflictOf are the 422 and 409 answers of an operation (the generated types embed the shared ones).
type (
	invalidOf interface {
		~struct {
			tasksapi.ValidationApplicationProblemPlusJSONResponse
		}
	}
	conflictOf interface {
		~struct {
			tasksapi.ConflictApplicationProblemPlusJSONResponse
		}
	}
)

// answerOf converts an answer to the response object R of its operation.
func answerOf[R any](v any) R {
	r, ok := v.(R)
	if !ok {
		panic("tasks: an answer of another operation") // the types of the call site are wrong: a programming error
	}
	return r
}

// reply is the answer of a command: ok when err is nil, the typed 422 (V) or 409 (C) of a failure, err otherwise.
func reply[R any, V invalidOf, C conflictOf](ctx context.Context, err error, ok R, _ V, _ C) (R, error) {
	f, failed := asFailure(err)
	switch {
	case failed && f.code == codeValidation:
		return answerOf[R](V{tasksapi.ValidationApplicationProblemPlusJSONResponse{Body: body(ctx, f),
			Headers: tasksapi.ValidationResponseHeaders{XRequestId: rid(ctx)}}}), nil
	case failed:
		return answerOf[R](C{tasksapi.ConflictApplicationProblemPlusJSONResponse{Body: body(ctx, f),
			Headers: tasksapi.ConflictResponseHeaders{XRequestId: rid(ctx)}}}), nil
	case err != nil:
		var zero R
		return zero, err
	}
	return ok, nil
}

// read is the answer of a read: ok, the typed 422 (V) of any failure or err.
func read[R any, V invalidOf](ctx context.Context, err error, ok R, _ V) (R, error) {
	if f, failed := asFailure(err); failed {
		return answerOf[R](V{tasksapi.ValidationApplicationProblemPlusJSONResponse{Body: body(ctx, f),
			Headers: tasksapi.ValidationResponseHeaders{XRequestId: rid(ctx)}}}), nil
	}
	if err != nil {
		var zero R
		return zero, err
	}
	return ok, nil
}

// ListTaskProjects implements tasksapi.StrictServerInterface.
func (s Server) ListTaskProjects(ctx context.Context, req tasksapi.ListTaskProjectsRequestObject) (tasksapi.ListTaskProjectsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	page, err := s.S.Projects(ctx, tc, req.Params.Cursor, req.Params.Limit)
	var ok tasksapi.ListTaskProjectsResponseObject = tasksapi.ListTaskProjects200JSONResponse{Body: page,
		Headers: tasksapi.ListTaskProjects200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	return read(ctx, err, ok, tasksapi.ListTaskProjects422ApplicationProblemPlusJSONResponse{})
}

// CreateTaskProject implements tasksapi.StrictServerInterface.
func (s Server) CreateTaskProject(ctx context.Context, req tasksapi.CreateTaskProjectRequestObject) (tasksapi.CreateTaskProjectResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreateProject(ctx, tc, b)
	var ok tasksapi.CreateTaskProjectResponseObject = tasksapi.CreateTaskProject201JSONResponse{Body: out, Headers: tasksapi.CreateTaskProject201ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.CreateTaskProject422ApplicationProblemPlusJSONResponse{}, tasksapi.CreateTaskProject409ApplicationProblemPlusJSONResponse{})
}

// GetTaskProject implements tasksapi.StrictServerInterface.
func (s Server) GetTaskProject(ctx context.Context, req tasksapi.GetTaskProjectRequestObject) (tasksapi.GetTaskProjectResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Project(ctx, tc, req.ProjectId)
	var ok tasksapi.GetTaskProjectResponseObject = tasksapi.GetTaskProject200JSONResponse{Body: out,
		Headers: tasksapi.GetTaskProject200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	return read(ctx, err, ok, tasksapi.GetTaskProject422ApplicationProblemPlusJSONResponse{})
}

// UpdateTaskProject implements tasksapi.StrictServerInterface.
func (s Server) UpdateTaskProject(ctx context.Context, req tasksapi.UpdateTaskProjectRequestObject) (tasksapi.UpdateTaskProjectResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.UpdateProject(ctx, tc, req.ProjectId, req.Params.IfMatch, b)
	var ok tasksapi.UpdateTaskProjectResponseObject = tasksapi.UpdateTaskProject200JSONResponse{Body: out, Headers: tasksapi.UpdateTaskProject200ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.UpdateTaskProject422ApplicationProblemPlusJSONResponse{}, tasksapi.UpdateTaskProject409ApplicationProblemPlusJSONResponse{})
}

// InitTaskProjectWorkflow implements tasksapi.StrictServerInterface.
func (s Server) InitTaskProjectWorkflow(ctx context.Context, req tasksapi.InitTaskProjectWorkflowRequestObject) (tasksapi.InitTaskProjectWorkflowResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.InitWorkflow(ctx, tc, req.ProjectId)
	var ok tasksapi.InitTaskProjectWorkflowResponseObject = tasksapi.InitTaskProjectWorkflow200JSONResponse{Body: out,
		Headers: tasksapi.InitTaskProjectWorkflow200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.InitTaskProjectWorkflow422ApplicationProblemPlusJSONResponse{},
		tasksapi.InitTaskProjectWorkflow409ApplicationProblemPlusJSONResponse{})
}

// GetTaskWorkflow implements tasksapi.StrictServerInterface.
func (s Server) GetTaskWorkflow(ctx context.Context, req tasksapi.GetTaskWorkflowRequestObject) (tasksapi.GetTaskWorkflowResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Workflow(ctx, tc, req.ProjectId)
	var ok tasksapi.GetTaskWorkflowResponseObject = tasksapi.GetTaskWorkflow200JSONResponse{Body: out,
		Headers: tasksapi.GetTaskWorkflow200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	return read(ctx, err, ok, tasksapi.GetTaskWorkflow422ApplicationProblemPlusJSONResponse{})
}

// SaveTaskWorkflowDraft implements tasksapi.StrictServerInterface.
func (s Server) SaveTaskWorkflowDraft(ctx context.Context, req tasksapi.SaveTaskWorkflowDraftRequestObject) (tasksapi.SaveTaskWorkflowDraftResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.SaveDraft(ctx, tc, req.ProjectId, req.Params.IfMatch, b)
	var ok tasksapi.SaveTaskWorkflowDraftResponseObject = tasksapi.SaveTaskWorkflowDraft200JSONResponse{Body: out,
		Headers: tasksapi.SaveTaskWorkflowDraft200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.SaveTaskWorkflowDraft422ApplicationProblemPlusJSONResponse{},
		tasksapi.SaveTaskWorkflowDraft409ApplicationProblemPlusJSONResponse{})
}

// DiscardTaskWorkflowDraft implements tasksapi.StrictServerInterface.
func (s Server) DiscardTaskWorkflowDraft(ctx context.Context, req tasksapi.DiscardTaskWorkflowDraftRequestObject) (tasksapi.DiscardTaskWorkflowDraftResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.DiscardDraft(ctx, tc, req.ProjectId, req.Params.IfMatch)
	var ok tasksapi.DiscardTaskWorkflowDraftResponseObject = tasksapi.DiscardTaskWorkflowDraft200JSONResponse{Body: out,
		Headers: tasksapi.DiscardTaskWorkflowDraft200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.DiscardTaskWorkflowDraft422ApplicationProblemPlusJSONResponse{},
		tasksapi.DiscardTaskWorkflowDraft409ApplicationProblemPlusJSONResponse{})
}

// PublishTaskWorkflow implements tasksapi.StrictServerInterface.
func (s Server) PublishTaskWorkflow(ctx context.Context, req tasksapi.PublishTaskWorkflowRequestObject) (tasksapi.PublishTaskWorkflowResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Publish(ctx, tc, req.ProjectId, req.Params.IfMatch)
	var ok tasksapi.PublishTaskWorkflowResponseObject = tasksapi.PublishTaskWorkflow200JSONResponse{Body: out,
		Headers: tasksapi.PublishTaskWorkflow200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.PublishTaskWorkflow422ApplicationProblemPlusJSONResponse{},
		tasksapi.PublishTaskWorkflow409ApplicationProblemPlusJSONResponse{})
}

// ListTaskProjectMembers implements tasksapi.StrictServerInterface.
func (s Server) ListTaskProjectMembers(ctx context.Context, req tasksapi.ListTaskProjectMembersRequestObject) (tasksapi.ListTaskProjectMembersResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Members(ctx, tc, req.ProjectId)
	var ok tasksapi.ListTaskProjectMembersResponseObject = tasksapi.ListTaskProjectMembers200JSONResponse{Body: out,
		Headers: tasksapi.ListTaskProjectMembers200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	return read(ctx, err, ok, tasksapi.ListTaskProjectMembers422ApplicationProblemPlusJSONResponse{})
}

// SetTaskProjectMemberRole implements tasksapi.StrictServerInterface.
func (s Server) SetTaskProjectMemberRole(ctx context.Context, req tasksapi.SetTaskProjectMemberRoleRequestObject) (tasksapi.SetTaskProjectMemberRoleResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.SetMemberRole(ctx, tc, req.ProjectId, req.MemberId, b)
	var ok tasksapi.SetTaskProjectMemberRoleResponseObject = tasksapi.SetTaskProjectMemberRole200JSONResponse{Body: out,
		Headers: tasksapi.SetTaskProjectMemberRole200ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.SetTaskProjectMemberRole422ApplicationProblemPlusJSONResponse{},
		tasksapi.SetTaskProjectMemberRole409ApplicationProblemPlusJSONResponse{})
}

// RemoveTaskProjectMember implements tasksapi.StrictServerInterface.
func (s Server) RemoveTaskProjectMember(ctx context.Context, req tasksapi.RemoveTaskProjectMemberRequestObject) (tasksapi.RemoveTaskProjectMemberResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	err = s.S.RemoveMember(ctx, tc, req.ProjectId, req.MemberId)
	var ok tasksapi.RemoveTaskProjectMemberResponseObject = tasksapi.RemoveTaskProjectMember204Response{
		Headers: tasksapi.RemoveTaskProjectMember204ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.RemoveTaskProjectMember422ApplicationProblemPlusJSONResponse{},
		tasksapi.RemoveTaskProjectMember409ApplicationProblemPlusJSONResponse{})
}

// CheckTaskProjectAccess implements tasksapi.StrictServerInterface.
func (s Server) CheckTaskProjectAccess(ctx context.Context, req tasksapi.CheckTaskProjectAccessRequestObject) (tasksapi.CheckTaskProjectAccessResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CheckAccess(ctx, tc, req.ProjectId, req.MemberId, string(req.Params.Action))
	var ok tasksapi.CheckTaskProjectAccessResponseObject = tasksapi.CheckTaskProjectAccess200JSONResponse{Body: out,
		Headers: tasksapi.CheckTaskProjectAccess200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	return read(ctx, err, ok, tasksapi.CheckTaskProjectAccess422ApplicationProblemPlusJSONResponse{})
}

// ListTaskAutomations implements tasksapi.StrictServerInterface.
func (s Server) ListTaskAutomations(ctx context.Context, req tasksapi.ListTaskAutomationsRequestObject) (tasksapi.ListTaskAutomationsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Automations(ctx, tc, req.ProjectId)
	var ok tasksapi.ListTaskAutomationsResponseObject = tasksapi.ListTaskAutomations200JSONResponse{Body: out,
		Headers: tasksapi.ListTaskAutomations200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	return read(ctx, err, ok, tasksapi.ListTaskAutomations422ApplicationProblemPlusJSONResponse{})
}

// CreateTaskAutomation implements tasksapi.StrictServerInterface.
func (s Server) CreateTaskAutomation(ctx context.Context, req tasksapi.CreateTaskAutomationRequestObject) (tasksapi.CreateTaskAutomationResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreateAutomation(ctx, tc, req.ProjectId, b)
	var ok tasksapi.CreateTaskAutomationResponseObject = tasksapi.CreateTaskAutomation201JSONResponse{Body: out,
		Headers: tasksapi.CreateTaskAutomation201ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.CreateTaskAutomation422ApplicationProblemPlusJSONResponse{},
		tasksapi.CreateTaskAutomation409ApplicationProblemPlusJSONResponse{})
}

// UpdateTaskAutomation implements tasksapi.StrictServerInterface.
func (s Server) UpdateTaskAutomation(ctx context.Context, req tasksapi.UpdateTaskAutomationRequestObject) (tasksapi.UpdateTaskAutomationResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.UpdateAutomation(ctx, tc, req.ProjectId, req.AutomationId, req.Params.IfMatch, b)
	var ok tasksapi.UpdateTaskAutomationResponseObject = tasksapi.UpdateTaskAutomation200JSONResponse{Body: out,
		Headers: tasksapi.UpdateTaskAutomation200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.UpdateTaskAutomation422ApplicationProblemPlusJSONResponse{},
		tasksapi.UpdateTaskAutomation409ApplicationProblemPlusJSONResponse{})
}

// DeleteTaskAutomation implements tasksapi.StrictServerInterface.
func (s Server) DeleteTaskAutomation(ctx context.Context, req tasksapi.DeleteTaskAutomationRequestObject) (tasksapi.DeleteTaskAutomationResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	err = s.S.DeleteAutomation(ctx, tc, req.ProjectId, req.AutomationId, req.Params.IfMatch)
	var ok tasksapi.DeleteTaskAutomationResponseObject = tasksapi.DeleteTaskAutomation204Response{
		Headers: tasksapi.DeleteTaskAutomation204ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.DeleteTaskAutomation422ApplicationProblemPlusJSONResponse{},
		tasksapi.DeleteTaskAutomation409ApplicationProblemPlusJSONResponse{})
}

// ListTaskAutomationRuns implements tasksapi.StrictServerInterface.
func (s Server) ListTaskAutomationRuns(ctx context.Context, req tasksapi.ListTaskAutomationRunsRequestObject) (tasksapi.ListTaskAutomationRunsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Runs(ctx, tc, req.ProjectId)
	var ok tasksapi.ListTaskAutomationRunsResponseObject = tasksapi.ListTaskAutomationRuns200JSONResponse{Body: out,
		Headers: tasksapi.ListTaskAutomationRuns200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	return read(ctx, err, ok, tasksapi.ListTaskAutomationRuns422ApplicationProblemPlusJSONResponse{})
}

// ListTasks implements tasksapi.StrictServerInterface.
func (s Server) ListTasks(ctx context.Context, req tasksapi.ListTasksRequestObject) (tasksapi.ListTasksResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	p := req.Params
	if p.Assignee != nil && *p.Assignee != tasksapi.Me {
		return nil, problem.New(codeMalformed, "assignee — только me.")
	}
	page, err := s.S.Tasks(ctx, tc, TaskQuery{Project: p.ProjectId, Parent: p.ParentTaskId, Cursor: p.Cursor, Limit: p.Limit,
		Mine: p.Assignee != nil, Awaiting: p.AwaitingMyApproval != nil && *p.AwaitingMyApproval})
	var ok tasksapi.ListTasksResponseObject = tasksapi.ListTasks200JSONResponse{Body: page,
		Headers: tasksapi.ListTasks200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	return read(ctx, err, ok, tasksapi.ListTasks422ApplicationProblemPlusJSONResponse{})
}

// CreateTask implements tasksapi.StrictServerInterface.
func (s Server) CreateTask(ctx context.Context, req tasksapi.CreateTaskRequestObject) (tasksapi.CreateTaskResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreateTask(ctx, tc, b)
	var ok tasksapi.CreateTaskResponseObject = tasksapi.CreateTask201JSONResponse{Body: out, Headers: tasksapi.CreateTask201ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.CreateTask422ApplicationProblemPlusJSONResponse{}, tasksapi.CreateTask409ApplicationProblemPlusJSONResponse{})
}

// GetTask implements tasksapi.StrictServerInterface.
func (s Server) GetTask(ctx context.Context, req tasksapi.GetTaskRequestObject) (tasksapi.GetTaskResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Task(ctx, tc, req.TaskId)
	var ok tasksapi.GetTaskResponseObject = tasksapi.GetTask200JSONResponse{Body: out,
		Headers: tasksapi.GetTask200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	return read(ctx, err, ok, tasksapi.GetTask422ApplicationProblemPlusJSONResponse{})
}

// UpdateTask implements tasksapi.StrictServerInterface.
func (s Server) UpdateTask(ctx context.Context, req tasksapi.UpdateTaskRequestObject) (tasksapi.UpdateTaskResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.UpdateTask(ctx, tc, req.TaskId, req.Params.IfMatch, b)
	var ok tasksapi.UpdateTaskResponseObject = tasksapi.UpdateTask200JSONResponse{Body: out, Headers: tasksapi.UpdateTask200ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.UpdateTask422ApplicationProblemPlusJSONResponse{}, tasksapi.UpdateTask409ApplicationProblemPlusJSONResponse{})
}

// TransitionTask implements tasksapi.StrictServerInterface.
func (s Server) TransitionTask(ctx context.Context, req tasksapi.TransitionTaskRequestObject) (tasksapi.TransitionTaskResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Transition(ctx, tc, req.TaskId, req.Params.IfMatch, b)
	var ok tasksapi.TransitionTaskResponseObject = tasksapi.TransitionTask200JSONResponse{Body: out,
		Headers: tasksapi.TransitionTask200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.TransitionTask422ApplicationProblemPlusJSONResponse{},
		tasksapi.TransitionTask409ApplicationProblemPlusJSONResponse{})
}

// RejectTaskApproval implements tasksapi.StrictServerInterface.
func (s Server) RejectTaskApproval(ctx context.Context, req tasksapi.RejectTaskApprovalRequestObject) (tasksapi.RejectTaskApprovalResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Reject(ctx, tc, req.TaskId, req.TransitionKey, req.Params.IfMatch, b)
	var ok tasksapi.RejectTaskApprovalResponseObject = tasksapi.RejectTaskApproval200JSONResponse{Body: out,
		Headers: tasksapi.RejectTaskApproval200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.RejectTaskApproval422ApplicationProblemPlusJSONResponse{},
		tasksapi.RejectTaskApproval409ApplicationProblemPlusJSONResponse{})
}

// UpdateTaskChecklistItem implements tasksapi.StrictServerInterface.
func (s Server) UpdateTaskChecklistItem(ctx context.Context, req tasksapi.UpdateTaskChecklistItemRequestObject) (tasksapi.UpdateTaskChecklistItemResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Checklist(ctx, tc, req.TaskId, req.ChecklistItemId, req.Params.IfMatch, b)
	var ok tasksapi.UpdateTaskChecklistItemResponseObject = tasksapi.UpdateTaskChecklistItem200JSONResponse{Body: out,
		Headers: tasksapi.UpdateTaskChecklistItem200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.UpdateTaskChecklistItem422ApplicationProblemPlusJSONResponse{},
		tasksapi.UpdateTaskChecklistItem409ApplicationProblemPlusJSONResponse{})
}

// SetTaskParent implements tasksapi.StrictServerInterface.
func (s Server) SetTaskParent(ctx context.Context, req tasksapi.SetTaskParentRequestObject) (tasksapi.SetTaskParentResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.SetParent(ctx, tc, req.TaskId, req.Params.IfMatch, b)
	var ok tasksapi.SetTaskParentResponseObject = tasksapi.SetTaskParent200JSONResponse{Body: out,
		Headers: tasksapi.SetTaskParent200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.SetTaskParent422ApplicationProblemPlusJSONResponse{},
		tasksapi.SetTaskParent409ApplicationProblemPlusJSONResponse{})
}

// AttachTaskFiles implements tasksapi.StrictServerInterface.
func (s Server) AttachTaskFiles(ctx context.Context, req tasksapi.AttachTaskFilesRequestObject) (tasksapi.AttachTaskFilesResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.AttachFiles(ctx, tc, req.TaskId, req.Params.IfMatch, b)
	var ok tasksapi.AttachTaskFilesResponseObject = tasksapi.AttachTaskFiles200JSONResponse{Body: out,
		Headers: tasksapi.AttachTaskFiles200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.AttachTaskFiles422ApplicationProblemPlusJSONResponse{},
		tasksapi.AttachTaskFiles409ApplicationProblemPlusJSONResponse{})
}

// RemoveTaskFile implements tasksapi.StrictServerInterface.
func (s Server) RemoveTaskFile(ctx context.Context, req tasksapi.RemoveTaskFileRequestObject) (tasksapi.RemoveTaskFileResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.RemoveFile(ctx, tc, req.TaskId, req.FileId, req.Params.IfMatch)
	var ok tasksapi.RemoveTaskFileResponseObject = tasksapi.RemoveTaskFile200JSONResponse{Body: out,
		Headers: tasksapi.RemoveTaskFile200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.RemoveTaskFile422ApplicationProblemPlusJSONResponse{},
		tasksapi.RemoveTaskFile409ApplicationProblemPlusJSONResponse{})
}

// CommentTask implements tasksapi.StrictServerInterface.
func (s Server) CommentTask(ctx context.Context, req tasksapi.CommentTaskRequestObject) (tasksapi.CommentTaskResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Comment(ctx, tc, req.TaskId, b)
	var ok tasksapi.CommentTaskResponseObject = tasksapi.CommentTask201JSONResponse{Body: out,
		Headers: tasksapi.CommentTask201ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, tasksapi.CommentTask422ApplicationProblemPlusJSONResponse{}, tasksapi.CommentTask409ApplicationProblemPlusJSONResponse{})
}

// ListTaskHistory implements tasksapi.StrictServerInterface.
func (s Server) ListTaskHistory(ctx context.Context, req tasksapi.ListTaskHistoryRequestObject) (tasksapi.ListTaskHistoryResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	page, err := s.S.History(ctx, tc, req.TaskId, req.Params.Cursor, req.Params.Limit)
	var ok tasksapi.ListTaskHistoryResponseObject = tasksapi.ListTaskHistory200JSONResponse{Body: page,
		Headers: tasksapi.ListTaskHistory200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	return read(ctx, err, ok, tasksapi.ListTaskHistory422ApplicationProblemPlusJSONResponse{})
}
