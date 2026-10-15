package kit

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func TestETag(t *testing.T) {
	t.Parallel()
	assert.Equal(t, `"1"`, ETag(1))
	assert.Equal(t, `"42"`, ETag(42))
}

func TestCheckRevision(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, ifMatch string
		current       int64
		code          string // "" — matches
	}{
		{"same", `"3"`, 3, ""},
		{"spaces around", ` "3" `, 3, ""},
		{"missing", "", 3, CodeRevisionRequired},
		{"stale", `"2"`, 3, CodeRevisionMismatch},
		{"star is not accepted", "*", 3, CodeRevisionMismatch},
		{"weak", `W/"3"`, 3, CodeRevisionMismatch},
		{"unquoted", "3", 3, CodeRevisionMismatch},
		{"garbage", `"x"`, 3, CodeRevisionMismatch},
		{"list", `"3", "4"`, 3, CodeRevisionMismatch},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			err := CheckRevision(c.ifMatch, c.current)
			if c.code == "" {
				assert.NoError(t, err)
				return
			}
			assert.True(t, problem.Is(err, c.code), "want %s, got %v", c.code, err)
		})
	}
}

func TestCursorRoundTrip(t *testing.T) {
	t.Parallel()
	s := EncodeCursor("Иванов Иван", "6de355d2-b019-5bb6-b66a-ddae6a13fb65")
	assert.NotContains(t, s, "Иванов", "the cursor is opaque")
	keys, err := DecodeCursor(s, 2)
	require.NoError(t, err)
	assert.Equal(t, []string{"Иванов Иван", "6de355d2-b019-5bb6-b66a-ddae6a13fb65"}, keys)
}

func TestCursorRejectsGarbage(t *testing.T) {
	t.Parallel()
	for _, s := range []string{"%%%", "e30", EncodeCursor("one"), EncodeCursor("a", "b", "c")} {
		_, err := DecodeCursor(s, 2)
		assert.True(t, problem.Is(err, problem.CodeMalformedRequest), "cursor %q: %v", s, err)
	}
}

func TestPageLimit(t *testing.T) {
	t.Parallel()
	n, err := PageLimit(nil)
	require.NoError(t, err)
	assert.Equal(t, DefaultLimit, n)
	for _, ok := range []int{1, 50, MaxLimit} {
		got, err := PageLimit(&ok)
		require.NoError(t, err)
		assert.Equal(t, ok, got)
	}
	for _, bad := range []int{0, -1, MaxLimit + 1} {
		_, err := PageLimit(&bad)
		assert.True(t, problem.Is(err, problem.CodeMalformedRequest), "limit %d", bad)
	}
}

func TestTenant(t *testing.T) {
	t.Parallel()
	_, err := Tenant(context.Background())
	assert.True(t, problem.Is(err, problem.CodeNotFound), "no tenant context: %v", err)
	tc := tenantctx.TenantContext{TenantID: uuid.New(), PersonID: uuid.New()}
	got, err := Tenant(tenantctx.WithTenant(context.Background(), tc))
	require.NoError(t, err)
	assert.Equal(t, tc, got)
}

func TestCompleteOutsideGuardIsNoop(t *testing.T) {
	t.Parallel()
	// Without an Idempotency-Key the command has no record to complete: nothing to store, no error.
	require.NoError(t, Complete(context.Background(), nil, 201, `"1"`, map[string]string{"id": "x"}))
}

func TestErrors(t *testing.T) {
	t.Parallel()
	assert.True(t, problem.Is(Invalid("Проверьте поле."), CodeValidationFailed))
	assert.True(t, problem.Is(Conflict("Уже есть."), CodeInvalidTransition))
	assert.Equal(t, "Проверьте поле.", Invalid("Проверьте поле.").Detail)
}

func TestRequestID(t *testing.T) {
	t.Parallel()
	id := RequestID(context.Background())
	assert.NotEmpty(t, id, "audit needs a request id even outside an HTTP request")
}
