package main

import (
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/docs"
)

// W7.24 (D-31): the second confirmation of a signature is configuration — none until chosen (the signature answers
// dependency_unavailable), a stand secret outside prod, never in prod.
func TestDocsSigner(t *testing.T) {
	t.Parallel()
	s, err := docsSigner(docsEnv(nil), envDev, quiet)
	if err != nil || s != nil {
		t.Fatalf("no variables: %v %v, want none", s, err)
	}
	if _, err := docsSigner(docsEnv(map[string]string{"DOCS_SIGN_STAND_SECRET": "short"}), envDev, quiet); err == nil {
		t.Error("a short secret")
	}
	if _, err := docsSigner(docsEnv(map[string]string{"DOCS_SIGN_STAND_SECRET": "stand-secret-1"}), envProd, quiet); err == nil {
		t.Error("a stand secret in prod")
	}
	s, err = docsSigner(docsEnv(map[string]string{"DOCS_SIGN_STAND_SECRET": "stand-secret-1"}), envDev, quiet)
	if err != nil || s == nil {
		t.Fatalf("a stand secret: %v %v", s, err)
	}
	ctx := t.Context()
	for _, c := range []struct {
		password, totp string
		want           bool
	}{{"stand-secret-1", "", true}, {"", "stand-secret-1", true}, {"wrong", "", false}, {"", "", false}} {
		if ok, err := s.ConfirmLogin(ctx, uuid.New(), uuid.New(), c.password, c.totp); err != nil || ok != c.want {
			t.Errorf("ConfirmLogin(%q, %q) = %v %v, want %v", c.password, c.totp, ok, err, c.want)
		}
	}
	if _, err := s.SendCode(ctx, uuid.New(), uuid.New(), "1234"); !errors.Is(err, docs.ErrNoDelivery) {
		t.Errorf("SendCode: %v, want no delivery (the SMS are put off, D-31)", err)
	}
}
