package requestid

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

var uuidV4 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// K-07 (WS-40): входящий X-Request-Id по ^[A-Za-z0-9._:-]{1,128}$ — эхо, иначе новый UUID v4;
// тот же id доступен хендлеру через FromContext.
func TestMiddleware(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, in string
		echo     bool
	}{
		{"допустимый id возвращается как есть", "abc.1:2-x", true},
		{"пустой — новый UUID v4", "", false},
		{"длиннее 128 — новый", strings.Repeat("a", 129), false},
		{"ровно 128 — эхо", strings.Repeat("a", 128), true},
		{"пробел — новый", "a b", false},
		{"кириллица — новый", "кир", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var seen string
			h := Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				seen = FromContext(r.Context())
			}))
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
			if tc.in != "" {
				req.Header.Set(Header, tc.in)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			got := rec.Header().Get(Header)
			if seen != got {
				t.Fatalf("FromContext = %q, header = %q", seen, got)
			}
			if tc.echo && got != tc.in {
				t.Fatalf("header = %q, want echo %q", got, tc.in)
			}
			if !tc.echo && !uuidV4.MatchString(got) {
				t.Fatalf("header = %q, want new UUID v4", got)
			}
		})
	}
}

func TestFromContextWithoutMiddleware(t *testing.T) {
	t.Parallel()
	if got := FromContext(t.Context()); got != "" {
		t.Fatalf("FromContext = %q, want empty", got)
	}
}
