// Примеры контрактного PR 5 этапа 4 (W4.06, 0.7.0-stage4): календарь ресурсов (W4.40, W4.41), сохранённые виды и
// выгрузка заданием «Данных» (W4.50). Подключается в tools/gen/examples-seed.mjs после примеров W2.57. Сюжеты — снимки
// сценарного сервера MSW (PD-43), их воспроизводят кейсы conformance adapter/test/conformance/cases/calendar.ts и
// cases/data-w406.ts:
// — календарь «Альты» 14.10 (extra-data.js): владелец без «Логистики» видит сотрудников, кабинеты и стол, брони дня —
//   визиты и перерыв; перенос «Классический массаж · Мария К.» на 11:00 — конфликт эталона (moveBooking), на 08:00 —
//   успех; «Перерыв» — запрет переноса; свободные слоты для всех ресурсов — «08:00», «08:15», «08:30» (freeSlots);
// — «Данные»: Марина Котова («Север Логистик», пресет logistics-ready) сохраняет вид «Поездки: «Р-208»» и выгружает
//   «Поездки» заданием (рейс Р-208 · Северный маршрут).
// Время — UTC (сид — Москва, UTC+3), сейчас 2026-10-01 10:30 по Москве.

const MSK = 'Europe/Moscow';
/** «HH:MM» 01.10.2026 по Москве → момент UTC. */
const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 1, h - 3, m)).toISOString().replace('.000Z', 'Z');
};
const win = (from, to) => ({ startsAt: at(from), endsAt: at(to), timeZone: MSK });
const WORKDAY = { start: '08:00', end: '20:00' };
/** Срок подсказки слота и ссылки на файл — 5 минут от «сейчас». */
const IN_5_MIN = '2026-10-01T07:35:00Z';
/** CSV задания «Поездки» по поиску «Р-208» (как exportDataset W2.52: заголовок — подписи, «;», CRLF). */
const CSV = 'Рейс;Водитель;Статус\r\nР-208 · Северный маршрут;Илья Васильев;Запланирован\r\n';
const CSV_BYTES = Buffer.byteLength(`\uFEFF${CSV}`, 'utf8');

/**
 * @param {{ id: (scope: string, protoId: string) => string, problem: Function, page: Function, NOW: string }} deps
 * @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело
 */
export function stage4w406Examples({ id, problem, page, NOW }) {
  const A = (x) => id('t-alta', x);
  const E = (x) => id('t-alta:example', x);

  // ---------------------------------------------------------------------------------------------
  // Календарь
  const MOSCOW = A('r-msk');
  const SEVER = A('f-msk-sever');
  const member = (x) => ({ moduleKey: 'core', entityType: 'member', entityId: A(x) });
  const resource = (proto, kind, name, unit, object) => ({
    id: A(proto),
    kind,
    name,
    orgUnitId: unit,
    ...(object ? { object } : {}),
    timeZone: MSK,
    workday: { ...WORKDAY },
    active: true,
  });
  const res = {
    am: resource('res-am', 'member', 'Анна Морозова · массажист', MOSCOW, member('m-morozova')),
    iv: resource('res-iv', 'member', 'Илья Васильев · водитель', SEVER, member('m-vasiliev')),
    room2: resource('res-room2', 'room', 'Кабинет № 2', MOSCOW),
    room3: resource('res-room3', 'room', 'Кабинет № 3', MOSCOW),
    table: resource('res-table', 'equipment', 'Стол с подогревом', MOSCOW),
  };
  const sel = (r) => ({ kind: r.kind, resourceId: r.id });
  const occupied = (w, prep, clean) => ({
    startsAt: new Date(Date.parse(w.startsAt) - prep * 60_000).toISOString().replace('.000Z', 'Z'),
    endsAt: new Date(Date.parse(w.endsAt) + clean * 60_000).toISOString().replace('.000Z', 'Z'),
    timeZone: MSK,
  });
  const booking = (proto, title, w, rs, source, prep, clean, extra = {}) => ({
    id: A(proto),
    orgUnitId: MOSCOW,
    title,
    window: w,
    resources: rs.map(sel),
    ...(source
      ? { relatedObject: { moduleKey: 'spa', entityType: 'appointment', entityId: A(source) } }
      : {}),
    status: 'confirmed',
    revision: 1,
    prepMinutes: prep,
    cleanupMinutes: clean,
    occupied: occupied(w, prep, clean),
    sourceKind: source ? 'appointment' : 'break',
    ...extra,
  });
  const massage = (w, revision = 1) => ({
    ...booking('b-a1', 'Классический массаж · Мария К.', w, [res.am, res.room2], 'ap-1', 0, 15),
    revision,
  });
  const slot = (from, to) => ({
    window: win(from, to),
    resources: [sel(res.am), sel(res.room2)],
    availabilityToken: Buffer.from(`a.${A('b-a1')}.${at(from)}`)
      .toString('base64')
      .replace(/=+$/, ''),
    tokenExpiresAt: IN_5_MIN,
  });
  const violation = (field, code, message) => ({ field, code, message });

  const calendar = {
    listCalendarResources: {
      ok: page([res.am, res.iv, res.room2, res.room3, res.table]),
      forbidden_action: problem('forbidden_action', 'Ни одна роль не разрешает видеть календарь.'),
    },
    listCalendarBookings: {
      day: page([
        massage(win('10:00', '11:00')),
        booking(
          'b-a2',
          'SPA-ритуал · Ольга Р.',
          win('11:30', '13:00'),
          [res.am, res.room2, res.table],
          'ap-2',
          15,
          15,
        ),
        booking('b-br', 'Перерыв', win('13:15', '14:00'), [res.am], null, 0, 0, {
          rescheduleLock: 'specialist_schedule',
        }),
        booking(
          'b-a3',
          'Массаж спины · Екатерина Л.',
          win('14:00', '14:45'),
          [res.am, res.room2],
          'ap-3',
          0,
          15,
        ),
      ]),
      validation_failed: problem('validation_failed', 'Период не длиннее 7 дней.', {
        violations: [violation('to', 'range', 'Период не длиннее 7 дней.')],
      }),
    },
    updateCalendarBooking: {
      ok: massage(win('08:00', '09:00'), 2),
      resources_unavailable: problem(
        'resources_unavailable',
        'Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); Кабинет № 2 занят («SPA-ритуал · Ольга Р.»)',
        {
          violations: [
            violation(
              'resources[0]',
              'busy',
              'Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»)',
            ),
            violation('resources[1]', 'busy', 'Кабинет № 2 занят («SPA-ритуал · Ольга Р.»)'),
          ],
        },
      ),
      invalid_transition: problem('invalid_transition', 'Перерыв меняется в графике специалиста.'),
    },
    findCalendarAvailability: {
      reschedule: {
        slots: [slot('08:00', '09:00'), slot('08:15', '09:15'), slot('08:30', '09:30')],
        calculatedAt: NOW,
      },
      not_found: problem('not_found', 'Бронь не найдена.'),
    },
  };

  // ---------------------------------------------------------------------------------------------
  // «Данные»: виды и задания выгрузки
  const KOTOVA = A('m-kotova');
  const view = (name, revision = 1) => ({
    id: E('view-trips-r208'),
    datasetId: 'fleet.trips',
    name,
    visibility: 'personal',
    ownerMemberId: KOTOVA,
    ownerDisplayName: 'Марина Котова',
    query: { filters: [], search: 'Р-208', sort: [] },
    revision,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const SPEC = { select: ['trip', 'driverName', 'state'], filters: [], search: 'Р-208', sort: [] };
  const job = (state, revision, extra = {}) => ({
    id: E('job-trips-r208'),
    datasetId: 'fleet.trips',
    datasetName: 'Поездки',
    state,
    spec: structuredClone(SPEC),
    columnLabels: ['Рейс', 'Водитель', 'Статус'],
    timeZone: MSK,
    rowLimit: 100000,
    requestedByMemberId: KOTOVA,
    requestedByDisplayName: 'Марина Котова',
    createdAt: NOW,
    revision,
    ...extra,
  });
  const done = {
    snapshotAt: NOW,
    rowCount: 1,
    truncated: false,
    fileName: 'Поездки-2026-10-01.csv',
    sizeBytes: CSV_BYTES,
    startedAt: NOW,
    finishedAt: NOW,
    expiresAt: '2026-10-02T07:30:00Z',
  };
  const ready = job('ready', 2, done);

  const data = {
    listDatasetViews: {
      ok: { items: [view('Поездки: «Р-208»')] },
      forbidden_action: problem('forbidden_action', 'Ни одна роль не разрешает строить выборки.'),
    },
    createDatasetView: {
      created: view('Поездки: «Р-208»'),
      validation_failed: problem('validation_failed', 'Вид с таким именем уже есть.', {
        violations: [violation('name', 'taken', 'Вид с таким именем уже есть.')],
      }),
    },
    updateDatasetView: {
      ok: view('Рейс Р-208', 2),
      revision_mismatch: problem('revision_mismatch', 'Вид уже изменили. Обновите и повторите.'),
    },
    deleteDatasetView: {
      not_found: problem('not_found', 'Вид не найден.'),
    },
    createDatasetExportJob: {
      queued: job('queued', 1),
      rate_limited: problem('rate_limited', 'Дождитесь завершения начатых выгрузок.'),
    },
    listDatasetExportJobs: {
      ok: page([ready]),
      forbidden_action: problem('forbidden_action', 'Ни одна роль не разрешает выгрузку.'),
    },
    getDatasetExportJob: {
      ready,
      not_found: problem('not_found', 'Выгрузка не найдена.'),
    },
    getDatasetExportDownload: {
      ok: {
        exportJobId: E('job-trips-r208'),
        downloadUrl: `https://storage.example.invalid/exports/${E('job-trips-r208')}?expires=300&signature=${E('link-trips-r208')}`,
        expiresAt: IN_5_MIN,
        fileName: 'Поездки-2026-10-01.csv',
        contentType: 'text/csv; charset=utf-8',
        sizeBytes: CSV_BYTES,
      },
      invalid_transition: problem(
        'invalid_transition',
        'Права изменились — выгрузка отозвана. Запустите её снова.',
      ),
    },
    revokeDatasetExportJob: {
      ok: job('revoked', 3, { ...done, revokeReason: 'author', revokedAt: NOW }),
      invalid_transition: problem('invalid_transition', 'Выгрузка уже завершена.'),
    },
  };
  return { ...calendar, ...data };
}
