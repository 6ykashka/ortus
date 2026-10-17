package vehicles

import (
	"testing"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
)

// Состояние машины эталона ↔ Vehicle.status (analysis 03 §17.3): недоступна — обслуживание или блокирующий дефект,
// на маршруте — in_use, ждёт приёмки — blocked, назначена или в брони — reserved (+ рейс), иначе свободна.
func TestStateStatus(t *testing.T) {
	t.Parallel()
	trip, other := uuid.New(), uuid.New()
	cases := []struct {
		name   string
		state  State
		status fleetapi.VehicleStatus
		note   string
		held   *uuid.UUID
	}{
		{"свободна", State{Service: ServiceOK}, fleetapi.VehicleStatusAvailable, "", nil},
		{"плановое ТО", State{Service: ServiceMaintenance, ServiceNote: "Плановое ТО до 03.10"}, fleetapi.VehicleStatusMaintenance, "Плановое ТО до 03.10", nil},
		{"снята с линии без отметки", State{Service: ServiceOutOfService}, fleetapi.VehicleStatusMaintenance, NoteOutOfService, nil},
		{"дефект на проверке", State{Service: ServiceOK, Defect: DefectInReview, TripID: &trip, TripState: TripDefectReview},
			fleetapi.VehicleStatusMaintenance, NoteDefectInReview, nil},
		{"открытый блокирующий дефект", State{Service: ServiceOK, Defect: DefectOpen}, fleetapi.VehicleStatusMaintenance, NoteDefectInReview, nil},
		{"неисправность подтверждена", State{Service: ServiceOK, Defect: DefectConfirmed, Held: true}, fleetapi.VehicleStatusMaintenance, NoteOutOfService, nil},
		{"обслуживание важнее дефекта", State{Service: ServiceMaintenance, ServiceNote: "ТО", Defect: DefectInReview}, fleetapi.VehicleStatusMaintenance, "ТО", nil},
		{"на маршруте", State{Service: ServiceOK, TripID: &trip, TripState: TripOnRoute, Held: true}, fleetapi.VehicleStatusInUse, "", nil},
		{"сдача машины", State{Service: ServiceOK, TripID: &trip, TripState: TripReturning}, fleetapi.VehicleStatusInUse, "", nil},
		{"ждёт приёмки", State{Service: ServiceOK, TripID: &trip, TripState: TripSubmitted}, fleetapi.VehicleStatusBlocked, "", nil},
		{"на доработке", State{Service: ServiceOK, TripID: &trip, TripState: TripRework}, fleetapi.VehicleStatusBlocked, "", nil},
		{"назначена на рейс", State{Service: ServiceOK, TripID: &trip, TripState: TripAssigned}, fleetapi.VehicleStatusReserved, "", &trip},
		{"осмотр перед выездом", State{Service: ServiceOK, TripID: &trip, TripState: TripInspection, Held: true, HoldTripID: &other},
			fleetapi.VehicleStatusReserved, "", &trip},
		{"бронь за рейсом", State{Service: ServiceOK, Held: true, HoldTripID: &trip}, fleetapi.VehicleStatusReserved, "", &trip},
		{"бронь без рейса", State{Service: ServiceOK, Held: true}, fleetapi.VehicleStatusReserved, "", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			status, note, held := c.state.Status()
			if status != c.status || note != c.note {
				t.Fatalf("Status() = %s %q, want %s %q", status, note, c.status, c.note)
			}
			if (held == nil) != (c.held == nil) || (held != nil && *held != *c.held) {
				t.Fatalf("heldBy = %v, want %v", held, c.held)
			}
		})
	}
}

func TestBodyToDB(t *testing.T) {
	t.Parallel()
	for api, db := range map[string]string{"van": "van", "box": "box", "flatbed": "flatbed", "refrigerated": "reefer", "tent": "tent"} {
		got, ok := BodyToDB(api)
		if !ok || got != db {
			t.Errorf("BodyToDB(%s) = %s %v, want %s", api, got, ok, db)
		}
		if bodyFromDB[db] != fleetapi.VehicleBodyType(api) {
			t.Errorf("bodyFromDB[%s] = %s, want %s", db, bodyFromDB[db], api)
		}
	}
	if _, ok := BodyToDB("reefer"); ok {
		t.Error("reefer is a value of the table, not of the contract")
	}
}

func TestCheckCreate(t *testing.T) {
	t.Parallel()
	valid := func() *fleetapi.VehicleCreate {
		return &fleetapi.VehicleCreate{
			OrgUnitId: uuid.New(), RegistrationNumber: " А 412 МР 77 ", DisplayName: "ГАЗель Next", BodyType: "tent",
			Capacity:  fleetapi.VehicleCapacity{PayloadKg: "1500", VolumeM3: "16", CargoLengthM: "4.2", CargoWidthM: "2", CargoHeightM: "2"},
			Equipment: []fleetapi.VehicleCreateEquipment{}, OdometerKm: "84370",
		}
	}
	in, err := checkCreate(valid())
	if err != nil || in.plate != "А 412 МР 77" || in.body != "tent" {
		t.Fatalf("checkCreate(valid) = %+v, %v", in, err)
	}
	str := func(s string) *string { return &s }
	cases := map[string]func(b *fleetapi.VehicleCreate){
		"пустой госномер":           func(b *fleetapi.VehicleCreate) { b.RegistrationNumber = "  " },
		"пустое название":           func(b *fleetapi.VehicleCreate) { b.DisplayName = "" },
		"неизвестный кузов":         func(b *fleetapi.VehicleCreate) { b.BodyType = "reefer" },
		"запятая в объёме":          func(b *fleetapi.VehicleCreate) { b.Capacity.VolumeM3 = "16,5" },
		"нулевая грузоподъёмность":  func(b *fleetapi.VehicleCreate) { b.Capacity.PayloadKg = "0.000" },
		"нулевая высота":            func(b *fleetapi.VehicleCreate) { b.Capacity.CargoHeightM = "0" },
		"отрицательный пробег":      func(b *fleetapi.VehicleCreate) { b.OdometerKm = "-1" },
		"одна граница температуры":  func(b *fleetapi.VehicleCreate) { b.TemperatureMinC = str("-18") },
		"нижняя выше верхней":       func(b *fleetapi.VehicleCreate) { b.TemperatureMinC, b.TemperatureMaxC = str("8"), str("-18") },
		"температура не число":      func(b *fleetapi.VehicleCreate) { b.TemperatureMinC, b.TemperatureMaxC = str("−18"), str("8") },
		"гидроборт":                 func(b *fleetapi.VehicleCreate) { b.Equipment = []fleetapi.VehicleCreateEquipment{"tail_lift"} },
		"холодильник без режима":    func(b *fleetapi.VehicleCreate) { b.Equipment = []fleetapi.VehicleCreateEquipment{"refrigerator"} },
		"длинное название площадки": func(b *fleetapi.VehicleCreate) { b.Depot = str(string(make([]rune, 201))) },
	}
	for name, mut := range cases {
		b := valid()
		mut(b)
		if _, err := checkCreate(b); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
	b := valid()
	b.TemperatureMinC, b.TemperatureMaxC = str("-18"), str("8")
	b.Equipment = []fleetapi.VehicleCreateEquipment{"refrigerator"}
	b.Depot = str("  ")
	in, err = checkCreate(b)
	if err != nil || in.depot != nil {
		t.Fatalf("a refrigerated vehicle with a blank depot: %+v, %v", in, err)
	}
}
