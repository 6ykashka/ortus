package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

type nullsKey struct{}

// nullsBody is the limit of a body the middleware reads (a patch of a request is small).
const nullsBody = 1 << 16

// NullsMiddleware records that the body of a PATCH of a request had assigneeId: null — the generated pointer of
// ServiceRequestPatch does not tell a null from an absent field, and «снять исполнителя» is a null (updateServiceRequest).
// The body is given back to the router whole and unchanged; it reads nothing of any other request.
func NullsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || !patchOfRequest(r.URL.Path) || r.Body == nil || r.ContentLength > nullsBody {
			next.ServeHTTP(w, r)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, nullsBody+1))
		r.Body = rebody{Reader: io.MultiReader(bytes.NewReader(body), r.Body), Closer: r.Body}
		if err == nil && len(body) <= nullsBody {
			var top map[string]json.RawMessage
			if json.Unmarshal(body, &top) == nil && string(bytes.TrimSpace(top["assigneeId"])) == "null" {
				r = r.WithContext(context.WithValue(r.Context(), nullsKey{}, true))
			}
		}
		next.ServeHTTP(w, r)
	})
}

type rebody struct {
	io.Reader
	io.Closer
}

// patchOfRequest reports whether path is …/tenants/{t}/service/requests/{r}.
func patchOfRequest(path string) bool {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	return len(parts) == 7 && parts[0] == "api" && parts[1] == "v1" && parts[2] == "tenants" && parts[4] == moduleService && parts[5] == "requests"
}

// Unassigns reports whether the PATCH had assigneeId: null.
func Unassigns(ctx context.Context) bool {
	v, _ := ctx.Value(nullsKey{}).(bool)
	return v
}
