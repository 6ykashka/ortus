package chats

import (
	"slices"
	"time"

	"github.com/google/uuid"
)

// Att is an attachment as the planning of the storage sees it.
type Att struct {
	ID         uuid.UUID
	Kind       string // photo, video, voice, doc
	Bytes      int64
	AgeDays    int
	Held       bool // a hold covers the message
	Saved      bool // saved to a record: it no longer weighs on the storage of the chat
	Compressed bool
}

// Note is the service message a change of the storage leaves in the chat.
type Note struct{ Title, Text, Icon string }

// StoragePlan is what happens to the storage of a chat when a file arrives; the chat changes only after the whole plan
// succeeded (PD-60: the reference changed the buckets before it threw).
type StoragePlan struct {
	UsedBytes int64
	Freed     int64
	Delete    []uuid.UUID         // attachments removed (mode ring)
	Compress  map[uuid.UUID]int64 // attachment → its new size (mode compress)
	Note      *Note
}

func fullError(used, quotaBytes int64) error {
	return coded(codeQuotaFull, "Место чата заполнено: "+sizeText(bytesMB(used))+" из "+sizeText(bytesMB(quotaBytes))+
		". Файлы не отправляются — текст, опросы и подтверждения работают. Освободите место в «Сведения › Хранение»")
}

// free are the files the storage may touch: not held and not saved to a record, oldest first.
func free(atts []Att) []Att {
	out := slices.DeleteFunc(slices.Clone(atts), func(a Att) bool { return a.Held || a.Saved })
	slices.SortStableFunc(out, func(a, b Att) int { return b.AgeDays - a.AgeDays })
	return out
}

// PlanStorage plans the arrival of add bytes into a chat that holds used bytes (docs/25, chats.js 335–355): it fits, or
// the mode onFull of the policy frees the place (ring: the oldest files go; compress: old media shrinks by 60 %), or the
// answer is chat_quota_full.
func PlanStorage(used, add int64, pol Policy, atts []Att) (StoragePlan, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	plan := StoragePlan{UsedBytes: used + add}
	if pol.QuotaMb == nil {
		return plan, nil
	}
	quotaBytes := int64(*pol.QuotaMb) * 1_000_000
	if used+add <= quotaBytes {
		return plan, nil
	}
	over := used + add - quotaBytes
	switch pol.OnFull {
	case "ring":
		n := 0
		for _, a := range free(atts) {
			if plan.Freed >= over {
				break
			}
			plan.Delete = append(plan.Delete, a.ID)
			plan.Freed += a.Bytes
			n++
		}
		if plan.Freed < over {
			return StoragePlan{}, coded(codeQuotaFull, "Место чата заполнено, а удалить можно только сохранённое в запись или под удержанием. Освободите место вручную")
		}
		plan.UsedBytes = used + add - plan.Freed
		plan.Note = &Note{Title: "Удалены старые вложения: место чата", Icon: "autorenew",
			Text: pluralN(n, "файл", "файла", "файлов") + " · " + sizeText(bytesMB(plan.Freed)) + " · сохранённое в запись и под удержанием не тронуто"}
		return plan, nil
	case "compress":
		plan.Compress = map[uuid.UUID]int64{}
		for _, a := range free(atts) {
			if (a.Kind == litPhoto || a.Kind == litVideo) && a.AgeDays > 30 && !a.Compressed {
				cut := a.Bytes * 4 / 10
				plan.Compress[a.ID] = a.Bytes - cut
				plan.Freed += cut
			}
		}
		if used-plan.Freed+add <= quotaBytes {
			plan.UsedBytes = used - plan.Freed + add
			if plan.Freed > 0 {
				plan.Note = &Note{Title: "Медиа сжато: место чата", Icon: "compress",
					Text: "Освобождено " + sizeText(bytesMB(plan.Freed)) + " · оригиналы удалятся через 14 дней"}
			}
			return plan, nil
		}
	}
	return StoragePlan{}, fullError(used, quotaBytes)
}

// CleanupFilter is the filter of the cleanup of attachments: kinds and age. An empty filter is refused.
type CleanupFilter struct {
	Kinds         []string
	OlderThanDays *int
	ExcludeSaved  bool
}

// CleanupPlan is what a cleanup removes and what it keeps.
type CleanupPlan struct {
	Delete              []uuid.UUID
	Files               int
	Bytes, AfterBytes   int64
	KeptSaved, KeptHeld int
}

var attachmentKinds = []string{litPhoto, litVideo, "voice", "doc"}

// PlanCleanup plans the removal of the attachments by the filter (chats.js 546–559): held files are never removed, saved
// ones only when the filter does not exclude them. used is the weight of the storage of the chat before the cleanup.
func PlanCleanup(atts []Att, used int64, f CleanupFilter) (CleanupPlan, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	if len(f.Kinds) == 0 && f.OlderThanDays == nil {
		return CleanupPlan{}, failed("Выберите, что удалить")
	}
	for _, k := range f.Kinds {
		if !slices.Contains(attachmentKinds, k) {
			return CleanupPlan{}, failed("Неизвестный вид вложений «" + k + "»")
		}
	}
	var p CleanupPlan
	var weighed int64
	for _, a := range atts {
		if len(f.Kinds) > 0 && !slices.Contains(f.Kinds, a.Kind) {
			continue
		}
		if f.OlderThanDays != nil && *f.OlderThanDays > 0 && a.AgeDays <= *f.OlderThanDays {
			continue
		}
		switch {
		case a.Held:
			p.KeptHeld++
		case a.Saved && f.ExcludeSaved:
			p.KeptSaved++
		default:
			p.Delete = append(p.Delete, a.ID)
			p.Files++
			p.Bytes += a.Bytes
			if !a.Saved {
				weighed += a.Bytes
			}
		}
	}
	p.AfterBytes = used - weighed
	return p, nil
}

// Hold is a hold of the organization (chat.holds): it protects messages from deletion, cleanup and the terms.
type Hold struct {
	ID        uuid.UUID
	Scope     string // chat, member, period
	ChatID    uuid.UUID
	MemberIDs []uuid.UUID
	From, To  *time.Time
	Until     *time.Time // the date up to which the hold lasts (inclusive); nil — until it is released
	Active    bool
	Reason    string
	CreatedBy *uuid.UUID
	CreatedAt time.Time
}

// Covers reports whether the hold protects the message of author sent in chat: by the chat as a whole, by the
// employees (their messages in any chat) or by the period (PD-60: the reference never held anything).
func (h Hold) Covers(chat, author uuid.UUID, at, now time.Time) bool {
	if !h.Active {
		return false
	}
	if h.Until != nil && h.Until.Truncate(24*time.Hour).Before(now.UTC().Truncate(24*time.Hour)) {
		return false
	}
	switch h.Scope {
	case litChat:
		return h.ChatID == chat
	case litMember:
		return slices.Contains(h.MemberIDs, author)
	case "period":
		return (h.From == nil || !at.Before(*h.From)) && (h.To == nil || !at.After(*h.To))
	}
	return false
}

// AnyHold reports whether one of the holds covers the message.
func AnyHold(holds []Hold, chat, author uuid.UUID, at, now time.Time) bool {
	return slices.ContainsFunc(holds, func(h Hold) bool { return h.Covers(chat, author, at, now) })
}

var quotaLevels = []string{"", "warning", "offer", "full"}

// QuotaLevel is the threshold the storage has reached: 75 % — warning, 90 % — offer of a cleanup, 100 % — full.
func QuotaLevel(used, quota int64) string {
	if quota <= 0 {
		return ""
	}
	switch pct := used * 100 / quota; {
	case pct >= 100:
		return "full"
	case pct >= 90:
		return "offer"
	case pct >= 75:
		return "warning"
	}
	return ""
}

// QuotaCrossed is the threshold a change from before to after reaches for the first time ("" — none), so that a threshold
// raises chat.quota.warning / chat.quota.full once.
func QuotaCrossed(before, after, quota int64) string {
	b, a := slices.Index(quotaLevels, QuotaLevel(before, quota)), slices.Index(quotaLevels, QuotaLevel(after, quota))
	if a > b {
		return quotaLevels[a]
	}
	return ""
}
