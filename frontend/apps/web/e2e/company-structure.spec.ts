// W1.54 · e2e страницы `company-structure` «Структура» (S1-08, no-reference B-6: design-requests.md
// «company-structure · перенос»). Пиксельной и структурной сверки нет (allowlist/company-structure.md), e2e и
// проходка — да. Обязательные пункты verification-protocol §1.3: меню и URL, состояния, клавиатура, axe, 390.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  assign,
  expectStatus,
  listMembers,
  listUnits,
  type Member,
  revoke,
  roleId,
  runLabel,
} from './_stand/stand.ts';
import {
  addUnit,
  startMove,
  structureDialog,
  tree,
  unitItem,
  unitRow,
} from './company-structure.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const READ_ONLY =
  'Организация в режиме чтения: новые операции недоступны. Чтение и выгрузка доступны.';
const REVISION_MISMATCH = 'Данные изменились. Обновите и повторите правку.';
const INVALID_TRANSITION = 'Статус уже изменился. Обновите данные и повторите.';
const BOTTOM_NAV = { name: 'Навигация', exact: true } as const;
const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;

/** Пункт меню по подписи: на телефоне — через «Ещё» → «Все разделы», иначе — рейл. */
async function fromMenu(page: Page, label: string): Promise<void> {
  if (phone(page)) {
    await page.getByRole('navigation', BOTTOM_NAV).getByRole('button', { name: 'Ещё' }).click();
    await page
      .getByRole('dialog', { name: 'Все разделы' })
      .getByRole('button', { name: label })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: label })
      .click();
  }
}

/** «Сергей Ильин» получает роль «Менеджер логистики» на узел `unitId` (назначение с поддеревом). */
async function grantIlyin(page: Page, tenant: string, unitId: string) {
  const people = (await listMembers(page, tenant)).body as { items: Member[] };
  const ilyin = people.items.find((m) => m.displayName === 'Сергей Ильин');
  if (!ilyin) throw new Error('нет «Сергей Ильин» в сиде');
  const role = await roleId(page, tenant, 'Менеджер логистики');
  return assign(page, tenant, { memberId: ilyin.id, roleId: role, unitId });
}

/**
 * Котова (`manager`): «Читатель структуры» (org_units.read) на всю организацию и «Руководитель «Москвы»»
 * (org_units.manage, members.read) на «Москву» с поддеревом; Котельникова — «Менеджер логистики» на «Юг Транс»
 * (вне members.read Котовой). Как conformance stage1b `branchManager`. Сессия — владельца.
 */
async function branchManager(page: Page, tenant: string): Promise<void> {
  const people = (await listMembers(page, tenant)).body as { items: Member[] };
  const member = (name: string): Member => {
    const m = people.items.find((x) => x.displayName === name);
    if (!m) throw new Error(`нет «${name}» в сиде`);
    return m;
  };
  const units = await listUnits(page, tenant);
  const unit = (name: string): string => {
    const u = units.find((x) => x.name === name);
    if (!u) throw new Error(`нет «${name}» в сиде`);
    return u.id;
  };
  const role = async (name: string, permissions: string[]): Promise<string> => {
    const r = await call(page, 'POST', `/api/v1/tenants/${tenant}/roles`, {
      body: { name, permissions },
    });
    return (expectStatus(r, 201, `createRole ${name}`).body as { id: string }).id;
  };
  const kotova = member('Марина Котова');
  const reader = await role('Читатель структуры', ['org_units.read']);
  const head = await role('Руководитель «Москвы»', ['org_units.manage', 'members.read']);
  const all = await call(page, 'POST', `/api/v1/tenants/${tenant}/assignments`, {
    body: {
      principalType: 'member',
      principalId: kotova.id,
      roleId: reader,
      scope: { kind: 'tenant', resourceIds: [], includeDescendants: true },
    },
  });
  expectStatus(all, 201, 'createAssignment tenant');
  await assign(page, tenant, { memberId: kotova.id, roleId: head, unitId: unit('Москва') });
  await assign(page, tenant, {
    memberId: member('Вера Котельникова').id,
    roleId: await roleId(page, tenant, 'Менеджер логистики'),
    unitId: unit('Юг Транс'),
  });
}

test.describe('company-structure — «Структура» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');

  test('меню «Компания» → «Структура» и прямой URL: крошка и заголовок', async ({ app, page }) => {
    await openPage(app, page, 'home');
    await fromMenu(page, 'Структура');
    await expect(page).toHaveURL(/\/structure$/);
    await expect(h1(page, 'Структура')).toBeVisible();
    await expect(page.getByText('Альта Групп / Компания')).toBeVisible();
    await page.reload();
    await expect(h1(page, 'Структура')).toBeVisible();
    await expect(tree(page)).toBeVisible();
  });

  test('дерево сида: три региона, фирмы под регионами, подписи вида', async ({ app, page }) => {
    await openPage(app, page, 'structure');
    await expect(tree(page).locator(':scope > li > .ox-str-row .ox-str-name')).toHaveText([
      'Москва',
      'Самара',
      'Санкт-Петербург',
    ]);
    await expect(unitRow(page, 'Москва')).toContainText('Регион');
    await expect(unitRow(page, 'Север Логистик')).toContainText('Фирма');
    await expect(unitItem(page, 'Москва').locator('.ox-str-children .ox-str-name')).toHaveText([
      'Восток Карго',
      'Север Логистик',
      'Центр Экспресс',
      'Юг Транс',
    ]);
  });

  test('владелец создаёт регион, фирму и подразделение', async ({ app, page }) => {
    const id = await openPage(app, page, 'structure');
    await addUnit(page, { name: 'Казань' });
    await addUnit(page, { parent: 'Казань', name: 'Кама Логистик' });
    await addUnit(page, { parent: 'Кама Логистик', name: 'Склад Кама' });
    await expect(unitRow(page, 'Казань')).toContainText('Регион');
    await expect(unitRow(page, 'Кама Логистик')).toContainText('Фирма');
    await expect(unitRow(page, 'Склад Кама')).toContainText('Подразделение');
    await expect(unitItem(page, 'Казань')).toContainText('Склад Кама');
    const units = await listUnits(page, id);
    const kazan = units.find((u) => u.name === 'Казань');
    const firm = units.find((u) => u.name === 'Кама Логистик');
    expect(kazan?.parentId).toBeNull();
    expect(firm?.parentId).toBe(kazan?.id);
    expect(units.find((u) => u.name === 'Склад Кама')?.parentId).toBe(firm?.id);
  });

  test('422: занятое название — текст под полем, диалог открыт', async ({ app, page }) => {
    await openPage(app, page, 'structure');
    await page.getByRole('button', { name: 'Добавить регион' }).click();
    const dlg = structureDialog(page, 'Новое подразделение');
    await dlg.getByLabel('Название').fill('Москва');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dlg).toContainText('Такое название уже есть');
    await expect(dlg.getByLabel('Название')).toHaveAttribute('aria-invalid', 'true');
    await expect(dlg.getByLabel('Название')).toBeFocused();
    await expect(toast(page)).toHaveCount(0);
  });

  test('переименование: If-Match свежего GET, тост, новое название в дереве', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'structure');
    const patched = page.waitForRequest(
      (r) => r.method() === 'PATCH' && /\/org-units\/[0-9a-f-]+$/.test(r.url()),
    );
    await unitRow(page, 'Юг Транс')
      .getByRole('button', { name: 'Переименовать «Юг Транс»' })
      .click();
    const dlg = structureDialog(page, 'Переименовать «Юг Транс»');
    await expect(dlg.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await dlg.getByLabel('Название').fill('Юг Транс Плюс');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Переименовано: «Юг Транс Плюс»');
    const req = await patched;
    expect(req.headers()['if-match']).toBeTruthy();
    expect(req.headers()['idempotency-key']).toBeTruthy();
    await expect(unitRow(page, 'Юг Транс Плюс')).toBeVisible();
  });

  test('412 при переименовании: тост словаря, диалог открыт, дерево перечитано', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'structure');
    await unitRow(page, 'Юг Транс')
      .getByRole('button', { name: 'Переименовать «Юг Транс»' })
      .click();
    const dlg = structureDialog(page, 'Переименовать «Юг Транс»');
    await dlg.getByLabel('Название').fill('Юг');
    await devScenario(page, { scenario: 'updateOrgUnit=revision_mismatch', once: true });
    const reread = page.waitForRequest(
      (r) => r.method() === 'GET' && /\/org-units\?/.test(r.url()),
    );
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText(REVISION_MISMATCH);
    await reread;
    await expect(dlg).toBeVisible();
    await expect(unitRow(page, 'Юг Транс')).toBeVisible();
  });

  test('409 при переносе: тост словаря, диалог открыт', async ({ app, page }) => {
    await openPage(app, page, 'structure');
    const dlg = await startMove(page, 'Юг Транс', 'Самара');
    const submit = dlg.getByRole('button', { name: 'Перенести', exact: true });
    await expect(submit).toBeEnabled();
    await devScenario(page, { scenario: 'updateOrgUnit=invalid_transition', once: true });
    await submit.click();
    await expect(toast(page)).toHaveText(INVALID_TRANSITION);
    await expect(dlg).toBeVisible();
  });

  test('перенос: предпросмотр влияния — кто получит доступ, затем «Перенести»', async ({
    app,
    page,
  }) => {
    const id = await openPage(app, page, 'structure');
    const samara = (await listUnits(page, id)).find((u) => u.name === 'Самара');
    if (!samara) throw new Error('нет «Самара»');
    await grantIlyin(page, id, samara.id);
    await page.reload();
    await expect(tree(page)).toBeVisible();
    const dlg = await startMove(page, 'Юг Транс', 'Самара');
    const impact = dlg.getByRole('region', { name: 'Влияние на доступ' });
    await expect(impact).toContainText('Получат доступ');
    await expect(impact).toContainText('Сергей Ильин · Менеджер логистики');
    await expect(impact).toContainText('Вложенных подразделений: 0');
    await dlg.getByRole('button', { name: 'Перенести', exact: true }).click();
    await expect(toast(page)).toHaveText('Перенесено: «Юг Транс»');
    await expect(unitItem(page, 'Самара')).toContainText('Юг Транс');
    await expect(unitItem(page, 'Москва')).not.toContainText('Юг Транс');
  });

  test('перенос без влияния: «Доступ ни у кого не изменится.»', async ({ app, page }) => {
    await openPage(app, page, 'structure');
    const dlg = await startMove(page, 'Восток Карго', 'Санкт-Петербург');
    const submit = dlg.getByRole('button', { name: 'Перенести', exact: true });
    await expect(dlg.getByRole('region', { name: 'Влияние на доступ' })).toContainText(
      'Доступ ни у кого не изменится.',
    );
    await expect(submit).toBeEnabled();
    await dlg.getByRole('button', { name: 'Отмена' }).click();
    await expect(dlg).toBeHidden();
  });

  // Возврат 1 доделки №2 (minor): право org_units.manage только на «Москву» — без команд верхнего уровня (сервер
  // требует право на всю организацию: на стенде было бы 403); перенос внутри «Москвы» со скрытыми затронутыми.
  test('право на «Москву»: без «Добавить регион» и «Перенести «Москва»»; скрытые — «Ещё 1 …»', async ({
    app,
    page,
  }) => {
    const id = await openPage(app, page, 'structure');
    await branchManager(page, id);
    await app(`/t/${id}/structure`, { persona: 'manager' });
    await expect(tree(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить регион' })).toHaveCount(0);
    const msk = unitRow(page, 'Москва');
    await expect(msk.getByRole('button', { name: 'Переименовать «Москва»' })).toBeVisible();
    await expect(msk.getByRole('button', { name: 'Перенести «Москва»' })).toHaveCount(0);
    await expect(unitRow(page, 'Самара').getByRole('button')).toHaveCount(0);
    const dlg = await startMove(page, 'Север Логистик', 'Москва / Юг Транс');
    const options = await dlg.getByLabel('Куда перенести').locator('option').allTextContents();
    expect(options.slice(1).filter((o) => !o.startsWith('Москва / '))).toEqual([]);
    const impact = dlg.getByRole('region', { name: 'Влияние на доступ' });
    await expect(impact).toContainText('Ещё 1 — вне вашей области просмотра');
    await expect(impact).not.toContainText('Вера Котельникова');
    await expect(impact).not.toContainText('Доступ ни у кого не изменится.');
  });

  test('цели переноса: без самого узла, его потомков и текущего родителя', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'structure');
    await unitRow(page, 'Север Логистик')
      .getByRole('button', { name: 'Перенести «Север Логистик»' })
      .click();
    const dlg = structureDialog(page, 'Перенести «Север Логистик»');
    const options = await dlg.getByLabel('Куда перенести').locator('option').allTextContents();
    expect(options[0]).toBe('Выберите, куда перенести');
    expect(options).toContain('Москва / Юг Транс');
    expect(options).toContain('Самара');
    expect(options).not.toContain('Москва');
    expect(options).not.toContain('Москва / Север Логистик');
    await expect(dlg.getByRole('button', { name: 'Перенести', exact: true })).toBeDisabled();
  });

  test('загрузка: скелетон «Загрузка», затем дерево', async ({ app, page }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'listOrgUnits=delay=1500' });
    await page.goto(page.url().replace(/\/home$/, '/structure'));
    await expect(page.locator('#ox-main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(tree(page)).toBeVisible();
  });

  test('ошибка listOrgUnits: alert по коду и «Повторить»', async ({ app, page }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'listOrgUnits=rate_limited' });
    await page.goto(page.url().replace(/\/home$/, '/structure'));
    await expect(h1(page, 'Структура')).toBeVisible();
    await expect(page.locator('.ox-str').getByRole('alert')).toContainText(
      'Не удалось загрузить структуру: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.locator('.ox-str').getByRole('button', { name: 'Повторить' }).click();
    await expect(tree(page)).toBeVisible();
  });

  test('пусто: «Структура пока пуста» и «Добавить регион»', async ({ app, page }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'listOrgUnits=empty' });
    await page.goto(page.url().replace(/\/home$/, '/structure'));
    await expect(page.getByText('Структура пока пуста')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить регион' })).toHaveCount(2);
  });

  test('нет связи при создании: тост, диалог открыт, повтор проходит один раз', async ({
    app,
    page,
  }) => {
    const id = await openPage(app, page, 'structure');
    await page.getByRole('button', { name: 'Добавить регион' }).click();
    const dlg = structureDialog(page, 'Новое подразделение');
    await dlg.getByLabel('Название').fill('Казань');
    await devScenario(page, { scenario: 'createOrgUnit=offline', once: true });
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(toast(page)).toHaveText('Добавлено: «Казань»');
    expect((await listUnits(page, id)).filter((u) => u.name === 'Казань')).toHaveLength(1);
  });

  test('организация только для чтения: текст словаря, команды недоступны', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'structure', { preset: 'trial-ended' });
    await expect(page.locator('.ox-str').getByText(READ_ONLY)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить регион' })).toBeDisabled();
    await expect(
      unitRow(page, 'Москва').getByRole('button', { name: 'Перенести «Москва»' }),
    ).toBeDisabled();
  });

  // Возврат 1 доделки №2 (major): в режиме чтения все команды недоступны — в длинной прокручиваемой #ox-main не
  // оставалось ни одного элемента в порядке Tab (axe scrollable-region-focusable). Дерево — цель фокуса.
  test('только чтение: axe без serious/critical, дерево доступно с клавиатуры', async ({
    app,
    page,
    axe,
  }) => {
    await openPage(app, page, 'structure', { preset: 'trial-ended' });
    await expect(tree(page)).toBeVisible();
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    await tree(page).focus();
    await expect(tree(page)).toBeFocused();
    expect(
      await page.evaluate(() =>
        document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : 'none',
      ),
    ).not.toBe('none');
  });

  test('сотрудник без org_units.read: гейт «Нет доступа к разделу «Структура»»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'structure', { persona: 'manager' });
    await expect(page.locator('.ox-gate')).toContainText('Нет права');
    await expect(h1(page, 'Нет доступа к разделу «Структура»')).toBeVisible();
    await expect(tree(page)).toHaveCount(0);
  });

  test('клавиатура: Tab до «Добавить регион», Enter открывает диалог, Escape закрывает', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'structure');
    await expect(tree(page)).toBeVisible();
    const add = page.getByRole('button', { name: 'Добавить регион' });
    await add.focus();
    await page.keyboard.press('Tab');
    await expect(
      unitRow(page, 'Москва').getByRole('button', { name: 'Добавить в «Москва»' }),
    ).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(add).toBeFocused();
    expect(
      await page.evaluate(() =>
        document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : 'none',
      ),
    ).not.toBe('none');
    await page.keyboard.press('Enter');
    const dlg = structureDialog(page, 'Новое подразделение');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel('Название')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(add).toBeFocused();
  });

  test('390: нижняя навигация, цели не меньше 44 px, без горизонтальной прокрутки', async ({
    app,
    page,
  }) => {
    test.skip(!phone(page), 'только телефон');
    await openPage(app, page, 'structure');
    await expect(page.getByRole('navigation', BOTTOM_NAV)).toBeVisible();
    await expect(tree(page)).toBeVisible();
    const row = unitRow(page, 'Север Логистик');
    for (const name of [
      'Добавить в «Север Логистик»',
      'Переименовать «Север Логистик»',
      'Перенести «Север Логистик»',
    ]) {
      expect(await hitHeight(row.getByRole('button', { name }))).toBeGreaterThanOrEqual(44);
    }
    expect(
      await hitHeight(page.getByRole('button', { name: 'Добавить регион' })),
    ).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
    await startMove(page, 'Север Логистик', 'Самара');
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  // Возврат 1 доделки №2 (minor): на 390 у вложенных узлов с длинным названием («Восток Карго», «Север Логистик»,
  // «Центр Экспресс») команды уходили второй строкой, у коротких — нет; ритм дерева рваный.
  test('390: команды узла на одной строке с названием у всех узлов', async ({ app, page }) => {
    test.skip(!phone(page), 'только телефон');
    await openPage(app, page, 'structure');
    await expect(tree(page)).toBeVisible();
    const rows = await tree(page)
      .locator('.ox-str-row')
      .evaluateAll((els) =>
        els
          .map((el) => {
            const label = el.querySelector('.ox-str-label')?.getBoundingClientRect();
            const actions = el.querySelector('.ox-str-actions')?.getBoundingClientRect();
            const name = el.querySelector('.ox-str-name')?.textContent ?? '';
            if (!label || !actions) return null;
            const beside = actions.top < label.bottom && actions.bottom > label.top;
            return { name, beside };
          })
          .filter((x) => x !== null),
      );
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.filter((r) => !r.beside).map((r) => r.name)).toEqual([]);
  });

  test('axe: нет serious/critical на странице и в диалоге переноса', async ({ app, page, axe }) => {
    await openPage(app, page, 'structure');
    await expect(tree(page)).toBeVisible();
    const serious = async () =>
      (await axe(page)).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(await serious()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    const dlg = await startMove(page, 'Юг Транс', 'Самара');
    await expect(dlg.getByRole('region', { name: 'Влияние на доступ' })).toContainText(
      'Сотрудников в переносимой части',
    );
    expect(await serious()).toEqual([]);
  });
});

test.describe('company-structure — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: регион, фирма и подразделение; перенос показывает влияние', async ({
    app,
    page,
    undo,
  }, testInfo) => {
    test.slow();
    const tag = runLabel(testInfo.project.name);
    const names = {
      region: `Регион ${tag}`,
      other: `Регион-2 ${tag}`,
      firm: `Фирма ${tag}`,
      branch: `Склад ${tag}`,
    };
    const id = await openPage(app, page, 'structure');
    await expect(tree(page)).toBeVisible({ timeout: 30_000 });
    await addUnit(page, { name: names.region });
    await addUnit(page, { parent: names.region, name: names.firm });
    await addUnit(page, { parent: names.firm, name: names.branch });
    await addUnit(page, { name: names.other });
    const units = await listUnits(page, id);
    const region = units.find((u) => u.name === names.region);
    const firm = units.find((u) => u.name === names.firm);
    const other = units.find((u) => u.name === names.other);
    expect(region?.parentId).toBeNull();
    expect(firm?.parentId).toBe(region?.id);
    expect(units.find((u) => u.name === names.branch)?.parentId).toBe(firm?.id);
    if (!other || !firm) throw new Error('узлы не созданы');

    // Влияние: у Ильина роль на второй регион с поддеревом — перенос фирмы туда даёт ему к ней доступ.
    const grant = await grantIlyin(page, id, other.id);
    undo('снять роль Ильина', () => revoke(page, id, grant.id));
    const dlg = await startMove(page, names.firm, names.other);
    const impact = dlg.getByRole('region', { name: 'Влияние на доступ' });
    await expect(impact).toContainText('Вложенных подразделений: 1');
    await expect(impact).toContainText('Получат доступ');
    await expect(impact).toContainText('Сергей Ильин · Менеджер логистики');
    await dlg.getByRole('button', { name: 'Перенести', exact: true }).click();
    await expect(toast(page)).toHaveText(`Перенесено: «${names.firm}»`);
    await expect(unitItem(page, names.other)).toContainText(names.branch);
    expect((await listUnits(page, id)).find((u) => u.name === names.firm)?.parentId).toBe(other.id);
  });
});
