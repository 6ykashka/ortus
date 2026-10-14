package migrations_test

import (
	"fmt"
	"io/fs"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

var fileNameRe = regexp.MustCompile(`^(\d{4})_[a-z0-9_]+\.sql$`)

// files returns the embedded migration file names of a kind in lexical order.
func files(t *testing.T, k migrations.Kind) []string {
	t.Helper()
	names, err := fs.Glob(migrations.FS(k), "*.sql")
	if err != nil {
		t.Fatalf("glob %s: %v", k, err)
	}
	return names
}

func readFile(t *testing.T, k migrations.Kind, name string) string {
	t.Helper()
	b, err := fs.ReadFile(migrations.FS(k), name)
	if err != nil {
		t.Fatalf("read %s/%s: %v", k, name, err)
	}
	return string(b)
}

// Нумерация v0.2 (карточка W0.06): control 0001–0003, tenant 0001–0002, без пропусков и дублей.
func TestNumberingContiguous(t *testing.T) {
	t.Parallel()
	want := map[migrations.Kind]int{migrations.Control: 3, migrations.Tenant: 2}
	for k, n := range want {
		names := files(t, k)
		if len(names) != n {
			t.Fatalf("%s: %d files %v, want %d", k, len(names), names, n)
		}
		for i, name := range names {
			m := fileNameRe.FindStringSubmatch(name)
			if m == nil {
				t.Fatalf("%s/%s: name must match %s", k, name, fileNameRe)
			}
			v, _ := strconv.Atoi(m[1])
			if v != i+1 {
				t.Errorf("%s/%s: version %d, want %d (gap or duplicate)", k, name, v, i+1)
			}
		}
		if got := migrations.Latest(k); got != int64(n) {
			t.Errorf("Latest(%s) = %d, want %d", k, got, n)
		}
	}
}

// Каждый файл — одна транзакция goose: ровно один Up и один непустой Down, без NO TRANSACTION.
func TestGooseMarkers(t *testing.T) {
	t.Parallel()
	for _, k := range []migrations.Kind{migrations.Control, migrations.Tenant} {
		for _, name := range files(t, k) {
			text := readFile(t, k, name)
			if c := strings.Count(text, "\n-- +goose Up\n"); c != 1 {
				t.Errorf("%s/%s: %d «-- +goose Up» markers, want 1", k, name, c)
			}
			if c := strings.Count(text, "\n-- +goose Down\n"); c != 1 {
				t.Errorf("%s/%s: %d «-- +goose Down» markers, want 1", k, name, c)
			}
			if strings.Contains(text, "NO TRANSACTION") {
				t.Errorf("%s/%s: NO TRANSACTION is not allowed", k, name)
			}
			_, down, ok := strings.Cut(text, "\n-- +goose Down\n")
			if !ok || strings.TrimSpace(stripComments(down)) == "" {
				t.Errorf("%s/%s: empty Down", k, name)
			}
		}
	}
}

var tenantSchemas = []string{
	"core", "org", "people", "access", "modules", "files", "sched", "audit", "outbox", "fleet", "finance",
}

var objectRe = regexp.MustCompile(`(?im)^\s*(?:create\s+table|alter\s+table|create\s+view|create\s+type)\s+(?:if\s+(?:not\s+)?exists\s+)?([a-z0-9_."]+)` +
	`|^\s*create\s+(?:unique\s+)?index\s+[a-z0-9_]+\s+on\s+([a-z0-9_."]+)`)

// Tenant DB: модуль пишет только в свою схему — ни одного объекта в public (10-data-model «Принципы»).
func TestTenantObjectsSchemaQualified(t *testing.T) {
	t.Parallel()
	allowed := make(map[string]bool, len(tenantSchemas))
	for _, s := range tenantSchemas {
		allowed[s] = true
	}
	for _, name := range files(t, migrations.Tenant) {
		text := stripComments(readFile(t, migrations.Tenant, name))
		matches := objectRe.FindAllStringSubmatch(text, -1)
		if len(matches) == 0 {
			t.Fatalf("tenant/%s: no objects found", name)
		}
		for _, m := range matches {
			obj := m[1] + m[2]
			schema, _, ok := strings.Cut(obj, ".")
			if !ok || !allowed[schema] {
				t.Errorf("tenant/%s: object %q is not qualified with a tenant schema", name, obj)
			}
		}
	}
}

// Черновики tenant/drafts/ не встраиваются и не применяются (план §3.5).
func TestDraftsNotEmbedded(t *testing.T) {
	t.Parallel()
	for _, k := range []migrations.Kind{migrations.Control, migrations.Tenant} {
		err := fs.WalkDir(migrations.FS(k), ".", func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() && path != "." {
				return fmt.Errorf("unexpected directory %s/%s in embedded FS", k, path)
			}
			return nil
		})
		if err != nil {
			t.Error(err)
		}
	}
}

// stripComments removes «-- …» line comments (goose annotations included).
func stripComments(s string) string {
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i], _, _ = strings.Cut(l, "--")
	}
	return strings.Join(lines, "\n")
}
