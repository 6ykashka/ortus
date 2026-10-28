// W7.25 · e2e страницы `docs-doc` «Карточка документа» — оболочка, меню «…», «Обсуждение», «Версии», «Данные» таблицы,
// «Распознавание» и «Преобразовать» PDF, «Перенести». Эталон design-2026-10-19 «Документы.dc.html» :110–553
// (documents.md §1.3–§1.7). Редактор — движок (D-32): без него «Редактор подключается» (Q-W4.00-documents-1).
// Режим mock — MSW Docs W7.00 на сиде «Альты». Режим stand — backend W7.23 (@stand, W2.103).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { memberIdByEmail, startRoute, textDoc } from './docs.stand.ts';
import { dialog, h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { tenantId } from './shell.helpers.ts';

const STORAGE = 'https://storage.example.invalid/**';

type Persona = 'owner' | 'manager' | 'driver' | 'foreman';

const card = (page: Page): Locator => page.locator('section.ox-docs-doc');
const panel = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Панель документа' });
const menuButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Действия с документом' });

async function openDoc(
  app: Parameters<typeof openPage>[0],
  page: Page,
  title: string,
  persona: Persona = 'owner',
): Promise<string> {
  const tenant = await openPage(app, page, 'docs', { persona });
  await expect(h1(page, 'Документы')).toBeVisible({ timeout: 15_000 });
  await page.locator('button.ox-docs-row').filter({ hasText: title }).click();
  await expect(h1(page, title)).toBeVisible({ timeout: 15_000 });
  return tenant;
}

const tab = (page: Page, name: string | RegExp): Locator => panel(page).getByRole('tab', { name });

test.describe('docs-doc — «Документ», карточка @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  });

  test('оболочка договора на маршруте: крошки, статус, «Сохранено на сервере», «Редактор подключается», поля CRM', async ({
    app,
    page,
  }) => {
    await openDoc(app, page, 'Договор подряда № 42/26');
    const c = card(page);
    await expect(page).toHaveURL(/[?&]doc=/);
    await expect(c).toContainText('Документы › Ремонт и стройка › ЖК Речной · квартира 42');
    await expect(c).toContainText(/Сохранено на сервере · v3 · /);
    await expect(c).toContainText('Согласование · 0 из 1');
    await expect(c.getByRole('button', { name: /^Поделиться · / })).toBeVisible();
    await expect(
      c.getByText('v3 на согласовании: правка закрыта до решения. Комментировать можно.'),
    ).toBeVisible();
    await expect(c.getByRole('region', { name: 'Редактор подключается' })).toContainText(
      'Правку документа ведёт встроенный движок',
    );
    await expect(c.getByText(/^Ортус передаёт движку права: правка — нет/)).toBeVisible();
    const fields = c.getByRole('region', { name: 'Поля CRM · 3' });
    await expect(fields).toContainText('Заказчик');
    await expect(fields).toContainText('Ольга Смирнова');
    await expect(fields).toContainText(
      'Значения меняются вместе с записями CRM. При утверждении фиксируются в версии.',
    );
    await expect(c.getByRole('region', { name: 'Связи' })).toContainText('ЖК Речной · квартира 42');
    await c.getByRole('button', { name: 'К списку документов' }).click();
    await expect(page).not.toHaveURL(/doc=/);
    await expect(h1(page, 'Документы')).toBeVisible();
  });

  test('переименование на месте: Escape, слишком короткое название, Enter', async ({
    app,
    page,
  }) => {
    await openDoc(app, page, 'Регламент приёмки смены');
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Переименовать' }).click();
    const input = page.getByRole('textbox', { name: 'Название документа' });
    await expect(input).toBeFocused();
    await input.fill('Регламент приёмки смены · черновик');
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(h1(page, 'Регламент приёмки смены')).toBeVisible();
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Переименовать' }).click();
    await input.fill('Р');
    await page.keyboard.press('Enter');
    await expect(card(page).getByRole('alert')).toContainText('Название — не короче 2 символов');
    await input.fill('Регламент приёмки смены v2');
    await page.keyboard.press('Enter');
    await expect(toast(page)).toHaveText('Переименовано');
    await expect(h1(page, 'Регламент приёмки смены v2')).toBeVisible();
  });

  test('раскладка карточки следует ширине: data-w phone, tablet, wide; на телефоне окно документа не сжато', async ({
    app,
    page,
  }) => {
    await openDoc(app, page, 'Договор подряда № 42/26');
    const root = page.locator('.ox-docs[data-w]');
    for (const [w, h, name] of [
      [390, 844, 'phone'],
      [768, 900, 'tablet'],
      [1440, 900, 'wide'],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await expect(root).toHaveAttribute('data-w', name);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(root).toHaveAttribute('data-w', 'phone');
    const paper = await page.locator('.ox-docs-paper').boundingBox();
    expect(paper?.width ?? 0).toBeGreaterThan(300);
  });

  test('меню «…»: правка закрыта на маршруте, «Версии и журнал» и «Откуда доступ»', async ({
    app,
    page,
  }) => {
    await openDoc(app, page, 'Договор подряда № 42/26');
    await menuButton(page).click();
    await expect(page.getByRole('menu', { name: 'Действия с документом' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Переименовать' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Перенести в другую папку' })).toBeDisabled();
    await page.getByRole('menuitem', { name: 'Версии и журнал' }).click();
    await expect(page).toHaveURL(/[?&]tab=versions/);
    await expect(tab(page, 'Версии')).toHaveAttribute('aria-selected', 'true');
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Откуда доступ' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Поделиться' })).toBeVisible();
    await expect(d.getByRole('region', { name: 'Откуда доступ' })).toContainText('Итог');
  });

  test('«Экспорт в PDF» из меню: задание появляется во «Версиях» и завершается', async ({
    app,
    page,
  }) => {
    await openDoc(app, page, 'Регламент приёмки смены');
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Экспорт в PDF' }).click();
    await expect(toast(page)).toHaveText('Задание запущено');
    await expect(page).toHaveURL(/[?&]tab=versions/);
    const job = panel(page).locator('li.ox-docs-job').first();
    await expect(job).toContainText('В PDF');
    await expect(job).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
    await menuButton(page).click();
    await expect(page.getByRole('menuitem', { name: 'Скачать текст' })).toBeVisible();
  });

  test('меню закрывается по Escape, фокус возвращается на кнопку', async ({ app, page }) => {
    await openDoc(app, page, 'Регламент приёмки смены');
    await menuButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();
  });

  test('«Обсуждение»: упоминание без доступа, комментарий, ответ, закрытие', async ({
    app,
    page,
  }) => {
    await openDoc(app, page, 'Регламент приёмки смены');
    const p = panel(page);
    await expect(tab(page, /^Обсуждение/)).toHaveAttribute('aria-selected', 'true');
    const thread = p.locator('li.ox-docs-thread').first();
    await expect(thread).toContainText('Илья, проверьте п. 3');
    await expect(thread).toContainText('Илья Васильев не видит документ и не сможет ответить.');
    await thread.getByRole('button', { name: 'Дать «Комментирует»' }).click();
    await expect(toast(page)).toHaveText('Доступ «Комментирует» выдан');
    await expect(thread).not.toContainText('не видит документ');
    await p.getByRole('button', { name: 'Отправить' }).last().click();
    await expect(p.getByRole('alert')).toContainText('Напишите комментарий');
    await p.getByRole('textbox', { name: 'Комментарий' }).fill('Согласовано с логистикой');
    await p
      .getByRole('combobox', { name: 'Упомянуть…' })
      .selectOption({ label: 'Алексей Соколов' });
    await p.getByRole('button', { name: 'Отправить' }).last().click();
    await expect(toast(page)).toHaveText('Комментарий отправлен');
    const mine = p.locator('li.ox-docs-thread').filter({ hasText: 'Согласовано с логистикой' });
    await expect(mine).toContainText('Ко всему документу.');
    await expect(mine).toContainText('Алексей Соколов');
    await mine.getByRole('button', { name: 'Ответить' }).click();
    await mine.getByRole('textbox', { name: 'Ответ на комментарий' }).fill('Принято');
    await mine.getByRole('button', { name: 'Отправить' }).click();
    await expect(toast(page)).toHaveText('Ответ отправлен');
    await expect(mine.locator('.ox-docs-replies')).toContainText('Принято');
    await mine.getByRole('button', { name: 'Закрыть обсуждение' }).click();
    await expect(toast(page)).toHaveText('Обсуждение закрыто');
    await expect(mine).toContainText('Закрыто · ');
  });

  test('«Версии»: сохранить с названием, назвать, восстановить, журнал', async ({ app, page }) => {
    await openDoc(app, page, 'Расход топлива · октябрь 2026');
    await tab(page, 'Версии').click();
    const p = panel(page);
    await expect(p.locator('li.ox-docs-version')).toHaveCount(4);
    await expect(p.locator('li.ox-docs-version').first()).toContainText('v4');
    await p.getByRole('textbox', { name: 'Название версии' }).fill('Перед проверкой');
    await p.getByRole('button', { name: 'Сохранить версию' }).click();
    await expect(toast(page)).toHaveText('Версия сохранена');
    await expect(p.locator('li.ox-docs-version')).toHaveCount(5);
    await expect(p.locator('li.ox-docs-version').first()).toContainText('v5');
    await expect(p.locator('li.ox-docs-version').first()).toContainText('«Перед проверкой»');
    await p.getByRole('button', { name: 'Назвать v1' }).click();
    await p.getByRole('textbox', { name: 'Название версии 1' }).fill('Первая');
    await p.getByRole('button', { name: 'Назвать', exact: true }).click();
    await expect(toast(page)).toHaveText('Версия названа');
    await expect(p.locator('li.ox-docs-version').last()).toContainText('«Первая»');
    await p.getByRole('button', { name: 'Восстановить v2' }).click();
    await expect(toast(page)).toHaveText('Восстановлена v2 как v6');
    await expect(p.locator('li.ox-docs-version')).toHaveCount(6);
    await expect(p.getByRole('region', { name: 'Журнал документа' })).toContainText(
      'Восстановлена версия 2 как 6',
    );
    await expect(
      p.getByText(/^Новая версия создаётся, когда все выходят из документа/),
    ).toBeVisible();
  });

  test('таблица: «Данные» — обновить из CRM, защищённые диапазоны', async ({ app, page }) => {
    await openDoc(app, page, 'Расход топлива · октябрь 2026');
    await expect(tab(page, 'Данные')).toHaveAttribute('aria-selected', 'true');
    const p = panel(page);
    await expect(p.getByRole('region', { name: 'Защищённые диапазоны и листы' })).toContainText(
      'Норма · лист «Октябрь» · G3:G6',
    );
    await expect(p).toContainText('Правят: ');
    await p.getByRole('button', { name: 'Обновить' }).click();
    await expect(toast(page)).toHaveText('Данные из CRM обновлены: ячеек: 12');
    await tab(page, 'Версии').click();
    await expect(panel(page).locator('li.ox-docs-version').first()).toContainText(
      'Обновление из «Данных»',
    );
  });

  test('PDF-скан: «Распознавание», «Преобразовать» — задание завершается, результат появляется', async ({
    app,
    page,
  }) => {
    await openDoc(app, page, 'Накладная ТН-5581', 'manager');
    await expect(tab(page, 'Распознавание')).toHaveAttribute('aria-selected', 'true');
    const p = panel(page);
    await expect(p).toContainText('Текст распознан · 93 %');
    await expect(p).toContainText('Под вопросом 2 слова');
    await p.getByRole('button', { name: 'В Текст · DOCX' }).click();
    await expect(toast(page)).toHaveText('Задание запущено');
    const job = p.locator('li.ox-docs-job').first();
    await expect(job).toContainText('В Word');
    await expect(job).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
    await expect(job.getByRole('button', { name: 'Открыть' })).toBeVisible();
    await job.getByRole('button', { name: 'Открыть' }).click();
    await expect(h1(page, /^Накладная ТН-5581 · to_docx/)).toBeVisible({ timeout: 15_000 });
  });

  test('PDF с паролем: ошибка задания, неверный и верный пароль', async ({ app, page }) => {
    await openDoc(app, page, 'Договор аренды склада (защищён паролем)', 'manager');
    const p = panel(page);
    await p.getByRole('button', { name: 'В Текст · DOCX' }).click();
    const job = p.locator('li.ox-docs-job').first();
    await expect(job).toContainText('Файл защищён паролем');
    await job.getByRole('textbox', { name: 'Пароль файла' }).fill('0000');
    await job.getByRole('button', { name: 'Повторить' }).click();
    await expect(job.getByRole('alert')).toContainText('Неверный пароль файла');
    await job.getByRole('textbox', { name: 'Пароль файла' }).fill('1234');
    await job.getByRole('button', { name: 'Повторить' }).click();
    await expect(job).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  });

  test('«Перенести»: что изменится, перенос, новые крошки', async ({ app, page }) => {
    await openDoc(app, page, 'Регламент приёмки смены');
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Перенести в другую папку' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Перенести в другую папку' })).toBeVisible();
    await d.getByRole('button', { name: 'Перенести' }).click();
    await expect(d).toContainText('Выберите папку');
    await d.getByLabel('Папка').selectOption({ label: 'Север Логистик › Договоры' });
    await expect(d.getByRole('region', { name: 'Что изменится' })).toBeVisible();
    await d.getByRole('button', { name: 'Перенести' }).click();
    await expect(toast(page)).toHaveText('Документ перенесён в «Север Логистик › Договоры»');
    await expect(card(page)).toContainText('Документы › Север Логистик › Договоры');
  });

  test('недоступный документ и водитель с финансовым документом — «Документ недоступен»', async ({
    app,
    page,
  }) => {
    const tenant = await openDoc(app, page, 'Начисления · октябрь');
    const id = new URL(page.url()).searchParams.get('doc') ?? '';
    await app(`/t/${tenant}/docs?doc=${id}`, { persona: 'driver' });
    await expect(page.getByRole('heading', { name: 'Документ недоступен' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Функция «Водитель»: финансовые документы закрыты')).toBeVisible();
    await page.getByRole('button', { name: 'К списку' }).click();
    await expect(h1(page, 'Документы')).toBeVisible();
    await app(`/t/${tenant}/docs?doc=00000000-0000-4000-8000-000000000000`, { persona: 'owner' });
    await expect(page.getByRole('heading', { name: 'Документ недоступен' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('финансовый документ: значок и права без выгрузки; нет связи — только чтение', async ({
    app,
    page,
  }) => {
    await openDoc(app, page, 'Начисления · октябрь');
    await expect(
      card(page).getByTitle('Финансовый документ: функции «Водитель» закрыт всегда'),
    ).toBeVisible();
    await page.context().setOffline(true);
    await expect(
      card(page).getByText('Нет связи: документ открыт только для чтения из кэша устройства.'),
    ).toBeVisible();
    await expect(card(page)).toContainText('Нет связи · только чтение');
    await menuButton(page).click();
    await expect(page.getByRole('menuitem', { name: 'Переименовать' })).toBeDisabled();
    await page.context().setOffline(false);
  });

  test('клавиатура, axe, цели 44 px, без горизонтальной прокрутки', async ({ app, page, axe }) => {
    await openDoc(app, page, 'Договор подряда № 42/26');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const bad = async (): Promise<string[]> =>
      (await axe(page)).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(await bad()).toEqual([]);
    if (phone(page)) {
      expect(await hitHeight(menuButton(page))).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(card(page).getByRole('button', { name: 'К списку документов' })),
      ).toBeGreaterThanOrEqual(44);
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    await tab(page, 'Версии').click();
    await expect(panel(page).locator('li.ox-docs-version').first()).toBeVisible();
    expect(await bad()).toEqual([]);
  });
});

// Стенд: backend документов W7.23 в main. Карточка читает настоящий backend; документы теста создаются командами API
// (docs.stand.ts) с меткой прогона, маршрут запускается командой startDocRoute. Раздел открыт на стенде только владельцу.
test.describe('docs-doc — «Документ», карточка @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(150_000);

  /** Свежий текстовый документ; владелец открывает его карточку. */
  async function openFresh(
    app: Parameters<typeof openPage>[0],
    page: Page,
    project: string,
    o: { route?: boolean; folder?: string } = {},
  ) {
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    const doc = await textDoc(page, tenant, project, o.folder ? { folder: o.folder } : {});
    if (o.route) {
      const me = await memberIdByEmail(page, tenant, 'd.zimina@alta.example');
      await startRoute(page, tenant, doc.id, [{ kind: 'approve', name: 'Согласовать', who: [me] }]);
    }
    await app(`/t/${tenant}/docs?doc=${doc.id}`, { persona: 'owner' });
    await expect(h1(page, doc.title)).toBeVisible({ timeout: 30_000 });
    return { tenant, doc };
  }

  test('владелец на стенде: оболочка документа — крошки, «Сохранено на сервере», «Редактор подключается», права движка', async ({
    app,
    page,
  }, testInfo) => {
    const { doc } = await openFresh(app, page, testInfo.project.name);
    const c = card(page);
    await expect(page).toHaveURL(/[?&]doc=/);
    await expect(c).toContainText('Документы › Север Логистик › Приказы');
    await expect(c).toContainText(/Сохранено на сервере · v1 · /);
    await expect(c).toContainText('Черновик');
    await expect(c.getByRole('button', { name: /^Поделиться · / })).toBeVisible();
    await expect(c.getByText('У документа нет маршрута.')).toBeVisible();
    await expect(c.getByRole('region', { name: 'Редактор подключается' })).toContainText(
      'Правку документа ведёт встроенный движок',
    );
    await expect(c.getByText(/^Ортус передаёт движку права: правка — нет/)).toBeVisible();
    await expect(c.getByRole('region', { name: 'Поля CRM · 0' })).toContainText(
      'Значения меняются вместе с записями CRM. При утверждении фиксируются в версии.',
    );
    await page.reload();
    await expect(h1(page, doc.title)).toBeVisible({ timeout: 30_000 });
    await c.getByRole('button', { name: 'К списку документов' }).click();
    await expect(page).not.toHaveURL(/doc=/);
    await expect(h1(page, 'Документы')).toBeVisible();
  });

  test('владелец на стенде: переименование на месте — Escape, слишком короткое название, Enter', async ({
    app,
    page,
  }, testInfo) => {
    const { doc } = await openFresh(app, page, testInfo.project.name);
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Переименовать' }).click();
    const input = page.getByRole('textbox', { name: 'Название документа' });
    await expect(input).toBeFocused();
    await input.fill(`${doc.title} · черновик`);
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(h1(page, doc.title)).toBeVisible();
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Переименовать' }).click();
    await input.fill('Р');
    await page.keyboard.press('Enter');
    await expect(card(page).getByRole('alert')).toContainText('Название — не короче 2 символов');
    await input.fill(`${doc.title} v2`);
    await page.keyboard.press('Enter');
    await expect(toast(page)).toHaveText('Переименовано', { timeout: 20_000 });
    await expect(h1(page, `${doc.title} v2`)).toBeVisible();
    await page.reload();
    await expect(h1(page, `${doc.title} v2`)).toBeVisible({ timeout: 30_000 });
  });

  test('владелец на стенде: раскладка карточки следует ширине — data-w phone, tablet, wide', async ({
    app,
    page,
  }, testInfo) => {
    await openFresh(app, page, testInfo.project.name);
    const root = page.locator('.ox-docs[data-w]');
    for (const [w, h, name] of [
      [390, 844, 'phone'],
      [768, 900, 'tablet'],
      [1440, 900, 'wide'],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await expect(root).toHaveAttribute('data-w', name);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(root).toHaveAttribute('data-w', 'phone');
    const paper = await page.locator('.ox-docs-paper').boundingBox();
    expect(paper?.width ?? 0).toBeGreaterThan(300);
  });

  test('владелец на стенде: документ на маршруте — правка закрыта, «Версии и журнал» и «Откуда доступ»', async ({
    app,
    page,
  }, testInfo) => {
    await openFresh(app, page, testInfo.project.name, { route: true });
    await expect(card(page)).toContainText('Согласование · 0 из 1');
    await expect(
      card(page).getByText('v1 на согласовании: правка закрыта до решения. Комментировать можно.'),
    ).toBeVisible();
    await menuButton(page).click();
    await expect(page.getByRole('menu', { name: 'Действия с документом' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Переименовать' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Перенести в другую папку' })).toBeDisabled();
    await page.getByRole('menuitem', { name: 'Версии и журнал' }).click();
    await expect(page).toHaveURL(/[?&]tab=versions/);
    await expect(tab(page, 'Версии')).toHaveAttribute('aria-selected', 'true');
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Откуда доступ' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Поделиться' })).toBeVisible();
    await expect(d.getByRole('region', { name: 'Откуда доступ' })).toContainText('Итог');
  });

  test('владелец на стенде: меню «…» закрывается по Escape, фокус возвращается на кнопку', async ({
    app,
    page,
  }, testInfo) => {
    await openFresh(app, page, testInfo.project.name);
    await menuButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();
  });

  test('владелец на стенде: «Обсуждение» — комментарий с упоминанием, ответ, закрытие', async ({
    app,
    page,
  }, testInfo) => {
    await openFresh(app, page, testInfo.project.name);
    const p = panel(page);
    await expect(tab(page, /^Обсуждение/)).toHaveAttribute('aria-selected', 'true');
    await p.getByRole('button', { name: 'Отправить' }).last().click();
    await expect(p.getByRole('alert')).toContainText('Напишите комментарий');
    await p.getByRole('textbox', { name: 'Комментарий' }).fill('Согласовано с логистикой');
    await p
      .getByRole('combobox', { name: 'Упомянуть…' })
      .selectOption({ label: 'Алексей Соколов' });
    await p.getByRole('button', { name: 'Отправить' }).last().click();
    await expect(toast(page)).toHaveText('Комментарий отправлен', { timeout: 20_000 });
    const mine = p.locator('li.ox-docs-thread').filter({ hasText: 'Согласовано с логистикой' });
    await expect(mine).toContainText('Ко всему документу.');
    await expect(mine).toContainText('Алексей Соколов');
    await mine.getByRole('button', { name: 'Ответить' }).click();
    await mine.getByRole('textbox', { name: 'Ответ на комментарий' }).fill('Принято');
    await mine.getByRole('button', { name: 'Отправить' }).click();
    await expect(toast(page)).toHaveText('Ответ отправлен', { timeout: 20_000 });
    await expect(mine.locator('.ox-docs-replies')).toContainText('Принято');
    await mine.getByRole('button', { name: 'Закрыть обсуждение' }).click();
    await expect(toast(page)).toHaveText('Обсуждение закрыто', { timeout: 20_000 });
    await expect(mine).toContainText('Закрыто · ');
  });

  test('владелец на стенде: «Версии» — сохранить с названием (называет последнюю версию), назвать, журнал', async ({
    app,
    page,
  }, testInfo) => {
    await openFresh(app, page, testInfo.project.name);
    await tab(page, 'Версии').click();
    const p = panel(page);
    await expect(p.locator('li.ox-docs-version')).toHaveCount(1);
    await expect(p.locator('li.ox-docs-version').first()).toContainText('v1');
    await p.getByRole('textbox', { name: 'Название версии' }).fill('Перед проверкой');
    await p.getByRole('button', { name: 'Сохранить версию' }).click();
    await expect(toast(page)).toHaveText('Версия сохранена', { timeout: 20_000 });
    // Без сервера документов (Q-W7.23-3) «Сохранить версию» не режет новую версию, а называет последнюю.
    await expect(p.locator('li.ox-docs-version')).toHaveCount(1);
    await expect(p.locator('li.ox-docs-version').first()).toContainText('«Перед проверкой»');
    await p.getByRole('button', { name: 'Назвать v1' }).click();
    await p.getByRole('textbox', { name: 'Название версии 1' }).fill('Первая');
    await p.getByRole('button', { name: 'Назвать', exact: true }).click();
    await expect(toast(page)).toHaveText('Версия названа', { timeout: 20_000 });
    await expect(p.locator('li.ox-docs-version').last()).toContainText('«Первая»');
    await expect(p.getByRole('region', { name: 'Журнал документа' })).toBeVisible();
  });

  test('владелец на стенде: таблица сида — вкладка «Данные», защищённые диапазоны', async ({
    app,
    page,
  }) => {
    await openDoc(app, page, 'Расход топлива · октябрь');
    await expect(tab(page, 'Данные')).toHaveAttribute('aria-selected', 'true');
    const p = panel(page);
    await expect(p.getByRole('region', { name: 'Защищённые диапазоны и листы' })).toContainText(
      'Защищённых диапазонов нет.',
    );
    await expect(p.getByRole('button', { name: 'Обновить' })).toBeVisible();
  });

  test('владелец на стенде: «Перенести» — что изменится, перенос, новые крошки', async ({
    app,
    page,
  }, testInfo) => {
    await openFresh(app, page, testInfo.project.name);
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Перенести в другую папку' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Перенести в другую папку' })).toBeVisible();
    await d.getByRole('button', { name: 'Перенести' }).click();
    await expect(d).toContainText('Выберите папку');
    await d.getByLabel('Папка').selectOption({ label: 'Север Логистик › Договоры' });
    await expect(d.getByRole('region', { name: 'Что изменится' })).toBeVisible({ timeout: 20_000 });
    await d.getByRole('button', { name: 'Перенести' }).click();
    await expect(toast(page)).toHaveText('Документ перенесён в «Север Логистик › Договоры»', {
      timeout: 20_000,
    });
    await expect(card(page)).toContainText('Документы › Север Логистик › Договоры');
  });

  test('недоступный документ и сотрудник без права на раздел — «Документ недоступен» и гейт', async ({
    app,
    page,
  }, testInfo) => {
    const { tenant, doc } = await openFresh(app, page, testInfo.project.name);
    await app(`/t/${tenant}/docs?doc=00000000-0000-4000-8000-000000000000`, { persona: 'owner' });
    await expect(page.getByRole('heading', { name: 'Документ недоступен' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'К списку' }).click();
    await expect(h1(page, 'Документы')).toBeVisible();
    await app(`/t/${tenant}/docs?doc=${doc.id}`, { persona: 'driver' });
    await expect(page.getByText('Нет доступа к разделу «Документы»')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('владелец на стенде: финансовый документ — значок и права без выгрузки; нет связи — только чтение', async ({
    app,
    page,
  }) => {
    await openDoc(app, page, 'Начисления водителям · сентябрь');
    await expect(
      card(page).getByTitle('Финансовый документ: функции «Водитель» закрыт всегда'),
    ).toBeVisible();
    await page.context().setOffline(true);
    await expect(
      card(page).getByText('Нет связи: документ открыт только для чтения из кэша устройства.'),
    ).toBeVisible();
    await expect(card(page)).toContainText('Нет связи · только чтение');
    await menuButton(page).click();
    await expect(page.getByRole('menuitem', { name: 'Переименовать' })).toBeDisabled();
    await page.context().setOffline(false);
  });
});
