//go:build isolation

package isolation

import (
	"net/http"
	"testing"

	"github.com/ortus/ortus-crm/backend/test/isolation/matrix"
)

// withIfMatch adds to every command what the rows of fleet_pool.yaml cannot carry: If-Match (the matrix format has
// no headers, README.md). Without it the gateway answers 428 before the handler; with a revision the handler answers
// first for the record: a missing or foreign publication or request is 404 before its revision is compared.
func withIfMatch(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			r.Header.Set("If-Match", `"1"`)
		}
		h.ServeHTTP(w, r)
	})
}

// fleetPoolIfMatchRows (W2.07, AC-01): the withdrawal of a publication and the decision of a request with If-Match —
// an id that names no publication or request is 404, the same for the owner, for the releasing manager and for
// another tenant (the AC-01 twin of the matrix compares a foreign id with a missing one).
var fleetPoolIfMatchRows = matrix.File{
	Module: "fleet_pool_if_match",
	Endpoints: []matrix.Endpoint{
		{
			Op:      "withdrawDriverPoolPublication",
			Method:  http.MethodPost,
			Path:    "/api/v1/tenants/{tenantId}/fleet/driver-pool/publications/{publicationId}/withdrawal",
			Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{
				{Actor: "a.owner", Params: map[string]string{"tenantId": "tenant:a", "publicationId": "vehicle:a.msk1"},
					Status: http.StatusNotFound, Code: "not_found", Body: "{}", Note: "id машины — не публикация (AC-01)"},
				{Actor: "a.manager-msk2", Params: map[string]string{"tenantId": "tenant:a", "publicationId": "vehicle:a.msk1"},
					Status: http.StatusNotFound, Code: "not_found", Body: "{}",
					Note: "менеджер фирмы-источника: шлюз пропускает (approve), хендлер — 404"},
				{Actor: "b.owner", Params: map[string]string{"tenantId": "tenant:a", "publicationId": "vehicle:a.msk1"},
					Status: http.StatusNotFound, Absent: []string{"tenant:a", "vehicle:a.msk1"}, Body: "{}"},
			},
		},
		{
			Op:      "decideDriverTransfer",
			Method:  http.MethodPost,
			Path:    "/api/v1/tenants/{tenantId}/fleet/driver-transfer-requests/{requestId}/decision",
			Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{
				{Actor: "a.owner", Params: map[string]string{"tenantId": "tenant:a", "requestId": "vehicle:a.msk1"},
					Status: http.StatusNotFound, Code: "not_found", Body: `{"decision": "approve"}`, Note: "id машины — не запрос (AC-01)"},
				{Actor: "a.manager-msk2", Params: map[string]string{"tenantId": "tenant:a", "requestId": "vehicle:a.msk1"},
					Status: http.StatusNotFound, Code: "not_found", Body: `{"decision": "reject"}`,
					Note: "менеджер фирмы-источника: шлюз пропускает (approve), хендлер — 404"},
				{Actor: "b.owner", Params: map[string]string{"tenantId": "tenant:a", "requestId": "vehicle:a.msk1"},
					Status: http.StatusNotFound, Absent: []string{"tenant:a", "vehicle:a.msk1"}, Body: `{"decision": "approve"}`},
			},
		},
	},
}

func TestIsolationFleetPoolIfMatch(t *testing.T) {
	t.Parallel()
	s := &matrix.Suite{
		Refs:   suite.Refs,
		Target: matrix.Target{Handler: withIfMatch(suite.Target.Handler), Authenticate: suite.Target.Authenticate},
		Strict: suite.Strict,
	}
	matrix.Run(t, s, fleetPoolIfMatchRows)
}
