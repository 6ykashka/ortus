// W2.75 · Журни S2-20 «Машина для временного водителя» (D-35; design/docs/29-temporary-driver-vehicle.md, макеты
// «Временный водитель - варианты.dc.html» 1a–1g, design-2026-10-19b; DoR docs/plan/v2/analysis/dor/
// s2-20-temporary-driver-vehicle.md §6, §8) — backend W2.72, логист и фирма водителя W2.73, водитель W2.74.
// Пишет не автор экранов.
//   Сюжет: Тимур Ахмедов («Север Логистик», в сиде стенда своей роли нет — узкая роль «Временный водитель» с одобрения)
//   опубликован в пуле с обычной машиной Mercedes Sprinter; рейс «Юг Транс» без водителя. Логист фирмы рейса и
//   менеджер фирмы водителя — владелец (в сиде нет логиста «Юг Транс»; так же журни AC-06 W2.32) в своём контексте
//   1440; фирма машины при сдаче — Марина Котова («Менеджер логистики» «Север Логистик»); водитель — телефон проекта
//   (390 на mobile-390). Часы стенда настоящие: окна рейсов — от «сейчас».
//   Полная смена на обычной машине (ждёт начала окна рейса ≈ 30 минут на проект) — `temporary-driver-vehicle-shift
//   .spec.ts`: отдельный файл, шард сторожа e2e-stand берёт его целиком (возврат 1). Общее — `temporary-driver-vehicle
//   .helpers.ts`; ожидания часов стенда печатают ход не реже раза в 5 минут (`waitUntil`: сторож снимает после 20 минут
//   тишины).
//   «Приёмка» docs/29 (дополнения AC-06): POST /fleet/reservations временного водителя — 403; choose чужой и не
//   предложенной брони — 404; выбор второй раз и после срока — 409 offer_closed без изменений; два параллельных choose —
//   подтверждена одна; срок прошёл — машина фирмы рейса подтверждена, обычная освобождена; «Только водителя» — брони
//   обычной нет, рейс в «Требует решения»; список машин временного водителя — только предложенные.
//   Mock: тот же день на сценарном сервере; узкая роль в MSW действует с начала окна (Q-W2.74-6), поэтому водитель —
//   с ролью «Водитель» своей фирмы, как строки W2.74 (`driver-offer.helpers.ts`).
import { expect, test } from '../../_stand/fixtures.ts';
import { assign, listUnits, roleId } from '../../_stand/stand.ts';
import {
  ELF,
  IN_WINDOW,
  offerSheet,
  SPRINTER,
  standOffer,
  W as MOCK_W,
} from '../../driver-offer.helpers.ts';
import { card } from '../../home.helpers.ts';
import { tab, tripValue, vehicleRow } from '../../logistics.helpers.ts';
import { journal, tripCars } from '../../logistics-pool-s220.helpers.ts';
import { driverCard, incomingCard, POOL_H1 } from '../../logistics-pool.helpers.ts';
import { GAZEL, logisticsOn, plan, realClock, vehicles } from '../../logistics.stand.ts';
import { toast } from '../../modules.helpers.ts';
import { call, devScenario, tenantId } from '../../shell.helpers.ts';
import * as J from './journey.ts';
import {
  approveApi,
  approveWithCar,
  chooseAtOnce,
  chooseClosed,
  choosePath,
  chooseSprinter,
  dayStand,
  type Day,
  ddOf,
  departOnSprinter,
  esc,
  h2,
  hhmm,
  homeCompanyChecks,
  MIN,
  noBooking,
  OFFER_CLOSED,
  onlyOffered,
  PROGRESS_EVERY,
  requestApi,
  requestDialog,
  requestTwo,
  reservation,
  reserveForbidden,
  SEVER,
  type Sleeper,
  sprinterFree,
  statusCode,
  take,
  transferOf,
  twoHeld,
  waitUntil,
  YUG,
} from './temporary-driver-vehicle.helpers.ts';

test.describe('S2-20 — машина временного водителя, журни на mock @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'часы и пресеты — сценарный сервер mock');

  test('день рейса: запрос с машиной, «Одобрить с машиной», выбор обычной на телефоне, осмотр, выезд, сдача, приёмка', async ({
    app,
    page,
  }) => {
    test.setTimeout(180_000);
    await J.mockStorage(page);
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    const T = `/api/v1/tenants/${tenant}`;
    const units = await listUnits(page, tenant);
    const sever = units.find((u) => u.name === SEVER)?.id ?? '';
    const yug = units.find((u) => u.name === YUG)?.id ?? '';
    const members = J.expectOk(await call(page, 'GET', `${T}/members?limit=200`), 'listMembers')
      .body as { items: { id: string; displayName: string; revision: number }[] };
    const akh = members.items.find((m) => m.displayName === 'Тимур Ахмедов');
    if (!akh) throw new Error('нет Тимура Ахмедова');
    J.expectOk(
      await call(page, 'PATCH', `${T}/members/${akh.id}`, {
        body: { orgUnitIds: [sever] },
        ifMatch: `"rev-${akh.revision}"`,
      }),
      'updateMember',
    );
    // Q-W2.74-6: узкая роль в MSW — с начала окна, выбор — до него; водитель mock — «Водитель» своей фирмы.
    await assign(page, tenant, {
      memberId: akh.id,
      roleId: await roleId(page, tenant, 'Водитель'),
      unitId: sever,
    });
    const cars = (await vehicles(page, tenant)) as {
      id: string;
      displayName: string;
      odometerKm: string;
    }[];
    const sprinter = cars.find((v) => v.displayName === SPRINTER.model);
    if (!sprinter) throw new Error(`нет «${SPRINTER.model}»`);
    const pub = J.expectOk(
      await call(page, 'POST', `${T}/fleet/driver-pool/publications`, {
        body: {
          driverMemberId: akh.id,
          homeOrgUnitId: sever,
          freeWindow: MOCK_W,
          qualifications: ['Кат. B'],
          terms: 'По соглашению фирм группы',
          usualVehicleId: sprinter.id,
        },
      }),
      'publishDriverToPool',
    ).body as { id: string; displayName: string };
    const trip = J.expectOk(
      await call(page, 'POST', `${T}/fleet/trip-plans`, {
        body: {
          orgUnitId: yug,
          title: 'Сборный груз',
          plannedWindow: MOCK_W,
          distanceKm: '35',
          cargo: {
            description: 'Сухой груз · 5 паллет-мест',
            weightKg: '400',
            volumeM3: '5',
            lengthM: '2',
          },
          stops: [
            {
              sequence: 1,
              op: 'load',
              address: 'Склад № 1, Лобня',
              plannedAt: MOCK_W.startsAt,
              weightKg: '400',
              volumeM3: '5',
            },
            {
              sequence: 2,
              op: 'unload',
              address: 'Химки, ул. Заводская, 8',
              plannedAt: '2026-10-01T12:30:00Z',
              weightKg: '400',
              volumeM3: '5',
            },
          ],
        },
      }),
      'createTripPlan «Юг Транс»',
    ).body as Day['trip'];

    // 1a → 1b · логист «Юг Транс» и фирма водителя — экраны владельца.
    await app(`/t/${tenant}/home`, { persona: 'owner' });
    await requestTwo(page, tenant, trip, pub.displayName);
    await approveWithCar(page, pub.displayName, trip);
    const x = await twoHeld(page, tenant, trip.id, akh.id);
    expect(x.vehicle?.chooseUntil, 'срок выбора 13:30').toBe('2026-10-01T10:30:00Z');

    // 1c → 1e · телефон водителя: выбор обычной машины, осмотр и выезд в окне рейса.
    await J.relogin(page, 'acc-9');
    await page.goto(`/t/${tenant}/today`);
    await expect(h2(page, 'Выберите машину')).toBeVisible(J.SERVER);
    await expect(page.getByText(`${trip.number} · ${trip.title}`)).toBeVisible();
    await expect(page.getByText('До 13:30. Вторую бронь снимем сразу после выбора.')).toBeVisible();
    await chooseSprinter(page);
    await chooseClosed(page, tenant, x.vehicle?.hostVehicle?.reservationId ?? '');
    await J.serverNow(page, IN_WINDOW);
    const file = await J.jpeg(page, 'Ортус · S2-20');
    const km = Number(sprinter.odometerKm);
    await departOnSprinter(page, 'mock', file, km + 5);
    await J.returnOnScreen(page, tenant, 'mock', file, km + 60);

    // Фирма машины (Котова, «Север Логистик») видит осмотры своей машины. Освобождение до приёмки (правило 6) в MSW
    // не смоделировано — машина «blocked» за рейсом до приёмки (Q-W2.75-2); проверяет строка стенда.
    await J.relogin(page, 'manager');
    await homeCompanyChecks(page, tenant, trip.id, sprinter.id, km + 60, { released: false });

    // Фирма рейса принимает смену; машина рейса — выбранная обычная.
    await J.relogin(page, 'owner');
    const p = (await plan(page, tenant, trip.id)).body as { state: string; vehicleId?: string };
    expect([p.state, p.vehicleId]).toEqual(['submitted', sprinter.id]);
    await J.acceptOnReview(page, tenant, trip.number);
  });
});

// Возврат 1 W2.75: полный e2e-stand снят сторожем дважды — строка «полная смена» молча ждала начала окна рейса
// ≈ 30 минут (`until`), сторож снимает после 20 минут без вывода. Ожидание часов стенда печатает ход.
test.describe('S2-20 — ожидание часов стенда печатает ход @mock', () => {
  test('31 минута до окна рейса: сон порциями не длиннее 5 минут, перед каждой — строка хода', async () => {
    const start = Date.now();
    let clock = start;
    const naps: number[] = [];
    const lines: { at: number; text: string }[] = [];
    const sleeper: Sleeper = {
      waitForTimeout: async (ms) => {
        naps.push(ms);
        clock += ms;
      },
    };
    const at = start + 31 * MIN;
    await waitUntil(sleeper, at, 'начала окна рейса', {
      pad: 5000,
      now: () => clock,
      log: (text) => lines.push({ at: clock, text }),
    });
    expect(Math.max(...naps), 'самый долгий сон без вывода').toBeLessThanOrEqual(PROGRESS_EVERY);
    const marks = [...lines.map((l) => l.at), clock];
    const gaps = marks.slice(1).map((t, i) => t - (marks[i] ?? t));
    expect(lines.length, 'строки хода').toBeGreaterThanOrEqual(7);
    expect(Math.max(...gaps), 'самый долгий промежуток между строками хода').toBeLessThanOrEqual(
      PROGRESS_EVERY,
    );
    expect(lines[0]?.text).toContain('начала окна рейса');
    expect(clock, 'проснулись после окна и запаса').toBe(at + 5000);
  });

  test('момент уже прошёл — без сна и без вывода', async () => {
    const naps: number[] = [];
    const lines: string[] = [];
    await waitUntil(
      { waitForTimeout: async (ms) => void naps.push(ms) },
      Date.now() - MIN,
      'начала доступа',
      { log: (text) => lines.push(text) },
    );
    expect([naps, lines]).toEqual([[], []]);
  });
});

test.describe('S2-20 — машина временного водителя, журни на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('день рейса 1a → 1f: запрос с машиной, «Одобрить с машиной», выбор водителя, итог у логиста', async ({
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(300_000);
    await realClock(page);
    const d = await dayStand({ browser, harness }, session, undo, testInfo.project.name);
    const win = `${hhmm(d.trip.plannedWindow.startsAt)}–${hhmm(d.trip.plannedWindow.endsAt)}`;

    // 1a · логист «Юг Транс»: «Ставим нашу машину» Isuzu Elf и «Можно взять свою обычную» (по умолчанию).
    await requestTwo(d.owner, d.tenant, d.trip, d.code);
    // 1b · фирма водителя: «Машина» — на выбор водителя, «Ваша машина», «Одобрить с машиной».
    await approveWithCar(d.owner, d.code, d.trip);

    // Сервер одной транзакцией: назначение, доступ к рейсу и две брони до выбора с общей группой (срок — начало
    // окна − 30 минут).
    const x = await twoHeld(d.owner, d.tenant, d.trip.id, d.akh);
    const chooseUntil = x.vehicle?.chooseUntil ?? '';
    expect(Date.parse(chooseUntil)).toBe(Date.parse(d.trip.plannedWindow.startsAt) - 30 * MIN);

    // 1f · итог у логиста: две «Бронь до выбора», журнал и сноска о сроке.
    const c = driverCard(d.owner, d.code);
    await expect(c.locator('.ox-pl-chip').first()).toContainText('Временно назначен', J.SERVER);
    await expect(c.getByText('Машины рейса')).toBeVisible();
    await expect(tripCars(c)).toHaveCount(2);
    await expect(tripCars(c).first()).toContainText(`${SPRINTER.model} · ${SPRINTER.plate}`);
    await expect(tripCars(c).first()).toContainText(`${SEVER} · обычная машина водителя`);
    await expect(tripCars(c).nth(1)).toContainText(`${ELF.model} · ${ELF.plate}`);
    await expect(tripCars(c).nth(1)).toContainText(`${YUG} · наша`);
    await expect(tripCars(c).locator('.ox-pl-chip')).toHaveText([
      /Бронь до выбора$/,
      /Бронь до выбора$/,
    ]);
    const before = await journal(c);
    expect(before).toHaveLength(3);
    expect(before[0]).toMatch(
      new RegExp(
        `^\\d\\d:\\d\\d Вы запросили водителя\\. Машина: наша ${esc(ELF.model)}, можно свою обычную\\.$`,
      ),
    );
    expect(before[1]).toMatch(new RegExp(`^\\d\\d:\\d\\d ${SEVER} одобрил водителя с машиной\\.$`));
    expect(before[2]).toMatch(
      new RegExp(
        `^\\d\\d:\\d\\d Брони до выбора на .*${esc(win)}: ${esc(ELF.model)} и ${esc(SPRINTER.model)}\\.$`,
      ),
    );
    await expect(c).toContainText(
      `Если водитель не выбирает до ${hhmm(chooseUntil)}, остаётся ${ELF.model}, а ${SPRINTER.model} возвращается в ${SEVER}.`,
    );

    // 1c · телефон водителя: две предложенные машины, срок, без брони и чужих машин; список машин — только
    // предложенные; своя бронь — 403.
    const dr = d.driver;
    await dr.goto(`/t/${d.tenant}/today`);
    await expect(h2(dr, 'Выберите машину')).toBeVisible(J.SERVER);
    await expect(dr.getByText(`${d.trip.number} · ${d.trip.title}`)).toBeVisible();
    await expect(
      dr.getByText(`До ${hhmm(chooseUntil)}. Вторую бронь снимем сразу после выбора.`),
    ).toBeVisible();
    await onlyOffered(dr, d.tenant, [SPRINTER.model, ELF.model]);
    await reserveForbidden(dr, d.tenant, d.akh, d.cars.elf, d.trip.plannedWindow);

    // 1d → 1e · «Берёте Mercedes Sprinter?» → «Взять и начать осмотр»: бронь закреплена, Isuzu Elf освобождена.
    await chooseSprinter(dr);

    // AC-06: выбор второй раз — 409 offer_closed, выбор не меняется.
    await chooseClosed(dr, d.tenant, x.vehicle?.hostVehicle?.reservationId ?? '');
    await chooseClosed(dr, d.tenant, x.vehicle?.homeVehicle?.reservationId ?? '');
    const after = await transferOf(d.owner, d.tenant, d.trip.id);
    expect(after?.vehicle?.homeVehicle).toMatchObject({ reservationState: 'confirmed' });
    expect(after?.vehicle?.hostVehicle).toMatchObject({
      reservationState: 'released',
      releaseReason: 'chosen',
    });
    const t = (await plan(d.owner, d.tenant, d.trip.id)).body as {
      state: string;
      vehicleId?: string;
    };
    expect([t.state, t.vehicleId]).toEqual(['assigned', d.cars.sprinter]);

    // 1f · логист: «Выбрана» и «Освобождена», «Водитель выбрал …», «Оставить …» больше нет.
    await d.owner.reload();
    await expect(tripCars(c).locator('.ox-pl-chip')).toHaveText(
      [/Выбрана · \d\d:\d\d$/, /Освобождена · \d\d:\d\d$/],
      J.SERVER,
    );
    expect((await journal(c)).at(-1)).toMatch(
      new RegExp(
        `^\\d\\d:\\d\\d Водитель выбрал ${esc(SPRINTER.model)}\\. ${esc(ELF.model)} освобождена\\.$`,
      ),
    );
    await expect(c.getByRole('button', { name: `Оставить ${ELF.model}` })).toHaveCount(0);
  });

  test('«Только водителя» → «Требует решения» «{рейс}: нет машины» → «Поставить машину» → машина рейса', async ({
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(300_000);
    await realClock(page);
    const d = await dayStand({ browser, harness }, session, undo, testInfo.project.name);

    // 1a · «Едет на своей обычной»: бронь обычной — если фирма водителя одобрит машину.
    const dlg = await requestDialog(d.owner, d.tenant, d.trip, d.code);
    await dlg.getByRole('radio', { name: 'Едет на своей обычной' }).click();
    await expect(dlg.locator('.ox-pl-sum-line > span:last-child').first()).toHaveText(
      new RegExp(`^Бронь ${esc(SPRINTER.model)} на .+, если ${SEVER} одобрит машину\\.$`),
    );
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(d.owner)).toHaveText(`Запрос отправлен фирме ${SEVER}`, J.SERVER);

    // 1b · «Только водителя».
    const row = incomingCard(d.owner, d.code);
    await expect(ddOf(row, 'Машина')).toHaveText(
      `Ваша ${SPRINTER.model} · ${SPRINTER.plate}`,
      J.SERVER,
    );
    await row.getByRole('button', { name: 'Только водителя' }).click();
    await expect(toast(d.owner)).toHaveText(`Фирма ${SEVER} одобрила запрос`, J.SERVER);
    // AC-06: бронь обычной машины не создана.
    const x = await transferOf(d.owner, d.tenant, d.trip.id);
    expect(x?.vehicle?.homeDecision).toBe('declined');
    expect(x?.vehicle?.homeVehicle?.reservationId).toBeUndefined();
    expect(x?.vehicle?.hostVehicle).toBeUndefined();
    const t0 = (await plan(d.owner, d.tenant, d.trip.id)).body as { vehicleId?: string };
    expect(t0.vehicleId, 'у рейса нет машины').toBeUndefined();

    // 1f · у логиста — «Машины нет», журнал.
    const c = driverCard(d.owner, d.code);
    await expect(c).toContainText(
      `Машины нет: ${SEVER} выдал водителя без обычной машины.`,
      J.SERVER,
    );
    await expect(tripCars(c)).toHaveCount(0);
    const lines = await journal(c);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(
      new RegExp(`^\\d\\d:\\d\\d ${SEVER} одобрил только водителя, без машины\\.$`),
    );
    expect(lines[2]).toMatch(/^\d\d:\d\d Машины нет, рейс попал в «Требует решения»\.$/);

    // 1g · «Главная» логиста: «{рейс}: нет машины» → «Поставить машину» → «Рабочее место логиста» ?trip=.
    await d.owner.goto(`/t/${d.tenant}/home`);
    const item = card(d.owner, `${d.trip.number}: нет машины`);
    await expect(item).toBeVisible(J.SERVER);
    await expect(item).toContainText(`рейс в ${hhmm(d.trip.plannedWindow.startsAt)}`);
    await expect(item).toContainText(
      `${SEVER} выдал Тимура Ахмедова без обычной машины. Водитель получит уведомление и сразу начнёт осмотр.`,
    );
    await expect(card(d.owner, `${d.trip.number}: водитель ещё не выбрал машину`)).toHaveCount(0);
    await item.getByRole('button', { name: 'Поставить машину' }).click();
    await expect(d.owner).toHaveURL(new RegExp(`/t/${d.tenant}/fleet\\?trip=${d.trip.id}$`));
    await expect(tab(d.owner, new RegExp(`^${d.trip.number} · `))).toHaveAttribute(
      'aria-selected',
      'true',
      J.SERVER,
    );
    await expect(tripValue(d.owner, 'Водитель')).toHaveText('Тимур Ахмедов');
    await vehicleRow(d.owner, ELF.model).getByRole('button', { name: 'Назначить на рейс' }).click();
    await expect(toast(d.owner)).toHaveText(`Машина назначена на рейс ${d.trip.number}`, J.SERVER);
    await expect(tripValue(d.owner, 'Машина')).toHaveText(`${ELF.model} · ${ELF.plate}`);

    // Сервер: машина рейса — Isuzu Elf, бронь водителю подтверждена сразу (рейс временного водителя, правило 8).
    const t1 = (await plan(d.owner, d.tenant, d.trip.id)).body as {
      vehicleId?: string;
      reservationId?: string;
    };
    expect(t1.vehicleId).toBe(d.cars.elf);
    const res = await reservation(d.owner, d.tenant, t1.reservationId ?? '');
    expect([res.state, res.tripId]).toEqual(['confirmed', d.trip.id]);

    // Пункт снят. Экран водителя до окна — строка Q-W2.75-1 (`@known-defect` ниже).
    await d.owner.goto(`/t/${d.tenant}/home`);
    await d.owner.locator('section[aria-labelledby="h-home"]').waitFor();
    await d.owner.waitForLoadState('networkidle');
    await expect(card(d.owner, `${d.trip.number}: нет машины`)).toHaveCount(0);
    await reserveForbidden(d.driver, d.tenant, d.akh, d.cars.elf, d.trip.plannedWindow);
  });

  test('срок выбора прошёл: остаётся машина фирмы рейса, обычная освобождена, выбор — 409 offer_closed', async ({
    page,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(480_000);
    await realClock(page);
    // Окно рейса — через 30 мин + 150 с: срок выбора (начало − 30 мин, TD-02) — через 150 с. Обычная машина в ближнем
    // окне свободна (Q-W2.75-4).
    const s = await logisticsOn(session, undo);
    await sprinterFree(s.owner, s.tenant);
    const o = await standOffer({ session, undo }, 'two', testInfo.project.name, {
      startIn: 30 * MIN + 150_000,
      length: 30 * MIN,
    });
    const deadline = o.begin - 30 * MIN;
    const x = await transferOf(o.owner, o.tenant, o.trip.id);
    expect(Date.parse(x?.vehicle?.chooseUntil ?? '')).toBe(deadline);
    const sprinterRes = x?.vehicle?.homeVehicle?.reservationId ?? '';

    // 1g · до срока меньше 15 минут: «{рейс}: водитель ещё не выбрал машину» у логиста фирмы рейса.
    await o.owner.goto(`/t/${o.tenant}/home`);
    const item = card(o.owner, `${o.trip.number}: водитель ещё не выбрал машину`);
    await expect(item).toBeVisible(J.SERVER);
    await expect(item).toContainText(`до ${hhmm(deadline)}`);
    await expect(item).toContainText(
      `Тимур Ахмедов, ${SEVER}. Не выберет — останется ${ELF.model}, ${SPRINTER.model} вернётся в ${SEVER}. Написать водителю можно в чате рейса.`,
    );
    await expect(item.getByRole('button', { name: `Оставить ${ELF.model}` })).toBeVisible();

    // 1c · водитель открыл смену до срока и не выбрал.
    const dr = o.driver;
    await dr.goto(`/t/${o.tenant}/today`);
    await expect(h2(dr, 'Выберите машину')).toBeVisible(J.SERVER);
    await expect(
      dr.getByText(`До ${hhmm(deadline)}. Вторую бронь снимем сразу после выбора.`),
    ).toBeVisible();

    // Срок прошёл: воркер стенда закрывает предложение на ближайшем проходе (WORKER_POOL_INTERVAL, Q-W2.72-10).
    await waitUntil(dr, deadline, 'срока выбора');
    await expect
      .poll(
        async () =>
          (await transferOf(o.owner, o.tenant, o.trip.id))?.vehicle?.hostVehicle?.reservationState,
        {
          message: 'машина фирмы рейса подтверждена к сроку',
          timeout: 120_000,
          intervals: [5_000],
        },
      )
      .toBe('confirmed');
    const settled = await transferOf(o.owner, o.tenant, o.trip.id);
    expect(settled?.vehicle?.hostVehicle).toMatchObject({
      displayName: ELF.model,
      reservationState: 'confirmed',
    });
    expect(settled?.vehicle?.homeVehicle).toMatchObject({
      displayName: SPRINTER.model,
      reservationState: 'released',
      releaseReason: 'deadline',
    });

    // Водитель на открытой смене берёт свою — 409 offer_closed: сообщение, смена перечитана, машина фирмы рейса.
    await take(dr, SPRINTER.model).click();
    await offerSheet(dr).getByRole('button', { name: 'Взять и начать осмотр' }).click();
    await expect(dr.locator('.ox-dr').getByRole('alert')).toContainText(OFFER_CLOSED, J.SERVER);
    await expect(offerSheet(dr)).toBeHidden();
    await expect(h2(dr, 'Машина на сегодня')).toBeVisible(J.SERVER);
    await expect(dr.locator('article.ox-dr-offer .ox-dr-car-model')).toHaveText([ELF.model]);
    await noBooking(dr);

    // AC-06: выбор после срока — 409 без изменений; бронь временного водителя — 403.
    await chooseClosed(dr, o.tenant, sprinterRes);
    expect(
      (await transferOf(o.owner, o.tenant, o.trip.id))?.vehicle?.homeVehicle?.reservationState,
    ).toBe('released');
    const elf = (await vehicles(o.owner, o.tenant)).find((v) => v.displayName === ELF.model);
    await reserveForbidden(
      dr,
      o.tenant,
      x?.driverMemberId ?? '',
      elf?.id ?? '',
      o.trip.plannedWindow,
    );

    // 1g снят; 1f · журнал логиста — «Срок выбора прошёл: …».
    await o.owner.reload();
    await o.owner.locator('section[aria-labelledby="h-home"]').waitFor();
    await o.owner.waitForLoadState('networkidle');
    await expect(card(o.owner, `${o.trip.number}: водитель ещё не выбрал машину`)).toHaveCount(0);
    await o.owner.goto(`/t/${o.tenant}/pool?trip=${o.trip.id}`);
    await expect(J.h1(o.owner, POOL_H1)).toBeVisible(J.SERVER);
    const pub = J.expectOk(
      await call(
        o.owner,
        'GET',
        `/api/v1/tenants/${o.tenant}/fleet/driver-pool/publications/${x?.publicationId ?? ''}`,
      ),
      'getDriverPoolPublication',
    ).body as { displayName: string };
    const transfer = driverCard(o.owner, pub.displayName);
    await expect(tripCars(transfer).locator('.ox-pl-chip')).toHaveText(
      [/Освобождена · \d\d:\d\d$/, /Выбрана · \d\d:\d\d$/],
      J.SERVER,
    );
    expect((await journal(transfer)).at(-1)).toBe(
      `${hhmm(deadline)} Срок выбора прошёл: остаётся ${ELF.model}, ${SPRINTER.model} вернулась в ${SEVER}.`,
    );
  });

  test('приёмка docs/29: choose чужой и не предложенной — 404, два параллельных choose — подтверждена одна', async ({
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(300_000);
    await realClock(page);
    const d = await dayStand({ browser, harness }, session, undo, testInfo.project.name);
    await approveApi(d, await requestApi(d));
    const x = await twoHeld(d.owner, d.tenant, d.trip.id, d.akh);
    const ids = [
      x.vehicle?.hostVehicle?.reservationId ?? '',
      x.vehicle?.homeVehicle?.reservationId ?? '',
    ];

    // Чужая бронь: ГАЗель Next Васильева на то же окно — не его рейс и не предложена ему. Ответ — как на
    // несуществующую бронь: 404, данных брони нет.
    const gazel = (await vehicles(d.owner, d.tenant)).find((v) => v.displayName === GAZEL);
    if (!gazel) throw new Error(`нет «${GAZEL}»`);
    const foreign = J.expectOk(
      await call(d.owner, 'POST', `/api/v1/tenants/${d.tenant}/fleet/reservations`, {
        body: { vehicleId: gazel.id, driverMemberId: d.vasiliev, window: d.trip.plannedWindow },
      }),
      'reserveVehicle ГАЗели Васильеву',
    );
    const foreignId = (foreign.body as { id: string }).id;
    undo('бронь ГАЗели Васильева (W2.75)', async () => {
      const cur = await call(
        d.owner,
        'GET',
        `/api/v1/tenants/${d.tenant}/fleet/reservations/${foreignId}`,
      );
      if ((cur.body as { state?: string }).state !== 'held') return;
      J.expectOk(
        await call(
          d.owner,
          'PATCH',
          `/api/v1/tenants/${d.tenant}/fleet/reservations/${foreignId}`,
          {
            body: { action: 'release', reason: 'W2.75: уборка стенд-e2e' },
            ifMatch: cur.headers.etag ?? '',
          },
        ),
        'releaseReservation',
      );
    });
    const dr = d.driver;
    await dr.goto(`/t/${d.tenant}/today`);
    await expect(h2(dr, 'Выберите машину')).toBeVisible(J.SERVER);
    const hidden = await call(dr, 'POST', choosePath(d.tenant, foreignId));
    const missing = await call(dr, 'POST', choosePath(d.tenant, J.UNKNOWN));
    expect(statusCode(hidden), 'choose чужой брони').toEqual([404, 'not_found']);
    expect(J.problemShape(hidden), 'чужая — как несуществующая').toEqual(J.problemShape(missing));
    expect(JSON.stringify(hidden.body)).not.toContain(GAZEL);
    expect((await reservation(d.owner, d.tenant, foreignId)).state, 'чужая бронь не тронута').toBe(
      'held',
    );
    // Список машин — только предложенные: ГАЗели в нём нет.
    await onlyOffered(dr, d.tenant, [SPRINTER.model, ELF.model]);

    // Два параллельных choose в одной группе: подтверждена ровно одна бронь, вторая снята; второй ответ — 409.
    const answers = await chooseAtOnce(dr, d.tenant, ids);
    expect(
      answers.map((a) => `${a.status}:${a.code}`).sort(),
      'ответы двух параллельных choose',
    ).toEqual(['200:', '409:offer_closed']);
    const won = answers.findIndex((a) => a.status === 200);
    const states = await Promise.all(ids.map((id) => reservation(d.owner, d.tenant, id)));
    expect(states.map((s) => s.state)).toEqual(
      won === 0 ? ['confirmed', 'released'] : ['released', 'confirmed'],
    );
    const t = (await plan(d.owner, d.tenant, d.trip.id)).body as { vehicleId?: string };
    expect(t.vehicleId, 'машина рейса — подтверждённая').toBe(
      won === 0 ? d.cars.elf : d.cars.sprinter,
    );
    // После выбора экран водителя — осмотр на подтверждённой машине, «Выберите машину» больше нет.
    await dr.reload();
    await expect(dr.getByRole('button', { name: 'Взять эту машину' })).toHaveCount(0, J.SERVER);
    await noBooking(dr);
  });
});

// Q-W2.75-1 · дефект W2.74 ↔ W2.72: до окна рейса у временного водителя без предложенных машин listVehicles отвечает
// 403 forbidden_action (узкая роль, строк машин нет), а «Моя смена» показывает «Не удалось загрузить машины: Нет права
// на это действие…» вместо «Машину ещё не поставили» (1c, «Только водителя») и вместо «Машина на сегодня» после
// «Поставить машину» логиста (1g → assignTripVehicle: машина рейса водителю до окна не открыта). В mock (роль
// «Водитель» своей фирмы, Q-W2.74-6) список отдаётся — строки W2.74 зелёные. Строка вне grep e2e-stand (Q-W2.32-10),
// как `@known-defect` W2.32; после исправления — снять fixme и сменить тег на `@stand`.
test.describe('S2-20 — «Только водителя»: «Машину ещё не поставили» на телефоне @known-defect', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('Q-W2.75-1: машины нет — «Машину ещё не поставили», без ошибки списка машин', async ({
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(300_000);
    await realClock(page);
    const d = await dayStand({ browser, harness }, session, undo, testInfo.project.name);
    await approveApi(d, await requestApi(d, undefined, 'home'), 'approve_driver_only');
    const dr = d.driver;
    await dr.goto(`/t/${d.tenant}/today`);
    await expect(J.h1(dr, 'Моя смена')).toBeVisible(J.SERVER);
    await expect(dr.getByText('Машину ещё не поставили')).toBeVisible(J.SERVER);
    await expect(dr.getByText(/^Не удалось загрузить машины/)).toHaveCount(0);
    await expect(dr.locator('article.ox-dr-offer')).toHaveCount(0);
    await noBooking(dr);

    // 1g «Поставить машину»: логист назначает Isuzu Elf — водитель видит «Машина на сегодня» (одна машина, W2.74).
    const cur = await plan(d.owner, d.tenant, d.trip.id);
    J.expectOk(
      await call(d.owner, 'PUT', `/api/v1/tenants/${d.tenant}/fleet/trips/${d.trip.id}/vehicle`, {
        body: { vehicleId: d.cars.elf },
        ifMatch: cur.headers.etag ?? '',
      }),
      'assignTripVehicle',
    );
    await dr.reload();
    await expect(h2(dr, 'Машина на сегодня')).toBeVisible(J.SERVER);
    await expect(dr.locator('article.ox-dr-offer .ox-dr-car-model')).toHaveText([ELF.model]);
    await expect(dr.getByText(/^Не удалось загрузить машины/)).toHaveCount(0);
    await onlyOffered(dr, d.tenant, [ELF.model]);
  });
});
