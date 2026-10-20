// W4.41 · Домен «Календарь» (`core-calendar`, CAL-01…05): подписи и шаблоны страницы дословно по эталону
// design-2026-10-19 «Ортус CRM.dc.html» pg.calendar :1781–1823, calVM :4140–4180 (статические строки сверяет
// domains.test.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calendar, format } from '../src/index.ts';

describe('calendar: подписи pg.calendar', () => {
  it('шапка, фильтр, сетка, легенда', () => {
    assert.equal(calendar.title, 'Календарь ресурсов');
    assert.equal(calendar.kindAria, 'Тип ресурса');
    assert.equal(calendar.all, 'Все ресурсы');
    assert.deepEqual(calendar.kinds, {
      vehicle: 'Машины',
      member: 'Сотрудники',
      room: 'Помещения',
      equipment: 'Оборудование',
    });
    assert.equal(calendar.resource, 'Ресурс');
    assert.equal(calendar.legendBuffer, 'подготовка и уборка — ресурс занят');
    assert.equal(
      calendar.legendNote,
      'Срок задачи ресурс не занимает. Перенос — предложение, его подтверждает сервер.',
    );
    assert.equal(calendar.city.moscow, 'Москва');
  });

  it('панель брони, запреты переноса, конфликт, тосты', () => {
    assert.deepEqual(calendar.source, {
      appointment: 'Открыть визит',
      trip: 'Открыть рейс',
      maintenance: 'Открыть машину',
    });
    assert.equal(calendar.moveTo, 'Перенести начало на');
    assert.equal(calendar.move, 'Проверить и перенести');
    assert.deepEqual(calendar.lock, {
      permission: 'Нет права «Изменять» в календаре.',
      sourceModule:
        'Время рейса меняется в рабочем месте логиста — календарь вызывает команду исходного модуля.',
      specialistSchedule: 'Перерыв меняется в графике специалиста.',
      vehicleCard: 'Недоступность машины задаётся в карточке машины.',
    });
    assert.equal(calendar.slots, 'Свободные слоты для всех ресурсов:');
    assert.equal(calendar.moved, 'Перенос подтверждён сервером');
  });
});

describe('calendar: шаблоны calVM', () => {
  const cases = [
    [
      ':1784',
      calendar.dateLine,
      { date: 'Среда, 1 октября 2026', city: 'Москва', offset: '+3' },
      'Среда, 1 октября 2026 · Москва (UTC+3)',
    ],
    [':4152', calendar.hour, { h: 8 }, '8:00'],
    [':4152', calendar.hour, { h: 20 }, '20:00'],
    [
      ':4155',
      calendar.blockAria,
      { title: 'Рейс Р-208', from: '09:00', to: '13:00' },
      'Рейс Р-208, 09:00–13:00',
    ],
    [':4168', calendar.metaTime, { from: '10:00', to: '11:00' }, '10:00–11:00'],
    [':4168', calendar.metaPrep, { n: 15 }, 'подготовка 15 мин'],
    [':4168', calendar.metaClean, { n: 15 }, 'уборка 15 мин'],
    [':4176', calendar.movedTo, { time: '08:15' }, 'Перенесено на 08:15'],
  ];
  for (const [src, msg, values, expected] of cases) {
    it(`${src} → ${expected}`, () => {
      assert.equal(typeof msg, 'string', `${src}: ключ словаря не найден`);
      assert.equal(format(msg, values), expected);
    });
  }

  it('мета брони эталона: части через « · »', () => {
    const meta = [
      format(calendar.metaTime, { from: '11:30', to: '13:00' }),
      format(calendar.metaPrep, { n: 15 }),
      format(calendar.metaClean, { n: 15 }),
      'Анна Морозова · массажист, Кабинет № 2, Стол с подогревом',
    ].join(' · ');
    assert.equal(
      meta,
      '11:30–13:00 · подготовка 15 мин · уборка 15 мин · Анна Морозова · массажист, Кабинет № 2, Стол с подогревом',
    );
  });
});
