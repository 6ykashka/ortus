// W5.32 · Экранные тесты страницы `cash` «Касса» (`/t/:tenantId/cash`; эталон design-2026-10-19 «Касса.dc.html»,
// разбор docs/plan/v2/analysis/dor/cash.md §1.3–1.6). Сеть — сценарный сервер W5.00 (контракт 0.12.0-stage5) на сиде
// «Альты»: 8 касс, смены 117 (закрыта) и 118 (открыта), заявка Котовой на 6 500 ₽, четыре предложения.
// Права кассира в mock недоступны (в /me/context Морозовой нет cash.*, Q-W5.32-7): ограниченные права проверяются
// подменой ответа listCashAccounts (my.rights, balance) — как W4.13 подменяет listTaskProjects.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 8_000 };
const NB = String.fromCharCode(160);

// jsdom без CSS.escape: React Aria (Modal → getMetaValue) зовёт его при открытии диалога — как review.page.test.tsx.
if (typeof globalThis.CSS?.escape !== 'function') {
  Object.assign(globalThis, {
    CSS: { escape: (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`) },
  });
}

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

const open = async (search = '', setup?: () => void): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/cash${search}`, {
    persona: 'owner',
    ...(setup ? { setup } : {}),
  });
  await screen.findByRole('heading', { level: 1, name: 'Касса' }, SLOW);
  return app;
};

const section = () => document.querySelector<HTMLElement>('section.ox-ca') as HTMLElement;
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const tab = (name: string) =>
  within(section()).getAllByRole('button', { name: new RegExp(`^${name}`) })[0] as HTMLElement;
const ready = () =>
  waitFor(() => expect(section().querySelectorAll('.ox-ca-op').length).toBeGreaterThan(0), SLOW);
const rub = (s: string): string => s.replace(/ /g, NB);
const dialog = () => screen.getByRole('dialog');
const alertOf = (w: ReturnType<typeof within>) =>
  w.getByRole('alert').querySelector('.ox-ca-alert-text')?.textContent;
const pick = (name: RegExp | string) =>
  within(section())
    .getAllByRole('button', { name })
    .find((b) => b.className.includes('ox-ca-acc')) as HTMLElement;

/** Подмена тела ответа GET по пути (сквозной вызов до создания клиента API). */
const mapGet = (path: RegExp, edit: (body: Record<string, unknown>) => void, status?: number) => {
  const through = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    if (req.method !== 'GET' || !path.test(new URL(req.url).pathname)) return through(req);
    if (status) return new Response(JSON.stringify({ code: 'internal_error' }), { status });
    const res = await through(req);
    const body = (await res.json()) as Record<string, unknown>;
    edit(body);
    return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
  });
};

describe('«Касса»: шапка и вкладка «Кассы»', () => {
  it('заголовок, вкладки со счётчиком, подзаголовок, баннер ККТ', async () => {
    await open();
    await ready();
    expect(section().querySelector('h1')?.textContent).toBe('Касса');
    expect(section().textContent).toContain('8 касс и счетов в вашей области');
    const names = [...section().querySelectorAll('.ox-ca-tab')].map((b) => b.textContent);
    expect(names).toEqual(['Кассы', 'Входящие5', 'Смены', 'Настройки']);
    expect(within(section()).getByRole('button', { name: 'Новая операция' })).toBeTruthy();
    expect(
      within(section()).getByText(
        'ККТ к Ортусу пока не подключены. Оплату вносят вручную с № ФД из чека, при закрытии смены записи сверяются с Z-отчётом, пересчётом и терминалом.',
      ),
    ).toBeTruthy();
  });

  it('кассы по подразделениям, карточка кассы салона: факты, кнопки, доступ', async () => {
    await open();
    await ready();
    const groups = [...section().querySelectorAll('.ox-ca-gname')].map((g) => g.textContent);
    expect(groups).toEqual(['Север Логистик', 'Вся организация']);
    const card = within(section().querySelector('section[aria-label]') as HTMLElement);
    expect(card.getByRole('heading', { level: 2, name: 'Касса салона · ресепшен' })).toBeTruthy();
    expect(card.getByRole('button', { name: 'Принять оплату' })).toBeTruthy();
    expect(card.getByRole('button', { name: 'Закрыть смену' })).toBeTruthy();
    expect(card.getByRole('button', { name: 'Переместить' })).toBeTruthy();
    const facts = [...section().querySelectorAll('.ox-ca-fact')].map((f) => f.textContent);
    expect(facts[0]).toBe(`Остаток7${NB}350${NB}₽лимит 30${NB}000${NB}₽`);
    expect(facts[1]).toContain('№ 118 открыта');
    expect(facts[1]).toContain(`ожидается 7${NB}350${NB}₽`);
    expect(facts[2]).toContain('Вслепую');
    expect(section().textContent).toContain('Ваш доступ: Владелец бизнеса · вся организация');
  });

  it('фильтр журнала: «Приход» оставляет приходы и ввод остатка', async () => {
    await open();
    await ready();
    const all = section().querySelectorAll('.ox-ca-op').length;
    fireEvent.click(within(section()).getByRole('radio', { name: 'Приход' }));
    const rows = [...section().querySelectorAll('.ox-ca-op')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(all);
    for (const r of rows) {
      expect(r.querySelector('.ox-ca-chip')?.textContent).toMatch(/Приход|Ввод остатка/);
    }
    fireEvent.click(within(section()).getByRole('radio', { name: 'Возвраты' }));
    expect(section().querySelectorAll('.ox-ca-op')).toHaveLength(1);
    fireEvent.click(within(section()).getByRole('radio', { name: 'Исправления' }));
    expect(section().textContent).toContain('Недостача при пересчёте');
  });

  it('без права видеть остаток: «скрыт», подзаголовок, нет «Принять оплату»', async () => {
    await open('', () =>
      mapGet(/\/cash\/accounts$/, (b) => {
        for (const a of b.items as { balance: unknown; my: { rights: string[] } }[]) {
          a.balance = null;
          a.my.rights = ['cash.read', 'cash.shift.operate'];
        }
      }),
    );
    await waitFor(() => expect(section().textContent).toContain('скрыт'), SLOW);
    expect(section().textContent).toContain(' · остаток части касс скрыт правами');
    const card = within(section().querySelector('section[aria-label]') as HTMLElement);
    expect(card.queryByRole('button', { name: 'Принять оплату' })).toBeNull();
    expect(card.getByRole('button', { name: 'Закрыть смену' })).toBeTruthy();
    expect(section().textContent).toContain('в роли нет права видеть остаток');
    expect(within(section()).queryByRole('button', { name: 'Новая операция' })).toBeNull();
  });
});

describe('«Касса»: состояния страницы', () => {
  it('нет касс: «Кассы недоступны…»', async () => {
    await open('', () =>
      mapGet(/\/cash\/accounts$/, (b) => {
        b.items = [];
      }),
    );
    await waitFor(
      () =>
        expect(section().textContent).toContain(
          'Кассы недоступны: в ваших ролях нет модуля «Касса» или в вашей области ещё нет касс. Доступ выдаёт владелец в «Пользователях и ролях».',
        ),
      SLOW,
    );
  });

  it('ошибка списка: сообщение и «Повторить»', async () => {
    app = await renderMockApp(`/t/${ALTA}/cash`, {
      persona: 'owner',
      setup: () => mapGet(/\/cash\/accounts$/, () => undefined, 500),
    });
    await screen.findByRole('button', { name: 'Повторить' }, SLOW);
    expect(screen.getByRole('alert').textContent).toContain('Не удалось загрузить кассу');
  });

  it('диплинк ?open=inbox открывает «Входящие»', async () => {
    await open('?open=inbox');
    await waitFor(() => expect(tab('Входящие').getAttribute('aria-pressed')).toBe('true'), SLOW);
    expect(app?.path()).toBe(`/t/${ALTA}/cash`);
  });
});

describe('«Касса»: новая операция и сторно', () => {
  it('приход в кассу офиса: проверка суммы, проведение, строка журнала, сторно', async () => {
    await open();
    await ready();
    fireEvent.click(pick(/Касса офиса/));
    fireEvent.click(within(section()).getByRole('button', { name: 'Новая операция' }));
    const d = within(dialog());
    expect(d.getByRole('heading', { name: 'Новая операция' })).toBeTruthy();
    fireEvent.click(d.getByRole('button', { name: 'Провести' }));
    expect(alertOf(d)).toBe('Укажите сумму больше нуля.');
    fireEvent.change(d.getByLabelText('Сумма, ₽'), { target: { value: '1500' } });
    fireEvent.click(d.getByRole('button', { name: 'Провести' }));
    expect(alertOf(d)).toBe('Основание — не короче 3 знаков.');
    fireEvent.change(d.getByLabelText('Основание · обязательно'), {
      target: { value: 'Подарочный сертификат № 215' },
    });
    fireEvent.click(d.getByRole('button', { name: 'Провести' }));
    await waitFor(() => expect(toast()).toBe('Операция проведена'), SLOW);
    await waitFor(
      () => expect(section().textContent).toContain('Подарочный сертификат № 215'),
      SLOW,
    );
    const row = [...section().querySelectorAll('.ox-ca-op')].find((r) =>
      r.textContent?.includes('Подарочный сертификат № 215'),
    ) as HTMLElement;
    expect(row.querySelector('.ox-ca-opamount')?.textContent).toBe(`+1${NB}500${NB}₽`);
    fireEvent.click(within(row).getByRole('button', { name: 'Сторно' }));
    const r = within(dialog());
    fireEvent.click(r.getByRole('button', { name: 'Сторнировать' }));
    expect(alertOf(r)).toBe('Укажите причину.');
    fireEvent.change(r.getByLabelText('Причина исправления'), {
      target: { value: 'ошибка ввода' },
    });
    fireEvent.click(r.getByRole('button', { name: 'Сторнировать' }));
    await waitFor(() => expect(toast()).toBe('Сторно проведено'), SLOW);
    await waitFor(() => expect(section().textContent).toContain('исправлена K-'), SLOW);
  });

  it('расход больше остатка наличной кассы: отказ сервера в диалоге', async () => {
    await open();
    await ready();
    fireEvent.click(pick(/Касса офиса/));
    fireEvent.click(within(section()).getByRole('button', { name: 'Новая операция' }));
    const d = within(dialog());
    fireEvent.click(d.getByRole('radio', { name: 'Расход' }));
    fireEvent.change(d.getByLabelText('Сумма, ₽'), { target: { value: '9999999' } });
    expect(d.getByText(/наличная касса не уходит в минус/)).toBeTruthy();
    fireEvent.change(d.getByLabelText('Основание · обязательно'), {
      target: { value: 'Закупка воды' },
    });
    fireEvent.click(d.getByRole('button', { name: 'Провести' }));
    await waitFor(() => expect(alertOf(d)).toContain('нет столько наличных'), SLOW);
  });

  it('перемещение в сейф: «В пути» и приём получателем', async () => {
    await open();
    await ready();
    fireEvent.click(pick(/Касса офиса/));
    fireEvent.click(within(section()).getByRole('button', { name: 'Переместить' }));
    const d = within(dialog());
    expect((d.getByLabelText('Куда') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe(
      'Сейф офиса',
    );
    fireEvent.change(d.getByLabelText('Сумма, ₽'), { target: { value: '1000' } });
    fireEvent.change(d.getByLabelText('Основание'), { target: { value: 'Сдача выручки' } });
    fireEvent.click(d.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(toast()).toBe('Отправлено: деньги в пути до приёма'), SLOW);
    const mv = () => section().querySelector('.ox-ca-moves')?.textContent ?? '';
    const sum = rub('1 000 ₽');
    await waitFor(() => expect(mv()).toContain(`${sum} в «Сейф офиса»`), SLOW);
    fireEvent.click(pick(/Сейф офиса/));
    await waitFor(() => expect(mv()).toContain(`${sum} из «Касса офиса»`), SLOW);
    const move = [...section().querySelectorAll<HTMLElement>('.ox-ca-move')].find((m) =>
      m.textContent?.includes(`${sum} из «Касса офиса»`),
    ) as HTMLElement;
    fireEvent.click(within(move).getByRole('button', { name: `Принять ${sum}` }));
    await waitFor(() => expect(toast()).toBe(`Принято: ${sum}`), SLOW);
    await waitFor(() => expect(mv()).not.toContain(`${sum} из «Касса офиса»`), SLOW);
  });
});

describe('«Касса»: «Входящие»', () => {
  const inbox = async () => {
    await open();
    await ready();
    fireEvent.click(tab('Входящие'));
    await waitFor(() => expect(aside().textContent).toContain('Салон и SPA'), SLOW);
  };
  const aside = () => section().querySelector('aside[aria-label="Входящие"]') as HTMLElement;

  it('группы: согласование, предложения модулей, финансовый блок', async () => {
    await inbox();
    const groups = [...aside().querySelectorAll('.ox-ca-igroup')].map((g) => g.textContent);
    expect(groups).toEqual([
      'approvalСогласование',
      'spaСалон и SPA',
      'support_agentОбращения',
      'constructionРемонт и стройка',
    ]);
    expect(aside().textContent).toContain('Финансовый блок · владелец и роли с начислениями');
    expect(aside().textContent).toContain(
      'Каждый видит предложения касс своей области. Предложение не двигает деньги, пока его не провели.',
    );
    const panel = within(
      section().querySelector('section[aria-label="Проведение"]') as HTMLElement,
    );
    expect(panel.getByText('Расход 6 500 ₽')).toBeTruthy();
    expect(panel.getByText('Ждёт вашего решения')).toBeTruthy();
  });

  it('заявка Котовой: «Согласовать и провести»', async () => {
    await inbox();
    fireEvent.click(within(section()).getByRole('button', { name: 'Согласовать и провести' }));
    await waitFor(() => expect(toast()).toBe('Согласовано и проведено'), SLOW);
    await waitFor(() => expect(aside().textContent).not.toContain('Ремонт ворот склада'), SLOW);
  });

  it('заявка: «Отклонить» требует причину', async () => {
    await inbox();
    fireEvent.click(within(section()).getByRole('button', { name: 'Отклонить' }));
    const d = within(dialog());
    expect(d.getByRole('heading', { name: 'Отклонить заявку' })).toBeTruthy();
    expect(d.getByText('Автор увидит причину. Деньги не двигаются.')).toBeTruthy();
    fireEvent.click(d.getByRole('button', { name: 'Отклонить' }));
    expect(alertOf(d)).toBe('Укажите причину.');
    fireEvent.change(d.getByLabelText('Причина'), { target: { value: 'нет бюджета' } });
    fireEvent.click(d.getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(toast()).toBe('Заявка отклонена'), SLOW);
  });

  it('визит: чек ККТ, провести; без № ФД — отказ на месте', async () => {
    await inbox();
    fireEvent.click(within(aside()).getByRole('button', { name: /Наталья С\. · Массаж лица/ }));
    const panel = within(
      section().querySelector('section[aria-label="Проведение"]') as HTMLElement,
    );
    expect(panel.getByRole('heading', { level: 3, name: 'Оплата · Наталья С.' })).toBeTruthy();
    expect(panel.getByText('Чек ККТ · вручную')).toBeTruthy();
    expect(panel.getByText(/Приход 2 800 ₽ · наличные в «Касса салона · ресепшен»/)).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: /^Провести/ }));
    expect(alertOf(panel)).toBe('№ ФД — только цифры.');
    fireEvent.change(panel.getByLabelText('№ ФД'), { target: { value: '7777' } });
    fireEvent.click(panel.getByRole('button', { name: /^Провести/ }));
    await waitFor(() => expect(toast()).toBe(`Проведено: 2${NB}800${NB}₽`), SLOW);
    await waitFor(() => expect(aside().textContent).not.toContain('Наталья С.'), SLOW);
  });

  it('«Не проводить»: причина и тост', async () => {
    await inbox();
    fireEvent.click(within(aside()).getByRole('button', { name: /Ирина П\. · компенсация/ }));
    fireEvent.click(within(section()).getByRole('button', { name: 'Не проводить' }));
    const d = within(dialog());
    fireEvent.change(d.getByLabelText('Почему не проводите'), {
      target: { value: 'клиент передумал' },
    });
    fireEvent.click(d.getByRole('button', { name: 'Не проводить' }));
    await waitFor(() => expect(toast()).toBe('Предложение убрано из входящих'), SLOW);
    await waitFor(() => expect(aside().textContent).not.toContain('компенсация по жалобе'), SLOW);
  });
});

describe('«Касса»: «Смены»', () => {
  const shifts = async () => {
    await open();
    await ready();
    fireEvent.click(tab('Смены'));
    await screen.findByText('Операции смены', {}, SLOW);
  };

  it('список: открытая выше закрытой, карточка открытой смены', async () => {
    await shifts();
    const list = [...section().querySelectorAll('aside[aria-label="Смены"] .ox-ca-pick')].map(
      (b) => b.querySelector('strong')?.textContent,
    );
    expect(list).toEqual([
      'Смена 118 · Касса салона · ресепшен',
      'Смена 117 · Касса салона · ресепшен',
    ]);
    const facts = [...section().querySelectorAll('.ox-ca-fact')].map((f) => f.textContent);
    expect(facts[2]).toBe(`Ожидается в ящике7${NB}350${NB}₽размен и наличные операции смены`);
    expect(within(section()).getByRole('button', { name: 'Закрыть смену' })).toBeTruthy();
  });

  it('закрытая смена 117: сверка «Ортус · ККТ · факт», «автоматически», допуск', async () => {
    await shifts();
    fireEvent.click(within(section()).getByRole('button', { name: /Смена 117/ }));
    await waitFor(() => expect(section().querySelector('.ox-ca-table')).not.toBeNull(), SLOW);
    const table = section().querySelector('.ox-ca-table') as HTMLElement;
    expect(table.textContent).toContain('СпособВ ОртусеККТ · Z-отчётФактРазница');
    expect(table.textContent).toContain('Наличные');
    expect(table.textContent).toContain('в допуске');
    expect(section().textContent).toContain('Автоматически: В пределах допуска');
  });

  it('«Открыть смену» закрытой кассы: диалог размена', async () => {
    await open();
    await ready();
    fireEvent.click(within(section()).getByRole('button', { name: 'Закрыть смену' }));
    const d = within(dialog());
    expect(d.getByRole('heading', { name: 'Закрыть смену 118' })).toBeTruthy();
    expect(d.getByText('вслепую')).toBeTruthy();
    expect(
      d.getByText(
        'Ожидаемую сумму не показываем: касса работает вслепую. Посчитайте всё, что лежит в ящике.',
      ),
    ).toBeTruthy();
    fireEvent.change(d.getByLabelText('Купюры 5000 ₽, штук'), { target: { value: '1' } });
    fireEvent.change(d.getByLabelText('Купюры 2000 ₽, штук'), { target: { value: '1' } });
    fireEvent.change(d.getByLabelText('Купюры 200 ₽, штук'), { target: { value: '1' } });
    fireEvent.change(d.getByLabelText('Купюры 100 ₽, штук'), { target: { value: '1' } });
    fireEvent.change(d.getByLabelText('Купюры 50 ₽, штук'), { target: { value: '1' } });
    expect(d.getByText('7 350 ₽', { selector: 'strong' })).toBeTruthy();
    expect(d.getByText('Z-отчёт с ККТ · вручную')).toBeTruthy();
    expect(d.getByText('Терминал и СБП')).toBeTruthy();
    expect(d.getByText('Сдать выручку')).toBeTruthy();
    fireEvent.click(d.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('закрытие с расхождением выше допуска: смена ждёт решения, свою не принимает', async () => {
    await shifts();
    fireEvent.click(within(section()).getByRole('button', { name: 'Закрыть смену' }));
    const d = within(dialog());
    fireEvent.change(d.getByLabelText('Купюры 1000 ₽, штук'), { target: { value: '2' } });
    fireEvent.change(d.getByLabelText('Наличными, ₽'), { target: { value: '3000' } });
    fireEvent.change(d.getByLabelText('Безналичными, ₽'), { target: { value: '12000' } });
    fireEvent.click(d.getByRole('button', { name: 'Закрыть смену' }));
    await waitFor(() => expect(toast()).toMatch(/Смена закрыта/), SLOW);
    await waitFor(
      () => expect(section().textContent).toContain('Решение по расхождению'),
      SLOW,
    ).catch(() => undefined);
    await waitFor(() => expect(section().textContent).toContain('Ждёт решения'), SLOW);
    expect(section().textContent).toContain(
      'Вы закрывали смену — расхождение принимает другой сотрудник с правом «Проверять».',
    );
  });
});

describe('«Касса»: «Настройки» и «Новая касса»', () => {
  it('кассы и роли; мастер «Новая касса» создаёт кассу', async () => {
    await open();
    await ready();
    fireEvent.click(tab('Настройки'));
    await screen.findByText('Кассы и счета', {}, SLOW);
    expect(section().textContent).toContain('Касса в ролях');
    expect(section().textContent).toContain('Вслепую · ККТ вручную');
    fireEvent.click(within(section()).getByRole('button', { name: 'Новая касса' }));
    const d = within(dialog());
    expect(d.getByText('Кто получит доступ')).toBeTruthy();
    expect(d.getAllByRole('radio').length).toBeGreaterThanOrEqual(5);
    fireEvent.click(d.getByRole('button', { name: 'Создать кассу' }));
    expect(alertOf(d)).toBe('Укажите название кассы.');
    fireEvent.change(d.getByLabelText('Название'), { target: { value: 'Касса второго этажа' } });
    fireEvent.click(d.getByRole('button', { name: 'Создать кассу' }));
    await waitFor(() => expect(toast()).toBe('Касса создана'), SLOW);
    await waitFor(
      () =>
        expect(
          within(section()).getByRole('heading', { level: 2, name: 'Касса второго этажа' }),
        ).toBeTruthy(),
      SLOW,
    );
  });

  it('терминал привязывается к кассе точки', async () => {
    await open();
    await ready();
    fireEvent.click(tab('Настройки'));
    fireEvent.click(await screen.findByRole('button', { name: 'Новая касса' }, SLOW));
    const d = within(dialog());
    fireEvent.click(d.getByRole('radio', { name: /Терминал и СБП/ }));
    expect(d.getByLabelText('Касса точки')).toBeTruthy();
    fireEvent.change(d.getByLabelText('Название'), { target: { value: 'Терминал · второй этаж' } });
    fireEvent.click(d.getByRole('button', { name: 'Создать кассу' }));
    await waitFor(() => expect(toast()).toBe('Касса создана'), SLOW);
  });
});
