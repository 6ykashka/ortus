//go:build integration

package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/modules/service" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

//nolint:revive // the field names of the generated type
type bodyType = struct {
	FirstMinutes   *int64                                `json:"firstMinutes,omitempty"`
	Id             string                                `json:"id"`
	Kind           api.ServiceDirectionBodyTypesKind     `json:"kind"`
	LegalDays      *int64                                `json:"legalDays,omitempty"`
	Name           string                                `json:"name"`
	Priority       api.ServiceDirectionBodyTypesPriority `json:"priority"`
	ResolveMinutes *int64                                `json:"resolveMinutes,omitempty"`
}

func draftBody() api.ServiceDirectionBody {
	return api.ServiceDirectionBody{Name: "Грузоперевозки Плюс", Color: "#2B5479",
		Calendar: api.ServiceWorkCalendar{Days: []int64{1, 2, 3, 4, 5}, From: "09:00", To: "18:00", TimeZone: "Europe/Moscow"},
		Types: []bodyType{
			{Id: "complaint", Kind: "complaint", Name: "Жалоба на доставку", Priority: "high", FirstMinutes: new(int64(60)), ResolveMinutes: new(int64(600))},
			{Id: "ask", Kind: "question", Name: "Вопрос", Priority: "normal", FirstMinutes: new(int64(120))},
		},
		Templates: &[]struct {
			Name string `json:"name"`
			Text string `json:"text"`
		}{{Name: "Принято", Text: "{имя}, приняли {номер}"}}}
}

func TestOnlyTheOwnerOfTheSettingsSeesThem(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	cfg, err := e.svc.GetDirection(t.Context(), e.tc(t, owner), demoID("d-grz"))
	if err != nil || cfg.Direction.Key != "ГРЗ" || len(cfg.Types) != 5 || cfg.Draft != nil {
		t.Fatalf("config: %+v %v", cfg.Direction.Key, err)
	}
	_, err = e.svc.GetDirection(t.Context(), e.tc(t, kotova), demoID("d-grz"))
	wantProblem(t, err, "forbidden_action")
	_, err = e.svc.GetDirection(t.Context(), e.tc(t, kotova), demoID("d-mas"))
	wantProblem(t, err, "not_found")
}

func TestDraftIsSavedByRevisionAndPublishedAsTheNextVersion(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	tc, id := e.tc(t, owner), demoID("d-grz")
	body := draftBody()
	_, err := e.svc.SaveDraft(t.Context(), tc, id, `"rev-7"`, &api.ServiceDirectionDraftSave{Body: body})
	wantProblem(t, err, "revision_mismatch")
	bad := body
	bad.Name = "Г"
	_, err = e.svc.SaveDraft(t.Context(), tc, id, `"rev-1"`, &api.ServiceDirectionDraftSave{Body: bad})
	wantProblem(t, err, "validation_failed")
	d1, err := e.svc.SaveDraft(t.Context(), tc, id, `"rev-1"`, &api.ServiceDirectionDraftSave{Body: body})
	if err != nil || d1.Revision != 2 {
		t.Fatalf("first save: %+v %v", d1.Revision, err)
	}
	d2, err := e.svc.SaveDraft(t.Context(), tc, id, `"rev-2"`, &api.ServiceDirectionDraftSave{Body: body})
	if err != nil || d2.Revision != 3 {
		t.Fatalf("second save: %+v %v", d2.Revision, err)
	}
	cfg, err := e.svc.GetDirection(t.Context(), tc, id)
	if err != nil || cfg.Draft == nil || cfg.Draft.Revision != 3 || cfg.Draft.Body.Name != "Грузоперевозки Плюс" {
		t.Fatalf("draft: %+v %v", cfg.Draft, err)
	}
	pub, err := e.svc.Publish(t.Context(), tc, id)
	if err != nil || pub.Direction.Version != 2 || pub.Direction.Name != "Грузоперевозки Плюс" || pub.Draft != nil || pub.Direction.Calendar.From != "09:00" || len(pub.Direction.Calendar.Days) != 5 {
		t.Fatalf("published: %+v %v", pub.Direction, err)
	}
	ids := map[string]string{}
	for _, ty := range pub.Types {
		ids[ty.Id] = ty.Name
	}
	// «cargo» stays: the request ГРЗ-57 refers to it; «ask» is new; the unused ones are gone.
	if ids["complaint"] != "Жалоба на доставку" || ids["ask"] != "Вопрос" || ids["cargo"] == "" || ids["thanks"] != "" {
		t.Errorf("types after the publication: %v", ids)
	}
	if n := scalar[int](t, `select count(*) from service.direction_versions where direction_id = $1`, id); n != 2 {
		t.Errorf("versions: %d", n)
	}
	if n := scalar[int](t, `select count(*) from service.reply_templates where direction_id = $1`, id); n != 1 {
		t.Errorf("templates: %d", n)
	}
	_, err = e.svc.Publish(t.Context(), tc, id)
	if pe := wantProblem(t, err, "invalid_transition"); pe.Detail != "Нет черновика для публикации" {
		t.Errorf("no draft: %q", pe.Detail)
	}
	// An open request keeps its terms: the publication does not move them.
	x, err := e.svc.GetRequest(t.Context(), tc, requestID("r-55"))
	if err != nil || x.Sla.First == nil {
		t.Fatalf("request: %v", err)
	}
}

type fakeProjects struct{ made []string }

func (f *fakeProjects) CreateServiceProject(_ context.Context, _ tenantctx.TenantContext, key, name string, _ *uuid.UUID) (uuid.UUID, error) {
	f.made = append(f.made, key+"|"+name)
	return uuid.New(), nil
}

func TestCreatingADirectionMakesItsServiceProject(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	tc := e.tc(t, owner)
	_, err := e.svc.CreateDirection(t.Context(), tc, &api.ServiceDirectionCreate{Key: "ДОС", Name: "Доставка еды"})
	wantProblem(t, err, "dependency_unavailable")
	projects := &fakeProjects{}
	e.svc.Projects = projects
	cfg, err := e.svc.CreateDirection(t.Context(), tc, &api.ServiceDirectionCreate{Key: "дос", Name: "Доставка еды"})
	if err != nil || cfg.Direction.Key != "ДОС" || cfg.Direction.Next != 1 || cfg.Direction.Version != 1 || len(projects.made) != 1 || projects.made[0] != "ДОС|Обращения · Доставка еды" {
		t.Fatalf("created: %+v %v %v", cfg.Direction, err, projects.made)
	}
	if cfg.Direction.Calendar.From != "09:00" || len(cfg.Types) != 0 {
		t.Errorf("default calendar %+v", cfg.Direction.Calendar)
	}
	tpl, err := e.svc.Templates(t.Context(), tc, cfg.Direction.Id)
	if err != nil || len(tpl.Items) != 4 {
		t.Errorf("templates %d %v", len(tpl.Items), err)
	}
	_, err = e.svc.CreateDirection(t.Context(), tc, &api.ServiceDirectionCreate{Key: "ДОС", Name: "Ещё одна"})
	if pe := wantProblem(t, err, "validation_failed"); pe.Detail != "Ключ ДОС уже занят" {
		t.Errorf("duplicate: %q", pe.Detail)
	}
	_, err = e.svc.CreateDirection(t.Context(), e.tc(t, kotova), &api.ServiceDirectionCreate{Key: "ДОК", Name: "Документы"})
	wantProblem(t, err, "forbidden_action")
	_, err = e.svc.CreateDirection(t.Context(), tc, &api.ServiceDirectionCreate{Key: "1", Name: "Ключ"})
	wantProblem(t, err, "validation_failed")
}

func TestReportCountsTheDemoAndHidesStaffFromOthers(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	got, err := e.svc.Report(t.Context(), e.tc(t, owner), service.ReportQuery{})
	if err != nil {
		t.Fatal(err)
	}
	var total, ratings int64
	for _, r := range got.Rows {
		total += r.Requests
		ratings += r.Ratings
		if r.FewAnswers == nil || !*r.FewAnswers {
			t.Errorf("few answers: %+v", r)
		}
	}
	if total < 8 || ratings != 3 || len(got.Reasons) == 0 || len(got.Weeks) == 0 || got.Staff == nil {
		t.Errorf("report: requests %d ratings %d reasons %d weeks %d", total, ratings, len(got.Reasons), len(got.Weeks))
	}
	k, err := e.svc.Report(t.Context(), e.tc(t, kotova), service.ReportQuery{})
	if err != nil || len(k.Rows) != 0 || k.Staff != nil {
		t.Errorf("a member without the reports right: %+v %v", k.Rows, err)
	}
	_, err = e.svc.Report(t.Context(), e.tc(t, owner), service.ReportQuery{Direction: uuid.New()})
	wantProblem(t, err, "not_found")
}
