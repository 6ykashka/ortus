//go:build integration

package service_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/modules/service" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/migrations"               //nolint:depguard // integration test: role names of the test cluster
)

func TestFilesOfAReplyAreCheckedAndShownByName(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	x := e.call(t, kotova, "question", "+79031110201", "Пришлите акт")
	file := uuid.New()
	exec(t, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, bytes, uploaded_by)
		values ($1, $2, 'ready', 'inspection', 'fleet.vehicle', $3, 'application/pdf', 2048, $4)`, file, "service-test/"+file.String(), uuid.New(), person(kotova))
	m, err := e.svc.PostMessage(t.Context(), e.tc(t, kotova), x.Id, &api.ServiceMessageCreate{Kind: "public", Text: "Акт во вложении", FileIds: &[]uuid.UUID{file}})
	if err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.GetRequest(t.Context(), e.tc(t, kotova), x.Id)
	if err != nil {
		t.Fatal(err)
	}
	var files []api.ServiceFile
	for _, msg := range got.Messages {
		if msg.Id == m.Id {
			files = msg.Files
		}
	}
	if len(files) != 1 || files[0].Id != file || files[0].SizeBytes != 2048 || files[0].Status != "ready" {
		t.Fatalf("files of the reply: %+v", files)
	}
	_, err = e.svc.PostMessage(t.Context(), e.tc(t, kotova), x.Id, &api.ServiceMessageCreate{Kind: "public", Text: "Ещё один", FileIds: &[]uuid.UUID{uuid.New()}})
	wantProblem(t, err, "validation_failed")
}

func TestQueueCountsAreTheOnesOfTheList(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	c, err := e.svc.QueueCounts(t.Context(), e.tc(t, owner), uuid.Nil)
	if err != nil || len(c.Items) != 8 || c.NoReplyCount == nil {
		t.Fatalf("counts: %+v %v", c, err)
	}
	g, err := e.svc.QueueCounts(t.Context(), e.tc(t, owner), demoID("d-grz"))
	list, lerr := e.svc.ListRequests(t.Context(), e.tc(t, owner), service.ListQuery{Queue: "open", Direction: demoID("d-grz")})
	if err != nil || lerr != nil || counts(g)["open"] != counts(list.Counts)["open"] {
		t.Fatalf("one direction: %+v %v / %+v %v", g, err, list.Counts, lerr)
	}
	_, err = e.svc.QueueCounts(t.Context(), e.tc(t, kotova), demoID("d-mas"))
	wantProblem(t, err, "not_found")
}

func TestIndexOfTheControlDBKeepsRoutesAndMemberships(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share one seeded database and run in the order of the files
	control, err := pgxpool.New(t.Context(), world.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(control.Close)
	idx, tenant := service.PGIndex{DB: control}, ref("tenant:a")
	dir := uuid.New()
	if err := idx.ClaimSlug(t.Context(), service.SlugRow{Slug: "test-slug", Tenant: tenant, Direction: dir}); err != nil {
		t.Fatal(err)
	}
	if err := idx.ClaimSlug(t.Context(), service.SlugRow{Slug: "test-slug", Tenant: tenant, Direction: dir}); err != nil {
		t.Errorf("the same direction claims its slug again: %v", err)
	}
	if err := idx.ClaimSlug(t.Context(), service.SlugRow{Slug: "test-slug", Tenant: ref("tenant:b"), Direction: uuid.New()}); err == nil {
		t.Error("a slug of another direction is taken")
	}
	row, ok, err := idx.FindSlug(t.Context(), "test-slug")
	if err != nil || !ok || row.Direction != dir || row.TenantName == "" {
		t.Fatalf("find slug: %+v %v %v", row, ok, err)
	}
	if err := idx.DropSlug(t.Context(), "test-slug"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := idx.FindSlug(t.Context(), "test-slug"); ok {
		t.Error("a dropped slug is gone")
	}
	token := service.TokenRow{Digest: service.TokenDigest("tok_" + uuid.NewString()), Tenant: tenant, Request: uuid.New(), ID: uuid.New(), KeyVersion: 1, ExpiresAt: service.DemoBase.Add(24 * time.Hour)}
	if err := idx.IssueToken(t.Context(), token); err != nil {
		t.Fatal(err)
	}
	if got, ok, err := idx.FindToken(t.Context(), token.Digest); err != nil || !ok || got.Request != token.Request {
		t.Fatalf("find token: %+v %v %v", got, ok, err)
	}
	if err := idx.DropToken(t.Context(), token.Digest); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := idx.FindToken(t.Context(), token.Digest); ok {
		t.Error("a dropped token is gone")
	}
	members, err := service.ControlDirectory{DB: control}.Memberships(t.Context(), tenant)
	if err != nil || !members[person(owner)].Owner || !members[person(owner)].Active || members[person(kotova)].Owner {
		t.Fatalf("memberships: %+v %v", members, err)
	}
}
