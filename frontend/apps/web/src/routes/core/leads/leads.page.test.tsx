// W4.13 · Экранные тесты старой доски «Заявки» (`tasks-leads`, `/t/:tenantId/leads`; эталон design-2026-10-19
// «Ортус CRM.dc.html» :1600–1705, tasksVM :4443–4504; Q-W4.00-tasks-15 — переносится как есть). Сеть — сценарный
// сервер W4.03 (listTaskProjects, getTaskWorkflow, listTasks, getTask, transitionTask, updateTaskChecklistItem,
// commentTask, listTaskHistory, createTask, listTaskProjectMembers) на сиде «Альты»: воронка ЗАЯ «Заявки · Ремонт».
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 8_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

const open = async (
  o: Parameters<typeof renderMockApp>[1] = {},
  heading = 'Заявки',
  search = '',
): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/leads${search}`, { persona: 'owner', ...o });
  await screen.findByRole('heading', { level: 1, name: heading }, SLOW);
  return app;
};

/**
 * Персонажа сида без «Менять статус» в воронке нет (возврат 1): ответ listTaskProjects без `tasks.transition` —
 * обёртка fetch со сквозным вызовом до создания клиента API (как W4.41).
 */
const withoutTransition = () => {
  const through = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    const res = await through(req);
    if (req.method !== 'GET' || !/\/projects$/.test(new URL(req.url).pathname)) return res;
    const body = (await res.json()) as {
      items?: { myAccess?: { actions?: string[] } }[];
    };
    for (const p of body.items ?? []) {
      if (p.myAccess?.actions) {
        p.myAccess.actions = p.myAccess.actions.filter((x) => x !== 'tasks.transition');
      }
    }
    return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
  });
};

const section = () =>
  document.querySelector<HTMLElement>('section[aria-labelledby="h-tasks"]') as HTMLElement;
const columns = () =>
  [...document.querySelectorAll<HTMLElement>('.ox-leads-col')].map(
    (c) =>
      `${c.querySelector('.ox-leads-colname')?.textContent ?? ''} ${c.querySelector('.ox-leads-count')?.textContent ?? ''}`,
  );
const cards = () => [...document.querySelectorAll<HTMLElement>('.ox-leads-card')];
const card = (key: string) =>
  cards().find((c) => c.querySelector('.ox-leads-id')?.textContent === key) as HTMLElement;
const aside = () => screen.queryByRole('complementary', { name: 'Карточка задачи' });
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const loaded = () => waitFor(() => expect(cards()).toHaveLength(5), SLOW);

describe('«Заявки»: доска и список', () => {
  it('шапка, проекты, вид, исполнитель, колонки этапов и карточки', async () => {
    await open();
    await loaded();
    const s = section();
    expect(within(s).getByRole('button', { name: 'Все проекты' })).toBeTruthy();
    expect(s.querySelector('.ox-leads-crumb')?.textContent).toBe('Проект ЗАЯ · Заявки · Ремонт');
    const projects = within(s).getByRole('group', { name: 'Проекты' });
    expect(
      within(projects)
        .getAllByRole('button')
        .map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
    ).toEqual([['filter_altЗаявки · Ремонт', 'true']]);
    expect(
      within(s).getByText(
        'Заявки — проект модуля «Задачи» со своими этапами: те же исполнители, сроки, чек-листы, комментарии и уведомления. Этап «Объект» создаёт объект в «Ремонт и стройка».',
      ),
    ).toBeTruthy();
    const views = within(s).getByRole('group', { name: 'Вид' });
    expect(
      within(views)
        .getAllByRole('button')
        .map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
    ).toEqual([
      ['view_kanbanКанбан', 'true'],
      ['listСписок', 'false'],
    ]);
    const who = within(s).getByRole<HTMLSelectElement>('combobox', { name: 'Исполнитель' });
    expect([...who.options].map((o) => o.textContent)).toEqual(['Все исполнители', 'Мои задачи']);
    expect(within(s).getByRole('button', { name: 'Задача' })).toBeTruthy();
    expect(columns()).toEqual(['Новая 1', 'Замер 1', 'Смета 1', 'Договор 1', 'Объект 1']);
    const l31 = card('L-31');
    expect(l31.textContent).toContain('Квартира 64 м², Химки');
    expect(l31.textContent).toContain('Высокий');
    expect(l31.textContent).toContain('Дарья Зимина');
    expect(l31.textContent).toContain('срок 03.10');
    expect(
      within(s).getByText(
        'Статус меняется только разрешёнными переходами процесса. «Готово» недоступно, пока в чек-листе есть невыполненные пункты. Перетаскивание в канбане появится позже как дополнение к кнопкам.',
      ),
    ).toBeTruthy();
  });

  it('«Список» — строки с этапом; «Мои задачи» — только свои', async () => {
    await open();
    await loaded();
    fireEvent.click(within(section()).getByRole('button', { name: 'Список' }));
    await waitFor(() => expect(document.querySelectorAll('.ox-leads-row')).toHaveLength(5), SLOW);
    const rows = [...document.querySelectorAll('.ox-leads-row')];
    expect(rows.map((r) => r.querySelector('.ox-leads-id')?.textContent)).toEqual([
      'L-31',
      'L-29',
      'L-27',
      'L-24',
      'L-18',
    ]);
    expect(rows[3]?.querySelector('.ox-leads-chip')?.textContent).toBe('contractДоговор');
    fireEvent.change(within(section()).getByRole('combobox', { name: 'Исполнитель' }), {
      target: { value: 'me' },
    });
    await waitFor(() => expect(document.querySelectorAll('.ox-leads-row')).toHaveLength(3), SLOW);
  });
});

describe('«Заявки»: карточка заявки', () => {
  it('поля, «Перевести» — тост «L-31: Замер», чек-лист, комментарий', async () => {
    await open();
    await loaded();
    fireEvent.click(card('L-31'));
    // Карточка показывается сразу (скелетон до ответа getTask) — ждём данные заявки.
    await waitFor(() => expect(aside()?.querySelector('.ox-leads-sid')).toBeTruthy(), SLOW);
    const a = aside() as HTMLElement;
    expect(a.querySelector('.ox-leads-sid')?.textContent).toBe('L-31 · ЗАЯ');
    expect(
      within(a).getByRole('heading', { level: 2, name: 'Квартира 64 м², Химки' }),
    ).toBeTruthy();
    await waitFor(
      () =>
        expect(
          within(aside() as HTMLElement)
            .getAllByRole('button')
            .map((b) => b.textContent)
            .filter((t) => t !== 'close' && t !== 'send'),
        ).toEqual(['straightenЗамер', 'block← Отказ']),
      SLOW,
    );
    expect(a.textContent).toContain('Чек-лист · 0 из 1');
    expect(within(a).getByRole('checkbox', { name: 'Перезвонить и назначить замер' })).toBeTruthy();
    expect(a.textContent).toContain('Пока пусто');
    fireEvent.click(within(a).getByRole('button', { name: 'Замер' }));
    await waitFor(() => expect(toast()).toBe('L-31: Замер'), SLOW);
    await waitFor(() => expect(columns()[1]).toBe('Замер 2'), SLOW);
    await waitFor(
      () =>
        expect((aside() as HTMLElement).querySelector('.ox-leads-chip')?.textContent).toBe(
          'straightenЗамер',
        ),
      SLOW,
    );
    fireEvent.click(
      within(aside() as HTMLElement).getByRole('checkbox', {
        name: 'Перезвонить и назначить замер',
      }),
    );
    await waitFor(
      () => expect((aside() as HTMLElement).textContent).toContain('Чек-лист · 1 из 1'),
      SLOW,
    );
    const input = within(aside() as HTMLElement).getByRole('textbox', { name: 'Комментарий' });
    const send = within(aside() as HTMLElement).getByRole<HTMLButtonElement>('button', {
      name: 'Отправить комментарий',
    });
    expect(send.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'Перезвонила, замер в пятницу' } });
    fireEvent.click(send);
    await waitFor(
      () => expect((aside() as HTMLElement).textContent).toContain('Перезвонила, замер в пятницу'),
      SLOW,
    );
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.click(
      within(aside() as HTMLElement).getByRole('button', { name: 'Закрыть карточку' }),
    );
    await waitFor(() => expect(aside()).toBeNull(), SLOW);
  });

  it('«Задача»: без названия — «Укажите название задачи»; создание — тост и карточка', async () => {
    await open();
    await loaded();
    fireEvent.click(within(section()).getByRole('button', { name: 'Задача' }));
    const form = document.querySelector<HTMLElement>('.ox-leads-form') as HTMLElement;
    expect(
      within(form).getByLabelText<HTMLSelectElement>('Исполнитель').selectedOptions[0]?.textContent,
    ).toBe('Дарья Зимина');
    fireEvent.click(within(form).getByRole('button', { name: 'Создать' }));
    expect(within(form).getByRole('alert').textContent).toBe('Укажите название задачи');
    fireEvent.change(within(form).getByLabelText('Название'), {
      target: { value: 'Квартира 70 м², Мытищи' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(toast()).toBe('Задача создана'), SLOW);
    await waitFor(
      () =>
        expect((aside() as HTMLElement).querySelector('.ox-leads-sid')?.textContent).toBe(
          'ЗАЯ-101 · ЗАЯ',
        ),
      SLOW,
    );
    await waitFor(() => expect(columns()[0]).toBe('Новая 2'), SLOW);
    expect(document.querySelector('.ox-leads-form')).toBeNull();
  });
});

describe('«Заявки»: состояния', () => {
  it('нет воронок в области — «Нет проектов в вашей области»', async () => {
    // Возврат 1: без проекта эталон — крошка «Мои задачи» при h1 WORKFLOWS.tasks.items «Задачи».
    await open({ persona: 'manager' }, 'Задачи');
    expect(section().querySelector('.ox-leads-crumb')?.textContent).toBe('Мои задачи');
    await waitFor(
      () => expect(within(section()).getByText('Нет проектов в вашей области')).toBeTruthy(),
      SLOW,
    );
    expect(
      within(section()).getByText(
        'Задачи других фирм и модулей не показываются. Здесь появятся проекты, в которых вы участвуете, и задачи, назначенные вам.',
      ),
    ).toBeTruthy();
    expect(within(section()).queryByRole('button', { name: 'Задача' })).toBeNull();
  });

  it('ошибка загрузки задач — «Повторить»', async () => {
    const a = await open({ scenario: 'listTasks=rate_limited' });
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(alert.textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await loaded();
  });

  // Возврат 1: устаревший `?task=` — карточка с ошибкой загрузки и «Повторить», а не пустое место.
  it('карточка по устаревшему ?task= — ошибка загрузки и «Повторить»', async () => {
    await open({}, 'Заявки', `?task=${seedUuid('t-alta', 'no-such-lead')}`);
    await loaded();
    await waitFor(() => expect(aside()).toBeTruthy(), SLOW);
    await waitFor(
      () =>
        expect(within(aside() as HTMLElement).getByRole('alert').textContent).toMatch(
          /^Не удалось загрузить данные: /,
        ),
      SLOW,
    );
    expect(within(aside() as HTMLElement).getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(
      within(aside() as HTMLElement).getByRole('button', { name: 'Закрыть карточку' }),
    ).toBeTruthy();
  });

  // Возврат 1: «только чтение» (эталон :1679) — без «Менять статус» в воронке.
  it('без права «Менять статус» — «Нет права «Изменять»…», «Перевести» и чек-лист недоступны', async () => {
    await open({ setup: withoutTransition });
    await loaded();
    fireEvent.click(card('L-31'));
    await waitFor(() => expect(aside()?.querySelector('.ox-leads-move')).toBeTruthy(), SLOW);
    const a = aside() as HTMLElement;
    expect(a.textContent).toContain('Нет права «Изменять» в модуле «Задачи»');
    for (const b of a.querySelectorAll<HTMLButtonElement>('.ox-leads-move')) {
      expect(b.disabled).toBe(true);
    }
    expect(
      within(a).getByRole<HTMLInputElement>('checkbox', { name: 'Перезвонить и назначить замер' })
        .disabled,
    ).toBe(true);
  });

  // Возврат 1: порядок «Перевести» — WORKFLOWS.leads.flow эталона (Договор: «Объект», «← Смета», «← Отказ»).
  it('«Перевести» у «Договора» — порядок воронки эталона', async () => {
    await open();
    await loaded();
    fireEvent.click(card('L-24'));
    await waitFor(
      () =>
        expect(
          [...(aside()?.querySelectorAll('.ox-leads-move') ?? [])].map((b) => b.textContent),
        ).toEqual(['apartmentОбъект', 'request_quote← Смета', 'block← Отказ']),
      SLOW,
    );
  });

  it('«Все проекты» — список проектов «Задач»', async () => {
    const a = await open();
    fireEvent.click(within(section()).getByRole('button', { name: 'Все проекты' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/tasks`), SLOW);
  });
});
