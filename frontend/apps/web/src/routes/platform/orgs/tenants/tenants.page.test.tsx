// W1.25 · Экранные тесты «Организаций» оператора на MSW-сценарном сервере (сид W0.12, контракт 0.4.0-stage1):
// список и карточка (04-platform §5.1, §8 п. 7–14), `?org=` (ADR-0001), состояния без эталона, три команды с
// причиной (S1-04, Q-W1.00-1…6), «Журнал действий» (S1-23), ошибки 409/422 и нет связи.
import { errors, shell, toast } from '@ortus/texts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BASE_URL, type MockApp, renderMockApp, tenantIdOf } from '../../../../app/testing.tsx';

// jsdom без CSS.escape: react-aria (getMetaValue) вызывает его, когда открывается модальное окно.
if (!globalThis.CSS?.escape) {
  Object.assign(globalThis, {
    CSS: { escape: (s: string) => s.replace(/[^\w-]/g, (ch) => `\\${ch}`) },
  });
}

let app: MockApp | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T07:30:00Z') });
});
afterEach(() => {
  app?.close();
  app = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const open = async (url = '/platform/tenants', o: Parameters<typeof renderMockApp>[1] = {}) => {
  app = await renderMockApp(url, { persona: 'operator', ...o });
  return app;
};

/** Запрос приложения и ответ сценарного сервера (заголовки и тело — для проверки команд). */
interface Exchange {
  method: string;
  path: string;
  headers: Headers;
  body: string;
  /** ETag ответа; нет ответа (нет связи) — null. */
  etag: string | null;
}

/**
 * Наблюдатель запросов: обёртка fetch со сквозным вызовом, поставленная после `server.listen` MSW и до создания
 * клиента API (`setup` renderMockApp). Ответ даёт сценарный сервер, fetch не подменяется (tdd-protocol §3).
 */
const watchRequests = (): { seen: Exchange[]; setup: () => void } => {
  const seen: Exchange[] = [];
  return {
    seen,
    setup: () => {
      const through = globalThis.fetch;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const req = new Request(input, init);
        const ex: Exchange = {
          method: req.method,
          path: new URL(req.url).pathname,
          headers: req.headers,
          body: await req.clone().text(),
          etag: null,
        };
        seen.push(ex);
        const res = await through(req);
        ex.etag = res.headers.get('ETag');
        return res;
      });
    },
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Другой оператор» продлевает пробный период мимо экрана: запрос к сценарному серверу с сессией и CSRF теста
 * (cookie — общий jar renderMockApp). Ревизия подписки на сервере растёт, экран её ещё не видел.
 */
const extendElsewhere = async (a: MockApp, tenantId: string): Promise<void> => {
  const csrf = Object.values(a.scenario.state().sessions)[0]?.csrf ?? '';
  const base = `${BASE_URL}/api/v1/platform/tenants/${tenantId}`;
  const cur = await fetch(`${base}/subscription`);
  const r = await fetch(`${base}/trial-extensions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      'Idempotency-Key': crypto.randomUUID(),
      'If-Match': cur.headers.get('ETag') ?? '',
    },
    body: JSON.stringify({ reason: 'Продлил другой оператор', days: 14 }),
  });
  expect(r.status).toBe(200);
};

const ALTA = 'Альта Групп';
const LOTOS = 'SPA «Лотос»';
const REMSTROY = 'Ремстрой Плюс';
const CARGO = 'Карго Сити';
const EXTEND = 'Продлить пробный период на 14 дней';
const RESTRICT = 'Ограничить новые операции';
const LIFT = 'Снять ограничение';
const REASON = 'Клиент попросил время на оплату';

const section = () => screen.getByRole('region', { name: 'Организации-клиенты' });
const rows = () =>
  Array.from(section().querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
const row = (name: string) => {
  const r = rows().find((b) => b.querySelector('.ox-org-name')?.textContent === name);
  if (!r) throw new Error(`нет строки «${name}»`);
  return r;
};
const card = (name: string) => screen.getByRole('complementary', { name });
const listed = async () => {
  await screen.findByRole('heading', { level: 1, name: 'Организации-клиенты' });
  await waitFor(() => expect(rows()).toHaveLength(4));
};
const ready = async () => {
  await listed();
  await waitFor(() => {
    const trial = row(ALTA).querySelector('.ox-org-trial');
    expect(trial?.hasAttribute('data-loading')).toBe(false);
    expect(trial?.textContent).not.toBe('—');
  });
};
const dd = (c: HTMLElement, label: string) => {
  const dt = within(c)
    .getAllByRole('term')
    .find((x) => x.textContent === label);
  return dt?.nextElementSibling?.textContent;
};
const journal = (c: HTMLElement) => Array.from(c.querySelectorAll('.ox-audit-row'));
const reasonField = (dialog: HTMLElement) => within(dialog).getByLabelText('Причина');

describe('«Организации-клиенты»: список', () => {
  it('заголовок, надзаголовок, баннер, data-screen-label; четыре строки, первая выбрана', async () => {
    await open();
    await ready();
    expect(section().getAttribute('data-screen-label')).toBe('Оператор · организации');
    expect(within(section()).getByText('Платформа Ортус')).toBeTruthy();
    expect(within(section()).getByText(/^Отдельное административное пространство\./)).toBeTruthy();
    expect(rows().map((b) => b.querySelector('.ox-org-name')?.textContent)).toEqual([
      ALTA,
      LOTOS,
      REMSTROY,
      CARGO,
    ]);
    expect(row(ALTA).getAttribute('aria-pressed')).toBe('true');
    expect(row(LOTOS).getAttribute('aria-pressed')).toBe('false');
  });

  it('строки: знак, владелец и места, чип, место, пробный период', async () => {
    await open();
    await ready();
    const text = (name: string, cls: string) => row(name).querySelector(cls)?.textContent;
    expect(text(ALTA, '.ox-org-mark')).toBe('А');
    expect(row(ALTA).querySelector('.ox-org-mark')?.getAttribute('aria-hidden')).toBe('true');
    expect(text(ALTA, '.ox-org-owner')).toBe('Владелец: — · мест —/10');
    expect(text(ALTA, '.ox-chip')).toContain('Пробный период');
    expect(text(ALTA, '.ox-org-usage')).toBe('— из 100 ГБ');
    expect(text(ALTA, '.ox-org-trial')).toBe('Осталось 12 дн. · до 13.10.2026');
    expect(text(LOTOS, '.ox-chip')).toContain('Действует');
    expect(text(LOTOS, '.ox-org-trial')).toBe('Не применяется');
    expect(text(REMSTROY, '.ox-chip')).toContain('Ограничен');
    expect(text(REMSTROY, '.ox-org-trial')).toBe('Завершён 20.09.2026');
    expect(text(CARGO, '.ox-chip')).toContain('Приостановлен');
    expect(text(CARGO, '.ox-org-usage')).toBe('— из 100 ГБ');
  });

  it('клик по строке выбирает организацию и пишет ?org= в адрес', async () => {
    const a = await open();
    await ready();
    fireEvent.click(row(LOTOS));
    await waitFor(() => expect(row(LOTOS).getAttribute('aria-pressed')).toBe('true'));
    expect(card(LOTOS)).toBeTruthy();
    expect(a.router.state.location.search).toEqual({ org: tenantIdOf(a.scenario, LOTOS) });
  });

  it('загрузка: свой скелетон строк списка «Загрузка» до ответа списка, без текста загрузки оболочки', async () => {
    await open('/platform/tenants', { scenario: 'listPlatformTenants=loading' });
    await screen.findByRole('heading', { level: 1, name: 'Организации-клиенты' });
    const status = within(section()).getByRole('status', { name: 'Загрузка' });
    expect(status.classList.contains('ox-orgs-skeleton')).toBe(true);
    expect(status.querySelectorAll('.ox-orgs-skeleton-row')).toHaveLength(4);
    expect(section().textContent).not.toContain(shell.boot.loading);
  });

  it('строки: пока подписка загружается — колонки из подписки помечены data-loading, а не голое «—» этапа 4', async () => {
    await open('/platform/tenants', { scenario: 'getPlatformSubscription=delay=400' });
    await listed();
    const cols = (name: string) =>
      ['.ox-org-owner', '.ox-org-usage', '.ox-org-trial'].map((cls) =>
        row(name).querySelector<HTMLElement>(cls),
      );
    for (const name of [ALTA, LOTOS, REMSTROY, CARGO]) {
      for (const col of cols(name)) expect(col?.dataset.loading).toBe('true');
      expect(row(name).querySelector('.ox-org-trial')?.hasAttribute('data-failed')).toBe(false);
      // Скелетон без текста (axe color-contrast, возврат доделки №2): «—» не читается как данные, а одно
      // скрытое «Загрузка» говорит о загрузке строки.
      expect(row(name).textContent).not.toContain('—');
      const [owner, usage, trial] = cols(name);
      expect(owner?.textContent).toBe(shell.a11y.loading);
      expect(owner?.querySelector('.ox-sr')?.textContent).toBe(shell.a11y.loading);
      for (const col of [usage, trial]) {
        expect(col?.textContent).toBe('');
        expect(col?.getAttribute('aria-hidden')).toBe('true');
      }
    }
    await waitFor(() =>
      expect(row(ALTA).querySelector('.ox-org-trial')?.textContent).toBe(
        'Осталось 12 дн. · до 13.10.2026',
      ),
    );
    for (const name of [ALTA, LOTOS, REMSTROY, CARGO]) {
      await waitFor(() => {
        for (const col of cols(name)) expect(col?.hasAttribute('data-loading')).toBe(false);
      });
    }
  });

  it('ошибка подписок: строки — «Подписка не загружена», а не «—» этапа 4; «Повторить» карточки возвращает данные', async () => {
    const a = await open('/platform/tenants', { scenario: 'getPlatformSubscription=rate_limited' });
    await listed();
    const trial = (name: string) => row(name).querySelector('.ox-org-trial')?.textContent;
    await waitFor(() => expect(trial(CARGO)).toBe('Подписка не загружена'));
    for (const name of [ALTA, LOTOS, REMSTROY]) expect(trial(name)).toBe('Подписка не загружена');
    expect(row(LOTOS).textContent).toContain('Подписка не загружена');
    a.scenario.setScenario(null);
    const alert = await within(card(ALTA)).findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(trial(LOTOS)).toBe('Не применяется'));
    expect(trial(ALTA)).toBe('Осталось 12 дн. · до 13.10.2026');
  });

  it('ошибка загрузки: alert с текстом по коду и «Повторить»', async () => {
    const a = await open('/platform/tenants', {
      scenario: 'listPlatformTenants=rate_limited',
    });
    const alert = await within(
      await screen.findByRole('region', { name: 'Организации-клиенты' }),
    ).findByRole('alert');
    expect(alert.textContent).toContain(errors.problem.rate_limited);
    a.scenario.setScenario(null);
    const retry = within(alert).getByRole('button', { name: 'Повторить' });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(rows()).toHaveLength(4));
    // alert с «Повторить» размонтирован: фокус — на выбранной строке, а не на body (возврат доделки №2).
    await waitFor(() => expect(document.activeElement).toBe(row(ALTA)));
  });

  it('нет связи при загрузке списка: текст для чтения, без «Операция не выполнена» команд', async () => {
    await open('/platform/tenants', { scenario: 'listPlatformTenants=offline' });
    const alert = await within(
      await screen.findByRole('region', { name: 'Организации-клиенты' }),
    ).findByRole('alert');
    expect(alert.querySelector('span')?.textContent).toBe(
      'Не удалось загрузить организации: Нет связи с сервером. Проверьте подключение.',
    );
    expect(alert.textContent).not.toContain(errors.client.offline);
  });

  it('пусто: «Организаций пока нет»', async () => {
    await open('/platform/tenants', { scenario: 'listPlatformTenants=empty' });
    expect(await screen.findByText('Организаций пока нет')).toBeTruthy();
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('карточка организации', () => {
  it('«Альта Групп»: dl, места, кнопки продления и «Ограничить…», без «Снять ограничение»', async () => {
    await open();
    await ready();
    const c = card(ALTA);
    expect(within(c).getByRole('heading', { level: 2, name: ALTA })).toBeTruthy();
    expect(
      within(c)
        .getAllByRole('term')
        .map((x) => x.textContent),
    ).toEqual(['Владелец', 'Пробный период', 'Модули', 'Участники', 'Место', 'Тариф', 'Оплата']);
    expect(dd(c, 'Владелец')).toBe('—');
    expect(dd(c, 'Пробный период')).toBe('Осталось 12 дн. · до 13.10.2026');
    expect(dd(c, 'Модули')).toBe('—');
    expect(dd(c, 'Участники')).toBe('—');
    expect(dd(c, 'Место')).toBe('— из 100 ГБ');
    expect(dd(c, 'Тариф')).toBe('«Старт» · пробный · цены v2');
    expect(dd(c, 'Оплата')).toBe('Пробный период');
    expect(c.querySelector('.ox-org-seats')?.textContent).toBe('— из 10');
    expect(within(c).getByRole('button', { name: EXTEND })).toBeTruthy();
    expect(within(c).getByRole('button', { name: RESTRICT })).toBeTruthy();
    expect(within(c).queryByRole('button', { name: LIFT })).toBeNull();
    expect(within(c).queryByText('Квота места')).toBeNull();
  });

  it('?org=<Карго Сити>: «Приостановлен», «Снять ограничение», без продления', async () => {
    const a = await open('/platform/tenants');
    await ready();
    const id = tenantIdOf(a.scenario, CARGO);
    a.close();
    await open(`/platform/tenants?org=${id}`);
    await ready();
    const c = card(CARGO);
    expect(row(CARGO).getAttribute('aria-pressed')).toBe('true');
    expect(c.querySelector('.ox-chip')?.textContent).toContain('Приостановлен');
    expect(within(c).getByRole('button', { name: LIFT })).toBeTruthy();
    expect(within(c).queryByRole('button', { name: EXTEND })).toBeNull();
    expect(within(c).queryByRole('button', { name: RESTRICT })).toBeNull();
  });

  it('неизвестный ?org= — карточка первой организации', async () => {
    await open('/platform/tenants?org=00000000-0000-5000-8000-000000000000');
    await ready();
    expect(card(ALTA)).toBeTruthy();
  });

  it('«Ремстрой Плюс» (read_only после trial): тариф без «пробный» — «пробный» только у trialing', async () => {
    const a = await open('/platform/tenants');
    await ready();
    fireEvent.click(row(REMSTROY));
    await waitFor(() => expect(row(REMSTROY).getAttribute('aria-pressed')).toBe('true'));
    expect(a.router.state.location.search).toEqual({ org: tenantIdOf(a.scenario, REMSTROY) });
    await waitFor(() => expect(dd(card(REMSTROY), 'Тариф')).toBe('«Старт» · цены v2'));
  });

  it('«Журнал действий»: строки сида дословно', async () => {
    await open();
    await ready();
    const c = card(ALTA);
    expect(within(c).getByRole('heading', { level: 3, name: 'Журнал действий' })).toBeTruthy();
    await waitFor(() => expect(journal(c)).toHaveLength(2));
    const [first, second] = journal(c);
    expect(first?.querySelector('.ox-audit-text')?.textContent).toBe(
      'Альта Групп: открыт пробный период на 14 дней, квота 100 ГБ',
    );
    expect(first?.querySelector('.ox-audit-meta')?.textContent).toBe('30.09 18:12 · Е. Лаптева');
    expect(second?.querySelector('.ox-audit-meta')?.textContent).toBe('21.09 09:00 · Система');
  });
});

describe('карточка: загрузка и ошибки своих данных (no-reference, verification-protocol §1.3)', () => {
  it('подписка загружается: карточка занята, «Загрузка», значения подписки — скелетон без «—»', async () => {
    await open('/platform/tenants', { scenario: 'getPlatformSubscription=loading' });
    await listed();
    const c = card(ALTA);
    // Журнал загружается сам по себе: сначала его строки, затем единственный статус «Загрузка» — подписки.
    await waitFor(() => expect(journal(c)).toHaveLength(2));
    expect(c.getAttribute('aria-busy')).toBe('true');
    expect(within(c).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    // Значения из подписки — скелетон со скрытым «Загрузка», а не «—» (возврат доделки №2).
    expect(c.querySelector('.ox-org-seats')?.textContent).toBe(shell.a11y.loading);
    expect(dd(c, 'Тариф')).toBe(shell.a11y.loading);
    for (const el of c.querySelectorAll('[data-loading]')) {
      expect(el.textContent).not.toContain('—');
    }
    expect(within(c).queryByRole('alert')).toBeNull();
  });

  it('ошибка подписки: alert в карточке с текстом по коду и «Повторить» — данные и продление возвращаются', async () => {
    const a = await open('/platform/tenants', { scenario: 'getPlatformSubscription=rate_limited' });
    await listed();
    const c = card(ALTA);
    const alert = await within(c).findByRole('alert');
    expect(alert.textContent).toContain('Не удалось загрузить подписку');
    expect(alert.textContent).toContain(errors.problem.rate_limited);
    expect(c.getAttribute('aria-busy')).not.toBe('true');
    expect(c.querySelector('.ox-org-seats')?.textContent).toBe('—');
    expect(within(c).queryByRole('button', { name: EXTEND })).toBeNull();
    a.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(dd(card(ALTA), 'Тариф')).toBe('«Старт» · пробный · цены v2'));
    expect(card(ALTA).querySelector('.ox-org-seats')?.textContent).toBe('— из 10');
    expect(within(card(ALTA)).getByRole('button', { name: EXTEND })).toBeTruthy();
    expect(within(card(ALTA)).queryByRole('alert')).toBeNull();
    // «Повторить» перечитывает подписки всех строк, не только выбранной.
    await waitFor(() =>
      expect(row(CARGO).querySelector('.ox-org-usage')?.textContent).toBe('— из 100 ГБ'),
    );
  });

  it('ошибка организации: alert «Не удалось загрузить организацию…», команда недоступна до «Повторить»', async () => {
    const a = await open('/platform/tenants', { scenario: 'getPlatformTenant=rate_limited' });
    await ready();
    const c = card(ALTA);
    const alert = await within(c).findByRole('alert');
    expect(alert.textContent).toContain('Не удалось загрузить организацию');
    expect(alert.textContent).toContain(errors.problem.rate_limited);
    expect(within(c).getByRole('button', { name: RESTRICT })).toHaveProperty('disabled', true);
    a.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect(within(card(ALTA)).getByRole('button', { name: RESTRICT })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    expect(within(card(ALTA)).queryByRole('alert')).toBeNull();
  });

  it('журнал пуст: «Действий пока нет»', async () => {
    await open('/platform/tenants', { scenario: 'listPlatformAuditEvents=empty' });
    await ready();
    const c = card(ALTA);
    expect(await within(c).findByText('Действий пока нет')).toBeTruthy();
    expect(journal(c)).toHaveLength(0);
  });

  it('ошибка журнала: alert «Не удалось загрузить журнал…» и «Повторить» — строки сида', async () => {
    const a = await open('/platform/tenants', { scenario: 'listPlatformAuditEvents=rate_limited' });
    await ready();
    const c = card(ALTA);
    const alert = await within(c).findByRole('alert');
    expect(alert.textContent).toContain('Не удалось загрузить журнал');
    expect(alert.textContent).toContain(errors.problem.rate_limited);
    expect(within(c).queryByText('Действий пока нет')).toBeNull();
    a.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(journal(card(ALTA))).toHaveLength(2));
    expect(within(card(ALTA)).queryByRole('alert')).toBeNull();
  });

  it('журнал загружается: «Загрузка» в разделе журнала', async () => {
    await open('/platform/tenants', { scenario: 'listPlatformAuditEvents=loading' });
    await ready();
    const c = card(ALTA);
    const audit = within(c).getByRole('heading', { level: 3, name: 'Журнал действий' })
      .parentElement as HTMLElement;
    expect(within(audit).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    expect(c.getAttribute('aria-busy')).not.toBe('true');
  });
});

describe('команды: заголовки, 412 и повтор (бриф §4, §9)', () => {
  const extend = async (reason = REASON) => {
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: EXTEND }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Продлить пробный период «Альта Групп»?',
    });
    fireEvent.change(reasonField(dialog), { target: { value: reason } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Продлить' }));
    return dialog;
  };
  const posts = (seen: Exchange[], suffix: string) =>
    seen.filter((x) => x.method === 'POST' && x.path.endsWith(suffix));

  it('продление: If-Match = ETag подписки, Idempotency-Key — UUID, тело {reason без пробелов, days: 14}', async () => {
    const w = watchRequests();
    const a = await open('/platform/tenants', { setup: w.setup });
    await ready();
    const id = tenantIdOf(a.scenario, ALTA);
    const subGet = w.seen.find(
      (x) => x.method === 'GET' && x.path === `/api/v1/platform/tenants/${id}/subscription`,
    );
    expect(subGet?.etag).toBeTruthy();
    await extend(`  ${REASON}  `);
    expect(await screen.findByText(toast.platform.done)).toBeTruthy();
    const [post] = posts(w.seen, '/trial-extensions');
    expect(post?.headers.get('If-Match')).toBe(subGet?.etag);
    expect(post?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ reason: REASON, days: 14 });
  });

  it('«Ограничить…»: If-Match = ETag организации (getPlatformTenant), тело {reason}', async () => {
    const w = watchRequests();
    const a = await open('/platform/tenants', { setup: w.setup });
    await ready();
    const id = tenantIdOf(a.scenario, ALTA);
    await waitFor(() =>
      expect(within(card(ALTA)).getByRole('button', { name: RESTRICT })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    const tenantGet = w.seen.find(
      (x) => x.method === 'GET' && x.path === `/api/v1/platform/tenants/${id}`,
    );
    expect(tenantGet?.etag).toBeTruthy();
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: RESTRICT }));
    const dialog = await screen.findByRole('dialog', { name: 'Ограничить «Альта Групп»?' });
    fireEvent.change(reasonField(dialog), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ограничить' }));
    expect(await screen.findByText(toast.platform.done)).toBeTruthy();
    const [post] = posts(w.seen, '/suspend');
    expect(post?.headers.get('If-Match')).toBe(tenantGet?.etag);
    expect(post?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ reason: REASON });
  });

  it('412: подписку изменил другой оператор — тост, диалог открыт; повтор после перечитывания — новый ключ и If-Match перечитанной подписки', async () => {
    const w = watchRequests();
    const a = await open('/platform/tenants', { setup: w.setup });
    await ready();
    const id = tenantIdOf(a.scenario, ALTA);
    const subPath = `/api/v1/platform/tenants/${id}/subscription`;
    const shown = w.seen.filter((x) => x.method === 'GET' && x.path === subPath).at(-1)?.etag;
    expect(shown).toBeTruthy();
    await extendElsewhere(a, id);
    // Перечитывание после 412 идёт не мгновенно: повтор не должен уйти со старым If-Match раньше него.
    a.scenario.setScenario('getPlatformSubscription=delay=300');
    const mark = w.seen.length;
    const dialog = await extend();
    expect(await screen.findByText(errors.problem.revision_mismatch)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Продлить пробный период «Альта Групп»?' })).toBe(
      dialog,
    );
    await waitFor(() => expect(document.activeElement).toBe(reasonField(dialog)));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Продлить' }));
    expect(await screen.findByText(toast.platform.done, undefined, { timeout: 3000 })).toBeTruthy();
    const seen = w.seen.slice(mark);
    const [first, second] = posts(seen, '/trial-extensions');
    expect(first?.headers.get('If-Match')).toBe(shown);
    const reread = seen
      .slice(seen.indexOf(first as Exchange) + 1, seen.indexOf(second as Exchange))
      .filter((x) => x.method === 'GET' && x.path === subPath)
      .at(-1);
    expect(reread?.etag).toBeTruthy();
    expect(reread?.etag).not.toBe(shown);
    expect(second?.headers.get('If-Match')).toBe(reread?.etag);
    expect(second?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it('во время запроса кнопка действия занята (aria-disabled, aria-busy), а не disabled: фокус остаётся на ней', async () => {
    const a = await open();
    await ready();
    a.scenario.setScenario('extendPlatformTrial=delay=500');
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: EXTEND }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Продлить пробный период «Альта Групп»?',
    });
    fireEvent.change(reasonField(dialog), { target: { value: REASON } });
    const action = within(dialog).getByRole('button', { name: 'Продлить' });
    action.focus();
    fireEvent.click(action);
    await waitFor(() => expect(action.getAttribute('aria-busy')).toBe('true'));
    expect(action).toHaveProperty('disabled', false);
    expect(action.getAttribute('aria-disabled')).toBe('true');
    expect(action.textContent).toContain(shell.modal.busy);
    expect(document.activeElement).toBe(action);
    expect(await screen.findByText(toast.platform.done, undefined, { timeout: 3000 })).toBeTruthy();
  });

  it('нет связи: повтор из открытого диалога несёт тот же Idempotency-Key и If-Match', async () => {
    const w = watchRequests();
    const a = await open('/platform/tenants', { setup: w.setup });
    await ready();
    a.scenario.setScenario('extendPlatformTrial=offline', true);
    const dialog = await extend();
    expect(await screen.findByText(errors.client.offline)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(reasonField(dialog)));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Продлить' }));
    expect(await screen.findByText(toast.platform.done)).toBeTruthy();
    const [first, second] = posts(w.seen, '/trial-extensions');
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect(second?.headers.get('If-Match')).toBe(first?.headers.get('If-Match'));
    await waitFor(() =>
      expect(row(ALTA).querySelector('.ox-org-trial')?.textContent).toBe(
        'Осталось 26 дн. · до 27.10.2026',
      ),
    );
  });

  it('причина длиннее 500 символов: ошибка под полем «Не больше 500 символов», действие недоступно', async () => {
    await open();
    await ready();
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: EXTEND }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Продлить пробный период «Альта Групп»?',
    });
    fireEvent.change(reasonField(dialog), { target: { value: 'а'.repeat(501) } });
    expect(reasonField(dialog).getAttribute('aria-invalid')).toBe('true');
    expect(dialog.textContent).toContain('Не больше 500 символов');
    expect(within(dialog).getByRole('button', { name: 'Продлить' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.change(reasonField(dialog), { target: { value: 'а'.repeat(500) } });
    expect(reasonField(dialog).getAttribute('aria-invalid')).not.toBe('true');
    expect(dialog.textContent).not.toContain('Не больше 500 символов');
    expect(within(dialog).getByRole('button', { name: 'Продлить' })).toHaveProperty(
      'disabled',
      false,
    );
  });
});

describe('команды с причиной', () => {
  it('«Продлить…»: диалог эталона, «Продлить» недоступна без причины и при < 5 символах', async () => {
    await open();
    await ready();
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: EXTEND }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Продлить пробный период «Альта Групп»?',
    });
    expect(dialog.textContent).toContain('Продление на 14 дней.');
    expect(dialog.textContent).toContain('Последствия');
    expect(
      Array.from(dialog.querySelectorAll('.ox-orgs-conseq')).map((x) => x.textContent),
    ).toEqual(['Новые операции снова доступны', 'Действие записывается в журнал']);
    const confirm = within(dialog).getByRole('button', { name: 'Продлить' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(reasonField(dialog), { target: { value: 'Чек' } });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(reasonField(dialog), { target: { value: 'Чек 5' } });
    expect(confirm).toHaveProperty('disabled', false);
    expect(within(dialog).getByText('От 5 до 500 символов')).toBeTruthy();
  });

  it('«Продлить…» с причиной: тост, новый срок, строка журнала с причиной', async () => {
    const a = await open();
    await ready();
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: EXTEND }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Продлить пробный период «Альта Групп»?',
    });
    fireEvent.change(reasonField(dialog), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Продлить' }));
    expect(await screen.findByText(toast.platform.done)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(row(ALTA).querySelector('.ox-org-trial')?.textContent).toBe(
        'Осталось 26 дн. · до 27.10.2026',
      ),
    );
    await waitFor(() =>
      expect(journal(card(ALTA))[0]?.querySelector('.ox-audit-text')?.textContent).toBe(
        'Альта Групп: пробный период продлён на 14 дней',
      ),
    );
    expect(journal(card(ALTA))[0]?.querySelector('.ox-audit-reason')?.textContent).toBe(
      `Причина: ${REASON}`,
    );
    expect(
      a
        .responses()
        .some(
          (r) => r.method === 'POST' && r.path.endsWith('/trial-extensions') && r.status === 200,
        ),
    ).toBe(true);
  });

  it('«Ограничить…» → «Приостановлен»; «Снять ограничение» → «Пробный период» по подписке', async () => {
    await open();
    await ready();
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: RESTRICT }));
    let dialog = await screen.findByRole('dialog', { name: 'Ограничить «Альта Групп»?' });
    expect(dialog.textContent).toContain('Клиент перейдёт в режим ограниченных операций.');
    expect(
      Array.from(dialog.querySelectorAll('.ox-orgs-conseq')).map((x) => x.textContent),
    ).toEqual([
      'Новые брони, рейсы, приглашения и загрузки закрываются',
      'Начатую работу можно завершить',
      'Данные не удаляются',
    ]);
    fireEvent.change(reasonField(dialog), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ограничить' }));
    await waitFor(() =>
      expect(card(ALTA).querySelector('.ox-chip')?.textContent).toContain('Приостановлен'),
    );
    expect(row(ALTA).querySelector('.ox-chip')?.textContent).toContain('Приостановлен');
    fireEvent.click(await within(card(ALTA)).findByRole('button', { name: LIFT }));
    dialog = await screen.findByRole('dialog', { name: 'Снять ограничение «Альта Групп»?' });
    expect(dialog.textContent).toContain('Клиент вернётся к действующей подписке.');
    fireEvent.change(reasonField(dialog), { target: { value: 'Оплата поступила' } });
    fireEvent.click(within(dialog).getByRole('button', { name: LIFT }));
    await waitFor(() =>
      expect(card(ALTA).querySelector('.ox-chip')?.textContent).toContain('Пробный период'),
    );
    await waitFor(() =>
      expect(journal(card(ALTA))[0]?.querySelector('.ox-audit-text')?.textContent).toBe(
        'Альта Групп: статус «Пробный период»',
      ),
    );
  });

  it('409: тост ошибки по коду, диалог остаётся открытым', async () => {
    const a = await open();
    await ready();
    a.scenario.setScenario('suspendPlatformTenant=invalid_transition');
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: RESTRICT }));
    const dialog = await screen.findByRole('dialog', { name: 'Ограничить «Альта Групп»?' });
    fireEvent.change(reasonField(dialog), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ограничить' }));
    expect(await screen.findByText(errors.problem.invalid_transition)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Ограничить «Альта Групп»?' })).toBeTruthy();
    // Кнопка была недоступна во время запроса и потеряла фокус: он возвращается в диалог, на поле «Причина»
    // (иначе Escape и Tab уходят мимо диалога).
    await waitFor(() => expect(document.activeElement).toBe(reasonField(dialog)));
  });

  it('422: ошибка под полем «Причина», без тоста', async () => {
    const a = await open();
    await ready();
    a.scenario.setScenario('extendPlatformTrial=validation_failed');
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: EXTEND }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Продлить пробный период «Альта Групп»?',
    });
    fireEvent.change(reasonField(dialog), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Продлить' }));
    await waitFor(() => expect(reasonField(dialog).getAttribute('aria-invalid')).toBe('true'));
    expect(dialog.textContent).toContain(errors.problem.validation_failed);
    expect(document.querySelector('.ox-toast')).toBeNull();
  });

  it('нет связи: тост «Нет связи с сервером. Операция не выполнена.», причина сохранена', async () => {
    const a = await open();
    await ready();
    a.scenario.setScenario('extendPlatformTrial=offline');
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: EXTEND }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Продлить пробный период «Альта Групп»?',
    });
    fireEvent.change(reasonField(dialog), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Продлить' }));
    expect(await screen.findByText(errors.client.offline)).toBeTruthy();
    expect((reasonField(dialog) as HTMLTextAreaElement).value).toBe(REASON);
  });

  it('«Отмена» закрывает диалог без запроса', async () => {
    const a = await open();
    await ready();
    fireEvent.click(within(card(ALTA)).getByRole('button', { name: RESTRICT }));
    const dialog = await screen.findByRole('dialog', { name: 'Ограничить «Альта Групп»?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(a.responses().some((r) => r.path.endsWith('/suspend'))).toBe(false);
  });
});
