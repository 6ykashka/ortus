// W2.32 · Помощники сквозных сценариев выхода этапа 2 (journeys/stage2): водитель — страница проекта (390, 768,
// 1440), менеджер и владелец на стенде — свой контекст 1440 с сетью и часами харнесса; фото — настоящий JPEG из canvas
// (на стенде — сжатие на клиенте, MinIO и проверка cmd/worker), в mock — PUT по билету 200 и проверка файлов
// dev-маршрутом сценарного сервера. Общие помощники страниц (driver.helpers, logistics.stand и др.) — как есть.
import { createNet, installClock, LOCALE, openApp, type Persona, TIMEZONE } from '@ortus/e2e-kit';
import { type Browser, expect, type Locator, type Page } from '@playwright/test';

import { actionBar, finishDialog, RET_CHECKS, SIDES } from '../../driver.helpers.ts';
import { queueItem, REVIEW_H1 } from '../../logistics-review.helpers.ts';
import { realClock } from '../../logistics.stand.ts';
import { toast } from '../../modules.helpers.ts';
import { call, type Reply } from '../../shell.helpers.ts';

export type Mode = 'mock' | 'stand';

/** Id, которого нет ни в одной организации и ни в одном справочнике. */
export const UNKNOWN = '00000000-0000-4000-8000-000000000000';
/** Хост билета загрузки сценарного сервера (adapter/src/msw/files). */
const MOCK_STORAGE = 'https://storage.example.invalid/**';
/** Ответ сервера на команду смены под нагрузкой стенда — дольше 5 с ожидания по умолчанию. */
export const SERVER = { timeout: 15_000 };

export const h1 = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 1, name });
export const h2 = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 2, name });

/** Неразрывный пробел разрядов: «4 500 ₽» → «4 500 ₽» (формат денег страниц). */
export const nb = (s: string): string => s.replace(/(\d) (\d{3})/g, '$1 $2');

/** Хранилище mock: PUT по билету загрузки — 200 (адрес вне сети харнесса). */
export async function mockStorage(page: Page): Promise<void> {
  await page.context().route(MOCK_STORAGE, (r) => r.fulfill({ status: 200 }));
}

type Harness = { appURL: string; allowHosts: readonly string[] };

/** Зона фирм сида e2e-stand. */
const MSK = 'Europe/Moscow';

/** Начало суток `now` (мс) в зоне `zone`: полночь по местному времени, в мс UTC. */
export function dayStart(zone: string, now: number = Date.now()): number {
  const at = (tz: string) => Date.parse(new Date(now).toLocaleString('en-US', { timeZone: tz }));
  const offset = at(zone) - at('UTC');
  const DAY = 86_400_000;
  return Math.floor((now + offset) / DAY) * DAY - offset;
}

/**
 * Компьютер менеджера или владельца на стенде: свой контекст 1440 (часы и сеть харнесса, настоящее время — окна
 * рейсов стенда от «сейчас»), вход персонажа на `route`.
 */
export async function desktop(
  browser: Browser,
  harness: Harness,
  persona: Persona,
  route = '/',
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: harness.appURL,
    viewport: { width: 1440, height: 900 },
    locale: LOCALE,
    timezoneId: TIMEZONE,
  });
  await installClock(context);
  await createNet(context, harness.allowHosts);
  const page = await context.newPage();
  await realClock(page);
  await openApp(page, { baseURL: harness.appURL, route, persona });
  return { page, close: () => context.close() };
}

/** Настоящий JPEG 640×480 из canvas страницы (подпись — чтобы фото различались). */
export async function jpeg(page: Page, text = 'Ортус · смена'): Promise<Buffer> {
  const b64 = await page.evaluate((t) => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = '#3b7d6e';
    g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#ffffff';
    g.font = '40px sans-serif';
    g.fillText(t, 40, 250);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
  }, text);
  if (!b64) throw new Error('canvas: нет 2d-контекста');
  return Buffer.from(b64, 'base64');
}

/** Фото слота через выбор файла (камера телефона — тот же input `capture`). */
export async function shoot(page: Page, slot: Locator, file: Buffer, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await slot.click();
  await (await chooser).setFiles({ name, mimeType: 'image/jpeg', buffer: file });
}

/** Слот фото осмотра по ракурсу. */
export const slot = (page: Page, side: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^${side}: `) });

/**
 * Ждёт `ready`: в mock проверку файлов завершает dev-маршрут сценарного сервера (`scanFiles`), на стенде — cmd/worker.
 */
export async function untilReady(page: Page, mode: Mode, ready: Locator): Promise<void> {
  if (mode === 'stand') {
    await expect(ready).toBeVisible({ timeout: 90_000 });
    return;
  }
  await expect(async () => {
    await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
    await expect(ready).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 45_000 });
}

/** Пять фото осмотра → «Фото · 5 из 5» (`sides` — только эти ракурсы, без ожидания пяти). */
export async function photos(page: Page, mode: Mode, file: Buffer): Promise<void> {
  for (const side of SIDES) await shoot(page, slot(page, side), file, `${side}.jpg`);
  await untilReady(page, mode, page.getByText('Фото · 5 из 5'));
}

/** Пробег, «½» и пункты чек-листа. */
export async function fillInspection(
  page: Page,
  odometer: string,
  checks: readonly string[],
): Promise<void> {
  await page.getByLabel(/^Пробег по одометру, км/).fill(odometer);
  await page.getByRole('button', { name: '½', exact: true }).click();
  for (const c of checks) await page.getByLabel(c, { exact: true }).check();
}

/**
 * «Моя смена» с рейсом в пути: «Завершить рейс» → осмотр при сдаче с пятью фото → «Сдать машину» → «Ожидает приёмки
 * менеджером». Экран загружается без ошибок («Не удалось загрузить …» нет).
 */
export async function returnOnScreen(
  page: Page,
  tenant: string,
  mode: Mode,
  file: Buffer,
  odometer: number,
): Promise<void> {
  await page.goto(`/t/${tenant}/today`);
  await expect(h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
  await expect(h2(page, 'Маршрут')).toBeVisible(SERVER);
  await expect(page.getByText(/Не удалось загрузить/)).toHaveCount(0);
  await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await finishDialog(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await expect(h2(page, 'Осмотр при сдаче')).toBeVisible(SERVER);
  await photos(page, mode, file);
  await fillInspection(page, String(odometer), RET_CHECKS);
  await actionBar(page).getByRole('button', { name: 'Сдать машину' }).click();
  await expect(toast(page)).toHaveText('Сдача принята сервером. Ожидайте приёмки', SERVER);
  await expect(h2(page, 'Ожидает приёмки менеджером')).toBeVisible(SERVER);
}

/** «Приёмка смен»: смена рейса `trip` → «Принять смену» → подтверждение → тост. */
export async function acceptOnReview(page: Page, tenant: string, trip: string): Promise<void> {
  await page.goto(`/t/${tenant}/review`);
  await expect(h1(page, REVIEW_H1)).toBeVisible({ timeout: 15_000 });
  await queueItem(page, trip).click();
  await page.getByRole('button', { name: 'Принять смену' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Принять смену' }).click();
  await expect(toast(page)).toHaveText('Смена принята. Машина вернулась в пул', SERVER);
}

/** Ответ Problem без полей конкретного запроса: ответы сравниваются по сути. */
export function problemShape(r: Reply): Record<string, unknown> {
  const b = { ...(r.body as Record<string, unknown>) };
  delete b.instance;
  delete b.requestId;
  delete b.traceId;
  return { status: r.status, ...b };
}

/** Ответ на скрытый объект тот же, что на несуществующий: статус и Problem совпадают, данных объекта нет. */
export async function hiddenLikeUnknown(
  page: Page,
  path: (id: string) => string,
  id: string,
  leak: readonly string[] = [],
): Promise<Reply> {
  const hidden = await call(page, 'GET', path(id));
  const missing = await call(page, 'GET', path(UNKNOWN));
  expect(hidden.status, `${path(id)}: ${JSON.stringify(hidden.body)}`).toBeGreaterThanOrEqual(400);
  expect(problemShape(hidden), path(id)).toEqual(problemShape(missing));
  for (const s of leak) expect(JSON.stringify(hidden.body), path(id)).not.toContain(s);
  return hidden;
}

/** Ответ с ожидаемым статусом, иначе ошибка с телом Problem. */
export function expectOk(r: Reply, what: string): Reply {
  expect(r.status < 300, `${what} ${r.status}: ${JSON.stringify(r.body)}`).toBe(true);
  return r;
}

/** Параллельные POST одной команды из страницы (каждый со своим Idempotency-Key): статусы и коды ответов. */
export async function burst(
  page: Page,
  path: string,
  bodies: readonly unknown[],
): Promise<{ status: number; code: string; id: string }[]> {
  return page.evaluate(
    async ({ path, bodies }) => {
      const csrf = decodeURIComponent(
        /(?:^|;\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '',
      );
      return Promise.all(
        bodies.map(async (body) => {
          const r = await fetch(path, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf,
              'Idempotency-Key': crypto.randomUUID(),
            },
            body: JSON.stringify(body),
          });
          const j = (await r.json().catch(() => ({}))) as { code?: string; id?: string };
          return { status: r.status, code: j.code ?? '', id: j.id ?? '' };
        }),
      );
    },
    { path, bodies },
  );
}

/**
 * Карточка водителя без входа в фирме `unitId` с функцией «Водитель» (createMember, createWorkProfile; места не
 * занимает). Повторный прогон берёт её же по имени (стенд пересоздаётся `down -v`).
 */
export async function cardDriver(
  owner: Page,
  tenant: string,
  unitId: string,
  name: string,
): Promise<string> {
  const base = `/api/v1/tenants/${tenant}/members`;
  const list = expectOk(await call(owner, 'GET', `${base}?limit=200`), 'listMembers').body as {
    items: { id: string; displayName: string }[];
  };
  const id =
    list.items.find((m) => m.displayName === name)?.id ??
    (
      expectOk(
        await call(owner, 'POST', base, { body: { displayName: name, orgUnitIds: [unitId] } }),
        'createMember',
      ).body as { id: string }
    ).id;
  const profiles = expectOk(
    await call(owner, 'GET', `${base}/${id}/work-profiles`),
    'listWorkProfiles',
  ).body as { items?: { function: string; validUntil?: string | null }[] };
  if (!(profiles.items ?? []).some((p) => p.function === 'driver' && !p.validUntil)) {
    expectOk(
      await call(owner, 'POST', `${base}/${id}/work-profiles`, {
        // С начала сегодняшнего дня в зоне фирмы: окно рейса гонки может начаться раньше «сейчас» (Р-208 сида — сегодня
        // 13:00–17:00), а водитель рейса должен быть водителем на начало окна (422 «нужен действующий сотрудник…»);
        // раньше начала дня функция не начинается (422 «Функция может начаться не раньше сегодняшнего дня.»,
        // org/kit.CheckPeriod — день в зоне фирмы человека; фирмы сида — Москва).
        body: { function: 'driver', validFrom: new Date(dayStart(MSK)).toISOString() },
      }),
      'createWorkProfile',
    );
  }
  return id;
}

/**
 * Уборка стенда запросами страницы, не зависящая от её состояния: страница в этот момент могла перезагружаться
 * («Execution context was destroyed», ревью r2 — категория «Стоянка t768·…» осталась на стенде). Ждёт `load` и
 * старт приложения (рендер в `#app` — после запуска MSW в mock, main.tsx) и повторяет `fn` целиком — `fn` должна быть
 * идемпотентной (читает состояние заново: уже убранное пропускает). Повторяются только ошибки уничтоженного
 * контекста страницы; посторонние (в том числе тайм-аут перехода со словом «navigating») уходят сразу (ревью r3).
 */
const NAVIGATED =
  /Execution context was destroyed|Cannot find context with specified id|frame was detached/;

export async function settled<T>(page: Page, fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i += 1) {
    await page.waitForLoadState('load').catch(() => undefined);
    await page
      .locator('#app > *')
      .first()
      .waitFor({ state: 'attached', timeout: 15_000 })
      .catch(() => undefined);
    try {
      return await fn();
    } catch (e) {
      if (i >= tries || !NAVIGATED.test(String(e))) throw e;
    }
  }
}

/** Вход другим персонажем или subject сида в той же вкладке (dev-вход; cookie сессии меняется у всей вкладки). */
export async function relogin(page: Page, persona: string): Promise<void> {
  expectOk(
    await call(page, 'POST', '/api/v1/dev/login', { body: { persona } }),
    `dev-вход ${persona}`,
  );
}

/** Часы сценарного сервера (только mock): `now` dev-маршрута. */
export async function serverNow(page: Page, now: string): Promise<void> {
  expectOk(
    await call(page, 'POST', '/api/v1/dev/scenario', { body: { now } }),
    `dev/scenario now ${now}`,
  );
}
