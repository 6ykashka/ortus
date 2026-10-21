// W4.50 · Экранные тесты «Данных»: сохранённые виды на сервере и выгрузка заданием с журналом (контракт 0.7.0-stage4
// W4.06; эталон design-2026-10-19 «Ортус CRM.dc.html» pg.data :1837–1856, dataVM :4189–4222 — onSaveView, onExport;
// журнал «Выгрузки» — no-reference). Сеть — сценарный сервер W4.06 (views.ts, exports.ts) на пресете logistics-ready.
import type { ScenarioServer } from '@ortus/adapter/msw';
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 5_000 };

let app: MockApp | undefined;
let saved: { blob: Blob; name: string }[] = [];
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
beforeEach(() => {
  saved = [];
  let last: Blob | undefined;
  URL.createObjectURL = vi.fn((b: Blob) => {
    last = b;
    return 'blob:w450';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
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

type View = { name: string; datasetId: string; query: { search?: string }; revision: number };
type Job = {
  state: string;
  createdAt: string;
  requestedByMemberId: string;
  revokeReason?: string;
  revokedAt?: string;
};
type Org = {
  dataViews?: View[];
  dataExports?: Job[];
  members: { id: string; proto: string; displayName: string }[];
  roles: { proto: string; permissions: string[] }[];
  policyVersion: number;
};
const alta = (s: ScenarioServer) => s.state().orgs[ALTA] as unknown as Org;

/** Владелец снимает право с роли «Менеджер логистики» (как правка роли в «Пользователи и роли»). */
function dropKey(s: ScenarioServer, key: string): void {
  const role = alta(s).roles.find((r) => r.proto === 'r-manager');
  if (!role) throw new Error('нет роли r-manager');
  role.permissions = role.permissions.filter((k) => k !== key);
  alta(s).policyVersion++;
}

const open = async (o: Parameters<typeof renderMockApp>[1] = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/data`, {
    persona: 'owner',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: 'Данные' }, SLOW);
  if (o.persona && o.persona !== 'owner')
    await waitFor(
      () => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0),
      SLOW,
    );
  else await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(2), SLOW);
  return app;
};

/** Выгрузить и дождаться готовой выгрузки первой строкой журнала. */
async function exportReady(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Выгрузить' }));
  await waitFor(
    async () => expect(within((await jobs())[0] as HTMLElement).getByText('Готова')).toBeTruthy(),
    SLOW,
  );
  return (await jobs())[0] as HTMLElement;
}

/** Сервер отозвал задание в обход страницы (владелец в другой вкладке): ревизия та же. */
function revokeBehind(s: ScenarioServer): void {
  const j = alta(s).dataExports?.[0];
  if (!j) throw new Error('нет задания');
  j.state = 'revoked';
  j.revokeReason = 'owner';
  j.revokedAt = j.createdAt;
}

/** n заданий владельца в очереди «воркера» mock: момент создания в будущем — задание не готово. */
function queue(s: ScenarioServer, n: number): void {
  const org = alta(s);
  const owner = org.members.find((m) => m.proto === 'm-owner');
  if (!owner) throw new Error('нет владельца m-owner');
  org.dataExports = Array.from({ length: n }, (_, i) => ({
    id: seedUuid('w450:job', String(i)),
    datasetId: 'fleet.trips',
    datasetName: 'Поездки',
    state: 'queued',
    spec: { select: ['trip'], filters: [], sort: [] },
    columnLabels: ['Рейс'],
    timeZone: 'Europe/Moscow',
    permissionVersion: '1',
    rowLimit: 100000,
    rowCount: 0,
    truncated: false,
    fileName: 'Поездки-2099-01-01.csv',
    sizeBytes: 3,
    requestedByMemberId: owner.id,
    requestedByDisplayName: owner.displayName,
    createdAt: '2099-01-01T00:00:00Z',
    revision: 1,
  })) as unknown as Job[];
}

const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const viewSelect = () => screen.getByLabelText<HTMLSelectElement>('Вид');
const options = () => [...viewSelect().options].map((o) => o.textContent);
const journal = () => screen.findByRole('region', { name: 'Выгрузки' }, SLOW);
const jobs = async () => within(await journal()).getAllByRole('listitem');

const filter = (q: string) =>
  fireEvent.change(screen.getByLabelText('Фильтр'), { target: { value: q } });

describe('«Данные»: сохранённые виды на сервере', () => {
  it('«Сохранить вид» — вид на сервере (личный), тост эталона, выбран в «Вид»', async () => {
    const a = await open();
    filter('211');
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(1), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить вид' }));
    await waitFor(() => expect(toast()).toBe('Вид сохранён · личный'), SLOW);
    const views = alta(a.scenario).dataViews ?? [];
    expect(views.map((v) => [v.name, v.datasetId, v.query.search])).toEqual([
      ['Поездки: «211»', 'fleet.trips', '211'],
    ]);
    await waitFor(() =>
      expect(viewSelect().selectedOptions[0]?.textContent).toBe('Поездки: «211»'),
    );
    expect(options()).toEqual(['Без сохранённого вида', 'Поездки: «211»']);
  });

  it('тот же фильтр ещё раз — тот же вид обновляется (updateDatasetView), дубля нет', async () => {
    const a = await open();
    filter('211');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить вид' }));
    await waitFor(() => expect(alta(a.scenario).dataViews).toHaveLength(1), SLOW);
    await waitFor(() => expect(viewSelect().value).not.toBe(''));
    filter('211');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить вид' }));
    await waitFor(() => expect(alta(a.scenario).dataViews?.[0]?.revision).toBe(2), SLOW);
    expect(alta(a.scenario).dataViews).toHaveLength(1);
    expect(options()).toEqual(['Без сохранённого вида', 'Поездки: «211»']);
  });

  it('вид с сервера: выбор подставляет фильтр вида, правка фильтра снимает вид', async () => {
    await open({
      setup: (s) => {
        const org = s.state().orgs[ALTA] as unknown as Org & Record<string, unknown>;
        org.dataViews = [];
      },
    });
    filter('208');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить вид' }));
    await waitFor(() => expect(options()).toContain('Поездки: «208»'), SLOW);
    filter('');
    expect(viewSelect().value).toBe('');
    const opt = [...viewSelect().options].find((o) => o.textContent === 'Поездки: «208»');
    fireEvent.change(viewSelect(), { target: { value: opt?.value } });
    expect(screen.getByLabelText<HTMLInputElement>('Фильтр').value).toBe('208');
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(1), SLOW);
  });

  it('422 «Вид с таким именем уже есть.» — тост текстом контракта, не общим текстом реестра', async () => {
    await open({ scenario: 'createDatasetView=validation_failed' });
    filter('211');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить вид' }));
    await waitFor(() => expect(toast()).toBe('Вид с таким именем уже есть.'), SLOW);
  });
});

describe('«Данные»: выгрузка заданием и журнал', () => {
  it('«Выгрузить» — тост эталона без «В демо…», журнал: задание готово, «Скачать» — CSV с BOM', async () => {
    await open();
    expect(screen.queryByRole('region', { name: 'Выгрузки' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить' }));
    await waitFor(
      () => expect(toast()).toBe('Выгрузка «Поездки»: 2 строк, фильтр и права зафиксированы.'),
      SLOW,
    );
    await waitFor(
      async () => expect(within((await jobs())[0] as HTMLElement).getByText('Готова')).toBeTruthy(),
      SLOW,
    );
    const item = (await jobs())[0] as HTMLElement;
    expect(within(item).getByText('Поездки')).toBeTruthy();
    expect(item.textContent).toContain('2 строки ·');
    fireEvent.click(within(item).getByRole('button', { name: 'Скачать' }));
    await waitFor(() => expect(saved).toHaveLength(1), SLOW);
    expect(saved[0]?.name).toMatch(/^Поездки-\d{4}-\d{2}-\d{2}\.csv$/);
    const bytes = new Uint8Array(await (saved[0]?.blob as Blob).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('«Отозвать» готовую — «Отозвана», «Скачать» и «Отозвать» пропадают', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить' }));
    await waitFor(
      async () => expect(within((await jobs())[0] as HTMLElement).getByText('Готова')).toBeTruthy(),
      SLOW,
    );
    fireEvent.click(
      within((await jobs())[0] as HTMLElement).getByRole('button', { name: 'Отозвать' }),
    );
    await waitFor(
      async () =>
        expect(within((await jobs())[0] as HTMLElement).getByText('Отозвана')).toBeTruthy(),
      SLOW,
    );
    const item = (await jobs())[0] as HTMLElement;
    expect(item.textContent).toContain('Отозвана автором');
    expect(within(item).queryByRole('button', { name: 'Скачать' })).toBeNull();
    expect(within(item).queryByRole('button', { name: 'Отозвать' })).toBeNull();
  });

  it('три выгрузки в очереди — четвёртая: тост «Дождитесь завершения начатых выгрузок.»', async () => {
    const a = await open({ setup: (s) => queue(s, 3) });
    await waitFor(async () => expect(await jobs()).toHaveLength(3), SLOW);
    expect((await jobs()).map((j) => within(j).getByText('В очереди').textContent)).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить' }));
    await waitFor(() => expect(toast()).toBe('Дождитесь завершения начатых выгрузок.'), SLOW);
    expect(alta(a.scenario).dataExports).toHaveLength(3);
  });

  it('задание в очереди — «Отменить»: задание отозвано автором', async () => {
    await open({ setup: (s) => queue(s, 1) });
    await waitFor(
      async () =>
        expect(within((await jobs())[0] as HTMLElement).getByText('В очереди')).toBeTruthy(),
      SLOW,
    );
    expect(
      within((await jobs())[0] as HTMLElement).queryByRole('button', { name: 'Скачать' }),
    ).toBeNull();
    fireEvent.click(
      within((await jobs())[0] as HTMLElement).getByRole('button', { name: 'Отменить' }),
    );
    await waitFor(
      async () =>
        expect(within((await jobs())[0] as HTMLElement).getByText('Отозвана')).toBeTruthy(),
      SLOW,
    );
  });
});

// Возврат 1 (ревью W4.50): 409 и 404 команд журнала — тексты контракта (Problem.detail), журнал перечитывается.
describe('«Данные»: отказы команд журнала', () => {
  it('права сузились — «Скачать»: тост «Права изменились — выгрузка отозвана…», строка «Отозвана · Права изменились»', async () => {
    const a = await open({ persona: 'manager' });
    await exportReady();
    dropKey(a.scenario, 'fleet.earnings.read');
    fireEvent.click(
      within((await jobs())[0] as HTMLElement).getByRole('button', { name: 'Скачать' }),
    );
    await waitFor(
      () => expect(toast()).toBe('Права изменились — выгрузка отозвана. Запустите её снова.'),
      SLOW,
    );
    await waitFor(
      async () =>
        expect(within((await jobs())[0] as HTMLElement).getByText('Отозвана')).toBeTruthy(),
      SLOW,
    );
    const item = (await jobs())[0] as HTMLElement;
    expect(item.textContent).toContain('Права изменились');
    expect(within(item).queryByRole('button', { name: 'Скачать' })).toBeNull();
    expect(within(item).queryByRole('button', { name: 'Отозвать' })).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it('выгрузку уже отозвали — «Скачать»: тост «Выгрузка недоступна…», журнал перечитан', async () => {
    const a = await open();
    await exportReady();
    revokeBehind(a.scenario);
    fireEvent.click(
      within((await jobs())[0] as HTMLElement).getByRole('button', { name: 'Скачать' }),
    );
    await waitFor(
      () => expect(toast()).toBe('Выгрузка недоступна: срок хранения истёк или её отозвали.'),
      SLOW,
    );
    await waitFor(
      async () =>
        expect(
          within((await jobs())[0] as HTMLElement).queryByRole('button', { name: 'Скачать' }),
        ).toBeNull(),
      SLOW,
    );
    expect(((await jobs())[0] as HTMLElement).textContent).toContain('Отозвана владельцем');
  });

  it('выгрузку уже отозвали — «Отозвать»: тост «Выгрузка уже завершена.», журнал перечитан', async () => {
    const a = await open();
    await exportReady();
    revokeBehind(a.scenario);
    fireEvent.click(
      within((await jobs())[0] as HTMLElement).getByRole('button', { name: 'Отозвать' }),
    );
    await waitFor(() => expect(toast()).toBe('Выгрузка уже завершена.'), SLOW);
    await waitFor(
      async () =>
        expect(within((await jobs())[0] as HTMLElement).getByText('Отозвана')).toBeTruthy(),
      SLOW,
    );
  });

  it('без права data.export журнал не запрашивается (нет 403 listDatasetExportJobs)', async () => {
    const a = await open({
      persona: 'manager',
      setup: (s) => dropKey(s, 'data.export'),
    });
    expect(screen.getByRole('button', { name: 'Выгрузить' })).toHaveProperty('disabled', true);
    await new Promise((r) => setTimeout(r, 300));
    expect(a.responses().filter((r) => r.path.endsWith('/data/export-jobs'))).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Выгрузки' })).toBeNull();
  });

  it('журнал не загрузился — строка ошибки и «Повторить» в «Выгрузках»', async () => {
    const a = await open({
      setup: (s) => queue(s, 1),
      scenario: 'listDatasetExportJobs=forbidden_action',
    });
    const region = await journal();
    await waitFor(
      () => expect(within(region).getByRole('alert').textContent).toMatch(/^Не удалось загрузить/),
      SLOW,
    );
    a.scenario.setScenario(null);
    fireEvent.click(within(region).getByRole('button', { name: 'Повторить' }));
    await waitFor(
      async () =>
        expect(within((await jobs())[0] as HTMLElement).getByText('В очереди')).toBeTruthy(),
      SLOW,
    );
  });

  it('новые сверху: задание того же момента, что и прежнее, — первой строкой', async () => {
    const now = '2026-10-01T07:30:00Z';
    await open({
      setup: (s) => {
        s.setNow(now);
        queue(s, 1);
        const j = alta(s).dataExports?.[0] as Job & Record<string, unknown>;
        Object.assign(j, {
          id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
          datasetId: 'fleet.vehicles',
          datasetName: 'Автомобили',
          createdAt: now,
        });
      },
    });
    await waitFor(async () => expect(await jobs()).toHaveLength(1), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить' }));
    await waitFor(async () => expect(await jobs()).toHaveLength(2), SLOW);
    const titles = (await jobs()).map((j) => j.querySelector('.ox-dt-job-title')?.textContent);
    expect(titles).toEqual(['Поездки', 'Автомобили']);
  });
});
