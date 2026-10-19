// W2.23 · Экранные тесты «Ресурсного пула» и диалога «Запросить водителя» на сценарном сервере (MSW пула W2.51,
// пресет logistics-ready): каталог на окно Р-211, запрос с комментарием и без, срок #117, 409 в диалоге, входящие
// запросы владельца (одобрить с комментарием, отклонить), «Временно назначен», пусто, ошибка, только чтение, гейт.
import type { components } from '@ortus/api-client';
import type { ScenarioServer } from '@ortus/adapter/msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';
import { ALTA } from '../review/fixtures.test-util.ts';

type S = components['schemas'];

const SLOW = { timeout: 5_000 };
const H1 = 'Ресурсный пул';

interface PoolRow {
  id: string;
  driverMemberId: string;
  displayName: string;
  homeOrgUnitId: string;
  state: string;
  freeWindow: S['TimeWindow'];
}
interface TripRow {
  id: string;
  number: string;
  orgUnitId: string;
  driverMemberId?: string;
}
interface PoolState {
  pool: PoolRow[];
  trips: TripRow[];
  transfers: S['DriverTransfer'][];
}

const poolOf = (s: ScenarioServer): PoolState => {
  const org = s.state().orgs[ALTA] as unknown as { fleet?: PoolState };
  if (!org.fleet) throw new Error('в состоянии нет логистики «Альты»');
  return org.fleet;
};

/** Открытый запрос Водителя #104 (или #117) на Р-211 (или `tripNo`) от Котовой — как после «Отправить запрос». */
function requested(s: ScenarioServer, code = 'Водитель #104', tripNo = 'Р-211'): void {
  const f = poolOf(s);
  const pub = f.pool.find((p) => p.displayName === code);
  const trip = f.trips.find((t) => t.number === tripNo);
  if (!pub || !trip) throw new Error(`нет публикации или ${tripNo}`);
  const from = code === 'Водитель #117' ? '2026-10-01T12:00:00Z' : '2026-10-01T11:00:00Z';
  f.transfers.push({
    id: '5e2a7c10-0000-4000-8000-000000000901',
    driverMemberId: pub.driverMemberId,
    sourceOrgUnitId: pub.homeOrgUnitId,
    targetOrgUnitId: trip.orgUnitId,
    window: { startsAt: from, endsAt: '2026-10-01T15:00:00Z', timeZone: 'Europe/Moscow' },
    status: 'requested',
    revision: 1,
    tripId: trip.id,
    publicationId: pub.id,
    driverDisplayName: code,
    sourceOrgUnitName: code === 'Водитель #117' ? 'Восток Карго' : 'Юг Транс',
    targetOrgUnitName: 'Север Логистик',
    tripNumber: tripNo,
    reason: 'Нужен на вечер',
    requestedAt: '2026-10-01T07:20:00Z',
  });
}

beforeAll(() => {
  // React Aria Modal зовёт CSS.escape при открытии диалога (jsdom его не даёт) — как review.page.test.tsx W2.21.
  globalThis.CSS ??= {} as typeof CSS;
  globalThis.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (o: MockAppOptions = {}, url = `/t/${ALTA}/pool`): Promise<MockApp> => {
  app = await renderMockApp(url, { persona: 'manager', preset: 'logistics-ready', ...o });
  await screen.findByRole('heading', { level: 1, name: H1 }, SLOW);
  return app;
};

const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;

const card = async (code: string): Promise<HTMLElement> => {
  // Карточка каталога, не строка «Входящих запросов» с тем же псевдонимом.
  const el = await screen.findByText(code, { selector: '.ox-pl-driver .ox-pl-code' }, SLOW);
  return el.closest('article') as HTMLElement;
};

/** Значение `<dd>` после `<dt>` с термином. */
const dd = (root: HTMLElement, term: string): string | null | undefined =>
  [...root.querySelectorAll('dt')].find((d) => d.textContent === term)?.nextElementSibling
    ?.textContent;

describe('«Ресурсный пул»', () => {
  it('шапка, «Что скрыто в пуле», каталог на окно Р-211: #104 и #117 «Свободен», запрос на Р-211', async () => {
    await open();
    expect(document.querySelector('.ox-pl-crumb')?.textContent).toBe(
      'Москва / межфирменный ресурсный пул',
    );
    expect(
      screen.getByText(
        'Свободные водители других фирм группы. Показан минимум сведений, разрешённый владеющей фирмой. Запрос не даёт доступа до одобрения.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Что скрыто в пуле' })).toBeTruthy();
    const a = await card('Водитель #104');
    expect(a.textContent).toContain('Кат. C · рефрижератор · Юг Транс');
    expect(a.querySelector('.ox-pl-chip')?.textContent).toContain('Свободен');
    expect(dd(a, 'Свободен')).toBe('13:00–19:00');
    expect(dd(a, 'Условия')).toBe('По соглашению фирм группы');
    expect(within(a).getByRole('button', { name: 'Запросить на рейс Р-211' })).toBeTruthy();
    const b = await card('Водитель #117');
    expect(dd(b, 'Свободен')).toBe('15:00–20:00');
    expect(screen.queryByRole('heading', { level: 2, name: 'Входящие запросы' })).toBeNull();
  });

  it('диалог «Запросить водителя»: поля эталона; «Отправить запрос» с комментарием → тост, чип, reason', async () => {
    const a = await open();
    fireEvent.click(
      within(await card('Водитель #104')).getByRole('button', { name: 'Запросить на рейс Р-211' }),
    );
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    expect(within(dlg).getByRole('heading', { name: 'Запросить водителя' })).toBeTruthy();
    expect(dlg.textContent).toContain('Водитель #104 · Юг Транс');
    expect(dd(dlg, 'Рейс')).toBe('Р-211 · Охлаждённая продукция · 14:00–18:00');
    expect(dd(dlg, 'Срок')).toBe('Временно, до 18:00 01.10');
    expect(dd(dlg, 'Согласует')).toBe('Менеджер фирмы Юг Транс');
    const comment = within(dlg).getByLabelText('Комментарий для фирмы-владельца');
    expect(comment.getAttribute('placeholder')).toBe('Необязательно');
    fireEvent.change(comment, { target: { value: 'Нужен рефрижератор' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Отправить запрос' }));
    await waitFor(() => expect(toast()).toBe('Запрос отправлен фирме Юг Транс'), SLOW);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
    const c = await card('Водитель #104');
    await waitFor(
      () => expect(c.querySelector('.ox-pl-chip')?.textContent).toContain('Запрос отправлен'),
      SLOW,
    );
    expect(within(c).getByRole('status').textContent).toContain(
      'Ожидает решения менеджера фирмы Юг Транс. Доступа к водителю пока нет.',
    );
    const [x] = poolOf(a.scenario).transfers;
    expect(x).toMatchObject({ reason: 'Нужен рефрижератор', status: 'requested' });
    expect(x?.window.startsAt).toBe('2026-10-01T11:00:00Z');
  });

  it('#117 свободен с 15:00: срок «Временно, с 15:00 до 18:00 01.10»; без комментария — «Запрос на рейс Р-211»', async () => {
    const a = await open();
    fireEvent.click(
      within(await card('Водитель #117')).getByRole('button', { name: 'Запросить на рейс Р-211' }),
    );
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    expect(dd(dlg, 'Срок')).toBe('Временно, с 15:00 до 18:00 01.10');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Отправить запрос' }));
    await waitFor(() => expect(toast()).toBe('Запрос отправлен фирме Восток Карго'), SLOW);
    const [x] = poolOf(a.scenario).transfers;
    expect(x?.reason).toBe('Запрос на рейс Р-211');
    expect(x?.window).toMatchObject({
      startsAt: '2026-10-01T12:00:00Z',
      endsAt: '2026-10-01T15:00:00Z',
    });
  });

  it('409 в диалоге: сообщение сервера (role=alert), диалог открыт', async () => {
    await open({ scenario: 'requestDriverTransfer=invalid_transition' });
    fireEvent.click(
      within(await card('Водитель #104')).getByRole('button', { name: 'Запросить на рейс Р-211' }),
    );
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Отправить запрос' }));
    const alert = await within(dlg).findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // Возврат 2: в эталоне (:2296) `disabled` на время отправки — только у «Отправить запрос».
  it('пока запрос отправляется: «Отмена» и комментарий доступны; «Отмена» закрывает, ответ не закрывает следующий диалог', async () => {
    const a = await open({ scenario: 'requestDriverTransfer=delay=800' });
    fireEvent.click(
      within(await card('Водитель #104')).getByRole('button', { name: 'Запросить на рейс Р-211' }),
    );
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Отправить запрос' }));
    await waitFor(
      () =>
        expect(
          (within(dlg).getByRole('button', { name: 'Отправить запрос' }) as HTMLButtonElement)
            .disabled,
        ).toBe(true),
      SLOW,
    );
    const cancel = within(dlg).getByRole('button', { name: 'Отмена' }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    const comment = within(dlg).getByLabelText(
      'Комментарий для фирмы-владельца',
    ) as HTMLTextAreaElement;
    expect(comment.disabled).toBe(false);
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
    // Пока первый запрос в пути — диалог для #117; его ответ не закрывает этот диалог и не пишет в него ошибку.
    fireEvent.click(
      within(await card('Водитель #117')).getByRole('button', { name: 'Запросить на рейс Р-211' }),
    );
    const next = await screen.findByRole('dialog', undefined, SLOW);
    expect(next.textContent).toContain('Водитель #117 · Восток Карго');
    await waitFor(() => expect(toast()).toBe('Запрос отправлен фирме Юг Транс'), SLOW);
    await waitFor(() => expect(poolOf(a.scenario).transfers).toHaveLength(1), SLOW);
    expect(screen.getByRole('dialog').textContent).toContain('Водитель #117 · Восток Карго');
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull();
  });

  // 422 (`window`, `tripId`) и 404 — состояние сервера меняется, пока диалог открыт; текст сервера — в диалоге.
  it.each([
    [
      '422 window: срок вне свободного окна',
      (f: PoolState) => {
        const pub = f.pool.find((p) => p.displayName === 'Водитель #104');
        if (pub) pub.freeWindow = { ...pub.freeWindow, endsAt: '2026-10-01T13:00:00Z' };
      },
      'Срок вне свободного окна водителя.',
    ],
    [
      '422 tripId: рейс другой фирмы',
      (f: PoolState) => {
        const trip = f.trips.find((t) => t.number === 'Р-211');
        const pub = f.pool.find((p) => p.displayName === 'Водитель #117');
        if (trip && pub) trip.orgUnitId = pub.homeOrgUnitId;
      },
      'Рейс другой фирмы.',
    ],
    [
      '404: публикация снята',
      (f: PoolState) => {
        const pub = f.pool.find((p) => p.displayName === 'Водитель #104');
        if (pub) pub.state = 'withdrawn';
      },
      'Водитель не опубликован в пуле.',
    ],
  ])('%s — текст сервера в диалоге (role=alert), тоста нет', async (_, change, text) => {
    const a = await open({ persona: 'owner' });
    fireEvent.click(
      within(await card('Водитель #104')).getByRole('button', { name: 'Запросить на рейс Р-211' }),
    );
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    change(poolOf(a.scenario));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Отправить запрос' }));
    const alert = await within(dlg).findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toContain(text);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(toast()).toBeUndefined();
    expect(poolOf(a.scenario).transfers).toHaveLength(0);
  });

  it('«Рейс для запроса»: рейсов без водителя два — выбор, каталог на окно выбранного, ?trip=', async () => {
    const a = await open({
      setup: (s) => {
        const r208 = poolOf(s).trips.find((t) => t.number === 'Р-208');
        if (r208) delete r208.driverMemberId;
      },
    });
    const pick = (await screen.findByLabelText(
      'Рейс для запроса',
      undefined,
      SLOW,
    )) as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual([
      'Р-208 · Северный маршрут · 09:00–13:00',
      'Р-211 · Охлаждённая продукция · 14:00–18:00',
    ]);
    // Без ?trip= — первый по началу окна рейс без водителя: Р-208, каталог на 09:00–13:00 пуст.
    expect(pick.selectedOptions[0]?.textContent).toMatch(/^Р-208 /);
    expect(
      await screen.findByText('В пуле нет свободных водителей на это время', undefined, SLOW),
    ).toBeTruthy();
    const r211 = poolOf(a.scenario).trips.find((t) => t.number === 'Р-211');
    fireEvent.change(pick, { target: { value: r211?.id } });
    await waitFor(
      () => expect(a.router.state.location.search).toMatchObject({ trip: r211?.id }),
      SLOW,
    );
    expect(
      within(await card('Водитель #104')).getByRole('button', { name: 'Запросить на рейс Р-211' }),
    ).toBeTruthy();
    expect(dd(await card('Водитель #117'), 'Свободен')).toBe('15:00–20:00');
  });

  it('запрос отправлен ранее: чип и текст, у #117 запрос остаётся', async () => {
    await open({ setup: (s) => requested(s) });
    const a = await card('Водитель #104');
    await waitFor(
      () => expect(a.querySelector('.ox-pl-chip')?.textContent).toContain('Запрос отправлен'),
      SLOW,
    );
    expect(within(a).queryByRole('button', { name: /Запросить на рейс/ })).toBeNull();
    expect(
      within(await card('Водитель #117')).getByRole('button', { name: 'Запросить на рейс Р-211' }),
    ).toBeTruthy();
  });

  // Возврат 2: открытый запрос у публикации один на любой рейс (driver_transfers_open_uq, MSW pool.ts): запрос #104 на
  // Р-208 блокирует «Запросить на рейс Р-211» — иначе «Отправить запрос» получает 409 «Запрос уже отправлен».
  it('открытый запрос на другой рейс (Р-208): на Р-211 — «Запрос отправлен», «Ожидает решения…», без запроса', async () => {
    await open({ setup: (s) => requested(s, 'Водитель #104', 'Р-208') });
    const a = await card('Водитель #104');
    await waitFor(
      () => expect(a.querySelector('.ox-pl-chip')?.textContent).toContain('Запрос отправлен'),
      SLOW,
    );
    expect(within(a).getByRole('status').textContent).toContain(
      'Ожидает решения менеджера фирмы Юг Транс. Доступа к водителю пока нет.',
    );
    expect(within(a).queryByRole('button', { name: /Запросить на рейс/ })).toBeNull();
    expect(
      within(await card('Водитель #117')).getByRole('button', { name: 'Запросить на рейс Р-211' }),
    ).toBeTruthy();
  });

  it('владелец: «Входящие запросы» — «Одобрить» с комментарием → тост, «Временно назначен»', async () => {
    const a = await open({ persona: 'owner', setup: (s) => requested(s) });
    const block = (
      await screen.findByRole('heading', { level: 2, name: 'Входящие запросы' }, SLOW)
    ).closest('section') as HTMLElement;
    const row = within(block).getByText('Водитель #104').closest('article') as HTMLElement;
    expect(row.textContent).toContain('Север Логистик · рейс Р-211');
    expect(row.textContent).toContain('01.10.2026 · 14:00–18:00');
    expect(row.textContent).toContain('Нужен на вечер');
    fireEvent.change(within(row).getByLabelText('Комментарий к решению'), {
      target: { value: 'Отпускаем' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Одобрить' }));
    await waitFor(() => expect(toast()).toBe('Фирма Юг Транс одобрила запрос'), SLOW);
    await waitFor(
      () =>
        expect(screen.queryByRole('heading', { level: 2, name: 'Входящие запросы' })).toBeNull(),
      SLOW,
    );
    const c = await card('Водитель #104');
    await waitFor(
      () => expect(c.querySelector('.ox-pl-chip')?.textContent).toContain('Временно назначен'),
      SLOW,
    );
    expect(within(c).getByRole('status').textContent).toContain(
      'Водитель #104 назначен на рейс Р-211 до 18:00 01.10. Доступ ограничен этим рейсом; история и начисления остаются в фирме Юг Транс.',
    );
    const [x] = poolOf(a.scenario).transfers;
    expect(x).toMatchObject({ status: 'approved', decisionComment: 'Отпускаем' });
    expect(within(await card('Водитель #117')).queryByRole('button')).toBeNull();
  });

  it('владелец: «Отклонить» → тост, «Запрос отклонён. Можно запросить другого водителя.»', async () => {
    await open({ persona: 'owner', setup: (s) => requested(s) });
    const block = (
      await screen.findByRole('heading', { level: 2, name: 'Входящие запросы' }, SLOW)
    ).closest('section') as HTMLElement;
    fireEvent.click(within(block).getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(toast()).toBe('Фирма Юг Транс отклонила запрос'), SLOW);
    const c = await card('Водитель #104');
    await waitFor(
      () => expect(c.querySelector('.ox-pl-chip')?.textContent).toContain('Отклонён'),
      SLOW,
    );
    expect(c.textContent).toContain('Запрос отклонён. Можно запросить другого водителя.');
    expect(within(c).getByRole('button', { name: 'Запросить на рейс Р-211' })).toBeTruthy();
  });

  it('после «Отклонить» повторный запрос того же водителя на тот же рейс создаёт новый запрос', async () => {
    const a = await open({ persona: 'owner' });
    const send = async (): Promise<void> => {
      fireEvent.click(
        await within(await card('Водитель #104')).findByRole(
          'button',
          { name: 'Запросить на рейс Р-211' },
          SLOW,
        ),
      );
      const dlg = await screen.findByRole('dialog', undefined, SLOW);
      fireEvent.click(within(dlg).getByRole('button', { name: 'Отправить запрос' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
    };
    await send();
    await waitFor(() => expect(poolOf(a.scenario).transfers).toHaveLength(1), SLOW);
    const block = (
      await screen.findByRole('heading', { level: 2, name: 'Входящие запросы' }, SLOW)
    ).closest('section') as HTMLElement;
    fireEvent.click(within(block).getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(toast()).toBe('Фирма Юг Транс отклонила запрос'), SLOW);
    const declined = await card('Водитель #104');
    await waitFor(
      () => expect(declined.querySelector('.ox-pl-chip')?.textContent).toContain('Отклонён'),
      SLOW,
    );
    await send();
    await waitFor(
      () =>
        expect(poolOf(a.scenario).transfers.map((x) => x.status)).toEqual([
          'rejected',
          'requested',
        ]),
      SLOW,
    );
    const c = await card('Водитель #104');
    await waitFor(
      () => expect(c.querySelector('.ox-pl-chip')?.textContent).toContain('Запрос отправлен'),
      SLOW,
    );
  });

  it('пусто: нет водителей на окно рейса', async () => {
    await open({ scenario: 'listAvailableDrivers=empty' });
    expect(
      await screen.findByText('В пуле нет свободных водителей на это время', undefined, SLOW),
    ).toBeTruthy();
  });

  it('пусто: нет рейса без водителя', async () => {
    await open({
      setup: (s) => {
        for (const t of poolOf(s).trips) t.driverMemberId ??= 'занят';
      },
    });
    expect(await screen.findByText('Нет рейсов без водителя', undefined, SLOW)).toBeTruthy();
  });

  it('ошибка загрузки: текст и «Повторить»', async () => {
    const a = await open({ scenario: 'listAvailableDrivers=rate_limited' });
    const err = await screen.findByText(/Не удалось загрузить пул/, undefined, SLOW);
    expect(err.textContent).toBe(
      'Не удалось загрузить пул: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await card('Водитель #104')).toBeTruthy();
  });

  it('ошибка загрузки входящих: текст в блоке «Входящие запросы» и «Повторить»', async () => {
    const a = await open({
      persona: 'owner',
      scenario: 'listDriverTransfers=rate_limited',
      setup: (s) => requested(s),
    });
    const block = (
      await screen.findByRole('heading', { level: 2, name: 'Входящие запросы' }, SLOW)
    ).closest('section') as HTMLElement;
    const err = await within(block).findByRole('alert', undefined, SLOW);
    expect(err.textContent).toContain(
      'Не удалось загрузить входящие запросы: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(within(err).getByRole('button', { name: 'Повторить' }));
    const row = await within(block).findByText('Водитель #104', undefined, SLOW);
    expect(
      within(row.closest('article') as HTMLElement).getByRole('button', { name: 'Одобрить' }),
    ).toBeTruthy();
    expect(within(block).queryByRole('alert')).toBeNull();
  });

  it('только чтение: запроса и решений нет', async () => {
    await open({
      persona: 'owner',
      setup: (s) => {
        requested(s, 'Водитель #117');
        s.applyPreset('trial-ended');
      },
    });
    await card('Водитель #104');
    expect(screen.queryByRole('button', { name: /Запросить на рейс/ })).toBeNull();
    const block = (
      await screen.findByRole('heading', { level: 2, name: 'Входящие запросы' }, SLOW)
    ).closest('section') as HTMLElement;
    for (const name of ['Одобрить', 'Отклонить']) {
      expect((within(block).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
  });

  it('водитель: гейт оболочки', async () => {
    app = await renderMockApp(`/t/${ALTA}/pool`, { persona: 'driver', preset: 'logistics-ready' });
    expect(await screen.findByText(/Нет роли с доступом/, undefined, SLOW)).toBeTruthy();
  });
});
