// W2.50 · Экранные тесты выгрузки CSV на «Приёмке смен» и «Начислениях водителям» (exportDataset на сценарном
// сервере MSW data W2.52, пресет logistics-ready): кнопки «Выгрузить расходы» и «Выгрузить рейсы» по exportAllowed,
// файл с BOM и именем сервера, тост с числом строк, «нет связи», каталог наборов недоступен — кнопок нет.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';
import { ALTA } from './fixtures.test-util.ts';

const SLOW = { timeout: 8_000 };
vi.setConfig({ testTimeout: 30_000 });

let app: MockApp | undefined;
let saved: { blob: Blob; name: string }[] = [];
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

beforeEach(() => {
  saved = [];
  let last: Blob | undefined;
  URL.createObjectURL = vi.fn((b: Blob) => {
    last = b;
    return 'blob:ortus-test';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (last) saved.push({ blob: last, name: this.download });
  });
});

afterEach(() => {
  app?.close();
  app = undefined;
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  vi.restoreAllMocks();
});

const open = async (page: 'review' | 'earnings', o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/${page}`, {
    persona: 'manager',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1 }, SLOW);
  return app;
};

const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const sent = (a: MockApp, suffix: string) =>
  a.responses().filter((r) => r.method === 'POST' && r.path.endsWith(suffix));

/** Байты файла: декодер UTF-8 (readAsText) снимает BOM, поэтому BOM проверяется по байтам EF BB BF. */
function bytes(b: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error('FileReader'));
    r.readAsArrayBuffer(b);
  });
}

describe('выгрузка CSV', () => {
  it('«Приёмка смен»: группа «Выгрузка CSV» — «Выгрузить расходы», «Выгрузить рейсы»', async () => {
    await open('review');
    const group = await screen.findByRole('group', { name: 'Выгрузка CSV' }, SLOW);
    // Подпись без скрытого от AT значка (лигатура Material Symbols — текст узла).
    const label = (b: HTMLElement): string =>
      [...b.childNodes]
        .filter((n) => !(n instanceof Element && n.getAttribute('aria-hidden') === 'true'))
        .map((n) => n.textContent)
        .join('');
    expect(within(group).getAllByRole('button').map(label)).toEqual([
      'Выгрузить расходы',
      'Выгрузить рейсы',
    ]);
  });

  // Ревью W2.50-r2 (minor): у образца «Выгрузить» на «Данных» — значок download; у кнопок выгрузки его не было.
  it('кнопки выгрузки — значок download, как у «Выгрузить» на «Данных»; имя кнопки — только подпись', async () => {
    await open('review');
    const group = await screen.findByRole('group', { name: 'Выгрузка CSV' }, SLOW);
    for (const name of ['Выгрузить расходы', 'Выгрузить рейсы']) {
      const button = within(group).getByRole('button', { name });
      const icon = button.querySelector('.material-symbols-rounded');
      expect(icon?.textContent).toBe('download');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('«Выгрузить расходы»: exportDataset, файл с BOM и именем сервера, тост с числом строк', async () => {
    const a = await open('review');
    const group = await screen.findByRole('group', { name: 'Выгрузка CSV' }, SLOW);
    fireEvent.click(within(group).getByRole('button', { name: 'Выгрузить расходы' }));
    await waitFor(() => expect(saved).toHaveLength(1), SLOW);
    expect(sent(a, '/datasets/fleet.expenses/export').map((r) => r.status)).toEqual([200]);
    const file = saved[0];
    expect(file?.name).toMatch(/^Расходы-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file?.blob.type).toBe('text/csv;charset=utf-8');
    const raw = await bytes(file?.blob as Blob);
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const content = new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw.slice(3));
    expect(content.split('\r\n')[0]).toContain(';');
    await waitFor(
      () => expect(toast()).toMatch(/^Выгружено строк: \d+ · Расходы-\d{4}-\d{2}-\d{2}\.csv$/),
      SLOW,
    );
  });

  it('«Начисления водителям» (владелец): «Выгрузить рейсы» — набор «Поездки»', async () => {
    const a = await open('earnings', { persona: 'owner' });
    const group = await screen.findByRole('group', { name: 'Выгрузка CSV' }, SLOW);
    fireEvent.click(within(group).getByRole('button', { name: 'Выгрузить рейсы' }));
    await waitFor(() => expect(saved).toHaveLength(1), SLOW);
    expect(sent(a, '/datasets/fleet.trips/export').map((r) => r.status)).toEqual([200]);
    expect(saved[0]?.name).toMatch(/^Поездки-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('нет связи: тост «Нет связи…», файла нет, кнопка снова доступна', async () => {
    await open('review', { scenario: 'exportDataset=offline' });
    const group = await screen.findByRole('group', { name: 'Выгрузка CSV' }, SLOW);
    const btn = within(group).getByRole('button', { name: 'Выгрузить рейсы' }) as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(toast()).toBe('Нет связи с сервером. Операция не выполнена.'), SLOW);
    expect(saved).toHaveLength(0);
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it('каталог наборов недоступен — кнопок выгрузки нет, страница работает', async () => {
    await open('review', { scenario: 'listDatasets=rate_limited' });
    await screen.findAllByText(/Север Логистик/, undefined, SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('group', { name: 'Выгрузка CSV' })).toBeNull();
  });
});
