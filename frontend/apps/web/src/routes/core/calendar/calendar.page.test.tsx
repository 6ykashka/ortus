// W4.41 · Экранные тесты «Календаря» (`core-calendar`, CAL-01…05; эталон design-2026-10-19 pg.calendar :1781–1823,
// calVM :4140–4180; чек-лист 06 §13 п. 1–9, 52). Сеть — сценарный сервер W4.06 (listCalendarResources,
// listCalendarBookings, getCalendarBooking, updateCalendarBooking, findCalendarAvailability) на сиде календаря
// «Альты»; машины и рейс — пресет logistics-ready. День — `?date=2026-10-01` (день сида; часы теста — реальные).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const SLOW = { timeout: 5_000 };
const DAY = '?date=2026-10-01';
const MASSAGE = 'Классический массаж · Мария К., 10:00–11:00';
const OWNER_ROWS = [
  'ГАЗель Next · А 412 МР',
  'ГАЗон Next · Е 905 НА',
  'Mercedes Sprinter · Т 771 ЕХ',
  'Анна Морозова · массажист',
  'Илья Васильев · водитель',
  'Кабинет № 2',
  'Кабинет № 3',
  'Стол с подогревом',
];
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Запрос приложения к сценарному серверу (заголовки — для проверки команд). */
interface Exchange {
  method: string;
  path: string;
  headers: Headers;
}

/**
 * Наблюдатель запросов: обёртка fetch со сквозным вызовом, поставленная после `server.listen` MSW и до создания
 * клиента API (`setup` renderMockApp), как в «Организациях» W1.25. Ответ даёт сценарный сервер.
 */
const watchRequests = (): { seen: Exchange[]; setup: () => void } => {
  const seen: Exchange[] = [];
  return {
    seen,
    setup: () => {
      const through = globalThis.fetch;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const req = new Request(input, init);
        seen.push({ method: req.method, path: new URL(req.url).pathname, headers: req.headers });
        return through(req);
      });
    },
  };
};

/** Строка брони в состоянии сценарного сервера (правка «другим участником» мимо экрана). */
interface BookingRowState {
  id: string;
  window: { startsAt: string; endsAt: string; timeZone: string };
  revision: number;
}
const bookingRow = (a: MockApp, id: string): BookingRowState => {
  const orgs = (
    a.scenario.state() as unknown as {
      orgs: Record<string, { calendar?: { bookings: BookingRowState[] } }>;
    }
  ).orgs;
  const row = orgs[ALTA]?.calendar?.bookings.find((b) => b.id === id);
  if (!row) throw new Error(`нет брони ${id}`);
  return row;
};
const listGets = (a: MockApp) =>
  a
    .responses()
    .filter((r) => r.method === 'GET' && r.path === `/api/v1/tenants/${ALTA}/calendar/bookings`)
    .length;

const open = async (
  o: Parameters<typeof renderMockApp>[1] & { search?: string } = {},
): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/calendar${o.search ?? DAY}`, {
    persona: 'owner',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: 'Календарь ресурсов' }, SLOW);
  return app;
};

const section = () => document.querySelector<HTMLElement>('section[aria-labelledby="h-cal"]');
const rowNames = () =>
  [...document.querySelectorAll('.ox-cal-name')].map((x) => x.textContent ?? '');
const rowsLoaded = (n: number) => waitFor(() => expect(rowNames()).toHaveLength(n), SLOW);
const filterGroup = () => screen.getByRole('group', { name: 'Тип ресурса' });
const filterButtons = () =>
  within(filterGroup())
    .getAllByRole('button')
    .map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
const blocks = (name: string) => screen.queryAllByRole('button', { name });
const panel = () => document.querySelector<HTMLElement>('.ox-cal-panel');
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const select = () => screen.getByLabelText<HTMLSelectElement>('Перенести начало на');
const dateLine = () => document.querySelector('.ox-cal-date')?.textContent;

async function pick(name: string, title: string): Promise<HTMLElement> {
  await waitFor(() => expect(blocks(name).length).toBeGreaterThan(0), SLOW);
  fireEvent.click(blocks(name)[0] as HTMLElement);
  return screen.findByRole('heading', { level: 2, name: title }, SLOW);
}

async function moveTo(label: string): Promise<void> {
  fireEvent.change(select(), {
    target: { value: [...select().options].find((o) => o.textContent === label)?.value },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Проверить и перенести' }));
}

describe('«Календарь»: шапка, фильтр, таймлайн', () => {
  it('владелец: строка даты, заголовок, фильтр видов, 8 ресурсов в порядке сервера', async () => {
    await open();
    await rowsLoaded(8);
    expect(dateLine()).toBe('Четверг, 1 октября 2026 · Москва (UTC+3)');
    expect(filterButtons()).toEqual([
      ['Все ресурсы', 'true'],
      ['Машины', 'false'],
      ['Сотрудники', 'false'],
      ['Помещения', 'false'],
      ['Оборудование', 'false'],
    ]);
    expect(rowNames()).toEqual(OWNER_ROWS);
    expect([...document.querySelectorAll('.ox-cal-hours span')].map((x) => x.textContent)).toEqual([
      '8:00',
      '10:00',
      '12:00',
      '14:00',
      '16:00',
      '18:00',
      '20:00',
    ]);
    expect(section()?.textContent).toContain('подготовка и уборка — ресурс занят');
    expect(section()?.textContent).toContain(
      'Срок задачи ресурс не занимает. Перенос — предложение, его подтверждает сервер.',
    );
  });

  it('блоки броней дня: подписи эталона, бронь на трёх ресурсах — три блока, тон по источнику', async () => {
    await open();
    await rowsLoaded(8);
    await waitFor(() => expect(blocks('Рейс Р-208, 09:00–13:00')).toHaveLength(1), SLOW);
    expect(blocks('Плановое ТО, 08:00–20:00')).toHaveLength(1);
    expect(blocks('SPA-ритуал · Ольга Р., 11:30–13:00')).toHaveLength(3);
    expect(blocks(MASSAGE)).toHaveLength(2);
    expect(blocks('Перерыв, 13:15–14:00')).toHaveLength(1);
    expect(blocks('Массаж спины · Екатерина Л., 14:00–14:45')).toHaveLength(2);
    expect(blocks('Плановое ТО, 08:00–20:00')[0]?.dataset.tone).toBe('danger');
    expect(blocks('Рейс Р-208, 09:00–13:00')[0]?.dataset.tone).toBe('info');
    expect(blocks(MASSAGE)[0]?.dataset.tone).toBe('ok');
    expect(blocks('Перерыв, 13:15–14:00')[0]?.dataset.tone).toBe('neutral');
    expect(panel()).toBeNull();
  });

  it('фильтр «Машины» — 3 строки, «Помещения» — кабинеты, «Все ресурсы» — 8', async () => {
    await open();
    await rowsLoaded(8);
    fireEvent.click(within(filterGroup()).getByRole('button', { name: 'Машины' }));
    expect(rowNames()).toEqual(OWNER_ROWS.slice(0, 3));
    expect(filterButtons()[1]).toEqual(['Машины', 'true']);
    fireEvent.click(within(filterGroup()).getByRole('button', { name: 'Помещения' }));
    expect(rowNames()).toEqual(['Кабинет № 2', 'Кабинет № 3']);
    fireEvent.click(within(filterGroup()).getByRole('button', { name: 'Все ресурсы' }));
    expect(rowNames()).toHaveLength(8);
  });

  it('массажист: свой ресурс и забронированные вместе с ним, без машин (Q-W4.06-2)', async () => {
    await open({ persona: 'therapist', preset: undefined });
    await rowsLoaded(3);
    expect(rowNames()).toEqual(['Анна Морозова · массажист', 'Кабинет № 2', 'Стол с подогревом']);
    expect(filterButtons().map(([l]) => l)).toEqual([
      'Все ресурсы',
      'Сотрудники',
      'Помещения',
      'Оборудование',
    ]);
    expect(blocks('Рейс Р-208, 09:00–13:00')).toHaveLength(0);
  });

  it('водитель (гейт пропускает по calendar.availability.read, ресурсы — 403): «Нет доступа к разделу «Календарь»»', async () => {
    app = await renderMockApp(`/t/${ALTA}/calendar${DAY}`, { persona: 'driver' });
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Нет доступа к разделу «Календарь»' },
        SLOW,
      ),
    ).toBeTruthy();
    expect(section()).toBeNull();
  });

  it('ошибка ресурсов — «Не удалось загрузить данные…» и «Повторить»', async () => {
    await open({ scenario: 'listCalendarResources=rate_limited' });
    expect((await screen.findByRole('alert', undefined, SLOW)).textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    app?.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await rowsLoaded(8);
  });
});

describe('«Календарь»: панель брони и перенос', () => {
  it('визит: заголовок, мета, «Открыть визит», выбор начала (48 вариантов, текущее — 10:00), ?booking=', async () => {
    const a = await open();
    await pick(MASSAGE, 'Классический массаж · Мария К.');
    expect(panel()?.textContent).toContain(
      '10:00–11:00 · уборка 15 мин · Анна Морозова · массажист, Кабинет № 2',
    );
    expect(
      within(panel() as HTMLElement).getByRole('button', { name: 'Открыть визит' }),
    ).toBeTruthy();
    expect(select().selectedOptions[0]?.textContent).toBe('10:00');
    expect(select().options).toHaveLength(48);
    expect(a.router.state.location.search).toMatchObject({ booking: A('b-a1') });
    expect(blocks(MASSAGE)[0]?.getAttribute('aria-pressed')).toBeNull();
    expect(blocks(MASSAGE)[0]?.dataset.selected).toBe('');
  });

  it('11:00 — конфликт эталона и слоты «08:00», «08:15», «08:30»; слот переносит с тостом', async () => {
    const a = await open();
    await pick(MASSAGE, 'Классический массаж · Мария К.');
    await moveTo('11:00');
    const alert = await screen.findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toContain(
      'Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); Кабинет № 2 занят («SPA-ритуал · Ольга Р.»)',
    );
    expect(alert.textContent).toContain('Свободные слоты для всех ресурсов:');
    await waitFor(
      () =>
        expect(
          within(alert)
            .getAllByRole('button')
            .map((b) => b.textContent),
        ).toEqual(['08:00', '08:15', '08:30']),
      SLOW,
    );
    expect(toast()).toBeUndefined();
    expect(a.responses().some((r) => r.method === 'PATCH' && r.status === 409)).toBe(true);
    fireEvent.click(within(alert).getByRole('button', { name: '08:15' }));
    await waitFor(() => expect(toast()).toBe('Перенесено на 08:15'), SLOW);
    await waitFor(
      () => expect(blocks('Классический массаж · Мария К., 08:15–09:15')).toHaveLength(2),
      SLOW,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('08:00 — «Перенос подтверждён сервером», блок и выбор сдвинуты', async () => {
    await open();
    await pick(MASSAGE, 'Классический массаж · Мария К.');
    await moveTo('08:00');
    await waitFor(() => expect(toast()).toBe('Перенос подтверждён сервером'), SLOW);
    await waitFor(
      () => expect(blocks('Классический массаж · Мария К., 08:00–09:00')).toHaveLength(2),
      SLOW,
    );
    expect(select().selectedOptions[0]?.textContent).toBe('08:00');
  });

  it('рейс, ТО и перерыв — текст запрета эталона, без выбора времени; кнопки источника', async () => {
    await open();
    await pick('Рейс Р-208, 09:00–13:00', 'Рейс Р-208');
    expect(screen.queryByLabelText('Перенести начало на')).toBeNull();
    expect(panel()?.textContent).toContain(
      'Время рейса меняется в рабочем месте логиста — календарь вызывает команду исходного модуля.',
    );
    expect(
      within(panel() as HTMLElement).getByRole('button', { name: 'Открыть рейс' }),
    ).toBeTruthy();
    await pick('Плановое ТО, 08:00–20:00', 'Плановое ТО');
    expect(panel()?.textContent).toContain('Недоступность машины задаётся в карточке машины.');
    expect(
      within(panel() as HTMLElement).getByRole('button', { name: 'Открыть машину' }),
    ).toBeTruthy();
    await pick('Перерыв, 13:15–14:00', 'Перерыв');
    expect(panel()?.textContent).toContain('Перерыв меняется в графике специалиста.');
    expect(within(panel() as HTMLElement).queryAllByRole('button')).toHaveLength(0);
  });

  it('«Открыть рейс» — «Рабочее место логиста» с ?trip=', async () => {
    const a = await open();
    await pick('Рейс Р-208, 09:00–13:00', 'Рейс Р-208');
    fireEvent.click(within(panel() as HTMLElement).getByRole('button', { name: 'Открыть рейс' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/fleet`), SLOW);
    expect(a.router.state.location.search).toMatchObject({ trip: A('Р-208') });
  });

  it('логист без права «Изменять»: рейс — «Нет права «Изменять» в календаре.»', async () => {
    await open({ persona: 'manager' });
    await rowsLoaded(4);
    expect(rowNames()).toEqual([...OWNER_ROWS.slice(0, 3), 'Илья Васильев · водитель']);
    await pick('Рейс Р-208, 09:00–13:00', 'Рейс Р-208');
    expect(panel()?.textContent).toContain('Нет права «Изменять» в календаре.');
    expect(screen.queryByLabelText('Перенести начало на')).toBeNull();
  });

  it('нет связи — тост, бронь на месте; вне рабочего дня — текст сервера', async () => {
    const a = await open();
    await pick(MASSAGE, 'Классический массаж · Мария К.');
    a.scenario.setScenario('updateCalendarBooking=offline');
    await moveTo('08:00');
    await waitFor(() => expect(toast()).toBe(OFFLINE), SLOW);
    expect(blocks(MASSAGE)).toHaveLength(2);
    a.scenario.setScenario(null);
    await moveTo('19:30');
    await waitFor(() => expect(toast()).toBe('Время вне рабочего дня ресурса.'), SLOW);
    expect(blocks(MASSAGE)).toHaveLength(2);
  });

  // Возврат 1: повтор после «нет связи» — тот же Idempotency-Key (W2.23, Q-W2.22-9), другое время — новый ключ.
  it('повтор после «нет связи» несёт тот же Idempotency-Key, другое время — новый', async () => {
    const w = watchRequests();
    const a = await open({ setup: w.setup });
    await pick(MASSAGE, 'Классический массаж · Мария К.');
    a.scenario.setScenario('updateCalendarBooking=offline', true);
    await moveTo('08:00');
    await waitFor(() => expect(toast()).toBe(OFFLINE), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить и перенести' }));
    await waitFor(() => expect(toast()).toBe('Перенос подтверждён сервером'), SLOW);
    await waitFor(
      () => expect(blocks('Классический массаж · Мария К., 08:00–09:00')).toHaveLength(2),
      SLOW,
    );
    await moveTo('08:30');
    await waitFor(
      () => expect(blocks('Классический массаж · Мария К., 08:30–09:30')).toHaveLength(2),
      SLOW,
    );
    const keys = w.seen
      .filter((x) => x.method === 'PATCH')
      .map((x) => x.headers.get('Idempotency-Key'));
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  // Возврат 1: If-Match защищает версию, которую видел участник: бронь сдвинули мимо экрана — перенос не уходит,
  // тост 412 «Данные изменились…», панель показывает свежее окно.
  it('бронь изменили после показа — «Данные изменились…», PATCH не отправлен, панель обновлена', async () => {
    const a = await open();
    await pick(MASSAGE, 'Классический массаж · Мария К.');
    const row = bookingRow(a, A('b-a1'));
    row.window = {
      ...row.window,
      startsAt: '2026-10-01T07:30:00Z',
      endsAt: '2026-10-01T08:30:00Z',
    };
    row.revision++;
    await moveTo('08:00');
    await waitFor(
      () => expect(toast()).toBe('Данные изменились. Обновите и повторите правку.'),
      SLOW,
    );
    await waitFor(
      () => expect(blocks('Классический массаж · Мария К., 10:30–11:30')).toHaveLength(2),
      SLOW,
    );
    expect(panel()?.textContent).toContain('10:30–11:30');
    expect(a.responses().some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('412 и invalid_transition сервера — тост по коду и перечитанный день', async () => {
    const a = await open();
    await pick(MASSAGE, 'Классический массаж · Мария К.');
    let before = listGets(a);
    a.scenario.setScenario('updateCalendarBooking=revision_mismatch', true);
    await moveTo('08:00');
    await waitFor(
      () => expect(toast()).toBe('Данные изменились. Обновите и повторите правку.'),
      SLOW,
    );
    await waitFor(() => expect(listGets(a)).toBeGreaterThan(before), SLOW);
    expect(a.responses().some((r) => r.method === 'PATCH' && r.status === 412)).toBe(true);
    before = listGets(a);
    a.scenario.setScenario('updateCalendarBooking=invalid_transition', true);
    await moveTo('08:15');
    await waitFor(
      () => expect(toast()).toBe('Статус уже изменился. Обновите данные и повторите.'),
      SLOW,
    );
    await waitFor(() => expect(listGets(a)).toBeGreaterThan(before), SLOW);
    expect(blocks(MASSAGE)).toHaveLength(2);
  });

  it('ссылка на бронь другого дня — день брони и открытая панель', async () => {
    const a = await open({ search: `?date=2026-10-03&booking=${A('b-a2')}` });
    await screen.findByRole('heading', { level: 2, name: 'SPA-ритуал · Ольга Р.' }, SLOW);
    await waitFor(() =>
      expect(a.router.state.location.search).toMatchObject({ date: '2026-10-01' }),
    );
    expect(dateLine()).toBe('Четверг, 1 октября 2026 · Москва (UTC+3)');
  });
});

describe('«Календарь»: период (no-reference, Q-W4.06-4)', () => {
  it('следующий и предыдущий день, ?date=; в другой день броней нет', async () => {
    const a = await open();
    await rowsLoaded(8);
    const period = screen.getByRole('group', { name: 'Период' });
    fireEvent.click(within(period).getByRole('button', { name: 'Следующий день' }));
    await waitFor(() =>
      expect(a.router.state.location.search).toMatchObject({ date: '2026-10-02' }),
    );
    await waitFor(() => expect(dateLine()).toBe('Пятница, 2 октября 2026 · Москва (UTC+3)'));
    await rowsLoaded(8);
    expect(document.querySelectorAll('.ox-cal-track button')).toHaveLength(0);
    fireEvent.click(within(period).getByRole('button', { name: 'Предыдущий день' }));
    await waitFor(() => expect(blocks(MASSAGE)).toHaveLength(2), SLOW);
    expect(within(period).getByRole('button', { name: 'День' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  // Возврат 1: брони прошлого окна не выдаются за новое — до ответа скелетон (§1.6), не строки «свободных» ресурсов.
  it('смена дня и вида: до ответа броней — скелетон, а не пустые строки', async () => {
    const a = await open();
    await rowsLoaded(8);
    await waitFor(() => expect(blocks(MASSAGE)).toHaveLength(2), SLOW);
    a.scenario.setScenario('listCalendarBookings=loading');
    const period = screen.getByRole('group', { name: 'Период' });
    fireEvent.click(within(period).getByRole('button', { name: 'Следующий день' }));
    await waitFor(() => expect(dateLine()).toBe('Пятница, 2 октября 2026 · Москва (UTC+3)'));
    expect(screen.getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    expect(rowNames()).toHaveLength(0);
    fireEvent.click(within(period).getByRole('button', { name: 'Неделя' }));
    await waitFor(() => expect(dateLine()).toBe('28 сентября — 4 октября 2026 · Москва (UTC+3)'));
    expect(screen.getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    expect(rowNames()).toHaveLength(0);
  });

  // Возврат 1: «сегодня» — по часам в момент действия, а не открытия страницы (страница открыта через полночь).
  it('«Сегодня» после полуночи — новый день; возврат на вкладку после полуночи — новый день', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T20:59:00Z') });
    const a = await open({ search: '' });
    await rowsLoaded(8);
    expect(dateLine()).toBe('Четверг, 1 октября 2026 · Москва (UTC+3)');
    const period = screen.getByRole('group', { name: 'Период' });
    fireEvent.click(within(period).getByRole('button', { name: 'Следующий день' }));
    await waitFor(() =>
      expect(a.router.state.location.search).toMatchObject({ date: '2026-10-02' }),
    );
    vi.setSystemTime(new Date('2026-10-02T21:30:00Z'));
    fireEvent.click(within(period).getByRole('button', { name: 'Сегодня' }));
    await waitFor(() => expect(a.router.state.location.search).not.toHaveProperty('date'));
    await waitFor(() => expect(dateLine()).toBe('Суббота, 3 октября 2026 · Москва (UTC+3)'));
    vi.setSystemTime(new Date('2026-10-03T21:05:00Z'));
    fireEvent.focus(window);
    await waitFor(() => expect(dateLine()).toBe('Воскресенье, 4 октября 2026 · Москва (UTC+3)'));
  });

  it('неделя: столбцы дней, бронь четверга, подпись с днём; перенос в неделе', async () => {
    const a = await open({ search: '?view=week&date=2026-10-01' });
    await rowsLoaded(8);
    expect(dateLine()).toBe('28 сентября — 4 октября 2026 · Москва (UTC+3)');
    expect([...document.querySelectorAll('.ox-cal-day')].map((x) => x.textContent)).toEqual([
      'Пн, 28.09',
      'Вт, 29.09',
      'Ср, 30.09',
      'Чт, 01.10',
      'Пт, 02.10',
      'Сб, 03.10',
      'Вс, 04.10',
    ]);
    const thu = 'Классический массаж · Мария К., чт 01.10, 10:00–11:00';
    await pick(thu, 'Классический массаж · Мария К.');
    await moveTo('08:00');
    await waitFor(() => expect(toast()).toBe('Перенос подтверждён сервером'), SLOW);
    await waitFor(
      () => expect(blocks('Классический массаж · Мария К., чт 01.10, 08:00–09:00')).toHaveLength(2),
      SLOW,
    );
    const period = screen.getByRole('group', { name: 'Период' });
    fireEvent.click(within(period).getByRole('button', { name: 'Следующая неделя' }));
    await waitFor(() =>
      expect(a.router.state.location.search).toMatchObject({ date: '2026-10-08' }),
    );
    await waitFor(() => expect(dateLine()).toBe('5 октября — 11 октября 2026 · Москва (UTC+3)'));
    fireEvent.click(within(period).getByRole('button', { name: 'День' }));
    await waitFor(() => expect(a.router.state.location.search).not.toHaveProperty('view'));
  });
});
