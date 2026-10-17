package main

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Fleet part of the seed (W2.02, S2-01): the vehicles of «Альта» as mock-data.js 14.10 (logistics/seed.ts W0.12,
// testdata/fleet-rules/fleet.json W2.01) with the ids of PD-30 — the MSW adapter builds the same ids (seedUuid of
// t-alta), so a page sees the same vehicles in mock and on the stand. The prototype has no width and height of the
// body: 2 m as MSW W2.00. «Недоступна · Плановое ТО до 03.10» is the service state maintenance with its note;
// «На маршруте» (v7) needs a trip on the route, which the trip seed adds (W2.03/W2.05) — until then v7 is in service
// and free. Trips, reservations and inspections are not seeded here.

// vehicleSeed is a vehicle of the prototype: measures as exact decimals of the table (kg, m³, mm, km, °C).
type vehicleSeed struct {
	proto, unit, model, plate, body string
	payloadKg, volumeM3             string
	lengthMM                        int
	tempMin, tempMax                string // "" — no temperature mode
	odometerKm                      string
	service, note, depot            string
}

// bodyWidthMM and bodyHeightMM are the width and the height of every body of the seed (2 m, as MSW).
const (
	bodyWidthMM  = 2000
	bodyHeightMM = 2000
	serviceOK    = "ok"
)

// fleetSeeds are the vehicles of the tenants, in the order of the prototype (mock-data.js:189–228).
var fleetSeeds = map[string][]vehicleSeed{
	protoAlta: {
		{"v1", homeAlta, "ГАЗель Next", "А 412 МР 77", "tent", "1500", "16", 4200, "", "", "84370", serviceOK, "", "Склад № 1"},
		{"v6", homeAlta, "Mercedes Sprinter", "Т 771 ЕХ 77", "van", "1600", "14", 4300, "", "", "120544", serviceOK, "", "Склад № 1"},
		{"v2", homeAlta, "Ford Transit", "М 608 КТ 77", "reefer", "1200", "11", 3400, "-18", "8", "61210", serviceOK, "", "Склад № 1"},
		{"v3", homeAlta, "Hyundai Porter", "В 233 ОС 77", "tent", "900", "9", 3100, "", "", "152003", serviceOK, "", "Склад № 2"},
		{"v4", homeAlta, "ГАЗон Next", "Е 905 НА 77", "van", "4500", "30", 5100, "", "", "40112", "maintenance",
			"Плановое ТО до 03.10", "Склад № 2"},
		{"v5", "f-msk-yug", "Isuzu Elf", "К 120 РУ 77", "van", "3000", "20", 4400, "", "", "98320", serviceOK, "", "Юг · база"},
		{"v7", "f-smr-volga", "ГАЗель Бизнес", "О 318 ХС 163", "tent", "1500", "14", 3100, "", "", "201450", serviceOK, "",
			"Самара · склад"},
	},
}

// fleetRegistered is when the vehicles of the seed were registered; one second apart, so that listVehicles (by
// created_at, id) lists them in the order of the prototype.
var fleetRegistered = time.Date(2026, time.September, 1, 9, 0, 0, 0, msk)

// writeFleet writes the vehicles of td (none for a tenant without a fleet); a second run changes nothing.
func writeFleet(ctx context.Context, tx *sql.Tx, td tenantData) error {
	for i, v := range fleetSeeds[td.tenant.proto] {
		var lo, hi *string
		if v.tempMin != "" {
			lo, hi = &v.tempMin, &v.tempMax
		}
		var note *string
		if v.note != "" {
			note = &v.note
		}
		if _, err := tx.ExecContext(ctx, `insert into fleet.vehicles (id, unit_id, plate, display_name, body_type,
			payload_kg, volume_m3, cargo_length_mm, cargo_width_mm, cargo_height_mm, temp_min_c, temp_max_c, odometer_km,
			service_state, service_note, depot, created_at)
			values ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8, $9, $10, $11::numeric, $12::numeric, $13::numeric,
			        $14, $15, $16, $17)
			on conflict (id) do nothing`,
			seedID(td.tenant.proto, v.proto), td.unitID(v.unit), v.plate, v.model, v.body, v.payloadKg, v.volumeM3,
			v.lengthMM, bodyWidthMM, bodyHeightMM, lo, hi, v.odometerKm, v.service, note, v.depot,
			fleetRegistered.Add(time.Duration(i)*time.Second)); err != nil {
			return fmt.Errorf("vehicle %s: %w", v.proto, err)
		}
	}
	return nil
}
