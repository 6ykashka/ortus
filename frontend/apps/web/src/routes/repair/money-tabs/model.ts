// W6.24 · Модель вкладок объекта «Документы», «Финансы», «Оплата бригады», «Подрядчики», «Кабинет заказчика»:
// подписи и расчёты эталона `Ремонт и стройка.dc.html` (DOC :1660, renderVals :1682–1701) на данных контракта
// 0.12.0-stage6. Чистые функции без обращения к сети; суммы приходят в минорных единицах (Money.amountMinor).
import type { components } from '@ortus/api-client';

type S = components['schemas'];

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

export interface Chip {
  tone: Tone;
  icon: string;
  label: string;
}

// ── форматы ──

const RUB = new Intl.NumberFormat('ru-RU');

/** Рубли из минорных единиц: «438 175 ₽» (разделитель тысяч Intl ru-RU, как `rub` эталона :835). */
export const rub = (minor: number): string => `${RUB.format(Math.round(minor / 100))} ₽`;

/** Сумма со знаком: плюс и настоящий минус; ноль без знака (`sgn` эталона :1430). */
export function signedRub(minor: number): string {
  if (Math.round(minor / 100) === 0) return '0 ₽';
  return `${minor > 0 ? '+' : '−'}${rub(Math.abs(minor))}`;
}

/** «дд.мм» из даты `YYYY-MM-DD` или момента ISO. */
export const ruDay = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** «дд.мм.гггг» из даты `YYYY-MM-DD` или момента ISO. */
export const ruDate = (iso: string): string => `${ruDay(iso)}.${iso.slice(0, 4)}`;

/** «27 ноября» (`dt` эталона). */
export function longDay(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

const PERSON = /^[А-ЯЁ][а-яё-]+( [А-ЯЁ][а-яё-]+){0,2}$/;

function dativeFirst(w: string): string {
  if (/ья$/.test(w)) return `${w.slice(0, -2)}ье`;
  if (/ия$/.test(w)) return `${w.slice(0, -2)}ии`;
  if (/[ая]$/.test(w)) return `${w.slice(0, -1)}е`;
  if (/[ьй]$/.test(w)) return `${w.slice(0, -1)}ю`;
  return `${w}у`;
}

function dativeLast(w: string): string {
  if (/(ова|ева|ёва|ина|ына)$/.test(w)) return `${w.slice(0, -1)}ой`;
  if (/(ов|ев|ёв|ин|ын)$/.test(w)) return `${w}у`;
  if (/(ский|цкий)$/.test(w)) return `${w.slice(0, -2)}ому`;
  if (/ская$/.test(w)) return `${w.slice(0, -2)}ой`;
  return w;
}

/** Имя заказчика в дательном падеже («Ольге Смирновой»); не похоже на «Имя Фамилия» — без изменений. */
export function dative(name: string): string {
  if (!PERSON.test(name)) return name;
  const words = name.split(' ');
  if (words.length === 3) return name;
  const [first, last] = words as [string, string | undefined];
  return last ? `${dativeFirst(first)} ${dativeLast(last)}` : dativeFirst(first);
}

/** Имя для приветствия («Здравствуйте, Ольга!»); у организации — пусто. */
export function firstName(full: string): string {
  return PERSON.test(full) ? (full.split(' ')[0] ?? '') : '';
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── документы ──

const DOC_CHIPS: Record<S['RepairDocument']['state'], Chip> = {
  signed: { tone: 'ok', icon: 'verified', label: 'Подписан' },
  paid: { tone: 'ok', icon: 'check_circle', label: 'Оплачен' },
  draft: { tone: 'neutral', icon: 'edit_note', label: 'Готов к отправке' },
  sms: { tone: 'warn', icon: 'sms', label: 'Ждёт подписи заказчика' },
  wait: { tone: 'neutral', icon: 'hourglass_top', label: 'Этап не закрыт' },
};

export const docChip = (state: S['RepairDocument']['state']): Chip => DOC_CHIPS[state];

const DOC_ICONS: Record<S['RepairDocumentKind'], string> = {
  contract: 'contract',
  agreement: 'contract_edit',
  act: 'task',
  invoice: 'receipt_long',
  handover_act: 'task_alt',
  warranty: 'shield',
};

export interface DocRowView {
  id: string;
  kind: S['RepairDocumentKind'];
  name: string;
  icon: string;
  meta: string;
  chip: Chip;
  canSend: boolean;
}

function docMeta(d: S['RepairDocument'], clientName: string | undefined): string {
  const act = d.kind === 'act' || d.kind === 'handover_act';
  const version = d.estimateVersion ? `Из сметы v${d.estimateVersion}` : '';
  switch (d.state) {
    case 'paid':
      return d.signedAt ? `Оплачен ${ruDay(d.signedAt)}` : 'Оплачен';
    case 'signed':
      if (!act && version) return d.signedAt ? `${version} · ${ruDay(d.signedAt)}` : version;
      return clientName ? `Подписан кодом из SMS · ${clientName}` : 'Подписан кодом из SMS';
    case 'sms':
      return 'Отправлен в кабинет заказчика';
    case 'wait':
      return 'Этап в работе';
    default:
      if (act) return 'Этап закрыт прорабом';
      return version || 'Собран по шаблону';
  }
}

export function docRows(docs: readonly S['RepairDocument'][], clientName?: string): DocRowView[] {
  return docs.map((d) => ({
    id: d.id,
    kind: d.kind,
    name: d.title,
    icon: DOC_ICONS[d.kind],
    meta: docMeta(d, clientName),
    chip: docChip(d.state),
    canSend: d.state === 'draft',
  }));
}

/** Акт сдачи, по которому можно сдать объект: подписан заказчиком, объект в работе. */
export function handOverDoc(
  docs: readonly S['RepairDocument'][],
  status: S['RepairProject']['status'],
): S['RepairDocument'] | undefined {
  if (status !== 'active') return undefined;
  return docs.find(
    (d) => d.kind === 'handover_act' && (d.state === 'signed' || d.state === 'paid'),
  );
}

/** Готовность по закрытым актам (подписанные и оплаченные из всех актов), %. */
export function readinessByActs(docs: readonly S['RepairDocument'][]): number {
  const acts = docs.filter((d) => d.kind === 'act');
  if (!acts.length) return 0;
  const done = acts.filter((d) => d.state === 'signed' || d.state === 'paid').length;
  return Math.round((done / acts.length) * 100);
}

// ── финансы ──

export interface FinanceCard {
  label: string;
  value: string;
  sub: string;
}

export function financeCards(f: S['ProjectFinance']): FinanceCard[] {
  const contract = f.contract.amountMinor;
  const advance = contract > 0 && f.received.amountMinor > 0;
  const marginPct =
    contract > 0 ? `${Math.round((f.marginPlan.amountMinor / contract) * 100)}% · ` : '';
  return [
    {
      label: 'Договор',
      value: rub(contract),
      sub: f.estimateVersion ? `по смете версии ${f.estimateVersion}` : 'по договору',
    },
    {
      label: 'Получено от заказчика',
      value: rub(f.received.amountMinor),
      sub: advance
        ? `аванс ${Math.round((f.received.amountMinor / contract) * 100)}%`
        : 'поступлений пока нет',
    },
    { label: 'Расходы', value: rub(f.expenses.amountMinor), sub: 'материалы, бригада, подрядчик' },
    {
      label: 'Маржа план',
      value: rub(f.marginPlan.amountMinor),
      sub: `${marginPct}факт после закрытия`,
    },
  ];
}

export interface MovementRow {
  key: string;
  at: string;
  text: string;
  sum: string;
  income: boolean;
}

/** «Движение денег»: по возрастанию даты, как в эталоне. */
export function movementRows(f: S['ProjectFinance']): MovementRow[] {
  return [...f.movements]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((m, i) => ({
      key: `${i}-${m.at}`,
      at: ruDay(m.at),
      text: m.text,
      sum: signedRub(m.amount.amountMinor),
      income: m.amount.amountMinor > 0,
    }));
}

// ── оплата бригады ──

const PAY_CHIPS: Record<S['CrewAccrual']['state'], Chip> = {
  pending_act: { tone: 'neutral', icon: 'hourglass_top', label: 'Ждёт закрытия акта' },
  accrued: { tone: 'info', icon: 'payments', label: 'Начислено' },
  proposed: { tone: 'warn', icon: 'schedule_send', label: 'Ждёт проведения в кассе' },
  paid: { tone: 'ok', icon: 'check_circle', label: 'Выплачено' },
};

export interface PayRowView {
  id: string;
  name: string;
  role: string;
  work: string;
  sum: string;
  chip: Chip;
  selfEmployed: boolean;
}

export function payRows(items: readonly S['CrewAccrual'][]): PayRowView[] {
  return items.map((a) => ({
    id: a.id,
    name: a.workerName,
    role: a.role,
    work: a.work ?? '',
    sum: rub(a.amount.amountMinor),
    chip: PAY_CHIPS[a.state],
    selfEmployed: a.selfEmployed,
  }));
}

export interface PayPlan {
  /** Акт, по которому можно начислить («Начислить по акту № N»). */
  accrue?: { id: string; no: number };
  /** Начисленные суммы, готовые к выплате через кассу. */
  payoutIds: string[];
  hint: string;
}

export function payPlan(
  accruals: readonly S['CrewAccrual'][],
  docs: readonly S['RepairDocument'][],
): PayPlan {
  const acts = docs.filter((d) => d.kind === 'act').sort((a, b) => (a.actNo ?? 0) - (b.actNo ?? 0));
  const closed = (d: S['RepairDocument']): boolean => d.state === 'signed' || d.state === 'paid';
  const pending = accruals.some((a) => a.state === 'pending_act');
  const payoutIds = accruals.filter((a) => a.state === 'accrued').map((a) => a.id);
  const signed = acts.find(closed);
  const plan: PayPlan = { payoutIds, hint: '' };
  if (pending && signed) plan.accrue = { id: signed.id, no: signed.actNo ?? 0 };
  if (pending && !signed) {
    const first = acts.find((d) => !closed(d));
    plan.hint = `Начисление откроется после подписания акта № ${first?.actNo ?? 1} заказчиком (раздел «Документы»).`;
  } else if (
    !pending &&
    payoutIds.length === 0 &&
    accruals.some((a) => a.state === 'proposed' || a.state === 'paid')
  ) {
    plan.hint = 'Выплаты проведены, операции появились в кассе.';
  }
  return plan;
}

// ── подрядчики ──

export interface SubToggle {
  label: string;
  open: boolean;
  until?: string;
}

export interface SubRowView {
  id: string;
  name: string;
  scope: string;
  access: string;
  closed: boolean;
  contract: string;
  paid: string;
  toggle: SubToggle;
}

/** Срок при «Открыть доступ»: прежний, если не в прошлом, иначе сегодня + 14 дней. */
function nextUntil(s: S['Subcontractor'], today: string): string {
  return s.accessUntil && s.accessUntil >= today ? s.accessUntil : addDays(today, 14);
}

export function subRows(items: readonly S['Subcontractor'][], today: string): SubRowView[] {
  return items.map((s) => {
    const until = nextUntil(s, today);
    return {
      id: s.id,
      name: s.name,
      scope: s.scope,
      closed: !s.active,
      access: !s.active
        ? 'Доступ закрыт'
        : s.accessUntil
          ? `Доступ к объекту до ${ruDay(s.accessUntil)}: отметки, фото, акты`
          : 'Доступ к объекту: отметки, фото, акты',
      contract: s.contract ? rub(s.contract.amountMinor) : '—',
      paid: s.paid ? rub(s.paid.amountMinor) : '—',
      toggle: s.active
        ? { label: 'Закрыть доступ', open: false }
        : { label: `Открыть доступ до ${ruDay(until)}`, open: true, until },
    };
  });
}

// ── кабинет заказчика ──

export interface LinkView {
  tone: Tone;
  icon: string;
  text: string;
  action?: { kind: 'revoke' | 'issue'; label: string };
}

export function linkView(
  link: S['ClientLink'],
  project: { status: S['RepairProject']['status']; clientName?: string },
): LinkView {
  if (project.status === 'handed_over') {
    return { tone: 'neutral', icon: 'link_off', text: 'Кабинет закрыт после сдачи объекта.' };
  }
  if (link.active) {
    const who =
      project.clientName && PERSON.test(project.clientName)
        ? dative(project.clientName)
        : 'заказчику';
    const when = link.sentAt ? ` ${ruDay(link.sentAt)}` : '';
    return {
      tone: 'ok',
      icon: 'link',
      text: `Ссылка отправлена ${who} по SMS${when} и действует до сдачи объекта.`,
      action: { kind: 'revoke', label: 'Отозвать ссылку' },
    };
  }
  return {
    tone: 'danger',
    icon: 'link_off',
    text: 'Ссылка отозвана: по старой ссылке кабинет не открывается.',
    action: { kind: 'issue', label: 'Выпустить новую ссылку' },
  };
}

export interface PreviewStage {
  name: string;
  icon: string;
  tone: 'ok' | 'info' | 'warn' | 'muted';
  when: string;
}

/** Этапы превью кабинета: четыре первых этапа графика и «Сдача объекта» (`cl` эталона :1308). */
export function previewStages(
  stages: readonly S['ScheduleStage'][],
  due: { dueOn?: string; forecastDueOn?: string },
): PreviewStage[] {
  const out: PreviewStage[] = stages.slice(0, 4).map((s) => {
    if (s.status === 'done') {
      return { name: s.name, icon: 'check_circle', tone: 'ok', when: 'готово' };
    }
    if (s.status === 'started') {
      return {
        name: s.name,
        icon: 'progress_activity',
        tone: 'info',
        when: `идёт, до ${ruDay(s.endOn)}`,
      };
    }
    return {
      name: s.name,
      icon: 'radio_button_unchecked',
      tone: 'muted',
      when: `с ${ruDay(s.startOn)}`,
    };
  });
  const forecast = due.forecastDueOn ?? due.dueOn;
  if (forecast) {
    const slip = !!due.dueOn && forecast > due.dueOn;
    out.push({
      name: 'Сдача объекта',
      icon: 'flag',
      tone: slip ? 'warn' : 'ok',
      when: `${ruDay(forecast)}${slip && due.dueOn ? ` · по договору ${ruDay(due.dueOn)}` : ''}`,
    });
  }
  return out;
}
