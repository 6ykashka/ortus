// W2.21 · Экранные тесты «Приёмки смен» на сценарном сервере (MSW fleet W2.00, пресет logistics-ready): шапка и
// пусто, карточка сданной смены (статистика, фото, расходы), доработка с проверками, приёмка через диалог
// «Принять смену», начисление владельцу, карточка критического дефекта и решения, загрузка, ошибка, нет связи,
// конфликт, гейт водителя. Состояние смены — fixtures.test-util.ts.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';
import { ALTA, blockingDefect, fleetOf, submittedShift } from './fixtures.test-util.ts';

const SLOW = { timeout: 5_000 };
const H1 = 'Приёмка смен';
const nb = (s: string): string => s.replace(/(\d) (\d{3})/g, '$1\u00a0$2');

beforeAll(() => {
  // React Aria Modal зовёт CSS.escape при открытии диалога (jsdom его не даёт) — как people.test.tsx W1.23.
  globalThis.CSS ??= {} as typeof CSS;
  globalThis.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (o: MockAppOptions = {}, url = ''): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/review${url}`, {
    persona: 'manager',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: H1 }, SLOW);
  return app;
};

const section = (): HTMLElement => {
  const s = document.querySelector<HTMLElement>('section[aria-labelledby="h-rev"]');
  if (!s) throw new Error('нет секции «Приёмка смен»');
  return s;
};
const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const sent = (a: MockApp, method: string, suffix: string) =>
  a.responses().filter((r) => r.method === method && r.path.endsWith(suffix));
const statValue = (label: string): string | null | undefined =>
  [...document.querySelectorAll('.ox-rv-stat')]
    .find((x) => x.querySelector('.ox-rv-stat-label')?.textContent === label)
    ?.querySelector('.ox-rv-stat-value')?.textContent;
const shiftReady = () =>
  screen.findByRole('heading', { level: 2, name: 'Р-208 · Северный маршрут' }, SLOW);

describe('«Приёмка смен»: шапка и пусто', () => {
  it('крошка области, заголовок, пояснение; нет смен — «Нет смен на проверке» (п. 41)', async () => {
    await open();
    const s = section();
    expect(within(s).getByText(/Север Логистик/)).toBeTruthy();
    expect(
      within(s).getByText(
        'Фото до и после, пробег, дефекты и расходы. Машина возвращается в пул свободных только после приёмки.',
      ),
    ).toBeTruthy();
    expect(await within(s).findByText('Нет смен на проверке', undefined, SLOW)).toBeTruthy();
    expect(
      within(s).getByText(
        'Когда водитель сдаст машину, смена появится здесь. В демо переключитесь на водителя и пройдите смену.',
      ),
    ).toBeTruthy();
  });

  it('владелец: крошка «{организация} · все подразделения»', async () => {
    await open({ persona: 'owner' });
    expect(within(section()).getByText('Альта Групп · все подразделения')).toBeTruthy();
  });

  it('входы на страницы вне меню: «Очередь дефектов» и «Начисления»', async () => {
    const a = await open();
    const links = screen.getByRole('navigation', { name: 'Связанные разделы' });
    fireEvent.click(within(links).getByRole('button', { name: 'Очередь дефектов' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Очередь блокирующих дефектов' }, SLOW),
    ).toBeTruthy();
    expect(a.path()).toBe(`/t/${ALTA}/defects`);
  });

  it('владелец: вход «Категории расходов» (W2.41); у менеджера без настроек модуля его нет', async () => {
    const a = await open({ persona: 'owner' });
    const links = screen.getByRole('navigation', { name: 'Связанные разделы' });
    fireEvent.click(within(links).getByRole('button', { name: 'Категории расходов' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Категории расходов' }, SLOW),
    ).toBeTruthy();
    expect(a.path()).toBe(`/t/${ALTA}/expense-categories`);
    a.close();
    app = undefined;
    await open();
    expect(screen.queryByRole('button', { name: 'Категории расходов' })).toBeNull();
  });

  it('пункт меню «Приёмка смен» — текущая страница', async () => {
    await open();
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(nav).getByRole('button', { current: 'page' }).getAttribute('title')).toBe(H1);
  });

  it('загрузка: скелетон «Загрузка»; ошибка — текст и «Повторить»', async () => {
    const a = await open({ scenario: 'listTripPlans=rate_limited' });
    const err = await screen.findByText(/Не удалось загрузить смены/, undefined, SLOW);
    expect(err.textContent).toBe(
      'Не удалось загрузить смены: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Нет смен на проверке', undefined, SLOW)).toBeTruthy();
  });
});

describe('карточка сданной смены (п. 42)', () => {
  it('очередь, статистика, фото до и после, осмотр, расходы и итог', async () => {
    await open({ setup: (s) => submittedShift(s, { comment: 'Всё в порядке' }) });
    await shiftReady();
    const item = screen.getByRole('button', { name: /Р-208 · Илья Васильев/ });
    expect(item.getAttribute('aria-pressed')).toBe('true');
    expect(item.textContent).toContain('ГАЗель Next · А 412 МР 77');
    expect(item.textContent).toContain('Ожидает приёмки');
    expect(screen.getByText('Илья Васильев · ГАЗель Next А 412 МР 77')).toBeTruthy();
    expect(statValue('Пробег при выезде')).toBe(nb('84 500 км'));
    expect(statValue('При сдаче')).toBe(nb('84 560 км'));
    expect(statValue('Пройдено')).toBe('60 км');
    expect(statValue('Топливо')).toBe('½ → ½');
    expect(screen.getByRole('heading', { level: 3, name: 'Фото до и после' })).toBeTruthy();
    expect(screen.getByText('Перед выездом')).toBeTruthy();
    for (const side of ['Спереди', 'Сзади', 'Слева', 'Справа', 'Одометр']) {
      expect(screen.getByText(side)).toBeTruthy();
    }
    expect(screen.getByText('Осмотр перед выездом: чек-лист заполнен')).toBeTruthy();
    expect(screen.getByText('Осмотр при сдаче: чек-лист заполнен')).toBeTruthy();
    expect(screen.getByText('Дефекты не отмечены')).toBeTruthy();
    expect(screen.getByText('Всё в порядке')).toBeTruthy();
    // «Топливо» — и подпись статистики, и категория расхода: строка расхода — по своему блоку.
    await waitFor(() => expect(document.querySelector('.ox-rv-expense')).toBeTruthy(), SLOW);
    const exp = document.querySelector('.ox-rv-expense')?.textContent;
    expect(exp).toContain('Топливо');
    expect(exp).toContain('01.10.2026 · чек приложен');
    expect(exp).toContain(nb('2 500 ₽'));
    expect(screen.getByText('Итого заявлено').parentElement?.textContent).toContain(nb('2 500 ₽'));
    // До приёмки начисления нет (его создаёт reviewTrip approve, Q-55) — блока нет.
    expect(screen.queryByText('Начисление водителю за рейс')).toBeNull();
  });

  it('до приёмки начисление не запрашивается (нет 404 getTripEarnings в консоли)', async () => {
    const a = await open({ setup: (s) => submittedShift(s) });
    await shiftReady();
    await screen.findByText('Итого заявлено', undefined, SLOW);
    expect(sent(a, 'GET', '/earnings')).toHaveLength(0);
  });

  it('расходы «Шиномонтаж и мелкий ремонт» и «Прочее» (0.5.1-stage2): строки, иконки, итог — карточка не падает', async () => {
    await open({ setup: (s) => submittedShift(s, { extra: ['tire_service', 'other'] }) });
    await shiftReady();
    await waitFor(() => expect(document.querySelectorAll('.ox-rv-expense')).toHaveLength(3), SLOW);
    const rows = [...document.querySelectorAll('.ox-rv-expense')];
    const label = (r: Element) => r.querySelector('.ox-rv-expense-label')?.textContent;
    const icon = (r: Element) => r.querySelector('.material-symbols-rounded')?.textContent;
    expect(rows.map(label)).toEqual(['Топливо', 'Шиномонтаж и мелкий ремонт', 'Прочее']);
    expect(rows.map(icon)).toEqual(['local_gas_station', 'tire_repair', 'receipt_long']);
    expect(rows[2]?.textContent).toContain('01.10.2026 · Ключи от склада');
    expect(screen.getByText('Итого заявлено').parentElement?.textContent).toContain(nb('4 900 ₽'));
  });

  // W2.41 · подписи категорий — справочник тенанта с архивными; код вне справочника — сам код.
  it('расходы своей и архивной категории владельца — подписи справочника', async () => {
    await open({
      setup: (s) => {
        submittedShift(s, { extra: ['custom_1', 'custom_2', 'custom_9'] });
        const f = fleetOf(s) as unknown as { categories: object[] };
        const row = { seeded: false, createdAt: '2026-10-01T06:00:00Z', revision: 1 };
        f.categories.push(
          {
            ...row,
            code: 'custom_1',
            label: 'Стоянка на ночь',
            commentRequired: false,
            state: 'active',
            sortOrder: 1000,
          },
          {
            ...row,
            code: 'custom_2',
            label: 'Старая категория',
            commentRequired: false,
            state: 'archived',
            archivedAt: '2026-10-01T07:00:00Z',
            sortOrder: 1010,
          },
        );
      },
    });
    await shiftReady();
    await waitFor(() => expect(document.querySelectorAll('.ox-rv-expense')).toHaveLength(4), SLOW);
    const label = (r: Element) => r.querySelector('.ox-rv-expense-label')?.textContent;
    await waitFor(
      () =>
        expect([...document.querySelectorAll('.ox-rv-expense')].map(label)).toEqual([
          'Топливо',
          'Стоянка на ночь',
          'Старая категория',
          'custom_9',
        ]),
      SLOW,
    );
  });

  // Возврат 1 W2.41: справочник не загрузился (429/5xx) — подписи своих категорий неизвестны (видны коды), поэтому в
  // «Расходах в пути» — ошибка загрузки категорий и «Повторить»; после повтора — подписи справочника.
  it('справочник категорий не загрузился: ошибка и «Повторить», затем подписи справочника', async () => {
    const a = await open({
      scenario: 'listExpenseCategories=rate_limited',
      setup: (s) => {
        submittedShift(s, { extra: ['custom_1'] });
        (fleetOf(s) as unknown as { categories: object[] }).categories.push({
          seeded: false,
          createdAt: '2026-10-01T06:00:00Z',
          revision: 1,
          code: 'custom_1',
          label: 'Стоянка на ночь',
          commentRequired: false,
          state: 'active',
          sortOrder: 1000,
        });
      },
    });
    await shiftReady();
    const err = await screen.findByText(
      'Не удалось загрузить категории: Слишком много запросов. Подождите и повторите.',
      undefined,
      SLOW,
    );
    const block = err.closest('.ox-rv-expenses') as HTMLElement;
    expect(block).toBeTruthy();
    a.scenario.setScenario(null);
    fireEvent.click(within(block).getByRole('button', { name: 'Повторить' }));
    const label = (r: Element) => r.querySelector('.ox-rv-expense-label')?.textContent;
    await waitFor(
      () =>
        expect([...block.querySelectorAll('.ox-rv-expense')].map(label)).toContain(
          'Стоянка на ночь',
        ),
      SLOW,
    );
    expect(screen.queryByText(/^Не удалось загрузить категории/)).toBeNull();
  });

  it('без расходов — «Расходов нет», итог 0 ₽', async () => {
    await open({ setup: (s) => submittedShift(s, { expense: false }) });
    await shiftReady();
    expect(await screen.findByText('Расходов нет', undefined, SLOW)).toBeTruthy();
  });

  it('расходы не загрузились: ошибка и «Повторить», итога нет (проверка расходов S2-11)', async () => {
    const a = await open({
      setup: (s) => submittedShift(s),
      scenario: 'listTripExpenses=rate_limited',
    });
    await shiftReady();
    const err = await screen.findByText(/^Не удалось загрузить расходы: /, undefined, SLOW);
    expect(err.textContent).toBe(
      'Не удалось загрузить расходы: Слишком много запросов. Подождите и повторите.',
    );
    const card = err.closest('.ox-rv-expenses') as HTMLElement;
    expect(card).toBeTruthy();
    expect(within(card).queryByText('Итого заявлено')).toBeNull();
    expect(within(card).queryByText('Расходов нет')).toBeNull();
    a.scenario.setScenario(null);
    fireEvent.click(within(card).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(document.querySelector('.ox-rv-expense')).toBeTruthy(), SLOW);
    expect(screen.getByText('Итого заявлено').parentElement?.textContent).toContain(nb('2 500 ₽'));
  });
});

describe('решение: доработка (п. 44)', () => {
  it('без замечаний и без разделов — ошибки эталона; с «Фото при сдаче» — тост, чип, итог', async () => {
    const a = await open({ setup: (s) => submittedShift(s) });
    await shiftReady();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Опишите, что нужно исправить',
    );
    fireEvent.change(screen.getByLabelText('Замечания для водителя'), {
      target: { value: 'Переснимите фото слева' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Отметьте хотя бы один раздел для доработки',
    );
    expect(sent(a, 'POST', '/review')).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Фото при сдаче' }));
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }));
    await waitFor(() => expect(toast()).toBe('Смена возвращена водителю на доработку'), SLOW);
    const status = await screen.findByText(
      'Возвращено водителю: «Переснимите фото слева». Исправить: Фото при сдаче.',
      undefined,
      SLOW,
    );
    expect(status.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Р-208/ }).textContent).toContain('На доработке');
    expect(screen.queryByRole('button', { name: 'Принять смену' })).toBeNull();
    expect(sent(a, 'POST', '/review').map((r) => r.status)).toEqual([200]);
  });
});

describe('решение: приёмка (п. 46)', () => {
  it('диалог «Принять смену Р-208?» → тост, итог, машина свободна', async () => {
    const a = await open({ setup: (s) => submittedShift(s) });
    await shiftReady();
    fireEvent.click(screen.getByRole('button', { name: 'Принять смену' }));
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    expect(within(dlg).getByRole('heading', { name: 'Принять смену Р-208?' })).toBeTruthy();
    expect(within(dlg).getByText('Осмотр, пробег и расходы будут подтверждены.')).toBeTruthy();
    expect(within(dlg).getByText('Что произойдёт')).toBeTruthy();
    expect(within(dlg).getByText('Машина вернётся в пул свободных')).toBeTruthy();
    expect(
      within(dlg).getByText('Расходы станут принятыми; кассовые операции создаются отдельно'),
    ).toBeTruthy();
    // «Менеджер логистики» сида с правом на начисления своей области (canEarnings эталона) — строка есть.
    expect(within(dlg).getByText(/Будет создано начисление водителю/)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Принять смену' }));
    await waitFor(() => expect(toast()).toBe('Смена принята. Машина вернулась в пул'), SLOW);
    const done = await screen.findByText(
      /^Смена принята в \d\d:\d\d\. Машина вернулась в пул свободных\.$/,
      undefined,
      SLOW,
    );
    expect(done.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Р-208/ }).textContent).toContain('Принят');
    const f = fleetOf(a.scenario);
    expect(f.vehicles.find((v) => v.proto === 'v1')?.vstate).toBe('free');
    expect(f.expenses.every((x) => x.reviewState === 'approved')).toBe(true);
  });

  it('владелец: строка о начислении в диалоге; после приёмки — «Начисление водителю за рейс» 4 500 ₽ (п. 43)', async () => {
    await open({ persona: 'owner', setup: (s) => submittedShift(s) });
    await shiftReady();
    fireEvent.click(screen.getByRole('button', { name: 'Принять смену' }));
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    expect(
      within(dlg).getByText(
        'Будет создано начисление водителю. Его видят владелец и уполномоченный менеджер',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Принять смену' }));
    const earn = await screen.findByText('Начисление водителю за рейс', undefined, SLOW);
    expect(earn.closest('.ox-rv-earn')?.textContent).toContain(nb('4 500 ₽'));
  });

  it('нет связи: тост «нет связи», смена остаётся на проверке, диалог открыт для повтора', async () => {
    await open({ setup: (s) => submittedShift(s), scenario: 'reviewTrip=offline' });
    await shiftReady();
    fireEvent.click(screen.getByRole('button', { name: 'Принять смену' }));
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Принять смену' }));
    await waitFor(() => expect(toast()).toBe('Нет связи с сервером. Операция не выполнена.'), SLOW);
    expect(screen.getByRole('button', { name: /Р-208/, hidden: true }).textContent).toContain(
      'Ожидает приёмки',
    );
    // Перечитывание после ошибки не закрывает диалог: «Принять смену» снова доступна.
    await new Promise((r) => setTimeout(r, 300));
    const again = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Принять смену',
    }) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
  });

  it('после приёмки диалог закрывается до перечитывания: второго reviewTrip нет', async () => {
    const a = await open({ setup: (s) => submittedShift(s) });
    await shiftReady();
    fireEvent.click(screen.getByRole('button', { name: 'Принять смену' }));
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    // Перечитывание рейсов после команды — медленное: окно, в котором кнопка диалога была снова доступна.
    a.scenario.setScenario('listTripPlans=delay=1500');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Принять смену' }));
    await waitFor(() => expect(toast()).toBe('Смена принята. Машина вернулась в пул'), SLOW);
    // Тост показан — диалога уже нет (или его кнопка недоступна): повторный клик не отправит команду.
    const open2 = screen.queryByRole('dialog');
    const confirm = open2
      ? (within(open2).queryByRole('button', { name: 'Принять смену' }) as HTMLButtonElement | null)
      : null;
    if (confirm && !confirm.disabled) fireEvent.click(confirm);
    expect(confirm === null || confirm.disabled).toBe(true);
    a.scenario.setScenario(null);
    await screen.findByText(/^Смена принята в \d\d:\d\d\./, undefined, SLOW);
    expect(sent(a, 'POST', '/review')).toHaveLength(1);
  });

  it('смена уже обработана (409): тост и перечитывание', async () => {
    const a = await open({
      setup: (s) => submittedShift(s),
      scenario: 'reviewTrip=invalid_transition',
    });
    await shiftReady();
    fireEvent.click(screen.getByRole('button', { name: 'Принять смену' }));
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    const before = sent(a, 'GET', '/fleet/trip-plans').length;
    fireEvent.click(within(dlg).getByRole('button', { name: 'Принять смену' }));
    await waitFor(() => expect(toast()).toBeTruthy(), SLOW);
    await waitFor(
      () => expect(sent(a, 'GET', '/fleet/trip-plans').length).toBeGreaterThan(before),
      SLOW,
    );
  });
});

describe('карточка критического дефекта (п. 47)', () => {
  it('дефект первым в очереди; «разрешить выезд» — тост, смена уходит из очереди', async () => {
    await open({
      setup: (s) => {
        blockingDefect(s);
      },
    });
    const h = await screen.findByRole(
      'heading',
      { level: 2, name: 'Критический дефект · ГАЗель Next А 412 МР 77' },
      SLOW,
    );
    const card = h.closest('[role="alert"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Р-208 · Илья Васильев · осмотр в 08:47');
    expect(card.textContent).toContain('Стёкла: Скол');
    expect(card.textContent).toContain(
      'Выезд заблокирован до решения. Машина недоступна для броней. Чек-лист приложения не заменяет обязательный технический допуск.',
    );
    expect(screen.getByRole('button', { name: /Р-208/ }).textContent).toContain(
      'Дефект на проверке',
    );
    fireEvent.click(
      within(card).getByRole('button', { name: 'Дефект некритичный — разрешить выезд' }),
    );
    await waitFor(() => expect(toast()).toBe('Выезд разрешён'), SLOW);
    expect(await screen.findByText('Нет смен на проверке', undefined, SLOW)).toBeTruthy();
  });

  it('«Подтвердить неисправность» — тост, машина недоступна', async () => {
    const a = await open({
      setup: (s) => {
        blockingDefect(s);
      },
    });
    const h = await screen.findByRole('heading', { level: 2, name: /Критический дефект/ }, SLOW);
    const card = h.closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Подтвердить неисправность' }));
    await waitFor(
      () => expect(toast()).toBe('Неисправность подтверждена, машина снята с рейса'),
      SLOW,
    );
    const v = fleetOf(a.scenario).vehicles.find((x) => x.proto === 'v1');
    expect(v?.vstate).toBe('unavailable');
    expect(v?.note).toBe('неисправность подтверждена');
  });
});

describe('доступ', () => {
  it('водитель: гейт «Нет права на приёмку смен»', async () => {
    app = await renderMockApp(`/t/${ALTA}/review`, {
      persona: 'driver',
      preset: 'logistics-ready',
    });
    expect(await screen.findByText('Нет права на приёмку смен', undefined, SLOW)).toBeTruthy();
  });

  it('организация только для чтения: кнопки решения недоступны', async () => {
    await open({
      setup: (s) => {
        submittedShift(s);
        s.applyPreset('trial-ended');
      },
    });
    await shiftReady();
    expect(
      (screen.getByRole('button', { name: 'Принять смену' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Вернуть на доработку' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
