package data

import (
	"strconv"
	"strings"

	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.50: shared command helpers of the modules (If-Match; Q-W1.05-18)
)

// revPrefix is the form of the ETag of the scenario server MSW W4.06 («"rev-N"»).
const revPrefix = `"rev-`

// checkRevision compares If-Match with the revision of a view or an export job as kit.CheckRevision does (missing —
// 428, anything else — 412) and also takes «"rev-N"»: the lists of the tag carry no ETag of a row, the client builds
// If-Match from the revision of the row, and MSW names it «"rev-N"» (Q-W1.08-9, Q-W2.41-1).
func checkRevision(ifMatch string, current int64) error {
	v := strings.TrimSpace(ifMatch)
	if n, ok := strings.CutPrefix(v, revPrefix); ok {
		if digits, ok := strings.CutSuffix(n, `"`); ok {
			if _, err := strconv.ParseUint(digits, 10, 63); err == nil {
				v = `"` + digits + `"`
			}
		}
	}
	return kit.CheckRevision(v, current)
}
