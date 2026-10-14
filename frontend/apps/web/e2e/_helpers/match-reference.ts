// Визуальная сверка «реализация ↔ эталон» для spec-файлов (verification-protocol.md §3, D-22):
// снимки корней обеих целей, порог maxDiffPixelRatio, при провале — expected/actual/diff во вложениях.
import { type MatchOptions, type MatchResult, matchScreens, type Target } from '@ortus/e2e-kit';
import type { TestInfo } from '@playwright/test';

export async function matchReference(
  actual: Target,
  expected: Target,
  key: string,
  testInfo: TestInfo,
  o: MatchOptions = {},
): Promise<MatchResult> {
  const r = await matchScreens(actual, expected, o);
  if (!r.pass) {
    const png = 'image/png';
    await testInfo.attach(`${key}-expected.png`, { body: r.expected, contentType: png });
    await testInfo.attach(`${key}-actual.png`, { body: r.actual, contentType: png });
    if (r.diff) await testInfo.attach(`${key}-diff.png`, { body: r.diff, contentType: png });
    throw new Error(`matchReference(${key}): ${r.message}`);
  }
  return r;
}
