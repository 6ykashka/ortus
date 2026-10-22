package forms

import (
	"encoding/base64"
	"slices"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Limits of a page of a list (parameters Limit and Cursor of the contract).
const (
	defaultLimit = 50
	maxLimit     = 200
)

// paginate returns the page of ids after the cursor (the last id of the previous page) and the next cursor; a cursor
// of another list is 400 malformed_request.
func paginate(ids []uuid.UUID, cursor *string, limit *int) (from, to int, next *string, err error) {
	n := defaultLimit
	if limit != nil {
		n = min(max(*limit, 1), maxLimit)
	}
	if cursor != nil && *cursor != "" {
		raw, derr := base64.RawURLEncoding.DecodeString(*cursor)
		id, perr := uuid.FromBytes(raw)
		i := slices.Index(ids, id)
		if derr != nil || perr != nil || i < 0 {
			return 0, 0, nil, problem.New(problem.CodeMalformedRequest, "")
		}
		from = i + 1
	}
	to = min(from+n, len(ids))
	if to < len(ids) {
		c := base64.RawURLEncoding.EncodeToString(ids[to-1][:])
		next = &c
	}
	return from, to, next, nil
}
