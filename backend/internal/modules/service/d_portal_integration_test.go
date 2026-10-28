//go:build integration

package service_test

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	psapi "github.com/ortus/ortus-crm/backend/internal/api/publicservice"
	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/modules/service" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/migrations"               //nolint:depguard // integration test: role names of the test cluster
)

var registerOnce sync.Once

// portal is a service whose portal index is the control DB of the world, with the links and the pages of the demo
// registered in it (what the seed does).
func portal(t *testing.T) env {
	t.Helper()
	e := newEnv(t)
	control, err := pgxpool.New(t.Context(), world.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(control.Close)
	idx := service.PGIndex{DB: control}
	e.svc.Index = idx
	registerOnce.Do(func() {
		tenant := ref("tenant:a")
		for _, row := range service.DemoTokens(demoID) {
			row.Tenant = tenant
			if err := idx.IssueToken(t.Context(), row); err != nil {
				t.Fatal(err)
			}
		}
		for _, slug := range []string{"mas", "kos", "otd", "grz"} {
			if err := idx.ClaimSlug(t.Context(), service.SlugRow{Slug: slug, Tenant: tenant, Direction: demoID("d-" + slug)}); err != nil {
				t.Fatal(err)
			}
		}
	})
	return e
}

func submit(t *testing.T, e env, slug, typ, phone, text string) psapi.PublicServiceReceipt {
	t.Helper()
	got, err := e.svc.PortalSubmit(t.Context(), slug, &psapi.PublicServiceSubmit{Consent: true, TypeId: typ, Text: text, Phone: new(phone), ClientName: new("Ольга Клиентова")})
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestPageOfADirectionHasNoClientData(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := portal(t)
	p, err := e.svc.PortalPage(t.Context(), "otd")
	if err != nil || p.DirectionName != "Отделка" || p.WorkHours != "пн–пт 9:00–19:00" || len(p.Types) != 6 || p.BrandName == "" || p.Color != "#7A5214" {
		t.Fatalf("page: %+v %v", p, err)
	}
	_, err = e.svc.PortalPage(t.Context(), "nope")
	wantProblem(t, err, "not_found")
}

func TestClientSeesOnlyPublicMessagesAndHisLabels(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	e := portal(t)
	got, err := e.svc.PortalRequest(t.Context(), service.DemoToken(requestID("r-k6")))
	if err != nil || got.Key != "КОС-6" || got.StatusLabel != "Получили" || len(got.Messages) != 1 || !got.Messages[0].FromClient || got.CanRate || got.CanReopen {
		t.Fatalf("request: %+v %v", got, err)
	}
	if got.DueText == nil || *got.DueText != "Ответим до 3 октября, 12:00" {
		t.Errorf("due: %v", got.DueText)
	}
	// The notes and the system lines of the staff never reach the client.
	w, err := e.svc.PortalRequest(t.Context(), service.DemoToken(requestID("r-55")))
	if err != nil || w.StatusLabel != "Ждём вашего ответа" || len(w.Messages) != 4 || w.DueText != nil {
		t.Fatalf("wait: %+v %v", w, err)
	}
	for _, m := range w.Messages {
		if m.Text == "Заведено по звонку · Вера Котельникова" {
			t.Error("a system line is shown to the client")
		}
	}
	_, err = e.svc.PortalRequest(t.Context(), "tok_unknown")
	wantProblem(t, err, "not_found")
}

func TestAnExpiredLinkIsGone(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := portal(t)
	token := "tok_" + uuid.NewString()
	row := service.TokenRow{Digest: service.TokenDigest(token), Tenant: ref("tenant:a"), Request: requestID("r-40"), ID: uuid.New(), KeyVersion: 1, ExpiresAt: e.now.Add(-time.Hour)}
	if err := e.svc.Index.IssueToken(t.Context(), row); err != nil {
		t.Fatal(err)
	}
	_, err := e.svc.PortalRequest(t.Context(), token)
	wantProblem(t, err, "public_token_expired")
}

func TestSubmitMakesANewRequestAndGivesTheLinkOnce(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := portal(t)
	_, err := e.svc.PortalSubmit(t.Context(), "mas", &psapi.PublicServiceSubmit{TypeId: "question", Text: "Можно ли с ребёнком?", Phone: new("+7 925 000-11-22")})
	if pe := wantProblem(t, err, "validation_failed"); pe.Detail != "Нужно согласие на обработку персональных данных" {
		t.Errorf("consent: %q", pe.Detail)
	}
	_, err = e.svc.PortalSubmit(t.Context(), "mas", &psapi.PublicServiceSubmit{Consent: true, TypeId: "nope", Text: "Можно ли с ребёнком?", Phone: new("+7 925 000-11-22")})
	wantProblem(t, err, "validation_failed")
	rc := submit(t, e, "mas", "question", "+7 925 000-11-22", "Можно ли с ребёнком? Ему десять лет")
	if rc.StatusLabel != "Получили" || rc.Token == "" || keyNum(rc.Key) < 42 {
		t.Fatalf("receipt: %+v", rc)
	}
	got, err := e.svc.PortalRequest(t.Context(), rc.Token)
	if err != nil || got.Key != rc.Key || len(got.Messages) != 2 || got.Messages[1].FromClient || got.Title != "Можно ли с ребёнком" {
		t.Fatalf("by the link: %+v %v", got, err)
	}
	if n := scalar[int](t, `select count(*) from service.requests where key = $1 and channel = 'widget' and status = 'new' and assignee_id is null`, rc.Key); n != 1 {
		t.Errorf("request rows: %d", n)
	}
	if n := scalar[int](t, `select count(*) from service.portal_tokens where token_digest = $1`, service.TokenDigest(rc.Token)); n != 1 {
		t.Errorf("token rows: %d", n)
	}
}

func TestSubmitIsLimitedPerClient(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := portal(t)
	for range 5 {
		submit(t, e, "kos", "idea", "+7 926 777-00-01", "Сделайте абонементы подешевле")
	}
	_, err := e.svc.PortalSubmit(t.Context(), "kos", &psapi.PublicServiceSubmit{Consent: true, TypeId: "idea", Text: "И ещё одна мысль", Phone: new("+7 926 777-00-01")})
	wantProblem(t, err, "rate_limited")
}

func TestClientReplyTakesTheRequestOffThePause(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := portal(t)
	token := service.DemoToken(requestID("r-55"))
	m, err := e.svc.PortalMessage(t.Context(), token, &psapi.PublicServiceMessageCreate{Text: "Акт отправил, посмотрите"})
	if err != nil || !m.FromClient {
		t.Fatalf("message: %+v %v", m, err)
	}
	x, err := e.svc.GetRequest(t.Context(), e.tc(t, kotelnikov), requestID("r-55"))
	if err != nil || x.Status != "work" || x.Messages[len(x.Messages)-1].Text != "Акт отправил, посмотрите" {
		t.Fatalf("staff view: %s %v", x.Status, err)
	}
	_, err = e.svc.PortalMessage(t.Context(), token, &psapi.PublicServiceMessageCreate{Text: "я"})
	wantProblem(t, err, "validation_failed")
}

func TestResolvedRequestCanBeRatedOnceAndReopenedInFiveDays(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	e := portal(t)
	rc := submit(t, e, "otd", "question", "+7 903 999-00-02", "Когда приедет замерщик?")
	x := scalar[uuid.UUID](t, `select id from service.requests where key = $1`, rc.Key)
	_, err := e.svc.PortalRate(t.Context(), rc.Token, &psapi.PublicServiceCsat{Score: 5})
	if pe := wantProblem(t, err, "invalid_transition"); pe.Detail != "Оценить можно решённое обращение" {
		t.Errorf("not resolved: %q", pe.Detail)
	}
	cur, err := e.svc.GetRequest(t.Context(), e.tc(t, owner), x)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Transition(t.Context(), e.tc(t, owner), x, rev(cur), &api.ServiceTransition{To: "resolved", Outcome: new("Разъяснено")}); err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.PortalRequest(t.Context(), rc.Token)
	if err != nil || got.StatusLabel != "Решено" || !got.CanRate || !got.CanReopen || got.ReopenUntil == nil || !got.ReopenUntil.Equal(e.now.Add(5*24*time.Hour)) {
		t.Fatalf("resolved: %+v %v", got, err)
	}
	_, err = e.svc.PortalRate(t.Context(), rc.Token, &psapi.PublicServiceCsat{Score: 9})
	wantProblem(t, err, "validation_failed")
	rated, err := e.svc.PortalRate(t.Context(), rc.Token, &psapi.PublicServiceCsat{Score: 2, Comment: new("Так и не приехали")})
	if err != nil || rated.CanRate || rated.Rating == nil || *rated.Rating != 2 {
		t.Fatalf("rated: %+v %v", rated, err)
	}
	if n := scalar[int](t, `select count(*) from service.ratings where request_id = $1 and score = 2 and status = 'open'`, x); n != 1 {
		t.Errorf("a low rating of the resolution is in the queue: %d", n)
	}
	_, err = e.svc.PortalRate(t.Context(), rc.Token, &psapi.PublicServiceCsat{Score: 4})
	wantProblem(t, err, "invalid_transition")
	late := e.at(e.now.Add(6 * 24 * time.Hour))
	_, err = late.svc.PortalReopen(t.Context(), rc.Token, nil)
	if pe := wantProblem(t, err, "invalid_transition"); pe.Detail != "Вопрос можно вернуть в течение 5 дней после решения" {
		t.Errorf("late: %q", pe.Detail)
	}
	back, err := e.svc.PortalReopen(t.Context(), rc.Token, &psapi.PublicServiceReopen{Text: new("Замерщик не приехал")})
	if err != nil || back.StatusLabel != "Отвечаем" || back.CanReopen {
		t.Fatalf("reopened: %+v %v", back, err)
	}
	st, _ := e.svc.GetRequest(t.Context(), e.tc(t, owner), x)
	if st.Status != "work" || st.Outcome != nil || st.Messages[len(st.Messages)-2].Text != "Замерщик не приехал" {
		t.Errorf("staff view: %s %v", st.Status, st.Outcome)
	}
}

func TestStopMeansNoMoreSurveys(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := portal(t)
	token := service.DemoToken(requestID("r-k6"))
	got, err := e.svc.PortalOptOut(t.Context(), token)
	if err != nil || !got.OptedOut {
		t.Fatalf("opt out: %+v %v", got, err)
	}
	if n := scalar[int](t, `select count(*) from service.clients where phone = '+79264101573' and opted_out`); n != 1 {
		t.Errorf("client rows: %d", n)
	}
}

func TestThanksFromTheClientCloseThemselvesAndTellTheLead(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := portal(t)
	rc := submit(t, e, "otd", "thanks", "+7 903 999-00-03", "Спасибо бригаде, всё сделали аккуратно")
	got, err := e.svc.PortalRequest(t.Context(), rc.Token)
	if err != nil || got.StatusLabel != "Решено" {
		t.Fatalf("thanks: %+v %v", got, err)
	}
	if n := scalar[int](t, `select count(*) from service.requests where key = $1 and status = 'resolved' and outcome = 'Передано мастеру'`, rc.Key); n != 1 {
		t.Errorf("closed by itself: %d", n)
	}
	if n := scalar[int](t, `select count(*) from notify.notifications where kind = 'service.thanks.received' and recipient_person_id = $1`, person(owner)); n < 1 {
		t.Errorf("the lead is told: %d", n)
	}
}
