package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	chatsapi "github.com/ortus/ortus-crm/backend/internal/api/chats"
	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/chats"
	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// envChatPollKey is the key of voter_hash of the anonymous polls of chats (base64, at least 32 bytes). Outside prod a key
// derived from a constant stands in; in prod without it the anonymous polls are off (422 on creation).
const envChatPollKey = "CHAT_POLL_VOTER_KEY"

const chatPollKeyMin = 32

// newChats is the server of the tag Chats (W7.11): chats of five kinds, their rosters computed from sources, messages,
// polls, policies, the storage of a chat, holds, the journal and the chats of records — over the tenant pools, the
// memberships of the control DB (the status of a member, the owner of the business), the evaluator of W1.04 (the actions
// outside the chat), the tasks (chatToTask), the files (an owner of a saved file, a link to a view-once file) and the clock
// of the application (APP_FIXED_NOW outside prod). Hints chat.changed come with the gateway of W7.12 (Hints nil).
func newChats(pools chats.Pools, control *pgxpool.Pool, ev *authz.Evaluator, getenv func(string) string, appEnv string, log *slog.Logger, now func() time.Time) (chatsapi.StrictServerInterface, *chats.Service, error) {
	key, err := chatPollKey(getenv, appEnv)
	if err != nil {
		return nil, nil, err
	}
	blobs := chatBlobs{pools: pools, log: log, now: now}
	if cfg, ok, err := storage.ConfigFromEnv(getenv); err != nil {
		return nil, nil, fmt.Errorf("object storage: %w", err)
	} else if ok {
		if blobs.s3, err = storage.NewS3(cfg, nil, nil); err != nil {
			return nil, nil, err
		}
	}
	taskSvc := &tasks.Service{Pools: pools, Authz: ev, Directory: tasks.ControlDirectory{DB: control}, Audience: inbox.AuthzAudience{E: ev}, Now: now}
	svc := &chats.Service{Pools: pools, Memberships: chats.PGMemberships{DB: control}, Perm: ev, Tasks: chatTasks{S: taskSvc, Pools: pools},
		Files: blobs, PollKey: key, Now: now}
	return chats.Server{S: svc}, svc, nil
}

// chatPollKey reads the key of the anonymous polls.
func chatPollKey(getenv func(string) string, appEnv string) ([]byte, error) {
	raw := getenv(envChatPollKey)
	if raw == "" {
		if appEnv == envProd {
			return nil, nil
		}
		dev := sha256.Sum256([]byte("ortus.chats.poll-voter.dev-stand"))
		return dev[:], nil
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: not base64: %w", envChatPollKey, err)
	}
	if len(key) < chatPollKeyMin {
		return nil, fmt.Errorf("%s: at least %d bytes, got %d", envChatPollKey, chatPollKeyMin, len(key))
	}
	return key, nil
}

// chatJobs is the background job of the chats (nil when the sweep interval is off): the recomputation of the rosters and the
// jobs by term of every live tenant.
func chatJobs(svc *chats.Service, control *pgxpool.Pool, every time.Duration, log *slog.Logger) func(context.Context) {
	if every <= 0 {
		return nil
	}
	r := chats.Runner{S: svc, Tenants: chats.ActiveTenants{DB: control}, Log: log}
	return func(ctx context.Context) { r.Run(ctx, every) }
}

// chatTasks makes the task of «Задача из сообщения» with the rights of the actor (tasks.Service.CreateTask, W4.11): the
// project is the argument, or the active project of the unit of the chat, or the first active project of tasks.
type chatTasks struct {
	S     *tasks.Service
	Pools chats.Pools
}

var _ chats.Tasks = chatTasks{}

// Create implements chats.Tasks.
func (a chatTasks) Create(ctx context.Context, tc tenantctx.TenantContext, d chats.TaskDraft) (chats.TaskResult, error) {
	project := d.Project
	if project == uuid.Nil {
		pool, err := a.Pools.For(ctx, tc.TenantID)
		if err != nil {
			return chats.TaskResult{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
		var unit any
		if d.Unit != uuid.Nil {
			unit = d.Unit
		}
		err = pool.QueryRow(ctx, `select id from tasks.projects where status = 'active' and flow = 'tasks'
			order by (org_unit_id is not distinct from $1::uuid) desc, created_at, id limit 1`, unit).Scan(&project)
		if errors.Is(err, pgx.ErrNoRows) {
			return chats.TaskResult{}, problem.New("validation_failed", "Нет проекта для задачи: создайте проект или выберите существующий")
		}
		if err != nil {
			return chats.TaskResult{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
	}
	desc := "Из чата: " + d.Link
	t, err := a.S.CreateTask(ctx, tc, tasksapi.TaskCreate{ProjectId: project, Title: d.Title, DescriptionMarkdown: &desc,
		RelatedObjects: &[]tasksapi.ObjectRef{{ModuleKey: "chat", EntityType: "chat", EntityId: d.ChatID}}})
	if err != nil {
		return chats.TaskResult{}, err
	}
	key := ""
	if t.Key != nil {
		key = *t.Key
	}
	return chats.TaskResult{ID: t.Id, Key: key}, nil
}

// chatBlobs is what the chats ask of the files. Everything that changes files.objects, the usage and the ledger goes
// through the module of files (files.Reparent, files.Release, files.Put — W7.11, return 1); the adapter only deletes the
// objects after the commit and makes the short link of a view-once file. The upload of an attachment is the ordinary
// initiateUpload with the parent «chat/chat» (files.ChatParents).
type chatBlobs struct {
	pools chats.Pools
	s3    *storage.S3
	log   *slog.Logger
	now   func() time.Time
}

var _ chats.Files = chatBlobs{}

// Move implements chats.Files: the file goes to the record, whose kind reads it from now on.
func (b chatBlobs) Move(ctx context.Context, tx pgx.Tx, fileID uuid.UUID, owner chats.ObjectRef) error {
	return files.Reparent(ctx, tx, fileID, files.Ref{Module: owner.Module, Entity: owner.Type, ID: owner.ID})
}

// Remove implements chats.Files: the files are released in tx (the quota gets the bytes back), their objects are deleted
// from the storage after the commit.
func (b chatBlobs) Remove(ctx context.Context, tx pgx.Tx, fileIDs []uuid.UUID) (func(context.Context), error) {
	keys, err := files.Release(ctx, tx, fileIDs)
	if err != nil || b.s3 == nil || len(keys) == 0 {
		return nil, err
	}
	return func(ctx context.Context) {
		for _, k := range keys {
			if err := b.s3.Delete(ctx, k); err != nil && b.log != nil {
				b.log.WarnContext(ctx, "chats: delete the object of a removed file", slog.String("key", k), slog.String("error", err.Error()))
			}
		}
	}, nil
}

// ViewURL implements chats.Files.
func (b chatBlobs) ViewURL(ctx context.Context, tenantID, fileID uuid.UUID, ttl time.Duration) (string, error) {
	if b.s3 == nil {
		return "", problem.New(problem.CodeDependencyUnavailable, "")
	}
	pool, err := b.pools.For(ctx, tenantID)
	if err != nil {
		return "", err
	}
	key, err := files.ReadyKey(ctx, pool, fileID)
	if err != nil {
		return "", err
	}
	return b.s3.PresignGet(key, "", ttl)
}

// Save implements chats.Files: the file of an export is written to the object storage and recorded by the module of files,
// owned by the export (parent «chat/export»), counted for the quota of the organization.
func (b chatBlobs) Save(ctx context.Context, tx pgx.Tx, tenantID, by uuid.UUID, owner chats.ObjectRef, name, contentType string, data []byte) (uuid.UUID, error) {
	if b.s3 == nil {
		return uuid.Nil, problem.New(problem.CodeDependencyUnavailable, "")
	}
	now := time.Now
	if b.now != nil {
		now = b.now
	}
	return files.Put(ctx, tx, b.s3, tenantID, now().UTC(), files.NewFile{
		Owner: files.Ref{Module: owner.Module, Entity: owner.Type, ID: owner.ID}, Purpose: files.PurposeChatAttachment,
		Name: name, ContentType: contentType, Data: data, By: by,
	})
}
