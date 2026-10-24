// W4.13 · Экранные тесты вкладки «Процесс» (`tasks-workflow`; эталон design-2026-10-19 «Задачи и проекты.dc.html»
// :233–275, логика :456–477). Сеть — сценарный сервер W4.03 (getTaskWorkflow, saveTaskWorkflowDraft,
// discardTaskWorkflowDraft, publishTaskWorkflow) на сиде «Альты»: проект LOG, процесс v1 «С согласованием».
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const LOG = seedUuid('t-alta', 'fleet');
const SLOW = { timeout: 8_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (persona = 'owner'): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/tasks?project=${LOG}&view=workflow`, { persona });
  await screen.findByRole('tab', { name: 'Процесс', selected: true }, SLOW);
  await waitFor(() => expect(chip()).toMatch(/v1$/), SLOW);
  return app;
};

const pane = () => document.querySelector<HTMLElement>('.ox-tset') as HTMLElement;
const chip = () => document.querySelector('.ox-tset-ver')?.textContent;
/** Чип статуса: имя и категория (без лигатуры значка «Удалить статус …»). */
const statuses = () =>
  [...document.querySelectorAll('.ox-tset-status')].map(
    (s) =>
      `${s.firstChild?.textContent ?? ''}${s.querySelector('.ox-tset-scat')?.textContent ?? ''}`,
  );
const trRows = () => [...document.querySelectorAll<HTMLElement>('.ox-tset-tr')];
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const panel = () => document.querySelector<HTMLElement>('.ox-tset-trpanel');
const button = (name: string) => within(pane()).getByRole('button', { name });
const pick = (sel: HTMLSelectElement, label: string) =>
  fireEvent.change(sel, {
    target: { value: [...sel.options].find((o) => o.textContent === label)?.value },
  });

describe('«Процесс»: владелец', () => {
  it('версия, статусы с категориями, переходы с путём, «кто» и правилами', async () => {
    await open();
    expect(chip()).toBe('Действует v1');
    expect(within(pane()).queryByRole('button', { name: 'Сбросить черновик' })).toBeNull();
    expect(statuses()).toEqual([
      'НоваяК выполнению',
      'В работеВ работе',
      'На проверкеВ работе',
      'ГотовоГотово',
      'ОтмененаГотово',
    ]);
    expect(within(pane()).getByRole('heading', { level: 3, name: 'Переходы · 4' })).toBeTruthy();
    expect(trRows().map((r) => r.textContent)).toEqual([
      'Взять в работуНовая → В работеВсе с «Менять статус»Без правил',
      'На проверкуВ работе → На проверкеВсе с «Менять статус»Без правил',
      'СогласоватьНа проверке → ГотовоСогласующиеСогласование: одинНе авторЧек-листПодзадачиНа автора',
      'ОтменитьЛюбой → Отмененаруководитель проектаКомментарий',
    ]);
  });

  it('новый статус — в черновик перед «Готово»; «Сбросить черновик»', async () => {
    await open();
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Название статуса' }), {
      target: { value: 'Ждёт запчасть' },
    });
    fireEvent.click(button('Добавить статус'));
    await waitFor(() => expect(chip()).toBe('Черновик · действует v1'), SLOW);
    expect(statuses()[3]).toBe('Ждёт запчастьВ работе');
    expect(button('Опубликовать v2')).toBeTruthy();
    fireEvent.click(button('Сбросить черновик'));
    await waitFor(() => expect(toast()).toBe('Черновик сброшен'), SLOW);
    await waitFor(() => expect(chip()).toBe('Действует v1'), SLOW);
    expect(statuses()).toHaveLength(5);
  });

  it('дубль статуса и ошибки нового перехода — тосты эталона без запроса', async () => {
    const a = await open();
    const before = a.responses().length;
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Название статуса' }), {
      target: { value: 'в работе' },
    });
    fireEvent.click(button('Добавить статус'));
    await waitFor(() => expect(toast()).toBe('Статус «в работе» уже есть'), SLOW);
    fireEvent.click(button('Добавить переход'));
    await waitFor(() => expect(toast()).toBe('Назовите переход'), SLOW);
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Название перехода' }), {
      target: { value: 'Пауза' },
    });
    pick(within(pane()).getByRole('combobox', { name: 'Из статуса' }), 'Новая');
    pick(within(pane()).getByRole('combobox', { name: 'В статус' }), 'Новая');
    fireEvent.click(button('Добавить переход'));
    await waitFor(() => expect(toast()).toBe('Переход должен вести в другой статус'), SLOW);
    expect(
      a
        .responses()
        .slice(before)
        .filter((r) => r.method !== 'GET'),
    ).toEqual([]);
  });

  it('новый переход открывает панель; «Кто может», согласование, проверки — в черновик', async () => {
    await open();
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Название перехода' }), {
      target: { value: 'Пауза' },
    });
    pick(within(pane()).getByRole('combobox', { name: 'В статус' }), 'В работе');
    fireEvent.click(button('Добавить переход'));
    await waitFor(() => expect(panel()).toBeTruthy(), SLOW);
    const p = panel() as HTMLElement;
    expect(within(p).getByRole('heading', { level: 3, name: 'Переход «Пауза»' })).toBeTruthy();
    expect(p.textContent).toContain('Любой → В работе');
    await waitFor(() => expect(chip()).toBe('Черновик · действует v1'), SLOW);
    expect(trRows()).toHaveLength(5);
    fireEvent.click(within(p).getByRole('button', { name: 'автор задачи' }));
    await waitFor(
      () =>
        expect(
          within(panel() as HTMLElement)
            .getByRole('button', { name: 'автор задачи' })
            .getAttribute('aria-pressed'),
        ).toBe('true'),
      SLOW,
    );
    fireEvent.click(
      within(panel() as HTMLElement).getByRole('checkbox', {
        name: 'Переход выполняется согласованием',
      }),
    );
    await waitFor(
      () =>
        expect(
          within(panel() as HTMLElement).getByRole('group', { name: 'Режим согласования' }),
        ).toBeTruthy(),
      SLOW,
    );
    expect((panel() as HTMLElement).textContent).toContain(
      'Согласуют все с правом «Согласовывать» в проекте: Дарья Зимина, Марина Котова, Вера Котельникова.',
    );
    fireEvent.click(
      within(panel() as HTMLElement).getByRole('checkbox', { name: 'Комментарий обязателен' }),
    );
    await waitFor(() => expect(trRows().at(-1)?.textContent).toContain('Комментарий'), SLOW);
    fireEvent.click(
      within(panel() as HTMLElement).getByRole('button', { name: 'Удалить переход' }),
    );
    await waitFor(() => expect(trRows()).toHaveLength(4), SLOW);
    expect(panel()).toBeNull();
  });

  it('«Опубликовать v2» — тост эталона, «Действует v2»; без «Готово» — ошибка публикации', async () => {
    await open();
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Название статуса' }), {
      target: { value: 'Ждёт запчасть' },
    });
    fireEvent.click(button('Добавить статус'));
    await waitFor(() => expect(chip()).toBe('Черновик · действует v1'), SLOW);
    fireEvent.click(button('Опубликовать v2'));
    await waitFor(
      () => expect(toast()).toBe('Процесс опубликован. Задачи остались в своих статусах'),
      SLOW,
    );
    await waitFor(() => expect(chip()).toBe('Действует v2'), SLOW);
    fireEvent.click(button('Удалить статус Отменена'));
    await waitFor(() => expect(chip()).toBe('Черновик · действует v2'), SLOW);
    fireEvent.click(button('Удалить статус Готово'));
    await waitFor(() => expect(statuses()).toHaveLength(4), SLOW);
    fireEvent.click(button('Опубликовать v3'));
    await waitFor(() => expect(toast()).toBe('Нужен хотя бы один статус категории «Готово»'), SLOW);
    expect(chip()).toBe('Черновик · действует v2');
  });
});

// Возврат 3 (W4.13): список проектов хоста W4.12 смонтирован всё время — после публикации строка LOG в нём
// показывает новую версию процесса (подпись «… · процесс v2», ЗП:361), как в эталоне.
describe('«Процесс»: возврат 3', () => {
  it('«Опубликовать v2» → «← Проекты» — у LOG «процесс v2»', async () => {
    await open();
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Название статуса' }), {
      target: { value: 'Ждёт запчасть' },
    });
    fireEvent.click(button('Добавить статус'));
    await waitFor(() => expect(chip()).toBe('Черновик · действует v1'), SLOW);
    fireEvent.click(button('Опубликовать v2'));
    await waitFor(() => expect(chip()).toBe('Действует v2'), SLOW);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.ox-tk-back') as HTMLButtonElement);
    await screen.findByRole('heading', { level: 2, name: 'Проекты' }, SLOW);
    const log = () =>
      [...document.querySelectorAll<HTMLElement>('.ox-tk-prow')].find(
        (r) => r.querySelector('.ox-tk-key')?.textContent === 'LOG',
      );
    await waitFor(() => expect(log()?.textContent).toContain('процесс v2'), SLOW);
  });
});

// Возврат 4 (W4.13): процесс доски хоста W4.12 (useWorkflow наверху tasks.page, свой ключ) смонтирован всё время —
// после публикации вкладка «Доска» того же проекта сразу показывает колонку нового статуса, как в эталоне.
describe('«Процесс»: возврат 4', () => {
  it('«Опубликовать v2» → «Доска» — колонка «Ждёт запчасть» перед «Готово»', async () => {
    await open();
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Название статуса' }), {
      target: { value: 'Ждёт запчасть' },
    });
    fireEvent.click(button('Добавить статус'));
    await waitFor(() => expect(chip()).toBe('Черновик · действует v1'), SLOW);
    fireEvent.click(button('Опубликовать v2'));
    await waitFor(() => expect(chip()).toBe('Действует v2'), SLOW);
    fireEvent.click(screen.getByRole('tab', { name: 'Доска' }));
    const cols = () =>
      [...document.querySelectorAll('.ox-tk-col-name')].map((x) => x.textContent ?? '');
    await waitFor(
      () =>
        expect(cols()).toEqual([
          'Новая',
          'В работе',
          'На проверке',
          'Ждёт запчасть',
          'Готово',
          'Отменена',
        ]),
      SLOW,
    );
  });
});

// Возврат 1 (W4.13): эталон показывает ошибки формы flash без тона (ЗП:464, :469) — тост оболочки «ok» (role status),
// и «Сбросить черновик» не сбрасывает выбранный переход (onDiscard ЗП:461).
describe('«Процесс»: возврат 1', () => {
  const host = () => document.querySelector('.ox-toast');

  it('ошибки формы — тост без тона: значок check_circle, role=status', async () => {
    await open();
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Название статуса' }), {
      target: { value: 'в работе' },
    });
    fireEvent.click(button('Добавить статус'));
    await waitFor(() => expect(toast()).toBe('Статус «в работе» уже есть'), SLOW);
    expect(host()?.getAttribute('data-tone')).toBe('ok');
    expect(host()?.getAttribute('role')).toBe('status');
    fireEvent.click(button('Добавить переход'));
    await waitFor(() => expect(toast()).toBe('Назовите переход'), SLOW);
    expect(host()?.getAttribute('data-tone')).toBe('ok');
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Название перехода' }), {
      target: { value: 'Пауза' },
    });
    pick(within(pane()).getByRole('combobox', { name: 'Из статуса' }), 'Новая');
    pick(within(pane()).getByRole('combobox', { name: 'В статус' }), 'Новая');
    fireEvent.click(button('Добавить переход'));
    await waitFor(() => expect(toast()).toBe('Переход должен вести в другой статус'), SLOW);
    expect(host()?.getAttribute('data-tone')).toBe('ok');
  });

  it('«Сбросить черновик» — панель выбранного перехода остаётся открытой', async () => {
    await open();
    fireEvent.click(trRows()[2] as HTMLElement);
    await waitFor(() => expect(panel()).toBeTruthy(), SLOW);
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Название статуса' }), {
      target: { value: 'Ждёт запчасть' },
    });
    fireEvent.click(button('Добавить статус'));
    await waitFor(() => expect(chip()).toBe('Черновик · действует v1'), SLOW);
    fireEvent.click(button('Сбросить черновик'));
    await waitFor(() => expect(toast()).toBe('Черновик сброшен'), SLOW);
    await waitFor(() => expect(chip()).toBe('Действует v1'), SLOW);
    expect(
      within(panel() as HTMLElement).getByRole('heading', {
        level: 3,
        name: 'Переход «Согласовать»',
      }),
    ).toBeTruthy();
  });
});

describe('«Процесс»: без «Настраивать»', () => {
  it('исполнитель (водитель) — только чтение: без полей, кнопок правки и черновика', async () => {
    await open('driver');
    expect(within(pane()).queryByRole('textbox', { name: 'Название статуса' })).toBeNull();
    expect(within(pane()).queryByRole('button', { name: /^Удалить статус/ })).toBeNull();
    expect(within(pane()).queryByRole('button', { name: 'Добавить переход' })).toBeNull();
    fireEvent.click(trRows()[3] as HTMLElement);
    await waitFor(() => expect(panel()).toBeTruthy(), SLOW);
    const p = panel() as HTMLElement;
    for (const b of within(p).getAllByRole('button')) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
    for (const c of within(p).getAllByRole('checkbox')) {
      expect((c as HTMLInputElement).disabled).toBe(true);
    }
    expect(within(p).queryByRole('button', { name: 'Удалить переход' })).toBeNull();
  });
});
