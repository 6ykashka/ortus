// Конфликты, «Требует внимания», предпросмотр переноса, сводка и окна «Ближайшие 3 недели»
// (design/Ремонт и стройка.dc.html:1108–1121, 1191–1226, 1268–1286, 1664). Ожидаемые строки сняты
// прогоном дословной копии логики эталона (`.claude/tmp/W6.10/ref3.mjs`).
import { describe, expect, it } from 'vitest';
import {
  allIssues,
  conflictsOf,
  finalStageId,
  previewChange,
  scheduleStatus,
  scheduleSummary,
  stageIssues,
  stageState,
  upcomingWindows,
  variance,
  type StageContext,
} from './analysis.ts';
import { REPAIR_CALENDAR as cal } from './calendar.ts';
import { isStageDone, schedule } from './cpm.ts';
import { OBJ42_LOG, OBJ42_MODEL, OBJ42_PLAN } from './obj42.ts';
import type { Plan, ScheduleStage, SupplyRef } from './types.ts';

const WHO: Record<string, string> = {
  s1: 'Бригада О. Дронова',
  s2: 'ООО «ЭлектроПрофи»',
  s3: 'Бригада О. Дронова',
  s4: 'Бригада О. Дронова',
  s5: 'Бригада О. Дронова',
  s6: '',
  s7: 'Бригада О. Дронова',
  s8: 'ООО «ЭлектроПрофи»',
  s9: 'Бригада О. Дронова',
  s10: 'Алексей Соколов',
};
const SUP: Record<string, SupplyRef> = {
  s2: { id: 'З-13', st: 'bought', item: 'Кабель ВВГнг 3×2,5', qty: '150 м' },
  s3: { id: 'З-12', st: 'used', item: 'Штукатурка гипсовая 30 кг', qty: '46 мешков' },
  s6: { id: 'З-15', st: 'request', item: 'Плитка керамогранит 60×60', qty: '18 м²' },
  s7: { id: 'З-14', st: 'request', item: 'Ламинат 33 класс', qty: '52 м²' },
};

const ctxFor = (
  plan: Plan | null,
  who: Record<string, string> = WHO,
  sup: (s: ScheduleStage) => SupplyRef | undefined = (s) => (s.sup ? SUP[s.id] : undefined),
): StageContext => ({
  cal,
  model: OBJ42_MODEL,
  T: schedule(cal, OBJ42_MODEL, plan),
  whoOf: (s) => who[s.id] ?? '',
  supplyOf: sup,
});
const stage = (id: string): ScheduleStage => {
  const s = OBJ42_MODEL.stages.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};

describe('исполнитель занят и «Требует внимания»', () => {
  it('в начальном состоянии: у плитки нет исполнителя и материала, ламинат не закуплен', () => {
    const c = ctxFor(OBJ42_PLAN);
    expect(conflictsOf(c)).toEqual({});
    expect(allIssues(c)).toEqual([
      {
        id: 's6',
        icon: 'person_off',
        tone: 'warn',
        short: 'Нет исполнителя',
        text: '«Плитка в санузле»: не назначен исполнитель, начало 10.11, вт',
        start: 36,
      },
      {
        id: 's6',
        icon: 'inventory_2',
        tone: 'warn',
        short: 'Материала нет на объекте',
        text: '«Плитка в санузле»: не закуплено — Плитка керамогранит 60×60, 18 м² (заявка З-15), нужно к 10.11',
        start: 36,
      },
      {
        id: 's7',
        icon: 'inventory_2',
        tone: 'warn',
        short: 'Материала нет на объекте',
        text: '«Укладка ламината»: не закуплено — Ламинат 33 класс, 52 м² (заявка З-14), нужно к 25.11',
        start: 51,
      },
    ]);
  });

  it('плитка у той же бригады, что красит стены: оба этапа «Исполнитель занят»', () => {
    const c = ctxFor(OBJ42_PLAN, { ...WHO, s6: 'Бригада О. Дронова' }, () => undefined);
    expect(conflictsOf(c)).toEqual({ s5: 's6', s6: 's5' });
    expect(allIssues(c).map((i) => [i.id, i.tone, i.short, i.text])).toEqual([
      [
        's5',
        'danger',
        'Исполнитель занят',
        '«Шпаклёвка и покраска стен»: Бригада О. Дронова в эти дни на этапе «Плитка в санузле»',
      ],
      [
        's6',
        'danger',
        'Исполнитель занят',
        '«Плитка в санузле»: Бригада О. Дронова в эти дни на этапе «Шпаклёвка и покраска стен»',
      ],
    ]);
  });

  it('материал: в закупке, в резерве; закуплено и списано проблемой не считается', () => {
    const c = ctxFor(OBJ42_PLAN, WHO, (s) =>
      s.id === 's7'
        ? { id: 'З-14', st: 'ordered', pur: 'ЗК-7', item: 'Ламинат 33 класс', qty: '52 м²' }
        : s.id === 's6'
          ? { id: 'З-15', st: 'reserved', item: 'Плитка', qty: '18 м²' }
          : undefined,
    );
    expect(allIssues(c).map((i) => i.text)).toEqual([
      '«Плитка в санузле»: не назначен исполнитель, начало 10.11, вт',
      '«Плитка в санузле»: в резерве на складе, прораб ещё не забрал — Плитка, 18 м² (заявка З-15), нужно к 10.11',
      '«Укладка ламината»: в закупке ЗК-7, ещё не привезли — Ламинат 33 класс, 52 м² (заявка З-14), нужно к 25.11',
    ]);
    expect(stageIssues(ctxFor(OBJ42_PLAN), stage('s7')).map((i) => i.short)).toEqual([
      'Материала нет на объекте',
    ]);
    expect(stageIssues(ctxFor(OBJ42_PLAN), stage('s3'))).toEqual([]);
  });

  it('у выполненного этапа и у вехи записей нет', () => {
    const c = ctxFor(OBJ42_PLAN);
    expect(stageIssues(c, stage('s1'))).toEqual([]);
    expect(stageIssues(c, stage('s10'))).toEqual([]);
  });

  it('текст «не закуплено» для заявки без решения снабжения', () => {
    const [m] = stageIssues(ctxFor(OBJ42_PLAN), stage('s7'));
    expect(m?.text).toBe(
      '«Укладка ламината»: не закуплено — Ламинат 33 класс, 52 м² (заявка З-14), нужно к 25.11',
    );
    expect(m).toMatchObject({ icon: 'inventory_2', tone: 'warn', id: 's7', start: 51 });
  });
});

describe('предпросмотр переноса', () => {
  const pv = (draft: Plan) =>
    previewChange({
      cal,
      model: OBJ42_MODEL,
      plan: OBJ42_PLAN,
      draft,
      whoOf: (s) => WHO[s.id] ?? '',
      clientName: 'Ольгу Смирнову',
    });

  it('покраска 12 → 15 дней: сдача уходит за договор на 5 раб. дней', () => {
    const r = pv({ off: {}, dur: { s2: 10, s5: 15 }, lag: {} });
    expect(r.lines).toBe('«Шпаклёвка и покраска стен»: длительность 12 → 15 раб. дней.');
    expect(r.moved).toBe(
      'Сдвинутся следом: Укладка ламината, Электрика · чистовая, Уборка и подготовка к сдаче, Сдача объекта.',
    );
    expect(r.endTxt).toBe('Сдача: 01.12, вт → 04.12, пт — позже договора на 5 раб. дней.');
    expect(r.notify).toBe(
      'Уведомим: Бригада О. Дронова, ООО «ЭлектроПрофи», Алексей Соколов; заказчика Ольгу Смирнову — меняется дата сдачи.',
    );
    expect(r.logText).toBe(
      '«Шпаклёвка и покраска стен»: длительность 12 → 15 раб. дней. Сдача: 01.12, вт → 04.12, пт — позже договора на 5 раб. дней',
    );
    expect(r.notifyWho).toEqual(['Бригада О. Дронова', 'ООО «ЭлектроПрофи»', 'Алексей Соколов']);
    expect(r).toMatchObject({ endChanged: true, late: true });
  });

  it('плитка отложена: сдача не меняется, этап «Не уведомляем», исполнителей нет', () => {
    const r = pv({ off: { s6: 4 }, dur: { s2: 10 }, lag: {} });
    expect(r.lines).toBe('«Плитка в санузле»: начало 10.11 → 16.11.');
    expect(r.moved).toBe('Другие этапы не сдвигаются.');
    expect(r.endTxt).toBe('Дата сдачи не меняется: 01.12, вт.');
    expect(r.notify).toBe('Уведомим: исполнителей нет.');
    expect(r.logText).toBe('«Плитка в санузле»: начало 10.11 → 16.11');
    expect(r).toMatchObject({ endChanged: false, notifyWho: [] });
  });

  it('паузы по связям: «пауза 5 дней → пауза 2 дня», «пауза 3 дня → сразу»', () => {
    const r = pv({ off: {}, dur: { s2: 10 }, lag: { 's3>s5': 2, 's4>s6': 0 } });
    expect(r.lines).toBe(
      '«Штукатурка стен» → «Шпаклёвка и покраска стен»: пауза 5 дней → пауза 2 дня. «Стяжка пола» → «Плитка в санузле»: пауза 3 дня → сразу.',
    );
    expect(r.endTxt).toBe('Сдача: 01.12, вт → 30.11, пн — позже договора на 1 раб. день.');
  });

  it('штукатурка короче на 2 дня: сдача в срок по договору', () => {
    const r = pv({ off: {}, dur: { s2: 10, s3: 8 }, lag: {} });
    expect(r.endTxt).toBe('Сдача: 01.12, вт → 27.11, пт — в срок по договору.');
    expect(r.late).toBe(false);
    expect(r.moved).toBe(
      'Сдвинутся следом: Стяжка пола, Шпаклёвка и покраска стен, Плитка в санузле, Укладка ламината, Электрика · чистовая, Уборка и подготовка к сдаче, Сдача объекта.',
    );
  });

  it('без изменений строка пустая: правок нет', () => {
    const r = pv(OBJ42_PLAN);
    expect(r.lines).toBe('.');
    expect(r.hasEdits).toBe(false);
    expect(r.endTxt).toBe('Дата сдачи не меняется: 01.12, вт.');
  });
});

describe('сводка графика', () => {
  const base = schedule(cal, OBJ42_MODEL, null);
  const cur = schedule(cal, OBJ42_MODEL, OBJ42_PLAN);

  it('finalStageId — единственная веха без последователей', () => {
    expect(finalStageId(OBJ42_MODEL)).toBe('s10');
  });

  it('variance: сдвиг окончания этапа против договора в рабочих днях', () => {
    expect(variance(cal, base, cur, 's10')).toBe(2);
    expect(variance(cal, base, cur, 's2')).toBe(2);
    expect(variance(cal, cur, base, 's10')).toBe(-2);
    expect(variance(cal, base, base, 's5')).toBe(0);
  });

  it('прогноз 01.12, договор 27.11, опоздание 2 раб. дня', () => {
    const s = scheduleSummary({
      cal,
      model: OBJ42_MODEL,
      base,
      plan: cur,
      log: OBJ42_LOG,
    });
    expect(s).toMatchObject({
      due: '27.11, пт',
      forecast: '01.12, вт',
      slip: 2,
      early: 0,
      late: true,
      critical: [
        'Электрика · черновая',
        'Штукатурка стен',
        'Шпаклёвка и покраска стен',
        'Укладка ламината',
        'Уборка и подготовка к сдаче',
        'Сдача объекта',
      ],
      recoverTitle:
        'Чтобы вернуть 27.11, нужно отыграть 2 раб. дня на критическом пути. Сократите один из этапов:',
    });
    expect(s.why).toBe(
      'Последний перенос — 16.10, Алексей Соколов: «Электрика · черновая»: длительность 8 → 10 раб. дней, окончание 21.10 → 23.10. Причина: задержка подрядчика: поставка кабеля.',
    );
    expect(s.recover).toEqual([
      { id: 's3', label: 'Штукатурка стен · 10 дн' },
      { id: 's5', label: 'Шпаклёвка и покраска стен · 12 дн' },
      { id: 's7', label: 'Укладка ламината · 3 дн' },
    ]);
  });

  it('в срок: нет опоздания; раньше договора — early', () => {
    const early = schedule(cal, OBJ42_MODEL, {
      off: {},
      dur: { s2: 10, s3: 7 },
      lag: { 's2>s3': -5 },
    });
    const s = scheduleSummary({ cal, model: OBJ42_MODEL, base, plan: early, log: [] });
    expect(s).toMatchObject({ slip: 0, early: 2, late: false, why: '', forecast: '25.11, ср' });
    const same = scheduleSummary({ cal, model: OBJ42_MODEL, base, plan: base, log: [] });
    expect(same).toMatchObject({ slip: 0, early: 0, forecast: '27.11, пт' });
  });

  it('сводка для шапки CRM (`sched`): даты ДД.ММ, причина, этапы без исполнителя', () => {
    expect(
      scheduleStatus({
        cal,
        model: OBJ42_MODEL,
        base,
        plan: cur,
        log: OBJ42_LOG,
        whoOf: (s) => WHO[s.id] ?? '',
      }),
    ).toEqual({
      due: '27.11',
      forecast: '01.12',
      slip: 2,
      slipText: '2 раб. дня',
      why: '«Электрика · черновая» — задержка подрядчика: поставка кабеля',
      noWho: ['«Плитка в санузле» с 10.11'],
    });
  });

  it('без опоздания причина пуста', () => {
    expect(
      scheduleStatus({
        cal,
        model: OBJ42_MODEL,
        base,
        plan: base,
        log: OBJ42_LOG,
        whoOf: () => 'x',
      }),
    ).toMatchObject({ slip: 0, why: '', noWho: [] });
  });
});

describe('состояние этапа', () => {
  const base = schedule(cal, OBJ42_MODEL, null);
  const cur = schedule(cal, OBJ42_MODEL, OBJ42_PLAN);
  const st = (id: string, closed = false) => stageState(cal, stage(id), base, cur, closed);

  it('закрыт актом, выполнен, идёт, отстаёт, веха, сдвинут, не начат', () => {
    expect(st('s1', true)).toEqual({ kind: 'closed', days: 0 });
    expect(st('s1')).toEqual({ kind: 'done', days: 0 });
    expect(st('s2')).toEqual({ kind: 'late-running', days: 2 });
    expect(st('s10')).toEqual({ kind: 'milestone', days: 2 });
    expect(st('s3')).toEqual({ kind: 'shifted', days: 2 });
    expect(st('s6')).toEqual({ kind: 'shifted', days: 1 });
  });

  it('идёт в срок, раньше плана, не начат без сдвига', () => {
    expect(stageState(cal, stage('s2'), base, base, false)).toEqual({ kind: 'running', days: 0 });
    const early = schedule(cal, OBJ42_MODEL, {
      off: {},
      dur: { s2: 10, s3: 7 },
      lag: { 's2>s3': -5 },
    });
    expect(stageState(cal, stage('s5'), cur, early, false).kind).toBe('early');
    expect(stageState(cal, stage('s5'), base, base, false)).toEqual({ kind: 'idle', days: 0 });
  });

  it('выполнен ли этап: acc ≥ 1', () => {
    expect(OBJ42_MODEL.stages.filter(isStageDone).map((s) => s.id)).toEqual(['s1']);
  });
});

describe('«Ближайшие 3 недели»', () => {
  const c = ctxFor(OBJ42_PLAN);
  const w = upcomingWindows(c);

  it('три окна: пн–пт текущей, следующей и через неделю; праздник в подзаголовке', () => {
    expect(w.map((x) => [x.title, x.sub, x.from, x.to])).toEqual([
      ['Эта неделя · 19–23 октября', '', 14, 18],
      ['Следующая неделя · 26–30 октября', '', 21, 25],
      ['Через неделю · 2–6 ноября', '4 ноября — выходной', 28, 32],
    ]);
  });

  it('этапы окон: формулировка срока, параллельность, критичность, исполнитель', () => {
    expect(
      w.map((x) => x.items.map((i) => [i.id, i.when, i.parallelWith, i.critical, i.who, i.empty])),
    ).toEqual([
      [
        ['s2', 'до пт 23.10', null, true, 'ООО «ЭлектроПрофи»', false],
        ['s3', 'с ср 21.10, до 03.11', 's2', true, 'Бригада О. Дронова', false],
      ],
      [['s3', 'вся неделя, до 03.11', 's2', true, 'Бригада О. Дронова', false]],
      [
        ['s3', 'до вт 03.11', 's2', true, 'Бригада О. Дронова', false],
        ['s4', 'чт 05.11 – пт 06.11', null, false, 'Бригада О. Дронова', false],
      ],
    ]);
  });

  it('прогресс идущего этапа в процентах и готовность этапа к старту', () => {
    const [first] = w[0]?.items ?? [];
    expect(first?.progress).toEqual({ accepted: 53, pending: 8 });
    expect(first?.ready).toBe(false);
    const s4 = w[2]?.items[1];
    expect(s4?.ready).toBe(true);
    expect(s4?.progress).toBeNull();
    expect(s4?.issues).toEqual([]);
  });

  it('этап без исполнителя в окне: подпись «Исполнитель не назначен» и записи внимания', () => {
    const wide = upcomingWindows(ctxFor({ off: {}, dur: { s2: 10, s3: 3 }, lag: {} }));
    const flat = wide.flatMap((x) => x.items).filter((i) => i.id === 's6');
    expect(flat[0]?.who).toBe('Исполнитель не назначен');
    expect(flat[0]?.issues.map((i) => i.short)).toEqual([
      'Нет исполнителя',
      'Материала нет на объекте',
    ]);
  });

  it('пустое окно: empty', () => {
    const none = upcomingWindows({
      ...c,
      T: schedule(cal, { stages: [], links: [] }, null),
      model: { stages: [], links: [] },
    });
    expect(none.every((x) => x.empty && x.items.length === 0)).toBe(true);
  });

  it('«Подготовить заранее»: записи внимания после третьей недели', () => {
    const prep = allIssues(c).filter((i) => i.start > 32);
    expect(prep.map((i) => i.short)).toEqual([
      'Нет исполнителя',
      'Материала нет на объекте',
      'Материала нет на объекте',
    ]);
  });
});
