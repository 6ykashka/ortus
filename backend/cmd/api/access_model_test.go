package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// accessModelOps are the operations of the tag Access that belong to the access model of W1.06 (roles, assignments,
// groups, owners, «Почему доступно»).
var accessModelOps = []string{
	"listRoles", "getRole", "createRole", "updateRole", "deleteRole",
	"listAssignments", "createAssignment", "revokeAssignment",
	"listGroups", "getGroup", "createGroup", "updateGroup", "deleteGroup", "setGroupMembers",
	"listOwners", "transferOwnership", "revokeOwnership", "explainAccess", "inviteMember",
}

var pathParam = regexp.MustCompile(`\{[^}]+\}`)

// Операции модели доступа W1.06 встроены в составной сервер тега Access (схема W1.05): маршрут доходит до
// strict-обработчика (400 — параметры не связались, 404 — без TenantContext), а не отвечает 501 через
// mountAccessPending.
func TestAccessModelOperationsReachTheirHandlers(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Access: newAccessServer(nil, nil, nil, time.Now)}})
	byID := map[string]catalog.Operation{}
	for _, op := range catalog.Operations {
		byID[op.ID] = op
	}
	for _, id := range accessModelOps {
		op, ok := byID[id]
		if !ok || op.Tag != "Access" {
			t.Errorf("%s: not an operation of the tag Access", id)
			continue
		}
		if !accessImplemented[id] {
			t.Errorf("%s: missing in accessImplemented", id)
		}
		path := pathParam.ReplaceAllStringFunc(op.Path, func(string) string { return uuid.NewString() })
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotImplemented {
			t.Errorf("%s %s (%s): 501 — the handler of W1.06 is not reached", op.Method, op.Path, id)
		}
	}
}

// Свежий вход владельческих команд берётся из Session.AuthTime (W1.03), без сессии — «не свежий».
func TestSessionAuthTime(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	if got, ok := sessionAuthTime(session.WithSession(context.Background(), session.Session{AuthTime: at})); !ok || !got.Equal(at) {
		t.Errorf("with a session: %v %v", got, ok)
	}
	if _, ok := sessionAuthTime(context.Background()); ok {
		t.Error("without a session")
	}
}
