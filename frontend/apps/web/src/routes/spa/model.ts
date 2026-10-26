// W5.21 · Модель страницы «Салон и SPA» (spaVM :4242–4262 эталона design-2026-10-19): подписи статусов визита,
// буферы и техкарта, нехватка материала и решения владельца (resolveIssue), формы записи и услуги. Чистые функции.
import type { components } from '@ortus/api-client';

import { dayStart } from '../core/calendar/time.ts';
import { SPA_TEXT as T } from './texts.ts';

type S = components['schemas'];
export type Status = S['Appointment']['status'];
export type Unit = S['ConsumptionRecipeLine']['unit'];
type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

export interface Chip {
  label: string;
  tone: Tone;
  icon: string;
}

/** Статус визита (ST :4244): подпись, тон, значок. */
export function chipOf(status: Status): Chip {
  return { ...T.status[status] };
}

export const durationText = (min: number): string => `${min} ${T.min}`;

/** «подготовка 15 мин · уборка 15 мин» или «без буферов» (:4255). */
export function buffersText(before: number, after: number): string {
  const parts = [
    before ? `${T.prep} ${before} ${T.min}` : null,
    after ? `${T.clean} ${after} ${T.min}` : null,
  ].filter((x): x is string => x !== null);
  return parts.join(' · ') || T.noBuffers;
}

export const unitLabel = (u: S['InventoryItem']['baseUnit']): string => T.units[u];

const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');

export function moneyText(m: S['Money']): string {
  const rub = Math.floor(m.amountMinor / 100);
  const kop = m.amountMinor % 100;
  const body = kop ? `${group(rub)},${String(kop).padStart(2, '0')}` : group(rub);
  return `${body}\u00a0₽`;
}

/** Количество для подписи: десятичная запятая, без хвоста. */
export const qtyText = (n: number): string => String(+n.toFixed(6)).replace('.', ',');

/** Клиент визита — из названия брони «Услуга · Клиент» (справочника клиентов в контракте нет, Q-W5.21-1). */
export function clientOf(title: string | undefined, service: string | undefined): string {
  if (!title) return T.client;
  const head = service ? `${service} · ` : '';
  if (head && title.startsWith(head)) return title.slice(head.length) || T.client;
  const i = title.indexOf(' · ');
  return i >= 0 ? title.slice(i + 3) || T.client : T.client;
}

/** Техкарта: «Масло массажное 30 мл». */
export function recipeChips(
  recipe: readonly S['ConsumptionRecipeLine'][],
  names: ReadonlyMap<string, string>,
): string[] {
  return recipe.map(
    (l) => `${names.get(l.itemId) ?? T.item} ${qtyText(Number(l.quantity))} ${unitLabel(l.unit)}`,
  );
}

// ───────────────────────────── нехватка материала ─────────────────────────────

export interface Shortage {
  itemId: string;
  need: number;
  have: number;
  unit: Unit;
}

/** Позиции техкарты, которых на складе меньше, чем нужно (остаток без записи — 0). */
export function shortages(
  recipe: readonly S['ConsumptionRecipeLine'][],
  have: ReadonlyMap<string, number>,
): Shortage[] {
  const out: Shortage[] = [];
  for (const l of recipe) {
    const need = Number(l.quantity);
    const h = have.get(l.itemId) ?? 0;
    if (h < need) out.push({ itemId: l.itemId, need, have: h, unit: l.unit });
  }
  return out;
}

/** «Не хватило «X»: нужно 20 г, в наличии 12 г · SPA-ритуал (Ольга Р.)» (:4237, issues эталона). */
export function shortageText(
  list: readonly Shortage[],
  names: ReadonlyMap<string, string>,
  service: string,
  client: string,
): string {
  const lines = list.map(
    (s) =>
      `${T.lacked} «${names.get(s.itemId) ?? T.item}»: ${T.need} ${qtyText(s.need)} ${unitLabel(s.unit)}, ${T.have} ${qtyText(s.have)} ${unitLabel(s.unit)}`,
  );
  return `${lines.join('; ')} · ${service} (${client})`;
}

export type Resolve = 'reserve' | 'actual';

/** Решение владельца: фактический расход позиции — то, что есть на складе (обе кнопки эталона). */
export function overridesOf(list: readonly Shortage[], how: Resolve): S['ConsumptionOverride'][] {
  return list.map((s) => ({
    itemId: s.itemId,
    actualQuantity: String(+s.have.toFixed(6)),
    reason: T.resolve[how].reason,
  }));
}

// ───────────────────────────── запись ─────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0');

/** Время начала: сетка 15 минут рабочего дня 08:00–20:00 (сетка календаря эталона). */
export function timeOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let m = 8 * 60; m < 20 * 60; m += 15) {
    const v = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    out.push({ value: v, label: v });
  }
  return out;
}

/** Начало визита: местные дата и время в поясе организации → момент UTC (Z). */
export function startsAtOf(date: string, hhmm: string, tz: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const ms = dayStart(date, tz) + (h * 60 + m) * 60_000;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export interface VisitDraft {
  serviceId: string;
  clientId: string;
  practitionerId: string;
  roomId: string;
  equipmentIds: string[];
  time: string;
}

export type VisitField = 'serviceId' | 'clientId' | 'practitionerId' | 'roomId' | 'equipmentIds';

/** Ошибки полей записи; `required` — оборудование, которое требует выбранная услуга. */
export function visitErrors(
  d: VisitDraft,
  required: readonly string[],
): Partial<Record<VisitField, string>> {
  const e: Partial<Record<VisitField, string>> = {};
  if (!d.serviceId) e.serviceId = T.visitForm.errors.service;
  if (!d.clientId) e.clientId = T.visitForm.errors.client;
  if (!d.practitionerId) e.practitionerId = T.visitForm.errors.practitioner;
  if (!d.roomId) e.roomId = T.visitForm.errors.room;
  if (required.some((id) => !d.equipmentIds.includes(id))) {
    e.equipmentIds = T.visitForm.errors.equipment;
  }
  return e;
}

/** Клиенты для записи: клиенты видимых визитов с подписью из названий броней (Q-W5.21-1). */
export function clientsOf(
  visits: readonly { clientId: string; serviceId: string; bookingId: string }[],
  titles: ReadonlyMap<string, string>,
  services: ReadonlyMap<string, string>,
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const v of visits) {
    if (seen.has(v.clientId)) continue;
    seen.set(v.clientId, clientOf(titles.get(v.bookingId), services.get(v.serviceId)));
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

// ───────────────────────────── услуга ─────────────────────────────

export interface ServiceDraft {
  name: string;
  duration: string;
  before: string;
  after: string;
  /** Рубли строкой: «1 800,50». */
  price: string;
  equipmentIds: string[];
  recipe: { itemId: string; quantity: string }[];
}

export type ServiceField = 'name' | 'duration' | 'before' | 'after' | 'price' | 'recipe';

const clean = (s: string): string => s.replace(/[\s\u00a0]/g, '').replace(',', '.');
const isInt = (s: string): boolean => /^\d+$/.test(s.trim());
const isMoney = (s: string): boolean => /^\d+(\.\d{1,2})?$/.test(clean(s));
const isQty = (s: string): boolean => /^\d+(\.\d{1,6})?$/.test(clean(s)) && Number(clean(s)) > 0;

export function serviceErrors(d: ServiceDraft): Partial<Record<ServiceField, string>> {
  const e: Partial<Record<ServiceField, string>> = {};
  const E = T.serviceForm.errors;
  if (!d.name.trim()) e.name = E.name;
  if (!isInt(d.duration) || Number(d.duration) < 1) e.duration = E.duration;
  if (!isInt(d.before)) e.before = E.buffer;
  if (!isInt(d.after)) e.after = E.buffer;
  if (!isMoney(d.price)) e.price = E.price;
  const ids = d.recipe.map((l) => l.itemId);
  if (ids.some((id) => !id)) e.recipe = E.recipeItem;
  else if (d.recipe.some((l) => !isQty(l.quantity))) e.recipe = E.recipeQty;
  else if (new Set(ids).size < ids.length) e.recipe = E.recipeDup;
  return e;
}

export type ServiceBody = Omit<S['SpaServiceCreate'], 'orgUnitId'>;

/** Тело услуги по черновику: цена в копейках, количества — десятичные строки, единица — базовая единица позиции. */
export function serviceBody(
  d: ServiceDraft,
  items: readonly { id: string; baseUnit: S['InventoryItem']['baseUnit'] }[],
): ServiceBody {
  return {
    name: d.name.trim(),
    durationMinutes: Number(d.duration),
    bufferBeforeMinutes: Number(d.before),
    bufferAfterMinutes: Number(d.after),
    price: { amountMinor: Math.round(Number(clean(d.price)) * 100), currency: 'RUB' },
    requiredEquipmentIds: [...d.equipmentIds],
    recipe: d.recipe.map((l) => ({
      itemId: l.itemId,
      quantity: String(Number(clean(l.quantity))),
      unit: (items.find((i) => i.id === l.itemId)?.baseUnit ?? 'piece') as Unit,
    })),
  };
}

export function draftOfService(s: S['SpaService']): ServiceDraft {
  const rub = s.price.amountMinor / 100;
  return {
    name: s.name,
    duration: String(s.durationMinutes),
    before: String(s.bufferBeforeMinutes),
    after: String(s.bufferAfterMinutes),
    price: Number.isInteger(rub) ? String(rub) : rub.toFixed(2).replace('.', ','),
    equipmentIds: [...s.requiredEquipmentIds],
    recipe: s.recipe.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
  };
}

export const emptyService = (): ServiceDraft => ({
  name: '',
  duration: '60',
  before: '0',
  after: '15',
  price: '',
  equipmentIds: [],
  recipe: [],
});
