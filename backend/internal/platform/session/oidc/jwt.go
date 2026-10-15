package oidc

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"math"
	"math/big"
	"slices"
	"strings"
	"time"
)

// Allowed signature algorithms of ID tokens: asymmetric only (no "none", no HMAC with a public key).
const (
	algRS256 = "RS256"
	algES256 = "ES256"
)

type jwsHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid"`
}

// audience is the aud claim: a string or an array of strings.
type audience []string

func (a *audience) UnmarshalJSON(b []byte) error {
	if len(b) > 0 && b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		*a = audience{s}
		return nil
	}
	var list []string
	if err := json.Unmarshal(b, &list); err != nil {
		return err
	}
	*a = list
	return nil
}

// numericDate is a JSON number of seconds since the epoch.
type numericDate float64

func (n *numericDate) time() time.Time {
	if n == nil {
		return time.Time{}
	}
	sec, frac := math.Modf(float64(*n))
	return time.Unix(int64(sec), int64(frac*1e9)).UTC()
}

type idClaims struct {
	Iss               string       `json:"iss"`
	Sub               string       `json:"sub"`
	Aud               audience     `json:"aud"`
	Azp               string       `json:"azp"`
	Exp               *numericDate `json:"exp"`
	Iat               *numericDate `json:"iat"`
	AuthTime          *numericDate `json:"auth_time"`
	Nonce             string       `json:"nonce"`
	Email             string       `json:"email"`
	EmailVerified     bool         `json:"email_verified"`
	Name              string       `json:"name"`
	PreferredUsername string       `json:"preferred_username"`
}

// VerifyIDToken verifies an ID token of this provider issued for nonce (OIDC Core 3.1.3.7) and returns its identity.
// Every failure is ErrRejected, except an unreachable JWKS (ErrUnavailable).
func (p *Provider) VerifyIDToken(ctx context.Context, raw, nonce string) (Identity, error) {
	payload, err := p.verifySignature(ctx, raw)
	if err != nil {
		return Identity{}, err
	}
	var c idClaims
	dec := json.NewDecoder(bytes.NewReader(payload))
	if err := dec.Decode(&c); err != nil {
		return Identity{}, rejected("claims: %v", err)
	}
	if err := p.checkClaims(c, nonce); err != nil {
		return Identity{}, err
	}
	id := Identity{
		Issuer: c.Iss, Subject: c.Sub, Email: NormalizeEmail(c.Email), EmailVerified: c.EmailVerified,
		Name: strings.TrimSpace(c.Name), AuthTime: c.AuthTime.time(),
	}
	if id.Name == "" {
		id.Name = strings.TrimSpace(c.PreferredUsername)
	}
	if id.Name == "" {
		id.Name = id.Email
	}
	if id.AuthTime.IsZero() {
		id.AuthTime = c.Iat.time()
	}
	return id, nil
}

// NormalizeEmail is the form of accounts.email_norm and invitations.email_norm: trimmed, lower case.
func NormalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func (p *Provider) checkClaims(c idClaims, nonce string) error {
	now := p.now()
	leeway := p.cfg.Leeway
	switch {
	case c.Iss != p.cfg.Issuer:
		return rejected("iss %q", c.Iss)
	case c.Sub == "":
		return rejected("no sub")
	case !containsAud(c.Aud, p.cfg.ClientID):
		return rejected("aud %v", []string(c.Aud))
	case len(c.Aud) > 1 && c.Azp != p.cfg.ClientID, c.Azp != "" && c.Azp != p.cfg.ClientID:
		return rejected("azp %q", c.Azp)
	case c.Exp == nil || !now.Before(c.Exp.time().Add(leeway)):
		return rejected("expired or no exp")
	case c.Iat == nil || c.Iat.time().After(now.Add(leeway)):
		return rejected("iat in the future or missing")
	case nonce == "" || subtle.ConstantTimeCompare([]byte(c.Nonce), []byte(nonce)) != 1:
		return rejected("nonce mismatch")
	}
	return nil
}

func containsAud(aud audience, client string) bool { return slices.Contains(aud, client) }

// jws is a parsed JWS compact token.
type jws struct {
	header         jwsHeader
	signingInput   string
	payload, sigma []byte
}

func parseJWS(token string) (jws, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return jws{}, rejected("not a JWS compact token")
	}
	var (
		t       = jws{signingInput: parts[0] + "." + parts[1]}
		decoded [3][]byte
	)
	for i, part := range parts {
		b, err := base64.RawURLEncoding.DecodeString(part)
		if err != nil {
			return jws{}, rejected("segment %d: %v", i, err)
		}
		decoded[i] = b
	}
	if err := json.Unmarshal(decoded[0], &t.header); err != nil {
		return jws{}, rejected("header: %v", err)
	}
	if t.header.Alg != algRS256 && t.header.Alg != algES256 {
		return jws{}, rejected("alg %q is not allowed", t.header.Alg)
	}
	t.payload, t.sigma = decoded[1], decoded[2]
	return t, nil
}

// verifySignature checks the JWS compact serialization against a key of the JWKS and returns the payload.
func (p *Provider) verifySignature(ctx context.Context, raw string) ([]byte, error) {
	t, err := parseJWS(raw)
	if err != nil {
		return nil, err
	}
	key, err := p.key(ctx, t.header.Kid)
	if err != nil {
		return nil, err
	}
	if !verify(key, t.header.Alg, t.signingInput, t.sigma) {
		return nil, rejected("bad %s signature", t.header.Alg)
	}
	return t.payload, nil
}

// verify checks sig of input with key under alg; the key type must match alg.
func verify(key any, alg, input string, sig []byte) bool {
	sum := sha256.Sum256([]byte(input))
	switch k := key.(type) {
	case *rsa.PublicKey:
		return alg == algRS256 && rsa.VerifyPKCS1v15(k, crypto.SHA256, sum[:], sig) == nil
	case *ecdsa.PublicKey:
		return alg == algES256 && len(sig) == 64 &&
			ecdsa.Verify(k, sum[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:]))
	}
	return false
}

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

// key returns the signing key kid of the JWKS. An unknown kid refetches the JWKS (key rotation); the same unknown
// kid again refetches only after 30 seconds.
func (p *Provider) key(ctx context.Context, kid string) (any, error) {
	p.mu.Lock()
	k, ok := p.keys[kid]
	refetch := !p.keysSet || kid != p.lastMiss || p.now().Sub(p.keysAt) >= jwksRefetchWait
	if !ok {
		p.lastMiss = kid
	}
	p.mu.Unlock()
	if ok {
		return k, nil
	}
	if !refetch {
		return nil, rejected("unknown kid %q", kid)
	}
	m, err := p.discover(ctx)
	if err != nil {
		return nil, err
	}
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := p.getJSON(ctx, m.JWKSURI, &set); err != nil {
		return nil, err
	}
	keys := map[string]any{}
	for _, j := range set.Keys {
		if j.Use != "" && j.Use != "sig" {
			continue
		}
		if pub, err := j.public(); err == nil {
			keys[j.Kid] = pub
		}
	}
	p.mu.Lock()
	p.keys, p.keysAt, p.keysSet = keys, p.now(), true
	p.mu.Unlock()
	if k, ok := keys[kid]; ok {
		return k, nil
	}
	return nil, rejected("unknown kid %q", kid)
}

func (j jwk) public() (any, error) {
	switch j.Kty {
	case "RSA":
		n, err := base64.RawURLEncoding.DecodeString(j.N)
		if err != nil {
			return nil, err
		}
		e, err := base64.RawURLEncoding.DecodeString(j.E)
		if err != nil || len(e) == 0 || len(e) > 4 {
			return nil, rejected("rsa exponent")
		}
		return &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}, nil
	case "EC":
		if j.Crv != "P-256" {
			return nil, rejected("curve %q", j.Crv)
		}
		x, err := base64.RawURLEncoding.DecodeString(j.X)
		if err != nil || len(x) != 32 {
			return nil, rejected("ec x")
		}
		y, err := base64.RawURLEncoding.DecodeString(j.Y)
		if err != nil || len(y) != 32 {
			return nil, rejected("ec y")
		}
		return ecdsa.ParseUncompressedPublicKey(elliptic.P256(), append(append([]byte{4}, x...), y...))
	}
	return nil, rejected("kty %q", j.Kty)
}
