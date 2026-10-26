package home

import (
	"context"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
)

// TaskCounts are the counters of the tasks a member sees (getMyTaskSummary, W4.81): «Новые», «В работе», «На проверке»
// of the card «Задачи» and the badge of the menu item «Задачи».
type TaskCounts struct {
	New, InProgress, Review, MyNew int
}

// TaskCounter counts the tasks of the member of a query (the source of tasks, home/tasks).
type TaskCounter interface {
	TaskCounts(ctx context.Context, q Query) (TaskCounts, error)
}

// TaskSummary returns the counters of the tasks of accountID in tenantID (getMyTaskSummary): the tenant is resolved as
// for the queue (a foreign or suspended business — 404), the counter gets the member and the clock; no counter — zeros.
func (s *Service) TaskSummary(ctx context.Context, accountID, tenantID uuid.UUID) (homeapi.TaskSummary, error) {
	tc, err := s.tenant(ctx, accountID, tenantID)
	if err != nil {
		return homeapi.TaskSummary{}, err
	}
	now := s.now()
	out := homeapi.TaskSummary{TenantId: tc.TenantID, GeneratedAt: now}
	if s.Tasks == nil {
		return out, nil
	}
	c, err := s.Tasks.TaskCounts(ctx, Query{Tenant: tc, Now: now})
	if err != nil {
		return homeapi.TaskSummary{}, dependency(err)
	}
	out.New, out.InProgress, out.Review, out.MyNew = int64(c.New), int64(c.InProgress), int64(c.Review), int64(c.MyNew)
	return out, nil
}
