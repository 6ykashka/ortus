// W2.25 · Экранные тесты «Главной» (S2-18; 05 §5, §9.1): шапка (дата, область, приветствие, сводка), «Начало
// работы» владельца, «Требует решения» на реестре источников (getMyDecisionQueue, MSW W2.00), «Сегодня в работе»,
// «Рейсы сегодня», «Последние события»; состояния — пусто, загрузка, ошибка и «Повторить»; переходы карточек.
// Часы браузера — 01.10.2026 10:30 МСК (как e2e, Q-61); часы сценарного сервера — «сейчас» сида.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 5_000 };
const EMPTY = 'Решений не требуется. Новые вопросы появятся здесь.';

let app: MockApp | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T07:30:00Z') });
});
afterEach(() => {
  app?.close();
  app = undefined;
  vi.useRealTimers();
});

const open = async (o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/home`, { persona: 'owner', ...o });
  await screen.findByRole('heading', { level: 1, name: /, / }, SLOW);
  return app;
};

const section = (): HTMLElement => {
  const h1 = screen.getByRole('heading', { level: 1 });
  const s = h1.closest('section');
  if (!s) throw new Error('нет section «Главной»');
  return s;
};
const queue = (): HTMLElement => screen.getByRole('region', { name: 'Требует решения' });
const titles = (): string[] =>
  within(queue())
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('strong')?.textContent ?? '');
const card = (title: string): HTMLElement => {
  const li = within(queue())
    .getAllByRole('listitem')
    .find((x) => x.querySelector('strong')?.textContent === title);
  if (!li) throw new Error(`нет карточки «${title}»`);
  return li;
};

describe('«Главная» владельца «Альты»', () => {
  it('шапка: дата и область, приветствие по часам, сводка по очереди', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Доброе утро, Дарья');
    expect(section().textContent).toContain('Четверг, 1 октября · Альта Групп · все подразделения');
    await waitFor(() =>
      expect(section().querySelector('.ox-home-summary')?.textContent).toBe(
        'Требует решения: 2. Сначала то, что блокирует работу.',
      ),
    );
  });

  it('«Требует решения»: пробный период и сотрудники без роли — тег, текст, кнопка; счётчик «2»', async () => {
    await open();
    await waitFor(() =>
      expect(titles()).toEqual(['Пробный период: осталось 12 дней', '3 сотрудника без роли']),
    );
    const trial = card('Пробный период: осталось 12 дней');
    expect(trial.textContent).toContain('Подписка');
    expect(trial.textContent).toContain(
      'До 13.10.2026. После окончания история останется доступной для чтения',
    );
    expect(within(trial).getByRole('button', { name: 'Модули и место' })).toBeTruthy();
    const noRole = card('3 сотрудника без роли');
    expect(noRole.textContent).toContain('Доступ');
    expect(noRole.textContent).toContain(
      'Марина Котова, Вера Котельникова, Тимур Ахмедов — нет доступа к модулям',
    );
    expect(within(queue()).getByText('2')).toBeTruthy();
  });

  it('«Назначить» → «Пользователи и роли» ?tab=people', async () => {
    const a = await open();
    await waitFor(() => expect(titles()).toHaveLength(2));
    fireEvent.click(
      within(card('3 сотрудника без роли')).getByRole('button', { name: 'Назначить' }),
    );
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/users`));
    expect(a.router.state.location.search).toEqual({ tab: 'people' });
  });

  it('«Начало работы»: «1 из 3», шаг 1 — «Модули и место», шаг 3 выполнен', async () => {
    await open();
    const setup = await waitFor(() => {
      const s = section().querySelector<HTMLElement>('.ox-home-setup');
      if (!s) throw new Error('нет «Начало работы»');
      return s;
    });
    expect(within(setup).getByRole('heading', { level: 2 }).textContent).toBe('Начало работы');
    await waitFor(() => expect(setup.textContent).toContain('1 из 3'));
    const steps = within(setup).getAllByRole('listitem');
    expect(steps.map((s) => s.querySelector('.ox-home-step-title')?.textContent)).toEqual([
      'Подключить отраслевой модуль',
      'Назначить роли с областью',
      'Пригласить сотрудников',
    ]);
    expect(
      within(steps[0] as HTMLElement).getByRole('button', { name: 'Модули и место' }),
    ).toBeTruthy();
    expect(
      within(steps[1] as HTMLElement).getByRole('button', { name: 'Назначить роль' }),
    ).toBeTruthy();
    expect(within(steps[2] as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('«Сегодня в работе»: пунктир «Логистика» и «Ремонт и стройка», «Подключить» → «Модули и место»', async () => {
    const a = await open();
    expect(screen.getByRole('heading', { level: 2, name: 'Сегодня в работе' })).toBeTruthy();
    const off = [...section().querySelectorAll<HTMLElement>('.ox-home-off')];
    expect(off.map((o) => o.querySelector('strong')?.textContent)).toEqual([
      'Логистика',
      'Ремонт и стройка',
    ]);
    expect(off[0]?.textContent).toContain('Модуль не подключён');
    fireEvent.click(within(off[0] as HTMLElement).getByRole('button', { name: 'Подключить' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/modules`));
  });

  it('«Последние события»: входящие участника (до 5), «Рейсы сегодня» без логистики нет', async () => {
    await open();
    const events = screen.getByRole('heading', { level: 2, name: 'Последние события' });
    const box = events.parentElement as HTMLElement;
    await waitFor(() => expect(box.textContent).toContain('Олеся Петрова приняла приглашение'));
    expect(screen.queryByRole('heading', { level: 2, name: 'Рейсы сегодня' })).toBeNull();
  });
});

describe('«Главная» логиста', () => {
  it('без роли: «Область не назначена», «Срочных вопросов нет.», пусто, без «Начало работы»', async () => {
    await open({ persona: 'manager' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Доброе утро, Марина');
    expect(section().textContent).toContain('Четверг, 1 октября · Область не назначена');
    await waitFor(() => expect(queue().textContent).toContain(EMPTY));
    expect(section().querySelector('.ox-home-summary')?.textContent).toBe('Срочных вопросов нет.');
    expect(section().querySelector('.ox-home-setup')).toBeNull();
    expect(section().querySelector('.ox-home-work')).toBeNull();
    expect(section().textContent).toContain('Событий пока нет');
  });

  it('«Логистика» подключена: «Рейс Р-211 без водителя», «Логистика» и «Рейсы сегодня»', async () => {
    const a = await open({ persona: 'manager', preset: 'logistics-ready' });
    // Подпись области — после listOrgUnits, как область шапки: логисту видна только его фирма, поэтому без региона
    // («Москва / Север Логистик» эталона, M.scopeLabel :4124) — та же подпись, что в шапке (W1.20).
    await waitFor(() =>
      expect(section().textContent).toContain('Четверг, 1 октября · Север Логистик'),
    );
    await waitFor(() => expect(titles()).toEqual(['Рейс Р-211 без водителя']));
    const trip = card('Рейс Р-211 без водителя');
    expect(trip.textContent).toContain('Сегодня 14:00');
    expect(trip.textContent).toContain('Охлаждённая продукция · Молочная продукция · +2…+6 °C');
    const work = await waitFor(() => {
      const w = section().querySelector<HTMLElement>('.ox-home-work');
      if (!w?.textContent?.includes('Рейсов сегодня2')) throw new Error('нет «Логистика»');
      return w;
    });
    expect(work.textContent).toContain('В пути0');
    expect(work.textContent).toContain('Ждут приёмки0');
    const trips = await screen.findByRole('heading', { level: 2, name: 'Рейсы сегодня' }, SLOW);
    const rows = within(trips.parentElement as HTMLElement).getAllByRole('button');
    expect(rows.map((r) => r.querySelector('.ox-home-trip-title')?.textContent)).toEqual([
      'Р-208 · Северный маршрут',
      'Р-211 · Охлаждённая продукция',
    ]);
    expect(rows[1]?.textContent).toContain('без водителя · машина не выбрана');
    expect(rows[0]?.textContent).toContain('Запланирован');
    fireEvent.click(within(trip).getByRole('button', { name: 'Найти в пуле' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/pool`));
  });
});

// W2.80 · Время «Главной» — всегда московское (core/clock TZ), как в «Брендинге» и календаре: CI GitHub идёт в UTC,
// а пользователь может открыть страницу из другого пояса. Пояс процесса меняется на время теста (Node сбрасывает
// пояс Intl и Date при присваивании process.env.TZ); проверки — те же подписи, что у браузера в Москве.
describe('«Главная» в браузере другого часового пояса', () => {
  let saved: string | undefined;
  const setZone = (tz: string | undefined): void => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  };
  beforeEach(() => {
    saved = process.env.TZ;
  });
  afterEach(() => setZone(saved));

  for (const zone of ['UTC', 'Asia/Vladivostok']) {
    it(`${zone}: приветствие, дата, «Требует решения» и «Рейсы сегодня» — по Москве`, async () => {
      setZone(zone);
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
      await open({ persona: 'manager', preset: 'logistics-ready' });
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Доброе утро, Марина');
      await waitFor(() =>
        expect(section().textContent).toContain('Четверг, 1 октября · Север Логистик'),
      );
      await waitFor(() => expect(titles()).toEqual(['Рейс Р-211 без водителя']));
      expect(card('Рейс Р-211 без водителя').textContent).toContain('Сегодня 14:00');
      const trips = await screen.findByRole('heading', { level: 2, name: 'Рейсы сегодня' }, SLOW);
      const times = within(trips.parentElement as HTMLElement)
        .getAllByRole('button')
        .map((r) => r.querySelector('.ox-home-trip-time')?.textContent);
      expect(times).toEqual(['09:00', '14:00']);
    });
  }
});

describe('«Главная» водителя', () => {
  // Возврат 1 (ревью W2.25, бриф §3): в эталоне у водителя «Главной» нет — прямой URL уводит на его стартовую
  // страницу (первый пункт меню), офисная «Главная» не рендерится и очередь не запрашивается.
  it('прямой URL /t/…/home → стартовая страница водителя, без приветствия', async () => {
    app = await renderMockApp(`/t/${ALTA}/home`, { persona: 'driver' });
    const a = app;
    await waitFor(() => expect(a.path()).not.toBe(`/t/${ALTA}/home`), SLOW);
    expect(a.path()).toMatch(new RegExp(`^/t/${ALTA}/`));
    expect(screen.queryByRole('heading', { level: 1, name: /^(Доброе|Добрый) / })).toBeNull();
    expect(document.querySelector('section[aria-labelledby="h-home"]')).toBeNull();
  }, 15_000);
});

describe('«Главная»: состояния очереди', () => {
  it('загрузка: скелетон «Загрузка» в «Требует решения», затем карточки', async () => {
    await open({ scenario: 'getMyDecisionQueue=delay=400' });
    expect(within(queue()).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    await waitFor(() => expect(titles()).toHaveLength(2), SLOW);
  });

  it('ошибка: alert с текстом кода и «Повторить» перечитывает очередь', async () => {
    const a = await open({ scenario: 'getMyDecisionQueue=rate_limited' });
    const alert = await within(queue()).findByRole('alert', undefined, SLOW);
    expect(alert.textContent).not.toBe('');
    a.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(titles()).toHaveLength(2), SLOW);
  });
});
