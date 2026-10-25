// Замер, смета, версии и допработы (design/Ремонт и стройка.dc.html:845–912, 1313–1488). Чистые
// функции: объёмы из замера, строки из шаблона и справочника, суммы, сравнение версий и
// переходы сметы (черновик → отправка → подпись, отзыв, удаление). Побочные эффекты на допработы
// возвращаются списком `effects` — вызывающий передаёт их в `setChange`. Даты и номера — параметры.
import { rub } from '../../core/format.ts';
import type { ChangeOrder, ChangeStatus } from './types.ts';

export type FormulaKey =
  'floor' | 'floorDry' | 'walls' | 'wallsDry' | 'bath' | 'perim' | 'perimDry';

/** Подписи формул объёма (`FML` эталона). */
export const FORMULAS: Readonly<Record<FormulaKey, string>> = {
  floor: 'площадь пола',
  floorDry: 'пол без санузлов',
  walls: 'площадь стен',
  wallsDry: 'стены без санузлов',
  bath: 'санузлы: пол и стены',
  perim: 'периметр',
  perimDry: 'периметр без санузлов',
};

export interface Room {
  name: string;
  /** Длина, ширина, высота, проёмы — строки, как в полях ввода. */
  l: string;
  w: string;
  h: string;
  o: string;
}

/** Итоги замера: F — пол, W — стены, P — периметр; `b*` — санузлы. */
export interface Measure {
  F: number;
  W: number;
  P: number;
  bf: number;
  bw: number;
  bp: number;
}

export interface PriceItem {
  id: string;
  cat: string;
  name: string;
  unit: string;
  kind: 'work' | 'material';
  price: number;
}

/** Строка шаблона: формула объёма из замера или фиксированное количество `q`. */
export interface TemplateLine {
  sec: string;
  item: string;
  f: FormulaKey | null;
  k: number;
  q: number;
}

export interface ObjectTemplate {
  id: string;
  name: string;
  kind: string;
  src: 'ortus' | 'own';
  from?: string | null;
  copyOf?: string | null;
  upd: string;
  used: number;
  lines: TemplateLine[];
  /** Технология графика: `[этап, выработка, пауза]`. */
  tech: [string, string, string][];
  docs: string[];
  check: string[];
  /** Материалы для снабжения: `[позиция, формула, коэффициент]`. */
  mats: [string, FormulaKey | null, number][];
}

export interface EstimateLine {
  id: string;
  sec: string;
  item: string;
  name: string;
  unit: string;
  kind: 'work' | 'material';
  price: number;
  f: FormulaKey | null;
  k: number;
  qty: number;
  /** Объём введён вручную: формула не пересчитывает. */
  man: boolean;
  /** Строка действующей версии в черновике изменения: объём зафиксирован. */
  base?: boolean;
  qty0?: number;
  qtyIn?: string;
  priceIn?: string;
}

export type EstimateKind = 'first' | 'revision' | 'change';

export interface EstimateVersion {
  n: number;
  st: 'approved' | 'replaced';
  at: string;
  by: string;
  contract?: number;
  agr?: number;
  kind?: EstimateKind;
  note: string;
  lines: EstimateLine[];
  disc: number;
}

export interface EstimateDraft {
  n: number;
  kind: EstimateKind;
  st: 'draft' | 'sent';
  /** Номер версии, от которой начат черновик. */
  base: number | null;
  lines: EstimateLine[];
  disc: number;
  /** Разделы без строк (добавлены, но пока пусты). */
  secs: string[];
  /** Допработы, вошедшие в черновик. */
  co: string[];
  discIn?: string;
}

export interface ObjectEstimate {
  tpl: string;
  /** Число подписанных допсоглашений. */
  agr: number;
  vers: EstimateVersion[];
  draft: EstimateDraft | null;
}

/** Изменение допработы, которое должен выполнить вызывающий (`setChange`). */
export interface ChangeEffect {
  ids: string[];
  status: ChangeStatus;
  extra: { agreement?: number; ver?: number };
}

const CEIL_UNITS = ['шт', 'меш', 'рейс', 'компл', 'л'];

export const parseNumber = (v: unknown): number => {
  const n = Number(
    String(v ?? '')
      .replace(/\s/g, '')
      .replace(',', '.'),
  );
  return Number.isFinite(n) ? n : 0;
};

/** Итоги замера по помещениям (`measOf`). Помещение «Санузел…» считается отдельно. */
export function measOf(rooms: readonly Room[] | undefined): Measure {
  const f = (x: unknown): number => Number(x) || 0;
  const m: Measure = { F: 0, W: 0, P: 0, bf: 0, bw: 0, bp: 0 };
  for (const r of rooms ?? []) {
    const fl = f(r.l) * f(r.w);
    const pe = 2 * (f(r.l) + f(r.w));
    const wa = Math.max(0, pe * f(r.h) - f(r.o));
    m.F += fl;
    m.W += wa;
    m.P += pe;
    if (/^санузел/i.test(r.name)) {
      m.bf += fl;
      m.bw += wa;
      m.bp += pe;
    }
  }
  return m;
}

/** Значение формулы по замеру (`fval`). */
export function fval(f: FormulaKey, m: Measure): number {
  const v: Record<FormulaKey, number> = {
    floor: m.F,
    floorDry: m.F - m.bf,
    walls: m.W,
    wallsDry: m.W - m.bw,
    bath: m.bf + m.bw,
    perim: m.P,
    perimDry: m.P - m.bp,
  };
  return v[f] ?? 0;
}

/** Округление объёма: штучные единицы — вверх, остальные — до 0,1 (`rq`). */
export const rq = (v: number, unit: string): number =>
  CEIL_UNITS.includes(unit) ? Math.ceil(v - 1e-9) : Math.round(v * 10) / 10;

/** Строка сметы из строки шаблона (`lineFrom`). */
export function lineFrom(
  cat: readonly PriceItem[],
  t: TemplateLine,
  m: Measure | null,
  id: string,
): EstimateLine {
  const it: Pick<PriceItem, 'name' | 'unit' | 'kind' | 'price'> = cat.find(
    (c) => c.id === t.item,
  ) ?? { name: t.item, unit: 'шт', kind: 'work', price: 0 };
  return {
    id,
    sec: t.sec,
    item: t.item,
    name: it.name,
    unit: it.unit,
    kind: it.kind,
    price: it.price,
    f: t.f,
    k: t.k,
    qty: t.f && m ? rq(fval(t.f, m) * t.k, it.unit) : t.q,
    man: false,
  };
}

/** Объём строки: «живая» строка с формулой, без ручной правки и без базы пересчитывается по замеру. */
export const lineQty = (l: EstimateLine, m: Measure, live: boolean): number =>
  live && l.f && !l.man && !l.base ? rq(fval(l.f, m) * l.k, l.unit) : l.qty;

export interface Totals {
  sub: number;
  /** Сумма скидки. */
  d: number;
  tot: number;
}

export function totals(
  lines: readonly EstimateLine[],
  disc: number,
  m: Measure = measOf([]),
  live = false,
): Totals {
  const sub = lines.reduce((a, l) => a + lineQty(l, m, live) * l.price, 0);
  const d = (sub * (disc || 0)) / 100;
  return { sub, d, tot: sub - d };
}

/** Доля договора, закрытая подписанными актами разделов, % (Q-W4.00-repair-4). */
export function readinessByActs(
  lines: readonly EstimateLine[],
  disc: number,
  signedSections: readonly string[],
): number {
  const total = totals(lines, disc).tot;
  if (!total) return 0;
  const done = totals(
    lines.filter((l) => signedSections.includes(l.sec)),
    disc,
  ).tot;
  return Math.round((done / total) * 100);
}

export const currentVersion = (e: ObjectEstimate | null): EstimateVersion | null =>
  e ? ([...e.vers].reverse().find((v) => v.st === 'approved') ?? null) : null;

export type CompareKind = 'add' | 'del' | 'chg' | 'same';

export interface CompareRow {
  kind: CompareKind;
  line: EstimateLine;
  /** Объём после (по версии B). */
  qty: number;
  sumA: number;
  sumB: number;
  qtyChanged: boolean;
  priceChanged: boolean;
}

export interface Comparison {
  rows: CompareRow[];
  aTotal: number;
  bTotal: number;
  delta: number;
}

/** Сравнение версий A → B: добавлено, убрано, изменено (объём или цена), без изменений. */
export function compareVersions(
  a: readonly EstimateLine[],
  aDisc: number,
  b: readonly EstimateLine[],
  bDisc: number,
  m: Measure,
  live: boolean,
): Comparison {
  const am = new Map(a.map((l) => [l.id, l]));
  const bm = new Map(b.map((l) => [l.id, l]));
  const rows: CompareRow[] = [];
  for (const l of b) {
    const prev = am.get(l.id);
    const q1 = lineQty(l, m, live);
    if (!prev) {
      rows.push({
        kind: 'add',
        line: l,
        qty: q1,
        sumA: 0,
        sumB: q1 * l.price,
        qtyChanged: false,
        priceChanged: false,
      });
      continue;
    }
    const qtyChanged = Math.abs(prev.qty - q1) > 1e-6;
    const priceChanged = prev.price !== l.price;
    rows.push({
      kind: qtyChanged || priceChanged ? 'chg' : 'same',
      line: l,
      qty: q1,
      sumA: prev.qty * prev.price,
      sumB: q1 * l.price,
      qtyChanged,
      priceChanged,
    });
  }
  for (const prev of a) {
    if (bm.has(prev.id)) continue;
    const row: CompareRow = {
      kind: 'del',
      line: prev,
      qty: prev.qty,
      sumA: prev.qty * prev.price,
      sumB: 0,
      qtyChanged: false,
      priceChanged: false,
    };
    const i = rows.map((r) => r.line.sec).lastIndexOf(prev.sec);
    if (i >= 0) rows.splice(i + 1, 0, row);
    else rows.push(row);
  }
  const aTotal = totals(a, aDisc).tot;
  const bTotal = totals(b, bDisc, m, live).tot;
  return { rows, aTotal, bTotal, delta: bTotal - aTotal };
}

/** Статус допработы с точки зрения сметы: допработа в черновике — «оценена» или «у заказчика». */
export function effectiveChangeStatus(
  c: Pick<ChangeOrder, 'id' | 'status'>,
  draft: Pick<EstimateDraft, 'co' | 'st'> | null,
): ChangeStatus {
  if (draft?.co.includes(c.id)) return draft.st === 'sent' ? 'sent' : 'priced';
  return c.status === 'signed' || c.status === 'rejected' ? c.status : 'proposed';
}

export interface TemplateStats {
  sections: number;
  lines: number;
  fromMeasure: number;
}

export function templateStats(t: ObjectTemplate): TemplateStats {
  return {
    sections: new Set(t.lines.map((l) => l.sec)).size,
    lines: t.lines.length,
    fromMeasure: t.lines.filter((l) => l.f).length,
  };
}

/** Копия шаблона (`onCopy`): свой, без привязки к объекту, правки не меняют исходный. */
export function copyTemplate(t: ObjectTemplate, id: string, at: string): ObjectTemplate {
  return {
    ...structuredClone(t),
    id,
    name: t.name + ' · копия',
    src: 'own',
    from: null,
    copyOf: t.name,
    upd: at,
    used: 0,
  };
}

export interface NewPriceItem {
  name: string;
  unit: string;
  kind: 'work' | 'material';
  cat: string;
  price: string | number;
}

/** Новая позиция справочника: проверки и тексты ошибок как в эталоне. */
export function addPriceItem(
  cat: readonly PriceItem[],
  input: NewPriceItem,
  id: string,
): { error: string } | { item: PriceItem } {
  const name = input.name.trim();
  const price = parseNumber(input.price);
  if (name.length < 3) return { error: 'Укажите название позиции' };
  if (!(price > 0)) return { error: 'Укажите цену больше нуля' };
  if (cat.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return { error: 'Такая позиция уже есть в справочнике' };
  }
  return { item: { id, cat: input.cat, name, unit: input.unit, kind: input.kind, price } };
}

/** Черновик первой версии по шаблону и замеру (`createFromTpl`). */
export function createDraftFromTemplate(
  t: ObjectTemplate,
  cat: readonly PriceItem[],
  m: Measure,
): ObjectEstimate {
  return {
    tpl: t.id,
    agr: 0,
    vers: [],
    draft: {
      n: 1,
      kind: 'first',
      st: 'draft',
      base: null,
      lines: t.lines.map((l, i) => lineFrom(cat, l, m, 'n' + (i + 1))),
      disc: 0,
      secs: [],
      co: [],
    },
  };
}

function need(e: ObjectEstimate): EstimateDraft {
  if (!e.draft) throw new Error('У сметы нет черновика');
  return e.draft;
}

const signed = (x: number): string => (x >= 0 ? '+' : '−') + rub(Math.abs(x));

export interface StartChangeResult {
  estimate: ObjectEstimate;
  effects: ChangeEffect[];
  /** Раздел, в котором открыт выбор строк из справочника. */
  pick: string | null;
  note: string | null;
}

/** Строки допработы по подсказке прораба (`coLines`). */
const changeLines = (c: ChangeOrder, cat: readonly PriceItem[]): EstimateLine[] =>
  (c.suggest ?? []).map(([item, q], i) =>
    lineFrom(
      cat,
      { sec: 'Допработы · ' + c.id, item, f: null, k: 1, q },
      null,
      c.id + '-' + String(i),
    ),
  );

/**
 * Новая версия сметы от действующей (`startChange`): допсоглашение после договора (`change`) или
 * новая версия до договора (`revision`). Если черновик уже есть, допработа добавляется в него.
 */
export function startChange(
  e: ObjectEstimate,
  c: ChangeOrder | null,
  cat: readonly PriceItem[],
  opts: { isDraftObject: boolean },
): StartChangeResult {
  const cur = currentVersion(e);
  const extra = c ? changeLines(c, cat) : [];
  const sec = c ? 'Допработы · ' + c.id : null;
  const emptySec = sec && !extra.length ? sec : null;
  let draft: EstimateDraft;
  if (e.draft) {
    const d = e.draft;
    draft = {
      ...d,
      lines: [...d.lines, ...extra],
      secs: emptySec ? [...d.secs, emptySec] : d.secs,
      co: c ? [...d.co, c.id] : d.co,
    };
  } else {
    if (!cur) throw new Error('Нет согласованной версии сметы: изменять нечего');
    draft = {
      n: e.vers.length + 1,
      kind: opts.isDraftObject ? 'revision' : 'change',
      st: 'draft',
      base: cur.n,
      lines: [...cur.lines.map((l) => ({ ...l, base: true, qty0: l.qty })), ...extra],
      disc: cur.disc,
      secs: emptySec ? [emptySec] : [],
      co: c ? [c.id] : [],
    };
  }
  return {
    estimate: { ...e, draft },
    effects: c ? [{ ids: [c.id], status: 'priced', extra: {} }] : [],
    pick: emptySec,
    note: c
      ? c.id +
        ' «' +
        c.title +
        '» в черновике версии ' +
        draft.n +
        (extra.length
          ? ': строки подставлены по описанию прораба. Проверьте объёмы и цены, затем отправьте допсоглашение заказчику.'
          : ': добавьте строки из справочника, затем отправьте допсоглашение заказчику.')
      : null,
  };
}

export interface SendResult {
  estimate: ObjectEstimate;
  effects: ChangeEffect[];
  /** Номер допсоглашения; `null` — отправлена версия до договора. */
  agreement: number | null;
  delta: number;
  note: string;
}

/** Отправка заказчику: объёмы фиксируются на момент отправки (`sendE`). */
export function sendDraft(e: ObjectEstimate, m: Measure): SendResult {
  const d = need(e);
  const chg = d.kind === 'change';
  const k = e.agr + 1;
  const lines = d.lines.map((l) => ({ ...l, qty: lineQty(l, m, true) }));
  const prev = currentVersion(e);
  const delta = totals(lines, d.disc).tot - (prev ? totals(prev.lines, prev.disc).tot : 0);
  return {
    estimate: { ...e, draft: { ...d, st: 'sent', lines } },
    effects: chg && d.co.length ? [{ ids: d.co, status: 'sent', extra: { agreement: k } }] : [],
    agreement: chg ? k : null,
    delta,
    note: chg
      ? 'Допсоглашение № ' +
        k +
        ' отправлено в кабинет заказчика: ' +
        signed(delta) +
        ' к договору. Подпись — кодом из SMS.'
      : 'Версия ' + d.n + ' отправлена в кабинет заказчика на согласование.',
  };
}

export interface RecallResult {
  estimate: ObjectEstimate;
  effects: ChangeEffect[];
  /** Номер допсоглашения, документ которого нужно убрать. */
  agreement: number;
  note: string;
}

export function recallDraft(e: ObjectEstimate): RecallResult {
  const d = need(e);
  return {
    estimate: { ...e, draft: { ...d, st: 'draft' } },
    effects: d.kind === 'change' && d.co.length ? [{ ids: d.co, status: 'priced', extra: {} }] : [],
    agreement: e.agr + 1,
    note: 'Отправка отозвана: заказчик больше не видит эту версию. Черновик снова можно править.',
  };
}

export interface ApproveResult {
  estimate: ObjectEstimate;
  effects: ChangeEffect[];
  note: string;
}

/** Подпись или согласование заказчиком: версия начинает действовать (`approveE`). */
export function approveDraft(
  e: ObjectEstimate,
  m: Measure,
  who: { at: string; by: string },
): ApproveResult {
  const d = need(e);
  const chg = d.kind === 'change';
  const k = chg ? e.agr + 1 : e.agr;
  const live = d.st === 'draft';
  const lines = d.lines.map((l): EstimateLine => {
    const rest: EstimateLine = { ...l, qty: lineQty(l, m, live) };
    delete rest.qtyIn;
    delete rest.priceIn;
    delete rest.base;
    delete rest.qty0;
    return rest;
  });
  const prev = currentVersion(e);
  const total = totals(lines, d.disc).tot;
  const delta = prev ? total - totals(prev.lines, prev.disc).tot : 0;
  const v: EstimateVersion = {
    n: d.n,
    st: 'approved',
    at: who.at,
    by: who.by,
    kind: d.kind,
    agr: chg ? k : 0,
    lines,
    disc: d.disc,
    note: chg
      ? 'Допсоглашение № ' +
        k +
        ' подписано заказчиком кодом из SMS' +
        (d.co.length ? '. Допработы: ' + d.co.join(', ') : '')
      : 'Согласована заказчиком в кабинете',
  };
  return {
    estimate: {
      ...e,
      agr: k,
      draft: null,
      vers: [
        ...e.vers.map((x) => (x.st === 'approved' ? { ...x, st: 'replaced' as const } : x)),
        v,
      ],
    },
    effects:
      chg && d.co.length
        ? [{ ids: d.co, status: 'signed', extra: { agreement: k, ver: d.n } }]
        : [],
    note: chg
      ? 'Допсоглашение № ' +
        k +
        ' подписано. Действует версия ' +
        d.n +
        ': ' +
        rub(total) +
        ' (' +
        signed(delta) +
        ').' +
        (d.co.length ? ' Работы добавлены прорабу во вкладку «Работы».' : '')
      : 'Смета согласована заказчиком: ' +
        rub(total) +
        '. Следующий шаг — договор на этапе заявки «Договор».',
  };
}

export interface DropResult {
  /** `null` — у сметы не было версий, она исчезает. */
  estimate: ObjectEstimate | null;
  effects: ChangeEffect[];
  note: string;
}

export function dropDraft(e: ObjectEstimate): DropResult {
  const d = need(e);
  return {
    estimate: e.vers.length ? { ...e, draft: null } : null,
    effects: d.co.length ? [{ ids: d.co, status: 'proposed', extra: {} }] : [],
    note: d.co.length
      ? 'Черновик удалён. ' + d.co.join(', ') + ' снова ждёт оценки.'
      : 'Черновик удалён.',
  };
}
