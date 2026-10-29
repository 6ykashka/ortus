// W6.22 · Модель снабжения «Ремонта и стройки»: подписи и суммы эталона (`hubVM`, `supMeta`, `makePurchase`, :1544–1642
// `Ремонт и стройка.dc.html`, снимок design-2026-10-19) поверх DTO контракта 0.12.0-stage6.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  availText,
  daysLeft,
  dmText,
  doneText,
  issueTarget,
  moveNote,
  needSub,
  numText,
  isPriceInvalid,
  parsePrice,
  purchaseGroups,
  purchaseLines,
  purchaseMeta,
  purchaseNote,
  qtyText,
  receiveNote,
  requestMeta,
  reserveNote,
  returnNote,
  rubText,
  splitRequests,
} from './model.ts';

type Req = components['schemas']['SupplyRequest'];
type Pur = components['schemas']['Purchase'];

const req = (o: Partial<Req> & { number: string }): Req => ({
  id: `id-${o.number}`,
  projectId: 'p-42',
  projectName: 'ЖК Речной · кв. 42',
  priceItemId: 'm-tile',
  name: 'Керамогранит 60×60',
  unit: 'm2',
  quantity: '18',
  needBy: '2026-10-23',
  state: 'request',
  createdAt: '2026-10-05T07:00:00Z',
  revision: 1,
  ...o,
});

describe('форматы эталона', () => {
  it('рубли — целые, пробел-разделитель и « ₽»', () => {
    expect(rubText(3_240_000)).toBe('32 400 ₽');
    expect(rubText(0)).toBe('0 ₽');
    expect(rubText(12_345)).toBe('123 ₽');
  });

  it('числа — один знак, запятая; количество с единицей эталона', () => {
    expect(numText(52)).toBe('52');
    expect(numText(1.25)).toBe('1,3');
    expect(qtyText('18', 'm2')).toBe('18 м²');
    expect(qtyText('0.5', 'liter')).toBe('0,5 л');
    expect(qtyText('1', 'set')).toBe('1 компл');
    expect(qtyText('46', 'mesh')).toBe('46 меш');
  });

  it('дата «дд.мм» из даты и из момента', () => {
    expect(dmText('2026-10-23')).toBe('23.10');
    expect(dmText('2026-11-03T08:00:00Z')).toBe('03.11');
  });

  it('цена: пробелы, запятая, мусор — ноль', () => {
    expect(parsePrice('1 540,5')).toBe(1540.5);
    expect(parsePrice('')).toBe(0);
    expect(parsePrice('abc')).toBe(0);
  });

  it('неверная цена закупки: непустой ввод, не число больше нуля', () => {
    expect(isPriceInvalid('abc')).toBe(true);
    expect(isPriceInvalid('-5')).toBe(true);
    expect(isPriceInvalid('0')).toBe(true);
    expect(isPriceInvalid('')).toBe(false);
    expect(isPriceInvalid('  ')).toBe(false);
    expect(isPriceInvalid('1 540,5')).toBe(false);
  });
});

describe('«Нужно к» (dd, :1600, :1614)', () => {
  const today = new Date('2026-10-20T10:30:00+03:00');
  it('дни до даты', () => {
    expect(daysLeft('2026-10-22', today)).toBe(2);
    expect(daysLeft('2026-10-20', today)).toBe(0);
    expect(daysLeft('2026-10-18', today)).toBe(-2);
  });

  it('подписи: просрочено, сегодня, через N; предупреждение до 2 дней', () => {
    expect(needSub(-1)).toEqual({ text: 'просрочено на 1 день', warn: true });
    expect(needSub(-5)).toEqual({ text: 'просрочено на 5 дней', warn: true });
    expect(needSub(0)).toEqual({ text: 'сегодня', warn: true });
    expect(needSub(2)).toEqual({ text: 'через 2 дня', warn: true });
    expect(needSub(3)).toEqual({ text: 'через 3 дня', warn: false });
    expect(needSub(14)).toEqual({ text: 'через 14 дней', warn: false });
  });
});

describe('заявки: на складах, решение, группы', () => {
  const withStock = req({
    number: 'З-21',
    name: 'Плинтус МДФ',
    unit: 'm',
    quantity: '42',
    available: [
      { warehouseId: 'wh-1', warehouseName: 'Москва · Отрадное', free: '60' },
      { warehouseId: 'wh-2', warehouseName: 'Мытищи', free: '10' },
    ],
  });
  const noStock = req({ number: 'З-15', available: [] });

  it('«На складах»: список «склад: остаток» или «На складах нет»', () => {
    expect(availText(withStock)).toBe('Москва · Отрадное: 60 м · Мытищи: 10 м');
    expect(availText(noStock)).toBe('На складах нет');
    expect(availText(req({ number: 'З-1' }))).toBe('На складах нет');
  });

  it('склад для выдачи — первый, где свободно не меньше заявки', () => {
    expect(issueTarget(withStock)?.warehouseName).toBe('Москва · Отрадное');
    expect(
      issueTarget(req({ number: 'З-2', quantity: '70', available: withStock.available })),
    ).toBe(undefined);
    expect(issueTarget(noStock)).toBeUndefined();
  });

  it('разбиение: ждут решения, в работе (резерв и закупка), выполнено', () => {
    const list = [
      req({ number: 'З-1', state: 'request' }),
      req({ number: 'З-2', state: 'reserved' }),
      req({ number: 'З-3', state: 'ordered' }),
      req({ number: 'З-4', state: 'bought' }),
      req({ number: 'З-5', state: 'issued' }),
      req({ number: 'З-6', state: 'used' }),
    ];
    const s = splitRequests(list);
    expect(s.pending.map((r) => r.number)).toEqual(['З-1']);
    expect(s.work.map((r) => r.number)).toEqual(['З-2', 'З-3']);
    expect(s.done.map((r) => r.number)).toEqual(['З-4', 'З-5', 'З-6']);
    expect(doneText(3)).toBe('Выполнено: 3 заявки — см. «Движения».');
    expect(doneText(1)).toBe('Выполнено: 1 заявка — см. «Движения».');
    expect(doneText(0)).toBe('');
  });

  it('заметки решений — дословно из эталона', () => {
    expect(reserveNote(withStock, 'Москва · Отрадное')).toBe(
      'Резерв на складе «Москва · Отрадное»: Плинтус МДФ, 42 м. Кладовщик выдаст прорабу по заявке З-21.',
    );
    expect(receiveNote('ЗК-7')).toBe(
      'Закупка ЗК-7 получена: материалы на объектах, суммы разнесены по объектам.',
    );
  });
});

describe('закупка (makePurchase, :1563)', () => {
  const a = req({
    number: 'З-14',
    priceItemId: 'm-laminate',
    name: 'Ламинат 33 класс',
    quantity: '52',
  });
  const b = req({
    number: 'З-24',
    projectId: 'p-45',
    projectName: 'Кофейня на Покровке',
    priceItemId: 'm-tile',
    name: 'Керамогранит 60×60',
    quantity: '70',
  });
  const c = req({
    number: 'З-15',
    priceItemId: 'm-tile',
    name: 'Керамогранит 60×60',
    quantity: '18',
  });

  it('группы по материалу: итог, распределение по объектам, сумма по введённой цене', () => {
    const g = purchaseGroups([a, b, c], { 'm-tile': '1 500', 'm-laminate': '' });
    expect(g.map((x) => x.name)).toEqual(['Ламинат 33 класс', 'Керамогранит 60×60']);
    expect(g[1]).toMatchObject({
      priceItemId: 'm-tile',
      qty: '88 м²',
      dist: 'Кофейня на Покровке — 70 м² · ЖК Речной · кв. 42 — 18 м²',
      sumMinor: 13_200_000,
    });
    expect(g[0]?.sumMinor).toBeNull();
  });

  it('строки запроса: цена только введённая, остальное решает сервер (Q-W4.00-repair-23)', () => {
    expect(purchaseLines([a, c], { 'm-tile': '1500' })).toEqual([
      { supplyRequestId: 'id-З-14' },
      { supplyRequestId: 'id-З-15', price: { amountMinor: 150_000, currency: 'RUB' } },
    ]);
  });

  it('итог закупки: число объектов и позиций, заметка', () => {
    expect(purchaseNote('ЗК-7', 'ПолМаркет', 3, 2)).toBe(
      'Закупка ЗК-7 у «ПолМаркет»: 3 позиции для 2 объектов. После получения сумма каждой строки уйдёт в расходы своего объекта.',
    );
    expect(purchaseNote('ЗК-8', 'КерамТорг', 1, 1)).toBe(
      'Закупка ЗК-8 у «КерамТорг»: 1 позиция для 1 объекта. После получения сумма каждой строки уйдёт в расходы своего объекта.',
    );
  });

  it('строка закупки: дата · позиции · объекты', () => {
    const p: Pur = {
      id: 'pu-6',
      number: 'ЗК-6',
      supplier: 'СтройБаза Север',
      state: 'received',
      lines: [
        {
          supplyRequestId: 'x',
          projectId: 'p-42',
          priceItemId: 'm-cable',
          quantity: '1',
          price: { amountMinor: 1_320_000, currency: 'RUB' },
        },
      ],
      total: { amountMinor: 1_320_000, currency: 'RUB' },
      createdAt: '2026-10-14T08:00:00Z',
      revision: 2,
    };
    expect(purchaseMeta(p)).toBe('14.10 · 1 позиция · 1 объект');
    const line = {
      supplyRequestId: 'x',
      projectId: 'p-42',
      priceItemId: 'm-cable',
      quantity: '1',
      price: { amountMinor: 1, currency: 'RUB' },
    };
    expect(purchaseMeta({ ...p, lines: [line, { ...line, projectId: 'p-38' }, line] })).toBe(
      '14.10 · 3 позиции · 2 объекта',
    );
  });
});

describe('остатки на объектах и склад', () => {
  it('возврат на склад — заметка эталона (:1581)', () => {
    expect(
      returnNote('Керамогранит 60×60', '4', 'm2', 'Мытищи', 'Дом на Лесной · Мытищи', 616_000),
    ).toBe(
      'Керамогранит 60×60, 4 м² возвращены на склад «Мытищи». Средняя цена склада пересчитана, объект «Дом на Лесной · Мытищи» уменьшил расходы на 6 160 ₽.',
    );
  });

  it('перемещение — заметка со ссылкой на заявку цели (:1588)', () => {
    expect(moveNote('Плинтус МДФ', '8', 'm', 'ЖК Северный парк · кв. 117')).toBe(
      'Плинтус МДФ, 8 м перемещены на «ЖК Северный парк · кв. 117». Стоимость перенесена в расходы нового объекта.',
    );
    const open = req({ number: 'З-21', quantity: '42', unit: 'm' });
    expect(moveNote('Плинтус МДФ', '8', 'm', 'ЖК Северный парк · кв. 117', open)).toBe(
      'Плинтус МДФ, 8 м перемещены на «ЖК Северный парк · кв. 117». Заявка З-21 уменьшена до 34 м. Стоимость перенесена в расходы нового объекта.',
    );
    expect(moveNote('Плинтус МДФ', '42', 'm', 'ЖК Северный парк · кв. 117', open)).toBe(
      'Плинтус МДФ, 42 м перемещены на «ЖК Северный парк · кв. 117». Заявка З-21 закрыта перемещением. Стоимость перенесена в расходы нового объекта.',
    );
  });
});

describe('строка состояния заявки (supMeta, :1590)', () => {
  const r = (o: Partial<Req>): Req => req({ number: 'З-9', needBy: '2026-10-27', ...o });

  it('ждёт решения: срок и склады', () => {
    expect(requestMeta(r({ available: [] }), {})).toBe('нужно к 27.10 · на складах нет');
    expect(
      requestMeta(
        r({
          unit: 'm',
          available: [{ warehouseId: 'w', warehouseName: 'Мытищи', free: '10' }],
        }),
        {},
      ),
    ).toBe('нужно к 27.10 · на складе «Мытищи»: 10 м');
    expect(requestMeta(r({}), {})).toBe('нужно к 27.10');
  });

  it('резерв, закупка, выдача, закупленное, списанное', () => {
    expect(requestMeta(r({ state: 'reserved' }), { warehouse: 'Мытищи' })).toBe(
      'Склад «Мытищи» · прораб забирает по заявке',
    );
    expect(requestMeta(r({ state: 'reserved' }), {})).toBe('Прораб забирает по заявке');
    expect(requestMeta(r({ state: 'ordered' }), { purchase: 'ЗК-7' })).toBe(
      'Закупка ЗК-7 · нужно к 27.10',
    );
    expect(
      requestMeta(r({ state: 'issued', cost: { amountMinor: 1_113_000, currency: 'RUB' } }), {}),
    ).toBe('Со склада · 11 130 ₽ по средней цене');
    expect(requestMeta(r({ state: 'issued' }), {})).toBe('Со склада');
    expect(
      requestMeta(r({ state: 'bought', cost: { amountMinor: 1_320_000, currency: 'RUB' } }), {}),
    ).toBe('Чек по QR · 13 200 ₽');
    expect(requestMeta(r({ state: 'used' }), {})).toBe('Списано на объект');
  });
});
