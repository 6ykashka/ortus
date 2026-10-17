// W2.21 · Модель «Очереди блокирующих дефектов» (S2-17, no-reference B-6 №7; 14-stage2-dor.md §4): разбиение на
// «На проверке» и «Решённые», порядок, строки карточки, чип решения. Карточка дефекта эталона — «Приёмка смен» (:3346).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { defectRow, partition } from './model.ts';

type S = components['schemas'];

const defect = (o: Partial<S['InspectionDefect']> = {}): S['InspectionDefect'] => ({
  id: 'd1',
  vehicleId: 'v1',
  inspectionId: 'i1',
  tripId: 't1',
  zone: 'Стёкла',
  description: 'Скол',
  severity: 'blocking',
  state: 'in_review',
  reportedAt: '2026-10-01T05:47:00Z',
  reportedByMemberId: 'm-vasiliev',
  tripNumber: 'Р-208',
  vehicleDisplayName: 'ГАЗель Next',
  registrationNumber: 'А 412 МР 77',
  driverDisplayName: 'Илья Васильев',
  revision: 1,
  ...o,
});

describe('очередь дефектов', () => {
  it('на проверке — блокирующие in_review, старые первыми; решённые — свежие первыми', () => {
    const list = [
      defect({ id: 'a', reportedAt: '2026-10-01T07:00:00Z' }),
      defect({ id: 'b', reportedAt: '2026-10-01T05:00:00Z' }),
      defect({ id: 'c', severity: 'minor', state: 'open' }),
      defect({
        id: 'd',
        state: 'resolved',
        decision: 'allow_departure',
        decidedAt: '2026-10-01T06:00:00Z',
      }),
      defect({
        id: 'e',
        state: 'confirmed_out_of_service',
        decision: 'confirm_out_of_service',
        decidedAt: '2026-10-01T08:00:00Z',
      }),
    ];
    const p = partition(list);
    expect(p.review.map((d) => d.id)).toEqual(['b', 'a']);
    expect(p.decided.map((d) => d.id)).toEqual(['e', 'd']);
  });

  it('строка карточки: заголовок, рейс, машина, водитель, время по Москве', () => {
    expect(defectRow(defect())).toEqual({
      id: 'd1',
      title: 'Стёкла: Скол',
      trip: 'Рейс Р-208 · Илья Васильев',
      vehicle: 'ГАЗель Next · А 412 МР 77',
      reported: 'Отмечен при осмотре перед выездом 01.10.2026 в 08:47',
      decision: null,
    });
  });

  it('решение: чип и комментарий; «разрешить выезд» и «подтвердить неисправность»', () => {
    expect(
      defectRow(
        defect({
          state: 'resolved',
          decision: 'allow_departure',
          decisionComment: 'Скол вне зоны обзора',
          decidedAt: '2026-10-01T06:05:00Z',
        }),
      ).decision,
    ).toEqual({
      chip: { label: 'Выезд разрешён', tone: 'ok', icon: 'check_circle' },
      at: 'Решение 01.10.2026 в 09:05',
      comment: 'Скол вне зоны обзора',
    });
    expect(
      defectRow(
        defect({
          state: 'confirmed_out_of_service',
          decision: 'confirm_out_of_service',
          decidedAt: '2026-10-01T06:05:00Z',
        }),
      ).decision,
    ).toEqual({
      chip: { label: 'Неисправность подтверждена', tone: 'danger', icon: 'block' },
      at: 'Решение 01.10.2026 в 09:05',
      comment: null,
    });
  });

  it('без рейса и водителя — только машина', () => {
    const d = defect();
    delete d.tripNumber;
    delete d.driverDisplayName;
    expect(defectRow(d).trip).toBe('');
  });
});
