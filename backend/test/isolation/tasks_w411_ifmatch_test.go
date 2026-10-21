//go:build isolation

package isolation

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/test/isolation/matrix"
)

// staleRevision is an If-Match no revision of «Задач и проектов» has: a row that reached the comparison would answer
// 412, so every row below answers for its object first (404), as the handlers of W4.11 do; the one exception is the
// attachment of a visible task in removeTaskFile, compared after If-Match as in MSW (Q-W4.11-7).
const staleRevision = `"rev-999999"`

// withTasksIfMatch adds what the rows of tasks_w403.yaml cannot carry to every command of the tag Tasks: If-Match
// (the matrix format has no headers, README.md). Without it the strict server answers 428 before the handler.
func withTasksIfMatch(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && (strings.Contains(r.URL.Path, "/tasks/") || strings.Contains(r.URL.Path, "/projects/")) {
			r.Header.Set("If-Match", staleRevision)
		}
		h.ServeHTTP(w, r)
	})
}

// Bodies of the commands with If-Match.
const (
	bodyAccess   = `{"access":"open"}`
	bodyDraft    = `{"statuses":[{"id":"s1","name":"Новая","category":"todo"}],"transitions":[]}`
	bodyPriority = `{"priority":"urgent"}`
	bodyApprove  = `{"transitionKey":"t3"}`
	bodyReject   = `{"comment":"Нужен счёт с НДС"}`
)

// ifMatchRow is a row of an actor the gateway admits: the object of another tenant, of a closed project, of another
// project or a missing one — 404 before the revision is compared (AC-01: the twin with a missing id answers the same).
func ifMatchRow(actor string, params map[string]string, body, note string) matrix.Row {
	return matrix.Row{Actor: actor, Params: params, Status: http.StatusNotFound, Code: "not_found", Body: body, Note: note}
}

func p(kv ...string) map[string]string {
	out := map[string]string{"tenantId": "tenant:a"}
	for i := 0; i+1 < len(kv); i += 2 {
		out[kv[i]] = kv[i+1]
	}
	return out
}

// Notes of the rows.
const (
	noteMissing  = "объекта нет в организации — 404 и владельцу"
	noteForeign  = "объект организации B в организации A — как несуществующий"
	noteBuild    = "роль проекта «Автопарк» в «Стройке» не даёт ничего — как несуществующий (изоляция между проектами)"
	noteTP03     = "TP-03 — закрытая «Стройка» без роли владельца в ней — 404 и владельцу"
	refMissing   = "tenant:missing"
	refFleetB    = "project:b.fleet"
	refBuild     = "project:a.build"
	refTaskB     = "task:b.fleet-1"
	refTaskBuild = "task:a.build-1"
	actorOwner   = "a.owner"
	actorLead    = "a.project-lead"
	actorApprove = "a.project-approver"
)

// tasksIfMatchRows (W4.11; W4.03 return 1, integratorNotes п. 3): the commands with If-Match of the actors the gateway
// admits — the rows of W4.03 that cannot carry If-Match and the ids of another tenant in the path.
var tasksIfMatchRows = matrix.File{
	Module: "tasks_w411_ifmatch",
	Endpoints: []matrix.Endpoint{
		{Op: "updateTaskProject", Method: http.MethodPatch, Path: "/api/v1/tenants/{tenantId}/projects/{projectId}", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("projectId", refMissing), bodyAccess, noteMissing),
			ifMatchRow(actorOwner, p("projectId", refFleetB), bodyAccess, noteForeign),
			ifMatchRow(actorLead, p("projectId", refBuild), bodyAccess, noteBuild),
			ifMatchRow(actorOwner, p("projectId", refBuild), bodyAccess, noteTP03),
		}},
		{Op: "saveTaskWorkflowDraft", Method: http.MethodPut, Path: "/api/v1/tenants/{tenantId}/projects/{projectId}/workflow/draft", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("projectId", refMissing), bodyDraft, noteMissing),
			ifMatchRow(actorOwner, p("projectId", refFleetB), bodyDraft, noteForeign),
			ifMatchRow(actorLead, p("projectId", refBuild), bodyDraft, noteBuild),
		}},
		{Op: "discardTaskWorkflowDraft", Method: http.MethodDelete, Path: "/api/v1/tenants/{tenantId}/projects/{projectId}/workflow/draft", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("projectId", refMissing), "", noteMissing),
			ifMatchRow(actorLead, p("projectId", refBuild), "", noteBuild),
		}},
		{Op: "publishTaskWorkflow", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/projects/{projectId}/workflow/draft/publish", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("projectId", refMissing), "", noteMissing),
			ifMatchRow(actorLead, p("projectId", refBuild), "", noteBuild),
		}},
		{Op: "updateTaskAutomation", Method: http.MethodPatch, Path: "/api/v1/tenants/{tenantId}/projects/{projectId}/automations/{automationId}", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("projectId", refMissing, "automationId", refMissing), `{"enabled":false}`, noteMissing),
			ifMatchRow(actorLead, p("projectId", "project:a.fleet", "automationId", "automation:b.fleet-rule"), `{"enabled":false}`,
				"правило организации B в проекте A — «Правило не найдено»"),
		}},
		{Op: "deleteTaskAutomation", Method: http.MethodDelete, Path: "/api/v1/tenants/{tenantId}/projects/{projectId}/automations/{automationId}", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("projectId", refMissing, "automationId", refMissing), "", noteMissing),
			ifMatchRow(actorLead, p("projectId", "project:a.fleet", "automationId", "automation:b.fleet-rule"), "",
				"правило организации B в проекте A — «Правило не найдено»"),
		}},
		{Op: "updateTask", Method: http.MethodPatch, Path: "/api/v1/tenants/{tenantId}/tasks/{taskId}", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("taskId", refMissing), bodyPriority, noteMissing),
			ifMatchRow(actorOwner, p("taskId", refTaskB), bodyPriority, noteForeign),
			ifMatchRow(actorOwner, p("taskId", refTaskBuild), bodyPriority, noteTP03),
			ifMatchRow(actorLead, p("taskId", refTaskBuild), bodyPriority, noteBuild),
		}},
		{Op: "transitionTask", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/tasks/{taskId}/transitions", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("taskId", refMissing), bodyApprove, noteMissing),
			ifMatchRow(actorOwner, p("taskId", refTaskB), bodyApprove, noteForeign),
			ifMatchRow(actorApprove, p("taskId", refMissing), bodyApprove,
				"«Согласующий» без tasks.transition проходит шлюз по tasks.approve (режим any): хендлер — 404"),
			ifMatchRow(actorApprove, p("taskId", refTaskBuild), bodyApprove, noteBuild),
		}},
		{Op: "updateTaskChecklistItem", Method: http.MethodPatch, Path: "/api/v1/tenants/{tenantId}/tasks/{taskId}/checklist/ch-1", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("taskId", refMissing), `{"done":true}`, noteMissing),
			ifMatchRow(actorOwner, p("taskId", refTaskB), `{"done":true}`, noteForeign),
		}},
		{Op: "rejectTaskApproval", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/tasks/{taskId}/approvals/t3/reject", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("taskId", refMissing), bodyReject, noteMissing),
			ifMatchRow(actorApprove, p("taskId", "task:b.fleet-2"), bodyReject, noteForeign),
		}},
		{Op: "setTaskParent", Method: http.MethodPut, Path: "/api/v1/tenants/{tenantId}/tasks/{taskId}/parent", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("taskId", refMissing), `{"parentTaskId":null}`, noteMissing),
			ifMatchRow(actorOwner, p("taskId", refTaskB), `{"parentTaskId":null}`, noteForeign),
		}},
		{Op: "attachTaskFiles", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/tasks/{taskId}/files", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("taskId", refMissing), `{"fileIds":["{{file:a.msk1}}"]}`, noteMissing),
			ifMatchRow(actorOwner, p("taskId", refTaskB), `{"fileIds":["{{file:a.msk1}}"]}`, noteForeign),
		}},
		{Op: "removeTaskFile", Method: http.MethodDelete, Path: "/api/v1/tenants/{tenantId}/tasks/{taskId}/files/{fileId}", Rows: []matrix.Row{
			ifMatchRow(actorOwner, p("taskId", refMissing, "fileId", "file:a.msk1"), "", noteMissing),
			ifMatchRow(actorOwner, p("taskId", refTaskB, "fileId", "file:a.msk1"), "", noteForeign),
			{Actor: actorLead, Params: p("taskId", "task:a.fleet-1", "fileId", "file:b.msk1"), Status: http.StatusPreconditionFailed,
				Code: "revision_mismatch", Note: "файл организации B у видимой задачи A: If-Match сравнивается раньше вложения, " +
					"как в MSW (Q-W4.11-7), — 412, ответ не зависит от чужого файла"},
		}},
	},
}

func TestIsolationTasksW411IfMatch(t *testing.T) {
	t.Parallel()
	file := tasksIfMatchRows
	file.Endpoints = append([]matrix.Endpoint(nil), file.Endpoints...)
	for i := range file.Endpoints {
		file.Endpoints[i].Channel = matrix.ChannelHTTP
	}
	s := &matrix.Suite{
		Refs:   suite.Refs,
		Target: matrix.Target{Handler: withTasksIfMatch(suite.Target.Handler), Authenticate: suite.Target.Authenticate},
		Strict: suite.Strict,
	}
	matrix.Run(t, s, file)
}
