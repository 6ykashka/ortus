//go:build integration

package main

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// The documents of «Альта» are written into a fresh tenant DB after its units, people and access, twice without
// duplicates: the folders with their lists, the templates, the documents with their versions, the words of the scan.
func TestWriteDocsTwice(t *testing.T) {
	t.Parallel()
	td := alta
	name := cluster.NewDatabase(t, "docs_seed_alta")
	db := cluster.DB(t, name, migrations.RoleMigrator)
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
			func() error { return writeAccess(t.Context(), tx, td) },
			func() error { return writeDocs(t.Context(), tx, td) },
		} {
			if err := step(); err != nil {
				_ = tx.Rollback()
				t.Fatalf("pass %d: %v", pass, err)
			}
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("pass %d: %v", pass, err)
		}
	}
	for q, n := range map[string]int{
		`select count(*) from docs.folders`:                                                   6,
		`select count(*) from docs.documents`:                                                 6,
		`select count(*) from docs.versions`:                                                  11,
		`select count(*) from docs.ocr_words`:                                                 3,
		`select count(*) from docs.jobs where status = 'failed'`:                              1,
		`select count(*) from docs.folders where sensitivity = 'finance' and mode = 'listed'`: 1,
	} {
		var got int
		if err := db.QueryRowContext(t.Context(), q).Scan(&got); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		if got != n {
			t.Errorf("%s = %d, want %d", q, got, n)
		}
	}
}
