// Команды состава, хранения и политик чатов (chats.js 14.10:501–580): создание и состав с
// предпросмотром (dryRun), режим заполнения, очистка вложений, политики видов.
import { describe, expect, it } from 'vitest';
import { apiErr } from './fixture.test-util.ts';
import type { ChatSpec } from './commands.ts';
import { harness } from './harness.test-util.ts';

const forbidden = (message: string) => ({ code: 'forbidden', message });
const invalid = (message: string) => ({ code: 'validation', message });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('chatCreate', () => {
  const spec: ChatSpec = {
    title: 'Склад',
    unit: 'f-msk-sever',
    sources: [{ who: 'group', ref: 'g-drv', role: 'member' }],
  };

  it('dryRun: предпросмотр состава, ничего не создаётся', () => {
    const h = harness('m-kotova');
    const items = h.db.chats?.items.length;
    const seq = h.db.seq;
    const pv = h.api.chatCreate(spec, true);
    expect(ids(pv.joined)).toEqual(['m-owner', 'm-kotova', 'm-vasiliev']);
    expect(pv.pending).toEqual([]);
    expect(ids(pv.skipped)).toEqual(['m-gromov']);
    expect(h.db.chats?.items).toHaveLength(items ?? -1);
    expect(h.db.seq).toBe(seq);
  });

  it('dryRun без названия допустим, имя по умолчанию', () => {
    const h = harness('m-kotova');
    expect(() => h.api.chatCreate({ unit: 'f-msk-sever' }, true)).not.toThrow();
  });

  it('создание: чат первым в списке, владелец по имени, служебное сообщение, событие', () => {
    const h = harness('m-kotova');
    const seq = h.db.seq;
    const r = h.api.chatCreate(spec);
    expect(r.id).toBe('ch-' + String(seq));
    expect(ids(r.joined)).toEqual(['m-owner', 'm-kotova', 'm-vasiliev']);
    const c = h.db.chats?.items[0];
    expect(c).toMatchObject({
      id: r.id,
      kind: 'group',
      title: 'Склад',
      unit: 'f-msk-sever',
      owner: 'm-kotova',
      sources: [{ who: 'group', ref: 'g-drv', unit: null, obj: null, trip: null, role: 'member' }],
      sensitivity: 'normal',
      history: 'all',
      status: 'active',
      usedMb: 0,
    });
    const own = h.db.assignments.find((a) => a.scope.type === 'chat' && a.scope.id === r.id);
    expect(own).toMatchObject({ member: 'm-kotova', role: 'r-chat-owner' });
    expect(own?.id).toMatch(/^ach-\d+$/);
    expect(c?.msgs[0]?.sys).toMatchObject({
      title: 'Чат создан · Марина Котова',
      text: 'Рабочая группа · Север Логистик',
      icon: 'add_comment',
      tone: 'ok',
      mod: 'Чаты',
    });
    expect(h.events()[0]).toMatchObject({
      text: 'Вас добавили в чат «Склад»',
      to: ['m-owner', 'm-vasiliev'],
    });
  });

  it('сотрудники по имени становятся назначениями роли чата, а не источниками', () => {
    const h = harness('m-kotova');
    const r = h.api.chatCreate({
      ...spec,
      sources: [{ who: 'member', ref: 'm-vasiliev', role: 'reader' }],
    });
    expect(h.db.chats?.items[0]?.sources).toEqual([]);
    const named = h.db.assignments.filter((a) => a.scope.type === 'chat' && a.scope.id === r.id);
    expect(named.map((a) => [a.member, a.role]).sort()).toEqual([
      ['m-kotova', 'r-chat-owner'],
      ['m-vasiliev', 'r-chat-reader'],
    ]);
  });

  it('владелец бизнеса: объявления, метка «Финансы», без назначения владельца', () => {
    const h = harness('m-owner');
    const r = h.api.chatCreate({
      kind: 'announce',
      title: 'Объявления Юг',
      label: 'finance',
      history: 'new',
      sources: [{ who: 'all', role: 'reader' }],
    });
    expect(h.db.chats?.items[0]).toMatchObject({
      kind: 'announce',
      sensitivity: 'finance',
      history: 'new',
      unit: null,
    });
    expect(h.db.assignments.some((a) => a.scope.type === 'chat' && a.scope.id === r.id)).toBe(
      false,
    );
    const p = h.api.chatCreate({ title: 'ПДн-чат', label: 'pdn' });
    expect(h.chat(p.id).sensitivity).toBe('pdn');
    expect(h.api.chatCreate({ title: 'Неизвестный', kind: 'record' as never }).id).toBeTruthy();
    expect(h.db.chats?.items[0]?.kind).toBe('group');
  });

  it('права: «Чаты · Изменять», область, объявления, метка «Финансы»', () => {
    const v = harness('m-vasiliev');
    expect(apiErr(() => v.api.chatCreate(spec))).toEqual(
      forbidden('Создавать групповые чаты может роль с правом «Чаты · Изменять»'),
    );
    const h = harness('m-kotova');
    expect(apiErr(() => h.api.chatCreate({ ...spec, unit: 'f-spb-neva' }))).toEqual(
      forbidden('Чат можно создать только в своей области'),
    );
    expect(apiErr(() => h.api.chatCreate({ ...spec, unit: undefined }))).toEqual(
      forbidden('Чат можно создать только в своей области'),
    );
    expect(apiErr(() => h.api.chatCreate({ ...spec, kind: 'announce' }))).toEqual(
      forbidden('Чаты объявлений создаёт владелец бизнеса'),
    );
    expect(apiErr(() => h.api.chatCreate({ ...spec, label: 'finance' }))).toEqual(
      forbidden('Метку «Финансы» ставит владелец бизнеса'),
    );
  });

  it('название — не короче 3 знаков (кроме предпросмотра)', () => {
    const h = harness('m-kotova');
    expect(apiErr(() => h.api.chatCreate({ ...spec, title: ' ab ' }))).toEqual(
      invalid('Название — не короче 3 символов'),
    );
  });

  it('источники: неизвестный, без роли, владелец и «все» — только владелец бизнеса', () => {
    const h = harness('m-kotova');
    const make = (s: object) => apiErr(() => h.api.chatCreate({ ...spec, sources: [s as never] }));
    expect(make({ who: 'zzz', role: 'member' })).toEqual(invalid('Неизвестный источник состава'));
    expect(make({ who: 'group', ref: 'g-drv' })).toEqual(invalid('Выберите роль в чате'));
    expect(make({ who: 'group', ref: 'g-drv', role: 'owner' })).toEqual(
      forbidden('Владельца чата назначает владелец бизнеса'),
    );
    expect(make({ who: 'all', role: 'member' })).toEqual(
      forbidden('«Все сотрудники» добавляет владелец бизнеса'),
    );
  });

  it('роль — только в своей области; сотрудник — только из своей области', () => {
    const h = harness('m-kotova');
    const make = (s: object) => apiErr(() => h.api.chatCreate({ ...spec, sources: [s as never] }));
    expect(make({ who: 'role', ref: 'r-driver', unit: 'f-msk-yug', role: 'member' })).toEqual(
      forbidden('Роль добавляется только в вашей области «Север Логистик»'),
    );
    expect(make({ who: 'role', ref: 'r-driver', role: 'member' })).toEqual(
      forbidden('Роль добавляется только в вашей области «Север Логистик»'),
    );
    expect(make({ who: 'role', ref: 'r-driver', unit: 'f-msk-sever', role: 'member' })).toBeNull();
    expect(make({ who: 'member', ref: 'm-morozova', role: 'member' })).toEqual(
      forbidden(
        'Анна Морозова: вне вашей области «Север Логистик» — добавить может владелец или руководитель области',
      ),
    );
    expect(make({ who: 'member', ref: 'm-vasiliev', role: 'member' })).toBeNull();
  });

  it('сотрудник области проекта', () => {
    const h = harness('m-kotova');
    h.db.assignments.push({
      id: 'ax',
      member: 'm-morozova',
      role: 'r-exec',
      scope: { type: 'project', id: 'fleet' },
    });
    expect(
      apiErr(() =>
        h.api.chatCreate({
          ...spec,
          sources: [{ who: 'member', ref: 'm-morozova', role: 'member' }],
        }),
      ),
    ).toBeNull();
  });
});

describe('chatSources', () => {
  it('dryRun: кто войдёт и кто выйдет, чат не меняется', () => {
    const h = harness('m-kotova');
    const before = JSON.stringify(h.db);
    const r = h.api.chatSources('ch-drv', [{ who: 'group', ref: 'g-drv', role: 'member' }], true);
    expect(ids(r.joined)).toEqual(['m-owner', 'm-kotova', 'm-vasiliev']);
    expect(r.gain).toEqual([]);
    expect(r.lose).toEqual(['m-kotelnikova']);
    expect(JSON.stringify(h.db)).toBe(before);
  });

  it('замена состава: источники, назначения по имени, служебное сообщение', () => {
    const h = harness('m-owner');
    const events = h.events().length;
    const r = h.api.chatSources('ch-drv', [
      { who: 'group', ref: 'g-drv', role: 'member' },
      { who: 'member', ref: 'm-morozova', role: 'reader' },
    ]);
    expect(r.gain).toEqual(['m-morozova']);
    expect(r.lose).toEqual(['m-kotelnikova']);
    const c = h.chat('ch-drv');
    expect(c.sources).toEqual([
      { who: 'group', ref: 'g-drv', unit: null, obj: null, trip: null, role: 'member' },
    ]);
    const named = h.db.assignments.filter(
      (a) => a.scope.type === 'chat' && a.scope.id === 'ch-drv',
    );
    expect(named.map((a) => a.member).sort()).toEqual(['m-kotova', 'm-morozova']);
    expect(named.find((a) => a.member === 'm-morozova')?.role).toBe('r-chat-reader');
    expect(c.msgs.at(-1)?.sys).toMatchObject({
      title: 'Состав изменён · Дарья Зимина',
      text: 'Вошли: Анна Морозова · Вышли: Вера Котельникова',
      icon: 'group',
    });
    expect(h.events().length).toBe(events + 1);
    expect(h.events()[0]).toMatchObject({
      text: 'Вас добавили в чат «Водители · Север Логистик»',
      to: ['m-morozova'],
    });
  });

  it('состав не изменился — так и пишем', () => {
    const h = harness('m-owner');
    h.api.chatSources('ch-news', [{ who: 'all', role: 'reader' }]);
    expect(h.chat('ch-news').msgs.at(-1)?.sys?.text).toBe('Состав не изменился');
  });

  it('права: владелец чата и модераторы; личные чаты — никогда', () => {
    const msg = forbidden('Состав меняют владелец чата и модераторы с правом «Чаты · Решать»');
    const v = harness('m-vasiliev');
    expect(apiErr(() => v.api.chatSources('ch-drv', [], true))).toEqual(msg);
    const k = harness('m-kotova');
    expect(apiErr(() => k.api.chatSources('ch-dkv', [], true))).toEqual(msg);
    expect(
      apiErr(() => k.api.chatSources('ch-drv', [{ who: 'all', role: 'reader' }], true)),
    ).toEqual(forbidden('«Все сотрудники» добавляет владелец бизнеса'));
  });
});

describe('chatSetFull', () => {
  it('режим заполнения в пределах политики, запись в журнал', () => {
    const h = harness('m-kotova');
    expect(h.api.chatSetFull('ch-drv', 'ring')).toEqual({ ok: true });
    expect(h.chat('ch-drv').over).toEqual({ onFull: 'ring' });
    expect(h.chat('ch-drv').journal[0]?.text).toBe('При заполнении: Удалять старые вложения');
    expect(h.api.chatSetFull('ch-drv', 'archive')).toEqual({ ok: true });
  });

  it('ошибки', () => {
    const h = harness('m-kotova');
    expect(apiErr(() => h.api.chatSetFull('ch-drv', 'zzz' as never))).toEqual(
      invalid('Неизвестный режим'),
    );
    const v = harness('m-vasiliev');
    expect(apiErr(() => v.api.chatSetFull('ch-drv', 'ring'))).toEqual(
      forbidden('Менять настройки хранения может владелец чата'),
    );
  });
});

describe('chatCleanup', () => {
  it('dryRun: итог из эталона, чат не меняется', () => {
    const h = harness('m-owner');
    const before = JSON.stringify(h.db);
    expect(h.api.chatCleanup('ch-obj42', ['video90'], true)).toEqual({
      n: 212,
      mb: 1900,
      after: 2700,
      quota: 5000,
      saved: 1100,
      held: 6,
      heldMb: 200,
    });
    expect(JSON.stringify(h.db)).toBe(before);
  });

  it('очистка: корзины, место, служебное сообщение и журнал', () => {
    const h = harness('m-owner');
    const r = h.api.chatCleanup('ch-obj42', ['video90']);
    expect(r.n).toBe(212);
    const c = h.chat('ch-obj42');
    expect(c.usedMb).toBe(2700);
    expect(c.buckets?.some((b) => b.id === 'b1')).toBe(false);
    expect(c.buckets?.some((b) => b.hold)).toBe(true);
    expect(c.msgs.at(-1)?.sys).toMatchObject({
      title: 'Вложения удалены очисткой · Дарья Зимина',
      text: '212 файлов · 1,9 ГБ. Подписи, превью и ответы остались',
      icon: 'cleaning_services',
      tone: 'warn',
    });
    expect(c.journal[0]?.text).toBe('Очистка: 212 файлов · 1,9 ГБ');
    expect(apiErr(() => h.api.chatCleanup('ch-obj42', ['video90']))).toEqual(
      invalid('Под фильтр ничего не попало'),
    );
  });

  it('ошибки: фильтр, права', () => {
    const h = harness('m-owner');
    expect(apiErr(() => h.api.chatCleanup('ch-obj42', [], true))).toEqual(
      invalid('Выберите, что удалить'),
    );
    const s = harness('m-sokolov');
    expect(apiErr(() => s.api.chatCleanup('ch-obj42', ['video90'], true))).toEqual(
      forbidden('Очищать чат может его владелец'),
    );
  });
});

describe('chatPolicySet', () => {
  it('только владелец бизнеса; вид и пределы организации', () => {
    const k = harness('m-kotova');
    expect(apiErr(() => k.api.chatPolicySet('area', {}, true))).toEqual(
      forbidden('Политики чатов меняет владелец бизнеса'),
    );
    const h = harness('m-owner');
    expect(apiErr(() => h.api.chatPolicySet('zzz' as never, {}, true))).toEqual(
      invalid('Неизвестный вид чата'),
    );
    expect(apiErr(() => h.api.chatPolicySet('area', { maxMb: 5000 }, true))).toEqual(
      invalid('Значение вне пределов организации: 10–2000'),
    );
    expect(apiErr(() => h.api.chatPolicySet('area', { filesD: 10 }, true))).toEqual(
      invalid('Значение вне пределов организации: 30–1825'),
    );
    expect(apiErr(() => h.api.chatPolicySet('area', { delD: 7 }, true))).toEqual(
      invalid('Значение вне пределов организации: 30–30'),
    );
  });

  it('значения перечислений проверяются; временные — только в личных (CHAT-04)', () => {
    const h = harness('m-owner');
    expect(apiErr(() => h.api.chatPolicySet('area', { rcpt: 'zzz' as never }, true))).toEqual(
      invalid('Неизвестное значение настройки «rcpt»'),
    );
    expect(apiErr(() => h.api.chatPolicySet('area', { temp: 'allowed' }, true))).toEqual(
      invalid('Временные сообщения разрешены только в личных чатах'),
    );
    expect(apiErr(() => h.api.chatPolicySet('announce', { temp: 'viewonce' }, true))).toEqual(
      invalid('Временные сообщения разрешены только в личных чатах'),
    );
    expect(apiErr(() => h.api.chatPolicySet('record', { temp: 'allowed' }, true))).toEqual(
      invalid('Временные сообщения разрешены только в личных чатах'),
    );
    expect(apiErr(() => h.api.chatPolicySet('record', { temp: 'viewonce' }, true))).toBeNull();
    expect(
      apiErr(() => h.api.chatPolicySet('direct', { temp: 'allowed', fwd: 'off' }, true)),
    ).toBeNull();
  });

  it('без изменений: заметка о числе чатов и «ничего не удаляется»', () => {
    const h = harness('m-owner');
    expect(h.api.chatPolicySet('area', {}, true).notes).toEqual([
      ['groups', 'info', '1 чат вида «По роли в области», 4 сотрудника: новые значения — сразу'],
      ['check_circle', 'ok', 'Сообщения и файлы не удаляются'],
    ]);
  });

  it('последствия: прочтение, правка, сроки, место, предел файла', () => {
    const h = harness('m-owner');
    const notes = h.api.chatPolicySet(
      'record',
      { rcptD: 14, rcpt: 'who', edit: '15m', filesD: 100, textY: 2, maxMb: 150 },
      true,
    ).notes;
    expect(notes.map((n) => n.slice(0, 2))).toEqual([
      ['groups', 'info'],
      ['delete_sweep', 'warn'],
      ['done_all', 'info'],
      ['edit_off', 'warn'],
      ['delete', 'danger'],
      ['delete', 'danger'],
      ['attach_file', 'neutral'],
    ]);
    expect(notes[0]?.[2]).toBe('2 чата вида «Чаты записей», 4 сотрудника: новые значения — сразу');
    expect(notes[1]?.[2]).toBe(
      'Отметки прочтения старше 14 дней удалятся. Подтверждения важного не затрагиваются',
    );
    expect(notes[2]?.[2]).toBe('Прочтение: «Галочки» → «Кто и когда»');
    expect(notes[3]?.[2]).toBe(
      'Правка своих — 15 минут вместо 48 часов: отправленное раньше уже не правится',
    );
    expect(notes[4]?.[2]).toBe(
      'Вложения старше 100 дней удалятся: около 2,4 ГБ. Сохранённое в запись и под удержанием останется',
    );
    expect(notes[5]?.[2]).toBe('Текст старше 2 лет удалится по новому сроку');
    expect(notes[6]?.[2]).toBe('Файл до 150 МБ вместо 500 МБ');
  });

  it('временные: подпись перехода', () => {
    const h = harness('m-owner');
    const notes = h.api.chatPolicySet('direct', { temp: 'off' }, true).notes;
    expect(notes[1]).toEqual(['timer', 'neutral', 'Временные: «1 час — 7 дней» → «Запрещены»']);
  });

  it('применение: политика вида и служебное сообщение в каждом чате вида', () => {
    const h = harness('m-owner');
    const r = h.api.chatPolicySet('area', { maxMb: 150 });
    expect(h.db.chats?.policy.area.maxMb).toBe(150);
    const sys = h.chat('ch-drv').msgs.at(-1)?.sys;
    expect(sys).toMatchObject({
      title: 'Политика вида изменена · Дарья Зимина',
      text: 'Файл до 150 МБ вместо 100 МБ',
      icon: 'policy',
      tone: 'neutral',
    });
    expect(r.notes).toHaveLength(2);
  });

  it('dryRun ничего не меняет', () => {
    const h = harness('m-owner');
    const before = JSON.stringify(h.db);
    h.api.chatPolicySet('area', { maxMb: 150 }, true);
    expect(JSON.stringify(h.db)).toBe(before);
  });
});
