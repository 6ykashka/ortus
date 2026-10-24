// W4.13 · Экранные тесты вкладки «Участники» (`tasks-people`; эталон design-2026-10-19 «Задачи и проекты.dc.html»
// :197–231, логика :439–455). Сеть — сценарный сервер W4.03 (listTaskProjectMembers, setTaskProjectMemberRole,
// removeTaskProjectMember, checkTaskProjectAccess, updateTaskProject, listMembers) на сиде «Альты»: проект LOG
// «Логистика · Север» (ограниченный, процесс v1 «С согласованием»).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const LOG = seedUuid('t-alta', 'fleet');
const SLOW = { timeout: 8_000 };
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (o: Parameters<typeof renderMockApp>[1] = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/tasks?project=${LOG}&view=people`, {
    persona: 'owner',
    ...o,
  });
  await screen.findByRole('tab', { name: 'Участники', selected: true }, SLOW);
  return app;
};

const pane = () => document.querySelector<HTMLElement>('.ox-tset') as HTMLElement;
const rows = () => [...document.querySelectorAll<HTMLElement>('.ox-tset-mrow')];
const rowOf = (name: string) =>
  rows().find((r) => r.querySelector('.ox-tset-mname')?.textContent === name) as HTMLElement;
const names = () => rows().map((r) => r.querySelector('.ox-tset-mname')?.textContent);
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const levels = () => within(pane()).getByRole('group', { name: 'Уровень доступа' });
const check = () => document.querySelector<HTMLElement>('.ox-tset-check') as HTMLElement;
const loaded = () => waitFor(() => expect(names()).toContain('Вера Котельникова'), SLOW);

describe('«Участники»: владелец', () => {
  it('уровень доступа, таблица, замок системной роли, «финансы скрыты»', async () => {
    await open();
    await loaded();
    expect(within(pane()).getByText('Кто видит проект')).toBeTruthy();
    expect(
      within(pane()).getByText('Все в области видят; создают и меняют задачи участники проекта'),
    ).toBeTruthy();
    expect(
      within(levels())
        .getAllByRole('button')
        .map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
    ).toEqual([
      ['Открытый', 'false'],
      ['Ограниченный', 'true'],
      ['Закрытый', 'false'],
    ]);
    expect(names()).toEqual([
      'Дарья Зимина',
      'Марина Котова',
      'Илья Васильев',
      'Вера Котельникова',
    ]);
    const owner = rowOf('Дарья Зимина');
    expect(within(owner).queryByRole('combobox')).toBeNull();
    expect(owner.textContent).toContain('Владелец бизнеса');
    expect(owner.textContent).toContain('Системная роль, вся организация');
    expect(within(owner).queryByRole('button', { name: 'Исключить Дарья Зимина' })).toBeNull();
    const kotova = within(rowOf('Марина Котова')).getByRole<HTMLSelectElement>('combobox', {
      name: 'Роль: Марина Котова',
    });
    expect(kotova.selectedOptions[0]?.textContent).toBe('Руководитель проекта');
    const vasiliev = rowOf('Илья Васильев');
    expect(vasiliev.textContent).toContain('Назначен через группу «Водители Север»');
    expect([...vasiliev.querySelectorAll('.ox-tset-cap')].map((c) => c.textContent)).toEqual([
      'Читать',
      'Создавать',
      'Менять статус',
      'финансы скрыты',
    ]);
    expect(
      within(rowOf('Вера Котельникова')).getByRole('button', {
        name: 'Исключить Вера Котельникова',
      }),
    ).toBeTruthy();
    expect(
      within(pane()).getByText(
        'Роль в проекте — это назначение роли с областью «проект»; оно видно и в «Пользователях и ролях». Унаследованный доступ (замок) меняется только там.',
      ),
    ).toBeTruthy();
  });

  it('«Открытый» — тост «Доступ: открытый», описание уровня', async () => {
    await open();
    await loaded();
    fireEvent.click(within(levels()).getByRole('button', { name: 'Открытый' }));
    await waitFor(() => expect(toast()).toBe('Доступ: открытый'), SLOW);
    expect(
      within(levels()).getByRole('button', { name: 'Открытый' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      within(pane()).getByText('Все с правом «Задачи» в области видят и работают с задачами'),
    ).toBeTruthy();
  });

  it('«Добавить» — «Роль назначена»; смена роли — «Роль изменена»; «Исключить» — тост с именем', async () => {
    await open();
    await loaded();
    const add = document.querySelector<HTMLElement>('.ox-tset-add') as HTMLElement;
    const who = within(add).getByRole<HTMLSelectElement>('combobox', { name: 'Сотрудник' });
    expect([...who.options].map((o) => o.textContent)).toEqual([
      'Сотрудник',
      'Дарья Зимина',
      'Анна Морозова',
      'Алексей Соколов',
      'Олеся Петрова',
      'Тимур Ахмедов',
      'Сергей Ильин',
    ]);
    const role = within(add).getByRole<HTMLSelectElement>('combobox', { name: 'Роль в проекте' });
    expect(role.selectedOptions[0]?.textContent).toBe('Исполнитель');
    fireEvent.change(who, {
      target: { value: [...who.options].find((o) => o.textContent === 'Алексей Соколов')?.value },
    });
    fireEvent.change(role, {
      target: { value: [...role.options].find((o) => o.textContent === 'Наблюдатель')?.value },
    });
    fireEvent.click(within(add).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(toast()).toBe('Роль назначена'), SLOW);
    await waitFor(() => expect(names()).toContain('Алексей Соколов'), SLOW);
    expect(who.value).toBe('');

    const vera = within(rowOf('Вера Котельникова')).getByRole<HTMLSelectElement>('combobox', {
      name: 'Роль: Вера Котельникова',
    });
    fireEvent.change(vera, {
      target: { value: [...vera.options].find((o) => o.textContent === 'Исполнитель')?.value },
    });
    await waitFor(() => expect(toast()).toBe('Роль изменена'), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Исключить Вера Котельникова' }));
    await waitFor(() => expect(toast()).toBe('Вера Котельникова исключён из проекта'), SLOW);
    await waitFor(() => expect(names()).not.toContain('Вера Котельникова'), SLOW);
  });

  it('«Проверить доступ»: может / не может с причиной; «Роли проекта»', async () => {
    await open();
    await loaded();
    const box = check();
    expect(within(box).getByRole('heading', { level: 3, name: 'Проверить доступ' })).toBeTruthy();
    const who = within(box).getByRole<HTMLSelectElement>('combobox', { name: 'Сотрудник' });
    const verb = within(box).getByRole<HTMLSelectElement>('combobox', { name: 'Действие' });
    expect(who.selectedOptions[0]?.textContent).toBe('Марина Котова');
    expect(verb.selectedOptions[0]?.textContent).toBe('Согласовывать');
    expect([...verb.options].map((o) => o.textContent)).toEqual([
      'Читать',
      'Создавать',
      'Менять статус',
      'Согласовывать',
      'Настраивать',
    ]);
    await waitFor(
      () =>
        expect(box.querySelector('.ox-tset-chk-text')?.textContent).toBe(
          'Марина Котова может: назначен в проекте (роль «Руководитель проекта»)',
        ),
      SLOW,
    );
    fireEvent.change(who, {
      target: { value: [...who.options].find((o) => o.textContent === 'Илья Васильев')?.value },
    });
    await waitFor(
      () =>
        expect(box.querySelector('.ox-tset-chk-text')?.textContent).toBe(
          'Илья Васильев не может: роль «Исполнитель» не даёт «Согласовывать»',
        ),
      SLOW,
    );
    const roles = document.querySelector<HTMLElement>('.ox-tset-roles') as HTMLElement;
    expect([...roles.querySelectorAll('.ox-tset-role')].map((r) => r.textContent)).toEqual([
      'Руководитель проектаЧитать, Создавать, Менять статус, Согласовывать, Настраивать',
      'СогласующийЧитать, Согласовывать',
      'ИсполнительЧитать, Создавать, Менять статус',
      'НаблюдательЧитать',
    ]);
    expect(
      within(roles).getByText('Состав прав ролей меняется в «Пользователях и ролях».'),
    ).toBeTruthy();
  });

  it('нет связи при назначении — тост «нет связи», строки прежние', async () => {
    await open({ scenario: 'setTaskProjectMemberRole=offline' });
    await loaded();
    const vera = within(rowOf('Вера Котельникова')).getByRole<HTMLSelectElement>('combobox', {
      name: 'Роль: Вера Котельникова',
    });
    fireEvent.change(vera, {
      target: { value: [...vera.options].find((o) => o.textContent === 'Наблюдатель')?.value },
    });
    await waitFor(() => expect(toast()).toBe(OFFLINE), SLOW);
    expect(names()).toContain('Вера Котельникова');
  });

  it('ошибка загрузки участников — «Повторить»', async () => {
    app = await renderMockApp(`/t/${ALTA}/tasks?project=${LOG}&view=people`, {
      persona: 'owner',
      scenario: 'listTaskProjectMembers=rate_limited',
    });
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(alert.textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    app.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await loaded();
  });
});

describe('«Участники»: руководитель проекта и исполнитель', () => {
  it('логист: правка без списка сотрудников, себя исключить нельзя', async () => {
    await open({ persona: 'manager' });
    await loaded();
    expect(
      within(rowOf('Марина Котова')).queryByRole('button', { name: 'Исключить Марина Котова' }),
    ).toBeNull();
    expect(
      within(rowOf('Вера Котельникова')).getByRole('button', {
        name: 'Исключить Вера Котельникова',
      }),
    ).toBeTruthy();
    const add = document.querySelector<HTMLElement>('.ox-tset-add') as HTMLElement;
    const who = within(add).getByRole<HTMLSelectElement>('combobox', { name: 'Сотрудник' });
    expect([...who.options].map((o) => o.textContent)).toEqual(['Сотрудник', 'Дарья Зимина']);
    expect(check()).toBeTruthy();
  });

  it('исполнитель (водитель): только чтение, «Проверить доступ» скрыт', async () => {
    await open({ persona: 'driver' });
    await loaded();
    for (const b of within(levels()).getAllByRole('button')) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
    expect(document.querySelector('.ox-tset-add')).toBeNull();
    expect(within(pane()).queryByRole('combobox', { name: /^Роль:/ })).toBeNull();
    expect(within(pane()).queryByRole('button', { name: /^Исключить/ })).toBeNull();
    expect(check()).toBeNull();
    expect(document.querySelector('.ox-tset-roles')).toBeTruthy();
  });
});

// Возврат 1 (W4.13): таблица «Участники» прокручивается вбок на 390 — у читателя без полей в ней область прокрутки
// должна быть доступна с клавиатуры (axe scrollable-region-focusable); сбой «Проверить доступ» — не пустой блок.
describe('«Участники»: возврат 1', () => {
  it('таблица — область «Участники» с фокусом (tabindex 0) и у владельца, и у водителя', async () => {
    for (const persona of ['owner', 'driver']) {
      await open({ persona });
      await loaded();
      const table = within(pane()).getByRole('region', { name: 'Участники' });
      expect(table.classList.contains('ox-tset-table')).toBe(true);
      expect(table.tabIndex).toBe(0);
      app?.close();
      app = undefined;
    }
  });

  it('сбой «Проверить доступ» — текст ошибки и «Повторить», не пустой блок', async () => {
    const a = await open({ scenario: 'checkTaskProjectAccess=rate_limited' });
    await loaded();
    await waitFor(
      () =>
        expect(within(check()).getByRole('alert').textContent).toBe(
          'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
        ),
      SLOW,
    );
    a.scenario.setScenario(null);
    fireEvent.click(within(check()).getByRole('button', { name: 'Повторить' }));
    await waitFor(
      () =>
        expect(check().querySelector('.ox-tset-chk-text')?.textContent).toBe(
          'Марина Котова может: назначен в проекте (роль «Руководитель проекта»)',
        ),
      SLOW,
    );
  });
});

// Возврат 2 (W4.13): ответ updateTaskProject — новый ETag проекта (общий ключ с шапкой хоста W4.12); второй уровень
// сразу после тоста, пока проект перечитывается, идёт с If-Match этого ответа (иначе 412 «Данные изменились»).
describe('«Участники»: возврат 2', () => {
  it('«Открытый», затем сразу «Ограниченный» — оба тоста уровня, без 412', async () => {
    const a = await open();
    await loaded();
    a.scenario.setScenario('getTaskProject=delay=1500');
    fireEvent.click(within(levels()).getByRole('button', { name: 'Открытый' }));
    await waitFor(() => expect(toast()).toBe('Доступ: открытый'), SLOW);
    expect(
      within(levels()).getByRole('button', { name: 'Открытый' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(within(levels()).getByRole('button', { name: 'Ограниченный' }));
    await waitFor(() => expect(toast()).toBe('Доступ: ограниченный'), SLOW);
    a.scenario.setScenario(null);
  });
});

// Возврат 3 (W4.13): список проектов хоста W4.12 остаётся смонтированным (useProjects наверху tasks.page) — после
// смены уровня в «Участниках» его столбец «Доступ» должен показать новый уровень, как в эталоне.
describe('«Участники»: возврат 3', () => {
  const logRow = () =>
    [...document.querySelectorAll<HTMLElement>('.ox-tk-prow')].find(
      (r) => r.querySelector('.ox-tk-key')?.textContent === 'LOG',
    ) as HTMLElement;
  const back = () => document.querySelector<HTMLButtonElement>('.ox-tk-back') as HTMLButtonElement;

  it('«Открытый» → «← Проекты» — у LOG в столбце «Доступ» «Открытый»', async () => {
    await open();
    await loaded();
    fireEvent.click(within(levels()).getByRole('button', { name: 'Открытый' }));
    await waitFor(() => expect(toast()).toBe('Доступ: открытый'), SLOW);
    fireEvent.click(back());
    await screen.findByRole('heading', { level: 2, name: 'Проекты' }, SLOW);
    await waitFor(
      () => expect(logRow().querySelector('.ox-tk-acc')?.textContent).toContain('Открытый'),
      SLOW,
    );
  });

  it('логист (роль в проекте): «Закрытый» → «← Проекты» — у LOG в столбце «Доступ» «Закрытый»', async () => {
    await open({ persona: 'manager' });
    await loaded();
    fireEvent.click(within(levels()).getByRole('button', { name: 'Закрытый' }));
    await waitFor(() => expect(toast()).toBe('Доступ: закрытый'), SLOW);
    fireEvent.click(back());
    await screen.findByRole('heading', { level: 2, name: 'Проекты' }, SLOW);
    await waitFor(
      () => expect(logRow().querySelector('.ox-tk-acc')?.textContent).toContain('Закрытый'),
      SLOW,
    );
  });

  // Владелец без роли в проекте после «Закрытый» теряет доступ к нему (Q-W4.10-4, Q-W4.10-6: закрытый — только по
  // роли в проекте, в списке его нет) — хост возвращает к списку, где LOG уже нет, а не «Ограниченный».
  it('владелец без роли в проекте: «Закрытый» — в списке LOG нет', async () => {
    await open();
    await loaded();
    fireEvent.click(within(levels()).getByRole('button', { name: 'Закрытый' }));
    await waitFor(() => expect(toast()).toBe('Доступ: закрытый'), SLOW);
    const b = document.querySelector<HTMLButtonElement>('.ox-tk-back');
    if (b) fireEvent.click(b);
    await screen.findByRole('heading', { level: 2, name: 'Проекты' }, SLOW);
    await waitFor(() => expect(document.querySelector('.ox-tk-prow')).toBeTruthy(), SLOW);
    await waitFor(() => expect(logRow()).toBeUndefined(), SLOW);
  });
});

// Возврат 4 (W4.13): доступ потерян (владелец без роли, «Закрытый») — проект перечитывается один раз (сигнал хосту
// W4.12 вернуть к списку), участники и «Проверить доступ» не перечитываются: в журнале нет их 404.
describe('«Участники»: возврат 4', () => {
  it('владелец без роли: «Закрытый» — 404 только у чтения проекта, не у участников и проверки', async () => {
    const a = await open();
    await loaded();
    await waitFor(() => expect(check().textContent).toContain('может'), SLOW);
    const before = a.responses().length;
    fireEvent.click(within(levels()).getByRole('button', { name: 'Закрытый' }));
    await waitFor(() => expect(toast()).toBe('Доступ: закрытый'), SLOW);
    await screen.findByRole('heading', { level: 2, name: 'Проекты' }, SLOW);
    await new Promise((r) => setTimeout(r, 300));
    const gone = a
      .responses()
      .slice(before)
      .filter((r) => r.status === 404)
      .map((r) => r.path.replace(/^.*\/projects\/[^/]+/, '…'));
    expect(gone).toEqual(['…']);
  });
});
