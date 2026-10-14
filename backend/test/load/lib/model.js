// Чистая модель нагрузочного профиля (W0.16). Без импорта k6/*: модуль грузят и k6, и Node (тесты).
// Источники: backend/test/load/profile.json, docs/plan/v2/load-profile.md,
// design/docs/v0.1/ortus-openapi-v0.1.yaml (операции, заголовки, схемы тел).

export const STAGE_NAMES = ['smoke', 'pilot', 'stress'];

const TIME_ZONE = 'Europe/Moscow';
const CURRENCY = 'RUB';
const UPLOAD_PURPOSES = ['inspection', 'expense_receipt'];
const EXPENSE_KINDS = ['fuel', 'wash', 'parking', 'toll', 'other']; // D-12
const SHA256_RE = /^[a-f0-9]{64}$/;
const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'];

const op = (method, path, kind, idempotent = false, ifMatch = false) => ({
  method,
  path,
  kind,
  idempotent,
  ifMatch,
});
const T = '/api/v1/tenants/{tenantId}';

/**
 * Операции OpenAPI 0.1, которые трогает нагрузка. kind — класс порога:
 * read (GET и queryDataset — POST только для чтения) или write.
 * idempotent — обязателен Idempotency-Key; ifMatch — обязателен If-Match (сильный ETag).
 */
export const OPS = {
  getMyContext: op('GET', '/api/v1/me/context', 'read'),
  listVehicles: op('GET', `${T}/fleet/vehicles`, 'read'),
  listReservations: op('GET', `${T}/fleet/reservations`, 'read'),
  reserveVehicle: op('POST', `${T}/fleet/reservations`, 'write', true),
  getInspectionChecklist: op('GET', `${T}/fleet/inspection-checklist`, 'read'),
  initiateUpload: op('POST', `${T}/files/uploads`, 'write', true),
  completeUpload: op('POST', `${T}/files/uploads/{uploadId}/complete`, 'write', true),
  submitInspection: op('POST', `${T}/fleet/inspections`, 'write', true),
  listInspections: op('GET', `${T}/fleet/inspections`, 'read'),
  startTrip: op('POST', `${T}/fleet/trips`, 'write', true),
  listTrips: op('GET', `${T}/fleet/trips`, 'read'),
  getTrip: op('GET', `${T}/fleet/trips/{tripId}`, 'read'),
  returnTrip: op('PATCH', `${T}/fleet/trips/{tripId}`, 'write', true, true),
  reviewTrip: op('POST', `${T}/fleet/trips/{tripId}/review`, 'write', true, true),
  listTripExpenses: op('GET', `${T}/fleet/trips/{tripId}/expenses`, 'read'),
  createTripExpense: op('POST', `${T}/fleet/trips/{tripId}/expenses`, 'write', true),
  getTripExpense: op('GET', `${T}/fleet/trips/{tripId}/expenses/{expenseId}`, 'read'),
  reviewTripExpense: op(
    'POST',
    `${T}/fleet/trips/{tripId}/expenses/{expenseId}/review`,
    'write',
    true,
    true,
  ),
  listDatasets: op('GET', `${T}/datasets`, 'read'),
  queryDataset: op('POST', `${T}/datasets/{datasetId}/query`, 'read'),
};

// ---------------------------------------------------------------- профиль

function stageOf(profile, stageName) {
  const stage = STAGE_NAMES.includes(stageName) ? profile.stages?.[stageName] : undefined;
  if (!stage) {
    throw new Error(`неизвестная стадия «${stageName}»; допустимы: ${STAGE_NAMES.join(', ')}`);
  }
  return stage;
}

/** Значения параметров профиля с переопределениями стадии: { vehicles: 100, … }. */
export function paramValues(profile, stageName) {
  const stage = stageOf(profile, stageName);
  const values = {};
  for (const [key, param] of Object.entries(profile.params)) values[key] = param.value;
  return { ...values, ...(stage.overrides ?? {}) };
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/** Состав смены водителя: число запросов по операциям и по видам. */
export function requestsPerShift(profile, stageName) {
  const v = paramValues(profile, stageName);
  const photos = photosPerShift(v);
  const byOp = {
    getMyContext: 1,
    listReservations: 1,
    listVehicles: 1,
    reserveVehicle: 1,
    getInspectionChecklist: 2,
    initiateUpload: photos,
    completeUpload: photos,
    submitInspection: 2,
    startTrip: 1,
    getTrip: v.tripPollsPerShift + 1,
    createTripExpense: v.expensesPerShift,
    returnTrip: 1,
  };
  return { ...countKinds(byOp), byOp, auth: 1, transfer: photos };
}

/** Итерация менеджера: четыре списка; при приёмке — рейс, его расходы и решения. */
export function requestsPerManagerIteration(profile, stageName, { review }) {
  const v = paramValues(profile, stageName);
  const byOp = { listTrips: 1, listVehicles: 1, listReservations: 1, listInspections: 1 };
  if (review) {
    Object.assign(byOp, {
      getTrip: 2,
      listTripExpenses: 1,
      getTripExpense: v.expensesPerShift,
      reviewTripExpense: v.expensesPerShift,
      reviewTrip: 1,
    });
  }
  return { ...countKinds(byOp), byOp };
}

function countKinds(byOp) {
  let read = 0;
  let write = 0;
  for (const [name, n] of Object.entries(byOp)) {
    if (OPS[name].kind === 'read') read += n;
    else write += n;
  }
  return { read, write };
}

function photosPerShift(v) {
  return v.departurePhotos + v.returnPhotos + v.expensesPerShift * v.receiptsPerExpense;
}

/** Производные величины профиля (таблица «Производные» в load-profile.md). */
export function deriveRates(profile, stageName) {
  const stage = stageOf(profile, stageName);
  const v = paramValues(profile, stageName);
  const shiftsPeakDay = v.vehicles * v.peakDayUtilization;
  const shiftsPerMinutePeak =
    ((shiftsPeakDay * v.departureWindowShare) / v.departureWindowMinutes) * stage.scale;
  const photos = photosPerShift(v);
  const shift = requestsPerShift(profile, stageName);
  const mgr = requestsPerManagerIteration(profile, stageName, { review: false });
  const managerVus = (v.managers + v.owners) * stage.scale;
  const historyTrips = v.vehicles * v.shiftsPerVehiclePerMonth * v.historyMonths;
  return {
    shiftsPeakDay,
    shiftsPerMinutePeak,
    photosPerShift: photos,
    photoGBPerMonth: round3(
      (v.vehicles * v.shiftsPerVehiclePerMonth * photos * v.photoSizeBytes) / 1e9,
    ),
    concurrentUsersPeak: Math.ceil(shiftsPerMinutePeak * v.driverSessionMinutes) + managerVus,
    managerVus,
    driverApiRps: (shiftsPerMinutePeak * (shift.read + shift.write)) / 60,
    managerApiRps:
      v.managerThinkSeconds > 0 ? (managerVus * (mgr.read + mgr.write)) / v.managerThinkSeconds : 0,
    historyTrips,
    historyInspections: historyTrips * 2,
    historyExpenses: historyTrips * v.expensesPerShift,
    historyFiles: historyTrips * photos,
    noisyExportRowsPerMinute: v.noisyExportsPerMinute * v.noisyExportPages * v.noisyExportPageSize,
    noisyUploadMBPerMinute: (v.noisyUploadsPerMinute * v.photoSizeBytes) / 1e6,
  };
}

// ---------------------------------------------------------------- k6 options

/** Пороги: только пилотный тенант; передача файлов, вход и шумный сосед не входят. */
export function buildThresholds(profile) {
  const t = profile.targets;
  return {
    'http_req_duration{tenant:pilot,kind:read}': [`p(95)<${t.readP95Ms}`],
    'http_req_duration{tenant:pilot,kind:write}': [`p(95)<${t.writeP95Ms}`],
    'http_req_failed{tenant:pilot}': [`rate<${t.errorRate}`],
    'checks{tenant:pilot}': [`rate>${t.checksRate}`],
  };
}

const PILOT = { tenant: 'pilot' };
const NOISY = { tenant: 'noisy' };
const ASSUMED_LATENCY_S = 0.2; // оценка для расчёта числа VU, не цель
const MANAGER_LIST_CALLS = 4;

/** Сценарии k6 (они же значения тега flow). */
export const FLOWS = ['driverShift', 'managerShift', 'noisyExport', 'noisyUploads'];
/** Counter: итерация сценария дошла до конца (тег flow). */
export const FLOW_COMPLETED = 'flow_completed';
/** Counter: итерация прервана (теги flow и reason). */
export const FLOW_ABORTED = 'flow_aborted';

/** Плановое число итераций каждого сценария за стадию. */
export function plannedIterations(profile, stageName) {
  const stage = stageOf(profile, stageName);
  if (stageName === 'smoke') {
    return Object.fromEntries(FLOWS.map((f) => [f, stage.iterations]));
  }
  const v = paramValues(profile, stageName);
  const r = deriveRates(profile, stageName);
  const minutes = stage.durationMinutes;
  const managerIterationSeconds = v.managerThinkSeconds + MANAGER_LIST_CALLS * ASSUMED_LATENCY_S;
  return {
    driverShift: (shiftsPerHour(r) * minutes) / 60,
    managerShift: Math.floor((r.managerVus * minutes * 60) / managerIterationSeconds),
    noisyExport: v.noisyExportsPerMinute * minutes,
    noisyUploads: v.noisyUploadsPerMinute * minutes,
  };
}

/**
 * Пороги объёма (допущение A-24): прогон не проходит, если подал меньше плана.
 * smoke — каждая итерация; pilot и stress — плановый объём × targets.minVolumeShare (вниз).
 */
export function buildVolumeThresholds(profile, stageName) {
  const planned = plannedIterations(profile, stageName);
  const share = stageName === 'smoke' ? 1 : profile.targets.minVolumeShare;
  return Object.fromEntries(
    FLOWS.map((f) => [
      `${FLOW_COMPLETED}{flow:${f}}`,
      [`count>=${Math.floor(planned[f] * share + 1e-9)}`],
    ]),
  );
}

const shiftsPerHour = (r) => Math.max(1, Math.round(r.shiftsPerMinutePeak * 60));

/** options k6 для стадии: сценарии driverShift, managerShift, noisyExport, noisyUploads. */
export function buildOptions(profile, stageName) {
  const stage = stageOf(profile, stageName);
  const scenarios =
    stageName === 'smoke' ? smokeScenarios(stage) : loadScenarios(profile, stageName, stage);
  return {
    scenarios,
    thresholds: { ...buildThresholds(profile), ...buildVolumeThresholds(profile, stageName) },
    summaryTrendStats: SUMMARY_TREND_STATS,
    // Сценарии входят один раз на VU (Session живёт между итерациями); по умолчанию k6 чистит
    // jar перед каждой итерацией, и со второй итерации все вызовы получали бы 401.
    noCookiesReset: true,
    discardResponseBodies: false,
    userAgent: 'ortus-load/0.1 (k6)',
  };
}

function smokeScenarios(stage) {
  const one = (exec, tags) => ({
    executor: 'per-vu-iterations',
    vus: 1,
    iterations: stage.iterations,
    maxDuration: `${stage.durationMinutes}m`,
    exec,
    tags,
  });
  return {
    driverShift: one('driverShift', PILOT),
    managerShift: one('managerShift', PILOT),
    noisyExport: one('noisyExport', NOISY),
    noisyUploads: one('noisyUploads', NOISY),
  };
}

function loadScenarios(profile, stageName, stage) {
  const v = paramValues(profile, stageName);
  const r = deriveRates(profile, stageName);
  const duration = `${stage.durationMinutes}m`;
  const shift = requestsPerShift(profile, stageName);
  const shiftSeconds =
    (shift.read + shift.write + shift.transfer) * (v.driverThinkSeconds + ASSUMED_LATENCY_S);
  const perHour = shiftsPerHour(r);
  const driverVus = Math.ceil((perHour / 3600) * shiftSeconds) + 1;
  const exportVus = Math.ceil((v.noisyExportsPerMinute / 60) * v.noisyExportPages * 0.5) + 1;
  const uploadVus = Math.ceil((v.noisyUploadsPerMinute / 60) * 3) + 1;
  return {
    driverShift: {
      executor: 'constant-arrival-rate',
      rate: perHour,
      timeUnit: '1h',
      duration,
      // Смена идёт минуты; без запаса смены последних минут обрываются и не входят в объём.
      gracefulStop: `${Math.ceil(shiftSeconds * 2)}s`,
      preAllocatedVUs: driverVus,
      maxVUs: driverVus * 3,
      exec: 'driverShift',
      tags: PILOT,
    },
    managerShift: {
      executor: 'constant-vus',
      vus: r.managerVus,
      duration,
      exec: 'managerShift',
      tags: PILOT,
    },
    noisyExport: {
      executor: 'constant-arrival-rate',
      rate: v.noisyExportsPerMinute,
      timeUnit: '1m',
      duration,
      preAllocatedVUs: exportVus,
      maxVUs: exportVus * 3,
      exec: 'noisyExport',
      tags: NOISY,
    },
    noisyUploads: {
      executor: 'constant-arrival-rate',
      rate: v.noisyUploadsPerMinute,
      timeUnit: '1m',
      duration,
      preAllocatedVUs: uploadVus,
      maxVUs: uploadVus * 3,
      exec: 'noisyUploads',
      tags: NOISY,
    },
  };
}

// ---------------------------------------------------------------- вход

const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;

/**
 * Dev-провайдер входа — только local и compose (PD-18, Q-102, ADR-0004): loopback, localhost,
 * host.docker.internal и имя сервиса compose без точки. Вход на stage — OIDC/BFF или отдельный
 * тестовый механизм по решению интегратора / техлида (load-profile.md §4, §7).
 */
export function devLoginAllowed(baseUrl) {
  // Без глобального URL: в k6 его может не быть.
  const m = /^https?:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(String(baseUrl));
  if (!m) return false;
  const host = m[1].toLowerCase();
  if (host === 'localhost' || host === 'host.docker.internal' || host === '[::1]') return true;
  if (LOOPBACK_V4.test(host)) return true;
  return /^[a-z][a-z0-9-]*$/.test(host); // имя сервиса compose: без точек, не IP
}

// ---------------------------------------------------------------- пути и заголовки

/** Путь операции с подстановкой параметров и query-строкой (undefined пропускается). */
export function pathFor(opId, params = {}, query = {}) {
  const spec = OPS[opId];
  if (!spec) throw new Error(`неизвестная операция ${opId}`);
  const path = spec.path.replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`${opId}: не задан параметр пути ${name}`);
    }
    return encodeURIComponent(String(value));
  });
  const qs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([k, value]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}

/** Idempotency-Key: стабилен для одной команды, 16–128 символов [A-Za-z0-9._:-]. */
export function idempotencyKey({ run, scenario, vu, iter, step }) {
  const clean = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
  const key = ['ld', run, scenario, vu, iter, step].map(clean).join(':');
  return key.length > 128 ? key.slice(0, 128) : key.padEnd(16, '_');
}

// ---------------------------------------------------------------- тела запросов

/** UTC RFC3339 с суффиксом Z без миллисекунд. */
export function isoInstant(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const quantity = (n) => String(Math.round(Number(n)));

export function reservationCreate({ vehicleId, driverMemberId, startsAt, hours }) {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + hours * 3600 * 1000);
  return {
    vehicleId,
    driverMemberId,
    window: { startsAt: isoInstant(start), endsAt: isoInstant(end), timeZone: TIME_ZONE },
  };
}

export function uploadCreate({
  fileName,
  contentType = 'image/jpeg',
  sizeBytes,
  sha256,
  purpose,
  owner,
}) {
  if (!SHA256_RE.test(sha256)) throw new Error('uploadCreate: sha256 — 64 hex в нижнем регистре');
  if (!UPLOAD_PURPOSES.includes(purpose)) throw new Error(`uploadCreate: purpose ${purpose}`);
  return {
    fileName,
    contentType,
    sizeBytes,
    sha256,
    purpose,
    owner: { moduleKey: 'fleet', entityType: owner.entityType, entityId: owner.entityId },
  };
}

export function inspectionCreate({
  checklist,
  vehicleId,
  reservationId,
  tripId,
  odometerKm,
  fuelPercent,
  photos,
  capturedAt,
}) {
  const kind = checklist.kind;
  if (kind === 'departure' && !reservationId) throw new Error('выезд: нужен reservationId');
  if (kind === 'return' && !tripId) throw new Error('возврат: нужен tripId');
  const at = isoInstant(capturedAt);
  return {
    checklistVersionId: checklist.versionId,
    vehicleId,
    kind,
    ...(kind === 'departure' ? { reservationId } : { tripId }),
    odometerKm: quantity(odometerKm),
    fuelPercent,
    checks: checklist.items.map((item) => ({ key: item.key, result: 'pass' })),
    photos: photos.map((p) => ({ role: p.role, fileId: p.fileId, capturedAt: at })),
    capturedAt: at,
  };
}

export const tripStart = ({ reservationId, departureInspectionId }) => ({
  reservationId,
  departureInspectionId,
});

export const tripReturn = ({ returnInspectionId }) => ({ action: 'return', returnInspectionId });

export const tripReview = () => ({ decision: 'approve' });

export const expenseReview = () => ({ decision: 'approve' });

export function tripExpenseCreate({
  kind,
  occurredAt,
  amountMinor,
  receiptFileIds,
  quantityLitres,
}) {
  if (!EXPENSE_KINDS.includes(kind)) throw new Error(`расход: kind ${kind} вне D-12`);
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error('расход: amountMinor — целое ≥ 0 (копейки)');
  }
  return {
    kind,
    occurredAt: isoInstant(occurredAt),
    amount: { amountMinor, currency: CURRENCY },
    ...(quantityLitres === undefined ? {} : { quantity: quantity(quantityLitres) }),
    receiptFileIds,
  };
}

export function datasetQuery({ select, limit, cursor }) {
  return {
    select: select.slice(0, 100),
    filters: [],
    sort: [],
    limit: Math.min(200, Math.max(1, limit)),
    ...(cursor ? { cursor } : {}),
  };
}
