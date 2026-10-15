package modulesreg

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// settingsTypes are the modules with typed settings (ModuleSettings of the contract) and their defaults: the presets
// of MSW W0.13 (FLEET_SETTINGS, the example getModuleSettings/ok, the forms and tasks of the seed).
var settingsTypes = map[string]func([]byte) (any, error){
	KeyFleet: decodeFleet, KeySpa: decodeSpa, KeyForms: decodeForms, KeyTasks: decodeTasks,
}

var settingsDefaults = map[string]string{
	KeyFleet: `{"moduleKey":"fleet","reservationTtlMinutes":30,"requirePhotoRoles":["front","rear","left","right","odometer"],"managerApprovalForRelease":false,"maxOfflineDraftHours":24}`,
	KeySpa:   `{"moduleKey":"spa","cancellationMinutes":120,"allowNegativeStock":false,"defaultTimeZone":"Europe/Moscow"}`,
	KeyForms: `{"moduleKey":"forms","allowPublicForms":true,"maxPublicUploadBytes":10485760,"defaultRetentionDays":365}`,
	KeyTasks: `{"moduleKey":"tasks","allowUnassignedTasks":true}`,
}

// settingsTarget returns the installation that holds the settings of key: an installed module (active, draining,
// read_only) or a core module (no row: defaults at revisionNone).
func (s *Service) settingsTarget(ctx context.Context, tc tenantctx.TenantContext, key string) (Installation, error) {
	if !IsInstallable(key) && !isCore(key) {
		return Installation{}, notFound()
	}
	inst, err := s.Installations(ctx, tc.TenantID)
	if err != nil {
		return Installation{}, err
	}
	in, ok := current(inst, key)
	if IsInstallable(key) && (!ok || in.State == StateDisabled) {
		return Installation{}, notInstalled(key)
	}
	if !ok {
		in.State = StateActive // a core module is always on; its row is written with the first settings
	}
	return in, nil
}

// Settings returns the typed settings of a module (getModuleSettings).
func (s *Service) Settings(ctx context.Context, tenantID uuid.UUID, key string) (Settings, error) {
	in, err := s.settingsTarget(ctx, tenantctx.TenantContext{TenantID: tenantID}, key)
	if err != nil {
		return Settings{}, err
	}
	def, typed := settingsDefaults[key]
	if !typed {
		return Settings{}, notFound()
	}
	body := in.Settings
	if len(bytes.TrimSpace(body)) == 0 || bytes.Equal(bytes.TrimSpace(body), []byte("{}")) {
		body = []byte(def)
	}
	return Settings{Body: body, Revision: in.Revision}, nil
}

// UpdateSettings replaces the typed settings of a module (updateModuleSettings): the whole document of the type of
// the module, moduleKey of the body equal to the path.
func (s *Service) UpdateSettings(ctx context.Context, tc tenantctx.TenantContext, key string, body []byte, ifMatch string) (Settings, error) {
	in, err := s.settingsTarget(ctx, tc, key)
	if err != nil {
		return Settings{}, err
	}
	want, err := parseIfMatch(ifMatch)
	if err != nil {
		return Settings{}, err
	}
	decode, typed := settingsTypes[key]
	if !typed {
		return Settings{}, problem.New(codeValidationFailed, "У модуля нет настроек.")
	}
	doc, err := decode(body)
	if err != nil {
		return Settings{}, problem.New(codeValidationFailed, "Проверьте настройки модуля: "+err.Error())
	}
	if want != in.Revision {
		return Settings{}, revisionMismatch()
	}
	norm, err := json.Marshal(doc)
	if err != nil {
		return Settings{}, dependency(err)
	}
	retained := in.RetainedAccess
	if retained == "" {
		retained = RetainHistory
	}
	next, err := s.Store.Apply(ctx, tc.TenantID, Change{
		Key: key, StoredKey: in.StoredKey, From: in.Revision, State: in.State, Retained: retained, Settings: norm,
		ActorID: tc.PersonID, Action: ActionSettings,
	})
	switch {
	case errors.Is(err, ErrConflict):
		return Settings{}, revisionMismatch()
	case err != nil:
		return Settings{}, dependency(err)
	}
	return Settings{Body: norm, Revision: next.Revision}, nil
}

// strict decodes body into v: no unknown fields, one JSON value.
func strict(body []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errors.New("неверный JSON или лишнее поле")
	}
	if dec.More() {
		return errors.New("лишние данные после документа")
	}
	return nil
}

func moduleKeyIs(got, want string) error {
	if got != want {
		return fmt.Errorf("moduleKey %q не совпадает с адресом", got)
	}
	return nil
}

func required[T any](field string, v *T) error {
	if v == nil {
		return fmt.Errorf("%s: обязательное поле", field)
	}
	return nil
}

func between(field string, v, lo, hi int64) error {
	if v < lo || v > hi {
		return fmt.Errorf("%s: от %d до %d", field, lo, hi)
	}
	return nil
}

const maxInt = int64(1<<63 - 1)

var photoRoles = []string{"front", "rear", "left", "right", "odometer", "cargo", "damage"}

type fleetSettings struct {
	ModuleKey                 string   `json:"moduleKey"`
	ReservationTTLMinutes     *int64   `json:"reservationTtlMinutes"`
	RequirePhotoRoles         []string `json:"requirePhotoRoles"`
	ManagerApprovalForRelease *bool    `json:"managerApprovalForRelease"`
	MaxOfflineDraftHours      *int64   `json:"maxOfflineDraftHours"`
}

func decodeFleet(body []byte) (any, error) {
	var v fleetSettings
	if err := strict(body, &v); err != nil {
		return nil, err
	}
	err := errors.Join(moduleKeyIs(v.ModuleKey, KeyFleet), required("reservationTtlMinutes", v.ReservationTTLMinutes),
		required("managerApprovalForRelease", v.ManagerApprovalForRelease), required("maxOfflineDraftHours", v.MaxOfflineDraftHours))
	if v.RequirePhotoRoles == nil {
		err = errors.Join(err, errors.New("requirePhotoRoles: обязательное поле"))
	}
	if err != nil {
		return nil, err
	}
	err = errors.Join(between("reservationTtlMinutes", *v.ReservationTTLMinutes, 5, 120),
		between("maxOfflineDraftHours", *v.MaxOfflineDraftHours, 1, 72))
	for i, r := range v.RequirePhotoRoles {
		if !slices.Contains(photoRoles, r) || slices.Contains(v.RequirePhotoRoles[:i], r) {
			err = errors.Join(err, fmt.Errorf("requirePhotoRoles: %q неизвестен или повторяется", r))
		}
	}
	return v, err
}

type spaSettings struct {
	ModuleKey           string  `json:"moduleKey"`
	CancellationMinutes *int64  `json:"cancellationMinutes"`
	AllowNegativeStock  *bool   `json:"allowNegativeStock"`
	DefaultTimeZone     *string `json:"defaultTimeZone"`
}

func decodeSpa(body []byte) (any, error) {
	var v spaSettings
	if err := strict(body, &v); err != nil {
		return nil, err
	}
	err := errors.Join(moduleKeyIs(v.ModuleKey, KeySpa), required("cancellationMinutes", v.CancellationMinutes),
		required("allowNegativeStock", v.AllowNegativeStock), required("defaultTimeZone", v.DefaultTimeZone))
	if err != nil {
		return nil, err
	}
	err = between("cancellationMinutes", *v.CancellationMinutes, 0, maxInt)
	if *v.AllowNegativeStock {
		err = errors.Join(err, errors.New("allowNegativeStock: отрицательный остаток не разрешается"))
	}
	if _, zerr := time.LoadLocation(*v.DefaultTimeZone); zerr != nil || *v.DefaultTimeZone == "" || *v.DefaultTimeZone == "Local" {
		err = errors.Join(err, errors.New("defaultTimeZone: нужна зона IANA"))
	}
	return v, err
}

type formsSettings struct {
	ModuleKey            string `json:"moduleKey"`
	AllowPublicForms     *bool  `json:"allowPublicForms"`
	MaxPublicUploadBytes *int64 `json:"maxPublicUploadBytes"`
	DefaultRetentionDays *int64 `json:"defaultRetentionDays"`
}

func decodeForms(body []byte) (any, error) {
	var v formsSettings
	if err := strict(body, &v); err != nil {
		return nil, err
	}
	err := errors.Join(moduleKeyIs(v.ModuleKey, KeyForms), required("allowPublicForms", v.AllowPublicForms),
		required("maxPublicUploadBytes", v.MaxPublicUploadBytes), required("defaultRetentionDays", v.DefaultRetentionDays))
	if err != nil {
		return nil, err
	}
	return v, errors.Join(between("maxPublicUploadBytes", *v.MaxPublicUploadBytes, 1, maxInt),
		between("defaultRetentionDays", *v.DefaultRetentionDays, 1, maxInt))
}

type tasksSettings struct {
	ModuleKey            string  `json:"moduleKey"`
	DefaultProjectID     *string `json:"defaultProjectId,omitempty"`
	AllowUnassignedTasks *bool   `json:"allowUnassignedTasks"`
}

func decodeTasks(body []byte) (any, error) {
	var v tasksSettings
	if err := strict(body, &v); err != nil {
		return nil, err
	}
	err := errors.Join(moduleKeyIs(v.ModuleKey, KeyTasks), required("allowUnassignedTasks", v.AllowUnassignedTasks))
	if err == nil && v.DefaultProjectID != nil && !isUUID(*v.DefaultProjectID) {
		err = errors.New("defaultProjectId: нужен UUID")
	}
	return v, err
}

func isUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil && len(s) == 36
}
