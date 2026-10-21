//go:build integration

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"maps"
	"slices"
	"sync"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// memObjects is an object storage in memory: what the seed puts.
type memObjects struct {
	mu sync.Mutex
	m  map[string][]byte
}

func (o *memObjects) Put(_ context.Context, key, _ string, data []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.m == nil {
		o.m = map[string][]byte{}
	}
	o.m[key] = bytes.Clone(data)
	return nil
}

// seedTasksDB writes the org structure, the people and the tasks of td into a fresh tenant DB twice; objs is the
// object storage of the seed (nil — none).
func seedTasksDB(t *testing.T, name string, td tenantData, objs objectStore) *sql.DB {
	t.Helper()
	db := cluster.DB(t, cluster.NewDatabase(t, name), migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), db, migrations.Tenant); err != nil {
		t.Fatal(err)
	}
	for pass := 1; pass <= 2; pass++ {
		tx, err := db.BeginTx(t.Context(), nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, step := range []func() error{
			func() error { return writeUnits(t.Context(), tx, td) },
			func() error { return writePeople(t.Context(), tx, td) },
			func() error { return writeTasks(t.Context(), tx, td, objs) },
		} {
			if err := step(); err != nil {
				_ = tx.Rollback()
				t.Fatalf("%s pass %d: %v", td.tenant.proto, pass, err)
			}
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func counts(t *testing.T, db *sql.DB, proto string, want map[string]int) {
	t.Helper()
	for q, n := range want {
		if got := count(t, db, q); got != n {
			t.Errorf("%s: %s = %d, want %d", proto, q, got, n)
		}
	}
}

// The tasks of «Альта» and «Лотос» (W4.11) are written into fresh tenant DBs with the ids of PD-30, twice without
// duplicates: the projects with v1 (the funnel without a version), the tasks with their statuses, parents, checklists
// and comments, the attachment of T-65 as a checked file of core.files whose bytes are in the object storage, the
// rules and the runs.
func TestWriteTasksTwice(t *testing.T) {
	t.Parallel()
	for _, td := range []tenantData{alta, lotosData} {
		objs := &memObjects{}
		db := seedTasksDB(t, "tasks_seed_"+td.tenant.proto[2:], td, objs)
		id := func(proto string) string { return seedID(td.tenant.proto, proto).String() }
		want := map[string]int{
			`select count(*) from tasks.projects`:                                            1,
			`select count(*) from tasks.workflow_versions`:                                   1,
			`select count(*) from tasks.tasks`:                                               2,
			`select count(*) from tasks.automations`:                                         0,
			`select count(*) from tasks.tasks where legacy_key = 'T-7' and status_id = 's2'`: 1,
			`select count(*) from tasks.projects where id = '` + id("salon") + `' and workflow_key = 'initial'
			   and access = 'limited' and current_version = 1 and owner_id = '` + id("m-owner") + `'`: 1,
		}
		if td.tenant.proto == protoAlta {
			want = map[string]int{
				`select count(*) from tasks.projects`:          2,
				`select count(*) from tasks.workflow_versions`: 1,
				`select count(*) from tasks.tasks`:             11,
				`select count(*) from tasks.projects where key = 'ЗАЯ' and flow = 'leads' and access is null
				   and current_version is null`: 1,
				`select count(*) from tasks.tasks where legacy_key = 'T-65' and number = 65 and status_id = 's3'
				   and parent_task_id = '` + id("T-66") + `' and author_id = '` + id("m-vasiliev") + `'
				   and checklist = '[{"id":"ch-1","text":"Счёт приложен","done":true},{"id":"ch-2","text":"Сезонность подтверждена","done":true}]'`: 1,
				`select count(*) from tasks.tasks where legacy_key = 'L-29' and status_id = 'measure' and workflow_version is null`: 1,
				`select count(*) from tasks.task_events where kind = 'comment'`:                                                     4,
				`select count(*) from tasks.task_files tf join files.objects f on f.id = tf.file_id
				   where f.state = 'ready' and f.purpose = 'task_attachment' and f.owner_type = 'tasks.task'
				   and f.owner_id = '` + id("T-65") + `' and f.bytes = 184320`: 1,
				`select count(*) from files.upload_sessions where state = 'completed'`:             1,
				`select count(*) from files.quota_ledger where kind = 'commit' and bytes = 184320`: 1,
				// The usage of a fresh tenant DB has no row yet: the seed creates it, so the quota counts the invoice once.
				`select count(*) from files.usage where committed_bytes = 184320 and reserved_bytes = 0`: 1,
				`select count(*) from tasks.automations where enabled`:                                   1,
				`select count(*) from tasks.automations where id = '` + id("ar-1") + `' and run_count = 2
				   and action_member_id = '` + id("m-kotova") + `' and condition_priority = 'urgent'`: 1,
				`select count(*) from tasks.automation_runs where task_id = '` + id("T-64") + `' and result = 'ok'`: 1,
			}
		}
		counts(t, db, td.tenant.proto, want)
		if td.tenant.proto == protoAlta {
			checkSeedObject(t, db, td, objs.m)
		} else if len(objs.m) != 0 {
			t.Errorf("lotos put objects %v", slices.Collect(maps.Keys(objs.m)))
		}
	}
}

// checkSeedObject: the T-65 invoice is the one object of the storage, under the key of its row, a PDF of the size and
// the checksum of the row (W4.11 возврат 1: a download from the card of T-65 on the stand works).
func checkSeedObject(t *testing.T, db *sql.DB, td tenantData, objects map[string][]byte) {
	t.Helper()
	file := seedID(td.tenant.proto, "file:T-65:f-1")
	var (
		key string
		sum []byte
		n   int64
	)
	if err := db.QueryRowContext(t.Context(), `select object_key, sha256, bytes from files.objects where id = $1`, file).
		Scan(&key, &sum, &n); err != nil {
		t.Fatal(err)
	}
	data, ok := objects[key]
	got := sha256.Sum256(data)
	if len(objects) != 1 || !ok || key != files.FileKey(td.tenant.id(), file) || int64(len(data)) != n ||
		!bytes.Equal(got[:], sum) || !bytes.HasPrefix(data, []byte("%PDF-")) {
		t.Fatalf("object of T-65: key %s, %d objects, %d bytes (row %d), checksum of the row matches %v",
			key, len(objects), len(data), n, bytes.Equal(got[:], sum))
	}
}

// Without an object storage (S3_ENDPOINT not set) the seed attaches nothing: no row of core.files that could not be
// downloaded, no bytes in the quota; the task T-65 is there without its invoice.
func TestWriteTasksWithoutStorage(t *testing.T) {
	t.Parallel()
	db := seedTasksDB(t, "tasks_seed_no_storage", alta, nil)
	counts(t, db, protoAlta, map[string]int{
		`select count(*) from tasks.tasks where legacy_key = 'T-65'`:        1,
		`select count(*) from files.objects`:                                0,
		`select count(*) from files.upload_sessions`:                        0,
		`select count(*) from files.quota_ledger`:                           0,
		`select count(*) from tasks.task_files`:                             0,
		`select count(*) from files.usage where committed_bytes <> 0`:       0,
		`select count(*) from tasks.task_events where kind = 'comment'`:     4,
		`select count(*) from tasks.automations where run_count = 2`:        1,
		`select count(*) from tasks.tasks where parent_task_id is not null`: 2,
	})
}
