// W4.12 · Помощники e2e «Задач и проектов» (`tasks-projects`, `tasks-project-new`, `tasks-board`, `modal-new-task`,
// `tasks-card`; эталон design-2026-10-19 «Задачи и проекты.dc.html»): вход персонажа, страница `tasks` организации,
// проект LOG «Логистика · Север» сида W4.10 (MSW W4.03), карточка задачи, хранилище mock для вложений.
import type { Persona } from '@ortus/e2e-kit';
import { expect, type Locator, type Page } from '@playwright/test';

import type { Session, Undo } from './_stand/fixtures.ts';
import { openPage, toast } from './modules.helpers.ts';
import { call, devScenario, type Reply, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/** Хост билета загрузки сценарного сервера (adapter/src/msw/files). */
const STORAGE = 'https://storage.example.invalid/**';

export const LOG = 'Логистика · Север';
export const LEADS = 'Заявки · Ремонт';
export const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
export const T65 = 'Заменить шины на ГАЗон Next (зимние)';
export const T66 = 'Подготовить парк к зиме';
export const T58 = 'Записать ГАЗон Next на плановое ТО';
export const T64 = 'Найти водителя на рейс Р-211';

export { toast };

/** Корень страницы «Задачи». */
export const root = (page: Page): Locator => page.locator('.ox-tasks');
/** Таблица проектов. */
export const projectRows = (page: Page): Locator => root(page).locator('.ox-tk-prow');
export const projectRow = (page: Page, name: string): Locator =>
  projectRows(page).filter({ hasText: name });
/** Панель «Новый проект». */
export const wizard = (page: Page): Locator => root(page).locator('.ox-tk-wiz');
/** Вкладки проекта. */
export const tabs = (page: Page): Locator =>
  root(page).getByRole('tablist', { name: 'Разделы проекта' });
export const tab = (page: Page, name: string): Locator => tabs(page).getByRole('tab', { name });
/** Колонки доски: имя (заглавными по CSS) и счётчик. */
export const columns = (page: Page): Locator => root(page).locator('.ox-tk-col');
export const column = (page: Page, name: string): Locator =>
  columns(page).filter({
    has: page.locator('.ox-tk-col-name', { hasText: new RegExp(`^${name}$`) }),
  });
/** Карточка задачи на доске по теме. */
export const boardCard = (page: Page, title: string): Locator =>
  root(page).locator('.ox-tk-kcard').filter({ hasText: title });
/** Фильтры доски. */
export const filter = (page: Page, name: string | RegExp): Locator =>
  root(page).locator('.ox-tk-filters').getByRole('button', { name });
/** Боковая карточка задачи. */
export const card = (page: Page): Locator => root(page).locator('.ox-tk-card');
/** Диалог «Новая задача». */
export const newTask = (page: Page): Locator => page.getByRole('dialog', { name: 'Новая задача' });

/** «Задачи» организации по прямому URL (`search` — параметры адреса). */
export async function openTasks(
  app: AppFn,
  page: Page,
  o: { persona?: Persona; search?: string; tenant?: string } = {},
): Promise<string> {
  await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  const id = await openPage(app, page, `tasks${o.search ?? ''}`, {
    persona: o.persona ?? 'owner',
    ...(o.tenant ? { tenant: o.tenant } : {}),
  });
  return id;
}

/** Список проектов загружен. */
export async function projectsReady(page: Page): Promise<void> {
  await expect(root(page).getByRole('heading', { level: 2, name: 'Проекты' })).toBeVisible({
    timeout: 15_000,
  });
}

/** Открыть проект из списка и дождаться доски. */
export async function openProject(page: Page, name = LOG): Promise<void> {
  await projectsReady(page);
  await projectRow(page, name).click();
  await expect(tab(page, 'Доска')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await expect(columns(page).first()).toBeVisible({ timeout: 15_000 });
}

/** Открыть карточку задачи на доске. */
export async function openCard(page: Page, title: string): Promise<void> {
  await boardCard(page, title).click();
  await expect(card(page).getByRole('heading', { level: 3, name: title })).toBeVisible({
    timeout: 15_000,
  });
}

/** Сценарий сценарного сервера (только mock). */
export const scenario = (page: Page, s: string | null): Promise<void> =>
  devScenario(page, { scenario: s });

/** Завершает проверку загруженных файлов (dev-маршрут `scanFiles`). */
export async function scanFiles(page: Page): Promise<void> {
  await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
}

/**
 * Роль участника в проекте `project` (setTaskProjectMemberRole от имени текущего входа — владельца): «Наблюдатель» —
 * только чтение задач. Состояние сценарного сервера сохраняется при смене персонажа.
 */
export async function setProjectRole(
  page: Page,
  tenant: string,
  member: string,
  role: string,
  project = LOG,
): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/projects`;
  const list = (await call(page, 'GET', base)).body as { items: { id: string; name: string }[] };
  const p = list.items.find((x) => x.name === project);
  if (!p) throw new Error(`нет проекта «${project}»`);
  const head = await call(page, 'GET', `${base}/${p.id}`);
  const ms = (await call(page, 'GET', `${base}/${p.id}/members`)).body as {
    items: { memberId: string; displayName: string }[];
    roles: { roleId: string; name: string }[];
  };
  const m = ms.items.find((x) => x.displayName === member);
  const r = ms.roles.find((x) => x.name === role);
  if (!m || !r) throw new Error(`нет участника «${member}» или роли «${role}» в «${project}»`);
  const res = await call(page, 'PUT', `${base}/${p.id}/members/${m.memberId}`, {
    body: { roleId: r.roleId },
    ...(head.headers.etag ? { ifMatch: head.headers.etag } : {}),
  });
  if (res.status !== 200) throw new Error(`setTaskProjectMemberRole ${res.status}`);
}

/** Tab до элемента (не больше `max` нажатий); true — элемент в фокусе. */
export async function tabTo(page: Page, target: Locator, max = 80): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return true;
  }
  return false;
}

/** Видимая рамка фокуса у элемента: outline или box-shadow. */
export const ringVisible = (el: Locator): Promise<boolean> =>
  el.evaluate((x) => {
    const s = getComputedStyle(x);
    return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
  });

/** PDF в 1 КБ для выбора файла. */
export const PDF = { name: 'Акт.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1024, 37) };
/** Пустой файл. */
export const EMPTY = { name: 'Пустой.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) };
/** Файл недопустимого типа. */
export const EXE = {
  name: 'setup.exe',
  mimeType: 'application/x-msdownload',
  buffer: Buffer.alloc(64, 1),
};

/** Телефон: ширина окна меньше 640 px. */
export const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 640;

// W4.74 (Q-W4.12-17) · Данные строк @stand на прогон: стенд один на три ширины (и повторы), поэтому строка не
// берёт одноразовое из сида (T-65 согласуется один раз, название и ключ проекта уникальны в организации).
// Что прогон оставляет на стенде: удалять задачи и проекты контракт W4.03 не умеет (нет deleteTask и
// deleteTaskProject), поэтому каждый прогон добавляет задачу в LOG (LOG-101, LOG-102… — «Готово», а при падении
// уборка approvalTask переводит её в «Отменена») и проект «Стенд · проверка S…». Темы и названия таких данных
// начинаются с STAND_MARK: строка @stand, которая считает карточки доски LOG или проекты стенда, отбрасывает их по
// этой метке (или считает на свежем стенде).

/** Метка данных строк @stand на прогон — начало темы задачи и названия проекта. */
export const STAND_MARK = 'Стенд · ';

/**
 * Суффикс прогона: base36 миллисекунд по модулю 36⁵, 5 заглавных знаков (`n` — сдвиг для следующего кандидата).
 * Повторяется раз в ~16,8 ч — для ключа проекта уникальность проверяет freeProjectKey.
 */
export const standSuffix = (n = 0): string =>
  ((Date.now() + n) % 36 ** 5).toString(36).padStart(5, '0').toUpperCase();

const ok = (r: Reply, what: string): Reply => {
  if (r.status >= 300) throw new Error(`${what} ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
};

/**
 * Свободный ключ проекта `S<суффикс>` (шаблон ключа ^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]{1,5}$): ключи всех проектов, видимых
 * текущему входу (listTaskProjects по всем страницам), исключаются. Проекты строки создаёт владелец, он же их
 * руководитель — они в списке, поэтому повтор суффикса через ~16,8 ч ключ не займёт.
 */
export async function freeProjectKey(page: Page): Promise<string> {
  const base = `/api/v1/tenants/${await tenantId(page)}/projects`;
  const taken = new Set<string>();
  let cursor: string | null | undefined;
  do {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const body = ok(await call(page, 'GET', base + q), 'listTaskProjects').body as {
      items: { key: string }[];
      nextCursor?: string | null;
    };
    for (const p of body.items) taken.add(p.key);
    cursor = body.nextCursor;
  } while (cursor);
  for (let n = 0; n < 100; n++) {
    const key = `S${standSuffix(n)}`;
    if (!taken.has(key)) return key;
  }
  throw new Error('нет свободного ключа S<суффикс> среди 100 кандидатов');
}

interface StandTask {
  id: string;
  statusName?: string;
  statusCategory?: string;
  availableTransitions?: { key: string; name: string; allowed: boolean; reasonText?: string }[];
}

/**
 * Своя задача на согласование на стенде: Марина Котова — руководитель LOG (сид access.go ap1) — в своей сессии
 * создаёт в «Логистика · Север» (процесс «С согласованием») задачу `title` и проводит её «Взять в работу» →
 * «На проверку» (transitionTask, If-Match по ETag getTask). Согласует владелец — согласующий и не автор.
 * Уборка (`undo`, регистрируется сразу после создания): если задача прогона не завершена (категория статуса не
 * done — прогон упал до «Согласовать» или между переходами), Котова переводит её «Отменить» с комментарием в
 * «Отменена». Возвращает «выполнить уборку сейчас».
 */
export async function approvalTask(
  session: () => Promise<Session>,
  title: string,
  undo: Undo,
): Promise<() => Promise<void>> {
  const s = await session();
  await s.open('/', 'manager');
  const tenant = await tenantId(s.page);
  const base = `/api/v1/tenants/${tenant}`;
  const list = ok(await call(s.page, 'GET', `${base}/projects`), 'listTaskProjects').body as {
    items: { id: string; name: string }[];
  };
  const project = list.items.find((x) => x.name === LOG);
  if (!project) throw new Error(`нет проекта «${LOG}»`);
  const created = ok(
    await call(s.page, 'POST', `${base}/tasks`, { body: { projectId: project.id, title } }),
    'createTask',
  ).body as StandTask;
  const move = async (name: string, comment?: string): Promise<void> => {
    const cur = ok(await call(s.page, 'GET', `${base}/tasks/${created.id}`), 'getTask');
    const task = cur.body as StandTask;
    if (comment !== undefined && task.statusCategory === 'done') return;
    const tr = task.availableTransitions?.find((x) => x.name === name);
    if (!tr?.allowed) throw new Error(`«${name}» недоступен: ${tr?.reasonText ?? 'нет перехода'}`);
    ok(
      await call(s.page, 'POST', `${base}/tasks/${created.id}/transitions`, {
        body: { transitionKey: tr.key, ...(comment !== undefined ? { comment } : {}) },
        ifMatch: cur.headers.etag ?? '',
      }),
      `transitionTask «${name}»`,
    );
  };
  const cleanup = undo(`«${title}» — «Отменена», если прогон не довёл до «Готово»`, () =>
    move('Отменить', 'Уборка e2e: прогон @stand не довёл задачу до согласования.'),
  );
  for (const name of ['Взять в работу', 'На проверку']) await move(name);
  return cleanup;
}
