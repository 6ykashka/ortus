package service_test

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// w700Sum is the SHA-256 of tenant/0062_service.sql as the steward of W7.00 issued it (commit ed1710e18, line ends LF).
// The file is applied on the stands: it is not edited in place (CLAUDE.md, «номера миграций — стюард»), a change goes to a
// migration of its own (Q-W7.31-1).
const w700Sum = "4d12ad44400b526f40900518adeba9ea6c831579ef54336737790c298cbbc051"

func tenantMigration(t *testing.T, name string) string {
	t.Helper()
	b, err := fs.ReadFile(os.DirFS(filepath.Join("..", "..", "..", "migrations", "tenant")), name)
	if err != nil {
		t.Fatal(err)
	}
	return strings.ReplaceAll(string(b), "\r\n", "\n")
}

func TestMigration0062StaysAsTheStewardIssuedIt(t *testing.T) {
	t.Parallel()
	sum := sha256.Sum256([]byte(tenantMigration(t, "0062_service.sql")))
	if got := hex.EncodeToString(sum[:]); got != w700Sum {
		t.Fatalf("0062_service.sql changed in place (sha256 %s, issued %s): move the change to 0063_service_w731.sql", got, w700Sum)
	}
}

func TestMigration0063CarriesTheChangesOfW731(t *testing.T) {
	t.Parallel()
	up, down, ok := strings.Cut(tenantMigration(t, "0063_service_w731.sql"), "\n-- +goose Down\n")
	if !ok {
		t.Fatal("no Down section")
	}
	for _, want := range []string{
		"alter table service.directions",       // the key of a direction takes the letters of the prototype: МАС, КОС, ОТД, ГРЗ
		"А-ЯЁ",                                 // …in the check on the key
		"service.messages",                     // the order of the feed at equal moments
		"seq",                                  // …is the column seq
		"generated always as identity",         // …filled by the database
		"drop constraint messages_note_author", // the auto reply to a client has no author
		"or auto",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("0063 Up lacks %q", want)
		}
	}
	if !strings.Contains(down, "drop column seq") {
		t.Error("0063 Down does not take the column seq off")
	}
}
