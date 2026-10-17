// W2.25 · Очередь «Требует решения» (homeVM :4051–4095, :4131; 05 §5.5): карточки сервера → карточки страницы
// через реестр источников, сортировка по тону, не больше 8, подпись «показано 8 из N».
import { describe, expect, it } from 'vitest';

import { homeQueue } from './queue.ts';
import type { DecisionItemLike, HomeSource } from './types.ts';

const CTX = { timeZone: 'Europe/Moscow' };

const item = (kind: string, tone: DecisionItemLike['tone'], id: string): DecisionItemLike => ({
  key: `${kind}:${id}`,
  kind,
  moduleKey: kind.split('.')[0] ?? '',
  tone,
  params: { id },
});

const probe: HomeSource = {
  id: 'probe',
  moduleKey: 'probe',
  stage: 2,
  kinds: {
    'probe.card': (i) => ({
      icon: 'report',
      tag: { key: 'queue.chips.access' },
      title: { key: 'queue.tripNoDriver', args: { trip: i.params.id ?? '' } },
      text: { key: 'queue.noRoleText', args: { names: i.params.id ?? '' } },
    }),
  },
};

const ids = (q: ReturnType<typeof homeQueue>) => q.cards.map((c) => c.title.args?.trip);

describe('очередь «Требует решения»', () => {
  it('карточка — из провайдера вида; ключ и тон — из ответа сервера', () => {
    const q = homeQueue({ items: [item('probe.card', 'warn', 'a')], total: 1 }, [probe], CTX);
    expect(q.cards).toEqual([
      {
        key: 'probe.card:a',
        tone: 'warn',
        icon: 'report',
        tag: { key: 'queue.chips.access' },
        title: { key: 'queue.tripNoDriver', args: { trip: 'a' } },
        text: { key: 'queue.noRoleText', args: { names: 'a' } },
      },
    ]);
    expect(q.total).toBe(1);
    expect(q.count).toBe('1');
  });

  it('сортировка по тону danger → warn → info → neutral, внутри тона — порядок сервера', () => {
    const items = [
      item('probe.card', 'neutral', 'n1'),
      item('probe.card', 'info', 'i1'),
      item('probe.card', 'danger', 'd1'),
      item('probe.card', 'neutral', 'n2'),
      item('probe.card', 'warn', 'w1'),
      item('probe.card', 'danger', 'd2'),
    ];
    const q = homeQueue({ items, total: 6 }, [probe], CTX);
    expect(ids(q)).toEqual(['d1', 'd2', 'w1', 'i1', 'n1', 'n2']);
  });

  it('не больше 8 карточек; подпись «показано 8 из N», сводка — все N', () => {
    const items = Array.from({ length: 10 }, (_, i) => item('probe.card', 'info', `t${i}`));
    const q = homeQueue({ items, total: 12 }, [probe], CTX);
    expect(q.cards).toHaveLength(8);
    expect(q.total).toBe(12);
    expect(q.count).toEqual({ key: 'queue.shown', args: { shown: 8, total: 12 } });
  });

  it('сервер отдал 8 из N: подпись «показано 8 из N»', () => {
    const items = Array.from({ length: 8 }, (_, i) => item('probe.card', 'info', `t${i}`));
    expect(homeQueue({ items, total: 10 }, [probe], CTX).count).toEqual({
      key: 'queue.shown',
      args: { shown: 8, total: 10 },
    });
  });

  it('пусто: нет карточек, подпись пустая', () => {
    const q = homeQueue({ items: [], total: 0 }, [probe], CTX);
    expect(q).toEqual({ cards: [], total: 0, count: '' });
  });

  it('вид без провайдера (источник будущего этапа) не показывается и не считается', () => {
    const items = [
      item('tasks.task_new', 'danger', 'x'),
      item('probe.card', 'info', 'a'),
      item('cash.todo', 'warn', 'y'),
    ];
    const q = homeQueue({ items, total: 3 }, [probe], CTX);
    expect(ids(q)).toEqual(['a']);
    expect(q.total).toBe(1);
    expect(q.count).toBe('1');
  });

  it('по умолчанию — реестр источников этапа 2', () => {
    const q = homeQueue(
      {
        items: [
          {
            key: 'access.members_without_role:t',
            kind: 'access.members_without_role',
            moduleKey: 'members',
            tone: 'neutral',
            params: { count: '3', names: 'Марина Котова' },
          },
        ],
        total: 1,
      },
      undefined,
      CTX,
    );
    expect(q.cards[0]?.title).toEqual({ key: 'queue.noRole', args: { n: 3 } });
  });
});
