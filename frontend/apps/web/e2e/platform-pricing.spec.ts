// W4.61 · e2e страницы `platform-pricing` — «Тарифная сетка» оператора (эталон design-2026-10-19, «Ортус CRM.dc.html»
// pg.plans :1161–1252, plansVM :3853–3914; чек-лист docs/plan/analysis/04-platform.md §8 п. 39–46, обязательные
// пункты verification-protocol.md §1.3). Версии — listPriceBookVersions, публикация и отмена — команды W4.07.
import type { Locator } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import {
  confirmDialog,
  isStandMarked,
  openPlatform,
  realClock,
  releaseStandLocks,
  section,
  STAND_LOCK,
  STAND_MARK,
  standLock,
  textOf,
  toastText,
} from './billing.helpers.ts';
import { hitHeight, noHorizontalScroll } from './modules.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

const H1 = { level: 1, name: 'Тарифная сетка' } as const;
const INTRO =
  'Цена зависит от числа мест с входом в приложение и срока оплаты. Лицензия выдаётся на весь бизнес. Карточки сотрудников без входа место не занимают.';
const DEMO =
  'Цены в прототипе — пример для макета, не согласованный тариф. Налоги и онлайн-оплата не рассчитываются.';

const rows = (root: Locator) => root.getByRole('table').locator('tbody tr');
const errorsBox = (root: Locator) => root.getByRole('alert');

test.describe('platform-pricing — «Тарифная сетка» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'данные сида MSW и сценарии — режим mock');
  // Под нагрузкой общей машины вход и холодная загрузка страницы занимают до 30 с.
  test.describe.configure({ timeout: 60_000 });

  test('меню «Тарифная сетка» и прямой URL: заголовок, описание, плашка примера, data-screen-label', async ({
    app,
    page,
  }) => {
    await app('/platform/tenants', { persona: 'operator' });
    await page.setViewportSize({ width: 1440, height: 900 });
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('button', { name: 'Тарифная сетка' }).click();
    await expect(page).toHaveURL(/\/platform\/plans$/);
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const root = section(page, 'h-pb');
    await expect(root).toHaveAttribute('data-screen-label', 'Оператор · тарифная сетка');
    await expect(root.getByText(INTRO)).toBeVisible();
    await expect(root.getByText(DEMO)).toBeVisible();
    await page.goto('/platform/plans');
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
  });

  test('просмотр v2: шапка, заголовки сроков, строки тарифов и безлимит (04 §8 п. 39)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'plans');
    await expect(root.locator('.ox-pb-ver')).toHaveText('Версия v2 · действует с 01.10.2026');
    await expect(
      root.getByText('Добавлена ступень «Сеть» до 100 мест, пересчитаны цены', { exact: true }),
    ).toBeVisible();
    await expect(root.getByRole('button', { name: 'Подготовить версию v3' })).toBeVisible();
    await expect(root.getByRole('columnheader')).toHaveText([
      'Тариф',
      'Цена за месяц',
      'Месяцбазовая цена',
      '4 месскидка 5%',
      '8 месскидка 10%',
      '12 месскидка 20%',
    ]);
    await expect(rows(root)).toHaveCount(5);
    // Ячейки строки: тариф и места, цена в месяц, по сроку — цена со скидкой и подпись (разметка :1185–1203).
    const cells = async (i: number) => {
      const tds = rows(root).nth(i).locator('td');
      const out: string[] = [];
      for (let k = 0; k < (await tds.count()); k++) out.push(await textOf(tds.nth(k)));
      return out;
    };
    expect(await cells(0)).toEqual([
      'Стартдо 10 мест',
      '3 900 ₽',
      '3 900 ₽в месяц',
      '3 705 ₽в месяц · 14 820 ₽ за срок',
      '3 510 ₽в месяц · 28 080 ₽ за срок',
      '3 120 ₽в месяц · 37 440 ₽ за срок',
    ]);
    expect(await cells(3)).toEqual([
      'Сетьдо 100 мест',
      '27 900 ₽',
      '27 900 ₽в месяц',
      '26 505 ₽в месяц · 106 020 ₽ за срок',
      '25 110 ₽в месяц · 200 880 ₽ за срок',
      '22 320 ₽в месяц · 267 840 ₽ за срок',
    ]);
    expect(await cells(4)).toEqual([
      'Безлимитбольше 100 мест',
      'индивидуально',
      'по запросурасчёт оператора',
      'по запросурасчёт оператора',
      'по запросурасчёт оператора',
      'по запросурасчёт оператора',
    ]);
  });

  test('«История версий» и «Правила» (04 §8 п. 40)', async ({ app, page }) => {
    const root = await openPlatform(app, page, 'plans');
    const hist = root.locator('.ox-pb-history');
    await expect(hist.getByRole('heading', { level: 2, name: 'История версий' })).toBeVisible();
    const items = hist.locator('.ox-pb-version');
    await expect(items).toHaveCount(2);
    expect(await textOf(items.nth(0))).toBe(
      'v2 check_circleДействует 01.10.2026 — сейчас Добавлена ступень «Сеть» до 100 мест, пересчитаны цены · Е. Лаптева · 1 подписка на этих ценах',
    );
    expect(await textOf(items.nth(1))).toBe(
      'v1 historyАрхив 01.06.2026 — 30.09.2026 Стартовая сетка пилота · Е. Лаптева · 3 подписки на этих ценах',
    );
    await expect(root.locator('.ox-pb-rules li')).toHaveCount(6);
  });

  test('черновик v3: чип, поля названия, мест, цены и скидок, безлимит, подвал (04 §8 п. 41)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'plans');
    await root.getByRole('button', { name: 'Подготовить версию v3' }).click();
    await expect(root.getByText('Черновик v3 · не опубликован')).toBeVisible();
    await expect(root.getByRole('button', { name: 'Подготовить версию v3' })).toHaveCount(0);
    await expect(root.getByLabel('Скидка за срок 4 мес, %')).toHaveValue('5');
    await expect(root.getByLabel('Название тарифа')).toHaveCount(5);
    await expect(root.getByLabel('Мест в тарифе Старт')).toHaveValue('10');
    await expect(root.getByLabel('Цена за месяц, тариф Старт')).toHaveValue('3900');
    const unl = rows(root).nth(4);
    await expect(unl.getByLabel('Без лимита, цена индивидуально')).toBeChecked();
    await expect(unl.getByText('больше мест, чем в предыдущем тарифе')).toBeVisible();
    await expect(root.getByRole('button', { name: 'Удалить тариф Старт' })).toBeVisible();
    await expect(root.getByRole('button', { name: 'Добавить тариф' })).toBeVisible();
    await expect(root.getByLabel('Начнёт действовать')).toHaveValue('01.11.2026');
    await expect(root.getByLabel('Что изменилось')).toHaveAttribute(
      'placeholder',
      'Например: новая цена ступени «Команда»',
    );
    await expect(root.getByRole('button', { name: 'Отменить' })).toBeVisible();
    await expect(root.getByRole('button', { name: 'Опубликовать v3' })).toBeEnabled();
  });

  test('проверки черновика: тексты ошибок эталона, публикация закрыта (04 §8 п. 42)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'plans');
    await root.getByRole('button', { name: 'Подготовить версию v3' }).click();
    const name0 = root.getByLabel('Название тарифа').first();
    await name0.fill('');
    await expect(errorsBox(root)).toContainText('Перед публикацией исправьте:');
    await expect(errorsBox(root)).toContainText('· Тариф 1: укажите название');
    await expect(root.getByRole('button', { name: 'Опубликовать v3' })).toBeDisabled();
    await name0.fill('Старт');
    await root.getByLabel('Цена за месяц, тариф Команда').fill('3000');
    await expect(errorsBox(root)).toContainText(
      '· «Команда»: цена должна быть выше, чем у «Старт»',
    );
    await root.getByLabel('Цена за месяц, тариф Команда').fill('8900');
    await root.getByLabel('Мест в тарифе Команда').fill('5');
    await expect(errorsBox(root)).toContainText(
      '· «Команда»: мест должно быть больше, чем в «Старт» (10)',
    );
    await root.getByLabel('Мест в тарифе Команда').fill('25');
    await root.getByLabel('Скидка за срок 12 мес, %').fill('60');
    await expect(errorsBox(root)).toContainText('· Скидка за 12 мес: от 0 до 49%');
    await root.getByLabel('Скидка за срок 12 мес, %').fill('20');
    await root.getByLabel('Название тарифа').nth(2).fill('Старт');
    await expect(errorsBox(root)).toContainText('· Названия тарифов не должны повторяться');
    await root.getByLabel('Название тарифа').nth(2).fill('Бизнес');
    await expect(errorsBox(root)).toHaveCount(0);
    await expect(root.getByRole('button', { name: 'Опубликовать v3' })).toBeEnabled();
  });

  test('«Добавить тариф» перед безлимитом и «Удалить» (04 §8 п. 43)', async ({ app, page }) => {
    const root = await openPlatform(app, page, 'plans');
    await root.getByRole('button', { name: 'Подготовить версию v3' }).click();
    await root.getByRole('button', { name: 'Добавить тариф' }).click();
    await expect(rows(root)).toHaveCount(6);
    const added = rows(root).nth(4);
    await expect(added.getByLabel('Название тарифа')).toHaveValue('');
    await expect(added.getByLabel(/^Мест в тарифе/)).toHaveValue('200');
    await expect(errorsBox(root)).toContainText('· Тариф 5: укажите название');
    await expect(errorsBox(root)).toContainText('· Тариф 5: укажите цену в месяц');
    await added.getByRole('button', { name: /^Удалить тариф/ }).click();
    await expect(rows(root)).toHaveCount(5);
    await expect(errorsBox(root)).toHaveCount(0);
  });

  test('публикация v3: диалог, баннер «Запланирована…», история (04 §8 п. 44)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'plans');
    await root.getByRole('button', { name: 'Подготовить версию v3' }).click();
    await root.getByLabel('Что изменилось').fill('Тест');
    await root.getByRole('button', { name: 'Опубликовать v3' }).click();
    const d = confirmDialog(page, 'Опубликовать тарифную сетку v3?');
    await expect(d).toContainText('Начнёт действовать 01.11.2026.');
    await expect(d.locator('li')).toHaveText([
      'eventНовые подписки и продления с 01.11.2026 — по новым ценам',
      'lock_clockДействующие подписки сохраняют цену до конца оплаченного периода',
      'event_upcomingДо 01.11.2026 действуют цены v2; запланированную версию можно отменить до этой даты',
    ]);
    await d.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(toastText(page)).toHaveText('Готово · запись добавлена в журнал');
    const banner = root.getByRole('status').filter({ hasText: 'Запланирована версия v3' });
    await expect(banner).toContainText(
      'Запланирована версия v3 с 01.11.2026: Тест. До этой даты действуют цены v2.',
    );
    await expect(banner.getByRole('button', { name: 'Отменить версию' })).toBeVisible();
    await expect(root.getByRole('button', { name: /^Подготовить версию/ })).toHaveCount(0);
    const items = root.locator('.ox-pb-version');
    expect(await textOf(items.nth(0))).toBe(
      'v3 eventЗапланирована с 01.11.2026 с 01.11.2026 · ещё не действует Тест · Е. Лаптева · 0 подписок на этих ценах',
    );
    await expect(items.nth(1)).toContainText('01.10.2026 — до 01.11.2026');
  });

  test('«Отменить версию»: диалог, баннер исчез, «Подготовить версию v3» вернулась (04 §8 п. 45)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'plans');
    await root.getByRole('button', { name: 'Подготовить версию v3' }).click();
    await root.getByRole('button', { name: 'Опубликовать v3' }).click();
    await confirmDialog(page, 'Опубликовать тарифную сетку v3?')
      .getByRole('button', { name: 'Опубликовать' })
      .click();
    await root.getByRole('button', { name: 'Отменить версию' }).click();
    const d = confirmDialog(page, 'Отменить версию v3?');
    await expect(d).toContainText('Она ещё не начала действовать.');
    await expect(d.locator('li')).toHaveText([
      'undoЦены v2 продолжат действовать без даты окончания',
      'historyОтмена записывается в журнал',
    ]);
    const ok = d.getByRole('button', { name: 'Отменить версию' });
    await expect(ok).toHaveCSS('background-color', 'rgb(161, 58, 51)');
    await ok.click();
    await expect(root.getByRole('status').filter({ hasText: 'Запланирована' })).toHaveCount(0);
    await expect(root.locator('.ox-pb-version').first()).toContainText('01.10.2026 — сейчас');
    await expect(root.getByRole('button', { name: 'Подготовить версию v4' })).toBeVisible();
  });

  test('«Отменить» черновик — без диалога, таблица снова только для чтения (04 §8 п. 46)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'plans');
    await root.getByRole('button', { name: 'Подготовить версию v3' }).click();
    await root.getByLabel('Название тарифа').first().fill('Начало');
    await root.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(root.getByLabel('Название тарифа')).toHaveCount(0);
    await expect(rows(root).first()).toContainText('Старт');
  });

  test('отказ сервера при публикации (422): тост с текстом, черновик сохраняется', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'plans');
    await root.getByRole('button', { name: 'Подготовить версию v3' }).click();
    await devScenario(page, { scenario: 'publishPriceBookVersion=validation_failed', once: true });
    await root.getByRole('button', { name: 'Опубликовать v3' }).click();
    await confirmDialog(page, 'Опубликовать тарифную сетку v3?')
      .getByRole('button', { name: 'Опубликовать' })
      .click();
    await expect(page.locator('.ox-toast[role="alert"]')).toBeVisible();
    await expect(root.getByText('Черновик v3 · не опубликован')).toBeVisible();
  });

  test('ошибка чтения: alert и «Повторить» (no-reference)', async ({ app, page }) => {
    await openPlatform(app, page, 'plans');
    await devScenario(page, { scenario: 'listPriceBookVersions=rate_limited', once: true });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const alert = section(page, 'h-pb').getByRole('alert');
    await expect(alert).toContainText(
      'Не удалось загрузить тарифную сетку: Слишком много запросов',
      { timeout: 15_000 },
    );
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(rows(section(page, 'h-pb'))).toHaveCount(5);
  });

  // Возврат 1 (ревью, major): обязательные пункты verification-protocol §1.3 — загрузка, нет права, офлайн
  // чтения и команд, клавиатура и Escape с возвратом фокуса.
  test('загрузка: скелетон «Загрузка» под заголовком до ответа listPriceBookVersions (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'plans');
    await devScenario(page, { scenario: 'listPriceBookVersions=delay=2500' });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const root = section(page, 'h-pb');
    const status = root.getByRole('status', { name: 'Загрузка' });
    await expect(status).toBeVisible();
    await expect(root).not.toContainText('Загружаем рабочее пространство');
    await expect(rows(root)).toHaveCount(5, { timeout: 15_000 });
    await expect(status).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('нет права роли (403): текст раздела вместо сетки (no-reference)', async ({ app, page }) => {
    await openPlatform(app, page, 'plans');
    await devScenario(page, { scenario: 'listPriceBookVersions=forbidden_action' });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const root = section(page, 'h-pb');
    await expect(
      root.getByText(
        'Нет права на тарифную сетку: раздел доступен ролям «Владелец платформы», «Администратор» и «Биллинг».',
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(root.getByRole('table')).toHaveCount(0);
    await expect(root.getByRole('button', { name: 'Повторить' })).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('нет связи при чтении: alert «Нет связи с сервером…» и «Повторить» (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'plans');
    await devScenario(page, { scenario: 'listPriceBookVersions=offline' });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const alert = section(page, 'h-pb').getByRole('alert');
    await expect(alert).toContainText(
      'Не удалось загрузить тарифную сетку: Нет связи с сервером. Проверьте подключение.',
      { timeout: 15_000 },
    );
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(rows(section(page, 'h-pb'))).toHaveCount(5);
  });

  test('нет связи при публикации и отмене: тост warn, диалог открыт, данные прежние', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'plans');
    await root.getByRole('button', { name: 'Подготовить версию v3' }).click();
    await root.getByRole('button', { name: 'Опубликовать v3' }).click();
    const pub = confirmDialog(page, 'Опубликовать тарифную сетку v3?');
    await devScenario(page, { scenario: 'publishPriceBookVersion=offline', once: true });
    await pub.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(toastText(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(pub).toBeVisible();
    await expect(pub.getByRole('button', { name: 'Опубликовать' })).toBeEnabled();
    await expect(root.getByText('Черновик v3 · не опубликован')).toBeVisible();
    await pub.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const banner = root.getByRole('status').filter({ hasText: 'Запланирована версия v3' });
    await banner.getByRole('button', { name: 'Отменить версию' }).click();
    const cancel = confirmDialog(page, 'Отменить версию v3?');
    await devScenario(page, { scenario: 'cancelPriceBookVersion=offline', once: true });
    await cancel.getByRole('button', { name: 'Отменить версию' }).click();
    await expect(toastText(page).last()).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(cancel).toBeVisible();
    await expect(banner).toBeVisible();
  });

  test('клавиатура: Tab по странице, фокус виден; Escape закрывает оба диалога, фокус на кнопке', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'plans');
    const prepare = root.getByRole('button', { name: 'Подготовить версию v3' });
    await prepare.focus();
    expect(await prepare.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Tab');
    await expect(root.locator('.ox-pb-table-wrap')).toBeFocused();
    await prepare.focus();
    await page.keyboard.press('Enter');
    await expect(root.getByText('Черновик v3 · не опубликован')).toBeVisible();
    const publish = root.getByRole('button', { name: 'Опубликовать v3' });
    await publish.focus();
    await page.keyboard.press('Enter');
    await expect(confirmDialog(page, 'Опубликовать тарифную сетку v3?')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(publish).toBeFocused();
    await page.keyboard.press('Enter');
    await confirmDialog(page, 'Опубликовать тарифную сетку v3?')
      .getByRole('button', { name: 'Опубликовать' })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const cancelVersion = root
      .getByRole('status')
      .filter({ hasText: 'Запланирована версия v3' })
      .getByRole('button', { name: 'Отменить версию' });
    await cancelVersion.focus();
    await page.keyboard.press('Enter');
    await expect(confirmDialog(page, 'Отменить версию v3?')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(cancelVersion).toBeFocused();
    expect(await cancelVersion.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');
  });

  test('390: без горизонтальной прокрутки страницы, таблица — в своей рамке, цели ≥ 44 px', async ({
    app,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const root = await openPlatform(app, page, 'plans');
    expect(await noHorizontalScroll(page)).toBe(true);
    const wrap = root.locator('.ox-pb-table-wrap');
    const [scroll, client] = await wrap.evaluate((e) => [e.scrollWidth, e.clientWidth]);
    expect(scroll).toBeGreaterThan(client);
    expect(
      await hitHeight(root.getByRole('button', { name: 'Подготовить версию v3' })),
    ).toBeGreaterThanOrEqual(44);
    // Возврат 1 (ревью, minor): кнопки черновика — область нажатия 44 px без изменения вида (PD-28,
    // Q-W1.24-21); поля ввода черновика — размеры эталона (allowlist, Q-W4.61-16).
    await root.getByRole('button', { name: 'Подготовить версию v3' }).click();
    expect(
      await hitHeight(root.getByRole('button', { name: 'Добавить тариф' })),
    ).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(root.getByRole('button', { name: 'Удалить тариф Старт' })),
    ).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(rows(root).nth(4).locator('.ox-pb-unl'))).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('axe: просмотр и черновик без нарушений serious/critical', async ({ app, page, axe }) => {
    const root = await openPlatform(app, page, 'plans');
    let r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await root.getByRole('button', { name: 'Подготовить версию v3' }).click();
    r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });
});

test.describe('platform-pricing — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  // W4.71 (Q-W4.61-20): сетка Go-сида (backend/cmd/seed/billing.go) — v2 действует с 01.10.2026, v1 в архиве.
  // Публикация — своя версия прогона с номером после всех (и отменённых, Q-W4.07-12) и датой начала через месяц по
  // настоящим часам (сервер принимает дату не раньше завтрашнего дня); в конце строка её отменяет — v2 снова без
  // даты окончания. Запланированный хвост прошлой попытки строки (метка STAND_MARK в «Что изменилось») отменяется до
  // начала; чужая запланированная версия не отменяется — строка падает с её номером (запланирована не больше одной).
  test.describe.configure({ timeout: 90_000 });
  test.afterEach(releaseStandLocks);

  test('оператор стенда: версии сетки сида, черновик и публикация с отменой', async ({
    app,
    page,
  }) => {
    // Запланирована не больше одной версии, номер следующей — общий: проекты идут по очереди.
    await standLock(STAND_LOCK.priceBook);
    await realClock(page);
    await app('/platform/plans', { persona: 'operator' });
    const listed = async () =>
      (
        (await call(page, 'GET', '/api/v1/platform/price-book/versions?includeCancelled=true'))
          .body as { items: { version: number; state: string; note: string }[] }
      ).items;
    const scheduled = (await listed()).filter((x) => x.state === 'scheduled');
    for (const v of scheduled.filter((x) => isStandMarked(x.note))) {
      const r = await call(
        page,
        'POST',
        `/api/v1/platform/price-book/versions/${v.version}/cancel`,
      );
      expect(r.status, `cancelPriceBookVersion v${v.version}`).toBe(200);
    }
    expect(
      scheduled.filter((x) => !isStandMarked(x.note)).map((x) => x.version),
      'запланированная версия сетки не из строки W4.71 (запланирована не больше одной)',
    ).toEqual([]);
    const next = Math.max(...(await listed()).map((v) => v.version)) + 1;
    const root = await openPlatform(app, page, 'plans');

    await expect(root.locator('.ox-pb-ver')).toHaveText('Версия v2 · действует с 01.10.2026');
    await expect(
      root.getByText('Добавлена ступень «Сеть» до 100 мест, пересчитаны цены', { exact: true }),
    ).toBeVisible();
    await expect(root.getByRole('columnheader')).toHaveText([
      'Тариф',
      'Цена за месяц',
      'Месяцбазовая цена',
      '4 месскидка 5%',
      '8 месскидка 10%',
      '12 месскидка 20%',
    ]);
    await expect(rows(root)).toHaveCount(5);
    const cells = async (i: number) => {
      const tds = rows(root).nth(i).locator('td');
      const out: string[] = [];
      for (let k = 0; k < (await tds.count()); k++) out.push(await textOf(tds.nth(k)));
      return out;
    };
    expect(await cells(0)).toEqual([
      'Стартдо 10 мест',
      '3 900 ₽',
      '3 900 ₽в месяц',
      '3 705 ₽в месяц · 14 820 ₽ за срок',
      '3 510 ₽в месяц · 28 080 ₽ за срок',
      '3 120 ₽в месяц · 37 440 ₽ за срок',
    ]);
    expect(await cells(3)).toEqual([
      'Сетьдо 100 мест',
      '27 900 ₽',
      '27 900 ₽в месяц',
      '26 505 ₽в месяц · 106 020 ₽ за срок',
      '25 110 ₽в месяц · 200 880 ₽ за срок',
      '22 320 ₽в месяц · 267 840 ₽ за срок',
    ]);
    expect((await cells(4)).slice(0, 2)).toEqual(['Безлимитбольше 100 мест', 'индивидуально']);
    const items = root.locator('.ox-pb-version');
    await expect(items).toHaveCount(2);
    expect(await textOf(items.nth(0))).toMatch(
      /^v2 check_circleДействует 01\.10\.2026 — сейчас Добавлена ступень «Сеть» до 100 мест, пересчитаны цены · Е\. Лаптева · \d+ подпис/,
    );
    expect(await textOf(items.nth(1))).toMatch(
      /^v1 historyАрхив 01\.06\.2026 — 30\.09\.2026 Стартовая сетка пилота · Е\. Лаптева · \d+ подпис/,
    );

    // Черновик следующей версии и публикация со второй даты списка (первое число через месяц).
    await root.getByRole('button', { name: `Подготовить версию v${next}` }).click();
    await expect(root.getByText(`Черновик v${next} · не опубликован`)).toBeVisible();
    await expect(root.getByLabel('Цена за месяц, тариф Старт')).toHaveValue('3900');
    await root.getByLabel('Начнёт действовать').selectOption({ index: 1 });
    const from = await root.getByLabel('Начнёт действовать').inputValue();
    expect(from).toMatch(/^01\.\d\d\.\d{4}$/);
    const note = `${STAND_MARK} ${test.info().project.name}`;
    await root.getByLabel('Что изменилось').fill(note);
    await root.getByRole('button', { name: `Опубликовать v${next}` }).click();
    const d = confirmDialog(page, `Опубликовать тарифную сетку v${next}?`);
    await expect(d).toContainText(`Начнёт действовать ${from}.`);
    await d.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(toastText(page)).toHaveText('Готово · запись добавлена в журнал');
    const banner = root.getByRole('status').filter({ hasText: `Запланирована версия v${next}` });
    await expect(banner).toContainText(
      `Запланирована версия v${next} с ${from}: ${note}. До этой даты действуют цены v2.`,
    );
    await expect(root.getByRole('button', { name: /^Подготовить версию/ })).toHaveCount(0);
    expect(await textOf(items.nth(0))).toBe(
      `v${next} eventЗапланирована с ${from} с ${from} · ещё не действует ${note} · Е. Лаптева · 0 подписок на этих ценах`,
    );
    await expect(items.nth(1)).toContainText(`01.10.2026 — до ${from}`);
    expect((await listed()).find((v) => v.version === next)?.state).toBe('scheduled');

    // Отмена своей версии: v2 снова без даты окончания, следующий номер — после отменённой.
    await banner.getByRole('button', { name: 'Отменить версию' }).click();
    const c = confirmDialog(page, `Отменить версию v${next}?`);
    await expect(c).toContainText('Она ещё не начала действовать.');
    await c.getByRole('button', { name: 'Отменить версию' }).click();
    await expect(root.getByRole('status').filter({ hasText: 'Запланирована' })).toHaveCount(0);
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('01.10.2026 — сейчас');
    await expect(
      root.getByRole('button', { name: `Подготовить версию v${next + 1}` }),
    ).toBeVisible();
    expect((await listed()).find((v) => v.version === next)?.state).toBe('cancelled');
  });
});
