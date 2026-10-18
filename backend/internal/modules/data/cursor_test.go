package data

import (
	"encoding/base64"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func TestCursor(t *testing.T) {
	t.Parallel()
	b := bindingOf("test.items", member, "7")
	if b == "" || b != bindingOf("test.items", member, "7") || b == bindingOf("test.items", member, "8") {
		t.Fatalf("binding %q is not a stable fingerprint", b)
	}
	c := encodeCursor(150, b)
	if n, err := decodeCursor(c, b); err != nil || n != 150 {
		t.Fatalf("decode: %d %v", n, err)
	}
	if _, err := decodeCursor(c, bindingOf("test.items", member, "8")); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Fatalf("foreign: %v", err)
	}
	for _, bad := range []string{"", "!!!", base64.RawURLEncoding.EncodeToString([]byte(`{"o": -1, "b": "` + b + `"}`)),
		base64.RawURLEncoding.EncodeToString([]byte(`[1, 2]`))} {
		if _, err := decodeCursor(bad, b); !problem.Is(err, problem.CodeMalformedRequest) {
			t.Fatalf("%q: %v", bad, err)
		}
	}
}
