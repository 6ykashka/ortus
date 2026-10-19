// W2.50 · e2e экрана «Импорт машин» страницы `logistics-fleet` (`?import=vehicles`, экран `logistics-vehicle-import` —
// no-reference, B-6; заменитель интеграции D-11 комплекта, ответ владельца 17.10; бриф W2.50 §1 п. 1, §5). Образец —
// импорт людей S1-10: файл CSV, предпросмотр с ошибками по строкам без изменения данных, применение одной операцией по
// If-Match. Персонажи — «Логист · Марина Котова» (пресет logistics-ready) и владелец. Обязательные пункты
// verification-protocol §1.3: вход и URL, состояния, клавиатура, axe, 390 / 1440.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { FLEET_H1, openFleet, phone, tabs, vehicleModels } from './logistics.helpers.ts';
import { assign, listUnits, revoke, roleId } from './_stand/stand.ts';
import { logisticsOn, MANAGER_ROLE, UNIT, vehicles } from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const H1 = 'Импорт машин';
const HEADER =
  'registration_number;display_name;body_type;payload_kg;volume_m3;cargo_length_m;cargo_width_m;cargo_height_m;odometer_km';
const CSV = [
  HEADER,
  'А 777 АА 77;Isuzu Elf;тент;3000;20;4,2;2,1;2,2;12000',
  'А 412 МР 77;ГАЗель Next;tent;1500;16;3,1;2;1,9;99000',
  'Б 1;Без кузова;ракета;1;1;1;1;1;1',
].join('\r\n');

const file = (text: string, name = 'машины.csv') => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text, 'utf8'),
});

async function check(page: Page, text: string, name?: string): Promise<void> {
  await page.getByLabel('Файл CSV').setInputFiles(file(text, name));
  await page.getByRole('button', { name: 'Проверить файл' }).click();
}

const preview = (page: Page) => page.getByRole('heading', { level: 2, name: /^Проверка файла/ });
const stat = (page: Page, kind: string) =>
  page.locator(`.ox-imp-stat[data-kind="${kind}"] .ox-imp-stat-value`);

async function openImport(
  app: Parameters<typeof openFleet>[0],
  page: Page,
  o: Parameters<typeof openFleet>[2] = {},
): Promise<string> {
  const alta = await openFleet(app, page, { ...o, route: 'fleet?import=vehicles' });
  await expect(h1(page, H1)).toBeVisible();
  return alta;
}

test.describe('logistics-fleet — «Импорт машин» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');

  test('«Импорт машин» в шапке рабочего места → ?import=vehicles; прямой URL и перезагрузка; «К рабочему месту»', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await expect(tabs(page)).toBeVisible();
    await page.getByRole('button', { name: 'Импорт машин' }).click();
    await expect(page).toHaveURL(/[?&]import=vehicles/);
    await expect(h1(page, H1)).toBeVisible();
    await expect(page.getByText(/^Колонки: registration_number, display_name/)).toBeVisible();
    await expect(page.getByText('Фирма по умолчанию: Север Логистик')).toBeVisible();
    await page.reload();
    await expect(h1(page, H1)).toBeVisible();
    await page.getByRole('button', { name: 'К рабочему месту' }).click();
    await expect(h1(page, FLEET_H1)).toBeVisible();
    await expect(page).not.toHaveURL(/import=/);
  });

  test('предпросмотр: итоги, ошибки по строкам; данные не меняются до применения', async ({
    app,
    page,
  }) => {
    await openImport(app, page);
    await page.getByRole('button', { name: 'Проверить файл' }).click();
    await expect(page.getByText('Выберите файл CSV.')).toBeVisible();
    await check(page, `\uFEFF${CSV}`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Проверка файла «машины.csv»' }),
    ).toBeVisible();
    await expect(stat(page, 'rows')).toHaveText('3');
    await expect(stat(page, 'create')).toHaveText('1');
    await expect(stat(page, 'update')).toHaveText('1');
    await expect(stat(page, 'error')).toHaveText('1');
    const errors = page.getByRole('list', { name: 'Строки с ошибками' });
    // Строки — прямые пункты списка (у строки с ошибками — вложенный список сообщений).
    await expect(errors.locator(':scope > li')).toHaveCount(1);
    await expect(errors).toContainText('Строка 4 · Б 1 · Без кузова');
    // Ошибка строки называет колонку — код заголовка и подпись (ревью W2.50-r1).
    await expect(errors).toContainText('body_type (кузов): Неизвестный тип кузова');
    const valid = page.getByRole('list', { name: 'Строки к применению' });
    await expect(valid.locator(':scope > li')).toHaveCount(2);
    await expect(valid).toContainText('Строка 2 · А 777 АА 77 · Isuzu Elf');
    await expect(valid).toContainText('Новая машина');
    await expect(valid).toContainText('Обновление');
    await expect(page.getByRole('button', { name: 'Применить', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'К рабочему месту' }).click();
    await expect(tabs(page)).toBeVisible();
    await expect(vehicleModels(page)).not.toContainText(['Isuzu Elf']);
  });

  test('«Применить без строк с ошибками»: итог, тост; новая машина в подборе', async ({
    app,
    page,
  }) => {
    await openImport(app, page);
    await check(page, CSV);
    await expect(preview(page)).toBeVisible();
    await page.getByRole('button', { name: 'Применить без строк с ошибками' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт применён' })).toBeVisible();
    await expect(
      page.getByText('Создано машин: 1 · обновлено: 1 · пропущено строк: 1.'),
    ).toBeVisible();
    await expect(toast(page)).toHaveText('Импорт машин применён');
    await page.getByRole('button', { name: 'К рабочему месту' }).click();
    await expect(tabs(page)).toBeVisible();
    await expect(vehicleModels(page)).toContainText(['Isuzu Elf']);
  });

  test('файл без ошибок — «Применить»; «Загрузить другой файл»', async ({ app, page }) => {
    await openImport(app, page);
    await check(page, [HEADER, 'Е 555 ЕЕ 77;Volvo FL;борт;5000;30;6;2,4;2,4;5000'].join('\n'));
    await expect(preview(page)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Строки с ошибками' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(
      page.getByText('Создано машин: 1 · обновлено: 0 · пропущено строк: 0.'),
    ).toBeVisible();
    await expect(page.locator('.ox-imp-stat[data-kind="update"] .ox-imp-stat-label')).toHaveText(
      'Обновлено',
    );
    await page.getByRole('button', { name: 'Загрузить другой файл' }).click();
    await expect(page.getByLabel('Файл CSV')).toBeVisible();
    await expect(page.getByText('Файл не выбран')).toBeVisible();
  });

  // Ревью W2.50-r1 (major, mcp/stale-reupload-1440.png): тот же файл после применения уходил с прежним
  // Idempotency-Key — повтор старого ответа («Новая машина», ETag "1») и 412 на «Применить» до перезагрузки.
  test('тот же файл после применения — свежий предпросмотр «Обновление», применение проходит', async ({
    app,
    page,
  }) => {
    await openImport(app, page);
    const again = [HEADER, 'О 909 ОО 77;Повтор;тент;1500;16;3,1;2;1,9;1000'].join('\n');
    await check(page, again, 'повтор.csv');
    await expect(preview(page)).toBeVisible();
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт применён' })).toBeVisible();
    await page.getByRole('button', { name: 'Загрузить другой файл' }).click();
    await check(page, again, 'повтор.csv');
    await expect(preview(page)).toBeVisible();
    const valid = page.getByRole('list', { name: 'Строки к применению' });
    await expect(valid).toContainText('Обновление');
    await expect(stat(page, 'create')).toHaveText('0');
    await expect(stat(page, 'update')).toHaveText('1');
    const commit = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/commit'),
    );
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    expect((await commit).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт применён' })).toBeVisible();
    await expect(
      page.getByText('Создано машин: 0 · обновлено: 1 · пропущено строк: 0.'),
    ).toBeVisible();
  });

  // Ревью W2.50-r2 (minor): после 412 на «Применить» оставался предпросмотр со старым ETag — повтор снова 412.
  test('412 на «Применить» — файл проверен заново, баннер; повтор «Применить» — 200', async ({
    app,
    page,
  }) => {
    await openImport(app, page);
    await check(page, [HEADER, 'Р 515 РР 77;Устаревший;тент;1500;16;3,1;2;1,9;1000'].join('\n'));
    await expect(preview(page)).toBeVisible();
    await devScenario(page, { scenario: 'commitVehicleImport=revision_mismatch', once: true });
    const stale = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/commit'),
    );
    const again = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/fleet/vehicle-imports'),
    );
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    expect((await stale).status()).toBe(412);
    expect((await again).status()).toBe(201);
    await expect(
      page.getByRole('status').filter({ hasText: 'Данные изменились после проверки' }),
    ).toContainText('Проверьте строки и примените импорт ещё раз.');
    await expect(preview(page)).toBeFocused();
    const commit = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/commit'),
    );
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    expect((await commit).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт применён' })).toBeVisible();
  });

  test('422 заголовка и 413 размера — текст сервера в alert', async ({ app, page }) => {
    await openImport(app, page);
    await check(page, 'registration_number;display_name\nА 1;Машина');
    await expect(page.getByRole('alert')).toContainText(
      'В файле нет обязательной колонки body_type.',
    );
    const rows = Array.from({ length: 2001 }, (_, i) => `Т ${i} ТТ 77;Машина;tent;1;1;1;1;1;1`);
    await check(page, [HEADER, ...rows].join('\n'), 'большой.csv');
    await expect(page.getByRole('alert')).toContainText(
      'Файл больше 1 МБ или 2000 строк. Разделите его на части.',
    );
  });

  test('нет связи: «Проверить файл» — «Нет связи с сервером. Операция не выполнена.»', async ({
    app,
    page,
  }) => {
    await openImport(app, page);
    await devScenario(page, { scenario: 'createVehicleImport=offline', once: true });
    await check(page, CSV);
    await expect(page.getByRole('alert')).toContainText(
      'Нет связи с сервером. Операция не выполнена.',
    );
    await expect(preview(page)).toHaveCount(0);
  });

  test('владелец: «Фирма по умолчанию» — выбор фирмы; модуль только для чтения — кнопки нет, пояснение', async ({
    app,
    page,
  }) => {
    // Два входа с пресетом (владелец, затем модуль только для чтения) — дольше 30 с на общем ПК.
    test.slow();
    await openImport(app, page, { persona: 'owner' });
    const unit = page.getByLabel('Фирма по умолчанию');
    await expect(unit.locator('option', { hasText: 'Москва / Север Логистик' })).toHaveCount(1);
    const alta = await openFleet(app, page, { persona: 'owner', off: true });
    await expect(tabs(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Импорт машин' })).toHaveCount(0);
    await app(`/t/${alta}/fleet?import=vehicles`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible();
    await expect(
      page.getByText('Модуль только для чтения — импорт машин недоступен.'),
    ).toBeVisible();
    await expect(page.getByLabel('Файл CSV')).toHaveCount(0);
  });

  test('клавиатура: Tab — файл, «Проверить файл», «Применить без строк с ошибками»; фокус виден', async ({
    app,
    page,
  }) => {
    await openImport(app, page);
    const input = page.getByLabel('Файл CSV');
    await input.focus();
    await expect(input).toBeFocused();
    await page.keyboard.press('Tab');
    const btn = page.getByRole('button', { name: 'Проверить файл' });
    await expect(btn).toBeFocused();
    expect(await btn.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await input.setInputFiles(file(CSV));
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(preview(page)).toBeVisible();
    const apply = page.getByRole('button', { name: 'Применить без строк с ошибками' });
    let reached = false;
    for (let i = 0; i < 20 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await apply.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
  });

  test('axe без serious/critical; 390 — без прокрутки вбок, цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await openImport(app, page);
    const serious = async () =>
      (await axe(page)).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} ${JSON.stringify(v.nodes.map((n) => n.target))}`);
    expect(await serious()).toEqual([]);
    await check(page, CSV);
    await expect(preview(page)).toBeVisible();
    expect(await serious()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      for (const name of ['Применить без строк с ошибками', 'Загрузить другой файл']) {
        expect(await hitHeight(page.getByRole('button', { name }))).toBeGreaterThanOrEqual(44);
      }
    }
    await page.getByRole('button', { name: 'Применить без строк с ошибками' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт применён' })).toBeVisible();
    expect(await serious()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

// Backend импорта (W2.50: fleet/csv, cmd/api) — в ветке W2.50; машины и рабочее место (W2.02, W2.20) — в main.
// Стенд общий для всех строк и трёх проектов (workers 1), а машину удалить или архивировать нечем (в контракте
// 0.6.2-stage2 таких команд нет). Машины «Север Логистик» считает driver-cars @stand («машины фирмы» водителя — пять
// машин сида), поэтому строка импортирует в отдельную фирму сида без машин и водителей — «Охта Карго»: Марина Котова
// получает в ней «Менеджера логистики» на время строки, строка файла называет фирму колонкой org_unit (возврат
// интегратора W2.50).
const IMPORT_UNIT = 'Охта Карго';
/** Буквы госномера по проекту: номера трёх проектов прогона не совпадают. */
const PLATE_LETTERS: Record<string, string> = { mobile: 'МК', tablet: 'ТК', desktop: 'ХК' };

test.describe('logistics-fleet — «Импорт машин» стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('логист на стенде: предпросмотр и применение импорта, машина в области', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.slow();
    const s = await logisticsOn(session, undo);
    const firm = (await listUnits(s.owner, s.tenant)).find((u) => u.name === IMPORT_UNIT);
    if (!firm) throw new Error(`нет подразделения «${IMPORT_UNIT}»`);
    const role = await roleId(s.owner, s.tenant, MANAGER_ROLE);
    const grant = await assign(s.owner, s.tenant, {
      memberId: s.members.kotova,
      roleId: role,
      unitId: firm.id,
    });
    undo(`Марина Котова — «${MANAGER_ROLE}» в «${IMPORT_UNIT}»`, () =>
      revoke(s.owner, s.tenant, grant.id),
    );
    await app(`/t/${s.tenant}/fleet?import=vehicles`, { persona: 'manager' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    const home = async () =>
      (await vehicles(page, s.tenant))
        .filter((v) => v.orgUnitId === s.unitId)
        .map((v) => v.id)
        .sort();
    const before = await home();
    const letters = PLATE_LETTERS[testInfo.project.name.split('-')[0] ?? ''] ?? 'ВК';
    const plate = `Е ${String(Date.now()).slice(-3)} ${letters} 77`;
    await check(
      page,
      [
        `${HEADER};org_unit`,
        `${plate};Импорт стенда;tent;1000;10;3;2;2;100;${IMPORT_UNIT}`,
        'Б 1;Без кузова;ракета;1;1;1;1;1;1;',
      ].join('\r\n'),
    );
    await expect(preview(page)).toBeVisible({ timeout: 15_000 });
    await expect(stat(page, 'error')).toHaveText('1');
    await expect(page.getByRole('list', { name: 'Строки с ошибками' })).toContainText(
      'body_type (кузов): Неизвестный тип кузова',
    );
    await page.getByRole('button', { name: 'Применить без строк с ошибками' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Импорт применён' })).toBeVisible({
      timeout: 15_000,
    });
    const made = (await vehicles(page, s.tenant)).find((v) => v.registrationNumber === plate);
    expect(made?.orgUnitId, `машина ${plate} — в «${IMPORT_UNIT}»`).toBe(firm.id);
    expect(await home(), `машины «${UNIT}» после импорта — те же, что до него`).toEqual(before);
  });
});
