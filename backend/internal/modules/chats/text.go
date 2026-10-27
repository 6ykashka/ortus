package chats

import (
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// phone is a Russian phone number (core/format.ts PHONE): the PDn the mask hides in the feed.
var phone = regexp.MustCompile(`(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*(\d{2})`)

// MaskPdn hides all but the last two digits of the phone numbers of a text (Q-W4.00-chats-14: always on).
func MaskPdn(text string) string {
	return phone.ReplaceAllString(text, "+7 ••• •••-••-$2")
}

// HasPdn reports whether the text holds a phone number (the message gets the «Показать номер» button).
func HasPdn(text string) bool { return phone.MatchString(text) }

// allMention is «@все» as a separate word: the right to write it and the delivery use this one parse (PD-60).
var allMention = regexp.MustCompile(`(?i)(^|\s)@все(\s|$|[,.!?:;])`)

// MentionsAll reports whether the text addresses everybody in the chat.
func MentionsAll(text string) bool { return allMention.MatchString(text) }

// Mentioned returns the members of names addressed by «@Имя» (the first word of the name, a whole word): only the
// members of the chat are in names, so a member outside the chat is never notified (PD-60).
func Mentioned(text string, names map[uuid.UUID]string) []uuid.UUID {
	if !strings.Contains(text, "@") {
		return nil
	}
	var out []uuid.UUID
	for id, full := range names {
		first, _, _ := strings.Cut(strings.TrimSpace(full), " ")
		if first == "" {
			continue
		}
		re := regexp.MustCompile(`(?i)(^|[\s(])@` + regexp.QuoteMeta(first) + `($|[^\p{L}\p{N}_])`)
		if re.MatchString(text) {
			out = append(out, id)
		}
	}
	return out
}

// PreviewInput is what the preview of a message in the list of chats is made of.
type PreviewInput struct {
	Text         string
	Deleted      bool
	Spoiler      string
	PollQuestion string
	FileName     string
	DocTitle     string
	System       bool
}

// Preview is the text of the last message in the list: after the PDn mask; a deleted message is only a label, a
// spoiler is hidden (Ч:518 of the reference).
func Preview(in PreviewInput) string {
	var s string
	switch {
	case in.Deleted:
		s = "Сообщение удалено"
	case in.Spoiler != "" && in.Text == "":
		s = "Скрытый текст"
	case in.Text != "":
		s = MaskPdn(in.Text)
	case in.PollQuestion != "":
		s = "Опрос · " + in.PollQuestion
	case in.FileName != "":
		s = "Файл · " + in.FileName
	case in.DocTitle != "":
		s = "Документ · " + in.DocTitle
	}
	return clip(s, 300)
}

// PreviewKind is the kind of the preview of the contract: text, poll, system, file, document.
func PreviewKind(in PreviewInput) string {
	switch {
	case in.System:
		return litSystem
	case in.PollQuestion != "":
		return "poll"
	case in.FileName != "":
		return "file"
	case in.DocTitle != "":
		return "document"
	}
	return litText
}

// TaskTitle is the title of a task made of a message: the text (or the question of the poll) in one line, up to 80
// characters.
func TaskTitle(text, pollQuestion string) string {
	src := text
	if strings.TrimSpace(src) == "" {
		src = pollQuestion
	}
	s := strings.Join(strings.Fields(src), " ")
	if s == "" {
		return "Сообщение из чата"
	}
	if rs := []rune(s); len(rs) > 80 {
		s = string(rs[:80])
	}
	return s
}

// MembersChangedText is the text of the service message «Состав изменён».
func MembersChangedText(gain, lose []string) string {
	var parts []string
	if len(gain) > 0 {
		parts = append(parts, "Вошли: "+strings.Join(gain, ", "))
	}
	if len(lose) > 0 {
		parts = append(parts, "Вышли: "+strings.Join(lose, ", "))
	}
	if len(parts) == 0 {
		return "Состав не изменился"
	}
	return strings.Join(parts, " · ")
}
