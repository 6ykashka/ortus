// Сид чатов (chats.js 14.10:183–273): «Альта» — 6 чатов, «Лотос» — 2; роли и назначения, прочтение,
// удержание, идемпотентность. Время — минуты от 01.10 (T(день, 'чч:мм')).
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, CHAT_ROLES } from './dictionaries.ts';
import { chatOf, chatsAlta, chatsLotos, msgOf, slice } from './fixture.test-util.ts';
import { chatsHook, chatsSeed, installChats } from './seed.ts';
import type { ChatsTenantDb } from './types.ts';

const T = (d: number, t: string): number => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return d * 1440 + h * 60 + m;
};

describe('chatsSeed', () => {
  it('«Альта»: шесть чатов в порядке эталона', () => {
    const db = chatsAlta({ raw: true });
    const x = chatsSeed(db);
    expect(x.chats.map((c) => c.id)).toEqual([
      'ch-news',
      'ch-drv',
      'ch-trip',
      'ch-obj42',
      'ch-dkv',
      'ch-dzs',
    ]);
    expect(x.chats.map((c) => c.kind)).toEqual([
      'announce',
      'area',
      'record',
      'record',
      'direct',
      'direct',
    ]);
    expect(x.chats.map((c) => c.msgs.length)).toEqual([2, 5, 2, 8, 3, 2]);
    expect(x.assign.map((a) => a.id)).toEqual(['ach-1', 'ach-2', 'ach-3', 'ach-4']);
  });

  it('«Лотос»: новости салона и мастера Тверской, без назначений', () => {
    const x = chatsSeed({ tenantId: 't-lotos' } as ChatsTenantDb);
    expect(x.chats.map((c) => [c.id, c.kind, c.title, c.unit])).toEqual([
      ['ch-news', 'announce', 'Новости салона', null],
      ['ch-tver', 'area', 'Мастера · Тверская', 'f-lotos-tver'],
    ]);
    expect(x.chats[0]?.msgs[0]?.important).toEqual({ due: '15.10', acks: [] });
    expect(x.assign).toEqual([]);
  });

  it('время сообщений — минуты от 01.10', () => {
    const x = chatsSeed(chatsAlta({ raw: true }));
    const drv = x.chats[1];
    expect(drv?.msgs.map((m) => m.ts)).toEqual([
      T(-1, '18:10'),
      T(-1, '18:24'),
      T(0, '08:05'),
      T(0, '08:30'),
      T(0, '09:12'),
    ]);
  });

  it('чат объекта: имя и подразделение объекта ремонта, договор из документов', () => {
    const db = chatsAlta({ raw: true, modules: true, docs: true });
    const obj = chatsSeed(db).chats.find((c) => c.id === 'ch-obj42');
    expect(obj?.title).toBe('ЖК Речной · квартира 42');
    expect(obj?.unit).toBe('f-msk-sever');
    const withDoc = obj?.msgs.find((m) => m.doc);
    expect(withDoc?.doc).toEqual({
      kind: 'doc',
      ref: 'doc-42',
      title: 'Договор подряда 42/26',
      sub: 'Документы · v2',
    });
  });

  it('без ремонта и документов: имя по умолчанию, подразделения нет, вложения-документа нет', () => {
    const obj = chatsSeed(chatsAlta({ raw: true })).chats.find((c) => c.id === 'ch-obj42');
    expect(obj?.title).toBe('ЖК Речной · квартира 42');
    expect(obj?.unit).toBeNull();
    expect(obj?.msgs.find((m) => m.text.startsWith('Договор согласовали'))?.doc).toBeNull();
  });
});

describe('installChats', () => {
  const alta = (): ChatsTenantDb => chatsAlta({ modules: true, docs: true });

  it('добавляет пять ролей чатов один раз', () => {
    const db = alta();
    for (const r of CHAT_ROLES) expect(db.roles.filter((x) => x.id === r.id)).toHaveLength(1);
  });

  it('роли шаблонов получают модуль «Чаты» только если его не было', () => {
    const db = alta();
    const role = (id: string) => db.roles.find((r) => r.id === id);
    expect(role('r-manager')?.actions.chat).toEqual(['view', 'create', 'edit', 'review']);
    expect(role('r-driver')?.actions.chat).toEqual(['view', 'create']);
    expect(role('r-foreman')?.actions.chat).toEqual(['view', 'create']);
    expect(role('r-therapist')?.actions.chat).toEqual(['view', 'create']);
    const custom = chatsAlta({ raw: true });
    const driver = custom.roles.find((r) => r.id === 'r-driver');
    if (driver) driver.actions = { ...driver.actions, chat: ['view'] };
    installChats(custom);
    expect(custom.roles.find((r) => r.id === 'r-driver')?.actions.chat).toEqual(['view']);
  });

  it('назначения ach-1…ach-4: по имени и «создаёт группы»', () => {
    const db = alta();
    const a = (id: string) => db.assignments.find((x) => x.id === id);
    expect(a('ach-1')).toEqual({
      id: 'ach-1',
      member: 'm-kotova',
      role: 'r-chat-owner',
      scope: { type: 'chat', id: 'ch-drv' },
    });
    expect(a('ach-2')?.role).toBe('r-chat-reader');
    expect(a('ach-3')).toMatchObject({
      member: 'm-ilyin',
      scope: { type: 'chat', id: 'ch-obj42' },
    });
    expect(a('ach-4')).toMatchObject({
      member: 'm-kotova',
      role: 'r-chat-creator',
      scope: { type: 'firm', id: 'f-msk-sever' },
    });
  });

  it('назначение не создаётся, если сотрудника нет в организации', () => {
    const raw = chatsAlta({ raw: true });
    raw.members = raw.members.filter((m) => m.id !== 'm-ilyin');
    installChats(raw);
    expect(raw.assignments.some((a) => a.id === 'ach-3')).toBe(false);
    expect(raw.assignments.some((a) => a.id === 'ach-1')).toBe(true);
  });

  it('срез: now = 665, политики — копия справочника, чаты с расчётными полями', () => {
    const s = slice(alta());
    expect(s.v1).toBe(true);
    expect(s.now).toBe(665);
    expect(s.policy).toEqual(DEFAULT_POLICY);
    expect(s.policy.group).not.toBe(DEFAULT_POLICY.group);
    const drv = chatOf(alta(), 'ch-drv');
    expect(drv.seq).toBe(5);
    expect(drv.last).toBe(T(0, '09:12'));
    expect(drv.usedMb).toBe(840);
    expect(drv.status).toBe('active');
    expect(drv.sensitivity).toBe('normal');
    expect(drv.journal).toEqual([]);
    expect(drv.msgs.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(chatOf(alta(), 'ch-dkv').usedMb).toBe(0);
  });

  it('прочтение: отметки до lastRead, у своих сообщений — время отправки, у служебных — нет', () => {
    const drv = chatOf(alta(), 'ch-drv');
    expect(drv.lastRead).toEqual({ 'm-kotova': 5, 'm-vasiliev': 2, 'm-kotelnikova': 4 });
    const [m1, m2, m3, m4, m5] = drv.msgs;
    expect(m1?.reads['m-kotova']).toBe(m1?.ts);
    // сообщение 1 прочитали Васильев и Котельникова: ts + 2 + (i % 5), i = 0
    expect(m1?.reads['m-vasiliev']).toBe((m1?.ts ?? 0) + 2);
    expect(m2?.reads['m-kotova']).toBe((m2?.ts ?? 0) + 2 + 1);
    expect(m3?.reads['m-vasiliev']).toBeUndefined();
    expect(m3?.reads['m-kotelnikova']).toBe((m3?.ts ?? 0) + 2 + 2);
    expect(m4?.reads['m-kotelnikova']).toBe((m4?.ts ?? 0) + 2 + 3);
    expect(m5?.by).toBe('sys');
    expect(Object.keys(m5?.reads ?? {})).not.toContain('sys');
  });

  it('важное, опрос, служебная карточка, спойлер и одноразовый файл сохранены', () => {
    const db = alta();
    const drv = chatOf(db, 'ch-drv');
    expect(drv.msgs[2]?.important).toEqual({ due: '03.10', acks: [] });
    const poll = drv.msgs[3]?.poll;
    expect(poll?.q).toBe('Кто может выйти в субботу 04.10 на рейс Р-215?');
    expect(poll?.opts.map((o) => o.id)).toEqual(['o1', 'o2', 'o3']);
    expect(poll?.closes).toBe(T(2, '18:00'));
    expect(poll?.closesLabel).toBe('03.10 в 18:00');
    expect(drv.msgs[4]?.sys).toMatchObject({ tone: 'danger', nav: 'fleet' });
    const obj = chatOf(db, 'ch-obj42');
    const pass = obj.msgs.find((m) => m.spoiler === 'Код домофона на ноябрь: 0420');
    expect(pass?.files?.[0]).toMatchObject({ viewOnce: true, opened: {}, kind: 'doc' });
    const dkv = chatOf(db, 'ch-dkv');
    expect(dkv.msgs[2]?.temp).toEqual({ exp: T(1, '07:55'), h: 24 });
    expect(dkv.pair).toEqual(['m-kotova', 'm-vasiliev']);
  });

  it('чат объекта: темы, удержание по периоду 01.09–15.09, корзины, источник «прораб»', () => {
    const obj = chatOf(alta(), 'ch-obj42');
    expect(obj.topics).toEqual(['Общее', 'Снабжение', 'Приёмка', 'Допработы']);
    expect(obj.hold).toEqual({
      reason: 'Претензия по кв. 42',
      period: '01.09–15.09',
      until: '01.12',
      by: 'm-owner',
      files: 6,
      range: { from: T(-30, '00:00'), to: T(-15, '00:00') - 1 },
    });
    expect(obj.buckets).toHaveLength(7);
    expect(obj.buckets?.find((b) => b.hold)).toMatchObject({ id: 'b7', n: 6, mb: 200 });
    expect(obj.sources).toEqual([{ who: 'relation', obj: 'obj-42', role: 'member' }]);
    expect(obj.usedMb).toBe(4600);
    expect(obj.savedMb).toBe(1100);
    expect(obj.record).toMatchObject({ kind: 'object', module: 'repair' });
  });

  it('идемпотентность: повторная установка ничего не меняет', () => {
    const db = alta();
    const before = JSON.stringify(db);
    installChats(db);
    expect(JSON.stringify(db)).toBe(before);
  });

  it('«Лотос»: два чата, у сообщений владельца отметка о прочтении автором', () => {
    const db = chatsLotos();
    expect(slice(db).items.map((c) => c.id)).toEqual(['ch-news', 'ch-tver']);
    const news = chatOf(db, 'ch-news');
    expect(msgOf(news, 'cm-1').reads['m-owner']).toBe(msgOf(news, 'cm-1').ts);
    expect(chatOf(db, 'ch-tver').sources).toEqual([
      { who: 'group', ref: 'g-tver', role: 'member' },
    ]);
  });

  it('хук стадии «chats» устанавливает чаты', () => {
    const db = chatsAlta({ raw: true });
    chatsHook(db, { tenantId: 't-alta', clock: { now: () => new Date(0) } });
    expect(slice(db).items).toHaveLength(6);
  });
});
