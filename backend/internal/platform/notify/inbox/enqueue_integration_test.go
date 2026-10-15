//go:build integration

package inbox_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

func trip(unit uuid.UUID) inbox.Notice {
	return inbox.Notice{
		Kind: "fleet.trip.submitted", Title: "Рейс R-102 сдан", Link: "/fleet/trips/R-102",
		Permission: "fleet.trips.review", Unit: unit,
	}
}

func earnings(unit uuid.UUID) inbox.Notice {
	return inbox.Notice{
		Kind: "fleet.earnings.calculated", Title: "Начисление по рейсу R-102",
		Permission: "fleet.earnings.read", Unit: unit, Sensitivity: inbox.SensitivityRestricted,
	}
}

// S1-26, проверка адресата при постановке: строка пишется, только если адресат сейчас вправе её видеть.
func TestEnqueueChecksAudience(t *testing.T) {
	t.Parallel()
	e := load(t, "inbox_enqueue")
	msk1, msk2 := e.id(t, "unit:a.msk1"), e.id(t, "unit:a.msk2")
	for _, c := range []struct {
		name  string
		actor string
		n     inbox.Notice
		want  inbox.Outcome
	}{
		{"менеджер Москва-1 — своя фирма", "a.manager-msk1", trip(msk1), inbox.Enqueued},
		{"менеджер Москва-1 — фирма-тёзка Москва-2", "a.manager-msk1", trip(msk2), inbox.NotInAudience},
		{"регион Москва с потомками", "a.region-msk", trip(msk1), inbox.Enqueued},
		{"водитель — не менеджер", "a.driver-msk1", trip(msk1), inbox.NotInAudience},
		{"менеджер без права начислений (R-03)", "a.manager-msk1", earnings(msk1), inbox.NotInAudience},
		{"водитель с правом начислений через группу (AC-05)", "a.driver-earnings", earnings(msk1), inbox.NotInAudience},
		{"владелец — начисления", "a.owner", earnings(msk1), inbox.Enqueued},
		{"обычное уведомление без права", "a.driver-msk1", inbox.Notice{Kind: "members.invitation.accepted", Title: "Добро пожаловать"}, inbox.Enqueued},
		{"назначение закончилось", "a.manager-expired", trip(e.id(t, "unit:a.spb1")), inbox.NotInAudience},
		{"назначение ещё не началось по часам приложения", "a.manager-future", trip(e.id(t, "unit:a.spb1")), inbox.NotInAudience},
	} {
		to := e.tc(t, c.actor)
		before := e.count(t, to.PersonID)
		got, id, err := inbox.Enqueue(t.Context(), e.pool(t), e.aud, to, c.n)
		if err != nil || got != c.want {
			t.Errorf("%s: %v, %v; want %v", c.name, got, err, c.want)
			continue
		}
		added := e.count(t, to.PersonID) - before
		if (got == inbox.Enqueued) != (added == 1 && id != uuid.Nil) || (got != inbox.Enqueued && added != 0) {
			t.Errorf("%s: outcome %v, id %s, rows added %d", c.name, got, id, added)
		}
	}
}

// Повтор события outbox не создаёт второе уведомление тому же адресату; системные (без события) не склеиваются.
func TestEnqueueDuplicateEvent(t *testing.T) {
	t.Parallel()
	e := load(t, "inbox_duplicate")
	to := e.tc(t, "a.manager-msk1")
	n := trip(e.id(t, "unit:a.msk1"))
	n.SourceEvent = uuid.New()
	first, id, err := inbox.Enqueue(t.Context(), e.pool(t), e.aud, to, n)
	if err != nil || first != inbox.Enqueued || id == uuid.Nil {
		t.Fatalf("first: %v %s %v", first, id, err)
	}
	again, id2, err := inbox.Enqueue(t.Context(), e.pool(t), e.aud, to, n)
	if err != nil || again != inbox.Duplicate || id2 != uuid.Nil || e.count(t, to.PersonID) != 1 {
		t.Fatalf("repeat: %v %s %v, rows %d", again, id2, err, e.count(t, to.PersonID))
	}
	n.SourceEvent = uuid.Nil
	for range 2 {
		if got, _, err := inbox.Enqueue(t.Context(), e.pool(t), e.aud, to, n); err != nil || got != inbox.Enqueued {
			t.Fatalf("system notice: %v %v", got, err)
		}
	}
	if e.count(t, to.PersonID) != 3 {
		t.Fatalf("rows = %d, want 3", e.count(t, to.PersonID))
	}
}

// Уведомление пишется в транзакции производителя: откат команды — нет уведомления.
func TestEnqueueInProducerTransaction(t *testing.T) {
	t.Parallel()
	e := load(t, "inbox_tx")
	to := e.tc(t, "a.manager-msk1")
	errRollback := errors.New("command failed")
	err := pgx.BeginFunc(t.Context(), e.pool(t), func(tx pgx.Tx) error {
		if got, _, err := inbox.Enqueue(t.Context(), tx, e.aud, to, trip(e.id(t, "unit:a.msk1"))); err != nil || got != inbox.Enqueued {
			t.Fatalf("enqueue: %v %v", got, err)
		}
		return errRollback
	})
	if !errors.Is(err, errRollback) || e.count(t, to.PersonID) != 0 {
		t.Fatalf("rollback: %v, rows %d", err, e.count(t, to.PersonID))
	}
}

// Архивный профиль сотрудника и неверное уведомление: строки нет.
func TestEnqueueRejects(t *testing.T) {
	t.Parallel()
	e := load(t, "inbox_reject")
	to := e.tc(t, "a.manager-msk2")
	if _, err := e.super(t).ExecContext(t.Context(), `update people.person_profiles set archived_at = now() where id = $1`, to.PersonID); err != nil {
		t.Fatal(err)
	}
	plain := inbox.Notice{Kind: "members.invitation.accepted", Title: "Добро пожаловать"}
	if got, _, err := inbox.Enqueue(t.Context(), e.pool(t), e.aud, to, plain); err != nil || got != inbox.NotInAudience {
		t.Errorf("archived person: %v %v", got, err)
	}
	owner := e.tc(t, "a.owner")
	bad := plain
	bad.Link = "//evil.example"
	if _, _, err := inbox.Enqueue(t.Context(), e.pool(t), e.aud, owner, bad); !errors.Is(err, inbox.ErrInvalid) {
		t.Errorf("bad link: %v", err)
	}
	if _, _, err := inbox.Enqueue(t.Context(), e.pool(t), e.aud, tenantctx.TenantContext{TenantID: owner.TenantID}, plain); !errors.Is(err, inbox.ErrInvalid) {
		t.Errorf("no person: %v", err)
	}
	if e.count(t, owner.PersonID) != 0 || e.count(t, to.PersonID) != 0 {
		t.Error("rows were written")
	}
}

// Адресат по профилю сотрудника: активное членство и владение — из control DB.
func TestPGRecipients(t *testing.T) {
	t.Parallel()
	e := load(t, "inbox_recipients")
	r := inbox.PGRecipients{Control: e.control}
	tenantA := e.id(t, "tenant:a")
	for _, actor := range []string{"a.owner", "a.manager-msk1", "ab.member"} {
		want := e.tc(t, actor)
		got, err := r.Recipient(t.Context(), tenantA, want.PersonID)
		if err != nil || got != want {
			t.Errorf("%s: %+v %v; want %+v", actor, got, err, want)
		}
	}
	foreign := e.id(t, "person:b.owner@b")
	if _, err := r.Recipient(t.Context(), tenantA, foreign); !errors.Is(err, inbox.ErrNoRecipient) {
		t.Errorf("person of tenant B in A: %v", err)
	}
	if _, err := r.Recipient(t.Context(), tenantA, uuid.New()); !errors.Is(err, inbox.ErrNoRecipient) {
		t.Errorf("unknown person: %v", err)
	}
	m := e.tc(t, "a.manager-msk2")
	ctl := e.w.Cluster.DB(t, e.w.ControlDB, migratetest.Super)
	if _, err := ctl.ExecContext(t.Context(), `update memberships set status = 'suspended' where id = $1`, m.MembershipID); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Recipient(t.Context(), tenantA, m.PersonID); !errors.Is(err, inbox.ErrNoRecipient) {
		t.Errorf("suspended membership: %v", err)
	}
}
