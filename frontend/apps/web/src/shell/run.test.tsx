// W1.20 · Хук команд и тост (01-shell.md §13; run :2419–2434, toast :2414–2418, toastVM :2885–2891).
// Тост успеха — только после ответа сервера; ошибка — текстом @ortus/texts по Problem.code; «тихие» коды
// (A §2) не тостятся и пробрасываются вызывающему; нет сети — тон warn.
import { ProblemError } from '@ortus/api-client';
import { errors } from '@ortus/texts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ME_CONTEXT_KEY } from './me.ts';
import { RunProvider, problemText, useBusy, useRun } from './run.tsx';
import { TOAST_MS, ToastHost, ToastProvider, useToast } from './toast.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RunProvider>
          {children}
          <ToastHost />
        </RunProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => ({ run: useRun(), busy: useBusy('save') }), { wrapper });
  return { hook, invalidate };
}

const problem = (status: number, code: string) =>
  new ProblemError(status, {
    type: `https://docs.ortus.example/errors/${code}`,
    title: code,
    status,
    code: code as never,
    requestId: 'r-1',
  });

describe('useRun', () => {
  it('успех: результат, тост okText со статусом, busy снимается', async () => {
    const { hook } = setup();
    let release: (v: number) => void = () => undefined;
    let p!: Promise<number>;
    act(() => {
      p = hook.result.current.run(
        'save',
        () => new Promise<number>((r) => (release = r)),
        'Готово',
      );
    });
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      release(7);
      expect(await p).toBe(7);
    });
    expect(hook.result.current.busy).toBe(false);
    const toast = screen.getByRole('status');
    expect(toast.textContent).toContain('Готово');
    expect(toast.getAttribute('aria-live')).toBe('polite');
  });

  it('ошибка с кодом: тост alert с текстом словаря, исключение пробрасывается', async () => {
    const { hook, invalidate } = setup();
    await act(async () => {
      await expect(
        hook.result.current.run('save', () => Promise.reject(problem(403, 'forbidden_action'))),
      ).rejects.toBeInstanceOf(ProblemError);
    });
    expect(screen.getByRole('alert').textContent).toContain(errors.problem.forbidden_action);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_CONTEXT_KEY });
  });

  it('«тихий» код: тоста нет, исключение пробрасывается', async () => {
    const { hook } = setup();
    await act(async () => {
      await expect(
        hook.result.current.run(
          'save',
          () => Promise.reject(problem(422, 'validation_failed')),
          'ok',
          {
            quiet: ['validation_failed'],
          },
        ),
      ).rejects.toBeInstanceOf(ProblemError);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('нет связи: тон warn и «Нет связи с сервером. Операция не выполнена.»', async () => {
    const { hook } = setup();
    await act(async () => {
      await expect(
        hook.result.current.run('save', () => Promise.reject(new TypeError('Failed to fetch'))),
      ).rejects.toBeInstanceOf(TypeError);
    });
    const toast = screen.getByRole('status');
    expect(toast.textContent).toContain(errors.client.offline);
    expect(toast.dataset.tone).toBe('warn');
  });
});

describe('useBusy', () => {
  it('занятость по ключу: окончание одной команды не снимает занятость другой', async () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <RunProvider>{children}</RunProvider>
        </ToastProvider>
      </QueryClientProvider>
    );
    const hook = renderHook(
      () => ({ run: useRun(), save: useBusy('save'), logout: useBusy('logout'), any: useBusy() }),
      { wrapper },
    );
    const done: Record<string, () => void> = {};
    let save!: Promise<void>;
    let logout!: Promise<void>;
    act(() => {
      save = hook.result.current.run('save', () => new Promise<void>((r) => (done.save = r)));
      logout = hook.result.current.run('logout', () => new Promise<void>((r) => (done.logout = r)));
    });
    expect([hook.result.current.save, hook.result.current.logout]).toEqual([true, true]);
    await act(async () => {
      done.save?.();
      await save;
    });
    expect(hook.result.current.save).toBe(false);
    expect(hook.result.current.logout).toBe(true);
    expect(hook.result.current.any).toBe(true);
    await act(async () => {
      done.logout?.();
      await logout;
    });
    expect(hook.result.current.any).toBe(false);
  });
});

describe('problemText', () => {
  it('код вне словаря — текст по статусу, иначе «Ошибка»', () => {
    expect(problemText(problem(409, 'something_new'))).toBe(errors.http.http409);
    expect(problemText(new ProblemError(418))).toBe(errors.fallback);
    expect(problemText(new Error('x'))).toBe(errors.fallback);
  });
});

describe('тост', () => {
  it('один тост, 4200 мс; повтор сбрасывает таймер', () => {
    vi.useFakeTimers();
    function Show() {
      const toast = useToast();
      return (
        <>
          <button type="button" onClick={() => toast('Первый')}>
            1
          </button>
          <button type="button" onClick={() => toast('Второй', 'info')}>
            2
          </button>
          <ToastHost />
        </>
      );
    }
    render(
      <ToastProvider>
        <Show />
      </ToastProvider>,
    );
    act(() => screen.getByText('1').click());
    act(() => vi.advanceTimersByTime(TOAST_MS - 1000));
    act(() => screen.getByText('2').click());
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(screen.getByRole('status').textContent).toContain('Второй');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
