// Самотест e2e-харнесса (W0.05, бриф §6(б)): эталон design/ открывается фикстурой reference(file)
// офлайн, панель демонстрации дословно, часы и локаль, labels, эталон ↔ эталон = 0 пикселей,
// сверка с другим экраном краснеет «по делу». Проекты mobile-390 и desktop-1440.
import { fileURLToPath } from 'node:url';

import {
  FLAG_LABEL,
  MAIN_REFERENCE,
  PANEL,
  PERSONA_LABEL,
  PERSONAS,
  WIDTH_LABEL,
  WIDTHS,
} from '@ortus/e2e-kit';

import { expect, test } from '../fixtures/index.ts';
import { hitHeight, openPage } from '../modules.helpers.ts';
import { matchReference } from './match-reference.ts';

const ICON_FONT = fileURLToPath(
  new URL('../../../../packages/tokens/fonts/material-symbols-rounded.woff2', import.meta.url),
);

test.describe('самотест харнесса', { tag: '@harness' }, () => {
  test('H1 reference(file) открывает каждый .dc.html эталона', async ({
    reference,
    referenceFiles,
  }) => {
    // W2.81: в снимке эталона 19.10 23 файла .dc.html (в design-stage-1 и design-stage-2 — 6): обход всех не
    // укладывается в 30 с и одним воркером (27–31 с). Время теста — по числу файлов, не меньше таймаута проекта.
    test.setTimeout(Math.max(test.info().timeout, referenceFiles.length * 4_000));
    expect(referenceFiles).toContain(MAIN_REFERENCE);
    expect(referenceFiles.length).toBeGreaterThanOrEqual(5);
    for (const file of referenceFiles) {
      const t = await reference(file);
      await expect(t.root.locator(':scope > .sc-host'), file).toBeVisible();
      await expect(t.page.locator('.sc-logic-error'), file).toHaveCount(0);
      expect(t.net.pageErrors(), file).toEqual([]);
      await t.page.context().close();
    }
  });

  test('H2 эталон офлайн: главный файл без внешних запросов и ошибок консоли', async ({
    reference,
  }) => {
    const t = await reference(MAIN_REFERENCE);
    expect(t.net.external()).toEqual([]);
    expect(t.net.consoleErrors()).toEqual([]);
    expect([...t.net.hosts()].every((h) => h.startsWith('127.0.0.1:'))).toBe(true);
  });

  test('H3 панель демонстрации дословно', async ({ reference }) => {
    const t = await reference(MAIN_REFERENCE);
    const panel = t.page.getByRole('region', { name: 'Панель демонстрации' });
    await expect(panel).toBeVisible();
    const persona = panel.getByLabel('Персонаж');
    const options = await persona
      .locator('option')
      .evaluateAll((os) =>
        os.map((o) => [(o as HTMLOptionElement).value, o.textContent?.trim() ?? '']),
      );
    expect(options).toEqual(PERSONAS.map((p) => [p, PERSONA_LABEL[p]]));
    const widths = await panel
      .getByLabel('Ширина')
      .locator('option')
      .evaluateAll((os) => os.map((o) => o.textContent?.trim() ?? ''));
    expect(widths).toEqual(WIDTHS.map((w) => WIDTH_LABEL[w]));
    for (const label of Object.values(FLAG_LABEL)) {
      await expect(panel.getByLabel(label)).toBeVisible();
    }
  });

  test('H4 персонаж эталона выбирается по value с ожиданием «Загрузка»', async ({ reference }) => {
    const t = await reference(MAIN_REFERENCE, { persona: 'driver' });
    await expect(t.page.getByLabel('Персонаж')).toHaveValue('driver');
    await expect(t.page.getByRole('status', { name: 'Загрузка' })).toHaveCount(0);
    await expect(t.page.locator('[aria-current="page"]')).toContainText('Сегодня');
  });

  test('H5 часы 10:30 по Москве и локаль ru-RU', async ({ reference }) => {
    const t = await reference(MAIN_REFERENCE);
    const [time, offset, number] = await t.page.evaluate(() => [
      new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      new Date().getTimezoneOffset(),
      new Intl.NumberFormat('ru-RU').format(84370),
    ]);
    expect(time).toBe('10:30');
    expect(offset).toBe(-180);
    expect(number).toBe('84\u00A0370');
  });

  test('H6 hidePanel скрывает панель, ширина #dc-root = viewport', async ({ reference }) => {
    const t = await reference(MAIN_REFERENCE, { hidePanel: true });
    await expect(t.page.locator(PANEL)).toBeHidden();
    await expect(t.root).toBeVisible();
    const width = await t.root.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBe(t.page.viewportSize()?.width);
  });

  test('H7 collectLabels: навигация есть, панели нет', async ({ reference, labels }, testInfo) => {
    const t = await reference(MAIN_REFERENCE);
    const list = await labels(t.root);
    const nav =
      testInfo.project.name === 'mobile-390' ? 'aria:Навигация' : 'aria:Основная навигация';
    expect(list).toContain(nav);
    for (const banned of ['Персонаж', 'Путь проверки', 'Сбросить', 'Ширина']) {
      expect(
        list.some((l) => l.includes(banned)),
        banned,
      ).toBe(false);
    }
  });

  test('H8 эталон ↔ эталон в двух контекстах = 0 пикселей', async ({ reference }, testInfo) => {
    const a = await reference(MAIN_REFERENCE, { hidePanel: true });
    const b = await reference(MAIN_REFERENCE, { hidePanel: true });
    const r = await matchReference(a, b, 'harness-self', testInfo, { maxDiffPixelRatio: 0 });
    expect(r.diffPixels).toBe(0);
  });

  test('H9 matchReference краснеет «по делу» и прикладывает снимки', async ({
    reference,
  }, testInfo) => {
    const ref = await reference(MAIN_REFERENCE, { hidePanel: true });
    const other = await reference('Дизайн-система.dc.html');
    await expect(matchReference(other, ref, 'harness-red', testInfo)).rejects.toThrow(
      /maxDiffPixelRatio 0\.01/,
    );
    const names = testInfo.attachments.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining(['harness-red-expected.png', 'harness-red-actual.png']),
    );
  });

  test('H10 runAxe на эталоне: числа и нарушения, панель исключена', async ({ reference, axe }) => {
    const t = await reference(MAIN_REFERENCE);
    const r = await axe(t.page, { exclude: [PANEL] });
    expect(typeof r.serious).toBe('number');
    expect(typeof r.critical).toBe('number');
    expect(Array.isArray(r.violations)).toBe(true);
    const targets = r.violations.flatMap((v) => v.nodes.flatMap((n) => n.target.map(String)));
    expect(targets.some((s) => s.includes('Панель демонстрации'))).toBe(false);
  });

  test('H11 app(route, { persona }) — dev-вход ?persona= (PD-54)', async ({ app }) => {
    // Режим mock: dev-вход обслуживает MSW-сценарный сервер W0.13; stand — dev-провайдер cmd/api W0.09.
    const t = await app('/t/t-alta/home', { persona: 'owner' });
    await expect(t.root).toBeVisible();
    await expect(t.page.locator('html')).toHaveAttribute('data-e2e-persona', 'owner');
  });

  // W2.81, возврат 1: под нагрузкой шрифт иконок (Material Symbols) догружается после отрисовки страницы; до него
  // лигатура «drive_file_move» — широкий текст, он перекрывает центр соседней кнопки-иконки, и hitHeight
  // «Переименовать «Север Логистик»» на 390 давал 23 px вместо 44 (company-structure.spec.ts:412). Задержка шрифта
  // догружающийся шрифт воспроизводится без нагрузки: после открытия страницы тот же шрифт подключается ещё раз
  // по адресу, который отвечает через 3 с (последняя @font-face семейства главнее, font-display: block —
  // лигатуры раскладываются запасным шрифтом). hitHeight меряет только после загрузки шрифтов.
  test('H12 hitHeight меряет после загрузки шрифта иконок', async ({ app, page, harness }) => {
    test.skip(harness.mode !== 'mock', 'сид «Структуры» — сценарный сервер mock');
    test.skip((page.viewportSize()?.width ?? 0) >= 640, 'кнопки-иконки «Структуры» — на телефоне');
    await page.route('**/__w281-slow-icons.woff2', async (route) => {
      await new Promise((r) => setTimeout(r, 3_000));
      await route.fulfill({ path: ICON_FONT, contentType: 'font/woff2' });
    });
    await openPage(app, page, 'structure');
    const rename = page.getByRole('button', { name: 'Переименовать «Север Логистик»' });
    await expect(rename).toBeVisible();
    await page.evaluate(() => {
      const face = new FontFace(
        'Material Symbols Rounded',
        "url('/__w281-slow-icons.woff2') format('woff2')",
        { style: 'normal', weight: '100 700', display: 'block' },
      );
      document.fonts.add(face);
      face.load().catch(() => undefined);
    });
    expect(await page.evaluate(() => document.fonts.status)).toBe('loading');
    expect(await hitHeight(rename)).toBeGreaterThanOrEqual(44);
  });
});
