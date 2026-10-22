// W4.22 · e2e страницы `forms` «Формы и опросы» (эталон design-2026-10-19 «Формы и опросы.dc.html» dc:28–286,
// 457–466; в CRM — dc-import «Формы и опросы»; разбор docs/plan/v2/analysis/dor/forms.md §1, §6 — экраны
// forms-list, forms-builder, forms-preview, modal-form-publish). Данные — MSW W4.05 поверх домена W4.20 (сид
// «Альты»: «Осмотр машины» v3, черновик «Ежедневного отчёта прораба»); backend — W4.21 (режим stand). Обязательные
// пункты verification-protocol §1.3: меню и URL, состояния (загрузка, ошибка, нет связи, не найдено, только
// просмотр), клавиатура, axe, 390 / 1440.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const H1 = 'Формы и опросы';
const SUB =
  'Анкеты, заявки, опросы, тесты и рабочие отчёты. Опубликованная версия неизменяема: каждый ответ привязан к своей версии.';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const RATE = 'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.';

const root = (page: Page): Locator => page.locator('.ox-fm');
const rows = (page: Page): Locator => page.locator('.ox-fm-row');
const row = (page: Page, name: string): Locator =>
  rows(page).filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
const rowMenu = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: `Действия с формой «${name}»` });
const qrow = (page: Page, label: string): Locator =>
  page.locator('.ox-fm-q-row', { has: page.locator('.ox-fm-q-label', { hasText: label }) });
const card = (page: Page): Locator => page.locator('.ox-fm-qe');
const pv = (page: Page): Locator => page.locator('.ox-fm-pv-card');
const saved = (page: Page) =>
  expect(page.getByText('Черновик сохранён')).toBeVisible({ timeout: 15_000 });

/** «Формы и опросы» «Альты» по прямому URL (`search` — `?form=&tab=`). */
async function open(
  app: Parameters<typeof openPage>[0],
  page: Page,
  o: { search?: string; preset?: string; persona?: 'owner' | 'manager' } = {},
): Promise<string> {
  const id = await openPage(app, page, `forms${o.search ?? ''}`, {
    persona: o.persona ?? 'owner',
    ...(o.preset ? { preset: o.preset } : {}),
  });
  if (!o.search) await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
  return id;
}

/** Открыть форму из списка и дождаться «Конструктора». */
async function enter(page: Page, name: string): Promise<void> {
  await row(page, name).locator('.ox-fm-row-open').click();
  await expect(page.getByRole('tab', { name: 'Конструктор' })).toBeVisible();
  await expect(page.locator('.ox-fm-page').first()).toBeVisible({ timeout: 15_000 });
}

/** Ширина области нажатия по горизонтали через центр цели (пара к `hitHeight`). */
async function hitWidth(target: Locator): Promise<number> {
  return target.evaluate((el) => {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    let n = 0;
    for (let x = Math.floor(r.left) - 30; x <= Math.ceil(r.right) + 30; x++) {
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit))) n++;
    }
    return n;
  });
}

/** Цели нажатия области `root` на телефоне меньше 44 × 44 px: «подпись: высота×ширина». */
async function smallTargets(area: Locator): Promise<string[]> {
  const els = area.locator('button, select, textarea, input:not([type="hidden"])');
  const out: string[] = [];
  for (const el of await els.all()) {
    if (!(await el.isVisible())) continue;
    if ((await el.getAttribute('tabindex')) === '-1') continue;
    const type = await el.getAttribute('type');
    const label = el.locator('xpath=ancestor::label[1]');
    const target = (type === 'checkbox' || type === 'radio') && (await label.count()) ? label : el;
    const h = await hitHeight(target);
    const w = await hitWidth(target);
    if (h >= 44 && w >= 44) continue;
    const name =
      (await el.getAttribute('aria-label')) ??
      (await el.evaluate(
        (e) => (e as HTMLElement).innerText || (e as HTMLInputElement).placeholder || e.tagName,
      ));
    out.push(`${name.replace(/\s+/g, ' ').trim().slice(0, 48)}: ${h}×${w}`);
  }
  return out;
}

type AxeResult = {
  violations: { id: string; impact?: string | null; nodes: { target: unknown[] }[] }[];
};

/** Нарушения axe уровня serious и critical: «правило: цели». */
async function serious(page: Page, axe: (p: Page) => Promise<AxeResult>): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return (await axe(page)).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.describe('forms — «Формы и опросы» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии сценарного сервера — режим mock');
  test.setTimeout(90_000);

  test('открывается из меню и по прямому URL: заголовок, плитки, строки форм', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
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
    await expect(page).toHaveURL(/\/forms$/);
    await expect(page.locator('.ox-fm-crumb')).toHaveText('Альта Групп / Общие модули');
    await expect(root(page)).toContainText(SUB);
    await expect(page.locator('.ox-fm-tile-name')).toHaveText([
      'Создать пустую форму',
      'Анкета',
      'Форма обратной связи',
      'Заявка на услугу или работу',
      'Регистрация на обучение',
    ]);
    await expect(page.getByRole('button', { name: /Все шаблоны · 15/ })).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, 'Осмотр машины')).toContainText('Принимает ответы · v3');
    await expect(row(page, 'Осмотр машины')).toContainText('2 ответа');
    await expect(row(page, 'Ежедневный отчёт прораба')).toContainText('Черновик');
    await page.reload();
    await expect(rows(page)).toHaveCount(2, { timeout: 15_000 });
  });

  test('«Все шаблоны · 15»: разделы, поиск, «Шаблон не найден», создание из шаблона', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await page.getByRole('button', { name: /Все шаблоны · 15/ }).click();
    const pop = page.locator('.ox-fm-tpl-pop');
    await expect(pop.locator('.ox-fm-tpl-cat')).toHaveText([
      'Основные',
      'Опросы и оценка',
      'Сотрудники',
      'Тесты',
      'Отраслевые',
    ]);
    await expect(pop.getByRole('button', { name: /Круговой осмотр машины/ })).toBeDisabled();
    await page.getByRole('searchbox', { name: 'Поиск шаблона' }).fill('нет такого');
    await expect(pop).toContainText('Шаблон не найден');
    await page.getByRole('searchbox', { name: 'Поиск шаблона' }).fill('nps');
    await pop.getByRole('button', { name: /NPS · готовность рекомендовать/ }).click();
    await expect(toast(page)).toHaveText('Создан черновик «NPS · готовность рекомендовать»');
    await expect(page.getByRole('textbox', { name: 'Название формы' })).toHaveValue(
      'NPS · готовность рекомендовать',
    );
    await expect(page).toHaveURL(/\?form=/);
    await expect(page.locator('.ox-fm-ed-meta')).toContainText('Черновик · не опубликована');
  });

  test('группы: создать (ошибки), «По группам», переместить, удалить пустую', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await page.getByRole('button', { name: 'Создать группу' }).click();
    await page.getByRole('textbox', { name: 'Название группы' }).fill('О');
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Название группы — от 2 символов');
    await page.getByRole('textbox', { name: 'Название группы' }).fill('Опросы клиентов');
    await page.getByRole('textbox', { name: 'Название группы' }).press('Enter');
    await expect(toast(page)).toHaveText(
      'Группа «Опросы клиентов» создана. Переместите в неё формы через меню «…»',
    );
    await expect(page.getByRole('button', { name: 'По группам' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.getByText('В группе пока нет форм — переместите сюда форму через меню «…».'),
    ).toBeVisible();
    await rowMenu(page, 'Ежедневный отчёт прораба').click();
    await page.getByRole('menuitem', { name: 'Переместить в группу' }).click();
    await page.getByRole('menuitem', { name: 'Опросы клиентов' }).click();
    await expect(page.locator('.ox-fm-block-head')).toHaveText([
      'folderОпросы клиентов1',
      'folderБез группы1',
    ]);
    await rowMenu(page, 'Ежедневный отчёт прораба').click();
    await page.getByRole('menuitem', { name: 'Переместить в группу' }).click();
    await page.getByRole('menuitem', { name: 'Без группы' }).click();
    await page.getByRole('button', { name: 'Удалить пустую группу' }).click();
    await expect(page.locator('.ox-fm-block-head')).toHaveText(['folderБез группы2']);
  });

  test('фильтры и пустые состояния: «Ничего не найдено», «Сбросить фильтры»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await page.getByRole('combobox', { name: 'Статус' }).selectOption('closed');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await expect(page.getByText('Измените поиск или фильтры.')).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole('searchbox', { name: 'Поиск формы' }).fill('осмотр');
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Владелец' }).selectOption('mine');
    await expect(rows(page)).toHaveCount(1);
  });

  test('меню строки: «Дублировать», «Закрыть / Возобновить приём ответов»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await rowMenu(page, 'Осмотр машины').click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'editОткрыть',
      'inboxОтветы · 2',
      'content_copyДублировать',
      'drive_file_moveПереместить в группу',
      'blockЗакрыть приём ответов',
    ]);
    // Escape закрывает меню и возвращает фокус.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(rowMenu(page, 'Осмотр машины')).toBeFocused();
    await rowMenu(page, 'Осмотр машины').click();
    await page.getByRole('menuitem', { name: 'Закрыть приём ответов' }).click();
    await expect(toast(page)).toHaveText('Приём ответов закрыт: «Осмотр машины»');
    await expect(row(page, 'Осмотр машины')).toContainText('Приём закрыт · v3');
    await rowMenu(page, 'Осмотр машины').click();
    await page.getByRole('menuitem', { name: 'Возобновить приём ответов' }).click();
    await expect(toast(page)).toHaveText('Приём ответов возобновлён: «Осмотр машины»');
    await rowMenu(page, 'Осмотр машины').click();
    await page.getByRole('menuitem', { name: 'Дублировать' }).click();
    await expect(toast(page)).toHaveText('Создана копия «Осмотр машины · копия»');
    await expect(row(page, 'Осмотр машины · копия')).toContainText('Черновик');
  });

  test('меню строки «Открыть» и «Ответы · 2»: первый клик в редакторе не теряется', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await rowMenu(page, 'Осмотр машины').click();
    await page.getByRole('menuitem', { name: 'Открыть' }).click();
    await expect(page.locator('.ox-fm-page').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.ox-fm-backdrop')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Настройки' }).click();
    await expect(page.getByRole('tab', { name: 'Настройки' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/tab=settings/);
    await page.getByRole('button', { name: 'Все формы' }).click();
    await expect(h1(page, H1)).toBeVisible();
    await rowMenu(page, 'Осмотр машины').click();
    await page.getByRole('menuitem', { name: 'Ответы · 2' }).click();
    await expect(page).toHaveURL(/tab=responses/);
    await page.getByRole('button', { name: 'Все формы' }).click();
    await expect(h1(page, H1)).toBeVisible();
    await expect(page).toHaveURL(/\/forms$/);
  });

  test('шапка редактора: название на месте, чип, мета, вкладки, только просмотр', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Осмотр машины');
    await expect(page.locator('.ox-fm-ed-meta')).toContainText(
      'Принимает ответы · v3Логистика · вся организация · владелец Дарья Зимина',
    );
    await expect(page.getByRole('tab')).toHaveText([
      'Конструктор',
      'Настройки',
      'Действия после ответа2',
      'Ответы2',
      'Версии3',
    ]);
    await expect(page.getByRole('button', { name: 'Опубликовано' })).toBeDisabled();
    const name = page.getByRole('textbox', { name: 'Название формы' });
    await name.fill('Ос');
    await name.press('Enter');
    await expect(page.locator('.ox-fm-name-err')).toHaveText(
      'Название формы — не короче 3 символов',
    );
    await name.fill('Осмотр машины перед рейсом');
    await name.press('Enter');
    await expect(toast(page)).toHaveText('Форма переименована');
    await page.getByRole('button', { name: 'Все формы' }).click();
    await expect(row(page, 'Осмотр машины перед рейсом')).toBeVisible();
  });

  test('только просмотр: менеджер логистики видит плашку, без правки и публикации', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'manager', preset: 'logistics-ready' });
    await expect(page.getByRole('heading', { level: 2, name: 'Создание формы' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Создать группу' })).toHaveCount(0);
    await enter(page, 'Осмотр машины');
    await expect(page.getByText('Только просмотр · нет права «Настраивать» формы')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Название формы' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Опубликова/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Добавить вопрос' })).toHaveCount(0);
    await qrow(page, 'Уровень топлива').click();
    await expect(card(page).getByRole('textbox', { name: 'Вопрос', exact: true })).toBeDisabled();
  });

  test('конструктор: страницы, выбор типа, карточка вопроса, условия «И / ИЛИ», скрытый, id', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Ежедневный отчёт прораба');
    await expect(page.getByRole('navigation', { name: 'Содержание формы' })).toContainText(
      '2 стр. · 3 вопроса',
    );
    await page
      .locator('.ox-fm-page')
      .first()
      .getByRole('button', { name: 'Добавить вопрос' })
      .click();
    await expect(page.getByText('Выберите вопрос')).toBeVisible();
    await page.getByRole('button', { name: 'Показать все вопросы' }).click();
    await expect(page.locator('.ox-fm-pick-gtitle')).toHaveText([
      'Текст и числа',
      'Выбор',
      'Данные CRM',
      'Другие',
    ]);
    await expect(page.getByRole('button', { name: /Оплата/ })).toBeDisabled();
    await page.getByRole('button', { name: /^Да \/ нет$/ }).click();
    await card(page)
      .getByRole('textbox', { name: 'Вопрос', exact: true })
      .fill('Работы по графику?');
    await card(page).getByRole('checkbox', { name: 'Обязательный' }).check();
    const id = card(page).getByRole('textbox', { name: 'Идентификатор вопроса' });
    await id.fill('1');
    await expect(card(page).getByRole('alert')).toHaveText(
      'Латиница, цифры, «_» и «-», с буквы, от 2 символов',
    );
    await id.fill('on_schedule');
    await expect(card(page).getByRole('alert')).toHaveCount(0);
    // Новый вопрос встал после «Явки бригады» — поднять выше, чтобы от него зависел показ.
    await card(page).getByRole('button', { name: 'Вопрос выше' }).click();
    await card(page).getByRole('button', { name: 'Свернуть вопрос' }).click();
    // «Явка бригады» зависит от «Работы по графику?» (выше) и «Выполненный объём» — «ИЛИ».
    await qrow(page, 'Явка бригады').click();
    await card(page).getByRole('button', { name: 'Показывать при условии' }).click();
    await card(page).getByRole('button', { name: 'Добавить условие' }).click();
    await card(page).getByRole('combobox', { name: 'Как сочетать условия' }).selectOption('any');
    await card(page)
      .getByRole('combobox', { name: 'Вопрос условия' })
      .nth(1)
      .selectOption('q-volume');
    await card(page).getByRole('textbox', { name: 'Значение' }).fill('0');
    await card(page).getByRole('button', { name: 'Добавить вариант' }).click();
    await card(page).getByRole('button', { name: 'Действия с вопросом' }).click();
    await page.getByRole('menuitem', { name: 'Сделать скрытым' }).click();
    await expect(card(page)).toContainText(
      'Скрытый вопрос не показывается. Значение — по умолчанию или из параметра ссылки ?q-crew=…',
    );
    await card(page).getByRole('button', { name: 'Свернуть вопрос' }).click();
    await expect(qrow(page, 'Явка бригады')).toContainText('Скрытый');
    await expect(qrow(page, 'Явка бригады')).toContainText(
      'если «Работы по графику?» = да или «Выполненный объём, м²» = 0',
    );
    await saved(page);
    // Правка сохранена на сервере: после перезагрузки черновик тот же.
    await page.reload();
    await expect(qrow(page, 'Работы по графику?')).toBeVisible({ timeout: 15_000 });
    await expect(qrow(page, 'Явка бригады')).toContainText('Скрытый');
  });

  test('конструктор: удаление и «Восстановить», «До публикации исправьте», автосохранение', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Осмотр машины');
    await qrow(page, 'Пробег по одометру, км').click();
    await card(page).getByRole('button', { name: 'Действия с вопросом' }).click();
    await page.getByRole('menuitem', { name: 'Удалить' }).click();
    await expect(page.getByText('Вопрос «Пробег по одометру, км» удалён')).toBeVisible();
    await expect(page.getByText('Сохраняем черновик…')).toBeVisible();
    await page.getByRole('button', { name: 'Восстановить' }).click();
    await expect(qrow(page, 'Пробег по одометру, км')).toBeVisible();
    await qrow(page, 'Уровень топлива').click();
    await card(page).getByRole('textbox', { name: 'Вопрос', exact: true }).fill('');
    await expect(page.locator('.ox-fm-issues')).toContainText('До публикации исправьте');
    await expect(page.locator('.ox-fm-issues')).toContainText('Вопрос 3: нет текста');
    await card(page).getByRole('textbox', { name: 'Вопрос', exact: true }).fill('Топливо');
    await expect(page.locator('.ox-fm-issues')).toHaveCount(0);
    await saved(page);
    await expect(page.locator('.ox-fm-ed-meta')).toContainText(
      'Действует v3 · есть неопубликованные изменения',
    );
    await expect(page.getByRole('button', { name: 'Опубликовать v4' })).toBeEnabled();
  });

  test('предпросмотр: телефон и компьютер, проверки ввода, условия, «Спасибо»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Осмотр машины');
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    await expect(page.getByText('Предпросмотр черновика. Ответ не сохраняется.')).toBeVisible();
    await page
      .getByRole('group', { name: 'Устройство' })
      .getByRole('button', { name: 'Компьютер' })
      .click();
    await expect(pv(page)).toHaveAttribute('data-device', 'desktop');
    await pv(page).getByRole('button', { name: 'Далее' }).click();
    await expect(pv(page).getByRole('alert')).toHaveText('Обязательный вопрос');
    await pv(page).getByRole('button', { name: 'Демо: прикрепить файл' }).click();
    await pv(page).getByRole('button', { name: 'Далее' }).click();
    await pv(page).getByRole('textbox', { name: 'Пробег по одометру, км' }).fill('84210');
    await pv(page).getByRole('radio', { name: /¾/ }).click();
    await pv(page).getByRole('button', { name: 'Далее' }).click();
    await pv(page).getByRole('checkbox', { name: /шины/ }).click();
    await pv(page).getByRole('button', { name: 'Далее' }).click();
    await expect(pv(page).getByRole('textbox', { name: 'Описание дефекта' })).toHaveCount(0);
    await pv(page).getByRole('radio', { name: /Нет/ }).click();
    await pv(page).getByRole('button', { name: 'Отправить' }).click();
    await expect(pv(page)).toContainText('Спасибо! Ответ отправлен.');
    await pv(page).getByRole('button', { name: 'Пройти ещё раз' }).click();
    await expect(pv(page)).toContainText('Страница 1 из 4');
    await page.getByRole('button', { name: 'Закрыть предпросмотр' }).click();
    await expect(pv(page)).toHaveCount(0);
  });

  test('«Опубликовать»: ошибки → конструктор; vN — тост и чип; Escape', async ({ app, page }) => {
    await open(app, page);
    await enter(page, 'Ежедневный отчёт прораба');
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    const bad = page.getByRole('dialog', { name: 'Сначала исправьте форму' });
    await expect(bad).toContainText('«Явка бригады»: нет вариантов ответа');
    await expect(bad.getByRole('button', { name: 'Перейти к конструктору' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(bad).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Опубликовать', exact: true })).toBeFocused();
    await qrow(page, 'Явка бригады').click();
    await card(page).getByRole('button', { name: 'Добавить вариант' }).click();
    await saved(page);
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Опубликовать «Ежедневный отчёт прораба» v1?' });
    await expect(dlg).toContainText(
      'Форма начнёт принимать ответы. Кто может ответить: сотрудники организации.',
    );
    await dlg.getByRole('button', { name: 'Опубликовать v1' }).click();
    await expect(toast(page)).toHaveText('Опубликована версия v1 формы «Ежедневный отчёт прораба»');
    await expect(page.locator('.ox-fm-ed-meta')).toContainText('Принимает ответы · v1');
    await expect(page.getByRole('tab', { name: /Версии/ })).toHaveText('Версии1');
    // После публикации кнопка шапки — «Опубликовано» (disabled): фокус на заголовке формы, не на BODY.
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  });

  test('«Опубликовать» с клавиатуры: ошибка сервера — фокус в диалоге, Tab в ловушке, Escape закрывает; нет связи — один раз', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Ежедневный отчёт прораба');
    await qrow(page, 'Явка бригады').click();
    await card(page).getByRole('button', { name: 'Добавить вариант' }).click();
    await saved(page);
    for (const sc of ['revision_mismatch', 'forbidden_action', 'invalid_transition']) {
      await devScenario(page, { scenario: `publishForm=${sc}` });
      const head = page.getByRole('button', { name: 'Опубликовать', exact: true });
      await head.focus();
      await page.keyboard.press('Enter');
      const dlg = page.getByRole('dialog');
      await expect(dlg.getByRole('button', { name: 'Отмена' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dlg.getByRole('button', { name: 'Опубликовать v1' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(dlg.getByRole('alert')).toBeVisible({ timeout: 15_000 });
      expect(
        await dlg.evaluate((el) => el.contains(document.activeElement)),
        `${sc}: фокус в диалоге`,
      ).toBe(true);
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab');
        expect(await dlg.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(dlg, `${sc}: Escape закрывает`).toHaveCount(0);
      await expect(head).toBeFocused();
    }
    await devScenario(page, { scenario: 'publishForm=offline' });
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('button', { name: 'Опубликовать v1' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(dlg).not.toContainText(OFFLINE);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('«Ещё»: отменить изменения, выгрузить CSV, «Ответов пока нет»', async ({ app, page }) => {
    await open(app, page);
    await enter(page, 'Осмотр машины');
    await qrow(page, 'Уровень топлива').click();
    await card(page).getByRole('textbox', { name: 'Вопрос', exact: true }).fill('Топливо в баке');
    await saved(page);
    await page.getByRole('button', { name: 'Ещё действия с формой' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Выгрузить ответы в CSV' }).click();
    expect((await download).suggestedFilename()).toBe('Осмотр машины.csv');
    await page.getByRole('button', { name: 'Ещё действия с формой' }).click();
    await page.getByRole('menuitem', { name: 'Отменить неопубликованные изменения' }).click();
    await expect(toast(page)).toHaveText('Изменения отменены: действует v3');
    await expect(qrow(page, 'Уровень топлива')).toBeVisible();
    await page.getByRole('button', { name: 'Все формы' }).click();
    await enter(page, 'Ежедневный отчёт прораба');
    await page.getByRole('button', { name: 'Ещё действия с формой' }).click();
    await page.getByRole('menuitem', { name: 'Выгрузить ответы в CSV' }).click();
    await expect(toast(page)).toHaveText('Ответов пока нет');
  });

  test('состояния: ошибка загрузки и «Повторить», нет связи, форма не найдена, 412 черновика', async ({
    app,
    page,
  }) => {
    const alta = await open(app, page);
    await devScenario(page, { scenario: 'listForms=rate_limited' });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText(RATE);
    await devScenario(page, { scenario: 'listForms=delay=1500' });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Загрузка форм…' })).toBeVisible();
    await expect(rows(page)).toHaveCount(2, { timeout: 15_000 });
    await devScenario(page, { scenario: 'updateForm=offline' });
    await rowMenu(page, 'Осмотр машины').click();
    await page.getByRole('menuitem', { name: 'Закрыть приём ответов' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await devScenario(page, { scenario: 'saveFormDraft=revision_mismatch' });
    await enter(page, 'Осмотр машины');
    await qrow(page, 'Уровень топлива').click();
    await card(page).getByRole('textbox', { name: 'Вопрос', exact: true }).fill('Топливо');
    await expect(page.locator('.ox-fm-save')).toContainText('Черновик не сохранён:', {
      timeout: 15_000,
    });
    await devScenario(page, { scenario: null });
    await app(`/t/${alta}/forms?form=00000000-0000-4000-8000-000000000000`, { persona: 'owner' });
    await expect(page.locator('.ox-fm-err')).toContainText('Форма не найдена', { timeout: 15_000 });
    await expect(h1(page, H1)).toBeVisible();
  });

  test('клавиатура и axe; 390: без горизонтальной прокрутки, цели 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    expect(await serious(page, axe)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(root(page))).toEqual([]);
    // Клавиатура: Tab до строки формы и Enter открывает редактор. Фокус поля поиска виден (рамка поля).
    await page.getByRole('searchbox', { name: 'Поиск формы' }).focus();
    expect(
      await page
        .locator('.ox-fm-search')
        .evaluate((el) => getComputedStyle(el).outlineStyle !== 'none'),
      'фокус «Поиска формы» виден',
    ).toBe(true);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (
        await row(page, 'Осмотр машины')
          .locator('.ox-fm-row-open')
          .evaluate((e) => e === document.activeElement)
      )
        break;
    }
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'Конструктор' })).toBeVisible();
    await expect(page.locator('.ox-fm-page').first()).toBeVisible({ timeout: 15_000 });
    expect(await serious(page, axe)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(root(page))).toEqual([]);
    // На телефоне название страницы конструктора читается целиком (кнопки — второй строкой).
    if (phone(page)) {
      const title = page.locator('.ox-fm-page-title').nth(1);
      expect(await title.evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(200);
      expect(await title.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    }
    await qrow(page, 'Описание дефекта').click();
    expect(await serious(page, axe)).toEqual([]);
    if (phone(page)) expect(await smallTargets(card(page))).toEqual([]);
    await card(page).getByRole('button', { name: 'Свернуть вопрос' }).click();
    // Карточка с вариантами (идентификаторы «o1…o4») и вопрос без текста — контраст подписей.
    await qrow(page, 'Уровень топлива').click();
    await expect(card(page).locator('.ox-fm-opt-id').first()).toBeVisible();
    expect(await serious(page, axe)).toEqual([]);
    await card(page).getByRole('textbox', { name: 'Вопрос', exact: true }).fill('');
    await card(page).getByRole('button', { name: 'Свернуть вопрос' }).click();
    await expect(page.locator('.ox-fm-q-label[data-empty]')).toHaveText(/^Вопрос без текста/);
    expect(await serious(page, axe)).toEqual([]);
    await page
      .locator('.ox-fm-page')
      .first()
      .getByRole('button', { name: 'Добавить вопрос' })
      .click();
    await page.getByRole('button', { name: 'Показать все вопросы' }).click();
    expect(await serious(page, axe)).toEqual([]);
    if (phone(page)) expect(await smallTargets(page.locator('.ox-fm-pick'))).toEqual([]);
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    expect(await serious(page, axe)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(root(page))).toEqual([]);
  });
});

// Backend «Форм и опросов» — W4.21 (не в main): тег Forms на стенде отвечает 501.
test.describe('forms — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: список и конструктор «Осмотра машины»', async ({ app, page }) => {
    test.fixme(true, 'W4.21: хендлеры тега Forms (listForms, getForm, getFormDraft) не в main');
    await open(app, page);
    await enter(page, 'Осмотр машины');
    await expect(qrow(page, 'Уровень топлива')).toBeVisible();
  });

  test('владелец на стенде: черновик из шаблона и публикация v1', async ({ app, page }) => {
    test.fixme(true, 'W4.21: createForm, saveFormDraft, publishForm не в main');
    await open(app, page);
    await page.getByRole('button', { name: 'Анкета', exact: true }).click();
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать v1' }).click();
    await expect(page.locator('.ox-fm-ed-meta')).toContainText('Принимает ответы · v1');
  });
});
