// W2.26 · e2e страницы `core-data` «Данные» (S2-16, AC-14; эталон design-stage-2 «Ортус CRM.dc.html» pg.data
// :1960–1979, dataVM :4179–4208; чек-лист docs/plan/analysis/06-calendar-kb-data-files-spa-cash-repair.md §13 п. 16–22,
// W4.80 — наборы этапа 4 «Ответы на осмотр» и «Задачи» эталона design-2026-10-19, dataVM :4189). Наборы —
// listDatasets, строки — queryDataset (MSW W2.51 поверх пресета logistics-ready; на стенде — backend W2.08). Обязательные пункты verification-protocol
// §1.3: меню и URL, состояния (загрузка, ошибка, нет связи, гейт), клавиатура, axe, 390 / 1440.
import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { logisticsOn } from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

const H1 = 'Данные';
const INTRO =
  'Каталог записей модулей. Это представление исходных сущностей с теми же правами, а не редактируемая копия. Изменения — в карточке модуля.';
const SCOPE = 'Строки ограничены вашей областью доступа';
const HIDDEN = 'Поле «Начисление» скрыто правами и не участвует в фильтре, сортировке и выгрузке';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

const tabs = (page: import('@playwright/test').Page) =>
  page.getByRole('tablist', { name: 'Наборы данных' });
const tab = (page: import('@playwright/test').Page, name: RegExp) =>
  tabs(page).getByRole('tab', { name });
const table = (page: import('@playwright/test').Page) =>
  page.locator('section[aria-labelledby="h-data"] table');
const bodyRows = (page: import('@playwright/test').Page) => table(page).locator('tbody tr');
const heads = (page: import('@playwright/test').Page) =>
  table(page).locator('thead th').allTextContents();
const filter = (page: import('@playwright/test').Page) => page.getByLabel('Фильтр');
const footer = (page: import('@playwright/test').Page) => page.locator('.ox-dt-foot');

/** «Данные» владельца «Альты» на пресете logistics-ready (наборы логистики). */
async function open(
  app: Parameters<typeof openPage>[0],
  page: import('@playwright/test').Page,
  o: { persona?: 'owner' | 'manager'; search?: string } = {},
): Promise<string> {
  const id = await openPage(app, page, `data${o.search ?? ''}`, {
    persona: o.persona ?? 'owner',
    preset: 'logistics-ready',
  });
  await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
  return id;
}

test.describe('core-data — «Данные» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается из меню и по прямому URL: заголовок, абзац, вкладки, «Поездки» по умолчанию', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home', { preset: 'logistics-ready' });
    if (phone(page)) {
      await page
        .getByRole('navigation', { name: 'Навигация', exact: true })
        .getByRole('button', { name: 'Ещё' })
        .click();
      await page
        .getByRole('dialog', { name: 'Все разделы' })
        .getByRole('button', { name: H1 })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('button', { name: H1 })
        .click();
    }
    await expect(h1(page, H1)).toBeVisible();
    await expect(page).toHaveURL(/\/data$/);
    await expect(page.getByText(INTRO)).toBeVisible();
    await expect(tabs(page).getByRole('tab')).toHaveText([
      /^local_shipping\s*Автомобили\s*7$/,
      /^route\s*Поездки\s*2$/,
      /^receipt_long\s*Расходы\s*0$/,
      /^dynamic_form\s*Ответы на осмотр\s*2$/,
      /^task_alt\s*Задачи\s*11$/,
    ]);
    await expect(tab(page, /Поездки/)).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await expect(tab(page, /Поездки/)).toHaveAttribute('aria-selected', 'true', {
      timeout: 15_000,
    });
  });

  test('«Поездки» владельца: колонки, строка Р-208, подвал', async ({ app, page }) => {
    await open(app, page);
    await expect(bodyRows(page)).toHaveCount(2);
    expect(await heads(page)).toEqual([
      'Рейсunfold_more',
      'Водительunfold_more',
      'Статусunfold_more',
      'Пробег, кмunfold_more',
      'Начислениеunfold_more',
    ]);
    const r208 = bodyRows(page).filter({ hasText: 'Р-208 · Северный маршрут' });
    await expect(r208.locator('td')).toHaveText([
      'Р-208 · Северный маршрут',
      'Илья Васильев',
      'Запланирован',
      '—',
      // Начисление рейса сида — как в эталоне (dataVM :4186).
      /^4\s500 ₽$/,
    ]);
    await expect(footer(page)).toHaveText(
      `Источник: Логистика · fleet.tripsОбновлено: только что${SCOPE}`,
    );
  });

  test('фильтр «211» → одна строка; «Сохранить вид» → тост, вид выбран и сохранён лично', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const save = page.getByRole('button', { name: 'Сохранить вид' });
    await expect(save).toBeDisabled();
    await filter(page).fill('211');
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText('Р-211 · Охлаждённая продукция');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(toast(page)).toHaveText('Вид сохранён · личный');
    const view = page.getByLabel('Вид');
    await expect(view.locator('option:checked')).toHaveText('Поездки: «211»');
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(filter(page)).toHaveValue('');
    await page.getByLabel('Вид').selectOption({ label: 'Поездки: «211»' });
    await expect(filter(page)).toHaveValue('211');
    await expect(bodyRows(page)).toHaveCount(1);
  });

  test('«zzz» — «По фильтру ничего не найдено»; «Расходы» — «В вашей области записей нет», ?set=', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await filter(page).fill('zzz');
    await expect(page.getByText('По фильтру ничего не найдено')).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(0);
    await tab(page, /Расходы/).click();
    await expect(page).toHaveURL(/[?&]set=fleet\.expenses/);
    await expect(filter(page)).toHaveValue('');
    await expect(page.getByText('В вашей области записей нет')).toBeVisible();
    expect(await heads(page)).toEqual([
      'Рейсunfold_more',
      'Категорияunfold_more',
      'Датаunfold_more',
      'Суммаunfold_more',
      'Статусunfold_more',
    ]);
    await expect(footer(page)).toContainText('Источник: Логистика · fleet.expenses');
  });

  test('сортировка по заголовку: arrow_upward, затем arrow_downward, порядок строк', async ({
    app,
    page,
  }) => {
    await open(app, page, { search: '?set=fleet.vehicles' });
    await expect(bodyRows(page)).toHaveCount(7);
    const sort = table(page).getByRole('button', { name: /^Объём, м³/ });
    await sort.click();
    await expect(sort).toHaveText('Объём, м³arrow_upward');
    await sort.click();
    await expect(sort).toHaveText('Объём, м³arrow_downward');
    await expect(bodyRows(page).first().locator('td').first()).toHaveText('ГАЗон Next');
  });

  // W4.50: выгрузка — задание с журналом (core-data-jobs.spec.ts); тост эталона без «В демо файл не создаётся».
  test('«Выгрузить» — тост эталона с числом строк фильтра', async ({ app, page }) => {
    await open(app, page);
    await expect(bodyRows(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'Выгрузить' }).click();
    await expect(toast(page)).toHaveText(
      'Выгрузка «Поездки»: 2 строк, фильтр и права зафиксированы.',
    );
  });

  test('логист без права начислений: колонки без «Начисление», подвал о скрытом поле', async ({
    app,
    page,
  }) => {
    const alta = await open(app, page);
    // Владелец снимает fleet.earnings.read с роли «Менеджер логистики» (как правка роли в «Пользователи и роли»).
    const roles = (await call(page, 'GET', `/api/v1/tenants/${alta}/roles?limit=200`)).body as {
      items: { id: string; name: string; permissions: string[] }[];
    };
    const role = roles.items.find((r) => r.name === 'Менеджер логистики');
    if (!role) throw new Error('нет роли «Менеджер логистики»');
    const cur = await call(page, 'GET', `/api/v1/tenants/${alta}/roles/${role.id}`);
    const r = await call(page, 'PATCH', `/api/v1/tenants/${alta}/roles/${role.id}`, {
      body: { permissions: role.permissions.filter((k) => k !== 'fleet.earnings.read') },
      ifMatch: cur.headers.etag ?? '',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await app(`/t/${alta}/data`, { persona: 'manager' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(bodyRows(page).first()).toBeVisible();
    expect(await heads(page)).toEqual([
      'Рейсunfold_more',
      'Водительunfold_more',
      'Статусunfold_more',
      'Пробег, кмunfold_more',
    ]);
    await expect(footer(page)).toContainText(HIDDEN);
  });

  test('строка открывает карточку модуля: рейс — «Рабочее место логиста», машина — тоже', async ({
    app,
    page,
  }) => {
    const alta = await open(app, page);
    await bodyRows(page).filter({ hasText: 'Р-208 · Северный маршрут' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/fleet\\?trip=`));
    await expect(h1(page, 'Рабочее место логиста')).toBeVisible();
    await page.goBack();
    await tab(page, /Автомобили/).click();
    await bodyRows(page).first().click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/fleet$`));
  });

  test('водитель и логист без роли — гейт «Нет доступа к разделу «Данные»»', async ({
    app,
    page,
  }) => {
    const alta = await openPage(app, page, 'data', { persona: 'manager' });
    await expect(page.getByText('Нет доступа к разделу «Данные»')).toBeVisible();
    await app(`/t/${alta}/data`, { persona: 'driver' });
    await expect(page.getByText('Нет доступа к разделу «Данные»')).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
  });

  test('ошибка каталога — «Повторить»; ошибка выборки — в таблице', async ({ app, page }) => {
    await openPage(app, page, 'home', { preset: 'logistics-ready' });
    await devScenario(page, { scenario: 'listDatasets=rate_limited' });
    const alta = page.url().match(/\/t\/([^/]+)\//)?.[1] ?? '';
    await app(`/t/${alta}/data`, { persona: 'owner' });
    await expect(page.getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(tab(page, /Поездки/)).toHaveAttribute('aria-selected', 'true');
    await devScenario(page, { scenario: 'queryDataset=offline' });
    await tab(page, /Автомобили/).click();
    await expect(page.getByRole('alert')).toHaveText(`Не удалось загрузить данные: ${OFFLINE}`);
    await devScenario(page, { scenario: null });
  });

  test('загрузка — скелетон; 1440 — боковая панель, 390 — нижняя навигация, без прокрутки страницы', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home', { preset: 'logistics-ready' });
    const alta = page.url().match(/\/t\/([^/]+)\//)?.[1] ?? '';
    await devScenario(page, { scenario: 'queryDataset=delay=1500' });
    await app(`/t/${alta}/data`, { persona: 'owner' });
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(bodyRows(page).first()).toBeVisible({ timeout: 15_000 });
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('клавиатура: Tab до вкладок, фильтра и строки; Enter по строке открывает рейс; фокус виден', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const row = bodyRows(page).filter({ hasText: 'Р-208 · Северный маршрут' });
    await expect(row).toBeVisible();
    const seen = new Set<string>();
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      seen.add(
        await page.evaluate(
          () =>
            document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName ?? '',
        ),
      );
      reached = await row.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(seen.has('tab')).toBe(true);
    expect(await row.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/fleet\?trip=/);
  });

  // W4.80: наборы этапа 4 эталона design-2026-10-19 (dataVM :4189 — SETS.responses, SETS.tasks).
  test('W4.80: вкладки «Ответы на осмотр» и «Задачи» после «Расходов» со счётчиками', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(tabs(page).getByRole('tab')).toHaveText([
      /^local_shipping\s*Автомобили\s*7$/,
      /^route\s*Поездки\s*2$/,
      /^receipt_long\s*Расходы\s*0$/,
      /^dynamic_form\s*Ответы на осмотр\s*2$/,
      /^task_alt\s*Задачи\s*11$/,
    ]);
  });

  test('W4.80: «Ответы на осмотр» — колонки, R-0988 и R-1012, подвал «Формы · forms.responses»', async ({
    app,
    page,
  }) => {
    await open(app, page, { search: '?set=forms.responses' });
    await expect(tab(page, /Ответы на осмотр/)).toHaveAttribute('aria-selected', 'true');
    await expect(bodyRows(page)).toHaveCount(2);
    expect(await heads(page)).toEqual([
      'Ответunfold_more',
      'Объектunfold_more',
      'Авторunfold_more',
      'Версия формыunfold_more',
      'Топливоunfold_more',
    ]);
    await expect(bodyRows(page).nth(0).locator('td')).toHaveText([
      'R-0988',
      'Рейс Р-171',
      'Кирилл Громов',
      'v2',
      'почти полный',
    ]);
    await expect(bodyRows(page).nth(1).locator('td')).toHaveText([
      'R-1012',
      'Рейс Р-196',
      'Илья Васильев',
      'v3',
      '¾',
    ]);
    await expect(footer(page)).toHaveText(
      `Источник: Формы · forms.responsesОбновлено: только что${SCOPE}`,
    );
  });

  test('W4.80: «Задачи» — колонки, строка «T-61 · Проверить осмотр Р-196», подвал «Задачи · tasks»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await tab(page, /Задачи/).click();
    await expect(page).toHaveURL(/[?&]set=tasks/);
    await expect(bodyRows(page)).toHaveCount(11);
    expect(await heads(page)).toEqual([
      'Задачаunfold_more',
      'Исполнительunfold_more',
      'Статусunfold_more',
      'Срокunfold_more',
    ]);
    await expect(
      bodyRows(page).filter({ hasText: 'T-61 · Проверить осмотр Р-196' }).locator('td'),
    ).toHaveText(['T-61 · Проверить осмотр Р-196', 'Марина Котова', 'Готово', '27.09.2026']);
    await filter(page).fill('Котова');
    // T-58, T-61, T-64 эталона и T-66 «Подготовить парк к зиме» сида api.js.
    await expect(bodyRows(page)).toHaveCount(4);
    await expect(footer(page)).toHaveText(`Источник: Задачи · tasksОбновлено: только что${SCOPE}`);
  });

  test('W4.80: строка ответа открывает ответ в редакторе формы, строка задачи — карточку задачи', async ({
    app,
    page,
  }) => {
    const alta = await open(app, page, { search: '?set=forms.responses' });
    await bodyRows(page).filter({ hasText: 'R-1012' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/forms\\?.*tab=responses`));
    await expect(page).toHaveURL(/[?&]resp=/);
    await expect(page.getByText('R-1012').first()).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(tab(page, /Ответы на осмотр/)).toHaveAttribute('aria-selected', 'true');
    await tab(page, /Задачи/).click();
    const row = bodyRows(page).filter({ hasText: 'T-64 · Найти водителя на рейс Р-211' });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/tasks\\?.*task=`));
    await expect(
      page.getByText('Найти водителя на рейс Р-211').locator('visible=true').first(),
    ).toBeVisible({
      timeout: 15_000,
    });
  });

  test('W4.80: логист видит «Ответы на осмотр» и «Задачи» своей области', async ({ app, page }) => {
    await open(app, page, { persona: 'manager', search: '?set=tasks' });
    await expect(tab(page, /Задачи/)).toHaveAttribute('aria-selected', 'true');
    await expect(
      bodyRows(page).filter({ hasText: 'T-64 · Найти водителя на рейс Р-211' }),
    ).toHaveCount(1);
    await tab(page, /Ответы на осмотр/).click();
    await expect(bodyRows(page).first()).toBeVisible();
    await expect(footer(page)).toContainText('Источник: Формы · forms.responses');
  });

  test('axe без serious; 390 — цели не меньше 44 px', async ({ app, page, axe }) => {
    await open(app, page);
    await expect(bodyRows(page).first()).toBeVisible();
    // Страница в покое: счётчики вкладок пришли, шрифт иконок загружен (до него лигатура «unfold_more» — текст,
    // и axe меряет контраст декоративной иконки сортировки #6B7873 эталона).
    await expect(tab(page, /Расходы/)).toHaveText(/Расходы\s*0$/);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    if (!phone(page)) return;
    expect(await hitHeight(tab(page, /Поездки/))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(filter(page))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(page.getByLabel('Вид'))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(page.getByRole('button', { name: 'Выгрузить' }))).toBeGreaterThanOrEqual(
      44,
    );
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

// W2.08 («Данные» на backend: listDatasets, queryDataset с правами набора и полей) в main — строки без fixme; W4.80 —
// наборы «Задач» и «Форм» (data/tasks, data/forms).
test.describe('core-data — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: наборы логистики, счётчики и строки по queryDataset стенда', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/data`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    // W4.80: после наборов логистики — «Ответы на осмотр» и «Задачи».
    await expect(tabs(page).getByRole('tab')).toHaveCount(5);
    await expect(tab(page, /Поездки/)).toHaveAttribute('aria-selected', 'true');
    const q = await call(
      page,
      'POST',
      `/api/v1/tenants/${s.tenant}/datasets/fleet.vehicles/query`,
      {
        body: { select: ['displayName'], filters: [], sort: [], limit: 1, includeCount: true },
      },
    );
    expect(q.status).toBe(200);
    const n = (q.body as { visibleCount: number }).visibleCount;
    await expect(tab(page, /Автомобили/)).toHaveText(new RegExp(`Автомобили\\s*${n}$`));
    await tab(page, /Автомобили/).click();
    await expect(bodyRows(page)).toHaveCount(Math.min(n, 50));
    // Сид стенда шире сида MSW (машины других фирм, «ГАЗель Бизнес»): поиск по полному названию.
    await filter(page).fill('ГАЗель Next');
    await expect(bodyRows(page).first()).toContainText('ГАЗель Next');
    await expect(bodyRows(page).filter({ hasNotText: 'ГАЗель Next' })).toHaveCount(0);
    await expect(footer(page)).toContainText('Источник: Логистика · fleet.vehicles');
  });

  test('логист на стенде: «Поездки» своей фирмы; водитель — гейт', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/data`, { persona: 'manager' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(tab(page, /Поездки/)).toHaveAttribute('aria-selected', 'true');
    await expect(footer(page)).toContainText('Источник: Логистика · fleet.trips');
    await app(`/t/${s.tenant}/data`, { persona: 'driver' });
    await expect(page.getByText('Нет доступа к разделу «Данные»')).toBeVisible({ timeout: 15_000 });
  });

  // W4.80: наборы «Задач» и «Форм» на backend (data/tasks, data/forms).
  test('W4.80: владелец на стенде — «Ответы на осмотр» и «Задачи» по queryDataset стенда, переход в задачу', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/data?set=forms.responses`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(tabs(page).getByRole('tab')).toHaveCount(5);
    const count = async (set: string, select: string): Promise<number> => {
      const q = await call(page, 'POST', `/api/v1/tenants/${s.tenant}/datasets/${set}/query`, {
        body: { select: [select], filters: [], sort: [], limit: 1, includeCount: true },
      });
      expect(q.status, JSON.stringify(q.body)).toBe(200);
      return (q.body as { visibleCount: number }).visibleCount;
    };
    const responses = await count('forms.responses', 'response');
    await expect(tab(page, /Ответы на осмотр/)).toHaveText(
      new RegExp(`Ответы на осмотр\\s*${responses}$`),
    );
    await expect(bodyRows(page).filter({ hasText: 'R-1012' }).locator('td')).toHaveText([
      'R-1012',
      'Рейс Р-196',
      'Илья Васильев',
      'v3',
      '¾',
    ]);
    await expect(footer(page)).toContainText('Источник: Формы · forms.responses');
    const tasks = await count('tasks', 'task');
    await tab(page, /Задачи/).click();
    await expect(tab(page, /Задачи/)).toHaveText(new RegExp(`Задачи\\s*${tasks}$`));
    await expect(bodyRows(page)).toHaveCount(Math.min(tasks, 50));
    await filter(page).fill('Найти водителя на рейс Р-211');
    await expect(bodyRows(page)).toHaveCount(1);
    await bodyRows(page).first().click();
    await expect(page).toHaveURL(new RegExp(`/t/${s.tenant}/tasks\\?.*task=`));
  });

  test('W4.80: логист на стенде — «Ответы на осмотр» своих рейсов и «Задачи» своих проектов', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/data?set=tasks`, { persona: 'manager' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(tab(page, /Задачи/)).toHaveAttribute('aria-selected', 'true');
    await expect(bodyRows(page).first()).toBeVisible();
    await expect(footer(page)).toContainText('Источник: Задачи · tasks');
    await tab(page, /Ответы на осмотр/).click();
    await expect(footer(page)).toContainText('Источник: Формы · forms.responses');
  });
});
