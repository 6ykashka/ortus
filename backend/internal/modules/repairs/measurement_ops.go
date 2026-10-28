package repairs

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the measurement and of the estimates (the prototype, design/docs/19).
const (
	textMeasureChanged = "Замер уже изменили — обновите страницу"
	textNeedMeasure    = "Нужно право «Вводить замер»."
	textRoomName       = "Назовите помещение."
	textRoomNumber     = "Укажите число с точностью до тысячных."
	textRoomPositive   = "Размер должен быть больше нуля."
	textRoomTooBig     = "Размер слишком велик."
)

const (
	maxRooms   = 100
	maxRoomDim = milli(1_000_000)  // a room is below a kilometre
	maxOpening = milli(10_000_000) // openings are below ten thousand square metres
)

// measRow is the latest version of the measurement of an object; version 1 with no rooms stands for «ещё не вносили».
type measRow struct {
	version int
	rooms   []room
	by      *uuid.UUID
	at      *time.Time
}

// measurement reads the latest version of the measurement of an object.
func (r *req) measurement(ctx context.Context, project uuid.UUID) (measRow, error) {
	var (
		m   measRow
		raw []byte
	)
	err := r.tx.QueryRow(ctx, `select version, rooms, measured_by, measured_at from repairs.measurements where project_id = $1 order by version desc limit 1`,
		project).Scan(&m.version, &raw, &m.by, &m.at)
	if noRows(err) {
		return measRow{version: 1, rooms: []room{}}, nil
	}
	if err != nil {
		return m, store("measurement", err)
	}
	if err := json.Unmarshal(raw, &m.rooms); err != nil {
		return m, store("measurement rooms", err)
	}
	if m.rooms == nil {
		m.rooms = []room{}
	}
	return m, nil
}

// toMilli rounds millionths to thousandths half up (the totals of the contract carry three decimals).
func (v micro) toMilli() milli { return milli((int64(v) + 500) / 1000) }

func measurementOut(project uuid.UUID, m measRow) rapi.Measurement {
	t := measureRooms(m.rooms)
	out := rapi.Measurement{
		ProjectId: project, Version: m.version, Revision: int64(m.version), Rooms: make([]rapi.MeasurementRoom, 0, len(m.rooms)),
		Totals: rapi.MeasurementTotals{FloorM2: t.floor.toMilli().String(), WallsM2: t.walls.toMilli().String(), PerimeterM: t.perimeter.toMilli().String(),
			WetFloorM2: t.wetFloor.toMilli().String(), WetWallsM2: t.wetWalls.toMilli().String()},
		MeasuredByMemberId: m.by, MeasuredAt: m.at,
	}
	for _, r := range m.rooms {
		out.Rooms = append(out.Rooms, rapi.MeasurementRoom{Id: r.ID, Name: r.Name, LengthM: r.LengthM.String(), WidthM: r.WidthM.String(),
			HeightM: r.HeightM.String(), OpeningsM2: r.OpeningsM2.String(), Wet: new(r.Wet)})
	}
	return out
}

// Measurement answers getMeasurement: the latest version of the measurement of an object the member sees.
func (s *Service) Measurement(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (rapi.Measurement, error) {
	var out rapi.Measurement
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.visibleProject(ctx, id, false)
		if err != nil {
			return err
		}
		m, err := r.measurement(ctx, p.id)
		out = measurementOut(p.id, m)
		return err
	})
	return out, err
}

// size reads a size of a room: a positive quantity within the limit.
func size(field, raw string, limit milli, zero bool) (milli, error) {
	v, ok := parseQty(raw)
	switch {
	case !ok:
		return 0, invalid(field, textRoomNumber, "format")
	case v == 0 && !zero:
		return 0, invalid(field, textRoomPositive, "positive")
	case v > limit:
		return 0, invalid(field, textRoomTooBig, "max")
	}
	return v, nil
}

// roomsOf checks the rooms of a new version of the measurement.
func roomsOf(in []rapi.MeasurementRoomInput) ([]room, error) {
	if len(in) > maxRooms {
		return nil, invalid("rooms", "Не больше 100 помещений.", "max")
	}
	out := make([]room, 0, len(in))
	for i, b := range in {
		at := func(f string) string { return "rooms[" + strconv.Itoa(i) + "]." + f }
		r := room{ID: uuid.New(), Name: strings.TrimSpace(b.Name)}
		if n := utf8.RuneCountInString(r.Name); n < 1 || n > 100 {
			return nil, invalid(at("name"), textRoomName)
		}
		var err error
		if r.LengthM, err = size(at("lengthM"), b.LengthM, maxRoomDim, false); err != nil {
			return nil, err
		}
		if r.WidthM, err = size(at("widthM"), b.WidthM, maxRoomDim, false); err != nil {
			return nil, err
		}
		if r.HeightM, err = size(at("heightM"), b.HeightM, maxRoomDim, false); err != nil {
			return nil, err
		}
		if r.OpeningsM2, err = size(at("openingsM2"), b.OpeningsM2, maxOpening, true); err != nil {
			return nil, err
		}
		r.Wet = wetByName(r.Name)
		if b.Wet != nil {
			r.Wet = *b.Wet
		}
		out = append(out, r)
	}
	return out, nil
}

// PutMeasurement answers putMeasurement: a new version of the measurement (Q-W4.00-repair-17). The lines «из замера»
// of the draft estimate are recalculated (a manual volume is kept); sent and approved versions are never changed.
func (s *Service) PutMeasurement(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b rapi.MeasurementPut) (rapi.Measurement, error) {
	var out rapi.Measurement
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actMeasure, textNeedMeasure); err != nil {
			return err
		}
		if p.status == statusHandedOver {
			return conflict(reasonHandedOver, textHandedOverEdit)
		}
		cur, err := r.measurement(ctx, p.id)
		if err != nil {
			return err
		}
		if err := checkRev(ifMatch, int64(cur.version), textMeasureChanged); err != nil {
			return err
		}
		rooms, err := roomsOf(b.Rooms)
		if err != nil {
			return err
		}
		raw, err := json.Marshal(rooms)
		if err != nil {
			return err
		}
		var by *uuid.UUID
		if r.me() != uuid.Nil {
			by = new(r.me())
		}
		next := measRow{version: cur.version + 1, rooms: rooms, by: by, at: new(r.now)}
		if _, err := r.tx.Exec(ctx, `insert into repairs.measurements (project_id, version, rooms, measured_by, measured_at) values ($1, $2, $3, $4, $5)`,
			p.id, next.version, raw, by, r.now); err != nil {
			return store("insert measurement", err)
		}
		if err := r.recalcDraft(ctx, p.id, measureRooms(rooms)); err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evMeasured, "внесён замер: "+strconv.Itoa(len(rooms))+" помещ."); err != nil {
			return err
		}
		out = measurementOut(p.id, next)
		return nil
	})
	return out, err
}

// recalcDraft sets the volumes of the lines «из замера» of the draft estimate of an object to the new totals: the
// lines of a formula that were not changed by hand.
func (r *req) recalcDraft(ctx context.Context, project uuid.UUID, t totals) error {
	var est uuid.UUID
	err := r.tx.QueryRow(ctx, `select id from repairs.estimates where project_id = $1 and state = 'draft'`, project).Scan(&est)
	if noRows(err) {
		return nil
	}
	if err != nil {
		return store("draft estimate", err)
	}
	if err := r.recalcLines(ctx, est, t); err != nil {
		return err
	}
	_, err = r.tx.Exec(ctx, `update repairs.estimates set revision = revision + 1 where id = $1`, est)
	return store("bump draft", err)
}

// recalcLines recomputes the volume of every line of the estimate that has a formula and was not changed by hand.
func (r *req) recalcLines(ctx context.Context, estimate uuid.UUID, t totals) error {
	rows, err := r.tx.Query(ctx, `select id, unit, formula, (coef * 1000)::bigint, (quantity * 1000)::bigint from repairs.estimate_lines
		where estimate_id = $1 and formula is not null and not manual`, estimate)
	if err != nil {
		return store("lines of the formulas", err)
	}
	type upd struct {
		id  uuid.UUID
		qty milli
	}
	var changes []upd
	for rows.Next() {
		var (
			id        uuid.UUID
			unit, f   string
			coef, qty *int64
		)
		if err := rows.Scan(&id, &unit, &f, &coef, &qty); err != nil {
			rows.Close()
			return store("lines of the formulas", err)
		}
		k := milli(1000)
		if coef != nil {
			k = milli(*coef)
		}
		if v := volume(f, k, unit, t); qty == nil || milli(*qty) != v {
			changes = append(changes, upd{id, v})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return store("lines of the formulas", err)
	}
	for _, c := range changes {
		if c.qty > maxQty {
			return invalid("rooms", "Объём строки сметы слишком велик.", "max")
		}
		if _, err := r.tx.Exec(ctx, `update repairs.estimate_lines set quantity = $2::bigint::numeric / 1000 where id = $1`, c.id, int64(c.qty)); err != nil {
			return store("recalc line", err)
		}
	}
	return nil
}
