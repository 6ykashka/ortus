// Тег Forms сценарного сервера (W4.05, контрактный PR 4 этапа 4; W4.21–W4.23, кандидаты W4.27, W4.28): «Формы и
// опросы» поверх домена W4.20 — список и группы, шаблоны, черновик с ревизией и публикация с проверками issues(),
// настройки, правила пяти видов («в БЗ» — kbRun на срезе W4.04, «задача» — проект W4.03), отправка сотрудником,
// ответы v2, сводка, CSV, варианты вопросов CRM (эталон «Формы и опросы.dc.html», design-2026-10-19).
// Права — в области формы (Q-W4.00-forms-7, -8, -9, -12): владелец; организация; подразделение формы (форма «Вся
// организация» видна и с ролью подразделения). Скрытое — 404, как отсутствующее.
import type { components } from '@ortus/api-client';
import { ddmmyyyy } from '@ortus/domain';
import { FORM_TEMPLATES, kbAccess, type KbNode, templateDef } from '@ortus/domain/modules';

import { moduleLabel } from '../core/catalog.ts';
import { notifyOwners } from '../core/notify.ts';
import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { covers, fleetOf, tripVisible, unitsFor } from '../fleet/state.ts';
import { accessOf, tasksDataOf } from '../tasks/state.ts';
import {
  accepting,
  answered,
  csvOf,
  draftDto,
  fits,
  formDto,
  mayReview,
  publishViolations,
  pvCheck,
  responseDto,
  ruleDto,
  runRule,
  runRules,
  scoreOf,
  shown,
  structureErrors,
  summaryOf,
  versionDto,
  visibleResponses,
  type Violation,
  nextVersion,
} from './engine.ts';
import {
  CRM,
  current,
  type Def,
  type FormRow,
  formOr404,
  type FormsView,
  kbNodeByUuid,
  moduleKeyOf,
  OPTS,
  type ResponseRow,
  type RuleRow,
  settingsOf,
  toDefV2,
  viewOf,
} from './state.ts';

type S = components['schemas'];

const body = <T>(ctx: HandlerContext): T => ctx.body as T;
const has = (o: object, k: string): boolean => Object.hasOwn(o, k);

function invalid(field: string, message: string, code = 'invalid'): never {
  return fail('validation_failed', message, { violations: [{ field, code, message }] });
}

function invalidAll(vs: Violation[], detail = vs[0]?.message): never {
  return fail('validation_failed', detail, { violations: vs });
}

/** Отказ без права в области формы (тексты — по подписям каталога, no-reference). */
export const NEED: Readonly<Record<string, string>> = {
  'forms.read': 'Нет права «Видеть формы»',
  'forms.create': 'Нет права «Создавать формы»',
  'forms.manage': 'Нет права «Настраивать» формы',
  'forms.publish': 'Нет права «Публиковать версии»',
  'forms.publish_public': 'Нужно право «Публичные ссылки»',
  'forms.responses.read': 'Нет права «Читать ответы»',
  'forms.responses.review': 'Нет права «Проверять ответы»',
  'forms.responses.assign': 'Нет права «Назначать ответственного за ответ»',
};

function need(v: FormsView, f: FormRow, key: string): void {
  if (!v.can(f, key)) fail('forbidden_action', NEED[key]);
}

/** Строгий If-Match ревизии черновика с текстом эталона двух редакторов. */
const DRAFT_CONFLICT = 'Черновик изменил другой редактор — обновите страницу';
function draftMatch(ctx: HandlerContext, rev: number): void {
  if (ctx.headers.get('If-Match') !== `"rev-${rev}"`) fail('revision_mismatch', DRAFT_CONFLICT);
}

const nameTaken = (v: FormsView, name: string, except?: string): boolean =>
  v.data.forms.some((x) => x.id !== except && x.name.toLowerCase() === name.toLowerCase());

function unitOr422(v: FormsView, id: string | null | undefined): string | null {
  if (!id) return null;
  const u = v.org.units.find((x) => x.id === id.toLowerCase());
  if (!u) invalid('orgUnitId', 'Область не найдена');
  return u.id;
}

function groupOr422(v: FormsView, id: string | null | undefined): string | null {
  if (!id) return null;
  const g = v.data.groups.find((x) => x.id === id.toLowerCase());
  if (!g) invalid('groupId', 'Группа не найдена');
  return g.id;
}

const touch = (v: FormsView, f: FormRow): void => {
  f.revision++;
  f.updatedAt = v.now;
};

const token = (v: FormsView, f: FormRow): string =>
  `f${v.U(`token:${f.proto}:${f.revision}`).replaceAll('-', '')}`;

function crmQuestion(f: FormRow): S['FormQuestion'] | undefined {
  const defs = [f.draft.definition, current(f)?.definition].filter(Boolean) as Def[];
  for (const d of defs) {
    const q = d.fields.find((x) => CRM.includes(x.type));
    if (q) return q;
  }
  return undefined;
}

const sameDef = (a: Def | undefined, b: Def | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------------------------------------------------------------------------------------------
// Правила: проверка настройки вида

const RULE_OBJECTS = ['task', 'notify', 'email', 'http', 'kb'] as const;

type RuleInput = Pick<S['FormRuleCreate'], 'kind' | 'trigger' | 'condition'> &
  Partial<Pick<S['FormRuleCreate'], (typeof RULE_OBJECTS)[number]>>;

function checkRule(v: FormsView, f: FormRow, x: RuleInput): void {
  for (const k of RULE_OBJECTS) {
    if (k !== x.kind && x[k] !== undefined) invalid(k, 'Настройки другого вида действия');
  }
  if (x[x.kind] === undefined) invalid(x.kind, 'Настройте действие');
  const c = x.condition;
  if (c && (c.fieldKey === null) !== (c.value === null)) {
    invalid('condition', 'Укажите вопрос и ответ условия');
  }
  if (c?.fieldKey) {
    const defs = [f.draft.definition, current(f)?.definition].filter(Boolean) as Def[];
    const q = defs.flatMap((d) => d.fields).find((y) => y.key === c.fieldKey);
    if (!q || !(OPTS.includes(q.type) || q.type === 'bool')) {
      invalid('condition.fieldKey', 'Вопрос не найден');
    }
  }
  if (x.kind === 'task' && x.task) {
    if (!x.task.title.trim()) invalid('task.title', 'Укажите название задачи');
    const p = tasksDataOf(v.org).projects.find((y) => y.id === x.task?.projectId.toLowerCase());
    if (
      !p ||
      !v.me ||
      !accessOf(v.ctx.s, v.org, p, v.me, v.now)?.actions.includes('tasks.create')
    ) {
      invalid('task.projectId', 'Нет права создавать задачи в проекте');
    }
    const who = v.org.members.find((m) => m.id === x.task?.assigneeMemberId.toLowerCase());
    if (!who || who.status !== 'active') invalid('task.assigneeMemberId', 'Выберите исполнителя');
  }
  if (x.kind === 'notify' && x.notify) {
    const who = v.org.members.find((m) => m.id === x.notify?.memberId.toLowerCase());
    if (!who || who.status !== 'active') invalid('notify.memberId', 'Выберите, кого уведомить');
  }
  if (x.kind === 'kb' && x.kb) {
    const kb = x.kb;
    if (f.settings.access === 'public' && x.trigger === 'submitted') {
      invalid(
        'trigger',
        'Публичная форма: в Базу знаний попадают только принятые ответы, чтобы туда не попал спам.',
      );
    }
    const node = kbNodeByUuid(v, kb.nodeId);
    if (!node || !viewSees(v, node)) invalid('kb.nodeId', 'Выберите страницу Базы знаний');
    if (kb.mode === 'table') {
      const t = v.kb.db.knowledge?.tables?.find(
        (y) => v.U(y.id) === kb.tableId?.toLowerCase() && y.page === node.id,
      );
      if (!t) invalid('kb.tableId', 'Выберите таблицу');
      if (!kb.fields.some((q) => q.columnId && q.source)) {
        invalid('kb.fields', 'Укажите данные хотя бы для одного столбца');
      }
    } else if (!kb.fields.some((q) => q.source)) {
      invalid('kb.fields', 'Выберите, что записать');
    }
    const names = kb.fields.map((q) => q.name.trim().toLowerCase());
    if (names.some((n) => !n)) invalid('kb.fields', 'У поля нет названия');
    if (new Set(names).size !== names.length) invalid('kb.fields', 'Названия полей повторяются');
    if (allEmployeesSee(v, node) && !kb.allEmployeesConfirmed) {
      invalid(
        'kb.allEmployeesConfirmed',
        'Подтвердите, что записи увидят все сотрудники с доступом к странице',
      );
    }
  }
}

function viewSees(v: FormsView, n: KbNode): boolean {
  const opts = { today: ddmmyyyy({ now: () => new Date(v.now) }) };
  return !n.archived && kbAccess(v.kb.db, v.meProto, n, opts).view;
}

/** Страницу видит каждый активный сотрудник (подтверждение «Понимаю: записи увидят все…»). */
function allEmployeesSee(v: FormsView, n: KbNode): boolean {
  const opts = { today: ddmmyyyy({ now: () => new Date(v.now) }) };
  return v.kb.db.members
    .filter((m) => m.status === 'active')
    .every((m) => kbAccess(v.kb.db, m.id, n, opts).view);
}

function ruleOr404(v: FormsView, f: FormRow): RuleRow {
  const id = (v.ctx.params.ruleId ?? '').toLowerCase();
  const r = v.data.rules.find((x) => x.id === id && x.formId === f.id);
  if (!r) fail('not_found', 'Действие не найдено');
  return r;
}

function responseOr404(v: FormsView, f: FormRow): ResponseRow {
  const id = (v.ctx.params.responseId ?? '').toLowerCase();
  const r = v.data.responses.find((x) => x.id === id && x.formId === f.id);
  if (!r || !v.sees(f, r)) fail('not_found', 'Ответ не найден');
  return r;
}

// ---------------------------------------------------------------------------------------------
// Ответ сотрудника

const MEMBER = { moduleKey: 'core', entityType: 'member' } as const;
const UNIT = { moduleKey: 'core', entityType: 'org_unit' } as const;

function referenceLabel(v: FormsView, q: S['FormQuestion'], ref: S['ObjectRef']): string | null {
  const id = ref.entityId.toLowerCase();
  if (q.type === 'person') return v.org.members.find((m) => m.id === id)?.displayName ?? null;
  if (q.type === 'unit') return v.org.units.find((u) => u.id === id)?.name ?? null;
  const o = optionsFor(v, q, '').find((x) => x.ref.entityId === id);
  return o?.label ?? null;
}

/** Варианты вопроса CRM по правам отвечающего (Q-W4.00-forms-23). */
function optionsFor(v: FormsView, q: S['FormQuestion'], text: string): S['FormFieldOption'][] {
  const qn = text.trim().toLowerCase();
  const out: S['FormFieldOption'][] = [];
  if (q.type === 'person') {
    for (const m of v.org.members.filter((x) => x.status === 'active')) {
      out.push({ ref: { ...MEMBER, entityId: m.id }, label: m.displayName });
    }
  } else if (q.type === 'unit') {
    const level = q.unitLevel ?? 'any';
    for (const u of v.org.units.filter((x) => x.status === 'active')) {
      if (level === 'region' && u.kind !== 'region') continue;
      if (level === 'firm' && u.kind === 'region') continue;
      out.push({
        ref: { ...UNIT, entityId: u.id },
        label: u.name,
        hint: u.kind === 'region' ? 'регион' : 'фирма',
      });
    }
  } else if (q.type === 'ref') {
    const kind = q.refKind ?? 'vehicle';
    if (kind === 'vehicle' || kind === 'trip') {
      if (v.org.modules.fleet?.state === 'active') {
        const fl = fleetOf(v.org);
        if (kind === 'vehicle') {
          const units = unitsFor(v.t, 'fleet.vehicles.read', v.now);
          for (const x of fl.vehicles.filter((y) => covers(units, y.orgUnitId))) {
            out.push({
              ref: { moduleKey: 'fleet', entityType: 'vehicle', entityId: x.id },
              label: x.displayName,
              hint: x.registrationNumber,
            });
          }
        } else {
          for (const x of fl.trips.filter((y) => tripVisible(v.ctx, y))) {
            out.push({
              ref: { moduleKey: 'fleet', entityType: 'trip', entityId: x.id },
              label: `Рейс ${x.number}`,
              hint: x.title,
            });
          }
        }
      }
    } else if (kind === 'task') {
      const td = tasksDataOf(v.org);
      for (const x of td.tasks.filter((y) => !y.deleted)) {
        const p = td.projects.find((y) => y.id === x.projectId);
        const a = p && v.me ? accessOf(v.ctx.s, v.org, p, v.me, v.now) : null;
        if (!a?.actions.includes('tasks.read') && x.assigneeId !== v.me) continue;
        out.push({
          ref: { moduleKey: 'tasks', entityType: 'task', entityId: x.id },
          label: `${x.key} ${x.title}`,
        });
      }
    }
    // Объекты ремонта (object) — модуль «Ремонт и стройка» этапа 6: вариантов нет.
  }
  return out
    .filter((o) => !qn || o.label.toLowerCase().includes(qn))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

function subjectOf(
  v: FormsView,
  ref: S['ObjectRef'] | undefined,
): S['FormResponseSubject'] | undefined {
  if (!ref) return undefined;
  const id = ref.entityId.toLowerCase();
  if (ref.moduleKey === 'fleet' && ref.entityType === 'trip') {
    const trip = fleetOf(v.org).trips.find((x) => x.id === id);
    if (trip && tripVisible(v.ctx, trip))
      return { ref: { ...ref, entityId: id }, label: `Рейс ${trip.number}` };
  }
  if (ref.moduleKey === 'tasks' && ref.entityType === 'task') {
    const td = tasksDataOf(v.org);
    const t = td.tasks.find((x) => x.id === id && !x.deleted);
    const p = t ? td.projects.find((x) => x.id === t.projectId) : undefined;
    const a = p && v.me ? accessOf(v.ctx.s, v.org, p, v.me, v.now) : null;
    if (t && (a?.actions.includes('tasks.read') || t.assigneeId === v.me)) {
      return { ref: { ...ref, entityId: id }, label: `Задача ${t.key}` };
    }
  }
  return invalid('subject', 'Объект не найден');
}

function nextNumber(v: FormsView): string {
  const max = v.data.responses.reduce(
    (m, r) => Math.max(m, Number(r.number.replace(/\D/g, '')) || 0),
    0,
  );
  return `R-${String(max + 1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------------------------

export const formsHandlers: Registry = {
  listForms: (ctx) => {
    const v = viewOf(ctx);
    const q = (ctx.query.get('q') ?? '').trim().toLowerCase();
    const owner = ctx.query.get('owner');
    const status = ctx.query.get('status');
    const group = ctx.query.get('groupId')?.toLowerCase();
    const items = v.data.forms
      .filter((f) => v.visible(f))
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .filter((f) => owner !== 'me' || f.ownerId === v.me)
      .filter(
        (f) => !status || (status === 'open' ? f.status === 'published' : f.status === status),
      )
      .filter((f) => !group || f.groupId === group)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((f) => formDto(v, f));
    return { body: page(items, ctx.query) };
  },

  createForm: {
    messages: { name: 'Укажите название формы — не короче 3 символов' },
    run: (ctx) => {
      const v = viewOf(ctx);
      const b = body<S['FormCreate']>(ctx);
      const sources = ['templateId', 'sourceFormId', 'definition'].filter((k) => has(b, k));
      if (sources.length > 1) invalid(sources[1] ?? 'body', 'Выберите шаблон или форму для копии');
      const orgUnitId = unitOr422(v, b.orgUnitId);
      const probe = { orgUnitId } as FormRow;
      if (!v.can(probe, 'forms.create')) fail('forbidden_action', NEED['forms.create']);
      const name = b.name.trim();
      if (name.length < 3) invalid('name', 'Укажите название формы — не короче 3 символов');
      if (nameTaken(v, name))
        invalid('name', `Форма «${name}» уже есть — измените название`, 'taken');
      let def: Def = { pages: [{ id: 'p1', title: 'Страница 1' }], fields: [] };
      let settings = settingsOf(undefined);
      let moduleKey: string | null = null;
      let templateId: string | null = null;
      let groupId = has(b, 'groupId') ? groupOr422(v, b.groupId) : null;
      if (b.templateId) {
        const T = FORM_TEMPLATES.find((x) => x.id === b.templateId);
        if (!T) invalid('templateId', 'Шаблон не найден');
        moduleKey = moduleKeyOf(T.module);
        if (moduleKey && v.org.modules[moduleKey]?.state !== 'active') {
          fail(
            'module_not_installed',
            `Модуль «${moduleLabel(moduleKey as Parameters<typeof moduleLabel>[0])}» не подключён: шаблон недоступен`,
          );
        }
        const d = templateDef(T);
        def = toDefV2(d, d.pages);
        settings = settingsOf(T.settings);
        templateId = T.id;
      } else if (b.sourceFormId) {
        const src = v.data.forms.find((x) => x.id === b.sourceFormId?.toLowerCase());
        if (!src || !v.visible(src)) invalid('sourceFormId', 'Форма не найдена');
        def = structuredClone(src.draft.definition);
        settings = structuredClone(src.settings);
        moduleKey = src.moduleKey;
        if (!has(b, 'groupId')) groupId = src.groupId;
      } else if (b.definition) {
        const errs = structureErrors(b.definition);
        if (errs.length) invalidAll(errs);
        def = structuredClone(b.definition);
      }
      const proto = v.newProto('fm-');
      const f: FormRow = {
        id: v.U(proto),
        proto,
        name,
        orgUnitId,
        moduleKey,
        templateId,
        groupId,
        ownerId: v.me,
        ownerName: v.meName,
        status: 'draft',
        versions: [],
        draft: {
          definition: def,
          revision: 1,
          hasChanges: false,
          savedAt: v.now,
          savedById: v.me,
          savedByName: v.meName,
        },
        settings,
        publicToken: null,
        revision: 1,
        createdAt: v.now,
        updatedAt: v.now,
      };
      v.data.forms.unshift(f);
      const T = templateId ? FORM_TEMPLATES.find((x) => x.id === templateId) : undefined;
      const from = T ? ` из шаблона «${T.name}»` : '';
      notifyOwners(ctx.s, v.org, {
        kind: 'forms.form.created',
        severity: 'info',
        title: `Создан черновик формы «${name}»${from}`,
      });
      return { status: 201, body: formDto(v, f) };
    },
  },

  getForm: (ctx) => {
    const v = viewOf(ctx);
    return { body: formDto(v, formOr404(v)) };
  },

  updateForm: {
    messages: {
      name: 'Название формы — не короче 3 символов',
      'settings.responseLimit': 'Лимит ответов — положительное число',
    },
    run: (ctx) => {
      const v = viewOf(ctx);
      const f = formOr404(v);
      need(v, f, 'forms.manage');
      ctx.revision(f.revision);
      const b = body<S['FormPatch']>(ctx);
      let notice: string | undefined;
      if (b.name !== undefined) {
        const name = b.name.trim();
        if (name.length < 3) invalid('name', 'Название формы — не короче 3 символов');
        if (nameTaken(v, name, f.id)) invalid('name', `Форма «${name}» уже есть`, 'taken');
        f.name = name;
      }
      if (b.status) {
        if (!current(f)) {
          fail('invalid_transition', 'Форма ещё не опубликована', { reason: 'form_not_published' });
        }
        const to = b.status === 'open' ? 'published' : 'closed';
        if (to !== f.status) {
          f.status = to;
          notice =
            (to === 'closed' ? 'Закрыт приём ответов: «' : 'Возобновлён приём ответов: «') +
            f.name +
            '»';
        }
      }
      if (has(b, 'orgUnitId')) {
        const unit = unitOr422(v, b.orgUnitId);
        if (!v.can({ ...f, orgUnitId: unit }, 'forms.manage'))
          fail('forbidden_action', NEED['forms.manage']);
        f.orgUnitId = unit;
      }
      if (has(b, 'groupId')) f.groupId = groupOr422(v, b.groupId);
      if (b.settings) {
        const next = { ...f.settings, ...b.settings };
        if (next.access === 'public' && f.settings.access !== 'public') {
          need(v, f, 'forms.publish_public');
          const crm = crmQuestion(f);
          if (crm) {
            invalid(
              'settings.access',
              `Публичный доступ невозможен: вопрос «${crm.label}» спрашивает данные CRM`,
            );
          }
        }
        f.settings = next;
      }
      if (f.settings.access === 'public' && current(f) && !f.publicToken)
        f.publicToken = token(v, f);
      touch(v, f);
      if (notice)
        notifyOwners(ctx.s, v.org, { kind: 'forms.form.updated', severity: 'info', title: notice });
      return { body: formDto(v, f) };
    },
  },

  listFormVersions: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    const items = [...f.versions].reverse().map((x) => versionDto(f, x));
    return { body: page(items, ctx.query) };
  },

  createFormVersion: (ctx) => {
    const v = viewOf(ctx);
    formOr404(v);
    return fail('invalid_transition', 'Версии создаёт публикация черновика', {
      reason: 'form_draft_flow',
    });
  },

  publishFormVersion: (ctx) => {
    const v = viewOf(ctx);
    formOr404(v);
    return fail('invalid_transition', 'Версии создаёт публикация черновика', {
      reason: 'form_draft_flow',
    });
  },

  getFormDraft: (ctx) => {
    const v = viewOf(ctx);
    return { body: draftDto(formOr404(v)) };
  },

  saveFormDraft: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    need(v, f, 'forms.manage');
    draftMatch(ctx, f.draft.revision);
    const def = body<S['FormDraftSave']>(ctx).definition;
    const errs = structureErrors(def);
    if (errs.length) invalidAll(errs);
    f.draft = {
      definition: structuredClone(def),
      revision: f.draft.revision + 1,
      hasChanges: Boolean(current(f)) && !sameDef(def, current(f)?.definition),
      savedAt: v.now,
      savedById: v.me,
      savedByName: v.meName,
    };
    f.updatedAt = v.now;
    return { body: draftDto(f) };
  },

  discardFormDraft: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    need(v, f, 'forms.manage');
    draftMatch(ctx, f.draft.revision);
    const cur = current(f);
    if (!cur) {
      fail('invalid_transition', 'У формы ещё нет опубликованной версии', {
        reason: 'form_not_published',
      });
    }
    f.draft = {
      definition: structuredClone(cur.definition),
      revision: f.draft.revision + 1,
      hasChanges: false,
      savedAt: v.now,
      savedById: v.me,
      savedByName: v.meName,
    };
    f.updatedAt = v.now;
    return { body: draftDto(f) };
  },

  publishForm: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    need(v, f, 'forms.publish');
    ctx.revision(f.revision);
    if (body<S['FormPublishRequest']>(ctx).draftRevision !== f.draft.revision) {
      fail('revision_mismatch', DRAFT_CONFLICT);
    }
    if (f.settings.access === 'public') need(v, f, 'forms.publish_public');
    const cur = current(f);
    if (cur && !f.draft.hasChanges) {
      fail('invalid_transition', 'Изменений для публикации нет', { reason: 'form_no_changes' });
    }
    const errs = publishViolations(f, f.draft.definition);
    if (errs.length)
      invalidAll(errs, `Найдено ошибок: ${errs.length}. Исправьте их в конструкторе.`);
    const n = (f.versions.at(-1)?.number ?? 0) + 1;
    const def = nextVersion(f.draft.definition, cur?.definition, n);
    f.versions.push({
      id: v.U(`${f.proto}:v${n}`),
      number: n,
      definition: def,
      createdAt: v.now,
      byId: v.me,
      byName: v.meName,
    });
    f.status = 'published';
    f.draft = {
      definition: structuredClone(def),
      revision: f.draft.revision + 1,
      hasChanges: false,
      savedAt: v.now,
      savedById: v.me,
      savedByName: v.meName,
    };
    if (f.settings.access === 'public' && !f.publicToken) f.publicToken = token(v, f);
    touch(v, f);
    notifyOwners(ctx.s, v.org, {
      kind: 'forms.version.published',
      severity: 'info',
      title: `Опубликована форма «${f.name}» v${n}. Старые ответы сохраняют свои версии`,
    });
    return { body: formDto(v, f) };
  },

  listFormRules: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    return {
      body: { items: v.data.rules.filter((x) => x.formId === f.id).map((x) => ruleDto(v, x)) },
    };
  },

  createFormRule: {
    messages: {
      'task.title': 'Укажите название задачи',
      'email.to': 'Укажите адрес почты',
      'http.url': 'Адрес запроса должен начинаться с https://',
    },
    run: (ctx) => {
      const v = viewOf(ctx);
      const f = formOr404(v);
      need(v, f, 'forms.manage');
      const b = body<S['FormRuleCreate']>(ctx);
      const condition = b.condition ?? { fieldKey: null, value: null };
      checkRule(v, f, { ...b, condition });
      const proto = v.newProto('au-');
      const rule: RuleRow = {
        id: v.U(proto),
        proto,
        formId: f.id,
        kind: b.kind,
        enabled: b.enabled ?? true,
        version: 1,
        trigger: b.trigger,
        condition: { ...condition },
        authorId: v.me,
        authorName: v.meName,
        revision: 1,
        createdAt: v.now,
        updatedAt: v.now,
      };
      const k = b.kind;
      if (b[k]) Object.assign(rule, { [k]: structuredClone(b[k]) });
      v.data.rules.push(rule);
      return { status: 201, body: ruleDto(v, rule) };
    },
  },

  updateFormRule: {
    messages: {
      'task.title': 'Укажите название задачи',
      'email.to': 'Укажите адрес почты',
      'http.url': 'Адрес запроса должен начинаться с https://',
    },
    run: (ctx) => {
      const v = viewOf(ctx);
      const f = formOr404(v);
      need(v, f, 'forms.manage');
      const rule = ruleOr404(v, f);
      ctx.revision(rule.revision);
      const b = body<S['FormRulePatch']>(ctx);
      const edits = Object.keys(b).filter((k) => k !== 'enabled');
      if (b.enabled !== undefined) rule.enabled = b.enabled;
      if (edits.length) {
        const next: RuleInput = {
          kind: rule.kind,
          trigger: b.trigger ?? rule.trigger,
          condition: b.condition ?? rule.condition,
          task: rule.task,
          notify: rule.notify,
          email: rule.email,
          http: rule.http,
          kb: rule.kb,
          ...Object.fromEntries(
            RULE_OBJECTS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]),
          ),
        };
        checkRule(v, f, next);
        rule.trigger = next.trigger;
        rule.condition = { ...(next.condition ?? { fieldKey: null, value: null }) };
        const k = rule.kind;
        if (b[k]) Object.assign(rule, { [k]: structuredClone(b[k]) });
        rule.version++;
        rule.authorId = v.me;
        rule.authorName = v.meName;
      }
      rule.revision++;
      rule.updatedAt = v.now;
      return { body: ruleDto(v, rule) };
    },
  },

  deleteFormRule: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    need(v, f, 'forms.manage');
    const rule = ruleOr404(v, f);
    ctx.revision(rule.revision);
    v.data.rules = v.data.rules.filter((x) => x.id !== rule.id);
    return { status: 204 };
  },

  backfillFormRule: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    need(v, f, 'forms.manage');
    const rule = ruleOr404(v, f);
    if (rule.kind !== 'kb') fail('not_found', 'Действие не найдено');
    if (!rule.enabled) {
      fail('invalid_transition', 'Действие выключено — включите его, чтобы перенести ответы', {
        reason: 'form_rule_disabled',
      });
    }
    const out: S['FormRuleBackfillResult'] = { added: 0, failed: 0, error: null };
    const todo = v.data.responses
      .filter(
        (r) =>
          r.formId === f.id &&
          fits(rule, r) &&
          !r.actions.some((a) => a.ruleId === rule.id && a.ok),
      )
      .sort((a, b) => Number(a.number.replace(/\D/g, '')) - Number(b.number.replace(/\D/g, '')));
    for (const r of todo) {
      const res = runRule(v, f, r, rule);
      if (res?.ok) out.added++;
      else {
        out.failed++;
        out.error = res?.error ?? null;
      }
    }
    return { body: out };
  },

  listFormResponses: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    return {
      body: page(
        visibleResponses(v, f).map((r) => responseDto(v, f, r)),
        ctx.query,
      ),
    };
  },

  submitFormResponse: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    const cur = current(f);
    if (!cur) fail('not_found', 'Форма не найдена');
    if (!accepting(v, f))
      fail('invalid_transition', 'Приём ответов закрыт', { reason: 'form_closed' });
    if (f.settings.onePerMember && answered(v, f)) {
      fail('invalid_transition', 'Вы уже отвечали на эту форму', {
        reason: 'form_already_answered',
      });
    }
    const b = body<S['FormResponseCreate']>(ctx);
    if (b.versionId.toLowerCase() !== cur.id) {
      fail('invalid_transition', 'Форма обновилась — откройте её заново', {
        reason: 'form_version_changed',
      });
    }
    const def = cur.definition;
    const given = new Map(b.answers.map((a) => [a.fieldKey, a.value]));
    const errs: Violation[] = [];
    for (const key of given.keys()) {
      const q = def.fields.find((x) => x.key === key);
      if (!q) errs.push({ field: key, code: 'unknown', message: 'Вопроса нет в форме' });
      // Значение скрытого вопроса — только из ссылки и defaultValue, не от отвечающего (возврат 2).
      else if (q.hidden) {
        errs.push({
          field: key,
          code: 'hidden',
          message: 'Скрытый вопрос заполняют ссылка и значение по умолчанию',
        });
      }
    }
    const link = b.linkParams ?? {};
    const linkKeys: string[] = [];
    for (const [key, val] of Object.entries(link)) {
      const q = def.fields.find((x) => x.key === key);
      if (!q?.hidden || CRM.includes(q.type) || q.type === 'photo') {
        errs.push({
          field: `linkParams.${key}`,
          code: 'not_hidden',
          message: 'Параметр ссылки — только для скрытого вопроса',
        });
        continue;
      }
      given.set(key, { type: 'text', value: val });
      linkKeys.push(key);
    }
    const vals = new Map<string, S['FieldValue']>();
    for (const q of def.fields) {
      if (q.type === 'statement') continue;
      if (q.hidden) {
        const x =
          given.get(q.key) ??
          (q.defaultValue ? { type: 'text' as const, value: q.defaultValue } : undefined);
        if (x) vals.set(q.key, x);
        continue;
      }
      if (!shown(q, vals)) continue;
      const x = given.get(q.key);
      const e = pvCheck(q, x);
      if (e) {
        errs.push({ field: q.key, code: 'invalid', message: e });
        continue;
      }
      if (!x || x.type === 'null') continue;
      if (x.type === 'reference') {
        const label = referenceLabel(v, q, x.value);
        if (label === null) {
          errs.push({
            field: q.key,
            code: 'not_found',
            message: q.type === 'person' ? 'Сотрудник не найден' : 'Объект не найден',
          });
          continue;
        }
        vals.set(q.key, { ...x, label });
      } else vals.set(q.key, x);
    }
    if (errs.length) invalidAll(errs);
    const subject = subjectOf(v, b.subject);
    const number = nextNumber(v);
    const r: ResponseRow = {
      id: v.U(number),
      proto: number,
      formId: f.id,
      number,
      versionNumber: cur.number,
      submittedAt: v.now,
      channel: 'member',
      authorId: v.me,
      authorName: v.meName,
      ...(subject ? { subject } : {}),
      answers: def.fields
        .filter((q) => vals.has(q.key))
        .map((q) => ({ fieldKey: q.key, value: vals.get(q.key) as S['FieldValue'] })),
      reviewStatus: 'accepted',
      revision: 1,
      actions: [],
      ...(linkKeys.length ? { linkParamKeys: linkKeys } : {}),
    };
    if (f.settings.scoring) r.score = scoreOf(def, vals, f.settings.passScore);
    v.data.responses.unshift(r);
    runRules(v, f, r);
    return { status: 201, body: responseDto(v, f, r) };
  },

  getFormResponse: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    const r = responseOr404(v, f);
    return { body: responseDto(v, f, r) };
  },

  reviewFormResponse: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    const r = responseOr404(v, f);
    ctx.revision(r.revision);
    const b = body<S['ResponseReviewPatch']>(ctx);
    // Право поля — в области формы, назначенному или по связи у формы «Вся организация» (Q-W4.05-16).
    if (has(b, 'assigneeMemberId') && !mayReview(v, f, r, 'forms.responses.assign')) {
      fail('forbidden_action', NEED['forms.responses.assign']);
    }
    if (
      (b.reviewStatus !== undefined || b.reviewComment !== undefined) &&
      !mayReview(v, f, r, 'forms.responses.review')
    ) {
      fail('forbidden_action', NEED['forms.responses.review']);
    }
    if (has(b, 'assigneeMemberId')) {
      const id = b.assigneeMemberId?.toLowerCase();
      if (id && !v.org.members.some((m) => m.id === id))
        invalid('assigneeMemberId', 'Сотрудник не найден');
      if (id) r.assigneeMemberId = id;
      else delete r.assigneeMemberId;
    }
    if (b.reviewComment !== undefined) r.reviewComment = b.reviewComment;
    const was = r.reviewStatus;
    if (b.reviewStatus) r.reviewStatus = b.reviewStatus;
    r.revision++;
    if (was !== 'accepted' && r.reviewStatus === 'accepted') runRules(v, f, r);
    return { body: responseDto(v, f, r) };
  },

  retryFormResponseAction: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    need(v, f, 'forms.manage');
    const r = responseOr404(v, f);
    const id = (ctx.params.ruleId ?? '').toLowerCase();
    const rule = v.data.rules.find((x) => x.id === id && x.formId === f.id);
    if (!rule) {
      if (r.actions.some((a) => a.ruleId === id)) {
        fail('invalid_transition', 'Действие удалено из формы — повторить нельзя', {
          reason: 'form_rule_deleted',
        });
      }
      fail('not_found', 'Действие не найдено');
    }
    if (rule.kind === 'email' || rule.kind === 'http') fail('not_found', 'Действие не найдено');
    const res = runRule(v, f, r, rule);
    if (!res?.ok) invalid('ruleId', `Не выполнено: ${res?.error ?? ''}`);
    const dto = responseDto(v, f, r).actions.find((a) => a.ruleId === rule.id);
    return { body: dto };
  },

  getFormResponseSummary: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    return { body: summaryOf(f, visibleResponses(v, f)) };
  },

  exportFormResponses: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    const rs = visibleResponses(v, f);
    if (!rs.length) fail('invalid_transition', 'Ответов пока нет', { reason: 'form_no_responses' });
    return {
      body: {
        formId: f.id,
        fileName: `${f.name}.csv`,
        contentType: 'text/csv; charset=utf-8',
        content: csvOf(f, rs),
        rowCount: rs.length,
        generatedAt: v.now,
      },
    };
  },

  listFormFieldOptions: (ctx) => {
    const v = viewOf(ctx);
    const f = formOr404(v);
    const q = current(f)?.definition.fields.find((x) => x.key === ctx.params.fieldKey);
    if (!q || !CRM.includes(q.type)) fail('not_found', 'Вопрос не найден');
    const all = optionsFor(v, q, ctx.query.get('q') ?? '');
    return { body: { items: all.slice(0, 50), truncated: all.length > 50 } };
  },

  listFormTemplates: (ctx) => {
    const v = viewOf(ctx);
    const items = FORM_TEMPLATES.map((T) => {
      const moduleKey = moduleKeyOf(T.module);
      return {
        id: T.id,
        category: T.cat,
        name: T.name,
        icon: T.icon,
        moduleKey,
        available: !moduleKey || v.org.modules[moduleKey]?.state === 'active',
        pageCount: T.pages.length,
        questionCount: T.pages.flatMap((p) => p.fields).filter((x) => x.type !== 'statement')
          .length,
      };
    });
    return { body: { items } };
  },

  listFormGroups: (ctx) => {
    const v = viewOf(ctx);
    const items = [...v.data.groups]
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((g) => ({
        id: g.id,
        name: g.name,
        formCount: v.data.forms.filter((f) => f.groupId === g.id && v.visible(f)).length,
      }));
    return { body: { items } };
  },

  createFormGroup: {
    messages: { name: 'Название группы — от 2 символов' },
    run: (ctx) => {
      const v = viewOf(ctx);
      const name = body<S['FormGroupCreate']>(ctx).name.trim();
      if (name.length < 2) invalid('name', 'Название группы — от 2 символов');
      if (v.data.groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
        invalid('name', 'Такая группа уже есть', 'taken');
      }
      const proto = v.newProto('fg-');
      const g = { id: v.U(proto), proto, name };
      v.data.groups.push(g);
      return { status: 201, body: { id: g.id, name, formCount: 0 } };
    },
  },

  deleteFormGroup: (ctx) => {
    const v = viewOf(ctx);
    const id = (ctx.params.groupId ?? '').toLowerCase();
    const g = v.data.groups.find((x) => x.id === id);
    if (!g) fail('not_found', 'Группа не найдена');
    if (v.data.forms.some((f) => f.groupId === g.id)) {
      fail('invalid_transition', 'В группе есть формы — сначала переместите их', {
        reason: 'form_group_not_empty',
      });
    }
    v.data.groups = v.data.groups.filter((x) => x.id !== g.id);
    return { status: 204 };
  },
};
