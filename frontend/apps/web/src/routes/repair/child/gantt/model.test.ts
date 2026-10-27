// W6.23 · Модель страницы графика: ответ getSchedule → календарь, этапы и план библиотеки W6.10 (расчёт обязан дать
// те же даты, что сервер), шапка и сводка, правки плана → изменения API, причины, история, «Требует внимания».
import {
  bumpDuration,
  bumpLag,
  bumpOffset,
  OBJ42_PLAN,
  REPAIR_CALENDAR,
  schedule,
  OBJ42_MODEL,
} from '@ortus/domain/schedule';
import { describe, expect, it } from 'vitest';

import { scheduleFixture, TODAY_NOW } from './fixture.test-util.ts';
import {
  attentionOf,
  buildView,
  changesOf,
  headChips,
  isoOf,
  logOf,
  previewOf,
  REASONS,
  summaryOf,
  upcomingOf,
} from './model.ts';

const view = (o?: Parameters<typeof scheduleFixture>[0]) =>
  buildView(scheduleFixture(o), TODAY_NOW);

describe('buildView: календарь и расчёт совпадают с сервером', () => {
  it('день 0 — понедельник 05.10.2026, праздник 04.11 — день 30, «сегодня» 20.10 — день 15', () => {
    const v = view();
    expect(v.cal.cfg.start).toBe('2026-10-05');
    expect(v.cal.cfg.holidays).toEqual([30]);
    expect(v.cal.cfg.today).toBe(15);
  });

  it('день 0 — понедельник недели первого этапа, даже если график начинается в среду', () => {
    const s = scheduleFixture();
    const first = s.stages[0];
    if (first) first.startOn = '2026-10-07';
    expect(buildView(s, TODAY_NOW).cal.cfg.start).toBe('2026-10-05');
  });

  it('даты всех этапов, запас и критический путь — как у расчёта эталона по тому же плану', () => {
    const v = view();
    const ref = schedule(REPAIR_CALENDAR, OBJ42_MODEL, OBJ42_PLAN);
    for (const s of v.model.stages) {
      expect(v.P[s.id], s.id).toMatchObject({
        start: ref[s.id]?.start,
        end: ref[s.id]?.end,
        fl: ref[s.id]?.fl,
      });
    }
  });

  it('веха — последний этап без последователей; идущий этап фиксирован (as), выполненный принят целиком', () => {
    const v = view();
    expect(v.model.stages.find((s) => s.id === 's10')?.ms).toBe(true);
    expect(v.model.stages.find((s) => s.id === 's9')?.ms).toBeFalsy();
    expect(v.model.stages.find((s) => s.id === 's1')).toMatchObject({ as: 0, acc: 1 });
    expect(v.model.stages.find((s) => s.id === 's2')).toMatchObject({ as: 7, acc: 0 });
    expect(v.model.stages.find((s) => s.id === 's3')?.as).toBeUndefined();
  });

  it('разделы — в порядке появления; исполнитель — executorName', () => {
    const v = view();
    expect(v.phases).toEqual(['Черновые работы', 'Чистовые работы', 'Сдача']);
    expect(v.model.stages.find((s) => s.id === 's6')?.who).toBe('');
    expect(v.model.stages.find((s) => s.id === 's7')?.who).toBe('Бригада О. Дронова');
  });

  it('сдвиг начала из ответа (offsetWd) попадает в план и в даты', () => {
    const v = view({ off: { s4: 2 } });
    expect(v.plan.off).toEqual({ s4: 2 });
    const ref = schedule(REPAIR_CALENDAR, OBJ42_MODEL, { ...OBJ42_PLAN, off: { s4: 2 } });
    expect(v.P['s4']?.start).toBe(ref['s4']?.start);
  });

  it('дата дня — ISO, обратное преобразование', () => {
    const v = view();
    expect(isoOf(v.cal, 0)).toBe('2026-10-05');
    expect(isoOf(v.cal, 30)).toBe('2026-11-04');
    expect(v.due).toBe(v.cal.indexOf('27.11'));
  });
});

describe('шапка и сводка «Сдача объекта»', () => {
  it('чипы: «По договору 27.11, пт» и «Прогноз 01.12, вт · +2 раб. дня»', () => {
    expect(headChips(view())).toEqual([
      { label: 'По договору 27.11, пт', tone: 'neutral', icon: 'handshake' },
      { label: 'Прогноз 01.12, вт · +2 раб. дня', tone: 'warn', icon: 'event_busy' },
    ]);
  });

  it('в срок: «Прогноз … · в срок»', () => {
    const s = scheduleFixture({ dur: {} });
    s.delayWd = 0;
    s.forecastDueOn = s.baseline?.dueOn ?? null;
    expect(headChips(buildView(s, TODAY_NOW))[1]).toEqual({
      label: 'Прогноз 27.11, пт · в срок',
      tone: 'ok',
      icon: 'event_available',
    });
  });

  it('сводка: опоздание, критический путь, как вернуть срок', () => {
    const sum = summaryOf(view());
    expect(sum.due).toBe('27.11, пт');
    expect(sum.forecast).toBe('01.12, вт');
    expect(sum.late).toBe(true);
    expect(sum.chip).toEqual({
      label: 'Позже договора на 2 раб. дня',
      tone: 'warn',
      icon: 'event_busy',
    });
    expect(sum.critical.at(-1)).toBe('Сдача объекта');
    expect(sum.recoverTitle).toBe(
      'Чтобы вернуть 27.11, нужно отыграть 2 раб. дня на критическом пути. Сократите один из этапов:',
    );
    expect(sum.recover.length).toBeGreaterThan(0);
    expect(sum.why).toMatch(/^Последний перенос — 16\.10, Алексей Соколов: /);
    expect(sum.why).toMatch(/Причина: задержка подрядчика\.$/);
  });
});

describe('история и причины', () => {
  it('семь причин в порядке эталона, значения — enum контракта', () => {
    expect(REASONS.map((r) => r.label)).toEqual([
      'Задержка подрядчика',
      'Поставка материалов',
      'Решение заказчика',
      'Технологическая пауза',
      'Нет доступа на объект',
      'Добавили людей на этап',
      'Уточнили объём работ',
    ]);
    expect(REASONS.map((r) => r.value)).toEqual([
      'executor_busy',
      'material_delay',
      'client_request',
      'weather_or_drying',
      'other',
      'scope_change',
      'rework',
    ]);
  });

  it('журнал: новые сверху, «ДД.ММ · автор», причина — подписью', () => {
    const log = logOf(view());
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      at: '16.10',
      who: 'Алексей Соколов',
      reason: 'Задержка подрядчика',
    });
    expect(log[1]?.reason).toBe('');
    expect(log[1]?.text).toContain('Базовый план утверждён');
  });
});

describe('правки плана → изменения API', () => {
  const v = view();
  const s3 = v.model.stages.find((s) => s.id === 's3');
  const s5 = v.model.stages.find((s) => s.id === 's5');

  it('длительность и начало — по этапам, без дублей', () => {
    if (!s3 || !s5) throw new Error('нет этапов');
    let draft = bumpDuration(v.plan, s3, 1, 1);
    draft = bumpOffset(draft, 's4', 2);
    draft = bumpOffset(draft, 's4', 1);
    expect(changesOf(v, draft)).toEqual([
      { stageId: 's3', durationWd: 11 },
      { stageId: 's4', offsetWd: 3 },
    ]);
  });

  it('пауза по связи уходит изменением этапа-последователя, если предшественник определяет его начало', () => {
    const link = v.model.links.find((l) => l.from === 's3' && l.to === 's5');
    if (!link) throw new Error('нет связи');
    expect(v.P['s5']?.bind).toBe('s3');
    expect(changesOf(v, bumpLag(v.plan, link, 1))).toEqual([{ stageId: 's5', lagDays: 6 }]);
  });

  it('без правок — пустой список', () => {
    expect(changesOf(v, v.plan)).toEqual([]);
  });
});

describe('предпросмотр, «Требует внимания», ближайшие 3 недели', () => {
  it('предпросмотр на тексты эталона: «длительность 10 → 11 раб. дней», сдача сдвигается', () => {
    const v = view();
    const s3 = v.model.stages.find((s) => s.id === 's3');
    if (!s3) throw new Error('нет этапа');
    const p = previewOf(v, bumpDuration(v.plan, s3, 1, 1), 'Ольгу Смирнову');
    expect(p.lines).toBe('«Штукатурка стен»: длительность 10 → 11 раб. дней.');
    expect(p.hasEdits).toBe(true);
    expect(p.endChanged).toBe(true);
    expect(p.late).toBe(true);
    expect(p.notify).toMatch(/^Уведомим: Бригада О\. Дронова/);
    expect(p.notify).toContain('заказчика Ольгу Смирнову');
  });

  it('«Нет исполнителя» — из домена; «Материала нет на объекте» — из issues сервера', () => {
    const s = scheduleFixture();
    s.issues = [{ kind: 'no_material', stageId: 's3', text: 'Нет штукатурки: заявка З-12' }];
    const v = buildView(s, TODAY_NOW);
    const att = attentionOf(v, v.plan);
    expect(att.find((i) => i.id === 's6')).toMatchObject({
      short: 'Нет исполнителя',
      icon: 'person_off',
    });
    expect(att.find((i) => i.id === 's3')).toMatchObject({
      short: 'Материала нет на объекте',
      icon: 'inventory_2',
      text: 'Нет штукатурки: заявка З-12',
    });
    for (let i = 1; i < att.length; i++) {
      expect(att[i - 1]?.start).toBeLessThanOrEqual(att[i]?.start ?? 0);
    }
  });

  it('три окна: «Эта неделя · 19–23 октября», праздник 4 ноября', () => {
    const w = upcomingOf(view(), view().plan);
    expect(w).toHaveLength(3);
    expect(w[0]?.title).toBe('Эта неделя · 19–23 октября');
    expect(w[2]?.sub).toBe('4 ноября — выходной');
  });
});
