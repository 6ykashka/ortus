// W6.22 · Возврат 2: вкладка «Снабжение» заменила заглушку, поэтому ни одна e2e-строка (mock и stand)
// не должна ждать её текст. Прошлый возврат поправил только mock-строку, stand-строка осталась красной.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const E2E = resolve(import.meta.dirname, '../../../../e2e');

describe('заглушка вкладки «Снабжение» удалена', () => {
  it('ни один e2e-спек не ждёт «Снабжение: раздел ещё не подключён» через toContainText', () => {
    const hits = readdirSync(E2E)
      .filter((f) => f.endsWith('.ts'))
      .flatMap((f) =>
        readFileSync(join(E2E, f), 'utf8')
          .split(/\r?\n/)
          .map((line, i) => ({ f, n: i + 1, line }))
          .filter(
            (x) =>
              x.line.includes('Снабжение: раздел ещё не подключён') &&
              !x.line.includes('not.toContainText'),
          )
          .map((x) => `${x.f}:${x.n}`),
      );
    expect(hits).toEqual([]);
  });
});
