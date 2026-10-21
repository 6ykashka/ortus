//go:build integration

package knowledge

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The daily check of the review dates (review of W4.31, return 1): the rule «Пора пересмотреть страницу → уведомить
// владельца» runs «По расписанию · каждый день в 09:00» (knowledge.js:291, Moscow, the clock of the application) as
// the member who switched it on, with his rights checked at each run (setKnowledgeRuleEnabled), and writes what
// «Проверить сроки сейчас» writes: the status, the event, the notification of the owner, the line of the journal. It
// runs after the commands of write_integration_test.go: kb-2 is already «Пора пересмотреть», kr-2 of «Логистика» is
// on (switched on by the owner of the business in the seed), kr-5 of «Ремонт и стройка» is off.

// scheduled runs the scheduled check of tenant A at the moment now (RFC 3339) with notifications.
func scheduled(t *testing.T, now string) []ReviewRun {
	t.Helper()
	at, err := time.Parse(time.RFC3339, now)
	require.NoError(t, err)
	s := &Service{Pools: pools, Memberships: memberships, Relations: relations{}, Recipients: recipients{}, Audience: everyone{},
		Now: func() time.Time { return at }}
	runs, err := s.ScheduledReview(t.Context(), tenantA)
	require.NoError(t, err)
	return runs
}

// lastRun is the result and the text of the newest line of the journal of a rule.
func lastRun(t *testing.T, rule string) (string, string) {
	t.Helper()
	var res, text string
	require.NoError(t, superA.QueryRow(t.Context(), `select result, text from kb.runs where rule_id = $1 order by ran_at desc, id desc
		limit 1`, pid(rule)).Scan(&res, &text))
	return res, text
}

func TestWriteScheduledReview(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	ctx := t.Context()
	runs := func() int { return scalar[int](t, `select count(*) from kb.runs where rule_id = $1`, pid("kr-2")) }
	require.Equal(t, pid("m-owner"), scalar[uuid.UUID](t, `select enabled_by from kb.rules where id = $1`, pid("kr-2")))
	require.NoError(t, exec(ctx, `update kb.nodes set review_by = '2026-10-05', status = 'active', archived_at = null, archived_by = null
		where id = $1`, pid("kb-1")))
	require.NoError(t, exec(ctx, `update kb.nodes set status = 'outdated' where id = $1`, pid("kb-2"))) // as after TestWriteAutomation
	title := scalar[string](t, `select title from kb.nodes where id = $1`, pid("kb-1"))

	before := runs()
	assert.Empty(t, scheduled(t, "2026-10-05T08:59:00+03:00"), "before 09:00 in Moscow")
	assert.Equal(t, before, runs())
	assert.Equal(t, "active", scalar[string](t, `select status from kb.nodes where id = $1`, pid("kb-1")))

	got := scheduled(t, "2026-10-05T06:00:00Z") // 09:00 in Moscow
	assert.Equal(t, []ReviewRun{{Space: pid("sp-log"), Rule: pid("kr-2"), Due: 1, Result: "ok"}}, got, "kr-5 is off")
	assert.Equal(t, "outdated", scalar[string](t, `select status from kb.nodes where id = $1`, pid("kb-1")))
	res, text := lastRun(t, "kr-2")
	assert.Equal(t, "ok", res)
	assert.Equal(t, "«"+title+"»: срок пересмотра 05.10.2026, уведомлён владелец Дарья Зимина", text)
	assert.Equal(t, pid("m-owner").String(), scalar[string](t, `select payload->>'actorId' from outbox.events
		where type = 'kb.review.due.v1' and aggregate_id = $1 order by id desc limit 1`, pid("kb-1")),
		"the rule runs as the member who switched it on")
	assert.Equal(t, 1, scalar[int](t, `select count(*) from notify.notifications where kind = 'kb.review.due'
		and recipient_person_id = $1 and title = $2`, pid("m-owner"), "Пора пересмотреть «"+title+"»: срок был 05.10.2026"))

	after := runs()
	assert.Empty(t, scheduled(t, "2026-10-05T15:00:00+03:00"), "once a day")
	assert.Equal(t, after, runs())

	got = scheduled(t, "2026-10-06T09:01:00+03:00")
	assert.Equal(t, []ReviewRun{{Space: pid("sp-log"), Rule: pid("kr-2"), Due: 0, Result: "stopped"}}, got)
	res, text = lastRun(t, "kr-2")
	assert.Equal(t, "stopped", res)
	assert.Equal(t, "Остановлено условием: сроки пересмотра не наступили", text)

	// The rights of the member who switched the rule on are checked at each run.
	require.NoError(t, exec(ctx, `update kb.nodes set review_by = '2026-10-06', status = 'active' where id = $1`, pid("kb-1")))
	require.NoError(t, exec(ctx, `update kb.rules set enabled_by = $2 where id = $1`, pid("kr-2"), pid("m-vasiliev")))
	got = scheduled(t, "2026-10-07T09:00:00+03:00")
	assert.Equal(t, []ReviewRun{{Space: pid("sp-log"), Rule: pid("kr-2"), Due: 0, Result: "error"}}, got)
	res, text = lastRun(t, "kr-2")
	assert.Equal(t, "error", res)
	assert.Equal(t, "У автора правила Илья Васильев нет права проверять сроки пересмотра: это может руководитель пространства или "+
		"владелец бизнеса", text)
	assert.Equal(t, "active", scalar[string](t, `select status from kb.nodes where id = $1`, pid("kb-1")), "nothing is marked")

	require.NoError(t, exec(ctx, `update kb.rules set enabled_by = $2 where id = $1`, pid("kr-2"), pid("m-gromov")))
	scheduled(t, "2026-10-08T09:00:00+03:00")
	_, text = lastRun(t, "kr-2")
	assert.Equal(t, "У автора правила Кирилл Громов нет права проверять сроки пересмотра: сотрудник заблокирован", text)

	require.NoError(t, exec(ctx, `update kb.rules set enabled_by = null where id = $1`, pid("kr-2")))
	scheduled(t, "2026-10-09T09:00:00+03:00")
	_, text = lastRun(t, "kr-2")
	assert.Equal(t, "У автора правила нет права проверять сроки пересмотра: правило никто не включал", text)

	// A rule switched off is not run; the owner of the business switching it on again runs it the next day.
	require.NoError(t, exec(ctx, `update kb.rules set enabled = false, enabled_by = $2 where id = $1`, pid("kr-2"), pid("m-owner")))
	assert.Empty(t, scheduled(t, "2026-10-10T09:00:00+03:00"))
	require.NoError(t, exec(ctx, `update kb.rules set enabled = true where id = $1`, pid("kr-2")))
	got = scheduled(t, "2026-10-11T09:00:00+03:00")
	assert.Equal(t, []ReviewRun{{Space: pid("sp-log"), Rule: pid("kr-2"), Due: 1, Result: "ok"}}, got)
}
