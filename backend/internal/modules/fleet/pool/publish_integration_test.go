//go:build integration

package pool_test

import (
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Тексты ответов публикации (MSW pool.ts — образец).
const (
	textUnit      = "Подразделение не найдено."
	textDriver    = "Проверьте водителя."
	textWindow    = "Проверьте срок."
	textPast      = "Окно уже прошло."
	textPublished = "Водитель уже опубликован в пуле на это время."
	textNotFound  = "Публикация не найдена."
	textWithdrawn = "Водитель уже снят из пула."
)

func labelNumber(t *testing.T, label string) int {
	t.Helper()
	n, err := strconv.Atoi(strings.TrimPrefix(label, "Водитель #"))
	if err != nil || !strings.HasPrefix(label, "Водитель #") {
		t.Fatalf("pool label %q, want «Водитель #N»", label)
	}
	return n
}

// S2-14, AUTH-06: менеджер Москвы-2 публикует своего водителя на свободное окно — псевдоним «Водитель #N» выдаёт
// сервер (следующий номер организации), имя видит только фирма-источник; аудит и событие fleet.pool.published.v1.
func TestPublish(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr := e.tc(t, "a.manager-msk2")
	d := newDriver(t, "msk2", "Пётр Пулов")
	w := e.window(24*time.Hour, 30*time.Hour)
	p := e.publish(t, mgr, d, "msk2", w)
	expect(t, "publication", p, p.State == fleetapi.DriverPoolPublicationStateActive, p.DriverMemberId == d,
		p.DriverDisplayName != nil && *p.DriverDisplayName == "Пётр Пулов", p.HomeOrgUnitId == unit("msk2"),
		p.HomeOrgUnitName != nil && *p.HomeOrgUnitName == "Москва-2", p.Revision == 1,
		p.PublishedByMemberId != nil && *p.PublishedByMemberId == person("a.manager-msk2"),
		p.FreeWindow.StartsAt.Equal(w.Start), p.FreeWindow.EndsAt.Equal(w.End), p.FreeWindow.TimeZone == "Europe/Moscow",
		len(p.Qualifications) == 2, p.Terms != nil && *p.Terms == "По соглашению фирм группы",
		p.PublishedAt.Equal(e.t0), p.WithdrawnAt == nil)
	first := labelNumber(t, p.DisplayName)
	if n := scalar[int](t, `select count(*) from audit.events where action = 'fleet.pool.publish' and target_id = $1`, p.Id); n != 1 {
		t.Errorf("audit rows: %d, want 1", n)
	}
	if n := scalar[int](t, `select count(*) from outbox.events where type = 'fleet.pool.published.v1' and aggregate_id = $1
		 and not (payload::text like '%Пулов%')`, p.Id); n != 1 {
		t.Errorf("fleet.pool.published.v1 without the name: %d, want 1", n)
	}
	q := e.publish(t, mgr, newDriver(t, "msk2", "Олег Второй"), "msk2", w)
	if next := labelNumber(t, q.DisplayName); next <= first {
		t.Errorf("label of the next publication %q, want after %q", q.DisplayName, p.DisplayName)
	}
}

// Порядок проверок публикации (описание publishDriverToPool, возврат 2 W2.51, Q-W2.51-14): права нет ни в одной фирме —
// 403; неизвестная и невидимая фирма — одинаковый 422; видимая без права — 403; неизвестный, чужой, архивный и не
// водитель — одинаковый 422; окно — 422; пересечение с неснятой публикацией или рейсом водителя — 409.
func TestPublishChecks(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr := e.tc(t, "a.manager-msk2")
	w := e.window(48*time.Hour, 54*time.Hour)
	busy := newDriver(t, "msk2", "Занятый")
	e.publish(t, mgr, busy, "msk2", w)
	onTrip := newDriver(t, "msk2", "В рейсе")
	tr := newTrip(t, "msk2", e.window(50*time.Hour, 52*time.Hour), onTrip)
	archived := newDriver(t, "msk2", "Уволенный")
	exec(t, `update people.person_profiles set archived_at = $2 where id = $1`, archived, since())
	stranger := newDriver(t, "msk1", "Чужой")
	notDriver := newPerson(t, "msk2", "Кладовщик")
	free := newDriver(t, "msk2", "Свободный")
	for _, c := range []struct {
		name         string
		actor        string
		driver       uuid.UUID
		home         uuid.UUID
		w            pool.Window
		code, detail string
	}{
		{"нет approve ни в одной фирме", "a.driver-msk1", free, unit("msk2"), w, "forbidden_action", ""},
		{"неизвестная фирма", "a.manager-msk2", free, uuid.New(), w, "validation_failed", textUnit},
		{"фирма вне org_units.read", "a.manager-msk2", free, unit("msk1"), w, "validation_failed", textUnit},
		{"видимая фирма без права", "a.two-roles", free, unit("smr2"), w, "forbidden_action", ""},
		{"водитель другой фирмы", "a.manager-msk2", stranger, unit("msk2"), w, "validation_failed", textDriver},
		{"неизвестный сотрудник", "a.manager-msk2", uuid.New(), unit("msk2"), w, "validation_failed", textDriver},
		{"не водитель", "a.manager-msk2", notDriver, unit("msk2"), w, "validation_failed", textDriver},
		{"архивный", "a.manager-msk2", archived, unit("msk2"), w, "validation_failed", textDriver},
		{"окно наоборот", "a.manager-msk2", free, unit("msk2"), pool.Window{Start: w.End, End: w.Start}, "validation_failed", textWindow},
		{"окно прошло", "a.manager-msk2", free, unit("msk2"), e.window(-3*time.Hour, -time.Hour), "validation_failed", textPast},
		{"пересекает публикацию", "a.manager-msk2", busy, unit("msk2"), e.window(53*time.Hour, 60*time.Hour), "resources_unavailable", textPublished},
		{"пересекает рейс водителя", "a.manager-msk2", onTrip, unit("msk2"), w, "resources_unavailable", "Водитель занят в это время: рейс " + tr.Number + "."},
	} {
		_, err := e.svc.Publish(t.Context(), e.tc(t, c.actor), fleetapi.DriverPoolPublicationCreate{
			DriverMemberId: c.driver, HomeOrgUnitId: c.home, FreeWindow: api(c.w), Qualifications: []string{},
		})
		if pe, ok := errors.AsType[*problem.Error](err); !ok || pe.Code != c.code || (c.detail != "" && pe.Detail != c.detail) {
			t.Errorf("%s: %v, want %s %q", c.name, err, c.code, c.detail)
		}
	}
	if _, err := e.svc.Publish(t.Context(), mgr, fleetapi.DriverPoolPublicationCreate{
		DriverMemberId: free, HomeOrgUnitId: unit("msk2"), FreeWindow: api(w), Qualifications: []string{strings.Repeat("я", 101)},
	}); err == nil {
		t.Error("a qualification of 101 characters: published")
	}
}

// Публикации видит фирма-источник (fleet.driver_transfers.read над домашней фирмой) и владелец; чужая фирма — 404,
// как несуществующая (AC-01). Снятие — с If-Match, хранит автора и комментарий, открытые запросы истекают; снятую и
// истёкшую публикацию снять нельзя — 409.
func TestPublicationsAndWithdrawal(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1, owner := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1"), e.tc(t, "a.owner")
	d := newDriver(t, "msk2", "Снимаемый")
	w := e.window(72*time.Hour, 80*time.Hour)
	p := e.publish(t, mgr2, d, "msk2", w)
	e.publish(t, mgr2, newDriver(t, "msk2", "Соседний"), "msk2", w)
	has := func(page fleetapi.DriverPoolPublicationPage, id uuid.UUID) bool {
		for _, it := range page.Items {
			if it.Id == id {
				return true
			}
		}
		return false
	}
	// A whole page: the other tests of the package publish drivers of Москва-2 with later windows (newest first).
	all := 200 // kit.MaxLimit
	page, err := e.svc.Publications(ctx, mgr2, fleetapi.ListDriverPoolPublicationsParams{Limit: &all})
	expect(t, "publications of Москва-2", page, err == nil, has(page, p.Id))
	page, err = e.svc.Publications(ctx, mgr1, fleetapi.ListDriverPoolPublicationsParams{Limit: &all})
	expect(t, "publications seen by Москва-1", page, err == nil, !has(page, p.Id))
	withdrawn := fleetapi.ListDriverPoolPublicationsParamsStateWithdrawn
	page, err = e.svc.Publications(ctx, mgr2, fleetapi.ListDriverPoolPublicationsParams{State: &withdrawn})
	expect(t, "withdrawn publications", page, err == nil, !has(page, p.Id))
	other := unit("msk1")
	page, err = e.svc.Publications(ctx, owner, fleetapi.ListDriverPoolPublicationsParams{HomeOrgUnitId: &other})
	expect(t, "publications of Москва-1 for the owner", page, err == nil, !has(page, p.Id))
	one := 1
	page, err = e.svc.Publications(ctx, owner, fleetapi.ListDriverPoolPublicationsParams{Limit: &one})
	expect(t, "first page", page, err == nil, len(page.Items) == 1, page.NextCursor != nil)
	if _, err := e.svc.Publications(ctx, mgr2, fleetapi.ListDriverPoolPublicationsParams{Cursor: page.NextCursor}); err == nil {
		t.Error("the cursor of another actor: no error")
	}
	_, err = e.svc.Publication(ctx, mgr1, p.Id)
	wantProblem(t, err, "not_found", textNotFound)
	_, err = e.svc.Publication(ctx, mgr1, uuid.New())
	wantProblem(t, err, "not_found", textNotFound)
	if got, err := e.svc.Publication(ctx, owner, p.Id); err != nil || got.Revision != 1 {
		t.Fatalf("getDriverPoolPublication by the owner: %v %+v", err, got)
	}
	x := e.request(t, mgr1, transferOf(d, "msk2", "msk1", e.window(73*time.Hour, 75*time.Hour), nil))

	comment := "Водитель нужен своей фирме"
	body := fleetapi.DriverPoolWithdrawal{Comment: &comment}
	_, err = e.svc.Withdraw(ctx, mgr1, p.Id, etag(1), body)
	wantProblem(t, err, "not_found", textNotFound)
	_, err = e.svc.Withdraw(ctx, mgr2, p.Id, "", body)
	wantProblem(t, err, "revision_required", "")
	_, err = e.svc.Withdraw(ctx, mgr2, p.Id, etag(7), body)
	wantProblem(t, err, "revision_mismatch", "")
	got, err := e.svc.Withdraw(ctx, mgr2, p.Id, etag(1), body)
	expect(t, "withdrawn", got, err == nil, got.State == fleetapi.DriverPoolPublicationStateWithdrawn, got.Revision == 2,
		got.WithdrawnAt != nil, got.WithdrawnByMemberId != nil && *got.WithdrawnByMemberId == person("a.manager-msk2"),
		got.WithdrawalComment != nil && *got.WithdrawalComment == comment)
	open, err := e.svc.Transfer(ctx, mgr1, x.Id)
	expect(t, "open request after the withdrawal", open, err == nil, open.Status == pool.StatusExpired, open.Revision == 2)
	_, err = e.svc.Withdraw(ctx, mgr2, p.Id, etag(2), body)
	wantProblem(t, err, "invalid_transition", textWithdrawn)

	q := e.publish(t, mgr2, newDriver(t, "msk2", "Истекающий"), "msk2", e.window(time.Hour, 2*time.Hour))
	e.clock.Set(e.t0.Add(2 * time.Hour))
	got, err = e.svc.Publication(ctx, mgr2, q.Id)
	expect(t, "expired publication", got, err == nil, got.State == fleetapi.DriverPoolPublicationStateExpired)
	_, err = e.svc.Withdraw(ctx, mgr2, q.Id, etag(got.Revision), body)
	wantProblem(t, err, "invalid_transition", textWithdrawn)
}

// AUTH-06: каталог показывает фирмам с fleet.driver_transfers.request только минимум — псевдоним, квалификации, окно,
// условия, домашнюю фирму и ссылку на публикацию; своих водителей фирма не видит, снятых — никто.
func TestCatalog(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1, owner := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1"), e.tc(t, "a.owner")
	d := newDriver(t, "msk2", "Каталожный Иван")
	w := e.window(96*time.Hour, 104*time.Hour)
	p := e.publish(t, mgr2, d, "msk2", w)
	find := func(tc tenantctx.TenantContext, from, until time.Time) (fleetapi.DriverAvailability, bool) {
		t.Helper()
		page, err := e.svc.Catalog(ctx, tc, fleetapi.ListAvailableDriversParams{AvailableFrom: from, AvailableUntil: until})
		if err != nil {
			t.Fatalf("listAvailableDrivers: %v", err)
		}
		for _, it := range page.Items {
			if it.PublicationId != nil && *it.PublicationId == p.Id {
				return it, true
			}
		}
		return fleetapi.DriverAvailability{}, false
	}
	it, ok := find(mgr1, w.Start.Add(time.Hour), w.Start.Add(3*time.Hour))
	expect(t, "catalog of Москва-1", it, ok, it.DriverMemberId == d, it.DisplayName == p.DisplayName,
		it.HomeOrgUnitId == unit("msk2"), it.HomeOrgUnitName != nil && *it.HomeOrgUnitName == "Москва-2",
		it.Terms != nil && *it.Terms == "По соглашению фирм группы", len(it.Qualifications) == 2,
		it.FreeWindow.StartsAt.Equal(w.Start), it.FreeWindow.EndsAt.Equal(w.End))
	if _, ok := find(mgr2, w.Start, w.End); ok {
		t.Error("Москва-2 sees its own driver in the catalog")
	}
	if _, ok := find(owner, w.Start, w.End); !ok {
		t.Error("the owner does not see the driver in the catalog")
	}
	if _, ok := find(mgr1, w.End, w.End.Add(time.Hour)); ok {
		t.Error("the catalog shows a driver outside the asked interval")
	}
	if _, err := e.svc.Catalog(ctx, mgr1, fleetapi.ListAvailableDriversParams{AvailableFrom: w.End, AvailableUntil: w.Start}); err == nil {
		t.Error("an inverted interval: no error")
	}
	if _, err := e.svc.Withdraw(ctx, mgr2, p.Id, etag(1), fleetapi.DriverPoolWithdrawal{}); err != nil {
		t.Fatal(err)
	}
	if _, ok := find(mgr1, w.Start, w.End); ok {
		t.Error("the catalog shows a withdrawn publication")
	}
}
