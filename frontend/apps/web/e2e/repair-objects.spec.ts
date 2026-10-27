// W6.20 · e2e страницы `repair` «Объекты» (repair-list, repair-card обзор 1a, repair-works, modal-assign-foreman; эталон
// design-2026-10-19, «Ортус CRM.dc.html» :1921–2124, repairVM :4267–4436). Режим mock: пресет `repairs-ready`, «сегодня»
// 20.10.2026, владелец «Дарья Зимина» и прораб «Алексей Соколов». Обязательные пункты verification-protocol §1.3:
// загрузка, ошибка, нет связи, пусто, клавиатура, 390 / 1440.
import { expect, test } from './_stand/fixtures.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { addPhoto, heading, openRepair, phone, reloadReady } from './repair.helpers.ts';
import { devScenario } from './shell.helpers.ts';

// Раскладка списка рассчитана на две ширины: карточки на 390, таблица на 1440 (проекты mobile-390, desktop-1440).
test.skip(({ viewport }) => viewport?.width === 768, 'spec рассчитан на mobile-390 и desktop-1440');

const main = (page: import('@playwright/test').Page) => page.locator('#ox-main');
const filters = (page: import('@playwright/test').Page) =>
  page.getByRole('group', { name: 'Фильтр объектов' });
const cards = (page: import('@playwright/test').Page) => page.locator('.ox-rp-obj');
const tabs = (page: import('@playwright/test').Page) =>
  page.getByRole('tablist', { name: 'Разделы объекта' }).getByRole('tab');

const NAMES = [
  'ЖК Северный парк · квартира 117',
  'ЖК Речной · квартира 42',
  'Кофейня на Покровке',
  'Профсоюзная, 64 · квартира 210',
] as const;

test.describe('repair-list — список объектов @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  test.setTimeout(90_000);

  test('владелец: h1, четыре фильтра со счётчиками, объекты «сначала то, что ждёт решения»', async ({
    app,
    page,
  }) => {
    await openRepair(app, page);
    await expect(h1(page, 'Объекты')).toBeVisible();
    await expect(main(page)).toContainText('Ремонт и стройка');
    await expect(filters(page).getByRole('button')).toHaveText([
      /^Активные\s*4$/,
      /^Требуют решения\s*5$/,
      /^До договора\s*1$/,
      /^Сданы\s*1$/,
    ]);
    await expect(filters(page).getByRole('button', { name: /Активные/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('searchbox', { name: 'Поиск по объектам' })).toHaveAttribute(
      'placeholder',
      'Адрес, заказчик, прораб',
    );
    await expect(main(page)).toContainText('Сначала то, что ждёт решения');
    await expect(main(page)).toContainText('Объект-черновик создаётся из заявки на этапе «Замер»');
    if (phone(page)) {
      // 390: карточки, у владельца без «Отметить работу»
      await expect(cards(page)).toHaveCount(4);
      await expect(cards(page).locator('.ox-rp-obj-name')).toHaveText([...NAMES]);
      await expect(main(page).getByRole('button', { name: 'Отметить работу' })).toHaveCount(0);
      await expect(cards(page).first()).toContainText('принято');
      await expect(cards(page).first()).toContainText('Прораб: Алексей Соколов');
      expect(await noHorizontalScroll(page)).toBe(true);
    } else {
      // 1440: таблица с пятью колонками
      await expect(main(page).getByRole('columnheader')).toHaveText([
        'Объект',
        'Этап и готовность',
        'Сдача',
        'Прораб',
        'Требует решения',
      ]);
      await expect(main(page).locator('tbody tr')).toHaveCount(4);
      await expect(main(page).locator('tbody .ox-rp-open-name')).toHaveText([...NAMES]);
      const first = main(page).locator('tbody tr').first();
      await expect(first).toContainText('Чистовая отделка');
      await expect(first).toContainText('82%');
      await expect(first).toContainText('+4% на приёмке');
      await expect(first).toContainText('17.10');
      await expect(first).toContainText('просрочено на 3 дня');
      await expect(first).toContainText('Приёмка · Укладка ламината: 18 м²');
      await expect(first).toContainText('ещё 1 вопрос');
      const slip = main(page).locator('tbody tr').nth(1);
      await expect(slip).toContainText('01.12');
      await expect(slip).toContainText('прогноз · по договору 27.11');
      await expect(slip).toContainText('ещё 5 вопросов');
      await expect(main(page).locator('tbody tr').nth(2)).toContainText('не назначен');
    }
  });

  test('фильтры «Требуют решения», «До договора», «Сданы»; адрес `?filter=` и перезагрузка', async ({
    app,
    page,
  }) => {
    await openRepair(app, page);
    await filters(page)
      .getByRole('button', { name: /До договора/ })
      .click();
    await expect(page).toHaveURL(/filter=draft/);
    const draft = phone(page) ? cards(page) : main(page).locator('tbody tr');
    await expect(draft).toHaveCount(1);
    await expect(draft.first()).toContainText('Дом 120 м², Истра');
    await expect(draft.first()).toContainText('Замер · до договора');
    await expect(draft.first()).toContainText('после договора');
    await expect(draft.first()).toContainText('договора ещё нет');
    await reloadReady(page);
    await expect(filters(page).getByRole('button', { name: /До договора/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await filters(page).getByRole('button', { name: /Сданы/ }).click();
    await expect(draft).toHaveCount(1);
    await expect(draft.first()).toContainText('Дом на Лесной · Мытищи');
    await expect(draft.first()).toContainText('Сдан');
    await expect(draft.first()).toContainText('гарантия до');
    await filters(page)
      .getByRole('button', { name: /Требуют решения/ })
      .click();
    await expect(draft).toHaveCount(5);
  });

  test('поиск по адресу, заказчику и прорабу; пусто «По фильтру объектов нет»', async ({
    app,
    page,
  }) => {
    await openRepair(app, page);
    const search = page.getByRole('searchbox', { name: 'Поиск по объектам' });
    await search.fill('Покровка');
    const rows = phone(page) ? cards(page) : main(page).locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(/q=/);
    await search.fill('Зерно');
    await expect(rows).toHaveCount(1);
    await search.fill('нет такого');
    await expect(page.getByText('По фильтру объектов нет')).toBeVisible();
    await expect(page.getByText('Измените запрос или очистите поиск.')).toBeVisible();
    await search.fill('');
    await expect(rows).toHaveCount(4);
  });

  test('прораб: «Объекты, где вы прораб», два фильтра, без поиска, карточки с «Отметить работу»', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { persona: 'foreman' });
    await expect(h1(page, 'Объекты')).toBeVisible();
    await expect(main(page)).toContainText('Объекты, где вы прораб');
    await expect(filters(page).getByRole('button')).toHaveText([/^Активные\s*3$/, /^Сданы\s*1$/]);
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(cards(page)).toHaveCount(3);
    await expect(main(page).getByRole('button', { name: 'Отметить работу' })).toHaveCount(3);
    await expect(main(page)).not.toContainText('Прораб:');
    await expect(main(page)).not.toContainText('Объект-черновик создаётся из заявки');
    // кнопка «Отметить работу» ведёт на вкладку «Работы» объекта
    await main(page).getByRole('button', { name: 'Отметить работу' }).first().click();
    await expect(page).toHaveURL(/tab=works/);
    await expect(page.getByRole('heading', { level: 2, name: 'Отметка за сегодня' })).toBeVisible();
    await page.goBack();
    expect(
      await hitHeight(main(page).getByRole('button', { name: 'Отметить работу' }).first()),
    ).toBeGreaterThanOrEqual(44);
  });

  test('нет объектов: пустые состояния владельца и прораба', async ({ app, page }) => {
    await openRepair(app, page, { scenario: 'listRepairProjects=empty' });
    await expect(page.getByText('Объектов пока нет')).toBeVisible();
    await expect(
      page.getByText('Объект-черновик создаётся из заявки на этапе «Замер».'),
    ).toBeVisible();
    await openRepair(app, page, { persona: 'foreman', scenario: 'listRepairProjects=empty' });
    await expect(page.getByText('Вам пока не назначены объекты')).toBeVisible();
    await expect(
      page.getByText('Объект появится здесь, когда владелец назначит вас прорабом.'),
    ).toBeVisible();
  });

  test('загрузка, ошибка и «Повторить», нет связи', async ({ app, page }) => {
    await openRepair(app, page, { scenario: 'listRepairProjects=delay=1500' });
    await expect(main(page).getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(filters(page).getByRole('button', { name: /Активные/ })).toContainText('4');
    await devScenario(page, { scenario: 'listRepairProjects=rate_limited' });
    await reloadReady(page);
    await expect(main(page).getByRole('alert')).toContainText(
      'Не удалось загрузить объекты: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await main(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(filters(page).getByRole('button', { name: /Активные/ })).toContainText('4');
    await page.context().setOffline(true);
    await page.reload().catch(() => undefined);
    await page.context().setOffline(false);
  });

  test('клавиатура и axe: фильтры по Tab и Enter, без серьёзных нарушений', async ({
    app,
    page,
    axe,
  }) => {
    await openRepair(app, page);
    const active = filters(page).getByRole('button', { name: /Активные/ });
    await active.focus();
    await page.keyboard.press('Tab');
    await expect(filters(page).getByRole('button', { name: /Требуют решения/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/filter=todo/);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe('repair-card — карточка объекта, обзор 1a @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  test.setTimeout(90_000);

  async function open(
    app: Parameters<typeof openRepair>[0],
    page: import('@playwright/test').Page,
    name: string,
    persona: 'owner' | 'foreman' = 'owner',
    tab?: string,
  ): Promise<void> {
    await openRepair(app, page, { persona });
    await main(page)
      .getByRole('button', { name: new RegExp(name) })
      .first()
      .click();
    await expect(heading(page, name)).toBeVisible();
    if (tab) await tabs(page).filter({ hasText: tab }).click();
  }

  test('владелец: шапка, чипы, готовность «по объёмам», кнопки и одиннадцать вкладок', async ({
    app,
    page,
  }) => {
    await open(app, page, 'ЖК Северный парк · квартира 117');
    await expect(page).toHaveURL(/obj=/);
    await expect(main(page)).toContainText('Ремонт и стройка');
    await expect(main(page).getByRole('button', { name: 'Объекты' })).toBeVisible();
    const hero = page.locator('.ox-rp-hero');
    await expect(hero).toContainText('Чистовая отделка');
    await expect(hero).toContainText('сдача 17.10');
    await expect(hero).toContainText('На приёмке: 1');
    await expect(hero).toContainText(
      'Москва, Дмитровское ш., 107к2, кв. 117 · 74 м², 3 комнаты · капитальный ремонт · договор № 38',
    );
    await expect(hero).toContainText('Готовность по объёмам');
    await expect(hero).toContainText('82% принято');
    await expect(hero).toContainText('Принято 82%');
    await expect(hero).toContainText('На приёмке 4%');
    await expect(hero).toContainText('Для заказчика — по закрытым актам');
    await expect(hero.getByRole('button', { name: 'Кабинет заказчика' })).toBeVisible();
    await expect(hero.getByRole('button', { name: 'Отметить работу' })).toHaveCount(0);
    await expect(tabs(page)).toHaveText([
      'Обзор',
      /^Работы\s*1$/,
      'Замер',
      'Смета',
      'График',
      'Документы',
      /^Снабжение\s*2$/,
      'Финансы',
      'Оплата бригады',
      'Подрядчики',
      'Кабинет заказчика',
    ]);
    await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true');
  });

  test('обзор: «Требует решения», объёмы, фотоотчёт, как попасть, люди, деньги, лента', async ({
    app,
    page,
  }) => {
    await open(app, page, 'ЖК Речной · квартира 42');
    const m = main(page);
    await expect(m.getByRole('heading', { level: 2, name: 'Требует решения' })).toBeVisible();
    await expect(m).toContainText('Сначала то, что держит работу');
    await expect(m).toContainText('Сдача сдвигается на 01.12');
    await expect(m.getByRole('heading', { level: 2, name: 'Объёмы работ' })).toBeVisible();
    await expect(m).toContainText('факт — только по принятым отметкам');
    await expect(m).toContainText('58 из 96 м²');
    await expect(m.locator('.ox-rp-link', { hasText: 'Открыть график' })).toBeVisible();
    await expect(m.getByRole('heading', { level: 2, name: 'Фотоотчёт' })).toBeVisible();
    await expect(m).toContainText('в кабинет заказчика попадают фото принятых отметок');
    await expect(m.getByRole('heading', { level: 2, name: 'Как попасть на объект' })).toBeVisible();
    await expect(m.getByRole('button', { name: 'Маршрут' })).toBeDisabled();
    await expect(m).toContainText('Подъезд 2, этаж 9, домофон 42К');
    await expect(m.getByRole('heading', { level: 2, name: 'Люди на объекте' })).toBeVisible();
    await expect(m).toContainText('Заказчик · кабинет по ссылке до сдачи');
    await expect(m).toContainText('Прораб · работает в CRM');
    await expect(m).toContainText('Бригада · 4 человека');
    await expect(m.getByRole('heading', { level: 2, name: 'Деньги' })).toBeVisible();
    await expect(m).toContainText('Финансы объектов');
    await expect(m).toContainText('438 175 ₽');
    await expect(m).toContainText('131 453 ₽');
    await expect(m).toContainText('Маржа, план');
    await expect(m.getByRole('button', { name: 'Открыть финансы' })).toBeVisible();
    await expect(m.getByRole('heading', { level: 2, name: 'Лента' })).toBeVisible();
    await m.locator('.ox-rp-link', { hasText: 'Открыть график' }).click();
    await expect(page).toHaveURL(/tab=schedule/);
  });

  test('прораб: «Мои вопросы по объекту», без вкладок денег и без сумм', async ({ app, page }) => {
    await open(app, page, 'ЖК Речной · квартира 42', 'foreman');
    const m = main(page);
    await expect(
      m.getByRole('heading', { level: 2, name: 'Мои вопросы по объекту' }),
    ).toBeVisible();
    await expect(tabs(page)).toHaveText([
      'Обзор',
      'Работы',
      'Замер',
      'График',
      'Документы',
      /^Снабжение/,
    ]);
    await expect(m.getByRole('heading', { level: 2, name: 'Деньги' })).toHaveCount(0);
    await expect(m).not.toContainText('438 175');
    await expect(m.getByRole('button', { name: 'Кабинет заказчика' })).toHaveCount(0);
    await expect(m.getByRole('button', { name: 'Отметить работу' }).first()).toBeVisible();
    await expect(m).toContainText('Отметка за сегодня не отправлена');
  });

  test('объект-черновик: вкладки «Обзор, Замер, Смета», без объёмов и фотоотчёта', async ({
    app,
    page,
  }) => {
    await openRepair(app, page);
    await filters(page)
      .getByRole('button', { name: /До договора/ })
      .click();
    await main(page)
      .getByRole('button', { name: /Дом 120 м², Истра/ })
      .first()
      .click();
    await expect(heading(page, 'Дом 120 м², Истра')).toBeVisible();
    await expect(tabs(page)).toHaveText(['Обзор', 'Замер', /^Смета/]);
    await expect(page.locator('.ox-rp-hero')).toContainText('Замер · до договора');
    await expect(page.locator('.ox-rp-hero')).not.toContainText('Готовность по объёмам');
    await expect(main(page).getByRole('heading', { level: 2, name: 'Объёмы работ' })).toHaveCount(
      0,
    );
    await expect(main(page)).toContainText('Назначается после договора');
  });

  test('вкладка другого WS — заглушка с пунктами «Требует решения»; адрес и «Объекты» назад', async ({
    app,
    page,
  }) => {
    await open(app, page, 'ЖК Речной · квартира 42', 'owner', 'График');
    await expect(page).toHaveURL(/tab=schedule/);
    await expect(main(page)).toContainText('График: раздел ещё не подключён');
    await expect(main(page)).toContainText('Сдача сдвигается на 01.12');
    await reloadReady(page);
    await expect(tabs(page).filter({ hasText: 'График' })).toHaveAttribute('aria-selected', 'true');
    await main(page).getByRole('button', { name: 'Объекты' }).click();
    await expect(h1(page, 'Объекты')).toBeVisible();
    await expect(page).not.toHaveURL(/obj=/);
  });

  test('клавиатура вкладок, неизвестный объект, 390', async ({ app, page }) => {
    await open(app, page, 'ЖК Северный парк · квартира 117');
    await tabs(page).first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs(page).nth(1)).toBeFocused();
    await expect(page).toHaveURL(/tab=works/);
    await page.keyboard.press('End');
    await expect(tabs(page).last()).toBeFocused();
    expect(await noHorizontalScroll(page)).toBe(true);
    await openRepair(app, page, { search: { obj: '00000000-0000-4000-8000-000000000000' } });
    await expect(heading(page, 'Объект не найден')).toBeVisible();
    await main(page).getByRole('button', { name: 'К списку объектов' }).click();
    await expect(h1(page, 'Объекты')).toBeVisible();
  });
});

test.describe('repair-works — работы, отметки, допработы @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  test.setTimeout(120_000);

  const work = (page: import('@playwright/test').Page) => main(page);

  test('владелец: «Принять объём» в обзоре → тост, пункт и бейдж «Работы» исчезают', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { search: {} });
    await main(page)
      .getByRole('button', { name: /ЖК Северный парк/ })
      .first()
      .click();
    await expect(tabs(page).nth(1)).toContainText('1');
    await main(page).getByRole('button', { name: 'Принять объём' }).click();
    await expect(toast(page)).toHaveText('Объём принят, материалы списаны');
    await expect(main(page).getByRole('button', { name: 'Принять объём' })).toHaveCount(0);
    await expect(tabs(page).nth(1)).toHaveText('Работы');
    await tabs(page).nth(1).click();
    await expect(page.locator('.ox-rp-chip', { hasText: 'Принят' }).first()).toBeVisible();
    await expect(work(page)).toContainText('WL-09');
  });

  test('владелец: вкладка «Работы» — объёмы, отметки с чипами, «Принять объём», допработы', async ({
    app,
    page,
  }) => {
    await openRepair(app, page);
    await main(page)
      .getByRole('button', { name: /ЖК Северный парк/ })
      .first()
      .click();
    await tabs(page).nth(1).click();
    const m = main(page);
    await expect(m.getByRole('heading', { level: 2, name: 'Объёмы работ' })).toBeVisible();
    await expect(m).toContainText('Факт учитывает только принятые отметки.');
    await expect(m.getByRole('heading', { level: 2, name: 'Отметка за сегодня' })).toHaveCount(0);
    await expect(m.locator('.ox-rp-chip', { hasText: 'На проверке' })).toBeVisible();
    await expect(m.getByRole('heading', { level: 2, name: 'Допработы' })).toBeVisible();
    await expect(m).toContainText(
      'Прораб предлагает допработу с объекта: описание, объём и фото. Офис оценивает её в смете, заказчик подписывает допсоглашение кодом из SMS.',
    );
    await m.getByRole('button', { name: 'Принять объём' }).click();
    await expect(toast(page)).toHaveText('Объём принят, материалы списаны');
  });

  test('владелец: допработа «Ждёт оценки офиса» → «Оценить в смете» открывает вкладку «Смета»', async ({
    app,
    page,
  }) => {
    await openRepair(app, page);
    await main(page)
      .getByRole('button', { name: /ЖК Речной/ })
      .first()
      .click();
    await tabs(page).nth(1).click();
    await expect(main(page)).toContainText('ДР-1');
    await expect(main(page)).toContainText('Ждёт оценки офиса');
    await main(page).getByRole('button', { name: 'Оценить в смете' }).click();
    await expect(page).toHaveURL(/tab=estimate/);
    await expect(page.locator('section[aria-labelledby="h-est"]')).toBeVisible();
  });

  test('прораб: форма отметки — ошибки полей по порядку эталона и отправка с фото', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { persona: 'foreman' });
    await main(page)
      .getByRole('button', { name: /ЖК Речной/ })
      .first()
      .click();
    await tabs(page).nth(1).click();
    const m = main(page);
    await expect(m.getByRole('heading', { level: 2, name: 'Отметка за сегодня' })).toBeVisible();
    const submit = m.getByRole('button', { name: 'Отправить отметку на приёмку' });
    await submit.click();
    await expect(m.getByRole('alert')).toHaveText('Объём должен быть больше нуля');
    await m.getByLabel('Объём', { exact: true }).first().fill('500');
    await m.getByRole('checkbox').first().check();
    await addPhoto(page, m.getByRole('button', { name: 'Добавить фото' }).first());
    await expect(m).toContainText('Фото в отчёте: 1');
    await submit.click();
    await expect(m.getByRole('alert')).toContainText(
      'Объём превышает план более чем на 10%: осталось',
    );
    await m.getByLabel('Объём', { exact: true }).first().fill('5,5');
    await submit.click();
    await expect(toast(page)).toHaveText('Отметка отправлена на приёмку');
    await expect(m.locator('.ox-rp-chip', { hasText: 'На проверке' }).first()).toBeVisible();
    await expect(m).toContainText('Фото в отчёте: 0');
  });

  test('прораб: нет бригады и фото — «Отметьте работников», «Добавьте хотя бы одно фото»', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { persona: 'foreman' });
    await main(page)
      .getByRole('button', { name: /ЖК Речной/ })
      .first()
      .click();
    await tabs(page).nth(1).click();
    const m = main(page);
    await m.getByLabel('Объём', { exact: true }).first().fill('3');
    await m.getByRole('button', { name: 'Отправить отметку на приёмку' }).click();
    await expect(m.getByRole('alert')).toHaveText('Отметьте работников');
    await m.getByRole('checkbox').first().check();
    await m.getByRole('button', { name: 'Отправить отметку на приёмку' }).click();
    await expect(m.getByRole('alert')).toHaveText('Добавьте хотя бы одно фото');
  });

  test('прораб: допработа — ошибки полей и «Отправить на оценку в офис»', async ({ app, page }) => {
    await openRepair(app, page, { persona: 'foreman' });
    await main(page)
      .getByRole('button', { name: /ЖК Речной/ })
      .first()
      .click();
    await tabs(page).nth(1).click();
    const m = main(page);
    await expect(m).toContainText(
      'Опишите работу и приложите фото, цены и сумму посчитает офис. После подписи допсоглашения заказчиком работа появится в объёмах.',
    );
    const send = m.getByRole('button', { name: 'Отправить на оценку в офис' });
    await send.click();
    await expect(m.getByRole('alert')).toHaveText('Опишите, что нужно сделать');
    await m
      .getByPlaceholder('Например, перенести розетки на кухне')
      .fill('Перенести розетки на кухне');
    await send.click();
    await expect(m.getByRole('alert')).toHaveText('Укажите объём больше нуля');
    await m.locator('.ox-rp-co-form').getByLabel('Объём').fill('4');
    await send.click();
    await expect(m.getByRole('alert')).toHaveText('Приложите хотя бы одно фото');
    await addPhoto(
      page,
      m.locator('.ox-rp-co-form').getByRole('button', { name: 'Добавить фото' }),
    );
    await send.click();
    await expect(toast(page)).toHaveText('Допработа отправлена в офис на оценку');
    await expect(m).toContainText('Перенести розетки на кухне · 4 шт');
    await expect(m.locator('.ox-rp-chip', { hasText: 'Ждёт оценки офиса' })).toHaveCount(2);
  });

  test('390: форма отметки — цели ≥ 44 px, без горизонтальной прокрутки', async ({ app, page }) => {
    await openRepair(app, page, { persona: 'foreman' });
    await main(page)
      .getByRole('button', { name: /ЖК Речной/ })
      .first()
      .click();
    // крошка «Объекты» — кнопка возврата к списку, цель ≥ 44 px
    if ((page.viewportSize()?.width ?? 1440) < 640) {
      expect(
        await hitHeight(
          main(page).locator('.ox-rp-crumbs').getByRole('button', { name: 'Объекты' }),
        ),
      ).toBeGreaterThanOrEqual(44);
    }
    await tabs(page).nth(1).click();
    expect(await noHorizontalScroll(page)).toBe(true);
    const m = main(page);
    expect(
      await hitHeight(m.getByRole('button', { name: 'Отправить отметку на приёмку' })),
    ).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(m.locator('.ox-rp-crew-item').first())).toBeGreaterThanOrEqual(44);
  });

  test('прораб: вкладка «Работы» каждого объекта — поля формы не шире экрана, без горизонтальной прокрутки', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { persona: 'foreman' });
    const names = ['ЖК Речной', 'ЖК Северный парк'];
    for (const name of names) {
      await openRepair(app, page, { persona: 'foreman' });
      const card = main(page)
        .getByRole('button', { name: new RegExp(name) })
        .first();
      await card.click();
      await tabs(page).nth(1).click();
      await expect(
        main(page).getByRole('heading', { level: 2, name: 'Объёмы работ' }),
      ).toBeVisible();
      await expect(
        main(page).getByRole('heading', { level: 2, name: 'Отметка за сегодня' }),
      ).toBeVisible();
      const overflow = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        return [...document.querySelectorAll('#ox-main select, #ox-main input, #ox-main textarea')]
          .map((el) => Math.round(el.getBoundingClientRect().right) - w)
          .filter((d) => d > 0);
      });
      expect(overflow, `${name}: поля за правым краем`).toEqual([]);
      expect(await noHorizontalScroll(page), `${name}: горизонтальная прокрутка`).toBe(true);
    }
  });
});

test.describe('modal-assign-foreman — «Назначить прораба?» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  test.setTimeout(90_000);

  test('«Не назначен прораб» → диалог → «Назначить» → тост, пункт и «Прораб не назначен» исчезают', async ({
    app,
    page,
  }) => {
    await openRepair(app, page);
    await main(page)
      .getByRole('button', { name: /Кофейня на Покровке/ })
      .first()
      .click();
    const m = main(page);
    await expect(m).toContainText('Не назначен прораб');
    await expect(m).toContainText(
      'Без прораба нет отметок работ и заявок на материалы · начало работ 06.10',
    );
    await expect(m).toContainText('Прораб не назначен');
    await expect(m).toContainText('Нужен до начала работ 06.10');
    await m.getByRole('button', { name: 'Назначить прораба' }).click();
    const dlg = page.getByRole('dialog', { name: 'Назначить прораба?' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Кофейня на Покровке · Алексей Соколов');
    await expect(dlg).toContainText('Что произойдёт');
    await expect(dlg).toContainText('Объект появится в списке объектов прораба');
    await expect(dlg).toContainText('Прораб сможет отправлять отметки работ и заявки на материалы');
    await expect(dlg).toContainText('Смета, цены и деньги объекта прорабу не видны');
    await dlg.getByRole('button', { name: 'Отмена' }).click();
    await expect(dlg).toHaveCount(0);
    await m.getByRole('button', { name: 'Назначить прораба' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Назначить' }).click();
    await expect(toast(page)).toHaveText('Прораб назначен: Алексей Соколов');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(m.getByRole('button', { name: 'Назначить прораба' })).toHaveCount(0);
    await expect(m).toContainText('Прораб · работает в CRM');
  });

  test('нет сотрудника с ролью «Прораб»: «Открыть пользователей»', async ({ app, page }) => {
    await openRepair(app, page, { scenario: 'listMembers=empty' });
    await main(page)
      .getByRole('button', { name: /Кофейня на Покровке/ })
      .first()
      .click();
    await main(page).getByRole('button', { name: 'Назначить прораба' }).click();
    const dlg = page.getByRole('dialog', { name: 'Нет сотрудника с ролью «Прораб»' });
    await expect(dlg).toContainText(
      'Выдайте роль в разделе «Пользователи и роли», затем назначьте прораба объекта.',
    );
    await dlg.getByRole('button', { name: 'Открыть пользователей' }).click();
    await expect(page).toHaveURL(/\/users/);
  });

  test('нет сотрудника с ролью «Прораб»: Escape возвращает фокус на «Назначить прораба»', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { scenario: 'listMembers=empty' });
    await main(page)
      .getByRole('button', { name: /Кофейня на Покровке/ })
      .first()
      .click();
    const trigger = main(page).getByRole('button', { name: 'Назначить прораба' });
    await trigger.click();
    const dlg = page.getByRole('dialog', { name: 'Нет сотрудника с ролью «Прораб»' });
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('axe: диалог «Назначить прораба?» без серьёзных нарушений (область последствий)', async ({
    app,
    page,
    axe,
  }) => {
    await openRepair(app, page);
    await main(page)
      .getByRole('button', { name: /Кофейня на Покровке/ })
      .first()
      .click();
    await main(page).getByRole('button', { name: 'Назначить прораба' }).click();
    const dlg = page.getByRole('dialog', { name: 'Назначить прораба?' });
    await expect(dlg).toContainText('Кофейня на Покровке · Алексей Соколов');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
  });

  test('пока грузятся сотрудники, диалог не открывается с мёртвыми кнопками', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { scenario: 'listMembers=delay=1500' });
    await main(page)
      .getByRole('button', { name: /Кофейня на Покровке/ })
      .first()
      .click();
    await main(page).getByRole('button', { name: 'Назначить прораба' }).click();
    // нет диалога с «Выполняем…» и неактивной «Отмена»
    await expect(page.getByRole('button', { name: 'Выполняем…' })).toHaveCount(0);
    const dlg = page.getByRole('dialog', { name: 'Назначить прораба?' });
    await expect(dlg).toContainText('Кофейня на Покровке · Алексей Соколов', { timeout: 10_000 });
    await expect(dlg.getByRole('button', { name: 'Отмена' })).toBeEnabled();
    await expect(dlg.getByRole('button', { name: 'Назначить', exact: true })).toBeEnabled();
  });

  test('«Прораб уже назначен»: текст сервера в тосте, объект перечитан', async ({ app, page }) => {
    await openRepair(app, page);
    await main(page)
      .getByRole('button', { name: /Кофейня на Покровке/ })
      .first()
      .click();
    await main(page).getByRole('button', { name: 'Назначить прораба' }).click();
    await devScenario(page, { scenario: 'assignRepairForeman=conflict', once: true });
    await page.getByRole('dialog').getByRole('button', { name: 'Назначить' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(toast(page)).toBeVisible();
  });
});

test.describe('repair-stand — страницы на backend @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'проверка на стенде compose');
  test.fixme(
    true,
    'backend «Ремонта и стройки» (W6.11) не влит в main: список, карточка и команды проверяются на стенде после него',
  );
  test('список объектов и карточка на стенде', () => {});
});
