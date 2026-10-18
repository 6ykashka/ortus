// Чистая модель нагрузочного профиля (W0.16 → W2.47). Без импорта k6/*: модуль грузят и k6, и Node (тесты).
// Источники: backend/test/load/profile.json (D-08, ADR-0009), docs/plan/v2/load-profile.md,
// api/dist/ortus.bundle.yaml (контракт 0.5.1-stage2: операции, заголовки, схемы тел),
// правила сервера этапа 2 (fleet/expenses, fleet/inspections, files) и клиент водителя и логиста (W2.21, W2.22).

export const STAGE_NAMES = ['smoke', 'stand', 'pilot', 'stress'];

/** Образ k6 с digest (релиз 21.09.2026): check-k6.mjs, stand-smoke.mjs, полный прогон W3.01. */
export const K6_IMAGE =
  'grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34';

const TIME_ZONE = 'Europe/Moscow';
const CURRENCY = 'RUB';
const UPLOAD_PURPOSES = ['inspection', 'expense_receipt'];
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
 * Операции контракта 0.5.1-stage2, которые трогает нагрузка. kind — класс порога: read (GET) или write.
 * idempotent — обязателен Idempotency-Key; ifMatch — обязателен If-Match (ETag свежего GET).
 */
export const OPS = {
  getMyContext: op('GET', '/api/v1/me/context', 'read'),
  listMembers: op('GET', `${T}/members`, 'read'),
  createTripPlan: op('POST', `${T}/fleet/trip-plans`, 'write', true),
  listTripPlans: op('GET', `${T}/fleet/trip-plans`, 'read'),
  getTripPlan: op('GET', `${T}/fleet/trip-plans/{tripId}`, 'read'),
  listVehicles: op('GET', `${T}/fleet/vehicles`, 'read'),
  reserveVehicle: op('POST', `${T}/fleet/reservations`, 'write', true),
  getInspectionChecklist: op('GET', `${T}/fleet/inspection-checklist`, 'read'),
  initiateUpload: op('POST', `${T}/files/uploads`, 'write', true),
  completeUpload: op('POST', `${T}/files/uploads/{uploadId}/complete`, 'write', true),
  getFile: op('GET', `${T}/files/{fileId}`, 'read'),
  getFileDownload: op('GET', `${T}/files/{fileId}/download`, 'read'),
  submitInspection: op('POST', `${T}/fleet/inspections`, 'write', true),
  getInspection: op('GET', `${T}/fleet/inspections/{inspectionId}`, 'read'),
  listInspectionDefects: op('GET', `${T}/fleet/defects`, 'read'),
  startTrip: op('POST', `${T}/fleet/trips`, 'write', true),
  createTripExpense: op('POST', `${T}/fleet/trips/{tripId}/expenses`, 'write', true),
  listTripExpenses: op('GET', `${T}/fleet/trips/{tripId}/expenses`, 'read'),
  finishTripRoute: op('POST', `${T}/fleet/trips/{tripId}/route-completion`, 'write', true, true),
  returnTrip: op('PATCH', `${T}/fleet/trips/{tripId}`, 'write', true, true),
  reviewTrip: op('POST', `${T}/fleet/trips/{tripId}/review`, 'write', true, true),
};

// ---------------------------------------------------------------- профиль

function stageOf(profile, stageName) {
  const stage = STAGE_NAMES.includes(stageName) ? profile.stages?.[stageName] : undefined;
  if (!stage) {
    throw new Error(`неизвестная стадия «${stageName}»; допустимы: ${STAGE_NAMES.join(', ')}`);
  }
  return stage;
}

/** Стадия по итерациям (smoke, stand): водители — per-vu-iterations, а не закрытая модель с темпом. */
const byIterations = (stage) => stage.iterations !== undefined;

/** Значения параметров профиля с переопределениями стадии: { vehicles: 60, … }. */
export function paramValues(profile, stageName) {
  const stage = stageOf(profile, stageName);
  const values = {};
  for (const [key, param] of Object.entries(profile.params)) values[key] = param.value;
  return { ...values, ...(stage.overrides ?? {}) };
}

const round3 = (x) => Math.round(x * 1000) / 1000;
const ASSUMED_LATENCY_S = 0.2; // оценка задержки для расчёта длительности, не цель
const MANAGER_LIST_CALLS = 4;
/**
 * Переходы между экранами смены, после которых водитель делает паузу (кроме фото и опросов): вход, бронь,
 * осмотр выезда, старт, каждый расход, завершение маршрута, осмотр сдачи (scenarios/driver-shift.js).
 */
const shiftScreens = (v) => 6 + v.expensesPerShift;

function photosPerShift(v) {
  return v.departurePhotos + v.returnPhotos + v.expensesPerShift * v.receiptsPerExpense;
}

/**
 * Состав смены водителя: число запросов по операциям, по видам, передачи файлов и паузы. Фото — initiateUpload →
 * PUT → completeUpload → getFile до `ready` (двойник отвечает `ready` с первого опроса; стенд — после cmd/worker).
 */
export function requestsPerShift(profile, stageName) {
  const v = paramValues(profile, stageName);
  const photos = photosPerShift(v);
  const byOp = {
    getMyContext: 1,
    listTripPlans: 1 + v.tripPollsPerShift,
    listVehicles: 1,
    reserveVehicle: 1,
    getInspectionChecklist: 2,
    initiateUpload: photos,
    completeUpload: photos,
    getFile: photos,
    submitInspection: 2,
    startTrip: 1,
    createTripExpense: v.expensesPerShift,
    getTripPlan: 2,
    finishTripRoute: 1,
    returnTrip: 1,
  };
  return {
    ...countKinds(byOp),
    byOp,
    auth: 1,
    transfer: photos,
    thinkPoints: photos + v.tripPollsPerShift + shiftScreens(v),
  };
}

/**
 * Итерация логиста: рабочее место (listTripPlans), очередь «Приёмки смен» (listTripPlans state=submitted), машины,
 * дефекты; при приёмке — карточка, осмотры выезда и сдачи, расходы, ссылки на все фото и их скачивание, решение.
 */
export function requestsPerManagerIteration(profile, stageName, { review }) {
  const v = paramValues(profile, stageName);
  const photos = photosPerShift(v);
  const byOp = { listTripPlans: 2, listVehicles: 1, listInspectionDefects: 1 };
  if (review) {
    Object.assign(byOp, {
      getTripPlan: 2,
      getInspection: 2,
      listTripExpenses: 1,
      getFileDownload: photos,
      reviewTrip: 1,
    });
  }
  return { ...countKinds(byOp), byOp, transfer: review ? photos : 0 };
}

/** Планирование в setup(): вход логиста, контекст, участники, рейсы на каждого водителя. */
export function requestsForPlanning({ drivers, tripsPerDriver: perDriver }) {
  return {
    auth: 1,
    byOp: {
      getMyContext: 1,
      listMembers: 1,
      listTripPlans: 1,
      createTripPlan: drivers * perDriver,
    },
  };
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

/** Производные величины профиля (таблица «Производные» в load-profile.md). */
export function deriveRates(profile, stageName) {
  const stage = stageOf(profile, stageName);
  const v = paramValues(profile, stageName);
  const scale = stage.scale;
  const photos = photosPerShift(v);
  const shift = requestsPerShift(profile, stageName);
  const mgr = requestsPerManagerIteration(profile, stageName, { review: false });
  const driverVus = (v.peakConcurrentUsers - v.officeUsers) * scale;
  const managerVus = v.officeUsers * scale;
  const uploadsPerHourPeak = v.peakUploadsPerHour * scale;
  const shiftsPerHour = uploadsPerHourPeak / photos;
  const photoMBPerDay = (v.shiftsPerDay * scale * photos * v.photoSizeBytes) / 1e6;
  const historyTrips = v.shiftsPerDay * v.daysPerMonth * v.historyMonths;
  const historyFiles = historyTrips * photos;
  return {
    driverVus,
    managerVus,
    concurrentUsersPeak: driverVus + managerVus,
    photosPerShift: photos,
    uploadsPerHourPeak,
    shiftsPerHourPeak: round3(shiftsPerHour),
    driverCycleSeconds: round3((driverVus * photos * 3600) / uploadsPerHourPeak),
    driverActiveSeconds: round3(
      shift.thinkPoints * v.driverThinkSeconds +
        (shift.read + shift.write + shift.transfer) * ASSUMED_LATENCY_S,
    ),
    photoMBPerPeakHour: round3((uploadsPerHourPeak * v.photoSizeBytes) / 1e6),
    photoMBPerDay: round3(photoMBPerDay),
    photoGBPerMonth: round3((photoMBPerDay * v.daysPerMonth) / 1000),
    driverApiRps: round3((shiftsPerHour * (shift.read + shift.write)) / 3600),
    managerApiRps:
      v.managerThinkSeconds > 0
        ? round3((managerVus * (mgr.read + mgr.write)) / v.managerThinkSeconds)
        : 0,
    historyTrips,
    historyInspections: historyTrips * 2,
    historyExpenses: historyTrips * v.expensesPerShift,
    historyFiles,
    historyFileGB: round3((historyFiles * v.photoSizeBytes) / 1e9),
    noisyExportRowsPerMinute: v.noisyExportsPerMinute * v.noisyExportPages * v.noisyExportPageSize,
    noisyUploadMBPerMinute: round3((v.noisyUploadsPerMinute * v.photoSizeBytes) / 1e6),
  };
}

// ---------------------------------------------------------------- персонажи и темп

export const pad = (n, width) => String(n).padStart(width, '0');
const range = (n) => Array.from({ length: n }, (_, i) => i);

/**
 * Персонажи dev-входа стадии. pilot и stress — сид нагрузки W3.01 (load-pilot-driver-NNN по VU водителей,
 * load-pilot-manager-NN по VU офиса, логист-планировщик, владелец шумного тенанта); smoke — двойник
 * (водитель на итерацию); stand — сид demo (stages.stand.personas).
 */
export function personasFor(profile, stageName) {
  const stage = stageOf(profile, stageName);
  const r = deriveRates(profile, stageName);
  const smoke = stageName === 'smoke';
  const own = stage.personas ?? {};
  return {
    drivers:
      own.drivers ??
      range(smoke ? stage.iterations : r.driverVus).map(
        (i) => `load-pilot-driver-${pad(i + 1, 3)}`,
      ),
    managers:
      own.managers ??
      range(smoke ? 1 : r.managerVus).map((i) => `load-pilot-manager-${pad(i + 1, 2)}`),
    planner: own.planner ?? 'load-pilot-planner-01',
    noisy: 'load-noisy-owner-01',
  };
}

/** Номер персонажа итерации: слот VU (порядок первой итерации) + итерация VU × число VU, по кругу. */
export function personaIndex({ slot, iteration, vus, count }) {
  return (slot + iteration * vus) % count;
}

/**
 * Темп водителя закрытой модели (pilot, stress; допущение A-26): стартовый сдвиг слота равномерно по циклу,
 * затем смена раз в цикл — так 45 VU водителей подают ровно peakUploadsPerHour фото в час. smoke и stand — без пауз.
 */
export function driverPacing(profile, stageName, slot) {
  const stage = stageOf(profile, stageName);
  if (byIterations(stage)) return { offsetSeconds: 0, cycleSeconds: 0 };
  const r = deriveRates(profile, stageName);
  return {
    offsetSeconds: Math.round((slot * r.driverCycleSeconds) / r.driverVus),
    cycleSeconds: r.driverCycleSeconds,
  };
}

const graceSeconds = (r) => Math.ceil(r.driverActiveSeconds * 2);
const durationSeconds = (stage) => stage.durationMinutes * 60;

/** VU сценариев водителя и офиса стадии. */
function vusOf(profile, stageName) {
  const stage = stageOf(profile, stageName);
  if (stageName === 'smoke') return { drivers: 1, managers: 1 };
  if (byIterations(stage)) {
    const p = personasFor(profile, stageName);
    return { drivers: p.drivers.length, managers: p.managers.length };
  }
  const r = deriveRates(profile, stageName);
  return { drivers: r.driverVus, managers: r.managerVus };
}

// ---------------------------------------------------------------- k6 options

/**
 * Пороги: только пилотный тенант; передача файлов, вход, планирование и шумный сосед не входят. Стадия с
 * latencyGate: false (stand — стенд разработчика, не оборудование целей) p95 только наблюдает: порог p(95)>=0
 * не падает, но держит подметрику в сводке; цели p95 проверяет W3.01 на stage.
 */
export function buildThresholds(profile, stageName) {
  const t = profile.targets;
  const observe = stageName !== undefined && stageOf(profile, stageName).latencyGate === false;
  const p95 = (ms) => [observe ? 'p(95)>=0' : `p(95)<${ms}`];
  return {
    'http_req_duration{tenant:pilot,kind:read}': p95(t.readP95Ms),
    'http_req_duration{tenant:pilot,kind:write}': p95(t.writeP95Ms),
    'http_req_failed{tenant:pilot}': [`rate<${t.errorRate}`],
    'checks{tenant:pilot}': [`rate>${t.checksRate}`],
  };
}

const PILOT = { tenant: 'pilot' };
const NOISY = { tenant: 'noisy' };

/** Сценарии k6 (они же значения тега flow). */
export const FLOWS = ['driverShift', 'managerShift', 'noisyExport', 'noisyUploads'];
/** Counter: итерация сценария дошла до конца (тег flow). */
export const FLOW_COMPLETED = 'flow_completed';
/** Counter: итерация прервана (теги flow и reason). */
export const FLOW_ABORTED = 'flow_aborted';
/** Counter: логист принял смену (reviewTrip 200). */
export const TRIPS_REVIEWED = 'trips_reviewed';

const flowsOf = (stage) => stage.flows ?? FLOWS;

/** Плановое число итераций каждого сценария стадии. */
export function plannedIterations(profile, stageName) {
  const stage = stageOf(profile, stageName);
  const v = paramValues(profile, stageName);
  const vus = vusOf(profile, stageName);
  const D = durationSeconds(stage);
  const managerIteration = v.managerThinkSeconds + MANAGER_LIST_CALLS * ASSUMED_LATENCY_S;
  if (stageName === 'smoke') {
    return Object.fromEntries(FLOWS.map((f) => [f, stage.iterations]));
  }
  if (byIterations(stage)) {
    return {
      driverShift: vus.drivers * stage.iterations,
      managerShift: Math.floor((vus.managers * D) / managerIteration),
    };
  }
  const r = deriveRates(profile, stageName);
  let shifts = 0;
  for (let slot = 0; slot < r.driverVus; slot++) {
    const { offsetSeconds, cycleSeconds } = driverPacing(profile, stageName, slot);
    shifts += Math.ceil((D - offsetSeconds) / cycleSeconds);
  }
  return {
    driverShift: shifts,
    managerShift: Math.floor((r.managerVus * (D + graceSeconds(r))) / managerIteration),
    noisyExport: v.noisyExportsPerMinute * stage.durationMinutes,
    noisyUploads: v.noisyUploadsPerMinute * stage.durationMinutes,
  };
}

/** Сколько рейсов setup() планирует на каждого водителя. */
export function tripsPerDriver(profile, stageName) {
  const planned = plannedIterations(profile, stageName).driverShift;
  const perDriver = Math.ceil(planned / personasFor(profile, stageName).drivers.length);
  // С темпом окно рейса — один цикл (tripWindows), а первая смена слота сдвинута внутри цикла: она может
  // прийтись на следующее окно, поэтому рейсов на один больше смен.
  return byIterations(stageOf(profile, stageName)) ? perDriver : perDriver + 1;
}

/**
 * Пороги объёма (допущение A-24): прогон не проходит, если подал меньше плана. Сценарии по итерациям — каждая
 * итерация; остальные — план × доля (вниз). trips_reviewed — принятые смены: столько же, сколько смен водителей.
 */
export function buildVolumeThresholds(profile, stageName) {
  const stage = stageOf(profile, stageName);
  const planned = plannedIterations(profile, stageName);
  const share = stage.minVolumeShare ?? profile.targets.minVolumeShare;
  const exact = (flow) => stageName === 'smoke' || (byIterations(stage) && flow === 'driverShift');
  const min = (flow) => Math.floor(planned[flow] * (exact(flow) ? 1 : share) + 1e-9);
  const out = {};
  for (const f of flowsOf(stage)) out[`${FLOW_COMPLETED}{flow:${f}}`] = [`count>=${min(f)}`];
  out[TRIPS_REVIEWED] = [`count>=${min('driverShift')}`];
  return out;
}

/** options k6 стадии. */
export function buildOptions(profile, stageName) {
  const stage = stageOf(profile, stageName);
  let scenarios;
  if (stageName === 'smoke') scenarios = smokeScenarios(stage);
  else if (byIterations(stage)) scenarios = standScenarios(profile, stageName, stage);
  else scenarios = loadScenarios(profile, stageName, stage);
  return {
    scenarios,
    thresholds: {
      ...buildThresholds(profile, stageName),
      ...buildVolumeThresholds(profile, stageName),
    },
    summaryTrendStats: SUMMARY_TREND_STATS,
    // Сценарии входят один раз на VU (Session живёт между итерациями); по умолчанию k6 чистит
    // jar перед каждой итерацией, и со второй итерации все вызовы получали бы 401.
    noCookiesReset: true,
    // setup() планирует рейсы на всех водителей (pilot — 90 водителей × 2 рейса).
    setupTimeout: '10m',
    discardResponseBodies: false,
    userAgent: 'ortus-load/0.2 (k6)',
  };
}

function smokeScenarios(stage) {
  const one = (exec, tags) => ({
    executor: 'per-vu-iterations',
    vus: 1,
    iterations: stage.iterations,
    maxDuration: `${durationSeconds(stage)}s`,
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

function standScenarios(profile, stageName, stage) {
  const vus = vusOf(profile, stageName);
  const D = durationSeconds(stage);
  return {
    driverShift: {
      executor: 'per-vu-iterations',
      vus: vus.drivers,
      iterations: stage.iterations,
      maxDuration: `${D}s`,
      exec: 'driverShift',
      tags: PILOT,
    },
    managerShift: {
      executor: 'constant-vus',
      vus: vus.managers,
      duration: `${D}s`,
      exec: 'managerShift',
      tags: PILOT,
    },
  };
}

function loadScenarios(profile, stageName, stage) {
  const v = paramValues(profile, stageName);
  const r = deriveRates(profile, stageName);
  const D = durationSeconds(stage);
  const grace = graceSeconds(r);
  const exportVus = Math.ceil((v.noisyExportsPerMinute / 60) * v.noisyExportPages * 0.5) + 1;
  const uploadVus = Math.ceil((v.noisyUploadsPerMinute / 60) * 3) + 1;
  return {
    driverShift: {
      executor: 'constant-vus',
      vus: r.driverVus,
      duration: `${D}s`,
      // Смена идёт минуты: начатые до конца часа смены доигрываются.
      gracefulStop: `${grace}s`,
      exec: 'driverShift',
      tags: PILOT,
    },
    managerShift: {
      executor: 'constant-vus',
      vus: r.managerVus,
      // Логисты работают, пока доигрываются смены: принимают и их.
      duration: `${D + grace}s`,
      exec: 'managerShift',
      tags: PILOT,
    },
    noisyExport: {
      executor: 'constant-arrival-rate',
      rate: v.noisyExportsPerMinute,
      timeUnit: '1m',
      duration: `${D}s`,
      preAllocatedVUs: exportVus,
      maxVUs: exportVus * 3,
      exec: 'noisyExport',
      tags: NOISY,
    },
    noisyUploads: {
      executor: 'constant-arrival-rate',
      rate: v.noisyUploadsPerMinute,
      timeUnit: '1m',
      duration: `${D}s`,
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
 * тестовый механизм по решению интегратора / техлида (load-profile.md §4, §8).
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
const TRIP_HOURS = 9;
const TRIP_LEAD_MS = 10 * 60_000;
const TRIP_GAP_MS = 60_000;
const ms = (iso) => new Date(iso).getTime();

/**
 * Окна count рейсов одного водителя (A-27). Сервер не даёт водителю пересекающихся рейсов («Водитель уже занят в
 * это время»), поэтому окна идут подряд с минутой зазора: с темпом — по циклу, без темпа — по 9 часов. Первое
 * начинается за 10 минут до at, но не раньше чем через минуту после after (конца уже запланированного рейса).
 */
export function tripWindows({ at, cycleSeconds, count, after }) {
  const length = cycleSeconds > 0 ? cycleSeconds * 1000 - TRIP_GAP_MS : TRIP_HOURS * 3600_000;
  let start = ms(at) - TRIP_LEAD_MS;
  if (after !== undefined) start = Math.max(start, ms(after) + TRIP_GAP_MS);
  return range(count).map((j) => {
    const s = start + j * (length + TRIP_GAP_MS);
    return { startsAt: isoInstant(s), endsAt: isoInstant(s + length), timeZone: TIME_ZONE };
  });
}

/**
 * Что планирует setup(): perDriver рейсов на каждого активного водителя за вычетом его рейсов в планировании,
 * окно которых ещё не кончилось (у Ильи Васильева в сиде demo — Р-208). Новые окна — после его последнего рейса.
 */
export function planningFor({ members, planned, perDriver, at, cycleSeconds }) {
  const out = [];
  for (const m of members) {
    if (m.status !== 'active' || !(m.workProfiles || []).includes('driver')) continue;
    const own = planned.filter((p) => p.driverMemberId === m.id);
    const usable = own.filter((p) => ms(p.plannedWindow.endsAt) > ms(at)).length;
    const lastEnd = own.reduce((t, p) => Math.max(t, ms(p.plannedWindow.endsAt)), -Infinity);
    const count = Math.max(0, perDriver - usable);
    const after = Number.isFinite(lastEnd) ? isoInstant(lastEnd) : undefined;
    for (const window of tripWindows({ at, cycleSeconds, count, after })) {
      out.push({ driverMemberId: m.id, orgUnitId: (m.orgUnitIds || [])[0], window });
    }
  }
  return out;
}

/** Рейс смены: самый ранний свой рейс в планировании, окно которого не кончится раньше needSeconds. */
export function pickTrip(plans, now, needSeconds) {
  const until = ms(now) + needSeconds * 1000;
  return plans
    .filter(
      (p) =>
        (p.state === 'planned' || p.state === 'assigned') && ms(p.plannedWindow.endsAt) >= until,
    )
    .sort((a, b) => ms(a.plannedWindow.startsAt) - ms(b.plannedWindow.startsAt))[0];
}

/** Груз рейса помещается в машину: масса, объём, длина (сервер — fleetrules.Compat, 409 vehicle_incompatible). */
export function fitsCargo(vehicle, cargo) {
  const c = vehicle && vehicle.capacity;
  if (!c || !cargo) return true;
  const n = (x) => Number(x ?? 0);
  return (
    n(c.payloadKg) >= n(cargo.weightKg) &&
    n(c.volumeM3) >= n(cargo.volumeM3) &&
    n(c.cargoLengthM) >= n(cargo.lengthM)
  );
}

/** TripPlanCreate: малый груз (совместим с любой машиной пилота), загрузка и выгрузка. */
export function tripPlanCreate({ orgUnitId, driverMemberId, window, title }) {
  const load = { weightKg: '300', volumeM3: '2' };
  return {
    orgUnitId,
    title,
    plannedWindow: window,
    distanceKm: '60',
    cargo: { description: 'Нагрузка · 4 паллеты', ...load, lengthM: '1.2' },
    stops: [
      {
        sequence: 1,
        op: 'load',
        address: 'Склад № 1, Лобня',
        plannedAt: window.startsAt,
        ...load,
      },
      { sequence: 2, op: 'unload', address: 'Химки, ул. Заводская, 8', ...load },
    ],
    driverMemberId,
  };
}

/** ReservationCreate: бронь машины на рейс водителя, окно — окно рейса (клиент W2.22). */
export function reservationCreate({ vehicleId, driverMemberId, window, tripId }) {
  return { vehicleId, driverMemberId, window, tripId };
}

/** UploadCreate: фото рейса (клиент W2.22 крепит и фото осмотров, и чеки к рейсу). */
export function uploadCreate({
  fileName,
  contentType = 'image/jpeg',
  sizeBytes,
  sha256,
  purpose,
  tripId,
}) {
  if (!SHA256_RE.test(sha256)) throw new Error('uploadCreate: sha256 — 64 hex в нижнем регистре');
  if (!UPLOAD_PURPOSES.includes(purpose)) throw new Error(`uploadCreate: purpose ${purpose}`);
  return {
    fileName,
    contentType,
    sizeBytes,
    sha256,
    purpose,
    owner: { moduleKey: 'fleet', entityType: 'trip', entityId: tripId },
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

/**
 * Категории расходов пилота — ответ на D-12 (ADR-0013, W2.40): справочник с посевом из шести, штрафов нет.
 * «Прочее» и «шиномонтаж» — первыми: короткие прогоны (smoke, stand) проверяют правила W2.40 (Q-W2.40-6).
 */
export const EXPENSE_KINDS = ['other', 'tire_service', 'fuel', 'wash', 'parking', 'toll'];

const EXPENSES = {
  other: { amountMinor: 30000, comment: 'Замена лампы фары' },
  tire_service: { amountMinor: 150000 },
  fuel: { amountMinor: 350000, quantityLitres: 40 },
  wash: { amountMinor: 50000 },
  parking: { amountMinor: 20000 },
  toll: { amountMinor: 45000 },
};

/** Расход смены i: по кругу шести категорий; топливо — с литрами, «прочее» — с комментарием. */
export function expenseFor(i) {
  const kind = EXPENSE_KINDS[i % EXPENSE_KINDS.length];
  return { kind, ...EXPENSES[kind] };
}

/** TripExpenseCreate по правилам сервера (fleet/expenses/rules.go): один чек, рубли в копейках. */
export function tripExpenseCreate({
  kind,
  occurredAt,
  amountMinor,
  receiptFileIds,
  quantityLitres,
  comment,
}) {
  if (!EXPENSE_KINDS.includes(kind)) throw new Error(`расход: kind ${kind} вне D-12`);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('расход: amountMinor — целое > 0 (копейки)');
  }
  if (kind === 'other' && !(comment && comment.trim())) {
    throw new Error('расход: для «Прочее» нужен комментарий');
  }
  if (kind === 'fuel' && quantityLitres === undefined) throw new Error('расход: топливо — литры');
  if (!Array.isArray(receiptFileIds) || receiptFileIds.length !== 1) {
    throw new Error('расход: ровно один чек');
  }
  return {
    kind,
    occurredAt: isoInstant(occurredAt),
    amount: { amountMinor, currency: CURRENCY },
    ...(quantityLitres === undefined ? {} : { quantity: quantity(quantityLitres) }),
    receiptFileIds,
    ...(comment === undefined ? {} : { comment }),
  };
}
