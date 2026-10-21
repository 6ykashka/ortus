package tasks

import (
	"encoding/base64"
	"strconv"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Page sizes of the lists (common/parameters.yaml Limit).
const (
	defaultLimit = 50
	maxLimit     = 200
)

// pageOf cuts a page out of items in their order: cursor is the opaque key of the last item of the previous page
// (key of an item — unique and stable), limit 1…200 (50 by default). The next cursor is nil on the last page.
func pageOf[T any](items []T, key func(T) string, cursor *string, limit *int) ([]T, *string, error) {
	n := defaultLimit
	if limit != nil {
		if *limit < 1 || *limit > maxLimit {
			return nil, nil, problem.New(codeMalformed, "limit: 1…"+strconv.Itoa(maxLimit))
		}
		n = *limit
	}
	start := 0
	if cursor != nil && *cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(*cursor)
		if err != nil {
			return nil, nil, problem.Wrap(codeMalformed, err)
		}
		start = -1
		for i, it := range items {
			if key(it) == string(raw) {
				start = i + 1
				break
			}
		}
		if start < 0 {
			return nil, nil, problem.New(codeMalformed, "Курсор не подходит к запросу.")
		}
	}
	end := min(start+n, len(items))
	out := append([]T(nil), items[start:end]...)
	if out == nil {
		out = []T{}
	}
	if end >= len(items) {
		return out, nil, nil
	}
	next := base64.RawURLEncoding.EncodeToString([]byte(key(items[end-1])))
	return out, &next, nil
}
