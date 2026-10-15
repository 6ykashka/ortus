package invitations

import "testing"

func TestMaskEmail(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{
		"o.petrova@alta.example": "o•••••@alta.example",
		"I@alta.example":         "i•••••@alta.example",
		"анна@почта.рф":          "а•••••@почта.рф",
		"broken":                 "•••••",
		"@alta.example":          "•••••@alta.example",
	} {
		if got := MaskEmail(in); got != want {
			t.Errorf("MaskEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHashTokenIsSHA256(t *testing.T) {
	t.Parallel()
	h := HashToken("token")
	if len(h) != 32 || string(h) == "token" {
		t.Fatalf("HashToken = %x", h)
	}
	if string(HashToken("token")) != string(h) || string(HashToken("other")) == string(h) {
		t.Fatal("HashToken must be deterministic and distinct")
	}
}
