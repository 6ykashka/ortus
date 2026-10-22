//go:build integration

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	formsapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/modules/forms"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage/miniotest"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// W4.21, return 1: the real adapters of the ports of «Формы» over the seeded stack of «Альта» — formObjects (the choices
// of a CRM question by the rights of the respondent: fleet.vehicles.read and fleet.trips.read by ScopeQuery, the trips
// the pool closes, the tasks he reads; an archived vehicle is no choice, but an old answer keeps its label) and
// formUploads (a guest uploads in the capability context as the actor of his nonce: only his own upload completes and
// is read).

// formsPorts are the tenant pools and the evaluator of the stack, as newForms wires them.
func formsPorts(t *testing.T) (*tenantctx.Pools, *authz.Evaluator) {
	t.Helper()
	control, err := pgxpool.New(t.Context(), stack.URL(controlDB, migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(control.Close)
	getenv := func(k string) string {
		if k == "TENANT_DB_URL" {
			return stack.URL("postgres", migrations.RoleAPI)
		}
		return ""
	}
	pools := tenantctx.NewPools(tenantctx.NewPGDirectory(control), getenv, "")
	t.Cleanup(pools.Close)
	src := authz.PGSource{Pools: pools}
	return pools, authz.New(src, src, time.Now)
}

// altaMember is the tenant context of a member of the seed of «Альта» (owner — the owner of the business).
func altaMember(t *testing.T, proto string, owner bool) tenantctx.TenantContext {
	t.Helper()
	id := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:"+proto))
	var n int
	if err := super(t, "t_alta").QueryRowContext(t.Context(), `select count(*) from people.person_profiles where id = $1`, id).Scan(&n); err != nil || n != 1 {
		t.Fatalf("member %s of the seed: %d %v", proto, n, err)
	}
	return tenantctx.TenantContext{TenantID: seedAlta, PersonID: id, Owner: owner}
}

func optionIDs(opts []formsapi.FormFieldOption) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(opts))
	for _, o := range opts {
		out = append(out, o.Ref.EntityId)
	}
	return out
}

func TestFormObjects(t *testing.T) { //nolint:paralleltest // archives a vehicle of the seed for a while
	pools, ev := formsPorts(t)
	o := formObjects{pools: pools, ev: ev, hidden: tasks.HiddenTasks{Pools: pools, Authz: ev}, trips: newPoolTrips(pools, time.Now)}
	ctx, db := t.Context(), super(t, "t_alta")
	owner, therapist := altaMember(t, "m-owner", true), altaMember(t, "m-morozova", false)
	seen := archivedVehicle(t, o, owner)
	var trips int
	if err := db.QueryRowContext(ctx, `select count(*) from fleet.trips`).Scan(&trips); err != nil {
		t.Fatal(err)
	}
	if got, err := o.Options(ctx, owner, "trip", ""); err != nil || len(got) != trips {
		t.Fatalf("trips of the owner: %d %v, want %d", len(got), err, trips)
	}
	if got, err := o.Options(ctx, owner, "task", ""); err != nil || len(got) == 0 {
		t.Fatalf("tasks of the owner: %d %v", len(got), err)
	}
	for _, kind := range []string{"vehicle", "trip", "task"} {
		if got, err := o.Options(ctx, therapist, kind, ""); err != nil || len(got) != 0 {
			t.Fatalf("%s of the therapist without the rights of fleet and tasks: %v %v, want none", kind, got, err)
		}
	}
	if got, err := o.Labels(ctx, therapist, []formsapi.ObjectRef{seen}); err != nil || len(got) != 0 {
		t.Fatalf("the label of a vehicle the therapist does not see: %v %v", got, err)
	}
}

// archivedVehicle: the owner chooses among the live vehicles; one archived is no choice any more but keeps the label
// of an old answer. It returns a vehicle the owner sees.
func archivedVehicle(t *testing.T, o formObjects, owner tenantctx.TenantContext) formsapi.ObjectRef {
	t.Helper()
	ctx, db := t.Context(), super(t, "t_alta")
	var live int
	if err := db.QueryRowContext(ctx, `select count(*) from fleet.vehicles where archived_at is null`).Scan(&live); err != nil {
		t.Fatal(err)
	}
	vehicles, err := o.Options(ctx, owner, "vehicle", "")
	if err != nil || len(vehicles) != live || live < 2 {
		t.Fatalf("vehicles of the owner: %d %v, want the %d live ones", len(vehicles), err, live)
	}
	gone := vehicles[0].Ref
	if _, err := db.ExecContext(ctx, `update fleet.vehicles set archived_at = now() where id = $1`, gone.EntityId); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(t.Context(), `update fleet.vehicles set archived_at = null where id = $1`, gone.EntityId)
	})
	vehicles, err = o.Options(ctx, owner, "vehicle", "")
	if err != nil || len(vehicles) != live-1 || slices.Contains(optionIDs(vehicles), gone.EntityId) {
		t.Fatalf("after the archive: %d %v, want %d without %s", len(vehicles), err, live-1, gone.EntityId)
	}
	if labels, err := o.Labels(ctx, owner, []formsapi.ObjectRef{gone}); err != nil || labels[gone] == "" {
		t.Fatalf("the label of the archived vehicle of an old answer: %v %v", labels, err)
	}
	return vehicles[0].Ref
}

func TestFormUploadsOfGuest(t *testing.T) { //nolint:paralleltest // one seeded stack
	s3, stop, err := miniotest.Start(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(stop)
	pools, ev := formsPorts(t)
	vars := map[string]string{"S3_ENDPOINT": s3.Endpoint, "S3_REGION": s3.Region, "S3_BUCKET": s3.Bucket, "S3_ACCESS_KEY": s3.AccessKey,
		"S3_SECRET_KEY": s3.SecretKey}
	u, err := formUploadsOf(pools, ev, func(k string) string { return vars[k] }, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	ctx, form := t.Context(), uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:fm-insp"))
	content := append([]byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F', 0}, bytes.Repeat([]byte("w421"), 64)...)
	sum := sha256.Sum256(content)
	sha := hex.EncodeToString(sum[:])
	guest, stranger := uuid.New(), uuid.New()
	ticket, err := u.Initiate(ctx, seedAlta, guest, form, forms.Upload{FileName: "guest.jpg", ContentType: "image/jpeg",
		SizeBytes: int64(len(content)), SHA256: sha})
	if err != nil {
		t.Fatal(err)
	}
	putObject(t, ticket.UploadUrl, content)
	if _, err := u.Complete(ctx, seedAlta, stranger, ticket.UploadId, sha); err == nil {
		t.Fatal("another guest completes the upload of the nonce")
	}
	f, err := u.Complete(ctx, seedAlta, guest, ticket.UploadId, sha)
	if err != nil || f.Id != ticket.FileId {
		t.Fatalf("complete: %+v %v", f, err)
	}
	if st, err := u.Status(ctx, seedAlta, guest, ticket.UploadId); err != nil || st.Id != ticket.FileId {
		t.Fatalf("status: %+v %v", st, err)
	}
	if _, err := u.Status(ctx, seedAlta, stranger, ticket.UploadId); err == nil {
		t.Fatal("another guest reads the upload of the nonce")
	}
	guestFileOf(t, ticket.FileId, form, guest)
}

// guestFileOf requires the file id to be an answer file of form uploaded by the actor of the nonce of guest.
func guestFileOf(t *testing.T, id, form, guest uuid.UUID) {
	t.Helper()
	var owner, purpose string
	var by, parent uuid.UUID
	if err := super(t, "t_alta").QueryRowContext(t.Context(), `select owner_type, owner_id, purpose, uploaded_by from files.objects
		where id = $1`, id).Scan(&owner, &parent, &purpose, &by); err != nil {
		t.Fatal(err)
	}
	if owner != "forms.form" || parent != form || purpose != "form_attachment" || by != guest {
		t.Fatalf("the file of the guest: %s %s %s %s", owner, parent, purpose, by)
	}
}
