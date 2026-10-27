package chats

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

const mb = int64(1_000_000)

func att(id byte, kind string, size int64, age int) Att {
	return Att{ID: uuid.UUID{15: id}, Kind: kind, Bytes: size, AgeDays: age}
}

func quota(mbs int, onFull string) Policy {
	p := DefaultPolicy(KindGroup)
	p.QuotaMb, p.OnFull = new(mbs), onFull
	return p
}

func TestPlanStorageFitsWithoutChanges(t *testing.T) {
	t.Parallel()
	plan, err := PlanStorage(100*mb, 50*mb, quota(200, "block"), []Att{att(1, "photo", 100*mb, 10)})
	if err != nil || plan.UsedBytes != 150*mb || len(plan.Delete) != 0 || plan.Note != nil || plan.Freed != 0 {
		t.Fatalf("plan = %+v err = %v", plan, err)
	}
	unlimited := DefaultPolicy(KindArea)
	plan, err = PlanStorage(10_000*mb, 500*mb, unlimited, nil)
	if err != nil || plan.UsedBytes != 10_500*mb {
		t.Fatalf("unlimited: %+v %v", plan, err)
	}
}

func TestPlanStorageBlock(t *testing.T) {
	t.Parallel()
	_, err := PlanStorage(190*mb, 20*mb, quota(200, "block"), nil)
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != "chat_quota_full" {
		t.Fatalf("err = %v", err)
	}
	want := "Место чата заполнено: 190 МБ из 200 МБ. Файлы не отправляются — текст, опросы и подтверждения работают. Освободите место в «Сведения › Хранение»"
	if pe.Detail != want {
		t.Fatalf("detail = %q", pe.Detail)
	}
}

func TestPlanStorageRingDeletesOldestAndSkipsProtected(t *testing.T) {
	t.Parallel()
	atts := []Att{
		att(1, "video", 80*mb, 200),
		{ID: uuid.UUID{15: 2}, Kind: "photo", Bytes: 60 * mb, AgeDays: 300, Held: true},
		{ID: uuid.UUID{15: 3}, Kind: "photo", Bytes: 60 * mb, AgeDays: 250, Saved: true},
		att(4, "photo", 40*mb, 100),
		att(5, "doc", 10*mb, 5),
	}
	plan, err := PlanStorage(190*mb, 50*mb, quota(200, "ring"), atts)
	if err != nil {
		t.Fatal(err)
	}
	// over = 190 + 50 - 200 = 40 MB: the oldest not protected file (80 MB, video) goes; the held one and the one saved to
	// the record are not touched.
	if len(plan.Delete) != 1 || plan.Delete[0] != atts[0].ID || plan.Freed != 80*mb || plan.UsedBytes != 160*mb {
		t.Fatalf("plan = %+v", plan)
	}
	if plan.Note == nil || plan.Note.Title != "Удалены старые вложения: место чата" ||
		plan.Note.Text != "1 файл · 80 МБ · сохранённое в запись и под удержанием не тронуто" {
		t.Fatalf("note = %+v", plan.Note)
	}
}

func TestPlanStorageRingFailsWhenOnlyProtectedFilesRemain(t *testing.T) {
	t.Parallel()
	atts := []Att{{ID: uuid.UUID{15: 1}, Kind: "photo", Bytes: 150 * mb, AgeDays: 90, Held: true}}
	_, err := PlanStorage(190*mb, 50*mb, quota(200, "ring"), atts)
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != "chat_quota_full" || pe.Detail != "Место чата заполнено, а удалить можно только сохранённое в запись или под удержанием. Освободите место вручную" {
		t.Fatalf("err = %v", err)
	}
}

func TestPlanStorageCompressShrinksOldMedia(t *testing.T) {
	t.Parallel()
	atts := []Att{att(1, "video", 100*mb, 60), att(2, "photo", 50*mb, 10), {ID: uuid.UUID{15: 3}, Kind: "photo", Bytes: 50 * mb, AgeDays: 90, Compressed: true}}
	plan, err := PlanStorage(190*mb, 30*mb, quota(200, "compress"), atts)
	if err != nil {
		t.Fatal(err)
	}
	// Only the old uncompressed media shrinks: 40 % of 100 MB is freed.
	if len(plan.Compress) != 1 || plan.Compress[atts[0].ID] != 60*mb || plan.Freed != 40*mb || plan.UsedBytes != 180*mb {
		t.Fatalf("plan = %+v", plan)
	}
	if plan.Note == nil || plan.Note.Title != "Медиа сжато: место чата" || plan.Note.Text != "Освобождено 40 МБ · оригиналы удалятся через 14 дней" {
		t.Fatalf("note = %+v", plan.Note)
	}
	if _, err := PlanStorage(190*mb, 200*mb, quota(200, "compress"), atts); err == nil {
		t.Fatal("compression is not enough: the chat is full")
	}
}

func TestPlanCleanup(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	t.Parallel()
	atts := []Att{
		att(1, "video", 100*mb, 120),
		att(2, "video", 50*mb, 20),
		{ID: uuid.UUID{15: 3}, Kind: "video", Bytes: 70 * mb, AgeDays: 400, Held: true},
		{ID: uuid.UUID{15: 4}, Kind: "video", Bytes: 30 * mb, AgeDays: 400, Saved: true},
		att(5, "voice", 5*mb, 40),
	}
	plan, err := PlanCleanup(atts, 255*mb, CleanupFilter{Kinds: []string{"video"}, OlderThanDays: new(90), ExcludeSaved: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Delete) != 1 || plan.Delete[0] != atts[0].ID || plan.Files != 1 || plan.Bytes != 100*mb || plan.AfterBytes != 155*mb ||
		plan.KeptHeld != 1 || plan.KeptSaved != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	// Without «exclude saved» the file saved to a record is removed too, but it no longer counts in the chat storage.
	plan, err = PlanCleanup(atts, 255*mb, CleanupFilter{Kinds: []string{"video"}, OlderThanDays: new(90)})
	if err != nil || plan.Files != 2 {
		t.Fatalf("with saved: %+v %v", plan, err)
	}
	if _, err := PlanCleanup(atts, 255*mb, CleanupFilter{}); err == nil {
		t.Fatal("an empty filter must be refused")
	} else if pe, _ := errors.AsType[*problem.Error](err); pe == nil || pe.Detail != "Выберите, что удалить" {
		t.Fatalf("err = %v", err)
	}
	if _, err := PlanCleanup(atts, 0, CleanupFilter{Kinds: []string{"hologram"}}); err == nil {
		t.Fatal("an unknown kind must be refused")
	}
}

func TestHoldCovers(t *testing.T) {
	t.Parallel()
	chat, author, other := uuid.New(), uuid.New(), uuid.New()
	at := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	now := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	day := func(d int) *time.Time { x := time.Date(2026, 9, d, 0, 0, 0, 0, time.UTC); return &x }
	cases := []struct {
		name string
		h    Hold
		want bool
	}{
		{"whole chat", Hold{Scope: "chat", ChatID: chat, Active: true}, true},
		{"other chat", Hold{Scope: "chat", ChatID: uuid.New(), Active: true}, false},
		{"members: the author", Hold{Scope: "member", MemberIDs: []uuid.UUID{author}, Active: true}, true},
		{"members: someone else", Hold{Scope: "member", MemberIDs: []uuid.UUID{other}, Active: true}, false},
		{"period: inside", Hold{Scope: "period", From: day(1), To: day(15), Active: true}, true},
		{"period: outside", Hold{Scope: "period", From: day(11), To: day(15), Active: true}, false},
		{"period: open end", Hold{Scope: "period", From: day(1), Active: true}, true},
		{"released", Hold{Scope: "chat", ChatID: chat}, false},
		{"expired", Hold{Scope: "chat", ChatID: chat, Active: true, Until: ptrDate(2026, 9, 30)}, false},
		{"until today", Hold{Scope: "chat", ChatID: chat, Active: true, Until: ptrDate(2026, 10, 1)}, true},
	}
	for _, c := range cases {
		if got := c.h.Covers(chat, author, at, now); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
	if !AnyHold([]Hold{{Scope: "member", MemberIDs: []uuid.UUID{other}, Active: true}, {Scope: "chat", ChatID: chat, Active: true}}, chat, author, at, now) {
		t.Error("one covering hold is enough")
	}
}

func ptrDate(y int, m time.Month, d int) *time.Time {
	t := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	return &t
}

func TestQuotaThresholds(t *testing.T) {
	t.Parallel()
	cases := []struct {
		used, quota int64
		want        string
	}{
		{0, 100, ""}, {74, 100, ""}, {75, 100, "warning"}, {89, 100, "warning"}, {90, 100, "offer"}, {99, 100, "offer"},
		{100, 100, "full"}, {150, 100, "full"},
	}
	for _, c := range cases {
		if got := QuotaLevel(c.used, c.quota); got != c.want {
			t.Errorf("%d/%d = %q, want %q", c.used, c.quota, got, c.want)
		}
	}
	if QuotaLevel(5, 0) != "" {
		t.Error("no quota — no level")
	}
	if QuotaCrossed(70, 80, 100) != "warning" || QuotaCrossed(80, 85, 100) != "" || QuotaCrossed(85, 95, 100) != "offer" || QuotaCrossed(95, 100, 100) != "full" {
		t.Error("crossing a threshold is reported once")
	}
}
