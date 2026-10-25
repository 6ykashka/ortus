// W1.25 · Модель «Организаций» оператора: подписи строк и карточки по Tenant и Subscription контракта,
// доступность команд (Q-W1.00-2, 3, 6), причина 5–500 (Q-W1.00-1), строка «Журнала действий» (S1-23, Q-W1.48-8).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  actionsFor,
  auditLine,
  markLetter,
  membersText,
  modulesText,
  mskDate,
  ownerLine,
  paymentText,
  planText,
  quotaGb,
  quotaOptions,
  quotaText,
  quotaUpdate,
  REASON_MAX,
  reasonOk,
  reasonTooLong,
  requestText,
  seatsFill,
  seatsOf,
  seatsText,
  shortName,
  statusChip,
  storageFill,
  trialText,
  usageText,
} from './model.ts';

type S = components['schemas'];

const GiB = 1024 ** 3;
/** «Сейчас» харнесса и сида: 01.10.2026 10:30 по Москве. */
const NOW = Date.parse('2026-10-01T07:30:00Z');

const ent = (
  key: string,
  value: number,
  sourceType: S['Entitlement']['sourceType'] = 'trial',
  sourceRef = 'price-book:v2:start',
): S['Entitlement'] => ({ key, value, sourceType, sourceRef });

const alta: S['Subscription'] = {
  planKey: 'start',
  status: 'trialing',
  trialEndsAt: '2026-10-13T21:00:00Z',
  cancelAtPeriodEnd: false,
  entitlements: [ent('seats', 10), ent('storage_quota_bytes', 100 * GiB)],
  revision: 2,
};
const lotos: S['Subscription'] = {
  planKey: 'team',
  status: 'active',
  periodEndsAt: '2027-03-31T21:00:00Z',
  cancelAtPeriodEnd: false,
  entitlements: [
    ent('seats', 25, 'plan', 'price-book:v1:team'),
    ent('storage_quota_bytes', 50 * GiB, 'plan', 'price-book:v1:team'),
  ],
  revision: 1,
};
const remstroy: S['Subscription'] = {
  planKey: 'start',
  status: 'read_only',
  trialEndsAt: '2026-09-20T21:00:00Z',
  cancelAtPeriodEnd: false,
  entitlements: [ent('seats', 10), ent('storage_quota_bytes', 25 * GiB)],
  revision: 1,
};
const cargo: S['Subscription'] = {
  planKey: 'team',
  status: 'past_due',
  periodEndsAt: '2026-09-15T21:00:00Z',
  cancelAtPeriodEnd: false,
  entitlements: [
    ent('seats', 25, 'plan', 'price-book:v1:team'),
    ent('storage_quota_bytes', 100 * GiB, 'plan', 'price-book:v1:team'),
  ],
  revision: 1,
};

describe('чип статуса организации (TENANT_STATE эталона, бриф §10 п. 4)', () => {
  it('trial — «Пробный период», info, hourglass_top', () => {
    expect(statusChip('trial')).toEqual({
      label: 'Пробный период',
      tone: 'info',
      icon: 'hourglass_top',
    });
  });
  it('active — «Действует», ok, check_circle', () => {
    expect(statusChip('active')).toEqual({ label: 'Действует', tone: 'ok', icon: 'check_circle' });
  });
  it('grace и read_only — «Ограничен», warn, lock_clock', () => {
    const restricted = { label: 'Ограничен', tone: 'warn', icon: 'lock_clock' };
    expect(statusChip('grace')).toEqual(restricted);
    expect(statusChip('read_only')).toEqual(restricted);
  });
  it('suspended — «Приостановлен», danger, pause_circle', () => {
    expect(statusChip('suspended')).toEqual({
      label: 'Приостановлен',
      tone: 'danger',
      icon: 'pause_circle',
    });
  });
  it('без эталона: provisioning, closing, closed — нейтральные', () => {
    expect(statusChip('provisioning').label).toBe('Создаётся');
    expect(statusChip('closing').label).toBe('Закрывается');
    expect(statusChip('closed').label).toBe('Закрыта');
    expect(statusChip('closed').tone).toBe('neutral');
  });
});

describe('даты и пробный период', () => {
  it('конец периода — последний день по Москве (полночь следующего дня исключается)', () => {
    expect(mskDate('2026-10-13T21:00:00Z')).toBe('13.10.2026');
    expect(mskDate('2026-10-13T20:59:59Z')).toBe('13.10.2026');
    expect(mskDate('2027-03-31T21:00:00Z')).toBe('31.03.2027');
  });
  it('trialing: «Осталось 12 дн. · до 13.10.2026» на 01.10.2026', () => {
    expect(trialText(alta, NOW)).toBe('Осталось 12 дн. · до 13.10.2026');
  });
  it('после продления на 14 дней: «Осталось 26 дн. · до 27.10.2026»', () => {
    expect(trialText({ ...alta, trialEndsAt: '2026-10-27T21:00:00Z' }, NOW)).toBe(
      'Осталось 26 дн. · до 27.10.2026',
    );
  });
  it('read_only после пробного периода: «Завершён 20.09.2026»', () => {
    expect(trialText(remstroy, NOW)).toBe('Завершён 20.09.2026');
  });
  it('read_only после пробного периода без даты конца (стенд не отдаёт trialEndsAt): «Завершён —»', () => {
    const noEnd: S['Subscription'] = { ...remstroy };
    delete noEnd.trialEndsAt;
    expect(trialText(noEnd, NOW)).toBe('Завершён —');
  });
  it('оплаченная подписка: «Не применяется»', () => {
    expect(trialText(lotos, NOW)).toBe('Не применяется');
    expect(trialText(cargo, NOW)).toBe('Не применяется');
  });
  it('подписка ещё не прочитана: «—»', () => {
    expect(trialText(undefined, NOW)).toBe('—');
  });
});

/** Условия периода W4.07 (Subscription.tierName, termMonths, priceVersion, monthlyAmount). */
const lotosPaid: S['Subscription'] = {
  ...lotos,
  tierCode: 'team',
  tierName: 'Команда',
  termMonths: 12,
  priceVersion: 1,
  monthlyAmount: { amountMinor: 680_000, currency: 'RUB' },
  seats: { limit: 25, used: 23, active: 23, invited: 0, available: 2 },
};
const NB = ' ';

describe('тариф и оплата (W4.84: срок, версия цен и сумма из Subscription)', () => {
  it('пробный: «Старт» · пробный · цены v2', () => {
    expect(planText(alta)).toBe('«Старт» · пробный · цены v2');
    expect(planText({ ...alta, tierName: 'Старт', priceVersion: 2 })).toBe(
      '«Старт» · пробный · цены v2',
    );
  });
  it('оплаченный: срок — «12 мес», помесячный — «помесячно»; версия цен — priceVersion, а не sourceRef', () => {
    expect(planText(lotosPaid)).toBe('«Команда» · 12 мес · цены v1');
    expect(planText({ ...lotosPaid, termMonths: 1 })).toBe('«Команда» · помесячно · цены v1');
    expect(planText({ ...lotosPaid, termMonths: 4, priceVersion: 3 })).toBe(
      '«Команда» · 4 мес · цены v3',
    );
  });
  it('без срока (до W4.60 или после неоплаченного trial) — без срока; версия — из sourceRef', () => {
    expect(planText(lotos)).toBe('«Команда» · цены v1');
    expect(planText(remstroy)).toBe('«Старт» · цены v2');
    expect(planText({ ...remstroy, status: 'grace', priceVersion: 1 })).toBe('«Старт» · цены v1');
  });
  it('имя тарифа — tierName сетки; неизвестный ключ без имени — как есть, без версии', () => {
    expect(planText({ ...lotosPaid, tierName: 'Команда+' })).toBe('«Команда+» · 12 мес · цены v1');
    expect(planText({ ...lotos, planKey: 'vip', entitlements: [] })).toBe('«vip»');
  });
  it('оплата: пробный период, «Оплачено до … · 6 800 ₽/мес», без суммы — только дата, иначе «—»', () => {
    expect(paymentText(alta)).toBe('Пробный период');
    expect(paymentText(lotosPaid)).toBe(`Оплачено до 31.03.2027 · 6${NB}800 ₽/мес`);
    expect(paymentText(lotos)).toBe('Оплачено до 31.03.2027');
    expect(paymentText(remstroy)).toBe('—');
    expect(paymentText(undefined)).toBe('—');
  });
});

describe('места, место и полосы (W4.84: Tenant.seats, Subscription.seats, getPlatformUsage)', () => {
  const seats = (used: number, limit: number | null): S['SeatUsage'] => ({
    limit,
    used,
    active: used,
    invited: 0,
    available: limit === null ? null : Math.max(0, limit - used),
  });
  const tenant: S['Tenant'] = {
    id: '00000000-0000-5000-8000-000000000001',
    name: 'Альта Групп',
    status: 'trial',
    ownerUserIds: [],
    createdAt: '2026-09-30T15:12:00Z',
    revision: 1,
    seats: seats(9, 10),
  };
  it('места: подписки, иначе организации; нет нигде — undefined', () => {
    expect(seatsOf(tenant, lotosPaid)).toEqual(lotosPaid.seats);
    expect(seatsOf(tenant, alta)).toEqual(seats(9, 10));
    const bare: S['Tenant'] = { ...tenant };
    delete bare.seats;
    expect(seatsOf(bare, alta)).toBeUndefined();
  });
  it('строка владельца: «Владелец: Дарья Зимина · мест 9/10», без лимита — только занятые', () => {
    expect(ownerLine('Дарья Зимина', seats(9, 10))).toBe('Владелец: Дарья Зимина · мест 9/10');
    expect(ownerLine('Дарья Зимина', seats(40, null))).toBe('Владелец: Дарья Зимина · мест 40');
  });
  it('строка владельца без данных: владелец и места — «—»', () => {
    expect(ownerLine(undefined, seats(9, 10))).toBe('Владелец: — · мест 9/10');
    expect(ownerLine('', undefined)).toBe('Владелец: — · мест —');
  });
  it('место: «46,2 из 100 ГБ», занятое не загружено — «— из 100 ГБ», без квоты — «—»', () => {
    expect(usageText(46.2 * GiB + 1234, alta)).toBe('46,2 из 100 ГБ');
    expect(usageText(63 * GiB, cargo)).toBe('63 из 100 ГБ');
    expect(usageText(undefined, alta)).toBe('— из 100 ГБ');
    expect(usageText(0, { ...alta, entitlements: [ent('storage_quota_bytes', 12.5 * GiB)] })).toBe(
      '0 из 12,5 ГБ',
    );
    expect(usageText(10 * GiB, undefined)).toBe('—');
  });
  it('полоса места: ширина по занятому (до 100 %), > 85 % — warn, занято всё — danger', () => {
    expect(storageFill(46.2 * GiB, alta)).toEqual({ width: '46.2%', tone: 'accent' });
    expect(storageFill(19.8 * GiB, remstroy)).toEqual({ width: '79.2%', tone: 'accent' });
    expect(storageFill(90 * GiB, alta)).toEqual({ width: '90.0%', tone: 'warn' });
    expect(
      storageFill(46.2 * GiB, { ...alta, entitlements: [ent('storage_quota_bytes', 25 * GiB)] }),
    ).toEqual({
      width: '100.0%',
      tone: 'danger',
    });
    expect(storageFill(undefined, alta)).toEqual({ width: '0%', tone: 'accent' });
    expect(storageFill(5 * GiB, undefined)).toEqual({ width: '0%', tone: 'accent' });
  });
  it('места с входом: «9 из 10», все заняты — «· мест нет», без лимита — «· без ограничения»', () => {
    expect(seatsText(seats(9, 10))).toBe('9 из 10');
    expect(seatsText(seats(10, 10))).toBe('10 из 10 · мест нет');
    expect(seatsText(seats(40, null))).toBe('40 · без ограничения');
    expect(seatsText(undefined)).toBe('—');
  });
  it('полоса мест: > 80 % — warn, все заняты — danger, без лимита — пустая', () => {
    expect(seatsFill(seats(9, 10))).toEqual({ width: '90.0%', tone: 'warn' });
    expect(seatsFill(seats(8, 10))).toEqual({ width: '80.0%', tone: 'accent' });
    expect(seatsFill(seats(10, 10))).toEqual({ width: '100.0%', tone: 'danger' });
    expect(seatsFill(seats(40, null))).toEqual({ width: '0.0%', tone: 'accent' });
    expect(seatsFill(undefined)).toEqual({ width: '0%', tone: 'accent' });
  });
  it('модули: названия каталога через запятую, без модулей — «Только ядро», не загружены — «—»', () => {
    expect(modulesText(['spa'])).toBe('Салон и SPA');
    expect(modulesText(['fleet', 'repairs'])).toBe('Логистика, Ремонт и стройка');
    expect(modulesText(['warehouse'])).toBe('warehouse');
    expect(modulesText([])).toBe('Только ядро');
    expect(modulesText(undefined)).toBe('—');
  });
  it('участники: число, не загружено — «—»', () => {
    expect(membersText(10)).toBe('10');
    expect(membersText(0)).toBe('0');
    expect(membersText(undefined)).toBe('—');
  });
  it('квота в гигабайтах', () => {
    expect(quotaText(lotos)).toBe('50 ГБ');
    expect(quotaGb(lotos)).toBe(50);
    expect(quotaGb(undefined)).toBeUndefined();
  });
});

describe('«Квота места» (W4.84, opVM :3565–3566; Q-W4.84-1…3)', () => {
  it('варианты 25–500 ГБ, меньше занятого — с пометкой', () => {
    expect(quotaOptions(46.2 * GiB, alta)).toEqual([
      { value: '25', label: '25 ГБ · меньше занятого' },
      { value: '50', label: '50 ГБ' },
      { value: '100', label: '100 ГБ' },
      { value: '250', label: '250 ГБ' },
      { value: '500', label: '500 ГБ' },
    ]);
  });
  it('текущая квота вне списка — вариантом по порядку; занятое не загружено — без пометок', () => {
    const odd = { ...alta, entitlements: [ent('storage_quota_bytes', 75 * GiB)] };
    expect(quotaOptions(undefined, odd).map((o) => o.label)).toEqual([
      '25 ГБ',
      '50 ГБ',
      '75 ГБ',
      '100 ГБ',
      '250 ГБ',
      '500 ГБ',
    ]);
  });
  it('тело updatePlatformSubscription: тариф, статус и даты текущие, прочие ручные права сохраняются, квота — ручное право на 12 мес', () => {
    const sub: S['Subscription'] = {
      ...alta,
      entitlements: [
        ...alta.entitlements,
        {
          key: 'seats',
          value: 100,
          sourceType: 'manual',
          sourceRef: 'Пилот D-08',
          validUntil: '2027-01-31T21:00:00Z',
        },
        {
          key: 'storage_quota_bytes',
          value: 100 * GiB,
          sourceType: 'manual',
          sourceRef: 'Пилот D-08',
          validUntil: '2027-01-31T21:00:00Z',
        },
      ],
    };
    expect(quotaUpdate(sub, 250, '  Клиент докупил место  ', NOW)).toEqual({
      planKey: 'start',
      status: 'trialing',
      trialEndsAt: '2026-10-13T21:00:00Z',
      cancelAtPeriodEnd: false,
      manualEntitlements: [
        {
          key: 'seats',
          value: 100,
          sourceType: 'manual',
          sourceRef: 'Пилот D-08',
          validUntil: '2027-01-31T21:00:00Z',
        },
        {
          key: 'storage_quota_bytes',
          value: 250 * GiB,
          sourceType: 'manual',
          sourceRef: 'Клиент докупил место',
          validUntil: '2027-10-01T21:00:00Z',
        },
      ],
      reason: 'Клиент докупил место',
    });
  });
  it('оплаченная и grace: даты периода и льготы передаются, чтобы сервер их не сбросил', () => {
    const body = quotaUpdate(lotosPaid, 100, 'Клиент докупил место', NOW);
    expect(body).toMatchObject({ status: 'active', periodEndsAt: '2027-03-31T21:00:00Z' });
    const grace = quotaUpdate(
      { ...cargo, status: 'grace', graceEndsAt: '2026-09-22T21:00:00Z' },
      50,
      'Клиент докупил место',
      NOW,
    );
    expect(grace).toMatchObject({ status: 'grace', graceEndsAt: '2026-09-22T21:00:00Z' });
    expect(grace.manualEntitlements).toHaveLength(1);
  });
});

describe('плашка заявки (W4.84, opVM :3562)', () => {
  it('«Заявка SR-12: переход на «Бизнес» от 29.09 16:40»', () => {
    const req = {
      id: 'd0b0c6c4-0000-5000-8000-000000000012',
      number: 'SR-12',
      tenantId: '00000000-0000-5000-8000-000000000002',
      tenantName: 'SPA «Лотос»',
      fromTierCode: 'team',
      toTierCode: 'biz',
      toTierName: 'Бизнес',
      toSeatsLimit: 50,
      termMonths: 12,
      priceVersion: 2,
      seatsUsed: 23,
      status: 'pending',
      requestedAt: '2026-09-29T13:40:00Z',
      revision: 1,
    } satisfies S['SubscriptionChangeRequest'];
    expect(requestText(req)).toBe('Заявка SR-12: переход на «Бизнес» от 29.09 16:40');
  });
});

describe('доступность команд (Q-W1.00-2, 3, 6)', () => {
  const t = (status: S['Tenant']['status']): S['Tenant'] => ({
    id: '00000000-0000-5000-8000-000000000001',
    name: 'Альта Групп',
    status,
    ownerUserIds: [],
    createdAt: '2026-09-30T15:12:00Z',
    revision: 1,
  });
  it('пробная организация: продлить и ограничить, снимать нечего', () => {
    expect(actionsFor(t('trial'), alta)).toEqual({ extend: true, suspend: true, resume: false });
  });
  it('оплаченная: продления нет', () => {
    expect(actionsFor(t('active'), lotos)).toEqual({ extend: false, suspend: true, resume: false });
  });
  it('read_only после trial: продление есть (права источника trial)', () => {
    expect(actionsFor(t('read_only'), remstroy)).toEqual({
      extend: true,
      suspend: true,
      resume: false,
    });
  });
  it('приостановленная оплаченная: только «Снять ограничение»', () => {
    expect(actionsFor(t('suspended'), cargo)).toEqual({
      extend: false,
      suspend: false,
      resume: true,
    });
  });
  it('grace после оплаты (права plan) — продления нет', () => {
    expect(actionsFor(t('grace'), { ...cargo, status: 'grace' }).extend).toBe(false);
  });
  it('provisioning, closing, closed — команд нет; без подписки продления нет', () => {
    for (const s of ['provisioning', 'closing', 'closed'] as const) {
      expect(actionsFor(t(s), alta)).toEqual({ extend: false, suspend: false, resume: false });
    }
    expect(actionsFor(t('trial'), undefined).extend).toBe(false);
  });
});

describe('причина действия оператора: 5–500 символов после обрезки (Q-W1.00-1)', () => {
  it('пусто и пробелы — нет', () => {
    expect(reasonOk('')).toBe(false);
    expect(reasonOk('     ')).toBe(false);
  });
  it('меньше 5 — нет, ровно 5 — да', () => {
    expect(reasonOk(' Чек ')).toBe(false);
    expect(reasonOk('Чек 5')).toBe(true);
  });
  it('больше 500 — нет', () => {
    expect(reasonOk('а'.repeat(REASON_MAX))).toBe(true);
    expect(reasonOk('а'.repeat(REASON_MAX + 1))).toBe(false);
  });
  it('длиннее 500 — ошибка под полем; короче 5 и в пределах — без ошибки (кнопка недоступна)', () => {
    expect(reasonTooLong('а'.repeat(REASON_MAX + 1))).toBe('Не больше 500 символов');
    expect(reasonTooLong(` ${'а'.repeat(REASON_MAX)} `)).toBeUndefined();
    expect(reasonTooLong('')).toBeUndefined();
    expect(reasonTooLong('Чек')).toBeUndefined();
  });
});

describe('«Журнал действий»: строка по action и details, автор и время (Q-W1.48-8)', () => {
  const row = (over: Partial<S['PlatformAuditEvent']>): S['PlatformAuditEvent'] => ({
    id: '1',
    at: '2026-09-30T15:12:00Z',
    action: 'subscription.trial_started',
    actor: {
      kind: 'operator',
      accountId: '47575a90-6587-584f-bfe6-950866f7810c',
      displayName: 'Евгения Лаптева',
    },
    target: {
      type: 'subscription',
      tenantId: '00000000-0000-5000-8000-000000000001',
      name: 'Альта Групп',
    },
    result: 'ok',
    details: { days: '14', quotaBytes: String(100 * GiB) },
    ...over,
  });
  it('открыт пробный период — дословно эталон', () => {
    expect(auditLine(row({}))).toEqual({
      text: 'Альта Групп: открыт пробный период на 14 дней, квота 100 ГБ',
      meta: '30.09 18:12 · Е. Лаптева',
    });
  });
  it('пробный период завершён (система)', () => {
    expect(
      auditLine(
        row({
          at: '2026-09-21T06:00:00Z',
          action: 'subscription.trial_ended',
          actor: { kind: 'system' },
          target: { type: 'subscription', name: 'Ремстрой Плюс' },
          details: { toStatus: 'read_only' },
        }),
      ),
    ).toEqual({
      text: 'Ремстрой Плюс: пробный период завершён, новые операции ограничены',
      meta: '21.09 09:00 · Система',
    });
  });
  it('продление: дни с согласованием и причина отдельной строкой', () => {
    const line = auditLine(
      row({
        action: 'subscription.trial_extended',
        details: { days: '14' },
        reason: 'Ждём оплату',
      }),
    );
    expect(line.text).toBe('Альта Групп: пробный период продлён на 14 дней');
    expect(line.reason).toBe('Причина: Ждём оплату');
    expect(
      auditLine(row({ action: 'subscription.trial_extended', details: { days: '1' } })).text,
    ).toBe('Альта Групп: пробный период продлён на 1 день');
    expect(
      auditLine(row({ action: 'subscription.trial_extended', details: { days: '3' } })).text,
    ).toBe('Альта Групп: пробный период продлён на 3 дня');
  });
  it('приостановка и возобновление — статус по toStatus', () => {
    expect(
      auditLine(row({ action: 'tenant.suspended', details: { toStatus: 'suspended' } })).text,
    ).toBe('Альта Групп: статус «Приостановлен»');
    expect(auditLine(row({ action: 'tenant.resumed', details: { toStatus: 'grace' } })).text).toBe(
      'Альта Групп: статус «Ограничен»',
    );
  });
  it('квота оператора (updatePlatformSubscription, деталь quotaBytes) — «квота N ГБ» эталона', () => {
    const line = auditLine(
      row({
        action: 'subscription.updated',
        details: { quotaBytes: String(25 * GiB), toStatus: 'trialing' },
        reason: 'Клиент докупил место',
      }),
    );
    expect(line.text).toBe('Альта Групп: квота 25 ГБ');
    expect(line.reason).toBe('Причина: Клиент докупил место');
    expect(auditLine(row({ action: 'subscription.updated', details: {} })).text).toBe(
      'Альта Групп: subscription.updated',
    );
  });
  it('неизвестное действие — общая строка; отказ помечается', () => {
    expect(auditLine(row({ action: 'storage.archive_moved', details: {} })).text).toBe(
      'Альта Групп: storage.archive_moved',
    );
    expect(auditLine(row({ action: 'tenant.suspended', result: 'denied', details: {} })).text).toBe(
      'Альта Групп: статус «Приостановлен» · отказано',
    );
  });
  it('сокращение имени автора: «Евгения Лаптева» → «Е. Лаптева»', () => {
    expect(shortName('Евгения Лаптева')).toBe('Е. Лаптева');
    expect(shortName('Лаптева')).toBe('Лаптева');
    expect(shortName('  ')).toBe('—');
  });
});

describe('знак организации: первый буквенно-цифровой символ (бриф §10 п. 9)', () => {
  it('«Альта Групп» → «А», «SPA «Лотос»» → «S», ««Север»» → «С»', () => {
    expect(markLetter('Альта Групп')).toBe('А');
    expect(markLetter('SPA «Лотос»')).toBe('S');
    expect(markLetter('«север»')).toBe('С');
    expect(markLetter('—')).toBe('?');
  });
});
