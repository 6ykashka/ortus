package main

import (
	"bytes"
	"encoding/base64"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/modules/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// W4.21: the tags Forms and PublicForms are served by the module of forms over the tenant pools, the memberships of
// the control DB, the ports of tasks, of the knowledge base, of the CRM objects and of the files, the index of the
// public links of the control DB, the inbox and the clock of the application; one service answers both tags.
func TestNewForms(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	env := map[string]string{"FORMS_PUBLIC_LINK_KEY": base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32))}
	member, guest, err := newForms(noPools{}, ev, nil, func(k string) string { return env[k] }, envE2E, slog.New(slog.DiscardHandler),
		func() time.Time { return at })
	if err != nil {
		t.Fatal(err)
	}
	m, ok := member.(forms.Server)
	g, ok2 := guest.(forms.PublicServer)
	if !ok || !ok2 || m.S == nil || g.S != m.S {
		t.Fatalf("servers %#v %#v, want the servers of W4.21 over one service", member, guest)
	}
	s := m.S
	ports := []any{s.Directory, s.Tasks, s.Knowledge, s.Objects, s.Links, s.Uploads, s.Audience}
	if s.Pools != (noPools{}) || slices.Contains(ports, nil) || s.Now == nil || !s.Now().Equal(at) {
		t.Fatalf("service %+v", s)
	}
	if s.Keys.Current != 1 || len(s.Keys.ByVer[1]) != 32 {
		t.Fatalf("keys %+v", s.Keys)
	}
}

// FORMS_PUBLIC_LINK_KEY (Q-W4.05-19): base64 of at least 32 bytes, its version FORMS_PUBLIC_LINK_KEY_VERSION (1 by
// default); without it a dev or e2e stand derives a fixed key of its own (with a warning), prod has no public links
// (503); a short or malformed key stops the start.
func TestPublicLinkKeys(t *testing.T) {
	t.Parallel()
	key := bytes.Repeat([]byte{9}, 40)
	cases := []struct {
		name    string
		env     map[string]string
		appEnv  string
		current int
		size    int
		warn    string
		err     string
	}{
		{"key", map[string]string{"FORMS_PUBLIC_LINK_KEY": base64.StdEncoding.EncodeToString(key)}, envProd, 1, 40, "", ""},
		{"version", map[string]string{"FORMS_PUBLIC_LINK_KEY": base64.StdEncoding.EncodeToString(key), "FORMS_PUBLIC_LINK_KEY_VERSION": "3"},
			envProd, 3, 40, "", ""},
		{"dev", map[string]string{}, envDev, 1, 32, "FORMS_PUBLIC_LINK_KEY", ""},
		{"prod without a key", map[string]string{}, envProd, 0, 0, "FORMS_PUBLIC_LINK_KEY", ""},
		{"short", map[string]string{"FORMS_PUBLIC_LINK_KEY": base64.StdEncoding.EncodeToString(key[:31])}, envDev, 0, 0, "", "32 bytes"},
		{"not base64", map[string]string{"FORMS_PUBLIC_LINK_KEY": "не base64"}, envDev, 0, 0, "", "base64"},
		{"bad version", map[string]string{"FORMS_PUBLIC_LINK_KEY": base64.StdEncoding.EncodeToString(key), "FORMS_PUBLIC_LINK_KEY_VERSION": "0"},
			envDev, 0, 0, "", "FORMS_PUBLIC_LINK_KEY_VERSION"},
		{"previous key without the current one", map[string]string{"FORMS_PUBLIC_LINK_PREVIOUS_KEYS": "1:" + base64.StdEncoding.EncodeToString(key)},
			envDev, 0, 0, "", "FORMS_PUBLIC_LINK_PREVIOUS_KEYS"},
		{"malformed previous key", map[string]string{"FORMS_PUBLIC_LINK_KEY": base64.StdEncoding.EncodeToString(key),
			"FORMS_PUBLIC_LINK_KEY_VERSION": "2", "FORMS_PUBLIC_LINK_PREVIOUS_KEYS": "1=" + base64.StdEncoding.EncodeToString(key)},
			envDev, 0, 0, "", "FORMS_PUBLIC_LINK_PREVIOUS_KEYS"},
		{"short previous key", map[string]string{"FORMS_PUBLIC_LINK_KEY": base64.StdEncoding.EncodeToString(key),
			"FORMS_PUBLIC_LINK_KEY_VERSION": "2", "FORMS_PUBLIC_LINK_PREVIOUS_KEYS": "1:" + base64.StdEncoding.EncodeToString(key[:8])},
			envDev, 0, 0, "", "32 bytes"},
		{"previous key of the current version", map[string]string{"FORMS_PUBLIC_LINK_KEY": base64.StdEncoding.EncodeToString(key),
			"FORMS_PUBLIC_LINK_KEY_VERSION": "2", "FORMS_PUBLIC_LINK_PREVIOUS_KEYS": "2:" + base64.StdEncoding.EncodeToString(key)},
			envDev, 0, 0, "", "FORMS_PUBLIC_LINK_PREVIOUS_KEYS"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			var logs strings.Builder
			got, err := publicLinkKeys(func(k string) string { return c.env[k] }, c.appEnv, slog.New(slog.NewTextHandler(&logs, nil)))
			if c.err != "" {
				if err == nil || !strings.Contains(err.Error(), c.err) {
					t.Fatalf("error %v, want %q", err, c.err)
				}
				return
			}
			if err != nil || got.Current != c.current || len(got.ByVer[c.current]) != c.size {
				t.Fatalf("keys %+v %v, want version %d of %d bytes", got, err, c.current, c.size)
			}
			if (c.warn == "") != (logs.Len() == 0) || !strings.Contains(logs.String(), c.warn) {
				t.Fatalf("log %q, want a warning %q", logs.String(), c.warn)
			}
		})
	}
}

// Return 1: after a rotation (FORMS_PUBLIC_LINK_KEY_VERSION raised) the links of the former versions keep their tokens —
// FORMS_PUBLIC_LINK_PREVIOUS_KEYS «<version>:<base64>[,…]» gives the server the former keys; a link is derived with the
// key of its own version, new links and nonces take the current one.
func TestPublicLinkPreviousKeys(t *testing.T) {
	t.Parallel()
	cur, one, two := bytes.Repeat([]byte{3}, 32), bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 48)
	env := map[string]string{"FORMS_PUBLIC_LINK_KEY": base64.StdEncoding.EncodeToString(cur), "FORMS_PUBLIC_LINK_KEY_VERSION": "3",
		"FORMS_PUBLIC_LINK_PREVIOUS_KEYS": " 1:" + base64.StdEncoding.EncodeToString(one) + ", 2:" + base64.StdEncoding.EncodeToString(two)}
	got, err := publicLinkKeys(func(k string) string { return env[k] }, envProd, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	if got.Current != 3 || !bytes.Equal(got.ByVer[3], cur) || !bytes.Equal(got.ByVer[1], one) || !bytes.Equal(got.ByVer[2], two) {
		t.Fatalf("keys %+v, want the current version 3 and the former 1 and 2", got)
	}
}
