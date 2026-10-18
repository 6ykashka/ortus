// Package org is the source of the organization for «Требует решения» (W2.54, S2-18 п. 1; MSW tenantSource of
// fleet/home.ts, W2.00): the trial of the business, its storage and the members without a role — for the owner only.
// The cards are those of the example getMyDecisionQueue/ok; the client (W2.25 sources/tenant.ts, sources/access.ts)
// builds their texts.
package org

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry this source plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
)

// Kinds of the cards (api/openapi/components/home/schemas.yaml DecisionItem.kind) and their module keys.
const (
	KindTrialEnded         = "tenant.trial_ended"
	KindTrialEnding        = "tenant.trial_ending"
	KindStorageHigh        = "tenant.storage_high"
	KindMembersWithoutRole = "access.members_without_role"

	moduleBilling = "billing" // «Модули и место»
	moduleMembers = "members" // «Пользователи и роли»
)

// Statuses of a subscription (Subscription.status of the contract).
const (
	StatusTrialing = "trialing"
	StatusGrace    = "grace"
	StatusReadOnly = "read_only"
)

// trialNotice is how long before its end a trial shows (MSW: 0…14 whole days left).
const trialNotice = 14

// storageHigh is the share of the limit above which the storage shows (MSW: more than 85 %).
const storageHigh = 0.85

// actionMembers is the action of the list of people the card leads to (api/permissions.yaml).
const actionMembers = "members.read"

// maxNames bounds the names on the card (a business of the pilot has tens of people); the count is not bounded.
const maxNames = 200

const day = 24 * time.Hour

// Subscription is what the source reads of the subscription of a business: its status and the end of its trial.
type Subscription struct {
	Status      string
	TrialEndsAt *time.Time
}

// Subscriptions reads the subscription of a business (control/subscriptions in cmd/api: a module does not import the
// control plane).
type Subscriptions interface {
	Subscription(ctx context.Context, tenantID uuid.UUID) (Subscription, error)
}

// Control is the control DB (*pgxpool.Pool as ortus_api): the memberships of the business.
type Control interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Source reads the cards of the organization: the subscription, the storage of the tenant DB (files.usage) and the
// members without a role (memberships of the control DB, grants of the tenant DB under the scope of members.read).
type Source struct {
	Pools         scopeddb.Pools  // tenantctx.Pools
	Authz         scopeddb.Scoper // *authz.Evaluator
	Control       Control
	Subscriptions Subscriptions
	MaxNames      int // the names on the card of the members without a role; 0 — maxNames
}

var _ home.Source = Source{}

// Module implements home.Source: a core source, asked always.
func (Source) Module() string { return "" }

// Cards implements home.Source: for the owner the trial, the storage and the members without a role, in this order
// (MSW); anybody else gets none and nothing is read.
func (s Source) Cards(ctx context.Context, q home.Query) ([]homeapi.DecisionItem, error) {
	out := []homeapi.DecisionItem{}
	if !q.Tenant.Owner {
		return out, nil
	}
	tenant := q.Tenant.TenantID
	sub, err := s.Subscriptions.Subscription(ctx, tenant)
	if err != nil {
		return nil, fmt.Errorf("home/org: subscription: %w", err)
	}
	out = append(out, trialCards(tenant, sub, q.Now)...)
	pool, err := s.Pools.For(ctx, tenant)
	if err != nil {
		return nil, err
	}
	used, quota, err := usage(ctx, pool)
	if err != nil {
		return nil, err
	}
	out = append(out, storageCard(tenant, used, quota)...)
	count, names, err := s.withoutRole(ctx, q)
	if err != nil {
		return nil, err
	}
	return append(out, membersCard(tenant, count, names)...), nil
}

func card(kind, module string, tenant uuid.UUID, tone homeapi.DecisionItemTone, params map[string]string) homeapi.DecisionItem {
	return homeapi.DecisionItem{Key: kind + ":" + tenant.String(), Kind: kind, ModuleKey: module, Tone: tone, Params: params}
}

// trialCards: a business in grace or read_only — the trial ended (danger); a trial with 0…14 whole days left — the
// days and the end (neutral); otherwise none. A trial past its end that the lifecycle has not moved yet gives none.
func trialCards(tenant uuid.UUID, sub Subscription, now time.Time) []homeapi.DecisionItem {
	switch {
	case sub.Status == StatusGrace || sub.Status == StatusReadOnly:
		return []homeapi.DecisionItem{card(KindTrialEnded, moduleBilling, tenant, homeapi.Danger, map[string]string{})}
	case sub.Status != StatusTrialing || sub.TrialEndsAt == nil:
		return nil
	}
	left := math.Floor(float64(sub.TrialEndsAt.Sub(now)) / float64(day))
	if left < 0 || left > trialNotice {
		return nil
	}
	return []homeapi.DecisionItem{card(KindTrialEnding, moduleBilling, tenant, homeapi.Neutral, map[string]string{
		"daysLeft": strconv.Itoa(int(left)), "trialEndsAt": sub.TrialEndsAt.UTC().Format(time.RFC3339),
	})}
}

// storageCard: more than 85 % of the limit taken — warn, the whole limit — danger.
func storageCard(tenant uuid.UUID, used, quota int64) []homeapi.DecisionItem {
	if quota <= 0 || float64(used)/float64(quota) <= storageHigh {
		return nil
	}
	tone := homeapi.Warn
	if used >= quota {
		tone = homeapi.Danger
	}
	return []homeapi.DecisionItem{card(KindStorageHigh, moduleBilling, tenant, tone, map[string]string{
		"percent":    strconv.Itoa(int(math.Round(float64(used) / float64(quota) * 100))),
		"usedBytes":  strconv.FormatInt(used, 10),
		"quotaBytes": strconv.FormatInt(quota, 10),
	})}
}

// membersCard: the members without a role — all of them counted, the first of them named.
func membersCard(tenant uuid.UUID, count int, names []string) []homeapi.DecisionItem {
	if count == 0 {
		return nil
	}
	return []homeapi.DecisionItem{card(KindMembersWithoutRole, moduleMembers, tenant, homeapi.Neutral, map[string]string{
		"count": strconv.Itoa(count), "names": strings.Join(names, ", "),
	})}
}

// usage reads the committed bytes and the limit of the files of the tenant (files.usage, W1.09); no row — nothing
// uploaded yet, no card.
func usage(ctx context.Context, pool *pgxpool.Pool) (used, quota int64, err error) {
	err = pool.QueryRow(ctx, `select committed_bytes, limit_bytes from files.usage where singleton`).Scan(&used, &quota)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return 0, 0, nil
	case err != nil:
		return 0, 0, fmt.Errorf("home/org: usage: %w", err)
	}
	return used, quota, nil
}

// activeSQL: the people of the active memberships of the business (control DB) that do not own it — owning is not a
// role and reaches every module (owner_bindings, AUTH-08) — and the member of the query excepted.
const activeSQL = `
select m.person_profile_id from memberships m
 where m.tenant_id = $1 and m.status = 'active' and m.person_profile_id is not null and m.person_profile_id <> $2
   and not exists (select 1 from owner_bindings o
                    where o.tenant_id = m.tenant_id and o.membership_id = m.id and o.revoked_at is null)`

// withoutRoleSQL: of the people ($1) those not archived without a grant active now ($2) with the scope of the
// business, a unit or «своё» — directly or through a group (a project role gives no access to the modules, PD-53),
// sorted by name as the list of people (listMembers): the first $3 names, each row with the count of all of them.
const withoutRoleSQL = `
select p.full_name, count(*) over () from people.person_profiles p
 where p.id = any($1) and p.archived_at is null
   and not exists (
         select 1 from access.role_assignments a
          where a.state = 'active' and a.valid @> $2::timestamptz and a.scope_kind <> 'project'
            and ((a.principal_kind = 'person' and a.principal_id = p.id)
              or (a.principal_kind = 'group'
                  and a.principal_id in (select g.group_id from access.group_members g where g.person_id = p.id))))
   and ` + scopeddb.Placeholder + `
 order by p.full_name, p.id
 limit $3`

// persons are the columns the scope predicate filters the people on (as the people of W1.05).
var persons = authz.Columns{Unit: "p.home_unit_id", Persons: []string{"p.id"}}

// withoutRole returns the number of the active members of the business of q without a role and the first of their
// names (MaxNames, by default maxNames).
func (s Source) withoutRole(ctx context.Context, q home.Query) (int, []string, error) {
	rows, err := s.Control.Query(ctx, activeSQL, q.Tenant.TenantID, q.Tenant.PersonID)
	if err != nil {
		return 0, nil, fmt.Errorf("home/org: memberships: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, nil, fmt.Errorf("home/org: memberships: %w", err)
	}
	if len(ids) == 0 {
		return 0, nil, nil
	}
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, q.Tenant)
	if err != nil {
		return 0, nil, err
	}
	limit := s.MaxNames
	if limit <= 0 {
		limit = maxNames
	}
	rows, err = conn.Query(ctx, actionMembers, persons, withoutRoleSQL, ids, q.Now, limit)
	if err != nil {
		return 0, nil, fmt.Errorf("home/org: members without a role: %w", err)
	}
	var (
		count int
		name  string
		names []string
	)
	_, err = pgx.ForEachRow(rows, []any{&name, &count}, func() error {
		names = append(names, name)
		return nil
	})
	if err != nil {
		return 0, nil, fmt.Errorf("home/org: members without a role: %w", err)
	}
	return count, names, nil
}
