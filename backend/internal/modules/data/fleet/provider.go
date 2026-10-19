// Package fleet is the provider of the datasets of the logistics module for «Данные» (W2.08, S2-16, AC-14):
// «Автомобили», «Поездки» and «Расходы» of the prototype (dataVM; fields and labels of Dataset.id of the contract
// 0.6.0-stage2, example listDatasets/ok). The rows follow the reads of the module: a vehicle is in the scope of
// fleet.vehicles.read over its unit (W2.02) with its derived status; a trip and its expenses — in the scope of
// fleet.trips.read or fleet.expenses.read over the unit of the trip or as its driver, and a member with the work
// function «Водитель» sees only the trips he drives (D22, as listTripPlans of W2.03); «Начисление» is the ledger of
// W2.06 under fleet.earnings.read (closed by the function «Водитель», AC-05).
package fleet

import (
	"github.com/ortus/ortus-crm/backend/internal/modules/data" //nolint:depguard // the registry this provider plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// ModuleKey is the key of the logistics module in the module registry.
const ModuleKey = "fleet"

// Datasets of the module (Dataset.id).
const (
	Vehicles = "fleet.vehicles"
	Trips    = "fleet.trips"
	Expenses = "fleet.expenses"
)

// keyTrip is the entity of «Поездки» and the field of the trip in «Поездки» and «Расходы».
const keyTrip = "trip"

// Provider registers the datasets of logistics.
type Provider struct{}

var _ data.Provider = Provider{}

// Module implements data.Provider.
func (Provider) Module() string { return ModuleKey }

// Datasets implements data.Provider: «Автомобили», «Поездки», «Расходы».
func (Provider) Datasets() []data.Spec { return []data.Spec{vehicles(), trips(), expenses()} }

// Labels of the codes (example listDatasets/ok: VEHICLE_STATE, TRIP_STATE, EXPENSE_CAT of the prototype and the
// categories of W2.40; the status of an expense of Q-W2.51-6).
var (
	vehicleStatuses = []data.Option{
		{Key: "available", Label: "Свободна"}, {Key: "reserved", Label: "Забронирована"}, {Key: "in_use", Label: "На маршруте"},
		{Key: "blocked", Label: "Проверяется"}, {Key: "maintenance", Label: "Недоступна"},
	}
	tripStates = []data.Option{
		{Key: "planned", Label: "Запланирован"}, {Key: "assigned", Label: "Машина назначена"},
		{Key: "inspection", Label: "Осмотр перед выездом"}, {Key: "defect_review", Label: "Дефект на проверке"},
		{Key: "on_route", Label: "В рейсе"}, {Key: "returning", Label: "Сдача машины"}, {Key: "submitted", Label: "Ожидает приёмки"},
		{Key: "rework", Label: "На доработке"}, {Key: "accepted", Label: "Принят"},
	}
	expenseKinds = []data.Option{
		{Key: "fuel", Label: "Топливо"}, {Key: "wash", Label: "Мойка"}, {Key: "parking", Label: "Парковка"},
		{Key: "toll", Label: "Платная дорога"}, {Key: "tire_service", Label: "Шиномонтаж и мелкий ремонт"}, {Key: "other", Label: "Прочее"},
	}
	expenseStatuses = []data.Option{{Key: "claimed", Label: "Заявлен водителем"}, {Key: "accepted", Label: "Принят"}}
)

// expenseCategoriesSQL is the catalogue of expense categories of the tenant (W2.41, tenant 0015) in its order: the
// options of «Категория»; expenseKinds are its six seed codes, the options known without the database.
const expenseCategoriesSQL = `select code, label from fleet.expense_categories order by sort_order, code`

// Scope columns: a vehicle by its unit (no «own» people, as listVehicles); a trip and an expense by the unit of the
// trip or its driver (as listTripPlans and the expenses of W2.05); the earnings by the unit of the trip only — a driver
// never reads them through a self scope (AC-05).
var (
	vehicleColumns  = authz.Columns{Unit: "v.unit_id"}
	tripColumns     = authz.Columns{Unit: "t.unit_id", Persons: []string{"t.driver_person_id"}}
	earningsColumns = authz.Columns{Unit: "t.unit_id"}
)

// ownTrips keeps the trips of a member with an active work function «Водитель» to those he drives, whatever his grants
// say (D22).
const ownTrips = `(t.driver_person_id = ` + data.PersonParam + ` or not exists (select 1 from people.work_profiles w
       where w.person_id = ` + data.PersonParam + ` and w.function = 'driver' and w.valid @> ` + data.NowParam + `))`

// vehicleStatus derives Vehicle.status as vehicles.State.Status of W2.02 (analysis 03 §17.3): out of service or a
// blocking defect — maintenance; the trip that holds the vehicle — in_use (on the route), blocked (handed in), reserved
// (assigned, in the inspection); a live hold — reserved; else available.
const vehicleStatus = `case
  when v.service_state <> 'ok' then 'maintenance'
  when exists (select 1 from fleet.defects d where d.vehicle_id = v.id and d.severity = 'blocking'
                 and d.state in ('open', 'in_review', 'confirmed_out_of_service')) then 'maintenance'
  when exists (select 1 from fleet.trips h where h.vehicle_id = v.id and h.state in ('on_route', 'returning')) then 'in_use'
  when exists (select 1 from fleet.trips h where h.vehicle_id = v.id and h.state in ('submitted', 'rework')) then 'blocked'
  when exists (select 1 from fleet.trips h where h.vehicle_id = v.id
                 and h.state in ('assigned', 'inspection', 'defect_review')) then 'reserved'
  when exists (select 1 from sched.resources s join sched.reservations r on r.resource_id = s.id
                where s.kind = 'vehicle' and s.ref_id = v.id and upper(r.occupied) > ` + data.NowParam + `
                  and (r.state = 'confirmed' or (r.state = 'hold' and r.hold_expires_at > ` + data.NowParam + `))) then 'reserved'
  else 'available' end`

func vehicles() data.Spec {
	return data.Spec{
		ID: Vehicles, Name: "Автомобили", Permission: "fleet.vehicles.read", EntityType: "vehicle",
		From:    "fleet.vehicles v join org.units u on u.id = v.unit_id",
		Where:   "v.archived_at is null",
		Columns: vehicleColumns, RecordID: "v.id", Order: []string{"v.created_at", "v.id"},
		Fields: []data.Field{
			{Key: "displayName", Label: "Машина", Type: data.Text, SQL: "coalesce(v.display_name, v.plate)"},
			{Key: "registrationNumber", Label: "Номер", Type: data.Text, SQL: "v.plate"},
			{Key: "orgUnitName", Label: "Фирма", Type: data.Text, SQL: "u.name"},
			{Key: "status", Label: "Состояние", Type: data.Choices, Options: vehicleStatuses, SQL: vehicleStatus},
			{Key: "volumeM3", Label: "Объём, м³", Type: data.Decimal, SQL: "v.volume_m3"},
		},
		DefaultSort: []data.Sort{{Field: "displayName"}},
	}
}

func trips() data.Spec {
	return data.Spec{
		ID: Trips, Name: "Поездки", Permission: "fleet.trips.read", EntityType: keyTrip,
		From: `fleet.trips t
  left join people.person_profiles p on p.id = t.driver_person_id
  left join fleet.inspections di on di.id = t.departure_inspection_id
  left join fleet.inspections ri on ri.id = t.return_inspection_id
  left join finance.earnings fe on fe.trip_id = t.id`,
		// A cancelled trip is not in the dataset: the prototype has no such state (TRIP_STATE, options of «Статус»).
		Where:   "t.state <> 'cancelled' and " + ownTrips,
		Columns: tripColumns, RecordID: "t.id", Order: []string{"lower(t.planned)", "t.number", "t.id"},
		Fields: []data.Field{
			{Key: keyTrip, Label: "Рейс", Type: data.Text, SQL: "t.number || coalesce(' · ' || t.title, '')"},
			{Key: "driverName", Label: "Водитель", Type: data.Text, Nullable: true, SQL: "p.full_name"},
			{Key: "state", Label: "Статус", Type: data.Choices, Options: tripStates, SQL: "t.state"},
			{Key: "mileageKm", Label: "Пробег, км", Type: data.Decimal, Nullable: true, SQL: "ri.odometer_km - di.odometer_km"},
			{
				Key: "earnings", Label: "Начисление", Type: data.Money, Nullable: true, Sensitivity: data.SensitivityFinancial,
				// The ledger of W2.06: an accepted trip without a row has 0 ₽ (as listTripEarnings), a trip not accepted — none.
				SQL:        "coalesce(fe.amount_minor, case when t.state = 'accepted' and t.reviewed_at is not null then 0 end)",
				Currency:   "coalesce(fe.currency::text, 'RUB')",
				Restricted: &data.Restriction{Permission: "fleet.earnings.read", Columns: earningsColumns},
			},
		},
		DefaultSort: []data.Sort{{Field: keyTrip}},
	}
}

func expenses() data.Spec {
	return data.Spec{
		ID: Expenses, Name: "Расходы", Permission: "fleet.expenses.read", EntityType: "expense",
		From:    "fleet.expenses e join fleet.trips t on t.id = e.trip_id",
		Where:   ownTrips,
		Columns: tripColumns, RecordID: "e.id", Order: []string{"e.created_at", "e.id"},
		Fields: []data.Field{
			{Key: keyTrip, Label: "Рейс", Type: data.Text, SQL: "t.number"},
			{
				Key: "kind", Label: "Категория", Type: data.Choices, Options: expenseKinds, SQL: "e.category",
				// W2.41: the catalogue of the tenant — the seed and the categories of the owner, archived ones too.
				OptionsSQL: expenseCategoriesSQL,
			},
			{Key: "occurredOn", Label: "Дата", Type: data.Date, SQL: "e.occurred_on"},
			{Key: "amount", Label: "Сумма", Type: data.Money, SQL: "e.amount_minor", Currency: "e.currency::text"},
			{
				Key: "status", Label: "Статус", Type: data.Choices, Options: expenseStatuses,
				SQL: "case when t.state = 'accepted' then 'accepted' else 'claimed' end",
			},
		},
		DefaultSort: []data.Sort{{Field: "occurredOn", Desc: true}},
	}
}
