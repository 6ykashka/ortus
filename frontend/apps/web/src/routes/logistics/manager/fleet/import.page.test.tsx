// W2.50 · Экранные тесты «Импорт машин» (`?import=vehicles` страницы «Рабочее место логиста»; no-reference, D-11
// комплекта) на сценарном сервере (MSW fleet/imports.ts W2.52, пресет logistics-ready): кнопка по праву
// fleet.vehicles.manage, файл CSV, предпросмотр с ошибками по строкам, применение без строк с ошибками (If-Match),
// итог и новая машина в подборе, ошибки заголовка (422) и размера (413) — текстом сервера, режим чтения.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 8_000 };
vi.setConfig({ testTimeout: 30_000 });

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const HEADER =
  'registration_number;display_name;body_type;payload_kg;volume_m3;cargo_length_m;cargo_width_m;cargo_height_m;odometer_km';
const CSV = [
  HEADER,
  'А 777 АА 77;Isuzu Elf;тент;3000;20;4,2;2,1;2,2;12000',
  'А 412 МР 77;ГАЗель Next;tent;1500;16;3,1;2;1,9;99000',
  'Б 1;Без кузова;ракета;1;1;1;1;1;1',
].join('\r\n');

const open = async (o: MockAppOptions = {}, url = ''): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/fleet${url}`, {
    persona: 'manager',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1 }, SLOW);
  return app;
};

const openImport = async (o: MockAppOptions = {}): Promise<MockApp> => {
  const a = await open(o, '?import=vehicles');
  await screen.findByRole('heading', { level: 1, name: 'Импорт машин' }, SLOW);
  return a;
};

function choose(text: string, name = 'машины.csv'): void {
  const input = screen.getByLabelText('Файл CSV') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/csv' })] } });
}

const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const sent = (a: MockApp, method: string, suffix: string) =>
  a.responses().filter((r) => r.method === method && r.path.endsWith(suffix));
interface ImportState {
  fileName: string;
  state: string;
}
const imports = (a: MockApp): ImportState[] =>
  (a.scenario.state().orgs[ALTA] as unknown as { fleet: { vehicleImports: ImportState[] } }).fleet
    .vehicleImports;
const stat = (key: string): string | null | undefined =>
  document.querySelector(`.ox-imp-stat[data-kind="${key}"] .ox-imp-stat-value`)?.textContent;

describe('«Импорт машин»: вход и предпросмотр', () => {
  it('логист: «Импорт машин» в шапке рабочего места → ?import=vehicles, заголовок и фирма права', async () => {
    const a = await open();
    await screen.findByRole('tablist', { name: 'Рейсы' }, SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Импорт машин' }));
    await screen.findByRole('heading', { level: 1, name: 'Импорт машин' }, SLOW);
    expect(a.router.state.location.search).toMatchObject({ import: 'vehicles' });
    expect(screen.getByText(/Колонки: registration_number, display_name/)).toBeTruthy();
    expect(screen.getByText('Фирма по умолчанию: Север Логистик')).toBeTruthy();
  });

  it('поле «Файл CSV» в оформлении системы: «Выбрать файл», «Файл не выбран» → имя выбранного файла', async () => {
    await openImport();
    expect(screen.getByText('Выбрать файл')).toBeTruthy();
    expect(screen.getByText('Файл не выбран')).toBeTruthy();
    choose(CSV, 'парк-октябрь.csv');
    expect(screen.getByText('парк-октябрь.csv')).toBeTruthy();
    expect(screen.queryByText('Файл не выбран')).toBeNull();
  });

  it('без файла — «Выберите файл CSV.»; файл → предпросмотр: итоги и ошибки по строкам', async () => {
    const a = await openImport();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
    expect(screen.getByText('Выберите файл CSV.')).toBeTruthy();
    choose(`\uFEFF${CSV}`);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
    await screen.findByRole('heading', { level: 2, name: 'Проверка файла «машины.csv»' }, SLOW);
    expect([stat('rows'), stat('create'), stat('update'), stat('error')]).toEqual([
      '3',
      '1',
      '1',
      '1',
    ]);
    const errors = screen.getByRole('list', { name: 'Строки с ошибками' });
    expect(within(errors).getByText('Строка 4 · Б 1 · Без кузова')).toBeTruthy();
    expect(within(errors).getByText('body_type (кузов): Неизвестный тип кузова')).toBeTruthy();
    const valid = screen.getByRole('list', { name: 'Строки к применению' });
    expect(within(valid).getByText('Строка 2 · А 777 АА 77 · Isuzu Elf')).toBeTruthy();
    expect(within(valid).getByText('Строка 3 · А 412 МР 77 · ГАЗель Next')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Применить' })).toBeNull();
    expect(sent(a, 'POST', '/fleet/vehicle-imports')[0]?.status).toBe(201);
    expect(imports(a).map((i) => [i.fileName, i.state])).toEqual([['машины.csv', 'previewed']]);
  });

  it('«Применить без строк с ошибками»: If-Match, итог, тост; новая машина в подборе', async () => {
    const a = await openImport();
    choose(CSV);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
    await screen.findByRole('heading', { level: 2, name: /^Проверка файла/ }, SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Применить без строк с ошибками' }));
    await screen.findByRole('heading', { level: 2, name: 'Импорт применён' }, SLOW);
    expect(screen.getByText('Создано машин: 1 · обновлено: 1 · пропущено строк: 1.')).toBeTruthy();
    await waitFor(() => expect(toast()).toBe('Импорт машин применён'), SLOW);
    // Сценарный сервер без If-Match отвечает 428, со строками с ошибками без skipInvalidRows — 422.
    expect(sent(a, 'POST', '/commit').map((r) => r.status)).toEqual([200]);
    expect(imports(a).map((i) => i.state)).toEqual(['committed']);
    fireEvent.click(screen.getByRole('button', { name: 'К рабочему месту' }));
    await screen.findByRole('tablist', { name: 'Рейсы' }, SLOW);
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('.ox-fl-vehicle .ox-fl-model-name')].map(
          (x) => x.textContent,
        ),
      ).toContain('Isuzu Elf'),
    );
  });

  it('файл без ошибок — «Применить»; «Загрузить другой файл» возвращает выбор файла', async () => {
    await openImport();
    choose([HEADER, 'Е 555 ЕЕ 77;Volvo FL;борт;5000;30;6;2,4;2,4;5000'].join('\n'));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
    await screen.findByRole('heading', { level: 2, name: /^Проверка файла/ }, SLOW);
    expect(screen.queryByRole('list', { name: 'Строки с ошибками' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    await screen.findByRole('heading', { level: 2, name: 'Импорт применён' }, SLOW);
    expect(screen.getByText('Создано машин: 1 · обновлено: 0 · пропущено строк: 0.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить другой файл' }));
    expect(screen.getByLabelText('Файл CSV')).toBeTruthy();
  });

  // Ревью W2.50-r1 (major): тот же файл после применения уходил с тем же Idempotency-Key — сервер повторял старый
  // ответ (строка «Новая машина», ETag "1"), а «Применить» отвечало 412 до перезагрузки страницы.
  it('тот же файл после применения — новая проверка: «Обновление», применение проходит', async () => {
    const a = await openImport();
    const file = [HEADER, 'О 909 ОО 77;Повтор;тент;1500;16;3,1;2;1,9;1000'].join('\n');
    choose(file, 'повтор.csv');
    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
    await screen.findByRole('heading', { level: 2, name: /^Проверка файла/ }, SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    await screen.findByRole('heading', { level: 2, name: 'Импорт применён' }, SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить другой файл' }));
    choose(file, 'повтор.csv');
    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
    await screen.findByRole('heading', { level: 2, name: /^Проверка файла/ }, SLOW);
    const valid = screen.getByRole('list', { name: 'Строки к применению' });
    expect(within(valid).getByText('Обновление')).toBeTruthy();
    expect([stat('create'), stat('update')]).toEqual(['0', '1']);
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    await screen.findByRole('heading', { level: 2, name: 'Импорт применён' }, SLOW);
    expect(sent(a, 'POST', '/fleet/vehicle-imports').map((r) => r.status)).toEqual([201, 201]);
    expect(sent(a, 'POST', '/commit').map((r) => r.status)).toEqual([200, 200]);
    expect(imports(a).map((i) => i.state)).toEqual(['committed', 'committed']);
  });

  // Ревью W2.50-r2 (minor): после 412/409 на «Применить» оставался предпросмотр со старым ETag и активной кнопкой —
  // повтор снова 412, выход только через «Загрузить другой файл», а тост звал «Обновите и повторите правку».
  // Теперь тот же файл проверяется заново новым ключом, баннер объясняет, применение проходит.
  const staleBanner = 'Данные изменились после проверки — файл проверен заново.';
  it.each([
    {
      status: 412,
      stale: (i: { revision: number; state: string }) => {
        i.revision++;
      },
    },
    {
      status: 409,
      stale: (i: { revision: number; state: string }) => {
        i.state = 'committed';
      },
    },
  ])(
    '$status при применении → файл проверен заново: баннер, без тоста, «Применить» проходит',
    async ({ status, stale }) => {
      const a = await openImport();
      const file = [HEADER, 'Р 515 РР 77;Устаревший;тент;1500;16;3,1;2;1,9;1000'].join('\n');
      choose(file);
      fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
      await screen.findByRole('heading', { level: 2, name: /^Проверка файла/ }, SLOW);
      stale(imports(a)[0] as unknown as { revision: number; state: string });
      fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
      await waitFor(() =>
        expect(sent(a, 'POST', '/commit').map((r) => r.status)).toEqual([status]),
      );
      const banner = await screen.findByText(staleBanner, undefined, SLOW);
      expect(banner.closest('[role="status"]')?.textContent).toContain(
        'Проверьте строки и примените импорт ещё раз.',
      );
      expect(imports(a)).toHaveLength(2);
      expect(sent(a, 'POST', '/fleet/vehicle-imports').map((r) => r.status)).toEqual([201, 201]);
      expect(toast() ?? '').not.toMatch(/Обновите|Статус уже изменился/);
      expect(document.activeElement?.textContent).toMatch(/^Проверка файла/);
      fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
      await screen.findByRole('heading', { level: 2, name: 'Импорт применён' }, SLOW);
      expect(sent(a, 'POST', '/commit').map((r) => r.status)).toEqual([status, 200]);
      expect(screen.queryByText(staleBanner)).toBeNull();
    },
  );

  it('412, а повторная проверка без связи — выбор файла и ошибка под полем', async () => {
    const a = await openImport();
    const file = [HEADER, 'Р 516 РР 77;Устаревший;тент;1500;16;3,1;2;1,9;1000'].join('\n');
    choose(file);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
    await screen.findByRole('heading', { level: 2, name: /^Проверка файла/ }, SLOW);
    (imports(a)[0] as unknown as { revision: number }).revision++;
    a.scenario.setScenario('createVehicleImport=offline', true);
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    const alert = await screen.findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toContain('Нет связи с сервером. Операция не выполнена.');
    expect(screen.getByLabelText('Файл CSV')).toBeTruthy();
    expect(screen.getByText('Файл не выбран')).toBeTruthy();
    expect(sent(a, 'POST', '/commit').map((r) => r.status)).toEqual([412]);
  });
});

describe('«Импорт машин»: ошибки файла и права', () => {
  it('422 заголовка — текст сервера в alert', async () => {
    await openImport();
    choose('registration_number;display_name\nА 1;Машина');
    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
    const alert = await screen.findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toContain('В файле нет обязательной колонки body_type.');
  });

  it('413 — «Файл больше 1 МБ или 2000 строк. Разделите его на части.»', async () => {
    await openImport();
    const rows = Array.from({ length: 2001 }, (_, i) => `Т ${i} ТТ 77;Машина;tent;1;1;1;1;1;1`);
    choose([HEADER, ...rows].join('\n'));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
    const alert = await screen.findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toContain('Файл больше 1 МБ или 2000 строк. Разделите его на части.');
  });

  it('модуль только для чтения: кнопки нет, экран импорта — пояснение', async () => {
    const setup: MockAppOptions['setup'] = (s) => {
      const m = s.state().orgs[ALTA]?.modules.fleet;
      if (m) {
        m.state = 'read_only';
        m.revision++;
      }
    };
    await open({ persona: 'owner', setup });
    await screen.findByRole('tablist', { name: 'Рейсы' }, SLOW);
    expect(screen.queryByRole('button', { name: 'Импорт машин' })).toBeNull();
    app?.close();
    await openImport({ persona: 'owner', setup });
    expect(screen.getByText('Модуль только для чтения — импорт машин недоступен.')).toBeTruthy();
    expect(screen.queryByLabelText('Файл CSV')).toBeNull();
  });

  it('владелец: «Фирма по умолчанию» — выбор из фирм организации', async () => {
    await openImport({ persona: 'owner' });
    const select = (await screen.findByLabelText(
      'Фирма по умолчанию',
      undefined,
      SLOW,
    )) as HTMLSelectElement;
    await waitFor(() =>
      expect([...select.options].map((o) => o.text)).toContain('Москва / Север Логистик'),
    );
  });
});
