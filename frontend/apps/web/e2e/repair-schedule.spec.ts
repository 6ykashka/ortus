// W6.23 · e2e страницы `repair-schedule` «Карточка объекта · График» (S6, шаг 6.5; эталон design-2026-10-19 ·
// «Ремонт и стройка.dc.html» :279–511, логика :936–1311). Режим mock — пресет repairs-ready (сегодня 20.10.2026), объект
// «ЖК Речной · квартира 42»: график из 10 этапов, действующий план (электрика 10 дней), по договору 27.11, прогноз 01.12.
// На 390 по умолчанию «Ближайшие 3 недели» и без перетаскивания, на 1440 — диаграмма и панель справа (эталон :1094).
// Режим stand — backend W6.14 в main: строки @stand (W2.103).
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { type StandObject, buildSchedule, contractedObject } from './repair.stand.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';
import { wide } from './viewport.helpers.ts';

const H1 = 'График работ';
const OBJ42 = 'ЖК Речной · квартира 42';

/** Часы страницы: 20 октября 2026, полдень (Москва) — «Сегодня 20 октября» эталона. */
const TODAY = '2026-10-20T12:00:00+03:00';

const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 640;

async function projectId(page: Page, tenant: string, name: string): Promise<string> {
  const r = await call(page, 'GET', `/api/v1/tenants/${tenant}/repairs/projects?limit=100`);
  if (r.status !== 200) throw new Error(`projects ${r.status}: ${JSON.stringify(r.body)}`);
  const items = (r.body as { items: { id: string; name: string }[] }).items;
  const p = items.find((x) => x.name === name);
  if (!p) throw new Error(`нет объекта «${name}»`);
  return p.id;
}

type AppFn = Parameters<Parameters<typeof test>[2]>[0]['app'];

/** Вход, пресет «Ремонта», часы 20.10 и график объекта по прямому URL. */
async function open(
  app: AppFn,
  page: Page,
  o: { persona?: 'owner' | 'driver' | 'manager'; project?: string; scenario?: string } = {},
): Promise<{ tenant: string; id: string }> {
  const persona = o.persona ?? 'owner';
  await app('/', { persona });
  const tenant = await tenantId(page);
  await devScenario(page, { preset: 'repairs-ready' });
  await page.clock.setSystemTime(new Date(TODAY));
  // Пресет пересоздаёт состояние сервера вместе с сессиями: входим заново.
  await app('/', { persona });
  const id = await projectId(page, tenant, o.project ?? OBJ42);
  if (o.scenario) await devScenario(page, { scenario: o.scenario });
  await app(`/t/${tenant}/repair/${id}/schedule`, { persona });
  return { tenant, id };
}

const stageRow = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp('^' + name) }).first();

/** На телефоне диаграмма скрыта по умолчанию: открыть её кнопкой «Диаграмма». */
async function chart(page: Page): Promise<void> {
  if (phone(page)) await page.getByRole('button', { name: 'Диаграмма' }).click();
  await expect(page.getByRole('img', { name: /^Демонтаж: / })).toBeVisible();
}

test.describe('repair-schedule — график работ @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('прямой URL: заголовок, крошка, чипы «По договору» и «Прогноз», вступление, диаграмма', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('По договору 27.11, пт')).toBeVisible();
    await expect(page.getByText('Прогноз 01.12, вт · +2 раб. дня')).toBeVisible();
    await expect(
      page.getByText(/базовый план, утверждённый вместе с договором № 42\. Сегодня 20 октября\./),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Крошка' })).toContainText(OBJ42);
    await chart(page);
    await expect(
      page.getByRole('img', { name: 'Демонтаж: 05.10, пн – 09.10, пт, 5 раб. дней' }),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: 'Сдача объекта: 01.12, вт' })).toBeVisible();
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
  });

  test('сводка справа: «Сдача объекта», «Требует внимания», история с причиной', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const aside = page.getByRole('complementary', { name: 'Сводка графика и этап' });
    await expect(aside.getByRole('heading', { name: 'Сдача объекта' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(aside.getByText('Позже договора на 2 раб. дня')).toBeVisible();
    await expect(aside.getByText(/«Плитка в санузле»: не назначен исполнитель/)).toBeVisible();
    await expect(aside.getByText('Причина: Задержка подрядчика', { exact: true })).toBeVisible();
    await expect(aside.getByRole('heading', { name: 'Как собран график' })).toBeVisible();
  });

  test('«Ближайшие 3 недели»: три окна, праздник 4 ноября; по умолчанию на 390', async ({
    app,
    page,
  }) => {
    await open(app, page);
    if (!phone(page)) {
      await expect(page.getByRole('img', { name: /^Демонтаж: / })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Ближайшие 3 недели' }).click();
    }
    await expect(
      page.getByRole('heading', { level: 3, name: 'Эта неделя · 19–23 октября' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { level: 3, name: /^Следующая неделя · / }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: /^Через неделю · / })).toBeVisible();
    await expect(page.getByText('4 ноября — выходной', { exact: true })).toBeVisible();
    await expect(page.getByText('Исполнитель и материалы готовы').first()).toBeVisible();
  });

  test('этап: панель со сроками и связями; «+» длительности → предпросмотр; причина → сохранение и история', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await chart(page);
    await stageRow(page, 'Штукатурка стен').click();
    const panel = page.getByRole('heading', { level: 3, name: 'Штукатурка стен' });
    await expect(panel).toBeVisible();
    await expect(page.getByText('После «Электрика · черновая»')).toBeVisible();
    await page.getByRole('button', { name: 'Продлить на рабочий день' }).click();
    const region = page.getByRole('region', { name: 'Несохранённое изменение графика' });
    await expect(region).toContainText('«Штукатурка стен»: длительность 10 → 11 раб. дней.');
    const save = region.getByRole('button', { name: 'Сохранить и уведомить' });
    await expect(save).toBeDisabled();
    await expect(region).toContainText('Причина попадёт в историю графика и в уведомления.');
    await region.getByLabel('Причина').selectOption({ label: 'Поставка материалов' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText(/^График сохранён\./)).toBeVisible();
    await expect(region).toBeHidden();
    await page.getByRole('button', { name: 'Сводка графика' }).click();
    await expect(
      page
        .getByRole('complementary', { name: 'Сводка графика и этап' })
        .getByText('Причина: Поставка материалов', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await chart(page);
    await expect(
      page.getByRole('img', { name: /^Штукатурка стен: .*, 11 раб\. дней/ }),
    ).toBeVisible();
  });

  test('«Отменить» сбрасывает предпросмотр; «Критический путь» гасит этапы с запасом', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await chart(page);
    await stageRow(page, 'Стяжка пола').click();
    await page.getByRole('button', { name: 'Начать на рабочий день позже' }).click();
    const region = page.getByRole('region', { name: 'Несохранённое изменение графика' });
    await expect(region).toContainText('«Стяжка пола»: начало');
    await region.getByRole('button', { name: 'Отменить' }).click();
    await expect(region).toBeHidden();
    await page.getByRole('checkbox', { name: 'Критический путь' }).check();
    await expect(page.locator('[data-stage][data-dimmed="true"]').first()).toBeAttached();
    await expect(page.locator('[data-link][data-state="dim"]').first()).toBeAttached();
    await page.getByRole('checkbox', { name: 'Критический путь' }).uncheck();
    await expect(page.locator('[data-stage][data-dimmed="true"]')).toHaveCount(0);
  });

  test('перетаскивание правого края полосы мышью меняет длительность в предпросмотре (только 1440)', async ({
    app,
    page,
  }) => {
    test.skip(phone(page), 'на телефоне перетаскивания нет — кнопки в панели этапа (эталон :1094)');
    await open(app, page);
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'По дням' }).click();
    const bar = page.getByRole('img', { name: /^Штукатурка стен: / });
    await bar.scrollIntoViewIfNeeded();
    const handle = bar.getByTitle('Потяните, чтобы изменить длительность');
    const box = await handle.boundingBox();
    if (!box) throw new Error('нет ручки полосы');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 26 * 3, y, { steps: 4 });
    await page.mouse.up();
    const region = page.getByRole('region', { name: 'Несохранённое изменение графика' });
    await expect(region).toContainText('«Штукатурка стен»: длительность 10 → 12 раб. дней.');
    await region.getByRole('button', { name: 'Отменить' }).click();
    await expect(region).toBeHidden();
  });

  test('исполнитель этапа: смена без причины — тост', async ({ app, page }) => {
    await open(app, page);
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await chart(page);
    await stageRow(page, 'Плитка в санузле').click();
    const select = page.getByLabel('Исполнитель', { exact: true });
    await expect(select).toBeEnabled();
    await expect.poll(async () => select.locator('option').count()).toBeGreaterThan(1);
    const value = await select
      .locator('option')
      .evaluateAll(
        (o) => (o as HTMLOptionElement[]).find((x) => x.value && x.value !== '__keep')?.value,
      );
    await select.selectOption(value ?? '');
    await expect(toast(page)).toHaveText('Исполнитель изменён.');
  });

  test('устаревший график (412): тост и перечитывание, предпросмотр сброшен', async ({
    app,
    page,
  }) => {
    await open(app, page, { scenario: 'applyScheduleChange=revision_mismatch' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await chart(page);
    await stageRow(page, 'Штукатурка стен').click();
    await page.getByRole('button', { name: 'Продлить на рабочий день' }).click();
    const region = page.getByRole('region', { name: 'Несохранённое изменение графика' });
    await region.getByLabel('Причина').selectOption({ label: 'Нет доступа на объект' });
    await region.getByRole('button', { name: 'Сохранить и уведомить' }).click();
    await expect(toast(page)).toHaveText(
      'График изменили в другом окне: данные обновлены, повторите правку.',
    );
    await expect(region).toBeHidden();
  });

  test('объект без графика: «Графика ещё нет» и «Собрать график по смете»', async ({
    app,
    page,
  }) => {
    await open(app, page, { project: 'Дом 120 м², Истра' });
    await expect(page.getByText('Графика ещё нет')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Собрать график по смете' })).toBeVisible();
  });

  test('роль без доступа к «Ремонту и стройке»: «Нет роли с доступом»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    await devScenario(page, { preset: 'repairs-ready' });
    await app('/', { persona: 'owner' });
    const id = await projectId(page, tenant, OBJ42);
    await app(`/t/${tenant}/repair/${id}/schedule`, { persona: 'driver' });
    await expect(page.getByText('Нет роли с доступом к графику объекта')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('ошибка загрузки — «Повторить»; загрузка — скелетон', async ({ app, page }) => {
    await open(app, page, { scenario: 'getSchedule=delay=1500' });
    await expect(page.getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: 'getSchedule=rate_limited' });
    await page.reload();
    await expect(page.getByText(/^Не удалось загрузить график: /)).toHaveText(
      'Не удалось загрузить график: Слишком много запросов. Подождите и повторите.',
      { timeout: 15_000 },
    );
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(h1(page, H1)).toBeVisible();
    await expect(page.getByText('По договору 27.11, пт')).toBeVisible();
  });

  test('цели ≥ 44 px на 390, без горизонтальной прокрутки страницы; axe без serious; панель справа на 1440', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await chart(page);
    if (phone(page)) {
      for (const name of ['Диаграмма', 'Ближайшие 3 недели', 'Весь объект', 'По дням']) {
        expect(await hitHeight(page.getByRole('button', { name })), name).toBeGreaterThanOrEqual(
          44,
        );
      }
      // Строка этапа диаграммы: кнопка названия на всю высоту строки без линии сверху (44 px, а не 43).
      expect(await hitHeight(stageRow(page, 'Демонтаж')), 'строка этапа').toBeGreaterThanOrEqual(
        44,
      );
    } else if (wide(page)) {
      const aside = page.getByRole('complementary', { name: 'Сводка графика и этап' });
      const chartBox = await page
        .getByRole('group', { name: 'Диаграмма графика работ' })
        .boundingBox();
      const asideBox = await aside.boundingBox();
      expect(asideBox?.x ?? 0).toBeGreaterThan((chartBox?.x ?? 0) + (chartBox?.width ?? 0) - 1);
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
  });
});

// Стенд: backend графика работ W6.14 в main. Объект с согласованной сметой и график по ней — командами API
// (repair.stand.ts); страница читает настоящий backend. Часы страницы сверяются с реальными до открытия графика: сроки
// и «сегодня» графика считает сервер по своему календарю, а часы харнесса стоят на 1.10.2026.
test.describe('repair-schedule — график работ @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(180_000);

  /** Свой объект с согласованной сметой; `scheduled: false` — графика ещё нет. */
  async function openScheduled(
    app: AppFn,
    page: Page,
    project: string,
    o: { scheduled?: boolean; persona?: 'owner' | 'driver' } = {},
  ): Promise<{ tenant: string; id: string; obj: StandObject }> {
    await app('/', { persona: 'owner' });
    await page.clock.setSystemTime(new Date());
    const tenant = await tenantId(page);
    const obj = await contractedObject(page, tenant, project);
    if (o.scheduled !== false) await buildSchedule(page, obj);
    const persona = o.persona ?? 'owner';
    await app(`/t/${tenant}/repair/${obj.id}/schedule`, { persona });
    return { tenant, id: obj.id, obj };
  }

  test('владелец на стенде: прямой URL — заголовок, крошка, чипы «По договору» и «Прогноз», вступление, диаграмма', async ({
    app,
    page,
  }, testInfo) => {
    const { obj } = await openScheduled(app, page, testInfo.project.name);
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/По договору\s+\d\d\.\d\d/)).toBeVisible();
    await expect(page.getByText(/Прогноз\s+\d\d\.\d\d/)).toBeVisible();
    await expect(page.getByText(/базовый план, утверждённый вместе с договором/)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Крошка' })).toContainText(obj.name);
    await chart(page);
    await expect(page.getByRole('img', { name: /^Сдача объекта: / })).toBeVisible();
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
  });

  test('владелец на стенде: сводка справа — «Сдача объекта», «Требует внимания», история «Как собран график»', async ({
    app,
    page,
  }, testInfo) => {
    await openScheduled(app, page, testInfo.project.name);
    const aside = page.getByRole('complementary', { name: 'Сводка графика и этап' });
    await expect(aside.getByRole('heading', { name: 'Сдача объекта' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(aside.getByRole('heading', { name: 'Требует внимания' })).toBeVisible();
    await expect(aside.getByText(/«Демонтаж»: не назначен исполнитель/)).toBeVisible();
    await expect(aside.getByRole('heading', { name: 'Как собран график' })).toBeVisible();
    await expect(aside).toContainText('График собран по версии 1 сметы и технологии шаблона');
  });

  test('владелец на стенде: «Ближайшие 3 недели» — три окна, по умолчанию на 390', async ({
    app,
    page,
  }, testInfo) => {
    await openScheduled(app, page, testInfo.project.name);
    if (!phone(page)) {
      await expect(page.getByRole('img', { name: /^Демонтаж: / })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Ближайшие 3 недели' }).click();
    }
    await expect(page.getByRole('heading', { level: 3, name: /^Эта неделя · / })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole('heading', { level: 3, name: /^Следующая неделя · / }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: /^Через неделю · / })).toBeVisible();
  });

  test('владелец на стенде: этап — панель со сроками и связями; «+» длительности → предпросмотр; причина → сохранение и история', async ({
    app,
    page,
  }, testInfo) => {
    await openScheduled(app, page, testInfo.project.name);
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
    await chart(page);
    await stageRow(page, 'Шпаклёвка и покраска').click();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Шпаклёвка и покраска' }),
    ).toBeVisible();
    await expect(page.getByText(/^После «/)).toBeVisible();
    await page.getByRole('button', { name: 'Продлить на рабочий день' }).click();
    const region = page.getByRole('region', { name: 'Несохранённое изменение графика' });
    await expect(region).toContainText(/«Шпаклёвка и покраска»: длительность 1 → 2 раб\. дн/);
    const save = region.getByRole('button', { name: 'Сохранить и уведомить' });
    await expect(save).toBeDisabled();
    await expect(region).toContainText('Причина попадёт в историю графика и в уведомления.');
    await region.getByLabel('Причина').selectOption({ label: 'Поставка материалов' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText(/^График сохранён\./)).toBeVisible({ timeout: 30_000 });
    await expect(region).toBeHidden();
    await page.getByRole('button', { name: 'Сводка графика' }).click();
    await expect(
      page
        .getByRole('complementary', { name: 'Сводка графика и этап' })
        .getByText('Причина: Поставка материалов', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await chart(page);
    await expect(
      page.getByRole('img', { name: /^Шпаклёвка и покраска: .*, 2 раб\. дн/ }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('владелец на стенде: «Отменить» сбрасывает предпросмотр; «Критический путь» гасит этапы с запасом', async ({
    app,
    page,
  }, testInfo) => {
    await openScheduled(app, page, testInfo.project.name);
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
    await chart(page);
    await stageRow(page, 'Стяжка пола').click();
    await page.getByRole('button', { name: 'Начать на рабочий день позже' }).click();
    const region = page.getByRole('region', { name: 'Несохранённое изменение графика' });
    await expect(region).toContainText('«Стяжка пола»: начало');
    await region.getByRole('button', { name: 'Отменить' }).click();
    await expect(region).toBeHidden();
    await page.getByRole('checkbox', { name: 'Критический путь' }).check();
    await expect(page.locator('[data-stage][data-dimmed="true"]').first()).toBeAttached();
    await page.getByRole('checkbox', { name: 'Критический путь' }).uncheck();
    await expect(page.locator('[data-stage][data-dimmed="true"]')).toHaveCount(0);
  });

  test('владелец на стенде: перетаскивание правого края полосы мышью меняет длительность в предпросмотре (на 390 — кнопки в панели этапа)', async ({
    app,
    page,
  }, testInfo) => {
    await openScheduled(app, page, testInfo.project.name);
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
    if (phone(page)) {
      // На телефоне перетаскивания нет — длительность меняют кнопки в панели этапа (эталон :1094).
      await chart(page);
      await expect(page.getByTitle('Потяните, чтобы изменить длительность')).toHaveCount(0);
      await stageRow(page, 'Шпаклёвка и покраска').click();
      await expect(page.getByRole('button', { name: 'Продлить на рабочий день' })).toBeVisible();
      return;
    }
    await page.getByRole('button', { name: 'По дням' }).click();
    const bar = page.getByRole('img', { name: /^Шпаклёвка и покраска: / });
    await bar.scrollIntoViewIfNeeded();
    const handle = bar.getByTitle('Потяните, чтобы изменить длительность');
    const box = await handle.boundingBox();
    if (!box) throw new Error('нет ручки полосы');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 26 * 3, y, { steps: 4 });
    await page.mouse.up();
    const region = page.getByRole('region', { name: 'Несохранённое изменение графика' });
    await expect(region).toContainText(/«Шпаклёвка и покраска»: длительность 1 → \d+ раб\. дн/);
    await region.getByRole('button', { name: 'Отменить' }).click();
    await expect(region).toBeHidden();
  });

  test('владелец на стенде: исполнитель этапа — смена без причины, тост', async ({
    app,
    page,
  }, testInfo) => {
    await openScheduled(app, page, testInfo.project.name);
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
    await chart(page);
    await stageRow(page, 'Плитка в санузле').click();
    const select = page.getByLabel('Исполнитель', { exact: true });
    await expect(select).toBeEnabled();
    await expect.poll(async () => select.locator('option').count()).toBeGreaterThan(1);
    const value = await select
      .locator('option')
      .evaluateAll(
        (o) => (o as HTMLOptionElement[]).find((x) => x.value && x.value !== '__keep')?.value,
      );
    await select.selectOption(value ?? '');
    await expect(toast(page)).toHaveText('Исполнитель изменён.', { timeout: 30_000 });
  });

  test('владелец на стенде: объект без графика — «Графика ещё нет», «Собрать график по смете» собирает его', async ({
    app,
    page,
  }, testInfo) => {
    await openScheduled(app, page, testInfo.project.name, { scheduled: false });
    await expect(page.getByText('Графика ещё нет')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Собрать график по смете' }).click();
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/По договору\s+\d\d\.\d\d/)).toBeVisible({ timeout: 30_000 });
    await chart(page);
  });

  test('сотрудник без роли ремонта на стенде: «Нет роли с доступом к графику объекта»', async ({
    app,
    page,
  }, testInfo) => {
    await openScheduled(app, page, testInfo.project.name, { persona: 'driver' });
    await expect(page.getByText('Нет роли с доступом к графику объекта')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('владелец на стенде: цели ≥ 44 px на 390, без горизонтальной прокрутки; axe без serious; панель справа на 1440', async ({
    app,
    page,
    axe,
  }, testInfo) => {
    await openScheduled(app, page, testInfo.project.name);
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
    await chart(page);
    if (phone(page)) {
      for (const name of ['Диаграмма', 'Ближайшие 3 недели', 'Весь объект', 'По дням']) {
        expect(await hitHeight(page.getByRole('button', { name })), name).toBeGreaterThanOrEqual(
          44,
        );
      }
      expect(await hitHeight(stageRow(page, 'Демонтаж')), 'строка этапа').toBeGreaterThanOrEqual(
        44,
      );
    } else if (wide(page)) {
      const aside = page.getByRole('complementary', { name: 'Сводка графика и этап' });
      const chartBox = await page
        .getByRole('group', { name: 'Диаграмма графика работ' })
        .boundingBox();
      const asideBox = await aside.boundingBox();
      expect(asideBox?.x ?? 0).toBeGreaterThan((chartBox?.x ?? 0) + (chartBox?.width ?? 0) - 1);
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
  });
});
