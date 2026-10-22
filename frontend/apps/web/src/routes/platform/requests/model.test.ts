// W4.61 · Модель «Заявок на тариф» (requestsVM :3586–3617) на заявках сценарного сервера (SR-12, SR-9 сида W4.07).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { approveSpec, filterPills, rejectSpec, requestCard, visible } from './model.ts';

type Req = components['schemas']['SubscriptionChangeRequest'];

const NB = ' ';
const money = (amountMinor: number) => ({ amountMinor, currency: 'RUB' });

const sr12: Req = {
  id: 'd5748522-e6b8-5df4-8a9f-1cbdfef46ed3',
  number: 'SR-12',
  tenantId: 'e4f2195f-f5a3-5f61-98be-f6ed76ea565a',
  tenantName: 'SPA «Лотос»',
  fromTierCode: 'team',
  fromTierName: 'Команда',
  fromSeatsLimit: 25,
  toTierCode: 'biz',
  toTierName: 'Бизнес',
  toSeatsLimit: 50,
  termMonths: 12,
  priceVersion: 1,
  seatsUsed: 23,
  status: 'pending',
  requestedAt: '2026-09-29T13:40:00Z',
  requestedBy: { displayName: 'Ирина Белова' },
  revision: 1,
  quote: {
    monthlyAmount: money(1192000),
    periodAmount: money(14304000),
    savingAmount: money(3576000),
    discountPercent: 20,
  },
  comment: 'Открываем второй салон, нужно ещё 10–12 мест',
};

const sr9: Req = {
  ...sr12,
  id: 'f6a45af4-762d-5d73-8cbe-356710cdbbeb',
  number: 'SR-9',
  tenantName: 'Карго Сити',
  fromTierCode: 'start',
  fromTierName: 'Старт',
  fromSeatsLimit: 10,
  toTierCode: 'team',
  toTierName: 'Команда',
  toSeatsLimit: 25,
  termMonths: 4,
  seatsUsed: 10,
  status: 'approved',
  requestedAt: '2026-05-12T08:02:00Z',
  requestedBy: { displayName: 'Денис Шишкин' },
  quote: {
    monthlyAmount: money(807500),
    periodAmount: money(3230000),
    savingAmount: money(170000),
    discountPercent: 5,
  },
  decidedAt: '2026-05-12T12:20:00Z',
  decidedBy: { displayName: 'Евгения Лаптева' },
  decisionNote: 'Оплата по счёту получена',
  revision: 2,
};
delete (sr9 as { comment?: string }).comment;

describe('фильтр и список (requestsVM :3591–3595)', () => {
  it('«На рассмотрении · N» и «Все заявки · M»', () => {
    expect(filterPills([sr12, sr9])).toEqual([
      { key: 'pending', label: 'На рассмотрении · 1' },
      { key: 'all', label: 'Все заявки · 2' },
    ]);
  });

  it('на рассмотрении — только pending, все — все', () => {
    expect(visible([sr12, sr9], 'pending').map((r) => r.number)).toEqual(['SR-12']);
    expect(visible([sr12, sr9], 'all').map((r) => r.number)).toEqual(['SR-12', 'SR-9']);
  });
});

describe('карточка заявки (requestsVM :3596–3604)', () => {
  it('SR-12: шапка, поля, цена по расчёту заявки, комментарий владельца', () => {
    expect(requestCard(sr12)).toEqual({
      id: sr12.id,
      number: 'SR-12',
      org: 'SPA «Лотос»',
      chip: { label: 'На рассмотрении', tone: 'warn', icon: 'pending' },
      meta: '29.09 16:40 · Ирина Белова',
      from: '«Команда» · до 25 мест',
      to: '«Бизнес» · до 50 мест',
      used: '23 из 50 после перехода',
      term: '12 месяцев',
      price: `11${NB}920 ₽ в месяц · 143${NB}040 ₽ за период · скидка 20%`,
      comment: 'Комментарий владельца: «Открываем второй салон, нужно ещё 10–12 мест»',
      decision: undefined,
      pending: true,
    });
  });

  it('SR-9: подтверждена, решение «статус · кто · когда — заметка», «4 месяцев» как эталон', () => {
    const c = requestCard(sr9);
    expect(c.chip).toEqual({ label: 'Подтверждена', tone: 'ok', icon: 'check_circle' });
    expect(c.term).toBe('4 месяцев');
    expect(c.price).toBe(`8${NB}075 ₽ в месяц · 32${NB}300 ₽ за период · скидка 5%`);
    expect(c.decision).toBe('Подтверждена · Е. Лаптева · 12.05 15:20 — Оплата по счёту получена');
    expect(c.comment).toBeUndefined();
    expect(c.pending).toBe(false);
  });

  it('безлимит без расчёта, помесячно, отклонена и отменена владельцем', () => {
    const r: Req = {
      ...sr12,
      toTierName: 'Безлимит',
      toSeatsLimit: null,
      termMonths: 1,
      status: 'rejected',
      decidedAt: '2026-10-01T07:40:00Z',
      decidedBy: { displayName: 'Евгения Лаптева' },
      decisionNote: 'Нет оплаты',
    };
    delete r.quote;
    const c = requestCard(r);
    expect([c.to, c.used, c.term, c.price, c.decision]).toEqual([
      '«Безлимит» · без ограничения',
      '23',
      'Помесячно',
      'Индивидуальный расчёт',
      'Отклонена · Е. Лаптева · 01.10 10:40 — Нет оплаты',
    ]);
    expect(c.chip).toEqual({ label: 'Отклонена', tone: 'danger', icon: 'block' });
    const cancelled = requestCard({
      ...sr12,
      status: 'cancelled',
      decidedAt: '2026-09-30T07:00:00Z',
      decidedBy: { displayName: 'Ирина Белова' },
    });
    expect(cancelled.chip).toEqual({ label: 'Отменена владельцем', tone: 'neutral', icon: 'undo' });
    expect(cancelled.decision).toBe('Отменена владельцем · И. Белова · 30.09 10:00');
  });

  it('без текущего тарифа — «—»', () => {
    expect(requestCard({ ...sr12, fromTierCode: null, fromTierName: null }).from).toBe('—');
  });
});

describe('диалоги решения (requestsVM :3605–3612)', () => {
  it('подтверждение: тариф, срок и сумма за период', () => {
    expect(approveSpec(sr12)).toEqual({
      title: 'Подтвердить заявку SR-12?',
      text: 'SPA «Лотос» переходит на «Бизнес» · до 50 мест.',
      items: [
        {
          icon: 'group_add',
          tone: 'ok',
          text: 'Лимит мест меняется сразу: владелец сможет приглашать сотрудников',
        },
        {
          icon: 'receipt_long',
          tone: 'info',
          text: `Подписка на 12 мес, 143${NB}040 ₽ за период. В пилоте оплату подтверждает оператор`,
        },
        {
          icon: 'history',
          tone: 'neutral',
          text: 'Решение попадёт в журнал и в уведомления владельца',
        },
      ],
      confirmLabel: 'Подтвердить',
      tone: 'info',
    });
    const monthly = approveSpec({ ...sr12, termMonths: 1, quote: undefined as never });
    expect(monthly.items[1]?.text).toBe(
      'Подписка помесячная. В пилоте оплату подтверждает оператор',
    );
  });

  it('отказ: причина в тексте, опасная кнопка', () => {
    expect(rejectSpec(sr12, '  Нет оплаты ')).toEqual({
      title: 'Отклонить заявку SR-12?',
      text: 'Владелец увидит причину: «Нет оплаты».',
      items: [
        { icon: 'block', tone: 'warn', text: 'Тариф и лимит мест не меняются' },
        {
          icon: 'inventory_2',
          tone: 'ok',
          text: 'Участники и данные организации не затрагиваются',
        },
      ],
      confirmLabel: 'Отклонить',
      tone: 'danger',
    });
  });
});
