// W2.25 · Очередь «Требует решения» (homeVM :4051–4095, :4131; 05 §5.5; 01-shell.md §23): общий VM реестра
// источников. Карточку вида собирает провайдер модуля (`sources/<m>.ts`); VM только сортирует по тону
// (стабильно: внутри тона — порядок сервера, т. е. порядок регистрации источников) и обрезает до 8. Новый источник
// VM не правит. Вид без провайдера — источник будущего этапа (allowlist out-of-stage): не показывается и не
// считается в «Требует решения: N».
import { HOME_SOURCES } from './sources.gen.ts';
import type {
  CardOf,
  DecisionQueueLike,
  HomeCard,
  HomeQueue,
  HomeSource,
  HomeSourceContext,
  HomeTone,
} from './types.ts';

/** Показывается карточек (homeVM :4131). */
export const QUEUE_LIMIT = 8;

const ORDER: Readonly<Record<HomeTone, number>> = { danger: 0, warn: 1, info: 2, neutral: 3 };

function byKind(sources: readonly HomeSource[]): ReadonlyMap<string, CardOf> {
  return new Map(sources.flatMap((s) => Object.entries(s.kinds)));
}

export function homeQueue(
  q: DecisionQueueLike,
  sources: readonly HomeSource[] = HOME_SOURCES,
  ctx: HomeSourceContext,
): HomeQueue {
  const builders = byKind(sources);
  const known: HomeCard[] = [];
  let unknown = 0;
  for (const item of q.items) {
    const build = builders.get(item.kind);
    if (!build) {
      unknown += 1;
      continue;
    }
    known.push({ key: item.key, tone: item.tone, ...build(item, ctx) });
  }
  const sorted = known
    .map((card, i) => ({ card, i }))
    .sort((a, b) => ORDER[a.card.tone] - ORDER[b.card.tone] || a.i - b.i)
    .map((x) => x.card);
  const cards = sorted.slice(0, QUEUE_LIMIT);
  const total = Math.max(q.total - unknown, known.length);
  let count: HomeQueue['count'] = '';
  if (total > cards.length) count = { key: 'queue.shown', args: { shown: cards.length, total } };
  else if (total > 0) count = String(total);
  return { cards, total, count };
}
