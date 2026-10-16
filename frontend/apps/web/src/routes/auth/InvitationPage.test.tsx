// W1.22 · Экран принятия приглашения `/auth/invitation#token=` (S1-06, no-reference до B-6 №2). Сеть — MSW-сценарный
// сервер на сиде «Альты»: приглашена Олеся Петрова (acc-6, o.petrova@alta.example), членство `invited`.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type MockApp,
  type MockAppOptions,
  renderMockApp,
  tenantIdOf,
} from '../../app/testing.tsx';
import { browser } from './browser.ts';
import { INVITATION_TOKEN_KEY } from './invitation-token.ts';

const ALTA = 'Альта Групп';
const MASKED = 'o•••••@alta.example';
const PETROVA = 'acc-6';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

/** Токен ожидающего приглашения Петровой из состояния сервера. */
function petrovaToken(a: MockApp): string {
  for (const org of Object.values(a.scenario.state().orgs)) {
    const inv = org.invitations.find((i) => i.email === 'o.petrova@alta.example');
    if (inv) return inv.token;
  }
  throw new Error('нет приглашения Петровой');
}

/** Приложение на /auth/login (без запросов), затем ссылка письма с токеном сида. */
async function openLink(o: MockAppOptions & { token?: (a: MockApp) => string } = {}) {
  const probe = await renderMockApp('/auth/login');
  const token = (o.token ?? petrovaToken)(probe);
  probe.close();
  cleanup();
  app = await renderMockApp(`/auth/invitation#token=${token}`, o);
  return { a: app, token };
}

const heading = () => screen.findByRole('heading', { level: 1 });

describe('приглашение действует', () => {
  it('без входа: бизнес, маска почты, срок, «Войти и принять»; фрагмент убран, токен во вкладке', async () => {
    const { a, token } = await openLink();
    expect((await heading()).textContent).toBe(`Приглашение в «${ALTA}»`);
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain(`Приглашение отправлено на ${MASKED}`));
    expect(main.textContent).toContain('8 октября');
    expect(main.textContent).toContain(
      'Войдите под этим адресом — после входа вы вернётесь сюда и примете приглашение.',
    );
    expect(a.router.state.location.hash).toBe('');
    expect(sessionStorage.getItem(INVITATION_TOKEN_KEY)).toBe(token);
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти и принять' }));
    expect(assign).toHaveBeenCalledWith('/api/v1/auth/login?returnTo=%2Fauth%2Finvitation');
    const inspect = a.responses().filter((r) => r.path === '/api/v1/auth/invitations/inspect');
    expect(inspect.map((r) => r.status)).toEqual([200]);
  });

  it('вошла приглашённая: «Принять приглашение» → стартовая страница «Альты», токен забыт', async () => {
    const { a } = await openLink({ persona: PETROVA });
    expect(await screen.findByText('Вы вошли как Олеся Петрова.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Принять приглашение' }));
    const alta = tenantIdOf(a.scenario, ALTA);
    await waitFor(() => expect(a.path()).toMatch(new RegExp(`^/t/${alta}/[a-z-]+$`)));
    expect(within(await screen.findByRole('banner')).getByText(ALTA)).toBeTruthy();
    expect(sessionStorage.getItem(INVITATION_TOKEN_KEY)).toBeNull();
    const accept = a.responses().filter((r) => r.path === '/api/v1/auth/invitations/accept');
    expect(accept.map((r) => r.status)).toEqual([200]);
  });

  it('новая ссылка в открытой вкладке (смена только фрагмента) — новый токен', async () => {
    const { a, token } = await openLink({ token: () => 'Z'.repeat(43) });
    expect((await heading()).textContent).toBe('Приглашение не найдено');
    const real = petrovaToken(a);
    expect(real).not.toBe(token);
    await a.router.navigate({ href: `/auth/invitation#token=${real}` });
    await waitFor(async () =>
      expect((await heading()).textContent).toBe(`Приглашение в «${ALTA}»`),
    );
    expect(sessionStorage.getItem(INVITATION_TOKEN_KEY)).toBe(real);
  });

  it('возврат после входа без фрагмента — токен из вкладки', async () => {
    const probe = await renderMockApp('/auth/login');
    sessionStorage.setItem(INVITATION_TOKEN_KEY, petrovaToken(probe));
    probe.close();
    cleanup();
    app = await renderMockApp('/auth/invitation', { persona: PETROVA });
    expect(await screen.findByRole('button', { name: 'Принять приглашение' })).toBeTruthy();
  });
});

describe('отказы принятия', () => {
  it('другой аккаунт: «Приглашение для другого адреса», «Войти под другим аккаунтом» → logout и провайдер', async () => {
    const { a } = await openLink({ persona: 'owner@t-lotos' });
    expect(await screen.findByText('Вы вошли как Ирина Белова.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Принять приглашение' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Приглашение для другого адреса');
    expect(alert.textContent).toContain(
      `Приглашение отправлено на ${MASKED}. Войдите под этим адресом.`,
    );
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Войти под другим аккаунтом' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[0]?.[0]).toMatch(/^https:\/\/id\.example\.invalid\//);
    expect(
      a
        .responses()
        .filter((r) => r.path === '/api/v1/auth/logout')
        .map((r) => r.status),
    ).toEqual([200]);
  });

  it('нет мест (seats_exhausted): текст словаря, кнопка остаётся', async () => {
    await openLink({ persona: PETROVA, scenario: 'acceptInvitation=seats_exhausted' });
    fireEvent.click(await screen.findByRole('button', { name: 'Принять приглашение' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Приглашение не принято');
    expect(alert.textContent).toContain(
      'Свободных мест нет. Отзовите приглашение или запросите расширение тарифа.',
    );
    expect(screen.getByRole('button', { name: 'Принять приглашение' })).toBeTruthy();
  });

  it('уже принято или отозвано (409 invalid_transition): текст и перепроверка приглашения', async () => {
    const { a } = await openLink({
      persona: PETROVA,
      scenario: 'acceptInvitation=invalid_transition',
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Принять приглашение' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Приглашение уже принято или отозвано',
    );
    await waitFor(() =>
      expect(
        a.responses().filter((r) => r.path === '/api/v1/auth/invitations/inspect'),
      ).toHaveLength(2),
    );
  });

  it('сессия потеряна до принятия (401 session_expired): только «Войти и принять», без «Вы вошли как»', async () => {
    const { a } = await openLink({ persona: PETROVA });
    expect(await screen.findByText('Вы вошли как Олеся Петрова.')).toBeTruthy();
    a.scenario.setScenario('session_expired');
    fireEvent.click(screen.getByRole('button', { name: 'Принять приглашение' }));
    expect(await screen.findByRole('button', { name: 'Войти и принять' })).toBeTruthy();
    const main = screen.getByRole('main');
    expect(main.textContent).toContain(
      'Войдите под этим адресом — после входа вы вернётесь сюда и примете приглашение.',
    );
    expect(main.textContent).not.toContain('Вы вошли как');
    expect(screen.queryByRole('button', { name: 'Принять приглашение' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Войти под другим аккаунтом' })).toBeNull();
    const accept = a.responses().filter((r) => r.path === '/api/v1/auth/invitations/accept');
    expect(accept.map((r) => r.status)).toEqual([401]);
    expect(sessionStorage.getItem(INVITATION_TOKEN_KEY)).not.toBeNull();
  });

  it('срок истёк при принятии (410): экран «Срок приглашения истёк»', async () => {
    await openLink({ persona: PETROVA, scenario: 'acceptInvitation=public_token_expired' });
    fireEvent.click(await screen.findByRole('button', { name: 'Принять приглашение' }));
    await waitFor(async () => expect((await heading()).textContent).toBe('Срок приглашения истёк'));
  });
});

describe('приглашение не действует', () => {
  it('истекло: «Срок приглашения истёк», кнопок нет, «Перейти ко входу»; токен забыт', async () => {
    await openLink({ setup: (s) => s.setNow('2026-10-09T00:00:00Z') });
    expect((await heading()).textContent).toBe('Срок приглашения истёк');
    expect(screen.getByRole('main').textContent).toContain(
      `Попросите владельца «${ALTA}» отправить приглашение ещё раз.`,
    );
    expect(screen.queryByRole('button', { name: 'Войти и принять' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Перейти ко входу' }).getAttribute('href')).toBe(
      '/auth/login',
    );
    expect(sessionStorage.getItem(INVITATION_TOKEN_KEY)).toBeNull();
  });

  it('отозвано: «Приглашение отозвано»', async () => {
    await openLink({
      setup: (s) => {
        for (const org of Object.values(s.state().orgs)) {
          for (const i of org.invitations) i.status = 'revoked';
        }
      },
    });
    expect((await heading()).textContent).toBe('Приглашение отозвано');
    expect(screen.getByRole('main').textContent).toContain(
      `Ссылка больше не действует. Если приглашение нужно, обратитесь к владельцу «${ALTA}».`,
    );
  });

  it('уже принято: «Приглашение уже принято», «Открыть рабочее пространство»', async () => {
    await openLink({
      setup: (s) => {
        for (const org of Object.values(s.state().orgs)) {
          for (const i of org.invitations) i.status = 'accepted';
        }
      },
    });
    expect((await heading()).textContent).toBe('Приглашение уже принято');
    expect(
      screen.getByRole('link', { name: 'Открыть рабочее пространство' }).getAttribute('href'),
    ).toBe('/');
  });

  it('неизвестный токен (404) и ссылка без токена — «Приглашение не найдено»', async () => {
    await openLink({ token: () => 'Z'.repeat(43) });
    expect((await heading()).textContent).toBe('Приглашение не найдено');
    cleanup();
    app?.close();
    sessionStorage.clear();
    app = await renderMockApp('/auth/invitation');
    expect((await heading()).textContent).toBe('Приглашение не найдено');
    expect(app.responses().filter((r) => r.path.startsWith('/api/v1/auth/invitations'))).toEqual(
      [],
    );
  });

  it('загрузка: «Проверяем приглашение…» (status), кнопок нет', async () => {
    await openLink({ scenario: 'inspectInvitation=loading' });
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('Проверяем приглашение…');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('нет связи при проверке: «Не удалось проверить приглашение», текст офлайна, «Повторить»', async () => {
    const { a } = await openLink({ scenario: 'inspectInvitation=offline' });
    expect((await heading()).textContent).toBe('Не удалось проверить приглашение');
    expect(screen.getByRole('main').textContent).toContain(
      'Нет связи с сервером. Операция не выполнена.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(async () =>
      expect((await heading()).textContent).toBe(`Приглашение в «${ALTA}»`),
    );
  });

  it('сбой /me/context: приглашение показано, баннер «Не удалось проверить вход», «Повторить»', async () => {
    const { a } = await openLink({ scenario: 'getMyContext=offline' });
    expect((await heading()).textContent).toBe(`Приглашение в «${ALTA}»`);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Не удалось проверить вход');
    expect(alert.textContent).toContain('Нет связи с сервером. Операция не выполнена.');
    expect(alert.textContent).not.toContain('Не удалось проверить приглашение');
    a.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    expect(
      await screen.findByText(
        'Войдите под этим адресом — после входа вы вернётесь сюда и примете приглашение.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('сбой проверки: «Не удалось проверить приглашение», «Повторить» → приглашение', async () => {
    const { a } = await openLink({ scenario: 'inspectInvitation=rate_limited' });
    expect((await heading()).textContent).toBe('Не удалось проверить приглашение');
    expect(screen.getByRole('main').textContent).toContain(
      'Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(async () =>
      expect((await heading()).textContent).toBe(`Приглашение в «${ALTA}»`),
    );
  });

  it('«Повторить» после сбоя проверки: фокус — на заголовке загруженного приглашения', async () => {
    const { a } = await openLink({ scenario: 'inspectInvitation=rate_limited' });
    expect((await heading()).textContent).toBe('Не удалось проверить приглашение');
    a.scenario.setScenario(null);
    const retry = screen.getByRole('button', { name: 'Повторить' });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(async () =>
      expect((await heading()).textContent).toBe(`Приглашение в «${ALTA}»`),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })),
    );
  });

  it('первая загрузка без «Повторить» фокус не трогает', async () => {
    await openLink();
    expect((await heading()).textContent).toBe(`Приглашение в «${ALTA}»`);
    expect(document.activeElement).toBe(document.body);
  });
});
