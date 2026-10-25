// Команды состава, хранения и политик чатов (chats.js 14.10:501–580): создание чата и замена
// состава с предпросмотром `dryRun`, режим заполнения, очистка вложений, политики видов.
// Отличия от эталона (бриф W7.10 §10): значения настроек политики проверяются по справочникам;
// временные сообщения в политике — только у личных чатов (CHAT-04), у чатов записей — одноразовые
// файлы (Q-W4.00-chats-4). Проверки идут до изменений.
import { scopeCovers } from '../../core/access/index.ts';
import { gb, pluralN } from '../../core/format.ts';
import type { Assignment } from '../../core/types/index.ts';
import { chatPeople, chatVerbs, unitName } from './access.ts';
import type { ChatsApi, ChatSourceInput, ChatSpec } from './commands.ts';
import { chatsKit } from './commands-kit.ts';
import {
  BOUNDS,
  CHAT_KINDS,
  CHAT_ROLE_ID,
  EDIT_LABEL,
  EDIT_MIN,
  FULL_LABEL,
  FWD_LABEL,
  RANK,
  RCPT_LABEL,
  TEMP_LABEL,
  type BoundKey,
} from './dictionaries.ts';
import { cleanupPlan } from './storage.ts';
import type { ModuleCtx } from '../../core/module.ts';
import type { Chat, ChatPolicy, ChatSource, ChatsTenantDb, SourceWho } from './types.ts';

type AdminApi = Pick<
  ChatsApi,
  'chatCreate' | 'chatSources' | 'chatSetFull' | 'chatCleanup' | 'chatPolicySet'
>;

const SOURCE_WHO: readonly SourceWho[] = [
  'all',
  'group',
  'role',
  'member',
  'relation',
  'tripDriver',
];

const ENUMS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  rcpt: RCPT_LABEL,
  edit: EDIT_LABEL,
  temp: TEMP_LABEL,
  fwd: FWD_LABEL,
  onFull: FULL_LABEL,
};

export function adminCommands(ctx: ModuleCtx): AdminApi {
  const { ApiError } = ctx;
  const K = chatsKit(ctx);
  const { me, meName, X, chat, need, journal, sys } = K;

  const inArea = (db: ChatsTenantDb, all: boolean, unit: string | null): boolean =>
    all ||
    (!!unit &&
      ctx.can
        .grants(db, me())
        .some(
          (g) => (g.roleObj.actions.chat ?? []).includes('edit') && scopeCovers(db, g.scope, unit),
        ));

  const checkSources = (
    db: ChatsTenantDb,
    list: readonly ChatSourceInput[] | undefined,
    unit: string | null,
  ): ChatSource[] => {
    const own = chatVerbs(db, me()).all;
    return (list ?? []).map((s) => {
      if (!SOURCE_WHO.includes(s.who)) {
        throw new ApiError('validation', 'Неизвестный источник состава');
      }
      if (!RANK[s.role]) throw new ApiError('validation', 'Выберите роль в чате');
      if (!own && s.role === 'owner') {
        throw new ApiError('forbidden', 'Владельца чата назначает владелец бизнеса');
      }
      if (!own && s.who === 'all') {
        throw new ApiError('forbidden', '«Все сотрудники» добавляет владелец бизнеса');
      }
      if (!own && s.who === 'role' && !(s.unit && s.unit === unit)) {
        throw new ApiError(
          'forbidden',
          'Роль добавляется только в вашей области «' + unitName(db, unit) + '»',
        );
      }
      if (!own && s.who === 'member') {
        const ok = ctx.can
          .grants(db, s.ref ?? '')
          .some(
            (g) =>
              (['firm', 'region'].includes(g.scope.type) &&
                scopeCovers(db, g.scope, unit ?? undefined)) ||
              (g.scope.type === 'project' &&
                (db.projects ?? []).find((p) => p.id === (g.scope as { id: string }).id)?.unit ===
                  unit),
          );
        if (!ok) {
          throw new ApiError(
            'forbidden',
            (db.members.find((m) => m.id === s.ref)?.name ?? String(s.ref)) +
              ': вне вашей области «' +
              unitName(db, unit) +
              '» — добавить может владелец или руководитель области',
          );
        }
      }
      return {
        who: s.who,
        ref: s.ref || null,
        unit: s.unit || null,
        obj: s.obj || null,
        trip: s.trip || null,
        role: s.role,
      };
    });
  };

  const preview = (db: ChatsTenantDb, c: Chat) => {
    const ppl = chatPeople(db, c);
    return {
      joined: ppl.filter((p) => p.st === 'in'),
      pending: ppl.filter((p) => p.st === 'pending'),
      skipped: ppl.filter((p) => p.st === 'out'),
    };
  };

  const chatAssign = (member: string, role: string, chatId: string, id: string): Assignment => ({
    id,
    member,
    role,
    scope: { type: 'chat', id: chatId },
  });

  return {
    chatCreate: ((spec: ChatSpec, dryRun?: boolean) => {
      const db = K.db();
      const s = spec ?? {};
      const vb = chatVerbs(db, me());
      if (!vb.all && !vb.has('edit')) {
        throw new ApiError(
          'forbidden',
          'Создавать групповые чаты может роль с правом «Чаты · Изменять»',
        );
      }
      const kind =
        s.kind === 'group' || s.kind === 'area' || s.kind === 'announce' ? s.kind : 'group';
      const unit = s.unit ?? null;
      if (!inArea(db, vb.all, unit)) {
        throw new ApiError('forbidden', 'Чат можно создать только в своей области');
      }
      if (kind === 'announce' && !vb.all) {
        throw new ApiError('forbidden', 'Чаты объявлений создаёт владелец бизнеса');
      }
      if (s.label === 'finance' && !vb.all) {
        throw new ApiError('forbidden', 'Метку «Финансы» ставит владелец бизнеса');
      }
      const title = String(s.title ?? '').trim();
      if (!dryRun && title.length < 3) {
        throw new ApiError('validation', 'Название — не короче 3 символов');
      }
      const srcs = checkSources(db, s.sources, unit);
      const draft: Chat = {
        id: 'ch-' + String(ctx.ids.peek()),
        kind,
        title: title || 'Новый чат',
        unit,
        owner: me(),
        sources: srcs.filter((x) => x.who !== 'member'),
        sensitivity: s.label === 'finance' ? 'finance' : s.label === 'pdn' ? 'pdn' : 'normal',
        history: s.history ?? 'all',
        msgs: [],
        seq: 0,
        last: 0,
        usedMb: 0,
        journal: [],
        status: 'active',
        lastRead: {},
      };
      const tmp: Assignment[] = srcs
        .filter((x) => x.who === 'member')
        .map((x, i) => chatAssign(x.ref ?? '', CHAT_ROLE_ID[x.role], draft.id, 'tmp-' + String(i)));
      if (!vb.all) tmp.push(chatAssign(me(), 'r-chat-owner', draft.id, 'tmp-own'));
      const pv = preview({ ...db, assignments: db.assignments.concat(tmp) }, draft);
      if (dryRun) return pv;
      ctx.ids.next('');
      db.assignments.push(...tmp.map((a) => ({ ...a, id: ctx.ids.next('ach-') })));
      X().items.unshift(draft);
      sys(
        draft,
        'Чат создан · ' + meName(),
        CHAT_KINDS[kind].one + (unit ? ' · ' + unitName(db, unit) : ''),
        'add_comment',
        'ok',
      );
      const joined = pv.joined.map((p) => p.id).filter((k) => k !== me());
      if (joined.length) ctx.emit('Вас добавили в чат «' + draft.title + '»', joined);
      return { id: draft.id, ...pv };
    }) as AdminApi['chatCreate'],

    chatSources(id, sources, dryRun) {
      const db = K.db();
      const c = chat(id);
      need(c, 'members', 'Состав меняют владелец чата и модераторы с правом «Чаты · Решать»');
      const srcs = checkSources(db, sources, c.unit ?? null);
      const draft: Chat = { ...c, sources: srcs.filter((x) => x.who !== 'member') };
      const keepNamed = db.assignments.filter(
        (a) => !(a.scope.type === 'chat' && a.scope.id === c.id && a.role !== 'r-chat-owner'),
      );
      const newNamed = srcs
        .filter((x) => x.who === 'member')
        .map((x) =>
          chatAssign(
            x.ref ?? '',
            CHAT_ROLE_ID[x.role],
            c.id,
            'ach-' + String(ctx.ids.peek()) + '-' + String(x.ref),
          ),
        );
      const before = chatPeople(db, c)
        .filter((p) => p.st === 'in')
        .map((p) => p.id);
      const pv = preview({ ...db, assignments: keepNamed.concat(newNamed) }, draft);
      const after = pv.joined.map((p) => p.id);
      const res = {
        ...pv,
        gain: after.filter((k) => !before.includes(k)),
        lose: before.filter((k) => !after.includes(k)),
      };
      if (dryRun) return res;
      c.sources = draft.sources ?? [];
      db.assignments = keepNamed.concat(newNamed);
      ctx.ids.next('');
      const name = (k: string): string => db.members.find((m) => m.id === k)?.name ?? k;
      if (res.gain.length) ctx.emit('Вас добавили в чат «' + c.title + '»', res.gain);
      sys(
        c,
        'Состав изменён · ' + meName(),
        (res.gain.length ? 'Вошли: ' + res.gain.map(name).join(', ') : '') +
          (res.lose.length
            ? (res.gain.length ? ' · ' : '') + 'Вышли: ' + res.lose.map(name).join(', ')
            : '') || 'Состав не изменился',
        'group',
        'neutral',
      );
      return res;
    },

    chatSetFull(id, mode) {
      const c = chat(id);
      need(c, 'settings', 'Менять настройки хранения может владелец чата');
      if (!FULL_LABEL[mode]) throw new ApiError('validation', 'Неизвестный режим');
      c.over = { ...c.over, onFull: mode };
      journal(c, 'При заполнении: ' + FULL_LABEL[mode]);
      return { ok: true };
    },

    chatCleanup(id, filters, dryRun) {
      const c = chat(id);
      const r = need(c, 'settings', 'Очищать чат может его владелец');
      const { res, hit } = cleanupPlan(c, r.P, filters);
      if (dryRun) return res;
      if (!res.n) throw new ApiError('validation', 'Под фильтр ничего не попало');
      c.buckets = (c.buckets ?? []).filter((b) => !hit.includes(b));
      c.usedMb -= res.mb;
      sys(
        c,
        'Вложения удалены очисткой · ' + meName(),
        pluralN(res.n, 'файл', 'файла', 'файлов') +
          ' · ' +
          gb(res.mb) +
          '. Подписи, превью и ответы остались',
        'cleaning_services',
        'warn',
      );
      journal(c, 'Очистка: ' + pluralN(res.n, 'файл', 'файла', 'файлов') + ' · ' + gb(res.mb));
      return res;
    },

    chatPolicySet(kind, patch, dryRun) {
      const db = K.db();
      if (!chatVerbs(db, me()).all) {
        throw new ApiError('forbidden', 'Политики чатов меняет владелец бизнеса');
      }
      if (!(kind in CHAT_KINDS)) throw new ApiError('validation', 'Неизвестный вид чата');
      const p = patch ?? {};
      for (const [k, labels] of Object.entries(ENUMS)) {
        const v = (p as Record<string, unknown>)[k];
        if (v !== undefined && !(typeof v === 'string' && v in labels)) {
          throw new ApiError('validation', 'Неизвестное значение настройки «' + k + '»');
        }
      }
      if (p.temp !== undefined && p.temp !== 'off') {
        const ok = kind === 'direct' || (kind === 'record' && p.temp === 'viewonce');
        if (!ok) {
          throw new ApiError('validation', 'Временные сообщения разрешены только в личных чатах');
        }
      }
      const cur = X().policy[kind];
      const nx: ChatPolicy = { ...cur, ...p };
      for (const [k, [a, b]] of Object.entries(BOUNDS) as [BoundKey, readonly [number, number]][]) {
        if (nx[k] < a || nx[k] > b) {
          throw new ApiError(
            'validation',
            'Значение вне пределов организации: ' + String(a) + '–' + String(b),
          );
        }
      }
      const cs = X().items.filter((c) => c.kind === kind);
      const people = new Set<string>();
      for (const c of cs) {
        for (const x of chatPeople(db, c)) if (x.st === 'in') people.add(x.id);
      }
      const notes: [string, string, string][] = [
        [
          'groups',
          'info',
          pluralN(cs.length, 'чат', 'чата', 'чатов') +
            ' вида «' +
            CHAT_KINDS[kind].label +
            '», ' +
            pluralN(people.size, 'сотрудник', 'сотрудника', 'сотрудников') +
            ': новые значения — сразу',
        ],
      ];
      if (nx.rcptD < cur.rcptD) {
        notes.push([
          'delete_sweep',
          'warn',
          'Отметки прочтения старше ' +
            String(nx.rcptD) +
            ' дней удалятся. Подтверждения важного не затрагиваются',
        ]);
      }
      if (nx.rcpt !== cur.rcpt) {
        notes.push([
          'done_all',
          'info',
          'Прочтение: «' + RCPT_LABEL[cur.rcpt] + '» → «' + RCPT_LABEL[nx.rcpt] + '»',
        ]);
      }
      if (EDIT_MIN[nx.edit] < EDIT_MIN[cur.edit]) {
        notes.push([
          'edit_off',
          'warn',
          'Правка своих — ' +
            EDIT_LABEL[nx.edit] +
            ' вместо ' +
            EDIT_LABEL[cur.edit] +
            ': отправленное раньше уже не правится',
        ]);
      }
      if (nx.filesD < cur.filesD) {
        const mb = cs.reduce(
          (a, c) =>
            a +
            (c.buckets ?? [])
              .filter((b) => !b.hold && b.ageD > nx.filesD)
              .reduce((s, b) => s + b.mb, 0),
          0,
        );
        notes.push([
          'delete',
          'danger',
          'Вложения старше ' +
            String(nx.filesD) +
            ' дней удалятся: около ' +
            gb(mb) +
            '. Сохранённое в запись и под удержанием останется',
        ]);
      }
      if (nx.textY < cur.textY) {
        notes.push([
          'delete',
          'danger',
          'Текст старше ' + String(nx.textY) + ' лет удалится по новому сроку',
        ]);
      }
      if (nx.temp !== cur.temp) {
        notes.push([
          'timer',
          'neutral',
          'Временные: «' + TEMP_LABEL[cur.temp] + '» → «' + TEMP_LABEL[nx.temp] + '»',
        ]);
      }
      if (nx.maxMb !== cur.maxMb) {
        notes.push([
          'attach_file',
          'neutral',
          'Файл до ' + gb(nx.maxMb) + ' вместо ' + gb(cur.maxMb),
        ]);
      }
      if (notes.length === 1) notes.push(['check_circle', 'ok', 'Сообщения и файлы не удаляются']);
      if (dryRun) return { notes };
      X().policy[kind] = nx;
      for (const c of cs) {
        sys(
          c,
          'Политика вида изменена · ' + meName(),
          notes
            .slice(1)
            .map((x) => x[2])
            .join(' · '),
          'policy',
          'neutral',
        );
      }
      return { notes };
    },
  };
}
