// W7.25 · e2e диалога `modal-doc-share` «Поделиться» — правая панель 480 px: кто вы, добавить, режим, список,
// внешняя ссылка, «Что изменится», «Откуда доступ». Эталон design-2026-10-19 «Документы.dc.html» :554–629
// (documents.md §1.9). Режим mock — MSW Docs W7.00 на сиде «Альты». Режим stand — после W7.23a.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { dialog, h1, hitHeight, openPage, toast } from './modules.helpers.ts';

type Persona = 'owner' | 'manager' | 'driver' | 'foreman';

async function openShare(
  app: Parameters<typeof openPage>[0],
  page: Page,
  title: string,
  persona: Persona = 'owner',
): Promise<Locator> {
  await openPage(app, page, 'docs', { persona });
  await expect(h1(page, 'Документы')).toBeVisible({ timeout: 15_000 });
  await page.locator('button.ox-docs-row').filter({ hasText: title }).click();
  await expect(h1(page, title)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /^(Поделиться|Доступ) · / }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: /^(Поделиться|Доступ)$/ })).toBeVisible();
  return d;
}

test.describe('docs-share — «Поделиться» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  test('владелец: кто вы, автор и записи папки, режим, «Попадёт в журнал документа»', async ({
    app,
    page,
  }) => {
    const d = await openShare(app, page, 'Приказ № 14 · работа 4 ноября');
    await expect(d.getByTestId('share-who')).toHaveText(
      'Вы — владелец бизнеса: выдаёте любой уровень и внешние ссылки.',
    );
    const list = d.getByRole('region', { name: 'Список доступа' });
    await expect(list).toContainText('Марина Котова');
    await expect(list).toContainText('Автор');
    await expect(list).toContainText('из папки «Север Логистик»');
    await expect(list).toContainText('Роль «');
    await expect(
      d
        .getByRole('radiogroup', { name: 'Кто видит документ' })
        .getByRole('radio', { name: /Как у папки и свои/ }),
    ).toBeChecked();
    await expect(d.getByText('Попадёт в журнал документа')).toBeVisible();
    await expect(d.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await expect(d.getByRole('region', { name: 'Что изменится' })).toContainText(
      'Потеряют доступ: никто',
    );
  });

  test('добавить сотрудника: «Что изменится», сохранение, запись остаётся после повторного открытия', async ({
    app,
    page,
  }) => {
    const d = await openShare(app, page, 'Регламент приёмки смены');
    await d
      .getByLabel('Сотрудник, группа, роль или связь')
      .selectOption({ label: 'Сотрудники · Алексей Соколов' });
    await d
      .getByRole('radiogroup', { name: 'Уровень доступа' })
      .getByRole('radio', { name: 'Комментирует' })
      .click();
    await d.getByRole('button', { name: 'Добавить' }).click();
    const list = d.getByRole('region', { name: 'Список доступа' });
    await expect(list).toContainText('Алексей Соколов');
    const impact = d.getByRole('region', { name: 'Что изменится' });
    await expect(impact).toContainText('Алексей Соколов получит «Комментирует» и уведомление', {
      timeout: 10_000,
    });
    await expect(impact).toContainText('Потеряют доступ: никто');
    await d.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Доступ сохранён');
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole('button', { name: /^Поделиться · / }).click();
    await expect(dialog(page).getByRole('region', { name: 'Список доступа' })).toContainText(
      'Алексей Соколов',
    );
  });

  test('убрать запись: «Потеряют доступ»; режим «Только выбранные»', async ({ app, page }) => {
    const d = await openShare(app, page, 'Приказ № 14 · работа 4 ноября');
    const list = d.getByRole('region', { name: 'Список доступа' });
    await d
      .getByRole('button', { name: /^Убрать из списка: Роль «/ })
      .first()
      .click();
    await expect(d.getByRole('region', { name: 'Что изменится' })).toContainText(
      'Потеряют доступ:',
      { timeout: 10_000 },
    );
    await d
      .getByRole('radiogroup', { name: 'Кто видит документ' })
      .getByRole('radio', { name: /Только выбранные/ })
      .click();
    await expect(list).not.toContainText('из папки «Север Логистик»');
    await d.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Доступ сохранён');
  });

  test('прораб: уровень выше своего недоступен, подсказка «Вы — «Правит»»', async ({
    app,
    page,
  }) => {
    const d = await openShare(app, page, 'Договор подряда № 42/26', 'foreman');
    await expect(d.getByTestId('share-who')).toHaveText(
      'Вы — «Правит»: делитесь внутри организации не выше «Правит».',
    );
    await expect(
      d
        .getByRole('radiogroup', { name: 'Уровень доступа' })
        .getByRole('radio', { name: 'Управляет доступом' }),
    ).toBeDisabled();
    await expect(d.getByRole('radiogroup', { name: 'Кто видит документ' })).toHaveCount(0);
    await expect(d.getByRole('region', { name: 'Внешняя ссылка для заказчика' })).toContainText(
      'Внешние ссылки создаёт владелец бизнеса.',
    );
  });

  test('внешняя ссылка: срок не больше 30 дней, создание с PIN, отзыв', async ({ app, page }) => {
    const d = await openShare(app, page, 'Приказ № 14 · работа 4 ноября');
    const ext = d.getByRole('region', { name: 'Внешняя ссылка для заказчика' });
    await expect(ext).toContainText('Без аккаунта, место не занимает');
    await expect(ext).toContainText('Ссылок нет');
    await ext.getByLabel('Действует до').fill('2026-12-31');
    await ext.getByRole('button', { name: 'Создать ссылку' }).click();
    await expect(ext).toContainText('Срок ссылки — не больше 30 дней');
    await ext.getByLabel('Действует до').fill('2026-10-15');
    await ext.getByRole('button', { name: 'Создать ссылку' }).click();
    await expect(toast(page)).toHaveText('Ссылка создана');
    await expect(ext.getByRole('status')).toContainText('Ссылка и PIN показываются один раз');
    await expect(ext.getByRole('status')).toContainText('PIN 482915');
    const row = ext.locator('li.ox-docs-person').first();
    await expect(row).toContainText('Читает · v2');
    await expect(row).toContainText('до 15.10.2026');
    await expect(row).toContainText('PIN из SMS · Водяной знак · Без скачивания');
    await row.getByRole('button', { name: 'Отозвать' }).click();
    await expect(toast(page)).toHaveText('Ссылка отозвана');
    await expect(row).toContainText('Отозвана');
  });

  test('по эталону: подзаголовок, «Закрыть», уровни и режимы радиогруппами, «Сохранить» всегда на экране', async ({
    app,
    page,
  }) => {
    const d = await openShare(app, page, 'Приказ № 14 · работа 4 ноября');
    await expect(d.getByRole('button', { name: 'Закрыть' })).toBeVisible();
    await expect(d.getByTestId('share-sub')).toContainText('Приказ № 14 · работа 4 ноября');
    const levels = d.getByRole('radiogroup', { name: 'Уровень доступа' });
    await expect(levels.getByRole('radio')).toHaveCount(5);
    await expect(levels.getByRole('radio', { name: 'Читает' })).toBeChecked();
    await expect(d).toContainText(
      'Открывает документ. Скачать и распечатать — если это разрешает роль.',
    );
    const modes = d.getByRole('radiogroup', { name: 'Кто видит документ' });
    await expect(modes).toContainText('Доступ папки плюс список документа');
    await expect(modes).toContainText('Роли и списки папки не действуют');
    await expect(d.getByRole('region', { name: 'Откуда доступ' })).toContainText('Итог: «');
    await expect(
      d
        .getByRole('region', { name: 'Список доступа' })
        .getByRole('listitem')
        .filter({ hasText: 'Владелец бизнеса' }),
    ).toContainText('видит и правит все документы');
    const save = d.getByRole('button', { name: 'Сохранить' });
    const vh = page.viewportSize()?.height ?? 0;
    const box = await save.boundingBox();
    expect((box?.y ?? 9999) + (box?.height ?? 0)).toBeLessThanOrEqual(vh);
    await expect(d.getByRole('button', { name: 'Отмена' })).toBeInViewport();
    await expect(save).toBeInViewport();
  });

  test('«Откуда доступ»: цепочка с итогом', async ({ app, page }) => {
    const d = await openShare(app, page, 'Приказ № 14 · работа 4 ноября');
    const chain = d.getByRole('region', { name: 'Откуда доступ' });
    await expect(chain).toContainText('Организация');
    await expect(chain).toContainText('Папка «Приказы»');
    await expect(chain).toContainText('Итог: «Управляет доступом»');
  });

  test('нет права делиться: только чтение списка и подсказка', async ({ app, page }) => {
    const d = await openShare(app, page, 'Приказ № 14 · работа 4 ноября', 'driver');
    await expect(d.getByRole('heading', { name: 'Доступ' })).toBeVisible();
    await expect(d.getByTestId('share-who')).toContainText(
      'делиться может владелец документа или тот, кто управляет доступом.',
    );
    await expect(d.getByRole('button', { name: 'Сохранить' })).toHaveCount(0);
    await expect(d.getByRole('radiogroup', { name: 'Кто видит документ' })).toHaveCount(0);
  });

  test('клавиатура: Escape закрывает, фокус возвращается; axe; цели 44 px; панель 480 px на 1440', async ({
    app,
    page,
    axe,
  }) => {
    const d = await openShare(app, page, 'Приказ № 14 · работа 4 ноября');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const bad = (await axe(page)).violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(bad).toEqual([]);
    const box = await page.locator('section[aria-modal="true"]').boundingBox();
    if (phone(page)) {
      expect(await hitHeight(d.getByRole('button', { name: 'Отмена' }))).toBeGreaterThanOrEqual(44);
    } else {
      expect(Math.round(box?.width ?? 0)).toBe(480);
      expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(1440);
    }
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Поделиться · / })).toBeFocused();
  });
});

test.describe('docs-share — «Поделиться» @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('@stand-spec «Поделиться» на настоящем backend (причина: backend документов — W7.23a, ещё не в main)', () => {});
});
