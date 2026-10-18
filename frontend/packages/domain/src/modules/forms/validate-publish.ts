// Проверки публикации формы 14.10 (api.js:559–567). Аргумент — `{pages, fields}` или старый формат
// (массив полей). Порядок проверок и тексты — дословно из эталона.
import { ApiError } from '../../core/errors/index.ts';
import { clone } from './clone.ts';
import type { FieldOption, FieldType, FormDef, FormField, FormSettings } from './types.ts';

/** Вопросы с вариантами ответа. */
export const CHOICE_TYPES: readonly FieldType[] = ['choice', 'multi', 'select'];
/** Вопросы, которые спрашивают справочники CRM: гостю публичной формы их не показать. */
export const CRM_TYPES: readonly FieldType[] = ['person', 'unit', 'ref'];

/** Определение в формате 14.10: старый массив полей → `{pages: null, fields}`. */
export function normalizeDef(def: FormDef | FormField[] | null | undefined): FormDef {
  if (Array.isArray(def)) return { pages: null, fields: def };
  return { pages: def?.pages ?? null, fields: def?.fields ?? [] };
}

const optionLabel = (o: FieldOption | string): string => (typeof o === 'string' ? o : o.label);

const invalid = (message: string): ApiError => new ApiError('validation', message);

/** Вопросы формы, готовые к публикации, или `ApiError('validation', …)` с текстом эталона. */
export function validatePublish(
  def: FormDef | FormField[] | null | undefined,
  settings: Partial<FormSettings> = {},
): FormField[] {
  const { fields } = normalizeDef(def);
  if (!fields.some((x) => x.type !== 'statement')) throw invalid('В форме нет ни одного вопроса');
  if (fields.some((x) => !String(x.label || '').trim())) throw invalid('У вопроса нет текста');
  const noOpt = fields.find(
    (x) => CHOICE_TYPES.includes(x.type) && !(x.options ?? []).some((o) => optionLabel(o).trim()),
  );
  if (noOpt) throw invalid('У вопроса «' + noOpt.label + '» нет вариантов ответа');
  if (settings.access === 'public') {
    const crm = fields.find((x) => CRM_TYPES.includes(x.type));
    if (crm) {
      throw invalid(
        'Публичная форма не может спрашивать «' +
          crm.label +
          '»: справочники CRM гостю не показываются',
      );
    }
  }
  const ids = new Set<string>();
  for (const x of fields) {
    if (ids.has(x.id)) throw invalid('Повторяется идентификатор вопроса ' + x.id);
    ids.add(x.id);
  }
  return fields;
}

/**
 * Вопросы новой версии `v`: копия, и если вопрос с тем же id в прошлой версии был другого типа —
 * id получает суффикс `-v<v>`, чтобы старые ответы не смешивались с новыми.
 */
export function nextVersionFields(
  fields: readonly FormField[],
  prev: readonly FormField[],
  v: number,
): FormField[] {
  return clone(fields).map((x) => {
    const old = prev.find((o) => o.id === x.id);
    if (old && old.type !== x.type) x.id = x.id + '-v' + String(v);
    return x;
  });
}
