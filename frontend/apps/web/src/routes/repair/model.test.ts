// W6.20 · Модель страницы «Объекты»: сводка списка, чипы, «Требует решения», вкладки, обзор 1a, проверка форм.
// Ожидания — по эталону design-2026-10-19 («Ортус CRM.dc.html» repairSum :4284, repairListVM :4325, repairCardVM :4356).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  cardChips,
  cardSubtitle,
  dayMonth,
  decisionView,
  filterKeys,
  fullDate,
  listModel,
  moneyRows,
  partition,
  peopleRows,
  qtyText,
  tabsOf,
  unitLabel,
  validateChange,
  validateWorkLog,
  volumeRows,
} from './model.ts';

type S = components['schemas'];

const decision = (kind: S['RepairDecision']['kind'], over: Partial<S['RepairDecision']> = {}) =>
  ({ kind, text: 'Текст', tab: 'overview', ...over }) satisfies S['RepairDecision'];

function project(over: Partial<S['RepairProject']> = {}): S['RepairProject'] {
  return {
    id: 'p1',
    orgUnitId: 'u1',
    name: 'ЖК Речной · квартира 42',
    address: 'Москва, ул. Речная, 5, кв. 42',
    status: 'active',
    foremanMemberId: 'm1',
    workers: [],
    revision: 1,
    access: [],
    measured: true,
    readiness: { acceptedPct: 48, pendingPct: 5, clientPct: 0 },
    todoCount: 0,
    stage: 'Черновая отделка',
    dueOn: '2026-11-27',
    forecastDueOn: '2026-11-27',
    clientName: 'Ольга Смирнова',
    ...over,
  };
}

const names = (id: string | null): string | undefined =>
  id === 'm1' ? 'Алексей Соколов' : undefined;
const base = { foreman: false, filter: undefined, q: '', today: '2026-10-20', foremanName: names };

const objects = [
  project({ id: 'a', name: 'Объект А', status: 'active', todoCount: 0, dueOn: '2026-12-20' }),
  project({
    id: 'b',
    name: 'Объект Б',
    status: 'active',
    todoCount: 2,
    todoTop: decision('work_log_pending', {
      text: 'Грунтование: 6 м²',
      actionLabel: 'Принять объём',
    }),
    dueOn: '2026-11-27',
  }),
  project({
    id: 'c',
    name: 'Черновик В',
    status: 'draft',
    stage: 'Замер',
    foremanMemberId: null,
    todoCount: 1,
    todoTop: decision('estimate_missing', { text: 'Смета не собрана' }),
    dueOn: undefined,
    forecastDueOn: undefined,
  }),
  project({
    id: 'd',
    name: 'Сданный Г',
    status: 'handed_over',
    stage: 'Сдан',
    handedOverOn: '2026-09-12',
    warrantyUntil: '2027-09-12',
    readiness: { acceptedPct: 100, pendingPct: 0, clientPct: 100 },
  }),
];

describe('даты и числа', () => {
  it('dayMonth: Instant и дата → дд.мм по Москве', () => {
    expect(dayMonth('2026-09-30')).toBe('30.09');
    expect(dayMonth('2026-09-30T22:30:00Z')).toBe('01.10');
  });
  it('fullDate: дд.мм.гггг', () => expect(fullDate('2027-09-12')).toBe('12.09.2027'));
  it('qtyText: запятая и без хвоста нулей; unitLabel — подписи эталона', () => {
    expect(qtyText('96.000')).toBe('96');
    expect(qtyText('7.5')).toBe('7,5');
    expect(unitLabel('m2')).toBe('м²');
    expect(unitLabel('set')).toBe('компл');
  });
});

describe('фильтры списка', () => {
  it('прораб видит «Активные» и «Сданы», владелец — четыре', () => {
    expect(filterKeys(true)).toEqual(['active', 'done']);
    expect(filterKeys(false)).toEqual(['active', 'todo', 'draft', 'done']);
  });
  it('partition: active, todo (активные и черновики с вопросами), draft, done', () => {
    const p = partition(objects);
    expect(p.active.map((x) => x.id)).toEqual(['a', 'b']);
    expect(p.todo.map((x) => x.id).sort()).toEqual(['b', 'c']);
    expect(p.draft.map((x) => x.id)).toEqual(['c']);
    expect(p.done.map((x) => x.id)).toEqual(['d']);
  });
  it('подписи и счётчики фильтров; выбран «Активные» по умолчанию', () => {
    const m = listModel(objects, base);
    expect(m.filters.map((f) => [f.label, f.count, f.selected])).toEqual([
      ['Активные', 2, true],
      ['Требуют решения', 2, false],
      ['До договора', 1, false],
      ['Сданы', 1, false],
    ]);
  });
  it('неизвестный фильтр прораба → «Активные»', () => {
    const m = listModel(objects, { ...base, foreman: true, filter: 'draft' });
    expect(m.filters.map((f) => f.label)).toEqual(['Активные', 'Сданы']);
    expect(m.selected).toBe('active');
  });
});

describe('строки списка', () => {
  it('сначала то, что ждёт решения; затем срок сдачи', () => {
    const m = listModel(objects, base);
    expect(m.rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('поиск по адресу, заказчику и прорабу', () => {
    expect(listModel(objects, { ...base, q: 'соколов' }).rows).toHaveLength(2);
    expect(listModel(objects, { ...base, q: 'смирнова', filter: 'draft' }).rows).toHaveLength(1);
    expect(listModel(objects, { ...base, q: 'нет такого' }).rows).toHaveLength(0);
  });
  it('активный объект: чип этапа, готовность, срок «через N дней», прораб, пункт и «ещё N»', () => {
    const r = listModel(objects, base).rows[0];
    expect(r).toMatchObject({
      name: 'Объект Б',
      stage: { label: 'Черновая отделка', tone: 'info', icon: 'construction' },
      showBar: true,
      acceptedPct: 48,
      pendingPct: 5,
      pendingText: '+5% на приёмке',
      dueLabel: 'Сдача',
      due: '27.11',
      dueSub: 'через 38 дней',
      foreman: 'Алексей Соколов',
      more: 'ещё 1 вопрос',
    });
    expect(r?.top).toMatchObject({ tag: 'Приёмка', title: 'Грунтование: 6 м²', tone: 'warn' });
  });
  it('без вопросов — «Решений не требуется» (quiet); просрочка и «сегодня»', () => {
    const rows = listModel(objects, { ...base, today: '2026-12-20' }).rows;
    const a = rows.find((x) => x.id === 'a');
    expect(a?.quiet).toBe(true);
    expect(a?.dueSub).toBe('сегодня');
    const late = listModel(objects, { ...base, today: '2026-12-22' }).rows.find(
      (x) => x.id === 'a',
    );
    expect(late?.dueSub).toBe('просрочено на 2 дня');
  });
  it('прогноз позже договора: срок прогноза и «прогноз · по договору …»', () => {
    const slip = [project({ id: 's', forecastDueOn: '2026-12-01', todoCount: 0 })];
    const r = listModel(slip, base).rows[0];
    expect(r).toMatchObject({ due: '01.12', dueSub: 'прогноз · по договору 27.11', slip: true });
  });
  it('черновик: «до договора», нет полосы, подпись сметы, «после договора», «договора ещё нет»', () => {
    const r = listModel(objects, { ...base, filter: 'draft' }).rows[0];
    expect(r).toMatchObject({
      stage: { label: 'Замер · до договора', tone: 'neutral', icon: 'straighten' },
      showBar: false,
      isDraft: true,
      estText: 'Смета не собрана',
      dueLabel: 'Замер',
      dueSub: 'договора ещё нет',
      foreman: 'после договора',
    });
  });
  it('сданный: «Сдан», дата и гарантия', () => {
    const r = listModel(objects, { ...base, filter: 'done' }).rows[0];
    expect(r).toMatchObject({
      stage: { label: 'Сдан', tone: 'ok', icon: 'verified' },
      dueLabel: 'Сдан',
      due: '12.09',
      dueSub: 'гарантия до 12.09.2027',
      pendingPct: 0,
    });
  });
  it('без прораба — «не назначен»; прораб не видит колонку прораба и может отметить работу', () => {
    const none = [project({ foremanMemberId: null })];
    expect(listModel(none, base).rows[0]?.foreman).toBe('не назначен');
    const r = listModel(objects, { ...base, foreman: true }).rows[0];
    expect(r?.showForeman).toBe(false);
    expect(r?.canLog).toBe(true);
    expect(listModel(objects, { ...base, foreman: true, filter: 'done' }).rows[0]?.canLog).toBe(
      false,
    );
  });
  it('таблица — владелец и широкий контент; прораб всегда карточки', () => {
    expect(listModel(objects, { ...base, wide: true }).view).toBe('table');
    expect(listModel(objects, { ...base, wide: false }).view).toBe('cards');
    expect(listModel(objects, { ...base, wide: true, foreman: true }).view).toBe('cards');
  });
});

describe('пустые состояния списка', () => {
  it('нет объектов: владелец и прораб', () => {
    expect(listModel([], base).empty).toEqual({
      icon: 'home_work',
      title: 'Объектов пока нет',
      text: 'Объект-черновик создаётся из заявки на этапе «Замер».',
    });
    expect(listModel([], { ...base, foreman: true }).empty).toEqual({
      icon: 'home_work',
      title: 'Вам пока не назначены объекты',
      text: 'Объект появится здесь, когда владелец назначит вас прорабом.',
    });
  });
  it('по фильтру нет: с поиском и без', () => {
    expect(listModel(objects, { ...base, q: 'zzz' }).empty).toEqual({
      icon: 'search_off',
      title: 'По фильтру объектов нет',
      text: 'Измените запрос или очистите поиск.',
    });
    expect(
      listModel([objects[0] as S['RepairProject']], { ...base, filter: 'done' }).empty?.text,
    ).toBe('Выберите другой фильтр.');
  });
});

describe('«Требует решения»', () => {
  it('вид, иконка, тег и тон по виду пункта', () => {
    expect(
      decisionView(decision('no_foreman', { actionLabel: 'Назначить прораба' })),
    ).toMatchObject({
      icon: 'person_off',
      tone: 'warn',
      tag: 'Команда',
      action: { label: 'Назначить прораба', type: 'assign' },
    });
    expect(decisionView(decision('stage_no_executor'))).toMatchObject({
      tone: 'neutral',
      tag: 'График',
    });
    expect(decisionView(decision('estimate_approved'))).toMatchObject({
      tag: 'Договор',
      icon: 'handshake',
    });
  });
  it('приёмка: с кнопкой — «fact_check» и действие accept; без — «pending» и без действия', () => {
    const own = decisionView(
      decision('work_log_pending', { actionLabel: 'Принять объём', refId: 'w1', tab: 'works' }),
    );
    expect(own).toMatchObject({
      icon: 'fact_check',
      tone: 'warn',
      action: { type: 'accept', refId: 'w1' },
    });
    const fm = decisionView(
      decision('work_log_pending', { text: 'Отметка WL-12 ждёт приёмки', tab: 'works' }),
    );
    expect(fm).toMatchObject({ icon: 'pending', tone: 'info' });
    expect(fm.action).toBeUndefined();
  });
  it('«Решить в снабжении» ведёт на страницу снабжения, прочие — на вкладку', () => {
    expect(
      decisionView(decision('supply_pending', { actionLabel: 'Решить в снабжении', tab: 'supply' }))
        .action,
    ).toMatchObject({ type: 'supply' });
    expect(
      decisionView(decision('document_ready', { actionLabel: 'Открыть документы', tab: 'docs' }))
        .action,
    ).toMatchObject({ type: 'tab', tab: 'docs' });
  });
});

describe('карточка: шапка и вкладки', () => {
  it('чипы активного объекта: этап, срок, «На приёмке: N»', () => {
    expect(cardChips(project(), 2).map((c) => c.label)).toEqual([
      'Черновая отделка',
      'сдача 27.11',
      'На приёмке: 2',
    ]);
    expect(cardChips(project({ forecastDueOn: '2026-12-01' }), 0).map((c) => c.label)).toEqual([
      'Черновая отделка',
      'сдача 01.12 вместо 27.11',
    ]);
  });
  it('чипы сданного и черновика', () => {
    expect(
      cardChips(
        project({ status: 'handed_over', handedOverOn: '2026-09-12', warrantyUntil: '2027-09-12' }),
        0,
      ).map((c) => c.label),
    ).toEqual(['Сдан 12.09', 'гарантия до 12.09.2027']);
    expect(
      cardChips(project({ status: 'draft', stage: 'Замер' }), 0, 'estimate_missing')[0]?.label,
    ).toBe('Замер · до договора');
  });
  it('подзаголовок: адрес · площадь · вид · договор', () => {
    expect(
      cardSubtitle(
        project({
          areaM2: '51.000',
          rooms: 2,
          kind: 'капитальный ремонт',
          contractNo: 'договор № 42',
        }),
      ),
    ).toBe('Москва, ул. Речная, 5, кв. 42 · 51 м², 2 комнаты · капитальный ремонт · договор № 42');
    expect(cardSubtitle(project({ status: 'draft' }))).toContain('договора ещё нет');
  });
  it('вкладки владельца с финансами: одиннадцать, бейджи', () => {
    const tabs = tabsOf(project(), { canFin: true, pending: 1, changesNew: 2, docs: 1, supply: 3 });
    expect(tabs.map((t) => t.label)).toEqual([
      'Обзор',
      'Работы',
      'Замер',
      'Смета',
      'График',
      'Документы',
      'Снабжение',
      'Финансы',
      'Оплата бригады',
      'Подрядчики',
      'Кабинет заказчика',
    ]);
    expect(tabs.filter((t) => t.badge).map((t) => [t.id, t.badge])).toEqual([
      ['works', 1],
      ['estimate', 2],
      ['docs', 1],
      ['supply', 3],
    ]);
  });
  it('прораб без финансов: без «Сметы» и четырёх вкладок денег', () => {
    expect(
      tabsOf(project(), { canFin: false, pending: 0, changesNew: 0, docs: 0, supply: 0 }).map(
        (t) => t.id,
      ),
    ).toEqual(['overview', 'works', 'measure', 'schedule', 'docs', 'supply']);
  });
  it('черновик: «Обзор, Замер, Смета» с бейджем 1, если сметы нет', () => {
    const t = tabsOf(project({ status: 'draft' }), {
      canFin: true,
      pending: 0,
      changesNew: 0,
      docs: 0,
      supply: 0,
      estimateMissing: true,
    });
    expect(t.map((x) => x.id)).toEqual(['overview', 'measure', 'estimate']);
    expect(t[2]?.badge).toBe(1);
  });
});

describe('обзор 1a', () => {
  const works: S['RepairWork'][] = [
    {
      id: 'w1',
      projectId: 'p1',
      name: 'Подготовка стен',
      unit: 'm2',
      plan: '96',
      fact: '58',
      pending: '6',
    },
    {
      id: 'w2',
      projectId: 'p1',
      name: 'Монтаж перегородок',
      unit: 'm2',
      plan: '18',
      fact: '18',
      pending: '0',
    },
    {
      id: 'w3',
      projectId: 'p1',
      name: 'Грунтование',
      unit: 'm2',
      plan: '96',
      fact: '0',
      pending: '0',
    },
  ];
  it('объёмы: заметка, значок, доли принято и на приёмке', () => {
    const rows = volumeRows(works);
    expect(rows[0]).toMatchObject({
      note: '58 из 96 м² · ещё 6 на приёмке',
      icon: 'progress_activity',
      pct: '60%',
    });
    expect(rows[1]).toMatchObject({
      note: '18 из 18 м² · выполнено',
      icon: 'check_circle',
      pct: '100%',
    });
    expect(rows[2]).toMatchObject({ note: '0 из 96 м²', icon: 'radio_button_unchecked' });
    expect(rows[0]?.acceptedW).toBeCloseTo(60.4, 1);
    expect(rows[0]?.pendingW).toBeCloseTo(6.25, 2);
  });
  it('люди: заказчик, прораб, бригада со склонением, подрядчик', () => {
    const people: S['RepairProjectOverview']['people'] = {
      clientName: 'Ольга Смирнова',
      clientLinkActive: true,
      foreman: { memberId: 'm1', displayName: 'Алексей Соколов' },
      crew: [
        { id: 'k1', displayName: 'Иван Петров', trade: 'отделочник', status: 'active' },
        { id: 'k2', displayName: 'Олег Смирнов', trade: 'отделочник', status: 'active' },
      ],
      subcontractor: { name: 'ООО «ЭлектроПрофи»', accessUntil: '2026-10-31' },
    };
    const rows = peopleRows(people, project());
    expect(rows.map((r) => r.name)).toEqual([
      'Ольга Смирнова',
      'Алексей Соколов',
      'Бригада · 2 человека',
      'ООО «ЭлектроПрофи»',
    ]);
    expect(rows[0]?.role).toBe('Заказчик · кабинет по ссылке до сдачи');
    expect(rows[1]?.role).toBe('Прораб · работает в CRM');
    expect(rows[2]?.role).toBe('Иван Петров, Олег Смирнов · карточки без входа');
    expect(rows[3]?.role).toBe('Подрядчик · доступ до 31.10');
  });
  it('люди: прораб не назначен — «Нужен до начала работ …»; у черновика — «Назначается после договора»', () => {
    const people = { clientName: null, clientLinkActive: false, foreman: null, crew: [] };
    expect(peopleRows(people, project({ startOn: '2026-10-06' }))[1]).toMatchObject({
      name: 'Прораб не назначен',
      role: 'Нужен до начала работ 06.10',
    });
    expect(peopleRows(people, project({ status: 'draft' }))[1]?.role).toBe(
      'Назначается после договора',
    );
    expect(peopleRows(people, project({ status: 'handed_over' }))[0]?.role).toBe(
      'Заказчик · кабинет закрыт после сдачи',
    );
  });
  it('деньги: договор, получено, расходы, маржа', () => {
    const rows = moneyRows(
      {
        contract: { amountMinor: 43_817_500, currency: 'RUB' },
        received: { amountMinor: 13_145_300, currency: 'RUB' },
        expenses: { amountMinor: 3_160_000, currency: 'RUB' },
        marginPlan: { amountMinor: 11_830_700, currency: 'RUB' },
      },
      false,
    );
    // Разряды — неразрывный пробел (toLocaleString ru-RU, как M.rub эталона).
    expect(rows.map((r) => [r.label, r.value.replaceAll(String.fromCharCode(160), ' ')])).toEqual([
      ['Договор', '438 175 ₽'],
      ['Получено', '131 453 ₽'],
      ['Расходы', '31 600 ₽'],
      ['Маржа, план', '118 307 ₽'],
    ]);
    expect(rows[1]?.sub).toBe('аванс 30%');
    expect(
      moneyRows(
        {
          ...{ contract: { amountMinor: 100, currency: 'RUB' } },
          received: { amountMinor: 0, currency: 'RUB' },
          expenses: { amountMinor: 0, currency: 'RUB' },
          marginPlan: { amountMinor: 0, currency: 'RUB' },
        },
        true,
      )[3]?.label,
    ).toBe('Маржа, факт');
  });
});

describe('проверка форм до отправки', () => {
  const ok = { work: 'w1', volume: '12', crew: ['k1'], photos: 1, material: '', materialQty: '' };
  it('отметка: порядок сообщений эталона', () => {
    expect(validateWorkLog({ ...ok, work: '' })).toBe('Выберите работу этого объекта');
    expect(validateWorkLog({ ...ok, volume: '' })).toBe('Объём должен быть больше нуля');
    expect(validateWorkLog({ ...ok, volume: '0' })).toBe('Объём должен быть больше нуля');
    expect(validateWorkLog({ ...ok, crew: [] })).toBe('Отметьте работников');
    expect(validateWorkLog({ ...ok, photos: 0 })).toBe('Добавьте хотя бы одно фото');
    expect(validateWorkLog({ ...ok, volume: '7,5' })).toBeNull();
    expect(validateWorkLog(ok)).toBeNull();
  });
  it('допработа: описание от 3 знаков, объём, фото', () => {
    const c = { title: 'Перенести розетки', volume: '6', photos: 1 };
    expect(validateChange({ ...c, title: ' ' })).toBe('Опишите, что нужно сделать');
    expect(validateChange({ ...c, title: 'ab' })).toBe('Опишите, что нужно сделать');
    expect(validateChange({ ...c, volume: 'x' })).toBe('Укажите объём больше нуля');
    expect(validateChange({ ...c, photos: 0 })).toBe('Приложите хотя бы одно фото');
    expect(validateChange(c)).toBeNull();
  });
});
