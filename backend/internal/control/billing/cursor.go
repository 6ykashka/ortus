package billing

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
)

// maxCursor bounds a cursor (nextCursor of the pages, maxLength 2048).
const maxCursor = 2048

// cursorJSON is the position of the next page and what it is bound to: the reader, the filter and the sort.
type cursorJSON struct {
	Offset int    `json:"o"`
	Bind   string `json:"b"`
}

// binding is the short hash of the parts a cursor is bound to.
func binding(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:8])
}

// encodeCursor returns the opaque cursor of the page that starts at offset.
func encodeCursor(offset int, bind string) string {
	b, _ := json.Marshal(cursorJSON{Offset: offset, Bind: bind}) // an int and a string always marshal
	return base64.RawURLEncoding.EncodeToString(b)
}

// decodeCursor returns the offset of a cursor of encodeCursor with the same binding; "" is the first page; anything
// else is ErrBadCursor.
func decodeCursor(s, bind string) (int, error) {
	if s == "" {
		return 0, nil
	}
	if len(s) > maxCursor {
		return 0, ErrBadCursor
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return 0, ErrBadCursor
	}
	var c cursorJSON
	if err := json.Unmarshal(b, &c); err != nil || c.Offset < 1 || c.Bind != bind {
		return 0, ErrBadCursor
	}
	return c.Offset, nil
}
