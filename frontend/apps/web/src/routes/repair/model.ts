// W6.20 · Модель страницы «Объекты»: чистые функции над ответами контракта 0.12.0-stage6 (Repairs). Правила — эталон
// design-2026-10-19: repairSum :4284 («Требует решения»), repairListVM :4325 (фильтры, строки, порядок), repairCardVM
// :4356 (чипы, вкладки, обзор 1a). Суммы и пункты с суммами сервер отдаёт только с правом финансов — модель их не
// выдумывает.
import type { components } from '@ortus/api-client';
import { plural, rub } from '@ortus/domain';

import { REPAIR_TEXT as T } from './texts.ts';

type S = components['schemas'];
export type Project = S['RepairProject'];
export type Decision = S['RepairDecision'];
export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

export interface Chip {
  label: string;
  tone: Tone;
  icon: string;
}

// ── числа и даты ──────────────────────────────────────────────────────────────────────────────

const UNIT_LABEL: Record<S['RepairUnit'], string> = {
  hour: 'ч',
  m2: 'м²',
  m3: 'м³',
  m: 'м',
  piece: 'шт',
  set: 'компл',
  trip: 'рейс',
  mesh: 'меш',
  liter: 'л',
};

export const unitLabel = (u: S['RepairUnit']): string => UNIT_LABEL[u];

/** Объём как в эталоне (`M.num`): запятая, без хвоста нулей и двоичного шума. */
export const qtyText = (v: string | number): string =>
  String(Math.round(Number(v) * 1000) / 1000).replace('.', ',');

/** «дд.мм»: дата `гггг-мм-дд` как есть, момент — по Москве (даты эталона — московские). */
export function dayMonth(v: string): string {
  if (v.length === 10) return `${v.slice(8, 10)}.${v.slice(5, 7)}`;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(v));
}

/** «дд.мм.гггг» (гарантия). */
export const fullDate = (iso: string): string =>
  `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

const DAY = 86_400_000;
const days = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

const dn = (n: number): string => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

/** Разбор объёма из поля формы: запятая допустима; не число → NaN. */
export const parseQty = (v: string): number => Number(String(v).trim().replace(',', '.'));

// ── «Требует решения» ─────────────────────────────────────────────────────────────────────────

export type DecisionTab = Decision['tab'];

export interface DecisionAction {
  label: string;
  /** assign — диалог «Назначить прораба?»; accept — приёмка отметки; supply — страница «Снабжение»; tab — вкладка. */
  type: 'assign' | 'accept' | 'supply' | 'tab';
  tab: DecisionTab;
  refId?: string;
}

export interface DecisionView {
  id: string;
  kind: Decision['kind'];
  tone: Tone;
  icon: string;
  tag: string;
  title: string;
  meta?: string;
  action?: DecisionAction;
}

interface KindStyle {
  icon: string;
  tone: Tone;
  tag: string;
}

const KIND: Record<Decision['kind'], KindStyle> = {
  no_foreman: { icon: 'person_off', tone: 'warn', tag: 'Команда' },
  work_log_pending: { icon: 'fact_check', tone: 'warn', tag: 'Приёмка' },
  work_log_missing: { icon: 'today', tone: 'neutral', tag: 'Сегодня' },
  schedule_slip: { icon: 'event_busy', tone: 'warn', tag: 'График' },
  stage_no_executor: { icon: 'person_off', tone: 'neutral', tag: 'График' },
  document_wait_signature: { icon: 'sms', tone: 'warn', tag: 'Документы' },
  document_ready: { icon: 'draw', tone: 'neutral', tag: 'Документы' },
  supply_pending: { icon: 'shopping_cart', tone: 'info', tag: 'Снабжение' },
  estimate_with_client: { icon: 'schedule_send', tone: 'warn', tag: 'Смета' },
  change_order_new: { icon: 'request_quote', tone: 'warn', tag: 'Допработы' },
  change_order_priced: { icon: 'edit_note', tone: 'neutral', tag: 'Допработы' },
  change_order_sent: { icon: 'sms', tone: 'info', tag: 'Допработы' },
  estimate_missing: { icon: 'request_quote', tone: 'warn', tag: 'Смета' },
  estimate_draft: { icon: 'edit_note', tone: 'neutral', tag: 'Смета' },
  estimate_sent: { icon: 'schedule_send', tone: 'info', tag: 'Смета' },
  estimate_approved: { icon: 'handshake', tone: 'info', tag: 'Договор' },
};

const SEVERITY: Record<Tone, number> = { danger: 0, warn: 1, info: 2, neutral: 3, ok: 4 };

export interface DecisionContext {
  startOn?: string;
  dueOn?: string;
  /** Строка-пояснение, которую знает только страница (отметка: номер, автор, фото, бригада). */
  meta?: string;
}

function metaOf(d: Decision, c: DecisionContext): string | undefined {
  if (c.meta) return c.meta;
  switch (d.kind) {
    case 'no_foreman':
      return (
        T.todoMeta.noForeman +
        (c.startOn ? T.todoMeta.noForemanStart.replace('{date}', dayMonth(c.startOn)) : '')
      );
    case 'schedule_slip':
      return c.dueOn ? T.todoMeta.slip.replace('{due}', dayMonth(c.dueOn)) : undefined;
    case 'stage_no_executor':
      return T.todoMeta.noExecutor;
    case 'document_wait_signature':
      return T.todoMeta.waitSignature;
    case 'document_ready':
      return T.todoMeta.documentReady;
    case 'supply_pending':
      return T.todoMeta.supply;
    case 'estimate_with_client':
      return T.todoMeta.estimateWithClient;
    case 'work_log_missing':
      return T.todoMeta.workLogMissing;
    case 'change_order_new':
      return T.todoMeta.changeNew;
    case 'change_order_priced':
      return T.todoMeta.changePriced;
    case 'change_order_sent':
      return T.todoMeta.changeSent;
    case 'estimate_missing':
      return T.todoMeta.measurement;
    default:
      return undefined;
  }
}

export function decisionView(d: Decision, c: DecisionContext = {}): DecisionView {
  const base = KIND[d.kind];
  const pendingOnly = d.kind === 'work_log_pending' && !d.actionLabel;
  const style: KindStyle = pendingOnly ? { icon: 'pending', tone: 'info', tag: base.tag } : base;
  let action: DecisionAction | undefined;
  if (d.actionLabel) {
    const type: DecisionAction['type'] =
      d.kind === 'no_foreman'
        ? 'assign'
        : d.kind === 'work_log_pending'
          ? 'accept'
          : d.kind === 'supply_pending'
            ? 'supply'
            : 'tab';
    action = { label: d.actionLabel, type, tab: d.tab, ...(d.refId ? { refId: d.refId } : {}) };
  }
  const meta = metaOf(d, c);
  return {
    id: `${d.kind}:${d.refId ?? d.text}`,
    kind: d.kind,
    ...style,
    title: d.text,
    ...(meta ? { meta } : {}),
    ...(action ? { action } : {}),
  };
}

// ── список ────────────────────────────────────────────────────────────────────────────────────

export type FilterKey = 'active' | 'todo' | 'draft' | 'done';

export const filterKeys = (foreman: boolean): FilterKey[] =>
  foreman ? ['active', 'done'] : ['active', 'todo', 'draft', 'done'];

const isDone = (p: Project): boolean =>
  p.status === 'handed_over' || p.status === 'completed' || p.status === 'archived';
const isDraft = (p: Project): boolean => p.status === 'draft';

export function partition(projects: readonly Project[]): Record<FilterKey, Project[]> {
  const active = projects.filter((p) => !isDone(p) && !isDraft(p));
  const draft = projects.filter(isDraft);
  return {
    active,
    todo: [...active, ...draft].filter((p) => p.todoCount > 0),
    draft,
    done: projects.filter(isDone),
  };
}

export interface ListRow {
  id: string;
  name: string;
  address: string;
  stage: Chip;
  done: boolean;
  isDraft: boolean;
  showBar: boolean;
  estText: string;
  acceptedPct: number;
  pendingPct: number;
  hasPending: boolean;
  pendingText: string;
  dueLabel: string;
  due: string;
  dueSub: string;
  slip: boolean;
  foreman: string;
  foremanMuted: boolean;
  showForeman: boolean;
  top?: DecisionView;
  more: string;
  quiet: boolean;
  canLog: boolean;
}

export interface ListModel {
  view: 'table' | 'cards';
  filters: { key: FilterKey; label: string; count: number; selected: boolean }[];
  selected: FilterKey;
  rows: ListRow[];
  empty?: { icon: string; title: string; text: string };
}

export interface ListInput {
  foreman: boolean;
  filter: string | undefined;
  q: string;
  /** «Сегодня», `гггг-мм-дд` (часы страницы). */
  today: string;
  foremanName: (id: string | null) => string | undefined;
  /** Ширина контента ≥ 880 px (эталон `cw`). */
  wide?: boolean;
}

const ESTIMATE_TEXT: Partial<Record<Decision['kind'], string>> = {
  estimate_missing: 'Смета не собрана',
  estimate_draft: 'Черновик сметы',
  estimate_sent: 'Смета у заказчика',
  estimate_approved: 'Смета согласована',
};

const stageChip = (p: Project): Chip => {
  if (isDone(p)) return { label: 'Сдан', tone: 'ok', icon: 'verified' };
  const stage = p.stage ?? '';
  if (isDraft(p)) return { label: `${stage} · до договора`, tone: 'neutral', icon: 'straighten' };
  return { label: stage, tone: stage === 'Подготовка' ? 'neutral' : 'info', icon: 'construction' };
};

function rowOf(p: Project, i: ListInput): ListRow {
  const done = isDone(p);
  const draft = isDraft(p);
  const top = p.todoTop
    ? decisionView(p.todoTop, { startOn: p.startOn, dueOn: p.dueOn })
    : undefined;
  const accepted = Math.min(100, p.readiness.acceptedPct);
  const pending = done ? 0 : Math.min(100 - accepted, p.readiness.pendingPct);
  const slip = !done && !!p.forecastDueOn && !!p.dueOn && p.forecastDueOn > p.dueOn;
  const dueIso = slip ? p.forecastDueOn : p.dueOn;
  const left = !done && !draft && dueIso ? days(i.today, dueIso) : null;
  let dueSub = '';
  if (draft) dueSub = T.card.noMeasured;
  else if (done) dueSub = p.warrantyUntil ? `гарантия до ${fullDate(p.warrantyUntil)}` : '';
  else if (slip) dueSub = `прогноз · по договору ${dayMonth(p.dueOn ?? '')}`;
  else if (left !== null)
    dueSub = left > 0 ? `через ${dn(left)}` : left === 0 ? 'сегодня' : `просрочено на ${dn(-left)}`;
  let due = '—';
  if (done) due = p.handedOverOn ? dayMonth(p.handedOverOn) : '—';
  else if (!draft && dueIso) due = dayMonth(dueIso);
  // Имя прораба знает список участников (`members.read`); без права — «—», а не «не назначен».
  const name = draft
    ? T.foremanAfterContract
    : p.foremanMemberId
      ? (i.foremanName(p.foremanMemberId) ?? '—')
      : T.foremanNone;
  const k = p.todoCount - 1;
  return {
    id: p.id,
    name: p.name,
    address: p.address,
    stage: stageChip(p),
    done,
    isDraft: draft,
    showBar: !draft,
    estText: draft && p.todoTop ? (ESTIMATE_TEXT[p.todoTop.kind] ?? '') : '',
    acceptedPct: accepted,
    pendingPct: pending,
    hasPending: pending > 0,
    pendingText: `+${pending}% на приёмке`,
    dueLabel: done ? 'Сдан' : draft ? 'Замер' : 'Сдача',
    due,
    dueSub,
    slip,
    foreman: name,
    foremanMuted: draft || name === T.foremanNone,
    showForeman: !i.foreman,
    ...(top ? { top } : {}),
    more: k > 0 ? `ещё ${k} ${plural(k, 'вопрос', 'вопроса', 'вопросов')}` : '',
    quiet: !top && !done,
    canLog: i.foreman && !done && !draft && p.readiness.acceptedPct < 100,
  };
}

const severity = (p: Project): number => {
  if (isDone(p)) return 9;
  if (!p.todoTop) return 5;
  return SEVERITY[KIND[p.todoTop.kind].tone];
};

export function listModel(projects: readonly Project[], i: ListInput): ListModel {
  const keys = filterKeys(i.foreman);
  const selected = keys.find((k) => k === i.filter) ?? 'active';
  const parts = partition(projects);
  const q = i.q.trim().toLowerCase();
  const visible = parts[selected]
    .filter(
      (p) =>
        !q ||
        [p.name, p.address, p.clientName ?? '', i.foremanName(p.foremanMemberId) ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q),
    )
    .map((p) => ({
      p,
      sev: severity(p),
      left: days(i.today, (p.forecastDueOn ?? p.dueOn) || '9999-12-31'),
    }))
    .sort((a, b) => a.sev - b.sev || a.left - b.left);
  const rows = visible.map(({ p }) => rowOf(p, i));
  let empty: ListModel['empty'];
  if (!rows.length) {
    if (!projects.length) {
      const e = i.foreman ? T.empty.foremanNone : T.empty.none;
      empty = { icon: 'home_work', title: e.title, text: e.text };
    } else {
      empty = {
        icon: 'search_off',
        title: T.empty.filtered.title,
        text: q ? T.empty.filtered.search : T.empty.filtered.filter,
      };
    }
  }
  return {
    view: i.wide && !i.foreman ? 'table' : 'cards',
    filters: keys.map((key) => ({
      key,
      label: T.filters[key],
      count: parts[key].length,
      selected: key === selected,
    })),
    selected,
    rows,
    ...(empty ? { empty } : {}),
  };
}

// ── карточка ──────────────────────────────────────────────────────────────────────────────────

export function cardChips(p: Project, pending: number, estimateKind?: Decision['kind']): Chip[] {
  if (isDone(p)) {
    return [
      {
        label: `Сдан ${p.handedOverOn ? dayMonth(p.handedOverOn) : ''}`.trim(),
        tone: 'ok',
        icon: 'verified',
      },
      ...(p.warrantyUntil
        ? [
            {
              label: `гарантия до ${fullDate(p.warrantyUntil)}`,
              tone: 'neutral' as const,
              icon: 'verified_user',
            },
          ]
        : []),
    ];
  }
  if (isDraft(p)) {
    const est = estimateKind ? ESTIMATE_TEXT[estimateKind] : undefined;
    return [
      { label: `${p.stage ?? ''} · до договора`, tone: 'neutral', icon: 'straighten' },
      ...(est
        ? [
            {
              label: est,
              tone:
                estimateKind === 'estimate_approved'
                  ? ('ok' as const)
                  : estimateKind === 'estimate_sent'
                    ? ('warn' as const)
                    : ('neutral' as const),
              icon: 'request_quote',
            },
          ]
        : []),
    ];
  }
  const chips: Chip[] = [stageChip(p)];
  if (p.dueOn) {
    const slip = !!p.forecastDueOn && p.forecastDueOn > p.dueOn;
    chips.push(
      slip
        ? {
            label: `сдача ${dayMonth(p.forecastDueOn ?? '')} вместо ${dayMonth(p.dueOn)}`,
            tone: 'warn',
            icon: 'event_busy',
          }
        : { label: `сдача ${dayMonth(p.dueOn)}`, tone: 'neutral', icon: 'calendar_month' },
    );
  }
  if (pending > 0) chips.push({ label: `На приёмке: ${pending}`, tone: 'warn', icon: 'pending' });
  return chips;
}

export function cardSubtitle(p: Project): string {
  const area = p.areaM2
    ? `${qtyText(p.areaM2)} м²${p.rooms ? `, ${p.rooms} ${plural(p.rooms, 'комната', 'комнаты', 'комнат')}` : ''}`
    : '';
  return [p.address, area, p.kind, p.contractNo || (isDraft(p) ? T.card.noMeasured : '')]
    .filter(Boolean)
    .join(' · ');
}

export type TabId = keyof typeof T.tabs;

export interface TabView {
  id: TabId;
  label: string;
  badge?: number;
}

export interface TabsInput {
  canFin: boolean;
  pending: number;
  changesNew: number;
  docs: number;
  supply: number;
  estimateMissing?: boolean;
}

export function tabsOf(p: Project, i: TabsInput): TabView[] {
  const tab = (id: TabId, badge = 0): TabView => ({
    id,
    label: T.tabs[id],
    ...(badge > 0 ? { badge } : {}),
  });
  if (isDraft(p)) {
    return [
      tab('overview'),
      tab('measure'),
      ...(i.canFin ? [tab('estimate', i.estimateMissing ? 1 : 0)] : []),
    ];
  }
  return [
    tab('overview'),
    tab('works', i.pending),
    tab('measure'),
    ...(i.canFin ? [tab('estimate', i.changesNew)] : []),
    tab('schedule'),
    tab('docs', i.docs),
    tab('supply', i.supply),
    ...(i.canFin ? [tab('finance'), tab('pay'), tab('subs'), tab('client')] : []),
  ];
}

// ── обзор 1a ──────────────────────────────────────────────────────────────────────────────────

export interface VolumeRow {
  id: string;
  name: string;
  note: string;
  icon: string;
  tone: 'accent' | 'info' | 'muted';
  acceptedW: number;
  pendingW: number;
  pct: string;
}

export function volumeRows(works: readonly S['RepairWork'][]): VolumeRow[] {
  return works.map((w) => {
    const plan = Number(w.plan);
    const fact = Number(w.fact);
    const pending = Number(w.pending);
    const acc = plan > 0 ? Math.min(100, (fact / plan) * 100) : 0;
    const full = acc >= 100;
    const started = fact > 0;
    const unit = unitLabel(w.unit);
    const note =
      `${qtyText(fact)} из ${qtyText(plan)} ${unit}` +
      (pending > 0 ? ` · ещё ${qtyText(pending)} на приёмке` : full ? ' · выполнено' : '');
    return {
      id: w.id,
      name: w.name,
      note,
      icon: full ? 'check_circle' : started ? 'progress_activity' : 'radio_button_unchecked',
      tone: full ? 'accent' : started ? 'info' : 'muted',
      acceptedW: acc,
      pendingW: plan > 0 ? Math.min(100 - acc, (pending / plan) * 100) : 0,
      pct: `${Math.round(acc)}%`,
    };
  });
}

export interface PersonRow {
  icon: string;
  name: string;
  role: string;
  tone: 'neutral' | 'accent' | 'warn' | 'info';
}

export function peopleRows(people: S['RepairPeople'], p: Project): PersonRow[] {
  const done = isDone(p);
  const rows: PersonRow[] = [
    {
      icon: 'person',
      name: people.clientName ?? T.people.clientDefault,
      role: done ? T.people.clientClosed : T.people.clientOpen,
      tone: 'neutral',
    },
  ];
  if (people.foreman) {
    rows.push({
      icon: 'engineering',
      name: people.foreman.displayName,
      role: T.people.foreman,
      tone: 'accent',
    });
  } else {
    const draft = isDraft(p);
    rows.push({
      icon: 'person_off',
      name: T.people.noForeman,
      role: draft
        ? T.people.noForemanDraft
        : T.people.noForemanNeed + (p.startOn ? ` ${dayMonth(p.startOn)}` : ''),
      tone: draft ? 'neutral' : 'warn',
    });
  }
  const crew = people.crew.filter((w) => w.status === 'active');
  const n = crew.length;
  if (n > 0) {
    const word =
      n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'человека' : 'человек';
    rows.push({
      icon: 'groups',
      name: `Бригада · ${n} ${word}`,
      role: `${crew.map((w) => w.displayName).join(', ')} · ${T.people.crewRole}`,
      tone: 'neutral',
    });
  }
  if (people.subcontractor) {
    const until = people.subcontractor.accessUntil;
    rows.push({
      icon: 'handshake',
      name: people.subcontractor.name,
      role: until ? T.people.sub.replace('{date}', dayMonth(until)) : T.people.subNoDate,
      tone: 'info',
    });
  }
  return rows;
}

export interface MoneyRow {
  label: string;
  value: string;
  sub: string;
}

const rubles = (m: { amountMinor: number }): string => rub(m.amountMinor / 100);

export function moneyRows(card: S['RepairMoneyCard'], handedOver: boolean): MoneyRow[] {
  const contract = card.contract.amountMinor;
  const pct = (n: number): number => (contract > 0 ? Math.round((n / contract) * 100) : 0);
  return [
    { label: T.money.contract, value: rubles(card.contract), sub: T.money.contractSub },
    {
      label: T.money.received,
      value: rubles(card.received),
      sub: T.money.receivedSub.replace('{pct}', String(pct(card.received.amountMinor))),
    },
    { label: T.money.expenses, value: rubles(card.expenses), sub: T.money.expensesSub },
    {
      label: handedOver ? T.money.marginFact : T.money.marginPlan,
      value: rubles(card.marginPlan),
      sub: T.money.marginSub.replace('{pct}', String(pct(card.marginPlan.amountMinor))),
    },
  ];
}

// ── проверка форм (тексты api.js:899–907, :935–942) ───────────────────────────────────────────

export interface WorkLogDraft {
  work: string;
  volume: string;
  crew: readonly string[];
  photos: number;
  material: string;
  materialQty: string;
}

/** Первая ошибка формы отметки или `null`; «превышает план более чем на 10%» проверяет сервер. */
export function validateWorkLog(f: WorkLogDraft): string | null {
  if (!f.work) return 'Выберите работу этого объекта';
  const v = parseQty(f.volume);
  if (!Number.isFinite(v) || v <= 0) return 'Объём должен быть больше нуля';
  if (f.crew.length === 0) return 'Отметьте работников';
  if (f.photos < 1) return 'Добавьте хотя бы одно фото';
  return null;
}

export interface ChangeDraft {
  title: string;
  volume: string;
  photos: number;
}

export function validateChange(f: ChangeDraft): string | null {
  if (f.title.trim().length < 3) return 'Опишите, что нужно сделать';
  const v = parseQty(f.volume);
  if (!Number.isFinite(v) || v <= 0) return 'Укажите объём больше нуля';
  if (f.photos < 1) return 'Приложите хотя бы одно фото';
  return null;
}
