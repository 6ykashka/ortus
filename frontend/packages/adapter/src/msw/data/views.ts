// Сохранённые виды «Данных» сценарного сервера (W4.06, контракт 0.7.0-stage4; W4.50, DATA-03): вид — спецификация
// выборки набора (колонки, фильтры, поиск, сортировка), не строки. Личный вид видит и меняет только автор («Вид
// сохранён · личный» эталона, dataVM :4210); общий видят все, кто строит выборки набора, публикует и меняет его автор
// с правом выгрузки или владелец. Поля, скрытые правами смотрящего, вырезаются из вида (hiddenFieldLabels).
import type { components } from '@ortus/api-client';

import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { Org } from '../core/state.ts';
import type { DatasetDef } from './catalog.ts';
import { checkSpec, datasetOr404 } from './index.ts';

type S = components['schemas'];

export interface ViewRow {
  id: string;
  datasetId: string;
  name: string;
  visibility: S['DatasetView']['visibility'];
  ownerMemberId: string;
  ownerDisplayName: string;
  query: S['DatasetViewQuery'];
  /** Подписи полей вида на момент сохранения — для hiddenFieldLabels смотрящего без права поля. */
  fieldLabels: Record<string, string>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

type WithViews = Org & { dataViews?: ViewRow[] };

/** Предел личных видов участника в наборе. */
const PERSONAL_LIMIT = 50;

export const viewsOf = (org: Org): ViewRow[] => ((org as WithViews).dataViews ??= []);

const keysOf = (q: S['DatasetViewQuery']): string[] => [
  ...(q.select ?? []),
  ...q.filters.map((f) => f.fieldKey),
  ...q.sort.map((s) => s.fieldKey),
];

/** Вид глазами смотрящего: части по полям, которых у него нет, вырезаны, их подписи — в hiddenFieldLabels. */
export function viewDto(v: ViewRow, ds: S['Dataset']): S['DatasetView'] {
  const visible = new Set(ds.fields.map((f) => f.key));
  const hidden = [...new Set(keysOf(v.query).filter((k) => !visible.has(k)))];
  const select = v.query.select?.filter((k) => visible.has(k));
  const query: S['DatasetViewQuery'] = {
    ...(select?.length ? { select } : {}),
    filters: v.query.filters.filter((f) => visible.has(f.fieldKey)),
    ...(v.query.search !== undefined ? { search: v.query.search } : {}),
    sort: v.query.sort.filter((s) => visible.has(s.fieldKey)),
  };
  return {
    id: v.id,
    datasetId: v.datasetId,
    name: v.name,
    visibility: v.visibility,
    ownerMemberId: v.ownerMemberId,
    ownerDisplayName: v.ownerDisplayName,
    query,
    ...(hidden.length ? { hiddenFieldLabels: hidden.map((k) => v.fieldLabels[k] ?? k) } : {}),
    revision: v.revision,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

const me = (ctx: HandlerContext) => {
  const m = ctx.org().member;
  if (!m) return fail('forbidden_action');
  return m;
};

/** Виды набора, которые видит участник: свои личные и общие. */
const visibleViews = (ctx: HandlerContext, def: DatasetDef): ViewRow[] =>
  viewsOf(ctx.org().org).filter(
    (v) =>
      v.datasetId === def.dataset.id &&
      (v.visibility === 'shared' || v.ownerMemberId === ctx.org().member?.id),
  );

/** Публиковать и менять общий вид: право выгрузки набора или владелец. */
const mayShare = (ctx: HandlerContext, def: DatasetDef): boolean =>
  ctx.org().owner || def.dataset.exportAllowed === true;

function invalid(field: string, code: string, message: string): never {
  return fail('validation_failed', message, { violations: [{ field, code, message }] });
}

function checkName(
  ctx: HandlerContext,
  def: DatasetDef,
  name: string,
  visibility: ViewRow['visibility'],
  self?: ViewRow,
): string {
  const n = name.trim();
  if (!n) invalid('name', 'required', 'Укажите название вида.');
  const memberId = ctx.org().member?.id;
  const taken = viewsOf(ctx.org().org).some(
    (v) =>
      v !== self &&
      v.datasetId === def.dataset.id &&
      v.visibility === visibility &&
      (visibility === 'shared' || v.ownerMemberId === memberId) &&
      v.name.toLowerCase() === n.toLowerCase(),
  );
  if (taken) invalid('name', 'taken', 'Вид с таким именем уже есть.');
  return n;
}

const labelsOf = (ds: S['Dataset'], q: S['DatasetViewQuery']): Record<string, string> =>
  Object.fromEntries(
    keysOf(q).map((k) => [k, ds.fields.find((f) => f.key === k)?.label ?? k] as const),
  );

function viewOr404(ctx: HandlerContext, def: DatasetDef): ViewRow {
  const id = (ctx.params.viewId ?? '').toLowerCase();
  const v = visibleViews(ctx, def).find((x) => x.id === id);
  if (!v) return fail('not_found', 'Вид не найден.');
  return v;
}

/** Правка общего вида — автор с правом выгрузки или владелец; личного — только автор (иначе он не виден). */
function checkEdit(ctx: HandlerContext, def: DatasetDef, v: ViewRow): void {
  if (v.visibility !== 'shared') return;
  const t = ctx.org();
  if (!t.owner && (v.ownerMemberId !== t.member?.id || !mayShare(ctx, def))) {
    fail('forbidden_action');
  }
}

export const dataViewHandlers: Registry = {
  listDatasetViews: (ctx) => {
    const def = datasetOr404(ctx);
    const items = visibleViews(ctx, def)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id))
      .map((v) => viewDto(v, def.dataset));
    return { body: { items } };
  },

  createDatasetView: (ctx) => {
    const def = datasetOr404(ctx);
    const member = me(ctx);
    const body = ctx.body as S['DatasetViewCreate'];
    const visibility = body.visibility ?? 'personal';
    if (visibility === 'shared' && !mayShare(ctx, def)) fail('forbidden_action');
    checkSpec(def.dataset, body.query);
    const name = checkName(ctx, def, body.name, visibility);
    const own = viewsOf(ctx.org().org).filter(
      (v) =>
        v.datasetId === def.dataset.id &&
        v.visibility === 'personal' &&
        v.ownerMemberId === member.id,
    );
    if (visibility === 'personal' && own.length >= PERSONAL_LIMIT) {
      invalid('name', 'too_many', 'Не больше 50 личных видов набора.');
    }
    const now = ctx.now();
    const row: ViewRow = {
      id: ctx.newId(),
      datasetId: def.dataset.id,
      name,
      visibility,
      ownerMemberId: member.id,
      ownerDisplayName: member.displayName,
      query: structuredClone(body.query),
      fieldLabels: labelsOf(def.dataset, body.query),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    viewsOf(ctx.org().org).push(row);
    return { status: 201, body: viewDto(row, def.dataset) };
  },

  updateDatasetView: (ctx) => {
    const def = datasetOr404(ctx);
    const v = viewOr404(ctx, def);
    checkEdit(ctx, def, v);
    ctx.revision(v.revision);
    const patch = ctx.body as S['DatasetViewPatch'];
    const visibility = patch.visibility ?? v.visibility;
    if (visibility === 'shared' && v.visibility !== 'shared' && !mayShare(ctx, def)) {
      fail('forbidden_action');
    }
    if (patch.query) checkSpec(def.dataset, patch.query);
    const name =
      patch.name !== undefined || visibility !== v.visibility
        ? checkName(ctx, def, patch.name ?? v.name, visibility, v)
        : v.name;
    v.name = name;
    v.visibility = visibility;
    if (patch.query) {
      v.query = structuredClone(patch.query);
      v.fieldLabels = labelsOf(def.dataset, patch.query);
    }
    v.revision++;
    v.updatedAt = ctx.now();
    return { body: viewDto(v, def.dataset) };
  },

  deleteDatasetView: (ctx) => {
    const def = datasetOr404(ctx);
    const v = viewOr404(ctx, def);
    checkEdit(ctx, def, v);
    ctx.revision(v.revision);
    const all = viewsOf(ctx.org().org);
    all.splice(all.indexOf(v), 1);
    return { status: 204 };
  },
};
