package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// The tag Access is shared by W1.03 (invitations), W1.05 (structure, people, import), W1.06 (roles, assignments,
// groups, owners, explainAccess) and W1.43 (updateMember): the operations of W1.05 and updateMember reach their
// modules (those of W1.06 — access_model_test.go); no operation of the tag answers 501 since W1.43.
func TestAccessServerRoutes(t *testing.T) {
	t.Parallel()
	var s accessapi.StrictServerInterface = newAccessServer(nil, nil, nil, time.Now)
	ctx := context.Background() // no tenant context: a module of W1.05 answers 404, not 501
	ours := map[string]func() error{
		"ListOrgUnits": func() error { _, err := s.ListOrgUnits(ctx, accessapi.ListOrgUnitsRequestObject{}); return err },
		"GetOrgUnit":   func() error { _, err := s.GetOrgUnit(ctx, accessapi.GetOrgUnitRequestObject{}); return err },
		"CreateOrgUnit": func() error {
			_, err := s.CreateOrgUnit(ctx, accessapi.CreateOrgUnitRequestObject{})
			return err
		},
		"UpdateOrgUnit": func() error {
			_, err := s.UpdateOrgUnit(ctx, accessapi.UpdateOrgUnitRequestObject{})
			return err
		},
		"PreviewOrgUnitMove": func() error {
			_, err := s.PreviewOrgUnitMove(ctx, accessapi.PreviewOrgUnitMoveRequestObject{})
			return err
		},
		"ListMembers":  func() error { _, err := s.ListMembers(ctx, accessapi.ListMembersRequestObject{}); return err },
		"GetMember":    func() error { _, err := s.GetMember(ctx, accessapi.GetMemberRequestObject{}); return err },
		"CreateMember": func() error { _, err := s.CreateMember(ctx, accessapi.CreateMemberRequestObject{}); return err },
		"ListWorkProfiles": func() error {
			_, err := s.ListWorkProfiles(ctx, accessapi.ListWorkProfilesRequestObject{})
			return err
		},
		"CreateWorkProfile": func() error {
			_, err := s.CreateWorkProfile(ctx, accessapi.CreateWorkProfileRequestObject{})
			return err
		},
		"UpdateWorkProfile": func() error {
			_, err := s.UpdateWorkProfile(ctx, accessapi.UpdateWorkProfileRequestObject{})
			return err
		},
		"CreatePeopleImport": func() error {
			_, err := s.CreatePeopleImport(ctx, accessapi.CreatePeopleImportRequestObject{})
			return err
		},
		"GetPeopleImport": func() error {
			_, err := s.GetPeopleImport(ctx, accessapi.GetPeopleImportRequestObject{})
			return err
		},
		"CommitPeopleImport": func() error {
			_, err := s.CommitPeopleImport(ctx, accessapi.CommitPeopleImportRequestObject{})
			return err
		},
		"UpdateMember": func() error { _, err := s.UpdateMember(ctx, accessapi.UpdateMemberRequestObject{}); return err }, // W1.43
	}
	for name, call := range ours {
		if err := call(); !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found of its module", name, err)
		}
	}
}

// An operation of the tag without an owner would answer 501 before its parameters are bound (mountAccessPending), as
// when the whole tag had no server. Every operation has an owner since W1.43: each binds its parameters (400 without
// the key), updateMember too.
func TestAccessPendingBeforeBinding(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Access: newAccessServer(nil, nil, nil, time.Now)}})
	tenant := "/api/v1/tenants/" + uuid.NewString()
	for route, want := range map[string]int{
		"POST " + tenant + "/owners/transfers":             http.StatusBadRequest, // W1.06
		"POST " + tenant + "/invitations":                  http.StatusBadRequest, // W1.06
		"POST " + tenant + "/org-units":                    http.StatusBadRequest,
		"POST " + tenant + "/people-imports":               http.StatusBadRequest,
		"PATCH " + tenant + "/members/" + uuid.NewString(): http.StatusBadRequest, // W1.43
	} {
		method, path, _ := strings.Cut(route, " ")
		req := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("%s: %d %s, want %d", route, rec.Code, rec.Body, want)
		}
	}
}

func TestAccessImplementedAreOperationsOfTheTag(t *testing.T) {
	t.Parallel()
	tags := map[string]string{}
	for _, op := range catalog.Operations {
		tags[op.ID] = op.Tag
	}
	for id := range accessImplemented {
		if tags[id] != "Access" {
			t.Errorf("%s: tag %q, want Access", id, tags[id])
		}
	}
}
