// W1.23 · Структурная сверка `company-users`, `company-roles`, `people-dialogs` со снимком design-stage-1
// (verification-protocol.md §3 п. 4): подписи основной области и диалогов (кнопки, вкладки, заголовки, label,
// aria-label) в порядке документа, с учётом allowlist ключа (`e2e/visual/allowlist/<key>.md`).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { personRow } from '../people.helpers.ts';
import { implUsers, referenceUsers } from './people.compare.ts';
import { labelsOf } from './shell.compare.ts';

const main = (p: Page) => p.locator('#ox-main');

interface Case {
  key: string;
  name: string;
  tab?: string;
  query: string;
  area: (p: Page) => Locator;
  openRef?: (p: Page) => Promise<void>;
  openImpl?: (p: Page) => Promise<void>;
}

const dialog = (p: Page) => p.getByRole('dialog');

const CASES: Case[] = [
  { key: 'company-users', name: 'Люди', query: '', area: main },
  { key: 'company-users', name: 'Группы', tab: 'Группы', query: 'tab=groups', area: main },
  {
    key: 'company-users',
    name: 'Проверка доступа',
    tab: 'Проверка доступа',
    query: 'tab=check',
    area: main,
  },
  { key: 'company-roles', name: 'Роли', tab: 'Роли', query: 'tab=roles', area: main },
  {
    key: 'people-dialogs',
    name: 'Назначить роль',
    query: '',
    area: dialog,
    openRef: (p) => p.getByRole('button', { name: 'Назначить роль' }).nth(8).click(),
    openImpl: (p) =>
      personRow(p, 'Тимур Ахмедов').getByRole('button', { name: 'Назначить роль' }).click(),
  },
  {
    key: 'people-dialogs',
    name: 'Пригласить участника',
    query: '',
    area: dialog,
    openRef: (p) => p.getByRole('button', { name: 'Пригласить' }).click(),
    openImpl: (p) => p.getByRole('button', { name: 'Пригласить' }).click(),
  },
  {
    key: 'people-dialogs',
    name: 'Создать роль',
    tab: 'Роли',
    query: 'tab=roles',
    area: dialog,
    openRef: (p) => p.getByRole('button', { name: 'Создать роль' }).click(),
    openImpl: (p) => p.getByRole('button', { name: 'Создать роль' }).click(),
  },
];

test.describe('people — подписи совпадают с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'структурная сверка mock-визуала');

  for (const c of CASES) {
    test(`${c.key}: «${c.name}»`, async ({ app, page, reference }) => {
      const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
      await referenceUsers(ref.page, c.tab);
      await implUsers(app, page, c.query);
      if (c.openRef && c.openImpl) {
        await c.openRef(ref.page);
        await c.openImpl(page);
        await expect(dialog(page)).toBeVisible();
      }
      const expected = await labelsOf([c.area(ref.page)], c.key);
      const actual = await labelsOf([c.area(page)], c.key);
      expect(actual).toEqual(expected);
      expect(actual.length).toBeGreaterThan(0);
    });
  }
});
