// W1.24 · e2e страницы `files` «Файлы» (эталон design-stage-1, «Ортус CRM.dc.html» :1858–1868, filesVM
// :4219–4231; чек-лист docs/plan/analysis/06-calendar-kb-data-files-spa-cash-repair.md §13 #23–25 с правкой S1-21:
// «Открыть» выдаёт короткую ссылку getFileDownload, а не тост демо — 13-stage1-dor.md). Список — listFiles
// (сид MSW: файл осмотра Р-208 из примеров контракта, PD-43).
import { expect, test } from './fixtures/index.ts';
import { h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { call, devScenario, LOTOS } from './shell.helpers.ts';

const INTRO =
  'Фото и вложения всегда привязаны к исходному объекту. Скачивание проверяет доступ к нему.';
const STATES =
  'Состояния загрузки: резерв → загружен → проверка → готов или отклонён. До проверки файл не считается подтверждением.';
const SEED_FILE = 'Р-208 · спереди.jpg';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

test.describe('files — «Файлы» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');

  test('открывается из меню и по прямому URL: заголовок, абзац, подпись состояний', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    if ((page.viewportSize()?.width ?? 0) >= 640) {
      await page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('button', { name: 'Файлы' })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Навигация', exact: true })
        .getByRole('button', { name: 'Ещё' })
        .click();
      await page
        .getByRole('dialog', { name: 'Все разделы' })
        .getByRole('button', { name: 'Файлы' })
        .click();
    }
    await expect(h1(page, 'Файлы')).toBeVisible();
    await expect(page).toHaveURL(/\/files$/);
    await page.reload();
    await expect(h1(page, 'Файлы')).toBeVisible();
    await expect(page.getByText(INTRO)).toBeVisible();
    await expect(page.getByText(STATES)).toBeVisible();
  });

  test('место организации «46,2 из 100 ГБ»', async ({ app, page }) => {
    await openPage(app, page, 'files');
    const usage = page.locator('.ox-files-usage');
    await expect(usage).toContainText('Место организации');
    await expect(usage).toContainText('46,2 из 100 ГБ');
  });

  test('строка файла: имя, родитель, «Готов», размер, «Открыть» активна', async ({ app, page }) => {
    await openPage(app, page, 'files');
    const row = page.locator('.ox-files-row').filter({ hasText: SEED_FILE });
    await expect(row).toContainText('Бронь машины');
    await expect(row).toContainText('Готов');
    await expect(row).toContainText('2,3 МБ');
    await expect(row.getByRole('button', { name: 'Открыть' })).toBeEnabled();
  });

  test('«Открыть» выдаёт короткую ссылку и открывает её в новой вкладке', async ({ app, page }) => {
    await openPage(app, page, 'files');
    const row = page.locator('.ox-files-row').filter({ hasText: SEED_FILE });
    const ticket = page.waitForResponse((r) => /\/files\/[^/]+\/download$/.test(r.url()));
    const popup = page.waitForEvent('popup');
    // Внешний хост хранилища харнесс блокирует: вкладка открывается, адрес — в первом запросе вкладки.
    const shortLink = page
      .context()
      .waitForEvent('request', (r) =>
        /storage\.example\.invalid\/files\/[0-9a-f-]+$/.test(r.url()),
      );
    await row.getByRole('button', { name: 'Открыть' }).click();
    expect((await ticket).status()).toBe(200);
    await popup;
    expect((await shortLink).url()).toMatch(/\/files\/[0-9a-f-]+$/);
    await expect(toast(page)).toHaveCount(0);
  });

  test('файл на проверке: «Проверяется», «Открыть» недоступна', async ({ app, page }) => {
    const id = await openPage(app, page, 'files');
    const r = await call(page, 'POST', `/api/v1/tenants/${id}/files/uploads`, {
      body: {
        fileName: 'Договор аренды склада № 1.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1258291,
        sha256: 'b'.repeat(64),
        purpose: 'expense_receipt',
        owner: { moduleKey: 'fleet', entityType: 'trip', entityId: id },
      },
    });
    expect(r.status).toBe(201);
    const { uploadId } = r.body as { uploadId: string };
    const done = await call(
      page,
      'POST',
      `/api/v1/tenants/${id}/files/uploads/${uploadId}/complete`,
      {
        body: { sha256: 'b'.repeat(64) },
      },
    );
    expect([200, 202]).toContain(done.status);
    await page.reload();
    const row = page.locator('.ox-files-row').filter({ hasText: 'Договор аренды склада № 1.pdf' });
    await expect(row).toContainText('Проверяется');
    await expect(row).toContainText('1,2 МБ');
    await expect(row.getByRole('button', { name: /^Открыть/ })).toBeDisabled();
  });

  test('длинное имя файла без пробелов переносится, а не обрезается', async ({ app, page }) => {
    const id = await openPage(app, page, 'files');
    const name = `Акт_приёма_передачи_${'Р208'.repeat(24)}.pdf`;
    const r = await call(page, 'POST', `/api/v1/tenants/${id}/files/uploads`, {
      body: {
        fileName: name,
        contentType: 'application/pdf',
        sizeBytes: 1258291,
        sha256: 'b'.repeat(64),
        purpose: 'expense_receipt',
        owner: { moduleKey: 'fleet', entityType: 'trip', entityId: id },
      },
    });
    expect(r.status).toBe(201);
    const { uploadId } = r.body as { uploadId: string };
    const done = await call(
      page,
      'POST',
      `/api/v1/tenants/${id}/files/uploads/${uploadId}/complete`,
      { body: { sha256: 'b'.repeat(64) } },
    );
    expect([200, 202]).toContain(done.status);
    await page.reload();
    const cell = page
      .locator('.ox-files-row')
      .filter({ hasText: 'Акт_приёма' })
      .locator('.ox-files-name');
    await expect(cell).toBeVisible();
    const box = await cell.evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
    expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('пусто: «Доступных файлов нет»', async ({ app, page }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'listFiles=empty' });
    await page.goto(page.url().replace(/\/home$/, '/files'));
    await expect(page.getByText('Доступных файлов нет')).toBeVisible();
  });

  test('скачивание не готового файла: тост по коду photo_not_ready', async ({ app, page }) => {
    await openPage(app, page, 'files');
    await devScenario(page, { scenario: 'getFileDownload=photo_not_ready' });
    await page
      .locator('.ox-files-row')
      .filter({ hasText: SEED_FILE })
      .getByRole('button', { name: 'Открыть' })
      .click();
    await expect(toast(page)).toHaveText('Фото ещё загружается. Дождитесь окончания загрузки.');
  });

  test('404 при скачивании: тост «Объект не найден или недоступен.», пустая вкладка закрыта', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'files');
    await devScenario(page, { scenario: 'getFileDownload=not_found' });
    const popup = page.waitForEvent('popup');
    await page
      .locator('.ox-files-row')
      .filter({ hasText: SEED_FILE })
      .getByRole('button', { name: 'Открыть' })
      .click();
    await expect(toast(page)).toHaveText('Объект не найден или недоступен.');
    const tab = await popup;
    await expect.poll(() => tab.isClosed()).toBe(true);
  });

  test('больше страницы (50): «Показать ещё» догружает следующую, фокус на первой догруженной строке', async ({
    app,
    page,
  }) => {
    const id = await openPage(app, page, 'files');
    // 55 сессий загрузки (файлы pending_upload) и файл сида — 56 строк, первая страница listFiles — 50.
    for (let batch = 0; batch < 5; batch++) {
      const replies = await Promise.all(
        Array.from({ length: 11 }, (_, i) =>
          call(page, 'POST', `/api/v1/tenants/${id}/files/uploads`, {
            body: {
              fileName: `Чек ${batch * 11 + i + 1}.pdf`,
              contentType: 'application/pdf',
              sizeBytes: 1024,
              sha256: 'c'.repeat(64),
              purpose: 'expense_receipt',
              owner: { moduleKey: 'fleet', entityType: 'trip', entityId: id },
            },
          }),
        ),
      );
      expect(replies.map((r) => r.status)).toEqual(Array(11).fill(201));
    }
    await page.reload();
    const rows = page.locator('.ox-files-row');
    await expect(rows).toHaveCount(50);
    const more = page.getByRole('button', { name: 'Показать ещё' });
    await more.click();
    await expect(rows).toHaveCount(56);
    await expect(more).toHaveCount(0);
    await expect(rows.nth(50)).toBeFocused();
  });

  test('место заполнено: полоса danger и баннер «Место организации заполнено.»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'files', { preset: 'storage-full' });
    await expect(page.locator('.ox-files-usage .ox-mod-bar-fill')).toHaveAttribute(
      'data-tone',
      'danger',
    );
    await expect(
      page.getByRole('alert').filter({ hasText: 'Место организации заполнено.' }),
    ).toBeVisible();
  });

  test('логист с ролью: список без карточки места (нет billing.read)', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await devScenario(page, { preset: 'logistics-ready' });
    await openPage(app, page, 'files', { persona: 'manager' });
    await expect(h1(page, 'Файлы')).toBeVisible();
    await expect(page.locator('.ox-files-usage')).toHaveCount(0);
  });

  test('водитель: пункта «Файлы» в меню рабочего места нет (эталон :2998)', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'driver' });
    await expect(page).toHaveURL(/\/today$/);
    const phone = (page.viewportSize()?.width ?? 0) < 640;
    const nav = phone
      ? page.getByRole('navigation', { name: 'Навигация', exact: true })
      : page.getByRole('navigation', { name: 'Основная навигация' });
    await expect(nav.getByRole('button').first()).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Файлы' })).toHaveCount(0);
  });

  test('загрузка: скелетон «Загрузка», затем список', async ({ app, page }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'listFiles=delay=1500' });
    await page.goto(page.url().replace(/\/home$/, '/files'));
    await expect(h1(page, 'Файлы')).toBeVisible();
    const status = page.locator('.ox-files').getByRole('status', { name: 'Загрузка' });
    await expect(status).toBeVisible();
    // Скелетон списка, а не скелетон оболочки с подписью «Загружаем рабочее пространство…».
    await expect(page.locator('.ox-files')).not.toContainText('Загружаем рабочее пространство…');
    await expect(page.locator('.ox-files-row')).toHaveCount(1);
  });

  test('место организации: пока грузится — карточка на месте; ошибка — alert и «Повторить»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'getStorageUsage=delay=1500' });
    await page.goto(page.url().replace(/\/home$/, '/files'));
    const usage = page.locator('.ox-files-usage');
    await expect(usage).toHaveAttribute('aria-busy', 'true');
    await expect(usage).toContainText('46,2 из 100 ГБ');
    await devScenario(page, { scenario: 'getStorageUsage=rate_limited' });
    await page.reload();
    await expect(usage.getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    await expect(page.locator('.ox-files-row')).toHaveCount(1);
    await devScenario(page, { scenario: null });
    await usage.getByRole('button', { name: 'Повторить' }).click();
    await expect(usage).toContainText('46,2 из 100 ГБ');
  });

  test('390: область нажатия «Открыть» не меньше 44 px', async ({ app, page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 640, 'только телефон');
    await openPage(app, page, 'files');
    const open = page
      .locator('.ox-files-row')
      .filter({ hasText: SEED_FILE })
      .getByRole('button', { name: 'Открыть' });
    await expect(open).toBeVisible();
    expect(await hitHeight(open)).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('ошибка списка: alert по коду, «Повторить» перечитывает список', async ({ app, page }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'listFiles=rate_limited' });
    await page.goto(page.url().replace(/\/home$/, '/files'));
    await expect(page.locator('.ox-files').getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.locator('.ox-files').getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('.ox-files-row')).toHaveCount(1);
  });

  test('офлайн: список — alert «Нет связи…»; «Открыть» — тост, пустая вкладка закрыта', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'listFiles=offline' });
    await page.goto(page.url().replace(/\/home$/, '/files'));
    await expect(page.locator('.ox-files').getByRole('alert')).toHaveText(
      `Не удалось загрузить данные: ${OFFLINE}`,
    );
    await devScenario(page, { scenario: 'getFileDownload=offline' });
    await page.reload();
    const popup = page.waitForEvent('popup');
    await page
      .locator('.ox-files-row')
      .filter({ hasText: SEED_FILE })
      .getByRole('button', { name: 'Открыть' })
      .click();
    await expect(toast(page)).toHaveText(OFFLINE);
    const tab = await popup;
    await expect.poll(() => tab.isClosed()).toBe(true);
  });

  test('клавиатура: Tab доходит до «Открыть», недоступная пропускается, Enter открывает вкладку', async ({
    app,
    page,
  }) => {
    const id = await openPage(app, page, 'files');
    const r = await call(page, 'POST', `/api/v1/tenants/${id}/files/uploads`, {
      body: {
        fileName: 'Договор аренды склада № 2.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1258291,
        sha256: 'c'.repeat(64),
        purpose: 'expense_receipt',
        owner: { moduleKey: 'fleet', entityType: 'trip', entityId: id },
      },
    });
    expect(r.status).toBe(201);
    const { uploadId } = r.body as { uploadId: string };
    await call(page, 'POST', `/api/v1/tenants/${id}/files/uploads/${uploadId}/complete`, {
      body: { sha256: 'c'.repeat(64) },
    });
    await page.reload();
    const rows = page.locator('.ox-files-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByRole('button', { name: /^Открыть/ })).toBeDisabled();
    await h1(page, 'Файлы').click();
    let name = '';
    for (let i = 0; i < 12 && name !== 'Открыть'; i++) {
      await page.keyboard.press('Tab');
      name = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    }
    const ready = rows.filter({ hasText: SEED_FILE }).getByRole('button', { name: 'Открыть' });
    await expect(ready).toBeFocused();
    expect(
      await page.evaluate(() =>
        document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : 'none',
      ),
    ).not.toBe('none');
    const popup = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    await popup;
  });

  test('массажист «Лотоса» без files.read по прямому URL: гейт «Нет права»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'files', { persona: 'therapist@t-lotos', tenant: LOTOS });
    await expect(page.locator('.ox-gate')).toContainText('Нет права');
    await expect(h1(page, 'Нет доступа к разделу «Файлы»')).toBeVisible();
    await expect(page.locator('.ox-files-list')).toHaveCount(0);
  });
  test('axe и раскладка: нет serious/critical, нет горизонтальной прокрутки', async ({
    app,
    page,
    axe,
  }) => {
    await openPage(app, page, 'files');
    await expect(page.locator('.ox-files-row')).toHaveCount(1);
    const r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe('files — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: заголовок, место W1.09, список listFiles', async ({ app, page }) => {
    test.slow();
    await openPage(app, page, 'files');
    await expect(h1(page, 'Файлы')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ox-files-usage')).toContainText('из 100 ГБ');
    await expect(page.locator('.ox-files-list')).toBeVisible();
  });
});
