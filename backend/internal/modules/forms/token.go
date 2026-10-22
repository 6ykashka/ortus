package forms

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"maps"
	"slices"
	"time"

	"github.com/google/uuid"
)

// The public token of a form (Q-W4.05-19; the comment of forms.public_links.token_digest): not stored but derived —
// base64url without padding of HMAC-SHA256(FORMS_PUBLIC_LINK_KEY of the version of the link, «ortus.forms.public-link.v1»
// 0x00 tenant id 0x00 link id); the databases keep its digest «sha256:» + hex SHA-256 (the control index and the tenant).
const linkLabel = "ortus.forms.public-link.v1"

// linkToken derives the token of the link of tenant.
func linkToken(key []byte, tenant, link uuid.UUID) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(linkLabel + "\x00" + tenant.String() + "\x00" + link.String()))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// tokenDigest is the digest of a token (forms.public_links.token_digest, public_form_links.token_digest).
func tokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// The submission nonce of a guest (PublicForm.submissionNonce): nothing is stored — the nonce carries its claims (the
// tenant, the link, the version, the expiry) and a random part, signed by HMAC with the key of public links under its own
// label; it is single-use by the key of deduplication of the response it makes (nonceKey, forms.responses.dedup_key).
const (
	nonceLabel  = "ortus.forms.nonce.v1"
	nonceTTL    = 2 * time.Hour
	nonceRandom = 16
	nonceClaim  = 16 + 16 + 4 + 8 // tenant, link, version, expiry (unix seconds)
)

// Errors of readNonce.
var (
	errNonceInvalid = errors.New("forms: invalid nonce")
	errNonceExpired = errors.New("forms: expired nonce")
)

// nonceClaims is what a nonce binds.
type nonceClaims struct {
	tenant, link uuid.UUID
	version      int
	exp          time.Time
}

func nonceMAC(key, payload []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(nonceLabel + "\x00"))
	m.Write(payload)
	return m.Sum(nil)
}

// makeNonce is a nonce of c with the random part random (nonceRandom bytes).
func makeNonce(key []byte, c nonceClaims, random []byte) string {
	payload := make([]byte, 0, nonceClaim+len(random))
	payload = append(payload, c.tenant[:]...)
	payload = append(payload, c.link[:]...)
	payload = binary.BigEndian.AppendUint32(payload, uint32(c.version))    //nolint:gosec // a version is a small positive number
	payload = binary.BigEndian.AppendUint64(payload, uint64(c.exp.Unix())) //nolint:gosec // a moment after 1970
	payload = append(payload, random...)
	return base64.RawURLEncoding.EncodeToString(append(payload, nonceMAC(key, payload)...))
}

// readNonce checks the signature and the expiry of a nonce at now and returns its claims.
func readNonce(key []byte, nonce string, now time.Time) (nonceClaims, error) {
	raw, err := base64.RawURLEncoding.DecodeString(nonce)
	if err != nil || len(raw) != nonceClaim+nonceRandom+sha256.Size {
		return nonceClaims{}, errNonceInvalid
	}
	payload, mac := raw[:nonceClaim+nonceRandom], raw[nonceClaim+nonceRandom:]
	if !hmac.Equal(mac, nonceMAC(key, payload)) {
		return nonceClaims{}, errNonceInvalid
	}
	var c nonceClaims
	copy(c.tenant[:], payload[:16])
	copy(c.link[:], payload[16:32])
	c.version = int(binary.BigEndian.Uint32(payload[32:36]))
	c.exp = time.Unix(int64(binary.BigEndian.Uint64(payload[36:44])), 0).UTC() //nolint:gosec // written by makeNonce
	if !now.Before(c.exp) {
		return c, errNonceExpired
	}
	return c, nil
}

// readNonceOf is readNonce with the keys of the public links: the current one, then the former ones, newest first — a
// rotation keeps the nonces of the pages already open (return 2); a nonce of no key held is invalid.
func readNonceOf(keys Keys, nonce string, now time.Time) (nonceClaims, error) {
	order := []int{keys.Current}
	former := slices.Sorted(maps.Keys(keys.ByVer))
	slices.Reverse(former)
	for _, v := range former {
		if v != keys.Current {
			order = append(order, v)
		}
	}
	for _, v := range order {
		key := keys.ByVer[v]
		if len(key) < 32 {
			continue
		}
		if c, err := readNonce(key, nonce, now); !errors.Is(err, errNonceInvalid) {
			return c, err
		}
	}
	return nonceClaims{}, errNonceInvalid
}

// nonceActor is the id the uploads of a nonce belong to (files.upload_sessions.actor_id, files.objects.uploaded_by):
// only the guest who holds the nonce completes and reads them.
func nonceActor(nonce string) uuid.UUID {
	sum := sha256.Sum256([]byte("ortus.forms.nonce-actor.v1\x00" + nonce))
	return uuid.NewSHA1(uuid.NameSpaceOID, sum[:])
}

// nonceKey is the key of deduplication of the response a nonce makes: a second submission with it — 410 nonce_used.
func nonceKey(nonce string) string {
	sum := sha256.Sum256([]byte(nonce))
	return "nonce:" + hex.EncodeToString(sum[:])[:40]
}
