import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OWNERS, UNITS } from '../contract';

const SRC = join(import.meta.dirname, '..');
const PKG = join(SRC, '..');
const implemented = UNITS.filter((u) => OWNERS[u] === 'W0.10' && u !== 'Icon');

describe('Storybook: шесть компонентов S0-05 (порт 7200 + слот)', () => {
  it('реализованы ровно Button, Field, Status, Banner, Card, Dialog', () => {
    expect([...implemented].sort()).toEqual([
      'Banner',
      'Button',
      'Card',
      'Dialog',
      'Field',
      'Status',
    ]);
  });

  it.each(implemented)(
    '%s: файл историй с title Core/<Name> и русскими именами историй',
    (unit) => {
      const file = join(SRC, 'core', unit, `${unit}.stories.tsx`);
      expect(existsSync(file)).toBe(true);
      const text = readFileSync(file, 'utf8');
      expect(text).toContain(`title: 'Core/${unit}'`);
      const names = [...text.matchAll(/name: '([^']+)'/g)].map((m) => m[1] as string);
      expect(names.length).toBeGreaterThanOrEqual(2);
      for (const name of names) expect(name).toMatch(/[А-Яа-яЁё]/);
    },
  );

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
