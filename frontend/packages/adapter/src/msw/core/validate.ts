// Проверка тела запроса по схеме контракта (W0.13): неверный тип — 400 malformed_request (как DecodeStrict
// cmd/api), лишнее поле закрытой схемы — 400 unknown_field, нарушение ограничений — 422 validation_failed
// с violations `{field, code, message}`. Схемы — из contract.gen.json (ссылки раскрыты генератором).
import type { JsonSchema } from '../contract/index.ts';
import type { Violation } from './problem.ts';

export interface ValidationResult {
  malformed: string[];
  unknown: string[];
  violations: Violation[];
}

const MESSAGE: Readonly<Record<string, string>> = {
  required: 'Заполните поле',
  format: 'Неверный формат',
  enum: 'Недопустимое значение',
  length: 'Недопустимая длина',
  minimum: 'Значение меньше допустимого',
  maximum: 'Значение больше допустимого',
  unique: 'Значения повторяются',
};

const FORMATS: Readonly<Record<string, RegExp>> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  uri: /^[a-z][a-z0-9+.-]*:\S+$/i,
};

const typeOf = (v: unknown): string =>
  v === null
    ? 'null'
    : Array.isArray(v)
      ? 'array'
      : typeof v === 'number'
        ? Number.isInteger(v)
          ? 'integer'
          : 'number'
        : typeof v;

function typeMatches(schema: JsonSchema, v: unknown): boolean {
  if (!schema.type) return true;
  const types = [schema.type].flat();
  const t = typeOf(v);
  return types.includes(t) || (t === 'integer' && types.includes('number'));
}

const join = (path: string, key: string): string => (path ? `${path}.${key}` : key);

function walk(schema: JsonSchema, v: unknown, path: string, out: ValidationResult): void {
  const violation = (code: string) =>
    out.violations.push({ field: path || 'body', code, message: MESSAGE[code] ?? code });
  if (schema.oneOf || schema.anyOf) {
    oneOf(schema.oneOf ?? schema.anyOf ?? [], v, path, out);
    return;
  }
  for (const s of schema.allOf ?? []) walk(s, v, path, out);
  if (!typeMatches(schema, v)) {
    out.malformed.push(path || 'body');
    return;
  }
  if (schema.const !== undefined && v !== schema.const) violation('enum');
  if (schema.enum && !schema.enum.includes(v)) violation('enum');
  if (typeof v === 'string') {
    if (schema.minLength !== undefined && v.length < schema.minLength) {
      violation(v.length === 0 ? 'required' : 'length');
    } else if (schema.maxLength !== undefined && v.length > schema.maxLength) violation('length');
    else if (schema.pattern && !new RegExp(schema.pattern, 'u').test(v)) violation('format');
    else if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format]?.test(v)) {
      violation('format');
    }
  }
  if (typeof v === 'number') {
    if (schema.minimum !== undefined && v < schema.minimum) violation('minimum');
    if (schema.maximum !== undefined && v > schema.maximum) violation('maximum');
  }
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) violation('length');
    if (schema.maxItems !== undefined && v.length > schema.maxItems) violation('length');
    if (schema.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) {
      violation('unique');
    }
    if (schema.items) v.forEach((x, i) => walk(schema.items ?? {}, x, `${path}[${i}]`, out));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    const props = schema.properties ?? {};
    for (const k of Object.keys(obj)) {
      if (k in props) continue;
      if (schema.additionalProperties === false) out.unknown.push(join(path, k));
      else if (typeof schema.additionalProperties === 'object') {
        walk(schema.additionalProperties, obj[k], join(path, k), out);
      }
    }
    for (const k of schema.required ?? []) {
      if (obj[k] === undefined) {
        out.violations.push({
          field: join(path, k),
          code: 'required',
          message: MESSAGE.required ?? '',
        });
      }
    }
    for (const [k, s] of Object.entries(props)) {
      if (obj[k] !== undefined) walk(s, obj[k], join(path, k), out);
    }
    if (schema.minProperties !== undefined && Object.keys(obj).length < schema.minProperties) {
      violation('required');
    }
  }
}

const empty = (): ValidationResult => ({ malformed: [], unknown: [], violations: [] });
const clean = (r: ValidationResult): boolean =>
  !r.malformed.length && !r.unknown.length && !r.violations.length;

/** Ветка oneOf: первая без ошибок; иначе — та, чьи `const` совпали (дискриминатор), со своими ошибками. */
function oneOf(branches: JsonSchema[], v: unknown, path: string, out: ValidationResult): void {
  const results = branches.map((b) => {
    const r = empty();
    walk(b, v, path, r);
    return r;
  });
  if (results.some(clean)) return;
  const obj = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const i = branches.findIndex((b) =>
    Object.entries(b.properties ?? {}).some(
      ([k, s]) => s.const !== undefined && obj[k] === s.const,
    ),
  );
  const pick = results[i];
  if (pick) {
    out.malformed.push(...pick.malformed);
    out.unknown.push(...pick.unknown);
    out.violations.push(...pick.violations);
    return;
  }
  out.violations.push({ field: path || 'body', code: 'enum', message: MESSAGE.enum ?? '' });
}

/** Результат проверки `value` по `schema`; порядок violations — порядок полей схемы. */
export function validate(schema: JsonSchema, value: unknown): ValidationResult {
  const out = empty();
  walk(schema, value, '', out);
  return out;
}
