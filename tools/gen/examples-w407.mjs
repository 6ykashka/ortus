// Примеры контрактного PR 6 этапа 4 (W4.07, 0.8.0-stage4): места и тарифная сетка, заявки на тариф, «Использование»,
// каталог аккаунтов и операторы платформы, оформление организации. Подключается в tools/gen/examples-seed.mjs после
// примеров W2.57. Сюжеты — сид платформы снимка 19.10 (design/ortus/mock-data.js: platform.priceBook, requests,
// accounts, operators, seedBrands); их воспроизводят MSW (msw/billing, msw/platform, msw/branding) и кейсы conformance
// adapter/test/conformance/cases/billing-w407.ts (PD-43):
// — «Альта Групп» на пробном «Старт» (9 из 10 мест) просит «Команду» на 12 месяцев — заявка SR-13 по версии цен v2;
// — «Лотос» ждёт решения по SR-12 («Команда» → «Бизнес», 12 мес.); оператор подтверждает, повышение — сразу;
// — оператор публикует версию v3 с 01.11 (скидка 12 месяцев 25%) и отменяет её до начала;
// — «Использование»: сводка, сигналы (места «Лотоса» 92%, пробный «Ремстрой», «Карго» приостановлена), модули;
// — каталог: Денис Шишкин заблокирован с причиной; операторы «Ортус · Платформа» — два активных владельца;
// — оформление «Лотоса» (версия 3, «сеанс» вместо «визит»); сохранение версии 4 со светлым акцентом и знаком.
// Время — UTC (сид — Москва, UTC+3), сейчас 2026-10-01 10:30 по Москве.

const RUB = 'RUB';
/** Копия объекта без ключей `keys`. */
const omit = (o, ...keys) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const money = (amountMinor) => ({ amountMinor, currency: RUB });

// ---------------------------------------------------------------------------------------------
// Акцент оформления — алгоритм эталона 19.10 (brandingVM: relLum, contrastW, mixHex, fixAccent, brandVars) и
// 18-branding «Цвет»: контраст с белым ≥ 4.5:1, иначе шаги по 4% к чёрному; производные −18% к чёрному, 86% и 93% к белому.
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r) =>
  '#' +
  r
    .map((x) =>
      Math.max(0, Math.min(255, Math.round(x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();
const relLum = (h) => {
  const [r, g, b] = hex2rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Контраст цвета с белым текстом. */
export const contrastWithWhite = (h) => 1.05 / (relLum(h) + 0.05);
const mixHex = (h, w, t) => {
  const a = hex2rgb(h);
  const b = hex2rgb(w);
  return rgb2hex(a.map((x, i) => x + (b[i] - x) * t));
};
/** accentUsed: цвет владельца, затемнённый шагами по 4% к чёрному до контраста 4.5:1. */
export function fixAccent(hex) {
  let c = hex.toUpperCase();
  for (let n = 0; contrastWithWhite(c) < 4.5 && n < 60; n++) c = mixHex(c, '#000000', 0.04);
  return c;
}
/** BrandingAccentVariants из accentUsed. */
export const accentVariants = (used) => ({
  accent: used,
  hover: mixHex(used, '#000000', 0.18),
  soft: mixHex(used, '#FFFFFF', 0.86),
  tint: mixHex(used, '#FFFFFF', 0.93),
});

// ---------------------------------------------------------------------------------------------
// Тарифная сетка сида (mock-data.js platform.priceBook): v1 с 01.06, v2 с 01.10; цены — в рублях за месяц.
const TERMS_V12 = [
  { months: 1, discountPercent: 0 },
  { months: 4, discountPercent: 5 },
  { months: 8, discountPercent: 10 },
  { months: 12, discountPercent: 20 },
];
const tier = (code, name, seatsLimit, rub) => ({
  code,
  name,
  seatsLimit,
  monthAmountMinor: rub === null ? null : rub * 100,
});
const TIERS_V1 = [
  tier('start', 'Старт', 10, 3500),
  tier('team', 'Команда', 25, 8500),
  tier('biz', 'Бизнес', 50, 14900),
  tier('unl', 'Безлимит', null, null),
];
const TIERS_V2 = [
  tier('start', 'Старт', 10, 3900),
  tier('team', 'Команда', 25, 8900),
  tier('biz', 'Бизнес', 50, 15900),
  tier('net', 'Сеть', 100, 27900),
  tier('unl', 'Безлимит', null, null),
];
/** Начало дня по Москве (00:00 МСК = 21:00Z накануне). */
const mskDay = (y, m, d) =>
  new Date(Date.UTC(y, m - 1, d) - 3 * 3600_000).toISOString().replace('.000Z', 'Z');

/**
 * Расчёт тарифа и срока (PriceTerm): месяц со скидкой — до целых рублей, период — месяц × срок.
 * @returns {object|undefined} SubscriptionQuote; нет цены (Безлимит) — undefined
 */
export function quote(tiers, terms, tierCode, months) {
  const t = tiers.find((x) => x.code === tierCode);
  if (!t || t.monthAmountMinor === null) return undefined;
  const { discountPercent } = terms.find((x) => x.months === months);
  const monthly = Math.round((t.monthAmountMinor * (1 - discountPercent / 100)) / 100) * 100;
  return {
    monthlyAmount: money(monthly),
    periodAmount: money(monthly * months),
    savingAmount: money((t.monthAmountMinor - monthly) * months),
    discountPercent,
  };
}

/**
 * @param {{ id: Function, problem: Function, page: Function, NOW: string, prior: Record<string, Record<string, any>> }} deps
 *   помощники examples-seed.mjs и примеры, собранные раньше (W0.07: getTenantSubscription/ok, listPlatformUsers/ok)
 * @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело
 */
export function stage4w407Examples({ id, problem, page, NOW, prior }) {
  const ex = {};
  const add = (op, name, body) => ((ex[op] ??= {})[name] = body);
  const operator = { accountId: id('platform', 'account:op-1'), displayName: 'Евгения Лаптева' };
  const account = (acc, displayName) => ({ accountId: id('platform', acc), displayName });

  // Тарифная сетка.
  const v1 = {
    version: 1,
    state: 'archived',
    effectiveFrom: mskDay(2026, 6, 1),
    effectiveUntil: mskDay(2026, 10, 1),
    note: 'Стартовая сетка пилота',
    currency: RUB,
    tiers: TIERS_V1,
    terms: TERMS_V12,
    publishedBy: operator,
    subscriptionCount: 3,
  };
  const v2 = {
    version: 2,
    state: 'current',
    effectiveFrom: mskDay(2026, 10, 1),
    note: 'Добавлена ступень «Сеть» до 100 мест, пересчитаны цены',
    currency: RUB,
    tiers: TIERS_V2,
    terms: TERMS_V12,
    publishedBy: operator,
    subscriptionCount: 1,
  };
  const TERMS_V3 = TERMS_V12.map((t) => (t.months === 12 ? { ...t, discountPercent: 25 } : t));
  const v3 = {
    version: 3,
    state: 'scheduled',
    effectiveFrom: mskDay(2026, 11, 1),
    note: 'Скидка за 12 месяцев — 25%',
    currency: RUB,
    tiers: TIERS_V2,
    terms: TERMS_V3,
    publishedAt: NOW,
    publishedBy: operator,
    subscriptionCount: 0,
  };
  /** Вид владельца: без авторов, числа подписок и отменённых версий. */
  const ownerView = (v) => omit(v, 'publishedBy', 'publishedAt', 'subscriptionCount');

  add('getTenantPriceBook', 'ok', { current: ownerView(v2) });
  add('getTenantPriceBook', 'subscribed', {
    current: ownerView({ ...v2, effectiveUntil: v3.effectiveFrom }),
    scheduled: ownerView(v3),
    subscribed: ownerView(v1),
  });
  add(
    'getTenantPriceBook',
    'forbidden_action',
    problem('forbidden_action', 'Подписку видит владелец бизнеса.'),
  );

  // Заявки на тариф.
  const ALTA = id('platform', 't-alta');
  const LOTOS = id('platform', 't-lotos');
  const CARGO = id('platform', 't-cargo');
  const sr12 = {
    id: id('platform', 'subscription-request:SR-12'),
    number: 'SR-12',
    tenantId: LOTOS,
    tenantName: 'SPA «Лотос»',
    fromTierCode: 'team',
    fromTierName: 'Команда',
    fromSeatsLimit: 25,
    toTierCode: 'biz',
    toTierName: 'Бизнес',
    toSeatsLimit: 50,
    termMonths: 12,
    // Заявка от 29.09 — по версии, действовавшей в момент заявки (v2 — с 01.10).
    priceVersion: 1,
    quote: quote(TIERS_V1, TERMS_V12, 'biz', 12),
    seatsUsed: 23,
    comment: 'Открываем второй салон, нужно ещё 10–12 мест',
    status: 'pending',
    requestedAt: '2026-09-29T13:40:00Z',
    requestedBy: account('acc-11', 'Ирина Белова'),
    revision: 1,
  };
  const sr9 = {
    id: id('platform', 'subscription-request:SR-9'),
    number: 'SR-9',
    tenantId: CARGO,
    tenantName: 'Карго Сити',
    fromTierCode: 'start',
    fromTierName: 'Старт',
    fromSeatsLimit: 10,
    toTierCode: 'team',
    toTierName: 'Команда',
    toSeatsLimit: 25,
    termMonths: 4,
    priceVersion: 1,
    quote: quote(TIERS_V1, TERMS_V12, 'team', 4),
    seatsUsed: 10,
    status: 'approved',
    requestedAt: '2026-05-12T08:02:00Z',
    requestedBy: account('acc-13', 'Денис Шишкин'),
    decidedAt: '2026-05-12T12:20:00Z',
    decidedBy: operator,
    decisionNote: 'Оплата по счёту получена',
    effectiveAt: '2026-05-12T12:20:00Z',
    appliedAt: '2026-05-12T12:20:00Z',
    revision: 2,
  };
  const sr13 = {
    id: id('t-alta:example', 'subscription-request:SR-13'),
    number: 'SR-13',
    tenantId: ALTA,
    tenantName: 'Альта Групп',
    fromTierCode: 'start',
    fromTierName: 'Старт',
    fromSeatsLimit: 10,
    toTierCode: 'team',
    toTierName: 'Команда',
    toSeatsLimit: 25,
    termMonths: 12,
    priceVersion: 2,
    quote: quote(TIERS_V2, TERMS_V12, 'team', 12),
    seatsUsed: 9,
    comment: 'Подключаем Самару, нужно ещё 8 мест',
    status: 'pending',
    requestedAt: NOW,
    requestedBy: account('acc-1', 'Дарья Зимина'),
    revision: 1,
  };

  add('listSubscriptionChangeRequests', 'ok', { ...page([sr12]), pendingCount: 1 });
  add(
    'listSubscriptionChangeRequests',
    'forbidden_action',
    problem('forbidden_action', 'Заявки на тариф видит владелец бизнеса.'),
  );
  add('createSubscriptionChangeRequest', 'ok', sr13);
  add(
    'createSubscriptionChangeRequest',
    'request_pending',
    problem('request_pending', 'Заявка уже на рассмотрении. Отмените её, чтобы отправить новую.'),
  );
  add(
    'createSubscriptionChangeRequest',
    'tier_below_usage',
    problem('tier_below_usage', 'В тарифе «Старт» 10 мест, а занято 23', {
      violations: [
        {
          field: 'tierCode',
          code: 'tier_below_usage',
          message: 'В тарифе «Старт» 10 мест, а занято 23',
        },
      ],
    }),
  );
  add('cancelSubscriptionChangeRequest', 'ok', {
    ...sr12,
    status: 'cancelled',
    decidedAt: NOW,
    decidedBy: account('acc-11', 'Ирина Белова'),
    revision: 2,
  });
  add(
    'cancelSubscriptionChangeRequest',
    'invalid_transition',
    problem('invalid_transition', 'Заявка уже рассмотрена.'),
  );

  add('listPlatformSubscriptionRequests', 'ok', { ...page([sr12, sr9]), pendingCount: 1 });
  add(
    'listPlatformSubscriptionRequests',
    'not_found',
    problem('not_found', 'Организация не найдена.'),
  );
  add('decidePlatformSubscriptionRequest', 'ok', {
    ...sr12,
    status: 'approved',
    decidedAt: NOW,
    decidedBy: operator,
    decisionNote: 'Оплата по счёту получена',
    effectiveAt: NOW,
    appliedAt: NOW,
    revision: 2,
  });
  add(
    'decidePlatformSubscriptionRequest',
    'validation_failed',
    problem('validation_failed', 'Укажите причину отказа.', {
      violations: [{ field: 'note', code: 'required', message: 'Укажите причину отказа' }],
    }),
  );
  add(
    'decidePlatformSubscriptionRequest',
    'invalid_transition',
    problem('invalid_transition', 'Заявка уже рассмотрена или отменена.'),
  );

  add('listPriceBookVersions', 'ok', page([v2, v1]));
  add('listPriceBookVersions', 'not_found', problem('not_found', 'Раздел не найден.'));
  add('publishPriceBookVersion', 'ok', v3);
  add(
    'publishPriceBookVersion',
    'validation_failed',
    problem('validation_failed', 'Проверьте ступени сетки.', {
      violations: [
        {
          field: 'tiers[1].monthAmountMinor',
          code: 'not_increasing',
          message: 'Цена должна расти от ступени к ступени',
        },
      ],
    }),
  );
  add(
    'publishPriceBookVersion',
    'invalid_transition',
    problem(
      'invalid_transition',
      'Уже запланирована версия v3. Отмените её, чтобы подготовить другую.',
    ),
  );
  const { publishedAt, ...v3Cancelled } = v3;
  add('cancelPriceBookVersion', 'ok', {
    ...v3Cancelled,
    publishedAt,
    state: 'cancelled',
    cancelledAt: NOW,
  });
  add(
    'cancelPriceBookVersion',
    'invalid_transition',
    problem('invalid_transition', 'Запланированной версии нет.'),
  );

  // «Использование» (сид снимка 19.10: места, объём файлов, модули, последние входы).
  const GB = 1024 ** 3;
  const bytes = (gb) => Math.round(gb * GB);
  const seats = (limit, used, invited = 0) => ({
    limit,
    used,
    active: used - invited,
    invited,
    available: limit === null ? null : Math.max(0, limit - used),
  });
  const mark = (shortName, accentHex) => ({ shortName, accentUsed: fixAccent(accentHex) });
  const usageTenants = [
    {
      tenantId: ALTA,
      name: 'Альта Групп',
      status: 'trial',
      ownerName: 'Дарья Зимина',
      tierCode: 'start',
      tierName: 'Старт',
      seats: seats(10, 9, 2),
      storageUsedBytes: bytes(46.2),
      storageQuotaBytes: 100 * GB,
      moduleKeys: ['spa'],
      memberCount: 10,
      activeMembers: 7,
      activeMembers7d: 7,
      lastSignInAt: '2026-10-01T06:12:00Z',
      brand: { accentUsed: '#1F6B52' },
    },
    {
      tenantId: LOTOS,
      name: 'SPA «Лотос»',
      status: 'active',
      ownerName: 'Ирина Белова',
      tierCode: 'team',
      tierName: 'Команда',
      seats: seats(25, 23),
      storageUsedBytes: bytes(12.4),
      storageQuotaBytes: 50 * GB,
      moduleKeys: ['spa'],
      memberCount: 23,
      activeMembers: 23,
      // Входы сида позже «сейчас» (fillAccounts) не считаются.
      activeMembers7d: 12,
      lastSignInAt: '2026-10-01T07:14:00Z',
      brand: mark('Лотос', '#7A3E79'),
    },
    {
      tenantId: id('platform', 't-remstroy'),
      name: 'Ремстрой Плюс',
      status: 'read_only',
      ownerName: 'Павел Орлов',
      tierCode: 'start',
      tierName: 'Старт',
      seats: seats(10, 5),
      storageUsedBytes: bytes(19.8),
      storageQuotaBytes: 25 * GB,
      moduleKeys: ['repairs'],
      memberCount: 5,
      activeMembers: 5,
      activeMembers7d: 2,
      lastSignInAt: '2026-10-01T06:27:00Z',
      brand: mark('Ремстрой', '#9A4A1F'),
    },
    {
      tenantId: CARGO,
      name: 'Карго Сити',
      status: 'suspended',
      ownerName: 'Денис Шишкин',
      tierCode: 'team',
      tierName: 'Команда',
      seats: seats(25, 22),
      storageUsedBytes: bytes(63),
      storageQuotaBytes: 100 * GB,
      moduleKeys: ['fleet'],
      memberCount: 22,
      activeMembers: 22,
      activeMembers7d: 0,
      lastSignInAt: '2026-09-18T20:51:00Z',
      brand: mark('Карго', '#2B5479'),
    },
  ];
  const sum = (f) => usageTenants.reduce((s, t) => s + f(t), 0);
  const tenantOf = (t) => ({ tenantId: t.tenantId, name: t.name });
  add('getPlatformUsage', 'ok', {
    measuredAt: NOW,
    summary: {
      tenantCount: usageTenants.length,
      tenantsByStatus: ['trial', 'active', 'read_only', 'suspended'].map((status) => ({
        status,
        count: usageTenants.filter((t) => t.status === status).length,
      })),
      seatsUsed: sum((t) => t.seats.used),
      seatsSold: sum((t) => t.seats.limit ?? 0),
      storageUsedBytes: sum((t) => t.storageUsedBytes),
      storageQuotaBytes: sum((t) => t.storageQuotaBytes),
      activeMembers: sum((t) => t.activeMembers),
      activeMembers7d: sum((t) => t.activeMembers7d),
    },
    signals: [
      {
        tenantId: LOTOS,
        tenantName: 'SPA «Лотос»',
        kind: 'seats_low',
        level: 'medium',
        seatsUsed: 23,
        seatsLimit: 25,
        changeRequestId: sr12.id,
        changeRequestNumber: 'SR-12',
      },
      {
        tenantId: ALTA,
        tenantName: 'Альта Групп',
        kind: 'seats_low',
        level: 'medium',
        seatsUsed: 9,
        seatsLimit: 10,
      },
      {
        tenantId: CARGO,
        tenantName: 'Карго Сити',
        kind: 'seats_low',
        level: 'medium',
        seatsUsed: 22,
        seatsLimit: 25,
      },
      {
        tenantId: CARGO,
        tenantName: 'Карго Сити',
        kind: 'suspended',
        level: 'medium',
      },
      {
        tenantId: CARGO,
        tenantName: 'Карго Сити',
        kind: 'inactive',
        level: 'medium',
        lastSignInDays: 12,
      },
      {
        tenantId: usageTenants[2].tenantId,
        tenantName: 'Ремстрой Плюс',
        kind: 'storage_high',
        level: 'medium',
        storageUsedBytes: bytes(19.8),
        storageQuotaBytes: 25 * GB,
        storagePercent: 79,
      },
      {
        tenantId: usageTenants[2].tenantId,
        tenantName: 'Ремстрой Плюс',
        kind: 'trial_expired',
        level: 'medium',
      },
      {
        tenantId: ALTA,
        tenantName: 'Альта Групп',
        kind: 'trial_ending',
        level: 'low',
        trialEndsAt: '2026-10-13T21:00:00Z',
        daysLeft: 12,
      },
    ],
    // Сигналы — по уровню, затем по названию организации (кодовые точки), затем по виду; модули — fleet, spa, repairs.
    modules: [
      ['fleet', [usageTenants[3]]],
      ['spa', [usageTenants[0], usageTenants[1]]],
      ['repairs', [usageTenants[2]]],
    ].map(([moduleKey, list]) => ({
      moduleKey,
      tenantCount: list.length,
      seatsUsed: list.reduce((s, t) => s + t.seats.used, 0),
      storageUsedBytes: list.reduce((s, t) => s + t.storageUsedBytes, 0),
      tenants: list.map(tenantOf),
    })),
    tenants: usageTenants,
  });
  add('getPlatformUsage', 'not_found', problem('not_found', 'Раздел не найден.'));

  // Каталог аккаунтов.
  const membership = (tenant, tenantName, tenantStatus, status, owner = false) => ({
    tenantId: id('platform', tenant),
    tenantName,
    tenantStatus,
    status,
    owner,
  });
  const shishkin = {
    id: id('platform', 'acc-13'),
    displayName: 'Денис Шишкин',
    email: 'd.shishkin@cargo.example',
    status: 'suspended',
    lastSeenAt: '2026-09-18T20:51:00Z',
    tenantCount: 1,
    mfaEnabled: true,
    lockedAt: '2026-09-18T21:10:00Z',
    lockReason: 'Подозрительные входы из разных стран, 18.09',
    memberships: [membership('t-cargo', 'Карго Сити', 'suspended', 'active', true)],
  };
  const vasiliev = {
    id: id('platform', 'acc-3'),
    displayName: 'Илья Васильев',
    email: 'i.vasiliev@alta.example',
    status: 'active',
    lastSeenAt: '2026-10-01T04:55:00Z',
    tenantCount: 1,
    mfaEnabled: false,
    memberships: [membership('t-alta', 'Альта Групп', 'trial', 'active')],
  };
  const zimina = {
    id: id('platform', 'acc-1'),
    displayName: 'Дарья Зимина',
    email: 'd.zimina@alta.example',
    status: 'active',
    lastSeenAt: '2026-10-01T06:12:00Z',
    tenantCount: 1,
    mfaEnabled: true,
    memberships: [membership('t-alta', 'Альта Групп', 'trial', 'active', true)],
  };
  const kotova = {
    id: id('platform', 'acc-2'),
    displayName: 'Марина Котова',
    email: 'm.kotova@alta.example',
    status: 'active',
    lastSeenAt: '2026-10-01T05:40:00Z',
    tenantCount: 1,
    mfaEnabled: true,
    memberships: [
      membership('t-alta', 'Альта Групп', 'trial', 'active'),
      membership('t-cargo', 'Карго Сити', 'suspended', 'ended'),
    ],
  };
  add('getPlatformUser', 'ok', kotova);
  add('getPlatformUser', 'locked', shishkin);
  add('getPlatformUser', 'not_found', problem('not_found', 'Аккаунт не найден.'));
  const shishkinRow = omit(shishkin, 'memberships');
  const COUNTS = { all: 58, multiTenant: 2, noMfa: 36, locked: 1, neverSignedIn: 2 };
  add('listPlatformUsers', 'locked', { ...page([shishkinRow]), counts: COUNTS });
  add('lockPlatformUser', 'ok', {
    ...vasiliev,
    status: 'suspended',
    lockedAt: NOW,
    lockReason: 'Потерян телефон с открытой сессией, 01.10',
  });
  add(
    'lockPlatformUser',
    'validation_failed',
    problem('validation_failed', 'Укажите причину блокировки.', {
      violations: [{ field: 'reason', code: 'length', message: 'Не короче 5 символов' }],
    }),
  );
  add(
    'lockPlatformUser',
    'invalid_transition',
    problem('invalid_transition', 'Вход уже заблокирован.'),
  );
  const unlocked = omit(shishkin, 'lockedAt', 'lockReason');
  add('unlockPlatformUser', 'ok', { ...unlocked, status: 'active' });
  add(
    'unlockPlatformUser',
    'invalid_transition',
    problem('invalid_transition', 'Вход не заблокирован.'),
  );
  add('resetPlatformUserMfa', 'ok', { ...zimina, mfaEnabled: false });
  add(
    'resetPlatformUserMfa',
    'invalid_transition',
    problem('invalid_transition', 'Второй фактор не настроен.'),
  );

  // Операторы «Ортус · Платформа» (mock-data.js platform.operators).
  const msk = (dd, mm, hh, mi) =>
    new Date(Date.UTC(2026, mm - 1, dd, hh - 3, mi)).toISOString().replace('.000Z', 'Z');
  const op = (opId, displayName, email, role, status, mfa, lastSeenAt, extra = {}) => ({
    id: id('platform', opId),
    accountId: id('platform', `account:${opId}`),
    displayName,
    email,
    role,
    status,
    ...(mfa ? { mfa } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    me: opId === 'op-1',
    revision: 1,
    ...extra,
  });
  const operators = [
    op(
      'op-1',
      'Евгения Лаптева',
      'e.lapteva@ortus.example',
      'owner',
      'active',
      'webauthn',
      msk(2, 10, 9, 5),
    ),
    op(
      'op-2',
      'Михаил Сорокин',
      'm.sorokin@ortus.example',
      'owner',
      'active',
      'totp',
      msk(1, 10, 18, 22),
    ),
    op(
      'op-3',
      'Алёна Гусева',
      'a.guseva@ortus.example',
      'billing',
      'active',
      'totp',
      msk(2, 10, 8, 40),
    ),
    op(
      'op-4',
      'Игорь Пахомов',
      'i.pakhomov@ortus.example',
      'support',
      'active',
      'totp',
      msk(2, 10, 7, 58),
    ),
    op('op-5', 'Дина Валиева', 'd.valieva@ortus.example', 'support', 'invited', null, null),
    op(
      'op-6',
      'Станислав Рябов',
      's.ryabov@ortus.example',
      'admin',
      'disabled',
      'totp',
      msk(12, 8, 17, 10),
      {
        disabledAt: msk(15, 8, 0, 0),
        disabledReason: 'Отключён 15.08: перевод в другой отдел',
      },
    ),
  ];
  add('listPlatformOperators', 'ok', { ...page(operators), activeOwnerCount: 2 });
  add('listPlatformOperators', 'not_found', problem('not_found', 'Раздел не найден.'));
  add('invitePlatformOperator', 'ok', {
    id: id('platform:example', 'op-7'),
    accountId: id('platform:example', 'account:op-7'),
    displayName: 'Ольга Миронова',
    email: 'o.mironova@ortus.example',
    role: 'support',
    status: 'invited',
    me: false,
    revision: 1,
  });
  add(
    'invitePlatformOperator',
    'validation_failed',
    problem('validation_failed', 'Проверьте почту оператора.', {
      violations: [
        {
          field: 'email',
          code: 'domain',
          message: 'Оператором может быть только сотрудник платформы: почта в домене ortus.example',
        },
      ],
    }),
  );
  add('updatePlatformOperator', 'ok', { ...operators[2], role: 'admin', revision: 2 });
  add(
    'updatePlatformOperator',
    'last_owner_required',
    problem('last_owner_required', 'На платформе должен остаться хотя бы один активный владелец.'),
  );
  add(
    'updatePlatformOperator',
    'validation_failed',
    problem('validation_failed', 'Владельцем может стать только работающий оператор.', {
      violations: [
        {
          field: 'role',
          code: 'owner_requires_active_mfa',
          message: 'Владельцем может стать только активный оператор со вторым фактором',
        },
      ],
    }),
  );

  // Оформление «Лотоса» (seedBrands: версия 3, «сеанс» вместо «визит», акцент «Сливовый»).
  const lotosBrand = {
    version: 3,
    displayName: 'SPA «Лотос»',
    shortName: 'Лотос',
    accentHex: '#7A3E79',
    accentUsed: fixAccent('#7A3E79'),
    accentVariants: accentVariants(fixAccent('#7A3E79')),
    terms: { visit: { one: 'сеанс', plural: 'сеансы', few: 'сеанса', many: 'сеансов' } },
    menu: { items: {}, order: [] },
    poweredBy: true,
    updatedAt: '2026-09-24T09:10:00Z',
    updatedBy: account('acc-11', 'Ирина Белова'),
  };
  // sha256 знака кейса conformance (PNG 512×512: заголовок IHDR и нули, 48 213 байт).
  const MARK_SHA = '0651366c1bbe04aa80c06f4013d157607d512970e0b987e6a0d211a06dc0c045';
  const markAsset = {
    id: id('t-lotos:example', 'brand-mark-lotos'),
    kind: 'mark',
    url: `/brand-assets/${MARK_SHA}.png`,
    contentType: 'image/png',
    sizeBytes: 48213,
    sha256: MARK_SHA,
    width: 512,
    height: 512,
  };
  /** Оформление версии 1 по умолчанию (seedBrands без своих полей) — с коротким именем и акцентом организации. */
  const standardBrand = (displayName, shortName = null, accentHex = '#1F6B52') => ({
    version: 1,
    displayName,
    shortName,
    accentHex,
    accentUsed: fixAccent(accentHex),
    accentVariants: accentVariants(fixAccent(accentHex)),
    terms: {},
    menu: { items: {}, order: [] },
    poweredBy: true,
  });
  const altaBrand = standardBrand('Альта Групп');
  add('getTenantBranding', 'ok', lotosBrand);
  add('getTenantBranding', 'standard', altaBrand);
  add(
    'getTenantBranding',
    'forbidden_action',
    problem('forbidden_action', 'Оформление меняет только владелец бизнеса.'),
  );
  // Светлый акцент владельца: контраст с белым меньше 4.5:1 — сервер затемняет его до accentUsed.
  const light = '#C9A227';
  add('updateTenantBranding', 'ok', {
    ...lotosBrand,
    version: 4,
    accentHex: light,
    accentUsed: fixAccent(light),
    accentVariants: accentVariants(fixAccent(light)),
    mark: markAsset,
    menu: { items: { calendar: { label: 'Записи', icon: 'event_available' } }, order: [] },
    updatedAt: NOW,
  });
  add(
    'updateTenantBranding',
    'validation_failed',
    problem('validation_failed', 'Проверьте оформление.', {
      violations: [
        {
          field: 'terms.visit.many',
          code: 'required',
          message: 'Термин «визит»: заполните все четыре формы',
        },
      ],
    }),
  );
  // Текст 412 — подсказка реестра api/errors.yaml («Данные изменились»): в эталоне состояния нет (возврат 1).
  add(
    'updateTenantBranding',
    'revision_mismatch',
    problem('revision_mismatch', 'Данные изменились. Обновите оформление и повторите.'),
  );
  add('uploadBrandingAsset', 'ok', markAsset);
  add(
    'uploadBrandingAsset',
    'validation_failed',
    problem('validation_failed', 'Нужен PNG, SVG, JPG или WebP.', {
      violations: [
        { field: 'contentType', code: 'content_type', message: 'Нужен PNG, SVG, JPG или WebP' },
      ],
    }),
  );
  add(
    'uploadBrandingAsset',
    'payload_too_large',
    problem('payload_too_large', 'Файл больше 1 МБ.'),
  );

  // Подписка с местами и условиями периода (Subscription W4.07).
  add('getTenantSubscription', 'seats', {
    planKey: 'team',
    status: 'active',
    periodEndsAt: '2027-03-31T21:00:00Z',
    cancelAtPeriodEnd: false,
    // sourceRef прав — версия сетки сида на момент проекции (v2, W0.13); версия оплаченного периода — priceVersion.
    entitlements: [
      { key: 'seats', sourceType: 'plan', sourceRef: 'price-book:v2:team', value: 25 },
      {
        key: 'storage_quota_bytes',
        sourceType: 'plan',
        sourceRef: 'price-book:v2:team',
        value: 50 * GB,
      },
    ],
    revision: 1,
    tierCode: 'team',
    tierName: 'Команда',
    termMonths: 12,
    priceVersion: 1,
    monthlyAmount: money(680000),
    periodAmount: money(8160000),
    seats: seats(25, 23),
  });
  // Пример W0.07 «Альты» (пробный «Старт» по версии 2): + тариф, версия цен и места; срока и сумм нет.
  const altaSub = prior.getTenantSubscription?.ok;
  if (!altaSub) throw new Error('examples-w407: нет getTenantSubscription/ok');
  add('getTenantSubscription', 'ok', {
    ...altaSub,
    tierCode: 'start',
    tierName: 'Старт',
    priceVersion: 2,
    seats: seats(10, 9, 2),
  });
  // Каталог W0.07 (13 аккаунтов выписки): + второй фактор, блокировка и счётчики фильтров каталога (58 аккаунтов).
  const users = prior.listPlatformUsers?.ok;
  if (!users) throw new Error('examples-w407: нет listPlatformUsers/ok');
  const WITH_MFA = new Set(['acc-1', 'acc-2', 'acc-8', 'acc-11', 'acc-13']);
  const proto = new Map(
    Array.from({ length: 13 }, (_, i) => [id('platform', `acc-${i + 1}`), `acc-${i + 1}`]),
  );
  add('listPlatformUsers', 'ok', {
    ...users,
    items: users.items.map((u) => {
      const p = proto.get(u.id);
      const out = { ...u, mfaEnabled: WITH_MFA.has(p) };
      return p === 'acc-13'
        ? { ...out, lockedAt: shishkin.lockedAt, lockReason: shishkin.lockReason }
        : out;
    }),
    counts: COUNTS,
  });

  // Возврат 1: поля W4.07 в ответах прежних операций — их отдаёт mock (PD-43: примеры — снимки сервера).
  // Подписка глазами оператора — то же тело, что у владельца (условия периода и места).
  const platformSub = prior.getPlatformSubscription?.ok;
  if (!platformSub) throw new Error('examples-w407: нет getPlatformSubscription/ok');
  add('getPlatformSubscription', 'ok', {
    ...platformSub,
    tierCode: 'start',
    tierName: 'Старт',
    priceVersion: 2,
    seats: seats(10, 9, 2),
  });
  add('getPlatformSubscription', 'seats', ex.getTenantSubscription.seats);

  // Организация оператора: места, участники, тариф и знак — как строка «Использования».
  const usageById = new Map(usageTenants.map((t) => [t.tenantId, t]));
  const withUsage = (t) => {
    const u = usageById.get(t.id);
    // Новая организация (createPlatformTenant): пробный «Старт», 10 мест, участников ещё нет, оформление по умолчанию.
    const row = u ?? {
      seats: seats(10, 0),
      memberCount: 0,
      tierCode: 'start',
      brand: { accentUsed: '#1F6B52' },
    };
    return {
      ...t,
      seats: row.seats,
      memberCount: row.memberCount,
      tierCode: row.tierCode,
      brand: row.brand,
    };
  };
  const tenantsPage = prior.listPlatformTenants?.ok;
  if (!tenantsPage) throw new Error('examples-w407: нет listPlatformTenants/ok');
  add('listPlatformTenants', 'ok', { ...tenantsPage, items: tenantsPage.items.map(withUsage) });
  for (const op of [
    'getPlatformTenant',
    'createPlatformTenant',
    'updatePlatformTenant',
    'suspendPlatformTenant',
    'resumePlatformTenant',
  ]) {
    const body = prior[op]?.ok;
    if (!body) throw new Error(`examples-w407: нет ${op}/ok`);
    add(op, 'ok', withUsage(body));
  }

  // Контекст: тема действующего оформления каждой организации (TenantContext.branding → BrandingTheme, возврат 2:
  // без updatedAt и updatedBy — автора версии видит только владелец; seedBrands снимка 19.10).
  const theme = (b) => {
    const out = { ...b };
    delete out.updatedAt;
    delete out.updatedBy;
    return out;
  };
  const brandingById = new Map([
    [ALTA, altaBrand],
    [LOTOS, lotosBrand],
    [id('platform', 't-remstroy'), standardBrand('Ремстрой Плюс', 'Ремстрой', '#9A4A1F')],
  ]);
  const withBranding = (me) => ({
    ...me,
    tenants: me.tenants.map((t) => {
      const branding = brandingById.get(t.tenantId);
      if (!branding) throw new Error(`examples-w407: нет оформления ${t.name}`);
      return { ...t, branding: theme(branding) };
    }),
  });
  for (const op of ['getMyContext', 'selectTenant']) {
    for (const [name, body] of Object.entries(prior[op] ?? {})) {
      if (Array.isArray(body?.tenants)) add(op, name, withBranding(body));
    }
  }
  return ex;
}
