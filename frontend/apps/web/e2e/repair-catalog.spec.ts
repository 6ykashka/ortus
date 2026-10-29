// W6.22 · e2e страницы `repair-catalog` «Шаблоны и расценки» (эталон: «Ремонт и стройка.dc.html»
// `data-screen-label="Шаблоны и расценки"` :614–721, CRM :1903; разбор dor/repair.md §1.3, §7). Режим mock:
// сценарный сервер W6.00, пресет repairs-ready (4 шаблона, 23 позиции справочника). Обязательные пункты
// verification-protocol §1.3: меню и прямой URL, состояния, клавиатура, axe, 390 / 1440.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { fromMenu } from './logistics.helpers.ts';
import { phone } from './logistics-review.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { note, openRepair } from './repair-supply.helpers.ts';
import { installRepairs } from './repair.stand.ts';
import { devScenario, tenantId } from './shell.helpers.ts';
import { runLabel } from './_stand/stand.ts';

const H1 = 'Шаблоны и расценки';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

const tab = (page: Page, name: string | RegExp) =>
  page.getByRole('tablist', { name: 'Шаблоны и расценки' }).getByRole('tab', { name });
const detail = (page: Page) => page.locator('.ox-rc-detail');

test.describe('repair-catalog — «Шаблоны и расценки» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается из меню и по прямому URL; заголовок, крошка, описание, вкладки', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'repairs-ready' });
    await app(`/t/${alta}/home`, { persona: 'owner' });
    await fromMenu(page, 'Шаблоны и расценки');
    await expect(page).toHaveURL(/\/repair-catalog$/);
    await expect(h1(page, H1)).toBeVisible();
    await expect(page.locator('.ox-rps-crumb')).toHaveText('Ремонт и стройка');
    await expect(page.getByText(/^Шаблон задаёт, что объект получает при создании:/)).toBeVisible();
    await expect(tab(page, 'Шаблоны · 4')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Справочник расценок · 23')).toBeVisible();
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(tab(page, 'Шаблоны · 4')).toBeVisible();
  });

  test('«Шаблоны»: список, карточка, смета и формулы, технология, документы, материалы, чек-лист', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, 'repair-catalog');
    const list = page.getByRole('button', { name: /Капитальный ремонт квартиры/ });
    await expect(list).toHaveAttribute('aria-pressed', 'true');
    await expect(list).toContainText('Ортус · копия организации');
    await expect(list).toContainText('5 разделов · 14 строк · 10 из замера · объектов: 2');
    const c = detail(page);
    await expect(c).toContainText(
      'Вид ремонта: капитальный ремонт · изменён 12.09 · объектов по шаблону: 2',
    );
    await expect(c).toContainText(
      'Стартовый шаблон Ортуса, скопирован в организацию. Правки остаются у вас и не меняют уже созданные объекты.',
    );
    await expect(c.getByRole('columnheader')).toHaveText([
      'Работа или материал',
      'Объём в шаблоне',
      'Цена в справочнике',
    ]);
    await expect(c.getByText('фиксированно: 30 шт')).toBeVisible();
    for (const name of [
      'Технология графика',
      'Комплект документов',
      'Материалы для снабжения',
      'Чек-лист приёмки',
    ]) {
      await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
    }
    await expect(page.getByText('Договор подряда — из согласованной версии сметы')).toBeVisible();
    await expect(page.getByText('Гарантийный паспорт · 24 месяца')).toBeVisible();
    await page.getByRole('button', { name: /Косметический ремонт/ }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Косметический ремонт' }),
    ).toBeVisible();
  });

  test('«Сделать копию» → «Свой · копия», режим правки, сообщение', async ({ app, page }) => {
    await openRepair(app, page, 'repair-catalog');
    await detail(page).getByRole('button', { name: 'Сделать копию' }).click();
    await expect(note(page)).toHaveText(
      'Копия «Капитальный ремонт квартиры» создана — настройте её под свой вид работ.',
    );
    await expect(
      page.getByRole('heading', { level: 2, name: 'Капитальный ремонт квартиры · копия' }),
    ).toBeVisible();
    await expect(detail(page)).toContainText('Свой · копия');
    await expect(detail(page)).toContainText(
      'Копия шаблона «Капитальный ремонт квартиры». Правки не меняют уже созданные объекты.',
    );
    await expect(detail(page).getByRole('button', { name: 'Готово' })).toBeVisible();
    await expect(tab(page, 'Шаблоны · 5')).toBeVisible();
  });

  test('правка шаблона: формула, коэффициент, строка из справочника, убрать; «Готово» сохраняет', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, 'repair-catalog');
    const c = detail(page);
    await c.getByRole('button', { name: 'Изменить смету шаблона' }).click();
    await c.getByLabel('Как считать объём: Демонтаж напольного покрытия').selectOption('');
    await c.getByLabel('Количество: Демонтаж напольного покрытия').fill('40');
    await c.getByLabel('Коэффициент: Штукатурка по маякам').fill('1,1');
    await c.getByRole('button', { name: 'Убрать из шаблона: Вывоз мусора' }).click();
    await c.getByRole('button', { name: 'Строка из справочника' }).first().click();
    await c.getByLabel('Поиск по справочнику расценок').fill('перегородок');
    await c.getByRole('button', { name: /Демонтаж перегородок/ }).click();
    await expect(c.getByLabel('Количество: Демонтаж перегородок')).toBeVisible();
    if (phone(page)) {
      expect(await hitHeight(c.getByRole('button', { name: 'Готово' }))).toBeGreaterThanOrEqual(44);
    }
    await c.getByRole('button', { name: 'Готово' }).click();
    await expect(c.getByRole('button', { name: 'Изменить смету шаблона' })).toBeVisible();
    await expect(c.getByText('фиксированно: 40 м²')).toBeVisible();
    await expect(c.getByText('из замера: стены без санузлов × 1,1')).toBeVisible();
    await expect(c.getByText('Вывоз мусора')).toHaveCount(0);
    await expect(c.getByText('Демонтаж перегородок', { exact: true })).toBeVisible();
  });

  test('«Справочник расценок»: поиск, тип, цена в строке', async ({ app, page }) => {
    await openRepair(app, page, 'repair-catalog?tab=price');
    await expect(page.getByText('23 из 23')).toBeVisible();
    await expect(page.getByRole('columnheader')).toHaveText([
      'Позиция',
      'Тип',
      'Ед.',
      'Цена, ₽',
      'В шаблонах',
    ]);
    await page.getByLabel('Поиск по справочнику', { exact: true }).fill('ламинат');
    await expect(page.getByText('3 из 23')).toBeVisible();
    await page
      .getByRole('group', { name: 'Тип позиции' })
      .getByRole('button', { name: 'Работы' })
      .click();
    await expect(page.getByText('1 из 23')).toBeVisible();
    await page.getByLabel('Поиск по справочнику', { exact: true }).fill('нет такого');
    await expect(page.getByText('Ничего не найдено.')).toBeVisible();
    await page.getByLabel('Поиск по справочнику', { exact: true }).fill('');
    await page
      .getByRole('group', { name: 'Тип позиции' })
      .getByRole('button', { name: 'Все' })
      .click();
    const price = page.getByLabel('Цена: Электромонтаж, точка');
    await expect(price).toHaveValue('1200');
    await price.fill('1 350');
    await price.press('Enter');
    await expect(page.getByLabel('Цена: Электромонтаж, точка')).toHaveValue('1350');
    await page.getByLabel('Цена: Электромонтаж, точка').fill('0');
    await page.getByLabel('Цена: Электромонтаж, точка').press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Укажите цену больше нуля');
    await expect(page.getByLabel('Цена: Электромонтаж, точка')).toHaveValue('1350');
  });

  test('«Новая позиция»: ошибки, успех, дубликат', async ({ app, page }) => {
    await openRepair(app, page, 'repair-catalog?tab=price');
    const form = page.locator('.ox-rc-new');
    const name = form.getByLabel('Название');
    await expect(name).toHaveAttribute('placeholder', 'Например, «Монтаж дверного блока»');
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(form.getByRole('alert')).toHaveText('Укажите название позиции');
    await name.fill('Монтаж дверного блока');
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(form.getByRole('alert')).toHaveText('Укажите цену больше нуля');
    await form.getByLabel('Цена, ₽').fill('4 500');
    await form.getByLabel('Раздел').selectOption('Сантехника');
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(note(page)).toHaveText(
      '«Монтаж дверного блока» добавлена в справочник: её можно выбрать в сметах и шаблонах.',
    );
    await expect(page.getByText('24 из 24')).toBeVisible();
    await expect(tab(page, 'Справочник расценок · 24')).toBeVisible();
    await expect(page.getByLabel('Цена: Монтаж дверного блока')).toHaveValue('4500');
    await name.fill('ламинат 33 класс');
    await form.getByLabel('Цена, ₽').fill('100');
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(form.getByRole('alert')).toHaveText('Такая позиция уже есть в справочнике');
  });

  test('загрузка — скелетон; ошибка — «Повторить»; нет связи; нет доступа; только чтение', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'repairs-ready' });
    await devScenario(page, { scenario: 'listTemplates=delay=1500' });
    await app(`/t/${alta}/repair-catalog`, { persona: 'owner' });
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(tab(page, 'Шаблоны · 4')).toBeVisible({ timeout: 15_000 });
    await devScenario(page, { scenario: 'listTemplates=rate_limited' });
    await page.reload();
    await expect(
      page.getByText(
        'Не удалось загрузить шаблоны и расценки: Слишком много запросов. Подождите и повторите.',
      ),
    ).toBeVisible({ timeout: 15_000 });
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(tab(page, 'Шаблоны · 4')).toBeVisible();
    await devScenario(page, { scenario: 'copyTemplate=offline' });
    await detail(page).getByRole('button', { name: 'Сделать копию' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await devScenario(page, { scenario: null });
    await expect(tab(page, 'Шаблоны · 4')).toBeVisible();
    await openRepair(app, page, 'repair-catalog', { persona: 'foreman' });
    await expect(page.getByText('Нет доступа к разделу «Ремонт и стройка»')).toBeVisible();
    await openRepair(app, page, 'repair-catalog', { presets: ['repairs-ready', 'trial-ended'] });
    await expect(detail(page).getByRole('button', { name: 'Сделать копию' })).toBeDisabled();
    await expect(
      detail(page).getByRole('button', { name: 'Изменить смету шаблона' }),
    ).toBeDisabled();
  });

  test('клавиатура: Tab до вкладки, стрелки переключают и обновляют ?tab=; фокус виден', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, 'repair-catalog');
    const first = tab(page, /^Шаблоны/);
    await expect(first).toBeVisible();
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await first.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await first.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^Справочник/)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, /^Справочник/)).toBeFocused();
    await expect(page).toHaveURL(/tab=price/);
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, /^Шаблоны/)).toHaveAttribute('aria-selected', 'true');
  });

  test('1440 — боковая панель, 390 — нижняя навигация; цели ≥ 44 px, без горизонтальной прокрутки; axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    await openRepair(app, page, 'repair-catalog');
    await expect(tab(page, 'Шаблоны · 4')).toBeVisible();
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeHidden();
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeHidden();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    if (phone(page)) {
      for (const target of [
        tab(page, /^Справочник/),
        page.getByRole('button', { name: /Косметический ремонт/ }),
        detail(page).getByRole('button', { name: 'Сделать копию' }),
        detail(page).getByRole('button', { name: 'Изменить смету шаблона' }),
      ]) {
        expect(await hitHeight(target)).toBeGreaterThanOrEqual(44);
      }
    }
    await tab(page, /^Справочник/).click();
    await expect(page.getByText('23 из 23')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const serious2 = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious2.map((v) => v.id)).toEqual([]);
  });
});

// Стенд: backend справочника и шаблонов (W6.12) в main. Модуль «Ремонт и стройка» подключается командой API; стартовые
// шаблоны и прайс копируются в организацию при подключении (repair.stand.ts) — страница читает настоящий backend.
test.describe('repair-catalog — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(180_000);

  async function openCatalog(
    app: Parameters<Parameters<typeof test>[2]>[0]['app'],
    page: Page,
    search = '',
  ): Promise<void> {
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    await installRepairs(page, tenant);
    await app(`/t/${tenant}/repair-catalog${search}`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
  }

  test('владелец на стенде: стартовые шаблоны, «Сделать копию» создаёт «Свой · копия»', async ({
    app,
    page,
  }) => {
    await openCatalog(app, page);
    await expect(tab(page, /^Шаблоны · \d+/)).toHaveAttribute('aria-selected', 'true');
    await expect(detail(page).getByRole('columnheader').first()).toHaveText('Работа или материал');
    await detail(page).getByRole('button', { name: 'Сделать копию' }).click();
    await expect(note(page)).toContainText(
      /^Копия «.+» создана — настройте её под свой вид работ\.$/,
    );
    await expect(detail(page)).toContainText('Свой · копия');
    await expect(detail(page).getByRole('button', { name: 'Готово' })).toBeVisible();
    await detail(page).getByRole('button', { name: 'Готово' }).click();
    await expect(
      detail(page).getByRole('button', { name: 'Изменить смету шаблона' }),
    ).toBeVisible();
  });

  test('владелец на стенде: «Справочник расценок» — новая позиция и цена в строке', async ({
    app,
    page,
  }, testInfo) => {
    await openCatalog(app, page, '?tab=price');
    const name = `Монтаж блока ${runLabel(testInfo.project.name)}`;
    const form = page.locator('.ox-rc-new');
    await form.getByLabel('Название').fill(name);
    await form.getByLabel('Цена, ₽').fill('4 500');
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(note(page)).toHaveText(
      `«${name}» добавлена в справочник: её можно выбрать в сметах и шаблонах.`,
    );
    const price = page.getByLabel(`Цена: ${name}`);
    await expect(price).toHaveValue('4500');
    await price.fill('5 100');
    await price.press('Enter');
    await expect(page.getByLabel(`Цена: ${name}`)).toHaveValue('5100');
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
    await tab(page, /^Справочник расценок/).click();
    await expect(page.getByLabel(`Цена: ${name}`)).toHaveValue('5100');
  });
});
