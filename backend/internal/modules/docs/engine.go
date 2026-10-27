package docs

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The adapter of the document server (D-32 комплекта, ADR-0016). Р7-Офис and ONLYOFFICE speak one protocol: the
// browser opens the editor with a configuration signed by HS256 JWT of a secret shared with the server; the server
// calls back with the saved file. The choice of the server is configuration (DOCS_SERVER_URL, DOCS_SERVER_JWT_SECRET),
// not code; without them the module runs in the mode «Редактор подключается» (NoEngine).

// errJWT is any reason a token is not accepted; the caller does not tell which.
var errJWT = errors.New("docs: invalid token")

var jwtHeader = base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))

// signJWT signs claims with HS256.
func signJWT(secret []byte, claims map[string]any) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("docs: token: %w", err)
	}
	signing := jwtHeader + "." + base64.RawURLEncoding.EncodeToString(payload)
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(signing))
	return signing + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil)), nil
}

// verifyJWT checks the signature (HS256 only; «none» and any other algorithm are rejected) and the expiry of a token
// at now and returns its claims.
func verifyJWT(secret []byte, token string, now time.Time) (map[string]any, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || len(secret) == 0 {
		return nil, errJWT
	}
	rawHeader, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, errJWT
	}
	var h struct {
		Alg string `json:"alg"`
	}
	if json.Unmarshal(rawHeader, &h) != nil || h.Alg != "HS256" {
		return nil, errJWT
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errJWT
	}
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(sig, m.Sum(nil)) {
		return nil, errJWT
	}
	rawClaims, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errJWT
	}
	var claims map[string]any
	if json.Unmarshal(rawClaims, &claims) != nil {
		return nil, errJWT
	}
	if exp, ok := claims["exp"].(float64); ok && !now.Before(time.Unix(int64(exp), 0)) {
		return nil, errJWT
	}
	return claims, nil
}

var keyRE = regexp.MustCompile(`^t([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.d([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.v([1-9][0-9]{0,8})$`)

// parseKey splits the key of a version (t<tenant>.d<document>.v<version>, lowercase UUIDs).
func parseKey(key string) (tenant, doc uuid.UUID, version int, err error) {
	m := keyRE.FindStringSubmatch(key)
	if m == nil {
		return uuid.Nil, uuid.Nil, 0, errors.New("docs: invalid document key")
	}
	if tenant, err = uuid.Parse(m[1]); err != nil {
		return uuid.Nil, uuid.Nil, 0, err
	}
	if doc, err = uuid.Parse(m[2]); err != nil {
		return uuid.Nil, uuid.Nil, 0, err
	}
	version, _ = strconv.Atoi(m[3])
	return tenant, doc, version, nil
}

// OnlyOffice is the adapter of a server of the ONLYOFFICE protocol (ONLYOFFICE Document Server, Р7-Офис).
type OnlyOffice struct {
	PublicURL   string // the address of the server for the browser (the editor script is loaded from it)
	InternalURL string // the address of the server for Ortus (the command service, the saved files); "" — PublicURL
	Secret      []byte // the shared secret of the JWT (at least 32 bytes)
	Client      *http.Client
	Now         func() time.Time
}

var _ Engine = (*OnlyOffice)(nil)

func (e *OnlyOffice) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now()
}

func (e *OnlyOffice) client() *http.Client {
	base := e.Client
	if base == nil {
		base = &http.Client{Timeout: 90 * time.Second}
	}
	c := *base
	// a redirect leaves the host the file was offered on: not followed
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &c
}

// Configured implements Engine.
func (e *OnlyOffice) Configured() bool { return e != nil && e.PublicURL != "" && len(e.Secret) >= 32 }

// documentTypes are the kinds of the editor of the engine by the kind of the document.
var documentTypes = map[string]string{"text": "word", kindSheet: "cell", kindPDF: kindPDF}

// Session implements Engine: the configuration of the editor signed as a whole (the server takes the signed payload
// as the configuration).
func (e *OnlyOffice) Session(req SessionRequest) (SessionConfig, error) {
	if !e.Configured() {
		return SessionConfig{}, ErrEngineUnavailable
	}
	document := map[string]any{
		"key": req.Key, "title": req.Title, "url": req.FileURL, "fileType": req.Extension,
		"permissions": map[string]bool{
			modeEdit: req.Perms.Edit, "review": req.Perms.Review, "comment": req.Perms.Comment, "download": req.Perms.Download,
			"print": req.Perms.Print, "fillForms": req.Perms.FillForms, "copy": req.Perms.Download,
		},
	}
	if req.Watermark != "" {
		document["watermark"] = req.Watermark
	}
	claims := map[string]any{
		"documentType": documentTypes[req.Kind],
		"document":     document,
		"editorConfig": map[string]any{
			"callbackUrl": req.CallbackURL, keyMode: editorMode(req.Mode), "lang": "ru",
			"user":          map[string]string{"id": req.UserID.String(), keyName: req.UserName},
			"customization": map[string]any{"forcesave": true, "autosave": true, "comments": req.Perms.Comment},
		},
		"exp": req.Expires.Unix(),
	}
	token, err := signJWT(e.Secret, claims)
	if err != nil {
		return SessionConfig{}, err
	}
	return SessionConfig{Engine: "onlyoffice", EditorURL: strings.TrimRight(e.PublicURL, "/") + "/web-apps/apps/api/documents/api.js", Token: token}, nil
}

// editorMode is the mode of the editor of ONLYOFFICE: edit, or view for everything else (review and comment are
// permissions of the edit mode).
func editorMode(mode string) string {
	if mode == modeEdit || mode == modeReview || mode == modeComment {
		return "edit"
	}
	return "view"
}

// VerifyCallback implements Engine.
func (e *OnlyOffice) VerifyCallback(token string) error {
	if !e.Configured() {
		return ErrEngineUnavailable
	}
	_, err := verifyJWT(e.Secret, token, e.now())
	return err
}

// internal rewrites an address on the public host of the server to its internal address.
func (e *OnlyOffice) internal(u *url.URL) *url.URL {
	pub, err := url.Parse(e.PublicURL)
	if err != nil || e.InternalURL == "" || u.Host != pub.Host {
		return u
	}
	in, err := url.Parse(e.InternalURL)
	if err != nil {
		return u
	}
	c := *u
	c.Scheme, c.Host = in.Scheme, in.Host
	return &c
}

// ownURL parses an address the engine offers and checks that it is an http(s) address on the host of the server (public
// or internal) without credentials.
func (e *OnlyOffice) ownURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return nil, errors.New("docs: the address of the saved file is not an address of the server")
	}
	for _, base := range []string{e.PublicURL, e.InternalURL} {
		if b, err := url.Parse(base); err == nil && b.Host != "" && b.Host == u.Host {
			return u, nil
		}
	}
	return nil, errors.New("docs: the address of the saved file is not on the host of the server")
}

// Fetch implements Engine: only http(s) addresses on the host of the server (public or internal) are opened, no
// redirect is followed — the address in a callback is data from the network.
func (e *OnlyOffice) Fetch(ctx context.Context, rawURL string) (io.ReadCloser, error) {
	if !e.Configured() {
		return nil, ErrEngineUnavailable
	}
	u, err := e.ownURL(rawURL)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, e.internal(u).String(), nil)
	if err != nil {
		return nil, fmt.Errorf("docs: fetch: %w", err)
	}
	if tok, err := signJWT(e.Secret, map[string]any{"payload": map[string]any{}}); err == nil {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := e.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("docs: fetch: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		return nil, fmt.Errorf("docs: fetch: status %d", resp.StatusCode)
	}
	return resp.Body, nil
}

// ForceSave implements Engine: the command service «forcesave» (error 4 — nothing changed — is not an error).
func (e *OnlyOffice) ForceSave(ctx context.Context, key string) error {
	if !e.Configured() {
		return ErrEngineUnavailable
	}
	body := map[string]any{"c": "forcesave", "key": key}
	token, err := signJWT(e.Secret, body)
	if err != nil {
		return err
	}
	raw, _ := json.Marshal(body)
	base := e.PublicURL
	if e.InternalURL != "" {
		base = e.InternalURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/command", bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("docs: forcesave: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := e.client().Do(req)
	if err != nil {
		return fmt.Errorf("docs: forcesave: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		Error int `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out); err != nil || resp.StatusCode != http.StatusOK {
		return fmt.Errorf("docs: forcesave: status %d: %w", resp.StatusCode, ErrEngineUnavailable)
	}
	if out.Error != 0 && out.Error != 4 {
		return fmt.Errorf("docs: forcesave: error %d: %w", out.Error, ErrEngineUnavailable)
	}
	return nil
}

// NoEngine is the adapter without a server: the document opens for viewing and downloads, editing is off.
type NoEngine struct{}

var _ Engine = NoEngine{}

func (NoEngine) Configured() bool { return false }
func (NoEngine) Session(SessionRequest) (SessionConfig, error) {
	return SessionConfig{}, ErrEngineUnavailable
}
func (NoEngine) ForceSave(context.Context, string) error { return ErrEngineUnavailable }
func (NoEngine) VerifyCallback(string) error             { return ErrEngineUnavailable }
func (NoEngine) Fetch(context.Context, string) (io.ReadCloser, error) {
	return nil, ErrEngineUnavailable
}
