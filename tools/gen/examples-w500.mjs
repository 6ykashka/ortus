// Примеры контрактного PR этапа 5 (W5.00, 0.12.0-stage5): касса (22 операции + 4 расширенные), склад и SPA.
// Подключается в tools/gen/examples-seed.mjs после примеров W4.05.
// Касса — снимки сценарного сервера MSW (PD-43, frontend/packages/adapter/src/msw/cash/) на сиде «Альты» из эталона 19.10
// (design/ortus/cash.js seedAlta: кассы ca-spa, ca-term, ca-sever, подотчёты ca-adv-*, сейф, счёт; смены 117 и 118;
// перемещения tr-*; чеки rc-*; заявка rq-1; предложения pr-1…pr-4): их воспроизводят кейсы conformance
// adapter/test/conformance/cases/cash.ts. Тела лежат в tools/gen/fixtures/examples-w500.json, UUID — метки
// «@@область|id прототипа@@» → id(область, id): сид кассы — область t-alta, новые объекты сервера — t-alta:new, номер
// по порядку выдачи. Пересъёмка — `examples -- --write`, затем fixtures/examples-w500.json пересобирается из файлов.
// Склад и SPA — без макета (B-6) и без сервера до W5.10, W5.20: примеры по контракту и сиду салона.
// Время — UTC (сид — Москва, UTC+3), сейчас 2026-10-01 10:30 МСК.
import { readFileSync } from 'node:fs';

import { abs } from './lib/paths.mjs';

const RUB = 'RUB';
const money = (rub) => ({ amountMinor: Math.round(rub * 100), currency: RUB });

/** Тела операций кассы из снимков; метки UUID разворачиваются в id сида. */
function cashFixture(id) {
  const raw = JSON.parse(readFileSync(abs('tools/gen/fixtures/examples-w500.json'), 'utf8'));
  const resolve = (node) => {
    if (typeof node === 'string') {
      return node.replace(/@@([^|@]+)\|([^@]+)@@/g, (_, scope, proto) => id(scope, proto));
    }
    if (Array.isArray(node)) return node.map(resolve);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolve(v)]));
    }
    return node;
  };
  return resolve(raw);
}

export function stage5w500Examples({ id, problem, page, NOW }) {
  const A = (x) => id('t-alta', x);
  const M = (x) => A(x);
  const cash = cashFixture(id);
  // ------------------------------------------------------------------ склад (без макета, B-6)
  const wh = {
    id: A('wh-spa'),
    orgUnitId: A('spa'),
    name: 'Склад салона',
    code: 'SPA-1',
    archived: false,
    revision: 1,
  };
  const oil = A('item-oil');
  const lot = (n, exp, qty) => ({ lotId: A(n), expiresOn: exp, onHand: qty });
  const balance = {
    warehouseId: wh.id,
    itemId: oil,
    onHand: '1200',
    reserved: '50',
    available: '1150',
    minLevel: '500',
    belowMinimum: false,
    lots: [lot('lot-oil-1', '2026-12-31', '400'), lot('lot-oil-2', '2027-06-30', '800')],
  };
  const reservation = {
    id: A('rsv-1'),
    warehouseId: wh.id,
    source: { moduleKey: 'spa', entityType: 'appointment', entityId: A('ap-pr1') },
    lines: [{ itemId: oil, quantity: '50' }],
    status: 'active',
    expiresAt: null,
    createdAt: NOW,
    revision: 1,
  };
  const inventory = {
    listWarehouses: {
      ok: page([wh]),
      forbidden_action: problem('forbidden_action', 'Ни одна роль не разрешает смотреть склады.'),
    },
    createWarehouse: {
      created: wh,
      validation_failed: problem('validation_failed', 'Склад с таким названием уже есть.', {
        violations: [
          { field: 'name', code: 'taken', message: 'Склад с таким названием уже есть.' },
        ],
      }),
    },
    updateInventoryItem: {
      ok: {
        id: oil,
        orgUnitId: A('spa'),
        name: 'Масло массажное',
        sku: 'OIL-1',
        baseUnit: 'ml',
        trackLots: true,
        minLevel: '500',
        revision: 2,
      },
      revision_mismatch: problem(
        'revision_mismatch',
        'Номенклатуру уже изменили. Обновите и повторите.',
      ),
    },
    listInventoryBalances: {
      ok: page([balance]),
      forbidden_action: problem('forbidden_action', 'Ни одна роль не разрешает смотреть остатки.'),
    },
    listInventoryReservations: {
      ok: page([reservation]),
      forbidden_action: problem('forbidden_action', 'Ни одна роль не разрешает смотреть резервы.'),
    },
    createInventoryReservation: {
      created: reservation,
      invalid_transition: problem('invalid_transition', 'На складе недостаточно материала.', {
        reason: 'insufficient_stock',
      }),
    },
    releaseInventoryReservation: {
      ok: { ...reservation, status: 'released', revision: 2 },
      invalid_transition: problem('invalid_transition', 'Резерв уже снят.', {
        reason: 'reservation_not_active',
      }),
    },
  };

  // ------------------------------------------------------------------ SPA (без макета, B-6)
  const svc = {
    id: A('svc-massage'),
    orgUnitId: A('spa'),
    name: 'Классический массаж',
    durationMinutes: 60,
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 10,
    price: money(3200),
    requiredEquipmentIds: [A('eq-table')],
    recipe: [{ itemId: oil, quantity: '25', unit: 'ml' }],
    revision: 3,
  };
  const appt = (status, x = {}) => ({
    id: A('ap-pr1'),
    orgUnitId: A('spa'),
    serviceId: svc.id,
    serviceRevision: 3,
    clientId: A('cl-natalia'),
    practitionerMemberId: M('m-morozova'),
    roomId: A('room-1'),
    equipmentIds: [A('eq-table')],
    window: {
      startsAt: '2026-10-02T09:00:00Z',
      endsAt: '2026-10-02T10:00:00Z',
      timeZone: 'Europe/Moscow',
    },
    bookingId: A('bk-ap-pr1'),
    status,
    revision: 2,
    ...x,
  });
  const spaOps = {
    getSpaService: { ok: svc, not_found: problem('not_found', 'Услуга не найдена.') },
    updateSpaService: {
      ok: { ...svc, recipe: [{ itemId: oil, quantity: '30', unit: 'ml' }], revision: 4 },
      revision_mismatch: problem('revision_mismatch', 'Услугу уже изменили. Обновите и повторите.'),
    },
    cancelAppointment: {
      ok: appt('cancelled', { revision: 3 }),
      invalid_transition: problem(
        'invalid_transition',
        'Отменить можно только подтверждённую запись.',
      ),
    },
    rescheduleAppointment: {
      ok: appt('confirmed', {
        window: {
          startsAt: '2026-10-02T11:00:00Z',
          endsAt: '2026-10-02T12:00:00Z',
          timeZone: 'Europe/Moscow',
        },
        revision: 3,
      }),
      resources_unavailable: problem('resources_unavailable', 'Время или ресурс уже заняты.'),
    },
  };
  return { ...cash, ...inventory, ...spaOps };
}
