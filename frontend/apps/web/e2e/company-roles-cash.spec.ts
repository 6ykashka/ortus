// W5.33 · e2e «Пользователи и роли»: блок «Касса · остаток и лимиты» в редакторе роли (Ортус CRM.dc.html :373–379,
// :3202–3205; 02-company §6.12) и область «Касса» в диалоге «Назначить роль» (:2213, :3984–4005): включение модуля
// «Касса» показывает блок, флажки — ключи cash.balance.read и cash.advance.self, «Сохранить роль», водитель,
// назначение роли на кассу, 390 и 1440. Суммы лимитов в роли контракта не хранятся (Q-W5.33-2).
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { hitHeight } from './modules.helpers.ts';
import {
  dialog,
  noHorizontalScroll,
  openUsers,
  personRow,
  roleButton,
  tab,
  toast,
} from './people.helpers.ts';

const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;
const cashSwitch = (page: Page) => page.getByRole('switch', { name: 'Доступ роли к модулю Касса' });
const block = (page: Page) => page.getByRole('group', { name: 'Касса · остаток и лимиты' });
const balance = (page: Page) => block(page).getByRole('checkbox', { name: /^Видеть остаток/ });
const self = (page: Page) => block(page).getByRole('checkbox', { name: /^Только свой подотчёт/ });

test.describe('company-roles — блок «Касса · остаток и лимиты» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.describe.configure({ timeout: 90_000 });

  test('блок появляется с модулем «Касса»: флажки, три лимита, подсказки', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await expect(block(page)).toHaveCount(0);
    await cashSwitch(page).click();
    await expect(block(page)).toBeVisible();
    await expect(
      block(page).getByText(
        'Действуют в области назначения: организация, регион, фирма или конкретная касса. Выше лимита операция уходит на согласование роли с действием «Проверять», свою заявку автор не согласует.',
      ),
    ).toBeVisible();
    await expect(balance(page)).not.toBeChecked();
    await expect(self(page)).not.toBeChecked();
    await expect(block(page).getByText('cash.balance.read')).toBeVisible();
    await expect(block(page).getByText('cash.advance.self')).toBeVisible();
    for (const label of [
      'Расход без согласования до, ₽',
      'Возврат без согласования до, ₽',
      'Выдача под отчёт до, ₽',
    ]) {
      const input = block(page).getByLabel(label);
      await expect(input).toHaveAttribute('placeholder', 'без лимита');
      await expect(input).toBeDisabled();
    }
    await expect(
      block(page).getByText('Пусто — без лимита, 0 — всегда с согласованием.'),
    ).toBeVisible();
  });

  test('«Видеть остаток…» → «Сохранить роль» → ключ в итоговых правах и после перезагрузки', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await cashSwitch(page).click();
    await balance(page).check();
    const aside = page.getByRole('complementary', { name: 'Итоговые права роли' });
    await expect(aside).toContainText('cash.balance.read');
    await expect(aside).not.toContainText('cash.advance.self');
    await expect(page.getByText('Есть несохранённые изменения')).toBeVisible();
    await page.getByRole('button', { name: 'Сохранить роль' }).click();
    await expect(toast(page)).toHaveText(/^Роль «.+» сохранена$/);
    await page.reload();
    await tab(page, 'Роли').waitFor();
    await expect(balance(page)).toBeChecked();
    await expect(aside).toContainText('cash.balance.read');
  });

  test('«Только свой подотчёт» скрывает поля лимитов', async ({ app, page }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await cashSwitch(page).click();
    await self(page).check();
    await expect(block(page).getByLabel('Расход без согласования до, ₽')).toHaveCount(0);
    await self(page).uncheck();
    await expect(block(page).getByLabel('Расход без согласования до, ₽')).toBeVisible();
  });

  test('«Водитель»: «Только свой подотчёт» включён и заблокирован, ключ уходит с модулем', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await roleButton(page, 'Водитель').click();
    await expect(page.getByLabel('Название роли')).toHaveValue('Водитель');
    await expect(block(page)).toHaveCount(0);
    await cashSwitch(page).click();
    await expect(self(page)).toBeChecked();
    await expect(self(page)).toBeDisabled();
    const aside = page.getByRole('complementary', { name: 'Итоговые права роли' });
    await expect(aside).toContainText('cash.advance.self');
    await cashSwitch(page).click();
    await expect(block(page)).toHaveCount(0);
    await expect(aside).not.toContainText('cash.advance.self');
  });

  test('«Назначить роль»: область «Касса» только у роли с модулем «Касса»; назначение на кассу', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await roleButton(page, 'Исполнитель').click();
    await expect(page.getByLabel('Название роли')).toHaveValue('Исполнитель');
    await cashSwitch(page).click();
    await page.getByRole('button', { name: 'Сохранить роль' }).click();
    await expect(toast(page)).toHaveText('Роль «Исполнитель» сохранена');
    await tab(page, 'Люди').click();
    await personRow(page, 'Тимур Ахмедов').getByRole('button', { name: 'Назначить роль' }).click();
    const dlg = dialog(page, 'Назначить роль');
    await dlg.getByLabel('Роль').selectOption({ label: 'Менеджер логистики' });
    await expect(dlg.getByRole('button', { name: 'Касса', exact: true })).toHaveCount(0);
    await dlg.getByLabel('Роль').selectOption({ label: 'Исполнитель' });
    await dlg.getByRole('button', { name: 'Касса', exact: true }).click();
    const desk = dlg
      .locator('label')
      .filter({ hasText: /^Касса/ })
      .locator('select');
    await expect(desk.locator('option', { hasText: 'Подотчёт' })).toHaveCount(0);
    await desk.selectOption({ label: 'Касса салона · ресепшен' });
    await expect(
      dlg.getByText('Только касса «Касса салона · ресепшен»: другие кассы по этой роли не видны'),
    ).toBeVisible();
    await dlg.getByRole('button', { name: 'Назначить' }).click();
    await expect(toast(page)).toHaveText(/^Роль «Исполнитель» назначена/);
    await expect(personRow(page, 'Тимур Ахмедов')).toContainText('Касса «Касса салона · ресепшен»');
  });

  test('390 и 1440: без горизонтальной прокрутки, цели флажков ≥ 44 px на телефоне', async ({
    app,
    page,
    axe,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await cashSwitch(page).click();
    await expect(block(page)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious).toEqual([]);
    if (phone(page)) {
      for (const box of [balance(page), self(page)]) {
        expect(await hitHeight(box.locator('xpath=ancestor::label[1]'))).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
