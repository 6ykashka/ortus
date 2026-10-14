import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');
const SKIP = new Set(['__tests__', 'test']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP.has(name) ? [] : files(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('цвета только из токенов (components.md: «новые цвета вне палитры не вводятся»)', () => {
  it('в src нет литералов #hex, rgb(), hsl()', () => {
    const offenders = files(SRC).flatMap((file) => {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      return /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(text) ? [file.slice(SRC.length)] : [];
    });
    expect(offenders).toEqual([]);
  });
});
