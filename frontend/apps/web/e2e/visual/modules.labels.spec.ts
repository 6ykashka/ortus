// W1.24 · Структурная сверка `modules` со снимком design-stage-1 (verification-protocol.md §3 п. 4): подписи
// основной области (кнопки, ссылки, заголовки, label, aria-label) в порядке документа, с allowlist/modules.md.
// Варианты: страница владельца «Альты» и диалоги подключения, отключения и лимита.
import type { Page } from '@playwright/test';

import { tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { modulesReady, openOnReference } from './modules.compare.ts';
import { dropDemoButtons, labelsOf } from './shell.compare.ts';

type Variant = 'page' | 'connect' | 'disconnect' | 'quota';

async function open(page: Page, v: Variant): Promise<void> {
  const card = (name: string) =>
    page.locator('article').filter({ has: page.getByRole('heading', { level: 3, name }) });
  if (v === 'connect') await card('Логистика').getByRole('button', { name: 'Подключить' }).click();
  if (v === 'disconnect')
    await card('Салон и SPA').getByRole('button', { name: 'Отключить' }).click();
  if (v === 'quota') {
    await page.getByLabel('Лимит места').selectOption('25');
    await page.getByRole('button', { name: 'Изменить лимит' }).click();
  }
  if (v !== 'page') await page.getByRole('dialog').waitFor();
}

/** Область сверки: основная область или диалог. */
const area = (page: Page, v: Variant) =>
  v === 'page' ? page.locator('#ox-main') : page.getByRole('dialog');

for (const v of ['page', 'connect', 'disconnect', 'quota'] as const) {
  test(`modules: подписи (${v}) совпадают с эталоном @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await openOnReference(ref.page, 'Модули и место', 'Модули');
    await dropDemoButtons(ref.root);
    await open(ref.page, v);
    await app('/', { persona: 'owner' });
    await app(`/t/${await tenantId(page)}/modules`, { persona: 'owner' });
    await modulesReady(page);
    await open(page, v);
    const expected = await labelsOf([area(ref.page, v)], 'modules');
    const actual = await labelsOf([area(page, v)], 'modules');
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(2);
  });
}
