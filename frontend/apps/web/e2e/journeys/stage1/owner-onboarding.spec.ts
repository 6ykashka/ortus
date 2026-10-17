// W1.30 · Выход этапа 1 (план v2 §4): «Владелец пилота на стенде сам настраивает структуру и роли и приглашает
// сотрудников». Бриф docs/plan/v2/ws/W1.30.md §1 п. 1; критика critique/stage-1.md §4 п. 3.
// Владелец «Альты» — dev-вход `owner`; сотрудник — новый человек (newcomer, W1.50), письмо — Mailpit слота (W1.51);
// отзыв роли ≤ 5 с — канал реального времени (W1.07, W1.42, клиент W1.49) у логиста Марины Котовой (`manager`).
// Сид стенда общий для трёх проектов прогона: всё, что строка меняет, возвращает фикстура `undo` (бриф §10 п. 2).
import { newcomer } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import {
  changeSubscription,
  createUnit,
  expectStatus,
  listMembers,
  listUnits,
  type Member,
  memberByEmail,
  revoke,
  runLabel,
  suspendMember,
  withExtraSeats,
} from '../../_stand/stand.ts';
import { devLoginAs, invitationLink, mailpitToken } from '../../auth.helpers.ts';
import { dialog, openUsers, personRow, roleButton, tab, toast } from '../../people.helpers.ts';
import { platformTenantId } from '../../platform-orgs.helpers.ts';
import { ALTA, call, navTitles } from '../../shell.helpers.ts';

const TEMPLATE = 'Менеджер логистики';
/** Меню сотрудника с ролью из шаблона «Менеджер логистики»: рабочее место офиса по правам роли (W1.20, D-23). */
const MANAGER_MENU = [
  'Главная',
  'Рабочее место логиста',
  'Ресурсный пул',
  'Приёмка смен',
  'Чаты',
  'Задачи',
  'Обращения',
  'Формы и опросы',
  'Календарь',
  'База знаний',
  'Документы',
  'Данные',
  'Файлы',
];
/** Меню сотрудника без ролей: «Главная» и пункты модулей будущих этапов по рабочему месту. */
const NO_ROLE_MENU = ['Главная', 'Чаты', 'Задачи', 'Обращения', 'Документы', 'Файлы'];
/** Пункт, который даёт роль и убирает её отзыв. */
const ROLE_ITEM = 'Рабочее место логиста';

const mainNav = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Основная навигация' });
const header = (page: Page): Locator => page.getByRole('banner');

/** Пункты основной навигации (рейл; на телефоне и планшете — окно переводится в 1440 только для чтения меню). */
async function menuOf(page: Page): Promise<string[]> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(mainNav(page)).toBeVisible();
  return navTitles(mainNav(page));
}

test.describe('выход этапа 1 — владелец настраивает и приглашает @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец: структура, роль, приглашение → сотрудник принимает из письма и видит только своё', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.slow();
    const tag = runLabel(testInfo.project.name);
    const names = {
      region: `Регион ${tag}`,
      firm: `Фирма ${tag}`,
      branch: `Склад ${tag}`,
      role: `Логист ${tag}`,
      person: `Иван Новиков ${tag}`,
    };
    const email = `w130.${tag}@alta.example`;
    const mailpit = process.env.E2E_MAILPIT_URL ?? '';
    expect(mailpit, 'E2E_MAILPIT_URL — Mailpit стенда (e2e-stand, W1.51)').not.toBe('');

    // Место тарифа: в сиде «Альты» занято 9 из 10, а строка W1.23 «приглашение» занимает последнее в первом
    // проекте. Оператор на время строки выдаёт ручное право «места» (+1), уборка его снимает.
    const operator = await session();
    await operator.open('/platform/tenants', 'operator');
    const alta = await platformTenantId(operator.page, ALTA);
    const seats = await changeSubscription(
      operator.page,
      alta,
      (cur) => withExtraSeats(cur, 1),
      undo,
    );

    await test.step('структура: регион → фирма → подразделение (createOrgUnit; экрана «Структура» нет)', async () => {
      await app('/', { persona: 'owner' });
      await expect(page).toHaveURL(new RegExp(`/t/${alta}/home$`), { timeout: 15_000 });
      const region = await createUnit(page, alta, {
        parentId: null,
        name: names.region,
        kind: 'region',
      });
      const firm = await createUnit(page, alta, {
        parentId: region.id,
        name: names.firm,
        kind: 'company',
      });
      await createUnit(page, alta, { parentId: firm.id, name: names.branch, kind: 'branch' });
      const tree = await listUnits(page, alta);
      expect(tree.find((u) => u.name === names.firm)?.parentId).toBe(region.id);
      expect(tree.find((u) => u.name === names.branch)?.parentId).toBe(firm.id);
    });

    await test.step('роль: «Создать роль» из шаблона «Менеджер логистики»', async () => {
      await openUsers(app, page, { query: 'tab=roles' });
      await page.getByRole('button', { name: 'Создать роль' }).click();
      const dlg = dialog(page, 'Создать роль');
      await dlg.getByLabel('Название').fill(names.role);
      await dlg.getByRole('radio', { name: /Из шаблона/ }).check();
      await dlg.getByRole('combobox', { name: 'Из шаблона' }).selectOption({ label: TEMPLATE });
      await dlg.getByRole('button', { name: 'Создать и настроить' }).click();
      await expect(toast(page)).toHaveText('Роль создана');
      await expect(roleButton(page, names.role)).toHaveAttribute('aria-pressed', 'true');
    });

    await test.step('приглашение: «Пригласить участника» с этой ролью в области новой фирмы', async () => {
      await tab(page, 'Люди').click();
      await page.getByRole('button', { name: 'Пригласить' }).click();
      const dlg = dialog(page, 'Пригласить участника');
      await dlg.getByLabel('Имя и фамилия').fill(names.person);
      await dlg.getByLabel('Электронная почта').fill(email);
      await dlg.getByLabel('Роль').selectOption({ label: names.role });
      await dlg.getByLabel('Область').selectOption({ label: `${names.region} / ${names.firm}` });
      await dlg.getByRole('button', { name: 'Пригласить' }).click();
      await expect(toast(page)).toHaveText(`Приглашение отправлено: ${email}`);
      await expect(personRow(page, names.person)).toContainText('Приглашён');
    });
    // Уборка: приглашённый приостанавливается — место свободно до снятия ручного права.
    const release = undo('приостановить приглашённого', async () =>
      suspendMember(page, alta, await memberByEmail(page, alta, email)),
    );

    const worker = await session();
    await test.step('письмо в Mailpit → первый вход нового человека → «Принять приглашение»', async () => {
      const token = await mailpitToken(page, mailpit, email);
      await worker.page.goto('/auth/login');
      await devLoginAs(worker.page, { ...newcomer(email, names.person) });
      await worker.page.goto(invitationLink(token));
      await expect(worker.page.getByRole('heading', { level: 1 })).toHaveText(
        `Приглашение в «${ALTA}»`,
      );
      await expect(worker.page.getByRole('main')).toContainText(`Вы вошли как ${names.person}.`);
      await worker.page.getByRole('button', { name: 'Принять приглашение' }).click();
      await expect(header(worker.page)).toContainText(ALTA, { timeout: 15_000 });
      await expect(worker.page).toHaveURL(new RegExp(`/t/${alta}/`));
    });

    await test.step('сотрудник видит только своё: меню роли без «Компании», люди — только он сам', async () => {
      await expect.poll(() => menuOf(worker.page)).toEqual(MANAGER_MENU);
      const people = expectStatus(
        await listMembers(worker.page, alta),
        200,
        'listMembers сотрудника',
      );
      expect((people.body as { items: Member[] }).items.map((m) => m.email)).toEqual([email]);
      // Пункта «Пользователи и роли» в меню нет; по прямой ссылке страница открывается правами роли
      // (members.read, roles.read) и показывает только людей его области — его самого (вопрос в отчёте W1.30).
      await worker.page.goto(`/t/${alta}/users`);
      const list = worker.page.getByRole('list', { name: 'Участники' });
      await expect(list.getByRole('listitem')).toHaveCount(1, { timeout: 15_000 });
      await expect(list).toContainText(names.person);
      await expect(list).not.toContainText('Дарья Зимина');
    });

    await test.step('владелец видит сотрудника активным с ролью в области новой фирмы', async () => {
      await openUsers(app, page);
      await expect(personRow(page, names.person)).toContainText(
        `${names.role}· ${names.region} / ${names.firm}`,
      );
      await expect(personRow(page, names.person)).not.toContainText('Приглашён');
    });

    await release();
    await seats();
  });

  test('отзыв роли: пункт меню сотрудника исчезает ≤ 5 с без перезагрузки, запрос — 403 сразу', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.slow();
    const alta = await openUsers(app, page);
    const manager = await session();
    await manager.open('/', 'manager');
    await expect(header(manager.page)).toContainText(ALTA, { timeout: 15_000 });
    await expect.poll(() => menuOf(manager.page)).toEqual(NO_ROLE_MENU);
    // Метка окна: перезагрузка страницы её сотрёт.
    await manager.page.evaluate(() => {
      (window as unknown as { __w130?: number }).__w130 = 1;
    });

    // Владелец назначает роль в «Назначить роль» — у логиста меню роли появляется без перезагрузки.
    await personRow(page, 'Марина Котова').getByRole('button', { name: 'Назначить роль' }).click();
    const assignDlg = dialog(page, 'Назначить роль');
    await assignDlg.getByLabel('Роль').selectOption({ label: TEMPLATE });
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/tenants/${alta}/assignments`),
    );
    await assignDlg.getByRole('button', { name: 'Назначить' }).click();
    const grant = (await (await created).json()) as { id: string };
    undo('снять роль логиста', () => revoke(page, alta, grant.id));
    await expect(toast(page)).toHaveText(`Роль «${TEMPLATE}» назначена`);
    await expect
      .poll(() => navTitles(mainNav(manager.page)), { timeout: 5_000 })
      .toEqual(MANAGER_MENU);
    expect(
      (await call(manager.page, 'GET', `/api/v1/tenants/${alta}/members`)).status,
      'с ролью — чтение людей своей области',
    ).toBe(200);

    // Владелец снимает назначение: пункт исчезает ≤ 5 с (S1-15), запрос с отозванным правом — 403 сразу.
    const row = personRow(page, 'Марина Котова');
    await expect(row).toContainText(TEMPLATE);
    await row.getByRole('button', { name: 'Назначить роль' }).click();
    const revokeDlg = dialog(page, 'Назначить роль');
    const revoked = page.waitForResponse(
      (r) => r.request().method() === 'DELETE' && r.url().endsWith(`/assignments/${grant.id}`),
    );
    await revokeDlg
      .getByRole('listitem')
      .filter({ hasText: TEMPLATE })
      .getByRole('button', { name: 'Снять' })
      .click();
    expect((await revoked).status()).toBe(204);
    const revokedAt = Date.now();
    await expect(toast(page)).toHaveText('Назначение снято');
    expect((await call(manager.page, 'GET', `/api/v1/tenants/${alta}/members`)).status).toBe(403);
    await expect
      .poll(() => navTitles(mainNav(manager.page)), { timeout: 5_000, intervals: [100] })
      .not.toContain(ROLE_ITEM);
    const took = Date.now() - revokedAt;
    testInfo.annotations.push({ type: 'S1-15', description: `пункт меню исчез через ${took} мс` });
    expect(took).toBeLessThanOrEqual(5_000);
    expect(await navTitles(mainNav(manager.page))).toEqual(NO_ROLE_MENU);
    expect(
      await manager.page.evaluate(() => (window as unknown as { __w130?: number }).__w130),
      'страница логиста не перезагружалась',
    ).toBe(1);
  });
});
