import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OWNERS, UNITS, type Unit } from '../contract';

const SRC = join(import.meta.dirname, '..');
const PKG = join(SRC, '..');

/** Группа и каталог единицы: `core/<Name>` или `domain/<Name>`. */
function unitDir(unit: Unit): { group: 'core' | 'domain'; dir: string } | undefined {
  for (const group of ['core', 'domain'] as const) {
    const dir = join(SRC, group, unit);
    if (existsSync(join(dir, 'index.ts'))) return { group, dir };
  }
  return undefined;
}

const isStub = (unit: Unit): boolean => {
  const found = unitDir(unit);
  return (
    found !== undefined &&
    readFileSync(join(found.dir, 'index.ts'), 'utf8').includes('@stub Owner:')
  );
};

/** Реализованные единицы с историями: всё, кроме заглушек, типа AppShell и служебных Icon, VisuallyHidden. */
const withStories = UNITS.filter(
  (u) => !['AppShell', 'Icon', 'VisuallyHidden'].includes(u) && !isStub(u),
);

describe('Storybook @ortus/ui (порт 7200 + слот)', () => {
  it('единицы W0.10 и W1.21 реализованы — заглушек с их маркером нет', () => {
    const left = UNITS.filter(
      (u) => u !== 'AppShell' && ['W0.10', 'W1.21'].includes(OWNERS[u]) && isStub(u),
    );
    expect(left).toEqual([]);
  });

  it.each(withStories)('%s: файл историй с title Core|Domain/<Name> и русскими именами', (unit) => {
    const found = unitDir(unit);
    expect(found).toBeDefined();
    const file = join(found?.dir ?? '', `${unit}.stories.tsx`);
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    const title = found?.group === 'domain' ? 'Domain' : 'Core';
    expect(text).toContain(`title: '${title}/${unit}'`);
    const names = [...text.matchAll(/name: '([^']+)'/g)].map((m) => m[1] as string);
    expect(names.length).toBeGreaterThanOrEqual(2);
    for (const name of names) expect(name).toMatch(/[А-Яа-яЁё]/);
  });

  it('конфиг: истории из src, аддон a11y, превью подключает токены, шрифты и base.css', () => {
    const main = readFileSync(join(PKG, '.storybook/main.ts'), 'utf8');
    expect(main).toContain("'../src/**/*.stories.tsx'");
    expect(main).toContain('@storybook/addon-a11y');
    const preview = readFileSync(join(PKG, '.storybook/preview.ts'), 'utf8');
    for (const css of ['tokens.css', 'fonts.css', 'base.css']) {
      expect(preview).toContain(`@ortus/tokens/${css}`);
    }
    expect(preview).toMatch(/390[\s\S]*768[\s\S]*1440/);
  });
});
