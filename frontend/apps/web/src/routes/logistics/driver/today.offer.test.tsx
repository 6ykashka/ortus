// W2.74 · «Моя смена» с машинами на выбор (S2-20, D-35; макеты 1c–1e): выбор из предложенных и лист «Берёте …?»,
// осмотр на выбранной машине со статусом брони, одна машина — «Начать осмотр», машины нет, выбор только со связью
// (D-09), 409 offer_closed — сообщение и перечитывание, у временного водителя нет «Подтвердить бронь» и
// «Забронировать», «Автомобили» — только предложенные. MSW W2.71, сюжет — offer.fixtures.test-util.tsx.
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AFTER_DEADLINE,
  ALTA,
  IN_WINDOW,
  type OfferApp,
  renderOffer,
} from './offer.fixtures.test-util.tsx';
import { transport } from './photos.ts';

const SLOW = { timeout: 8_000 };
vi.setConfig({ testTimeout: 40_000 });

let app: OfferApp | undefined;
const realPut = transport.put;
const realPoll = transport.pollMs;
beforeEach(() => {
  transport.put = async (_url, _file, _type, _signal, onProgress) => {
    onProgress?.(50, 100);
  };
  transport.pollMs = 15;
  try {
    sessionStorage.clear();
  } catch {
    // хранилище недоступно — имена машин не запоминаются
  }
});
afterEach(() => {
  app?.close();
  app = undefined;
  transport.put = realPut;
  transport.pollMs = realPoll;
  onlineManager.setOnline(true);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.restoreAllMocks();
});

type Org = { files: { status: string }[] };
const files = (a: OfferApp): Org['files'] =>
  (a.scenario.state().orgs[ALTA] as unknown as Org).files;
const vehicleCalls = (a: OfferApp): number =>
  a.responses().filter((r) => r.method === 'GET' && r.path.endsWith('/fleet/vehicles')).length;

function shoot(slot: HTMLElement): void {
  fireEvent.click(slot);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('нет поля выбора файла');
  const f = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [f] } });
}

/** Пять фото осмотра: загрузка, затем проверка файлов сценарным сервером (quarantined → ready). */
async function photos(a: OfferApp): Promise<void> {
  const q = () => files(a).filter((f) => f.status === 'quarantined').length;
  const before = q();
  for (const side of ['Спереди', 'Сзади', 'Слева', 'Справа', 'Одометр']) {
    shoot(screen.getByRole('button', { name: new RegExp(`^${side}: `) }));
  }
  await waitFor(() => expect(q()).toBe(before + 5), SLOW);
  for (const f of files(a)) if (f.status === 'quarantined') f.status = 'ready';
  await screen.findByText('Фото · 5 из 5', undefined, SLOW);
}

const DEP = [
  'Кузов и стёкла осмотрены',
  'Шины и световые приборы исправны',
  'Документы и комплект на месте',
];

function fill(odometer: string, checks: string[]): void {
  fireEvent.change(screen.getByLabelText(/^Пробег по одометру, км/), {
    target: { value: odometer },
  });
  fireEvent.click(screen.getByRole('button', { name: '½' }));
  for (const c of checks) fireEvent.click(screen.getByLabelText(c));
}

const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const card = (model: string): HTMLElement =>
  screen.getByText(model, { selector: '.ox-dr-car-model' }).closest('article') as HTMLElement;
const take = (model: string): HTMLElement =>
  within(card(model)).getByRole('button', { name: 'Взять эту машину' });
const sheet = (): HTMLElement => screen.getByRole('dialog', { name: /^Берёте / });
const noBooking = (): void => {
  expect(screen.queryByRole('button', { name: 'Подтвердить бронь' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Забронировать' })).toBeNull();
};
const chooses = (a: OfferApp) =>
  a.responses().filter((r) => r.method === 'POST' && r.path.endsWith('/choose'));

async function two(): Promise<OfferApp> {
  app = await renderOffer('two');
  await screen.findByRole('heading', { level: 2, name: 'Выберите машину' }, SLOW);
  return app;
}

describe('«Сегодня»: две машины на выбор (1c, 1d, 1e)', () => {
  it('1c: обе предложенные машины, срок выбора, чат рейса без ссылки; брони нет', async () => {
    const a = await two();
    expect(screen.getByText('До 13:30. Вторую бронь снимем сразу после выбора.')).toBeTruthy();
    expect(
      [...document.querySelectorAll('article.ox-dr-offer .ox-dr-car-model')].map(
        (e) => e.textContent,
      ),
    ).toEqual(['Mercedes Sprinter', 'Isuzu Elf']);
    expect(within(card('Mercedes Sprinter')).getByText('Ваша обычная')).toBeTruthy();
    expect(within(card('Isuzu Elf')).getByText('Поставил логист')).toBeTruthy();
    expect(within(card('Isuzu Elf')).getByText('К 120 РУ 77')).toBeTruthy();
    expect(
      within(card('Isuzu Elf')).getByText('Подходит рейсу: масса, объём, длина, температура'),
    ).toBeTruthy();
    expect(
      screen.getByText(`Нужна другая машина — напишите логисту в чат рейса ${a.tripNumber}.`),
    ).toBeTruthy();
    expect(document.querySelector('.ox-dr-trip .ox-dr-chip')?.textContent).toContain(
      'Выберите машину',
    );
    expect(document.querySelectorAll('article')).toHaveLength(2);
    noBooking();
    // Возврат 1: в кадре 1c обычная машина выделена сразу (card() :578–581, pick = 'home' по умолчанию).
    expect(card('Mercedes Sprinter').getAttribute('data-picked')).toBe('true');
    expect(card('Isuzu Elf').getAttribute('data-picked')).toBeNull();
  });

  it('имена машин предложения пишутся в sessionStorage один раз, не на каждой отрисовке смены', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    await two();
    const writes = () =>
      set.mock.calls.filter(([key]) => String(key).startsWith('ortus:driver-offer:')).length;
    await waitFor(() => expect(writes()).toBe(1));
    // Перерисовки смены (связь пропала и вернулась, лист открыт и закрыт) — без новой записи.
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    await waitFor(() => expect((take('Isuzu Elf') as HTMLButtonElement).disabled).toBe(true));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));
    await waitFor(() => expect((take('Isuzu Elf') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(take('Isuzu Elf'));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Назад' }));
    expect(writes()).toBe(1);
  });

  it('1d: лист «Берёте Mercedes Sprinter?» — последствия, фокус, «Назад» и Escape', async () => {
    await two();
    const btn = take('Mercedes Sprinter');
    fireEvent.click(btn);
    const s = sheet();
    expect(within(s).getByRole('heading', { name: 'Берёте Mercedes Sprinter?' })).toBeTruthy();
    expect(within(s).getByText('Т 771 ЕХ 77 · ваша обычная')).toBeTruthy();
    expect(
      within(s)
        .getAllByRole('listitem')
        .map((li) => li.lastElementChild?.textContent),
    ).toEqual([
      'Бронь Isuzu Elf К 120 РУ 77 снимется, машина вернётся в свою фирму.',
      'Дальше осмотр: 5 фото, пробег, топливо и чек-лист.',
      'Осмотр и дефекты увидят фирма рейса и фирма машины.',
      'Поменять машину после выбора может только логист.',
    ]);
    expect(document.activeElement?.textContent).toContain('Взять и начать осмотр');
    expect(card('Mercedes Sprinter').getAttribute('data-picked')).toBe('true');
    fireEvent.click(within(s).getByRole('button', { name: 'Назад' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(take('Mercedes Sprinter'));
    fireEvent.click(take('Isuzu Elf'));
    expect(within(sheet()).getByText('К 120 РУ 77 · поставил логист')).toBeTruthy();
    expect(within(sheet()).getByText('Осмотр увидит фирма рейса.')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Выделена последняя взятая карточка (как pick макета), и после закрытия листа.
    expect(card('Isuzu Elf').getAttribute('data-picked')).toBe('true');
    expect(card('Mercedes Sprinter').getAttribute('data-picked')).toBeNull();
  });

  it('1e: «Взять и начать осмотр» — chooseReservation, тост, осмотр на выбранной, вторая освобождена', async () => {
    const a = await two();
    fireEvent.click(take('Mercedes Sprinter'));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Взять и начать осмотр' }));
    await waitFor(() => expect(toast()).toBe('Бронь подтверждена сервером. Начните осмотр'), SLOW);
    await screen.findByRole('heading', { level: 2, name: 'Осмотр перед выездом' }, SLOW);
    expect(chooses(a).map((r) => r.status)).toEqual([200]);
    const held = document.querySelector('.ox-dr-offer-held');
    expect(held?.getAttribute('role')).toBe('status');
    expect(held?.textContent).toContain('Бронь подтверждена сервером · Mercedes Sprinter до 18:00');
    expect(held?.textContent).toContain('Isuzu Elf К 120 РУ 77 освобождена в 10:30');
    expect(document.querySelector('.ox-dr-insp .ox-dr-sub')?.textContent).toBe(
      'Mercedes Sprinter · Т 771 ЕХ 77 · ваша обычная',
    );
    expect(screen.getByText('Осмотр увидят фирма рейса и фирма машины.')).toBeTruthy();
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe('2Осмотр');
    expect(screen.queryByRole('button', { name: 'Взять эту машину' })).toBeNull();
    noBooking();
  });

  it('офлайн: выбор недоступен с причиной, команды нет; связь вернулась — доступен', async () => {
    const a = await two();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    await waitFor(() => expect((take('Isuzu Elf') as HTMLButtonElement).disabled).toBe(true));
    expect((take('Mercedes Sprinter') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Нет связи: выбор машины требует подтверждения сервера.')).toBeTruthy();
    expect(chooses(a)).toHaveLength(0);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));
    await waitFor(() => expect((take('Isuzu Elf') as HTMLButtonElement).disabled).toBe(false));
  });

  // W2.76 (Q-W2.32-12): «Взять эту машину» недоступна у всех машин — у прокручиваемой области нет цели Tab (axe
  // scrollable-region-focusable); цель — плашка причины с её текстом в имени. Со связью плашки нет.
  it('офлайн: плашка причины — цель Tab с именем; связь вернулась — плашки нет', async () => {
    await two();
    const text = 'Нет связи: выбор машины требует подтверждения сервера.';
    expect(screen.queryByRole('status', { name: text })).toBeNull();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    const note = await screen.findByRole('status', { name: text });
    expect(note.getAttribute('tabindex')).toBe('0');
    expect((take('Isuzu Elf') as HTMLButtonElement).disabled).toBe(true);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(screen.queryByRole('status', { name: text })).toBeNull());
  });

  it('офлайн при открытом листе: «Взять и начать осмотр» недоступна с причиной', async () => {
    await two();
    fireEvent.click(take('Isuzu Elf'));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    const go = within(sheet()).getByRole('button', { name: 'Взять и начать осмотр' });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(true));
    expect(
      within(sheet()).getByText('Нет связи: выбор машины требует подтверждения сервера.'),
    ).toBeTruthy();
  });

  it('409 offer_closed: сообщение, лист закрыт, смена перечитана — машина логиста на сегодня', async () => {
    const a = await two();
    fireEvent.click(take('Mercedes Sprinter'));
    a.scenario.setNow(AFTER_DEADLINE);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Взять и начать осмотр' }));
    const alert = await screen.findByText(
      'Выбор машины уже закрыт: срок прошёл или машина выбрана. Обновите смену.',
      undefined,
      SLOW,
    );
    expect(alert.closest('[role="alert"]')).toBeTruthy();
    expect(chooses(a).map((r) => r.status)).toEqual([409]);
    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByRole('heading', { level: 2, name: 'Машина на сегодня' }, SLOW);
    expect(
      [...document.querySelectorAll('article.ox-dr-offer .ox-dr-car-model')].map(
        (e) => e.textContent,
      ),
    ).toEqual(['Isuzu Elf']);
    noBooking();
  });
});

describe('«Сегодня»: ошибка списка броней временного рейса', () => {
  it('listReservations 429: «Не удалось загрузить смену» и «Повторить» (повтор listReservations), не W2.22', async () => {
    const a = await renderOffer('two', { scenario: 'listReservations=rate_limited' });
    app = a;
    const err = await screen.findByText(
      'Не удалось загрузить смену: Слишком много запросов. Подождите и повторите.',
      undefined,
      SLOW,
    );
    expect(err.closest('[role="alert"]')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Выберите машину' })).toBeNull();
    noBooking();
    a.scenario.setScenario(null);
    const before = a.responses().filter((r) => r.path.endsWith('/fleet/reservations')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('heading', { level: 2, name: 'Выберите машину' }, SLOW);
    expect(
      a.responses().filter((r) => r.path.endsWith('/fleet/reservations')).length,
    ).toBeGreaterThan(before);
    noBooking();
  });
});

describe('«Сегодня»: одна машина и машины нет', () => {
  it('одна машина: «Машина на сегодня» без подтверждения, «Начать осмотр» → осмотр со статусом брони', async () => {
    app = await renderOffer('one');
    await screen.findByRole('heading', { level: 2, name: 'Машина на сегодня' }, SLOW);
    expect(
      screen.getByText(
        'Логист поставил машину при согласовании. Подтверждать бронь не нужно: первый снимок осмотра закрепит её за вами.',
      ),
    ).toBeTruthy();
    expect(document.querySelector('.ox-dr-trip .ox-dr-chip')?.textContent).toContain(
      'Машина назначена',
    );
    // Возврат 1: у карточки «Машина на сегодня» (:281–290) строки «Подходит рейсу …» нет.
    expect(within(card('Isuzu Elf')).getByText('К 120 РУ 77')).toBeTruthy();
    expect(within(card('Isuzu Elf')).queryByText(/^Подходит рейсу/)).toBeNull();
    noBooking();
    fireEvent.click(within(card('Isuzu Elf')).getByRole('button', { name: 'Начать осмотр' }));
    await screen.findByRole('heading', { level: 2, name: 'Осмотр перед выездом' }, SLOW);
    expect(document.querySelector('.ox-dr-offer-held')?.textContent).toContain(
      'Бронь подтверждена сервером · Isuzu Elf до 18:00',
    );
    expect(screen.getByText('Осмотр увидит фирма рейса.')).toBeTruthy();
    expect(chooses(app)).toHaveLength(0);
  });

  it('машины нет: «Машину ещё не поставили», без «Написать логисту» и без машин', async () => {
    app = await renderOffer('none');
    await screen.findByText('Машину ещё не поставили', undefined, SLOW);
    expect(
      screen.getByText(
        'Ваша фирма выдала вас на рейс без обычной машины. Логист фирмы рейса поставит машину, придёт уведомление.',
      ),
    ).toBeTruthy();
    expect(document.querySelector('.ox-dr-trip .ox-dr-chip')?.textContent).toContain('Ждёт машину');
    expect(screen.queryByRole('button', { name: 'Написать логисту' })).toBeNull();
    expect(document.querySelectorAll('article')).toHaveLength(0);
    noBooking();
  });
});

describe('«Автомобили» временного водителя', () => {
  it('только предложенные машины, без «Забронировать» и «Подтвердить бронь»', async () => {
    const a = await renderOffer('two', { route: 'cars' });
    app = a;
    await screen.findByRole('heading', { level: 1, name: 'Автомобили' }, SLOW);
    await waitFor(
      () =>
        expect(
          [...document.querySelectorAll('.ox-dr-car-model')].map((e) => e.textContent),
        ).toEqual(['Mercedes Sprinter', 'Isuzu Elf']),
      SLOW,
    );
    noBooking();
    // Возврат 1 (Q-W2.74-8): пояснение — о машинах рейса, не «машины вашей фирмы … Бронь подтверждает сервер.»;
    // фильтра нет — «Свободны» у временного водителя всегда пусто (предложенные машины держатся за ним).
    expect(
      screen.getByText(
        `Машины рейса ${a.tripNumber}: только предложенные вам. Выбор и осмотр — на «Моей смене».`,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText('Машины вашей фирмы и их состояние. Бронь подтверждает сервер.'),
    ).toBeNull();
    expect(screen.queryByRole('group', { name: 'Фильтр' })).toBeNull();
  });

  it('ошибка listReservations (429): «Не удалось загрузить машины» и «Повторить», не «По фильтру машин нет»', async () => {
    const a = await renderOffer('two', {
      route: 'cars',
      scenario: 'listReservations=rate_limited',
    });
    app = a;
    const err = await screen.findByText(
      'Не удалось загрузить машины: Слишком много запросов. Подождите и повторите.',
      undefined,
      SLOW,
    );
    expect(err.closest('[role="alert"]')).toBeTruthy();
    expect(screen.queryByText('По фильтру машин нет')).toBeNull();
    expect(document.querySelectorAll('.ox-dr-car-model')).toHaveLength(0);
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(
      () =>
        expect(
          [...document.querySelectorAll('.ox-dr-car-model')].map((e) => e.textContent),
        ).toEqual(['Mercedes Sprinter', 'Isuzu Elf']),
      SLOW,
    );
    noBooking();
  });

  it('машины нет: «Машину ещё не поставили», не «По фильтру машин нет»', async () => {
    app = await renderOffer('none', { route: 'cars' });
    await screen.findByText('Машину ещё не поставили', undefined, SLOW);
    expect(screen.queryByText('По фильтру машин нет')).toBeNull();
    expect(document.querySelectorAll('article')).toHaveLength(0);
    noBooking();
  });

  it('продолжение (Q-W2.61-2): рейс начат, listVehicles 403 — без ошибки и без запроса списка машин', async () => {
    const a = await renderOffer('one', { now: IN_WINDOW });
    app = a;
    await screen.findByRole('heading', { level: 2, name: 'Машина на сегодня' }, SLOW);
    fireEvent.click(within(card('Isuzu Elf')).getByRole('button', { name: 'Начать осмотр' }));
    await screen.findByRole('heading', { level: 2, name: 'Осмотр перед выездом' }, SLOW);
    await photos(a);
    fill('150000', DEP);
    fireEvent.click(screen.getByRole('button', { name: 'Выехать на маршрут' }));
    await screen.findByRole('heading', { level: 2, name: 'Маршрут' }, SLOW);
    // После срока (D09) список машин временному водителю закрыт — сценарий отвечает 403, как стенд.
    a.scenario.setScenario('listVehicles=forbidden_action');
    const before = vehicleCalls(a);
    await a.router.navigate({ to: `/t/${ALTA}/cars` });
    await screen.findByRole('heading', { level: 1, name: 'Автомобили' }, SLOW);
    await screen.findByText('Машина рейса — на «Моей смене»', undefined, SLOW);
    expect(
      screen.getByText(
        `Рейс ${a.tripNumber} уже в работе: машина, маршрут и сдача — на «Моей смене». Других машин временному водителю не показывают.`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/^Не удалось загрузить машины/)).toBeNull();
    expect(screen.queryByText('По фильтру машин нет')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Фильтр' })).toBeNull();
    expect(vehicleCalls(a)).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть «Мою смену»' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/today`), SLOW);
    await screen.findByRole('heading', { level: 2, name: 'Маршрут' }, SLOW);
  });
});
