//go:build integration

package main

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W4.21, return 2 (major): the files of the answers (the parent forms/form) through the module of files as cmd/api wires
// it. forms.read gives the uploads to a form, not its answers (Q-W4.00-forms-9; DoR forms.md «файл откроется с
// проверкой доступа»): a respondent with forms.read and files.read but without forms.responses.read lists and opens only
// his own uploads — a file of another respondent is out of listFiles and answers 404 (getFile and download); the owner
// reads them all. Return 3 (review): a member with forms.responses.read in the area of the form reads them all; one with
// the key in another area reads the file of a response about an object he sees and no other.
func TestFormFilesOfAnswers(t *testing.T) { //nolint:paralleltest // adds roles, a response and files of answers to the seed of «Альта»
	pools, ev := formsPorts(t)
	svc, err := filesService(pools, ev, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	form := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:fm-insp"))
	owner, respondent := altaMember(t, "m-owner", true), altaMember(t, "m-vasiliev", false)
	grantFormsRead(t, respondent.PersonID, owner.PersonID)
	theirs, mine := answerFile(t, form, owner.PersonID), answerFile(t, form, respondent.PersonID)

	if got := formFileIDs(t, svc, respondent); !slices.Equal(got, []uuid.UUID{mine}) {
		t.Fatalf("listFiles of the respondent: %v, want only his own %s", got, mine)
	}
	wantClosed(t, svc, respondent, theirs, "a file of another respondent")
	wantOpen(t, svc, respondent, mine, "his own upload")
	if got := formFileIDs(t, svc, owner); !slices.Contains(got, theirs) || !slices.Contains(got, mine) {
		t.Fatalf("listFiles of the owner: %v, want %s and %s", got, theirs, mine)
	}
	about := answerFile(t, form, owner.PersonID)
	trip := answerResponse(t, form, about, owner.PersonID)
	reviewer := altaMember(t, "m-kotova", false)
	grantRole(t, reviewer.PersonID, owner.PersonID, []string{"forms.read", "forms.responses.read", "files.read"}, nil)
	if got := formFileIDs(t, svc, reviewer); !slices.Contains(got, theirs) || !slices.Contains(got, mine) || !slices.Contains(got, about) {
		t.Fatalf("listFiles of a member with forms.responses.read in the area of the form: %v, want %s, %s and %s", got, theirs, mine, about)
	}
	elsewhere := altaMember(t, "m-morozova", false)
	grantRole(t, elsewhere.PersonID, owner.PersonID, []string{"forms.read", "files.read"}, nil)
	grantRole(t, elsewhere.PersonID, owner.PersonID, []string{"forms.responses.read", "fleet.trips.read"}, &trip)
	if got := formFileIDs(t, svc, elsewhere); !slices.Equal(got, []uuid.UUID{about}) {
		t.Fatalf("listFiles of a member with the key in another area: %v, want only %s of the response about a trip he sees", got, about)
	}
	wantClosed(t, svc, elsewhere, theirs, "a file of no response he reads")
	wantOpen(t, svc, elsewhere, about, "the file of a response he reads")
}

// W4.21, return 4 (characterization of Q-W4.21-15, default «оставить как есть» until the owner of the module of files
// or the integrator decides): a member with forms.read, files.read and files.upload only in a unit answers the form
// «Осмотр машины» of the whole organization (Q-W4.05-4), but the module of files does not let him reach its parent
// forms/form — its unit is empty and a grant in a unit does not cover it: his own upload is out of listFiles and
// answers 404, while the same grant over the organization opens it. A fix of the question turns this test.
func TestFormFilesOfUnitMember(t *testing.T) { //nolint:paralleltest // adds roles and files of answers to the seed of «Альта»
	pools, ev := formsPorts(t)
	svc, err := filesService(pools, ev, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	form := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:fm-insp"))
	var unit *uuid.UUID
	if err := super(t, "t_alta").QueryRowContext(t.Context(), `select org_unit_id from forms.forms where id = $1`, form).Scan(&unit); err != nil || unit != nil {
		t.Fatalf("«Осмотр машины» of the seed: unit %v %v, want the whole organization", unit, err)
	}
	owner, member := altaMember(t, "m-owner", true), altaMember(t, "m-gromov", false)
	trip := seedTrip(t)
	grantRole(t, member.PersonID, owner.PersonID, []string{"forms.read", "files.read", "files.upload"}, &trip)
	own := answerFile(t, form, member.PersonID)
	if got := formFileIDs(t, svc, member); slices.Contains(got, own) {
		t.Fatalf("listFiles of a member with forms.read in a unit: %v has %s — Q-W4.21-15 decided? update the test", got, own)
	}
	wantClosed(t, svc, member, own, "his own upload to a form of the whole organization (grant in a unit)")
	grantFormsRead(t, member.PersonID, owner.PersonID)
	wantOpen(t, svc, member, own, "his own upload with the grant over the organization")

	// The same on the stand of the show (`seed demo`): Марина Котова («Менеджер логистики» of her unit with its subtree:
	// forms.read, forms.responses.read, files.read) is the assignee of au-1 «Проверить осмотр»; the module of forms opens
	// her a photo of a response about a trip of her unit, the module of files closes it.
	kotova := altaMember(t, "m-kotova", false)
	grantDemoManager(t, kotova.PersonID, owner.PersonID, trip)
	photo := answerFile(t, form, owner.PersonID)
	answerResponse(t, form, photo, owner.PersonID)
	closed, err := formFilesAccess(pools, ev, time.Now).Closed(t.Context(), kotova)
	if err != nil || slices.Contains(closed.Hidden, photo) {
		t.Fatalf("the module of forms closes the photo to Марина Котова (%v): want it open by forms.responses.read and the trip", err)
	}
	if got := formFileIDs(t, svc, kotova); slices.Contains(got, photo) {
		t.Fatalf("listFiles of Марина Котова: %v has %s — Q-W4.21-15 decided? update the test", got, photo)
	}
	wantClosed(t, svc, kotova, photo, "a photo of a response about a trip of the seed for Марина Котова (seed grant in her unit)")
}

// wantClosed: getFile and downloadFile of the file id answer 404 to tc.
func wantClosed(t *testing.T, svc *files.Service, tc tenantctx.TenantContext, id uuid.UUID, what string) {
	t.Helper()
	if _, err := svc.File(t.Context(), tc, id); !problem.Is(err, problem.CodeNotFound) {
		t.Fatalf("getFile of %s: %v, want not_found", what, err)
	}
	if _, err := svc.Download(t.Context(), tc, id); !problem.Is(err, problem.CodeNotFound) {
		t.Fatalf("downloadFile of %s: %v, want not_found", what, err)
	}
}

// wantOpen: getFile of the file id answers it to tc and downloadFile passes the access check (dependency_unavailable:
// the tests have no object storage).
func wantOpen(t *testing.T, svc *files.Service, tc tenantctx.TenantContext, id uuid.UUID, what string) {
	t.Helper()
	if f, err := svc.File(t.Context(), tc, id); err != nil || f.ID != id {
		t.Fatalf("getFile of %s: %+v %v", what, f, err)
	}
	if _, err := svc.Download(t.Context(), tc, id); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Fatalf("downloadFile of %s: %v, want past the access check (no object storage here)", what, err)
	}
}

// formFileIDs are the ids of the files of answers tc lists (listFiles, purpose form_attachment).
func formFileIDs(t *testing.T, svc *files.Service, tc tenantctx.TenantContext) []uuid.UUID {
	t.Helper()
	page, err := svc.List(t.Context(), tc, files.ListQuery{Purpose: string(files.PurposeFormAttachment), Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]uuid.UUID, 0, len(page.Items))
	for _, f := range page.Items {
		ids = append(ids, f.ID)
	}
	return ids
}

// grantFormsRead gives person a role «Отвечать на формы» (forms.read, files.read) over the whole organization for the test.
func grantFormsRead(t *testing.T, person, by uuid.UUID) {
	t.Helper()
	grantRole(t, person, by, []string{"forms.read", "files.read", "files.upload"}, nil)
}

// grantRole gives person a custom role of actions for the test: over the whole organization (unit nil) or over the
// unit of the trip *trip with its subtree.
func grantRole(t *testing.T, person, by uuid.UUID, actions []string, trip *uuid.UUID) {
	t.Helper()
	ctx, db, role := t.Context(), super(t, "t_alta"), uuid.New()
	if _, err := db.ExecContext(ctx, `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, role, "Формы W421 "+role.String()[:8]); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
		role, actions, by); err != nil {
		t.Fatal(err)
	}
	var assignment uuid.UUID
	if err := db.QueryRowContext(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
		scope_kind, scope_ref, include_descendants, valid, granted_by)
		select 'person', $1, $2, 1, case when $4::uuid is null then 'tenant' else 'unit' end,
		       (select unit_id from fleet.trips where id = $4::uuid), $4::uuid is not null,
		       tstzrange(now() - interval '1 hour', null), $3 returning id`, person, role, by, trip).Scan(&assignment); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, d := range []struct {
			sql string
			id  uuid.UUID
		}{
			{`delete from access.role_assignments where id = $1`, assignment},
			{`delete from access.role_versions where role_id = $1`, role},
			{`delete from access.roles where id = $1`, role},
		} {
			if _, err := db.ExecContext(context.WithoutCancel(ctx), d.sql, d.id); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
	})
}

// answerFile writes a checked file of an answer to form uploaded by person for the test.
func answerFile(t *testing.T, form, person uuid.UUID) uuid.UUID {
	t.Helper()
	ctx, db, id := t.Context(), super(t, "t_alta"), uuid.New()
	if _, err := db.ExecContext(ctx, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime,
		detected_mime, bytes, sha256, uploaded_by, ready_at) values ($1, $4, 'ready', 'form_attachment', 'forms.form', $2,
		'image/jpeg', 'image/jpeg', 2048, sha256(convert_to($4, 'UTF8')), $3, now())`, id, form, person, "forms/w421/"+id.String()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.ExecContext(context.WithoutCancel(ctx), `delete from files.objects where id = $1`, id); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	return id
}

// answerResponse writes a response to form by author about a trip of the seed (seedTrip) whose answer holds file, for
// the test; it returns the trip.
func answerResponse(t *testing.T, form, file, author uuid.UUID) uuid.UUID {
	t.Helper()
	ctx, db, id := t.Context(), super(t, "t_alta"), uuid.New()
	trip := seedTrip(t)
	answers := `[{"fieldKey":"q-photos","value":{"type":"files","value":["` + file.String() + `"]}}]`
	if _, err := db.ExecContext(ctx, `insert into forms.responses (id, form_id, number, version_number, channel, author_id,
		subject_module, subject_type, subject_id, subject_label, answers, review_status, revision, submitted_at)
		values ($1, $2, 99421, 3, 'inspection', $3, 'fleet', 'trip', $4, 'Рейс', $5::jsonb, 'accepted', 1, now())`,
		id, form, author, trip, answers); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.ExecContext(context.WithoutCancel(ctx), `delete from forms.responses where id = $1`, id); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	return trip
}

// seedTrip is a trip of the seed with its driver (the first by number).
func seedTrip(t *testing.T) uuid.UUID {
	t.Helper()
	var trip uuid.UUID
	if err := super(t, "t_alta").QueryRowContext(t.Context(), `select id from fleet.trips where driver_person_id is not null
		order by number limit 1`).Scan(&trip); err != nil {
		t.Fatal(err)
	}
	return trip
}
