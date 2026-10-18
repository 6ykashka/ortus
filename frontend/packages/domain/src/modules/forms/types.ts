// Типы форм (models.js 14.10:80–115, api.js:65–118, 555–573, 846–864, mock-data.js:231–275).
// Срезы `forms` и `responses` добавляются в БД организации расширением `ModuleSlices` ядра.
// Базу знаний модуль читает структурно (`FormsKnowledge`): срез `knowledge` объявляет её владелец
// (W4.30), тип `KbTable` до выноса в `core/types` (B §5.1) живёт здесь.
import type { ModuleKey } from '../../core/types/index.ts';

/** Типы вопросов конструктора 14.10 (`statement` — текст без ответа, не вопрос). */
export type FieldType =
  | 'text'
  | 'longtext'
  | 'phone'
  | 'email'
  | 'inn'
  | 'choice'
  | 'multi'
  | 'select'
  | 'rating'
  | 'scale'
  | 'date'
  | 'bool'
  | 'photo'
  | 'int'
  | 'number'
  | 'person'
  | 'ref'
  | 'unit'
  | 'statement';

/** Вариант ответа; в старых версиях формы (сид 03.10) — просто строка. */
export interface FieldOption {
  id: string;
  label: string;
  /** Баллы варианта в тесте (`quiz`). */
  score?: number;
}

export interface ShowIfCond {
  field: string;
  /** «равно» / «не равно» (design/docs/20-forms.md «API прототипа»); в шаблонах 14.10 только `eq`. */
  op: 'eq' | 'ne';
  value: string;
}

/** Условие показа 14.10: «И» (`all`) или «ИЛИ» (`any`). Сид 03.10 хранит `{field, eq}`. */
export type ShowIf = { mode: 'all' | 'any'; conds: ShowIfCond[] } | { field: string; eq: string };

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  /** Пояснение, значение по умолчанию и скрытый вопрос (значение из `?id=…`) — формат черновика docs/20. */
  hint?: string;
  default?: string;
  hidden?: boolean;
  options?: (FieldOption | string)[];
  showIf?: ShowIf;
  /** Фото и файлы: что принимается, сколько и до скольких МБ. */
  accept?: 'photo' | 'docs';
  maxFiles?: number;
  maxMb?: number;
  /** Шкала: границы и подписи краёв. */
  scaleMin?: number;
  scaleMax?: number;
  left?: string;
  right?: string;
  /** Ссылка на объект CRM (`ref`). */
  refKind?: string;
  /** Страница черновика (`pN`) и её название. */
  page?: string;
  section?: string;
}

export interface FormPage {
  id: string;
  title: string;
  /** Перемешивать вопросы страницы. */
  shuffle?: boolean;
}

/** Определение формы: страницы и вопросы (черновик и аргумент `publishForm`). */
export interface FormDef {
  pages: FormPage[] | null;
  fields: FormField[];
}

/** Доступ к форме: сотрудники организации или публичная ссылка (гость). */
export type FormAccess = 'internal' | 'public';

export interface FormSettings {
  access: FormAccess;
  until: string;
  limit: number | null;
  onePerPerson: boolean;
  allowEdit: boolean;
  thanks: string;
  quiz: boolean;
  passScore: number | null;
  showScore: boolean;
  progress: boolean;
  backButton: boolean;
  logo: boolean;
  retainDays: number;
}

export type TemplateCat = 'basic' | 'survey' | 'people' | 'quiz' | 'industry';

export interface TemplatePage {
  title: string;
  fields: FormField[];
}

export interface FormTemplate {
  id: string;
  cat: TemplateCat;
  name: string;
  icon: string;
  /** Отраслевой модуль, без которого шаблон недоступен. */
  module: ModuleKey | null;
  settings?: Partial<FormSettings>;
  pages: TemplatePage[];
}

export interface FormVersion {
  v: number;
  at: string;
  by: string;
  fields: FormField[];
  pages?: FormPage[] | null;
}

/** Поле ответа, которое правило переносит в Базу знаний: столбец таблицы (`col`) или строка записи. */
export interface RuleField {
  col?: string;
  name: string;
  /** Переменная `FORM_VARS` или id вопроса. */
  src: string;
}

/**
 * Действие после ответа: задача менеджеру (`kind` нет или `'task'`) или «Сохранить в Базу знаний»
 * (`kind: 'kb'`, режимы `table` — строка таблицы, `entry` — запись на странице).
 */
export interface FormRule {
  id: string;
  kind?: 'task' | 'kb';
  text?: string;
  on: boolean;
  version?: number;
  mode?: 'table' | 'entry';
  page?: string;
  table?: string;
  pos?: 'top' | 'bottom';
  /**
   * Когда срабатывает: `accepted` (по умолчанию) — только принятый ответ; любое другое значение —
   * любой ответ. В эталоне встречается только `accepted`, второе значение задаст конструктор W4.22.
   */
  when?: string;
  /** Автор правила: действие выполняется с его правами. */
  by?: string;
  byId?: string;
  ack?: boolean;
  showLink?: boolean;
  /** Заголовок записи (`entry`), по умолчанию `$object`. */
  head?: string;
  cond?: { field: string; value: string | null } | null;
  fields?: RuleField[];
}

export type FormStatus = 'draft' | 'published' | 'closed';

export interface Form {
  id: string;
  name: string;
  module: ModuleKey | null;
  owner: string;
  status: FormStatus;
  /** Действующая версия; `null` — ещё не опубликована. */
  published: number | null;
  versions: FormVersion[];
  automations: FormRule[];
  settings?: FormSettings;
  /** Черновик без версии; сид 03.10 хранит массив полей. */
  draft?: FormDef | FormField[];
  unit?: string;
  template?: string | null;
  updated?: string;
}

/** Источник строки или записи БЗ: ответ, версия формы и версия правила. */
export interface KbSrc {
  form: string;
  resp: string;
  fv: number;
  rule: string;
  rv: number;
}

/** Результат действия правила по ответу (журнал `resp.actions`). */
export interface ActionResult {
  rule: string;
  rv: number;
  kind: 'kb';
  at: string;
  page?: string;
  ok: boolean;
  err?: string;
  text?: string;
  table?: string;
}

export type ResponseValue = string | string[];

export interface FormResponse {
  id: string;
  /** Ключ дедупликации ответа осмотра (`trip:dep:rev1`). */
  key?: string;
  formId: string;
  version: number;
  at: string;
  author: string;
  object: string;
  status: string;
  values: Record<string, ResponseValue | null | undefined>;
  actions?: ActionResult[];
}

export interface FormsSlices {
  forms?: Form[];
  responses?: FormResponse[];
}

// ── База знаний глазами форм (структурно; владелец среза — W4.30) ──

export interface FormsKbPage {
  id: string;
  title: string;
  space?: string;
  /** Старый уровень доступа страницы: `owner` — только владелец бизнеса. */
  access?: string;
}

export interface KbColumn {
  id: string;
  name: string;
  type: string;
}

export interface KbRow {
  id: string;
  at: string;
  src?: KbSrc;
  cells: Record<string, string>;
}

export interface KbTable {
  id: string;
  page: string;
  title: string;
  columns: KbColumn[];
  rows: KbRow[];
}

export interface KbEntry {
  id: string;
  page: string;
  at: string;
  head: string;
  lines: { name: string; value: string }[];
  src: KbSrc;
}

export interface FormsKnowledge {
  pages: FormsKbPage[];
  tables?: KbTable[];
  entries?: KbEntry[];
}

declare module '../../core/types/entities-core.ts' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ModuleSlices extends FormsSlices {}
}
