package chats

import (
	"context"
	"encoding/json"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Texts of the roster (chatAccess of the domain).
const (
	whyBlocked  = "Заблокирован владельцем — не входит в чаты; вернётся сам, если разблокируют"
	whyEnded    = "Сотрудник больше не работает в организации"
	whyNoModule = "У ролей сотрудника нет модуля «Чаты»: разрешите его в роли или добавьте по имени"
	whyFunction = "Функция «Водитель»: чаты с меткой «Финансы» закрыты"
	whyInvited  = "Войдёт, когда примет приглашение в организацию"
	whyNotIn    = "Не входит в состав чата"
	viaDirect   = "Участник личного чата"
	viaCreator  = "Создатель чата"
)

// objJSON is the object of a source «relation» in chat.chat_sources.object_ref (the shape of the contract ObjectRef).
type objJSON struct {
	ModuleKey  string    `json:"moduleKey"`
	EntityType string    `json:"entityType"`
	EntityID   uuid.UUID `json:"entityId"`
}

// srcRec is a source of the roster (chat.chat_sources).
type srcRec struct {
	ID     uuid.UUID
	Who    string
	Ref    *uuid.UUID
	Unit   *uuid.UUID
	Object *objJSON
	Trip   *uuid.UUID
	Role   Role
}

func (r *req) loadSources(ctx context.Context, chatID uuid.UUID) ([]srcRec, error) {
	rows, err := r.tx.Query(ctx, `select id, who, ref_id, org_unit_id, object_ref, trip_id, role from chat.chat_sources
		where chat_id = $1 order by created_at, id`, chatID)
	if err != nil {
		return nil, store("sources", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (srcRec, error) {
		var (
			s    srcRec
			role string
			obj  []byte
		)
		if err := row.Scan(&s.ID, &s.Who, &s.Ref, &s.Unit, &obj, &s.Trip, &role); err != nil {
			return s, err
		}
		s.Role = Role(role)
		if len(obj) > 0 && string(obj) != litNull {
			s.Object = &objJSON{}
			if err := json.Unmarshal(obj, s.Object); err != nil {
				return s, err
			}
		}
		return s, nil
	})
}

// saveSources replaces the sources of a chat.
func (r *req) saveSources(ctx context.Context, chatID uuid.UUID, srcs []srcRec) error {
	if _, err := r.tx.Exec(ctx, `delete from chat.chat_sources where chat_id = $1`, chatID); err != nil {
		return store("sources", err)
	}
	for _, s := range srcs {
		var obj any
		if s.Object != nil {
			b, _ := json.Marshal(s.Object)
			obj = b
		}
		if _, err := r.tx.Exec(ctx, `insert into chat.chat_sources (chat_id, who, ref_id, org_unit_id, object_ref, trip_id, role)
			values ($1, $2, $3, $4, $5, $6, $7)`, chatID, s.Who, s.Ref, s.Unit, obj, s.Trip, string(s.Role)); err != nil {
			return store("source", err)
		}
	}
	return nil
}

// draftSeat is what the sources give one person before their status decides.
type draftSeat struct {
	Role Role
	Via  []string
}

// candidates expands the sources into people with the strongest role and the labels of the sources.
func (r *req) candidates(ctx context.Context, srcs []srcRec) (map[uuid.UUID]*draftSeat, error) {
	out := map[uuid.UUID]*draftSeat{}
	for _, s := range srcs {
		ids, err := r.expand(ctx, s)
		if err != nil {
			return nil, err
		}
		if len(ids) == 0 {
			continue
		}
		label, err := r.srcLabel(ctx, s)
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			d := out[id]
			if d == nil {
				d = &draftSeat{}
				out[id] = d
			}
			d.Role = higher(d.Role, s.Role)
			if !slices.Contains(d.Via, label) {
				d.Via = append(d.Via, label)
			}
		}
	}
	return out, nil
}

// expand is the people one source names now.
func (r *req) expand(ctx context.Context, s srcRec) ([]uuid.UUID, error) {
	var (
		q    string
		args []any
	)
	switch s.Who {
	case litAll:
		q = `select p.id from people.person_profiles p where p.archived_at is null and ($1::uuid is null or p.home_unit_id in
			(select descendant_id from org.unit_closure where ancestor_id = $1))`
		args = []any{s.Unit}
	case litGroup:
		q = `select person_id from access.group_members where group_id = $1`
		args = []any{s.Ref}
	case litRole:
		q = `with ass as (
			  select a.principal_kind, a.principal_id, a.scope_kind, a.scope_ref, a.include_descendants from access.role_assignments a
			   where a.role_id = $1 and a.state = 'active' and a.valid @> $3::timestamptz
			)
			select distinct person from (
			  select principal_id as person, scope_kind, scope_ref, include_descendants from ass where principal_kind = 'person'
			  union all
			  select gm.person_id, ass.scope_kind, ass.scope_ref, ass.include_descendants from ass
			    join access.group_members gm on gm.group_id = ass.principal_id where ass.principal_kind = 'group'
			) x where $2::uuid is null or scope_kind in ('tenant', 'self')
			   or (scope_kind = 'unit' and (scope_ref = $2 or (include_descendants and exists
			        (select 1 from org.unit_closure uc where uc.ancestor_id = x.scope_ref and uc.descendant_id = $2))))`
		args = []any{s.Ref, s.Unit, r.now}
	case litMember:
		return nilIf(s.Ref), nil
	case litRelation:
		if r.s.Relations == nil || s.Object == nil {
			return nil, nil
		}
		ids, err := r.s.Relations.Related(ctx, r.tx, ObjectRef{Module: s.Object.ModuleKey, Type: s.Object.EntityType, ID: s.Object.EntityID})
		if err != nil {
			return nil, store(litRelation, err)
		}
		return ids, nil
	case litTripDriver:
		q = `select driver_person_id from fleet.trips where id = $1 and driver_person_id is not null`
		args = []any{s.Trip}
	default:
		return nil, nil
	}
	rows, err := r.tx.Query(ctx, q, args...)
	if err != nil {
		return nil, store("expand "+s.Who, err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, store("expand "+s.Who, err)
	}
	return ids, nil
}

func nilIf(id *uuid.UUID) []uuid.UUID {
	if id == nil {
		return nil
	}
	return []uuid.UUID{*id}
}

// srcLabel is the text of a source for «Откуда состав» (srcLabel of the domain).
func (r *req) srcLabel(ctx context.Context, s srcRec) (string, error) {
	one := func(q string, id *uuid.UUID, fallback string) (string, error) {
		if id == nil {
			return fallback, nil
		}
		var n string
		if err := r.tx.QueryRow(ctx, q, *id).Scan(&n); err != nil {
			if noRows(err) {
				return fallback, nil
			}
			return "", store("label", err)
		}
		return n, nil
	}
	switch s.Who {
	case litAll:
		return "Все сотрудники организации", nil
	case litGroup:
		n, err := one(`select name from access.groups where id = $1`, s.Ref, "группа")
		return "Группа «" + n + "»", err
	case litRole:
		n, err := one(`select name from access.roles where id = $1`, s.Ref, "роль")
		if err != nil {
			return "", err
		}
		u, err := one(`select name from org.units where id = $1`, s.Unit, "вся организация")
		return "Роль «" + n + "» · " + u, err
	case litRelation:
		return "Прораб объекта", nil
	case litTripDriver:
		return "Водитель рейса", nil
	case litMember:
		return one(`select full_name from people.person_profiles where id = $1`, s.Ref, litPerson)
	}
	return "—", nil
}

// memberRow is the place of one person in a chat (chat.chat_members).
type memberRow struct {
	Person uuid.UUID
	State  string // in, pending, out
	Role   Role   // empty for out
	Via    string
	Why    string
}

// decide turns the candidates into places: the status in the organization, the module «Чаты» in the roles, the function
// «Водитель» and the label «Финансы» decide who is in, who waits for the invitation and who is out.
func (r *req) decide(ctx context.Context, sensitivity string, cands map[uuid.UUID]*draftSeat) ([]memberRow, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	if len(cands) == 0 {
		return nil, nil
	}
	ids := make([]uuid.UUID, 0, len(cands))
	for id := range cands {
		ids = append(ids, id)
	}
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	type info struct {
		membership *uuid.UUID
		archived   bool
	}
	facts := map[uuid.UUID]info{}
	rows, err := r.tx.Query(ctx, `select id, membership_id, archived_at is not null from people.person_profiles where id = any($1)`, ids)
	if err != nil {
		return nil, store("people", err)
	}
	for rows.Next() {
		var (
			id uuid.UUID
			i  info
		)
		if err := rows.Scan(&id, &i.membership, &i.archived); err != nil {
			rows.Close()
			return nil, store("people", err)
		}
		facts[id] = i
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, store("people", err)
	}
	memberships := map[uuid.UUID]Membership{}
	if r.s.Memberships != nil {
		var mids []uuid.UUID
		for _, i := range facts {
			if i.membership != nil {
				mids = append(mids, *i.membership)
			}
		}
		if memberships, err = r.s.Memberships.Memberships(ctx, r.tc.TenantID, mids); err != nil {
			return nil, store("memberships", err)
		}
	}
	module, err := r.withModule(ctx, ids)
	if err != nil {
		return nil, err
	}
	drivers, err := r.drivers(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]memberRow, 0, len(ids))
	for _, id := range ids {
		d, i := cands[id], facts[id]
		m := memberRow{Person: id, Via: strings.Join(d.Via, " · "), Role: d.Role}
		status, owner := litActive, false
		if i.membership != nil && r.s.Memberships != nil {
			if x, ok := memberships[*i.membership]; ok {
				status, owner = x.Status, x.Owner
			} else {
				status = litEnded
			}
		}
		switch {
		case i.archived || status == litEnded:
			m.State, m.Role, m.Why = litOut, "", whyEnded
		case status == "suspended":
			m.State, m.Role, m.Why = litOut, "", whyBlocked
		case !owner && !module[id]:
			m.State, m.Role, m.Why = litOut, "", whyNoModule
		case sensitivity == litFinance && drivers[id]:
			m.State, m.Role, m.Why = litOut, "", whyFunction
		case status == "invited":
			m.State, m.Why = litPending, whyInvited
		default:
			m.State = "in"
		}
		out = append(out, m)
	}
	return out, nil
}

// withModule returns the people with the module «Чаты» in a role: an active assignment of a role with chat.read.
func (r *req) withModule(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]bool, error) {
	return r.personSet(ctx, "module", `select distinct person from (
		select a.principal_id as person, rv.actions from access.role_assignments a
		  join access.role_versions rv on rv.role_id = a.role_id and rv.version = a.role_version
		 where a.principal_kind = 'person' and a.principal_id = any($1) and a.state = 'active' and a.valid @> $2::timestamptz
		union all
		select gm.person_id, rv.actions from access.role_assignments a
		  join access.role_versions rv on rv.role_id = a.role_id and rv.version = a.role_version
		  join access.group_members gm on gm.group_id = a.principal_id
		 where a.principal_kind = 'group' and gm.person_id = any($1) and a.state = 'active' and a.valid @> $2::timestamptz
	) x where 'chat.read' = any(actions)`, ids)
}

// drivers returns the people who work as drivers now.
func (r *req) drivers(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]bool, error) {
	return r.personSet(ctx, "drivers", `select distinct person_id from people.work_profiles where person_id = any($1)
		and function = 'driver' and valid @> $2::timestamptz`, ids)
}

// personSet runs a query of people (the ids and the instant of the request are $1 and $2) and returns them as a set.
func (r *req) personSet(ctx context.Context, what, query string, ids []uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := r.tx.Query(ctx, query, ids, r.now)
	if err != nil {
		return nil, store(what, err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, store(what, err)
	}
	out := make(map[uuid.UUID]bool, len(got))
	for _, id := range got {
		out[id] = true
	}
	return out, nil
}

// Impact is who gets, keeps or loses a chat.
type Impact struct {
	Joined, Pending, Lose []uuid.UUID
	Skipped               []Skipped
}

// Skipped is a person who cannot be added and why.
type Skipped struct {
	Person uuid.UUID
	Reason string
}

// current reads the places of a chat: person → state.
func (r *req) current(ctx context.Context, chatID uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	if chatID == uuid.Nil {
		return out, nil
	}
	rows, err := r.tx.Query(ctx, `select member_id, state from chat.chat_members where chat_id = $1`, chatID)
	if err != nil {
		return nil, store("members", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id uuid.UUID
			s  string
		)
		if err := rows.Scan(&id, &s); err != nil {
			return nil, store("members", err)
		}
		out[id] = s
	}
	return out, rows.Err()
}

// impactOf compares the new places with the current ones of a chat (nil chat id: a chat to be created).
func impactOf(before map[uuid.UUID]string, rows []memberRow) Impact {
	var im Impact
	now := map[uuid.UUID]bool{}
	for _, m := range rows {
		now[m.Person] = m.State == "in"
		switch m.State {
		case "in":
			if before[m.Person] != "in" {
				im.Joined = append(im.Joined, m.Person)
			}
		case litPending:
			im.Pending = append(im.Pending, m.Person)
		default:
			im.Skipped = append(im.Skipped, Skipped{Person: m.Person, Reason: m.Why})
		}
	}
	for id, st := range before {
		if st == "in" && !now[id] {
			im.Lose = append(im.Lose, id)
		}
	}
	return im
}

// reconcile writes the places of a chat: new members get joined_at, those who left get left_at; the places of people the
// sources no longer name become out.
func (r *req) reconcile(ctx context.Context, chatID uuid.UUID, rows []memberRow) error {
	named := map[uuid.UUID]bool{}
	for _, m := range rows {
		named[m.Person] = true
		var role any
		if m.Role != "" {
			role = string(m.Role)
		}
		if _, err := r.tx.Exec(ctx, `insert into chat.chat_members (chat_id, member_id, state, role, via, why, joined_at, left_at)
			values ($1, $2, $3, $4, $5, nullif($6, ''), case when $3 = 'in' then $7::timestamptz end, null)
			on conflict (chat_id, member_id) do update set
			  state = excluded.state, role = excluded.role, via = excluded.via, why = excluded.why,
			  joined_at = case when excluded.state = 'in' and chat.chat_members.state <> 'in' then $7::timestamptz
			                   when excluded.state = 'in' then chat.chat_members.joined_at else chat.chat_members.joined_at end,
			  left_at = case when excluded.state <> 'in' and chat.chat_members.state = 'in' then $7::timestamptz
			                 when excluded.state = 'in' then null else chat.chat_members.left_at end`,
			chatID, m.Person, m.State, role, nullIfEmpty(m.Via), m.Why, r.now); err != nil {
			return store(litMember, err)
		}
	}
	rest, err := r.current(ctx, chatID)
	if err != nil {
		return err
	}
	for id, st := range rest {
		if named[id] || st == litOut {
			continue
		}
		if _, err := r.tx.Exec(ctx, `update chat.chat_members set state = 'out', role = null, why = $3,
			left_at = case when state = 'in' then $4::timestamptz else left_at end where chat_id = $1 and member_id = $2`,
			chatID, id, whyNotIn, r.now); err != nil {
			return store(litMember, err)
		}
	}
	return nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// recompute reads the sources of a chat, computes its roster and writes it; it returns who joined and who left.
func (r *req) recompute(ctx context.Context, c *chatRec) (Impact, error) {
	if c.Kind == KindDirect {
		return Impact{}, nil
	}
	srcs, err := r.loadSources(ctx, c.ID)
	if err != nil {
		return Impact{}, err
	}
	cands, err := r.candidates(ctx, srcs)
	if err != nil {
		return Impact{}, err
	}
	rows, err := r.decide(ctx, c.Sensitivity, cands)
	if err != nil {
		return Impact{}, err
	}
	before, err := r.current(ctx, c.ID)
	if err != nil {
		return Impact{}, err
	}
	im := impactOf(before, rows)
	if err := r.reconcile(ctx, c.ID, rows); err != nil {
		return Impact{}, err
	}
	return im, nil
}
