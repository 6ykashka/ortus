package chats

import (
	"errors"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func TestDefaultPolicyByKind(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	t.Parallel()
	cases := []struct {
		kind     Kind
		receipts string
		temp     string
		maxMb    int
		quota    *int
	}{
		{KindDirect, "ticks", "allowed", 200, nil},
		{KindGroup, "ticks", "off", 200, new(5000)},
		{KindArea, "ticks", "off", 100, nil},
		{KindRecord, "ticks", "viewonce", 500, new(5000)},
		{KindAnnounce, "off", "off", 50, nil},
	}
	for _, c := range cases {
		t.Run(string(c.kind), func(t *testing.T) {
			t.Parallel()
			p := DefaultPolicy(c.kind)
			if p.Receipts != c.receipts || p.Temp != c.temp || p.MaxFileMb != c.maxMb {
				t.Fatalf("policy = %+v", p)
			}
			if (p.QuotaMb == nil) != (c.quota == nil) || (c.quota != nil && *p.QuotaMb != *c.quota) {
				t.Fatalf("quota = %v, want %v", p.QuotaMb, c.quota)
			}
			// CHAT-10: the deleted content is kept exactly 30 days; Q-W4.00-chats-14: the PDn mask is always on.
			if p.DeletedDays != 30 || !p.PdnMask || p.OnFull != "block" || p.Edit != "48h" {
				t.Fatalf("common values: %+v", p)
			}
		})
	}
	if p := DefaultPolicy(KindRecord); p.AfterCloseDays == nil || *p.AfterCloseDays != 3 {
		t.Fatalf("record afterCloseDays = %v", p.AfterCloseDays)
	}
	if p := DefaultPolicy(KindAnnounce); p.TextYears != 5 {
		t.Fatalf("announce textYears = %d", p.TextYears)
	}
}

func TestEffectivePolicyAppliesOnlyOnFullOverride(t *testing.T) {
	t.Parallel()
	kind := DefaultPolicy(KindGroup)
	got := kind.WithOverrides(Overrides{OnFull: "ring"})
	if got.OnFull != "ring" || got.MaxFileMb != kind.MaxFileMb || kind.OnFull != "block" {
		t.Fatalf("effective = %+v, kind = %+v", got, kind)
	}
	if same := kind.WithOverrides(Overrides{}); same != kind {
		t.Fatalf("empty override changed the policy: %+v", same)
	}
}

func TestEditWindow(t *testing.T) {
	t.Parallel()
	for edit, want := range map[string]time.Duration{"15m": 15 * time.Minute, "48h": 48 * time.Hour} {
		if d, limited := EditWindow(edit); !limited || d != want {
			t.Errorf("%s: %v %v", edit, d, limited)
		}
	}
	if _, limited := EditWindow("none"); limited {
		t.Error("none must be unlimited")
	}
}

func TestPatchPolicyValidation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		kind   Kind
		patch  PolicyPatch
		detail string
	}{
		{"bounds delete days", KindGroup, PolicyPatch{DeletedDays: new(7)}, "Значение вне пределов организации: 30–30"},
		{"bounds max file", KindGroup, PolicyPatch{MaxFileMb: new(5)}, "Значение вне пределов организации: 10–2000"},
		{"bounds text years", KindGroup, PolicyPatch{TextYears: new(9)}, "Значение вне пределов организации: 1–5"},
		{"unknown receipts", KindGroup, PolicyPatch{Receipts: new("loud")}, "Неизвестное значение настройки «receipts»"},
		{"unknown edit", KindGroup, PolicyPatch{Edit: new("1h")}, "Неизвестное значение настройки «edit»"},
		{"archive is v2", KindGroup, PolicyPatch{OnFull: new("archive")}, "Режим «Переносить в архив» появится позже"},
		{"temp in work chats", KindGroup, PolicyPatch{Temp: new("allowed")}, "Временные сообщения разрешены только в личных чатах"},
		{"viewonce outside record", KindArea, PolicyPatch{Temp: new("viewonce")}, "Временные сообщения разрешены только в личных чатах"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			_, err := DefaultPolicy(c.kind).Apply(c.kind, c.patch)
			pe, ok := errors.AsType[*problem.Error](err)
			if !ok || pe.Code != "validation_failed" || pe.Detail != c.detail {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func TestPatchPolicyAcceptsValidValues(t *testing.T) {
	t.Parallel()
	p, err := DefaultPolicy(KindDirect).Apply(KindDirect, PolicyPatch{Temp: new("allowed"), Receipts: new("who"), MaxFileMb: new(300)})
	if err != nil || p.Receipts != "who" || p.MaxFileMb != 300 {
		t.Fatalf("p = %+v err = %v", p, err)
	}
	r, err := DefaultPolicy(KindRecord).Apply(KindRecord, PolicyPatch{Temp: new("viewonce"), AfterCloseDays: new(10)})
	if err != nil || *r.AfterCloseDays != 10 {
		t.Fatalf("record = %+v err = %v", r, err)
	}
	q, err := DefaultPolicy(KindGroup).Apply(KindGroup, PolicyPatch{QuotaSet: true})
	if err != nil || q.QuotaMb != nil {
		t.Fatalf("null quota = %+v err = %v", q, err)
	}
}

func TestPolicyNotesDescribeConsequences(t *testing.T) {
	t.Parallel()
	cur := DefaultPolicy(KindGroup)
	next := cur
	next.FilesDays, next.Receipts, next.Edit = 90, "who", "15m"
	notes := PolicyNotes(KindGroup, cur, next, PolicyImpact{Chats: 2, People: 5, OldFilesBytes: 3_000_000_000})
	want := []string{
		"2 чата вида «Рабочие группы», 5 сотрудников: новые значения — сразу",
		"Прочтение: «Галочки» → «Кто и когда»",
		"Правка своих — 15 минут вместо 48 часов: отправленное раньше уже не правится",
		"Вложения старше 90 дней удалятся: около 3 ГБ. Сохранённое в запись и под удержанием останется",
	}
	if len(notes) != len(want) {
		t.Fatalf("notes = %q", notes)
	}
	for i := range want {
		if notes[i] != want[i] {
			t.Errorf("note %d = %q, want %q", i, notes[i], want[i])
		}
	}
	quiet := PolicyNotes(KindGroup, cur, cur, PolicyImpact{Chats: 1, People: 1})
	if len(quiet) != 2 || quiet[1] != "Сообщения и файлы не удаляются" {
		t.Fatalf("quiet = %q", quiet)
	}
}
