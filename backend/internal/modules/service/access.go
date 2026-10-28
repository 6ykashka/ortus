package service

import (
	"context"
	"slices"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// resource is the direction as the object of a right (PD-53): the project of the direction is the scope «project», its
// unit the unit of the grants of the area. Without the right to read it is invisible: 404, not 403.
func resource(d *Direction) authz.Resource {
	res := authz.Resource{Objects: map[string]uuid.UUID{authz.KindProject: d.ProjectID}, ReadAction: actRead}
	if d.OrgUnitID != nil {
		res.Unit = *d.OrgUnitID
	}
	return res
}

// can asks the right action in the direction d for the actor.
func (r *req) can(ctx context.Context, action string, d *Direction) error {
	return r.ev.Permit(ctx, r.tc, action, resource(d))
}

// mayIn reports whether the actor holds action in d; a denial is false, anything else an error.
func (r *req) mayIn(ctx context.Context, action string, d *Direction) (bool, error) {
	return denied(r.can(ctx, action, d))
}

func denied(err error) (bool, error) {
	switch {
	case err == nil:
		return true, nil
	case problem.Is(err, problem.CodeForbiddenAction), problem.Is(err, problem.CodeNotFound), problem.Is(err, authz.CodeFunctionBlocked):
		return false, nil
	}
	return false, err
}

// directionColumns are the columns a predicate of the rights filters the directions on.
func directionColumns(alias string) authz.Columns {
	return authz.Columns{Unit: alias + ".org_unit_id", Objects: map[string]string{authz.KindProject: alias + ".project_id"}}
}

// visible are the directions the actor holds action in (ScopeQuery over the whole list), active ones first by key.
func (r *req) visible(ctx context.Context, action string) ([]Direction, error) {
	p, err := r.ev.ScopeQuery(ctx, r.tc, action, directionColumns("d"), 0)
	if err != nil {
		return nil, err
	}
	return r.directions(ctx, "("+p.SQL+") and d.status = 'active'", p.Args...)
}

// hidden reports whether the request is a complaint about the actor: it does not exist for him (404).
func (r *req) hidden(x *Request) bool { return x.About != uuid.Nil && x.About == r.tc.PersonID }

// open loads a request the actor sees: a missing one, one of an invisible direction and a complaint about the actor are
// the same 404. With lock the row is taken for update.
func (r *req) open(ctx context.Context, id uuid.UUID, lock bool) (*Request, *Direction, error) {
	x, err := r.request(ctx, id, lock)
	if err != nil {
		return nil, nil, err
	}
	if x == nil {
		return nil, nil, notFound(textRequestNotFound)
	}
	d, err := r.direction(ctx, x.DirectionID, false)
	if err != nil {
		return nil, nil, err
	}
	if d == nil || r.hidden(x) {
		return nil, nil, notFound(textRequestNotFound)
	}
	if err := r.can(ctx, actRead, d); err != nil {
		if problem.Is(err, problem.CodeNotFound) || problem.Is(err, problem.CodeForbiddenAction) {
			return nil, nil, notFound(textRequestNotFound)
		}
		return nil, nil, err
	}
	return x, d, nil
}

// need asks action in d and answers a denial with the text of the prototype (3.1 of the breakdown): 403.
func (r *req) need(ctx context.Context, action string, d *Direction) error {
	err := r.can(ctx, action, d)
	if err == nil {
		return nil
	}
	if problem.Is(err, problem.CodeForbiddenAction) {
		return forbidden(deniedText(action))
	}
	return err
}

func deniedText(action string) string {
	switch action {
	case actRead:
		return "Нет права «Видеть» в обращениях"
	case actCreate:
		return "Нет права «Заводить» в обращениях"
	case actReply:
		return "Нет права «Отвечать» в обращениях"
	case actResolve:
		return "Нет права «Решать» в обращениях"
	case actContacts:
		return "Телефон клиента показывают руководителю направления и владельцу: нужно право «Контакты клиентов»"
	case actCompensation:
		return "Нет права «Назначать компенсацию» в обращениях"
	}
	return "Нет права на это действие"
}

// team are the active people who see the direction and may reply in it (the performers of the direction).
func (r *req) team(ctx context.Context, d *Direction) ([]uuid.UUID, error) {
	rows, err := r.tx.Query(ctx, `select id from people.person_profiles where archived_at is null order by full_name, id`)
	if err != nil {
		return nil, store("team", err)
	}
	var people []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, store("team", err)
		}
		people = append(people, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, store("team", err)
	}
	members, err := r.members(ctx)
	if err != nil {
		return nil, err
	}
	out := []uuid.UUID{}
	for _, p := range people {
		m, known := members[p]
		if known && !m.Active {
			continue
		}
		in, err := r.inTeam(ctx, tenantctx.TenantContext{TenantID: r.tc.TenantID, PersonID: p, Owner: m.Owner}, d)
		if err != nil {
			return nil, err
		}
		if in {
			out = append(out, p)
		}
	}
	return out, nil
}

// members are the memberships of the people of the business (nil Directory: none known).
func (r *req) members(ctx context.Context) (map[uuid.UUID]Member, error) {
	if r.s.Directory == nil {
		return map[uuid.UUID]Member{}, nil
	}
	m, err := r.s.Directory.Memberships(ctx, r.tc.TenantID)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return m, nil
}

// inTeam reports whether the person of tc sees the direction and may reply in it.
func (r *req) inTeam(ctx context.Context, tc tenantctx.TenantContext, d *Direction) (bool, error) {
	for _, a := range []string{actRead, actReply} {
		if err := r.ev.Permit(ctx, tc, a, resource(d)); err != nil {
			if ok, derr := denied(err); derr != nil || !ok {
				return false, derr
			}
		}
	}
	return true, nil
}

// teamOf are the teams of the directions keyed by id.
func (r *req) teamOf(ctx context.Context, dirs []Direction) (map[uuid.UUID][]uuid.UUID, error) {
	out := make(map[uuid.UUID][]uuid.UUID, len(dirs))
	for i := range dirs {
		t, err := r.team(ctx, &dirs[i])
		if err != nil {
			return nil, err
		}
		out[dirs[i].ID] = t
	}
	return out, nil
}

// openDirection loads a direction the actor sees (read); an invisible one is 404.
func (r *req) openDirection(ctx context.Context, id uuid.UUID) (*Direction, error) {
	d, err := r.direction(ctx, id, false)
	if err != nil {
		return nil, err
	}
	if d == nil {
		return nil, notFound(textDirectionMissing)
	}
	if err := r.can(ctx, actRead, d); err != nil {
		if problem.Is(err, problem.CodeNotFound) || problem.Is(err, problem.CodeForbiddenAction) {
			return nil, notFound(textDirectionMissing)
		}
		return nil, err
	}
	return d, nil
}

// hasAction reports whether the actor holds action in any direction (the gate of a screen); owner: always.
func (r *req) hasAction(ctx context.Context, action string, dirs []Direction) (bool, error) {
	if r.tc.Owner {
		return true, nil
	}
	for i := range dirs {
		ok, err := r.mayIn(ctx, action, &dirs[i])
		if err != nil || ok {
			return ok, err
		}
	}
	return false, nil
}

// idsOf are the ids of the directions.
func idsOf(dirs []Direction) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(dirs))
	for _, d := range dirs {
		out = append(out, d.ID)
	}
	return out
}

// calendarsOf maps the directions to their calendars.
func calendarsOf(dirs []Direction) map[uuid.UUID]Calendar {
	out := make(map[uuid.UUID]Calendar, len(dirs))
	for _, d := range dirs {
		out[d.ID] = d.Calendar
	}
	return out
}

// find returns the direction with id from the list.
func find(dirs []Direction, id uuid.UUID) *Direction {
	i := slices.IndexFunc(dirs, func(d Direction) bool { return d.ID == id })
	if i < 0 {
		return nil
	}
	return &dirs[i]
}
