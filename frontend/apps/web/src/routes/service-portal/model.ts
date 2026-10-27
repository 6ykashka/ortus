// W7.33 · Модель портала клиента (`public-service-page`, `public-service-request`): группы типов обращений,
// шкала оценки, лента статусов, оценка визита как обращение, проверка формы, «Мои обращения» в браузере клиента,
// причины отказа. Без React и сети. Время и даты — по Москве (D-14, как домен «Обращений»).
import { type components, ProblemError } from '@ortus/api-client';

import { P } from './texts.ts';

type S = components['schemas'];
type PType = S['PublicServiceType'];
type PMessage = S['PublicServiceMessage'];

export type GroupKey = 'rate' | 'wrong' | 'other';

export interface TypeItem {
  id: string;
  name: string;
  kind: PType['kind'];
  icon: string;
}

export interface TypeGroup {
  key: GroupKey;
  title: string;
  items: TypeItem[];
}

const KIND: Readonly<Record<PType['kind'], { group: GroupKey; icon: string }>> = {
  thanks: { group: 'rate', icon: 'favorite' },
  complaint: { group: 'wrong', icon: 'report' },
  claim: { group: 'wrong', icon: 'currency_ruble' },
  warranty: { group: 'wrong', icon: 'build' },
  cargo: { group: 'wrong', icon: 'local_shipping' },
  question: { group: 'other', icon: 'help' },
  idea: { group: 'other', icon: 'lightbulb' },
};

const GROUPS: readonly GroupKey[] = ['rate', 'wrong', 'other'];

/** Типы страницы направления → группы макета 1a; пустые группы не показываются. */
export function groupTypes(types: readonly PType[]): TypeGroup[] {
  return GROUPS.map((key) => ({
    key,
    title: P.page.groups[key],
    items: types
      .filter((t) => KIND[t.kind].group === key)
      .map((t) => ({ id: t.id, name: t.name, kind: t.kind, icon: KIND[t.kind].icon })),
  })).filter((g) => g.items.length > 0);
}

/** Пять значков оценки (экраны 2 и 4 макета). */
export const SCALE = [
  { score: 1, icon: 'sentiment_very_dissatisfied', label: '1 из 5' },
  { score: 2, icon: 'sentiment_dissatisfied', label: '2 из 5' },
  { score: 3, icon: 'sentiment_neutral', label: '3 из 5' },
  { score: 4, icon: 'sentiment_satisfied', label: '4 из 5' },
  { score: 5, icon: 'sentiment_very_satisfied', label: '5 из 5' },
] as const;

const msk = (iso: string, o: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', ...o }).format(new Date(iso));

/** «15:12» по Москве. */
export const hhmm = (iso: string): string =>
  msk(iso, { hour: '2-digit', minute: '2-digit', hour12: false });

/** «13 октября» по Москве. */
export const longDay = (iso: string): string => msk(iso, { day: 'numeric', month: 'long' });

export interface Step {
  key: 'got' | 'answered' | 'resolved';
  label: string;
  at: string | null;
  done: boolean;
  current: boolean;
}

/** Лента «Получили · Ответили · Решено»: время — первого сообщения клиента и первого ответа команды. */
export function stepsOf(
  status: S['PublicServiceRequest']['status'],
  messages: readonly PMessage[],
): Step[] {
  const first = messages.find((m) => m.fromClient) ?? messages[0];
  const reply = messages.find((m) => !m.fromClient);
  const resolved = status === 'resolved' || status === 'closed';
  const done = [true, Boolean(reply) || resolved || status === 'wait', resolved];
  const last = done.lastIndexOf(true);
  const at = [first ? hhmm(first.at) : null, reply ? hhmm(reply.at) : null, null];
  const keys = ['got', 'answered', 'resolved'] as const;
  return keys.map((key, i) => ({
    key,
    label: P.req.steps[key],
    at: done[i] ? (at[i] ?? null) : null,
    done: Boolean(done[i]),
    current: i === last,
  }));
}

export const VISIT_REASONS = [
  'Опоздание начала',
  'Температура в кабинете',
  'Чистота',
  'Мастер',
  'Запись',
  'Цена',
] as const;

export interface VisitInput {
  score: number;
  reasons: readonly string[];
  comment: string;
  contact: boolean;
}

const sentence = (s: string): string => {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
};

/**
 * Оценка визита → обращение (Q-W7.33-1): у контракта нет отдельной операции, оценка уходит как
 * `submitPublicServiceRequest` с токеном работы. 4–5 — «Спасибо», 1–3 — «Жалоба».
 */
export function visitSubmission(v: VisitInput): { kind: 'thanks' | 'complaint'; text: string } {
  const low = v.score <= 3;
  const parts = [`Оценка визита: ${v.score} из 5.`];
  if (low && v.reasons.length) parts.push(`Что пошло не так: ${v.reasons.join(', ')}.`);
  if (v.comment.trim()) parts.push(sentence(v.comment));
  if (low && v.contact) parts.push(`${P.visit.contact}.`);
  return { kind: low ? 'complaint' : 'thanks', text: parts.join(' ') };
}

export interface SubmitCheck {
  text: string;
  consent: boolean;
  phone: string;
  needPhone: boolean;
}

export type SubmitErrors = Partial<Record<'text' | 'consent' | 'phone', string>>;

const digits = (s: string): number => s.replace(/\D/g, '').length;

/** Проверка формы до отправки (сообщения — эталон прототипа и сценарный сервер). */
export function validateSubmit(c: SubmitCheck): SubmitErrors {
  const e: SubmitErrors = {};
  if (!c.text.trim()) e.text = P.form.text;
  if (!c.consent) e.consent = 'Нужно согласие на обработку персональных данных';
  if ((c.needPhone || c.phone.trim()) && digits(c.phone) < 10)
    e.phone = 'Телефон — не меньше 10 цифр';
  return e;
}

export interface Mine {
  key: string;
  title: string;
  token: string;
}

const MINE_LIMIT = 20;
const mineKey = (slug: string): string => `ox-sp-mine:${slug}`;

const isMine = (x: unknown): x is Mine =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as Mine).key === 'string' &&
  typeof (x as Mine).title === 'string' &&
  typeof (x as Mine).token === 'string';

/** Обращения этого браузера на странице направления; хранилище может не работать — тогда пусто. */
export function readMine(slug: string, store: Storage = localStorage): Mine[] {
  try {
    const raw = store.getItem(mineKey(slug));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter(isMine) : [];
  } catch {
    return [];
  }
}

/** Новое обращение — наверх; повтор токена переносится наверх, не дублируется. */
export function addMine(slug: string, m: Mine, store: Storage = localStorage): void {
  try {
    const rest = readMine(slug, store).filter((x) => x.token !== m.token);
    store.setItem(mineKey(slug), JSON.stringify([m, ...rest].slice(0, MINE_LIMIT)));
  } catch {
    /* хранилище закрыто (приватное окно): «Мои обращения» просто не запоминаются */
  }
}

export type Refusal = 'notFound' | 'expired' | 'rateLimited' | 'offline';

/** Ошибка загрузки → состояние страницы; `null` — общая ошибка с повтором. */
export function refusalOf(e: unknown): Refusal | null {
  if (e instanceof TypeError) return 'offline';
  if (!(e instanceof ProblemError)) return null;
  if (e.status === 404) return 'notFound';
  if (e.status === 410 || e.code === 'public_token_expired') return 'expired';
  if (e.status === 429) return 'rateLimited';
  return null;
}
