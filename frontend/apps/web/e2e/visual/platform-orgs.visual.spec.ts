// W1.25 · Визуальная сверка `platform-orgs` и `platform-org-card` со снимком design-stage-1 (verification-protocol.md
// §3, PD-22: 0,01): область страницы `#ox-main` оператора — список и карточка «Альта Групп», выбранной по умолчанию.
// W4.84: данные W4.60 — как в эталоне, эталон не приводится (allowlist/platform-orgs.md).
// `#ox-main` — область прокрутки оболочки: снимок берёт только первый экран. Поэтому страница и карточка целиком
// сверяются ещё и на высоком окне (на 390 карточка целиком ниже первого экрана), а диалоги opConfirm — по тексту,
// иконкам, кнопкам, положению и пикселям «Последствий».
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import {
  cardTarget,
  consequencesTarget,
  dialogOutline,
  mainTarget,
  openDialog,
  orgsArea,
  selectOrg,
} from './platform-orgs.compare.ts';
import { compareShots } from './shell.compare.ts';

/** Высота окна, на которой `#ox-main` вмещает список и карточку целиком на любой ширине проекта. */
const TALL = 2600;

const tall = async (page: Page): Promise<void> => {
  const vp = page.viewportSize();
  if (!vp) throw new Error('нет viewport проекта');
  await page.setViewportSize({ width: vp.width, height: TALL });
};

test.describe('platform-orgs — визуальная сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');

  test('«Организации-клиенты» и карточка «Альта Групп» в допуске 0,01', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    const ref = await reference(undefined, { persona: 'operator', hidePanel: true });
    const impl = await app('/platform/tenants', { persona: 'operator' });
    await expect(page.locator('#ox-main .ox-audit-row')).toHaveCount(2);
    await page.waitForLoadState('networkidle');
    const r = await compareShots(
      { target: mainTarget(impl) },
      { target: mainTarget(ref) },
      `platform-orgs-${testInfo.project.name}`,
      testInfo,
    );
    testInfo.annotations.push({ type: 'ratio', description: String(r.ratio) });
    console.log(`visual platform-orgs ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });

  test('высокое окно: вся страница и карточка «Альта Групп» целиком в допуске 0,01', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    const ref = await reference(undefined, { persona: 'operator', hidePanel: true });
    await tall(ref.page);
    await tall(page);
    const impl = await app('/platform/tenants', { persona: 'operator' });
    await expect(page.locator('#ox-main .ox-audit-row')).toHaveCount(2);
    await page.waitForLoadState('networkidle');
    const name = testInfo.project.name;
    const whole = await compareShots(
      { target: mainTarget(impl) },
      { target: mainTarget(ref) },
      `platform-orgs-tall-${name}`,
      testInfo,
    );
    const card = await compareShots(
      { target: cardTarget(impl) },
      { target: cardTarget(ref) },
      `platform-org-card-${name}`,
      testInfo,
    );
    console.log(
      `visual platform-orgs tall ${name}: ${whole.diffPixels} px, ${whole.ratio}; ` +
        `platform-org-card ${name}: ${card.diffPixels} px, ${card.ratio}`,
    );
    expect(whole.pass, `страница: ${whole.diffPixels} px, ${whole.ratio}`).toBe(true);
    expect(card.pass, `карточка: ${card.diffPixels} px, ${card.ratio}`).toBe(true);
  });

  for (const d of [
    { org: 'Альта Групп', action: 'Продлить пробный период на 14 дней' },
    { org: 'Альта Групп', action: 'Ограничить новые операции' },
    { org: 'Карго Сити', action: 'Снять ограничение' },
    // W4.84: «Квота места» → «Применить» (opVM :3566): меньше занятого и больше занятого.
    { org: 'Альта Групп', action: 'Применить', quota: '25' },
    { org: 'SPA «Лотос»', action: 'Применить', quota: '250' },
  ] as const) {
    const quota = 'quota' in d ? d.quota : undefined;
    test(`диалог «${d.action}»${quota ? ` ${quota} ГБ` : ''} («${d.org}»): текст, иконки, кнопки, положение и «Последствия» как opConfirm`, async ({
      app,
      page,
      reference,
    }, testInfo) => {
      const ref = await reference(undefined, { persona: 'operator', hidePanel: true });
      await selectOrg(ref.page, d.org);
      const impl = await app('/platform/tenants', { persona: 'operator' });
      await selectOrg(page, d.org);
      if (quota) {
        for (const p of [ref.page, page]) {
          await orgsArea(p).locator('aside').getByLabel('Квота места').selectOption(quota);
        }
      }
      const refDialog = await openDialog(ref.page, d.action);
      const implDialog = await openDialog(page, d.action);
      // Поле «Причина» — no-reference (allowlist platform-org-card.md), в сверку текста не входит.
      expect(await dialogOutline(implDialog)).toEqual(await dialogOutline(refDialog));
      const [rb, ib] = [await refDialog.boundingBox(), await implDialog.boundingBox()];
      expect(ib && rb, 'диалог виден').toBeTruthy();
      if (!rb || !ib) return;
      // Ширина и горизонтальное положение — как эталон (лист снизу на 390, 560 px по центру на 1440); нижний
      // край листа на 390 — у края окна. Высота больше эталона на поле «Причина» (allowlist).
      expect(Math.round(ib.width)).toBe(Math.round(rb.width));
      expect(Math.round(ib.x)).toBe(Math.round(rb.x));
      if ((page.viewportSize()?.width ?? 0) < 640) {
        expect(Math.round(ib.y + ib.height)).toBe(Math.round(rb.y + rb.height));
      }
      // «Последствия» попиксельно. Шапка диалога другая (@ortus/ui Dialog, а не ConfirmDialog — allowlist
      // platform-org-card.md): отступ 20 px против 22 + 4 у эталона и другая дробная часть вертикального положения,
      // от которой зависит растеризация текста. Поэтому ширина и дробная часть положения секции реализации
      // приводятся к эталону; шрифт, размеры, цвета, интервалы и иконки сверяются как есть.
      const refSection = consequencesTarget(ref);
      const refBox = await refSection.root.boundingBox();
      const implSection = consequencesTarget(impl);
      if (!refBox) throw new Error('нет секции «Последствия»');
      // Ширина — первой: она меняет перенос строк, высоту диалога и, при центрировании, дробную часть положения.
      await implSection.root.evaluate((el, width) => {
        (el as HTMLElement).style.width = `${width}px`;
      }, refBox.width);
      const implBox = await implSection.root.boundingBox();
      if (!implBox) throw new Error('нет секции «Последствия»');
      const frac = (v: number) => v - Math.floor(v);
      const dy = (frac(refBox.y) - frac(implBox.y) + 1) % 1;
      // W4.84: и дробная часть горизонтального положения (у диалога квоты она расходится на 768 и 1440).
      const dx = (frac(refBox.x) - frac(implBox.x) + 1) % 1;
      await implSection.root.evaluate(
        (el, v) => {
          Object.assign((el as HTMLElement).style, {
            position: 'relative',
            top: `${v.dy}px`,
            left: `${v.dx}px`,
          });
        },
        { dy, dx },
      );
      const r = await compareShots(
        { target: implSection },
        { target: refSection },
        `platform-org-dialog-${d.action}-${testInfo.project.name}`,
        testInfo,
      );
      expect(r.pass, `«Последствия»: ${r.diffPixels} px, ${r.ratio}`).toBe(true);
    });
  }
});
