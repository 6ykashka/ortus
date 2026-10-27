// W6.23 · Представление графика: этапы диаграммы (даты, критический путь, паузы, метки, права), чип состояния и панель
// этапа (сроки, связи, исполнитель, подсказки) по фикстуре кв. 42.
import { bumpDuration, bumpOffset } from '@ortus/domain/schedule';
import { describe, expect, it } from 'vitest';

import { scheduleFixture, TODAY_NOW } from './fixture.test-util.ts';
import { buildView } from './model.ts';
import { ganttStagesOf, stagePanelOf, stateChip } from './vm.ts';

const view = () => buildView(scheduleFixture(), TODAY_NOW);
const byId = <T extends { id: string }>(l: T[], id: string): T => {
  const x = l.find((s) => s.id === id);
  if (!x) throw new Error(id);
  return x;
};

describe('этапы диаграммы', () => {
  const v = view();
  const st = ganttStagesOf(v, v.plan, { draft: false, canShift: true });

  it('даты ISO, раздел, подпись под названием, критический путь', () => {
    expect(byId(st, 's1')).toMatchObject({
      start: '2026-10-05',
      end: '2026-10-09',
      kind: 'accepted',
      phase: 'Черновые работы',
      meta: '05.10–09.10 · 5 дн',
    });
    expect(byId(st, 's10')).toMatchObject({ milestone: true, phase: 'Сдача', start: '2026-12-01' });
    expect(byId(st, 's10').meta).toBe('сдача 01.12, вт · по договору 27.11');
    expect(byId(st, 's10').critical).toBe(true);
    expect(byId(st, 's1').critical).toBe(false);
  });

  it('паузы после этапа — по связям с ожиданием, с подписью и числом дней', () => {
    const s3 = byId(st, 's3');
    expect(s3.paused).toEqual([
      { start: '2026-11-04', end: '2026-11-08', label: 'сушка штукатурки · 5 дней' },
    ]);
    expect(byId(st, 's1').paused).toBeUndefined();
  });

  it('метки «Требует внимания»: нет исполнителя', () => {
    expect(byId(st, 's6').marks?.[0]).toMatchObject({ icon: 'person_off', tone: 'warn' });
    expect(byId(st, 's7').marks).toBeUndefined();
  });

  it('права: идущий этап не двигается (только длительность), выполненный и веха — ничего', () => {
    expect(byId(st, 's3')).toMatchObject({ canMove: true, canResize: true });
    expect(byId(st, 's2')).toMatchObject({ canMove: false, canResize: true });
    expect(byId(st, 's1')).toMatchObject({ canMove: false, canResize: false });
    expect(byId(st, 's10')).toMatchObject({ canMove: false, canResize: false });
    const ro = ganttStagesOf(v, v.plan, { draft: false, canShift: false });
    expect(ro.every((s) => !s.canMove && !s.canResize)).toBe(true);
  });

  it('черновик: сдвинутые им этапы помечены «changed»', () => {
    const s3 = v.model.stages.find((s) => s.id === 's3');
    if (!s3) throw new Error('s3');
    const draft = bumpDuration(v.plan, s3, 1, 1);
    const d = ganttStagesOf(v, draft, { draft: true, canShift: true });
    expect(byId(d, 's3').changed).toBe(true);
    expect(byId(d, 's5').changed).toBe(true);
    expect(byId(d, 's1').changed).toBe(false);
    expect(byId(d, 's3').end).not.toBe(byId(st, 's3').end);
  });
});

describe('панель этапа', () => {
  const v = view();

  it('Штукатурка стен: сроки, запас, связи, «Раньше нельзя»', () => {
    const p = stagePanelOf(v, v.plan, 's3');
    expect(p).not.toBeNull();
    expect(p?.canStart).toBe(true);
    expect(p?.canDur).toBe(true);
    expect(p?.durVal).toBe('10 раб. дней');
    expect(p?.preds.map((l) => l.name)).toEqual(['Электрика · черновая']);
    expect(p?.preds[0]?.lag).toBe('раньше на 3 дня · начинаем с комнат, где проводка готова');
    expect(p?.preds[0]?.canEdit).toBe(true);
    expect(p?.succs.map((q) => q.name)).toEqual(['Стяжка пола', 'Шпаклёвка и покраска стен']);
    expect(p?.startHint).toMatch(
      /^Раньше нельзя: этап ждёт «Электрика · черновая», раньше на 3 дня\.$/,
    );
    expect(p?.whoNote).toBe('Исполнитель получит уведомление при переносе этапа.');
  });

  it('идущий этап: начало фактическое, длительность не короче прошедших дней', () => {
    const p = stagePanelOf(v, v.plan, 's2');
    expect(p?.canStart).toBe(false);
    expect(p?.fixed).toBe('Начало 12.10, пн — фактическое, его не сдвинуть.');
    expect(p?.min).toBe(8);
    expect(p?.durHint).toMatch(/^Этап идёт: закончить можно не раньше /);
    expect(p?.preds[0]?.canEdit).toBe(false);
    expect(p?.chips.map((c) => c.label)).toContain('В работе');
  });

  it('выполненный и веха: правки закрыты; у вехи подсказка про допсоглашение', () => {
    const done = stagePanelOf(v, v.plan, 's1');
    expect(done).toMatchObject({ canStart: false, canDur: false, hasWho: false });
    expect(done?.chips.map((c) => c.label)).toEqual(['Выполнено и принято']);
    const ms = stagePanelOf(v, v.plan, 's10');
    expect(ms).toMatchObject({ ms: true, canDur: false, durText: 'Веха графика' });
    expect(ms?.chips.map((c) => c.label)).toContain('Веха');
  });

  it('нет исполнителя: «Назначьте исполнителя до …»; чип запаса или «Критический путь»', () => {
    const p = stagePanelOf(v, v.plan, 's6');
    expect(p?.who).toBe('');
    expect(p?.needText).toMatch(/^Назначьте исполнителя до \d\d\.\d\d, [а-я]{2}\.$/);
    expect(stagePanelOf(v, v.plan, 's5')?.chips.at(-1)?.label).toBe('Критический путь');
    expect(stagePanelOf(v, v.plan, 's6')?.chips.at(-1)?.label).toMatch(/^Запас /);
  });

  it('по черновику: «Отложен на … после готовности предыдущих этапов»', () => {
    const draft = bumpOffset(v.plan, 's4', 2);
    expect(stagePanelOf(v, draft, 's4')?.startHint).toBe(
      'Отложен на 2 раб. дня после готовности предыдущих этапов.',
    );
  });

  it('неизвестный этап — null; чип состояния «Сдвинут на …» по черновику', () => {
    expect(stagePanelOf(v, v.plan, 'zzz')).toBeNull();
    const s4 = v.model.stages.find((s) => s.id === 's4');
    if (!s4) throw new Error('s4');
    expect(stateChip(v, s4, v.plan).label).toBe('Не начат');
    expect(stateChip(v, s4, bumpOffset(v.plan, 's4', 1)).label).toBe('Сдвинут на 1 раб. день');
  });
});
