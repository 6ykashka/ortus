// Кейсы стюарда контракта этапа 2, часть 2 (W2.52, 0.6.1-stage2) — ответы владельца продукта 17.10: справочник
// категорий расходов тенанта (D-12 комплекта), история и перемещение машины (модель данных п. 2), антифрод фото и
// серверное время (п. 4), чек-лист в формате формы (D-30 комплекта), поля задачи у дефекта (D-29 комплекта),
// заменители интеграций D-11 комплекта: импорт CSV машин, выгрузка CSV наборов, адрес остановки для навигатора.
// Примеры — tools/gen/examples-w252.mjs.
import { expect } from 'vitest';

import type { Reply, Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

const NOW = '2026-10-01T07:30:00Z';
const MSK = 'Europe/Moscow';
const ROLES = ['front', 'rear', 'left', 'right', 'odometer'] as const;
const W208 = { startsAt: '2026-10-01T06:00:00Z', endsAt: '2026-10-01T10:00:00Z', timeZone: MSK };
const SHA = (n: number) => n.toString(16).padStart(64, '0');

type Body = Record<string, unknown> & {
  items?: Record<string, unknown>[];
  id?: string;
  revision?: number;
  rows?: Record<string, unknown>[];
  photos?: Record<string, unknown>[];
};
const body = (r: Reply): Body => r.body as Body;

interface OrgState {
  files: {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    status: string;
    createdAt: string;
  }[];
  roles: { proto: string; permissions: string[] }[];
}
const alta = (ctx: CaseContext) => ctx.server.state().orgs[ctx.P('t-alta')] as unknown as OrgState;

/** Готовые файлы организации; `sha` — свой sha256 каждому файлу (по умолчанию — разные). */
function readyFiles(
  ctx: CaseContext,
  prefix: string,
  n: number,
  o: { sha?: string; status?: string } = {},
) {
  const org = alta(ctx);
  return Array.from({ length: n }, (_, i) => {
    const seq = org.files.length + 1;
    const id = `5e2a7c10-0000-4000-8000-${String(seq).padStart(12, '0')}`;
    org.files.push({
      id,
      fileName: `${prefix}-${i + 1}.jpg`,
      contentType: 'image/jpeg',
      sizeBytes: 2457600,
      sha256: o.sha ?? SHA(0xa000 + seq),
      status: o.status ?? 'ready',
      createdAt: NOW,
    });
    return id;
  });
}

async function ready(ctx: CaseContext) {
  ctx.server.applyPreset('logistics-ready');
  return {
    owner: await ctx.as('owner'),
    driver: await ctx.as('driver'),
    manager: await ctx.as('manager'),
  };
}

const cats = (ctx: CaseContext) => `${ctx.alta}/fleet/expense-categories`;
const assignments = (ctx: CaseContext, v: string) =>
  `${ctx.alta}/fleet/vehicles/${ctx.A(v)}/assignments`;
const imports = (ctx: CaseContext) => `${ctx.alta}/fleet/vehicle-imports`;
const exportUrl = (ctx: CaseContext, id: string) => `${ctx.alta}/datasets/${id}/export`;
const tripUrl = (ctx: CaseContext, trip = 'Р-208') => `${ctx.alta}/fleet/trips/${ctx.A(trip)}`;

async function reserve(ctx: CaseContext, driver: Session): Promise<string> {
  const r = await driver.post(`${ctx.alta}/fleet/reservations`, {
    vehicleId: ctx.A('v1'),
    driverMemberId: ctx.A('m-vasiliev'),
    window: W208,
    tripId: ctx.A('Р-208'),
  });
  return body(r).id as string;
}

async function checklist(ctx: CaseContext, driver: Session, kind: 'departure' | 'return') {
  return body(
    await driver.get(
      `${ctx.alta}/fleet/inspection-checklist?vehicleId=${ctx.A('v1')}&kind=${kind}`,
    ),
  );
}

/** Осмотр выезда Р-208 по брони с фото `files` (пять ролей); `extra` — поля тела. */
async function departure(
  ctx: CaseContext,
  driver: Session,
  files: string[],
  extra: Record<string, unknown> = {},
): Promise<Reply> {
  const reservationId = await reserve(ctx, driver);
  const list = await checklist(ctx, driver, 'departure');
  return driver.post(`${ctx.alta}/fleet/inspections`, {
    checklistVersionId: list.versionId,
    vehicleId: ctx.A('v1'),
    reservationId,
    kind: 'departure',
    odometerKm: '84500',
    fuelPercent: 50,
    checks: ((list.items ?? []) as { key: string }[]).map((i) => ({ key: i.key, result: 'pass' })),
    photos: ROLES.map((role, i) => ({ role, fileId: files[i], capturedAt: NOW })),
    capturedAt: NOW,
    ...extra,
  });
}

/** Смена Р-208 «В рейсе»: бронь, осмотр выезда, старт. */
async function onRoute(ctx: CaseContext, driver: Session) {
  const insp = body(await departure(ctx, driver, readyFiles(ctx, 'dep', ROLES.length)));
  const plan = body(await driver.get(`${ctx.alta}/fleet/trip-plans/${ctx.A('Р-208')}`));
  await driver.post(`${ctx.alta}/fleet/trips`, {
    reservationId: plan.reservationId,
    departureInspectionId: insp.id,
  });
}

/** Расход рейса Р-208 с чеком. */
async function expense(ctx: CaseContext, driver: Session, kind: string, comment?: string) {
  const [receipt] = readyFiles(ctx, 'receipt', 1);
  return driver.post(`${tripUrl(ctx)}/expenses`, {
    kind,
    occurredAt: NOW,
    amount: { amountMinor: 50000, currency: 'RUB' },
    receiptFileIds: [receipt],
    ...(comment ? { comment } : {}),
  });
}

/** Критический дефект «Стёкла: Скол» на осмотре выезда Р-208 — в очереди менеджера. */
async function blockingDefect(ctx: CaseContext, driver: Session): Promise<string> {
  const insp = body(
    await departure(ctx, driver, readyFiles(ctx, 'dep', ROLES.length), {
      defects: [{ zone: 'Стёкла', description: 'Скол', severity: 'blocking' }],
    }),
  );
  return ((insp.defects as { id: string }[])[0] as { id: string }).id;
}

const CSV = [
  'registration_number;display_name;body_type;payload_kg;volume_m3;cargo_length_m;cargo_width_m;cargo_height_m;odometer_km;depot',
  'Х 101 АМ 77;Ford Transit Custom;Фургон;1200;10;3,2;1,8;1,9;15000;Склад № 1',
  'А 412 МР 77;ГАЗель Next;Тент;1500;16;4,2;2;2;84370;Склад № 1',
  'В 999 ТТ 77;Самосвал;Самосвал;5000;10;4;2;2;100;',
].join('\n');

async function preview(ctx: CaseContext, owner: Session, csv = CSV): Promise<Reply> {
  return owner.post(imports(ctx), {
    fileName: 'mashiny.csv',
    csv,
    defaultOrgUnitId: ctx.A('f-msk-sever'),
  });
}

export const stage2bCases = cases('stage2b')([
  // Справочник категорий расходов (D-12 комплекта, W2.41).
  {
    title: 'владелец видит шесть категорий посева',
    operationId: 'listExpenseCategories',
    expect: 'success',
    example: 'listExpenseCategories/ok',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      ctx.expectExample(await owner.get(cats(ctx)), 'listExpenseCategories/ok');
    },
  },
  {
    title: 'водитель видит активные категории; архивные — только с includeArchived',
    operationId: 'listExpenseCategories',
    expect: 'success',
    run: async (ctx) => {
      const { owner, driver } = await ready(ctx);
      await owner.post(`${cats(ctx)}/toll/archive`, undefined, { ifMatch: 1 });
      const active = body(await driver.get(cats(ctx))).items?.map((c) => c.code);
      expect(active).toEqual(['fuel', 'wash', 'parking', 'tire_service', 'other']);
      const all = body(await driver.get(`${cats(ctx)}?includeArchived=true`)).items;
      expect(all?.find((c) => c.code === 'toll')?.state).toBe('archived');
    },
  },
  {
    title: 'без права на расходы — 403',
    operationId: 'listExpenseCategories',
    expect: 'error',
    example: 'listExpenseCategories/forbidden_action',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const therapist = await ctx.as('acc-4');
      ctx.expectExample(await therapist.get(cats(ctx)), 'listExpenseCategories/forbidden_action');
    },
  },
  {
    title: 'владелец добавляет «Ремни и стяжки» — код custom_1',
    operationId: 'createExpenseCategory',
    expect: 'success',
    example: 'createExpenseCategory/ok',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      const r = await owner.post(cats(ctx), { label: 'Ремни и стяжки', commentRequired: false });
      ctx.expectExample(r, 'createExpenseCategory/ok', 201);
      expect(r.headers.get('ETag')).toBe('"rev-1"');
    },
  },
  {
    title: 'категория со своим кодом и обязательным комментарием — в расходе водителя и в «Данных»',
    operationId: 'createExpenseCategory',
    expect: 'success',
    run: async (ctx) => {
      const { owner, driver, manager } = await ready(ctx);
      const r = await owner.post(cats(ctx), {
        label: 'Стоянка на ночь',
        commentRequired: true,
        code: 'night_parking',
      });
      expect(r.status).toBe(201);
      expect(body(r).code).toBe('night_parking');
      await onRoute(ctx, driver);
      const bare = await expense(ctx, driver, 'night_parking');
      ctx.expectProblem(bare, 'validation_failed');
      expect(body(bare).violations).toEqual([
        {
          field: 'comment',
          code: 'required',
          message: 'Для категории «Стоянка на ночь» добавьте комментарий',
        },
      ]);
      const ok = await expense(ctx, driver, 'night_parking', 'Охраняемая стоянка, Химки');
      expect(ok.status).toBe(201);
      expect(body(ok).kind).toBe('night_parking');
      const ds = body(await manager.get(`${ctx.alta}/datasets`)).items?.find(
        (d) => d.id === 'fleet.expenses',
      ) as { fields: { key: string; options?: { key: string; label: string }[] }[] };
      const kind = ds.fields.find((f) => f.key === 'kind');
      expect(kind?.options?.at(-1)).toEqual({ key: 'night_parking', label: 'Стоянка на ночь' });
    },
  },
  {
    title: '«Мойка» второй раз (без учёта регистра) — 422 duplicate',
    operationId: 'createExpenseCategory',
    expect: 'error',
    example: 'createExpenseCategory/validation_failed',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      ctx.expectExample(
        await owner.post(cats(ctx), { label: ' мойка ', commentRequired: false }),
        'createExpenseCategory/validation_failed',
      );
      const code = await owner.post(cats(ctx), {
        label: 'Новая',
        commentRequired: false,
        code: 'fuel',
      });
      ctx.expectProblem(code, 'validation_failed');
      expect(body(code).violations).toEqual([
        { field: 'code', code: 'duplicate', message: 'Такая категория уже есть' },
      ]);
    },
  },
  {
    title: 'менеджер логистики без права настроек модуля — 403',
    operationId: 'createExpenseCategory',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectProblem(
        await manager.post(cats(ctx), { label: 'Ремни', commentRequired: false }),
        'forbidden_action',
      );
    },
  },
  {
    title: 'владелец архивирует «Платная дорога»: новый расход с ней — 422, старые сохраняются',
    operationId: 'archiveExpenseCategory',
    expect: 'success',
    example: 'archiveExpenseCategory/ok',
    run: async (ctx) => {
      const { owner, driver } = await ready(ctx);
      await onRoute(ctx, driver);
      expect((await expense(ctx, driver, 'toll')).status).toBe(201);
      ctx.expectExample(
        await owner.post(`${cats(ctx)}/toll/archive`, undefined, { ifMatch: 1 }),
        'archiveExpenseCategory/ok',
      );
      const r = await expense(ctx, driver, 'toll');
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).violations).toEqual([
        {
          field: 'kind',
          code: 'archived_category',
          message: 'Категория в архиве — выберите другую',
        },
      ]);
      const unknown = await expense(ctx, driver, 'fine');
      ctx.expectProblem(unknown, 'validation_failed');
      expect((body(unknown).violations as { code: string }[])[0]?.code).toBe('unknown_category');
      const list = body(await driver.get(`${tripUrl(ctx)}/expenses`)).items;
      expect(list?.map((x) => x.kind)).toEqual(['toll']);
    },
  },
  {
    title: '«Прочее» не архивируется — 409',
    operationId: 'archiveExpenseCategory',
    expect: 'error',
    example: 'archiveExpenseCategory/invalid_transition',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      ctx.expectExample(
        await owner.post(`${cats(ctx)}/other/archive`, undefined, { ifMatch: 1 }),
        'archiveExpenseCategory/invalid_transition',
      );
      await owner.post(`${cats(ctx)}/wash/archive`, undefined, { ifMatch: 1 });
      ctx.expectProblem(
        await owner.post(`${cats(ctx)}/wash/archive`, undefined, { ifMatch: 2 }),
        'invalid_transition',
      );
      ctx.expectProblem(
        await owner.post(`${cats(ctx)}/nope/archive`, undefined, { ifMatch: 1 }),
        'not_found',
      );
      ctx.expectProblem(await owner.post(`${cats(ctx)}/parking/archive`), 'revision_required');
    },
  },

  // История машины (модель данных п. 2, W2.42).
  {
    title: 'Котова видит историю ГАЗели: одна фирма с 01.09',
    operationId: 'listVehicleAssignments',
    expect: 'success',
    example: 'listVehicleAssignments/ok',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(await manager.get(assignments(ctx, 'v1')), 'listVehicleAssignments/ok');
    },
  },
  {
    title: 'машина чужой фирмы — 404, как несуществующая',
    operationId: 'listVehicleAssignments',
    expect: 'error',
    example: 'listVehicleAssignments/not_found',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.get(assignments(ctx, 'v5')),
        'listVehicleAssignments/not_found',
      );
    },
  },
  {
    title:
      'владелец переводит Sprinter в «Юг Транс»: история из двух периодов, Котова машину не видит',
    operationId: 'moveVehicle',
    expect: 'success',
    example: 'moveVehicle/ok',
    run: async (ctx) => {
      const { owner, manager } = await ready(ctx);
      const r = await owner.post(
        assignments(ctx, 'v6'),
        { orgUnitId: ctx.A('f-msk-yug'), reason: 'Перевод в фирму Юг Транс' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'moveVehicle/ok');
      expect(r.headers.get('ETag')).toBe('"rev-2"');
      const history = body(await owner.get(assignments(ctx, 'v6'))).items;
      expect(history?.map((p) => [p.orgUnitName, p.validTo])).toEqual([
        ['Юг Транс', null],
        ['Север Логистик', NOW],
      ]);
      expect(history?.[0]?.reason).toBe('Перевод в фирму Юг Транс');
      ctx.expectProblem(await manager.get(assignments(ctx, 'v6')), 'not_found');
    },
  },
  {
    title:
      'та же фирма — 422 same_unit; машина в рейсе — 409; невидимая фирма — 422; водитель — 403',
    operationId: 'moveVehicle',
    expect: 'error',
    example: 'moveVehicle/validation_failed',
    run: async (ctx) => {
      const { owner, manager, driver } = await ready(ctx);
      ctx.expectExample(
        await owner.post(
          assignments(ctx, 'v1'),
          { orgUnitId: ctx.A('f-msk-sever'), reason: 'Ошибка' },
          { ifMatch: 1 },
        ),
        'moveVehicle/validation_failed',
      );
      ctx.expectProblem(
        await owner.post(
          assignments(ctx, 'v7'),
          { orgUnitId: ctx.A('f-msk-sever'), reason: 'Перевод' },
          { ifMatch: 1 },
        ),
        'resources_unavailable',
      );
      // «Юг Транс» вне области Котовой — как несуществующая фирма (AC-01).
      const hidden = await manager.post(
        assignments(ctx, 'v1'),
        { orgUnitId: ctx.A('f-msk-yug'), reason: 'Перевод' },
        { ifMatch: 1 },
      );
      ctx.expectProblem(hidden, 'validation_failed');
      expect(body(hidden).violations).toEqual([
        { field: 'orgUnitId', code: 'unknown', message: 'Подразделение не найдено' },
      ]);
      ctx.expectProblem(
        await driver.post(
          assignments(ctx, 'v1'),
          { orgUnitId: ctx.A('f-msk-yug'), reason: 'Перевод' },
          { ifMatch: 1 },
        ),
        'forbidden_action',
      );
    },
  },

  // Чек-лист — форма (D-30 комплекта, W2.45); осмотр — серверное время и повтор фото (W2.43).
  {
    title: 'чек-лист выезда несёт определение формы FormDefinition',
    operationId: 'getInspectionChecklist',
    expect: 'success',
    example: 'getInspectionChecklist/ok',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      ctx.expectExample(
        await driver.get(
          `${ctx.alta}/fleet/inspection-checklist?vehicleId=${ctx.A('v1')}&kind=departure`,
        ),
        'getInspectionChecklist/ok',
      );
      const ret = await checklist(ctx, driver, 'return');
      expect((ret.definition as { title: string }).title).toBe('Осмотр при сдаче');
    },
  },
  {
    title: 'чек-лист неизвестной машины — 404',
    operationId: 'getInspectionChecklist',
    expect: 'error',
    example: 'getInspectionChecklist/not_found',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      ctx.expectExample(
        await driver.get(
          `${ctx.alta}/fleet/inspection-checklist?vehicleId=00000000-0000-5000-8000-000000000000&kind=departure`,
        ),
        'getInspectionChecklist/not_found',
      );
    },
  },
  {
    title: 'осмотр выезда Р-208: у фото серверное время, повторов нет',
    operationId: 'submitInspection',
    expect: 'success',
    example: 'submitInspection/ok',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const r = await departure(ctx, driver, readyFiles(ctx, 'dep', ROLES.length));
      ctx.expectExample(r, 'submitInspection/ok', 201);
    },
  },
  {
    title: 'фото с тем же sha256, что раньше, — предупреждение о повторе, осмотр принят',
    operationId: 'submitInspection',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      readyFiles(ctx, 'old', 1, { sha: SHA(0xbeef) });
      const files = [
        ...readyFiles(ctx, 'dup', 2, { sha: SHA(0xbeef) }),
        ...readyFiles(ctx, 'dep', 3),
      ];
      const r = await departure(ctx, driver, files);
      expect(r.status).toBe(201);
      const photos = body(r).photos ?? [];
      expect(photos[0]?.duplicateWarning).toEqual({
        code: 'duplicate_sha256',
        firstSeenAt: NOW,
        previousCount: 1,
        sameOwner: false,
      });
      expect(photos[1]?.duplicateWarning).toEqual({
        code: 'duplicate_sha256',
        firstSeenAt: NOW,
        previousCount: 2,
        sameOwner: true,
      });
      expect(photos.slice(2).every((p) => p.duplicateWarning === undefined)).toBe(true);
      const seen = body(await manager.get(`${ctx.alta}/fleet/inspections/${body(r).id}`)).photos;
      expect(seen?.[1]?.duplicateWarning).toEqual(photos[1]?.duplicateWarning);
    },
  },
  {
    title: 'фото ещё на проверке — 409 photo_not_ready',
    operationId: 'submitInspection',
    expect: 'error',
    example: 'submitInspection/photo_not_ready',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const files = readyFiles(ctx, 'dep', ROLES.length, { status: 'quarantined' });
      ctx.expectExample(await departure(ctx, driver, files), 'submitInspection/photo_not_ready');
    },
  },
  {
    title: 'повтор файла при загрузке: completeUpload и getFile предупреждают, не отказывают',
    operationId: 'completeUpload',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const reservationId = await reserve(ctx, driver);
      const upload = async () => {
        const t = body(
          await driver.post(`${ctx.alta}/files/uploads`, {
            fileName: 'front.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 2457600,
            sha256: SHA(0xcafe),
            purpose: 'inspection',
            owner: { moduleKey: 'fleet', entityType: 'reservation', entityId: reservationId },
          }),
        );
        return driver.post(`${ctx.alta}/files/uploads/${t.uploadId}/complete`, {
          sha256: SHA(0xcafe),
        });
      };
      const first = await upload();
      expect(body(first).duplicateWarning).toBeUndefined();
      const second = await upload();
      expect(second.status).toBe(202);
      expect(body(second).duplicateWarning).toEqual({
        code: 'duplicate_sha256',
        firstSeenAt: NOW,
        previousCount: 1,
        sameOwner: true,
      });
      const read = await driver.get(`${ctx.alta}/files/${body(second).id}`);
      expect(body(read).duplicateWarning).toEqual(body(second).duplicateWarning);
    },
  },

  // Поля задачи у дефекта (D-29 комплекта, W2.46).
  {
    title: 'Котова берёт критический дефект на себя со сроком 12:00',
    operationId: 'assignInspectionDefect',
    expect: 'success',
    example: 'assignInspectionDefect/ok',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      const defect = await blockingDefect(ctx, driver);
      const r = await manager.post(
        `${ctx.alta}/fleet/defects/${defect}/assignment`,
        { assigneeMemberId: ctx.A('m-kotova'), dueAt: '2026-10-01T09:00:00Z' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'assignInspectionDefect/ok');
      const queue = body(await manager.get(`${ctx.alta}/fleet/defects?state=in_review`)).items;
      expect(queue?.[0]?.assigneeDisplayName).toBe('Марина Котова');
    },
  },
  {
    title: 'решённый дефект — 409; срок в прошлом и чужой исполнитель — 422',
    operationId: 'assignInspectionDefect',
    expect: 'error',
    example: 'assignInspectionDefect/invalid_transition',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      const defect = await blockingDefect(ctx, driver);
      const url = `${ctx.alta}/fleet/defects/${defect}/assignment`;
      const past = await manager.post(
        url,
        { assigneeMemberId: ctx.A('m-kotova'), dueAt: '2026-10-01T07:00:00Z' },
        { ifMatch: 1 },
      );
      ctx.expectProblem(past, 'validation_failed');
      expect((body(past).violations as { field: string }[])[0]?.field).toBe('dueAt');
      const stranger = await manager.post(
        url,
        { assigneeMemberId: ctx.A('m-vasiliev'), dueAt: '2026-10-01T09:00:00Z' },
        { ifMatch: 1 },
      );
      ctx.expectProblem(stranger, 'validation_failed');
      expect((body(stranger).violations as { field: string }[])[0]?.field).toBe('assigneeMemberId');
      await manager.post(
        `${ctx.alta}/fleet/defects/${defect}/decision`,
        { decision: 'allow_departure' },
        { ifMatch: 1 },
      );
      ctx.expectExample(
        await manager.post(
          url,
          { assigneeMemberId: ctx.A('m-kotova'), dueAt: '2026-10-01T09:00:00Z' },
          { ifMatch: 2 },
        ),
        'assignInspectionDefect/invalid_transition',
      );
    },
  },

  // Импорт CSV машин (D-11 комплекта, W2.50).
  {
    title: 'владелец загружает CSV: новая машина, обновление ГАЗели, строка с ошибкой',
    operationId: 'createVehicleImport',
    expect: 'success',
    example: 'createVehicleImport/ok',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      ctx.expectExample(await preview(ctx, owner), 'createVehicleImport/ok', 201);
    },
  },
  {
    title:
      'без колонки registration_number — 422; больше 2000 строк — 413; водитель — 403; чужая фирма — ошибка строки',
    operationId: 'createVehicleImport',
    expect: 'error',
    example: 'createVehicleImport/validation_failed',
    run: async (ctx) => {
      const { owner, manager, driver } = await ready(ctx);
      ctx.expectExample(
        await preview(ctx, owner, 'display_name;body_type\nГАЗель;Тент'),
        'createVehicleImport/validation_failed',
      );
      const big = ['registration_number', ...Array.from({ length: 2001 }, (_, i) => `А ${i}`)];
      ctx.expectProblem(await preview(ctx, owner, big.join('\n')), 'payload_too_large');
      ctx.expectProblem(await preview(ctx, driver), 'forbidden_action');
      // Фирма по умолчанию вне области Котовой («Юг Транс») — тот же 422, что неизвестная (возврат 1 W2.52): по
      // ответу не отличить, есть ли такая фирма.
      const head =
        'registration_number;display_name;body_type;payload_kg;volume_m3;cargo_length_m;cargo_width_m;cargo_height_m;odometer_km;org_unit';
      for (const unit of [ctx.A('f-msk-yug'), '00000000-0000-5000-8000-000000000000']) {
        const r = await manager.post(imports(ctx), {
          fileName: 'mashiny.csv',
          csv: `${head}\nХ 7 ТТ 77;Новая;Тент;1000;10;3;2;2;0;`,
          defaultOrgUnitId: unit,
        });
        ctx.expectProblem(r, 'validation_failed');
        expect(body(r).violations).toEqual([
          { field: 'defaultOrgUnitId', code: 'unknown', message: 'Подразделение не найдено' },
        ]);
      }
      // Котова ведёт автопарк «Север Логистик»: машина «Юг Транс» (Isuzu Elf) — ошибка строки как у неверной, без
      // раскрытия машины; строка в «Юг Транс» и в несуществующей фирме — одна и та же ошибка «Подразделение не найдено.».
      const csv = [
        head,
        'К 120 РУ 77;Isuzu Elf;Фургон;3000;20;4,4;2;2;98320;',
        'Х 7 ТТ 77;Новая;Тент;1000;10;3;2;2;0;Юг Транс',
        'Х 8 ТТ 77;Новая;Тент;1000;10;3;2;2;0;Нет такой фирмы',
      ].join('\n');
      const rows = body(await preview(ctx, manager, csv)).rows;
      const noUnit = [{ field: 'org_unit', code: 'unknown', message: 'Подразделение не найдено.' }];
      expect(rows?.map((r) => [r.action, r.errors, 'vehicleId' in r])).toEqual([
        [
          'error',
          [
            {
              field: 'registration_number',
              code: 'unavailable',
              message: 'Строку нельзя импортировать',
            },
          ],
          false,
        ],
        ['error', noUnit, false],
        ['error', noUnit, false],
      ]);
    },
  },
  {
    title: 'предпросмотр читается повторно',
    operationId: 'getVehicleImport',
    expect: 'success',
    example: 'getVehicleImport/ok',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      const id = body(await preview(ctx, owner)).id as string;
      ctx.expectExample(await owner.get(`${imports(ctx)}/${id}`), 'getVehicleImport/ok');
    },
  },
  {
    title: 'неизвестный импорт — 404',
    operationId: 'getVehicleImport',
    expect: 'error',
    example: 'getVehicleImport/not_found',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      ctx.expectExample(
        await owner.get(`${imports(ctx)}/00000000-0000-5000-8000-000000000000`),
        'getVehicleImport/not_found',
      );
    },
  },
  {
    title: 'применение с пропуском ошибок: машина создана, ГАЗель обновлена, история открыта',
    operationId: 'commitVehicleImport',
    expect: 'success',
    example: 'commitVehicleImport/ok',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      const id = body(await preview(ctx, owner)).id as string;
      const r = await owner.post(
        `${imports(ctx)}/${id}/commit`,
        { skipInvalidRows: true },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'commitVehicleImport/ok');
      const created = (body(r).rows?.[0] as { vehicleId: string }).vehicleId;
      const list = body(await owner.get(`${ctx.alta}/fleet/vehicles`)).items;
      const v = list?.find((x) => x.id === created);
      expect([v?.registrationNumber, v?.displayName, v?.bodyType, v?.depot]).toEqual([
        'Х 101 АМ 77',
        'Ford Transit Custom',
        'van',
        'Склад № 1',
      ]);
      expect((v?.capacity as { cargoLengthM: string }).cargoLengthM).toBe('3.2');
      const history = body(
        await owner.get(`${ctx.alta}/fleet/vehicles/${created}/assignments`),
      ).items;
      expect(history?.map((p) => [p.orgUnitName, p.validFrom, p.validTo])).toEqual([
        ['Север Логистик', NOW, null],
      ]);
      ctx.expectProblem(
        await owner.post(`${imports(ctx)}/${id}/commit`, { skipInvalidRows: true }, { ifMatch: 2 }),
        'invalid_transition',
      );
    },
  },
  {
    title: 'строки с ошибками без skipInvalidRows — 422',
    operationId: 'commitVehicleImport',
    expect: 'error',
    example: 'commitVehicleImport/validation_failed',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      const id = body(await preview(ctx, owner)).id as string;
      ctx.expectExample(
        await owner.post(
          `${imports(ctx)}/${id}/commit`,
          { skipInvalidRows: false },
          { ifMatch: 1 },
        ),
        'commitVehicleImport/validation_failed',
      );
    },
  },

  // Выгрузка CSV (D-11 комплекта, W2.50).
  {
    title: 'Котова выгружает «Поездки»: «;», CRLF, подписи вариантов',
    operationId: 'exportDataset',
    expect: 'success',
    example: 'exportDataset/ok',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.post(exportUrl(ctx, 'fleet.trips'), {
          select: ['trip', 'driverName', 'state', 'mileageKm'],
          filters: [],
          sort: [],
        }),
        'exportDataset/ok',
      );
    },
  },
  {
    title: '«Расходы»: сумма с запятой, дата ДД.ММ.ГГГГ, защита от формул',
    operationId: 'exportDataset',
    expect: 'success',
    run: async (ctx) => {
      const { owner, driver, manager } = await ready(ctx);
      await onRoute(ctx, driver);
      await expense(ctx, driver, 'parking');
      const r = await manager.post(exportUrl(ctx, 'fleet.expenses'), {
        select: ['trip', 'kind', 'occurredOn', 'amount'],
        filters: [],
        sort: [],
      });
      expect(r.status).toBe(200);
      expect([body(r).content, body(r).fileName, body(r).rowCount]).toEqual([
        'Рейс;Категория;Дата;Сумма\r\nР-208;Парковка;01.10.2026;500,00\r\n',
        'Расходы-2026-10-01.csv',
        1,
      ]);
      // Ячейка, начинающаяся с «=», в файле — с апострофом (CSV formula injection); «;» — в кавычках.
      const csv =
        'registration_number;display_name;body_type;payload_kg;volume_m3;cargo_length_m;cargo_width_m;cargo_height_m;odometer_km\n' +
        'Х 1 ТТ 77;=1+2;Тент;1000;10;3;2;2;100\nХ 2 ТТ 77;"Борт; длинный";Борт;1000;10;3;2;2;100';
      const id = body(await preview(ctx, owner, csv)).id as string;
      await owner.post(`${imports(ctx)}/${id}/commit`, { skipInvalidRows: false }, { ifMatch: 1 });
      const v = await owner.post(exportUrl(ctx, 'fleet.vehicles'), {
        select: ['displayName', 'registrationNumber'],
        filters: [],
        search: 'ТТ 77',
        sort: [{ fieldKey: 'registrationNumber', direction: 'asc' }],
      });
      expect(body(v).content).toBe(
        'Машина;Номер\r\n\'=1+2;Х 1 ТТ 77\r\n"Борт; длинный";Х 2 ТТ 77\r\n',
      );
    },
  },
  {
    title: 'водителю выгрузка закрыта — 403; скрытое поле — 422; неизвестный набор — 404',
    operationId: 'exportDataset',
    expect: 'error',
    example: 'exportDataset/forbidden_action',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      ctx.expectExample(
        await driver.post(exportUrl(ctx, 'fleet.trips'), {
          select: ['trip'],
          filters: [],
          sort: [],
        }),
        'exportDataset/forbidden_action',
      );
      const role = alta(ctx).roles.find((x) => x.proto === 'r-manager');
      if (role) role.permissions = role.permissions.filter((k) => k !== 'fleet.earnings.read');
      const hidden = await manager.post(exportUrl(ctx, 'fleet.trips'), {
        select: ['trip', 'earnings'],
        filters: [],
        sort: [],
      });
      ctx.expectProblem(hidden, 'validation_failed');
      expect(body(hidden).detail).toBe('Поле недоступно: earnings.');
      ctx.expectProblem(
        await manager.post(exportUrl(ctx, 'fleet.nothing'), {
          select: ['x'],
          filters: [],
          sort: [],
        }),
        'not_found',
      );
    },
  },

  // Адрес остановки для ссылки навигатора (D-11 комплекта, W2.50).
  {
    title: 'адрес навигатора остановки сохраняется в рейсе',
    operationId: 'createTripPlan',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const stop = (sequence: number, op: string, extra: Record<string, unknown> = {}) => ({
        sequence,
        op,
        address: sequence === 1 ? 'Склад № 1 · ворота 3' : 'Химки, ул. Заводская, 8',
        weightKg: '300',
        volumeM3: '8',
        ...extra,
      });
      const r = await manager.post(`${ctx.alta}/fleet/trip-plans`, {
        orgUnitId: ctx.A('f-msk-sever'),
        title: 'Возврат тары',
        plannedWindow: {
          startsAt: '2026-10-01T13:00:00Z',
          endsAt: '2026-10-01T15:00:00Z',
          timeZone: MSK,
        },
        cargo: { description: 'Пустые паллеты', weightKg: '300', volumeM3: '8', lengthM: '2.4' },
        stops: [stop(1, 'load', { navigationAddress: 'Лобня, ул. Победы, 1' }), stop(2, 'unload')],
      });
      expect(r.status).toBe(201);
      const plan = body(await manager.get(`${ctx.alta}/fleet/trip-plans/${body(r).id}`));
      const stops = plan.stops as { navigationAddress?: string }[];
      expect(stops.map((s) => s.navigationAddress)).toEqual(['Лобня, ул. Победы, 1', undefined]);
    },
  },
]);
