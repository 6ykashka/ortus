// Оргструктура (W0.13): регионы и фирмы организации — listOrgUnits, createOrgUnit, getOrgUnit, updateOrgUnit.
// Видимость — по области права org_units.read, родитель вне неё не раскрывается (parentId: null, как сервер);
// перенос под своего потомка — 409 invalid_transition.
import type { components } from '@ortus/api-client';

import { unitDto } from '../core/dto.ts';
import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { UnitRow } from '../core/state.ts';
import { subtree, unitsWith } from './rules.ts';

type S = components['schemas'];

function unitOr404(ctx: HandlerContext, key = 'org_units.read'): UnitRow {
  const id = ctx.params.orgUnitId?.toLowerCase() ?? '';
  const u = ctx.org().org.units.find((x) => x.id === id);
  const units = unitsWith(ctx, key);
  if (!u || (units !== 'all' && !units.has(u.id))) fail('not_found');
  return u;
}

/**
 * Подразделение глазами участника запроса: родитель вне его области `org_units.read` не раскрывается даже по id —
 * такой узел приходит корнем видимого дерева (`parentId: null`), как у сервера (W1.05 `hideParents`, Q-W1.05-12,
 * Q-W2.53-5).
 */
function visibleDto(ctx: HandlerContext, u: UnitRow): S['OrgUnit'] {
  const units = unitsWith(ctx, 'org_units.read');
  const out = unitDto(u);
  if (out.parentId && units !== 'all' && !units.has(out.parentId)) out.parentId = null;
  return out;
}

function requireParent(ctx: HandlerContext, parentId: string | null): void {
  if (parentId && !ctx.org().org.units.some((u) => u.id === parentId.toLowerCase())) {
    fail('validation_failed', 'Родительское подразделение не найдено.', {
      violations: [{ field: 'parentId', code: 'unknown', message: 'Нет такого подразделения' }],
    });
  }
}

function requireUniqueName(
  ctx: HandlerContext,
  parentId: string | null,
  name: string,
  except?: string,
) {
  const taken = ctx
    .org()
    .org.units.some(
      (u) =>
        u.id !== except && u.parentId === parentId && u.name.toLowerCase() === name.toLowerCase(),
    );
  if (taken) {
    fail('validation_failed', 'Подразделение с таким названием уже есть.', {
      violations: [{ field: 'name', code: 'already_exists', message: 'Такое название уже есть' }],
    });
  }
}

export const unitsHandlers: Registry = {
  listOrgUnits: (ctx) => {
    const units = unitsWith(ctx, 'org_units.read');
    const items = ctx
      .org()
      .org.units.filter((u) => units === 'all' || units.has(u.id))
      .map((u) => visibleDto(ctx, u));
    return { body: page(items, ctx.query) };
  },

  createOrgUnit: {
    messages: { name: 'Укажите название' },
    run: (ctx) => {
      const org = ctx.org().org;
      const b = ctx.body as S['OrgUnitCreate'];
      const parentId = b.parentId?.toLowerCase() ?? null;
      requireParent(ctx, parentId);
      requireUniqueName(ctx, parentId, b.name.trim());
      const row: UnitRow = {
        id: ctx.newId(),
        proto: `u-new-${ctx.s.seq}`,
        parentId,
        name: b.name.trim(),
        kind: b.kind,
        status: 'active',
        revision: 1,
      };
      org.units.push(row);
      return { status: 201, body: unitDto(row) };
    },
  },

  getOrgUnit: (ctx) => ({ body: visibleDto(ctx, unitOr404(ctx)) }),

  updateOrgUnit: {
    messages: { name: 'Укажите название' },
    run: (ctx) => {
      const org = ctx.org().org;
      const u = unitOr404(ctx, 'org_units.manage');
      const b = ctx.body as S['OrgUnitPatch'];
      ctx.revision(u.revision);
      const parentId = b.parentId === undefined ? u.parentId : (b.parentId?.toLowerCase() ?? null);
      if (b.parentId !== undefined) {
        requireParent(ctx, parentId);
        if (parentId && subtree(org, u.id).has(parentId)) {
          fail('invalid_transition', 'Подразделение нельзя перенести внутрь самого себя.');
        }
      }
      if (b.name) requireUniqueName(ctx, parentId, b.name.trim(), u.id);
      if (b.status === 'archived' && u.status !== 'archived') {
        const busy =
          org.units.some((x) => x.parentId === u.id && x.status === 'active') ||
          org.members.some((m) => m.status !== 'suspended' && m.orgUnitIds.includes(u.id));
        if (busy)
          fail(
            'invalid_transition',
            'В подразделении есть участники или действующие подразделения.',
          );
      }
      u.parentId = parentId;
      if (b.name) u.name = b.name.trim();
      if (b.status) u.status = b.status;
      u.revision++;
      return { body: visibleDto(ctx, u) };
    },
  },
};
