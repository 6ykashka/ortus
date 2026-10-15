// Справочники логистики 14.10 (models.js:125–163) — дословно.
import { describe, expect, it } from 'vitest';
import {
  DEFECT_ZONES,
  DEP_CHECKS,
  EXPENSE_CAT,
  FUEL,
  PHOTO_SIDES,
  RET_CHECKS,
  TRIP_STATE,
  VEHICLE_STATE,
} from './dictionaries.ts';

describe('справочники логистики', () => {
  it('состояния рейса — девять, в порядке жизненного цикла', () => {
    expect(Object.keys(TRIP_STATE)).toEqual([
      'planned',
      'assigned',
      'inspection',
      'defect_review',
      'on_route',
      'returning',
      'submitted',
      'rework',
      'accepted',
    ]);
    expect(TRIP_STATE.defect_review).toEqual({
      label: 'Дефект на проверке',
      tone: 'danger',
      icon: 'report',
    });
    expect(TRIP_STATE.submitted.label).toBe('Ожидает приёмки');
  });

  it('состояния машины — пять', () => {
    expect(Object.keys(VEHICLE_STATE)).toEqual([
      'free',
      'reserved',
      'on_route',
      'review',
      'unavailable',
    ]);
    expect(VEHICLE_STATE.unavailable).toEqual({
      label: 'Недоступна',
      tone: 'danger',
      icon: 'block',
    });
  });

  it('осмотр: пять ракурсов, чек-листы выезда и сдачи по три пункта', () => {
    expect(PHOTO_SIDES.map(([k]) => k)).toEqual(['front', 'back', 'left', 'right', 'odo']);
    expect(PHOTO_SIDES[4]).toEqual(['odo', 'Одометр']);
    expect(DEP_CHECKS.map(([k]) => k)).toEqual(['body', 'tires', 'docs']);
    expect(RET_CHECKS.map(([k]) => k)).toEqual(['cargo', 'personal', 'keys']);
    expect(DEP_CHECKS[0]?.[1]).toBe('Кузов и стёкла осмотрены');
  });

  it('зоны дефектов, топливо, категории расходов', () => {
    expect(DEFECT_ZONES).toHaveLength(7);
    expect(DEFECT_ZONES[0]).toBe('Кузов');
    expect(FUEL).toEqual([
      ['q', '¼'],
      ['h', '½'],
      ['tq', '¾'],
      ['f', 'Полный'],
    ]);
    expect(EXPENSE_CAT).toEqual({
      fuel: { label: 'Топливо', icon: 'local_gas_station' },
      wash: { label: 'Мойка', icon: 'local_car_wash' },
    });
  });
});
