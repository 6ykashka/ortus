// W2.94 (возврат 1) · Запуск собственного design-preview для visual-спеков: быстрая и внятная ошибка,
// без остаточного процесса. Браузер не нужен.
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { startOwnReference } from './own-reference.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const FILE = 'Временный водитель - варианты.dc.html';

test.describe('own-reference: запуск design-preview @mock', () => {
  test('нет исполняемого файла node: ошибка запуска сразу, а не через 20 с', async () => {
    const started = Date.now();
    await expect(
      startOwnReference({
        repoRoot: REPO_ROOT,
        ref: 'design-2026-10-19b',
        probeFile: FILE,
        execPath: 'node-which-does-not-exist-w294',
      }),
    ).rejects.toThrow(/не удалось запустить/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('сервер не поднялся: в ошибке ссылка снимка', async () => {
    await expect(
      startOwnReference({
        repoRoot: REPO_ROOT,
        ref: 'no-such-ref-w294',
        probeFile: FILE,
        timeoutMs: 3_000,
      }),
    ).rejects.toThrow(/no-such-ref-w294/);
  });

  test('stop() гасит дочерний процесс', async () => {
    const own = await startOwnReference({
      repoRoot: REPO_ROOT,
      ref: 'design-2026-10-19b',
      probeFile: FILE,
    });
    expect((await fetch(own.url)).status).toBeLessThan(500);
    await own.stop();
    await expect(fetch(own.url)).rejects.toThrow();
  });
});
