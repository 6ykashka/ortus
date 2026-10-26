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

// migrationBlocks — блоки номеров по этапам (план v2 §3.5, PD-59; та же таблица — tools/ci/check-migrations.mjs):
// внутри блока номера идут подряд от его начала, незанятый хвост закрытого блока — резерв, а не дыра.
var migrationBlocks = map[migrations.Kind][][2]int{
	migrations.Control: {{1, 3}, {4, 9999}},
	migrations.Tenant:  {{1, 2}, {3, 9}, {10, 19}, {20, 39}, {40, 49}, {50, 59}, {60, 69}},
}

// Нумерация (карточка W0.06, номера стюарда PD-59): control 0001–0003 (v0.2), 0004–0005 (W1.00), 0006 (W1.03,
// резерв «0006+»), 0007–0008 (W4.07), 0009 (W4.05, индекс публичных ссылок форм), 0010 (W7.00, возврат 1: маршрут публичных путей этапа 7);
// tenant 0001–0002 (v0.2), блок этапа 1 — 0003–0006 (W0.08) и 0007 (W1.00), резерв 0008–0009;
// блок этапа 2 — 0010–0012 (W2.00), 0013 (W2.40), 0014 (W2.51), 0015–0017 (W2.52) и 0018 (W2.57), 0019 не занят
// (блок закрыт); блок этапа 4 — 0020 (W4.02), 0021–0022 (W4.06), 0023 (W2.71, S2-20, после W4.02 и W4.06), 0024
// (W4.04, в ветке — 0023, после W2.71), 0025 (W4.03, «Задачи и проекты», в ветке — 0023, после W4.04), 0026 (W4.05,
// «Формы и опросы»), 0027 (W2.78, S2-20 «машина отпущена», Q-W2.72-1; следующий свободный, стюарду — подтвердить),
// резерв 0028–0039; блок этапа 5 — 0040–0044 (W5.00: касса, склад, SPA), резерв 0045–0049; блок этапа 6 — 0050–0054
// (W6.00, схема repairs «Ремонта и стройки»), резерв 0055–0059; control 0010 (W6.00, индекс публичных ссылок кабинета
// заказчика) и 0011 (W7.00, маршрут публичных путей этапа 7); блок этапа 7 — 0060 (W7.00, «Чаты»), 0061 («Документы»),
// 0062 («Обращения клиентов»), резерв 0063–0069. Без дублей и без дыр внутри блоков.
func TestNumberingContiguous(t *testing.T) {
	t.Parallel()
	want := map[migrations.Kind]struct{ files, latest int }{
		migrations.Control: {11, 11},
		migrations.Tenant:  {37, 62}, // + 0040–0044 (W5.00), 0050–0054 (W6.00) и 0060–0062 (W7.00)
	}
	for k, w := range want {
		names := files(t, k)
		if len(names) != w.files {
			t.Fatalf("%s: %d files %v, want %d", k, len(names), names, w.files)
		}
		used := map[int]bool{}
		for _, name := range names {
			m := fileNameRe.FindStringSubmatch(name)
			if m == nil {
				t.Fatalf("%s/%s: name must match %s", k, name, fileNameRe)
			}
			v, _ := strconv.Atoi(m[1])
			if used[v] {
				t.Errorf("%s/%s: duplicate version %d", k, name, v)
			}
			used[v] = true
		}
		for _, e := range blockErrors(migrationBlocks[k], used) {
			t.Errorf("%s: %s", k, e)
		}
		if got := migrations.Latest(k); got != int64(w.latest) {
			t.Errorf("Latest(%s) = %d, want %d", k, got, w.latest)
		}
	}
}

// blockOf returns the index of the block holding version v, or -1.
func blockOf(blocks [][2]int, v int) int {
	for i, b := range blocks {
		if v >= b[0] && v <= b[1] {
			return i
		}
	}
	return -1
}

// pendingStageBlocks — блоки, чей этап ещё не влит, хотя блок после него уже занят: пустой блок из списка не считается
// ошибкой; номера, выданные в нём позже, раннер goose без out-of-order на БД, уже стоящую выше, не накатит
// (api/README.md, «Порядок вливания номеров»). Сейчас таких нет: этап 5 влит (W5.00).
var pendingStageBlocks = map[int]bool{}

// blockErrors checks the stage-block rule: every version lies in a block; every block up to the last used one is
// non-empty and has no gaps from its start to its highest version (the unused tail of a block is a reserve).
func blockErrors(blocks [][2]int, used map[int]bool) []string {
	var errs []string
	top := make([]int, len(blocks))
	last := -1
	for v := range used {
		i := blockOf(blocks, v)
		if i < 0 {
			errs = append(errs, fmt.Sprintf("version %04d is outside the stage blocks", v))
			continue
		}
		top[i] = max(top[i], v)
		last = max(last, i)
	}
	for i := 0; i <= last; i++ {
		b := blocks[i]
		if top[i] == 0 && !pendingStageBlocks[b[0]] {
			errs = append(errs, fmt.Sprintf("block %04d–%04d is empty below a used block", b[0], b[1]))
		}
		for v := b[0]; v <= top[i]; v++ {
			if !used[v] {
				errs = append(errs, fmt.Sprintf("gap — no %04d in block %04d–%04d", v, b[0], b[1]))
			}
		}
	}
	return errs
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
	"notify",    // W0.08, tenant 0003: входящие уведомления
	"data",      // W4.06, tenant 0022: сохранённые виды и задания выгрузки «Данных»
	"kb",        // W4.04, tenant 0024: «База знаний» — пространства, дерево, версии, доступ, запросы, правила
	"tasks",     // W4.03, tenant 0025: «Задачи и проекты»
	"forms",     // W4.05, tenant 0026: «Формы и опросы»
	"cash",      // W5.00, tenant 0040–0042: касса
	"inventory", // W5.00, tenant 0043: склад
	"spa",       // W5.00, tenant 0044: салон и SPA
	"repairs",   // W6.00, tenants 0050–0054: «Ремонт и стройка»
	"chat",      // W7.00, tenant 0060: «Чаты»
	"docs",      // W7.00, tenant 0061: «Документы»
	"service",   // W7.00, tenant 0062: «Обращения клиентов»
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
