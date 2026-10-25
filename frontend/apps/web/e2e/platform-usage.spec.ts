// W4.61 · e2e страницы `platform-usage` — «Использование» оператора (эталон design-2026-10-19, «Ортус CRM.dc.html»
// pg.usage :869–943, usageVM :3751–3805; чек-лист docs/plan/analysis/04-platform.md §8 п. 15–20, обязательные пункты
// verification-protocol.md §1.3). Данные — getPlatformUsage сценарного сервера (только метаданные control DB).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import {
  gbText,
  mskLastDayText,
  openPlatform,
  platformUsage,
  platformUsageFull,
  type PlatformUsageDto,
  section,
  textOf,
} from './billing.helpers.ts';
import { hitHeight, noHorizontalScroll } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const H1 = { level: 1, name: 'Использование' } as const;
const NOTE =
  'Только метаданные: места, объём файлов, подключённые модули и даты входа. Содержимое организаций оператору не видно.';

test.describe('platform-usage — «Использование» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'данные сида MSW и сценарии — режим mock');
  // Под нагрузкой общей машины вход и холодная загрузка страницы занимают до 30 с.
  test.describe.configure({ timeout: 60_000 });

  test('меню «Использование» и прямой URL: заголовок, надзаголовок, описание, data-screen-label', async ({
    app,
    page,
  }) => {
    await app('/platform/tenants', { persona: 'operator' });
    await page.setViewportSize({ width: 1440, height: 900 });
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('button', { name: 'Использование' }).click();
    await expect(page).toHaveURL(/\/platform\/usage$/);
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByRole('button', { name: 'Использование' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const root = section(page, 'h-usage');
    await expect(root).toHaveAttribute('data-screen-label', 'Оператор · использование');
    await expect(root).toContainText('Платформа Ортус');
    await expect(root.getByText(NOTE)).toBeVisible();
    await page.goto('/platform/usage');
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
  });

  test('плитки сводки: организации по статусам, места, хранилище, входы за 7 дней (04 §8 п. 15)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'usage');
    const tiles = root.locator('.ox-us-tile');
    await expect(tiles).toHaveCount(4);
    const u = await platformUsage(page);
    const expected = [
      'Организации 4 Пробный период: 1 · Действует: 1 · Ограничен: 1 · Приостановлен: 1',
      'Места с входом 59 из 70 занято 84% проданных мест',
      'Хранилище 141,4 из 275 ГБ занято 51% выделенного места',
      `Входили за 7 дней ${u.summary.activeMembers7d} из ${u.summary.activeMembers} активных участников организаций`,
    ];
    for (const [i, text] of expected.entries()) expect(await textOf(tiles.nth(i))).toBe(text);
  });

  test('«Требуют внимания»: счётчик и семь сигналов в порядке эталона (04 §8 п. 16)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'usage');
    const card = root.locator('.ox-us-signals');
    await expect(card.getByRole('heading', { level: 2, name: 'Требуют внимания' })).toBeVisible();
    await expect(card.locator('.ox-us-count')).toHaveText('7');
    const rows = card.locator('.ox-us-signal');
    await expect(rows).toHaveCount(7);
    const expected = [
      ['Альта Групп', 'Места почти закончились: 9 из 10', 'Карточка'],
      [
        'SPA «Лотос»',
        'Места почти закончились: 23 из 25. Заявка SR-12 ждёт решения',
        'Открыть заявку',
      ],
      ['Ремстрой Плюс', 'Хранилище заполнено на 79%: 19,8 из 25 ГБ', 'Карточка'],
      ['Ремстрой Плюс', 'Ограничен: пробный период закончился 20.09.2026, оплаты нет', 'Карточка'],
      ['Карго Сити', 'Места почти закончились: 22 из 25', 'Карточка'],
      ['Карго Сити', 'Приостановлен. Последний вход 13 дн. назад', 'Карточка'],
      ['Альта Групп', 'Пробный период заканчивается 13.10.2026, через 12 дн.', 'Карточка'],
    ] as const;
    for (const [i, [org, text, act]] of expected.entries()) {
      const row = rows.nth(i);
      await expect(row.locator('.ox-us-signal-org')).toHaveText(org);
      await expect(row.locator('.ox-us-signal-text')).toHaveText(text);
      await expect(row.getByRole('button')).toHaveText(act);
    }
  });

  test('«Открыть заявку» ведёт в «Заявки на тариф», «Карточка» — в «Организации» с выбранной (04 §8 п. 17)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'usage');
    await root.getByRole('button', { name: 'Открыть заявку' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Заявки на изменение тарифа' }),
    ).toBeVisible();
    const back = await openPlatform(app, page, 'usage');
    const u = await platformUsage(page);
    const cargo = u.tenants.find((t) => t.name === 'Карго Сити')?.tenantId ?? '';
    await back
      .locator('.ox-us-signal')
      .filter({ hasText: 'Карго Сити' })
      .first()
      .getByRole('button', { name: 'Карточка' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/platform/tenants\\?org=${cargo}$`));
    await expect(page.getByRole('complementary', { name: 'Карго Сити' })).toBeVisible();
  });

  test('«Отраслевые модули»: три модуля каталога, места и файлы, чипы организаций (04 §8 п. 18)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'usage');
    const card = root.locator('.ox-us-modules');
    await expect(card.getByRole('heading', { level: 2, name: 'Отраслевые модули' })).toBeVisible();
    await expect(card).toContainText('Базовые модули включены у всех организаций');
    const mods = card.locator('.ox-us-module');
    await expect(mods).toHaveCount(3);
    expect(await textOf(mods.nth(0))).toBe(
      'local_shippingЛогистика1 из 4 мест: 22 · файлов: 63 ГБ Карго Сити',
    );
    expect(await textOf(mods.nth(1))).toBe(
      'spaСалон и SPA2 из 4 мест: 32 · файлов: 58,6 ГБ Альта ГруппSPA «Лотос»',
    );
    expect(await textOf(mods.nth(2))).toBe(
      'constructionРемонт и стройка1 из 4 мест: 5 · файлов: 19,8 ГБ Ремстрой Плюс',
    );
    await mods.nth(1).getByRole('button', { name: 'SPA «Лотос»' }).click();
    await expect(page.getByRole('complementary', { name: 'SPA «Лотос»' })).toBeVisible();
  });

  test('«По организациям»: сортировки и колонки, Карго «0 из 22» красным (04 §8 п. 19)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'usage');
    const sorts = root.getByRole('group', { name: 'Сортировка' });
    await expect(sorts.getByRole('button')).toHaveText([
      'По местам',
      'По хранилищу',
      'По активности',
      'По названию',
    ]);
    await expect(sorts.getByRole('button', { name: 'По местам' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const table = root.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText([
      'Организация',
      'Тариф',
      'Места',
      'Хранилище',
      'Модули',
      'Входили за 7 дней',
    ]);
    const names = table.locator('tbody tr .ox-us-org-name');
    await expect(names).toHaveText(['SPA «Лотос»', 'Альта Групп', 'Карго Сити', 'Ремстрой Плюс']);
    const cargo = table.locator('tbody tr').filter({ hasText: 'Карго Сити' });
    await expect(cargo.locator('.ox-us-act')).toHaveText('0 из 22');
    await expect(cargo.locator('.ox-us-last')).toHaveText('последний вход 13 дн. назад');
    await expect(cargo.locator('.ox-us-last')).toHaveCSS('color', 'rgb(161, 58, 51)');
    await sorts.getByRole('button', { name: 'По названию' }).click();
    await expect(names).toHaveText(['Альта Групп', 'Карго Сити', 'Ремстрой Плюс', 'SPA «Лотос»']);
    await sorts.getByRole('button', { name: 'По хранилищу' }).click();
    await expect(names.first()).toHaveText('Ремстрой Плюс');
    await names.first().click();
    await expect(page.getByRole('complementary', { name: 'Ремстрой Плюс' })).toBeVisible();
  });

  test('загрузка: скелетон области под заголовком, без текста загрузки оболочки (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'usage');
    await devScenario(page, { scenario: 'getPlatformUsage=delay=2000' });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Использование' })).toBeVisible({
      timeout: 15_000,
    });
    const root = section(page, 'h-usage');
    await expect(root.getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(root).not.toContainText('Загружаем рабочее пространство');
    await expect(root.locator('.ox-us-tile')).toHaveCount(4, { timeout: 10_000 });
    await devScenario(page, { scenario: null });
  });

  test('ошибка загрузки: alert и «Повторить» (no-reference)', async ({ app, page }) => {
    await openPlatform(app, page, 'usage');
    await devScenario(page, { scenario: 'getPlatformUsage=rate_limited', once: true });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Использование' })).toBeVisible({
      timeout: 15_000,
    });
    const alert = section(page, 'h-usage').getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить данные: Слишком много запросов', {
      timeout: 15_000,
    });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(section(page, 'h-usage').locator('.ox-us-tile')).toHaveCount(4);
  });

  // Возврат 1 (ревью, minor): офлайн-чтение и 403 — текст раздела (бриф §5), как «Заявки на тариф».
  test('нет связи при чтении: alert «Нет связи с сервером…» и «Повторить» (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'usage');
    await devScenario(page, { scenario: 'getPlatformUsage=offline' });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Использование' })).toBeVisible({
      timeout: 15_000,
    });
    const alert = section(page, 'h-usage').getByRole('alert');
    await expect(alert).toContainText(
      'Не удалось загрузить данные: Нет связи с сервером. Проверьте подключение.',
      { timeout: 15_000 },
    );
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(section(page, 'h-usage').locator('.ox-us-tile')).toHaveCount(4);
  });

  test('нет права (403): текст раздела вместо данных, без «Повторить» (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'usage');
    await devScenario(page, { scenario: 'getPlatformUsage=forbidden_action' });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Использование' })).toBeVisible({
      timeout: 15_000,
    });
    const root = section(page, 'h-usage');
    await expect(
      root.getByText(
        'Нет права на использование платформы: раздел доступен всем ролям операторов платформы.',
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(root.getByRole('alert')).toHaveCount(0);
    await expect(root.locator('.ox-us-tile')).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('390: без горизонтальной прокрутки страницы, таблица прокручивается в своей рамке, цели ≥ 44 px', async ({
    app,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const root = await openPlatform(app, page, 'usage');
    expect(await noHorizontalScroll(page)).toBe(true);
    const wrap = root.locator('.ox-us-table-wrap');
    const [scroll, client] = await wrap.evaluate((e) => [e.scrollWidth, e.clientWidth]);
    expect(scroll).toBeGreaterThan(client);
    expect(await hitHeight(root.getByRole('button', { name: 'По местам' }))).toBeGreaterThanOrEqual(
      44,
    );
    expect(
      await hitHeight(root.getByRole('button', { name: 'Открыть заявку' })),
    ).toBeGreaterThanOrEqual(44);
    const bottom = page.getByRole('navigation', { name: 'Навигация', exact: true });
    await expect(bottom.getByRole('button', { name: 'Использование' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('клавиатура: Tab по сортировкам, фокус виден, Enter сортирует', async ({ app, page }) => {
    const root = await openPlatform(app, page, 'usage');
    await root.getByRole('button', { name: 'По местам' }).focus();
    await page.keyboard.press('Tab');
    const storage = root.getByRole('button', { name: 'По хранилищу' });
    await expect(storage).toBeFocused();
    expect(await storage.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(storage).toHaveAttribute('aria-pressed', 'true');
  });

  test('axe: нет нарушений serious/critical', async ({ app, page, axe }) => {
    await openPlatform(app, page, 'usage');
    const r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });

  test('не оператор: /platform/usage — «Страница не найдена»', async ({ app, page }) => {
    await app('/platform/usage', { persona: 'owner' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Страница не найдена' }),
    ).toBeVisible();
  });
});

const DASH = '—';

/** Подписи статусов организаций (TENANT_STATE эталона; grace и read_only — «Ограничен», Q-W1.25-4). */
const STATUS_LABEL: Readonly<Record<string, string>> = {
  trial: 'Пробный период',
  active: 'Действует',
  grace: 'Ограничен',
  read_only: 'Ограничен',
  suspended: 'Приостановлен',
  provisioning: 'Создаётся',
  closing: 'Закрывается',
  closed: 'Закрыта',
};

/** Отраслевые модули каталога в порядке INDUSTRY эталона (models.js) и их подписи. */
const CATALOG = ['fleet', 'spa', 'repairs'] as const;
const MODULE_NAME: Readonly<Record<string, string>> = {
  fleet: 'Логистика',
  spa: 'Салон и SPA',
  repairs: 'Ремонт и стройка',
};
/** Модуль вне словаря страница показывает ключом — так и в сверке, без «undefined». */
const moduleName = (key: string): string => MODULE_NAME[key] ?? key;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Страница «Использование» стенда совпадает с ответом getPlatformUsage, который она читает: плитки, сигналы
 * «Требуют внимания», отраслевые модули и строки «По организациям».
 */
async function expectUsageMatches(page: Page, root: Locator, u: PlatformUsageDto): Promise<void> {
  const s = u.summary;
  const tiles = root.locator('.ox-us-tile');
  await expect(tiles).toHaveCount(4);
  // Статусы организаций — из tenantsByStatus ответа в его порядке; grace и read_only — одна подпись «Ограничен».
  const byLabel = new Map<string, number>();
  for (const x of s.tenantsByStatus) {
    const label = STATUS_LABEL[x.status] ?? x.status;
    byLabel.set(label, (byLabel.get(label) ?? 0) + x.count);
  }
  const statuses = [...byLabel].map(([label, n]) => `${label}: ${n}`).join(' · ');
  expect(await textOf(tiles.nth(0))).toBe(`Организации ${s.tenantCount} ${statuses}`);
  expect(await textOf(tiles.nth(1))).toBe(
    `Места с входом ${s.seatsUsed} из ${s.seatsSold} занято ${Math.round((s.seatsUsed / s.seatsSold) * 100)}% проданных мест`,
  );
  expect(await textOf(tiles.nth(2))).toBe(
    `Хранилище ${gbText(s.storageUsedBytes)} из ${gbText(s.storageQuotaBytes)} ГБ занято ${Math.round((s.storageUsedBytes / s.storageQuotaBytes) * 100)}% выделенного места`,
  );
  expect(await textOf(tiles.nth(3))).toBe(
    `Входили за 7 дней ${s.activeMembers7d} из ${s.activeMembers} активных участников организаций`,
  );

  // «Требуют внимания»: сигналы ответа (у приостановленной «никто не входил» не показывается, Q-W4.61-5).
  const card = root.locator('.ox-us-signals');
  const suspended = new Set(u.signals.filter((x) => x.kind === 'suspended').map((x) => x.tenantId));
  const shown = u.signals.filter((x) => !(x.kind === 'inactive' && suspended.has(x.tenantId)));
  await expect(card.locator('.ox-us-count')).toHaveText(String(shown.length));
  const signals = card.locator('.ox-us-signal');
  await expect(signals).toHaveCount(shown.length);
  const signal = (org: string, text: string | RegExp) =>
    signals
      .filter({ has: page.locator('.ox-us-signal-org', { hasText: org }) })
      .filter({ has: page.locator('.ox-us-signal-text', { hasText: text }) });
  await expect(signal('Карго Сити', 'Приостановлен. Последний вход неизвестен')).toHaveCount(1);
  const storage = u.signals.find((x) => x.kind === 'storage_high');
  expect(storage?.tenantName).toBe('Ремстрой Плюс');
  await expect(
    signal(
      'Ремстрой Плюс',
      `Хранилище заполнено на ${storage?.storagePercent}%: ${gbText(storage?.storageUsedBytes ?? 0)} из ${gbText(storage?.storageQuotaBytes ?? 0)} ГБ`,
    ),
  ).toHaveCount(1);
  // Дата конца пробного «Ремстроя» на стенде не приходит (Q-W4.71-1) — проверяется начало подписи.
  await expect(signal('Ремстрой Плюс', 'Ограничен: пробный период закончился')).toHaveCount(1);
  // Конец пробного: сигнал есть, только пока до конца срока не больше 14 дней (backend usage.go trialEndingDays).
  // В полном e2e-stand platform-org-card @stand раньше продлевает пробный «Альты» за этот порог — сигнала нет.
  const endings = u.signals.filter((x) => x.kind === 'trial_ending');
  for (const e of endings) {
    await expect(
      signal(
        e.tenantName,
        `Пробный период заканчивается ${mskLastDayText(e.trialEndsAt ?? '')}, через ${e.daysLeft} дн.`,
      ),
    ).toHaveCount(1);
  }
  if (!endings.some((x) => x.tenantName === 'Альта Групп')) {
    await expect(signal('Альта Групп', 'Пробный период заканчивается')).toHaveCount(0);
  }

  // «Отраслевые модули»: три модуля каталога в порядке эталона, числа и организации — из ответа.
  const mods = root.locator('.ox-us-modules .ox-us-module');
  await expect(mods).toHaveCount(CATALOG.length);
  for (const [i, key] of CATALOG.entries()) {
    const m = u.modules.find((x) => x.moduleKey === key);
    const mod = mods.nth(i);
    expect(await textOf(mod)).toContain(
      `${moduleName(key)}${m?.tenantCount ?? 0} из ${s.tenantCount} мест: ${m?.seatsUsed ?? 0} · файлов: ${gbText(m?.storageUsedBytes ?? 0)} ГБ`,
    );
    await expect(mod.getByRole('button')).toHaveText((m?.tenants ?? []).map((t) => t.name));
  }

  // «По организациям»: строки ответа, сортировка «По местам», ячейки — по ответу (пусто — «—», как на странице).
  await expect(
    root.getByRole('group', { name: 'Сортировка' }).getByRole('button', { name: 'По местам' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const rows = root.getByRole('table').locator('tbody tr');
  await expect(rows).toHaveCount(u.tenants.length);
  for (const t of u.tenants) {
    const row = rows.filter({
      has: page.getByRole('button', { name: new RegExp(`^${escapeRegExp(t.name)}`) }),
    });
    const cells = row.locator('td');
    await expect(cells.nth(1)).toHaveText(t.tierName ?? DASH);
    await expect(cells.nth(2)).toHaveText(
      t.seats.limit === null ? String(t.seats.used) : `${t.seats.used} из ${t.seats.limit}`,
    );
    await expect(cells.nth(3)).toHaveText(
      `${gbText(t.storageUsedBytes)} из ${gbText(t.storageQuotaBytes)} ГБ`,
    );
    await expect(cells.nth(4)).toHaveText(t.moduleKeys.map(moduleName).join(', ') || DASH);
  }
  const top = [...u.tenants].sort((a, b) => b.seats.used - a.seats.used)[0];
  await expect(rows.first()).toContainText(top?.name ?? '');
}

test.describe('platform-usage — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.describe.configure({ timeout: 90_000 });

  test('оператор стенда: «Использование» — плитки, сигналы, модули и таблица по метаданным control DB', async ({
    app,
    page,
  }) => {
    // W4.71 (Q-W4.61-20): четыре организации Go-сида со статусами пробный/действует/ограничен/приостановлен и снимки
    // tenant_usage_daily (backend/cmd/seed/billing.go). Места, квоты, модули, дни входа и срок пробного «Альты»
    // меняют другие строки полного прогона и часы стенда, поэтому числа сверяются с ответом getPlatformUsage,
    // который читает страница. Данные строка не меняет: «Карточка» сигнала — только переход.
    const root = await openPlatform(app, page, 'usage');
    const u = await platformUsageFull(page);
    await expectUsageMatches(page, root, u);

    // «Карточка» сигнала ведёт в «Организации» с выбранной организацией.
    const cargo = u.tenants.find((t) => t.name === 'Карго Сити')?.tenantId ?? '';
    await root
      .locator('.ox-us-signal')
      .filter({ has: page.locator('.ox-us-signal-org', { hasText: 'Карго Сити' }) })
      .filter({ has: page.locator('.ox-us-signal-text', { hasText: 'Приостановлен' }) })
      .getByRole('button', { name: 'Карточка' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/platform/tenants\\?org=${cargo}$`));
    await expect(page.getByRole('complementary', { name: 'Карго Сити' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('оператор стенда: пробный «Альты» дальше 14 дней — сигнала «Пробный период заканчивается» нет', async ({
    app,
    page,
  }) => {
    // Возврат 2 (ревью, major): в полном e2e-stand platform-org-card @stand идёт раньше (порядок файлов) и продлевает
    // пробный «Альты» на 14 дней дважды за проект — срок дальше порога 14 дней (backend usage.go trialEndingDays),
    // сигнала trial_ending в ответе нет. Состояние стенда после тех строк — ответ стенда без trial_ending, без
    // правки данных; страница и сверка читают один и тот же ответ.
    await page.route(
      (url) => url.pathname === '/api/v1/platform/usage',
      async (route) => {
        const r = await route.fetch();
        const body = (await r.json()) as PlatformUsageDto;
        body.signals = body.signals.filter((x) => x.kind !== 'trial_ending');
        await route.fulfill({ response: r, json: body });
      },
    );
    const root = await openPlatform(app, page, 'usage');
    const u = await platformUsageFull(page);
    expect(u.signals.filter((x) => x.kind === 'trial_ending')).toEqual([]);
    await expectUsageMatches(page, root, u);
    await expect(
      root
        .locator('.ox-us-signal')
        .filter({ has: page.locator('.ox-us-signal-org', { hasText: 'Альта Групп' }) })
        .filter({ hasText: 'Пробный период заканчивается' }),
    ).toHaveCount(0);
  });
});
