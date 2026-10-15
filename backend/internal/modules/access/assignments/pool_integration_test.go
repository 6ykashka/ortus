//go:build integration

package assignments_test

// W1.47 (Q-W1.41-9): команды модели доступа под пулом tenant из tenantctx.DefaultMaxConns (4) соединений, как в
// cmd/api. Команда держит строку access.policy_state (kit.LockPolicy) и проверяет права актора оценщиком; если
// оценщик берёт второе соединение пула, четыре команды, занявшие весь пул (одна — со строкой политики, три — в очереди
// за ней), ждут друг друга бесконечно.

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments"            //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/groups"                 //nolint:depguard // the group commands of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/roles"                  //nolint:depguard // the role commands of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail/mailtest"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// commandWait bounds every command: a command stuck in the deadlock fails at this deadline (503) instead of hanging
// the suite.
const commandWait = 15 * time.Second

// commandsPerKind is how many commands of each kind run at once: 4 kinds × 3 = 12 commands over 4 connections.
const commandsPerKind = 3

// poolWorld: администратор доступа региона Москва — участник, не владелец (его проверки идут в оценщик, а не мимо
// него, как у владельца); для каждой команды — своя роль, группа с ролью и адрес приглашения, чтобы команды не
// конфликтовали по ревизиям и адресам и все заканчивались успехом.
type poolWorld struct {
	*world
	actor  tenantctx.TenantContext
	a      *assignments.Handler
	r      *roles.Handler
	g      *groups.Handler
	roles  []uuid.UUID
	groups []uuid.UUID
	pool   *pgxpool.Pool
}

func newPoolWorld(t *testing.T, srv *mailtest.Server) *poolWorld {
	t.Helper()
	w := &poolWorld{world: newWorld(t)}
	admin := w.Member("Администратор доступа", "access@alta.example", w.region)
	full := w.Role("Доступ региона", "custom", "", "roles.read", "roles.assign", "members.read", "members.invite", "members.manage",
		"fleet.trips.read", "fleet.trips.review")
	w.Assign(accesstest.Grant{Principal: admin, Role: full, Kind: "unit", Ref: w.region, Descendants: true})
	w.actor = w.TC(admin)
	for i := range commandsPerKind {
		role := w.Role(fmt.Sprintf("Рейсы %d", i+1), "custom", "", "fleet.trips.read")
		w.Assign(accesstest.Grant{Principal: w.m1, Role: role, Kind: "unit", Ref: w.f1, Descendants: true})
		w.roles = append(w.roles, role)
		group := w.Group(fmt.Sprintf("Смена %d", i+1), w.f1)
		w.Assign(accesstest.Grant{Group: true, Principal: group, Role: w.trips, Kind: "unit", Ref: w.f1, Descendants: true})
		w.groups = append(w.groups, group)
	}
	pool := w.SmallPool(tenantctx.DefaultMaxConns)
	d := w.DepsOver(pool)
	w.pool = pool
	w.a = assignments.New(d).WithInvitationMail(mail.Invitations{Origin: stand, Sender: &mail.SMTP{Config: mail.Config{
		Host: srv.Host, Port: srv.Port, From: "no-reply@ortus.local", AllowPlain: true, Timeout: 10 * time.Second,
	}}})
	w.r, w.g = roles.New(d), groups.New(d)
	return w
}

// commands are the twelve commands of the actor: createAssignment, updateRole (a new right for the holders of the
// role), setGroupMembers (a new member of a group with a role) and inviteMember (with a role; its letter goes to a
// slow SMTP server).
func (w *poolWorld) commands() map[string]func(ctx context.Context) error {
	targets := []struct {
		person, role uuid.UUID
		unit         uuid.UUID
	}{{w.m1, w.trips, w.f1}, {w.m2, w.trips, w.f2}, {w.m1, w.review, w.f1}}
	out := map[string]func(ctx context.Context) error{}
	for i := range commandsPerKind {
		target, role, group := targets[i], w.roles[i], w.groups[i]
		out[fmt.Sprintf("createAssignment %d", i+1)] = func(ctx context.Context) error {
			body := member(target.person, target.role, unitScope(target.unit, true))
			_, err := w.a.CreateAssignment(ctx, accessapi.CreateAssignmentRequestObject{TenantId: w.TenantID, Body: &body})
			return err
		}
		out[fmt.Sprintf("updateRole %d", i+1)] = func(ctx context.Context) error {
			perms := []string{"fleet.trips.read", "fleet.trips.review"}
			req := accessapi.UpdateRoleRequestObject{TenantId: w.TenantID, RoleId: role, Body: &accessapi.RolePatch{Permissions: &perms}}
			req.Params.IfMatch = `"1"`
			_, err := w.r.UpdateRole(ctx, req)
			return err
		}
		out[fmt.Sprintf("setGroupMembers %d", i+1)] = func(ctx context.Context) error {
			req := accessapi.SetGroupMembersRequestObject{TenantId: w.TenantID, GroupId: group,
				Body: &accessapi.GroupMembersUpdate{MemberIds: []uuid.UUID{w.m1}}}
			req.Params.IfMatch = `"1"`
			_, err := w.g.SetGroupMembers(ctx, req)
			return err
		}
		out[fmt.Sprintf("inviteMember %d", i+1)] = func(ctx context.Context) error {
			body := invitation(fmt.Sprintf("Сотрудник %d", i+1), fmt.Sprintf("staff%d@alta.example", i+1), w.f1,
				accessapi.InvitationRole{RoleId: w.trips, Scope: unitScope(w.f1, true)})
			_, err := w.a.InviteMember(ctx, accessapi.InviteMemberRequestObject{TenantId: w.TenantID, Body: &body})
			return err
		}
	}
	return out
}

// Двенадцать команд модели доступа участника-администратора над пулом из четырёх соединений: строка политики
// сначала занята (как параллельной командой), все четыре соединения стоят в очереди за ней; после её освобождения
// каждая команда заканчивается успехом за срок — ни одна не ждёт второго соединения, держа строку политики.
// Письма приглашений уходят медленно (SMTP держит DATA) — после COMMIT, без соединений команды.
func TestAccessCommandsUnderSmallPool(t *testing.T) {
	t.Parallel()
	srv := mailtest.Start(t, mailtest.Options{})
	_, release := srv.Hold("DATA")
	defer release()
	w := newPoolWorld(t, srv)
	before := w.PolicyVersion()
	held := w.HoldPolicy("")
	calls := map[string]*accesstest.Async{}
	start := time.Now()
	for name, fn := range w.commands() {
		calls[name] = accesstest.Go(func() error {
			ctx, cancel := context.WithTimeout(w.Ctx(w.actor), commandWait)
			defer cancel()
			return fn(ctx)
		})
	}
	saturated := time.Now().Add(commandWait)
	for w.pool.Stat().AcquiredConns() < tenantctx.DefaultMaxConns && time.Now().Before(saturated) {
		time.Sleep(10 * time.Millisecond)
	}
	if n := w.pool.Stat().AcquiredConns(); n < tenantctx.DefaultMaxConns {
		t.Fatalf("the commands hold %d connections of %d", n, tenantctx.DefaultMaxConns)
	}
	if err := held.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	time.AfterFunc(300*time.Millisecond, release) // the SMTP server answers DATA late
	for name, call := range calls {
		if err := call.Wait(); err != nil {
			t.Errorf("%s after %s: %s", name, time.Since(start).Round(time.Millisecond), accesstest.Problem(err))
		}
	}
	if t.Failed() {
		return
	}
	if got := len(srv.Wait(t, commandsPerKind)); got != commandsPerKind {
		t.Errorf("letters: %d, want %d", got, commandsPerKind)
	}
	// createAssignment, updateRole and setGroupMembers change somebody's rights: each bumps the policy version once.
	if got, want := w.PolicyVersion()-before, int64(3*commandsPerKind); got != want {
		t.Errorf("policy version + %d, want + %d", got, want)
	}
	if n := w.Count(`select 1 from access.group_members where person_id = $1`, w.m1); n != commandsPerKind {
		t.Errorf("groups of the new member: %d, want %d", n, commandsPerKind)
	}
}
