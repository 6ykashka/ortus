// W7.33 · Модель портала клиента: группы типов, лента статусов, оценка визита, проверка формы, «Мои обращения»,
// причины отказа. Подписи — дословно из `Обращения - варианты.dc.html` 1a (design-2026-10-19).
import { ProblemError } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  addMine,
  groupTypes,
  hhmm,
  longDay,
  type Mine,
  readMine,
  refusalOf,
  SCALE,
  stepsOf,
  validateSubmit,
  visitSubmission,
  VISIT_REASONS,
} from './model.ts';

const T = (id: string, kind: string, name: string) => ({ id, kind, name }) as never;

describe('groupTypes: «Чем помочь?»', () => {
  const types = [
    T('a', 'complaint', 'Жалоба'),
    T('b', 'claim', 'Вернуть деньги за услугу'),
    T('c', 'question', 'Вопрос'),
    T('d', 'idea', 'Предложение'),
    T('e', 'thanks', 'Спасибо мастеру'),
  ];

  it('три группы в порядке макета, внутри — порядок типов направления', () => {
    const g = groupTypes(types);
    expect(g.map((x) => x.title)).toEqual([
      'Оценить и поблагодарить',
      'Если что-то не так',
      'Другое',
    ]);
    expect(g[0]?.items.map((x) => x.name)).toEqual(['Спасибо мастеру']);
    expect(g[1]?.items.map((x) => x.name)).toEqual(['Жалоба', 'Вернуть деньги за услугу']);
    expect(g[2]?.items.map((x) => x.name)).toEqual(['Вопрос', 'Предложение']);
  });

  it('пустая группа не показывается; гарантия и груз — «Если что-то не так»', () => {
    const g = groupTypes([T('w', 'warranty', 'Гарантийный случай'), T('k', 'cargo', 'Груз')]);
    expect(g.map((x) => x.title)).toEqual(['Если что-то не так']);
    expect(g[0]?.items.map((x) => x.icon)).toEqual(['build', 'local_shipping']);
  });

  it('значки типов по макету', () => {
    const icons = groupTypes(types).flatMap((x) => x.items.map((i) => [i.name, i.icon]));
    expect(icons).toEqual([
      ['Спасибо мастеру', 'favorite'],
      ['Жалоба', 'report'],
      ['Вернуть деньги за услугу', 'currency_ruble'],
      ['Вопрос', 'help'],
      ['Предложение', 'lightbulb'],
    ]);
  });
});

describe('шкала оценки', () => {
  it('пять значков от «плохо» до «отлично»', () => {
    expect(SCALE.map((s) => s.score)).toEqual([1, 2, 3, 4, 5]);
    expect(SCALE[0]?.icon).toBe('sentiment_very_dissatisfied');
    expect(SCALE[4]?.icon).toBe('sentiment_very_satisfied');
    expect(SCALE[2]?.label).toBe('3 из 5');
  });
});

describe('время и даты по Москве', () => {
  it('hhmm и longDay', () => {
    expect(hhmm('2026-10-01T12:12:00Z')).toBe('15:12');
    expect(longDay('2026-10-12T21:30:00Z')).toBe('13 октября');
  });
});

describe('stepsOf: «Получили · Ответили · Решено»', () => {
  const msg = (fromClient: boolean, at: string) => ({
    id: at,
    at,
    text: 'x',
    fromClient,
    files: [],
  });
  it('новое: только «Получили» с временем первого сообщения', () => {
    const s = stepsOf('new', [msg(true, '2026-10-01T12:12:00Z')]);
    expect(s).toEqual([
      { key: 'got', label: 'Получили', at: '15:12', done: true, current: true },
      { key: 'answered', label: 'Ответили', at: null, done: false, current: false },
      { key: 'resolved', label: 'Решено', at: null, done: false, current: false },
    ]);
  });
  it('ответ сотрудника — «Ответили» с временем первого ответа', () => {
    const s = stepsOf('work', [
      msg(true, '2026-10-01T12:12:00Z'),
      msg(false, '2026-10-01T13:31:00Z'),
    ]);
    expect(s.map((x) => [x.key, x.done, x.current, x.at])).toEqual([
      ['got', true, false, '15:12'],
      ['answered', true, true, '16:31'],
      ['resolved', false, false, null],
    ]);
  });
  it('решено и закрыто: все три пройдены, текущий — «Решено»', () => {
    for (const st of ['resolved', 'closed'] as const) {
      const s = stepsOf(st, [
        msg(true, '2026-10-01T12:12:00Z'),
        msg(false, '2026-10-01T13:31:00Z'),
      ]);
      expect(s.every((x) => x.done)).toBe(true);
      expect(s.find((x) => x.current)?.key).toBe('resolved');
    }
  });
  it('решено без ответа в ленте: «Ответили» засчитано', () => {
    const s = stepsOf('resolved', [msg(true, '2026-10-01T12:12:00Z')]);
    expect(s[1]).toMatchObject({ done: true, at: null });
  });
});

describe('visitSubmission: оценка визита → обращение', () => {
  it('1–3 — жалоба, причины и комментарий в тексте, просьба связаться', () => {
    const v = visitSubmission({
      score: 2,
      reasons: ['Опоздание начала', 'Температура в кабинете'],
      comment: 'Холодно.',
      contact: true,
    });
    expect(v.kind).toBe('complaint');
    expect(v.text).toBe(
      'Оценка визита: 2 из 5. Что пошло не так: Опоздание начала, Температура в кабинете. Холодно. Свяжитесь со мной.',
    );
  });
  it('4–5 — спасибо без причин', () => {
    const v = visitSubmission({ score: 5, reasons: ['Цена'], comment: '', contact: false });
    expect(v.kind).toBe('thanks');
    expect(v.text).toBe('Оценка визита: 5 из 5.');
  });
  it('причины макета', () => {
    expect(VISIT_REASONS).toEqual([
      'Опоздание начала',
      'Температура в кабинете',
      'Чистота',
      'Мастер',
      'Запись',
      'Цена',
    ]);
  });
});

describe('validateSubmit', () => {
  const ok = { text: 'Холодно в кабинете', consent: true, phone: '', needPhone: false };
  it('пустая форма: текст и согласие', () => {
    expect(validateSubmit({ ...ok, text: ' ', consent: false })).toEqual({
      text: 'Опишите, что случилось',
      consent: 'Нужно согласие на обработку персональных данных',
    });
  });
  it('телефон — не меньше 10 цифр, когда нужен или введён', () => {
    expect(validateSubmit({ ...ok, needPhone: true })).toEqual({
      phone: 'Телефон — не меньше 10 цифр',
    });
    expect(validateSubmit({ ...ok, phone: '+7 900 12' })).toEqual({
      phone: 'Телефон — не меньше 10 цифр',
    });
    expect(validateSubmit({ ...ok, phone: '+7 900 123-45-67' })).toEqual({});
  });
  it('верная форма — без ошибок', () => {
    expect(validateSubmit(ok)).toEqual({});
  });
});

describe('«Мои обращения»: хранение в браузере клиента', () => {
  const store = (): Storage => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    } as unknown as Storage;
  };
  const row = (n: number): Mine => ({
    key: `МАС-${n}`,
    title: `t${n}`,
    token: `tok${n}`.padEnd(20, 'x'),
  });

  it('пусто; добавление сверху; повтор токена не плодит строку', () => {
    const s = store();
    expect(readMine('mas', s)).toEqual([]);
    addMine('mas', row(1), s);
    addMine('mas', row(2), s);
    addMine('mas', row(1), s);
    expect(readMine('mas', s).map((x) => x.key)).toEqual(['МАС-1', 'МАС-2']);
    expect(readMine('kos', s)).toEqual([]);
  });
  it('не больше 20; повреждённое значение и сбой хранилища — пусто', () => {
    const s = store();
    for (let i = 1; i <= 25; i++) addMine('mas', row(i), s);
    expect(readMine('mas', s)).toHaveLength(20);
    s.setItem('ox-sp-mine:mas', '{не json');
    expect(readMine('mas', s)).toEqual([]);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readMine('mas', broken)).toEqual([]);
    expect(() => addMine('mas', row(1), broken)).not.toThrow();
  });
});

describe('refusalOf', () => {
  const problem = (status: number, code: string) =>
    new ProblemError(status, { code, title: code, status } as never);
  it('404, 410, 429, нет связи, прочее', () => {
    expect(refusalOf(problem(404, 'not_found'))).toBe('notFound');
    expect(refusalOf(problem(410, 'public_token_expired'))).toBe('expired');
    expect(refusalOf(problem(429, 'rate_limited'))).toBe('rateLimited');
    expect(refusalOf(new TypeError('Failed to fetch'))).toBe('offline');
    expect(refusalOf(problem(500, 'internal'))).toBeNull();
    expect(refusalOf(new Error('x'))).toBeNull();
  });
});
