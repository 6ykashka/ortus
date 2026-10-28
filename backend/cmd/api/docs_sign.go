package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/modules/docs"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
)

// minStandSecret is the shortest secret of the stand confirmation of a signature.
const minStandSecret = 8

// docsSigner is the second confirmation of a signature of the configuration (D-31): none by default — the signature
// answers dependency_unavailable until the provider (the repeated sign-in at the identity provider, the delivery of
// the code) is connected. DOCS_SIGN_STAND_SECRET stands in for it on a local stand and in the e2e runs, never in prod.
func docsSigner(getenv func(string) string, appEnv string, log *slog.Logger) (docs.Signer, error) {
	secret := strings.TrimSpace(getenv("DOCS_SIGN_STAND_SECRET"))
	switch {
	case secret == "":
		log.Warn("api: DOCS_SIGN_STAND_SECRET is not set — the signature of documents waits for the provider of the confirmation (D-31)")
		return nil, nil
	case appEnv == envProd:
		return nil, errors.New("DOCS_SIGN_STAND_SECRET is a stand secret: it is not allowed with APP_ENV=prod")
	case len(secret) < minStandSecret:
		return nil, fmt.Errorf("DOCS_SIGN_STAND_SECRET: at least %d characters", minStandSecret)
	}
	log.Warn("api: DOCS_SIGN_STAND_SECRET is set — the signature is confirmed by the stand secret (not for prod)")
	return standSigner{secret: []byte(secret)}, nil
}

// standSigner confirms the repeated sign-in by the stand secret (as the password or as the code); the SMS are put off
// (D-31), so no code is delivered.
type standSigner struct{ secret []byte }

// ConfirmLogin implements docs.Signer.
func (s standSigner) ConfirmLogin(_ context.Context, _, _ uuid.UUID, password, totp string) (bool, error) {
	return subtle.ConstantTimeCompare([]byte(password), s.secret) == 1 || subtle.ConstantTimeCompare([]byte(totp), s.secret) == 1, nil
}

// SendCode implements docs.Signer: there is no channel of delivery yet.
func (standSigner) SendCode(context.Context, uuid.UUID, uuid.UUID, string) (string, error) {
	return "", docs.ErrNoDelivery
}

// docRouteTasks adapts the module «Задачи» to the mirror tasks of the routes of documents (docs.RouteTasks): the module
// «Документы» imports no other module.
type docRouteTasks struct{ S *tasks.Service }

// MayCreate implements docs.RouteTasks.
func (a docRouteTasks) MayCreate(ctx context.Context, tx pgx.Tx, tenant, member uuid.UUID, owner bool, project uuid.UUID) (bool, error) {
	if project == uuid.Nil {
		return true, nil
	}
	return a.S.MayCreate(ctx, tx, tenant, member, owner, project)
}

// CreateRouteTask implements docs.RouteTasks.
func (a docRouteTasks) CreateRouteTask(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t docs.RouteTask) (docs.RouteTaskResult, error) {
	r, err := a.S.CreateDocRouteTask(ctx, tx, tenant, tasks.DocRouteTask{Project: t.Project, Author: t.Author, AuthorOwner: t.AuthorOwner,
		AuthorName: t.AuthorName, Document: t.Document, Route: t.Route, Title: t.Title, Description: t.Description, State: routeState(t.State)})
	return docs.RouteTaskResult{ID: r.ID, Key: r.Key, Project: r.Project, Refused: r.Refused, Forbidden: r.Forbidden}, err
}

// SyncRouteTask implements docs.RouteTasks.
func (a docRouteTasks) SyncRouteTask(ctx context.Context, tx pgx.Tx, tenant, task uuid.UUID, st docs.RouteTaskState, note string) error {
	return a.S.SyncDocRouteTask(ctx, tx, tenant, task, routeState(st), note)
}

func routeState(s docs.RouteTaskState) tasks.DocRouteState {
	return tasks.DocRouteState{Status: s.Status, Title: s.Title, Version: s.Version, Step: s.Step, Steps: s.Steps, StepName: s.StepName,
		Waiting: s.Waiting, WaitingNames: s.WaitingNames, Assignee: s.Assignee, Due: s.Due, Actor: s.Actor}
}
