// W1.24 · Экранные тесты `modal-upload` «Загрузка файла» (S1-20, no-reference B-6): сессия загрузки
// initiateUpload → PUT по билету → completeUpload → проверка (getFile) на MSW-сценарном сервере (сид W0.12).
// PUT по ссылке хранилища MSW не обслуживает — подменяется функцией `put` (это не мок fetch API: запросы к API
// идут в сценарный сервер).
import { ApiProvider } from '../../../../app/api.tsx';
import { createApiClient, devLogin } from '@ortus/api-client';
import type { CookieJar, ScenarioServer } from '@ortus/adapter/msw';
import { createNodeServer } from '@ortus/adapter/msw/node';
import { seedUuid } from '@ortus/domain/seed';
import { errors } from '@ortus/texts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type PutObject, putObject, UploadDialog } from './upload.tsx';

const BASE = 'http://ortus.test';
const ALTA = seedUuid('platform', 't-alta');
const TRIP = seedUuid('t-alta', 'Р-208');
let SEED_UPLOAD = '';

let close: (() => void) | undefined;
afterEach(() => {
  close?.();
  close = undefined;
});

async function setup(
  o: {
    preset?: 'storage-full';
    put?: PutObject;
    scenarioSpec?: string;
    pollMax?: number;
    /** Кнопка-открыватель: в фокусе до открытия диалога. */
    opener?: HTMLElement;
  } = {},
) {
  o.opener?.focus();
  const store = new Map<string, string>();
  const jar: CookieJar = {
    read: () => Object.fromEntries(store),
    write: (_h, cookies) => {
      for (const c of cookies) {
        if (c.maxAge === 0) store.delete(c.name);
        else store.set(c.name, c.value);
      }
    },
  };
  const { server, scenario } = createNodeServer({ cookies: jar });
  server.listen({ onUnhandledRequest: 'error' });
  if (o.preset) scenario.applyPreset(o.preset);
  await devLogin('owner', { baseUrl: BASE });
  SEED_UPLOAD = scenario.state().orgs[ALTA]?.uploads[0]?.uploadId ?? '';
  if (o.scenarioSpec) scenario.setScenario(o.scenarioSpec);
  const api = createApiClient({ baseUrl: BASE, csrfToken: () => store.get('ortus_csrf') });
  const put = vi.fn<PutObject>(o.put ?? (() => Promise.resolve()));
  const onClose = vi.fn();
  const onDone = vi.fn();
  const view = render(
    <ApiProvider value={api}>
      <UploadDialog
        tenantId={ALTA}
        purpose="expense_receipt"
        owner={{ moduleKey: 'fleet', entityType: 'trip', entityId: TRIP }}
        onClose={onClose}
        onDone={onDone}
        put={put}
        pollMs={5}
        {...(o.pollMax ? { pollMax: o.pollMax } : {})}
      />
    </ApiProvider>,
  );
  let mounted = true;
  const unmount = () => {
    if (mounted) view.unmount();
    mounted = false;
  };
  close = () => {
    unmount();
    server.close();
  };
  return { scenario, put, onClose, onDone, unmount };
}

const pick = (name = 'Чек АЗС.jpg', type = 'image/jpeg') =>
  fireEvent.change(screen.getByLabelText('Выбрать файл'), {
    target: { files: [new File(['чек'], name, { type })] },
  });

/** Проверка файлов завершена (антивирус режима mock: карантин → готов). */
const scanned = (s: ScenarioServer) => {
  for (const org of Object.values(s.state().orgs)) {
    for (const f of org.files) if (f.status === 'quarantined') f.status = 'ready';
  }
};

describe('«Загрузка файла»', () => {
  it('диалог: заголовок, выбор файла, «Закрыть»', async () => {
    const { onClose } = await setup();
    expect(screen.getByRole('dialog', { name: 'Загрузка файла' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('резерв → PUT по билету → завершение → проверка → «Файл готов»', async () => {
    const { scenario, put, onDone } = await setup();
    pick();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [url, blob, type] = put.mock.calls[0] ?? [];
    expect(url).toMatch(/^https:\/\/storage\.example\.invalid\/uploads\//);
    expect((blob as File).name).toBe('Чек АЗС.jpg');
    expect(type).toBe('image/jpeg');
    expect(await screen.findByText('Файл загружен и проверяется')).toBeTruthy();
    scanned(scenario);
    expect(await screen.findByText('Файл готов')).toBeTruthy();
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'Чек АЗС.jpg', status: 'ready' }),
    );
  });

  it('место заполнено: отказ quota_exceeded текстом в диалоге, PUT не выполняется', async () => {
    const { put } = await setup({ preset: 'storage-full' });
    pick();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Место организации заполнено. Загрузка новых файлов недоступна.',
    );
    expect(put).not.toHaveBeenCalled();
  });

  it('сбой передачи: «Загрузка не удалась. Повторите.» и «Повторить» — новая сессия', async () => {
    let n = 0;
    const { put } = await setup({
      put: () => (n++ === 0 ? Promise.reject(new TypeError('network')) : Promise.resolve()),
    });
    pick();
    expect((await screen.findByRole('alert')).textContent).toBe('Загрузка не удалась. Повторите.');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Файл загружен и проверяется')).toBeTruthy();
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('«Отменить загрузку» во время передачи: abortUpload, резерв освобождён', async () => {
    let release: (() => void) | undefined;
    const { scenario } = await setup({
      put: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    pick();
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить загрузку' }));
    await waitFor(() => {
      const t = scenario.state().tenants.find((x) => x.id === ALTA);
      expect(t?.storage.reservedBytes).toBe(0);
    });
    expect(await screen.findByText('Загрузка отменена')).toBeTruthy();
    release?.();
  });

  it('«Отменить загрузку» до ответа initiateUpload: сессия отменяется, PUT не выполняется', async () => {
    const { scenario, put } = await setup({ scenarioSpec: 'initiateUpload=delay=150' });
    pick();
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить загрузку' }));
    expect(await screen.findByText('Загрузка отменена')).toBeTruthy();
    await waitFor(() => expect(sessions(scenario).map((u) => u.state)).toEqual(['aborted']));
    expect(reserved(scenario)).toBe(0);
    expect(put).not.toHaveBeenCalled();
  });

  it('отмена до ответа initiateUpload, затем новый файл: прежняя попытка не выполняет PUT и отменяет свою сессию', async () => {
    const { scenario, put } = await setup({ scenarioSpec: 'initiateUpload=delay=150' });
    pick('Старый.jpg');
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить загрузку' }));
    expect(await screen.findByText('Загрузка отменена')).toBeTruthy();
    // Новый файл выбран, пока initiateUpload прежней попытки ещё в пути.
    pick('Новый.jpg');
    await waitFor(() => expect(sessions(scenario)).toHaveLength(2));
    expect(await screen.findByText('Файл загружен и проверяется')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(put.mock.calls.map(([, f]) => (f as File).name)).toEqual(['Новый.jpg']);
    const states = sessions(scenario).map((u) => u.state);
    expect(states).toContain('aborted');
    expect(states.filter((s) => s === 'aborted')).toHaveLength(1);
  });

  it('диалог закрыт во время передачи: сессия отменяется, completeUpload не вызывается', async () => {
    let release: (() => void) | undefined;
    const { scenario, unmount } = await setup({
      put: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    pick();
    await screen.findByRole('button', { name: 'Отменить загрузку' });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    unmount();
    await waitFor(() => expect(sessions(scenario).map((u) => u.state)).toEqual(['aborted']));
    release?.();
    await new Promise((r) => setTimeout(r, 30));
    expect(sessions(scenario).map((u) => u.state)).toEqual(['aborted']);
    expect(reserved(scenario)).toBe(0);
  });

  it('«Отменить загрузку» во время передачи прерывает PUT (AbortSignal)', async () => {
    let signal: AbortSignal | undefined;
    await setup({
      // Передача не заканчивается сама — её прерывает только сигнал отмены.
      put: (_u: string, _f: Blob, _t: string, s?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal = s;
          s?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    });
    pick();
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить загрузку' }));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(await screen.findByText('Загрузка отменена')).toBeTruthy();
  });

  it('после передачи, пока идёт completeUpload: «Отменить загрузку» скрыта — отменять уже нечего', async () => {
    const { put, scenario } = await setup({ scenarioSpec: 'completeUpload=delay=300' });
    pick();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Отменить загрузку' })).toBeNull(),
    );
    // Сессия ещё не завершена: completeUpload в пути, а кнопки отмены уже нет.
    expect(sessions(scenario).map((u) => u.state)).not.toContain('completed');
    expect(await screen.findByText('Файл загружен и проверяется')).toBeTruthy();
    expect(sessions(scenario).map((u) => u.state)).not.toContain('aborted');
  });

  it('проверка дольше лимита опроса: текст «проверка ещё идёт», а не молчаливое «проверяется»', async () => {
    await setup({ pollMax: 2 });
    pick();
    expect(await screen.findByText('Файл загружен и проверяется')).toBeTruthy();
    expect(
      await screen.findByText(
        'Проверка занимает больше обычного. Файл появится в разделе «Файлы», когда проверка закончится.',
      ),
    ).toBeTruthy();
  });

  it('сбой передачи: доступны и «Повторить», и «Выбрать файл»', async () => {
    await setup({ put: () => Promise.reject(new TypeError('network')) });
    pick();
    expect((await screen.findByRole('alert')).textContent).toBe('Загрузка не удалась. Повторите.');
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.getByLabelText('Выбрать файл')).toBeTruthy();
  });
});

describe('«Загрузка файла»: сбой completeUpload — сессия не висит с резервом места', () => {
  it('completeUpload=offline → «Повторить»: прежняя сессия aborted, резерв 0', async () => {
    const { scenario, put } = await setup({ scenarioSpec: 'completeUpload=offline' });
    pick();
    await screen.findByRole('alert');
    expect(sessions(scenario).map((u) => u.state)).toEqual(['issued']);
    scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Файл загружен и проверяется')).toBeTruthy();
    expect(put).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(sessions(scenario).map((u) => u.state)).toEqual(['aborted', 'completed']),
    );
    expect(reserved(scenario)).toBe(0);
  });

  it('completeUpload=offline → «Закрыть»: сессия aborted, резерв 0', async () => {
    const { scenario, onClose } = await setup({ scenarioSpec: 'completeUpload=offline' });
    pick();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(sessions(scenario).map((u) => u.state)).toEqual(['aborted']));
    expect(reserved(scenario)).toBe(0);
  });

  it('completeUpload=offline → Escape: сессия aborted, резерв 0', async () => {
    const { scenario, onClose } = await setup({ scenarioSpec: 'completeUpload=offline' });
    pick();
    await screen.findByRole('alert');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(sessions(scenario).map((u) => u.state)).toEqual(['aborted']));
    expect(reserved(scenario)).toBe(0);
  });

  it('completeUpload=offline → другой файл: прежняя сессия aborted', async () => {
    const { scenario } = await setup({ scenarioSpec: 'completeUpload=offline' });
    pick('Первый.jpg');
    await screen.findByRole('alert');
    scenario.setScenario(null);
    pick('Второй.jpg');
    expect(await screen.findByText('Файл загружен и проверяется')).toBeTruthy();
    await waitFor(() =>
      expect(sessions(scenario).map((u) => u.state)).toEqual(['aborted', 'completed']),
    );
    expect(reserved(scenario)).toBe(0);
  });

  it('completeUpload в пути, диалог закрыт: переданный файл не отменяется, сессия завершается', async () => {
    // Сессия снова отменяема только после отказа completeUpload; пока сверка в пути — файл передан.
    const { scenario, put, unmount } = await setup({ scenarioSpec: 'completeUpload=delay=150' });
    pick();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Отменить загрузку' })).toBeNull(),
    );
    unmount();
    await waitFor(() => expect(sessions(scenario).map((u) => u.state)).toEqual(['completed']));
    expect(reserved(scenario)).toBe(0);
  });
});

describe('«Загрузка файла»: нет связи и прогресс', () => {
  it('initiateUpload=offline: alert «Нет связи с сервером…», как на других экранах, «Повторить» есть', async () => {
    await setup({ scenarioSpec: 'initiateUpload=offline' });
    pick();
    expect((await screen.findByRole('alert')).textContent).toBe(errors.client.offline);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('completeUpload=offline: alert «Нет связи с сервером…», «Повторить» есть', async () => {
    await setup({ scenarioSpec: 'completeUpload=offline' });
    pick();
    expect((await screen.findByRole('alert')).textContent).toBe(errors.client.offline);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('передача: полоса прогресса по onProgress — доля и процент', async () => {
    let report: ((loaded: number, total: number) => void) | undefined;
    await setup({
      put: (_u, _f, _t, _s, onProgress) => {
        report = onProgress;
        return new Promise<void>(() => {
          /* передача идёт */
        });
      },
    });
    pick();
    const bar = await screen.findByRole('progressbar', { name: 'Загружаем…' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    await waitFor(() => expect(report).toBeTypeOf('function'));
    act(() => report?.(3, 6));
    await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('50'));
    expect(bar.getAttribute('aria-valuetext')).toBe('50 %');
    expect(screen.getByText('50 %')).toBeTruthy();
  });
});

describe('putObject: PUT по билету через XMLHttpRequest', () => {
  /** Подмена XMLHttpRequest: адрес хранилища вне сценарного сервера, нужен ход передачи (upload.onprogress). */
  class FakeXhr {
    static last: FakeXhr | undefined;
    method = '';
    url = '';
    headers: Record<string, string> = {};
    body: unknown;
    status = 0;
    aborted = false;
    upload: {
      onprogress:
        ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
    } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    constructor() {
      FakeXhr.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    send(body: unknown) {
      this.body = body;
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
  }
  afterEach(() => vi.unstubAllGlobals());

  it('PUT с подписанным Content-Type, ход передачи — onProgress, 200 — успех', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const seen: [number, number][] = [];
    const file = new File(['чек'], 'Чек.jpg', { type: 'image/jpeg' });
    const done = putObject(
      'https://storage.example.invalid/u/1',
      file,
      'image/jpeg',
      undefined,
      (l, t) => seen.push([l, t]),
    );
    const x = FakeXhr.last as FakeXhr;
    expect(x.method).toBe('PUT');
    expect(x.url).toBe('https://storage.example.invalid/u/1');
    expect(x.headers['Content-Type']).toBe('image/jpeg');
    expect(x.body).toBe(file);
    x.upload.onprogress?.({ loaded: 3, total: 6, lengthComputable: true });
    x.status = 200;
    x.onload?.();
    await expect(done).resolves.toBeUndefined();
    expect(seen).toEqual([[3, 6]]);
  });

  it('ответ не 2xx и сетевой сбой — отказ TypeError', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const file = new File(['чек'], 'Чек.jpg', { type: 'image/jpeg' });
    const denied = putObject('https://storage.example.invalid/u/1', file, 'image/jpeg');
    const x = FakeXhr.last as FakeXhr;
    x.status = 403;
    x.onload?.();
    await expect(denied).rejects.toBeInstanceOf(TypeError);
    const lost = putObject('https://storage.example.invalid/u/2', file, 'image/jpeg');
    FakeXhr.last?.onerror?.();
    await expect(lost).rejects.toBeInstanceOf(TypeError);
  });

  it('AbortSignal прерывает передачу: xhr.abort, отказ AbortError', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const ctrl = new AbortController();
    const file = new File(['чек'], 'Чек.jpg', { type: 'image/jpeg' });
    const p = putObject('https://storage.example.invalid/u/1', file, 'image/jpeg', ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last?.aborted).toBe(true);
  });
});

describe('«Загрузка файла»: отказ, который повтор того же файла не исправит', () => {
  /** Файл указанного размера без выделения памяти: MSW сверяет UploadCreate.sizeBytes. */
  const sized = (name: string, size: number): File => {
    const f = new File(['большой'], name, { type: 'image/jpeg' });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };

  it('payload_too_large: alert по коду, «Повторить» нет, «Выбрать файл» — другой файл загружается', async () => {
    const { put } = await setup();
    fireEvent.change(screen.getByLabelText('Выбрать файл'), {
      target: { files: [sized('Большой.jpg', 21 * 1024 * 1024)] },
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Файл или запрос больше допустимого размера.',
    );
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
    expect(put).not.toHaveBeenCalled();
    pick('Маленький.jpg');
    expect(await screen.findByText('Файл загружен и проверяется')).toBeTruthy();
    expect(put.mock.calls.map(([, f]) => (f as File).name)).toEqual(['Маленький.jpg']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('quota_exceeded: «Повторить» нет, «Выбрать файл» доступен', async () => {
    await setup({ preset: 'storage-full' });
    pick();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Место организации заполнено. Загрузка новых файлов недоступна.',
    );
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
    expect(screen.getByLabelText('Выбрать файл')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeTruthy();
  });

  it('«Файл отклонён проверкой»: «Выбрать файл» доступен, новый файл — новая сессия', async () => {
    const { scenario, put } = await setup();
    pick('Вирус.jpg');
    expect(await screen.findByText('Файл загружен и проверяется')).toBeTruthy();
    for (const org of Object.values(scenario.state().orgs)) {
      for (const f of org.files) if (f.status === 'quarantined') f.status = 'rejected';
    }
    expect(await screen.findByText('Файл отклонён проверкой')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
    pick('Чистый.jpg');
    await waitFor(() => expect(sessions(scenario)).toHaveLength(2));
    expect(await screen.findByText('Файл загружен и проверяется')).toBeTruthy();
    expect(put.mock.calls.map(([, f]) => (f as File).name)).toEqual(['Вирус.jpg', 'Чистый.jpg']);
  });
});

describe('«Загрузка файла»: фокус', () => {
  it('выбор файла: поле исчезает, фокус остаётся в диалоге, а не на body', async () => {
    await setup({
      put: () =>
        new Promise<void>(() => {
          /* передача идёт */
        }),
    });
    const d = screen.getByRole('dialog', { name: 'Загрузка файла' });
    screen.getByLabelText('Выбрать файл').focus();
    pick();
    await screen.findByRole('button', { name: 'Отменить загрузку' });
    await waitFor(() => expect(d.contains(document.activeElement)).toBe(true));
  });

  it('«Отменить загрузку»: кнопка исчезает, фокус остаётся в диалоге', async () => {
    await setup({
      put: () =>
        new Promise<void>(() => {
          /* передача идёт */
        }),
    });
    const d = screen.getByRole('dialog', { name: 'Загрузка файла' });
    pick();
    const cancel = await screen.findByRole('button', { name: 'Отменить загрузку' });
    cancel.focus();
    fireEvent.click(cancel);
    expect(await screen.findByText('Загрузка отменена')).toBeTruthy();
    await waitFor(() => expect(d.contains(document.activeElement)).toBe(true));
  });

  it('«Повторить»: кнопка исчезает, фокус остаётся в диалоге', async () => {
    let n = 0;
    await setup({
      put: () =>
        n++ === 0
          ? Promise.reject(new TypeError('network'))
          : new Promise<void>(() => {
              /* передача идёт */
            }),
    });
    const d = screen.getByRole('dialog', { name: 'Загрузка файла' });
    pick();
    const retry = await screen.findByRole('button', { name: 'Повторить' });
    retry.focus();
    fireEvent.click(retry);
    await screen.findByRole('button', { name: 'Отменить загрузку' });
    await waitFor(() => expect(d.contains(document.activeElement)).toBe(true));
  });

  it('закрытие: фокус возвращается на кнопку-открыватель', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Добавить фото';
    document.body.append(opener);
    try {
      const { unmount } = await setup({ opener });
      expect(document.activeElement).not.toBe(opener);
      unmount();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it('фокус-ловушка: Tab с body возвращает фокус в диалог', async () => {
    await setup();
    const d = screen.getByRole('dialog', { name: 'Загрузка файла' });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(d.contains(document.activeElement)).toBe(true);
  });
});

/** Сессии, начатые тестом (у «Альты» в сиде одна завершённая сессия примера getUploadSession). */
const sessions = (s: ScenarioServer) =>
  (s.state().orgs[ALTA]?.uploads ?? []).filter((u) => u.uploadId !== SEED_UPLOAD);
const reserved = (s: ScenarioServer) =>
  s.state().tenants.find((x) => x.id === ALTA)?.storage.reservedBytes;
