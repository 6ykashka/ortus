// W4.61 · Модель «Подписки и мест» владельца (billingVM :3916–3957) на данных сценарного сервера сида W4.07:
// карточка тарифа, места, баннеры заявок и смены цен, сроки и тарифы, расчёт, подсказка отправки, списки мест.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import examplePb from '../../../../../../../api/openapi/examples/getTenantPriceBook/subscribed.json';
import {
  banners,
  calcView,
  people,
  planCard,
  seatsCard,
  sendHint,
  termPills,
  tierCards,
} from './model.ts';

type S = components['schemas'];

const NB = ' ';
const NOW = Date.parse('2026-10-01T07:30:00Z');
const pb = examplePb as unknown as S['TenantPriceBook'];
const v2 = pb.current;

const alta: S['Subscription'] = {
  planKey: 'start',
  status: 'trialing',
  trialEndsAt: '2026-10-13T21:00:00Z',
  cancelAtPeriodEnd: false,
  entitlements: [],
  revision: 2,
  tierCode: 'start',
  tierName: 'Старт',
  priceVersion: 2,
  seats: { limit: 10, used: 9, active: 7, invited: 2, available: 1 },
};

const lotos: S['Subscription'] = {
  planKey: 'team',
  status: 'active',
  periodEndsAt: '2027-03-31T21:00:00Z',
  cancelAtPeriodEnd: false,
  entitlements: [],
  revision: 1,
  tierCode: 'team',
  tierName: 'Команда',
  priceVersion: 1,
  termMonths: 12,
  seats: { limit: 25, used: 23, active: 23, invited: 0, available: 2 },
};

const req = (p: Partial<S['SubscriptionChangeRequest']>): S['SubscriptionChangeRequest'] => ({
  id: 'r',
  number: 'SR-12',
  tenantId: 't',
  tenantName: 'SPA «Лотос»',
  fromTierCode: 'team',
  toTierCode: 'biz',
  toTierName: 'Бизнес',
  toSeatsLimit: 50,
  termMonths: 12,
  priceVersion: 1,
  seatsUsed: 23,
  status: 'pending',
  requestedAt: '2026-09-29T13:40:00Z',
  revision: 1,
  ...p,
});

describe('карточки тарифа и мест (billingVM :3926–3930)', () => {
  it('пробный период: заголовок, чип срока, пояснение', () => {
    expect(planCard(alta, NOW)).toEqual({
      title: 'Пробный период · «Старт»',
      chip: { label: 'до 13.10.2026 · осталось 12 дн.', tone: 'info', icon: 'hourglass_top' },
      meta: 'В пробном периоде до 10 мест и все подключённые модули. Чтобы продолжить после него, выберите тариф ниже.',
    });
  });

  it('оплаченный: «Оплачено до», срок и версия цен', () => {
    expect(planCard(lotos, NOW)).toEqual({
      title: 'Тариф «Команда»',
      chip: { label: 'Оплачено до 31.03.2027', tone: 'ok', icon: 'check_circle' },
      meta: 'Оплата за 12 мес · цены версии v1 сохраняются до конца периода',
    });
    expect(planCard({ ...lotos, termMonths: 1 }, NOW).meta).toBe(
      'Помесячная оплата · цены версии v1 сохраняются до конца периода',
    );
    expect(planCard({ ...lotos, status: 'read_only' }, NOW).chip).toEqual({
      label: 'Ограничен',
      tone: 'warn',
      icon: 'lock_clock',
    });
  });

  it('места: «9 из 10», жёлтая полоса > 80 %, подпись; заняты все — красная и «Мест нет»', () => {
    expect(seatsCard(alta.seats as S['SeatUsage'])).toEqual({
      value: '9 из 10',
      percent: 90,
      tone: 'warn',
      sub: '7 активны · 2 приглашения · 1 свободно',
      full: false,
    });
    const full = seatsCard({ limit: 10, used: 10, active: 9, invited: 1, available: 0 });
    expect([full.tone, full.full, full.sub]).toEqual([
      'danger',
      true,
      '9 активны · 1 приглашение · 0 свободно',
    ]);
    expect(
      seatsCard({ limit: null, used: 120, active: 120, invited: 0, available: null }),
    ).toMatchObject({
      value: '120',
      percent: 0,
      sub: '120 активны · 0 приглашений · без ограничения',
    });
  });
});

describe('баннеры (billingVM :3931–3935)', () => {
  it('заявка на рассмотрении — текст и номер для отмены', () => {
    expect(banners([req({})], undefined)).toEqual({
      pending: {
        id: 'r',
        text: 'Заявка SR-12 на «Бизнес» · 12 мес отправлена 29.09 16:40. Новый лимит начнёт действовать после подтверждения оператором.',
      },
      rejected: undefined,
      approved: undefined,
      priceChange: undefined,
    });
    expect(banners([req({ termMonths: 1 })], undefined).pending?.text).toContain(
      '«Бизнес» · помесячно',
    );
  });

  it('последняя решённая: отклонена с причиной или без, подтверждена с датой; смена цен', () => {
    const rejected = req({
      status: 'rejected',
      decisionNote: 'Нет оплаты',
      decidedAt: '2026-10-01T07:40:00Z',
    });
    expect(banners([rejected], undefined).rejected).toBe(
      'Заявка SR-12 отклонена оператором: Нет оплаты',
    );
    expect(banners([{ ...rejected, decisionNote: undefined as never }], undefined).rejected).toBe(
      'Заявка SR-12 отклонена оператором: без комментария',
    );
    const approved = req({ status: 'approved', decidedAt: '2026-05-12T12:20:00Z' });
    expect(banners([approved, rejected], undefined).approved).toBe(
      'Заявка SR-12 подтверждена 12.05 15:20.',
    );
    expect(banners([req({}), approved], undefined).approved).toBeUndefined();
    expect(banners([], pb.scheduled).priceChange).toBe(
      'С 01.11.2026 меняются цены тарифов. Заявки, поданные до этой даты, считаются по текущим ценам; оплаченный период не пересчитывается.',
    );
  });
});

describe('сроки, тарифы и расчёт (billingVM :3936–3947)', () => {
  it('сроки: «Месяц», «4 мес −5%»…', () => {
    expect(termPills(v2.terms)).toEqual([
      { months: 1, label: 'Месяц', off: undefined },
      { months: 4, label: '4 мес', off: '−5%' },
      { months: 8, label: '8 мес', off: '−10%' },
      { months: 12, label: '12 мес', off: '−20%' },
    ]);
  });

  it('тарифы пробного периода на 12 мес: цены, суммы, «Тот же лимит…», безлимит', () => {
    const cards = tierCards(v2, alta, 12, null, false);
    expect(cards[0]).toEqual({
      code: 'start',
      name: 'Старт',
      seats: 'до 10 мест',
      price: `3${NB}120 ₽`,
      per: 'в месяц',
      total: `37${NB}440 ₽ за 12 мес`,
      note: 'Тот же лимит, что в пробном периоде',
      checked: false,
      disabled: false,
    });
    expect(cards[4]).toMatchObject({
      name: 'Безлимит',
      seats: 'больше 100 мест',
      price: 'Индивидуально',
      per: 'расчёт с оператором',
      total: undefined,
      note: undefined,
    });
    expect(tierCards(v2, alta, 1, 'team', false)[1]).toMatchObject({
      price: `8${NB}900 ₽`,
      total: undefined,
      checked: true,
    });
  });

  it('оплаченный «Лотос»: текущий тариф и не поместится — недоступны; заявка — все недоступны', () => {
    const cards = tierCards(v2, lotos, 12, null, false);
    expect(cards[0]).toMatchObject({ note: 'Занято 23 — не поместится', disabled: true });
    expect(cards[1]).toMatchObject({ note: 'Текущий тариф', disabled: true });
    expect(cards[2]).toMatchObject({ note: undefined, disabled: false });
    expect(tierCards(v2, lotos, 12, null, true).every((c) => c.disabled)).toBe(true);
  });

  it('расчёт: месяц, период, экономия и новый лимит; безлимит — «Стоимость рассчитает оператор»', () => {
    expect(calcView(v2, 'team', 12)).toEqual({
      main: `7${NB}120 ₽ в месяц · 85${NB}440 ₽ за 12 мес`,
      sub: `Экономия 21${NB}360 ₽ по сравнению с помесячной оплатой. Новый лимит: 25 мест.`,
    });
    expect(calcView(v2, 'team', 1)).toEqual({
      main: `8${NB}900 ₽ в месяц · 8${NB}900 ₽ за месяц`,
      sub: 'Новый лимит: 25 мест.',
    });
    expect(calcView(v2, 'unl', 12)).toEqual({
      main: 'Стоимость рассчитает оператор',
      sub: 'Новый лимит: без ограничения.',
    });
    expect(calcView(v2, null, 12)).toBeUndefined();
  });

  it('подсказка отправки', () => {
    expect(sendHint(true, null)).toBe(
      'Сначала дождитесь решения по текущей заявке или отмените её',
    );
    expect(sendHint(false, null)).toBe('Выберите тариф');
    expect(sendHint(false, 'team')).toBe('');
  });
});

describe('кто занимает место (billingVM :3949–3954)', () => {
  const m = (p: Partial<S['Member']>): S['Member'] => ({
    id: p.displayName ?? 'm',
    displayName: 'Имя',
    status: 'active',
    orgUnitIds: [],
    revision: 1,
    workProfiles: [],
    userId: 'u',
    ...p,
  });

  it('занимают: активные с входом, затем приглашённые; не занимают: заблокированные и карточки без входа', () => {
    // Подпись под именем — рабочая функция (должности в контракте нет), иначе почта (как W1.23), иначе «Должность…».
    const p = people([
      m({ displayName: 'Олеся Петрова', email: 'o.petrova@alta.example', status: 'invited' }),
      m({ displayName: 'Дарья Зимина', email: 'd.zimina@alta.example' }),
      m({ displayName: 'Илья Васильев', email: 'i@alta.example', workProfiles: ['driver'] }),
      m({ displayName: 'Кирилл Громов', status: 'suspended', workProfiles: ['driver'] }),
      m({ displayName: 'Иван Петров', userId: undefined as never, workProfiles: ['foreman'] }),
    ]);
    expect(p.paid.map((x) => [x.name, x.title, x.note, x.chip.label, x.invited])).toEqual([
      ['Дарья Зимина', 'd.zimina@alta.example', undefined, 'Активен', false],
      ['Илья Васильев', 'Водитель', undefined, 'Активен', false],
      [
        'Олеся Петрова',
        'o.petrova@alta.example',
        'Приглашение отправлено · место зарезервировано',
        'Приглашён',
        true,
      ],
    ]);
    expect(p.free.map((x) => [x.name, x.what])).toEqual([
      ['Кирилл Громов', 'Водитель · заблокирован, история сохранена'],
      ['Иван Петров', 'Прораб · карточка без входа (бригада)'],
    ]);
    expect(p.paid[0]?.initials).toBe('ДЗ');
    expect(p.paid[0]?.id).toBe('Дарья Зимина');
    expect(people([m({})]).paid[0]?.title).toBe('Должность не указана');
  });
});
