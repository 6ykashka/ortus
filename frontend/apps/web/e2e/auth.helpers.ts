// W1.22 · Помощники e2e входа и приглашения: приглашения сида сценарного сервера (только mock), имитация BFF и
// провайдера входа для навигации на startLogin (service worker MSW навигацию не перехватывает), письмо приглашения
// из Mailpit (стенд, W1.41). Порты и адреса — из окружения харнесса.
import { expect, type Page } from '@playwright/test';

import { call } from './shell.helpers.ts';

export interface SeedInvitation {
  tenantId: string;
  email: string;
  status: string;
  token: string;
}

/** Нарушения axe уровня serious/critical (verification-protocol §1 п. 3). */
export const serious = (r: { violations: { id: string; impact?: string | null }[] }): string[] =>
  r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);

/** Горизонтальная прокрутка страницы, px (на 390 — 0). */
export const overflowX = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Приглашённая сида «Альты»: Олеся Петрова (acc-6), членство `invited`. */
export const PETROVA = {
  subject: 'acc-6',
  email: 'o.petrova@alta.example',
  masked: 'o•••••@alta.example',
  name: 'Олеся Петрова',
} as const;

export const INVITATION_PATH = '/auth/invitation';
export const START_LOGIN = '/api/v1/auth/login';

/** Ссылка письма: токен во фрагменте (W1.41, Q-W1.41-3). */
export const invitationLink = (token: string): string => `${INVITATION_PATH}#token=${token}`;

/** Приглашения сида (GET /api/v1/dev/scenario, только mock). Нужна загруженная страница приложения. */
export async function seedInvitations(page: Page): Promise<SeedInvitation[]> {
  const r = await call(page, 'GET', '/api/v1/dev/scenario');
  if (r.status !== 200) throw new Error(`dev/scenario ${r.status}`);
  return (r.body as { invitations: SeedInvitation[] }).invitations;
}

/** Токен ожидающего приглашения по адресу (только mock). */
export async function seedToken(page: Page, email: string = PETROVA.email): Promise<string> {
  const inv = (await seedInvitations(page)).find(
    (i) => i.email === email && i.status === 'pending',
  );
  if (!inv) throw new Error(`нет ожидающего приглашения ${email} в сиде`);
  return inv.token;
}

/**
 * Имитация BFF и провайдера (режим mock): навигация на startLogin отвечает 302 на `returnTo` с dev-входом
 * `?persona=` (только e2e-сборка, PD-54). Возвращает журнал адресов startLogin (путь и запрос).
 */
export async function fakeIdp(page: Page, persona: string): Promise<string[]> {
  const seen: string[] = [];
  await page.route(`**${START_LOGIN}**`, async (route) => {
    const url = new URL(route.request().url());
    seen.push(url.pathname + url.search);
    const back = new URL(url.searchParams.get('returnTo') ?? '/', url.origin);
    back.searchParams.set('persona', persona);
    await route.fulfill({ status: 302, headers: { Location: back.pathname + back.search } });
  });
  return seen;
}

/** Состояние сценарного сервера вкладки (режим mock): `startMockWorker` читает его из sessionStorage при старте. */
export const MOCK_STATE_KEY = 'ortus:msw:state';

/**
 * Все приглашения сида — в статус `status` (только mock). Правка состояния сценарного сервера init-скриптом: один раз,
 * на следующей загрузке страницы до старта MSW (запись идёт до приложения — без гонки с его сохранением состояния).
 * Нужна уже загруженная страница приложения (состояние создано).
 */
export async function setSeedInvitationsStatus(page: Page, status: string): Promise<void> {
  await page.addInitScript(
    ({ key, st }) => {
      const done = `e2e:invitations:${st}`;
      const raw = sessionStorage.getItem(key);
      if (sessionStorage.getItem(done) || !raw) return;
      const s = JSON.parse(raw) as { orgs: Record<string, { invitations: { status: string }[] }> };
      for (const org of Object.values(s.orgs)) for (const i of org.invitations) i.status = st;
      sessionStorage.setItem(key, JSON.stringify(s));
      sessionStorage.setItem(done, '1');
    },
    { key: MOCK_STATE_KEY, st: status },
  );
}

/** Dev-вход произвольного subject сида или нового человека (W1.50, только stand) из страницы. */
export async function devLoginAs(page: Page, body: Record<string, string>): Promise<void> {
  const r = await call(page, 'POST', '/api/v1/dev/login', { body });
  if (r.status !== 200) throw new Error(`dev/login ${r.status}: ${JSON.stringify(r.body)}`);
}

interface MailpitList {
  messages: { ID: string; To: { Address: string }[] }[];
}

/** Токен из письма приглашения в Mailpit (`E2E_MAILPIT_URL` — API Mailpit стенда слота). */
export async function mailpitToken(page: Page, mailpit: string, to: string): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        const r = await page.request.get(`${mailpit}/api/v1/messages`);
        const list = (await r.json()) as MailpitList;
        id = list.messages.find((m) => m.To.some((t) => t.Address === to))?.ID ?? '';
        return id;
      },
      { message: `письмо на ${to} в Mailpit`, timeout: 15_000 },
    )
    .not.toBe('');
  const full = (await (await page.request.get(`${mailpit}/api/v1/message/${id}`)).json()) as {
    Text: string;
  };
  const m = /\/auth\/invitation#token=([A-Za-z0-9_-]+)/.exec(full.Text);
  if (!m?.[1]) throw new Error('в письме нет ссылки /auth/invitation#token=');
  return m[1];
}
