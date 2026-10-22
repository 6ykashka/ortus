// W4.23 · Модель вкладок редактора формы «Формы и опросы» (эталон design-2026-10-19 «Формы и опросы.dc.html»):
// «Настройки» (settingsVM dc:880–898), «Действия после ответа» (actionsVM dc:915–984, kbVM dc:931–963), «Ответы»
// (respVM dc:986–1011, actsVM dc:907–914), «Версии» (versVM dc:1012–1020), «Поделиться формой» (modalVM
// dc:1081–1087). Шапка редактора — W4.22. Данные — схемы контракта 0.11.0-stage4 (тег Forms): ответы хранят ключи
// вариантов, подписи берутся из версии ответа (Q-W4.00-forms-3).
import type { components } from '@ortus/api-client';
import { format, forms as FM, formsResults as F } from '@ortus/texts';

import { FR_TEXT } from './texts.ts';

type S = components['schemas'];
export type Form = S['Form'];
export type Def = S['FormDefinitionV2'];
export type Question = S['FormQuestion'];
export type QType = S['FormQuestionType'];
export type Version = S['FormVersion'];
export type Rule = S['FormRule'];
export type Response = S['FormResponse'];
export type Value = S['FieldValue'];
export type Summary = S['FormResponseSummary'];

export const OPTS: readonly QType[] = ['choice', 'multi', 'select'];
export const CRM: readonly QType[] = ['person', 'unit', 'ref'];

/** Тон чипа эталона (TONE dc:490). */
export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

/** Значки типов вопросов (TYPES dc:474–482). */
export const TYPE_ICON: Readonly<Record<QType, string>> = {
  text: 'short_text',
  longtext: 'notes',
  number: 'pin',
  money: 'payments',
  email: 'mail',
  phone: 'call',
  inn: 'badge',
  url: 'link',
  choice: 'radio_button_checked',
  multi: 'check_box',
  select: 'arrow_drop_down_circle',
  bool: 'toggle_on',
  person: 'person_search',
  unit: 'account_tree',
  ref: 'dataset_linked',
  date: 'event',
  int: 'tag',
  scale: 'linear_scale',
  rating: 'star',
  photo: 'attach_file',
  statement: 'format_quote',
};

export const typeLabel = (t: QType): string => FM.types[t];

// ---------------------------------------------------------------------------------------------
// Даты эталона (по Москве): ответы — «ДД.ММ ЧЧ:ММ», версии — «ДД.ММ.ГГГГ»

const msk = (iso: string): string => new Date(Date.parse(iso) + 3 * 3600_000).toISOString();

export function dayTime(iso: string): string {
  const d = msk(iso);
  return `${d.slice(8, 10)}.${d.slice(5, 7)} ${d.slice(11, 16)}`;
}

export function day(iso: string): string {
  const d = msk(iso);
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
}

/** Число эталона (fmt dc:497): группы разрядов, до одного знака после запятой. */
export const num = (x: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(x);

const plural = (n: number, one: string, few: string, many: string): string => {
  const m = Math.abs(n) % 100;
  const k = m % 10;
  return m > 10 && m < 20 ? many : k > 1 && k < 5 ? few : k === 1 ? one : many;
};

// ---------------------------------------------------------------------------------------------
// Модуль формы (modName dc:550): отраслевой модуль или «Общая» — имя пространства «Базы знаний» по умолчанию

export const moduleName = (key: string | null): string =>
  (key && (FM.list.modules as Readonly<Record<string, string>>)[key]) || FM.list.general;

export interface Unit {
  id: string;
  name: string;
  kind: 'region' | 'firm';
}

// ---------------------------------------------------------------------------------------------
// «Настройки»

export type Access = 'members' | 'public' | 'invite';

export interface AccessOption {
  value: Access;
  label: string;
  desc: string;
  sel: boolean;
  /** Недоступен: только просмотр, вопросы CRM, нет права «Публичные ссылки», приглашения — позже. */
  off: boolean;
  /** Подсказка недоступного режима (title, как у недоступных вариантов эталона dc:943). */
  why?: string;
}

/** Вопросы CRM черновика и действующей версии — «Недоступно: … — «…».» (dc:886, dc:890). */
export function crmQuestions(defs: readonly (Def | undefined)[]): string[] {
  const out: string[] = [];
  for (const d of defs) {
    for (const q of d?.fields ?? []) {
      const name = `«${q.label}»`;
      if (CRM.includes(q.type) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/**
 * Режимы «Кто может ответить» (dc:890): выбранный не отключается; «Все, у кого есть ссылка» — без права «Публичные
 * ссылки» или при вопросах CRM недоступен (Q-W4.00-forms-11); «По персональному приглашению» — позже
 * (Q-W4.00-forms-10, подсказка `inviteLater`).
 */
export function accessOptions(
  f: Form,
  crm: readonly string[],
  ro: boolean,
  inviteLater: string,
): AccessOption[] {
  const cur = f.settings.access;
  const A = F.settings.access;
  return [
    {
      value: 'members',
      label: A.members.label,
      desc: A.members.desc,
      sel: cur === 'members',
      off: cur !== 'members' && ro,
    },
    {
      value: 'public',
      label: A.public.label,
      desc: crm.length ? format(A.crm, { list: crm.join(', ') }) : A.public.desc,
      sel: cur === 'public',
      off: cur !== 'public' && (ro || crm.length > 0 || !f.my.publishPublic),
    },
    {
      value: 'invite',
      label: A.invite.label,
      desc: A.invite.desc,
      why: inviteLater,
      sel: false,
      off: true,
    },
  ];
}

/** «Область формы» (dc:891): «Вся организация» и подразделения «{имя} · регион | · фирма». */
export function areaOptions(units: readonly Unit[]): { value: string; label: string }[] {
  return [
    { value: '', label: F.settings.area.whole },
    ...units.map((u) => ({
      value: u.id,
      label: format(u.kind === 'region' ? F.settings.area.region : F.settings.area.firm, {
        name: u.name,
      }),
    })),
  ];
}

/** «Не больше ответов всего», «Проходной балл» (numOrNull dc:885): цифры или null. */
export function numOrNull(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  return Number(s.replace(/\D/g, ''));
}

/** «Максимум по форме» (dc:887): сумма лучших баллов вопросов выбора. */
export function maxScore(d: Def | undefined): number {
  let max = 0;
  for (const q of d?.fields ?? []) {
    if (!OPTS.includes(q.type)) continue;
    const sc = (q.options ?? []).map((o) => o.score ?? 0);
    max +=
      q.type === 'multi' ? sc.filter((k) => k > 0).reduce((a, k) => a + k, 0) : Math.max(0, ...sc);
  }
  return max;
}

/** Срок хранения словами (RET dc:927). */
export function retainText(days: number): string {
  const I = F.settings.intake;
  return days === 90 ? I.d90 : days === 1095 ? I.d1095 : I.d365;
}

// ---------------------------------------------------------------------------------------------
// «Действия после ответа»

export const KIND_ICON: Readonly<Record<S['FormRuleKind'], string>> = {
  task: 'add_task',
  notify: 'notifications',
  email: 'mail',
  http: 'webhook',
  kb: 'menu_book',
};

export const KINDS: readonly S['FormRuleKind'][] = ['task', 'notify', 'email', 'http', 'kb'];

/** Подписи вопросов всех известных определений по ключу (черновик, затем версии — новая первой). */
export function labelsByKey(defs: readonly (Def | undefined)[]): Map<string, Question> {
  const m = new Map<string, Question>();
  for (const d of defs) for (const q of d?.fields ?? []) if (!m.has(q.key)) m.set(q.key, q);
  return m;
}

/** Значение условия «Только если» словами: подпись варианта, «да» / «нет». */
export function condValueText(q: Question | undefined, value: string): string {
  if (!q) return value;
  if (q.type === 'bool')
    return value === 'true' ? F.actions.yes : value === 'false' ? F.actions.no : value;
  return q.options?.find((o) => o.key === value)?.label ?? value;
}

/**
 * Текст карточки (dc:922–923). `who` — имя участника по id. «без исполнителя» — только когда исполнитель не задан;
 * задан, но имени участник не видит (listMembers логиста — его область) — `FR_TEXT.memberHidden`. Без «Настраивать»
 * контракт не отдаёт объект письма и запроса (Q-W4.05-18) — «адрес видят только настраивающие форму».
 */
export function ruleText(r: Rule, who: (id: string) => string | undefined): string {
  const T = F.actions.text;
  const name = (id: string | undefined) => (id ? (who(id) ?? FR_TEXT.memberHidden) : undefined);
  if (r.kind === 'task')
    return format(T.task, {
      title: r.task?.title ?? '',
      who: name(r.task?.assigneeMemberId) ?? T.noAssignee,
    });
  if (r.kind === 'notify')
    return format(T.notify, { who: name(r.notify?.memberId) ?? FR_TEXT.memberHidden });
  if (r.kind === 'email')
    return r.email ? format(T.email, { to: r.email.to }) : FR_TEXT.emailHidden;
  if (r.kind === 'http') return r.http ? format(T.http, { url: r.http.url }) : FR_TEXT.httpHidden;
  const page = r.kb?.node?.title ?? T.unavailable;
  return r.kb?.mode === 'entry'
    ? format(T.kbEntry, { page })
    : format(T.kbTable, { table: r.kb?.tableTitle ?? '—', page });
}

/** Мета карточки (dc:969): когда · если «…» = … · правило vN · записано ответов: N. */
export function ruleMeta(r: Rule, qs: Map<string, Question>): string {
  const M = F.actions.meta;
  const parts: string[] = [F.actions.when[r.trigger]];
  const c = r.condition;
  if (c.fieldKey) {
    const q = qs.get(c.fieldKey);
    parts.push(
      format(M.cond, { label: q?.label ?? c.fieldKey, value: condValueText(q, c.value ?? '') }),
    );
  }
  parts.push(format(M.version, { n: r.version }));
  if (r.kind === 'kb') parts.push(format(M.written, { n: r.doneCount }));
  return parts.join(' · ');
}

/** «Только если»: вопросы выбора и «Да / нет» (srcs dc:924). */
export function condFields(d: Def | undefined): { value: string; label: string }[] {
  return (d?.fields ?? [])
    .filter((q) => OPTS.includes(q.type) || q.type === 'bool')
    .map((q) => ({ value: q.key, label: q.label || typeLabel(q.type) }));
}

/** «равно»: варианты вопроса (ключи) или «да» / «нет» (vals dc:925). */
export function condValues(d: Def | undefined, key: string): { value: string; label: string }[] {
  const q = d?.fields.find((x) => x.key === key);
  if (!q) return [];
  if (q.type === 'bool')
    return [
      { value: 'true', label: F.actions.yes },
      { value: 'false', label: F.actions.no },
    ];
  return (q.options ?? []).map((o) => ({ value: o.key, label: o.label }));
}

// --- «Сохранить в Базу знаний» ---

export interface KbField {
  columnId?: string;
  name: string;
  source: string;
}

const VAR_KEYS = ['at', 'author', 'object', 'id', 'form', 'ver'] as const;

/** Источники данных (kbSrcs dc:900): переменные FORM_VARS и вопросы черновика без «Текст без вопроса». */
export function kbSources(d: Def | undefined): { value: string; label: string }[] {
  return [
    ...VAR_KEYS.map((k) => ({ value: `$${k}`, label: F.vars[k] })),
    ...(d?.fields ?? [])
      .filter((q) => q.type !== 'statement')
      .map((q) => ({ value: q.key, label: q.label.trim() || typeLabel(q.type) })),
  ];
}

/** Поля по умолчанию (kbDefault dc:901): дата, автор, объект (у формы модуля), до 8 вопросов, номер ответа. */
export function kbDefault(f: Form, d: Def | undefined): KbField[] {
  const C = F.actions.kb.col;
  return [
    { name: C.at, source: '$at' },
    { name: C.author, source: '$author' },
    ...(f.moduleKey ? [{ name: C.object, source: '$object' }] : []),
    ...(d?.fields ?? [])
      .filter((q) => q.type !== 'statement' && !q.hidden)
      .slice(0, 8)
      .map((q) => ({
        name: (q.label || typeLabel(q.type)).replace(/[?:]+$/, '').slice(0, 40),
        source: q.key,
      })),
    { name: C.id, source: '$id' },
  ];
}

/** Столбцы существующей таблицы и источники (kbMap dc:902): прежние, затем совпадение подписи. */
export function kbMap(
  columns: readonly { id: string; name: string }[],
  d: Def | undefined,
  old: readonly KbField[] = [],
): KbField[] {
  const S = kbSources(d);
  return columns.map((c) => {
    const o = old.find((m) => m.columnId === c.id);
    const n = c.name.toLowerCase();
    const g =
      S.find((x) => x.label.toLowerCase() === n) ??
      S.find((x) => x.label.toLowerCase().startsWith(n));
    return { columnId: c.id, name: c.name, source: o ? o.source : (g?.value ?? '') };
  });
}

/** Поля, чьих вопросов нет в текущей форме (miss dc:936): «Нет в форме: …» и предупреждение. */
export function kbMissing(fields: readonly KbField[], d: Def | undefined): KbField[] {
  const S = kbSources(d);
  return fields.filter((m) => m.source && !S.some((o) => o.value === m.source));
}

/** Подпись значения ответа по вопросу его версии (варианты — подписи; да / нет; число с разрядами). */
export function answerText(q: Question | undefined, v: Value | undefined): string {
  if (!v || v.type === 'null') return '';
  switch (v.type) {
    case 'choices':
      return v.value
        .map((k) =>
          k === 'other' ? (v.otherText ?? '') : (q?.options?.find((o) => o.key === k)?.label ?? k),
        )
        .join(', ');
    case 'boolean':
      return v.value ? F.actions.yes : F.actions.no;
    case 'files':
      return format(FR_TEXT.photos, { n: v.value.length });
    case 'reference':
      return v.label ?? '';
    case 'money':
      return num(v.value.amountMinor / 100);
    case 'decimal': {
      const n = Number(v.value);
      return Number.isFinite(n) ? num(n) : v.value;
    }
    case 'date': {
      const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v.value);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : v.value;
    }
    case 'instant':
      return dayTime(v.value);
    default:
      return String(v.value);
  }
}

const valueOf = (r: Response, key: string): Value | undefined =>
  r.answers.find((a) => a.fieldKey === key)?.value;

/** Подпись объекта ответа («Рейс Р-196 · сдача»). */
export const objectOf = (r: Response): string => r.subject?.label ?? '';

/** Значение поля «в БЗ» для ответа (formVal домена): переменные и ответы по структуре версии ответа. */
export function kbValue(f: Form, r: Response, src: string, ver: Def | undefined): string {
  const V: Record<string, string> = {
    $at: dayTime(r.submittedAt),
    $author: r.author.displayName,
    $object: objectOf(r),
    $id: r.number,
    $form: f.name,
    $ver: `v${r.versionNumber}`,
  };
  if (src in V) return V[src] ?? '';
  const v = valueOf(r, src);
  const q = ver?.fields.find((x) => x.key === src);
  const text = answerText(q, v);
  // Файлы не копируются: в ячейке — ссылка на ответ (formVal эталона, models.js:113 — по типу вопроса photo; сид
  // W4.05 хранит такой ответ и текстом «5 фото»).
  return (q?.type === 'photo' || v?.type === 'files') && text
    ? format(F.actions.kb.filesIn, { value: text, id: r.number })
    : text;
}

/** Подпись страницы в «Страница Базы знаний» (dc:941): своя доступность — « · только владелец». */
export function kbPageLabel(p: { spaceName: string; title: string; listed: boolean }): string {
  const K = F.actions.kb;
  return format(p.listed ? K.pageOptOwner : K.pageOpt, { space: p.spaceName, page: p.title });
}

/**
 * Доступ новой страницы «Только владелец» (setKnowledgeNodeAccess после createKnowledgeNode; KnowledgeNodeCreate
 * доступа не принимает): «Только выбранные» без записей — читают руководитель пространства и владелец бизнеса.
 * Остальным случаям шаг не нужен — `null`.
 */
export function kbOwnerAccess(r: RuleDraft): { mode: 'listed'; entries: never[] } | null {
  return r.kind === 'kb' && r.page === NEW && r.np.access === 'owner'
    ? { mode: 'listed', entries: [] }
    : null;
}

/**
 * Записи увидят все сотрудники с доступом к Базе знаний — нужно «Понимаю…». Новая страница — по «Кто видит
 * страницу»; существующая — по своему доступу узла (`listed` — «Только выбранные»); неизвестная — как все.
 */
export function kbSeenByAll(
  r: RuleDraft,
  listed: (pageId: string) => boolean | undefined,
): boolean {
  if (r.page === NEW) return r.np.access !== 'owner';
  return listed(r.page) !== true;
}

/** Ответ для примера строки (sample dc:937): с наибольшим номером. */
export function sampleOf(rs: readonly Response[]): Response | undefined {
  const no = (r: Response) => Number(r.number.replace(/\D/g, '')) || 0;
  return rs.reduce<Response | undefined>((b, x) => (!b || no(x) > no(b) ? x : b), undefined);
}

/** Проверка редактора до сохранения (saveRule dc:655, dc:675) — первая ошибка или null. */
export function ruleError(
  r: RuleDraft,
  ctx: {
    pageExists: (spaceId: string, title: string) => boolean;
    /** «Только владелец» в разделе: владелец бизнеса (руководитель — knowledge.access.manage). Нет — нельзя. */
    canOwnerOnly?: (spaceId: string) => boolean;
  },
): string | null {
  const E = F.actions.errors;
  if (r.kind === 'task') return r.title.trim() ? null : E.taskTitle;
  if (r.kind === 'email') return /^\S+@\S+\.\S+$/.test(r.to) ? null : E.email;
  if (r.kind === 'http') return /^https:\/\//.test(r.url) ? null : E.http;
  if (r.kind === 'notify') return r.to ? null : E.notify;
  const isNew = r.page === NEW;
  const title = r.np.title.trim();
  const table = r.mode === 'table';
  const names = r.fields.map((m) => m.name.trim().toLowerCase());
  if (!r.page) return E.pickPage;
  if (isNew && !r.np.space) return E.pickSection;
  if (isNew && title.length < 3) return E.pageShort;
  if (isNew && ctx.pageExists(r.np.space, title)) return format(E.pageTaken, { title });
  if (isNew && r.np.access === 'owner' && !ctx.canOwnerOnly?.(r.np.space))
    return F.actions.kb.ownerWhy;
  if (table && !r.table) return E.pickTable;
  if (table && r.table === NEW && r.newTitle.trim().length < 2) return E.tableTitle;
  if (!r.fields.some((m) => m.source)) return table ? E.noColumn : E.noEntry;
  if (names.some((n) => !n)) return E.noName;
  if (new Set(names).size !== names.length) return E.dupNames;
  if (r.allSee && !r.ack) return E.confirm;
  return null;
}

/** Новая страница / таблица в выборе редактора «в БЗ». */
export const NEW = '__new';

/** Черновик редактора правила (aEdit dc:983). */
export interface RuleDraft {
  /** id правила при «Изменить»; null — новое. */
  id: string | null;
  kind: S['FormRuleKind'];
  enabled: boolean;
  trigger: S['FormRuleTrigger'];
  condField: string;
  condValue: string;
  // task
  title: string;
  projectId: string;
  assignee: string;
  // notify / email
  to: string;
  // http
  url: string;
  // kb
  page: string;
  np: { space: string; title: string; access: 'all' | 'owner' };
  mode: 'table' | 'entry';
  table: string;
  newTitle: string;
  head: string;
  position: 'top' | 'bottom';
  fields: KbField[];
  showLink: boolean;
  ack: boolean;
  /** Запись увидят все сотрудники — нужно подтверждение. */
  allSee: boolean;
}

/** Новый черновик вида `kind` (adds dc:983). */
export function newDraft(
  kind: S['FormRuleKind'],
  f: Form,
  me: { assignee: string; to: string },
): RuleDraft {
  const kb = kind === 'kb';
  return {
    id: null,
    kind,
    enabled: true,
    trigger: kb ? 'accepted' : 'submitted',
    condField: '',
    condValue: '',
    title: kind === 'task' ? format(F.actions.editor.taskDefault, { form: f.name }) : '',
    projectId: '',
    assignee: me.assignee,
    to: kind === 'notify' ? me.to : '',
    url: '',
    page: '',
    np: { space: '', title: '', access: 'all' },
    mode: 'table',
    table: '',
    newTitle: '',
    head: '$object',
    position: 'top',
    fields: [],
    showLink: false,
    ack: false,
    allSee: false,
  };
}

/** Черновик из правила («Изменить», dc:971). */
export function draftOf(r: Rule, f: Form): RuleDraft {
  const d = newDraft(r.kind, f, { assignee: '', to: '' });
  return {
    ...d,
    id: r.id,
    enabled: r.enabled,
    trigger: r.trigger,
    condField: r.condition.fieldKey ?? '',
    condValue: r.condition.value ?? '',
    title: r.task?.title ?? '',
    projectId: r.task?.projectId ?? '',
    assignee: r.task?.assigneeMemberId ?? '',
    to: r.notify?.memberId ?? r.email?.to ?? '',
    url: r.http?.url ?? '',
    page: r.kb?.nodeId ?? '',
    mode: r.kb?.mode ?? 'table',
    table: r.kb?.tableId ?? '',
    head: r.kb?.head ?? '$object',
    position: r.kb?.position ?? 'top',
    fields: (r.kb?.fields ?? []).map((x) => ({
      ...(x.columnId ? { columnId: x.columnId } : {}),
      name: x.name,
      source: x.source,
    })),
    showLink: r.kb?.showLink ?? false,
    ack: r.kb?.allEmployeesConfirmed ?? false,
  };
}

/** Тело правила для createFormRule / updateFormRule из черновика (вид — без чужих объектов). */
export function ruleBody(
  r: RuleDraft,
  kb?: { nodeId: string; tableId?: string; fields: KbField[] },
): S['FormRuleCreate'] {
  const condition: S['FormRuleCondition'] = r.condField
    ? { fieldKey: r.condField, value: r.condValue }
    : { fieldKey: null, value: null };
  const base = { kind: r.kind, enabled: r.enabled, trigger: r.trigger, condition };
  if (r.kind === 'task')
    return {
      ...base,
      task: { projectId: r.projectId, title: r.title.trim(), assigneeMemberId: r.assignee },
    };
  if (r.kind === 'notify') return { ...base, notify: { memberId: r.to } };
  if (r.kind === 'email') return { ...base, email: { to: r.to.trim() } };
  if (r.kind === 'http') return { ...base, http: { url: r.url.trim() } };
  const fields = (kb?.fields ?? r.fields)
    .filter((m) => m.source)
    .map((m) => ({
      ...(m.columnId ? { columnId: m.columnId } : {}),
      name: m.name.trim(),
      source: m.source,
    }));
  return {
    ...base,
    kb: {
      nodeId: kb?.nodeId ?? r.page,
      mode: r.mode,
      ...(r.mode === 'table' ? { tableId: kb?.tableId ?? r.table } : { head: r.head }),
      position: r.position,
      fields,
      showLink: r.showLink,
      allEmployeesConfirmed: r.ack,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// «Ответы»

/** Колонки: вопросы всех версий, свежая версия первой (respCols dc:985); без версий — черновик. */
export function respColumns(versions: readonly Version[], draft: Def | undefined): Question[] {
  const out: Question[] = [];
  const seen = new Set<string>();
  const vs = [...versions].sort((a, b) => b.number - a.number);
  for (const v of vs) {
    for (const q of v.definition.fields) {
      if (q.type === 'statement' || seen.has(q.key)) continue;
      seen.add(q.key);
      out.push(q);
    }
  }
  if (!out.length) for (const q of draft?.fields ?? []) if (q.type !== 'statement') out.push(q);
  return out;
}

/** Пустое состояние «Ответов» (dc:990). */
export function emptyText(f: Form): string {
  const E = F.responses.empty;
  if (!f.publishedVersionNumber) return E.draft;
  return f.status === 'closed' ? E.closed : E.open;
}

export interface StatCard {
  label: string;
  meta: string;
  bars: { label: string; n: string; pct: string }[];
  numText: string | null;
  texts: string[] | null;
}

/** Карточки «Сводки» (dc:993–999) из getFormResponseSummary. */
export function statCards(s: Summary): StatCard[] {
  const R = F.responses.stats;
  return s.questions.map((q) => {
    const bars = OPTS.includes(q.type) || q.type === 'bool';
    const isNum = !bars && ['number', 'int', 'money', 'scale', 'rating'].includes(q.type);
    const card: StatCard = {
      label: q.label,
      meta: format(R.answered, { type: typeLabel(q.type), n: q.answered, total: s.total }),
      bars: [],
      numText: null,
      texts: null,
    };
    if (bars) {
      card.bars = (q.options ?? []).map((o) => ({
        label:
          q.type === 'bool'
            ? o.key === 'true'
              ? F.actions.yes
              : o.key === 'false'
                ? F.actions.no
                : o.label
            : o.label,
        n: String(o.count),
        pct: `${o.percent}%`,
      }));
    } else if (isNum) {
      const x = q.numbers;
      card.numText = x
        ? format(R.num, {
            avg: num(Number(x.average)),
            min: num(Number(x.min)),
            max: num(Number(x.max)),
          })
        : R.noNum;
    } else card.texts = q.recentTexts ?? [];
    return card;
  });
}

export interface CardRow {
  label: string;
  value: string;
  muted: boolean;
}

/** Совпадение значения с условием показа (condOk эталона по ключам, Q-W4.00-forms-3). */
function has(v: Value | undefined, want: string): boolean {
  if (!v) return false;
  if (v.type === 'choices') return v.value.includes(want);
  if (v.type === 'boolean') return String(v.value) === want;
  if (v.type === 'text' || v.type === 'decimal' || v.type === 'date')
    return String(v.value).toLowerCase() === want.toLowerCase();
  return false;
}

export function shown(q: Question, r: Response): boolean {
  const c = q.showIf;
  if (!c?.conditions.length) return true;
  const res = c.conditions.map((k) => {
    const x = has(valueOf(r, k.fieldKey), k.value);
    return k.operator === 'not_equals' ? !x : x;
  });
  return c.mode === 'any' ? res.some(Boolean) : res.every(Boolean);
}

/** Строки карточки ответа по структуре его версии (dc:1006). */
export function cardRows(r: Response, ver: Def | undefined): CardRow[] {
  const L = F.responses.feed;
  return (ver?.fields ?? [])
    .filter((q) => q.type !== 'statement')
    .map((q) => {
      if (!shown(q, r)) return { label: q.label, value: L.notShown, muted: true };
      const t = answerText(q, valueOf(r, q.key));
      return t
        ? { label: q.label, value: t, muted: false }
        : { label: q.label, value: L.noAnswer, muted: true };
    });
}

/** Пояснение карточки (dc:1005). */
export function cardNote(r: Response, f: Form): string {
  const L = F.responses.feed;
  const base = format(L.note, {
    author: r.author.displayName,
    at: dayTime(r.submittedAt),
    v: r.versionNumber,
  });
  const cur = f.publishedVersionNumber;
  return cur && r.versionNumber !== cur ? `${base} ${format(L.acting, { v: cur })}` : base;
}

/** Строка ленты (dc:426): «R-… · объект» (без объекта — номер). */
export const feedTitle = (r: Response): string =>
  objectOf(r) ? format(F.responses.feed.row, { id: r.number, object: objectOf(r) }) : r.number;

export interface JournalLine {
  ok: boolean;
  icon: string;
  text: string;
  ruleId: string;
  /** Страница БЗ — «Открыть страницу». */
  nodeId?: string;
  retry: boolean;
}

/**
 * «Журнал действий» (actsVM dc:907–914): задача — текст сервера; «в БЗ» — «{текст} · {время} · правило vN» и «Открыть
 * страницу»; ошибка «в БЗ» — «Не сохранено в Базу знаний: …» и «Повторить» (`canRetry` и `retryable`); прочие ошибки —
 * `failText` (no-reference).
 */
export function journal(r: Response, canRetry: boolean, failText: string): JournalLine[] {
  const J = F.responses.journal;
  const icon = {
    task: 'add_task',
    notify: 'notifications',
    email: 'mail',
    http: 'webhook',
    kb: 'menu_book',
  };
  return r.actions.map((a) => {
    const at = dayTime(a.at);
    const retry = !a.ok && canRetry && a.retryable;
    if (!a.ok) {
      const text =
        a.kind === 'kb'
          ? format(J.kbFail, { err: a.error ?? '', at })
          : format(failText, { err: a.error ?? '', at });
      return { ok: false, icon: 'error', text, ruleId: a.ruleId, retry };
    }
    const text =
      a.kind === 'kb' ? format(J.ok, { text: a.text ?? '', at, n: a.ruleVersion }) : (a.text ?? '');
    return {
      ok: true,
      icon: icon[a.kind],
      text,
      ruleId: a.ruleId,
      ...(a.node ? { nodeId: a.node.id } : {}),
      retry: false,
    };
  });
}

/** Строка «Таблицы» (dc:1009): номер, дата, автор, объект, версия и ответы колонок («—» — пусто). */
export function tableRow(
  r: Response,
  cols: readonly Question[],
  versions: readonly Version[],
): string[] {
  const ver = versions.find((v) => v.number === r.versionNumber)?.definition;
  return [
    r.number,
    dayTime(r.submittedAt),
    r.author.displayName,
    objectOf(r),
    `v${r.versionNumber}`,
    ...cols.map((c) => {
      const q = ver?.fields.find((x) => x.key === c.key) ?? c;
      return answerText(q, valueOf(r, c.key)) || F.responses.empty.cell;
    }),
  ];
}

// ---------------------------------------------------------------------------------------------
// «Версии»

/** Условие показа словами (condText dc:812). */
export function condText(c: S['FormShowIf'], d: Def): string {
  const V = F.versions;
  return c.conditions
    .map((k) => {
      const q = d.fields.find((x) => x.key === k.fieldKey);
      const label = q?.label || k.fieldKey;
      return format(k.operator === 'not_equals' ? V.ne : V.eq, {
        label,
        value: condValueText(q, k.value),
      });
    })
    .join(` ${c.mode === 'any' ? V.or : V.and} `);
}

export interface VersionQuestion {
  key: string;
  label: string;
  icon: string;
  meta: string;
  page: string;
  pageStart: boolean;
  diff: { label: string; tone: Tone } | null;
}

/** Структура версии и отличия от предыдущей (versVM dc:1016–1018). */
export function versionView(
  v: Version,
  prev: Version | undefined,
): { questions: VersionQuestion[]; removed: string[] } {
  const V = F.versions;
  const D = v.definition;
  const before = prev?.definition.fields ?? [];
  const questions = D.fields.map((q, i) => {
    const o = before.find((b) => b.key === q.key);
    // Нет версии N−1 — сравнение с пустым списком, как versVM (dc:1016): всё «Добавлено».
    const diff =
      v.number === 1
        ? null
        : !o
          ? { label: V.added, tone: 'ok' as const }
          : o.type !== q.type
            ? { label: V.newType, tone: 'warn' as const }
            : o.label !== q.label
              ? { label: V.textChanged, tone: 'info' as const }
              : JSON.stringify(o) !== JSON.stringify(q)
                ? { label: V.changed, tone: 'info' as const }
                : null;
    const meta = [
      format(V.id, { id: q.key, type: typeLabel(q.type) }),
      ...(q.required ? [V.required] : []),
      ...(q.showIf ? [format(V.cond, { text: condText(q.showIf, D) })] : []),
    ].join(' · ');
    return {
      key: q.key,
      label: q.label,
      icon: TYPE_ICON[q.type],
      meta,
      page: D.pages.find((p) => p.id === q.pageId)?.title ?? '',
      pageStart: i === 0 || D.fields[i - 1]?.pageId !== q.pageId,
      diff,
    };
  });
  const removed =
    v.number === 1
      ? []
      : before.filter((b) => !D.fields.some((x) => x.key === b.key)).map((b) => `«${b.label}»`);
  return { questions, removed };
}

/** Мета версии (dc:1014): «{дата} · {автор} · вопросов: N». */
export const versionMeta = (v: Version): string =>
  format(F.versions.meta, {
    at: day(v.createdAt),
    by: v.createdBy.displayName,
    n: v.questionCount,
  });

// ---------------------------------------------------------------------------------------------
// «Поделиться формой»

export interface ShareLink {
  key: 'int' | 'pub' | 'emb';
  label: string;
  value: string;
  note: string;
}

/**
 * Ссылки диалога (modalVM dc:1081–1084) — маршруты той же SPA (Q-W4.00-forms-21): сотрудникам `{origin}/forms/{id}`,
 * публичная `{origin}/f/{token}` и iframe `?embed=1`. Черновик — ссылок нет. Публичная форма без токена (нет права
 * публиковать) — ссылка для сотрудников.
 */
export function shareLinks(f: Form, origin: string): ShareLink[] {
  const S = F.share;
  if (!f.publishedVersionNumber) return [];
  const tok = f.share.publicToken;
  if (f.settings.access === 'public' && tok) {
    const pub = `${origin}/f/${tok}`;
    return [
      { key: 'pub', label: S.public, value: pub, note: S.publicNote },
      {
        key: 'emb',
        label: S.embed,
        value: `<iframe src="${pub}?embed=1" width="100%" height="640" frameborder="0"></iframe>`,
        note: S.embedNote,
      },
    ];
  }
  return [
    { key: 'int', label: S.internal, value: `${origin}/forms/${f.id}`, note: S.internalNote },
  ];
}

/** Счётчик «N ответов» (dc:989). */
export const countText = (n: number): string => format(F.responses.count, { n });

/** «баллов» и подобные формы — для тостов без ICU-шаблона (pl dc:494). */
export { plural };
