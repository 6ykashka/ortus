// W6.21 · e2e страницы `repair-estimate` — вкладка «Смета» карточки объекта (эталон design-2026-10-19
// «Ремонт и стройка.dc.html» :104–276, логика :1313–1488; DoR docs/plan/v2/analysis/dor/repair.md §1.3, §2.6, §5,
// Q-W4.00-repair-5, -9, -24). Данные — MSW W6.00 (пресет repairs-ready, «сегодня» 20.10.2026): контрольные суммы
// кв. 42 (v1 404 418 ₽, v2 438 175 ₽, ДР-1 +13 050 ₽) и дома в Истре (1 078 533 ₽). Согласие заказчика — публичная
// операция кабинета (кнопок «Демо: заказчик …» нет, Q-W4.00-repair-9). Backend смет — W6.12 (stand — @stand, W2.103).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { approveByClient, OBJ, openRepair, plainText } from './repair.tabs.helpers.ts';
import type { Session, Undo } from './_stand/fixtures.ts';
import {
  type StandObject,
  contractedObject,
  grantForeman,
  measure,
  repairObject,
} from './repair.stand.ts';
import { devScenario, tenantId } from './shell.helpers.ts';

const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const nb = (s: string): string => s.replace(/(\d) (\d{3})/g, '$1 $2');

const section = (page: Page): Locator => page.locator('section[aria-labelledby="h-est"]');
const btn = (page: Page, name: string | RegExp): Locator =>
  section(page).getByRole('button', { name });
const tile = (page: Page, n: number): Locator =>
  section(page)
    .getByRole('group', { name: 'Версии сметы' })
    .getByRole('button', { name: new RegExp(`^Версия ${n}\\b`) });
const headChip = (page: Page): Locator => section(page).locator('.ox-rp-head .ox-rp-chip');
const note = (page: Page): Locator => section(page).locator('.ox-rp-note-text');
const grand = (page: Page): Locator => section(page).locator('tr.ox-rp-grand');
const rowOf = (page: Page, name: string): Locator =>
  section(page)
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name }) });
const field = (page: Page, label: string): Locator =>
  section(page).getByRole('textbox', { name: label, exact: true });
const patched = (page: Page) =>
  page.waitForResponse(
    (r) =>
      r.request().method() === 'PATCH' && r.url().includes('/estimates/') && r.status() === 200,
  );

const expectChip = async (page: Page, text: string): Promise<void> => {
  await expect(headChip(page)).toContainText(text, { timeout: 20_000 });
  expect(await plainText(headChip(page))).toBe(text);
};

test.describe('repair-estimate — «Смета» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(120_000);

  test('кв. 42: версии 1 и 2, действует версия 2 · 438 175 ₽, договор № 42', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate' });
    await expect(section(page).getByRole('heading', { level: 2, name: 'Смета' })).toBeVisible();
    await expect(section(page)).toContainText(
      'Действует согласованная версия — основа договора. Изменения после договора проходят допсоглашением: прораб предлагает допработу, офис оценивает её в смете, заказчик подписывает кодом из SMS.',
    );
    await expectChip(page, 'Версия 2 · действует');
    await expect(tile(page, 1)).toContainText('заменена');
    await expect(tile(page, 1)).toContainText(nb('404 418 ₽'));
    await expect(tile(page, 2)).toContainText('действует');
    await expect(tile(page, 2)).toContainText(nb('438 175 ₽'));
    await expect(tile(page, 2)).toContainText('договор № 42');
    await expect(tile(page, 2)).toHaveAttribute('aria-pressed', 'true');
    await expect(grand(page)).toContainText('Итого по версии 2');
    await expect(grand(page)).toContainText(nb('438 175 ₽'));
    await expect(rowOf(page, 'Укладка ламината')).toContainText('из замера · пол без санузлов');
    await tile(page, 1).click();
    await expect(grand(page)).toContainText(nb('404 418 ₽'));
  });

  test('сравнение версий: колонки, чипы, итого и разница, строки без изменений', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate' });
    await btn(page, 'Сравнить с версией 1').click();
    const cmp = section(page).getByRole('table', { name: /Сравнение/ });
    await expect(cmp.getByRole('columnheader')).toHaveText([
      'Строка',
      'Версия 1',
      'Версия 2',
      'Разница',
    ]);
    await expect(cmp.getByText('Сборка щитка')).toBeVisible();
    await expect(cmp.getByText('добавлено').first()).toBeVisible();
    await expect(cmp.getByText('убрано').first()).toBeVisible();
    await expect(cmp.getByText('изменено: объём').first()).toBeVisible();
    await expect(cmp.locator('tr[data-row="same"]')).toHaveCount(0);
    const total = cmp.getByRole('row').filter({ hasText: 'Итого' });
    await expect(total).toContainText(nb('404 418 ₽'));
    await expect(total).toContainText(nb('438 175 ₽'));
    await expect(total).toContainText(nb('+33 757 ₽'));
    await btn(page, /^Показать строки без изменений · \d+$/).click();
    await expect(cmp.locator('tr[data-row="same"]').first()).toBeVisible();
    await btn(page, 'Показать смету').click();
    await expect(grand(page)).toContainText('Итого по версии 2');
  });

  test('допработа ДР-1: оценка в черновике (+13 050 ₽), отправка допсоглашения, отзыв, удаление', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate' });
    const orders = section(page).locator('.ox-rp-orders');
    await expect(orders).toContainText('Допработы от прораба');
    await expect(orders).toContainText('ДР-1');
    await expect(orders).toContainText('Перенос розеток на кухне');
    await expect(orders).toContainText('18.10 · 6 шт · фото: 2');
    await expect(orders).toContainText('Ждёт оценки офиса');
    await btn(page, 'Оценить в черновике').click();
    await expect(note(page)).toHaveText(
      'ДР-1 «Перенос розеток на кухне» в черновике версии 3: строки подставлены по описанию прораба. Проверьте объёмы и цены, затем отправьте допсоглашение заказчику.',
    );
    await expectChip(page, 'Версия 3 · черновик');
    await expect(grand(page)).toContainText(nb('451 225 ₽'));
    await expect(tile(page, 3)).toContainText('допсоглашение № 1');
    await expect(rowOf(page, 'Перенос розетки или выключателя')).toContainText('новая');
    await expect(section(page)).toContainText(nb('Версия 2: 438 175 ₽ · разница +13 050 ₽'));
    await btn(page, 'Отправить допсоглашение № 1 на подпись').click();
    await expect(note(page)).toHaveText(
      nb(
        'Допсоглашение № 1 отправлено в кабинет заказчика: +13 050 ₽ к договору. Подпись — кодом из SMS.',
      ),
    );
    await expectChip(page, 'Допсоглашение № 1 у заказчика');
    await expect(tile(page, 3)).toContainText('на подписи');
    await expect(orders).toContainText('В допсоглашении · у заказчика');
    await expect(section(page).getByRole('textbox')).toHaveCount(0);
    await btn(page, 'Отозвать и править').click();
    await expect(note(page)).toContainText('Отправка отозвана');
    await expectChip(page, 'Версия 3 · черновик');
    await btn(page, 'Удалить черновик').click();
    await expect(note(page)).toHaveText('Черновик удалён. ДР-1 снова ждёт оценки.');
    await expectChip(page, 'Версия 2 · действует');
    await expect(orders).toContainText('Ждёт оценки офиса');
  });

  test('допработа: отклонение с причиной (четыре причины), «Отмена»', async ({ app, page }) => {
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate' });
    await btn(page, 'Отклонить').click();
    const why = section(page).getByRole('combobox', { name: 'Причина — прораб её увидит' });
    await expect(why.getByRole('option')).toHaveText([
      'Работа уже есть в смете',
      'Заказчик отказался',
      'Сделаем по гарантии',
      'Не согласовано с заказчиком',
    ]);
    await btn(page, 'Отмена').click();
    await expect(why).toHaveCount(0);
    await btn(page, 'Отклонить').click();
    await why.selectOption({ label: 'Заказчик отказался' });
    await btn(page, 'Отклонить допработу').click();
    await expect(note(page)).toHaveText(
      'ДР-1 отклонена: «Заказчик отказался». Прораб увидит причину во вкладке «Работы».',
    );
    await expect(section(page)).toContainText('Новых допработ нет.');
    await expect(section(page)).toContainText(
      'ДР-1 «Перенос розеток на кухне»: отклонена — заказчик отказался',
    );
    await btn(page, 'Скрыть сообщение').click();
    await expect(note(page)).toHaveCount(0);
  });

  test('правка черновика: объём вручную и «вернуть из замера», цена, раздел, строка из справочника, скидка', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate' });
    await btn(page, 'Изменить через допсоглашение').click();
    await expectChip(page, 'Версия 3 · черновик');
    const before = await grand(page).textContent();
    // объём вручную
    let ok = patched(page);
    await field(page, 'Объём: Укладка ламината').fill('50');
    await field(page, 'Объём: Укладка ламината').press('Tab');
    await ok;
    await expect(rowOf(page, 'Укладка ламината')).toContainText('объём вручную');
    await expect(grand(page)).not.toHaveText(before ?? '');
    ok = patched(page);
    await rowOf(page, 'Укладка ламината')
      .getByRole('button', { name: 'вернуть из замера' })
      .click();
    await ok;
    await expect(rowOf(page, 'Укладка ламината')).toContainText('из замера · пол без санузлов');
    await expect(grand(page)).toHaveText(before ?? '');
    // цена
    ok = patched(page);
    await field(page, 'Цена: Вывоз мусора').fill('7000');
    await field(page, 'Цена: Вывоз мусора').press('Tab');
    await ok;
    await expect(rowOf(page, 'Вывоз мусора')).toContainText(nb('14 000 ₽'));
    // раздел и строка из справочника
    ok = patched(page);
    await section(page).getByRole('textbox', { name: 'Название нового раздела' }).fill('Двери');
    await btn(page, 'Добавить раздел').click();
    await ok;
    await expect(section(page).getByText('Двери', { exact: true })).toBeVisible();
    await expect(section(page)).toContainText(
      'В разделе пока нет строк — добавьте их из справочника.',
    );
    await btn(page, 'Строка из справочника').last().click();
    const search = section(page).getByRole('searchbox', { name: 'Поиск по справочнику расценок' });
    await search.fill('zzzz');
    await expect(section(page)).toContainText(
      'Ничего не найдено. Новые позиции добавляют в «Шаблоны и расценки».',
    );
    await search.fill('Грунтовка');
    ok = patched(page);
    await section(page)
      .getByRole('button', { name: /Грунтовка глубокого проникновения/ })
      .click();
    await ok;
    await expect(rowOf(page, 'Грунтовка глубокого проникновения')).toBeVisible();
    // удаление строки
    ok = patched(page);
    await section(page).getByRole('button', { name: 'Удалить строку: Вывоз мусора' }).click();
    await ok;
    await expect(rowOf(page, 'Вывоз мусора')).toHaveCount(0);
    // скидка
    const was = await grand(page).textContent();
    ok = patched(page);
    await field(page, 'Скидка, процентов').fill('10');
    await field(page, 'Скидка, процентов').press('Tab');
    await ok;
    await expect(grand(page)).not.toHaveText(was ?? '');
    await expect(section(page)).toContainText('скидку даёт любой, кто правит смету');
    // «Скачать PDF» неактивна, как в макете
    await expect(btn(page, 'Скачать PDF')).toBeDisabled();
  });

  test('объём и сразу «Отправить допсоглашение» без Tab: правка сохранена, отправка одним щелчком', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate' });
    await btn(page, 'Изменить через допсоглашение').click();
    await expectChip(page, 'Версия 3 · черновик');
    const ok = patched(page);
    await field(page, 'Объём: Укладка ламината').fill('50');
    // click = mousedown (blur → сохранение) + mouseup + click, как у человека
    await btn(page, 'Отправить допсоглашение № 1 на подпись').click();
    await ok;
    await expectChip(page, 'Допсоглашение № 1 у заказчика');
    await expect(tile(page, 3)).toContainText('на подписи');
  });
  test('дом в Истре: нет сметы — замер, четыре шаблона, суммы по шаблонам, сборка черновика', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.istra, tab: 'estimate' });
    await expectChip(page, 'Сметы нет');
    await expect(section(page)).toContainText(
      'Черновик собирается по шаблону: объёмы считаются из замера, цены берутся из справочника расценок. Править смету могут владелец, сметчик, менеджер заявки и замерщик.',
    );
    await expect(section(page)).toContainText(/Замер \d\d\.\d\d: 8 помещений · пол /);
    const group = section(page).getByRole('radiogroup', { name: 'Шаблон для черновика сметы' });
    await expect(group.getByRole('radio')).toHaveCount(4);
    await expect(group.getByRole('radio', { checked: true })).toContainText(
      'Ремонт под ключ · дом',
    );
    await expect(group.getByRole('radio', { checked: true })).toContainText(
      'Подходит к виду «ремонт под ключ»',
    );
    const total = section(page).locator('.ox-rp-create strong');
    await expect(total).toHaveText(nb('1 078 533 ₽'));
    await group.getByRole('radio', { name: /Капитальный ремонт квартиры/ }).click();
    await expect(total).toHaveText(nb('857 713 ₽'));
    await group.getByRole('radio', { name: /Косметический ремонт/ }).click();
    await expect(total).toHaveText(nb('308 600 ₽'));
    await group.getByRole('radio', { name: /Коммерческое помещение/ }).click();
    await expect(total).toHaveText(nb('830 345 ₽'));
    await group.getByRole('radio', { name: /Ремонт под ключ · дом/ }).click();
    await btn(page, 'Собрать черновик сметы').click();
    await expect(note(page)).toContainText('Черновик собран по шаблону «Ремонт под ключ · дом»:');
    await expectChip(page, 'Версия 1 · черновик');
    await expect(grand(page)).toContainText(nb('1 078 533 ₽'));
    await expect(section(page)).toContainText(
      'До договора смета согласуется версиями: заказчик видит отправленную версию в кабинете и согласует её. Согласованная версия не меняется, правка — новая версия.',
    );
    await expect(section(page).getByRole('button', { name: 'График по этапам сметы' })).toHaveCount(
      0,
    );
  });

  test('до договора: отправка в кабинет, согласие заказчика, «Новая версия сметы»', async ({
    app,
    page,
  }) => {
    const at = await openRepair(app, page, { obj: OBJ.istra, tab: 'estimate' });
    await btn(page, 'Собрать черновик сметы').click();
    await expectChip(page, 'Версия 1 · черновик');
    await btn(page, 'Отправить заказчику в кабинет').click();
    await expect(note(page)).toHaveText('Версия 1 отправлена в кабинет заказчика на согласование.');
    await expectChip(page, 'Версия 1 у заказчика');
    await btn(page, 'Отозвать и править').click();
    await expectChip(page, 'Версия 1 · черновик');
    await btn(page, 'Отправить заказчику в кабинет').click();
    await expectChip(page, 'Версия 1 у заказчика');
    await approveByClient(page, at, 1);
    await page.reload();
    await expectChip(page, 'Версия 1 · согласована');
    await expect(tile(page, 1)).toContainText('согласована');
    await btn(page, 'Новая версия сметы').click();
    await expectChip(page, 'Версия 2 · черновик');
    await expect(tile(page, 2)).toContainText('новая версия');
    await expect(section(page)).toContainText(
      'Новая версия до договора: после отправки заказчик согласует её в кабинете.',
    );
    await btn(page, 'Удалить черновик').click();
    await expect(note(page)).toHaveText('Черновик удалён.');
    await expectChip(page, 'Версия 1 · согласована');
  });

  test('«Сохранить объект как шаблон»: уведомление и «Открыть шаблон»', async ({ app, page }) => {
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate' });
    await btn(page, 'Сохранить объект как шаблон').click();
    await expect(note(page)).toContainText(
      'Шаблон «По объекту «ЖК Речной · квартира 42»» сохранён:',
    );
    await expect(btn(page, 'Открыть шаблон')).toBeVisible();
    await expect(btn(page, 'График по этапам сметы')).toBeVisible();
  });

  test('сданный объект: смета только для просмотра; прораб: вкладки «Смета» нет', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.mytishchi, tab: 'estimate' });
    await expect(section(page).getByRole('group', { name: 'Версии сметы' })).toBeVisible();
    await expect(btn(page, 'Изменить через допсоглашение')).toHaveCount(0);
    await expect(section(page).getByRole('textbox')).toHaveCount(0);
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate', persona: 'foreman' });
    await expect(page.getByRole('tab', { name: 'Смета' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Замер/ })).toBeVisible();
  });

  test('ошибка загрузки с «Повторить»; нет связи при отправке; конфликт версии при правке', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, {
      obj: OBJ.kv42,
      tab: 'estimate',
      scenario: 'listEstimates=rate_limited',
    });
    await expect(page.getByRole('alert')).toHaveText(
      'Не удалось загрузить смету: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(section(page).getByRole('group', { name: 'Версии сметы' })).toBeVisible();
    await btn(page, 'Изменить через допсоглашение').click();
    await expectChip(page, 'Версия 3 · черновик');
    await devScenario(page, { scenario: 'sendEstimate=offline' });
    await btn(page, 'Отправить допсоглашение № 1 на подпись').click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expectChip(page, 'Версия 3 · черновик');
    await devScenario(page, { scenario: 'updateEstimateDraft=revision_mismatch' });
    await field(page, 'Скидка, процентов').fill('5');
    await field(page, 'Скидка, процентов').press('Tab');
    await expect(toast(page)).toBeVisible();
  });

  test('клавиатура: Tab обходит версии, допработы и действия; фокус виден', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate' });
    const target = btn(page, 'Изменить через допсоглашение');
    await expect(target).toBeVisible();
    // Начинаем с первой кнопки вкладки: оболочка (меню, шапка) своих проверок клавиатуры уже имеет.
    await btn(page, 'Оценить в черновике').focus();
    let reached = false;
    const seen = new Set<string>();
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      seen.add(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect({ reached, seen: [...seen] }).toMatchObject({ reached: true });
    expect([...seen].some((s) => s.includes('Отклонить'))).toBe(true);
    expect([...seen].some((s) => s.includes('Сравнить с версией 1'))).toBe(true);
    expect([...seen].some((s) => s.includes('Версия 2'))).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  });

  test('axe без serious; 390 — без горизонтальной прокрутки страницы, цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate' });
    await expect(grand(page)).toBeVisible();
    await btn(page, 'Сравнить с версией 1').click();
    await expect(section(page).getByRole('table', { name: /Сравнение/ })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      for (const name of [
        'Показать смету',
        'Изменить через допсоглашение',
        'Сохранить объект как шаблон',
      ]) {
        const b = btn(page, name);
        if (await b.count()) expect(await hitHeight(b.first())).toBeGreaterThanOrEqual(44);
      }
      expect(await hitHeight(tile(page, 1))).toBeGreaterThanOrEqual(44);
      const wrap = section(page).locator('.ox-rp-tablewrap').first();
      expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
  });
});

// Backend смет — W6.12 (ws/W6.12 не в main на 26.10.2026): listEstimates, createEstimateFromTemplate, updateEstimateDraft,
// sendEstimate, recallEstimate, diffEstimates, saveProjectAsTemplate. До него — fixme.
// Стенд: backend замера и смет W6.12 в main. Объект, замер, смета и согласие заказчика — командами API
// (repair.stand.ts); страница читает настоящий backend. Допработы прораба (фото на стенде не загружаются: у Files нет
// родителя «repairs/project») проверяет mock-блок выше.
test.describe('repair-estimate — «Смета» @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(180_000);

  type Fx = { undo: Undo; session: () => Promise<Session> };

  /** Объект и вкладка «Смета» персонажа; `contract` — смета версии 1 согласована, иначе только замер. */
  async function openEstimate(
    app: Parameters<typeof openPage>[0],
    page: Page,
    project: string,
    o: { contract?: boolean; persona?: 'owner' | 'foreman'; fx?: Fx } = {},
  ): Promise<StandObject> {
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    const obj =
      o.contract === false
        ? await repairObject(page, tenant, project)
        : await contractedObject(page, tenant, project);
    if (o.contract === false) await measure(page, obj);
    const persona = o.persona ?? 'owner';
    if (persona === 'foreman' && o.fx) {
      const owner = await o.fx.session();
      await owner.open('/', 'owner');
      await grantForeman(owner.page, obj, o.fx.undo);
    }
    await app(`/t/${tenant}/repair?obj=${obj.id}&tab=estimate`, { persona });
    // У прораба вкладки «Смета» нет (нет права на финансы): ждём вкладки объекта, а не саму смету.
    if (persona === 'foreman')
      await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 30_000 });
    else await expect(section(page)).toBeVisible({ timeout: 30_000 });
    return obj;
  }

  test('владелец на стенде: версия 1 действует — пояснение, плитки версий, итого, строки «из замера»', async ({
    app,
    page,
  }, testInfo) => {
    await openEstimate(app, page, testInfo.project.name);
    await expect(section(page).getByRole('heading', { level: 2, name: 'Смета' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(section(page)).toContainText(
      'Действует согласованная версия — основа договора. Изменения после договора проходят допсоглашением: прораб предлагает допработу, офис оценивает её в смете, заказчик подписывает кодом из SMS.',
    );
    await expectChip(page, 'Версия 1 · действует');
    await expect(tile(page, 1)).toContainText('действует');
    await expect(tile(page, 1)).toHaveAttribute('aria-pressed', 'true');
    await expect(grand(page)).toContainText('Итого по версии 1');
    await expect(rowOf(page, 'Демонтаж напольного покрытия')).toContainText(
      'из замера · площадь пола',
    );
    await expect(rowOf(page, 'Штукатурка по маякам')).toContainText(
      'из замера · стены без санузлов',
    );
  });

  test('владелец на стенде: правка через допсоглашение — версия 2, сравнение версий и «Показать смету»', async ({
    app,
    page,
  }, testInfo) => {
    await openEstimate(app, page, testInfo.project.name);
    await btn(page, 'Изменить через допсоглашение').click();
    await expectChip(page, 'Версия 2 · черновик');
    const ok = patched(page);
    await field(page, 'Объём: Вывоз мусора').fill('4');
    await field(page, 'Объём: Вывоз мусора').press('Tab');
    await ok;
    await btn(page, 'Сравнить с версией 1').click();
    const cmp = section(page).getByRole('table', { name: /Сравнение/ });
    await expect(cmp.getByRole('columnheader')).toHaveText([
      'Строка',
      'Версия 1',
      /^Версия 2/,
      'Разница',
    ]);
    await expect(cmp.getByText('изменено: объём').first()).toBeVisible();
    await expect(cmp.getByRole('row').filter({ hasText: 'Итого' })).toContainText('+');
    await btn(page, /^Показать строки без изменений · \d+$/).click();
    await expect(cmp.locator('tr[data-row="same"]').first()).toBeVisible();
    await btn(page, 'Показать смету').click();
    await expect(grand(page)).toContainText('Итого по версии 2');
  });

  test('владелец на стенде: правка черновика — объём вручную и «вернуть из замера», цена, раздел, строка из справочника, скидка', async ({
    app,
    page,
  }, testInfo) => {
    await openEstimate(app, page, testInfo.project.name);
    await btn(page, 'Изменить через допсоглашение').click();
    await expectChip(page, 'Версия 2 · черновик');
    const before = await grand(page).textContent();
    let ok = patched(page);
    await field(page, 'Объём: Демонтаж напольного покрытия').fill('50');
    await field(page, 'Объём: Демонтаж напольного покрытия').press('Tab');
    await ok;
    await expect(rowOf(page, 'Демонтаж напольного покрытия')).toContainText('объём вручную');
    await expect(grand(page)).not.toHaveText(before ?? '');
    ok = patched(page);
    await rowOf(page, 'Демонтаж напольного покрытия')
      .getByRole('button', { name: 'вернуть из замера' })
      .click();
    await ok;
    await expect(rowOf(page, 'Демонтаж напольного покрытия')).toContainText(
      'из замера · площадь пола',
    );
    await expect(grand(page)).toHaveText(before ?? '');
    ok = patched(page);
    await field(page, 'Цена: Вывоз мусора').fill('7000');
    await field(page, 'Цена: Вывоз мусора').press('Tab');
    await ok;
    await expect(rowOf(page, 'Вывоз мусора')).toContainText(nb('14 000 ₽'));
    ok = patched(page);
    await section(page).getByRole('textbox', { name: 'Название нового раздела' }).fill('Двери');
    await btn(page, 'Добавить раздел').click();
    await ok;
    await expect(section(page).getByText('Двери', { exact: true })).toBeVisible();
    await expect(section(page)).toContainText(
      'В разделе пока нет строк — добавьте их из справочника.',
    );
    await btn(page, 'Строка из справочника').last().click();
    const search = section(page).getByRole('searchbox', { name: 'Поиск по справочнику расценок' });
    await search.fill('zzzz');
    await expect(section(page)).toContainText(
      'Ничего не найдено. Новые позиции добавляют в «Шаблоны и расценки».',
    );
    await search.fill('Монтаж плинтуса');
    ok = patched(page);
    await section(page).locator('.ox-rp-pickbtn', { hasText: 'Монтаж плинтуса' }).click();
    await ok;
    await expect(rowOf(page, 'Монтаж плинтуса')).toBeVisible();
    ok = patched(page);
    await section(page).getByRole('button', { name: 'Удалить строку: Вывоз мусора' }).click();
    await ok;
    await expect(rowOf(page, 'Вывоз мусора')).toHaveCount(0);
    const was = await grand(page).textContent();
    ok = patched(page);
    await field(page, 'Скидка, процентов').fill('10');
    await field(page, 'Скидка, процентов').press('Tab');
    await ok;
    await expect(grand(page)).not.toHaveText(was ?? '');
    await expect(section(page)).toContainText('скидку даёт любой, кто правит смету');
    await expect(btn(page, 'Скачать PDF')).toBeDisabled();
  });

  test('владелец на стенде: до договора — замер, шаблоны, сборка черновика, отправка, отзыв, согласие заказчика, новая версия', async ({
    app,
    page,
  }, testInfo) => {
    const obj = await openEstimate(app, page, testInfo.project.name, { contract: false });
    await expectChip(page, 'Сметы нет');
    await expect(section(page)).toContainText(
      'Черновик собирается по шаблону: объёмы считаются из замера, цены берутся из справочника расценок. Править смету могут владелец, сметчик, менеджер заявки и замерщик.',
    );
    await expect(section(page)).toContainText(/Замер \d\d\.\d\d: 3 помещения · пол /);
    const group = section(page).getByRole('radiogroup', { name: 'Шаблон для черновика сметы' });
    expect(await group.getByRole('radio').count()).toBeGreaterThanOrEqual(3);
    const total = section(page).locator('.ox-rp-create strong');
    await expect(total).toContainText('₽');
    await btn(page, 'Собрать черновик сметы').click();
    await expect(note(page)).toContainText(/Черновик собран по шаблону «.+»:/);
    await expectChip(page, 'Версия 1 · черновик');
    await btn(page, 'Отправить заказчику в кабинет').click();
    await expect(note(page)).toHaveText('Версия 1 отправлена в кабинет заказчика на согласование.');
    await expectChip(page, 'Версия 1 у заказчика');
    await btn(page, 'Отозвать и править').click();
    await expectChip(page, 'Версия 1 · черновик');
    await btn(page, 'Отправить заказчику в кабинет').click();
    await expectChip(page, 'Версия 1 у заказчика');
    await approveByClient(page, { tenant: obj.tenant, project: obj.id }, 1);
    await page.reload();
    await expectChip(page, 'Версия 1 · действует');
    await expect(tile(page, 1)).toContainText('действует');
  });

  test('владелец на стенде: «Сохранить объект как шаблон» — уведомление и «Открыть шаблон»', async ({
    app,
    page,
  }, testInfo) => {
    const obj = await openEstimate(app, page, testInfo.project.name);
    await btn(page, 'Сохранить объект как шаблон').click();
    await expect(note(page)).toContainText(`Шаблон «По объекту «${obj.name}»» сохранён:`);
    await expect(btn(page, 'Открыть шаблон')).toBeVisible();
    await expect(btn(page, 'График по этапам сметы')).toBeVisible();
  });

  test('прораб на стенде: вкладки «Смета» нет, «Замер» есть', async ({
    app,
    page,
    undo,
    session,
  }, testInfo) => {
    await openEstimate(app, page, testInfo.project.name, {
      persona: 'foreman',
      fx: { undo, session },
    });
    await expect(page.getByRole('tab', { name: /^Замер/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: 'Смета' })).toHaveCount(0);
  });

  test('владелец на стенде: нет связи при отправке — тост, версия остаётся черновиком', async ({
    app,
    page,
    context,
  }, testInfo) => {
    await openEstimate(app, page, testInfo.project.name, { contract: false });
    await btn(page, 'Собрать черновик сметы').click();
    await expectChip(page, 'Версия 1 · черновик');
    await context.setOffline(true);
    await btn(page, 'Отправить заказчику в кабинет').click();
    await expect(toast(page)).toHaveText(OFFLINE, { timeout: 20_000 });
    await context.setOffline(false);
    await expectChip(page, 'Версия 1 · черновик');
  });

  test('владелец на стенде: клавиатура — Tab обходит версии и действия; фокус виден', async ({
    app,
    page,
  }, testInfo) => {
    await openEstimate(app, page, testInfo.project.name);
    const target = btn(page, 'Изменить через допсоглашение');
    await expect(target).toBeVisible({ timeout: 30_000 });
    await tile(page, 1).focus();
    let reached = false;
    const seen = new Set<string>();
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      seen.add(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect({ reached, seen: [...seen] }).toMatchObject({ reached: true });
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  });

  test('владелец на стенде: axe без serious; 390 — без горизонтальной прокрутки страницы, цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }, testInfo) => {
    await openEstimate(app, page, testInfo.project.name);
    await expect(grand(page)).toBeVisible({ timeout: 30_000 });
    // Таблица согласованной версии без полей ввода не доступна с клавиатуры на 390 (axe scrollable-region-focusable,
    // область .ox-rp-tablewrap — см. отчёт W2.103): axe проверяется на черновике, где в таблице есть поля.
    await btn(page, 'Изменить через допсоглашение').click();
    await expectChip(page, 'Версия 2 · черновик');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      expect(await hitHeight(tile(page, 1))).toBeGreaterThanOrEqual(44);
      expect(await hitHeight(btn(page, /^Отправить допсоглашение/))).toBeGreaterThanOrEqual(44);
      const wrap = section(page).locator('.ox-rp-tablewrap').first();
      expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
  });
});
