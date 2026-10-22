// W4.61 · Модель «Тарифной сетки» (plansVM :3853–3914) на версиях сценарного сервера (пример контракта
// listPriceBookVersions сида W4.07): просмотр, черновик и его проверки дословно, тело публикации, история, диалоги.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  addTier,
  cancelSpec,
  draftFrom,
  fromOptions,
  heads,
  historyRows,
  nextVersion,
  publishBody,
  publishSpec,
  removeTier,
  scheduledText,
  setUnlimited,
  tierRows,
  validateDraft,
  versionHead,
} from './model.ts';

type Version = components['schemas']['PriceBookVersion'];

const NB = ' ';
const tiers2: Version['tiers'] = [
  { code: 'start', name: 'Старт', seatsLimit: 10, monthAmountMinor: 390000 },
  { code: 'team', name: 'Команда', seatsLimit: 25, monthAmountMinor: 890000 },
  { code: 'biz', name: 'Бизнес', seatsLimit: 50, monthAmountMinor: 1590000 },
  { code: 'net', name: 'Сеть', seatsLimit: 100, monthAmountMinor: 2790000 },
  { code: 'unl', name: 'Безлимит', seatsLimit: null, monthAmountMinor: null },
];
const terms: Version['terms'] = [
  { months: 1, discountPercent: 0 },
  { months: 4, discountPercent: 5 },
  { months: 8, discountPercent: 10 },
  { months: 12, discountPercent: 20 },
];
const v2: Version = {
  version: 2,
  state: 'current',
  effectiveFrom: '2026-09-30T21:00:00Z',
  note: 'Добавлена ступень «Сеть» до 100 мест, пересчитаны цены',
  currency: 'RUB',
  tiers: tiers2,
  terms,
  publishedBy: { displayName: 'Евгения Лаптева' },
  subscriptionCount: 1,
};
const v1: Version = {
  ...v2,
  version: 1,
  state: 'archived',
  effectiveFrom: '2026-05-31T21:00:00Z',
  effectiveUntil: '2026-09-30T21:00:00Z',
  note: 'Стартовая сетка пилота',
  subscriptionCount: 3,
};
const v3: Version = {
  ...v2,
  version: 3,
  state: 'scheduled',
  effectiveFrom: '2026-10-31T21:00:00Z',
  note: 'Тест',
  subscriptionCount: 0,
};

describe('просмотр (plansVM :3855–3872)', () => {
  it('шапка версии и следующий номер (с отменёнными)', () => {
    expect(versionHead(v2)).toEqual({
      title: 'Версия v2',
      from: '· действует с 01.10.2026',
      note: v2.note,
    });
    expect(nextVersion([v2, v1])).toBe(3);
    expect(nextVersion([{ ...v3, state: 'cancelled' }, v2, v1])).toBe(4);
  });

  it('баннер запланированной версии', () => {
    expect(scheduledText(v3, { ...v2, effectiveUntil: v3.effectiveFrom })).toBe(
      'Запланирована версия v3 с 01.11.2026: Тест. До этой даты действуют цены v2.',
    );
  });

  it('заголовки сроков: «Месяц · базовая цена», «4 мес · скидка 5%»', () => {
    expect(heads(terms)).toEqual([
      { months: 1, label: 'Месяц', offLabel: 'базовая цена' },
      { months: 4, label: '4 мес', offLabel: 'скидка 5%' },
      { months: 8, label: '8 мес', offLabel: 'скидка 10%' },
      { months: 12, label: '12 мес', offLabel: 'скидка 20%' },
    ]);
  });

  it('строки: места, цена в месяц, цена со скидкой и сумма за срок; безлимит — по запросу', () => {
    const rows = tierRows(draftFrom(v2, '01.11.2026'));
    expect(rows[0]).toMatchObject({
      name: 'Старт',
      seats: 'до 10 мест',
      month: `3${NB}900 ₽`,
      custom: false,
    });
    expect(rows[0]?.cells).toEqual([
      { main: `3${NB}900 ₽`, sub: 'в месяц' },
      { main: `3${NB}705 ₽`, sub: `в месяц · 14${NB}820 ₽ за срок` },
      { main: `3${NB}510 ₽`, sub: `в месяц · 28${NB}080 ₽ за срок` },
      { main: `3${NB}120 ₽`, sub: `в месяц · 37${NB}440 ₽ за срок` },
    ]);
    expect(rows[4]).toMatchObject({ seats: 'больше 100 мест', custom: true, month: '' });
    expect(rows[4]?.cells[0]).toEqual({ main: 'по запросу', sub: 'расчёт оператора' });
  });

  it('некорректная цена черновика — «—» в ячейках', () => {
    const d = draftFrom(v2, '01.11.2026');
    d.tiers[0] = { ...d.tiers[0], month: 'abc' } as (typeof d.tiers)[number];
    expect(tierRows(d)[0]?.cells[0]).toEqual({ main: '—', sub: '' });
  });
});

describe('история версий (plansVM :3912)', () => {
  it('действующая, архив и запланированная', () => {
    expect(historyRows([v2, v1])).toEqual([
      {
        v: 'v2',
        chip: { label: 'Действует', tone: 'ok', icon: 'check_circle' },
        period: '01.10.2026 — сейчас',
        line: 'Добавлена ступень «Сеть» до 100 мест, пересчитаны цены · Е. Лаптева · 1 подписка на этих ценах',
      },
      {
        v: 'v1',
        chip: { label: 'Архив', tone: 'neutral', icon: 'history' },
        period: '01.06.2026 — 30.09.2026',
        line: 'Стартовая сетка пилота · Е. Лаптева · 3 подписки на этих ценах',
      },
    ]);
    const rows = historyRows([v3, { ...v2, effectiveUntil: v3.effectiveFrom }, v1]);
    expect(rows[0]).toMatchObject({
      v: 'v3',
      chip: { label: 'Запланирована с 01.11.2026', tone: 'info', icon: 'event' },
      period: 'с 01.11.2026 · ещё не действует',
      line: 'Тест · Е. Лаптева · 0 подписок на этих ценах',
    });
    expect(rows[1]?.period).toBe('01.10.2026 — до 01.11.2026');
  });
});

describe('черновик (plansVM :3866–3903)', () => {
  it('копия действующей версии, даты начала — первые числа трёх следующих месяцев', () => {
    expect(fromOptions(Date.parse('2026-10-01T07:30:00Z'))).toEqual([
      { value: '01.11.2026', label: 'с 01.11.2026' },
      { value: '01.12.2026', label: 'с 01.12.2026' },
      { value: '01.01.2027', label: 'с 01.01.2027' },
    ]);
    const d = draftFrom(v2, '01.11.2026');
    expect(d.tiers[0]).toEqual({ code: 'start', name: 'Старт', seats: '10', month: '3900' });
    expect(d.tiers[4]).toEqual({ code: 'unl', name: 'Безлимит', seats: null, month: null });
    expect(d.terms[1]).toEqual({ months: 4, off: '5' });
    expect(validateDraft(d)).toEqual([]);
  });

  it('тексты ошибок дословно (plansVM :3882–3897)', () => {
    const d = draftFrom(v2, '01.11.2026');
    const set = (i: number, p: Partial<(typeof d.tiers)[number]>) => {
      d.tiers[i] = { ...(d.tiers[i] as (typeof d.tiers)[number]), ...p };
    };
    set(0, { name: '' });
    expect(validateDraft(d)).toEqual(['Тариф 1: укажите название']);
    set(0, { name: 'Старт' });
    set(1, { month: '3000' });
    expect(validateDraft(d)).toEqual(['«Команда»: цена должна быть выше, чем у «Старт»']);
    set(1, { month: '8900', seats: '5' });
    expect(validateDraft(d)).toEqual(['«Команда»: мест должно быть больше, чем в «Старт» (10)']);
    set(1, { seats: '' });
    expect(validateDraft(d)).toEqual(['«Команда»: укажите число мест, целое больше нуля']);
    set(1, { seats: '25', month: '' });
    expect(validateDraft(d)).toEqual(['«Команда»: укажите цену в месяц']);
    set(1, { month: '8900' });
    set(2, { name: 'старт' });
    expect(validateDraft(d)).toEqual(['Названия тарифов не должны повторяться']);
    set(2, { name: 'Бизнес' });
    d.terms[3] = { months: 12, off: '60' };
    d.terms[0] = { months: 1, off: '' };
    expect(validateDraft(d)).toEqual([
      'Скидка за месяц: от 0 до 49%',
      'Скидка за 12 мес: от 0 до 49%',
    ]);
  });

  it('безлимит не последним и без тарифов с ценой', () => {
    const d = draftFrom(v2, '01.11.2026');
    d.tiers = [
      { name: 'Безлимит', seats: null, month: null },
      { name: 'Старт', seats: '10', month: '3900' },
    ];
    expect(validateDraft(d)).toEqual(['«Безлимит»: без лимита может быть только последний тариф']);
    d.tiers = [{ name: 'Безлимит', seats: null, month: null }];
    expect(validateDraft(d)).toEqual(['Нужен хотя бы один тариф с ценой']);
  });

  it('«Добавить тариф» — перед безлимитом, мест вдвое больше предыдущего; «Удалить»', () => {
    const d = addTier(draftFrom(v2, '01.11.2026'));
    expect(d.tiers).toHaveLength(6);
    expect(d.tiers[4]).toEqual({ name: '', seats: '200', month: '' });
    expect(validateDraft(d)).toEqual([
      'Тариф 5: укажите название',
      'Тариф 5: укажите цену в месяц',
    ]);
    expect(removeTier(d, 4).tiers).toHaveLength(5);
    const empty = addTier({ ...d, tiers: [] });
    expect(empty.tiers).toEqual([{ name: '', seats: '10', month: '' }]);
  });

  it('безлимит последнего тарифа: включение и выключение', () => {
    const d = draftFrom(v2, '01.11.2026');
    const off = setUnlimited(d, 4, false);
    expect(off.tiers[4]).toMatchObject({ seats: '200', month: '' });
    const on = setUnlimited(off, 4, true);
    expect(on.tiers[4]).toMatchObject({ seats: null, month: null });
  });

  it('тело публикации: дата ISO, копейки, коды прежних ступеней, скидки', () => {
    const d = addTier(draftFrom(v2, '01.12.2026'));
    d.tiers[4] = { name: ' Холдинг ', seats: '200', month: '45000' };
    d.note = '  ';
    expect(publishBody(d)).toEqual({
      effectiveFrom: '2026-12-01',
      note: '',
      tiers: [
        { code: 'start', name: 'Старт', seatsLimit: 10, monthAmountMinor: 390000 },
        { code: 'team', name: 'Команда', seatsLimit: 25, monthAmountMinor: 890000 },
        { code: 'biz', name: 'Бизнес', seatsLimit: 50, monthAmountMinor: 1590000 },
        { code: 'net', name: 'Сеть', seatsLimit: 100, monthAmountMinor: 2790000 },
        { name: 'Холдинг', seatsLimit: 200, monthAmountMinor: 4500000 },
        { code: 'unl', name: 'Безлимит', seatsLimit: null, monthAmountMinor: null },
      ],
      terms: [
        { months: 1, discountPercent: 0 },
        { months: 4, discountPercent: 5 },
        { months: 8, discountPercent: 10 },
        { months: 12, discountPercent: 20 },
      ],
    });
  });
});

describe('диалоги (plansVM :3860, :3906–3910)', () => {
  it('публикация', () => {
    expect(publishSpec(3, 2, '01.11.2026')).toEqual({
      title: 'Опубликовать тарифную сетку v3?',
      text: 'Начнёт действовать 01.11.2026.',
      items: [
        {
          icon: 'event',
          tone: 'info',
          text: 'Новые подписки и продления с 01.11.2026 — по новым ценам',
        },
        {
          icon: 'lock_clock',
          tone: 'ok',
          text: 'Действующие подписки сохраняют цену до конца оплаченного периода',
        },
        {
          icon: 'event_upcoming',
          tone: 'neutral',
          text: 'До 01.11.2026 действуют цены v2; запланированную версию можно отменить до этой даты',
        },
      ],
      confirmLabel: 'Опубликовать',
      tone: 'info',
    });
  });

  it('отмена запланированной', () => {
    expect(cancelSpec(3, 2)).toEqual({
      title: 'Отменить версию v3?',
      text: 'Она ещё не начала действовать.',
      items: [
        { icon: 'undo', tone: 'ok', text: 'Цены v2 продолжат действовать без даты окончания' },
        { icon: 'history', tone: 'neutral', text: 'Отмена записывается в журнал' },
      ],
      confirmLabel: 'Отменить версию',
      tone: 'danger',
    });
  });
});
