// Сводка объекта и список объектов (Ортус CRM.dc.html:4284–4355, W6.10): «Требует решения»,
// готовность, срок сдачи, фильтры, поиск, сортировка. Тексты — дословно из эталона 19.10.
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../core/clock.ts';
import { altaRepairDb } from './fixture.test-util.ts';
import {
  daysUntil,
  EMPTY_LIST_TEXT,
  repairContext,
  repairList,
  repairSum,
  type ChildStatus,
  type TodoItem,
} from './summary.ts';
import { repairView } from './view.ts';

const today = fixedClock('2026-10-01T10:30:00+03:00');
const sumFor = (actor: string, persona: string, obj: string, child: ChildStatus | null = null) => {
  const db = altaRepairDb();
  const cx = repairContext(db, actor, persona);
  const o = db.repair.objects.find((x) => x.id === obj);
  if (!o) throw new Error(obj);
  return repairSum(db, o, cx, child);
};
const brief = (t: TodoItem[]) => t.map((x) => [x.tag, x.tone, x.title, x.primary, x.tab]);

describe('контекст пользователя', () => {
  it('владелец: приёмка, правка, деньги; не прораб — отметки не отправляет', () => {
    const cx = repairContext(altaRepairDb(), 'm-owner', 'owner');
    expect(cx).toMatchObject({
      isFm: false,
      canLog: false,
      canReview: true,
      canEdit: true,
      canFin: true,
      me: 'Дарья Зимина',
    });
  });

  it('прораб: отметки да, приёмка, правка и деньги — нет', () => {
    const cx = repairContext(altaRepairDb(), 'm-sokolov', 'foreman');
    expect(cx).toMatchObject({
      isFm: true,
      canLog: true,
      canReview: false,
      canEdit: false,
      canFin: false,
      me: 'Алексей Соколов',
    });
  });

  it('офис: всё, кроме отметок', () => {
    expect(repairContext(altaRepairDb(), 'm-morozova', 'owner')).toMatchObject({
      canReview: true,
      canEdit: true,
      canFin: true,
      canLog: false,
    });
  });
});

describe('«Требует решения» у владельца', () => {
  it('кв. 42 без сводки модуля: допработа ждёт оценки', () => {
    const s = sumFor('m-owner', 'owner', 'obj-42');
    expect(brief(s.todo)).toEqual([
      ['Допработы', 'warn', 'Перенос розеток на кухне: 6 шт', 'Оценить в смете', 'estimate'],
    ]);
    expect(s.todo[0]).toMatchObject({
      icon: 'request_quote',
      meta: 'ДР-1 · предложил Алексей Соколов, 02.10 · фото: 2 · оцените в смете и отправьте допсоглашение заказчику',
      action: { kind: 'open', tab: 'estimate' },
    });
  });

  it('кв. 117: приёмка отметки, акт к отправке, заявка на материал', () => {
    const s = sumFor('m-owner', 'owner', 'obj-38');
    expect(brief(s.todo)).toEqual([
      ['Приёмка', 'warn', 'Укладка ламината: 18 м²', 'Принять объём', 'works'],
      [
        'Документы',
        'neutral',
        'Акт № 3 · чистовая отделка: готов к отправке',
        'Открыть документы',
        'docs',
      ],
      [
        'Снабжение',
        'info',
        'Заявки на материалы ждут решения снабжения: 1',
        'Решить в снабжении',
        'supply',
      ],
    ]);
    expect(s.todo[0]).toMatchObject({
      icon: 'fact_check',
      meta: 'Отметка WL-09 · Алексей Соколов, 30.09 · фото: 3 · Роман Сергеев, Денис Волков',
      action: { kind: 'accept-log', logId: 'WL-09' },
    });
    expect(s.todo[2]?.meta).toBe('Плинтус МДФ, 42 м · выдать со склада или купить');
    expect(s.todo[2]?.action).toEqual({ kind: 'open-supply' });
  });

  it('кофейня без прораба: назначить; начало работ в подсказке', () => {
    const s = sumFor('m-owner', 'owner', 'obj-45');
    expect(brief(s.todo)).toEqual([
      ['Команда', 'warn', 'Не назначен прораб', 'Назначить прораба', 'overview'],
    ]);
    expect(s.todo[0]).toMatchObject({
      meta: 'Без прораба нет отметок работ и заявок на материалы · начало работ 06.10',
      action: { kind: 'assign-foreman' },
    });
  });

  it('сданный объект и объект без вопросов: решений нет', () => {
    expect(sumFor('m-owner', 'owner', 'obj-27').todo).toEqual([]);
    expect(sumFor('m-owner', 'owner', 'obj-31').todo).toEqual([]);
  });

  it('черновик: «Смета не собрана» → «Собрать смету»', () => {
    const s = sumFor('m-owner', 'owner', 'obj-50');
    expect(brief(s.todo)).toEqual([
      ['Смета', 'warn', 'Смета не собрана', 'Собрать смету', 'estimate'],
    ]);
    expect(s.todo[0]?.meta).toBe(
      'Замер выполнен 02.10 · соберите черновик по шаблону: объёмы из замера, цены из справочника',
    );
    expect(s.estLabel).toBe('Смета не собрана');
  });

  it.each([
    ['draft', 'edit_note', 'neutral', 'Черновик сметы не отправлен заказчику', 'Открыть смету'],
    ['sent', 'schedule_send', 'info', 'Смета у заказчика на согласовании', 'Открыть смету'],
    ['approved', 'handshake', 'info', 'Смета согласована: следующий шаг — договор', ''],
  ] as const)('черновик, смета «%s»', (st, icon, tone, title, primary) => {
    const s = sumFor('m-owner', 'owner', 'obj-50', {
      objEst: { 'obj-50': { st, label: 'Версия 1 · 1 078 533 ₽' } },
    });
    expect(s.todo).toHaveLength(1);
    expect(s.todo[0]).toMatchObject({ icon, tone, title, primary });
    expect(s.todo[0]?.meta).toContain('Версия 1 · 1 078 533 ₽');
  });

  it('сводка дочернего модуля: сдвиг сдачи, нет исполнителя, подпись заказчика, смета у заказчика', () => {
    const s = sumFor('m-owner', 'owner', 'obj-42', {
      sched: {
        due: '27.11',
        forecast: '01.12',
        slip: 2,
        slipText: '2 раб. дня',
        why: '«Электрика · черновая» — задержка подрядчика: поставка кабеля',
        noWho: ['«Плитка в санузле» с 10.11'],
      },
      req: ['Ламинат 33 класс, 52 м²'],
      draft: ['Акт № 1 · демонтаж'],
      sms: ['Допсоглашение № 1'],
      est: 'sent',
      estLabel: 'Смета версии 3',
      reqBy: { 'obj-42': ['Ламинат 33 класс, 52 м²', 'Плитка, 18 м²'] },
    });
    expect(brief(s.todo)).toEqual([
      [
        'График',
        'warn',
        'Сдача сдвигается на 2 раб. дня: прогноз 01.12',
        'Открыть график',
        'schedule',
      ],
      [
        'График',
        'neutral',
        'Не назначен исполнитель: «Плитка в санузле» с 10.11',
        'Открыть график',
        'schedule',
      ],
      [
        'Документы',
        'warn',
        'Допсоглашение № 1: ждёт подписи заказчика',
        'Открыть документы',
        'docs',
      ],
      ['Документы', 'neutral', 'Акт № 1 · демонтаж: готов к отправке', 'Открыть документы', 'docs'],
      [
        'Снабжение',
        'info',
        'Заявки на материалы ждут решения снабжения: 2',
        'Решить в снабжении',
        'supply',
      ],
      ['Смета', 'warn', 'Смета версии 3 у заказчика', 'Открыть смету', 'estimate'],
      ['Допработы', 'warn', 'Перенос розеток на кухне: 6 шт', 'Оценить в смете', 'estimate'],
    ]);
    expect(s.todo[0]?.meta).toBe(
      'По договору 27.11 · «Электрика · черновая» — задержка подрядчика: поставка кабеля',
    );
    expect(s.due).toBe('27.11');
    expect(s.slip).toBe('01.12');
  });

  it('допработа: приоритет статуса — оценена, у заказчика, подписана или отклонена', () => {
    const db = altaRepairDb();
    const c = db.repair.changes[0];
    if (!c) throw new Error('нет допработы');
    const cx = repairContext(db, 'm-owner', 'owner');
    const o = db.repair.objects[0];
    if (!o) throw new Error('нет объекта');
    c.status = 'priced';
    expect(repairSum(db, o, cx).todo[0]).toMatchObject({
      icon: 'edit_note',
      title: 'ДР-1 в черновике допсоглашения',
      meta: 'Перенос розеток на кухне: 6 шт · проверьте строки и отправьте заказчику на подпись',
      primary: 'Открыть смету',
    });
    c.status = 'sent';
    expect(repairSum(db, o, cx).todo).toEqual([]);
    c.status = 'signed';
    expect(repairSum(db, o, cx).todo).toEqual([]);
  });

  it('без права финансов смета, документы к отправке и допработы в очереди не показываются', () => {
    const db = altaRepairDb();
    const cx = { ...repairContext(db, 'm-owner', 'owner'), canFin: false };
    const o = db.repair.objects.find((x) => x.id === 'obj-38');
    if (!o) throw new Error('нет объекта');
    expect(brief(repairSum(db, o, cx).todo)).toEqual([
      ['Приёмка', 'warn', 'Укладка ламината: 18 м²', 'Принять объём', 'works'],
      [
        'Снабжение',
        'info',
        'Заявки на материалы ждут решения снабжения: 1',
        'Решить в снабжении',
        'supply',
      ],
    ]);
  });
});

describe('«Мои вопросы по объекту» у прораба', () => {
  it('кв. 42: отметка за сегодня не отправлена; допработа у офиса на оценке', () => {
    const s = sumFor('m-sokolov', 'foreman', 'obj-42');
    expect(brief(s.todo)).toEqual([
      ['Сегодня', 'neutral', 'Отметка за сегодня не отправлена', 'Отметить работу', 'works'],
      ['Допработы', 'info', 'ДР-1 у офиса на оценке', '', 'works'],
    ]);
    expect(s.todo[1]?.meta).toBe('Перенос розеток на кухне: 6 шт · отправлена 02.10');
    expect(s.canLog).toBe(true);
  });

  it('кв. 117: отметка ждёт приёмки (кнопки приёмки нет), «Отметить работу» не предлагается', () => {
    const s = sumFor('m-sokolov', 'foreman', 'obj-38');
    expect(brief(s.todo).slice(0, 1)).toEqual([
      ['Приёмка', 'info', 'Отметка WL-09 ждёт приёмки', '', 'works'],
    ]);
    expect(s.todo[0]?.meta).toBe('Укладка ламината: 18 м² · отправлена 30.09');
    expect(s.todo.find((t) => t.primary === 'Отметить работу')).toBeUndefined();
    expect(s.todo.find((t) => t.tag === 'Документы')).toBeUndefined();
  });

  it('допработа у заказчика: «ждёт подписи кодом из SMS»', () => {
    const db = altaRepairDb();
    const c = db.repair.changes[0];
    if (c) c.status = 'sent';
    const o = db.repair.objects[0];
    if (!o) throw new Error('нет объекта');
    const t = repairSum(db, o, repairContext(db, 'm-sokolov', 'foreman')).todo.find(
      (x) => x.tag === 'Допработы',
    );
    expect(t).toMatchObject({
      icon: 'sms',
      title: 'ДР-1 в допсоглашении у заказчика',
      meta: 'Перенос розеток на кухне: 6 шт · ждёт подписи кодом из SMS',
    });
  });

  it('чужой объект: отметить работу нельзя', () => {
    const db = altaRepairDb();
    const cx = repairContext(db, 'm-petrova', 'foreman');
    const o = db.repair.objects[0];
    if (!o) throw new Error('нет объекта');
    expect(repairSum(db, o, cx).canLog).toBe(false);
  });
});

describe('готовность и срок', () => {
  it('кв. 42: принято 48 %, на приёмке 0; срок по договору 27.11', () => {
    const s = sumFor('m-owner', 'owner', 'obj-42');
    expect(s.readiness).toEqual({ accepted: 48, pending: 0 });
    expect([s.factSum, s.pendSum]).toEqual([100, 0]);
    expect(s.due).toBe('27.11');
    expect(s.slip).toBeNull();
  });

  it('кв. 117: 82 % принято, 4 % на приёмке (352 + 18 из 430 м²)', () => {
    const s = sumFor('m-owner', 'owner', 'obj-38');
    expect(s.readiness).toEqual({ accepted: 82, pending: 4 });
  });

  it('готовность не превышает 100 %; план 0 не делит на ноль', () => {
    const db = altaRepairDb();
    for (const w of db.repair.works) if (w.obj === 'obj-42') w.fact = w.plan * 2;
    const cx = repairContext(db, 'm-owner', 'owner');
    const o = db.repair.objects[0];
    if (!o) throw new Error('нет объекта');
    expect(repairSum(db, o, cx).readiness.accepted).toBe(100);
    for (const w of db.repair.works) if (w.obj === 'obj-42') w.plan = 0;
    expect(repairSum(db, o, cx).readiness.accepted).toBe(100);
  });

  it('daysUntil: «ДД.ММ» от «сегодня» по часам домена', () => {
    expect(daysUntil(today, '27.11')).toBe(57);
    expect(daysUntil(today, '01.10')).toBe(0);
    expect(daysUntil(today, '30.09')).toBe(-1);
    expect(daysUntil(today, null)).toBeNull();
    expect(daysUntil(today, 'скоро')).toBeNull();
  });
});

const list = (
  actor: string,
  persona: string,
  opts: { filter?: string; q?: string } = {},
  child: ChildStatus | null = null,
) => {
  const db = altaRepairDb();
  const cx = repairContext(db, actor, persona);
  const slice = repairView(db, actor);
  return repairList({ db, objects: slice.objects, cx, child, today, ...opts });
};

describe('список объектов владельца', () => {
  it('фильтры с числами: активные 4, требуют решения 4, до договора 1, сданы 1', () => {
    expect(list('m-owner', 'owner').filters).toEqual([
      { key: 'active', label: 'Активные', n: 4 },
      { key: 'todo', label: 'Требуют решения', n: 4 },
      { key: 'pre', label: 'До договора', n: 1 },
      { key: 'done', label: 'Сданы', n: 1 },
    ]);
  });

  it('сначала то, что ждёт решения; внутри — по сроку сдачи', () => {
    expect(list('m-owner', 'owner').rows.map((r) => r.o.id)).toEqual([
      'obj-38',
      'obj-42',
      'obj-45',
      'obj-31',
    ]);
  });

  it('«Требуют решения» включает черновики; «До договора» — только их; «Сданы»', () => {
    expect(list('m-owner', 'owner', { filter: 'todo' }).rows.map((r) => r.o.id)).toEqual([
      'obj-38',
      'obj-42',
      'obj-45',
      'obj-50',
    ]);
    expect(list('m-owner', 'owner', { filter: 'pre' }).rows.map((r) => r.o.id)).toEqual(['obj-50']);
    expect(list('m-owner', 'owner', { filter: 'done' }).rows.map((r) => r.o.id)).toEqual([
      'obj-27',
    ]);
  });

  it('неизвестный фильтр — «Активные»', () => {
    expect(list('m-owner', 'owner', { filter: 'zzz' }).key).toBe('active');
  });

  it('поиск по адресу, заказчику, прорабу и названию без учёта регистра', () => {
    const ids = (q: string) => list('m-owner', 'owner', { q }).rows.map((r) => r.o.id);
    expect(ids('речн')).toEqual(['obj-42']);
    expect(ids('  ЛЕБЕДЕВ ')).toEqual(['obj-38']);
    expect(ids('соколов')).toEqual(['obj-38', 'obj-42', 'obj-31']);
    expect(ids('Покровка')).toEqual(['obj-45']);
    expect(ids('нет такого')).toEqual([]);
  });

  it('строка: срок, готовность, прораб, главный вопрос и «ещё N вопросов»', () => {
    const [r] = list('m-owner', 'owner').rows;
    expect(r).toMatchObject({
      stageLabel: 'Чистовая отделка',
      stageKind: 'active',
      showBar: true,
      accepted: 82,
      pendingPct: 4,
      dueLabel: 'Сдача',
      dueText: '17.10',
      dueSub: 'через 16 дней',
      foreman: 'Алексей Соколов',
      more: 'ещё 2 вопроса',
    });
    expect(r?.top).toMatchObject({ tag: 'Приёмка' });
  });

  it('строки: прогноз, без прораба, «после договора», сдан с гарантией', () => {
    const all = list('m-owner', 'owner', { filter: 'todo' }).rows;
    const cafe = all.find((r) => r.o.id === 'obj-45');
    expect(cafe).toMatchObject({ foreman: 'не назначен', dueSub: 'через 80 дней', more: '' });
    const draft = all.find((r) => r.o.id === 'obj-50');
    expect(draft).toMatchObject({
      stageKind: 'draft',
      stageLabel: 'Замер · до договора',
      showBar: false,
      dueLabel: 'Замер',
      dueText: '02.10',
      dueSub: 'договора ещё нет',
      foreman: 'после договора',
      estLabel: 'Смета не собрана',
    });
    const done = list('m-owner', 'owner', { filter: 'done' }).rows[0];
    expect(done).toMatchObject({
      stageKind: 'done',
      dueLabel: 'Сдан',
      dueText: '12.09',
      dueSub: 'гарантия до 12.09.2027',
      pendingPct: 0,
    });
  });

  it('срок со сдвигом: «прогноз · по договору …»; просрочка; сегодня', () => {
    const child: ChildStatus = {
      sched: { due: '27.11', forecast: '01.12', slip: 2 },
      req: [],
      draft: [],
      sms: [],
      est: 'approved',
    };
    const r = list('m-owner', 'owner', {}, child).rows.find((x) => x.o.id === 'obj-42');
    expect(r).toMatchObject({ dueText: '01.12', dueSub: 'прогноз · по договору 27.11' });
    const db = altaRepairDb();
    const cx = repairContext(db, 'm-owner', 'owner');
    const o = db.repair.objects.find((x) => x.id === 'obj-38');
    if (o) o.due = '30.09';
    const late = repairList({ db, objects: db.repair.objects, cx, child: null, today });
    expect(late.rows.find((x) => x.o.id === 'obj-38')?.dueSub).toBe('просрочено на 1 день');
    if (o) o.due = '01.10';
    const now = repairList({ db, objects: db.repair.objects, cx, child: null, today });
    expect(now.rows.find((x) => x.o.id === 'obj-38')?.dueSub).toBe('сегодня');
  });
});

describe('список объектов прораба', () => {
  it('только «Активные» и «Сданы»; без поиска и колонки прораба', () => {
    const r = list('m-sokolov', 'foreman');
    expect(r.filters.map((f) => f.key)).toEqual(['active', 'done']);
    expect(r.rows.map((x) => x.o.id)).toEqual(['obj-38', 'obj-42', 'obj-31']);
    expect(r.subtitle).toBe('Объекты, где вы прораб');
    expect(r.hasSearch).toBe(false);
    expect(r.showForeman).toBe(false);
  });

  it('«Отметить работу» в строке только у объектов с остатком плана', () => {
    const r = list('m-sokolov', 'foreman').rows;
    expect(r.map((x) => [x.o.id, x.canLog])).toEqual([
      ['obj-38', true],
      ['obj-42', true],
      ['obj-31', true],
    ]);
  });

  it('прораб без объектов: пустое состояние', () => {
    const r = list('m-petrova', 'foreman');
    expect(r.rows).toEqual([]);
    expect(r.empty).toEqual({
      icon: 'home_work',
      title: 'Вам пока не назначены объекты',
      text: 'Объект появится здесь, когда владелец назначит вас прорабом.',
    });
  });
});

describe('пустые состояния списка', () => {
  it('нет объектов у владельца; по фильтру; по поиску', () => {
    expect(EMPTY_LIST_TEXT.ownerNone).toEqual({
      icon: 'home_work',
      title: 'Объектов пока нет',
      text: 'Объект-черновик создаётся из заявки на этапе «Замер».',
    });
    const db = altaRepairDb();
    const cx = repairContext(db, 'm-owner', 'owner');
    const none = repairList({ db, objects: [], cx, child: null, today });
    expect(none.empty).toEqual(EMPTY_LIST_TEXT.ownerNone);
    const byFilter = list('m-owner', 'owner', { filter: 'pre', q: '' });
    expect(byFilter.empty).toBeNull();
    const nothing = list('m-owner', 'owner', { q: 'zzz' });
    expect(nothing.empty).toEqual({
      icon: 'search_off',
      title: 'По фильтру объектов нет',
      text: 'Измените запрос или очистите поиск.',
    });
    const emptyFilter = list('m-owner', 'owner', { filter: 'done', q: 'речн' });
    expect(emptyFilter.empty?.text).toBe('Измените запрос или очистите поиск.');
  });

  it('фильтр без объектов и без поиска: «Выберите другой фильтр.»', () => {
    const db = altaRepairDb();
    const cx = repairContext(db, 'm-owner', 'owner');
    const only = db.repair.objects.filter((o) => o.id === 'obj-42');
    const r = repairList({ db, objects: only, cx, child: null, today, filter: 'done' });
    expect(r.empty).toEqual({
      icon: 'search_off',
      title: 'По фильтру объектов нет',
      text: 'Выберите другой фильтр.',
    });
  });
});
