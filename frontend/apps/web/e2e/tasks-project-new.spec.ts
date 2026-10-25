// W4.12 · e2e экрана `tasks-project-new` — панель «Новый проект» (эталон design-2026-10-19 «Задачи и проекты.dc.html»
// ЗП:48–71, 356–373, autoKey :524; разбор tasks.md §1.3). Создание — createTaskProject сценарного сервера W4.03
// (тексты отказов эталона api.js:644–659); после создания открывается вкладка «Участники» (W4.13).
import { expect, test } from './_stand/fixtures.ts';
import { hitHeight } from './modules.helpers.ts';
import {
  freeProjectKey,
  LOG,
  OFFLINE,
  openTasks,
  phone,
  projectRow,
  projectsReady,
  root,
  scenario,
  STAND_MARK,
  tab,
  toast,
  wizard,
} from './tasks.helpers.ts';

const SIMPLE =
  'Новая → В работе → На проверке → Готово. «Принять» и «Вернуть» — у руководителя проекта.';
const APPROVAL =
  'Новая → В работе → На проверке → Готово. «Согласовать»: достаточно одного согласующего, автор свою не согласует, при отказе — «В работе».';
const COPY =
  'Статусы и переходы копируются один раз и дальше меняются независимо. Правила автоматизации копируются выключенными.';

test.describe('tasks-project-new — «Новый проект» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(90_000);

  test.beforeEach(async ({ app, page }) => {
    await openTasks(app, page);
    await projectsReady(page);
    await root(page).getByRole('button', { name: 'Новый проект' }).click();
    await expect(
      wizard(page).getByRole('heading', { level: 3, name: 'Новый проект' }),
    ).toBeVisible();
  });

  test('панель: поля, ключ по названию, подсказка номеров, область, доступ «Ограниченный», процесс', async ({
    page,
  }) => {
    const w = wizard(page);
    await expect(w.getByLabel('Название')).toHaveAttribute(
      'placeholder',
      'Например, «Ремонт · ЖК Речной»',
    );
    await expect(w).toContainText('Номера задач: КЛЮЧ-101, КЛЮЧ-102… Ключ уникален в организации.');
    await w.getByLabel('Название').fill('Ремонт · ЖК Речной');
    await expect(w.getByLabel('Ключ')).toHaveValue('РЖР');
    await expect(w).toContainText('Номера задач: РЖР-101, РЖР-102… Ключ уникален в организации.');
    await expect(w.getByLabel('Область проекта').locator('option')).toContainText([
      'Вся организация',
    ]);
    await expect(w).toContainText(
      'Роли, выданные в этой области, действуют в проекте по уровню доступа.',
    );
    const access = w.getByRole('radiogroup', { name: 'Кто видит проект' });
    await expect(access.getByRole('radio')).toHaveCount(3);
    await expect(access.getByRole('radio', { name: /Ограниченный/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(access.getByRole('radio', { name: /Закрытый/ })).toContainText(
      'Только участники проекта',
    );
    const proc = w.getByRole('group', { name: 'Процесс' });
    await expect(proc.getByRole('button')).toHaveText([
      'Простой',
      'С согласованием',
      'Копия проекта',
    ]);
    await expect(w).toContainText(SIMPLE);
    await proc.getByRole('button', { name: 'С согласованием' }).click();
    await expect(w).toContainText(APPROVAL);
    await proc.getByRole('button', { name: 'Копия проекта' }).click();
    await expect(w).toContainText(COPY);
    await expect(w.getByLabel('Проект-образец')).toContainText('LOG · Логистика · Север · v1');
    await expect(w).toContainText('Вы станете руководителем проекта.');
  });

  test('ошибки сервера в форме: короткое название, занятый ключ, неверный ключ', async ({
    page,
  }) => {
    const w = wizard(page);
    await w.getByLabel('Название').fill('Ок');
    await w.getByRole('button', { name: 'Создать проект' }).click();
    await expect(w.getByRole('alert')).toHaveText('Название — не короче 3 символов');
    await w.getByLabel('Название').fill('Логистика · Юг');
    await w.getByLabel('Ключ').fill('LOG');
    await w.getByRole('button', { name: 'Создать проект' }).click();
    await expect(w.getByRole('alert')).toHaveText('Ключ LOG уже занят');
    await w.getByLabel('Ключ').fill('1AB');
    await expect(w.getByLabel('Ключ')).toHaveValue('1AB');
    await expect(w.getByRole('alert')).toHaveCount(0);
    await w.getByRole('button', { name: 'Создать проект' }).click();
    await expect(w.getByRole('alert')).toHaveText(
      'Ключ — 2–6 заглавных букв или цифр, первая — буква',
    );
  });

  test('создание: тост «Проект «X» создан», открывается проект на «Участниках»; в списке — новая строка', async ({
    page,
  }) => {
    const w = wizard(page);
    await w.getByLabel('Название').fill('Ремонт · ЖК Речной');
    await w.getByRole('radio', { name: /Закрытый/ }).click();
    await w.getByRole('button', { name: 'Создать проект' }).click();
    await expect(toast(page)).toHaveText('Проект «Ремонт · ЖК Речной» создан');
    await expect(tab(page, 'Участники')).toHaveAttribute('aria-selected', 'true');
    await expect(root(page)).toContainText('закрытый проект · процесс v1');
    await expect(root(page)).toContainText('Вы: Руководитель проекта');
    await root(page).getByRole('button', { name: 'Проекты', exact: true }).click();
    await expect(projectRow(page, 'Ремонт · ЖК Речной').locator('.ox-tk-key')).toHaveText('РЖР');
    await expect(projectRow(page, 'Ремонт · ЖК Речной')).toContainText('Закрытый');
  });

  test('«Отмена» и «Закрыть» убирают панель; копия процесса LOG создаётся', async ({ page }) => {
    await wizard(page).getByRole('button', { name: 'Отмена' }).click();
    await expect(wizard(page)).toHaveCount(0);
    await expect(root(page).getByRole('button', { name: 'Новый проект' })).toBeFocused();
    await root(page).getByRole('button', { name: 'Новый проект' }).click();
    await wizard(page).getByRole('button', { name: 'Закрыть' }).click();
    await expect(wizard(page)).toHaveCount(0);
    await expect(root(page).getByRole('button', { name: 'Новый проект' })).toBeFocused();
    await root(page).getByRole('button', { name: 'Новый проект' }).click();
    await wizard(page).getByLabel('Название').fill('Логистика · Юг');
    await wizard(page)
      .getByRole('group', { name: 'Процесс' })
      .getByRole('button', { name: 'Копия проекта' })
      .click();
    await wizard(page).getByRole('button', { name: 'Создать проект' }).click();
    await expect(toast(page)).toHaveText('Проект «Логистика · Юг» создан');
    await expect(projectRow(page, LOG)).toHaveCount(0);
  });

  test('нет связи при создании — текст в форме, без второго тоста (возврат 1)', async ({
    page,
  }) => {
    await wizard(page).getByLabel('Название').fill('Ремонт · ЖК Речной');
    await scenario(page, 'createTaskProject=offline');
    await wizard(page).getByRole('button', { name: 'Создать проект' }).click();
    await expect(wizard(page).getByRole('alert')).toHaveText(OFFLINE);
    expect(await toast(page).count()).toBe(0);
    await scenario(page, null);
  });
  test('390: панель под списком, цели не меньше 44 px', async ({ page }) => {
    if (!phone(page)) return;
    const w = wizard(page);
    expect(
      await hitHeight(w.getByRole('button', { name: 'Создать проект' })),
    ).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(w.getByRole('button', { name: 'Закрыть' }))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(w.getByRole('radio', { name: /Открытый/ }))).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(
        w.getByRole('group', { name: 'Процесс' }).getByRole('button', { name: 'Простой' }),
      ),
    ).toBeGreaterThanOrEqual(44);
  });

  test('axe без serious на открытой панели', async ({ page, axe }) => {
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
  });
});

test.describe('tasks-project-new — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  // W4.74 (Q-W4.12-17): название и ключ уникальны на прогон — три ширины подряд на одном стенде; ключ — свободный
  // среди проектов стенда (freeProjectKey). Проект остаётся на стенде (удаления в контракте нет, tasks.helpers.ts).
  test('владелец на стенде создаёт проект со своим названием и ключом (W4.11)', async ({
    app,
    page,
  }) => {
    test.slow();
    await openTasks(app, page);
    await projectsReady(page);
    const key = await freeProjectKey(page);
    const name = `${STAND_MARK}проверка ${key}`;
    await root(page).getByRole('button', { name: 'Новый проект' }).click();
    const w = wizard(page);
    await w.getByLabel('Название').fill(name);
    await w.getByLabel('Ключ').fill(key);
    await expect(w).toContainText(
      `Номера задач: ${key}-101, ${key}-102… Ключ уникален в организации.`,
    );
    await w.getByRole('button', { name: 'Создать проект' }).click();
    await expect(toast(page)).toHaveText(`Проект «${name}» создан`, { timeout: 15_000 });
    // Стенд общий и под нагрузкой: проект после создания загружается дольше 5 с (прогон 24.10 на 768).
    await expect(tab(page, 'Участники')).toHaveAttribute('aria-selected', 'true', {
      timeout: 15_000,
    });
    await root(page).getByRole('button', { name: 'Проекты', exact: true }).click();
    await expect(projectRow(page, name).locator('.ox-tk-key')).toHaveText(key, {
      timeout: 15_000,
    });
  });
});
