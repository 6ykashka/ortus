// W2.61 · Начатый рейс не зависит от списка машин (Q-W2.32-2): список нужен только до выезда (выбор машины, осмотр
// перед выездом — строка брони и пробег машины); подзаголовок осмотра без известной машины — без пустых «модель ·
// номер» (продолжение временного водителя после срока: `listVehicles` 403).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { inspectionSub, needsCars } from './model.ts';

type TripState = components['schemas']['TripState'];

describe('needsCars — список машин нужен экрану только до выезда', () => {
  it.each<[TripState, boolean]>([
    ['planned', true],
    ['assigned', true],
    ['inspection', true],
    ['defect_review', false],
    ['on_route', false],
    ['returning', false],
    ['rework', false],
    ['submitted', false],
    ['accepted', false],
    ['cancelled', false],
  ])('%s → %s', (state, want) => {
    expect(needsCars(state)).toBe(want);
  });
});

describe('inspectionSub — подзаголовок осмотра', () => {
  it('с машиной — как в эталоне', () => {
    expect(inspectionSub('ret', 'ГАЗель Next', 'А 412 МР 77')).toBe(
      'ГАЗель Next · А 412 МР 77 · сравнение с выездом',
    );
    expect(inspectionSub('dep', 'ГАЗель Next', 'А 412 МР 77')).toBe(
      'ГАЗель Next · А 412 МР 77 · фото, пробег, топливо, чек-лист',
    );
  });

  it('машина неизвестна — без пустых частей, с заглавной буквы', () => {
    expect(inspectionSub('ret', '', '')).toBe('Сравнение с выездом');
    expect(inspectionSub('dep', '', '')).toBe('Фото, пробег, топливо, чек-лист');
  });

  it('известна только модель — номер не оставляет пустой части', () => {
    expect(inspectionSub('ret', 'ГАЗель Next', '')).toBe('ГАЗель Next · сравнение с выездом');
  });
});
