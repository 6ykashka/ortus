// Выгрузка заданием с журналом сценарного сервера (W4.06, контракт 0.7.0-stage4; W4.50, 07-ux-and-data §3).
// Задание фиксирует спецификацию, подписи колонок, версию прав набора, пояс и автора; «воркер» сценарного сервера
// снимает строки в момент создания (snapshotAt = createdAt) и отдаёт задание готовым при первом чтении после него.
// Файл живёт 24 ч; при каждом скачивании права автора перепроверяются — сужение отзывает задание
// (permissions_changed). Журнал: свои задания, владелец — все. Ссылка на файл — подписанная ссылка хранилища mock
// (`https://storage.example.invalid/exports/<id>?expires=300&signature=<uuid>`, как presigned GET стенда): живёт
// 5 минут, без подписи, с чужой подписью и после срока — 403; GET отдаёт CSV с BOM.
import type { components } from '@ortus/api-client';

import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { Org, ScenarioState } from '../core/state.ts';
import { addMs, HOUR, MINUTE } from '../core/time.ts';
import { STORAGE_ORIGIN } from '../files/storage.ts';
import { datasetsFor } from './catalog.ts';
import { checkSpec, datasetOr404, exportCsv } from './index.ts';
import { viewsOf } from './views.ts';

type S = components['schemas'];

export interface JobRow {
  id: string;
  datasetId: string;
  datasetName: string;
  viewId?: string;
  state: S['DatasetExportJob']['state'];
  spec: S['DatasetExportCreate'];
  columnLabels: string[];
  timeZone: string;
  permissionVersion: string;
  rowLimit: number;
  rowCount: number;
  truncated: boolean;
  fileName: string;
  /** Размер файла с BOM (журнал хранит его и после удаления файла). */
  sizeBytes: number;
  /** CSV снимка (без BOM); после отзыва и истечения — пусто. */
  content?: string;
  revokeReason?: S['DatasetExportJob']['revokeReason'];
  requestedByMemberId: string;
  requestedByDisplayName: string;
  createdAt: string;
  finishedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  revision: number;
  /** Выданные ссылки на файл: подпись и срок (хранилище mock сверяет их при GET). */
  links?: { signature: string; expiresAt: string }[];
}

type WithExports = Org & { dataExports?: JobRow[] };

/** Предел строк задания (DatasetExportJob.rowLimit). */
export const JOB_ROW_LIMIT = 100_000;
/** Активных заданий участника не больше. */
const ACTIVE_LIMIT = 3;
/** Срок готового файла. */
const KEEP = 24 * HOUR;
/** Срок ссылки на файл. */
const LINK_TTL = 5 * MINUTE;
export const STORAGE_EXPORT_PATH = `${STORAGE_ORIGIN}/exports/:jobId`;

export const exportsOf = (org: Org): JobRow[] => ((org as WithExports).dataExports ??= []);

const bytes = (s: string): number => new TextEncoder().encode(`\uFEFF${s}`).length;

/** «Воркер»: очередь → готово в момент снимка; готово → истекло после expiresAt. */
function settle(job: JobRow, now: string): void {
  if (job.state === 'queued' && now >= job.createdAt) {
    job.state = 'ready';
    job.finishedAt = job.createdAt;
    job.expiresAt = addMs(job.createdAt, KEEP);
    job.revision++;
  }
  if (job.state === 'ready' && job.expiresAt && now >= job.expiresAt) {
    job.state = 'expired';
    delete job.content;
    job.revision++;
  }
}

export function jobDto(j: JobRow): S['DatasetExportJob'] {
  const done = j.state === 'ready' || j.state === 'expired' || j.finishedAt !== undefined;
  return {
    id: j.id,
    datasetId: j.datasetId,
    datasetName: j.datasetName,
    ...(j.viewId ? { viewId: j.viewId } : {}),
    state: j.state,
    spec: structuredClone(j.spec),
    columnLabels: [...j.columnLabels],
    timeZone: j.timeZone,
    ...(j.state !== 'queued' ? { snapshotAt: j.createdAt } : {}),
    rowLimit: j.rowLimit,
    ...(done
      ? {
          rowCount: j.rowCount,
          truncated: j.truncated,
          fileName: j.fileName,
          sizeBytes: j.sizeBytes,
        }
      : {}),
    ...(j.revokeReason ? { revokeReason: j.revokeReason } : {}),
    requestedByMemberId: j.requestedByMemberId,
    requestedByDisplayName: j.requestedByDisplayName,
    createdAt: j.createdAt,
    ...(j.state !== 'queued' ? { startedAt: j.createdAt } : {}),
    ...(j.finishedAt ? { finishedAt: j.finishedAt } : {}),
    ...(j.expiresAt ? { expiresAt: j.expiresAt } : {}),
    ...(j.revokedAt ? { revokedAt: j.revokedAt } : {}),
    revision: j.revision,
  };
}

/** Задание участника (владелец — любое задание журнала) или 404. */
function jobOr404(ctx: HandlerContext): JobRow {
  const t = ctx.org();
  const id = (ctx.params.exportJobId ?? '').toLowerCase();
  const j = exportsOf(t.org).find(
    (x) => x.id === id && (t.owner || x.requestedByMemberId === t.member?.id),
  );
  if (!j) return fail('not_found', 'Выгрузка не найдена.');
  settle(j, ctx.now());
  return j;
}

function revoke(j: JobRow, reason: NonNullable<JobRow['revokeReason']>, now: string): void {
  j.state = 'revoked';
  j.revokeReason = reason;
  j.revokedAt = now;
  delete j.content;
  j.revision++;
}

const STATES = new Set(['queued', 'running', 'ready', 'failed', 'expired', 'revoked']);

export const dataExportHandlers: Registry = {
  createDatasetExportJob: (ctx) => {
    const def = datasetOr404(ctx);
    const ds = def.dataset;
    if (!ds.exportAllowed) fail('forbidden_action');
    const t = ctx.org();
    const member = t.member ?? fail('forbidden_action');
    const body = ctx.body as S['DatasetExportJobCreate'];
    const spec: S['DatasetExportCreate'] = {
      select: [...body.select],
      filters: structuredClone(body.filters),
      ...(body.search !== undefined ? { search: body.search } : {}),
      sort: structuredClone(body.sort),
    };
    checkSpec(ds, spec);
    if (body.viewId) {
      const id = body.viewId.toLowerCase();
      const v = viewsOf(t.org).find(
        (x) =>
          x.id === id &&
          x.datasetId === ds.id &&
          (x.visibility === 'shared' || x.ownerMemberId === member.id),
      );
      if (!v) fail('not_found', 'Вид не найден.');
    }
    const now = ctx.now();
    const all = exportsOf(t.org);
    // Активные — ещё не прочитанные после снимка (очередь сценарного сервера двигает чтение задания).
    const active = all.filter(
      (j) => j.requestedByMemberId === member.id && (j.state === 'queued' || j.state === 'running'),
    );
    if (active.length >= ACTIVE_LIMIT) {
      fail('rate_limited', 'Дождитесь завершения начатых выгрузок.');
    }
    const csv = exportCsv(def, spec, JOB_ROW_LIMIT, now);
    const job: JobRow = {
      id: ctx.newId(),
      datasetId: ds.id,
      datasetName: ds.name,
      ...(body.viewId ? { viewId: body.viewId.toLowerCase() } : {}),
      state: 'queued',
      spec,
      columnLabels: csv.labels,
      timeZone: 'Europe/Moscow',
      permissionVersion: ds.permissionVersion,
      rowLimit: JOB_ROW_LIMIT,
      rowCount: csv.rowCount,
      truncated: csv.truncated,
      fileName: csv.fileName,
      sizeBytes: bytes(csv.content),
      content: csv.content,
      requestedByMemberId: member.id,
      requestedByDisplayName: member.displayName,
      createdAt: now,
      revision: 1,
    };
    all.push(job);
    return { status: 202, body: jobDto(job) };
  },

  listDatasetExportJobs: (ctx) => {
    const t = ctx.org();
    const datasetId = ctx.query.get('datasetId');
    const states = ctx.query.getAll('state');
    if (states.some((s) => !STATES.has(s))) fail('malformed_request', 'Неизвестное состояние.');
    const now = ctx.now();
    const items = exportsOf(t.org)
      .filter((j) => t.owner || j.requestedByMemberId === t.member?.id)
      .map((j) => {
        settle(j, now);
        return j;
      })
      .filter((j) => !datasetId || j.datasetId === datasetId)
      .filter((j) => !states.length || states.includes(j.state))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map(jobDto);
    return { body: page(items, ctx.query) };
  },

  getDatasetExportJob: (ctx) => ({ body: jobDto(jobOr404(ctx)) }),

  getDatasetExportDownload: (ctx) => {
    const t = ctx.org();
    const j = jobOr404(ctx);
    if (j.requestedByMemberId !== t.member?.id) fail('not_found', 'Выгрузка не найдена.');
    if (j.state === 'queued' || j.state === 'running') {
      fail('invalid_transition', 'Выгрузка ещё не готова.');
    }
    if (j.state !== 'ready') {
      fail('invalid_transition', 'Выгрузка недоступна: срок хранения истёк или её отозвали.');
    }
    const ds = datasetsFor(ctx).find((d) => d.dataset.id === j.datasetId)?.dataset;
    const visible = new Set(ds?.fields.map((f) => f.key));
    const narrowed =
      !ds ||
      !ds.exportAllowed ||
      ds.permissionVersion !== j.permissionVersion ||
      j.spec.select.some((k) => !visible.has(k));
    if (narrowed) {
      revoke(j, 'permissions_changed', ctx.now());
      fail('invalid_transition', 'Права изменились — выгрузка отозвана. Запустите её снова.');
    }
    const link = { signature: ctx.newId(), expiresAt: addMs(ctx.now(), LINK_TTL) };
    j.links = [...(j.links ?? []).filter((l) => l.expiresAt > ctx.now()), link];
    const body: S['DatasetExportDownload'] = {
      exportJobId: j.id,
      downloadUrl: `${STORAGE_ORIGIN}/exports/${j.id}?expires=${LINK_TTL / 1000}&signature=${link.signature}`,
      expiresAt: link.expiresAt,
      fileName: j.fileName,
      contentType: 'text/csv; charset=utf-8',
      sizeBytes: j.sizeBytes,
    };
    return { body };
  },

  revokeDatasetExportJob: (ctx) => {
    const t = ctx.org();
    const j = jobOr404(ctx);
    ctx.revision(j.revision);
    if (j.state === 'failed' || j.state === 'expired' || j.state === 'revoked') {
      fail('invalid_transition', 'Выгрузка уже завершена.');
    }
    revoke(j, j.requestedByMemberId === t.member?.id ? 'author' : 'owner', ctx.now());
    return { body: jobDto(j) };
  },
};

/**
 * GET файла выгрузки из хранилища mock: CSV с BOM готового задания. Подписи нет, она чужая или ссылка старше 5 минут —
 * 403 (S3 AccessDenied, «Request has expired»); задания нет или файл удалён — 404 (NoSuchKey).
 */
export function getExportObject(
  s: ScenarioState,
  jobId: string,
  signature: string | null,
  now: string,
): Response {
  const id = jobId.toLowerCase();
  for (const org of Object.values(s.orgs)) {
    const j = exportsOf(org).find((x) => x.id === id);
    if (!j) continue;
    const link = j.links?.find((l) => l.signature === signature?.toLowerCase());
    if (!link || now >= link.expiresAt) return new Response(null, { status: 403 });
    settle(j, now);
    if (j.state !== 'ready' || j.content === undefined) break;
    return new Response(`\uFEFF${j.content}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(j.fileName)}`,
      },
    });
  }
  return new Response(null, { status: 404 });
}
