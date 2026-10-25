// Состав и права чатов (chats.js 14.10:63–181): политика вида, источники состава (core/entries плюс
// «водитель рейса»), цепочка доступа, права в чате, «кто в чате», матрица прав.
import { describe, expect, it } from 'vitest';
import {
  chatAccess,
  chatMatrix,
  chatPeople,
  chatRights,
  chatTitle,
  chatVerbs,
  policyOf,
  srcHas,
  srcIcon,
  srcLabel,
} from './access.ts';
import { DEFAULT_POLICY } from './dictionaries.ts';
import { chatOf, chatsAlta } from './fixture.test-util.ts';
import type { ChatSource, ChatsTenantDb } from './types.ts';

const db = (): ChatsTenantDb => chatsAlta({ modules: true, docs: true });
const access = (mid: string, chat: string, d = db()) => chatAccess(d, mid, chatOf(d, chat));
const rights = (mid: string, chat: string, d = db()) => chatRights(d, mid, chatOf(d, chat));

describe('policyOf: политика вида плюс переопределения чата', () => {
  it('вид «Чат записи»: предел файла, место и одноразовые файлы', () => {
    const d = db();
    expect(policyOf(d, { kind: 'record' })).toMatchObject({
      maxMb: 500,
      quotaMb: 5000,
      temp: 'viewonce',
    });
  });

  it('переопределения чата поверх вида', () => {
    const d = db();
    expect(policyOf(d, { kind: 'group', over: { onFull: 'ring' } }).onFull).toBe('ring');
    expect(policyOf(d, { kind: 'group' }).onFull).toBe('block');
  });

  it('без среза чатов — значения по умолчанию общей политики', () => {
    const raw = chatsAlta({ raw: true });
    expect(policyOf(raw, { kind: 'group' })).toEqual({ ...DEFAULT_POLICY.group, quotaMb: null });
  });
});

describe('источники состава', () => {
  const d = db();
  it.each<[ChatSource, string]>([
    [{ who: 'all', role: 'reader' }, 'Все сотрудники организации'],
    [{ who: 'group', ref: 'g-drv', role: 'member' }, 'Группа «Водители Север»'],
    [{ who: 'group', ref: 'g-zzz', role: 'member' }, 'Группа «g-zzz»'],
    [{ who: 'role', ref: 'r-driver', role: 'member' }, 'Роль «Водитель» · вся организация'],
    [
      { who: 'role', ref: 'r-driver', unit: 'f-msk-sever', role: 'member' },
      'Роль «Водитель» · Север Логистик',
    ],
    [{ who: 'role', ref: 'r-zzz', role: 'member' }, 'Роль «r-zzz» · вся организация'],
    [
      { who: 'relation', obj: 'obj-42', role: 'member' },
      'Прораб объекта «ЖК Речной · квартира 42»',
    ],
    [{ who: 'relation', obj: 'obj-0', role: 'member' }, 'Прораб объекта'],
    [{ who: 'tripDriver', trip: 'Р-208', role: 'member' }, 'Водитель рейса Р-208'],
    [{ who: 'member', ref: 'm-kotova', role: 'member' }, 'Марина Котова'],
    [{ who: 'member', ref: 'm-zzz', role: 'member' }, 'Сотрудник'],
  ])('srcLabel %j = %s', (s, label) => {
    expect(srcLabel(d, s)).toBe(label);
  });

  it('неизвестный источник — «—»', () => {
    expect(srcLabel(d, { who: 'zzz' as ChatSource['who'], role: 'member' })).toBe('—');
  });

  it('иконки источников', () => {
    const w = (who: ChatSource['who']) => srcIcon({ who, role: 'member' });
    expect(
      ['all', 'group', 'role', 'relation', 'tripDriver', 'member'].map((x) => w(x as never)),
    ).toEqual(['apartment', 'groups', 'badge', 'engineering', 'local_shipping', 'person']);
    expect(w('zzz' as never)).toBe('person');
  });

  it('srcHas: водитель рейса — по `trips`, остальное — entryHas ядра', () => {
    const trip: ChatSource = { who: 'tripDriver', trip: 'Р-208', role: 'member' };
    expect(srcHas(d, 'm-vasiliev', trip)).toBe(true);
    expect(srcHas(d, 'm-akhmedov', trip)).toBe(false);
    expect(srcHas(d, 'm-vasiliev', { who: 'tripDriver', trip: 'Р-0', role: 'member' })).toBe(false);
    expect(srcHas(chatsAlta(), 'm-vasiliev', trip)).toBe(false);
    expect(srcHas(d, 'm-kotova', { who: 'group', ref: 'g-disp', role: 'member' })).toBe(true);
    expect(srcHas(d, 'm-sokolov', { who: 'relation', obj: 'obj-42', role: 'member' })).toBe(true);
    expect(srcHas(d, 'm-gromov', { who: 'all', role: 'reader' })).toBe(false);
    expect(
      srcHas(d, 'm-vasiliev', {
        who: 'role',
        ref: 'r-driver',
        unit: 'f-msk-sever',
        role: 'member',
      }),
    ).toBe(true);
    expect(srcHas(d, 'm-owner', { who: 'member', ref: 'm-owner', role: 'member' })).toBe(true);
  });
});

describe('chatVerbs: действия модуля «Чаты» участника', () => {
  it('владелец бизнеса — всё; остальные — объединение ролей', () => {
    const d = db();
    expect(chatVerbs(d, 'm-owner').all).toBe(true);
    expect(chatVerbs(d, 'm-owner').has('anything')).toBe(true);
    const k = chatVerbs(d, 'm-kotova');
    expect(k.all).toBe(false);
    expect(['view', 'create', 'edit', 'review', 'settings', 'export'].map((v) => k.has(v))).toEqual(
      [true, true, true, true, true, false],
    );
    expect(chatVerbs(d, 'm-petrova').has('view')).toBe(false);
  });
});

describe('chatAccess: состав → модуль → функция → приглашение', () => {
  it('нет сотрудника', () => {
    expect(access('m-zzz', 'ch-drv')).toMatchObject({
      ok: false,
      role: null,
      reason: 'none',
      why: 'Сотрудник не найден',
    });
  });

  it('заблокированный не входит никуда', () => {
    expect(access('m-gromov', 'ch-drv')).toMatchObject({
      ok: false,
      reason: 'blocked',
      why: 'Заблокирован владельцем — не входит в чаты; вернётся сам, если разблокируют',
    });
  });

  it('модуль записи выключен — чат записи недоступен', () => {
    const off = chatsAlta();
    expect(access('m-vasiliev', 'ch-trip', off)).toMatchObject({
      ok: false,
      reason: 'module_off',
      why: 'Модуль записи не подключён',
    });
    expect(access('m-vasiliev', 'ch-trip').ok).toBe(true);
  });

  it('личный чат читают только двое; владелец бизнеса чужой личный не читает', () => {
    expect(access('m-vasiliev', 'ch-dzs')).toMatchObject({
      ok: false,
      reason: 'not_member',
      why: 'Личный чат читают только двое участников',
    });
    expect(access('m-owner', 'ch-dkv').ok).toBe(false);
    const a = access('m-kotova', 'ch-dkv');
    expect(a).toMatchObject({ ok: true, role: 'member', via: ['Участник личного чата'] });
  });

  it('водитель — участник по роли в области и группе; цепочка из трёх шагов', () => {
    const a = access('m-vasiliev', 'ch-drv');
    expect(a.ok).toBe(true);
    expect(a.role).toBe('member');
    expect(a.owner).toBe(false);
    expect(a.via).toEqual(['Роль «Водитель» · Север Логистик', 'Группа «Водители Север»']);
    expect(a.chain).toEqual([
      {
        t: 'Состав чата',
        d: 'Роль «Водитель» · Север Логистик · Группа «Водители Север»',
        ok: true,
      },
      { t: 'Модуль «Чаты» в ролях', d: 'Есть право «Чаты · Просматривать»', ok: true },
      { t: 'Функция', d: 'Водитель: ПДн под маской, финансовые чаты закрыты', ok: true },
    ]);
  });

  it('высшая роль из источников и назначений по имени', () => {
    const k = access('m-kotova', 'ch-drv');
    expect(k.role).toBe('owner');
    expect(k.via).toEqual(['Группа «Диспетчеры Север»', 'Владелец чата · по имени']);
    expect(access('m-kotelnikova', 'ch-drv')).toMatchObject({
      ok: true,
      role: 'reader',
      via: ['Читатель чата · по имени'],
    });
  });

  it('владелец бизнеса видит все рабочие чаты как владелец', () => {
    const o = access('m-owner', 'ch-drv');
    expect(o).toMatchObject({
      ok: true,
      role: 'owner',
      owner: true,
      via: ['Владелец бизнеса · видит все рабочие чаты'],
    });
    expect(o.chain[1]).toEqual({
      t: 'Модуль «Чаты» в ролях',
      d: 'Владелец бизнеса',
      ok: true,
    });
  });

  it('не входит в состав', () => {
    const a = access('m-sokolov', 'ch-drv');
    expect(a).toMatchObject({
      ok: false,
      role: null,
      reason: 'not_member',
      why: 'Не входит в состав чата',
    });
    expect(a.chain).toEqual([
      { t: 'Состав чата', d: 'Ни один источник состава не подходит', ok: false },
    ]);
  });

  it('в составе, но модуля «Чаты» нет ни в одной роли', () => {
    const a = access('m-petrova', 'ch-drv');
    expect(a).toMatchObject({
      ok: false,
      role: 'moderator',
      reason: 'no_module',
      why: 'У ролей сотрудника нет модуля «Чаты»: разрешите его в роли или добавьте по имени',
    });
    expect(a.via).toEqual(['Группа «Диспетчеры Север»']);
    expect(a.chain[1]).toEqual({
      t: 'Модуль «Чаты» в ролях',
      d: 'Ни в одной роли нет модуля «Чаты»',
      ok: false,
    });
  });

  it('водителю закрыты чаты с меткой «Финансы»', () => {
    const d = db();
    chatOf(d, 'ch-drv').sensitivity = 'finance';
    expect(access('m-vasiliev', 'ch-drv', d)).toMatchObject({
      ok: false,
      role: 'member',
      reason: 'function',
      why: 'Функция «Водитель»: чаты с меткой «Финансы» закрыты',
    });
    expect(access('m-kotova', 'ch-drv', d).ok).toBe(true);
  });

  it('приглашённый: войдёт после принятия приглашения', () => {
    const a = access('m-ilyin', 'ch-obj42');
    expect(a).toMatchObject({
      ok: false,
      pending: true,
      role: 'reader',
      reason: 'invited',
      why: 'Войдёт, когда примет приглашение в организацию',
      via: ['Читатель чата · по имени'],
    });
  });

  it('прораб объекта и водитель рейса входят по связи с записью', () => {
    expect(access('m-sokolov', 'ch-obj42')).toMatchObject({
      ok: true,
      role: 'member',
      via: ['Прораб объекта «ЖК Речной · квартира 42»'],
    });
    expect(access('m-vasiliev', 'ch-trip')).toMatchObject({
      ok: true,
      via: ['Водитель рейса Р-208'],
    });
    expect(access('m-akhmedov', 'ch-trip').reason).toBe('not_member');
  });

  it('чат без `sources` и без назначений — не входит', () => {
    const d = db();
    const c = chatOf(d, 'ch-news');
    delete c.sources;
    expect(chatAccess(d, 'm-kotova', c).reason).toBe('not_member');
  });
});

describe('chatRights: что можно в чате', () => {
  it('недоступный чат: права пусты, политика вида на месте', () => {
    const r = rights('m-sokolov', 'ch-drv');
    expect(r.ok).toBe(false);
    expect(r.can).toEqual({});
    expect(r.P.maxMb).toBe(100);
  });

  it('владелец чата (Котова): всё, кроме ПДн без маски, временных и записи', () => {
    const r = rights('m-kotova', 'ch-drv');
    expect(r.can).toEqual({
      write: true,
      files: true,
      polls: true,
      mod: true,
      pin: true,
      announce: true,
      receipts: false,
      pdn: false,
      temp: false,
      viewOnce: false,
      members: true,
      settings: true,
      saveTo: false,
      task: true,
    });
  });

  it('участник (водитель): пишет и создаёт задачи, не модерирует', () => {
    const r = rights('m-vasiliev', 'ch-drv');
    expect(r.can).toMatchObject({
      write: true,
      mod: false,
      pin: false,
      announce: false,
      members: false,
      settings: false,
      task: true,
    });
  });

  it('читатель не пишет; в объявлениях пишут модераторы', () => {
    expect(rights('m-kotelnikova', 'ch-drv').can.write).toBe(false);
    expect(rights('m-kotova', 'ch-news').can.write).toBe(false);
    expect(rights('m-owner', 'ch-news').can).toMatchObject({ write: true, announce: true });
  });

  it('владелец бизнеса: ПДн без маски, участники, настройки', () => {
    const r = rights('m-owner', 'ch-drv');
    expect(r.can).toMatchObject({ pdn: true, members: true, settings: true, mod: true });
  });

  it('архив — только чтение', () => {
    const d = db();
    chatOf(d, 'ch-drv').status = 'archived';
    expect(rights('m-kotova', 'ch-drv', d).can).toMatchObject({
      write: false,
      files: false,
      polls: false,
      announce: false,
    });
  });

  it('чат записи: «Сохранить в запись» участнику, одноразовые файлы — модератору', () => {
    expect(rights('m-sokolov', 'ch-obj42').can).toMatchObject({
      write: true,
      saveTo: true,
      viewOnce: false,
      temp: false,
    });
    expect(rights('m-owner', 'ch-obj42').can.viewOnce).toBe(true);
  });

  it('личный чат: временные разрешены политикой, состав и настройки закрыты', () => {
    expect(rights('m-kotova', 'ch-dkv').can).toMatchObject({
      write: true,
      temp: true,
      members: false,
      settings: false,
    });
  });

  it('режим «Кто и когда» в политике открывает отметки участнику и выше', () => {
    const d = db();
    chatOf(d, 'ch-drv').over = { rcpt: 'who' };
    expect(rights('m-vasiliev', 'ch-drv', d).can.receipts).toBe(true);
    expect(rights('m-kotelnikova', 'ch-drv', d).can.receipts).toBe(false);
  });

  it('задача из сообщения — нужно право «Задачи · Создавать» где-либо', () => {
    const d = db();
    d.assignments = d.assignments.filter((a) => a.member !== 'm-kotova' || a.role !== 'r-pm');
    expect(rights('m-kotova', 'ch-drv', d).can.task).toBe(false);
  });
});

describe('chatPeople: кто в чате и почему', () => {
  it('рабочий чат: вошли, не вошли с причиной; посторонние не показываются', () => {
    const d = db();
    const ppl = chatPeople(d, chatOf(d, 'ch-drv'));
    expect(ppl.map((p) => [p.id, p.st, p.role ?? null])).toEqual([
      ['m-owner', 'in', 'owner'],
      ['m-kotova', 'in', 'owner'],
      ['m-vasiliev', 'in', 'member'],
      ['m-petrova', 'out', 'moderator'],
      ['m-gromov', 'out', null],
      ['m-kotelnikova', 'in', 'reader'],
    ]);
    const gromov = ppl.find((p) => p.id === 'm-gromov');
    expect(gromov?.why).toBe(
      'Заблокирован владельцем — не входит в чаты; вернётся сам, если разблокируют',
    );
    expect(ppl[2]).toMatchObject({
      name: 'Илья Васильев',
      title: 'Водитель',
      via: 'Роль «Водитель» · Север Логистик · Группа «Водители Север»',
    });
  });

  it('приглашённый — «ждёт приглашения»', () => {
    const d = db();
    const ppl = chatPeople(d, chatOf(d, 'ch-obj42'));
    expect(ppl.find((p) => p.id === 'm-ilyin')).toMatchObject({
      st: 'pending',
      role: 'reader',
      why: 'Войдёт, когда примет приглашение в организацию',
    });
    expect(ppl.find((p) => p.id === 'm-sokolov')?.st).toBe('in');
  });

  it('личный чат: только двое', () => {
    const d = db();
    expect(chatPeople(d, chatOf(d, 'ch-dkv')).map((p) => p.id)).toEqual(['m-kotova', 'm-vasiliev']);
  });

  it('назначение по имени и участник-источник попадают в список, даже если не вошли', () => {
    const d = db();
    const c = chatOf(d, 'ch-obj42');
    c.sources = [...(c.sources ?? []), { who: 'member', ref: 'm-akhmedov', role: 'member' }];
    d.assignments.push({
      id: 'x1',
      member: 'm-morozova',
      role: 'r-chat-reader',
      scope: { type: 'chat', id: 'ch-obj42' },
    });
    const ppl = chatPeople(d, c);
    expect(ppl.find((p) => p.id === 'm-morozova')?.st).toBe('in');
    expect(ppl.find((p) => p.id === 'm-akhmedov')).toMatchObject({ st: 'out' });
  });
});

describe('chatTitle', () => {
  it('личный чат называется именем собеседника; рабочий — своим названием', () => {
    const d = db();
    expect(chatTitle(d, chatOf(d, 'ch-dkv'), 'm-kotova')).toBe('Илья Васильев');
    expect(chatTitle(d, chatOf(d, 'ch-dkv'), 'm-vasiliev')).toBe('Марина Котова');
    expect(chatTitle(d, chatOf(d, 'ch-drv'), 'm-kotova')).toBe('Водители · Север Логистик');
  });

  it('собеседник не найден — «Личный чат»', () => {
    const d = db();
    expect(chatTitle(d, { id: 'x', kind: 'direct', pair: ['m-zzz'] } as never, 'm-kotova')).toBe(
      'Личный чат',
    );
    expect(chatTitle(d, { id: 'x', kind: 'direct' } as never, 'm-kotova')).toBe('Личный чат');
  });
});

describe('chatMatrix: роль в чате × действие', () => {
  const rows = (kind: 'group' | 'announce', P = DEFAULT_POLICY[kind]) => chatMatrix(P, kind);

  it('три группы строк', () => {
    expect(rows('group').map((g) => g[0])).toEqual([
      'Сообщения',
      'Участники и модерация',
      'Чтение и защита',
    ]);
  });

  it('объявления: писать — модераторы, подпись и предел файла', () => {
    const msgs = rows('announce')[0]?.[1];
    expect(msgs?.[0]).toEqual([
      'Писать сообщения',
      ['y', 'y', 'n', 'n'],
      'В объявлениях пишут модераторы',
    ]);
    expect(msgs?.[1]).toEqual(['Файлы и медиа', ['y', 'y', 'n', 'n'], 'До 50 МБ · фото сжимаются']);
  });

  it('рабочая группа: участник пишет, правка — по политике', () => {
    const msgs = rows('group')[0]?.[1];
    expect(msgs?.[0]).toEqual(['Писать сообщения', ['y', 'y', 'y', 'n'], '']);
    expect(msgs?.[1]?.[2]).toBe('До 200 МБ · фото сжимаются');
    expect(msgs?.[3]).toEqual([
      'Важное с подтверждением и @все',
      ['y', 'y', 'n', 'n'],
      'Нужно право «Чаты · Решать» в роли',
    ]);
    expect(msgs?.[4]).toEqual([
      'Править свои сообщения',
      ['y', 'y', 'y', 'n'],
      '48 часов · история правок видна участникам',
    ]);
  });

  it('чтение и защита зависят от политики', () => {
    const prot = (P: typeof DEFAULT_POLICY.group, kind: 'group' | 'announce' = 'group') =>
      rows(kind, P)[2]?.[1];
    const g = DEFAULT_POLICY.group;
    expect(prot(g)?.[0]).toEqual([
      'Видеть, кто и когда прочитал',
      ['l', 'l', 'l', 'l'],
      'Режим: Галочки',
    ]);
    expect(prot({ ...g, rcpt: 'who' })?.[0]).toEqual([
      'Видеть, кто и когда прочитал',
      ['y', 'y', 'y', 'n'],
      'Режим: Кто и когда',
    ]);
    expect(prot(g)?.[1]?.[1]).toEqual(['l', 'l', 'l', 'l']);
    expect(prot(g)?.[2]).toEqual(['Временные сообщения', ['l', 'l', 'l', 'l'], 'Запрещены']);
    expect(prot({ ...g, temp: 'allowed' })?.[2]?.[1]).toEqual(['y', 'y', 'y', 'n']);
    expect(prot({ ...g, temp: 'allowed' }, 'announce')?.[2]?.[1]).toEqual(['y', 'y', 'n', 'n']);
    expect(prot(g)?.[3]).toEqual([
      'Одноразовые файлы',
      ['l', 'l', 'l', 'l'],
      'Удаляются через 24 часа после открытия',
    ]);
    expect(prot({ ...g, temp: 'viewonce' })?.[3]?.[1]).toEqual(['y', 'y', 'n', 'n']);
    expect(prot(g)?.[4]).toEqual(['Пересылка', ['y', 'y', 'y', 'y'], 'Внутри организации']);
    expect(prot({ ...g, fwd: 'off' })?.[4]?.[1]).toEqual(['l', 'l', 'l', 'l']);
  });
});
