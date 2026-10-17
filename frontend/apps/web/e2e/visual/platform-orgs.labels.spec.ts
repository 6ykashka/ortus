// W1.25 · Структурная сверка `platform-orgs` и `platform-org-card` со снимком design-stage-1 (verification-protocol.md
// §3 п. 4): подписи кнопок, заголовков, label и aria-label страницы в порядке документа; эталон приведён к данным
// контракта этапа 1 (platform-orgs.compare.ts), остальные отличия — allowlist/platform-orgs.md и platform-org-card.md.
// Значения карточки (`dd` и «Места с входом») сверяются у каждой организации сида, а не только у выбранной по
// умолчанию.
import { applyAllowlist, collectLabels } from '@ortus/e2e-kit';

import { expect, test } from '../fixtures/index.ts';
import {
  cardValues,
  comparableValues,
  normalizeReference,
  orgsArea,
  selectOrg,
} from './platform-orgs.compare.ts';
import { allowlist } from './shell.compare.ts';

const KEYS = ['platform-orgs', 'platform-org-card'] as const;
const ORGS = ['Альта Групп', 'SPA «Лотос»', 'Ремстрой Плюс', 'Карго Сити'] as const;

test('platform-orgs: подписи страницы и карточки совпадают с эталоном @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  const ref = await reference(undefined, { persona: 'operator', hidePanel: true });
  await normalizeReference(ref.page);
  await app('/platform/tenants', { persona: 'operator' });
  await expect(page.locator('#ox-main .ox-audit-row')).toHaveCount(2);
  const entries = allowlist(KEYS);
  const expected = applyAllowlist(await collectLabels(orgsArea(ref.page)), entries, 'mock');
  const actual = applyAllowlist(await collectLabels(orgsArea(page)), entries, 'mock');
  expect(actual).toEqual(expected);
});

test('platform-org-card: значения карточки каждой организации совпадают с эталоном @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  await app('/platform/tenants', { persona: 'operator' });
  for (const name of ORGS) {
    // Свежий эталон на каждую организацию: приведение заменяет текстовые узлы шаблона, и после смены выбора
    // шаблон обновлял бы уже отсоединённые узлы.
    const ref = await reference(undefined, { persona: 'operator', hidePanel: true });
    await selectOrg(ref.page, name);
    await normalizeReference(ref.page);
    await selectOrg(page, name);
    const expected = comparableValues(await cardValues(ref.page), 'mock');
    const actual = comparableValues(await cardValues(page), 'mock');
    expect(actual, name).toEqual(expected);
    await ref.page.context().close();
  }
});
