// W1.25 · Модель «Организаций» оператора: подписи строк и карточки по Tenant и Subscription контракта,
// доступность команд (Q-W1.00-2, 3, 6), причина 5–500 (Q-W1.00-1), строка «Журнала действий» (S1-23, Q-W1.48-8).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  actionsFor,
  auditLine,
  markLetter,
  mskDate,
  ownerLine,
  paymentText,
  planText,
  quotaText,
  REASON_MAX,
  reasonOk,
  reasonTooLong,
  seatsText,
  shortName,
  statusChip,
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

describe('тариф и оплата (бриф §10 п. 10)', () => {
  it('пробный: «Старт» · пробный · цены v2', () => {
    expect(planText(alta)).toBe('«Старт» · пробный · цены v2');
  });
  it('оплаченный: срока в контракте нет — «Команда» · цены v1', () => {
    expect(planText(lotos)).toBe('«Команда» · цены v1');
  });
  it('read_only после trial — не «пробный»: эталон (opVM :3559) пишет «пробный» только у status trial', () => {
    expect(planText(remstroy)).toBe('«Старт» · цены v2');
    expect(planText({ ...remstroy, status: 'grace' })).toBe('«Старт» · цены v2');
  });
  it('неизвестный ключ тарифа показывается как есть, без версии', () => {
    expect(planText({ ...lotos, planKey: 'vip', entitlements: [] })).toBe('«vip»');
  });
  it('оплата: пробный период, «Оплачено до …», иначе «—»', () => {
    expect(paymentText(alta)).toBe('Пробный период');
    expect(paymentText(lotos)).toBe('Оплачено до 31.03.2027');
    expect(paymentText(remstroy)).toBe('—');
    expect(paymentText(undefined)).toBe('—');
  });
});

describe('места и место: лимиты из подписки, занятое — «—» до этапа 4 (бриф §10 п. 1)', () => {
  it('строка владельца: «Владелец: — · мест —/10»', () => {
    expect(ownerLine(alta)).toBe('Владелец: — · мест —/10');
  });
  it('без лимита мест — только занятые', () => {
    expect(ownerLine({ ...alta, entitlements: [] })).toBe('Владелец: — · мест —');
  });
  it('место: «— из 100 ГБ», дробная квота — с запятой', () => {
    expect(usageText(alta)).toBe('— из 100 ГБ');
    expect(usageText({ ...alta, entitlements: [ent('storage_quota_bytes', 12.5 * GiB)] })).toBe(
      '— из 12,5 ГБ',
    );
    expect(usageText(undefined)).toBe('—');
  });
  it('места с входом: «— из 10», без лимита — «— · без ограничения»', () => {
    expect(seatsText(alta)).toBe('— из 10');
    expect(seatsText({ ...alta, entitlements: [] })).toBe('— · без ограничения');
  });
  it('места с входом без подписки (загрузка, ошибка) — «—», а не «без ограничения»', () => {
    expect(seatsText(undefined)).toBe('—');
  });
  it('квота в гигабайтах', () => {
    expect(quotaText(lotos)).toBe('50 ГБ');
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
