// Package test is the shared harness of the Go suites under backend/test (isolation, later concurrency):
// a fixed clock, a throw-away PostgreSQL server and a reader of RFC 9457 Problem Details.
//
// Suites use testcontainers only (CLAUDE.md, plan §3.6): there is no switch to an external server, and without
// Docker StartPostgres fails instead of skipping, so a missing database never turns a suite green.
package test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"time"

	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// msk is Europe/Moscow without DST (UTC+3), the zone of the pilot (W0.11 Clock).
var msk = time.FixedZone("MSK", 3*3600)

// now is the fixed «now» of the suites: Thursday 1 October 2026, 10:30 MSK (the demo «now» of the prototype).
var now = time.Date(2026, time.October, 1, 10, 30, 0, 0, msk)

// Now returns the fixed «now» of the suites. Tests derive every instant from it instead of date literals.
func Now() time.Time { return now }

// Until returns Now() + d.
func Until(d time.Duration) time.Time { return now.Add(d) }

// Image returns the PostgreSQL image of the suites: the first of migratetest.Images()
// (PG_TEST_IMAGES, default PostgreSQL 17.11 — the image of the compose stand).
func Image() string { return migratetest.Images()[0] }

// StartPostgres starts a container server for Image() with the Ortus roles created.
// The returned stop function terminates it. Intended for TestMain.
func StartPostgres(ctx context.Context) (*migratetest.Cluster, func(), error) {
	return migratetest.Start(ctx, Image())
}

// ProblemContentType is the media type of error bodies (RFC 9457).
const ProblemContentType = "application/problem+json"

// Problem is an error body of the API (OpenAPI components.schemas.Problem).
type Problem struct {
	Type      string `json:"type"`
	Title     string `json:"title"`
	Status    int    `json:"status"`
	Code      string `json:"code"`
	Detail    string `json:"detail,omitempty"`
	RequestID string `json:"requestId"`
}

// ErrNotProblem is returned by ParseProblem when a response is not a valid Problem Details body.
var ErrNotProblem = errors.New("not a problem response")

// ParseProblem checks the content type and the required fields (type, title, status, code, requestId).
func ParseProblem(contentType string, body []byte) (Problem, error) {
	if mt, _, err := mime.ParseMediaType(contentType); err != nil || mt != ProblemContentType {
		return Problem{}, fmt.Errorf("%w: content type %q, want %s", ErrNotProblem, contentType, ProblemContentType)
	}
	var p Problem
	if err := json.Unmarshal(body, &p); err != nil {
		return Problem{}, fmt.Errorf("%w: problem body: %w", ErrNotProblem, err)
	}
	for _, f := range []struct {
		name  string
		empty bool
	}{
		{"type", p.Type == ""},
		{"title", p.Title == ""},
		{"status", p.Status == 0},
		{"code", p.Code == ""},
		{"requestId", p.RequestID == ""},
	} {
		if f.empty {
			return Problem{}, fmt.Errorf("%w: required field %s is missing", ErrNotProblem, f.name)
		}
	}
	return p, nil
}
