package chats

import (
	"context"
	"encoding/json"
	"slices"
	"strings"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the settings and of the roster (commands-admin.ts).
const (
	textMembersRight  = "Состав меняют владелец чата и модераторы с правом «Чаты · Решать»"
	textSettingsRight = "Менять настройки хранения может владелец чата"
	textFinanceLabel  = "Метку «Финансы» ставит владелец бизнеса"
)

// CreateDirectChat starts or opens the personal chat with an employee: a pair is one chat.
func (s *Service) CreateDirectChat(ctx context.Context, tc tenantctx.TenantContext, b api.ChatDirectCreate) (api.Chat, bool, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.Chat
	created := false
	err := s.run(ctx, tc, true, func(r *req) error {
		if b.MemberId == r.me {
			return failed("Выберите собеседника — не себя")
		}
		var (
			home       uuid.UUID
			membership *uuid.UUID
			archived   bool
		)
		err := r.tx.QueryRow(ctx, `select home_unit_id, membership_id, archived_at is not null from people.person_profiles where id = $1`, b.MemberId).
			Scan(&home, &membership, &archived)
		if noRows(err) {
			return notFound("Сотрудник не найден")
		}
		if err != nil {
			return store("peer", err)
		}
		if st, err := r.membership(ctx, membership); err != nil {
			return err
		} else if archived || st.Status != litActive && st.Status != "invited" {
			return failed("Сотрудник больше не работает: личный чат с ним не начать")
		}
		if !r.canIn(ctx, "chat.direct", home) {
			return coded(codeOutOfScope, "Собеседник вне вашей области")
		}
		lo, hi := r.me, b.MemberId
		if strings.Compare(lo.String(), hi.String()) > 0 {
			lo, hi = hi, lo
		}
		if _, err := r.tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, "chat.direct:"+lo.String()+":"+hi.String()); err != nil {
			return store("lock", err)
		}
		var id uuid.UUID
		err = r.tx.QueryRow(ctx, `select c.id from chat.chats c join chat.chat_members a on a.chat_id = c.id and a.member_id = $1
			join chat.chat_members b on b.chat_id = c.id and b.member_id = $2 where c.kind = 'direct' limit 1`, r.me, b.MemberId).Scan(&id)
		switch {
		case err == nil:
		case noRows(err):
			id = uuid.New()
			if _, err := r.tx.Exec(ctx, `insert into chat.chats (id, kind, title, status, created_by, created_at, updated_at)
				values ($1, 'direct', 'Личный чат', 'active', $2, $3, $3)`, id, r.me, r.now); err != nil {
				return store("direct chat", err)
			}
			for _, m := range []uuid.UUID{r.me, b.MemberId} {
				if _, err := r.tx.Exec(ctx, `insert into chat.chat_members (chat_id, member_id, state, role, via, joined_at)
					values ($1, $2, 'in', 'member', $3, $4)`, id, m, viaDirect, r.now); err != nil {
					return store("direct member", err)
				}
			}
			created = true
			if err := r.publish(ctx, "chat.chat.created", "chat.chat", id, map[string]any{litChatID: id, litKind: "direct"}); err != nil {
				return err
			}
		default:
			return store("direct chat", err)
		}
		a, err := r.open(ctx, id, false)
		if err != nil {
			return err
		}
		out, err = r.chatDTO(ctx, a)
		return err
	})
	return out, created, err
}

// UpdateChat renames a chat or changes its label, history and overrides inside the bounds of the policy.
func (s *Service) UpdateChat(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b api.ChatPatch) (api.Chat, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.Chat
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, id, true)
		if err != nil {
			return err
		}
		if !a.Can.Settings {
			return forbidden(textSettingsRight)
		}
		c := a.Chat
		if err := checkRevision(ifMatch, c.Revision); err != nil {
			return err
		}
		var notes []string
		recompute := false
		if b.Title != nil {
			t := strings.TrimSpace(*b.Title)
			if len([]rune(t)) < 3 {
				return failed("Название — не короче 3 символов")
			}
			if t != c.Title {
				notes = append(notes, "Название: «"+t+"»")
				c.Title = t
			}
		}
		if b.Label != nil {
			if *b.Label == litFinance && !r.tc.Owner {
				return forbidden(textFinanceLabel)
			}
			if l := string(*b.Label); l != c.Sensitivity {
				c.Sensitivity, recompute = l, true
				notes = append(notes, "Метка изменена")
			}
		}
		if b.History != nil {
			c.History = string(*b.History)
		}
		if b.Overrides != nil && b.Overrides.OnFull != nil {
			mode := string(*b.Overrides.OnFull)
			if _, ok := fullLabels[mode]; !ok {
				return failed("Неизвестный режим")
			}
			if mode == "archive" {
				return failed("Режим «Переносить в архив» появится позже")
			}
			c.Overrides.OnFull = mode
			notes = append(notes, "При заполнении: "+fullLabels[mode])
		}
		if _, err := r.tx.Exec(ctx, `update chat.chats set title = $2, sensitivity = $3, history = $4, overrides = $5, revision = revision + 1,
			updated_at = $6 where id = $1`, c.ID, c.Title, c.Sensitivity, c.History, mustJSON(c.Overrides), r.now); err != nil {
			return store(litChat, err)
		}
		c.Revision++
		for _, n := range notes {
			if err := r.journal(ctx, c.ID, n, nil); err != nil {
				return err
			}
		}
		if recompute {
			im, err := r.recompute(ctx, c)
			if err != nil {
				return err
			}
			if err := r.memberEvents(ctx, c.ID, im.Joined, im.Lose); err != nil {
				return err
			}
		}
		if err := r.changed(ctx, c); err != nil {
			return err
		}
		fresh, err := r.open(ctx, c.ID, false)
		if err != nil {
			return err
		}
		out, err = r.chatDTO(ctx, fresh)
		return err
	})
	return out, err
}

// ArchiveChat closes a chat for writing: it stays readable, searchable and exportable.
func (s *Service) ArchiveChat(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.Chat, error) {
	var out api.Chat
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, id, true)
		if err != nil {
			return err
		}
		if !a.Can.Settings {
			return forbidden(textSettingsRight)
		}
		if a.Chat.Status == litArchived {
			return coded(codeTransition, "Чат уже в архиве")
		}
		if _, err := r.tx.Exec(ctx, `update chat.chats set status = 'archived', archived_at = $2, revision = revision + 1, updated_at = $2 where id = $1`,
			id, r.now); err != nil {
			return store("archive", err)
		}
		name, err := r.nameOf(ctx, r.me)
		if err != nil {
			return err
		}
		if err := r.journal(ctx, id, "Чат отправлен в архив · "+name, nil); err != nil {
			return err
		}
		if err := r.publish(ctx, "chat.chat.archived", "chat.chat", id, map[string]any{litChatID: id}); err != nil {
			return err
		}
		fresh, err := r.open(ctx, id, false)
		if err != nil {
			return err
		}
		out, err = r.chatDTO(ctx, fresh)
		return err
	})
	return out, err
}

// Members lists the people of the chat: in, waiting for the invitation, out with the reason.
func (s *Service) Members(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.ChatMemberList, error) {
	var out api.ChatMemberList
	err := s.run(ctx, tc, false, func(r *req) error {
		a, err := r.open(ctx, id, false)
		if err != nil {
			return err
		}
		if !a.Can.Members {
			return forbidden(textMembersRight)
		}
		rows, err := r.tx.Query(ctx, `select m.member_id, m.state, m.role, m.via, m.why, p.full_name from chat.chat_members m
			join people.person_profiles p on p.id = m.member_id where m.chat_id = $1
			order by case m.state when 'in' then 0 when 'pending' then 1 else 2 end, p.full_name`, id)
		if err != nil {
			return store("members", err)
		}
		defer rows.Close()
		out.Items = []api.ChatMember{}
		for rows.Next() {
			var (
				m              api.ChatMember
				role, via, why *string
				state, full    string
			)
			if err := rows.Scan(&m.Member.MemberId, &state, &role, &via, &why, &full); err != nil {
				return store("members", err)
			}
			m.Member.DisplayName, m.State, m.Via, m.Why = full, api.ChatMemberState(state), via, why
			if role != nil {
				m.Role = new(api.ChatMemberRole(*role))
			}
			switch state {
			case "in":
				out.Counts.In++
			case litPending:
				out.Counts.Pending++
			default:
				out.Counts.Out++
			}
			out.Items = append(out.Items, m)
		}
		return rows.Err()
	})
	return out, err
}

func sourceDTO(s srcRec) api.ChatSource {
	out := api.ChatSource{Who: api.ChatSourceWho(s.Who), Role: api.ChatSourceRole(s.Role), RefId: s.Ref, OrgUnitId: s.Unit, TripId: s.Trip}
	if s.Object != nil {
		out.Object = &api.ObjectRef{ModuleKey: s.Object.ModuleKey, EntityType: s.Object.EntityType, EntityId: s.Object.EntityID}
	}
	return out
}

// Sources reads the sources of the roster with the revision of the chat.
func (s *Service) Sources(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.ChatSources, error) {
	var out api.ChatSources
	err := s.run(ctx, tc, false, func(r *req) error {
		a, err := r.open(ctx, id, false)
		if err != nil {
			return err
		}
		if !a.Can.Members {
			return forbidden(textMembersRight)
		}
		list, err := r.loadSources(ctx, id)
		if err != nil {
			return err
		}
		out = api.ChatSources{Items: make([]api.ChatSource, 0, len(list)), Revision: int64(a.Chat.Revision)}
		for _, x := range list {
			out.Items = append(out.Items, sourceDTO(x))
		}
		return nil
	})
	return out, err
}

// ReplaceSources replaces the sources, recomputes the roster and tells who joined and who left; with dryRun nothing is
// written. The owner of the chat made at its creation stays unless the new list names an owner.
func (s *Service) ReplaceSources(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b api.ChatSourcesReplace) (api.ChatSourcesResult, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatSourcesResult
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, id, true)
		if err != nil {
			return err
		}
		if !a.Can.Members {
			return forbidden(textMembersRight)
		}
		c := a.Chat
		if err := checkRevision(ifMatch, c.Revision); err != nil {
			return err
		}
		srcs, err := r.sourcesFrom(b.Sources, c.Unit)
		if err != nil {
			return err
		}
		if c.CreatedBy != nil && !slices.ContainsFunc(srcs, func(x srcRec) bool { return x.Role == RoleOwner && x.Who == litMember }) {
			var creatorOwner bool
			if err := r.tx.QueryRow(ctx, `select exists (select 1 from chat.chat_sources where chat_id = $1 and who = 'member' and ref_id = $2 and role = 'owner')`,
				c.ID, *c.CreatedBy).Scan(&creatorOwner); err != nil {
				return store("owner source", err)
			}
			if creatorOwner {
				srcs = append(srcs, srcRec{Who: litMember, Ref: c.CreatedBy, Role: RoleOwner})
			}
		}
		before, err := r.current(ctx, c.ID)
		if err != nil {
			return err
		}
		rows, im, err := r.previewRoster(ctx, c, srcs, before)
		if err != nil {
			return err
		}
		dto, err := r.impactDTO(ctx, im)
		if err != nil {
			return err
		}
		if b.DryRun != nil && *b.DryRun {
			out = api.ChatSourcesResult{Applied: false, Impact: dto}
			return nil
		}
		if err := outOfScope(im); err != nil {
			return err
		}
		if err := r.saveSources(ctx, c.ID, srcs); err != nil {
			return err
		}
		if err := r.reconcile(ctx, c.ID, rows); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update chat.chats set revision = revision + 1, updated_at = $2 where id = $1`, c.ID, r.now); err != nil {
			return store(litChat, err)
		}
		c.Revision++
		var ids []uuid.UUID
		ids = append(ids, im.Joined...)
		ids = append(ids, im.Lose...)
		names, err := r.names(ctx, append(ids, r.me))
		if err != nil {
			return err
		}
		var gain, lose []string
		for _, p := range im.Joined {
			gain = append(gain, names[p])
		}
		for _, p := range im.Lose {
			lose = append(lose, names[p])
		}
		slices.Sort(gain)
		slices.Sort(lose)
		if _, err := r.service(ctx, c, chatCard(litGroup, "neutral", "Состав изменён · "+names[r.me], MembersChangedText(gain, lose))); err != nil {
			return err
		}
		if err := r.journal(ctx, c.ID, "Состав изменён · "+names[r.me], nil); err != nil {
			return err
		}
		if err := r.record(ctx, "chat.members.replace", "chat.chat", c.ID, map[string]any{"joined": len(im.Joined), "left": len(im.Lose)}); err != nil {
			return err
		}
		if err := r.memberEvents(ctx, c.ID, im.Joined, im.Lose); err != nil {
			return err
		}
		if err := r.changed(ctx, c); err != nil {
			return err
		}
		list := make([]api.ChatSource, 0, len(srcs))
		for _, x := range srcs {
			list = append(list, sourceDTO(x))
		}
		out = api.ChatSourcesResult{Applied: true, Impact: dto, Sources: &api.ChatSources{Items: list, Revision: int64(c.Revision)}}
		return nil
	})
	return out, err
}

// AccessExplanation tells why a member is (not) in the chat: the chain roster → module → function → invitation.
func (s *Service) AccessExplanation(ctx context.Context, tc tenantctx.TenantContext, id, member uuid.UUID) (api.ChatAccessExplanation, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatAccessExplanation
	err := s.run(ctx, tc, false, func(r *req) error {
		a, err := r.open(ctx, id, false)
		if err != nil {
			return err
		}
		if !a.Can.Members {
			return forbidden(textMembersRight)
		}
		names, err := r.names(ctx, []uuid.UUID{member})
		if err != nil {
			return err
		}
		if _, ok := names[member]; !ok {
			return notFound("Сотрудник не найден")
		}
		var (
			state, role, via, why *string
		)
		err = r.tx.QueryRow(ctx, `select state, role, via, why from chat.chat_members where chat_id = $1 and member_id = $2`, id, member).
			Scan(&state, &role, &via, &why)
		if err != nil && !noRows(err) {
			return store(litMember, err)
		}
		ok := deref(state) == "in"
		out = api.ChatAccessExplanation{Member: memberRef(names, member), Ok: ok, Chain: []api.ChatChainStep{}}
		switch deref(state) {
		case "in":
			out.Reason = new(api.ChatAccessExplanationReason("none"))
		case litPending:
			out.Reason = new(api.ChatAccessExplanationReason("invited"))
		case litOut:
			out.Reason = new(explainReason(deref(why)))
		default:
			out.Reason = new(api.ChatAccessExplanationReason("not_member"))
			why = new("Не входит в состав чата")
		}
		out.Why = why
		if role != nil {
			out.Role = new(api.ChatAccessExplanationRole(*role))
		}
		roster := deref(via)
		if roster == "" {
			roster = "Ни один источник состава не подходит"
		}
		module := deref(why) != whyNoModule
		fn := deref(why) != whyFunction
		out.Chain = []api.ChatChainStep{{Title: "Состав чата", Detail: roster, Ok: role != nil || deref(state) == litPending || ok},
			{Title: "Модуль «Чаты» в ролях", Detail: boolText(module, "Есть право «Чаты · Просматривать»", "Ни в одной роли нет модуля «Чаты»"), Ok: module},
			{Title: "Функция", Detail: boolText(fn, "Ограничений нет", "Водитель: финансовые чаты закрыты"), Ok: fn}}
		return nil
	})
	return out, err
}

func boolText(ok bool, yes, no string) string {
	if ok {
		return yes
	}
	return no
}

func explainReason(why string) api.ChatAccessExplanationReason {
	switch why {
	case whyBlocked, whyEnded:
		return "blocked"
	case whyNoModule:
		return "no_module"
	case whyFunction:
		return "function"
	}
	return "not_member"
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
