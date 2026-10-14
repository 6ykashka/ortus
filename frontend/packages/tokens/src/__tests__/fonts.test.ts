import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fontsDir = fileURLToPath(new URL('../../fonts/', import.meta.url));
const read = (name: string) => readFileSync(fontsDir + name);

interface FontFile {
  file: string;
  family: string;
  weight: string;
  url: string;
  sha256: string;
  license: string;
}

describe('локальные шрифты (PD-21): без обращений к внешним хостам', () => {
  const manifest = JSON.parse(read('manifest.json').toString('utf8')) as FontFile[];
  const css = read('fonts.css').toString('utf8');

  it('манифест перечисляет три семейства', () => {
    expect([...new Set(manifest.map((f) => f.family))].sort()).toEqual([
      'Golos Text',
      'IBM Plex Mono',
      'Material Symbols Rounded',
    ]);
  });

  it('каждый файл на месте, sha256 совпадает, источник запинен по версии', () => {
    for (const f of manifest) {
      expect(existsSync(fontsDir + f.file), f.file).toBe(true);
      expect(createHash('sha256').update(read(f.file)).digest('hex'), f.file).toBe(f.sha256);
      expect(f.url, f.file).toMatch(/@\d+\.\d+\.\d+\//);
    }
  });

  it('fonts.css ссылается только на файлы манифеста и не содержит http', () => {
    expect(css).not.toMatch(/https?:/);
    const urls = [...css.matchAll(/url\('\.\/([^']+)'\)/g)].map((m) => m[1]);
    expect(new Set(urls)).toEqual(new Set(manifest.map((f) => f.file)));
  });

  it('Golos Text — переменный 400–900, Plex Mono — 400 и 500, текстовые — swap', () => {
    expect(css).toMatch(
      /font-family: 'Golos Text';[^}]*font-weight: 400 900;[^}]*font-display: swap;/,
    );
    expect(css).toMatch(
      /font-family: 'IBM Plex Mono';[^}]*font-weight: 400;[^}]*font-display: swap;/,
    );
    expect(css).toMatch(
      /font-family: 'IBM Plex Mono';[^}]*font-weight: 500;[^}]*font-display: swap;/,
    );
    expect(css).toMatch(/unicode-range: U\+0301, U\+0400-045F/);
  });

  it('Material Symbols Rounded — 100–700, display block, класс с лигатурами', () => {
    expect(css).toMatch(
      /font-family: 'Material Symbols Rounded';[^}]*font-weight: 100 700;[^}]*font-display: block;/,
    );
    expect(css).toMatch(
      /\.material-symbols-rounded \{[^}]*font-family: 'Material Symbols Rounded';[^}]*font-feature-settings: 'liga';/,
    );
  });

  it('лицензии на месте: OFL для Golos и Plex, Apache 2.0 для Material Symbols', () => {
    expect(read('LICENSE-GolosText.txt').toString()).toMatch(/SIL Open Font License/);
    expect(read('LICENSE-IBMPlexMono.txt').toString()).toMatch(/SIL Open Font License/);
    expect(read('LICENSE-MaterialSymbols.txt').toString()).toMatch(/Apache License/);
    for (const f of manifest) expect(existsSync(fontsDir + f.license), f.license).toBe(true);
  });
});
