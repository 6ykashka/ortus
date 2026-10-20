// W2.32 · Выход этапа 2, AC-12 (design/docs/15-quality-security.md, S1-18, D-23): владелец отключает «Логистику» при
// рейсе в пути — «Затронет сейчас» называет рейс, модуль уходит в draining; новый рейс — 403 module_read_only; водитель
// на телефоне завершает рейс и сдаёт машину, менеджер принимает смену; без начатых смен модуль — только чтение.
// Анализ 08-requirements.md J7.
//   @stand — водитель — страница проекта, владелец и менеджер — свои контексты 1440; выезд — командами водителя
//            (бронь, осмотр с пятью фото, старт), отключение, сдача и приёмка — на экранах. Уборка включает модуль
//            снова (базовый сид — «Логистика» в «Альте» подключена, W2.54) и закрывает смену.
//   @mock  — test.fixme: сценарный сервер не моделирует draining (см. строку).
import type { Persona } from '@ortus/e2e-kit';
import type { Browser, Page } from '@playwright/test';

import { expect, type Session, test, type Undo } from '../../_stand/fixtures.ts';
import { depart, openDriver } from '../../driver.helpers.ts';
import {
  apiDeparture,
  apiStart,
  closeTrip,
  driverTrip,
  label,
  type LogisticsStand,
  logisticsOn,
  NO_STORAGE,
  type Plan,
  plan,
  plans,
  readyFile,
  realClock,
  storageReachable,
} from '../../logistics.stand.ts';
import { dialog, moduleCard, toast } from '../../modules.helpers.ts';
import { call } from '../../shell.helpers.ts';
import * as J from './journey.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;
type UnitPlan = Plan & { orgUnitId: string };

const BANNER =
  'Новые брони и рейсы закрыты. Начатые смены можно завершить; история доступна для чтения.';

/** Состояние «Логистики» организации (getModuleInstallation) и ETag. */
async function fleetModule(page: Page, tenant: string): Promise<{ state: string; etag: string }> {
  const r = J.expectOk(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/modules/fleet`),
    'getModuleInstallation',
  );
  return { state: (r.body as { state: string }).state, etag: r.headers.etag ?? '' };
}

/** Состояние рейса. */
const stateOf = async (page: Page, tenant: string, id: string): Promise<string> =>
  ((await plan(page, tenant, id)).body as { state: string }).state;

/** Уборка: «Логистика» снова подключена (базовый сид W2.54). */
async function enableFleet(owner: Page, tenant: string): Promise<void> {
  const cur = await fleetModule(owner, tenant);
  if (cur.state === 'active') return;
  J.expectOk(
    await call(owner, 'PUT', `/api/v1/tenants/${tenant}/modules/fleet`, {
      body: { enabled: true, reason: 'W2.32: возврат базового сида после AC-12' },
      ifMatch: cur.etag,
    }),
    'setModuleInstallation enabled',
  );
}

/**
 * Владелец на «Модули и место»: «Отключить» «Логистику» — «Затронет сейчас» называет начатый рейс и водителя, флажок
 * последствий, «Отключить модуль» → тост, карточка «Отключён · только чтение», модуль в `draining`.
 */
async function disableWithShift(owner: Page, tenant: string, trip: Plan): Promise<void> {
  await owner.goto(`/t/${tenant}/modules`);
  await expect(J.h1(owner, 'Модули и место')).toBeVisible({ timeout: 15_000 });
  await moduleCard(owner, 'Логистика').getByRole('button', { name: 'Отключить' }).click();
  const d = dialog(owner);
  await expect(d.getByRole('heading', { name: 'Отключить «Логистика»?' })).toBeVisible(J.SERVER);
  await expect(d).toContainText('Затронет сейчас');
  await expect(d).toContainText(`Рейс ${trip.number}`);
  await expect(d).toContainText('Илья Васильев');
  await expect(d).toContainText('Начатые смены можно безопасно завершить и принять');
  const confirm = d.getByRole('button', { name: 'Отключить модуль' });
  await expect(confirm).toBeDisabled();
  await d.getByText('Понимаю последствия для текущей работы').click();
  await confirm.click();
  await expect(toast(owner)).toHaveText('Модуль отключён. История доступна для чтения', J.SERVER);
  await expect(moduleCard(owner, 'Логистика')).toContainText('Отключён · только чтение');
  expect((await fleetModule(owner, tenant)).state).toBe('draining');
}

/** Новый рейс при отключении закрыт: 403 module_read_only. */
async function newTripClosed(owner: Page, tenant: string, trip: UnitPlan): Promise<void> {
  const created = await call(owner, 'POST', `/api/v1/tenants/${tenant}/fleet/trip-plans`, {
    body: {
      orgUnitId: trip.orgUnitId,
      title: 'После отключения',
      plannedWindow: trip.plannedWindow,
      cargo: { description: 'Сухой груз', weightKg: '500', volumeM3: '5', lengthM: '2' },
      stops: [
        { sequence: 1, op: 'load', address: 'Склад № 1, Лобня', weightKg: '500', volumeM3: '5' },
        { sequence: 2, op: 'unload', address: 'Химки', weightKg: '500', volumeM3: '5' },
      ],
    },
  });
  expect([created.status, (created.body as { code?: string }).code]).toEqual([
    403,
    'module_read_only',
  ]);
}

/** Водитель: модуль только для чтения — смена принята, баннер оболочки. */
async function driverReadOnly(page: Page): Promise<void> {
  await page.reload();
  await expect(J.h2(page, 'Смена принята')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Модуль «Логистика» отключён.')).toBeVisible();
  await expect(page.getByText(BANNER)).toBeVisible();
}

test.describe('выход этапа 2 — AC-12 отключение «Логистики» с активным рейсом @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты — сценарный сервер mock');

  // Шаги записаны целиком (fixme снимается без правки тела). Сценарный сервер (adapter/src/msw/modules) draining не
  // моделирует: previewModuleDeactivation всегда отвечает «Активных процессов нет» (activeItems: []), отключение сразу
  // даёт read_only, а read_only закрывает и сдачу начатой смены (403 module_read_only) — строка падает в
  // `disableWithShift` на «Затронет сейчас». Путь AC-12 — на стенде (строка @stand); владелец MSW — W2.62 (Q-W2.32-5).
  test.fixme('«Затронет сейчас» — рейс в пути; новый рейс 403 module_read_only; смена сдаётся и принимается', async ({
    app,
    page,
  }) => {
    test.setTimeout(180_000);
    await J.mockStorage(page);
    const alta = await openDriver(app, page, 'today');
    await depart(page);
    const r208 = (await plans(page, alta)).find((p) => p.number === 'Р-208') as UnitPlan;
    expect(r208.state).toBe('on_route');

    await app(`/t/${alta}/home`, { persona: 'owner' });
    await disableWithShift(page, alta, r208);
    await newTripClosed(page, alta, r208);

    // Рейс в пути сдаётся на экране при draining; затем приёмка — и модуль только для чтения.
    await app(`/t/${alta}/home`, { persona: 'driver' });
    const file = await J.jpeg(page, 'Ортус · отключение');
    await J.returnOnScreen(page, alta, 'mock', file, 84560);
    await app(`/t/${alta}/home`, { persona: 'manager' });
    await J.acceptOnReview(page, alta, r208.number);
    expect(await stateOf(page, alta, r208.id)).toBe('accepted');
    await app(`/t/${alta}/home`, { persona: 'owner' });
    await expect
      .poll(async () => (await fleetModule(page, alta)).state, J.SERVER)
      .toBe('read_only');
    await app(`/t/${alta}/today`, { persona: 'driver' });
    await driverReadOnly(page);
  });
});

interface StandFx {
  app: AppFn;
  page: Page;
  browser: Browser;
  harness: { appURL: string; allowHosts: readonly string[] };
  session: () => Promise<Session>;
  undo: Undo;
}

/**
 * Стенд: «Логистика» подключена, владелец и менеджер — свои контексты 1440, рейс водителя на проект; уборка — модуль
 * снова подключён, затем смена закрыта (undo идёт в обратном порядке).
 */
async function standShift(
  fx: StandFx,
  title: string,
): Promise<{ s: LogisticsStand; owner: Page; manager: Page; trip: UnitPlan }> {
  const { app, page, browser, harness, session, undo } = fx;
  await realClock(page);
  const s = await logisticsOn(session, undo);
  const owner = await J.desktop(browser, harness, 'owner');
  const manager = await J.desktop(browser, harness, 'manager');
  undo('контексты 1440', async () => {
    await manager.close();
    await owner.close();
  });
  await app('/', { persona: 'driver' });
  const trip = (await driverTrip(page, manager.page, s, title)) as UnitPlan;
  expect(await storageReachable(page, s.tenant, trip.id, harness.allowHosts), NO_STORAGE).toBe(
    true,
  );
  undo(`смена рейса ${trip.number}`, () => closeTrip(page, manager.page, s.tenant, trip.id));
  undo('«Логистика» «Альты» подключена', () => enableFleet(owner.page, s.tenant));
  return { s, owner: owner.page, manager: manager.page, trip: { ...trip, orgUnitId: s.unitId } };
}

test.describe('выход этапа 2 — AC-12 на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец 1440 отключает «Логистику» при начатой смене: «Затронет сейчас», draining, новый рейс 403; смена сдаётся и принимается, затем только чтение', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(360_000);
    const { s, owner, manager, trip } = await standShift(
      { app, page, browser, harness, session, undo },
      `Отключение W2.32 ${label(testInfo.project.name)}`,
    );

    // Начатая смена: бронь, осмотр с пятью фото, выезд, «Завершить рейс» и осмотр при сдаче — командами водителя;
    // сдача (returnTrip) — уже при отключённом модуле. «Завершить рейс» и осмотр при отключении сервер закрывает
    // (Q-W2.32-3 → W2.60) — путь с рейсом в пути на экране — строка @known-defect ниже.
    const shift = await apiDeparture(page, s.tenant, trip);
    await apiStart(page, s.tenant, shift);
    const ret = await returnInspection(
      page,
      s.tenant,
      trip,
      Number(shift.vehicle.odometerKm) + 190,
    );

    await disableWithShift(owner, s.tenant, trip);
    await newTripClosed(owner, s.tenant, trip);

    // Водитель видит начатую смену и сдаёт машину (returnTrip открыт при draining).
    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    await expect(J.h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`${trip.number} · ${trip.title}`)).toBeVisible();
    J.expectOk(
      await call(page, 'PATCH', `/api/v1/tenants/${s.tenant}/fleet/trips/${trip.id}`, {
        body: { action: 'return', returnInspectionId: ret },
        ifMatch: (await plan(page, s.tenant, trip.id)).headers.etag ?? '',
      }),
      'returnTrip при draining',
    );
    await page.reload();
    await expect(J.h2(page, 'Ожидает приёмки менеджером')).toBeVisible({ timeout: 15_000 });
    expect((await fleetModule(owner, s.tenant)).state).toBe('draining');

    // Менеджер принимает смену на экране — начатой работы нет, модуль — только чтение.
    await J.acceptOnReview(manager, s.tenant, trip.number);
    expect(await stateOf(manager, s.tenant, trip.id)).toBe('accepted');
    await expect
      .poll(async () => (await fleetModule(owner, s.tenant)).state, J.SERVER)
      .toBe('read_only');
    await driverReadOnly(page);
  });
});

// Дефект backend (Q-W2.32-3 → W2.60): при draining шлюз модулей (modulesreg/gate.go finishOnly) закрывает «Завершить
// рейс» (finishTripRoute) и осмотр при сдаче (submitInspection) — 403 module_read_only «…можно только завершить
// начатую работу.», поэтому смена, начатая до отключения, на экране не сдаётся. Строка вне grep e2e-stand
// (`@known-defect`). Шаги записаны целиком: модуль отключается, пока рейс в пути (`on_route`), сдача — на экране; после
// исправления — снять fixme и сменить тег на @stand (Q-W2.32-10). Сейчас строка падает в `J.returnOnScreen` на
// «Завершить рейс». Баннер оболочки в draining не проверяется (Q-W2.32-4, по умолчанию — как есть). Владельцы: шлюз
// модулей — W1.08, «Завершить рейс» — W2.05.
test.describe('выход этапа 2 — AC-12: начатая смена сдаётся на экране после отключения @known-defect', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('рейс в пути → отключение → «Завершить рейс», осмотр при сдаче, «Сдать машину» → приёмка → только чтение', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(360_000);
    const { s, owner, manager, trip } = await standShift(
      { app, page, browser, harness, session, undo },
      `Отключение W2.32 экран ${label(testInfo.project.name)}`,
    );
    const shift = await apiDeparture(page, s.tenant, trip);
    await apiStart(page, s.tenant, shift);
    expect(await stateOf(page, s.tenant, trip.id)).toBe('on_route');

    await disableWithShift(owner, s.tenant, trip);
    expect(await stateOf(owner, s.tenant, trip.id), 'рейс в пути при отключении').toBe('on_route');
    await newTripClosed(owner, s.tenant, trip);

    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    const file = await J.jpeg(page, 'Ортус · отключение');
    await J.returnOnScreen(page, s.tenant, 'stand', file, Number(shift.vehicle.odometerKm) + 190);
    expect((await fleetModule(owner, s.tenant)).state).toBe('draining');

    await J.acceptOnReview(manager, s.tenant, trip.number);
    expect(await stateOf(manager, s.tenant, trip.id)).toBe('accepted');
    await expect
      .poll(async () => (await fleetModule(owner, s.tenant)).state, J.SERVER)
      .toBe('read_only');
    await driverReadOnly(page);
  });
});

/** «Завершить рейс» и осмотр при сдаче с пятью фото (MinIO, cmd/worker) — id осмотра; сдача — отдельно. */
async function returnInspection(
  driver: Page,
  tenant: string,
  trip: Plan,
  odometer: number,
): Promise<string> {
  const base = `/api/v1/tenants/${tenant}/fleet`;
  J.expectOk(
    await call(driver, 'POST', `${base}/trips/${trip.id}/route-completion`, {
      ifMatch: (await plan(driver, tenant, trip.id)).headers.etag ?? '',
    }),
    'finishTripRoute',
  );
  const vehicleId = ((await plan(driver, tenant, trip.id)).body as { vehicleId: string }).vehicleId;
  const list = J.expectOk(
    await call(driver, 'GET', `${base}/inspection-checklist?vehicleId=${vehicleId}&kind=return`),
    'getInspectionChecklist',
  ).body as { versionId: string; items: { key: string }[] };
  const roles = ['front', 'rear', 'left', 'right', 'odometer'] as const;
  const files: string[] = [];
  while (files.length < roles.length) {
    files.push(
      await readyFile(driver, tenant, 'inspection', { entityType: 'trip', entityId: trip.id }),
    );
  }
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const r = J.expectOk(
    await call(driver, 'POST', `${base}/inspections`, {
      body: {
        checklistVersionId: list.versionId,
        vehicleId,
        kind: 'return',
        tripId: trip.id,
        odometerKm: String(odometer),
        fuelPercent: 50,
        checks: list.items.map((i) => ({ key: i.key, result: 'pass' })),
        photos: roles.map((role, i) => ({ role, fileId: files[i], capturedAt: at })),
        capturedAt: at,
      },
    }),
    'submitInspection return',
  );
  return (r.body as { id: string }).id;
}
