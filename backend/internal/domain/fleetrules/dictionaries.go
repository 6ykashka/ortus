package fleetrules

import (
	"encoding/json"
	"slices"
)

// Справочники логистики (dictionaries.ts W0.12 = models.js:125–163 14.10) — дословно; порядок
// значим для интерфейса. Функции возвращают копии.

// VehicleState — состояние машины.
type VehicleState string

// Состояния машины.
const (
	VehicleFree        VehicleState = "free"
	VehicleReserved    VehicleState = "reserved"
	VehicleOnRoute     VehicleState = "on_route"
	VehicleReview      VehicleState = "review"
	VehicleUnavailable VehicleState = "unavailable"
)

// TripState — состояние рейса.
type TripState string

// Состояния рейса.
const (
	TripPlanned      TripState = "planned"
	TripAssigned     TripState = "assigned"
	TripInspection   TripState = "inspection"
	TripDefectReview TripState = "defect_review"
	TripOnRoute      TripState = "on_route"
	TripReturning    TripState = "returning"
	TripSubmitted    TripState = "submitted"
	TripRework       TripState = "rework"
	TripAccepted     TripState = "accepted"
)

// Tone — тон статуса в интерфейсе.
type Tone string

// Тоны статусов.
const (
	ToneOK      Tone = "ok"
	ToneInfo    Tone = "info"
	ToneWarn    Tone = "warn"
	ToneDanger  Tone = "danger"
	ToneNeutral Tone = "neutral"
)

// StateLabel — подпись, тон и иконка состояния.
type StateLabel struct {
	Label string `json:"label"`
	Tone  Tone   `json:"tone"`
	Icon  string `json:"icon"`
}

// StateEntry — строка справочника состояний: ключ и подпись.
type StateEntry[K ~string] struct {
	Key K `json:"key"`
	StateLabel
}

// Option — пара «ключ — подпись» (ракурс фото, пункт чек-листа, уровень топлива).
// В JSON — массив [key, label], как в эталоне.
type Option struct {
	Key   string
	Label string
}

// MarshalJSON пишет пару массивом [key, label].
func (o Option) MarshalJSON() ([]byte, error) {
	return json.Marshal([2]string{o.Key, o.Label})
}

// ExpenseCategory — категория расхода в пути.
type ExpenseCategory struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Icon  string `json:"icon"`
}

// Ключи категорий расходов.
const (
	ExpenseFuel = "fuel"
	ExpenseWash = "wash"
)

var vehicleStates = []StateEntry[VehicleState]{
	{VehicleFree, StateLabel{"Свободна", ToneOK, "check_circle"}},
	{VehicleReserved, StateLabel{"Забронирована", ToneInfo, "event_available"}},
	{VehicleOnRoute, StateLabel{"На маршруте", ToneInfo, "route"}},
	{VehicleReview, StateLabel{"Проверяется", ToneWarn, "pending"}},
	{VehicleUnavailable, StateLabel{"Недоступна", ToneDanger, "block"}},
}

var tripStates = []StateEntry[TripState]{
	{TripPlanned, StateLabel{"Запланирован", ToneNeutral, "event"}},
	{TripAssigned, StateLabel{"Машина назначена", ToneInfo, "event_available"}},
	{TripInspection, StateLabel{"Осмотр перед выездом", ToneInfo, "fact_check"}},
	{TripDefectReview, StateLabel{"Дефект на проверке", ToneDanger, "report"}},
	{TripOnRoute, StateLabel{"В рейсе", ToneInfo, "route"}},
	{TripReturning, StateLabel{"Сдача машины", ToneInfo, "assignment_return"}},
	{TripSubmitted, StateLabel{"Ожидает приёмки", ToneWarn, "pending"}},
	{TripRework, StateLabel{"На доработке", ToneWarn, "undo"}},
	{TripAccepted, StateLabel{"Принят", ToneOK, "verified"}},
}

// photoSides — обязательные ракурсы осмотра.
var photoSides = []Option{
	{"front", "Спереди"},
	{"back", "Сзади"},
	{"left", "Слева"},
	{"right", "Справа"},
	{"odo", "Одометр"},
}

var depChecks = []Option{
	{"body", "Кузов и стёкла осмотрены"},
	{"tires", "Шины и световые приборы исправны"},
	{"docs", "Документы и комплект на месте"},
}

var retChecks = []Option{
	{"cargo", "Груз выгружен полностью"},
	{"personal", "Личные вещи забраны"},
	{"keys", "Ключи и документы на месте"},
}

var defectZones = []string{
	"Кузов",
	"Стёкла",
	"Шины и колёса",
	"Световые приборы",
	"Салон",
	"Грузовой отсек",
	"Тормоза и ходовая",
}

var fuelLevels = []Option{
	{"q", "¼"},
	{"h", "½"},
	{"tq", "¾"},
	{"f", "Полный"},
}

var expenseCategories = []ExpenseCategory{
	{ExpenseFuel, "Топливо", "local_gas_station"},
	{ExpenseWash, "Мойка", "local_car_wash"},
}

// VehicleStates возвращает справочник состояний машины (VEHICLE_STATE) в порядке эталона.
func VehicleStates() []StateEntry[VehicleState] { return slices.Clone(vehicleStates) }

// VehicleStateLabel возвращает подпись состояния машины; false — состояние неизвестно.
func VehicleStateLabel(s VehicleState) (StateLabel, bool) { return lookupState(vehicleStates, s) }

// TripStates возвращает справочник состояний рейса (TRIP_STATE) в порядке эталона.
func TripStates() []StateEntry[TripState] { return slices.Clone(tripStates) }

// TripStateLabel возвращает подпись состояния рейса; false — состояние неизвестно.
func TripStateLabel(s TripState) (StateLabel, bool) { return lookupState(tripStates, s) }

// PhotoSides возвращает обязательные ракурсы осмотра (PHOTO_SIDES).
func PhotoSides() []Option { return slices.Clone(photoSides) }

// DepChecks возвращает чек-лист осмотра перед выездом (DEP_CHECKS).
func DepChecks() []Option { return slices.Clone(depChecks) }

// RetChecks возвращает чек-лист сдачи машины (RET_CHECKS).
func RetChecks() []Option { return slices.Clone(retChecks) }

// FuelLevels возвращает уровни топлива (FUEL).
func FuelLevels() []Option { return slices.Clone(fuelLevels) }

// DefectZones возвращает зоны дефектов (DEFECT_ZONES).
func DefectZones() []string { return slices.Clone(defectZones) }

// ExpenseCategories возвращает категории расходов (EXPENSE_CAT).
func ExpenseCategories() []ExpenseCategory { return slices.Clone(expenseCategories) }

func lookupState[K ~string](list []StateEntry[K], key K) (StateLabel, bool) {
	for _, e := range list {
		if e.Key == key {
			return e.StateLabel, true
		}
	}
	return StateLabel{}, false
}
