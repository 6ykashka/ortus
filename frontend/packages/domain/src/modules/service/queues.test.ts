// Очереди «Обращений» (Обращения.dc.html:386–431): счётчики, фильтры, поиск, сортировка по сроку.
import { describe, expect, it } from 'vitest';
import { directionCounts, QUEUES, queueCounts, requestQueue, takeable } from './queues.ts';
import { serviceSeed, SVC_BASE } from './seed.ts';
import { at } from './fixture.test-util.ts';

const S = serviceSeed();
const ME = 'Дарья Зимина';
const base = { dir: 'all', me: ME, now: SVC_BASE };
const keys = (q: string, o: Partial<Parameters<typeof requestQueue>[1]> = {}): string[] =>
  requestQueue(S, { ...base, queue: q, ...o }).rows.map((x) => x.request.key);

describe('QUEUES', () => {
  it('восемь очередей дословно, у двух есть тон', () => {
    expect(QUEUES.map((q) => [q.key, q.label, q.icon, q.tone])).toEqual([
      ['open', 'Открытые', 'inbox', undefined],
      ['noreply', 'Без ответа', 'mark_email_unread', undefined],
      ['mine', 'Мои', 'person', undefined],
      ['risk', 'Срок под угрозой', 'schedule', 'warn'],
      ['late', 'Срок нарушен', 'error', 'danger'],
      ['wait', 'Ждут клиента', 'hourglass_top', undefined],
      ['low', 'Низкие оценки', 'sentiment_dissatisfied', undefined],
      ['done', 'Решено и закрыто', 'task_alt', undefined],
    ]);
  });
});

describe('queueCounts на сиде в 1.10 16:24', () => {
  it('счётчики очередей по всем направлениям', () => {
    expect(queueCounts(S, base)).toEqual({
      open: 7,
      noreply: 4,
      mine: 2,
      risk: 0,
      late: 1,
      wait: 1,
      low: 2,
      done: 1,
    });
  });

  it('по направлению: ГРЗ — 2 открытых, 1 без ответа, 1 нарушено, 1 оценка', () => {
    expect(queueCounts(S, { ...base, dir: 'd-grz' })).toEqual({
      open: 2,
      noreply: 1,
      mine: 0,
      risk: 0,
      late: 1,
      wait: 1,
      low: 1,
      done: 0,
    });
  });

  it('позже срок под угрозой: в 16:50 у МАС-41 остаток 22 мин', () => {
    const c = queueCounts(S, { ...base, now: SVC_BASE + 26 * 60_000 });
    expect(c.risk).toBe(1);
    expect(c.late).toBe(1);
  });

  it('число открытых по направлениям не зависит от выбранного направления', () => {
    expect(directionCounts(S)).toEqual({ all: 7, 'd-mas': 2, 'd-kos': 1, 'd-otd': 2, 'd-grz': 2 });
  });
});

describe('requestQueue — строки и порядок', () => {
  it('«Открытые»: сначала нарушенные, затем по остатку срока, пауза в конце', () => {
    expect(keys('open')).toEqual([
      'ГРЗ-57',
      'МАС-41',
      'МАС-40',
      'КОС-6',
      'ОТД-12',
      'ОТД-11',
      'ГРЗ-55',
    ]);
  });

  it('у строки есть главный срок', () => {
    const rows = requestQueue(S, { ...base, queue: 'open' }).rows;
    expect(rows[0]?.head).toMatchObject({ state: 'late', text: 'просрочен на 1 ч 10 мин' });
    expect(rows[1]?.head).toMatchObject({
      state: 'norm',
      label: 'Первый ответ',
      text: 'осталось 48 мин',
    });
    expect(rows[4]?.head).toMatchObject({ text: 'осталось 9 раб. дней' });
    expect(rows.at(-1)?.head).toMatchObject({ state: 'pause', until: 'по закону до 26 октября' });
  });

  it.each([
    ['noreply', ['ГРЗ-57', 'МАС-41', 'МАС-40', 'КОС-6']],
    ['mine', ['ОТД-12', 'ОТД-11']],
    ['late', ['ГРЗ-57']],
    ['risk', []],
    ['wait', ['ГРЗ-55']],
    ['done', ['МАС-39']],
  ])('очередь «%s»', (queue, want) => {
    expect(keys(queue)).toEqual(want);
  });

  it('«Низкие оценки»: строк обращений нет, только открытые оценки направления', () => {
    const r = requestQueue(S, { ...base, queue: 'low' });
    expect(r.rows).toEqual([]);
    expect(r.ratings.map((x) => x.id)).toEqual(['S-311', 'S-305']);
    expect(
      requestQueue(S, { ...base, queue: 'low', dir: 'd-grz' }).ratings.map((x) => x.id),
    ).toEqual(['S-305']);
  });

  it('просмотренная оценка в очередь не попадает', () => {
    const copy = serviceSeed();
    at(copy.ratings, 0).status = 'seen';
    expect(requestQueue(copy, { ...base, queue: 'low' }).ratings.map((x) => x.id)).toEqual([
      'S-305',
    ]);
  });

  it('неизвестная очередь — как «Открытые»', () => {
    expect(keys('zzz')).toEqual(keys('open'));
  });

  it('фильтры: направление, тип, канал', () => {
    expect(keys('open', { dir: 'd-otd' })).toEqual(['ОТД-12', 'ОТД-11']);
    expect(keys('open', { type: 'cargo' })).toEqual(['ГРЗ-57', 'ГРЗ-55']);
    expect(keys('open', { channel: 'phone' })).toEqual(['ГРЗ-55']);
    expect(keys('open', { type: 'cargo', channel: 'bot' })).toEqual(['ГРЗ-57']);
  });

  it('поиск: ключ, заголовок, имя клиента, компания, старый номер; регистр и пробелы не важны', () => {
    expect(keys('open', { q: '  мас-41 ' })).toEqual(['МАС-41']);
    expect(keys('open', { q: 'ЛАВКА' })).toEqual(['ГРЗ-57']);
    expect(keys('open', { q: 'ламинат' })).toEqual(['ОТД-11']);
    expect(keys('open', { q: 'лаврова' })).toEqual(['МАС-40']);
    expect(keys('open', { q: '+7 916' })).toEqual([]);
    const copy = serviceSeed();
    at(copy.requests, 0).oldKeys = ['МАС-5'];
    expect(
      requestQueue(copy, { ...base, queue: 'open', q: 'мас-5' }).rows.map((x) => x.request.key),
    ).toEqual(['ГРЗ-57']);
  });
});

describe('takeable — «Взять себе»', () => {
  const grz = { ...at(S.directions, 3), team: ['Дарья Зимина', 'Вера Котельникова'] };
  const r57 = at(S.requests, 0);

  it('без исполнителя, открыто, есть право и участник в команде', () => {
    expect(takeable(r57, grz, ME, true)).toBe(true);
  });

  it('нет права «Отвечать», не в команде, есть исполнитель или решено — нельзя', () => {
    expect(takeable(r57, grz, ME, false)).toBe(false);
    expect(takeable(r57, grz, 'Марина Котова', true)).toBe(false);
    expect(takeable(at(S.requests, 5), grz, ME, true)).toBe(false);
    expect(takeable(at(S.requests, 7), grz, ME, true)).toBe(false);
  });
});
