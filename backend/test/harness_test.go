package test

import (
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

func TestNowIsFixed(t *testing.T) {
	t.Parallel()
	now := Now()
	if got := now.Format(time.RFC3339); got != "2026-10-01T10:30:00+03:00" {
		t.Fatalf("Now() = %s, want 2026-10-01T10:30:00+03:00", got)
	}
	if now.Weekday() != time.Thursday {
		t.Fatalf("Now().Weekday() = %s, want Thursday", now.Weekday())
	}
	if _, off := now.Zone(); off != 3*3600 {
		t.Fatalf("Now() offset = %d, want MSK +03:00", off)
	}
	if !Now().Equal(now) {
		t.Fatal("Now() must not move")
	}
}

func TestUntil(t *testing.T) {
	t.Parallel()
	got := Until(7 * 24 * time.Hour)
	if got.Format(time.DateOnly) != "2026-10-08" || !got.Equal(Now().Add(7*24*time.Hour)) {
		t.Fatalf("Until(7d) = %s, want 8 October, 10:30 MSK", got)
	}
}

func TestImage(t *testing.T) {
	t.Setenv("PG_TEST_IMAGES", "")
	if got := Image(); got != migratetest.Postgres17 {
		t.Fatalf("Image() = %s, want %s", got, migratetest.Postgres17)
	}
	t.Setenv("PG_TEST_IMAGES", "postgres:16.4, postgres:17.11")
	if got := Image(); got != "postgres:16.4" {
		t.Fatalf("Image() with PG_TEST_IMAGES = %s, want the first image", got)
	}
}

func TestParseProblem(t *testing.T) {
	t.Parallel()
	body := `{"type":"about:blank","title":"Not Found","status":404,"code":"not_found","detail":"…","requestId":"r1"}`
	p, err := ParseProblem("application/problem+json; charset=utf-8", []byte(body))
	if err != nil {
		t.Fatal(err)
	}
	want := Problem{Type: "about:blank", Title: "Not Found", Status: 404, Code: "not_found", Detail: "…", RequestID: "r1"}
	if p != want {
		t.Fatalf("ParseProblem = %+v, want %+v", p, want)
	}
}

func TestParseProblemErrors(t *testing.T) {
	t.Parallel()
	full := `{"type":"about:blank","title":"T","status":403,"code":"forbidden_action","requestId":"r1"}`
	cases := []struct {
		name, contentType, body, want string
	}{
		{"content type", "application/json", full, "application/problem+json"},
		{"not json", ProblemContentType, `<html>`, "problem body"},
		{"no type", ProblemContentType, `{"title":"T","status":403,"code":"c","requestId":"r"}`, "type"},
		{"no title", ProblemContentType, `{"type":"x","status":403,"code":"c","requestId":"r"}`, "title"},
		{"no status", ProblemContentType, `{"type":"x","title":"T","code":"c","requestId":"r"}`, "status"},
		{"no code", ProblemContentType, `{"type":"x","title":"T","status":403,"requestId":"r"}`, "code"},
		{"no requestId", ProblemContentType, `{"type":"x","title":"T","status":403,"code":"c"}`, "requestId"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := ParseProblem(tc.contentType, []byte(tc.body))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("ParseProblem error = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}
