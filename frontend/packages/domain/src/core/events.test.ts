import { describe, expect, it } from 'vitest';
import { DEMO, fixedClock, manualClock } from './clock.ts';
import { createEmitter } from './events.ts';
import { createIdGen } from './ids.ts';
import { altaFixture } from './testing/fixture.ts';
import type { CoreDb } from './types/index.ts';

describe('createEmitter: события участникам (event() эталона)', () => {
  it('кладёт событие в начало db.events с id e<seq> и временем по Москве', () => {
    const db = altaFixture();
    const emit = createEmitter(() => db, fixedClock(DEMO.now));
    const first = emit('Создан проект «Склад» (СКЛ)', ['m-owner']);
    const second = emit('Начисление за рейс', ['m-owner'], {
      sensitive: 'earnings',
      unit: 'f-msk-sever',
    });
    expect(first).toEqual({
      id: 'e100',
      at: '10:30',
      text: 'Создан проект «Склад» (СКЛ)',
      to: ['m-owner'],
      sensitive: null,
    });
    expect(second).toEqual({
      id: 'e101',
      at: '10:30',
      text: 'Начисление за рейс',
      to: ['m-owner'],
      sensitive: 'earnings',
      unit: 'f-msk-sever',
    });
    expect(db.events?.map((e) => e.id)).toEqual(['e101', 'e100']);
    expect(db.seq).toBe(102);
  });

  it('создаёт db.events, если его нет; получатели копируются', () => {
    const db: CoreDb = { ...altaFixture(), events: undefined };
    const to = ['m-kotova'];
    const clock = manualClock('2026-10-01T09:05:00+03:00');
    const emit = createEmitter(() => db, clock, createIdGen(db));
    emit('Текст', to);
    to.push('m-owner');
    clock.advance(60_000);
    emit('Ещё', []);
    expect(db.events?.[1]).toMatchObject({ at: '09:05', to: ['m-kotova'] });
    expect(db.events?.[0]?.at).toBe('09:06');
  });
});
