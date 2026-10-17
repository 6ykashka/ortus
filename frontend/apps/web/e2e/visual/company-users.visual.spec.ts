// W1.23 · Визуальная сверка `company-users` со снимком design-stage-1 (verification-protocol.md §3, PD-22: 0,01).
// Шапка и меню закрыты маской (ключ `shell`). Ниже верхнего края блоков, данные которых расходятся по решениям
// allowlist `company-users.md`, основная область закрыта заливкой на обеих целях: список людей (назначения ролей
// модулей этапов 4–7 и «Проект «…»» эталона — Q-W0.02-2, Q-W0.12-5; имя-кнопка карточки — no-reference S1-09),
// карточки групп («Изменить состав», «Создать группу» — no-reference S1-13). На «Проверке доступа» закрыты поля
// «Сотрудник» и «Объект» (должность участника — нет в контракте, машины — этап 2) и «Почему доступно» (S1-14).
// Счётчик вкладки «Роли» закрыт: роли модулей этапов 4–7 (23 в эталоне) — out-of-stage.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import {
  CHROME,
  coverAt,
  coverFrom,
  implUsers,
  referenceUsers,
  refBlock,
} from './people.compare.ts';
import { compareShots } from './shell.compare.ts';

interface Case {
  tab: string;
  query: string;
  /** Верхний край закрываемой области (данные расходятся по решениям). */
  cover?: { ref: (page: Page) => Locator; impl: (page: Page) => Locator };
  /** Заливка обеих целей с верхнего края этого элемента реализации (у эталона его нет). */
  coverAtImpl?: (page: Page) => Locator;
  ref: (page: Page) => Locator[];
  impl: (page: Page) => Locator[];
}

const rolesTab = (p: Page) => p.getByRole('tab', { name: /^Роли/ });

const CASES: Case[] = [
  {
    tab: 'Люди',
    query: '',
    cover: { ref: (p) => refBlock(p, 4), impl: (p) => p.locator('ul.ox-people') },
    ref: (p) => [rolesTab(p)],
    impl: (p) => [rolesTab(p)],
  },
  {
    tab: 'Группы',
    query: 'tab=groups',
    cover: { ref: (p) => refBlock(p, 4), impl: (p) => p.locator('.ox-groups') },
    ref: (p) => [rolesTab(p)],
    impl: (p) => [rolesTab(p)],
  },
  {
    tab: 'Проверка доступа',
    query: 'tab=check',
    // «Почему доступно» (S1-14, no-reference) удлиняет карточку результата: обе цели закрыты заливкой с верхнего
    // края кнопки реализации (возврат 16.10 №1: на 768 нижняя рамка карточки давала 1,08 %).
    coverAtImpl: (p) => p.locator('.ox-check-why'),
    ref: (p) => [p.locator('#ox-main select'), rolesTab(p)],
    impl: (p) => [p.locator('#ox-main select'), rolesTab(p)],
  },
];

test.describe('company-users — визуальная сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');

  for (const c of CASES) {
    test(`«${c.tab}» в допуске 0,01`, async ({ app, page, reference }, testInfo) => {
      const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
      await referenceUsers(ref.page, c.tab);
      await implUsers(app, page, c.query);
      if (c.cover) {
        await coverFrom(ref.page, c.cover.ref(ref.page));
        await coverFrom(page, c.cover.impl(page));
      }
      if (c.coverAtImpl) {
        const y = (await c.coverAtImpl(page).boundingBox())?.y ?? 0;
        await coverAt(ref.page, y);
        await coverAt(page, y);
      }
      const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
      const r = await compareShots(
        { target: impl, mask: [...CHROME.map((s) => page.locator(s)), ...c.impl(page)] },
        { target: ref, mask: [...CHROME.map((s) => ref.page.locator(s)), ...c.ref(ref.page)] },
        `company-users-${c.query || 'people'}-${testInfo.project.name}`,
        testInfo,
      );
      console.log(
        `visual company-users ${c.tab} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
      );
      expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
    });
  }
});
