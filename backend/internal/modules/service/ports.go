package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// TaskInput is a task made from a request («＋ Задача», Q-W4.00-service-13): the project of the direction by default.
type TaskInput struct {
	Project, Author, Assignee uuid.UUID
	AuthorOwner               bool
	AuthorName                string
	Title, Description        string
	Request                   uuid.UUID
	Origin                    string // the line of the history of the task: «Из обращения ГРЗ-57»
}

// TaskResult is the task created, or the cause of a refusal (the author may not create tasks there, the assignee does
// not see the project).
type TaskResult struct {
	ID          uuid.UUID
	Key, Status string
	Refused     string
}

// TaskPort is the port of the module «Задачи» (tasks.Service.CreateFormTask adapted in cmd/api): the task is made in
// the transaction of the command on behalf of the author (D-27).
type TaskPort interface {
	CreateTask(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t TaskInput) (TaskResult, error)
}

// ProjectPort makes the service project of «Задачи» of a new direction (tasks.Service.CreateProject adapted in
// cmd/api): the creator becomes its project manager.
type ProjectPort interface {
	CreateServiceProject(ctx context.Context, tc tenantctx.TenantContext, key, name string, unit *uuid.UUID) (uuid.UUID, error)
}

// RefundOffer is a proposal of a refund to the cash (cash.proposals.post, W5.31): the basis is the key of the request;
// the sum is for the cashier to enter.
type RefundOffer struct {
	Request uuid.UUID
	Key     string
	By      uuid.UUID
}

// CashPort offers a refund of a compensation to the cash in the transaction of the command.
type CashPort interface {
	OfferRefund(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, o RefundOffer) error
}

// TokenRow is a row of the control index of the portal tokens.
type TokenRow struct {
	Digest     string
	Tenant     uuid.UUID
	Request    uuid.UUID
	ID         uuid.UUID
	KeyVersion int
	ExpiresAt  time.Time
	TenantName string
}

// SlugRow is a row of the control registry of the public pages of the directions.
type SlugRow struct {
	Slug       string
	Tenant     uuid.UUID
	Direction  uuid.UUID
	TenantName string
}

// Index is the control index of the public routes (control 0011): the route of a client from the digest of his token
// and from the slug of a page to the tenant. The tenant row is the source of truth; the index is written first.
type Index interface {
	IssueToken(ctx context.Context, t TokenRow) error
	DropToken(ctx context.Context, digest string) error
	// FindToken is the active (not revoked) token of an active tenant; expired ones are returned too (410).
	FindToken(ctx context.Context, digest string) (TokenRow, bool, error)
	ClaimSlug(ctx context.Context, s SlugRow) error
	DropSlug(ctx context.Context, slug string) error
	FindSlug(ctx context.Context, slug string) (SlugRow, bool, error)
}
