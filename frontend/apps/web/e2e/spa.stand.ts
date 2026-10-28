// W2.103 · Данные «Салона и SPA» для строк @stand: услуга с техкартой и визиты создаются командами API (Spa, W5.20)
// из сессии владельца. Ресурсы (специалист, кабинеты, стол) — из сида календаря «Альты». Каждый тест берёт свой день
// в далёком будущем: ресурсы сида общие для трёх проектов и повторов, пересечений по времени быть не должно.
import type { Page } from '@playwright/test';

import { expectStatus } from './_stand/stand.ts';
import { call } from './shell.helpers.ts';

export interface SpaResources {
  orgUnitId: string;
  practitioner: { memberId: string; name: string };
  rooms: { id: string; name: string }[];
  table: { id: string; name: string };
}

export interface SpaVisit {
  id: string;
  revision: number;
  serviceName: string;
  date: string;
  time: string;
}

interface Resource {
  id: string;
  kind: string;
  name: string;
  orgUnitId: string;
  object?: { entityId: string };
}

/** Специалист, кабинеты и стол из календаря организации (listCalendarResources). */
export async function spaResources(page: Page, tenant: string): Promise<SpaResources> {
  const r = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/calendar/resources?limit=100`),
    200,
    'listCalendarResources',
  );
  const items = (r.body as { items: Resource[] }).items;
  const person = items.find((x) => x.kind === 'member' && /массажист/.test(x.name));
  const rooms = items.filter((x) => x.kind === 'room');
  const table = items.find((x) => x.kind === 'equipment');
  if (!person?.object || rooms.length < 2 || !table)
    throw new Error('в календаре нет ресурсов салона');
  return {
    orgUnitId: person.orgUnitId,
    practitioner: { memberId: person.object.entityId, name: person.name },
    rooms: rooms.map((x) => ({ id: x.id, name: x.name })),
    table: { id: table.id, name: table.name },
  };
}

/**
 * День теста: уникален по времени запуска (шаг 1 с, круг 10 часов), от 2027-01-01 и дальше на ~100 лет — ресурсы сида общие,
 * часы страницы заморожены на 1.10.2026, сервер пересечения считает по своему календарю.
 */
export function standDay(offset = 0): string {
  const days = (Math.floor(Date.now() / 1_000) + offset) % 36_000;
  return new Date(Date.UTC(2027, 0, 1) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * День в прошлом относительно часов страницы (1.10.2026): «Завершить процедуру» отправляет момент выполнения по часам
 * страницы, сервер отвергает выполнение раньше начала визита — визит должен начаться до этого момента.
 */
export function pastDay(offset = 0): string {
  const days = (Math.floor(Date.now() / 1_000) + offset) % 9_000;
  return new Date(Date.UTC(2001, 0, 1) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Услуга с техкартой из одной позиции склада (createSpaService). */
export async function spaService(
  page: Page,
  tenant: string,
  res: SpaResources,
  o: {
    name: string;
    itemId: string;
    qty: string;
    minutes?: number;
    before?: number;
    after?: number;
    priceMinor?: number;
    equipmentIds?: string[];
  },
): Promise<{ id: string; name: string; revision: number }> {
  const r = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/spa/services`, {
      body: {
        orgUnitId: res.orgUnitId,
        name: o.name,
        durationMinutes: o.minutes ?? 60,
        bufferBeforeMinutes: o.before ?? 0,
        bufferAfterMinutes: o.after ?? 15,
        price: { amountMinor: o.priceMinor ?? 320_000, currency: 'RUB' },
        requiredEquipmentIds: o.equipmentIds ?? [],
        recipe: [{ itemId: o.itemId, quantity: o.qty, unit: 'ml' }],
      },
    }),
    201,
    'createSpaService',
  );
  return r.body as { id: string; name: string; revision: number };
}

/** Визит (createAppointment): местное время поясом Москвы (+03:00 круглый год). */
export async function spaVisit(
  page: Page,
  tenant: string,
  res: SpaResources,
  svc: { id: string; name: string },
  o: { date: string; time: string; roomIndex?: number; equipmentIds?: string[]; clientId?: string },
): Promise<SpaVisit> {
  const startsAt = new Date(`${o.date}T${o.time}:00+03:00`).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const r = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/spa/appointments`, {
      body: {
        orgUnitId: res.orgUnitId,
        serviceId: svc.id,
        clientId: o.clientId ?? crypto.randomUUID(),
        practitionerMemberId: res.practitioner.memberId,
        roomId: res.rooms[o.roomIndex ?? 0]?.id,
        equipmentIds: o.equipmentIds ?? [],
        startsAt,
        timeZone: 'Europe/Moscow',
      },
    }),
    201,
    'createAppointment',
  );
  const v = r.body as { id: string; revision: number };
  return { id: v.id, revision: v.revision, serviceName: svc.name, date: o.date, time: o.time };
}

/**
 * Приход позиции на склад, с которого страница списывает материалы визита: первый неархивный склад организации
 * (`firstWarehouse` страницы, listWarehouses). Без него «Завершить процедуру» упрётся в нехватку.
 */
export async function stockSalonWarehouse(
  page: Page,
  tenant: string,
  itemId: string,
  qty: string,
  expiresOn: string,
): Promise<string> {
  const list = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/inventory/warehouses?limit=200`),
    200,
    'listWarehouses',
  ).body as { items: { id: string; archived: boolean }[] };
  const first = list.items.find((w) => !w.archived);
  if (!first) throw new Error('нет склада для списания');
  expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/inventory/movements`, {
      body: {
        kind: 'receipt',
        warehouseId: first.id,
        lines: [{ itemId, quantity: qty, expiresOn }],
      },
    }),
    201,
    'postMovement receipt (склад салона)',
  );
  return first.id;
}
