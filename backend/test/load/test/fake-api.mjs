// API-двойник для smoke-прогона k6 без стенда (W0.16 → W2.47). Не эталон поведения backend: отвечает формой
// схем контракта 0.5.1-stage2 и строго проверяет то, что обязан слать клиент нагрузки, — cookie сессии,
// X-CSRF-Token и Origin на изменениях, Idempotency-Key, If-Match (ETag рейс-плана), обязательные поля тел, правила
// этапа 2: бронь на рейс водителя, пять разных готовых фото осмотра, ровно один готовый чек, литры топлива,
// комментарий «прочего», переходы рейса planned → inspection → on_route → returning → submitted → accepted.
// Считает запросы по персонажу и operationId: GET /__stats.
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { EXPENSE_KINDS, OPS } from '../lib/model.js';

const SESSION_COOKIE = 'ortus_sid';
const CSRF_COOKIE = 'ortus_csrf';
const DEV_LOGIN_PATH = '/api/v1/dev/login';
const IDEM_RE = /^[A-Za-z0-9._:-]{16,128}$/;
const PHOTO_ROLES = ['front', 'rear', 'left', 'right', 'odometer'];
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const ROUTES = Object.entries(OPS).map(([opId, spec]) => ({
  opId,
  method: spec.method,
  spec,
  re: new RegExp(`^${spec.path.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)')}$`),
}));

const uuid = () => randomUUID();
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const etag = (rev) => `"${rev}"`;
const strip = ({ tenant, ...rest }) => (void tenant, rest);

function problem(status, code, detail) {
  return { status, body: { type: 'about:blank', title: code, status, code, detail } };
}

const ok = (body, rev) => ({ status: 200, body, ...(rev ? { etag: etag(rev) } : {}) });
const page = (items, nextCursor = null) => ({
  status: 200,
  body: { items: items.map(strip), nextCursor },
});

function personaTenant(persona) {
  if (persona.startsWith('load-pilot-')) return 'pilot';
  if (persona.startsWith('load-noisy-')) return 'noisy';
  return null;
}

function seed({ pendingTrips, drivers }) {
  const tenants = {
    pilot: { id: uuid(), name: 'Нагрузка · пилот', unit: uuid() },
    noisy: { id: uuid(), name: 'Нагрузка · шумный', unit: uuid() },
  };
  const state = {
    tenants,
    members: new Map(), // persona → member
    sessions: new Map(), // sid → { persona, csrf }
    vehicles: [],
    plans: [],
    reservations: [],
    inspections: [],
    expenses: [],
    uploads: new Map(),
    files: new Map(),
    idem: new Map(),
    stats: {},
    counter: 300,
  };
  for (const persona of drivers) member(state, persona, ['driver']);
  for (const tenant of ['pilot', 'noisy']) {
    for (let i = 1; i <= 3; i++) {
      state.vehicles.push({
        tenant,
        id: uuid(),
        orgUnitId: tenants[tenant].unit,
        registrationNumber: `А${100 + i}АА77`,
        displayName: `Газель ${i}`,
        bodyType: 'van',
        status: 'available',
        odometerKm: String(100000 + i * 1000),
        revision: 1,
      });
    }
  }
  // Смены на приёмке — по одной на итерацию менеджера в smoke: пять + пять фото и расход с чеком, как у
  // смены водителя, поэтому число запросов приёмки детерминировано, какую бы смену менеджер ни взял.
  for (let i = 0; i < pendingTrips; i++) {
    const p = plan(state, 'pilot', { driverMemberId: uuid(), state: 'submitted' });
    const v = state.vehicles.find((x) => x.tenant === 'pilot');
    p.vehicleId = v.id;
    for (const kind of ['departure', 'return']) {
      const ins = inspectionOf(state, 'pilot', p, {
        kind,
        vehicleId: v.id,
        photos: PHOTO_ROLES.map((role) => ({
          role,
          fileId: readyFile(state, 'pilot'),
          capturedAt: now(),
        })),
      });
      p[kind === 'departure' ? 'departureInspectionId' : 'returnInspectionId'] = ins.id;
    }
    state.expenses.push(
      expenseOf('pilot', p.id, {
        kind: 'wash',
        amountMinor: 50000,
        receiptFileIds: [readyFile(state, 'pilot')],
      }),
    );
  }
  const noisyOwnerTrip = plan(state, 'noisy', { driverMemberId: uuid(), state: 'on_route' });
  noisyOwnerTrip.title = 'Рейс шумного тенанта';
  return state;
}

function member(state, persona, workProfiles) {
  const tenant = personaTenant(persona);
  const m = {
    tenant,
    persona,
    id: uuid(),
    userId: uuid(),
    displayName: persona,
    email: `${persona}@load.example`,
    status: 'active',
    orgUnitIds: [state.tenants[tenant].unit],
    revision: 1,
    workProfiles,
  };
  state.members.set(persona, m);
  return m;
}

function plan(state, tenant, { driverMemberId, state: tripState, window, title, orgUnitId }) {
  state.counter += 1;
  const at = now();
  const p = {
    tenant,
    id: uuid(),
    number: `Р-${state.counter}`,
    title: title ?? 'Рейс на приёмке',
    orgUnitId: orgUnitId ?? state.tenants[tenant].unit,
    state: tripState,
    plannedWindow: window ?? { startsAt: at, endsAt: at, timeZone: 'Europe/Moscow' },
    cargo: { description: 'Груз', weightKg: '300', volumeM3: '2', lengthM: '1.2' },
    stops: [],
    driverMemberId,
    revision: 1,
  };
  state.plans.push(p);
  return p;
}

function readyFile(state, tenant) {
  const id = uuid();
  state.files.set(id, { tenant, id, status: 'ready', sizeBytes: 2048, contentType: 'image/jpeg' });
  return id;
}

function inspectionOf(
  state,
  tenant,
  p,
  { kind, vehicleId, photos, odometerKm = '100000', fuelPercent = 50 },
) {
  const ins = {
    tenant,
    id: uuid(),
    checklistVersionId: uuid(),
    vehicleId,
    memberId: p.driverMemberId,
    kind,
    status: 'submitted',
    odometerKm,
    fuelPercent,
    checks: [],
    photos,
    capturedAt: now(),
    submittedAt: now(),
    revision: 1,
    tripId: p.id,
  };
  state.inspections.push(ins);
  return ins;
}

function expenseOf(tenant, tripId, { kind, amountMinor, receiptFileIds, quantity, comment }) {
  return {
    tenant,
    id: uuid(),
    tripId,
    kind,
    occurredAt: now(),
    amount: { amountMinor, currency: 'RUB' },
    ...(quantity === undefined ? {} : { quantity }),
    ...(comment === undefined ? {} : { comment }),
    receiptFileIds,
    reviewState: 'pending',
    revision: 1,
  };
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

const isWindow = (w) =>
  w && /Z$/.test(w.startsAt ?? '') && /Z$/.test(w.endsAt ?? '') && Boolean(w.timeZone);
const findPlan = (state, me, id) => state.plans.find((p) => p.tenant === me.tenant && p.id === id);
const readyOf = (state, me, id) => {
  const f = state.files.get(id);
  return f && f.tenant === me.tenant && f.status === 'ready' ? f : null;
};

/** ETag рейс-плана: 428 без заголовка, 412 при чужой версии. */
function preconditionOf(p, ifMatch) {
  if (!ifMatch) return problem(428, 'precondition_required');
  if (ifMatch !== etag(p.revision)) return problem(412, 'revision_mismatch');
  return null;
}

function tripOf(p) {
  const status = {
    on_route: 'in_progress',
    returning: 'in_progress',
    submitted: 'returned_pending_review',
  };
  return {
    id: p.id,
    vehicleId: p.vehicleId,
    driverMemberId: p.driverMemberId,
    orgUnitId: p.orgUnitId,
    departureInspectionId: p.departureInspectionId,
    ...(p.returnInspectionId ? { returnInspectionId: p.returnInspectionId } : {}),
    status: status[p.state] ?? 'approved',
    startedAt: now(),
    revision: p.revision,
  };
}

/** Обработчики операций: (ctx) → { status, body, etag? }. */
const HANDLERS = {
  getMyContext: ({ state, me, persona }) =>
    ok({
      userId: me.userId,
      displayName: persona,
      platformOperator: false,
      tenants: [
        {
          tenantId: state.tenants[me.tenant].id,
          name: state.tenants[me.tenant].name,
          membershipId: uuid(),
          membershipStatus: 'active',
          orgUnitIds: me.orgUnitIds,
          modules: [],
          capabilities: [],
        },
      ],
      permissionVersion: '1',
    }),
  listMembers: ({ state, me }) =>
    page(
      [...state.members.values()]
        .filter((m) => m.tenant === me.tenant)
        .map(({ persona, ...m }) => (void persona, m)),
    ),
  createTripPlan: ({ state, me, body }) => {
    const bad = requireFields(body, ['orgUnitId', 'title', 'plannedWindow', 'cargo', 'stops']);
    if (bad) return bad;
    if (!isWindow(body.plannedWindow)) return problem(422, 'validation_failed', 'plannedWindow');
    if (!Array.isArray(body.stops) || body.stops.length < 1)
      return problem(422, 'validation_failed', 'stops');
    for (const s of body.stops) {
      if (requireFields(s, ['sequence', 'op', 'address', 'weightKg', 'volumeM3'])) {
        return problem(422, 'validation_failed', 'stop');
      }
    }
    const driver = [...state.members.values()].find(
      (m) => m.tenant === me.tenant && m.id === body.driverMemberId,
    );
    if (!driver || !driver.workProfiles.includes('driver'))
      return problem(422, 'validation_failed', 'driverMemberId');
    const p = plan(state, me.tenant, {
      driverMemberId: driver.id,
      state: 'planned',
      window: body.plannedWindow,
      title: body.title,
      orgUnitId: body.orgUnitId,
    });
    Object.assign(p, {
      cargo: body.cargo,
      stops: body.stops,
      driverDisplayName: driver.displayName,
    });
    return { status: 201, body: strip(p), etag: etag(p.revision) };
  },
  listTripPlans: ({ state, me, query }) => {
    const states = query.getAll('state');
    const driver = me.workProfiles.includes('driver');
    const items = state.plans
      .filter((p) => p.tenant === me.tenant)
      .filter((p) => !driver || p.driverMemberId === me.id)
      .filter((p) => !states.length || states.includes(p.state))
      .sort((a, b) => a.plannedWindow.startsAt.localeCompare(b.plannedWindow.startsAt));
    const limit = Number(query.get('limit') ?? 50);
    if (!(limit >= 1 && limit <= 200)) return problem(400, 'malformed_request', 'limit');
    // Шумный тенант выгружает рейсы постранично: у двойника страницы не кончаются.
    const n = Number(String(query.get('cursor') ?? 'c0').slice(1)) + 1;
    return page(items.slice(0, limit), me.tenant === 'noisy' ? `c${n}` : null);
  },
  getTripPlan: ({ state, me, params }) => {
    const p = findPlan(state, me, params.tripId);
    return p ? ok(strip(p), p.revision) : problem(404, 'not_found');
  },
  listVehicles: ({ state, me }) => page(state.vehicles.filter((v) => v.tenant === me.tenant)),
  reserveVehicle: ({ state, me, body }) => {
    const bad = requireFields(body, ['vehicleId', 'driverMemberId', 'window', 'tripId']);
    if (bad) return bad;
    if (!isWindow(body.window)) return problem(422, 'validation_failed', 'window');
    const p = findPlan(state, me, body.tripId);
    if (!p || p.state !== 'planned')
      return problem(409, 'invalid_transition', 'рейс не в планировании');
    if (body.driverMemberId !== p.driverMemberId || me.id !== p.driverMemberId) {
      return problem(403, 'forbidden_action', 'бронь — только на свой рейс');
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
      tripId: p.id,
    };
    state.reservations.push(r);
    Object.assign(p, {
      state: 'inspection',
      vehicleId: v.id,
      reservationId: r.id,
      revision: p.revision + 1,
    });
    return { status: 201, body: strip(r), etag: etag(1) };
  },
  getInspectionChecklist: ({ query }) => {
    if (!query.get('vehicleId') || !['departure', 'return'].includes(query.get('kind'))) {
      return problem(422, 'validation_failed', 'vehicleId, kind');
    }
    return ok({
      versionId: uuid(),
      kind: query.get('kind'),
      items: [
        { key: 'body', label: 'Кузов', required: true, failureBlocksRelease: true },
        { key: 'tires', label: 'Шины', required: true, failureBlocksRelease: true },
      ],
      requiredPhotoRoles: PHOTO_ROLES,
    });
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
    if (body.contentType !== 'image/jpeg') return problem(422, 'validation_failed', 'contentType');
    const o = body.owner;
    if (o.moduleKey !== 'fleet' || o.entityType !== 'trip' || !findPlan(state, me, o.entityId)) {
      return problem(422, 'validation_failed', 'owner');
    }
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
    // Проверка содержимого идёт асинхронно: файл готов к первому опросу getFile.
    state.files.set(u.fileId, {
      tenant: u.tenant,
      id: u.fileId,
      status: 'quarantined',
      sizeBytes: u.sizeBytes,
      contentType: u.contentType,
    });
    return { status: 202, body: fileBody(state.files.get(u.fileId), u.fileName) };
  },
  getFile: ({ state, me, params }) => {
    const f = state.files.get(params.fileId);
    if (!f || f.tenant !== me.tenant) return problem(404, 'not_found');
    f.status = 'ready';
    return ok(fileBody(f, 'photo.jpg'));
  },
  getFileDownload: ({ state, me, persona, params, host }) => {
    const f = readyOf(state, me, params.fileId);
    if (!f) return problem(409, 'photo_not_ready');
    return ok({
      fileId: f.id,
      downloadUrl: `http://${host}/_download/${f.id}?p=${encodeURIComponent(persona)}`,
      expiresAt: now(),
    });
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
    let p;
    if (body.kind === 'departure') {
      const r = state.reservations.find(
        (x) => x.tenant === me.tenant && x.id === body.reservationId,
      );
      if (!r || r.state !== 'held') return problem(409, 'invalid_transition', 'нет брони');
      p = findPlan(state, me, r.tripId);
      if (!p || p.state !== 'inspection') return problem(409, 'invalid_transition');
    } else if (body.kind === 'return') {
      p = findPlan(state, me, body.tripId);
      if (!p || p.state !== 'returning')
        return problem(409, 'invalid_transition', 'рейс не завершён');
    } else {
      return problem(422, 'validation_failed', 'kind');
    }
    const ids = body.photos.map((x) => x.fileId);
    const roles = new Set(body.photos.map((x) => x.role));
    if (
      ids.length !== PHOTO_ROLES.length ||
      new Set(ids).size !== ids.length ||
      roles.size !== PHOTO_ROLES.length
    ) {
      return problem(422, 'inspection_incomplete', 'пять разных фото пяти ракурсов');
    }
    if (!ids.every((id) => readyOf(state, me, id))) return problem(409, 'photo_not_ready');
    const ins = inspectionOf(state, me.tenant, p, body);
    if (body.kind === 'departure') p.departureInspectionId = ins.id;
    else p.returnInspectionId = ins.id;
    p.revision += 1;
    return { status: 201, body: strip(ins) };
  },
  getInspection: ({ state, me, params }) => {
    const ins = state.inspections.find(
      (x) => x.tenant === me.tenant && x.id === params.inspectionId,
    );
    return ins ? ok(strip(ins), ins.revision) : problem(404, 'not_found');
  },
  listInspectionDefects: () => page([]),
  startTrip: ({ state, me, body }) => {
    const bad = requireFields(body, ['reservationId', 'departureInspectionId']);
    if (bad) return bad;
    const r = state.reservations.find((x) => x.tenant === me.tenant && x.id === body.reservationId);
    if (!r || r.state !== 'held') return problem(409, 'invalid_transition', 'бронь не удержана');
    const p = findPlan(state, me, r.tripId);
    if (!p || p.departureInspectionId !== body.departureInspectionId) {
      return problem(409, 'invalid_transition', 'нет осмотра выезда');
    }
    r.state = 'consumed';
    Object.assign(p, { state: 'on_route', revision: p.revision + 1 });
    return { status: 201, body: tripOf(p), etag: etag(p.revision) };
  },
  createTripExpense: ({ state, me, params, body }) => {
    const p = findPlan(state, me, params.tripId);
    if (!p) return problem(404, 'not_found');
    if (!['on_route', 'returning'].includes(p.state) || p.driverMemberId !== me.id) {
      return problem(409, 'invalid_transition', 'расходы — в рейсе и при сдаче');
    }
    const bad = requireFields(body, ['kind', 'occurredAt', 'amount', 'receiptFileIds']);
    if (bad) return bad;
    if (!EXPENSE_KINDS.includes(body.kind)) return problem(422, 'validation_failed', 'kind');
    if (!Number.isInteger(body.amount.amountMinor) || body.amount.amountMinor <= 0) {
      return problem(422, 'amount_invalid');
    }
    if (body.amount.currency !== 'RUB') return problem(422, 'validation_failed', 'currency');
    if (body.kind === 'other' && !body.comment?.trim()) {
      return problem(422, 'validation_failed', 'Для категории «Прочее» добавьте комментарий');
    }
    if (body.kind === 'fuel' && !body.quantity) return problem(422, 'validation_failed', 'литры');
    if (body.receiptFileIds.length !== 1)
      return problem(422, 'validation_failed', 'Один чек на расход.');
    if (!readyOf(state, me, body.receiptFileIds[0])) return problem(409, 'photo_not_ready');
    const e = expenseOf(me.tenant, p.id, {
      kind: body.kind,
      amountMinor: body.amount.amountMinor,
      receiptFileIds: body.receiptFileIds,
      quantity: body.quantity,
      comment: body.comment,
    });
    state.expenses.push(e);
    return { status: 201, body: strip(e), etag: etag(e.revision) };
  },
  listTripExpenses: ({ state, me, params }) =>
    findPlan(state, me, params.tripId)
      ? page(state.expenses.filter((e) => e.tenant === me.tenant && e.tripId === params.tripId))
      : problem(404, 'not_found'),
  finishTripRoute: ({ state, me, params, ifMatch }) => {
    const p = findPlan(state, me, params.tripId);
    if (!p) return problem(404, 'not_found');
    const pre = preconditionOf(p, ifMatch);
    if (pre) return pre;
    if (p.state !== 'on_route') return problem(409, 'invalid_transition');
    Object.assign(p, { state: 'returning', revision: p.revision + 1 });
    return ok(strip(p), p.revision);
  },
  returnTrip: ({ state, me, params, body, ifMatch }) => {
    const p = findPlan(state, me, params.tripId);
    if (!p) return problem(404, 'not_found');
    const pre = preconditionOf(p, ifMatch);
    if (pre) return pre;
    if (body?.action !== 'return' || body.returnInspectionId !== p.returnInspectionId) {
      return problem(422, 'validation_failed', 'нет осмотра при сдаче');
    }
    if (p.state !== 'returning') return problem(409, 'invalid_transition');
    Object.assign(p, { state: 'submitted', revision: p.revision + 1 });
    return ok(tripOf(p), p.revision);
  },
  reviewTrip: ({ state, me, params, body, ifMatch }) => {
    const p = findPlan(state, me, params.tripId);
    if (!p) return problem(404, 'not_found');
    if (p.driverMemberId === me.id) return problem(403, 'forbidden_action', 'самоприёмка');
    const pre = preconditionOf(p, ifMatch);
    if (pre) return pre;
    if (!body?.decision) return problem(422, 'validation_failed');
    if (p.state !== 'submitted') return problem(409, 'invalid_transition', 'Смена уже обработана');
    Object.assign(p, { state: 'accepted', revision: p.revision + 1 });
    const v = state.vehicles.find((x) => x.id === p.vehicleId);
    if (v) v.status = 'available';
    return ok(tripOf(p), p.revision);
  },
};

function fileBody(f, fileName) {
  return {
    id: f.id,
    fileName,
    contentType: f.contentType,
    sizeBytes: f.sizeBytes,
    status: f.status,
    createdAt: now(),
  };
}

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

function login(state, raw, res) {
  const persona = JSON.parse(raw.toString('utf8') || '{}').persona ?? '';
  if (!personaTenant(persona))
    return send(res, problem(401, 'session_expired', 'неизвестный персонаж'));
  if (!state.members.has(persona)) member(state, persona, []);
  const sid = uuid();
  const csrf = uuid().replace(/-/g, '');
  state.sessions.set(sid, { persona, csrf });
  count(state, persona, 'auth');
  return send(
    res,
    { status: 200, body: { userId: state.members.get(persona).userId, csrfToken: csrf } },
    {
      'Set-Cookie': [
        `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax`,
        `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax`,
      ],
    },
  );
}

function transfer(state, req, res, url, raw) {
  const upload = url.pathname.match(/^\/_upload\/([^/]+)$/);
  if (upload && req.method === 'PUT') {
    const u = state.uploads.get(upload[1]);
    if (!u) return send(res, problem(404, 'not_found'));
    const sha = createHash('sha256').update(raw).digest('hex');
    if (sha !== u.sha256 || raw.length !== u.sizeBytes) {
      return send(res, problem(400, 'checksum_mismatch', `sha ${sha}, ${raw.length} байт`));
    }
    if (req.headers['content-type'] !== u.contentType)
      return send(res, problem(400, 'content_type_mismatch'));
    if (!raw.subarray(0, 3).equals(JPEG_MAGIC))
      return send(res, problem(400, 'mime_mismatch', 'не JPEG'));
    u.transferred = true;
    count(state, u.persona, 'transfer');
    return send(res, { status: 200 });
  }
  const download = url.pathname.match(/^\/_download\/([^/]+)$/);
  if (download && req.method === 'GET') {
    if (!state.files.has(download[1])) return send(res, problem(404, 'not_found'));
    count(state, url.searchParams.get('p') ?? '?', 'transfer');
    res
      .writeHead(200, { 'Content-Type': 'image/jpeg' })
      .end(Buffer.concat([JPEG_MAGIC, Buffer.alloc(61)]));
    return true;
  }
  return false;
}

async function handle(state, req, res) {
  const url = new URL(req.url, 'http://fake');
  const raw = await readBody(req);

  if (req.method === 'GET' && url.pathname === '/__stats')
    return send(res, { status: 200, body: state.stats });
  if (req.method === 'POST' && url.pathname === DEV_LOGIN_PATH) return login(state, raw, res);
  if (transfer(state, req, res, url, raw) !== false) return undefined;

  const route = ROUTES.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!route) return send(res, problem(404, 'not_found', `${req.method} ${url.pathname}`));

  const session = state.sessions.get(cookies(req)[SESSION_COOKIE]);
  if (!session) return send(res, problem(401, 'session_expired'));
  const { persona } = session;
  const me = state.members.get(persona);
  count(state, persona, route.opId);

  if (
    req.method !== 'GET' &&
    (req.headers['x-csrf-token'] !== session.csrf || !req.headers.origin)
  ) {
    return send(res, problem(403, 'csrf_failed'));
  }
  const params = route.re.exec(url.pathname).groups ?? {};
  if (params.tenantId && params.tenantId !== state.tenants[me.tenant].id)
    return send(res, problem(404, 'not_found'));
  const idemKey = req.headers['idempotency-key'];
  if (route.spec.idempotent) {
    if (!idemKey) return send(res, problem(428, 'idempotency_key_required'));
    if (!IDEM_RE.test(idemKey))
      return send(res, problem(400, 'malformed_request', 'Idempotency-Key'));
    const replay = state.idem.get(`${persona}:${route.opId}:${idemKey}`);
    if (replay) return send(res, replay, { 'Idempotency-Replayed': 'true' });
  }
  if (route.spec.ifMatch && !req.headers['if-match'])
    return send(res, problem(428, 'precondition_required'));
  let body;
  if (raw.length) {
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(res, problem(400, 'malformed_request', 'JSON'));
    }
  }
  const out = HANDLERS[route.opId]({
    state,
    me,
    persona,
    params,
    query: url.searchParams,
    body,
    ifMatch: req.headers['if-match'],
    host: req.headers.host,
  });
  if (route.spec.idempotent && out.status < 500)
    state.idem.set(`${persona}:${route.opId}:${idemKey}`, out);
  return send(res, out);
}

/**
 * Запускает двойник; возвращает { url, state, close }. pendingTrips — смен на приёмке в пилоте, drivers —
 * персонажи водителей (участники с профилем «Водитель», для них планирует setup()).
 * host по умолчанию 0.0.0.0: k6 в Docker ходит через host.docker.internal (host-gateway), и на
 * Linux это адрес моста, а не loopback. На время проверки двойник (с /__stats) виден в сети;
 * сузить — FAKE_API_HOST (127.0.0.1 для Docker Desktop, адрес моста docker0 для Linux).
 */
export function startFakeApi({
  port = 8108,
  host = process.env.FAKE_API_HOST ?? '0.0.0.0',
  pendingTrips = 1,
  drivers = ['load-pilot-driver-001'],
} = {}) {
  const state = seed({ pendingTrips, drivers });
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
  const api = await startFakeApi({
    port,
    drivers: ['load-pilot-driver-001', 'load-pilot-driver-002'],
  });
  console.log(`API-двойник нагрузки: ${api.url} (GET /__stats)`);
}
