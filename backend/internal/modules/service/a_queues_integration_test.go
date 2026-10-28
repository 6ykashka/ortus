//go:build integration

package service_test

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/modules/service" //nolint:depguard // the package under test
)

// These tests read the pristine demo: they run before the tests that change it (file order).

func keys(items []api.ServiceRequestSummary) []string {
	out := make([]string, 0, len(items))
	for _, x := range items {
		out = append(out, x.Key)
	}
	return out
}

func counts(c api.ServiceQueueCounts) map[string]int64 {
	out := map[string]int64{}
	for _, it := range c.Items {
		out[string(it.Key)] = it.Count
	}
	return out
}

func TestOwnerSeesFourDirectionsWithTeamsAndContacts(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	got, err := e.svc.ListDirections(t.Context(), e.tc(t, owner))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 4 || len(got.Types) != 21 || got.NotConfigured != nil {
		t.Fatalf("directions %d, types %d, notConfigured %v", len(got.Items), len(got.Types), got.NotConfigured)
	}
	var grz api.ServiceDirection
	for _, d := range got.Items {
		if !d.CanContacts {
			t.Errorf("%s: the owner may reveal the phones", d.Key)
		}
		if d.Key == "ГРЗ" {
			grz = d
		}
	}
	team := []string{}
	for _, m := range grz.Team {
		team = append(team, m.MemberId.String())
	}
	for _, want := range []uuid.UUID{person(owner), person(kotova), person(kotelnikov)} {
		if !slices.Contains(team, want.String()) {
			t.Errorf("ГРЗ team %v lacks %s", team, want)
		}
	}
	if grz.Calendar.From != "08:00" || grz.Calendar.To != "20:00" || len(grz.Calendar.Days) != 7 || grz.Next != 58 {
		t.Errorf("ГРЗ calendar %+v next %d", grz.Calendar, grz.Next)
	}
}

func TestDispatcherSeesOnlyHerDirectionWithoutContacts(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	got, err := e.svc.ListDirections(t.Context(), e.tc(t, kotova))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 1 || got.Items[0].Key != "ГРЗ" || got.Items[0].CanContacts {
		t.Fatalf("directions %+v", got.Items)
	}
	for _, ty := range got.Types {
		if ty.DirectionId != got.Items[0].Id {
			t.Errorf("a type of another direction: %+v", ty)
		}
	}
}

func TestMemberWithoutRolesSeesNothingButTheBusinessIsConfigured(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	got, err := e.svc.ListDirections(t.Context(), e.tc(t, nobody))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 0 || got.NotConfigured != nil {
		t.Fatalf("directions %+v notConfigured %v", got.Items, got.NotConfigured)
	}
}

func TestOwnerQueueOnTheDemoMatchesTheDomain(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	got, err := e.svc.ListRequests(t.Context(), e.tc(t, owner), service.ListQuery{Queue: "open"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"ГРЗ-57", "МАС-41", "МАС-40", "КОС-6", "ОТД-12", "ОТД-11", "ГРЗ-55"}
	if !slices.Equal(keys(got.Items), want) {
		t.Fatalf("open %v, want %v", keys(got.Items), want)
	}
	c := counts(got.Counts)
	for k, v := range map[string]int64{"open": 7, "noreply": 4, "mine": 2, "risk": 0, "late": 1, "wait": 1, "low": 2, "done": 1} {
		if c[k] != v {
			t.Errorf("counter %s = %d, want %d", k, c[k], v)
		}
	}
	if got.Items[0].Head.Text != "просрочен на 1 ч 10 мин" || got.Items[1].Head.Text != "осталось 48 мин" {
		t.Errorf("heads: %q, %q", got.Items[0].Head.Text, got.Items[1].Head.Text)
	}
	if got.Items[6].Head.State != "pause" || got.Items[6].Head.Until != "по закону до 26 октября" {
		t.Errorf("the paused request: %+v", got.Items[6].Head)
	}
}

func TestOtherQueuesAndFilters(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	for queue, want := range map[string][]string{"noreply": {"ГРЗ-57", "МАС-41", "МАС-40", "КОС-6"}, "mine": {"ОТД-12", "ОТД-11"}, "late": {"ГРЗ-57"},
		"wait": {"ГРЗ-55"}, "done": {"МАС-39"}, "low": {}} {
		got, err := e.svc.ListRequests(t.Context(), e.tc(t, owner), service.ListQuery{Queue: queue})
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(keys(got.Items), want) {
			t.Errorf("%s: %v, want %v", queue, keys(got.Items), want)
		}
	}
	got, err := e.svc.ListRequests(t.Context(), e.tc(t, owner), service.ListQuery{Queue: "open", Q: " лавка ", Kind: "cargo"})
	if err != nil || !slices.Equal(keys(got.Items), []string{"ГРЗ-57"}) {
		t.Fatalf("search: %v %v", keys(got.Items), err)
	}
	page, err := e.svc.ListRequests(t.Context(), e.tc(t, owner), service.ListQuery{Queue: "open", PageQuery: service.PageQuery{Limit: 3}})
	if err != nil || len(page.Items) != 3 || page.NextCursor == nil {
		t.Fatalf("page: %d %v %v", len(page.Items), page.NextCursor, err)
	}
	next, err := e.svc.ListRequests(t.Context(), e.tc(t, owner), service.ListQuery{Queue: "open", PageQuery: service.PageQuery{Limit: 3, Cursor: *page.NextCursor}})
	if err != nil || keys(next.Items)[0] != "КОС-6" {
		t.Fatalf("next page: %v %v", keys(next.Items), err)
	}
}

func TestDispatcherQueueIsHerDirection(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	got, err := e.svc.ListRequests(t.Context(), e.tc(t, kotova), service.ListQuery{Queue: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(keys(got.Items), []string{"ГРЗ-57", "ГРЗ-55"}) {
		t.Fatalf("open %v", keys(got.Items))
	}
	c := counts(got.Counts)
	if c["open"] != 2 || c["late"] != 1 || c["low"] != 1 || c["mine"] != 0 {
		t.Errorf("counters %v", c)
	}
	_, err = e.svc.ListRequests(t.Context(), e.tc(t, kotova), service.ListQuery{Queue: "open", Direction: demoID("d-mas")})
	wantProblem(t, err, "not_found")
}

func TestComplaintAboutTheMasseuseIsInvisibleToHer(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	got, err := e.svc.ListRequests(t.Context(), e.tc(t, morozova), service.ListQuery{Queue: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(keys(got.Items), []string{"МАС-40"}) {
		t.Fatalf("her queue %v", keys(got.Items))
	}
	_, err = e.svc.GetRequest(t.Context(), e.tc(t, morozova), requestID("r-41"))
	wantProblem(t, err, "not_found")
	if c := counts(got.Counts); c["open"] != 1 {
		t.Errorf("counters %v", c)
	}
}

func TestRequestCardMasksThePhoneAndTellsWhoMayMove(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	x, err := e.svc.GetRequest(t.Context(), e.tc(t, kotova), requestID("r-57"))
	if err != nil {
		t.Fatal(err)
	}
	if x.Client.Phone != nil || x.Client.PhoneMasked != "+7 ••• •••-••-12" || x.Key != "ГРЗ-57" {
		t.Errorf("client %+v", x.Client)
	}
	if len(x.Messages) != 2 || x.Messages[0].Kind != "client" || len(x.Messages[0].Files) != 3 || x.Messages[1].Auto == nil || !*x.Messages[1].Auto {
		t.Errorf("feed %+v", x.Messages)
	}
	if len(x.AllowedStatuses) != 3 || x.Revision != 1 || x.AboutMember != nil {
		t.Errorf("allowed %v revision %d", x.AllowedStatuses, x.Revision)
	}
	first := x.Sla.First
	if first == nil || first.State != "late" || first.OverMinutes == nil || *first.OverMinutes != 70 || x.Sla.Legal == nil || x.Sla.Legal.GoalMinutes != nil {
		t.Errorf("sla %+v", x.Sla)
	}
	o, err := e.svc.GetRequest(t.Context(), e.tc(t, owner), requestID("r-41"))
	if err != nil {
		t.Fatal(err)
	}
	if o.AboutMember == nil || o.AboutMember.DisplayName == "" || o.FromRating == nil || *o.FromRating != 2 || len(o.Tasks) != 1 || o.Tasks[0].Key != "T-71" {
		t.Errorf("МАС-41 %+v", o)
	}
}

func TestReplyTemplatesBelongToTheDirection(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	got, err := e.svc.Templates(t.Context(), e.tc(t, kotova), demoID("d-grz"))
	if err != nil || len(got.Items) != 4 || got.Items[0].Name != "Приняли в работу" {
		t.Fatalf("templates %+v %v", got, err)
	}
	_, err = e.svc.Templates(t.Context(), e.tc(t, kotova), demoID("d-mas"))
	wantProblem(t, err, "not_found")
}

func TestHomeCardsAreTheMissedTermsAndTheComplaintsWithoutAPerformer(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	got, err := e.svc.Home(t.Context(), e.tc(t, owner))
	if err != nil || len(got) != 2 {
		t.Fatalf("owner: %+v %v", got, err)
	}
	if got[0].Key != "ГРЗ-57" || got[0].Kind != service.HomeBreached || got[0].Text != "просрочен на 1 ч 10 мин" || got[0].Direction != "Грузоперевозки" {
		t.Errorf("first %+v", got[0])
	}
	if got[1].Key != "МАС-41" || got[1].Kind != service.HomeUnassigned || got[1].Assignee != "" {
		t.Errorf("second %+v", got[1])
	}
	k, err := e.svc.Home(t.Context(), e.tc(t, kotova))
	if err != nil || len(k) != 1 || k[0].Key != "ГРЗ-57" {
		t.Errorf("dispatcher: %+v %v", k, err)
	}
	m, err := e.svc.Home(t.Context(), e.tc(t, morozova))
	if err != nil || len(m) != 0 {
		t.Errorf("the complaint about her is not hers to decide: %+v %v", m, err)
	}
	n, err := e.svc.Home(t.Context(), e.tc(t, nobody))
	if err != nil || len(n) != 0 {
		t.Errorf("no roles: %+v %v", n, err)
	}
}
