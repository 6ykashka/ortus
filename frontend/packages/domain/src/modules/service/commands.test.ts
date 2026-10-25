// Команды «Обращений» (service.js 19.10:235–368): 10 команд, тексты ошибок дословно, проверка прав
// с объектом-направлением (PD-53). Намеренные отличия от эталона (PD-60, Q-W4.00-service-6, -11):
// компенсация требует «Решать»; перенос пересчитывает сроки по типу и календарю нового направления.
import { describe, expect, it } from 'vitest';
import { fixedClock, DEMO } from '../../core/clock.ts';
import { ApiError } from '../../core/errors/index.ts';
import { createModuleCtx } from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { addWorkMinutes, CAL, DAY_MS } from './calendar.ts';
import { SERVICE_DELAYS, SERVICE_METHODS, serviceCommands } from './commands.ts';
import { at, must, svc } from './fixture.test-util.ts';
import { installService, SVC_BASE } from './seed.ts';
import type { ServiceRequest, ServiceTenantDb } from './types.ts';

type Db = ServiceTenantDb & ReturnType<typeof createAlta>;

const OWNER = 'm-owner';
const KOTOVA = 'm-kotova';

function setup(actor: string = OWNER) {
  const db = createAlta(createPlatform()) as unknown as Db;
  installService(db, { tenantId: 't-alta', clock: fixedClock(DEMO.svcBase) });
  const state = { actor };
  const ctx = createModuleCtx({
    getDb: () => db as never,
    getActor: () => state.actor,
    clock: fixedClock(DEMO.svcBase),
    tasks: createFakeTaskPort(),
  });
  const api = serviceCommands(ctx);
  const as = (id: string): void => {
    state.actor = id;
  };
  const req = (id: string): ServiceRequest => must(svc(db).requests.find((r) => r.id === id));
  const last = (id: string) => at(req(id).messages, req(id).messages.length - 1);
  const grant = (member: string, role: string, actions: string[], project = 'svc-grz'): void => {
    if (!db.roles.some((r) => r.id === role)) {
      db.roles.push({
        id: role,
        name: role,
        kind: 'custom',
        project: true,
        actions: { service: actions as never },
        finance: { read: false, manage: false },
      });
    }
    db.assignments.push({
      id: 'g-' + member + role,
      member,
      role,
      scope: { type: 'project', id: project },
    });
  };
  return { db, api, as, req, last, grant };
}

/** Код и текст ошибки команды. */
function fails(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('Ожидалась ошибка');
}

const NOW = SVC_BASE;

describe('реестр методов', () => {
  it('десять команд svc*, задержка 420 мс у каждой (cmd эталона по умолчанию)', () => {
    expect(SERVICE_METHODS).toEqual([
      'svcReply',
      'svcTransition',
      'svcAssign',
      'svcPriority',
      'svcMove',
      'svcCreate',
      'svcShowPhone',
      'svcShare',
      'svcAddTask',
      'svcRating',
    ]);
    for (const m of SERVICE_METHODS) expect(SERVICE_DELAYS[m]).toBe(420);
  });
});

describe('доступ: направление не видно — 404, видно без права — 403', () => {
  it('нет среза «Обращений»', () => {
    const { db, api } = setup();
    db.service = null;
    expect(fails(() => api.svcPriority('r-57', 'low'))).toEqual({
      code: 'not_found',
      message: 'В организации нет направлений обращений',
    });
  });

  it('чужое направление и несуществующий id одинаково: «Обращение не найдено»', () => {
    const { api, as } = setup();
    as(KOTOVA);
    const nf = { code: 'not_found', message: 'Обращение не найдено' };
    expect(fails(() => api.svcPriority('r-40', 'low'))).toEqual(nf);
    expect(fails(() => api.svcPriority('r-zzz', 'low'))).toEqual(nf);
    as('m-morozova');
    expect(fails(() => api.svcPriority('r-57', 'low'))).toEqual(nf);
  });

  it('жалоба на сотрудника: сам он получает 404, даже имея роль в направлении', () => {
    const { api, as, grant } = setup();
    grant('m-morozova', 'r-agent', ['view', 'create', 'edit', 'review'], 'svc-mas');
    as('m-morozova');
    expect(fails(() => api.svcPriority('r-41', 'low'))).toEqual({
      code: 'not_found',
      message: 'Обращение не найдено',
    });
    expect(() => api.svcPriority('r-40', 'low')).not.toThrow();
  });

  it('PD-53: роль в «Грузоперевозках» не даёт права в «Массаже»', () => {
    const { api, as, grant } = setup();
    grant('m-sokolov', 'r-agent', ['view', 'create', 'edit', 'review'], 'svc-grz');
    grant('m-sokolov', 'r-watch', ['view'], 'svc-mas');
    as('m-sokolov');
    expect(fails(() => api.svcPriority('r-40', 'low'))).toEqual({
      code: 'forbidden',
      message: 'Нет права «Отвечать» в обращениях',
    });
    expect(() => api.svcPriority('r-57', 'low')).not.toThrow();
  });

  it('наблюдатель: заметку писать можно, ответ клиенту — нельзя', () => {
    const { api, as, grant, req } = setup();
    grant('m-sokolov', 'r-watch', ['view']);
    as('m-sokolov');
    expect(fails(() => api.svcReply('r-57', { kind: 'reply', text: 'ответ' }))).toEqual({
      code: 'forbidden',
      message: 'Нет права «Отвечать» в обращениях',
    });
    api.svcReply('r-57', { kind: 'note', text: 'заметка наблюдателя' });
    expect(req('r-57').messages.at(-1)).toMatchObject({ kind: 'note', by: 'Алексей Соколов' });
  });
});

describe('svcReply', () => {
  it('ответ клиенту: сообщение, стоп первого срока, «Новое» → «В работе», исполнитель — автор', () => {
    const { api, req, db } = setup();
    expect(api.svcReply('r-57', { kind: 'reply', text: '  Приняли, разбираемся  ' })).toBe(
      'ГРЗ-57',
    );
    const r = req('r-57');
    expect(r.messages.at(-1)).toEqual({
      id: 'msg200',
      kind: 'public',
      at: NOW,
      text: 'Приняли, разбираемся',
      by: 'Дарья Зимина',
      channel: 'bot',
    });
    expect(r.sla.first?.stopped).toBe(NOW);
    expect(r.status).toBe('work');
    expect(r.assignee).toBe('Дарья Зимина');
    expect(svc(db).seq).toBe(201);
  });

  it('счётчик id растёт на сообщение', () => {
    const { api, db } = setup();
    api.svcReply('r-57', { kind: 'reply', text: 'раз' });
    api.svcReply('r-57', { kind: 'reply', text: 'два' });
    expect(svc(db).seq).toBe(202);
  });

  it('заметка: статус, сроки и исполнитель не меняются, канала нет', () => {
    const { api, req, as } = setup();
    as(KOTOVA);
    api.svcReply('r-57', { kind: 'note', text: 'внутренняя' });
    const r = req('r-57');
    expect(r.messages.at(-1)).toMatchObject({ kind: 'note', channel: null, by: 'Марина Котова' });
    expect(r.status).toBe('new');
    expect(r.assignee).toBeNull();
    expect(r.sla.first?.stopped).toBeNull();
  });

  it('повторный ответ не сдвигает остановленный срок и не меняет исполнителя', () => {
    const { api, req, as } = setup();
    api.svcReply('r-57', { kind: 'reply', text: 'первый' });
    as(KOTOVA);
    api.svcReply('r-57', { kind: 'reply', text: 'второй' });
    expect(req('r-57').assignee).toBe('Дарья Зимина');
  });

  it('короткий текст и закрытое обращение', () => {
    const { api, req } = setup();
    expect(fails(() => api.svcReply('r-57', { kind: 'reply', text: ' я ' }))).toEqual({
      code: 'validation',
      message: 'Напишите текст ответа',
    });
    expect(fails(() => api.svcReply('r-57', { kind: 'note', text: '' }))).toEqual({
      code: 'validation',
      message: 'Напишите текст заметки',
    });
    req('r-57').status = 'closed';
    expect(fails(() => api.svcReply('r-57', { kind: 'reply', text: 'поздно' }))).toEqual({
      code: 'validation',
      message: 'Обращение закрыто',
    });
    expect(req('r-57').messages).toHaveLength(2);
  });

  it('компенсация: скидка сохраняется в карточке, возврат — предложение кассе с основанием', () => {
    const { api, req } = setup();
    api.svcReply('r-41', {
      kind: 'reply',
      text: 'Извините',
      compensation: 'Скидка 20% на следующий визит',
    });
    expect(req('r-41').compensation).toBe('Скидка 20% на следующий визит');
    expect(req('r-41').messages.at(-1)?.text).toBe(
      'Компенсация: Скидка 20% на следующий визит — сохранена в карточке клиента',
    );
    api.svcReply('r-57', {
      kind: 'reply',
      text: 'Вернём',
      compensation: 'Возврат денег — через кассу',
    });
    expect(req('r-57').messages.at(-1)?.text).toBe(
      'Компенсация: Возврат денег — через кассу — предложение операции отправлено в кассу, основание ГРЗ-57',
    );
  });

  it('PD-60: без права «Решать» компенсацию назначить нельзя, и ничего не меняется', () => {
    const { api, as, grant, req } = setup();
    grant('m-sokolov', 'r-edit', ['view', 'edit']);
    as('m-sokolov');
    expect(
      fails(() =>
        api.svcReply('r-57', {
          kind: 'reply',
          text: 'Извините',
          compensation: 'Скидка 10% на следующую работу',
        }),
      ),
    ).toEqual({ code: 'forbidden', message: 'Нет права «Решать» в обращениях' });
    expect(req('r-57').messages).toHaveLength(2);
    expect(req('r-57').status).toBe('new');
    expect(req('r-57').compensation).toBeUndefined();
    api.svcReply('r-57', { kind: 'reply', text: 'Без компенсации' });
    expect(req('r-57').status).toBe('work');
  });

  it('неизвестная компенсация отклоняется до изменений', () => {
    const { api, req } = setup();
    expect(
      fails(() => api.svcReply('r-57', { kind: 'reply', text: 'Привет', compensation: 'Миллион' })),
    ).toEqual({
      code: 'validation',
      message: 'Неизвестная компенсация',
    });
    expect(req('r-57').messages).toHaveLength(2);
  });
});

describe('svcTransition', () => {
  it('«Новое» → «В работе»: сообщение и исполнитель', () => {
    const { api, req, last } = setup();
    expect(api.svcTransition('r-57', 'work')).toBe('ГРЗ-57');
    expect(req('r-57')).toMatchObject({ status: 'work', assignee: 'Дарья Зимина' });
    expect(last('r-57').text).toBe('Взято в работу · Дарья Зимина');
  });

  it('«Ждёт клиента» ставит паузу; сообщение упоминает срок по закону, если он есть', () => {
    const { api, req, last } = setup();
    api.svcTransition('r-57', 'wait');
    expect(req('r-57').pausedAt).toBe(NOW);
    expect(last('r-57').text).toBe(
      'Ждёт клиента · Дарья Зимина — срок на паузе, срок по закону идёт',
    );
    api.svcTransition('r-40', 'wait');
    expect(last('r-40').text).toBe('Ждёт клиента · Дарья Зимина — срок на паузе');
  });

  it('возврат из паузы сдвигает сроки на простой в рабочих минутах', () => {
    const { api, req } = setup();
    const r = req('r-40');
    const due = must(r.sla.first).due;
    r.status = 'wait';
    r.pausedAt = NOW - 60 * 60_000;
    api.svcTransition('r-40', 'work');
    expect(req('r-40').pausedAt).toBeNull();
    expect(must(req('r-40').sla.first).due).toBe(addWorkMinutes(due, 60, CAL.spa));
  });

  it('«Решено»: нужен итог из списка; у жалобы на сотрудника — свой список', () => {
    const { api, req } = setup();
    expect(fails(() => api.svcTransition('r-57', 'resolved'))).toEqual({
      code: 'validation',
      message: 'Выберите итог решения',
    });
    expect(
      fails(() => api.svcTransition('r-57', 'resolved', { outcome: 'Подтвердилась' })),
    ).toMatchObject({
      message: 'Выберите итог решения',
    });
    expect(
      fails(() => api.svcTransition('r-41', 'resolved', { outcome: 'Устранено' })),
    ).toMatchObject({
      code: 'validation',
    });
    api.svcTransition('r-41', 'resolved', { outcome: 'Подтвердилась' });
    expect(req('r-41')).toMatchObject({
      status: 'resolved',
      outcome: 'Подтвердилась',
      resolvedAt: NOW,
    });
  });

  it('«Решено» останавливает все сроки и пишет сообщение; из паузы — сначала сдвиг', () => {
    const { api, req, last } = setup();
    api.svcTransition('r-57', 'resolved', { outcome: 'Устранено' });
    const r = req('r-57');
    expect([r.sla.first?.stopped, r.sla.legal?.stopped]).toEqual([NOW, NOW]);
    expect(last('r-57').text).toBe(
      'Решено · Устранено · Дарья Зимина. Клиенту отправлен вопрос «Довольны ли решением?»',
    );
    api.svcTransition('r-55', 'resolved', { outcome: 'Разъяснено' });
    expect(req('r-55').pausedAt).toBeNull();
    expect(req('r-55').status).toBe('resolved');
  });

  it('«Вернуть в работу» из решённого снимает итог и останавливает только первый срок', () => {
    const { api, req, last } = setup();
    api.svcTransition('r-57', 'resolved', { outcome: 'Устранено' });
    api.svcTransition('r-57', 'work');
    const r = req('r-57');
    expect(r).toMatchObject({ status: 'work', outcome: null, resolvedAt: null });
    expect(r.sla.legal?.stopped).toBeNull();
    expect(r.sla.first?.stopped).toBe(NOW);
    expect(last('r-57').text).toBe('Возвращено в работу · Дарья Зимина');
  });

  it('«Закрыть»', () => {
    const { api, req, last } = setup();
    api.svcTransition('r-57', 'resolved', { outcome: 'Устранено' });
    api.svcTransition('r-57', 'closed');
    expect(req('r-57').status).toBe('closed');
    expect(last('r-57').text).toBe('Закрыто · Дарья Зимина');
  });

  it('недопустимый переход: код transition и текст эталона — раньше проверки права', () => {
    const { api, as } = setup();
    expect(fails(() => api.svcTransition('r-57', 'closed'))).toEqual({
      code: 'transition',
      message: 'Из статуса «Новое» в «Закрыто» перейти нельзя',
    });
    as(KOTOVA);
    expect(fails(() => api.svcTransition('r-40', 'work')).code).toBe('not_found');
  });

  it('«Решено» и «Закрыто» — право «Решать», «В работе» и «Ждёт клиента» — «Отвечать»', () => {
    const { api, as, grant } = setup();
    grant('m-sokolov', 'r-edit', ['view', 'edit']);
    as('m-sokolov');
    expect(fails(() => api.svcTransition('r-57', 'resolved', { outcome: 'Устранено' }))).toEqual({
      code: 'forbidden',
      message: 'Нет права «Решать» в обращениях',
    });
    expect(() => api.svcTransition('r-57', 'wait')).not.toThrow();
  });
});

describe('svcAssign, svcPriority', () => {
  it('назначение и снятие исполнителя', () => {
    const { api, req, last } = setup();
    api.svcAssign('r-57', 'Марина Котова');
    expect(req('r-57').assignee).toBe('Марина Котова');
    expect(last('r-57').text).toBe('Исполнитель: Марина Котова');
    api.svcAssign('r-57', null);
    expect(req('r-57').assignee).toBeNull();
    expect(last('r-57').text).toBe('Исполнитель снят');
  });

  it('назначить можно только участника, видящего направление', () => {
    const { api, req } = setup();
    expect(fails(() => api.svcAssign('r-57', 'Анна Морозова'))).toEqual({
      code: 'validation',
      message: 'Анна Морозова не видит направление «Грузоперевозки» — назначить нельзя',
    });
    expect(req('r-57').assignee).toBeNull();
  });

  it('приоритет: сообщение строчными, неизвестный — ошибка', () => {
    const { api, req, last } = setup();
    api.svcPriority('r-57', 'low');
    expect(req('r-57').priority).toBe('low');
    expect(last('r-57').text).toBe('Приоритет: низкий');
    expect(fails(() => api.svcPriority('r-57', 'urgent'))).toEqual({
      code: 'validation',
      message: 'Неизвестный приоритет',
    });
  });
});

describe('svcMove', () => {
  it('новый ключ, старый — в oldKeys, счётчик направления растёт, сообщение дословно', () => {
    const { api, req, last, db } = setup();
    expect(api.svcMove('r-57', 'd-mas')).toBe('МАС-42');
    const r = req('r-57');
    expect(r).toMatchObject({ key: 'МАС-42', dir: 'd-mas', oldKeys: ['ГРЗ-57'] });
    expect(svc(db).directions[0]?.next).toBe(43);
    expect(last('r-57').text).toBe(
      'Перенесено из «Грузоперевозки» в «Массаж»: ГРЗ-57 → МАС-42. Клиент получил новый номер, старый ведёт сюда',
    );
    api.svcMove('r-57', 'd-kos');
    expect(req('r-57').oldKeys).toEqual(['ГРЗ-57', 'МАС-42']);
  });

  it('нет такого вида в целевом направлении — «Вопрос»', () => {
    const { api, req } = setup();
    api.svcMove('r-57', 'd-mas');
    expect(req('r-57').kind).toBe('question');
    api.svcMove('r-55', 'd-otd');
    expect(req('r-55').kind).toBe('question');
  });

  it('есть такой вид — остаётся (жалоба МАС → ОТД)', () => {
    const { api, req } = setup();
    api.svcMove('r-41', 'd-otd');
    expect(req('r-41').kind).toBe('complaint');
  });

  it('Q-W4.00-service-11: сроки пересчитаны от создания по типу и календарю нового направления', () => {
    const { api, req } = setup();
    api.svcMove('r-57', 'd-mas');
    const r = req('r-57');
    // тип «Вопрос» «Массажа»: 240 и 1980 рабочих минут по ежедневному 10–21, срока по закону нет
    expect(r.sla.first).toEqual({
      goal: 240,
      due: addWorkMinutes(r.at, 240, CAL.spa),
      stopped: null,
    });
    expect(r.sla.resolve).toEqual({
      goal: 1980,
      due: addWorkMinutes(r.at, 1980, CAL.spa),
      stopped: null,
    });
    expect(r.sla.legal).toBeNull();
  });

  it('остановленные сроки остаются остановленными; цель, которой нет в новом типе, исчезает', () => {
    const { api, req } = setup();
    const before = must(req('r-o11').sla.first).stopped;
    api.svcMove('r-o11', 'd-mas');
    const r = req('r-o11');
    expect(r.sla.first).toMatchObject({ goal: 660, stopped: before });
    expect(r.sla.legal).toEqual({ days: 10, due: r.at + 10 * DAY_MS, stopped: null });
  });

  it('ошибки: то же направление, неизвестное, нет доступа к целевому', () => {
    const { api, as } = setup();
    expect(fails(() => api.svcMove('r-57', 'd-grz'))).toEqual({
      code: 'validation',
      message: 'Выберите другое направление',
    });
    expect(fails(() => api.svcMove('r-57', 'd-zzz')).message).toBe('Выберите другое направление');
    as(KOTOVA);
    expect(fails(() => api.svcMove('r-57', 'd-mas'))).toEqual({
      code: 'forbidden',
      message: 'Нет доступа к направлению «Массаж»',
    });
  });

  it('право «Отвечать» нужно и в целевом направлении', () => {
    const { api, as, grant, req } = setup();
    grant('m-sokolov', 'r-edit', ['view', 'edit'], 'svc-grz');
    grant('m-sokolov', 'r-watch', ['view'], 'svc-otd');
    as('m-sokolov');
    expect(fails(() => api.svcMove('r-57', 'd-otd')).code).toBe('forbidden');
    expect(req('r-57').key).toBe('ГРЗ-57');
  });
});

describe('svcCreate — «Обращение по звонку»', () => {
  const input = {
    dir: 'd-grz',
    kind: 'question',
    name: '  Пётр Первый ',
    phone: ' +7 900 111-22-33 ',
    org: ' ООО «Ромашка» ',
    link: ' Рейс Р-1 ',
    text: ' Где мой груз? Жду уже второй день.',
  };

  it('создаёт обращение в работе: звонок, исполнитель — автор, телефон виден автору', () => {
    const { api, req, db } = setup();
    expect(api.svcCreate(input)).toBe('r-200');
    const r = req('r-200');
    expect(r).toMatchObject({
      key: 'ГРЗ-58',
      dir: 'd-grz',
      kind: 'question',
      title: 'Где мой груз',
      status: 'work',
      priority: 'normal',
      assignee: 'Дарья Зимина',
      at: NOW,
      channel: 'phone',
      shown: [OWNER],
      labels: [],
      tasks: [],
      link: { label: 'Рейс Р-1', lines: ['Привязано вручную при звонке'] },
      client: {
        name: 'Пётр Первый',
        org: 'ООО «Ромашка»',
        phone: '+7 900 111-22-33',
        since: 'Новый клиент',
      },
    });
    expect(r.messages.map((m) => [m.id, m.kind, m.text])).toEqual([
      ['msg201', 'system', 'Заведено по звонку · Дарья Зимина'],
      ['msg202', 'client', 'Где мой груз? Жду уже второй день.'],
    ]);
    expect(r.sla.first).toMatchObject({ goal: 120, stopped: null });
    expect(svc(db).requests[0]?.id).toBe('r-200');
    expect(svc(db).directions[3]?.next).toBe(59);
    expect(svc(db).seq).toBe(203);
  });

  it('жалоба и претензия — высокий приоритет; без компании и привязки — без полей', () => {
    const { api, req } = setup();
    const id = api.svcCreate({ ...input, kind: 'complaint', org: '', link: '' });
    expect(req(id).priority).toBe('high');
    expect(req(id).link).toBeNull();
    expect(req(id).client.org).toBeUndefined();
    expect(req(api.svcCreate({ ...input, dir: 'd-otd', kind: 'claim' })).priority).toBe('high');
  });

  it.each([
    [{ name: 'А' }, 'Укажите имя клиента'],
    [{ phone: '+7 900 111' }, 'Телефон — не меньше 10 цифр'],
    [{ text: 'Груз' }, 'Опишите, что случилось'],
    [{ kind: 'zzz' }, 'Выберите тип обращения'],
    [{ dir: 'd-zzz' }, 'Выберите направление'],
  ])('проверка %j', (patch, message) => {
    const { api, db } = setup();
    expect(fails(() => api.svcCreate({ ...input, ...patch }))).toEqual({
      code: 'validation',
      message,
    });
    expect(svc(db).requests).toHaveLength(8);
    expect(svc(db).seq).toBe(200);
  });

  it('чужое направление — «Выберите направление»; нет права «Заводить» — 403', () => {
    const { api, as, grant } = setup();
    as(KOTOVA);
    expect(fails(() => api.svcCreate({ ...input, dir: 'd-mas', kind: 'complaint' })).message).toBe(
      'Выберите направление',
    );
    expect(() => api.svcCreate(input)).not.toThrow();
    grant('m-sokolov', 'r-watch', ['view']);
    as('m-sokolov');
    expect(fails(() => api.svcCreate(input))).toEqual({
      code: 'forbidden',
      message: 'Нет права «Заводить» в обращениях',
    });
    as('m-morozova');
    expect(fails(() => api.svcCreate(input)).code).toBe('forbidden');
  });
});

describe('svcShowPhone', () => {
  it('владелец: номер показан, участник записан, в ленте — запись', () => {
    const { api, req, last } = setup();
    api.svcShowPhone('r-57');
    api.svcShowPhone('r-57');
    expect(req('r-57').shown).toEqual([OWNER]);
    expect(last('r-57').text).toBe('Телефон клиента показан: Дарья Зимина');
  });

  it('руководитель направления — да, специалист — нет (403 с текстом эталона)', () => {
    const { api, as, req, db } = setup();
    as(KOTOVA);
    expect(fails(() => api.svcShowPhone('r-57'))).toEqual({
      code: 'forbidden',
      message:
        'Телефон клиента показывают руководителю направления и владельцу: нужно право «Контакты клиентов»',
    });
    expect(req('r-57').shown).toBeUndefined();
    at(svc(db).directions, 3).lead = KOTOVA;
    api.svcShowPhone('r-57');
    expect(req('r-57').shown).toEqual([KOTOVA]);
  });
});

describe('svcShare — вывод сотруднику', () => {
  it('после решения: вывод, запись, событие сотруднику без контактов', () => {
    const { api, req, last, db } = setup();
    api.svcTransition('r-41', 'resolved', { outcome: 'Подтвердилась' });
    api.svcShare('r-41', '  Подогрев не включился, ремонтируем стол  ');
    expect(req('r-41').shared).toEqual({
      text: 'Подогрев не включился, ремонтируем стол',
      at: NOW,
      by: 'Дарья Зимина',
    });
    expect(last('r-41').text).toBe(
      'Вывод отправлен сотруднику: Анна Морозова · без контактов клиента',
    );
    expect(db.events?.[0]).toMatchObject({
      text: 'Вывод по обращению МАС-41: Подогрев не включился, ремонтируем стол',
      to: ['m-morozova'],
    });
  });

  it('ошибки: не про сотрудника, до решения, короткий текст', () => {
    const { api } = setup();
    expect(fails(() => api.svcShare('r-57', 'Вывод про всё'))).toEqual({
      code: 'validation',
      message: 'Обращение не касается сотрудника',
    });
    expect(fails(() => api.svcShare('r-41', 'Вывод про всё'))).toEqual({
      code: 'validation',
      message: 'Поделиться выводом можно после решения',
    });
    api.svcTransition('r-41', 'resolved', { outcome: 'Не подтвердилась' });
    expect(fails(() => api.svcShare('r-41', 'крат'))).toEqual({
      code: 'validation',
      message: 'Напишите вывод для сотрудника',
    });
  });

  it('нужно право «Решать»', () => {
    const { api, as, grant } = setup();
    api.svcTransition('r-41', 'resolved', { outcome: 'Подтвердилась' });
    grant('m-sokolov', 'r-edit', ['view', 'edit'], 'svc-mas');
    as('m-sokolov');
    expect(fails(() => api.svcShare('r-41', 'Вывод про ситуацию')).code).toBe('forbidden');
  });
});

describe('svcAddTask', () => {
  it('задача в карточке: номер из общего счётчика, запись в ленте', () => {
    const { api, req, last, db } = setup();
    expect(api.svcAddTask('r-o11', '  Позвонить прорабу ')).toBe('T-200');
    expect(req('r-o11').tasks.at(-1)).toEqual({
      id: 'T-200',
      title: 'Позвонить прорабу',
      status: 'Новая',
    });
    expect(last('r-o11').text).toBe(
      'Создана задача T-200 «Позвонить прорабу» · клиент её не видит',
    );
    expect(svc(db).seq).toBe(202);
  });

  it('тема короче трёх символов', () => {
    const { api } = setup();
    expect(fails(() => api.svcAddTask('r-o11', 'ab'))).toEqual({
      code: 'validation',
      message: 'Тема задачи — не короче 3 символов',
    });
  });
});

describe('svcRating', () => {
  it('«Просмотрено»: статус оценки, возврат null', () => {
    const { api, db } = setup();
    expect(api.svcRating('S-311', 'seen')).toBeNull();
    expect(svc(db).ratings[0]?.status).toBe('seen');
  });

  it('«Открыть жалобу»: новая жалоба в работе, оценка ссылается на неё', () => {
    const { api, req, db } = setup();
    const id = api.svcRating('S-305', 'complaint');
    expect(id).toBe('r-200');
    const r = req('r-200');
    expect(r).toMatchObject({
      key: 'ГРЗ-58',
      kind: 'complaint',
      title: 'Опоздали на 40 минут, разгрузку перенесли на вечер',
      status: 'work',
      priority: 'high',
      assignee: 'Дарья Зимина',
      channel: 'sms',
      fromRating: 2,
      link: { label: 'Рейс Р-190 · 29.09', lines: ['Оценка 2 из 5 · 29 сентября'] },
    });
    expect(r.messages.map((m) => [m.kind, m.text])).toEqual([
      ['rating', 'Опоздали на 40 минут, разгрузку перенесли на вечер'],
      [
        'system',
        'Жалоба открыта из низкой оценки · Дарья Зимина. Клиент не просил связаться — первым ответом позвоните или напишите',
      ],
    ]);
    expect(svc(db).ratings[1]).toMatchObject({ status: 'request', request: 'ГРЗ-58' });
    expect(svc(db).requests[0]?.id).toBe('r-200');
  });

  it('оценка 3 — обычный приоритет', () => {
    const { api, req } = setup();
    expect(req(must(api.svcRating('S-311', 'complaint'))).priority).toBe('normal');
  });

  it('оценка не найдена или направление не видно — 404; нужны права «Отвечать» / «Заводить»', () => {
    const { api, as, grant } = setup();
    expect(fails(() => api.svcRating('S-999', 'seen'))).toEqual({
      code: 'not_found',
      message: 'Оценка не найдена',
    });
    as(KOTOVA);
    expect(fails(() => api.svcRating('S-311', 'seen')).code).toBe('not_found');
    expect(api.svcRating('S-305', 'seen')).toBeNull();
    grant('m-sokolov', 'r-edit', ['view', 'edit']);
    as('m-sokolov');
    expect(fails(() => api.svcRating('S-305', 'complaint'))).toEqual({
      code: 'forbidden',
      message: 'Нет права «Заводить» в обращениях',
    });
  });
});
