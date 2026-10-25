// W4.90 · Выход этапа 4: «Осмотр → ответ формы → задача менеджеру» на стенде (D-30, D-29 комплекта; backend — W4.24).
// Водитель на телефоне проходит осмотр перед выездом и отмечает критический дефект → cmd/worker пишет осмотр ответом
// формы «Осмотр машины» (канал inspection, «Принят», «Рейс Р-… · выезд») → правило au-1 сида ставит задачу «Проверить
// осмотр Р-… (выезд)» Марине Котовой в «Логистика · Север»; блокирующий дефект — эта же задача (срочная, метка «дефект»,
// связь с дефектом, строка истории). Владелец видит ответ во вкладке «Ответы» с журналом действий, менеджер — задачу в
// «Задачах» («Мои»); решение менеджера по дефекту завершает задачу, водитель видит «Менеджер разрешил выезд…».
//   @stand — водитель — страница проекта (390/768/1440), владелец и менеджер — свои контексты 1440; свой рейс на
//            прогон (ответ и задача — по номеру рейса), уборка — closeTrip (бронь снимается, смена не начинается).
// Сценарного сервера у пути нет: MSW осмотра не пишет ответ формы (W4.24 — только backend), строки @mock нет.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import { actionBar, carCard, DEP_CHECKS } from '../../driver.helpers.ts';
import { formIdOf, INSP } from '../../forms-results.helpers.ts';
import {
  apiShift,
  approve,
  closeTrip,
  driverTrip,
  label,
  type LogisticsStand,
  logisticsOn,
  NO_STORAGE,
  plan,
  realClock,
  storageReachable,
  vehicle,
} from '../../logistics.stand.ts';
import { toast } from '../../modules.helpers.ts';
import { call } from '../../shell.helpers.ts';
import { card as taskCard, filter, openCard, openProject } from '../../tasks.helpers.ts';
import * as J from '../stage2/journey.ts';

const KOTOVA = 'Марина Котова';
const VASILIEV = 'Илья Васильев';
const DEFECT = { zone: 'Стёкла', text: 'Скол' };
const DEFECTS_H1 = 'Очередь блокирующих дефектов';
/** Ответ и задачу пишет cmd/worker из outbox — асинхронно, под нагрузкой полного прогона дольше. */
const WORKER = { timeout: 60_000, intervals: [1_000, 2_000, 3_000] };

/** «Ответы» редактора формы (W4.23). */
const panel = (page: Page): Locator => page.locator('.ox-fr-rs');
const view = (page: Page, name: string): Locator =>
  page.getByRole('group', { name: 'Вид ответов' }).getByRole('button', { name, exact: true });
const feedRow = (page: Page, text: string): Locator =>
  panel(page).locator('.ox-fr-feed button').filter({ hasText: text });
const answer = (page: Page): Locator => panel(page).locator('.ox-fr-resp');
const journal = (page: Page): Locator => panel(page).locator('.ox-fr-journal');
const row = (page: Page, q: string): Locator =>
  answer(page)
    .locator('.ox-fr-resp-row')
    .filter({ has: page.getByText(q, { exact: true }) });
/** Карточка дефекта в очереди (W2.21). */
const defectCard = (page: Page, trip: string): Locator =>
  page
    .locator('article')
    .filter({
      has: page.getByRole('heading', { level: 2, name: `${DEFECT.zone}: ${DEFECT.text}` }),
    })
    .filter({ hasText: `Рейс ${trip} · ${VASILIEV}` });

interface InspectionResponse {
  id: string;
  number: string;
  channel: string;
  reviewStatus: string;
  versionNumber: number;
  author?: { displayName?: string };
  subject?: { label: string };
  actions?: { kind: string; ok: boolean; taskId?: string; taskKey?: string; text?: string }[];
}

interface StandTask {
  id: string;
  key: string;
  title: string;
  priority?: string;
  labels?: string[];
  statusCategory?: string;
  assigneeMemberId?: string;
  relatedObjects?: { moduleKey: string; entityType: string; entityId: string }[];
}

/** Ответ «Осмотра машины» с объектом `subject` (listFormResponses по всем страницам курсора); нет — undefined. */
async function responseOf(
  page: Page,
  tenant: string,
  form: string,
  subject: string,
): Promise<InspectionResponse | undefined> {
  let cursor = '';
  for (let i = 0; i < 20; i++) {
    const q = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = J.expectOk(
      await call(page, 'GET', `/api/v1/tenants/${tenant}/forms/${form}/responses${q}`),
      'listFormResponses',
    );
    const body = r.body as { items: InspectionResponse[]; nextCursor?: string | null };
    const hit = body.items.find((x) => x.subject?.label === subject);
    if (hit) return hit;
    if (!body.nextCursor) return undefined;
    cursor = body.nextCursor;
  }
  return undefined;
}

/**
 * Рейс водителя, выезд которого ещё не записан ответом «Осмотра машины». Ответ осмотра дедуплицируется ключом
 * `рейс:dep:rev1` (Q-59, «как в прототипе»): повторный осмотр перед выездом того же рейса — после «разрешить выезд» и
 * снятой брони прошлого прогона или после строк этапа 2 полного прогона — второго ответа и задачи не пишет. Такой рейс
 * проходится сменой через API до приёмки (как уборка closeTrip), и водитель получает следующий — новый рейс строки.
 */
async function freshTrip(
  driver: Page,
  manager: Page,
  owner: Page,
  s: LogisticsStand,
  form: string,
  title: string,
): Promise<Awaited<ReturnType<typeof driverTrip>>> {
  for (let i = 0; i < 4; i++) {
    const trip = await driverTrip(driver, manager, s, title);
    if (!(await responseOf(owner, s.tenant, form, `Рейс ${trip.number} · выезд`))) return trip;
    await apiShift(driver, s.tenant, trip);
    await approve(manager, s.tenant, trip.id);
  }
  throw new Error('нет рейса без ответа осмотра перед выездом после четырёх смен');
}

/**
 * Дефект рейса на проверке — «разрешить выезд» с If-Match (decideInspectionDefect требует его с W2.52; closeTrip
 * общих помощников шлёт решение без If-Match и получает 428 — передача владельцу logistics.stand.ts).
 */
async function allowDefects(manager: Page, tenant: string, tripId: string): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/fleet/defects`;
  const list = J.expectOk(
    await call(manager, 'GET', `${base}?state=in_review`),
    'listInspectionDefects',
  ).body as { items: { id: string; tripId?: string }[] };
  for (const d of list.items.filter((x) => x.tripId === tripId)) {
    const cur = J.expectOk(await call(manager, 'GET', `${base}/${d.id}`), 'getInspectionDefect');
    J.expectOk(
      await call(manager, 'POST', `${base}/${d.id}/decision`, {
        body: { decision: 'allow_departure', comment: 'W4.90: уборка стенд-e2e' },
        ifMatch: cur.headers.etag ?? '',
      }),
      'decideInspectionDefect',
    );
  }
}

const getTask = async (page: Page, tenant: string, id: string): Promise<StandTask> =>
  J.expectOk(await call(page, 'GET', `/api/v1/tenants/${tenant}/tasks/${id}`), 'getTask')
    .body as StandTask;

/**
 * Водитель: бронь ГАЗели → пять фото, пробег, «½», чек-лист → критический дефект «Стёкла: Скол» → «Отправить на
 * проверку менеджеру» → «Выезд заблокирован».
 */
async function inspectionWithDefect(page: Page, odometer: number): Promise<void> {
  const file = await J.jpeg(page, 'Ортус · осмотр W4.90');
  await expect(J.h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
  await carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }).click();
  await expect(toast(page)).toHaveText('Бронь подтверждена сервером. Начните осмотр', J.SERVER);
  await expect(J.h2(page, 'Осмотр перед выездом')).toBeVisible(J.SERVER);
  await J.photos(page, 'stand', file);
  await J.fillInspection(page, String(odometer), DEP_CHECKS);
  await page.getByRole('button', { name: 'Добавить дефект' }).click();
  await page.getByLabel('Где').selectOption(DEFECT.zone);
  await page.getByLabel(/^Описание/).fill(DEFECT.text);
  await page.getByLabel('Критический — машина не может выехать').check();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await actionBar(page).getByRole('button', { name: 'Отправить на проверку менеджеру' }).click();
  await expect(toast(page)).toHaveText('Выезд заблокирован: дефект отправлен менеджеру', J.SERVER);
  await expect(J.h2(page, 'Выезд заблокирован')).toBeVisible(J.SERVER);
}

test.describe('выход этапа 4 — осмотр → ответ формы → задача менеджеру @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('водитель отмечает критический дефект; владелец видит ответ «Осмотра машины», менеджер — срочную задачу, решение по дефекту её завершает', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(360_000);
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const manager = await J.desktop(browser, harness, 'manager');
    const owner = await J.desktop(browser, harness, 'owner');
    undo('контексты 1440', async () => {
      await manager.close();
      await owner.close();
    });
    await app('/', { persona: 'driver' });
    const form = await formIdOf(owner.page, s.tenant, INSP);
    const trip = await freshTrip(
      page,
      manager.page,
      owner.page,
      s,
      form,
      `Осмотр W4.90 ${label(testInfo.project.name)}`,
    );
    expect(await storageReachable(page, s.tenant, trip.id, harness.allowHosts), NO_STORAGE).toBe(
      true,
    );
    undo(`смена рейса ${trip.number}`, () => closeTrip(page, manager.page, s.tenant, trip.id));
    // Уборки идут в обратном порядке: дефект на проверке решается раньше closeTrip.
    undo(`дефект рейса ${trip.number}`, () => allowDefects(manager.page, s.tenant, trip.id));
    const odometer = Number((await vehicle(page, s.tenant)).odometerKm) + 130;

    // 1. Водитель на телефоне: осмотр с критическим дефектом.
    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    await inspectionWithDefect(page, odometer);

    // 2. cmd/worker: ответ «Осмотра машины» с задачей правила au-1 в журнале.
    const subject = `Рейс ${trip.number} · выезд`;
    const title = `Проверить осмотр ${trip.number} (выезд)`;
    let resp: InspectionResponse | undefined;
    await expect
      .poll(async () => {
        resp = await responseOf(owner.page, s.tenant, form, subject);
        return resp?.actions?.some((a) => a.kind === 'task' && a.ok && a.taskId) ?? false;
      }, WORKER)
      .toBe(true);
    if (!resp) throw new Error(`нет ответа «${subject}»`);
    expect([resp.channel, resp.reviewStatus, resp.versionNumber, resp.author?.displayName]).toEqual(
      ['inspection', 'accepted', 3, VASILIEV],
    );
    const action = resp.actions?.find((a) => a.kind === 'task' && a.ok);
    const taskId = action?.taskId ?? '';

    // Блокирующий дефект — эта же задача (одна задача менеджеру): срочная, «дефект», связь с дефектом рейса.
    const defects = J.expectOk(
      await call(manager.page, 'GET', `/api/v1/tenants/${s.tenant}/fleet/defects?state=in_review`),
      'listInspectionDefects',
    ).body as { items: { id: string; tripId?: string }[] };
    const defectId = defects.items.find((d) => d.tripId === trip.id)?.id ?? '';
    expect(defectId, `дефект рейса ${trip.number} в очереди`).not.toBe('');
    await expect
      .poll(async () => {
        const t = await getTask(owner.page, s.tenant, taskId);
        return [
          t.title,
          t.priority,
          (t.labels ?? []).includes('дефект'),
          (t.relatedObjects ?? []).some(
            (r) => r.moduleKey === 'fleet' && r.entityType === 'defect' && r.entityId === defectId,
          ),
        ];
      }, WORKER)
      .toEqual([title, 'urgent', true, true]);

    // 3. Владелец 1440: «Формы и опросы» → «Осмотр машины» → «Ответы» → «Лента» с этим ответом.
    await owner.page.goto(`/t/${s.tenant}/forms?form=${form}&tab=responses&resp=${resp.id}`);
    await expect(view(owner.page, 'Лента')).toHaveAttribute('aria-pressed', 'true', {
      timeout: 20_000,
    });
    await expect(feedRow(owner.page, `${resp.number} · ${subject}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(answer(owner.page).getByRole('heading', { level: 3 })).toHaveText(
      `${resp.number} · ${subject}`,
    );
    await expect(answer(owner.page).locator('.ox-fr-resp-status')).toHaveText('Принят');
    await expect(answer(owner.page)).toContainText(VASILIEV);
    await expect(answer(owner.page)).toContainText('показан по структуре версии v3');
    await expect(row(owner.page, 'Есть дефекты?')).toContainText('да');
    await expect(row(owner.page, 'Описание дефекта')).toContainText(
      `${DEFECT.zone}: ${DEFECT.text}`,
    );
    await expect(row(owner.page, 'Уровень топлива').first()).toContainText('½');
    await expect(journal(owner.page)).toContainText(
      `Задача ${action?.taskKey ?? ''} «${title}» · ${KOTOVA}`,
    );
    await expect(journal(owner.page)).toContainText('Строка в таблице «Осмотры»');

    // 4. Менеджер 1440: «Задачи» → «Логистика · Север» → «Мои» → карточка задачи осмотра.
    await manager.page.goto(`/t/${s.tenant}/tasks`);
    await openProject(manager.page);
    await filter(manager.page, 'Мои').click();
    await openCard(manager.page, title);
    expect(new URL(manager.page.url()).searchParams.get('task')).toBe(taskId);
    const c = taskCard(manager.page);
    await expect(c).toContainText(action?.taskKey ?? '');
    await expect(c.locator('.ox-tk-status')).toHaveText('Новая');
    await expect(c.getByLabel('Приоритет').locator('option:checked')).toHaveText('Срочно');
    await expect(c.getByLabel('Исполнитель').locator('option:checked')).toHaveText(KOTOVA);
    await expect(c.locator('.ox-tk-label').filter({ hasText: /^дефект$/ })).toHaveCount(1);
    await expect(c.locator('.ox-tk-check-item')).toHaveText([
      'Сверить фото с прошлым осмотром',
      'Проверить пробег',
    ]);
    await expect(c.locator('.ox-tk-hist')).toContainText(
      `Связана с дефектом осмотра: ${DEFECT.zone} — ${DEFECT.text}`,
    );

    // 5. Менеджер решает по дефекту — «разрешить выезд»: задача завершается решением.
    await manager.page.goto(`/t/${s.tenant}/defects`);
    await expect(J.h1(manager.page, DEFECTS_H1)).toBeVisible({ timeout: 15_000 });
    const d = defectCard(manager.page, trip.number);
    await d.getByLabel('Комментарий к решению').fill('Скол вне зоны обзора водителя');
    await d.getByRole('button', { name: 'Дефект некритичный — разрешить выезд' }).click();
    await expect(toast(manager.page)).toHaveText('Выезд разрешён', J.SERVER);
    await expect
      .poll(async () => (await getTask(manager.page, s.tenant, taskId)).statusCategory, WORKER)
      .toBe('done');
    await manager.page.goto(`/t/${s.tenant}/tasks?task=${taskId}`);
    await expect(c.getByRole('heading', { level: 3, name: title })).toBeVisible({
      timeout: 15_000,
    });
    await expect(c.locator('.ox-tk-status')).toHaveText('Готово');
    await expect(c.locator('.ox-tk-hist')).toContainText(
      /Решение по дефекту: Новая → Готово\. Дефект признан некритичным — выезд разрешён/,
    );

    // 6. Водитель видит решение; рейс не начат — уборка снимет бронь.
    await page.reload();
    await expect(page.getByText('Менеджер разрешил выезд: дефект признан некритичным')).toBeVisible(
      J.SERVER,
    );
    expect(((await plan(page, s.tenant, trip.id)).body as { state: string }).state).not.toBe(
      'defect_review',
    );
  });
});
