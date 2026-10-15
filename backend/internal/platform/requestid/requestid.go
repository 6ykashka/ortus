// Package requestid assigns every request an X-Request-Id (W0.09): a valid incoming id is echoed, otherwise a
// new UUID v4 is generated. The id goes to the response header, the request context, logs and Problem.requestId.
package requestid

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

// Header is the request and response header of the request id.
const Header = "X-Request-Id"

const maxLen = 128

type ctxKey struct{}

// Middleware sets the request id of r in the response header and the request context.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(Header)
		if !valid(id) {
			id = uuid.NewString()
		}
		w.Header().Set(Header, id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
	})
}

// FromContext returns the request id set by Middleware, or "".
func FromContext(ctx context.Context) string {
	id, _ := ctx.Value(ctxKey{}).(string)
	return id
}

// valid reports whether s matches ^[A-Za-z0-9._:-]{1,128}$.
func valid(s string) bool {
	if s == "" || len(s) > maxLen {
		return false
	}
	for _, c := range []byte(s) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '.', c == '_', c == ':', c == '-':
		default:
			return false
		}
	}
	return true
}
