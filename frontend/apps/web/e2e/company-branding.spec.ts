// W4.62 · e2e страницы `company-branding` «Оформление» (эталон design-2026-10-19 «Ортус CRM.dc.html» pg.branding
// :1253–1452, brandingVM :3681–3749; design/docs/18-branding.md). Пункты — WS-21 B-01…B-43 в редакции v2 и
// обязательные пункты verification-protocol §1.3. Режим stand — после backend W4.60 (тег Branding отвечает 501).
import {
  fileInput,
  fromMenu,
  hex,
  main,
  menuLabels,
  menuRow,
  nameField,
  palette,
  panel,
  phone,
  pngFile,
  preview,
  rootVar,
  save,
  shortField,
  swatch,
  termRow,
} from './company-branding.helpers.ts';
import { expect, test } from './_stand/fixtures.ts';
import { h1, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { devScenario, LOTOS } from './shell.helpers.ts';

const INTRO =
  'Название, логотип, цвет, термины и меню действуют для всего бизнеса: всех регионов, фирм и сотрудников. Права доступа от оформления не зависят. Каждый сотрудник может выбрать для себя светлую или тёмную тему, акцентный цвет сохраняется.';
const SAVED = 'Оформление сохранено и видно всем сотрудникам';
const PLUM = 'rgb(122, 62, 121)';
const ORTUS = 'rgb(31, 107, 82)';
/** «Версия 2 · изменено 10:30, Дарья Зимина» — время сохранения по часам харнесса (день сида или нет). */
const VERSION_2 = /^Версия 2 · изменено (\d\d\.\d\d )?\d\d:\d\d, Дарья Зимина$/;

test.describe('company-branding — «Оформление» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');

  test('меню «Компания» → «Оформление» и прямой URL: крошка, заголовок, пояснение, версия', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    await fromMenu(page, 'Оформление');
    await expect(page).toHaveURL(/\/branding$/);
    await expect(h1(page, 'Оформление')).toBeVisible();
    await expect(main(page).locator('.ox-br-crumb')).toHaveText('Компания');
    await expect(main(page).getByText(INTRO)).toBeVisible();
    await expect(main(page).getByText('Версия 1 · стандартное оформление')).toBeVisible();
    await expect(
      main(page).locator('section[data-screen-label="Владелец · оформление"]'),
    ).toHaveCount(1);
    if (!phone(page)) {
      await expect(
        page
          .getByRole('navigation', { name: 'Основная навигация' })
          .getByRole('button', { name: 'Оформление' }),
      ).toHaveAttribute('aria-current', 'page');
    }
    await page.reload();
    await expect(palette(page)).toBeVisible();
  });

  test('исходное «Альты»: название, короткое имя, буква, палитра «Ортус», контраст, статусы', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'branding');
    await expect(nameField(page)).toHaveValue('Альта Групп');
    await expect(shortField(page)).toHaveValue('');
    await expect(main(page).getByText('0 / 16')).toBeVisible();
    await expect(main(page).locator('.ox-br-letter')).toHaveText('А');
    await expect(palette(page).getByRole('radio')).toHaveCount(8);
    await expect(swatch(page, 'Ортус')).toHaveAttribute('aria-checked', 'true');
    await expect(hex(page)).toHaveValue('#1F6B52');
    await expect(main(page).getByRole('status').filter({ hasText: 'Контраст' })).toHaveText(
      /Контраст с белым текстом 6,4:1: подходит для кнопок и ссылок\.$/,
    );
    for (const chip of ['Принят', 'Ждёт проверки', 'Заблокирован']) {
      await expect(main(page).locator('.ox-br-chip', { hasText: chip })).toBeVisible();
    }
    await expect(panel(page)).toContainText('Изменений нет');
    await expect(save(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Отменить' })).toBeDisabled();
    await expect(
      page.getByRole('switch', { name: /Показывать «Работает на Ортус»/ }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  test('палитра «Сливовый»: черновик, предпросмотр в цвете черновика, оболочка — в сохранённом', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'branding');
    await swatch(page, 'Сливовый').click();
    await expect(swatch(page, 'Сливовый')).toHaveAttribute('aria-checked', 'true');
    await expect(hex(page)).toHaveValue('#7A3E79');
    await expect(panel(page)).toContainText('Есть несохранённые изменения');
    await expect(save(page)).toBeEnabled();
    await expect(preview(page).getByText('Принять', { exact: true })).toHaveCSS(
      'background-color',
      PLUM,
    );
    await expect(main(page).locator('.ox-br-letter')).toHaveCSS('background-color', PLUM);
    expect(await rootVar(page, '--ox-accent')).toBe('#1F6B52');
    await expect(save(page)).toHaveCSS('background-color', ORTUS);
  });

  test('свой HEX: автокоррекция контраста #FFD400 → #8A7300; ввод без # и выбор цвета', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'branding');
    await hex(page).fill('#FFD400');
    await expect(main(page).getByRole('status').filter({ hasText: 'Контраст' })).toHaveText(
      /Контраст с белым текстом 1,4:1 — мало для текста\. В интерфейсе будет использован #8A7300 \(4,6:1\)\.$/,
    );
    await expect(main(page).locator('.ox-br-fixed')).toHaveCSS(
      'background-color',
      'rgb(138, 115, 0)',
    );
    await expect(save(page)).toBeEnabled();
    await hex(page).fill('2B5479');
    await expect(hex(page)).toHaveValue('#2B5479');
    await expect(swatch(page, 'Синий')).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('Выбрать цвет').fill('#7a3e79');
    await expect(swatch(page, 'Сливовый')).toHaveAttribute('aria-checked', 'true');
  });

  test('неверный HEX: alert, ошибка панели, сохранить нельзя', async ({ app, page }) => {
    await openPage(app, page, 'branding');
    await hex(page).fill('zzz');
    await expect(main(page).getByRole('alert').filter({ hasText: 'Введите цвет' })).toHaveText(
      /Введите цвет в формате #RRGGBB, например #2B5479$/,
    );
    await expect(panel(page).getByRole('alert')).toContainText('· Цвет — в формате #RRGGBB');
    await expect(save(page)).toBeDisabled();
  });

  test('название и короткое имя: пусто и длиннее 16 — счётчик и ошибки панели', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'branding');
    await nameField(page).fill('');
    await expect(panel(page).getByRole('alert')).toContainText('· Укажите название организации');
    await expect(save(page)).toBeDisabled();
    await nameField(page).fill('x'.repeat(70));
    await expect(nameField(page)).toHaveValue('x'.repeat(60));
    await shortField(page).fill('x'.repeat(17));
    await expect(main(page).locator('.ox-br-count')).toHaveText('17 / 16');
    await expect(main(page).locator('.ox-br-count')).toHaveCSS('color', 'rgb(161, 58, 51)');
    await expect(panel(page).getByRole('alert')).toContainText('· Короткое имя — до 16 символов');
  });

  test('термины: четыре формы, «Вернуть стандартный», пример и предпросмотр', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'branding');
    const shift = termRow(page, 'Смена');
    await shift.getByLabel('5 и больше').fill('');
    await expect(panel(page).getByRole('alert')).toContainText(
      '· Термин «Смена»: заполните все четыре формы',
    );
    await expect(shift.getByRole('button', { name: 'Вернуть стандартный' })).toBeVisible();
    await shift.getByLabel('Одна').fill('рейс');
    await shift.getByLabel('Много').fill('рейсы');
    await shift.getByLabel('2–4').fill('рейса');
    await shift.getByLabel('5 и больше').fill('рейсов');
    await expect(shift).toContainText('1 рейс · 2 рейса · 5 рейсов');
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expect(preview(page)).toContainText('Приёмка рейсов');
    await expect(preview(page)).toContainText('3 рейса ждут проверки');
    await shift.getByRole('button', { name: 'Вернуть стандартный' }).click();
    await expect(shift).toContainText('1 смена · 2 смены · 5 смен');
    await expect(preview(page)).toContainText('Приёмка смен');
  });

  test('меню: «всегда виден» у разделов управления, скрыть, иконка, порядок, подпись', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'branding');
    await expect(main(page).getByText('всегда виден')).toHaveCount(5);
    const spa = menuRow(page, 'Салон и SPA');
    await spa.getByRole('button', { name: 'Показан' }).click();
    await expect(spa.getByRole('button', { name: 'Скрыт' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(spa).toHaveCSS('opacity', '0.55');
    await expect(preview(page).locator('.ox-pv-item', { hasText: 'Салон и SPA' })).toHaveCount(0);

    const home = page.getByRole('button', { name: 'Сменить иконку: Главная' });
    await home.click();
    await expect(home).toHaveAttribute('aria-expanded', 'true');
    const icons = page.getByRole('radiogroup', { name: 'Иконка пункта' });
    await expect(icons.getByRole('radio')).toHaveCount(3);
    await expect(icons.getByRole('radio', { name: 'home', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await icons.getByRole('radio', { name: 'dashboard', exact: true }).click();
    await expect(icons).toHaveCount(0);
    await expect(home).toContainText('dashboard');
    await expect(preview(page).locator('.ox-pv-item').first()).toContainText('dashboard');

    const modules = menuRow(page, 'Модули и место');
    await expect(modules.getByRole('button', { name: 'Выше' })).toBeDisabled();
    await modules.getByRole('button', { name: 'Ниже' }).click();
    await expect(preview(page).locator('.ox-pv-item-label')).toContainText([
      'Главная',
      'Пользователи и роли',
      'Модули и место',
    ]);
    await expect(menuRow(page, 'Оформление').getByRole('button', { name: 'Ниже' })).toBeDisabled();
    await page.getByLabel('Название пункта «Подписка и места»').fill('Тариф');
    await expect(preview(page).locator('.ox-pv-item-label', { hasText: 'Тариф' })).toHaveCount(1);
  });

  test('«Работает на Ортус» и вкладки предпросмотра «Публичная форма», «Письмо»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'branding');
    const tabs = page.getByRole('group', { name: 'Что показать' });
    await expect(tabs.getByRole('button', { name: 'Приложение' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await tabs.getByRole('button', { name: 'Публичная форма' }).click();
    await expect(preview(page)).toContainText('Запись на приём');
    await expect(preview(page).getByText('Записаться')).toHaveCSS('background-color', ORTUS);
    await expect(preview(page).getByText('Работает на Ортус')).toBeVisible();
    await tabs.getByRole('button', { name: 'Письмо' }).click();
    await expect(preview(page)).toContainText('От: Альта Групп · через Ортус');
    await expect(preview(page)).toContainText(
      'Дарья Зимина приглашает вас в «Альта Групп». Приглашение действует 7 дней.',
    );
    await expect(preview(page).getByText('Принять приглашение')).toBeVisible();
    const sw = page.getByRole('switch', { name: /Показывать «Работает на Ортус»/ });
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(preview(page).getByText('Работает на Ортус')).toHaveCount(0);
    await tabs.getByRole('button', { name: 'Публичная форма' }).click();
    await expect(preview(page).getByText('Работает на Ортус')).toHaveCount(0);
  });

  test('логотип и знак: неверный тип и больше 1 МБ — тост; загрузка и «Убрать»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'branding');
    await fileInput(page, 0).setInputFiles({
      name: 'a.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    });
    await expect(toast(page)).toHaveText('Нужен PNG, SVG, JPG или WebP');
    await fileInput(page, 1).setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(1024 * 1024 + 1),
    });
    await expect(toast(page)).toHaveText('Файл больше 1 МБ');
    await fileInput(page, 0).setInputFiles(pngFile(400, 100, 'logo.png'));
    await expect(main(page).getByRole('img', { name: 'Логотип' })).toBeVisible();
    await expect(preview(page).locator('.ox-pv-logo')).toHaveCount(1);
    await fileInput(page, 1).setInputFiles(pngFile(512, 512, 'mark.png'));
    await expect(main(page).getByRole('img', { name: 'Знак' })).toBeVisible();
    await expect(main(page).locator('.ox-br-letter')).toHaveCount(0);
    await main(page).getByRole('button', { name: 'Убрать' }).last().click();
    await expect(main(page).getByRole('img', { name: 'Знак' })).toHaveCount(0);
    await expect(main(page).locator('.ox-br-letter')).toHaveText('А');
  });

  test('«Сохранить для всех»: тост, версия 2, шапка, акцент :root, меню всех сотрудников', async ({
    app,
    page,
  }) => {
    test.slow();
    await openPage(app, page, 'branding');
    await shortField(page).fill('Альта');
    await swatch(page, 'Синий').click();
    await menuRow(page, 'Салон и SPA').getByRole('button', { name: 'Показан' }).click();
    await save(page).click();
    await expect(toast(page)).toHaveText(SAVED);
    await expect(main(page).locator('.ox-br-version')).toHaveText(VERSION_2);
    await expect(panel(page)).toContainText('Изменений нет');
    await expect(save(page)).toBeDisabled();
    await expect.poll(() => rootVar(page, '--ox-accent')).toBe('#2B5479');
    if (!phone(page)) await expect(page.locator('.ox-brand-name')).toHaveText('Альта');
    expect(await menuLabels(page)).not.toContain('Салон и SPA');
    expect(await menuLabels(page)).toContain('Оформление');

    // Массажист «Альты»: то же оформление, пункт «Мой день» (spa) скрыт, раздел открывается по ссылке.
    await openPage(app, page, 'spa', { persona: 'therapist' });
    await expect.poll(() => rootVar(page, '--ox-accent')).toBe('#2B5479');
    expect(await menuLabels(page)).not.toContain('Мой день');
  });

  test('«Стандартное оформление» и «Отменить»', async ({ app, page }) => {
    await openPage(app, page, 'branding', { persona: 'owner@t-lotos', tenant: LOTOS });
    await expect(hex(page)).toHaveValue('#7A3E79');
    await page.getByRole('button', { name: 'Стандартное оформление' }).click();
    await expect(hex(page)).toHaveValue('#1F6B52');
    await expect(shortField(page)).toHaveValue('');
    await expect(nameField(page)).toHaveValue('SPA «Лотос»');
    await expect(panel(page)).toContainText('Есть несохранённые изменения');
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(hex(page)).toHaveValue('#7A3E79');
    await expect(panel(page)).toContainText('Изменений нет');
    await expect(page.getByRole('button', { name: 'Отменить' })).toBeDisabled();
  });

  test('«Лотос»: своё оформление, изменения «Альты» не видны и наоборот', async ({ app, page }) => {
    test.slow();
    await openPage(app, page, 'branding', { persona: 'owner@t-lotos', tenant: LOTOS });
    await expect(main(page).locator('.ox-br-version')).toHaveText(
      'Версия 3 · изменено 24.09 12:10, Ирина Белова',
    );
    await expect(shortField(page)).toHaveValue('Лотос');
    await expect(main(page).getByText('5 / 16')).toBeVisible();
    await expect(swatch(page, 'Сливовый')).toHaveAttribute('aria-checked', 'true');
    await expect(termRow(page, 'Визит')).toContainText('1 сеанс · 2 сеанса · 5 сеансов');
    await expect(
      termRow(page, 'Визит').getByRole('button', { name: 'Вернуть стандартный' }),
    ).toBeVisible();
    await expect.poll(() => rootVar(page, '--ox-accent')).toBe('#7A3E79');
    if (!phone(page)) await expect(page.locator('.ox-brand-name')).toHaveText('Лотос');

    await swatch(page, 'Индиго').click();
    await save(page).click();
    await expect(toast(page)).toHaveText(SAVED);
    await expect(main(page).locator('.ox-br-version')).toHaveText(/^Версия 4 · изменено /);
    await expect.poll(() => rootVar(page, '--ox-accent')).toBe('#4338A0');

    await openPage(app, page, 'branding');
    await expect(main(page).locator('.ox-br-version')).toHaveText(
      'Версия 1 · стандартное оформление',
    );
    await expect(swatch(page, 'Ортус')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => rootVar(page, '--ox-accent')).toBe('#1F6B52');
  });

  test('название организации после сохранения — в шапке и в письме', async ({ app, page }) => {
    await openPage(app, page, 'branding');
    await nameField(page).fill('Альта Групп Плюс');
    await save(page).click();
    await expect(toast(page)).toHaveText(SAVED);
    await expect(page.locator('header .ox-org-name')).toHaveText('Альта Групп Плюс');
    await page
      .getByRole('group', { name: 'Что показать' })
      .getByRole('button', { name: 'Письмо' })
      .click();
    await expect(preview(page)).toContainText('От: Альта Групп Плюс · через Ортус');
  });

  test('состояния: загрузка, ошибка и «Повторить», нет связи, конфликт версии', async ({
    app,
    page,
  }) => {
    test.slow();
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'getTenantBranding=rate_limited' });
    await fromMenu(page, 'Оформление');
    await expect(main(page).getByRole('alert')).toContainText('Не удалось загрузить оформление');
    await devScenario(page, { scenario: 'getTenantBranding=delay=1500' });
    await main(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(main(page).getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(palette(page)).toBeVisible();
    await devScenario(page, { scenario: null });

    await swatch(page, 'Сливовый').click();
    await devScenario(page, { scenario: 'updateTenantBranding=offline', once: true });
    await save(page).click();
    await expect(toast(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(panel(page)).toContainText('Есть несохранённые изменения');
    await expect(main(page).locator('.ox-br-version')).toHaveText(
      'Версия 1 · стандартное оформление',
    );

    await devScenario(page, { scenario: 'updateTenantBranding=revision_mismatch', once: true });
    await save(page).click();
    await expect(toast(page)).toHaveText('Данные изменились. Обновите оформление и повторите.');
    await expect(panel(page)).toContainText('Есть несохранённые изменения');
    await save(page).click();
    await expect(toast(page)).toHaveText(SAVED);
  });

  test('не владелец по прямому URL: гейт «Компании», формы нет', async ({ app, page }) => {
    test.slow();
    for (const persona of ['manager', 'therapist'] as const) {
      await openPage(app, page, 'branding', { persona });
      await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Оформление', exact: true }),
      ).toHaveCount(0);
      await expect(nameField(page)).toHaveCount(0);
    }
  });

  test('оператор: интерфейс в цветах Ортуса, знаки организаций — в цветах оформления', async ({
    app,
    page,
  }) => {
    await app('/platform/tenants', { persona: 'operator' });
    const row = page.locator('.ox-org-row').filter({ hasText: LOTOS });
    await expect(row.locator('.ox-org-mark')).toHaveText('Л');
    await expect(row.locator('.ox-org-mark')).toHaveCSS('background-color', PLUM);
    const alta = page.locator('.ox-org-row').filter({ hasText: 'Альта Групп' });
    await expect(alta.locator('.ox-org-mark')).toHaveCSS('background-color', ORTUS);
    expect(await rootVar(page, '--ox-accent')).toBe('#1F6B52');
  });

  test('клавиатура: Tab по элементам, Space выбирает цвет, фокус виден', async ({ app, page }) => {
    await openPage(app, page, 'branding');
    await nameField(page).focus();
    await page.keyboard.press('Tab');
    await expect(shortField(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(fileInput(page, 0)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(fileInput(page, 1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(swatch(page, 'Ортус')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(swatch(page, 'Морской')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(swatch(page, 'Морской')).toHaveAttribute('aria-checked', 'true');
    const outline = await swatch(page, 'Морской').evaluate(
      (el) => getComputedStyle(el).outlineStyle,
    );
    expect(outline).not.toBe('none');
    const sw = page.getByRole('switch', { name: /Показывать «Работает на Ортус»/ });
    await sw.focus();
    await page.keyboard.press('Enter');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  test('axe: нет serious и critical', async ({ app, page, axe }) => {
    await openPage(app, page, 'branding');
    await expect(palette(page)).toBeVisible();
    const serious = async () =>
      (await axe(page)).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect((await serious()).map((v) => v.id)).toEqual([]);
    await hex(page).fill('zzz');
    await page.getByRole('button', { name: 'Сменить иконку: Главная' }).click();
    expect((await serious()).map((v) => v.id)).toEqual([]);
    await page
      .getByRole('group', { name: 'Что показать' })
      .getByRole('button', { name: 'Письмо' })
      .click();
    expect((await serious()).map((v) => v.id)).toEqual([]);
  });

  test('раскладка: 390 — одна колонка без горизонтальной прокрутки, 768 — предпросмотр под формой, 1440 — две колонки', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'branding');
    await expect(palette(page)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const card = await main(page).locator('.ox-br-main').boundingBox();
    const aside = await preview(page).boundingBox();
    const cols = await main(page).locator('.ox-br-cols').boundingBox();
    if (!card || !aside || !cols) throw new Error('нет колонок');
    // W2.81: колонки — flex-wrap эталона (:1261, основы 3 1 480px и 2 1 340px, gap 16): рядом, только если в строке
    // помещаются 480 + 16 + 340 px. На 768 строка уже (≈ 650 px) — предпросмотр под формой, как в эталоне.
    const wide = cols.width >= 480 + 16 + 340;
    // Возврат W2.81 №1: ожидание по ширине окна, а не только по ширине колонок реализации — сузившиеся на 1440
    // колонки (< 836 px) не принимаются за одну колонку эталона.
    const viewport = page.viewportSize()?.width ?? 0;
    expect(wide, `ширина .ox-br-cols ${cols.width} px на ${viewport}`).toBe(viewport >= 1024);
    if (phone(page)) {
      expect(aside.y).toBeGreaterThan(card.y + card.height - 1);
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
    } else if (wide) {
      expect(aside.x).toBeGreaterThan(card.x + card.width - 1);
    } else {
      expect(aside.y).toBeGreaterThan(card.y + card.height - 1);
    }
    await expect(panel(page)).toHaveCSS('position', 'sticky');
    await expect(save(page)).toHaveCSS('min-height', '44px');
  });
});

test.describe('company-branding — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: сохранение оформления и его применение у сотрудника', async ({
    app,
    page,
  }) => {
    test.fixme(true, 'W4.60: тег Branding на стенде отвечает 501 (backend оформления не влит)');
    await openPage(app, page, 'branding');
    await swatch(page, 'Синий').click();
    await save(page).click();
    await expect(toast(page)).toHaveText(SAVED);
    await expect.poll(() => rootVar(page, '--ox-accent')).toBe('#2B5479');
  });
});
