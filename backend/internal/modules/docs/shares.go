package docs

import (
	"context"
	"fmt"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// entryKey identifies the target of an entry: two entries of one target are one entry (entryKey of the prototype).
func entryKey(e entry) string {
	return e.who + ":" + e.ref.String() + ":" + e.unit.String() + ":" + e.obj.String()
}

// textDelegation is the answer of an entry above the level of the member.
func textDelegation(l level) string {
	return "Нельзя выдать «" + l.label() + "»: это выше вашего уровня"
}

// entries checks the entries of a list the member gives and turns them into the rows to store: every target exists,
// no target twice, the term has not passed, the level is not above max (delegation_exceeds_grant). Entries the list
// already holds keep their author and time.
func (r *req) entries(in []dapi.DocShareEntry, limit level, current []entry) ([]entry, error) {
	known := map[string]entry{}
	for _, e := range current {
		known[entryKey(e)+":"+e.level.code()] = e
	}
	seen := map[string]bool{}
	out := make([]entry, 0, len(in))
	for i, x := range in {
		field := fmt.Sprintf("entries[%d]", i)
		e, err := r.entryOf(field, x)
		if err != nil {
			return nil, err
		}
		key := entryKey(e)
		if seen[key] {
			return nil, invalid(field, "Эта запись уже есть в списке")
		}
		seen[key] = true
		if e.level > limit {
			return nil, problem.New(codeDelegation, textDelegation(e.level))
		}
		if old, ok := known[key+":"+e.level.code()]; ok {
			e.by, e.at = old.by, old.at
		}
		out = append(out, e)
	}
	// an entry above the level of the member stays as it is: he can neither lower nor remove it
	for _, old := range current {
		if old.level > limit && !slices.ContainsFunc(out, func(e entry) bool { return entryKey(e) == entryKey(old) && e.level == old.level }) {
			return nil, problem.New(codeDelegation, textDelegation(old.level))
		}
	}
	return out, nil
}

// entryOf turns an entry of the request into a row: the level, the target, the term (not in the past).
func (r *req) entryOf(field string, x dapi.DocShareEntry) (entry, error) {
	l, ok := parseLevel(string(x.Level))
	if !ok {
		return entry{}, invalid(field+".level", "Выберите уровень доступа")
	}
	e := entry{who: string(x.Who), level: l, by: r.me.id, at: r.now}
	if x.RefId != nil {
		e.ref = *x.RefId
	}
	if x.OrgUnitId != nil {
		e.unit = *x.OrgUnitId
	}
	if x.Object != nil {
		e.obj = x.Object.EntityId
	}
	if x.Until != nil {
		day := dayOf(x.Until.Time)
		if day.Before(r.w.today) {
			return entry{}, invalid(field+".until", "Срок доступа уже прошёл")
		}
		e.until = &day
	}
	return e, r.checkTarget(field, e)
}

// checkTarget checks that the target of an entry exists in the organization.
func (r *req) checkTarget(field string, e entry) error {
	switch e.who {
	case whoAll:
		return nil
	case whoMember:
		if m := r.w.member[e.ref]; m == nil || m.status == memberBlocked {
			return invalid(field+".refId", "Сотрудник не найден")
		}
	case whoGroup:
		if r.w.groups[e.ref] == nil {
			return invalid(field+".refId", "Группа не найдена")
		}
	case whoRole:
		if r.w.roles[e.ref] == nil {
			return invalid(field+".refId", "Роль не найдена")
		}
		if e.unit != uuid.Nil && r.w.units[e.unit] == nil {
			return invalid(field+".orgUnitId", "Подразделение не найдено")
		}
	case whoRelation:
		if e.obj == uuid.Nil {
			return invalid(field+".object", "Выберите объект")
		}
	default:
		return invalid(field+".who", "Выберите, кому открыть доступ")
	}
	return nil
}

// replaceShares stores the list of a folder or a document: the rows of the target are replaced by entries.
func (r *req) replaceShares(ctx context.Context, folder bool, id uuid.UUID, entries []entry) error {
	col := "document_id"
	if folder {
		col = "folder_id"
	}
	if _, err := r.tx.Exec(ctx, `delete from docs.shares where `+col+` = $1`, id); err != nil {
		return fmt.Errorf("docs: shares: %w", err)
	}
	batch := &pgx.Batch{}
	for _, e := range entries {
		var obj any
		if e.obj != uuid.Nil {
			obj = fmt.Sprintf(`{"moduleKey":"repairs","entityType":"object","entityId":"%s"}`, e.obj)
		}
		var until any
		if e.until != nil {
			until = dayEnd(*e.until)
		}
		batch.Queue(`insert into docs.shares (`+col+`, who, ref_id, org_unit_id, object_ref, level, until, by_id, at)
			values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`, id, e.who, nullID(e.ref), nullID(e.unit), obj, e.level.code(), until, nullID(e.by), e.at)
	}
	res := r.tx.SendBatch(ctx, batch)
	for range entries {
		if _, err := res.Exec(); err != nil {
			_ = res.Close()
			return fmt.Errorf("docs: share entry: %w", err)
		}
	}
	if err := res.Close(); err != nil {
		return fmt.Errorf("docs: shares: %w", err)
	}
	r.w.shares[id] = entries
	return nil
}

// shareMax is the highest level the member gives in a document.
func shareMax(rt rights) level {
	if rt.owner {
		return levelManage
	}
	return rt.maxGrant
}

// SetShares replaces the mode and the list of a document (setDocShares — docShare); dryRun answers the impact only.
func (s *Service) SetShares(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b dapi.DocSharesSet) (dapi.DocSharesResult, error) {
	var out dapi.DocSharesResult
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if rt.onlyVersion > 0 || !rt.share {
			return forbidden(textNeedShare)
		}
		mode := string(b.Mode)
		if mode != d.mode && !rt.manage && !rt.owner {
			return forbidden("«Только выбранные» включает тот, кто управляет доступом")
		}
		entries, err := r.entries(b.Entries, shareMax(rt), r.w.shares[d.id])
		if err != nil {
			return err
		}
		imp := r.w.impactOfShare(d, mode, entries)
		out.Impact = r.impactDTO(imp)
		if b.DryRun == nil || !*b.DryRun {
			if err := stale(ifMatch, d.revision); err != nil {
				return err
			}
			if err := r.applyShares(ctx, d, mode, entries, imp); err != nil {
				return err
			}
			out.Applied = true
		}
		sh := r.shares(d)
		out.Shares = &sh
		return nil
	})
	return out, err
}

// applyShares stores the new mode and list of a document and tells who gained access.
func (r *req) applyShares(ctx context.Context, d *document, mode string, entries []entry, imp impact) error {
	if err := r.replaceShares(ctx, false, d.id, entries); err != nil {
		return err
	}
	if _, err := r.tx.Exec(ctx, `update docs.documents set mode = $2 where id = $1`, d.id, mode); err != nil {
		return fmt.Errorf("docs: mode: %w", err)
	}
	d.mode = mode
	if err := r.touch(ctx, d); err != nil {
		return err
	}
	return r.afterShare(ctx, d, imp, len(entries))
}

// afterShare publishes the event, the notifications «Вам открыт доступ» and the audit of a change of access.
func (r *req) afterShare(ctx context.Context, d *document, imp impact, n int) error {
	ev, err := r.publish(ctx, "docs.document.shared", aggDocument, d.id, map[string]any{keyEntries: n, keyMode: d.mode})
	if err != nil {
		return err
	}
	var gained []uuid.UUID
	for _, p := range slices.Concat(imp.gain, imp.up) {
		gained = append(gained, p.member.id)
	}
	if err := r.notify(ctx, "docs.access.granted", "Вам открыт доступ к документу «"+d.title+"»", d.id, ev, gained); err != nil {
		return err
	}
	return r.record(ctx, "docs.document.share", d.id, fmt.Sprintf("Доступ изменён: записей %d, режим «%s»", n, modeText(d.mode)), true,
		map[string]any{keyEntries: n, keyMode: d.mode, "gain": len(imp.gain), "lose": len(imp.lose)})
}

func modeText(mode string) string {
	if mode == modeListed {
		return "Только выбранные"
	}
	return "Как у папки и свои"
}

// withMember is the list with the member at least at the level l: a new entry, or the raised one.
func (r *req) withMember(list []entry, target uuid.UUID, l level) []entry {
	list = slices.Clone(list)
	at := slices.IndexFunc(list, func(e entry) bool { return e.who == whoMember && e.ref == target })
	switch {
	case at >= 0 && list[at].level >= l:
	case at >= 0:
		list[at].level, list[at].by, list[at].at = l, r.me.id, r.now
	default:
		list = append(list, entry{who: whoMember, ref: target, level: l, by: r.me.id, at: r.now})
	}
	return list
}

// Grant gives a member the access «Комментирует» from a mention (grantDocAccess — docGrant): a member entry of the
// list of the document, not above the level of the member.
func (s *Service) Grant(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocGrantCreate) (dapi.DocShares, error) {
	var out dapi.DocShares
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if rt.onlyVersion > 0 || !rt.share {
			return forbidden(textNeedShare)
		}
		l, ok := parseLevel(string(b.Level))
		if !ok {
			return invalid("level", "Выберите уровень доступа")
		}
		if l > shareMax(rt) {
			return problem.New(codeDelegation, textDelegation(l))
		}
		target := r.w.member[b.MemberId]
		if target == nil || target.status == memberBlocked {
			return invalid("memberId", "Сотрудник не найден")
		}
		list := r.withMember(r.w.shares[id], target.id, l)
		imp := r.w.impactOfShare(d, d.mode, list)
		if err := r.replaceShares(ctx, false, id, list); err != nil {
			return err
		}
		if err := r.touch(ctx, d); err != nil {
			return err
		}
		if err := r.afterGrant(ctx, d, target, l, len(imp.gain)); err != nil {
			return err
		}
		out = r.shares(d)
		return nil
	})
	return out, err
}

// afterGrant publishes the event, notifies the member and writes the audit of an access given from a mention.
func (r *req) afterGrant(ctx context.Context, d *document, target *member, l level, gained int) error {
	ev, err := r.publish(ctx, "docs.access.granted", aggDocument, d.id, map[string]any{"memberId": target.id, "level": l.code()})
	if err != nil {
		return err
	}
	if err := r.notify(ctx, "docs.access.granted", "Вам открыт доступ к документу «"+d.title+"»", d.id, ev, []uuid.UUID{target.id}); err != nil {
		return err
	}
	return r.record(ctx, "docs.document.grant", d.id, "Доступ «"+l.label()+"»: "+target.name, true, map[string]any{"memberId": target.id, "gain": gained})
}
