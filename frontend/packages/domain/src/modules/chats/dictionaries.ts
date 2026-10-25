// Справочники чатов (chats.js 14.10:22–63): виды, роли, пределы и политики видов.
// Отклонения от эталона — по ответам владельца 17.10 (бриф W7.10 §10): режим прочтения по умолчанию
// `ticks` (CHAT-02, Q-W7.10-1), срок удалённых ровно 30 дней (CHAT-10, Q-W7.10-2).
import type {
  ChatKind,
  ChatPolicy,
  ChatRoleKey,
  ChatRoleTemplate,
  EditMode,
  FullMode,
  FwdMode,
  RcptMode,
  TempMode,
} from './types.ts';

export const CHAT_KINDS: Readonly<
  Record<ChatKind, { label: string; one: string; icon: string; folder: string }>
> = {
  direct: { label: 'Личные', one: 'Личный чат', icon: 'person', folder: 'direct' },
  group: { label: 'Рабочие группы', one: 'Рабочая группа', icon: 'groups', folder: 'group' },
  area: { label: 'По роли в области', one: 'Чат по роли', icon: 'badge', folder: 'group' },
  record: { label: 'Чаты записей', one: 'Чат записи', icon: 'link', folder: 'record' },
  announce: { label: 'Объявления', one: 'Объявления', icon: 'campaign', folder: 'announce' },
};

export const CHAT_ROLE_LABEL: Readonly<Record<ChatRoleKey, string>> = {
  owner: 'Владелец чата',
  moderator: 'Модератор',
  member: 'Участник',
  reader: 'Читатель',
};

export const RANK: Readonly<Record<ChatRoleKey, number>> = {
  reader: 1,
  member: 2,
  moderator: 3,
  owner: 4,
};

const FIN0 = { read: false, manage: false };

export const CHAT_ROLES: readonly ChatRoleTemplate[] = [
  {
    id: 'r-chat-owner',
    name: 'Владелец чата',
    kind: 'template',
    chatRole: 'owner',
    actions: { chat: ['view', 'create', 'review', 'settings'] },
    finance: FIN0,
  },
  {
    id: 'r-chat-mod',
    name: 'Модератор чата',
    kind: 'template',
    chatRole: 'moderator',
    actions: { chat: ['view', 'create', 'review'] },
    finance: FIN0,
  },
  {
    id: 'r-chat-member',
    name: 'Участник чата',
    kind: 'template',
    chatRole: 'member',
    actions: { chat: ['view', 'create'] },
    finance: FIN0,
  },
  {
    id: 'r-chat-reader',
    name: 'Читатель чата',
    kind: 'template',
    chatRole: 'reader',
    actions: { chat: ['view'] },
    finance: FIN0,
  },
  {
    id: 'r-chat-creator',
    name: 'Чаты · создаёт группы',
    kind: 'template',
    actions: { chat: ['view', 'create', 'edit'] },
    finance: FIN0,
  },
];

export const CHAT_ROLE_ID: Readonly<Record<ChatRoleKey, string>> = {
  owner: 'r-chat-owner',
  moderator: 'r-chat-mod',
  member: 'r-chat-member',
  reader: 'r-chat-reader',
};

// ── Политики: организация задаёт пределы, вид чата — значения, чат меняет их в пределах ──
export const EDIT_LABEL: Readonly<Record<EditMode, string>> = {
  '15m': '15 минут',
  '48h': '48 часов',
  none: 'Без срока',
};
export const EDIT_MIN: Readonly<Record<EditMode, number>> = {
  '15m': 15,
  '48h': 2880,
  none: Infinity,
};
export const RCPT_LABEL: Readonly<Record<RcptMode, string>> = {
  off: 'Не показывать',
  ticks: 'Галочки',
  who: 'Кто и когда',
};
export const TEMP_LABEL: Readonly<Record<TempMode, string>> = {
  off: 'Запрещены',
  allowed: '1 час — 7 дней',
  viewonce: 'Одноразовые файлы · модераторы',
};
export const FWD_LABEL: Readonly<Record<FwdMode, string>> = {
  free: 'Свободно',
  internal: 'Внутри организации',
  off: 'Запрещена',
};
export const FULL_LABEL: Readonly<Record<FullMode, string>> = {
  block: 'Запретить новые файлы',
  ring: 'Удалять старые вложения',
  archive: 'Переносить в архив',
  compress: 'Сжимать медиа',
};
export const FULL_HINT: Readonly<Record<FullMode, string>> = {
  block: 'Текст, опросы и подтверждения работают. Рабочие фото модулей уходят в резерв модуля.',
  ring: 'Самые старые вложения удаляются, чтобы вместить новые; сохранённое в запись и под удержанием не трогается.',
  archive: 'Старые вложения уходят в архивное хранилище и открываются по запросу за 1–3 минуты.',
  compress:
    'Фото и видео старше 30 дней заменяются сжатыми копиями; если места мало — как «Запретить».',
};

/** Режимы, которые показывает интерфейс MVP: «Переносить в архив» — v2 (CHAT-08, Q-W7.10-3). */
export const FULL_MODES_MVP: readonly FullMode[] = ['block', 'ring', 'compress'];

export type BoundKey = 'textY' | 'filesD' | 'voiceD' | 'rcptD' | 'delD' | 'maxMb';

export const BOUNDS: Readonly<Record<BoundKey, readonly [number, number]>> = {
  textY: [1, 5],
  filesD: [30, 1825],
  voiceD: [30, 1095],
  rcptD: [7, 90],
  delD: [30, 30],
  maxMb: [10, 2000],
};

const POL = (o: Partial<ChatPolicy>): ChatPolicy => ({
  textY: 3,
  filesD: 365,
  voiceD: 90,
  rcpt: 'ticks',
  rcptD: 30,
  delD: 30,
  edit: '48h',
  maxMb: 200,
  quotaMb: null,
  temp: 'off',
  fwd: 'internal',
  pdn: true,
  onFull: 'block',
  ...o,
});

/** Политики видов по умолчанию (сид кладёт копию в `db.chats.policy`). */
export const DEFAULT_POLICY: Readonly<Record<ChatKind, ChatPolicy>> = {
  direct: POL({ rcpt: 'ticks', temp: 'allowed' }),
  group: POL({ quotaMb: 5000 }),
  area: POL({ maxMb: 100 }),
  record: POL({ maxMb: 500, quotaMb: 5000, temp: 'viewonce', afterClose: 3 }),
  announce: POL({ textY: 5, maxMb: 50, rcpt: 'off' }),
};

export { POL as makePolicy };
