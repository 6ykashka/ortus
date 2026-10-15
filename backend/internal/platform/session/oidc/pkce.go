package oidc

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// RandomToken returns 32 random bytes in base64url without padding (43 characters): state, nonce, handles.
func RandomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("oidc: random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// NewPKCE returns a code verifier (RFC 7636, 43 characters) and its S256 challenge.
func NewPKCE() (verifier, challenge string, err error) {
	verifier, err = RandomToken()
	if err != nil {
		return "", "", err
	}
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

// Hash is the SHA-256 under which the stores keep session ids and sign-in handles.
func Hash(s string) []byte {
	sum := sha256.Sum256([]byte(s))
	return sum[:]
}
