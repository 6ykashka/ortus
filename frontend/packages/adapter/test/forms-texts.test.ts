// Тексты сценарного сервера «Форм и опросов» (W4.05): каждый текст для пользователя — из эталона дословно (модуль
// «Формы и опросы.dc.html», движок и данные прототипа design/ortus/api.js, models.js, mock-data.js) или домена W4.20,
// либо в явном списке текстов без эталона (TEXTS_WITHOUT_REFERENCE, PD-60). Список передаётся W4.22, W4.23, W4.27,
// W4.28: страницы не считают эти тексты дословными текстами прототипа и заносят их в свои allowlist расхождений.
// Возврат 1: текст считается эталонным, только если он целиком — строковый литерал, текст разметки или неподставляемая
// часть шаблона эталона «Форм» (не подстрока чужого модуля: «Группа не найдена» есть только в knowledge.js и
// documents.js, «Приём ответов закрыт» — только начало тоста).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TEXTS_WITHOUT_REFERENCE } from '../src/msw/forms/no-reference.ts';

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(at(rel), 'utf8');

const MSW_FILES = ['index.ts', 'engine.ts', 'state.ts', 'no-reference.ts'];

/** Исходники MSW без комментариев (тексты комментариев — не для пользователя). */
const MSW = MSW_FILES.filter((f) => f !== 'no-reference.ts')
  .map((f) => read(`../src/msw/forms/${f}`))
  .join('\n')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Эталон «Форм»: модуль, движок и данные прототипа (без модулей «Базы знаний», «Документов», «Кассы»…), домен W4.20. */
const REFERENCE_SOURCES = [
  read('../../../../design/Формы и опросы.dc.html'),
  ...['api.js', 'models.js', 'mock-data.js'].map((f) => read(`../../../../design/ortus/${f}`)),
  ...readdirSync(at('../../domain/src/modules/forms/'))
    .filter((f) => f.endsWith('.ts') && !f.includes('.test'))
    .map((f) => read(`../../domain/src/modules/forms/${f}`)),
];

/** Неподставляемые части шаблона: «Форма «${name}» уже есть» → «Форма «», «» уже есть». */
const pieces = (t: string): string[] =>
  t
    .split(/\$\{[^}]*\}|\{[^}]*\}/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Целые тексты эталона: строковые литералы ('…', "…", `…`), их части между подстановками и тексты разметки. */
const REFERENCE = new Set<string>();
for (const src of REFERENCE_SOURCES) {
  // Каждый вид кавычек — отдельно и в пределах строки: апостроф в тексте не сбивает разбор остальных строк.
  const quoted = [/'((?:\\.|[^'\\\n])*)'/g, /"((?:\\.|[^"\\\n])*)"/g, /`((?:\\.|[^`\\\n])*)`/g];
  for (const m of quoted.flatMap((re) => [...src.matchAll(re)])) {
    const t = m[1] ?? '';
    if (!/[А-ЯЁа-яё]/.test(t)) continue;
    REFERENCE.add(t);
    REFERENCE.add(t.trim());
    for (const p of pieces(t)) REFERENCE.add(p);
  }
  for (const m of src.matchAll(/>([^<>]*[А-ЯЁа-яё][^<>]*)</g)) {
    const t = (m[1] ?? '').trim();
    REFERENCE.add(t);
    for (const p of pieces(t)) REFERENCE.add(p);
  }
}
const REFERENCE_TEXT = [...REFERENCE].join('\n');

/** Строковые литералы с кириллицей ('…' и `…`). */
function texts(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/(['`])((?:\\.|(?!\1).)*?)\1/g)) {
    const t = m[2] ?? '';
    if (/[А-ЯЁа-яё]/.test(t)) out.add(t);
  }
  return [...out];
}

/**
 * Есть в эталоне «Форм»: обычный текст — целиком (литерал, текст разметки или часть шаблона); шаблон — каждый
 * неподставляемый кусок длиннее 5 знаков есть в тексте эталона «Форм».
 */
function inReference(t: string): boolean {
  if (!t.includes('${')) return REFERENCE.has(t);
  const parts = pieces(t).filter((x) => x.length > 5);
  return parts.length > 0 && parts.every((x) => REFERENCE_TEXT.includes(x));
}

describe('тексты MSW «Форм и опросов»: эталон или список без эталона (PD-60)', () => {
  const all = texts(MSW);

  it('каждый текст — из эталона «Форм» или домена W4.20 целиком, иначе в TEXTS_WITHOUT_REFERENCE', () => {
    expect(all.length).toBeGreaterThan(40);
    expect(all.filter((t) => !inReference(t) && !TEXTS_WITHOUT_REFERENCE.includes(t))).toEqual([]);
  });

  it('список без эталона — только тексты, которые MSW отдаёт и которых в эталоне нет', () => {
    expect(TEXTS_WITHOUT_REFERENCE.filter((t) => !all.includes(t))).toEqual([]);
    expect(TEXTS_WITHOUT_REFERENCE.filter((t) => inReference(t))).toEqual([]);
    expect(new Set(TEXTS_WITHOUT_REFERENCE).size).toBe(TEXTS_WITHOUT_REFERENCE.length);
  });

  it('«Группа не найдена» и «Приём ответов закрыт» — не тексты эталона «Форм» (ревью W4.05)', () => {
    expect(inReference('Группа не найдена')).toBe(false);
    expect(inReference('Приём ответов закрыт')).toBe(false);
  });

  it('исходники msw/forms — UTF-8 без BOM', () => {
    const bom = MSW_FILES.filter((f) => readFileSync(at(`../src/msw/forms/${f}`))[0] === 0xef);
    expect(bom).toEqual([]);
  });
});
