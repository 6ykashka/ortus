package kit

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// NoStore is Cache-Control of every response of the module (the contract: private, no-store).
const NoStore = "private, no-store"

// Meta returns Cache-Control and X-Request-Id of a response.
func Meta(ctx context.Context) (cacheControl, requestID *string) {
	cc, rid := NoStore, requestid.FromContext(ctx)
	return &cc, &rid
}

// ETag is the strong ETag of a revision: "<revision>".
func ETag(revision int64) string { return `"` + strconv.FormatInt(revision, 10) + `"` }

// IfMatch requires If-Match equal to the ETag of the current revision: otherwise 412 revision_mismatch.
func IfMatch(header string, current int64) error {
	h := strings.TrimSpace(header)
	if len(h) < 3 || h[0] != '"' || h[len(h)-1] != '"' {
		return problem.New(CodeRevisionMismatch, "")
	}
	rev, err := strconv.ParseInt(h[1:len(h)-1], 10, 64)
	if err != nil || rev != current {
		return problem.New(CodeRevisionMismatch, "Данные изменились: обновите и повторите.")
	}
	return nil
}

// Page sizes (common/parameters.yaml Limit).
const (
	DefaultLimit = 50
	MaxLimit     = 200
)

// Limit returns the page size of a list: DefaultLimit when absent, 400 outside 1…MaxLimit.
func Limit(p *int) (int, error) {
	if p == nil {
		return DefaultLimit, nil
	}
	if *p < 1 || *p > MaxLimit {
		return 0, problem.New(problem.CodeMalformedRequest, "limit: 1…200")
	}
	return *p, nil
}

// Cursor is the position of keyset pagination: the sort key and the id of the last row of a page.
type Cursor struct {
	Key string    `json:"k"`
	ID  uuid.UUID `json:"i"`
}

// Encode returns the opaque cursor of the contract.
func (c Cursor) Encode() string {
	raw, _ := json.Marshal(c) // two strings never fail
	return base64.RawURLEncoding.EncodeToString(raw)
}

// DecodeCursor reads an opaque cursor (nil: the first page); a cursor that does not decode is 400.
func DecodeCursor(p *string) (*Cursor, error) {
	if p == nil || *p == "" {
		return nil, nil //nolint:nilnil // no cursor: the first page
	}
	raw, err := base64.RawURLEncoding.DecodeString(*p)
	if err != nil {
		return nil, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	var c Cursor
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil || c.ID == uuid.Nil {
		return nil, problem.New(problem.CodeMalformedRequest, "cursor")
	}
	return &c, nil
}

// Complete stores the outcome of a command in tx, the transaction of its effect (idem.CompleteInTx, 10 §3.5): the
// body is encoded as the strict server encodes it. Without an Idempotency-Key record (tests) it does nothing; a lost
// lease rolls the effect back with 409 idempotency_in_progress (the client repeats with the same key).
func Complete(ctx context.Context, tx pgx.Tx, status int, etag string, body any) error {
	var buf bytes.Buffer
	header := http.Header{}
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return Unavailable(err)
		}
		header.Set("Content-Type", "application/json")
	}
	if etag != "" {
		header.Set("ETag", etag)
	}
	err := idem.CompleteInTx(ctx, tx, status, header, buf.Bytes())
	switch {
	case err == nil, errors.Is(err, idem.ErrNoRecord):
		return nil
	case errors.Is(err, idem.ErrLeaseLost):
		return problem.New(CodeInProgress, "")
	}
	return Unavailable(err)
}
