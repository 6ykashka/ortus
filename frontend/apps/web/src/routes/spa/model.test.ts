// W5.21 · Модель страницы «Салон и SPA»: подписи эталона (spaVM :4242), нехватка материала и решения владельца,
// проверка форм записи и услуги. Таблицы значений — без DOM.
import { describe, expect, it } from 'vitest';

import {
  buffersText,
  chipOf,
  clientOf,
  clientsOf,
  draftOfService,
  durationText,
  moneyText,
  overridesOf,
  recipeChips,
  serviceBody,
  serviceErrors,
  shortages,
  shortageText,
  startsAtOf,
  timeOptions,
  unitLabel,
  visitErrors,
} from './model.ts';

const NAMES = new Map([
  ['oil', 'Масло массажное'],
  ['cream', 'Крем восстанавливающий'],
]);

describe('chipOf — статусы визита (ST :4244)', () => {
  it.each([
    ['confirmed', 'Подтверждено', 'info', 'event_available'],
    ['performed_pending_posting', 'Выполнено · учёт не завершён', 'warn', 'inventory'],
    ['completed', 'Завершено · списано', 'ok', 'check_circle'],
    ['cancelled', 'Отменено', 'neutral', 'event_busy'],
    ['no_show', 'Не пришёл', 'danger', 'person_off'],
  ] as const)('%s → «%s»', (status, label, tone, icon) => {
    expect(chipOf(status)).toEqual({ label, tone, icon });
  });
});

describe('подписи карточки визита', () => {
  it('длительность и буферы (:4254–4255)', () => {
    expect(durationText(60)).toBe('60 мин');
    expect(buffersText(0, 15)).toBe('уборка 15 мин');
    expect(buffersText(15, 15)).toBe('подготовка 15 мин · уборка 15 мин');
    expect(buffersText(0, 0)).toBe('без буферов');
  });

  it('единицы и деньги', () => {
    expect(unitLabel('ml')).toBe('мл');
    expect(unitLabel('g')).toBe('г');
    expect(unitLabel('piece')).toBe('шт');
    expect(moneyText({ amountMinor: 320000, currency: 'RUB' })).toBe('3 200 ₽');
    expect(moneyText({ amountMinor: 150050, currency: 'RUB' })).toBe('1 500,50 ₽');
  });

  it('клиент — из названия брони «Услуга · Клиент»; без брони — запасная подпись', () => {
    expect(clientOf('Классический массаж · Мария К.', 'Классический массаж')).toBe('Мария К.');
    expect(clientOf('SPA-ритуал · Ольга Р.', undefined)).toBe('Ольга Р.');
    expect(clientOf('Массаж спины', 'Массаж спины')).toBe('Клиент');
    expect(clientOf(undefined, 'Массаж спины')).toBe('Клиент');
  });

  it('техкарта — «Название количество единица»', () => {
    expect(
      recipeChips(
        [
          { itemId: 'oil', quantity: '40', unit: 'ml' },
          { itemId: 'cream', quantity: '20', unit: 'g' },
        ],
        NAMES,
      ),
    ).toEqual(['Масло массажное 40 мл', 'Крем восстанавливающий 20 г']);
    expect(recipeChips([{ itemId: 'zz', quantity: '5', unit: 'piece' }], NAMES)).toEqual([
      'Позиция 5 шт',
    ]);
  });
});

describe('нехватка материала и решения владельца (issues :4237, resolveIssue)', () => {
  const recipe = [
    { itemId: 'oil', quantity: '40', unit: 'ml' as const },
    { itemId: 'cream', quantity: '20', unit: 'g' as const },
  ];
  const have = new Map([
    ['oil', 250],
    ['cream', 12],
  ]);

  it('нехватка — только позиции, где нужно больше, чем есть', () => {
    expect(shortages(recipe, have)).toEqual([{ itemId: 'cream', need: 20, have: 12, unit: 'g' }]);
    expect(
      shortages(
        recipe,
        new Map([
          ['oil', 250],
          ['cream', 99],
        ]),
      ),
    ).toEqual([]);
  });

  it('позиция без остатка в ответе — остаток 0', () => {
    expect(shortages([{ itemId: 'oil', quantity: '5', unit: 'ml' }], new Map())).toEqual([
      { itemId: 'oil', need: 5, have: 0, unit: 'ml' },
    ]);
  });

  it('текст баннера: «Не хватило «X»: нужно N u, в наличии M u · Услуга (Клиент)»', () => {
    const s = shortages(recipe, have);
    expect(shortageText(s, NAMES, 'SPA-ритуал', 'Ольга Р.')).toBe(
      'Не хватило «Крем восстанавливающий»: нужно 20 г, в наличии 12 г · SPA-ритуал (Ольга Р.)',
    );
  });

  it('решение: фактический расход = остаток; причина по кнопке эталона', () => {
    const s = shortages(recipe, have);
    expect(overridesOf(s, 'reserve')).toEqual([
      { itemId: 'cream', actualQuantity: '12', reason: 'Списан остаток из резерва' },
    ]);
    expect(overridesOf(s, 'actual')[0]?.reason).toBe('Принят фактический расход');
  });

  it('дробные количества без хвоста', () => {
    const s = shortages([{ itemId: 'oil', quantity: '2.5', unit: 'ml' }], new Map([['oil', 1.25]]));
    expect(shortageText(s, NAMES, 'У', 'К')).toContain('нужно 2,5 мл, в наличии 1,25 мл');
    expect(overridesOf(s, 'actual')[0]?.actualQuantity).toBe('1.25');
  });
});

describe('время записи', () => {
  it('сетка 15 минут рабочего дня 08:00–20:00', () => {
    const o = timeOptions();
    expect(o[0]).toEqual({ value: '08:00', label: '08:00' });
    expect(o.at(-1)).toEqual({ value: '19:45', label: '19:45' });
    expect(o).toHaveLength(48);
  });

  it('начало записи — момент UTC по поясу организации', () => {
    expect(startsAtOf('2026-10-01', '15:15', 'Europe/Moscow')).toBe('2026-10-01T12:15:00Z');
    expect(startsAtOf('2026-10-01', '08:00', 'Europe/Moscow')).toBe('2026-10-01T05:00:00Z');
  });
});

describe('форма «Записать клиента»', () => {
  const draft = {
    serviceId: 's1',
    clientId: 'c1',
    practitionerId: 'p1',
    roomId: 'r1',
    equipmentIds: [] as string[],
    time: '15:15',
  };

  it('полная форма без ошибок', () => {
    expect(visitErrors(draft, [])).toEqual({});
  });

  it('пустые поля — ошибки под полями', () => {
    expect(
      visitErrors({ ...draft, serviceId: '', clientId: '', practitionerId: '', roomId: '' }, []),
    ).toEqual({
      serviceId: 'Выберите услугу',
      clientId: 'Выберите клиента',
      practitionerId: 'Выберите специалиста',
      roomId: 'Выберите кабинет',
    });
  });

  it('оборудование, нужное услуге, должно быть выбрано', () => {
    expect(visitErrors(draft, ['t1'])).toEqual({ equipmentIds: 'Для услуги нужно оборудование' });
    expect(visitErrors({ ...draft, equipmentIds: ['t1'] }, ['t1'])).toEqual({});
  });
});

describe('клиенты для записи (справочника в контракте нет, Q-W5.21-1)', () => {
  it('клиенты визитов с подписью из названий броней, без повторов', () => {
    const visits = [
      { id: 'a1', clientId: 'c1', serviceId: 's1', bookingId: 'b1' },
      { id: 'a2', clientId: 'c2', serviceId: 's2', bookingId: 'b2' },
      { id: 'a3', clientId: 'c1', serviceId: 's1', bookingId: 'b3' },
    ];
    const titles = new Map([
      ['b1', 'Классический массаж · Мария К.'],
      ['b2', 'SPA-ритуал · Ольга Р.'],
    ]);
    const services = new Map([
      ['s1', 'Классический массаж'],
      ['s2', 'SPA-ритуал'],
    ]);
    expect(clientsOf(visits, titles, services)).toEqual([
      { id: 'c1', name: 'Мария К.' },
      { id: 'c2', name: 'Ольга Р.' },
    ]);
  });
});

describe('форма услуги', () => {
  const draft = {
    name: 'Массаж лица',
    duration: '30',
    before: '0',
    after: '10',
    price: '1800',
    equipmentIds: [] as string[],
    recipe: [{ itemId: 'oil', quantity: '10' }],
  };

  it('тело createSpaService: копейки, десятичные количества и единицы позиций', () => {
    const items = [{ id: 'oil', baseUnit: 'ml' as const }];
    expect(serviceBody(draft, items)).toEqual({
      name: 'Массаж лица',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 10,
      price: { amountMinor: 180000, currency: 'RUB' },
      requiredEquipmentIds: [],
      recipe: [{ itemId: 'oil', quantity: '10', unit: 'ml' }],
    });
  });

  it('запятая как разделитель; цена с копейками', () => {
    const body = serviceBody(
      { ...draft, price: '1 800,50', recipe: [{ itemId: 'oil', quantity: '2,5' }] },
      [{ id: 'oil', baseUnit: 'ml' }],
    );
    expect(body.price.amountMinor).toBe(180050);
    expect(body.recipe[0]?.quantity).toBe('2.5');
  });

  it('правила полей', () => {
    expect(serviceErrors(draft)).toEqual({});
    expect(
      serviceErrors({ ...draft, name: ' ', duration: '0', before: '-1', after: 'x', price: '' }),
    ).toEqual({
      name: 'Укажите название',
      duration: 'Длительность — целое число минут, больше нуля',
      before: 'Буфер — целое число минут, от нуля',
      after: 'Буфер — целое число минут, от нуля',
      price: 'Укажите цену числом',
    });
  });

  it('строки техкарты: позиция и количество больше нуля, без повторов', () => {
    expect(serviceErrors({ ...draft, recipe: [{ itemId: '', quantity: '5' }] })).toEqual({
      recipe: 'Выберите позицию в каждой строке техкарты',
    });
    expect(serviceErrors({ ...draft, recipe: [{ itemId: 'oil', quantity: '0' }] })).toEqual({
      recipe: 'Количество в техкарте — число больше нуля',
    });
    expect(
      serviceErrors({
        ...draft,
        recipe: [
          { itemId: 'oil', quantity: '5' },
          { itemId: 'oil', quantity: '6' },
        ],
      }),
    ).toEqual({ recipe: 'Позиция уже есть в техкарте' });
  });

  it('черновик из услуги и обратно', () => {
    const d = draftOfService({
      id: 's',
      orgUnitId: 'u',
      name: 'SPA-ритуал',
      durationMinutes: 90,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      price: { amountMinor: 650000, currency: 'RUB' },
      requiredEquipmentIds: ['table'],
      recipe: [{ itemId: 'oil', quantity: '40', unit: 'ml' }],
      revision: 3,
    });
    expect(d).toEqual({
      name: 'SPA-ритуал',
      duration: '90',
      before: '15',
      after: '15',
      price: '6500',
      equipmentIds: ['table'],
      recipe: [{ itemId: 'oil', quantity: '40' }],
    });
  });
});
