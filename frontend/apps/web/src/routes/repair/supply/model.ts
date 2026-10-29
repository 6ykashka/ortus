// W6.22 · Модель снабжения «Ремонта и стройки»: подписи, суммы и заметки эталона (`hubVM`, `supMeta`, `makePurchase`,
// `reserve`, `issue`, `receive`, `backToWh`, `moveTo`, :1544–1642 `Ремонт и стройка.dc.html`, снимок design-2026-10-19)
// поверх DTO контракта 0.12.0-stage6. Чистые функции без React: часы — параметр (`today`).
import type { components } from '@ortus/api-client';
import { plural } from '@ortus/domain';

type S = components['schemas'];
export type Unit = S['RepairUnit'];
export type SupplyRequest = S['SupplyRequest'];
export type Purchase = S['Purchase'];

/** Единицы контракта → подпись эталона (`UNIT_OF` наоборот). */
const UNIT_RU: Readonly<Record<Unit, string>> = {
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
export const unitRu = (u: Unit): string => UNIT_RU[u] ?? u;

/** Единицы формы «Новая позиция» (эталон: `м², м, шт, рейс, меш, л, компл`). */
export const PRICE_UNITS: readonly Unit[] = ['m2', 'm', 'piece', 'trip', 'mesh', 'liter', 'set'];

/** Рубли эталона (`rub`): целые, разделитель разрядов — как `Intl.NumberFormat('ru-RU')`. */
export const rubText = (minor: number): string =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(minor / 100))} ₽`;

export const moneyText = (m: S['Money']): string => rubText(m.amountMinor);

/** Число эталона (`num`): один знак после запятой. */
export const numText = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('ru-RU');

export const qtyText = (quantity: string, unit: Unit): string =>
  `${numText(Number(quantity))} ${unitRu(unit)}`;

/** «дд.мм» из даты или момента (`dt`). */
export const dmText = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Ввод числа эталона (`pnum`): пробелы убираются, запятая — десятичная, не число — 0. */
export function parsePrice(v: string): number {
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Непустой ввод цены, который не является числом больше нуля. */
export function isPriceInvalid(v: string): boolean {
  return v.trim() !== '' && !(parsePrice(v) > 0);
}

export const dayCount = (n: number): string => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

/** Дней от `today` до даты `needBy` (`dd`): по календарным дням, без времени суток. */
export function daysLeft(needBy: string, today: Date): number {
  const [y, m, d] = needBy.slice(0, 10).split('-').map(Number);
  const to = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const from = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((to - from) / 864e5);
}

/** Подпись под датой «Нужно к»: просрочено, сегодня, через N; жёлтая — не позже чем через 2 дня. */
export function needSub(days: number): { text: string; warn: boolean } {
  const text =
    days < 0
      ? `просрочено на ${dayCount(-days)}`
      : days === 0
        ? 'сегодня'
        : `через ${dayCount(days)}`;
  return { text, warn: days <= 2 };
}

/** «На складах» заявки: «склад: остаток» через « · » или «На складах нет». */
export function availText(r: SupplyRequest): string {
  const av = r.available ?? [];
  if (!av.length) return 'На складах нет';
  return av.map((a) => `${a.warehouseName}: ${qtyText(a.free, r.unit)}`).join(' · ');
}

/** Склад, где свободно не меньше заявки: на него кнопка «Выдать со склада». */
export function issueTarget(
  r: SupplyRequest,
): NonNullable<SupplyRequest['available']>[number] | undefined {
  return (r.available ?? []).find((a) => Number(a.free) >= Number(r.quantity));
}

export interface SplitRequests {
  pending: SupplyRequest[];
  work: SupplyRequest[];
  done: SupplyRequest[];
}

/** «Ждут решения» (request), «В работе» (reserved, ordered), выполнено (bought, issued, used). */
export function splitRequests(list: readonly SupplyRequest[]): SplitRequests {
  return {
    pending: list.filter((r) => r.state === 'request'),
    work: list.filter((r) => r.state === 'reserved' || r.state === 'ordered'),
    done: list.filter((r) => r.state === 'bought' || r.state === 'issued' || r.state === 'used'),
  };
}

export const doneText = (n: number): string =>
  n ? `Выполнено: ${n} ${plural(n, 'заявка', 'заявки', 'заявок')} — см. «Движения».` : '';

export const buyLabel = (n: number): string =>
  `Собрать закупку${n ? ` · ${n} ${plural(n, 'заявка', 'заявки', 'заявок')}` : ''}`;

/** Метка статуса «В закупке»: у закупленного к статусу добавляется номер закупки (эталон: `S[0] + ' ' + r.pur`). */
export const stateLabel = (
  label: string,
  state: SupplyRequest['state'],
  purchase?: string,
): string => (state === 'ordered' && purchase ? `${label} ${purchase}` : label);

/** Строка под названием заявки (`supMeta`): срок и склады, резерв, закупка, выдача, закупленное, списанное. */
export function requestMeta(
  r: SupplyRequest,
  o: { warehouse?: string | undefined; purchase?: string | undefined },
): string {
  const need = `нужно к ${dmText(r.needBy)}`;
  switch (r.state) {
    case 'request': {
      if (!r.available) return need;
      const av = r.available.filter((a) => Number(a.free) > 0);
      return av.length
        ? `${need} · на складе ${av.map((a) => `«${a.warehouseName}»: ${qtyText(a.free, r.unit)}`).join(', ')}`
        : `${need} · на складах нет`;
    }
    case 'reserved':
      return o.warehouse
        ? `Склад «${o.warehouse}» · прораб забирает по заявке`
        : 'Прораб забирает по заявке';
    case 'ordered':
      return `${o.purchase ? `Закупка ${o.purchase} · ` : ''}${need}`;
    case 'issued':
      return r.cost ? `Со склада · ${moneyText(r.cost)} по средней цене` : 'Со склада';
    case 'bought':
      return r.cost ? `Чек по QR · ${moneyText(r.cost)}` : 'Чек по QR';
    default:
      return 'Списано на объект';
  }
}

export interface PurchaseGroup {
  priceItemId: string;
  name: string;
  qty: string;
  dist: string;
  /** Сумма по введённой цене, копейки; `null` — цена не введена (её подставит сервер). */
  sumMinor: number | null;
}

/** Строки формы «Новая закупка»: заявки одного материала в одной строке, распределение по объектам. */
export function purchaseGroups(
  selected: readonly SupplyRequest[],
  prices: Readonly<Record<string, string>>,
): PurchaseGroup[] {
  const ids = [...new Set(selected.map((r) => r.priceItemId))];
  return ids.map((id) => {
    const rs = selected.filter((r) => r.priceItemId === id);
    const first = rs[0] as SupplyRequest;
    const total = rs.reduce((a, r) => a + Number(r.quantity), 0);
    const price = parsePrice(prices[id] ?? '');
    return {
      priceItemId: id,
      name: first.name,
      qty: `${numText(total)} ${unitRu(first.unit)}`,
      dist: rs.map((r) => `${r.projectName} — ${qtyText(r.quantity, r.unit)}`).join(' · '),
      sumMinor: price > 0 ? Math.round(total * price * 100) : null,
    };
  });
}

/** Тело `createPurchase`: цена только введённая, остальное решает сервер (Q-W4.00-repair-23). */
export function purchaseLines(
  selected: readonly SupplyRequest[],
  prices: Readonly<Record<string, string>>,
): S['PurchaseLineInput'][] {
  return selected.map((r) => {
    const price = parsePrice(prices[r.priceItemId] ?? '');
    return price > 0
      ? { supplyRequestId: r.id, price: { amountMinor: Math.round(price * 100), currency: 'RUB' } }
      : { supplyRequestId: r.id };
  });
}

export const objectsOf = (selected: readonly SupplyRequest[]): number =>
  new Set(selected.map((r) => r.projectId)).size;

export const purchaseNote = (
  number: string,
  supplier: string,
  lines: number,
  objects: number,
): string =>
  `Закупка ${number} у «${supplier}»: ${lines} ${plural(lines, 'позиция', 'позиции', 'позиций')} для ${objects} ${plural(objects, 'объекта', 'объектов', 'объектов')}. После получения сумма каждой строки уйдёт в расходы своего объекта.`;

export function purchaseMeta(p: Purchase): string {
  const objs = new Set(p.lines.map((l) => l.projectId)).size;
  const n = p.lines.length;
  return `${dmText(p.createdAt)} · ${n} ${plural(n, 'позиция', 'позиции', 'позиций')} · ${objs} ${plural(objs, 'объект', 'объекта', 'объектов')}`;
}

export const reserveNote = (r: SupplyRequest, warehouse: string): string =>
  `Резерв на складе «${warehouse}»: ${r.name}, ${qtyText(r.quantity, r.unit)}. Кладовщик выдаст прорабу по заявке ${r.number}.`;

export const issueNote = (r: SupplyRequest, costMinor: number): string =>
  `${r.name} выдан на объект «${r.projectName}»: ${rubText(costMinor)} по средней цене склада — в расходы объекта.`;

export const receiveNote = (number: string): string =>
  `Закупка ${number} получена: материалы на объектах, суммы разнесены по объектам.`;

export const returnNote = (
  item: string,
  quantity: string,
  unit: Unit,
  warehouse: string,
  project: string,
  costMinor: number,
): string =>
  `${item}, ${qtyText(quantity, unit)} возвращены на склад «${warehouse}». Средняя цена склада пересчитана, объект «${project}» уменьшил расходы на ${rubText(costMinor)}.`;

/** Заметка о перемещении; `target` — открытая заявка цели на тот же материал (её уменьшает или закрывает сервер). */
export function moveNote(
  item: string,
  quantity: string,
  unit: Unit,
  project: string,
  target?: SupplyRequest,
): string {
  const n = Number(quantity);
  let request = '';
  if (target) {
    const left = Number(target.quantity) - Math.min(Number(target.quantity), n);
    request =
      Number(target.quantity) > n
        ? `. Заявка ${target.number} уменьшена до ${numText(left)} ${unitRu(target.unit)}`
        : `. Заявка ${target.number} закрыта перемещением`;
  }
  return `${item}, ${qtyText(quantity, unit)} перемещены на «${project}»${request}. Стоимость перенесена в расходы нового объекта.`;
}
