// W2.26 · Личные виды «Данных» (эталон dtViews :4202 — личный вид в памяти страницы; Q-W2.51-7: в браузере
// участника, контракта нет): ключ — организация и участник, тот же набор и имя — замена, сбой хранилища — без видов.
import { describe, expect, it } from 'vitest';

import { loadViews, saveView, viewsKey } from './views.ts';

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const KEY = viewsKey('t-alta', 'm-1');

describe('личные виды', () => {
  it('ключ — организация и участник', () => {
    expect(KEY).toBe('ortus:data-views:t-alta:m-1');
    expect(viewsKey('t-alta', 'm-2')).not.toBe(KEY);
  });

  it('сохранение и чтение; повтор имени заменяет вид', () => {
    const s = memory();
    expect(loadViews(s, KEY)).toEqual([]);
    saveView(s, KEY, { name: 'Поездки: «211»', set: 'fleet.trips', q: '211' });
    const list = saveView(s, KEY, { name: 'Автомобили: «газ»', set: 'fleet.vehicles', q: 'газ' });
    expect(list).toHaveLength(2);
    const again = saveView(s, KEY, { name: 'Поездки: «211»', set: 'fleet.trips', q: '211' });
    expect(again.map((v) => v.name)).toEqual(['Автомобили: «газ»', 'Поездки: «211»']);
    expect(loadViews(s, KEY)).toEqual(again);
  });

  it('без хранилища, с исключением или испорченным значением — пусто, сохранение не падает', () => {
    expect(loadViews(null, KEY)).toEqual([]);
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadViews(broken, KEY)).toEqual([]);
    expect(saveView(broken, KEY, { name: 'x', set: 'fleet.trips', q: 'x' })).toEqual([
      { name: 'x', set: 'fleet.trips', q: 'x' },
    ]);
    const s = memory();
    s.data.set(KEY, '{не json');
    expect(loadViews(s, KEY)).toEqual([]);
    s.data.set(KEY, JSON.stringify([{ name: 1 }, { name: 'ok', set: 'fleet.trips', q: 'a' }]));
    expect(loadViews(s, KEY)).toEqual([{ name: 'ok', set: 'fleet.trips', q: 'a' }]);
  });
});
