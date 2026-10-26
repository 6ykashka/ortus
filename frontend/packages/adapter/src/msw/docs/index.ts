// Тег Docs и PublicDocs сценарного сервера (W7.00, контрактный PR этапа 7): 45 операций «Документов» и 2 публичных —
// список и карточка, папки, версии, комментарии, доступ с влиянием, внешние ссылки, задания, распознавание, маршрут с
// подписью и ознакомлением, шаблоны; callback сервера документов (эталон «Документы.dc.html», design-2026-10-19;
// docs/24; D-31 комплекта, D-32 комплекта). Операций правки блоков нет: правку ведёт движок (Q-W4.00-documents-1). Недоступный документ
// неотличим от отсутствующего: 404 «Документ недоступен»; финансовый — 403 function_blocked «Водителю».
import type { components } from '@ortus/api-client';

import { seedUuid } from '@ortus/domain/seed';

import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import {
  ackPeople,
  chainOf,
  type Comment,
  type Doc,
  type DocsCtx,
  docLevel,
  documentDto,
  docOr404,
  docsCtx,
  docsOf,
  type Entry,
  entryDto,
  entryInput,
  folderDto,
  folderLevel,
  isFinance,
  jobDto,
  type Job,
  LV,
  levelKey,
  locked,
  registerDocsKeys,
  routeDto,
  type Route,
  type Rules,
  shaOf,
  type Step,
  summaryDto,
  verbsOf,
  type Version,
  waitsOf,
  type Level,
} from './state.ts';

registerDocsKeys();

type S = components['schemas'];

const body = <T>(ctx: HandlerContext): T => ctx.body as T;

function invalid(field: string, message: string, code = 'invalid'): never {
  return fail('validation_failed', message, { violations: [{ field, code, message }] });
}

const TEMPLATES: readonly {
  id: string;
  name: string;
  kind: 'text' | 'sheet' | 'pdf';
  icon: string;
  hint: string;
  link: 'trip' | 'object' | null;
  folder: string;
  fields: { key: string; src?: string }[];
}[] = [
  {
    id: 'tpl-order',
    name: 'Приказ по фирме',
    kind: 'text',
    icon: 'gavel',
    hint: 'Номер, тема, пункты. Маршрут папки «Приказы»: согласовать → утвердить → ознакомить',
    link: null,
    folder: 'fd-log-ord',
    fields: [{ key: 'Фирма', src: 'unit' }],
  },
  {
    id: 'tpl-poa',
    name: 'Доверенность на получение груза',
    kind: 'text',
    icon: 'badge',
    hint: 'Поля из рейса: водитель, машина, рейс',
    link: 'trip',
    folder: 'fd-log-ctr',
    fields: [
      { key: 'Водитель', src: 'trip.driver' },
      { key: 'Рейс', src: 'trip.number' },
    ],
  },
  {
    id: 'tpl-contract',
    name: 'Договор подряда',
    kind: 'text',
    icon: 'handshake',
    hint: 'Поля из объекта: заказчик, адрес, площадь, цена по смете',
    link: 'object',
    folder: 'fd-o42',
    fields: [
      { key: 'Заказчик', src: 'obj.client' },
      { key: 'Адрес объекта', src: 'obj.address' },
    ],
  },
];

const DAY = 86_400_000;
const addDays = (iso: string, n: number): string => new Date(Date.parse(iso) + n * DAY).toISOString();
const today = (x: DocsCtx): string => x.now.slice(0, 10);

function log(x: DocsCtx, d: Doc, action: string, details: string): void {
  d.activity.unshift({ id: x.newId('da-'), at: x.now, by: x.me, action, details });
}

function touch(x: DocsCtx, d: Doc): void {
  d.updatedAt = x.now;
  d.updatedBy = x.me;
  d.revision += 1;
}

function newVersion(x: DocsCtx, d: Doc, source: Version['source'], o: Partial<Version> = {}): Version {
  d.version += 1;
  const v: Version = {
    v: d.version,
    at: x.now,
    by: [x.me],
    name: null,
    source,
    size: d.size,
    forcesave: false,
    base: null,
    ...o,
  };
  d.versions.push(v);
  if (!d.authors.includes(x.me)) d.authors.push(x.me);
  touch(x, d);
  return v;
}

const asLevel = (e: Entry['level'] | undefined): Level => (e ? ((LV[e] ?? 0) as Level) : 0);

/** Влияние на доступ: уровни всех незаблокированных сотрудников до и после изменения (diffAccess). */
function impactOf(x: DocsCtx, d: Doc, mutate: () => void): S['DocAccessImpact'] {
  const people = x.org.members.filter((m) => m.status !== 'suspended');
  const before = new Map(people.map((m) => [m.proto, docLevel(x, m.proto, d).L]));
  const snapshot = { folder: d.folder, mode: d.mode, share: d.share };
  mutate();
  const after = new Map(people.map((m) => [m.proto, docLevel(x, m.proto, d).L]));
  Object.assign(d, snapshot);
  const out: S['DocAccessImpact'] = { gain: [], lose: [], up: [], down: [] };
  for (const m of people) {
    const a = before.get(m.proto) ?? 0;
    const b = after.get(m.proto) ?? 0;
    if (a === b) continue;
    const row: S['DocImpactPerson'] = {
      member: { memberId: x.U(m.proto), displayName: m.displayName },
      from: levelKey(a),
      to: levelKey(b),
      invited: m.status === 'invited',
    };
    (a === 0 ? out.gain : b === 0 ? out.lose : b > a ? out.up : out.down).push(row);
  }
  return out;
}

const templateOf = (x: DocsCtx, uuid: string | undefined) => TEMPLATES.find((t) => x.U(t.id) === uuid);

function folderOr404(x: DocsCtx, id: string | undefined, need: Level = 1): ReturnType<typeof chainOf>[number] {
  const proto = x.P(id);
  const f = x.d.folders.find((y) => y.id === proto);
  if (!f) return fail('not_found', 'Папка не найдена');
  const L = folderLevel(x, x.me, f.id);
  if (!L) return fail('not_found', 'Папка не найдена');
  if (L < need) return fail('forbidden_action', `Нет права добавлять в «${f.name}»`);
  return f;
}

const commentDto = (x: DocsCtx, c: Comment): S['DocComment'] => {
  const out: S['DocComment'] = {
    id: x.U(c.id),
    author: { memberId: x.U(c.by), displayName: x.name(c.by) },
    createdAt: c.at,
    text: c.text,
    anchor: { kind: c.anchor.kind, ref: c.anchor.ref, ...(c.anchor.quote ? { quote: c.anchor.quote } : {}) },
    replies: c.replies.map((r) => ({
      id: x.U(r.id),
      author: { memberId: x.U(r.by), displayName: x.name(r.by) },
      at: r.at,
      text: r.text,
      ...(r.mention ? { mention: { memberId: x.U(r.mention), displayName: x.name(r.mention) } } : {}),
    })),
    resolved: c.resolved,
  };
  if (c.mention) out.mention = { memberId: x.U(c.mention), displayName: x.name(c.mention) };
  if (c.resolvedBy) out.resolvedBy = { memberId: x.U(c.resolvedBy), displayName: x.name(c.resolvedBy) };
  return out;
};

const versionDto = (x: DocsCtx, d: Doc, v: Version): S['DocVersion'] => {
  const out: S['DocVersion'] = {
    version: v.v,
    createdAt: v.at,
    authors: v.by.map((m) => ({ memberId: x.U(m), displayName: x.name(m) })),
    source: v.source,
    fileId: x.U(`${d.id}.v${v.v}`),
    sizeBytes: v.size,
    sha256: shaOf({ id: d.id, version: v.v }),
    forcesave: v.forcesave,
  };
  if (v.name) out.name = v.name;
  if (v.base) out.base = v.base;
  return out;
};

const sharesDto = (x: DocsCtx, d: Pick<Doc, 'mode' | 'share' | 'shareRev'>): S['DocShares'] => ({
  mode: d.mode,
  entries: d.share.map((e) => entryDto(x, e)),
  revision: d.shareRev,
});

/** Права на выдачу: не выше своего уровня (maxGrant = min(L, 4)). */
function checkGrant(x: DocsCtx, d: Doc | { share: Entry[] }, entries: Entry[], L: Level): void {
  const max = Math.min(L, 4);
  for (const e of entries) {
    if (asLevel(e.level) > max) {
      return fail('delegation_exceeds_grant', `Нельзя выдать «${e.level}»: это выше вашего уровня`);
    }
  }
  void d;
}

function linkDto(x: DocsCtx, l: Doc['ext'][number]): S['DocExternalLink'] {
  const expired = l.status === 'active' && Date.parse(l.expiresAt) < Date.parse(x.now);
  return {
    id: x.U(l.id),
    level: l.level,
    expiresAt: l.expiresAt,
    pin: !!l.pin,
    watermark: l.watermark,
    download: l.download,
    status: expired ? 'expired' : l.status,
    createdBy: { memberId: x.U(l.by), displayName: x.name(l.by) },
    createdAt: l.at,
    openCount: l.opens.length,
    lastOpenedAt: l.opens.at(-1) ?? null,
  };
}

/** Ключ версии для сервера документов: тенант, документ, версия (по нему адаптер находит БД тенанта без сессии). */
const VERSION_KEY =
  /^t([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.d([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.v([1-9][0-9]{0,9})$/;
const versionKey = (tenantId: string, docUuid: string, version: number): string =>
  `t${tenantId}.d${docUuid}.v${version}`;

function sessionConfig(x: DocsCtx, d: Doc, mode: string, onlyV: number | null): S['DocSessionConfig'] {
  const my = documentDto(x, d).my;
  const canEdit = my.can.edit;
  const version = onlyV ?? d.version;
  return {
    engine: 'none',
    editorAvailable: false,
    mode: (mode === 'edit' && !canEdit ? 'view' : mode) as S['DocSessionConfig']['mode'],
    documentKey: versionKey(x.org.tenantId, x.U(d.id), version),
    version,
    fileUrl: `https://files.ortus.invalid/docs/${x.U(d.id)}/v${version}`,
    user: { memberId: x.U(x.me), displayName: x.name(x.me) },
    permissions: {
      edit: false,
      review: false,
      comment: my.can.comment,
      download: my.can.export,
      print: my.can.export,
      fillForms: false,
      protectedRanges: d.ranges.length > 0,
    },
    protectedRanges: d.ranges.map((r) => ({ id: r.id, sheet: r.sheet, range: r.range, name: r.name, who: r.who.map((e) => entryDto(x, e)) })),
    hint: 'Редактор подключается',
    expiresAt: new Date(Date.parse(x.now) + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

// ---------------------------------------------------------------------------------------------
// Маршрут

function stepFromInput(x: DocsCtx, s: S['DocRouteStepInput'], n: number): Step {
  const who = (s.whoMemberIds ?? []).map((id) => x.P(id) ?? invalid('steps', 'Участник шага не найден'));
  const step: Step = {
    kind: s.kind,
    name: s.name ?? (s.kind === 'approve' ? 'Согласовать' : s.kind === 'sign' ? 'Утвердить' : s.kind === 'ack' ? 'Ознакомить' : 'Подпись заказчика'),
    mode: s.mode ?? 'all',
    who,
    audience: (s.audience ?? []).map((e) => entryInput(x, e)),
    days: s.days,
    status: n === 0 ? 'active' : 'wait',
    due: null,
    decisions: [],
    done: [],
  };
  if (s.kind === 'external') {
    step.external = { name: s.externalName ?? 'Заказчик', ...(s.externalPhone ? { phone: s.externalPhone.replace(/\d(?=\d{2})/g, '•') } : {}) };
  }
  return step;
}

const WORKDAYS = (iso: string, n: number): string => addDays(iso, Math.max(1, n)).slice(0, 10);

function activate(x: DocsCtx, d: Doc, r: Route, idx: number): void {
  const s = r.steps[idx];
  if (!s) return;
  s.status = 'active';
  s.due = WORKDAYS(x.now, s.days);
  r.cur = idx;
  if (s.kind === 'approve' || s.kind === 'sign') {
    for (const w of s.who) {
      if (!docLevel(x, w, d).L) d.tmp.push({ member: w, level: 'comment', why: `Шаг «${s.name}»`, onlyVersion: d.version });
    }
  }
  if (s.kind === 'ack') {
    for (const w of ackPeople(x, s)) {
      if (!docLevel(x, w, d).L) d.tmp.push({ member: w, level: 'view', why: 'Ознакомление', onlyVersion: d.version, keep: true });
    }
  }
}

function advance(x: DocsCtx, d: Doc, r: Route): void {
  const cur = r.steps[r.cur] as Step;
  cur.status = 'done';
  const next = r.cur + 1;
  if (next < r.steps.length) {
    activate(x, d, r, next);
    return;
  }
  r.status = 'done';
  const hasSign = r.steps.some((s) => s.kind === 'sign' || s.kind === 'external');
  d.status = hasSign ? 'signed' : 'approved';
  d.tmp = d.tmp.filter((g) => g.keep);
  log(x, d, d.status === 'signed' ? 'docs.signed' : 'docs.approved', 'Маршрут завершён');
}

const routeOr404 = (d: Doc): Route => {
  if (!d.route) return fail('not_found', 'У документа нет маршрута');
  return d.route;
};

function myStep(x: DocsCtx, r: Route): Step {
  const s = r.steps[r.cur] as Step;
  return s;
}

function jobOr404(x: DocsCtx, uuid: string | undefined): Job {
  const id = x.P(uuid);
  const j = x.d.jobs.find((y) => y.id === id);
  if (!j) return fail('not_found', 'Задание не найдено');
  return j;
}

function applyJob(x: DocsCtx, j: Job): void {
  if (j.applied || j.status === 'failed') return;
  j.applied = true;
  const docs = j.docIds.map((id) => x.d.docs.find((d) => d.id === id)).filter((d): d is Doc => !!d);
  const first = docs[0];
  if (j.op === 'ocr' && first) {
    first.ocr = { status: 'done', confidence: 0.9, at: x.now, lang: 'rus' };
    first.words = [{ id: x.newId('w'), text: 'Накладнаяя', sug: 'Накладная', conf: 0.6, why: 'Лишний знак', st: 'doubtful' }];
    newVersion(x, first, 'ocr');
  } else if (j.op === 'pdfa' && first) {
    first.pdfaCopy = true;
  } else if (['merge', 'to_docx', 'to_xlsx', 'to_pdf', 'convert', 'split', 'compress'].includes(j.op) && first) {
    const id = x.newId('doc-');
    const kind = j.op === 'to_docx' ? 'text' : j.op === 'to_xlsx' ? 'sheet' : 'pdf';
    x.d.docs.push({
      ...structuredClone(first),
      id,
      kind,
      title: j.op === 'merge' ? `Объединённый документ (${docs.length})` : `${first.title} · ${j.op}`,
      owner: x.me,
      status: 'draft',
      version: 1,
      versions: [{ v: 1, at: x.now, by: [x.me], name: null, source: j.op === 'merge' ? 'merge' : 'convert', size: first.size, forcesave: false, base: null }],
      comments: [],
      route: undefined,
      tmp: [],
      jobs: [],
      share: [],
      ext: [],
      words: [],
      activity: [{ id: x.newId('da-'), at: x.now, by: x.me, action: 'docs.created', details: `Результат задания «${j.name}»` }],
      createdAt: x.now,
      updatedAt: x.now,
      updatedBy: x.me,
      revision: 1,
      shareRev: 1,
    });
    j.resultId = id;
  }
  j.status = 'done';
  j.finishedAt = x.now;
}

const JOB_NAME: Readonly<Record<string, string>> = {
  convert: 'Преобразование',
  ocr: 'Распознавание',
  merge: 'Объединение',
  split: 'Разделение',
  compress: 'Сжатие',
  pdfa: 'PDF/A',
  to_docx: 'В Word',
  to_xlsx: 'В Excel',
  to_pdf: 'В PDF',
};

export const docsHandlers: Registry = {
  listDocuments: (ctx) => {
    const x = docsCtx(ctx);
    const visible = x.d.docs.filter((d) => docLevel(x, x.me, d).L >= 1);
    const active = visible.filter((d) => d.status !== 'archived');
    const onRoute = (d: Doc): boolean => d.status === 'in_route' || waitsOf(x, d, x.me).length > 0;
    const counts = {
      all: active.length,
      mine: active.filter((d) => d.owner === x.me).length,
      shared: active.filter((d) => d.owner !== x.me).length,
      route: active.filter(onRoute).length,
    };
    const filter = ctx.query.get('filter') ?? 'all';
    const q = (ctx.query.get('q') ?? '').trim().toLowerCase();
    const folder = x.P(ctx.query.get('folderId') ?? undefined);
    const inTree = (d: Doc): boolean => !folder || chainOf(x, d.folder).some((f) => f.id === folder);
    const items = visible
      .filter((d) =>
        filter === 'archive'
          ? d.status === 'archived'
          : d.status !== 'archived' &&
            (filter === 'all' ||
              (filter === 'mine' && d.owner === x.me) ||
              (filter === 'shared' && d.owner !== x.me) ||
              (filter === 'route' && onRoute(d))),
      )
      .filter(inTree)
      .filter((d) => !q || `${d.title} ${d.words.map((w) => w.text).join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((d) => summaryDto(x, d));
    return { body: { ...page(items, ctx.query), counts } };
  },

  createDocument: (ctx) => {
    const x = docsCtx(ctx);
    const b = body<S['DocCreate']>(ctx);
    const title = b.title.trim();
    if (title.length < 2) return invalid('title', 'Название — не короче 2 символов', 'too_short');
    const folder = x.d.folders.find((f) => f.id === x.P(b.folderId));
    if (!folder) return invalid('folderId', 'Выберите папку');
    const tpl = b.templateId ? templateOf(x, b.templateId) : undefined;
    if (b.templateId && !tpl) return invalid('templateId', 'Шаблон не найден');
    if (tpl?.link && !b.link) return invalid('link', 'Выберите рейс / объект для полей шаблона');
    if (b.kind === 'pdf' && !b.fileIds?.length && !tpl && !b.scan) return invalid('fileIds', 'Добавьте файлы или фото');
    if (folderLevel(x, x.me, folder.id) < 4) return fail('forbidden_action', `Нет права создавать документы в папке «${folder.name}»`);
    const id = x.newId('doc-');
    const pdn = b.sensitivity === 'pdn';
    const d: Doc = {
      id,
      kind: b.kind,
      title,
      folder: folder.id,
      owner: x.me,
      status: 'draft',
      sensitivity: b.sensitivity ?? 'normal',
      mode: 'inherit',
      share: [],
      links: b.link ? [{ module: b.link.moduleKey, type: b.link.entityType, id: x.P(b.link.entityId) ?? b.link.entityId }] : [],
      version: 1,
      versions: [{ v: 1, at: x.now, by: [x.me], name: null, source: b.fileIds?.length || b.scan ? 'upload' : 'edit', size: 48_000, forcesave: false, base: null }],
      comments: [],
      fields: (tpl?.fields ?? []).map((f) => ({ key: f.key, ...(f.src ? { src: f.src } : {}) })),
      tmp: [],
      jobs: [],
      words: [],
      scan: !!b.scan,
      pdfaCopy: false,
      template: tpl?.name ?? null,
      size: 48_000,
      createdAt: x.now,
      updatedAt: x.now,
      updatedBy: x.me,
      authors: [x.me],
      ranges: [],
      ext: [],
      activity: [{ id: x.newId('da-'), at: x.now, by: x.me, action: 'docs.created', details: 'Документ создан' }],
      revision: 1,
      shareRev: 1,
    };
    if (b.scan && !pdn) {
      d.ocr = { status: 'queued' };
      const job: Job = { id: x.newId('dj-'), op: 'ocr', docIds: [id], name: JOB_NAME.ocr as string, status: 'queued', resultId: null, at: x.now, finishedAt: null, applied: false };
      x.d.jobs.push(job);
      d.jobs.push(job.id);
    }
    x.d.docs.push(d);
    return { status: 201, body: documentDto(x, d) };
  },

  getDocument: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    return { body: documentDto(x, d), etag: d.revision };
  },

  updateDocument: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    ctx.revision(d.revision);
    if (locked(d)) return fail('document_locked', 'Документ на согласовании — править нельзя');
    const b = body<S['DocPatch']>(ctx);
    if (b.title !== undefined) {
      if (b.title.trim().length < 2) return invalid('title', 'Название — не короче 2 символов', 'too_short');
      d.title = b.title.trim();
    }
    if (b.sensitivity) {
      d.sensitivity = b.sensitivity;
      if (b.sensitivity === 'pdn') {
        d.ocr = { status: 'none' };
        d.words = [];
      }
    }
    touch(x, d);
    log(x, d, 'docs.updated', 'Свойства документа изменены');
    return { body: documentDto(x, d), etag: d.revision };
  },

  moveDocument: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    const b = body<S['DocMove']>(ctx);
    if (locked(d)) return fail('document_locked', 'Документ на согласовании — переносить нельзя');
    const target = folderOr404(x, b.folderId, 4);
    if (target.id === d.folder) return invalid('folderId', 'Документ уже в этой папке', 'same');
    const impact = impactOf(x, d, () => {
      d.folder = target.id;
    });
    if (b.dryRun) return { status: 200, body: { applied: false, impact } };
    d.folder = target.id;
    touch(x, d);
    log(x, d, 'docs.moved', `Перенесён в «${target.name}»`);
    return { status: 200, body: { applied: true, document: summaryDto(x, d), impact } };
  },

  archiveDocument: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    if (d.status === 'in_route') return fail('invalid_transition', 'Документ на маршруте в архив не уходит');
    if (d.status === 'archived') return fail('invalid_transition', 'Документ уже в архиве');
    d.prevStatus = d.status;
    d.status = 'archived';
    touch(x, d);
    log(x, d, 'docs.archived', 'Документ в архиве');
    return { status: 200, body: documentDto(x, d) };
  },

  restoreDocument: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    if (d.status !== 'archived') return fail('invalid_transition', 'Документ не в архиве');
    d.status = d.prevStatus ?? 'draft';
    delete d.prevStatus;
    touch(x, d);
    log(x, d, 'docs.restored', 'Документ возвращён из архива');
    return { status: 200, body: documentDto(x, d) };
  },

  openDocumentSession: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const { onlyV } = docLevel(x, x.me, d);
    return { body: sessionConfig(x, d, ctx.query.get('mode') ?? 'view', onlyV) };
  },

  listDocVersions: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const { onlyV } = docLevel(x, x.me, d);
    const items = d.versions
      .filter((v) => !onlyV || v.v === onlyV)
      .slice()
      .reverse()
      .map((v) => versionDto(x, d, v));
    return { body: { items } };
  },

  saveDocVersion: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    if (locked(d)) return fail('document_locked', 'Документ на согласовании — версию не сохранить');
    const name = body<S['DocVersionSave']>(ctx).name?.trim();
    const v = newVersion(x, d, 'edit', name ? { name } : {});
    log(x, d, 'docs.version.saved', name ? `Версия ${v.v} «${name}»` : `Версия ${v.v}`);
    return { status: 201, body: versionDto(x, d, v) };
  },

  nameDocVersion: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    const v = d.versions.find((y) => String(y.v) === ctx.params.version);
    if (!v) return fail('not_found', 'Версия не найдена');
    v.name = body<S['DocVersionName']>(ctx).name.trim();
    return { status: 200, body: versionDto(x, d, v) };
  },

  restoreDocVersion: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    const base = d.versions.find((y) => String(y.v) === ctx.params.version);
    if (!base) return fail('not_found', 'Версия не найдена');
    if (locked(d)) return fail('document_locked', 'Документ на согласовании — восстановить версию нельзя');
    const v = newVersion(x, d, 'restore', { base: base.v, size: base.size });
    log(x, d, 'docs.version.saved', `Восстановлена версия ${base.v} как ${v.v}`);
    return { status: 201, body: versionDto(x, d, v) };
  },

  listDocComments: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const { onlyV } = docLevel(x, x.me, d);
    return { body: { items: onlyV ? [] : d.comments.map((c) => commentDto(x, c)) } };
  },

  createDocComment: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 2);
    const b = body<S['DocCommentCreate']>(ctx);
    const text = b.text.trim();
    if (!text) return invalid('text', 'Напишите комментарий', 'required');
    const mention = b.mention ? (x.P(b.mention) ?? invalid('mention', 'Сотрудник не найден')) : undefined;
    const c: Comment = {
      id: x.newId('dc-'),
      by: x.me,
      at: x.now,
      text,
      anchor: { kind: b.anchor.kind, ref: b.anchor.ref, ...(b.anchor.quote ? { quote: b.anchor.quote } : {}) },
      ...(mention ? { mention } : {}),
      replies: [],
      resolved: false,
    };
    d.comments.push(c);
    log(x, d, mention ? 'docs.comment.mentioned' : 'docs.comment', text.slice(0, 80));
    return { status: 201, body: commentDto(x, c) };
  },

  replyDocComment: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 2);
    const c = d.comments.find((y) => y.id === x.P(ctx.params.commentId));
    if (!c) return fail('not_found', 'Комментарий не найден');
    const b = body<S['DocReplyCreate']>(ctx);
    const text = b.text.trim();
    if (!text) return invalid('text', 'Напишите комментарий', 'required');
    c.replies.push({ id: x.newId('dr-'), by: x.me, at: x.now, text, ...(b.mention ? { mention: x.P(b.mention) ?? '' } : {}) });
    return { status: 201, body: commentDto(x, c) };
  },

  resolveDocComment: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 2);
    const c = d.comments.find((y) => y.id === x.P(ctx.params.commentId));
    if (!c) return fail('not_found', 'Комментарий не найден');
    if (c.by !== x.me && docLevel(x, x.me, d).L < 4) {
      return fail('forbidden_action', 'Закрыть обсуждение может автор комментария или тот, кто правит');
    }
    c.resolved = true;
    c.resolvedBy = x.me;
    return { status: 200, body: commentDto(x, c) };
  },

  skipDocMentionGrant: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 2);
    const c = d.comments.find((y) => y.id === x.P(ctx.params.commentId));
    if (!c) return fail('not_found', 'Комментарий не найден');
    c.skip = true;
    return { status: 200, body: commentDto(x, c) };
  },

  getDocShares: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    if (!documentDto(x, d).my.can.share) return fail('forbidden_action', 'Делиться документом может роль с правом «Документы · Настраивать»');
    return { body: sharesDto(x, d), etag: d.shareRev };
  },

  setDocShares: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const my = documentDto(x, d).my;
    if (!my.can.share) return fail('forbidden_action', 'Делиться документом может роль с правом «Документы · Настраивать»');
    ctx.revision(d.shareRev);
    const b = body<S['DocSharesSet']>(ctx);
    const entries = b.entries.map((e) => ({ ...entryInput(x, e), by: x.me, at: x.now }));
    checkGrant(x, d, entries, docLevel(x, x.me, d).L);
    for (const e of entries) {
      if (e.until && e.until < today(x)) return invalid('entries', 'Срок доступа уже прошёл', 'past');
    }
    const impact = impactOf(x, d, () => {
      d.mode = b.mode;
      d.share = entries;
    });
    if (b.dryRun) return { status: 200, body: { applied: false, impact }, etag: d.shareRev };
    d.mode = b.mode;
    d.share = entries;
    d.shareRev += 1;
    touch(x, d);
    log(x, d, 'docs.shared', `Доступ изменён: ${entries.length} записей`);
    return { status: 200, body: { applied: true, impact, shares: sharesDto(x, d) }, etag: d.shareRev };
  },

  grantDocAccess: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    if (!documentDto(x, d).my.can.share) return fail('forbidden_action', 'Делиться документом может роль с правом «Документы · Настраивать»');
    const b = body<S['DocGrantCreate']>(ctx);
    const member = x.P(b.memberId);
    if (!member || !x.member(member)) return invalid('memberId', 'Сотрудник не найден');
    const e: Entry = { who: 'member', ref: member, level: b.level, by: x.me, at: x.now };
    checkGrant(x, d, [e], docLevel(x, x.me, d).L);
    d.share = [...d.share.filter((y) => !(y.who === 'member' && y.ref === member)), e];
    d.shareRev += 1;
    for (const c of d.comments) if (c.mention === member) c.skip = true;
    log(x, d, 'docs.access.granted', `Доступ «${b.level}»: ${x.name(member)}`);
    return { status: 200, body: sharesDto(x, d), etag: d.shareRev };
  },

  listDocLinks: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    return { body: { items: d.ext.map((l) => linkDto(x, l)) } };
  },

  createDocLink: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const b = body<S['DocExternalLinkCreate']>(ctx);
    if (Date.parse(b.expiresAt) > Date.parse(x.now) + 30 * DAY) return invalid('expiresAt', 'Срок ссылки — не больше 30 дней', 'too_long');
    if (Date.parse(b.expiresAt) <= Date.parse(x.now)) return invalid('expiresAt', 'Срок ссылки уже прошёл', 'past');
    if (isFinance(x, d)) return fail('forbidden_action', 'Финансовые документы по внешней ссылке не открываются');
    const id = x.newId('dl-');
    const withPin = b.pin !== false;
    const link = {
      id,
      token: `dlk_${x.U(id).replaceAll('-', '')}z`,
      pin: withPin ? '482915' : null,
      level: b.level,
      expiresAt: b.expiresAt,
      watermark: b.watermark !== false,
      download: b.download === true,
      status: 'active' as const,
      by: x.me,
      at: x.now,
      opens: [] as string[],
    };
    d.ext.push(link);
    log(x, d, 'docs.shared', 'Создана внешняя ссылка');
    const out: S['DocExternalLinkCreated'] = {
      link: linkDto(x, link),
      token: link.token,
      url: `https://crm.ortus.invalid/d/${link.token}`,
    };
    if (link.pin) out.pin = link.pin;
    return { status: 201, body: out };
  },

  revokeDocLink: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const l = d.ext.find((y) => y.id === x.P(ctx.params.linkId));
    if (!l) return fail('not_found', 'Ссылка не найдена');
    l.status = 'revoked';
    return { status: 200, body: linkDto(x, l) };
  },

  syncDocDataset: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    if (d.kind !== 'sheet') return invalid('documentId', 'Обновить столбцы можно только в таблице', 'kind');
    if (locked(d)) return fail('document_locked', 'Документ на согласовании — править нельзя');
    const v = newVersion(x, d, 'edit', { name: 'Обновление из «Данных»' });
    return { status: 200, body: { updatedCells: 12, version: v.v } };
  },

  createDocJob: (ctx) => {
    const x = docsCtx(ctx);
    const b = body<S['DocJobCreate']>(ctx);
    const docs = b.docIds.map((id) => docOr404(x, id, 4));
    const first = docs[0] as Doc;
    if (b.op === 'to_pdf' && docs.every((d) => d.kind === 'pdf')) return invalid('op', 'Это уже PDF', 'already');
    if (['to_docx', 'to_xlsx'].includes(b.op) && first.scan && first.ocr?.status !== 'done') return invalid('op', 'Сначала распознайте скан', 'ocr_first');
    if (b.op === 'ocr' && !first.scan) return invalid('op', 'Распознавать можно только скан', 'not_scan');
    if (b.op === 'ocr' && first.sensitivity === 'pdn') return invalid('op', 'Документ с ПДн не распознаётся', 'pdn');
    if (x.d.jobs.some((j) => j.op === b.op && (j.status === 'queued' || j.status === 'running') && j.docIds.join() === docs.map((d) => d.id).join())) {
      return fail('job_in_progress', 'Такое задание уже выполняется');
    }
    const job: Job = {
      id: x.newId('dj-'),
      op: b.op,
      docIds: docs.map((d) => d.id),
      name: JOB_NAME[b.op] ?? b.op,
      status: 'queued',
      ...(b.params ? { params: b.params } : {}),
      resultId: null,
      at: x.now,
      finishedAt: null,
      applied: false,
    };
    if (first.id === 'doc-prot') {
      job.status = 'failed';
      job.error = 'Файл защищён паролем';
      job.finishedAt = x.now;
    }
    x.d.jobs.push(job);
    for (const d of docs) d.jobs.push(job.id);
    return { status: 202, body: jobDto(x, job) };
  },

  getDocJob: (ctx) => {
    const x = docsCtx(ctx);
    const j = jobOr404(x, ctx.params.jobId);
    const first = x.d.docs.find((d) => d.id === j.docIds[0]);
    if (!first || !docLevel(x, x.me, first).L) return fail('not_found', 'Задание не найдено');
    applyJob(x, j);
    return { body: jobDto(x, j) };
  },

  retryDocJob: (ctx) => {
    const x = docsCtx(ctx);
    const j = jobOr404(x, ctx.params.jobId);
    if (j.status !== 'failed') return fail('invalid_transition', 'Повторить можно только задание с ошибкой');
    const b = body<S['DocJobRetry']>(ctx);
    if (b.password !== '1234') return fail('file_password_protected', 'Неверный пароль файла');
    j.status = 'queued';
    delete j.error;
    j.finishedAt = null;
    return { status: 202, body: jobDto(x, j) };
  },

  reviewOcrWord: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    if (locked(d)) return fail('document_locked', 'Документ на согласовании — править нельзя');
    const w = d.words.find((y) => y.id === ctx.params.wordId);
    if (!w) return fail('not_found', 'Слово не найдено');
    const b = body<S['DocOcrWordReview']>(ctx);
    if (b.action === 'fix') {
      if (!b.value?.trim()) return invalid('value', 'Введите исправленное слово', 'required');
      w.text = b.value.trim();
      w.st = 'fixed';
    } else {
      w.st = b.action === 'accept' ? 'accepted' : 'kept';
    }
    return {
      status: 200,
      body: { id: w.id, text: w.text, suggestion: w.sug, confidence: w.conf, why: w.why, state: w.st },
    };
  },

  startDocRoute: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    const b = body<S['DocRouteStart']>(ctx);
    if (locked(d) || d.route?.status === 'active') return fail('invalid_transition', 'Документ уже на маршруте');
    if (!b.steps.length) return invalid('steps', 'Добавьте хотя бы один шаг', 'required');
    const rules: Rules = { lock: true, notAuthor: b.rules?.notAuthor ?? true, commentOnBack: b.rules?.commentOnBack ?? true, escalate: b.rules?.escalate ?? false };
    const steps = b.steps.map((s, i) => stepFromInput(x, s, i));
    for (const s of steps) {
      if ((s.kind === 'approve' || s.kind === 'sign') && !s.who.length) return invalid('steps', `У шага «${s.name}» нет исполнителей`, 'required');
      if (rules.notAuthor && s.who.includes(d.owner)) {
        return fail('separation_of_duties_conflict', 'Автор документа не согласует и не утверждает его');
      }
    }
    const consequences = [
      `Версия ${d.version + 1} «На согласование» закроется для правки`,
      `Будет создана задача в проекте «ДОК · Документы · маршруты»`,
      ...steps.filter((s) => s.who.length).map((s) => `${s.name}: ${s.who.map((w) => x.name(w)).join(', ')}`),
    ];
    if (b.dryRun) return { status: 200, body: { applied: false, consequences } };
    const route: Route = { id: x.newId('rt-'), version: d.version + 1, by: x.me, at: x.now, status: 'active', cur: 0, rules, steps, task: x.newId('T-'), project: 'pj-docs' };
    newVersion(x, d, 'route', { name: 'На согласование' });
    d.route = route;
    d.status = 'in_route';
    activate(x, d, route, 0);
    log(x, d, 'docs.route.started', `Маршрут: ${steps.length} шаг(ов)`);
    return { status: 201, body: { applied: true, route: routeDto(x, route), consequences } };
  },

  getDocRoute: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    return { body: routeDto(x, routeOr404(d)) };
  },

  decideDocRoute: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const r = routeOr404(d);
    const b = body<S['DocRouteDecide']>(ctx);
    if (r.status !== 'active') return fail('invalid_transition', 'Маршрут не активен');
    const s = myStep(x, r);
    if (!['approve', 'sign'].includes(s.kind) || !s.who.includes(x.me)) {
      return fail('forbidden_action', `Сейчас решение ждут: ${s.who.map((w) => x.name(w)).join(', ') || s.name}`);
    }
    if (s.decisions.some((y) => y.member === x.me)) return fail('invalid_transition', 'Вы уже приняли решение');
    if (b.decision === 'return') {
      if (r.rules.commentOnBack && !b.comment?.trim()) return invalid('comment', 'Напишите, что доработать', 'required');
      s.decisions.push({ member: x.me, decision: 'back', at: x.now, ...(b.comment ? { comment: b.comment } : {}), method: 'click' });
      r.status = 'returned';
      r.back = { name: x.name(x.me), ...(b.comment ? { comment: b.comment } : {}) };
      d.status = 'returned';
      s.status = 'wait';
      log(x, d, 'docs.route.returned', 'Возвращено на доработку');
    } else {
      s.decisions.push({ member: x.me, decision: 'ok', at: x.now, method: 'click' });
      const need = s.mode === 'any' ? 1 : s.who.length;
      if (s.decisions.filter((y) => y.decision === 'ok').length >= need) {
        log(x, d, 'docs.route.step.done', `Шаг «${s.name}» выполнен`);
        advance(x, d, r);
      }
    }
    touch(x, d);
    return { status: 200, body: routeDto(x, r) };
  },

  requestDocSignCode: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const r = routeOr404(d);
    const s = myStep(x, r);
    if (r.status !== 'active' || s.kind !== 'sign') return fail('invalid_transition', 'Сейчас подпись не ожидается');
    if (!s.who.includes(x.me)) return fail('forbidden_action', `Сейчас решение ждут: ${s.who.map((w) => x.name(w)).join(', ')}`);
    if (d.owner === x.me) return fail('separation_of_duties_conflict', 'Автор документа не утверждает его');
    const method = body<S['DocSignCodeRequest']>(ctx).method;
    if (method === 'pep_sms') return fail('dependency_unavailable', 'Доставка кода подключается (D-31 комплекта)');
    return { status: 200, body: { method, expiresAt: new Date(Date.parse(x.now) + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'), attemptsLeft: 3 } };
  },

  confirmDocSign: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const r = routeOr404(d);
    const s = myStep(x, r);
    if (r.status !== 'active' || s.kind !== 'sign' || !s.who.includes(x.me)) return fail('forbidden_action', 'Сейчас подпись не ожидается');
    const b = body<S['DocSignConfirm']>(ctx);
    if (b.method !== 'pep_login' || b.password !== 'ortus-demo') return fail('sign_code_invalid', 'Неверное подтверждение. Осталось попыток: 2');
    s.decisions.push({ member: x.me, decision: 'ok', at: x.now, method: 'pep_login' });
    advance(x, d, r);
    d.pdfaCopy = true;
    touch(x, d);
    return { status: 200, body: { status: d.status, signedAt: x.now, pdfaCopyId: x.U(`${d.id}.pdfa`) } };
  },

  ackDocument: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const r = routeOr404(d);
    const s = r.steps.find((y) => y.kind === 'ack' && y.status === 'active');
    if (!s || !ackPeople(x, s).includes(x.me)) return invalid('documentId', 'Ознакомление запрошено у других сотрудников', 'not_addressee');
    if (!s.done.some((y) => y.member === x.me)) s.done.push({ member: x.me, at: x.now, device: body<S['DocAck']>(ctx).device ?? 'web' });
    if (ackPeople(x, s).every((p) => s.done.some((y) => y.member === p))) {
      log(x, d, 'docs.ack.done', 'Все ознакомились');
      advance(x, d, r);
    }
    return { status: 200, body: { acked: true, at: x.now, version: d.version } };
  },

  closeDocAck: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    const r = routeOr404(d);
    const s = r.steps.find((y) => y.kind === 'ack' && y.status === 'active');
    if (!s) return fail('invalid_transition', 'Ознакомление не идёт');
    log(x, d, 'docs.ack.closed', 'Ознакомление завершено досрочно');
    advance(x, d, r);
    return { status: 200, body: routeDto(x, r) };
  },

  resumeDocRoute: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    const r = routeOr404(d);
    if (r.status !== 'returned') return fail('invalid_transition', 'Маршрут не возвращён');
    r.status = 'active';
    delete r.back;
    d.status = 'in_route';
    const s = r.steps[r.cur] as Step;
    s.status = 'active';
    s.decisions = [];
    touch(x, d);
    return { status: 200, body: routeDto(x, r) };
  },

  cancelDocRoute: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId, 4);
    const r = routeOr404(d);
    if (r.status === 'cancelled' || r.status === 'done') return fail('invalid_transition', 'Маршрут уже завершён');
    r.status = 'cancelled';
    d.status = 'draft';
    d.tmp = d.tmp.filter((g) => g.keep);
    touch(x, d);
    log(x, d, 'docs.route.cancelled', 'Маршрут отменён');
    return { status: 200, body: routeDto(x, r) };
  },

  listDocActivity: (ctx) => {
    const x = docsCtx(ctx);
    const d = docOr404(x, ctx.params.documentId);
    const { onlyV } = docLevel(x, x.me, d);
    const items = onlyV
      ? []
      : d.activity.map((a) => ({ id: x.U(a.id), at: a.at, by: { memberId: x.U(a.by), displayName: x.name(a.by) }, action: a.action, details: a.details }));
    return { body: page(items, ctx.query) };
  },

  listDocFolders: (ctx) => {
    const x = docsCtx(ctx);
    return { body: { items: x.d.folders.filter((f) => folderLevel(x, x.me, f.id) >= 1).map((f) => folderDto(x, f)) } };
  },

  createDocFolder: (ctx) => {
    const x = docsCtx(ctx);
    const b = body<S['DocFolderCreate']>(ctx);
    const parent = b.parentId ? folderOr404(x, b.parentId, 4) : undefined;
    const name = b.name.trim();
    if (x.d.folders.some((f) => f.parent === (parent?.id ?? null) && f.name.toLowerCase() === name.toLowerCase())) {
      return invalid('name', `Папка «${name}» уже есть`, 'taken');
    }
    const f = {
      id: x.newId('fd-'),
      name,
      parent: parent?.id ?? null,
      unit: b.orgUnitId ? (x.P(b.orgUnitId) ?? invalid('orgUnitId', 'Подразделение не найдено')) : (parent?.unit ?? null),
      mode: b.mode ?? ('inherit' as const),
      share: [],
      owner: x.me,
      icon: b.icon ?? 'folder',
      sensitivity: b.sensitivity ?? ('normal' as const),
      revision: 1,
    };
    x.d.folders.push(f);
    return { status: 201, body: folderDto(x, f) };
  },

  updateDocFolder: (ctx) => {
    const x = docsCtx(ctx);
    const f = folderOr404(x, ctx.params.folderId, 5);
    ctx.revision(f.revision);
    const b = body<S['DocFolderPatch']>(ctx);
    if (b.name !== undefined) f.name = b.name.trim();
    if (b.mode) f.mode = b.mode;
    if (b.icon) f.icon = b.icon;
    if (b.sensitivity) f.sensitivity = b.sensitivity;
    f.revision += 1;
    return { body: folderDto(x, f), etag: f.revision };
  },

  deleteDocFolder: (ctx) => {
    const x = docsCtx(ctx);
    const f = folderOr404(x, ctx.params.folderId, 5);
    if (x.d.docs.some((d) => d.folder === f.id) || x.d.folders.some((y) => y.parent === f.id)) {
      return fail('invalid_transition', 'Удалить можно только пустую папку');
    }
    x.d.folders.splice(x.d.folders.indexOf(f), 1);
    return { status: 204 };
  },

  setDocFolderShares: (ctx) => {
    const x = docsCtx(ctx);
    const f = folderOr404(x, ctx.params.folderId, 5);
    const b = body<S['DocSharesSet']>(ctx);
    const entries = b.entries.map((e) => ({ ...entryInput(x, e), by: x.me, at: x.now }));
    checkGrant(x, f, entries, folderLevel(x, x.me, f.id));
    const docs = x.d.docs.filter((d) => chainOf(x, d.folder).some((y) => y.id === f.id));
    const people = x.org.members.filter((m) => m.status === 'active' || m.status === 'invited');
    const levels = (): Map<string, Level> => new Map(people.map((m) => [m.proto, docs.reduce<Level>((a, d) => Math.max(a, docLevel(x, m.proto, d).L) as Level, 0)]));
    const before = levels();
    const snap = { mode: f.mode, share: f.share };
    f.mode = b.mode;
    f.share = entries;
    const after = levels();
    if (b.dryRun) Object.assign(f, snap);
    const impact: S['DocAccessImpact'] = { gain: [], lose: [], up: [], down: [] };
    for (const m of people) {
      const a = before.get(m.proto) ?? 0;
      const c = after.get(m.proto) ?? 0;
      if (a === c) continue;
      const row = { member: { memberId: x.U(m.proto), displayName: m.displayName }, from: levelKey(a), to: levelKey(c), invited: m.status === 'invited' };
      (a === 0 ? impact.gain : c === 0 ? impact.lose : c > a ? impact.up : impact.down).push(row);
    }
    if (b.dryRun) return { status: 200, body: { applied: false, impact } };
    f.revision += 1;
    return { status: 200, body: { applied: true, impact, shares: { mode: f.mode, entries: f.share.map((e) => entryDto(x, e)), revision: f.revision } } };
  },

  listDocTemplates: (ctx) => {
    const x = docsCtx(ctx);
    const items = TEMPLATES.map((t) => ({
      id: x.U(t.id),
      name: t.name,
      kind: t.kind,
      icon: t.icon,
      hint: t.hint,
      link: t.link,
      folderId: x.U(t.folder),
      fields: t.fields.map((f) => ({ key: f.key, ...(f.src ? { src: f.src } : {}) })),
    }));
    return { body: { items } };
  },

  listDocRouteTemplates: (ctx) => {
    const x = docsCtx(ctx);
    const items = x.d.folders
      .filter((f) => f.routeTpl && folderLevel(x, x.me, f.id) >= 1)
      .map((f) => {
        const t = f.routeTpl as NonNullable<typeof f.routeTpl>;
        return {
          id: x.U(`rtp-${f.id}`),
          folderId: x.U(f.id),
          name: t.name,
          projectId: t.project ? x.U(t.project) : null,
          steps: t.steps.map((s) => ({
            kind: s.kind,
            days: s.days,
            ...(s.mode ? { mode: s.mode } : {}),
            ...(s.who ? { whoMemberIds: s.who.map((w) => x.U(w)) } : {}),
            ...(s.audience ? { audience: s.audience.map((e) => entryDto(x, e)) } : {}),
            ...(s.externalName ? { externalName: s.externalName } : {}),
          })),
          rules: { ...t.rules },
        };
      });
    return { body: { items } };
  },

  // ----- публичный контур и межсервисный callback -----

  openDocLink: (ctx) => {
    for (const org of Object.values(ctx.s.orgs)) {
      const d0 = docsOf(org);
      for (const doc of d0.docs) {
        const l = doc.ext.find((y) => y.token === ctx.params.token);
        if (!l) continue;
        const now = ctx.now();
        if (l.status === 'revoked' || Date.parse(l.expiresAt) < Date.parse(now)) {
          return fail('public_token_expired', 'Ссылка больше не действует');
        }
        const pin = (ctx.body as S['DocPublicOpen'] | undefined)?.pin;
        if (l.pin && pin !== l.pin) return fail('forbidden_action', 'Неверный PIN');
        l.opens.push(now);
        const key = versionKey(org.tenantId, seedUuid(org.proto, doc.id), doc.version);
        return {
          status: 200,
          body: {
            title: doc.title,
            kind: doc.kind,
            version: doc.version,
            watermark: `Ортус · ${doc.title} · ${now.slice(0, 10)}`,
            expiresAt: l.expiresAt,
            config: {
              engine: 'none',
              editorAvailable: false,
              mode: 'view',
              documentKey: key,
              version: doc.version,
              fileUrl: `https://files.ortus.invalid/public/${l.token}`,
              user: { memberId: seedUuid(org.proto, 'm-guest'), displayName: 'Гость' },
              permissions: { edit: false, review: false, comment: false, download: l.download, print: l.download, fillForms: false, protectedRanges: false },
              protectedRanges: [],
              hint: 'Редактор подключается',
              expiresAt: l.expiresAt,
            },
          } satisfies S['DocPublicSession'],
        };
      }
    }
    return fail('not_found', 'Ссылка не найдена');
  },

  // Возврат 1: у сервера документов нет сессии, тенант — в ключе версии (t<тенант>.d<документ>.v<версия>) и читается
  // только после проверки подписи; неизвестный тенант или документ — 404, устаревшая версия — 409 (не {error: 1}).
  docServerCallback: (ctx) => {
    const auth = ctx.headers.get('Authorization') ?? '';
    if (auth !== 'Bearer docserver-test-jwt') {
      return fail('session_expired', 'Подпись сервера документов не подтверждена');
    }
    const b = body<S['DocServerCallback']>(ctx);
    const m = VERSION_KEY.exec(b.key);
    if (!m) return fail('validation_failed', 'Ключ версии не соответствует формату');
    const [, tenantId, docUuid, v] = m;
    const org = Object.values(ctx.s.orgs).find((o) => o.tenantId === tenantId);
    const doc = org ? docsOf(org).docs.find((y) => seedUuid(org.proto, y.id) === docUuid) : undefined;
    if (!org || !doc) return fail('not_found', 'Документ по ключу не найден');
    if (b.status === 2 || b.status === 6) {
      if (Number(v) !== doc.version) return fail('invalid_transition', 'Версия в ключе уже не текущая');
      doc.version += 1;
      doc.versions.push({ v: doc.version, at: ctx.now(), by: doc.authors.slice(0, 1), name: null, source: 'edit', size: doc.size, forcesave: b.status === 6, base: null });
      doc.updatedAt = ctx.now();
      doc.revision += 1;
    }
    return { status: 200, body: { error: 0 } };
  },
};

void verbsOf;
