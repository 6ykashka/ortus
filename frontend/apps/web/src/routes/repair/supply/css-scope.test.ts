// W6.22 · Возврат 1: CSS страниц «Снабжение» и «Шаблоны и расценки» и вкладки «Снабжение» глобальный,
// поэтому классы не должны совпадать с классами других экранов «Ремонта» (W6.20/W6.21: .ox-rp-head и др.).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPAIR = resolve(import.meta.dirname, '..');
const OWN = ['supply', 'catalog'];

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? cssFiles(join(dir, e.name))
      : e.name.endsWith('.css')
        ? [join(dir, e.name)]
        : [],
  );
}

function classes(file: string): Set<string> {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set([...text.matchAll(/\.(ox-[a-z0-9_-]+)/gi)].map((m) => m[1] as string));
}

describe('изоляция CSS-классов W6.22', () => {
  const all = cssFiles(REPAIR);
  const own = all.filter((f) => OWN.some((d) => f.startsWith(join(REPAIR, d))));
  const foreign = all.filter((f) => !own.includes(f));

  it('классы supply/catalog не совпадают с классами других CSS «Ремонта»', () => {
    const taken = new Set(foreign.flatMap((f) => [...classes(f)]));
    const clash = own.flatMap((f) => [...classes(f)]).filter((c) => taken.has(c));
    expect([...new Set(clash)].sort()).toEqual([]);
  });

  it('у W6.22 собственный префикс ox-rps-', () => {
    const names = own.flatMap((f) => [...classes(f)]).filter((c) => c.startsWith('ox-rp-'));
    expect(names).toEqual([]);
  });
});
