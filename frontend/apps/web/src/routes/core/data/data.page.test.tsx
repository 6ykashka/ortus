// W2.26 · Экранные тесты «Данных» (`core-data`, S2-16, AC-14; эталон design-stage-2 pg.data :1960–1979, dataVM
// :4179–4208; чек-лист 06 §13 п. 16–22). Сеть — сценарный сервер W2.51 (listDatasets, queryDataset) на пресете
// logistics-ready: владелец «Альты» и логист «Менеджер логистики» «Север Логистик».
import type { ScenarioServer } from '@ortus/adapter/msw';
import { rub } from '@ortus/domain';
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 5_000 };
const INTRO =
  'Каталог записей модулей. Это представление исходных сущностей с теми же правами, а не редактируемая копия. Изменения — в карточке модуля.';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  localStorage.clear();
});

type Org = {
  roles: { proto: string; permissions: string[] }[];
  fleet: {
    trips: { id: string; number: string }[];
    expenses: unknown[];
  };
};
const alta = (s: ScenarioServer) => s.state().orgs[ALTA] as unknown as Org;

/** Снять ключ с роли «Менеджер логистики» сида (как правка роли владельцем). */
const dropKey = (s: ScenarioServer, key: string) => {
  const role = alta(s).roles.find((r) => r.proto === 'r-manager');
  if (!role) throw new Error('нет роли r-manager');
  role.permissions = role.permissions.filter((k) => k !== key);
};

/** Расходы рейса Р-208 (как заявил водитель): `n` штук по 2 500 ₽. */
const addExpenses = (s: ScenarioServer, n: number) => {
  const org = alta(s);
  const trip = org.fleet.trips.find((t) => t.number === 'Р-208');
  if (!trip) throw new Error('нет рейса Р-208');
  for (let i = 0; i < n; i++) {
    org.fleet.expenses.push({
      id: seedUuid('w226:expense', String(i)),
      tripId: trip.id,
      kind: 'fuel',
      occurredAt: '2026-10-01T07:15:00Z',
      amount: { amountMinor: 250000, currency: 'RUB' },
      receiptFileIds: [],
      reviewState: 'pending',
      revision: 1,
    });
  }
  return trip.id;
};

const open = async (
  o: Parameters<typeof renderMockApp>[1] & { search?: string } = {},
): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/data${o.search ?? ''}`, {
    persona: 'owner',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: 'Данные' }, SLOW);
  return app;
};

const tabs = () => screen.findAllByRole('tab', undefined, SLOW);
const tab = (name: RegExp) => screen.findByRole('tab', { name }, SLOW);
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')];
const cells = (r: HTMLTableRowElement) => [...r.cells].map((c) => c.textContent);
const heads = () => [...document.querySelectorAll('thead th')].map((c) => c.textContent);
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const foot = () => document.querySelector('.ox-dt-foot')?.textContent;
const rowsLoaded = (n: number) => waitFor(() => expect(rows()).toHaveLength(n), SLOW);

describe('«Данные»: наборы, таблица, подвал', () => {
  it('владелец: заголовок, абзац, вкладки со счётчиками, «Поездки» по умолчанию', async () => {
    await open();
    expect(screen.getByText(INTRO)).toBeTruthy();
    expect(await screen.findByRole('tablist', { name: 'Наборы данных' }, SLOW)).toBeTruthy();
    await waitFor(
      async () =>
        expect((await tabs()).map((t) => t.textContent)).toEqual([
          'local_shippingАвтомобили7',
          'routeПоездки2',
          'receipt_longРасходы0',
          // W4.80: наборы этапа 4 эталона (dataVM :4189).
          'dynamic_formОтветы на осмотр2',
          'task_altЗадачи11',
        ]),
      SLOW,
    );
    expect((await tab(/Поездки/)).getAttribute('aria-selected')).toBe('true');
    expect((await tab(/Автомобили/)).getAttribute('aria-selected')).toBe('false');
  });

  it('«Поездки»: колонки эталона, строки Р-208 и Р-211, подвал об области', async () => {
    await open();
    await rowsLoaded(2);
    expect(heads()).toEqual([
      'Рейсunfold_more',
      'Водительunfold_more',
      'Статусunfold_more',
      'Пробег, кмunfold_more',
      'Начислениеunfold_more',
    ]);
    expect(rows().map(cells)).toEqual([
      // Начисления рейсов сида (dataVM :4186, как эталон: «4 500 ₽», «3 800 ₽»).
      ['Р-208 · Северный маршрут', 'Илья Васильев', 'Запланирован', '—', rub(4500)],
      ['Р-211 · Охлаждённая продукция', '—', 'Запланирован', '—', rub(3800)],
    ]);
    expect(foot()).toBe(
      'Источник: Логистика · fleet.tripsОбновлено: только чтоСтроки ограничены вашей областью доступа',
    );
  });

  it('вкладка «Расходы»: ?set=, колонки, пусто — «В вашей области записей нет»', async () => {
    const a = await open();
    await rowsLoaded(2);
    fireEvent.click(await tab(/Расходы/));
    await waitFor(() => expect(a.router.state.location.search).toEqual({ set: 'fleet.expenses' }));
    expect(await screen.findByText('В вашей области записей нет', undefined, SLOW)).toBeTruthy();
    expect(heads()).toEqual([
      'Рейсunfold_more',
      'Категорияunfold_more',
      'Датаunfold_more',
      'Суммаunfold_more',
      'Статусunfold_more',
    ]);
    expect(foot()).toContain('Источник: Логистика · fleet.expenses');
  });

  it('«Расходы» с расходом Р-208: категория, дата, сумма, статус', async () => {
    await open({ search: '?set=fleet.expenses', setup: (s) => void addExpenses(s, 1) });
    await rowsLoaded(1);
    expect(cells(rows()[0] as HTMLTableRowElement)).toEqual([
      'Р-208',
      'Топливо',
      '01.10.2026',
      rub(2500),
      'Заявлен водителем',
    ]);
    expect((await tab(/Расходы/)).textContent).toBe('receipt_longРасходы1');
  });
});

describe('«Данные»: фильтр, вид, сортировка, выгрузка', () => {
  it('«211» — одна строка; «Сохранить вид» — тост, вид выбран; пустой фильтр — вид недоступен', async () => {
    await open();
    await rowsLoaded(2);
    const save = screen.getByRole('button', { name: 'Сохранить вид' });
    expect(save).toHaveProperty('disabled', true);
    const input = screen.getByLabelText('Фильтр');
    expect(input.getAttribute('placeholder')).toBe('По любому видимому полю');
    fireEvent.change(input, { target: { value: '211' } });
    await rowsLoaded(1);
    expect(cells(rows()[0] as HTMLTableRowElement)[0]).toBe('Р-211 · Охлаждённая продукция');
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);
    await waitFor(() => expect(toast()).toBe('Вид сохранён · личный'), SLOW);
    const view = screen.getByLabelText<HTMLSelectElement>('Вид');
    await waitFor(() => expect(view.selectedOptions[0]?.textContent).toBe('Поездки: «211»'), SLOW);
    expect([...view.options].map((o) => o.textContent)).toEqual([
      'Без сохранённого вида',
      'Поездки: «211»',
    ]);
    // Правка фильтра снимает выбранный вид (:4200).
    fireEvent.change(input, { target: { value: '21' } });
    expect(view.value).toBe('');
    // W4.50: значение пункта — id вида сервера.
    const opt = [...view.options].find((o) => o.textContent === 'Поездки: «211»');
    fireEvent.change(view, { target: { value: opt?.value } });
    expect((input as HTMLInputElement).value).toBe('211');
    await rowsLoaded(1);
  });

  it('«zzz» — «По фильтру ничего не найдено»', async () => {
    await open();
    await rowsLoaded(2);
    fireEvent.change(screen.getByLabelText('Фильтр'), { target: { value: 'zzz' } });
    expect(await screen.findByText('По фильтру ничего не найдено', undefined, SLOW)).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  it('сортировка по заголовку: arrow_upward, затем arrow_downward; порядок сервера', async () => {
    await open({ search: '?set=fleet.vehicles' });
    await rowsLoaded(7);
    const sort = screen.getByRole('button', { name: /^Объём, м³/ });
    fireEvent.click(sort);
    await waitFor(() => expect(sort.textContent).toBe('Объём, м³arrow_upward'));
    fireEvent.click(sort);
    await waitFor(() => expect(sort.textContent).toBe('Объём, м³arrow_downward'));
    await waitFor(() => expect(cells(rows()[0] as HTMLTableRowElement)[0]).toBe('ГАЗон Next'));
  });

  // W4.50: выгрузка — задание (createDatasetExportJob), тост эталона без «В демо файл не создаётся».
  it('«Выгрузить» — тост эталона с числом строк выборки', async () => {
    await open();
    await rowsLoaded(2);
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить' }));
    await waitFor(
      () => expect(toast()).toBe('Выгрузка «Поездки»: 2 строк, фильтр и права зафиксированы.'),
      SLOW,
    );
  });

  it('без data.export «Выгрузить» недоступна', async () => {
    await open({ persona: 'manager', setup: (s) => dropKey(s, 'data.export') });
    await rowsLoaded(2);
    expect(screen.getByRole('button', { name: 'Выгрузить' })).toHaveProperty('disabled', true);
  });
});

describe('«Данные»: права и переходы', () => {
  it('логист без fleet.earnings.read: без «Начисление», подвал о скрытом поле (AC-05)', async () => {
    await open({ persona: 'manager', setup: (s) => dropKey(s, 'fleet.earnings.read') });
    await rowsLoaded(2);
    expect(heads()).toEqual([
      'Рейсunfold_more',
      'Водительunfold_more',
      'Статусunfold_more',
      'Пробег, кмunfold_more',
    ]);
    expect(foot()).toContain(
      'Поле «Начисление» скрыто правами и не участвует в фильтре, сортировке и выгрузке',
    );
  });

  it('набор без права не приходит: без fleet.expenses.read — четыре вкладки', async () => {
    await open({ persona: 'manager', setup: (s) => dropKey(s, 'fleet.expenses.read') });
    await waitFor(async () => expect(await tabs()).toHaveLength(4), SLOW);
  });

  // W4.80: «Задачи» и «Формы» — модули ядра, их наборы есть и без «Логистики».
  it('«Логистика» не подключена — наборы ядра «Ответы на осмотр» и «Задачи»', async () => {
    app = await renderMockApp(`/t/${ALTA}/data`, { persona: 'owner' });
    await screen.findByRole('heading', { level: 1, name: 'Данные' }, SLOW);
    await waitFor(
      async () =>
        expect((await tabs()).map((t) => t.textContent)).toEqual([
          'dynamic_formОтветы на осмотр2',
          'task_altЗадачи11',
        ]),
      SLOW,
    );
    expect((await tab(/Ответы на осмотр/)).getAttribute('aria-selected')).toBe('true');
  });

  it('ни одного набора по правам — «В вашей области записей нет» без вкладок', async () => {
    await open({
      persona: 'manager',
      // Ключи снимаются со всех ролей: у логиста есть и роль проекта LOG (tasks.read).
      setup: (s) => {
        for (const role of alta(s).roles) {
          role.permissions = role.permissions.filter(
            (k) =>
              ![
                'fleet.vehicles.read',
                'fleet.trips.read',
                'fleet.expenses.read',
                'forms.responses.read',
                'tasks.read',
              ].includes(k),
          );
        }
      },
    });
    expect(await screen.findByText('В вашей области записей нет', undefined, SLOW)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('строка ответа на осмотр открывает ответ в редакторе формы (formSel, formTab, respSel)', async () => {
    const a = await open({ search: '?set=forms.responses' });
    await rowsLoaded(2);
    expect(cells(rows()[1] as HTMLTableRowElement)).toEqual([
      'R-1012',
      'Рейс Р-196',
      'Илья Васильев',
      'v3',
      '¾',
    ]);
    fireEvent.click(rows()[1] as HTMLTableRowElement);
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/forms`), SLOW);
    expect(a.router.state.location.search).toEqual({
      form: seedUuid('t-alta', 'fm-insp'),
      tab: 'responses',
      resp: seedUuid('t-alta', 'R-1012'),
    });
  });

  it('Enter по строке задачи открывает карточку задачи (?task=)', async () => {
    const a = await open({ search: '?set=tasks' });
    await rowsLoaded(11);
    const r = rows().find((x) => cells(x)[0] === 'T-64 · Найти водителя на рейс Р-211');
    expect(r && cells(r)).toEqual([
      'T-64 · Найти водителя на рейс Р-211',
      'Марина Котова',
      'Новая',
      '01.10.2026',
    ]);
    fireEvent.keyDown(r as HTMLTableRowElement, { key: 'Enter' });
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/tasks`), SLOW);
    await waitFor(() =>
      expect(a.router.state.location.search).toMatchObject({ task: seedUuid('t-alta', 'T-64') }),
    );
  });

  it('строка рейса открывает «Рабочее место логиста» с ?trip=', async () => {
    const a = await open();
    await rowsLoaded(2);
    const trip = alta(a.scenario).fleet.trips.find((t) => t.number === 'Р-208');
    fireEvent.click(rows()[0] as HTMLTableRowElement);
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/fleet`));
    expect(a.router.state.location.search).toEqual({ trip: trip?.id });
  });

  it('Enter по строке машины открывает «Рабочее место логиста»', async () => {
    const a = await open({ search: '?set=fleet.vehicles' });
    await rowsLoaded(7);
    const r = rows()[0] as HTMLTableRowElement;
    expect(r.tabIndex).toBe(0);
    fireEvent.keyDown(r, { key: 'Enter' });
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/fleet`));
  });

  it('строка расхода открывает «Приёмку смен» рейса', async () => {
    let tripId = '';
    const a = await open({
      search: '?set=fleet.expenses',
      setup: (s) => {
        tripId = addExpenses(s, 1);
      },
    });
    await rowsLoaded(1);
    fireEvent.click(rows()[0] as HTMLTableRowElement);
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/review`), SLOW);
    expect(a.router.state.location.search).toEqual({ trip: tripId });
  });
});

describe('«Данные»: состояния', () => {
  it('ошибка каталога — alert и «Повторить»', async () => {
    const a = await open({ scenario: 'listDatasets=rate_limited' });
    const alert = await screen.findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await rowsLoaded(2);
  });

  it('ошибка выборки — alert в таблице, вкладки на месте', async () => {
    await open({ scenario: 'queryDataset=offline' });
    const alert = await screen.findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toBe(
      'Не удалось загрузить данные: Нет связи с сервером. Операция не выполнена.',
    );
    expect(await tabs()).toHaveLength(5);
  });

  it('больше 50 строк — «Показать ещё» догружает следующую страницу', async () => {
    await open({ search: '?set=fleet.expenses', setup: (s) => void addExpenses(s, 55) });
    await rowsLoaded(50);
    const more = screen.getByRole('button', { name: 'Показать ещё' });
    fireEvent.click(more);
    await rowsLoaded(55);
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
    expect(within(await tab(/Расходы/)).getByText('55')).toBeTruthy();
  });
});
