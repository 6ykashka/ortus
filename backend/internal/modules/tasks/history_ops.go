package tasks

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.11: shared command helpers of the modules (Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const textEmptyComment = "Комментарий пустой"

// Comment comments a task (commentTask, commentTask of the old board; Q-W4.00-tasks-11): anybody who reads the task;
// append-only — the revision of the task does not change.
func (s *Service) Comment(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b tasksapi.TaskCommentCreate) (tasksapi.TaskHistoryEntry, error) {
	var out tasksapi.TaskHistoryEntry
	err := s.run(ctx, tc, true, func(r *request) error {
		t, _, err := r.visibleTask(ctx, id, false)
		if err != nil {
			return err
		}
		text := trimmed(b.Text)
		switch {
		case text == "":
			return invalid("text", "required", textEmptyComment)
		case runes(text) > commentMax:
			return invalid("text", "length", textLength)
		}
		h, err := r.log(ctx, t.ID, "comment", text, r.meActor(), "")
		if err != nil {
			return err
		}
		out = r.historyDTO(ctx, h)
		return kit.Complete(ctx, r.tx, http.StatusCreated, "", out)
	})
	return out, err
}

// History is the history of a task, newest first (listTaskHistory).
func (s *Service) History(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, cursor *string, limit *int) (tasksapi.TaskHistoryPage, error) {
	var out tasksapi.TaskHistoryPage
	err := s.run(ctx, tc, false, func(r *request) error {
		t, _, err := r.visibleTask(ctx, id, false)
		if err != nil {
			return err
		}
		rows, err := r.tx.Query(ctx, `select id, task_id, at, kind, actor_id, actor_label, text, transition_key
			from tasks.task_events where task_id = $1 order by at desc, id desc`, t.ID)
		if err != nil {
			return store("history", err)
		}
		lines, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (historyRow, error) {
			var h historyRow
			err := row.Scan(&h.ID, &h.Task, &h.At, &h.Kind, &h.Actor, &h.Label, &h.Text, &h.TransitionKey)
			return h, err
		})
		if err != nil {
			return store("history", err)
		}
		items := make([]tasksapi.TaskHistoryEntry, 0, len(lines))
		for _, h := range lines {
			items = append(items, r.historyDTO(ctx, h))
		}
		out.Items, out.NextCursor, err = pageOf(items, func(h tasksapi.TaskHistoryEntry) string { return h.Id.String() }, cursor, limit)
		return err
	})
	return out, err
}
