// W4.12 · Экранные тесты «Задач и проектов» (`tasks-projects`, `tasks-project-new`, `tasks-board`, `modal-new-task`,
// `tasks-card`; эталон design-2026-10-19 «Задачи и проекты.dc.html»). Сеть — сценарный сервер W4.03 (тег Tasks) на сиде
// W4.10: «Альта» — проект LOG «Логистика · Север» (T-64, T-66, T-58, T-65, T-63, T-61) и воронка ЗАЯ; вложения —
// core.files сценарного сервера (initiateUpload, хранилище mock, completeUpload) и attachTaskFiles.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const SLOW = { timeout: 8_000 };
const LOG = 'Логистика · Север';
const T65 = 'Заменить шины на ГАЗон Next (зимние)';
const T66 = 'Подготовить парк к зиме';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (
  o: Parameters<typeof renderMockApp>[1] & { search?: string } = {},
): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/tasks${o.search ?? ''}`, { persona: 'owner', ...o });
  return app;
};

const root = () => document.querySelector<HTMLElement>('.ox-tasks');
const text = () => root()?.textContent ?? '';
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const toastIs = (t: string) => waitFor(() => expect(toast()).toBe(t), SLOW);
const rows = () => [...document.querySelectorAll<HTMLElement>('.ox-tk-prow')];
const projectsReady = () =>
  screen
    .findByRole('heading', { level: 2, name: 'Проекты' }, SLOW)
    .then(() => waitFor(() => expect(rows().length).toBeGreaterThan(0), SLOW));
const colNames = () =>
  [...document.querySelectorAll('.ox-tk-col-name')].map((x) => x.textContent ?? '');
const colCounts = () =>
  [...document.querySelectorAll('.ox-tk-col-count')].map((x) => x.textContent ?? '');
const kcard = (title: string) =>
  [...document.querySelectorAll<HTMLElement>('.ox-tk-kcard')].find((x) =>
    x.textContent?.includes(title),
  );
const card = () => document.querySelector<HTMLElement>('.ox-tk-card');

async function openProject(): Promise<void> {
  await projectsReady();
  const row = rows().find((r) => r.textContent?.includes(LOG));
  fireEvent.click(row as HTMLElement);
  await waitFor(() => expect(colNames()).toHaveLength(5), SLOW);
}

async function openCard(title: string): Promise<HTMLElement> {
  await waitFor(() => expect(kcard(title)).toBeTruthy(), SLOW);
  fireEvent.click(kcard(title) as HTMLElement);
  await screen.findByRole('heading', { level: 3, name: title }, SLOW);
  return card() as HTMLElement;
}

const RATE = 'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const ALERT_429 = 'Слишком много запросов. Подождите и повторите.';
/** Длительность тоста оболочки (shell/toast.tsx TOAST_MS) с запасом. */
const AFTER_TOAST = { timeout: 9_000 };

interface OrgLike {
  members: { id: string; displayName: string }[];
  roles: { id: string; name: string; permissions: string[] }[];
  assignments: {
    principalType: string;
    principalId: string;
    roleId: string;
    scope: { kind: string; resourceIds: string[] };
  }[];
  tasksData?: { tasks: { key: string; assigneeId?: string }[] };
}
const orgOf = (s: MockApp['scenario']): OrgLike => {
  const org = (s.state() as unknown as { orgs: Record<string, OrgLike> }).orgs[ALTA];
  if (!org) throw new Error('нет «Альты» в состоянии сценарного сервера');
  return org;
};

/** Роль участника в проекте LOG — «Наблюдатель» (только чтение задач). */
function viewerInLog(s: MockApp['scenario'], name: string): void {
  const org = orgOf(s);
  const m = org.members.find((x) => x.displayName === name);
  const viewer = org.roles.find(
    (r) =>
      r.name === 'Наблюдатель' &&
      r.permissions.includes('tasks.projects.read') &&
      !r.permissions.includes('tasks.update'),
  );
  const a = org.assignments.find(
    (x) =>
      x.principalType === 'member' &&
      x.principalId === m?.id &&
      x.scope.kind === 'project' &&
      x.scope.resourceIds.includes(A('fleet')),
  );
  if (!a || !viewer) throw new Error(`нет назначения ${name} в LOG или роли «Наблюдатель»`);
  a.roleId = viewer.id;
}

/** Файл из байтов (jsdom: File, arrayBuffer, crypto.subtle). */
const fileOf = (name: string, type: string, size: number): File =>
  new File([new Uint8Array(size).fill(37)], name, { type });

describe('«Проекты» (tasks-projects)', () => {
  it('владелец: заголовок, подпись, LOG и воронка ЗАЯ с подписями эталона, «Новый проект», подсказка', async () => {
    await open();
    await projectsReady();
    expect(text()).toContain('Видны проекты, где у вас есть право «Задачи · Читать»');
    expect(rows().map((r) => r.querySelector('.ox-tk-key')?.textContent)).toEqual(['LOG', 'ЗАЯ']);
    const log = rows()[0] as HTMLElement;
    expect(log.textContent).toContain('Марина Котова · процесс v1');
    expect(log.textContent).toContain('Север Логистик');
    expect(log.textContent).toContain('Ограниченный');
    expect([...log.querySelectorAll('.ox-tk-num')].map((x) => x.textContent)).toEqual(['3', '5']);
    const leads = rows()[1] as HTMLElement;
    expect(leads.textContent).toContain('Дарья Зимина · воронка заявок');
    expect(leads.textContent).toContain('Воронка');
    expect(screen.getByRole('button', { name: 'Новый проект' })).toBeTruthy();
    expect(text()).toContain('Одна роль — одинаковые права во всех проектах.');
  });

  it('прораб: 403 списка — «Проектов, доступных вам, пока нет», без «Новый проект»', async () => {
    await open({ persona: 'foreman' });
    await screen.findByRole('heading', { level: 2, name: 'Проекты' }, SLOW);
    await waitFor(() => expect(text()).toContain('Проектов, доступных вам, пока нет'), SLOW);
    expect(rows()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Новый проект' })).toBeNull();
  });

  it('логист: LOG без «Новый проект» (PD-53)', async () => {
    await open({ persona: 'manager' });
    await projectsReady();
    expect(rows().some((r) => r.textContent?.includes(LOG))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Новый проект' })).toBeNull();
  });

  it('ошибка загрузки — «Не удалось загрузить данные: …» и «Повторить»', async () => {
    await open({ scenario: 'listTaskProjects=rate_limited' });
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(alert.textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    app?.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(rows()).toHaveLength(2), SLOW);
  });

  it('строка воронки ведёт на старую доску «Заявки» (leads)', async () => {
    const a = await open();
    await projectsReady();
    fireEvent.click(rows()[1] as HTMLElement);
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/leads`), SLOW);
  });
});

describe('«Новый проект» (tasks-project-new)', () => {
  it('ключ по названию, подсказка номеров, доступ «Ограниченный»; создание — тост и «Участники»', async () => {
    await open();
    await projectsReady();
    fireEvent.click(screen.getByRole('button', { name: 'Новый проект' }));
    const wiz = document.querySelector<HTMLElement>('.ox-tk-wiz') as HTMLElement;
    const w = within(wiz);
    expect(wiz.textContent).toContain(
      'Номера задач: КЛЮЧ-101, КЛЮЧ-102… Ключ уникален в организации.',
    );
    fireEvent.change(w.getByLabelText('Название'), { target: { value: 'Ремонт · ЖК Речной' } });
    expect((w.getByLabelText('Ключ') as HTMLInputElement).value).toBe('РЖР');
    expect(wiz.textContent).toContain(
      'Номера задач: РЖР-101, РЖР-102… Ключ уникален в организации.',
    );
    expect(w.getByRole('radio', { name: /Ограниченный/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(w.getByRole('radio', { name: /Закрытый/ }).textContent).toContain(
      'Только участники проекта',
    );
    fireEvent.click(w.getByRole('button', { name: 'Копия проекта' }));
    expect(w.getByLabelText('Проект-образец').textContent).toContain(
      'LOG · Логистика · Север · v1',
    );
    fireEvent.click(w.getByRole('button', { name: 'Простой' }));
    fireEvent.click(w.getByRole('button', { name: 'Создать проект' }));
    await toastIs('Проект «Ремонт · ЖК Речной» создан');
    await waitFor(
      () =>
        expect(screen.getByRole('tab', { name: 'Участники' }).getAttribute('aria-selected')).toBe(
          'true',
        ),
      SLOW,
    );
    // Владелец организации в незакрытом проекте — системная роль (projAccess, TP-03 — только закрытый).
    expect(text()).toContain('Вы: Владелец бизнеса');
  });

  it('ошибки сервера — в форме: короткое название, занятый ключ', async () => {
    await open();
    await projectsReady();
    fireEvent.click(screen.getByRole('button', { name: 'Новый проект' }));
    const w = within(document.querySelector<HTMLElement>('.ox-tk-wiz') as HTMLElement);
    fireEvent.change(w.getByLabelText('Название'), { target: { value: 'Ок' } });
    fireEvent.click(w.getByRole('button', { name: 'Создать проект' }));
    expect((await w.findByRole('alert', {}, SLOW)).textContent).toBe(
      'Название — не короче 3 символов',
    );
    fireEvent.change(w.getByLabelText('Название'), { target: { value: 'Логистика · Юг' } });
    fireEvent.change(w.getByLabelText('Ключ'), { target: { value: 'log' } });
    fireEvent.click(w.getByRole('button', { name: 'Создать проект' }));
    await waitFor(() => expect(w.getByRole('alert').textContent).toBe('Ключ LOG уже занят'), SLOW);
  });
});

describe('«Доска» и «Список» (tasks-board)', () => {
  it('шапка, вкладки, колонки процесса, карточки со связями, согласованием и сроком', async () => {
    await open();
    await openProject();
    expect(text()).toContain('Север Логистик · ограниченный проект · процесс v1');
    expect(text()).toContain('Вы: Владелец бизнеса');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Доска',
      'Список',
      'Участники',
      'Процесс',
      'Автоматизация',
    ]);
    expect(colNames()).toEqual(['Новая', 'В работе', 'На проверке', 'Готово', 'Отменена']);
    await waitFor(() => expect(colCounts()).toEqual(['1', '2', '2', '1', '0']), SLOW);
    const t65 = kcard(T65) as HTMLElement;
    expect(t65.textContent).toContain('↳ T-66');
    expect(t65.textContent).toContain('Ждёт вас');
    expect(t65.textContent).toContain('Высокий');
    expect(t65.textContent).toContain('10.10');
    expect(t65.querySelector('[title="Илья Васильев"]')?.textContent).toBe('ИВ');
    expect(kcard(T66)?.textContent).toContain('☰ 0/2');
  });

  it('фильтры: «Ждут моего согласия · 2» — две задачи, «Мои» — одна', async () => {
    await open();
    await openProject();
    const appr = await screen.findByRole('button', { name: 'Ждут моего согласия · 2' }, SLOW);
    fireEvent.click(appr);
    await waitFor(() => expect(colCounts()).toEqual(['0', '0', '2', '0', '0']), SLOW);
    expect(appr.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Мои' }));
    await waitFor(() => expect(colCounts()).toEqual(['0', '0', '1', '0', '0']), SLOW);
  });

  it('быстрое создание по Enter: тост «Задача создана», открыта карточка новой задачи', async () => {
    await open();
    await openProject();
    const input = screen.getByLabelText('Название новой задачи');
    fireEvent.change(input, { target: { value: 'Купить антифриз' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await toastIs('Задача создана');
    await screen.findByRole('heading', { level: 3, name: 'Купить антифриз' }, SLOW);
    expect(card()?.textContent).toContain('LOG-101');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('вид «Список»: строки со статусом и исполнителем, строка открывает карточку', async () => {
    const a = await open();
    await openProject();
    fireEvent.click(screen.getByRole('tab', { name: 'Список' }));
    await waitFor(() => expect(document.querySelectorAll('.ox-tk-lrow')).toHaveLength(6), SLOW);
    expect(a.router.state.location.search).toMatchObject({ view: 'list' });
    const row = [...document.querySelectorAll<HTMLElement>('.ox-tk-lrow')].find((r) =>
      r.textContent?.includes(T65),
    ) as HTMLElement;
    expect(row.textContent).toContain('На проверке');
    expect(row.textContent).toContain('Илья Васильев');
    fireEvent.click(row);
    await screen.findByRole('heading', { level: 3, name: T65 }, SLOW);
  });

  it('проект без процесса: «Настроить процесс» — тост «Процесс создан», доска', async () => {
    const a = await open();
    await projectsReady();
    const orgs = (
      a.scenario.state() as unknown as {
        orgs: Record<string, { tasksData?: { projects: { key: string; versions: unknown[] }[] } }>;
      }
    ).orgs;
    const log = orgs[ALTA]?.tasksData?.projects.find((p) => p.key === 'LOG');
    if (!log) throw new Error('нет проекта LOG в состоянии сценарного сервера');
    log.versions = [];
    fireEvent.click(rows().find((r) => r.textContent?.includes(LOG)) as HTMLElement);
    await waitFor(
      () =>
        expect(text()).toContain(
          'У проекта ещё нет настраиваемого процесса. Создадим его из текущих статусов: Новая, В работе, На проверке, Готово.',
        ),
      SLOW,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Настроить процесс' }));
    await toastIs('Процесс создан');
    await waitFor(() => expect(colNames().length).toBeGreaterThan(3), SLOW);
  });
});

describe('«Новая задача» (modal-new-task)', () => {
  it('тема короче 3 символов — ошибка в форме; плохой файл — «Не прикрепится», «Уберите файлы…»', async () => {
    await open();
    await openProject();
    fireEvent.click(screen.getByRole('button', { name: 'Задача' }));
    const d = within(await screen.findByRole('dialog', { name: 'Новая задача' }, SLOW));
    expect(d.getByText('Новая', { selector: '.ox-tk-nf-status' })).toBeTruthy();
    fireEvent.change(d.getByLabelText('Тема *'), { target: { value: 'Ок' } });
    fireEvent.click(d.getByRole('button', { name: 'Создать' }));
    expect(d.getByRole('alert').textContent).toBe('Тема — не короче 3 символов');
    expect(d.getByLabelText('Тема *').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(d.getByLabelText('Тема *'), { target: { value: 'Купить антифриз' } });
    fireEvent.change(d.getByLabelText('Выбрать файлы'), {
      target: { files: [fileOf('setup.exe', 'application/x-msdownload', 10)] },
    });
    expect(d.getByText('Не прикрепится: такой тип не принимаем')).toBeTruthy();
    fireEvent.click(d.getByRole('button', { name: 'Создать' }));
    expect(d.getByRole('alert').textContent).toBe(
      'Уберите файлы, которые не прикрепятся: setup.exe',
    );
  });

  it('создание с вложением: createTask, загрузка, attachTaskFiles — тост «Задача LOG-101 создана», карточка с файлом', async () => {
    const a = await open();
    await openProject();
    fireEvent.click(screen.getByRole('button', { name: 'Задача' }));
    const d = within(await screen.findByRole('dialog', { name: 'Новая задача' }, SLOW));
    fireEvent.change(d.getByLabelText('Тема *'), { target: { value: 'Купить антифриз' } });
    fireEvent.change(d.getByLabelText(/^Описание/), { target: { value: 'Две канистры' } });
    expect(d.getByText('12 / 5000')).toBeTruthy();
    fireEvent.change(d.getByLabelText('Выбрать файлы'), {
      target: { files: [fileOf('Акт.pdf', 'application/pdf', 1024)] },
    });
    expect(d.getByText('1 КБ')).toBeTruthy();
    fireEvent.change(d.getByLabelText('Метки'), { target: { value: 'Зима, закупка' } });
    fireEvent.click(d.getByRole('button', { name: 'Создать' }));
    await toastIs('Задача LOG-101 создана');
    const c = await screen.findByRole('heading', { level: 3, name: 'Купить антифриз' }, SLOW);
    expect(c).toBeTruthy();
    await waitFor(() => expect(card()?.textContent).toContain('Вложения · 1'), SLOW);
    expect(card()?.textContent).toContain('Акт.pdf');
    expect([...(card()?.querySelectorAll('.ox-tk-label') ?? [])].map((x) => x.textContent)).toEqual(
      ['зима', 'закупка'],
    );
    const calls = a
      .responses()
      .map((r) => `${r.method} ${r.path.replace(`/api/v1/tenants/${ALTA}`, '')}`);
    const create = calls.indexOf('POST /tasks');
    const upload = calls.indexOf('POST /files/uploads');
    const attach = calls.findIndex((c) => /^POST \/tasks\/[^/]+\/files$/.test(c));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThan(create);
    expect(attach).toBeGreaterThan(upload);
  });

  it('«Создать ещё одну»: форма остаётся, тема очищена, исполнитель сохранён; Escape закрывает', async () => {
    await open();
    await openProject();
    fireEvent.click(screen.getByRole('button', { name: 'Задача' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая задача' }, SLOW);
    const d = within(dialog);
    await waitFor(
      () => expect(d.getByLabelText('Исполнитель').textContent).toContain('Марина Котова'),
      SLOW,
    );
    fireEvent.click(d.getByLabelText('Создать ещё одну'));
    const who = d.getByLabelText('Исполнитель') as HTMLSelectElement;
    const kotova = [...who.options].find((o) => o.textContent === 'Марина Котова');
    fireEvent.change(who, { target: { value: kotova?.value } });
    fireEvent.change(d.getByLabelText('Тема *'), { target: { value: 'Первая задача' } });
    fireEvent.click(d.getByRole('button', { name: 'Создать' }));
    await toastIs('Задача LOG-101 создана');
    expect((d.getByLabelText('Тема *') as HTMLInputElement).value).toBe('');
    expect(who.selectedOptions[0]?.textContent).toBe('Марина Котова');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новая задача' })).toBeNull());
  });
});

describe('карточка задачи (tasks-card)', () => {
  it('T-65: автор, переходы, согласование, поля, связи, описание, вложение, чек-лист, история', async () => {
    await open();
    await openProject();
    const c = await openCard(T65);
    expect(c.textContent).toContain('· автор Илья Васильев');
    expect(c.querySelector('.ox-tk-status')?.textContent).toBe('На проверке');
    expect([...c.querySelectorAll('.ox-tk-trs button')].map((b) => b.textContent)).toEqual([
      'how_to_regСогласовать',
      'arrow_forwardОтменить',
    ]);
    expect(c.textContent).toContain('Согласование «Согласовать» · достаточно одного');
    expect(c.textContent).toContain('Дарья Зимина · вы');
    expect(c.textContent).toContain('ждёт решения');
    expect(within(c).getByRole('button', { name: 'Вернуть на доработку' })).toBeTruthy();
    expect(within(c).getByRole('button', { name: `T-66 · ${T66}` })).toBeTruthy();
    expect(c.textContent).toContain('подзадач нет');
    expect(c.textContent).toContain('Комплект зимних шин 215/75 R17.5, 6 шт., с шиномонтажом.');
    expect(c.textContent).toContain('Вложения · 1');
    expect(c.textContent).toContain('180 КБ · Илья Васильев');
    expect((within(c).getByLabelText('Счёт приложен') as HTMLInputElement).checked).toBe(true);
    await waitFor(
      () =>
        expect(c.querySelector('.ox-tk-hist')?.textContent).toContain(
          'Сумма 48 600 ₽, счёт во вложении. Прошу согласовать.',
        ),
      SLOW,
    );
  });

  it('«Согласовать» — тост «Согласовано», статус «Готово»; блок согласования пропал', async () => {
    await open();
    await openProject();
    const c = await openCard(T65);
    fireEvent.click(within(c).getByRole('button', { name: /Согласовать/ }));
    await toastIs('Согласовано');
    await waitFor(
      () => expect(card()?.querySelector('.ox-tk-status')?.textContent).toBe('Готово'),
      SLOW,
    );
    expect(card()?.querySelector('.ox-tk-appr')).toBeNull();
  });

  it('«Вернуть на доработку» без комментария — «Напишите, что доработать»; с комментарием — «В работе»', async () => {
    await open();
    await openProject();
    const c = await openCard(T65);
    fireEvent.click(within(c).getByRole('button', { name: 'Вернуть на доработку' }));
    await toastIs('Напишите, что доработать');
    fireEvent.change(within(c).getByLabelText('Комментарий'), {
      target: { value: 'Нужен второй счёт' },
    });
    fireEvent.click(within(c).getByRole('button', { name: 'Вернуть на доработку' }));
    await toastIs('Возвращено на доработку');
    await waitFor(
      () => expect(card()?.querySelector('.ox-tk-status')?.textContent).toBe('В работе'),
      SLOW,
    );
  });

  it('связи T-66: «Исключить T-58 из состава» — тост, подзадач стало меньше', async () => {
    await open();
    await openProject();
    const c = await openCard(T66);
    await waitFor(() => expect(c.querySelectorAll('.ox-tk-kid')).toHaveLength(2), SLOW);
    expect(c.textContent).toContain('0 из 2 готово');
    fireEvent.click(within(c).getByRole('button', { name: 'Исключить T-58 из состава' }));
    await toastIs('T-58 исключена из состава');
    await waitFor(() => expect(card()?.querySelectorAll('.ox-tk-kid')).toHaveLength(1), SLOW);
  });

  it('вложения: «Прикрепить» — «Прикреплено файлов: 1»; файл недопустимого типа — «Не прикреплено: …»', async () => {
    await open();
    await openProject();
    const c = await openCard('Найти водителя на рейс Р-211');
    fireEvent.change(within(c).getByLabelText('Прикрепить файлы'), {
      target: { files: [fileOf('setup.exe', 'application/x-msdownload', 10)] },
    });
    await toastIs('Не прикреплено: setup.exe — такой тип не принимаем');
    fireEvent.change(within(c).getByLabelText('Прикрепить файлы'), {
      target: { files: [fileOf('Акт.pdf', 'application/pdf', 2048)] },
    });
    await toastIs('Прикреплено файлов: 1');
    await waitFor(() => expect(card()?.textContent).toContain('Вложения · 1'), SLOW);
    fireEvent.click(within(card() as HTMLElement).getByRole('button', { name: 'Удалить Акт.pdf' }));
    await toastIs('Файл удалён');
  });

  it('чек-лист и комментарий: отметка и запись в истории', async () => {
    await open();
    await openProject();
    const c = await openCard('Записать ГАЗон Next на плановое ТО');
    const box = within(c).getByLabelText('Перенести рейсы на другие машины') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(
      () =>
        expect(card()?.querySelector('.ox-tk-hist')?.textContent).toContain(
          'отметил(а): Перенести рейсы на другие машины',
        ),
      SLOW,
    );
    fireEvent.change(within(c).getByLabelText('Комментарий к задаче'), {
      target: { value: 'Сервис подтвердил' },
    });
    fireEvent.click(within(c).getByRole('button', { name: 'Отправить комментарий' }));
    await waitFor(
      () =>
        expect(card()?.querySelector('.ox-tk-hist')?.textContent).toContain('Сервис подтвердил'),
      SLOW,
    );
  });

  it('согласование «нужны все»: голос владельца — тост «Голос учтён. Ждём: …», статус прежний (Р-26)', async () => {
    const a = await open();
    await projectsReady();
    const orgs = (
      a.scenario.state() as unknown as {
        orgs: Record<
          string,
          {
            tasksData?: {
              projects: {
                key: string;
                versions: { transitions: { approval?: { mode: string } }[] }[];
              }[];
            };
          }
        >;
      }
    ).orgs;
    const log = orgs[ALTA]?.tasksData?.projects.find((p) => p.key === 'LOG');
    for (const tr of log?.versions.at(-1)?.transitions ?? []) {
      if (tr.approval) tr.approval.mode = 'all';
    }
    fireEvent.click(rows().find((r) => r.textContent?.includes(LOG)) as HTMLElement);
    await waitFor(() => expect(colNames()).toHaveLength(5), SLOW);
    const c = await openCard(T65);
    expect(c.textContent).toContain('Согласование «Согласовать» · нужны все');
    fireEvent.click(within(c).getByRole('button', { name: /Согласовать/ }));
    await toastIs('Голос учтён. Ждём: Марина Котова, Вера Котельникова');
    expect(card()?.querySelector('.ox-tk-status')?.textContent).toBe('На проверке');
    await waitFor(() => expect(card()?.textContent).toContain('согласовал(а)'), SLOW);
  });

  it('ссылка ?task= открывает проект задачи и её карточку (Р-20)', async () => {
    await open({ search: `?task=${A('T-65')}` });
    await screen.findByRole('heading', { level: 3, name: T65 }, SLOW);
    expect(text()).toContain(LOG);
    expect(screen.getByRole('tab', { name: 'Доска' }).getAttribute('aria-selected')).toBe('true');
  });
});

// Возврат 1 (ревью W4.12): состояния карточки и ссылок (бриф §1 п. 7, verification-protocol §1 п. 3).
describe('карточка и ссылки: загрузка, ошибка, 404, только чтение (возврат 1)', () => {
  it('карточка грузится — скелетон на месте карточки', async () => {
    const a = await open();
    await openProject();
    a.scenario.setScenario('getTask=loading');
    fireEvent.click(kcard(T65) as HTMLElement);
    await waitFor(
      () => expect(card()?.querySelector('[role="status"][aria-label="Загрузка"]')).toBeTruthy(),
      SLOW,
    );
  });

  it('ошибка getTask — в карточке «Не удалось загрузить данные: …» и «Повторить»', async () => {
    const a = await open();
    await openProject();
    a.scenario.setScenario('getTask=rate_limited');
    fireEvent.click(kcard(T65) as HTMLElement);
    await waitFor(
      () => expect(card()?.querySelector('[role="alert"]')?.textContent).toBe(RATE),
      SLOW,
    );
    a.scenario.setScenario(null);
    fireEvent.click(within(card() as HTMLElement).getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('heading', { level: 3, name: T65 }, SLOW);
  });

  it('ссылка ?task= без проекта и ошибка getTask — «Повторить», а не вечный скелетон', async () => {
    const a = await open({ search: `?task=${A('T-65')}`, scenario: 'getTask=rate_limited' });
    expect((await screen.findByRole('alert', {}, SLOW)).textContent).toBe(RATE);
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('heading', { level: 3, name: T65 }, SLOW);
  });

  it('ссылка ?task= на несуществующую задачу (404) — убрана из адреса; с проектом — доска без карточки', async () => {
    const a = await open({ search: `?task=${A('T-404')}` });
    await projectsReady();
    await waitFor(() => expect(a.router.state.location.search).not.toHaveProperty('task'), SLOW);
    app?.close();
    const b = await open({ search: `?project=${A('fleet')}&task=${A('T-404')}` });
    await waitFor(() => expect(colNames()).toHaveLength(5), SLOW);
    await waitFor(() => expect(b.router.state.location.search).not.toHaveProperty('task'), SLOW);
    expect(card()).toBeNull();
  });

  it('прораб по ссылке на проект или задачу без доступа — «Проектов, доступных вам, пока нет», без «Повторить»', async () => {
    const a = await open({ persona: 'foreman', search: `?project=${A('fleet')}` });
    await waitFor(() => expect(text()).toContain('Проектов, доступных вам, пока нет'), SLOW);
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
    expect(a.router.state.location.search).not.toHaveProperty('project');
    app?.close();
    const b = await open({ persona: 'foreman', search: `?task=${A('T-65')}` });
    await waitFor(() => expect(text()).toContain('Проектов, доступных вам, пока нет'), SLOW);
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
    expect(b.router.state.location.search).not.toHaveProperty('task');
  });

  it('только чтение (роль «Наблюдатель» в LOG): исполнитель, приоритет и чек-лист недоступны, команд нет', async () => {
    await open({ persona: 'manager', setup: (s) => viewerInLog(s, 'Марина Котова') });
    await openProject();
    expect(text()).toContain('Вы: Наблюдатель');
    expect(screen.queryByLabelText('Название новой задачи')).toBeNull();
    const c = await openCard('Записать ГАЗон Next на плановое ТО');
    const w = within(c);
    expect((w.getByLabelText('Исполнитель') as HTMLSelectElement).disabled).toBe(true);
    expect((w.getByLabelText('Приоритет') as HTMLSelectElement).disabled).toBe(true);
    expect(
      (w.getByLabelText('Перенести рейсы на другие машины') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(w.queryByLabelText('Прикрепить файлы')).toBeNull();
    expect(w.queryByRole('button', { name: 'Подзадача' })).toBeNull();
    expect(w.queryByLabelText('Входит в задачу')).toBeNull();
  });

  it('задача без исполнителя: в «Исполнитель» выбран пустой вариант, выбор участника назначает его', async () => {
    const a = await open();
    await projectsReady();
    const t64 = orgOf(a.scenario).tasksData?.tasks.find((t) => t.key === 'T-64');
    if (!t64) throw new Error('нет T-64');
    delete t64.assigneeId;
    fireEvent.click(rows().find((r) => r.textContent?.includes(LOG)) as HTMLElement);
    await waitFor(() => expect(colNames()).toHaveLength(5), SLOW);
    const c = await openCard('Найти водителя на рейс Р-211');
    const who = within(c).getByLabelText('Исполнитель') as HTMLSelectElement;
    await waitFor(() => expect(who.options.length).toBeGreaterThan(1), SLOW);
    expect(who.value).toBe('');
    expect(who.selectedOptions[0]?.value).toBe('');
    const kotova = [...who.options].find((o) => o.textContent === 'Марина Котова');
    fireEvent.change(who, { target: { value: kotova?.value } });
    await waitFor(
      () =>
        expect(
          kcard('Найти водителя на рейс Р-211')?.querySelector('[title="Марина Котова"]'),
        ).toBeTruthy(),
      SLOW,
    );
  });

  it('фильтры пишут в адрес mine=1 и approval=1 без кавычек (ADR-0001)', async () => {
    const a = await open();
    await openProject();
    fireEvent.click(await screen.findByRole('button', { name: 'Ждут моего согласия · 2' }, SLOW));
    await waitFor(() => expect(a.router.state.location.href).toMatch(/[?&]approval=1(&|$)/), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Мои' }));
    await waitFor(() => expect(a.router.state.location.href).toMatch(/[?&]mine=1(&|$)/), SLOW);
    expect(a.router.state.location.href).not.toContain('%22');
  });
});

describe('доступность и фокус (возврат 1)', () => {
  it('прораб, пустой список: прокручиваемая таблица фокусируема (region, tabindex=0)', async () => {
    await open({ persona: 'foreman' });
    await waitFor(() => expect(text()).toContain('Проектов, доступных вам, пока нет'), SLOW);
    const table = document.querySelector<HTMLElement>('.ox-tk-table');
    expect(table?.getAttribute('role')).toBe('region');
    expect(table?.getAttribute('aria-label')).toBe('Таблица проектов');
    expect(table?.tabIndex).toBe(0);
  });

  it('«Новый проект» → «Отмена»: панель закрыта, фокус на «Новый проект»', async () => {
    await open();
    await projectsReady();
    const btn = screen.getByRole('button', { name: 'Новый проект' });
    fireEvent.click(btn);
    fireEvent.click(
      within(document.querySelector<HTMLElement>('.ox-tk-wiz') as HTMLElement).getByRole('button', {
        name: 'Отмена',
      }),
    );
    expect(document.querySelector('.ox-tk-wiz')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

describe('ошибки форм и вложений (возврат 1)', () => {
  it('«Новый проект», нет связи — текст в форме, без второго тоста', async () => {
    const a = await open();
    await projectsReady();
    fireEvent.click(screen.getByRole('button', { name: 'Новый проект' }));
    const w = within(document.querySelector<HTMLElement>('.ox-tk-wiz') as HTMLElement);
    fireEvent.change(w.getByLabelText('Название'), { target: { value: 'Ремонт · ЖК Речной' } });
    a.scenario.setScenario('createTaskProject=offline');
    fireEvent.click(w.getByRole('button', { name: 'Создать проект' }));
    expect((await w.findByRole('alert', {}, SLOW)).textContent).toBe(OFFLINE);
    expect(toast()).toBeUndefined();
  });

  it('«Новая задача»: нет связи и 429 — текст в форме, тоста нет, диалог открыт', async () => {
    const a = await open();
    await openProject();
    fireEvent.click(screen.getByRole('button', { name: 'Задача' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая задача' }, SLOW);
    const d = within(dialog);
    fireEvent.change(d.getByLabelText('Тема *'), { target: { value: 'Купить антифриз' } });
    a.scenario.setScenario('createTask=offline');
    fireEvent.click(d.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(d.getByRole('alert').textContent).toBe(OFFLINE), SLOW);
    expect(toast()).toBeUndefined();
    a.scenario.setScenario('createTask=rate_limited');
    fireEvent.click(d.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(d.getByRole('alert').textContent).toBe(ALERT_429), SLOW);
    expect(toast()).toBeUndefined();
    expect(screen.getByRole('dialog', { name: 'Новая задача' })).toBe(dialog);
  });

  it('счётчик описания — без разрядов: «5001 / 5000» (String(n), ЗП:399)', async () => {
    await open();
    await openProject();
    fireEvent.click(screen.getByRole('button', { name: 'Задача' }));
    const d = within(await screen.findByRole('dialog', { name: 'Новая задача' }, SLOW));
    fireEvent.change(d.getByLabelText(/^Описание/), { target: { value: 'а'.repeat(5001) } });
    expect(d.getByText('5001 / 5000')).toBeTruthy();
  });

  it('сбой загрузки после создания: тост «Задача … создана», затем «Не прикреплено: …» (Q-W4.12-6)', async () => {
    const a = await open();
    await openProject();
    fireEvent.click(screen.getByRole('button', { name: 'Задача' }));
    const d = within(await screen.findByRole('dialog', { name: 'Новая задача' }, SLOW));
    fireEvent.change(d.getByLabelText('Тема *'), { target: { value: 'Купить антифриз' } });
    fireEvent.change(d.getByLabelText('Выбрать файлы'), {
      target: { files: [fileOf('Акт.pdf', 'application/pdf', 1024)] },
    });
    a.scenario.setScenario('initiateUpload=offline');
    fireEvent.click(d.getByRole('button', { name: 'Создать' }));
    await toastIs('Задача LOG-101 создана');
    await waitFor(() => expect(toast()).toBe(`Не прикреплено: Акт.pdf — ${OFFLINE}`), AFTER_TOAST);
  }, 20_000);

  it('карточка: сбой загрузки файла — «Не прикреплено: {имя} — {причина}», attachTaskFiles не вызывается', async () => {
    const a = await open();
    await openProject();
    const c = await openCard('Найти водителя на рейс Р-211');
    a.scenario.setScenario('initiateUpload=offline');
    fireEvent.change(within(c).getByLabelText('Прикрепить файлы'), {
      target: { files: [fileOf('Акт.pdf', 'application/pdf', 2048)] },
    });
    await toastIs(`Не прикреплено: Акт.pdf — ${OFFLINE}`);
    expect(
      a.responses().some((r) => r.method === 'POST' && /\/tasks\/[^/]+\/files$/.test(r.path)),
    ).toBe(false);
  });
});
