// W4.61 · e2e страницы `platform-users` — «Пользователи платформы» оператора (эталон design-2026-10-19, «Ортус
// CRM.dc.html» pg.accounts :987–1159, accountsVM :3619–3679, platformOrgVM :3807–3851; чек-лист
// docs/plan/analysis/04-platform.md §8 п. 26–38, обязательные пункты verification-protocol.md §1.3). Каталог —
// listPlatformUsers/getPlatformUser, операторы — listPlatformOperators и команды W4.07.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import {
  confirmDialog,
  openPlatform,
  platformUser,
  section,
  textOf,
  toastText,
} from './billing.helpers.ts';
import { hitHeight, noHorizontalScroll } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const H1 = { level: 1, name: 'Пользователи платформы' } as const;

const orgsNav = (root: Locator) => root.getByRole('navigation', { name: 'Организации' });
const realm = (root: Locator, name: string) =>
  orgsNav(root).getByRole('button').filter({ hasText: name });
const accountRows = (root: Locator) => root.locator('.ox-acc-row > button[aria-pressed]');
const accountRow = (root: Locator, name: string) =>
  accountRows(root).filter({ has: root.page().locator('.ox-acc-name', { hasText: name }) });
const card = (page: Page) => page.getByRole('complementary', { name: 'Карточка аккаунта' });
const filters = (root: Locator) => root.getByRole('group', { name: 'Фильтр аккаунтов' });
const operatorRow = (root: Locator, name: string) =>
  root.locator('.ox-op-row').filter({ hasText: name });

test.describe('platform-users — «Пользователи платформы» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'данные сида MSW и сценарии — режим mock');
  // Под нагрузкой общей машины вход и холодная загрузка страницы занимают до 30 с.
  test.describe.configure({ timeout: 60_000 });

  test('меню «Пользователи» и прямой URL: заголовок, data-screen-label, баннер', async ({
    app,
    page,
  }) => {
    await app('/platform/tenants', { persona: 'operator' });
    await page.setViewportSize({ width: 1440, height: 900 });
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('button', { name: 'Пользователи' }).click();
    await expect(page).toHaveURL(/\/platform\/accounts$/);
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const root = section(page, 'h-acc');
    await expect(root).toHaveAttribute('data-screen-label', 'Оператор · пользователи');
    await expect(
      root.getByText(
        'Каждая организация — отдельная структура со своими участниками. Выберите её слева, чтобы посмотреть, кто в ней состоит. Наведите на человека, и появится список всех его организаций. Роли, данные и действия внутри организаций оператору не видны, добавлять людей может только владелец.',
      ),
    ).toBeVisible();
    await page.goto('/platform/accounts');
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
  });

  test('организации слева, поиск, итог и фильтры со счётчиками (04 §8 п. 26)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    const nav = orgsNav(root);
    expect(await textOf(realm(root, 'Ортус · Платформа'))).toBe(
      'о Ортус · Платформаоператоры · отдельный вход 5',
    );
    await expect(realm(root, 'Все аккаунты')).toHaveAttribute('aria-current', 'page');
    expect(await textOf(realm(root, 'Все аккаунты'))).toBe('public Все аккаунтывся платформа 58');
    expect(await textOf(realm(root, 'Альта Групп'))).toBe(
      'А Альта ГруппПробный период · мест 9/10 10',
    );
    expect(await textOf(realm(root, 'SPA «Лотос»'))).toBe('Л SPA «Лотос»Действует · мест 23/25 23');
    expect(await textOf(realm(root, 'Ремстрой Плюс'))).toBe(
      'Р Ремстрой ПлюсОграничен · мест 5/10 5',
    );
    expect(await textOf(realm(root, 'Карго Сити'))).toBe(
      'К Карго СитиПриостановлен · мест 22/25 22',
    );
    await expect(nav.getByText('Организации клиентов')).toBeVisible();
    await expect(root.getByLabel('Поиск по имени, почте или организации')).toHaveAttribute(
      'placeholder',
      'Имя, почта или организация',
    );
    await expect(root.locator('.ox-acc-total')).toHaveText('Аккаунтов на платформе: 58');
    await expect(filters(root).getByRole('button')).toHaveText([
      'Все · 58',
      'В нескольких организациях · 2',
      'Без второго фактора · 36',
      'Заблокированы · 1',
      'Не входили · 2',
    ]);
  });

  test('карточка аккаунта «Анна Морозова»: статус, вход, второй фактор, участия (04 §8 п. 27)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await accountRow(root, 'Анна Морозова').click();
    const c = card(page);
    await expect(c.getByRole('heading', { level: 2, name: 'Анна Морозова' })).toBeVisible();
    await expect(c).toContainText('a.morozova@alta.example');
    await expect(c.locator('.ox-chip-label').first()).toHaveText('Активен');
    expect(await textOf(c.locator('dl'))).toBe(
      'Последний вход30.09 19:05 Второй факторНе настроен',
    );
    const ms = c.locator('.ox-acc-membership');
    await expect(ms).toHaveCount(2);
    expect(await textOf(ms.nth(0))).toBe('domainАльта Группcheckучастник');
    expect(await textOf(ms.nth(1))).toBe('domainSPA «Лотос»checkучастник');
    await expect(
      c.getByText(
        'Один аккаунт в 2 организациях: данные организаций не пересекаются, у каждой свои роли и места.',
      ),
    ).toBeVisible();
    await expect(c.getByLabel('Причина блокировки')).toHaveAttribute(
      'placeholder',
      'Например: подозрительные входы',
    );
    await expect(c.getByRole('button', { name: 'Заблокировать вход' })).toBeVisible();
    await expect(c.getByRole('button', { name: 'Сбросить второй фактор' })).toHaveCount(0);
    await expect(
      c.getByText(
        'Пароль и почту меняет сам человек через вход. Оператор не входит от имени пользователя.',
      ),
    ).toBeVisible();
  });

  test('поиск «Шишкин»: одна строка, «· показано 1», разблокировка с диалогом (04 §8 п. 28)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await root.getByLabel('Поиск по имени, почте или организации').fill('Шишкин');
    await expect(accountRows(root)).toHaveCount(1);
    await expect(root.locator('.ox-acc-total')).toHaveText(
      'Аккаунтов на платформе: 58 · показано 1',
    );
    const row = accountRow(root, 'Денис Шишкин');
    await expect(row.locator('.ox-chip-label')).toContainText(['Вход заблокирован']);
    await row.click();
    const c = card(page);
    await expect(
      c.getByText('Причина блокировки: Подозрительные входы из разных стран, 18.09'),
    ).toBeVisible();
    await expect(c.getByRole('button', { name: 'Разблокировать вход' })).toBeVisible();
    await expect(c.getByRole('button', { name: 'Сбросить второй фактор' })).toBeVisible();
    await c.getByRole('button', { name: 'Разблокировать вход' }).click();
    const d = confirmDialog(page, 'Разблокировать вход d.shishkin@cargo.example?');
    await expect(d.locator('li')).toHaveText([
      'lock_openАккаунт снова сможет входить в свои организации',
    ]);
    await d.getByRole('button', { name: 'Разблокировать' }).click();
    await expect(toastText(page)).toHaveText('Готово · запись добавлена в журнал');
    await expect(c.locator('.ox-chip-label').first()).toHaveText('Активен');
    await expect(c.getByRole('button', { name: 'Заблокировать вход' })).toBeVisible();
  });

  test('ничего не нашли: «Никого не нашли. Измените запрос или фильтр.» (04 §8 п. 29)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await root.getByLabel('Поиск по имени, почте или организации').fill('zzz');
    await expect(root.getByText('Никого не нашли. Измените запрос или фильтр.')).toBeVisible();
    await expect(accountRows(root)).toHaveCount(0);
  });

  test('блокировка входа: пустая причина — тост, с причиной — диалог, «Заблокированы · 2» (04 §8 п. 30)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await accountRow(root, 'Анна Морозова').click();
    const c = card(page);
    await c.getByRole('button', { name: 'Заблокировать вход' }).click();
    await expect(toastText(page)).toHaveText('Укажите причину блокировки');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await c.getByLabel('Причина блокировки').fill('Подозрительные входы');
    await c.getByRole('button', { name: 'Заблокировать вход' }).click();
    const d = confirmDialog(page, 'Заблокировать вход a.morozova@alta.example?');
    await expect(d).toContainText('Причина: Подозрительные входы');
    await expect(d.locator('li')).toHaveText([
      'lockАккаунт не сможет войти ни в одну организацию (их 2)',
      'groupУчастие, роли и места в организациях не меняются: ими управляют владельцы',
      'policyИспользуется для защиты аккаунта, а не для неоплаты',
    ]);
    await d.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(toastText(page)).toHaveText('Готово · запись добавлена в журнал');
    await expect(c.locator('.ox-chip-label').first()).toHaveText('Вход заблокирован');
    await expect(c.getByText('Причина блокировки: Подозрительные входы')).toBeVisible();
    await expect(filters(root).getByRole('button', { name: 'Заблокированы · 2' })).toBeVisible();
  });

  test('popover «Организации аккаунта» по наведению и фокусу, переход в организацию (04 §8 п. 31)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await accountRow(root, 'Алексей Соколов').hover();
    // Возврат 1 (ревью, minor): у popover роль group — aria-label озвучивается.
    const pop = root.getByRole('group', { name: 'Организации аккаунта' });
    await expect(pop).toBeVisible();
    await expect(pop).toContainText('Организации аккаунта · 2 действующ.');
    const items = pop.getByRole('button');
    await expect(items).toHaveCount(2);
    expect(await textOf(items.nth(0))).toBe(
      'domain Альта ГруппПробный период checkучастник chevron_right',
    );
    expect(await textOf(items.nth(1))).toBe(
      'domain Ремстрой ПлюсОграничен checkучастник chevron_right',
    );
    await expect(pop).toContainText('Нажмите, чтобы открыть организацию');
    await items.nth(1).click();
    await expect(realm(root, 'Ремстрой Плюс')).toHaveAttribute('aria-current', 'page');
    const head = root.locator('.ox-acc-orghead');
    await expect(head.locator('strong')).toHaveText('Ремстрой Плюс');
    await expect(head.locator('.ox-chip-label')).toHaveText('Ограничен');
    await expect(head).toContainText('Владелец: Павел Орлов · тариф «Старт» · мест 5 из 10');
    await expect(head.getByRole('button', { name: 'Карточка организации' })).toBeVisible();
    await expect(root.locator('.ox-acc-total')).toHaveText('Участников в организации: 5');
    await expect(accountRow(root, 'Алексей Соколов')).toHaveAttribute('aria-pressed', 'true');
    await expect(accountRow(root, 'Павел Орлов').locator('.ox-chip-label').first()).toHaveText(
      'участник · владелец',
    );
    // Фокус с клавиатуры открывает тот же список.
    await accountRow(root, 'Павел Орлов').focus();
    await expect(root.locator('[aria-label="Организации аккаунта"]')).toContainText(
      'Организации аккаунта · 1 действующ.',
    );
  });

  test('организация «Альта Групп»: чипы участия, «Не входили · 2», «Карточка организации» (04 §8 п. 32)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await realm(root, 'Альта Групп').click();
    await expect(page).toHaveURL(/\/platform\/accounts\?org=/);
    await expect(accountRow(root, 'Олеся Петрова').locator('.ox-chip-label').first()).toHaveText(
      'приглашён',
    );
    await expect(accountRow(root, 'Кирилл Громов').locator('.ox-chip-label').first()).toHaveText(
      'приостановлен',
    );
    await expect(filters(root).getByRole('button', { name: 'Не входили · 2' })).toBeVisible();
    await root.getByRole('button', { name: 'Карточка организации' }).click();
    await expect(page.getByRole('complementary', { name: 'Альта Групп' })).toBeVisible();
  });

  test('«Ортус · Платформа»: тёмная карточка, роли, операторы, приглашение, правила (04 §8 п. 33)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await realm(root, 'Ортус · Платформа').click();
    await expect(realm(root, 'Ортус · Платформа')).toHaveCSS('background-color', 'rgb(34, 48, 44)');
    const head = root.locator('.ox-pf-head');
    await expect(head).toContainText('Системная организация');
    await expect(head).toContainText('Операторов: 5 · активных владельцев: 2');
    await expect(root.getByLabel('Поиск по имени, почте или организации')).toHaveCount(0);
    await expect(filters(root)).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    const roles = root.locator('.ox-pf-role');
    await expect(roles).toHaveCount(4);
    expect(await textOf(roles.nth(0))).toBe(
      'shield_personВладелец платформы2 Всё, включая операторов, тарифную сетку и закрытие организаций',
    );
    await expect(roles.nth(1)).toContainText('Администратор0');
    await expect(roles.nth(2)).toContainText('Биллинг1');
    await expect(roles.nth(3)).toContainText('Поддержка2');
    await expect(root.getByRole('heading', { level: 2, name: 'Операторы' })).toBeVisible();
    await expect(root.locator('.ox-op-row')).toHaveCount(6);
    const me = operatorRow(root, 'Евгения Лаптева');
    await expect(me).toContainText('вы');
    await expect(me.getByLabel('Роль: Евгения Лаптева')).toBeDisabled();
    await expect(me).toContainText('Свою роль менять нельзя');
    await expect(me).toContainText('2FA: аппаратный ключ');
    const dina = operatorRow(root, 'Дина Валиева');
    await expect(dina.locator('.ox-chip-label')).toHaveText('Приглашён');
    await expect(dina).toContainText('2FA не настроен');
    await expect(dina).toContainText('ещё не входил');
    await expect(dina.getByRole('button', { name: 'Отозвать приглашение' })).toBeVisible();
    const st = operatorRow(root, 'Станислав Рябов');
    await expect(st.locator('.ox-chip-label')).toHaveText('Отключён');
    await expect(st).toContainText('Отключён 15.08: перевод в другой отдел');
    await expect(st.getByRole('button', { name: 'Включить' })).toBeVisible();
    await expect(
      root.getByRole('heading', { level: 2, name: 'Пригласить оператора' }),
    ).toBeVisible();
    await expect(root.locator('.ox-pf-rules li')).toHaveCount(7);
  });

  test('отключение Сорокина: диалог, предупреждение «Активный владелец один…», «Включить» (04 §8 п. 34)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts', { query: '?org=platform' });
    await operatorRow(root, 'Михаил Сорокин').getByRole('button', { name: 'Отключить' }).click();
    const d = confirmDialog(page, 'Отключить оператора?');
    await expect(d).toContainText('Михаил Сорокин · m.sorokin@ortus.example');
    await expect(d.locator('li')).toHaveText([
      'logoutСессии завершатся, вход в панель платформы закроется',
      'key_offВременные доступы поддержки, выданные ему, будут отозваны',
      'historyЕго действия остаются в журнале',
    ]);
    await d.getByRole('button', { name: 'Отключить' }).click();
    await expect(toastText(page)).toHaveText('Готово · запись добавлена в журнал');
    await expect(operatorRow(root, 'Михаил Сорокин').locator('.ox-chip-label')).toHaveText(
      'Отключён',
    );
    await expect(root.getByRole('status').filter({ hasText: 'Активный владелец один' })).toHaveText(
      'warningАктивный владелец один. Назначьте второго, чтобы не потерять управление платформой при отпуске или увольнении.',
    );
    // У себя — «Свою роль менять нельзя» (platformOrgVM :3829: подсказка «me» важнее «последнего владельца»).
    await expect(operatorRow(root, 'Евгения Лаптева')).toContainText('Свою роль менять нельзя');
    await expect(root.locator('.ox-pf-head')).toContainText(
      'Операторов: 4 · активных владельцев: 1',
    );
    await operatorRow(root, 'Михаил Сорокин').getByRole('button', { name: 'Включить' }).click();
    await expect(toastText(page)).toHaveText('Оператор снова активен');
    await expect(
      root.getByRole('status').filter({ hasText: 'Активный владелец один' }),
    ).toHaveCount(0);
  });

  test('смена роли: «Администратор» без диалога, «Владелец платформы» — с диалогом (04 §8 п. 35)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts', { query: '?org=platform' });
    await operatorRow(root, 'Алёна Гусева').getByLabel('Роль: Алёна Гусева').selectOption('admin');
    await expect(toastText(page)).toHaveText('Роль изменена: Администратор');
    await expect(root.locator('.ox-pf-role').nth(1)).toContainText('Администратор1');
    await operatorRow(root, 'Алёна Гусева').getByLabel('Роль: Алёна Гусева').selectOption('owner');
    const d = confirmDialog(page, 'Назначить владельцем платформы?');
    await expect(d).toContainText('Алёна Гусева · a.guseva@ortus.example');
    await d.getByRole('button', { name: 'Назначить' }).click();
    await expect(toastText(page)).toHaveText('Готово · запись добавлена в журнал');
    await expect(root.locator('.ox-pf-role').nth(0)).toContainText('Владелец платформы3');
  });

  test('владельцем — только активный со вторым фактором: тост ошибки у Дины Валиевой (04 §8 п. 36)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts', { query: '?org=platform' });
    await operatorRow(root, 'Дина Валиева').getByLabel('Роль: Дина Валиева').selectOption('owner');
    await confirmDialog(page, 'Назначить владельцем платформы?')
      .getByRole('button', { name: 'Назначить' })
      .click();
    await expect(page.locator('.ox-toast[role="alert"]')).toHaveText(
      /Владельцем может стать только активный оператор со вторым фактором/,
    );
    await expect(operatorRow(root, 'Дина Валиева').getByLabel('Роль: Дина Валиева')).toHaveValue(
      'support',
    );
  });

  test('приглашение оператора: проверки и успешная отправка (04 §8 п. 37)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts', { query: '?org=platform' });
    const form = root.locator('.ox-pf-invite');
    const send = form.getByRole('button', { name: 'Отправить приглашение' });
    await send.click();
    await expect(toastText(page)).toHaveText('Укажите имя и рабочую почту');
    await form.getByLabel('Имя и фамилия').fill('Пётр Новый');
    await form.getByLabel('Рабочая почта').fill('x@mail.ru');
    await send.click();
    await expect(toastText(page)).toHaveText(
      'Оператором может быть только сотрудник платформы: почта в домене ortus.example',
    );
    await form.getByLabel('Рабочая почта').fill('e.lapteva@ortus.example');
    await send.click();
    await expect(toastText(page)).toHaveText('Оператор с такой почтой уже есть');
    await form.getByLabel('Рабочая почта').fill('p.novy@ortus.example');
    await expect(form.getByLabel('Роль')).toHaveValue('support');
    await send.click();
    await expect(toastText(page)).toHaveText('Приглашение отправлено: p.novy@ortus.example');
    await expect(operatorRow(root, 'Пётр Новый').locator('.ox-chip-label')).toHaveText('Приглашён');
    await expect(form.getByLabel('Имя и фамилия')).toHaveValue('');
    await expect(root.locator('.ox-pf-role').nth(3)).toContainText('Поддержка3');
  });

  // Почта аккаунта клиента вне домена платформы: как эталон (api.js :385–387), первым срабатывает проверка домена.
  test('почта клиента d.zimina@alta.example: сообщение о домене платформы (04 §8 п. 37)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts', { query: '?org=platform' });
    const form = root.locator('.ox-pf-invite');
    await form.getByLabel('Имя и фамилия').fill('Дарья');
    await form.getByLabel('Рабочая почта').fill('d.zimina@alta.example');
    await form.getByRole('button', { name: 'Отправить приглашение' }).click();
    await expect(toastText(page)).toHaveText(
      'Оператором может быть только сотрудник платформы: почта в домене ortus.example',
    );
  });

  test('отзыв приглашения Дины Валиевой: тост, строка удалена (04 §8 п. 38)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts', { query: '?org=platform' });
    await operatorRow(root, 'Дина Валиева')
      .getByRole('button', { name: 'Отозвать приглашение' })
      .click();
    await expect(toastText(page)).toHaveText('Приглашение отозвано');
    await expect(operatorRow(root, 'Дина Валиева')).toHaveCount(0);
  });

  test('сброс второго фактора: диалог, кнопка исчезает', async ({ app, page }) => {
    const root = await openPlatform(app, page, 'accounts');
    await accountRow(root, 'Дарья Зимина').click();
    const c = card(page);
    await c.getByRole('button', { name: 'Сбросить второй фактор' }).click();
    const d = confirmDialog(page, 'Сбросить второй фактор?');
    await expect(d).toContainText('d.zimina@alta.example');
    await expect(d.locator('li')).toHaveText([
      'keyПри следующем входе человек настроит второй фактор заново',
      'historyДействие записывается в журнал',
    ]);
    await d.getByRole('button', { name: 'Сбросить' }).click();
    await expect(toastText(page)).toHaveText('Готово · запись добавлена в журнал');
    await expect(c.getByRole('button', { name: 'Сбросить второй фактор' })).toHaveCount(0);
    await expect(c.locator('dl')).toContainText('Не настроен');
  });

  test('выбор в адресе: ?org= и ?account= открывают организацию и карточку', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'accounts');
    const anna = await platformUser(page, 'Анна Морозова');
    const root = await openPlatform(app, page, 'accounts', { query: `?account=${anna.id}` });
    await expect(
      card(page).getByRole('heading', { level: 2, name: 'Анна Морозова' }),
    ).toBeVisible();
    await expect(accountRow(root, 'Анна Морозова')).toHaveAttribute('aria-pressed', 'true');
  });

  test('ошибка загрузки каталога: alert и «Повторить» (no-reference)', async ({ app, page }) => {
    await openPlatform(app, page, 'accounts');
    // Число «Все аккаунты» слева читает ту же операцию: сценарий постоянный, снимается перед «Повторить».
    await devScenario(page, { scenario: 'listPlatformUsers=rate_limited' });
    await page.reload();
    // Возврат 1 (флак): после reload оболочка под нагрузкой грузится дольше 5 с ожидания по умолчанию.
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const alert = section(page, 'h-acc').getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить аккаунты: Слишком много запросов', {
      timeout: 15_000,
    });
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(accountRows(section(page, 'h-acc')).first()).toBeVisible();
  });

  // Возврат 1 (ревью, major): обязательные пункты verification-protocol §1.3 — загрузка, нет права, офлайн,
  // Escape с возвратом фокуса, тексты 409 из allowlist.
  test('загрузка: скелетон «Загрузка» до ответа listPlatformUsers (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'accounts');
    await devScenario(page, { scenario: 'listPlatformUsers=delay=2500' });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const root = section(page, 'h-acc');
    const status = root.getByRole('status', { name: 'Загрузка' });
    await expect(status).toBeVisible();
    await expect(root).not.toContainText('Загружаем рабочее пространство');
    await expect(accountRows(root).first()).toBeVisible({ timeout: 15_000 });
    await expect(status).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('нет права (403): каталог и операторы — текст раздела вместо списка (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'accounts');
    await devScenario(page, {
      scenario: 'listPlatformUsers=forbidden_action,listPlatformOperators=forbidden_action',
    });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const root = section(page, 'h-acc');
    await expect(
      root.getByText(
        'Нет права на каталог аккаунтов: раздел доступен всем ролям операторов платформы.',
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(root.getByRole('button', { name: 'Повторить' })).toHaveCount(0);
    await expect(accountRows(root)).toHaveCount(0);
    await realm(root, 'Ортус · Платформа').click();
    await expect(
      root.getByText(
        'Нет права на список операторов: раздел доступен всем ролям операторов платформы.',
      ),
    ).toBeVisible();
    await expect(root.locator('.ox-op-row')).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('нет связи при чтении: alert «Нет связи с сервером…» и «Повторить» (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'accounts');
    await devScenario(page, { scenario: 'listPlatformUsers=offline' });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const alert = section(page, 'h-acc').getByRole('alert');
    await expect(alert).toContainText(
      'Не удалось загрузить аккаунты: Нет связи с сервером. Проверьте подключение.',
      { timeout: 15_000 },
    );
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(accountRows(section(page, 'h-acc')).first()).toBeVisible();
  });

  test('нет связи при команде: блокировка — тост warn, диалог открыт, статус не меняется', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await accountRow(root, 'Анна Морозова').click();
    const c = card(page);
    await c.getByLabel('Причина блокировки').fill('Подозрительные входы');
    await c.getByRole('button', { name: 'Заблокировать вход' }).click();
    const d = confirmDialog(page, 'Заблокировать вход a.morozova@alta.example?');
    await devScenario(page, { scenario: 'lockPlatformUser=offline', once: true });
    await d.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(toastText(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(d).toBeVisible();
    await expect(d.getByRole('button', { name: 'Заблокировать' })).toBeEnabled();
    await expect(c.locator('.ox-chip-label').first()).toHaveText('Активен');
  });

  test('нет связи при команде: смена роли оператора — тост warn, роль прежняя', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts', { query: '?org=platform' });
    const role = operatorRow(root, 'Алёна Гусева').getByLabel('Роль: Алёна Гусева');
    const before = await role.inputValue();
    await devScenario(page, { scenario: 'updatePlatformOperator=offline', once: true });
    await role.selectOption('admin');
    await expect(toastText(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(role).toHaveValue(before);
    await expect(root.locator('.ox-pf-role').nth(1)).toContainText('Администратор0');
  });

  test('Escape закрывает диалог, фокус возвращается на кнопку (карточка и операторы)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await accountRow(root, 'Дарья Зимина').click();
    const reset = card(page).getByRole('button', { name: 'Сбросить второй фактор' });
    await reset.click();
    await expect(confirmDialog(page, 'Сбросить второй фактор?')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(reset).toBeFocused();
    expect(await reset.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');
    await realm(root, 'Ортус · Платформа').click();
    const off = operatorRow(root, 'Михаил Сорокин').getByRole('button', { name: 'Отключить' });
    await off.click();
    await expect(confirmDialog(page, 'Отключить оператора?')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(off).toBeFocused();
  });

  test('повторная блокировка (409): тост «Вход уже заблокирован», диалог открыт', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await accountRow(root, 'Анна Морозова').click();
    const c = card(page);
    await c.getByLabel('Причина блокировки').fill('Подозрительные входы');
    await c.getByRole('button', { name: 'Заблокировать вход' }).click();
    const d = confirmDialog(page, 'Заблокировать вход a.morozova@alta.example?');
    await devScenario(page, { scenario: 'lockPlatformUser=invalid_transition', once: true });
    await d.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(page.locator('.ox-toast[role="alert"]')).toHaveText(/Вход уже заблокирован/);
    await expect(d).toBeVisible();
  });

  test('сброс отсутствующего второго фактора (409): тост «Второй фактор не настроен»', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    await accountRow(root, 'Дарья Зимина').click();
    await card(page).getByRole('button', { name: 'Сбросить второй фактор' }).click();
    const d = confirmDialog(page, 'Сбросить второй фактор?');
    await devScenario(page, { scenario: 'resetPlatformUserMfa=invalid_transition', once: true });
    await d.getByRole('button', { name: 'Сбросить' }).click();
    await expect(page.locator('.ox-toast[role="alert"]')).toHaveText(/Второй фактор не настроен/);
    await expect(d).toBeVisible();
  });

  test('390: три блока в столбец, без горизонтальной прокрутки, цели ≥ 44 px', async ({
    app,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const root = await openPlatform(app, page, 'accounts');
    expect(await noHorizontalScroll(page)).toBe(true);
    const nav = await orgsNav(root).boundingBox();
    const list = await accountRows(root).first().boundingBox();
    const aside = await card(page).boundingBox();
    expect(nav && list && aside && nav.y < list.y && list.y < aside.y, 'столбец').toBe(true);
    expect(
      await hitHeight(filters(root).getByRole('button', { name: 'Все · 58' })),
    ).toBeGreaterThanOrEqual(44);
  });

  test('клавиатура: Tab по фильтрам, Enter выбирает фильтр', async ({ app, page }) => {
    const root = await openPlatform(app, page, 'accounts');
    await filters(root).getByRole('button', { name: 'Все · 58' }).focus();
    await page.keyboard.press('Tab');
    const multi = filters(root).getByRole('button', { name: 'В нескольких организациях · 2' });
    await expect(multi).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(multi).toHaveAttribute('aria-pressed', 'true');
    await expect(accountRows(root)).toHaveCount(2);
  });

  test('axe: каталог и «Ортус · Платформа» без нарушений serious/critical', async ({
    app,
    page,
    axe,
  }) => {
    const root = await openPlatform(app, page, 'accounts');
    let r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await realm(root, 'Ортус · Платформа').click();
    await expect(root.locator('.ox-op-row')).toHaveCount(6);
    r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });
});

test.describe('platform-users — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('оператор стенда: каталог аккаунтов, карточка и операторы платформы', async ({
    app,
    page,
  }) => {
    // W4.60 (backend шага 4.6: listPlatformUsers c фильтрами, getPlatformUser, операторы) не в main.
    const root = await openPlatform(app, page, 'accounts');
    await expect(accountRows(root).first()).toBeVisible();
  });
});
