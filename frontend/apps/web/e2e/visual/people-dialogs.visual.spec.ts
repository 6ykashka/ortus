// W1.23 · Визуальная сверка `people-dialogs` со снимком design-stage-1 (verification-protocol.md §3, PD-22: 0,01):
// диалоги «Назначить роль» (Тимур Ахмедов — без назначений и в эталоне, и в сиде этапа 1), «Пригласить участника»,
// «Создать роль». Шапка и меню — маска (`shell`); страница под подложкой закрыта заливкой ниже вкладок (данные —
// ключ `company-users`). Маски внутри диалогов: подпись участника («{имя} · {должность}» эталона ↔
// «{имя} · {почта}» — должности в контракте нет), подпись приглашения (PD-54: письмо отправляется, W1.41).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { personRow } from '../people.helpers.ts';
import { CHROME, coverFrom, implUsers, referenceUsers } from './people.compare.ts';
import { allowlist, compareShots } from './shell.compare.ts';

/** Записи `pixel` вида `visual:<ключ>@<проект>` — расхождение сверх допуска, разрешённое решением. */
const PIXEL_OK = new Set(
  allowlist('people-dialogs')
    .filter((e) => e.kind === 'pixel' && e.target.startsWith('visual:'))
    .map((e) => e.target.slice('visual:'.length)),
);

const dialog = (p: Page, name: string) => p.getByRole('dialog', { name });
const tabs = (p: Page) => p.getByRole('tablist', { name: 'Разделы доступа' });
/** Счётчик «Роли»: 23 роли эталона с ролями модулей этапов 4–7 (out-of-stage). */
const rolesTab = (p: Page) => p.getByRole('tab', { name: /^Роли/ });

interface Case {
  key: string;
  title: string;
  tab?: string;
  openRef: (p: Page) => Promise<void>;
  openImpl: (p: Page) => Promise<void>;
  maskRef: (p: Page) => Locator[];
  maskImpl: (p: Page) => Locator[];
}

const CASES: Case[] = [
  {
    key: 'assign',
    title: 'Назначить роль',
    // Ахмедов — 9-й в списке эталона и сида (mock-data.js baseSeed).
    openRef: (p) => p.getByRole('button', { name: 'Назначить роль' }).nth(8).click(),
    openImpl: (p) =>
      personRow(p, 'Тимур Ахмедов').getByRole('button', { name: 'Назначить роль' }).click(),
    maskRef: (p) => [dialog(p, 'Назначить роль').locator('h2 + span')],
    maskImpl: (p) => [p.locator('.ox-dlg-sub')],
  },
  {
    key: 'invite',
    title: 'Пригласить участника',
    openRef: (p) => p.getByRole('button', { name: 'Пригласить' }).click(),
    openImpl: (p) => p.getByRole('button', { name: 'Пригласить' }).click(),
    maskRef: (p) => [dialog(p, 'Пригласить участника').locator('h2 + span')],
    maskImpl: (p) => [p.locator('.ox-dlg-sub')],
  },
  {
    key: 'create-role',
    title: 'Создать роль',
    tab: 'Роли',
    openRef: (p) => p.getByRole('button', { name: 'Создать роль' }).click(),
    openImpl: (p) => p.getByRole('button', { name: 'Создать роль' }).click(),
    maskRef: () => [],
    maskImpl: () => [],
  },
];

test.describe('people-dialogs — визуальная сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');

  for (const c of CASES) {
    test(`«${c.title}» в допуске 0,01`, async ({ app, page, reference }, testInfo) => {
      const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
      await referenceUsers(ref.page, c.tab);
      await implUsers(app, page, c.tab ? 'tab=roles' : '');
      // Страница под подложкой — ниже вкладок (её сверяет company-users / company-roles).
      const below = async (p: Page) => {
        const box = await tabs(p).boundingBox();
        await p.evaluate(
          (y) => {
            const d = document.createElement('div');
            Object.assign(d.style, {
              position: 'absolute',
              top: `${y}px`,
              height: '1px',
              width: '1px',
            });
            d.id = 'visual-anchor';
            document.body.append(d);
          },
          (box?.y ?? 0) + (box?.height ?? 0),
        );
        await coverFrom(p, p.locator('#visual-anchor'));
      };
      await c.openRef(ref.page);
      await c.openImpl(page);
      await expect(dialog(ref.page, c.title)).toBeVisible();
      await expect(dialog(page, c.title)).toBeVisible();
      await below(ref.page);
      await below(page);
      // Подпись — во всю ширину на обеих целях: маска закрывает строку целиком, а не текст разной длины.
      for (const m of [...c.maskRef(ref.page), ...c.maskImpl(page)]) {
        await m.evaluateAll((els) =>
          els.forEach((el) => ((el as HTMLElement).style.display = 'block')),
        );
      }
      await page.waitForLoadState('networkidle');
      const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
      const r = await compareShots(
        {
          target: impl,
          mask: [...CHROME.map((s) => page.locator(s)), rolesTab(page), ...c.maskImpl(page)],
        },
        {
          target: ref,
          mask: [
            ...CHROME.map((s) => ref.page.locator(s)),
            rolesTab(ref.page),
            ...c.maskRef(ref.page),
          ],
        },
        `people-dialogs-${c.key}-${testInfo.project.name}`,
        testInfo,
      );
      console.log(
        `visual people-dialogs ${c.key} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
      );
      if (PIXEL_OK.has(`${c.key}@${testInfo.project.name}`)) {
        testInfo.annotations.push({ type: 'allowlist', description: `pixel ${r.ratio}` });
        return;
      }
      expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
    });
  }
});
