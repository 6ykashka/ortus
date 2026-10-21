// W4.12 · e2e диалога `modal-new-task` «Новая задача» (эталон design-2026-10-19 «Задачи и проекты.dc.html»
// ЗП:97–126, 393–410, pickFiles :517–521; разбор tasks.md §1.3). Создание — createTask, затем загрузка каждого
// файла (initiateUpload purpose task_attachment с владельцем tasks/task, PUT в хранилище mock, completeUpload) и
// attachTaskFiles (Q-W4.02-10).
import { expect, test } from './_stand/fixtures.ts';
import { hitHeight } from './modules.helpers.ts';
import {
  card,
  EMPTY,
  EXE,
  newTask,
  OFFLINE,
  openProject,
  openTasks,
  PDF,
  phone,
  ringVisible,
  root,
  scenario,
  tabTo,
  toast,
} from './tasks.helpers.ts';

/** Открыть диалог кнопкой «Задача» на доске LOG. */
async function openDialog(
  app: Parameters<typeof openTasks>[0],
  page: Parameters<typeof openTasks>[1],
): Promise<void> {
  await openTasks(app, page);
  await openProject(page);
  await root(page).getByRole('button', { name: 'Задача', exact: true }).click();
  await expect(newTask(page)).toBeVisible();
}

test.describe('modal-new-task — «Новая задача» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(90_000);

  test('поля диалога: проект, статус «Новая», «Входит в», тема, описание со счётчиком, вложения, исполнитель', async ({
    app,
    page,
  }) => {
    await openDialog(app, page);
    const d = newTask(page);
    await expect(d).toContainText('Обязательные поля отмечены *');
    await expect(d.getByLabel('Проект *')).toHaveValue(/.+/);
    await expect(d.getByLabel('Проект *').locator('option:checked')).toHaveText(
      'LOG · Логистика · Север',
    );
    await expect(d.locator('.ox-tk-nf-status')).toHaveText('Новая');
    await expect(d.getByLabel('Входит в задачу').locator('option').first()).toHaveText(
      'Не входит — самостоятельная задача',
    );
    await expect(d.getByLabel('Входит в задачу')).toContainText('T-66 · Подготовить парк к зиме');
    await expect(d.getByLabel('Тема *')).toHaveAttribute(
      'placeholder',
      'Коротко: что нужно сделать',
    );
    await d.getByLabel('Описание').fill('Проверить уровень');
    await expect(d).toContainText('17 / 5000');
    await expect(d).toContainText('Перетащите файлы сюда или выберите на устройстве');
    await expect(d).toContainText('Фото, PDF, документы Office, текст · до 20 МБ каждый');
    await expect(d.getByLabel('Исполнитель').locator('option:checked')).toHaveText('Дарья Зимина');
    await expect(d.getByLabel('Исполнитель')).toContainText('Марина Котова');
    await expect(d.getByLabel('Приоритет').locator('option')).toHaveText([
      'Срочно',
      'Высокий',
      'Обычный',
      'Низкий',
    ]);
    await expect(d.getByLabel('Метки')).toHaveAttribute(
      'placeholder',
      'Через запятую: шины, закупка',
    );
  });

  test('тема короче 3 символов — ошибка в форме и красная рамка; плохие файлы — «Не прикрепится»', async ({
    app,
    page,
  }) => {
    await openDialog(app, page);
    const d = newTask(page);
    await d.getByLabel('Тема *').fill('Ок');
    await d.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(d.getByRole('alert')).toHaveText('Тема — не короче 3 символов');
    await expect(d.getByLabel('Тема *')).toHaveAttribute('aria-invalid', 'true');
    await d.getByLabel('Тема *').fill('Купить антифриз');
    await d.getByLabel('Выбрать файлы').setInputFiles([EMPTY, EXE]);
    await expect(d).toContainText('Не прикрепится: пустой файл');
    await expect(d).toContainText('Не прикрепится: такой тип не принимаем');
    await d.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(d.getByRole('alert')).toHaveText(
      'Уберите файлы, которые не прикрепятся: Пустой.txt, setup.exe',
    );
    await d.getByRole('button', { name: 'Убрать Пустой.txt' }).click();
    await d.getByRole('button', { name: 'Убрать setup.exe' }).click();
    await expect(d.getByRole('alert')).toHaveCount(0);
  });

  test('создание с вложением: тост «Задача LOG-101 создана», карточка с файлом «Вложения · 1»', async ({
    app,
    page,
  }) => {
    await openDialog(app, page);
    const d = newTask(page);
    await d.getByLabel('Тема *').fill('Купить антифриз');
    await d.getByLabel('Описание').fill('Две канистры по 5 л');
    await d.getByLabel('Выбрать файлы').setInputFiles([PDF]);
    await expect(d).toContainText('Акт.pdf');
    await expect(d).toContainText('1 КБ');
    await d.getByLabel('Приоритет').selectOption({ label: 'Высокий' });
    await d.getByLabel('Метки').fill('Зима, закупка');
    await d.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(toast(page)).toHaveText('Задача LOG-101 создана', { timeout: 15_000 });
    await expect(newTask(page)).toHaveCount(0);
    const c = card(page);
    await expect(c.getByRole('heading', { level: 3, name: 'Купить антифриз' })).toBeVisible();
    await expect(c).toContainText('Вложения · 1');
    await expect(c).toContainText('Акт.pdf');
    await expect(c).toContainText('Две канистры по 5 л');
    await expect(c.locator('.ox-tk-label')).toHaveText(['зима', 'закупка']);
  });

  test('«Создать ещё одну»: форма остаётся, тема, описание и метки очищены, исполнитель сохранён', async ({
    app,
    page,
  }) => {
    await openDialog(app, page);
    const d = newTask(page);
    await d.getByLabel('Создать ещё одну').check();
    await d.getByLabel('Исполнитель').selectOption({ label: 'Марина Котова' });
    await d.getByLabel('Тема *').fill('Первая задача');
    await d.getByLabel('Метки').fill('шины');
    await d.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(toast(page)).toHaveText('Задача LOG-101 создана');
    await expect(d).toBeVisible();
    await expect(d.getByLabel('Тема *')).toHaveValue('');
    await expect(d.getByLabel('Метки')).toHaveValue('');
    await expect(d.getByLabel('Исполнитель').locator('option:checked')).toHaveText('Марина Котова');
    await d.getByLabel('Тема *').fill('Вторая задача');
    await d.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(toast(page)).toHaveText('Задача LOG-102 создана');
  });

  test('«Назначить меня», Escape и «Отмена» закрывают диалог; фокус возвращается', async ({
    app,
    page,
  }) => {
    await openDialog(app, page);
    const d = newTask(page);
    await d.getByLabel('Исполнитель').selectOption({ label: 'Марина Котова' });
    await d.getByRole('button', { name: 'Назначить меня' }).click();
    await expect(d.getByLabel('Исполнитель').locator('option:checked')).toHaveText('Дарья Зимина');
    await page.keyboard.press('Escape');
    await expect(newTask(page)).toHaveCount(0);
    await expect(root(page).getByRole('button', { name: 'Задача', exact: true })).toBeFocused();
    await root(page).getByRole('button', { name: 'Задача', exact: true }).click();
    await newTask(page).getByRole('button', { name: 'Отмена' }).click();
    await expect(newTask(page)).toHaveCount(0);
  });

  // Возврат 1: клавиатура, нет связи, отказы сервера, сбой загрузки (verification-protocol §1 п. 3).
  test('клавиатура: Tab по диалогу до «Выбрать файлы» — фокус виден на зоне; Escape — фокус на «Задача»', async ({
    app,
    page,
  }) => {
    await openDialog(app, page);
    const d = newTask(page);
    expect(await tabTo(page, d.getByLabel('Тема *'), 20)).toBe(true);
    expect(await ringVisible(d.getByLabel('Тема *'))).toBe(true);
    expect(await tabTo(page, d.getByLabel('Выбрать файлы'), 20)).toBe(true);
    expect(await ringVisible(d.locator('.ox-tk-drop'))).toBe(true);
    expect(await tabTo(page, d.getByRole('button', { name: 'Создать', exact: true }), 30)).toBe(
      true,
    );
    expect(await ringVisible(d.getByRole('button', { name: 'Создать', exact: true }))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(root(page).getByRole('button', { name: 'Задача', exact: true })).toBeFocused();
  });

  test('нет связи и отказы сервера (403, 429) — текст в форме, тоста нет, диалог открыт', async ({
    app,
    page,
  }) => {
    await openDialog(app, page);
    const d = newTask(page);
    await d.getByLabel('Тема *').fill('Купить антифриз');
    const create = d.getByRole('button', { name: 'Создать', exact: true });
    await scenario(page, 'createTask=offline');
    await create.click();
    await expect(d.getByRole('alert')).toHaveText(OFFLINE);
    expect(await toast(page).count()).toBe(0);
    await scenario(page, 'createTask=rate_limited');
    await create.click();
    await expect(d.getByRole('alert')).toHaveText('Слишком много запросов. Подождите и повторите.');
    await scenario(page, 'createTask=forbidden_action');
    await create.click();
    await expect(d.getByRole('alert')).not.toHaveText(
      'Слишком много запросов. Подождите и повторите.',
    );
    await expect(d.getByRole('alert')).toHaveText(/.+/);
    expect(await toast(page).count()).toBe(0);
    await scenario(page, null);
    await expect(newTask(page)).toBeVisible();
    await create.click();
    await expect(toast(page)).toHaveText('Задача LOG-101 создана', { timeout: 15_000 });
  });

  test('сбой загрузки файла после создания: тост «Задача … создана», затем «Не прикреплено: …»', async ({
    app,
    page,
  }) => {
    await openDialog(app, page);
    const d = newTask(page);
    await d.getByLabel('Тема *').fill('Купить антифриз');
    await d.getByLabel('Выбрать файлы').setInputFiles([PDF]);
    await scenario(page, 'initiateUpload=offline');
    await d.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(toast(page)).toHaveText('Задача LOG-101 создана', { timeout: 15_000 });
    await expect(toast(page)).toHaveText(`Не прикреплено: Акт.pdf — ${OFFLINE}`, {
      timeout: 10_000,
    });
    await scenario(page, null);
    await expect(card(page)).toContainText('Вложения · 0');
  });

  test('390: диалог на всю ширину, цели не меньше 44 px; axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    await openDialog(app, page);
    const d = newTask(page);
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    if (!phone(page)) return;
    expect(
      await hitHeight(d.getByRole('button', { name: 'Создать', exact: true })),
    ).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(d.getByRole('button', { name: 'Закрыть' }))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(d.getByLabel('Тема *'))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(d.locator('.ox-tk-more'))).toBeGreaterThanOrEqual(44);
  });
});

test.describe('modal-new-task — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('создание задачи с вложением на стенде (W4.11, MinIO)', async ({ app, page }) => {
    test.slow();
    await openDialog(app, page);
    await newTask(page).getByLabel('Тема *').fill('Купить антифриз');
    await newTask(page).getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(toast(page)).toHaveText(/Задача LOG-\d+ создана/);
  });
});
