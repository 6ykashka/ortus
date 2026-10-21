//go:build integration

package main

// W4.31 (возврат 1): cmd/worker под ролью ortus_worker на Go-сиде «Альты» проверяет сроки пересмотра «Базы знаний»
// по расписанию — с 09:00 по Москве часов приложения (APP_FIXED_NOW), раз в день, от имени включившего правило
// «Пора пересмотреть»: статус «Пора пересмотреть», строка журнала, событие kb.review.due.v1, уведомление владельцу
// страницы во «Входящих» (получатель — активный участник по контрольной БД).

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

//nolint:paralleltest // the worker runs over every seeded tenant
func TestRunKnowledgeReview(t *testing.T) {
	ctx := t.Context()
	alta, control := superDB(t, "t_alta"), superDB(t, controlDB)
	var page, rule, pageOwner, owner uuid.UUID
	if err := alta.QueryRowContext(ctx, `select n.id, r.id, n.owner_id from kb.nodes n
		join kb.rules r on r.space_id = n.space_id and r.kind = 'review' and r.enabled
		where n.title = 'Как фотографировать машину при осмотре'`).Scan(&page, &rule, &pageOwner); err != nil {
		t.Fatal(err)
	}
	// The owner of the business now (TestRunOwnerNotice may have passed the ownership) switched the rule on.
	if err := control.QueryRowContext(ctx, `select m.person_profile_id from owner_bindings b join memberships m on m.id = b.membership_id
		where m.tenant_id = $1 and b.revoked_at is null`, seedAlta).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if _, err := alta.ExecContext(ctx, `update kb.rules set enabled_by = $2 where id = $1`, rule, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := alta.ExecContext(ctx, `update kb.nodes set status = 'active', review_by = '2027-01-10' where id = $1`, page); err != nil {
		t.Fatal(err)
	}

	// The worker of the other tests (the system clock) may have checked the page already: only the events of this run.
	lastEvent := count(t, alta, `select coalesce(max(id), 0) from outbox.events`)

	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan int, 1)
	var out, errOut bytes.Buffer
	env := workerEnv(map[string]string{
		"APP_FIXED_NOW": "2027-01-15T09:30:00+03:00", "WORKER_POOL_INTERVAL": "0", "WORKER_PURGE_INTERVAL": "0",
		"WORKER_KB_REVIEW_INTERVAL": "100ms",
	})
	go func() { done <- run(runCtx, []string{"run"}, env, &out, &errOut) }()
	slot := `ran_at >= '2027-01-15 09:00+03'`
	for deadline := time.Now().Add(15 * time.Second); count(t, alta, `select count(*) from kb.runs where rule_id = $1 and `+slot, rule) == 0; {
		if time.Now().After(deadline) {
			cancel()
			<-done
			t.Fatalf("no scheduled check; stderr %s; log %s", errOut.String(), out.String())
		}
		time.Sleep(100 * time.Millisecond)
	}
	time.Sleep(500 * time.Millisecond) // a few more looks of the job: the check of the day stays one
	cancel()
	if code := <-done; code != exitOK {
		t.Fatalf("run after SIGTERM: exit %d, stderr %s", code, errOut.String())
	}

	if n := count(t, alta, `select count(*) from kb.runs where rule_id = $1 and result = 'ok' and text =
		'«Как фотографировать машину при осмотре»: срок пересмотра 10.01.2027, уведомлён владелец Марина Котова' and `+slot, rule); n != 1 {
		t.Errorf("lines of the check of the day: %d, want 1; log %s", n, out.String())
	}
	if n := count(t, alta, `select count(*) from kb.runs where rule_id = $1 and `+slot, rule); n != 1 {
		t.Errorf("the check ran %d times, want once a day", n)
	}
	if n := count(t, alta, `select count(*) from kb.nodes where id = $1 and status = 'outdated'`, page); n != 1 {
		t.Error("the page is not «Пора пересмотреть»")
	}
	if n := count(t, alta, `select count(*) from outbox.events where type = 'kb.review.due.v1' and aggregate_id = $1
		and payload->>'actorId' = $2 and id > $3`, page, owner.String(), lastEvent); n != 1 {
		t.Errorf("kb.review.due.v1 as the member who switched the rule on: %d, want 1", n)
	}
	if n := count(t, alta, `select count(*) from notify.notifications where kind = 'kb.review.due' and recipient_person_id = $1
		and title = 'Пора пересмотреть «Как фотографировать машину при осмотре»: срок был 10.01.2027'`, pageOwner); n != 1 {
		t.Errorf("notifications of the owner of the page: %d, want 1", n)
	}
}
