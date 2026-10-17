// W1.24 · e2e страницы `modules` «Модули и место» (эталон design-stage-1, «Ортус CRM.dc.html» :205–281, omVM
// :3100–3137, toggleModule :2644–2683, applyQuota :2684–2709; чек-лист docs/plan/analysis/02-company.md §10
// #1–14, #65–69). Без демо-кнопок (PD-54); отключение — с «Затронет сейчас» из previewModuleDeactivation (S1-18);
// уменьшение лимита ниже занятого — 409 downgrade_below_usage контракта (Q-W1.24-2).
import { expect, test } from './fixtures/index.ts';
import {
  dialog,
  h1,
  hitHeight,
  moduleCard,
  noHorizontalScroll,
  openPage,
  toast,
} from './modules.helpers.ts';
import { call, devScenario, LOTOS } from './shell.helpers.ts';

const INTRO =
  'Подключение модуля открывает его организации. Сотрудники получают доступ только через роли и области.';
const CORE = [
  'Календарь',
  'Задачи',
  'База знаний',
  'Документы',
  'Формы',
  'Данные',
  'Файлы',
  'Склад и материалы',
  'Касса',
  'Обращения',
  'Чаты',
  'Уведомления',
];

test.describe('modules — «Модули и место» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');

  test('открывается из меню и по прямому URL: заголовок, крошка, абзац', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const phone = (page.viewportSize()?.width ?? 0) < 640;
    if (phone) {
      await page
        .getByRole('navigation', { name: 'Навигация', exact: true })
        .getByRole('button', { name: 'Модули' })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('button', { name: 'Модули и место' })
        .click();
    }
    await expect(h1(page, 'Модули и место')).toBeVisible();
    await expect(page).toHaveURL(/\/modules$/);
    await page.reload();
    await expect(h1(page, 'Модули и место')).toBeVisible();
    await expect(page.getByText('Альта Групп / Компания')).toBeVisible();
    await expect(page.getByText(INTRO)).toBeVisible();
  });

  test('карточка статуса: пробный период «Осталось 12 дней · до 13.10.2026», без демо-кнопки', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'modules');
    const card = page.locator('.ox-mod-status');
    await expect(card).toContainText('Осталось 12 дней · до 13.10.2026');
    await expect(card).toContainText('Пробный период');
    await expect(card).toContainText(
      'После окончания история останется доступной для чтения, новые операции будут ограничены. Данные не удаляются.',
    );
    await expect(page.getByRole('button', { name: 'Демо: завершить пробный период' })).toHaveCount(
      0,
    );
  });

  test('отраслевые модули: чипы и кнопки, «Использует:», строка о ролях', async ({ app, page }) => {
    await openPage(app, page, 'modules');
    await expect(page.getByRole('heading', { level: 2, name: 'Отраслевые модули' })).toBeVisible();
    await expect(page.locator('article')).toHaveCount(3);
    const logistics = moduleCard(page, 'Логистика');
    await expect(logistics).toContainText('Не подключён');
    await expect(logistics.getByRole('button', { name: 'Подключить' })).toBeEnabled();
    await expect(logistics).toContainText('Использует:');
    for (const dep of ['Календарь', 'Файлы', 'Формы']) {
      await expect(logistics.locator('.ox-mod-dep', { hasText: dep })).toBeVisible();
    }
    await expect(logistics).toContainText(
      'Роли с правами модуля есть у: 1 сотрудник. Они заработают после подключения',
    );
    const spa = moduleCard(page, 'Салон и SPA');
    await expect(spa).toContainText('Подключён');
    await expect(spa.getByRole('button', { name: 'Отключить' })).toBeVisible();
    await expect(moduleCard(page, 'Ремонт и стройка')).toContainText('Не подключён');
  });

  test('базовые модули: 12 плиток и «Использует: Салон и SPA»', async ({ app, page }) => {
    await openPage(app, page, 'modules');
    const tiles = page.locator('.ox-mod-core');
    await expect(tiles).toHaveCount(12);
    await expect(tiles.locator('.ox-mod-core-name')).toHaveText(CORE);
    await expect(tiles.filter({ hasText: 'Календарь' })).toContainText('Использует: Салон и SPA');
    await expect(tiles.filter({ hasText: 'Задачи' })).toContainText('Общий модуль ядра');
    await expect(tiles.filter({ hasText: 'Касса' })).toContainText('Использует: Салон и SPA');
  });

  test('место организации: 46,2 ГБ из 100 ГБ, meter, разбивка, лимит', async ({ app, page }) => {
    await openPage(app, page, 'modules');
    const st = page.locator('.ox-mod-storage');
    await expect(st).toContainText('46,2 ГБ');
    await expect(st).toContainText('из 100 ГБ');
    const meter = page.getByRole('meter', { name: 'Занятое место' });
    await expect(meter).toHaveAttribute('aria-valuenow', '46.2');
    await expect(meter).toHaveAttribute('aria-valuemax', '100');
    const rows = st.locator('.ox-mod-break');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toHaveText(/Фото осмотров и отчётов\s*31,4 ГБ/);
    await expect(rows.nth(1)).toHaveText(/Документы\s*9,8 ГБ/);
    await expect(rows.nth(2)).toHaveText(/Вложения задач и форм\s*3,1 ГБ/);
    await expect(rows.nth(3)).toHaveText(/Прочее\s*1,9 ГБ/);
    await expect(page.getByLabel('Лимит места')).toHaveValue('100');
    await expect(page.getByRole('button', { name: 'Изменить лимит' })).toBeDisabled();
  });

  test('подключение «Логистики»: диалог, тост, чип, меню', async ({ app, page }) => {
    await openPage(app, page, 'modules');
    await moduleCard(page, 'Логистика').getByRole('button', { name: 'Подключить' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Подключить «Логистика»?' })).toBeVisible();
    await expect(d).toContainText(
      'Модуль станет доступен организации «Альта Групп». Права сотрудникам не выдаются автоматически.',
    );
    await expect(d).toContainText('Что появится');
    await expect(d.locator('li').first()).toHaveText(/Рабочее место логиста/);
    await expect(d).toContainText('Календарь — уже включён');
    await expect(d).toContainText(
      'Шаблоны ролей: Менеджер логистики, Водитель. Назначьте их сотрудникам в «Пользователи и роли».',
    );
    await expect(d.getByRole('button', { name: 'Отмена' })).toBeVisible();
    await d.getByRole('button', { name: 'Подключить' }).click();
    await expect(toast(page)).toHaveText('Модуль «Логистика» подключён');
    await expect(dialog(page)).toHaveCount(0);
    const card = moduleCard(page, 'Логистика');
    await expect(card).toContainText('Подключён');
    await expect(card.getByRole('button', { name: 'Отключить' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Назначить роли' })).toBeVisible();
    await expect(page.locator('.ox-mod-core').filter({ hasText: 'Календарь' })).toContainText(
      'Использует: Логистика, Салон и SPA',
    );
    if ((page.viewportSize()?.width ?? 0) >= 640) {
      await expect(
        page
          .getByRole('navigation', { name: 'Основная навигация' })
          .getByRole('button', { name: 'Рабочее место логиста' }),
      ).toBeVisible();
    }
  });

  test('отключение «Логистики»: «Затронет сейчас», тексты модуля, флажок, меню D-23', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'modules', { preset: 'logistics-ready' });
    await moduleCard(page, 'Логистика').getByRole('button', { name: 'Отключить' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Отключить «Логистика»?' })).toBeVisible();
    await expect(d).toContainText('Данные не удаляются. Модуль перейдёт в режим чтения истории.');
    await expect(d).toContainText('Затронет сейчас');
    await expect(d).toContainText('Активных процессов нет');
    await expect(d).toContainText('Новые брони, рейсы и осмотры будут закрыты');
    await expect(d).toContainText('Начатые смены можно безопасно завершить и принять');
    await expect(d).toContainText('История, назначения ролей и файлы сохраняются');
    await expect(d).toContainText(
      'Группа модуля уйдёт из меню, останется один пункт в «Отключены · только чтение»',
    );
    const confirm = d.getByRole('button', { name: 'Отключить модуль' });
    await expect(confirm).toBeDisabled();
    await d.getByText('Понимаю последствия для текущей работы').click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(toast(page)).toHaveText('Модуль отключён. История доступна для чтения');
    await expect(moduleCard(page, 'Логистика')).toContainText('Отключён · только чтение');
    if ((page.viewportSize()?.width ?? 0) >= 640) {
      const nav = page.getByRole('navigation', { name: 'Основная навигация' });
      await expect(nav).toContainText('Отключены · только чтение');
      await expect(nav.getByRole('button', { name: 'Логистика' })).toBeVisible();
    }
  });

  test('отключение «Салон и SPA»: тексты модуля без пункта о сменах', async ({ app, page }) => {
    await openPage(app, page, 'modules');
    await moduleCard(page, 'Салон и SPA').getByRole('button', { name: 'Отключить' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Отключить «Салон и SPA»?' })).toBeVisible();
    await expect(d).toContainText('Активных процессов нет');
    await expect(d).toContainText('Новые записи, визиты и списания будут закрыты');
    await expect(d).not.toContainText('Начатые смены можно безопасно завершить и принять');
    await d.getByText('Понимаю последствия для текущей работы').click();
    await d.getByRole('button', { name: 'Отключить модуль' }).click();
    await expect(toast(page)).toHaveText('Модуль отключён. История доступна для чтения');
    await expect(moduleCard(page, 'Салон и SPA')).toContainText('Отключён · только чтение');
    await expect(
      moduleCard(page, 'Салон и SPA').getByRole('button', { name: 'Подключить' }),
    ).toBeVisible();
  });

  test('лимит меньше занятого: диалог эталона, сервер отклоняет (409), диалог открыт', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'modules');
    await page.getByLabel('Лимит места').selectOption({ label: '25 ГБ · меньше занятого' });
    await page.getByRole('button', { name: 'Изменить лимит' }).click();
    const d = dialog(page);
    await expect(
      d.getByRole('heading', { name: 'Новый лимит меньше занятого места' }),
    ).toBeVisible();
    await expect(d).toContainText('Занято 46,2 ГБ, новый лимит 25 ГБ. Не хватает 21,2 ГБ.');
    await expect(d).toContainText('Освободите не менее 21,2 ГБ в разделе «Файлы»');
    const apply = d.getByRole('button', { name: 'Всё равно применить' });
    await expect(apply).toBeDisabled();
    await d.getByText('Понимаю: новые загрузки будут недоступны').click();
    await apply.click();
    await expect(toast(page)).toHaveText(
      'Новый лимит меньше занятого места. Освободите место или выберите лимит больше.',
    );
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByRole('meter', { name: 'Занятое место' })).toHaveAttribute(
      'aria-valuemax',
      '100',
    );
  });

  test('лимит 250 ГБ: «Изменить лимит на 250 ГБ?», тост, meter', async ({ app, page }) => {
    await openPage(app, page, 'modules');
    await page.getByLabel('Лимит места').selectOption('250');
    await page.getByRole('button', { name: 'Изменить лимит' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Изменить лимит на 250 ГБ?' })).toBeVisible();
    await expect(d).toContainText(
      'Занято 46,2 ГБ. Стоимость не рассчитывается: тарифы не согласованы.',
    );
    await expect(d.getByRole('checkbox')).toHaveCount(0);
    await d.getByRole('button', { name: 'Изменить' }).click();
    await expect(toast(page)).toHaveText('Лимит места: 250 ГБ');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('meter', { name: 'Занятое место' })).toHaveAttribute(
      'aria-valuemax',
      '250',
    );
    await expect(page.locator('.ox-mod-storage')).toContainText('из 250 ГБ');
  });

  test('место заполнено: alert «Занято больше лимита…», баннер без кнопки; лимит 250 снимает баннер', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'modules', { preset: 'storage-full' });
    await expect(page.locator('.ox-mod-storage').getByRole('alert')).toContainText(
      'Новые загрузки заблокированы, файлы не удалены. Освободите место в разделе «Файлы» или увеличьте лимит.',
    );
    const banner = page.getByRole('alert').filter({ hasText: 'Место организации заполнено.' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('button')).toHaveCount(0);
    const me = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/context'));
    await page.getByLabel('Лимит места').selectOption('250');
    await page.getByRole('button', { name: 'Изменить лимит' }).click();
    await dialog(page).getByRole('button', { name: 'Изменить' }).click();
    await expect(toast(page)).toHaveText('Лимит места: 250 ГБ');
    await me;
    await expect(banner).toHaveCount(0);
  });

  test('организация ограничена: «Пробный период завершён», «Подключить» и «Изменить лимит» недоступны', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'modules', { preset: 'trial-ended' });
    const card = page.locator('.ox-mod-status');
    await expect(card).toContainText('Пробный период завершён');
    await expect(card).toContainText('Ограничен');
    await expect(
      page.getByRole('status').filter({ hasText: 'Пробный период завершён.' }),
    ).toBeVisible();
    await expect(
      moduleCard(page, 'Логистика').getByRole('button', { name: 'Подключить' }),
    ).toBeDisabled();
    await page.getByLabel('Лимит места').selectOption('250');
    await expect(page.getByRole('button', { name: 'Изменить лимит' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Демо: открыть как оператор' })).toHaveCount(0);
  });

  test('«Назначить роли» ведёт в «Пользователи и роли»', async ({ app, page }) => {
    await openPage(app, page, 'modules', { preset: 'logistics-ready' });
    await moduleCard(page, 'Логистика').getByRole('button', { name: 'Назначить роли' }).click();
    await expect(page).toHaveURL(/\/users$/);
    await expect(h1(page, 'Пользователи и роли')).toBeVisible();
  });

  test('нет связи: тост «Нет связи с сервером…», диалог открыт, чип прежний', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'modules');
    await devScenario(page, { scenario: 'setModuleInstallation=offline' });
    await moduleCard(page, 'Логистика').getByRole('button', { name: 'Подключить' }).click();
    await dialog(page).getByRole('button', { name: 'Подключить' }).click();
    await expect(toast(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(dialog(page)).toBeVisible();
    await expect(moduleCard(page, 'Логистика')).toContainText('Не подключён');
  });

  test('«Лотос»: подписка действует, место 12,4 из 50 ГБ', async ({ app, page }) => {
    await openPage(app, page, 'modules', { persona: 'owner@t-lotos', tenant: LOTOS });
    await expect(page.getByText('SPA «Лотос» / Компания')).toBeVisible();
    await expect(page.locator('.ox-mod-status')).toContainText('Подписка действует');
    await expect(page.locator('.ox-mod-status')).toContainText('Действует');
    await expect(page.locator('.ox-mod-storage')).toContainText('12,4 ГБ');
    await expect(page.locator('.ox-mod-storage')).toContainText('из 50 ГБ');
  });

  test('сотрудник по прямому URL: гейт «Нет доступа к разделу «Модули и место»»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'modules', { persona: 'manager' });
    await expect(h1(page, 'Нет доступа к разделу «Модули и место»')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(0);
  });

  test('загрузка и ошибка: скелетон, затем ошибка каталога тостом-текстом страницы', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'listModuleCatalog=delay=1500' });
    await page.goto(page.url().replace(/\/home$/, '/modules'));
    await expect(page.getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(h1(page, 'Модули и место')).toBeVisible();
    await devScenario(page, { scenario: 'listModuleCatalog=rate_limited' });
    await page.reload();
    await expect(page.locator('#ox-main').getByRole('alert')).toContainText(
      'Слишком много запросов. Подождите и повторите.',
    );
  });

  test('клавиатура: Escape закрывает диалог и возвращает фокус', async ({ app, page }) => {
    await openPage(app, page, 'modules');
    const open = moduleCard(page, 'Логистика').getByRole('button', { name: 'Подключить' });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
    await expect(page.getByRole('dialog', { name: 'Подключить «Логистика»?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test('клавиатура: после отказа (нет связи) фокус в диалоге, Tab не выходит из диалога', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'modules');
    await devScenario(page, { scenario: 'setModuleInstallation=offline' });
    await moduleCard(page, 'Логистика').getByRole('button', { name: 'Подключить' }).click();
    const d = page.getByRole('dialog', { name: 'Подключить «Логистика»?' });
    await d.getByRole('button', { name: 'Подключить' }).focus();
    await page.keyboard.press('Enter');
    await expect(toast(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    await expect.poll(inside).toBe(true);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await inside()).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });
  test('клавиатура: после смены лимита фокус на «Лимит места» (кнопка стала недоступной)', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'modules');
    const select = page.getByLabel('Лимит места');
    await select.selectOption('250');
    const apply = page.getByRole('button', { name: 'Изменить лимит' });
    await apply.focus();
    await page.keyboard.press('Enter');
    await dialog(page).getByRole('button', { name: 'Изменить' }).focus();
    await page.keyboard.press('Enter');
    await expect(toast(page)).toHaveText('Лимит места: 250 ГБ');
    await expect(dialog(page)).toHaveCount(0);
    await expect(apply).toBeDisabled();
    await expect(select).toBeFocused();
  });

  test('390: область нажатия «Подключить», «Отключить», «Назначить роли» не меньше 44 px', async ({
    app,
    page,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 640, 'только телефон');
    await openPage(app, page, 'modules', { preset: 'logistics-ready' });
    const targets = [
      moduleCard(page, 'Ремонт и стройка').getByRole('button', { name: 'Подключить' }),
      moduleCard(page, 'Логистика').getByRole('button', { name: 'Отключить' }),
      moduleCard(page, 'Логистика').getByRole('button', { name: 'Назначить роли' }),
    ];
    for (const t of targets) {
      await expect(t).toBeVisible();
      expect(await hitHeight(t)).toBeGreaterThanOrEqual(44);
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('axe и раскладка: нет serious/critical, нет горизонтальной прокрутки', async ({
    app,
    page,
    axe,
  }) => {
    await openPage(app, page, 'modules');
    await expect(page.locator('article')).toHaveCount(3);
    const r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    expect(await noHorizontalScroll(page)).toBe(true);
    await moduleCard(page, 'Логистика').getByRole('button', { name: 'Подключить' }).click();
    const r2 = await axe(page);
    expect(r2.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });
});

// Сид стенда общий для строк и проектов (390/768/1440 — один стенд, CI — один воркер), а вернуть модуль
// в «не подключён» контракт не умеет (отключение оставляет историю — read_only). Поэтому изменяющие строки
// работают в «Лотосе» под его владельцем: «Альта» остаётся как в сиде для access-gate, shell (меню D-23 без
// «Отключены · только чтение»), storage и files («из 100 ГБ»). Каждая строка начинает с состояния стенда,
// а не сида, и лимит возвращает назад — повтор в следующем проекте и ретрай CI проходят так же.
const LOTOS_OWNER = 'owner@t-lotos' as const;
/** Лимит места «Лотоса» в сиде стенда (W1.09). */
const LOTOS_SEED_GB = 50;

interface Manifest {
  moduleKey: string;
  state: string;
}

test.describe('modules — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец «Лотоса» на стенде: каталог W1.08, место W1.09, подключение и отключение «Логистики»', async ({
    app,
    page,
  }) => {
    test.slow();
    const id = await openPage(app, page, 'modules', { persona: LOTOS_OWNER, tenant: LOTOS });
    await expect(h1(page, 'Модули и место')).toBeVisible({ timeout: 30_000 });
    const cat = await call(page, 'GET', `/api/v1/tenants/${id}/modules`);
    expect(cat.status).toBe(200);
    const items = (cat.body as { items: Manifest[] }).items;
    const before = items.find((m) => m.moduleKey === 'fleet')?.state;
    expect(['uninstalled', 'read_only']).toContain(before);
    await expect(page.locator('article')).toHaveCount(3);
    await expect(moduleCard(page, 'Салон и SPA')).toContainText('Подключён');
    await expect(moduleCard(page, 'Логистика')).toContainText(
      before === 'read_only' ? 'Отключён · только чтение' : 'Не подключён',
    );
    await expect(page.getByRole('meter', { name: 'Занятое место' })).toBeVisible();
    await moduleCard(page, 'Логистика').getByRole('button', { name: 'Подключить' }).click();
    await dialog(page).getByRole('button', { name: 'Подключить' }).click();
    await expect(toast(page)).toHaveText('Модуль «Логистика» подключён');
    await moduleCard(page, 'Логистика').getByRole('button', { name: 'Отключить' }).click();
    await expect(dialog(page)).toContainText('Затронет сейчас');
    await dialog(page).getByText('Понимаю последствия для текущей работы').click();
    await dialog(page).getByRole('button', { name: 'Отключить модуль' }).click();
    await expect(toast(page)).toHaveText('Модуль отключён. История доступна для чтения');
    await expect(moduleCard(page, 'Логистика')).toContainText('Отключён · только чтение');
    const after = await call(page, 'GET', `/api/v1/tenants/${id}/modules/fleet`);
    expect((after.body as Manifest).state).toBe('read_only');
  });

  test('владелец «Лотоса» на стенде: лимит через расчёт и подтверждение и обратно', async ({
    app,
    page,
  }) => {
    test.slow();
    const id = await openPage(app, page, 'modules', { persona: LOTOS_OWNER, tenant: LOTOS });
    await expect(h1(page, 'Модули и место')).toBeVisible({ timeout: 30_000 });
    const usage = await call(page, 'GET', `/api/v1/tenants/${id}/storage`);
    expect(usage.status).toBe(200);
    const from = Math.round((usage.body as { quotaBytes: number }).quotaBytes / 2 ** 30);
    // Строка всегда кончается лимитом сида (50 ГБ): прогон, оборванный на 250, следующий вернёт к сиду.
    const steps = from === 250 ? [LOTOS_SEED_GB] : [250, LOTOS_SEED_GB];
    const meter = page.getByRole('meter', { name: 'Занятое место' });
    await expect(meter).toHaveAttribute('aria-valuemax', String(from));
    for (const gb of steps) {
      await page.getByLabel('Лимит места').selectOption(String(gb));
      await page.getByRole('button', { name: 'Изменить лимит' }).click();
      await dialog(page).getByRole('button', { name: 'Изменить' }).click();
      await expect(toast(page)).toHaveText(`Лимит места: ${gb} ГБ`);
      await expect(meter).toHaveAttribute('aria-valuemax', String(gb));
      await expect(dialog(page)).toHaveCount(0);
    }
  });
});
