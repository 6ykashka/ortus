package forms

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The public token is derived by the scheme of the comment of forms.public_links.token_digest (Q-W4.05-19): the same
// formula as the integration test of the migration (stage4_w405_integration_test.go publicLinkToken).
func TestLinkToken(t *testing.T) {
	t.Parallel()
	key := []byte(strings.Repeat("k", 32))
	tenant, link := uuid.New(), uuid.New()
	m := hmac.New(sha256.New, key)
	m.Write([]byte("ortus.forms.public-link.v1\x00" + tenant.String() + "\x00" + link.String()))
	want := base64.RawURLEncoding.EncodeToString(m.Sum(nil))
	got := linkToken(key, tenant, link)
	assert.Equal(t, want, got)
	assert.GreaterOrEqual(t, len(got), 32)
	sum := sha256.Sum256([]byte(want))
	assert.Equal(t, "sha256:"+hex.EncodeToString(sum[:]), tokenDigest(got))
	assert.NotEqual(t, got, linkToken(key, uuid.New(), link), "another tenant — another token")
}

// The submission nonce of a guest: signed, bound to the link and the version, short-lived; a forged one is refused.
func TestNonce(t *testing.T) {
	t.Parallel()
	key := []byte(strings.Repeat("n", 32))
	now := time.Date(2026, 10, 1, 7, 0, 0, 0, time.UTC)
	c := nonceClaims{tenant: uuid.New(), link: uuid.New(), version: 3, exp: now.Add(nonceTTL)}
	n := makeNonce(key, c, []byte("0123456789abcdef"))
	assert.GreaterOrEqual(t, len(n), 16)
	assert.LessOrEqual(t, len(n), 256)
	got, err := readNonce(key, n, now)
	require.NoError(t, err)
	assert.Equal(t, c.tenant, got.tenant)
	assert.Equal(t, c.link, got.link)
	assert.Equal(t, 3, got.version)
	assert.True(t, got.exp.Equal(c.exp))

	_, err = readNonce(key, n, now.Add(nonceTTL+time.Second))
	require.ErrorIs(t, err, errNonceExpired)
	_, err = readNonce([]byte(strings.Repeat("x", 32)), n, now)
	require.ErrorIs(t, err, errNonceInvalid)
	_, err = readNonce(key, n[:len(n)-2]+"AA", now)
	require.ErrorIs(t, err, errNonceInvalid)
	_, err = readNonce(key, "short", now)
	require.ErrorIs(t, err, errNonceInvalid)

	other := makeNonce(key, c, []byte("fedcba9876543210"))
	assert.NotEqual(t, n, other, "random part")
	assert.NotEqual(t, nonceActor(n), nonceActor(other))
	assert.Equal(t, nonceActor(n), nonceActor(strings.Clone(n)))
	assert.Len(t, nonceKey(n), len("nonce:")+40)
}
