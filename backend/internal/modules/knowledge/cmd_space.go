package knowledge

import (
	"context"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// titleOf checks a title: 2–120 characters after trimming (the reference «Название — не короче 2 символов»).
func titleOf(s string) (string, error) {
	t := strings.TrimSpace(s)
	switch n := utf8.RuneCountInString(t); {
	case n < titleMin:
		return "", failed("Название — не короче 2 символов")
	case n > titleMax:
		return "", failed("Название — не длиннее 120 символов")
	}
	return t, nil
}

var (
	iconRE  = regexp.MustCompile(`^[a-z_]{2,40}$`)
	colorRE = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
)

const defaultColor = "#2B5479"

// etag is the strong ETag of a revision.
func etag(rev int64) string { return `"rev-` + strconv.FormatInt(rev, 10) + `"` }

// canSettings reports whether m may create a space in unitID (PD-53: the owner, or knowledge.spaces.manage of a role
// of the organization or of a unit covering it; the whole organization — a role of the organization).
func (w *world) canSettings(m *member, unitID uuid.UUID) bool {
	if m.owner {
		return true
	}
	return slices.ContainsFunc(w.grants[m.id], func(g grant) bool {
		if !g.verbs.has(verbSettings) {
			return false
		}
		if unitID == uuid.Nil {
			return g.kind == scopeTenant
		}
		return w.covers(g, unitID)
	})
}

// CreateSpace creates a space from a template (createKnowledgeSpace).
func (s *Service) CreateSpace(ctx context.Context, tc tenantctx.TenantContext, b kapi.KnowledgeSpaceCreate) (kapi.KnowledgeSpace, error) {
	var out kapi.KnowledgeSpace
	err := s.run(ctx, tc, true, func(r *req) error {
		sp, err := r.newSpace(b)
		if err != nil {
			return err
		}
		if err := r.writeSpace(ctx, sp, b.TemplateNodes); err != nil {
			return err
		}
		out = r.spaceDTO(sp)
		return nil
	})
	return out, err
}

// newSpace checks the space of b (area, right, name, level) and makes it.
func (r *req) newSpace(b kapi.KnowledgeSpaceCreate) (*space, error) {
	unitID := uuid.Nil
	if b.OrgUnitId != nil {
		if r.w.units[*b.OrgUnitId] == nil {
			return nil, invalid("orgUnitId", "Подразделение не найдено")
		}
		unitID = *b.OrgUnitId
	}
	if !r.w.canSettings(r.me, unitID) {
		return nil, forbidden(textCreateSpace)
	}
	name, err := titleOf(b.Name)
	if err != nil {
		return nil, err
	}
	if r.w.spaceNamed(name, uuid.Nil) {
		return nil, failed("Пространство «" + name + "» уже есть")
	}
	if _, ok := levels[string(b.Access)]; !ok {
		return nil, failed("Выберите уровень доступа")
	}
	key := "blank"
	if b.TemplateKey != nil {
		key = string(*b.TemplateKey)
	}
	tpl := templateOf(key)
	sp := &space{id: uuid.New(), name: name, icon: tpl.icon, color: defaultColor, unit: unitID, access: string(b.Access),
		template: tpl.key, revision: 1, created: r.now}
	return sp, look(sp, b.Icon, b.Color)
}

// look sets the icon and the color of sp when given (an icon of lower letters, a color «#RRGGBB»).
func look(sp *space, icon, color *string) error {
	if icon != nil && *icon != "" {
		if !iconRE.MatchString(*icon) {
			return invalid("icon", "Выберите значок")
		}
		sp.icon = *icon
	}
	if color != nil && *color != "" {
		if !colorRE.MatchString(*color) {
			return invalid("color", "Выберите цвет")
		}
		sp.color = *color
	}
	return nil
}

// spaceNamed reports whether a space other than except has the name (case-insensitive).
func (w *world) spaceNamed(name string, except uuid.UUID) bool {
	return slices.ContainsFunc(w.spaces, func(x *space) bool { return x.id != except && strings.EqualFold(x.name, name) })
}

// writeSpace writes sp with the nodes of its template (picked: the indexes to create, nil — all) and gives its
// author (unless the owner of the business) the role of the lead of the space.
func (r *req) writeSpace(ctx context.Context, sp *space, picked *[]int) error {
	if err := r.wr.space(ctx, sp, r.me.id); err != nil {
		if unique(err, "spaces_name_uq") {
			return failed("Пространство «" + sp.name + "» уже есть")
		}
		return err
	}
	r.w.addSpace(sp)
	nodes, err := r.templateNodes(ctx, sp, picked)
	if err != nil {
		return err
	}
	for _, n := range nodes {
		if err := r.wr.node(ctx, n); err != nil {
			return err
		}
	}
	if !r.me.owner {
		lead, err := r.spaceRole(ctx, templateLead)
		if err != nil {
			return err
		}
		if err := r.grantRole(ctx, r.me.id, lead, scopeSpace, sp.id, assignment{reason: "knowledge.space.created"}); err != nil {
			return err
		}
		if err := r.bump(ctx, []uuid.UUID{r.me.id}); err != nil {
			return err
		}
	}
	_, err = r.publish(ctx, "kb.space.created", aggSpace, sp.id, map[string]any{"name": sp.name, "access": sp.access})
	return err
}

// templateNodes makes the nodes of the template of sp (kbCreateSpace): a subpage goes under the previous top node and
// only with it; a folder of a function — «Только выбранные»: the role of the function in the area of the space reads,
// the editors edit; a node with acknowledgement asks everyone who sees it.
func (r *req) templateNodes(ctx context.Context, sp *space, picked *[]int) ([]*node, error) {
	tpl := templateOf(sp.template)
	pick := map[int]bool{}
	for i := range tpl.nodes {
		pick[i] = picked == nil || slices.Contains(*picked, i)
	}
	var out []*node
	pl := placer{}
	for i, x := range tpl.nodes {
		if !x.in && !pick[i] {
			pl.top = nil
		}
		if !pick[i] || (x.in && pl.top == nil) {
			continue
		}
		n := r.newNode(sp, x.kind, x.title, x.body, statusActive)
		pl.place(n, x.in)
		if err := r.templateAccess(ctx, n, x, sp); err != nil {
			return nil, err
		}
		out = append(out, n)
		r.w.nodes[n.id] = n
	}
	return out, nil
}

// placer puts the nodes of a template in order: a top node after the previous top one («Обзор» — the home page), a
// subpage under the last top node.
type placer struct {
	top       *node
	pos, kpos int
	home      bool
}

func (p *placer) place(n *node, in bool) {
	if in {
		p.kpos++
		n.parent, n.pos, n.depth = p.top.id, p.kpos, 2
		return
	}
	p.pos++
	n.pos, p.kpos, p.top = p.pos, 0, n
	if !p.home && n.kind == kindPage && n.title == homeTitle {
		n.home, p.home = true, true
	}
}

// templateAccess sets the access list of a folder of a function and the acknowledgement of a node of a template.
func (r *req) templateAccess(ctx context.Context, n *node, x templateNode, sp *space) error {
	if x.ack {
		n.ack = &ack{v: 1, audience: entry{who: whoAll}}
	}
	if x.role == "" {
		return nil
	}
	editors, err := r.editors(ctx)
	if err != nil {
		return err
	}
	n.mode = modeListed
	if rl := r.w.templateRole(x.role); rl != nil {
		n.list = append(n.list, entry{who: whoRole, ref: rl.id, unit: sp.unit, can: canView})
	}
	n.list = append(n.list, editors)
	return nil
}

// editors is the entry «Редакторы пространства правят» (kbEditors).
func (r *req) editors(ctx context.Context) (entry, error) {
	x, err := r.spaceRole(ctx, templateEditor)
	if err != nil {
		return entry{}, err
	}
	return entry{who: whoRole, ref: x.id, can: canEdit}, nil
}

// newNode makes a node of sp at the top level with version 1 of body by the member (kbNode).
func (r *req) newNode(sp *space, kind, title, body, status string) *node {
	return &node{
		id: uuid.New(), space: sp.id, depth: 1, kind: kind, title: title, status: status, mode: modeInherit, accessRev: 1,
		owner: r.me.id, created: r.now,
		versions: []version{{v: 1, at: r.now, by: r.me.id, author: r.me.name, body: body}},
	}
}

// UpdateSpace changes the name, the icon, the color, the area or the level of a space with the impact on its
// readers and editors (updateKnowledgeSpace); dryRun changes nothing.
func (s *Service) UpdateSpace(ctx context.Context, tc tenantctx.TenantContext, spaceID uuid.UUID, ifMatch string, b kapi.KnowledgeSpacePatch) (kapi.KnowledgeSpaceChange, error) {
	var out kapi.KnowledgeSpaceChange
	err := s.runOn(ctx, tc, true, onSpace(spaceID), func(r *req) error {
		sp, err := r.leadSpace(spaceID)
		if err != nil {
			return err
		}
		if ifMatch != etag(sp.revision) {
			return problem.New(codeConflict, "")
		}
		next, err := r.patched(sp, b)
		if err != nil {
			return err
		}
		after := r.w.with(nil, []*space{next})
		var ids []uuid.UUID
		for _, n := range r.w.order(sp.id, false) {
			ids = append(ids, n.id)
		}
		out.Impact = impactSummary(impactOf(r.w, after, ids), len(ids))
		if b.DryRun != nil && *b.DryRun {
			out.Space = (&req{s: r.s, tc: r.tc, w: after, me: r.me, now: r.now}).spaceDTO(next)
			out.Space.Revision = sp.revision
			return nil
		}
		if err := r.saveSpace(ctx, sp, next); err != nil {
			return err
		}
		r.w = after
		out.Applied, out.Space = true, r.spaceDTO(next)
		return nil
	})
	return out, err
}

// patched is sp with the changes of b (checked).
func (r *req) patched(sp *space, b kapi.KnowledgeSpacePatch) (*space, error) {
	next := *sp
	if b.Name != nil {
		name, err := r.rename(sp, *b.Name)
		if err != nil {
			return nil, err
		}
		next.name = name
	}
	if err := look(&next, b.Icon, b.Color); err != nil {
		return nil, err
	}
	if b.Access != nil {
		if _, ok := levels[string(*b.Access)]; !ok {
			return nil, invalid("access", "Выберите уровень доступа")
		}
		next.access = string(*b.Access)
	}
	if b.OrgUnitId != nil && *b.OrgUnitId != sp.unit {
		if r.w.units[*b.OrgUnitId] == nil {
			return nil, invalid("orgUnitId", "Подразделение не найдено")
		}
		if !r.w.canSettings(r.me, *b.OrgUnitId) {
			return nil, forbidden(textCreateSpace) // Q-W4.04-8: a new area needs knowledge.spaces.manage covering it
		}
		next.unit = *b.OrgUnitId
	}
	next.revision = sp.revision + 1
	return &next, nil
}

// rename checks a new name of sp: 2–120 characters, unique in the organization.
func (r *req) rename(sp *space, raw string) (string, error) {
	name := strings.TrimSpace(raw)
	switch n := utf8.RuneCountInString(name); {
	case n < titleMin:
		return "", invalid("name", "Название — не короче 2 символов")
	case n > titleMax:
		return "", invalid("name", "Название — не длиннее 120 символов")
	case r.w.spaceNamed(name, sp.id):
		return "", invalid("name", "Пространство «"+name+"» уже есть", "taken")
	}
	return name, nil
}

// saveSpace writes next over sp if its revision did not change; a change of the area or the level is an access
// change (event, audit).
func (r *req) saveSpace(ctx context.Context, sp, next *space) error {
	tag, err := r.tx.Exec(ctx, `update kb.spaces set name = $3, icon = $4, color = $5, org_unit_id = $6, access = $7,
		revision = revision + 1, updated_at = $8 where id = $1 and revision = $2`,
		sp.id, sp.revision, next.name, next.icon, next.color, nullID(next.unit), next.access, r.now)
	switch {
	case unique(err, "spaces_name_uq"):
		return invalid("name", "Пространство «"+next.name+"» уже есть", "taken")
	case err != nil:
		return err
	case tag.RowsAffected() == 0:
		return problem.New(codeConflict, "")
	}
	if next.unit == sp.unit && next.access == sp.access {
		return nil
	}
	diff := map[string]any{"access": []string{sp.access, next.access}, "orgUnitId": []any{nullID(sp.unit), nullID(next.unit)}}
	if err := r.record(ctx, "knowledge.space.access_changed", aggSpace, sp.id, diff); err != nil {
		return err
	}
	_, err = r.publish(ctx, "kb.access.changed", aggSpace, sp.id, diff)
	return err
}

// impactSummary is the impact in the schema of the contract.
func impactSummary(im impact, pages int) kapi.KnowledgeImpactSummary {
	return kapi.KnowledgeImpactSummary{Pages: pages, GainView: people(im.gainView), LoseView: people(im.loseView),
		GainEdit: people(im.gainEdit), LoseEdit: people(im.loseEdit)}
}

func people(ps []personPages) []kapi.KnowledgeImpactPerson {
	out := make([]kapi.KnowledgeImpactPerson, 0, len(ps))
	for _, p := range ps {
		out = append(out, kapi.KnowledgeImpactPerson{MemberId: p.m.id, DisplayName: p.m.name, Pages: p.pages})
	}
	return out
}

// SetMember gives, changes or removes the role of an employee in a space (setKnowledgeSpaceMember): the role of the
// space is an assignment of scope space in the common table of assignments.
func (s *Service) SetMember(ctx context.Context, tc tenantctx.TenantContext, spaceID, memberID uuid.UUID, b kapi.KnowledgeSpaceMemberChange) (kapi.KnowledgeSpaceMembers, error) {
	var out kapi.KnowledgeSpaceMembers
	err := s.runOn(ctx, tc, true, onSpace(spaceID), func(r *req) error {
		sp, err := r.leadSpace(spaceID)
		if err != nil {
			return err
		}
		m, template, err := r.memberChange(sp, memberID, b)
		if err != nil {
			return err
		}
		if err := r.setMember(ctx, sp, m, template); err != nil {
			return err
		}
		out = r.membersDTO(sp)
		return nil
	})
	return out, err
}

// memberChange checks a change of a member of sp: the employee, the role of a space ("" — remove), the owner of the
// business, the own role of the lead and the delegation (a lead gives only the rights he has).
func (r *req) memberChange(sp *space, memberID uuid.UUID, b kapi.KnowledgeSpaceMemberChange) (*member, string, error) {
	m := r.w.member[memberID]
	if m == nil {
		return nil, "", failed("Выберите сотрудника")
	}
	template := ""
	if b.Role != nil && *b.Role != kapi.KnowledgeSpaceMemberChangeRoleLessThannil {
		template = string(*b.Role)
		if !isSpaceTemplate(template) {
			return nil, "", failed("Выберите роль пространства")
		}
	}
	switch {
	case m.owner:
		return nil, "", failed("Владелец бизнеса видит всё без назначения")
	case m.id == r.me.id && template != templateLead && !r.me.owner:
		return nil, "", failed("Свою роль руководителя снимает владелец бизнеса")
	}
	if template != "" && !r.me.owner && !r.w.holdsAll(r.me, sp, spaceRoleDefs[template].actions) {
		return nil, "", problem.New(codeDelegation, textDelegation)
	}
	return m, template, nil
}

// holdsAll reports whether the roles of m in sp carry every action.
func (w *world) holdsAll(m *member, sp *space, actions []string) bool {
	var held []string
	for _, g := range w.grants[m.id] {
		if g.kind == scopeSpace && g.ref == sp.id {
			held = append(held, g.role.actions...)
		}
	}
	for _, a := range actions {
		if !slices.Contains(held, a) {
			return false
		}
	}
	return true
}

// setMember revokes the roles of m in sp and assigns the role of template ("" — none).
func (r *req) setMember(ctx context.Context, sp *space, m *member, template string) error {
	if err := r.wr.exec(ctx, "revoke", `update access.role_assignments set state = 'revoked', revoked_at = $4
		where principal_kind = 'person' and principal_id = $1 and scope_kind = 'space' and scope_ref = $2 and state = $3`,
		m.id, sp.id, "active", r.now); err != nil {
		return err
	}
	r.w.grants[m.id] = slices.DeleteFunc(r.w.grants[m.id], func(g grant) bool {
		return g.kind == scopeSpace && g.ref == sp.id && g.group == uuid.Nil
	})
	if template != "" {
		x, err := r.spaceRole(ctx, template)
		if err != nil {
			return err
		}
		if err := r.grantRole(ctx, m.id, x, scopeSpace, sp.id, assignment{reason: "knowledge.member"}); err != nil {
			return err
		}
	}
	diff := map[string]any{"memberId": m.id, "role": template}
	if err := r.record(ctx, "knowledge.member.changed", aggSpace, sp.id, diff); err != nil {
		return err
	}
	if _, err := r.publish(ctx, "access.assignment.changed", aggSpace, sp.id, diff); err != nil {
		return err
	}
	return r.bump(ctx, []uuid.UUID{m.id})
}
