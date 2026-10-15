//go:build integration

package operators

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
)

// journal is a control DB with two tenants, two operators and a row of every target type.
type journal struct {
	*stand
	owner, support, alta, lotos uuid.UUID
}

func newJournal(t *testing.T) journal {
	t.Helper()
	s := newStand(t)
	j := journal{stand: s, owner: s.operator(RoleOwner, "active"), support: s.operator(RoleSupport, "active"),
		alta: s.tenant("alta", StateTrial, now.Add(-day)), lotos: s.tenant("lotos", StateActive, now.Add(-day))}
	var opRow uuid.UUID
	must(t, s.admin.QueryRowContext(t.Context(), `select id from platform_operators where account_id = $1`, j.support).Scan(&opRow))
	for _, r := range []struct {
		kind   string
		actor  any
		action string
		target string
		id     any
		reason string
		raw    string
	}{
		{"operator", j.owner, "tenant.create", "tenant", j.alta, "", `{"ownerEmail": "owner@alta.example", "planKey": "start", "requestHash": "abc"}`},
		{"system", nil, "subscription.trial_ended", "subscription", j.alta, "", `{"fromStatus": "trialing", "toStatus": "grace", "at": "2026-09-30T00:00:00Z"}`},
		{"operator", j.owner, "operator.role_changed", "operator", opRow, "", `{}`},
		{"operator", j.owner, "price_book.published", "price_book", uuid.New(), "", `{}`},
		{"operator", j.owner, "account.locked", "account", j.support, "Жалоба", `{}`},
		{"operator", j.owner, "tenant.suspended", "tenant", j.lotos, "Неоплата", `{"fromStatus": "active", "toStatus": "suspended"}`},
		{"system", nil, "tenant.provision", "tenant", j.alta, "", `{"step": "migrate", "error": "connect secret", "days": 3}`},
	} {
		s.exec(`insert into platform_audit (actor_kind, actor_id, action, target_type, target_id, reason, result, request_id, details)
values ($1, $2, $3, $4, $5, nullif($6, ''), 'ok', 'seed', $7::jsonb)`, r.kind, r.actor, r.action, r.target, r.id, r.reason, r.raw)
	}
	return j
}

func actions(p AuditPage) []string {
	out := make([]string, 0, len(p.Items))
	for _, e := range p.Items {
		out = append(out, e.Action)
	}
	return out
}

// T-04: журнал — новые сверху, строки по праву роли на тип цели, имена актора и цели, белый список details.
func TestAuditEvents(t *testing.T) {
	t.Parallel()
	j := newJournal(t)
	page, err := j.svc.AuditEvents(t.Context(), AuditQuery{ActorID: j.owner, Limit: 50})
	must(t, err)
	eq(t, "owner", actions(page), []string{"tenant.provision", "tenant.suspended", "account.locked", "price_book.published",
		"operator.role_changed", "subscription.trial_ended", "tenant.create"})
	eq(t, "next", page.Next, "")
	byAction := map[string]AuditEvent{}
	for _, e := range page.Items {
		e.At = now // the database clock
		byAction[e.Action] = e
	}
	alta, owner := j.alta, j.owner
	eq(t, "tenant.create", byAction["tenant.create"], AuditEvent{
		ID: 1, At: now, ActorKind: "operator", ActorID: &owner, ActorName: "Оператор owner", Action: "tenant.create",
		TargetType: TargetTenant, TargetID: &alta, TargetTenantID: &alta, TargetName: "Организация alta", Result: "ok",
		Details: map[string]string{"planKey": "start"},
	})
	eq(t, "trial_ended", byAction["subscription.trial_ended"], AuditEvent{
		ID: 2, At: now, ActorKind: "system", Action: "subscription.trial_ended", TargetType: TargetSubscription, TargetTenantID: &alta,
		TargetName: "Организация alta", Result: "ok",
		Details: map[string]string{"fromStatus": "trialing", "toStatus": "grace", "at": "2026-09-30T00:00:00Z"},
	})
	eq(t, "provision details", byAction["tenant.provision"].Details, map[string]string{"days": "3"})
	eq(t, "account", [3]any{byAction["account.locked"].TargetName, byAction["account.locked"].TargetTenantID, byAction["account.locked"].Reason},
		[3]any{"support@ortus.example", (*uuid.UUID)(nil), "Жалоба"})
	eq(t, "operator", byAction["operator.role_changed"].TargetName, "Оператор support")

	page, err = j.svc.AuditEvents(t.Context(), AuditQuery{ActorID: j.support, Limit: 50})
	must(t, err)
	eq(t, "support", actions(page), []string{"tenant.provision", "tenant.suspended", "account.locked", "subscription.trial_ended", "tenant.create"})
}

// T-04: фильтр организации и курсор: страницы, курсор привязан к оператору и фильтру, неизвестная организация — 404,
// не оператор — 404.
func TestAuditEventsPages(t *testing.T) {
	t.Parallel()
	j := newJournal(t)
	first, err := j.svc.AuditEvents(t.Context(), AuditQuery{ActorID: j.owner, TenantID: &j.alta, Limit: 2})
	must(t, err)
	eq(t, "page 1", actions(first), []string{"tenant.provision", "subscription.trial_ended"})
	second, err := j.svc.AuditEvents(t.Context(), AuditQuery{ActorID: j.owner, TenantID: &j.alta, Limit: 2, Cursor: first.Next})
	must(t, err)
	eq(t, "page 2", [2]any{actions(second), second.Next}, [2]any{[]string{"tenant.create"}, ""})
	missing := uuid.New()
	for name, c := range map[string]struct {
		q    AuditQuery
		want error
	}{
		"cursor of another operator": {AuditQuery{ActorID: j.support, TenantID: &j.alta, Limit: 2, Cursor: first.Next}, ErrBadCursor},
		"cursor without the filter":  {AuditQuery{ActorID: j.owner, Limit: 2, Cursor: first.Next}, ErrBadCursor},
		"unknown tenant":             {AuditQuery{ActorID: j.owner, TenantID: &missing, Limit: 10}, tenants.ErrUnknownTenant},
		"not an operator":            {AuditQuery{ActorID: uuid.New(), Limit: 10}, ErrNotOperator},
	} {
		_, err := j.svc.AuditEvents(t.Context(), c.q)
		is(t, name, err, c.want)
	}
}
