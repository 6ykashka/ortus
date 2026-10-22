//go:build integration

package knowledge

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// rolledBack runs fn in a transaction of tenant A as the application (the transaction of a response of a form) and
// rolls it back: the knowledge base of the seed the other tests read stays as it is.
func rolledBack(t *testing.T, fn func(tx pgx.Tx)) {
	t.Helper()
	pool, err := pools.For(t.Context(), tenantA)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(t.Context()) }()
	fn(tx)
}

// The port of «Формы» (W4.21): the pages and tables of the editor of the action «Сохранить в Базу знаний» as a member
// sees them, and the row or the record written in the transaction of the response on behalf of the author of the rule
// (kbRun of api.js) — with its refusals for the journal of the response.
func TestFormPort(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	journal, insp := pid("kb-5"), pid("kt-insp")
	rolledBack(t, func(tx pgx.Tx) {
		ns, err := svc.FormNodes(ctx, tx, tenantA, pid("m-kotova"), false, []uuid.UUID{journal, pid("kb-fin"), uuid.New()})
		require.NoError(t, err)
		require.Len(t, ns, 2)
		assert.True(t, ns[journal].Visible)
		assert.Equal(t, "Журнал осмотров машин", ns[journal].Title)
		require.Len(t, ns[journal].Tables, 1)
		assert.Equal(t, []any{insp, "Осмотры"}, []any{ns[journal].Tables[0].ID, ns[journal].Tables[0].Title})
		assert.Contains(t, ns[journal].Tables[0].Columns, pid("c-odo"))
		assert.False(t, ns[pid("kb-fin")].AllEmployees, "a finance page is closed to the drivers")
		driver, err := svc.FormNodes(ctx, tx, tenantA, pid("m-vasiliev"), false, []uuid.UUID{pid("kb-fin")})
		require.NoError(t, err)
		assert.False(t, driver[pid("kb-fin")].Visible, "the driver does not see a finance page")
		formRows(t, tx)
		formRefusals(t, tx)
		formPurge(t, tx)
	})
}

// formPurge: «Хранить ответы» of the forms (Q-W4.00-forms-22, D-26) deletes the rows and the records written for the
// deleted responses of a form — by the form and the numbers; the same number of another form and other responses stay.
func formPurge(t *testing.T, tx pgx.Tx) {
	t.Helper()
	ctx, at, insp, odo := t.Context(), harness.Now(), pid("kt-insp"), pid("c-odo")
	form, other := uuid.New(), uuid.New()
	write := func(f uuid.UUID, number string, table uuid.UUID, node uuid.UUID) {
		t.Helper()
		_, err := svc.FormWrite(ctx, tx, tenantA, FormRecord{Author: pid("m-kotova"), AuthorName: "Марина Котова", Node: node,
			Table: table, Cells: map[uuid.UUID]string{odo: number}, Head: number, Lines: []FormLine{{"Пробег", "1"}}, Form: f,
			Response: number, Version: 1, At: at})
		require.NoError(t, err)
	}
	write(form, "R-3001", insp, pid("kb-5"))
	write(form, "R-3001", uuid.Nil, pid("kb-1"))
	write(form, "R-3002", insp, pid("kb-5"))
	write(other, "R-3001", insp, pid("kb-5"))
	n, err := svc.FormPurge(ctx, tx, form, []string{"R-3001"})
	require.NoError(t, err)
	assert.Equal(t, 2, n, "the row and the record of R-3001")
	left := func(f uuid.UUID, number string) int {
		var c int
		require.NoError(t, tx.QueryRow(ctx, `select (select count(*) from kb.table_rows where form_id = $1 and response_number = $2)
			+ (select count(*) from kb.entries where form_id = $1 and response_number = $2)`, f, number).Scan(&c))
		return c
	}
	assert.Zero(t, left(form, "R-3001"))
	assert.Equal(t, 1, left(form, "R-3002"), "another response of the form")
	assert.Equal(t, 1, left(other, "R-3001"), "the same number of another form")
	n, err = svc.FormPurge(ctx, tx, form, nil)
	require.NoError(t, err)
	assert.Zero(t, n)
}

// formRows writes a row at the top and at the end of «Осмотры» and a record on «Регламент приёмки смены».
func formRows(t *testing.T, tx pgx.Tx) {
	t.Helper()
	ctx, at, insp, odo := t.Context(), harness.Now(), pid("kt-insp"), pid("c-odo")
	res, err := svc.FormWrite(ctx, tx, tenantA, FormRecord{Author: pid("m-kotova"), AuthorName: "Марина Котова", Node: pid("kb-5"),
		Table: insp, Cells: map[uuid.UUID]string{odo: "84530", pid("c-resp"): "R-1013", uuid.New(): "лишнее"}, Form: uuid.New(),
		Response: "R-1013", Version: 3, At: at})
	require.NoError(t, err)
	assert.Equal(t, FormWriteResult{Text: "Строка в таблице «Осмотры» · страница «Журнал осмотров машин»"}, res)
	var (
		cells map[string]string
		added time.Time
	)
	require.NoError(t, tx.QueryRow(ctx, `select cells, added_at from kb.table_rows where table_id = $1 and response_number = 'R-1013'
		and form_version = 3`, insp).Scan(&cells, &added))
	assert.Equal(t, map[string]string{odo.String(): "84530", pid("c-resp").String(): "R-1013"}, cells, "the columns of the table only")
	assert.True(t, added.Equal(at))
	_, err = svc.FormWrite(ctx, tx, tenantA, FormRecord{Author: pid("m-kotova"), AuthorName: "Марина Котова", Node: pid("kb-5"),
		Table: insp, Bottom: true, Cells: map[uuid.UUID]string{odo: "1"}, Form: uuid.New(), Response: "R-1014", Version: 3, At: at})
	require.NoError(t, err)
	var last string
	require.NoError(t, tx.QueryRow(ctx, `select coalesce(response_number, '') from kb.table_rows where table_id = $1
		order by added_at limit 1`, insp).Scan(&last))
	assert.Equal(t, "R-1014", last, "«В конец»: before the oldest row")
	rec, err := svc.FormWrite(ctx, tx, tenantA, FormRecord{Author: pid("m-kotova"), AuthorName: "Марина Котова", Node: pid("kb-1"),
		Head: "Рейс Р-196", Lines: []FormLine{{"Пробег", "84530"}}, Form: uuid.New(), Response: "R-1013", Version: 3, At: at})
	require.NoError(t, err)
	assert.Equal(t, FormWriteResult{Text: "Запись на странице «Регламент приёмки смены»"}, rec)
	var head string
	require.NoError(t, tx.QueryRow(ctx, `select head from kb.entries where node_id = $1 and response_number = 'R-1013'`, pid("kb-1")).Scan(&head))
	assert.Equal(t, "Рейс Р-196", head)
}

// formRefusals are the refusals of kbRun: no page, no table, a blocked author, a page he does not see, no right.
func formRefusals(t *testing.T, tx pgx.Tx) {
	t.Helper()
	ctx, journal, insp := t.Context(), pid("kb-5"), pid("kt-insp")
	refusals := []struct {
		rec  FormRecord
		want string
	}{
		{FormRecord{Author: pid("m-kotova"), AuthorName: "Марина Котова", Node: uuid.New()}, "страница удалена из Базы знаний"},
		{FormRecord{Author: pid("m-kotova"), AuthorName: "Марина Котова", Node: journal, Table: uuid.New()},
			"таблица удалена со страницы «Журнал осмотров машин»"},
		{FormRecord{Author: pid("m-gromov"), AuthorName: "Кирилл Громов", Node: journal, Table: insp},
			"у автора правила Кирилл Громов нет права «Создавать» в Базе знаний"},
		{FormRecord{Author: pid("m-vasiliev"), AuthorName: "Илья Васильев", Node: pid("kb-fin")},
			"страница «Тарифы и начисления» недоступна автору правила Илья Васильев"},
		{FormRecord{Author: pid("m-vasiliev"), AuthorName: "Илья Васильев", Node: journal, Table: insp},
			"у автора правила Илья Васильев нет права «Создавать» в Базе знаний"},
	}
	for _, c := range refusals {
		c.rec.Form, c.rec.Response, c.rec.Version, c.rec.At = uuid.New(), "R-2000", 1, harness.Now()
		got, err := svc.FormWrite(ctx, tx, tenantA, c.rec)
		require.NoError(t, err)
		assert.Equal(t, FormWriteResult{Refused: c.want}, got)
	}
	var n int
	require.NoError(t, tx.QueryRow(ctx, `select (select count(*) from kb.table_rows where response_number = 'R-2000')
		+ (select count(*) from kb.entries where response_number = 'R-2000')`).Scan(&n))
	assert.Zero(t, n, "a refusal writes nothing")
}
