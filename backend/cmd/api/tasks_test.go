package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W4.11: the tag Tasks is served by the module of tasks over the tenant pools, the evaluator of W1.04, the memberships
// of the control DB, the inbox of the owners and the clock of the application.
func TestNewTasks(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	s, ok := newTasks(noPools{}, ev, nil, func() time.Time { return at }).(tasks.Server)
	if !ok || s.S == nil {
		t.Fatalf("tasks server %#v, want the server of W4.11", s)
	}
	if s.S.Pools != (noPools{}) || s.S.Authz != ev || s.S.Directory == nil || s.S.Audience == nil || s.S.Now == nil || !s.S.Now().Equal(at) {
		t.Fatalf("service %+v", s.S)
	}
}

// The operations of the tag Tasks reach the module through the router: without a tenant in the context the module
// answers 404 (the gateway puts the tenant there; If-Match of the commands is checked before, 428 without it).
func TestTasksRoutes(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Tasks: newTasks(noPools{}, authz.New(nil, nil, time.Now), nil, time.Now)}})
	n := 0
	for _, op := range catalog.Operations {
		if op.Tag != "Tasks" {
			continue
		}
		n++
		path := op.Path
		for _, p := range []string{"{tenantId}", "{projectId}", "{taskId}", "{memberId}", "{automationId}", "{fileId}"} {
			path = strings.ReplaceAll(path, p, uuid.NewString())
		}
		path = strings.NewReplacer("{transitionKey}", "t3", "{checklistItemId}", "ch-1").Replace(path)
		if op.ID == "checkTaskProjectAccess" {
			path += "?action=tasks.read"
		}
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "w411-tasks-routes")
		req.Header.Set("If-Match", `"rev-1"`)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s (%s): %d %s, want 404 of the module without a tenant", op.Method, op.Path, op.ID, rec.Code, rec.Body)
		}
	}
	if n != 30 {
		t.Errorf("operations of the tag Tasks: %d, want 30 (contract 0.10.0-stage4)", n)
	}
}

// W4.01 (RS-08): the evaluator of main knows the container of the projects of tasks — the reads of a limited project
// and the place of a project.
func TestRegisterProjects(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	registerProjects(ev, noPools{})
	if !slices.Equal(ev.ContainerReads[authz.KindProject], []string{"tasks.projects.read", "tasks.read", "files.read"}) {
		t.Fatalf("container reads %v", ev.ContainerReads)
	}
	if _, ok := ev.Places[authz.KindProject].(tasks.ProjectPlaces); !ok {
		t.Fatalf("places %#v", ev.Places)
	}
}

// The attachments of tasks: the parent tasks/task takes the purpose task_attachment only, is read with tasks.read and
// leaves out the hidden tasks; the files of main register it next to the fleet and join the Hiders.
func TestTaskParent(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	fs, _, err := filesServers(noPools{}, ev, envOf(nil), slog.New(slog.DiscardHandler), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	f, ok := fs.(files.Server)
	if !ok {
		t.Fatalf("files server %#v", fs)
	}
	k, ok := f.S.Parents.Kind("tasks", "task")
	if !ok || k.ReadAction != "tasks.read" || !k.Allows(files.PurposeTaskAttachment) || k.Allows(files.PurposeInspection) ||
		!strings.Contains(k.Rows, files.IDPlaceholder) || !strings.Contains(k.Rows, files.HiddenPlaceholder) {
		t.Fatalf("parent tasks/task %+v", k)
	}
	wantFileHiders(t, f.S.Hidden)
}

// wantFileHiders requires the Hiders of the files of main: the pool, the hidden tasks and (W4.21, return 2) the files
// of the answers of forms and (W7.11, return 1) the chats the subject is not in.
func wantFileHiders(t *testing.T, h files.Hider) {
	t.Helper()
	hs, ok := h.(closedParents)
	if !ok || len(hs) != 4 {
		t.Fatalf("hiders %#v", h)
	}
	if _, ok := hs[1].(hiddenTasks); !ok {
		t.Fatalf("second hider %#v, want the hidden tasks", hs[1])
	}
	if f, ok := hs[2].(hiddenFormFiles); !ok || f.S == nil || f.S.Objects == nil {
		t.Fatalf("third hider %#v, want the files of the answers of forms", hs[2])
	}
	if _, ok := hs[3].(files.ChatHider); !ok { // W7.11, return 1: the chats a member is not in
		t.Fatalf("fourth hider %#v, want the closed chats", hs[3])
	}
}

// fixedHider closes the ids it holds.
type fixedHider struct {
	c   files.Closed
	err error
}

func (h fixedHider) Closed(context.Context, tenantctx.TenantContext) (files.Closed, error) {
	return h.c, h.err
}

// closedParents closes what any of its Hiders closes and fails with the first failure.
func TestClosedParents(t *testing.T) {
	t.Parallel()
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	got, err := closedParents{fixedHider{c: files.Closed{Hidden: []uuid.UUID{a}, Continued: []uuid.UUID{b}}},
		fixedHider{c: files.Closed{Hidden: []uuid.UUID{c}}}}.Closed(t.Context(), tenantctx.TenantContext{})
	if err != nil || !slices.Equal(got.Hidden, []uuid.UUID{a, c}) || !slices.Equal(got.Continued, []uuid.UUID{b}) {
		t.Fatalf("closed %+v %v", got, err)
	}
	empty, err := closedParents{}.Closed(t.Context(), tenantctx.TenantContext{})
	if err != nil || empty.Hidden == nil || empty.Continued == nil {
		t.Fatalf("nothing closed must be empty arrays (uuid[] of the rows): %+v %v", empty, err)
	}
	boom := errors.New("boom")
	if _, err := (closedParents{fixedHider{err: boom}}).Closed(t.Context(), tenantctx.TenantContext{}); !errors.Is(err, boom) {
		t.Fatalf("failure %v", err)
	}
}
