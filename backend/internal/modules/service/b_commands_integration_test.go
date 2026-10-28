//go:build integration

package service_test

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/modules/service" //nolint:depguard // the package under test
)

// at gives a service whose clock stands at t.
func (e env) at(t time.Time) env {
	s := *e.svc
	s.Now = func() time.Time { return t }
	e.svc = &s
	return e
}

// call creates a request by a call in ГРЗ as actor and returns it.
func (e env) call(t *testing.T, actor, typ, phone, text string) api.ServiceRequest {
	t.Helper()
	x, err := e.svc.CreateRequest(t.Context(), e.tc(t, actor), &api.ServiceRequestCreate{DirectionId: demoID("d-grz"), TypeId: typ, ClientName: "Пётр Новиков",
		Phone: phone, Text: text})
	if err != nil {
		t.Fatal(err)
	}
	return x
}

func rev(x api.ServiceRequest) string { return `"rev-` + strconv.FormatInt(x.Revision, 10) + `"` }

// keyNum is the number of a key: «ГРЗ-58» → 58.
func keyNum(key string) int {
	n, _ := strconv.Atoi(key[strings.LastIndex(key, "-")+1:])
	return n
}

func TestCreateByCall(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	x := e.call(t, kotova, "question", "8 (903) 111-22-33", "Где мой груз? Жду со вторника")
	if x.Status != "work" || x.Channel != "phone" || x.Assignee == nil || x.Assignee.MemberId != person(kotova) || x.Priority != "normal" || x.Title != "Где мой груз" {
		t.Fatalf("request %+v", x)
	}
	if x.Client.Phone == nil || *x.Client.Phone != "+7 903 111-22-33" || x.Client.PhoneMasked != "+7 ••• •••-••-33" {
		t.Errorf("the author sees the number he entered: %+v", x.Client)
	}
	if x.Sla.First == nil || x.Sla.Resolve == nil || x.Sla.Legal != nil || len(x.Messages) != 2 || x.Messages[0].Kind != "system" {
		t.Errorf("sla %+v messages %d", x.Sla, len(x.Messages))
	}
	o, err := e.svc.GetRequest(t.Context(), e.tc(t, owner), x.Id)
	if err != nil || o.Client.Phone != nil {
		t.Errorf("another member sees the mask: %+v %v", o.Client, err)
	}
	y := e.call(t, kotova, "complaint", "+7 903 111-22-33", "Опоздали с доставкой")
	if y.Priority != "high" || keyNum(y.Key) != keyNum(x.Key)+1 {
		t.Errorf("second %s after %s, priority %s", y.Key, x.Key, y.Priority)
	}
	if n := scalar[int](t, `select count(*) from service.clients where phone = '+79031112233'`); n != 1 {
		t.Errorf("one client for one number, got %d", n)
	}
}

func TestCreateByCallRefusals(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	mk := func(dir, typ, name, phone, text string) *api.ServiceRequestCreate {
		return &api.ServiceRequestCreate{DirectionId: demoID(dir), TypeId: typ, ClientName: name, Phone: phone, Text: text}
	}
	for name, c := range map[string]struct {
		actor string
		body  *api.ServiceRequestCreate
		code  string
		text  string
	}{
		"direction the actor does not see": {kotova, mk("d-mas", "question", "Пётр", "+79031112233", "Что случилось"), "validation_failed", "Выберите направление"},
		"no right to create":               {morozova, mk("d-mas", "question", "Пётр", "+79031112233", "Что случилось"), "forbidden_action", "Нет права «Заводить» в обращениях"},
		"unknown type":                     {kotova, mk("d-grz", "nope", "Пётр", "+79031112233", "Что случилось"), "validation_failed", "Выберите тип обращения"},
		"short name":                       {kotova, mk("d-grz", "question", "П", "+79031112233", "Что случилось"), "validation_failed", "Укажите имя клиента"},
		"short phone":                      {kotova, mk("d-grz", "question", "Пётр", "12345", "Что случилось"), "validation_failed", "Телефон — не меньше 10 цифр"},
		"short text":                       {kotova, mk("d-grz", "question", "Пётр", "+79031112233", "ой"), "validation_failed", "Опишите, что случилось"},
	} {
		_, err := e.svc.CreateRequest(t.Context(), e.tc(t, c.actor), c.body)
		if pe := wantProblem(t, err, c.code); pe.Detail != c.text {
			t.Errorf("%s: %q, want %q", name, pe.Detail, c.text)
		}
	}
}

func TestReplyStopsTheFirstTimerAndTakesTheRequest(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	id := requestID("r-57")
	m, err := e.svc.PostMessage(t.Context(), e.tc(t, owner), id, &api.ServiceMessageCreate{Kind: "public", Text: "Приняли, разбираемся"})
	if err != nil {
		t.Fatal(err)
	}
	if m.Kind != "public" || m.Delivery == nil || *m.Delivery != "queued" || m.Author == nil || m.Channel == nil || *m.Channel != "bot" {
		t.Errorf("message %+v", m)
	}
	x, err := e.svc.GetRequest(t.Context(), e.tc(t, owner), id)
	if err != nil {
		t.Fatal(err)
	}
	if x.Status != "work" || x.Assignee == nil || x.Assignee.MemberId != person(owner) || x.Sla.First.State != "done" || x.Revision != 2 {
		t.Errorf("after the reply: %s %+v rev %d first %+v", x.Status, x.Assignee, x.Revision, x.Sla.First)
	}
	if n := scalar[int](t, `select count(*) from outbox.events where type = 'service.request.replied.v1' and aggregate_id = $1`, id); n != 1 {
		t.Errorf("events %d", n)
	}
	_, err = e.svc.PostMessage(t.Context(), e.tc(t, owner), id, &api.ServiceMessageCreate{Kind: "note", Text: "x"})
	if pe := wantProblem(t, err, "validation_failed"); pe.Detail != "Напишите текст заметки" {
		t.Errorf("note text: %q", pe.Detail)
	}
	_, err = e.svc.PostMessage(t.Context(), e.tc(t, nobody), id, &api.ServiceMessageCreate{Kind: "note", Text: "заметка"})
	wantProblem(t, err, "not_found")
}

func TestObserverWritesNotesButCannotReply(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	id := requestID("r-40")
	exec(t, `insert into access.roles (id, name, kind) values ('00000000-0000-4000-8000-0000000000a1', 'Наблюдатель обращений', 'custom')`)
	exec(t, `insert into access.role_versions (role_id, version, actions, created_by) values ('00000000-0000-4000-8000-0000000000a1', 1, array['service.requests.read'], $1)`, person(owner))
	exec(t, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref, granted_by, valid)
		values ('person', $1, '00000000-0000-4000-8000-0000000000a1', 1, 'project', $2, $3, tstzrange('2020-01-01', null))`, person(nobody), demoID("svc-mas"), person(owner))
	if _, err := e.svc.PostMessage(t.Context(), e.tc(t, nobody), id, &api.ServiceMessageCreate{Kind: "note", Text: "Увидела, передам мастеру"}); err != nil {
		t.Fatal(err)
	}
	_, err := e.svc.PostMessage(t.Context(), e.tc(t, nobody), id, &api.ServiceMessageCreate{Kind: "public", Text: "Ответ клиенту"})
	wantProblem(t, err, "forbidden_action")
	x, err := e.svc.GetRequest(t.Context(), e.tc(t, nobody), id)
	if err != nil || x.Status != "new" || len(x.AllowedStatuses) != 0 {
		t.Errorf("the note does not move the request: %s %v %v", x.Status, x.AllowedStatuses, err)
	}
}

func TestTransitionsPauseResumeResolveClose(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	t0 := service.DemoBase
	x := e.at(t0).call(t, kotova, "question", "+79031110001", "Когда привезут паллеты")
	id := x.Id
	tc := e.tc(t, kotova)
	step := func(env env, ifMatch string, to api.ServiceTransitionTo, outcome *string) (api.ServiceRequest, error) {
		return env.svc.Transition(t.Context(), tc, id, ifMatch, &api.ServiceTransition{To: to, Outcome: outcome})
	}
	wait, err := step(e.at(t0), rev(x), "wait", nil)
	if err != nil || wait.Status != "wait" || wait.Sla.First.State != "pause" || wait.Head.State != "pause" {
		t.Fatalf("wait: %+v %v", wait.Status, err)
	}
	due := x.Sla.First.DueAt
	back, err := step(e.at(t0.Add(2*time.Hour)), rev(wait), "work", nil)
	if err != nil {
		t.Fatal(err)
	}
	// 120 idle working minutes: 16:24→18:24 (08:00–20:00); the first reply moves from 18:24 by 120 working minutes: 20:00, then 24 minutes of the next day
	want := time.Date(2026, 10, 2, 8, 24, 0, 0, service.Moscow).UTC()
	if back.Status != "work" || !back.Sla.First.DueAt.Equal(want) || !back.Sla.First.DueAt.After(due) {
		t.Errorf("resumed: %s first due %v, want %v", back.Status, back.Sla.First.DueAt, want)
	}
	_, err = step(e.at(t0), rev(back), "resolved", nil)
	if pe := wantProblem(t, err, "validation_failed"); pe.Detail != "Выберите итог решения" {
		t.Errorf("outcome: %q", pe.Detail)
	}
	_, err = step(e.at(t0), `"rev-99"`, "resolved", new("Устранено"))
	wantProblem(t, err, "revision_mismatch")
	_, err = step(e.at(t0), "", "resolved", new("Устранено"))
	wantProblem(t, err, "revision_required")
	done, err := step(e.at(t0), rev(back), "resolved", new("Устранено"))
	if err != nil || done.Status != "resolved" || done.Outcome == nil || *done.Outcome != "Устранено" || done.ResolvedAt == nil || done.Sla.Resolve.State != "done" {
		t.Fatalf("resolved: %+v %v", done.Status, err)
	}
	if n := scalar[int](t, `select count(*) from service.surveys where request_id = $1`, id); n != 1 {
		t.Errorf("the survey is sent: %d", n)
	}
	closed, err := step(e.at(t0), rev(done), "closed", nil)
	if err != nil || closed.Status != "closed" || len(closed.AllowedStatuses) != 0 {
		t.Fatalf("closed: %+v %v", closed.Status, err)
	}
	_, err = step(e.at(t0), rev(closed), "work", nil)
	if pe := wantProblem(t, err, "invalid_transition"); pe.Detail != "Из статуса «Закрыто» в «В работе» перейти нельзя" {
		t.Errorf("flow: %q", pe.Detail)
	}
	_, err = e.svc.PostMessage(t.Context(), tc, id, &api.ServiceMessageCreate{Kind: "public", Text: "Добавка"})
	if pe := wantProblem(t, err, "invalid_transition"); pe.Detail != "Обращение закрыто" {
		t.Errorf("closed: %q", pe.Detail)
	}
}

func TestReopenReturnsAResolvedRequestToWork(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	x := e.call(t, kotova, "question", "+79031110002", "Нужен счёт")
	tc := e.tc(t, kotova)
	done, err := e.svc.Transition(t.Context(), tc, x.Id, rev(x), &api.ServiceTransition{To: "resolved", Outcome: new("Разъяснено")})
	if err != nil {
		t.Fatal(err)
	}
	back, err := e.svc.Transition(t.Context(), tc, x.Id, rev(done), &api.ServiceTransition{To: "work"})
	if err != nil || back.Status != "work" || back.Outcome != nil || back.ResolvedAt != nil || back.Sla.Resolve.StoppedAt != nil {
		t.Fatalf("reopened: %+v %v", back, err)
	}
	if n := scalar[int](t, `select count(*) from outbox.events where type = 'service.request.reopened.v1' and aggregate_id = $1`, x.Id); n != 1 {
		t.Errorf("reopened events: %d", n)
	}
}

func TestResolvingNeedsTheRightToResolve(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	id := requestID("r-40")
	x, err := e.svc.GetRequest(t.Context(), e.tc(t, morozova), id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.svc.Transition(t.Context(), e.tc(t, morozova), id, rev(x), &api.ServiceTransition{To: "resolved", Outcome: new("Разъяснено")})
	wantProblem(t, err, "forbidden_action")
	if _, err := e.svc.Transition(t.Context(), e.tc(t, morozova), id, rev(x), &api.ServiceTransition{To: "wait"}); err != nil {
		t.Fatalf("to wait needs only the reply: %v", err)
	}
}

func TestAssigneeMustSeeTheDirection(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	x := e.call(t, owner, "question", "+79031110003", "Уточнить адрес")
	tc := e.tc(t, owner)
	_, err := e.svc.Patch(t.Context(), tc, x.Id, rev(x), &api.ServiceRequestPatch{AssigneeId: new(person(morozova))}, false)
	pe := wantProblem(t, err, "service_assignee_out_of_scope")
	if pe.Detail == "" {
		t.Error("the text of the prototype is the detail")
	}
	y, err := e.svc.Patch(t.Context(), tc, x.Id, rev(x), &api.ServiceRequestPatch{AssigneeId: new(person(kotelnikov)), Priority: new(api.ServiceRequestPatchPriority("high"))}, false)
	if n := events(t, "service.request.assigned.v1", x.Id); err != nil || n != 1 {
		t.Errorf("assigned events %d (%v)", n, err)
	}
	if n := scalar[int](t, `select count(*) from notify.notifications where kind = 'service.request.assigned' and recipient_person_id = $1`, person(kotelnikov)); n < 1 {
		t.Errorf("the performer is told: %d", n)
	}
	if err != nil || y.Assignee == nil || y.Assignee.MemberId != person(kotelnikov) || y.Priority != "high" || y.Revision != x.Revision+1 {
		t.Fatalf("assigned: %+v %v", y.Assignee, err)
	}
	z, err := e.svc.Patch(t.Context(), tc, x.Id, rev(y), &api.ServiceRequestPatch{}, true)
	if err != nil || z.Assignee != nil {
		t.Fatalf("unassigned: %+v %v", z.Assignee, err)
	}
	_, err = e.svc.Patch(t.Context(), tc, x.Id, rev(x), &api.ServiceRequestPatch{}, true)
	wantProblem(t, err, "revision_mismatch")
	_, err = e.svc.Patch(t.Context(), tc, x.Id, rev(z), &api.ServiceRequestPatch{Priority: new(api.ServiceRequestPatchPriority("urgent"))}, false)
	wantProblem(t, err, "validation_failed")
}

func TestMoveGivesANewNumberAndKeepsTheOldOne(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	x := e.call(t, owner, "cargo", "+79031110004", "Не хватает двух коробок")
	tc := e.tc(t, owner)
	moved, err := e.svc.Move(t.Context(), tc, x.Id, rev(x), &api.ServiceMove{DirectionId: demoID("d-otd")})
	if err != nil {
		t.Fatal(err)
	}
	if moved.Key == x.Key || moved.DirectionId != demoID("d-otd") || moved.Kind != "question" || moved.OldKeys == nil || (*moved.OldKeys)[0] != x.Key {
		t.Fatalf("moved %+v", moved)
	}
	if moved.Sla.First == nil || *moved.Sla.First.GoalMinutes != 480 || moved.Sla.Legal != nil {
		t.Errorf("the terms follow the new type: %+v", moved.Sla)
	}
	if n := scalar[int](t, `select count(*) from service.key_aliases where key = $1 and request_id = $2`, x.Key, x.Id); n != 1 {
		t.Errorf("alias: %d", n)
	}
	_, err = e.svc.Move(t.Context(), tc, x.Id, rev(moved), &api.ServiceMove{DirectionId: demoID("d-otd")})
	if pe := wantProblem(t, err, "validation_failed"); pe.Detail != "Выберите другое направление" {
		t.Errorf("same direction: %q", pe.Detail)
	}
	y := e.call(t, kotova, "question", "+79031110005", "Вопрос по доставке")
	_, err = e.svc.Move(t.Context(), e.tc(t, kotova), y.Id, rev(y), &api.ServiceMove{DirectionId: demoID("d-otd")})
	if pe := wantProblem(t, err, "forbidden_action"); pe.Detail != "Нет доступа к направлению «Отделка»" {
		t.Errorf("target: %q", pe.Detail)
	}
}

func TestRevealingThePhoneIsAnAuditedRightOfTheContactsHolder(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	id := requestID("r-55")
	_, err := e.svc.RevealPhone(t.Context(), e.tc(t, kotova), id)
	wantProblem(t, err, "forbidden_action")
	got, err := e.svc.RevealPhone(t.Context(), e.tc(t, owner), id)
	if err != nil || got.Phone != "+7 846 212-77-09" {
		t.Fatalf("reveal: %+v %v", got, err)
	}
	if n := scalar[int](t, `select count(*) from audit.events where action = 'service.client.phone.reveal' and target_id = $1 and sensitivity = 'sensitive'`, id); n != 1 {
		t.Errorf("audit rows: %d", n)
	}
	o, _ := e.svc.GetRequest(t.Context(), e.tc(t, owner), id)
	k, _ := e.svc.GetRequest(t.Context(), e.tc(t, kotova), id)
	if o.Client.Phone == nil || k.Client.Phone != nil {
		t.Errorf("owner %v, dispatcher %v", o.Client.Phone, k.Client.Phone)
	}
	if last := o.Messages[len(o.Messages)-1]; last.Kind != "system" || last.Text[:len("Телефон клиента показан")] != "Телефон клиента показан" {
		t.Errorf("the feed: %+v", last)
	}
}

func TestConclusionGoesToTheEmployeeAfterTheResolution(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	tc := e.tc(t, owner)
	id := requestID("r-41")
	x, err := e.svc.GetRequest(t.Context(), tc, id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.svc.ShareConclusion(t.Context(), tc, id, rev(x), &api.ServiceConclusion{Text: "Подогрев починим, вывод передан"})
	if pe := wantProblem(t, err, "validation_failed"); pe.Detail != "Поделиться выводом можно после решения" {
		t.Errorf("before: %q", pe.Detail)
	}
	_, err = e.svc.Transition(t.Context(), tc, id, rev(x), &api.ServiceTransition{To: "resolved", Outcome: new("Устранено")})
	if pe := wantProblem(t, err, "validation_failed"); pe.Detail != "Выберите итог решения" {
		t.Errorf("a complaint about an employee has its own outcomes: %q", pe.Detail)
	}
	done, err := e.svc.Transition(t.Context(), tc, id, rev(x), &api.ServiceTransition{To: "resolved", Outcome: new("Подтвердилась")})
	if err != nil {
		t.Fatal(err)
	}
	shared, err := e.svc.ShareConclusion(t.Context(), tc, id, rev(done), &api.ServiceConclusion{Text: "Подогрев починим, вывод передан"})
	if err != nil || shared.Shared == nil || shared.Shared.Text != "Подогрев починим, вывод передан" {
		t.Fatalf("shared: %+v %v", shared.Shared, err)
	}
	y := e.call(t, owner, "question", "+79031110006", "Обычный вопрос")
	_, err = e.svc.ShareConclusion(t.Context(), tc, y.Id, rev(y), &api.ServiceConclusion{Text: "Нет сотрудника"})
	if pe := wantProblem(t, err, "validation_failed"); pe.Detail != "Обращение не касается сотрудника" {
		t.Errorf("not about: %q", pe.Detail)
	}
}

type fakeCash struct{ offers []service.RefundOffer }

func (f *fakeCash) OfferRefund(_ context.Context, _ pgx.Tx, _ uuid.UUID, o service.RefundOffer) error {
	f.offers = append(f.offers, o)
	return nil
}

func TestCompensationNeedsItsOwnRightAndAKnownKind(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	cash := &fakeCash{}
	e.svc.Cash = cash
	x := e.call(t, owner, "complaint", "+79031110007", "Привезли с опозданием")
	_, err := e.svc.SetCompensation(t.Context(), e.tc(t, kotova), x.Id, rev(x), &api.ServiceCompensationSet{Kind: "discount20"})
	wantProblem(t, err, "forbidden_action")
	_, err = e.svc.SetCompensation(t.Context(), e.tc(t, owner), x.Id, rev(x), &api.ServiceCompensationSet{Kind: "gold"})
	if pe := wantProblem(t, err, "validation_failed"); pe.Detail != "Неизвестная компенсация" {
		t.Errorf("kind: %q", pe.Detail)
	}
	y, err := e.svc.SetCompensation(t.Context(), e.tc(t, owner), x.Id, rev(x), &api.ServiceCompensationSet{Kind: "discount20", Text: new("Извинились, скидка 20%")})
	if err != nil || y.Compensation == nil || *y.Compensation != "Скидка 20% на следующий визит" || len(cash.offers) != 0 {
		t.Fatalf("discount: %+v %v", y.Compensation, err)
	}
	z, err := e.svc.SetCompensation(t.Context(), e.tc(t, owner), x.Id, rev(y), &api.ServiceCompensationSet{Kind: "refund"})
	if err != nil || len(cash.offers) != 1 || cash.offers[0].Key != x.Key || z.Revision != y.Revision+1 {
		t.Fatalf("refund: %+v %v", cash.offers, err)
	}
}

func TestTaskIsMadeByThePortInTheProjectOfTheDirection(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	id := requestID("r-55")
	got, err := e.svc.CreateTask(t.Context(), e.tc(t, kotova), id, &api.ServiceTaskCreate{Title: "  Проверить паллеты на складе "})
	if err != nil || got.Key != "SVC-101" || got.Title != "Проверить паллеты на складе" || len(e.tasks.made) != 1 {
		t.Fatalf("task: %+v %v", got, err)
	}
	in := e.tasks.made[0]
	if in.Project != demoID("svc-grz") || in.Author != person(kotova) || in.Assignee != person(kotelnikov) || in.Request != id {
		t.Errorf("input %+v", in)
	}
	x, _ := e.svc.GetRequest(t.Context(), e.tc(t, kotova), id)
	if len(x.Tasks) != 1 || x.TaskCount != 1 || x.Tasks[0].Key != "SVC-101" {
		t.Errorf("the request knows its task: %+v", x.Tasks)
	}
	_, err = e.svc.CreateTask(t.Context(), e.tc(t, kotova), id, &api.ServiceTaskCreate{Title: "аб"})
	if pe := wantProblem(t, err, "validation_failed"); pe.Detail != "Тема задачи — не короче 3 символов" {
		t.Errorf("title: %q", pe.Detail)
	}
	e.tasks.refuse = "у автора правила нет права «Создавать»"
	_, err = e.svc.CreateTask(t.Context(), e.tc(t, kotova), id, &api.ServiceTaskCreate{Title: "Ещё одна"})
	wantProblem(t, err, "forbidden_action")
}

func TestLowRatingsAreSeenOrBecomeComplaints(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	list, err := e.svc.ListRatings(t.Context(), e.tc(t, owner), "", service.PageQuery{})
	if err != nil || len(list.Items) != 2 || list.Items[0].Comment != "Полотенце было влажным" {
		t.Fatalf("open ratings: %+v %v", list.Items, err)
	}
	k, err := e.svc.ListRatings(t.Context(), e.tc(t, kotova), "", service.PageQuery{})
	if err != nil || len(k.Items) != 1 || k.Items[0].Score != 2 {
		t.Fatalf("the dispatcher sees her direction: %+v %v", k.Items, err)
	}
	_, err = e.svc.DecideRating(t.Context(), e.tc(t, kotova), demoID("S-311"), &api.ServiceRatingDecision{Action: "seen"})
	if pe := wantProblem(t, err, "not_found"); pe.Detail != "Оценка не найдена" {
		t.Errorf("foreign rating: %q", pe.Detail)
	}
	seen, err := e.svc.DecideRating(t.Context(), e.tc(t, morozova), demoID("S-311"), &api.ServiceRatingDecision{Action: "seen"})
	if err != nil || seen.Rating.Status != "seen" || seen.Request != nil {
		t.Fatalf("seen: %+v %v", seen, err)
	}
	res, err := e.svc.DecideRating(t.Context(), e.tc(t, kotova), demoID("S-305"), &api.ServiceRatingDecision{Action: "complaint"})
	if err != nil || res.Request == nil || res.Rating.Status != "request" || res.Request.Priority != "high" || res.Request.Status != "work" ||
		res.Request.FromRating == nil || *res.Request.FromRating != 2 || res.Request.Kind != "complaint" {
		t.Fatalf("complaint: %+v %v", res, err)
	}
	if res.Request.Client.PhoneMasked != "+7 ••• •••-••-05" {
		t.Errorf("the phone of the survey, not a made-up one: %+v", res.Request.Client)
	}
	_, err = e.svc.DecideRating(t.Context(), e.tc(t, kotova), demoID("S-305"), &api.ServiceRatingDecision{Action: "complaint"})
	wantProblem(t, err, "invalid_transition")
}
