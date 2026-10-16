// W1.22 · Экран входа `/auth/login` (S1-05, no-reference до B-6 №1): без запросов к API на загрузке, «Войти» —
// навигация на BFF startLogin с путём возврата из ?next=, ошибки ?error=. Сеть — MSW-сценарный сервер.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../app/testing.tsx';
import { browser } from './browser.ts';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  cleanup();
  vi.restoreAllMocks();
});

const open = async (url: string) => {
  app = await renderMockApp(url);
  return app;
};

describe('экран «Вход»', () => {
  it('заголовок, подпись, «Войти»; без оболочки и без запросов к API', async () => {
    const a = await open('/auth/login');
    expect(await screen.findByRole('heading', { level: 1, name: 'Вход' })).toBeTruthy();
    expect(screen.getByText('Войдите, чтобы открыть рабочее пространство бизнеса.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeTruthy();
    expect(screen.queryByRole('banner')).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(a.responses()).toEqual([]);
  });

  it('«Войти» → startLogin с returnTo из ?next=, кнопка занята', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    await open('/auth/login?next=%2Ft%2Ft-alta%2Fusers');
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    expect(assign).toHaveBeenCalledWith('/api/v1/auth/login?returnTo=%2Ft%2Ft-alta%2Fusers');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Переходим ко входу…' }).hasAttribute('disabled'),
      ).toBe(true),
    );
  });

  it('?next= на чужой сайт → returnTo=/', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    await open('/auth/login?next=%2F%2Fevil.example');
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    expect(assign).toHaveBeenCalledWith('/api/v1/auth/login?returnTo=%2F');
  });

  it('вход оператора: next=/platform/tenants', async () => {
    await open('/auth/login?next=%2Fplatform%2Ftenants');
    expect(
      await screen.findByText(
        'Вход в управление платформой. Отдельный вход · без доступа к данным клиентов.',
      ),
    ).toBeTruthy();
  });

  it('?error=session_expired без ?next= — «Нужен вход», без обещания вернуть на экран', async () => {
    await open('/auth/login?error=session_expired');
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Нужен вход');
    expect(status.textContent).toContain('Сессия истекла. Войдите снова.');
    expect(status.textContent).not.toContain('этот экран');
    expect(status.textContent).not.toContain('прежнюю страницу');
  });

  it('?error=session_expired с ?next= — вернётесь на прежнюю страницу', async () => {
    await open('/auth/login?error=session_expired&next=%2Ft%2Ft-alta%2Fusers');
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(
      'Сессия истекла. Войдите снова — после входа вы вернётесь на прежнюю страницу.',
    );
  });

  it.each([
    ['forbidden_action', 'Вход отклонён: учётная запись заблокирована или доступ не подтверждён.'],
    ['access_denied', 'Вход отклонён: учётная запись заблокирована или доступ не подтверждён.'],
    ['dependency_unavailable', 'Сервис временно недоступен. Повторите позже.'],
    ['что-то', 'Повторите вход.'],
    ['__proto__', 'Повторите вход.'],
    ['toString', 'Повторите вход.'],
    ['constructor', 'Повторите вход.'],
    ['hasOwnProperty', 'Повторите вход.'],
  ])('?error=%s — «Вход не выполнен»', async (code, text) => {
    await open(`/auth/login?error=${encodeURIComponent(code)}`);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Вход не выполнен');
    expect(alert.textContent).toContain(text);
    expect(screen.getByRole('button', { name: 'Войти' })).toBeTruthy();
  });

  it('?signedOut=1 — «Вы вышли» после выхода, без запросов к API', async () => {
    const a = await open('/auth/login?signedOut=1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Вход' })).toBeTruthy();
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Вы вышли');
    expect(status.textContent).toContain(
      'Сеанс на этом устройстве завершён. Чтобы продолжить работу, войдите снова.',
    );
    expect(screen.getByRole('button', { name: 'Войти' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(a.responses()).toEqual([]);
  });

  it('без ?signedOut= «Вы вышли» нет', async () => {
    await open('/auth/login');
    await screen.findByRole('button', { name: 'Войти' });
    expect(screen.queryByText('Вы вышли')).toBeNull();
  });

  it('нет связи: «Войти» не уходит со страницы — «Нет связи», кнопка свободна; со связью — уходит', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await open('/auth/login');
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Нет связи');
    expect(alert.textContent).toContain(
      'Проверьте подключение к интернету и нажмите «Войти» ещё раз.',
    );
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Войти' }).hasAttribute('disabled')).toBe(false);
    online.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(assign).toHaveBeenCalledWith('/api/v1/auth/login?returnTo=%2F');
    await waitFor(() => expect(screen.queryByText('Нет связи')).toBeNull());
  });
});
