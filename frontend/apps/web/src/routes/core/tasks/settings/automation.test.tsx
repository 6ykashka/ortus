// W4.13 · Экранные тесты вкладки «Автоматизация» (`tasks-automation`; эталон design-2026-10-19 «Задачи и проекты.dc.html»
// :277–311, логика :478–489). Сеть — сценарный сервер W4.03 (listTaskAutomations, createTaskAutomation,
// updateTaskAutomation, deleteTaskAutomation, listTaskAutomationRuns) на сиде «Альты»: правила ar-1, ar-2 и журнал LOG.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const LOG = seedUuid('t-alta', 'fleet');
const SLOW = { timeout: 8_000 };
const AR1 = 'Срочная задача → назначить руководителю проекта';
const AR2 = 'Задача готова → напомнить про путевой лист';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
/** Имена строки правила (возврат 1): «Включено» и «Удалить правило» — с названием правила. */
const on = (rule: string) => `Включено ${rule}`;
const del = (rule: string) => `Удалить правило ${rule}`;

/** Наблюдатель запросов (как W4.41): обёртка fetch со сквозным вызовом до создания клиента API. */
const watchRequests = () => {
  const seen: { method: string; headers: Headers }[] = [];
  return {
    seen,
    setup: () => {
      const through = globalThis.fetch;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const req = new Request(input, init);
        seen.push({ method: req.method, headers: req.headers });
        return through(req);
      });
    },
  };
};

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

const open = async (
  persona = 'owner',
  o: Parameters<typeof renderMockApp>[1] = {},
): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/tasks?project=${LOG}&view=automation`, { persona, ...o });
  await screen.findByRole('tab', { name: 'Автоматизация', selected: true }, SLOW);
  await waitFor(() => expect(rules()).toHaveLength(2), SLOW);
  return app;
};

const pane = () => document.querySelector<HTMLElement>('.ox-tset') as HTMLElement;
const rules = () => [...document.querySelectorAll<HTMLElement>('.ox-tset-rule')];
const ruleOf = (name: string) =>
  rules().find((r) => r.querySelector('strong')?.textContent === name) as HTMLElement;
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const form = () => document.querySelector<HTMLElement>('.ox-tset-newrule') as HTMLElement;
const pick = (sel: HTMLSelectElement, label: string) =>
  fireEvent.change(sel, {
    target: { value: [...sel.options].find((o) => o.textContent === label)?.value },
  });

describe('«Автоматизация»: владелец', () => {
  it('правила эталона, «Включено», журнал запусков', async () => {
    await open();
    const r1 = ruleOf(AR1);
    expect(r1.textContent).toContain(
      'Когда задача создана, если приоритет «Срочно» → назначить на Марина Котова',
    );
    expect(r1.textContent).toContain('От имени Марина Котова · v1 · запусков: 2');
    expect(within(r1).getByRole<HTMLInputElement>('checkbox', { name: on(AR1) }).checked).toBe(
      true,
    );
    const r2 = ruleOf(AR2);
    expect(r2.textContent).toContain(
      'Когда задача перешла в «Готово» → комментарий «Проверьте, что путевой лист сдан в бухгалтерию»',
    );
    expect(r2.textContent).toContain('От имени Дарья Зимина · v1 · запусков: 0');
    expect(within(r2).getByRole<HTMLInputElement>('checkbox', { name: on(AR2) }).checked).toBe(
      false,
    );
    const runs = document.querySelector<HTMLElement>('.ox-tset-runs') as HTMLElement;
    expect(within(runs).getByRole('heading', { level: 3, name: 'Журнал запусков' })).toBeTruthy();
    const lines = [...runs.querySelectorAll('.ox-tset-run')].map((x) => x.textContent ?? '');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^check_circleT-64 назначена: Марина Котова.*09:12 · Срочная задача → назначить руководителю проекта v1$/,
    );
    expect(lines[1]).toMatch(
      /^do_not_disturb_onT-63: приоритет «Обычный» — условие не выполнено.*08:40 · /,
    );
  });

  it('«Включено» — «Правило включено / выключено»; удаление — «Правило удалено»', async () => {
    await open();
    fireEvent.click(within(ruleOf(AR2)).getByRole('checkbox', { name: on(AR2) }));
    await waitFor(() => expect(toast()).toBe('Правило включено'), SLOW);
    await waitFor(
      () =>
        expect(
          within(ruleOf(AR2)).getByRole<HTMLInputElement>('checkbox', { name: on(AR2) }).checked,
        ).toBe(true),
      SLOW,
    );
    fireEvent.click(within(ruleOf(AR2)).getByRole('checkbox', { name: on(AR2) }));
    await waitFor(() => expect(toast()).toBe('Правило выключено'), SLOW);
    fireEvent.click(within(ruleOf(AR2)).getByRole('button', { name: del(AR2) }));
    await waitFor(() => expect(toast()).toBe('Правило удалено'), SLOW);
    await waitFor(() => expect(rules()).toHaveLength(1), SLOW);
  });

  it('«Новое правило»: ошибка в форме, затем «Правило добавлено»', async () => {
    await open();
    const f = form();
    expect(within(f).getByRole('heading', { level: 3, name: 'Новое правило' })).toBeTruthy();
    expect(f.textContent).toContain(
      'Правило работает от вашего имени: при каждом запуске проверяется ваше право менять задачи в проекте. Изменения, сделанные правилом, другие правила не запускают.',
    );
    fireEvent.click(within(f).getByRole('button', { name: 'Добавить правило' }));
    await waitFor(
      () => expect(within(f).getByRole('alert').textContent).toBe('Назовите правило'),
      SLOW,
    );
    fireEvent.change(within(f).getByRole('textbox', { name: 'Название правила' }), {
      target: { value: 'На проверке — срочно' },
    });
    pick(within(f).getByRole('combobox', { name: 'Триггер' }), 'Задача перешла в статус');
    pick(within(f).getByRole('combobox', { name: 'Статус' }), 'На проверке');
    pick(within(f).getByRole('combobox', { name: 'Действие' }), 'Поставить приоритет');
    fireEvent.click(within(f).getByRole('button', { name: 'Добавить правило' }));
    await waitFor(
      () => expect(within(f).getByRole('alert').textContent).toBe('Заполните действие'),
      SLOW,
    );
    pick(within(f).getByRole('combobox', { name: 'Приоритет' }), 'Срочно');
    fireEvent.click(within(f).getByRole('button', { name: 'Добавить правило' }));
    await waitFor(() => expect(toast()).toBe('Правило добавлено'), SLOW);
    await waitFor(() => expect(rules()).toHaveLength(3), SLOW);
    expect(ruleOf('На проверке — срочно').textContent).toContain(
      'Когда задача перешла в «На проверке» → приоритет «Срочно»',
    );
    expect(within(f).queryByRole('alert')).toBeNull();
    expect(
      within(f).getByRole<HTMLInputElement>('textbox', { name: 'Название правила' }).value,
    ).toBe('');
  });
});

// Возврат 1 (W4.13): имена строк правила — с названием правила; сбой участников — ошибка вкладки, а не «назначить
// на —»; Idempotency-Key — тот же до определённого ответа сервера (W2.23): после «нет связи» повтор несёт тот же ключ.
describe('«Автоматизация»: возврат 1', () => {
  it('«Включено» и «Удалить правило» различимы: в имени — название правила', async () => {
    await open();
    expect(within(ruleOf(AR1)).getByRole('checkbox', { name: on(AR1) })).toBeTruthy();
    expect(within(ruleOf(AR1)).getByRole('button', { name: del(AR1) })).toBeTruthy();
    expect(within(ruleOf(AR2)).getByRole('checkbox', { name: on(AR2) })).toBeTruthy();
    expect(within(ruleOf(AR2)).getByRole('button', { name: del(AR2) })).toBeTruthy();
  });

  it('сбой списка участников — ошибка вкладки и «Повторить»', async () => {
    app = await renderMockApp(`/t/${ALTA}/tasks?project=${LOG}&view=automation`, {
      persona: 'owner',
      scenario: 'listTaskProjectMembers=rate_limited',
    });
    await screen.findByRole('tab', { name: 'Автоматизация', selected: true }, SLOW);
    await waitFor(
      () =>
        expect(within(pane()).getByRole('alert').textContent).toBe(
          'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
        ),
      SLOW,
    );
    expect(document.querySelector('.ox-tset-rule')).toBeNull();
    app.scenario.setScenario(null);
    fireEvent.click(within(pane()).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(rules()).toHaveLength(2), SLOW);
    expect(ruleOf(AR1).textContent).toContain('назначить на Марина Котова');
  });

  it('повтор после «нет связи» — тот же Idempotency-Key; после ответа сервера — новый', async () => {
    const w = watchRequests();
    const a = await open('owner', { setup: w.setup });
    const patches = () =>
      w.seen.filter((x) => x.method === 'PATCH').map((x) => x.headers.get('Idempotency-Key'));
    a.scenario.setScenario('updateTaskAutomation=offline', true);
    fireEvent.click(within(ruleOf(AR2)).getByRole('checkbox', { name: on(AR2) }));
    await waitFor(() => expect(toast()).toBe(OFFLINE), SLOW);
    fireEvent.click(within(ruleOf(AR2)).getByRole('checkbox', { name: on(AR2) }));
    await waitFor(() => expect(toast()).toBe('Правило включено'), SLOW);
    expect(patches()).toHaveLength(2);
    expect(patches()[1]).toBe(patches()[0]);
    a.scenario.setScenario('updateTaskAutomation=rate_limited', true);
    await waitFor(
      () =>
        expect(
          within(ruleOf(AR2)).getByRole<HTMLInputElement>('checkbox', { name: on(AR2) }).checked,
        ).toBe(true),
      SLOW,
    );
    fireEvent.click(within(ruleOf(AR2)).getByRole('checkbox', { name: on(AR2) }));
    await waitFor(
      () => expect(toast()).toBe('Слишком много запросов. Подождите и повторите.'),
      SLOW,
    );
    fireEvent.click(within(ruleOf(AR2)).getByRole('checkbox', { name: on(AR2) }));
    await waitFor(() => expect(toast()).toBe('Правило выключено'), SLOW);
    expect(patches()).toHaveLength(4);
    expect(patches()[3]).not.toBe(patches()[2]);
  });
});

// Возврат 2 (W4.13): ответ updateTaskAutomation — новая ревизия правила; «Удалить» сразу после тоста, пока список
// ещё перечитывается, идёт с If-Match этой ревизии, а не прежней (иначе 412 «Данные изменились»).
describe('«Автоматизация»: возврат 2', () => {
  it('«Включено», затем сразу «Удалить» — правило удалено, без 412', async () => {
    const a = await open();
    a.scenario.setScenario('listTaskAutomations=delay=1500');
    fireEvent.click(within(ruleOf(AR2)).getByRole('checkbox', { name: on(AR2) }));
    await waitFor(() => expect(toast()).toBe('Правило включено'), SLOW);
    expect(
      within(ruleOf(AR2)).getByRole<HTMLInputElement>('checkbox', { name: on(AR2) }).checked,
    ).toBe(true);
    fireEvent.click(within(ruleOf(AR2)).getByRole('button', { name: del(AR2) }));
    await waitFor(() => expect(toast()).toBe('Правило удалено'), SLOW);
    a.scenario.setScenario(null);
    await waitFor(() => expect(rules()).toHaveLength(1), SLOW);
  });
});

// Возврат 3 (W4.13): пустые состояния эталона (ЗП:287, :308).
describe('«Автоматизация»: возврат 3', () => {
  it('нет правил и запусков — «Правил пока нет.», «Запусков пока не было.»', async () => {
    app = await renderMockApp(`/t/${ALTA}/tasks?project=${LOG}&view=automation`, {
      persona: 'owner',
      scenario: 'listTaskAutomations=empty,listTaskAutomationRuns=empty',
    });
    await screen.findByRole('tab', { name: 'Автоматизация', selected: true }, SLOW);
    await waitFor(
      () => expect(document.querySelector('.ox-tset-empty')?.textContent).toBe('Правил пока нет.'),
      SLOW,
    );
    expect(rules()).toHaveLength(0);
    const runs = document.querySelector<HTMLElement>('.ox-tset-runs') as HTMLElement;
    expect(within(runs).getByText('Запусков пока не было.')).toBeTruthy();
    expect(runs.querySelectorAll('.ox-tset-run')).toHaveLength(0);
    expect(within(form()).getByRole('button', { name: 'Добавить правило' })).toBeTruthy();
  });
});

describe('«Автоматизация»: без «Настраивать»', () => {
  it('исполнитель (водитель) — только чтение', async () => {
    await open('driver');
    expect(document.querySelector('.ox-tset-newrule')).toBeNull();
    for (const c of within(pane()).getAllByRole('checkbox')) {
      expect((c as HTMLInputElement).disabled).toBe(true);
    }
    expect(within(pane()).queryByRole('button', { name: /^Удалить правило/ })).toBeNull();
  });
});
