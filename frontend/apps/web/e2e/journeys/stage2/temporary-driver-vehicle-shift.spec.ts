// W2.75 · Журни S2-20 «Машина для временного водителя» (D-35; design/docs/29-temporary-driver-vehicle.md, макеты
// «Временный водитель - варианты.dc.html» 1a–1g, design-2026-10-19b): полная смена на обычной машине на стенде.
// Остальные строки и сюжет — `temporary-driver-vehicle.spec.ts`, общее — `temporary-driver-vehicle.helpers.ts`.
//   Часы стенда настоящие: осмотр открывается с начала окна доступа (Q-W2.72-3), а выбор закрывается за 30 минут до
//   окна рейса, поэтому доступ этой строки начинается через 100 с, за полчаса до окна рейса, как в сценарии docs/29
//   (доступ с 12:58, осмотр в 13:24 при окне с 14:00); запрос — командой логиста (диалог 1a шлёт окно рейса, его
//   проходит строка 1a → 1f). Сдача — сразу после выезда, до начала окна рейса (Q-W2.75-3 исправлен, Q-W2.91-1).
//   Файл отдельный, чтобы шард сторожа (по spec-файлам целиком) не складывал строки S2-20 в один прогон.
import { expect, test } from '../../_stand/fixtures.ts';
import { ELF, SPRINTER } from '../../driver-offer.helpers.ts';
import { POOL_H1 } from '../../logistics-pool.helpers.ts';
import { plan, realClock } from '../../logistics.stand.ts';
import { call } from '../../shell.helpers.ts';
import * as J from './journey.ts';
import {
  approveApi,
  approveWithCar,
  choosePath,
  chooseSprinter,
  dayStand,
  departOnSprinter,
  h2,
  homeCompanyChecks,
  iso,
  MIN,
  MSK,
  onlyOffered,
  requestApi,
  transferOf,
  twoHeld,
  waitUntil,
  type Window,
} from './temporary-driver-vehicle.helpers.ts';

test.describe('S2-20 — полная смена на обычной машине, журни на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('полная смена на обычной машине: выбор, осмотр с фото, выезд, сдача; фирма машины видит осмотр сдачи, фирма рейса принимает смену', async ({
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    // Часы стенда настоящие: сдача — сразу после выезда, до начала окна рейса.
    test.setTimeout(15 * MIN);
    await realClock(page);
    // Окно рейса — через 33 минуты: срок выбора (начало − 30 мин) — через 3 минуты. Окно доступа — через 100 с и до
    // конца рейса: запрос, начавшийся до решения, воркер закрывает как просроченный, поэтому одобрение и выбор — до
    // начала доступа (выбор открыт с одобрения, Q-W2.71-3), осмотр и файлы — с его начала (Q-W2.72-3).
    const begin = Math.ceil((Date.now() + 33 * MIN) / MIN) * MIN;
    const d = await dayStand({ browser, harness }, session, undo, testInfo.project.name, { begin });
    const opens = Math.ceil((Date.now() + 100_000) / 1000) * 1000;
    const access: Window = {
      startsAt: iso(opens),
      endsAt: d.trip.plannedWindow.endsAt,
      timeZone: MSK,
    };
    await requestApi(d, access);

    // 1b · «Север Логистик» — «Одобрить с машиной» на экране; сервер — две брони до выбора с общей группой.
    await d.owner.goto(`/t/${d.tenant}/pool?trip=${d.trip.id}`);
    await expect(J.h1(d.owner, POOL_H1)).toBeVisible(J.SERVER);
    await approveWithCar(d.owner, d.code, d.trip);
    await twoHeld(d.owner, d.tenant, d.trip.id, d.akh);
    expect(Date.now(), 'одобрение — до срока выбора').toBeLessThan(begin - 30 * MIN);

    // 1c → 1e · телефон водителя: только предложенные машины; выбор Mercedes Sprinter до срока.
    const dr = d.driver;
    await dr.goto(`/t/${d.tenant}/today`);
    await expect(h2(dr, 'Выберите машину')).toBeVisible(J.SERVER);
    await onlyOffered(dr, d.tenant, [SPRINTER.model, ELF.model]);
    await chooseSprinter(dr);
    expect(Date.now(), 'выбор — до срока').toBeLessThan(begin - 30 * MIN);
    expect((await transferOf(d.owner, d.tenant, d.trip.id))?.vehicle).toMatchObject({
      homeVehicle: { reservationState: 'confirmed' },
      hostVehicle: { reservationState: 'released', releaseReason: 'chosen' },
    });

    expect(Date.now(), 'выбор — до начала доступа').toBeLessThan(opens);

    // 1e · с начала доступа — осмотр с пятью фото на выбранной машине и выезд: смена открывается сразу осмотром.
    await waitUntil(dr, opens, 'начала доступа к рейсу');
    await dr.reload();
    const file = await J.jpeg(dr, 'Ортус · S2-20 · обычная машина');
    await departOnSprinter(dr, 'stand', file, d.cars.sprinterKm + 5);
    expect(((await plan(d.owner, d.tenant, d.trip.id)).body as { state: string }).state).toBe(
      'on_route',
    );

    // Сдача на телефоне сразу, до начала окна рейса (Q-W2.75-3): «Завершить рейс» → осмотр при сдаче с пятью фото →
    // «Сдать машину»; бронь обычной машины закрыта без пустого интервала.
    await J.returnOnScreen(dr, d.tenant, 'stand', file, d.cars.sprinterKm + 60);
    const p = (await plan(d.owner, d.tenant, d.trip.id)).body as {
      state: string;
      vehicleId?: string;
    };
    expect([p.state, p.vehicleId]).toEqual(['submitted', d.cars.sprinter]);

    // Фирма машины («Север Логистик», Котова): осмотры своей машины видны, машина свободна до приёмки (правило 6).
    const kotova = await J.desktop(browser, harness, 'manager');
    undo('контекст 1440 Котовой', () => kotova.close());
    await homeCompanyChecks(
      kotova.page,
      d.tenant,
      d.trip.id,
      d.cars.sprinter,
      d.cars.sprinterKm + 60,
    );

    // Фирма рейса принимает смену на «Приёмке смен»; доступ водителя к рейсу закрыт.
    await J.acceptOnReview(d.owner, d.tenant, d.trip.number);
    expect(((await plan(d.owner, d.tenant, d.trip.id)).body as { state: string }).state).not.toBe(
      'submitted',
    );
  });
});

// Q-W2.75-3 (исправлен, Q-W2.91-1): осмотр сдачи обычной машины раньше начала окна рейса (рейс начат до окна по доступу
// с одобрения, как в docs/29) не оставляет у брони пустой интервал, listReservations отвечает 200.
test.describe('S2-20 — сдача обычной машины до окна рейса @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('Q-W2.75-3: осмотр сдачи до окна рейса — бронь не пустая, listReservations отвечает 200', async ({
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(10 * MIN);
    await realClock(page);
    const begin = Math.ceil((Date.now() + 33 * MIN) / MIN) * MIN;
    const d = await dayStand({ browser, harness }, session, undo, testInfo.project.name, { begin });
    const opens = Math.ceil((Date.now() + 60_000) / 1000) * 1000;
    const id = await requestApi(d, {
      startsAt: iso(opens),
      endsAt: d.trip.plannedWindow.endsAt,
      timeZone: MSK,
    });
    await approveApi(d, id);
    const x = await twoHeld(d.owner, d.tenant, d.trip.id, d.akh);
    J.expectOk(
      await call(
        d.driver,
        'POST',
        choosePath(d.tenant, x.vehicle?.homeVehicle?.reservationId ?? ''),
      ),
      'chooseReservation',
    );
    await waitUntil(d.driver, opens, 'начала доступа к рейсу');
    const dr = d.driver;
    await dr.goto(`/t/${d.tenant}/today`);
    const file = await J.jpeg(dr, 'Ортус · Q-W2.75-3');
    await departOnSprinter(dr, 'stand', file, d.cars.sprinterKm + 5);
    await J.returnOnScreen(dr, d.tenant, 'stand', file, d.cars.sprinterKm + 60);
    const r = await call(
      d.owner,
      'GET',
      `/api/v1/tenants/${d.tenant}/fleet/reservations?limit=200`,
    );
    expect(r.status, 'listReservations после сдачи до окна рейса').toBe(200);
    await dr.reload();
    await expect(h2(dr, 'Ожидает приёмки менеджером')).toBeVisible(J.SERVER);
  });
});
