// W2.55 · Сроки Vitest всех пакетов frontend. Под нагрузкой (`pnpm -r run test` гонит пакеты параллельно,
// pre-push, `go build` рядом) срок по умолчанию 5000 мс давал «Test timed out in 5000ms» в domain, adapter и web.
// Каждый пакет с Vitest задаёт testTimeout и hookTimeout не меньше 20 000 мс (как W2.53 для @ortus/web)
// и ограничивает воркеры половиной ядер.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ROOT } from './_util.mjs';

const MIN_MS = 20_000;
const GROUPS = ['frontend/apps', 'frontend/packages'];

/** Пакеты frontend, чей скрипт test запускает Vitest: [{ dir, config }]. */
function vitestPackages() {
  const out = [];
  for (const group of GROUPS) {
    for (const name of readdirSync(join(ROOT, group))) {
      const dir = `${group}/${name}`;
      const pkgFile = join(ROOT, dir, 'package.json');
      if (!existsSync(pkgFile)) continue;
      const scripts = JSON.parse(readFileSync(pkgFile, 'utf8')).scripts ?? {};
      if (!/\bvitest\b/.test(scripts.test ?? '')) continue;
      const config = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js']
        .map((f) => `${dir}/${f}`)
        .find((f) => existsSync(join(ROOT, f)));
      out.push({ dir, config });
    }
  }
  return out;
}

/** Числовой литерал (`20_000`) или имя константы, объявленной в том же файле. */
function resolveNumber(text, expr) {
  const literal = (s) => (/^\d[\d_]*$/.test(s) ? Number(s.replaceAll('_', '')) : NaN);
  if (!Number.isNaN(literal(expr))) return literal(expr);
  const m = new RegExp(`const\\s+${expr}\\s*=\\s*([\\d_]+)\\s*;`).exec(text);
  return m ? literal(m[1]) : NaN;
}

/** Значение опции test.<key> конфига; нет — NaN. */
function optionMs(text, key) {
  const m = new RegExp(`\\b${key}\\s*:\\s*([A-Za-z_$][\\w$]*|\\d[\\d_]*)`).exec(text);
  return m ? resolveNumber(text, m[1]) : NaN;
}

describe('сроки Vitest пакетов frontend (W2.55)', () => {
  it('разбор опции: литерал, константа, отсутствие', () => {
    assert.equal(optionMs('test: { testTimeout: 20_000 }', 'testTimeout'), 20000);
    assert.equal(
      optionMs('const T = 25_000;\nexport default { test: { hookTimeout: T } }', 'hookTimeout'),
      25000,
    );
    assert.ok(Number.isNaN(optionMs('test: {}', 'testTimeout')));
  });

  const pkgs = vitestPackages();

  it('пакеты с Vitest найдены (web, domain, adapter, ui, tokens)', () => {
    const dirs = pkgs.map((p) => p.dir);
    for (const d of [
      'frontend/apps/web',
      'frontend/packages/domain',
      'frontend/packages/adapter',
      'frontend/packages/ui',
      'frontend/packages/tokens',
    ]) {
      assert.ok(dirs.includes(d), `${d}: нет в списке пакетов с Vitest`);
    }
  });

  for (const { dir, config } of pkgs) {
    it(`${dir}: testTimeout и hookTimeout ≥ ${MIN_MS} мс`, () => {
      assert.ok(config, `${dir}: нет vitest.config — действует срок по умолчанию 5000 мс`);
      const text = readFileSync(join(ROOT, config), 'utf8');
      for (const key of ['testTimeout', 'hookTimeout']) {
        const ms = optionMs(text, key);
        assert.ok(ms >= MIN_MS, `${config}: ${key} = ${Number.isNaN(ms) ? 'не задан' : ms}`);
      }
    });

    // Пакеты идут параллельно (`pnpm -r run test`), и по умолчанию каждый Vitest берёт воркеры на все ядра
    // без одного: 4 пакета × 21 воркер на 22 ядрах. Под нагрузкой это давало тайм-ауты холодных импортов.
    it(`${dir}: maxWorkers не больше половины ядер`, () => {
      assert.ok(config, `${dir}: нет vitest.config`);
      const text = readFileSync(join(ROOT, config), 'utf8');
      const m = /\bmaxWorkers\s*:\s*(?:'(\d+)%'|([A-Za-z_$][\w$]*))/.exec(text);
      assert.ok(m, `${config}: maxWorkers не задан — по умолчанию все ядра без одного`);
      const pct = m[1] ?? new RegExp(`const\\s+${m[2]}\\s*=\\s*'(\\d+)%'`).exec(text)?.[1];
      assert.ok(pct && Number(pct) <= 50, `${config}: maxWorkers = ${pct ?? m[2]}`);
    });
  }
});
