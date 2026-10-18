package data

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
)

// cursor is the position of a page (the offset of its first row) and the fingerprint of the selection it continues.
type cursor struct {
	Offset  int    `json:"o"`
	Binding string `json:"b"`
}

// bindingOf is the fingerprint of a selection a cursor continues: the JSON of parts (values the engine built itself:
// keys, operators, parsed values), hashed.
func bindingOf(parts ...any) string {
	raw, err := json.Marshal(parts)
	if err != nil { // parts are strings, numbers and slices of them: always marshal
		panic("data: binding: " + err.Error())
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:12])
}

// encodeCursor returns the opaque cursor of the rows after offset of the selection binding.
func encodeCursor(offset int, binding string) string {
	raw, _ := json.Marshal(cursor{Offset: offset, Binding: binding}) // an int and a string always marshal
	return base64.RawURLEncoding.EncodeToString(raw)
}

// decodeCursor returns the offset of a cursor of the selection binding: a malformed cursor and a cursor of another
// selection are 400 malformed_request.
func decodeCursor(s, binding string) (int, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil || s == "" {
		return 0, malformed(textBadCursor)
	}
	var c cursor
	// No page starts past countCap: the engine issues no such cursor (no unbounded scans).
	if err := json.Unmarshal(raw, &c); err != nil || c.Offset < 0 || c.Offset > countCap || c.Binding == "" {
		return 0, malformed(textBadCursor)
	}
	if c.Binding != binding {
		return 0, malformed(textForeignCursor)
	}
	return c.Offset, nil
}
