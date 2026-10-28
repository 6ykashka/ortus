package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

// Keys the seed of the documents repeats.
const (
	fdLog      = "fd-log"
	fdLogOrd   = "fd-log-ord"
	fdLogCtr   = "fd-log-ctr"
	fdLogFin   = "fd-log-fin"
	fdRep      = "fd-rep"
	fdO42      = "fd-o42"
	srcOwner   = "owner"
	keyDays    = "days"
	docDraft   = "draft"
	docNormal  = "normal"
	docInherit = "inherit"
	keyKind    = "kind"
)

// docsExec runs one statement of the seed of the documents.
type docsExec func(ctx context.Context, q string, args ...any) error

// writeDocs writes the documents of the demo of «Альта» (W7.23; the seed of the prototype documents.js altaDocs): the
// folders of «Север Логистик» and of the object, the three templates, the route templates of the folders, six
// documents with their versions, the comment with a mention, the doubtful words of a scan and its jobs. The files of
// the bodies are the files of the engine: the demo documents have none (the viewer shows the card). The rows already
// there are kept (a second run changes nothing). Other tenants have no documents.
func writeDocs(ctx context.Context, tx *sql.Tx, td tenantData) error {
	return writeDocsWith(ctx, func(ctx context.Context, q string, args ...any) error {
		_, err := tx.ExecContext(ctx, q, args...)
		return err
	}, td)
}

func jsonOf(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // the seed is code: a value that does not marshal is a programming error
	}
	return string(b)
}

// writeDocsWith writes the documents of td through ex.
func writeDocsWith(ctx context.Context, ex docsExec, td tenantData) error {
	if td.tenant.proto != protoAlta {
		return nil
	}
	id := func(proto string) uuid.UUID { return seedID(td.tenant.proto, proto) }
	steps := []func(context.Context, docsExec, func(string) uuid.UUID, tenantData) error{docsFolders, docsTemplates, docsDocuments, docsExtras, docsRoute}
	for _, step := range steps {
		if err := step(ctx, ex, id, td); err != nil {
			return err
		}
	}
	return nil
}

func docsFolders(ctx context.Context, ex docsExec, id func(string) uuid.UUID, td tenantData) error {
	type folder struct {
		proto, name, parent, unit, owner, icon, mode, sens, link string
	}
	for _, f := range []folder{
		{fdLog, "Север Логистик", "", "f-msk-sever", memberKotova, "local_shipping", docInherit, docNormal, ""},
		{fdLogOrd, "Приказы", fdLog, "", memberKotova, "gavel", docInherit, docNormal, ""},
		{fdLogCtr, "Договоры", fdLog, "", memberOwner, "handshake", docInherit, docNormal, ""},
		{fdLogFin, "Финансы", fdLog, "", memberOwner, "payments", "listed", "finance", ""},
		{fdRep, "Ремонт и стройка", "", "", memberOwner, "construction", docInherit, docNormal, ""},
		{fdO42, "ЖК Речной · квартира 42", fdRep, "", memberOwner, "home_work", docInherit, docNormal, "obj-42"},
	} {
		var parent, unit, link any
		if f.parent != "" {
			parent = id(f.parent)
		}
		if f.unit != "" {
			unit = td.unitID(f.unit)
		}
		if f.link != "" {
			link = jsonOf(map[string]any{"moduleKey": "repairs", "entityType": "object", "entityId": id(f.link)})
		}
		if err := ex(ctx, `insert into docs.folders (id, name, parent_id, org_unit_id, mode, owner_id, icon, sensitivity, link_ref)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) on conflict (id) do nothing`,
			id(f.proto), f.name, parent, unit, f.mode, id(f.owner), f.icon, f.sens, link); err != nil {
			return fmt.Errorf("docs folder %s: %w", f.proto, err)
		}
	}
	// the lists: the dispatchers edit «Север Логистик», the finance folder is Марина Котова's, the foreman edits the object
	for _, s := range []struct {
		folder, who, ref, level string
		obj                     bool
	}{
		{fdLog, "group", "g-disp", "edit", false}, {fdLogFin, "member", memberKotova, "edit", false}, {fdO42, "relation", "obj-42", "edit", true},
	} {
		var ref, object any
		if s.obj {
			object = jsonOf(map[string]any{"moduleKey": "repairs", "entityType": "object", "entityId": id(s.ref)})
		} else {
			ref = id(s.ref)
		}
		if err := ex(ctx, `insert into docs.shares (id, folder_id, who, ref_id, object_ref, level, by_id)
			values ($1, $2, $3, $4, $5::jsonb, $6, $7) on conflict (id) do nothing`,
			id("share-"+s.folder+"-"+s.who), id(s.folder), s.who, ref, object, s.level, id(memberOwner)); err != nil {
			return fmt.Errorf("docs share %s: %w", s.folder, err)
		}
	}
	return nil
}

func docsTemplates(ctx context.Context, ex docsExec, id func(string) uuid.UUID, _ tenantData) error {
	type field struct {
		Key string `json:"key"`
		Src string `json:"src"`
	}
	for _, t := range []struct {
		proto, name, icon, hint, link, folder string
		fields                                []field
	}{
		{"tpl-order", "Приказ по фирме", "gavel", "Номер, тема, пункты. Маршрут папки «Приказы»: согласовать → утвердить → ознакомить", "", fdLogOrd,
			[]field{{"Фирма", "unit"}}},
		{"tpl-poa", "Доверенность на получение груза", "badge", "Поля из рейса: водитель, машина, рейс", "trip", fdLog,
			[]field{{"Организация", "tenant"}, {nameDriver, "trip.driverName"}, {"Машина", "trip.vehicle"}, {"Рейс", "trip.ref"},
				{"Дата рейса", "trip.date"}, {"Руководитель", srcOwner}}},
		{"tpl-act", "Акт скрытых работ", "construction", "Поля из объекта: адрес, заказчик, прораб", "object", fdO42,
			[]field{{"Объект", "obj.name"}, {"Адрес объекта", "obj.address"}, {"Заказчик", "obj.client"}, {"Прораб", "obj.foreman"}}},
	} {
		var link any
		if t.link != "" {
			link = t.link
		}
		if err := ex(ctx, `insert into docs.templates (id, name, kind, icon, hint, link, folder_id, fields)
			values ($1, $2, 'text', $3, $4, $5, $6, $7::jsonb) on conflict (id) do nothing`,
			id(t.proto), t.name, t.icon, t.hint, link, id(t.folder), jsonOf(t.fields)); err != nil {
			return fmt.Errorf("docs template %s: %w", t.proto, err)
		}
	}
	rules := map[string]bool{"lock": true, "notAuthor": true, "commentOnBack": true, "escalate": false}
	for _, r := range []struct {
		folder, name string
		steps        []map[string]any
	}{
		{fdLogOrd, "Приказ по фирме", []map[string]any{
			{keyKind: "approve", "mode": "all", keyDays: 2, "whoMemberIds": []uuid.UUID{id("m-kotelnikova"), id("m-ilyin")}},
			{keyKind: "sign", keyDays: 1, "whoMemberIds": []uuid.UUID{id(memberOwner)}},
			{keyKind: "ack", keyDays: 3, "audience": []map[string]any{{"who": "group", "refId": id("g-disp"), "level": "view"}}}}},
		{fdO42, "Договор с заказчиком", []map[string]any{
			{keyKind: "approve", "mode": "all", keyDays: 1, "whoMemberIds": []uuid.UUID{id(sokolov)}}, {keyKind: "external", keyDays: 3}}},
	} {
		if err := ex(ctx, `insert into docs.route_templates (id, folder_id, name, steps, rules) values ($1, $2, $3, $4::jsonb, $5::jsonb)
			on conflict (id) do nothing`, id("rt-"+r.folder), id(r.folder), r.name, jsonOf(r.steps), jsonOf(rules)); err != nil {
			return fmt.Errorf("docs route template %s: %w", r.folder, err)
		}
	}
	return nil
}

func docsDocuments(ctx context.Context, ex docsExec, id func(string) uuid.UUID, _ tenantData) error {
	type version struct {
		n       int
		name    string
		authors []string
	}
	for _, d := range []struct {
		proto, kind, title, folder, owner, status, sens string
		current                                         int
		scan                                            bool
		versions                                        []version
	}{
		{"doc-42", "text", "Договор подряда № 42/26", fdO42, memberOwner, docDraft, docNormal, 12, false,
			[]version{{9, "", []string{memberOwner}}, {10, "", []string{sokolov, memberOwner}}, {11, "Перед согласованием", []string{memberOwner}}, {12, "", []string{sokolov}}}},
		{"doc-fuel", "sheet", "Расход топлива · октябрь", fdLog, memberKotova, docDraft, docNormal, 4, false,
			[]version{{3, "", []string{memberKotova}}, {4, "Обновление из CRM", []string{memberKotova}}}},
		{"doc-318", "pdf", "Накладная № 318 · скан", fdO42, sokolov, docDraft, docNormal, 1, true, []version{{1, "", []string{sokolov}}}},
		{"doc-ord14", "text", "Приказ № 14 · О работе 4 ноября", fdLogOrd, memberKotova, docDraft, docNormal, 6, false,
			[]version{{5, "", []string{memberKotova}}, {6, "", []string{memberKotova}}}},
		{"doc-lease", "pdf", "Договор аренды стоянки", fdLogCtr, memberOwner, "signed", docNormal, 3, false, []version{{3, "На согласование", []string{memberKotova}}}},
		{"doc-pay", "sheet", "Начисления водителям · сентябрь", fdLogFin, memberOwner, docDraft, "finance", 2, false, []version{{2, "", []string{memberOwner}}}},
	} {
		ocr := any(nil)
		if d.scan {
			ocr = jsonOf(map[string]any{"status": "done", "confidence": 0.97, "doubtful": 3, "lang": "rus+eng"})
		}
		if err := ex(ctx, `insert into docs.documents (id, kind, title, folder_id, owner_id, status, sensitivity, current_version, scan, ocr,
			archived_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, null) on conflict (id) do nothing`,
			id(d.proto), d.kind, d.title, id(d.folder), id(d.owner), d.status, d.sens, d.current, d.scan, ocr); err != nil {
			return fmt.Errorf("docs document %s: %w", d.proto, err)
		}
		for _, v := range d.versions {
			authors := make([]uuid.UUID, 0, len(v.authors))
			for _, a := range v.authors {
				authors = append(authors, id(a))
			}
			var name any
			if v.name != "" {
				name = v.name
			}
			if err := ex(ctx, `insert into docs.versions (document_id, number, source, name, authors) values ($1, $2, 'edit', $3, $4)
				on conflict (document_id, number) do nothing`, id(d.proto), v.n, name, authors); err != nil {
				return fmt.Errorf("docs version %s v%d: %w", d.proto, v.n, err)
			}
		}
	}
	return nil
}

func docsExtras(ctx context.Context, ex docsExec, id func(string) uuid.UUID, _ tenantData) error {
	anchor := jsonOf(map[string]string{keyKind: "block", "ref": "b-32", "quote": "Аванс и оплата этапов"})
	if err := ex(ctx, `insert into docs.comments (id, document_id, author_id, text, anchor, mention) values ($1, $2, $3, $4, $5::jsonb, $6)
		on conflict (id) do nothing`, id("c-1"), id("doc-42"), id(memberOwner),
		"Сергей Ильин, аванс 30 % проводим через кассу или по счёту?", anchor, []uuid.UUID{id("m-ilyin")}); err != nil {
		return fmt.Errorf("docs comment: %w", err)
	}
	for _, w := range []struct {
		proto, text, sug, why string
		conf                  float64
		row                   int
	}{
		{"w1", "Скпадская", "Складская", "«п» вместо «л» в названии улицы", 0.58, 0},
		{"w2", "ФК 1S мм", "ФК 15 мм", "Латинская «S» вместо цифры 5", 0.64, 2},
		{"w3", "89О,00", "890,00", "Буква «О» вместо нуля. С исправлением сумма строки сходится: 6 × 890 = 5 340", 0.61, 3},
	} {
		if err := ex(ctx, `insert into docs.ocr_words (document_id, id, row_number, text, suggestion, confidence, why)
			values ($1, $2, $3, $4, $5, $6, $7) on conflict (document_id, id) do nothing`,
			id("doc-318"), w.proto, w.row, w.text, w.sug, w.conf, w.why); err != nil {
			return fmt.Errorf("docs ocr word %s: %w", w.proto, err)
		}
	}
	for _, j := range []struct {
		proto, op, name, status, errText string
		progress                         int
	}{
		{"job-1", "ocr", "Распознавание · 2 страницы", "done", "", 100},
		{"job-2", "merge", "Объединение 4 файлов", "failed", "«Счёт 118.pdf» защищён паролем: введите пароль или уберите файл", 0},
	} {
		var errText, finished any
		if j.errText != "" {
			errText = j.errText
		}
		if j.status == "done" || j.status == "failed" {
			finished = "2026-10-01T09:30:00+03:00"
		}
		if err := ex(ctx, `insert into docs.jobs (id, op, doc_ids, name, status, progress, error, created_by, finished_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz) on conflict (id) do nothing`,
			id(j.proto), j.op, []uuid.UUID{id("doc-318")}, j.name, j.status, j.progress, errText, id(sokolov), finished); err != nil {
			return fmt.Errorf("docs job %s: %w", j.proto, err)
		}
	}
	return nil
}

// docsRoute writes the finished route of the lease (the prototype rt-0, documents.js altaDocs): version 3 went to
// Марина Котова for approval and to the owner for the signature by the code of the SMS (D-31: the method is kept in the
// sheet), and was signed.
func docsRoute(ctx context.Context, ex docsExec, id func(string) uuid.UUID, _ tenantData) error {
	const (
		started = "2026-08-31T15:02:00+03:00"
		done    = "2026-09-01T12:10:00+03:00"
	)
	rules := jsonOf(map[string]bool{"lock": true, "notAuthor": true, "commentOnBack": true, "escalate": false})
	if err := ex(ctx, `insert into docs.routes (id, document_id, version, started_by, started_at, status, current_step, rules, finished_at)
		values ($1, $2, 3, $3, $4::timestamptz, 'done', 1, $5::jsonb, $6::timestamptz) on conflict (id) do nothing`,
		id("rt-0"), id("doc-lease"), id(memberKotova), started, rules, done); err != nil {
		return fmt.Errorf("docs route: %w", err)
	}
	for _, s := range []struct {
		pos         int
		kind, name  string
		who         string
		due         string
		decidedAt   string
		method, dec string
	}{
		{0, "approve", "Согласовать", memberKotova, "2026-09-01T12:00:00+03:00", "2026-08-31T16:20:00+03:00", "click", "ok"},
		{1, "sign", "Утвердить", memberOwner, "2026-09-02T12:00:00+03:00", done, "pep_sms", "ok"},
	} {
		if err := ex(ctx, `insert into docs.route_steps (route_id, position, kind, name, mode, who, days, status, due_at)
			values ($1, $2, $3, $4, 'all', $5, 1, 'done', $6::timestamptz) on conflict (route_id, position) do nothing`,
			id("rt-0"), s.pos, s.kind, s.name, []uuid.UUID{id(s.who)}, s.due); err != nil {
			return fmt.Errorf("docs route step %d: %w", s.pos, err)
		}
		if err := ex(ctx, `insert into docs.route_decisions (id, route_id, position, member_id, decision, method, at)
			values ($1, $2, $3, $4, $5, $6, $7::timestamptz) on conflict (id) do nothing`,
			id(fmt.Sprintf("rd-0-%d", s.pos)), id("rt-0"), s.pos, id(s.who), s.dec, s.method, s.decidedAt); err != nil {
			return fmt.Errorf("docs route decision %d: %w", s.pos, err)
		}
	}
	return nil
}
