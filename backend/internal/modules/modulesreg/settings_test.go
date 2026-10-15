package modulesreg

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Типы настроек: обязательные поля, ключ модуля в теле, диапазоны и формат (контракт ModuleSettings).
func TestSettingsDocuments(t *testing.T) {
	t.Parallel()
	fleetOK := `{"moduleKey":"fleet","reservationTtlMinutes":45,"requirePhotoRoles":["front","cargo"],"managerApprovalForRelease":true,"maxOfflineDraftHours":12}`
	tasksOK := `{"moduleKey":"tasks","allowUnassignedTasks":false,"defaultProjectId":"` + uuid.NewString() + `"}`
	for key, body := range map[string]string{"fleet": fleetOK, "tasks": tasksOK} {
		if _, err := settingsTypes[key]([]byte(body)); err != nil {
			t.Errorf("%s: %v", key, err)
		}
	}
	for name, c := range map[string]struct{ key, body string }{
		"логистика без фото":       {"fleet", `{"moduleKey":"fleet","reservationTtlMinutes":45,"managerApprovalForRelease":true,"maxOfflineDraftHours":12}`},
		"логистика без срока":      {"fleet", `{"moduleKey":"fleet","requirePhotoRoles":[],"managerApprovalForRelease":true,"maxOfflineDraftHours":12}`},
		"логистика — чужой ключ":   {"fleet", `{"moduleKey":"spa","reservationTtlMinutes":45,"requirePhotoRoles":[],"managerApprovalForRelease":true,"maxOfflineDraftHours":12}`},
		"салон — чужой ключ":       {"spa", `{"moduleKey":"fleet","cancellationMinutes":0,"allowNegativeStock":false,"defaultTimeZone":"Europe/Moscow"}`},
		"салон без зоны":           {"spa", `{"moduleKey":"spa","cancellationMinutes":0,"allowNegativeStock":false}`},
		"салон — зона Local":       {"spa", `{"moduleKey":"spa","cancellationMinutes":0,"allowNegativeStock":false,"defaultTimeZone":"Local"}`},
		"формы без размера":        {"forms", `{"moduleKey":"forms","allowPublicForms":true,"defaultRetentionDays":1}`},
		"формы — нулевой размер":   {"forms", `{"moduleKey":"forms","allowPublicForms":true,"maxPublicUploadBytes":0,"defaultRetentionDays":1}`},
		"задачи без флага":         {"tasks", `{"moduleKey":"tasks"}`},
		"задачи — проект не UUID":  {"tasks", `{"moduleKey":"tasks","allowUnassignedTasks":true,"defaultProjectId":"p-1"}`},
		"задачи — два документа":   {"tasks", `{"moduleKey":"tasks","allowUnassignedTasks":true} {}`},
		"задачи — UUID без дефиса": {"tasks", `{"moduleKey":"tasks","allowUnassignedTasks":true,"defaultProjectId":"` + strings.ReplaceAll(uuid.NewString(), "-", "") + `"}`},
	} {
		if _, err := settingsTypes[c.key]([]byte(c.body)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestSetValidation(t *testing.T) {
	t.Parallel()
	row := Installation{Key: "spa", StoredKey: "spa", State: StateActive, Revision: 3}
	for name, u := range map[string]Update{
		"неизвестный доступ": {Retained: "forever"},
		"длинная причина":    {Reason: strings.Repeat("я", 501)},
	} {
		if _, err := service(t, newStore(row)).Set(t.Context(), ownerCtx, "spa", u, `"rev-3"`); !problem.Is(err, "validation_failed") {
			t.Errorf("%s: %v", name, err)
		}
	}
	// Problem.code хранилища проходит как есть, прочие сбои — dependency_unavailable.
	store := newStore(row)
	store.err = problem.New("tenant_suspended", "")
	_, err := service(t, store).Set(t.Context(), ownerCtx, "spa", Update{}, `"rev-3"`)
	wantCode(t, err, "tenant_suspended")
}

// applyStore fails Apply only: the race of a settle and the failure of a write.
type applyStore struct {
	*fakeStore
	applyErr error
}

func (s *applyStore) Apply(context.Context, uuid.UUID, Change) (Installation, error) {
	return Installation{}, s.applyErr
}

// Завершение draining в гонке: другой запрос уже записал итог — берётся сохранённое состояние; сбой записи —
// dependency_unavailable.
func TestSettleRaceAndFailure(t *testing.T) {
	t.Parallel()
	draining := Installation{Key: "spa", StoredKey: "spa", State: StateDraining, RetainedAccess: RetainHistory, Revision: 4}
	race := &applyStore{fakeStore: newStore(draining), applyErr: ErrConflict}
	svc := &Service{Store: race, Activity: DefaultRegistry(), Now: func() time.Time { return seedNow }}
	inst, err := svc.Installations(t.Context(), tenantA)
	if err != nil || inst["spa"].State != StateDraining {
		t.Errorf("race: %+v %v", inst, err)
	}
	broken := &applyStore{fakeStore: newStore(draining), applyErr: errors.New("disk full")}
	svc.Store = broken
	_, err = svc.Installations(t.Context(), tenantA)
	wantCode(t, err, problem.CodeDependencyUnavailable)
}
