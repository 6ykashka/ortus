// W1.54 · Помощники e2e экрана «Структура» (`company-structure`): дерево, строка узла, диалоги создания и переноса
// кликами по ролям и подписям. Общие для `company-structure.spec.ts` и шага структуры J-1 W1.30
// (`journeys/stage1/owner-onboarding.spec.ts`).
import { expect, type Locator, type Page } from '@playwright/test';

export const tree = (page: Page): Locator =>
  page.getByRole('list', { name: 'Структура организации' });

/** Строка узла по точному названию. */
export const unitRow = (page: Page, name: string): Locator =>
  tree(page)
    .locator('.ox-str-row')
    .filter({ has: page.locator('.ox-str-name').getByText(name, { exact: true }) });

/** Элемент списка узла (его строка и поддерево). */
export const unitItem = (page: Page, name: string): Locator =>
  tree(page)
    .locator('li.ox-str-node')
    .filter({
      has: page.locator(':scope > .ox-str-row .ox-str-name').getByText(name, { exact: true }),
    });

export const structureDialog = (page: Page, title: string): Locator =>
  page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

/**
 * Создать узел через интерфейс: «Добавить регион» (верхний уровень) или «Добавить в «{родитель}»», название, вид по
 * умолчанию (следующий уровень) или явно, «Добавить» → тост «Добавлено: «…»» и строка в дереве.
 */
export async function addUnit(
  page: Page,
  o: { parent?: string; name: string; kind?: string },
): Promise<void> {
  if (o.parent) {
    await unitRow(page, o.parent)
      .getByRole('button', { name: `Добавить в «${o.parent}»` })
      .click();
  } else {
    await page.getByRole('button', { name: 'Добавить регион' }).first().click();
  }
  const dlg = structureDialog(page, 'Новое подразделение');
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Название').fill(o.name);
  if (o.kind) await dlg.getByLabel('Вид').selectOption({ label: o.kind });
  await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.locator('.ox-toast .ox-toast-text')).toHaveText(`Добавлено: «${o.name}»`);
  await expect(dlg).toBeHidden();
  await expect(unitRow(page, o.name)).toBeVisible();
}

/** Открыть «Перенести «{name}»» и выбрать цель по подписи (путь узла); возвращает диалог. */
export async function startMove(page: Page, name: string, target: string): Promise<Locator> {
  await unitRow(page, name)
    .getByRole('button', { name: `Перенести «${name}»` })
    .click();
  const dlg = structureDialog(page, `Перенести «${name}»`);
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Куда перенести').selectOption({ label: target });
  return dlg;
}
