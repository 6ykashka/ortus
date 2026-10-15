package main

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

func read(t *testing.T, path string) []byte {
	t.Helper()
	b, err := fs.ReadFile(os.DirFS(filepath.Dir(path)), filepath.Base(path))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestGenerateGolden(t *testing.T) {
	t.Parallel()
	got, err := Generate("sample.yaml", read(t, filepath.Join("testdata", "sample.yaml")), fixtures.Default())
	if err != nil {
		t.Fatal(err)
	}
	want := read(t, filepath.Join("testdata", "sample_test.go.golden"))
	if !bytes.Equal(got, want) {
		t.Fatalf("Generate(sample.yaml) differs from testdata/sample_test.go.golden:\n%s", got)
	}
}

func TestGenerateRejectsInvalidMatrix(t *testing.T) {
	t.Parallel()
	_, err := Generate("sample.yaml", []byte("module: other\nendpoints: []\n"), fixtures.Default())
	if err == nil || !strings.Contains(err.Error(), "sample.yaml") {
		t.Fatalf("Generate error = %v, want a format error naming sample.yaml", err)
	}
}

func TestGoNames(t *testing.T) {
	t.Parallel()
	for module, want := range map[string][2]string{
		"me":            {"meMatrix", "TestIsolationMe"},
		"fleet_units":   {"fleetUnitsMatrix", "TestIsolationFleetUnits"},
		"cash_2_ledger": {"cash2LedgerMatrix", "TestIsolationCash2Ledger"},
	} {
		v, f := goNames(module)
		if v != want[0] || f != want[1] {
			t.Errorf("goNames(%s) = %s, %s; want %s, %s", module, v, f, want[0], want[1])
		}
	}
}

// setup copies testdata/sample.yaml into a fresh directory.
func setup(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "sample.yaml"), read(t, filepath.Join("testdata", "sample.yaml")), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func runCLI(t *testing.T, args ...string) (int, string) {
	t.Helper()
	var out bytes.Buffer
	code := run(args, &out, &out)
	return code, out.String()
}

func TestRunWritesAndChecks(t *testing.T) {
	t.Parallel()
	dir := setup(t)
	if code, out := runCLI(t, "-check", "-dir", dir); code != 1 || !strings.Contains(out, "sample_test.go") {
		t.Fatalf("-check before generation = %d %q, want 1 naming sample_test.go", code, out)
	}
	if code, out := runCLI(t, "-dir", dir); code != 0 {
		t.Fatalf("generate = %d %q", code, out)
	}
	golden := read(t, filepath.Join("testdata", "sample_test.go.golden"))
	if got := read(t, filepath.Join(dir, "sample_test.go")); !bytes.Equal(got, golden) {
		t.Fatalf("written file differs from the golden file:\n%s", got)
	}
	if code, out := runCLI(t, "-check", "-dir", dir); code != 0 {
		t.Fatalf("-check after generation = %d %q, want 0", code, out)
	}
	if err := os.WriteFile(filepath.Join(dir, "sample_test.go"), append(golden, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	if code, out := runCLI(t, "-check", "-dir", dir); code != 1 || !strings.Contains(out, "out of date") {
		t.Fatalf("-check on an edited file = %d %q, want 1 «out of date»", code, out)
	}
}

func TestRunOrphansAndHandWrittenFiles(t *testing.T) {
	t.Parallel()
	dir := setup(t)
	orphan := filepath.Join(dir, "gone_test.go")
	if err := os.WriteFile(orphan, []byte(header("gone.yaml")+"\npackage isolation\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	hand := filepath.Join(dir, "main_test.go")
	if err := os.WriteFile(hand, []byte("package isolation\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if code, out := runCLI(t, "-check", "-dir", dir); code != 1 || !strings.Contains(out, "orphan") || !strings.Contains(out, "gone_test.go") {
		t.Fatalf("-check with an orphan = %d %q, want 1 naming the orphan", code, out)
	}
	if code, out := runCLI(t, "-dir", dir); code != 0 {
		t.Fatalf("generate = %d %q", code, out)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("orphan generated file must be removed, stat: %v", err)
	}
	if string(read(t, hand)) != "package isolation\n" {
		t.Fatal("a hand-written test file must stay untouched")
	}
}

func TestRunReportsFormatErrors(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "bad.yaml"), []byte("module: bad\nendpoints: []\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if code, out := runCLI(t, "-dir", dir); code != 1 || !strings.Contains(out, "bad.yaml") || !strings.Contains(out, "no endpoints") {
		t.Fatalf("generate with a broken file = %d %q", code, out)
	}
	if code, _ := runCLI(t, "-unknown"); code != 2 {
		t.Fatalf("unknown flag = %d, want 2", code)
	}
}

// Сгенерированные файлы набора совпадают с YAML (входит в go test ./..., без Docker).
func TestGeneratedUpToDate(t *testing.T) {
	t.Parallel()
	if code, out := runCLI(t, "-check", "-dir", filepath.Join("..", "..")); code != 0 {
		t.Fatalf("backend/test/isolation is out of date — run `go -C backend generate ./test/isolation`:\n%s", out)
	}
}
