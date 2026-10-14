// Стык харнесса (W0.05) с хуком pre-push (W0.03): после появления playwright.config.ts smoke
// запускается при изменении страниц; пока @smoke-тестов нет, Playwright не должен падать
// с «No tests found» и блокировать push.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { read } from './_util.mjs';

describe('pre-push smoke', () => {
  it('playwright test --grep @smoke запускается с --pass-with-no-tests', () => {
    const src = read('tools/repo/pre-push.mjs');
    assert.match(src, /'--grep',\s*'@smoke',\s*'--pass-with-no-tests'/);
  });
});
