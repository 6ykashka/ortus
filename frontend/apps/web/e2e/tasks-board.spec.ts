// W4.12 · e2e экрана `tasks-board` — проект → «Доска» и вид «Список» (эталон design-2026-10-19 «Задачи и проекты.dc.html»
// ЗП:75–96, 127–142, 375–413, cardRel :499; «Список» — разметка старой доски «Ортус CRM.dc.html»:1650–1663,
// no-reference Q-W4.00-tasks-14). Проект LOG сида W4.10: T-64 «Новая», T-66 и T-58 «В работе», T-65 и T-63
// «На проверке» (согласование), T-61 «Готово».
import { expect, test } from './_stand/fixtures.ts';
import { hitHeight, noHorizontalScroll } from './modules.helpers.ts';
import {
  boardCard,
  card,
  column,
  columns,
  filter,
  LOG,
  newTask,
  OFFLINE,
  openProject,
  openTasks,
  phone,
  root,
  scenario,
  T58,
  T64,
  T65,
  T66,
  tab,
  tabs,
  toast,
} from './tasks.helpers.ts';

test.describe('tasks-board — «Доска» и «Список» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(90_000);

  test('шапка проекта: ключ, название, область и уровень, «Вы: Владелец бизнеса», вкладки', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await openProject(page);
    const head = root(page).locator('.ox-tk-phead');
    await expect(head.locator('.ox-tk-key')).toHaveText('LOG');
    await expect(head).toContainText(LOG);
    await expect(head).toContainText('Север Логистик · ограниченный проект · процесс v1');
    await expect(head).toContainText('Вы: Владелец бизнеса');
    await expect(tabs(page).getByRole('tab')).toHaveText([
      'Доска',
      'Список',
      'Участники',
      'Процесс',
      'Автоматизация',
    ]);
  });

  test('колонки статусов процесса со счётчиками; карточки — связь, согласование, номер, приоритет, срок', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await openProject(page);
    await expect(columns(page).locator('.ox-tk-col-name')).toHaveText([
      'Новая',
      'В работе',
      'На проверке',
      'Готово',
      'Отменена',
    ]);
    await expect(columns(page).locator('.ox-tk-col-count')).toHaveText(['1', '2', '2', '1', '0']);
    const t65 = boardCard(page, T65);
    await expect(t65).toContainText('↳ T-66');
    await expect(t65).toContainText('Ждёт вас');
    await expect(t65).toContainText('T-65');
    await expect(t65).toContainText('Высокий');
    await expect(t65).toContainText('10.10');
    await expect(t65.locator('[title="Илья Васильев"]')).toHaveText('ИВ');
    await expect(boardCard(page, T66)).toContainText('☰ 0/2');
    await expect(boardCard(page, T64)).toContainText('Срочно');
    await expect(column(page, 'В работе').locator('.ox-tk-kcard')).toHaveCount(2);
  });

  test('фильтры: «Мои» и «Ждут моего согласия · 2»; выбранный — aria-pressed', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await openProject(page);
    await expect(filter(page, 'Все')).toHaveAttribute('aria-pressed', 'true');
    await expect(filter(page, 'Ждут моего согласия · 2')).toBeVisible();
    await filter(page, 'Ждут моего согласия · 2').click();
    await expect(root(page).locator('.ox-tk-kcard')).toHaveCount(2);
    await expect(column(page, 'На проверке').locator('.ox-tk-kcard')).toHaveCount(2);
    await filter(page, 'Мои').click();
    await expect(filter(page, 'Мои')).toHaveAttribute('aria-pressed', 'true');
    await expect(root(page).locator('.ox-tk-kcard')).toHaveCount(1);
    await expect(boardCard(page, 'Обновить регламент приёмки смены')).toBeVisible();
  });

  test('быстрое создание: Enter создаёт задачу и открывает карточку; пустое поле — диалог', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await openProject(page);
    const input = root(page).getByLabel('Название новой задачи');
    await expect(input).toHaveAttribute('placeholder', 'Новая задача — Enter');
    await input.fill('Купить антифриз');
    await input.press('Enter');
    await expect(toast(page)).toHaveText('Задача создана');
    await expect(
      card(page).getByRole('heading', { level: 3, name: 'Купить антифриз' }),
    ).toBeVisible();
    await expect(card(page)).toContainText('LOG-101');
    await expect(column(page, 'Новая').locator('.ox-tk-col-count')).toHaveText('2');
    await expect(input).toHaveValue('');
    await card(page).getByRole('button', { name: 'Закрыть задачу' }).click();
    await root(page).getByRole('button', { name: 'Задача', exact: true }).click();
    await expect(newTask(page)).toBeVisible();
  });

  test('вид «Список»: строки задач со статусом, исполнителем, приоритетом и сроком; строка открывает карточку', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await openProject(page);
    await tab(page, 'Список').click();
    await expect(page).toHaveURL(/[?&]view=list/);
    const rows = root(page).locator('.ox-tk-lrow');
    await expect(rows).toHaveCount(6);
    const t65 = rows.filter({ hasText: T65 });
    await expect(t65).toContainText('T-65');
    await expect(t65).toContainText('На проверке');
    await expect(t65).toContainText('Илья Васильев');
    await expect(t65).toContainText('Высокий');
    await expect(t65).toContainText('10.10');
    await t65.click();
    await expect(card(page).getByRole('heading', { level: 3, name: T65 })).toBeVisible();
    await card(page).getByRole('button', { name: 'Закрыть задачу' }).click();
    await filter(page, 'Мои').click();
    await expect(rows).toHaveCount(1);
  });

  test('логист — руководитель проекта: «Вы: Руководитель проекта», быстрое создание доступно', async ({
    app,
    page,
  }) => {
    await openTasks(app, page, { persona: 'manager' });
    await openProject(page);
    await expect(root(page).locator('.ox-tk-phead')).toContainText('Вы: Руководитель проекта');
    await expect(root(page).getByLabel('Название новой задачи')).toBeVisible();
    await expect(boardCard(page, T58)).toBeVisible();
    // Название области без org_units.read взять неоткуда (в Project только orgUnitId) — «—» до orgUnitName
    // в ответе проекта (Q-W4.12-10, allowlist tasks-board.md); эталон пишет «Север Логистик».
    await expect(root(page).locator('.ox-tk-ptitle > span')).toHaveText(
      /^(Север Логистик|—) · ограниченный проект · процесс v1$/,
    );
  });

  test('фильтры пишут в адрес approval=1 и mine=1 (ADR-0001), прямая ссылка читается', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await openProject(page);
    await filter(page, 'Ждут моего согласия · 2').click();
    await expect(page).toHaveURL(/[?&]approval=1(&|$)/);
    await filter(page, 'Мои').click();
    await expect(page).toHaveURL(/[?&]mine=1(&|$)/);
    expect(page.url()).not.toContain('%22');
    await page.reload();
    await expect(filter(page, 'Мои')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  });

  test('прораб по ссылке на проект без доступа — «Проектов, доступных вам, пока нет», без «Повторить»', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await openProject(page);
    const project = new URL(page.url()).searchParams.get('project') ?? '';
    await openTasks(app, page, { persona: 'foreman', search: `?project=${project}` });
    await expect(root(page)).toContainText('Проектов, доступных вам, пока нет', {
      timeout: 15_000,
    });
    await expect(root(page).getByRole('button', { name: 'Повторить' })).toHaveCount(0);
    await expect(page).not.toHaveURL(/project=/);
  });

  test('нет связи при быстром создании — тост, задача не появилась; ошибка доски — «Повторить»', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await openProject(page);
    await scenario(page, 'createTask=offline');
    const input = root(page).getByLabel('Название новой задачи');
    await input.fill('Купить антифриз');
    await input.press('Enter');
    await expect(toast(page)).toHaveText(OFFLINE);
    await scenario(page, null);
    await expect(boardCard(page, 'Купить антифриз')).toHaveCount(0);
    await scenario(page, 'listTasks=rate_limited');
    await page.reload();
    await expect(root(page).getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
      { timeout: 15_000 },
    );
    await scenario(page, null);
    await root(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(columns(page)).toHaveCount(5, { timeout: 15_000 });
  });

  test('неизвестный проект в адресе — список проектов', async ({ app, page }) => {
    await openTasks(app, page, { search: '?project=00000000-0000-4000-8000-000000000000' });
    await expect(root(page).getByRole('heading', { level: 2, name: 'Проекты' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('1440 — доска и карточка рядом; 390 — одна колонка, нет горизонтальной прокрутки', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await openProject(page);
    const first = await columns(page).nth(0).boundingBox();
    const second = await columns(page).nth(1).boundingBox();
    if (phone(page)) expect(second?.y ?? 0).toBeGreaterThan(first?.y ?? 0);
    else expect(second?.y).toBe(first?.y);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('клавиатура: Tab до вкладок и карточки, Enter открывает карточку', async ({ app, page }) => {
    await openTasks(app, page);
    await openProject(page);
    const target = boardCard(page, T65);
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(card(page).getByRole('heading', { level: 3, name: T65 })).toBeVisible();
  });

  test('axe без serious; 390 — цели не меньше 44 px', async ({ app, page, axe }) => {
    await openTasks(app, page);
    await openProject(page);
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    if (!phone(page)) return;
    expect(await hitHeight(filter(page, 'Все'))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(tab(page, 'Доска'))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(boardCard(page, T65))).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(root(page).getByRole('button', { name: 'Задача', exact: true })),
    ).toBeGreaterThanOrEqual(44);
  });
});

test.describe('tasks-board — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('доска LOG на стенде (W4.11)', async ({ app, page }) => {
    test.slow();
    await openTasks(app, page);
    await openProject(page);
    await expect(boardCard(page, T65)).toBeVisible();
  });
});
