// W4.61 · Помощники e2e страниц шага 4.6: «Подписка и места» владельца и «Использование», «Заявки на тариф»,
// «Пользователи», «Тарифная сетка» оператора. Вход персонажа и прямой URL, секции страниц по `aria-labelledby`
// эталона, диалог opConfirm, данные сценарного сервера через API из страницы (оператор — /platform/**).
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Persona } from '@ortus/e2e-kit';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { call } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/** Страницы оператора: сегмент маршрута → id заголовка секции эталона и текст `h1`. */
export const PLATFORM_PAGES = {
  usage: { id: 'h-usage', h1: 'Использование' },
  requests: { id: 'h-req', h1: 'Заявки на изменение тарифа' },
  accounts: { id: 'h-acc', h1: 'Пользователи платформы' },
  plans: { id: 'h-pb', h1: 'Тарифная сетка' },
} as const;

export type PlatformSegment = keyof typeof PLATFORM_PAGES;

/** Секция страницы по id заголовка эталона (`h-usage`, `h-req`, `h-acc`, `h-pb`, `h-bill`). */
export const section = (page: Page, id: string): Locator =>
  page.locator(`section[aria-labelledby="${id}"]`);

/** Страница оператора по прямому URL после dev-входа; ждёт `h1` и конец загрузки области. */
export async function openPlatform(
  app: AppFn,
  page: Page,
  segment: PlatformSegment,
  o: { query?: string; persona?: Persona } = {},
): Promise<Locator> {
  const p = PLATFORM_PAGES[segment];
  await app(`/platform/${segment}${o.query ?? ''}`, { persona: o.persona ?? 'operator' });
  await expect(page.getByRole('heading', { level: 1, name: p.h1 })).toBeVisible({
    timeout: 15_000,
  });
  const root = section(page, p.id);
  await expect(root.getByRole('status', { name: 'Загрузка' })).toHaveCount(0, { timeout: 15_000 });
  return root;
}

/** Секция «Подписка и места». */
export const billingSection = (page: Page): Locator => section(page, 'h-bill');

/** Диалог opConfirm по заголовку. */
export const confirmDialog = (page: Page, title: string): Locator =>
  page.getByRole('dialog', { name: title });

/** Текст тоста оболочки. */
export const toastText = (page: Page): Locator => page.locator('.ox-toast .ox-toast-text');

/** Текст области без лишних пробелов (неразрывные пробелы разрядов → обычные). */
export async function textOf(loc: Locator): Promise<string> {
  return ((await loc.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

interface UsageDto {
  summary: { activeMembers: number; activeMembers7d: number };
  tenants: { tenantId: string; name: string }[];
}

/** «Использование» сценарного сервера (оператор). */
export async function platformUsage(page: Page): Promise<UsageDto> {
  const r = await call(page, 'GET', '/api/v1/platform/usage');
  if (r.status !== 200) throw new Error(`getPlatformUsage ${r.status}`);
  return r.body as UsageDto;
}

interface UsageTenantDto {
  tenantId: string;
  name: string;
  ownerName?: string;
  memberCount: number;
  moduleKeys: string[];
  seats: { used: number; limit: number | null };
  storageUsedBytes: number;
  storageQuotaBytes: number;
  tierName?: string;
}

/** Полный ответ getPlatformUsage (строки `@stand` W4.71 сверяют страницу с ответом стенда). */
export interface PlatformUsageDto {
  summary: {
    tenantCount: number;
    tenantsByStatus: { status: string; count: number }[];
    seatsUsed: number;
    seatsSold: number;
    storageUsedBytes: number;
    storageQuotaBytes: number;
    activeMembers: number;
    activeMembers7d: number;
  };
  modules: {
    moduleKey: string;
    tenantCount: number;
    seatsUsed: number;
    storageUsedBytes: number;
    tenants: { name: string }[];
  }[];
  signals: {
    kind: string;
    tenantId: string;
    tenantName: string;
    daysLeft?: number;
    trialEndsAt?: string;
    storagePercent?: number;
    storageUsedBytes?: number;
    storageQuotaBytes?: number;
  }[];
  tenants: UsageTenantDto[];
}

/** «Использование» стенда целиком (оператор). */
export async function platformUsageFull(page: Page): Promise<PlatformUsageDto> {
  return (await platformUsage(page)) as unknown as PlatformUsageDto;
}

/** Гигабайты как подпись kit/format.ts `gb`: одна цифра после запятой, без «,0». */
export const gbText = (bytes: number): string =>
  String(Math.round((bytes / 2 ** 30) * 10) / 10).replace('.', ',');

const MSK_DAY = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Последний день периода по Москве: конец — исключающая граница (kit/format.ts `mskLastDay`). */
export const mskLastDayText = (iso: string): string =>
  MSK_DAY.format(new Date(Date.parse(iso) - 1));

/** Настоящие часы страницы: сервер стенда сверяет даты со своим «сейчас» (харнесс ставит 01.10.2026). */
export async function realClock(page: Page): Promise<void> {
  await page.clock.setSystemTime(new Date());
}

export interface ChangeRequestDto {
  id: string;
  number: string;
  status: string;
  comment?: string;
  seatsUsed: number;
  decisionNote?: string;
}

/** Заявки на тариф организации (владелец, listSubscriptionChangeRequests). */
export async function ownerChangeRequests(page: Page, tenant: string): Promise<ChangeRequestDto[]> {
  const r = await call(
    page,
    'GET',
    `/api/v1/tenants/${tenant}/subscription/change-requests?limit=200`,
  );
  if (r.status !== 200) throw new Error(`listSubscriptionChangeRequests ${r.status}`);
  return (r.body as { items: ChangeRequestDto[] }).items;
}

/** Общие ресурсы стенда строк `@stand` W4.71: одна открытая заявка «Альты», одна запланированная версия сетки. */
export const STAND_LOCK = {
  altaRequests: 'alta-change-requests',
  priceBook: 'price-book',
} as const;

const STAND_LOCKS = join(
  fileURLToPath(new URL('..', import.meta.url)),
  'test-results',
  'stand-locks',
);
/** Замок старше — брошен (воркер убит): строка держит замок не дольше своего таймаута 90 с. */
const STALE_LOCK_MS = 5 * 60_000;
/** Дольше ждать очереди — ошибка: при workers 1 ожидания нет вовсе. */
const MAX_LOCK_WAIT_MS = 10 * 60_000;
const heldLocks = new Set<string>();

/** Замок брошен: каталог старше `STALE_LOCK_MS` (нет каталога — не брошен, его просто сняли). */
function isStale(dir: string): boolean {
  try {
    return Date.now() - statSync(dir).mtimeMs > STALE_LOCK_MS;
  } catch {
    return false;
  }
}

/**
 * Снять брошенный замок (возврат 2, ревью minor): снимает один воркер под замком `<dir>.reap` и перепроверяет
 * возраст уже под ним. Иначе двое ожидающих видят один брошенный замок, первый снимает его и берёт свой, а второй
 * удаляет уже свежий замок первого.
 */
function reapStale(dir: string): void {
  const reaper = `${dir}.reap`;
  try {
    mkdirSync(reaper);
  } catch {
    return; // проверяет другой воркер
  }
  try {
    if (isStale(dir)) rmSync(dir, { recursive: true, force: true });
  } finally {
    rmSync(reaper, { recursive: true, force: true });
  }
}

/**
 * Очередь строк `@stand` над общим ресурсом стенда между воркерами одного прогона (возврат 1: без `CI=true` проекты
 * идут параллельно, а заявка «Альты» и запланированная версия сетки — по одной). Замок — каталог в `test-results`
 * (`mkdirSync` атомарен; Playwright очищает каталог в начале прогона), как сборка в `pwa.spec.ts`. Время ожидания
 * добавляется к таймауту теста; снимает `releaseStandLocks` в `afterEach` — и при падении, и по таймауту.
 */
export async function standLock(name: string): Promise<void> {
  const dir = join(STAND_LOCKS, name);
  const info = test.info();
  const timeout = info.timeout;
  const started = Date.now();
  info.setTimeout(timeout + MAX_LOCK_WAIT_MS);
  mkdirSync(STAND_LOCKS, { recursive: true });
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    if (Date.now() - started > MAX_LOCK_WAIT_MS) throw new Error(`замок стенда «${name}» занят`);
    if (isStale(dir)) reapStale(dir);
    await new Promise((r) => setTimeout(r, 500));
  }
  heldLocks.add(dir);
  info.setTimeout(timeout + (Date.now() - started));
}

/** Снять замки стенда, взятые тестом этого воркера (`test.afterEach`). */
export function releaseStandLocks(): void {
  for (const dir of heldLocks) rmSync(dir, { recursive: true, force: true });
  heldLocks.clear();
}

/** Метка данных строк `@stand` W4.71 на стенде: комментарий заявки на тариф, «Что изменилось» версии сетки. */
export const STAND_MARK = 'Проверка стенда W4.71';

/** Метка данных одного прохода строки: проект и время (комментарий своей заявки). */
export const standMark = (project: string): string => `${STAND_MARK} ${project} ${Date.now()}`;

/** Текст помечен строкой W4.71. */
export const isStandMarked = (text: string | undefined): boolean =>
  (text ?? '').startsWith(`${STAND_MARK} `);

/**
 * Отменить свои открытые заявки организации — хвосты прошлых попыток строк W4.71 (метка `STAND_MARK` в комментарии):
 * одна открытая заявка на организацию. Чужие открытые заявки не отменяются — строка падает с их номерами.
 */
export async function cancelOwnPendingRequests(page: Page, tenant: string): Promise<void> {
  const pending = (await ownerChangeRequests(page, tenant)).filter((x) => x.status === 'pending');
  for (const x of pending.filter((p) => isStandMarked(p.comment))) {
    const r = await call(
      page,
      'POST',
      `/api/v1/tenants/${tenant}/subscription/change-requests/${x.id}/cancel`,
    );
    if (r.status !== 200) throw new Error(`cancelSubscriptionChangeRequest ${r.status}`);
  }
  expect(
    pending.filter((p) => !isStandMarked(p.comment)).map((p) => p.number),
    'открытая заявка организации не из строк W4.71 (одна открытая на организацию)',
  ).toEqual([]);
}

const unread = async (page: Page, tenant: string): Promise<number> => {
  const r = await call(page, 'GET', '/api/v1/me/notifications/summary');
  if (r.status !== 200) throw new Error(`getMyNotificationSummary ${r.status}`);
  const t = (r.body as { tenants: { tenantId: string; unreadCount: number }[] }).tenants;
  return t.find((x) => x.tenantId === tenant)?.unreadCount ?? 0;
};

/**
 * Входящие текущего входа в организации прочитаны (inbox @stand ждёт у владельца «Альты» ноль непрочитанных):
 * уведомления о заявках на тариф приходят владельцам; чтение повторяется, пока непрочитанных нет две проверки подряд.
 */
export async function readInbox(page: Page, tenant: string): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 20 && quiet < 2; i++) {
    if ((await unread(page, tenant)) === 0) {
      quiet++;
    } else {
      quiet = 0;
      const r = await call(page, 'POST', '/api/v1/me/notifications/read', {
        body: { tenantId: tenant, upTo: new Date(Date.now() + 1000).toISOString() },
      });
      if (r.status >= 300) throw new Error(`markNotificationsRead ${r.status}`);
    }
    await page.waitForTimeout(1000);
  }
  expect(await unread(page, tenant), 'входящие прочитаны').toBe(0);
}

/** Счётчики каталога аккаунтов (listPlatformUsers.counts). */
export async function platformUserCounts(page: Page): Promise<{
  all: number;
  multiTenant: number;
  noMfa: number;
  locked: number;
  neverSignedIn: number;
}> {
  const r = await call(page, 'GET', '/api/v1/platform/users?limit=1');
  if (r.status !== 200) throw new Error(`listPlatformUsers ${r.status}`);
  return (r.body as { counts: Awaited<ReturnType<typeof platformUserCounts>> }).counts;
}

interface UserDto {
  id: string;
  displayName: string;
  email: string;
}

/** Аккаунт каталога по имени (оператор). */
export async function platformUser(page: Page, name: string): Promise<UserDto> {
  const r = await call(page, 'GET', `/api/v1/platform/users?q=${encodeURIComponent(name)}`);
  const u = (r.body as { items: UserDto[] }).items.find((x) => x.displayName === name);
  if (!u) throw new Error(`нет аккаунта «${name}»`);
  return u;
}
