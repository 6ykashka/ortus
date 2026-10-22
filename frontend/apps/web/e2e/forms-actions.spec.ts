// W4.23 · e2e экрана `forms-actions` — вкладка «Действия после ответа» (эталон design-2026-10-19 «Формы и опросы.dc.html»
// dc:324–410, actionsVM dc:915–984; разбор forms.md §1.7). Правила «Осмотра машины» «Альты»: «Создать задачу» (au-1)
// и «Сохранить в Базу знаний» (au-2, таблица «Осмотры» страницы «Журнал осмотров машин»). Проект задачи — no-reference
// (контракт требует projectId). Данные — MSW W4.05 (задачи — W4.03, «в БЗ» — W4.04); backend — W4.21 (режим stand).
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  call,
  devScenario,
  formsApi,
  noAccess,
  OFFLINE,
  openForm,
  openFromMenu,
  openWithoutRight,
  phone,
  serious,
  smallTargets,
  tab,
  toast,
} from './forms-results.helpers.ts';
import { noHorizontalScroll } from './modules.helpers.ts';

const panel = (page: Page) => page.locator('.ox-fr-ac');
const rules = (page: Page) => panel(page).locator('.ox-fr-rule');
const rule = (page: Page, title: string) =>
  rules(page).filter({ has: page.getByText(title, { exact: true }) });
const ed = (page: Page) => panel(page).locator('.ox-fr-red');
const add = (page: Page, name: string) =>
  panel(page).locator('.ox-fr-adds').getByRole('button', { name });

const KB_TEXT = 'Строка в таблицу «Осмотры» · страница «Журнал осмотров машин»';

test.describe('forms-actions — «Действия после ответа» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(90_000);

  test('карточки правил: вид, текст, мета, «Включено», «Открыть страницу»; пять кнопок «добавить»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'actions' });
    await expect(tab(page, 'actions')).toContainText('2');
    await expect(panel(page)).toContainText(
      'Действие выполняется один раз для каждого ответа. Ответ формы — заявление человека: деньги, склад и объёмы меняют только команды своих модулей.',
    );
    await expect(rules(page)).toHaveCount(2);
    const task = rule(page, 'Создать задачу');
    await expect(task).toContainText('Задача «Проверить осмотр» → Марина Котова');
    await expect(task).toContainText('после принятия ответа · правило v1');
    await expect(task.getByLabel('Включено')).toBeChecked();
    const kb = rule(page, 'Сохранить в Базу знаний');
    await expect(kb).toContainText(KB_TEXT);
    await expect(kb).toContainText('после принятия ответа · правило v1 · записано ответов: 2');
    await expect(kb.getByRole('button', { name: 'Открыть страницу' })).toBeVisible();
    await expect(kb.getByRole('button', { name: 'Изменить' })).toBeVisible();
    await expect(kb.getByRole('button', { name: 'Удалить действие' })).toBeVisible();
    await expect(panel(page).locator('.ox-fr-adds button')).toHaveText([
      'add_taskСоздать задачу',
      'notificationsУведомить сотрудника',
      'mailПисьмо на почту',
      'webhookHTTP-запрос',
      'menu_bookСохранить в Базу знаний',
    ]);
  });

  test('«Включено» — выключить и включить: тосты, счётчик вкладки', async ({ app, page }) => {
    await openForm(app, page, { tab: 'actions' });
    await rule(page, 'Создать задачу').getByLabel('Включено').uncheck();
    await expect(toast(page)).toHaveText('Действие выключено');
    await expect(tab(page, 'actions')).toContainText('1');
    await rule(page, 'Создать задачу').getByLabel('Включено').check();
    await expect(toast(page).last()).toHaveText('Действие включено');
    await expect(tab(page, 'actions')).toContainText('2');
  });

  // Возврат 4: после команды вкладки (общее перечитывание «Форм») вопросы черновика остаются в редакторе действия.
  test('после «Включено» — «Только если» и «Новая таблица по вопросам формы» с вопросами формы', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'actions' });
    await rule(page, 'Создать задачу').getByLabel('Включено').uncheck();
    await expect(toast(page)).toHaveText('Действие выключено');
    await expect(tab(page, 'actions')).toContainText('1');
    await add(page, 'Создать задачу').click();
    await expect(ed(page).getByLabel('Только если').locator('option')).toHaveText([
      'Для всех ответов',
      'Уровень топлива',
      'Чек-лист: кузов, шины, документы',
      'Есть дефекты?',
      'Дефект критический',
    ]);
    await ed(page).getByRole('button', { name: 'Отмена' }).click();
    await add(page, 'Сохранить в Базу знаний').click();
    await ed(page)
      .getByLabel(/^Страница Базы знаний/)
      .selectOption({ label: '＋ Новая страница' });
    await expect(ed(page).locator('.ox-fr-map-row')).toHaveCount(11);
  });

  test('«Удалить действие» — фокус на карточку, вставшую на место удалённой', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'actions' });
    await rule(page, 'Создать задачу').getByRole('button', { name: 'Удалить действие' }).click();
    await expect(toast(page)).toHaveText('Действие удалено');
    await expect(rules(page)).toHaveCount(1);
    await expect(rules(page).first().getByLabel('Включено')).toBeFocused();
  });

  test('новая задача: название по умолчанию, проект и исполнитель; «Действие добавлено»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'actions' });
    await add(page, 'Создать задачу').click();
    await expect(ed(page).getByRole('heading', { level: 3 })).toHaveText(
      'Новое действие: создать задачу',
    );
    await expect(panel(page).locator('.ox-fr-adds')).toHaveCount(0);
    await expect(ed(page).getByLabel('Когда')).toHaveValue('submitted');
    await expect(ed(page).getByLabel('Название задачи')).toHaveValue(
      'Проверить ответ: Осмотр машины',
    );
    await expect(ed(page)).toContainText('В описание задачи попадут ответы и ссылка на ответ.');
    await ed(page).getByLabel('Название задачи').fill('');
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(ed(page).getByRole('alert')).toHaveText('Укажите название задачи');
    await ed(page).getByLabel('Название задачи').fill('Разобрать осмотр');
    await ed(page).getByLabel('Только если').selectOption({ label: 'Есть дефекты?' });
    await expect(ed(page).getByLabel('равно')).toHaveValue('true');
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Действие добавлено');
    await expect(rules(page)).toHaveCount(3);
    await expect(rules(page).nth(2)).toContainText('Задача «Разобрать осмотр» →');
    await expect(rules(page).nth(2)).toContainText(
      'после отправки ответа · если «Есть дефекты?» = да · правило v1',
    );
  });

  test('письмо и HTTP: проверки адреса, пояснения показа; уведомление — «Кому»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'actions' });
    await add(page, 'Письмо на почту').click();
    await expect(ed(page).getByLabel('Адрес')).toHaveAttribute('placeholder', 'office@example.ru');
    await expect(ed(page)).toContainText('На показе письма не отправляются.');
    await ed(page).getByLabel('Адрес').fill('почта');
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(ed(page).getByRole('alert')).toHaveText('Укажите адрес почты');
    await ed(page).getByRole('button', { name: 'Отмена' }).click();
    await add(page, 'HTTP-запрос').click();
    await expect(ed(page)).toContainText(
      'На показе запрос не выполняется. В продукте — подписанный вебхук с повтором.',
    );
    await ed(page).getByLabel('Адрес запроса (POST, JSON с ответами)').fill('http://example.ru');
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(ed(page).getByRole('alert')).toHaveText(
      'Адрес запроса должен начинаться с https://',
    );
    await ed(page)
      .getByLabel('Адрес запроса (POST, JSON с ответами)')
      .fill('https://example.ru/hook');
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Действие добавлено');
    await expect(rule(page, 'HTTP-запрос')).toContainText('POST https://example.ru/hook');
    await add(page, 'Уведомить сотрудника').click();
    await ed(page).getByLabel('Кому').selectOption({ label: 'Марина Котова' });
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page).last()).toHaveText('Действие добавлено');
    await expect(rule(page, 'Уведомить сотрудника')).toContainText(
      'Уведомление в CRM → Марина Котова',
    );
  });

  test('«в БЗ» на существующую таблицу: сопоставление, пример строки R-1012, подтверждение', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'actions' });
    await add(page, 'Сохранить в Базу знаний').click();
    await expect(ed(page).getByLabel('Когда')).toHaveValue('accepted');
    await expect(ed(page)).toContainText(
      'Выберите страницу или создайте новую — пункт «Новая страница» в конце списка.',
    );
    await ed(page)
      .getByLabel('Страница Базы знаний')
      .selectOption({ label: 'Логистика · Журнал осмотров машин' });
    await expect(ed(page).getByLabel('Таблица на странице')).toHaveValue(/.+/);
    await expect(ed(page).getByLabel('Таблица на странице').locator('option')).toContainText([
      'Осмотры · строк: 2',
      'Новая таблица по вопросам формы',
    ]);
    await expect(ed(page)).toContainText('Столбцы таблицы и данные для них');
    await expect(ed(page).getByLabel('Данные для поля «Дата»')).toHaveValue('$at');
    await expect(ed(page)).toContainText(
      'Так будет выглядеть строка для ответа R-1012 от 27.09 09:05',
    );
    await expect(ed(page).locator('table tbody td').first()).toHaveText('27.09 09:05');
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(ed(page).getByRole('alert')).toHaveText(
      'Подтвердите, что записи увидят все сотрудники с доступом к странице',
    );
    await ed(page)
      .getByLabel(/^Понимаю: записи увидят все сотрудники/)
      .check();
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Действие добавлено');
    await expect(rules(page)).toHaveCount(3);
    await expect(rules(page).nth(2)).toContainText(KB_TEXT);
  });

  test('«＋ Новая страница» с новой таблицей — тост эталона; «Перенести прошлые ответы · 2»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'actions' });
    await add(page, 'Сохранить в Базу знаний').click();
    await ed(page).getByLabel('Страница Базы знаний').selectOption({ label: '＋ Новая страница' });
    await expect(ed(page).getByLabel('Название страницы')).toHaveValue('Ответы: Осмотр машины');
    await expect(ed(page).getByLabel('Раздел')).toHaveValue(/.+/);
    await expect(ed(page).getByLabel('Название новой таблицы')).toHaveValue('Ответы формы');
    await expect(ed(page)).toContainText('Столбцы новой таблицы');
    await ed(page)
      .getByLabel(/^Понимаю: записи увидят все сотрудники/)
      .check();
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText(
      'Страница «Ответы: Осмотр машины» создана с таблицей «Ответы формы». Действие добавлено',
    );
    const created = rules(page).nth(2);
    await expect(created).toContainText(
      'Строка в таблицу «Ответы формы» · страница «Ответы: Осмотр машины»',
    );
    await created.getByRole('button', { name: 'Перенести прошлые ответы · 2' }).click();
    await expect(toast(page).last()).toHaveText('Перенесено в Базу знаний: 2 ответа');
    await expect(created).toContainText('записано ответов: 2');
  });

  test('«＋ Новая страница» «Только владелец»: без «Понимаю…», страница — «Только выбранные»', async ({
    app,
    page,
  }) => {
    const o = await openForm(app, page, { tab: 'actions' });
    await add(page, 'Сохранить в Базу знаний').click();
    await expect(ed(page).getByLabel('Страница Базы знаний').locator('option')).toContainText([
      'Руководство · Политика начислений водителям · только владелец',
    ]);
    await ed(page).getByLabel('Страница Базы знаний').selectOption({ label: '＋ Новая страница' });
    await ed(page)
      .getByRole('group', { name: 'Кто видит страницу' })
      .getByRole('button', { name: 'Только владелец' })
      .click();
    await expect(ed(page)).toContainText('Страницу и записи увидит только владелец.');
    await expect(ed(page).getByLabel(/^Понимаю: записи увидят все сотрудники/)).toHaveCount(0);
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText(
      'Страница «Ответы: Осмотр машины» создана с таблицей «Ответы формы». Действие добавлено',
    );
    // Доступ созданной страницы на сервере — «Только выбранные» без записей.
    const rulesNow = await call(page, 'GET', `${formsApi(o)}/rules`);
    const created = (
      rulesNow.body as { items: { kind: string; kb?: { nodeId: string } }[] }
    ).items.at(-1);
    expect(created?.kind).toBe('kb');
    const acc = await call(
      page,
      'GET',
      `/api/v1/tenants/${o.tenant}/knowledge/nodes/${created?.kb?.nodeId ?? ''}/access`,
    );
    expect(acc.status).toBe(200);
    expect(acc.body).toMatchObject({ accessMode: 'listed', entries: [] });
  });

  test('«Изменить» — «Действие обновлено · правило v2»; «Удалить действие» «в БЗ» — тост эталона', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'actions' });
    await rule(page, 'Создать задачу').getByRole('button', { name: 'Изменить' }).click();
    await expect(ed(page).getByRole('heading', { level: 3 })).toHaveText(
      'Изменить: создать задачу',
    );
    await ed(page).getByLabel('Название задачи').fill('Проверить осмотр машины');
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Действие обновлено · правило v2');
    await expect(rule(page, 'Создать задачу')).toContainText('правило v2');
    await rule(page, 'Сохранить в Базу знаний')
      .getByRole('button', { name: 'Удалить действие' })
      .click();
    await expect(toast(page).last()).toHaveText(
      'Действие удалено. Уже записанные строки остаются в Базе знаний',
    );
    await expect(rules(page)).toHaveCount(1);
  });

  test('«Открыть страницу» карточки — страница «Базы знаний»', async ({ app, page }) => {
    await openForm(app, page, { tab: 'actions' });
    await rule(page, 'Сохранить в Базу знаний')
      .getByRole('button', { name: 'Открыть страницу' })
      .click();
    await expect(page).toHaveURL(/\/knowledge\?space=.+&page=/);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Журнал осмотров машин' }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('логист — только просмотр: переключатели недоступны, нет «Изменить» и добавления', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'actions', persona: 'manager' });
    await expect(rules(page)).toHaveCount(2);
    // Исполнитель задачи — сама Марина Котова (listMembers логиста — только его область).
    await expect(rule(page, 'Создать задачу')).toContainText(
      'Задача «Проверить осмотр» → Марина Котова',
    );
    await expect(rule(page, 'Сохранить в Базу знаний')).toContainText(KB_TEXT);
    await expect(rule(page, 'Создать задачу').getByLabel('Включено')).toBeDisabled();
    await expect(panel(page).getByRole('button', { name: 'Изменить' })).toHaveCount(0);
    await expect(panel(page).locator('.ox-fr-adds')).toHaveCount(0);
    await expect(
      rule(page, 'Сохранить в Базу знаний').getByRole('button', { name: 'Открыть страницу' }),
    ).toBeVisible();
  });

  test('ошибка загрузки правил — «Повторить»; нет связи при сохранении — тост, правка не теряется', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'settings' });
    await devScenario(page, { scenario: 'listFormRules=rate_limited' });
    await tab(page, 'actions').click();
    await expect(panel(page).getByRole('alert')).toContainText('Не удалось загрузить данные');
    await devScenario(page, { scenario: null });
    await panel(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(rules(page)).toHaveCount(2);
    await devScenario(page, { scenario: 'createFormRule=offline' });
    await add(page, 'Создать задачу').click();
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(ed(page).getByLabel('Название задачи')).toHaveValue(
      'Проверить ответ: Осмотр машины',
    );
    await devScenario(page, { scenario: null });
    await ed(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page).last()).toHaveText('Действие добавлено');
  });

  // Возврат 2 (dc:665): правило не сохранилось после созданной страницы — нет связи и 429 не оставляют «Сохраняем…».
  for (const code of ['offline', 'rate_limited'] as const) {
    test(`«＋ Новая страница»: createFormRule=${code} — «Страница создана, но действие не сохранено», повтор сохраняет`, async ({
      app,
      page,
    }) => {
      await openForm(app, page, { tab: 'actions' });
      await add(page, 'Сохранить в Базу знаний').click();
      await ed(page)
        .getByLabel('Страница Базы знаний')
        .selectOption({ label: '＋ Новая страница' });
      await ed(page)
        .getByLabel(/^Понимаю: записи увидят все сотрудники/)
        .check();
      await devScenario(page, { scenario: `createFormRule=${code}` });
      const saveBtn = ed(page).getByRole('button', { name: 'Сохранить' });
      await saveBtn.click();
      await expect(ed(page).getByRole('alert')).toHaveText(
        /^Страница создана, но действие не сохранено: .+/,
      );
      if (code === 'offline') await expect(toast(page)).toHaveText(OFFLINE);
      await expect(saveBtn).toHaveAttribute('aria-busy', 'false');
      await expect(ed(page).getByRole('button', { name: 'Отмена' })).toBeEnabled();
      await expect(ed(page).getByLabel('Название страницы')).toHaveCount(0);
      await expect(ed(page).getByLabel('Страница Базы знаний')).not.toHaveValue('__new');
      await expect(
        ed(page).getByLabel('Страница Базы знаний').locator('option:checked'),
      ).toHaveText(/Ответы: Осмотр машины$/);
      await expect(rules(page)).toHaveCount(2);
      await devScenario(page, { scenario: null });
      await saveBtn.click();
      await expect(toast(page).last()).toHaveText('Действие добавлено');
      await expect(rules(page)).toHaveCount(3);
      await expect(rules(page).nth(2)).toContainText(
        'Строка в таблицу «Ответы формы» · страница «Ответы: Осмотр машины»',
      );
    });
  }

  test('открывается из меню «Формы и опросы»: список → «Осмотр машины» → «Действия после ответа»', async ({
    app,
    page,
  }) => {
    await openFromMenu(app, page, 'actions');
    await expect(tab(page, 'actions')).toHaveAttribute('aria-selected', 'true');
    await expect(rules(page)).toHaveCount(2);
  });

  test('нет права: логист без роли в «Формах» — раздел закрыт', async ({ app, page }) => {
    await openWithoutRight(app, page, 'actions');
    await expect(noAccess(page)).toBeVisible({ timeout: 15_000 });
    await expect(panel(page)).toHaveCount(0);
  });

  test('загрузка правил — скелет во всю ширину вкладки', async ({ app, page }) => {
    await openForm(app, page, { tab: 'build' });
    await devScenario(page, { scenario: 'listFormRules=loading' });
    await tab(page, 'actions').click();
    const sk = panel(page).getByRole('status', { name: 'Загрузка' });
    await expect(sk).toBeVisible();
    const box = await sk.locator('span').first().boundingBox();
    const outer = await panel(page).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan((outer?.width ?? 0) * 0.9);
    await expect(rules(page)).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('клавиатура: Enter открывает редактор (фокус на заголовке), Tab по полям, «Отмена» — фокус обратно; Space — «Включено»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'actions' });
    await add(page, 'Письмо на почту').focus();
    await page.keyboard.press('Enter');
    await expect(ed(page).getByRole('heading', { level: 3 })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(ed(page).getByLabel('Когда')).toBeFocused();
    await ed(page).getByRole('button', { name: 'Отмена' }).focus();
    await page.keyboard.press('Enter');
    await expect(ed(page)).toHaveCount(0);
    await expect(add(page, 'Письмо на почту')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(add(page, 'HTTP-запрос')).toBeFocused();
    await rule(page, 'Создать задачу').getByLabel('Включено').focus();
    await page.keyboard.press('Space');
    await expect(toast(page)).toHaveText('Действие выключено');
    await page.keyboard.press('Space');
    await expect(toast(page).last()).toHaveText('Действие включено');
  });

  test('390 / 1440: без горизонтальной прокрутки, цели 44 px, axe — карточки и редактор «в БЗ»', async ({
    app,
    page,
    axe,
  }) => {
    await openForm(app, page, { tab: 'actions' });
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(panel(page))).toEqual([]);
    expect(await serious(page, axe)).toEqual([]);
    await add(page, 'Сохранить в Базу знаний').click();
    await ed(page)
      .getByLabel('Страница Базы знаний')
      .selectOption({ label: 'Логистика · Журнал осмотров машин' });
    await expect(ed(page)).toContainText('Столбцы таблицы и данные для них');
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(ed(page))).toEqual([]);
    expect(await serious(page, axe)).toEqual([]);
  });
});

test.describe('forms-actions — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('владелец на стенде: правила «Осмотра машины»', async ({ app, page }) => {
    // W4.21: listFormRules, createFormRule, backfillFormRule стенда — до W4.21 тег Forms отвечает 501.
    await openForm(app, page, { tab: 'actions' });
    await expect(rules(page)).toHaveCount(2);
  });
});
