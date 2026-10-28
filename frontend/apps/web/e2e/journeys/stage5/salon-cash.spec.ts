// W5.90 · Выход этапа 5: «Салон работает: запись, техкарта, касса со сменами» на стенде (организация «Лотос»).
// Владелец «Лотоса» заводит склад, материал с двумя партиями, услугу с техкартой, кассу и смену;
// записывает клиента на практика, кабинет и стол с буферами (гонка за кабинет — ровно один успех); отмечает факт
// («незавершённый учёт», склад и деньги не тронуты); завершает визит — расход по техкарте один раз по FEFO, цена по
// факту; касса получает предложение «визит»: без смены — «смена закрыта», в смене — приход; закрытие смены сходится
// с ожиданием; расхождение сверх допуска — «ждёт решения», закрывший смену не решает её сам. Страницы «Салон и SPA»,
// «Склад», «Касса» показывают те же данные. Изоляция: «Альта» не видит ничего из этого, сотрудник без прав — отказ.
//   @stand — страница проекта (390/768/1440); сида салона нет (Q-W5.20-11, Q-W5.31-8) — данные путь заводит сам,
//            своё имя на прогон (метка проекта и времени). Сценарного сервера у пути нет (в mock строки нет).
import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import { listUnits, memberByEmail } from '../../_stand/stand.ts';
import { label, realClock } from '../../logistics.stand.ts';
import { h1, noHorizontalScroll, openPage } from '../../modules.helpers.ts';
import { ALTA, call, LOTOS, type Reply, setModule, tenantId } from '../../shell.helpers.ts';
import * as J from '../stage2/journey.ts';

const MSK = 'Europe/Moscow';
const SALON = 'Лотос · Арбат';
const ROOM = 'Кабинет № 2';
const TABLE = 'Стол с подогревом';
const PRACTITIONER_EMAIL = 'a.morozova@alta.example';
const PRICE = 450_000;
const FLOAT = 100_000;
const RECIPE_ML = 30;

const rub = (amountMinor: number) => ({ amountMinor, currency: 'RUB' });
const body = <T>(r: Reply): T => r.body as T;
const num = (q: string): number => Number(q);
/** Сумма как на странице: пробелы между разрядами неразрывные, копейки опущены у целых рублей. */
const rubRe = (minor: number): RegExp => {
  const whole = Math.floor(minor / 100);
  const frac = minor % 100;
  const digits = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s\u00a0\u202f]');
  const cents = frac ? `,${String(frac).padStart(2, '0')}` : '';
  return new RegExp(`${digits}${cents}[\\s\u00a0\u202f]*₽`);
};

interface Resource {
  id: string;
  kind: string;
  name: string;
}
interface Balance {
  onHand: string;
  lots: { lotId: string | null; expiresOn: string | null; onHand: string }[];
}
interface Appointment {
  id: string;
  status: string;
  revision: number;
  bookingId: string;
  finalPrice?: { amountMinor: number };
}
interface Shift {
  id: string;
  status: string;
  revision: number;
  expected?: { cash: { amountMinor: number } } | null;
  diff?: { cash: { amountMinor: number } } | null;
}
interface Operation {
  id: string;
  accountId: string;
  type: string;
  direction: string;
  method: string;
  shiftId: string | null;
  amount: { amountMinor: number; currency: string };
  source?: { key: string; kind: string; id: string } | null;
}
interface Proposal {
  key: string;
  status: string;
  kind: string;
  amount: { amountMinor: number };
}

/** МСК-полночь суток `daysAgo` назад плюс `hour` часов, как ISO UTC. */
function visitStart(daysAgo: number, hour: number): string {
  const day = new Date(Date.now() - daysAgo * 86_400_000);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: MSK }).format(day);
  return new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00+03:00`).toISOString();
}

const etag = async (page: Page, path: string): Promise<string> =>
  (await call(page, 'GET', path)).headers.etag ?? '';

test.describe('выход этапа 5 — салон работает: запись, техкарта, касса со сменами @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('визит с техкартой списывает склад один раз, касса принимает оплату в смену и сверяет её; «Альта» ничего не видит', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(420_000);
    await realClock(page);
    const alta = await J.desktop(browser, harness, 'owner');
    undo('контекст «Альты»', () => alta.close());
    const tag = label(testInfo.project.name);

    // 0. Владелец «Лотоса»: модуль «Салон и SPA» включён, кабинет, стол и практик — из сида.
    await app('/', { persona: 'owner@t-lotos' });
    const tenant = await tenantId(page, LOTOS);
    const base = `/api/v1/tenants/${tenant}`;
    // «Склад» и «Касса» — базовые модули (modulesreg coreKeys), «Салон и SPA» — отраслевой, в сиде «Лотоса» включён.
    const spa = body<{ state: string }>(await call(page, 'GET', `${base}/modules/spa`));
    if (spa.state !== 'active') await setModule(page, tenant, 'spa', true);
    const unit = (await listUnits(page, tenant)).find((u) => u.name === SALON);
    if (!unit) throw new Error(`нет подразделения «${SALON}»`);
    const resources = body<{ items: Resource[] }>(
      J.expectOk(
        await call(page, 'GET', `${base}/calendar/resources?orgUnitId=${unit.id}&limit=200`),
        'listCalendarResources',
      ),
    ).items;
    const room = resources.find((r) => r.kind === 'room' && r.name === ROOM);
    const table = resources.find((r) => r.kind === 'equipment' && r.name === TABLE);
    if (!room || !table) throw new Error(`нет «${ROOM}» или «${TABLE}» в ресурсах «${SALON}»`);
    const practitioner = (await memberByEmail(page, tenant, PRACTITIONER_EMAIL)).id;

    // 1. Склад: материал в двух партиях (FEFO: сначала та, что раньше истекает).
    const wh = body<{ id: string }>(
      J.expectOk(
        await call(page, 'POST', `${base}/inventory/warehouses`, {
          body: { orgUnitId: unit.id, name: `Склад салона ${tag}` },
        }),
        'createWarehouse',
      ),
    );
    const itemName = `Масло массажное ${tag}`;
    const item = body<{ id: string }>(
      J.expectOk(
        await call(page, 'POST', `${base}/inventory/items`, {
          body: {
            orgUnitId: unit.id,
            name: itemName,
            sku: `W590-${tag}`,
            baseUnit: 'ml',
            trackLots: true,
          },
        }),
        'createInventoryItem',
      ),
    );
    for (const [quantity, expiresOn] of [
      ['900', '2028-03-01'],
      ['100', '2027-03-01'],
    ] as const) {
      J.expectOk(
        await call(page, 'POST', `${base}/inventory/movements`, {
          body: {
            kind: 'receipt',
            warehouseId: wh.id,
            lines: [{ itemId: item.id, quantity, expiresOn }],
          },
        }),
        'postInventoryMovement receipt',
      );
    }
    const stock = async (): Promise<Balance> => {
      const r = body<{ items: (Balance & { itemId: string })[] }>(
        J.expectOk(
          await call(page, 'GET', `${base}/inventory/balances?warehouseId=${wh.id}&limit=200`),
          'listInventoryBalances',
        ),
      );
      const b = r.items.find((x) => x.itemId === item.id);
      if (!b) throw new Error('нет остатка материала');
      return b;
    };
    expect(num((await stock()).onHand)).toBe(1000);

    // 2. Услуга с техкартой, буферами и столом.
    const serviceName = `Массаж с маслом ${tag}`;
    const service = body<{ id: string; revision: number }>(
      J.expectOk(
        await call(page, 'POST', `${base}/spa/services`, {
          body: {
            orgUnitId: unit.id,
            name: serviceName,
            durationMinutes: 60,
            bufferBeforeMinutes: 10,
            bufferAfterMinutes: 15,
            price: rub(PRICE),
            requiredEquipmentIds: [table.id],
            recipe: [{ itemId: item.id, quantity: String(RECIPE_ML), unit: 'ml' }],
          },
        }),
        'createSpaService',
      ),
    );

    // 3. Запись: три одновременных запроса на один кабинет — ровно один успех. Свободный день ищем в прошлом
    //    (факт выполнения нельзя отметить раньше «сейчас»): стенд общий для трёх проектов и повторных прогонов.
    const clientId = randomUUID();
    let visit: Appointment | undefined;
    let startsAt = '';
    for (let i = 0; i < 12 && !visit; i++) {
      const daysAgo = 2 + Math.floor(Math.random() * 60);
      startsAt = visitStart(daysAgo, 10 + (i % 6));
      const req = {
        orgUnitId: unit.id,
        serviceId: service.id,
        clientId,
        practitionerMemberId: practitioner,
        roomId: room.id,
        equipmentIds: [table.id],
        startsAt,
        timeZone: MSK,
      };
      const rs = await J.burst(page, `${base}/spa/appointments`, [req, req, req]);
      const created = rs.filter((r) => r.status === 201);
      if (created.length === 0) continue;
      expect(created, JSON.stringify(rs)).toHaveLength(1);
      expect(
        rs.filter((r) => r.status !== 201).map((r) => [r.status, r.code]),
        'остальные — конфликт ресурсов',
      ).toEqual([
        [409, 'resources_unavailable'],
        [409, 'resources_unavailable'],
      ]);
      const id = created[0]?.id ?? '';
      visit = body<Appointment>(
        J.expectOk(await call(page, 'GET', `${base}/spa/appointments/${id}`), 'getAppointment'),
      );
    }
    if (!visit) throw new Error('не нашлось свободного дня для записи за 12 попыток');
    expect(visit.status).toBe('confirmed');
    expect(visit.bookingId).not.toBe('');
    const appt = `${base}/spa/appointments/${visit.id}`;

    // 4. Факт выполнения — «незавершённый учёт»: склад и деньги не тронуты.
    const performedAt = new Date(Date.parse(startsAt) + 70 * 60_000).toISOString();
    const performed = body<Appointment>(
      J.expectOk(
        await call(page, 'POST', `${appt}/performance`, {
          body: { performedAt },
          ifMatch: await etag(page, appt),
        }),
        'recordAppointmentPerformance',
      ),
    );
    expect(performed.status).toBe('performed_pending_posting');
    expect(num((await stock()).onHand)).toBe(1000);

    // 5. Завершение: расход по техкарте один раз (FEFO — из ранней партии), повтор без второго списания.
    const done = J.expectOk(
      await call(page, 'POST', `${appt}/completion`, {
        body: { warehouseId: wh.id, overrides: [], finalPrice: rub(PRICE) },
        ifMatch: await etag(page, appt),
      }),
      'completeAppointment',
    );
    const completed = body<{ appointment: Appointment; inventoryMovementIds: string[] }>(done);
    expect(completed.appointment.status).toBe('completed');
    expect(completed.appointment.finalPrice?.amountMinor).toBe(PRICE);
    expect(completed.inventoryMovementIds).toHaveLength(1);
    const after = await stock();
    expect(num(after.onHand)).toBe(1000 - RECIPE_ML);
    expect(
      after.lots
        .map((l) => [l.expiresOn, num(l.onHand)])
        .sort((a, b) => `${a[0]}`.localeCompare(`${b[0]}`)),
    ).toEqual([
      ['2027-03-01', 100 - RECIPE_ML],
      ['2028-03-01', 900],
    ]);
    const again = await call(page, 'POST', `${appt}/completion`, {
      body: { warehouseId: wh.id, overrides: [], finalPrice: rub(PRICE) },
      ifMatch: await etag(page, appt),
    });
    expect([200, 409], JSON.stringify(again.body)).toContain(again.status);
    if (again.status === 200) {
      expect(
        body<{ inventoryMovementIds: string[] }>(again).inventoryMovementIds,
        'повтор отдаёт тот же расход, а не новый',
      ).toEqual(completed.inventoryMovementIds);
    } else {
      expect(body<{ code: string }>(again).code, 'повтор — отказ по состоянию визита').toBe(
        'invalid_transition',
      );
    }
    expect(num((await stock()).onHand), 'второго списания нет').toBe(1000 - RECIPE_ML);

    // 6. Касса: счёт подразделения салона и предложение «визит».
    const account = body<{ id: string; revision: number }>(
      J.expectOk(
        await call(page, 'POST', `${base}/cash/accounts`, {
          body: {
            orgUnitId: unit.id,
            name: `Касса салона ${tag}`,
            currency: 'RUB',
            kind: 'cash_drawer',
            shiftMode: 'open',
            kktMode: 'none',
            floatAmount: rub(FLOAT),
            tolerance: rub(10_000),
          },
        }),
        'createCashAccount',
      ),
    );
    const proposalKey = `visit:${visit.id}`;
    let offer: Proposal | undefined;
    await expect
      .poll(
        async () => {
          const r = body<{ items: Proposal[] }>(
            J.expectOk(
              await call(page, 'GET', `${base}/cash/proposals?status=open&limit=200`),
              'listCashProposals',
            ),
          );
          offer = r.items.find((p) => p.key === proposalKey);
          return offer?.amount.amountMinor;
        },
        { timeout: 30_000 },
      )
      .toBe(PRICE);
    expect(offer?.kind).toBe('visit');

    // Оплата без открытой смены не проводится.
    const pay = {
      accountId: account.id,
      parts: [{ method: 'cash', amount: rub(PRICE) }],
    };
    const closed = await call(page, 'POST', `${base}/cash/proposals/${proposalKey}/post`, {
      body: pay,
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(409);
    expect(body<{ code: string }>(closed).code).toBe('shift_closed');

    // 7. Смена: открытие с пересчётом размена, оплата визита, закрытие сходится с ожиданием.
    const shift = body<Shift>(
      J.expectOk(
        await call(page, 'POST', `${base}/cash/accounts/${account.id}/shifts`, {
          body: { countedFloat: rub(FLOAT) },
        }),
        'openCashShift',
      ),
    );
    expect(shift.status).toBe('open');
    const posted = body<{ proposal: Proposal; operations: { shiftId: string | null }[] }>(
      J.expectOk(
        await call(page, 'POST', `${base}/cash/proposals/${proposalKey}/post`, { body: pay }),
        'postCashProposal',
      ),
    );
    expect(posted.proposal.status).toBe('posted');
    expect(posted.operations.map((o) => o.shiftId)).toEqual([shift.id]);
    const shiftPath = `${base}/cash/shifts/${shift.id}`;
    const closedShift = body<Shift>(
      J.expectOk(
        await call(page, 'POST', `${shiftPath}/close`, {
          body: { counted: rub(FLOAT + PRICE) },
          ifMatch: `"rev-${shift.revision}"`,
        }),
        'closeCashShift',
      ),
    );
    expect(closedShift.diff?.cash.amountMinor ?? 0).toBe(0);
    expect(closedShift.status).toBe('closed');

    // Журнал и остаток совпадают с суммой визита: одна операция «приход» наличными на 4 500 ₽ по визиту в смене,
    // остаток счёта равен сумме проводок журнала.
    const ledger = body<{ items: Operation[] }>(
      J.expectOk(
        await call(page, 'GET', `${base}/cash/operations?accountId=${account.id}&limit=200`),
        'listCashOperations',
      ),
    ).items;
    const visitOps = ledger.filter((o) => o.source?.key === proposalKey);
    expect(visitOps, JSON.stringify(ledger)).toHaveLength(1);
    expect(visitOps[0]).toMatchObject({
      type: 'in',
      method: 'cash',
      shiftId: shift.id,
      accountId: account.id,
      amount: { amountMinor: PRICE, currency: 'RUB' },
      source: { key: proposalKey, kind: 'appointment', id: visit.id },
    });
    const sign = (o: Operation): number => (o.direction === 'in' ? 1 : -1);
    const ledgerSum = ledger.reduce((s, o) => s + sign(o) * o.amount.amountMinor, 0);
    const listed = body<{ items: { id: string; balance: { amountMinor: number } | null }[] }>(
      J.expectOk(await call(page, 'GET', `${base}/cash/accounts?limit=200`), 'listCashAccounts'),
    ).items.find((a) => a.id === account.id);
    const balanceMinor = listed?.balance?.amountMinor ?? -1;
    expect(balanceMinor, 'остаток счёта = сумма журнала ' + JSON.stringify(ledger)).toBe(ledgerSum);
    expect(balanceMinor, 'остаток включает 4 500 ₽ визита').toBeGreaterThanOrEqual(PRICE);

    // 8. Вторая смена: излишек сверх допуска — «ждёт решения»; закрывший смену не решает её сам.
    const second = body<Shift>(
      J.expectOk(
        await call(page, 'POST', `${base}/cash/accounts/${account.id}/shifts`, {
          body: { countedFloat: rub(FLOAT) },
        }),
        'openCashShift #2',
      ),
    );
    const review = body<Shift>(
      J.expectOk(
        await call(page, 'POST', `${base}/cash/shifts/${second.id}/close`, {
          body: { counted: rub(FLOAT + 50_000) },
          ifMatch: `"rev-${second.revision}"`,
        }),
        'closeCashShift #2',
      ),
    );
    expect(review.status).toBe('review');
    const self = await call(page, 'POST', `${base}/cash/shifts/${second.id}/review`, {
      body: { decision: 'accept', reason: 'Свой пересчёт' },
      ifMatch: await etag(page, `${base}/cash/shifts/${second.id}`),
    });
    expect(self.status, 'закрывший смену не решает её сам').toBeGreaterThanOrEqual(400);

    // Остаток после второй смены (в ожидании решения) — то, что должна показать касса.
    const finalAccount = body<{ items: { id: string; balance: { amountMinor: number } | null }[] }>(
      J.expectOk(await call(page, 'GET', `${base}/cash/accounts?limit=200`), 'listCashAccounts #2'),
    ).items.find((a) => a.id === account.id);
    const pageBalance = finalAccount?.balance?.amountMinor ?? -1;
    const ledger2 = body<{ items: Operation[] }>(
      J.expectOk(
        await call(page, 'GET', `${base}/cash/operations?accountId=${account.id}&limit=200`),
        'listCashOperations #2',
      ),
    ).items;
    expect(
      ledger2.filter((o) => o.direction === 'in' && o.amount.amountMinor === PRICE),
      `журнал после смен (остаток ${balanceMinor} → ${pageBalance}): ${JSON.stringify(ledger2)}`,
    ).toHaveLength(1);

    // 9. Страницы на тех же данных.
    await openPage(app, page, `spa?date=${startsAt.slice(0, 10)}`, {
      persona: 'owner@t-lotos',
      tenant: LOTOS,
    });
    await expect(h1(page, 'Салон и SPA')).toBeVisible({ timeout: 20_000 });
    const visitCard = page.locator('article.ox-spa-card').filter({ hasText: serviceName });
    await expect(visitCard).toHaveCount(1, { timeout: 20_000 });
    await expect(visitCard).toContainText('Завершено · списано');
    await expect(visitCard).toContainText(rubRe(PRICE));
    expect(await noHorizontalScroll(page), 'Салон и SPA без горизонтальной прокрутки').toBe(true);
    await page.goto(`/t/${tenant}/inventory`);
    await expect(h1(page, 'Склад')).toBeVisible({ timeout: 20_000 });
    const stockRow = page
      .getByRole('list', { name: 'Остатки', exact: true })
      .getByRole('listitem')
      .filter({ hasText: itemName });
    await expect(stockRow).toHaveCount(1, { timeout: 20_000 });
    await expect(stockRow).toContainText(
      new RegExp(`В наличии\\s*${1000 - RECIPE_ML}[\\s\u00a0\u202f]*мл`),
    );
    expect(await noHorizontalScroll(page), 'Склад без горизонтальной прокрутки').toBe(true);
    await page.goto(`/t/${tenant}/cash`);
    await expect(h1(page, 'Касса')).toBeVisible({ timeout: 20_000 });
    const cashSection = page.locator('section.ox-ca');
    await cashSection
      .locator('button.ox-ca-acc')
      .filter({ hasText: `Касса салона ${tag}` })
      .click({ timeout: 20_000 });
    const cashCard = cashSection.locator('section[aria-label]').first();
    await expect(
      cashCard.getByRole('heading', { level: 2, name: `Касса салона ${tag}` }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(cashCard.locator('.ox-ca-fact').first()).toContainText(rubRe(pageBalance));
    await expect(
      cashSection.locator('.ox-ca-op').filter({
        has: page.locator('.ox-ca-opamount', {
          hasText: new RegExp(`^\\+\\s*${rubRe(PRICE).source}`),
        }),
      }),
    ).toHaveCount(1);
    expect(await noHorizontalScroll(page), 'Касса без горизонтальной прокрутки').toBe(true);

    // 10. Изоляция: владелец «Альты» не видит «Лотос» (404 как у несуществующего), «Лотос» — «Альту».
    const altaId = await tenantId(alta.page, ALTA);
    for (const path of [
      '/spa/services',
      `/spa/services/${service.id}`,
      '/spa/appointments',
      `/spa/appointments/${visit.id}`,
      '/inventory/items',
      '/inventory/balances',
      '/inventory/movements',
      '/cash/accounts',
      '/cash/shifts',
      '/cash/proposals',
      '/cash/operations',
    ]) {
      const r = await call(alta.page, 'GET', `${base}${path}`);
      expect([r.status, JSON.stringify(r.body)], `«Альта» → «Лотос» ${path}`).toEqual([
        404,
        expect.stringContaining('not_found'),
      ]);
      const back = await call(page, 'GET', `/api/v1/tenants/${altaId}${path}`);
      expect(back.status, `«Лотос» → «Альта» ${path}`).toBe(404);
    }
    const stranger = await call(alta.page, 'POST', `${shiftPath}/close`, {
      body: { counted: rub(1) },
      ifMatch: '"rev-1"',
    });
    expect(stranger.status, 'чужая смена не закрывается').toBe(404);

    // 11. Массажист «Лотоса»: кассы и склада для него нет.
    const therapist = await session();
    await therapist.open('/', 'therapist@t-lotos');
    for (const path of ['/cash/accounts', '/cash/shifts', '/inventory/balances']) {
      const r = await call(therapist.page, 'GET', `${base}${path}`);
      expect(r.status, `массажист ${path}: ${JSON.stringify(r.body)}`).toBe(403);
    }
  });
});
