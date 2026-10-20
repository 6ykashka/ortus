// Кейсы контрактного PR 6 этапа 4 (W4.07, 0.8.0-stage4): места и тарифная сетка, заявки на тариф и решение
// оператора, «Использование», каталог аккаунтов и операторы платформы, оформление организации. Каждый пример
// tools/gen/examples-w407.mjs воспроизводится здесь (PD-43), у каждой новой операции — кейс успеха и ошибки.
import { expect } from 'vitest';

import { Client, type Session } from '../client.ts';
import { cases } from '../types.ts';
import type { CaseContext } from '../types.ts';

const PLATFORM = '/api/v1/platform';

/** Тарифы версии 2 сида — основа новой версии v3 (скидка за 12 месяцев 25%). */
const TIERS_V2 = [
  { code: 'start', name: 'Старт', seatsLimit: 10, monthAmountMinor: 390000 },
  { code: 'team', name: 'Команда', seatsLimit: 25, monthAmountMinor: 890000 },
  { code: 'biz', name: 'Бизнес', seatsLimit: 50, monthAmountMinor: 1590000 },
  { code: 'net', name: 'Сеть', seatsLimit: 100, monthAmountMinor: 2790000 },
  { code: 'unl', name: 'Безлимит', seatsLimit: null, monthAmountMinor: null },
];
const V3 = {
  effectiveFrom: '2026-11-01',
  note: 'Скидка за 12 месяцев — 25%',
  tiers: TIERS_V2,
  terms: [
    { months: 1, discountPercent: 0 },
    { months: 4, discountPercent: 5 },
    { months: 8, discountPercent: 10 },
    { months: 12, discountPercent: 25 },
  ],
};

/** Знак 512×512 PNG (заголовок IHDR и нули) размером 48 213 байт — его sha256 в примере. */
function markPng(): string {
  const b = new Uint8Array(48213);
  b.set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0,
    0, 0, 2, 0, 8, 6, 0, 0, 0,
  ]);
  return Buffer.from(b).toString('base64');
}

/** Заголовок JPEG: APP0 JFIF и SOF0 с размерами (возврат 2: размеры знака читаются не только у PNG). */
function jpeg(width: number, height: number): string {
  const u16 = (n: number) => [n >> 8, n & 0xff];
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    ...u16(height),
    ...u16(width),
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]).toString('base64');
}

/** RIFF WebP с одним чанком: VP8X (расширенный), VP8L (без потерь) или «VP8 » (с потерями). */
function webp(chunk: 'VP8X' | 'VP8L' | 'VP8 ', width: number, height: number): string {
  const u24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const payload =
    chunk === 'VP8X'
      ? [0, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]
      : chunk === 'VP8L'
        ? (() => {
            const bits = ((width - 1) | ((height - 1) << 14)) >>> 0;
            return [
              0x2f,
              bits & 0xff,
              (bits >> 8) & 0xff,
              (bits >> 16) & 0xff,
              (bits >>> 24) & 0xff,
            ];
          })()
        : [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...u16(width), ...u16(height)];
  const body = [...Buffer.from(chunk), ...u24(payload.length), 0, ...payload];
  const riff = [...Buffer.from('WEBP'), ...body];
  return Buffer.from([...Buffer.from('RIFF'), ...u24(riff.length), 0, ...riff]).toString('base64');
}

/**
 * Сессия персонажа, у изменяющего запроса которой тело приходит по сигналу: запрос проходит шлюз (сессия, CSRF,
 * роль оператора) и ждёт тело, пока тест не вызовет `release` — так воспроизводится гонка двух команд под одной
 * проверкой (в Go — под блокировкой строк). Запросы идут в сценарный сервер напрямую (`server.handle`).
 */
async function heldBody(
  ctx: CaseContext,
  persona: string,
): Promise<{ session: Session; passedGateway: Promise<void>; release: () => void }> {
  let reading: () => void = () => undefined;
  const passedGateway = new Promise<void>((r) => (reading = r));
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const target = {
    base: ctx.api.target.base,
    fetch: async (request: Request): Promise<Response> => {
      if (request.method === 'GET' || request.url.includes('/api/v1/dev/')) {
        return ctx.api.target.fetch(request);
      }
      const text = await request.text();
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(c) {
            reading();
            await gate;
            c.enqueue(new TextEncoder().encode(text));
            c.close();
          },
        },
        { highWaterMark: 0 },
      );
      const init = { method: request.method, headers: request.headers, body, duplex: 'half' };
      return ctx.server.handle(new Request(request.url, init as RequestInit));
    },
  };
  const session = await new Client(target, ctx.api.hooks).as(persona);
  return { session, passedGateway, release };
}

const SR = (ctx: CaseContext, n: number): string => ctx.P(`subscription-request:SR-${n}`);

async function publishV3(ctx: CaseContext): Promise<Session> {
  const op = await ctx.as('operator');
  const r = await op.post(`${PLATFORM}/price-book/versions`, V3);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return op;
}

const BRANDING_V4 = (markAssetId: string | null) => ({
  displayName: 'SPA «Лотос»',
  shortName: 'Лотос',
  accentHex: '#C9A227',
  logoAssetId: null,
  markAssetId,
  terms: { visit: { one: 'сеанс', plural: 'сеансы', few: 'сеанса', many: 'сеансов' } },
  menu: { items: { calendar: { label: 'Записи', icon: 'event_available' } }, order: [] },
  poweredBy: true,
});

async function uploadMark(s: Session, ctx: CaseContext) {
  return s.post(`${ctx.lotos}/branding/assets`, {
    kind: 'mark',
    fileName: 'lotos-mark.png',
    contentType: 'image/png',
    contentBase64: markPng(),
  });
}

export const billingW407Cases = cases('billing-w407')([
  // ------------------------------------------------------------------ Billing: сетка, места, заявки
  {
    title: 'тарифная сетка «Альты» — действующая версия 2',
    operationId: 'getTenantPriceBook',
    expect: 'success',
    example: 'getTenantPriceBook/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/price-book`), 'getTenantPriceBook/ok');
    },
  },
  {
    title: '«Лотос» платит по версии 1, оператор запланировал версию 3',
    operationId: 'getTenantPriceBook',
    expect: 'success',
    example: 'getTenantPriceBook/subscribed',
    run: async (ctx) => {
      await publishV3(ctx);
      const s = await ctx.as('owner@t-lotos');
      ctx.expectExample(await s.get(`${ctx.lotos}/price-book`), 'getTenantPriceBook/subscribed');
    },
  },
  {
    title: 'логисту сетка закрыта',
    operationId: 'getTenantPriceBook',
    expect: 'error',
    example: 'getTenantPriceBook/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(`${ctx.alta}/price-book`),
        'getTenantPriceBook/forbidden_action',
      );
    },
  },
  {
    title: 'подписка «Лотоса» — тариф, срок, сумма периода и места',
    operationId: 'getTenantSubscription',
    expect: 'success',
    example: 'getTenantSubscription/seats',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      ctx.expectExample(await s.get(`${ctx.lotos}/subscription`), 'getTenantSubscription/seats');
    },
  },
  {
    title: 'заявки «Лотоса» — SR-12 на рассмотрении',
    operationId: 'listSubscriptionChangeRequests',
    expect: 'success',
    example: 'listSubscriptionChangeRequests/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      ctx.expectExample(
        await s.get(`${ctx.lotos}/subscription/change-requests`),
        'listSubscriptionChangeRequests/ok',
      );
      const none = await s.get(`${ctx.lotos}/subscription/change-requests?status=approved`);
      expect(none.body).toMatchObject({ items: [], pendingCount: 1 });
    },
  },
  {
    title: 'логисту заявки закрыты',
    operationId: 'listSubscriptionChangeRequests',
    expect: 'error',
    example: 'listSubscriptionChangeRequests/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(`${ctx.alta}/subscription/change-requests`),
        'listSubscriptionChangeRequests/forbidden_action',
      );
    },
  },
  {
    title: '«Альта» просит «Команду» на 12 месяцев — SR-13 по версии 2',
    operationId: 'createSubscriptionChangeRequest',
    expect: 'success',
    example: 'createSubscriptionChangeRequest/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/subscription/change-requests`, {
        tierCode: 'team',
        termMonths: 12,
        comment: 'Подключаем Самару, нужно ещё 8 мест',
      });
      ctx.expectExample(r, 'createSubscriptionChangeRequest/ok');
      const op = await ctx.as('operator');
      const q = (await op.get(`${PLATFORM}/subscription-requests?status=pending`)).body;
      expect(q).toMatchObject({ pendingCount: 2 });
    },
  },
  {
    title: 'вторая открытая заявка — 409',
    operationId: 'createSubscriptionChangeRequest',
    expect: 'error',
    example: 'createSubscriptionChangeRequest/request_pending',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      const r = await s.post(`${ctx.lotos}/subscription/change-requests`, {
        tierCode: 'net',
        termMonths: 12,
      });
      ctx.expectExample(r, 'createSubscriptionChangeRequest/request_pending');
    },
  },
  {
    title: '«Старт» на 10 мест при 23 занятых — 422',
    operationId: 'createSubscriptionChangeRequest',
    expect: 'error',
    example: 'createSubscriptionChangeRequest/tier_below_usage',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      await s.post(`${ctx.lotos}/subscription/change-requests/${SR(ctx, 12)}/cancel`);
      const r = await s.post(`${ctx.lotos}/subscription/change-requests`, {
        tierCode: 'start',
        termMonths: 1,
      });
      ctx.expectExample(r, 'createSubscriptionChangeRequest/tier_below_usage');
    },
  },
  {
    title: 'тарифа нет в действующей сетке — 422',
    operationId: 'createSubscriptionChangeRequest',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/subscription/change-requests`, {
        tierCode: 'galaxy',
        termMonths: 1,
      });
      ctx.expectProblem(r, 'validation_failed');
    },
  },
  {
    title: 'не владельцу — 403 (x-scope tenant-owner)',
    operationId: 'createSubscriptionChangeRequest',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const r = await s.post(`${ctx.alta}/subscription/change-requests`, {
        tierCode: 'team',
        termMonths: 1,
      });
      ctx.expectProblem(r, 'forbidden_action');
    },
  },
  {
    title: 'владелец «Лотоса» отменяет SR-12',
    operationId: 'cancelSubscriptionChangeRequest',
    expect: 'success',
    example: 'cancelSubscriptionChangeRequest/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      ctx.expectExample(
        await s.post(`${ctx.lotos}/subscription/change-requests/${SR(ctx, 12)}/cancel`),
        'cancelSubscriptionChangeRequest/ok',
      );
    },
  },
  {
    title: 'отменённую заявку повторно не отменить',
    operationId: 'cancelSubscriptionChangeRequest',
    expect: 'error',
    example: 'cancelSubscriptionChangeRequest/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      const path = `${ctx.lotos}/subscription/change-requests/${SR(ctx, 12)}/cancel`;
      await s.post(path);
      ctx.expectExample(await s.post(path), 'cancelSubscriptionChangeRequest/invalid_transition');
    },
  },
  {
    title: 'заявка другой организации — 404',
    operationId: 'cancelSubscriptionChangeRequest',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/subscription/change-requests/${SR(ctx, 12)}/cancel`);
      ctx.expectProblem(r, 'not_found');
    },
  },

  // ------------------------------------------------------------------ Platform: заявки и сетка
  {
    title: 'очередь заявок оператора',
    operationId: 'listPlatformSubscriptionRequests',
    expect: 'success',
    example: 'listPlatformSubscriptionRequests/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.get(`${PLATFORM}/subscription-requests`),
        'listPlatformSubscriptionRequests/ok',
      );
    },
  },
  {
    title: 'неизвестная организация фильтра — 404',
    operationId: 'listPlatformSubscriptionRequests',
    expect: 'error',
    example: 'listPlatformSubscriptionRequests/not_found',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.get(`${PLATFORM}/subscription-requests?tenantId=${ctx.P('t-nowhere')}`),
        'listPlatformSubscriptionRequests/not_found',
      );
    },
  },
  {
    title: 'оператор подтверждает SR-12 — «Бизнес» сразу (повышение)',
    operationId: 'decidePlatformSubscriptionRequest',
    expect: 'success',
    example: 'decidePlatformSubscriptionRequest/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(`${PLATFORM}/subscription-requests/${SR(ctx, 12)}/decision`, {
        decision: 'approve',
        note: 'Оплата по счёту получена',
      });
      ctx.expectExample(r, 'decidePlatformSubscriptionRequest/ok');
      const s = await ctx.as('owner@t-lotos');
      const sub = (await s.get(`${ctx.lotos}/subscription`)).body;
      expect(sub).toMatchObject({
        planKey: 'biz',
        tierCode: 'biz',
        termMonths: 12,
        priceVersion: 1,
        seats: { limit: 50, used: 23 },
      });
    },
  },
  {
    title: 'отказ без причины — 422',
    operationId: 'decidePlatformSubscriptionRequest',
    expect: 'error',
    example: 'decidePlatformSubscriptionRequest/validation_failed',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(`${PLATFORM}/subscription-requests/${SR(ctx, 12)}/decision`, {
        decision: 'reject',
        note: '  ',
      });
      ctx.expectExample(r, 'decidePlatformSubscriptionRequest/validation_failed');
    },
  },
  {
    title: 'решённая заявка — 409',
    operationId: 'decidePlatformSubscriptionRequest',
    expect: 'error',
    example: 'decidePlatformSubscriptionRequest/invalid_transition',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(`${PLATFORM}/subscription-requests/${SR(ctx, 9)}/decision`, {
        decision: 'approve',
      });
      ctx.expectExample(r, 'decidePlatformSubscriptionRequest/invalid_transition');
    },
  },
  {
    title: 'отказ с причиной — тариф не меняется',
    operationId: 'decidePlatformSubscriptionRequest',
    expect: 'success',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(`${PLATFORM}/subscription-requests/${SR(ctx, 12)}/decision`, {
        decision: 'reject',
        note: 'Счёт не оплачен',
      });
      expect(r.body).toMatchObject({ status: 'rejected', decisionNote: 'Счёт не оплачен' });
      const s = await ctx.as('owner@t-lotos');
      const list = (await s.get(`${ctx.lotos}/subscription/change-requests`)).body as {
        items: Record<string, unknown>[];
      };
      expect(list.items[0]).not.toHaveProperty('decidedBy');
      expect((await s.get(`${ctx.lotos}/subscription`)).body).toMatchObject({ planKey: 'team' });
    },
  },
  {
    title: 'версии сетки оператора',
    operationId: 'listPriceBookVersions',
    expect: 'success',
    example: 'listPriceBookVersions/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.get(`${PLATFORM}/price-book/versions`),
        'listPriceBookVersions/ok',
      );
    },
  },
  {
    title: 'не оператору — 404',
    operationId: 'listPriceBookVersions',
    expect: 'error',
    example: 'listPriceBookVersions/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.get(`${PLATFORM}/price-book/versions`),
        'listPriceBookVersions/not_found',
      );
    },
  },
  {
    title: 'публикация версии 3 с 01.11',
    operationId: 'publishPriceBookVersion',
    expect: 'success',
    example: 'publishPriceBookVersion/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.post(`${PLATFORM}/price-book/versions`, V3),
        'publishPriceBookVersion/ok',
      );
    },
  },
  {
    title: 'цена не растёт от ступени к ступени — 422',
    operationId: 'publishPriceBookVersion',
    expect: 'error',
    example: 'publishPriceBookVersion/validation_failed',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const tiers = TIERS_V2.map((t) =>
        t.code === 'team' ? { ...t, monthAmountMinor: 350000 } : t,
      );
      ctx.expectExample(
        await op.post(`${PLATFORM}/price-book/versions`, { ...V3, tiers }),
        'publishPriceBookVersion/validation_failed',
      );
    },
  },
  {
    title: 'вторая запланированная версия — 409',
    operationId: 'publishPriceBookVersion',
    expect: 'error',
    example: 'publishPriceBookVersion/invalid_transition',
    run: async (ctx) => {
      const op = await publishV3(ctx);
      ctx.expectExample(
        await op.post(`${PLATFORM}/price-book/versions`, { ...V3, effectiveFrom: '2026-12-01' }),
        'publishPriceBookVersion/invalid_transition',
      );
    },
  },
  {
    title: 'отмена версии 3 до начала',
    operationId: 'cancelPriceBookVersion',
    expect: 'success',
    example: 'cancelPriceBookVersion/ok',
    run: async (ctx) => {
      const op = await publishV3(ctx);
      ctx.expectExample(
        await op.post(`${PLATFORM}/price-book/versions/3/cancel`),
        'cancelPriceBookVersion/ok',
      );
      const list = (await op.get(`${PLATFORM}/price-book/versions`)).body as {
        items: { version: number; effectiveUntil?: string }[];
      };
      expect(list.items.map((v) => v.version)).toEqual([2, 1]);
      expect(list.items[0]).not.toHaveProperty('effectiveUntil');
    },
  },
  {
    title: 'действующую версию не отменить',
    operationId: 'cancelPriceBookVersion',
    expect: 'error',
    example: 'cancelPriceBookVersion/invalid_transition',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.post(`${PLATFORM}/price-book/versions/2/cancel`),
        'cancelPriceBookVersion/invalid_transition',
      );
    },
  },

  // ------------------------------------------------------------------ Platform: «Использование»
  {
    title: '«Использование» — сводка, сигналы, модули, организации',
    operationId: 'getPlatformUsage',
    expect: 'success',
    example: 'getPlatformUsage/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(await op.get(`${PLATFORM}/usage`), 'getPlatformUsage/ok');
    },
  },
  {
    title: 'не оператору — 404',
    operationId: 'getPlatformUsage',
    expect: 'error',
    example: 'getPlatformUsage/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${PLATFORM}/usage`), 'getPlatformUsage/not_found');
    },
  },

  // ------------------------------------------------------------------ Platform: каталог аккаунтов
  {
    title: 'карточка Котовой — участие в «Карго» завершено',
    operationId: 'getPlatformUser',
    expect: 'success',
    example: 'getPlatformUser/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(await op.get(`${PLATFORM}/users/${ctx.P('acc-2')}`), 'getPlatformUser/ok');
    },
  },
  {
    title: 'карточка Шишкина — вход заблокирован с причиной',
    operationId: 'getPlatformUser',
    expect: 'success',
    example: 'getPlatformUser/locked',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.get(`${PLATFORM}/users/${ctx.P('acc-13')}`),
        'getPlatformUser/locked',
      );
    },
  },
  {
    title: 'неизвестный аккаунт — 404',
    operationId: 'getPlatformUser',
    expect: 'error',
    example: 'getPlatformUser/not_found',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.get(`${PLATFORM}/users/${ctx.P('acc-404')}`),
        'getPlatformUser/not_found',
      );
    },
  },
  {
    title: 'фильтр «Заблокированы» — счётчики без фильтра',
    operationId: 'listPlatformUsers',
    expect: 'success',
    example: 'listPlatformUsers/locked',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.get(`${PLATFORM}/users?filter=locked`),
        'listPlatformUsers/locked',
      );
      const lotos = (await op.get(`${PLATFORM}/users?tenantId=${ctx.P('t-lotos')}&q=белова`))
        .body as { items: { displayName: string }[]; counts: { all: number } };
      expect(lotos.items.map((u) => u.displayName)).toEqual(['Ирина Белова']);
      expect(lotos.counts.all).toBe(1);
    },
  },
  {
    title: 'блокировка входа Васильева с причиной',
    operationId: 'lockPlatformUser',
    expect: 'success',
    example: 'lockPlatformUser/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await op.post(`${PLATFORM}/users/${ctx.P('acc-3')}/lock`, {
          reason: 'Потерян телефон с открытой сессией, 01.10',
        }),
        'lockPlatformUser/ok',
      );
      ctx.expectProblem(await driver.get('/api/v1/me/context'), 'session_expired');
    },
  },
  {
    title: 'причина короче 5 символов — 422',
    operationId: 'lockPlatformUser',
    expect: 'error',
    example: 'lockPlatformUser/validation_failed',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.post(`${PLATFORM}/users/${ctx.P('acc-3')}/lock`, { reason: 'abc' }),
        'lockPlatformUser/validation_failed',
      );
    },
  },
  {
    title: 'уже заблокирован — 409',
    operationId: 'lockPlatformUser',
    expect: 'error',
    example: 'lockPlatformUser/invalid_transition',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.post(`${PLATFORM}/users/${ctx.P('acc-13')}/lock`, {
          reason: 'Повторная блокировка',
        }),
        'lockPlatformUser/invalid_transition',
      );
    },
  },
  {
    title: 'разблокировка входа Шишкина',
    operationId: 'unlockPlatformUser',
    expect: 'success',
    example: 'unlockPlatformUser/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.post(`${PLATFORM}/users/${ctx.P('acc-13')}/unlock`),
        'unlockPlatformUser/ok',
      );
    },
  },
  {
    title: 'вход не заблокирован — 409',
    operationId: 'unlockPlatformUser',
    expect: 'error',
    example: 'unlockPlatformUser/invalid_transition',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.post(`${PLATFORM}/users/${ctx.P('acc-3')}/unlock`),
        'unlockPlatformUser/invalid_transition',
      );
    },
  },
  {
    title: 'сброс второго фактора Зиминой',
    operationId: 'resetPlatformUserMfa',
    expect: 'success',
    example: 'resetPlatformUserMfa/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.post(`${PLATFORM}/users/${ctx.P('acc-1')}/mfa-reset`),
        'resetPlatformUserMfa/ok',
      );
    },
  },
  {
    title: 'второго фактора нет — 409',
    operationId: 'resetPlatformUserMfa',
    expect: 'error',
    example: 'resetPlatformUserMfa/invalid_transition',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.post(`${PLATFORM}/users/${ctx.P('acc-3')}/mfa-reset`),
        'resetPlatformUserMfa/invalid_transition',
      );
    },
  },

  // ------------------------------------------------------------------ Platform: операторы
  {
    title: 'операторы «Ортус · Платформа»',
    operationId: 'listPlatformOperators',
    expect: 'success',
    example: 'listPlatformOperators/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(await op.get(`${PLATFORM}/operators`), 'listPlatformOperators/ok');
    },
  },
  {
    title: 'не оператору — 404',
    operationId: 'listPlatformOperators',
    expect: 'error',
    example: 'listPlatformOperators/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${PLATFORM}/operators`), 'listPlatformOperators/not_found');
    },
  },
  {
    title: 'приглашение оператора поддержки',
    operationId: 'invitePlatformOperator',
    expect: 'success',
    example: 'invitePlatformOperator/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.post(`${PLATFORM}/operators`, {
          displayName: 'Ольга Миронова',
          email: 'o.mironova@ortus.example',
          role: 'support',
        }),
        'invitePlatformOperator/ok',
      );
    },
  },
  {
    title: 'почта не в домене платформы — 422',
    operationId: 'invitePlatformOperator',
    expect: 'error',
    example: 'invitePlatformOperator/validation_failed',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.post(`${PLATFORM}/operators`, {
          displayName: 'Ольга Миронова',
          email: 'olga@gmail.example',
          role: 'support',
        }),
        'invitePlatformOperator/validation_failed',
      );
    },
  },
  {
    title: 'Гусева — из биллинга в администраторы',
    operationId: 'updatePlatformOperator',
    expect: 'success',
    example: 'updatePlatformOperator/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.patch(
        `${PLATFORM}/operators/${ctx.P('op-3')}`,
        { role: 'admin' },
        {
          ifMatch: 1,
        },
      );
      ctx.expectExample(r, 'updatePlatformOperator/ok');
      expect(r.headers.get('ETag')).toBe('"rev-2"');
    },
  },
  {
    // Возврат 2: оба — владельцы. Шлюз пропустил запрос Сорокина как владельца, а к хендлеру Лаптева уже
    // понизила его: Лаптева — последний активный владелец, её не отключить (гонка двух владельцев).
    title: 'последнего активного владельца не отключить — два владельца одновременно',
    operationId: 'updatePlatformOperator',
    expect: 'error',
    example: 'updatePlatformOperator/last_owner_required',
    run: async (ctx) => {
      const lapteva = await ctx.as('operator');
      const { session: sorokin, passedGateway, release } = await heldBody(ctx, 'op-2');
      const pending = sorokin.patch(
        `${PLATFORM}/operators/${ctx.P('op-1')}`,
        { active: false },
        { ifMatch: 1 },
      );
      await passedGateway;
      const demoted = await lapteva.patch(
        `${PLATFORM}/operators/${ctx.P('op-2')}`,
        { role: 'admin' },
        { ifMatch: 1 },
      );
      expect(demoted.status).toBe(200);
      release();
      ctx.expectExample(await pending, 'updatePlatformOperator/last_owner_required');
    },
  },
  {
    title: 'роль оператора: поддержка не публикует тарифную сетку — 403',
    operationId: 'publishPriceBookVersion',
    expect: 'error',
    run: async (ctx) => {
      const support = await ctx.as('op-4');
      ctx.expectProblem(
        await support.post(`${PLATFORM}/price-book/versions`, V3),
        'forbidden_action',
      );
      expect((await support.get(`${PLATFORM}/price-book/versions`)).status).toBe(403);
      // Блокировка входа — право поддержки (platform.users.manage).
      expect((await support.post(`${PLATFORM}/users/${ctx.P('acc-1')}/mfa-reset`)).status).toBe(
        200,
      );
    },
  },
  {
    title: 'роль оператора: биллинг не приглашает операторов — 403',
    operationId: 'invitePlatformOperator',
    expect: 'error',
    run: async (ctx) => {
      const billing = await ctx.as('op-3');
      ctx.expectProblem(
        await billing.post(`${PLATFORM}/operators`, {
          displayName: 'Ольга Миронова',
          email: 'o.mironova@ortus.example',
          role: 'support',
        }),
        'forbidden_action',
      );
      // Список операторов видят все операторы (platform.users.read).
      expect((await billing.get(`${PLATFORM}/operators`)).status).toBe(200);
    },
  },
  {
    title: 'роль оператора: администратор не меняет роли операторов — 403',
    operationId: 'updatePlatformOperator',
    expect: 'error',
    run: async (ctx) => {
      const owner = await ctx.as('operator');
      const promoted = await owner.patch(
        `${PLATFORM}/operators/${ctx.P('op-3')}`,
        { role: 'admin' },
        { ifMatch: 1 },
      );
      expect(promoted.status).toBe(200);
      const admin = await ctx.as('op-3');
      ctx.expectProblem(
        await admin.patch(
          `${PLATFORM}/operators/${ctx.P('op-4')}`,
          { role: 'billing' },
          { ifMatch: 1 },
        ),
        'forbidden_action',
      );
      // Тарифная сетка — право администратора (platform.pricing.manage).
      expect((await admin.post(`${PLATFORM}/price-book/versions`, V3)).status).toBe(201);
    },
  },
  {
    title: 'роль оператора: поддержка не решает заявки на тариф — 403, биллинг решает',
    operationId: 'decidePlatformSubscriptionRequest',
    expect: 'error',
    run: async (ctx) => {
      const decide = (s: Session) =>
        s.post(`${PLATFORM}/subscription-requests/${SR(ctx, 12)}/decision`, {
          decision: 'approve',
          note: 'Оплата по счёту получена',
        });
      const support = await ctx.as('op-4');
      ctx.expectProblem(await decide(support), 'forbidden_action');
      expect((await support.get(`${PLATFORM}/subscription-requests`)).status).toBe(403);
      const billing = await ctx.as('op-3');
      expect((await decide(billing)).status).toBe(200);
    },
  },
  {
    title: 'владельцем — только активный со вторым фактором',
    operationId: 'updatePlatformOperator',
    expect: 'error',
    example: 'updatePlatformOperator/validation_failed',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.patch(`${PLATFORM}/operators/${ctx.P('op-5')}`, { role: 'owner' }, { ifMatch: 1 }),
        'updatePlatformOperator/validation_failed',
      );
    },
  },
  {
    title: 'свою роль не изменить — 409',
    operationId: 'updatePlatformOperator',
    expect: 'error',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.patch(
        `${PLATFORM}/operators/${ctx.P('op-1')}`,
        { role: 'admin' },
        {
          ifMatch: 1,
        },
      );
      ctx.expectProblem(r, 'invalid_transition');
    },
  },

  // ------------------------------------------------------------------ Branding
  {
    title: 'оформление «Лотоса» — версия 3, «сеанс» вместо «визит»',
    operationId: 'getTenantBranding',
    expect: 'success',
    example: 'getTenantBranding/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      const r = await s.get(`${ctx.lotos}/branding`);
      ctx.expectExample(r, 'getTenantBranding/ok');
      expect(r.headers.get('ETag')).toBe('"rev-3"');
    },
  },
  {
    title: 'стандартное оформление «Альты»',
    operationId: 'getTenantBranding',
    expect: 'success',
    example: 'getTenantBranding/standard',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/branding`), 'getTenantBranding/standard');
    },
  },
  {
    title: 'не владельцу — 403',
    operationId: 'getTenantBranding',
    expect: 'error',
    example: 'getTenantBranding/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(await s.get(`${ctx.alta}/branding`), 'getTenantBranding/forbidden_action');
    },
  },
  {
    title: 'версия 4: светлый акцент затемнён до 4.5:1, знак, пункт меню',
    operationId: 'updateTenantBranding',
    expect: 'success',
    example: 'updateTenantBranding/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      const asset = (await uploadMark(s, ctx)).body as { id: string };
      const r = await s.put(`${ctx.lotos}/branding`, BRANDING_V4(asset.id), { ifMatch: 3 });
      ctx.expectExample(r, 'updateTenantBranding/ok');
      expect(r.headers.get('ETag')).toBe('"rev-4"');
      const op = await ctx.as('operator');
      const usage = (await op.get(`${PLATFORM}/usage`)).body as {
        tenants: { name: string; brand: { markUrl?: string } }[];
      };
      expect(usage.tenants.find((t) => t.name === 'SPA «Лотос»')?.brand.markUrl).toMatch(
        /^\/brand-assets\/[0-9a-f]{64}\.png$/,
      );
    },
  },
  {
    title: 'термин без формы — 422',
    operationId: 'updateTenantBranding',
    expect: 'error',
    example: 'updateTenantBranding/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      const body = BRANDING_V4(null);
      body.terms.visit.many = '  ';
      ctx.expectExample(
        await s.put(`${ctx.lotos}/branding`, body, { ifMatch: 3 }),
        'updateTenantBranding/validation_failed',
      );
    },
  },
  {
    title: 'устаревшая версия — 412',
    operationId: 'updateTenantBranding',
    expect: 'error',
    example: 'updateTenantBranding/revision_mismatch',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      ctx.expectExample(
        await s.put(`${ctx.lotos}/branding`, BRANDING_V4(null), { ifMatch: 2 }),
        'updateTenantBranding/revision_mismatch',
      );
    },
  },
  {
    title: 'без If-Match — 428',
    operationId: 'updateTenantBranding',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      ctx.expectProblem(
        await s.put(`${ctx.lotos}/branding`, BRANDING_V4(null)),
        'revision_required',
      );
    },
  },
  {
    title: 'знак 512×512 PNG',
    operationId: 'uploadBrandingAsset',
    expect: 'success',
    example: 'uploadBrandingAsset/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      ctx.expectExample(await uploadMark(s, ctx), 'uploadBrandingAsset/ok');
    },
  },
  {
    title: 'тип по байтам не совпадает — 422',
    operationId: 'uploadBrandingAsset',
    expect: 'error',
    example: 'uploadBrandingAsset/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      ctx.expectExample(
        await s.post(`${ctx.lotos}/branding/assets`, {
          kind: 'logo',
          fileName: 'logo.png',
          contentType: 'image/png',
          contentBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString(
            'base64',
          ),
        }),
        'uploadBrandingAsset/validation_failed',
      );
    },
  },
  {
    title: 'файл больше 1 МБ — 413',
    operationId: 'uploadBrandingAsset',
    expect: 'error',
    example: 'uploadBrandingAsset/payload_too_large',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      ctx.expectExample(
        await s.post(`${ctx.lotos}/branding/assets`, {
          kind: 'logo',
          fileName: 'logo.png',
          contentType: 'image/png',
          contentBase64: Buffer.alloc(1024 * 1024 + 3).toString('base64'),
        }),
        'uploadBrandingAsset/payload_too_large',
      );
    },
  },
  {
    title: 'SVG со скриптом — 422',
    operationId: 'uploadBrandingAsset',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
      ctx.expectProblem(
        await s.post(`${ctx.lotos}/branding/assets`, {
          kind: 'logo',
          fileName: 'logo.svg',
          contentType: 'image/svg+xml',
          contentBase64: Buffer.from(svg).toString('base64'),
        }),
        'validation_failed',
      );
    },
  },

  // ------------------------------------------------------------------ Возврат 1 (ревью W4.07)
  {
    title:
      'SVG: javascript:, <style>, <iframe>, сущности и data: — 422 unsafe_svg; локальная ссылка #id — можно',
    operationId: 'uploadBrandingAsset',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
      const upload = (svg: string) =>
        s.post(`${ctx.lotos}/branding/assets`, {
          kind: 'logo',
          fileName: 'logo.svg',
          contentType: 'image/svg+xml',
          contentBase64: Buffer.from(svg).toString('base64'),
        });
      const unsafe = [
        `<svg ${NS}><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>`,
        `<svg ${NS}><a xlink:href=" JaVaScRiPt:alert(1)"><rect width="1" height="1"/></a></svg>`,
        `<svg ${NS}><style>@import url(https://evil.example/x.css);</style></svg>`,
        `<svg ${NS}><rect style="fill:url(https://evil.example/p.svg#p)" width="1" height="1"/></svg>`,
        `<svg ${NS}><iframe src="https://evil.example"/></svg>`,
        `<svg ${NS}><embed src="x.swf"/></svg>`,
        `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg ${NS}><text>&x;</text></svg>`,
        `<svg ${NS}><image href="data:image/svg+xml;base64,PHN2Zy8+" width="1" height="1"/></svg>`,
        `<svg ${NS}><use xlink:href="other.svg#a"/></svg>`,
      ];
      for (const svg of unsafe) {
        const r = await upload(svg);
        ctx.expectProblem(r, 'validation_failed');
        expect(r.body, svg).toMatchObject({ violations: [{ code: 'unsafe_svg' }] });
      }
      const safe = `<svg ${NS} viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#7A3E79"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><use xlink:href="#g"/></svg>`;
      expect((await upload(safe)).status).toBe(201);
    },
  },
  {
    title: 'оформление в контексте: после сохранения владельцем его видят все участники «Лотоса»',
    operationId: 'updateTenantBranding',
    expect: 'success',
    run: async (ctx) => {
      type Me = { tenants: { tenantId: string; branding?: { version: number } }[] };
      const lotosOf = (me: Me) => me.tenants.find((t) => t.tenantId === ctx.P('t-lotos'))?.branding;
      // Возврат 2: в контексте — тема (BrandingTheme) без автора и момента сохранения.
      const theme = (b: unknown) => {
        const out = { ...(b as Record<string, unknown>) };
        delete out.updatedAt;
        delete out.updatedBy;
        return out;
      };
      const owner = await ctx.as('owner@t-lotos');
      const therapist = await ctx.as('therapist');
      const before = (await therapist.get('/api/v1/me/context')).body as Me;
      expect(lotosOf(before)).toEqual(theme(ctx.example('getTenantBranding/ok')));
      const asset = (await uploadMark(owner, ctx)).body as { id: string };
      const saved = await owner.put(`${ctx.lotos}/branding`, BRANDING_V4(asset.id), { ifMatch: 3 });
      expect(saved.status).toBe(200);
      expect(saved.body).toHaveProperty('updatedBy');
      for (const s of [owner, therapist]) {
        const me = (await s.get('/api/v1/me/context')).body as Me;
        expect(lotosOf(me)).toEqual(theme(saved.body));
        expect(lotosOf(me)).not.toHaveProperty('updatedBy');
      }
      const op = await ctx.as('operator');
      const tenant = (await op.get(`${PLATFORM}/tenants/${ctx.P('t-lotos')}`)).body as {
        name: string;
        brand: { accentUsed: string; markUrl?: string };
      };
      expect(tenant.brand).toMatchObject({
        shortName: 'Лотос',
        accentUsed: (saved.body as { accentUsed: string }).accentUsed,
        markUrl: expect.stringMatching(/^\/brand-assets\/[0-9a-f]{64}\.png$/) as unknown,
      });
    },
  },
  {
    title: 'подписка «Лотоса» глазами оператора — тариф, срок, суммы периода и места',
    operationId: 'getPlatformSubscription',
    expect: 'success',
    example: 'getPlatformSubscription/seats',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.get(`${PLATFORM}/tenants/${ctx.P('t-lotos')}/subscription`),
        'getPlatformSubscription/seats',
      );
    },
  },
  {
    title: 'заявка и её отмена владельцем пишутся в журнал платформы (actor owner)',
    operationId: 'createSubscriptionChangeRequest',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const created = (
        await s.post(`${ctx.alta}/subscription/change-requests`, {
          tierCode: 'team',
          termMonths: 12,
        })
      ).body as { id: string; number: string };
      await s.post(`${ctx.alta}/subscription/change-requests/${created.id}/cancel`);
      const op = await ctx.as('operator');
      const audit = (await op.get(`${PLATFORM}/audit-events?tenantId=${ctx.P('t-alta')}`)).body as {
        items: Record<string, unknown>[];
      };
      const owner = { kind: 'owner', accountId: ctx.P('acc-1'), displayName: 'Дарья Зимина' };
      const target = { type: 'subscription', tenantId: ctx.P('t-alta'), name: 'Альта Групп' };
      expect(audit.items.slice(0, 2)).toEqual([
        expect.objectContaining({
          action: 'subscription.change_request_cancelled',
          actor: owner,
          target,
          result: 'ok',
          details: { request: created.number },
        }),
        expect.objectContaining({
          action: 'subscription.change_requested',
          actor: owner,
          target,
          result: 'ok',
          details: { request: created.number, tier: 'team', termMonths: '12' },
        }),
      ]);
    },
  },
  {
    title: 'в «только чтении» владелец выбирает тариф и отправляет заявку (биллинг открыт)',
    operationId: 'createSubscriptionChangeRequest',
    expect: 'success',
    run: async (ctx) => {
      ctx.server.applyPreset('trial-ended');
      const s = await ctx.as('owner');
      expect((await s.get(`${ctx.alta}/price-book`)).status).toBe(200);
      const r = await s.post(`${ctx.alta}/subscription/change-requests`, {
        tierCode: 'team',
        termMonths: 4,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const id = (r.body as { id: string }).id;
      expect((await s.post(`${ctx.alta}/subscription/change-requests/${id}/cancel`)).status).toBe(
        200,
      );
      // Остальные изменения закрыты: оформление — не биллинг.
      ctx.expectProblem(
        await s.put(`${ctx.alta}/branding`, BRANDING_V4(null), { ifMatch: 1 }),
        'tenant_read_only',
      );
    },
  },
  {
    title: 'в приостановленной организации владельцу открыт только биллинг',
    operationId: 'cancelSubscriptionChangeRequest',
    expect: 'success',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const suspended = await op.patch(
        `${PLATFORM}/tenants/${ctx.P('t-lotos')}`,
        { status: 'suspended', reason: 'Неоплата счёта за октябрь' },
        { ifMatch: 1 },
      );
      expect(suspended.status).toBe(200);
      const s = await ctx.as('owner@t-lotos');
      for (const path of ['subscription/change-requests', 'price-book']) {
        expect((await s.get(`${ctx.lotos}/${path}`)).status, path).toBe(200);
      }
      const cancelled = await s.post(
        `${ctx.lotos}/subscription/change-requests/${SR(ctx, 12)}/cancel`,
      );
      expect(cancelled.body).toMatchObject({ status: 'cancelled' });
      const r = await s.post(`${ctx.lotos}/subscription/change-requests`, {
        tierCode: 'biz',
        termMonths: 12,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      ctx.expectProblem(await s.get(`${ctx.lotos}/members`), 'tenant_suspended');
      ctx.expectProblem(await s.get(`${ctx.lotos}/branding`), 'tenant_suspended');
    },
  },

  // ------------------------------------------------------------------ Возврат 2 (ревью W4.07)
  {
    title: 'журнал платформы: строки операторов и тарифной сетки — только ролям с этим правом',
    operationId: 'listPlatformAuditEvents',
    expect: 'success',
    run: async (ctx) => {
      const owner = await publishV3(ctx);
      const invited = await owner.post(`${PLATFORM}/operators`, {
        displayName: 'Ольга Миронова',
        email: 'o.mironova@ortus.example',
        role: 'support',
      });
      expect(invited.status).toBe(201);
      type Page = { items: { target: { type: string } }[] };
      const types = async (s: Session) =>
        new Set(
          ((await s.get(`${PLATFORM}/audit-events?limit=100`)).body as Page).items.map(
            (r) => r.target.type,
          ),
        );
      const all = await types(owner);
      expect(all.has('operator') && all.has('price_book')).toBe(true);
      // Поддержка: нет platform.operators.manage и platform.pricing.manage (контракт listPlatformAuditEvents).
      const support = await types(await ctx.as('op-4'));
      expect(support.has('operator')).toBe(false);
      expect(support.has('price_book')).toBe(false);
      // Администратор: тарифная сетка — да, операторы — нет.
      const promoted = await owner.patch(
        `${PLATFORM}/operators/${ctx.P('op-3')}`,
        { role: 'admin' },
        { ifMatch: 1 },
      );
      expect(promoted.status).toBe(200);
      const admin = await types(await ctx.as('op-3'));
      expect(admin.has('price_book')).toBe(true);
      expect(admin.has('operator')).toBe(false);
    },
  },
  {
    title:
      'SVG: «>» внутри значения атрибута не прячет обработчик и внешнюю ссылку — 422 unsafe_svg',
    operationId: 'uploadBrandingAsset',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
      const upload = (svg: string) =>
        s.post(`${ctx.lotos}/branding/assets`, {
          kind: 'logo',
          fileName: 'logo.svg',
          contentType: 'image/svg+xml',
          contentBase64: Buffer.from(svg).toString('base64'),
        });
      for (const svg of [
        `<svg ${NS}><rect title="a>b" onload="alert(1)" width="1"/></svg>`,
        `<svg ${NS}><rect title='x>' onload="alert(1)"/></svg>`,
        `<svg ${NS}><use title="a>" xlink:href="https://evil.example/s.svg#a"/></svg>`,
        `<svg ${NS}><rect title="a>b" style="fill:url(https://evil.example/p.svg#p)"/></svg>`,
        `<svg ${NS}><desc title="a>"><script>alert(1)</script></desc></svg>`,
        `<svg ${NS}><![CDATA[<script>alert(1)</script>]]></svg>`,
      ]) {
        const r = await upload(svg);
        ctx.expectProblem(r, 'validation_failed');
        expect(r.body, svg).toMatchObject({ violations: [{ code: 'unsafe_svg' }] });
      }
      const safe = `<svg ${NS} viewBox="0 0 10 10"><!-- a > b --><title>Лотос &gt; знак</title><rect title="a>b" width="10" height="10" fill="#7A3E79"/></svg>`;
      expect((await upload(safe)).status).toBe(201);
    },
  },
  {
    title:
      'знак JPEG и WebP меньше 512×512 или не квадрат — 422 mark_size; размеры читаются у всех растровых',
    operationId: 'uploadBrandingAsset',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      const upload = (contentType: string, contentBase64: string, kind = 'mark') =>
        s.post(`${ctx.lotos}/branding/assets`, {
          kind,
          fileName: contentType === 'image/jpeg' ? 'mark.jpg' : 'mark.webp',
          contentType,
          contentBase64,
        });
      for (const [type, b64] of [
        ['image/jpeg', jpeg(100, 100)],
        ['image/jpeg', jpeg(640, 512)],
        ['image/webp', webp('VP8X', 256, 256)],
        ['image/webp', webp('VP8L', 100, 100)],
        ['image/webp', webp('VP8 ', 512, 300)],
      ] as const) {
        const r = await upload(type, b64);
        ctx.expectProblem(r, 'validation_failed');
        expect(r.body, `${type} ${b64}`).toMatchObject({ violations: [{ code: 'mark_size' }] });
      }
      for (const [type, b64, size] of [
        ['image/jpeg', jpeg(512, 512), 512],
        ['image/webp', webp('VP8X', 1024, 1024), 1024],
        ['image/webp', webp('VP8L', 600, 600), 600],
        ['image/webp', webp('VP8 ', 512, 512), 512],
      ] as const) {
        const r = await upload(type, b64);
        expect(r.status, `${type}: ${JSON.stringify(r.body)}`).toBe(201);
        expect(r.body).toMatchObject({ contentType: type, width: size, height: size });
      }
      // Логотип — любой формы: размеры только записываются.
      const logo = await upload('image/jpeg', jpeg(640, 200), 'logo');
      expect(logo.body).toMatchObject({ kind: 'logo', width: 640, height: 200 });
    },
  },
]);
