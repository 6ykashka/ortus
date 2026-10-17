// W2.20 · Экранные тесты «Рабочего места логиста» на сценарном сервере (MSW fleet W2.00, пресет logistics-ready):
// шапка и счётчики, вкладки рейсов, подбор с причинами, фильтры, загрузка по участкам, назначение машины (If-Match,
// тост, чип, вкладка), конфликт 409, область владельца, загрузка, ошибка и «Повторить», только чтение.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string): string => seedUuid('t-alta', id);
const SLOW = { timeout: 5_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (o: MockAppOptions = {}, ready = true, url = ''): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/fleet${url}`, {
    persona: 'manager',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: 'Рабочее место логиста' }, SLOW);
  if (ready) await screen.findByRole('tablist', { name: 'Рейсы' }, SLOW);
  return app;
};

const section = (): HTMLElement => {
  const s = document.querySelector<HTMLElement>('section[aria-labelledby="h-fleet"]');
  if (!s) throw new Error('нет секции рабочего места');
  return s;
};
const statOf = (label: string): string | null | undefined =>
  [...document.querySelectorAll('.ox-fl-stat')]
    .find((x) => x.textContent?.includes(label))
    ?.querySelector('.ox-fl-stat-value')?.textContent;
const models = (): string[] =>
  [...document.querySelectorAll('.ox-fl-vehicle .ox-fl-model-name')].map(
    (x) => x.textContent ?? '',
  );
const vrow = (model: string): HTMLElement => {
  const r = [...document.querySelectorAll<HTMLElement>('.ox-fl-vehicle')].find(
    (x) => x.querySelector('.ox-fl-model-name')?.textContent === model,
  );
  if (!r) throw new Error(`нет строки «${model}»`);
  return r;
};
const tab = (name: RegExp): HTMLElement =>
  within(screen.getByRole('tablist', { name: 'Рейсы' })).getByRole('tab', { name });
const dd = (term: string): string | null | undefined =>
  [...document.querySelectorAll('.ox-fl-trip dt')].find((x) => x.textContent === term)
    ?.nextElementSibling?.textContent;
const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const sent = (a: MockApp, method: string, suffix: string) =>
  a.responses().filter((r) => r.method === method && r.path.endsWith(suffix));

interface FleetState {
  vehicles: { id: string; vstate: string; heldBy?: string; note?: string; revision: number }[];
}
const fleetState = (a: MockApp): FleetState =>
  (a.scenario.state().orgs[ALTA] as unknown as { fleet: FleetState }).fleet;

describe('«Рабочее место логиста»: шапка, счётчики, рейсы', () => {
  it('крошка, заголовок, пояснение; счётчики 4 / 0 / 0 / 1; Р-208 выбран', async () => {
    await open();
    const s = section();
    expect(within(s).getByText('Север Логистик')).toBeTruthy();
    expect(
      within(s).getByText(
        'Подбор машины под рейс: доступность, грузоподъёмность, объём, длина кузова и температура.',
      ),
    ).toBeTruthy();
    expect([
      statOf('свободно'),
      statOf('в брони или рейсе'),
      statOf('ждут приёмки'),
      statOf('недоступно'),
    ]).toEqual(['4', '0', '0', '1']);
    expect(tab(/Р-208 · Северный маршрут/).getAttribute('aria-selected')).toBe('true');
    expect(tab(/Р-208/).textContent).toContain('09:00–13:00 · Запланирован');
    expect(tab(/Р-211 · Охлаждённая продукция/).getAttribute('aria-selected')).toBe('false');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Подбор транспорта · Р-208' }),
    ).toBeTruthy();
  });

  it('пункт меню «Рабочее место логиста» — текущая страница', async () => {
    await open();
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(nav).getByRole('button', { current: 'page' }).getAttribute('title')).toBe(
      'Рабочее место логиста',
    );
  });

  it('загрузка: скелетон «Загрузка», затем вкладки', async () => {
    await open({ scenario: 'listTripPlans=delay=400' }, false);
    expect(within(screen.getByRole('main')).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    await screen.findByRole('tablist', { name: 'Рейсы' }, SLOW);
  });

  it('ошибка listVehicles: «Не удалось загрузить рабочее место: …» и «Повторить»', async () => {
    const a = await open({ scenario: 'listVehicles=rate_limited' }, false);
    const err = await screen.findByText(/Не удалось загрузить рабочее место/, undefined, SLOW);
    expect(err.textContent).toBe(
      'Не удалось загрузить рабочее место: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('tablist', { name: 'Рейсы' }, SLOW);
  });
});

describe('подбор транспорта', () => {
  it('порядок строк, причины несовместимости, кнопки строк, подсказка', async () => {
    await open();
    expect(models()).toEqual([
      'ГАЗель Next',
      'Mercedes Sprinter',
      'ГАЗон Next',
      'Ford Transit',
      'Hyundai Porter',
    ]);
    const porter = vrow('Hyundai Porter');
    expect(porter.textContent).toContain('Грузоподъёмность: 0,9 т (нужно от 1,1 т)');
    expect(porter.textContent).toContain('Объём: 9 м³ (нужно от 12 м³)');
    expect(
      (within(porter).getByRole('button', { name: 'Не подходит' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const gazon = vrow('ГАЗон Next');
    expect(gazon.textContent).toContain('Доступность: Недоступна · Плановое ТО до 03.10');
    expect(
      (within(gazon).getByRole('button', { name: 'Недоступна' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const gazel = vrow('ГАЗель Next');
    expect(gazel.textContent).toContain('А 412 МР 77');
    expect(gazel.textContent).toContain('Тент · Север Логистик · Склад № 1');
    expect(within(gazel).getByRole('button', { name: 'Назначить на рейс' })).toBeTruthy();
    expect(
      screen.getByText(
        'Совместимость считается по сумме объёма и массы груза. Это не 3D-укладка и не проверка осевой нагрузки. Окончательно бронь подтверждает сервер.',
      ),
    ).toBeTruthy();
  });

  it('фильтры «Подходят» и «Свободны» (aria-pressed); пусто по фильтру — текст эталона', async () => {
    await open();
    const group = screen.getByRole('group', { name: 'Фильтр' });
    fireEvent.click(within(group).getByRole('button', { name: 'Подходят' }));
    expect(
      within(group).getByRole('button', { name: 'Подходят' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(models()).toEqual(['ГАЗель Next', 'Mercedes Sprinter', 'ГАЗон Next']);
    fireEvent.click(within(group).getByRole('button', { name: 'Свободны' }));
    expect(models()).toEqual([
      'ГАЗель Next',
      'Mercedes Sprinter',
      'Ford Transit',
      'Hyundai Porter',
    ]);
    fireEvent.click(tab(/Р-211/));
    await screen.findByRole('heading', { level: 2, name: 'Подбор транспорта · Р-211' }, SLOW);
    fireEvent.click(within(group).getByRole('button', { name: 'Подходят' }));
    expect(models()).toEqual(['Ford Transit']);
  });

  it('«Показать загрузку» у Mercedes Sprinter: «Загрузка показана», 86 % и 69 % на участке 1', async () => {
    await open();
    expect(
      screen.getByText('Для ГАЗель Next · 16 м³ · 1,5 т. Объём и масса считаются раздельно.'),
    ).toBeTruthy();
    fireEvent.click(
      within(vrow('Mercedes Sprinter')).getByRole('button', { name: 'Показать загрузку' }),
    );
    const shown = within(vrow('Mercedes Sprinter')).getByRole('button', {
      name: 'Загрузка показана',
    });
    expect(shown.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByText('Для Mercedes Sprinter · 14 м³ · 1,6 т. Объём и масса считаются раздельно.'),
    ).toBeTruthy();
    const first = document.querySelector('.ox-fl-legs li');
    expect(first?.textContent).toContain('1. Склад № 1, Лобня');
    expect(first?.textContent).toContain('Погрузка +12 м³ · 1,1 т');
    expect(first?.textContent).toContain('86%');
    expect(first?.textContent).toContain('69%');
    expect(first?.textContent).toContain('В кузове после точки: 12 м³ · 1,1 т');
    const nav = screen.getByRole('button', {
      name: 'Передать в навигатор · интеграция не подключена',
    });
    expect((nav as HTMLButtonElement).disabled).toBe(true);
  });

  it('карточка рейса Р-208; Р-211 — «Не назначен», «Найти водителя в пуле» ведёт в пул', async () => {
    const a = await open();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Р-208 · Северный маршрут' }),
    ).toBeTruthy();
    expect(dd('Груз')).toBe('Сухой груз · 14 паллет-мест · 1,1 т · 12 м³');
    expect(dd('Требования')).toBe('Кузов от 3 м · без температурного режима');
    expect(dd('Водитель')).toBe('Илья Васильев');
    expect(dd('Машина')).toBe('Выберет водитель при брони или назначит логист');
    expect(dd('Маршрут')).toBe('3 точки · 46 км');
    expect(screen.queryByRole('button', { name: 'Найти водителя в пуле' })).toBeNull();
    fireEvent.click(tab(/Р-211/));
    await screen.findByRole('heading', { level: 2, name: 'Подбор транспорта · Р-211' }, SLOW);
    expect(a.router.state.location.search).toMatchObject({ trip: A('Р-211') });
    expect(dd('Водитель')).toBe('Не назначен');
    expect(dd('Машина')).toBe('Не выбрана');
    expect(vrow('Ford Transit').textContent).toContain('Температура: -18…+8 °C');
    expect(vrow('ГАЗель Next').textContent).toContain(
      'Температура: без охлаждения (нужно +2…+6 °C)',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Найти водителя в пуле' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/pool`));
  });

  it('прямой URL ?trip= выбирает рейс', async () => {
    await open({}, true, `?trip=${A('Р-211')}`);
    expect(tab(/Р-211/).getAttribute('aria-selected')).toBe('true');
  });
});

describe('назначение машины', () => {
  it('«Назначить на рейс» ГАЗель Next: If-Match, тост, чип, вкладка, карточка, счётчики', async () => {
    const a = await open();
    fireEvent.click(within(vrow('ГАЗель Next')).getByRole('button', { name: 'Назначить на рейс' }));
    await waitFor(() => expect(toast()).toBe('Машина назначена на рейс Р-208'), SLOW);
    await waitFor(() => expect(vrow('ГАЗель Next').textContent).toContain('Назначена на Р-208'));
    expect(
      within(vrow('ГАЗель Next')).queryByRole('button', { name: 'Назначить на рейс' }),
    ).toBeNull();
    expect(tab(/Р-208/).textContent).toContain('09:00–13:00 · Машина назначена');
    expect(dd('Машина')).toBe('ГАЗель Next · А 412 МР 77');
    expect(statOf('свободно')).toBe('3');
    expect(statOf('в брони или рейсе')).toBe('1');
    expect(sent(a, 'PUT', `/fleet/trips/${A('Р-208')}/vehicle`).map((r) => r.status)).toEqual([
      200,
    ]);
    expect(sent(a, 'GET', `/fleet/trip-plans/${A('Р-208')}`).length).toBeGreaterThan(0);
  });

  it('конфликт: машину забронировали за спиной экрана — тост alert «Конфликт: …», список перечитан', async () => {
    const a = await open();
    const v = fleetState(a).vehicles.find((x) => x.id === A('v1'));
    if (!v) throw new Error('нет v1');
    v.vstate = 'reserved';
    v.heldBy = 'other';
    v.revision++;
    fireEvent.click(within(vrow('ГАЗель Next')).getByRole('button', { name: 'Назначить на рейс' }));
    await waitFor(
      () => expect(toast()).toBe('Конфликт: Машину только что забронировали. Обновите список.'),
      SLOW,
    );
    expect(document.querySelector('.ox-toast')?.getAttribute('role')).toBe('alert');
    await waitFor(() => expect(vrow('ГАЗель Next').textContent).toContain('Забронирована'));
    expect(
      (within(vrow('ГАЗель Next')).getByRole('button', { name: 'Недоступна' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('нет связи: тост «Нет связи с сервером. Операция не выполнена.», кнопка остаётся', async () => {
    await open({ scenario: 'assignTripVehicle=offline' });
    fireEvent.click(within(vrow('ГАЗель Next')).getByRole('button', { name: 'Назначить на рейс' }));
    await waitFor(() => expect(toast()).toBe('Нет связи с сервером. Операция не выполнена.'), SLOW);
    await waitFor(() =>
      expect(
        within(vrow('ГАЗель Next')).getByRole('button', { name: 'Назначить на рейс' }),
      ).toBeTruthy(),
    );
  });
});

describe('владелец и режим чтения', () => {
  it('владелец: «Альта Групп · все подразделения», 5 / 1 / 0 / 1; «Самара · весь регион» — нет рейсов', async () => {
    await open({ persona: 'owner' });
    expect(within(section()).getByText('Альта Групп · все подразделения')).toBeTruthy();
    expect([statOf('свободно'), statOf('в брони или рейсе')]).toEqual(['5', '1']);
    const select = screen.getByLabelText('Область просмотра') as HTMLSelectElement;
    await waitFor(() =>
      expect([...select.options].some((o) => o.text === 'Самара · весь регион')).toBe(true),
    );
    const smr = [...select.options].find((o) => o.text === 'Самара · весь регион');
    fireEvent.change(select, { target: { value: smr?.value } });
    await screen.findByText('В выбранной области нет рейсов', undefined, SLOW);
    expect(within(section()).getByText('Регион Самара')).toBeTruthy();
    expect(
      screen.getByText(
        'Смените область в верхней панели — рейсы демо запланированы в «Москва / Север Логистик».',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'Рейсы' })).toBeNull();
    expect([statOf('свободно'), statOf('в брони или рейсе')]).toEqual(['0', '1']);
  });

  it('модуль отключён с историей: назначения и «Запланировать рейс» нет, данные читаются', async () => {
    await open({
      persona: 'owner',
      setup: (s) => {
        const m = s.state().orgs[ALTA]?.modules.fleet;
        if (m) {
          m.state = 'read_only';
          m.revision++;
        }
      },
    });
    expect(screen.queryByRole('button', { name: 'Назначить на рейс' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Запланировать рейс' })).toBeNull();
    expect(vrow('ГАЗель Next').textContent).toContain('Доступность: Свободна');
  });

  it('логист с правом на маршруты видит «Запланировать рейс»', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Запланировать рейс' })).toBeTruthy();
  });
});
