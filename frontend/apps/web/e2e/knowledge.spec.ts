// W4.32 · e2e страницы `knowledge` «База знаний» (KB-01…KB-08; эталон design-2026-10-19 «База знаний.dc.html» М:21–375,
// в CRM — pg.knowledge :1825–1827; разбор docs/plan/v2/analysis/dor/knowledge.md §1, §6.1 — девять экранов
// screens.yaml). Данные — MSW W4.04 поверх домена W4.30 (сид «Базы знаний» «Альты»); backend — W4.31 (режим stand).
// Обязательные пункты verification-protocol §1.3: меню и URL, состояния (загрузка, ошибка, нет связи, 404),
// клавиатура, axe, 390 / 1440.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';

const H1 = 'База знаний';
const SUB = 'Пространства и страницы, доступные вам по ролям';
const OWNER_SPACES = ['Логистика', 'Салон и SPA', 'Руководство', 'Ремонт и стройка', 'Общее'];
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const RATE = 'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.';

const list = (page: Page): Locator => page.locator('section[aria-labelledby="kb-h"]');
const cards = (page: Page): Locator => list(page).locator('.ox-kb-card');
const card = (page: Page, name: string): Locator =>
  cards(page).filter({ has: page.getByText(name, { exact: true }) });
const space = (page: Page, name: string): Locator =>
  page.locator(`section.ox-kb-space[aria-label="${name}"]`);
const tabs = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Разделы пространства' });
const tab = (page: Page, name: string): Locator =>
  tabs(page).getByRole('button', { name, exact: false });
const tree = (page: Page): Locator => page.getByRole('navigation', { name: 'Дерево пространства' });
const node = (page: Page, title: string): Locator =>
  tree(page).locator('.ox-kb-node-title', { hasText: title }).first();
const article = (page: Page): Locator => page.locator('article.ox-kb-article');
const pageTitle = (page: Page): Locator => article(page).getByRole('heading', { level: 2 });
const dialog = (page: Page): Locator => page.getByRole('dialog');
const banner = (page: Page): Locator => page.locator('.ox-kb-err[role="alert"]');

/** «База знаний» организации по прямому URL (`search` — `?space=&page=&tab=`). */
async function open(
  app: Parameters<typeof openPage>[0],
  page: Page,
  o: {
    persona?: 'owner' | 'manager' | 'driver' | 'therapist' | 'foreman';
    search?: string;
    preset?: string;
  } = {},
): Promise<string> {
  const id = await openPage(app, page, `knowledge${o.search ?? ''}`, {
    persona: o.persona ?? 'owner',
    ...(o.preset ? { preset: o.preset } : {}),
  });
  if (!o.search) await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
  return id;
}

/** Открыть пространство из списка и дождаться дерева. */
async function enter(page: Page, name: string): Promise<void> {
  await card(page, name).click();
  await expect(space(page, name)).toBeVisible();
  await expect(pageTitle(page)).toBeVisible({ timeout: 15_000 });
}

/** Выбрать узел дерева (на телефоне — через «Дерево»). */
async function pick(page: Page, title: string): Promise<void> {
  // Узкий контейнер (телефон, рабочее место водителя) — дерево или страница (М:487).
  if ((await tree(page).count()) === 0) {
    await page.getByRole('button', { name: 'Дерево', exact: true }).click();
  }
  await node(page, title).click();
  await expect(pageTitle(page)).toHaveText(title);
}

/** Развернуть папку дерева. */
async function expand(page: Page, title: string): Promise<void> {
  // Узкий контейнер (телефон, рабочее место водителя) — дерево или страница (М:487).
  if ((await tree(page).count()) === 0) {
    await page.getByRole('button', { name: 'Дерево', exact: true }).click();
  }
  const row = tree(page).getByRole('treeitem').filter({ hasText: title }).first();
  await row.getByRole('button', { name: 'Развернуть' }).click();
}

/** Пункт меню «Действия со страницей». */
async function menu(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Действия со страницей' }).click();
  await page.getByRole('menuitem', { name: item }).click();
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

/**
 * Цели нажатия области `root` на телефоне меньше 44 × 44 px (verification-protocol §1.3): «подпись: высота×ширина».
 * Флажок и переключатель-радио внутри `label` меряются по `label` (нажатие на подпись переключает их).
 */
async function smallTargets(root: Locator): Promise<string[]> {
  const els = root.locator(
    'button, select, textarea, input:not([type="hidden"]), [role="switch"], a[href]',
  );
  const out: string[] = [];
  for (const el of await els.all()) {
    if (!(await el.isVisible())) continue;
    if ((await el.getAttribute('aria-hidden')) === 'true') continue;
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

/** Нарушения axe уровня serious и critical: «правило: цели». */
async function serious(page: Page, axe: (p: Page) => Promise<AxeResult>): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return (await axe(page)).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

type AxeResult = {
  violations: { id: string; impact?: string | null; nodes: { target: unknown[] }[] }[];
};

test.describe('knowledge — «База знаний» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии сценарного сервера — режим mock');
  test.setTimeout(90_000);

  test('открывается из меню и по прямому URL: заголовок, подзаголовок, карточки пространств', async ({
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
    await expect(page).toHaveURL(/\/knowledge$/);
    await expect(list(page)).toContainText(SUB);
    await expect(cards(page).locator('strong')).toHaveText(OWNER_SPACES);
    await expect(card(page, 'Логистика')).toContainText('Фирма «Север Логистик»');
    await expect(card(page, 'Логистика')).toContainText('Ограниченное');
    await expect(card(page, 'Логистика')).toContainText('16 страниц');
    await expect(card(page, 'Логистика')).toContainText('Руководитель: Марина Котова');
    await expect(card(page, 'Логистика')).toContainText('Вы: владелец бизнеса');
    await expect(card(page, 'Салон и SPA')).toContainText('Руководитель: владелец бизнеса');
    await expect(list(page).getByRole('button', { name: 'Новое пространство' })).toBeVisible();
    await page.reload();
    await expect(cards(page)).toHaveCount(5, { timeout: 15_000 });
  });

  test('поиск по доступным страницам: путь и выдержка, пусто, переход на страницу', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const q = list(page).getByRole('searchbox', { name: 'Поиск по базе знаний' });
    await q.fill('чек');
    const hit = list(page).locator('.ox-kb-hit', { hasText: 'Чек-лист приёмки' });
    await expect(hit.locator('.ox-kb-hit-where')).toHaveText(
      'Логистика › Регламенты › Регламент приёмки смены',
    );
    await expect(hit.locator('.ox-kb-hit-text')).toContainText('Фото с пяти ракурсов');
    await q.fill('несуществующее');
    await expect(list(page)).toContainText('Среди доступных вам страниц ничего не нашлось');
    await q.fill('одометр');
    await list(page).locator('.ox-kb-hit', { hasText: 'Чек-лист приёмки' }).click();
    await expect(space(page, 'Логистика')).toBeVisible();
    await expect(pageTitle(page)).toHaveText('Чек-лист приёмки');
    await expect(page).toHaveURL(/[?&]page=/);
  });

  test('пространство: шапка, вкладки владельца, «Обзор»; ссылка ?space=&page= восстанавливает страницу', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    const s = space(page, 'Логистика');
    await expect(s).toContainText('База знаний · Владелец бизнеса');
    await expect(s).toContainText('Ограниченное · фирма «Север Логистик»');
    await expect(tabs(page).getByRole('button')).toHaveText([
      'Страницы',
      'Участники и доступ',
      'Автоматизация',
      'Архив',
    ]);
    await expect(tab(page, 'Страницы')).toHaveAttribute('aria-current', 'page');
    await expect(pageTitle(page)).toHaveText('Обзор');
    await expect(article(page)).toContainText('Действует · v1');
    await expect(article(page)).toContainText(
      'Страница · владелец Дарья Зимина · обновлено 20.09.2026, Дарья Зимина',
    );
    await pick(page, 'Журнал осмотров машин');
    await page.reload();
    await expect(pageTitle(page)).toHaveText('Журнал осмотров машин', { timeout: 15_000 });
    await s.getByRole('button', { name: 'К списку пространств' }).click();
    await expect(h1(page, H1)).toBeVisible();
    await expect(page).not.toHaveURL(/space=/);
  });

  test('дерево: развернуть и свернуть, поиск в пространстве, чипы статуса и значки доступа', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await expect(node(page, 'Регламент приёмки смены')).toBeVisible();
    await expect(
      tree(page).getByRole('treeitem').filter({ hasText: 'Выезд при критическом дефекте' }),
    ).toContainText('на проверке');
    const fin = tree(page).getByRole('treeitem').filter({ hasText: 'Тарифы и начисления' });
    await expect(fin.locator('[title="Финансовая страница"]')).toHaveCount(1);
    await expect(fin.locator('[title="Свой доступ"]')).toHaveCount(1);
    await tree(page).getByRole('searchbox', { name: 'Найти в пространстве' }).fill('маршрут');
    await expect(tree(page).getByRole('treeitem')).toHaveCount(2);
    await expect(tree(page)).toContainText('Водителям');
    await tree(page).getByRole('searchbox', { name: 'Найти в пространстве' }).fill('ничего такого');
    await expect(tree(page)).toContainText('Ничего не нашлось среди доступных страниц');
  });

  test('страница: таблица, схема, файл, запись CRM; «Открыть» ведёт в модуль записи', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await pick(page, 'Журнал осмотров машин');
    const table = article(page).locator('table');
    await expect(table.locator('th')).toHaveText([
      'Дата',
      'Рейс',
      'Водитель',
      'Пробег, км',
      'Топливо',
      'Дефекты',
      'Ответ',
    ]);
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(article(page)).toContainText(
      'Строки добавляет форма после принятия ответа; исправления — через ответ формы.',
    );
    await pick(page, 'Схема сдачи смены');
    await expect(article(page).locator('figure')).toContainText('Принято · машина в пул');
    await pick(page, 'Договор аренды стоянки.pdf');
    await expect(article(page)).toContainText('PDF · 1,2 МБ · 4 страницы');
    await pick(page, 'Форма «Осмотр машины»');
    await expect(article(page)).toContainText('Форма «Осмотр машины» · действует версия 3');
    await article(page).getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page).toHaveURL(/\/forms$/);
  });

  test('правка: «Опубликовать v3», версии; старая версия и «Восстановить как новую»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await pick(page, 'Регламент приёмки смены');
    await page.getByRole('button', { name: 'Править', exact: true }).click();
    await article(page)
      .getByLabel('Текст · абзацы через пустую строку')
      .fill('Новый текст.\n\nВторой абзац.');
    await article(page).getByRole('button', { name: 'Опубликовать v3' }).click();
    await expect(toast(page)).toHaveText('Опубликована версия 3');
    await expect(article(page).locator('p')).toHaveText(['Новый текст.', 'Второй абзац.']);
    const vers = page.getByRole('complementary', { name: 'О странице' });
    await expect(vers.locator('.ox-kb-ver strong')).toHaveText(['v3', 'v2', 'v1']);
    await vers.locator('.ox-kb-ver', { hasText: 'v1' }).click();
    await expect(article(page)).toContainText('Вы смотрите версию 1 от 05.09.2026. Текущая — v3.');
    await article(page).getByRole('button', { name: 'Восстановить как новую' }).click();
    await expect(toast(page)).toHaveText('Версия 1 восстановлена как новая');
    await expect(vers.locator('.ox-kb-ver strong').first()).toHaveText('v4');
  });

  test('конфликт публикации: страницу изменили — баннер «Страницу уже изменили…»', async ({
    app,
    page,
  }) => {
    const alta = await open(app, page);
    await enter(page, 'Логистика');
    await pick(page, 'Журнал осмотров машин');
    await expect(page).toHaveURL(/[?&]page=/);
    await page.getByRole('button', { name: 'Править', exact: true }).click();
    // Другой участник опубликовал версию мимо экрана.
    const nodeId = new URL(page.url()).searchParams.get('page') ?? '';
    const cur = await call(page, 'GET', `/api/v1/tenants/${alta}/knowledge/nodes/${nodeId}`);
    const other = await call(
      page,
      'POST',
      `/api/v1/tenants/${alta}/knowledge/nodes/${nodeId}/versions`,
      { body: { body: 'Правка другого участника.' }, ifMatch: cur.headers.etag },
    );
    expect(other.status).toBe(201);
    await article(page).getByRole('button', { name: 'Опубликовать v2' }).click();
    await expect(banner(page)).toContainText(
      'Страницу уже изменили (v2). Обновите и повторите правку.',
    );
    await banner(page).getByRole('button', { name: 'Скрыть' }).click();
    await expect(banner(page)).toHaveCount(0);
  });

  test('создание: «+» → «Создать в «Логистика»» → редактор новой страницы', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    if ((await tree(page).count()) === 0) {
      await page.getByRole('button', { name: 'Дерево', exact: true }).click();
    }
    await tree(page).getByRole('button', { name: 'Создать страницу' }).click();
    await expect(dialog(page)).toHaveAccessibleName('Создать в «Логистика»');
    await dialog(page).getByLabel('Название').fill('Ночная смена');
    await dialog(page).getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(toast(page)).toHaveText('Создано');
    await expect(dialog(page)).toHaveCount(0);
    await expect(article(page).getByRole('button', { name: 'Опубликовать v2' })).toBeVisible();
  });

  test('перенос: «Переместить…» показывает, кто потеряет доступ; «Страница перенесена»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await pick(page, 'Как фотографировать машину при осмотре');
    await menu(page, 'Переместить…');
    await expect(dialog(page)).toHaveAccessibleName(
      'Переместить «Как фотографировать машину при осмотре»',
    );
    await expect(dialog(page)).toContainText(
      'Выберите нового родителя — здесь появится, кто получит или потеряет доступ.',
    );
    await dialog(page).getByLabel('Новый родитель').selectOption({ label: 'Тарифы и начисления' });
    await expect(dialog(page)).toContainText('Переносится 1 страница вместе с подстраницами.');
    await expect(dialog(page)).toContainText('Потеряют чтение (страниц): Илья Васильев · 1');
    await dialog(page).getByRole('button', { name: 'Переместить', exact: true }).click();
    await expect(toast(page)).toHaveText('Страница перенесена');
  });

  test('утвердить, в архив и восстановить из «Архива»', async ({ app, page }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await pick(page, 'Выезд при критическом дефекте');
    await menu(page, 'Утвердить');
    await expect(toast(page)).toHaveText('Страница утверждена');
    await expect(article(page)).toContainText('Действует · v1');
    await menu(page, 'В архив');
    await expect(toast(page)).toHaveText('Перенесено в архив');
    await tab(page, 'Архив').click();
    const row = page.locator('.ox-kb-arch-row', { hasText: 'Выезд при критическом дефекте' });
    await expect(row).toContainText('1 страница в ветке');
    await row.getByRole('button', { name: 'Восстановить' }).click();
    await expect(toast(page)).toHaveText('Восстановлено');
    await expect(page.locator('.ox-kb-arch')).toContainText('В архиве ничего нет');
  });

  test('водитель: «Ознакомлен» и «Запросить право правки»', async ({ app, page }) => {
    await open(app, page, { persona: 'driver' });
    await enter(page, 'Логистика');
    await expect(tabs(page).getByRole('button')).toHaveText(['Страницы', 'Участники и доступ']);
    // Кнопка «К списку пространств» не сжимается рядом с подписью роли в две строки (32 px, М:64).
    const back = await space(page, 'Логистика')
      .getByRole('button', { name: 'К списку пространств' })
      .boundingBox();
    expect(back?.width ?? 0).toBeGreaterThanOrEqual(31);
    await expand(page, 'Регламенты');
    await pick(page, 'Регламент приёмки смены');
    await expect(article(page)).toContainText('Подтвердите, что прочитали эту версию.');
    await article(page).getByRole('button', { name: 'Ознакомлен' }).click();
    await expect(toast(page)).toHaveText('Спасибо, отметили');
    await expect(article(page)).toContainText('Вы подтвердили, что ознакомились с этой версией');
    await page.getByRole('button', { name: 'Запросить право правки' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен руководителю пространства');
    await expect(page.getByRole('button', { name: 'Запрос отправлен' })).toBeDisabled();
    // Финансовая ветка скрыта у функции «Водитель».
    if ((await tree(page).count()) === 0) {
      await page.getByRole('button', { name: 'Дерево', exact: true }).click();
    }
    await expect(tree(page)).toContainText('Журнал осмотров машин');
    await expect(tree(page)).not.toContainText('Тарифы и начисления');
  });

  test('доступ руководителя: режим, список, «Что изменится», сохранение', async ({ app, page }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await pick(page, 'Тарифы и начисления');
    await page.getByRole('button', { name: 'Доступ', exact: true }).click();
    await expect(dialog(page)).toHaveAccessibleName('Доступ · Тарифы и начисления');
    await expect(dialog(page)).toContainText('Логистика · 1 подстраница');
    await expect(dialog(page)).toContainText('Настраиваете сейчас');
    await expect(dialog(page).getByRole('button', { name: /Только выбранные/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog(page).getByRole('button', { name: 'Отмена' }).click();
    await expand(page, 'Водителям');
    await pick(page, 'Маршруты');
    await page.getByRole('button', { name: 'Доступ', exact: true }).click();
    await expect(dialog(page)).toHaveAccessibleName('Доступ · Маршруты');
    await expect(dialog(page).getByLabel('Кого добавить')).toBeVisible();
    await dialog(page)
      .getByRole('button', { name: /Только выбранные/ })
      .click();
    await expect(dialog(page)).toContainText('Роль «Редактор» в пространстве');
    await expect(dialog(page).getByRole('complementary')).toContainText(
      'Потеряют чтение (страниц): Илья Васильев · 1',
    );
    await dialog(page).getByRole('button', { name: 'Сохранить · 1 страница' }).click();
    await expect(toast(page)).toHaveText('Доступ сохранён');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('доступ читателя: только чтение и «Закрыть»; Escape закрывает диалог', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'driver' });
    await enter(page, 'Логистика');
    await page.getByRole('button', { name: 'Кто видит и почему' }).click();
    await expect(dialog(page)).toContainText(
      'Доступ меняет руководитель пространства (Марина Котова). Здесь видно, кто читает и правит.',
    );
    await expect(dialog(page).getByRole('button', { name: /^Сохранить/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Доступ', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Закрыть' }).last().click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('участники и доступ: роли, добавить, сменить роль, карта и «Проверить сотрудника»', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'manager', preset: 'logistics-ready' });
    await enter(page, 'Логистика');
    await tab(page, 'Участники и доступ').click();
    const roles = page.locator('.ox-kb-role');
    await expect(roles.locator('strong')).toHaveText([
      'Руководитель пространства',
      'Редактор',
      'Читатель',
      'По уровню «Ограниченное»',
    ]);
    await expect(roles.first()).toContainText('Марина Котова');
    await page
      .getByLabel('Сотрудник', { exact: true })
      .first()
      .selectOption({ label: 'Илья Васильев' });
    await page.getByRole('button', { name: 'Добавить в пространство' }).click();
    await expect(toast(page)).toHaveText('Добавлен(а) в пространство');
    await expect(roles.nth(2)).toContainText('Илья Васильев');
    await roles.nth(2).getByLabel('Роль в пространстве').selectOption({ label: 'Редактор' });
    await expect(toast(page)).toHaveText('Роль изменена');
    const map = page.locator('.ox-kb-map');
    await expect(map).toContainText('Карта доступа');
    await map.locator('.ox-kb-cell').nth(1).click();
    const why = page.getByRole('complementary', { name: 'Почему так' });
    await expect(why).toContainText('Проверить сотрудника');
    await expect(why.locator('.ox-kb-res')).not.toBeEmpty();
  });

  test('автоматизация: правила, переключатель, «Проверить сроки сейчас», журнал', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await tab(page, 'Автоматизация').click();
    await expect(page.locator('.ox-kb-rule strong')).toHaveText([
      'Новая версия регламента → попросить ознакомиться заново',
      'Пора пересмотреть страницу → уведомить владельца',
    ]);
    await page.getByRole('switch', { name: 'Правило включено' }).first().click();
    await expect(toast(page)).toHaveText('Правило выключено');
    await page.getByRole('button', { name: 'Проверить сроки сейчас' }).click();
    await expect(toast(page)).toHaveText('Проверка выполнена');
    await expect(page.locator('.ox-kb-runs')).toContainText('Журнал запусков');
  });

  test('новое пространство из шаблона', async ({ app, page }) => {
    await open(app, page);
    await list(page).getByRole('button', { name: 'Новое пространство' }).click();
    await expect(dialog(page)).toHaveAccessibleName('Новое пространство');
    const ok = dialog(page).getByRole('button', { name: 'Создать пространство' });
    await expect(ok).toBeDisabled();
    await dialog(page).getByLabel('Название').fill('Охрана труда');
    await dialog(page)
      .getByRole('button', { name: /Регламенты подразделения/ })
      .click();
    await ok.click();
    await expect(toast(page)).toHaveText('Пространство создано');
    await expect(space(page, 'Охрана труда')).toBeVisible();
    await expect(pageTitle(page)).toHaveText('Обзор');
  });

  test('ошибка загрузки — «Повторить»; загрузка — скелетон', async ({ app, page }) => {
    await openPage(app, page, 'home');
    const alta = page.url().match(/\/t\/([^/]+)\//)?.[1] ?? '';
    await devScenario(page, { scenario: 'listKnowledgeSpaces=rate_limited' });
    await app(`/t/${alta}/knowledge`, { persona: 'owner' });
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: 'listKnowledgeSpaces=delay=1500' });
    await page.getByRole('main').getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(cards(page)).toHaveCount(5, { timeout: 15_000 });
  });

  test('нет связи — тост команды и повтор; скрытое пространство по ссылке — баннер и список', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'driver' });
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await pick(page, 'Регламент приёмки смены');
    // Сеть обрывается на команде (сценарий сервера: запрос не доходит, PD-31).
    await devScenario(page, { scenario: 'ackKnowledgeNode=offline' });
    await article(page).getByRole('button', { name: 'Ознакомлен' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await devScenario(page, { scenario: null });
    await article(page).getByRole('button', { name: 'Ознакомлен' }).click();
    await expect(toast(page)).toHaveText('Спасибо, отметили');
    // Закрытое пространство «Руководство» водителю не видно: в списке его нет, ссылка — 404.
    const own = (
      (await call(page, 'GET', `/api/v1/tenants/${await tenantId(page)}/knowledge/spaces`))
        .body as { items: { name: string }[] }
    ).items.map((x) => x.name);
    expect(own).not.toContain('Руководство');
    await open(app, page, {
      persona: 'driver',
      search: '?space=00000000-0000-5000-8000-000000000000',
    });
    await expect(banner(page)).toContainText('Пространство не найдено');
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
  });

  test('1440 — боковая панель; 390 — дерево или страница и «Дерево»; карта прокручивается', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    // Узкий контейнер (< 860 px: телефон и планшет 768) — дерево или страница (М:487).
    if ((await tree(page).count()) === 0) {
      const nav = phone(page) ? 'Навигация' : 'Основная навигация';
      await expect(page.getByRole('navigation', { name: nav, exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Дерево', exact: true }).click();
      await expect(tree(page)).toBeVisible();
      await expect(article(page)).toHaveCount(0);
      await node(page, 'Журнал осмотров машин').click();
      await expect(pageTitle(page)).toHaveText('Журнал осмотров машин');
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
      await expect(tree(page)).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    await tab(page, 'Участники и доступ').click();
    await expect(page.locator('.ox-kb-map')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('клавиатура: Tab до дерева, Enter открывает страницу; фокус виден', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    if ((await tree(page).count()) === 0) {
      await page.getByRole('button', { name: 'Дерево', exact: true }).click();
    }
    const target = node(page, 'Журнал осмотров машин');
    await expect(target).toBeVisible();
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el.closest('button') === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(
      await target.evaluate((el) => getComputedStyle(el.closest('button') as Element).outlineStyle),
    ).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(pageTitle(page)).toHaveText('Журнал осмотров машин');
  });

  test('список и «Новое пространство»: axe без serious; 390 — все цели не меньше 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await expect(cards(page)).toHaveCount(5);
    expect(await serious(page, axe)).toEqual([]);
    if (phone(page)) expect(await smallTargets(list(page))).toEqual([]);
    await list(page).getByRole('button', { name: 'Новое пространство' }).click();
    await expect(dialog(page)).toHaveAccessibleName('Новое пространство');
    // Снятый узел шаблона — серый текст (контраст).
    await dialog(page).getByRole('checkbox').first().click();
    await expect(dialog(page).getByRole('checkbox').first()).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(await serious(page, axe)).toEqual([]);
    if (phone(page)) expect(await smallTargets(dialog(page))).toEqual([]);
  });

  test('«Участники и доступ»: axe без serious; 390 — все цели не меньше 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await tab(page, 'Участники и доступ').click();
    await expect(page.locator('.ox-kb-role').nth(2)).toContainText('Никого');
    await expect(page.locator('.ox-kb-map .ox-kb-cell').first()).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Почему так' }).locator('.ox-kb-res'),
    ).not.toContainText('Нажмите');
    expect(await serious(page, axe)).toEqual([]);
    if (phone(page)) expect(await smallTargets(space(page, 'Логистика'))).toEqual([]);
  });

  test('«Автоматизация» и «Архив»: axe без serious; 390 — все цели не меньше 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await pick(page, 'Выезд при критическом дефекте');
    await menu(page, 'В архив');
    await expect(toast(page)).toHaveText('Перенесено в архив');
    await tab(page, 'Автоматизация').click();
    await expect(page.locator('.ox-kb-rule')).toHaveCount(2);
    await expect(page.locator('.ox-kb-runs')).toContainText('24.09 18:10');
    expect(await serious(page, axe)).toEqual([]);
    if (phone(page)) expect(await smallTargets(space(page, 'Логистика'))).toEqual([]);
    await tab(page, 'Архив').click();
    await expect(page.locator('.ox-kb-arch-row')).toHaveCount(1);
    expect(await serious(page, axe)).toEqual([]);
    if (phone(page)) expect(await smallTargets(space(page, 'Логистика'))).toEqual([]);
    await space(page, 'Логистика').getByRole('button', { name: 'К списку пространств' }).click();
    await enter(page, 'Ремонт и стройка');
    await tab(page, 'Автоматизация').click();
    await expect(page.getByRole('button', { name: 'Открыть раздел' }).first()).toBeVisible();
    if (phone(page)) expect(await smallTargets(space(page, 'Ремонт и стройка'))).toEqual([]);
  });

  test('страница, старая версия и правка: axe без serious; значок баннера версии; 390 — цели 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await pick(page, 'Регламент приёмки смены');
    expect(await serious(page, axe)).toEqual([]);
    if (phone(page)) expect(await smallTargets(space(page, 'Логистика'))).toEqual([]);
    await page
      .getByRole('complementary', { name: 'О странице' })
      .locator('.ox-kb-ver', { hasText: 'v1' })
      .click();
    const old = article(page).locator('.ox-kb-old');
    await expect(old).toContainText('Вы смотрите версию 1 от 05.09.2026. Текущая — v2.');
    // Значок баннера своей ширины (18 px), текст забирает остаток строки (М:137).
    const icon = await old.locator('.material-symbols-rounded').first().boundingBox();
    expect(icon?.width ?? 99).toBeLessThan(24);
    expect(await serious(page, axe)).toEqual([]);
    if (phone(page)) expect(await smallTargets(space(page, 'Логистика'))).toEqual([]);
    await article(page).getByRole('button', { name: 'К текущей версии' }).click();
    await page.getByRole('button', { name: 'Править', exact: true }).click();
    await expect(article(page).getByRole('button', { name: 'Опубликовать v3' })).toBeVisible();
    expect(await serious(page, axe)).toEqual([]);
    if (phone(page)) expect(await smallTargets(space(page, 'Логистика'))).toEqual([]);
  });

  test('ошибки загрузки вкладок: «Автоматизация» — текст и «Повторить», затем правила', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await devScenario(page, { scenario: 'listKnowledgeRules=rate_limited' });
    await tab(page, 'Автоматизация').click();
    const rules = page.locator('.ox-kb-auto-rules');
    await expect(rules.getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
      { timeout: 20_000 },
    );
    await devScenario(page, { scenario: null });
    await rules.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('.ox-kb-rule')).toHaveCount(2);
  });

  test('поиск по базе знаний: 429 и нет связи — текст ошибки и «Повторить»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const q = list(page).getByRole('searchbox', { name: 'Поиск по базе знаний' });
    await devScenario(page, { scenario: 'searchKnowledge=rate_limited' });
    await q.fill('одометр');
    const hits = list(page).locator('.ox-kb-hits');
    await expect(hits.getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
      { timeout: 20_000 },
    );
    await devScenario(page, { scenario: 'searchKnowledge=offline' });
    await q.fill('чек-лист');
    await expect(hits.getByRole('alert')).toContainText('Не удалось загрузить данные', {
      timeout: 20_000,
    });
    await devScenario(page, { scenario: null });
    await hits.getByRole('button', { name: 'Повторить' }).click();
    await expect(list(page).locator('.ox-kb-hit').first()).toBeVisible();
  });

  test('«В архив» и сразу вкладка «Архив»: после ответа вкладка остаётся «Архив»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await pick(page, 'Выезд при критическом дефекте');
    await devScenario(page, { scenario: 'archiveKnowledgeNode=delay=1500' });
    await menu(page, 'В архив');
    await tab(page, 'Архив').click();
    await expect(page).toHaveURL(/[?&]tab=arch/);
    // Ответ команды задержан сценарием на 1,5 с.
    await expect(toast(page)).toHaveText('Перенесено в архив', { timeout: 15_000 });
    await devScenario(page, { scenario: null });
    await expect(page.locator('.ox-kb-arch-row')).toContainText('Выезд при критическом дефекте');
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/[?&]tab=arch/);
    await expect(tab(page, 'Архив')).toHaveAttribute('aria-current', 'page');
  });

  test('390: выбор узла в длинном дереве — страница сверху, шапка пространства видна', async ({
    app,
    page,
  }) => {
    test.skip(!phone(page), 'узкий вид — телефон');
    await open(app, page);
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await expand(page, 'Водителям');
    await expand(page, 'Тарифы и начисления');
    const last = tree(page).getByRole('treeitem').last();
    await last.scrollIntoViewIfNeeded();
    const title = (await last.locator('.ox-kb-node-title').textContent()) ?? '';
    await last.locator('.ox-kb-node').click();
    await expect(pageTitle(page)).toHaveText(title);
    const head = await space(page, 'Логистика').locator('.ox-kb-space-head').boundingBox();
    expect(head?.y ?? -1).toBeGreaterThanOrEqual(0);
  });

  test('axe без serious; 390 — цели не меньше 44 px', async ({ app, page, axe }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    if (!phone(page)) return;
    expect(
      await hitHeight(page.getByRole('button', { name: 'Дерево', exact: true })),
    ).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(page.getByRole('button', { name: 'Править', exact: true })),
    ).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(tab(page, 'Страницы'))).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  // Возврат 2: состояния поиска в дереве под axe, ошибки и загрузка «Архива», шаблонов и областей «Нового
  // пространства», кандидатов «Добавить в пространство»; длинное название на телефоне.
  for (const persona of ['owner', 'driver'] as const) {
    test(`поиск в дереве (${persona}): путь совпадения и пустой результат — axe без serious`, async ({
      app,
      page,
      axe,
    }) => {
      await open(app, page, { persona });
      await enter(page, 'Логистика');
      if ((await tree(page).count()) === 0) {
        await page.getByRole('button', { name: 'Дерево', exact: true }).click();
      }
      // Дерево на телефоне: шевроны, «+» и узлы — не меньше 44 × 44 px.
      if (phone(page)) expect(await smallTargets(tree(page))).toEqual([]);
      const q = tree(page).getByRole('searchbox', { name: 'Найти в пространстве' });
      await q.fill('маршрут');
      await expect(tree(page).locator('.ox-kb-node-where').first()).toBeVisible();
      expect(await serious(page, axe)).toEqual([]);
      await q.fill('ничего такого');
      await expect(tree(page)).toContainText('Ничего не нашлось среди доступных страниц');
      expect(await serious(page, axe)).toEqual([]);
    });
  }

  test('«Архив»: ошибка списка — текст и «Повторить»; повтор — «Загрузка», затем список', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await devScenario(page, { scenario: 'listKnowledgeArchive=rate_limited' });
    await tab(page, 'Архив').click();
    const arch = page.locator('.ox-kb-arch');
    await expect(arch.getByRole('alert')).toHaveText(RATE, { timeout: 20_000 });
    await devScenario(page, { scenario: 'listKnowledgeArchive=delay=1500' });
    await arch.getByRole('button', { name: 'Повторить' }).click();
    await expect(arch.getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(arch).toContainText('В архиве ничего нет', { timeout: 15_000 });
  });

  test('«Новое пространство»: ошибка шаблонов — «Повторить», создать нельзя до загрузки', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await devScenario(page, { scenario: 'listKnowledgeSpaceTemplates=rate_limited' });
    await list(page).getByRole('button', { name: 'Новое пространство' }).click();
    await dialog(page).getByLabel('Название').fill('Охрана труда');
    await expect(dialog(page).getByRole('alert').filter({ hasText: RATE })).toBeVisible({
      timeout: 20_000,
    });
    const ok = dialog(page).getByRole('button', { name: 'Создать пространство' });
    await expect(ok).toBeDisabled();
    await devScenario(page, { scenario: 'listKnowledgeSpaceTemplates=delay=1500' });
    await dialog(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(dialog(page).getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(ok).toBeDisabled();
    await devScenario(page, { scenario: null });
    await expect(
      dialog(page).getByRole('button', { name: /Регламенты подразделения/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(ok).toBeEnabled();
  });

  test('«Новое пространство»: ошибка областей — текст и «Повторить» у «Область»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    const alta = page.url().match(/\/t\/([^/]+)\//)?.[1] ?? '';
    await devScenario(page, { scenario: 'listOrgUnits=rate_limited' });
    await app(`/t/${alta}/knowledge`, { persona: 'owner' });
    await expect(cards(page)).toHaveCount(5, { timeout: 15_000 });
    await list(page).getByRole('button', { name: 'Новое пространство' }).click();
    await expect(dialog(page).getByRole('alert').filter({ hasText: RATE })).toBeVisible({
      timeout: 20_000,
    });
    await devScenario(page, { scenario: null });
    await dialog(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(dialog(page).getByRole('alert').filter({ hasText: RATE })).toHaveCount(0);
  });

  test('«Участники и доступ»: ошибка кандидатов — текст и «Повторить» в «Добавить в пространство»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await devScenario(page, { scenario: 'listKnowledgeAccessCandidates=rate_limited' });
    await tab(page, 'Участники и доступ').click();
    const add = page.locator('.ox-kb-add');
    await expect(add.getByRole('alert')).toHaveText(RATE, { timeout: 20_000 });
    await devScenario(page, { scenario: null });
    await add.getByRole('button', { name: 'Повторить' }).click();
    await expect
      .poll(() => add.getByRole('combobox', { name: 'Сотрудник' }).locator('option').count())
      .toBeGreaterThan(1);
  });

  test('390: название из 120 знаков без пробелов не растягивает список и шапку пространства', async ({
    app,
    page,
  }) => {
    test.skip(!phone(page), 'телефон');
    await open(app, page);
    const name = 'Охранатрудаитехникабезопасности'.repeat(4).slice(0, 120);
    await list(page).getByRole('button', { name: 'Новое пространство' }).click();
    await dialog(page).getByLabel('Название').fill(name);
    await dialog(page).getByRole('button', { name: 'Создать пространство' }).click();
    await expect(toast(page)).toHaveText('Пространство создано');
    await expect(space(page, name)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await space(page, name).getByRole('button', { name: 'К списку пространств' }).click();
    await expect(cards(page)).toHaveCount(6);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('страница: ошибка getKnowledgeNode — текст и «Повторить», загрузка — «Загрузка» (узкий и широкий)', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    const pages = page.locator('.ox-kb-pages');
    await devScenario(page, { scenario: 'getKnowledgeNode=rate_limited' });
    // На телефоне дерево — через «Дерево»; нажатие на узел показывает ошибку вместо дерева.
    if ((await tree(page).count()) === 0) {
      await page.getByRole('button', { name: 'Дерево', exact: true }).click();
    }
    await node(page, 'Журнал осмотров машин').click();
    await expect(pages.getByRole('alert')).toHaveText(RATE, { timeout: 20_000 });
    // Узкий контейнер (< 860 px: телефон и 768) — область страницы вместо дерева.
    if ((await pages.getAttribute('data-narrow')) !== null) {
      await expect(tree(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Дерево', exact: true })).toBeVisible();
    } else {
      await expect(tree(page)).toBeVisible();
    }
    await devScenario(page, { scenario: 'getKnowledgeNode=delay=1500' });
    await pages.getByRole('button', { name: 'Повторить' }).click();
    await expect(pages.getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(pageTitle(page)).toHaveText('Журнал осмотров машин', { timeout: 15_000 });
    await expect(pages.getByRole('alert')).toHaveCount(0);
  });

  test('старая версия: ошибка — текст и «Повторить» в просмотре; повтор — версия', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await pick(page, 'Регламент приёмки смены');
    await devScenario(page, { scenario: 'getKnowledgeNodeVersion=rate_limited' });
    await page.locator('aside.ox-kb-aside .ox-kb-ver').nth(1).click();
    await expect(article(page).getByRole('alert')).toHaveText(RATE, { timeout: 20_000 });
    await devScenario(page, { scenario: null });
    await article(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(article(page)).toContainText('Вы смотрите версию 1', { timeout: 15_000 });
  });

  test('«Доступ · …»: ошибка загрузки — диалог с текстом и «Повторить»; повтор — записи', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await enter(page, 'Логистика');
    await pick(page, 'Тарифы и начисления');
    await devScenario(page, { scenario: 'getKnowledgeNodeAccess=rate_limited' });
    await page.getByRole('button', { name: 'Доступ', exact: true }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Доступ · Тарифы и начисления' });
    await expect(dlg.getByRole('alert').filter({ hasText: RATE })).toBeVisible({
      timeout: 20_000,
    });
    await devScenario(page, { scenario: null });
    await dlg.getByRole('button', { name: 'Повторить' }).click();
    await expect(dlg).toContainText('Марина Котова', { timeout: 15_000 });
    await expect(dlg.getByRole('alert').filter({ hasText: RATE })).toHaveCount(0);
  });

  test('390: прямая ссылка на «Архив» — активная вкладка видна в полосе вкладок', async ({
    app,
    page,
  }) => {
    test.skip(!phone(page), 'телефон');
    const id = await open(app, page);
    const spaces = (await call(page, 'GET', `/api/v1/tenants/${id}/knowledge/spaces`)).body as {
      items: { id: string; name: string }[];
    };
    const log = spaces.items.find((s) => s.name === 'Логистика')?.id ?? '';
    await app(`/t/${id}/knowledge?space=${log}&tab=arch`, { persona: 'owner' });
    await expect(page.locator('.ox-kb-arch')).toBeVisible({ timeout: 15_000 });
    const active = tabs(page).locator('[aria-current="page"]');
    await expect(active).toHaveText(/Архив/);
    const [nav, el] = await Promise.all([tabs(page).boundingBox(), active.boundingBox()]);
    expect(el && nav && el.x >= nav.x - 1 && el.x + el.width <= nav.x + nav.width + 1).toBe(true);
  });
});

// Backend «Базы знаний» — W4.31 (в main): тег Knowledge в cmd/api, Go-сид БЗ «Альты».
test.describe('knowledge — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: пространства и дерево «Логистики»', async ({ app, page }) => {
    // W4.31: listKnowledgeSpaces, getKnowledgeSpaceTree, getKnowledgeNode стенда (Go-сид БЗ).
    test.slow();
    await open(app, page);
    await enter(page, 'Логистика');
    await expect(pageTitle(page)).toHaveText('Обзор');
  });

  test('водитель на стенде: ознакомление с регламентом', async ({ app, page }) => {
    // W4.31: ackKnowledgeNode стенда.
    test.slow();
    await open(app, page, { persona: 'driver' });
    await enter(page, 'Логистика');
    await expand(page, 'Регламенты');
    await pick(page, 'Регламент приёмки смены');
    await expect(article(page).getByRole('button', { name: 'Ознакомлен' })).toBeVisible();
  });
});
