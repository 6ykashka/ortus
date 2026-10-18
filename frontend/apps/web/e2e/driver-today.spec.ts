// W2.22 · e2e страницы `driver-today` «Сегодня» (h1 «Моя смена»; эталон design-stage-2, «Ортус CRM.dc.html»
// pg.today :663–848, driverVM :3422; 03-logistics.md §8, §10, §14 п. 18–40). Путь водителя целиком: бронь, осмотр с
// пятью фото (сессии загрузки), выезд, маршрут, расходы, сдача, доработка и приёмка менеджером; состояния, офлайн,
// клавиатура, axe, 390. Решения менеджера — его командами API из той же вкладки (сценарный сервер mock).
import type { Persona } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import {
  actionBar,
  carCard,
  choosePhoto,
  DEP_CHECKS,
  depart,
  fillInspection,
  finishDialog,
  fivePhotos,
  openDriver,
  RET_CHECKS,
  reserve,
  scanUntil,
  SIDES,
} from './driver.helpers.ts';
import {
  heicWithGps,
  leaks,
  withGps,
} from '../src/routes/core/files/upload/metadata.fixtures.test-util.ts';
import { expect, test } from './_stand/fixtures.ts';
import {
  apiReturn,
  approve,
  closeTrip,
  driverTrip,
  GAZEL,
  jpeg,
  label,
  logisticsOn,
  NO_STORAGE,
  persona,
  realClock,
  reservationOf,
  shoot,
  storageReachable,
  vehicle,
} from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { call, devScenario, setModule, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;
const steps = (page: Page) => page.getByRole('list', { name: 'Этапы смены' });
const current = (page: Page) => steps(page).locator('[aria-current="step"]');
const h2 = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });

/** Команды менеджера (Котова): вход менеджера в той же вкладке, затем снова водитель на «Сегодня». */
async function asManager(
  app: AppFn,
  page: Page,
  tenant: string,
  fn: () => Promise<void>,
): Promise<void> {
  await app('/', { persona: 'manager' });
  await fn();
  await app(`/t/${tenant}/today`, { persona: 'driver' });
  await expect(h1(page, 'Моя смена')).toBeVisible();
}

interface Item {
  id: string;
  revision: number;
  number?: string;
}

async function tripP208(page: Page, tenant: string): Promise<Item> {
  const r = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans?limit=100`);
  const t = (r.body as { items: Item[] }).items.find((x) => x.number === 'Р-208');
  if (!t) throw new Error('нет Р-208');
  return t;
}

async function reviewTrip(page: Page, tenant: string, body: unknown): Promise<void> {
  const t = await tripP208(page, tenant);
  const r = await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/trips/${t.id}/review`, {
    body,
    ifMatch: `"rev-${String(t.revision)}"`,
  });
  expect(r.status).toBe(200);
}

/** Настоящий JPEG `w`×`h` с холста страницы (без метаданных: геоданные добавляет `withGps`). */
async function canvasJpeg(page: Page, w: number, h: number): Promise<Uint8Array<ArrayBuffer>> {
  const b64 = await page.evaluate(
    ([width, height]) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const g = c.getContext('2d');
      if (!g) return '';
      g.fillStyle = '#3b7d6e';
      g.fillRect(0, 0, width, height);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1] ?? '';
    },
    [w, h] as const,
  );
  if (!b64) throw new Error('canvas: нет 2d-контекста');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Размер изображения, как его декодирует браузер. */
async function decodedSize(page: Page, jpeg: Uint8Array): Promise<[number, number]> {
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    return [bmp.width, bmp.height] as [number, number];
  }, Buffer.from(jpeg).toString('base64'));
}

/** «Завершить рейс» → подтверждение → «Осмотр при сдаче». */
async function finishRoute(page: Page): Promise<void> {
  await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await finishDialog(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await expect(h2(page, 'Осмотр при сдаче')).toBeVisible();
}

/** Осмотр при сдаче и «Сдать машину» → «Ожидает приёмки менеджером». */
async function handOver(page: Page, odometer: string): Promise<void> {
  await fivePhotos(page);
  await fillInspection(page, odometer, RET_CHECKS);
  await actionBar(page).getByRole('button', { name: 'Сдать машину' }).click();
  await expect(h2(page, 'Ожидает приёмки менеджером')).toBeVisible();
}

test.describe('driver-today — «Моя смена» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  // Путь с пятью загрузками и проверкой файлов — дольше 30 с под нагрузкой общего ПК.
  test.describe.configure({ timeout: 90_000 });

  test('меню «Сегодня» и прямой URL: крошка, «Моя смена», этапы, карточка рейса Р-208', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'cars');
    if (phone(page)) {
      await page
        .getByRole('navigation', { name: 'Навигация', exact: true })
        .getByRole('button', { name: 'Сегодня' })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('button', { name: 'Сегодня' })
        .click();
    }
    await expect(page).toHaveURL(/\/today$/);
    await expect(h1(page, 'Моя смена')).toBeVisible();
    await expect(page.getByText('Илья Васильев · четверг, 1 октября')).toBeVisible();
    await expect(steps(page).getByRole('listitem')).toHaveText([
      '1Машина',
      '2Осмотр',
      '3Рейс',
      '4Сдача',
      '5Приёмка',
    ]);
    await expect(current(page)).toHaveText('1Машина');
    await expect(page.getByText('Р-208 · Северный маршрут')).toBeVisible();
    await expect(
      page.getByText('01.10.2026 · 09:00–13:00 · 3 точки · 46 км · Сухой груз · 14 паллет-мест'),
    ).toBeVisible();
    await page.reload();
    await expect(h1(page, 'Моя смена')).toBeVisible();
    await expect(h2(page, 'Выберите машину')).toBeVisible();
  });

  test('машины рейса: «Забронировать», причины несовместимости, «Недоступна»', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await expect(page.locator('.ox-dr-car-model').first()).toHaveText('ГАЗель Next');
    await expect(carCard(page, 'ГАЗель Next')).toContainText(
      'Подходит рейсу: масса, объём, длина и температура',
    );
    await expect(
      carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }),
    ).toBeEnabled();
    await expect(carCard(page, 'Ford Transit')).toContainText('Объём: 11 м³, нужно от 12 м³');
    await expect(
      carCard(page, 'Ford Transit').getByRole('button', { name: 'Не подходит рейсу' }),
    ).toBeDisabled();
    await expect(carCard(page, 'ГАЗон Next')).toContainText(
      'Доступность: Недоступна · Плановое ТО до 03.10',
    );
  });

  test('«Забронировать»: тост, бронь «держится до», шаг «Осмотр»; «Отменить бронь» водителю нет', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await expect(toast(page)).toHaveText('Бронь подтверждена сервером. Начните осмотр');
    await expect(
      page.getByText('Бронь подтверждена сервером · ГАЗель Next А 412 МР 77 · держится до 11:00'),
    ).toBeVisible();
    await expect(current(page)).toHaveText('2Осмотр');
    await expect(page.getByRole('button', { name: 'Отменить бронь' })).toHaveCount(0);
  });

  test('конфликт брони 409: «Конфликт брони», «Обновить список», «Список обновлён»', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today', { scenario: 'reserveVehicle=reservation_overlap' });
    await carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }).click();
    const alert = page.locator('.ox-dr').getByRole('alert');
    await expect(alert).toContainText('Конфликт брони');
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Обновить список' }).click();
    await expect(toast(page)).toHaveText('Список обновлён');
    await expect(page.getByText('Конфликт брони')).toHaveCount(0);
  });

  test('нет связи: бронь недоступна с пояснением', async ({ app, page }) => {
    await openDriver(app, page, 'today');
    await expect(carCard(page, 'ГАЗель Next')).toBeVisible();
    await page.context().setOffline(true);
    await expect(page.getByText('Нет связи: бронь требует подтверждения сервера.')).toBeVisible();
    await expect(
      carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Бронь недоступна' }),
    ).toBeDisabled();
    await page.context().setOffline(false);
    await expect(
      carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }),
    ).toBeEnabled();
  });

  test('осмотр: «Фото · 0 из 5», пять слотов, «Осталось: …», выезд недоступен', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await expect(page.getByText('Фото · 0 из 5')).toBeVisible();
    await expect(page.locator('.ox-dr-slot')).toHaveCount(5);
    await expect(actionBar(page)).toContainText(
      'Осталось: 5 фото, пробег, уровень топлива, 3 пункта чек-листа',
    );
    await expect(
      actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }),
    ).toBeDisabled();
  });

  test('фото: сессия загрузки → «Загружено», «Фото · 5 из 5»; пробег и чек-лист → выезд доступен', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await fivePhotos(page);
    await expect(page.locator('.ox-dr-slot-status').filter({ hasText: 'Загружено' })).toHaveCount(
      5,
    );
    const odo = page.getByLabel(/^Пробег по одометру, км/);
    await odo.fill('84000');
    await expect(page.getByText('Пробег не может быть меньше 84 370 км')).toBeVisible();
    await expect(odo).toHaveAttribute('aria-invalid', 'true');
    await odo.fill('90000');
    await expect(
      page.getByText('Больше начального на 5 630 км — проверьте показания'),
    ).toBeVisible();
    await fillInspection(page, '84500', DEP_CHECKS);
    await expect(page.getByText('Последний зафиксированный пробег: 84 370 км')).toBeVisible();
    await expect(actionBar(page)).not.toContainText('Осталось');
    await expect(actionBar(page).getByRole('button', { name: 'Выехать на маршрут' })).toBeEnabled();
  });

  test('сбой загрузки фото: «Ошибка загрузки», «Повторить» загружает снова', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await page
      .context()
      .route('https://storage.example.invalid/**', (r) => r.fulfill({ status: 500 }));
    await choosePhoto(page, page.getByRole('button', { name: /^Спереди: / }));
    await expect(page.getByText('Ошибка загрузки')).toBeVisible();
    await expect(toast(page)).toHaveText('Загрузка прервалась. Повторите попытку.');
    await page.context().unroute('https://storage.example.invalid/**');
    await page
      .context()
      .route('https://storage.example.invalid/**', (r) => r.fulfill({ status: 200 }));
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await scanUntil(page, page.getByText('Фото · 1 из 5'));
  });

  // W2.44 (модель данных 4, ПДн §6; D-08): геоданные вырезаются на клиенте до PUT. JPEG декодирует холст —
  // сжатие до 1600 px; HEIC Chromium не декодирует — вырезание из байтов без сжатия.
  test('фото с геоданными: тело PUT без GPS; JPEG 4000×3000 → 1600×1200, HEIC — без GPS', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    const sent: Uint8Array<ArrayBuffer>[] = [];
    await page.context().route('https://storage.example.invalid/**', async (r) => {
      const body = r.request().postDataBuffer();
      if (body) sent.push(new Uint8Array(body));
      await r.fulfill({ status: 200 });
    });
    const upload = async (side: string, name: string, mimeType: string, buffer: Uint8Array) => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: new RegExp(`^${side}: `) }).click();
      await (await chooser).setFiles({ name, mimeType, buffer: Buffer.from(buffer) });
    };

    const gpsJpeg = withGps(await canvasJpeg(page, 4000, 3000));
    expect(leaks(gpsJpeg)).toEqual(['WGS-84-SECRET', 'exif:GPSLatitude']);
    await upload('Спереди', 'front.jpg', 'image/jpeg', gpsJpeg);
    await expect.poll(() => sent.length).toBe(1);
    expect(leaks(sent[0] ?? gpsJpeg)).toEqual([]);
    expect(await decodedSize(page, sent[0] ?? gpsJpeg)).toEqual([1600, 1200]);

    const heic = heicWithGps().bytes;
    await upload('Сзади', 'IMG_0001.HEIC', 'image/heic', heic);
    await expect.poll(() => sent.length).toBe(2);
    expect(leaks(sent[1] ?? heic)).toEqual([]);
    expect(sent[1]?.length).toBe(heic.length);
    await scanUntil(page, page.getByText('Фото · 2 из 5'));
  });

  // W2.53: ручной режим mock (показ без e2e, Q-W2.90-4): хранилище mock вкладки принимает PUT по билету, проверка
  // файла завершается сама — без маршрута контекста и без scanFiles. Под Playwright (navigator.webdriver) оно выключено
  // по умолчанию, поэтому строка включает его так же, как проверяющий через MCP, — sessionStorage `ortus:msw:storage`.
  test('ручной режим mock: пять фото без маршрута хранилища и scanFiles — «Фото · 5 из 5»', async ({
    app,
    page,
  }) => {
    await page.addInitScript(() => sessionStorage.setItem('ortus:msw:storage', 'on'));
    const network: string[] = [];
    await page.context().route('https://storage.example.invalid/**', (r) => {
      network.push(r.request().url());
      return r.abort();
    });
    await app('/', { persona: 'driver' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/today`, { persona: 'driver' });
    await reserve(page);
    for (const side of SIDES) {
      await choosePhoto(page, page.getByRole('button', { name: new RegExp(`^${side}: `) }));
    }
    await expect(page.getByText('Фото · 5 из 5')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.ox-dr-slot-status').filter({ hasText: 'Загружено' })).toHaveCount(
      5,
    );
    expect(network, 'PUT обслужило хранилище mock вкладки, а не сеть').toEqual([]);
  });

  test('дефект: «Опишите дефект», строка дефекта, «Удалить дефект»', async ({ app, page }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await page.getByRole('button', { name: 'Добавить дефект' }).click();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.locator('.ox-dr-insp').getByRole('alert')).toHaveText('Опишите дефект');
    await page.getByLabel('Где').selectOption('Кузов');
    await page.getByLabel(/^Описание/).fill('Царапина на двери');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.locator('.ox-dr-defect-row')).toContainText('Царапина на двери');
    await page.getByRole('button', { name: 'Удалить дефект' }).click();
    await expect(page.locator('.ox-dr-defect-row')).toHaveCount(0);
    await expect(page.getByText('Не отмечены')).toBeVisible();
  });

  test('критический дефект → «Выезд заблокирован»; менеджер разрешил → «Выехать на маршрут»', async ({
    app,
    page,
  }) => {
    const tenant = await openDriver(app, page, 'today');
    await reserve(page);
    await fivePhotos(page);
    await fillInspection(page, '84500', DEP_CHECKS);
    await page.getByRole('button', { name: 'Добавить дефект' }).click();
    await page.getByLabel('Где').selectOption('Стёкла');
    await page.getByLabel(/^Описание/).fill('Скол');
    await page.getByLabel('Критический — машина не может выехать').check();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(actionBar(page)).toContainText(
      'Отмечен критический дефект. Выезд будет заблокирован, осмотр уйдёт менеджеру.',
    );
    await actionBar(page).getByRole('button', { name: 'Отправить на проверку менеджеру' }).click();
    await expect(toast(page)).toHaveText('Выезд заблокирован: дефект отправлен менеджеру');
    await expect(h2(page, 'Выезд заблокирован')).toBeVisible();
    await expect(
      page.getByText(
        'Критический дефект «Стёкла: Скол» отправлен менеджеру на проверку. Машина недоступна для выезда.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Выбрать другую машину' })).toHaveCount(0);

    await asManager(app, page, tenant, async () => {
      const list = await call(
        page,
        'GET',
        `/api/v1/tenants/${tenant}/fleet/defects?state=in_review&limit=100`,
      );
      const d = (list.body as { items: Item[] }).items[0];
      if (!d) throw new Error('нет дефекта на проверке');
      const r = await call(
        page,
        'POST',
        `/api/v1/tenants/${tenant}/fleet/defects/${d.id}/decision`,
        {
          body: { decision: 'allow_departure' },
          ifMatch: `"rev-${String(d.revision)}"`,
        },
      );
      expect(r.status).toBe(200);
    });
    await expect(
      page.getByText('Менеджер разрешил выезд: дефект признан некритичным'),
    ).toBeVisible();
    await expect(h2(page, 'Осмотр перед выездом')).toHaveCount(0);
    await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
    await expect(toast(page)).toHaveText('Выезд подтверждён сервером');
    await expect(h2(page, 'Маршрут')).toBeVisible();
  });

  test('нет связи на осмотре: выезд недоступен с пояснением', async ({ app, page }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await page.context().setOffline(true);
    await expect(actionBar(page)).toContainText(
      'Нет связи: выезд требует подтверждения сервера. Черновик сохранён на устройстве.',
    );
    await expect(
      actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }),
    ).toBeDisabled();
    await page.context().setOffline(false);
  });

  test('выезд: тост, «В рейсе», «Маршрут» 0 из 3; «Прибыл» — aria-pressed, «✓», 1 из 3', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await depart(page);
    await expect(toast(page)).toHaveText('Выезд подтверждён сервером');
    await expect(page.locator('.ox-dr-trip')).toContainText('В рейсе');
    await expect(current(page)).toHaveText('3Рейс');
    await expect(page.getByText('Отмечено 0 из 3')).toBeVisible();
    await page.getByRole('button', { name: 'Прибыл' }).first().click();
    await expect(page.getByText('Отмечено 1 из 3')).toBeVisible();
    const undo = page.getByRole('button', { name: 'Отменить', exact: true });
    await expect(undo).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.ox-dr-stop-mark').first()).toHaveText('✓');
    await page.reload();
    await expect(page.getByText('Отмечено 1 из 3')).toBeVisible();
  });

  test('расход: ошибки суммы и чека, затем «Топливо · 2 500 ₽» «Принято сервером»', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await depart(page);
    await page.getByRole('button', { name: 'Добавить расход' }).click();
    await page.getByRole('button', { name: 'Сохранить расход' }).click();
    await expect(page.getByText('Укажите сумму')).toBeVisible();
    await expect(page.getByText('Добавьте фото чека')).toBeVisible();
    await page.getByLabel(/^Сумма, ₽/).fill('-500');
    await expect(page.getByText('Сумма должна быть больше нуля')).toBeVisible();
    await page.getByLabel(/^Сумма, ₽/).fill('2500');
    await expect(page.getByLabel(/^Дата/)).toHaveValue('2026-10-01');
    await expect(page.getByLabel('Категория')).toHaveValue('fuel');
    await choosePhoto(page, page.getByRole('button', { name: /^Чек: / }), 'receipt.jpg');
    await scanUntil(page, page.locator('.ox-dr-receipt').getByText('Загружено'));
    await page.getByRole('button', { name: 'Сохранить расход' }).click();
    await expect(toast(page)).toHaveText('Расход принят сервером');
    await expect(page.getByText('Топливо · 2 500 ₽')).toBeVisible();
    await expect(page.getByText('01.10.2026 · чек приложен')).toBeVisible();
    await expect(page.getByText('Принято сервером')).toBeVisible();
  });

  test('сдача: пробег меньше выезда — ошибка; доработка; приёмка — «Смена принята», без начислений', async ({
    app,
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = await openDriver(app, page, 'today');
    await depart(page);
    await finishRoute(page);
    await expect(page.getByLabel('Комментарий для менеджера')).toBeVisible();
    await expect(page.getByLabel('Критический — машина не может выехать')).toHaveCount(0);
    await fivePhotos(page);
    await fillInspection(page, '84400', RET_CHECKS);
    await expect(page.getByText('Пробег не может быть меньше 84 500 км')).toBeVisible();
    await expect(actionBar(page).getByRole('button', { name: 'Сдать машину' })).toBeDisabled();
    await page.getByLabel(/^Пробег по одометру, км/).fill('84560');
    await actionBar(page).getByRole('button', { name: 'Сдать машину' }).click();
    await expect(toast(page)).toHaveText('Сдача принята сервером. Ожидайте приёмки');
    await expect(h2(page, 'Ожидает приёмки менеджером')).toBeVisible();
    await expect(page.locator('.ox-dr-summary')).toContainText('Пройдено 60 км');
    await expect(current(page)).toHaveText('5Приёмка');

    await asManager(app, page, tenant, () =>
      reviewTrip(page, tenant, {
        decision: 'rework',
        comment: 'Переснимите фото слева',
        steps: ['photos'],
      }),
    );
    await expect(page.getByText('Менеджер вернул смену на доработку')).toBeVisible();
    await expect(page.getByText('«Переснимите фото слева»')).toBeVisible();
    await expect(page.getByText('Исправить: Фото при сдаче')).toBeVisible();
    await handOver(page, '84560');

    await asManager(app, page, tenant, () => reviewTrip(page, tenant, { decision: 'approve' }));
    await expect(h2(page, 'Смена принята')).toBeVisible();
    await expect(page.getByText('Начать новую демо-смену')).toHaveCount(0);
    await expect(page.locator('#ox-main')).not.toContainText('Начисление');
  });

  test('состояния: загрузка — скелетон; ошибка и «Повторить»; нет рейса', async ({ app, page }) => {
    await openDriver(app, page, 'today', { scenario: 'listTripPlans=delay=1500' });
    await expect(page.locator('#ox-main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(page.getByText('Р-208 · Северный маршрут')).toBeVisible();

    await devScenario(page, { scenario: 'listTripPlans=rate_limited' });
    await page.reload();
    await expect(page.locator('.ox-dr').getByRole('alert')).toContainText(
      'Не удалось загрузить смену: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.locator('.ox-dr').getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Р-208 · Северный маршрут')).toBeVisible();

    await devScenario(page, { scenario: 'listTripPlans=empty' });
    await page.reload();
    await expect(page.getByText('Рейсов на сегодня нет')).toBeVisible();
  });

  test('модуль отключён с историей: баннер и «новые брони недоступны»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await setModule(page, alta, 'fleet', false);
    await app(`/t/${alta}/today`, { persona: 'driver' });
    await expect(h1(page, 'Моя смена')).toBeVisible();
    await expect(
      page.getByText('Модуль «Логистика» отключён: новые брони недоступны.'),
    ).toBeVisible();
    await expect(
      carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Бронь недоступна' }),
    ).toBeDisabled();
  });

  test('клавиатура: Tab до «Забронировать», Enter бронирует; фокус виден', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    const book = carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' });
    await expect(book).toBeVisible();
    await book.focus();
    await expect(book).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(h2(page, 'Осмотр перед выездом')).toBeVisible();
    const front = page.getByRole('button', { name: /^Спереди: / });
    await front.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /^Сзади: / })).toBeFocused();
  });

  test('axe без serious/critical: бронь, осмотр, маршрут; 390 — цели ≥ 44 px, без прокрутки вбок', async ({
    app,
    page,
    axe,
  }) => {
    const serious = async () =>
      (await axe(page)).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    await openDriver(app, page, 'today');
    await expect(carCard(page, 'ГАЗель Next')).toBeVisible();
    expect(await serious()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await reserve(page);
    expect(await serious()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      // Тост брони лежит над панелью действия (как в эталоне) — меряем после него.
      await expect(toast(page)).toBeHidden({ timeout: 10_000 });
      for (const b of [
        page.getByRole('button', { name: /^Спереди: / }),
        page.getByRole('button', { name: '½', exact: true }),
        page.getByRole('button', { name: 'Добавить дефект' }),
        actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }),
      ]) {
        expect(await hitHeight(b)).toBeGreaterThanOrEqual(44);
      }
    }
    await fivePhotos(page);
    await fillInspection(page, '84500', DEP_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
    await expect(h2(page, 'Маршрут')).toBeVisible();
    expect(await serious()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      expect(
        await hitHeight(page.getByRole('button', { name: 'Прибыл' }).first()),
      ).toBeGreaterThanOrEqual(44);
    }
  });
});

// W2.53: backend брони, осмотров, рейса и расходов (W2.02, W2.04, W2.05) и приёмки (W2.06) в main — fixme снят.
// Сид e2e-stand, свой рейс водителя и уборка — logistics.stand.ts.
test.describe('driver-today — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('водитель на стенде: «Моя смена», машины с совместимостью, бронь → «Осмотр перед выездом»', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.slow();
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const manager = await persona(session, 'manager');
    await app('/', { persona: 'driver' });
    const trip = await driverTrip(page, manager, s, `Стенд ${label(testInfo.project.name)}`);
    undo(`бронь рейса ${trip.number}`, () => closeTrip(page, manager, s.tenant, trip.id));
    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    await expect(h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`${trip.number} · ${trip.title}`)).toBeVisible();
    await expect(h2(page, 'Выберите машину')).toBeVisible();
    await expect(carCard(page, GAZEL)).toContainText(
      'Подходит рейсу: масса, объём, длина и температура',
    );
    await reserve(page);
    await expect(toast(page)).toHaveText('Бронь подтверждена сервером. Начните осмотр', {
      timeout: 15_000,
    });
    for (const side of SIDES) {
      await expect(page.getByRole('button', { name: new RegExp(`^${side}: `) })).toBeVisible();
    }
    await expect(actionBar(page)).toContainText('Осталось');
    expect((await reservationOf(manager, s.tenant, trip.id))?.state).toBe('held');
  });

  test('водитель на стенде: пять фото через MinIO и cmd/worker, выезд; сдача и приёмка — «Смена принята»', async ({
    app,
    page,
    session,
    undo,
    harness,
  }, testInfo) => {
    test.setTimeout(300_000);
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const manager = await persona(session, 'manager');
    await app('/', { persona: 'driver' });
    const trip = await driverTrip(page, manager, s, `Стенд ${label(testInfo.project.name)}`);
    test.skip(!(await storageReachable(page, s.tenant, trip.id, harness.allowHosts)), NO_STORAGE);
    undo(`бронь рейса ${trip.number}`, () => closeTrip(page, manager, s.tenant, trip.id));
    const gazel = await vehicle(page, s.tenant);
    const file = await jpeg(page);
    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    await expect(h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
    await reserve(page);
    for (const side of SIDES) {
      await shoot(
        page,
        page.getByRole('button', { name: new RegExp(`^${side}: `) }),
        file,
        `${side}.jpg`,
      );
    }
    await expect(page.getByText('Фото · 5 из 5')).toBeVisible({ timeout: 90_000 });
    await fillInspection(page, String(Number(gazel.odometerKm) + 130), DEP_CHECKS);
    await expect(actionBar(page)).not.toContainText('Осталось');
    await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
    await expect(toast(page)).toHaveText('Выезд подтверждён сервером', { timeout: 15_000 });
    await expect(h2(page, 'Маршрут')).toBeVisible();
    // Сдача — командами водителя через API (осмотр при сдаче — modal-finish-route и путь показа), приёмка — менеджер.
    await apiReturn(page, s.tenant, trip, {
      reservationId: '',
      vehicle: gazel,
      departureInspectionId: '',
    });
    await approve(manager, s.tenant, trip.id);
    await page.reload();
    await expect(h2(page, 'Смена принята')).toBeVisible({ timeout: 15_000 });
  });
});
