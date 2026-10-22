package forms

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// NullsMiddleware records the explicit nulls of a PATCH of a form or of a response and gives the router the body
// unchanged — also a body over its limit (return 1): it is passed on whole, not cut at 1 MiB, so the router answers
// it as it answers any big body; other requests are not read at all.
func TestNullsMiddleware(t *testing.T) {
	t.Parallel()
	var (
		got   []byte
		nulls Nulls
	)
	h := NullsMiddleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		var err error
		got, err = io.ReadAll(r.Body)
		assert.NoError(t, err)
		nulls = NullsFrom(r.Context())
	}))
	send := func(method, path, body string) {
		t.Helper()
		got, nulls = nil, nil
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body)))
	}
	const form = "/api/v1/tenants/t1/forms/f1"
	send(http.MethodPatch, form, `{"groupId":null,"settings":{"acceptUntil":null,"access":"public"}}`)
	assert.Equal(t, Nulls{"groupId": true, "settings.acceptUntil": true}, nulls)
	assert.JSONEq(t, `{"groupId":null,"settings":{"acceptUntil":null,"access":"public"}}`, string(got))
	send(http.MethodPatch, form+"/responses/r1", `{"assigneeMemberId":null}`)
	assert.Equal(t, Nulls{"assigneeMemberId": true}, nulls)
	send(http.MethodPatch, form+"/rules/x", `{"enabled":null}`)
	assert.Nil(t, nulls, "not a patch of a form or a response")

	big := `{"name":"` + strings.Repeat("я", nullsBody) + `","groupId":null}`
	send(http.MethodPatch, form, big)
	assert.Len(t, got, len(big), "a body over the limit is passed on whole")
	assert.True(t, bytes.Equal([]byte(big), got))
	assert.Nil(t, nulls, "and its nulls are not read")
}
