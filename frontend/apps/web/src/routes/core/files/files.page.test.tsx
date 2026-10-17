// W1.24 · Экранные тесты «Файлов» (эталон design-stage-1 :1858–1868, filesVM :4219–4231; 06 §8, §13 #23–25;
// S1-21 — «Открыть» выдаёт короткую ссылку getFileDownload; решения брифа Q-W1.24-9…-12).
import type { ScenarioServer } from '@ortus/adapter/msw';
import { seedUuid } from '@ortus/domain/seed';
import { errors } from '@ortus/texts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const LOTOS = seedUuid('platform', 't-lotos');
const SEED_FILE = 'Р-208 · спереди.jpg';

/** Вкладка, открытая `window.open` до ответа сервера: адрес подставляется после короткой ссылки. */
function fakeTab() {
  const location = { href: '' };
  const close = vi.fn();
  const window = { location, close, opener: {} as unknown } as unknown as Window;
  return { window, location, close };
}

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

/** Ленивая страница при параллельном прогоне пакетов грузится дольше 1 с по умолчанию findBy*. */
const SLOW = { timeout: 5_000 };

const open = async (o: Parameters<typeof renderMockApp>[1] = {}) => {
  app = await renderMockApp(`/t/${ALTA}/files`, { persona: 'owner', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Файлы' }, SLOW);
  return app;
};

const rows = () => [...document.querySelectorAll<HTMLElement>('.ox-files-row')];
const rowOf = (name: string): HTMLElement => {
  const r = rows().find((x) => x.textContent?.includes(name));
  if (!r) throw new Error(`нет строки «${name}»`);
  return r;
};
const toast = () => document.querySelector('.ox-toast .ox-toast-text');

/** Добавляет в «Альту» файл с сессией загрузки (родитель — рейс сида). */
function addFile(
  s: ScenarioServer,
  i: number,
  status: 'quarantined' | 'rejected' | 'ready',
  name = `Файл ${i}.pdf`,
): void {
  const org = s.state().orgs[ALTA];
  if (!org) throw new Error('нет «Альты»');
  const id = seedUuid('w124:file', String(i));
  org.files.push({
    id,
    fileName: name,
    contentType: 'application/pdf',
    sizeBytes: 1258291,
    sha256: 'b'.repeat(64),
    status,
    createdAt: `2026-09-${String(10 + (i % 18)).padStart(2, '0')}T08:00:00Z`,
  });
  org.uploads.push({
    uploadId: seedUuid('w124:upload', String(i)),
    fileId: id,
    state: 'completed',
    purpose: 'expense_receipt',
    owner: { moduleKey: 'fleet', entityType: 'trip', entityId: seedUuid('t-alta', 'Р-196') },
    sizeBytes: 1258291,
    reservedBytes: 0,
    ticketExpiresAt: '2026-09-10T08:15:00Z',
    sessionExpiresAt: '2026-09-10T09:00:00Z',
    fileStatus: status,
    createdAt: '2026-09-10T08:00:00Z',
    requiredSha256: 'b'.repeat(64),
    contentType: 'application/pdf',
  });
}

describe('«Файлы»', () => {
  it('заголовок, абзац, подпись состояний, место «46,2 из 100 ГБ»', async () => {
    await open();
    expect(
      screen.getByText(
        'Фото и вложения всегда привязаны к исходному объекту. Скачивание проверяет доступ к нему.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Состояния загрузки: резерв → загружен → проверка → готов или отклонён. До проверки файл не считается подтверждением.',
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelector('.ox-files-usage')?.textContent).toBe(
        'Место организации46,2 из 100 ГБ',
      ),
    );
  });

  it('строка файла сида: имя, «Бронь машины», «Готов», «2,3 МБ», «Открыть» доступна', async () => {
    await open();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rowOf(SEED_FILE);
    expect(row.textContent).toContain('Бронь машины');
    expect(row.textContent).toContain('Готов');
    expect(row.textContent).toContain('2,3 МБ');
    const btn = within(row).getByRole('button', { name: 'Открыть' });
    expect(btn).toHaveProperty('disabled', false);
    expect(btn.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('на проверке и отклонённый: чипы, «—», «Открыть» недоступна', async () => {
    await open({
      setup: (s) => {
        addFile(s, 1, 'quarantined', 'ПТС ГАЗон Next.pdf');
        addFile(s, 2, 'rejected', 'archive.pdf');
      },
    });
    await waitFor(() => expect(rows()).toHaveLength(3));
    const q = rowOf('ПТС ГАЗон Next.pdf');
    expect(q.textContent).toContain('Проверяется');
    expect(q.textContent).toContain('1,2 МБ');
    expect(within(q).getByRole('button', { name: 'Открыть' })).toHaveProperty('disabled', true);
    const r = rowOf('archive.pdf');
    expect(r.textContent).toContain('Отклонён');
    expect(r.textContent).toContain('—');
    expect(within(r).getByRole('button', { name: 'Открыть' })).toHaveProperty('disabled', true);
  });

  it('«Открыть»: вкладка открывается в жесте пользователя, затем — короткая ссылка getFileDownload', async () => {
    const tab = fakeTab();
    const opened = vi.spyOn(window, 'open').mockReturnValue(tab.window);
    const a = await open();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(within(rowOf(SEED_FILE)).getByRole('button', { name: 'Открыть' }));
    // Синхронно, до ответа сервера: иначе Safari и Firefox блокируют окно как всплывающее.
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0]?.[1]).toBe('_blank');
    await waitFor(() =>
      expect(tab.location.href).toMatch(/^https:\/\/storage\.example\.invalid\/files\//),
    );
    expect(tab.window.opener).toBeNull();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(a.responses().some((r) => r.path.endsWith('/download') && r.status === 200)).toBe(true);
    expect(toast()).toBeNull();
  });

  it('окно заблокировано браузером: ссылка открывается после ответа', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    await open();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(within(rowOf(SEED_FILE)).getByRole('button', { name: 'Открыть' }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
    expect(opened.mock.calls[1]?.[0]).toMatch(/^https:\/\/storage\.example\.invalid\/files\//);
    expect(opened.mock.calls[1]?.[2]).toBe('noopener,noreferrer');
  });

  it('скачивание не готового файла: тост по коду photo_not_ready, пустая вкладка закрыта', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab.window);
    await open({ scenario: 'getFileDownload=photo_not_ready' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(within(rowOf(SEED_FILE)).getByRole('button', { name: 'Открыть' }));
    await waitFor(() =>
      expect(toast()?.textContent).toBe('Фото ещё загружается. Дождитесь окончания загрузки.'),
    );
    expect(tab.close).toHaveBeenCalled();
  });

  it('офлайн на «Открыть»: тост «Нет связи…» тоном warn, вкладка закрыта', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab.window);
    const a = await open();
    await waitFor(() => expect(rows()).toHaveLength(1));
    a.scenario.setScenario('getFileDownload=offline');
    fireEvent.click(within(rowOf(SEED_FILE)).getByRole('button', { name: 'Открыть' }));
    await waitFor(() => expect(toast()?.textContent).toBe(errors.client.offline));
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
  });

  it('404 при скачивании: тост «Объект не найден или недоступен.», пустая вкладка закрыта', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab.window);
    await open({ scenario: 'getFileDownload=not_found' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(within(rowOf(SEED_FILE)).getByRole('button', { name: 'Открыть' }));
    await waitFor(() => expect(toast()?.textContent).toBe(errors.problem.not_found));
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
  });

  it('пусто: «Доступных файлов нет»', async () => {
    await open({ scenario: 'listFiles=empty' });
    expect(await screen.findByText('Доступных файлов нет')).toBeTruthy();
  });

  it('больше страницы: «Показать ещё» догружает следующую', async () => {
    await open({
      setup: (s) => {
        for (let i = 0; i < 55; i++) addFile(s, 100 + i, 'ready');
      },
    });
    await waitFor(() => expect(rows()).toHaveLength(50));
    const more = screen.getByRole('button', { name: 'Показать ещё' });
    more.focus();
    fireEvent.click(more);
    await waitFor(() => expect(rows()).toHaveLength(56));
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
    // Кнопка исчезла — фокус на первой догруженной строке, а не на body.
    await waitFor(() => expect(document.activeElement).toBe(rows()[50]));
  });

  it('место заполнено: полоса danger', async () => {
    await open({ preset: 'storage-full' });
    await waitFor(() =>
      expect(
        document.querySelector('.ox-files-usage .ox-mod-bar-fill')?.getAttribute('data-tone'),
      ).toBe('danger'),
    );
  });

  it('логист с ролью: без карточки места и без запроса места (нет billing.read), список доступен', async () => {
    const a = await open({ persona: 'manager', preset: 'logistics-ready' });
    await waitFor(() =>
      expect(a.responses().some((r) => r.path.endsWith('/files') && r.status === 200)).toBe(true),
    );
    expect(a.responses().some((r) => r.path.endsWith('/storage'))).toBe(false);
    expect(document.querySelector('.ox-files-usage')).toBeNull();
    expect(screen.getByText('Доступных файлов нет')).toBeTruthy();
  });
});

describe('«Файлы»: загрузка, ошибка, офлайн, нет права', () => {
  it('загрузка: скелетон «Загрузка», заголовок на месте', async () => {
    await open({ scenario: 'listFiles=loading' });
    expect(await screen.findByRole('status', { name: 'Загрузка' })).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  it('загрузка списка: скелетон списка без подписи оболочки «Загружаем рабочее пространство…»', async () => {
    await open({ scenario: 'listFiles=loading' });
    const page = document.querySelector('.ox-files') as HTMLElement;
    const status = await within(page).findByRole('status', { name: 'Загрузка' });
    expect(status.classList.contains('ox-files-list')).toBe(true);
    expect(page.textContent).not.toContain('Загружаем рабочее пространство…');
  });

  it('место организации грузится: карточка занимает место заранее (aria-busy), список не сдвигается', async () => {
    await open({ scenario: 'getStorageUsage=loading' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const usage = document.querySelector('.ox-files-usage') as HTMLElement | null;
    expect(usage).not.toBeNull();
    expect(usage?.getAttribute('aria-busy')).toBe('true');
    expect(usage?.textContent).toContain('Место организации');
  });

  it('ошибка места: в карточке alert по коду и «Повторить», а не пропавшая карточка', async () => {
    const a = await open({ scenario: 'getStorageUsage=rate_limited' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const usage = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.ox-files-usage');
      if (!el?.querySelector('[role="alert"]')) throw new Error('нет alert в карточке места');
      return el;
    });
    expect(within(usage).getByRole('alert').textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario('');
    fireEvent.click(within(usage).getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect(document.querySelector('.ox-files-usage')?.textContent).toBe(
        'Место организации46,2 из 100 ГБ',
      ),
    );
  });

  it('ошибка списка: alert по коду и «Повторить» перечитывает список', async () => {
    const a = await open({ scenario: 'listFiles=rate_limited' });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario('');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it('офлайн при загрузке списка: alert «Нет связи с сервером…»', async () => {
    await open({ scenario: 'listFiles=offline' });
    expect((await screen.findByRole('alert')).textContent).toBe(
      `Не удалось загрузить данные: ${errors.client.offline}`,
    );
  });

  it('ошибка места: заголовок «Место организации» остаётся, «Повторить» описан заголовком карточки', async () => {
    await open({ scenario: 'getStorageUsage=rate_limited' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const usage = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.ox-files-usage');
      if (!el?.querySelector('[role="alert"]')) throw new Error('нет alert в карточке места');
      return el;
    });
    expect(usage.textContent).toContain('Место организации');
    const retry = within(usage).getByRole('button', { name: 'Повторить' });
    const by = retry.getAttribute('aria-describedby') ?? '';
    expect(by).not.toBe('');
    expect(document.getElementById(by)?.textContent).toBe('Место организации');
  });

  it('место запрашивается один раз: ключ общий с баннером оболочки', async () => {
    const a = await open();
    await waitFor(() =>
      expect(document.querySelector('.ox-files-usage')?.textContent).toBe(
        'Место организации46,2 из 100 ГБ',
      ),
    );
    await waitFor(() => expect(rows()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 100));
    expect(
      a.responses().filter((r) => r.method === 'GET' && r.path.endsWith('/storage')),
    ).toHaveLength(1);
  });

  it('следующая страница пустая: фокус на последней строке, а не на body', async () => {
    const a = await open({
      setup: (s) => {
        for (let i = 0; i < 55; i++) addFile(s, 100 + i, 'ready');
      },
    });
    await waitFor(() => expect(rows()).toHaveLength(50));
    // Пока список читали, файлы удалены: следующая страница придёт пустой и «Показать ещё» исчезнет.
    const org = a.scenario.state().orgs[ALTA];
    if (!org) throw new Error('нет «Альты»');
    org.files.length = 0;
    const more = screen.getByRole('button', { name: 'Показать ещё' });
    more.focus();
    fireEvent.click(more);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull());
    expect(rows()).toHaveLength(50);
    await waitFor(() => expect(document.activeElement).toBe(rows()[49]));
  });

  it('ошибка списка, «Повторить»: после загрузки фокус на заголовке страницы, а не на body', async () => {
    const a = await open({ scenario: 'listFiles=rate_limited' });
    await screen.findByRole('alert', {}, SLOW);
    a.scenario.setScenario('');
    const retry = screen.getByRole('button', { name: 'Повторить' });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(rows()).toHaveLength(1), SLOW);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Файлы' })),
    );
  });

  it('ошибка места, «Повторить»: после загрузки фокус на заголовке карточки «Место организации»', async () => {
    const a = await open({ scenario: 'getStorageUsage=rate_limited' });
    await waitFor(() => expect(rows()).toHaveLength(1), SLOW);
    const usage = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.ox-files-usage');
      if (!el?.querySelector('[role="alert"]')) throw new Error('нет alert в карточке места');
      return el;
    }, SLOW);
    a.scenario.setScenario('');
    const retry = within(usage).getByRole('button', { name: 'Повторить' });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(
      () =>
        expect(document.querySelector('.ox-files-usage')?.textContent).toBe(
          'Место организации46,2 из 100 ГБ',
        ),
      SLOW,
    );
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Место организации'));
    expect(document.activeElement?.closest('.ox-files-usage')).not.toBeNull();
  });

  it('массажист «Лотоса» без files.read по прямому URL: гейт «Нет права» с подписью «Файлы»', async () => {
    const a = await renderMockApp(`/t/${LOTOS}/files`, { persona: 'therapist@t-lotos' });
    app = a;
    const h = await screen.findByRole('heading', { level: 1, name: /«Файлы»/ }, SLOW);
    expect(h.closest('.ox-gate')?.textContent).toContain('Нет права');
    expect(a.responses().some((r) => r.path.endsWith('/files'))).toBe(false);
  });
});
