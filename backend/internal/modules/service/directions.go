package service

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// draftDoc is the document of a draft in service.direction_drafts.body: the body of the contract and the revision of
// the draft (the table has no column for it; the first save after the published version is revision 2, as MSW).
type draftDoc struct {
	api.ServiceDirectionBody
	Rev int64 `json:"_rev"`
}

// ListDirections is listServiceDirections: the directions the actor reads with their types, teams and the right to
// the contacts; an organization without directions is «не настроено».
func (s *Service) ListDirections(ctx context.Context, tc tenantctx.TenantContext) (api.ServiceDirectionList, error) {
	out := api.ServiceDirectionList{Items: []api.ServiceDirection{}, Types: []api.ServiceRequestType{}}
	err := s.run(ctx, tc, func(r *req) error {
		dirs, err := r.visible(ctx, actRead)
		if err != nil {
			return err
		}
		if len(dirs) == 0 {
			var n int
			if err := r.tx.QueryRow(ctx, `select count(*) from service.directions`).Scan(&n); err != nil {
				return store("count directions", err)
			}
			if n == 0 {
				t := true
				out.NotConfigured = &t
			}
			return nil
		}
		names, team, err := r.people(ctx, dirs)
		if err != nil {
			return err
		}
		for i := range dirs {
			c, err := r.mayIn(ctx, actContacts, &dirs[i])
			if err != nil {
				return err
			}
			out.Items = append(out.Items, directionDTO(dirs[i], names, team[dirs[i].ID], c))
		}
		types, err := r.types(ctx, idsOf(dirs))
		if err != nil {
			return err
		}
		for _, t := range types {
			out.Types = append(out.Types, typeDTO(t))
		}
		return nil
	})
	return out, err
}

// people are the names of the leads and the teams of the directions.
func (r *req) people(ctx context.Context, dirs []Direction) (map[uuid.UUID]string, map[uuid.UUID][]uuid.UUID, error) {
	team, err := r.teamOf(ctx, dirs)
	if err != nil {
		return nil, nil, err
	}
	var ids []uuid.UUID
	for _, d := range dirs {
		if d.LeadID != nil {
			ids = append(ids, *d.LeadID)
		}
		ids = append(ids, team[d.ID]...)
	}
	names, err := r.names(ctx, ids)
	return names, team, err
}

// config is the direction with its types and draft for the settings (1d).
func (r *req) config(ctx context.Context, d *Direction) (api.ServiceDirectionConfig, error) {
	names, team, err := r.people(ctx, []Direction{*d})
	if err != nil {
		return api.ServiceDirectionConfig{}, err
	}
	types, err := r.types(ctx, []uuid.UUID{d.ID})
	if err != nil {
		return api.ServiceDirectionConfig{}, err
	}
	out := api.ServiceDirectionConfig{Direction: directionDTO(*d, names, team[d.ID], true), Types: []api.ServiceRequestType{}}
	for _, t := range types {
		out.Types = append(out.Types, typeDTO(t))
	}
	draft, err := r.draft(ctx, d.ID)
	if err != nil {
		return out, err
	}
	if draft != nil {
		out.Draft = draft
	}
	return out, nil
}

// draft is the draft of a direction (nil — none).
func (r *req) draft(ctx context.Context, id uuid.UUID) (*api.ServiceDirectionDraft, error) {
	var (
		body []byte
		doc  draftDoc
		out  api.ServiceDirectionDraft
	)
	err := r.tx.QueryRow(ctx, `select body, saved_at from service.direction_drafts where direction_id = $1`, id).Scan(&body, &out.UpdatedAt)
	switch {
	case noRows(err):
		return nil, nil //nolint:nilnil // no draft is not an error
	case err != nil:
		return nil, store("draft", err)
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, store("draft body", err)
	}
	out.DirectionId, out.Body, out.Revision, out.UpdatedAt = id, doc.ServiceDirectionBody, doc.Rev, out.UpdatedAt.UTC()
	return &out, nil
}

// manageable loads a direction the actor may settle (service.directions.manage): an invisible one is 404.
func (r *req) manageable(ctx context.Context, id uuid.UUID, lock bool) (*Direction, error) {
	d, err := r.direction(ctx, id, lock)
	if err != nil {
		return nil, err
	}
	if d == nil {
		return nil, notFound(textDirectionMissing)
	}
	if err := r.can(ctx, actManage, d); err != nil {
		if problem.Is(err, problem.CodeForbiddenAction) {
			return nil, forbidden("Нет права «Настраивать направления»")
		}
		return nil, err
	}
	return d, nil
}

// GetDirection is getServiceDirection: the direction, its types and the draft.
func (s *Service) GetDirection(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.ServiceDirectionConfig, error) {
	var out api.ServiceDirectionConfig
	err := s.run(ctx, tc, func(r *req) error {
		d, err := r.manageable(ctx, id, false)
		if err != nil {
			return err
		}
		out, err = r.config(ctx, d)
		return err
	})
	return out, err
}

// SaveDraft is updateServiceDirectionDraft: the draft replaces the one before it; If-Match is the revision of the draft.
func (s *Service) SaveDraft(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, body *api.ServiceDirectionDraftSave) (api.ServiceDirectionDraft, error) {
	var out api.ServiceDirectionDraft
	if body == nil {
		return out, problem.New(problem.CodeMalformedRequest, "")
	}
	err := s.run(ctx, tc, func(r *req) error {
		d, err := r.manageable(ctx, id, true)
		if err != nil {
			return err
		}
		cur, err := r.draft(ctx, d.ID)
		if err != nil {
			return err
		}
		rev := int64(1)
		if cur != nil {
			rev = cur.Revision
		}
		if err := checkRevision(ifMatch, rev); err != nil {
			return err
		}
		if err := CheckBody(body.Body); err != nil {
			return err
		}
		doc, err := json.Marshal(draftDoc{ServiceDirectionBody: body.Body, Rev: rev + 1})
		if err != nil {
			return store("draft body", err)
		}
		if _, err := r.tx.Exec(ctx, `insert into service.direction_drafts (direction_id, body, base_version, saved_by, saved_at)
			values ($1, $2, $3, $4, $5)
			on conflict (direction_id) do update set body = excluded.body, base_version = excluded.base_version,
			  saved_by = excluded.saved_by, saved_at = excluded.saved_at`, d.ID, doc, d.Version, nullID(r.tc.PersonID), r.now); err != nil {
			return store("save draft", err)
		}
		if err := r.record(ctx, "service.direction.draft", targetDirection, d.ID, audit.Normal, map[string]any{"revision": rev + 1}); err != nil {
			return err
		}
		out = api.ServiceDirectionDraft{DirectionId: d.ID, Body: body.Body, Revision: rev + 1, UpdatedAt: r.now}
		return complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

func nullID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

// Publish is publishServiceDirection: the draft becomes the next version. The open requests keep their terms; the
// types the requests refer to stay.
func (s *Service) Publish(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.ServiceDirectionConfig, error) {
	var out api.ServiceDirectionConfig
	err := s.run(ctx, tc, func(r *req) error {
		d, err := r.manageable(ctx, id, true)
		if err != nil {
			return err
		}
		draft, err := r.draft(ctx, d.ID)
		if err != nil {
			return err
		}
		if draft == nil {
			return conflict("Нет черновика для публикации")
		}
		if err := CheckBody(draft.Body); err != nil {
			return err
		}
		version, err := r.apply(ctx, d, draft.Body)
		if err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `delete from service.direction_drafts where direction_id = $1`, d.ID); err != nil {
			return store("drop draft", err)
		}
		if err := r.record(ctx, "service.direction.publish", targetDirection, d.ID, audit.Normal, map[string]any{"version": version}); err != nil {
			return err
		}
		if _, err := r.publish(ctx, evDirection, aggDirection, d.ID, map[string]any{keyDirectionID: d.ID, "version": version}); err != nil {
			return err
		}
		fresh, err := r.direction(ctx, d.ID, false)
		if err != nil {
			return err
		}
		if out, err = r.config(ctx, fresh); err != nil {
			return err
		}
		return complete(ctx, r.tx, http.StatusOK, "", out)
	})
	return out, err
}

// apply writes a published body: the calendar (a row of its own, a shared one stays), the name and the colour, the
// types and the templates; returns the new version.
func (r *req) apply(ctx context.Context, d *Direction, b api.ServiceDirectionBody) (int, error) {
	cal, err := CalendarOf(b.Calendar)
	if err != nil {
		return 0, err
	}
	label := cal.Label
	if label == "" {
		label = d.Calendar.Label
	}
	days := isoDays(cal.Days)
	calID := uuid.New()
	if _, err := r.tx.Exec(ctx, `insert into service.calendars (id, name, days, time_from, time_to, time_zone)
		values ($1, $2, $3, make_interval(mins => $4)::time, make_interval(mins => $5)::time, $6)`,
		calID, trimTo(label, 80), days, cal.From, cal.To, cal.loc().String()); err != nil {
		return 0, store("calendar", err)
	}
	version := d.Version + 1
	if _, err := r.tx.Exec(ctx, `update service.directions set name = $2, color = $3, calendar_id = $4, version = $5, updated_at = $6 where id = $1`,
		d.ID, strings.TrimSpace(b.Name), b.Color, calID, version, r.now); err != nil {
		return 0, store("direction", err)
	}
	if err := r.applyTypes(ctx, d.ID, b); err != nil {
		return 0, err
	}
	doc, err := json.Marshal(b)
	if err != nil {
		return 0, store("version body", err)
	}
	_, err = r.tx.Exec(ctx, `insert into service.direction_versions (direction_id, number, body, published_by, published_at)
		values ($1, $2, $3, $4, $5)`, d.ID, version, doc, nullID(r.tc.PersonID), r.now)
	return version, store("version", err)
}

func trimTo(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func (r *req) applyTypes(ctx context.Context, dir uuid.UUID, b api.ServiceDirectionBody) error {
	ids := make([]string, 0, len(b.Types))
	for _, t := range b.Types {
		ids = append(ids, t.Id)
		if _, err := r.tx.Exec(ctx, `insert into service.request_types (id, direction_id, kind, name, first_minutes, resolve_minutes, legal_days, priority)
			values ($1, $2, $3, $4, $5, $6, $7, $8)
			on conflict (direction_id, id) do update set kind = excluded.kind, name = excluded.name, first_minutes = excluded.first_minutes,
			  resolve_minutes = excluded.resolve_minutes, legal_days = excluded.legal_days, priority = excluded.priority`,
			t.Id, dir, string(t.Kind), strings.TrimSpace(t.Name), t.FirstMinutes, t.ResolveMinutes, t.LegalDays, string(t.Priority)); err != nil {
			return store("type "+t.Id, err)
		}
	}
	if _, err := r.tx.Exec(ctx, `delete from service.request_types t where t.direction_id = $1 and t.id <> all($2)
		and not exists (select 1 from service.requests q where q.direction_id = t.direction_id and q.type_id = t.id)`, dir, ids); err != nil {
		return store("drop types", err)
	}
	if b.Templates == nil {
		return nil
	}
	if _, err := r.tx.Exec(ctx, `delete from service.reply_templates where direction_id = $1`, dir); err != nil {
		return store("drop templates", err)
	}
	for i, t := range *b.Templates {
		if _, err := r.tx.Exec(ctx, `insert into service.reply_templates (id, direction_id, name, text) values ($1, $2, $3, $4)`,
			"t"+strconv.Itoa(i+1), dir, strings.TrimSpace(t.Name), strings.TrimSpace(t.Text)); err != nil {
			return store("template", err)
		}
	}
	return nil
}

// Templates is listServiceReplyTemplates.
func (s *Service) Templates(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.ServiceReplyTemplateList, error) {
	out := api.ServiceReplyTemplateList{Items: []api.ServiceReplyTemplate{}}
	err := s.run(ctx, tc, func(r *req) error {
		d, err := r.openDirection(ctx, id)
		if err != nil {
			return err
		}
		rows, err := r.tx.Query(ctx, `select id, name, text from service.reply_templates where direction_id = $1 order by id`, d.ID)
		if err != nil {
			return store("templates", err)
		}
		defer rows.Close()
		for rows.Next() {
			var t api.ServiceReplyTemplate
			if err := rows.Scan(&t.Id, &t.Name, &t.Text); err != nil {
				return store("template", err)
			}
			out.Items = append(out.Items, t)
		}
		return store("templates", rows.Err())
	})
	return out, err
}

// CreateDirection is createServiceDirection: a service project of «Задачи» is made with the direction.
func (s *Service) CreateDirection(ctx context.Context, tc tenantctx.TenantContext, b *api.ServiceDirectionCreate) (api.ServiceDirectionConfig, error) {
	var out api.ServiceDirectionConfig
	if b == nil {
		return out, problem.New(problem.CodeMalformedRequest, "")
	}
	err := s.run(ctx, tc, func(r *req) error {
		res := authz.Resource{}
		if b.OrgUnitId != nil {
			res.Unit = *b.OrgUnitId
		}
		if err := r.ev.Permit(ctx, tc, actManage, res); err != nil {
			if problem.Is(err, problem.CodeForbiddenAction) {
				return forbidden("Нет права «Настраивать направления»")
			}
			return err
		}
		key, name, cal, err := r.newDirection(ctx, b)
		if err != nil {
			return err
		}
		project, err := r.projectFor(ctx, key, name, b.OrgUnitId)
		if err != nil {
			return err
		}
		d, err := r.insertDirection(ctx, key, name, project, cal, b)
		if err != nil {
			return err
		}
		if err := r.record(ctx, "service.direction.create", targetDirection, d.ID, audit.Normal, map[string]any{keyKey: key}); err != nil {
			return err
		}
		if out, err = r.config(ctx, d); err != nil {
			return err
		}
		return complete(ctx, r.tx, http.StatusCreated, "", out)
	})
	return out, err
}

// newDirection checks the body of createServiceDirection: the key (free), the name, the calendar.
func (r *req) newDirection(ctx context.Context, b *api.ServiceDirectionCreate) (key, name string, cal Calendar, err error) {
	if key, err = CheckKey(b.Key); err != nil {
		return "", "", cal, err
	}
	if name = strings.TrimSpace(b.Name); badLen(name, 2, 80) {
		return "", "", cal, invalid("Название — от 2 до 80 символов")
	}
	if b.Color != nil && !colorRE.MatchString(*b.Color) {
		return "", "", cal, invalid("Цвет — «#RRGGBB»")
	}
	cal = Calendar{Days: []int{0, 1, 2, 3, 4}, From: 540, To: 1140, Label: "пн–пт 9:00–19:00"}
	if b.Calendar != nil {
		if cal, err = CalendarOf(*b.Calendar); err != nil {
			return "", "", cal, err
		}
	}
	if b.OrgUnitId != nil {
		var ok bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from org.units where id = $1)`, *b.OrgUnitId).Scan(&ok); err != nil {
			return "", "", cal, store("unit", err)
		}
		if !ok {
			return "", "", cal, invalid("Подразделение не найдено")
		}
	}
	var taken bool
	if err := r.tx.QueryRow(ctx, `select exists (select 1 from service.directions where key = $1)`, key).Scan(&taken); err != nil {
		return "", "", cal, store("key", err)
	}
	if taken {
		return "", "", cal, invalid("Ключ " + key + " уже занят")
	}
	return key, name, cal, nil
}

func (r *req) projectFor(ctx context.Context, key, name string, unit *uuid.UUID) (uuid.UUID, error) {
	if r.s.Projects == nil {
		return uuid.Nil, problem.New(problem.CodeDependencyUnavailable, "Проекты задач не подключены")
	}
	return r.s.Projects.CreateServiceProject(ctx, r.tc, key, "Обращения · "+name, unit)
}

func (r *req) insertDirection(ctx context.Context, key, name string, project uuid.UUID, cal Calendar, b *api.ServiceDirectionCreate) (*Direction, error) {
	color := "#2B5479"
	if b.Color != nil {
		color = *b.Color
	}
	label := cal.Label
	if label == "" {
		label = "рабочее время"
	}
	days := isoDays(cal.Days)
	calID, id := uuid.New(), uuid.New()
	if _, err := r.tx.Exec(ctx, `insert into service.calendars (id, name, days, time_from, time_to, time_zone)
		values ($1, $2, $3, make_interval(mins => $4)::time, make_interval(mins => $5)::time, $6)`,
		calID, trimTo(label, 80), days, cal.From, cal.To, cal.loc().String()); err != nil {
		return nil, store("calendar", err)
	}
	if _, err := r.tx.Exec(ctx, `insert into service.directions (id, key, name, color, module_key, area_label, org_unit_id, project_id, calendar_id,
		lead_id, created_at, updated_at) values ($1, $2, $3, $4, 'service', 'Вся организация', $5, $6, $7, $8, $9, $9)`,
		id, key, name, color, b.OrgUnitId, project, calID, nullID(r.tc.PersonID), r.now); err != nil {
		if code, _ := pgCode(err); code == pgUnique {
			return nil, invalid("Ключ " + key + " уже занят")
		}
		return nil, store("direction", err)
	}
	for _, t := range DemoTemplates() {
		if _, err := r.tx.Exec(ctx, `insert into service.reply_templates (id, direction_id, name, text) values ($1, $2, $3, $4)`, t.ID, id, t.Name, t.Text); err != nil {
			return nil, store("template", err)
		}
	}
	d, err := r.direction(ctx, id, false)
	if err != nil {
		return nil, err
	}
	body, _ := json.Marshal(api.ServiceDirectionBody{Name: name, Color: color, Calendar: calendarDTO(d.Calendar), Types: nil}) //nolint:errchkjson // plain fields
	_, err = r.tx.Exec(ctx, `insert into service.direction_versions (direction_id, number, body, published_by, published_at)
		values ($1, 1, $2, $3, $4)`, id, body, nullID(r.tc.PersonID), r.now)
	return d, store("version", err)
}
