// W7.26 · e2e страницы `docs-route` «Маршрут документа» (эталон design-2026-10-19 «Документы.dc.html»: полоса маршрута
// :145–189, «На согласование» :631–701, «Утвердить · ПЭП» :703–715). Режим mock — MSW Docs (W7.00) на сиде «Альты»:
// «Договор подряда № 42/26» (v3, маршрут активен: шаг 1 «Согласовать» — Алексей Соколов, шаг 2 «Подпись заказчика»),
// «Приказ № 14 · работа 4 ноября» (согласован, автор Марина Котова, шаблон маршрута папки «Приказы»).
// Пункты verification-protocol §1.3: меню и URL, состояния, клавиатура, axe, 390 / 1440. Режим stand — после W7.24.
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { dialog, h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const CONTRACT = 'Договор подряда № 42/26';
const ORDER = 'Приказ № 14 · работа 4 ноября';

const bar = (page: Page): Locator => page.getByRole('region', { name: 'Маршрут документа' });

async function open(
  app: Parameters<typeof openPage>[0],
  page: Page,
  o: { persona?: Persona; doc: string },
): Promise<void> {
  await openPage(app, page, 'docs', { persona: o.persona ?? 'owner' });
  await page.getByRole('button', { name: o.doc }).click();
  await expect(h1(page, o.doc)).toBeVisible({ timeout: 15_000 });
  await expect(bar(page)).toBeVisible();
}

test.describe('docs-route — «Маршрут документа» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  test('полоса маршрута: заголовок, чипы шагов, «Сейчас», задача (владелец)', async ({
    app,
    page,
  }) => {
    await open(app, page, { doc: CONTRACT });
    await expect(bar(page).getByRole('heading', { name: 'Маршрут · v3' })).toBeVisible();
    const steps = bar(page).getByRole('listitem');
    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0)).toContainText('1 · Согласовать');
    await expect(steps.nth(0)).toContainText('все сразу · 0 из 1');
    await expect(steps.nth(1)).toContainText('2 · Подпись заказчика');
    await expect(steps.nth(1)).toContainText('Ольга Смирнова');
    await expect(bar(page)).toContainText('Шаг 1 «Согласовать» · до 02.10. Ждут: Алексей Соколов.');
    await expect(bar(page).getByRole('button', { name: 'Задача в «Задачах»' })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Отменить маршрут' })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Согласовать v3' })).toHaveCount(0);
  });

  test('согласующий: «Вернуть на доработку» без комментария — ошибка, затем возврат с причиной', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'foreman', doc: CONTRACT });
    await expect(bar(page).getByRole('button', { name: 'Отменить маршрут' })).toHaveCount(0);
    await bar(page).getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(bar(page).getByRole('alert')).toHaveText('Напишите, что доработать');
    await bar(page).getByLabel('Комментарий к решению').fill('Срок окончания — 27 ноября');
    await expect(bar(page).getByRole('alert')).toHaveCount(0);
    await bar(page).getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(toast(page)).toHaveText('Возвращено на доработку');
    await expect(bar(page)).toContainText(
      'Алексей Соколов вернул(а) v3 на доработку: «Срок окончания — 27 ноября». Документ у автора: Дарья Зимина.',
    );
    await expect(bar(page).getByLabel('Комментарий к решению')).toHaveCount(0);
  });

  test('согласующий: «Согласовать v3» — шаг закрыт, маршрут идёт к подписи заказчика', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'foreman', doc: CONTRACT });
    await expect(bar(page).getByLabel('Комментарий к решению')).toHaveAttribute(
      'placeholder',
      'Комментарий; чтобы вернуть на доработку — обязателен',
    );
    await bar(page).getByRole('button', { name: 'Согласовать v3' }).click();
    await expect(toast(page)).toHaveText('Согласовано');
    const steps = bar(page).getByRole('listitem');
    await expect(steps.nth(0)).toContainText('все сразу · 1 из 1');
    await expect(bar(page)).toContainText('Шаг 2 «Подпись заказчика»');
    await expect(bar(page)).toContainText('Ждут: Ольга Смирнова (заказчик).');
    await expect(bar(page).getByRole('button', { name: 'Согласовать v3' })).toHaveCount(0);
  });

  test('автор после возврата: причина, «Отправить снова» выключена без правок', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'foreman', doc: CONTRACT });
    await bar(page).getByLabel('Комментарий к решению').fill('Срок окончания — 27 ноября');
    await bar(page).getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(toast(page)).toHaveText('Возвращено на доработку');
    await open(app, page, { persona: 'owner', doc: CONTRACT });
    await expect(bar(page)).toContainText(
      'Алексей Соколов вернул(а) v3 на доработку: «Срок окончания — 27 ноября». Исправьте документ и отправьте снова — маршрут продолжится с шага «Согласовать».',
    );
    const resume = bar(page).getByRole('button', { name: 'Отправить снова · v3' });
    await expect(resume).toBeDisabled();
    await expect(bar(page)).toContainText('Сначала внесите правки: согласуют новую версию');
    await expect(bar(page).getByRole('button', { name: 'Отменить маршрут' })).toBeVisible();
  });

  test('«На согласование»: шаблон папки, ошибки формы, «Что произойдёт», отправка', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'owner', doc: ORDER });
    await expect(bar(page)).toContainText('У документа нет маршрута.');
    await bar(page).getByRole('button', { name: 'На согласование' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'На согласование' })).toBeVisible();
    await expect(d).toContainText('автор — Марина Котова');
    await expect(d).toContainText('шаблон «Приказ по фирме»');
    await expect(d.locator('section.ox-rt-card').first()).toContainText('Вера Котельникова');
    await expect(d).toContainText('Согласуют v3');
    await expect(d.locator('section.ox-rt-card')).toHaveCount(3);
    const what = d.getByRole('complementary', { name: 'Что произойдёт' });
    await expect(what).toContainText('Версия 3 «На согласование» закроется для правки');
    await expect(d.getByRole('alert')).toHaveCount(0);
    const send = d.getByRole('button', { name: 'Отправить на согласование' });
    await expect(send).toBeEnabled();
    // Убрали согласующего — ошибка эталона, отправка закрыта.
    await d
      .locator('section.ox-rt-card')
      .first()
      .getByRole('button', { name: /^Убрать:/ })
      .click();
    await expect(d.getByRole('alert')).toContainText('Шаг 1: добавьте согласующих');
    await expect(send).toBeDisabled();
    await d.getByLabel('Добавить согласующего').selectOption({ label: 'Алексей Соколов' });
    await expect(d.getByRole('alert')).toHaveCount(0);
    await expect(send).toBeEnabled();
    await send.click();
    await expect(toast(page)).toHaveText('Отправлено на согласование');
    await expect(dialog(page)).toHaveCount(0);
    await expect(bar(page).getByRole('heading', { name: 'Маршрут · v3' })).toBeVisible();
    const steps = bar(page).getByRole('listitem');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(1)).toContainText('2 · Утвердить');
    await expect(steps.nth(2)).toContainText('3 · Ознакомить');
    await expect(bar(page)).toContainText('Шаг 1 «Согласовать»');
    await expect(bar(page)).toContainText('Ждут: Алексей Соколов.');
    await expect(bar(page).getByRole('button', { name: 'На согласование' })).toHaveCount(0);
  });

  test('логист без права читать сотрудников: шаблон папки отправляется как есть, выбор участников недоступен', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'manager', doc: ORDER });
    await bar(page).getByRole('button', { name: 'На согласование' }).click();
    const d = dialog(page);
    await expect(d).toContainText('шаблон «Приказ по фирме»');
    await expect(d.locator('section.ox-rt-card')).toHaveCount(3);
    await expect(d.getByLabel('Добавить согласующего')).toHaveCount(0);
    await expect(d).toContainText('Нет доступных сотрудников');
    await d.getByRole('button', { name: 'Отправить на согласование' }).click();
    await expect(toast(page)).toHaveText('Отправлено на согласование');
    await expect(bar(page).getByRole('heading', { name: 'Маршрут · v3' })).toBeVisible();
    await expect(bar(page).getByRole('listitem')).toHaveCount(3);
  });

  test('«Утвердить · ПЭП»: неверное подтверждение — ошибка и попытки, верное — подписано, лист', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'owner', doc: ORDER });
    await bar(page).getByRole('button', { name: 'На согласование' }).click();
    const d = dialog(page);
    const cards = d.locator('section.ox-rt-card');
    await expect(cards).toHaveCount(3);
    await cards.nth(2).getByRole('button', { name: 'Убрать шаг' }).click();
    await cards.nth(0).getByRole('button', { name: 'Убрать шаг' }).click();
    await expect(cards).toHaveCount(1);
    await d.getByRole('button', { name: 'Отправить на согласование' }).click();
    await expect(toast(page)).toHaveText('Отправлено на согласование');
    await bar(page).getByRole('button', { name: 'Утвердить · ПЭП' }).click();
    const s = dialog(page);
    await expect(s.getByRole('heading', { name: 'Утвердить · ПЭП' })).toBeVisible();
    await expect(s).toContainText('Осталось попыток: 3');
    await s.getByLabel('Пароль').fill('неверный');
    await s.getByRole('button', { name: 'Подписать' }).click();
    await expect(s.getByRole('alert')).toContainText('Осталось попыток: 2');
    await s.getByLabel('Пароль').fill('ortus-demo');
    await s.getByRole('button', { name: 'Подписать' }).click();
    await expect(toast(page)).toHaveText(
      'Утверждено · ПЭП. PDF/A-копия с листом согласования — в той же папке',
    );
    await expect(dialog(page)).toHaveCount(0);
    await expect(bar(page).getByRole('heading', { name: 'Маршрут завершён · v3' })).toBeVisible();
    await expect(bar(page)).toContainText('Завершён');
    const sheet = bar(page).locator('details.ox-rt-sheet');
    await sheet.locator('summary').click();
    await expect(sheet).toContainText('Лист согласования · v3');
    await expect(sheet).toContainText('1 · Утвердить');
    await expect(sheet).toContainText('Дарья Зимина · подписано · ПЭП');
  });

  test('ознакомление: «Ознакомлен» адресата; автор завершает досрочно', async ({ app, page }) => {
    await open(app, page, { persona: 'owner', doc: ORDER });
    await bar(page).getByRole('button', { name: 'На согласование' }).click();
    const d = dialog(page);
    const cards = d.locator('section.ox-rt-card');
    await cards.nth(1).getByRole('button', { name: 'Убрать шаг' }).click();
    await cards.nth(0).getByRole('button', { name: 'Убрать шаг' }).click();
    await expect(cards).toHaveCount(1);
    await d.getByRole('button', { name: 'Отправить на согласование' }).click();
    await expect(toast(page)).toHaveText('Отправлено на согласование');
    await expect(bar(page)).toContainText('Шаг 1 «Ознакомить»');
    // Автор: «Завершить ознакомление» и «Отменить маршрут», кнопки «Ознакомлен» у него нет.
    await expect(bar(page).getByRole('button', { name: /^Завершить ознакомление/ })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Ознакомлен', exact: true })).toHaveCount(0);

    // Адресат: водитель.
    await open(app, page, { persona: 'driver', doc: ORDER });
    if (phone(page)) {
      const sticky = bar(page).getByRole('group', { name: 'Ознакомление' });
      await expect(sticky).toBeVisible();
      await expect(sticky.getByRole('button', { name: 'Ознакомлен', exact: true })).toBeEnabled();
      await expect(sticky).toContainText('Прочитано до конца');
      await sticky.getByRole('button', { name: 'Ознакомлен', exact: true }).click();
    } else {
      await expect(bar(page)).toContainText('Сохранятся версия v3, время и устройство. Срок — до');
      await bar(page).getByRole('button', { name: 'Ознакомлен', exact: true }).click();
    }
    await expect(toast(page)).toHaveText('Отмечено: вы ознакомились');
    await expect(bar(page)).toContainText('Вы ознакомились');
    await expect(bar(page)).toContainText(`· v3 · ${phone(page) ? 'телефон' : 'компьютер'}`);
    await expect(bar(page).getByRole('button', { name: 'Ознакомлен', exact: true })).toHaveCount(0);
  });

  test('автор: «Завершить ознакомление» закрывает шаг, «Отменить маршрут» снимает маршрут', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'owner', doc: ORDER });
    await bar(page).getByRole('button', { name: 'На согласование' }).click();
    const d = dialog(page);
    const cards = d.locator('section.ox-rt-card');
    await cards.nth(1).getByRole('button', { name: 'Убрать шаг' }).click();
    await cards.nth(0).getByRole('button', { name: 'Убрать шаг' }).click();
    await d.getByRole('button', { name: 'Отправить на согласование' }).click();
    await expect(toast(page)).toHaveText('Отправлено на согласование');
    await bar(page)
      .getByRole('button', { name: /^Завершить ознакомление/ })
      .click();
    await expect(toast(page)).toHaveText('Ознакомление завершено');
    await expect(bar(page).getByRole('heading', { name: 'Маршрут завершён · v3' })).toBeVisible();
    // Новый маршрут по тому же документу и его отмена.
    await bar(page).getByRole('button', { name: 'На согласование' }).click();
    const d2 = dialog(page);
    await d2.getByLabel('Добавить согласующего').first().selectOption({ label: 'Алексей Соколов' });
    await d2.getByRole('button', { name: 'Отправить на согласование' }).click();
    await expect(toast(page)).toHaveText('Отправлено на согласование');
    await bar(page).getByRole('button', { name: 'Отменить маршрут' }).click();
    await expect(toast(page)).toHaveText('Маршрут отменён');
    await expect(bar(page)).toContainText('У документа нет маршрута.');
    await expect(bar(page).getByRole('button', { name: 'На согласование' })).toBeVisible();
  });
});

test.describe('docs-route — состояния, клавиатура, axe, 390 @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  test('ошибка загрузки — «Повторить»; загрузка — скелетон', async ({ app, page }) => {
    await openPage(app, page, 'docs');
    await devScenario(page, { scenario: 'getDocRoute=rate_limited' });
    await page.getByRole('button', { name: CONTRACT }).click();
    await expect(bar(page).getByRole('alert')).toContainText('Слишком много запросов');
    await devScenario(page, { scenario: 'getDocRoute=delay=1500' });
    await bar(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(bar(page)).toHaveAttribute('aria-busy', 'true');
    await devScenario(page, { scenario: null });
    await expect(bar(page).getByRole('heading', { name: 'Маршрут · v3' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('документ недоступен — короткий текст вместо маршрута', async ({ app, page }) => {
    await openPage(app, page, 'docs');
    await devScenario(page, { scenario: 'getDocument=not_found' });
    await page.getByRole('button', { name: CONTRACT }).click();
    await expect(bar(page)).toContainText('Не удалось загрузить маршрут');
    await expect(bar(page).getByRole('button')).toHaveCount(0);
  });

  test('нет связи — решение недоступно, подпись «только чтение»; связь вернулась — доступно', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'foreman', doc: CONTRACT });
    const approve = bar(page).getByRole('button', { name: 'Согласовать v3' });
    await expect(approve).toBeEnabled();
    await page.context().setOffline(true);
    await expect(bar(page)).toContainText('Нет связи · только чтение');
    await expect(approve).toBeDisabled();
    await page.context().setOffline(false);
    await expect(approve).toBeEnabled();
    await expect(bar(page)).not.toContainText('Нет связи · только чтение');
  });

  test('клавиатура: «На согласование» открывается с Enter, Esc закрывает и возвращает фокус', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'owner', doc: ORDER });
    const trigger = bar(page).getByRole('button', { name: 'На согласование' });
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('axe без serious (полоса, «На согласование», «Утвердить · ПЭП»); 390 — цели не меньше 44 px, без горизонтальной прокрутки', async ({
    app,
    page,
    axe,
  }) => {
    const bad = async (): Promise<string[]> =>
      (await axe(page)).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    await open(app, page, { persona: 'owner', doc: ORDER });
    await bar(page).getByRole('button', { name: 'На согласование' }).click();
    await expect(dialog(page).locator('section.ox-rt-card')).toHaveCount(3);
    await expect(dialog(page).getByRole('complementary', { name: 'Что произойдёт' })).toContainText(
      'закроется для правки',
    );
    if (!phone(page)) {
      // Эталон :631–701: две колонки до 1000 px, «Что произойдёт» справа от формы, «Закрыть» × в шапке.
      const box = await dialog(page).locator('.ox-rt-dlg').boundingBox();
      const side = await dialog(page)
        .getByRole('complementary', { name: 'Что произойдёт' })
        .boundingBox();
      const first = await dialog(page).locator('section.ox-rt-card').first().boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(900);
      expect(side && first && side.x > first.x + first.width).toBe(true);
      await expect(dialog(page).getByRole('button', { name: 'Закрыть' })).toBeVisible();
    }
    expect(await bad()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      for (const name of ['Убрать шаг', 'Поднять шаг']) {
        expect(
          await hitHeight(dialog(page).getByRole('button', { name }).nth(1)),
        ).toBeGreaterThanOrEqual(44);
      }
      expect(
        await hitHeight(dialog(page).getByRole('button', { name: 'Отправить на согласование' })),
      ).toBeGreaterThanOrEqual(44);
    }
    await dialog(page).getByRole('button', { name: 'Отмена' }).click();
    await open(app, page, { persona: 'foreman', doc: CONTRACT });
    await bar(page).getByRole('button', { name: 'Согласовать v3' }).waitFor();
    expect(await bad()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      for (const name of ['Согласовать v3', 'Вернуть на доработку']) {
        expect(await hitHeight(bar(page).getByRole('button', { name }))).toBeGreaterThanOrEqual(44);
      }
    }
  });

  // Возврат 1: после отправки и подписи пустое объявление React Aria (div[role=img][aria-labelledby]) оставалось
  // без подписи — axe serious role-img-alt. Кнопки блока — без `loading`; 404 в консоли сценария не допускается.
  test('axe после «Отправить на согласование» и «Подписать»: без serious, без пустых role=img, без лишних 404', async ({
    app,
    page,
    axe,
  }) => {
    const bad = async (): Promise<string[]> =>
      (await axe(page)).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    const unlabeledImg = (): Promise<number> =>
      page.evaluate(
        () =>
          [...document.querySelectorAll('[role="img"][aria-labelledby]')].filter((el) => {
            const id = el.getAttribute('aria-labelledby') ?? '';
            return id
              .split(/\s+/)
              .every((i) => !(document.getElementById(i)?.textContent ?? '').trim());
          }).length,
      );
    const failed: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 404) failed.push(r.url());
    });
    await open(app, page, { persona: 'owner', doc: ORDER });
    await bar(page).getByRole('button', { name: 'На согласование' }).click();
    const d = dialog(page);
    const cards = d.locator('section.ox-rt-card');
    await cards.nth(2).getByRole('button', { name: 'Убрать шаг' }).click();
    await cards.nth(0).getByRole('button', { name: 'Убрать шаг' }).click();
    await d.getByRole('button', { name: 'Отправить на согласование' }).click();
    await expect(toast(page)).toHaveText('Отправлено на согласование');
    await expect(dialog(page)).toHaveCount(0);
    expect(await bad()).toEqual([]);
    expect(await unlabeledImg()).toBe(0);
    await bar(page).getByRole('button', { name: 'Утвердить · ПЭП' }).click();
    const s = dialog(page);
    await s.getByLabel('Пароль').fill('ortus-demo');
    await s.getByRole('button', { name: 'Подписать' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(bar(page).getByRole('heading', { name: 'Маршрут завершён · v3' })).toBeVisible();
    await bar(page).locator('details.ox-rt-sheet summary').click();
    expect(await bad()).toEqual([]);
    expect(await unlabeledImg()).toBe(0);
    // 404 getDocRoute по контракту = «маршрута нет» (документ без маршрута); других 404 быть не должно.
    expect(failed.filter((u) => !u.endsWith('/route'))).toEqual([]);
  });
});

test.describe('docs-route — «Маршрут документа» @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('@stand-spec маршрут на настоящем backend (причина: backend маршрута — W7.24, ещё не в main)', () => {});
});
