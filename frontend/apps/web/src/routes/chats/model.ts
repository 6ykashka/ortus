// W7.13 · Чистая модель страницы «Чаты»: подписи списка и ленты, отметки прочтения, итоги опроса и «важного», доступные
// действия сообщения, подсказка поля ввода, раскладка по ширине контейнера (эталон `Чаты.dc.html` msgVM, composerVM, rows).
// Права и итоги считает сервер (`my.can`, `reads`, `poll`, `important`) — здесь только подпись и выбор состояния.
import type { components } from '@ortus/api-client';

import { CHAT_TEXT as T } from './texts.ts';

type S = components['schemas'];
export type ChatSummary = S['ChatSummary'];
export type ChatFull = S['Chat'];
export type ChatMessage = S['ChatMessage'];
export type ChatCan = S['ChatCan'];
export type ChatPolicy = S['ChatPolicy'];
export type ChatKind = ChatSummary['kind'];
export type Folder = keyof typeof T.folders;

export const FOLDERS: readonly Folder[] = ['all', 'direct', 'work', 'record', 'announce'];
export const MSK = 'Europe/Moscow';

/** Раскладка по ширине контейнера (Ч:513, 538): узкая < 760, три колонки ≥ 1100. */
export type Layout = 'narrow' | 'wide' | 'three';
export const layoutOf = (width: number): Layout =>
  width < 760 ? 'narrow' : width >= 1100 ? 'three' : 'wide';

export const plural = (n: number, a: string, b: string, c: string): string => {
  const m = n % 10;
  const h = n % 100;
  const form = m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c;
  return `${n} ${form}`;
};

/** Размер в МБ/ГБ (эталон `gb`): от 1000 МБ — гигабайты с десятой долей. */
export const sizeLabel = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  return mb >= 1000
    ? `${String(Math.round(mb / 100) / 10).replace('.', ',')} ГБ`
    : `${String(Math.round(mb * 10) / 10).replace('.', ',')} МБ`;
};

const part = (iso: string, tz: string, o: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: tz, ...o }).format(new Date(iso));

export const timeOf = (iso: string, tz = MSK): string =>
  part(iso, tz, { hour: '2-digit', minute: '2-digit', hour12: false });
export const dayOf = (iso: string, tz = MSK): string =>
  part(iso, tz, { day: '2-digit', month: '2-digit' });
const dayKey = (iso: string, tz: string): string =>
  part(iso, tz, { year: 'numeric', month: '2-digit', day: '2-digit' });

/** Разделитель дня ленты: «Сегодня · 01.10» либо «01.10». */
export const dayLabel = (iso: string, now: number, tz = MSK): string =>
  dayKey(iso, tz) === dayKey(new Date(now).toISOString(), tz)
    ? `${T.chat.today}${dayOf(iso, tz)}`
    : dayOf(iso, tz);

/** Время в списке: сегодня — «09:12», вчера — «Вчера», раньше — «01.10». */
export function listTime(iso: string, now: number, tz = MSK): string {
  if (dayKey(iso, tz) === dayKey(new Date(now).toISOString(), tz)) return timeOf(iso, tz);
  const y = new Date(now - 24 * 3600_000).toISOString();
  return dayKey(iso, tz) === dayKey(y, tz) ? T.list.yesterday : dayOf(iso, tz);
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase();

const AVATAR = ['#1F6B52', '#2B5479', '#7A5214', '#6B4A7A', '#3A4844', '#A13A33', '#5C6964'];
/** Цвет аватара по id (эталон `colOf`). */
export function avatarColor(id: string): string {
  let a = 7;
  for (const ch of String(id || 'x')) a = (a * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR[Math.abs(a) % AVATAR.length] ?? '#1F6B52';
}

export const KIND_TONE: Readonly<Record<ChatKind, 'neutral' | 'info' | 'ok' | 'warn' | 'purple'>> =
  {
    direct: 'neutral',
    group: 'info',
    area: 'ok',
    record: 'warn',
    announce: 'purple',
  };

/** Значок вида; чат записи — по сущности записи (рейс/объект). */
export function chatIcon(c: Pick<ChatSummary, 'kind' | 'record'>): string {
  if (c.kind === 'record') {
    return c.record?.object.entityType === 'trip' ? 'local_shipping' : 'home_work';
  }
  return T.kind[c.kind].icon;
}

/** Последняя строка списка (Ч:503–508): «Вы: …», «Имя: …», «Опрос · …», «Файл · …», «Документ · …». */
export function lastLine(c: ChatSummary, meName: string): string {
  const m = c.lastMessage;
  if (!m) return T.list.noMessages;
  if (m.kind === 'system') return m.text || T.list.system;
  const who =
    m.authorDisplayName === meName
      ? T.list.you
      : c.kind === 'direct'
        ? ''
        : `${m.authorDisplayName.split(' ')[0]}: `;
  const body =
    m.kind === 'poll'
      ? `${T.list.poll}${m.text}`
      : m.kind === 'file'
        ? `${T.list.file}${m.text}`
        : m.kind === 'document'
          ? `${T.list.doc}${m.text}`
          : m.text || T.list.message;
  return who + body;
}

/** Подзаголовок страницы: «N непрочитанных · N ждут подтверждения · состав и права — из «Пользователей и ролей»». */
export function pageSub(items: readonly ChatSummary[]): string {
  const unread = items.reduce((a, c) => a + c.my.unread, 0);
  const ack = items.reduce((a, c) => a + c.my.ackWaitCount, 0);
  return [
    unread ? plural(unread, 'непрочитанное', 'непрочитанных', 'непрочитанных') : '',
    ack ? `${plural(ack, 'ждёт', 'ждут', 'ждут')} подтверждения` : '',
    T.subTail,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Подзаголовок чата: «Чат записи · N участников · Север Логистик · Финансы» (Ч:551). */
export function chatSub(c: ChatFull, unitName: string | null): string {
  return [
    T.kind[c.kind].one,
    plural(c.memberCount, 'участник', 'участника', 'участников'),
    unitName ?? (c.kind === 'announce' ? T.wholeOrg : ''),
    c.sensitivity === 'finance' ? T.finance : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Тема сообщения в ленте: сообщения без темы относятся к первой теме чата (Ч:562). */
export const topicOf = (m: ChatMessage, topics: readonly string[]): string | null =>
  m.topic ?? topics[0] ?? null;

/** Окно правки: 15 минут / 48 часов / без срока; после окна — только модератор (Q-W4.00-chats-22). */
export function inEditWindow(createdAt: string, edit: ChatPolicy['edit'], now: number): boolean {
  if (edit === 'none') return true;
  const limit = edit === '15m' ? 15 * 60_000 : 48 * 3600_000;
  return now - Date.parse(createdAt) <= limit;
}

export type MenuAction =
  'info' | 'edit' | 'delete' | 'deleteMod' | 'pin' | 'unpin' | 'save' | 'task';

export interface MenuItem {
  action: MenuAction;
  label: string;
  icon: string;
}

/** Действия меню «⋯» сообщения (Ч:581–588). Права — серверные `can`, окно правки — политика чата. */
export function menuOf(o: {
  m: ChatMessage;
  mine: boolean;
  can: ChatCan;
  policy: ChatPolicy;
  now: number;
  pinnedId: string | null;
  recordKind: string | null;
}): MenuItem[] {
  const { m, mine, can, policy, now } = o;
  const win = inEditWindow(m.createdAt, policy.edit, now);
  const out: MenuItem[] = [{ action: 'info', label: T.msg.menu.info, icon: 'info' }];
  if (m.deleted) return out;
  if (mine && win && m.text && !m.poll)
    out.push({ action: 'edit', label: T.msg.menu.edit, icon: 'edit' });
  if ((mine && win) || can.moderate) {
    out.push({
      action: mine ? 'delete' : 'deleteMod',
      label: T.msg.menu.del,
      icon: 'delete',
    });
  }
  if (can.pin) {
    const pinned = o.pinnedId === m.id;
    out.push({
      action: pinned ? 'unpin' : 'pin',
      label: pinned ? T.msg.menu.unpin : T.msg.menu.pin,
      icon: 'push_pin',
    });
  }
  if (can.saveToRecord && m.attachments.some((f) => !f.savedTo && !f.viewOnce)) {
    out.push({
      action: 'save',
      label: o.recordKind === 'trip' ? T.msg.menu.saveTrip : T.msg.menu.saveObj,
      icon: 'inventory_2',
    });
  }
  if (can.task) out.push({ action: 'task', label: T.msg.menu.task, icon: 'add_task' });
  return out;
}

/** Нижняя отметка своего сообщения (Ч:589): off — «Доставлено», who — «Прочитали N из M», ticks — «N из M». */
export function tickOf(
  m: ChatMessage,
  mode: ChatPolicy['receipts'],
): { icon: 'check' | 'done_all'; text: string } | null {
  if (m.deleted || m.kind === 'system') return null;
  if (mode === 'off') return { icon: 'check', text: T.msg.sentOnly };
  const r = m.reads;
  if (!r) return null;
  const frac = `${r.readCount}${T.msg.of}${r.totalCount}`;
  return {
    icon: r.readCount > 0 ? 'done_all' : 'check',
    text: mode === 'who' ? `${T.msg.tickRead}${frac}` : frac,
  };
}

/** «Важное»: текст плашки для автора, получателя и модератора (Ч:608). */
export function importantNote(
  m: ChatMessage,
  mine: boolean,
  moderator: boolean,
): { text: string; canAck: boolean } | null {
  const i = m.important;
  if (!i) return null;
  if (mine) return { text: `${T.msg.acked}${i.ackCount}${T.msg.of}${i.totalCount}`, canAck: false };
  const done = i.mine?.done ?? false;
  if (done) return { text: T.msg.confirmed, canAck: false };
  return {
    text:
      T.msg.confirmPrompt +
      (moderator ? `${T.msg.ackedHint}${i.ackCount}${T.msg.of}${i.totalCount}` : ''),
    canAck: i.mine?.required ?? true,
  };
}

export interface PollOptionView {
  id: string;
  text: string;
  mine: boolean;
  pct: number;
  value: string;
  voters: string;
}

/** Опрос (Ч:597–606): результаты — после своего голоса, автору, модератору и после закрытия. */
export function pollView(
  m: ChatMessage,
  mine: boolean,
  moderator: boolean,
  members: number,
): {
  options: PollOptionView[];
  meta: string;
  canClose: boolean;
  showResults: boolean;
} | null {
  const p = m.poll;
  if (!p || m.deleted) return null;
  const voted = p.myVotes.length > 0;
  const show = p.closed || voted || mine || moderator;
  const options = p.options.map((o) => {
    const votes = o.votes ?? 0;
    const pct = p.totalVoters ? Math.round((votes / p.totalVoters) * 100) : 0;
    return {
      id: o.id,
      text: o.text,
      mine: o.mine ?? false,
      pct: show ? pct : 0,
      value: show ? `${votes} · ${pct} %` : '',
      voters: !p.anonymous && show ? (o.voters ?? []).map((v) => v.split(' ')[0]).join(', ') : '',
    };
  });
  const meta = [
    p.anonymous ? T.msg.anon : T.msg.open_,
    p.multiple ? T.msg.many : T.msg.one,
    p.closed ? T.msg.closed : `${T.msg.closes}${dayOf(p.closesAt)} в ${timeOf(p.closesAt)}`,
    `${T.msg.voted}${p.totalVoters}${T.msg.of}${members}`,
  ].join(' · ');
  return { options, meta, canClose: !p.closed && (mine || moderator), showResults: show };
}

/** Подсказка над полем ввода (Ч:642). */
export function composerHint(o: {
  important: boolean;
  ttlHours: number;
  viewOnce: boolean;
  docTitle: string | null;
  maxFileMb: number;
}): string {
  return [
    o.important ? T.composer.hintImportant : '',
    o.ttlHours
      ? `${T.composer.hintExpire}${o.ttlHours >= 24 ? `${o.ttlHours / 24} дн` : `${o.ttlHours} ч`}`
      : '',
    o.viewOnce ? T.composer.hintOnce : '',
    o.docTitle ? `${T.composer.hintDoc}${o.docTitle}` : '',
    `${T.composer.hintTo}${sizeLabel(o.maxFileMb * 1024 * 1024)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Цикл срока временного сообщения (Ч:635): выкл → 1 ч → сутки → 7 дней → выкл. */
export const nextTtl = (h: number): number => (h === 0 ? 1 : h === 1 ? 24 : h === 24 ? 168 : 0);

/** Причина «только чтение» вместо поля ввода (Ч:628). */
export function readOnlyReason(c: ChatFull): string {
  return c.status === 'archived'
    ? T.composer.readOnly.archived
    : c.kind === 'announce'
      ? T.composer.readOnly.announce
      : T.composer.readOnly.reader;
}

/** Срок подтверждения «важного»: сейчас + 3 календарных дня (Q-W4.00-chats-11). */
export function importantDue(now: number, tz = MSK): string {
  const d = new Date(now + 3 * 24 * 3600_000);
  const p = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...o }).format(d);
  return p({ year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** Занятое место чата: процент от лимита, тон полосы по порогам 75 / 90 / 100 % (Ч:696–697). */
export function quotaState(
  used: number,
  quota: number | null,
): { pct: number | null; tone: 'ok' | 'warn' | 'danger' } {
  if (!quota) return { pct: null, tone: 'ok' };
  const pct = Math.round((used / quota) * 100);
  return { pct, tone: pct >= 100 ? 'danger' : pct >= 75 ? 'warn' : 'ok' };
}

/** Строка вида чата в «Политиках» (Ч:749). */
export function policyRowSummary(p: ChatPolicy): string[] {
  const x = T.pol.summary;
  return [
    `${x.text}${p.textYears}${x.years}${p.filesDays}${x.days}`,
    `${x.file}${sizeLabel(p.maxFileMb * 1024 * 1024)}${
      p.quotaMb ? ` · ${sizeLabel(p.quotaMb * 1024 * 1024)}${x.perChat}` : ''
    }`,
    `${T.rcpt[p.receipts]} · ${p.receiptsDays}${x.days}`,
    `${x.temp}${T.temp[p.temp]}`,
  ];
}

/** Строка политики в подвале «Нового чата» (эталон `Чаты.dc.html` :739, `policyNote`). */
export function policyNote(kindLabel: string, p: ChatPolicy): string {
  const mb = (v: number): string => sizeLabel(v * 1024 * 1024);
  return (
    `Политика вида «${kindLabel}»: текст ${p.textYears} г., файл до ${mb(p.maxFileMb)}` +
    `${p.quotaMb ? `, ${mb(p.quotaMb)} на чат` : ''}, прочтение — «${T.rcpt[p.receipts]}»`
  );
}

/** Что отличается от текущей политики вида (только изменённые поля уходят в PUT). */
export function policyDiff(cur: ChatPolicy, draft: Partial<ChatPolicy>): Partial<ChatPolicy> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (String((cur as unknown as Record<string, unknown>)[k]) !== String(v)) out[k] = v;
  }
  return out as Partial<ChatPolicy>;
}

export type Cell = 'y' | 'n' | 'l';
export interface MatrixRow {
  title: string;
  cells: readonly Cell[];
  limit: string;
}
export interface MatrixGroup {
  title: string;
  rows: readonly MatrixRow[];
}

/** Матрица «роль в чате × действие» вкладки «Права» (Вл · Мд · Уч · Чт; `l` — задано политикой вида; chats.js 157–181). */
export function matrixOf(P: ChatPolicy, kind: ChatKind): MatrixGroup[] {
  const ann = kind === 'announce';
  const writers: Cell[] = ann ? ['y', 'y', 'n', 'n'] : ['y', 'y', 'y', 'n'];
  const mods: Cell[] = ['y', 'y', 'n', 'n'];
  const locked: Cell[] = ['l', 'l', 'l', 'l'];
  const row = (title: string, cells: readonly Cell[], limit: string): MatrixRow => ({
    title,
    cells,
    limit,
  });
  return [
    {
      title: 'Сообщения',
      rows: [
        row('Писать сообщения', writers, ann ? 'В объявлениях пишут модераторы' : ''),
        row(
          'Файлы и медиа',
          writers,
          `До ${sizeLabel(P.maxFileMb * 1024 * 1024)} · фото сжимаются`,
        ),
        row('Создавать опросы', writers, 'Читатель голосует'),
        row('Важное с подтверждением и @все', mods, 'Нужно право «Чаты · Решать» в роли'),
        row(
          'Править свои сообщения',
          writers,
          `${T.edit[P.edit]} · история правок видна участникам`,
        ),
      ],
    },
    {
      title: 'Участники и модерация',
      rows: [
        row('Добавлять сотрудников по имени', mods, 'Только своей области'),
        row('Удалять чужие сообщения', mods, 'С причиной, её видно в чате'),
        row('Закреплять', mods, ''),
      ],
    },
    {
      title: 'Чтение и защита',
      rows: [
        row(
          'Видеть, кто и когда прочитал',
          P.receipts === 'who' ? ['y', 'y', 'y', 'n'] : locked,
          `Режим: ${T.rcpt[P.receipts]}`,
        ),
        row(
          'Видеть ПДн без маски',
          locked,
          'Только право «ПДн без маски»; функции «Водитель» — никогда',
        ),
        row('Временные сообщения', P.temp === 'allowed' ? writers : locked, T.temp[P.temp]),
        row(
          'Одноразовые файлы',
          P.temp === 'off' ? locked : mods,
          'Удаляются через 24 часа после открытия',
        ),
        row('Пересылка', P.forward === 'off' ? locked : ['y', 'y', 'y', 'y'], T.fwd[P.forward]),
      ],
    },
  ];
}

/** Строки «Политика вида» вкладки «Права» (Ч:678). */
export function policyFacts(P: ChatPolicy, kind: ChatKind): { k: string; v: string }[] {
  return [
    {
      k: 'Текст',
      v: `${P.textYears} г.${kind === 'record' ? ' после закрытия записи' : ''}`,
    },
    { k: 'Вложения', v: `${P.filesDays} дн., затем превью` },
    { k: 'Голосовые', v: `${P.voiceDays} дн., остаётся расшифровка` },
    { k: 'Прочтение', v: `${T.rcpt[P.receipts]} · ${P.receiptsDays} дн.` },
    { k: 'Правка своих', v: T.edit[P.edit] },
    { k: 'Файл до', v: sizeLabel(P.maxFileMb * 1024 * 1024) },
    { k: 'Временные', v: T.temp[P.temp] },
    { k: 'Пересылка', v: T.fwd[P.forward] },
  ];
}
