package forms

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// nullsKey is the key of the Nulls of a request in its context.
type nullsKey struct{}

// nullsBody is the limit of a body Nulls reads (the bodies of the patches are small).
const nullsBody = 1 << 20

// NullsMiddleware records the fields of the body of a PATCH of a form or of a response sent as an explicit null —
// «Вся организация» (orgUnitId), «Без группы» (groupId), no deadline, limit or pass score (settings.acceptUntil,
// settings.responseLimit, settings.passScore), no assignee (assigneeMemberId): the generated pointers of FormPatch and
// ResponseReviewPatch do not tell a null from an absent field. The body is given back to the router unchanged and
// whole: a body over nullsBody (declared or read) is passed on as it came, its nulls unread — the router and its body
// limit answer it like any other (return 1). It runs before the gateway, so it reads at most nullsBody+1 bytes of a
// PATCH of these two paths and nothing of any other request.
func NullsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || !patchOfForms(r.URL.Path) || r.Body == nil || r.ContentLength > nullsBody {
			next.ServeHTTP(w, r)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, nullsBody+1))
		r.Body = rebody{Reader: io.MultiReader(bytes.NewReader(body), r.Body), Closer: r.Body}
		if err == nil && len(body) <= nullsBody {
			if n := nullsOf(body); len(n) > 0 {
				r = r.WithContext(context.WithValue(r.Context(), nullsKey{}, n))
			}
		}
		next.ServeHTTP(w, r)
	})
}

// rebody is the body of a request with its read part put back in front of the rest; Close closes the original.
type rebody struct {
	io.Reader
	io.Closer
}

// patchOfForms reports whether path is …/tenants/{t}/forms/{f} or …/tenants/{t}/forms/{f}/responses/{r}.
func patchOfForms(path string) bool {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case len(parts) < 6 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "tenants" || parts[4] != "forms":
		return false
	case len(parts) == 6:
		return true
	}
	return len(parts) == 8 && parts[6] == "responses"
}

// nullsOf are the null fields of a JSON object: top-level, and «settings.<key>».
func nullsOf(body []byte) Nulls {
	var top map[string]json.RawMessage
	if json.Unmarshal(body, &top) != nil {
		return nil
	}
	out := Nulls{}
	for k, v := range top {
		if isNull(v) {
			out[k] = true
		}
	}
	var settings map[string]json.RawMessage
	if raw, ok := top["settings"]; ok && json.Unmarshal(raw, &settings) == nil {
		for k, v := range settings {
			if isNull(v) {
				out["settings."+k] = true
			}
		}
	}
	return out
}

func isNull(v json.RawMessage) bool { return string(bytes.TrimSpace(v)) == "null" }

// NullsFrom are the null fields of the body of the request of ctx.
func NullsFrom(ctx context.Context) Nulls {
	n, _ := ctx.Value(nullsKey{}).(Nulls)
	return n
}
