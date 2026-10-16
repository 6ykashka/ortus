// W1.20 · Структурная сверка `access-gate` со снимком design-stage-1 (verification-protocol.md §3 п. 4): подписи
// основной области (чип, заголовок, кнопки) в порядке документа, с учётом allowlist/access-gate.md. Вариант
// владельца — карточка прораба эталона с подписями владельца (ownerGateCard, см. access-gate.visual.spec.ts).
import { gate } from '@ortus/texts';

import { tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { dropDemoButtons, labelsOf, ownerGateCard } from './shell.compare.ts';

for (const persona of ['driver', 'foreman'] as const) {
  test(`access-gate: подписи гейта (${persona}) совпадают с эталоном @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    const ref = await reference(undefined, { persona, hidePanel: true });
    await dropDemoButtons(ref.root);
    await app('/', { persona });
    await expect(page.locator('.ox-gate')).toBeVisible();
    const expected = await labelsOf([ref.page.locator('#ox-main')], 'access-gate');
    const actual = await labelsOf([page.locator('#ox-main')], 'access-gate');
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(0);
  });
}

test('access-gate: подписи гейта владельца с действием совпадают с эталоном @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  const ref = await reference(undefined, { persona: 'foreman', hidePanel: true });
  await ownerGateCard(ref.root, gate.a.textOwner, gate.actions.openModules);
  await app('/', { persona: 'owner' });
  await app(`/t/${await tenantId(page)}/repair`, { persona: 'owner' });
  await expect(page.getByRole('button', { name: gate.actions.openModules })).toBeVisible();
  const expected = await labelsOf([ref.page.locator('#ox-main')], 'access-gate');
  const actual = await labelsOf([page.locator('#ox-main')], 'access-gate');
  expect(actual).toEqual(expected);
  expect(actual).toContain(`button:${gate.actions.openModules}`);
});
