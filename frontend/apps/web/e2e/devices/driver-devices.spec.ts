// W2.31 · Путь водителя `driver-today` на телефонах матрицы (S2-19 п. 2, R-04; ADR-0010, D-08, ПДн §6). Режим mock:
// камера — кадр фальшивого устройства или холст в `input capture`, сбой загрузки и «Нет связи» — маршрут хранилища,
// сценарии X-Test-Scenario и `context.setOffline`, медленная сеть — задержка сценария и PUT хранилища.
// Подписи — дословно из эталона design-stage-2 («Ортус CRM.dc.html» pg.today :656–848, photoVM :3382, bannersVM
// :3089–3090), уже сверенные страницами driver-today (W2.22) и driver-outbox (W2.24).
import type { Page, Request, TestInfo } from '@playwright/test';

import { leaks } from '../../src/routes/core/files/upload/metadata.fixtures.test-util.ts';
import {
  actionBar,
  DEP_CHECKS,
  fillInspection,
  finishDialog,
  openDriver,
  RET_CHECKS,
  reserve,
  SIDES,
} from '../driver.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { noHorizontalScroll, toast } from '../modules.helpers.ts';
import { banner, commands, expenseRow, h2, keysOf, net, scanFor, slot } from '../outbox.helpers.ts';
import { devScenario } from '../shell.helpers.ts';

import {
  CAMERA,
  deviceOf,
  fiveShots,
  frame,
  jpegInfo,
  prepareStorage,
  press,
  slowNetwork,
  snap,
  storage,
  watchGeolocation,
} from './devices.helpers.ts';

const MAX_SIDE = 1600;

type AppFn = Parameters<typeof openDriver>[0];
type Bytes = Uint8Array<ArrayBuffer>;

/** «Сегодня» водителя; на WebKit хранилище mock вкладки готовится до запуска приложения (prepareStorage). */
async function openToday(app: AppFn, page: Page, info: TestInfo): Promise<void> {
  await prepareStorage(page, info);
  await openDriver(app, page, 'today');
}

/** Кадры камеры, снятые заранее (со связью): под WebKit без связи холст страницы не читается. */
async function frames(page: Page, info: TestInfo, from: number, count: number): Promise<Bytes[]> {
  const out: Bytes[] = [];
  for (let n = from; n < from + count; n++) out.push(await frame(page, info, n));
  return out;
}

/** Пять кадров без связи: «На устройстве · ждёт связи», «Фото · 5 из 5». */
async function shotsOffline(page: Page, info: TestInfo, shots: Bytes[]): Promise<void> {
  for (const [i, side] of SIDES.entries()) {
    await snap(page, info, slot(page, side), i + 1, shots[i]);
  }
  await expect(page.getByText('Фото · 5 из 5')).toBeVisible();
  await expect(
    page.locator('.ox-dr-slot-status').filter({ hasText: 'На устройстве · ждёт связи' }),
  ).toHaveCount(5);
}

/** Расход без связи: «Мойка», 400 ₽, чек камерой → «Сохранить на устройстве». */
async function expenseOnDevice(page: Page, info: TestInfo, receipt: Bytes): Promise<void> {
  await press(page.getByRole('button', { name: 'Добавить расход' }), info);
  await page.getByLabel('Категория').selectOption('wash');
  await page.getByLabel(/^Сумма, ₽/).fill('400');
  await snap(page, info, page.getByRole('button', { name: /^Чек: / }), 6, receipt);
  await expect(
    page.locator('.ox-dr-receipt').getByText('На устройстве · ждёт связи'),
  ).toBeVisible();
  await press(page.getByRole('button', { name: 'Сохранить на устройстве' }), info);
}

/** Бронь, пять кадров камеры, осмотр и «Выехать на маршрут» → «Маршрут». */
async function departOnPhone(page: Page, info: TestInfo): Promise<void> {
  await reserve(page);
  await fiveShots(page, info, SIDES);
  await fillInspection(page, '84500', DEP_CHECKS);
  await press(actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }), info);
  await expect(toast(page)).toHaveText('Выезд подтверждён сервером');
  await expect(h2(page, 'Маршрут')).toBeVisible({ timeout: 15_000 });
}

test.describe('водитель на телефоне @devices @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  // Пять кадров 12 Мп сжимаются на клиенте; под нагрузкой общего ПК путь дольше 30 с.
  test.describe.configure({ timeout: 180_000 });

  test('профиль устройства: касание, pointer: coarse, геолокация не выдана и не запрошена', async ({
    app,
    page,
  }, info) => {
    const d = deviceOf(info);
    const geoCalls = await watchGeolocation(page);
    await openToday(app, page, info);
    const profile = await page.evaluate(async () => {
      let geo = 'unsupported';
      try {
        geo = (await navigator.permissions.query({ name: 'geolocation' })).state;
      } catch {
        // WebKit без permissions.query для geolocation — разрешения нет.
      }
      const cams = navigator.mediaDevices
        ? (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'videoinput')
            .length
        : 0;
      return {
        width: window.innerWidth,
        dpr: window.devicePixelRatio,
        coarse: matchMedia('(pointer: coarse)').matches,
        // WebKit Playwright под Windows не эмулирует maxTouchPoints — касание видно по ontouchstart.
        touch: navigator.maxTouchPoints > 0 || 'ontouchstart' in window,
        ua: navigator.userAgent,
        geo,
        cams,
      };
    });
    expect(profile.width).toBe(info.project.use.viewport?.width);
    expect(profile.dpr).toBe(info.project.use.deviceScaleFactor);
    expect(profile.coarse).toBe(true);
    expect(profile.touch).toBe(true);
    expect(profile.ua).toContain(d.os === 'ios' ? 'iPhone' : 'Android');
    expect(profile.geo).not.toBe('granted');
    if (d.fakeCamera) expect(profile.cams).toBeGreaterThan(0);
    await reserve(page);
    await expect(h2(page, 'Осмотр перед выездом')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await geoCalls()).toBe(0);
  });

  test('камера: input accept=image/* capture=environment; кадр 4032×3024 с GPS → PUT JPEG ≤ 1600 px без GPS; «Фото · 5 из 5»', async ({
    app,
    page,
  }, info) => {
    await openToday(app, page, info);
    await reserve(page);
    const input = page.locator('input[type="file"]').first();
    await expect(input).toHaveAttribute('accept', 'image/*');
    await expect(input).toHaveAttribute('capture', 'environment');
    const put = await storage(page, info);

    const shot = await snap(page, info, slot(page, 'Спереди'), 1);
    expect(jpegInfo(shot)).toMatchObject({ ...CAMERA, exif: true });
    expect(leaks(shot)).toEqual(['WGS-84-SECRET', 'exif:GPSLatitude']);
    await expect.poll(async () => (await put.bodies()).length).toBe(1);
    const sent = (await put.bodies())[0] ?? shot;
    expect(leaks(sent)).toEqual([]);
    expect(jpegInfo(sent)).toEqual({ width: MAX_SIDE, height: 1200, exif: false });
    expect(sent.length).toBeLessThan(shot.length);

    for (const [i, side] of SIDES.slice(1).entries())
      await snap(page, info, slot(page, side), i + 2);
    await scanFor(page, page.getByText('Фото · 5 из 5'));
    await expect.poll(async () => (await put.bodies()).length).toBe(5);
    for (const b of await put.bodies()) {
      expect(leaks(b)).toEqual([]);
      expect(Math.max(jpegInfo(b).width, jpegInfo(b).height)).toBeLessThanOrEqual(MAX_SIDE);
    }
    await expect(page.locator('.ox-dr-slot-status').filter({ hasText: 'Загружено' })).toHaveCount(
      5,
    );
  });

  test('сбой загрузки: «Ошибка загрузки», тост, «Повторить» загружает снова', async ({
    app,
    page,
  }, info) => {
    await openToday(app, page, info);
    await reserve(page);
    const put = await storage(page, info, { fail: 1 });
    await snap(page, info, slot(page, 'Спереди'), 1);
    await expect(page.getByText('Ошибка загрузки')).toBeVisible();
    await expect(toast(page)).toHaveText('Загрузка прервалась. Повторите попытку.');
    await press(page.getByRole('button', { name: 'Повторить', exact: true }), info);
    await scanFor(page, page.getByText('Фото · 1 из 5'));
    expect(await put.attempts()).toBe(2);
    await expect.poll(async () => (await put.bodies()).length).toBe(1);
  });

  test('офлайн: фото «На устройстве · ждёт связи», расход на устройстве, баннер; связь — «принято сервером»', async ({
    app,
    page,
  }, info) => {
    // Playwright WebKit (E2E_DEVICES_WEBKIT=1): при эмуляции «нет связи» (context.setOffline) движок не читает и
    // выбранный файл (NotReadableError), а на телефоне без связи файл читается. Офлайн на iPhone проверяют
    // Chromium-профиль и полевой тест (field-test-checklist.md, разделы «Без связи»).
    test.skip(
      deviceOf(info).engine === 'webkit',
      'WebKit: эмуляция без связи не читает выбранный файл',
    );
    await openToday(app, page, info);
    await reserve(page);
    const shots = await frames(page, info, 1, 6);
    await net(page, false);
    await shotsOffline(page, info, shots);
    await fillInspection(page, '84500', DEP_CHECKS);
    await expect(actionBar(page)).toContainText(
      'Нет связи: выезд требует подтверждения сервера. Черновик сохранён на устройстве.',
    );
    await expect(
      actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }),
    ).toBeDisabled();
    expect(await noHorizontalScroll(page)).toBe(true);
    await net(page, true);
    // Связь появилась — фото с устройства загружаются сами, все пять — «Загружено».
    await scanFor(page, page.locator('.ox-dr-slot-status').filter({ hasText: 'Загружено' }).nth(4));
    await expect(page.getByText('На устройстве · ждёт связи')).toHaveCount(0);
    await press(actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }), info);
    await expect(h2(page, 'Маршрут')).toBeVisible({ timeout: 15_000 });

    const posts = commands(page, 'POST', /\/expenses$/);
    await net(page, false);
    await expenseOnDevice(page, info, shots[5] ?? (await frame(page, info, 6)));
    await expect(toast(page)).toHaveText(
      'Расход сохранён на устройстве. Отправится при появлении связи',
    );
    await expect(expenseRow(page, 'Мойка · 400 ₽')).toContainText('Локальный черновик');
    await expect(banner(page, 'Нет связи.')).toContainText('(ожидают отправки: 1)');
    expect(posts.list()).toEqual([]);
    await net(page, true);
    await scanFor(page, page.getByText('Мойка 400 ₽ — принято сервером'));
    await expect(expenseRow(page, 'Мойка · 400 ₽').locator('.ox-dr-chip')).toContainText(
      'Принято сервером',
    );
    expect(new Set(await keysOf(posts.list())).size).toBe(1);
  });

  test('медленная сеть: «Загрузка N%», путь до выезда проходит, повторное нажатие — одна команда', async ({
    app,
    page,
  }, info) => {
    await openToday(app, page, info);
    await reserve(page);
    // Мобильный канал: PUT — 750 кбит/с отправки и 300 мс задержки, ответы API — 800 мс.
    const put = await storage(page, info, { latencyMs: 300, kbps: 750 });
    await slowNetwork(page, info, 800);
    await snap(page, info, slot(page, 'Спереди'), 1);
    // Сжатие кадра 12 Мп и initiate с задержкой сети — до нескольких секунд до первого процента.
    await expect(
      page.locator('.ox-dr-slot-status').filter({ hasText: /Загрузка \d+%/ }),
    ).toBeVisible({ timeout: 30_000 });
    for (const [i, side] of SIDES.slice(1).entries())
      await snap(page, info, slot(page, side), i + 2);
    await scanFor(page, page.getByText('Фото · 5 из 5'), 90_000);
    await expect.poll(async () => (await put.bodies()).length).toBe(5);
    await fillInspection(page, '84500', DEP_CHECKS);

    const inspections = commands(page, 'POST', /\/fleet\/inspections$/);
    const go = actionBar(page).getByRole('button', { name: 'Выехать на маршрут' });
    await go.scrollIntoViewIfNeeded();
    const box = await go.boundingBox();
    if (!box) throw new Error('нет кнопки «Выехать на маршрут»');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // Нетерпеливый водитель: второе касание, пока сервер не ответил.
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expect(h2(page, 'Маршрут')).toBeVisible({ timeout: 30_000 });
    await expect(toast(page)).toHaveText('Выезд подтверждён сервером');
    const sent: Request[] = inspections.list();
    expect(sent).toHaveLength(1);
    await devScenario(page, { scenario: null });
  });

  test('путь водителя целиком: бронь → осмотр → выезд → расход → сдача → «Ожидает приёмки менеджером»', async ({
    app,
    page,
  }, info) => {
    await openToday(app, page, info);
    await departOnPhone(page, info);

    await press(page.getByRole('button', { name: 'Добавить расход' }), info);
    await page.getByLabel('Категория').selectOption('wash');
    await page.getByLabel(/^Сумма, ₽/).fill('400');
    await snap(page, info, page.getByRole('button', { name: /^Чек: / }), 6);
    await scanFor(page, page.locator('.ox-dr-receipt').getByText('Загружено'));
    await press(page.getByRole('button', { name: 'Сохранить расход' }), info);
    await expect(toast(page)).toHaveText('Расход принят сервером');
    await expect(page.getByText('Мойка · 400 ₽')).toBeVisible();

    await press(actionBar(page).getByRole('button', { name: 'Завершить рейс' }), info);
    await press(finishDialog(page).getByRole('button', { name: 'Завершить рейс' }), info);
    await expect(h2(page, 'Осмотр при сдаче')).toBeVisible();
    await fiveShots(page, info, SIDES);
    await fillInspection(page, '84560', RET_CHECKS);
    await press(actionBar(page).getByRole('button', { name: 'Сдать машину' }), info);
    await expect(h2(page, 'Ожидает приёмки менеджером')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.ox-dr-summary')).toContainText('Пройдено 60 км');
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('установка PWA: манифест standalone, иконки 192/512, apple-touch-icon, theme-color', async ({
    app,
    page,
  }, info) => {
    await openToday(app, page, info);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1F6B52');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/pwa/icon-192.png',
    );
    const m = await page.evaluate(async () => {
      const r = await fetch('/manifest.webmanifest');
      return (await r.json()) as { display: string; start_url: string; icons: { sizes: string }[] };
    });
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    if (deviceOf(info).engine === 'chromium') {
      // Chromium (Android): у манифеста нет ошибок установки (Page.getInstallabilityErrors).
      const cdp = await page.context().newCDPSession(page);
      const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
        installabilityErrors: { errorId: string }[];
      };
      expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
    }
  });
});
