// Логика «Форм» сценарного сервера (W4.05): проверки до публикации (issues() эталона, dc:721–738), проверки ответа
// (pvCheck, dc:688–705), условия показа, баллы, действия после ответа (в БЗ — kbRun домена W4.20 на срезе БЗ W4.04,
// задача — проект «Задач» W4.03, уведомление — входящие), сводка, CSV и проекция в схемы контракта.
import type { components } from '@ortus/api-client';
import { ACCESS, type Clock } from '@ortus/domain';
import {
  type FormField as DomainField,
  type Form as DomainForm,
  type FormResponse as DomainResponse,
  type FormRule as DomainRule,
  type FormsKnowledge,
  kbRun,
  validatePublish,
} from '@ortus/domain/modules';

import { newId } from '../core/people.ts';
import { canIn, current as currentWorkflow, type TaskRow, tasksDataOf } from '../tasks/state.ts';
import {
  type ActionRow,
  CRM,
  current,
  type Def,
  type FormRow,
  type FormsView,
  kbNodeByUuid,
  kbSees,
  NUM,
  OPTS,
  type Question,
  questionCount,
  type ResponseRow,
  type RuleRow,
  TXT,
} from './state.ts';

type S = components['schemas'];

// ---------------------------------------------------------------------------------------------
// Значения ответов

type Answers = Map<string, S['FieldValue']>;

export const answersOf = (r: { answers: S['FieldEntry'][] }): Answers =>
  new Map(r.answers.map((a) => [a.fieldKey, a.value]));

const isEmpty = (v: S['FieldValue'] | undefined): boolean =>
  !v ||
  v.type === 'null' ||
  (v.type === 'text' && v.value.trim() === '') ||
  ((v.type === 'choices' || v.type === 'files') && v.value.length === 0);

/** Совпадение значения с условием (ключ варианта, true/false, текст без регистра) — condOk эталона. */
function has(v: S['FieldValue'] | undefined, want: string): boolean {
  if (!v) return false;
  if (v.type === 'choices') return v.value.includes(want);
  if (v.type === 'boolean') return String(v.value) === want;
  if (v.type === 'text' || v.type === 'decimal' || v.type === 'date') {
    return String(v.value).toLowerCase() === want.toLowerCase();
  }
  return false;
}

export function shown(q: Question, vals: Answers): boolean {
  const c = q.showIf;
  if (!c?.conditions.length) return true;
  const r = c.conditions.map((k) => {
    const x = has(vals.get(k.fieldKey), k.value);
    return k.operator === 'not_equals' ? !x : x;
  });
  return c.mode === 'any' ? r.some(Boolean) : r.every(Boolean);
}

/** Подпись значения для БЗ, CSV и сводки (подписи вариантов — из версии, Q-W4.00-forms-3). */
export function labelOf(q: Question | undefined, v: S['FieldValue'] | undefined): string {
  if (!v || v.type === 'null') return '';
  switch (v.type) {
    case 'choices': {
      const labels = v.value.map((k) =>
        k === 'other'
          ? (v.otherText ?? 'Другое')
          : (q?.options?.find((o) => o.key === k)?.label ?? k),
      );
      return labels.join(', ');
    }
    case 'boolean':
      return v.value ? 'да' : 'нет';
    case 'files':
      return `${v.value.length} фото`;
    case 'reference':
      return v.label ?? '';
    case 'money':
      return String(v.value.amountMinor / 100);
    case 'date': {
      const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v.value);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : v.value;
    }
    default:
      return String(v.value);
  }
}

// ---------------------------------------------------------------------------------------------
// Черновик: структура (422) и проблемы до публикации (issues() эталона)

export interface Violation {
  field: string;
  code: string;
  message: string;
}

/** Ошибки структуры черновика — сохранить нельзя. */
export function structureErrors(d: Def): Violation[] {
  const out: Violation[] = [];
  const pages = new Set<string>();
  for (const p of d.pages) {
    if (pages.has(p.id))
      out.push({ field: 'pages', code: 'duplicate', message: 'Страницы повторяются' });
    pages.add(p.id);
  }
  const keys = new Set<string>();
  for (const q of d.fields) {
    if (keys.has(q.key)) {
      out.push({ field: q.key, code: 'duplicate', message: 'Такой идентификатор уже есть' });
    }
    keys.add(q.key);
    if (!pages.has(q.pageId)) {
      out.push({ field: q.key, code: 'unknown_page', message: 'Страница не найдена' });
    }
  }
  return out;
}

const nameOf = (q: Question, i: number): string =>
  q.label.trim() ? `«${q.label.trim()}»` : `Вопрос ${i + 1}`;

/** «До публикации исправьте» — тексты эталона (dc:721–738). */
export function issuesOf(f: FormRow, d: Def): S['FormIssue'][] {
  const E: S['FormIssue'][] = [];
  const idx = new Map(d.fields.map((q, i) => [q.key, i]));
  if (!d.fields.some((q) => q.type !== 'statement')) {
    E.push({ fieldKey: null, message: 'В форме нет ни одного вопроса' });
  }
  const seen = new Set<string>();
  d.fields.forEach((q, i) => {
    const nm = nameOf(q, i);
    const at = (message: string) => E.push({ fieldKey: q.key, message });
    if (!q.label.trim()) at(`${nm}: нет текста`);
    if (OPTS.includes(q.type) && !(q.options ?? []).some((o) => o.label.trim())) {
      at(`${nm}: нет вариантов ответа`);
    } else if (OPTS.includes(q.type) && (q.options ?? []).some((o) => !o.label.trim())) {
      at(`${nm}: есть пустой вариант`);
    }
    if (seen.has(q.key)) at(`Идентификатор ${q.key} повторяется`);
    seen.add(q.key);
    for (const c of q.showIf?.conditions ?? []) {
      const j = idx.get(c.fieldKey);
      if (j === undefined) at(`${nm}: условие ссылается на удалённый вопрос`);
      else if (j >= i) {
        at(
          `${nm}: условие ссылается на вопрос ниже — условие может зависеть только от вопросов выше`,
        );
      }
    }
    if (q.hidden && q.required && !(q.defaultValue ?? '').trim()) {
      at(`${nm}: скрытый обязательный вопрос без значения по умолчанию`);
    }
    const lo = TXT.includes(q.type) ? q.minLength : NUM.includes(q.type) ? q.minValue : undefined;
    const hi = TXT.includes(q.type) ? q.maxLength : NUM.includes(q.type) ? q.maxValue : undefined;
    if (lo !== undefined && hi !== undefined && Number(lo) > Number(hi))
      at(`${nm}: «от» больше «до»`);
  });
  if (f.settings.access === 'public') {
    for (const q of d.fields.filter((x) => CRM.includes(x.type))) {
      E.push({
        fieldKey: q.key,
        message: `«${q.label}»: публичная форма не может спрашивать данные CRM`,
      });
    }
  }
  return E;
}

/** Вопросы определения в формате домена W4.20 (для проверок api.js и kbRun). */
export function domainFields(d: Def): DomainField[] {
  return d.fields.map((q) => {
    const x: DomainField = {
      id: q.key,
      type: q.type as DomainField['type'],
      label: q.label,
      required: q.required,
      page: q.pageId,
    };
    if (q.options)
      x.options = q.options.map((o) => ({
        id: o.key,
        label: o.label,
        ...(o.score !== undefined ? { score: o.score } : {}),
      }));
    return x;
  });
}

/** Проверки api.js publishForm (текст первой — первым нарушением, Q-W4.00-forms-4) + issues(). */
export function publishViolations(f: FormRow, d: Def): Violation[] {
  const out: Violation[] = [];
  try {
    validatePublish(
      { pages: null, fields: domainFields(d) },
      { access: f.settings.access === 'public' ? 'public' : 'internal' },
    );
  } catch (e) {
    out.push({ field: 'form', code: 'publish', message: (e as Error).message });
  }
  for (const i of issuesOf(f, d)) {
    if (out.some((x) => x.message === i.message)) continue;
    out.push({ field: i.fieldKey ?? 'form', code: 'issue', message: i.message });
  }
  return out;
}

/** Предел ключа вопроса (FormQuestion.key: ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$). */
const KEY_MAX = 64;

/** `{key}-v{N}` в пределах 64 знаков; занятый ключ — `-v{N}-2`, `-v{N}-3`… (описание FormVersion, возврат 1). */
function versionKey(key: string, n: number, taken: ReadonlySet<string>): string {
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? `-v${n}` : `-v${n}-${i}`;
    const k = key.slice(0, KEY_MAX - suffix.length) + suffix;
    if (!taken.has(k)) return k;
  }
}

/**
 * Новая версия: вопрос, сменивший тип относительно прошлой версии, получает ключ `{key}-v{N}` (api.js:566) не длиннее
 * 64 знаков; условия показа той же версии следуют за ключом. Условия «Только если» правил и источники «в БЗ» не
 * переименовываются — как в прототипе (описание FormVersion).
 */
export function nextVersion(d: Def, prev: Def | undefined, n: number): Def {
  const out = structuredClone(d);
  const taken = new Set(out.fields.map((q) => q.key));
  for (const q of out.fields) {
    const old = prev?.fields.find((o) => o.key === q.key);
    if (old && old.type !== q.type) {
      const from = q.key;
      q.key = versionKey(from, n, taken);
      taken.add(q.key);
      for (const x of out.fields) {
        for (const c of x.showIf?.conditions ?? []) if (c.fieldKey === from) c.fieldKey = q.key;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ответ сотрудника: проверки (pvCheck), баллы

const PV_TYPE: Partial<Record<S['FormQuestionType'], S['FieldValue']['type'][]>> = {
  text: ['text'],
  longtext: ['text'],
  email: ['text'],
  phone: ['text'],
  inn: ['text'],
  url: ['text'],
  number: ['decimal'],
  int: ['decimal'],
  scale: ['decimal'],
  rating: ['decimal'],
  money: ['money'],
  choice: ['choices'],
  select: ['choices'],
  multi: ['choices'],
  bool: ['boolean'],
  date: ['date', 'instant'],
  photo: ['files'],
  person: ['reference'],
  unit: ['reference'],
  ref: ['reference'],
};

/** Ошибка ввода по вопросу (текст эталона) или null. */
export function pvCheck(q: Question, v: S['FieldValue'] | undefined): string | null {
  if (isEmpty(v)) return q.required && q.type !== 'statement' ? 'Обязательный вопрос' : null;
  const val = v as S['FieldValue'];
  if (q.type === 'statement') return null;
  if (!(PV_TYPE[q.type] ?? []).includes(val.type)) return 'Неверный тип ответа';
  const s = val.type === 'text' || val.type === 'decimal' ? String(val.value) : '';
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  const dig = s.replace(/\D/g, '');
  if (q.type === 'email' && !/^\S+@\S+\.\S+$/.test(s)) return 'Проверьте адрес почты';
  if (q.type === 'phone' && dig.length < 10) return 'Нужно не меньше 10 цифр';
  if (q.type === 'inn' && !(dig.length === 10 || dig.length === 12)) return 'ИНН — 10 или 12 цифр';
  if (q.type === 'url' && !/^https?:\/\/\S+/.test(s))
    return 'Ссылка начинается с http:// или https://';
  if (q.type === 'int' && !/^-?\d+$/.test(s.trim())) return 'Нужно целое число';
  const num = q.type === 'money' && val.type === 'money' ? val.value.amountMinor / 100 : n;
  if (NUM.includes(q.type) && q.minValue !== undefined && num < Number(q.minValue)) {
    return `Не меньше ${q.minValue}`;
  }
  if (NUM.includes(q.type) && q.maxValue !== undefined && num > Number(q.maxValue)) {
    return `Не больше ${q.maxValue}`;
  }
  if (TXT.includes(q.type) && q.minLength !== undefined && s.length < q.minLength) {
    return `Не короче ${q.minLength} символов`;
  }
  if (TXT.includes(q.type) && q.maxLength !== undefined && s.length > q.maxLength) {
    return `Не длиннее ${q.maxLength} символов`;
  }
  if (val.type === 'choices') {
    const keys = q.options?.map((o) => o.key) ?? [];
    if (val.value.some((k) => !keys.includes(k) && !(k === 'other' && q.otherOption))) {
      return 'Выберите вариант из списка';
    }
    if (q.type !== 'multi' && val.value.length > 1) return 'Выберите один вариант';
    if (q.type === 'multi' && q.minSelected && val.value.length < q.minSelected) {
      return `Выберите не меньше ${q.minSelected}`;
    }
    if (q.type === 'multi' && q.maxSelected && val.value.length > q.maxSelected) {
      return `Выберите не больше ${q.maxSelected}`;
    }
  }
  if (val.type === 'files' && val.value.length > (q.maxFiles ?? 5)) {
    return `Не больше ${q.maxFiles ?? 5} файлов`;
  }
  return null;
}

/** Баллы теста (score() эталона): варианты с баллами показанных вопросов выбора. */
export function scoreOf(d: Def, vals: Answers, passScore: number | null): S['FormResponseScore'] {
  let points = 0;
  let max = 0;
  for (const q of d.fields.filter((x) => OPTS.includes(x.type) && !x.hidden && shown(x, vals))) {
    const sc = (q.options ?? []).map((o) => o.score ?? 0);
    const v = vals.get(q.key);
    const picked = v?.type === 'choices' ? v.value : [];
    const scoreOfKey = (k: string) => q.options?.find((o) => o.key === k)?.score ?? 0;
    if (q.type === 'multi') max += sc.filter((k) => k > 0).reduce((a, k) => a + k, 0);
    else max += Math.max(0, ...sc);
    points += picked.reduce((a, k) => a + scoreOfKey(k), 0);
  }
  return { points, maxPoints: max, passed: passScore === null ? null : points >= passScore };
}

// ---------------------------------------------------------------------------------------------
// Действия после ответа

/** Момент ответа как в эталоне («ДД.ММ ЧЧ:ММ», Москва) — переменная $at. */
export function mskLabel(at: string): string {
  const d = new Date(Date.parse(at) + 3 * 3600_000).toISOString();
  return `${d.slice(8, 10)}.${d.slice(5, 7)} ${d.slice(11, 16)}`;
}

/** Правило срабатывает на ответ: когда (принят / отправлен) и «Только если» — kbFits эталона. */
export function fits(rule: RuleRow, r: ResponseRow): boolean {
  if (rule.trigger === 'accepted' && r.reviewStatus !== 'accepted') return false;
  const c = rule.condition;
  if (c.fieldKey) return has(answersOf(r).get(c.fieldKey), c.value ?? '');
  return true;
}

const statusLabel = (r: ResponseRow): string =>
  r.reviewStatus === 'accepted'
    ? 'Принят'
    : r.reviewStatus === 'rejected'
      ? 'Отклонён'
      : 'На проверке';

/** Форма, ответ и правило «в БЗ» в формате домена W4.20 — для kbRun (тот же код, что у эталона). */
function domainShapes(v: FormsView, f: FormRow, r: ResponseRow, rule: RuleRow) {
  const versions = f.versions.map((x) => ({
    v: x.number,
    at: '',
    by: x.byName,
    fields: domainFields(x.definition),
  }));
  const ver = f.versions.find((x) => x.number === r.versionNumber);
  const vals = answersOf(r);
  const values: DomainResponse['values'] = {};
  for (const [key, val] of vals) {
    values[key] = labelOf(
      ver?.definition.fields.find((q) => q.key === key),
      val,
    );
  }
  const form = {
    id: f.proto,
    name: f.name,
    module: null,
    owner: f.ownerName,
    status: f.status,
    published: current(f)?.number ?? null,
    versions,
    automations: [],
  } as DomainForm;
  const resp: DomainResponse = {
    id: r.number,
    formId: f.proto,
    version: r.versionNumber,
    at: mskLabel(r.submittedAt),
    author: r.authorName,
    object: r.subject?.label ?? '',
    status: statusLabel(r),
    values,
    actions: r.actions
      .filter((a) => a.ok)
      .map((a) => ({
        rule: protoOfRule(v, a.ruleId),
        rv: a.ruleVersion,
        kind: 'kb',
        at: '',
        ok: true,
      })),
  };
  const kb = rule.kb as S['FormRuleKbInput'];
  const node = kbNodeByUuid(v, kb.nodeId);
  const table = v.kb.db.knowledge?.tables?.find((t) => v.U(t.id) === kb.tableId);
  const col = (id: string | undefined) =>
    table?.columns.find((c) => v.U(c.id) === id)?.id ?? id ?? '';
  const author = v.org.members.find((m) => m.id === rule.authorId);
  const x: DomainRule = {
    id: rule.proto,
    kind: 'kb',
    on: rule.enabled,
    version: rule.version,
    mode: kb.mode,
    page: node?.id ?? '',
    pos: kb.position,
    when: rule.trigger === 'accepted' ? 'accepted' : 'any',
    by: rule.authorName,
    byId: author?.proto ?? '',
    ...(table ? { table: table.id } : {}),
    ...(kb.head ? { head: kb.head } : {}),
    fields: kb.fields.map((q) => ({
      ...(q.columnId ? { col: col(q.columnId) } : {}),
      name: q.name,
      src: q.source,
    })),
  };
  return { form, resp, x };
}

const protoOfRule = (v: FormsView, id: string): string =>
  v.data.rules.find((x) => x.id === id)?.proto ?? id;

function record(r: ResponseRow, a: ActionRow): ActionRow {
  r.actions = r.actions.filter((x) => x.ruleId !== a.ruleId).concat([a]);
  return a;
}

function runKb(v: FormsView, f: FormRow, r: ResponseRow, rule: RuleRow): ActionRow {
  const { form, resp, x } = domainShapes(v, f, r, rule);
  const clock: Clock = { now: () => new Date(v.now) };
  const res = kbRun(
    {
      db: v.kb.db as never,
      kb: v.kb.db.knowledge as unknown as FormsKnowledge,
      clock,
      ids: { next: (p: string) => `${p}w${++v.kb.seq}`, peek: () => v.kb.seq },
      emit: () => ({ id: '', at: '', text: '', to: [], sensitive: null }),
      access: ACCESS,
    },
    form,
    resp,
    x,
  );
  return record(r, {
    ruleId: rule.id,
    ruleVersion: rule.version,
    kind: 'kb',
    ok: res.ok,
    at: v.now,
    ...(res.text ? { text: res.text } : {}),
    ...(res.err ? { error: res.err } : {}),
    ...(res.ok && res.page ? { kbNode: res.page } : {}),
  });
}

function runTask(v: FormsView, f: FormRow, r: ResponseRow, rule: RuleRow): ActionRow {
  const spec = rule.task as S['FormRuleTask'];
  const base = { ruleId: rule.id, ruleVersion: rule.version, kind: 'task' as const, at: v.now };
  const done = r.actions.find((a) => a.ruleId === rule.id && a.ok);
  if (done) return done;
  const td = tasksDataOf(v.org);
  const p = td.projects.find((x) => x.id === spec.projectId);
  if (!p) return record(r, { ...base, ok: false, error: 'проект задачи удалён' });
  const c = canIn(v.ctx.s, v.org, p, rule.authorId, 'tasks.create', v.now);
  if (!c.ok) {
    return record(r, {
      ...base,
      ok: false,
      error: `у автора правила ${rule.authorName} нет права «Создавать» в проекте «${p.name}»`,
    });
  }
  const wf = currentWorkflow(p);
  const first = wf?.statuses.find((s) => s.category === 'todo') ?? wf?.statuses[0];
  const ver = f.versions.find((x) => x.number === r.versionNumber);
  const lines = ver?.definition.fields
    .filter((q) => q.type !== 'statement')
    .map((q) => ({ q, val: labelOf(q, answersOf(r).get(q.key)) }))
    .filter((x) => x.val)
    .map((x) => `${x.q.label}: ${x.val}`);
  p.taskSeq++;
  const key = `${p.key}-${p.taskSeq}`;
  const task: TaskRow = {
    id: v.U(`fmtask-${r.proto}-${rule.proto}`),
    proto: '',
    key,
    projectId: p.id,
    title: spec.title,
    description: [...(lines ?? []), `Ответ ${r.number} формы «${f.name}»`].join('\n'),
    statusId: first?.id ?? 's1',
    priority: 'normal',
    labels: [],
    assigneeId: spec.assigneeMemberId,
    authorId: rule.authorId,
    checklist: [],
    files: [],
    fromForm: true,
    revision: 1,
    createdAt: v.now,
    updatedAt: v.now,
  };
  if (p.flow === 'tasks' && wf) task.workflowVersion = wf.version;
  td.tasks.unshift(task);
  const who = v.org.members.find((m) => m.id === spec.assigneeMemberId)?.displayName ?? '—';
  return record(r, {
    ...base,
    ok: true,
    text: `Задача ${key} «${spec.title}» · ${who} · ${first?.name ?? 'Новая'}`,
    taskId: task.id,
    taskKey: key,
  });
}

function runNotify(v: FormsView, f: FormRow, r: ResponseRow, rule: RuleRow): ActionRow {
  const done = r.actions.find((a) => a.ruleId === rule.id && a.ok);
  if (done) return done;
  const spec = rule.notify as S['FormRuleNotify'];
  const m = v.org.members.find((x) => x.id === spec.memberId);
  const acc = v.ctx.s.memberships.find(
    (x) => x.tenantId === v.org.tenantId && x.memberId === spec.memberId,
  );
  if (acc) {
    v.org.notifications.push({
      accountId: acc.accountId,
      id: newId(v.ctx.s, v.org.proto),
      kind: 'forms.response.submitted',
      severity: 'info',
      title: `Форма «${f.name}»: ответ ${r.number}`,
      object: { moduleKey: 'forms', entityType: 'response', entityId: r.id },
      createdAt: v.now,
      readAt: null,
    });
  }
  return record(r, {
    ruleId: rule.id,
    ruleVersion: rule.version,
    kind: 'notify',
    ok: true,
    at: v.now,
    text: `Уведомление в CRM → ${m?.displayName ?? '—'}`,
  });
}

/** Выполнить правило для ответа (письмо и HTTP на показе не выполняются — Q-W4.00-forms-15). */
export function runRule(v: FormsView, f: FormRow, r: ResponseRow, rule: RuleRow): ActionRow | null {
  if (rule.kind === 'kb') return runKb(v, f, r, rule);
  if (rule.kind === 'task') return runTask(v, f, r, rule);
  if (rule.kind === 'notify') return runNotify(v, f, r, rule);
  return null;
}

/** Все включённые правила формы, которые подходят ответу. */
export function runRules(v: FormsView, f: FormRow, r: ResponseRow): void {
  for (const rule of v.data.rules.filter((x) => x.formId === f.id && x.enabled)) {
    if (fits(rule, r)) runRule(v, f, r, rule);
  }
}

// ---------------------------------------------------------------------------------------------
// Проекция в схемы контракта

const ref = (id: string | null, name: string): S['FormMemberRef'] => ({
  memberId: id,
  displayName: name,
});

/**
 * Право поля reviewFormResponse (forms.responses.review, forms.responses.assign; Q-W4.05-16): в области формы; или
 * участник — назначенный на ответ и держит ключ в любой роли; или форма «Вся организация», ключ в любой роли и ответ
 * виден по связи с объектом (Q-W4.00-forms-9). Проверяющий другого подразделения, видящий ответ формы подразделения
 * только по связи, — нет.
 */
export function mayReview(v: FormsView, f: FormRow, r: ResponseRow, key: string): boolean {
  if (v.can(f, key)) return true;
  if (!v.any(key)) return false;
  if (r.assigneeMemberId && r.assigneeMemberId === v.me) return true;
  return f.orgUnitId === null && v.sees(f, r);
}

/**
 * Право проверки у ответа (FormResponse.my, возврат 2): то же правило, что у полей reviewFormResponse (mayReview) —
 * назначенный на ответ с ключом в другой области видит «Принять» и «Отклонить», хотя FormMy.reviewResponses формы — нет.
 */
export function responseMy(v: FormsView, f: FormRow, r: ResponseRow): S['FormResponseMy'] {
  return {
    review: mayReview(v, f, r, 'forms.responses.review'),
    assign: mayReview(v, f, r, 'forms.responses.assign'),
  };
}
export function visibleResponses(v: FormsView, f: FormRow): ResponseRow[] {
  return v.data.responses.filter((r) => r.formId === f.id && v.sees(f, r));
}

/** Приём ответов открыт: опубликована, не закрыта, срок и лимит, модуль формы подключён. */
export function accepting(v: FormsView, f: FormRow): boolean {
  if (f.status !== 'published') return false;
  if (f.settings.acceptUntil) {
    const msk = new Date(Date.parse(v.now) + 3 * 3600_000).toISOString().slice(0, 10);
    if (msk > f.settings.acceptUntil) return false;
  }
  const total = v.data.responses.filter((r) => r.formId === f.id).length;
  if (f.settings.responseLimit !== null && total >= f.settings.responseLimit) return false;
  if (f.moduleKey && v.org.modules[f.moduleKey] && v.org.modules[f.moduleKey]?.state !== 'active') {
    return false;
  }
  return true;
}

export const answered = (v: FormsView, f: FormRow): boolean =>
  v.data.responses.some((r) => r.formId === f.id && r.authorId === v.me);

export function formDto(v: FormsView, f: FormRow): S['Form'] {
  const cur = current(f);
  const publish = v.can(f, 'forms.publish');
  const out: S['Form'] = {
    id: f.id,
    orgUnitId: f.orgUnitId,
    name: f.name,
    status: f.status,
    revision: f.revision,
    moduleKey: f.moduleKey,
    templateId: f.templateId,
    groupId: f.groupId,
    owner: ref(f.ownerId || null, f.ownerName),
    updatedAt: f.updatedAt,
    publishedVersionNumber: cur?.number ?? null,
    versionCount: f.versions.length,
    hasUnpublishedChanges: Boolean(cur) && f.draft.hasChanges,
    questionCount: questionCount(f.draft.definition),
    responseCount: visibleResponses(v, f).length,
    enabledRuleCount: v.data.rules.filter((x) => x.formId === f.id && x.enabled).length,
    settings: structuredClone(f.settings),
    share: { publicToken: publish && cur && f.settings.access === 'public' ? f.publicToken : null },
    my: {
      create: v.can(f, 'forms.create'),
      manage: v.can(f, 'forms.manage'),
      publish,
      publishPublic: v.can(f, 'forms.publish_public'),
      readResponses: v.any('forms.responses.read'),
      reviewResponses:
        v.can(f, 'forms.responses.review') ||
        (f.orgUnitId === null && v.any('forms.responses.review')),
      respond: accepting(v, f) && !(f.settings.onePerMember && answered(v, f)),
    },
  };
  const latest = f.versions.at(-1);
  if (latest) out.latestVersionId = latest.id;
  if (cur) out.publishedVersionId = cur.id;
  return out;
}

export function draftDto(f: FormRow): S['FormDraft'] {
  const d = f.draft;
  const out: S['FormDraft'] = {
    formId: f.id,
    definition: structuredClone(d.definition),
    revision: d.revision,
    hasChanges: d.hasChanges,
    baseVersionNumber: current(f)?.number ?? null,
    issues: issuesOf(f, d.definition),
  };
  if (d.savedAt) out.savedAt = d.savedAt;
  if (d.savedById) out.savedBy = ref(d.savedById, d.savedByName ?? '');
  return out;
}

export function versionDto(f: FormRow, x: FormRow['versions'][number]): S['FormVersion'] {
  return {
    id: x.id,
    formId: f.id,
    number: x.number,
    definition: structuredClone(x.definition),
    createdAt: x.createdAt,
    createdBy: ref(x.byId, x.byName),
    questionCount: questionCount(x.definition),
    current: current(f)?.id === x.id,
  };
}

export function ruleDto(v: FormsView, rule: RuleRow): S['FormRule'] {
  const f = v.data.forms.find((x) => x.id === rule.formId) as FormRow;
  const rs = v.data.responses.filter((r) => r.formId === rule.formId);
  const acts = rs.map((r) => r.actions.find((a) => a.ruleId === rule.id));
  const out: S['FormRule'] = {
    id: rule.id,
    formId: rule.formId,
    kind: rule.kind,
    enabled: rule.enabled,
    version: rule.version,
    trigger: rule.trigger,
    condition: { ...rule.condition },
    author: ref(rule.authorId, rule.authorName),
    doneCount: acts.filter((a) => a?.ok).length,
    failedCount: acts.filter((a) => a && !a.ok).length,
    pendingBackfillCount:
      rule.kind === 'kb'
        ? rs.filter((r) => fits(rule, r) && !r.actions.some((a) => a.ruleId === rule.id && a.ok))
            .length
        : 0,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    revision: rule.revision,
  };
  if (rule.task) out.task = { ...rule.task };
  if (rule.notify) out.notify = { ...rule.notify };
  // Адрес письма и URL запроса (секрет вебхука) — только с «Настраивать» в области формы (Q-W4.05-18).
  const manage = v.can(f, 'forms.manage');
  if (rule.email && manage) out.email = { ...rule.email };
  if (rule.http && manage) out.http = { ...rule.http };
  if (rule.kb) {
    const node = kbNodeByUuid(v, rule.kb.nodeId);
    const kb: S['FormRuleKb'] = structuredClone(rule.kb);
    if (node && kbSees(v, node)) kb.node = { id: v.U(node.id), title: node.title };
    const t = v.kb.db.knowledge?.tables?.find((x) => v.U(x.id) === rule.kb?.tableId);
    if (t && node && kbSees(v, node)) kb.tableTitle = t.title;
    out.kb = kb;
  }
  return out;
}

export function responseDto(v: FormsView, f: FormRow, r: ResponseRow): S['FormResponse'] {
  const ver = f.versions.find((x) => x.number === r.versionNumber);
  const out: S['FormResponse'] = {
    id: r.id,
    formId: f.id,
    versionId: ver?.id ?? f.id,
    submittedAt: r.submittedAt,
    answers: structuredClone(r.answers),
    reviewStatus: r.reviewStatus,
    revision: r.revision,
    number: r.number,
    versionNumber: r.versionNumber,
    author: ref(r.authorId, r.authorName),
    channel: r.channel,
    my: responseMy(v, f, r),
    actions: r.actions.map((a) => {
      const x: S['FormResponseAction'] = {
        ruleId: a.ruleId,
        ruleVersion: a.ruleVersion,
        kind: a.kind,
        ok: a.ok,
        at: a.at,
        retryable: !a.ok && v.data.rules.some((y) => y.id === a.ruleId),
      };
      if (a.text) x.text = a.text;
      if (a.error) x.error = a.error;
      const n = a.kbNode ? v.kb.db.knowledge?.pages.find((p) => p.id === a.kbNode) : undefined;
      if (n && kbSees(v, n)) x.node = { id: v.U(n.id), title: n.title };
      if (a.taskId) x.taskId = a.taskId;
      if (a.taskKey) x.taskKey = a.taskKey;
      return x;
    }),
  };
  if (r.subject) out.subject = structuredClone(r.subject);
  if (r.score) out.score = { ...r.score };
  if (r.assigneeMemberId) out.assigneeMemberId = r.assigneeMemberId;
  if (r.reviewComment) out.reviewComment = r.reviewComment;
  if (r.linkParamKeys?.length) out.linkParamKeys = [...r.linkParamKeys];
  return out;
}

// ---------------------------------------------------------------------------------------------
// Сводка и CSV: вопросы всех версий, свежая версия первой (respCols, dc:985)

export function columnsOf(f: FormRow): Question[] {
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const ver of [...f.versions].reverse()) {
    for (const q of ver.definition.fields) {
      if (q.type === 'statement' || seen.has(q.key)) continue;
      seen.add(q.key);
      out.push(q);
    }
  }
  return out;
}

const dec = (n: number): string => String(Math.round(n * 100) / 100);

export function summaryOf(f: FormRow, rs: ResponseRow[]): S['FormResponseSummary'] {
  const questions = columnsOf(f).map((q) => {
    const vals = rs
      .map((r) => answersOf(r).get(q.key))
      .filter((x) => !isEmpty(x)) as S['FieldValue'][];
    const s: S['FormQuestionSummary'] = {
      fieldKey: q.key,
      label: q.label,
      type: q.type,
      answered: vals.length,
    };
    const pct = (n: number) => (vals.length ? Math.round((n * 100) / vals.length) : 0);
    if (OPTS.includes(q.type) || q.type === 'bool') {
      const opts =
        q.type === 'bool'
          ? [
              { key: 'true', label: 'Да' },
              { key: 'false', label: 'Нет' },
            ]
          : (q.options ?? []).map((o) => ({ key: o.key, label: o.label }));
      s.options = opts.map((o) => {
        const count = vals.filter((x) => has(x, o.key)).length;
        return { key: o.key, label: o.label, count, percent: pct(count) };
      });
    }
    const nums = vals.filter((x) => x.type === 'decimal').map((x) => Number(x.value));
    if (nums.length) {
      s.numbers = {
        average: dec(nums.reduce((a, n) => a + n, 0) / nums.length),
        min: dec(Math.min(...nums)),
        max: dec(Math.max(...nums)),
      };
    }
    if (!OPTS.includes(q.type) && q.type !== 'bool' && !nums.length) {
      s.recentTexts = vals.slice(0, 3).map((x) => labelOf(q, x).slice(0, 500));
    }
    return s;
  });
  return { formId: f.id, total: rs.length, questions };
}

/** Начало формулы Excel: = + - @ (и после ведущих пробелов), TAB, CR — как у exportDataset. */
const FORMULA = /^(?:[\t\r]|\s*[=+\-@])/;
/** Вопросы, чьи ячейки — числа, даты и «да / нет»: апостроф им не ставится («-5» остаётся числом). */
const PLAIN: readonly S['FormQuestionType'][] = [
  'number',
  'int',
  'scale',
  'rating',
  'money',
  'date',
  'bool',
];

/**
 * Ячейка CSV выгрузки ответов (описание exportFormResponses, возврат 1): текстовая ячейка (ответы текстовых, выбора,
 * CRM и файловых вопросов, автор, объект, подписи вопросов), начинающаяся с = + - @ TAB CR, в том числе после ведущих
 * пробелов, — с апострофом (CSV formula injection, OWASP; ответы гостей публичной формы — свободный текст); «;»,
 * кавычки, CR и LF — в кавычках RFC 4180.
 */
export function csvCell(s: string, text = true): string {
  const out = text && FORMULA.test(s) ? `'${s}` : s;
  return /[;"\r\n]/.test(out) ? `"${out.replaceAll('"', '""')}"` : out;
}

export function csvOf(f: FormRow, rs: ResponseRow[]): string {
  const cols = columnsOf(f);
  const head = [
    'Ответ',
    'Дата',
    'Автор',
    'Объект',
    'Версия',
    'Статус',
    ...cols.map((q) => q.label),
  ];
  const lines = rs.map((r) => {
    const vals = answersOf(r);
    const d = new Date(Date.parse(r.submittedAt) + 3 * 3600_000).toISOString();
    return [
      csvCell(r.number, false),
      csvCell(`${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)} ${d.slice(11, 16)}`, false),
      csvCell(r.authorName),
      csvCell(r.subject?.label ?? ''),
      csvCell(`v${r.versionNumber}`, false),
      csvCell(statusLabel(r), false),
      ...cols.map((q) => csvCell(labelOf(q, vals.get(q.key)), !PLAIN.includes(q.type))),
    ];
  });
  const rows = [head.map((h) => csvCell(h)), ...lines];
  return '﻿' + rows.map((l) => l.join(';')).join('\r\n') + '\r\n';
}
