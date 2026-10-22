// W2.25 · Источники «Требует решения» этапа 2 (homeVM :4053–4072; 05 §5.5; 01-shell.md §23 строки 1–3, 6): карточки
// по примерам контракта getMyDecisionQueue/{ok,manager} и сценарию conformance «блокирующий дефект».
import { describe, expect, it } from 'vitest';

import type { DecisionItemLike, HomeSource } from '../types.ts';
import { source as access } from './access.ts';
import { accusative, source as fleet } from './fleet.ts';
import { source as tenant } from './tenant.ts';

const CTX = { timeZone: 'Europe/Moscow' };
const TRIP = '604f2a38-8d47-5a47-90b6-7b4ca5e6f791';

function cardOf(src: HomeSource, it: Omit<DecisionItemLike, 'key'>) {
  const build = src.kinds[it.kind];
  if (!build) throw new Error(`нет провайдера ${it.kind}`);
  return build({ ...it, key: `${it.kind}:x` }, CTX);
}

const tripRef = { moduleKey: 'fleet', entityType: 'trip', entityId: TRIP };

describe('источник «Логистика» (fleet)', () => {
  it('модуль fleet, этап 2, пять видов (W2.73: два вида S2-20)', () => {
    expect(fleet.moduleKey).toBe('fleet');
    expect(fleet.stage).toBe(2);
    expect(Object.keys(fleet.kinds)).toEqual([
      'fleet.blocking_defect',
      'fleet.trip_review',
      'fleet.trip_without_driver',
      'fleet.vehicle_choice_pending',
      'fleet.trip_without_vehicle',
    ]);
  });

  // W2.73 · S2-20 1g («Временный водитель - варианты.dc.html» :476–491, design-2026-10-19b): параметры — как в
  // описании DecisionItem.kind контракта 0.6.3-stage2 и MSW W2.71 (home.ts vehicleSource).
  it('водитель ещё не выбрал машину: schedule · «до 13:30» · «Оставить Ford Transit» → «Ресурсный пул» ?trip=', () => {
    expect(
      cardOf(fleet, {
        kind: 'fleet.vehicle_choice_pending',
        moduleKey: 'fleet',
        tone: 'warn',
        object: tripRef,
        params: {
          tripNumber: 'Р-211',
          driverName: 'Олег Тарасов',
          homeOrgUnitName: 'Юг Транс',
          chooseUntil: '2026-10-01T10:30:00Z',
          hostVehicle: 'Ford Transit · М 608 КТ 77',
          homeVehicle: 'Hyundai HD-35 · Н 384 ТК 77',
          reservationId: 'r-ford',
        },
      }),
    ).toEqual({
      icon: 'schedule',
      tag: { key: 'queue.chips.until', args: { time: '13:30' } },
      title: { key: 'queue.vehicleChoice', args: { trip: 'Р-211' } },
      text: {
        key: 'queue.vehicleChoiceText',
        args: {
          driver: 'Олег Тарасов',
          firm: 'Юг Транс',
          host: 'Ford Transit',
          home: 'Hyundai HD-35',
        },
      },
      action: {
        label: { key: 'queue.actions.keepVehicle', args: { vehicle: 'Ford Transit' } },
        target: { page: 'pool', search: { trip: TRIP } },
      },
    });
  });

  it('нет машины: no_crash · «рейс в 14:00» · «Поставить машину» → «Рабочее место логиста» ?trip=', () => {
    expect(
      cardOf(fleet, {
        kind: 'fleet.trip_without_vehicle',
        moduleKey: 'fleet',
        tone: 'danger',
        object: tripRef,
        params: {
          tripNumber: 'Р-211',
          driverName: 'Олег Тарасов',
          homeOrgUnitName: 'Юг Транс',
          startsAt: '2026-10-01T11:00:00Z',
        },
      }),
    ).toEqual({
      icon: 'no_crash',
      tag: { key: 'queue.chips.tripAt', args: { time: '14:00' } },
      title: { key: 'queue.noVehicle', args: { trip: 'Р-211' } },
      text: { key: 'queue.noVehicleText', args: { firm: 'Юг Транс', driver: 'Олега Тарасова' } },
      action: {
        label: { key: 'queue.actions.assignVehicle' },
        target: { page: 'fleet', search: { trip: TRIP } },
      },
    });
  });

  it('имя водителя в винительном падеже («выдал Олега Тарасова», :488)', () => {
    expect(
      [
        'Олег Тарасов',
        'Марина Котова',
        'Илья Васильев',
        'Дмитрий Соколов',
        'Игорь Невский',
        'Анна Кольцевая',
        '',
      ].map(accusative),
    ).toEqual([
      'Олега Тарасова',
      'Марину Котову',
      'Илью Васильева',
      'Дмитрия Соколова',
      'Игоря Невского',
      'Анну Кольцевую',
      '',
    ]);
  });

  it('винительный падеж с родом по имени: женские фамилии на согласную и имена на «ь» не склоняются', () => {
    expect(
      [
        'Анна Шевчук',
        'Любовь Ковальчук',
        'Ольга Петренко',
        'Мария Белова',
        'Илья Мельник',
        'Никита Шевчук',
        'Игорь Ковальчук',
      ].map(accusative),
    ).toEqual([
      'Анну Шевчук',
      'Любовь Ковальчук',
      'Ольгу Петренко',
      'Марию Белову',
      'Илью Мельника',
      'Никиту Шевчука',
      'Игоря Ковальчука',
    ]);
  });

  // Возврат 3 (ревью r3, minor; Q-W2.73-4): беглая гласная имён и несклоняемые фамилии на «-ых», «-их».
  it('винительный падеж: беглая гласная («Павла», «Петра», «Льва»), фамилии на «-ых», «-их» не склоняются', () => {
    expect(
      [
        'Павел Черных',
        'Пётр Долгих',
        'Петр Седых',
        'Лев Белых',
        'Анна Черных',
        'Павел Соколов',
      ].map(accusative),
    ).toEqual([
      'Павла Черных',
      'Петра Долгих',
      'Петра Седых',
      'Льва Белых',
      'Анну Черных',
      'Павла Соколова',
    ]);
  });

  it('блокирующий дефект: report · «Блокирует выезд» · «Решить» → «Приёмка смен» ?trip=', () => {
    expect(
      cardOf(fleet, {
        kind: 'fleet.blocking_defect',
        moduleKey: 'fleet',
        tone: 'danger',
        object: tripRef,
        params: {
          tripNumber: 'Р-208',
          zone: 'Стёкла',
          description: 'Скол',
          driverName: 'Илья Васильев',
        },
      }),
    ).toEqual({
      icon: 'report',
      tag: { key: 'queue.chips.blocksDeparture' },
      title: { key: 'queue.criticalDefect', args: { trip: 'Р-208' } },
      text: {
        key: 'queue.defectText',
        args: { zone: 'Стёкла', description: 'Скол', driver: 'Илья Васильев' },
      },
      action: {
        label: { key: 'queue.actions.resolve' },
        target: { page: 'review', search: { trip: TRIP } },
      },
    });
  });

  it('смена на приёмке: fact_check · «Приёмка» · «Проверить» → «Приёмка смен» ?trip=', () => {
    expect(
      cardOf(fleet, {
        kind: 'fleet.trip_review',
        moduleKey: 'fleet',
        tone: 'warn',
        object: tripRef,
        params: { tripNumber: 'Р-208', driverName: 'Илья Васильев' },
      }),
    ).toEqual({
      icon: 'fact_check',
      tag: { key: 'queue.chips.review' },
      title: { key: 'queue.shiftWaits', args: { trip: 'Р-208' } },
      text: { key: 'queue.shiftWaitsText', args: { driver: 'Илья Васильев' } },
      action: {
        label: { key: 'queue.actions.check' },
        target: { page: 'review', search: { trip: TRIP } },
      },
    });
  });

  it('рейс без водителя: person_search · «Сегодня 14:00» · «Найти в пуле» → «Ресурсный пул»', () => {
    expect(
      cardOf(fleet, {
        kind: 'fleet.trip_without_driver',
        moduleKey: 'fleet',
        tone: 'info',
        object: tripRef,
        params: {
          tripNumber: 'Р-211',
          title: 'Охлаждённая продукция',
          cargo: 'Молочная продукция · +2…+6 °C',
          startsAt: '2026-10-01T11:00:00Z',
        },
      }),
    ).toEqual({
      icon: 'person_search',
      tag: { key: 'queue.chips.today', args: { time: '14:00' } },
      title: { key: 'queue.tripNoDriver', args: { trip: 'Р-211' } },
      text: {
        key: 'queue.tripNoDriverText',
        args: { title: 'Охлаждённая продукция', cargo: 'Молочная продукция · +2…+6 °C' },
      },
      action: { label: { key: 'queue.actions.findInPool' }, target: { page: 'pool' } },
    });
  });

  it('рейс без водителя с запросом в пул: «Ждёт другой фирмы» · «Открыть пул»', () => {
    const c = cardOf(fleet, {
      kind: 'fleet.trip_without_driver',
      moduleKey: 'fleet',
      tone: 'info',
      object: tripRef,
      params: {
        tripNumber: 'Р-211',
        title: 'Охлаждённая продукция',
        cargo: 'Молочная продукция',
        startsAt: '2026-10-01T11:00:00Z',
        poolRequest: 'pending',
        poolHome: 'Юг Транс',
      },
    });
    expect(c.tag).toEqual({ key: 'queue.chips.otherFirm' });
    expect(c.text).toEqual({ key: 'queue.poolRequested', args: { firm: 'Юг Транс' } });
    expect(c.action).toEqual({
      label: { key: 'queue.actions.openPool' },
      target: { page: 'pool' },
    });
  });
});

describe('источник «Организация» (tenant, только владелец — решает сервер)', () => {
  it('модуль billing, этап 2, три вида', () => {
    expect(tenant.moduleKey).toBe('billing');
    expect(Object.keys(tenant.kinds)).toEqual([
      'tenant.trial_ended',
      'tenant.trial_ending',
      'tenant.storage_high',
    ]);
  });

  it('пробный период: hourglass_top · «Подписка» · «До 13.10.2026…» · «Модули и место»', () => {
    expect(
      cardOf(tenant, {
        kind: 'tenant.trial_ending',
        moduleKey: 'billing',
        tone: 'neutral',
        params: { daysLeft: '12', trialEndsAt: '2026-10-13T21:00:00Z' },
      }),
    ).toEqual({
      icon: 'hourglass_top',
      tag: { key: 'queue.chips.subscription' },
      title: { key: 'queue.trialLeft', args: { days: 12 } },
      text: { key: 'queue.trialLeftText', args: { date: '13.10.2026' } },
      action: { label: { key: 'queue.actions.modules' }, target: { page: 'modules' } },
    });
  });

  it('пробный период завершён: lock_clock · «Подписка» · «Подробнее»', () => {
    expect(
      cardOf(tenant, {
        kind: 'tenant.trial_ended',
        moduleKey: 'billing',
        tone: 'danger',
        params: {},
      }),
    ).toEqual({
      icon: 'lock_clock',
      tag: { key: 'queue.chips.subscription' },
      title: { key: 'queue.trialEnded' },
      text: { key: 'queue.trialEndedText' },
      action: { label: { key: 'queue.actions.more' }, target: { page: 'modules' } },
    });
  });

  it('место: storage · «Место» · «Занято 92% места» · «46,2 из 50 ГБ»', () => {
    const GiB = 1024 ** 3;
    expect(
      cardOf(tenant, {
        kind: 'tenant.storage_high',
        moduleKey: 'billing',
        tone: 'warn',
        params: {
          percent: '92',
          usedBytes: String(Math.round(46.2 * GiB)),
          quotaBytes: String(50 * GiB),
        },
      }),
    ).toEqual({
      icon: 'storage',
      tag: { key: 'queue.chips.storage' },
      title: { key: 'queue.storageUsed', args: { pct: 92 } },
      text: { key: 'queue.storageText', args: { used: '46,2', quota: '50' } },
      action: { label: { key: 'queue.actions.modules' }, target: { page: 'modules' } },
    });
  });
});

describe('источник «Доступ» (access)', () => {
  it('сотрудники без роли: person_off · «Доступ» · «Назначить» → «Пользователи и роли» ?tab=people', () => {
    expect(access.moduleKey).toBe('members');
    expect(
      cardOf(access, {
        kind: 'access.members_without_role',
        moduleKey: 'members',
        tone: 'neutral',
        params: { count: '3', names: 'Марина Котова, Вера Котельникова, Тимур Ахмедов' },
      }),
    ).toEqual({
      icon: 'person_off',
      tag: { key: 'queue.chips.access' },
      title: { key: 'queue.noRole', args: { n: 3 } },
      text: {
        key: 'queue.noRoleText',
        args: { names: 'Марина Котова, Вера Котельникова, Тимур Ахмедов' },
      },
      action: {
        label: { key: 'queue.actions.assign' },
        target: { page: 'users', search: { tab: 'people' } },
      },
    });
  });
});
