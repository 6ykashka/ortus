// W7.32 · Чистая модель страницы «Обращения»: тона и подписи (service.js 19.10 SVC_ST/SVC_KIND/SVC_CH, «Обращения.dc.html»
// slaTone/stTone/listVM/cardVM), права кнопок по контракту, действия карточки по статусу, лента, подсказки. Без React и сети:
// таблицы Vitest в model.test.ts. Данные — схемы контракта 0.12.0-stage7 (тег Service).
import type { components } from '@ortus/api-client';
import { ALL_MODULES } from '@ortus/domain';
import {
  COMPENSATIONS,
  fillTemplate,
  OUTCOMES,
  OUTCOMES_ABOUT,
  SVC_CH,
  SVC_KIND,
  SVC_PRIO,
  SVC_ST,
  svcDur,
  svcWhen,
} from '@ortus/domain/modules';

import { COMPENSATION_KINDS, SERVICE_TEXT as T } from './texts.ts';

type S = components['schemas'];

export type Direction = S['ServiceDirection'];
export type RequestType = S['ServiceRequestType'];
export type Summary = S['ServiceRequestSummary'];
export type Request = S['ServiceRequest'];
export type Message = S['ServiceMessage'];
export type Rating = S['ServiceRating'];
export type Template = S['ServiceReplyTemplate'];
export type Status = Summary['status'];
export type Kind = Summary['kind'];
export type Channel = Summary['channel'];
export type SlaState = S['ServiceSlaHead']['state'];
export type QueueKey = S['ServiceQueueCount']['key'];
export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral' | 'soft';

/** Тон и значок срока по состоянию (slaTone эталона). */
export const SLA_TONE: Readonly<Record<SlaState, { tone: Tone; icon: string }>> = {
  late: { tone: 'danger', icon: 'error' },
  risk: { tone: 'warn', icon: 'schedule' },
  norm: { tone: 'soft', icon: 'schedule' },
  legal: { tone: 'info', icon: 'gavel' },
  pause: { tone: 'neutral', icon: 'pause_circle' },
  done: { tone: 'ok', icon: 'check_circle' },
  none: { tone: 'soft', icon: 'remove' },
};

const TONES = new Set<Tone>(['ok', 'info', 'warn', 'danger', 'neutral']);

/** Чип статуса: подпись, значок и тон из справочника домена. */
export function statusInfo(status: Status): { label: string; icon: string; tone: Tone } {
  const s = SVC_ST[status];
  return {
    label: s.label,
    icon: s.icon,
    tone: TONES.has(s.tone as Tone) ? (s.tone as Tone) : 'neutral',
  };
}

export const kindInfo = (kind: Kind): { label: string; icon: string } => SVC_KIND[kind];

/** Канал: подпись и значок (неизвестный — «—», значок `chat`). */
export function channelInfo(channel: string | null | undefined): { label: string; icon: string } {
  const c = SVC_CH[(channel ?? '') as Channel] as readonly [string, string] | undefined;
  return c ? { label: c[0], icon: c[1] } : { label: T.card.channelUnknown, icon: 'chat' };
}

export const PRIORITIES: readonly { value: Summary['priority']; label: string }[] = (
  Object.entries(SVC_PRIO) as [Summary['priority'], string][]
).map(([value, label]) => ({ value, label }));

export const isOpen = (status: Status): boolean => status !== 'resolved' && status !== 'closed';

/** Название типа обращения направления; нет типа — подпись вида. */
export function typeName(types: readonly RequestType[], directionId: string, kind: Kind): string {
  return (
    types.find((t) => t.directionId === directionId && t.kind === kind)?.name ??
    kindInfo(kind).label
  );
}

/** «Компания · клиент» или имя. */
export const clientLine = (c: Pick<S['ServiceClient'], 'name' | 'company'>): string =>
  c.company ? `${c.company} · ${c.name}` : c.name;

/** «SMS · оценка 2 из 5» (строка очереди). */
export function channelLine(r: Pick<Summary, 'channel' | 'fromRating'>): string {
  return (
    channelInfo(r.channel).label +
    (r.fromRating ? T.list.rated.replace('{n}', String(r.fromRating)) : '')
  );
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('') || '?';

// ---------------------------------------------------------------------------------------------
// Ключи роли «Обращений» (api/permissions.yaml, модуль core.service)

export const SERVICE_KEYS = [
  'service.requests.read',
  'service.requests.create',
  'service.requests.reply',
  'service.requests.resolve',
  'service.clients.contacts',
  'service.compensation.manage',
] as const;

// ---------------------------------------------------------------------------------------------
// Права кнопок (PD-53: сервер проверяет с направлением; кнопки — по членству в команде и ключам роли)

export interface Rights {
  /** «Отвечать» в этом направлении. */
  reply: boolean;
  /** «Решать». */
  resolve: boolean;
  /** «Заводить». */
  create: boolean;
  /** Компенсация (service.compensation.manage). */
  compensate: boolean;
  /** Показ телефона (direction.canContacts). */
  contacts: boolean;
  /** Участник входит в команду направления («Взять себе», «Назначить меня»). */
  inTeam: boolean;
  /** Я в команде направления: его запись для «Назначить меня» (в контракте нет id участника, ищем по имени). */
  me?: S['ServiceMemberRef'];
}

export interface RightsCtx {
  owner: boolean;
  /** Это я? В контексте организации нет id участника: совпадение по id членства или по имени (Q-W7.32-1). */
  isMe: (m: S['ServiceMemberRef']) => boolean;
  can: (...permissions: string[]) => boolean;
  /** В контексте организации есть ключи service.*; нет — права берутся из команды направления (по умолчанию да). */
  keysKnown?: boolean;
}

export function rightsIn(
  dir: Pick<Direction, 'team' | 'canContacts'> | undefined,
  x: RightsCtx,
): Rights {
  const me = dir?.team.find((m) => x.isMe(m));
  const inTeam = !!dir && (x.owner || !!me);
  const open = x.keysKnown === false;
  const reply = inTeam && (x.owner || open || x.can('service.requests.reply'));
  const resolve = inTeam && (x.owner || open || x.can('service.requests.resolve'));
  return {
    reply,
    resolve,
    create: x.owner || open || x.can('service.requests.create'),
    compensate: resolve && (x.owner || x.can('service.compensation.manage')),
    contacts: !!dir?.canContacts,
    inTeam,
    ...(me ? { me } : {}),
  };
}
/** «Взять себе»: открытое обращение без исполнителя, есть «Отвечать» и участник в команде. */
export const canTake = (r: Pick<Summary, 'assignee' | 'status'>, rt: Rights): boolean =>
  !r.assignee && isOpen(r.status) && rt.reply && rt.inTeam;

// ---------------------------------------------------------------------------------------------
// Действия карточки (cardVM acts)

export type ActId = 'work' | 'wait' | 'resolve' | 'move' | 'back' | 'close';

export interface Act {
  id: ActId;
  label: string;
  icon: string;
  primary: boolean;
  /** Переход статуса; у `resolve` и `move` — панель. */
  to?: Status;
  toast?: string;
}

/** Действия по статусу: `new` и `work` — «Взять в работу», «Ждём клиента», «Решено…», «В другое направление…» и т. д. */
export function cardActions(status: Status, rt: Rights, directions: number, key: string): Act[] {
  const acts: Act[] = [];
  const E = (a: Act): void => void (rt.reply && acts.push(a));
  const R = (a: Act): void => void (rt.resolve && acts.push(a));
  const A = T.card.acts;
  const Z = T.card.toasts;
  const mv: Act = { id: 'move', label: A.move, icon: 'move_up', primary: false };
  if (status === 'new') {
    E({
      id: 'work',
      label: A.work,
      icon: 'play_arrow',
      primary: true,
      to: 'work',
      toast: Z.work.replace('{key}', key),
    });
    E({
      id: 'wait',
      label: A.wait,
      icon: 'hourglass_top',
      primary: false,
      to: 'wait',
      toast: Z.wait,
    });
    R({ id: 'resolve', label: A.resolve, icon: 'task_alt', primary: false });
    if (directions > 1) E(mv);
  }
  if (status === 'work') {
    E({
      id: 'wait',
      label: A.wait,
      icon: 'hourglass_top',
      primary: false,
      to: 'wait',
      toast: Z.wait,
    });
    R({ id: 'resolve', label: A.resolve, icon: 'task_alt', primary: true });
    if (directions > 1) E(mv);
  }
  if (status === 'wait') {
    E({
      id: 'back',
      label: A.back,
      icon: 'play_arrow',
      primary: true,
      to: 'work',
      toast: Z.backFromWait,
    });
    R({ id: 'resolve', label: A.resolve, icon: 'task_alt', primary: false });
  }
  if (status === 'resolved') {
    E({
      id: 'back',
      label: A.back,
      icon: 'replay',
      primary: false,
      to: 'work',
      toast: Z.reopen.replace('{key}', key),
    });
    R({
      id: 'close',
      label: A.close,
      icon: 'lock',
      primary: true,
      to: 'closed',
      toast: Z.close.replace('{key}', key),
    });
  }
  return acts;
}

/** Итоги решения: у жалобы на сотрудника — только «Подтвердилась» / «Не подтвердилась». */
export const outcomesOf = (about: boolean): readonly string[] =>
  about ? OUTCOMES_ABOUT : OUTCOMES;

/** Жалоба касается сотрудника: сервер отдаёт `aboutMember` руководителю и владельцу (остальным поле скрыто). */
export const isAbout = (r: Pick<Request, 'aboutMember'>): boolean => !!r.aboutMember;

// ---------------------------------------------------------------------------------------------
// Компенсация

export const COMPENSATION_OPTIONS: readonly {
  kind: (typeof COMPENSATION_KINDS)[number];
  label: string;
}[] = COMPENSATION_KINDS.map((kind, i) => ({ kind, label: COMPENSATIONS[i] as string }));

export const compensationKind = (label: string): (typeof COMPENSATION_KINDS)[number] | undefined =>
  COMPENSATION_OPTIONS.find((o) => o.label === label)?.kind;

// ---------------------------------------------------------------------------------------------
// «Обращение по звонку»

/** Рабочее время направления в минутах от полуночи (контракт — «ЧЧ:ММ», дни ISO 1–7). */
export function calendarMinutes(c: Direction['calendar']): {
  from: number;
  to: number;
  days: number[];
} {
  const m = (s: string): number => {
    const [h = 0, mm = 0] = s.split(':').map(Number);
    return h * 60 + mm;
  };
  return { from: m(c.from), to: m(c.to), days: c.days.map((d) => d - 1) };
}

export interface CallForm {
  directionId: string;
  typeId: string;
  clientName: string;
  phone: string;
  text: string;
}

/** Проверка до отправки «по звонку»: первая ошибка по порядку эталона (service.js 312–317) или 
ull. */
export function callError(f: CallForm): string | null {
  if (!f.directionId) return 'Выберите направление';
  if (!f.typeId) return 'Выберите тип обращения';
  if (f.clientName.trim().length < 2) return 'Укажите имя клиента';
  if (f.phone.replace(/\D/g, '').length < 10) return 'Телефон — не меньше 10 цифр';
  if (!f.text.trim()) return 'Опишите, что случилось';
  return null;
}

/** Тема задачи не короче 3 символов (service.js 346). */
export const taskError = (title: string): string | null =>
  title.trim().length < 3 ? 'Тема задачи — не короче 3 символов' : null;

/** Подсказка под полями: срок первого ответа и срок по закону типа в рабочем времени направления. */
export function callHint(type: RequestType | undefined, dir: Direction | undefined): string {
  if (!type || !dir) return '';
  const C = T.call;
  const first = type.firstMinutes
    ? C.hintFirst.replace('{dur}', svcDur(type.firstMinutes, calendarMinutes(dir.calendar)))
    : C.hintNoFirst;
  const legal = type.legalDays ? C.hintLegal.replace('{n}', String(type.legalDays)) : '';
  return `${C.hint}${first}${legal}.`;
}

/** Типы направления для звонка: без «Благодарности» (её не заводят по звонку). */
export const callTypes = (types: readonly RequestType[], directionId: string): RequestType[] =>
  types.filter((t) => t.directionId === directionId && t.kind !== 'thanks');

// ---------------------------------------------------------------------------------------------
// Лента карточки

export interface FeedChip {
  label: string;
  tone: Tone;
  strong?: boolean;
}

export interface FeedItem {
  id: string;
  kind: 'system' | 'client' | 'public' | 'note' | 'rating';
  /** Системная запись — одна строка с временем. */
  system: boolean;
  by: string;
  meta: string;
  text: string;
  at: string;
  initials: string;
  /** Значок вместо инициалов (автоответ, оценка). */
  icon?: string;
  avatar: 'plain' | 'public' | 'note' | 'low' | 'good';
  tag?: { label: string; icon: string; tone: 'ok' | 'warn' };
  chips: FeedChip[];
  files: { name: string; icon: string }[];
}

export function fileIcon(name: string): string {
  if (/\.pdf$/i.test(name)) return 'picture_as_pdf';
  if (/\.(jpe?g|png|heic)$/i.test(name)) return 'image';
  return 'draft';
}

/** Запись ленты: подписи и значки по виду сообщения (cardVM msgs). */
export function feedItem(
  m: Message,
  r: Pick<Request, 'channel' | 'client'>,
  now: number,
): FeedItem {
  const at = svcWhen(Date.parse(m.at), now);
  const ch = channelInfo(m.channel ?? r.channel).label;
  const author = m.author?.displayName ?? '';
  const base: FeedItem = {
    id: m.id,
    kind: m.kind,
    system: false,
    by: author,
    meta: '',
    text: m.text,
    at,
    initials: '',
    avatar: 'plain',
    chips: [],
    files: m.files.map((f) => ({ name: f.fileName, icon: fileIcon(f.fileName) })),
  };
  if (m.kind === 'system') return { ...base, system: true };
  if (m.kind === 'rating') {
    const score = m.score ?? 0;
    const low = score <= 3;
    return {
      ...base,
      by: r.client.name,
      meta: T.card.ratingMeta.replace('{at}', at),
      text: m.text ? `«${m.text}»` : '',
      icon: low ? 'sentiment_dissatisfied' : 'sentiment_satisfied',
      avatar: low ? 'low' : 'good',
      chips: [
        {
          label: T.card.ratingScore.replace('{n}', String(score)),
          tone: low ? 'danger' : 'ok',
          strong: true,
        },
        ...(m.reasons ?? []).map((x) => ({ label: x, tone: 'neutral' as const })),
        ...(m.contact ? [{ label: T.card.wantsContact, tone: 'neutral' as const }] : []),
      ],
    };
  }
  if (m.kind === 'client') {
    return { ...base, by: r.client.name, initials: initials(r.client.name), meta: `${ch} · ${at}` };
  }
  if (m.kind === 'public') {
    return {
      ...base,
      by: m.auto ? T.card.autoReply : author,
      ...(m.auto ? { icon: 'bolt' } : {}),
      initials: m.auto ? '' : initials(author),
      avatar: 'public',
      meta: `${ch} · ${at}`,
      tag: { label: T.card.clientSees, icon: 'visibility', tone: 'ok' },
    };
  }
  return {
    ...base,
    initials: initials(author),
    avatar: 'note',
    meta: at,
    tag: { label: T.card.noteTag, icon: 'lock', tone: 'warn' },
  };
}

/** Подпись канала под полем ответа: «Уйдёт: SMS на +7 ••• •••-••-18 — канал обращения». */
export function sendNote(
  r: Pick<Request, 'channel' | 'client'>,
  note: boolean,
): { icon: string; text: string } {
  if (note) return { icon: 'lock', text: T.card.noteWontSee };
  const ch = channelInfo(r.channel);
  const phoneCh = r.channel === 'sms' || r.channel === 'phone';
  return {
    icon: ch.icon,
    text: T.card.willSend
      .replace('{channel}', ch.label)
      .replace(
        '{phone}',
        phoneCh ? T.card.willSendPhone.replace('{phone}', r.client.phoneMasked) : '',
      ),
  };
}

/** «Создано … · SMS · прежний номер …» (шапка карточки). */
export function cardMeta(
  r: Pick<Request, 'createdAt' | 'channel' | 'oldKeys'>,
  now: number,
): string {
  return (
    T.card.metaCreated
      .replace('{when}', svcWhen(Date.parse(r.createdAt), now))
      .replace('{channel}', channelInfo(r.channel).label) +
    (r.oldKeys?.length ? T.card.metaOld.replace('{keys}', r.oldKeys.join(', ')) : '')
  );
}

/** Шаблон ответа с подстановками `{имя}`, `{номер}`, `{срок}` (cardVM fill). */
export const fillReply = (text: string, r: Pick<Request, 'key' | 'client' | 'head'>): string =>
  fillTemplate(text, { name: r.client.name, key: r.key, until: r.head.until });

/** «После решения» (cardVM after). */
export function afterText(r: Pick<Request, 'status' | 'key' | 'outcome' | 'compensation'>): string {
  const comp = r.compensation ? T.side.afterComp.replace('{text}', r.compensation) : '';
  return isOpen(r.status)
    ? T.side.afterOpen.replace('{comp}', comp).replace('{key}', r.key)
    : T.side.afterDone.replace('{outcome}', r.outcome || '—').replace('{comp}', comp);
}

/** Текст оценки в очереди «Низкие оценки»: причины и комментарий. */
export function ratingText(x: Pick<Rating, 'reasons' | 'comment'>): string {
  return (
    (x.reasons.length ? x.reasons.join(', ') + (x.comment ? ' · ' : '') : '') +
    (x.comment ? `«${x.comment}»` : '')
  );
}

/** Подзаголовок очереди: «Все мои направления · открытые · сначала самый ранний срок». */
export function queueSubtitle(directionName: string | null, queueLabel: string): string {
  return T.list.subtitle
    .replace('{scope}', directionName ?? T.list.allDirections)
    .replace('{queue}', queueLabel.toLowerCase());
}

/** Ключи модулей в контракте «Обращений» и в каталоге домена (`ALL_MODULES`) называются по-разному. */
const MODULE_ALIAS: Readonly<Record<string, string>> = { fleet: 'logistics', repairs: 'repair' };

/** Название модуля направления из каталога; неизвестный ключ клиенту не показываем. */
function moduleTitle(moduleKey: string): string {
  const catalog = ALL_MODULES as Record<string, { name: string } | undefined>;
  return (catalog[MODULE_ALIAS[moduleKey] ?? moduleKey] ?? catalog[moduleKey])?.name ?? '';
}

/** «Направление» боковой колонки: «Массаж · Салон и SPA» (dirText эталона: название · модуль). */
export function directionText(d: Pick<Direction, 'name' | 'moduleKey'> | undefined): string {
  if (!d) return '';
  const module = moduleTitle(d.moduleKey);
  return module ? `${d.name} · ${module}` : d.name;
}

/** Заголовок ETag по ревизии (`If-Match`). */
export const etag = (revision: number): string => `"rev-${String(revision)}"`;
