// W1.20 · Сверка баннеров оболочки со снимком design-stage-1 («Ортус CRM.dc.html» :174–180, bannersVM
// :3083–3098, LINE :2304). Визуальные спеки оболочки закрывают #ox-main маской, поэтому баннеры сверяются здесь
// отдельно: вычисленные стили контейнера, текста, заголовка, иконки и кнопки и пиксели элемента баннера
// (verification-protocol.md §3, PD-22: 0,01). «Нет связи.» — эталон и реализация офлайн (context.setOffline,
// эталон слушает navigator.onLine :2385). «Место организации заполнено.» — эталон: лимит 25 ГБ при занятых
// 46,2 ГБ через «Модули и место» (:2683–2705), затем «Главная»; реализация — пресет storage-full.
import { comparePng, hidePanel, setPersona } from '@ortus/e2e-kit';
import type { Locator, Page, TestInfo } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { devScenario } from '../shell.helpers.ts';

const OFFLINE = 'Нет связи.';
const STORAGE = 'Место организации заполнено.';
const STORAGE_OTHER =
  'Новые загрузки ограничены. Фото текущей смены сохраняются в пределах временного резерва.';
const OPEN_MODULES = 'Открыть «Модули и место»';

/** Баннер основной области по заголовку (strong): в эталоне и в реализации — role status/alert в #ox-main. */
const banner = (page: Page, title: string): Locator =>
  page
    .locator('#ox-main')
    .locator('[role="status"], [role="alert"]')
    .filter({ has: page.locator('strong', { hasText: title }) })
    .first();

const BOX = [
  'display',
  'flex-wrap',
  'align-items',
  'row-gap',
  'column-gap',
  'padding',
  'border-radius',
  'border-top-width',
  'border-top-color',
  'background-color',
  'color',
  'font-size',
  'line-height',
] as const;
const BODY = [
  'font-size',
  'line-height',
  'font-weight',
  'text-wrap-style',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'min-width',
] as const;
const TITLE = ['font-size', 'line-height', 'font-weight'] as const;
const ICON = ['font-size', 'width', 'height'] as const;
const BUTTON = [
  'display',
  'align-items',
  'min-height',
  'padding',
  'border-top-width',
  'border-top-color',
  'border-radius',
  'background-color',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
] as const;

type Styles = Record<string, Record<string, string>>;

/** Вычисленные стили частей баннера: контейнер, текст (родитель strong), заголовок, иконка, кнопка. */
async function stylesOf(root: Locator): Promise<Styles> {
  return root.evaluate(
    (el, keys) => {
      const pick = (node: Element | null | undefined, list: readonly string[]) => {
        if (!node) return { missing: 'yes' };
        const s = getComputedStyle(node);
        const out: Record<string, string> = {};
        for (const k of list) out[k] = s.getPropertyValue(k);
        if (list.includes('width')) {
          const r = node.getBoundingClientRect();
          out.width = `${Math.round(r.width)}px`;
          out.height = `${Math.round(r.height)}px`;
        }
        return out;
      };
      const title = el.querySelector('strong');
      const res: Record<string, Record<string, string>> = {
        box: pick(el, keys.box),
        body: pick(title?.parentElement, keys.body),
        title: pick(title, keys.title),
        icon: pick(el.querySelector('.material-symbols-rounded'), keys.icon),
      };
      const button = el.querySelector('button');
      if (button) res.button = pick(button, keys.button);
      return res;
    },
    { box: BOX, body: BODY, title: TITLE, icon: ICON, button: BUTTON },
  );
}

/** Пиксели элемента баннера в допуске 0,01; размеры — до пикселя. */
async function compareBanner(
  impl: Locator,
  ref: Locator,
  key: string,
  testInfo: TestInfo,
): Promise<void> {
  const [a, b] = [await impl.boundingBox(), await ref.boundingBox()];
  expect(
    { width: Math.round(a?.width ?? 0), height: Math.round(a?.height ?? 0) },
    'размер баннера',
  ).toEqual({ width: Math.round(b?.width ?? 0), height: Math.round(b?.height ?? 0) });
  const act = await impl.screenshot({ animations: 'disabled', caret: 'hide' });
  const exp = await ref.screenshot({ animations: 'disabled', caret: 'hide' });
  await testInfo.attach(`${key}-expected.png`, { body: exp, contentType: 'image/png' });
  await testInfo.attach(`${key}-actual.png`, { body: act, contentType: 'image/png' });
  const r = comparePng(act, exp, { maxDiffPixelRatio: 0.01 });
  if (!r.pass) await testInfo.attach(`${key}-diff.png`, { body: r.diff, contentType: 'image/png' });
  console.log(`visual ${key}: ${r.diffPixels} px, ${r.ratio}`);
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
}

/** Шрифты (в том числе Material Symbols) загружены до отключения сети. */
const fontsReady = (page: Page) => page.evaluate(async () => document.fonts.ready.then(() => true));

test.describe('shell — баннеры по эталону @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сверка с эталоном — режим mock');

  test('«Нет связи.»: стили и пиксели баннера как в эталоне (:174–180)', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await fontsReady(ref.page);
    await ref.page.context().setOffline(true);
    const refBanner = banner(ref.page, OFFLINE);
    await expect(refBanner).toBeVisible();

    await app('/', { persona: 'owner' });
    await expect(page.locator('.ox-nav-item').first()).toBeAttached();
    await page.waitForLoadState('networkidle');
    await fontsReady(page);
    await page.context().setOffline(true);
    const implBanner = banner(page, OFFLINE);
    await expect(implBanner).toBeVisible();

    expect(await stylesOf(implBanner)).toEqual(await stylesOf(refBanner));
    await compareBanner(implBanner, refBanner, `banner-offline-${testInfo.project.name}`, testInfo);
  });

  test('«Место организации заполнено.»: стили кнопки «Открыть «Модули и место»» и пиксели как в эталоне (:178)', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    const go = (label: RegExp) =>
      ref.page.getByRole('button', { name: label }).filter({ visible: true }).first().click();
    await go(/^(Модули и место|Модули)$/);
    await ref.page.getByLabel('Лимит места').selectOption('25');
    await ref.page.getByRole('button', { name: 'Изменить лимит' }).click();
    await ref.page.getByLabel('Понимаю: новые загрузки будут недоступны').check();
    await ref.page.getByRole('button', { name: 'Всё равно применить' }).click();
    await expect(banner(ref.page, STORAGE)).toBeVisible();
    await go(/^Главная$/);
    const refBanner = banner(ref.page, STORAGE);
    await expect(refBanner.getByRole('button', { name: OPEN_MODULES })).toBeVisible();
    await ref.page.mouse.move(0, 0);

    await app('/', { persona: 'owner' });
    await devScenario(page, { preset: 'storage-full' });
    await page.reload();
    const implBanner = banner(page, STORAGE);
    await expect(implBanner.getByRole('button', { name: OPEN_MODULES })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.mouse.move(0, 0);

    expect(await stylesOf(implBanner)).toEqual(await stylesOf(refBanner));
    await compareBanner(implBanner, refBanner, `banner-storage-${testInfo.project.name}`, testInfo);
  });

  // bannersVM :3096: сотрудник видит баннер с текстом «Новые загрузки ограничены. …» и без кнопки. Эталон: лимит
  // 25 ГБ владельцем, затем персонаж «Водитель» в демо-панели; реализация — пресет storage-full, водитель.
  test('«Место организации заполнено.» у водителя: текст сотрудника, стили и пиксели как в эталоне (:3096)', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    const ref = await reference(undefined, { persona: 'owner' });
    const go = (label: RegExp) =>
      ref.page.getByRole('button', { name: label }).filter({ visible: true }).first().click();
    await go(/^(Модули и место|Модули)$/);
    await ref.page.getByLabel('Лимит места').selectOption('25');
    await ref.page.getByRole('button', { name: 'Изменить лимит' }).click();
    await ref.page.getByLabel('Понимаю: новые загрузки будут недоступны').check();
    await ref.page.getByRole('button', { name: 'Всё равно применить' }).click();
    await expect(banner(ref.page, STORAGE)).toBeVisible();
    await setPersona(ref, 'driver');
    await hidePanel(ref);
    const refBanner = banner(ref.page, STORAGE);
    await expect(refBanner).toContainText(STORAGE_OTHER);
    await ref.page.mouse.move(0, 0);

    await app('/', { persona: 'driver' });
    await devScenario(page, { preset: 'storage-full' });
    await page.reload();
    const implBanner = banner(page, STORAGE);
    await expect(implBanner).toContainText(STORAGE_OTHER);
    await expect(implBanner.getByRole('button')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await page.mouse.move(0, 0);

    expect(await stylesOf(implBanner)).toEqual(await stylesOf(refBanner));
    await compareBanner(
      implBanner,
      refBanner,
      `banner-storage-driver-${testInfo.project.name}`,
      testInfo,
    );
  });

  test('строка события «Уведомления» — граница #F0F2EE (:129)', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await page
      .getByRole('banner')
      .getByRole('button', { name: /^Уведомления/ })
      .click();
    const row = page.getByRole('dialog', { name: 'Уведомления' }).locator('.ox-inbox-item').first();
    await expect(row).toBeVisible();
    await expect(row).toHaveCSS('border-bottom-color', 'rgb(240, 242, 238)');
  });

  test('«Прочитать все» без непрочитанных — активна и цвета акцента, как в эталоне (:126)', async ({
    app,
    page,
    reference,
  }) => {
    const ref = await reference(undefined, { persona: 'driver', hidePanel: true });
    await ref.page
      .getByRole('banner')
      .getByRole('button', { name: /^Уведомления/ })
      .click();
    const refRead = ref.page
      .getByRole('dialog', { name: 'Уведомления' })
      .getByRole('button', { name: 'Прочитать все' });
    await expect(refRead).toBeEnabled();

    await app('/', { persona: 'driver' });
    await page
      .getByRole('banner')
      .getByRole('button', { name: /^Уведомления/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Уведомления' });
    await expect(dialog).toContainText('Новых событий нет');
    const read = dialog.getByRole('button', { name: 'Прочитать все' });
    await expect(read).toBeEnabled();
    const pick = (b: Element) => {
      const s = getComputedStyle(b);
      return { color: s.color, opacity: s.opacity, cursor: s.cursor };
    };
    expect(await read.evaluate(pick)).toEqual(await refRead.evaluate(pick));
  });
});
