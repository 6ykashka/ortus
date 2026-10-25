// Сроки обращения (service.js 19.10:90–121 `slaOf`, `slaHead`; 143–153 `slaFor`, `resume`).
import { describe, expect, it } from 'vitest';
import { CAL, DAY_MS, addWorkMinutes } from './calendar.ts';
import { isOpen, resumeTimers, slaFor, slaHead, slaOf } from './sla.ts';
import type { Sla } from './types.ts';

const ms = (d: number, mo: number, h: number, mi: number): number =>
  Date.UTC(2026, mo - 1, d, h - 3, mi);

const AT = ms(1, 10, 15, 12);
const dir = { cal: CAL.spa };
const TYPE = { first: 120, resolve: 1320, legal: 10 };

const req = (o: { status?: string; sla?: Sla; outcome?: string; resolvedAt?: number } = {}) => ({
  status: 'new',
  at: AT,
  sla: slaFor(CAL.spa, TYPE, AT),
  ...o,
});

describe('slaFor — цели от типа', () => {
  it('первый ответ и решение — в рабочих минутах, срок по закону — в календарных днях', () => {
    const s = slaFor(CAL.spa, TYPE, AT);
    expect(s.first).toEqual({ goal: 120, due: ms(1, 10, 17, 12), stopped: null });
    expect(s.resolve).toEqual({ goal: 1320, due: ms(3, 10, 15, 12), stopped: null });
    expect(s.legal).toEqual({ days: 10, due: AT + 10 * DAY_MS, stopped: null });
  });

  it('у типа без целей — null', () => {
    expect(slaFor(CAL.spa, { first: null, resolve: null, legal: null }, AT)).toEqual({
      first: null,
      resolve: null,
      legal: null,
    });
  });
});

describe('slaOf', () => {
  it('норма: осталось 48 мин до 17:12; решение — «1 день» до 3 октября', () => {
    const now = ms(1, 10, 16, 24);
    const [first, resolve, legal] = slaOf(req(), dir, now);
    expect(first).toEqual({
      key: 'first',
      label: 'Первый ответ',
      state: 'norm',
      text: 'осталось 48 мин',
      until: 'до 17:12',
      left: 48,
    });
    expect(resolve).toMatchObject({
      key: 'resolve',
      state: 'norm',
      text: 'осталось 1 день',
      until: 'до 3 октября, 15:12',
      left: 1248,
    });
    expect(legal).toEqual({
      key: 'legal',
      label: 'Ответ по закону',
      state: 'legal',
      text: 'осталось 10 дней',
      until: 'до 11 октября',
      left: 14_400,
    });
  });

  it('риск: остаток не больше max(20 мин, 25 % цели) — на границе уже риск', () => {
    expect(slaOf(req(), dir, ms(1, 10, 16, 50))[0]).toMatchObject({ state: 'risk', left: 22 });
    expect(slaOf(req(), dir, ms(1, 10, 16, 42))[0]).toMatchObject({ state: 'risk', left: 30 });
    expect(slaOf(req(), dir, ms(1, 10, 16, 41))[0]).toMatchObject({ state: 'norm', left: 31 });
    const short: Sla = { ...slaFor(CAL.spa, { first: 60, resolve: null, legal: null }, AT) };
    expect(slaOf(req({ sla: short }), dir, ms(1, 10, 15, 52))[0]).toMatchObject({
      state: 'risk',
      left: 20,
    });
    expect(slaOf(req({ sla: short }), dir, ms(1, 10, 15, 51))[0]).toMatchObject({
      state: 'norm',
      left: 21,
    });
  });

  it('просрочка: «просрочен на …», «был до …», величина в минутах', () => {
    const [first] = slaOf(req(), dir, ms(1, 10, 18, 0));
    expect(first).toEqual({
      key: 'first',
      label: 'Первый ответ',
      state: 'late',
      text: 'просрочен на 48 мин',
      until: 'был до 17:12',
      over: 48,
    });
  });

  it('срок по закону: ≤ 2 суток — риск; после срока — просрочен на N дней', () => {
    const due = AT + 10 * DAY_MS;
    expect(slaOf(req(), dir, due - 1.5 * DAY_MS)[2]).toMatchObject({
      state: 'risk',
      text: 'осталось 2 дня',
      left: 2880,
    });
    expect(slaOf(req(), dir, due + 2 * DAY_MS + 5 * 60_000)[2]).toMatchObject({
      state: 'late',
      text: 'просрочен на 2 дня',
      until: 'был до 11 октября, 15:12',
    });
  });

  it('«Ждёт клиента» ставит на паузу первый ответ и решение, но не срок по закону', () => {
    const out = slaOf(req({ status: 'wait' }), dir, ms(1, 10, 16, 24));
    expect(out.map((x) => [x.key, x.state])).toEqual([
      ['first', 'pause'],
      ['resolve', 'pause'],
      ['legal', 'legal'],
    ]);
    expect(out[0]).toMatchObject({ text: 'на паузе', until: 'ждём клиента' });
  });

  it('остановленный срок: «ответ за …» и в срок / с нарушением, прочие — «выполнено»', () => {
    const r = req();
    (r.sla.first as { stopped: number | null }).stopped = ms(1, 10, 15, 40);
    (r.sla.resolve as { stopped: number | null }).stopped = ms(3, 10, 16, 0);
    const [first, resolve] = slaOf(r, dir, ms(4, 10, 12, 0));
    expect(first).toEqual({
      key: 'first',
      label: 'Первый ответ',
      state: 'done',
      text: 'ответ за 28 мин',
      until: 'в срок',
    });
    expect(resolve).toMatchObject({
      state: 'done',
      text: 'выполнено',
      until: 'с нарушением срока',
    });
  });

  it('тип без целей — пустой список', () => {
    expect(
      slaOf(req({ sla: { first: null, resolve: null, legal: null } }), dir, ms(1, 10, 16, 0)),
    ).toEqual([]);
  });
});

describe('slaHead — главный срок и порядок очереди', () => {
  const now = ms(1, 10, 16, 24);

  it('решённое и закрытое: «Готово», итог, ранг — в конец, свежее решённое выше', () => {
    const a = slaHead(
      req({ status: 'resolved', outcome: 'Устранено', resolvedAt: 5e12 }),
      dir,
      now,
    );
    expect(a).toEqual({
      state: 'done',
      label: 'Готово',
      text: 'Устранено',
      until: '',
      rank: 2e12 - 5e12 / 1e3,
    });
    expect(slaHead(req({ status: 'closed' }), dir, now)).toMatchObject({ text: 'решено' });
  });

  it('без целей: «Срок», «без срока», ранг 1e12', () => {
    const r = req({ sla: { first: null, resolve: null, legal: null } });
    expect(slaHead(r, dir, now)).toEqual({
      state: 'none',
      label: 'Срок',
      text: 'без срока',
      until: '',
      rank: 1e12,
    });
  });

  it('просрочка важнее: берётся самая большая, ранг — минус величина', () => {
    const h = slaHead(req(), dir, ms(1, 10, 18, 0));
    expect(h).toMatchObject({ key: 'first', state: 'late', over: 48, rank: -48 });
  });

  it('первый ответ приоритетнее остальных, ранг — остаток', () => {
    const h = slaHead(req(), dir, now);
    expect(h).toMatchObject({ key: 'first', state: 'norm', left: 48, rank: 48 });
  });

  it('первый ответ уже дан — берётся срок с минимальным остатком', () => {
    const r = req();
    (r.sla.first as { stopped: number | null }).stopped = ms(1, 10, 15, 40);
    const h = slaHead(r, dir, now);
    expect(h).toMatchObject({ key: 'resolve', left: 1248, rank: 1248 });
  });

  it('пауза: «Пауза», «ждём клиента», «по закону …», ранг 9e11', () => {
    const h = slaHead(req({ status: 'wait' }), dir, now);
    expect(h).toEqual({
      state: 'pause',
      label: 'Пауза',
      text: 'ждём клиента',
      until: 'по закону до 11 октября',
      rank: 9e11,
    });
    const noLaw = req({ status: 'wait', sla: slaFor(CAL.spa, { ...TYPE, legal: null }, AT) });
    expect(slaHead(noLaw, dir, now)).toMatchObject({ until: 'срок стоит', rank: 9e11 });
  });

  it('все цели выполнены у открытого обращения — тоже пауза «срок стоит»', () => {
    const r = req({ sla: slaFor(CAL.spa, { first: 120, resolve: null, legal: null }, AT) });
    (r.sla.first as { stopped: number | null }).stopped = ms(1, 10, 15, 40);
    expect(slaHead(r, dir, now)).toMatchObject({ state: 'pause', until: 'срок стоит' });
  });

  it('сортировка: нарушенные (больше просрочка — раньше), по остатку, пауза, без срока, решённые', () => {
    const at = ms(1, 10, 17, 0);
    const rows = [
      { id: 'done', r: req({ status: 'resolved', resolvedAt: 1e12 }) },
      { id: 'none', r: req({ sla: { first: null, resolve: null, legal: null } }) },
      { id: 'wait', r: req({ status: 'wait' }) },
      { id: 'norm', r: { ...req(), at, sla: slaFor(CAL.spa, TYPE, at) } },
      { id: 'late', r: req() },
    ];
    const order = rows
      .map((x) => ({ id: x.id, rank: slaHead(x.r, dir, ms(1, 10, 18, 0)).rank }))
      .sort((a, b) => a.rank - b.rank)
      .map((x) => x.id);
    expect(order).toEqual(['late', 'norm', 'wait', 'none', 'done']);
  });
});
describe('resumeTimers — сдвиг сроков на простой в рабочих минутах', () => {
  it('сдвигает не остановленные first/resolve и снимает паузу; legal не трогает', () => {
    const r = {
      pausedAt: ms(1, 10, 12, 0) as number | null,
      sla: slaFor(CAL.spa, TYPE, AT),
    };
    const legal = r.sla.legal?.due;
    resumeTimers(r, CAL.spa, ms(1, 10, 15, 0));
    expect(r.pausedAt).toBeNull();
    expect(r.sla.first?.due).toBe(addWorkMinutes(ms(1, 10, 17, 12), 180, CAL.spa));
    expect(r.sla.first?.due).toBe(ms(1, 10, 20, 12));
    expect(r.sla.legal?.due).toBe(legal);
  });

  it('остановленный срок не сдвигается; без паузы — ничего', () => {
    const r = { pausedAt: ms(1, 10, 12, 0) as number | null, sla: slaFor(CAL.spa, TYPE, AT) };
    (r.sla.first as { stopped: number | null }).stopped = ms(1, 10, 15, 40);
    const due = r.sla.first?.due;
    resumeTimers(r, CAL.spa, ms(1, 10, 15, 0));
    expect(r.sla.first?.due).toBe(due);
    const idle = { pausedAt: null as number | null, sla: slaFor(CAL.spa, TYPE, AT) };
    resumeTimers(idle, CAL.spa, ms(1, 10, 15, 0));
    expect(idle.sla.resolve?.due).toBe(ms(3, 10, 15, 12));
  });
});

describe('isOpen', () => {
  it('решённое и закрытое — не открытые', () => {
    expect(isOpen({ status: 'new' })).toBe(true);
    expect(isOpen({ status: 'wait' })).toBe(true);
    expect(isOpen({ status: 'resolved' })).toBe(false);
    expect(isOpen({ status: 'closed' })).toBe(false);
  });
});
