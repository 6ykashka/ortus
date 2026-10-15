package tenants

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Курсор непрозрачен (TenantPage.nextCursor ≤ 2048): кодирует позицию (created_at, id); испорченный — ошибка.
func TestCursorRoundTrip(t *testing.T) {
	t.Parallel()
	c := Cursor{CreatedAt: time.Date(2026, time.October, 1, 7, 30, 0, 123456000, time.UTC), ID: uuid.New()}
	s := c.Encode()
	if len(s) > 2048 || strings.ContainsAny(s, "+/= ") {
		t.Fatalf("cursor %q is not URL-safe or too long", s)
	}
	got, err := DecodeCursor(s)
	if err != nil || !got.CreatedAt.Equal(c.CreatedAt) || got.ID != c.ID {
		t.Fatalf("DecodeCursor(%q) = %+v, %v; want %+v", s, got, err, c)
	}
	for _, bad := range []string{"", "!!!", "e30", c.Encode()[:10], strings.Repeat("A", 3000)} {
		if _, err := DecodeCursor(bad); !errors.Is(err, ErrBadCursor) {
			t.Errorf("DecodeCursor(%q) = %v, want ErrBadCursor", bad, err)
		}
	}
}
