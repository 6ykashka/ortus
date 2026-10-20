// Тег Knowledge сценарного сервера (W4.04, контрактный PR 3 этапа 4; W4.31, W4.32): 32 операции «Базы знаний» поверх
// домена W4.30 — пространства, дерево, узел и версии, доступ узла с влиянием, карта и объяснение, запросы доступа,
// участники пространства, правила и журнал запусков (эталон «База знаний.dc.html», design-2026-10-19). Скрытое не
// видно нигде: недоступные пространство и узел — 404, как отсутствующие.
import type { components } from '@ortus/api-client';
import {
  KB_ACCESS,
  KB_MODES,
  KB_ROLE_CAPS,
  KB_ROLE_ORDER,
  KB_TEMPLATES,
  isKbOwner,
  type KbAccessEntry,
  kbAccess,
  kbEntryLabel,
  kbEntryReach,
  kbPath,
  kbReach,
  kbSpaceMy,
  kbSubtree,
  kbUnitName,
  type KbNode,
  type KbSpace,
  type KbTenantDb,
} from '@ortus/domain/modules';

import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import {
  ackDto,
  domainMode,
  instant,
  isLead,
  isoDate,
  type KbView,
  LEAD_ONLY,
  modeOf,
  needLead,
  nodeDto,
  nodeOr404,
  nodeSummary,
  ROLE_TEMPLATE,
  spaceDto,
  spaceOr404,
  spaceVisible,
  TEMPLATE_ROLE,
  viewOf,
} from './state.ts';

type S = components['schemas'];

function invalid(field: string, message: string, code = 'invalid'): never {
  return fail('validation_failed', message, { violations: [{ field, code, message }] });
}

const isOwner = (db: KbTenantDb, mid: string): boolean => isKbOwner(db, mid);

/** Вернуть узлу прежние поля (проверка командой домена без записи — dryRun). */
function restore(n: KbNode, copy: KbNode): void {
  for (const k of Object.keys(n)) if (!(k in copy)) Reflect.deleteProperty(n, k);
  Object.assign(n, copy);
}

/** Узлы пространства, видимые участнику, в глубину по позициям; родитель скрытого — как корень (visTree эталона). */
export function visibleTree(v: KbView, sp: KbSpace, mid = v.me): { n: KbNode; d: number }[] {
  const vis = v.K.pages.filter(
    (p) => p.space === sp.id && !p.archived && kbAccess(v.db, mid, p, v.opts).view,
  );
  const ids = new Set(vis.map((p) => p.id));
  const kids = (id: string | null) =>
    vis
      .filter((p) => (p.parent && ids.has(p.parent) ? p.parent : null) === id)
      .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  const out: { n: KbNode; d: number }[] = [];
  const walk = (id: string | null, d: number) => {
    for (const n of kids(id)) {
      out.push({ n, d });
      walk(n.id, d + 1);
    }
  };
  walk(null, 1);
  return out;
}

/** Видимый родитель узла (скрытый родитель не раскрывается). */
function visibleParent(v: KbView, n: KbNode): string | null {
  const p = n.parent ? v.K.pages.find((x) => x.id === n.parent) : undefined;
  return p && kbAccess(v.db, v.me, p, v.opts).view ? v.U(p.id) : null;
}

/** Видимые предки узла от корня (путь обрывается на скрытом предке). */
function visiblePath(v: KbView, n: KbNode): S['KnowledgeNodeRef'][] {
  const out: S['KnowledgeNodeRef'][] = [];
  let p = n.parent ? v.K.pages.find((x) => x.id === n.parent) : undefined;
  while (p && kbAccess(v.db, v.me, p, v.opts).view) {
    out.unshift({ id: v.U(p.id), title: p.title });
    const parent: string | null | undefined = p.parent;
    p = parent ? v.K.pages.find((x) => x.id === parent) : undefined;
  }
  return out;
}

function nodeOut(v: KbView, n: KbNode): S['KnowledgeNode'] {
  return { ...nodeDto(v, n), parentId: visibleParent(v, n), path: visiblePath(v, n) };
}

function summaryOut(v: KbView, n: KbNode): S['KnowledgeNodeSummary'] {
  return { ...nodeSummary(v, n), parentId: visibleParent(v, n) };
}

// ---------------------------------------------------------------------------------------------
// Влияние: доступ каждого незаблокированного участника к узлам до и после (kbImpact эталона, но с id).

interface Impact {
  gainView: S['KnowledgeImpactPerson'][];
  loseView: S['KnowledgeImpactPerson'][];
  gainEdit: S['KnowledgeImpactPerson'][];
  loseEdit: S['KnowledgeImpactPerson'][];
}

function impactOf(v: KbView, after: KbTenantDb, ids: readonly string[]): Impact {
  const out: Impact = { gainView: [], loseView: [], gainEdit: [], loseEdit: [] };
  const K2 = after.knowledge;
  for (const m of v.db.members) {
    if (m.status === 'blocked') continue;
    const d = { gv: 0, lv: 0, ge: 0, le: 0 };
    for (const id of ids) {
      const a = kbAccess(
        v.db,
        m.id,
        v.K.pages.find((p) => p.id === id),
        v.opts,
      );
      const b = kbAccess(
        after,
        m.id,
        K2?.pages.find((p) => p.id === id),
        v.opts,
      );
      if (!a.view && b.view) d.gv++;
      if (a.view && !b.view) d.lv++;
      if (!a.edit && b.edit) d.ge++;
      if (a.edit && !b.edit) d.le++;
    }
    const who = (pages: number) => ({ memberId: v.U(m.id), displayName: m.name, pages });
    if (d.gv) out.gainView.push(who(d.gv));
    if (d.lv) out.loseView.push(who(d.lv));
    if (d.ge) out.gainEdit.push(who(d.ge));
    if (d.le) out.loseEdit.push(who(d.le));
  }
  return out;
}

/** Копия БД с другими узлами и пространствами (для влияния без записи). */
function withSlice(v: KbView, pages: KbNode[], spaces = v.K.spaces): KbTenantDb {
  return { ...v.db, knowledge: { ...v.K, pages, spaces } };
}

// ---------------------------------------------------------------------------------------------
// Доступ узла

const STEP: Readonly<Record<string, S['KnowledgeAccessStep']['kind']>> = {
  ok: 'ok',
  no: 'no',
  wait: 'wait',
  inh: 'inherit',
};

function entryOut(v: KbView, e: KbAccessEntry): S['KnowledgeAccessEntryInput'] {
  const out: S['KnowledgeAccessEntryInput'] = { who: e.who, can: e.can };
  if (e.who === 'relation') {
    out.relation = 'foreman';
    out.object = { moduleKey: 'repairs', entityType: 'project', entityId: v.U(e.obj ?? '') };
  } else if (e.ref) {
    out.refId = v.U(e.ref);
  }
  if (e.unit) out.orgUnitId = v.U(e.unit);
  return out;
}

function reachOf(v: KbView, e: KbAccessEntry, sp: KbSpace, n: KbNode): S['KnowledgeAccessReach'] {
  const r = kbEntryReach(v.db, e, sp, n, v.opts);
  return {
    members: r.ok.length,
    total: r.ppl.length,
    blocked: r.no.map((x) => ({ displayName: x.m.name, reason: x.why ?? '' })),
  };
}

function accessDto(v: KbView, n: KbNode): S['KnowledgeNodeAccess'] {
  const sp = v.K.spaces.find((s) => s.id === n.space) as KbSpace;
  const lead = isLead(v, sp);
  const path = kbPath(v.K, n);
  const level = KB_ACCESS[sp.access ?? 'closed'];
  const chain: S['KnowledgeAccessStep'][] = [
    { kind: 'ok', title: 'Организация', detail: 'Владелец бизнеса видит всё' },
    {
      kind: 'ok',
      title: `Пространство «${sp.name}»`,
      detail: `${level.label}: ${level.d.toLowerCase()}`,
    },
    ...path
      .slice(0, -1)
      .filter((x) => x.mode && x.mode !== 'inherit')
      .filter((x) => kbAccess(v.db, v.me, x, v.opts).view)
      .map((x) => ({
        kind: 'ok' as const,
        title: `«${x.title}»`,
        detail: KB_MODES[x.mode ?? 'inherit'].label,
      })),
    {
      kind: 'ok',
      title: `«${n.title}»`,
      detail: lead ? 'Настраиваете сейчас' : KB_MODES[n.mode ?? 'inherit'].label,
    },
  ];
  const own = [...path]
    .reverse()
    .slice(1)
    .find((x) => x.mode && x.mode !== 'inherit');
  const visibleOwn = own && kbAccess(v.db, v.me, own, v.opts).view ? own : undefined;
  const sub = kbSubtree(v.K, n);
  const list = n.mode && n.mode !== 'inherit' ? (n.list ?? []) : [];
  const out: S['KnowledgeNodeAccess'] = {
    nodeId: v.U(n.id),
    title: n.title,
    accessMode: modeOf(n),
    inheritedFrom: visibleOwn
      ? { kind: 'node', id: v.U(visibleOwn.id), title: visibleOwn.title }
      : { kind: 'space', id: v.U(sp.id), title: sp.name },
    chain,
    entries: list.map((e) => {
      const x: S['KnowledgeAccessEntry'] = { ...entryOut(v, e), label: kbEntryLabel(v.db, e) };
      if (lead) x.reach = reachOf(v, e, sp, n);
      return x;
    }),
    descendantCount: sub.length - 1,
    ownSubnodes: sub
      .filter((x) => x.id !== n.id && x.mode && x.mode !== 'inherit')
      .map((x) => ({ id: v.U(x.id), title: x.title })),
    canManage: lead,
    leadNames: v.db.assignments
      .filter((a) => a.role === 'r-kb-lead' && a.scope.type === 'space' && a.scope.id === sp.id)
      .map((a) => v.db.members.find((m) => m.id === a.member)?.name ?? '')
      .filter(Boolean),
    revision: v.k.accessRev[n.id] ?? 1,
  };
  if (lead) {
    out.requests = (v.K.requests ?? [])
      .filter((r) => r.node === n.id && r.status === 'open')
      .map((r) => requestDto(v, r));
  }
  return out;
}

type Req = NonNullable<KbTenantDb['knowledge']>['requests'] extends (infer X)[] | undefined
  ? X
  : never;

function requestDto(v: KbView, r: Req): S['KnowledgeAccessRequest'] {
  const n = v.K.pages.find((p) => p.id === r.node);
  const out: S['KnowledgeAccessRequest'] = {
    id: v.U(r.id),
    nodeId: v.U(r.node),
    nodeTitle: n?.title ?? '',
    spaceId: v.U(r.space),
    memberId: v.U(r.member),
    memberDisplayName: v.db.members.find((m) => m.id === r.member)?.name ?? '',
    can: r.can,
    status: r.status,
    requestedAt: instant(r.at),
  };
  if (r.status !== 'open') {
    out.decidedAt = instant(r.at);
    if (r.by) out.decidedByDisplayName = r.by;
  }
  return out;
}

/** Запись списка из контракта → запись домена (проверку ссылок делает команда домена). */
function entryIn(v: KbView, e: S['KnowledgeAccessEntryInput'], i: number): KbAccessEntry {
  if (e.who === 'relation') {
    if (!e.relation || !e.object) invalid(`entries[${i}]`, 'Неверная запись в списке доступа');
    return {
      who: 'relation',
      ref: 'foreman',
      obj: v.P(e.object.entityId) ?? e.object.entityId,
      can: e.can,
    };
  }
  if (!e.refId) invalid(`entries[${i}]`, 'Неверная запись в списке доступа');
  const ref = v.P(e.refId);
  const missing =
    e.who === 'member'
      ? 'Сотрудник не найден'
      : e.who === 'group'
        ? 'Группа не найдена'
        : 'Роль не найдена';
  if (!ref) invalid(`entries[${i}]`, missing);
  const out: KbAccessEntry = { who: e.who, ref, can: e.can };
  if (e.orgUnitId) {
    const unit = v.P(e.orgUnitId);
    if (!unit) invalid(`entries[${i}].orgUnitId`, 'Подразделение не найдено');
    out.unit = unit;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Участники пространства

function membersDto(v: KbView, sp: KbSpace): S['KnowledgeSpaceMembers'] {
  const lead = isLead(v, sp);
  const sa = v.db.assignments.filter(
    (a) => a.scope.type === 'space' && a.scope.id === sp.id && KB_ROLE_ORDER.includes(a.role),
  );
  const level = KB_ACCESS[sp.access ?? 'closed'];
  const out: S['KnowledgeSpaceMembers'] = {
    spaceId: v.U(sp.id),
    levelLabel: level.d,
    canManage: lead,
    roles: KB_ROLE_ORDER.map((rid) => ({
      role: ROLE_TEMPLATE[rid] ?? 'kb_space_reader',
      label: v.db.roles.find((r) => r.id === rid)?.name ?? rid,
      description: KB_ROLE_CAPS[rid] ?? '',
      members: sa
        .filter((a) => a.role === rid)
        .map((a) => v.db.members.find((m) => m.id === a.member))
        .filter((m) => m !== undefined)
        .map((m) => ({
          memberId: v.U(m.id),
          displayName: m.name,
          state: m.status === 'invited' ? ('invited' as const) : ('active' as const),
        })),
    })),
  };
  if (!lead) return out;
  const inSpace = new Set(sa.map((a) => a.member));
  const area = v.db.members.filter(
    (m) =>
      m.status !== 'blocked' &&
      !inSpace.has(m.id) &&
      !isOwner(v.db, m.id) &&
      kbSpaceMy(v.db, m.id, sp, v.opts).view,
  );
  out.byLevel = {
    label: `По уровню «${level.label}»`,
    members: area.slice(0, 8).map((m) => {
      const via = v.db.assignments
        .filter((a) => a.member === m.id)
        .map((a) => ({ a, r: v.db.roles.find((r) => r.id === a.role) }))
        .find(({ r }) => r && !r.space && (r.actions?.knowledge ?? []).length);
      const where =
        via?.a.scope.type === 'tenant'
          ? 'вся организация'
          : via && 'id' in via.a.scope
            ? kbUnitName(v.db, via.a.scope.id)
            : via?.a.scope.type === 'self'
              ? 'своё'
              : '';
      return {
        memberId: v.U(m.id),
        displayName: m.name,
        source: via?.r ? `роль «${via.r.name}» · ${where.toLowerCase()}` : 'по роли в области',
      };
    }),
    total: area.length,
  };
  out.pageAssignments = v.db.assignments
    .filter(
      (a) =>
        a.scope.type === 'page' &&
        v.K.pages.some((p) => p.id === (a.scope as { id: string }).id && p.space === sp.id),
    )
    .map((a) => {
      const nid = (a.scope as { id: string }).id;
      return {
        memberId: v.U(a.member),
        displayName: v.db.members.find((m) => m.id === a.member)?.name ?? '',
        nodeId: v.U(nid),
        nodeTitle: v.K.pages.find((p) => p.id === nid)?.title ?? '',
        until: isoDate(a.until),
      };
    });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Автоматизация

type Rule = NonNullable<NonNullable<KbTenantDb['knowledge']>['rules']>[number];
type Run = NonNullable<NonNullable<KbTenantDb['knowledge']>['runs']>[number];

interface RepairObject {
  id: string;
  name: string;
  stage?: string;
  foreman?: string | null;
}

const repairObjects = (v: KbView): RepairObject[] =>
  (v.db as { repair?: { objects?: RepairObject[] } }).repair?.objects ?? [];

function ruleDto(v: KbView, r: Rule): S['KnowledgeRule'] {
  const out: S['KnowledgeRule'] = {
    id: v.U(r.id),
    spaceId: v.U(r.space),
    kind: r.kind,
    name: r.name,
    trigger: r.trigger,
    enabled: r.on,
  };
  if (r.kind === 'section') {
    out.objects = repairObjects(v).map((o) => {
      const has = v.K.pages.some((p) => p.id === 'kb-o-' + o.id);
      return {
        projectId: v.U(o.id),
        name: o.name,
        stage: o.stage ?? null,
        foremanName: o.foreman ?? null,
        sectionNodeId: has ? v.U('kb-o-' + o.id) : null,
      };
    });
  }
  return out;
}

const runDto = (v: KbView, r: Run): S['KnowledgeRun'] => ({
  id: v.U(r.id),
  ruleId: v.U(r.rule),
  at: instant(r.at),
  result: r.res,
  text: r.text,
});

/** Строки журнала, которые добавил запуск (журнал — новые сверху). */
const newRuns = (v: KbView, before: number): S['KnowledgeRun'][] =>
  (v.K.runs ?? []).slice(0, Math.max(0, (v.K.runs ?? []).length - before)).map((r) => runDto(v, r));

const ruleOr404 = (v: KbView, id: string | undefined): Rule => {
  const proto = v.P(id);
  const r = (v.K.rules ?? []).find((x) => x.id === proto);
  const sp = r && v.K.spaces.find((s) => s.id === r.space);
  if (!r || !sp || !spaceVisible(v, sp)) return fail('not_found', 'Правило не найдено');
  needLead(v, sp);
  return r;
};

// ---------------------------------------------------------------------------------------------
// Шаблоны пространств

function templatesDto(v: KbView): S['KnowledgeSpaceTemplate'][] {
  return KB_TEMPLATES.map((t) => {
    let top = -1;
    return {
      key: t.id as S['KnowledgeSpaceTemplate']['key'],
      name: t.name,
      icon: t.icon,
      hint: t.hint,
      nodes: t.nodes.map((x, i) => {
        const parentIndex = x.in ? top : null;
        if (!x.in) top = i;
        return {
          index: i,
          kind: x.k,
          title: x.t,
          parentIndex,
          readerRoleLabel: x.role ? (v.db.roles.find((r) => r.id === x.role)?.name ?? null) : null,
          requestAck: Boolean(x.ack),
        };
      }),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Хендлеры

const SHORT = (t: string, n: number): string => {
  const x = t.replace(/\s+/g, ' ').trim();
  return x.length > n ? x.slice(0, n - 1) + '…' : x;
};

const body = <T>(ctx: HandlerContext): T => ctx.body as T;

export const knowledgeHandlers: Registry = {
  listKnowledgeSpaces: (ctx) => {
    const v = viewOf(ctx);
    const items = v.K.spaces.filter((sp) => spaceVisible(v, sp)).map((sp) => spaceDto(v, sp));
    return { body: page(items, ctx.query) };
  },

  createKnowledgeSpace: (ctx) => {
    const v = viewOf(ctx);
    const b = body<S['KnowledgeSpaceCreate']>(ctx);
    let unit: string | null = null;
    if (b.orgUnitId) {
      unit = v.P(b.orgUnitId) ?? null;
      if (!unit || !v.db.units.some((u) => u.id === unit)) {
        invalid('orgUnitId', 'Подразделение не найдено');
      }
    }
    const { id } = v.run(() =>
      v.cmds.kbCreateSpace({
        name: b.name,
        access: b.access,
        template: b.templateKey ?? 'blank',
        ...(b.icon ? { icon: b.icon } : {}),
        ...(b.color ? { color: b.color } : {}),
        unit,
        ...(b.templateNodes ? { nodes: b.templateNodes } : {}),
      }),
    );
    const sp = v.K.spaces.find((s) => s.id === id) as KbSpace;
    return { status: 201, body: spaceDto(v, sp) };
  },

  listKnowledgeSpaceTemplates: (ctx) => {
    const v = viewOf(ctx);
    return { body: { items: templatesDto(v) } };
  },

  updateKnowledgeSpace: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    needLead(v, sp);
    ctx.revision(v.k.spaceRev[sp.id] ?? 1);
    const b = body<S['KnowledgeSpacePatch']>(ctx);
    const next: KbSpace = { ...sp };
    if (b.name !== undefined) {
      const name = b.name.trim();
      if (name.length < 2) invalid('name', 'Название — не короче 2 символов');
      if (v.K.spaces.some((s) => s.id !== sp.id && s.name.toLowerCase() === name.toLowerCase())) {
        invalid('name', `Пространство «${name}» уже есть`, 'taken');
      }
      next.name = name;
    }
    if (b.icon) next.icon = b.icon;
    if (b.color) next.color = b.color;
    if (b.access) next.access = b.access;
    if (b.orgUnitId !== undefined) {
      const unit = b.orgUnitId ? v.P(b.orgUnitId) : null;
      if (b.orgUnitId && (!unit || !v.db.units.some((u) => u.id === unit))) {
        invalid('orgUnitId', 'Подразделение не найдено');
      }
      if (!v.t.owner) {
        fail(
          'forbidden_action',
          'Создавать пространства может владелец бизнеса или роль с правом «База знаний · Настраивать»',
        );
      }
      next.unit = unit ?? null;
    }
    const after = withSlice(
      v,
      v.K.pages,
      v.K.spaces.map((s) => (s.id === sp.id ? next : s)),
    );
    const ids = v.K.pages.filter((p) => p.space === sp.id && !p.archived).map((p) => p.id);
    const imp = impactOf(v, after, ids);
    const applied = !b.dryRun;
    if (applied) {
      Object.assign(sp, next);
      v.k.spaceRev[sp.id] = (v.k.spaceRev[sp.id] ?? 1) + 1;
    }
    const space = spaceDto(v, applied ? sp : next);
    if (!applied) space.revision = v.k.spaceRev[sp.id] ?? 1;
    return {
      body: { applied, space, impact: { pages: ids.length, ...imp } },
      etag: space.revision,
    };
  },

  getKnowledgeSpaceTree: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    const nodes = visibleTree(v, sp).map(({ n }) => summaryOut(v, n));
    return { body: { space: spaceDto(v, sp), nodes } };
  },

  searchKnowledge: (ctx) => {
    const v = viewOf(ctx);
    const q = (ctx.query.get('q') ?? '').trim().toLowerCase();
    if (q.length < 2) invalid('q', 'Введите не меньше 2 символов', 'too_short');
    const spaceId = ctx.query.get('spaceId');
    const only = spaceId ? spaceOr404(v, spaceId) : undefined;
    const items = v.K.pages
      .filter((p) => !p.archived && (!only || p.space === only.id))
      .filter((p) => kbAccess(v.db, v.me, p, v.opts).view)
      .filter((p) =>
        `${p.title} ${p.versions[p.versions.length - 1]?.body ?? ''}`.toLowerCase().includes(q),
      )
      .slice(0, 12)
      .map((p) => {
        const sp = v.K.spaces.find((s) => s.id === p.space);
        return {
          nodeId: v.U(p.id),
          spaceId: v.U(p.space),
          spaceName: sp?.name ?? '',
          kind: p.kind ?? 'page',
          title: p.title,
          path: [sp?.name ?? '', ...visiblePath(v, p).map((x) => x.title)],
          excerpt: SHORT(p.versions[p.versions.length - 1]?.body ?? '', 150),
        };
      });
    return { body: { items } };
  },

  getKnowledgeNode: (ctx) => {
    const v = viewOf(ctx);
    return { body: nodeOut(v, nodeOr404(v, ctx.params.nodeId)) };
  },

  getKnowledgeNodeVersion: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const ver = n.versions.find((x) => String(x.v) === ctx.params.version);
    if (!ver) fail('not_found', 'Версия не найдена');
    return {
      body: {
        version: ver.v,
        publishedAt: instant(ver.at),
        authorDisplayName: ver.by,
        body: ver.body,
      },
    };
  },

  createKnowledgeNode: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    const b = body<S['KnowledgeNodeCreate']>(ctx);
    const parent = b.parentId ? nodeOr404(v, b.parentId) : null;
    const { id } = v.run(() => v.cmds.kbCreateNode(sp.id, parent?.id ?? null, b.kind, b.title));
    return { status: 201, body: nodeOut(v, v.K.pages.find((p) => p.id === id) as KbNode) };
  },

  publishKnowledgeNodeVersion: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const b = body<S['KnowledgePublish']>(ctx);
    const acc = kbAccess(v.db, v.me, n, v.opts);
    if (!acc.edit) fail('forbidden_action', `Нет права править «${n.title}»`);
    const last = n.versions[n.versions.length - 1]?.v ?? 0;
    const tag = ctx.headers.get('If-Match') ?? '';
    if (tag !== `"rev-${last}"`) {
      fail('revision_mismatch', `Страницу уже изменили (v${last}). Обновите и повторите правку.`);
    }
    if (b.steps && n.kind !== 'diagram') invalid('steps', 'Шаги — только у схемы');
    const res = v.run(() =>
      v.cmds.kbPublish(n.id, {
        base: last,
        body: b.body,
        ...(b.title ? { title: b.title } : {}),
        ...(b.steps ? { steps: b.steps } : {}),
        ...(b.requestAck ? { ack: true } : {}),
      }),
    );
    const node = nodeOut(v, n);
    return {
      status: 201,
      body: { node, version: res.v, ackRequestedCount: res.asked },
      etag: node.revision,
    };
  },

  setKnowledgeNodeStatus: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const b = body<S['KnowledgeNodeStatusChange']>(ctx);
    v.run(() => v.cmds.kbSetStatus(n.id, b.status));
    return { body: nodeOut(v, n) };
  },

  moveKnowledgeNode: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const b = body<S['KnowledgeMove']>(ctx);
    if (!n.parent && n.title === 'Обзор') {
      invalid('parentId', 'Главную страницу пространства не переносят');
    }
    const parent = b.parentId ? nodeOr404(v, b.parentId) : null;
    const sub = kbSubtree(v.K, n).map((x) => x.id);
    const pages = v.K.pages.map((p) => (p.id === n.id ? { ...p, parent: parent?.id ?? null } : p));
    const imp = impactOf(v, withSlice(v, pages), sub);
    if (b.dryRun) {
      // Те же проверки, что у команды (права, пространство, цикл, глубина), без записи.
      const copy = structuredClone(n);
      try {
        v.run(() => v.cmds.kbMove(n.id, parent?.id ?? null));
      } finally {
        restore(n, copy);
      }
      return {
        body: { applied: false, pages: sub.length, loseView: imp.loseView, gainView: imp.gainView },
      };
    }
    v.run(() => v.cmds.kbMove(n.id, parent?.id ?? null));
    return {
      body: {
        applied: true,
        pages: sub.length,
        loseView: imp.loseView,
        gainView: imp.gainView,
        node: nodeOut(v, n),
      },
    };
  },

  archiveKnowledgeNode: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    v.run(() => v.cmds.kbArchive(n.id, true));
    return {
      body: { nodeId: v.U(n.id), archived: true, pages: kbSubtree(v.K, n, true).length },
    };
  },

  restoreKnowledgeNode: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    v.run(() => v.cmds.kbArchive(n.id, false));
    return {
      body: { nodeId: v.U(n.id), archived: false, pages: kbSubtree(v.K, n, true).length },
    };
  },

  listKnowledgeArchive: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    const my = kbSpaceMy(v.db, v.me, sp, v.opts);
    if (!my.edit && !my.lead) {
      fail('forbidden_action', 'Архивировать может редактор или руководитель пространства');
    }
    const items = v.K.pages
      .filter((p) => p.space === sp.id && p.archived)
      .filter((p) => !(p.parent && v.K.pages.find((x) => x.id === p.parent)?.archived))
      .filter((p) => kbAccess(v.db, v.me, p, v.opts).view)
      .map((p) => ({
        nodeId: v.U(p.id),
        title: p.title,
        kind: p.kind ?? 'page',
        pages: kbSubtree(v.K, p, true).length,
      }));
    return { body: { items } };
  },

  ackKnowledgeNode: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const b = body<S['KnowledgeAckCreate']>(ctx);
    if (!n.ack || n.ack.v !== b.version) {
      invalid('version', 'Ознакомление со страницей не запрошено');
    }
    v.run(() => v.cmds.kbAck(n.id));
    return { body: ackDto(v, n) };
  },

  getKnowledgeNodeAccess: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const out = accessDto(v, n);
    return { body: out };
  },

  listKnowledgeAccessCandidates: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const sp = v.K.spaces.find((s) => s.id === n.space) as KbSpace;
    needLead(v, sp);
    const items: S['KnowledgeAccessCandidate'][] = [];
    const push = (e: KbAccessEntry, label: string) => {
      const r = kbEntryReach(v.db, e, sp, n, v.opts);
      const tag = !r.ppl.length
        ? '— сейчас никого'
        : !r.ok.length
          ? '— не получат доступ'
          : r.no.length
            ? `— получат ${r.ok.length} из ${r.ppl.length}`
            : '';
      items.push({
        entry: entryOut(v, e),
        label,
        reach: { members: r.ok.length, total: r.ppl.length, reason: r.no[0]?.why ?? null },
        reachLabel: tag,
      });
    };
    const area = sp.unit ? ` · «${kbUnitName(v.db, sp.unit)}»` : ' · вся организация';
    for (const r of v.db.roles.filter(
      (x) => !x.all && !x.project && !x.space && x.kind !== 'system',
    )) {
      push(
        { who: 'role', ref: r.id, ...(sp.unit ? { unit: sp.unit } : {}), can: 'view' },
        `Роль «${r.name}»${area}`,
      );
    }
    for (const id of KB_ROLE_ORDER) {
      const r = v.db.roles.find((x) => x.id === id);
      if (r) push({ who: 'role', ref: id, can: 'view' }, `Роль «${r.name}» в пространстве`);
    }
    for (const g of v.db.groups ?? []) {
      push({ who: 'group', ref: g.id, can: 'view' }, `Группа «${g.name}»`);
    }
    const obj = kbPath(v.K, n).find((x) => x.obj)?.obj;
    if (obj) push({ who: 'relation', ref: 'foreman', obj, can: 'view' }, 'Прораб этого объекта');
    for (const m of v.db.members.filter((x) => x.status !== 'blocked')) {
      const r = kbReach(v.db, m.id, n, v.opts);
      items.push({
        entry: { who: 'member', refId: v.U(m.id), can: 'view' },
        label: m.name,
        reach: { members: r.ok ? 1 : 0, total: 1, reason: r.ok ? null : (r.why ?? null) },
        reachLabel: r.ok ? '' : `— не получит доступ: ${r.why ?? ''}`,
      });
    }
    return { body: { items } };
  },

  setKnowledgeNodeAccess: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const sp = v.K.spaces.find((s) => s.id === n.space) as KbSpace;
    if (!isLead(v, sp)) fail('forbidden_action', LEAD_ONLY);
    ctx.revision(v.k.accessRev[n.id] ?? 1);
    const b = body<S['KnowledgeAccessChange']>(ctx);
    const mode = domainMode(b.mode);
    const list = mode === 'inherit' ? [] : b.entries.map((e, i) => entryIn(v, e, i));
    const sub = kbSubtree(v.K, n);
    const own = sub.filter((x) => x.id !== n.id && x.mode && x.mode !== 'inherit');
    const ownIds = new Set(own.map((x) => x.id));
    const pages = v.K.pages.map((p) =>
      p.id === n.id
        ? { ...p, mode, list }
        : b.applyToOwn && ownIds.has(p.id)
          ? { ...p, mode: 'inherit' as const, list: [] }
          : p,
    );
    const imp = impactOf(
      v,
      withSlice(v, pages),
      sub.map((x) => x.id),
    );
    const base = {
      pages: sub.length,
      own: own.map((x) => ({ id: v.U(x.id), title: x.title })),
      ...imp,
    };
    if (b.dryRun) {
      // Проверка записей — та же, что у команды, на копии среза.
      const copy = structuredClone(n);
      try {
        v.run(() => v.cmds.kbSetAccess(n.id, { mode, list, applyOwn: false }));
      } finally {
        restore(n, copy);
      }
      return { body: { applied: false, ...base }, etag: v.k.accessRev[n.id] ?? 1 };
    }
    v.run(() => v.cmds.kbSetAccess(n.id, { mode, list, applyOwn: Boolean(b.applyToOwn) }));
    v.k.accessRev[n.id] = (v.k.accessRev[n.id] ?? 1) + 1;
    const access = accessDto(v, n);
    return { body: { applied: true, ...base, access }, etag: access.revision };
  },

  getKnowledgeAccessMap: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    needLead(v, sp);
    const rows = visibleTree(v, sp);
    const raw = ctx.query.get('memberIds');
    let people = v.db.members
      .filter((m) => m.status !== 'blocked' && !isOwner(v.db, m.id))
      .filter((m) => rows.some(({ n }) => kbAccess(v.db, m.id, n, v.opts).view));
    if (raw) {
      const ids = raw.split(',').filter(Boolean);
      if (ids.length > 8) invalid('memberIds', 'Не больше 8 сотрудников');
      people = ids.map((id, i) => {
        const proto = v.P(id);
        const m = v.db.members.find((x) => x.id === proto);
        if (!m) invalid(`memberIds[${i}]`, 'Сотрудник не найден');
        return m;
      });
    }
    people = people.slice(0, 8);
    return {
      body: {
        spaceId: v.U(sp.id),
        members: people.map((m) => ({ memberId: v.U(m.id), displayName: m.name })),
        rows: rows.map(({ n, d }) => ({ nodeId: v.U(n.id), title: n.title, depth: d })),
        cells: rows.map(({ n }) =>
          people.map((m) => {
            const a = kbAccess(v.db, m.id, n, v.opts);
            return a.edit ? 'edit' : a.view ? 'view' : a.fn ? 'function' : 'none';
          }),
        ),
      },
    };
  },

  explainKnowledgeAccess: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const sp = v.K.spaces.find((s) => s.id === n.space) as KbSpace;
    needLead(v, sp);
    const proto = v.P(ctx.query.get('memberId') ?? '');
    const m = v.db.members.find((x) => x.id === proto);
    if (!m) fail('not_found', 'Сотрудник не найден');
    const a = kbAccess(v.db, m.id, n, v.opts);
    const summary = a.edit
      ? 'Читает и правит.'
      : a.view
        ? 'Читает, править не может.'
        : 'Не видит: страницы нет в его дереве, поиске и блоке «Подстраницы».' +
          (a.fn
            ? ' Функция «Водитель» закрывает финансовые страницы, роль или группа это не обходят.'
            : '');
    return {
      body: {
        nodeId: v.U(n.id),
        memberId: v.U(m.id),
        memberDisplayName: m.name,
        view: a.view,
        edit: a.edit,
        functionBlocked: a.fn,
        chain: a.chain.map((c) => ({ kind: STEP[c.k] ?? 'ok', title: c.t, detail: c.d })),
        summary,
      },
    };
  },

  createKnowledgeAccessRequest: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const kind = n.kind ?? 'page';
    if (kind === 'folder' || kind === 'link') {
      invalid('can', 'Право правки запрашивают у страницы');
    }
    const open = (v.K.requests ?? []).some(
      (r) => r.node === n.id && r.member === v.me && r.status === 'open',
    );
    if (open) fail('request_pending', 'Запрос уже отправлен');
    const { id } = v.run(() => v.cmds.kbRequest(n.id, 'edit'));
    const r = (v.K.requests ?? []).find((x) => x.id === id) as Req;
    return { status: 201, body: requestDto(v, r) };
  },

  decideKnowledgeAccessRequest: (ctx) => {
    const v = viewOf(ctx);
    const proto = v.P(ctx.params.requestId);
    const r = (v.K.requests ?? []).find((x) => x.id === proto);
    const sp = r && v.K.spaces.find((s) => s.id === r.space);
    if (!r || r.status !== 'open' || !sp || !spaceVisible(v, sp)) {
      fail('not_found', 'Запрос не найден или уже решён');
    }
    needLead(v, sp);
    const b = body<S['KnowledgeAccessRequestDecision']>(ctx);
    v.run(() => v.cmds.kbDecide(r.id, b.decision === 'approve'));
    const out = requestDto(v, r);
    // Команда домена меняет статус запроса — сужение типа после проверки open больше не верно.
    if (r.can === 'view' && (r.status as string) === 'approved') {
      const a = [...v.db.assignments]
        .reverse()
        .find((x) => x.member === r.member && x.scope.type === 'page' && x.until);
      const until = isoDate(a?.until);
      if (until) out.until = until;
    }
    return { body: out };
  },

  listKnowledgeAccessRequests: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    needLead(v, sp);
    const status = ctx.query.get('status') ?? 'open';
    if (!['open', 'approved', 'denied'].includes(status)) fail('malformed_request');
    const items = (v.K.requests ?? [])
      .filter((r) => r.space === sp.id && r.status === status)
      .map((r) => requestDto(v, r));
    return { body: { items } };
  },

  listKnowledgeSpaceMembers: (ctx) => {
    const v = viewOf(ctx);
    return { body: membersDto(v, spaceOr404(v, ctx.params.spaceId)) };
  },

  setKnowledgeSpaceMember: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    needLead(v, sp);
    const proto = v.P(ctx.params.memberId) ?? '';
    const b = body<S['KnowledgeSpaceMemberChange']>(ctx);
    const role = b.role ? (TEMPLATE_ROLE[b.role] ?? '') : null;
    v.run(() => v.cmds.kbSetMember(sp.id, proto, role));
    return { body: membersDto(v, sp) };
  },

  listKnowledgeRules: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    needLead(v, sp);
    const items = (v.K.rules ?? []).filter((r) => r.space === sp.id).map((r) => ruleDto(v, r));
    return { body: { items } };
  },

  setKnowledgeRuleEnabled: (ctx) => {
    const v = viewOf(ctx);
    const r = ruleOr404(v, ctx.params.ruleId);
    const b = body<S['KnowledgeRulePatch']>(ctx);
    if (r.on !== b.enabled) v.run(() => v.cmds.kbToggleRule(r.id));
    return { body: ruleDto(v, r) };
  },

  runKnowledgeReviewCheck: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    needLead(v, sp);
    const before = (v.K.runs ?? []).length;
    const { due } = v.run(() => v.cmds.kbCheckReview(sp.id));
    return { body: { count: due, runs: newRuns(v, before) } };
  },

  runKnowledgeSection: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    needLead(v, sp);
    const b = body<S['KnowledgeSectionCreate']>(ctx);
    const obj = v.P(b.projectId);
    if (!obj || !repairObjects(v).some((o) => o.id === obj)) fail('not_found', 'Объект не найден');
    if (!(v.K.rules ?? []).some((r) => r.space === sp.id && r.kind === 'section' && r.on)) {
      invalid('projectId', 'Правило выключено');
    }
    const before = (v.K.runs ?? []).length;
    const res = v.run(() => v.cmds.kbRunSection(obj));
    return {
      body: {
        count: res.created ? 1 : 0,
        created: res.created,
        nodeId: v.U(`kb-o-${obj}`),
        runs: newRuns(v, before),
      },
    };
  },

  listKnowledgeRuns: (ctx) => {
    const v = viewOf(ctx);
    const sp = spaceOr404(v, ctx.params.spaceId);
    needLead(v, sp);
    const items = (v.K.runs ?? []).filter((r) => r.space === sp.id).map((r) => runDto(v, r));
    return { body: { items } };
  },

  createKnowledgeTable: (ctx) => {
    const v = viewOf(ctx);
    const n = nodeOr404(v, ctx.params.nodeId);
    const b = body<S['KnowledgeTableCreate']>(ctx);
    const res = v.run(() =>
      v.cmds.createKbTable(n.id, {
        title: b.title,
        columns: b.columns.map((c) => ({ name: c.name, ...(c.type ? { type: c.type } : {}) })),
      }),
    );
    const t = (v.K.tables ?? []).find((x) => x.id === res.id);
    if (!t) return fail('not_found');
    return {
      status: 201,
      body: {
        id: v.U(t.id),
        nodeId: v.U(t.page),
        title: t.title,
        columns: t.columns.map((c) => ({ id: v.U(c.id), name: c.name, type: c.type })),
        rows: [],
      },
    };
  },
};
