package tenantctx

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// W4.60 (Q-W4.07-3): владелец сохраняет доступ к биллингу — операции «в любом состоянии» (сетка, заявки на тариф)
// проходят в grace, read_only и suspended и для изменений; членство проверяется как у Resolve, организация вне
// рабочего цикла (provisioning, closing, closed) по-прежнему не существует.
func TestResolveRecovery(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, raw, status, state string
		code                     string
		readOnly                 bool
	}{
		{"trial", tenant.String(), "active", "trial", "", false},
		{"active", tenant.String(), "active", "active", "", false},
		{"grace — только чтение для прочего, но не ошибка", tenant.String(), "active", "grace", "", true},
		{"read_only", tenant.String(), "active", "read_only", "", true},
		{"suspended", tenant.String(), "active", "suspended", "", true},
		{"provisioning", tenant.String(), "active", "provisioning", problem.CodeNotFound, false},
		{"closing", tenant.String(), "active", "closing", problem.CodeNotFound, false},
		{"closed", tenant.String(), "active", "closed", problem.CodeNotFound, false},
		{"членство suspended", tenant.String(), "suspended", "active", problem.CodeNotFound, false},
		{"членство ended", tenant.String(), "ended", "suspended", problem.CodeNotFound, false},
		{"чужая организация", uuid.NewString(), "active", "suspended", problem.CodeNotFound, false},
		{"не UUID", "t-cargo", "active", "suspended", problem.CodeNotFound, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := ResolveRecovery(t.Context(), dirWith(tc.status, tc.state, true), acc, tc.raw)
			if tc.code != "" {
				if !problem.Is(err, tc.code) {
					t.Fatalf("err = %v, want %s", err, tc.code)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.TenantID != tenant || got.AccountID != acc || got.PersonID != person || !got.Owner || got.ReadOnly != tc.readOnly {
				t.Fatalf("context = %+v", got)
			}
		})
	}
}
