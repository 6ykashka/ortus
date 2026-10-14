package migrations_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// designDir — SQL-эталон комплекта v0.2 (design/docs/db), относительно backend/migrations.
var designDir = filepath.Join("..", "..", "design", "docs", "db")

// normalize: CRLF → LF, без хвостовых пробелов строк, ровно один завершающий \n.
func normalize(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t")
	}
	return strings.TrimRight(strings.Join(lines, "\n"), "\n") + "\n"
}

// upBody returns the text between «-- +goose Up» and «-- +goose Down».
func upBody(t *testing.T, text string) string {
	t.Helper()
	_, rest, ok := strings.Cut(text, "\n-- +goose Up\n")
	if !ok {
		t.Fatal("no «-- +goose Up» marker")
	}
	up, _, ok := strings.Cut(rest, "\n-- +goose Down\n")
	if !ok {
		t.Fatal("no «-- +goose Down» marker")
	}
	return up
}

// Тело Up — байт-в-байт копия design/docs/db/<kind>_<file> (после нормализации). Правка схемы — только
// новой миграцией с номером от стюарда (план §3.5), не правкой копии.
func TestMirrorDesignSQL(t *testing.T) {
	t.Parallel()
	pairs := map[string]string{
		"control/0001_init.sql":     "control_0001_init.sql",
		"control/0002_billing.sql":  "control_0002_billing.sql",
		"control/0003_branding.sql": "control_0003_branding.sql",
		"tenant/0001_core.sql":      "tenant_0001_core.sql",
		"tenant/0002_fleet.sql":     "tenant_0002_fleet.sql",
	}
	for ours, design := range pairs {
		t.Run(ours, func(t *testing.T) {
			t.Parallel()
			kind, name, _ := strings.Cut(ours, "/")
			text := readFile(t, migrations.Kind(kind), name)
			wantHeader := "-- W0.06 · копия design/docs/db/" + design + " · не редактировать (тест TestMirrorDesignSQL)\n"
			if !strings.HasPrefix(text, wantHeader) {
				t.Errorf("first line must be %q", wantHeader)
			}
			raw, err := os.ReadFile(filepath.Join(designDir, design)) //nolint:gosec // G304: fixed names of the design SQL files
			if err != nil {
				t.Fatalf("read design: %v", err)
			}
			got, want := normalize(upBody(t, text)), normalize(string(raw))
			if got == want {
				return
			}
			gl, wl := strings.Split(got, "\n"), strings.Split(want, "\n")
			for i := 0; i < len(gl) && i < len(wl); i++ {
				if gl[i] != wl[i] {
					t.Fatalf("line %d differs:\n got: %q\nwant: %q", i+1, gl[i], wl[i])
				}
			}
			t.Fatalf("length differs: got %d lines, want %d", len(gl), len(wl))
		})
	}
}
