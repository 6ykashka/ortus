// «Формы и опросы» сценарного сервера (W4.05, контрактный PR 4 этапа 4; W4.21–W4.23): формы, черновики, версии,
// правила, ответы и группы организации в форме контракта 0.11.0-stage4, сид — домен W4.20 (`db.forms`,
// `db.responses` той же БД, что срез «Базы знаний» W4.04: действие «в БЗ» пишет строки в таблицы, которые видит
// knowledge/). Старый формат сида (поля с разделами, варианты строками, значения ответов подписями) переводится в
// FormDefinition v2 так же, как `toDef` эталона («Формы и опросы.dc.html»:504–515): раздел → страница, варианты →
// ключи o1…, «Чек-лист: кузов, шины, документы» → варианты из подписи. Отличия от Go-модуля W4.21 — в отчёте W4.05.
import type { components } from '@ortus/api-client';
import { ddmmyyyy } from '@ortus/domain';
import {
  FORM_SETTINGS,
  type FieldOption,
  type Form as DomainForm,
  type FormField as DomainField,
  type FormResponse as DomainResponse,
  type FormSettings as DomainSettings,
  kbAccess,
  type KbNode,
  type KbTenantDb,
} from '@ortus/domain/modules';
import { seedUuid } from '@ortus/domain/seed';

import { grantsOf, type TenantAccess } from '../core/access.ts';
import { fleetOf, tripVisible } from '../fleet/state.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { MemberRow, Org } from '../core/state.ts';
import { instant, kbOf, type KbState } from '../knowledge/state.ts';

type S = components['schemas'];
export type Def = S['FormDefinitionV2'];
export type Question = S['FormQuestion'];
export type QType = S['FormQuestionType'];

export const OPTS: readonly QType[] = ['choice', 'multi', 'select'];
export const CRM: readonly QType[] = ['person', 'unit', 'ref'];
export const NUM: readonly QType[] = ['number', 'int', 'money'];
export const TXT: readonly QType[] = ['text', 'longtext'];

/** Модуль домена → ключ модуля контракта (fleet, spa, repairs). */
const MODULE_KEY: Readonly<Record<string, string>> = {
  logistics: 'fleet',
  repair: 'repairs',
  spa: 'spa',
};
export const moduleKeyOf = (m: string | null | undefined): string | null =>
  m ? (MODULE_KEY[m] ?? m) : null;

export interface VersionRow {
  id: string;
  number: number;
  definition: Def;
  createdAt: string;
  byId: string | null;
  byName: string;
}

export interface DraftRow {
  definition: Def;
  revision: number;
  hasChanges: boolean;
  savedAt?: string;
  savedById?: string;
  savedByName?: string;
}

export interface FormRow {
  id: string;
  proto: string;
  name: string;
  orgUnitId: string | null;
  moduleKey: string | null;
  templateId: string | null;
  groupId: string | null;
  ownerId: string;
  ownerName: string;
  status: 'draft' | 'published' | 'closed';
  versions: VersionRow[];
  draft: DraftRow;
  settings: S['FormSettings'];
  publicToken: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface RuleRow {
  id: string;
  proto: string;
  formId: string;
  kind: S['FormRuleKind'];
  enabled: boolean;
  version: number;
  trigger: S['FormRuleTrigger'];
  condition: S['FormRuleCondition'];
  task?: S['FormRuleTask'];
  notify?: S['FormRuleNotify'];
  email?: S['FormRuleEmail'];
  http?: S['FormRuleHttp'];
  kb?: S['FormRuleKbInput'];
  authorId: string;
  authorName: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActionRow {
  ruleId: string;
  ruleVersion: number;
  kind: S['FormRuleKind'];
  ok: boolean;
  at: string;
  text?: string;
  error?: string;
  /** Узел БЗ (id прототипа), куда записано. */
  kbNode?: string;
  taskId?: string;
  taskKey?: string;
}

export interface ResponseRow {
  id: string;
  proto: string;
  formId: string;
  number: string;
  versionNumber: number;
  submittedAt: string;
  channel: S['FormResponse']['channel'];
  authorId: string | null;
  authorName: string;
  subject?: S['FormResponseSubject'];
  answers: S['FieldEntry'][];
  reviewStatus: S['FormResponse']['reviewStatus'];
  assigneeMemberId?: string;
  reviewComment?: string;
  revision: number;
  score?: S['FormResponseScore'];
  actions: ActionRow[];
  linkParamKeys?: string[];
}

export interface GroupRow {
  id: string;
  proto: string;
  name: string;
}

export interface FormsData {
  forms: FormRow[];
  rules: RuleRow[];
  responses: ResponseRow[];
  groups: GroupRow[];
  /** Счётчик id новых объектов (`<префикс>w<N>`). */
  seq: number;
}

type WithForms = Org & { formsData?: FormsData };

// ---------------------------------------------------------------------------------------------
// Перевод сида W4.20 (формат эталона 14.10) в FormDefinition v2

/** Варианты вопроса выбора: ключи o1…; без вариантов — из подписи «…: a, b, c» (toDef эталона). */
function optionsOf(x: DomainField): S['FormOption'][] {
  let list: (FieldOption | string)[] = x.options ?? [];
  if (!list.length && /:/.test(x.label)) {
    list = x.label
      .split(':')
      .slice(1)
      .join(':')
      .split(/,\s*/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return list.map((o, i) =>
    typeof o === 'string'
      ? { key: `o${i + 1}`, label: o }
      : { key: o.id, label: o.label, ...(o.score !== undefined ? { score: o.score } : {}) },
  );
}

/** Значение условия эталона (подпись) → ключ варианта или true/false. */
function condValue(fields: readonly DomainField[], field: string, value: string): string {
  const src = fields.find((f) => f.id === field);
  if (src?.type === 'bool') return value.toLowerCase() === 'да' ? 'true' : 'false';
  if (src && OPTS.includes(src.type as QType)) {
    const o = optionsOf(src).find((x) => x.label.toLowerCase() === value.toLowerCase());
    if (o) return o.key;
  }
  return value;
}

function showIfOf(fields: readonly DomainField[], x: DomainField): S['FormShowIf'] | undefined {
  const s = x.showIf;
  if (!s) return undefined;
  if ('conds' in s) {
    if (!s.conds.length) return undefined;
    return {
      mode: s.mode,
      conditions: s.conds.map((c) => ({
        fieldKey: c.field,
        operator: c.op === 'ne' ? 'not_equals' : 'equals',
        value: condValue(fields, c.field, c.value),
      })),
    };
  }
  return {
    mode: 'all',
    conditions: [
      { fieldKey: s.field, operator: 'equals', value: condValue(fields, s.field, s.eq) },
    ],
  };
}

/** Определение эталона (`{pages, fields}` или массив полей с разделами) → FormDefinition v2. */
export function toDefV2(
  src: { pages?: { id: string; title: string; shuffle?: boolean }[] | null; fields: DomainField[] },
  pagesIn?: { id: string; title: string; shuffle?: boolean }[] | null,
): Def {
  const fields = src.fields;
  const pages: S['FormPageDefinition'][] = (pagesIn ?? src.pages ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    ...(p.shuffle ? { shuffle: true } : {}),
  }));
  const pageOf = new Map<DomainField, string>();
  if (!pages.length) {
    for (const x of fields) {
      const title = x.section || 'Страница 1';
      let p = pages.find((y) => y.title === title);
      if (!p) {
        p = { id: `p${pages.length + 1}`, title };
        pages.push(p);
      }
      pageOf.set(x, p.id);
    }
  }
  if (!pages.length) pages.push({ id: 'p1', title: 'Страница 1' });
  const first = pages[0]?.id ?? 'p1';
  const out: Question[] = fields.map((x) => {
    const pageId =
      pageOf.get(x) ?? (pages.some((p) => p.id === x.page) ? (x.page ?? first) : first);
    const q: Question = {
      key: x.id,
      pageId,
      type: x.type as QType,
      label: x.label,
      required: Boolean(x.required),
    };
    if (x.hint) q.hint = x.hint;
    if (x.default) q.defaultValue = x.default;
    if (x.hidden) q.hidden = true;
    if (OPTS.includes(q.type)) q.options = optionsOf(x);
    const si = showIfOf(fields, x);
    if (si) q.showIf = si;
    if (x.accept) q.accept = x.accept;
    if (x.maxFiles !== undefined) q.maxFiles = x.maxFiles;
    if (x.maxMb !== undefined) q.maxFileMb = x.maxMb;
    if (x.scaleMin !== undefined) q.scaleMin = x.scaleMin === 0 ? 0 : 1;
    if (x.scaleMax !== undefined) q.scaleMax = x.scaleMax;
    if (x.left) q.scaleLeftLabel = x.left;
    if (x.right) q.scaleRightLabel = x.right;
    if (x.refKind) q.refKind = x.refKind as NonNullable<Question['refKind']>;
    return q;
  });
  // Порядок вопросов — по страницам (sortDef эталона).
  const ordered = pages.flatMap((p) => out.filter((q) => q.pageId === p.id));
  return { pages, fields: ordered };
}

export const questionCount = (d: Def): number =>
  d.fields.filter((q) => q.type !== 'statement').length;

const DIGITS = /^-?\d+(?:[.,]\d+)?$/;

/** Значение ответа сида (подпись эталона) → FieldEntry по вопросу версии; непонятное — текст. */
export function answerOf(q: Question | undefined, key: string, v: unknown): S['FieldEntry'] {
  const text = (s: string): S['FieldEntry'] => ({
    fieldKey: key,
    value: { type: 'text', value: s },
  });
  if (Array.isArray(v)) v = v.join(', ');
  const s = String(v);
  if (!q) return text(s);
  if (q.type === 'bool') {
    const b = s.toLowerCase();
    if (b === 'да' || b === 'нет')
      return { fieldKey: key, value: { type: 'boolean', value: b === 'да' } };
    return text(s);
  }
  if (NUM.includes(q.type) || q.type === 'scale' || q.type === 'rating') {
    const n = s.replace(/\s/g, '');
    if (DIGITS.test(n))
      return { fieldKey: key, value: { type: 'decimal', value: n.replace(',', '.') } };
    return text(s);
  }
  if (OPTS.includes(q.type)) {
    const labels = q.type === 'multi' ? s.split(/,\s*/) : [s];
    const keys = labels.map(
      (l) => q.options?.find((o) => o.label.toLowerCase() === l.trim().toLowerCase())?.key,
    );
    if (keys.every(Boolean)) {
      return { fieldKey: key, value: { type: 'choices', value: keys as string[] } };
    }
    return text(s);
  }
  return text(s);
}

const FORMS_SETTINGS_DEFAULT = FORM_SETTINGS;

/** Настройки эталона (FORM_SETTINGS) → FormSettings контракта. */
export function settingsOf(s: Partial<DomainSettings> | undefined): S['FormSettings'] {
  const x = { ...FORMS_SETTINGS_DEFAULT, ...(s ?? {}) };
  const until = /^(\d\d)\.(\d\d)\.(\d{4})$/.exec(x.until ?? '');
  const days = [90, 365, 1095].includes(x.retainDays) ? x.retainDays : 365;
  return {
    access: x.access === 'public' ? 'public' : 'members',
    acceptUntil: until ? `${until[3]}-${until[2]}-${until[1]}` : null,
    responseLimit: x.limit ?? null,
    onePerMember: x.onePerPerson,
    allowEditBeforeReview: x.allowEdit,
    confirmationText: x.thanks,
    scoring: x.quiz,
    passScore: x.passScore ?? null,
    showScore: x.showScore,
    progressBar: x.progress,
    backButton: x.backButton,
    showLogo: x.logo,
    retainResponsesDays: days as S['FormSettings']['retainResponsesDays'],
  };
}

// ---------------------------------------------------------------------------------------------
// Сид

const memberByName = (org: Org, name: string | undefined): MemberRow | undefined =>
  org.members.find((m) => m.displayName === name);

/** Объект ответа эталона («Рейс Р-196 · сдача») → ссылка на рейс и подпись. */
function subjectOf(org: Org, label: string): S['FormResponseSubject'] | undefined {
  const m = /^Рейс (\S+)/.exec(label);
  if (!m) return undefined;
  return {
    ref: { moduleKey: 'fleet', entityType: 'trip', entityId: seedUuid(org.proto, m[1] ?? '') },
    label,
  };
}

/** Последняя дата сида (`ДД.ММ.ГГГГ`) формы или время сида. */
const SEED_DRAFT_AT = '2026-09-30T07:30:00Z';

function seedForms(org: Org, k: KbState): FormsData {
  const db = k.db as KbTenantDb & { forms?: DomainForm[]; responses?: DomainResponse[] };
  const U = (id: string) => seedUuid(org.proto, id);
  const data: FormsData = { forms: [], rules: [], responses: [], groups: [], seq: 0 };
  for (const f of db.forms ?? []) {
    const owner = memberByName(org, f.owner);
    const versions: VersionRow[] = f.versions.map((v) => {
      const by = memberByName(org, v.by);
      return {
        id: U(`${f.id}:v${v.v}`),
        number: v.v,
        definition: toDefV2({ fields: v.fields }, v.pages ?? null),
        createdAt: instant(v.at),
        byId: by?.id ?? null,
        byName: v.by,
      };
    });
    const current = versions.find((v) => v.number === f.published);
    const draftSrc = Array.isArray(f.draft) ? { fields: f.draft } : f.draft;
    const draft: DraftRow = draftSrc
      ? {
          definition: toDefV2(
            { fields: draftSrc.fields },
            'pages' in draftSrc ? draftSrc.pages : null,
          ),
          revision: 1,
          hasChanges: Boolean(current),
          savedAt: SEED_DRAFT_AT,
          ...(owner ? { savedById: owner.id, savedByName: owner.displayName } : {}),
        }
      : {
          definition: structuredClone(
            current?.definition ?? { pages: [{ id: 'p1', title: 'Страница 1' }], fields: [] },
          ),
          revision: 1,
          hasChanges: false,
        };
    const updatedAt = versions.at(-1)?.createdAt ?? SEED_DRAFT_AT;
    data.forms.push({
      id: U(f.id),
      proto: f.id,
      name: f.name,
      orgUnitId: f.unit && f.unit !== 'org' ? U(f.unit) : null,
      moduleKey: moduleKeyOf(f.module),
      templateId: f.template ?? null,
      groupId: null,
      ownerId: owner?.id ?? '',
      ownerName: owner?.displayName ?? f.owner,
      status: f.status,
      versions,
      draft,
      settings: settingsOf(f.settings),
      publicToken: null,
      revision: 1,
      createdAt: versions[0]?.createdAt ?? SEED_DRAFT_AT,
      updatedAt,
    });
    for (const a of f.automations) {
      const author = memberByName(org, a.by) ?? owner;
      const base = {
        id: U(a.id),
        proto: a.id,
        formId: U(f.id),
        enabled: a.on,
        version: a.version ?? 1,
        trigger: (a.when ?? 'accepted') === 'accepted' ? 'accepted' : 'submitted',
        condition: a.cond?.field
          ? { fieldKey: a.cond.field, value: a.cond.value ?? '' }
          : { fieldKey: null, value: null },
        authorId: author?.id ?? '',
        authorName: author?.displayName ?? a.by ?? '',
        revision: 1,
        createdAt: versions[0]?.createdAt ?? SEED_DRAFT_AT,
        updatedAt: versions[0]?.createdAt ?? SEED_DRAFT_AT,
      } as const;
      if (a.kind === 'kb') {
        const kb: S['FormRuleKbInput'] = {
          nodeId: U(a.page ?? ''),
          mode: a.mode === 'entry' ? 'entry' : 'table',
          position: a.pos === 'bottom' ? 'bottom' : 'top',
          fields: (a.fields ?? []).map((x) => ({
            ...(x.col ? { columnId: U(x.col) } : {}),
            name: x.name,
            source: x.src,
          })),
          showLink: Boolean(a.showLink),
          allEmployeesConfirmed: Boolean(a.ack),
        };
        if (a.table) kb.tableId = U(a.table);
        if (a.head) kb.head = a.head;
        data.rules.push({ ...base, kind: 'kb', kb });
      } else {
        // Задача эталона (recordInspection, api.js:76): «Проверить осмотр …» Марине Котовой в проекте логистики.
        const kotova = org.members.find((m) => m.proto === 'm-kotova');
        data.rules.push({
          ...base,
          kind: 'task',
          task: {
            projectId: U('fleet'),
            title: 'Проверить осмотр',
            assigneeMemberId: kotova?.id ?? '',
          },
        });
      }
    }
  }
  for (const r of db.responses ?? []) {
    const f = data.forms.find((x) => x.proto === r.formId);
    if (!f) continue;
    const v = f.versions.find((x) => x.number === r.version);
    const author = memberByName(org, r.author);
    const answers = Object.entries(r.values)
      .filter(([, x]) => x !== null && x !== undefined && x !== '')
      .map(([key, x]) =>
        answerOf(
          v?.definition.fields.find((q) => q.key === key),
          key,
          x,
        ),
      );
    const subject = subjectOf(org, r.object);
    data.responses.push({
      id: U(r.id),
      proto: r.id,
      formId: f.id,
      number: r.id,
      versionNumber: r.version,
      submittedAt: instant(r.at),
      channel: author ? 'inspection' : 'public',
      authorId: author?.id ?? null,
      authorName: author?.displayName ?? r.author,
      ...(subject ? { subject } : {}),
      answers,
      reviewStatus: r.status === 'Принят' ? 'accepted' : 'pending',
      revision: 1,
      actions: (r.actions ?? []).map((a) => ({
        ruleId: U(a.rule),
        ruleVersion: a.rv,
        kind: a.kind,
        ok: a.ok,
        at: instant(a.at),
        ...(a.text ? { text: a.text } : {}),
        ...(a.err ? { error: a.err } : {}),
        ...(a.page ? { kbNode: a.page } : {}),
      })),
    });
  }
  // Новые сверху (лента «Ответов» — последние первыми).
  data.responses.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return data;
}

/** Формы организации (сид при первом обращении). */
export function formsDataOf(org: Org): FormsData {
  const x = org as WithForms;
  x.formsData ??= seedForms(org, kbOf(org));
  return x.formsData;
}

// ---------------------------------------------------------------------------------------------
// Вид участника и права в области формы

export interface FormsView {
  ctx: HandlerContext;
  t: TenantAccess;
  org: Org;
  data: FormsData;
  kb: KbState;
  /** UUID участника. */
  me: string;
  meName: string;
  /** Участник домена (id прототипа) — для доступа к «Базе знаний». */
  meProto: string;
  now: string;
  U(id: string): string;
  newProto(prefix: string): string;
  /** Право `key` на форму (область формы): владелец; организация; подразделение формы или его предок. */
  can(f: FormRow, key: string): boolean;
  /** Ключ есть хоть в одной роли участника (любой области). */
  any(key: string): boolean;
  visible(f: FormRow): boolean;
  /**
   * Ответ виден (Q-W4.00-forms-9): forms.responses.read в области формы — все; иначе с этим правом где-либо — свои и
   * ответы об объекте, который участник видит (рейс — правами «Логистики»; рейс сида, которого нет, — fleet.trips.read).
   */
  sees(f: FormRow, r: ResponseRow): boolean;
}

function covers(org: Org, unitIds: readonly string[], unit: string): boolean {
  const ancestors = new Set<string>();
  let cur: string | null | undefined = unit;
  while (cur) {
    ancestors.add(cur);
    cur = org.units.find((u) => u.id === cur)?.parentId;
  }
  return unitIds.some((u) => ancestors.has(u));
}

/** Ключи, которые «вся организация» даёт и роли подразделения: видеть и отвечать (Q-W4.00-forms-8). */
const ANY_AREA = new Set(['forms.read']);

export function viewOf(ctx: HandlerContext): FormsView {
  const t = ctx.org();
  const org = t.org;
  const now = ctx.now();
  const data = formsDataOf(org);
  const kb = kbOf(org);
  const me = t.member?.id ?? '';
  const grants = t.member ? grantsOf(org, t.member.id, now) : [];
  const can = (f: FormRow, key: string): boolean => {
    if (t.owner) return true;
    return grants.some((g) => {
      if (!g.keys.includes(key)) return false;
      if (g.scope.kind === 'tenant') return true;
      if (g.scope.kind !== 'org_unit') return false;
      if (f.orgUnitId === null) return ANY_AREA.has(key);
      return covers(org, g.scope.resourceIds, f.orgUnitId);
    });
  };
  const any = (key: string): boolean => t.owner || grants.some((g) => g.keys.includes(key));
  const v: FormsView = {
    ctx,
    t,
    org,
    data,
    kb,
    me,
    meName: t.member?.displayName ?? '',
    meProto: t.member?.proto ?? '',
    now,
    U: (id) => seedUuid(org.proto, id),
    newProto: (prefix) => `${prefix}w${++data.seq}`,
    can,
    any,
    visible: (f) => can(f, 'forms.read'),
    sees: (f, r) => {
      if (can(f, 'forms.responses.read')) return true;
      if (!any('forms.responses.read')) return false;
      if (r.authorId && r.authorId === me) return true;
      const ref = r.subject?.ref;
      if (ref?.moduleKey !== 'fleet' || ref.entityType !== 'trip') return false;
      const trip = fleetOf(org).trips.find((x) => x.id === ref.entityId);
      return trip ? tripVisible(ctx, trip) : any('fleet.trips.read');
    },
  };
  return v;
}

/** Форма пути, видимая участнику, или 404 «Форма не найдена». */
export function formOr404(v: FormsView, id = v.ctx.params.formId): FormRow {
  const f = v.data.forms.find((x) => x.id === (id ?? '').toLowerCase());
  if (!f || !v.visible(f)) return fail('not_found', 'Форма не найдена');
  return f;
}

/** Действующая версия (последняя опубликованная); у черновика — нет. */
export const current = (f: FormRow): VersionRow | undefined =>
  f.status === 'draft' ? undefined : f.versions.at(-1);

/** Узел «Базы знаний» по UUID (срез W4.04 организации). */
export function kbNodeByUuid(v: FormsView, uuid: string | undefined): KbNode | undefined {
  if (!uuid) return undefined;
  return v.kb.db.knowledge?.pages.find((p) => v.U(p.id) === uuid.toLowerCase());
}

/** Узел виден участнику (цепочка доступа W4.30). */
export function kbSees(v: FormsView, n: KbNode | undefined): boolean {
  if (!n || n.archived) return false;
  const opts = { today: ddmmyyyy({ now: () => new Date(v.now) }) };
  return kbAccess(v.kb.db, v.meProto, n, opts).view;
}

/** Срок «Принимать до» прошёл (последний день включительно, Москва). */
export function pastDeadline(f: FormRow, now: string): boolean {
  if (!f.settings.acceptUntil) return false;
  const msk = new Date(Date.parse(now) + 3 * 3600_000).toISOString().slice(0, 10);
  return msk > f.settings.acceptUntil;
}
