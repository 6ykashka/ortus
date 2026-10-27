package chats

import (
	"strconv"
	"time"

	"github.com/google/uuid"
)

// Policy is the effective policy of a kind of chats or of a chat (chats.js DEFAULT_POLICY, the contract ChatPolicy).
// The organization sets the bounds, the kind sets the values, a chat changes only onFull.
type Policy struct {
	TextYears      int    `json:"textYears"`
	FilesDays      int    `json:"filesDays"`
	VoiceDays      int    `json:"voiceDays"`
	Receipts       string `json:"receipts"`
	ReceiptsDays   int    `json:"receiptsDays"`
	DeletedDays    int    `json:"deletedDays"`
	Edit           string `json:"edit"`
	MaxFileMb      int    `json:"maxFileMb"`
	QuotaMb        *int   `json:"quotaMb"`
	Temp           string `json:"temp"`
	Forward        string `json:"forward"`
	PdnMask        bool   `json:"pdnMask"`
	OnFull         string `json:"onFull"`
	AfterCloseDays *int   `json:"afterCloseDays,omitempty"`
}

// Overrides are the values a chat sets itself (only onFull in the first version, Q-W4.00-chats-2).
type Overrides struct {
	OnFull string `json:"onFull,omitempty"`
	// Compressed are the attachments the mode «Сжимать медиа» has already shrunk (no column of tenant 0060 holds it).
	Compressed []uuid.UUID `json:"compressed,omitempty"`
}

// PolicyPatch is a partial policy: only the fields present change. QuotaSet marks quotaMb as present (QuotaMb nil — null,
// no limit of its own).
type PolicyPatch struct {
	TextYears, FilesDays, VoiceDays, ReceiptsDays, DeletedDays, MaxFileMb, AfterCloseDays *int
	Receipts, Edit, Temp, Forward, OnFull                                                 *string
	PdnMask                                                                               *bool
	QuotaMb                                                                               *int
	QuotaSet                                                                              bool
}

// bound is a closed range of a policy value.
type bound struct{ Min, Max int }

// Bounds are the bounds of the organization (chats.js BOUNDS; CHAT-10: the deleted content is kept exactly 30 days).
var Bounds = struct{ TextYears, FilesDays, VoiceDays, ReceiptsDays, DeletedDays, MaxFileMb bound }{
	TextYears: bound{1, 5}, FilesDays: bound{30, 1825}, VoiceDays: bound{30, 1095}, ReceiptsDays: bound{7, 90},
	DeletedDays: bound{30, 30}, MaxFileMb: bound{10, 2000},
}

var (
	editLabels    = map[string]string{"15m": "15 минут", lit48h: "48 часов", "none": "Без срока"}
	receiptLabels = map[string]string{litOff: "Не показывать", "ticks": "Галочки", "who": "Кто и когда"}
	tempLabels    = map[string]string{litOff: "Запрещены", "allowed": "1 час — 7 дней", "viewonce": "Одноразовые файлы · модераторы"}
	forwardLabels = map[string]string{"free": "Свободно", "internal": "Внутри организации", litOff: "Запрещена"}
	fullLabels    = map[string]string{"block": "Запретить новые файлы", "ring": "Удалять старые вложения",
		"archive": "Переносить в архив", "compress": "Сжимать медиа"}
)

// DefaultPolicy is the policy of a kind before the owner changes it. CHAT-02: the read mode is «ticks» (N of M, no names)
// except announcements (off); CHAT-10: the deleted content is kept 30 days; Q-W4.00-chats-14: the PDn mask is always on.
func DefaultPolicy(kind Kind) Policy {
	p := Policy{TextYears: 3, FilesDays: 365, VoiceDays: 90, Receipts: "ticks", ReceiptsDays: 30, DeletedDays: 30, Edit: lit48h,
		MaxFileMb: 200, Temp: litOff, Forward: "internal", PdnMask: true, OnFull: "block"}
	switch kind {
	case KindDirect:
		p.Temp = "allowed"
	case KindGroup:
		p.QuotaMb = new(5000)
	case KindArea:
		p.MaxFileMb = 100
	case KindRecord:
		p.MaxFileMb, p.QuotaMb, p.Temp, p.AfterCloseDays = 500, new(5000), "viewonce", new(3)
	case KindAnnounce:
		p.TextYears, p.MaxFileMb, p.Receipts = 5, 50, litOff
	}
	return p
}

// WithOverrides is the policy of a chat: the values of the kind plus the overrides of the chat.
func (p Policy) WithOverrides(o Overrides) Policy {
	if o.OnFull != "" {
		p.OnFull = o.OnFull
	}
	return p
}

// EditWindow is the window of editing and deleting an own message; limited false — without a term.
func EditWindow(edit string) (d time.Duration, limited bool) {
	switch edit {
	case "15m":
		return 15 * time.Minute, true
	case lit48h:
		return 48 * time.Hour, true
	}
	return 0, false
}

// Apply returns p with the patch of the policy of kind; a value that is unknown or outside the bounds of the organization
// is a validation_failed with the text of the reference. Nothing changes when it fails.
func (p Policy) Apply(kind Kind, patch PolicyPatch) (Policy, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	enums := []struct {
		key    string
		v      *string
		labels map[string]string
		set    func(string)
	}{
		{"receipts", patch.Receipts, receiptLabels, func(s string) { p.Receipts = s }},
		{"edit", patch.Edit, editLabels, func(s string) { p.Edit = s }},
		{"temp", patch.Temp, tempLabels, func(s string) { p.Temp = s }},
		{"forward", patch.Forward, forwardLabels, func(s string) { p.Forward = s }},
		{"onFull", patch.OnFull, fullLabels, func(s string) { p.OnFull = s }},
	}
	for _, e := range enums {
		if e.v == nil {
			continue
		}
		if _, ok := e.labels[*e.v]; !ok {
			return Policy{}, failed("Неизвестное значение настройки «" + e.key + "»")
		}
		e.set(*e.v)
	}
	if patch.OnFull != nil && *patch.OnFull == "archive" {
		return Policy{}, failed("Режим «Переносить в архив» появится позже")
	}
	if patch.Temp != nil && *patch.Temp != litOff {
		// CHAT-04: temporary messages only in personal chats; the view-once files of record chats are not temporary
		// (Q-W4.00-chats-4).
		if kind != KindDirect && (kind != KindRecord || *patch.Temp != "viewonce") {
			return Policy{}, failed("Временные сообщения разрешены только в личных чатах")
		}
	}
	ranges := []struct {
		v   *int
		b   bound
		set func(int)
	}{
		{patch.TextYears, Bounds.TextYears, func(n int) { p.TextYears = n }},
		{patch.FilesDays, Bounds.FilesDays, func(n int) { p.FilesDays = n }},
		{patch.VoiceDays, Bounds.VoiceDays, func(n int) { p.VoiceDays = n }},
		{patch.ReceiptsDays, Bounds.ReceiptsDays, func(n int) { p.ReceiptsDays = n }},
		{patch.DeletedDays, Bounds.DeletedDays, func(n int) { p.DeletedDays = n }},
		{patch.MaxFileMb, Bounds.MaxFileMb, func(n int) { p.MaxFileMb = n }},
	}
	for _, r := range ranges {
		if r.v == nil {
			continue
		}
		if *r.v < r.b.Min || *r.v > r.b.Max {
			return Policy{}, failed("Значение вне пределов организации: " + strconv.Itoa(r.b.Min) + "–" + strconv.Itoa(r.b.Max))
		}
		r.set(*r.v)
	}
	if patch.PdnMask != nil {
		p.PdnMask = *patch.PdnMask
	}
	if patch.QuotaSet {
		if patch.QuotaMb != nil && *patch.QuotaMb < 1 {
			return Policy{}, failed("Место чата — не меньше 1 МБ")
		}
		p.QuotaMb = patch.QuotaMb
	}
	if patch.AfterCloseDays != nil {
		if *patch.AfterCloseDays < 0 || *patch.AfterCloseDays > 3650 {
			return Policy{}, failed("Значение вне пределов организации: 0–3650")
		}
		p.AfterCloseDays = patch.AfterCloseDays
	}
	return p, nil
}

// PolicyImpact is what a change of the policy of a kind touches: the chats of the kind, their members and the weight of
// the attachments older than the new term.
type PolicyImpact struct {
	Chats, People int
	OldFilesBytes int64
}

// editMinutes orders the edit windows (no term is the widest).
func editMinutes(edit string) int {
	switch edit {
	case "15m":
		return 15
	case lit48h:
		return 2880
	}
	return 1 << 30
}

// PolicyNotes are the texts of the service messages for the chats of the kind (chatPolicySet): the first says who is
// touched, the others — what changes; a change that deletes nothing says so.
func PolicyNotes(kind Kind, cur, next Policy, impact PolicyImpact) []string {
	notes := []string{pluralN(impact.Chats, "чат", "чата", "чатов") + " вида «" + kindLabels[kind] + "», " +
		pluralN(impact.People, "сотрудник", "сотрудника", "сотрудников") + ": новые значения — сразу"}
	if next.ReceiptsDays < cur.ReceiptsDays {
		notes = append(notes, "Отметки прочтения старше "+strconv.Itoa(next.ReceiptsDays)+" дней удалятся. Подтверждения важного не затрагиваются")
	}
	if next.Receipts != cur.Receipts {
		notes = append(notes, "Прочтение: «"+receiptLabels[cur.Receipts]+"» → «"+receiptLabels[next.Receipts]+"»")
	}
	if editMinutes(next.Edit) < editMinutes(cur.Edit) {
		notes = append(notes, "Правка своих — "+editLabels[next.Edit]+" вместо "+editLabels[cur.Edit]+": отправленное раньше уже не правится")
	}
	if next.FilesDays < cur.FilesDays {
		notes = append(notes, "Вложения старше "+strconv.Itoa(next.FilesDays)+" дней удалятся: около "+sizeText(bytesMB(impact.OldFilesBytes))+
			". Сохранённое в запись и под удержанием останется")
	}
	if next.TextYears < cur.TextYears {
		notes = append(notes, "Текст старше "+strconv.Itoa(next.TextYears)+" лет удалится по новому сроку")
	}
	if next.Temp != cur.Temp {
		notes = append(notes, "Временные: «"+tempLabels[cur.Temp]+"» → «"+tempLabels[next.Temp]+"»")
	}
	if next.MaxFileMb != cur.MaxFileMb {
		notes = append(notes, "Файл до "+sizeText(float64(next.MaxFileMb))+" вместо "+sizeText(float64(cur.MaxFileMb)))
	}
	if len(notes) == 1 {
		notes = append(notes, "Сообщения и файлы не удаляются")
	}
	return notes
}
