// Сид чатов (chats.js 14.10:183–273): шесть чатов «Альты» и два «Лотоса», роли чатов, назначения
// «по имени». Стадия `chats` сида (`SEED_STAGES` ядра) — после документов (сид ищет договор 42/26)
// и ремонта (имя и подразделение объекта obj-42). Время сообщений — минуты от 01.10.2026.
import { objOf } from '../../core/entries.ts';
import type { SeedHook } from '../../core/seed-hooks.ts';
import type { Assignment, Role } from '../../core/types/index.ts';
import { CHAT_ROLES, DEFAULT_POLICY } from './dictionaries.ts';
import type { Chat, ChatFile, ChatMessage, ChatsTenantDb, FileKind, Poll } from './types.ts';

interface SeedChat extends Omit<
  Chat,
  'seq' | 'last' | 'lastRead' | 'journal' | 'status' | 'sensitivity' | 'usedMb'
> {
  usedMb?: number;
  sensitivity?: Chat['sensitivity'];
}

export interface ChatsSeed {
  chats: SeedChat[];
  assign: Assignment[];
  read: Record<string, Record<string, number>>;
}

const clone = <T>(o: T): T => structuredClone(o);
const F = (name: string, mb: number, kind: FileKind, x?: Partial<ChatFile>): ChatFile => ({
  name,
  mb,
  kind,
  ...x,
});

const T = (d: number, t: string): number => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return d * 1440 + h * 60 + m;
};

export function chatsSeed(db: ChatsTenantDb): ChatsSeed {
  let seq = 0;
  type Extra = string | Partial<ChatMessage>;
  const msg = (by: string, d: number, t: string, x?: Extra): ChatMessage => ({
    id: 'cm-' + String(++seq),
    seq: 0,
    ts: T(d, t),
    by,
    text: '',
    reads: {},
    ...(typeof x === 'string' ? { text: x } : (x ?? {})),
  });
  const poll = (
    q: string,
    opts: string[],
    closesTs: number,
    closesLabel: string,
  ): Partial<ChatMessage> => {
    const p: Poll = {
      q,
      opts: opts.map((t, i) => ({ id: 'o' + String(i + 1), t })),
      votes: {},
      anon: false,
      multi: false,
      closes: closesTs,
      closesLabel,
      closed: false,
    };
    return { kind: 'poll', poll: p };
  };
  if (db.tenantId !== 't-alta') {
    return {
      chats: [
        {
          id: 'ch-news',
          kind: 'announce',
          title: 'Новости салона',
          unit: null,
          owner: 'm-owner',
          sources: [{ who: 'all', role: 'reader' }],
          msgs: [
            msg('m-owner', 0, '09:00', {
              text: 'С ноября работаем до 22:00 по пятницам. Подтвердите, что видели.',
              important: { due: '15.10', acks: [] },
            }),
          ],
        },
        {
          id: 'ch-tver',
          kind: 'area',
          title: 'Мастера · Тверская',
          unit: 'f-lotos-tver',
          owner: 'm-owner',
          sources: [{ who: 'group', ref: 'g-tver', role: 'member' }],
          msgs: [msg('m-owner', 0, '08:40', 'Масло для массажа привезут в четверг.')],
        },
      ],
      assign: [],
      read: {},
    };
  }
  const o42 = objOf(db, 'obj-42') as { name?: string; unit?: string | null } | undefined;
  const docs = (db as { docs?: { items?: { id: string; title: string; v?: number }[] } }).docs;
  const dc = (docs?.items ?? []).find((d) => /42\/26/.test(d.title));
  const chats: SeedChat[] = [
    {
      id: 'ch-news',
      kind: 'announce',
      title: 'Альта · новости',
      unit: null,
      owner: 'm-owner',
      sources: [{ who: 'all', role: 'reader' }],
      msgs: [
        msg(
          'm-owner',
          -1,
          '17:00',
          'С 1 октября рабочие сообщения — в чатах Ортуса. Переписка остаётся у организации и хранится по политике, личные мессенджеры для работы не используем.',
        ),
        msg('m-owner', 0, '09:00', {
          text: '4 ноября — выходной. Работы на объектах и рейсы в этот день не планируем, поставки переносим на 5 ноября.',
          important: { due: '31.10', acks: [{ member: 'm-kotova', ts: T(0, '09:20') }] },
        }),
      ],
    },
    {
      id: 'ch-drv',
      kind: 'area',
      title: 'Водители · Север Логистик',
      unit: 'f-msk-sever',
      owner: 'm-kotova',
      usedMb: 840,
      sources: [
        { who: 'role', ref: 'r-driver', unit: 'f-msk-sever', role: 'member' },
        { who: 'group', ref: 'g-drv', role: 'member' },
        { who: 'group', ref: 'g-disp', role: 'moderator' },
      ],
      msgs: [
        msg(
          'm-kotova',
          -1,
          '18:10',
          'Завтра с 8:00 мойка на Складе № 1 закрыта — заправляемся и моемся у МКАД.',
        ),
        msg('m-vasiliev', -1, '18:24', 'Понял. Документы на А 412 МР 77 забрал.'),
        msg('m-kotova', 0, '08:05', {
          text: 'Регламент приёмки смены обновлён: фото одометра при сдаче обязательно. Подтвердите до 03.10.',
          important: { due: '03.10', acks: [] },
        }),
        msg(
          'm-kotova',
          0,
          '08:30',
          poll(
            'Кто может выйти в субботу 04.10 на рейс Р-215?',
            ['Могу утром', 'Могу после 14:00', 'Не могу'],
            T(2, '18:00'),
            '03.10 в 18:00',
          ),
        ),
        msg('sys', 0, '09:12', {
          sys: {
            mod: 'Логистика',
            icon: 'report',
            tone: 'danger',
            title: 'Критический дефект · М 608 КТ 77',
            text: 'Выезд заблокирован до решения менеджера',
            label: 'Открыть автопарк',
            nav: 'fleet',
          },
        }),
      ],
    },
    {
      id: 'ch-trip',
      kind: 'record',
      title: 'Рейс Р-208 · Северный маршрут',
      unit: 'f-msk-sever',
      owner: 'm-kotova',
      usedMb: 46,
      record: { kind: 'trip', id: 'Р-208', module: 'logistics', nav: 'fleet', label: 'Рейс Р-208' },
      sources: [
        { who: 'tripDriver', trip: 'Р-208', role: 'member' },
        { who: 'group', ref: 'g-disp', role: 'moderator' },
      ],
      msgs: [
        msg('sys', 0, '07:40', {
          sys: {
            mod: 'Логистика',
            icon: 'local_shipping',
            tone: 'info',
            title: 'Рейс назначен: Илья Васильев',
            text: '01.10 · 09:00–13:00 · 46 км · сухой груз, 14 паллет-мест',
            label: 'Открыть рейс',
            nav: 'fleet',
          },
        }),
        msg('m-vasiliev', 0, '08:40', 'Беру А 412 МР 77, начинаю осмотр.'),
      ],
    },
    {
      id: 'ch-obj42',
      kind: 'record',
      title: o42?.name || 'ЖК Речной · квартира 42',
      unit: o42?.unit || null,
      owner: 'm-owner',
      usedMb: 4600,
      savedMb: 1100,
      record: { kind: 'object', id: 'obj-42', module: 'repair', nav: 'repair', label: 'Объект' },
      topics: ['Общее', 'Снабжение', 'Приёмка', 'Допработы'],
      sources: [{ who: 'relation', obj: 'obj-42', role: 'member' }],
      hold: {
        reason: 'Претензия по кв. 42',
        period: '01.09–15.09',
        until: '01.12',
        by: 'm-owner',
        files: 6,
        range: { from: T(-30, '00:00'), to: T(-15, '00:00') - 1 },
      },
      buckets: [
        { id: 'b1', kind: 'video', label: 'Видео', ageD: 120, n: 212, mb: 1900 },
        { id: 'b2', kind: 'photo', label: 'Фото', ageD: 200, n: 340, mb: 500 },
        { id: 'b3', kind: 'photo', label: 'Фото', ageD: 12, n: 410, mb: 1500 },
        { id: 'b4', kind: 'doc', label: 'Документы', ageD: 60, n: 30, mb: 300 },
        { id: 'b5', kind: 'voice', label: 'Голосовые', ageD: 45, n: 96, mb: 100 },
        { id: 'b6', kind: 'voice', label: 'Голосовые', ageD: 5, n: 40, mb: 100 },
        {
          id: 'b7',
          kind: 'photo',
          label: 'Фото под удержанием',
          ageD: 25,
          n: 6,
          mb: 200,
          hold: true,
        },
      ],
      msgs: [
        msg('m-owner', -1, '16:20', {
          topic: 'Снабжение',
          text: 'Фанеру ФК 15 мм выдали по заявке З-12, саморезы будут в пятницу.',
        }),
        msg('sys', 0, '10:38', {
          topic: 'Приёмка',
          sys: {
            mod: 'Ремонт и стройка',
            icon: 'construction',
            tone: 'info',
            title: 'Отметка на приёмке: штукатурка стен, 42 м²',
            text: 'Алексей Соколов · 6 фото · ждёт приёмки владельцем',
            label: 'Открыть объект',
            nav: 'repair',
            id: 'obj-42',
          },
        }),
        msg('m-sokolov', 0, '10:41', {
          topic: 'Общее',
          text: 'Стены в спальне готовы, можно принимать.',
          files: [
            F('Спальня · стена 1.jpg', 4.1, 'photo'),
            F('Спальня · стена 2.jpg', 3.8, 'photo'),
            F('Откосы.jpg', 3.2, 'photo'),
          ],
        }),
        msg('m-sokolov', 0, '10:47', {
          topic: 'Общее',
          text: 'Заказчик просит звонить заранее: +7 916 482-31-17.',
        }),
        msg('m-owner', 0, '10:49', {
          topic: 'Общее',
          text: 'Договор согласовали, утверждаю сегодня. Посмотрите раздел 2 про сроки.',
          doc: dc
            ? { kind: 'doc', ref: dc.id, title: dc.title, sub: 'Документы · v' + String(dc.v || 1) }
            : null,
        }),
        msg('m-owner', 0, '10:52', {
          topic: 'Общее',
          text: '4 ноября работы на объекте не ведём: дом закрыт для подрядчиков.',
          important: { due: '31.10', acks: [] },
        }),
        msg('m-owner', 0, '10:53', {
          topic: 'Общее',
          text: 'Пропуск на ноябрь.',
          spoiler: 'Код домофона на ноябрь: 0420',
          files: [F('Пропуск в ЖК · Соколов А.pdf', 0.3, 'doc', { viewOnce: true, opened: {} })],
        }),
        msg('m-owner', 0, '10:55', {
          topic: 'Общее',
          ...poll(
            'Когда принимаем штукатурку?',
            ['Чт 02.10 · 10:00', 'Чт 02.10 · 15:00', 'Пт 03.10 · 11:00'],
            T(1, '09:00'),
            '02.10 в 09:00',
          ),
        }),
      ],
    },
    {
      id: 'ch-dkv',
      kind: 'direct',
      pair: ['m-kotova', 'm-vasiliev'],
      msgs: [
        msg('m-kotova', 0, '07:50', 'Илья, Р-208 за тобой. Машину выберешь в «Сегодня».'),
        msg('m-vasiliev', 0, '07:52', 'Принял.'),
        msg('m-kotova', 0, '07:55', {
          text: 'Код от ворот склада на сегодня:',
          spoiler: '4471',
          temp: { exp: T(1, '07:55'), h: 24 },
        }),
      ],
    },
    {
      id: 'ch-dzs',
      kind: 'direct',
      pair: ['m-owner', 'm-sokolov'],
      msgs: [
        msg('m-owner', -1, '16:40', 'Алексей, по кв. 42 жду фото стен до пятницы.'),
        msg('m-sokolov', -1, '16:55', 'Хорошо, завтра отправлю в чат объекта.'),
      ],
    },
  ];
  const read = {
    'ch-news': { 'm-owner': 2, 'm-kotova': 2 },
    'ch-drv': { 'm-kotova': 5, 'm-vasiliev': 2, 'm-kotelnikova': 4 },
    'ch-trip': { 'm-kotova': 2, 'm-vasiliev': 2 },
    'ch-obj42': { 'm-owner': 8, 'm-sokolov': 4 },
    'ch-dkv': { 'm-kotova': 3, 'm-vasiliev': 2 },
    'ch-dzs': { 'm-owner': 2, 'm-sokolov': 2 },
  };
  const assign: Assignment[] = [
    {
      id: 'ach-1',
      member: 'm-kotova',
      role: 'r-chat-owner',
      scope: { type: 'chat', id: 'ch-drv' },
    },
    {
      id: 'ach-2',
      member: 'm-kotelnikova',
      role: 'r-chat-reader',
      scope: { type: 'chat', id: 'ch-drv' },
    },
    {
      id: 'ach-3',
      member: 'm-ilyin',
      role: 'r-chat-reader',
      scope: { type: 'chat', id: 'ch-obj42' },
    },
    {
      id: 'ach-4',
      member: 'm-kotova',
      role: 'r-chat-creator',
      scope: { type: 'firm', id: 'f-msk-sever' },
    },
  ];
  return { chats, assign, read };
}

/** Действия модуля «Чаты» в шаблонах ролей организации (chats.js:260–261). */
const TEMPLATE_CHAT_ACTIONS: readonly (readonly [string, Role['actions']['chat']])[] = [
  ['r-manager', ['view', 'create', 'edit', 'review']],
  ['r-driver', ['view', 'create']],
  ['r-foreman', ['view', 'create']],
  ['r-therapist', ['view', 'create']],
  ['r-admin', ['view', 'create', 'edit', 'review']],
];

/** Установка чатов в БД организации (стадия `chats` сида). Повторный вызов ничего не меняет. */
export function installChats(db: ChatsTenantDb): void {
  if (db.chats?.v1) return;
  for (const r of CHAT_ROLES) if (!db.roles.some((x) => x.id === r.id)) db.roles.push(clone(r));
  for (const [id, actions] of TEMPLATE_CHAT_ACTIONS) {
    const r = db.roles.find((x) => x.id === id);
    if (r && !r.actions.chat && actions) r.actions = { ...r.actions, chat: actions };
  }
  const x = chatsSeed(db);
  for (const a of x.assign) {
    if (!db.assignments.some((y) => y.id === a.id) && db.members.some((m) => m.id === a.member)) {
      db.assignments.push(a);
    }
  }
  const items: Chat[] = x.chats.map((c) => {
    c.msgs.forEach((m, i) => {
      m.seq = i + 1;
    });
    const lastRead = { ...(x.read[c.id] ?? {}) };
    for (const [mid, upto] of Object.entries(lastRead)) {
      c.msgs.forEach((m, i) => {
        if (m.seq <= upto && m.by !== mid) m.reads[mid] = m.ts + 2 + (i % 5);
      });
    }
    for (const m of c.msgs) if (m.by !== 'sys') m.reads[m.by] = m.ts;
    return {
      ...c,
      seq: c.msgs.length,
      last: c.msgs.length ? (c.msgs[c.msgs.length - 1] as ChatMessage).ts : 0,
      lastRead,
      usedMb: c.usedMb ?? 0,
      journal: [],
      status: 'active',
      sensitivity: c.sensitivity ?? 'normal',
    };
  });
  db.chats = { v1: true, now: 11 * 60 + 5, policy: clone(DEFAULT_POLICY), items };
}

/** Хук стадии `chats` для `createSeed({ hooks })`. */
export const chatsHook: SeedHook = (db) => {
  installChats(db as ChatsTenantDb);
};
