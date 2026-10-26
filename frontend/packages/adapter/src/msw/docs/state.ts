// «Документы» сценарного сервера (W7.00, контрактный PR этапа 7): срез организации и проекция в схемы контракта
// (`Doc*`). Домен W7.21 (`docs/core`) в баррель `@ortus/domain/modules` ещё не выведен (интегратор), поэтому срез здесь
// самостоятельный: те же папки, документы трёх видов, уровни доступа 0–5 (J:70–140), маршрут и шаблоны эталона
// «Документы.dc.html» (design-2026-10-19), но без блоков текста и ячеек — тело документа в контракте это файл движка
// (D-32 комплекта, Q-W4.00-documents-1). Когда баррель появится, срез заменяется командами домена, как у «Обращений».
import type { components } from '@ortus/api-client';
import { rolePermKeys } from '@ortus/domain';
import { seedUuid } from '@ortus/domain/seed';

import { registerScopedKeys, type TenantAccess } from '../core/access.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext } from '../core/registry.ts';
import { SEED_NOW } from '../core/state.ts';
import type { Org } from '../core/state.ts';

type S = components['schemas'];

export type Level = 0 | 1 | 2 | 3 | 4 | 5;
export const LEVEL_KEY = [null, 'view', 'comment', 'suggest', 'edit', 'manage'] as const;
export const LV: Readonly<Record<string, Level>> = { view: 1, comment: 2, suggest: 3, edit: 4, manage: 5 };

export interface Entry {
  who: 'all' | 'member' | 'group' | 'role' | 'relation';
  ref?: string | null;
  unit?: string | null;
  obj?: string | null;
  level: 'view' | 'comment' | 'suggest' | 'edit' | 'manage';
  until?: string | null;
  by?: string;
  at?: string;
}

export interface Folder {
  id: string;
  name: string;
  parent: string | null;
  unit: string | null;
  mode: 'inherit' | 'listed';
  share: Entry[];
  owner: string;
  icon: string;
  sensitivity: 'normal' | 'finance';
  link?: { module: string; type: string; id: string };
  routeTpl?: RouteTpl;
  revision: number;
}

export interface Step {
  kind: 'approve' | 'sign' | 'ack' | 'external';
  name: string;
  mode: 'all' | 'seq' | 'any';
  who: string[];
  audience: Entry[];
  days: number;
  status: 'wait' | 'active' | 'done';
  due: string | null;
  decisions: { member: string; decision: 'ok' | 'back'; at: string; comment?: string; method: 'click' | 'pep_login' | 'pep_sms' | 'sms_link' }[];
  done: { member: string; at: string; device: string }[];
  external?: { name: string; phone?: string };
}

export interface RouteTpl {
  name: string;
  project: string | null;
  steps: { kind: Step['kind']; mode?: Step['mode']; who?: string[]; audience?: Entry[]; days: number; externalName?: string }[];
  rules: Rules;
}

export interface Rules {
  lock: boolean;
  notAuthor: boolean;
  commentOnBack: boolean;
  escalate: boolean;
}

export interface Route {
  id: string;
  version: number;
  by: string;
  at: string;
  status: 'active' | 'returned' | 'done' | 'cancelled';
  cur: number;
  rules: Rules;
  steps: Step[];
  back?: { name: string; comment?: string };
  project?: string;
  task?: string;
}

export interface Comment {
  id: string;
  by: string;
  at: string;
  text: string;
  anchor: { kind: 'block' | 'cell' | 'page'; ref: string; quote?: string };
  mention?: string;
  replies: { id: string; by: string; at: string; text: string; mention?: string }[];
  resolved: boolean;
  resolvedBy?: string;
  skip?: boolean;
}

export interface Version {
  v: number;
  at: string;
  by: string[];
  name: string | null;
  source: 'edit' | 'upload' | 'convert' | 'ocr' | 'restore' | 'merge' | 'route';
  size: number;
  forcesave: boolean;
  base: number | null;
}

export interface Link {
  id: string;
  token: string;
  pin: string | null;
  level: 'view' | 'comment' | 'fill';
  expiresAt: string;
  watermark: boolean;
  download: boolean;
  status: 'active' | 'revoked' | 'expired';
  by: string;
  at: string;
  opens: string[];
}

export interface Job {
  id: string;
  op: string;
  docIds: string[];
  name: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  params?: Record<string, unknown>;
  error?: string;
  resultId: string | null;
  at: string;
  finishedAt: string | null;
  applied: boolean;
}

export interface Word {
  id: string;
  text: string;
  sug: string;
  conf: number;
  why: string;
  st: 'doubtful' | 'accepted' | 'kept' | 'fixed';
}

export interface Doc {
  id: string;
  kind: 'text' | 'sheet' | 'pdf';
  title: string;
  folder: string;
  owner: string;
  status: 'draft' | 'in_route' | 'returned' | 'agreed' | 'approved' | 'signed' | 'archived';
  prevStatus?: Doc['status'];
  sensitivity: 'normal' | 'finance' | 'pdn';
  mode: 'inherit' | 'listed';
  share: Entry[];
  links: { module: string; type: string; id: string; label?: string }[];
  version: number;
  versions: Version[];
  comments: Comment[];
  fields: { key: string; src?: string; value?: string; from?: string }[];
  tmp: { member: string; level: Entry['level']; why: string; onlyVersion?: number; keep?: boolean }[];
  route?: Route;
  jobs: string[];
  ocr?: { status: 'none' | 'queued' | 'running' | 'done' | 'failed'; confidence?: number; at?: string; lang?: string };
  words: Word[];
  scan: boolean;
  pdfaCopy: boolean;
  template?: string | null;
  size: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  authors: string[];
  ranges: { id: string; sheet: string; range: string; name: string; who: Entry[] }[];
  ext: Link[];
  activity: { id: string; at: string; by: string; action: string; details: string }[];
  commentsHidden?: boolean;
  revision: number;
  shareRev: number;
}

export interface DocsState {
  folders: Folder[];
  docs: Doc[];
  jobs: Job[];
  seq: number;
  /** Ревизии: документы и папки (ETag) живут в самих строках. */
}

type WithDocs = Org & { docs7?: DocsState };

const T0 = SEED_NOW;
const at = (min: number): string => new Date(Date.parse(T0) + min * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const RULES: Rules = { lock: true, notAuthor: true, commentOnBack: true, escalate: false };

const fd = (id: string, name: string, o: Partial<Folder> = {}): Folder => ({
  id,
  name,
  parent: null,
  unit: null,
  mode: 'inherit',
  share: [],
  owner: 'm-owner',
  icon: 'folder',
  sensitivity: 'normal',
  revision: 1,
  ...o,
});

const ver = (v: number, minutes: number, by: string[], o: Partial<Version> = {}): Version => ({
  v,
  at: at(minutes),
  by,
  name: null,
  source: 'edit',
  size: 48_000,
  forcesave: true,
  base: null,
  ...o,
});

const doc = (o: Partial<Doc> & Pick<Doc, 'id' | 'kind' | 'title' | 'folder' | 'owner'>): Doc => ({
  status: 'draft',
  sensitivity: 'normal',
  mode: 'inherit',
  share: [],
  links: [],
  version: 1,
  versions: [ver(1, -2880, [o.owner])],
  comments: [],
  fields: [],
  tmp: [],
  jobs: [],
  words: [],
  scan: false,
  pdfaCopy: false,
  template: null,
  size: 48_000,
  createdAt: at(-2880),
  updatedAt: at(-1440),
  updatedBy: o.owner,
  authors: [o.owner],
  ranges: [],
  ext: [],
  activity: [{ id: `da-${o.id}-1`, at: at(-2880), by: o.owner, action: 'docs.created', details: 'Документ создан' }],
  revision: 1,
  shareRev: 1,
  ...o,
});

function seedAlta(): DocsState {
  const orderTpl: RouteTpl = {
    name: 'Приказ по фирме',
    project: null,
    steps: [
      { kind: 'approve', mode: 'all', who: ['m-kotelnikova'], days: 2 },
      { kind: 'sign', who: ['m-owner'], days: 1 },
      { kind: 'ack', audience: [{ who: 'role', ref: 'r-driver', unit: 'f-msk-sever', level: 'view' }], days: 3 },
    ],
    rules: { ...RULES },
  };
  const contractTpl: RouteTpl = {
    name: 'Договор с заказчиком',
    project: 'pj-docs',
    steps: [
      { kind: 'approve', mode: 'all', who: ['m-sokolov'], days: 1 },
      { kind: 'external', days: 3, externalName: 'Ольга Смирнова' },
    ],
    rules: { ...RULES },
  };
  const folders: Folder[] = [
    fd('fd-log', 'Север Логистик', {
      unit: 'f-msk-sever',
      icon: 'local_shipping',
      owner: 'm-kotova',
      share: [{ who: 'group', ref: 'g-disp', level: 'edit' }],
    }),
    fd('fd-log-ord', 'Приказы', { parent: 'fd-log', unit: 'f-msk-sever', icon: 'gavel', owner: 'm-kotova', routeTpl: orderTpl }),
    fd('fd-log-ctr', 'Договоры', { parent: 'fd-log', unit: 'f-msk-sever', icon: 'handshake' }),
    fd('fd-log-fin', 'Финансы', {
      parent: 'fd-log',
      unit: 'f-msk-sever',
      icon: 'payments',
      mode: 'listed',
      sensitivity: 'finance',
      share: [{ who: 'member', ref: 'm-kotova', level: 'edit' }],
    }),
    fd('fd-rep', 'Ремонт и стройка', { icon: 'construction' }),
    fd('fd-o42', 'ЖК Речной · квартира 42', {
      parent: 'fd-rep',
      icon: 'home_work',
      link: { module: 'repairs', type: 'project', id: 'obj-42' },
      share: [{ who: 'relation', ref: 'foreman', obj: 'obj-42', level: 'edit' }],
      routeTpl: contractTpl,
    }),
  ];
  const approveStep = (status: Step['status']): Step => ({
    kind: 'approve',
    name: 'Согласовать',
    mode: 'all',
    who: ['m-sokolov'],
    audience: [],
    days: 1,
    status,
    due: '2026-10-02',
    decisions: [],
    done: [],
  });
  const docs: Doc[] = [
    doc({
      id: 'doc-42',
      kind: 'text',
      title: 'Договор подряда № 42/26',
      folder: 'fd-o42',
      owner: 'm-owner',
      status: 'in_route',
      links: [{ module: 'repairs', type: 'project', id: 'obj-42', label: 'ЖК Речной · квартира 42' }],
      version: 3,
      versions: [ver(1, -4320, ['m-owner']), ver(2, -2880, ['m-owner', 'm-sokolov']), ver(3, -60, ['m-owner'], { source: 'route', name: 'На согласование', forcesave: false })],
      fields: [
        { key: 'Заказчик', src: 'obj.client', value: 'Ольга Смирнова', from: 'Объект' },
        { key: 'Адрес объекта', src: 'obj.address', value: 'Москва, ул. Речная, 5, кв. 42', from: 'Объект' },
        { key: 'Цена', src: 'snap', value: '1 248 300 ₽', from: 'Смета' },
      ],
      route: {
        id: 'rt-1',
        version: 3,
        by: 'm-owner',
        at: at(-60),
        status: 'active',
        cur: 0,
        rules: { ...RULES },
        steps: [
          approveStep('active'),
          { kind: 'external', name: 'Подпись заказчика', mode: 'all', who: [], audience: [], days: 3, status: 'wait', due: null, decisions: [], done: [], external: { name: 'Ольга Смирнова', phone: '+7 916 ••• ••-17' } },
        ],
        task: 'T-71',
        project: 'pj-docs',
      },
      tmp: [{ member: 'm-sokolov', level: 'comment', why: 'Согласование договора', onlyVersion: 3 }],
      comments: [
        {
          id: 'dc-1',
          by: 'm-sokolov',
          at: at(-30),
          text: 'Срок окончания — 27 ноября, не 20-го. Проверьте п. 2.1.',
          anchor: { kind: 'block', ref: 'b-21', quote: 'Окончание — 27 ноября 2026 г.' },
          replies: [],
          resolved: false,
        },
      ],
      authors: ['m-owner', 'm-sokolov'],
    }),
    doc({
      id: 'doc-ord',
      kind: 'text',
      title: 'Приказ № 14 · работа 4 ноября',
      folder: 'fd-log-ord',
      owner: 'm-kotova',
      status: 'agreed',
      version: 2,
      versions: [ver(1, -1500, ['m-kotova']), ver(2, -900, ['m-kotova'])],
      share: [{ who: 'role', ref: 'r-driver', unit: 'f-msk-sever', level: 'view' }],
      authors: ['m-kotova'],
    }),
    doc({
      id: 'doc-fuel',
      kind: 'sheet',
      title: 'Расход топлива · октябрь 2026',
      folder: 'fd-log',
      owner: 'm-kotova',
      version: 4,
      versions: [ver(1, -6000, ['m-kotova']), ver(2, -5000, ['m-kotova']), ver(3, -3000, ['m-kotova']), ver(4, -600, ['m-kotova'])],
      ranges: [{ id: 'pr-1', sheet: 'Октябрь', range: 'G3:G6', name: 'Норма', who: [{ who: 'role', ref: 'r-manager', level: 'edit' }] }],
      authors: ['m-kotova'],
    }),
    doc({
      id: 'doc-inv',
      kind: 'pdf',
      title: 'Накладная ТН-5581',
      folder: 'fd-log-ctr',
      owner: 'm-kotova',
      scan: true,
      size: 1_920_000,
      ocr: { status: 'done', confidence: 0.93, at: at(-200), lang: 'rus' },
      words: [
        { id: 'w1', text: 'ГАЗелъ', sug: 'ГАЗель', conf: 0.61, why: 'Нестандартный знак', st: 'doubtful' },
        { id: 'w2', text: 'А 4I2 МР 77', sug: 'А 412 МР 77', conf: 0.55, why: 'Цифра похожа на букву', st: 'doubtful' },
      ],
      version: 2,
      versions: [ver(1, -300, ['m-kotova'], { source: 'upload', size: 1_920_000 }), ver(2, -200, ['m-kotova'], { source: 'ocr', size: 1_940_000 })],
    }),
    doc({
      id: 'doc-reg',
      kind: 'text',
      title: 'Регламент приёмки смены',
      folder: 'fd-log',
      owner: 'm-kotova',
      comments: [
        {
          id: 'dc-2',
          by: 'm-kotova',
          at: at(-120),
          text: 'Илья, проверьте п. 3 — @Илья Васильев',
          anchor: { kind: 'block', ref: 'b-3' },
          mention: 'm-vasiliev',
          replies: [],
          resolved: false,
        },
      ],
      authors: ['m-kotova'],
    }),
    doc({
      id: 'doc-prot',
      kind: 'pdf',
      title: 'Договор аренды склада (защищён паролем)',
      folder: 'fd-log-ctr',
      owner: 'm-kotova',
      size: 820_000,
    }),
    doc({
      id: 'doc-pay',
      kind: 'sheet',
      title: 'Начисления · октябрь',
      folder: 'fd-log-fin',
      owner: 'm-kotova',
      sensitivity: 'finance',
      authors: ['m-kotova'],
    }),
  ];
  return { folders, docs, jobs: [], seq: 0 };
}

export function docsOf(org: Org): DocsState {
  const x = org as WithDocs;
  x.docs7 ??= org.proto === 't-alta' ? seedAlta() : { folders: [], docs: [], jobs: [], seq: 0 };
  return x.docs7;
}

// ---------------------------------------------------------------------------------------------
// Контекст запроса и доступ

export interface DocsCtx {
  t: TenantAccess;
  org: Org;
  d: DocsState;
  me: string;
  now: string;
  U(id: string): string;
  P(uuid: string | undefined): string | undefined;
  member(id: string): { id: string; name: string; status: string; function?: string } | undefined;
  name(id: string): string;
  newId(prefix: string): string;
}

const MEMBER_KEYS: Readonly<Record<string, readonly string[]>> = {
  view: ['docs.read', 'docs.comment'],
  create: ['docs.create', 'docs.convert'],
  edit: ['docs.update', 'docs.suggest'],
  review: ['docs.sign'],
  export: ['docs.export'],
  settings: ['docs.share', 'docs.templates.manage', 'docs.folders.manage'],
};

/** Глаголы `docs` ролей участника «Альты» (installDocs, J:516): менеджер, водитель, прораб; остальные — без модуля. */
const ROLE_VERBS: Readonly<Record<string, readonly string[]>> = {
  'r-manager': ['view', 'create', 'edit', 'export', 'settings'],
  'r-driver': ['view'],
  'r-foreman': ['view', 'create', 'edit', 'settings'],
};

const memberRoles = (org: Org, memberProto: string): string[] => {
  const id = org.members.find((m) => m.proto === memberProto)?.id;
  const direct = org.assignments.filter((a) => a.principalType === 'member' && a.principalId === id);
  const groups = org.groups.filter((g) => id && g.memberIds.includes(id)).map((g) => g.id);
  const viaGroup = org.assignments.filter((a) => a.principalType === 'group' && groups.includes(a.principalId));
  return [...direct, ...viaGroup].map((a) => org.roles.find((r) => r.id === a.roleId)?.proto ?? '');
};

/**
 * Роль «Логист» (-manager) в состоянии сценарного сервера никому не назначена (Котова держит проектную роль), а в\n * прототипе installDocs выдаёт ей глаголы менеджера (J:516): логист «Север Логистик» — менеджер документов фирмы.\n */
const MEMBER_VERBS: Readonly<Record<string, readonly string[]>> = {
  'm-kotova': ROLE_VERBS['r-manager'] as readonly string[],
};

export const verbsOf = (org: Org, memberProto: string): Set<string> =>
  new Set([...memberRoles(org, memberProto).flatMap((r) => ROLE_VERBS[r] ?? []), ...(MEMBER_VERBS[memberProto] ?? [])]);

/** Ключи `docs.*` участника «Альты» из глаголов его ролей (шлюзу — только для операций этапа 7, PD-53). */
let registered = false;
export function registerDocsKeys(): void {
  if (registered) return;
  registered = true;
  registerScopedKeys((t, opScope) => {
    if (opScope !== 'docs-folder-doc' || !t.member || t.org.proto !== 't-alta') return [];
    const verbs = verbsOf(t.org, t.member.proto);
    const out = new Set<string>();
    for (const v of verbs) for (const k of MEMBER_KEYS[v] ?? []) out.add(k);
    void rolePermKeys;
    return [...out];
  });
}

export function docsCtx(ctx: HandlerContext): DocsCtx {
  const t = ctx.org();
  const d = docsOf(t.org);
  let idx: Map<string, string> | undefined;
  const U = (id: string): string => seedUuid(t.org.proto, id);
  const index = (): Map<string, string> => {
    if (!idx) {
      idx = new Map();
      const add = (id: string | undefined): void => {
        if (id) idx?.set(U(id), id);
      };
      for (const m of t.org.members) add(m.proto);
      for (const u of t.org.units) add(u.proto);
      for (const g of t.org.groups) add(g.proto);
      for (const r of t.org.roles) add(r.proto);
      for (const f of d.folders) {
        add(f.id);
        if (f.routeTpl) add(`rtp-${f.id}`);
      }
      for (const x of d.docs) {
        add(x.id);
        for (const c of x.comments) {
          add(c.id);
          c.replies.forEach((r) => add(r.id));
        }
        for (const l of x.ext) add(l.id);
        for (const w of x.words) add(w.id);
      }
      for (const j of d.jobs) add(j.id);
      for (const id of ['obj-42', 'pj-docs', 'T-71']) add(id);
    }
    return idx;
  };
  const now = ctx.now();
  return {
    t,
    org: t.org,
    d,
    me: t.member?.proto ?? '',
    now,
    U,
    P: (uuid) => (uuid ? index().get(uuid.toLowerCase()) : undefined),
    member: (id) => {
      const m = t.org.members.find((x) => x.proto === id);
      return m ? { id: m.proto, name: m.displayName, status: m.status, ...(m.workProfiles.includes('driver') ? { function: 'driver' } : {}) } : undefined;
    },
    name: (id) => t.org.members.find((x) => x.proto === id)?.displayName ?? id,
    newId: (prefix) => `${prefix}w${++d.seq}`,
  };
}

const folderOf = (x: DocsCtx, id: string): Folder | undefined => x.d.folders.find((f) => f.id === id);

/** Цепочка папок от документа к корню. */
export function chainOf(x: DocsCtx, folderId: string): Folder[] {
  const out: Folder[] = [];
  let f = folderOf(x, folderId);
  while (f) {
    out.push(f);
    f = f.parent ? folderOf(x, f.parent) : undefined;
  }
  return out;
}

export const isFinance = (x: DocsCtx, d: Doc): boolean =>
  d.sensitivity === 'finance' || chainOf(x, d.folder).some((f) => f.sensitivity === 'finance');

const isDriver = (x: DocsCtx, id: string): boolean => x.member(id)?.function === 'driver';

const unitCovers = (org: Org, memberProto: string, unitProto: string | null): boolean => {
  if (!unitProto) return true;
  const m = org.members.find((y) => y.proto === memberProto);
  const unit = org.units.find((u) => u.proto === unitProto);
  return !!m && !!unit && (m.orgUnitIds.includes(unit.id) || unit.parentId !== null && m.orgUnitIds.includes(unit.parentId));
};

const entryHits = (x: DocsCtx, memberProto: string, e: Entry): boolean => {
  switch (e.who) {
    case 'all':
      return true;
    case 'member':
      return e.ref === memberProto;
    case 'group': {
      const g = x.org.groups.find((y) => y.proto === e.ref);
      const id = x.org.members.find((y) => y.proto === memberProto)?.id;
      return !!g && !!id && g.memberIds.includes(id);
    }
    case 'role':
      return memberRoles(x.org, memberProto).includes(e.ref ?? '') && unitCovers(x.org, memberProto, e.unit ?? null);
    case 'relation':
      return e.ref === 'foreman' && memberProto === 'm-sokolov';
    default:
      return false;
  }
};

const live = (e: Entry, now: string): boolean => !e.until || e.until >= now.slice(0, 10);

/** Уровень доступа участника к папке (цепочка наследования, «Только выбранные» обрывает область). */
export function folderLevel(x: DocsCtx, memberProto: string, folderId: string): Level {
  const m = x.org.members.find((y) => y.proto === memberProto);
  if (!m || m.status === 'suspended') return 0;
  const tenantOwner = x.org.tenantId && x.t.owner && memberProto === x.me;
  if (tenantOwner || memberProto === 'm-owner') return 5;
  let level: Level = 0;
  const chain = chainOf(x, folderId);
  let areaOpen = true;
  for (const f of chain) {
    for (const e of f.share) if (live(e, x.now) && entryHits(x, memberProto, e)) level = Math.max(level, LV[e.level] ?? 0) as Level;
    if (f.owner === memberProto) level = 5;
    if (f.mode === 'listed') areaOpen = false;
  }
  if (areaOpen) {
    const root = chain[chain.length - 1];
    const verbs = verbsOf(x.org, memberProto);
    if (root && !isDriver(x, memberProto) && verbs.size && unitCovers(x.org, memberProto, root.unit)) {
      level = Math.max(level, verbs.has('settings') ? 4 : verbs.has('edit') ? 4 : verbs.has('view') ? 1 : 0) as Level;
    }
  }
  return level;
}

/** Уровень доступа к документу: папка, записи документа, временные доступы маршрута. */
export function docLevel(x: DocsCtx, memberProto: string, d: Doc): { L: Level; onlyV: number | null; owner: boolean } {
  if (memberProto === 'm-owner') return { L: 5, onlyV: null, owner: true };
  let L: Level = d.mode === 'listed' ? 0 : folderLevel(x, memberProto, d.folder);
  if (d.owner === memberProto) L = 5;
  for (const e of d.share) if (live(e, x.now) && entryHits(x, memberProto, e)) L = Math.max(L, LV[e.level] ?? 0) as Level;
  let onlyV: number | null = null;
  for (const g of d.tmp) {
    if (g.member !== memberProto) continue;
    const lv = LV[g.level] ?? 0;
    if (lv > L) {
      L = lv as Level;
      onlyV = g.onlyVersion ?? null;
    }
  }
  if (isFinance(x, d) && isDriver(x, memberProto)) return { L: 0, onlyV: null, owner: false };
  return { L, onlyV, owner: d.owner === memberProto };
}

export const levelKey = (L: Level): S['DocShareEntry']['level'] | null => LEVEL_KEY[L] ?? null;

export const locked = (d: Doc): boolean => d.status === 'in_route' || d.status === 'signed';

// ---------------------------------------------------------------------------------------------
// Проекция

const memberRef = (x: DocsCtx, id: string): S['DocMemberRef'] => ({ memberId: x.U(id), displayName: x.name(id) });

export function entryDto(x: DocsCtx, e: Entry): S['DocShareEntry'] {
  const out: S['DocShareEntry'] = { who: e.who, level: e.level };
  if (e.ref && e.who !== 'relation') out.refId = x.U(e.ref);
  if (e.unit) out.orgUnitId = x.U(e.unit);
  if (e.who === 'relation' && e.obj) out.object = { moduleKey: 'repairs', entityType: 'project', entityId: x.U(e.obj) };
  if (e.until) out.until = e.until;
  out.label = entryLabel(x, e);
  if (e.by) out.byDisplayName = x.name(e.by);
  if (e.at) out.at = e.at;
  return out;
}

export function entryLabel(x: DocsCtx, e: Entry): string {
  switch (e.who) {
    case 'all':
      return 'Все сотрудники';
    case 'member':
      return x.name(e.ref ?? '');
    case 'group':
      return `Группа «${x.org.groups.find((g) => g.proto === e.ref)?.name ?? e.ref}»`;
    case 'role':
      return `Роль «${x.org.roles.find((r) => r.proto === e.ref)?.name ?? e.ref}»`;
    case 'relation':
      return 'Прораб объекта';
    default:
      return '—';
  }
}

export function entryInput(x: DocsCtx, e: S['DocShareEntry']): Entry {
  const bad = (m: string): never =>
    fail('validation_failed', m, { violations: [{ field: 'entries', code: 'not_found', message: m }] });
  const out: Entry = { who: e.who, level: e.level };
  if (e.refId) out.ref = x.P(e.refId) ?? bad('Получатель не найден');
  if (e.who === 'relation') out.ref = 'foreman';
  if (e.orgUnitId) out.unit = x.P(e.orgUnitId) ?? bad('Подразделение не найдено');
  if (e.object) out.obj = x.P(e.object.entityId) ?? bad('Объект не найден');
  if (e.until) out.until = e.until;
  return out;
}

export interface Wait {
  kind: S['DocWait']['kind'];
  due?: string;
  by?: string;
  comment?: string;
  commentId?: string;
  count?: number;
}

/** «Ждут меня»: шаг маршрута, возврат, упоминание, сомнительные слова (docWaits). */
export function waitsOf(x: DocsCtx, d: Doc, me: string): S['DocWait'][] {
  const out: S['DocWait'][] = [];
  const r = d.route;
  if (r?.status === 'active') {
    const s = r.steps[r.cur];
    if (s?.status === 'active') {
      const mine = s.who.includes(me) && !s.decisions.some((y) => y.member === me);
      if (s.kind === 'approve' && mine) out.push({ kind: 'approve', ...(s.due ? { due: s.due } : {}) });
      if (s.kind === 'sign' && mine) out.push({ kind: 'sign', ...(s.due ? { due: s.due } : {}) });
      if (s.kind === 'ack') {
        const people = ackPeople(x, s);
        if (people.includes(me) && !s.done.some((y) => y.member === me)) out.push({ kind: 'ack', ...(s.due ? { due: s.due } : {}) });
      }
    }
  }
  if (r?.status === 'returned' && d.owner === me) {
    out.push({ kind: 'returned', ...(r.back?.name ? { by: r.back.name } : {}), ...(r.back?.comment ? { comment: r.back.comment } : {}) });
  }
  for (const c of d.comments) {
    if (c.mention === me && !c.resolved && !c.skip) out.push({ kind: 'mention', by: x.name(c.by), commentId: x.U(c.id) });
  }
  const doubt = d.words.filter((w) => w.st === 'doubtful').length;
  if (doubt && d.owner === me) out.push({ kind: 'ocr', count: doubt });
  return out;
}

/** Адресаты шага ознакомления: записи аудитории → активные участники. */
export function ackPeople(x: DocsCtx, s: Step): string[] {
  return x.org.members
    .filter((m) => m.status === 'active' && s.audience.some((e) => entryHits(x, m.proto, e)))
    .map((m) => m.proto);
}

export function routeDto(x: DocsCtx, r: Route): S['DocRoute'] {
  const out: S['DocRoute'] = {
    id: x.U(r.id),
    version: r.version,
    startedBy: memberRef(x, r.by),
    startedAt: r.at,
    status: r.status,
    currentStep: r.cur,
    rules: { ...r.rules },
    steps: r.steps.map((s) => stepDto(x, s)),
  };
  if (r.project) out.project = { moduleKey: 'tasks', entityType: 'project', entityId: x.U(r.project) };
  if (r.task) out.task = { moduleKey: 'tasks', entityType: 'task', entityId: x.U(r.task) };
  if (r.back) out.back = { name: r.back.name, ...(r.back.comment ? { comment: r.back.comment } : {}) };
  return out;
}

function stepDto(x: DocsCtx, s: Step): S['DocRouteStep'] {
  const out: S['DocRouteStep'] = {
    kind: s.kind,
    name: s.name,
    mode: s.mode,
    who: s.who.map((w) => memberRef(x, w)),
    days: s.days,
    status: s.status,
    due: s.due,
    decisions: s.decisions.map((y) => ({
      member: memberRef(x, y.member),
      decision: y.decision,
      at: y.at,
      method: y.method,
      ...(y.comment ? { comment: y.comment } : {}),
    })),
  };
  if (s.audience.length) out.audience = s.audience.map((e) => entryDto(x, e));
  if (s.done.length) out.done = s.done.map((y) => ({ member: memberRef(x, y.member), at: y.at, device: y.device }));
  if (s.external) out.external = { name: s.external.name, ...(s.external.phone ? { phoneMasked: s.external.phone } : {}) };
  return out;
}

const ocrDto = (d: Doc): S['DocOcr'] | null =>
  d.ocr
    ? {
        status: d.ocr.status,
        ...(d.ocr.confidence !== undefined ? { confidence: d.ocr.confidence } : {}),
        ...(d.ocr.at ? { at: d.ocr.at } : {}),
        ...(d.ocr.lang ? { lang: d.ocr.lang } : {}),
        doubtful: d.words.filter((w) => w.st === 'doubtful').length,
      }
    : null;

export function myDto(x: DocsCtx, d: Doc, full: boolean): S['DocMy'] {
  const { L, onlyV, owner } = docLevel(x, x.me, d);
  const verbs = verbsOf(x.org, x.me);
  const lock = locked(d);
  const can: S['DocCan'] = {
    view: L >= 1,
    comment: L >= 2,
    suggest: L >= 3 && !lock,
    edit: L >= 4 && !lock,
    share: L >= 1 && (owner || x.t.owner || L === 5 || (L >= 2 && verbs.has('settings'))),
    shareExternal: x.t.owner,
    export: L >= 4 || owner || verbs.has('export') || x.t.owner,
    convert: L >= 4,
    sign: x.t.owner || verbs.has('review'),
    route: L >= 4 && !lock,
    manage: L === 5,
    locked: lock,
  };
  const my: S['DocMy'] = {
    level: levelKey(L),
    can,
    maxGrant: levelKey(Math.min(L, 4) as Level),
    wait: waitsOf(x, d, x.me),
  };
  if (onlyV) my.onlyVersion = onlyV;
  if (full) my.chain = chainDto(x, d, L, owner);
  return my;
}

function chainDto(x: DocsCtx, d: Doc, L: Level, owner: boolean): S['DocChainStep'][] {
  const f = folderOf(x, d.folder);
  const out: S['DocChainStep'][] = [];
  if (x.t.owner) out.push({ kind: 'ok', title: 'Организация', detail: 'Владелец бизнеса — управляет всем' });
  if (f) {
    out.push({
      kind: f.mode === 'listed' ? 'inh' : 'ok',
      title: `Папка «${f.name}»`,
      detail: f.mode === 'listed' ? 'Только выбранные' : 'Как у родителя',
    });
  }
  if (owner) out.push({ kind: 'ok', title: 'Владелец документа', detail: 'Управляет доступом' });
  if (d.share.some((e) => entryHits(x, x.me, e))) out.push({ kind: 'up', title: 'Доступ документа', detail: 'Есть запись в списке' });
  if (d.tmp.some((g) => g.member === x.me)) out.push({ kind: 'wait', title: 'Временный доступ маршрута', detail: 'На время шага' });
  if (isDriver(x, x.me)) out.push({ kind: isFinance(x, d) ? 'no' : 'ok', title: 'Функция «Водитель»', detail: isFinance(x, d) ? 'Финансовые документы закрыты' : 'Ограничений нет' });
  out.push({ kind: L ? 'ok' : 'no', title: 'Итог', detail: L ? `Уровень: ${levelKey(L)}` : 'Нет доступа' });
  return out;
}

export function summaryDto(x: DocsCtx, d: Doc): S['DocSummary'] {
  const f = folderOf(x, d.folder);
  const out: S['DocSummary'] = {
    id: x.U(d.id),
    kind: d.kind,
    title: d.title,
    folderId: x.U(d.folder),
    folderName: f?.name ?? '',
    owner: memberRef(x, d.owner),
    status: d.status,
    sensitivity: d.sensitivity,
    version: d.version,
    updatedAt: d.updatedAt,
    updatedBy: d.updatedBy ? memberRef(x, d.updatedBy) : null,
    links: d.links.map((l) => ({ object: { moduleKey: l.module, entityType: l.type, entityId: x.U(l.id) }, ...(l.label ? { label: l.label } : {}) })),
    my: myDto(x, d, false),
  };
  if (d.route) {
    const s = d.route.steps[d.route.cur];
    const brief: S['DocRouteBrief'] = {
      status: d.route.status,
      currentStep: d.route.cur,
      stepName: s?.name ?? null,
    };
    if (s?.due) brief.dueDate = s.due;
    out.route = brief;
  }
  const ocr = ocrDto(d);
  if (ocr) out.ocr = ocr;
  if (d.pdfaCopy) out.pdfaCopy = true;
  return out;
}

export function jobDto(x: DocsCtx, j: Job): S['DocJob'] {
  const out: S['DocJob'] = {
    id: x.U(j.id),
    op: j.op as S['DocJob']['op'],
    docIds: j.docIds.map((id) => x.U(id)),
    name: j.name,
    status: j.status,
    createdAt: j.at,
    finishedAt: j.finishedAt,
    resultDocumentId: j.resultId ? x.U(j.resultId) : null,
  };
  if (j.status === 'done') out.progress = 100;
  if (j.params) out.params = j.params;
  if (j.error) out.error = j.error;
  return out;
}

export function documentDto(x: DocsCtx, d: Doc): S['Document'] {
  const folderPath = chainOf(x, d.folder).reverse().map((f) => f.name);
  const { L } = docLevel(x, x.me, d);
  const shareVisible = L >= 4 || d.owner === x.me;
  const base = summaryDto(x, d);
  const my = myDto(x, d, true);
  const out: S['Document'] = {
    id: base.id,
    kind: base.kind,
    title: base.title,
    folderId: base.folderId,
    folderName: base.folderName,
    path: folderPath,
    owner: base.owner,
    status: base.status,
    sensitivity: base.sensitivity,
    version: base.version,
    mode: d.mode,
    shares: shareVisible ? d.share.map((e) => entryDto(x, e)) : [],
    links: base.links,
    authors: d.authors.map((a) => memberRef(x, a)),
    fields: d.fields.map((f) => ({ key: f.key, ...(f.src ? { src: f.src } : {}), ...(f.value ? { value: f.value } : {}), ...(f.from ? { from: f.from } : {}) })),
    tempGrants: shareVisible
      ? d.tmp.map((g) => ({ member: memberRef(x, g.member), level: g.level, why: g.why, ...(g.onlyVersion ? { onlyVersion: g.onlyVersion } : {}), ...(g.keep ? { keep: true } : {}) }))
      : [],
    jobs: d.jobs.map((id) => x.d.jobs.find((j) => j.id === id)).filter((j): j is Job => !!j).map((j) => jobDto(x, j)),
    protectedRanges: d.ranges.map((r) => ({ id: r.id, sheet: r.sheet, range: r.range, name: r.name, who: r.who.map((e) => entryDto(x, e)) })),
    commentCount: d.comments.length,
    openCommentCount: d.comments.filter((c) => !c.resolved).length,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    my,
    revision: d.revision,
  };
  if (d.template) out.template = d.template;
  const ext: Record<string, string> = Object.fromEntries(d.fields.map((f) => [f.key, f.value ?? '']));
  if (d.status === 'approved' || d.status === 'signed') out.frozen = ext;
  out.file = {
    id: x.U(`${d.id}.v${d.version}`),
    fileName: `${d.title}.${d.kind === 'text' ? 'docx' : d.kind === 'sheet' ? 'xlsx' : 'pdf'}`,
    contentType: d.kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument',
    sizeBytes: d.size,
    sha256: shaOf(d),
    status: 'ready',
    createdAt: d.updatedAt,
  };
  if (d.pdfaCopy) out.pdfaCopy = true;
  if (d.scan) out.scan = true;
  out.size = d.size;
  const ocr = ocrDto(d);
  if (ocr) out.ocr = ocr;
  if (d.route) out.route = routeDto(x, d.route);
  return out;
}

/** Детерминированная контрольная сумма версии (sha256-подобная строка из id и версии). */
export function shaOf(d: Pick<Doc, 'id' | 'version'>): string {
  let h = 0;
  const src = `${d.id}:${d.version}`;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(8);
}

export function folderDto(x: DocsCtx, f: Folder): S['DocFolder'] {
  const L = folderLevel(x, x.me, f.id);
  const out: S['DocFolder'] = {
    id: x.U(f.id),
    name: f.name,
    parentId: f.parent ? x.U(f.parent) : null,
    orgUnitId: f.unit ? x.U(f.unit) : null,
    mode: f.mode,
    owner: memberRef(x, f.owner),
    icon: f.icon,
    sensitivity: f.sensitivity,
    hasRouteTemplate: !!f.routeTpl,
    shares: L >= 4 ? f.share.map((e) => entryDto(x, e)) : [],
    documentCount: x.d.docs.filter((d) => d.folder === f.id && d.status !== 'archived').length,
    my: { level: levelKey(L), create: L >= 4, manage: L === 5 },
    revision: f.revision,
  };
  if (f.link) out.link = { moduleKey: f.link.module, entityType: f.link.type, entityId: x.U(f.link.id) };
  return out;
}

/** Документ по UUID пути: недоступный — 404, финансовый для «Водителя» — 403 function_blocked. */
export function docOr404(x: DocsCtx, id: string | undefined, need: Level = 1): Doc {
  const proto = x.P(id);
  const d = x.d.docs.find((y) => y.id === proto);
  if (!d) return fail('not_found', 'Документ недоступен');
  const { L } = docLevel(x, x.me, d);
  if (!L) {
    if (isFinance(x, d) && isDriver(x, x.me) && d.folder) return fail('function_blocked', 'Функция «Водитель»: финансовые документы закрыты');
    return fail('not_found', 'Документ недоступен');
  }
  if (L < need) return fail('forbidden_action', 'Недостаточно прав на документ');
  return d;
}

export const instant = (x: DocsCtx): string => x.now;
