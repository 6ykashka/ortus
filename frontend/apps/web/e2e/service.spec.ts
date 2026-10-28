// W7.32 · e2e страницы `service` «Обращения» (`/t/:tenantId/service`; эталон design-2026-10-19 «Обращения.dc.html»,
// разбор docs/plan/v2/analysis/dor/service.md §1.1): очередь, «Низкие оценки», «Обращение по звонку», карточка.
// Режим mock — сценарный сервер W7.00 (контракт 0.12.0-stage7, сид «Альты»: 4 направления, 8 обращений, 2 низкие оценки,
// «сейчас» 1.10 16:24); stand — настоящий backend W7.31 (@stand, W2.103). Персонажи: владелец (все направления) и
// логист Котова («Грузоперевозки»). Пункты verification-protocol §1.3: загрузка и ошибка списка (Vitest), нет связи,
// клавиатура, раскладка 390 / 1440, axe.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { runLabel } from './_stand/stand.ts';
import { h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';

const main = (page: Page): Locator => page.locator('section.ox-sv');
const rows = (page: Page): Locator => main(page).locator('.ox-sv-row:not(.ox-sv-thead)');
const rowOf = (page: Page, key: string): Locator =>
  rows(page).filter({ has: page.locator('.ox-sv-key', { hasText: key }) });
const keys = (page: Page): Promise<string[]> => rows(page).locator('.ox-sv-key').allTextContents();
const queue = (page: Page, name: RegExp): Locator => main(page).getByRole('button', { name });
const card = (page: Page): Locator => main(page).locator('.ox-sv-cardbody');
const aside = (page: Page): Locator => main(page).locator('aside.ox-sv-aside');
const status = (page: Page): Locator =>
  main(page).locator('.ox-sv-cardhead .ox-sv-chiprow .ox-sv-chip').nth(1);

async function openService(
  app: Parameters<typeof openPage>[0],
  page: Page,
  persona: 'owner' | 'manager' = 'owner',
  search = '',
): Promise<string> {
  const id = await openPage(app, page, `service${search}`, { persona });
  await expect(h1(page, 'Обращения')).toBeVisible({ timeout: 15_000 });
  return id;
}

async function openRequest(
  app: Parameters<typeof openPage>[0],
  page: Page,
  key: string,
  persona: 'owner' | 'manager' = 'owner',
): Promise<void> {
  await openService(app, page, persona);
  await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
  await rowOf(page, key).locator('.ox-sv-key').click();
  await expect(card(page)).toBeVisible();
}

test.describe('service — страница «Обращения» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  test('владелец: шапка, подзаголовок, очереди со счётчиками, строки по самому раннему сроку', async ({
    app,
    page,
  }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(main(page)).toContainText(
      'Все мои направления · открытые · сначала самый ранний срок',
    );
    await expect(main(page).getByRole('button', { name: 'Обращение по звонку' })).toBeVisible();
    expect(await keys(page)).toEqual([
      'ГРЗ-57',
      'МАС-41',
      'МАС-40',
      'КОС-6',
      'ОТД-12',
      'ОТД-11',
      'ГРЗ-55',
    ]);
    await expect(queue(page, /^Срок нарушен/)).toContainText('1');
    await expect(queue(page, /^Низкие оценки/)).toContainText('2');
    await expect(rowOf(page, 'ГРЗ-57')).toContainText('просрочен на 1 ч 10 мин');
    await expect(rowOf(page, 'ГРЗ-55')).toContainText('ждём клиента');
    await expect(rowOf(page, 'МАС-41')).toContainText('SMS · оценка 2 из 5');
    await expect(rowOf(page, 'МАС-40')).toContainText('Без привязки');
  });

  test('очереди «Срок нарушен», «Ждут клиента», «Решено и закрыто» и пустая «Срок под угрозой»', async ({
    app,
    page,
  }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    await queue(page, /^Срок нарушен/).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, 'ГРЗ-57')).toBeVisible();
    await queue(page, /^Ждут клиента/).click();
    await expect(rowOf(page, 'ГРЗ-55')).toBeVisible();
    await queue(page, /^Срок под угрозой/).click();
    await expect(main(page)).toContainText('В этой очереди пусто');
    await queue(page, /^Решено и закрыто/).click();
    await expect(rows(page)).toHaveCount(1);
  });

  test('направление «Массаж», поиск и фильтры «Тип» и «Канал»', async ({ app, page }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    await queue(page, /^Массаж/).click();
    await expect(main(page)).toContainText('Массаж · открытые · сначала самый ранний срок');
    await expect(rows(page)).toHaveCount(2);
    await queue(page, /^Все мои/).click();
    await expect(rows(page)).toHaveCount(7);
    await main(page).getByLabel('Поиск').fill('Гусева');
    await expect(rows(page)).toHaveCount(1);
    await main(page).getByLabel('Поиск').fill('');
    await main(page).getByLabel('Тип').selectOption('question');
    await expect(rowOf(page, 'МАС-40')).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await main(page).getByLabel('Тип').selectOption('');
    await main(page).getByLabel('Канал').selectOption('sms');
    await expect(rows(page)).toHaveCount(1);
  });

  test('«Взять себе» назначает на себя', async ({ app, page }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    await rowOf(page, 'КОС-6').getByRole('button', { name: 'Взять себе' }).click();
    await expect(toast(page)).toHaveText('КОС-6 назначено на вас');
    await expect(rowOf(page, 'КОС-6')).toContainText('Дарья Зимина');
    await expect(rowOf(page, 'КОС-6').getByRole('button', { name: 'Взять себе' })).toHaveCount(0);
  });

  test('«Низкие оценки»: «Просмотрено», «Открыть жалобу» → карточка', async ({ app, page }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    await queue(page, /^Низкие оценки/).click();
    await expect(main(page).locator('.ox-sv-rating')).toHaveCount(2);
    await expect(main(page)).toContainText('Оценки 1–3, где клиент не просил связаться.');
    await main(page).getByRole('button', { name: 'Просмотрено' }).first().click();
    await expect(toast(page)).toHaveText('Оценка отмечена просмотренной');
    await expect(main(page).locator('.ox-sv-rating')).toHaveCount(1);
    await main(page).getByRole('button', { name: 'Открыть жалобу' }).click();
    await expect(card(page)).toBeVisible();
    await expect(status(page)).toContainText('В работе');
  });

  test('«Обращение по звонку»: проверка полей, подсказка, заведено → карточка', async ({
    app,
    page,
  }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    await main(page).getByRole('button', { name: 'Обращение по звонку' }).click();
    const panel = main(page).locator('.ox-sv-call');
    await expect(panel.getByRole('heading', { name: 'Обращение по звонку' })).toBeVisible();
    await panel.getByLabel('Направление').selectOption({ label: 'ГРЗ · Грузоперевозки' });
    await expect(panel).toContainText(
      'Канал «звонок», исполнитель — вы. Первый ответ — 4 ч в рабочем времени направления, по закону — 30 дней.',
    );
    await panel.getByRole('button', { name: 'Завести обращение' }).click();
    await expect(panel.getByRole('alert')).toContainText('Укажите имя клиента');
    await panel.getByLabel('Клиент', { exact: true }).fill('Пётр Иванов');
    await panel.getByLabel('Телефон').fill('+7 900 111-22-33');
    await panel.getByLabel('Что случилось').fill('Не доехал груз');
    await panel.getByRole('button', { name: 'Завести обращение' }).click();
    await expect(toast(page)).toHaveText('Обращение заведено');
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('Заведено по звонку');
    await expect(status(page)).toContainText('В работе');
  });

  test('карточка: «Взять в работу» → «Ждём клиента» → «Вернуть в работу»', async ({
    app,
    page,
  }) => {
    await openRequest(app, page, 'ГРЗ-57');
    await expect(main(page).locator('.ox-sv-acts button')).toHaveText([
      /Взять в работу/,
      /Ждём клиента/,
      /Решено…/,
      /В другое направление…/,
    ]);
    await main(page).getByRole('button', { name: 'Взять в работу' }).click();
    await expect(toast(page)).toHaveText('ГРЗ-57 в работе');
    await expect(status(page)).toContainText('В работе');
    await main(page).getByRole('button', { name: 'Ждём клиента' }).click();
    await expect(toast(page)).toHaveText('Срок на паузе: ждём клиента');
    await expect(status(page)).toContainText('Ждёт клиента');
    await main(page).getByRole('button', { name: 'Вернуть в работу' }).click();
    await expect(toast(page)).toHaveText('Срок снова идёт');
  });

  test('карточка: «Решено…» с итогом, «Закрыть», закрытое обращение без ответа', async ({
    app,
    page,
  }) => {
    await openRequest(app, page, 'ГРЗ-57');
    await main(page).getByRole('button', { name: 'Решено…' }).click();
    const panel = main(page).getByRole('region', { name: 'Итог решения' });
    await panel.getByRole('button', { name: 'Решить' }).click();
    await expect(panel.getByRole('alert')).toContainText('Выберите итог решения');
    await panel.getByRole('radio', { name: 'Устранено' }).click();
    await panel.getByRole('button', { name: 'Решить' }).click();
    await expect(toast(page)).toHaveText('ГРЗ-57 решено');
    await expect(status(page)).toContainText('Решено');
    await expect(card(page)).toContainText('Итог: Устранено.');
    await main(page).getByRole('button', { name: 'Закрыть' }).click();
    await expect(toast(page)).toHaveText('ГРЗ-57 закрыто');
    await expect(card(page)).toContainText(
      'Обращение закрыто: ответы и заметки больше не добавляются.',
    );
    await expect(main(page).getByRole('tablist')).toHaveCount(0);
  });

  test('карточка: перенос в другое направление даёт новый номер', async ({ app, page }) => {
    await openRequest(app, page, 'ГРЗ-57');
    await main(page).getByRole('button', { name: 'В другое направление…' }).click();
    const panel = main(page).getByRole('region', { name: 'Перенести в другое направление' });
    await expect(panel).toContainText(
      'Старый номер будет вести на новый, клиенту уйдёт сообщение.',
    );
    await panel.getByRole('button', { name: 'Перенести' }).click();
    await expect(toast(page)).toHaveText(/^Новый номер: МАС-\d+$/);
    await expect(card(page)).toContainText('прежний номер ГРЗ-57');
  });

  test('карточка: ответ клиенту по шаблону, внутренняя заметка, ошибки пустого текста', async ({
    app,
    page,
  }) => {
    await openRequest(app, page, 'МАС-40');
    const compose = main(page).locator('.ox-sv-compose');
    await compose.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(main(page).getByRole('alert')).toContainText('Напишите текст ответа');
    await compose.getByRole('button', { name: 'Шаблоны ответов' }).click();
    await compose.getByRole('button', { name: /Приняли в работу/ }).click();
    await expect(compose.getByLabel('Ответ клиенту')).toHaveValue(
      /^Екатерина, приняли ваше обращение МАС-40\. Ответим /,
    );
    await compose.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(toast(page)).toHaveText('Ответ отправлен клиенту');
    await expect(card(page)).toContainText('Клиент видит');
    await compose.getByRole('tab', { name: /Внутренняя заметка/ }).click();
    await expect(compose).toContainText('Заметку клиент не увидит');
    await compose.getByRole('button', { name: 'Сохранить заметку' }).click();
    await expect(main(page).getByRole('alert')).toContainText('Напишите текст заметки');
    await compose.getByLabel('Внутренняя заметка', { exact: true }).fill('Позвонить завтра');
    await compose.getByRole('button', { name: 'Сохранить заметку' }).click();
    await expect(toast(page)).toHaveText('Заметка сохранена');
    await expect(card(page)).toContainText('Внутренняя заметка · клиент не видит');
  });

  test('карточка: компенсация в ответе, приоритет, исполнитель, телефон, задача', async ({
    app,
    page,
  }) => {
    await openRequest(app, page, 'МАС-41');
    const compose = main(page).locator('.ox-sv-compose');
    await compose.getByLabel('Компенсация').selectOption('Скидка 20% на следующий визит');
    await compose.getByLabel('Ответ клиенту').fill('Ольга, извините, дарим скидку.');
    await compose.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(toast(page)).toHaveText('Ответ отправлен клиенту');
    await expect(card(page)).toContainText('Компенсация: Скидка 20% на следующий визит.');
    await aside(page).getByLabel('Приоритет').selectOption('normal');
    await expect(toast(page)).toHaveText('Приоритет изменён');
    await aside(page).getByLabel('Исполнитель').selectOption('');
    await expect(toast(page)).toHaveText('Исполнитель снят');
    await aside(page).getByRole('button', { name: 'Назначить меня' }).click();
    await expect(toast(page)).toHaveText('МАС-41 назначено на вас');
    await expect(aside(page).getByLabel('Исполнитель').locator('option:checked')).toHaveText(
      'Дарья Зимина',
    );
    await aside(page).getByRole('button', { name: '＋ Задача' }).click();
    await aside(page).getByLabel('Тема задачи').fill('Хм');
    await aside(page).getByRole('button', { name: 'Создать' }).click();
    await expect(aside(page).getByRole('alert')).toContainText(
      'Тема задачи — не короче 3 символов',
    );
    await aside(page).getByLabel('Тема задачи').fill('Проверить подогрев стола');
    await aside(page).getByRole('button', { name: 'Создать' }).click();
    await expect(toast(page)).toHaveText('Задача создана');
    await expect(aside(page)).toContainText('Проверить подогрев стола');
  });

  test('карточка: показ телефона владельцем — маска, затем полный номер', async ({ app, page }) => {
    await openRequest(app, page, 'ГРЗ-57');
    await expect(aside(page)).toContainText('+7 ••• •••-••-12');
    await aside(page).getByRole('button', { name: 'Показать' }).click();
    await expect(toast(page)).toHaveText('Телефон показан, запись в истории');
    await expect(aside(page)).toContainText('+7 916 204-44-12');
  });

  test('жалоба на сотрудника: «Кто видит», два итога, вывод сотруднику после решения', async ({
    app,
    page,
  }) => {
    await openRequest(app, page, 'МАС-41');
    await expect(aside(page)).toContainText(
      'Жалоба касается работы сотрудника. Анна Морозова не видит обращение, пока руководитель не поделится выводом.',
    );
    await expect(aside(page)).toContainText('Вывод можно отправить после решения');
    await main(page).getByRole('button', { name: 'Решено…' }).click();
    const panel = main(page).getByRole('region', { name: 'Итог решения' });
    await expect(panel.getByRole('radio')).toHaveText(['Подтвердилась', 'Не подтвердилась']);
    await panel.getByRole('radio', { name: 'Подтвердилась', exact: true }).click();
    await panel.getByRole('button', { name: 'Решить' }).click();
    await expect(toast(page)).toHaveText('МАС-41 решено');
    await aside(page).getByRole('button', { name: 'Поделиться выводом с сотрудником…' }).click();
    await aside(page).getByLabel('Вывод для сотрудника').fill('Опоздание подтвердилось.');
    await aside(page).getByRole('button', { name: 'Отправить' }).click();
    await expect(toast(page)).toHaveText('Вывод отправлен сотруднику');
    await expect(aside(page)).toContainText('«Опоздание подтвердилось.»');
  });

  test('логист Котова: только «Грузоперевозки», «Взять себе», телефон скрыт, компенсации нет', async ({
    app,
    page,
  }) => {
    await openService(app, page, 'manager');
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    expect(await keys(page)).toEqual(['ГРЗ-57', 'ГРЗ-55']);
    await expect(queue(page, /^Массаж/)).toHaveCount(0);
    await rowOf(page, 'ГРЗ-57').getByRole('button', { name: 'Взять себе' }).click();
    await expect(toast(page)).toHaveText('ГРЗ-57 назначено на вас');
    await expect(rowOf(page, 'ГРЗ-57')).toContainText('Марина Котова');
    await rowOf(page, 'ГРЗ-57').locator('.ox-sv-key').click();
    await expect(aside(page)).toContainText(
      'Телефон показывают руководителю направления и владельцу',
    );
    await expect(aside(page).getByRole('button', { name: 'Показать' })).toHaveCount(0);
    await expect(main(page).getByLabel('Компенсация')).toHaveCount(0);
  });

  test('диплинк ?open=<id> открывает карточку и очищает адрес', async ({ app, page }) => {
    const alta = await openService(app, page);
    const id = await page.evaluate(async (tenant) => {
      const res = await fetch(`/api/v1/tenants/${tenant}/service/requests?limit=50`);
      const body = (await res.json()) as { items: { id: string; key: string }[] };
      return body.items.find((r) => r.key === 'ОТД-11')?.id ?? '';
    }, alta);
    await openPage(app, page, `service?open=${id}`);
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    await expect(main(page).locator('.ox-sv-cardhead .ox-sv-key')).toHaveText('ОТД-11');
    await expect(page).toHaveURL(/\/service$/);
  });

  test('нет связи: заметка и заблокированные кнопки', async ({ app, page, context }) => {
    await openRequest(app, page, 'МАС-40');
    await context.setOffline(true);
    await expect(main(page)).toContainText('Нет связи с сервером');
    await expect(main(page).getByRole('button', { name: 'Взять в работу' })).toBeDisabled();
    await context.setOffline(false);
    await expect(main(page).getByRole('button', { name: 'Взять в работу' })).toBeEnabled();
  });

  test('клавиатура: строка очереди открывается по Enter, «Очередь» возвращает назад', async ({
    app,
    page,
  }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    const key = rowOf(page, 'ОТД-11').locator('.ox-sv-key');
    await key.focus();
    await page.keyboard.press('Enter');
    await expect(card(page)).toBeVisible();
    const back = main(page).getByRole('button', { name: 'Очередь' });
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(rows(page).first()).toBeVisible();
  });

  test('раскладка: без горизонтальной прокрутки страницы, цели ≥ 44 px на телефоне, axe без serious', async ({
    app,
    page,
    axe,
  }, testInfo) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    expect(await noHorizontalScroll(page)).toBe(true);
    const phone = testInfo.project.name.includes('390');
    if (phone) {
      for (const l of [
        main(page).getByRole('button', { name: 'Обращение по звонку' }),
        queue(page, /^Срок нарушен/),
        rowOf(page, 'КОС-6').getByRole('button', { name: 'Взять себе' }),
      ]) {
        expect(await hitHeight(l), String(l)).toBeGreaterThanOrEqual(44);
      }
    }
    const bad1 = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      bad1.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
    await rowOf(page, 'МАС-41').locator('.ox-sv-key').click();
    await expect(card(page)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone) {
      for (const l of [
        main(page).getByRole('button', { name: 'Взять в работу' }),
        main(page).getByRole('button', { name: 'Очередь' }),
        aside(page).getByRole('button', { name: '＋ Задача' }),
      ]) {
        expect(await hitHeight(l), String(l)).toBeGreaterThanOrEqual(44);
      }
    }
    const bad2 = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      bad2.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
});

// Стенд: backend обращений W7.31 в main. Сид «Альты» (направления, восемь обращений, низкие оценки) читается настоящим
// backend; изменяющие строки работают со своими обращениями, заведёнными «Обращением по звонку» (имя клиента несёт метку
// прогона), — сидовые обращения общие для трёх проектов и не меняются.
test.describe('service — страница «Обращения» @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(180_000);

  /** «Обращение по звонку»: заводит обращение направления «Грузоперевозки», возвращает его номер из карточки. */
  async function callIn(page: Page, client: string, what: string): Promise<string> {
    await main(page).getByRole('button', { name: 'Обращение по звонку' }).click();
    const panel = main(page).locator('.ox-sv-call');
    await expect(panel.getByRole('heading', { name: 'Обращение по звонку' })).toBeVisible();
    await panel.getByLabel('Направление').selectOption({ label: 'ГРЗ · Грузоперевозки' });
    await panel.getByLabel('Клиент', { exact: true }).fill(client);
    await panel.getByLabel('Телефон').fill('+7 900 111-22-33');
    await panel.getByLabel('Что случилось').fill(what);
    await panel.getByRole('button', { name: 'Завести обращение' }).click();
    await expect(toast(page)).toHaveText('Обращение заведено', { timeout: 20_000 });
    await expect(card(page)).toBeVisible({ timeout: 20_000 });
    return (await main(page).locator('.ox-sv-cardhead .ox-sv-key').first().innerText()).trim();
  }

  async function openOwn(
    app: Parameters<typeof openPage>[0],
    page: Page,
    project: string,
  ): Promise<{ key: string; label: string }> {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
    const label = runLabel(project);
    const key = await callIn(page, `Клиент ${label}`, `Не доехал груз ${label}`);
    return { key, label };
  }

  test('владелец на стенде: шапка, подзаголовок, очереди со счётчиками, обращения сида', async ({
    app,
    page,
  }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(main(page)).toContainText(
      'Все мои направления · открытые · сначала самый ранний срок',
    );
    await expect(main(page).getByRole('button', { name: 'Обращение по звонку' })).toBeVisible();
    for (const q of [
      /^Все мои/,
      /^Срок нарушен/,
      /^Срок под угрозой/,
      /^Ждут клиента/,
      /^Низкие оценки/,
      /^Решено и закрыто/,
    ]) {
      await expect(queue(page, q)).toBeVisible();
    }
    await expect(rowOf(page, 'ГРЗ-57')).toContainText(/просрочен на /);
    await expect(rowOf(page, 'ГРЗ-55')).toContainText('Ждёт клиента');
    await expect(rowOf(page, 'МАС-41')).toContainText('SMS · оценка 2 из 5');
    await expect(rowOf(page, 'МАС-40')).toContainText('Без привязки');
  });

  test('владелец на стенде: очереди «Срок нарушен», «Ждут клиента», «Низкие оценки» и направление «Массаж»', async ({
    app,
    page,
  }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
    await queue(page, /^Срок нарушен/).click();
    await expect(rowOf(page, 'ГРЗ-57')).toBeVisible();
    await queue(page, /^Ждут клиента/).click();
    await expect(rowOf(page, 'ГРЗ-55')).toBeVisible();
    await queue(page, /^Низкие оценки/).click();
    await expect(main(page).locator('.ox-sv-rating').first()).toBeVisible();
    await expect(main(page)).toContainText('Оценки 1–3, где клиент не просил связаться.');
    await queue(page, /^Открытые/).click();
    await queue(page, /^Массаж/).click();
    await expect(rowOf(page, 'МАС-40')).toBeVisible();
    await expect(rowOf(page, 'ГРЗ-57')).toHaveCount(0);
  });

  test('владелец на стенде: поиск и фильтры «Тип» и «Канал»', async ({ app, page }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
    await main(page).getByLabel('Поиск').fill('Гусева');
    await expect(rowOf(page, 'ГРЗ-57')).toBeVisible();
    await expect(rowOf(page, 'МАС-40')).toHaveCount(0);
    await main(page).getByLabel('Поиск').fill('');
    await main(page).getByLabel('Тип').selectOption('question');
    await expect(rowOf(page, 'МАС-40')).toBeVisible();
    await expect(rowOf(page, 'ГРЗ-57')).toHaveCount(0);
    await main(page).getByLabel('Тип').selectOption('');
    await main(page).getByLabel('Канал').selectOption('sms');
    await expect(rowOf(page, 'МАС-41')).toBeVisible();
    await expect(rowOf(page, 'МАС-40')).toHaveCount(0);
  });

  test('владелец на стенде: «Обращение по звонку» — проверка полей, подсказка, заведено → карточка', async ({
    app,
    page,
  }, testInfo) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
    await main(page).getByRole('button', { name: 'Обращение по звонку' }).click();
    const panel = main(page).locator('.ox-sv-call');
    await expect(panel.getByRole('heading', { name: 'Обращение по звонку' })).toBeVisible();
    await panel.getByLabel('Направление').selectOption({ label: 'ГРЗ · Грузоперевозки' });
    await expect(panel).toContainText('Канал «звонок», исполнитель — вы.');
    await panel.getByRole('button', { name: 'Завести обращение' }).click();
    await expect(panel.getByRole('alert')).toContainText('Укажите имя клиента');
    const label = runLabel(testInfo.project.name);
    await panel.getByLabel('Клиент', { exact: true }).fill(`Пётр ${label}`);
    await panel.getByLabel('Телефон').fill('+7 900 111-22-33');
    await panel.getByLabel('Что случилось').fill('Не доехал груз');
    await panel.getByRole('button', { name: 'Завести обращение' }).click();
    await expect(toast(page)).toHaveText('Обращение заведено', { timeout: 20_000 });
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('Заведено по звонку');
    await expect(status(page)).toContainText('В работе');
  });

  test('владелец на стенде: карточка — «Ждём клиента» → «Вернуть в работу», затем «Решено…» с итогом и «Закрыть»', async ({
    app,
    page,
  }, testInfo) => {
    const { key } = await openOwn(app, page, testInfo.project.name);
    await main(page).getByRole('button', { name: 'Ждём клиента' }).click();
    await expect(toast(page)).toHaveText('Срок на паузе: ждём клиента', { timeout: 20_000 });
    await expect(status(page)).toContainText('Ждёт клиента');
    await main(page).getByRole('button', { name: 'Вернуть в работу' }).click();
    await expect(toast(page)).toHaveText('Срок снова идёт', { timeout: 20_000 });
    await main(page).getByRole('button', { name: 'Решено…' }).click();
    const panel = main(page).getByRole('region', { name: 'Итог решения' });
    await panel.getByRole('button', { name: 'Решить' }).click();
    await expect(panel.getByRole('alert')).toContainText('Выберите итог решения');
    await panel.getByRole('radio', { name: 'Устранено' }).click();
    await panel.getByRole('button', { name: 'Решить' }).click();
    await expect(toast(page)).toHaveText(`${key} решено`, { timeout: 20_000 });
    await expect(status(page)).toContainText('Решено');
    await expect(card(page)).toContainText('Итог: Устранено.');
    await main(page).getByRole('button', { name: 'Закрыть' }).click();
    await expect(toast(page)).toHaveText(`${key} закрыто`, { timeout: 20_000 });
    await expect(card(page)).toContainText(
      'Обращение закрыто: ответы и заметки больше не добавляются.',
    );
    await expect(main(page).getByRole('tablist')).toHaveCount(0);
  });

  test('владелец на стенде: перенос в другое направление даёт новый номер', async ({
    app,
    page,
  }, testInfo) => {
    const { key } = await openOwn(app, page, testInfo.project.name);
    await main(page).getByRole('button', { name: 'В другое направление…' }).click();
    const panel = main(page).getByRole('region', { name: 'Перенести в другое направление' });
    await expect(panel).toContainText(
      'Старый номер будет вести на новый, клиенту уйдёт сообщение.',
    );
    await panel.getByRole('button', { name: 'Перенести' }).click();
    await expect(toast(page)).toHaveText(/^Новый номер: [А-Я]{3}-\d+$/, { timeout: 20_000 });
    await expect(card(page)).toContainText(`прежний номер ${key}`);
  });

  test('владелец на стенде: ответ клиенту по шаблону, внутренняя заметка, ошибки пустого текста', async ({
    app,
    page,
  }, testInfo) => {
    const { key } = await openOwn(app, page, testInfo.project.name);
    const compose = main(page).locator('.ox-sv-compose');
    await compose.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(main(page).getByRole('alert')).toContainText('Напишите текст ответа');
    await compose.getByRole('button', { name: 'Шаблоны ответов' }).click();
    await compose.getByRole('button', { name: /Приняли в работу/ }).click();
    await expect(compose.getByLabel('Ответ клиенту')).toHaveValue(
      new RegExp(`приняли ваше обращение ${key}\\. Ответим `),
    );
    await compose.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(toast(page)).toHaveText('Ответ отправлен клиенту', { timeout: 20_000 });
    await expect(card(page)).toContainText('Клиент видит');
    await compose.getByRole('tab', { name: /Внутренняя заметка/ }).click();
    await expect(compose).toContainText('Заметку клиент не увидит');
    await compose.getByRole('button', { name: 'Сохранить заметку' }).click();
    await expect(main(page).getByRole('alert')).toContainText('Напишите текст заметки');
    await compose.getByLabel('Внутренняя заметка', { exact: true }).fill('Позвонить завтра');
    await compose.getByRole('button', { name: 'Сохранить заметку' }).click();
    await expect(toast(page)).toHaveText('Заметка сохранена', { timeout: 20_000 });
    await expect(card(page)).toContainText('Внутренняя заметка · клиент не видит');
  });

  test('владелец на стенде: приоритет, исполнитель, задача по обращению', async ({
    app,
    page,
  }, testInfo) => {
    await openOwn(app, page, testInfo.project.name);
    await expect(aside(page)).toContainText('+7 900 111-22-33');
    await aside(page).getByLabel('Приоритет').selectOption('normal');
    await expect(toast(page)).toHaveText('Приоритет изменён', { timeout: 20_000 });
    await aside(page).getByLabel('Исполнитель').selectOption('');
    await expect(toast(page)).toHaveText('Исполнитель снят', { timeout: 20_000 });
    await aside(page).getByRole('button', { name: 'Назначить меня' }).click();
    await expect(aside(page).getByLabel('Исполнитель').locator('option:checked')).toHaveText(
      'Дарья Зимина',
      { timeout: 20_000 },
    );
    await aside(page).getByRole('button', { name: '＋ Задача' }).click();
    await aside(page).getByLabel('Тема задачи').fill('Хм');
    await aside(page).getByRole('button', { name: 'Создать' }).click();
    await expect(aside(page).getByRole('alert')).toContainText(
      'Тема задачи — не короче 3 символов',
    );
    await aside(page).getByLabel('Тема задачи').fill('Проверить подогрев стола');
    await aside(page).getByRole('button', { name: 'Создать' }).click();
    await expect(toast(page)).toHaveText('Задача создана', { timeout: 20_000 });
    await expect(aside(page)).toContainText('Проверить подогрев стола');
  });

  test('владелец на стенде: показ телефона сидового обращения — маска, затем полный номер', async ({
    app,
    page,
  }) => {
    await openRequest(app, page, 'ГРЗ-57');
    // Показ телефона записывается в историю и остаётся у сидового обращения для следующих проектов прогона:
    // номер маскирован до первого «Показать», дальше открыт.
    await expect(aside(page)).toContainText(/\+7 (••• •••-••-12|916 204-44-12)/);
    const show = aside(page).getByRole('button', { name: 'Показать' });
    if (await show.count()) {
      await show.click();
      await expect(toast(page)).toHaveText('Телефон показан, запись в истории', {
        timeout: 20_000,
      });
    }
    await expect(aside(page)).toContainText('+7 916 204-44-12');
  });

  test('логист Котова на стенде: только своё направление, телефон скрыт, компенсации нет', async ({
    app,
    page,
  }) => {
    await openService(app, page, 'manager');
    await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(queue(page, /^Массаж/)).toHaveCount(0);
    await expect(rowOf(page, 'ГРЗ-57')).toBeVisible();
    await expect(rowOf(page, 'МАС-40')).toHaveCount(0);
    await rowOf(page, 'ГРЗ-57').locator('.ox-sv-key').click();
    await expect(aside(page)).toContainText(
      'Телефон показывают руководителю направления и владельцу',
    );
    await expect(aside(page).getByRole('button', { name: 'Показать' })).toHaveCount(0);
    await expect(main(page).getByLabel('Компенсация')).toHaveCount(0);
  });

  test('владелец на стенде: диплинк ?open=<id> открывает карточку и очищает адрес', async ({
    app,
    page,
  }, testInfo) => {
    const alta = await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
    const key = await callIn(page, `Клиент ${runLabel(testInfo.project.name)}`, 'Диплинк');
    const id = await page.evaluate(
      async ({ tenant, k }) => {
        const res = await fetch(`/api/v1/tenants/${tenant}/service/requests?limit=200`);
        const body = (await res.json()) as { items: { id: string; key: string }[] };
        return body.items.find((r) => r.key === k)?.id ?? '';
      },
      { tenant: alta, k: key },
    );
    expect(id).not.toBe('');
    await openPage(app, page, `service?open=${id}`);
    await expect(card(page)).toBeVisible({ timeout: 30_000 });
    await expect(main(page).locator('.ox-sv-cardhead .ox-sv-key')).toHaveText(key);
    await expect(page).toHaveURL(/\/service$/);
  });

  test('владелец на стенде: нет связи — заметка и заблокированные кнопки', async ({
    app,
    page,
    context,
  }, testInfo) => {
    await openOwn(app, page, testInfo.project.name);
    await context.setOffline(true);
    await expect(main(page)).toContainText('Нет связи с сервером');
    await expect(main(page).getByRole('button', { name: 'Ждём клиента' })).toBeDisabled();
    await context.setOffline(false);
    await expect(main(page).getByRole('button', { name: 'Ждём клиента' })).toBeEnabled();
  });

  test('владелец на стенде: клавиатура — строка очереди открывается по Enter, «Очередь» возвращает назад', async ({
    app,
    page,
  }) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
    const key = rowOf(page, 'ОТД-11').locator('.ox-sv-key');
    await key.focus();
    await page.keyboard.press('Enter');
    await expect(card(page)).toBeVisible();
    const back = main(page).getByRole('button', { name: 'Очередь' });
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(rows(page).first()).toBeVisible();
  });

  test('владелец на стенде: раскладка — без горизонтальной прокрутки, цели ≥ 44 px на телефоне, axe без serious', async ({
    app,
    page,
    axe,
  }, testInfo) => {
    await openService(app, page);
    await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
    expect(await noHorizontalScroll(page)).toBe(true);
    const narrow = testInfo.project.name.includes('390');
    if (narrow) {
      for (const l of [
        main(page).getByRole('button', { name: 'Обращение по звонку' }),
        queue(page, /^Срок нарушен/),
      ]) {
        expect(await hitHeight(l), String(l)).toBeGreaterThanOrEqual(44);
      }
    }
    const bad1 = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      bad1.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
    await rowOf(page, 'МАС-41').locator('.ox-sv-key').click();
    await expect(card(page)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const bad2 = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      bad2.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
});
