// W5.33 · Сверка `cash-self` «Мой подотчёт» со снимком design-2026-10-19 (verification-protocol.md §3): подписи
// основной области (collectLabels с allowlist cash-self) и пиксели в допуске 0,01 (шапка и меню закрыты маской —
// их сверяет W1.20). Персонаж — «Водитель · Илья Васильев»; в эталоне — пункт «Подотчёт» меню и режим isSelf модуля
// «Касса» (Касса.dc.html :288–317).
import { expect, test } from '../fixtures/index.ts';
import { openCashSelf } from '../cash-self.helpers.ts';
import { openOnReference } from './modules.compare.ts';
import { allowlist, compareShots, labelsOf } from './shell.compare.ts';

const CHROME = ['header', 'nav'];
const KEY = 'cash-self';
const NORMALIZE = 'normalize:эталон «Мой подотчёт»';

test.describe.configure({ timeout: 120_000 });

test.describe('cash-self — сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сверка mock-визуала');

  async function openBoth(
    app: Parameters<typeof openCashSelf>[0],
    page: Parameters<typeof openCashSelf>[1],
    reference: (
      file?: string,
      o?: { persona?: 'driver'; hidePanel?: boolean },
    ) => Promise<{ page: typeof page; root: import('@playwright/test').Locator }>,
  ) {
    const ref = await reference(undefined, { persona: 'driver', hidePanel: true });
    await openOnReference(ref.page, 'Подотчёт');
    await ref.page.getByRole('heading', { level: 1, name: 'Мой подотчёт' }).waitFor();
    await ref.page.waitForLoadState('networkidle');
    await ref.page.mouse.move(0, 0);
    await openCashSelf(app, page);
    await page.locator('.ox-cs-bal').waitFor();
    await page.waitForLoadState('networkidle');
    return ref;
  }

  test('подписи совпадают с эталоном', async ({ app, page, reference }) => {
    const ref = await openBoth(app, page, reference as never);
    const expected = await labelsOf([ref.page.locator('#ox-main')], KEY);
    const actual = await labelsOf([page.locator('#ox-main')], KEY);
    expect(actual).toEqual(expected);
  });

  test('пиксели в допуске 0,01', async ({ app, page, reference }, testInfo) => {
    const ref = await openBoth(app, page, reference as never);
    expect(
      allowlist(KEY).some((e) => e.kind === 'pixel' && e.target === NORMALIZE),
      `нет записи pixel «${NORMALIZE}» в allowlist/cash-self.md`,
    ).toBe(true);
    // Нормализация эталона по allowlist: чип срока и имя принявшего чек — данных нет в контракте (Q-W5.33-5, -6);
    // порядок строк «На проверке» / «Не принят» — порядок сервера (по времени); пропущенный пробел кнопки (PD-60).
    await ref.page.evaluate(() => {
      const chip = [...document.querySelectorAll('#ox-main span')].find(
        (el) =>
          /Отчитаться до \d/.test(el.textContent ?? '') && el.parentElement?.tagName !== 'SPAN',
      );
      chip?.remove();
      for (const b of document.querySelectorAll('#ox-main button'))
        if (/^Вернуть остаток\S/.test(b.textContent ?? ''))
          b.textContent = (b.textContent ?? '').replace(/^Вернуть остаток/, 'Вернуть остаток ');
      const walker = document.createTreeWalker(
        document.querySelector('#ox-main') as Node,
        NodeFilter.SHOW_TEXT,
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode())
        if (n.nodeValue)
          n.nodeValue = n.nodeValue
            .replace(/ · Дарья Зимина$/, '')
            .replace(/^Вернуть остаток(\d)/, 'Вернуть остаток $1');
      const list = [...document.querySelectorAll('#ox-main div')].find(
        (d) => d.querySelector(':scope > strong')?.textContent === 'Чеки',
      );
      const rows = list ? [...list.children].slice(1) : [];
      if (rows.length > 1 && /На проверке/.test(rows[0]?.textContent ?? ''))
        rows[1]?.after(rows[0] as Element);
    });
    const r = await compareShots(
      {
        target: { kind: 'app', page, root: page.locator('#app'), url: page.url() },
        mask: CHROME.map((s) => page.locator(s)),
      },
      {
        target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
        mask: CHROME.map((s) => ref.page.locator(s)),
      },
      `${KEY}-${testInfo.project.name}`,
      testInfo,
    );
    console.log(`visual ${KEY} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
});
