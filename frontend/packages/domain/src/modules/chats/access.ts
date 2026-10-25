// Состав и права чатов (chats.js 14.10:63–181) поверх `core/entries`. Состав вычисляется из
// источников: роль в области, группа, связь с записью (прораб объекта, водитель рейса) и сотрудник
// по имени — назначение роли чата с областью «чат». Личные чаты читают только двое участников.
// Права: политика вида чата → роль в чате → модуль «Чаты» в ролях сотрудника → функция «Водитель».
// «Водитель рейса» ядру неизвестен (`core/entries.ts` источник `tripDriver` не знает), его решает
// `srcHas` по `db.trips`; остальные источники — `entryHas` ядра.
import { canAny, grants, moduleOn, scopeCovers } from '../../core/access/index.ts';
import { entryHas, objOf } from '../../core/entries.ts';
import { gb } from '../../core/format.ts';
import type { Entry, ModuleKey } from '../../core/types/index.ts';
import {
  CHAT_KINDS,
  EDIT_LABEL,
  FWD_LABEL,
  RANK,
  RCPT_LABEL,
  TEMP_LABEL,
  makePolicy,
} from './dictionaries.ts';
import type {
  Chat,
  ChatAccess,
  ChatCan,
  ChatPerson,
  ChatPolicy,
  ChatRights,
  ChatRoleKey,
  ChatSource,
  ChatsTenantDb,
  MatrixCell,
  MatrixGroup,
  Verbs,
} from './types.ts';

const mem = (db: ChatsTenantDb, id: string | null | undefined) =>
  db.members.find((m) => m.id === id);
const grp = (db: ChatsTenantDb, id: string | null | undefined) =>
  db.groups?.find((g) => g.id === id);
const roleOf = (db: ChatsTenantDb, id: string | null | undefined) =>
  db.roles.find((r) => r.id === id);
export const unitName = (db: ChatsTenantDb, id: string | null | undefined): string =>
  db.units.find((u) => u.id === id)?.name || 'вся организация';

/** Политика чата: значения вида плюс переопределения чата (в пределах организации). */
export const policyOf = (db: ChatsTenantDb, c: Pick<Chat, 'kind' | 'over'>): ChatPolicy => ({
  ...(db.chats?.policy[c.kind] ?? makePolicy({})),
  ...(c.over ?? {}),
});

// ── Состав и доступ ──

const trips = (db: ChatsTenantDb): { id: string; driverId: string | null }[] =>
  (db as { trips?: { id: string; driverId: string | null }[] }).trips ?? [];

const toEntry = (s: ChatSource): Entry => {
  const e: Entry = { who: s.who as Entry['who'] };
  if (s.ref) e.ref = s.ref;
  if (s.unit) e.unit = s.unit;
  if (s.obj) e.obj = s.obj;
  return e;
};

/** Входит ли сотрудник в источник состава: «водитель рейса» — здесь, остальное — `entryHas` ядра. */
export function srcHas(db: ChatsTenantDb, memberId: string, s: ChatSource): boolean {
  if (s.who === 'tripDriver') {
    const t = trips(db).find((x) => x.id === s.trip);
    return !!t && t.driverId === memberId;
  }
  return entryHas(db, memberId, toEntry(s));
}

export function srcLabel(db: ChatsTenantDb, s: ChatSource): string {
  if (s.who === 'all') return 'Все сотрудники организации';
  if (s.who === 'group') return 'Группа «' + (grp(db, s.ref)?.name ?? s.ref) + '»';
  if (s.who === 'role') {
    return (
      'Роль «' +
      (roleOf(db, s.ref)?.name ?? s.ref) +
      '» · ' +
      (s.unit ? unitName(db, s.unit) : 'вся организация')
    );
  }
  if (s.who === 'relation') {
    const o = objOf(db, s.obj ?? undefined);
    return 'Прораб объекта' + (o ? ' «' + o.name + '»' : '');
  }
  if (s.who === 'tripDriver') return 'Водитель рейса ' + String(s.trip);
  if (s.who === 'member') return mem(db, s.ref)?.name ?? 'Сотрудник';
  return '—';
}

const SRC_ICON: Readonly<Record<string, string>> = {
  all: 'apartment',
  group: 'groups',
  role: 'badge',
  relation: 'engineering',
  tripDriver: 'local_shipping',
  member: 'person',
};
export const srcIcon = (s: ChatSource): string => SRC_ICON[s.who] ?? 'person';

/** Действия модуля «Чаты» во всех ролях сотрудника; владелец бизнеса — все. */
export function chatVerbs(db: ChatsTenantDb, memberId: string): Verbs {
  const gs = grants(db, memberId);
  if (gs.some((g) => g.roleObj.all)) return { all: true, has: () => true };
  const set = new Set<string>();
  for (const g of gs) for (const v of g.roleObj.actions.chat ?? []) set.add(v);
  return { all: false, has: (v) => set.has(v) };
}

/** Назначения роли чата «по имени» для этого чата. */
const named = (db: ChatsTenantDb, memberId: string, c: Pick<Chat, 'id'>) =>
  grants(db, memberId).filter(
    (g) => g.scope.type === 'chat' && g.scope.id === c.id && g.roleObj.chatRole,
  );

const higher = (cur: ChatRoleKey | null, r: ChatRoleKey): ChatRoleKey =>
  !cur || RANK[r] > RANK[cur] ? r : cur;

/** Доступ сотрудника к чату с цепочкой причин: состав → модуль в роли → функция → приглашение. */
export function chatAccess(db: ChatsTenantDb, memberId: string, c: Chat): ChatAccess {
  const m = mem(db, memberId);
  const chain: ChatAccess['chain'] = [];
  const no = (
    reason: NonNullable<ChatAccess['reason']>,
    why: string,
    extra?: Partial<ChatAccess>,
  ): ChatAccess => ({ ok: false, role: null, reason, why, chain, via: [], ...extra });
  if (!m) return no('none', 'Сотрудник не найден');
  if (m.status === 'blocked') {
    return no(
      'blocked',
      'Заблокирован владельцем — не входит в чаты; вернётся сам, если разблокируют',
    );
  }
  if (c.record?.module && !moduleOn(db, c.record.module as ModuleKey)) {
    return no('module_off', 'Модуль записи не подключён');
  }
  const vb = chatVerbs(db, memberId);
  let role: ChatRoleKey | null = null;
  const via: string[] = [];
  if (c.kind === 'direct') {
    if (!(c.pair ?? []).includes(memberId)) {
      return no('not_member', 'Личный чат читают только двое участников');
    }
    role = 'member';
    via.push('Участник личного чата');
  } else {
    for (const s of c.sources ?? []) {
      if (srcHas(db, memberId, s)) {
        via.push(srcLabel(db, s));
        role = higher(role, s.role);
      }
    }
    for (const g of named(db, memberId, c)) {
      via.push(g.roleObj.name + ' · по имени');
      role = higher(role, g.roleObj.chatRole as ChatRoleKey);
    }
    if (vb.all) {
      if (!role) via.push('Владелец бизнеса · видит все рабочие чаты');
      role = 'owner';
    }
  }
  chain.push({
    t: 'Состав чата',
    d: via.length ? via.join(' · ') : 'Ни один источник состава не подходит',
    ok: !!role,
  });
  if (!role) return no('not_member', 'Не входит в состав чата');
  const modOk = vb.all || vb.has('view');
  chain.push({
    t: 'Модуль «Чаты» в ролях',
    d: vb.all
      ? 'Владелец бизнеса'
      : modOk
        ? 'Есть право «Чаты · Просматривать»'
        : 'Ни в одной роли нет модуля «Чаты»',
    ok: modOk,
  });
  if (!modOk) {
    return no(
      'no_module',
      'У ролей сотрудника нет модуля «Чаты»: разрешите его в роли или добавьте по имени',
      { role, via },
    );
  }
  const fin = c.sensitivity === 'finance' && m.function === 'driver';
  chain.push({
    t: 'Функция',
    d:
      m.function === 'driver'
        ? 'Водитель: ПДн под маской, финансовые чаты закрыты'
        : 'Ограничений нет',
    ok: !fin,
  });
  if (fin) {
    return no('function', 'Функция «Водитель»: чаты с меткой «Финансы» закрыты', { role, via });
  }
  if (m.status === 'invited') {
    return {
      ok: false,
      pending: true,
      role,
      reason: 'invited',
      why: 'Войдёт, когда примет приглашение в организацию',
      via,
      chain,
    };
  }
  return { ok: true, role, via, chain, owner: vb.all };
}

type RightsAccess = ChatAccess & { vb?: Verbs };

/** Доступ с набором действий участника: нужен командам и проекции (`vb` — служебное поле). */
function accessWithVerbs(db: ChatsTenantDb, memberId: string, c: Chat): RightsAccess {
  const a = chatAccess(db, memberId, c);
  return a.ok ? { ...a, vb: chatVerbs(db, memberId) } : a;
}

/** Что сотрудник может в чате: роль в чате и политика вида. */
export function chatRights(db: ChatsTenantDb, memberId: string, c: Chat): ChatRights {
  const a = accessWithVerbs(db, memberId, c);
  const P = policyOf(db, c);
  if (!a.ok || !a.role || !a.vb) return { ...a, can: {}, P };
  const { vb } = a;
  const r = RANK[a.role];
  const own = !!a.owner;
  const arch = c.status === 'archived';
  const write = !arch && (c.kind === 'announce' ? r >= 3 : r >= 2) && (own || vb.has('create'));
  const mod = r >= 3;
  const can: ChatCan = {
    write,
    files: write,
    polls: write,
    mod,
    pin: mod,
    announce: write && mod && (own || vb.has('review')),
    receipts: P.rcpt === 'who' && r >= 2,
    pdn: own,
    temp: write && P.temp === 'allowed',
    viewOnce: write && mod && P.temp !== 'off',
    members: c.kind !== 'direct' && (a.role === 'owner' || (mod && (own || vb.has('review')))),
    settings: c.kind !== 'direct' && (a.role === 'owner' || own),
    saveTo: write && !!c.record,
    task: write && canAny(db, memberId, 'tasks', 'create').ok,
  };
  return { ...a, can, P };
}

/** Кто в чате и почему: для «Участников» и предпросмотра состава. */
export function chatPeople(db: ChatsTenantDb, c: Chat): ChatPerson[] {
  const out: ChatPerson[] = [];
  for (const m of db.members) {
    const base = { id: m.id, name: m.name, title: m.title ?? '' };
    const a = chatAccess(db, m.id, c);
    if (a.ok) {
      out.push({ ...base, st: 'in', role: a.role, via: a.via.join(' · ') });
    } else if (a.pending) {
      out.push({ ...base, st: 'pending', role: a.role, via: a.via.join(' · '), why: a.why });
    } else if (a.role) {
      out.push({ ...base, st: 'out', role: a.role, why: a.why });
    } else if (c.kind !== 'direct') {
      // Не вошёл без роли в чате — показываем, только если на него указывает источник: группа,
      // роль в области или назначение по имени.
      const hit =
        (c.sources ?? []).some(
          (s) =>
            (s.who === 'group' && !!grp(db, s.ref)?.members.includes(m.id)) ||
            (s.who === 'role' &&
              db.assignments.some(
                (x) =>
                  x.member === m.id &&
                  x.role === s.ref &&
                  (!s.unit || scopeCovers(db, x.scope, s.unit)),
              )) ||
            (s.who === 'member' && s.ref === m.id),
        ) ||
        db.assignments.some(
          (x) => x.member === m.id && x.scope.type === 'chat' && x.scope.id === c.id,
        );
      if (hit) out.push({ ...base, st: 'out', why: a.why });
    }
  }
  return out;
}

/** Матрица «роль в чате × действие» для вкладки «Права». */
export function chatMatrix(P: ChatPolicy, kind: Chat['kind']): MatrixGroup[] {
  const y: MatrixCell = 'y';
  const n: MatrixCell = 'n';
  const l: MatrixCell = 'l';
  const ann = kind === 'announce';
  const writers: MatrixCell[] = ann ? [y, y, n, n] : [y, y, y, n];
  const locked: MatrixCell[] = [l, l, l, l];
  return [
    [
      'Сообщения',
      [
        ['Писать сообщения', writers, ann ? 'В объявлениях пишут модераторы' : ''],
        ['Файлы и медиа', writers, 'До ' + gb(P.maxMb) + ' · фото сжимаются'],
        ['Создавать опросы', writers, 'Читатель голосует'],
        ['Важное с подтверждением и @все', [y, y, n, n], 'Нужно право «Чаты · Решать» в роли'],
        [
          'Править свои сообщения',
          writers,
          EDIT_LABEL[P.edit] + ' · история правок видна участникам',
        ],
      ],
    ],
    [
      'Участники и модерация',
      [
        ['Добавлять сотрудников по имени', [y, y, n, n], 'Только своей области'],
        ['Удалять чужие сообщения', [y, y, n, n], 'С причиной, её видно в чате'],
        ['Закреплять', [y, y, n, n], ''],
      ],
    ],
    [
      'Чтение и защита',
      [
        [
          'Видеть, кто и когда прочитал',
          P.rcpt === 'who' ? [y, y, y, n] : locked,
          'Режим: ' + RCPT_LABEL[P.rcpt],
        ],
        [
          'Видеть ПДн без маски',
          locked,
          'Только право «ПДн без маски»; функции «Водитель» — никогда',
        ],
        ['Временные сообщения', P.temp === 'allowed' ? writers : locked, TEMP_LABEL[P.temp]],
        [
          'Одноразовые файлы',
          P.temp === 'off' ? locked : [y, y, n, n],
          'Удаляются через 24 часа после открытия',
        ],
        ['Пересылка', P.fwd === 'off' ? locked : [y, y, y, y], FWD_LABEL[P.fwd]],
      ],
    ],
  ];
}

/** Название чата для участника: у личного — имя собеседника. */
export function chatTitle(
  db: ChatsTenantDb,
  c: Pick<Chat, 'kind' | 'title' | 'pair'>,
  actor: string | null,
): string {
  if (c.kind !== 'direct') return c.title ?? CHAT_KINDS[c.kind].one;
  const pair = c.pair ?? [];
  const other = pair.find((k) => k !== actor) ?? pair[0];
  return mem(db, other)?.name ?? 'Личный чат';
}
