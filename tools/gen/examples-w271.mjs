// Примеры контрактной дельты W2.71 (0.6.3-stage2): S2-20 «Машина для временного водителя» — решение владельца 19.10
// по Q-W2.32-1 (D-35 комплекта; design/docs/29-temporary-driver-vehicle.md, макеты 1a–1g). Подключается в
// tools/gen/examples-seed.mjs после примеров W2.57. Сюжет на сиде логистики 14.10, его воспроизводят кейсы conformance
// adapter/test/conformance/cases/vehicle-offer.ts (PD-43):
// — Котова («Север Логистик») публикует Илью Васильева в пул с обычной машиной Mercedes Sprinter (v6);
// — владелец запрашивает его на рейс «Юг Транс» Р-212 14:00–18:00: «Ставим нашу машину» Isuzu Elf (v5) + «Можно взять
//   свою обычную» (host_or_home); броней до одобрения нет;
// — Котова одобряет с машиной: назначение и две брони до 13:30 (срок выбора — начало окна минус 30 минут, TD-02);
// — Васильев берёт Sprinter: бронь Isuzu снимается (chosen); повтор — 409 offer_closed; не предложенная — 404;
// — «Отклонить» без причины — 422; машина без охлаждения на Р-211 (+2…+6 °C) — 409 vehicle_incompatible.
// Время — UTC (сид — Москва, UTC+3), сейчас 2026-10-01 10:30 по Москве.

const MSK = 'Europe/Moscow';
/** Окно рейса «Юг Транс» — 14:00–18:00 по Москве. */
const WINDOW = { startsAt: '2026-10-01T11:00:00Z', endsAt: '2026-10-01T15:00:00Z', timeZone: MSK };
/** Срок выбора — 13:30 по Москве. */
export const CHOOSE_UNTIL = '2026-10-01T10:30:00Z';
const TERMS = 'По соглашению фирм группы';
/** Номер рейса, который сервер сценариев даёт новому рейсу после Р-208 и Р-211. */
const TRIP_NUMBER = 'Р-212';
/** Причина «нет охлаждения» — проверка «Температура» домена (models.js compat) для ГАЗель Next на Р-211. */
const NO_COOLING = 'Температура: без охлаждения, нужно +2…+6 °C';

/** @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело */
export function stage2w271Examples({ id, problem, NOW }) {
  const ex = {};
  const add = (op, name, body) => ((ex[op] ??= {})[name] = body);
  const A = (x) => id('t-alta', x);
  const E = (x) => id('t-alta:example', x);

  // Публикация с обычной машиной (правило 1, TD-01).
  add('publishDriverToPool', 'usual_vehicle', {
    id: E('pool-vasiliev'),
    driverMemberId: A('m-vasiliev'),
    driverDisplayName: 'Илья Васильев',
    displayName: 'Водитель #118',
    homeOrgUnitId: A('f-msk-sever'),
    homeOrgUnitName: 'Север Логистик',
    qualifications: ['Кат. B'],
    freeWindow: { ...WINDOW },
    terms: TERMS,
    state: 'active',
    publishedByMemberId: A('m-kotova'),
    publishedAt: NOW,
    usualVehicleId: A('v6'),
    revision: 1,
  });

  // Машины запроса (TransferVehicle): Isuzu Elf «Юг Транс» и обычная Mercedes Sprinter «Север Логистик».
  const host = {
    vehicleId: A('v5'),
    displayName: 'Isuzu Elf',
    registrationNumber: 'К 120 РУ 77',
    orgUnitId: A('f-msk-yug'),
    orgUnitName: 'Юг Транс',
  };
  const home = {
    vehicleId: A('v6'),
    displayName: 'Mercedes Sprinter',
    registrationNumber: 'Т 771 ЕХ 77',
    orgUnitId: A('f-msk-sever'),
    orgUnitName: 'Север Логистик',
  };
  const trip = E('trip-yug-s220');
  const transfer = (patch = {}) => ({
    id: E('transfer-s220'),
    driverMemberId: A('m-vasiliev'),
    sourceOrgUnitId: A('f-msk-sever'),
    targetOrgUnitId: A('f-msk-yug'),
    window: { ...WINDOW },
    status: 'requested',
    revision: 1,
    tripId: trip,
    publicationId: E('pool-vasiliev'),
    driverDisplayName: 'Водитель #118',
    sourceOrgUnitName: 'Север Логистик',
    targetOrgUnitName: 'Юг Транс',
    tripNumber: TRIP_NUMBER,
    reason: `Запрос на рейс ${TRIP_NUMBER}`,
    requestedByMemberId: A('m-owner'),
    requestedAt: NOW,
    ...patch,
  });
  add(
    'requestDriverTransfer',
    'vehicle',
    transfer({ vehicle: { mode: 'host_or_home', hostVehicle: host, homeVehicle: home } }),
  );
  add(
    'requestDriverTransfer',
    'vehicle_incompatible',
    problem('vehicle_incompatible', `Машина не подходит рейсу: ${NO_COOLING}`, {
      violations: [{ field: 'vehicle.hostVehicleId', code: 'temp', message: NO_COOLING }],
    }),
  );

  // «Одобрить с машиной» (1b): назначение и брони предложения одной транзакцией.
  const hostRes = E('reservation-s220-host');
  const usualRes = E('reservation-s220-usual');
  const group = E('offer-s220');
  add(
    'decideDriverTransfer',
    'approved_with_vehicle',
    transfer({
      status: 'approved',
      revision: 2,
      decidedByMemberId: A('m-kotova'),
      decidedAt: NOW,
      grant: {
        assignmentId: E('grant-s220'),
        orgUnitId: A('f-msk-yug'),
        tripId: trip,
        validFrom: WINDOW.startsAt,
        validUntil: WINDOW.endsAt,
        state: 'scheduled',
      },
      vehicle: {
        mode: 'host_or_home',
        hostVehicle: { ...host, reservationId: hostRes, reservationState: 'held' },
        homeVehicle: { ...home, reservationId: usualRes, reservationState: 'held' },
        homeDecision: 'approved',
        offerGroupId: group,
        chooseUntil: CHOOSE_UNTIL,
      },
    }),
  );
  add(
    'decideDriverTransfer',
    'validation_failed',
    problem('validation_failed', 'Укажите причину отказа.', {
      violations: [{ field: 'comment', code: 'required', message: 'Укажите причину отказа' }],
    }),
  );

  // Выбор водителем (1c, 1d): Sprinter — confirmed, Isuzu — released (chosen).
  const reservation = (rid, vehicleId, kind, patch) => ({
    id: rid,
    vehicleId,
    driverMemberId: A('m-vasiliev'),
    window: { ...WINDOW },
    state: 'held',
    holdExpiresAt: CHOOSE_UNTIL,
    revision: 2,
    tripId: trip,
    offerGroupId: group,
    offeredToMemberId: A('m-vasiliev'),
    offerKind: kind,
    chooseUntil: CHOOSE_UNTIL,
    ...patch,
  });
  add('chooseReservation', 'ok', {
    chosen: reservation(usualRes, A('v6'), 'usual', {
      state: 'confirmed',
      holdExpiresAt: WINDOW.endsAt,
      chosenAt: NOW,
    }),
    released: [
      reservation(hostRes, A('v5'), 'host', {
        state: 'released',
        releasedAt: NOW,
        releaseReason: 'chosen',
      }),
    ],
  });
  add('chooseReservation', 'offer_closed', problem('offer_closed', 'Выбор машины уже закрыт.'));
  add('chooseReservation', 'not_found', problem('not_found', 'Бронь не найдена.'));
  return ex;
}
