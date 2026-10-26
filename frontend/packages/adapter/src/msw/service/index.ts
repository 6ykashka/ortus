// Тег Service и публичный контур PublicService сценарного сервера (W7.00, контрактный PR этапа 7): 21 операция
// сотрудника и 9 операций клиента по личной ссылке поверх домена W7.30 — направления, очередь и счётчики, карточка,
// ответ и заметка, компенсация, переходы, исполнитель, перенос, телефон, вывод сотруднику, задача, низкие оценки,
// настройка направления и отчёт; портал клиента (эталон «Обращения.dc.html» и «Обращения - варианты.dc.html» 1a,
// design-2026-10-19). Жалоба на сотрудника скрыта от него самого и неотличима от отсутствующей: 404.
import type { components } from '@ortus/api-client';
import {
  type Direction,
  directionCounts,
  fillTemplate,
  type QueueKey,
  QUEUES,
  queueCounts,
  requestQueue,
  type ServiceRequest,
  slaFor,
  slaHead,
  COMPENSATIONS,
} from '@ortus/domain/modules';
import { seedUuid } from '@ortus/domain/seed';

import type { TenantAccess } from '../core/access.ts';
import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { msInstant, registerStage7Keys } from '../stage7/seed.ts';
import {
  directionDto,
  memberByName,
  messageDto,
  portalOrg,
  ratingDto,
  requestDto,
  requestOr404,
  type ServiceCtx,
  serviceCtx,
  summaryDto,
  typeDto,
} from './state.ts';

registerStage7Keys();

type S = components['schemas'];

const body = <T>(ctx: HandlerContext): T => ctx.body as T;

function invalid(field: string, message: string, code = 'invalid'): never {
  return fail('validation_failed', message, { violations: [{ field, code, message }] });
}

const bump = (x: ServiceCtx, id: string): number => {
  x.s.reqRev[id] = (x.s.reqRev[id] ?? 1) + 1;
  return x.s.reqRev[id] as number;
};

/** Обращение после команды — свежая проекция участнику. */
function out(
  x: ServiceCtx,
  protoId: string,
  status = 200,
): { status: number; body: S['ServiceRequest']; etag: number } {
  const v = x.view();
  const r = v?.requests.find((y) => y.id === protoId);
  if (!r) return fail('not_found', 'Обращение не найдено');
  const dto = requestDto(x, r);
  return { status, body: dto, etag: dto.revision };
}

const requireService = (x: ServiceCtx): NonNullable<ServiceCtx['svc']> => {
  if (!x.svc) return fail('not_found', 'В организации нет направлений обращений');
  return x.svc;
};

const QUEUE_KEYS = QUEUES.map((q) => q.key);

function counts(x: ServiceCtx, dir: string): S['ServiceQueueCounts'] {
  const v = x.view();
  const me = x.sdb.members.find((m) => m.id === x.me)?.name ?? '';
  if (!v) return { items: [] };
  const c = queueCounts(
    { directions: v.directions, requests: v.requests, ratings: v.ratings },
    { dir, me, now: x.nowMs },
  );
  return {
    items: QUEUES.map((q) => {
      const it: S['ServiceQueueCount'] = {
        key: q.key as QueueKey,
        label: q.label,
        count: c[q.key],
      };
      if (q.tone && c[q.key] > 0) it.tone = q.tone;
      return it;
    }),
    noReplyCount: c.noreply,
  };
}

// ---------------------------------------------------------------------------------------------
// Портал клиента: организация — «Альта» (слаг направления и токен обращения не содержат организации)

export const portalToken = (id: string): string =>
  `tok_${seedUuid('t-alta', id).replaceAll('-', '')}z`;

function portalCtx(ctx: HandlerContext): ServiceCtx {
  const org = portalOrg(ctx);
  if (!org) return fail('not_found', 'Страница не найдена');
  const tenant = ctx.s.tenants.find((t) => t.id === org.tenantId);
  const t = {
    org,
    tenant,
    membership: undefined,
    member: undefined,
    owner: false,
    readOnly: false,
  } as unknown as TenantAccess;
  return serviceCtx(ctx, t);
}

const slugOf = (d: Direction): string => d.id.replace(/^d-/, '');

function directionBySlug(x: ServiceCtx, slug: string | undefined): Direction {
  const d = x.svc?.directions.find((y) => slugOf(y) === slug);
  if (!d) return fail('not_found', 'Страница не найдена');
  return d;
}

function byToken(x: ServiceCtx, token: string | undefined): ServiceRequest {
  const r = x.svc?.requests.find((y) => portalToken(y.id) === token);
  if (!r) return fail('not_found', 'Обращение не найдено');
  return r;
}

const STATUS_LABEL: Readonly<Record<ServiceRequest['status'], string>> = {
  new: 'Получили',
  work: 'Отвечаем',
  wait: 'Ждём вашего ответа',
  resolved: 'Решено',
  closed: 'Закрыто',
};

const REOPEN_WINDOW_MS = 5 * 24 * 3_600_000;

function publicDto(x: ServiceCtx, r: ServiceRequest): S['PublicServiceRequest'] {
  const d = x.svc?.directions.find((y) => y.id === r.dir) as Direction;
  const csat = x.s.csat[r.id];
  const resolved = r.status === 'resolved';
  const until = resolved && r.resolvedAt ? r.resolvedAt + REOPEN_WINDOW_MS : null;
  const head = slaHead(r, d, x.nowMs);
  const out: S['PublicServiceRequest'] = {
    key: r.key,
    title: r.title,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status],
    dueText:
      r.status === 'new' || r.status === 'work'
        ? head.until
          ? `Ответим ${head.until}`
          : null
        : null,
    messages: r.messages
      .filter((m) => m.kind === 'client' || m.kind === 'public')
      .map((m) => ({
        id: x.U(m.id),
        at: msInstant(m.at),
        text: m.text,
        fromClient: m.kind === 'client',
        files: [],
      })),
    canRate: resolved && !csat,
    canReopen: resolved && !!until && x.nowMs <= until,
    reopenUntil: until ? msInstant(until) : null,
    rating: csat?.score ?? null,
  };
  return out;
}

export const serviceHandlers: Registry = {
  listServiceDirections: (ctx) => {
    const x = serviceCtx(ctx);
    const v = x.view();
    if (!x.svc || !v) return { body: { items: [], types: [], notConfigured: true } };
    if (v.hidden) return fail('forbidden_action', 'Нет права «Видеть» в обращениях');
    return {
      body: {
        items: v.directions.map((d) => directionDto(x, d)),
        types: v.types.map((t) => typeDto(x, t)),
      },
    };
  },

  listServiceRequests: (ctx) => {
    const x = serviceCtx(ctx);
    const v = requireView(x);
    const dirParam = ctx.query.get('directionId');
    let dir = 'all';
    if (dirParam) {
      const d = x.P(dirParam);
      if (!d || !v.directions.some((y) => y.id === d))
        return fail('not_found', 'Направление не найдено');
      dir = d;
    }
    const queue = ctx.query.get('queue') ?? 'open';
    const me = x.sdb.members.find((m) => m.id === x.me)?.name ?? '';
    const res = requestQueue(
      { directions: v.directions, requests: v.requests, ratings: v.ratings },
      {
        queue: QUEUE_KEYS.includes(queue as QueueKey) ? queue : 'open',
        dir,
        ...(ctx.query.get('kind') ? { type: ctx.query.get('kind') as string } : {}),
        ...(ctx.query.get('channel') ? { channel: ctx.query.get('channel') as string } : {}),
        ...(ctx.query.get('q') ? { q: ctx.query.get('q') as string } : {}),
        me,
        now: x.nowMs,
      },
    );
    const items = res.rows.map((row) => summaryDto(x, row.request));
    return { body: { ...page(items, ctx.query), counts: counts(x, dir) } };
  },

  getServiceQueueCounts: (ctx) => {
    const x = serviceCtx(ctx);
    const v = requireView(x);
    const dirParam = ctx.query.get('directionId');
    let dir = 'all';
    if (dirParam) {
      const d = x.P(dirParam);
      if (!d || !v.directions.some((y) => y.id === d))
        return fail('not_found', 'Направление не найдено');
      dir = d;
    }
    return { body: counts(x, dir) };
  },

  getServiceRequest: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const r = requestOr404(x, ctx.params.requestId);
    const dto = requestDto(x, r);
    return { body: dto, etag: dto.revision };
  },

  createServiceRequest: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const b = body<S['ServiceRequestCreate']>(ctx);
    const dir = x.P(b.directionId);
    const ty = x.svc?.types.find((t) => t.id === b.typeId);
    if (!dir) return invalid('directionId', 'Выберите направление');
    const id = x.run(() =>
      x.cmds.svcCreate({
        dir,
        kind: ty?.kind ?? '',
        name: b.clientName,
        phone: b.phone,
        ...(b.company ? { org: b.company } : {}),
        ...(b.link?.label ? { link: b.link.label } : {}),
        text: b.text,
      }),
    );
    return out(x, id, 201);
  },

  postServiceMessage: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const r = requestOr404(x, ctx.params.requestId);
    const b = body<S['ServiceMessageCreate']>(ctx);
    x.run(() =>
      x.cmds.svcReply(r.id, { kind: b.kind === 'note' ? 'note' : 'reply', text: b.text }),
    );
    const v = x.view();
    const next = v?.requests.find((y) => y.id === r.id) as NonNullable<typeof r>;
    const last =
      next.messages.filter((m) => m.kind === b.kind).at(-1) ??
      (next.messages.at(-1) as (typeof next.messages)[number]);
    bump(x, r.id);
    return { status: 201, body: messageDto(x, next, last) };
  },

  setServiceCompensation: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const r = requestOr404(x, ctx.params.requestId);
    ctx.revision(x.s.reqRev[r.id] ?? 1);
    const b = body<S['ServiceCompensationSet']>(ctx);
    const map: Record<string, number> = {
      discount20: 0,
      discount10: 1,
      repeat_visit: 2,
      refund: 3,
    };
    const label = COMPENSATIONS[map[b.kind] ?? 0] as string;
    x.run(() =>
      x.cmds.svcReply(r.id, { kind: 'note', text: b.text?.trim() || label, compensation: label }),
    );
    bump(x, r.id);
    return out(x, r.id);
  },

  transitionServiceRequest: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const r = requestOr404(x, ctx.params.requestId);
    ctx.revision(x.s.reqRev[r.id] ?? 1);
    const b = body<S['ServiceTransition']>(ctx);
    x.run(() => x.cmds.svcTransition(r.id, b.to, b.outcome ? { outcome: b.outcome } : {}));
    bump(x, r.id);
    return out(x, r.id);
  },

  updateServiceRequest: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const r = requestOr404(x, ctx.params.requestId);
    ctx.revision(x.s.reqRev[r.id] ?? 1);
    const b = body<S['ServiceRequestPatch']>(ctx);
    if (b.assigneeId !== undefined) {
      const name = b.assigneeId
        ? x.sdb.members.find((m) => m.id === x.P(b.assigneeId as string))?.name
        : null;
      if (b.assigneeId && !name) return invalid('assigneeId', 'Сотрудник не найден');
      x.run(() => x.cmds.svcAssign(r.id, name ?? null));
    }
    if (b.priority) x.run(() => x.cmds.svcPriority(r.id, b.priority as string));
    bump(x, r.id);
    return out(x, r.id);
  },

  moveServiceRequest: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const r = requestOr404(x, ctx.params.requestId);
    ctx.revision(x.s.reqRev[r.id] ?? 1);
    const dir = x.P(body<S['ServiceMove']>(ctx).directionId);
    x.run(() => x.cmds.svcMove(r.id, dir ?? ''));
    bump(x, r.id);
    return out(x, r.id);
  },

  revealServiceClientPhone: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const r = requestOr404(x, ctx.params.requestId);
    x.run(() => x.cmds.svcShowPhone(r.id));
    const raw = x.svc?.requests.find((y) => y.id === r.id) as ServiceRequest;
    return { status: 200, body: { phone: raw.client.phone ?? '', shownAt: msInstant(x.nowMs) } };
  },

  shareServiceConclusion: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const r = requestOr404(x, ctx.params.requestId);
    ctx.revision(x.s.reqRev[r.id] ?? 1);
    x.run(() => x.cmds.svcShare(r.id, body<S['ServiceConclusion']>(ctx).text));
    bump(x, r.id);
    return out(x, r.id);
  },

  createServiceRequestTask: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const r = requestOr404(x, ctx.params.requestId);
    const title = body<S['ServiceTaskCreate']>(ctx).title;
    const tid = x.run(() => x.cmds.svcAddTask(r.id, title));
    bump(x, r.id);
    return { status: 201, body: { id: x.U(tid), key: tid, title: title.trim(), status: 'Новая' } };
  },

  listServiceRatings: (ctx) => {
    const x = serviceCtx(ctx);
    const v = requireView(x);
    const status = ctx.query.get('status') ?? 'open';
    const items = v.ratings.filter((r) => r.status === status).map((r) => ratingDto(x, r));
    return { body: page(items, ctx.query) };
  },

  decideServiceRating: (ctx) => {
    const x = serviceCtx(ctx);
    requireView(x);
    const proto = x.P(ctx.params.ratingId);
    const b = body<S['ServiceRatingDecision']>(ctx);
    const rid = x.run(() => x.cmds.svcRating(proto ?? '', b.action));
    const v = x.view();
    const rating = v?.ratings.find((r) => r.id === proto);
    if (!rating) return fail('not_found', 'Оценка не найдена');
    const res: S['ServiceRatingDecisionResult'] = { rating: ratingDto(x, rating) };
    const req = rid ? v?.requests.find((r) => r.id === rid) : undefined;
    if (req) res.request = summaryDto(x, req);
    return { status: 200, body: res };
  },

  listServiceReplyTemplates: (ctx) => {
    const x = serviceCtx(ctx);
    const v = requireView(x);
    const d = v.directions.find((y) => y.id === x.P(ctx.params.directionId));
    if (!d) return fail('not_found', 'Направление не найдено');
    const items = v.templates.map(([name, text], i) => ({ id: `${d.id}:t${i + 1}`, name, text }));
    return { body: { items } };
  },

  createServiceDirection: (ctx) => {
    const x = serviceCtx(ctx);
    const svc = requireService(x);
    const b = body<S['ServiceDirectionCreate']>(ctx);
    if (svc.directions.some((d) => d.key.toLowerCase() === b.key.toLowerCase())) {
      return invalid('key', 'Такой ключ уже занят', 'taken');
    }
    const id = `d-w${++x.s.seq}`;
    const d: Direction = {
      id,
      key: b.key.toUpperCase(),
      name: b.name,
      color: b.color ?? '#2B5479',
      module: 'Салон и SPA',
      area: 'Вся организация',
      project: `svc-w${x.s.seq}`,
      cal: { days: [0, 1, 2, 3, 4], from: 540, to: 1140, label: 'пн–пт 9:00–19:00' },
      lead: x.me,
      next: 1,
    };
    svc.directions.push(d);
    return {
      status: 201,
      body: {
        direction: directionDto(x, { ...d, team: [], canContacts: true } as never),
        types: [],
      },
    };
  },

  getServiceDirection: (ctx) => {
    const x = serviceCtx(ctx);
    const svc = requireService(x);
    const d = svc.directions.find((y) => y.id === x.P(ctx.params.directionId));
    if (!d) return fail('not_found', 'Направление не найдено');
    const draft = x.s.drafts[d.id];
    const res: S['ServiceDirectionConfig'] = {
      direction: directionDto(x, { ...d, team: [], canContacts: true } as never),
      types: svc.types.filter((t) => t.dir === d.id).map((t) => typeDto(x, t)),
    };
    if (draft) {
      res.draft = {
        directionId: x.U(d.id),
        body: draft.body as S['ServiceDirectionBody'],
        revision: draft.revision,
        updatedAt: draft.updatedAt,
      };
    }
    return { body: res };
  },

  updateServiceDirectionDraft: (ctx) => {
    const x = serviceCtx(ctx);
    const svc = requireService(x);
    const d = svc.directions.find((y) => y.id === x.P(ctx.params.directionId));
    if (!d) return fail('not_found', 'Направление не найдено');
    const cur = x.s.drafts[d.id];
    ctx.revision(cur?.revision ?? 1);
    const next = {
      body: body<S['ServiceDirectionDraftSave']>(ctx).body,
      revision: (cur?.revision ?? 1) + 1,
      updatedAt: ctx.now(),
    };
    x.s.drafts[d.id] = next;
    return {
      status: 200,
      body: {
        directionId: x.U(d.id),
        body: next.body as S['ServiceDirectionBody'],
        revision: next.revision,
        updatedAt: next.updatedAt,
      },
      etag: next.revision,
    };
  },

  publishServiceDirection: (ctx) => {
    const x = serviceCtx(ctx);
    const svc = requireService(x);
    const d = svc.directions.find((y) => y.id === x.P(ctx.params.directionId));
    if (!d) return fail('not_found', 'Направление не найдено');
    const draft = x.s.drafts[d.id];
    if (!draft) return fail('invalid_transition', 'Нет черновика для публикации');
    const b = draft.body as S['ServiceDirectionBody'];
    d.name = b.name;
    d.color = b.color;
    svc.types = svc.types.filter((t) => t.dir !== d.id);
    for (const t of b.types) {
      svc.types.push({
        id: t.id,
        dir: d.id,
        kind: t.kind,
        name: t.name,
        first: t.firstMinutes ?? null,
        resolve: t.resolveMinutes ?? null,
        legal: t.legalDays ?? null,
      });
    }
    x.s.drafts = Object.fromEntries(Object.entries(x.s.drafts).filter(([k]) => k !== d.id));
    return {
      status: 200,
      body: {
        direction: directionDto(x, { ...d, team: [], canContacts: true } as never),
        types: svc.types.filter((t) => t.dir === d.id).map((t) => typeDto(x, t)),
      },
    };
  },

  getServiceReport: (ctx) => {
    const x = serviceCtx(ctx);
    const v = requireView(x);
    const dirParam = ctx.query.get('directionId');
    const only = dirParam ? x.P(dirParam) : undefined;
    const reqs = v.requests.filter((r) => !only || r.dir === only);
    const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
    const from = ctx.query.get('from') ?? '2026-09-01';
    const to = ctx.query.get('to') ?? day(x.nowMs);
    const rows = v.directions
      .filter((d) => !only || d.id === only)
      .map((d) => {
        const mine = reqs.filter((r) => r.dir === d.id);
        const rated = v.ratings.filter((r) => r.dir === d.id);
        const row: S['ServiceReportRow'] = {
          directionId: x.U(d.id),
          requests: mine.length,
          resolvedInTime: mine.filter((r) => r.status === 'resolved' || r.status === 'closed')
            .length,
          late: mine.filter((r) => slaHead(r, d, x.nowMs).state === 'late').length,
          avgScore: rated.length
            ? Math.round((rated.reduce((a, r) => a + r.score, 0) / rated.length) * 10) / 10
            : null,
          ratings: rated.length,
          fewAnswers: rated.length < 20,
        };
        return row;
      });
    const reasons = new Map<string, number>();
    for (const r of v.ratings)
      for (const why of r.reasons) reasons.set(why, (reasons.get(why) ?? 0) + 1);
    const res: S['ServiceReport'] = {
      period: { from, to },
      rows,
      reasons: [...reasons]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      weeks: [
        {
          weekStart: '2026-09-28',
          requests: reqs.length,
          late: rows.reduce((a, r) => a + r.late, 0),
        },
      ],
    };
    if (x.t.owner) {
      const names = [...new Set(reqs.map((r) => r.assignee).filter((n): n is string => !!n))];
      res.staff = names.flatMap((n) => {
        const m = memberByName(x, n);
        return m
          ? [
              {
                member: m,
                ratings: 0,
                avgScore: null,
                complaintsConfirmed: 0,
                thanks: reqs.filter((r) => r.assignee === n && r.kind === 'thanks').length,
              },
            ]
          : [];
      });
    }
    return { body: res };
  },

  // ----- портал клиента -----

  getPublicServicePage: (ctx) => {
    const x = portalCtx(ctx);
    const d = directionBySlug(x, ctx.params.slug);
    const types = (x.svc?.types ?? []).filter(
      (t) => (t.dir === d.id && t.kind !== 'thanks') || (t.dir === d.id && t.kind === 'thanks'),
    );
    return {
      body: {
        slug: slugOf(d),
        directionName: d.name,
        color: d.color,
        brandName: 'Альта Групп',
        types: types.map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
        workHours: d.cal.label,
      } satisfies S['PublicServicePage'],
    };
  },

  submitPublicServiceRequest: (ctx) => {
    const x = portalCtx(ctx);
    const svc = requireService(x);
    const d = directionBySlug(x, ctx.params.slug);
    const b = body<S['PublicServiceSubmit']>(ctx);
    if (!b.consent)
      return invalid('consent', 'Нужно согласие на обработку персональных данных', 'required');
    const ty = svc.types.find((t) => t.id === b.typeId && t.dir === d.id);
    if (!ty) return invalid('typeId', 'Выберите тип обращения');
    const at = x.nowMs;
    const id = `r-w${++x.s.seq}`;
    const r: ServiceRequest = {
      id,
      key: `${d.key}-${d.next++}`,
      dir: d.id,
      kind: ty.kind,
      title:
        b.text
          .trim()
          .split(/[.!?\n]/)[0]
          ?.slice(0, 80) || 'Обращение клиента',
      status: 'new',
      priority: ty.kind === 'complaint' || ty.kind === 'claim' ? 'high' : 'normal',
      assignee: null,
      at,
      channel: 'widget',
      client: {
        name: b.clientName?.trim() || 'Клиент',
        phone: b.phone?.trim() ?? '',
        since: 'Новый клиент',
      },
      link: null,
      sla: slaFor(d.cal, ty, at),
      labels: [],
      tasks: [],
      messages: [
        {
          id: `msg-w${++x.s.seq}`,
          kind: 'client',
          at,
          text: b.text.trim(),
          by: b.clientName?.trim() || 'Клиент',
          channel: 'widget',
        },
      ],
    };
    svc.requests.unshift(r);
    return {
      status: 201,
      body: { key: r.key, token: portalToken(id), statusLabel: STATUS_LABEL.new },
    };
  },

  getPublicServiceRequest: (ctx) => {
    const x = portalCtx(ctx);
    return { body: publicDto(x, byToken(x, ctx.params.token)) };
  },

  postPublicServiceMessage: (ctx) => {
    const x = portalCtx(ctx);
    const r = byToken(x, ctx.params.token);
    if (r.status === 'closed') return fail('invalid_transition', 'Обращение закрыто');
    const text = body<S['PublicServiceMessageCreate']>(ctx).text.trim();
    const m = {
      id: `msg-w${++x.s.seq}`,
      kind: 'client' as const,
      at: x.nowMs,
      text,
      by: r.client.name,
      channel: r.channel,
    };
    r.messages.push(m);
    if (r.status === 'wait') r.status = 'work';
    return {
      status: 201,
      body: {
        id: x.U(m.id),
        at: msInstant(m.at),
        text,
        fromClient: true,
        files: [],
      } satisfies S['PublicServiceMessage'],
    };
  },

  ratePublicServiceResolution: (ctx) => {
    const x = portalCtx(ctx);
    const r = byToken(x, ctx.params.token);
    if (r.status !== 'resolved')
      return fail('invalid_transition', 'Оценить можно решённое обращение');
    if (x.s.csat[r.id]) return fail('invalid_transition', 'Оценка уже поставлена');
    x.s.csat[r.id] = { score: body<S['PublicServiceCsat']>(ctx).score, at: ctx.now() };
    return { status: 200, body: publicDto(x, r) };
  },

  reopenPublicServiceRequest: (ctx) => {
    const x = portalCtx(ctx);
    const r = byToken(x, ctx.params.token);
    const pub = publicDto(x, r);
    if (!pub.canReopen)
      return fail('invalid_transition', 'Вопрос можно вернуть в течение 5 дней после решения');
    r.status = 'work';
    r.outcome = null;
    r.resolvedAt = null;
    for (const k of ['resolve', 'legal'] as const) {
      const t = r.sla[k];
      if (t) t.stopped = null;
    }
    const text = body<S['PublicServiceReopen']>(ctx).text?.trim();
    r.messages.push({
      id: `msg-w${++x.s.seq}`,
      kind: 'client',
      at: x.nowMs,
      text: text || 'Вопрос не решён',
      by: r.client.name,
      channel: r.channel,
    });
    return { status: 200, body: publicDto(x, r) };
  },

  optOutPublicSurveys: (ctx) => {
    const x = portalCtx(ctx);
    const r = byToken(x, ctx.params.token);
    if (!x.s.optOut.includes(r.client.name)) x.s.optOut.push(r.client.name);
    return { status: 200, body: { optedOut: true } };
  },

  initiatePublicServiceUpload: (ctx) => {
    const x = portalCtx(ctx);
    const r = byToken(x, ctx.params.token);
    const b = body<S['PublicServiceUploadCreate']>(ctx);
    if (b.sizeBytes > 20 * 1024 * 1024) return fail('payload_too_large', 'Файл больше 20 МБ');
    const uploadId = x.U(`up-w${++x.s.seq}`);
    const fileId = x.U(`f-w${x.s.seq}`);
    x.s.portalUploads.push({
      uploadId,
      fileId,
      token: portalToken(r.id),
      fileName: b.fileName,
      contentType: b.contentType,
      sizeBytes: b.sizeBytes,
      sha256: b.sha256,
      createdAt: ctx.now(),
    });
    return {
      status: 201,
      body: {
        uploadId,
        fileId,
        method: 'PUT',
        uploadUrl: `https://storage.example.invalid/uploads/${uploadId}`,
        requiredContentType: b.contentType,
        requiredSha256: b.sha256,
        expiresAt: new Date(Date.parse(ctx.now()) + 15 * 60_000)
          .toISOString()
          .replace(/\.\d{3}Z$/, 'Z'),
        maxBytes: 20 * 1024 * 1024,
      } satisfies S['UploadTicket'],
    };
  },

  completePublicServiceUpload: (ctx) => {
    const x = portalCtx(ctx);
    const r = byToken(x, ctx.params.token);
    const up = x.s.portalUploads.find(
      (u) => u.uploadId === ctx.params.uploadId && u.token === portalToken(r.id),
    );
    if (!up) return fail('not_found', 'Загрузка не найдена');
    if (body<S['PublicServiceUploadComplete']>(ctx).sha256 !== up.sha256)
      return invalid('sha256', 'Контрольная сумма не совпала', 'checksum');
    return {
      status: 202,
      body: {
        id: up.fileId,
        fileName: up.fileName,
        contentType: up.contentType,
        sizeBytes: up.sizeBytes,
        sha256: up.sha256,
        status: 'quarantined',
        createdAt: up.createdAt,
      } satisfies S['File'],
    };
  },
};

/** Срез участника; нет обращений у организации — 404, нет права — 403. */
function requireView(x: ServiceCtx): NonNullable<ReturnType<ServiceCtx['view']>> {
  const v = x.view();
  if (!v || !x.svc) return fail('not_found', 'В организации нет направлений обращений');
  if (v.hidden) return fail('forbidden_action', 'Нет права «Видеть» в обращениях');
  return v;
}

void directionCounts;
void fillTemplate;
