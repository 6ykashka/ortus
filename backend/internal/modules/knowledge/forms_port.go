package knowledge

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The port of the module «Формы» (W4.21, Q-W4.05-27): the editor of the action «Сохранить в Базу знаний» reads the
// pages and their tables as the member sees them, and the action writes the row of a table or the record of a page in
// the transaction of the response, on behalf of the author of the rule (kbRun of api.js, PD-53); cmd/api adapts it to
// forms.Knowledge.

// FormNode is a node for the forms: its title, whether the viewer sees it, whether every active member sees it (the
// confirmation «Понимаю: записи увидят все сотрудники…»), and its tables.
type FormNode struct {
	ID           uuid.UUID
	Title        string
	Visible      bool
	AllEmployees bool
	Tables       []FormTable
}

// FormTable is a table of a page with the ids of its columns.
type FormTable struct {
	ID      uuid.UUID
	Title   string
	Columns []uuid.UUID
}

// FormRecord is a row (Table set) or a record of a page written for a response of a form.
type FormRecord struct {
	Author      uuid.UUID
	AuthorOwner bool
	AuthorName  string
	Node        uuid.UUID
	Table       uuid.UUID // uuid.Nil — a record on the page
	Bottom      bool      // «В конец»: added before the oldest row or record
	Head        string
	Lines       []FormLine
	Cells       map[uuid.UUID]string
	Form        uuid.UUID
	Response    string // R-0988
	Version     int
	At          time.Time
}

// FormLine is a line of a record.
type FormLine struct{ Name, Value string }

// FormWriteResult is the text of the journal of the response or the cause of a refusal.
type FormWriteResult struct {
	Text, Refused string
}

// FormNodes are the nodes ids (not archived) as the member viewer (owner — the owner of the business) sees them; a
// missing or archived one is absent.
func (s *Service) FormNodes(ctx context.Context, tx pgx.Tx, tenant, viewer uuid.UUID, owner bool, ids []uuid.UUID) (map[uuid.UUID]FormNode, error) {
	out := map[uuid.UUID]FormNode{}
	if len(ids) == 0 {
		return out, nil
	}
	w, err := load(ctx, tx, tenant, s.now(), s.Memberships, s.Relations)
	if err != nil {
		return nil, err
	}
	me := w.actor(tenantctx.TenantContext{TenantID: tenant, PersonID: viewer, Owner: owner})
	for _, id := range ids {
		n := w.nodeOf(id)
		if n == nil || n.archived {
			continue
		}
		out[id] = FormNode{ID: n.id, Title: n.title, Visible: w.access(me, n).view, AllEmployees: w.everyone(n, me),
			Tables: w.formTables(n.id)}
	}
	return out, nil
}

// everyone reports whether every active member (the viewer among them) sees n.
func (w *world) everyone(n *node, viewer *member) bool {
	for _, m := range w.members {
		if (m.status == memberActive || m == viewer) && !w.access(m, n).view {
			return false
		}
	}
	return true
}

// formTables are the tables of the node id with their columns.
func (w *world) formTables(id uuid.UUID) []FormTable {
	out := []FormTable{}
	for _, t := range w.tables {
		if t.node != id {
			continue
		}
		ft := FormTable{ID: t.id, Title: t.title, Columns: make([]uuid.UUID, 0, len(t.columns))}
		for _, c := range t.columns {
			ft.Columns = append(ft.Columns, c.ID)
		}
		out = append(out, ft)
	}
	return out
}

// Refusals of the action «Сохранить в Базу знаний» (kbRun of api.js; «недоступна автору правила» — no-reference).
const (
	textFormPageGone = "страница удалена из Базы знаний"
)

// FormWrite writes rec in tx of the tenant on behalf of its author: the page must be there and seen by him with the
// right «Создавать» (or «Править»); a row keeps the cells of the columns the table still has. A refusal is
// FormWriteResult.Refused, not an error.
func (s *Service) FormWrite(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, rec FormRecord) (FormWriteResult, error) {
	w, err := load(ctx, tx, tenant, s.now(), s.Memberships, s.Relations)
	if err != nil {
		return FormWriteResult{}, err
	}
	n := w.nodeOf(rec.Node)
	if n == nil || n.archived {
		return FormWriteResult{Refused: textFormPageGone}, nil
	}
	if why := w.formRefusal(rec, n); why != "" {
		return FormWriteResult{Refused: why}, nil
	}
	wr := writer{ex: func(ctx context.Context, sql string, args ...any) error {
		_, err := tx.Exec(ctx, sql, args...)
		return err
	}}
	if rec.Table == uuid.Nil {
		return FormWriteResult{Text: "Запись на странице «" + n.title + "»"}, wr.formRecord(ctx, w, rec)
	}
	var t *table
	for _, x := range w.tables {
		if x.id == rec.Table && x.node == n.id {
			t = x
		}
	}
	if t == nil {
		return FormWriteResult{Refused: "таблица удалена со страницы «" + n.title + "»"}, nil
	}
	return FormWriteResult{Text: "Строка в таблице «" + t.title + "» · страница «" + n.title + "»"}, wr.formRow(ctx, t, rec)
}

// formRefusal is the cause the author of rec may not write on n ("" — he may): an active member who sees the page
// with «Создавать» or «Править».
func (w *world) formRefusal(rec FormRecord, n *node) string {
	m := w.member[rec.Author]
	if m == nil || m.status != memberActive {
		return "у автора правила " + rec.AuthorName + " нет права «Создавать» в Базе знаний"
	}
	m.owner = m.owner || rec.AuthorOwner
	a := w.access(m, n)
	switch {
	case !a.view:
		return "страница «" + n.title + "» недоступна автору правила " + rec.AuthorName
	case !a.create && !a.edit:
		return "у автора правила " + rec.AuthorName + " нет права «Создавать» в Базе знаний"
	}
	return ""
}

// FormPurge deletes in tx the rows of tables and the records of pages written for the responses numbers («R-0988»)
// of form — «Хранить ответы» of the forms deletes them with the responses (Q-W4.00-forms-22, D-26) — and returns how
// many.
func (*Service) FormPurge(ctx context.Context, tx pgx.Tx, form uuid.UUID, numbers []string) (int, error) {
	if len(numbers) == 0 {
		return 0, nil
	}
	n := 0
	for _, q := range []string{
		`delete from kb.table_rows where form_id = $1 and response_number = any($2)`,
		`delete from kb.entries where form_id = $1 and response_number = any($2)`,
	} {
		tag, err := tx.Exec(ctx, q, form, numbers)
		if err != nil {
			return 0, fmt.Errorf("knowledge: purge of the rows of a form: %w", err)
		}
		n += int(tag.RowsAffected())
	}
	return n, nil
}

// formAt is the moment of a row or a record: now at the top, before the oldest one (oldest — zero: none) at the end.
func formAt(rec FormRecord, oldest time.Time) time.Time {
	if !rec.Bottom || oldest.IsZero() || oldest.After(rec.At) {
		return rec.At
	}
	return oldest.Add(-time.Millisecond)
}

// formRow writes the row of rec into t.
func (wr writer) formRow(ctx context.Context, t *table, rec FormRecord) error {
	cells := map[string]string{}
	for _, c := range t.columns {
		if v, ok := rec.Cells[c.ID]; ok {
			cells[c.ID.String()] = v
		}
	}
	raw, err := json.Marshal(cells)
	if err != nil {
		return err
	}
	var oldest time.Time
	if len(t.rows) > 0 {
		oldest = t.rows[len(t.rows)-1].at
	}
	return wr.exec(ctx, "form row", `insert into kb.table_rows (id, table_id, added_at, cells, form_id, response_number,
		form_version) values ($1, $2, $3, $4::jsonb, $5, $6, $7)`, uuid.New(), t.id, formAt(rec, oldest), string(raw), rec.Form,
		rec.Response, rec.Version)
}

// formRecord writes the record of rec on its page.
func (wr writer) formRecord(ctx context.Context, w *world, rec FormRecord) error {
	lines := make([]line, 0, len(rec.Lines))
	for _, l := range rec.Lines {
		lines = append(lines, line(l))
	}
	raw, err := json.Marshal(lines)
	if err != nil {
		return err
	}
	var oldest time.Time
	for _, x := range w.records {
		if x.node == rec.Node {
			oldest = x.at // newest first: the last one is the oldest
		}
	}
	head := []rune(rec.Head)
	if len(head) > 200 {
		head = head[:200]
	}
	if len(head) == 0 {
		head = []rune(rec.Response)
	}
	if err := wr.exec(ctx, "form record", `insert into kb.entries (id, node_id, added_at, head, lines, form_id, response_number,
		form_version) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`, uuid.New(), rec.Node, formAt(rec, oldest), string(head),
		string(raw), rec.Form, rec.Response, rec.Version); err != nil {
		return fmt.Errorf("knowledge: %w", err)
	}
	return nil
}
