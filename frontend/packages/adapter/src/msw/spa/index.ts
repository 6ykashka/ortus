// Тег Spa сценарного сервера (W5.21, контракт 0.12.0-stage5; W5.20 — настоящий backend): услуги с техкартой, визиты
// (запись на специалиста, кабинет и оборудование атомарно с буферами услуги, перенос, отмена, «не пришёл»), отметка
// выполнения и завершение со списанием материалов один раз. Эталон — «Ортус CRM.dc.html» pg.spa :1870, ortus/api.js
// completeAppointment/resolveIssue (design-2026-10-19), analysis/06 §SPA. Визит занимает ресурсы через бронь календаря:
// конфликт — 409 resources_unavailable с текстом календаря. Нехватка материала — 409 invalid_transition
// (reason insufficient_stock) без частичного списания; визит остаётся `performed_pending_posting`.
import type { components } from '@ortus/api-client';

import { calendarOf, iso, occupiedOf } from '../calendar/state.ts';
import { page, uuidParam } from '../core/page.ts';
import { fail, type Violation } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import { MINUTE } from '../core/time.ts';
import { issueForSource, onHandNumber } from '../inventory/index.ts';
import {
  type ApptRow,
  appointmentDto,
  bookingOf,
  bookingTitle,
  dayOf,
  inWorkday,
  type ItemRow,
  practitionerResource,
  type RecipeLine,
  type ServiceRow,
  serviceDto,
  SPA_KEYS,
  type SpaView,
  toQty,
  UNIT_RU,
  viewOf,
  warehouseOf,
} from './state.ts';

type S = components['schemas'];

/** Допуск «выполнено сейчас»: часы клиента и сервера расходятся не больше чем на это. */
const SKEW = 5 * MINUTE;
const NOT_FOUND_APPT = 'Визит не найден.';

function invalid(field: string, code: string, message: string): never {
  const v: Violation = { field, code, message };
  return fail('validation_failed', message, { violations: [v] });
}

const lower = (id: string | undefined | null): string => (id ?? '').toLowerCase();

function apptOr404(v: SpaView, id: string | undefined): ApptRow {
  const a = v.data.appointments.find((x) => x.id === lower(id));
  if (!a || !v.visible(a)) return fail('not_found', NOT_FOUND_APPT);
  return a;
}

function serviceOr404(v: SpaView, id: string | undefined): ServiceRow {
  const s = v.data.services.find((x) => x.id === lower(id));
  const units = v.units(SPA_KEYS.servicesRead);
  if (!s || (units !== 'all' && !units.has(s.orgUnitId))) {
    return fail('not_found', 'Услуга не найдена.');
  }
  return s;
}

const num = (q: string): number => Number(q);

/** Проверка техкарты: номенклатура есть, единица совпадает с базовой, количество больше нуля. */
function checkRecipe(v: SpaView, lines: readonly S['ConsumptionRecipeLine'][]): RecipeLine[] {
  const seen = new Set<string>();
  return lines.map((l, i) => {
    const item = v.data.items.find((x) => x.id === lower(l.itemId));
    if (!item) invalid(`recipe[${i}].itemId`, 'unknown', 'Позиция номенклатуры не найдена.');
    if (seen.has(item.id))
      invalid(`recipe[${i}].itemId`, 'duplicate', 'Позиция уже есть в техкарте.');
    seen.add(item.id);
    if (l.unit !== item.baseUnit) {
      invalid(`recipe[${i}].unit`, 'unit_mismatch', `Единица позиции — ${item.baseUnit}.`);
    }
    if (!(num(l.quantity) > 0)) {
      invalid(`recipe[${i}].quantity`, 'positive', 'Количество должно быть больше нуля.');
    }
    return { itemId: item.id, quantity: l.quantity, unit: l.unit };
  });
}

function checkEquipment(v: SpaView, ids: readonly string[], field: string): string[] {
  const cal = calendarOf(v.t.org);
  return ids.map((id, i) => {
    const r = cal.resources.find((x) => x.id === lower(id));
    if (r?.kind !== 'equipment' || !r.active) {
      invalid(`${field}[${i}]`, 'unknown', 'Оборудование не найдено.');
    }
    return r.id;
  });
}

function checkUnit(v: SpaView, id: string, key: string): string {
  const unit = v.t.org.units.find((u) => u.id === lower(id));
  if (!unit) invalid('orgUnitId', 'unknown', 'Подразделение не найдено.');
  const units = v.units(key);
  if (units !== 'all' && !units.has(unit.id)) fail('forbidden_action');
  return unit.id;
}

const money = (m: S['Money'] | undefined, field: string): number => {
  if (!m || m.currency !== 'RUB') invalid(field, 'currency', 'Цена указывается в рублях.');
  return m.amountMinor;
};

// ───────────────────────────── запись ─────────────────────────────

interface Placement {
  start: number;
  end: number;
  practitionerMemberId: string;
  roomId: string;
  equipmentIds: string[];
}

/**
 * Проверка и занятие ресурсов визита: специалист (ресурс календаря), кабинет, оборудование — рабочий день и
 * пересечения с занятостью других броней (с подготовкой и уборкой услуги). Тексты — как у календаря.
 */
function place(v: SpaView, svc: ServiceRow, p: Placement, except: string | undefined) {
  const cal = calendarOf(v.t.org);
  const person = practitionerResource(v, p.practitionerMemberId);
  if (!person) invalid('practitionerMemberId', 'unknown', 'Специалист не найден в календаре.');
  const room = cal.resources.find((r) => r.id === lower(p.roomId));
  if (room?.kind !== 'room' || !room.active) invalid('roomId', 'unknown', 'Кабинет не найден.');
  const equipment = checkEquipment(v, p.equipmentIds, 'equipmentIds');
  const missing = svc.requiredEquipmentIds.filter((id) => !equipment.includes(id));
  if (missing.length) {
    const names = missing.map((id) => cal.resources.find((r) => r.id === id)?.name ?? id);
    invalid('equipmentIds', 'required', `Для услуги нужно оборудование: ${names.join(', ')}.`);
  }
  const rs = [
    person,
    room,
    ...equipment.map((id) => cal.resources.find((r) => r.id === id)),
  ].filter((r): r is NonNullable<typeof r> => !!r);
  const occ: [number, number] = [
    p.start - svc.bufferBeforeMinutes * MINUTE,
    p.end + svc.bufferAfterMinutes * MINUTE,
  ];
  if (!inWorkday(rs, occ, dayOf(p.start))) {
    invalid('startsAt', 'workday', 'Время вне рабочего дня ресурса.');
  }
  const fieldOf = (rid: string, i: number): string =>
    i === 0 ? 'practitionerMemberId' : i === 1 ? 'roomId' : `equipmentIds[${i - 2}]`;
  const violations: Violation[] = [];
  for (const other of cal.bookings) {
    if (other.status !== 'confirmed' || other.id === except) continue;
    const [a, z] = occupiedOf(other);
    if (!(a < occ[1] && occ[0] < z)) continue;
    for (const rid of other.resourceIds) {
      const i = rs.findIndex((r) => r.id === rid);
      const r = rs[i];
      if (!r) continue;
      violations.push({
        field: fieldOf(rid, i),
        code: 'busy',
        message: `${r.name} занят («${other.title}»)`,
      });
    }
  }
  if (violations.length) {
    fail(
      'resources_unavailable',
      `Конфликт ресурсов: ${violations.map((x) => x.message).join('; ')}`,
      {
        violations,
      },
    );
  }
  return { person, room, resourceIds: rs.map((r) => r.id), equipment };
}

function checkWho(v: SpaView, memberId: string, unitId: string): void {
  if (!v.t.org.members.some((m) => m.id === lower(memberId))) {
    invalid('practitionerMemberId', 'unknown', 'Специалист не найден.');
  }
  const units = v.units(SPA_KEYS.create);
  if (units === 'all' || units.has(unitId)) return;
  // Область «своё»: специалист записывает только в своё расписание.
  if (v.selfOnly(SPA_KEYS.create) && v.t.member?.id === lower(memberId)) return;
  fail('forbidden_action', 'Специалист записывает только в своё расписание.');
}

// ───────────────────────────── завершение ─────────────────────────────

/** Нехватка материала: текст эталона (resolveIssue/issues) — «Не хватило «X»: нужно N u, в наличии M u». */
const shortText = (item: ItemRow, need: number, have: number): string =>
  `Не хватило «${item.name}»: нужно ${toQty(need)} ${UNIT_RU[item.baseUnit]}, в наличии ${toQty(have)} ${UNIT_RU[item.baseUnit]}.`;

export const spaHandlers: Registry = {
  listSpaServices: (ctx) => {
    const v = viewOf(ctx);
    const units = v.units(SPA_KEYS.servicesRead);
    const items = v.data.services
      .filter((s) => units === 'all' || units.has(s.orgUnitId))
      .map(serviceDto);
    return { body: page(items, ctx.query) };
  },

  createSpaService: (ctx) => {
    const v = viewOf(ctx);
    const b = ctx.body as S['SpaServiceCreate'];
    const unit = checkUnit(v, b.orgUnitId, SPA_KEYS.servicesManage);
    const name = b.name.trim();
    if (!name) invalid('name', 'required', 'Укажите название услуги.');
    if (
      v.data.services.some(
        (s) => s.orgUnitId === unit && s.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      invalid('name', 'duplicate', `Услуга «${name}» уже есть.`);
    }
    const row: ServiceRow = {
      id: ctx.newId('spa-service'),
      proto: '',
      orgUnitId: unit,
      name,
      durationMinutes: b.durationMinutes,
      bufferBeforeMinutes: b.bufferBeforeMinutes,
      bufferAfterMinutes: b.bufferAfterMinutes,
      price: money(b.price, 'price'),
      requiredEquipmentIds: checkEquipment(v, b.requiredEquipmentIds, 'requiredEquipmentIds'),
      recipe: checkRecipe(v, b.recipe),
      revision: 1,
    };
    v.data.services.push(row);
    return { status: 201, body: serviceDto(row), etag: 1 };
  },

  getSpaService: (ctx) => {
    const s = serviceOr404(viewOf(ctx), ctx.params.serviceId);
    return { body: serviceDto(s), etag: s.revision };
  },

  updateSpaService: (ctx) => {
    const v = viewOf(ctx);
    const s = serviceOr404(v, ctx.params.serviceId);
    const units = v.units(SPA_KEYS.servicesManage);
    if (units !== 'all' && !units.has(s.orgUnitId)) fail('forbidden_action');
    ctx.revision(s.revision);
    const p = ctx.body as S['SpaServicePatch'];
    const name = p.name?.trim();
    if (p.name !== undefined && !name) invalid('name', 'required', 'Укажите название услуги.');
    if (
      name &&
      v.data.services.some(
        (x) =>
          x.id !== s.id &&
          x.orgUnitId === s.orgUnitId &&
          x.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      invalid('name', 'duplicate', `Услуга «${name}» уже есть.`);
    }
    const next: Partial<ServiceRow> = {};
    if (name) next.name = name;
    if (p.durationMinutes !== undefined) next.durationMinutes = p.durationMinutes;
    if (p.bufferBeforeMinutes !== undefined) next.bufferBeforeMinutes = p.bufferBeforeMinutes;
    if (p.bufferAfterMinutes !== undefined) next.bufferAfterMinutes = p.bufferAfterMinutes;
    if (p.price) next.price = money(p.price, 'price');
    if (p.requiredEquipmentIds) {
      next.requiredEquipmentIds = checkEquipment(v, p.requiredEquipmentIds, 'requiredEquipmentIds');
    }
    if (p.recipe) next.recipe = checkRecipe(v, p.recipe);
    Object.assign(s, next);
    s.revision++;
    return { body: serviceDto(s), etag: s.revision };
  },

  listAppointments: (ctx) => {
    const v = viewOf(ctx);
    const status = ctx.query.get('status');
    const STATUSES = [
      'confirmed',
      'performed_pending_posting',
      'completed',
      'cancelled',
      'no_show',
    ];
    if (status !== null && !STATUSES.includes(status))
      fail('malformed_request', 'Неизвестный статус визита.');
    const instant = (name: string): number | undefined => {
      const raw = ctx.query.get(name);
      if (raw === null) return undefined;
      const ms = Date.parse(raw);
      if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(ms)) {
        fail('malformed_request', `Параметр ${name} — не момент времени.`);
      }
      return ms;
    };
    const from = instant('from');
    const to = instant('to');
    const who = uuidParam(ctx.query, 'practitionerMemberId', false);
    const items = v.data.appointments
      .filter((a) => v.visible(a))
      .filter((a) => !status || a.status === status)
      .filter((a) => !who || a.practitionerMemberId === who)
      .map((a) => ({ a, at: Date.parse(bookingOf(v, a)?.window.startsAt ?? '') }))
      .filter(({ at }) => (from === undefined || at >= from) && (to === undefined || at < to))
      .sort((x, y) => x.at - y.at || x.a.id.localeCompare(y.a.id))
      .map(({ a }) => appointmentDto(v, a));
    return { body: page(items, ctx.query) };
  },

  getAppointment: (ctx) => {
    const v = viewOf(ctx);
    const a = apptOr404(v, ctx.params.appointmentId);
    return { body: appointmentDto(v, a), etag: a.revision };
  },

  createAppointment: (ctx) => {
    const v = viewOf(ctx);
    const b = ctx.body as S['AppointmentCreate'];
    const svc = v.data.services.find((s) => s.id === lower(b.serviceId));
    if (!svc) invalid('serviceId', 'unknown', 'Услуга не найдена.');
    const unit = v.t.org.units.find((u) => u.id === lower(b.orgUnitId));
    if (!unit || unit.id !== svc.orgUnitId)
      invalid('orgUnitId', 'unknown', 'Подразделение не найдено.');
    checkWho(v, b.practitionerMemberId, unit.id);
    const start = Date.parse(b.startsAt);
    const at = place(
      v,
      svc,
      {
        start,
        end: start + svc.durationMinutes * MINUTE,
        practitionerMemberId: lower(b.practitionerMemberId),
        roomId: b.roomId,
        equipmentIds: b.equipmentIds,
      },
      undefined,
    );
    const known = v.data.appointments.find((x) => x.clientId === lower(b.clientId));
    const clientName = known?.clientName ?? 'Клиент';
    const id = ctx.newId('spa-appointment');
    const booking = {
      id: ctx.newId('spa-booking'),
      proto: '',
      orgUnitId: at.room.orgUnitId,
      title: bookingTitle(svc.name, clientName),
      window: {
        startsAt: iso(start),
        endsAt: iso(start + svc.durationMinutes * MINUTE),
        timeZone: b.timeZone,
      },
      resourceIds: at.resourceIds,
      sourceKind: 'appointment' as const,
      relatedObject: { moduleKey: 'spa', entityType: 'appointment', entityId: id },
      prepMinutes: svc.bufferBeforeMinutes,
      cleanupMinutes: svc.bufferAfterMinutes,
      status: 'confirmed' as const,
      revision: 1,
    };
    calendarOf(v.t.org).bookings.push(booking);
    const row: ApptRow = {
      id,
      proto: '',
      orgUnitId: unit.id,
      serviceId: svc.id,
      serviceRevision: svc.revision,
      recipe: svc.recipe.map((l) => ({ ...l })),
      price: svc.price,
      clientId: lower(b.clientId),
      clientName,
      practitionerMemberId: lower(b.practitionerMemberId),
      roomId: at.room.id,
      equipmentIds: at.equipment,
      bookingId: booking.id,
      status: 'confirmed',
      revision: 1,
      performedAt: null,
      finalPrice: null,
      movementIds: [],
    };
    v.data.appointments.push(row);
    return { status: 201, body: appointmentDto(v, row), etag: 1 };
  },

  rescheduleAppointment: (ctx) => {
    const v = viewOf(ctx);
    const a = apptOr404(v, ctx.params.appointmentId);
    if (!v.can(a, SPA_KEYS.create)) fail('forbidden_action');
    ctx.revision(a.revision);
    if (a.status !== 'confirmed') {
      fail('invalid_transition', 'Перенести можно только подтверждённый визит.');
    }
    const booking = bookingOf(v, a);
    const svc = v.data.services.find((s) => s.id === a.serviceId);
    if (!booking || !svc) fail('not_found', NOT_FOUND_APPT);
    const b = ctx.body as S['AppointmentReschedule'];
    // Длительность и буферы — снимок визита (буферы брони), ресурсы — новые или прежние.
    const dur = Date.parse(booking.window.endsAt) - Date.parse(booking.window.startsAt);
    const start = Date.parse(b.startsAt);
    const who = lower(b.practitionerMemberId ?? a.practitionerMemberId);
    if (b.practitionerMemberId) checkWho(v, who, a.orgUnitId);
    const at = place(
      v,
      {
        ...svc,
        bufferBeforeMinutes: booking.prepMinutes,
        bufferAfterMinutes: booking.cleanupMinutes,
      },
      {
        start,
        end: start + dur,
        practitionerMemberId: who,
        roomId: b.roomId ?? a.roomId,
        equipmentIds: b.equipmentIds ?? a.equipmentIds,
      },
      booking.id,
    );
    booking.window = { startsAt: iso(start), endsAt: iso(start + dur), timeZone: b.timeZone };
    booking.resourceIds = at.resourceIds;
    booking.revision++;
    a.practitionerMemberId = who;
    a.roomId = at.room.id;
    a.equipmentIds = at.equipment;
    a.revision++;
    return { body: appointmentDto(v, a), etag: a.revision };
  },

  cancelAppointment: (ctx) => {
    const v = viewOf(ctx);
    const a = apptOr404(v, ctx.params.appointmentId);
    if (!v.can(a, SPA_KEYS.create)) fail('forbidden_action');
    ctx.revision(a.revision);
    if (a.status !== 'confirmed') {
      fail('invalid_transition', 'Отменить можно только подтверждённый визит.');
    }
    const b = ctx.body as S['AppointmentCancel'];
    if (!b.reason.trim()) invalid('reason', 'required', 'Укажите причину.');
    const booking = bookingOf(v, a);
    if (booking) {
      booking.status = 'cancelled';
      booking.revision++;
    }
    a.status = b.noShow ? 'no_show' : 'cancelled';
    a.revision++;
    return { body: appointmentDto(v, a), etag: a.revision };
  },

  recordAppointmentPerformance: (ctx) => {
    const v = viewOf(ctx);
    const a = apptOr404(v, ctx.params.appointmentId);
    if (!v.can(a, SPA_KEYS.perform)) fail('forbidden_action');
    ctx.revision(a.revision);
    if (a.status !== 'confirmed') {
      fail('invalid_transition', 'Выполнение отмечается у подтверждённого визита.');
    }
    const b = ctx.body as S['AppointmentPerformance'];
    const at = Date.parse(b.performedAt);
    if (at > Date.parse(ctx.now()) + SKEW) {
      invalid('performedAt', 'future', 'Время выполнения не может быть в будущем.');
    }
    a.performedAt = iso(at);
    a.status = 'performed_pending_posting';
    a.revision++;
    return { body: appointmentDto(v, a), etag: a.revision };
  },

  completeAppointment: (ctx) => {
    const v = viewOf(ctx);
    const a = apptOr404(v, ctx.params.appointmentId);
    if (!v.can(a, SPA_KEYS.complete)) fail('forbidden_action');
    ctx.revision(a.revision);
    if (a.status === 'completed')
      fail('invalid_transition', 'Визит уже завершён: материалы списаны.');
    if (a.status !== 'performed_pending_posting') {
      fail('invalid_transition', 'Сначала отметьте выполнение процедуры.');
    }
    const b = ctx.body as S['AppointmentComplete'];
    if (lower(b.warehouseId) !== warehouseOf(v.t.org).id) fail('not_found', 'Склад не найден.');
    if (b.overrides.length && !v.can(a, SPA_KEYS.override)) fail('forbidden_action');
    const need = new Map<string, number>(a.recipe.map((l) => [l.itemId, num(l.quantity)]));
    for (const [i, o] of b.overrides.entries()) {
      if (!need.has(lower(o.itemId)))
        invalid(`overrides[${i}].itemId`, 'unknown', 'Позиции нет в техкарте.');
      if (!o.reason.trim()) invalid(`overrides[${i}].reason`, 'required', 'Укажите причину.');
      need.set(lower(o.itemId), num(o.actualQuantity));
    }
    // Нехватка — до любых списаний: частичного списания нет.
    const warehouseId = lower(b.warehouseId);
    for (const [itemId, q] of need) {
      const item = v.data.items.find((x) => x.id === itemId) as ItemRow;
      const have = onHandNumber(ctx, warehouseId, itemId);
      if (have < q) {
        fail('invalid_transition', shortText(item, q, have), { reason: 'insufficient_stock' });
      }
    }
    // Склад один с тегом Inventory (W5.11): списание по FEFO движениями «Расход» с основанием «визит».
    const ids = issueForSource(
      ctx,
      warehouseId,
      [...need].map(([itemId, quantity]) => ({ itemId, quantity })),
      { moduleKey: 'spa', entityType: 'appointment', entityId: a.id },
    );
    a.movementIds = ids;
    a.finalPrice = b.finalPrice ? money(b.finalPrice, 'finalPrice') : a.price;
    a.status = 'completed';
    a.revision++;
    return {
      body: { appointment: appointmentDto(v, a), inventoryMovementIds: ids },
      etag: a.revision,
    };
  },
};
