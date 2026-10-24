// W1.23 · e2e страницы `company-roles`: «Пользователи и роли» → «Роли» — список ролей, RoleEditor, «Итоговые
// права роли», сохранение с ревизией (эталон design-stage-1, «Ортус CRM.dc.html» :334–398, roleEditorVM
// :3168–3216; чек-лист docs/plan/analysis/02-company.md §10 #28–#33; #28а — out-of-stage до этапа 5, §6.12).
import type { runAxe } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import {
  dialog,
  noHorizontalScroll,
  openUsers,
  roleButton,
  runTag,
  tab,
  toast,
} from './people.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const editor = (page: Page) => page.getByRole('region', { name: 'Редактор роли' });
const summary = (page: Page) => page.getByRole('complementary', { name: 'Итоговые права роли' });
const sw = (page: Page, name: string) =>
  page.getByRole('switch', { name: `Доступ роли к модулю ${name}` });

/**
 * Перезагрузка страницы: вкладка «Роли» остаётся выбранной (?tab=roles). Повторная загрузка приложения (скелетон
 * «Загружаем рабочее пространство…» до /me/context) ограничена таймаутом теста, как первый вход в openApp
 * (e2e-kit), а не 5 с ожидания expect (W2.81, возврат 2); выбор вкладки проверяется обычным ожиданием.
 */
async function expectRolesTabAfterReload(page: Page) {
  await page.reload();
  await tab(page, 'Роли').waitFor();
  await expect(tab(page, 'Роли')).toHaveAttribute('aria-selected', 'true');
}

/**
 * Нарушения axe serious/critical на странице — после загрузки шрифтов (W2.81, возврат 2): пока шрифт значков
 * грузится, axe проверяет лигатуру значка как текст запасным шрифтом (color-contrast на #8A968F).
 */
async function seriousOf(page: Page, axe: typeof runAxe) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const r = await axe(page);
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test.describe('company-roles — роли и редактор @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');

  test('открывается вкладкой «Роли» и по адресу ?tab=roles', async ({ app, page }) => {
    await openUsers(app, page);
    await tab(page, 'Роли').click();
    await expect(page).toHaveURL(/\?tab=roles/);
    await expect(roleButton(page, 'Менеджер логистики')).toBeVisible();
    await expectRolesTabAfterReload(page);
  });

  // W2.81, возврат 2: у проверяющего строка выше на 390 под нагрузкой красная в 3 из 4 прогонов — после
  // page.reload() скелетон «Загружаем рабочее пространство…» держится дольше 5 с ожидания expect. Медленный
  // /me/context (6 с) воспроизводит это без нагрузки.
  test('после перезагрузки рабочее пространство грузится дольше 5 с — вкладка «Роли» сохраняется', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await devScenario(page, { scenario: 'getMyContext=delay=6000', once: true });
    await expectRolesTabAfterReload(page);
  });

  test('список ролей: чипы и «{n} разрешений · назначена: {k}», выбрана «Менеджер логистики» (#28)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await expect(page.getByRole('button', { name: 'Создать роль' })).toBeVisible();
    await expect(roleButton(page, 'Владелец бизнеса')).toHaveText(
      'Владелец бизнесаСистемная Все права · назначена: 1',
    );
    await expect(roleButton(page, 'Менеджер логистики')).toHaveText(
      'Менеджер логистикиШаблон 34 разрешений · назначена: 0',
    );
    await expect(roleButton(page, 'Менеджер логистики')).toHaveAttribute('aria-pressed', 'true');
    await expect(roleButton(page, 'Водитель')).toHaveText(
      'ВодительШаблон 17 разрешений · назначена: 1',
    );
    await expect(roleButton(page, 'Руководитель проекта')).toHaveText(
      'Руководитель проектаШаблон 12 разрешений · назначена: 1',
    );
    await expect(page.locator('[aria-pressed]').filter({ hasText: 'разрешений' })).toHaveCount(8);
  });

  test('редактор «Менеджер логистики»: логистика не подключена, действия, финансы, итог (#29)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await expect(editor(page).getByLabel('Название роли')).toHaveValue('Менеджер логистики');
    const fleet = sw(page, 'Логистика');
    await expect(fleet).toHaveAttribute('aria-checked', 'true');
    await expect(fleet).toBeDisabled();
    await expect(editor(page)).toContainText(
      'Модуль не подключён организацией — включение недоступно',
    );
    for (const v of ['Просматривать', 'Изменять', 'Проверять', 'Настраивать']) {
      await expect(editor(page).getByRole('checkbox', { name: v }).first()).toBeChecked();
    }
    const fin = editor(page).getByRole('group', { name: 'Финансовые разрешения' });
    await expect(fin.getByRole('checkbox', { name: /Видеть начисления водителям/ })).toBeChecked();
    await expect(fin.getByRole('checkbox', { name: /Управлять начислениями/ })).not.toBeChecked();
    await expect(fin).toContainText('fleet.earnings.read');
    await expect(summary(page)).toContainText('Роль пока никому не назначена');
    await expect(summary(page)).toContainText('fleet.trips.review');
    await expect(summary(page)).toContainText('Начисления видны в области назначения');
    await expect(summary(page)).toContainText('Данные других организаций недоступны');
  });

  test('переключатель «Задачи»: «Нет доступа», несохранённые изменения, «Отменить» (#30)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    const tasks = sw(page, 'Задачи');
    await expect(tasks).toHaveAttribute('aria-checked', 'true');
    await tasks.click();
    await expect(tasks).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Есть несохранённые изменения')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отменить' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Сохранить роль' })).toBeEnabled();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(tasks).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'Сохранить роль' })).toBeDisabled();
    await expect(page.getByText('Есть несохранённые изменения')).toHaveCount(0);
    // Возврат 16.10 №3 (major): кнопки подвала — aria-disabled, не disabled; после «Отменить» фокус — на поле
    // «Название роли», а не на body.
    await expect(page.getByRole('button', { name: 'Отменить' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Отменить' })).not.toHaveAttribute('disabled');
    await expect(editor(page).getByLabel('Название роли')).toBeFocused();
  });

  // Возврат 16.10 №2: черновик роли живёт в состоянии страницы, как roleDraft эталона, — смена вкладки его не теряет.
  test('несохранённая правка роли переживает смену вкладки «Роли» → «Люди» → «Роли»', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await roleButton(page, 'Менеджер логистики').waitFor();
    await sw(page, 'Задачи').click();
    await expect(page.getByText('Есть несохранённые изменения')).toBeVisible();
    await tab(page, 'Люди').click();
    await expect(page.getByRole('list', { name: 'Участники' })).toBeVisible();
    await tab(page, 'Роли').click();
    await expect(sw(page, 'Задачи')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Есть несохранённые изменения')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить роль' })).toBeEnabled();
  });

  test('«Водитель»: функция «Водитель», финансы недоступны (#31)', async ({ app, page }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await roleButton(page, 'Водитель').click();
    await expect(editor(page)).toContainText(
      'Профессиональная функция «Водитель». Начисления запрещены через эту и любую другую роль или группу.',
    );
    const fin = editor(page).getByRole('group', { name: 'Финансовые разрешения' });
    await expect(fin.getByRole('checkbox', { name: /Видеть начисления водителям/ })).toBeDisabled();
    await expect(fin).toContainText('Роль с функцией «Водитель» не может содержать начисления');
  });

  // Возврат 16.10 №1 (blocker): у «Водителя» задачи и календарь выданы частично — переименование их не снимает,
  // выключение «Задач» не выключает «Календарь»; включённый модуль — «{k ≥ 1} из {M}» (roleEditorVM :3182).
  // W2.81: ключей 17 — W2.71 (S2-20, D-35) добавил в шаблон fleet.reservations.choose (выбор предложенной машины).
  test('«Водитель»: переименование сохраняет все 17 ключей; «Задачи» выключаются отдельно', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await roleButton(page, 'Водитель').click();
    await expect(editor(page).getByLabel('Название роли')).toHaveValue('Водитель');
    const keys = summary(page).locator('code');
    await expect(keys).toHaveCount(17);
    const before = await keys.allTextContents();
    expect(before).toEqual(
      expect.arrayContaining([
        'tasks.read',
        'calendar.availability.read',
        'fleet.reservations.choose',
      ]),
    );
    await expect(editor(page)).not.toContainText(/\b0 из \d+ действий/);
    await expect(sw(page, 'Календарь')).toHaveAttribute('aria-checked', 'true');
    await sw(page, 'Задачи').click();
    await expect(sw(page, 'Задачи')).toHaveAttribute('aria-checked', 'false');
    await expect(sw(page, 'Календарь')).toHaveAttribute('aria-checked', 'true');
    await expect(summary(page)).toContainText('calendar.availability.read');
    await page.getByRole('button', { name: 'Отменить' }).click();
    await editor(page).getByLabel('Название роли').fill('Водитель рейса');
    await page.getByRole('button', { name: 'Сохранить роль' }).click();
    await expect(toast(page)).toHaveText('Роль «Водитель рейса» сохранена');
    await expect(roleButton(page, 'Водитель рейса')).toContainText('17 разрешений');
    expect(await keys.allTextContents()).toEqual(before);
  });

  test('пустой список ролей: «Создать роль» и текст пустого состояния', async ({ app, page }) => {
    await openUsers(app, page);
    await devScenario(page, { scenario: 'listRoles=empty' });
    await page.goto(page.url().replace(/\/users.*$/, '/users?tab=roles'));
    await expect(page.getByText('Ролей пока нет. Создайте первую роль.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Создать роль' })).toBeVisible();
  });

  test('«Владелец бизнеса»: системная роль не редактируется (#32)', async ({ app, page }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await roleButton(page, 'Владелец бизнеса').click();
    await expect(editor(page).getByLabel('Название роли')).toBeDisabled();
    // Возврат 16.10 №1: поле системной роли не бледнеет — тёмный текст 500/#3A4844, как у подписи (:347).
    const look = await editor(page)
      .getByLabel('Название роли')
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.opacity, s.color, s.fontWeight];
      });
    expect(look).toEqual(['1', 'rgb(58, 72, 68)', '500']);
    await expect(editor(page)).toContainText(
      'Системная роль: все модули и области организации. Не редактируется и защищает от потери доступа последним владельцем.',
    );
    await expect(editor(page).getByRole('heading', { name: 'Модули и действия' })).toHaveCount(0);
    await expect(summary(page).locator('code')).toHaveText(['*']);
  });

  test('сохранение: новое имя — тост «Роль «…» сохранена»', async ({ app, page }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await roleButton(page, 'Прораб').click();
    await editor(page).getByLabel('Название роли').fill('Прораб участка');
    await page.getByRole('button', { name: 'Сохранить роль' }).click();
    await expect(toast(page)).toHaveText('Роль «Прораб участка» сохранена');
    await expect(roleButton(page, 'Прораб участка')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Есть несохранённые изменения')).toHaveCount(0);
    // Возврат 16.10 №3 (major): после «Сохранить роль» фокус — на «Название роли»; Tab ведёт дальше по редактору.
    await expect(editor(page).getByLabel('Название роли')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await editor(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
  });

  // Возврат 16.10 №3 (minor): «Итоговые права роли» — в порядке модулей редактора (rolePermKeys эталона).
  test('«Итоговые права роли»: ключи в порядке модулей — сначала логистика', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    const keys = await summary(page).locator('code').allTextContents();
    expect(keys[0]).toBe('fleet.vehicles.read');
    const firstOther = keys.findIndex((k) => !k.startsWith('fleet.'));
    expect(keys.slice(firstOther).filter((k) => /^fleet\.(?!earnings)/.test(k))).toEqual([]);
  });

  test('«Создать роль» → редактор новой роли «Своя», затем сохранение (#33)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await page.getByRole('button', { name: 'Создать роль' }).click();
    const dlg = dialog(page, 'Создать роль');
    await dlg.getByLabel('Название').fill('Диспетчер');
    await dlg.getByRole('radio', { name: /Из шаблона/ }).check();
    await dlg.getByRole('button', { name: 'Создать и настроить' }).click();
    await expect(toast(page)).toHaveText('Роль создана');
    await expect(page).toHaveURL(/tab=roles&role=/);
    await expect(roleButton(page, 'Диспетчер')).toHaveAttribute('aria-pressed', 'true');
    await expect(roleButton(page, 'Диспетчер')).toContainText('Своя');
    await expect(sw(page, 'Логистика')).toHaveAttribute('aria-checked', 'true');
    await editor(page).getByLabel('Название роли').fill('Диспетчер Север');
    await page.getByRole('button', { name: 'Сохранить роль' }).click();
    await expect(toast(page)).toHaveText('Роль «Диспетчер Север» сохранена');
  });

  test('конфликт ревизии: тост «Данные изменились…», роль перечитана', async ({ app, page }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await devScenario(page, { scenario: 'updateRole=revision_mismatch', once: true });
    await sw(page, 'Задачи').click();
    await page.getByRole('button', { name: 'Сохранить роль' }).click();
    await expect(toast(page)).toHaveText('Данные изменились. Обновите и повторите правку.');
    await expect(page.getByRole('button', { name: 'Сохранить роль' })).toBeEnabled();
  });

  test('клавиатура: Space переключает модуль, фокус виден', async ({ app, page }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    const tasks = sw(page, 'Задачи');
    await tasks.focus();
    await page.keyboard.press('Space');
    await expect(tasks).toHaveAttribute('aria-checked', 'false');
    const outline = await tasks.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('axe: список и редактор без serious/critical', async ({ app, page, axe }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await expect(editor(page)).toBeVisible();
    expect(await seriousOf(page, axe)).toEqual([]);
  });

  // W2.81, возврат 2: у проверяющего строка выше на 1440 красная в 2 из 3 прогонов под нагрузкой — color-contrast
  // serious на значках модулей (div[data-module] .material-symbols-rounded): пока шрифт значков грузится, axe
  // проверяет лигатуру («local_shipping») как текст запасным шрифтом. Догружающийся шрифт воспроизводится без
  // нагрузки: файл шрифта значков отвечает через 8 с. Маршрут — на контексте: запросы страницы проходят через
  // service worker MSW, page.route их не перехватывает.
  test('axe: список и редактор — проверка после загрузки шрифта значков', async ({
    app,
    page,
    axe,
  }) => {
    // Строка нарочно ждёт 8 с шрифта значков плюс axe: под нагрузкой не укладывается в 30 с.
    test.slow();
    await page.context().route('**/material-symbols-rounded.woff2*', async (route) => {
      await new Promise((r) => setTimeout(r, 8_000));
      await route.continue();
    });
    await openUsers(app, page, { query: 'tab=roles' });
    await expect(editor(page)).toBeVisible();
    const icons = () =>
      [...document.fonts]
        .filter((f) => f.family.replace(/"/g, '') === 'Material Symbols Rounded')
        .map((f) => f.status);
    expect(await page.evaluate(icons)).toEqual(['loading']);
    expect(await seriousOf(page, axe)).toEqual([]);
  });

  test('раскладка: 390 — список над редактором на всю ширину; 1440 — список 300 px слева', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    expect(await noHorizontalScroll(page)).toBe(true);
    const list = await roleButton(page, 'Менеджер логистики').boundingBox();
    const ed = await editor(page).boundingBox();
    if ((page.viewportSize()?.width ?? 0) >= 1080) {
      expect(list?.width).toBeLessThanOrEqual(300);
      expect((ed?.x ?? 0) > (list?.x ?? 0) + (list?.width ?? 0)).toBe(true);
    } else {
      expect((ed?.y ?? 0) > (list?.y ?? 0)).toBe(true);
    }
    // Возврат 16.10 №3 (minor): на узком экране цели нажатия не меньше 44 px (verification-protocol §1.3).
    if ((page.viewportSize()?.width ?? 0) < 640) {
      await sw(page, 'Задачи').click();
      const targets = [
        page.getByRole('button', { name: 'Создать роль' }),
        sw(page, 'Задачи'),
        editor(page)
          .getByRole('button', { name: /^(Показать|Свернуть) действия: / })
          .first(),
        editor(page)
          .locator('label')
          .filter({ has: page.getByRole('checkbox') })
          .first(),
        page.getByRole('button', { name: 'Отменить' }),
        page.getByRole('button', { name: 'Сохранить роль' }),
      ];
      for (const t of targets) {
        const box = await t.boundingBox();
        expect(
          box?.height,
          await t.evaluate((el) => el.outerHTML.slice(0, 80)),
        ).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

// W1.06 (roles) — в main: создание и сохранение роли на стенде (имя роли — своё у каждого проекта).
test.describe('company-roles — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('стенд: роли «Альты», создание из шаблона и сохранение', async ({ app, page }, testInfo) => {
    test.slow();
    await openUsers(app, page, { query: 'tab=roles' });
    await expect(roleButton(page, 'Владелец бизнеса')).toContainText('Системная');
    await expect(roleButton(page, 'Менеджер логистики')).toContainText('Шаблон');
    const name = `Диспетчер ${testInfo.project.name} ${runTag()}`;
    await page.getByRole('button', { name: 'Создать роль' }).click();
    const dlg = dialog(page, 'Создать роль');
    await dlg.getByLabel('Название').fill(name);
    await dlg.getByRole('radio', { name: /Из шаблона/ }).check();
    await dlg.getByRole('button', { name: 'Создать и настроить' }).click();
    await expect(toast(page)).toHaveText('Роль создана');
    await expect(roleButton(page, name)).toHaveAttribute('aria-pressed', 'true');
    await sw(page, 'Задачи').click();
    await page.getByRole('button', { name: 'Сохранить роль' }).click();
    await expect(toast(page)).toHaveText(`Роль «${name}» сохранена`);
  });
});
