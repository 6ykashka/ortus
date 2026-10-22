//go:build integration

package files_test

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// usualSeed writes into tenant A trips of Москва-2 driven by temporary drivers of Москва-1 (the pool, S2-20) and
// the inspections of their vehicles, as the modules of the pool and of the inspections write them (superuser).
type usualSeed struct {
	t         *testing.T
	e         env
	checklist uuid.UUID
	uploader  tenantctx.TenantContext // the trip company uploads the photos of its trips
}

func newUsualSeed(t *testing.T, e env) *usualSeed {
	t.Helper()
	// A version of the checklist of its own: the inspections only need one to refer to (the files never read it).
	checklist := scalar[uuid.UUID](t, db(t, "a"), `insert into fleet.checklist_versions (kind, version, items, definition)
		values ('return', 7901, '[]', '{"title": "W2.79", "fields": []}')
		on conflict (kind, version) do update set items = excluded.items returning id`)
	return &usualSeed{t: t, e: e, checklist: checklist, uploader: e.tc(t, "a.manager-msk2", "a")}
}

// vehicle registers a vehicle of unit.
func (s *usualSeed) vehicle(unit string) uuid.UUID {
	s.t.Helper()
	id := uuid.New()
	execSQL(s.t, db(s.t, "a"), `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm)
		values ($1, $2, $3, 'van', 1500, 12, 3200)`, id, ref(unit), "ОМ-"+id.String()[:6])
	return id
}

// trip writes a submitted trip of Москва-2 on vehicle driven by a new temporary driver of Москва-1 and, with mode,
// the approved request of the pool for it: mode and the usual vehicle home (approved — decision «approved»).
func (s *usualSeed) trip(vehicle uuid.UUID, mode string, home, host uuid.UUID, decision string) uuid.UUID {
	s.t.Helper()
	d := db(s.t, "a")
	now := harness.Now()
	driver := scalar[uuid.UUID](s.t, d, `insert into people.person_profiles (full_name, home_unit_id) values ('Водитель пула', $1)
		returning id`, ref("unit:a.msk1"))
	trip := uuid.New()
	execSQL(s.t, d, `insert into fleet.trips (id, number, unit_id, state, planned, driver_person_id, vehicle_id, started_at)
		values ($1, $2, $3, 'submitted', tstzrange($4, $5), $6, $7, $4)`, trip, "ОМ-"+trip.String()[:6], ref("unit:a.msk2"),
		now.Add(-3*time.Hour), now.Add(time.Hour), driver, vehicle)
	if mode == "" {
		return trip
	}
	pub, grant := uuid.New(), uuid.New()
	execSQL(s.t, d, `insert into fleet.pool_publications (id, person_id, home_unit_id, available, published_by, display_name,
		usual_vehicle_id) values ($1, $2, $3, tstzrange($4, $5), $2, $6, $7)`, pub, driver, ref("unit:a.msk1"),
		now.Add(-4*time.Hour), now.Add(4*time.Hour), "Водитель #W279-"+pub.String()[:6], home)
	execSQL(s.t, d, `insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version, scope_kind,
		include_descendants, valid, source, granted_by) values ($1, 'person', $2, $3, 1, 'self', false,
		tstzrange($4, $5, '[)'), 'transfer', $2)`, grant, driver, ref("role:a.driver"), now.Add(-3*time.Hour), now.Add(time.Hour))
	var hostID, decided any
	if host != uuid.Nil {
		hostID = host
	}
	if decision != "" {
		decided = decision
	}
	execSQL(s.t, d, `insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, trip_id, period, state,
		requested_by, decided_by, decided_at, assignment_id, vehicle_mode, home_vehicle_id, host_vehicle_id, vehicle_decision)
		values ($1, $2, $3, $4, tstzrange($5, $6, '[)'), 'approved', $7, $7, $5, $8, $9, $10, $11, $12)`,
		pub, ref("unit:a.msk1"), ref("unit:a.msk2"), trip, now.Add(-3*time.Hour), now.Add(time.Hour), driver, grant, mode,
		home, hostID, decided)
	return trip
}

// photo uploads a checked photo of purpose to trip as the trip company.
func (s *usualSeed) photo(trip uuid.UUID, purpose files.Purpose, name string) files.File {
	s.t.Helper()
	u := files.Upload{FileName: name, ContentType: "image/jpeg", SizeBytes: int64(len(jpeg)), SHA256: digest(jpeg),
		Purpose: purpose, Owner: files.Ref{Module: "fleet", Entity: "trip", ID: trip}}
	return s.e.ready(s.t, s.uploader, u, jpeg)
}

// returned writes the submitted return inspection of vehicle on trip: role is a photo of a role (fleet.inspection_photos),
// damage — a photo of a damage (answers.photos only).
func (s *usualSeed) returned(trip, vehicle uuid.UUID, role, damage files.File) {
	s.t.Helper()
	d := db(s.t, "a")
	answers := `{"photos": [{"role": "front", "fileId": "` + role.ID.String() + `"}, {"role": "damage", "fileId": "` +
		damage.ID.String() + `"}]}`
	insp := scalar[uuid.UUID](s.t, d, `insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id,
		odometer_km, fuel_level, answers, state, submitted_by)
		select $1, $2, 'return', $3, 48500, 'half', $4::jsonb, 'submitted', driver_person_id from fleet.trips where id = $1
		returning id`, trip, vehicle, s.checklist, answers)
	execSQL(s.t, d, `insert into fleet.inspection_photos (inspection_id, role, file_id) values ($1, 'front', $2)`, insp, role.ID)
	execSQL(s.t, d, `update fleet.trips set return_inspection_id = $2 where id = $1`, trip, insp)
}

// W2.79 (Q-W2.72-2; S2-20 rule 6, DoR s2-20 §6 «Фирма водителя читает осмотры своей машины по рейсу перевода — 200;
// осмотры других машин фирмы рейса — 404»): the company of the usual vehicle of a temporary driver (Москва-1) reads the
// photos of the inspections of that vehicle attached to the trip of Москва-2 — getFile, getFileDownload, listFiles.
// The other files of the trip (a photo of no inspection, a receipt), the photos of the vehicles of the trip company on
// a trip of the pool, and the photos of its vehicle on a trip without an approved usual vehicle stay 404; nothing
// attaches to the trip through the share. The trip company reads all as before, each file listed once.
func TestUsualVehiclePhotosForItsCompany(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	s := newUsualSeed(t, e)

	usual := s.vehicle("unit:a.msk1")
	trip := s.trip(usual, "home", usual, uuid.Nil, "approved")
	front := s.photo(trip, files.PurposeInspection, "Сдача спереди.jpg")
	damage := s.photo(trip, files.PurposeInspection, "Сдача, царапина.jpg")
	s.returned(trip, usual, front, damage)
	loose := s.photo(trip, files.PurposeInspection, "Фото рейса.jpg")
	receipt := s.photo(trip, files.PurposeExpenseReceipt, "Чек мойки.jpg")

	// The driver took the vehicle of the trip company: its inspection is not of the usual vehicle.
	home2, host := s.vehicle("unit:a.msk1"), s.vehicle("unit:a.msk2")
	hostTrip := s.trip(host, "host_or_home", home2, host, "approved")
	hostFront, hostDamage := s.photo(hostTrip, files.PurposeInspection, "Машина фирмы рейса.jpg"),
		s.photo(hostTrip, files.PurposeInspection, "Машина фирмы рейса, вмятина.jpg")
	s.returned(hostTrip, host, hostFront, hostDamage)

	// «Только водителя» (the usual vehicle declined) and a trip without a request: a vehicle of Москва-1 there is not
	// the usual vehicle of the trip.
	declined := s.vehicle("unit:a.msk1")
	declinedTrip := s.trip(declined, "home", declined, uuid.Nil, "declined")
	declFront, declDamage := s.photo(declinedTrip, files.PurposeInspection, "Отклонена.jpg"),
		s.photo(declinedTrip, files.PurposeInspection, "Отклонена, скол.jpg")
	s.returned(declinedTrip, declined, declFront, declDamage)
	plain := s.vehicle("unit:a.msk1")
	plainTrip := s.trip(plain, "", uuid.Nil, uuid.Nil, "")
	plainFront, plainDamage := s.photo(plainTrip, files.PurposeInspection, "Без пула.jpg"),
		s.photo(plainTrip, files.PurposeInspection, "Без пула, трещина.jpg")
	s.returned(plainTrip, plain, plainFront, plainDamage)

	company := e.tc(t, "a.manager-msk1", "a")
	for _, f := range []files.File{front, damage} {
		readable(t, e, company, f, trip)
	}
	closed := []files.File{loose, receipt, hostFront, hostDamage, declFront, declDamage, plainFront, plainDamage}
	for _, f := range closed {
		notFound(t, e, company, f)
	}
	got := listed(t, e, company, files.ListQuery{})
	expect(t, "listFiles of the company of the usual vehicle", got, slices.Contains(got, front.ID),
		slices.Contains(got, damage.ID), !slices.ContainsFunc(closed, func(f files.File) bool { return slices.Contains(got, f.ID) }))
	upload := files.Upload{FileName: "Ещё.jpg", ContentType: "image/jpeg", SizeBytes: int64(len(jpeg)), SHA256: digest(jpeg),
		Purpose: files.PurposeInspection, Owner: files.Ref{Module: "fleet", Entity: "trip", ID: trip}}
	if _, err := e.svc.Initiate(ctx, company, upload); !isCode(err, "not_found") {
		t.Errorf("upload to the trip by the company of the usual vehicle: %v, want not_found", err)
	}

	// The trip company and the owner (both scopes) read every file of the trip, each listed once.
	for _, actor := range []string{"a.manager-msk2", "a.owner"} {
		listedOnce(t, e, e.tc(t, actor, "a"), front, damage, loose, receipt)
	}
	// Another tenant: 404 as before.
	if _, err := e.svc.File(ctx, e.tc(t, "b.owner", "b"), front.ID); !isCode(err, "not_found") {
		t.Errorf("tenant B: %v, want not_found", err)
	}
}

// failingAction is an evaluator whose Permit of one action fails (the policy store is unavailable).
type failingAction struct {
	files.Authorizer
	action string
}

var errPolicyDown = errors.New("policy store unavailable")

func (f failingAction) Permit(ctx context.Context, tc tenantctx.TenantContext, action string, r authz.Resource) error {
	if action == f.action {
		return errPolicyDown
	}
	return f.Authorizer.Permit(ctx, tc, action, r)
}

// W2.79: a share opens a file only when the parent hides it; a failure of the check of the parent is the answer
// (the share does not mask it).
func TestUsualVehicleShareKeepsParentFailure(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	s := newUsualSeed(t, e)
	usual := s.vehicle("unit:a.msk1")
	trip := s.trip(usual, "home", usual, uuid.Nil, "approved")
	front := s.photo(trip, files.PurposeInspection, "Сдача спереди, сбой.jpg")
	damage := s.photo(trip, files.PurposeInspection, "Сдача, сбой.jpg")
	s.returned(trip, usual, front, damage)

	svc := *e.svc
	svc.Authz = failingAction{Authorizer: e.svc.Authz, action: "fleet.trips.read"}
	if _, err := svc.File(t.Context(), e.tc(t, "a.manager-msk1", "a"), front.ID); !errors.Is(err, errPolicyDown) {
		t.Errorf("File with the check of the trip failing: %v, want %v", err, errPolicyDown)
	}
}

// readable requires that tc opens and downloads f of the trip.
func readable(t *testing.T, e env, tc tenantctx.TenantContext, f files.File, trip uuid.UUID) {
	t.Helper()
	got, err := e.svc.File(t.Context(), tc, f.ID)
	if err != nil {
		t.Errorf("%s: %v", f.FileName, err)
		return
	}
	expect(t, f.FileName, got, got.Owner.ID == trip, got.OwnerTitle == "ОМ-"+trip.String()[:6])
	if _, err := e.svc.Download(t.Context(), tc, f.ID); err != nil {
		t.Errorf("download %s: %v", f.FileName, err)
	}
}

// notFound requires that f does not exist for tc (getFile and getFileDownload).
func notFound(t *testing.T, e env, tc tenantctx.TenantContext, f files.File) {
	t.Helper()
	_, errFile := e.svc.File(t.Context(), tc, f.ID)
	_, errDl := e.svc.Download(t.Context(), tc, f.ID)
	if !isCode(errFile, "not_found") || !isCode(errDl, "not_found") {
		t.Errorf("%s: File %v, Download %v; want not_found", f.FileName, errFile, errDl)
	}
}

// listedOnce requires that tc opens each of fs and finds it in listFiles exactly once.
func listedOnce(t *testing.T, e env, tc tenantctx.TenantContext, fs ...files.File) {
	t.Helper()
	list := listed(t, e, tc, files.ListQuery{})
	for _, f := range fs {
		if _, err := e.svc.File(t.Context(), tc, f.ID); err != nil {
			t.Errorf("%s: %v", f.FileName, err)
		}
		if n := count(list, f.ID); n != 1 {
			t.Errorf("listFiles has %s %d times, want once", f.FileName, n)
		}
	}
}

// execSQL runs a statement of the seed.
func execSQL(t *testing.T, d *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := d.ExecContext(t.Context(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func count(ids []uuid.UUID, id uuid.UUID) int {
	n := 0
	for _, x := range ids {
		if x == id {
			n++
		}
	}
	return n
}
