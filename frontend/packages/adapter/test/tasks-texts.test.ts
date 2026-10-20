// Тексты ошибок сценарного сервера «Задач и проектов» (W4.03, возврат 1): каждый — из эталона или домена W4.10
// дословно, либо в явном списке текстов без эталона (TEXTS_WITHOUT_REFERENCE, PD-60). Список передаётся W4.12 и
// W4.13: страницы не считают эти тексты дословными текстами прототипа и заносят их в свои allowlist расхождений.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TEXTS_WITHOUT_REFERENCE } from '../src/msw/tasks/no-reference.ts';

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(at(rel), 'utf8');

const MSW = ['index.ts', 'engine.ts', 'state.ts']
  .map((f) => read(`../src/msw/tasks/${f}`))
  .join('\n');

/** Эталон: движок и данные прототипа (design/ortus/*.js), экраны «Задач», домен W4.10 (без тестов). */
const REFERENCE = [
  ...readdirSync(at('../../../../design/ortus/'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => read(`../../../../design/ortus/${f}`)),
  read('../../../../design/Задачи и проекты.dc.html'),
  read('../../../../design/Задачи - варианты.dc.html'),
  ...readdirSync(at('../../domain/src/modules/tasks/'))
    .filter((f) => f.endsWith('.ts') && !f.includes('.test'))
    .map((f) => read(`../../domain/src/modules/tasks/${f}`)),
].join('\n');

/** Тексты отказов MSW: fail(code, '…'), invalid(field, code, '…'), notFunnel(p, '…'), text: '…' причин переходов. */
function texts(src: string): string[] {
  const out = new Set<string>();
  const res = [
    /\bfail\(\s*'[a-z_]+'\s*,\s*(['`])((?:(?!\1).)+)\1/g,
    /\binvalid\(\s*[^,]+,\s*'[^']+'\s*,\s*(['`])((?:(?!\1).)+)\1/g,
    /\bnotFunnel\(\s*\w+\s*,\s*(['`])((?:(?!\1).)+)\1/g,
    /\btext = (['`])((?:(?!\1).)+)\1/g,
    /\btext:\s*(['`])((?:(?!\1).)+)\1/g,
  ];
  for (const re of res) for (const m of src.matchAll(re)) out.add(m[2] ?? '');
  return [...out].filter((t) => /[А-ЯЁа-яё]/.test(t));
}

/** Есть в эталоне: обычный текст — целиком, шаблон — каждый неподставляемый кусок длиннее 5 знаков. */
function inReference(t: string): boolean {
  const parts = t
    .split(/\$\{[^}]*\}/)
    .map((x) => x.trim())
    .filter((x) => x.length > 5);
  return parts.length > 0 && parts.every((x) => REFERENCE.includes(x));
}

describe('тексты ошибок MSW «Задач и проектов»: эталон или список без эталона (PD-60)', () => {
  const all = texts(MSW);

  it('каждый текст отказа — из эталона или домена W4.10, иначе в TEXTS_WITHOUT_REFERENCE', () => {
    expect(all.length).toBeGreaterThan(40);
    expect(all.filter((t) => !inReference(t) && !TEXTS_WITHOUT_REFERENCE.includes(t))).toEqual([]);
  });

  it('список без эталона — только тексты, которые MSW отдаёт и которых в эталоне нет', () => {
    expect(TEXTS_WITHOUT_REFERENCE.filter((t) => !all.includes(t))).toEqual([]);
    expect(TEXTS_WITHOUT_REFERENCE.filter((t) => inReference(t))).toEqual([]);
    expect(new Set(TEXTS_WITHOUT_REFERENCE).size).toBe(TEXTS_WITHOUT_REFERENCE.length);
  });
});
