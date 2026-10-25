// Команды «Ремонта и стройки» (api.js 14.10/19.10:895–967, W6.10): успех, каждая ошибка дословно,
// события, права и намеренные расхождения с эталоном (бриф W6.10 §10).
import { describe, expect, it } from 'vitest';
import { REPAIR_DELAYS, REPAIR_METHODS, repairCommands, type RepairApi } from './commands.ts';
import { altaRepairDb, apiErr, harness, restrictTenant } from './fixture.test-util.ts';

const h = (actor = 'm-sokolov') => harness<RepairApi>(repairCommands, actor);
const OWNER = 'm-owner';

const input = (o: Record<string, unknown> = {}) => ({
  obj: 'obj-42',
  work: 'w1',
  volume: 10,
  crew: ['k1', 'k2'],
  material: '',
  materialQty: '',
  photos: 3,
  ...o,
});

describe('реестр методов и задержки mock-адаптера', () => {
  it('методы и задержки эталона; возврат отметки — как приёмка', () => {
    expect(REPAIR_METHODS).toEqual([
      'addWorkLog',
      'acceptWorkLog',
      'returnWorkLog',
      'assignForeman',
      'proposeChange',
      'setChange',
    ]);
    expect(REPAIR_DELAYS).toEqual({
      addWorkLog: 450,
      acceptWorkLog: 350,
      returnWorkLog: 350,
      assignForeman: 400,
      proposeChange: 350,
      setChange: 300,
    });
  });
});

describe('addWorkLog: отметка прораба', () => {
  it('успех: «На проверке», id WL-<10+seq>, событие владельцу', () => {
    const { api, db } = h();
    db.seq = 120;
    const id = api.addWorkLog(input({ volume: '10,5', material: 'mt2', materialQty: '5' }));
    expect(id).toBe('WL-130');
    expect(db.seq).toBe(122);
    expect(db.repair.logs[0]).toEqual({
      id: 'WL-130',
      obj: 'obj-42',
      at: '10:30',
      work: 'w1',
      volume: 10.5,
      crew: ['k1', 'k2'],
      materials: [['mt2', 5]],
      photos: 3,
      status: 'На проверке',
      by: 'Алексей Соколов',
    });
    expect(db.events?.[0]).toMatchObject({
      id: 'e121',
      at: '10:30',
      text: 'Прораб отметил «Подготовка стен» · ЖК Речной · квартира 42: 10,5 м² — нужна приёмка',
      to: [OWNER],
    });
    expect(db.repair.works[0]?.fact).toBe(58);
  });

  it('без материала или с нулевым количеством материалов нет', () => {
    const { api, db } = h();
    api.addWorkLog(input({ material: 'mt2', materialQty: '0' }));
    api.addWorkLog(input({ material: '', materialQty: '5' }));
    expect(db.repair.logs[0]?.materials).toEqual([]);
    expect(db.repair.logs[1]?.materials).toEqual([]);
  });

  it('работа без объекта в запросе определяется по работе', () => {
    const { api, db } = h();
    api.addWorkLog(input({ obj: undefined }));
    expect(db.repair.logs[0]?.obj).toBe('obj-42');
  });

  it.each([
    ['чужая работа', input({ work: 'w4' }), 'validation', 'Выберите работу этого объекта'],
    ['нет работы', input({ work: 'w99' }), 'validation', 'Выберите работу этого объекта'],
    ['объём 0', input({ volume: 0 }), 'validation', 'Объём должен быть больше нуля'],
    ['объём не число', input({ volume: 'много' }), 'validation', 'Объём должен быть больше нуля'],
    ['объём отрицательный', input({ volume: '-3' }), 'validation', 'Объём должен быть больше нуля'],
    [
      'объём выше плана на 10%',
      input({ volume: 47.7 }),
      'validation',
      'Объём превышает план более чем на 10%: осталось 38 м²',
    ],
    ['нет бригады', input({ crew: [] }), 'validation', 'Отметьте работников'],
    ['нет фото', input({ photos: 0 }), 'validation', 'Добавьте хотя бы одно фото'],
  ])('%s: «%s»', (_n, args, code, message) => {
    const { api, db } = h();
    expect(apiErr(() => api.addWorkLog(args))).toEqual({ code, message });
    expect(db.repair.logs).toHaveLength(5);
  });

  it('предел плана +10 %: 47,6 м² проходит (58 + 47,6 = 105,6 = 96 × 1,1)', () => {
    const { api } = h();
    expect(() => api.addWorkLog(input({ volume: 47.6 }))).not.toThrow();
  });

  it('отметку шлёт только прораб этого объекта (no_scope)', () => {
    const own = h('m-petrova');
    expect(apiErr(() => own.api.addWorkLog(input()))).toEqual({
      code: 'no_scope',
      message: 'Отметку по объекту отправляет его прораб',
    });
    const cafe = h();
    expect(apiErr(() => cafe.api.addWorkLog(input({ obj: 'obj-45', work: 'w10' })))).toMatchObject({
      code: 'no_scope',
    });
  });

  it('объект сдан — conflict', () => {
    const { api } = h();
    expect(apiErr(() => api.addWorkLog(input({ obj: 'obj-27', work: 'w12' })))).toEqual({
      code: 'conflict',
      message: 'Объект сдан: новые отметки не принимаются',
    });
  });

  it('права: владелец без роли прораба — не отправляет (прораб — не он); офис — no_scope', () => {
    expect(apiErr(() => h(OWNER).api.addWorkLog(input()))).toMatchObject({ code: 'no_scope' });
    expect(apiErr(() => h('m-morozova').api.addWorkLog(input()))).toMatchObject({
      code: 'no_scope',
    });
    expect(apiErr(() => h('m-kotova').api.addWorkLog(input()))).toMatchObject({
      code: 'no_permission',
    });
  });

  it('модуль отключён — module_readonly; trial закончился — subscription_restricted', () => {
    const off = h();
    off.db.modules.repair = { enabled: false, history: true };
    expect(apiErr(() => off.api.addWorkLog(input())).code).toBe('module_readonly');
    const trial = h();
    restrictTenant(trial.db);
    expect(apiErr(() => trial.api.addWorkLog(input()))).toEqual({
      code: 'subscription_restricted',
      message: 'Пробный период завершён: новые операции недоступны. История доступна для чтения.',
    });
  });
});

describe('acceptWorkLog: приёмка объёма', () => {
  it('успех: «Принят», факт растёт, материалы списываются не ниже нуля', () => {
    const { api, db } = h(OWNER);
    api.acceptWorkLog('WL-09');
    expect(db.repair.logs.find((l) => l.id === 'WL-09')?.status).toBe('Принят');
    expect(db.repair.works.find((w) => w.id === 'w6')?.fact).toBe(58);
    expect(db.repair.materials.find((m) => m.id === 'mt4')?.qty).toBe(6);
  });

  it('материал не уходит в минус', () => {
    const { api, db } = h(OWNER);
    const l = db.repair.logs.find((x) => x.id === 'WL-09');
    if (l) l.materials = [['mt4', 999]];
    api.acceptWorkLog('WL-09');
    expect(db.repair.materials.find((m) => m.id === 'mt4')?.qty).toBe(0);
  });

  it('отметка с несуществующим материалом принимается без списания', () => {
    const { api, db } = h(OWNER);
    const l = db.repair.logs.find((x) => x.id === 'WL-09');
    if (l) l.materials = [['mt-x', 3]];
    expect(() => api.acceptWorkLog('WL-09')).not.toThrow();
  });

  it('повторная приёмка — conflict «Отметка уже обработана»', () => {
    const { api } = h(OWNER);
    expect(apiErr(() => api.acceptWorkLog('WL-11'))).toEqual({
      code: 'conflict',
      message: 'Отметка уже обработана',
    });
  });

  it('нет отметки — not_found', () => {
    expect(apiErr(() => h(OWNER).api.acceptWorkLog('WL-99'))).toEqual({
      code: 'not_found',
      message: 'Отметка не найдена',
    });
  });

  it('принимает офис с правом review; прораб — нет', () => {
    expect(() => h('m-morozova').api.acceptWorkLog('WL-09')).not.toThrow();
    expect(apiErr(() => h('m-sokolov').api.acceptWorkLog('WL-09')).code).toBe('no_permission');
  });

  it('при ограниченной подписке приёмка закрыта (расхождение эталона №3 документа)', () => {
    const { api, db } = h(OWNER);
    restrictTenant(db);
    expect(apiErr(() => api.acceptWorkLog('WL-09')).code).toBe('subscription_restricted');
    expect(db.repair.logs.find((l) => l.id === 'WL-09')?.status).toBe('На проверке');
  });
});

describe('returnWorkLog: возврат отметки с причиной (RS-09)', () => {
  it('успех: «Возвращён», причина сохранена, факт не меняется, прораб уведомлён', () => {
    const { api, db } = h(OWNER);
    api.returnWorkLog('WL-09', '  Нет фото плинтуса  ');
    const l = db.repair.logs.find((x) => x.id === 'WL-09');
    expect(l).toMatchObject({ status: 'Возвращён', reason: 'Нет фото плинтуса' });
    expect(db.repair.works.find((w) => w.id === 'w6')?.fact).toBe(40);
    expect(db.repair.materials.find((m) => m.id === 'mt4')?.qty).toBe(24);
    expect(db.events?.[0]).toMatchObject({
      text: 'Отметка WL-09 · Укладка ламината возвращена: Нет фото плинтуса',
      to: ['m-sokolov'],
    });
  });

  it('причина обязательна; обработанная отметка и неизвестная — ошибки', () => {
    const { api } = h(OWNER);
    expect(apiErr(() => api.returnWorkLog('WL-09', '  '))).toEqual({
      code: 'validation',
      message: 'Укажите причину возврата',
    });
    expect(apiErr(() => api.returnWorkLog('WL-11', 'x'))).toEqual({
      code: 'conflict',
      message: 'Отметка уже обработана',
    });
    expect(apiErr(() => api.returnWorkLog('WL-99', 'x')).code).toBe('not_found');
  });

  it('возвращает только приёмщик; при ограниченной подписке закрыто', () => {
    expect(apiErr(() => h('m-sokolov').api.returnWorkLog('WL-09', 'x')).code).toBe('no_permission');
    const t = h(OWNER);
    restrictTenant(t.db);
    expect(apiErr(() => t.api.returnWorkLog('WL-09', 'x')).code).toBe('subscription_restricted');
  });

  it('возвращённую отметку можно принять только после новой отправки: повторная приёмка — conflict', () => {
    const { api } = h(OWNER);
    api.returnWorkLog('WL-09', 'x');
    expect(apiErr(() => api.acceptWorkLog('WL-09')).code).toBe('conflict');
  });
});

describe('assignForeman: назначение прораба', () => {
  it('успех: ФИО и id, событие назначенному', () => {
    const { api, db } = h(OWNER);
    api.assignForeman('obj-45', 'm-sokolov');
    expect(db.repair.objects.find((o) => o.id === 'obj-45')).toMatchObject({
      foreman: 'Алексей Соколов',
      foremanId: 'm-sokolov',
    });
    expect(db.events?.[0]).toMatchObject({
      text: 'Вы назначены прорабом объекта «Кофейня на Покровке»',
      to: ['m-sokolov'],
    });
  });

  it('ошибки дословно', () => {
    const { api } = h(OWNER);
    expect(apiErr(() => api.assignForeman('obj-99', 'm-sokolov'))).toEqual({
      code: 'not_found',
      message: 'Объект не найден',
    });
    expect(apiErr(() => api.assignForeman('obj-42', 'm-petrova'))).toEqual({
      code: 'conflict',
      message: 'Прораб уже назначен: Алексей Соколов',
    });
    expect(apiErr(() => api.assignForeman('obj-45', 'm-nobody'))).toEqual({
      code: 'validation',
      message: 'Сотрудник не найден или не активен',
    });
  });

  it('заблокированный участник не назначается', () => {
    const { api, db } = h(OWNER);
    const m = db.members.find((x) => x.id === 'm-petrova');
    if (m) m.status = 'blocked';
    expect(apiErr(() => api.assignForeman('obj-45', 'm-petrova')).code).toBe('validation');
  });

  it('объект-черновик: прораб назначается после активации (Q-W4.00-repair-16)', () => {
    const { api } = h(OWNER);
    expect(apiErr(() => api.assignForeman('obj-50', 'm-sokolov'))).toEqual({
      code: 'conflict',
      message: 'Объект ещё не активирован: прораб назначается после договора',
    });
  });

  it('назначает владелец или офис с edit; прораб и чужая роль — нет', () => {
    expect(() => h('m-morozova').api.assignForeman('obj-45', 'm-sokolov')).not.toThrow();
    expect(apiErr(() => h('m-sokolov').api.assignForeman('obj-45', 'm-sokolov')).code).toBe(
      'no_permission',
    );
  });

  it('ограниченная подписка — subscription_restricted', () => {
    const { api, db } = h(OWNER);
    restrictTenant(db);
    expect(apiErr(() => api.assignForeman('obj-45', 'm-sokolov')).code).toBe(
      'subscription_restricted',
    );
  });
});

const change = (o: Record<string, unknown> = {}) => ({
  obj: 'obj-42',
  title: '  Перенос выключателя  ',
  volume: '2,5',
  unit: 'м',
  note: '  у входа ',
  photos: 1,
  ...o,
});

describe('proposeChange: допработа от прораба', () => {
  it('успех: «proposed», ДР-<число+1>, поля очищены, событие владельцу', () => {
    const { api, db } = h();
    api.proposeChange(change());
    expect(db.repair.changes[0]).toEqual({
      id: 'ДР-2',
      obj: 'obj-42',
      at: '10:30',
      by: 'Алексей Соколов',
      title: 'Перенос выключателя',
      volume: 2.5,
      unit: 'м',
      note: 'у входа',
      photos: 1,
      status: 'proposed',
    });
    expect(db.events?.[0]).toMatchObject({
      text: 'Прораб предложил допработу «Перенос выключателя» · ЖК Речной · квартира 42 — нужна оценка',
      to: [OWNER],
    });
  });

  it('единица по умолчанию «шт», заметка пустая', () => {
    const { api, db } = h();
    api.proposeChange(change({ unit: '', note: undefined }));
    expect(db.repair.changes[0]).toMatchObject({ unit: 'шт', note: '' });
  });

  it.each([
    ['нет объекта', change({ obj: 'obj-99' }), 'not_found', 'Объект не найден'],
    [
      'чужой объект',
      change({ obj: 'obj-45' }),
      'no_scope',
      'Допработу по объекту предлагает его прораб',
    ],
    [
      'черновик',
      change({ obj: 'obj-50' }),
      'no_scope',
      'Допработу по объекту предлагает его прораб',
    ],
    [
      'сдан',
      change({ obj: 'obj-27' }),
      'conflict',
      'Объект сдан: допработы по нему не принимаются',
    ],
    ['короткое описание', change({ title: ' ab ' }), 'validation', 'Опишите, что нужно сделать'],
    ['нет объёма', change({ volume: '' }), 'validation', 'Укажите объём больше нуля'],
    ['нулевой объём', change({ volume: 0 }), 'validation', 'Укажите объём больше нуля'],
    ['нет фото', change({ photos: 0 }), 'validation', 'Приложите хотя бы одно фото'],
  ])('%s', (_n, args, code, message) => {
    const { api, db } = h();
    expect(apiErr(() => api.proposeChange(args))).toEqual({ code, message });
    expect(db.repair.changes).toHaveLength(1);
  });

  it('до договора допработ нет: у своего черновика — «правки вносятся новой версией сметы»', () => {
    const { api, db } = h();
    const o = db.repair.objects.find((x) => x.id === 'obj-50');
    if (o) Object.assign(o, { foreman: 'Алексей Соколов', foremanId: 'm-sokolov' });
    expect(apiErr(() => api.proposeChange(change({ obj: 'obj-50' })))).toEqual({
      code: 'conflict',
      message: 'До договора допработ нет: правки вносятся новой версией сметы',
    });
  });

  it('предлагает только прораб (право create); офис без роли прораба — no_scope', () => {
    expect(apiErr(() => h('m-kotova').api.proposeChange(change())).code).toBe('no_permission');
    expect(apiErr(() => h('m-morozova').api.proposeChange(change())).code).toBe('no_scope');
  });

  it('ограниченная подписка — subscription_restricted', () => {
    const { api, db } = h();
    restrictTenant(db);
    expect(apiErr(() => api.proposeChange(change())).code).toBe('subscription_restricted');
  });
});

describe('setChange: статус допработы из сметы', () => {
  it('priced → sent → signed: работа появляется у прораба, событие с номером допсоглашения', () => {
    const { api, db } = h(OWNER);
    api.setChange(['ДР-1'], 'priced');
    expect(db.repair.changes[0]?.status).toBe('priced');
    api.setChange(['ДР-1'], 'sent', { agreement: 1 });
    expect(db.repair.changes[0]).toMatchObject({ status: 'sent', agreement: 1 });
    api.setChange(['ДР-1'], 'signed', { agreement: 1 });
    expect(db.repair.works.at(-1)).toEqual({
      id: 'w-ДР-1',
      obj: 'obj-42',
      name: 'Перенос розеток на кухне',
      unit: 'шт',
      plan: 6,
      fact: 0,
    });
    expect(db.events?.[0]).toMatchObject({
      text: 'Допсоглашение № 1 подписано: «Перенос розеток на кухне» добавлена в работы · ЖК Речной · квартира 42',
      to: ['m-sokolov'],
    });
  });

  it('подпись без номера допсоглашения: без « № »', () => {
    const { api, db } = h(OWNER);
    api.setChange(['ДР-1'], 'signed');
    expect(db.events?.[0]?.text).toBe(
      'Допсоглашение подписано: «Перенос розеток на кухне» добавлена в работы · ЖК Речной · квартира 42',
    );
  });

  it('отклонение: причина сохраняется, без причины — «Без причины»; прораб уведомлён', () => {
    const a = h(OWNER);
    a.api.setChange(['ДР-1'], 'rejected', { reason: 'Заказчик отказался' });
    expect(a.db.repair.changes[0]).toMatchObject({
      status: 'rejected',
      reason: 'Заказчик отказался',
    });
    expect(a.db.events?.[0]).toMatchObject({
      text: 'Допработа ДР-1 «Перенос розеток на кухне» отклонена: Заказчик отказался',
      to: ['m-sokolov'],
    });
    const b = h(OWNER);
    b.api.setChange(['ДР-1'], 'rejected');
    expect(b.db.repair.changes[0]?.reason).toBe('Без причины');
  });

  it('повтор того же статуса — без изменений и событий', () => {
    const { api, db } = h(OWNER);
    api.setChange(['ДР-1'], 'proposed');
    expect(db.events).toEqual([]);
    expect(db.repair.works).toHaveLength(13);
  });

  it('подписанную и отклонённую нельзя менять — conflict с номером', () => {
    const a = h(OWNER);
    a.api.setChange(['ДР-1'], 'signed');
    expect(apiErr(() => a.api.setChange(['ДР-1'], 'rejected'))).toEqual({
      code: 'conflict',
      message: 'Допработа ДР-1 уже подписана',
    });
    const b = h(OWNER);
    b.api.setChange(['ДР-1'], 'rejected');
    expect(apiErr(() => b.api.setChange(['ДР-1'], 'priced'))).toEqual({
      code: 'conflict',
      message: 'Допработа ДР-1 уже отклонена',
    });
  });

  it('несколько допработ сразу: все получают статус', () => {
    const { api, db } = h(OWNER);
    const first = db.repair.changes[0];
    if (first) db.repair.changes.push({ ...structuredClone(first), id: 'ДР-2' });
    api.setChange(['ДР-1', 'ДР-2'], 'priced');
    expect(db.repair.changes.map((c) => c.status)).toEqual(['priced', 'priced']);
  });

  it('ошибки: неизвестный статус и несуществующая допработа', () => {
    const { api } = h(OWNER);
    expect(apiErr(() => api.setChange(['ДР-1'], 'wow' as never))).toEqual({
      code: 'validation',
      message: 'Неизвестный статус допработы',
    });
    expect(apiErr(() => api.setChange(['ДР-9'], 'priced'))).toEqual({
      code: 'not_found',
      message: 'Допработа не найдена',
    });
    expect(apiErr(() => api.setChange(undefined as never, 'priced')).code).toBe('not_found');
  });

  it('оценивает офис с правом edit; прораб — нет; подписка ограничена — закрыто', () => {
    expect(() => h('m-morozova').api.setChange(['ДР-1'], 'priced')).not.toThrow();
    expect(apiErr(() => h('m-sokolov').api.setChange(['ДР-1'], 'priced')).code).toBe(
      'no_permission',
    );
    const t = h(OWNER);
    restrictTenant(t.db);
    expect(apiErr(() => t.api.setChange(['ДР-1'], 'priced')).code).toBe('subscription_restricted');
  });
});

describe('доступ без среза', () => {
  it('в организации без среза ремонта команды дают not_found, а не падение', () => {
    const db = altaRepairDb();
    Reflect.deleteProperty(db, 'repair');
    const { api } = harness<RepairApi>(repairCommands, OWNER, db as never);
    expect(apiErr(() => api.acceptWorkLog('WL-09')).code).toBe('not_found');
  });
});
