// W4.12 · e2e экрана `tasks-card` — карточка задачи (эталон design-2026-10-19 «Задачи и проекты.dc.html» ЗП:143–193,
// 414–437, relVM :500–514, attach :523; разбор tasks.md §1.3). Переходы и причины — availableTransitions сценарного
// сервера W4.03 (trCheck эталона), согласование T-65 «Согласовать» (достаточно одного), связи T-66 → T-65, T-58.
// Поле комментария в «Истории» и «← К доске» на телефоне — no-reference (Q-W4.00-tasks-11, -14).
import { expect, test } from './_stand/fixtures.ts';
import { hitHeight, noHorizontalScroll } from './modules.helpers.ts';
import {
  approvalTask,
  boardCard,
  card,
  column,
  EXE,
  LOG,
  newTask,
  OFFLINE,
  openCard,
  openProject,
  openTasks,
  PDF,
  phone,
  root,
  ringVisible,
  scenario,
  setProjectRole,
  STAND_MARK,
  standSuffix,
  T58,
  T64,
  T65,
  T66,
  tabTo,
  toast,
} from './tasks.helpers.ts';

type App = Parameters<typeof openTasks>[0];
type P = Parameters<typeof openTasks>[1];

async function openT(
  app: App,
  page: P,
  title: string,
  persona?: 'owner' | 'manager',
): Promise<void> {
  await openTasks(app, page, persona ? { persona } : {});
  await openProject(page);
  await openCard(page, title);
}

test.describe('tasks-card — карточка задачи @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(90_000);

  test('T-65: номер и автор, статус, «Согласовать» и «Отменить», блок согласования, поля, связи, описание', async ({
    app,
    page,
  }) => {
    await openT(app, page, T65);
    const c = card(page);
    await expect(c).toContainText('T-65');
    await expect(c).toContainText('· автор Илья Васильев');
    await expect(c.locator('.ox-tk-status')).toHaveText('На проверке');
    await expect(c.locator('.ox-tk-trs').getByRole('button')).toHaveText([
      /Согласовать$/,
      /Отменить$/,
    ]);
    await expect(c.getByLabel('Комментарий', { exact: true })).toHaveAttribute(
      'placeholder',
      'Комментарий к переходу или отказу',
    );
    const appr = c.locator('.ox-tk-appr');
    await expect(appr).toContainText('Согласование «Согласовать» · достаточно одного');
    await expect(appr.locator('.ox-tk-appr-row')).toHaveText([
      /ДЗДарья Зимина · выждёт решения/,
      /МКМарина Котоваждёт решения/,
      /ВКВера Котельниковаждёт решения/,
    ]);
    await expect(appr.getByRole('button', { name: 'Вернуть на доработку' })).toBeVisible();
    await expect(c.getByLabel('Исполнитель').locator('option:checked')).toHaveText('Илья Васильев');
    await expect(c.getByLabel('Приоритет').locator('option:checked')).toHaveText('Высокий');
    await expect(c).toContainText('10.10');
    await expect(c).toContainText('Входит в');
    await expect(c.getByRole('button', { name: `T-66 · ${T66}` })).toBeVisible();
    await expect(c).toContainText('подзадач нет');
    await expect(c).toContainText('Комплект зимних шин 215/75 R17.5, 6 шт., с шиномонтажом.');
    await expect(c.locator('.ox-tk-label')).toHaveText(['шины', 'закупка']);
    await expect(c).toContainText('Вложения · 1');
    await expect(c).toContainText('Счёт № 418 от 07.10.pdf');
    await expect(c).toContainText('180 КБ · Илья Васильев · 10:41');
    await expect(c.getByLabel('Счёт приложен')).toBeChecked();
    await expect(c.locator('.ox-tk-hist')).toContainText(
      '10:42Илья Васильев Сумма 48 600 ₽, счёт во вложении. Прошу согласовать.',
    );
  });

  test('согласование владельцем: тост «Согласовано», задача в «Готово», назначена на автора', async ({
    app,
    page,
  }) => {
    await openT(app, page, T65);
    await card(page).getByRole('button', { name: 'Согласовать' }).click();
    await expect(toast(page)).toHaveText('Согласовано');
    await expect(card(page).locator('.ox-tk-status')).toHaveText('Готово');
    await expect(column(page, 'Готово').locator('.ox-tk-col-count')).toHaveText('2');
    await expect(card(page).locator('.ox-tk-appr')).toHaveCount(0);
  });

  test('«Вернуть на доработку»: без комментария — «Напишите, что доработать»; с ним — «В работе»', async ({
    app,
    page,
  }) => {
    await openT(app, page, T65);
    const c = card(page);
    await c.getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(toast(page)).toHaveText('Напишите, что доработать');
    await c.getByLabel('Комментарий', { exact: true }).fill('Нужен второй счёт');
    await c.getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(toast(page)).toHaveText('Возвращено на доработку');
    await expect(c.locator('.ox-tk-status')).toHaveText('В работе');
    await expect(c.locator('.ox-tk-hist')).toContainText('Нужен второй счёт');
  });

  test('недоступный переход: кнопка disabled, строка «🔒 «Переход»: причина» (T-66 — подзадачи)', async ({
    app,
    page,
  }) => {
    await openT(app, page, T66);
    const c = card(page);
    await expect(c.locator('.ox-tk-trs').getByRole('button')).toHaveText([
      /На проверку$/,
      /Отменить$/,
    ]);
    await c.getByRole('button', { name: 'На проверку' }).click();
    await expect(toast(page)).toHaveText('«На проверку» выполнен');
    await expect(c.locator('.ox-tk-status')).toHaveText('На проверке');
    const ok = c.getByRole('button', { name: 'Согласовать' });
    await expect(ok).toBeDisabled();
    await expect(c.locator('.ox-tk-blocked')).toContainText(
      '«Согласовать»: Сначала завершите подзадачи: T-65, T-58',
    );
  });

  test('поля: исполнитель и приоритет меняются на сервере; срок — текстом', async ({
    app,
    page,
  }) => {
    await openT(app, page, T64);
    const c = card(page);
    await c.getByLabel('Приоритет').selectOption({ label: 'Низкий' });
    await expect(boardCard(page, T64)).toContainText('Низкий');
    await c.getByLabel('Исполнитель').selectOption({ label: 'Дарья Зимина' });
    await expect(boardCard(page, T64).locator('[title="Дарья Зимина"]')).toHaveText('ДЗ');
    await expect(c).toContainText('01.10');
  });

  test('связи: «Убрать связь», «Входит в задачу…», подзадачи T-66, «Исключить», «Добавить существующую…»', async ({
    app,
    page,
  }) => {
    await openT(app, page, T66);
    const c = card(page);
    await expect(c).toContainText('0 из 2 готово');
    await expect(c.locator('.ox-tk-kid')).toHaveCount(2);
    await c.getByRole('button', { name: 'Исключить T-58 из состава' }).click();
    await expect(toast(page)).toHaveText('T-58 исключена из состава');
    await expect(c.locator('.ox-tk-kid')).toHaveCount(1);
    await c
      .getByLabel('Добавить существующую задачу в состав')
      .selectOption({ label: `T-58 · ${T58}` });
    await expect(toast(page)).toHaveText('T-58 добавлена в состав');
    await expect(c.locator('.ox-tk-kid')).toHaveCount(2);
    await c.getByRole('button', { name: `T-65 ${T65}` }).click();
    await expect(c.getByRole('heading', { level: 3, name: T65 })).toBeVisible();
    await c.getByRole('button', { name: 'Убрать из состава родительской задачи' }).click();
    await expect(toast(page)).toHaveText('Связь снята');
    await c.getByLabel('Входит в задачу', { exact: true }).selectOption({ label: `T-66 · ${T66}` });
    await expect(toast(page)).toHaveText('Задача входит в T-66');
  });

  test('«Подзадача» открывает «Новую задачу» с «Входит в» и исполнителем; создаётся в составе', async ({
    app,
    page,
  }) => {
    await openT(app, page, T66);
    await card(page).getByRole('button', { name: 'Подзадача' }).click();
    const d = newTask(page);
    await expect(d.getByLabel('Входит в задачу').locator('option:checked')).toHaveText(
      `T-66 · ${T66}`,
    );
    await expect(d.getByLabel('Исполнитель').locator('option:checked')).toHaveText('Марина Котова');
    await d.getByLabel('Тема *').fill('Проверить аккумуляторы');
    await d.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(toast(page)).toHaveText('Задача LOG-101 создана');
    await expect(card(page)).toContainText('Входит в');
    await expect(card(page).getByRole('button', { name: `T-66 · ${T66}` })).toBeVisible();
  });

  test('вложения: «Прикрепить» — тост «Прикреплено файлов: 1»; плохой файл — «Не прикреплено»; «Удалить»', async ({
    app,
    page,
  }) => {
    await openT(app, page, T64);
    const c = card(page);
    await expect(c).toContainText('Вложения · 0');
    await c.getByLabel('Прикрепить файлы').setInputFiles([PDF]);
    await expect(toast(page)).toHaveText('Прикреплено файлов: 1', { timeout: 15_000 });
    await expect(c).toContainText('Вложения · 1');
    await expect(c).toContainText('Акт.pdf');
    await c.getByLabel('Прикрепить файлы').setInputFiles([EXE]);
    await expect(toast(page)).toHaveText('Не прикреплено: setup.exe — такой тип не принимаем');
    await c.getByRole('button', { name: 'Удалить Акт.pdf' }).click();
    await expect(toast(page)).toHaveText('Файл удалён');
    await expect(c).toContainText('Вложения · 0');
    await expect(c).toContainText(
      'Файлы можно перетащить на карточку. Доступ к файлам — как к задаче.',
    );
  });

  test('чек-лист: отметка пункта сохраняется на сервере; история и комментарий', async ({
    app,
    page,
  }) => {
    await openT(app, page, T58);
    const c = card(page);
    const item = c.getByLabel('Перенести рейсы на другие машины');
    await expect(item).not.toBeChecked();
    await item.click();
    await expect(item).toBeChecked();
    await expect(c.locator('.ox-tk-hist')).toContainText(
      'отметил(а): Перенести рейсы на другие машины',
    );
    await c.getByLabel('Комментарий к задаче').fill('Сервис подтвердил 02.10');
    await c.getByRole('button', { name: 'Отправить комментарий' }).click();
    await expect(c.locator('.ox-tk-hist')).toContainText('Дарья Зимина Сервис подтвердил 02.10');
  });

  test('ссылка ?task= открывает проект и карточку; «Закрыть задачу» убирает её из адреса', async ({
    app,
    page,
  }) => {
    await openT(app, page, T65);
    const url = page.url();
    expect(url).toMatch(/[?&]task=/);
    const task = new URL(url).searchParams.get('task') ?? '';
    const id = /\/t\/([^/]+)\//.exec(url)?.[1] ?? '';
    await app(`/t/${id}/tasks?task=${task}`, { persona: 'owner' });
    await expect(card(page).getByRole('heading', { level: 3, name: T65 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(root(page).locator('.ox-tk-phead')).toContainText(LOG);
    await card(page).getByRole('button', { name: 'Закрыть задачу' }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/task=/);
  });

  test('нет связи при переходе — тост, статус прежний', async ({ app, page }) => {
    await openT(app, page, T65);
    await scenario(page, 'transitionTask=offline');
    await card(page).getByRole('button', { name: 'Согласовать' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await scenario(page, null);
    await expect(card(page).locator('.ox-tk-status')).toHaveText('На проверке');
  });

  test('390: карточка на всю ширину с «К доске»; 1440 — рядом с доской; нет горизонтальной прокрутки', async ({
    app,
    page,
  }) => {
    await openT(app, page, T65);
    const back = card(page).getByRole('button', { name: 'К доске' });
    if (phone(page)) {
      await expect(back).toBeVisible();
      await expect(root(page).locator('.ox-tk-board')).toBeHidden();
      expect(await hitHeight(back)).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(card(page).getByRole('button', { name: 'Согласовать' })),
      ).toBeGreaterThanOrEqual(44);
      await back.click();
      await expect(card(page)).toHaveCount(0);
      await expect(root(page).locator('.ox-tk-board')).toBeVisible();
    } else {
      await expect(back).toBeHidden();
      await expect(root(page).locator('.ox-tk-board')).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  // Возврат 1: состояния карточки (бриф §1 п. 7, verification-protocol §1 п. 3).
  test('загрузка карточки — скелетон; ошибка getTask — «Не удалось загрузить данные: …» и «Повторить»', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await openProject(page);
    await scenario(page, 'getTask=delay=2000');
    await boardCard(page, T65).click();
    await expect(card(page).getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(card(page).getByRole('heading', { level: 3, name: T65 })).toBeVisible({
      timeout: 15_000,
    });
    await card(page).getByRole('button', { name: 'Закрыть задачу' }).click();
    await scenario(page, 'getTask=rate_limited');
    await boardCard(page, T66).click();
    await expect(card(page).getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
      { timeout: 15_000 },
    );
    await scenario(page, null);
    await card(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(card(page).getByRole('heading', { level: 3, name: T66 })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('ссылка ?task= без проекта при ошибке — «Повторить»; несуществующая задача — убрана из адреса', async ({
    app,
    page,
  }) => {
    await openT(app, page, T65);
    const url = new URL(page.url());
    const task = url.searchParams.get('task') ?? '';
    const id = /\/t\/([^/]+)\//.exec(url.pathname)?.[1] ?? '';
    await scenario(page, 'getTask=rate_limited');
    await app(`/t/${id}/tasks?task=${task}`, { persona: 'owner' });
    await expect(root(page).getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
      { timeout: 15_000 },
    );
    await scenario(page, null);
    await root(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(card(page).getByRole('heading', { level: 3, name: T65 })).toBeVisible({
      timeout: 15_000,
    });
    await app(`/t/${id}/tasks?task=00000000-0000-4000-8000-000000000404`, { persona: 'owner' });
    await expect(root(page).getByRole('heading', { level: 2, name: 'Проекты' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).not.toHaveURL(/task=/);
  });

  test('только чтение (роль «Наблюдатель»): поля и чек-лист недоступны, «Прикрепить» и связи скрыты', async ({
    app,
    page,
  }) => {
    const id = await openTasks(app, page);
    await setProjectRole(page, id, 'Марина Котова', 'Наблюдатель');
    await openT(app, page, T58, 'manager');
    await expect(root(page).locator('.ox-tk-phead')).toContainText('Вы: Наблюдатель');
    const c = card(page);
    await expect(c.getByLabel('Исполнитель')).toBeDisabled();
    await expect(c.getByLabel('Приоритет')).toBeDisabled();
    await expect(c.getByLabel('Перенести рейсы на другие машины')).toBeDisabled();
    await expect(c.getByLabel('Прикрепить файлы')).toHaveCount(0);
    await expect(c.getByRole('button', { name: 'Подзадача' })).toHaveCount(0);
    await expect(root(page).getByLabel('Название новой задачи')).toHaveCount(0);
  });

  test('клавиатура: «Прикрепить» — видимый фокус; 390 — «Входит в» и строки чек-листа не меньше 44 px', async ({
    app,
    page,
  }) => {
    await openT(app, page, T65);
    const attach = card(page).getByLabel('Прикрепить файлы');
    expect(await tabTo(page, attach, 120)).toBe(true);
    expect(await ringVisible(card(page).locator('.ox-tk-attach'))).toBe(true);
    if (!phone(page)) return;
    expect(
      await hitHeight(card(page).getByRole('button', { name: `T-66 · ${T66}` })),
    ).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(card(page).locator('.ox-tk-check-item').first())).toBeGreaterThanOrEqual(
      44,
    );
  });

  test('axe без serious на открытой карточке', async ({ app, page, axe }) => {
    await openT(app, page, T65);
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
});

test.describe('tasks-card — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  // W4.74 (Q-W4.12-17): своя задача на согласование на каждый прогон — три ширины подряд на одном стенде.
  test('согласование своей задачи владельцем на стенде (W4.11)', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const title = `${STAND_MARK}согласование ${standSuffix()}`;
    await approvalTask(session, title, undo);
    await openT(app, page, title);
    const c = card(page);
    await expect(c.locator('.ox-tk-status')).toHaveText('На проверке');
    await expect(c.locator('.ox-tk-appr')).toContainText(
      'Согласование «Согласовать» · достаточно одного',
    );
    await c.getByRole('button', { name: 'Согласовать' }).click();
    await expect(toast(page)).toHaveText('Согласовано', { timeout: 15_000 });
    await expect(c.locator('.ox-tk-status')).toHaveText('Готово');
    await expect(c.locator('.ox-tk-appr')).toHaveCount(0);
  });

  // W4.74, возврат 1: прогон, упавший между переходами, не оставляет задачу «На проверке» — уборка approvalTask
  // (руководитель LOG, «Отменить» с комментарием) переводит её в «Отменена»; здесь уборка вызывается сразу.
  test('уборка задачи прогона: брошенная «На проверке» — «Отменена» (W4.74)', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const title = `${STAND_MARK}уборка ${standSuffix()}`;
    const cleanup = await approvalTask(session, title, undo);
    await cleanup();
    await openT(app, page, title);
    const c = card(page);
    await expect(c.locator('.ox-tk-status')).toHaveText('Отменена', { timeout: 15_000 });
    await expect(c.getByRole('button', { name: 'Согласовать' })).toHaveCount(0);
    await expect(c.locator('.ox-tk-appr')).toHaveCount(0);
  });
});
