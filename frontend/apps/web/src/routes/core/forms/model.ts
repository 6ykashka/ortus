// W4.22 · Модель «Форм и опросов» (эталон design-2026-10-19 «Формы и опросы.dc.html»): каталог типов (TYPES
// dc:474–482, TGROUPS, TCOL, COMMON), черновик в форме контракта FormDefinitionV2 (sortDef и правки конструктора
// dc:504–615), проблемы до публикации (issues dc:721–738 — то же правило, что FormDraft.issues W4.05), условия
// (condOk dc:499–503: ключи вариантов и true/false, Q-W4.00-forms-3), предпросмотр (pvPages, pvCheck, score
// dc:685–720), мета и флаги вопроса (dc:818–819), чипы (dc:759, 785), мета шаблона (dc:751), имена (uniq dc:561).
import type { components } from '@ortus/api-client';
import { forms as F, format } from '@ortus/texts';

type S = components['schemas'];
export type Def = S['FormDefinitionV2'];
export type Question = S['FormQuestion'];
export type QType = S['FormQuestionType'];
export type AnyType = QType | 'series' | 'payment';
export type ShowIf = S['FormShowIf'];

/** Значения предпросмотра: текст, ключ варианта, ключи (multi), 'true'/'false' (bool), число файлов. */
export type Vals = Readonly<Record<string, string | readonly string[] | undefined>>;

// ---------------------------------------------------------------------------------------------
// Каталог типов (TYPES dc:474–482)

export type Group = 'text' | 'choice' | 'crm' | 'other';

const T: Readonly<Record<AnyType, readonly [icon: string, group: Group]>> = {
  text: ['short_text', 'text'],
  longtext: ['notes', 'text'],
  number: ['pin', 'text'],
  money: ['payments', 'text'],
  email: ['mail', 'text'],
  phone: ['call', 'text'],
  inn: ['badge', 'text'],
  url: ['link', 'text'],
  choice: ['radio_button_checked', 'choice'],
  multi: ['check_box', 'choice'],
  select: ['arrow_drop_down_circle', 'choice'],
  bool: ['toggle_on', 'choice'],
  person: ['person_search', 'crm'],
  unit: ['account_tree', 'crm'],
  ref: ['dataset_linked', 'crm'],
  date: ['event', 'other'],
  int: ['tag', 'other'],
  scale: ['linear_scale', 'other'],
  rating: ['star', 'other'],
  photo: ['attach_file', 'other'],
  statement: ['format_quote', 'other'],
  series: ['library_add', 'other'],
  payment: ['credit_card', 'other'],
};

export const TYPE_KEYS = Object.keys(T) as AnyType[];
export const GROUPS: readonly Group[] = ['text', 'choice', 'crm', 'other'];
/** Частые вопросы выбора типа (COMMON dc:485). */
export const COMMON: readonly QType[] = [
  'text',
  'bool',
  'photo',
  'choice',
  'statement',
  'date',
  'int',
  'scale',
  'multi',
];
/** Цвета групп (TCOL dc:484). */
export const TCOL: Readonly<Record<Group, readonly [bg: string, fg: string]>> = {
  text: ['#E7EEF6', '#2B5479'],
  choice: ['#E3EFE7', '#1F6B52'],
  crm: ['#F6EDDC', '#7A5214'],
  other: ['#ECEAF4', '#4B4A7A'],
};

export const OPTS: readonly QType[] = ['choice', 'multi', 'select'];
export const CRM: readonly QType[] = ['person', 'unit', 'ref'];
export const NUM: readonly QType[] = ['number', 'int', 'money'];
export const TXT: readonly QType[] = ['text', 'longtext'];
const COND_SRC: readonly QType[] = [
  'choice',
  'select',
  'multi',
  'bool',
  'text',
  'number',
  'int',
  'scale',
  'rating',
  'email',
  'phone',
];

export interface TypeInfo {
  label: string;
  icon: string;
  group: Group;
  bg: string;
  fg: string;
  /** Причина недоступности (series, payment). */
  why?: string;
}

export function typeInfo(t: string): TypeInfo {
  const k = (t in T ? t : 'statement') as AnyType;
  const [icon, group] = T[k];
  const [bg, fg] = TCOL[group];
  const why = (F.typeWhy as Record<string, string>)[k];
  const label = t in T ? (F.types as Record<string, string>)[k] : t;
  return {
    label: label ?? t,
    icon: t in T ? icon : 'help',
    group,
    bg,
    fg,
    ...(why ? { why } : {}),
  };
}

export const isOff = (t: string): boolean => t === 'series' || t === 'payment';

// ---------------------------------------------------------------------------------------------
// Черновик

const clone = <X>(x: X): X => structuredClone(x);

/** Объект без полей со значением undefined. */
export const compact = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** sortDef эталона: хотя бы одна страница, вопрос без своей страницы — на первую, порядок — по страницам. */
export function normDef(d: Def): Def {
  const pages = d.pages.length ? d.pages : [{ id: 'p1', title: pageTitle(1) }];
  const first = pages[0]?.id ?? 'p1';
  const fields = d.fields.map((x) =>
    pages.some((p) => p.id === x.pageId) ? x : { ...x, pageId: first },
  );
  return { pages, fields: pages.flatMap((p) => fields.filter((x) => x.pageId === p.id)) };
}

export const pageTitle = (n: number): string => format(F.builder.page.title, { n });
const optionLabel = (n: number): string => format(F.builder.card.option, { n });
const defaultOptions = (): S['FormOption'][] => [
  { key: 'o1', label: optionLabel(1) },
  { key: 'o2', label: optionLabel(2) },
];

/** Новый вопрос типа `type` (newField dc:571–580). */
export function newQuestion(type: QType, pageId: string, rnd: string): Question {
  const x: Question = { key: `q-${type}-${rnd}`, pageId, type, label: '', required: false };
  if (OPTS.includes(type)) x.options = defaultOptions();
  if (type === 'scale') Object.assign(x, { scaleMin: 1, scaleMax: 5 });
  if (type === 'statement') x.label = F.builder.statementDefault;
  if (type === 'photo') Object.assign(x, { accept: 'photo', maxFiles: 5, maxFileMb: 20 });
  if (type === 'ref') x.refKind = 'vehicle';
  if (type === 'unit') x.unitLevel = 'any';
  return x;
}

/** Смена типа (changeType dc:587): недоступный тип не ставится. */
export function changeType(x: Question, t: QType): Question {
  if (isOff(t) || !(t in T)) return x;
  const out: Question = { ...x, type: t };
  if (OPTS.includes(t) && !(x.options ?? []).length) out.options = defaultOptions();
  if (t === 'scale' && x.scaleMax === undefined) Object.assign(out, { scaleMin: 1, scaleMax: 5 });
  return out;
}

const mapField = (d: Def, key: string, fn: (x: Question) => Question): Def => ({
  ...d,
  fields: d.fields.map((x) => (x.key === key ? fn(x) : x)),
});

/** Правка полей вопроса: undefined — удалить поле. */
export function setQ(d: Def, key: string, patch: Partial<Record<keyof Question, unknown>>): Def {
  return mapField(d, key, (x) => {
    const y: Record<string, unknown> = { ...x };
    for (const [k, v] of Object.entries(patch)) {
      y[k] = v;
    }
    return compact(y) as unknown as Question;
  });
}

/** Вопрос выше / ниже (moveQ dc:588–592): на границе страницы — переход на соседнюю. */
export function moveQuestion(d: Def, key: string, dir: -1 | 1): Def {
  const fields = [...d.fields];
  const i = fields.findIndex((y) => y.key === key);
  const x = fields[i];
  const n = fields[i + dir];
  if (!x || !n) return d;
  if (n.pageId === x.pageId) {
    fields[i] = n;
    fields[i + dir] = x;
  } else fields[i] = { ...x, pageId: n.pageId };
  return normDef({ ...d, fields });
}

/** Страницу выше / ниже (movePage dc:593). */
export function movePage(d: Def, pid: string, dir: -1 | 1): Def {
  const i = d.pages.findIndex((p) => p.id === pid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.pages.length) return d;
  const pages = [...d.pages];
  [pages[i], pages[j]] = [pages[j] as Def['pages'][number], pages[i] as Def['pages'][number]];
  return normDef({ ...d, pages });
}

/** Добавить страницу «Страница N» (addPage dc:594). */
export function addPage(d: Def, id: string): Def {
  return { ...d, pages: [...d.pages, { id, title: pageTitle(d.pages.length + 1) }] };
}

/** Дублировать вопрос (dupQ dc:595): ключ «…-copy-xxxx», подпись «… (копия)», вставка следом. */
export function duplicateQuestion(d: Def, key: string, rnd: string): { def: Def; key: string } {
  const i = d.fields.findIndex((y) => y.key === key);
  const src = d.fields[i];
  if (!src) return { def: d, key };
  const nkey = `${key.replace(/-copy.*$/, '')}-copy-${rnd}`;
  const c: Question = {
    ...clone(src),
    key: nkey,
    label: format(F.builder.card.copy, { label: src.label }),
  };
  const fields = [...d.fields];
  fields.splice(i + 1, 0, c);
  return { def: { ...d, fields }, key: nkey };
}

export type Undo =
  | { kind: 'q'; text: string; fields: Question[]; qi: number }
  | { kind: 'page'; text: string; page: Def['pages'][number]; pi: number; fields: Question[] };

/** Удалить вопрос с отменой (delQ dc:596–600). */
export function deleteQuestion(d: Def, key: string): { def: Def; undo: Undo } {
  const qi = d.fields.findIndex((y) => y.key === key);
  const x = d.fields[qi] as Question;
  const text = format(F.builder.undoQuestion, { label: x.label || typeInfo(x.type).label });
  return {
    def: { ...d, fields: d.fields.filter((y) => y.key !== key) },
    undo: { kind: 'q', text, fields: [clone(x)], qi },
  };
}

/** Удалить страницу вместе с вопросами (delPage dc:601–606); единственную — нельзя. */
export function deletePage(d: Def, pid: string): { def: Def; undo: Undo } | null {
  if (d.pages.length < 2) return null;
  const pi = d.pages.findIndex((p) => p.id === pid);
  const page = d.pages[pi];
  if (!page) return null;
  const fields = d.fields.filter((x) => x.pageId === pid);
  const text = format(F.builder.undoPage, {
    title: page.title || pageTitle(pi + 1),
    n: fields.length,
  });
  return {
    def: {
      pages: d.pages.filter((p) => p.id !== pid),
      fields: d.fields.filter((x) => x.pageId !== pid),
    },
    undo: { kind: 'page', text, page: clone(page), pi, fields: clone(fields) },
  };
}

/** «Восстановить» (doUndo dc:607). */
export function restore(d: Def, u: Undo): Def {
  if (u.kind === 'page') {
    const pages = [...d.pages];
    pages.splice(Math.min(u.pi, pages.length), 0, clone(u.page));
    return normDef({ pages, fields: [...d.fields, ...clone(u.fields)] });
  }
  const fields = [...d.fields];
  fields.splice(Math.min(u.qi, fields.length), 0, ...clone(u.fields));
  return normDef({ ...d, fields });
}

/** «Добавить вариант» (dc:864): «Вариант N» со свободным ключом oK. */
export function addOption(d: Def, key: string): Def {
  return mapField(d, key, (x) => {
    const opts = [...(x.options ?? [])];
    const n = opts.length + 1;
    let k = n;
    while (opts.some((o) => o.key === `o${k}`)) k++;
    opts.push({ key: `o${k}`, label: optionLabel(n) });
    return { ...x, options: opts };
  });
}

export function setOption(d: Def, key: string, oi: number, patch: Partial<S['FormOption']>): Def {
  return mapField(d, key, (x) => ({
    ...x,
    options: (x.options ?? []).map((o, i) => {
      if (i !== oi) return o;
      const y: Record<string, unknown> = { ...o, ...patch };
      return compact(y) as unknown as S['FormOption'];
    }),
  }));
}

export function removeOption(d: Def, key: string, oi: number): Def {
  return mapField(d, key, (x) => ({ ...x, options: (x.options ?? []).filter((_, i) => i !== oi) }));
}

// ---------------------------------------------------------------------------------------------
// Идентификатор вопроса (setId dc:609–615)

const KEY_RULE = /^[a-zA-Z][a-zA-Z0-9_-]{1,59}$/;

export function idError(d: Def, x: Question, text: string): string | null {
  const t = text.trim();
  if (!KEY_RULE.test(t)) return F.builder.card.idBad;
  if (d.fields.some((y) => y.key === t && y !== x && y.key !== x.key))
    return F.builder.card.idTaken;
  return null;
}

/** Новый ключ вопроса; ссылки условий показа переименовываются. */
export function renameKey(d: Def, from: string, to: string): Def {
  return {
    ...d,
    fields: d.fields.map((y) => {
      const z = y.key === from ? { ...y, key: to } : y;
      if (!z.showIf) return z;
      return {
        ...z,
        showIf: {
          ...z.showIf,
          conditions: z.showIf.conditions.map((c) =>
            c.fieldKey === from ? { ...c, fieldKey: to } : c,
          ),
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Условия показа

/** Вопросы выше `key`, от которых может зависеть показ (srcs dc:843). */
export function condSources(d: Def, key: string): Question[] {
  const i = d.fields.findIndex((y) => y.key === key);
  return d.fields.slice(0, Math.max(0, i)).filter((y) => COND_SRC.includes(y.type));
}

/** Значения условия: «Да / Нет» — true/false, варианты — ключ и подпись; иначе — поле ввода (vals dc:844). */
export function condValues(y: Question | undefined): [string, string][] | null {
  if (!y) return null;
  if (y.type === 'bool') {
    return [
      ['true', F.builder.card.bool.yes],
      ['false', F.builder.card.bool.no],
    ];
  }
  if (OPTS.includes(y.type)) return (y.options ?? []).map((o) => [o.key, o.label]);
  return null;
}

/** «Показывать при условии» / «Добавить условие» (addC dc:847). */
export function addCondition(d: Def, key: string): Def {
  const srcs = condSources(d, key);
  const src = srcs.at(-1);
  if (!src) return d;
  const v = condValues(src);
  return mapField(d, key, (x) => {
    const c: ShowIf = x.showIf ? clone(x.showIf) : { mode: 'all', conditions: [] };
    c.conditions.push({ fieldKey: src.key, operator: 'equals', value: v?.[0]?.[0] ?? '' });
    return { ...x, showIf: c };
  });
}

/** Правка условий; без условий — поле `showIf` убирается. */
export function setConditions(d: Def, key: string, fn: (c: ShowIf) => void): Def {
  return mapField(d, key, (x) => {
    const c: ShowIf = x.showIf ? clone(x.showIf) : { mode: 'all', conditions: [] };
    fn(c);
    return compact({ ...x, showIf: c.conditions.length ? c : undefined }) as Question;
  });
}

const lower = (v: unknown): string => String(v ?? '').toLowerCase();

/** condOk эталона: «И» — все, «ИЛИ» — любое; список — содержит; текст — без регистра. */
export function condOk(c: ShowIf | undefined, vals: Vals): boolean {
  if (!c?.conditions.length) return true;
  const r = c.conditions.map((k) => {
    const v = vals[k.fieldKey];
    const has = Array.isArray(v) ? v.includes(k.value) : lower(v) === lower(k.value);
    return k.operator === 'not_equals' ? !has : has;
  });
  return c.mode === 'any' ? r.some(Boolean) : r.every(Boolean);
}

/** Подпись значения условия: вариант — подпись, «Да / нет» — «да» / «нет», иначе — как есть. */
function condLabel(src: Question | undefined, value: string): string {
  if (src?.type === 'bool') {
    return value === 'true'
      ? F.builder.boolValues.true
      : value === 'false'
        ? F.builder.boolValues.false
        : value;
  }
  return src?.options?.find((o) => o.key === value)?.label ?? value;
}

/** condText dc:812: «вопрос» = значение, «и» / «или». */
export function condText(c: ShowIf, d: Def): string {
  const sep = ` ${c.mode === 'any' ? F.builder.condOr : F.builder.condAnd} `;
  return c.conditions
    .map((k) => {
      const src = d.fields.find((x) => x.key === k.fieldKey);
      return format(F.builder.condPart, {
        label: src?.label || k.fieldKey,
        op: k.operator === 'not_equals' ? '≠' : '=',
        value: condLabel(src, k.value),
      });
    })
    .join(sep);
}

// ---------------------------------------------------------------------------------------------
// Мета, флаги, чипы

/** Мета свёрнутого вопроса (qmeta dc:818). */
export function qmeta(x: Question, d: Def): string {
  const p = [typeInfo(x.type).label];
  if (x.required && x.type !== 'statement') p.push(F.builder.required);
  if (OPTS.includes(x.type)) p.push(format(F.builder.options, { n: (x.options ?? []).length }));
  if (x.showIf?.conditions.length) p.push(format(F.builder.cond, { text: condText(x.showIf, d) }));
  return p.join(' · ');
}

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';
export interface Chip {
  label: string;
  tone: Tone;
  icon: string;
}

/** Флаг вопроса относительно действующей версии (flagOf dc:819). */
export function flagOf(
  x: Question,
  prev: ReadonlyMap<string, Question>,
  published: boolean,
): Chip | null {
  if (!published) return null;
  const o = prev.get(x.key);
  if (!o) return { label: F.builder.flags.added, tone: 'ok', icon: '' };
  if (o.type !== x.type) return { label: F.builder.flags.newType, tone: 'warn', icon: '' };
  if (!sameValue(o, x)) return { label: F.builder.flags.changed, tone: 'info', icon: '' };
  return null;
}

type FormState = Pick<S['Form'], 'status' | 'publishedVersionNumber' | 'hasUnpublishedChanges'>;

/** Чип строки списка (dc:759). */
export function chipOf(f: FormState): Chip {
  const v = f.publishedVersionNumber ?? 0;
  if (f.status === 'draft' || !f.publishedVersionNumber)
    return { label: F.chips.draft, tone: 'neutral', icon: 'edit_note' };
  if (f.status === 'closed')
    return { label: format(F.chips.closed, { v }), tone: 'neutral', icon: 'block' };
  if (f.hasUnpublishedChanges)
    return { label: format(F.chips.changed, { v }), tone: 'warn', icon: 'edit_note' };
  return { label: format(F.chips.open, { v }), tone: 'ok', icon: 'check_circle' };
}

/** Чип шапки редактора (dc:785): `dirty` — черновик отличается от действующей версии. */
export function editorChip(f: FormState, dirty: boolean): Chip {
  const v = f.publishedVersionNumber ?? 0;
  if (f.status === 'draft' || !f.publishedVersionNumber)
    return { label: F.chips.draftEditor, tone: 'neutral', icon: 'edit_note' };
  if (f.status === 'closed')
    return { label: format(F.chips.closed, { v }), tone: 'neutral', icon: 'block' };
  if (dirty)
    return { label: format(F.chips.changedEditor, { v }), tone: 'warn', icon: 'edit_note' };
  return { label: format(F.chips.open, { v }), tone: 'ok', icon: 'check_circle' };
}

/** Мета шаблона (tmeta dc:751). */
export function templateMeta(
  t: Pick<S['FormTemplate'], 'questionCount' | 'pageCount' | 'available'>,
  moduleName: string | null,
): string {
  const parts: string[] = [];
  if (moduleName) parts.push(moduleName);
  parts.push(format(F.list.questions, { n: t.questionCount }));
  if (t.pageCount > 1) parts.push(format(F.list.pages, { n: t.pageCount }));
  if (!t.available) parts.push(F.list.moduleOffMeta);
  return parts.join(' · ');
}

/** Имя без совпадения: « · 2», « · 3»… без учёта регистра (uniq dc:561). */
export function uniqName(names: readonly string[], base: string): string {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  let n = base;
  for (let k = 2; taken.has(n.toLowerCase()); k++) n = format(F.list.clash, { name: base, k });
  return n;
}

/** Момент контракта → «ДД.ММ» по Москве (дата `updated` эталона). */
export function dayMonth(iso: string): string {
  const d = new Date(Date.parse(iso) + 3 * 3600_000).toISOString();
  return `${d.slice(8, 10)}.${d.slice(5, 7)}`;
}

/** Склонение эталона pl() (dc:494). */
export function pl(n: number, a: string, b: string, c: string): string {
  const m = Math.abs(n) % 100;
  const k = m % 10;
  return m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c;
}

// ---------------------------------------------------------------------------------------------
// Проблемы до публикации (issues dc:721–738)

export interface Issues {
  E: string[];
  W: string[];
}

export function issuesOf(d: Def, settings: Pick<S['FormSettings'], 'access' | 'scoring'>): Issues {
  const E: string[] = [];
  const W: string[] = [];
  const idx = new Map<string, number>();
  d.fields.forEach((x, i) => {
    if (!idx.has(x.key)) idx.set(x.key, i);
  });
  if (!d.fields.some((x) => x.type !== 'statement')) E.push(F.issues.noQuestions);
  const seen = new Set<string>();
  d.fields.forEach((x, i) => {
    const t = x.label.trim();
    const name = t ? `«${t}»` : format(F.issues.questionN, { n: i + 1 });
    if (!t) E.push(format(F.issues.noText, { name }));
    const opts = x.options ?? [];
    if (OPTS.includes(x.type) && !opts.some((o) => o.label.trim()))
      E.push(format(F.issues.noOptions, { name }));
    else if (OPTS.includes(x.type) && opts.some((o) => !o.label.trim()))
      E.push(format(F.issues.emptyOption, { name }));
    if (seen.has(x.key)) E.push(format(F.issues.duplicateId, { id: x.key }));
    seen.add(x.key);
    for (const c of x.showIf?.conditions ?? []) {
      const j = idx.get(c.fieldKey);
      if (j === undefined) E.push(format(F.issues.condDeleted, { name }));
      else if (j >= i) E.push(format(F.issues.condBelow, { name }));
    }
    if (x.hidden && x.required && !(x.defaultValue ?? '').trim())
      E.push(format(F.issues.hiddenRequired, { name }));
    const lo = TXT.includes(x.type) ? x.minLength : NUM.includes(x.type) ? x.minValue : undefined;
    const hi = TXT.includes(x.type) ? x.maxLength : NUM.includes(x.type) ? x.maxValue : undefined;
    if (
      lo !== undefined &&
      hi !== undefined &&
      String(lo) !== '' &&
      String(hi) !== '' &&
      num(lo) > num(hi)
    )
      E.push(format(F.issues.range, { name }));
  });
  if (settings.access === 'public') {
    for (const x of d.fields.filter((y) => CRM.includes(y.type)))
      E.push(format(F.issues.publicCrm, { label: x.label }));
  }
  if (settings.scoring && !d.fields.some((x) => (x.options ?? []).some((o) => Number(o.score) > 0)))
    W.push(F.issues.noScores);
  return { E, W };
}

const num = (v: unknown): number => Number(String(v).replace(/\s/g, '').replace(',', '.'));

// ---------------------------------------------------------------------------------------------
// Предпросмотр

/** Хеш эталона (dc:496) — порядок перемешивания по зерну. */
export function hash(t: string): number {
  let h = 0;
  for (const c of t) h = (h * 31 + (c.codePointAt(0) ?? 0)) | 0;
  return h;
}

export interface PvPage {
  page: Def['pages'][number];
  qs: Question[];
}

/** Страницы предпросмотра: без скрытых и не показанных по условию, пустые страницы пропускаются (pvPages dc:685). */
export function pvPages(d: Def, vals: Vals, seed: string): PvPage[] {
  return d.pages
    .map((p) => {
      let qs = d.fields.filter((x) => x.pageId === p.id && !x.hidden && condOk(x.showIf, vals));
      if (p.shuffle) qs = [...qs].sort((a, b) => hash(a.key + seed) - hash(b.key + seed));
      return { page: p, qs };
    })
    .filter((x) => x.qs.length);
}

const filled = (v: Vals[string]): boolean =>
  !(v === undefined || v === '' || (Array.isArray(v) && !v.length));

/** Проверка ответа (pvCheck dc:688–705), тексты эталона. */
export function pvCheck(x: Question, v: Vals[string]): string | null {
  const E = F.preview.errors;
  const t = x.type;
  if (!filled(v)) return x.required && t !== 'statement' ? E.required : null;
  const s = Array.isArray(v) ? v.join(', ') : String(v);
  const n = num(s);
  const dig = s.replace(/\D/g, '');
  if (t === 'email' && !/^\S+@\S+\.\S+$/.test(s)) return E.email;
  if (t === 'phone' && dig.length < 10) return E.phone;
  if (t === 'inn' && !(dig.length === 10 || dig.length === 12)) return E.inn;
  if (t === 'url' && !/^https?:\/\/\S+/.test(s)) return E.url;
  if ((t === 'number' || t === 'money') && Number.isNaN(n)) return E.number;
  if (t === 'int' && !/^-?\d+$/.test(s.trim())) return E.int;
  if (NUM.includes(t) && x.minValue !== undefined && x.minValue !== '' && n < num(x.minValue))
    return format(E.min, { n: x.minValue });
  if (NUM.includes(t) && x.maxValue !== undefined && x.maxValue !== '' && n > num(x.maxValue))
    return format(E.max, { n: x.maxValue });
  if (TXT.includes(t) && x.minLength !== undefined && s.length < x.minLength)
    return format(E.minLength, { n: x.minLength });
  if (TXT.includes(t) && x.maxLength !== undefined && s.length > x.maxLength)
    return format(E.maxLength, { n: x.maxLength });
  const count = Array.isArray(v) ? v.length : 0;
  if (t === 'multi' && x.minSelected && count < x.minSelected)
    return format(E.minSelected, { n: x.minSelected });
  if (t === 'multi' && x.maxSelected && count > x.maxSelected)
    return format(E.maxSelected, { n: x.maxSelected });
  return null;
}

/** Баллы теста (score dc:712–720): показанные вопросы выбора. */
export function scoreOf(d: Def, vals: Vals): { got: number; max: number } {
  let got = 0;
  let max = 0;
  for (const x of d.fields.filter(
    (y) => OPTS.includes(y.type) && !y.hidden && condOk(y.showIf, vals),
  )) {
    const opts = x.options ?? [];
    const sc = opts.map((o) => Number(o.score) || 0);
    const v = vals[x.key];
    const pick = (k: string) => Number(opts.find((o) => o.key === k)?.score) || 0;
    if (x.type === 'multi') {
      max += sc.filter((k) => k > 0).reduce((a, k) => a + k, 0);
      for (const k of Array.isArray(v) ? v : []) got += pick(k);
    } else {
      max += Math.max(0, ...sc);
      if (typeof v === 'string') got += pick(v);
    }
  }
  return { got, max };
}

/** Начальные значения предпросмотра — значения по умолчанию (dc:796): подпись варианта → ключ, «да» → true. */
export function previewDefaults(d: Def): Record<string, string> {
  const out: Record<string, string> = {};
  for (const x of d.fields) {
    const v = x.defaultValue;
    if (!v) continue;
    if (x.type === 'bool') {
      const b = v.trim().toLowerCase();
      out[x.key] = b === 'да' || b === 'true' ? 'true' : b === 'нет' || b === 'false' ? 'false' : v;
    } else if (OPTS.includes(x.type)) {
      const o = (x.options ?? []).find(
        (y) => y.key === v || y.label.trim().toLowerCase() === v.trim().toLowerCase(),
      );
      out[x.key] = o ? o.key : v;
    } else out[x.key] = v;
  }
  return out;
}

/** Порядок вариантов (ord dc:1026): по алфавиту или по зерну. */
export function ordered<X extends { label: string; key: string }>(
  list: readonly X[],
  order: Question['optionOrder'],
  seed: string,
): X[] {
  if (order === 'alpha') return [...list].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  if (order === 'random') return [...list].sort((a, b) => hash(a.key + seed) - hash(b.key + seed));
  return [...list];
}

// ---------------------------------------------------------------------------------------------
// Сохранение и сравнение

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;
const intIn = (v: unknown, lo: number, hi: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Определение для `saveFormDraft`: неверные числа (ввод «1,», «-», вне пределов контракта) не отправляются — сервер
 * проверяет схему (422); запятая → точка. Локальный черновик остаётся как введено.
 */
export function cleanDef(d: Def): Def {
  return {
    pages: d.pages.map((p) => ({ ...p })),
    fields: d.fields.map((x) => {
      const y: Record<string, unknown> = { ...x };
      for (const k of ['minValue', 'maxValue'] as const) {
        if (y[k] === undefined) continue;
        const s = String(y[k]).replace(/\s/g, '').replace(',', '.');
        if (DECIMAL.test(s)) y[k] = s;
        else y[k] = undefined;
      }
      const ints: [keyof Question, number, number][] = [
        ['minLength', 0, 10000],
        ['maxLength', 1, 10000],
        ['minSelected', 1, 100],
        ['maxSelected', 1, 100],
        ['maxFiles', 1, 20],
        ['maxFileMb', 1, 100],
        ['scaleMax', 3, 10],
      ];
      for (const [k, lo, hi] of ints)
        if (y[k] !== undefined && !intIn(y[k], lo, hi)) y[k] = undefined;
      if (y.options)
        y.options = (x.options ?? []).map((o) => {
          const z: Record<string, unknown> = { ...o };
          if (z.score !== undefined && !intIn(z.score, -1000, 1000)) z.score = undefined;
          return compact(z);
        });
      return compact(y) as unknown as Question;
    }),
  };
}

/** JSON без undefined и с упорядоченными ключами объектов. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canon(x);
    }
    return out;
  }
  return v;
}

export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export const sameDef = (a: Def | null | undefined, b: Def | null | undefined): boolean =>
  sameValue(a ?? null, b ?? null);
