// W4.32 · Модель «Базы знаний» (эталон design-2026-10-19 «База знаний.dc.html», логика М:379–727): справочники и
// тоны, даты сида по Москве, карточки пространств, дерево, путь, мета и блоки страницы, ознакомление, меню, редактор,
// участники и карта доступа, правила, архив, строки диалогов (шаблон, «Где создать», влияние переноса и доступа).
// Только чистые функции над схемами контракта 0.9.0-stage4 — запросы и команды в api.ts.
import type { components } from '@ortus/api-client';

type S = components['schemas'];
export type Space = S['KnowledgeSpace'];
export type Summary = S['KnowledgeNodeSummary'];
export type KbNode = S['KnowledgeNode'];
export type Kind = Summary['kind'];
export type Status = Summary['status'];
export type Mode = Summary['accessMode'];
export type Level = Space['access'];
export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

// ---------------------------------------------------------------------------------------------
// Справочники (KJ KB_ACCESS, KB_KINDS, KB_STATUS; тоны TONE М:379)

/** Значок и тон уровня пространства (подписи — @ortus/texts `knowledge.levels`). */
export const LEVEL_ICON: Readonly<Record<Level, { icon: string; tone: Tone }>> = {
  open: { icon: 'public', tone: 'ok' },
  limited: { icon: 'visibility', tone: 'info' },
  closed: { icon: 'lock', tone: 'neutral' },
};

/** Значок вида узла. */
export const KIND_ICON: Readonly<Record<Kind, string>> = {
  page: 'description',
  folder: 'folder',
  table: 'table_view',
  diagram: 'schema',
  file: 'picture_as_pdf',
  link: 'dynamic_form',
};

/** Тон и значок статуса узла. */
export const STATUS_LOOK: Readonly<Record<Status, { tone: Tone; icon: string }>> = {
  active: { tone: 'ok', icon: 'check_circle' },
  draft: { tone: 'warn', icon: 'edit_note' },
  review: { tone: 'warn', icon: 'rate_review' },
  outdated: { tone: 'danger', icon: 'event_busy' },
};

/** Значки шаблона «Новое пространство» (KJ KB_ICONS) и цвета (KB_COLORS). */
export const SPACE_ICONS = [
  'menu_book',
  'local_shipping',
  'construction',
  'spa',
  'health_and_safety',
  'apartment',
  'school',
  'rule',
] as const;
export const SPACE_COLORS = [
  '#1F6B52',
  '#2B5479',
  '#7A5214',
  '#6B4A7A',
  '#A13A33',
  '#3A4844',
] as const;

/** Цвета аватаров (AV М:380). */
const AV = ['#1F6B52', '#2B5479', '#7A5214', '#6B4A7A', '#3A4844', '#A13A33'] as const;

/** Инициалы (ini М:381). */
export const initialsOf = (name: string | undefined): string =>
  String(name || '?')
    .split(/\s+/)
    .map((x) => x[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** Цвет аватара по имени (avc М:382). */
export const avatarOf = (name: string | undefined): string =>
  AV[[...String(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length] ?? AV[0];

/** Абзацы текста версии (paras М:383). */
export const paragraphs = (t: string | undefined): string[] =>
  String(t || '')
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Выдержка (short М:384). */
export const excerpt = (t: string | undefined, n: number): string => {
  const x = String(t || '')
    .replace(/\s+/g, ' ')
    .trim();
  return x.length > n ? x.slice(0, n - 1) + '…' : x;
};

export const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------
// Даты: моменты контракта — даты сида по Москве (пояс организаций эталона).

export const ZONE = 'Europe/Moscow';

function parts(iso: string): Record<string, string> {
  const f = new Intl.DateTimeFormat('ru-RU', {
    timeZone: ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(f.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** «ДД.ММ.ГГГГ» (версии, обновления, сроки). */
export function dayOf(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d\d-\d\d$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }
  const p = parts(iso);
  return `${p.day}.${p.month}.${p.year}`;
}

/** «ДД.ММ ЧЧ:ММ» (журнал запусков, KJ ddmmHHMM). */
export function stampOf(iso: string): string {
  const p = parts(iso);
  return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
}

/** «ДД.ММ.ГГГГ ЧЧ:ММ» (запрос доступа, KJ today + hm). */
export function momentOf(iso: string): string {
  const p = parts(iso);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

// ---------------------------------------------------------------------------------------------
// Дерево пространства (visTree, pagesVM М:480–501)

export interface TreeIndex {
  nodes: readonly Summary[];
  byId: ReadonlyMap<string, Summary>;
  kids: (id: string | null) => Summary[];
  /** Видимые предки узла от верхнего уровня (без самого узла). */
  path: (id: string) => Summary[];
}

export function indexTree(nodes: readonly Summary[]): TreeIndex {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kidsOf = new Map<string | null, Summary[]>();
  for (const n of nodes) {
    const p = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    const list = kidsOf.get(p) ?? [];
    list.push(n);
    kidsOf.set(p, list);
  }
  for (const list of kidsOf.values()) list.sort((a, b) => a.position - b.position);
  const path = (id: string): Summary[] => {
    const out: Summary[] = [];
    let x = byId.get(id);
    for (let g = 0; x && g < 40; g++) {
      const parent: Summary | undefined = x.parentId ? byId.get(x.parentId) : undefined;
      if (parent) out.unshift(parent);
      x = parent;
    }
    return out;
  };
  return { nodes, byId, kids: (id) => kidsOf.get(id) ?? [], path };
}

/** Главная страница пространства: `homeNodeId` или первый узел верхнего уровня. */
export const homeOf = (space: Space, t: TreeIndex): Summary | undefined =>
  (space.homeNodeId ? t.byId.get(space.homeNodeId) : undefined) ?? t.kids(null)[0];

/** Раскрытые узлы при входе: путь к выбранному узлу (openSpace М:419–424). */
export function openPath(t: TreeIndex, id: string | undefined): Set<string> {
  return new Set(id ? [...t.path(id).map((x) => x.id)] : []);
}

export interface TreeRow {
  id: string;
  title: string;
  icon: string;
  depth: number;
  hasKids: boolean;
  open: boolean;
  selected: boolean;
  /** Чип статуса, кроме «Действует» (строчными). */
  chip: { label: string; tone: Tone } | null;
  fin: boolean;
  lock: boolean;
  /** Путь совпадения поиска «Найти в пространстве». */
  where: string | null;
}

/** Строки дерева: обход раскрытых узлов или плоский список совпадений с путём (М:498–499). */
export function treeRows(
  t: TreeIndex,
  o: {
    open: ReadonlySet<string>;
    selected: string | undefined;
    statusLabel: (s: Status) => string;
    /** Совпадения поиска (id), путь — по дереву. */
    matches?: readonly string[] | null;
  },
): TreeRow[] {
  const row = (n: Summary, depth: number, where: string | null): TreeRow => {
    const hasKids = t.kids(n.id).length > 0;
    const open = o.open.has(n.id);
    const chip =
      n.status !== 'active'
        ? { label: o.statusLabel(n.status).toLowerCase(), tone: STATUS_LOOK[n.status].tone }
        : null;
    return {
      id: n.id,
      title: n.title,
      icon: n.kind === 'folder' && open ? 'folder_open' : KIND_ICON[n.kind],
      depth,
      hasKids,
      open,
      selected: n.id === o.selected,
      chip,
      fin: n.sensitivity === 'finance',
      lock: n.accessMode !== 'inherit',
      where,
    };
  };
  if (o.matches) {
    return o.matches.flatMap((id) => {
      const n = t.byId.get(id);
      if (!n) return [];
      const where = t
        .path(id)
        .map((x) => x.title)
        .join(' › ');
      return [row(n, 0, where || null)];
    });
  }
  const out: TreeRow[] = [];
  const walk = (id: string | null, d: number): void => {
    for (const n of t.kids(id)) {
      out.push(row(n, d, null));
      if (o.open.has(n.id)) walk(n.id, d + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Совпадения названия для одного символа поиска (сервер ищет от двух). */
export const titleMatches = (t: TreeIndex, q: string): string[] =>
  t.nodes.filter((n) => n.title.toLowerCase().includes(q.toLowerCase())).map((n) => n.id);

/** Варианты «Где создать» / «Новый родитель»: дерево с отступом (treeOpts М:601). */
export function treeOptions(
  t: TreeIndex,
  pred: (n: Summary) => boolean,
): { v: string; t: string }[] {
  const out: { v: string; t: string }[] = [];
  const walk = (id: string | null, d: number): void => {
    for (const n of t.kids(id)) {
      if (pred(n)) out.push({ v: n.id, t: ' '.repeat(d * 3) + (d ? '└ ' : '') + n.title });
      walk(n.id, d + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Узел и все его видимые потомки (kbSubtree). */
export function subtreeIds(t: TreeIndex, id: string): Set<string> {
  const out = new Set<string>([id]);
  const walk = (x: string): void => {
    for (const k of t.kids(x)) {
      out.add(k.id);
      walk(k.id);
    }
  };
  walk(id);
  return out;
}

/** Создание доступно: у пространства или у любого видимого узла (canCreate М:501). */
export const canCreateIn = (space: Space, t: TreeIndex): boolean =>
  space.my.create || t.nodes.some((n) => n.my.create);

/** Где можно создавать: узлы с `my.create`, кроме файлов и записей CRM. */
export const creatable = (n: Summary): boolean =>
  n.my.create && n.kind !== 'file' && n.kind !== 'link';

// ---------------------------------------------------------------------------------------------
// Вкладки пространства (spaceVM М:466–467)

export type TabKey = 'pages' | 'people' | 'auto' | 'arch';

export function tabsOf(space: Space): { key: TabKey; badge: number }[] {
  const reqs = space.my.lead ? (space.openRequestCount ?? 0) : 0;
  const out: { key: TabKey; badge: number }[] = [
    { key: 'pages', badge: 0 },
    { key: 'people', badge: reqs },
  ];
  if (space.my.lead) out.push({ key: 'auto', badge: 0 });
  if (space.my.edit || space.my.lead) out.push({ key: 'arch', badge: 0 });
  return out;
}

export const tabOf = (space: Space, want: string | undefined): TabKey =>
  tabsOf(space).some((t) => t.key === want) ? (want as TabKey) : 'pages';

// ---------------------------------------------------------------------------------------------
// Страница (pageVM М:505–550)

/** Главная страница пространства не переносится и не архивируется. */
export const isHome = (space: Space, n: { id: string; parentId: string | null; title: string }) =>
  n.id === space.homeNodeId || (!n.parentId && n.title === 'Обзор');

export type MenuKey = 'child' | 'move' | 'approve' | 'archive';

/** Пункты «Действия со страницей» по правам (М:516–520). */
export function menuOf(space: Space, n: KbNode): MenuKey[] {
  const out: MenuKey[] = [];
  const home = isHome(space, n);
  if (n.my.create && n.kind !== 'file' && n.kind !== 'link') out.push('child');
  if (n.my.edit && !home) out.push('move');
  if (n.status === 'review' && n.my.edit && space.my.edit) out.push('approve');
  if ((space.my.edit || space.my.lead) && !home) out.push('archive');
  return out;
}

/** Ближайший узел пути со своим доступом (ex М:511): сам узел, предок из дерева или нет. */
export function ownAccessOf(
  t: TreeIndex,
  n: KbNode,
): { self: boolean; title: string; mode: Mode } | null {
  if (n.accessMode !== 'inherit') return { self: true, title: n.title, mode: n.accessMode };
  const anc = [...n.path]
    .reverse()
    .map((p) => t.byId.get(p.id))
    .find((x) => x && x.accessMode !== 'inherit');
  return anc ? { self: false, title: anc.title, mode: anc.accessMode } : null;
}

/** Части мета-строки: вид · владелец · обновлено · пересмотреть до (М:543). */
export function metaParts(n: KbNode): {
  kind: Kind;
  owner: string;
  updated: { date: string; by: string } | null;
  review: string | null;
} {
  return {
    kind: n.kind,
    owner: n.owner.displayName || '—',
    updated: n.current.publishedAt
      ? { date: dayOf(n.current.publishedAt), by: n.current.authorDisplayName }
      : null,
    review: n.reviewBy ? dayOf(n.reviewBy) : null,
  };
}

/** Исходы схемы: стрелка вверх-вниз при двух исходах (М:546). */
export function diagramOuts(
  d: S['KnowledgeDiagram'] | undefined,
): { t: string; arrow: string; tone: 'ok' | 'warn' }[] {
  const out = d?.outcomes ?? [];
  return out.map((o, i) => ({
    t: o.text,
    tone: o.tone,
    arrow: out.length > 1 ? (i === 0 ? 'north_east' : 'south_east') : 'arrow_forward',
  }));
}

export interface TableView {
  id: string;
  title: string;
  cols: string[];
  rows: string[][];
  /** `form` — строки из ответов формы; иначе — число строк; `empty` — пустая таблица узла-таблицы. */
  note: { kind: 'form' } | { kind: 'count'; n: number } | { kind: 'empty' };
}

/** Таблицы страницы только для чтения; узел-таблица без таблиц — пустая «Дата / Что / Кто» (М:532–533). */
export function tablesOf(n: KbNode, emptyCols: readonly string[]): TableView[] {
  const out: TableView[] = n.tables.map((t) => ({
    id: t.id,
    title: t.title,
    cols: t.columns.map((c) => c.name),
    rows: t.rows.map((r) => t.columns.map((c) => r.cells[c.id] || '—')),
    note: t.rows.some((r) => r.source) ? { kind: 'form' } : { kind: 'count', n: t.rows.length },
  }));
  if (n.kind === 'table' && !out.length) {
    out.push({ id: n.id, title: n.title, cols: [...emptyCols], rows: [], note: { kind: 'empty' } });
  }
  return out;
}

export interface AckView {
  title: { v: number; audience: string };
  /** Статистика редактору и руководителю. */
  stats: { pct: string; done: number; total: number; names: string; more: number } | null;
  /** «Ознакомлен» — участник из аудитории, ещё не подтвердил, смотрит текущую версию. */
  ask: boolean;
  done: boolean;
  /** Рамка и фон приглашения подтвердить. */
  highlight: boolean;
}

/** Блок ознакомления (М:522–531): виден аудитории и тем, кому показана статистика. */
export function ackOf(n: KbNode, old: boolean): AckView | null {
  const a = n.ack;
  if (!a) return null;
  const hasStats = a.total !== undefined;
  if (!a.mine.required && !hasStats) return null;
  const total = a.total ?? 0;
  const done = a.doneCount ?? 0;
  const pending = a.pendingNames ?? [];
  return {
    title: { v: a.version, audience: a.audienceLabel },
    stats: hasStats
      ? {
          pct: (total ? Math.round((done / total) * 100) : 0) + '%',
          done,
          total,
          names: pending.slice(0, 5).join(', '),
          more: Math.max(0, pending.length - 5),
        }
      : null,
    ask: a.mine.required && !a.mine.done && !old,
    done: a.mine.required && a.mine.done,
    highlight: a.mine.required && !a.mine.done,
  };
}

/** Подстраницы: видимые дети узла (не у файла и записи CRM). */
export const kidsOf = (t: TreeIndex, n: KbNode): Summary[] =>
  n.kind === 'file' || n.kind === 'link' ? [] : t.kids(n.id);

/** Черновик правки из текущей версии (onEdit М:539). */
export interface Draft {
  id: string;
  title: string;
  body: string;
  steps: string;
  ack: boolean;
  base: number;
}

export const draftOf = (n: KbNode): Draft => ({
  id: n.id,
  title: n.title,
  body: n.current.body || '',
  steps: (n.diagram?.steps ?? []).join('\n'),
  ack: !!n.ack,
  base: n.version,
});

/** Тело публикации (onSave М:560): шаги — только у схемы, ознакомление — если у страницы оно есть. */
export function publishBody(d: Draft, n: KbNode): S['KnowledgePublish'] {
  const out: S['KnowledgePublish'] = { title: d.title, body: d.body };
  if (n.kind === 'diagram') out.steps = d.steps.split('\n');
  if (d.ack && n.ack) out.requestAck = true;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Участники и карта (peopleVM М:676–710)

export type Cell = S['KnowledgeAccessMap']['cells'][number][number];

export const CELL_LOOK: Readonly<Record<Cell, { icon: string; tone: 'e' | 'r' | 'n' | 'f' }>> = {
  edit: { icon: 'edit', tone: 'e' },
  view: { icon: 'visibility', tone: 'r' },
  none: { icon: 'visibility_off', tone: 'n' },
  function: { icon: 'block', tone: 'f' },
};

/** Ширина сетки карты (gridCols, minW М:701). */
export const mapGrid = (n: number): { cols: string; minW: string } => ({
  cols: `minmax(180px,1fr) repeat(${n},84px)`,
  minW: `${200 + n * 88}px`,
});

/** Итог «Проверить сотрудника» (М:707): тон и значок. */
export function verdictOf(x: S['KnowledgeAccessExplanation'] | null | undefined): {
  tone: Tone;
  icon: string;
} {
  if (!x) return { tone: 'neutral', icon: 'info' };
  if (x.edit) return { tone: 'ok', icon: 'edit' };
  if (x.view) return { tone: 'info', icon: 'visibility' };
  return { tone: 'danger', icon: 'visibility_off' };
}

/** Значок шага цепочки (ST М:705). */
export const STEP_LOOK: Readonly<
  Record<S['KnowledgeAccessStep']['kind'], { icon: string; fg: string }>
> = {
  ok: { icon: 'check_circle', fg: '#1F6B52' },
  no: { icon: 'cancel', fg: '#A13A33' },
  wait: { icon: 'schedule', fg: '#B7791F' },
  inherit: { icon: 'subdirectory_arrow_right', fg: '#5C6964' },
};

// ---------------------------------------------------------------------------------------------
// Автоматизация (autoVM М:712–721)

export const RUN_LOOK: Readonly<Record<S['KnowledgeRun']['result'], { icon: string; fg: string }>> =
  {
    ok: { icon: 'check_circle', fg: '#1F6B52' },
    warn: { icon: 'warning', fg: '#B7791F' },
    stopped: { icon: 'do_not_disturb_on', fg: '#6B7873' },
    error: { icon: 'error', fg: '#A13A33' },
  };

// ---------------------------------------------------------------------------------------------
// Диалоги (dlgVM М:579–674)

/** Узлы шаблона с отступом и чипом; отметка папки отмечает её подстраницы (toggle М:587). */
export function toggleTemplateNode(
  nodes: readonly S['KnowledgeTemplateNode'][],
  picked: ReadonlySet<number>,
  i: number,
): Set<number> {
  const set = new Set(picked);
  const x = nodes[i];
  if (!x) return set;
  const on = !set.has(i);
  if (on) set.add(i);
  else set.delete(i);
  if (x.parentIndex === null) {
    for (let j = i + 1; j < nodes.length && nodes[j]?.parentIndex !== null; j++) {
      if (on) set.add(j);
      else set.delete(j);
    }
  }
  if (x.parentIndex !== null && on) set.add(x.parentIndex);
  return set;
}

export type TemplateChip =
  { kind: 'role'; role: string } | { kind: 'ack' } | { kind: 'parent' } | { kind: 'space' };

/** Чип узла шаблона (М:596). */
export const templateChip = (x: S['KnowledgeTemplateNode']): TemplateChip =>
  x.readerRoleLabel
    ? { kind: 'role', role: x.readerRoleLabel }
    : x.requestAck
      ? { kind: 'ack' }
      : x.parentIndex !== null
        ? { kind: 'parent' }
        : { kind: 'space' };

/** Области «Новое пространство»: вся организация, регионы и их фирмы (М:592). */
export function unitOptions(
  units: readonly S['OrgUnit'][],
): { v: string; kind: 'tenant' | 'region' | 'firm'; name: string }[] {
  const out: { v: string; kind: 'tenant' | 'region' | 'firm'; name: string }[] = [
    { v: '', kind: 'tenant', name: '' },
  ];
  const active = units.filter((u) => u.status === 'active');
  for (const r of active.filter((u) => u.kind === 'region')) {
    out.push({ v: r.id, kind: 'region', name: r.name });
    for (const f of active.filter((u) => u.kind === 'company' && u.parentId === r.id)) {
      out.push({ v: f.id, kind: 'firm', name: f.name });
    }
  }
  return out;
}

/** «Ф И · N» — строки влияния: ФИО и число страниц. */
export const impactNames = (list: readonly S['KnowledgeImpactPerson'][]): string =>
  list.map((p) => `${p.displayName} · ${p.pages}`).join(', ');

export type ImpactLine =
  | { key: 'gainView' | 'gainEdit' | 'loseView' | 'loseEdit'; names: string }
  | { key: 'dead'; names: string }
  | { key: 'noChange' }
  | { key: 'pick' };

const TONE_OF: Readonly<Record<string, { tone: Tone; icon: string }>> = {
  gainView: { tone: 'ok', icon: 'add_circle' },
  gainEdit: { tone: 'ok', icon: 'edit' },
  loseView: { tone: 'danger', icon: 'remove_circle' },
  loseEdit: { tone: 'warn', icon: 'edit_off' },
  dead: { tone: 'warn', icon: 'warning' },
  noChange: { tone: 'neutral', icon: 'do_not_disturb_on' },
  pick: { tone: 'neutral', icon: 'info' },
  nobody: { tone: 'neutral', icon: 'do_not_disturb_on' },
  pages: { tone: 'info', icon: 'account_tree' },
};

export const lineLook = (key: string): { tone: Tone; icon: string } =>
  TONE_OF[key] ?? { tone: 'neutral', icon: 'info' };

/** «Что изменится» (М:648–659): изменений нет — «Ни у кого…», с записями, не проходящими уровни выше. */
export function accessImpactLines(
  dirty: boolean,
  imp: S['KnowledgeAccessImpact'] | null | undefined,
  dead: readonly string[],
): ImpactLine[] {
  if (!dirty || !imp) return [{ key: 'pick' }];
  const out: ImpactLine[] = [];
  if (imp.gainView.length) out.push({ key: 'gainView', names: impactNames(imp.gainView) });
  if (imp.gainEdit.length) out.push({ key: 'gainEdit', names: impactNames(imp.gainEdit) });
  if (imp.loseView.length) out.push({ key: 'loseView', names: impactNames(imp.loseView) });
  if (imp.loseEdit.length) out.push({ key: 'loseEdit', names: impactNames(imp.loseEdit) });
  if (!out.length)
    out.push(dead.length ? { key: 'dead', names: dead.join(', ') } : { key: 'noChange' });
  return out;
}

/** Запись списка доступа без подписи и охвата — тело команды (`KnowledgeAccessEntryInput`). */
export function entryInput(e: S['KnowledgeAccessEntryInput']): S['KnowledgeAccessEntryInput'] {
  const out: S['KnowledgeAccessEntryInput'] = { who: e.who, can: e.can };
  if (e.refId) out.refId = e.refId;
  if (e.relation) out.relation = e.relation;
  if (e.object) out.object = e.object;
  if (e.orgUnitId) out.orgUnitId = e.orgUnitId;
  return out;
}

/** Та же запись (кто, область, объект) — «Уже есть в списке» (М:667). */
export const sameEntry = (
  a: S['KnowledgeAccessEntryInput'],
  b: S['KnowledgeAccessEntryInput'],
): boolean =>
  a.who === b.who &&
  (a.refId ?? '') === (b.refId ?? '') &&
  (a.orgUnitId ?? '') === (b.orgUnitId ?? '') &&
  (a.object?.entityId ?? '') === (b.object?.entityId ?? '');

/** Предупреждение записи (М:642): все не проходят — причина первого; часть — их имена. */
export function entryWarning(
  reach: S['KnowledgeAccessReach'] | undefined,
): { kind: 'one'; why: string } | { kind: 'some'; names: string; why: string } | null {
  if (!reach || !reach.blocked.length) return null;
  const why = reach.blocked[0]?.reason ?? '';
  if (reach.total && !reach.members) return { kind: 'one', why };
  return { kind: 'some', names: reach.blocked.map((x) => x.displayName).join(', '), why };
}

/** Быстрая кнопка «Добавить в пространство читателем»: сотрудник не участник пространства (М:643). */
export const quickReader = (
  e: S['KnowledgeAccessEntryInput'],
  reach: S['KnowledgeAccessReach'] | undefined,
): boolean =>
  e.who === 'member' &&
  !!reach?.blocked.length &&
  /не участник/.test(reach.blocked[0]?.reason ?? '');
