// W2.25 · Источник «Требует решения» модуля «Логистика» (homeVM :4053–4058; 05 §5.5 строки 1–3): блокирующий
// дефект на проверке → «Решить», сданная смена → «Проверить» (оба — «Приёмка смен» ?trip=, ADR-0001), рейс без
// водителя → «Найти в пуле» / «Открыть пул» при запросе в пул. Права и область проверяет сервер (W2.09, MSW W2.00).
import { hhmm } from '../time.ts';
import type { DecisionItemLike, HomeMsg, HomeSource, HomeTarget } from '../types.ts';

const p = (item: DecisionItemLike, name: string): string => item.params[name] ?? '';

const review = (item: DecisionItemLike): HomeTarget => ({
  page: 'review',
  search: { trip: item.object?.entityId ?? '' },
});

export const source: HomeSource = {
  id: 'fleet',
  moduleKey: 'fleet',
  stage: 2,
  kinds: {
    'fleet.blocking_defect': (item) => ({
      icon: 'report',
      tag: { key: 'queue.chips.blocksDeparture' },
      title: { key: 'queue.criticalDefect', args: { trip: p(item, 'tripNumber') } },
      text: {
        key: 'queue.defectText',
        args: {
          zone: p(item, 'zone'),
          description: p(item, 'description'),
          driver: p(item, 'driverName'),
        },
      },
      action: { label: { key: 'queue.actions.resolve' }, target: review(item) },
    }),
    'fleet.trip_review': (item) => ({
      icon: 'fact_check',
      tag: { key: 'queue.chips.review' },
      title: { key: 'queue.shiftWaits', args: { trip: p(item, 'tripNumber') } },
      text: { key: 'queue.shiftWaitsText', args: { driver: p(item, 'driverName') } },
      action: { label: { key: 'queue.actions.check' }, target: review(item) },
    }),
    'fleet.trip_without_driver': (item, ctx) => {
      const pooled = p(item, 'poolRequest') === 'pending';
      const starts = Date.parse(p(item, 'startsAt'));
      const time = Number.isNaN(starts) ? '' : hhmm(new Date(starts), ctx.timeZone);
      const tag: HomeMsg = pooled
        ? { key: 'queue.chips.otherFirm' }
        : { key: 'queue.chips.today', args: { time } };
      const text: HomeMsg = pooled
        ? { key: 'queue.poolRequested', args: { firm: p(item, 'poolHome') } }
        : {
            key: 'queue.tripNoDriverText',
            args: { title: p(item, 'title'), cargo: p(item, 'cargo') },
          };
      return {
        icon: 'person_search',
        tag,
        title: { key: 'queue.tripNoDriver', args: { trip: p(item, 'tripNumber') } },
        text,
        action: {
          label: { key: pooled ? 'queue.actions.openPool' : 'queue.actions.findInPool' },
          target: { page: 'pool' },
        },
      };
    },
  },
};
