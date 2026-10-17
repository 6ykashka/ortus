package vehicles

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.02: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the answers of createVehicle (the screen of registration is not in the prototype: B-6).
const (
	textUnknownUnit  = "Подразделение не найдено."
	textUnitArchived = "Подразделение в архиве."
	textPlate        = "Укажите госномер машины."
	textName         = "Укажите название машины (до 200 символов)."
	textBody         = "Неизвестный тип кузова."
	textQuantity     = "Проверьте числа: грузоподъёмность, объём, размеры кузова и пробег — неотрицательные, точка как разделитель."
	textPositive     = "Грузоподъёмность, объём и размеры кузова должны быть больше нуля."
	textTooLarge     = "Слишком большое значение грузоподъёмности, объёма, размеров или пробега."
	textTempPair     = "Укажите обе границы температурного режима или ни одной."
	textTempOrder    = "Нижняя граница температуры не может быть выше верхней."
	textEquipment    = "Это оснащение пока не хранится в автопарке: доступен только холодильник при температурном режиме."
	textDepot        = "Название площадки — до 200 символов."
	textDuplicate    = "Машина с таким госномером уже есть в автопарке."
)

// Limits of the columns (fleet.vehicles, tenant 0002 and 0012).
const (
	maxText = 200
	// SQLSTATEs the insert answers with.
	codeUniqueViolation  = "23505"
	codeNumericOverflow  = "22003"
	codeCheckViolation   = "23514"
	constraintPlateIndex = "vehicles_plate_uq"
)

// decimalRE is Decimal of the contract (common/schemas.yaml).
var decimalRE = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$`)

// vehicleInput is a checked VehicleCreate.
type vehicleInput struct {
	unit                                   uuid.UUID
	plate, name, body                      string
	payload, volume, length, width, height string
	tempMin, tempMax                       *string
	odometer                               string
	depot                                  *string
}

func checkCreate(b *fleetapi.VehicleCreate) (vehicleInput, error) {
	if b == nil {
		return vehicleInput{}, problem.New(problem.CodeMalformedRequest, "")
	}
	in := vehicleInput{
		unit: b.OrgUnitId, plate: strings.TrimSpace(b.RegistrationNumber), name: strings.TrimSpace(b.DisplayName),
		payload: b.Capacity.PayloadKg, volume: b.Capacity.VolumeM3, length: b.Capacity.CargoLengthM,
		width: b.Capacity.CargoWidthM, height: b.Capacity.CargoHeightM, tempMin: b.TemperatureMinC,
		tempMax: b.TemperatureMaxC, odometer: b.OdometerKm,
	}
	var ok bool
	in.body, ok = BodyToDB(string(b.BodyType))
	switch {
	case in.plate == "" || utf8.RuneCountInString(in.plate) > maxText:
		return vehicleInput{}, kit.Invalid(textPlate)
	case in.name == "" || utf8.RuneCountInString(in.name) > maxText:
		return vehicleInput{}, kit.Invalid(textName)
	case !ok:
		return vehicleInput{}, kit.Invalid(textBody)
	}
	if err := checkQuantities(in); err != nil {
		return vehicleInput{}, err
	}
	if err := checkTemperature(in.tempMin, in.tempMax); err != nil {
		return vehicleInput{}, err
	}
	for _, e := range b.Equipment {
		if e != fleetapi.VehicleCreateEquipmentRefrigerator || in.tempMin == nil {
			return vehicleInput{}, kit.Invalid(textEquipment)
		}
	}
	var err error
	in.depot, err = cleanDepot(b.Depot)
	return in, err
}

// checkQuantities checks the exact quantities of the capacity and the odometer; the capacity is positive.
func checkQuantities(in vehicleInput) error {
	quantities := []string{in.payload, in.volume, in.length, in.width, in.height, in.odometer}
	for _, q := range quantities {
		if !quantityRE.MatchString(q) {
			return kit.Invalid(textQuantity)
		}
	}
	for _, q := range quantities[:5] {
		if strings.Trim(q, "0.") == "" {
			return kit.Invalid(textPositive)
		}
	}
	return nil
}

// cleanDepot trims the depot; a blank one is none.
func cleanDepot(depot *string) (*string, error) {
	if depot == nil {
		return nil, nil
	}
	d := strings.TrimSpace(*depot)
	switch {
	case utf8.RuneCountInString(d) > maxText:
		return nil, kit.Invalid(textDepot)
	case d == "":
		return nil, nil
	}
	return &d, nil
}

// checkTemperature checks the pair of bounds: both or none, exact decimals, the lower one not above the upper one.
func checkTemperature(lo, hi *string) error {
	switch {
	case (lo == nil) != (hi == nil):
		return kit.Invalid(textTempPair)
	case lo == nil:
		return nil
	case !decimalRE.MatchString(*lo) || !decimalRE.MatchString(*hi):
		return kit.Invalid(textQuantity)
	}
	// Six decimals at most: float64 orders them exactly enough.
	a, errLo := strconv.ParseFloat(*lo, 64)
	b, errHi := strconv.ParseFloat(*hi, 64)
	if errLo != nil || errHi != nil {
		return kit.Invalid(textQuantity)
	}
	if a > b {
		return kit.Invalid(textTempOrder)
	}
	return nil
}

// insertSQL registers a vehicle; lengths come in metres and are kept in millimetres.
const insertSQL = `insert into fleet.vehicles (unit_id, plate, display_name, body_type, payload_kg, volume_m3,
	cargo_length_mm, cargo_width_mm, cargo_height_mm, temp_min_c, temp_max_c, odometer_km, depot)
	values ($1, $2, $3, $4, $5::text::numeric, $6::text::numeric, round($7::text::numeric * 1000)::integer,
	        round($8::text::numeric * 1000)::integer, round($9::text::numeric * 1000)::integer,
	        $10::text::numeric, $11::text::numeric, $12::text::numeric, $13)
	returning id`

// CreateVehicle implements fleetapi.StrictServerInterface: a vehicle of a unit the actor manages the fleet of
// (fleet.vehicles.manage). An unknown unit and a unit the actor cannot see are the same 422 (AC-01); a visible unit
// without the right is 403.
func (s *Server) CreateVehicle(ctx context.Context, req fleetapi.CreateVehicleRequestObject) (fleetapi.CreateVehicleResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	in, err := checkCreate(req.Body)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var row Row
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		if err := s.unitOf(ctx, tx, tc, in.unit); err != nil {
			return err
		}
		var id uuid.UUID
		err := tx.QueryRow(ctx, insertSQL, in.unit, in.plate, in.name, in.body, in.payload, in.volume, in.length,
			in.width, in.height, in.tempMin, in.tempMax, in.odometer, in.depot).Scan(&id)
		if err != nil {
			return insertError(err)
		}
		if row, err = Get(ctx, tx, id, now); err != nil {
			return err
		}
		if err := kit.Audit(ctx, tx, audit.Event{
			Action: "fleet.vehicle.create", TargetType: TargetVehicle, TargetID: id, UnitID: in.unit,
			Diff: map[string]any{"registrationNumber": in.plate, "bodyType": string(req.Body.BodyType)},
		}); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusCreated, kit.ETag(row.Revision), row.DTO())
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(row.Revision), false
	return fleetapi.CreateVehicle201JSONResponse{
		Body: row.DTO(),
		Headers: fleetapi.CreateVehicle201ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// insertError maps the refusals of the table: a plate already in the fleet, numbers beyond the columns or rounded to
// zero by them.
func insertError(err error) error {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	switch {
	case !ok:
		return err
	case pe.Code == codeUniqueViolation && pe.ConstraintName == constraintPlateIndex:
		return kit.Invalid(textDuplicate)
	case pe.Code == codeNumericOverflow:
		return kit.Invalid(textTooLarge)
	case pe.Code == codeCheckViolation: // a positive number rounded to zero by the scale of its column
		return kit.Invalid(textPositive)
	}
	return err
}

// unitOf checks the unit of a new vehicle in the transaction of the command, under a share lock of its row (an
// archive or a move of the unit waits for the command, or the command for them): it exists, is not archived and the
// actor has fleet.vehicles.manage over it — decided by the evaluator over the same transaction (W1.47).
func (s *Server) unitOf(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, unit uuid.UUID) error {
	var archived bool
	err := tx.QueryRow(ctx, `select archived_at is not null from org.units where id = $1 for share`, unit).Scan(&archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return kit.Invalid(textUnknownUnit)
	}
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	err = s.within(tx).Permit(ctx, tc, ActionManage, authz.Resource{Unit: unit, ReadAction: actionUnitsRead})
	switch {
	case problem.Is(err, problem.CodeNotFound):
		return kit.Invalid(textUnknownUnit)
	case err != nil:
		return err
	case archived:
		return kit.Invalid(textUnitArchived)
	}
	return nil
}
