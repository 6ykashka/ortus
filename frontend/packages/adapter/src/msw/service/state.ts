// «Обращения» сценарного сервера (W7.00, контрактный PR этапа 7): контекст запроса поверх домена W7.30 и проекция
// в схемы контракта (`Service*`, `PublicService*`). Домен — срез `service` БД организации (`msw/stage7/seed.ts`);
// проверки права в направлении (PD-53), скрытие жалобы на самого сотрудника, маска телефона, сроки и очереди —
// в командах и проекции домена. Здесь — перевод: id прототипа ↔ UUID, миллисекунды Unix → моменты UTC, исполнитель
// по имени → участник, ошибки домена → Problem контракта.
import type { components } from '@ortus/api-client';
import { ApiError } from '@ortus/domain';
import {
  type Direction,
  type DirectionView,
  type Rating,
  type RequestType,
  type RequestView,
  type ServiceApi,
  type ServiceRequest,
  type ServiceSlice,
  type ServiceTenantDb,
  serviceCommands,
  serviceView,
  slaHead,
  slaOf,
  SVC_FLOW,
  type SlaItem,
  type SlaHeadInfo,
} from '@ortus/domain/modules';

import type { TenantAccess } from '../core/access.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { Org } from '../core/state.ts';
import { msInstant, type S7Ctx, s7Ctx } from '../stage7/seed.ts';

type S = components['schemas'];

export interface ServiceCtx extends S7Ctx {
  sdb: ServiceTenantDb;
  /** Срез обращений организации; у организаций без направлений — null. */
  svc: ServiceSlice | null;
  cmds: ServiceApi;
  /** «Сейчас» домена, миллисекунды. */
  nowMs: number;
  view(): ReturnType<typeof serviceView>;
  run<T>(f: () => T): T;
}

/** Ошибка домена → Problem контракта (тексты эталона — в `detail`). */
export function serviceFail(e: unknown): never {
  if (!(e instanceof ApiError)) throw e;
  const m = e.message;
  if (/^Обращение закрыто/.test(m)) return fail('invalid_transition', m);
  if (/не видит направление .* назначить нельзя/.test(m))
    return fail('service_assignee_out_of_scope', m);
  switch (e.code) {
    case 'not_found':
      return fail('not_found', m);
    case 'forbidden':
      return fail('forbidden_action', m);
    case 'transition':
      return fail('invalid_transition', m);
    case 'conflict':
      return fail('revision_mismatch', m);
    default:
      return fail('validation_failed', m, {
        violations: [{ field: fieldOf(m), code: 'invalid', message: m }],
      });
  }
}

/** Поле тела по тексту ошибки эталона (violations). */
function fieldOf(m: string): string {
  if (/итог/.test(m)) return 'outcome';
  if (/направлен/.test(m)) return 'directionId';
  if (/тип обращения/.test(m)) return 'typeId';
  if (/имя клиента/.test(m)) return 'clientName';
  if (/Телефон/.test(m)) return 'phone';
  if (/Опишите|текст|Напишите|вывод/i.test(m)) return 'text';
  if (/Тема задачи/.test(m)) return 'title';
  if (/приоритет/i.test(m)) return 'priority';
  return 'body';
}

export function serviceCtx(ctx: HandlerContext, tenant?: TenantAccess): ServiceCtx {
  const base = s7Ctx(ctx, undefined, tenant);
  const sdb = base.db as ServiceTenantDb;
  let idx: Map<string, string> | undefined;
  const index = (): Map<string, string> => {
    if (!idx) {
      idx = new Map();
      const add = (id: string | undefined): void => {
        if (id) idx?.set(base.U(id), id);
      };
      for (const m of base.db.members) add(m.id);
      for (const u of base.db.units) add(u.id);
      for (const p of base.db.projects ?? []) add(p.id);
      const S = sdb.service;
      for (const d of S?.directions ?? []) {
        add(d.id);
        add(d.project);
      }
      for (const t of S?.types ?? []) add(t.id);
      for (const r of S?.requests ?? []) {
        add(r.id);
        r.messages.forEach((m) => add(m.id));
        r.tasks.forEach((t) => add(t.id));
      }
      for (const x of S?.ratings ?? []) add(x.id);
    }
    return idx;
  };
  const nowMs = base.clock.now().getTime();
  return {
    ...base,
    sdb,
    svc: sdb.service ?? null,
    cmds: serviceCommands(base.mctx),
    nowMs,
    P: (uuid) => (uuid ? index().get(uuid.toLowerCase()) : undefined),
    view: () => serviceView(sdb as never, base.me),
    run: (f) => {
      try {
        const out = f();
        idx = undefined;
        return out;
      } catch (e) {
        return serviceFail(e);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Проекция

export const memberByName = (
  x: ServiceCtx,
  name: string | null | undefined,
): S['ServiceMemberRef'] | null => {
  if (!name) return null;
  const m = x.sdb.members.find((y) => y.name === name);
  return m ? { memberId: x.U(m.id), displayName: m.name } : null;
};

const ref = (x: ServiceCtx, id: string): S['ServiceMemberRef'] => ({
  memberId: x.U(id),
  displayName: x.sdb.members.find((m) => m.id === id)?.name ?? id,
});

const hhmm = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const MODULE_KEY: Readonly<Record<string, string>> = {
  'Салон и SPA': 'spa',
  'Ремонт и стройка': 'repairs',
  Логистика: 'fleet',
};

export function directionDto(x: ServiceCtx, d: DirectionView | Direction): S['ServiceDirection'] {
  const v = d as DirectionView;
  return {
    id: x.U(d.id),
    key: d.key,
    name: d.name,
    color: d.color,
    moduleKey: MODULE_KEY[d.module] ?? d.module,
    areaLabel: d.area,
    orgUnitId: null,
    projectId: x.U(d.project),
    calendar: {
      days: d.cal.days.map((n) => n + 1),
      from: hhmm(d.cal.from),
      to: hhmm(d.cal.to),
      timeZone: 'Europe/Moscow',
      label: d.cal.label,
    },
    lead: d.lead ? ref(x, d.lead) : null,
    next: d.next,
    team: (v.team ?? [])
      .map((n) => memberByName(x, n))
      .filter((m): m is S['ServiceMemberRef'] => !!m),
    canContacts: !!v.canContacts,
    version: 1,
  };
}

const PRIORITY = (t: RequestType): S['ServiceRequestType']['priority'] =>
  t.kind === 'complaint' || t.kind === 'claim' ? 'high' : 'normal';

export function typeDto(x: ServiceCtx, t: RequestType): S['ServiceRequestType'] {
  return {
    id: t.id,
    directionId: x.U(t.dir),
    kind: t.kind,
    name: t.name,
    firstMinutes: t.first,
    resolveMinutes: t.resolve,
    legalDays: t.legal,
    priority: PRIORITY(t),
  };
}

const round = (n: number | undefined): number => Math.max(0, Math.round(n ?? 0));

function slaDto(r: ServiceRequestLike, items: SlaItem[]): S['ServiceSla'] {
  const out: S['ServiceSla'] = {};
  for (const key of ['first', 'resolve', 'legal'] as const) {
    const t = r.sla[key];
    const it = items.find((i) => i.key === key);
    if (!t || !it) continue;
    const dto: S['ServiceSlaTarget'] = {
      goalMinutes: 'goal' in t ? t.goal : null,
      dueAt: msInstant(t.due),
      stoppedAt: t.stopped ? msInstant(t.stopped) : null,
      state: it.state,
      label: it.label,
      text: it.text,
      until: it.until,
    };
    if (it.over !== undefined) dto.overMinutes = round(it.over);
    if (it.left !== undefined) dto.leftMinutes = round(it.left);
    out[key] = dto;
  }
  return out;
}

type ServiceRequestLike = Pick<ServiceRequest, 'status' | 'at' | 'sla' | 'outcome' | 'resolvedAt'>;

const headDto = (h: SlaHeadInfo): S['ServiceSlaHead'] => {
  const out: S['ServiceSlaHead'] = {
    state: h.state,
    label: h.label,
    text: h.text,
    until: h.until,
    rank: h.rank,
  };
  if (h.key) out.key = h.key;
  return out;
};

export function clientDto(r: RequestView): S['ServiceClient'] {
  const out: S['ServiceClient'] = {
    name: r.client.name,
    phoneMasked: r.client.phoneMasked,
    since: r.client.since,
  };
  if (r.client.org) out.company = r.client.org;
  if (r.client.phone) out.phone = r.client.phone;
  return out;
}

export function summaryDto(x: ServiceCtx, r: RequestView): S['ServiceRequestSummary'] {
  const d = x.svc?.directions.find((y) => y.id === r.dir) as Direction;
  const items = slaOf(r, d, x.nowMs);
  const out: S['ServiceRequestSummary'] = {
    id: x.U(r.id),
    key: r.key,
    directionId: x.U(r.dir),
    kind: r.kind,
    title: r.title,
    status: r.status,
    priority: r.priority,
    assignee: memberByName(x, r.assignee),
    createdAt: msInstant(r.at),
    channel: r.channel,
    client: clientDto(r),
    link: r.link ? { label: r.link.label, lines: r.link.lines } : null,
    sla: slaDto(r, items),
    head: headDto(slaHead(r, d, x.nowMs)),
    labels: r.labels,
    taskCount: r.tasks.length,
  };
  if (r.oldKeys?.length) out.oldKeys = r.oldKeys;
  if (r.fromRating) out.fromRating = r.fromRating;
  if (r.outcome) out.outcome = r.outcome;
  if (r.resolvedAt) out.resolvedAt = msInstant(r.resolvedAt);
  return out;
}

const DELIVERY: Readonly<Record<string, S['ServiceMessage']['delivery']>> = { public: 'queued' };

export function messageDto(
  x: ServiceCtx,
  r: RequestView,
  m: RequestView['messages'][number],
): S['ServiceMessage'] {
  const out: S['ServiceMessage'] = {
    id: x.U(m.id),
    kind: m.kind,
    at: msInstant(m.at),
    text: m.text,
    files: (m.files ?? []).map((name, i) => ({
      id: x.U(`${m.id}.f${i}`),
      fileName: name,
      sizeBytes: 0,
      status: 'ready' as const,
    })),
  };
  if (m.by && m.kind !== 'client' && m.kind !== 'rating') {
    const a = memberByName(x, m.by);
    if (a) out.author = a;
  }
  if (m.channel) out.channel = m.channel;
  if (m.auto) out.auto = true;
  const delivery = DELIVERY[m.kind];
  if (delivery) out.delivery = delivery;
  if (m.score) out.score = m.score;
  if (m.reasons) out.reasons = m.reasons;
  if (m.contact !== undefined) out.contact = m.contact;
  void r;
  return out;
}

export function requestDto(x: ServiceCtx, r: RequestView): S['ServiceRequest'] {
  const d = x.svc?.directions.find((y) => y.id === r.dir) as Direction;
  const raw = x.svc?.requests.find((y) => y.id === r.id);
  const base = summaryDto(x, r);
  const flow = (SVC_FLOW[r.status] ?? []) as S['ServiceRequest']['allowedStatuses'];
  const out: S['ServiceRequest'] = {
    ...base,
    messages: r.messages.map((m) => messageDto(x, r, m)),
    tasks: r.tasks.map((t) => ({ id: x.U(t.id), key: t.id, title: t.title, status: t.status })),
    allowedStatuses: flow,
    revision: x.s.reqRev[r.id] ?? 1,
  };
  if (r.compensation) out.compensation = r.compensation;
  if (r.shared) {
    const by = memberByName(x, r.shared.by);
    out.shared = {
      text: r.shared.text,
      at: msInstant(r.shared.at),
      by: by ?? { memberId: x.U(d.lead), displayName: r.shared.by },
    };
  }
  // Кого касается жалоба — только руководителю направления и владельцу (service.md §5.1 п. 6).
  if (raw?.about && (d.lead === x.me || x.t.owner)) {
    out.aboutMember = ref(x, raw.about);
  }
  return out;
}

/** Обращение для участника по UUID пути: чужое направление и жалоба на себя — 404. */
export function requestOr404(x: ServiceCtx, id: string | undefined): RequestView {
  const v = x.view();
  const proto = x.P(id);
  const r = v?.requests.find((y) => y.id === proto);
  if (!r) return fail('not_found', 'Обращение не найдено');
  return r;
}

export function ratingDto(x: ServiceCtx, r: Rating): S['ServiceRating'] {
  const req = r.request ? x.svc?.requests.find((y) => y.key === r.request) : undefined;
  return {
    id: x.U(r.id),
    directionId: x.U(r.dir),
    clientName: r.client,
    score: r.score,
    reasons: r.reasons,
    comment: r.comment,
    at: msInstant(r.at),
    work: r.work,
    status: r.status,
    requestId: req ? x.U(req.id) : null,
  };
}

/** Организация со срезом обращений (публичный контур не знает организации по пути — берёт «Альту»). */
export const portalOrg = (ctx: HandlerContext): Org | undefined =>
  Object.values(ctx.s.orgs).find((o) => o.proto === 't-alta');
