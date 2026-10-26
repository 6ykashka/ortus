// W5.32 · e2e страницы `cash` «Касса» (`/t/:tenantId/cash`; эталон design-2026-10-19 «Касса.dc.html», разбор
// docs/plan/v2/analysis/dor/cash.md §1.4–1.6): вкладки «Кассы», «Входящие», «Смены», «Настройки», диалоги модуля.
// Режим mock — сценарный сервер W5.00 (контракт 0.12.0-stage5, сид «Альты»: 8 касс, смены 117 и 118, заявка Котовой,
// четыре предложения); stand — backend W5.31 (@stand-spec, не влит в main). Персонаж — владелец: в mock у кассира нет
// cash.* в /me/context (Q-W5.32-7), поэтому ограниченные права проверяет Vitest подменой ответа listCashAccounts.
// Пункты verification-protocol §1.3: загрузка и ошибка списка (Vitest, сеть mock здесь не подменить), нет связи,
// клавиатура, раскладка 390 / 1440, axe.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { dialog, h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';

const NB = String.fromCharCode(160);
const money = (s: string): string => s.replace(/ /g, NB);
const main = (page: Page): Locator => page.locator('section.ox-ca');
const tabBtn = (page: Page, name: string): Locator =>
  main(page)
    .locator('.ox-ca-tab')
    .filter({ hasText: new RegExp(`^${name}`) });
const acc = (page: Page, name: RegExp | string): Locator =>
  main(page).locator('button.ox-ca-acc').filter({ hasText: name });
const card = (page: Page): Locator => main(page).locator('section[aria-label]').first();
const rows = (page: Page): Locator => main(page).locator('.ox-ca-op');
const aside = (page: Page, label: string): Locator =>
  main(page).locator(`aside[aria-label="${label}"]`);

async function openCash(
  app: Parameters<typeof openPage>[0],
  page: Page,
  search = '',
): Promise<string> {
  const id = await openPage(app, page, `cash${search}`);
  await expect(h1(page, 'Касса')).toBeVisible({ timeout: 15_000 });
  await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
  return id;
}

test.describe('cash — страница «Касса» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  test('владелец: шапка, вкладки и счётчик, подзаголовок, баннер ККТ', async ({ app, page }) => {
    await openCash(app, page);
    await expect(main(page)).toContainText('8 касс и счетов в вашей области');
    await expect(main(page).locator('.ox-ca-tab')).toHaveText([
      'Кассы',
      'Входящие5',
      'Смены',
      'Настройки',
    ]);
    await expect(main(page).getByRole('button', { name: 'Новая операция' })).toBeVisible();
    await expect(main(page).locator('.ox-ca-banner')).toContainText(
      'ККТ к Ортусу пока не подключены.',
    );
  });

  test('«Кассы»: группы, карточка кассы салона, факты, «Ваш доступ»', async ({ app, page }) => {
    await openCash(app, page);
    await expect(main(page).locator('.ox-ca-gname')).toHaveText([
      'Север Логистик',
      'Вся организация',
    ]);
    const c = card(page);
    await expect(
      c.getByRole('heading', { level: 2, name: 'Касса салона · ресепшен' }),
    ).toBeVisible();
    for (const b of ['Принять оплату', 'Закрыть смену', 'Переместить']) {
      await expect(c.getByRole('button', { name: b })).toBeVisible();
    }
    await expect(c.locator('.ox-ca-fact').first()).toContainText(money('7 350 ₽'));
    await expect(c.locator('.ox-ca-fact').nth(1)).toContainText('№ 118 открыта');
    await expect(c.locator('.ox-ca-access')).toContainText('Ваш доступ: Владелец бизнеса');
  });

  test('фильтр журнала: «Приход», «Возвраты», «Исправления»', async ({ app, page }) => {
    await openCash(app, page);
    const all = await rows(page).count();
    await main(page).getByRole('radio', { name: 'Приход' }).click();
    const incoming = await rows(page).count();
    expect(incoming).toBeGreaterThan(0);
    expect(incoming).toBeLessThan(all);
    await main(page).getByRole('radio', { name: 'Возвраты' }).click();
    await expect(rows(page)).toHaveCount(1);
    await main(page).getByRole('radio', { name: 'Исправления' }).click();
    await expect(main(page)).toContainText('Недостача при пересчёте');
  });

  test('«Новая операция»: проверка полей, приход проведён, сторно', async ({ app, page }) => {
    await openCash(app, page);
    await acc(page, /Касса офиса/).click();
    await main(page).getByRole('button', { name: 'Новая операция' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Новая операция' })).toBeVisible();
    await d.getByRole('button', { name: 'Провести' }).click();
    await expect(d.getByRole('alert')).toContainText('Укажите сумму больше нуля.');
    await d.getByLabel('Сумма, ₽').fill('1500');
    await d.getByLabel('Основание · обязательно').fill('Подарочный сертификат № 215');
    await d.getByRole('button', { name: 'Провести' }).click();
    await expect(toast(page)).toHaveText('Операция проведена');
    const row = rows(page).filter({ hasText: 'Подарочный сертификат № 215' });
    await expect(row.locator('.ox-ca-opamount')).toHaveText(`+1${NB}500${NB}₽`);
    await row.getByRole('button', { name: 'Сторно' }).click();
    const r = dialog(page);
    await expect(r.getByRole('heading', { name: /^Сторно K-/ })).toBeVisible();
    await r.getByRole('button', { name: 'Сторнировать' }).click();
    await expect(r.getByRole('alert')).toContainText('Укажите причину.');
    await r.getByLabel('Причина исправления').fill('ошибка ввода');
    await r.getByRole('button', { name: 'Сторнировать' }).click();
    await expect(toast(page)).toHaveText('Сторно проведено');
    await expect(row).toContainText('исправлена K-');
  });

  test('расход больше остатка: заметка и отказ сервера в диалоге', async ({ app, page }) => {
    await openCash(app, page);
    await acc(page, /Касса офиса/).click();
    await main(page).getByRole('button', { name: 'Новая операция' }).click();
    const d = dialog(page);
    await d.getByRole('radio', { name: 'Расход' }).click();
    await d.getByLabel('Сумма, ₽').fill('9999999');
    await expect(d).toContainText('наличная касса не уходит в минус');
    await d.getByLabel('Основание · обязательно').fill('Закупка воды');
    await d.getByRole('button', { name: 'Провести' }).click();
    await expect(d.getByRole('alert')).toContainText('нет столько наличных');
  });

  test('«Входящие»: группы, заявка Котовой — «Согласовать и провести»', async ({ app, page }) => {
    await openCash(app, page);
    await tabBtn(page, 'Входящие').click();
    const list = aside(page, 'Входящие');
    await expect(list.locator('.ox-ca-igroup')).toHaveText([
      'approvalСогласование',
      'spaСалон и SPA',
      'support_agentОбращения',
      'constructionРемонт и стройка',
    ]);
    await expect(list).toContainText('Финансовый блок · владелец и роли с начислениями');
    const panel = main(page).locator('section[aria-label="Проведение"]');
    await expect(panel).toContainText('Ждёт вашего решения');
    await panel.getByRole('button', { name: 'Согласовать и провести' }).click();
    await expect(toast(page)).toHaveText('Согласовано и проведено');
    await expect(list).not.toContainText('Ремонт ворот склада');
  });

  test('«Входящие»: заявка — «Отклонить» с причиной', async ({ app, page }) => {
    await openCash(app, page);
    await tabBtn(page, 'Входящие').click();
    await main(page).getByRole('button', { name: 'Отклонить' }).click();
    const d = dialog(page);
    await expect(d).toContainText('Автор увидит причину. Деньги не двигаются.');
    await d.getByRole('button', { name: 'Отклонить' }).click();
    await expect(d.getByRole('alert')).toContainText('Укажите причину.');
    await d.getByLabel('Причина').fill('нет бюджета');
    await d.getByRole('button', { name: 'Отклонить' }).click();
    await expect(toast(page)).toHaveText('Заявка отклонена');
  });

  test('«Входящие»: визит — чек ККТ вручную, «Провести»; «Не проводить» с причиной', async ({
    app,
    page,
  }) => {
    await openCash(app, page);
    await tabBtn(page, 'Входящие').click();
    const list = aside(page, 'Входящие');
    await list.getByRole('button', { name: /Наталья С\. · Массаж лица/ }).click();
    const panel = main(page).locator('section[aria-label="Проведение"]');
    await expect(
      panel.getByRole('heading', { level: 3, name: 'Оплата · Наталья С.' }),
    ).toBeVisible();
    await expect(panel).toContainText('Чек ККТ · вручную');
    await panel.getByRole('button', { name: /^Провести/ }).click();
    await expect(panel.getByRole('alert')).toContainText('№ ФД — только цифры.');
    await panel.getByLabel('№ ФД').fill('7777');
    await panel.getByRole('button', { name: /^Провести/ }).click();
    await expect(toast(page)).toHaveText(`Проведено: 2${NB}800${NB}₽`);
    await expect(list).not.toContainText('Наталья С.');
    await list.getByRole('button', { name: /Ирина П\. · компенсация/ }).click();
    await panel.getByRole('button', { name: 'Не проводить' }).click();
    const d = dialog(page);
    await d.getByLabel('Почему не проводите').fill('клиент передумал');
    await d.getByRole('button', { name: 'Не проводить' }).click();
    await expect(toast(page)).toHaveText('Предложение убрано из входящих');
  });

  test('«Смены»: список, сверка закрытой смены, закрытие вслепую → «Ждёт решения»', async ({
    app,
    page,
  }) => {
    await openCash(app, page);
    await tabBtn(page, 'Смены').click();
    const list = aside(page, 'Смены');
    await expect(list.locator('.ox-ca-pick strong')).toHaveText([
      'Смена 118 · Касса салона · ресепшен',
      'Смена 117 · Касса салона · ресепшен',
    ]);
    await list.getByRole('button', { name: /Смена 117/ }).click();
    await expect(main(page).locator('.ox-ca-table')).toContainText('в допуске');
    await expect(main(page)).toContainText('Автоматически: В пределах допуска');
    await list.getByRole('button', { name: /Смена 118/ }).click();
    await main(page).getByRole('button', { name: 'Закрыть смену' }).first().click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Закрыть смену 118' })).toBeVisible();
    await expect(d).toContainText('Ожидаемую сумму не показываем: касса работает вслепую.');
    await d.getByLabel('Купюры 1000 ₽, штук').fill('2');
    await d.getByLabel('Наличными, ₽', { exact: true }).fill('3000');
    await d.getByLabel('Безналичными, ₽').fill('12000');
    await d.getByRole('button', { name: 'Закрыть смену' }).click();
    await expect(toast(page)).toContainText('Смена закрыта');
    await expect(main(page)).toContainText(
      'Вы закрывали смену — расхождение принимает другой сотрудник',
    );
  });

  test('«Перемещение»: касса офиса → сейф, «В пути», приём получателем', async ({ app, page }) => {
    await openCash(app, page);
    await acc(page, /Касса офиса/).click();
    await card(page).getByRole('button', { name: 'Переместить' }).click();
    const d = dialog(page);
    await expect(d.getByLabel('Куда', { exact: true })).toHaveValue(/.+/);
    await d.getByLabel('Сумма, ₽').fill('1000');
    await d.getByLabel('Основание').fill('Сдача выручки');
    await d.getByRole('button', { name: 'Отправить' }).click();
    await expect(toast(page)).toHaveText('Отправлено: деньги в пути до приёма');
    await expect(main(page).locator('.ox-ca-moves')).toContainText(
      `1${NB}000${NB}₽ в «Сейф офиса»`,
    );
    await acc(page, /Сейф офиса/).click();
    const move = main(page)
      .locator('.ox-ca-move')
      .filter({ hasText: `1${NB}000${NB}₽ из «Касса офиса»` });
    await move.getByRole('button', { name: `Принять 1${NB}000${NB}₽` }).click();
    await expect(toast(page)).toHaveText(`Принято: 1${NB}000${NB}₽`);
    await expect(move).toHaveCount(0);
  });

  test('«Настройки»: кассы и роли; «Новая касса» — «Кто получит доступ», создание', async ({
    app,
    page,
  }) => {
    await openCash(app, page);
    await tabBtn(page, 'Настройки').click();
    await expect(main(page)).toContainText('Кассы и счета');
    await expect(main(page)).toContainText('Касса в ролях');
    await main(page).getByRole('button', { name: 'Новая касса' }).click();
    const d = dialog(page);
    await expect(d).toContainText('Кто получит доступ');
    await expect(d.getByRole('radio')).toHaveCount(5 + 2 + 3);
    await d.getByRole('button', { name: 'Создать кассу' }).click();
    await expect(d.getByRole('alert')).toContainText('Укажите название кассы.');
    await d.getByLabel('Название').fill('Касса второго этажа');
    await d.getByRole('button', { name: 'Создать кассу' }).click();
    await expect(toast(page)).toHaveText('Касса создана');
    await expect(
      main(page).getByRole('heading', { level: 2, name: 'Касса второго этажа' }),
    ).toBeVisible();
  });

  test('диплинк ?open=inbox открывает «Входящие» и очищает адрес', async ({ app, page }) => {
    await openPage(app, page, 'cash?open=inbox');
    await expect(h1(page, 'Касса')).toBeVisible({ timeout: 15_000 });
    await expect(tabBtn(page, 'Входящие')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/\/cash$/);
  });

  test('нет связи: баннер и заблокированные кнопки', async ({ app, page, context }) => {
    await openCash(app, page);
    await context.setOffline(true);
    await expect(main(page)).toContainText('Нет связи с сервером');
    await expect(main(page).getByRole('button', { name: 'Новая операция' })).toBeDisabled();
    await expect(card(page).getByRole('button', { name: 'Переместить' })).toBeDisabled();
    await context.setOffline(false);
    await expect(main(page).getByRole('button', { name: 'Новая операция' })).toBeEnabled();
  });

  test('клавиатура: вкладки по Tab и Enter, диалог закрывается по Esc, фокус возвращается', async ({
    app,
    page,
  }) => {
    await openCash(app, page);
    await tabBtn(page, 'Входящие').focus();
    await page.keyboard.press('Enter');
    await expect(tabBtn(page, 'Входящие')).toHaveAttribute('aria-pressed', 'true');
    await tabBtn(page, 'Кассы').focus();
    await page.keyboard.press('Enter');
    const create = main(page).getByRole('button', { name: 'Новая операция' });
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(create).toBeFocused();
  });

  test('раскладка: без горизонтальной прокрутки, цели ≥ 44 px на телефоне, axe без serious', async ({
    app,
    page,
    axe,
  }, testInfo) => {
    await openCash(app, page);
    expect(await noHorizontalScroll(page)).toBe(true);
    const phone = testInfo.project.name.includes('390');
    if (phone) {
      for (const l of [
        tabBtn(page, 'Кассы'),
        main(page).getByRole('button', { name: 'Новая операция' }),
      ]) {
        expect(await hitHeight(l)).toBeGreaterThanOrEqual(44);
      }
    }
    await tabBtn(page, 'Смены').click();
    await aside(page, 'Смены')
      .getByRole('button', { name: /Смена 117/ })
      .click();
    await expect(main(page).locator('.ox-ca-table')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const bad = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
});

test.describe('cash — stand @stand-spec', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand — backend кассы');

  test.fixme('сценарии кассы на stand: backend W5.31 не влит в main (ветка ws/W5.31), права кассира и лимиты', async () => {
    expect(true).toBe(true);
  });
});
