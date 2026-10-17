// W2.22 · Экранные тесты «Сегодня» водителя на MSW-сценарном сервере W2.00 (пресет logistics-ready, Илья
// Васильев, рейс Р-208): бронь и конфликт, офлайн, осмотр с фото (сессии загрузки), выезд и блокирующий дефект,
// разрешение менеджера, маршрут и «Завершить рейс», расходы, сдача, доработка, приёмка, нет рейса, ошибка.
import { BASE_URL } from '../../../app/testing.tsx';
import { devLogin } from '@ortus/api-client';
import { seedUuid } from '@ortus/domain/seed';
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../app/testing.tsx';
import { transport } from './photos.ts';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const SLOW = { timeout: 8_000 };
vi.setConfig({ testTimeout: 30_000 });

let app: MockApp | undefined;
const realPut = transport.put;
const realPoll = transport.pollMs;
beforeEach(() => {
  transport.put = async (_url, _file, _type, _signal, onProgress) => {
    onProgress?.(50, 100);
  };
  transport.pollMs = 15;
});
afterEach(() => {
  setOnline(true);
  app?.close();
  app = undefined;
  transport.put = realPut;
  transport.pollMs = realPoll;
  // onlineManager TanStack Query — общий для тестов: после «offline» без подписчиков остаётся офлайн.
  onlineManager.setOnline(true);
});

function setOnline(on: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { value: on, configurable: true });
  window.dispatchEvent(new Event(on ? 'online' : 'offline'));
}

const open = async (o: MockAppOptions = {}, url = `/t/${ALTA}/today`): Promise<MockApp> => {
  app = await renderMockApp(url, { persona: 'driver', preset: 'logistics-ready', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Моя смена' }, SLOW);
  return app;
};

const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const card = (model: string): HTMLElement => {
  const el = screen.getByText(model, { selector: '.ox-dr-car-model' }).closest('article');
  if (!el) throw new Error(`нет карточки ${model}`);
  return el;
};

type Org = { files: { status: string }[] };
/** Проверка загруженных файлов завершена (антивирус режима mock, dev-маршрут scanFiles). */
const quarantined = (a: MockApp): number =>
  (a.scenario.state().orgs[ALTA] as unknown as Org).files.filter((f) => f.status === 'quarantined')
    .length;
function scan(a: MockApp): void {
  const org = a.scenario.state().orgs[ALTA] as unknown as Org;
  for (const f of org.files) if (f.status === 'quarantined') f.status = 'ready';
}

const fileInput = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!el) throw new Error('нет поля выбора файла');
  return el;
};

function choose(slot: HTMLElement): void {
  fireEvent.click(slot);
  const f = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
  fireEvent.change(fileInput(), { target: { files: [f] } });
}

const SIDES = ['Спереди', 'Сзади', 'Слева', 'Справа', 'Одометр'];

async function reserveGazel(): Promise<void> {
  await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
  fireEvent.click(within(card('ГАЗель Next')).getByRole('button', { name: 'Забронировать' }));
  await screen.findByRole('heading', { level: 2, name: 'Осмотр перед выездом' }, SLOW);
}

async function photos(a: MockApp): Promise<void> {
  for (const side of SIDES) {
    choose(screen.getByRole('button', { name: new RegExp(`^${side}: `) }));
  }
  await waitFor(() => expect(quarantined(a)).toBe(SIDES.length), SLOW);
  scan(a);
  await screen.findByText('Фото · 5 из 5', undefined, SLOW);
}

function fill(odometer: string, checks: string[]): void {
  fireEvent.change(screen.getByLabelText(/^Пробег по одометру, км/), {
    target: { value: odometer },
  });
  fireEvent.click(screen.getByRole('button', { name: '½' }));
  for (const c of checks) fireEvent.click(screen.getByLabelText(c));
}

const DEP = [
  'Кузов и стёкла осмотрены',
  'Шины и световые приборы исправны',
  'Документы и комплект на месте',
];
const RET = ['Груз выгружен полностью', 'Личные вещи забраны', 'Ключи и документы на месте'];

async function depart(a: MockApp): Promise<void> {
  await reserveGazel();
  await photos(a);
  fill('84500', DEP);
  fireEvent.click(screen.getByRole('button', { name: 'Выехать на маршрут' }));
  await screen.findByRole('heading', { level: 2, name: 'Маршрут' }, SLOW);
}

/** Команда менеджера (Котова) из теста: dev-вход, запрос с CSRF и If-Match, возврат к водителю. */
async function asManager(path: string, body: unknown, ifMatch: string): Promise<number> {
  const { csrfToken } = await devLogin('manager', { baseUrl: BASE_URL });
  try {
    const r = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': crypto.randomUUID(),
        'If-Match': ifMatch,
      },
      body: JSON.stringify(body),
    });
    return r.status;
  } finally {
    await devLogin('driver', { baseUrl: BASE_URL });
  }
}

type Fleet = {
  trips: { id: string; state: string; revision: number; blockingDefectId?: string }[];
  defects: { id: string; revision: number }[];
};
const fleet = (a: MockApp): Fleet =>
  (a.scenario.state().orgs[ALTA] as unknown as { fleet: Fleet }).fleet;
const trip208 = (a: MockApp) => {
  const t = fleet(a).trips.find((x) => x.id === A('Р-208'));
  if (!t) throw new Error('нет Р-208');
  return t;
};

/** Уйти на «Автомобили» и вернуться: смена перечитывается (решение менеджера без ожидания опроса). */
async function revisit(a: MockApp): Promise<void> {
  await a.router.navigate({ to: `/t/${ALTA}/cars` });
  await screen.findByRole('heading', { level: 1, name: 'Автомобили' }, SLOW);
  await a.router.navigate({ to: `/t/${ALTA}/today` });
  await screen.findByRole('heading', { level: 1, name: 'Моя смена' }, SLOW);
}

describe('«Сегодня»: бронь машины', () => {
  it('крошка, этапы, карточка рейса Р-208, машины с совместимостью', async () => {
    await open();
    await screen.findByText('Р-208 · Северный маршрут', undefined, SLOW);
    expect(screen.getByText('Илья Васильев · четверг, 1 октября')).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Этапы смены' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['1Машина', '2Осмотр', '3Рейс', '4Сдача', '5Приёмка']);
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toBe('1Машина');
    expect(screen.getByText('Р-208 · Северный маршрут')).toBeTruthy();
    expect(screen.getByText('Запланирован')).toBeTruthy();
    expect(
      screen.getByText('01.10.2026 · 09:00–13:00 · 3 точки · 46 км · Сухой груз · 14 паллет-мест'),
    ).toBeTruthy();
    await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
    const models = [...document.querySelectorAll('.ox-dr-car-model')].map((e) => e.textContent);
    expect(models.slice(0, 2)).toEqual(['ГАЗель Next', 'Mercedes Sprinter']);
    expect(card('ГАЗель Next').textContent).toContain(
      'Подходит рейсу: масса, объём, длина и температура',
    );
    expect(
      within(card('Ford Transit')).getByRole('button', { name: 'Не подходит рейсу' }),
    ).toHaveProperty('disabled', true);
    expect(card('Ford Transit').textContent).toContain('Объём: 11 м³, нужно от 12 м³');
    expect(card('ГАЗон Next').textContent).toContain(
      'Доступность: Недоступна · Плановое ТО до 03.10',
    );
    expect(within(card('ГАЗон Next')).getByRole('button', { name: 'Недоступна' })).toBeTruthy();
  });

  it('«Забронировать»: тост, бронь «держится до 11:00», осмотр; «Отменить бронь» водителю нет', async () => {
    await open();
    await reserveGazel();
    await waitFor(() => expect(toast()).toBe('Бронь подтверждена сервером. Начните осмотр'));
    expect(
      screen.getByText('Бронь подтверждена сервером · ГАЗель Next А 412 МР 77 · держится до 11:00'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отменить бронь' })).toBeNull();
    const steps = screen.getByRole('list', { name: 'Этапы смены' });
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toBe('2Осмотр');
    expect(screen.getByText('Фото · 0 из 5')).toBeTruthy();
    expect(
      screen.getByText('Осталось: 5 фото, пробег, уровень топлива, 3 пункта чек-листа'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выехать на маршрут' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      screen.getByRole('button', {
        name: 'Спереди: Не снято. Нажмите, чтобы снять или выбрать фото',
      }),
    ).toBeTruthy();
  });

  it('конфликт брони 409: «Конфликт брони», текст сервера, «Обновить список»', async () => {
    await open({ scenario: 'reserveVehicle=reservation_overlap' });
    await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
    fireEvent.click(within(card('ГАЗель Next')).getByRole('button', { name: 'Забронировать' }));
    const alert = await screen.findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toContain('Конфликт брони');
    app?.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Обновить список' }));
    await waitFor(() => expect(toast()).toBe('Список обновлён'), SLOW);
    expect(screen.queryByText('Конфликт брони')).toBeNull();
  });

  it('нет связи: «Нет связи: бронь требует подтверждения сервера.», «Бронь недоступна»', async () => {
    await open();
    await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
    setOnline(false);
    await screen.findByText('Нет связи: бронь требует подтверждения сервера.');
    expect(
      within(card('ГАЗель Next')).getByRole('button', { name: 'Бронь недоступна' }),
    ).toHaveProperty('disabled', true);
  });
});

describe('«Сегодня»: осмотр и выезд', () => {
  it('фото через сессию загрузки, пробег, топливо, чек-лист → «Выезд подтверждён сервером»', async () => {
    const a = await open();
    await reserveGazel();
    await photos(a);
    expect(screen.getAllByText('Загружено')).toHaveLength(5);
    fireEvent.change(screen.getByLabelText(/^Пробег по одометру, км/), {
      target: { value: '84000' },
    });
    expect(screen.getByText(`Пробег не может быть меньше 84 370 км`)).toBeTruthy();
    expect(screen.getByLabelText(/^Пробег по одометру, км/).getAttribute('aria-invalid')).toBe(
      'true',
    );
    fireEvent.change(screen.getByLabelText(/^Пробег по одометру, км/), {
      target: { value: '90000' },
    });
    expect(screen.getByText(`Больше начального на 5 630 км — проверьте показания`)).toBeTruthy();
    fill('84500', DEP);
    expect(screen.getByText(`Последний зафиксированный пробег: 84 370 км`)).toBeTruthy();
    expect(screen.queryByText(/^Осталось:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Выехать на маршрут' }));
    await waitFor(() => expect(toast()).toBe('Выезд подтверждён сервером'), SLOW);
    expect(screen.getByText('В рейсе')).toBeTruthy();
    expect(screen.getByText('Отмечено 0 из 3')).toBeTruthy();
    expect(trip208(a).state).toBe('on_route');
  });

  it('сбой загрузки фото: «Ошибка загрузки», «Повторить»', async () => {
    await open();
    await reserveGazel();
    transport.put = async () => {
      throw new TypeError('PUT 500');
    };
    choose(screen.getByRole('button', { name: /^Спереди: / }));
    await screen.findByText('Ошибка загрузки', undefined, SLOW);
    await waitFor(() => expect(toast()).toBe('Загрузка прервалась. Повторите попытку.'));
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('дефект: «Опишите дефект»; критический → «Отправить на проверку менеджеру» → «Выезд заблокирован»', async () => {
    const a = await open();
    await reserveGazel();
    await photos(a);
    fill('84500', DEP);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить дефект' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(screen.getByRole('alert').textContent).toBe('Опишите дефект');
    fireEvent.change(screen.getByLabelText('Где'), { target: { value: 'Стёкла' } });
    fireEvent.change(screen.getByLabelText(/^Описание/), { target: { value: 'Скол' } });
    fireEvent.click(screen.getByLabelText('Критический — машина не может выехать'));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(screen.getByText('Критический — выезд невозможен')).toBeTruthy();
    expect(
      screen.getByText(
        'Отмечен критический дефект. Выезд будет заблокирован, осмотр уйдёт менеджеру.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отправить на проверку менеджеру' }));
    await waitFor(
      () => expect(toast()).toBe('Выезд заблокирован: дефект отправлен менеджеру'),
      SLOW,
    );
    await screen.findByRole('heading', { level: 2, name: 'Выезд заблокирован' }, SLOW);
    await screen.findByText(
      'Критический дефект «Стёкла: Скол» отправлен менеджеру на проверку. Машина недоступна для выезда.',
      undefined,
      SLOW,
    );
    expect(screen.getByText('Дефект на проверке')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Выбрать другую машину' })).toBeNull();

    // Менеджер: «Дефект некритичный — разрешить выезд» → водитель сам нажимает «Выехать на маршрут».
    const t = trip208(a);
    const d = fleet(a).defects.find((x) => x.id === t.blockingDefectId);
    expect(
      await asManager(
        `/api/v1/tenants/${ALTA}/fleet/defects/${d?.id ?? ''}/decision`,
        { decision: 'allow_departure' },
        `"rev-${String(d?.revision)}"`,
      ),
    ).toBe(200);
    await revisit(a);
    await screen.findByText('Менеджер разрешил выезд: дефект признан некритичным', undefined, SLOW);
    expect(screen.queryByRole('heading', { level: 2, name: 'Осмотр перед выездом' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Выехать на маршрут' }));
    await waitFor(() => expect(toast()).toBe('Выезд подтверждён сервером'), SLOW);
    await screen.findByRole('heading', { level: 2, name: 'Маршрут' }, SLOW);
  });
});

describe('«Сегодня»: рейс, расходы, сдача', () => {
  it('«Прибыл», «Завершить рейс Р-208?» с «Внимание» → «Осмотр при сдаче»', async () => {
    const a = await open();
    await depart(a);
    const first = screen.getAllByRole('button', { name: 'Прибыл' })[0] as HTMLElement;
    fireEvent.click(first);
    expect(screen.getByText('Отмечено 1 из 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отменить' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByText('✓')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить рейс' }));
    const dlg = screen.getByRole('dialog', { name: 'Завершить рейс Р-208?' });
    expect(dlg.textContent).toContain(
      'Дальше — осмотр при сдаче: 5 фото, пробег, топливо и чек-лист.',
    );
    expect(dlg.textContent).toContain('Отмечено точек: 1 из 3. Убедитесь, что доставка выполнена.');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить рейс' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Завершить рейс' }),
    );
    await waitFor(() => expect(toast()).toBe('Рейс завершён. Заполните осмотр при сдаче'), SLOW);
    await screen.findByRole('heading', { level: 2, name: 'Осмотр при сдаче' }, SLOW);
    expect(screen.getByLabelText('Груз выгружен полностью')).toBeTruthy();
    expect(screen.getByLabelText('Комментарий для менеджера')).toBeTruthy();
    expect(screen.queryByLabelText('Критический — машина не может выехать')).toBeNull();
  });

  it('расход: ошибки под полями, затем «Расход принят сервером» и строка «Топливо · 2 500 ₽»', async () => {
    const a = await open();
    await depart(a);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить расход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить расход' }));
    expect(screen.getByText('Укажите сумму')).toBeTruthy();
    expect(screen.getByText('Добавьте фото чека')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Сумма, ₽/), { target: { value: '-500' } });
    expect(screen.getByText('Сумма должна быть больше нуля')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Сумма, ₽/), { target: { value: '2500' } });
    expect((screen.getByLabelText(/^Дата/) as HTMLInputElement).value).toBe('2026-10-01');
    expect((screen.getByLabelText('Категория') as HTMLSelectElement).value).toBe('fuel');
    choose(screen.getByRole('button', { name: /^Чек: / }));
    await waitFor(() => expect(quarantined(a)).toBe(1), SLOW);
    scan(a);
    await screen.findByText('Загружено', undefined, SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить расход' }));
    await waitFor(() => expect(toast()).toBe('Расход принят сервером'), SLOW);
    await screen.findByText(`Топливо · 2 500 ₽`, undefined, SLOW);
    expect(screen.getByText('01.10.2026 · чек приложен')).toBeTruthy();
    expect(screen.getByText('Принято сервером')).toBeTruthy();
  });

  it('сдача: пробег меньше выезда — ошибка; «Сдать машину» → «Ожидает приёмки менеджером»', async () => {
    const a = await open();
    await depart(a);
    fireEvent.click(screen.getByRole('button', { name: 'Завершить рейс' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Завершить рейс' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Осмотр при сдаче' }, SLOW);
    await photos(a);
    fill('84400', RET);
    await screen.findByText(`Пробег не может быть меньше 84 500 км`, undefined, SLOW);
    expect(screen.getByRole('button', { name: 'Сдать машину' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(/^Пробег по одометру, км/), {
      target: { value: '84560' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сдать машину' }));
    await waitFor(() => expect(toast()).toBe('Сдача принята сервером. Ожидайте приёмки'), SLOW);
    await screen.findByRole('heading', { level: 2, name: 'Ожидает приёмки менеджером' }, SLOW);
    await screen.findByText('60 км', undefined, SLOW);
    expect(screen.getByText('Пройдено')).toBeTruthy();
    expect(trip208(a).state).toBe('submitted');

    // Менеджер возвращает на доработку → «Менеджер вернул смену на доработку», «Исправить: Фото при сдаче».
    const t = trip208(a);
    expect(
      await asManager(
        `/api/v1/tenants/${ALTA}/fleet/trips/${t.id}/review`,
        { decision: 'rework', comment: 'Переснимите фото слева', steps: ['photos'] },
        `"rev-${String(t.revision)}"`,
      ),
    ).toBe(200);
    await revisit(a);
    await screen.findByText('Менеджер вернул смену на доработку', undefined, SLOW);
    expect(screen.getByText('«Переснимите фото слева»')).toBeTruthy();
    expect(screen.getByText('Исправить: Фото при сдаче')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Осмотр при сдаче' })).toBeTruthy();

    // Повторная сдача и приёмка → «Смена принята», без демо-кнопки.
    await photos(a);
    fill('84560', RET);
    fireEvent.click(screen.getByRole('button', { name: 'Сдать машину' }));
    await screen.findByRole('heading', { level: 2, name: 'Ожидает приёмки менеджером' }, SLOW);
    const t2 = trip208(a);
    expect(
      await asManager(
        `/api/v1/tenants/${ALTA}/fleet/trips/${t2.id}/review`,
        { decision: 'approve' },
        `"rev-${String(t2.revision)}"`,
      ),
    ).toBe(200);
    await revisit(a);
    await screen.findByRole('heading', { level: 2, name: 'Смена принята' }, SLOW);
    expect(screen.queryByText('Начать новую демо-смену')).toBeNull();
    expect(document.body.textContent).not.toContain('Начисление');
  }, 30_000);
});

describe('«Сегодня»: состояния', () => {
  it('нет рейса: «Рейсов на сегодня нет»', async () => {
    await open({ scenario: 'listTripPlans=empty' });
    await screen.findByText('Рейсов на сегодня нет', undefined, SLOW);
  });

  it('ошибка загрузки смены: текст по коду и «Повторить»', async () => {
    const a = await open({ scenario: 'listTripPlans=rate_limited' });
    const t = await screen.findByText(/Не удалось загрузить смену/, undefined, SLOW);
    expect(t.textContent).toBe(
      'Не удалось загрузить смену: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByText('Р-208 · Северный маршрут', undefined, SLOW);
  });

  it('загрузка: скелетон «Загрузка»', async () => {
    await open({ scenario: 'listTripPlans=delay=400' });
    expect(within(screen.getByRole('main')).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    await screen.findByText('Р-208 · Северный маршрут', undefined, SLOW);
  });
});
