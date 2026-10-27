package chats

import (
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestMaskPdnHidesPhoneNumbers(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"звоните +7 (916) 123-45-67 после обеда": "звоните +7 ••• •••-••-67 после обеда",
		"8 916 123 45 99":            "+7 ••• •••-••-99",
		"+79161234501 и 89161234502": "+7 ••• •••-••-01 и +7 ••• •••-••-02",
		"без номера: 12345":          "без номера: 12345",
		"":                           "",
	}
	for in, want := range cases {
		if got := MaskPdn(in); got != want {
			t.Errorf("MaskPdn(%q) = %q, want %q", in, got, want)
		}
	}
	if !HasPdn("+7 916 123-45-67") || HasPdn("рейс Р-208") {
		t.Error("HasPdn")
	}
}

func TestMentionAllIsOneParse(t *testing.T) {
	t.Parallel()
	yes := []string{"@все", "Внимание @все: смена", "@ВСЕ, слушаем", "раз @все!"}
	no := []string{"@всех", "почта a@все.рф", "всё", "@всегда"}
	for _, s := range yes {
		if !MentionsAll(s) {
			t.Errorf("%q must mention everyone", s)
		}
	}
	for _, s := range no {
		if MentionsAll(s) {
			t.Errorf("%q must not mention everyone", s)
		}
	}
}

func TestMentionedMembersAreChatMembersOnly(t *testing.T) {
	t.Parallel()
	ilya, marina, outsider := uuid.New(), uuid.New(), uuid.New()
	names := map[uuid.UUID]string{ilya: "Илья Васильев", marina: "Марина Котова"}
	got := Mentioned("@Илья, посмотри; @Марина тоже; @Сергей не в чате", names)
	slices.SortFunc(got, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	want := []uuid.UUID{ilya, marina}
	slices.SortFunc(want, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	if !slices.Equal(got, want) {
		t.Fatalf("got %v", got)
	}
	_ = outsider
	if len(Mentioned("без упоминаний", names)) != 0 || len(Mentioned("@Ильяшин", names)) != 0 {
		t.Error("a longer word is not a mention of the first name")
	}
}

func TestPreviewOfTheLastMessage(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   PreviewInput
		want string
	}{
		{"text", PreviewInput{Text: "Привет, 89161234567"}, "Привет, +7 ••• •••-••-67"},
		{"deleted", PreviewInput{Text: "секрет", Deleted: true}, "Сообщение удалено"},
		{"spoiler", PreviewInput{Spoiler: "код 1234"}, "Скрытый текст"},
		{"poll", PreviewInput{PollQuestion: "Во сколько выезд?"}, "Опрос · Во сколько выезд?"},
		{"file", PreviewInput{FileName: "акт.pdf"}, "Файл · акт.pdf"},
		{"document", PreviewInput{DocTitle: "Договор"}, "Документ · Договор"},
		{"system", PreviewInput{System: true, Text: "Чат создан · Дарья Зимина"}, "Чат создан · Дарья Зимина"},
		{"long", PreviewInput{Text: strings.Repeat("я", 400)}, strings.Repeat("я", 299) + "…"},
	}
	for _, c := range cases {
		if got := Preview(c.in); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

func TestPreviewKind(t *testing.T) {
	t.Parallel()
	if PreviewKind(PreviewInput{PollQuestion: "q"}) != "poll" || PreviewKind(PreviewInput{FileName: "a"}) != "file" ||
		PreviewKind(PreviewInput{DocTitle: "d"}) != "document" || PreviewKind(PreviewInput{System: true}) != "system" ||
		PreviewKind(PreviewInput{Text: "t"}) != "text" {
		t.Error("kind of the preview")
	}
}

func TestTaskTitleFromMessage(t *testing.T) {
	t.Parallel()
	if got := TaskTitle("  заменить\n  шину   на М 608 КТ 77 ", ""); got != "заменить шину на М 608 КТ 77" {
		t.Errorf("got %q", got)
	}
	if got := TaskTitle("", "Во сколько выезд?"); got != "Во сколько выезд?" {
		t.Errorf("poll: %q", got)
	}
	if got := TaskTitle("", ""); got != "Сообщение из чата" {
		t.Errorf("empty: %q", got)
	}
	if got := TaskTitle(strings.Repeat("ж", 120), ""); len([]rune(got)) != 80 {
		t.Errorf("long: %d", len([]rune(got)))
	}
}

func TestSystemTexts(t *testing.T) {
	t.Parallel()
	if got := MembersChangedText([]string{"Илья Васильев"}, []string{"Вера Котельникова", "Сергей Ильин"}); got !=
		"Вошли: Илья Васильев · Вышли: Вера Котельникова, Сергей Ильин" {
		t.Errorf("got %q", got)
	}
	if MembersChangedText(nil, nil) != "Состав не изменился" {
		t.Error("no change")
	}
	if got := MembersChangedText(nil, []string{"Вера"}); got != "Вышли: Вера" {
		t.Errorf("only left: %q", got)
	}
}
