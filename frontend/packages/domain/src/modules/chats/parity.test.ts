// Паритет модуля «Чаты» с эталоном (`design/ortus/chats.js`, `models.js`, `mock-data.js`): одинаковые
// входы → одинаковые выходы. Эталон только импортируется (`seed/reference.ts`).
//
// Намеренные расхождения (бриф W7.10 §10) проверяются здесь же явно:
// - CHAT-02: режим прочтения по умолчанию `ticks` у рабочих видов и чатов записей (эталон — `who`);
//   при выровненных политиках проекции совпадают;
// - CHAT-10: срок удалённых ровно 30 дней — `BOUNDS.delD` [30, 30] (эталон [0, 90]);
// - PD-60: удалённое сообщение в проекции — только метка; удержание защищает сообщения (по чату,
//   сотруднику, периоду); место чата считается без частичных изменений; `@все` — один разбор,
//   `@Имя` — только участникам чата; задача из сообщения — через `TaskPort`;
// - CHAT-04: временные сообщения в политике — только у личных чатов; значения политики проверяются;
// - сообщение чужого чата неотличимо от несуществующего; повторное закрытие опроса, подтверждение,
//   голосование и открытие одноразового файла у удалённого сообщения — отказ.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { demoClock, fixedClock } from '../../core/clock.ts';
import { ApiError } from '../../core/errors/index.ts';
import { createIdGen } from '../../core/ids.ts';
import { createModuleCtx } from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/fake-task-port.ts';
import { createSeed, FUTURE_STAGE_HOOKS } from '../../seed/compose.ts';
import { importReference, referenceModels } from '../../seed/reference.ts';
import {
  chatAccess,
  chatMatrix,
  chatPeople,
  chatRights,
  chatTitle,
  policyOf,
  srcIcon,
  srcLabel,
} from './access.ts';
import { chatsCommands, type ChatsApi } from './commands.ts';
import * as D from './dictionaries.ts';
import { installChats } from './seed.ts';
import { tsDay, tsLabel, tsTime } from './time.ts';
import type { Chat, ChatPolicy, ChatsTenantDb } from './types.ts';
import { chatsView } from './view.ts';
import { hasPdn, maskPdn } from '../../core/format.ts';

type Fn = (...a: unknown[]) => unknown;
type RefDb = Record<string, unknown> & {
  chats: { policy: unknown; items: Chat[]; now: number };
  members: { id: string }[];
  events: { text: string; to: string[] }[];
  assignments: unknown[];
  roles: { id: string; actions: Record<string, unknown> }[];
  seq: number;
  modules: Record<string, { enabled: boolean }>;
};
type RefChats = Record<string, unknown> & {
  installChats(db: unknown, M: unknown): void;
  chatsView: Fn;
  chatsApi(env: unknown): Record<string, Fn>;
  chatAccess: Fn;
  chatRights: Fn;
  chatPeople: Fn;
  chatMatrix: Fn;
  chatTitle: Fn;
  policyOf: Fn;
  srcLabel: Fn;
  srcIcon: Fn;
  tsDay: Fn;
  tsTime: Fn;
  tsLabel: Fn;
  maskPdn: Fn;
  hasPdn: Fn;
};
interface RefMock {
  seed(): RefDb;
}

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let M: Record<string, unknown>;
let C: RefChats;
let MD: RefMock;

beforeAll(async () => {
  M = await referenceModels<Record<string, unknown>>();
  C = await importReference<RefChats>('chats.js');
  MD = await importReference<RefMock>('mock-data.js');
});

/** JSON без функций и `undefined`; у удержания эталона нет `range`. */
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const noRange = (chats: Chat[]): Chat[] =>
  plain(chats).map((c) => {
    if (c.hold) delete c.hold.range;
    return c;
  });

/** Пара баз с одинаковыми входами: эталон (14.10) и домен; политики выровнены по домену. */
function pair() {
  const ref = MD.seed();
  ref.modules['logistics'] = { enabled: true };
  ref.modules['repair'] = { enabled: true };
  C.installChats(ref, M);
  const ours = createSeed({
    hooks: { ...FUTURE_STAGE_HOOKS, chats: () => undefined },
  }).dbs['t-alta'] as unknown as ChatsTenantDb & Record<string, unknown>;
  ours['repair'] = structuredClone(ref['repair']);
  ours.modules.logistics = { enabled: true };
  ours.modules.repair = { enabled: true };
  installChats(ours);
  ref.chats.policy = structuredClone(ours.chats?.policy);
  return { ref, ours };
}

/** Команды эталона и домена от имени `actor` с общими событиями в `db.events`. */
function runners() {
  const { ref, ours } = pair();
  let who = 'm-owner';
  const cmd = (fn: () => unknown): Promise<{ data: unknown }> =>
    new Promise((resolve, reject) => {
      try {
        resolve({ data: fn() });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  const event = (text: string, to: string[], sensitive?: string) =>
    ref.events.unshift({
      id: 'e' + String(ref.seq++),
      at: '10:30',
      text,
      to,
      sensitive: sensitive ?? null,
    } as never);
  const refApi = C.chatsApi({
    getDb: () => ref,
    getActor: () => who,
    cmd,
    ApiError,
    M,
    event,
  });
  const ids = createIdGen(() => ours);
  const ctx = createModuleCtx({
    getDb: () => ours,
    getActor: () => who,
    clock: fixedClock('2026-10-01T11:05:00+03:00'),
    ids,
    tasks: createFakeTaskPort(),
  });
  const api = chatsCommands(ctx) as unknown as Record<string, Fn>;
  const both = async (actor: string, name: keyof ChatsApi, ...args: unknown[]) => {
    who = actor;
    const run = async (f: () => unknown) => {
      try {
        return { ok: true as const, data: plain(await f()) };
      } catch (e) {
        const err = e as { code?: string; message: string };
        return { ok: false as const, code: err.code, message: err.message };
      }
    };
    const fromRef = await run(async () => {
      const fn = refApi[name];
      if (!fn) throw new Error('нет команды ' + name);
      return ((await fn(...args)) as { data: unknown }).data;
    });
    const mine = await run(() => (api[name] as Fn)(...args));
    return { ref: fromRef, ours: mine };
  };
  return { ref, ours, both };
}

describe('справочники и чистые функции = chats.js', () => {
  it.each([
    'CHAT_KINDS',
    'CHAT_ROLE_LABEL',
    'RANK',
    'CHAT_ROLES',
    'EDIT_LABEL',
    'RCPT_LABEL',
    'TEMP_LABEL',
    'FWD_LABEL',
    'FULL_LABEL',
    'FULL_HINT',
  ])('%s', (name) => {
    const mine: Record<string, unknown> = {
      CHAT_KINDS: D.CHAT_KINDS,
      CHAT_ROLE_LABEL: D.CHAT_ROLE_LABEL,
      RANK: D.RANK,
      CHAT_ROLES: D.CHAT_ROLES,
      EDIT_LABEL: D.EDIT_LABEL,
      RCPT_LABEL: D.RCPT_LABEL,
      TEMP_LABEL: D.TEMP_LABEL,
      FWD_LABEL: D.FWD_LABEL,
      FULL_LABEL: D.FULL_LABEL,
      FULL_HINT: D.FULL_HINT,
    };
    expect(plain(mine[name])).toEqual(plain(C[name]));
  });

  it('EDIT_MIN, пределы: расхождение только в сроке удалённых (CHAT-10)', () => {
    expect(Object.entries(D.EDIT_MIN)).toEqual(Object.entries(C['EDIT_MIN'] as object));
    expect({ ...D.BOUNDS, delD: [0, 90] }).toEqual(C['BOUNDS']);
    expect(D.BOUNDS.delD).toEqual([30, 30]);
  });

  it('DEFAULT_POLICY: расхождение только в режиме прочтения групп, областей и записей (CHAT-02)', () => {
    const ref = C['DEFAULT_POLICY'] as Record<string, { rcpt: string }>;
    for (const kind of Object.keys(ref)) {
      const same = kind === 'direct' || kind === 'announce';
      expect(ref[kind]?.rcpt).toBe(same ? D.DEFAULT_POLICY[kind as 'direct'].rcpt : 'who');
      expect({ ...ref[kind], rcpt: undefined }).toEqual(
        plain({ ...D.DEFAULT_POLICY[kind as 'direct'], rcpt: undefined }),
      );
    }
  });

  it('время демо', () => {
    for (const ts of [-3000, -1441, -1440, -1, 0, 1, 59, 665, 1439, 1440, 2000, 44_640]) {
      expect(tsDay(ts)).toBe(C.tsDay(ts));
      expect(tsTime(ts)).toBe(C.tsTime(ts));
      for (const now of [0, 665, 1500]) expect(tsLabel(ts, now)).toBe(C.tsLabel(ts, now));
    }
  });

  it('маска ПДн', () => {
    for (const t of [
      'звонить: +7 916 482-31-17.',
      '89161234567',
      '+7 (916) 482-31-17 и 8 916 000 11 22',
      'нет номера',
      '',
      null,
      undefined,
    ]) {
      expect(maskPdn(t)).toBe(C.maskPdn(t));
      expect(hasPdn(t)).toBe(C.hasPdn(t));
      expect(hasPdn(t)).toBe(C.hasPdn(t));
    }
  });

  it('chatMatrix: все виды и режимы политики', () => {
    for (const kind of ['direct', 'group', 'area', 'record', 'announce'] as const) {
      for (const over of [
        {} as Partial<ChatPolicy>,
        { rcpt: 'who' as const },
        {
          rcpt: 'off' as const,
          temp: 'allowed' as const,
          fwd: 'off' as const,
          edit: '15m' as const,
          maxMb: 20,
        },
        { temp: 'viewonce' as const, fwd: 'free' as const, edit: 'none' as const },
      ]) {
        const P = { ...D.DEFAULT_POLICY[kind], ...over };
        expect(plain(chatMatrix(P, kind))).toEqual(plain(C.chatMatrix(P, kind)));
      }
    }
  });
});

describe('сид и состав = chats.js', () => {
  it('чаты «Альты»: сообщения, прочтение, корзины (удержание — с периодом)', () => {
    const { ref, ours } = pair();
    expect(noRange((ours.chats as { items: Chat[] }).items)).toEqual(plain(ref.chats.items));
    expect(ours.chats?.now).toBe(ref.chats.now);
    expect(plain(ours.assignments.filter((a) => a.scope.type === 'chat'))).toEqual(
      plain(
        ref.assignments.filter((a) => (a as { scope: { type: string } }).scope.type === 'chat'),
      ),
    );
    for (const r of ['r-manager', 'r-driver', 'r-foreman', 'r-therapist']) {
      expect(ours.roles.find((x) => x.id === r)?.actions.chat).toEqual(
        ref.roles.find((x) => x.id === r)?.actions['chat'],
      );
    }
    for (const id of [
      'r-chat-owner',
      'r-chat-mod',
      'r-chat-member',
      'r-chat-reader',
      'r-chat-creator',
    ]) {
      expect(plain(ours.roles.find((x) => x.id === id))).toEqual(
        plain(ref.roles.find((x) => x.id === id)),
      );
    }
  });

  it('chatAccess, chatRights, chatPeople для каждого участника и чата', () => {
    const { ref, ours } = pair();
    const strip = (x: unknown) => {
      const o = plain(x) as Record<string, unknown>;
      delete o['vb'];
      return o;
    };
    for (const m of ref.members) {
      for (const c of ref.chats.items) {
        const mine = ours.chats?.items.find((x) => x.id === c.id) as Chat;
        expect(strip(chatAccess(ours, m.id, mine))).toEqual(strip(C.chatAccess(ref, M, m.id, c)));
        expect(strip(chatRights(ours, m.id, mine))).toEqual(strip(C.chatRights(ref, M, m.id, c)));
        expect(chatTitle(ours, mine, m.id)).toBe(C.chatTitle(ref, c, m.id));
      }
    }
    for (const c of ref.chats.items) {
      const mine = ours.chats?.items.find((x) => x.id === c.id) as Chat;
      expect(plain(chatPeople(ours, mine))).toEqual(plain(C.chatPeople(ref, M, c)));
      expect(plain(policyOf(ours, mine))).toEqual(plain(C.policyOf(ref, c)));
      for (const s of mine.sources ?? []) {
        expect(srcLabel(ours, s)).toBe(C.srcLabel(ref, s));
        expect(srcIcon(s)).toBe(C.srcIcon(s));
      }
    }
  });

  it('проекция chatsView для каждого участника (удалённые — без содержимого с обеих сторон)', () => {
    const { ref, ours } = pair();
    for (const m of ref.members) {
      const a = plain(C.chatsView(ref, M, m.id, structuredClone(ref.chats)));
      const b = plain(chatsView(ours, m.id, structuredClone(ours.chats)));
      expect(noRangeView(b)).toEqual(noRangeView(a));
    }
  });
});

function noRangeView(v: unknown): unknown {
  const o = plain(v) as { items: { hold?: { range?: unknown } }[] };
  for (const it of o.items) if (it.hold) delete it.hold.range;
  return o;
}

describe('сценарий команд = chatsApi эталона', () => {
  it('успешный путь: результаты, события и итоговое состояние совпадают', async () => {
    const { ref, ours, both } = runners();
    const refEv0 = ref.events.length;
    const oursEv0 = (ours.events ?? []).length;
    const seq0 = ours.seq;
    expect(ref.seq).toBe(seq0);
    const seqSteps: [string, keyof ChatsApi, ...unknown[]][] = [
      ['m-vasiliev', 'chatOpen', 'ch-drv'],
      ['m-kotova', 'chatSend', 'ch-drv', { text: 'Выезд в 8:00, @Илья смотри график' }],
      [
        'm-kotova',
        'chatSend',
        'ch-drv',
        { poll: { q: 'Кто в субботу?', opts: ['Я', 'Не я', ' '], hours: 3, multi: true } },
      ],
      [
        'm-kotova',
        'chatSend',
        'ch-drv',
        { text: 'Важный регламент', important: true, due: '05.10' },
      ],
      ['m-vasiliev', 'chatVote', 'cm-102', ['o1']],
      [
        'm-vasiliev',
        'chatSend',
        'ch-drv',
        { text: 'Фото осмотра', files: [{ name: 'a.jpg', mb: 4.2, kind: 'photo' }] },
      ],
      ['m-vasiliev', 'chatEdit', 'cm-4', 'Понял, документы забрал'],
      ['m-vasiliev', 'chatEdit', 'cm-4', 'Понял, документы забрал'],
      ['m-kotova', 'chatDelete', 'cm-4', 'Дубль'],
      ['m-vasiliev', 'chatDelete', 'cm-4'],
      ['m-owner', 'chatAck', 'cm-103'],
      ['m-vasiliev', 'chatAck', 'cm-103'],
      ['m-kotelnikova', 'chatAck', 'cm-103'],
      ['m-kotova', 'chatPin', 'cm-6'],
      ['m-kotova', 'chatPollClose', 'cm-6'],
      ['m-owner', 'chatReveal', 'cm-13'],
      ['m-sokolov', 'chatOpenOnce', 'cm-16'],
      ['m-sokolov', 'chatSaveTo', 'cm-12'],
      [
        'm-owner',
        'chatSend',
        'ch-obj42',
        {
          text: 'Договор здесь',
          topic: 'Приёмка',
          doc: { ref: 'doc-1', title: 'Договор', sub: 'v1' },
        },
      ],
      [
        'm-owner',
        'chatSend',
        'ch-obj42',
        { text: 'Файл', files: [{ name: 'F.mov', mb: 500, kind: 'video' }] },
      ],
      ['m-owner', 'chatSetFull', 'ch-obj42', 'ring'],
      [
        'm-owner',
        'chatSend',
        'ch-obj42',
        { text: 'Файл', files: [{ name: 'F.mov', mb: 500, kind: 'video' }] },
      ],
      ['m-owner', 'chatCleanup', 'ch-obj42', ['video90', 'docs30'], true],
      ['m-owner', 'chatCleanup', 'ch-obj42', ['photo180']],
      [
        'm-kotova',
        'chatCreate',
        {
          title: 'Склад',
          unit: 'f-msk-sever',
          sources: [{ who: 'group', ref: 'g-drv', role: 'member' }],
        },
        true,
      ],
      [
        'm-kotova',
        'chatCreate',
        {
          title: 'Склад',
          unit: 'f-msk-sever',
          sources: [
            { who: 'group', ref: 'g-drv', role: 'member' },
            { who: 'member', ref: 'm-vasiliev', role: 'reader' },
          ],
        },
      ],
      ['m-owner', 'chatSources', 'ch-drv', [{ who: 'group', ref: 'g-drv', role: 'member' }], true],
      [
        'm-owner',
        'chatSources',
        'ch-drv',
        [
          { who: 'group', ref: 'g-drv', role: 'member' },
          { who: 'member', ref: 'm-morozova', role: 'reader' },
        ],
      ],
      [
        'm-owner',
        'chatPolicySet',
        'area',
        { rcptD: 14, rcpt: 'who', edit: '15m', maxMb: 150 },
        true,
      ],
      ['m-owner', 'chatPolicySet', 'area', { maxMb: 150, filesD: 100 }],
      ['m-owner', 'chatPolicySet', 'record', { textY: 2 }],
    ];
    for (const [actor, name, ...args] of seqSteps) {
      const r = await both(actor, name, ...args);
      expect({ step: name, ...r.ours }).toEqual({ step: name, ...r.ref });
    }
    expect(noRange((ours.chats as { items: Chat[] }).items)).toEqual(plain(ref.chats.items));
    expect(plain((ours.chats as { policy: unknown }).policy)).toEqual(plain(ref.chats.policy));
    const fresh = <E extends { text: string; to: string[] }>(es: E[], n0: number) =>
      es.slice(0, es.length - n0).map((e) => [e.text, e.to]);
    expect(plain(fresh(ours.events ?? [], oursEv0))).toEqual(plain(fresh(ref.events, refEv0)));
    const chatAssign = (xs: unknown[]) =>
      plain(xs).filter((a) => (a as { id: string }).id.startsWith('ach-'));
    expect(chatAssign(ours.assignments)).toEqual(chatAssign(ref.assignments));
    expect(ours.seq).toBe(ref.seq);
  });

  it('ошибки дословно совпадают с эталоном', async () => {
    const { both } = runners();
    const steps: [string, keyof ChatsApi, ...unknown[]][] = [
      ['m-sokolov', 'chatOpen', 'ch-drv'],
      ['m-owner', 'chatOpen', 'ch-zzz'],
      ['m-vasiliev', 'chatSend', 'ch-drv', { text: '  ' }],
      ['m-vasiliev', 'chatSend', 'ch-drv', { text: 'я'.repeat(4001) }],
      ['m-kotelnikova', 'chatSend', 'ch-drv', { text: 'x' }],
      ['m-kotova', 'chatSend', 'ch-news', { text: 'x' }],
      ['m-vasiliev', 'chatSend', 'ch-drv', { text: 'x', important: true }],
      ['m-vasiliev', 'chatSend', 'ch-drv', { text: 'эй @все' }],
      ['m-vasiliev', 'chatSend', 'ch-drv', { text: 'x', temp: 1 }],
      ['m-owner', 'chatSend', 'ch-obj42', { text: 'x', viewOnce: true }],
      ['m-kotova', 'chatSend', 'ch-drv', { poll: { q: '', opts: ['а', 'б'] } }],
      ['m-kotova', 'chatSend', 'ch-drv', { poll: { q: 'q', opts: ['а'] } }],
      [
        'm-vasiliev',
        'chatSend',
        'ch-drv',
        { files: [{ name: 'Big.mov', mb: 150, kind: 'video' }] },
      ],
      ['m-owner', 'chatSend', 'ch-obj42', { files: [{ name: 'F.mov', mb: 500, kind: 'video' }] }],
      ['m-vasiliev', 'chatEdit', 'cm-3', 'x'],
      ['m-vasiliev', 'chatEdit', 'cm-4', ' '],
      ['m-vasiliev', 'chatDelete', 'cm-3'],
      ['m-kotova', 'chatDelete', 'cm-4'],
      ['m-vasiliev', 'chatAck', 'cm-4'],
      ['m-kotova', 'chatAck', 'cm-5'],
      ['m-vasiliev', 'chatVote', 'cm-4', ['o1']],
      ['m-vasiliev', 'chatVote', 'cm-6', ['zzz']],
      ['m-vasiliev', 'chatVote', 'cm-6', ['o1', 'o2']],
      ['m-vasiliev', 'chatPollClose', 'cm-6'],
      ['m-vasiliev', 'chatPin', 'cm-4'],
      ['m-sokolov', 'chatReveal', 'cm-13'],
      ['m-owner', 'chatOpenOnce', 'cm-16'],
      ['m-vasiliev', 'chatSaveTo', 'cm-4'],
      ['m-kotelnikova', 'chatToTask', 'cm-3'],
      ['m-vasiliev', 'chatCreate', { title: 'Склад' }],
      ['m-kotova', 'chatCreate', { title: 'Склад', unit: 'f-spb-neva' }],
      ['m-kotova', 'chatCreate', { title: 'Склад', unit: 'f-msk-sever', kind: 'announce' }],
      ['m-kotova', 'chatCreate', { title: 'ab', unit: 'f-msk-sever' }],
      [
        'm-kotova',
        'chatCreate',
        {
          title: 'Склад',
          unit: 'f-msk-sever',
          sources: [{ who: 'role', ref: 'r-driver', unit: 'f-msk-yug', role: 'member' }],
        },
      ],
      [
        'm-kotova',
        'chatCreate',
        {
          title: 'Склад',
          unit: 'f-msk-sever',
          sources: [{ who: 'member', ref: 'm-morozova', role: 'member' }],
        },
      ],
      ['m-vasiliev', 'chatSources', 'ch-drv', [], true],
      ['m-vasiliev', 'chatSetFull', 'ch-drv', 'ring'],
      ['m-kotova', 'chatSetFull', 'ch-drv', 'zzz'],
      ['m-owner', 'chatCleanup', 'ch-obj42', []],
      ['m-sokolov', 'chatCleanup', 'ch-obj42', ['video90']],
      ['m-kotova', 'chatPolicySet', 'area', {}, true],
      ['m-owner', 'chatPolicySet', 'zzz', {}, true],
      ['m-owner', 'chatPolicySet', 'area', { maxMb: 5000 }, true],
    ];
    for (const [actor, name, ...args] of steps) {
      const r = await both(actor, name, ...args);
      expect({ step: name, args, ...r.ours }).toEqual({ step: name, args, ...r.ref });
    }
  });

  it('chatToTask: задача с теми же полями; id и проект выбирает домен', async () => {
    const { ref, both } = runners();
    const r = await both('m-kotova', 'chatToTask', 'cm-3');
    expect(r.ref.ok).toBe(true);
    expect(r.ours.ok).toBe(true);
    const refTask = (
      ref['tasks'] as {
        title: string;
        assignee: string;
        links: unknown;
        comments: { text: string }[];
        project: string;
      }[]
    )[0];
    expect(refTask?.project).toBe('fleet');
    expect(refTask?.title).toBe(
      'Завтра с 8:00 мойка на Складе № 1 закрыта — заправляемся и моемся у МКАД.',
    );
    expect(refTask?.links).toEqual([
      { kind: 'chat', id: 'ch-drv', label: 'Чат «Водители · Север Логистик»' },
    ]);
  });
});

describe('намеренные расхождения с эталоном', () => {
  it('PD-60: удалённое сообщение у эталона «воскресает» в проекции (номер, вложения), у домена — нет', async () => {
    const { ref, ours, both } = runners();
    await both('m-owner', 'chatDelete', 'cm-13', 'Номер ошибочный');
    await both('m-owner', 'chatDelete', 'cm-12', 'Дубль фото');
    const view = (v: unknown, id: string) =>
      (v as { items: Chat[] }).items
        .find((c) => c.id === 'ch-obj42')
        ?.msgs.find((m) => m.id === id);
    const refView = C.chatsView(ref, M, 'm-sokolov', structuredClone(ref.chats));
    const myView = chatsView(ours, 'm-sokolov', structuredClone(ours.chats));
    expect(view(refView, 'cm-13')?.text).toContain('+7 ••• •••-••-17');
    expect(view(refView, 'cm-12')?.files).toHaveLength(3);
    expect(view(myView, 'cm-13')?.text).toBe('');
    expect(view(myView, 'cm-12')?.files).toEqual([]);
  });
  it('PD-60: удержание у эталона не защищает сообщение, у домена — защищает', async () => {
    const { ref, ours, both } = runners();
    for (const c of [ref.chats.items, ours.chats?.items ?? []]) {
      const o = c.find((x) => x.id === 'ch-obj42');
      if (o?.hold) delete o.hold.range;
    }
    const r = await both('m-owner', 'chatDelete', 'cm-10', 'x');
    expect(r.ref.ok).toBe(true);
    expect(r.ours).toEqual({
      ok: false,
      code: 'validation',
      message: 'Нельзя удалить: удержание «Претензия по кв. 42» до 01.12',
    });
  });

  it('PD-60: нехватка места у эталона оставляет чат сжатым, у домена — без изменений', async () => {
    const { ref, ours, both } = runners();
    await both('m-owner', 'chatSetFull', 'ch-obj42', 'compress');
    const before = JSON.stringify(ours.chats?.items.find((c) => c.id === 'ch-obj42'));
    const send = {
      files: [1, 2, 3].map((n) => ({ name: 'Part' + String(n) + '.mov', mb: 500, kind: 'video' })),
    };
    const r = await both('m-owner', 'chatSend', 'ch-obj42', send);
    expect(r.ref.ok).toBe(false);
    expect(r.ours.ok).toBe(false);
    expect(JSON.stringify(ours.chats?.items.find((c) => c.id === 'ch-obj42'))).toBe(before);
    expect(
      ref.chats.items.find((c) => c.id === 'ch-obj42')?.buckets?.some((b) => b.compressed),
    ).toBe(true);
  });

  it('PD-60: @все — один разбор, @Имя — только участникам чата', async () => {
    const { ref, ours, both } = runners();
    const oursEv0 = (ours.events ?? []).length;
    await both('m-kotova', 'chatSend', 'ch-drv', { text: 'смотри @всех и @Алексей' });
    expect(ref.events.map((e) => e.text)).toContain(
      'Вас упомянули в «Водители · Север Логистик»: смотри @всех и @Алексей',
    );
    expect(ref.events.some((e) => e.text.includes('упомянул(а) вас'))).toBe(true);
    expect((ours.events ?? []).length).toBe(oursEv0);
  });

  it('CHAT-10 и CHAT-04: пределы и временные сообщения в политике', async () => {
    const { both } = runners();
    const delD = await both('m-owner', 'chatPolicySet', 'area', { delD: 7 }, true);
    expect(delD.ref.ok).toBe(true);
    expect(delD.ours).toMatchObject({
      ok: false,
      message: 'Значение вне пределов организации: 30–30',
    });
    const temp = await both('m-owner', 'chatPolicySet', 'area', { temp: 'allowed' }, true);
    expect(temp.ref.ok).toBe(true);
    expect(temp.ours).toMatchObject({
      ok: false,
      message: 'Временные сообщения разрешены только в личных чатах',
    });
  });

  it('сообщение чужого чата неотличимо от несуществующего', async () => {
    const { both } = runners();
    const r = await both('m-sokolov', 'chatEdit', 'cm-4', 'x');
    expect(r.ref).toMatchObject({ ok: false, message: 'Чат не найден или недоступен' });
    expect(r.ours).toMatchObject({ ok: false, message: 'Сообщение не найдено' });
  });

  it('chatTick не переносится', () => {
    const names = Object.keys(
      chatsCommands(
        createModuleCtx({
          getDb: () => ({}) as never,
          getActor: () => null,
          clock: demoClock,
          tasks: createFakeTaskPort(),
        }),
      ),
    );
    expect(names).not.toContain('chatTick');
    expect(names).toHaveLength(17);
  });
});
