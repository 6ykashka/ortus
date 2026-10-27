// W6.21 · Модель вкладки «Смета»: чистые функции над ответами контракта 0.12.0-stage6 (эталон design-2026-10-19
// «Ремонт и стройка.dc.html» estVM :1384–1488). Чипы — тон и иконка эталона (ch :838), подписи — дословно.
import type { components } from '@ortus/api-client';

import { fmtNum } from '../measure/calc.ts';
import { dm, kTxt, rub, signed, unitLabel } from './format.ts';

type S = components['schemas'];
type Estimate = S['Estimate'];
type Line = S['EstimateLine'];

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

export interface Chip {
  label: string;
  tone: Tone;
  icon: string;
}

const chip = (label: string, tone: Tone, icon: string): Chip => ({ label, tone, icon });

/** Объект в части, нужной смете. */
export interface ProjectInfo {
  status: S['RepairProject']['status'];
  contractNo?: string | undefined;
}

/** FML эталона (:844) по ключам формулы контракта. */
export const FORMULA_LABEL: Readonly<Record<NonNullable<Line['formula']>, string>> = {
  floor: 'площадь пола',
  floor_dry: 'пол без санузлов',
  walls: 'площадь стен',
  walls_dry: 'стены без санузлов',
  wet: 'санузлы: пол и стены',
  perimeter: 'периметр',
  perimeter_dry: 'периметр без санузлов',
};

/** REJ эталона (:912) по кодам контракта. */
export const REJECT_REASONS: readonly { code: S['RepairRejectReason']; label: string }[] = [
  { code: 'already_in_estimate', label: 'Работа уже есть в смете' },
  { code: 'client_refused', label: 'Заказчик отказался' },
  { code: 'warranty', label: 'Сделаем по гарантии' },
  { code: 'not_agreed_with_client', label: 'Не согласовано с заказчиком' },
];

export const reasonLabel = (code: S['RepairRejectReason'] | undefined): string =>
  REJECT_REASONS.find((r) => r.code === code)?.label ?? '';

export interface Split {
  versions: Estimate[];
  /** Черновик или отправленная версия (одна на объект). */
  open: Estimate | undefined;
  /** Последняя согласованная. */
  current: Estimate | undefined;
}

export function splitEstimates(list: readonly Estimate[]): Split {
  const versions = [...list].sort((a, b) => a.version - b.version);
  return {
    versions,
    open: versions.find((e) => e.state === 'draft' || e.state === 'sent'),
    current: versions.findLast((e) => e.state === 'approved'),
  };
}

export const nextAgreementNo = (list: readonly Estimate[]): number =>
  list.reduce((a, e) => Math.max(a, e.agreementNo ?? 0), 0) + 1;

/** Какая версия открыта на экране сразу: открытая, иначе действующая, иначе последняя. */
export function defaultSelected(list: readonly Estimate[]): number {
  const s = splitEstimates(list);
  return (s.open ?? s.current ?? s.versions.at(-1))?.version ?? 1;
}

const agreementOf = (list: readonly Estimate[], e: Estimate): number =>
  e.agreementNo ?? nextAgreementNo(list);

export function headChip(list: readonly Estimate[], projectDraft: boolean): Chip {
  const { open, current, versions } = splitEstimates(list);
  if (open?.state === 'sent') {
    return open.kind === 'change'
      ? chip(`Допсоглашение № ${agreementOf(list, open)} у заказчика`, 'warn', 'sms')
      : chip(`Версия ${open.version} у заказчика`, 'warn', 'schedule_send');
  }
  if (open) return chip(`Версия ${open.version} · черновик`, 'neutral', 'edit_note');
  const cur = current ?? versions.at(-1);
  if (!cur) return chip('Сметы нет', 'neutral', 'request_quote');
  return chip(
    `Версия ${cur.version}${projectDraft ? ' · согласована' : ' · действует'}`,
    'ok',
    'verified',
  );
}

export interface Tile {
  version: number;
  title: string;
  chip: Chip;
  meta: string;
  selected: boolean;
}

/** Версия — основа договора: последняя не-допсоглашение из согласованных или заменённых. */
const contractVersion = (list: readonly Estimate[], project: ProjectInfo): number | undefined =>
  project.contractNo
    ? list
        .filter((e) => e.kind !== 'change' && (e.state === 'approved' || e.state === 'replaced'))
        .at(-1)?.version
    : undefined;

export function versionTiles(
  list: readonly Estimate[],
  project: ProjectInfo,
  selected: number,
): Tile[] {
  const { versions } = splitEstimates(list);
  const base = contractVersion(versions, project);
  const draftProject = project.status === 'draft';
  return versions.map((e) => {
    const sum = rub(e.total.amountMinor);
    if (e.state === 'draft' || e.state === 'sent') {
      const chg = e.kind === 'change';
      const c =
        e.state === 'sent'
          ? chip(chg ? 'на подписи' : 'у заказчика', 'warn', 'schedule_send')
          : chip('черновик', 'neutral', 'edit_note');
      const what = chg
        ? `допсоглашение № ${agreementOf(versions, e)}`
        : e.kind === 'first'
          ? 'из шаблона'
          : 'новая версия';
      return {
        version: e.version,
        title: `Версия ${e.version}`,
        chip: c,
        meta: `${what} · ${sum}`,
        selected: e.version === selected,
      };
    }
    const tail =
      e.kind === 'change' && e.agreementNo
        ? ` · допсоглашение № ${e.agreementNo}`
        : e.version === base && project.contractNo
          ? ` · ${project.contractNo}`
          : '';
    return {
      version: e.version,
      title: `Версия ${e.version}`,
      chip:
        e.state === 'approved'
          ? chip(draftProject ? 'согласована' : 'действует', 'ok', 'verified')
          : chip('заменена', 'neutral', 'history'),
      meta: `${dm(e.approvedAt ?? e.sentAt)} · ${sum}${tail}`,
      selected: e.version === selected,
    };
  });
}

const contractNumber = (no: string | undefined): string | undefined =>
  no ? /№\s*(\S+)/.exec(no)?.[1] : undefined;

/**
 * Пояснение под плитками версий (vNote :1421). У согласованных версий контракт не отдаёт ни заметку, ни автора
 * (Q-W6.21-3): текст собирается из состояния версии, вместо автора — дата.
 */
export function versionNote(
  list: readonly Estimate[],
  project: ProjectInfo,
  selected: number,
  o: { template?: string; orders?: readonly string[] },
): string {
  const { versions } = splitEstimates(list);
  const e = versions.find((x) => x.version === selected);
  if (!e) return '';
  if (e.state === 'draft' || e.state === 'sent') {
    const lead =
      e.kind === 'change'
        ? `Черновик допсоглашения: строки версии ${e.baseVersion ?? ''}${
            o.orders?.length ? ` и допработы ${o.orders.join(', ')}` : ''
          }. Заказчик увидит изменения после отправки.`
        : e.kind === 'first'
          ? `Собрана по шаблону «${o.template ?? ''}». Объёмы с пометкой «из замера» пересчитываются при изменении замера.`
          : 'Новая версия до договора: после отправки заказчик согласует её в кабинете.';
    return e.state === 'sent' ? `${lead} Объёмы зафиксированы на момент отправки.` : lead;
  }
  const date = dm(e.approvedAt ?? e.sentAt);
  if (e.state === 'replaced') {
    const next = versions.find((x) => x.version > e.version && x.state !== 'draft');
    return `Заменена версией ${next?.version ?? e.version + 1} · ${date}`;
  }
  if (e.kind === 'change') {
    return `Допсоглашение № ${e.agreementNo ?? ''} подписано заказчиком кодом из SMS · ${date}`;
  }
  const no = contractNumber(project.contractNo);
  const base = contractVersion(versions, project) === e.version && no;
  return `Согласована заказчиком в кабинете${base ? ` и стала основой договора № ${no}` : ''} · ${date}`;
}

/** С чем сравнивать выбранную версию: у открытой — её основа, у прочих — предыдущая. */
export function compareBase(list: readonly Estimate[], selected: number): Estimate | undefined {
  const { versions } = splitEstimates(list);
  const e = versions.find((x) => x.version === selected);
  if (!e) return undefined;
  const want = e.state === 'draft' || e.state === 'sent' ? e.baseVersion : e.version - 1;
  return versions.find((x) => x.version === want);
}

export interface CompareRow {
  kind: S['EstimateDiffRow']['change'];
  name: string;
  section: string;
  chip: Chip;
  strike: boolean;
  aSum: string;
  aCalc: string;
  bSum: string;
  bCalc: string;
  d: string;
  dTone: 'ok' | 'danger' | 'muted';
}

export interface CompareView {
  aLabel: string;
  bLabel: string;
  rows: CompareRow[];
  noRows: boolean;
  sameCount: number;
  sameLabel: string;
  aTotal: string;
  bTotal: string;
  dTotal: string;
  dTone: 'ok' | 'danger' | 'muted';
}

const tone = (minor: number): 'ok' | 'danger' | 'muted' =>
  Math.abs(minor) < 50 ? 'muted' : minor > 0 ? 'ok' : 'danger';

const CHANGE_CHIP = {
  added: chip('добавлено', 'ok', 'add'),
  removed: chip('убрано', 'danger', 'remove'),
  same: chip('без изменений', 'neutral', 'check'),
} as const;

export function compareView(
  a: Estimate,
  b: Estimate,
  diff: S['EstimateDiff'],
  showSame: boolean,
): CompareView {
  const lineOf = (id: string | undefined): { line: Line; est: Estimate } | undefined => {
    const inB = b.lines.find((l) => l.id === id);
    if (inB) return { line: inB, est: b };
    const inA = a.lines.find((l) => l.id === id);
    return inA ? { line: inA, est: a } : undefined;
  };
  const sectionOf = (id: string | undefined): string => {
    const f = lineOf(id);
    return f ? (f.est.sections.find((s) => s.id === f.line.sectionId)?.name ?? '') : '';
  };
  const build = (r: S['EstimateDiffRow']): CompareRow => {
    const unit = unitLabel(lineOf(r.lineId)?.line.unit ?? 'piece');
    const qa = r.quantityA === undefined ? undefined : Number(r.quantityA);
    const qb = r.quantityB === undefined ? undefined : Number(r.quantityB);
    const sumA = qa === undefined || !r.priceA ? 0 : qa * r.priceA.amountMinor;
    const sumB = qb === undefined || !r.priceB ? 0 : qb * r.priceB.amountMinor;
    let c: Chip;
    if (r.change === 'changed') {
      const dq = qa !== undefined && qb !== undefined && Math.abs(qa - qb) > 1e-6;
      const dp = r.priceA?.amountMinor !== r.priceB?.amountMinor;
      const what = [dq ? 'объём' : '', dp ? 'цена' : ''].filter(Boolean).join(' и ');
      c = chip(`изменено: ${what}`, 'warn', 'edit');
    } else {
      c = CHANGE_CHIP[r.change];
    }
    return {
      kind: r.change,
      name: r.name,
      section: sectionOf(r.lineId),
      chip: c,
      strike: r.change === 'removed',
      aSum: r.priceA ? rub(sumA) : '—',
      aCalc:
        r.priceA && qa !== undefined ? `${fmtNum(qa)} ${unit} × ${rub(r.priceA.amountMinor)}` : '',
      bSum: r.priceB ? rub(sumB) : '—',
      bCalc:
        r.priceB && qb !== undefined ? `${fmtNum(qb)} ${unit} × ${rub(r.priceB.amountMinor)}` : '',
      d: signed(r.delta.amountMinor),
      dTone: tone(r.delta.amountMinor),
    };
  };

  // Порядок версии B; убранные строки — после последней строки своего раздела (:1428).
  const byId = new Map(diff.rows.map((r) => [r.lineId, r]));
  const ordered: S['EstimateDiffRow'][] = [];
  for (const l of b.lines) {
    const r = byId.get(l.id);
    if (r) ordered.push(r);
  }
  for (const r of diff.rows) {
    if (r.change !== 'removed') continue;
    const sec = sectionOf(r.lineId);
    const at = ordered.map((x) => sectionOf(x.lineId)).lastIndexOf(sec);
    if (at >= 0) ordered.splice(at + 1, 0, r);
    else ordered.push(r);
  }
  const sameCount = ordered.filter((r) => r.change === 'same').length;
  const shown = ordered.filter((r) => showSame || r.change !== 'same');
  const open = b.state === 'draft' || b.state === 'sent';
  return {
    aLabel: `Версия ${a.version}`,
    bLabel: `Версия ${b.version}${open && b.state === 'draft' ? ' · черновик' : ''}`,
    rows: shown.map(build),
    noRows: shown.length === 0,
    sameCount,
    sameLabel: showSame
      ? 'Скрыть строки без изменений'
      : `Показать строки без изменений · ${sameCount}`,
    aTotal: rub(a.total.amountMinor),
    bTotal: rub(b.total.amountMinor),
    dTotal: signed(diff.delta.amountMinor),
    dTone: tone(diff.delta.amountMinor),
  };
}

export interface LineView {
  id: string;
  name: string;
  unit: string;
  qty: string;
  price: string;
  sum: string;
  qtyInput: string;
  priceInput: string;
  isNew: boolean;
  /** «из замера · пол без санузлов × 1,07» — объём считается по замеру. */
  formula: string | undefined;
  formulaTitle: string;
  /** Объём строки с формулой исправлен вручную. */
  manualBadge: boolean;
  canReset: boolean;
}

export interface SectionView {
  id: string;
  title: string;
  sum: string;
  lines: LineView[];
  empty: boolean;
}

/** Цена в поле: рубли без лишних нулей («1200», «1250.5»). */
const priceField = (minor: number): string => String(minor / 100);

export function sectionsView(e: Estimate, o: { editable: boolean }): SectionView[] {
  const open = e.state === 'draft' || e.state === 'sent';
  const live = e.state === 'draft';
  return e.sections.map((s) => {
    const own = e.lines.filter((l) => l.sectionId === s.id);
    return {
      id: s.id,
      title: s.name,
      sum: rub(own.reduce((a, l) => a + l.sum.amountMinor, 0)),
      empty: own.length === 0,
      lines: own.map((l) => {
        const q = Number(l.quantity);
        const manual = !!l.formula && l.manual;
        return {
          id: l.id,
          name: l.name,
          unit: unitLabel(l.unit),
          qty: fmtNum(q),
          price: rub(l.price.amountMinor),
          sum: rub(l.sum.amountMinor),
          qtyInput: fmtNum(q),
          priceInput: priceField(l.price.amountMinor),
          isNew: open && e.kind !== 'first' && l.isNew,
          formula:
            l.formula && !l.manual
              ? `из замера · ${FORMULA_LABEL[l.formula]}${kTxt(l.coef)}`
              : undefined,
          formulaTitle: live
            ? 'Пересчитывается при изменении замера'
            : 'Объём зафиксирован в версии',
          manualBadge: manual,
          canReset: manual && o.editable,
        };
      }),
    };
  });
}

export interface OrderItem {
  id: string;
  number: string;
  title: string;
  meta: string;
  note: string | undefined;
  photos: string[];
  chip: Chip;
  canPrice: boolean;
  hint: string | undefined;
  canOpen: boolean;
  canReject: boolean;
}

export interface OrdersView {
  visible: boolean;
  items: OrderItem[];
  noActive: boolean;
  done: string | undefined;
}

const HINT_SENT = 'Оценить можно после подписи или отзыва отправленного допсоглашения.';
const HINT_DRAFT = 'Допработу можно оценить в новом черновике: отправьте или удалите текущий.';

export function changeOrdersView(
  orders: readonly S['ChangeOrder'][],
  o: { canEdit: boolean; list: readonly Estimate[]; selected: number; projectDraft: boolean },
): OrdersView {
  if (o.projectDraft || orders.length === 0) {
    return { visible: false, items: [], noActive: false, done: undefined };
  }
  const { open } = splitEstimates(o.list);
  const sent = open?.state === 'sent';
  const active = orders.filter(
    (c) => c.status === 'proposed' || c.status === 'priced' || c.status === 'sent',
  );
  const closed = orders.filter((c) => c.status === 'signed' || c.status === 'rejected');
  const chipOf = (c: S['ChangeOrder']): Chip =>
    c.status === 'proposed'
      ? chip('Ждёт оценки офиса', 'warn', 'pending')
      : c.status === 'priced'
        ? chip(
            `В черновике версии ${open?.version ?? c.estimateVersion ?? ''}`,
            'info',
            'edit_note',
          )
        : chip('В допсоглашении · у заказчика', 'warn', 'sms');
  const items = active.map((c): OrderItem => {
    const proposed = c.status === 'proposed';
    return {
      id: c.id,
      number: c.number,
      title: c.title,
      meta: `${dm(c.createdAt)} · ${fmtNum(Number(c.quantity))} ${unitLabel(c.unit)} · фото: ${c.photoFileIds.length}`,
      note: c.note ? c.note : undefined,
      photos: Array.from(
        { length: Math.min(3, c.photoFileIds.length) },
        (_, i) => `Фото ${i + 1} к допработе ${c.number}`,
      ),
      chip: chipOf(c),
      canPrice: o.canEdit && proposed && !open,
      hint: proposed && sent ? HINT_SENT : proposed && open ? HINT_DRAFT : undefined,
      canOpen: !proposed && !!open && o.selected !== open.version,
      canReject: o.canEdit && proposed,
    };
  });
  const done = closed.length
    ? closed
        .map(
          (c) =>
            `${c.number} «${c.title}»: ${
              c.status === 'signed'
                ? `подписана${c.agreementNo ? ` в допсоглашении № ${c.agreementNo}` : ''}`
                : `отклонена${c.rejectReason ? ` — ${reasonLabel(c.rejectReason).toLowerCase()}` : ''}`
            }`,
        )
        .join(' · ')
    : undefined;
  return { visible: true, items, noActive: items.length === 0, done };
}
