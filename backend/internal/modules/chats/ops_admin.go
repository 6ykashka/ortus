package chats

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const textOwnerOnly = "Политики, удержания и журнал настраивает владелец бизнеса"

func rng(b bound) api.ChatRange { return api.ChatRange{Min: int64(b.Min), Max: int64(b.Max)} }

func apiBounds() api.ChatPolicyBounds {
	return api.ChatPolicyBounds{TextYears: rng(Bounds.TextYears), FilesDays: rng(Bounds.FilesDays), VoiceDays: rng(Bounds.VoiceDays),
		ReceiptsDays: rng(Bounds.ReceiptsDays), DeletedDays: rng(Bounds.DeletedDays), MaxFileMb: rng(Bounds.MaxFileMb)}
}

// Policies lists the policies of the five kinds with the bounds of the organization.
func (s *Service) Policies(ctx context.Context, tc tenantctx.TenantContext) (api.ChatKindPolicyList, error) {
	out := api.ChatKindPolicyList{Items: []api.ChatKindPolicy{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		if !r.tc.Owner {
			return forbidden(textOwnerOnly)
		}
		for _, k := range Kinds {
			p, rev, err := r.kindPolicy(ctx, k)
			if err != nil {
				return err
			}
			out.Items = append(out.Items, api.ChatKindPolicy{Kind: api.ChatKindPolicyKind(k), Policy: apiPolicy(p), Bounds: apiBounds(), Revision: int64(rev)})
		}
		return nil
	})
	return out, err
}

func asInt(v *int64) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

func str[T ~string](v *T) *string {
	if v == nil {
		return nil
	}
	s := string(*v)
	return &s
}

// UpdatePolicy changes the policy of a kind inside the bounds of the organization; the owner of the business only. With
// dryRun nothing is saved: the answer lists what would change; otherwise every chat of the kind gets a service message.
func (s *Service) UpdatePolicy(ctx context.Context, tc tenantctx.TenantContext, kind string, b api.ChatPolicyUpdate) (api.ChatPolicyUpdateResult, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatPolicyUpdateResult
	err := s.run(ctx, tc, true, func(r *req) error {
		if !r.tc.Owner {
			return forbidden("Политики чатов меняет владелец бизнеса")
		}
		k := Kind(kind)
		if !k.Valid() {
			return failed("Неизвестный вид чата")
		}
		cur, rev, err := r.kindPolicy(ctx, k)
		if err != nil {
			return err
		}
		p := b.Patch
		next, err := cur.Apply(k, PolicyPatch{TextYears: asInt(p.TextYears), FilesDays: asInt(p.FilesDays), VoiceDays: asInt(p.VoiceDays),
			ReceiptsDays: asInt(p.ReceiptsDays), DeletedDays: asInt(p.DeletedDays), MaxFileMb: asInt(p.MaxFileMb), AfterCloseDays: asInt(p.AfterCloseDays),
			Receipts: str(p.Receipts), Edit: str(p.Edit), Temp: str(p.Temp), Forward: str(p.Forward), OnFull: str(p.OnFull), PdnMask: p.PdnMask,
			QuotaMb: asInt(p.QuotaMb), QuotaSet: p.QuotaMb != nil})
		if err != nil {
			return err
		}
		var impact PolicyImpact
		if err := r.tx.QueryRow(ctx, `select count(*) from chat.chats where kind = $1`, kind).Scan(&impact.Chats); err != nil {
			return store("chats of kind", err)
		}
		if err := r.tx.QueryRow(ctx, `select count(distinct m.member_id) from chat.chat_members m join chat.chats c on c.id = m.chat_id
			where c.kind = $1 and m.state = 'in'`, kind).Scan(&impact.People); err != nil {
			return store("people of kind", err)
		}
		cutoff := r.now.AddDate(0, 0, -next.FilesDays)
		if err := r.tx.QueryRow(ctx, `select coalesce(sum(a.size_bytes), 0) from chat.attachments a join chat.messages m on m.id = a.message_id
			join chat.chats c on c.id = m.chat_id where c.kind = $1 and a.saved_to is null and a.gone_at is null and a.created_at < $2`, kind, cutoff).
			Scan(&impact.OldFilesBytes); err != nil {
			return store("old files", err)
		}
		notes := PolicyNotes(k, cur, next, impact)
		dto := api.ChatKindPolicy{Kind: api.ChatKindPolicyKind(k), Policy: apiPolicy(next), Bounds: apiBounds(), Revision: int64(rev)}
		if b.DryRun != nil && *b.DryRun {
			out = api.ChatPolicyUpdateResult{Applied: false, Policy: dto, Notes: notes}
			return nil
		}
		raw, _ := json.Marshal(next)
		if err := r.tx.QueryRow(ctx, `insert into chat.policies (chat_kind, policy, updated_by, updated_at, revision) values ($1, $2, $3, $4, $5)
			on conflict (chat_kind) do update set policy = excluded.policy, updated_by = excluded.updated_by, updated_at = excluded.updated_at,
			  revision = excluded.revision returning revision`, kind, raw, r.me, r.now, rev+1).Scan(&dto.Revision); err != nil {
			return store("policy", err)
		}
		r.kinds[k] = next
		name, err := r.nameOf(ctx, r.me)
		if err != nil {
			return err
		}
		rows, err := r.tx.Query(ctx, `select `+chatCols+` from chat.chats c where c.kind = $1 order by c.id for update of c`, kind)
		if err != nil {
			return store("chats of kind", err)
		}
		var chats []*chatRec
		for rows.Next() {
			c, err := scanChat(rows)
			if err != nil {
				rows.Close()
				return store(litChat, err)
			}
			chats = append(chats, c)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return store("chats of kind", err)
		}
		for _, c := range chats {
			if _, err := r.service(ctx, c, chatCard("policy", "neutral", "Политика вида изменена · "+name, strings.Join(notes[1:], " · "))); err != nil {
				return err
			}
			if err := r.changed(ctx, c); err != nil {
				return err
			}
		}
		if err := r.record(ctx, "chat.policy.update", "chat.policy", uuid.Nil, map[string]any{litKind: kind, "chats": len(chats)}); err != nil {
			return err
		}
		out = api.ChatPolicyUpdateResult{Applied: true, Policy: dto, Notes: notes}
		return nil
	})
	return out, err
}

// activeHolds reads the holds that protect messages now.
func (r *req) activeHolds(ctx context.Context) ([]Hold, error) {
	rows, err := r.tx.Query(ctx, `select id, scope, coalesce(chat_id, '00000000-0000-0000-0000-000000000000'::uuid), member_ids, period_from, period_to,
		until, status = 'active', reason, created_by, created_at from chat.holds where status = 'active'`)
	if err != nil {
		return nil, store("holds", err)
	}
	return pgx.CollectRows(rows, scanHold)
}

func scanHold(row pgx.CollectableRow) (Hold, error) {
	var (
		h     Hold
		until *time.Time
	)
	err := row.Scan(&h.ID, &h.Scope, &h.ChatID, &h.MemberIDs, &h.From, &h.To, &until, &h.Active, &h.Reason, &h.CreatedBy, &h.CreatedAt)
	h.Until = until
	return h, err
}

// coveringHold is the first hold that protects the message, nil if none.
func coveringHold(holds []Hold, chat uuid.UUID, m msgRec, now time.Time) *Hold {
	author := deref0(m.Author)
	for i := range holds {
		if holds[i].Covers(chat, author, m.CreatedAt, now) {
			return &holds[i]
		}
	}
	return nil
}

func untilText(t *time.Time) string {
	if t == nil {
		return ""
	}
	return " до " + t.Format("02.01.2006")
}

func holdPeriod(h Hold) string {
	switch h.Scope {
	case litChat:
		return "Весь чат"
	case litMember:
		return pluralN(len(h.MemberIDs), "сотрудник", "сотрудника", "сотрудников")
	}
	f := func(t *time.Time, open string) string {
		if t == nil {
			return open
		}
		return t.UTC().Format("02.01")
	}
	return f(h.From, "…") + "–" + f(h.To, "…")
}

func (r *req) holdDTO(ctx context.Context, h Hold, status string) (api.ChatHold, error) {
	out := api.ChatHold{Id: h.ID, Scope: api.ChatHoldScope(h.Scope), Reason: h.Reason, Period: holdPeriod(h), CreatedAt: h.CreatedAt,
		Status: api.ChatHoldStatus(status), From: h.From, To: h.To}
	if h.ChatID != uuid.Nil {
		out.ChatId = new(h.ChatID)
	}
	if len(h.MemberIDs) > 0 {
		ids := h.MemberIDs
		out.MemberIds = &ids
	}
	if h.Until != nil {
		out.Until = dateOf(*h.Until)
	}
	if h.CreatedBy != nil {
		n, err := r.nameOf(ctx, *h.CreatedBy)
		if err != nil {
			return out, err
		}
		out.CreatedByDisplayName = n
	}
	var err error
	switch h.Scope {
	case litChat:
		err = r.tx.QueryRow(ctx, `select count(*) from chat.attachments a join chat.messages m on m.id = a.message_id where m.chat_id = $1`, h.ChatID).Scan(&out.Files)
	case litMember:
		err = r.tx.QueryRow(ctx, `select count(*) from chat.attachments a join chat.messages m on m.id = a.message_id where m.author_id = any($1)`, h.MemberIDs).Scan(&out.Files)
	default:
		err = r.tx.QueryRow(ctx, `select count(*) from chat.attachments a join chat.messages m on m.id = a.message_id
			where ($1::timestamptz is null or m.created_at >= $1) and ($2::timestamptz is null or m.created_at <= $2)`, h.From, h.To).Scan(&out.Files)
	}
	if err != nil {
		return out, store("hold files", err)
	}
	return out, nil
}

// Holds lists the holds of the organization, the active ones first.
func (s *Service) Holds(ctx context.Context, tc tenantctx.TenantContext) (api.ChatHoldList, error) {
	out := api.ChatHoldList{Items: []api.ChatHold{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		if !r.tc.Owner {
			return forbidden(textOwnerOnly)
		}
		rows, err := r.tx.Query(ctx, `select id, scope, coalesce(chat_id, '00000000-0000-0000-0000-000000000000'::uuid), member_ids, period_from, period_to,
			until, status = 'active', reason, created_by, created_at from chat.holds order by (status = 'active') desc, created_at desc limit 200`)
		if err != nil {
			return store("holds", err)
		}
		list, err := pgx.CollectRows(rows, scanHold)
		if err != nil {
			return store("holds", err)
		}
		for _, h := range list {
			status := "released"
			if h.Active {
				status = litActive
			}
			dto, err := r.holdDTO(ctx, h, status)
			if err != nil {
				return err
			}
			out.Items = append(out.Items, dto)
		}
		return nil
	})
	return out, err
}

// CreateHold puts a hold: a chat as a whole, the messages of employees or a period. A reason is required; the owner of the
// business only.
func (s *Service) CreateHold(ctx context.Context, tc tenantctx.TenantContext, b api.ChatHoldCreate) (api.ChatHold, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatHold
	err := s.run(ctx, tc, true, func(r *req) error {
		if !r.tc.Owner {
			return forbidden(textOwnerOnly)
		}
		reason := strings.TrimSpace(b.Reason)
		if len([]rune(reason)) < 3 {
			return failed("Укажите причину удержания")
		}
		h := Hold{ID: uuid.New(), Scope: string(b.Scope), Reason: reason, Active: true, CreatedBy: &r.me, CreatedAt: r.now, From: b.From, To: b.To}
		if b.Until != nil {
			u := b.Until.Time
			if u.Before(r.now.Truncate(24 * time.Hour)) {
				return failed("Срок удержания уже прошёл")
			}
			h.Until = &u
		}
		switch h.Scope {
		case litChat:
			if b.ChatId == nil {
				return failed("Укажите чат")
			}
			var yes bool
			if err := r.tx.QueryRow(ctx, `select exists (select 1 from chat.chats where id = $1)`, *b.ChatId).Scan(&yes); err != nil {
				return store(litChat, err)
			}
			if !yes {
				return notFound(textChatNotFound)
			}
			h.ChatID = *b.ChatId
		case litMember:
			if b.MemberIds == nil || len(*b.MemberIds) == 0 {
				return failed("Выберите сотрудников")
			}
			h.MemberIDs = slices.Clone(*b.MemberIds)
			var n int
			if err := r.tx.QueryRow(ctx, `select count(*) from people.person_profiles where id = any($1)`, h.MemberIDs).Scan(&n); err != nil {
				return store("people", err)
			}
			if n != len(h.MemberIDs) {
				return notFound("Сотрудник не найден")
			}
		case "period":
			if b.From == nil && b.To == nil {
				return failed("Укажите период удержания")
			}
			if b.From != nil && b.To != nil && b.To.Before(*b.From) {
				return failed("Конец периода раньше начала")
			}
		}
		var chat any
		if h.ChatID != uuid.Nil {
			chat = h.ChatID
		}
		members := h.MemberIDs
		if members == nil {
			members = []uuid.UUID{}
		}
		if _, err := r.tx.Exec(ctx, `insert into chat.holds (id, scope, chat_id, member_ids, period_from, period_to, reason, until, created_by, created_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, h.ID, h.Scope, chat, members, h.From, h.To, reason, h.Until, r.me, r.now); err != nil {
			return store("hold", err)
		}
		if h.ChatID != uuid.Nil {
			name, err := r.nameOf(ctx, r.me)
			if err != nil {
				return err
			}
			if err := r.journal(ctx, h.ChatID, "Удержание «"+reason+"» · "+name, nil); err != nil {
				return err
			}
		}
		if err := r.record(ctx, "chat.hold.set", "chat.hold", h.ID, map[string]any{"scope": h.Scope, "reason": reason}); err != nil {
			return err
		}
		if err := r.publish(ctx, "chat.hold.set", "chat.hold", h.ID, map[string]any{"holdId": h.ID, "scope": h.Scope}); err != nil {
			return err
		}
		var err error
		out, err = r.holdDTO(ctx, h, litActive)
		return err
	})
	return out, err
}

// ReleaseHold lifts a hold; the row stays for the journal.
func (s *Service) ReleaseHold(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.ChatHold, error) {
	var out api.ChatHold
	err := s.run(ctx, tc, true, func(r *req) error {
		if !r.tc.Owner {
			return forbidden(textOwnerOnly)
		}
		rows, err := r.tx.Query(ctx, `select id, scope, coalesce(chat_id, '00000000-0000-0000-0000-000000000000'::uuid), member_ids, period_from, period_to,
			until, status = 'active', reason, created_by, created_at from chat.holds where id = $1 for update`, id)
		if err != nil {
			return store("hold", err)
		}
		list, err := pgx.CollectRows(rows, scanHold)
		if err != nil {
			return store("hold", err)
		}
		if len(list) == 0 {
			return notFound("Удержание не найдено")
		}
		h := list[0]
		if !h.Active {
			return coded(codeTransition, "Удержание уже снято")
		}
		if _, err := r.tx.Exec(ctx, `update chat.holds set status = 'released', released_at = $2, released_by = $3 where id = $1`, id, r.now, r.me); err != nil {
			return store("hold", err)
		}
		if h.ChatID != uuid.Nil {
			name, err := r.nameOf(ctx, r.me)
			if err != nil {
				return err
			}
			if err := r.journal(ctx, h.ChatID, "Удержание снято · "+name, nil); err != nil {
				return err
			}
		}
		if err := r.record(ctx, "chat.hold.release", "chat.hold", id, map[string]any{"scope": h.Scope}); err != nil {
			return err
		}
		if err := r.publish(ctx, "chat.hold.released", "chat.hold", id, map[string]any{"holdId": id}); err != nil {
			return err
		}
		out, err = r.holdDTO(ctx, h, "released")
		return err
	})
	return out, err
}

// bands are the lower bounds of the age classes of the buckets of the storage.
var bands = []int{0, 30, 90, 180, 365}

var kindNames = map[string]string{litPhoto: "Фото", litVideo: "Видео", "voice": "Голосовые", "doc": "Документы"}

// buckets groups the attachments of a chat by kind and age.
func buckets(atts []Att) []api.ChatBucket {
	type key struct {
		kind string
		band int
		held bool
	}
	got := map[key]*api.ChatBucket{}
	var order []key
	for _, a := range atts {
		if a.Saved {
			continue
		}
		band := 0
		for i, b := range bands {
			if a.AgeDays >= b {
				band = i
			}
		}
		k := key{a.Kind, band, a.Held}
		b := got[k]
		if b == nil {
			label := kindNames[a.Kind]
			if bands[band] > 0 {
				label += " · старше " + strconv.Itoa(bands[band]) + " дн."
			}
			b = &api.ChatBucket{Id: a.Kind + "-" + strconv.Itoa(bands[band]), Kind: api.ChatBucketKind(a.Kind), Label: label, AgeDays: int64(bands[band]), Hold: a.Held}
			got[k] = b
			order = append(order, k)
		}
		b.Files++
		b.Bytes += a.Bytes
		b.Compressed = b.Compressed || a.Compressed
	}
	slices.SortFunc(order, func(a, b key) int {
		if a.band != b.band {
			return b.band - a.band
		}
		return strings.Compare(a.kind, b.kind)
	})
	out := make([]api.ChatBucket, 0, len(order))
	for _, k := range order {
		out = append(out, *got[k])
	}
	return out
}

// Storage reads the place of a chat: used, quota, saved to records and the buckets by kind and age.
func (s *Service) Storage(ctx context.Context, tc tenantctx.TenantContext, chatID uuid.UUID) (api.ChatStorage, error) {
	var out api.ChatStorage
	err := s.run(ctx, tc, false, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		if !a.Can.Settings {
			return forbidden("Хранение видит владелец чата")
		}
		atts, _, err := r.attsOf(ctx, a.Chat)
		if err != nil {
			return err
		}
		out = api.ChatStorage{UsedBytes: a.Chat.Used, Buckets: buckets(atts), OnFull: api.ChatStorageOnFull(a.Policy.OnFull)}
		if a.Policy.QuotaMb != nil {
			out.QuotaBytes = new(int64(*a.Policy.QuotaMb) * 1_000_000)
		}
		for _, at := range atts {
			if at.Saved {
				out.SavedBytes += at.Bytes
			}
		}
		out.Hold, err = r.holdRef(ctx, chatID)
		return err
	})
	return out, err
}

// Cleanup removes attachments by a filter (dryRun counts only); held files are never removed and a chat under a hold is not
// cleaned at all.
func (s *Service) Cleanup(ctx context.Context, tc tenantctx.TenantContext, chatID uuid.UUID, b api.ChatCleanupCreate) (api.ChatCleanupResult, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatCleanupResult
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, true)
		if err != nil {
			return err
		}
		if !a.Can.Settings {
			return forbidden("Очищать чат может его владелец")
		}
		c := a.Chat
		if h, err := r.holdRef(ctx, chatID); err != nil {
			return err
		} else if h != nil {
			return coded(codeOnHold, "Нельзя очистить: удержание «"+h.Reason+"»")
		}
		f := CleanupFilter{ExcludeSaved: b.ExcludeSaved == nil || *b.ExcludeSaved, OlderThanDays: asInt(b.OlderThanDays)}
		if b.Kinds != nil {
			for _, k := range *b.Kinds {
				f.Kinds = append(f.Kinds, string(k))
			}
		}
		atts, _, err := r.attsOf(ctx, c)
		if err != nil {
			return err
		}
		plan, err := PlanCleanup(atts, c.Used, f)
		if err != nil {
			return err
		}
		out = api.ChatCleanupResult{Files: int64(plan.Files), Bytes: plan.Bytes, AfterBytes: plan.AfterBytes}
		out.Kept.Held, out.Kept.Saved = int64(plan.KeptHeld), int64(plan.KeptSaved)
		if b.DryRun != nil && *b.DryRun {
			return nil
		}
		if plan.Files == 0 {
			return failed("Под фильтр ничего не попало")
		}
		if err := r.dropAttachments(ctx, plan.Delete); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update chat.chats set used_bytes = $2, updated_at = $3 where id = $1`, chatID, plan.AfterBytes, r.now); err != nil {
			return store("used", err)
		}
		kinds := f.Kinds
		if kinds == nil {
			kinds = []string{}
		}
		if _, err := r.tx.Exec(ctx, `insert into chat.cleanups (kinds, older_than_days, exclude_saved, dry_run, files, freed_bytes, skipped_held, created_by, created_at)
			values ($1, $2, $3, false, $4, $5, $6, $7, $8)`, kinds, olderThanColumn(f.OlderThanDays), f.ExcludeSaved, plan.Files, plan.Bytes, plan.KeptHeld, r.me, r.now); err != nil {
			return store("cleanup", err)
		}
		name, err := r.nameOf(ctx, r.me)
		if err != nil {
			return err
		}
		if _, err := r.service(ctx, c, chatCard("cleaning_services", "warn", "Вложения удалены очисткой · "+name,
			pluralN(plan.Files, "файл", "файла", "файлов")+" · "+sizeText(bytesMB(plan.Bytes))+". Подписи, превью и ответы остались")); err != nil {
			return err
		}
		if err := r.journal(ctx, chatID, "Очистка: "+pluralN(plan.Files, "файл", "файла", "файлов")+" · "+sizeText(bytesMB(plan.Bytes)), nil); err != nil {
			return err
		}
		if err := r.publish(ctx, "chat.cleanup.done", "chat.chat", chatID, map[string]any{litChatID: chatID, "files": plan.Files, "bytes": plan.Bytes}); err != nil {
			return err
		}
		out.Applied = true
		return r.changed(ctx, c)
	})
	return out, err
}

// Journal reads the journal of a chat, the newest first; the content of deleted messages only with chat.audit.read.
func (s *Service) Journal(ctx context.Context, tc tenantctx.TenantContext, chatID uuid.UUID, cursor *string, limit int) (api.ChatJournal, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	out := api.ChatJournal{Items: []api.ChatJournalEntry{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		if !a.Can.Settings {
			return forbidden("Журнал чата видит владелец чата")
		}
		if limit <= 0 || limit > 200 {
			limit = 50
		}
		offset := 0
		if cursor != nil {
			if n, err := strconv.Atoi(*cursor); err == nil && n > 0 {
				offset = n
			}
		}
		rows, err := r.tx.Query(ctx, `select j.id, j.at, coalesce(p.full_name, 'Система'), j.text, j.deleted_content from chat.journal j
			left join people.person_profiles p on p.id = j.actor_id where j.chat_id = $1 order by j.at desc, j.id limit $2 offset $3`, chatID, limit+1, offset)
		if err != nil {
			return store("journal", err)
		}
		defer rows.Close()
		for rows.Next() {
			var (
				e       api.ChatJournalEntry
				content *string
			)
			if err := rows.Scan(&e.Id, &e.At, &e.ActorDisplayName, &e.Text, &content); err != nil {
				return store("journal", err)
			}
			if content != nil && a.Can.Audit {
				e.DeletedContent = content
			}
			out.Items = append(out.Items, e)
		}
		if err := rows.Err(); err != nil {
			return store("journal", err)
		}
		if len(out.Items) > limit {
			out.Items = out.Items[:limit]
			out.NextCursor = new(strconv.Itoa(offset + limit))
		}
		return nil
	})
	return out, err
}

// CreateExport queues the export of the history of a chat as a job; Sweep builds the file.
func (s *Service) CreateExport(ctx context.Context, tc tenantctx.TenantContext, chatID uuid.UUID, b api.ChatExportCreate) (api.ChatExport, error) {
	var out api.ChatExport
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		if !a.Can.Export {
			return forbidden("Выгружать историю могут роли с правом «Чаты · Выгрузка»")
		}
		if b.From != nil && b.To != nil && b.To.Before(*b.From) {
			return failed("Конец периода раньше начала")
		}
		var id uuid.UUID
		if err := r.tx.QueryRow(ctx, `insert into chat.exports (chat_id, format, period_from, period_to, created_by, created_at)
			values ($1, $2, $3, $4, $5, $6) returning id`, chatID, string(b.Format), b.From, b.To, r.me, r.now).Scan(&id); err != nil {
			return store("export", err)
		}
		if err := r.record(ctx, "chat.export.create", "chat.chat", chatID, map[string]any{"format": string(b.Format), "exportId": id}); err != nil {
			return err
		}
		out = api.ChatExport{Id: id, Status: "queued", CreatedAt: r.now}
		return nil
	})
	return out, err
}

// Export reads an export job of a chat.
func (s *Service) Export(ctx context.Context, tc tenantctx.TenantContext, chatID, id uuid.UUID) (api.ChatExport, error) {
	var out api.ChatExport
	err := s.run(ctx, tc, false, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		if !a.Can.Export {
			return forbidden("Выгружать историю могут роли с правом «Чаты · Выгрузка»")
		}
		var (
			file   *uuid.UUID
			status string
		)
		err = r.tx.QueryRow(ctx, `select id, status, created_at, file_id from chat.exports where id = $1 and chat_id = $2`, id, chatID).
			Scan(&out.Id, &status, &out.CreatedAt, &file)
		if noRows(err) {
			return notFound("Выгрузка не найдена")
		}
		if err != nil {
			return store("export", err)
		}
		out.Status = api.ChatExportStatus(status)
		if status == "failed" {
			out.Error = new("Выгрузка не удалась: повторите позже")
		}
		if file != nil {
			var f api.File
			var sha []byte
			var declared, state string
			if err := r.tx.QueryRow(ctx, `select o.id, o.declared_mime, coalesce(o.bytes, 0), coalesce(o.sha256, ''::bytea), o.state, o.created_at
				from files.objects o where o.id = $1`, *file).Scan(&f.Id, &declared, &f.SizeBytes, &sha, &state, &f.CreatedAt); err != nil {
				return store("export file", err)
			}
			f.ContentType, f.FileName = attachmentName(declared)
			f.Sha256, f.Status = hexOf(sha), api.FileStatus(state)
			out.File = &f
		}
		return nil
	})
	return out, err
}

// olderThanColumn is chat.cleanups.older_than_days: the column holds 1 and more, "any age" (0 in the contract) is NULL.
func olderThanColumn(days *int) any {
	if days == nil || *days < 1 {
		return nil
	}
	return *days
}
