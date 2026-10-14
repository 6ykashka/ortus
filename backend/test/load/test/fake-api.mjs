// API-двойник для smoke-прогона k6 без стенда (W0.16). Не эталон поведения backend:
// отвечает формой схем OpenAPI 0.1 и строго проверяет то, что обязан слать клиент нагрузки —
// cookie сессии, X-CSRF-Token и Origin на изменениях, Idempotency-Key, If-Match, обязательные поля тел.
// Считает запросы по персонажу и operationId: GET /__stats.
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { OPS } from '../lib/model.js';

const SESSION_COOKIE = 'ortus_session';
const CSRF_COOKIE = 'ortus_csrf';
const DEV_LOGIN_PATH = '/api/v1/dev/login';
const IDEM_RE = /^[A-Za-z0-9._:-]{16,128}$/;
const ETAG_RE = /^"[^"\s]+"$/;
const PHOTO_ROLES = ['front', 'rear', 'left', 'right', 'odometer'];

const ROUTES = Object.entries(OPS).map(([opId, spec]) => ({
  opId,
  method: spec.method,
  spec,
  re: new RegExp(`^${spec.path.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)')}$`),
}));

const uuid = () => randomUUID();
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const etag = (rev) => `"rev-${rev}"`;

function seed({ pendingTrips }) {
  const tenants = {
    pilot: { id: uuid(), name: 'Нагрузка · пилот' },
    noisy: { id: uuid(), name: 'Нагрузка · шумный' },
  };
  const state = {
    tenants,
    members: new Map(), // persona → { memberId, tenant }
    sessions: new Map(), // session → persona
    vehicles: [],
    reservations: [],
    trips: [],
    expenses: [],
    inspections: [],
    uploads: new Map(),
    idem: new Map(),
    stats: {},
  };
  for (const tenant of ['pilot', 'noisy']) {
    for (let i = 1; i <= 3; i++) {
      state.vehicles.push({
        tenant,
        id: uuid(),
        orgUnitId: uuid(),
        registrationNumber: `А${100 + i}АА77`,
        displayName: `Газель ${i}`,
        status: 'available',
        odometerKm: String(100000 + i * 1000),
        revision: 1,
      });
    }
  }
  // Рейсы на приёмке с двумя расходами — по одному на итерацию менеджера в smoke. Они идут
  // в списке раньше рейсов водителей smoke, поэтому число запросов менеджера детерминировано.
  const trip = (tenant, status) => {
    const t = {
      tenant,
      id: uuid(),
      vehicleId: state.vehicles.find((v) => v.tenant === tenant).id,
      driverMemberId: uuid(),
      orgUnitId: uuid(),
      departureInspectionId: uuid(),
      returnInspectionId: uuid(),
      status,
      startedAt: now(),
      returnedAt: now(),
      revision: 2,
    };
    state.trips.push(t);
    return t;
  };
  for (let i = 0; i < pendingTrips; i++) {
    const t = trip('pilot', 'returned_pending_review');
    for (const kind of ['fuel', 'parking']) {
      state.expenses.push(expenseOf('pilot', t.id, { kind, amountMinor: 100000 }));
    }
  }
  trip('noisy', 'in_progress');
  return state;
}

function expenseOf(tenant, tripId, { kind, amountMinor, receiptFileIds = [] }) {
  return {
    tenant,
    id: uuid(),
    tripId,
    kind,
    occurredAt: now(),
    amount: { amountMinor, currency: 'RUB' },
    receiptFileIds,
    reviewState: 'pending',
    revision: 1,
  };
}

const strip = ({ tenant, ...rest }) => (void tenant, rest);

function problem(status, code, detail) {
  return { status, body: { type: 'about:blank', title: code, status, code, detail } };
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function requireFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] === undefined);
  return missing.length ? problem(422, 'validation_failed', `нет полей: ${missing}`) : null;
}

function count(state, persona, key) {
  const bucket = (state.stats[persona] ??= {});
  bucket[key] = (bucket[key] ?? 0) + 1;
}

/** Обработчики операций: (ctx) → { status, body, etag? }. */
const HANDLERS = {
  getMyContext: ({ state, me, persona }) => ({
    status: 200,
    body: {
      userId: me.memberId,
      displayName: persona,
      platformOperator: false,
      tenants: [
        {
          tenantId: state.tenants[me.tenant].id,
          name: state.tenants[me.tenant].name,
          membershipId: me.memberId,
          membershipStatus: 'active',
          orgUnitIds: [],
          modules: [],
          capabilities: [],
        },
      ],
      permissionVersion: '1',
    },
  }),
  listVehicles: ({ state, me, query }) => {
    // OpenAPI 0.1: availableFrom и availableUntil — оба или ни одного; с ними — только свободные.
    const from = query.get('availableFrom');
    const until = query.get('availableUntil');
    if (Boolean(from) !== Boolean(until)) {
      return problem(422, 'validation_failed', 'availableFrom/availableUntil');
    }
    return page(
      state.vehicles.filter((v) => v.tenant === me.tenant && (!from || v.status === 'available')),
    );
  },
  listReservations: ({ state, me }) =>
    page(state.reservations.filter((r) => r.tenant === me.tenant)),
  reserveVehicle: ({ state, me, body }) => {
    const bad = requireFields(body, ['vehicleId', 'driverMemberId', 'window']);
    if (bad) return bad;
    if (!body.window.startsAt?.endsWith('Z') || !body.window.timeZone) {
      return problem(422, 'validation_failed', 'window');
    }
    const v = state.vehicles.find((x) => x.tenant === me.tenant && x.id === body.vehicleId);
    if (!v) return problem(404, 'not_found');
    if (v.status !== 'available') return problem(409, 'resource_conflict', 'машина занята');
    v.status = 'reserved';
    const r = {
      tenant: me.tenant,
      id: uuid(),
      vehicleId: v.id,
      driverMemberId: body.driverMemberId,
      window: body.window,
      state: 'held',
      holdExpiresAt: now(),
      revision: 1,
    };
    state.reservations.push(r);
    return { status: 201, body: strip(r), etag: etag(1) };
  },
  getInspectionChecklist: ({ query }) => {
    if (!query.get('vehicleId') || !['departure', 'return'].includes(query.get('kind'))) {
      return problem(422, 'validation_failed', 'vehicleId, kind');
    }
    return {
      status: 200,
      body: {
        versionId: uuid(),
        kind: query.get('kind'),
        items: [
          { key: 'tires', label: 'Шины', required: true, failureBlocksRelease: true },
          { key: 'lights', label: 'Фары', required: true, failureBlocksRelease: true },
        ],
        requiredPhotoRoles: PHOTO_ROLES,
      },
    };
  },
  initiateUpload: ({ state, me, persona, body, host }) => {
    const bad = requireFields(body, [
      'fileName',
      'contentType',
      'sizeBytes',
      'sha256',
      'purpose',
      'owner',
    ]);
    if (bad) return bad;
    if (!/^[a-f0-9]{64}$/.test(body.sha256)) return problem(422, 'validation_failed', 'sha256');
    const u = {
      tenant: me.tenant,
      persona,
      uploadId: uuid(),
      fileId: uuid(),
      sha256: body.sha256,
      sizeBytes: body.sizeBytes,
      contentType: body.contentType,
      fileName: body.fileName,
      transferred: false,
      completed: false,
    };
    state.uploads.set(u.uploadId, u);
    return {
      status: 201,
      body: {
        uploadId: u.uploadId,
        fileId: u.fileId,
        method: 'PUT',
        uploadUrl: `http://${host}/_upload/${u.uploadId}`,
        requiredContentType: u.contentType,
        requiredSha256: u.sha256,
        expiresAt: now(),
        maxBytes: u.sizeBytes,
      },
    };
  },
  completeUpload: ({ state, me, params, body }) => {
    const u = state.uploads.get(params.uploadId);
    if (!u || u.tenant !== me.tenant) return problem(404, 'not_found');
    if (!u.transferred) return problem(409, 'upload_incomplete', 'нет PUT');
    if (body?.sha256 !== u.sha256) return problem(422, 'checksum_mismatch');
    u.completed = true;
    return {
      status: 202,
      body: {
        id: u.fileId,
        fileName: u.fileName,
        contentType: u.contentType,
        sizeBytes: u.sizeBytes,
        sha256: u.sha256,
        status: 'quarantined',
        createdAt: now(),
      },
    };
  },
  submitInspection: ({ state, me, body }) => {
    const bad = requireFields(body, [
      'checklistVersionId',
      'vehicleId',
      'kind',
      'odometerKm',
      'fuelPercent',
      'checks',
      'photos',
      'capturedAt',
    ]);
    if (bad) return bad;
    if (body.kind === 'departure' && !body.reservationId) return problem(422, 'validation_failed');
    if (body.kind === 'return' && !body.tripId) return problem(422, 'validation_failed');
    const files = new Set(
      [...state.uploads.values()].filter((u) => u.completed).map((u) => u.fileId),
    );
    if (!body.photos.every((p) => files.has(p.fileId))) {
      return problem(409, 'evidence_not_ready', 'фото не загружены');
    }
    const ins = {
      tenant: me.tenant,
      ...body,
      id: uuid(),
      memberId: me.memberId,
      status: 'submitted',
      submittedAt: now(),
      revision: 1,
    };
    state.inspections.push(ins);
    return { status: 201, body: strip(ins) };
  },
  listInspections: ({ state, me }) => page(state.inspections.filter((i) => i.tenant === me.tenant)),
  startTrip: ({ state, me, body }) => {
    const bad = requireFields(body, ['reservationId', 'departureInspectionId']);
    if (bad) return bad;
    const r = state.reservations.find((x) => x.tenant === me.tenant && x.id === body.reservationId);
    if (!r || r.state !== 'held') return problem(409, 'reservation_not_held');
    r.state = 'consumed';
    const trip = {
      tenant: me.tenant,
      id: uuid(),
      vehicleId: r.vehicleId,
      driverMemberId: me.memberId,
      orgUnitId: uuid(),
      departureInspectionId: body.departureInspectionId,
      status: 'in_progress',
      startedAt: now(),
      revision: 1,
    };
    state.trips.push(trip);
    return { status: 201, body: strip(trip), etag: etag(trip.revision) };
  },
  listTrips: ({ state, me }) => page(state.trips.filter((t) => t.tenant === me.tenant)),
  getTrip: ({ state, me, params }) => {
    const t = findTrip(state, me, params.tripId);
    return t ? { status: 200, body: strip(t), etag: etag(t.revision) } : problem(404, 'not_found');
  },
  returnTrip: ({ state, me, params, body, ifMatch }) => {
    const t = findTrip(state, me, params.tripId);
    if (!t) return problem(404, 'not_found');
    if (ifMatch !== etag(t.revision)) return problem(412, 'precondition_failed');
    if (body?.action !== 'return' || !body.returnInspectionId) {
      return problem(422, 'validation_failed');
    }
    Object.assign(t, {
      status: 'returned_pending_review',
      returnInspectionId: body.returnInspectionId,
      returnedAt: now(),
      revision: t.revision + 1,
    });
    return { status: 200, body: strip(t), etag: etag(t.revision) };
  },
  reviewTrip: ({ state, me, params, body, ifMatch }) => {
    const t = findTrip(state, me, params.tripId);
    if (!t) return problem(404, 'not_found');
    if (ifMatch !== etag(t.revision)) return problem(412, 'precondition_failed');
    if (!body?.decision) return problem(422, 'validation_failed');
    Object.assign(t, { status: 'approved', revision: t.revision + 1 });
    return { status: 200, body: strip(t), etag: etag(t.revision) };
  },
  listTripExpenses: ({ state, me, params }) =>
    findTrip(state, me, params.tripId)
      ? page(state.expenses.filter((e) => e.tenant === me.tenant && e.tripId === params.tripId))
      : problem(404, 'not_found'),
  createTripExpense: ({ state, me, params, body }) => {
    if (!findTrip(state, me, params.tripId)) return problem(404, 'not_found');
    const bad = requireFields(body, ['kind', 'occurredAt', 'amount', 'receiptFileIds']);
    if (bad) return bad;
    if (!Number.isInteger(body.amount.amountMinor)) return problem(422, 'validation_failed');
    const e = expenseOf(me.tenant, params.tripId, {
      kind: body.kind,
      amountMinor: body.amount.amountMinor,
      receiptFileIds: body.receiptFileIds,
    });
    state.expenses.push(e);
    return { status: 201, body: strip(e), etag: etag(e.revision) };
  },
  getTripExpense: ({ state, me, params }) => {
    const e = findExpense(state, me, params);
    return e ? { status: 200, body: strip(e), etag: etag(e.revision) } : problem(404, 'not_found');
  },
  reviewTripExpense: ({ state, me, params, body, ifMatch }) => {
    const e = findExpense(state, me, params);
    if (!e) return problem(404, 'not_found');
    if (ifMatch !== etag(e.revision)) return problem(412, 'precondition_failed');
    if (!body?.decision) return problem(422, 'validation_failed');
    Object.assign(e, { reviewState: 'approved', revision: e.revision + 1 });
    return { status: 200, body: strip(e), etag: etag(e.revision) };
  },
  listDatasets: () => ({
    status: 200,
    body: {
      items: [
        {
          id: 'fleet.trips',
          moduleKey: 'fleet',
          name: 'Рейсы',
          fields: ['id', 'vehicle', 'driver', 'startedAt', 'status'].map((key) => ({
            key,
            label: key,
            valueType: 'text',
            nullable: false,
            filterOperators: ['eq'],
            sortable: true,
            aggregatable: false,
            sensitivity: 'standard',
          })),
          allowedAggregations: ['count'],
          permissionVersion: '1',
        },
      ],
    },
  }),
  queryDataset: ({ body }) => {
    const bad = requireFields(body, ['select', 'filters', 'sort', 'limit']);
    if (bad) return bad;
    const n = Number(String(body.cursor ?? 'c0').slice(1)) + 1;
    return {
      status: 200,
      body: {
        rows: Array.from({ length: 3 }, (_, i) => ({
          recordId: `r${n}-${i}`,
          cells: body.select.map((fieldKey) => ({
            fieldKey,
            value: { type: 'text', value: `${fieldKey}-${i}` },
          })),
        })),
        nextCursor: `c${n}`,
        schemaVersion: '1',
      },
    };
  },
};

const page = (items) => ({ status: 200, body: { items: items.map(strip), nextCursor: null } });
const findTrip = (state, me, id) => state.trips.find((t) => t.tenant === me.tenant && t.id === id);
const findExpense = (state, me, { tripId, expenseId }) =>
  state.expenses.find((e) => e.tenant === me.tenant && e.tripId === tripId && e.id === expenseId);

function send(res, { status, body, etag: tag }, extra = {}) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Request-Id': uuid(), ...extra };
  if (tag) headers.ETag = tag;
  if (body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  headers['Content-Type'] =
    status >= 400 ? 'application/problem+json' : 'application/json; charset=utf-8';
  res.writeHead(status, headers).end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function personaTenant(persona) {
  if (persona.startsWith('load-pilot-')) return 'pilot';
  if (persona.startsWith('load-noisy-')) return 'noisy';
  return null;
}

async function handle(state, req, res) {
  const url = new URL(req.url, 'http://fake');
  const raw = await readBody(req);

  if (req.method === 'GET' && url.pathname === '/__stats') {
    return send(res, { status: 200, body: state.stats });
  }

  if (req.method === 'POST' && url.pathname === DEV_LOGIN_PATH) {
    const persona = JSON.parse(raw.toString('utf8') || '{}').persona ?? '';
    const tenant = personaTenant(persona);
    if (!tenant) return send(res, problem(401, 'unauthenticated', 'неизвестный персонаж'));
    if (!state.members.has(persona)) state.members.set(persona, { memberId: uuid(), tenant });
    const session = uuid();
    const csrf = uuid().replace(/-/g, '');
    state.sessions.set(session, { persona, csrf });
    count(state, persona, 'auth');
    return send(
      res,
      { status: 204 },
      {
        'Set-Cookie': [
          `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax`,
          `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax`,
        ],
      },
    );
  }

  const upload = url.pathname.match(/^\/_upload\/([^/]+)$/);
  if (upload && req.method === 'PUT') {
    const u = state.uploads.get(upload[1]);
    if (!u) return send(res, problem(404, 'not_found'));
    const sha = createHash('sha256').update(raw).digest('hex');
    if (sha !== u.sha256 || raw.length !== u.sizeBytes) {
      return send(res, problem(400, 'checksum_mismatch', `sha ${sha}, ${raw.length} байт`));
    }
    if (req.headers['content-type'] !== u.contentType) {
      return send(res, problem(400, 'content_type_mismatch'));
    }
    u.transferred = true;
    count(state, u.persona, 'transfer');
    return send(res, { status: 200 });
  }

  const route = ROUTES.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!route) return send(res, problem(404, 'not_found', `${req.method} ${url.pathname}`));

  const jar = cookies(req);
  const session = state.sessions.get(jar[SESSION_COOKIE]);
  if (!session) return send(res, problem(401, 'unauthenticated'));
  const { persona } = session;
  const me = state.members.get(persona);
  count(state, persona, route.opId);

  if (req.method !== 'GET') {
    if (req.headers['x-csrf-token'] !== session.csrf || !req.headers.origin) {
      return send(res, problem(403, 'csrf_failed'));
    }
  }
  const params = route.re.exec(url.pathname).groups ?? {};
  if (params.tenantId && params.tenantId !== state.tenants[me.tenant].id) {
    return send(res, problem(404, 'not_found'));
  }
  const idemKey = req.headers['idempotency-key'];
  if (route.spec.idempotent) {
    if (!idemKey) return send(res, problem(428, 'idempotency_key_required'));
    if (!IDEM_RE.test(idemKey)) return send(res, problem(400, 'bad_request', 'Idempotency-Key'));
    const replay = state.idem.get(`${persona}:${route.opId}:${idemKey}`);
    if (replay) return send(res, replay, { 'Idempotency-Replayed': 'true' });
  }
  const ifMatch = req.headers['if-match'];
  if (route.spec.ifMatch) {
    if (!ifMatch) return send(res, problem(428, 'precondition_required'));
    if (!ETAG_RE.test(ifMatch)) return send(res, problem(400, 'bad_request', 'If-Match'));
  }
  let body;
  if (raw.length) {
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(res, problem(400, 'bad_request', 'JSON'));
    }
  }
  const out = HANDLERS[route.opId]({
    state,
    me,
    persona,
    params,
    query: url.searchParams,
    body,
    ifMatch,
    host: req.headers.host,
  });
  if (route.spec.idempotent && out.status < 500) {
    state.idem.set(`${persona}:${route.opId}:${idemKey}`, out);
  }
  return send(res, out);
}

/**
 * Запускает двойник; возвращает { url, state, close }. pendingTrips — рейсов на приёмке в пилоте.
 * host по умолчанию 0.0.0.0: k6 в Docker ходит через host.docker.internal (host-gateway), и на
 * Linux это адрес моста, а не loopback. На время проверки двойник (с /__stats) виден в сети;
 * сузить — FAKE_API_HOST (127.0.0.1 для Docker Desktop, адрес моста docker0 для Linux).
 */
export function startFakeApi({
  port = 8108,
  host = process.env.FAKE_API_HOST ?? '0.0.0.0',
  pendingTrips = 1,
} = {}) {
  const state = seed({ pendingTrips });
  const server = createServer((req, res) => {
    handle(state, req, res).catch((err) => {
      send(res, problem(500, 'internal', String(err?.stack ?? err)));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () =>
      resolve({
        url: `http://127.0.0.1:${port}`,
        state,
        close: () => new Promise((done) => server.close(() => done())),
      }),
    );
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 8108);
  const api = await startFakeApi({ port });
  console.log(`API-двойник нагрузки: ${api.url} (GET /__stats)`);
}
