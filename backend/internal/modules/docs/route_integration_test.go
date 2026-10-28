//go:build integration

package docs

import (
	"context"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// fakeTasks is the module «Задачи» of the tests: it keeps the mirror tasks and what the route told them.
type fakeTasks struct {
	mu      sync.Mutex
	project uuid.UUID
	refuse  string // a refusal to create the task («Нет права…»)
	created []RouteTask
	synced  map[uuid.UUID][]RouteTaskState
}

func newFakeTasks() *fakeTasks {
	return &fakeTasks{project: uuid.New(), synced: map[uuid.UUID][]RouteTaskState{}}
}

func (f *fakeTasks) MayCreate(_ context.Context, _ pgx.Tx, _, _ uuid.UUID, _ bool, project uuid.UUID) (bool, error) {
	return f.refuse == "" || project == uuid.Nil, nil
}

func (f *fakeTasks) CreateRouteTask(_ context.Context, _ pgx.Tx, _ uuid.UUID, t RouteTask) (RouteTaskResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.refuse != "" && t.Project != uuid.Nil {
		return RouteTaskResult{Refused: f.refuse, Forbidden: true}, nil
	}
	f.created = append(f.created, t)
	id := uuid.New()
	f.synced[id] = []RouteTaskState{t.State}
	return RouteTaskResult{ID: id, Key: "ДОК-101", Project: f.project}, nil
}

func (f *fakeTasks) SyncRouteTask(_ context.Context, _ pgx.Tx, _ uuid.UUID, task uuid.UUID, st RouteTaskState, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.synced[task] = append(f.synced[task], st)
	return nil
}

func (f *fakeTasks) last(task uuid.UUID) RouteTaskState {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := f.synced[task]
	if len(s) == 0 {
		return RouteTaskState{}
	}
	return s[len(s)-1]
}

// fakeSigner is the second confirmation of a signature of the tests: the password «secret» and the code it sent.
type fakeSigner struct {
	mu   sync.Mutex
	code string
	off  bool // no delivery channel
}

func (f *fakeSigner) ConfirmLogin(_ context.Context, _, _ uuid.UUID, password, _ string) (bool, error) {
	return password == "secret", nil
}

func (f *fakeSigner) SendCode(_ context.Context, _, _ uuid.UUID, code string) (string, error) {
	if f.off {
		return "", ErrNoDelivery
	}
	f.mu.Lock()
	f.code = code
	f.mu.Unlock()
	return "+7 9•• •••-••-42", nil
}

// routeEnv is a service of the tests with the mirror tasks and the signer of the fakes.
func routeEnv() (*Service, *fakeTasks, *fakeSigner) {
	ft, fs := newFakeTasks(), &fakeSigner{}
	c := *svc
	c.Tasks, c.Signer = ft, fs
	return &c, ft, fs
}

var signerActions = []string{"docs.read", "docs.sign"}

func who(ids ...uuid.UUID) *[]dapi.Id { return &ids }

func approveStep(days int64, mode dapi.DocRouteStepInputMode, people ...uuid.UUID) dapi.DocRouteStepInput {
	return dapi.DocRouteStepInput{Kind: dapi.DocRouteStepInputKindApprove, Days: days, Mode: &mode, WhoMemberIds: who(people...)}
}

func memberEntry(id uuid.UUID) dapi.DocShareEntry {
	return dapi.DocShareEntry{Who: dapi.DocShareEntryWhoMember, RefId: &id, Level: dapi.DocShareEntryLevelView}
}

func ackStep(days int64, people ...uuid.UUID) dapi.DocRouteStepInput {
	var a []dapi.DocShareEntry
	for _, p := range people {
		a = append(a, memberEntry(p))
	}
	return dapi.DocRouteStepInput{Kind: dapi.DocRouteStepInputKindAck, Days: days, Audience: &a}
}

// routeDoc is a document of an editor of a new folder: the editor is its author, the starter of its routes.
func routeDoc(t *testing.T, title string) (uuid.UUID, context.Context, tenantctx.TenantContext) {
	t.Helper()
	folder := newFolder(t, "Маршрут")
	starter := personOf(t, "a.manager-msk1")
	grantRole(t, starter, templateEditor, editorActions, scopeFolder, folder)
	ctx, tc := as(t, "a.manager-msk1")
	d, err := svc.CreateDocument(ctx, tc, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: title, FolderId: folder})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return d.Id, ctx, tc
}

func activeGrants(t *testing.T, doc uuid.UUID) map[uuid.UUID]string {
	t.Helper()
	rows, err := superA.Query(t.Context(), `select member_id, level || ':' || keep::text || ':' || coalesce(only_version, 0)::text
		from docs.temp_grants where document_id = $1 and revoked_at is null`, doc)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[uuid.UUID]string{}
	for rows.Next() {
		var (
			m uuid.UUID
			s string
		)
		if err := rows.Scan(&m, &s); err != nil {
			t.Fatal(err)
		}
		out[m] = s
	}
	return out
}

func docStatus(t *testing.T, doc uuid.UUID) string {
	t.Helper()
	var s string
	if err := superA.QueryRow(t.Context(), `select status from docs.documents where id = $1`, doc).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func hasWait(d dapi.Document, kind string) bool {
	for _, w := range d.My.Wait {
		if string(w.Kind) == kind {
			return true
		}
	}
	return false
}

// The way of a document through «согласовать → ознакомить»: the start closes the version and makes the task and the
// temporary accesses, the decisions move the steps, the end opens nothing new (startDocRoute … ackDocument).
func TestRouteApproveThenAck(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	s, ft, _ := routeEnv()
	doc, ctx, tc := routeDoc(t, "Приказ на согласование")
	msk2, lead, reader := personOf(t, "a.manager-msk2"), personOf(t, "a.project-lead"), personOf(t, "a.two-roles")

	dry := true
	res, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{DryRun: &dry, Steps: []dapi.DocRouteStepInput{approveStep(2, dapi.DocRouteStepInputModeAll, msk2, lead), ackStep(1, reader)}})
	if err != nil || res.Applied || res.Route != nil || len(res.Consequences) == 0 {
		t.Fatalf("dryRun: %v %+v, want «Что произойдёт» and nothing started", err, res)
	}
	if docStatus(t, doc) != statusDraft || len(ft.created) != 0 {
		t.Fatal("dryRun changed the document or made a task")
	}

	res, err = s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{approveStep(2, dapi.DocRouteStepInputModeAll, msk2, lead), ackStep(1, reader)}})
	if err != nil || !res.Applied || res.Route == nil {
		t.Fatalf("start: %v %+v", err, res)
	}
	rt := res.Route
	if rt.Status != dapi.DocRouteStatusActive || rt.Version != 1 || len(rt.Steps) != 2 || rt.Steps[0].Status != dapi.DocRouteStepStatusActive ||
		rt.Steps[1].Status != dapi.DocRouteStepStatusWait || rt.Steps[0].Due == nil || rt.Task == nil || !rt.Rules.Lock || !rt.Rules.NotAuthor {
		t.Fatalf("route %+v", rt)
	}
	if docStatus(t, doc) != statusInRoute {
		t.Fatalf("status %s, want in_route", docStatus(t, doc))
	}
	if g := activeGrants(t, doc); len(g) != 2 || !strings.HasPrefix(g[msk2], "comment:false") || !strings.HasPrefix(g[lead], "comment:false") {
		t.Fatalf("temporary accesses of the approvers: %v", g)
	}
	if len(ft.created) != 1 || ft.created[0].Document != doc || ft.created[0].State.Status != "active" || len(ft.last(rt.Task.EntityId).Waiting) != 2 {
		t.Fatalf("mirror task %+v", ft.created)
	}
	var named string
	if err := superA.QueryRow(t.Context(), `select coalesce(name, '') from docs.versions where document_id = $1 and number = 1`, doc).Scan(&named); err != nil || named != "На согласование" {
		t.Fatalf("the version «На согласование»: %q %v", named, err)
	}
	if _, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{approveStep(1, dapi.DocRouteStepInputModeAll, msk2)}}); err == nil {
		t.Fatal("a second route on the document")
	} else {
		wantCode(t, err, "invalid_transition")
	}
	if _, err := svc.UpdateDocument(ctx, tc, doc, "", dapi.DocPatch{}); err == nil {
		t.Fatal("a document on a route is edited")
	}

	// the approvers see the document and the wait; the others are not asked
	m2Ctx, m2TC := as(t, "a.manager-msk2")
	card, err := s.Document(m2Ctx, m2TC, doc)
	if err != nil || !hasWait(card, "approve") || card.Route == nil || card.Route.Steps[0].Who[0].MemberId == uuid.Nil {
		t.Fatalf("card of the approver: %v wait %+v", err, card.My.Wait)
	}
	ownerCtx, ownerTC := as(t, "a.owner")
	_, err = s.DecideRoute(ownerCtx, ownerTC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionApprove})
	wantCode(t, err, "forbidden_action")

	got, err := s.DecideRoute(m2Ctx, m2TC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionApprove, Comment: new("Согласовано")})
	if err != nil || got.CurrentStep != 0 || got.Steps[0].Status != dapi.DocRouteStepStatusActive || len(got.Steps[0].Decisions) != 1 {
		t.Fatalf("first approval: %v %+v", err, got)
	}
	if _, err := s.DecideRoute(m2Ctx, m2TC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionApprove}); err == nil {
		t.Fatal("the same member decides twice")
	} else {
		wantCode(t, err, "forbidden_action")
	}
	leadCtx, leadTC := as(t, "a.project-lead")
	got, err = s.DecideRoute(leadCtx, leadTC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionApprove})
	if err != nil || got.CurrentStep != 1 || got.Steps[0].Status != dapi.DocRouteStepStatusDone || got.Steps[1].Status != dapi.DocRouteStepStatusActive {
		t.Fatalf("second approval: %v %+v", err, got)
	}
	if g := activeGrants(t, doc); len(g) != 1 || g[reader] != "view:true:1" {
		t.Fatalf("after the step: %v, want the approvers' accesses gone and «Читает» of v1 kept for the reader", g)
	}
	if len(got.Steps[1].Who) != 1 || got.Steps[1].Who[0].MemberId != reader {
		t.Fatalf("the audience of the ack step: %+v", got.Steps[1].Who)
	}
	rCtx, rTC := as(t, "a.two-roles")
	_, err = s.DecideRoute(rCtx, rTC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionApprove})
	wantCode(t, err, "validation_failed") // the member himself acknowledges

	_, err = s.Ack(ownerCtx, ownerTC, doc, dapi.DocAck{})
	wantCode(t, err, "validation_failed") // «Ознакомление запрошено у других сотрудников»
	ack, err := s.Ack(rCtx, rTC, doc, dapi.DocAck{Device: new("телефон")})
	if err != nil || !ack.Acked || ack.Version != 1 {
		t.Fatalf("ack: %v %+v", err, ack)
	}
	if docStatus(t, doc) != statusAgreed {
		t.Fatalf("status %s, want agreed", docStatus(t, doc))
	}
	final, err := s.Route(ctx, tc, doc)
	if err != nil || final.Status != dapi.DocRouteStatusDone || final.Steps[1].Done == nil || len(*final.Steps[1].Done) != 1 || (*final.Steps[1].Done)[0].Device != "телефон" {
		t.Fatalf("final route: %v %+v", err, final)
	}
	if st := ft.last(*uuidOf(final.Task)); st.Status != "done" {
		t.Fatalf("mirror task %+v, want done", st)
	}
	if n := countRows(t, `select count(*) from docs.acks where document_id = $1 and version = 1`, doc); n != 1 {
		t.Fatalf("%d acknowledgements, want 1", n)
	}
	if _, err := s.DecideRoute(ownerCtx, ownerTC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionApprove}); err == nil {
		t.Fatal("a decision on a finished route")
	} else {
		wantCode(t, err, "invalid_transition")
	}
}

func uuidOf(o *dapi.ObjectRef) *uuid.UUID {
	if o == nil {
		id := uuid.Nil
		return &id
	}
	return &o.EntityId
}

func countRows(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := superA.QueryRow(t.Context(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// A return needs a comment, opens editing to the author and the route goes on from the step after new edits
// (docRouteDecide back, docRouteResume).
func TestRouteReturnAndResume(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	s, ft, _ := routeEnv()
	doc, ctx, tc := routeDoc(t, "Договор с возвратом")
	msk2 := personOf(t, "a.manager-msk2")
	if _, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{approveStep(3, dapi.DocRouteStepInputModeAny, msk2)}}); err != nil {
		t.Fatal(err)
	}
	m2Ctx, m2TC := as(t, "a.manager-msk2")
	_, err := s.DecideRoute(m2Ctx, m2TC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionReturn})
	wantCode(t, err, "validation_failed") // «Напишите, что доработать»
	got, err := s.DecideRoute(m2Ctx, m2TC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionReturn, Comment: new("Уточните сумму")})
	if err != nil || got.Status != dapi.DocRouteStatusReturned || got.Back == nil || got.Back.Name == "" || got.Back.Comment == nil || *got.Back.Comment != "Уточните сумму" {
		t.Fatalf("return: %v %+v", err, got)
	}
	if docStatus(t, doc) != statusReturned || len(activeGrants(t, doc)) != 0 {
		t.Fatalf("status %s, accesses %v, want returned and no temporary accesses", docStatus(t, doc), activeGrants(t, doc))
	}
	card, err := s.Document(ctx, tc, doc)
	if err != nil || !hasWait(card, "returned") || !card.My.Can.Edit {
		t.Fatalf("author after the return: %v wait %+v can %+v, want «returned» and editing open", err, card.My.Wait, card.My.Can)
	}
	if st := ft.last(*uuidOf(got.Task)); st.Status != "returned" {
		t.Fatalf("mirror task %+v, want returned", st)
	}
	_, err = s.ResumeRoute(m2Ctx, m2TC, doc)
	wantCode(t, err, "not_found") // the approver lost the temporary access with the return
	_, err = s.ResumeRoute(ctx, tc, doc)
	wantCode(t, err, "validation_failed") // «Сначала внесите правки: согласуют новую версию»
	if err := exec(t.Context(), `insert into docs.versions (document_id, number, source, authors) values ($1, 2, 'edit', $2)`, doc, []uuid.UUID{tc.PersonID}); err != nil {
		t.Fatal(err)
	}
	if err := exec(t.Context(), `update docs.documents set current_version = 2 where id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	got, err = s.ResumeRoute(ctx, tc, doc)
	if err != nil || got.Status != dapi.DocRouteStatusActive || got.Version != 2 || got.Steps[0].Status != dapi.DocRouteStepStatusActive || len(got.Steps[0].Decisions) != 0 {
		t.Fatalf("resume: %v %+v", err, got)
	}
	if docStatus(t, doc) != statusInRoute || len(activeGrants(t, doc)) != 1 {
		t.Fatalf("status %s, accesses %v", docStatus(t, doc), activeGrants(t, doc))
	}
	if _, err := s.ResumeRoute(ctx, tc, doc); err == nil {
		t.Fatal("resume of an active route")
	} else {
		wantCode(t, err, "invalid_transition")
	}
	if _, err := s.DecideRoute(m2Ctx, m2TC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionApprove}); err != nil {
		t.Fatalf("approve after the resume: %v", err)
	}
	if docStatus(t, doc) != statusAgreed {
		t.Fatalf("status %s, want agreed", docStatus(t, doc))
	}
}

// The checks of a start: steps, the author as the approver, the signer without the right, the audience, the right to
// start, the PDF/A copy (docRouteStart).
func TestRouteStartValidation(t *testing.T) { //nolint:paralleltest // a scenario of one story: the steps share the data and run in order
	s, ft, _ := routeEnv()
	doc, ctx, tc := routeDoc(t, "Проверки маршрута")
	msk2 := personOf(t, "a.manager-msk2")
	start := func(steps ...dapi.DocRouteStepInput) error {
		_, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: steps})
		return err
	}
	wantCode(t, start(), "validation_failed")
	seven := make([]dapi.DocRouteStepInput, 7)
	for i := range seven {
		seven[i] = approveStep(1, dapi.DocRouteStepInputModeAll, msk2)
	}
	wantCode(t, start(seven...), "validation_failed")
	wantCode(t, start(approveStep(1, dapi.DocRouteStepInputModeAll)), "validation_failed")                                                  // nobody to approve
	wantCode(t, start(approveStep(1, dapi.DocRouteStepInputModeAll, tc.PersonID)), "separation_of_duties_conflict")                         // the author
	wantCode(t, start(approveStep(1, dapi.DocRouteStepInputModeAll, uuid.New())), "validation_failed")                                      // unknown member
	wantCode(t, start(dapi.DocRouteStepInput{Kind: dapi.DocRouteStepInputKindSign, Days: 1, WhoMemberIds: who(msk2)}), "validation_failed") // no right to sign
	wantCode(t, start(dapi.DocRouteStepInput{Kind: dapi.DocRouteStepInputKindAck, Days: 1}), "validation_failed")                           // nobody to acknowledge
	wantCode(t, start(dapi.DocRouteStepInput{Kind: dapi.DocRouteStepInputKindExternal, Days: 1}), "validation_failed")                      // no customer
	if docStatus(t, doc) != statusDraft || len(ft.created) != 0 {
		t.Fatal("a refused start changed something")
	}
	notAuthor := false
	if _, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Rules: &struct {
		CommentOnBack *bool `json:"commentOnBack,omitempty"`
		Escalate      *bool `json:"escalate,omitempty"`
		Lock          *bool `json:"lock,omitempty"`
		NotAuthor     *bool `json:"notAuthor,omitempty"`
	}{NotAuthor: &notAuthor}, DryRun: new(true), Steps: []dapi.DocRouteStepInput{approveStep(1, dapi.DocRouteStepInputModeAll, tc.PersonID)}}); err != nil {
		t.Fatalf("the rule «автор не согласует» is off: %v", err)
	}
	// without the right to edit
	folder := newFolder(t, "Чтение")
	grantRole(t, personOf(t, "a.manager-msk2"), templateReader, readerActions, scopeFolder, folder)
	ownerCtx, ownerTC := as(t, "a.owner")
	other, err := svc.CreateDocument(ownerCtx, ownerTC, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "Чужой", FolderId: folder})
	if err != nil {
		t.Fatal(err)
	}
	m2Ctx, m2TC := as(t, "a.manager-msk2")
	_, err = s.StartRoute(m2Ctx, m2TC, other.Id, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{approveStep(1, dapi.DocRouteStepInputModeAll, personOf(t, "a.project-lead"))}})
	wantCode(t, err, "forbidden_action")
	_, err = s.StartRoute(ownerCtx, ownerTC, uuid.New(), dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{approveStep(1, dapi.DocRouteStepInputModeAll, msk2)}})
	wantCode(t, err, "not_found")
	// a project the author may not create tasks in
	ft.refuse = "Нет права создавать задачи в проекте «Закрытый»"
	proj := uuid.New()
	_, err = s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{ProjectId: &proj, Steps: []dapi.DocRouteStepInput{approveStep(1, dapi.DocRouteStepInputModeAll, msk2)}})
	wantCode(t, err, "forbidden_action")
	if docStatus(t, doc) != statusDraft {
		t.Fatal("a refused project left the route")
	}
	// a PDF/A copy is not sent
	if err := exec(t.Context(), `update docs.documents set pdfa_copy = true where id = $1`, other.Id); err != nil {
		t.Fatal(err)
	}
	_, err = s.StartRoute(ownerCtx, ownerTC, other.Id, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{approveStep(1, dapi.DocRouteStepInputModeAll, msk2)}})
	wantCode(t, err, "validation_failed")
}

// The signature: the author does not sign, a code is asked first, three wrong ones close the challenge, a right one
// approves the document, freezes it and queues the PDF/A copy (docSignStart, docSign).
func TestRouteSign(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	s, _, fs := routeEnv()
	doc, ctx, tc := routeDoc(t, "Договор на подпись")
	var folder uuid.UUID
	if err := superA.QueryRow(t.Context(), `select folder_id from docs.documents where id = $1`, doc).Scan(&folder); err != nil {
		t.Fatal(err)
	}
	msk2 := personOf(t, "a.manager-msk2")
	grantRole(t, msk2, "docs_signer_test", signerActions, scopeFolder, folder)
	if _, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{
		approveStep(1, dapi.DocRouteStepInputModeAll, personOf(t, "a.project-lead")), {Kind: dapi.DocRouteStepInputKindSign, Days: 1, WhoMemberIds: who(msk2)}}}); err != nil {
		t.Fatal(err)
	}
	leadCtx, leadTC := as(t, "a.project-lead")
	if _, err := s.DecideRoute(leadCtx, leadTC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionApprove}); err != nil {
		t.Fatal(err)
	}
	m2Ctx, m2TC := as(t, "a.manager-msk2")
	// approving a signature step by a click is not allowed; a code is asked first
	_, err := s.DecideRoute(m2Ctx, m2TC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionApprove})
	wantCode(t, err, "validation_failed")
	_, err = s.ConfirmSign(m2Ctx, m2TC, doc, dapi.DocSignConfirm{Method: dapi.DocSignConfirmMethodPepLogin, Password: new("secret")})
	wantCode(t, err, "validation_failed") // «Сначала запросите код»
	ownerCtx, ownerTC := as(t, "a.owner")
	_, err = s.RequestSignCode(ownerCtx, ownerTC, doc, dapi.DocSignCodeRequest{Method: dapi.DocSignCodeRequestMethodPepLogin})
	wantCode(t, err, "forbidden_action") // «Сейчас ваша подпись не нужна»

	ch, err := s.RequestSignCode(m2Ctx, m2TC, doc, dapi.DocSignCodeRequest{Method: dapi.DocSignCodeRequestMethodPepLogin})
	if err != nil || ch.AttemptsLeft != 3 || ch.Method != dapi.DocSignChallengeMethodPepLogin {
		t.Fatalf("challenge: %v %+v", err, ch)
	}
	for left := int64(2); left >= 0; left-- {
		_, err = s.ConfirmSign(m2Ctx, m2TC, doc, dapi.DocSignConfirm{Method: dapi.DocSignConfirmMethodPepLogin, Password: new("wrong")})
		wantCode(t, err, "sign_code_invalid")
		if _, d := problemOf(err); !strings.Contains(d, "Осталось попыток: "+string(rune('0'+left))) {
			t.Fatalf("detail %q, want the attempts left %d", d, left)
		}
	}
	_, err = s.ConfirmSign(m2Ctx, m2TC, doc, dapi.DocSignConfirm{Method: dapi.DocSignConfirmMethodPepLogin, Password: new("secret")})
	wantCode(t, err, "rate_limited") // three wrong ones used the challenge up
	if _, err = s.RequestSignCode(m2Ctx, m2TC, doc, dapi.DocSignCodeRequest{Method: dapi.DocSignCodeRequestMethodPepSms}); err != nil {
		t.Fatalf("new challenge by SMS: %v", err)
	}
	fs.mu.Lock()
	code := fs.code
	fs.mu.Unlock()
	res, err := s.ConfirmSign(m2Ctx, m2TC, doc, dapi.DocSignConfirm{Method: dapi.DocSignConfirmMethodPepSms, Code: &code})
	if err != nil || res.Status != dapi.DocSignResultStatusApproved || res.SignedAt.IsZero() {
		t.Fatalf("sign: %v %+v", err, res)
	}
	if docStatus(t, doc) != statusApproved {
		t.Fatalf("status %s, want approved", docStatus(t, doc))
	}
	if n := countRows(t, `select count(*) from docs.jobs where op in ('pdfa', 'to_pdf') and $1 = any(doc_ids) and status = 'queued'`, doc); n != 1 {
		t.Fatalf("%d queued jobs of the PDF/A copy, want 1", n)
	}
	route, err := s.Route(ctx, tc, doc)
	if err != nil || route.Status != dapi.DocRouteStatusDone || route.Steps[1].Decisions[0].Method != dapi.DocRouteDecisionRecMethodPepSms {
		t.Fatalf("route after the signature: %v %+v", err, route)
	}
	var frozen *string
	if err := superA.QueryRow(t.Context(), `select frozen::text from docs.documents where id = $1`, doc).Scan(&frozen); err != nil || frozen == nil {
		t.Fatalf("fields are not frozen: %v", err)
	}
}

// The signature without a provider of the code is dependency_unavailable (D-31), the author never signs the own
// document (docSignStart).
func TestRouteSignWithoutProvider(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	s, _, fs := routeEnv()
	doc, ctx, tc := routeDoc(t, "Подпись без канала")
	var folder uuid.UUID
	if err := superA.QueryRow(t.Context(), `select folder_id from docs.documents where id = $1`, doc).Scan(&folder); err != nil {
		t.Fatal(err)
	}
	msk2 := personOf(t, "a.manager-msk2")
	grantRole(t, msk2, "docs_signer_test", signerActions, scopeFolder, folder)
	_, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{{Kind: dapi.DocRouteStepInputKindSign, Days: 1, WhoMemberIds: who(tc.PersonID)}}})
	wantCode(t, err, "separation_of_duties_conflict")
	if _, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{{Kind: dapi.DocRouteStepInputKindSign, Days: 1, WhoMemberIds: who(msk2)}}}); err != nil {
		t.Fatal(err)
	}
	m2Ctx, m2TC := as(t, "a.manager-msk2")
	fs.off = true
	_, err = s.RequestSignCode(m2Ctx, m2TC, doc, dapi.DocSignCodeRequest{Method: dapi.DocSignCodeRequestMethodPepSms})
	wantCode(t, err, "dependency_unavailable")
	bare := *s
	bare.Signer = nil
	_, err = bare.RequestSignCode(m2Ctx, m2TC, doc, dapi.DocSignCodeRequest{Method: dapi.DocSignCodeRequestMethodPepLogin})
	wantCode(t, err, "dependency_unavailable")
}

// Cancel and an early end of the acknowledgement: the author or the owner of the business only (docRouteCancel,
// docAckClose).
func TestRouteCancelAndAckClose(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	s, ft, _ := routeEnv()
	doc, ctx, tc := routeDoc(t, "Отмена маршрута")
	msk2 := personOf(t, "a.manager-msk2")
	res, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{approveStep(1, dapi.DocRouteStepInputModeAll, msk2)}})
	if err != nil {
		t.Fatal(err)
	}
	m2Ctx, m2TC := as(t, "a.manager-msk2")
	_, err = s.CancelRoute(m2Ctx, m2TC, doc)
	wantCode(t, err, "forbidden_action")
	_, err = s.CloseAck(ctx, tc, doc)
	wantCode(t, err, "invalid_transition") // the step is not an acknowledgement
	got, err := s.CancelRoute(ctx, tc, doc)
	if err != nil || got.Status != dapi.DocRouteStatusCancelled {
		t.Fatalf("cancel: %v %+v", err, got)
	}
	if docStatus(t, doc) != statusDraft || len(activeGrants(t, doc)) != 0 || ft.last(*uuidOf(res.Route.Task)).Status != "cancelled" {
		t.Fatalf("after the cancel: status %s, accesses %v, task %+v", docStatus(t, doc), activeGrants(t, doc), ft.last(*uuidOf(res.Route.Task)))
	}
	_, err = s.CancelRoute(ctx, tc, doc)
	wantCode(t, err, "invalid_transition")
	_, err = s.ResumeRoute(ctx, tc, doc)
	wantCode(t, err, "invalid_transition")
	if _, err := svc.Document(ctx, tc, doc); err != nil {
		t.Fatalf("the document after the cancel: %v", err)
	}
	// a new route may start again; the old one stays in the log
	reader := personOf(t, "a.two-roles")
	res, err = s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{ackStep(2, reader, msk2)}})
	if err != nil || res.Route == nil || res.Route.Steps[0].Status != dapi.DocRouteStepStatusActive {
		t.Fatalf("restart: %v %+v", err, res)
	}
	_, err = s.CloseAck(m2Ctx, m2TC, doc)
	wantCode(t, err, "forbidden_action")
	rCtx, rTC := as(t, "a.two-roles")
	if _, err := s.Ack(rCtx, rTC, doc, dapi.DocAck{}); err != nil {
		t.Fatal(err)
	}
	if got, err := s.CloseAck(ctx, tc, doc); err != nil || got.Status != dapi.DocRouteStatusDone {
		t.Fatalf("close ack: %v %+v, want the route done with one not acknowledged", err, got)
	}
	if docStatus(t, doc) != statusAgreed {
		t.Fatalf("status %s, want agreed", docStatus(t, doc))
	}
}

// A step of the customer waits for the signature from his link; no member decides it (docRouteStart external).
func TestRouteExternalStep(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	s, _, _ := routeEnv()
	doc, ctx, tc := routeDoc(t, "Акт заказчику")
	res, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{{Kind: dapi.DocRouteStepInputKindExternal, Days: 3,
		ExternalName: new("ООО «Заказчик»"), ExternalPhone: new("+7 (916) 123-45-42")}}})
	if err != nil || res.Route == nil || res.Route.Steps[0].External == nil || res.Route.Steps[0].External.Name != "ООО «Заказчик»" ||
		res.Route.Steps[0].External.PhoneMasked == nil || *res.Route.Steps[0].External.PhoneMasked != "+7 9•• •••-••-42" {
		t.Fatalf("start: %v %+v", err, res.Route)
	}
	_, err = s.DecideRoute(ctx, tc, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionApprove})
	wantCode(t, err, "forbidden_action")
}

// The waits of the member for «Главная»: the approver sees the step, the author sees the return, the others nothing
// (docWaits, getMyDecisionQueue).
func TestHomeWaits(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share the documents and the people of the fixtures and run in order
	s, _, _ := routeEnv()
	doc, ctx, tc := routeDoc(t, "Приказ для главной")
	msk2 := personOf(t, "a.manager-msk2")
	if _, err := s.StartRoute(ctx, tc, doc, dapi.DocRouteStart{Steps: []dapi.DocRouteStepInput{approveStep(2, dapi.DocRouteStepInputModeAll, msk2)}}); err != nil {
		t.Fatal(err)
	}
	m2Ctx, m2TC := as(t, "a.manager-msk2")
	waits, err := s.HomeWaits(m2Ctx, m2TC, 50)
	if err != nil {
		t.Fatal(err)
	}
	var mine *HomeWait
	for i := range waits {
		if waits[i].Document == doc {
			mine = &waits[i]
		}
	}
	if mine == nil || mine.Kind != "approve" || mine.Title != "Приказ для главной" || mine.Due == nil {
		t.Fatalf("approver waits %+v", waits)
	}
	ownerCtx, ownerTC := as(t, "a.owner")
	if own, err := s.HomeWaits(ownerCtx, ownerTC, 50); err != nil || slices.ContainsFunc(own, func(w HomeWait) bool { return w.Document == doc }) {
		t.Fatalf("the owner of the business is not asked: %v %+v", err, own)
	}
	if _, err := s.DecideRoute(m2Ctx, m2TC, doc, dapi.DocRouteDecide{Decision: dapi.DocRouteDecideDecisionReturn, Comment: new("Исправьте дату")}); err != nil {
		t.Fatal(err)
	}
	back, err := s.HomeWaits(ctx, tc, 50)
	if err != nil {
		t.Fatal(err)
	}
	i := slices.IndexFunc(back, func(w HomeWait) bool { return w.Document == doc })
	if i < 0 || back[i].Kind != "returned" || back[i].By == "" {
		t.Fatalf("author waits %+v, want the return with its author", back)
	}
	if few, err := s.HomeWaits(ctx, tc, 1); err != nil || len(few) > 1 {
		t.Fatalf("limit: %v %d", err, len(few))
	}
}
