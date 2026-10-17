// W1.23 · Визуальная сверка `company-roles` со снимком design-stage-1 (verification-protocol.md §3, PD-22: 0,01).
// Шапка и меню — маска (ключ `shell`). Список ролей, редактор и «Итоговые права роли» закрыты заливкой на обеих
// целях: в эталоне 23 роли с ролями модулей этапов 4–7 (Q-W0.02-2), 14 модулей редактора с «Документами» и
// «Обращениями» (этапы 4, 7), блок «Касса · остаток и лимиты» (этап 5), права — ключи прототипа (rolePermKeys), а
// не канонические ключи api/permissions.yaml. Содержимое вкладки сверяют подписи (company-roles.labels) и e2e.
// Состояния редактора с совпадающими данными (системная роль, новая пустая роль, раскрытый «Календарь») сверяются
// по элементам без заливки (возврат 16.10 №2).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { CHROME, coverFrom, implUsers, referenceUsers, refBlock } from './people.compare.ts';
import { compareShots } from './shell.compare.ts';

test.describe('company-roles — визуальная сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');

  test('«Роли»: заголовок и вкладки в допуске 0,01', async ({ app, page, reference }, testInfo) => {
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await referenceUsers(ref.page, 'Роли');
    await implUsers(app, page, 'tab=roles');
    await coverFrom(ref.page, refBlock(ref.page, 3));
    await coverFrom(page, page.locator('.ox-roles'));
    const tab = (p: typeof page) => p.getByRole('tab', { name: /^Роли/ });
    const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
    const r = await compareShots(
      { target: impl, mask: [...CHROME.map((s) => page.locator(s)), tab(page)] },
      { target: ref, mask: [...CHROME.map((s) => ref.page.locator(s)), tab(ref.page)] },
      `company-roles-${testInfo.project.name}`,
      testInfo,
    );
    console.log(`visual company-roles ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });

  // Возврат 16.10 №2: состояния RoleEditor, где данные эталона и API совпадают, — по элементам, без заливки.
  // Ширина 1440 (как у проверяющего): на 390 и 768 раскладка эталона переносит строки иначе по данным ролей.
  const wideOnly = (w: number | undefined) => (w ?? 0) < 1024;
  const shot = (p: Page, root: Locator) => ({ kind: 'app' as const, page: p, root, url: p.url() });
  const editorCard = (p: Page) => p.getByLabel('Название роли').locator('xpath=ancestor::div[1]');
  const summary = (p: Page) => p.locator('aside').filter({ hasText: 'Итоговые права роли' });
  const moduleRow = (p: Page, name: string) =>
    p
      .getByRole('switch', { name: `Доступ роли к модулю ${name}` })
      .locator('xpath=ancestor::div[2]');

  const same = async (
    label: string,
    actual: Locator,
    expected: Locator,
    testInfo: Parameters<Parameters<typeof test>[2]>[1],
  ) => {
    const r = await compareShots(
      { target: shot(actual.page(), actual) },
      { target: shot(expected.page(), expected) },
      `company-roles-${label}-${testInfo.project.name}`,
      testInfo,
    );
    console.log(`visual company-roles ${label} ${testInfo.project.name}: ${r.diffPixels} px`);
    expect(r.pass, `${label}: ${r.diffPixels} px, ${r.ratio}`).toBe(true);
  };

  test('системная роль: редактор и «Итоговые права роли»', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    test.skip(wideOnly(page.viewportSize()?.width), 'сверка состояния — на 1440');
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await referenceUsers(ref.page, 'Роли');
    await implUsers(app, page, 'tab=roles');
    for (const p of [ref.page, page]) {
      await p.getByRole('button', { name: /^Владелец бизнеса/ }).click();
      await expect(p.getByLabel('Название роли')).toHaveValue('Владелец бизнеса');
    }
    await same('system-editor', page.locator('.ox-role-card'), editorCard(ref.page), testInfo);
    await same('system-summary', summary(page), summary(ref.page), testInfo);
  });

  test('новая пустая роль: «Итоговые права роли»', async ({ app, page, reference }, testInfo) => {
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await referenceUsers(ref.page, 'Роли');
    await implUsers(app, page, 'tab=roles');
    for (const p of [ref.page, page]) {
      await p.getByRole('button', { name: 'Создать роль' }).click();
      const dlg = p.getByRole('dialog', { name: 'Создать роль' });
      await dlg.getByLabel(/^Название/).fill('Диспетчер');
      await dlg.getByRole('button', { name: 'Создать и настроить' }).click();
      await expect(dlg).toBeHidden();
      await expect(p.getByLabel('Название роли')).toHaveValue('Диспетчер');
    }
    await same('empty-summary', summary(page), summary(ref.page), testInfo);
  });

  test('раскрытый модуль «Календарь»: уровни действий', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    test.skip(wideOnly(page.viewportSize()?.width), 'сверка состояния — на 1440');
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await referenceUsers(ref.page, 'Роли');
    await implUsers(app, page, 'tab=roles');
    for (const p of [ref.page, page]) {
      await p.getByRole('button', { name: 'Показать действия: Календарь' }).click();
    }
    // Данные уровней расходятся (ключи прототипа против api/permissions.yaml, Q-W1.23-3): выдаём все уровни
    // «Календаря» в реализации, как у «Менеджера логистики» эталона («3 из 3 действий»), и сверяем вид строки.
    const row = moduleRow(page, 'Календарь');
    for (const box of await row.getByRole('checkbox').all()) {
      if (!(await box.isChecked())) await box.check();
    }
    await expect(row).toContainText('3 из 3 действий');
    for (const p of [ref.page, page]) {
      await p.mouse.move(0, 0);
      await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }
    await same(
      'calendar-row',
      moduleRow(page, 'Календарь'),
      moduleRow(ref.page, 'Календарь'),
      testInfo,
    );
  });
});
