// W2.73 · Тексты S2-20 «Машина для временного водителя» (D-35): шаблоны дают строки макетов 1a, 1b, 1f, 1g
// «Временный водитель - варианты.dc.html» (снимок 19.10b) на данных макета — рейс Р-211, Ford Transit «Север
// Логистик», Hyundai HD-35 «Юг Транс», Олег Тарасов.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { format, home, logisticsManager } from '../src/index.ts';
import { S220_HTML, readText } from './_util.mjs';

const R = logisticsManager.request;
const I = logisticsManager.pool.incoming;
const F = logisticsManager.pool.transfer;
const Q = home.queue;
const design = readText(S220_HTML);

const run = (cases) => {
  for (const [msg, values, expected] of cases) {
    it(expected, () => {
      assert.equal(typeof msg, 'string', 'ключ словаря не найден');
      assert.equal(format(msg, values), expected);
      assert.ok(design.includes(expected), `нет в макете: ${expected}`);
    });
  }
};

describe('1a · «Запросить водителя», блок «Машина»', () => {
  run([
    [
      R.tripDateValue,
      { trip: 'Р-211', title: 'Охлаждённая продукция', date: '01.10', window: '14:00–18:00' },
      'Р-211 · Охлаждённая продукция · 01.10, 14:00–18:00',
    ],
    [
      R.cargoValue,
      { mass: '0,6', volume: '7', length: '2,4', temp: '+2…+6 °C' },
      '0,6 т · 7 м³ · кузов от 2,4 м · +2…+6 °C',
    ],
    [R.accessValue, { until: '18:30' }, 'С одобрения до 18:30, только этот рейс'],
    [
      R.driverQualValue,
      { driver: 'Водитель #104', firm: 'Юг Транс', qual: 'Кат. C · рефрижератор' },
      'Водитель #104 · Юг Транс · Кат. C · рефрижератор',
    ],
    [
      R.homeSpecs,
      { body: 'Рефрижератор', mass: '1,8', volume: '13', length: '3,6', temp: '−10…+10 °C' },
      'Рефрижератор · 1,8 т · 13 м³ · кузов 3,6 м · −10…+10 °C',
    ],
    [
      R.homeSpecs,
      { body: 'Фургон', mass: '1,8', volume: '13', length: '3,6', temp: R.noCooling },
      'Фургон · 1,8 т · 13 м³ · кузов 3,6 м · без охлаждения',
    ],
    [R.homeFits, { window: '14:00–18:00' }, 'Подходит рейсу · свободна 14:00–18:00'],
    [
      R.homeNoFit,
      { reason: 'нет охлаждения +2…+6 °C' },
      'Не подходит рейсу: нет охлаждения +2…+6 °C',
    ],
    [R.homeApprove, { firm: 'Юг Транс' }, 'Машину тоже согласует Юг Транс.'],
    [
      R.hostCount,
      { fit: 1, free: 4, firm: 'Север Логистик' },
      'Рейсу подходит 1 из 4 свободных машин Север Логистик.',
    ],
    [
      R.choiceHint,
      { until: '13:30', host: 'Ford Transit', home: 'Hyundai HD-35' },
      'Водитель выберет в день рейса до 13:30: Ford Transit или свою Hyundai HD-35.',
    ],
    [
      R.choiceOff,
      { reason: R.noCoolingReason },
      'Недоступно: обычная машина не подходит рейсу, нет охлаждения.',
    ],
    [
      R.sum.choiceHolds,
      {
        window: '14:00–18:00',
        host: 'Ford Transit',
        home: 'Hyundai HD-35',
        brand: 'Hyundai',
        firm: 'Юг Транс',
      },
      'Две брони до выбора на 14:00–18:00: Ford Transit и Hyundai HD-35. До рейса Hyundai работает в Юг Транс.',
    ],
    [
      R.sum.choiceUntil,
      { until: '13:30' },
      'Водитель выберет машину до 13:30. Вторая бронь снимется сразу.',
    ],
    [
      R.sum.choiceDefault,
      { host: 'Ford Transit', brand: 'Hyundai', firm: 'Юг Транс' },
      'Не выберет — останется Ford Transit, Hyundai вернётся в Юг Транс.',
    ],
    [
      R.sum.host,
      { host: 'Ford Transit', window: '14:00–18:00' },
      'Бронь Ford Transit на 14:00–18:00.',
    ],
    [
      R.sum.home,
      { home: 'Hyundai HD-35', window: '14:00–18:00', firm: 'Юг Транс' },
      'Бронь Hyundai HD-35 на 14:00–18:00, если Юг Транс одобрит машину.',
    ],
    [
      R.sum.access,
      { trip: 'Р-211', until: '18:30', firm: 'Юг Транс' },
      'Доступ водителя — только к рейсу Р-211 до 18:30. История и начисления остаются в Юг Транс.',
    ],
  ]);
  it('без фирмы — подсказка без хвоста', () =>
    assert.equal(
      format(R.hostCount, { fit: 0, free: 1, firm: 'none' }),
      'Рейсу подходит 0 из 1 свободной машины.',
    ));
});

describe('1b · входящий запрос фирмы водителя', () => {
  run([
    [I.who, { name: 'Олег Тарасов', driver: 'Водитель #104' }, 'Олег Тарасов · Водитель #104'],
    [
      I.whenValue,
      { date: '01.10', window: '14:00–18:00', until: '18:30' },
      '01.10, 14:00–18:00 · доступ до 18:30',
    ],
    [
      I.carChoice,
      { host: 'Ford Transit', home: 'Hyundai HD-35' },
      'Их Ford Transit или ваша Hyundai HD-35 — на выбор водителя',
    ],
    [I.carHost, { host: 'Ford Transit', plate: 'М 608 КТ 77' }, 'Их Ford Transit · М 608 КТ 77'],
    [
      I.carHome,
      { home: 'Hyundai HD-35', plate: 'Н 384 ТК 77' },
      'Ваша Hyundai HD-35 · Н 384 ТК 77',
    ],
    [I.freeFor, { window: '14:00–18:00' }, 'Свободна 14:00–18:00'],
    [
      I.holdChoice,
      { window: '14:00–18:00', until: '13:30' },
      'Удерживается на 14:00–18:00, пока водитель выбирает (до 13:30). Не выберет её — сразу вернётся к вам.',
    ],
    [
      I.holdHome,
      { window: '14:00–18:00', trip: 'Р-211', firm: 'Север Логистик' },
      'Занята на 14:00–18:00 рейсом Р-211 Север Логистик.',
    ],
    [I.opens, { firm: 'Север Логистик' }, 'Что откроется Север Логистик'],
    [I.opensDriver, { until: '18:30' }, 'Имя и телефон водителя до 18:30'],
    [I.hidden, { firm: 'Юг Транс' }, 'Начисления, история рейсов, другие машины Юг Транс'],
    [
      I.note,
      { firm: 'Юг Транс' },
      'Отклонить можно только с причиной. Начисления по рейсу ведутся отдельной записью, Юг Транс их не получает автоматически.',
    ],
  ]);
  it('«Север Логистик просит на рейс Р-211 · Охлаждённая продукция» — начало строки', () =>
    assert.ok(design.includes(format(I.asks, { firm: 'Север Логистик', trip: 'Р-211' }))));
});

describe('1f · итог запроса у логиста', () => {
  run([
    [F.accessValue, { until: '18:30' }, 'До 18:30, только этот рейс'],
    [F.chosen, { time: '13:12' }, 'Выбрана · 13:12'],
    [F.released, { time: '13:12' }, 'Освобождена · 13:12'],
    [F.none, { firm: 'Юг Транс' }, 'Машины нет: Юг Транс выдал водителя без обычной машины.'],
    [
      F.deadline,
      { until: '13:30', host: 'Ford Transit', home: 'Hyundai HD-35', firm: 'Юг Транс' },
      'Если водитель не выбирает до 13:30, остаётся Ford Transit, а Hyundai HD-35 возвращается в Юг Транс.',
    ],
  ]);
  // Строки журнала эталон собирает конкатенацией (:618–624) — сверка с JS-выражением макета.
  const cases = [
    [
      F.requested,
      { mode: 'host_or_home', host: 'Ford Transit' },
      'Вы запросили водителя. Машина: наша Ford Transit, можно свою обычную.',
    ],
    [
      F.requested,
      { mode: 'host', host: 'Ford Transit' },
      'Вы запросили водителя. Машина: наша Ford Transit.',
    ],
    [
      F.requested,
      { mode: 'home', host: '' },
      'Вы запросили водителя. Машина: обычная машина водителя.',
    ],
    [F.approved, { firm: 'Юг Транс', what: 'both' }, 'Юг Транс одобрил водителя с машиной.'],
    [
      F.approved,
      { firm: 'Юг Транс', what: 'driver' },
      'Юг Транс одобрил только водителя, без машины.',
    ],
    [F.approved, { firm: 'Юг Транс', what: 'other' }, 'Юг Транс одобрил водителя.'],
    [
      F.holds,
      { window: '14:00–18:00', host: 'Ford Transit', home: 'Hyundai HD-35' },
      'Брони до выбора на 14:00–18:00: Ford Transit и Hyundai HD-35.',
    ],
    [
      F.chose,
      { chosen: 'Hyundai HD-35', other: 'Ford Transit' },
      'Водитель выбрал Hyundai HD-35. Ford Transit освобождена.',
    ],
    [
      F.one,
      { vehicle: 'Ford Transit', window: '14:00–18:00' },
      'Бронь Ford Transit на 14:00–18:00.',
    ],
  ];
  for (const [msg, values, expected] of cases) {
    it(expected, () => assert.equal(format(msg, values), expected));
  }
  it('«Машины нет, рейс попал в «Требует решения».» — в макете', () =>
    assert.ok(design.includes(F.noVehicle)));
});

describe('1g · «Требует решения» логиста', () => {
  run([
    [Q.vehicleChoice, { trip: 'Р-211' }, 'Р-211: водитель ещё не выбрал машину'],
    [
      Q.vehicleChoiceText,
      { driver: 'Олег Тарасов', firm: 'Юг Транс', host: 'Ford Transit', home: 'Hyundai HD-35' },
      'Олег Тарасов, Юг Транс. Не выберет — останется Ford Transit, Hyundai HD-35 вернётся в Юг Транс. Написать водителю можно в чате рейса.',
    ],
    [Q.noVehicle, { trip: 'Р-211' }, 'Р-211: нет машины'],
    [
      Q.noVehicleText,
      { firm: 'Юг Транс', driver: 'Олега Тарасова' },
      'Юг Транс выдал Олега Тарасова без обычной машины. Водитель получит уведомление и сразу начнёт осмотр.',
    ],
    [Q.chips.until, { time: '13:30' }, 'до 13:30'],
    [Q.chips.tripAt, { time: '14:00' }, 'рейс в 14:00'],
    [Q.actions.keepVehicle, { vehicle: 'Ford Transit' }, 'Оставить Ford Transit'],
  ]);
});
