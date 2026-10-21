package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
)

// Tasks part of the seed (W4.11, S4-01…S4-09): the projects and the tasks of tasksSeed of the domain (mock-data.js
// 14.10:75–79, 276–287) with the stage normProjects (api.js:23–36) as MSW seedTasks writes them (W4.03), with the ids of
// PD-30 — the mock and the stand show the same rows.
//
//   - «Альта»: «Логистика · Север» (LOG, «С согласованием», ограниченный, руководитель — Марина Котова) with T-61,
//     T-58, T-63, T-64 and the demo T-66 «Подготовить парк к зиме» with its subtasks T-65 (ждёт согласования, счёт во
//     вложении) and T-58; the rules ar-1, ar-2 and two runs of ar-1; the funnel «Заявки · Ремонт» (ЗАЯ) with L-31…L-18.
//   - «Лотос»: «Салон · Тверская» (SPA) with T-7 and T-8 and v1 of the statuses of its tasks (TP-06).
//
// The roles in «Логистика · Север» are the assignments ap1…ap3 of access.go. The prototype lives on 01.10.2026: the
// dates «ДД.ММ» are the end of that day in Moscow, the times of the comments are of 01.10.

// Tasks of the seed: their projects, statuses, people (names of the members), dates and links.
type (
	seedProject struct {
		proto, key, name, unit, owner, workflow string // owner — the member proto; workflow — tasks.Seed*
		rules                                   []seedRule
		runs                                    []seedRun
	}
	seedTask struct {
		key, project, title, description, status, priority, due, assignee, author, parent string
		labels                                                                            []string
		checklist                                                                         []seedCheck
		comments                                                                          []seedComment
		files                                                                             []seedFile
	}
	seedCheck struct {
		text string
		done bool
	}
	seedComment struct{ by, at, text string } // by — the member proto
	seedFile    struct {
		proto, name, contentType, by, at string
		size                             int64
	}
	seedRule struct {
		proto, name, trigger, to, cond, action, value, author string
		enabled                                               bool
	}
	seedRun   struct{ at, rule, result, text, task string }
	tasksData struct {
		projects []seedProject
		tasks    []seedTask
	}
)

// Members of the prototype the tasks name.
const (
	kotova     = "m-kotova"
	zimina     = "m-owner" // «Дарья Зимина», the owner of «Альта»
	sokolov    = "m-sokolov"
	belova     = "m-owner" // «Ирина Белова», the owner of «Лотос»
	stNew      = "Новая"
	stProgress = "В работе"
	stReview   = "На проверке"
	prioHigh   = "high"
	projLeads  = "leads"
	ruleAR1    = "ar-1"
	nameAR1    = "Срочная задача → назначить руководителю проекта"
	t65        = "T-65"
	t66        = "T-66"
	projSalon  = "salon"
	salonTver  = "f-lotos-tver" // «Лотос · Тверская»
)

// tasksSeeds are the projects and the tasks of the tenants.
var tasksSeeds = map[string]tasksData{
	protoAlta: {
		projects: []seedProject{
			{proto: projectFleet, key: "LOG", name: "Логистика · Север", unit: homeAlta, owner: kotova, workflow: tasks.SeedApproval,
				rules: []seedRule{
					{ruleAR1, nameAR1, "created", "", "urgent", "assign", kotova, kotova, true},
					{"ar-2", "Задача готова → напомнить про путевой лист", "status_entered", "s4", "", "comment",
						"Проверьте, что путевой лист сдан в бухгалтерию", zimina, false},
				},
				runs: []seedRun{
					{"09:12", ruleAR1, "ok", "T-64 назначена: Марина Котова", "T-64"},
					{"08:40", ruleAR1, "stopped", "T-63: приоритет «Обычный» — условие не выполнено", "T-63"},
				}},
			{proto: projLeads, key: "ЗАЯ", name: "Заявки · Ремонт", unit: homeAlta, owner: zimina, workflow: tasks.SeedLeads},
		},
		tasks: []seedTask{
			{key: t66, project: projectFleet, title: "Подготовить парк к зиме",
				description: "Шины, антифриз и проверка аккумуляторов по всем машинам фирмы «Север» до 15.10.",
				status:      stProgress, priority: prioHigh, due: "15.10", assignee: kotova, author: kotova, labels: []string{"зима"},
				comments: []seedComment{{kotova, "09:30", "Собрала в одну задачу всё, что нужно сделать до холодов"}}},
			{key: t65, project: projectFleet, title: "Заменить шины на ГАЗон Next (зимние)",
				description: "Комплект зимних шин 215/75 R17.5, 6 шт., с шиномонтажом.\nСезонная замена до 15.10. Счёт поставщика во вложении.",
				status:      stReview, priority: prioHigh, due: "10.10", assignee: vasiliev, author: vasiliev, parent: t66,
				labels:    []string{"шины", "закупка"},
				checklist: []seedCheck{{"Счёт приложен", true}, {"Сезонность подтверждена", true}},
				comments:  []seedComment{{vasiliev, "10:42", "Сумма 48 600 ₽, счёт во вложении. Прошу согласовать."}},
				files:     []seedFile{{"f-1", "Счёт № 418 от 07.10.pdf", "application/pdf", vasiliev, "10:41", 184320}}},
			{key: "T-61", project: projectFleet, title: "Проверить осмотр Р-196", status: "Готово", due: "27.09", assignee: kotova,
				checklist: []seedCheck{{"Сверить фото с прошлым осмотром", true}, {"Проверить пробег", true}},
				comments:  []seedComment{{kotova, "27.09 10:12", "Замечаний нет."}}},
			{key: "T-58", project: projectFleet, title: "Записать ГАЗон Next на плановое ТО", status: stProgress, priority: prioHigh,
				due: "02.10", assignee: kotova, parent: t66,
				checklist: []seedCheck{{"Согласовать дату с сервисом", true}, {"Перенести рейсы на другие машины", false},
					{"Отметить недоступность в календаре", false}}},
			{key: "T-63", project: projectFleet, title: "Обновить регламент приёмки смены", status: stReview, due: "03.10", assignee: zimina,
				checklist: []seedCheck{{"Добавить фото одометра", true}},
				comments:  []seedComment{{zimina, "30.09 17:40", "Передаю на проверку Марине."}}},
			{key: "L-31", project: projLeads, title: "Квартира 64 м², Химки", status: stNew, priority: prioHigh, due: "03.10", assignee: zimina,
				checklist: []seedCheck{{"Перезвонить и назначить замер", false}}},
			{key: "L-29", project: projLeads, title: "Дом 120 м², Истра", status: "Замер", due: "22.10", assignee: sokolov,
				checklist: []seedCheck{{"Замер 22.10 в 11:00", false}}},
			{key: "L-27", project: projLeads, title: "Квартира 51 м², Люберцы", status: "Смета", due: "10.10", assignee: zimina},
			{key: "L-24", project: projLeads, title: "Офис 90 м², Сокол", status: "Договор", priority: prioHigh, due: "05.10", assignee: zimina},
			{key: "L-18", project: projLeads, title: "ЖК Речной · квартира 42", status: "Объект", due: "01.10", assignee: sokolov},
			{key: "T-64", project: projectFleet, title: "Найти водителя на рейс Р-211", status: stNew, priority: "urgent", due: "01.10",
				assignee: kotova},
		},
	},
	protoLotos: {
		projects: []seedProject{
			{proto: projSalon, key: "SPA", name: "Салон · Тверская", unit: salonTver, owner: belova, workflow: tasks.SeedInitial},
		},
		tasks: []seedTask{
			{key: "T-7", project: projSalon, title: "Заказать масло для массажа", status: stProgress, due: "03.10", assignee: belova},
			{key: "T-8", project: projSalon, title: "График мастеров на ноябрь", status: stNew, priority: prioHigh, due: "10.10",
				assignee: belova},
		},
	},
}

// seedPublished is the moment of v1 and of the rows of the seed (MSW SEED_PUBLISHED, SEED_CREATED).
var seedPublished = time.Date(2026, 9, 1, 6, 0, 0, 0, time.UTC)

var digits = regexp.MustCompile(`\d+$`)

// dueOf is «ДД.ММ» of the prototype → the end of that day in Moscow (MSW dueOf); "" → nil.
func dueOf(due string) *time.Time {
	if due == "" {
		return nil
	}
	t := protoTime(due + " 00:00")
	end := t.AddDate(0, 0, 1)
	return &end
}

// stampOf is the time of a comment of the prototype: «27.09 10:12» or «09:30» (01.10, MSW stampOf).
func stampOf(at string) time.Time {
	if !strings.Contains(at, ".") {
		at = "01.10 " + at
	}
	return *protoTime(at)
}

// writeTasks writes the projects, their v1, the tasks with their history and attachments (their bytes go to objs),
// the rules and the runs of td; a second run changes nothing.
func writeTasks(ctx context.Context, tx *sql.Tx, td tenantData, objs objectStore) error {
	d, ok := tasksSeeds[td.tenant.proto]
	if !ok {
		return nil
	}
	id := func(proto string) uuid.UUID { return seedID(td.tenant.proto, proto) }
	wfs := map[string]tasks.SeedWorkflow{}
	for _, p := range d.projects {
		var used []string
		for _, t := range d.tasks {
			if t.project == p.proto {
				used = append(used, t.status)
			}
		}
		wf, err := tasks.SeedWorkflowOf(p.workflow, used)
		if err != nil {
			return err
		}
		wfs[p.proto] = wf
		if err := writeSeedProject(ctx, tx, id, p, wf); err != nil {
			return err
		}
	}
	for _, t := range d.tasks { // parents first: T-66 leads the list
		if err := writeSeedTask(ctx, tx, seedFiles{td, objs}, id, t, wfs[t.project]); err != nil {
			return err
		}
	}
	for _, p := range d.projects {
		if err := writeSeedRules(ctx, tx, id, p); err != nil {
			return err
		}
	}
	return nil
}

func writeSeedProject(ctx context.Context, tx *sql.Tx, id func(string) uuid.UUID, p seedProject, wf tasks.SeedWorkflow) error {
	var access, current any = "limited", 1
	flow := "tasks"
	if p.workflow == tasks.SeedLeads {
		access, current, flow = nil, nil, "leads"
	}
	if _, err := tx.ExecContext(ctx, `insert into tasks.projects (id, key, name, org_unit_id, access, flow, workflow_key, owner_id,
		current_version, workflow_revision, task_seq, revision, created_at, updated_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 100, 1, $10, $10) on conflict (id) do nothing`,
		id(p.proto), p.key, p.name, id(p.unit), access, flow, p.workflow, id(p.owner), current, seedPublished); err != nil {
		return fmt.Errorf("project %s: %w", p.proto, err)
	}
	if wf.Statuses == nil {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `insert into tasks.workflow_versions (project_id, version, statuses, transitions, published_at,
		published_by) values ($1, 1, $2, $3, $4, $5) on conflict do nothing`,
		id(p.proto), string(wf.Statuses), string(wf.Transitions), seedPublished, id(p.owner)); err != nil {
		return fmt.Errorf("workflow of %s: %w", p.proto, err)
	}
	return nil
}

type checkItem struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	Done bool   `json:"done"`
}

// seedFiles is where the attachments of the seed go: the tenant (the key of an object) and the object storage.
type seedFiles struct {
	td   tenantData
	objs objectStore
}

func writeSeedTask(ctx context.Context, tx *sql.Tx, fs seedFiles, id func(string) uuid.UUID, t seedTask, wf tasks.SeedWorkflow) error {
	number, err := strconv.Atoi(digits.FindString(t.key))
	if err != nil {
		return fmt.Errorf("task %s: number: %w", t.key, err)
	}
	checklist, err := checklistJSON(t.checklist)
	if err != nil {
		return err
	}
	var version, author, parent any
	if wf.Statuses != nil {
		version = 1
	}
	if t.author != "" {
		author = id(t.author)
	}
	if t.parent != "" {
		parent = id(t.parent)
	}
	prio := t.priority
	if prio == "" {
		prio = "normal"
	}
	labels := t.labels
	if labels == nil {
		labels = []string{}
	}
	if _, err := tx.ExecContext(ctx, `insert into tasks.tasks (id, project_id, number, legacy_key, title, description, status_id,
		workflow_version, priority, labels, assignee_id, author_id, due_at, parent_task_id, checklist, created_at, updated_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16) on conflict (id) do nothing`,
		id(t.key), id(t.project), number, t.key, t.title, t.description, wf.StatusID(t.status), version, prio, labels,
		id(t.assignee), author, dueOf(t.due), parent, checklist, seedPublished); err != nil {
		return fmt.Errorf("task %s: %w", t.key, err)
	}
	if err := writeSeedComments(ctx, tx, id, t); err != nil {
		return err
	}
	for _, f := range t.files {
		if err := writeSeedFile(ctx, tx, fs, id, t, f); err != nil {
			return err
		}
	}
	return nil
}

// checklistJSON is the checklist of the contract: the items «ch-1»… of the prototype.
func checklistJSON(checks []seedCheck) (string, error) {
	items := make([]checkItem, 0, len(checks))
	for i, c := range checks {
		items = append(items, checkItem{ID: "ch-" + strconv.Itoa(i+1), Text: c.text, Done: c.done})
	}
	b, err := json.Marshal(items)
	return string(b), err
}

// writeSeedComments writes the comments of t into its history.
func writeSeedComments(ctx context.Context, tx *sql.Tx, id func(string) uuid.UUID, t seedTask) error {
	for i, c := range t.comments {
		if _, err := tx.ExecContext(ctx, `insert into tasks.task_events (id, task_id, at, kind, actor_id, text)
			values ($1, $2, $3, 'comment', $4, $5) on conflict (id) do nothing`,
			id(fmt.Sprintf("hist:%s:%d", t.key, i+1)), id(t.key), stampOf(c.at), id(c.by), c.text); err != nil {
			return fmt.Errorf("comment of %s: %w", t.key, err)
		}
	}
	return nil
}

// writeSeedFile writes an attachment of the seed (W4.11 возврат 1): its bytes — a PDF of the size of the prototype —
// into the object storage under the key of the file, then the checked file of core.files (purpose task_attachment,
// parent tasks/task) with their real checksum, its completed upload, its commit in the quota and the link of the task.
// Without an object storage nothing is attached: a row whose object is missing could not be downloaded. A row of an
// earlier seed (the checksum 'a' × 64 of MSW) takes the checksum of the bytes now in the storage.
func writeSeedFile(ctx context.Context, tx *sql.Tx, fs seedFiles, id func(string) uuid.UUID, t seedTask, f seedFile) error {
	if fs.objs == nil {
		return nil
	}
	file, at := id("file:"+t.key+":"+f.proto), stampOf(f.at)
	key := files.FileKey(fs.td.tenant.id(), file)
	data := seedPDF("Ortus demo: attachment "+f.proto+" of "+t.key, int(f.size))
	sum := sha256.Sum256(data)
	if err := fs.objs.Put(ctx, key, f.contentType, data); err != nil {
		return fmt.Errorf("attachment of %s: %w", t.key, err)
	}
	res, err := tx.ExecContext(ctx, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime,
		detected_mime, bytes, sha256, uploaded_by, created_at, ready_at) values ($1, $2, 'ready', $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
		on conflict (id) do nothing`, file, key, tasks.FilePurpose, tasks.FileModule+"."+tasks.FileEntity,
		id(t.key), files.EncodeMIME(f.contentType, f.name), f.contentType, len(data), sum[:], id(f.by), at)
	if err != nil {
		return fmt.Errorf("file of %s: %w", t.key, err)
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 { // written by an earlier run
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `update files.objects set sha256 = $2 where id = $1 and sha256 <> $2`, file, sum[:])
		return err
	}
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into files.upload_sessions (id, file_id, actor_id, state, reserved_bytes, ticket_expires_at, session_expires_at,
			created_at, completed_at) values ($1, $2, $3, 'completed', 0, $4, $4, $4, $4)`, []any{id("upload:" + file.String()), file, id(f.by), at}},
		{`insert into files.quota_ledger (file_id, kind, bytes) values ($1, 'commit', $2)`, []any{file, f.size}},
		// A fresh tenant DB has no row of usage yet (the files module creates it on the first upload, as here).
		{`insert into files.usage (limit_bytes) values ($1) on conflict (singleton) do nothing`, []any{files.DefaultQuotaBytes}},
		{`update files.usage set committed_bytes = committed_bytes + $1, updated_at = now() where singleton`, []any{f.size}},
		{`insert into tasks.task_files (task_id, file_id, attached_by, attached_at) values ($1, $2, $3, $4)`, []any{id(t.key), file, id(f.by), at}},
	} {
		if _, err := tx.ExecContext(ctx, q.sql, q.args...); err != nil {
			return fmt.Errorf("attachment of %s: %w", t.key, err)
		}
	}
	return nil
}

func writeSeedRules(ctx context.Context, tx *sql.Tx, id func(string) uuid.UUID, p seedProject) error {
	for _, r := range p.rules {
		var to, cond, member, text any
		if r.to != "" {
			to = r.to
		}
		if r.cond != "" {
			cond = r.cond
		}
		if r.action == "assign" {
			member = id(r.value)
		} else {
			text = r.value
		}
		runs := 0
		for _, x := range p.runs {
			if x.rule == r.proto {
				runs++
			}
		}
		if _, err := tx.ExecContext(ctx, `insert into tasks.automations (id, project_id, name, trigger_kind, trigger_status_id,
			condition_priority, action_kind, action_member_id, action_text, enabled, version, author_id, run_count, created_at, updated_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $12, $13, $13) on conflict (id) do nothing`,
			id(r.proto), id(p.proto), r.name, r.trigger, to, cond, r.action, member, text, r.enabled, id(r.author), runs, seedPublished); err != nil {
			return fmt.Errorf("rule %s: %w", r.proto, err)
		}
	}
	for i, x := range p.runs {
		name := ""
		for _, r := range p.rules {
			if r.proto == x.rule {
				name = r.name
			}
		}
		if _, err := tx.ExecContext(ctx, `insert into tasks.automation_runs (id, project_id, automation_id, automation_name,
			automation_version, result, text, task_id, at) values ($1, $2, $3, $4, 1, $5, $6, $7, $8) on conflict (id) do nothing`,
			id(fmt.Sprintf("run:%s:%d", p.proto, i+1)), id(p.proto), id(x.rule), name, x.result, x.text, id(x.task), stampOf(x.at)); err != nil {
			return fmt.Errorf("run of %s: %w", x.rule, err)
		}
	}
	return nil
}
