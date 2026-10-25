// W1.25 · e2e страницы `platform-orgs` — «Организации-клиенты» оператора (эталон design-stage-1, «Ортус CRM.dc.html»
// pg.tenants :1529–1583, opVM :3532–3568; чек-лист docs/plan/analysis/04-platform.md §8 п. 7–8, обязательные пункты
// verification-protocol.md §1.3). W4.84: владелец, места и занятое место — данные W4.60 (эталон design-2026-10-19).
import { expect, test } from './fixtures/index.ts';
import {
  expectNoHorizontalScroll,
  expectTargets44,
  openOrgs,
  orgCard,
  orgRow,
  orgRows,
  orgsSection,
  ORGS,
  platformTenantId,
  platformTenants,
} from './platform-orgs.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const H1 = { level: 1, name: 'Организации-клиенты' } as const;
const INTRO =
  'Отдельное административное пространство. Оператор управляет подписками, пробными периодами, статусами и квотами, но не видит сотрудников, фото, склады и финансы клиентов.';

test.describe('platform-orgs — «Организации-клиенты» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'данные сида MSW и сценарии — режим mock');

  test('меню «Организации» и прямой URL: заголовок, надзаголовок, баннер, data-screen-label', async ({
    app,
    page,
  }) => {
    await app('/platform/usage', { persona: 'operator' });
    await page.setViewportSize({ width: 1440, height: 900 });
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('button', { name: 'Организации' }).click();
    await expect(page).toHaveURL(/\/platform\/tenants$/);
    await expect(page.getByRole('heading', H1)).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Организации' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const section = orgsSection(page);
    await expect(section).toHaveAttribute('data-screen-label', 'Оператор · организации');
    await expect(section).toContainText('Платформа Ортус');
    await expect(section.getByText(INTRO)).toBeVisible();
    await page.goto('/platform/tenants');
    await expect(page.getByRole('heading', H1)).toBeVisible();
  });

  test('список: четыре организации в порядке эталона, первая выбрана', async ({ app, page }) => {
    await openOrgs(app, page);
    await expect(orgRows(page)).toHaveCount(4);
    for (const [i, name] of ORGS.entries()) {
      await expect(orgRows(page).nth(i).locator('.ox-org-name')).toHaveText(name);
    }
    await expect(orgRows(page).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(orgRows(page).nth(1)).toHaveAttribute('aria-pressed', 'false');
  });

  test('строки: чип статуса и колонка пробного периода (04 §8 п. 8)', async ({ app, page }) => {
    await openOrgs(app, page);
    const expectRow = async (name: (typeof ORGS)[number], chip: string, trial: string) => {
      const row = orgRow(page, name);
      await expect(row.locator('.ox-chip-label')).toHaveText(chip);
      await expect(row.locator('.ox-org-trial')).toHaveText(trial);
    };
    await expectRow('Альта Групп', 'Пробный период', 'Осталось 12 дн. · до 13.10.2026');
    await expectRow('SPA «Лотос»', 'Действует', 'Не применяется');
    await expectRow('Ремстрой Плюс', 'Ограничен', 'Завершён 20.09.2026');
    await expectRow('Карго Сити', 'Приостановлен', 'Не применяется');
  });

  // W4.84: владелец и занятое — getPlatformUsage, места — Tenant.seats / Subscription.seats (эталон opVM :3545–3547).
  test('строки W4.84: владелец и места, занятое место, заливка полос', async ({ app, page }) => {
    await openOrgs(app, page);
    const expectRow = async (name: (typeof ORGS)[number], owner: string, usage: string) => {
      await expect(orgRow(page, name).locator('.ox-org-owner')).toHaveText(owner);
      await expect(orgRow(page, name).locator('.ox-org-usage')).toHaveText(usage);
    };
    await expectRow('Альта Групп', 'Владелец: Дарья Зимина · мест 9/10', '46,2 из 100 ГБ');
    await expectRow('SPA «Лотос»', 'Владелец: Ирина Белова · мест 23/25', '12,4 из 50 ГБ');
    await expectRow('Ремстрой Плюс', 'Владелец: Павел Орлов · мест 5/10', '19,8 из 25 ГБ');
    await expectRow('Карго Сити', 'Владелец: Денис Шишкин · мест 22/25', '63 из 100 ГБ');
    const fill = (name: (typeof ORGS)[number]) =>
      orgRow(page, name)
        .locator('.ox-orgs-bar-fill')
        .evaluate((e) => (e as HTMLElement).style.width);
    expect(await fill('Альта Групп')).toBe('46.2%');
    expect(await fill('Ремстрой Плюс')).toBe('79.2%');
    expect(await fill('Карго Сити')).toBe('63%');
    await expect(orgRow(page, 'Альта Групп').locator('.ox-orgs-bar')).toHaveAttribute(
      'data-tone',
      'accent',
    );
  });

  test('getPlatformUsage не ответил: владелец и занятое — «—», alert карточки и «Повторить» (no-reference)', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await devScenario(page, { scenario: 'getPlatformUsage=rate_limited' });
    await page.reload();
    await expect(orgRow(page, 'Альта Групп').locator('.ox-org-owner')).toHaveText(
      'Владелец: — · мест 9/10',
    );
    await expect(orgRow(page, 'Альта Групп').locator('.ox-org-usage')).toHaveText('— из 100 ГБ');
    const alert = orgCard(page, 'Альта Групп').getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить использование: ');
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(alert).toBeHidden();
    await expect(orgRow(page, 'Альта Групп').locator('.ox-org-owner')).toHaveText(
      'Владелец: Дарья Зимина · мест 9/10',
    );
  });

  test('выбор строки: aria-pressed, карточка выбранной, ?org= в адресе', async ({ app, page }) => {
    await openOrgs(app, page);
    const lotos = await platformTenantId(page, 'SPA «Лотос»');
    await orgRow(page, 'SPA «Лотос»').click();
    await expect(orgRow(page, 'SPA «Лотос»')).toHaveAttribute('aria-pressed', 'true');
    await expect(orgRow(page, 'Альта Групп')).toHaveAttribute('aria-pressed', 'false');
    await expect(orgCard(page, 'SPA «Лотос»')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/platform/tenants\\?org=${lotos}$`));
  });

  test('загрузка: скелетон строк списка до ответа listPlatformTenants, без текста загрузки оболочки', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    // Подписки и журнал отвечают позже списка: статусы «Загрузка» карточки живут вместе со скелетоном списка
    // и не должны с ним смешиваться (возврат 16.10 №2: нестабильный strict mode на общем role=status).
    await devScenario(page, {
      scenario:
        'listPlatformTenants=delay=1500, getPlatformSubscription=delay=3000, listPlatformAuditEvents=delay=3000',
    });
    await page.reload();
    const skeleton = orgsSection(page).locator('.ox-orgs-skeleton');
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute('role', 'status');
    await expect(skeleton).toHaveAccessibleName('Загрузка');
    await expect(orgsSection(page)).not.toContainText('Загружаем рабочее пространство');
    // Рамка скелетона — по высоте его четырёх строк, а не flex-basis 520px списка (возврат 16.10 №3).
    const frame = await skeleton.evaluate((e) => {
      const rows = Array.from(e.querySelectorAll('.ox-orgs-skeleton-row'));
      const inner = rows.reduce((s, r) => s + r.getBoundingClientRect().height, 0);
      return { height: e.getBoundingClientRect().height, inner };
    });
    expect(frame.height, 'высота рамки скелетона = строки + рамка 2 px').toBeLessThanOrEqual(
      frame.inner + 3,
    );
    // Ширина — колонка списка рядом с карточкой, а не вся область: раскладка после ответа не перестраивается
    // (возврат доделки №2, no-reference).
    const skeletonBox = await skeleton.boundingBox();
    await expect(skeleton).toBeHidden({ timeout: 10_000 });
    await expect(orgRows(page)).toHaveCount(4);
    const listBox = await orgsSection(page).locator('.ox-orgs-list').boundingBox();
    expect(
      Math.abs((skeletonBox?.width ?? 0) - (listBox?.width ?? -10)),
      'ширина скелетона = ширина списка',
    ).toBeLessThanOrEqual(1);
    expect(Math.abs((skeletonBox?.x ?? 0) - (listBox?.x ?? -10))).toBeLessThanOrEqual(1);
    await expect(orgCard(page).getByRole('status', { name: 'Загрузка' }).first()).toBeAttached();
    // Подписки ещё грузятся: колонки строк из подписки помечены загрузкой (скелетон), а не голое «—».
    for (const name of ORGS) {
      for (const cls of ['.ox-org-owner', '.ox-org-usage', '.ox-org-trial']) {
        await expect(orgRow(page, name).locator(cls)).toHaveAttribute('data-loading', 'true');
      }
    }
    await expect(orgRow(page, 'Альта Групп').locator('.ox-org-trial')).toHaveText(
      'Осталось 12 дн. · до 13.10.2026',
      { timeout: 10_000 },
    );
    await expect(orgsSection(page).locator('.ox-org-row [data-loading]')).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('prefers-reduced-motion: скелетоны списка, строк и журнала без пульса (no-reference)', async ({
    app,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openOrgs(app, page);
    await devScenario(page, {
      scenario:
        'listPlatformTenants=delay=1500, getPlatformSubscription=delay=4000, listPlatformAuditEvents=delay=4000',
    });
    await page.reload();
    const animation = (sel: string) =>
      orgsSection(page)
        .locator(sel)
        .evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
    const skeleton = orgsSection(page).locator('.ox-orgs-skeleton');
    await expect(skeleton).toBeVisible();
    const listBars = await animation(
      '.ox-orgs-skeleton .ox-skeleton-bar, .ox-orgs-skeleton-mark, .ox-org-card-skeleton .ox-skeleton-bar',
    );
    expect(listBars.length).toBeGreaterThan(0);
    expect(new Set(listBars), 'скелетон списка').toEqual(new Set(['none']));
    await expect(skeleton).toBeHidden({ timeout: 10_000 });
    await expect(orgCard(page).locator('.ox-audit-skeleton').first()).toBeVisible();
    const busy = await animation(
      '.ox-audit-skeleton, .ox-org-row [data-loading], .ox-org-card [data-loading]',
    );
    expect(busy.length).toBeGreaterThan(0);
    expect(new Set(busy), 'скелетоны журнала, строк и карточки').toEqual(new Set(['none']));
    await devScenario(page, { scenario: null });
  });

  test('ошибка подписок: строки — «Подписка не загружена»; «Повторить» карточки возвращает данные (no-reference)', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await devScenario(page, { scenario: 'getPlatformSubscription=rate_limited' });
    await page.reload();
    for (const name of ORGS) {
      await expect(orgRow(page, name).locator('.ox-org-trial')).toHaveText('Подписка не загружена');
    }
    await devScenario(page, { scenario: null });
    await orgCard(page, 'Альта Групп')
      .getByRole('alert')
      .getByRole('button', { name: 'Повторить' })
      .click();
    await expect(orgRow(page, 'SPA «Лотос»').locator('.ox-org-trial')).toHaveText('Не применяется');
    await expect(orgRow(page, 'Альта Групп').locator('.ox-org-trial')).toHaveText(
      'Осталось 12 дн. · до 13.10.2026',
    );
  });

  test('ошибка загрузки: alert и «Повторить» перечитывает список', async ({ app, page }) => {
    await openOrgs(app, page);
    await devScenario(page, { scenario: 'listPlatformTenants=rate_limited', once: true });
    await page.reload();
    const alert = orgsSection(page).getByRole('alert');
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'Повторить' }).focus();
    await page.keyboard.press('Enter');
    await expect(orgRows(page)).toHaveCount(4);
    // «Повторить» исчезает вместе с alert: фокус — на выбранной строке, а не на body (возврат доделки №2).
    await expect(orgRow(page, 'Альта Групп')).toBeFocused();
  });

  test('нет связи при загрузке списка: текст для чтения, без «Операция не выполнена» команд (no-reference)', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await devScenario(page, { scenario: 'listPlatformTenants=offline', once: true });
    await page.reload();
    const alert = orgsSection(page).getByRole('alert');
    await expect(alert.locator('span').first()).toHaveText(
      'Не удалось загрузить организации: Нет связи с сервером. Проверьте подключение.',
    );
    await expect(alert).not.toContainText('Операция не выполнена');
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(orgRows(page)).toHaveCount(4);
  });

  test('подписки строк загружаются: axe без serious/critical, «Загрузка» вместо «—» (no-reference)', async ({
    app,
    page,
    axe,
  }) => {
    await openOrgs(app, page);
    await devScenario(page, { scenario: 'getPlatformSubscription=loading' });
    await page.reload();
    await expect(orgRows(page)).toHaveCount(4);
    for (const name of ORGS) {
      const row = orgRow(page, name);
      await expect(row.locator('.ox-org-owner')).toHaveAttribute('data-loading', 'true');
      // Доступное имя строки: признак загрузки, а не «—» как данные.
      await expect(row).toHaveAccessibleName(/Загрузка/);
      await expect(row).not.toHaveAccessibleName(/—/);
    }
    const card = orgCard(page, 'Альта Групп');
    const busy = await card
      .locator('[data-loading]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    expect(busy.length, 'значения карточки из подписки — скелетон').toBeGreaterThan(0);
    for (const t of busy) expect(t).not.toContain('—');
    const r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await devScenario(page, { scenario: null });
  });

  test('пусто: «Организаций пока нет» (no-reference)', async ({ app, page }) => {
    await openOrgs(app, page);
    await devScenario(page, { scenario: 'listPlatformTenants=empty' });
    await page.reload();
    await expect(orgsSection(page).getByText('Организаций пока нет')).toBeVisible();
    await expect(orgRows(page)).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('390: без горизонтальной прокрутки, нижняя навигация «Организации», цели ≥ 44 px', async ({
    app,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOrgs(app, page);
    await expectNoHorizontalScroll(page);
    const bottom = page.getByRole('navigation', { name: 'Навигация', exact: true });
    await expect(bottom.getByRole('button', { name: 'Организации' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectTargets44(orgsSection(page));
    const list = await orgRows(page).first().boundingBox();
    const card = await orgCard(page).boundingBox();
    expect(card && list && card.y > list.y, 'карточка под списком на 390').toBe(true);
  });

  test('1440: список слева, карточка справа', async ({ app, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOrgs(app, page);
    const list = await orgRows(page).first().boundingBox();
    const card = await orgCard(page).boundingBox();
    expect(card && list && card.x > list.x + list.width - 1, 'карточка справа').toBe(true);
    await expectNoHorizontalScroll(page);
  });

  test('клавиатура: Tab по строкам, фокус виден, Enter выбирает организацию', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await orgRow(page, 'Альта Групп').focus();
    await page.keyboard.press('Tab');
    await expect(orgRow(page, 'SPA «Лотос»')).toBeFocused();
    const outline = await orgRow(page, 'SPA «Лотос»').evaluate(
      (e) => getComputedStyle(e).outlineStyle,
    );
    expect(outline).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(orgRow(page, 'SPA «Лотос»')).toHaveAttribute('aria-pressed', 'true');
  });

  test('axe: нет нарушений serious/critical', async ({ app, page, axe }) => {
    await openOrgs(app, page);
    const r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });

  test('не оператор: /platform/tenants — «Страница не найдена»', async ({ app, page }) => {
    await app('/platform/tenants', { persona: 'owner' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Страница не найдена' }),
    ).toBeVisible();
  });
});

test.describe('platform-orgs — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('оператор стенда: «Организации-клиенты», четыре организации сида и их чипы', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await expect(orgRows(page)).toHaveCount(4);
    await expect(orgRow(page, 'Альта Групп').locator('.ox-chip-label')).toHaveText(
      'Пробный период',
    );
    await expect(orgRow(page, 'SPA «Лотос»').locator('.ox-chip-label')).toHaveText('Действует');
    await expect(orgRow(page, 'Ремстрой Плюс').locator('.ox-chip-label')).toHaveText('Ограничен');
    await expect(orgRow(page, 'Карго Сити').locator('.ox-chip-label')).toHaveText('Приостановлен');
    await expect(orgRow(page, 'Ремстрой Плюс').locator('.ox-org-trial')).toHaveText(
      /^Завершён (\d\d\.\d\d\.\d{4}|—)$/,
    );
  });

  test('стенд: строки в порядке ответа listPlatformTenants, без ?org= выбрана первая (Q-W1.25-24)', async ({
    app,
    page,
  }) => {
    // backend W1.48 отдаёт список по (created_at, id); у сида время создания одно — порядок по id, а не эталона.
    await openOrgs(app, page);
    const order = [...(await platformTenants(page)).keys()];
    await expect(orgRows(page).locator('.ox-org-name')).toHaveText(order);
    await expect(orgRows(page).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(orgCard(page, order[0] as (typeof ORGS)[number])).toBeVisible();
  });

  test('стенд W4.84: владелец, места и занятое место строк из getPlatformUsage', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    for (const name of ORGS) {
      await expect(orgRow(page, name).locator('.ox-org-owner')).toHaveText(
        /^Владелец: .+ · мест \d+(\/\d+)?$/,
      );
      await expect(orgRow(page, name).locator('.ox-org-usage')).toHaveText(
        /^\d+(,\d)? из \d+(,\d)? ГБ$/,
      );
    }
    await expect(orgRow(page, 'Альта Групп').locator('.ox-org-owner')).toHaveText(
      /^Владелец: Дарья Зимина · /,
    );
  });

  test('стенд: меню «Организации» и выбор строки → ?org=', async ({ app, page }) => {
    await openOrgs(app, page);
    const cargo = await platformTenantId(page, 'Карго Сити');
    await orgRow(page, 'Карго Сити').click();
    await expect(page).toHaveURL(new RegExp(`\\?org=${cargo}$`));
    await expect(orgCard(page, 'Карго Сити')).toBeVisible();
  });
});
