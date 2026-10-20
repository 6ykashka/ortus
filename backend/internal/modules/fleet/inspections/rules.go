package inspections

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/domain/fleetrules"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Problem codes of the module (api/errors.yaml).
const (
	codeValidation         = "validation_failed"
	codeOdometerDecrease   = "odometer_decrease"
	codeRevisionRequired   = "revision_required"
	codeRevisionMismatch   = "revision_mismatch"
	codeInvalidTransition  = "invalid_transition"
	codeIncomplete         = "inspection_incomplete"
	codePhotoNotReady      = "photo_not_ready"
	codeReservationExpired = "reservation_expired"
	codeIdemInProgress     = "idempotency_in_progress"
	codeModuleReadOnly     = "module_read_only"
)

// Kinds of an inspection.
const (
	kindDeparture = "departure"
	kindReturn    = "return"
)

// Severities and states of a defect (fleet.defects, tenant 0002/0010).
const (
	severityBlocking = "blocking"
	stateOpen        = "open"
	stateInReview    = "in_review"
	stateResolved    = "resolved"
	stateConfirmed   = "confirmed_out_of_service"
)

// Decisions of decideInspectionDefect.
const (
	decisionAllow   = "allow_departure"
	decisionConfirm = "confirm_out_of_service"
)

// Limits of the contract (components/fleet/schemas.yaml).
const (
	maxPhotos        = 30
	maxDefects       = 20
	maxZone          = 100
	maxDescription   = 2000
	maxComment       = 1000
	maxDamage        = 5000
	maxDecisionNote  = 2000
	maxCheckKey      = 100
	maxCheckComment  = 1000
	maxFuelPercent   = 100
	defaultPageLimit = 50
	maxPageLimit     = 200
)

// Texts of the prototype (api.js submitDeparture, decideDefect) and of MSW W2.00.
const (
	allowTitle      = "Менеджер разрешил выезд: дефект признан некритичным"
	noteBlocked     = "критический дефект на проверке"
	noteConfirmed   = "неисправность подтверждена"
	detailNotReady  = "Не все фото загружены на сервер"
	detailDecided   = "Дефект уже решён."
	detailStale     = "Данные изменились. Обновите страницу и повторите."
	detailChecklist = "Чек-лист изменился. Обновите осмотр."
	detailForeign   = "Фото не относится к этому осмотру."
	detailSameFile  = "Одно фото прикреплено дважды. Сделайте отдельный снимок."
	detailUsedFile  = "Фото уже прикреплено к другому осмотру. Сделайте новый снимок."
)

// checkItem is an item of a checklist version: a single_choice field of its definition (W2.45) or, for a version
// whose definition is not a checklist form, an element of fleet.checklist_versions.items.
type checkItem struct {
	Key                  string `json:"key"`
	Label                string `json:"label"`
	Required             bool   `json:"required"`
	FailureBlocksRelease bool   `json:"failureBlocksRelease"`
	// Options are the results the item takes (FormField.options); nil — pass, fail and not_applicable.
	Options []fleetapi.ChoiceOption `json:"-"`
	// Blocking are the results that do not release the vehicle (FormField.blockingValues); nil — fail when
	// FailureBlocksRelease.
	Blocking []string `json:"-"`
}

// checklist is a version of the checklist of a kind; Roles are the required photo roles of the contract.
// Definition is the FormDefinition of the version, nil when the stored one is not a checklist form (the version is
// read by its items).
type checklist struct {
	ID         uuid.UUID
	Kind       string
	Version    int
	Items      []checkItem
	Roles      []string
	Definition *fleetapi.FormDefinition
}

// Photo roles of the contract ↔ fleet.inspection_photos.role (tenant 0002). damage has no row: a role has one row
// per inspection, damage photos are many — they live in answers.photos only.
var storedRoles = map[string]string{
	roleFront: roleFront, roleRear: "back", roleLeft: roleLeft, roleRight: roleRight, roleOdometer: roleOdometer,
	roleCargo: roleCargo,
}

// Photo roles of the contract (InspectionPhoto.role).
const (
	roleFront    = "front"
	roleRear     = "rear"
	roleLeft     = "left"
	roleRight    = "right"
	roleOdometer = "odometer"
	roleCargo    = "cargo"
	roleDamage   = "damage" // extra photos of a damage (any number)
)

// apiRoles are the photo roles of the contract.
var apiRoles = []string{roleFront, roleRear, roleLeft, roleRight, roleOdometer, roleCargo, roleDamage}

// storedRole returns the role of fleet.inspection_photos for a role of the contract.
func storedRole(api string) (string, bool) {
	db, ok := storedRoles[api]
	return db, ok
}

// apiRole returns the role of the contract for a stored role ("" — none).
func apiRole(db string) string {
	for api, stored := range storedRoles {
		if stored == db {
			return api
		}
	}
	return ""
}

// prototypeRoles maps PHOTO_SIDES of the prototype (fleetrules) to roles of the contract.
var prototypeRoles = map[string]string{"front": roleFront, "back": roleRear, "left": roleLeft, "right": roleRight, "odo": roleOdometer}

// fuelLevel is fleet.inspections.fuel_level of a percentage (the exact value is kept in answers).
func fuelLevel(percent int) string {
	switch {
	case percent <= 37:
		return "quarter"
	case percent <= 62:
		return "half"
	case percent <= 87:
		return "three_quarters"
	}
	return "full"
}

// plural chooses the Russian form for n: one (1, 21), few (2–4, 22–24), many (0, 5–20, 25…).
func plural(n int, one, few, many string) string {
	n %= 100
	switch {
	case n >= 11 && n <= 14:
		return many
	case n%10 == 1:
		return one
	case n%10 >= 2 && n%10 <= 4:
		return few
	}
	return many
}

// checklistID is the id of a built-in version: UUID v5 of the kind and the version, the same in every tenant.
func checklistID(kind string, version int) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:fleet:checklist:"+kind+":"+strconv.Itoa(version)))
}

// builtinChecklist is version 1 of the checklist of kind: DEP_CHECKS or RET_CHECKS and PHOTO_SIDES of the
// prototype (fleetrules, W2.01). It is published in a tenant at the first request.
func builtinChecklist(kind string) checklist {
	opts := fleetrules.RetChecks()
	if kind == kindDeparture {
		opts = fleetrules.DepChecks()
	}
	c := checklist{ID: checklistID(kind, 1), Kind: kind, Version: 1}
	for _, o := range opts {
		c.Items = append(c.Items, checkItem{Key: o.Key, Label: o.Label, Required: true})
	}
	for _, side := range fleetrules.PhotoSides() {
		c.Roles = append(c.Roles, prototypeRoles[side.Key])
	}
	return c
}

// missing lists what an inspection lacks (inspMissing of the prototype): «N фото» of the required roles and
// «N пунктов чек-листа» of the required items. A damage photo never stands for a role.
func missing(c checklist, photos []fleetapi.InspectionPhoto, checks []fleetapi.InspectionCheck) []string {
	var out []string
	photosLeft := 0
	for _, role := range c.Roles {
		if !slices.ContainsFunc(photos, func(p fleetapi.InspectionPhoto) bool { return string(p.Role) == role }) {
			photosLeft++
		}
	}
	if photosLeft > 0 {
		out = append(out, strconv.Itoa(photosLeft)+" фото")
	}
	itemsLeft := 0
	for _, it := range c.Items {
		if it.Required && !slices.ContainsFunc(checks, func(ch fleetapi.InspectionCheck) bool { return ch.Key == it.Key }) {
			itemsLeft++
		}
	}
	if itemsLeft > 0 {
		out = append(out, strconv.Itoa(itemsLeft)+" "+plural(itemsLeft, "пункт", "пункта", "пунктов")+" чек-листа")
	}
	return out
}

// incompleteDetail is the text of 409 inspection_incomplete (api.js submitDeparture, submitReturn).
func incompleteDetail(kind string, miss []string) string {
	if kind == kindDeparture {
		return "Осмотр не завершён: " + strings.Join(miss, ", ")
	}
	return "Сдача не завершена: " + strings.Join(miss, ", ")
}

// quantityRE is a Quantity of fleet.inspections.odometer_km (numeric(10,1) and the precision of the contract).
var quantityRE = regexp.MustCompile(`^[0-9]{1,9}(\.[0-9]{1,3})?$`)

func invalid(detail string) *problem.Error { return problem.New(codeValidation, detail) }

// parseQuantity parses a nonnegative decimal of the contract.
func parseQuantity(s string) (float64, error) {
	if !quantityRE.MatchString(s) {
		return 0, invalid("Введите число")
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, invalid("Введите число")
	}
	return v, nil
}

// checkOdometer is the rule «пробег не меньше начального» (LOG-09, odoError of the prototype): 422
// odometer_decrease with the text of the field. More than the start by 3000 km is a warning of the form only.
func checkOdometer(value string, minKm float64) error {
	km, err := parseQuantity(value)
	if err != nil {
		return err
	}
	if km < minKm {
		return problem.New(codeOdometerDecrease, fleetrules.OdoError(value, minKm))
	}
	return nil
}

func tooLong(s string, n int) bool { return utf8.RuneCountInString(s) > n }

func blank(s string) bool { return strings.TrimSpace(s) == "" }

// validateCreate checks the body of submitInspection that the strict server does not (enums, lengths, the
// reference of the kind, the severity of a return); the checklist, the photos and the odometer are checked
// against the data.
func validateCreate(b fleetapi.InspectionCreate) error {
	if err := validateHeader(b); err != nil {
		return err
	}
	if err := validateChecks(b.Checks); err != nil {
		return err
	}
	if err := validatePhotos(b.Photos); err != nil {
		return err
	}
	var defects []fleetapi.InspectionDefectReport
	if b.Defects != nil {
		defects = *b.Defects
	}
	return validateDefects(string(b.Kind), defects)
}

// validateHeader checks the kind with its reference, the fuel, the time and the texts of an inspection.
func validateHeader(b fleetapi.InspectionCreate) error {
	switch {
	case b.Kind != kindDeparture && b.Kind != kindReturn:
		return invalid("Вид осмотра — выезд или сдача.")
	case b.Kind == kindDeparture && b.ReservationId == nil:
		return invalid("Осмотр перед выездом оформляется по брони.")
	case b.Kind == kindReturn && b.TripId == nil:
		return invalid("Осмотр при сдаче оформляется по рейсу.")
	case b.FuelPercent < 0 || b.FuelPercent > maxFuelPercent:
		return invalid("Уровень топлива — от 0 до 100 %.")
	case b.CapturedAt.IsZero():
		return invalid("Нет времени осмотра.")
	case tooLongPtr(b.Comment, maxComment):
		return invalid("Комментарий — не длиннее 1000 символов.")
	case tooLongPtr(b.ReportedDamage, maxDamage):
		return invalid("Описание повреждений — не длиннее 5000 символов.")
	}
	return nil
}

// tooLongPtr reports whether an optional text is longer than n characters.
func tooLongPtr(s *string, n int) bool { return s != nil && tooLong(*s, n) }

func validateChecks(checks []fleetapi.InspectionCheck) error {
	if len(checks) == 0 {
		return invalid("Отметьте пункты чек-листа.")
	}
	seen := map[string]bool{}
	for _, c := range checks {
		switch {
		case blank(c.Key) || tooLong(c.Key, maxCheckKey) || seen[c.Key]:
			return invalid("Неверный пункт чек-листа.")
		case c.Result != "pass" && c.Result != "fail" && c.Result != "not_applicable":
			return invalid("Результат пункта — pass, fail или not_applicable.")
		case c.Comment != nil && tooLong(*c.Comment, maxCheckComment):
			return invalid("Комментарий пункта — не длиннее 1000 символов.")
		}
		seen[c.Key] = true
	}
	return nil
}

func validatePhotos(photos []fleetapi.InspectionPhoto) error {
	if len(photos) == 0 || len(photos) > maxPhotos {
		return invalid("Фото осмотра — от 1 до 30.")
	}
	seen := map[string]bool{}
	files := map[uuid.UUID]bool{}
	for _, p := range photos {
		role := string(p.Role)
		switch {
		case !slices.Contains(apiRoles, role):
			return invalid("Неизвестный ракурс фото.")
		case role != roleDamage && seen[role]:
			return invalid("Один ракурс — одно фото.")
		case p.FileId == uuid.Nil || p.CapturedAt.IsZero():
			return invalid("Фото без файла или времени съёмки.")
		case files[p.FileId]:
			return invalid(detailSameFile) // AC-04: five photos are five files
		}
		seen[role] = true
		files[p.FileId] = true
	}
	return nil
}

func validateDefects(kind string, defects []fleetapi.InspectionDefectReport) error {
	if len(defects) > maxDefects {
		return invalid("Дефектов — не больше 20.")
	}
	for _, d := range defects {
		switch {
		case blank(d.Zone) || tooLong(d.Zone, maxZone):
			return invalid("Выберите зону дефекта.")
		case blank(d.Description) || tooLong(d.Description, maxDescription):
			return invalid("Опишите дефект.")
		case d.Severity != "minor" && d.Severity != "major" && d.Severity != severityBlocking:
			return invalid("Неизвестная критичность дефекта.")
		case d.Severity == severityBlocking && kind != kindDeparture:
			return invalid("Критичность дефекта выбирается только перед выездом.")
		}
	}
	return nil
}

// inspectionStatus is Inspection.status of fleet.inspections.state: blocked waits for the manager
// (requires_review) or, once the defect is confirmed, is rejected.
func inspectionStatus(state string, confirmed bool) fleetapi.InspectionStatus {
	switch state {
	case "approved":
		return "approved"
	case "blocked":
		if confirmed {
			return "rejected"
		}
		return "requires_review"
	}
	return "submitted"
}

// blockingTitle is the notification of the managers (api.js submitDeparture): «Критический дефект: {машина}
// {номер} — {зона}. Выезд заблокирован.».
func blockingTitle(name, plate, zone string) string {
	vehicle := strings.TrimSpace(name + " " + plate)
	return "Критический дефект: " + vehicle + " — " + zone + ". Выезд заблокирован."
}

// confirmTitle is the notification of the driver after a confirmed fault (api.js decideDefect).
func confirmTitle(number string) string {
	return strings.TrimSpace("Неисправность подтверждена. Выберите другую машину для рейса " + number)
}

// cursor is the keyset position after the last item of a page, bound to the request.
type cursor struct {
	At   time.Time `json:"t"`
	ID   uuid.UUID `json:"i"`
	Bind string    `json:"b"`
}

func encodeCursor(at time.Time, id uuid.UUID, bind string) string {
	b, _ := json.Marshal(cursor{At: at.UTC(), ID: id, Bind: bind}) // a struct of plain fields always marshals
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw, bind string) (time.Time, uuid.UUID, error) {
	var c cursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err == nil {
		err = json.Unmarshal(b, &c)
	}
	if err != nil || c.Bind != bind || c.ID == uuid.Nil {
		return time.Time{}, uuid.Nil, problem.New(problem.CodeMalformedRequest, "Курсор не подходит к запросу.")
	}
	return c.At, c.ID, nil
}

// binding is the fingerprint a cursor is bound to: tenant, subject, filters.
func binding(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:8])
}

// validateDecision checks the body of decideInspectionDefect.
func validateDecision(d fleetapi.DefectDecision) error {
	switch {
	case d.Decision != decisionAllow && d.Decision != decisionConfirm:
		return invalid("Решение — разрешить выезд или подтвердить неисправность.")
	case d.Comment != nil && tooLong(*d.Comment, maxDecisionNote):
		return invalid("Комментарий — не длиннее 2000 символов.")
	}
	return nil
}

// etag is the strong ETag of a revision.
func etag(revision int64) string { return `"` + strconv.FormatInt(revision, 10) + `"` }

// checkRevision compares If-Match with the current revision: missing — 428 revision_required; anything but the
// strong ETag of current — 412 revision_mismatch.
func checkRevision(ifMatch string, current int64) error {
	v := strings.TrimSpace(ifMatch)
	switch {
	case v == "":
		return problem.New(codeRevisionRequired, "")
	case v != etag(current):
		return problem.New(codeRevisionMismatch, detailStale)
	}
	return nil
}
