// Тег Calendar сценарного сервера (W4.06, контракт 0.7.0-stage4; W4.40, W4.41): ресурсы календаря, брони за день
// или неделю, бронь, перенос с атомарной проверкой всех ресурсов с буферами (moveBooking эталона — текст конфликта
// «Конфликт ресурсов: …») и свободные слоты для всех ресурсов (freeSlots эталона: шаг 15 минут, рабочий день).
import type { components } from '@ortus/api-client';

import { page, uuidParam } from '../core/page.ts';
import { fail, type Violation } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { DAY, MINUTE } from '../core/time.ts';
import {
  bookingDto,
  type BookingRow,
  type CalendarView,
  iso,
  KIND_ORDER,
  LOCK_TEXT,
  mskDayStart,
  occupiedOf,
  type ResourceKind,
  resourceDto,
  type ResourceRow,
  subtree,
  viewOf,
  workdayOf,
} from './state.ts';

type S = components['schemas'];

/** Предел окна списка броней — неделя календаря. */
const WEEK = 7 * DAY;
/** Срок подсказки свободного слота (AvailabilitySlot.tokenExpiresAt). */
const TOKEN_TTL = 5 * MINUTE;

const KINDS = new Set<string>(KIND_ORDER);

function kindParam(ctx: HandlerContext): ResourceKind | undefined {
  const k = ctx.query.get('kind');
  if (k === null) return undefined;
  if (!KINDS.has(k)) fail('malformed_request', 'Неизвестный вид ресурса.');
  return k as ResourceKind;
}

function instantParam(ctx: HandlerContext, name: string): number | undefined {
  const v = ctx.query.get(name);
  if (v === null) return undefined;
  const ms = Date.parse(v);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(ms)) {
    fail('malformed_request', `Параметр ${name} — не момент времени.`);
  }
  return ms;
}

function invalid(field: string, code: string, message: string): never {
  return fail('validation_failed', message, { violations: [{ field, code, message }] });
}

const bookingOr404 = (v: CalendarView, id: string | undefined): BookingRow => {
  const b = v.cal.bookings.find((x) => x.id === (id ?? '').toLowerCase());
  if (!b || b.status !== 'confirmed' || !v.canRead(b))
    return fail('not_found', 'Бронь не найдена.');
  return b;
};

const overlaps = (a: [number, number], b: [number, number]): boolean => a[0] < b[1] && b[0] < a[1];

/** Другие подтверждённые брони, чья занятость пересекает `occ` (кроме брони `except`), — в порядке создания. */
const clashing = (
  v: CalendarView,
  occ: [number, number],
  except: string | undefined,
): BookingRow[] =>
  v.cal.bookings.filter(
    (b) => b.status === 'confirmed' && b.id !== except && overlaps(occupiedOf(b), occ),
  );

/** Ресурс занят другой подтверждённой бронью на занятость `occ`. */
const busy = (
  v: CalendarView,
  resourceId: string,
  occ: [number, number],
  except: string | undefined,
): boolean => clashing(v, occ, except).some((b) => b.resourceIds.includes(resourceId));

/** Занятость `occ` в рабочем дне каждого ресурса (сутки начала окна). */
function inWorkday(rs: readonly ResourceRow[], occ: [number, number], dayStart: number): boolean {
  return rs.every((r) => {
    const [a, z] = workdayOf(r, dayStart);
    return occ[0] >= a && occ[1] <= z;
  });
}

export const calendarHandlers: Registry = {
  listCalendarResources: (ctx) => {
    const v = viewOf(ctx);
    const kind = kindParam(ctx);
    const unit = uuidParam(ctx.query, 'orgUnitId', false);
    const units = unit ? subtree(v.t.org, unit) : undefined;
    const items = v.cal.resources
      .filter((r) => v.resources.has(r.id))
      .filter((r) => !kind || r.kind === kind)
      .filter((r) => !units || units.has(r.orgUnitId))
      .sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
          a.name.localeCompare(b.name, 'ru'),
      )
      .map(resourceDto);
    return { body: page(items, ctx.query) };
  },

  listCalendarBookings: (ctx) => {
    const v = viewOf(ctx);
    let from = instantParam(ctx, 'from');
    let to = instantParam(ctx, 'to');
    if ((from === undefined) !== (to === undefined)) {
      invalid(from === undefined ? 'from' : 'to', 'required', 'Укажите начало и конец периода.');
    }
    if (from === undefined || to === undefined) {
      from = mskDayStart(Date.parse(ctx.now()));
      to = from + DAY;
    }
    if (to <= from) invalid('to', 'range', 'Конец периода раньше начала.');
    if (to - from > WEEK) invalid('to', 'range', 'Период не длиннее 7 дней.');
    const kind = kindParam(ctx);
    const unit = uuidParam(ctx.query, 'orgUnitId', false);
    const units = unit ? subtree(v.t.org, unit) : undefined;
    const resourceId = uuidParam(ctx.query, 'resourceId', false);
    const res = (id: string) => v.cal.resources.find((r) => r.id === id);
    const win: [number, number] = [from, to];
    const items = v.cal.bookings
      .filter((b) => b.status === 'confirmed' && v.canRead(b))
      .filter((b) => overlaps(occupiedOf(b), win))
      .filter((b) => !kind || b.resourceIds.some((id) => res(id)?.kind === kind))
      .filter((b) => !units || b.resourceIds.some((id) => units.has(res(id)?.orgUnitId ?? '')))
      .filter((b) => !resourceId || b.resourceIds.includes(resourceId))
      .sort(
        (a, b) =>
          Date.parse(a.window.startsAt) - Date.parse(b.window.startsAt) || a.id.localeCompare(b.id),
      )
      .map((b) => bookingDto(v, b));
    return { body: page(items, ctx.query) };
  },

  getCalendarBooking: (ctx) => {
    const v = viewOf(ctx);
    return { body: bookingDto(v, bookingOr404(v, ctx.params.bookingId)) };
  },

  updateCalendarBooking: (ctx) => {
    const v = viewOf(ctx);
    const b = bookingOr404(v, ctx.params.bookingId);
    const lock = v.lockOf(b);
    if (lock === 'permission') fail('forbidden_action');
    if (lock) fail('invalid_transition', LOCK_TEXT[lock]);
    ctx.revision(b.revision);
    const patch = ctx.body as S['BookingPatch'];
    if (patch.action === 'cancel') {
      b.status = 'cancelled';
      b.revision++;
      return { body: bookingDto(v, b) };
    }
    if (!patch.window) invalid('window', 'required', 'Укажите новое время и ресурсы.');
    if (!patch.resources) invalid('resources', 'required', 'Укажите новое время и ресурсы.');
    const start = Date.parse(patch.window.startsAt);
    const end = Date.parse(patch.window.endsAt);
    if (!(start < end)) invalid('window', 'range', 'Конец брони раньше начала.');
    const rs = patch.resources.map((sel, i) => {
      const r = v.cal.resources.find((x) => x.id === sel.resourceId.toLowerCase());
      if (!r || !v.resources.has(r.id) || r.kind !== sel.kind) {
        invalid(`resources[${i}]`, 'unknown', 'Ресурс не найден.');
      }
      return r;
    });
    const occ: [number, number] = [start - b.prepMinutes * MINUTE, end + b.cleanupMinutes * MINUTE];
    if (!inWorkday(rs, occ, mskDayStart(start))) {
      invalid('window', 'workday', 'Время вне рабочего дня ресурса.');
    }
    // bookingConflicts эталона (models.js:395): пункт на пару «другая бронь × общий ресурс» — брони в порядке
    // создания, ресурсы в порядке другой брони; ресурс, занятый двумя бронями, назван дважды.
    const index = new Map(rs.map((r, i) => [r.id, i]));
    const violations: Violation[] = [];
    for (const other of clashing(v, occ, b.id)) {
      for (const id of other.resourceIds) {
        const i = index.get(id);
        const r = i === undefined ? undefined : rs[i];
        if (!r) continue;
        const message = v.canRead(other) ? `${r.name} занят («${other.title}»)` : `${r.name} занят`;
        violations.push({ field: `resources[${i}]`, code: 'busy', message });
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
    b.window = { ...b.window, startsAt: iso(start), endsAt: iso(end) };
    b.resourceIds = rs.map((r) => r.id);
    b.revision++;
    return { body: bookingDto(v, b) };
  },

  findCalendarAvailability: (ctx) => {
    const v = viewOf(ctx);
    const q = ctx.body as S['AvailabilityQuery'];
    if (!v.t.org.units.some((u) => u.id === q.orgUnitId.toLowerCase())) {
      fail('not_found', 'Подразделение не найдено.');
    }
    const except = q.excludeBookingId ? bookingOr404(v, q.excludeBookingId) : undefined;
    const groups = q.requirements.map((g, gi) => ({
      kind: g.kind,
      count: g.requiredCount,
      resources: g.resourceIds.map((id, i) => {
        const r = v.cal.resources.find((x) => x.id === id.toLowerCase());
        if (!r || !v.resources.has(r.id) || r.kind !== g.kind) {
          invalid(`requirements[${gi}].resourceIds[${i}]`, 'unknown', 'Ресурс не найден.');
        }
        return r;
      }),
    }));
    const dur = q.durationMinutes * MINUTE;
    const step = q.stepMinutes * MINUTE;
    const prep = (q.prepMinutes ?? 0) * MINUTE;
    const clean = (q.cleanupMinutes ?? 0) * MINUTE;
    const max = q.maxSlots ?? 20;
    const winFrom = Date.parse(q.window.startsAt);
    const winTo = Date.parse(q.window.endsAt);
    const current = except ? Date.parse(except.window.startsAt) : undefined;
    const all = groups.flatMap((g) => g.resources);
    const slots: S['AvailabilitySlot'][] = [];
    const now = Date.parse(ctx.now());
    for (
      let day = mskDayStart(winFrom);
      day < winTo && day < winFrom + WEEK && slots.length < max;
      day += DAY
    ) {
      const [dayFrom, dayTo] = all.reduce<[number, number]>(
        ([a, z], r) => {
          const [ra, rz] = workdayOf(r, day);
          return [Math.max(a, ra), Math.min(z, rz)];
        },
        [day, day + DAY],
      );
      for (let t = dayFrom + prep; t + dur + clean <= dayTo && slots.length < max; t += step) {
        if (t < winFrom || t + dur > winTo || t === current) continue;
        const occ: [number, number] = [t - prep, t + dur + clean];
        const picked: S['ResourceSelection'][] = [];
        const ok = groups.every((g) => {
          const free = g.resources.filter((r) => !busy(v, r.id, occ, except?.id));
          if (free.length < g.count) return false;
          picked.push(...free.slice(0, g.count).map((r) => ({ kind: r.kind, resourceId: r.id })));
          return true;
        });
        if (!ok) continue;
        slots.push({
          window: { startsAt: iso(t), endsAt: iso(t + dur), timeZone: q.window.timeZone },
          resources: picked,
          availabilityToken: btoa(`a.${except?.id ?? '-'}.${iso(t)}`).replace(/=+$/, ''),
          tokenExpiresAt: iso(now + TOKEN_TTL),
        });
      }
    }
    return { body: { slots, calculatedAt: ctx.now() } };
  },
};
