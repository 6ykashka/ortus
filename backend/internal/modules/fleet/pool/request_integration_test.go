//go:build integration

package pool_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Тексты ответов запроса (MSW pool.ts — образец).
const (
	textNotPublished  = "Водитель не опубликован в пуле."
	textSource        = "Фирма-источник — домашняя фирма водителя."
	textOutside       = "Срок вне свободного окна водителя."
	textTripNotFound  = "Рейс не найден."
	textTripOther     = "Рейс другой фирмы."
	textTripDriver    = "У рейса уже есть водитель."
	textRequested     = "Запрос уже отправлен"
	textTransferNotFn = "Запрос не найден."
)

// Порядок проверок запроса (описание requestDriverTransfer, Q-W2.51-10, -12, -13): право на фирму-получатель — 403;
// публикация — 404 «Водитель не опубликован в пуле.»; фирма-источник — 422; окно вне свободного — 422; рейс:
// невидимый — 404, чужой фирмы — 422, с водителем — 409; второй открытый запрос на публикацию — 409.
func TestRequestChecks(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Запрашиваемый")
	free := e.window(120*time.Hour, 128*time.Hour)
	p := e.publish(t, mgr2, d, "msk2", free)
	other := e.publish(t, mgr2, newDriver(t, "msk2", "Другой"), "msk2", free)
	w := e.window(121*time.Hour, 125*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	hidden := newTrip(t, "msk3", w, uuid.Nil)
	taken := newTrip(t, "msk1", w, newDriver(t, "msk1", "Свой водитель"))
	withPub := func(b fleetapi.DriverTransferCreate, id uuid.UUID) fleetapi.DriverTransferCreate {
		b.PublicationId = &id
		return b
	}
	for _, c := range []struct {
		name, actor  string
		body         fleetapi.DriverTransferCreate
		code, detail string
	}{
		{"нет права на фирму-получатель", "a.manager-msk2", transferOf(d, "msk2", "msk1", w, &tr), "forbidden_action", ""},
		{"водитель не опубликован", "a.manager-msk1", transferOf(newDriver(t, "msk2", "Неопубликованный"), "msk2", "msk1", w, &tr),
			"not_found", textNotPublished},
		{"публикация другого водителя", "a.manager-msk1", withPub(transferOf(d, "msk2", "msk1", w, &tr), other.Id),
			"not_found", textNotPublished},
		{"неизвестная публикация", "a.manager-msk1", withPub(transferOf(d, "msk2", "msk1", w, &tr), uuid.New()),
			"not_found", textNotPublished},
		{"фирма-источник не домашняя", "a.manager-msk1", transferOf(d, "msk3", "msk1", w, &tr), "validation_failed", textSource},
		{"источник равен получателю", "a.manager-msk2", transferOf(d, "msk2", "msk2", w, nil), "validation_failed", textSource},
		{"окно вне свободного", "a.manager-msk1", transferOf(d, "msk2", "msk1", e.window(119*time.Hour, 122*time.Hour), &tr),
			"validation_failed", textOutside},
		{"окно наоборот", "a.manager-msk1", transferOf(d, "msk2", "msk1", pool.Window{Start: w.End, End: w.Start}, &tr),
			"validation_failed", "Проверьте срок."},
		{"рейс невидим", "a.manager-msk1", transferOf(d, "msk2", "msk1", w, &hidden), "not_found", textTripNotFound},
		{"рейс другой фирмы", "a.region-msk", transferOf(d, "msk2", "msk1", w, &hidden), "validation_failed", textTripOther},
		{"у рейса есть водитель", "a.manager-msk1", transferOf(d, "msk2", "msk1", w, &taken), "invalid_transition", textTripDriver},
	} {
		_, err := e.svc.Request(t.Context(), e.tc(t, c.actor), c.body)
		if pe, ok := errors.AsType[*problem.Error](err); !ok || pe.Code != c.code || (c.detail != "" && pe.Detail != c.detail) {
			t.Errorf("%s: %v, want %s %q", c.name, err, c.code, c.detail)
		}
	}
	x := e.request(t, mgr1, withPub(transferOf(d, "msk2", "msk1", w, &tr), p.Id))
	_, err := e.svc.Request(t.Context(), mgr1, transferOf(d, "msk2", "msk1", e.window(122*time.Hour, 123*time.Hour), nil))
	wantProblem(t, err, "invalid_transition", textRequested)
	if n := scalar[int](t, `select count(*) from fleet.driver_transfers where publication_id = $1`, p.Id); n != 1 || x.Status != pool.StatusRequested {
		t.Fatalf("transfers of the publication: %d, %+v", n, x)
	}
}

// expectRequested requires the open request x of the driver of publication p for trip tr in w by the logist of
// Москва-1.
func expectRequested(t *testing.T, e *env, x fleetapi.DriverTransfer, p fleetapi.DriverPoolPublication, tr trip, w pool.Window) {
	t.Helper()
	expect(t, "requested", x, x.Status == pool.StatusRequested, x.Revision == 1, x.DriverMemberId == p.DriverMemberId,
		x.PublicationId != nil && *x.PublicationId == p.Id, x.DriverDisplayName != nil && *x.DriverDisplayName == p.DisplayName,
		x.SourceOrgUnitId == unit("msk2"), x.TargetOrgUnitId == unit("msk1"),
		x.SourceOrgUnitName != nil && *x.SourceOrgUnitName == "Москва-2", x.TargetOrgUnitName != nil && *x.TargetOrgUnitName == "Москва-1",
		x.TripId != nil && *x.TripId == tr.ID, x.TripNumber != nil && *x.TripNumber == tr.Number,
		x.Reason != nil && *x.Reason == "Запрос на рейс", x.RequestedByMemberId != nil && *x.RequestedByMemberId == person("a.manager-msk1"),
		x.RequestedAt != nil && x.RequestedAt.Equal(e.t0), x.Window.StartsAt.Equal(w.Start), x.Window.EndsAt.Equal(w.End),
		x.Grant == nil, x.DecidedAt == nil)
}

// Запрос показывает фирме-источнику псевдоним, фирмы, рейс, комментарий и автора; входящие — фирме-источнику,
// исходящие — получателю, фильтр статуса; чужой фирме запрос не виден (404, AC-01).
func TestRequestAndLists(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Командированный")
	p := e.publish(t, mgr2, d, "msk2", e.window(144*time.Hour, 152*time.Hour))
	w := e.window(145*time.Hour, 149*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	x := e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr))
	expectRequested(t, e, x, p, tr, w)
	if got, err := e.svc.Transfer(ctx, mgr2, x.Id); err != nil || got.Revision != 1 {
		t.Fatalf("getDriverTransfer by the source: %v %+v", err, got)
	}
	_, err := e.svc.Transfer(ctx, as(newManager(t, "msk3")), x.Id)
	wantProblem(t, err, "not_found", textTransferNotFn)
	_, err = e.svc.Transfer(ctx, mgr1, uuid.New())
	wantProblem(t, err, "not_found", textTransferNotFn)
	in, out := fleetapi.Incoming, fleetapi.Outgoing
	approved := []fleetapi.ListDriverTransfersParamsStatus{fleetapi.ListDriverTransfersParamsStatusApproved}
	requested := []fleetapi.ListDriverTransfersParamsStatus{fleetapi.ListDriverTransfersParamsStatusRequested}
	for _, c := range []struct {
		name   string
		tc     tenantctx.TenantContext
		params fleetapi.ListDriverTransfersParams
		want   bool
	}{
		{"входящие источника", e.tc(t, "a.manager-msk2"), fleetapi.ListDriverTransfersParams{Direction: &in}, true},
		{"исходящие источника", e.tc(t, "a.manager-msk2"), fleetapi.ListDriverTransfersParams{Direction: &out}, false},
		{"исходящие получателя", e.tc(t, "a.manager-msk1"), fleetapi.ListDriverTransfersParams{Direction: &out}, true},
		{"входящие получателя", e.tc(t, "a.manager-msk1"), fleetapi.ListDriverTransfersParams{Direction: &in}, false},
		{"все получателя", e.tc(t, "a.manager-msk1"), fleetapi.ListDriverTransfersParams{}, true},
		{"статус requested", e.tc(t, "a.manager-msk1"), fleetapi.ListDriverTransfersParams{Status: &requested}, true},
		{"статус approved", e.tc(t, "a.manager-msk1"), fleetapi.ListDriverTransfersParams{Status: &approved}, false},
		{"менеджер получателя с двумя ролями", e.tc(t, "a.two-roles"), fleetapi.ListDriverTransfersParams{}, true},
		{"тенант B", e.tc(t, "b.manager-msk1", "b"), fleetapi.ListDriverTransfersParams{}, false},
	} {
		if got := e.listed(t, c.tc, c.params, x.Id); got != c.want {
			t.Errorf("%s: listed %v, want %v", c.name, got, c.want)
		}
	}
	one := 1
	page, err := e.svc.Transfers(ctx, e.tc(t, "a.owner"), fleetapi.ListDriverTransfersParams{Limit: &one})
	expect(t, "first page of the owner", page, err == nil, len(page.Items) == 1)
}
