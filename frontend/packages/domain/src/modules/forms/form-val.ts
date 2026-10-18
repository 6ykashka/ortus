// Данные ответа для записи в Базу знаний (models.js 14.10:106–115): служебные значения (`FORM_VARS`)
// и ответы на вопросы. Файлы не копируются — в ячейке ссылка на ответ.
import type { Form, FormField, FormResponse } from './types.ts';

/** Предел длины значения ячейки или строки записи. */
export const FORM_VAL_MAX = 500;

function vars(f: Form | null | undefined, r: FormResponse): Record<string, unknown> {
  return {
    $at: r.at,
    $author: r.author,
    $object: r.object,
    $id: r.id,
    $form: f?.name,
    $ver: 'v' + String(r.version),
  };
}

/** Значение для ячейки или строки записи БЗ: `src` — переменная `FORM_VARS` или id вопроса. */
export function formVal(
  f: Form | null | undefined,
  r: FormResponse,
  src: string,
  fields: readonly FormField[] = [],
): string {
  const S = vars(f, r);
  if (Object.hasOwn(S, src)) {
    const s = S[src];
    return s == null ? '' : String(s as string);
  }
  const v = Object.hasOwn(r.values ?? {}, src) ? r.values[src] : undefined;
  if (v == null || v === '') return '';
  const x = fields.find((q) => q.id === src);
  if (x?.type === 'photo') return String(v) + ' · файлы в ответе ' + r.id;
  return (Array.isArray(v) ? v.join(', ') : v).slice(0, FORM_VAL_MAX);
}
