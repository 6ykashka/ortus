//go:build integration

package main

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W4.21, return 3 (review, major): the Hider of the files of the answers (hiddenFormFiles) joins the Hiders of every
// parent, so it runs on the files of the trips and of the tasks too. On the seed of «Альта» with a photo of a trip and an
// attachment of a task, every member lists and opens the same files of the other parents with the three Hiders as with
// the two of before return 2 (the driver pool and the closed tasks) — the files of the answers alone differ.
func TestFilesOfOtherParents(t *testing.T) { //nolint:paralleltest // adds files of a trip and of a task to the seed of «Альта»
	pools, ev := formsPorts(t)
	full, err := filesService(pools, ev, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	before := &files.Service{Pools: pools, Authz: ev, Parents: full.Parents,
		Hidden: closedParents{newPoolTrips(pools, time.Now), hiddenTasks{H: tasks.HiddenTasks{Pools: pools, Authz: ev}}, files.ChatHider{Pools: pools}}}
	photo, attachment := otherParentFiles(t)
	seen := map[uuid.UUID]bool{}
	for _, tc := range altaPeople(t) {
		got, want := otherFileIDs(t, full, tc), otherFileIDs(t, before, tc)
		if !slices.Equal(got, want) {
			t.Fatalf("listFiles of %s with the Hider of the answers: %v, want %v as before it", tc.PersonID, got, want)
		}
		for _, id := range got {
			if _, err := full.File(t.Context(), tc, id); err != nil {
				t.Fatalf("getFile %s of %s: %v", id, tc.PersonID, err)
			}
			seen[id] = true
		}
	}
	if !seen[photo] || !seen[attachment] {
		t.Fatalf("the photo of the trip (%v) and the attachment of the task (%v) are seen by no member: the check is empty", seen[photo], seen[attachment])
	}
}

// otherParentFiles writes a checked photo of a trip of the seed (seedTrip) by its driver and an attachment of a task of
// the seed by its assignee for the test.
func otherParentFiles(t *testing.T) (photo, attachment uuid.UUID) {
	t.Helper()
	ctx, db := t.Context(), super(t, "t_alta")
	trip := seedTrip(t)
	var driver, task, assignee uuid.UUID
	if err := db.QueryRowContext(ctx, `select driver_person_id from fleet.trips where id = $1`, trip).Scan(&driver); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `select id, assignee_id from tasks.tasks where deleted_at is null and assignee_id is not null
		order by id limit 1`).Scan(&task, &assignee); err != nil {
		t.Fatal(err)
	}
	return parentFile(t, "fleet.trip", "inspection", trip, driver), parentFile(t, "tasks.task", "task_attachment", task, assignee)
}

// parentFile writes a checked file of purpose to the parent ownerType/owner uploaded by person for the test.
func parentFile(t *testing.T, ownerType, purpose string, owner, person uuid.UUID) uuid.UUID {
	t.Helper()
	ctx, db, id := t.Context(), super(t, "t_alta"), uuid.New()
	if _, err := db.ExecContext(ctx, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime,
		detected_mime, bytes, sha256, uploaded_by, ready_at) values ($1, $4, 'ready', $5, $6, $2,
		'image/jpeg', 'image/jpeg', 2048, sha256(convert_to($4, 'UTF8')), $3, now())`, id, owner, person, "w421/"+id.String(),
		purpose, ownerType); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.ExecContext(context.WithoutCancel(ctx), `delete from files.objects where id = $1`, id); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	return id
}

// altaPeople are the tenant contexts of every person of the seed of «Альта» as a member (not the owner).
func altaPeople(t *testing.T) []tenantctx.TenantContext {
	t.Helper()
	rows, err := super(t, "t_alta").QueryContext(t.Context(), `select id from people.person_profiles order by id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []tenantctx.TenantContext
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		out = append(out, tenantctx.TenantContext{TenantID: seedAlta, PersonID: id})
	}
	if err := rows.Err(); err != nil || len(out) == 0 {
		t.Fatalf("people of the seed: %d %v", len(out), err)
	}
	return out
}

// otherFileIDs are the ids of the files tc lists (listFiles, every page) but the files of the answers.
func otherFileIDs(t *testing.T, svc *files.Service, tc tenantctx.TenantContext) []uuid.UUID {
	t.Helper()
	var ids []uuid.UUID
	q := files.ListQuery{Limit: 200}
	for {
		page, err := svc.List(t.Context(), tc, q)
		if err != nil {
			t.Fatalf("listFiles of %s: %v", tc.PersonID, err)
		}
		for _, f := range page.Items {
			if f.Purpose != files.PurposeFormAttachment {
				ids = append(ids, f.ID)
			}
		}
		if page.Next == "" {
			return ids
		}
		q.Cursor = page.Next
	}
}
