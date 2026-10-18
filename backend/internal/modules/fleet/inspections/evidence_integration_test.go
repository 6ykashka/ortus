//go:build integration

package inspections_test

import (
	"crypto/rand"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/inspections" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// fileSpec is a file of files.objects with its content digest, written as the module files leaves it.
type fileSpec struct {
	ownerType string
	owner     uuid.UUID
	state     string
	sha       []byte
	created   time.Time
	completed *time.Time // completeUpload of its upload session; nil — no session
}

// evidenceFile writes f (an inspection photo) and its completed upload session.
func evidenceFile(t *testing.T, tenant string, f fileSpec) uuid.UUID {
	t.Helper()
	id := uuid.New()
	d := db(t, tenant)
	exec(t, d, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, bytes, sha256,
	                                        uploaded_by, created_at, ready_at)
	     values ($1::uuid, 'files/'||$1::text, $2::text, 'inspection', $3, $4, 'image/jpeg', 2048, $5, $6, $7::timestamptz,
	             case when $2::text = 'ready' then $7::timestamptz end)`,
		id, f.state, f.ownerType, f.owner, f.sha, person("a.driver-msk1"), f.created)
	if f.completed != nil {
		exec(t, d, `insert into files.upload_sessions (file_id, actor_id, state, reserved_bytes, ticket_expires_at,
		                                               session_expires_at, created_at, completed_at)
		            values ($1, $2, 'completed', 0, $3, $3, $4, $5)`,
			id, person("a.driver-msk1"), f.created.Add(15*time.Minute), f.created, *f.completed)
	}
	return id
}

// digest is a fresh content digest: the tenant DB is shared by the parallel tests of the package.
func digest(t *testing.T) []byte {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return b
}

func at(d time.Duration) *time.Time {
	v := harness.Now().Add(d).UTC()
	return &v
}

// Модель данных 4 (ответ владельца 17.10): «sha256 файла с предупреждением о повторе, время съёмки фиксирует сервер».
// A photo with the bytes of a file of another trip of the tenant is a warning for the manager, never a refusal: the
// inspection is accepted, the warning (earlier non-rejected verified files: count, first seen, same owner — nothing
// of the earlier files is disclosed) and the moment the server received the photo (completeUpload) are frozen with the
// photo; what the client claims in serverCapturedAt and duplicateWarning is dropped; another tenant does not count.
func TestSubmitEvidence(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	other := seedTrip(t, "a", "msk2", uuid.Nil)
	same, pair := digest(t), digest(t)
	res := "fleet.reservation"

	first := *at(-3 * time.Hour)
	earliest := evidenceFile(t, "a", fileSpec{ownerType: "fleet.trip", owner: other.ID, state: "ready", sha: same, created: first, completed: at(-3*time.Hour + time.Minute)})
	evidenceFile(t, "a", fileSpec{ownerType: "fleet.trip", owner: other.ID, state: "rejected", sha: same, created: *at(-2 * time.Hour), completed: at(-2 * time.Hour)})
	evidenceFile(t, "a", fileSpec{ownerType: "fleet.trip", owner: other.ID, state: "reserved", sha: same, created: *at(-90 * time.Minute)})
	b := seedTrip(t, "b", "msk1", uuid.Nil)
	evidenceFile(t, "b", fileSpec{ownerType: "fleet.trip", owner: b.ID, state: "ready", sha: pair, created: *at(-4 * time.Hour), completed: at(-4 * time.Hour)})

	body := e.departure(t, tr)
	front := at(-59 * time.Minute)
	body.Photos[0].FileId = evidenceFile(t, "a", fileSpec{ownerType: res, owner: tr.Reservation, state: "ready", sha: same, created: *at(-time.Hour), completed: front})
	body.Photos[1].FileId = evidenceFile(t, "a", fileSpec{ownerType: res, owner: tr.Reservation, state: "ready", sha: pair, created: *at(-50 * time.Minute)})
	body.Photos[2].FileId = evidenceFile(t, "a", fileSpec{ownerType: "fleet.trip", owner: tr.ID, state: "ready", sha: pair, created: *at(-40 * time.Minute), completed: at(-39 * time.Minute)})
	body.Photos[3].FileId = evidenceFile(t, "a", fileSpec{ownerType: res, owner: tr.Reservation, state: "ready", created: *at(-31 * time.Minute), completed: at(-30 * time.Minute)})
	forgedAt := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	body.Photos[3].ServerCapturedAt = &forgedAt
	body.Photos[3].DuplicateWarning = &fleetapi.FileDuplicateWarning{Code: fleetapi.DuplicateSha256, FirstSeenAt: forgedAt, PreviousCount: 7}
	damage := evidenceFile(t, "a", fileSpec{ownerType: res, owner: tr.Reservation, state: "ready", sha: same, created: *at(-20 * time.Minute), completed: at(-19 * time.Minute)})
	body.Photos = append(body.Photos, fleetapi.InspectionPhoto{Role: "damage", FileId: damage, CapturedAt: harness.Now()})

	got, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), body)
	if err != nil {
		t.Fatalf("Submit: %v (a duplicate is a warning, never a refusal)", err)
	}
	if got.Status != "submitted" || len(got.Photos) != 6 {
		t.Fatalf("inspection: %+v", got)
	}
	check := func(what string, list []fleetapi.Inspection) {
		t.Helper()
		var mine *fleetapi.Inspection
		for i := range list {
			if list[i].Id == got.Id {
				mine = &list[i]
			}
		}
		if mine == nil {
			t.Fatalf("%s: inspection %s missing", what, got.Id)
		}
		p := mine.Photos
		wantPhoto(t, what+" front: a file of another trip", p[0], front, &fleetapi.FileDuplicateWarning{Code: "duplicate_sha256",
			FirstSeenAt: first, PreviousCount: 1})
		wantPhoto(t, what+" rear: no session — the server time of the file", p[1], at(-50*time.Minute), nil)
		wantPhoto(t, what+" left: the rear photo of the same inspection", p[2], at(-39*time.Minute), &fleetapi.FileDuplicateWarning{
			Code: "duplicate_sha256", FirstSeenAt: *at(-50 * time.Minute), PreviousCount: 1, SameOwner: true})
		wantPhoto(t, what+" right: the claims of the client are dropped", p[3], at(-30*time.Minute), nil)
		wantPhoto(t, what+" damage: answers only", p[5], at(-19*time.Minute), &fleetapi.FileDuplicateWarning{Code: "duplicate_sha256",
			FirstSeenAt: first, PreviousCount: 2, SameOwner: true})
	}
	check("Submit", []fleetapi.Inspection{got})

	d := db(t, "a")
	stored := scalar[string](t, d, `select coalesce(duplicate_count::text, '-')||'/'||coalesce(duplicate_same_owner::text, '-')||'/'||
	                                       to_char(server_captured_at at time zone 'UTC', 'HH24:MI')
	                                  from fleet.inspection_photos where inspection_id = $1 and role = 'front'`, got.Id)
	expect(t, "fleet.inspection_photos front", stored, stored == "1/false/"+front.Format("15:04"))
	sealed := scalar[bool](t, d, `select (answers->>'evidence')::boolean from fleet.inspections where id = $1`, got.Id)
	expect(t, "answers sealed by the server", sealed, sealed)

	// Frozen at submit: what happens to the earlier files afterwards (here the earliest one is rejected by a later
	// check) does not change the inspection.
	exec(t, d, `update files.objects set state = 'rejected', rejected_code = 'malware' where id = $1`, earliest)
	manager := e.tc(t, "a.manager-msk1", "a")
	read, err := e.svc.Inspection(ctx, manager, got.Id)
	if err != nil {
		t.Fatal(err)
	}
	check("Inspection", []fleetapi.Inspection{read})
	check("Inspections", allInspections(t, e, manager))
}

// allInspections reads every page of listInspections of tc.
func allInspections(t *testing.T, e env, tc tenantctx.TenantContext) []fleetapi.Inspection {
	t.Helper()
	var out []fleetapi.Inspection
	q := inspections.PageQuery{Limit: 200}
	for {
		page, err := e.svc.Inspections(t.Context(), tc, q)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, page.Items...)
		if page.NextCursor == nil {
			return out
		}
		q.Cursor = *page.NextCursor
	}
}

// wantPhoto checks the server evidence of a photo.
func wantPhoto(t *testing.T, what string, p fleetapi.InspectionPhoto, received *time.Time, dup *fleetapi.FileDuplicateWarning) {
	t.Helper()
	if p.ServerCapturedAt == nil || !p.ServerCapturedAt.Equal(*received) {
		t.Errorf("%s: serverCapturedAt %v, want %v", what, p.ServerCapturedAt, *received)
	}
	switch {
	case dup == nil && p.DuplicateWarning != nil:
		t.Errorf("%s: unexpected duplicate warning %+v", what, *p.DuplicateWarning)
	case dup != nil && p.DuplicateWarning == nil:
		t.Errorf("%s: no duplicate warning, want %+v", what, *dup)
	case dup != nil && (p.DuplicateWarning.Code != dup.Code || !p.DuplicateWarning.FirstSeenAt.Equal(dup.FirstSeenAt) ||
		p.DuplicateWarning.PreviousCount != dup.PreviousCount || p.DuplicateWarning.SameOwner != dup.SameOwner):
		t.Errorf("%s: duplicate warning %+v, want %+v", what, *p.DuplicateWarning, *dup)
	}
}

// An inspection submitted before W2.43 kept the photos as the client sent them: the stored roles show the server time
// of tenant 0017 (server_captured_at moved from the upload session), what the client claimed in answers is not shown.
func TestLegacyEvidence(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	body := e.departure(t, tr)
	body.Photos = append(body.Photos, fleetapi.InspectionPhoto{Role: "damage",
		FileId: photoFile(t, "a", "fleet.reservation", tr.Reservation, "ready"), CapturedAt: harness.Now()})
	got, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), body)
	if err != nil {
		t.Fatal(err)
	}
	d := db(t, "a")
	// What W2.04 wrote: the photos of the request in answers (here with claims of a client), no evidence columns
	// but the server time 0017 moved from the upload session.
	exec(t, d, `update fleet.inspections
	               set answers = (answers - 'evidence') || jsonb_build_object('photos', (
	                     select jsonb_agg(p || '{"serverCapturedAt": "2020-01-01T00:00:00Z",
	                                              "duplicateWarning": {"code": "duplicate_sha256", "firstSeenAt": "2020-01-01T00:00:00Z",
	                                                                   "previousCount": 5, "sameOwner": true}}'::jsonb)
	                       from jsonb_array_elements(answers->'photos') p))
	             where id = $1`, got.Id)
	exec(t, d, `update fleet.inspection_photos set server_captured_at = $2, duplicate_count = null,
	                   duplicate_first_seen_at = null, duplicate_same_owner = null where inspection_id = $1`, got.Id, *at(-time.Hour))
	read, err := e.svc.Inspection(ctx, e.tc(t, "a.manager-msk1", "a"), got.Id)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range read.Photos[:5] {
		wantPhoto(t, "legacy "+string(p.Role), p, at(-time.Hour), nil)
	}
	if p := read.Photos[5]; p.ServerCapturedAt != nil || p.DuplicateWarning != nil {
		t.Errorf("legacy damage photo shows the claims of the client: %+v", p)
	}
}
