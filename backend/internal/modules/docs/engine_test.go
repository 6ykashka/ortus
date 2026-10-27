package docs

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

var testSecret = []byte("0123456789abcdef0123456789abcdef")

func TestJWTRoundTrip(t *testing.T) {
	t.Parallel()
	tok, err := signJWT(testSecret, map[string]any{"a": "b", "exp": testNow.Add(time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := verifyJWT(testSecret, tok, testNow)
	if err != nil || claims["a"] != "b" {
		t.Fatalf("verify: %v %v, want the claims back", claims, err)
	}
}

func TestJWTRejects(t *testing.T) {
	t.Parallel()
	good, _ := signJWT(testSecret, map[string]any{"a": "b", "exp": testNow.Add(time.Minute).Unix()})
	parts := strings.Split(good, ".")
	forged := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`)) + "." + parts[1] + "."
	tampered := parts[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(`{"a":"c"}`)) + "." + parts[2]
	expired, _ := signJWT(testSecret, map[string]any{"exp": testNow.Add(-time.Second).Unix()})
	other, _ := signJWT([]byte("another-secret-another-secret-0000"), map[string]any{"a": "b"})
	for name, tok := range map[string]string{
		"alg none": forged, "tampered payload": tampered, "expired": expired, "other secret": other, "garbage": "x.y", "empty": "",
	} {
		if _, err := verifyJWT(testSecret, tok, testNow); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestParseKey(t *testing.T) {
	t.Parallel()
	tenant, doc := tid(1), tid(2)
	k := engineKey(tenant, doc, 7)
	gt, gd, gv, err := parseKey(k)
	if err != nil || gt != tenant || gd != doc || gv != 7 {
		t.Fatalf("parseKey(%q) = %v %v %v %v", k, gt, gd, gv, err)
	}
	for _, bad := range []string{"", doc.String() + ":v3", "t" + tenant.String() + ".d" + doc.String(), "T" + tenant.String() + ".d" + doc.String() + ".v1",
		"t" + tenant.String() + ".d" + doc.String() + ".v0", "t" + tenant.String() + ".dnot-a-uuid.v1", "t" + tenant.String() + ".d" + doc.String() + ".v1x"} {
		if _, _, _, err := parseKey(bad); err == nil {
			t.Errorf("parseKey(%q) accepted", bad)
		}
	}
}

func newOO(t *testing.T, url string) *OnlyOffice {
	t.Helper()
	return &OnlyOffice{PublicURL: url, Secret: testSecret, Now: func() time.Time { return testNow }}
}

func TestOnlyOfficeSessionSignsTheConfig(t *testing.T) { //nolint:gocyclo // one check of every claim of the configuration
	t.Parallel()
	e := newOO(t, "https://docs.example")
	if !e.Configured() {
		t.Fatal("not configured with a URL and a secret")
	}
	cfg, err := e.Session(SessionRequest{
		Key: engineKey(tid(1), tid(2), 3), Title: "Приказ", Kind: "text", Extension: "docx", FileURL: "https://files/x", CallbackURL: "https://ortus/cb",
		UserID: tid(5), UserName: "Котова Марина", Mode: modeEdit, Perms: Permissions{Edit: true, Comment: true, Download: true},
		Expires: testNow.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Engine != "onlyoffice" || cfg.EditorURL != "https://docs.example/web-apps/apps/api/documents/api.js" {
		t.Fatalf("config %+v", cfg)
	}
	claims, err := verifyJWT(testSecret, cfg.Token, testNow)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	raw, _ := json.Marshal(claims)
	var got struct {
		DocumentType string `json:"documentType"`
		Document     struct {
			Key, Title, URL, FileType string
			Permissions               map[string]bool
		} `json:"document"`
		EditorConfig struct {
			CallbackURL string `json:"callbackUrl"`
			Mode        string `json:"mode"`
			User        struct{ ID, Name string }
		} `json:"editorConfig"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.DocumentType != "word" || got.Document.Key != engineKey(tid(1), tid(2), 3) || got.Document.URL != "https://files/x" ||
		got.Document.FileType != "docx" || !got.Document.Permissions["edit"] || got.Document.Permissions["print"] ||
		got.EditorConfig.CallbackURL != "https://ortus/cb" || got.EditorConfig.Mode != "edit" || got.EditorConfig.User.ID != tid(5).String() {
		t.Fatalf("claims %s", raw)
	}
}

func TestOnlyOfficeNotConfigured(t *testing.T) {
	t.Parallel()
	for _, e := range []*OnlyOffice{{}, {PublicURL: "https://docs.example"}, {PublicURL: "https://docs.example", Secret: []byte("short")}} {
		if e.Configured() {
			t.Errorf("%+v is configured", e)
		}
		if _, err := e.Session(SessionRequest{}); err == nil {
			t.Errorf("%+v: a session without a server", e)
		}
	}
}

func TestVerifyCallback(t *testing.T) {
	t.Parallel()
	e := newOO(t, "https://docs.example")
	good, _ := signJWT(testSecret, map[string]any{"key": "k"})
	bad, _ := signJWT([]byte("another-secret-another-secret-0000"), map[string]any{"key": "k"})
	if err := e.VerifyCallback(good); err != nil {
		t.Fatalf("good token: %v", err)
	}
	if err := e.VerifyCallback(bad); err == nil {
		t.Fatal("token of another secret accepted")
	}
	if err := e.VerifyCallback(""); err == nil {
		t.Fatal("empty token accepted")
	}
}

func TestFetchStaysOnTheEngineHost(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/file":
			_, _ = w.Write([]byte("saved bytes"))
		case "/jump":
			http.Redirect(w, r, "http://169.254.169.254/latest/meta-data", http.StatusFound)
		}
	}))
	defer srv.Close()
	e := newOO(t, srv.URL)
	rc, err := e.Fetch(context.Background(), srv.URL+"/file")
	if err != nil {
		t.Fatalf("fetch from the engine: %v", err)
	}
	b, _ := io.ReadAll(rc)
	_ = rc.Close()
	if string(b) != "saved bytes" {
		t.Fatalf("body %q", b)
	}
	for _, u := range []string{"http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "ftp://x/y", "http://other.example/file", srv.URL + "/jump",
		"://bad"} {
		if rc, err := e.Fetch(context.Background(), u); err == nil {
			_ = rc.Close()
			t.Errorf("fetch %q accepted", u)
		}
	}
}

func TestFetchUsesTheInternalAddress(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) }))
	defer srv.Close()
	e := newOO(t, "https://docs.public.example")
	e.InternalURL = srv.URL
	rc, err := e.Fetch(context.Background(), "https://docs.public.example/cache/files/data/x?md5=1")
	if err != nil {
		t.Fatalf("fetch through the internal address: %v", err)
	}
	_ = rc.Close()
}

func TestForceSave(t *testing.T) {
	t.Parallel()
	var got map[string]any
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"error":0}`))
	}))
	defer srv.Close()
	e := newOO(t, srv.URL)
	if err := e.ForceSave(context.Background(), "t.d.v1"); err != nil {
		t.Fatal(err)
	}
	if got["c"] != "forcesave" || got["key"] != "t.d.v1" {
		t.Fatalf("command %v", got)
	}
	if _, err := verifyJWT(testSecret, strings.TrimPrefix(auth, "Bearer "), testNow); err != nil {
		t.Fatalf("the command is not signed: %v", err)
	}
}

func TestNoEngine(t *testing.T) {
	t.Parallel()
	var e Engine = NoEngine{}
	if e.Configured() {
		t.Fatal("no engine is configured")
	}
	if err := e.VerifyCallback("x"); err == nil {
		t.Fatal("a callback is accepted without an engine")
	}
	if _, err := e.Session(SessionRequest{}); err == nil {
		t.Fatal("a session without an engine")
	}
	_ = uuid.Nil
}
