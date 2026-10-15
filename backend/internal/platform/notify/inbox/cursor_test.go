package inbox

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Курсор непрозрачен (base64url), сохраняет момент с микросекундами и id и несёт отпечаток выборки.
func TestCursorRoundTrip(t *testing.T) {
	t.Parallel()
	c := cursor{At: time.Date(2026, 10, 1, 7, 30, 0, 123456000, time.UTC), ID: uuid.New(), Binding: "abc"}
	s := c.encode()
	if strings.ContainsAny(s, "{}\":+/=") || strings.Contains(s, c.ID.String()) {
		t.Fatalf("cursor is not opaque: %q", s)
	}
	got, err := decodeCursor(s)
	if err != nil || !got.At.Equal(c.At) || got.ID != c.ID || got.Binding != c.Binding {
		t.Fatalf("decode = %+v, %v; want %+v", got, err, c)
	}
}

func TestCursorMalformed(t *testing.T) {
	t.Parallel()
	for _, s := range []string{"", "!!!", "e30", "bm90LWpzb24", strings.Repeat("A", 3000)} {
		if _, err := decodeCursor(s); !errors.Is(err, ErrBadCursor) {
			t.Errorf("decodeCursor(%q) = %v, want ErrBadCursor", s, err)
		}
	}
}

// Отпечаток выборки: организация, субъект, фильтр и версия политики прав (смена прав делает курсор недействительным).
func TestCursorBinding(t *testing.T) {
	t.Parallel()
	tenant, person := uuid.New(), uuid.New()
	base := binding(tenant, person, false, 7)
	if base != binding(tenant, person, false, 7) {
		t.Fatal("binding is not deterministic")
	}
	for name, other := range map[string]string{
		"организация":     binding(uuid.New(), person, false, 7),
		"субъект":         binding(tenant, uuid.New(), false, 7),
		"фильтр":          binding(tenant, person, true, 7),
		"версия политики": binding(tenant, person, false, 8),
	} {
		if other == base {
			t.Errorf("binding ignores %s", name)
		}
	}
}
