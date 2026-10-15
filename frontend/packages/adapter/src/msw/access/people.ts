// Тег Access, контракт 0.4.0-stage1 (W1.00, карточка W1.05): карточка сотрудника без аккаунта (S1-09),
// функции сотрудника с периодом (S1-09, AUTH-05) и предпросмотр переноса подразделения (S1-08).
// Функции с периодом хранятся в состоянии организации (`workProfiles`, JSON); на старте — функции участников
// сида с 01.09.2026 МСК и id `work:<участник>:<функция>`, как у Go-сида W0.06. Member.workProfiles —
// проекция функций, действующих сейчас.
import type { components } from '@ortus/api-client';
import { seedUuid } from '@ortus/domain/seed';

import { memberDto } from '../core/dto.ts';
import { uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { MemberRow, Org, UnitRow } from '../core/state.ts';
import { requireUnits } from './members.ts';
import {
  memberById,
  memberIn,
  principalsOf,
  SOD_TEXT,
  sodConflict,
  subtree,
  unitsWith,
} from './rules.ts';

type S = components['schemas'];
type Fn = S['WorkProfile']['function'];

interface WorkProfileRow {
  id: string;
  memberId: string;
  function: Fn;
  validFrom: string;
  validUntil: string | null;
  revision: number;
}

/** Начало функций сида: 01.09.2026 00:00 МСК (Go-сид W0.06, people.work_profiles). */
const SEED_FROM = '2026-08-31T21:00:00Z';
const LABEL: Readonly<Record<Fn, string>> = {
  driver: 'Водитель',
  practitioner: 'Специалист',
  foreman: 'Прораб',
  manager: 'Менеджер',
};
const AFFECTED_LIMIT = 50;

type WithProfiles = Org & { workProfiles?: WorkProfileRow[] };

function profilesOf(org: Org): WorkProfileRow[] {
  const x = org as WithProfiles;
  x.workProfiles ??= org.members.flatMap((m) =>
    m.workProfiles.map((fn) => ({
      id: seedUuid(org.proto, `work:${m.proto}:${fn}`),
      memberId: m.id,
      function: fn,
      validFrom: SEED_FROM,
      validUntil: null,
      revision: 1,
    })),
  );
  return x.workProfiles;
}

const stateOf = (p: WorkProfileRow, now: string): S['WorkProfile']['state'] =>
  now < p.validFrom
    ? 'scheduled'
    : p.validUntil !== null && now >= p.validUntil
      ? 'ended'
      : 'active';

const dto = (p: WorkProfileRow, now: string): S['WorkProfile'] => ({
  id: p.id,
  function: p.function,
  validFrom: p.validFrom,
  validUntil: p.validUntil,
  state: stateOf(p, now),
  revision: p.revision,
});

/** Пересекаются ли полуинтервалы [from, until). */
const overlaps = (a: WorkProfileRow, from: string, until: string | null): boolean =>
  (until === null || a.validFrom < until) && (a.validUntil === null || from < a.validUntil);

/** Member.workProfiles — функции, действующие сейчас, в порядке появления. */
function project(org: Org, m: MemberRow, now: string): void {
  const active = profilesOf(org)
    .filter((p) => p.memberId === m.id && stateOf(p, now) === 'active')
    .map((p) => p.function);
  m.workProfiles = [...new Set(active)];
  org.policyVersion++;
}

const badUntil = (message: string): never =>
  fail('validation_failed', 'Проверьте срок функции.', {
    violations: [{ field: 'validUntil', code: 'range', message }],
  });

/** Цепочка предков подразделения (вместе с ним самим); null — верхний уровень. */
function ancestors(org: Org, id: string | null): Set<string> {
  const out = new Set<string>();
  let cur: UnitRow | undefined = id ? org.units.find((u) => u.id === id) : undefined;
  while (cur && !out.has(cur.id)) {
    out.add(cur.id);
    const parent = cur.parentId;
    cur = parent ? org.units.find((u) => u.id === parent) : undefined;
  }
  return out;
}

function unitOr404(ctx: HandlerContext): UnitRow {
  const { org } = ctx.org();
  const u = org.units.find((x) => x.id === ctx.params.orgUnitId?.toLowerCase());
  const allowed = unitsWith(ctx, 'org_units.manage');
  if (!u || (allowed !== 'all' && !allowed.has(u.id))) fail('not_found');
  return u;
}

export const peopleCardHandlers: Registry = {
  createMember: {
    messages: { orgUnitIds: 'Выберите хотя бы одно подразделение' },
    run: (ctx) => {
      const t = ctx.org();
      const b = ctx.body as S['MemberCreate'];
      requireUnits(ctx, b.orgUnitIds, 'orgUnitIds');
      const allowed = unitsWith(ctx, 'members.manage');
      if (allowed !== 'all' && !b.orgUnitIds.every((id) => allowed.has(id.toLowerCase()))) {
        fail('forbidden_action');
      }
      const row: MemberRow = {
        id: ctx.newId(),
        proto: `m-card-${ctx.s.seq}`,
        displayName: b.displayName.trim(),
        status: 'active',
        orgUnitIds: b.orgUnitIds.map((id) => id.toLowerCase()),
        revision: 1,
        workProfiles: [],
      };
      if (b.email) row.email = b.email;
      t.org.members.push(row);
      return { status: 201, body: memberDto(row) };
    },
  },

  listWorkProfiles: (ctx) => {
    const m = memberById(ctx, ctx.params.memberId ?? '');
    const now = ctx.now();
    const items = profilesOf(ctx.org().org)
      .filter((p) => p.memberId === m.id)
      .sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0))
      .map((p) => dto(p, now));
    const body: S['WorkProfileList'] = { memberId: m.id, items };
    return { body };
  },

  createWorkProfile: (ctx) => {
    const { org } = ctx.org();
    const m = memberById(ctx, ctx.params.memberId ?? '', 'members.manage');
    const b = ctx.body as S['WorkProfileCreate'];
    const until = b.validUntil ?? null;
    if (until !== null && until <= b.validFrom) badUntil('Окончание должно быть позже начала');
    const now = ctx.now();
    const mine = profilesOf(org).filter((p) => p.memberId === m.id && p.function === b.function);
    if (mine.some((p) => overlaps(p, b.validFrom, until))) {
      fail(
        'invalid_transition',
        `У сотрудника уже есть функция «${LABEL[b.function]}» в этот период.`,
      );
    }
    if (b.function === 'driver' && sodConflict(org, m, now, [], [...m.workProfiles, 'driver'])) {
      fail('separation_of_duties_conflict', SOD_TEXT);
    }
    const row: WorkProfileRow = {
      id: ctx.newId(),
      memberId: m.id,
      function: b.function,
      validFrom: b.validFrom,
      validUntil: until,
      revision: 1,
    };
    profilesOf(org).push(row);
    project(org, m, now);
    return { status: 201, body: dto(row, now) };
  },

  updateWorkProfile: (ctx) => {
    const { org } = ctx.org();
    const m = memberById(ctx, ctx.params.memberId ?? '', 'members.manage');
    const p = profilesOf(org).find(
      (x) => x.memberId === m.id && x.id === ctx.params.workProfileId?.toLowerCase(),
    );
    if (!p) fail('not_found');
    ctx.revision(p.revision);
    const now = ctx.now();
    if (stateOf(p, now) === 'ended') fail('invalid_transition', 'Период функции уже закончился.');
    const b = ctx.body as S['WorkProfilePatch'];
    if (b.validUntil <= p.validFrom) badUntil('Окончание должно быть позже начала');
    if (b.validUntil < now) badUntil('Окончание не может быть в прошлом');
    p.validUntil = b.validUntil;
    p.revision++;
    project(org, m, now);
    return { body: dto(p, now) };
  },

  previewOrgUnitMove: (ctx) => {
    const { org } = ctx.org();
    const unit = unitOr404(ctx);
    const parentId = uuidParam(ctx.query, 'parentId', false) ?? null;
    const moved = subtree(org, unit.id);
    if (parentId !== null && !org.units.some((u) => u.id === parentId)) {
      fail('validation_failed', 'Подразделение не найдено.', {
        violations: [{ field: 'parentId', code: 'unknown', message: 'Нет такого подразделения' }],
      });
    }
    // Право org_units.manage нужно и на старого, и на нового родителя; верхний уровень — вся организация.
    const manage = unitsWith(ctx, 'org_units.manage');
    const manages = (id: string | null) => manage === 'all' || (id !== null && manage.has(id));
    if (!manages(unit.parentId) || !manages(parentId)) fail('forbidden_action');
    if (parentId !== null && moved.has(parentId)) {
      fail('validation_failed', 'Нельзя перенести подразделение внутрь самого себя.', {
        violations: [
          {
            field: 'parentId',
            code: 'cycle',
            message: 'Подразделение не может стать потомком самого себя',
          },
        ],
      });
    }
    const before = ancestors(org, unit.parentId);
    const after = ancestors(org, parentId);
    const covering = (from: Set<string>, other: Set<string>) =>
      org.assignments.filter(
        (a) =>
          a.state === 'active' &&
          a.scope.kind === 'org_unit' &&
          a.scope.includeDescendants &&
          a.scope.resourceIds.some((id) => from.has(id) && !other.has(id)),
      );
    const losing = covering(before, after);
    const gaining = covering(after, before);
    // Люди вне области members.read действующего не раскрываются — только счёт в hiddenCount. Счёт — по людям
    // (memberId), а не по назначениям: число назначений человека вне области не раскрывается.
    const visible = unitsWith(ctx, 'members.read');
    const people: S['OrgUnitMoveImpact'][] = [];
    const hidden = new Set<string>();
    for (const [change, list] of [
      ['loses', losing],
      ['gains', gaining],
    ] as const) {
      for (const a of list) {
        for (const p of principalsOf(org, a)) {
          if (!memberIn(p, visible)) {
            hidden.add(p.id);
            continue;
          }
          people.push({
            memberId: p.id,
            displayName: p.displayName,
            change,
            roleId: a.roleId,
            assignmentId: a.id,
          });
        }
      }
    }
    const listed = people.slice(0, AFFECTED_LIMIT);
    const shown = new Set(listed.map((p) => p.memberId));
    const beyond = new Set(
      people.slice(AFFECTED_LIMIT).flatMap((p) => (shown.has(p.memberId) ? [] : [p.memberId])),
    );
    const body: S['OrgUnitMovePreview'] = {
      orgUnitId: unit.id,
      fromParentId: unit.parentId,
      toParentId: parentId,
      descendantUnitCount: moved.size - 1,
      memberCount: org.members.filter((m) => m.orgUnitIds.some((u) => moved.has(u))).length,
      assignmentsLosingScope: losing.length,
      assignmentsGainingScope: gaining.length,
      affectedPeople: listed,
      hiddenCount: hidden.size + beyond.size,
    };
    return { body };
  },
};
