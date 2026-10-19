// W2.24 · Экранные тесты «Сегодня» без связи на MSW-сценарном сервере (пресет logistics-ready, Илья Васильев, Р-208;
// эталон photoVM :3391, saveExp :2616–2629, submitRet :2597–2606, dr.sQueued :822–829, bannersVM :3093–3095, flush
// :2527–2551): фото осмотра — «На устройстве · ждёт связи», черновик осмотра на устройстве, расход и сдача на
// устройстве, баннеры «(ожидают отправки: N)» и «Связь восстановлена.», отправка при появлении связи, ошибка и
// «Повторить». Связь — navigator.onLine и события online/offline (как context.setOffline e2e).
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../../app/testing.tsx';
import { memoryStore, outboxKey, scopeKey, setDeviceStore } from '../../../../pwa/store.ts';
import { transport } from '../photos.ts';
import {
  ALTA,
  card,
  choose,
  closeApp,
  depart,
  DEP,
  expensesOf,
  fill,
  open,
  quarantined,
  RET,
  reserveGazel,
  revisit,
  scan,
  setOnline,
  SIDES,
  SLOW,
  toast,
  trip208,
} from './fixtures.test-util.ts';
import { resetOutboxes } from './hooks.ts';

vi.setConfig({ testTimeout: 40_000 });

const realPut = transport.put;
const realPoll = transport.pollMs;
let app: MockApp | undefined;

beforeEach(async () => {
  setDeviceStore(memoryStore());
  await resetOutboxes();
  transport.put = async (_url, _file, _type, _signal, onProgress) => {
    onProgress?.(50, 100);
  };
  transport.pollMs = 15;
});
afterEach(async () => {
  setOnline(true);
  closeApp(app);
  app = undefined;
  await resetOutboxes();
  setDeviceStore(null);
  transport.put = realPut;
  transport.pollMs = realPoll;
  onlineManager.setOnline(true);
});

const uploads = (a: MockApp) => a.responses().filter((r) => r.path.endsWith('/files/uploads'));

/** Сканирует загруженные файлы, пока `done` не выполнится (очередь грузит фото по одному). */
async function scanUntil(a: MockApp, done: () => void): Promise<void> {
  await waitFor(
    () => {
      scan(a);
      done();
    },
    { timeout: 20_000, interval: 50 },
  );
}

async function addExpenseOffline(a: MockApp): Promise<void> {
  const before = uploads(a).length;
  fireEvent.click(screen.getByRole('button', { name: 'Добавить расход' }));
  fireEvent.change(screen.getByLabelText('Категория'), { target: { value: 'wash' } });
  fireEvent.change(screen.getByLabelText(/^Сумма, ₽/), { target: { value: '400' } });
  choose(screen.getByRole('button', { name: /^Чек: / }), 'receipt.jpg');
  await screen.findByText('На устройстве · ждёт связи', undefined, SLOW);
  expect(uploads(a)).toHaveLength(before);
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить на устройстве' }));
  await waitFor(
    () => expect(toast()).toBe('Расход сохранён на устройстве. Отправится при появлении связи'),
    SLOW,
  );
}

/** Строка расхода по подписи «{категория} · {сумма}». */
const expenseRow = (title: string): HTMLElement => {
  const el = screen.getByText(title, { selector: '.ox-dr-exp-title' }).closest('.ox-dr-exp');
  if (!el) throw new Error(`нет строки расхода ${title}`);
  return el as HTMLElement;
};

describe('«Сегодня» без связи: фото и черновик осмотра', () => {
  it('фото без связи — «На устройстве · ждёт связи», «Фото · 1 из 5», выезд недоступен; связь — загрузка', async () => {
    app = await open();
    const a = app;
    await reserveGazel();
    setOnline(false);
    choose(screen.getByRole('button', { name: /^Спереди: / }));
    await screen.findByText('На устройстве · ждёт связи', undefined, SLOW);
    expect(screen.getByText('Фото · 1 из 5')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Спереди: На устройстве · ждёт связи. Нажмите, чтобы снять или выбрать фото',
      }),
    ).toBeTruthy();
    expect(uploads(a)).toEqual([]);
    expect(
      screen.getByText(
        'Нет связи: выезд требует подтверждения сервера. Черновик сохранён на устройстве.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выехать на маршрут' })).toHaveProperty(
      'disabled',
      true,
    );
    setOnline(true);
    await waitFor(() => expect(quarantined(a)).toBe(1), SLOW);
    scan(a);
    await screen.findByText('Загружено', undefined, SLOW);
    expect(screen.queryByText('На устройстве · ждёт связи')).toBeNull();
  });

  it('черновик осмотра на устройстве: после ухода со страницы — фото, пробег и чек-лист на месте', async () => {
    app = await open();
    const a = app;
    await reserveGazel();
    setOnline(false);
    choose(screen.getByRole('button', { name: /^Спереди: / }));
    await screen.findByText('На устройстве · ждёт связи', undefined, SLOW);
    fill('84500', DEP.slice(0, 1));
    // Черновик пишется на устройство с задержкой — ждём перед уходом.
    await new Promise((r) => setTimeout(r, 600));
    await revisit(a);
    await screen.findByText('На устройстве · ждёт связи', undefined, SLOW);
    expect((screen.getByLabelText(/^Пробег по одометру, км/) as HTMLInputElement).value).toBe(
      '84500',
    );
    expect((screen.getByLabelText(DEP[0] ?? '') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: '½' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('«Сегодня» без связи: расход на устройстве', () => {
  it('«Сохранить на устройстве», «Локальный черновик», «На устройстве», баннер; связь — «принято сервером»', async () => {
    app = await open();
    const a = app;
    await depart(a);
    setOnline(false);
    await addExpenseOffline(a);
    const row = expenseRow('Мойка · 400 ₽');
    expect(row.textContent).toContain('Локальный черновик');
    expect(row.textContent).toContain('На устройстве');
    expect(screen.getByText(/ожидают отправки: 1/)).toBeTruthy();
    expect(
      a.responses().filter((r) => r.path.endsWith('/expenses') && r.method === 'POST'),
    ).toEqual([]);

    setOnline(true);
    await screen.findByText('Связь восстановлена.', undefined, SLOW);
    expect(screen.getByText('Отправляем сохранённые на устройстве операции…')).toBeTruthy();
    await scanUntil(a, () => expect(expensesOf(a)).toHaveLength(1));
    await waitFor(() => expect(toast()).toBe('Мойка 400 ₽ — принято сервером'), SLOW);
    await waitFor(() =>
      expect(expenseRow('Мойка · 400 ₽').textContent).toContain('Принято сервером'),
    );
    expect(screen.queryByText('Локальный черновик')).toBeNull();
    expect(screen.queryByText('Связь восстановлена.')).toBeNull();
  });

  it('ошибка сервера: «Ошибка», тост «{операция}: {сообщение}»; «Повторить» — расход принят один раз', async () => {
    app = await open();
    const a = app;
    await depart(a);
    setOnline(false);
    await addExpenseOffline(a);
    a.scenario.setScenario('createTripExpense=validation_failed');
    setOnline(true);
    await scanUntil(a, () =>
      expect(within(expenseRow('Мойка · 400 ₽')).getByText('Ошибка')).toBeTruthy(),
    );
    await waitFor(() => expect(toast()).toMatch(/^Мойка 400 ₽: /), SLOW);
    a.scenario.setScenario(null);
    fireEvent.click(within(expenseRow('Мойка · 400 ₽')).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(toast()).toBe('Мойка 400 ₽ — принято сервером'), SLOW);
    expect(expensesOf(a)).toHaveLength(1);
  });
});

async function toReturn(a: MockApp): Promise<void> {
  await depart(a);
  fireEvent.click(screen.getByRole('button', { name: 'Завершить рейс' }));
  const dialog = await screen.findByRole('dialog', undefined, SLOW);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Завершить рейс' }));
  await screen.findByRole('heading', { level: 2, name: 'Осмотр при сдаче' }, SLOW);
}

async function returnOffline(a: MockApp): Promise<number> {
  setOnline(false);
  const before = uploads(a).length;
  for (const side of SIDES) choose(screen.getByRole('button', { name: new RegExp(`^${side}: `) }));
  await screen.findByText('Фото · 5 из 5', undefined, SLOW);
  fill('84560', RET);
  expect(
    screen.getByText(
      'Нет связи: сдача сохранится на устройстве и отправится позже. До подтверждения сервера машина не считается сданной.',
    ),
  ).toBeTruthy();
  const save = screen.getByRole('button', { name: 'Сохранить сдачу на устройстве' });
  expect(save).toHaveProperty('disabled', false);
  fireEvent.click(save);
  await waitFor(
    () => expect(toast()).toBe('Сдача сохранена на устройстве и ещё не принята сервером'),
    SLOW,
  );
  return before;
}

describe('«Сегодня» без связи: сдача на устройстве', () => {
  it('«Сохранить сдачу на устройстве» → карточка «Сдача сохранена на устройстве»; связь → «Ожидает приёмки»', async () => {
    app = await open();
    const a = app;
    await toReturn(a);
    const before = await returnOffline(a);
    const card = (
      await screen.findByRole(
        'heading',
        {
          level: 2,
          name: 'Сдача сохранена на устройстве',
        },
        SLOW,
      )
    ).closest('[role="status"]') as HTMLElement;
    expect(card.textContent).toContain(
      'Сервер ещё не принял сдачу, поэтому машина не считается сданной. Отправка начнётся автоматически, когда появится связь.',
    );
    expect(within(card).getByText('Ожидает отправки')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Осмотр при сдаче' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Расходы' })).toBeNull();
    expect(uploads(a)).toHaveLength(before);
    expect(trip208(a).state).toBe('returning');

    setOnline(true);
    await scanUntil(a, () => expect(trip208(a).state).toBe('submitted'));
    await waitFor(() => expect(toast()).toBe('Сдача машины — принято сервером'), SLOW);
    await screen.findByRole('heading', { level: 2, name: 'Ожидает приёмки менеджером' }, SLOW);
  });

  // Возврат 1 (стенд, api.log): после отправки сдачи из очереди черновик осмотра при сдаче ещё держал фото «На
  // устройстве» — до перечитывания рейса они загружались второй раз (5 лишних файлов в квоте организации).
  it('сдача из очереди: фото уходят один раз — черновик не загружает их повторно', async () => {
    app = await open();
    const a = app;
    await toReturn(a);
    const before = await returnOffline(a);
    setOnline(true);
    await scanUntil(a, () => expect(trip208(a).state).toBe('submitted'));
    await screen.findByRole('heading', { level: 2, name: 'Ожидает приёмки менеджером' }, SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(uploads(a).length - before).toBe(5);
  });

  it('ошибка отправки сдачи: «Ошибка отправки: …» и «Повторить»', async () => {
    app = await open();
    const a = app;
    await toReturn(a);
    await returnOffline(a);
    a.scenario.setScenario('submitInspection=validation_failed');
    setOnline(true);
    const chip = await screen.findByText(/^Ошибка отправки: /, undefined, { timeout: 20_000 });
    expect(chip).toBeTruthy();
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await scanUntil(a, () => expect(trip208(a).state).toBe('submitted'));
    await screen.findByRole('heading', { level: 2, name: 'Ожидает приёмки менеджером' }, SLOW);
  });
});

// Возврат 2 (minor ревью и проверяющего): черновик восстанавливался после первого кадра осмотра — мелькали «Фото · 0
// из 5» и пустой пробег, а правка в это окно выбрасывала черновик с устройства. Осмотр показывается после чтения
// черновика, до этого — скелетон.
describe('«Сегодня»: осмотр — после восстановления черновика с устройства', () => {
  it('пока черновик читается с устройства — скелетон, без «Фото · 0 из 5» и поля пробега', async () => {
    const mem = memoryStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held = false;
    setDeviceStore({
      ...mem,
      get: async <T,>(key: string) => {
        if (key.startsWith('draft:')) {
          held = true;
          await gate;
        }
        return mem.get<T>(key);
      },
    });
    app = await open();
    await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
    fireEvent.click(within(card('ГАЗель Next')).getByRole('button', { name: 'Забронировать' }));
    await waitFor(() => expect(held).toBe(true), SLOW);
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText(/^Фото · \d из 5$/)).toBeNull();
    expect(screen.queryByLabelText(/^Пробег по одометру, км/)).toBeNull();
    release();
    await screen.findByRole('heading', { level: 2, name: 'Осмотр перед выездом' }, SLOW);
    expect(screen.getByText('Фото · 0 из 5')).toBeTruthy();
  });
});

// Возврат 2 (minor ревью и проверяющего pwa-install): перезапуск без связи — /me/context не приходит, оболочка
// висела на «Загрузка…» без баннера. Теперь кадр загрузки без связи — баннер «Нет связи.» эталона с числом
// ожидающих на устройстве и «Нет связи» в шапке; связь появилась — смена открывается сама.
describe('перезапуск без связи', () => {
  it('кадр загрузки без связи: «Нет связи.» с «(ожидают отправки: N)»; связь — «Моя смена»', async () => {
    const mem = memoryStore();
    setDeviceStore(mem);
    await mem.set(outboxKey(scopeKey(ALTA, 'u-before-restart')), [{ id: 'x' }, { id: 'y' }]);
    setOnline(false);
    onlineManager.setOnline(false);
    app = await renderMockApp(`/t/${ALTA}/today`, { persona: 'driver', preset: 'logistics-ready' });
    await waitFor(
      () =>
        expect(document.querySelector('.ox-banner .ox-banner-body')?.textContent).toBe(
          'Нет связи. Черновики, фото и расходы сохраняются на устройстве (ожидают отправки: 2). Бронь, выезд и приёмка требуют подтверждения сервера.',
        ),
      SLOW,
    );
    expect(document.querySelector('.ox-offline-pill')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: 'Моя смена' })).toBeNull();
    setOnline(true);
    onlineManager.setOnline(true);
    await screen.findByRole('heading', { level: 1, name: 'Моя смена' }, SLOW);
  });
});

describe('«Сегодня» без связи: только онлайн', () => {
  it('бронь и выезд без связи недоступны, очередь их не сохраняет (D-09)', async () => {
    app = await open();
    await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
    setOnline(false);
    expect(await screen.findByText('Нет связи: бронь требует подтверждения сервера.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Забронировать' })).toBeNull();
    expect(
      within(card('ГАЗель Next')).getByRole('button', { name: 'Бронь недоступна' }),
    ).toHaveProperty('disabled', true);
  });
});
