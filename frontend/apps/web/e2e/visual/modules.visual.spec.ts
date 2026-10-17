// W1.24 · Визуальная сверка `modules` «Модули и место» со снимком design-stage-1 (verification-protocol.md §3,
// порог 0,01). Предмет — основная область; шапка и меню сверяет ключ `shell` (маска). На эталоне до снимка
// снимается кнопка «Демо: завершить пробный период» (PD-54: в реализации её нет). Кадры: верх страницы,
// низ страницы (карточка «Место организации») и диалоги «Подключить «Логистика»?», «Отключить «Салон и SPA»?»,
// «Новый лимит меньше занятого места» (25 ГБ), «Изменить лимит на 250 ГБ?» (без секций: пустой контейнер
// секций эталона :2185 добавляет gap перед подвалом).
// Отличия — allowlist/modules.md.
import type { Page } from '@playwright/test';

import { tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { modulesReady, openOnReference } from './modules.compare.ts';
import { compareShots, dropDemoButtons } from './shell.compare.ts';

const CHROME = ['header', 'nav'];

/** Прокрутка основной области к низу страницы (прокручивается `#ox-main`, :172). */
const toBottom = (page: Page) =>
  page.locator('#ox-main').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

type Frame = 'top' | 'bottom' | 'connect' | 'disconnect' | 'quota' | 'quota-fit';
const FRAMES: Frame[] = ['top', 'bottom', 'connect', 'disconnect', 'quota', 'quota-fit'];

/** Кадр на эталоне или в реализации: кнопки карточек — по подписи внутри статьи модуля. */
async function frame(page: Page, f: Frame): Promise<void> {
  const card = (name: string) =>
    page.locator('article').filter({ has: page.getByRole('heading', { level: 3, name }) });
  if (f === 'bottom') await toBottom(page);
  if (f === 'connect') await card('Логистика').getByRole('button', { name: 'Подключить' }).click();
  if (f === 'disconnect')
    await card('Салон и SPA').getByRole('button', { name: 'Отключить' }).click();
  if (f === 'quota' || f === 'quota-fit') {
    await page.getByLabel('Лимит места').selectOption(f === 'quota' ? '25' : '250');
    await page.getByRole('button', { name: 'Изменить лимит' }).click();
  }
  if (f !== 'top' && f !== 'bottom') {
    await page.getByRole('dialog').waitFor();
  }
}

for (const f of FRAMES) {
  test(`modules: «Модули и место» владельца, кадр ${f}, в допуске 0,01 @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await openOnReference(ref.page, 'Модули и место', 'Модули');
    await dropDemoButtons(ref.root);
    await app('/', { persona: 'owner' });
    const impl = await app(`/t/${await tenantId(page)}/modules`, { persona: 'owner' });
    await modulesReady(page);
    // Ссылка «Хранилище» — без эталона (allowlist/modules.md, Q-W1.24-8): на телефоне и планшете она добавляет
    // строку в карточку места и сдвигает низ страницы; кадр сверяет остальное — ссылка скрывается до снимка.
    await page.locator('.ox-mod-link').evaluate((el) => {
      (el as HTMLElement).style.display = 'none';
    });
    await frame(ref.page, f);
    await frame(page, f);
    const r = await compareShots(
      { target: impl, mask: CHROME.map((s) => page.locator(s)) },
      { target: ref, mask: CHROME.map((s) => ref.page.locator(s)) },
      `modules-${f}-${testInfo.project.name}`,
      testInfo,
    );
    console.log(`visual modules ${f} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
}
