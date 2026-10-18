// W2.20 · e2e страницы `logistics-fleet` «Рабочее место логиста» (S2-01, S2-02, S2-13; эталон design-stage-2 ·
// «Ортус CRM.dc.html» pg.fleet :428–520, fleetVM :3249–3307, assignVehicle :2787; docs/plan/analysis/03-logistics.md
// §5, чек-лист §14 п. 3, 5–13). Персонажи — «Логист · Марина Котова» (пресет logistics-ready) и владелец. Обязательные
// пункты verification-protocol §1.3: меню и URL, состояния, клавиатура, axe, 390 / 1440.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  FLEET_H1,
  fleet,
  fromMenu,
  holdBehindTheScreen,
  legs,
  openFleet,
  phone,
  stat,
  tab,
  tabs,
  tripValue,
  vehicleModels,
  vehicleRow,
} from './logistics.helpers.ts';
import { label, logisticsOn, newTrip, plan, realClock, UNIT, vehicles } from './logistics.stand.ts';

/** Машины назначения строки стенда: не нужны другим строкам и подходят лёгкому рейсу. */
const FLEET_PICK = ['Mercedes Sprinter', 'Ford Transit', 'Hyundai Porter'];
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';
import { openOnReference } from './visual/modules.compare.ts';

const COMPAT_NOTE =
  'Совместимость считается по сумме объёма и массы груза. Это не 3D-укладка и не проверка осевой нагрузки. Окончательно бронь подтверждает сервер.';

type Box = { x: number; y: number; width: number; height: number } | null;

/** Колонки рядом: верх карточки рейса на уровне верха подбора. */
const sideBySide = (main: Box, aside: Box): boolean =>
  Math.abs((aside?.y ?? 0) - (main?.y ?? 0)) < 2 && (aside?.x ?? 0) > (main?.x ?? 0);

/** Эталон: владелец подключает «Логистику» в «Модули и место» (как logistics-fleet.visual.spec.ts). */
async function connectLogisticsOnReference(page: Page): Promise<void> {
  await openOnReference(page, 'Модули и место', 'Модули');
  await page
    .locator('article')
    .filter({ has: page.getByRole('heading', { level: 3, name: 'Логистика' }) })
    .getByRole('button', { name: 'Подключить' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Подключить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

const ready = async (page: Page): Promise<void> => {
  await expect(h1(page, FLEET_H1)).toBeVisible();
  await expect(tabs(page)).toBeVisible();
};

test.describe('logistics-fleet — «Рабочее место логиста» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');

  test('меню «Логистика» → «Рабочее место логиста» и прямой URL: крошка, заголовок, пояснение', async ({
    app,
    page,
  }) => {
    await openFleet(app, page, { route: 'home' });
    await fromMenu(page, FLEET_H1, 'Логист');
    await expect(page).toHaveURL(/\/fleet$/);
    await ready(page);
    // Регион вне org_units.read логиста — подпись фирмы без региона (Q-W2.20-3).
    await expect(fleet(page).getByText('Север Логистик', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'Подбор машины под рейс: доступность, грузоподъёмность, объём, длина кузова и температура.',
      ),
    ).toBeVisible();
    await page.reload();
    await ready(page);
  });

  test('счётчики области логиста: 4 свободно, 0 в брони или рейсе, 0 ждут приёмки, 1 недоступно', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await ready(page);
    await expect(stat(page, 'свободно')).toHaveText('4');
    await expect(stat(page, 'в брони или рейсе')).toHaveText('0');
    await expect(stat(page, 'ждут приёмки')).toHaveText('0');
    await expect(stat(page, 'недоступно')).toHaveText('1');
  });

  test('вкладки «Рейсы»: Р-208 выбран, Р-211 рядом; подписи окна и состояния', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await ready(page);
    const first = tab(page, /Р-208 · Северный маршрут/);
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(first).toContainText('09:00–13:00 · Запланирован');
    await expect(tab(page, /Р-211 · Охлаждённая продукция/)).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  test('подбор Р-208: причины несовместимости, «Не подходит», «Недоступна», «Назначить на рейс»', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await ready(page);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Подбор транспорта · Р-208' }),
    ).toBeVisible();
    await expect(vehicleModels(page)).toHaveText([
      'ГАЗель Next',
      'Mercedes Sprinter',
      'ГАЗон Next',
      'Ford Transit',
      'Hyundai Porter',
    ]);
    const porter = vehicleRow(page, 'Hyundai Porter');
    await expect(porter).toContainText('Грузоподъёмность: 0,9 т (нужно от 1,1 т)');
    await expect(porter).toContainText('Объём: 9 м³ (нужно от 12 м³)');
    await expect(porter.getByRole('button', { name: 'Не подходит' })).toBeDisabled();
    const gazon = vehicleRow(page, 'ГАЗон Next');
    await expect(gazon).toContainText('Доступность: Недоступна · Плановое ТО до 03.10');
    await expect(gazon.getByRole('button', { name: 'Недоступна' })).toBeDisabled();
    const gazel = vehicleRow(page, 'ГАЗель Next');
    await expect(gazel).toContainText('Тент · Север Логистик · Склад № 1');
    await expect(gazel.getByRole('button', { name: 'Назначить на рейс' })).toBeEnabled();
    await expect(page.getByText(COMPAT_NOTE)).toBeVisible();
  });

  test('фильтры «Подходят» и «Свободны»; aria-pressed', async ({ app, page }) => {
    await openFleet(app, page);
    await ready(page);
    const filter = page.getByRole('group', { name: 'Фильтр' });
    await filter.getByRole('button', { name: 'Подходят' }).click();
    await expect(filter.getByRole('button', { name: 'Подходят' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(vehicleModels(page)).toHaveText([
      'ГАЗель Next',
      'Mercedes Sprinter',
      'ГАЗон Next',
    ]);
    await filter.getByRole('button', { name: 'Свободны' }).click();
    await expect(vehicleModels(page)).toHaveText([
      'ГАЗель Next',
      'Mercedes Sprinter',
      'Ford Transit',
      'Hyundai Porter',
    ]);
    await filter.getByRole('button', { name: 'Все' }).click();
    await expect(vehicleModels(page)).toHaveCount(5);
  });

  test('«Показать загрузку» у Mercedes Sprinter: участок 1 — 86 % объёма и 69 % массы', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await ready(page);
    await expect(
      page.getByText('Для ГАЗель Next · 16 м³ · 1,5 т. Объём и масса считаются раздельно.'),
    ).toBeVisible();
    const pick = vehicleRow(page, 'Mercedes Sprinter').getByRole('button', {
      name: 'Показать загрузку',
    });
    await pick.click();
    const shown = vehicleRow(page, 'Mercedes Sprinter').getByRole('button', {
      name: 'Загрузка показана',
    });
    await expect(shown).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByText('Для Mercedes Sprinter · 14 м³ · 1,6 т. Объём и масса считаются раздельно.'),
    ).toBeVisible();
    await expect(legs(page)).toHaveCount(3);
    await expect(legs(page).first()).toContainText('1. Склад № 1, Лобня');
    await expect(legs(page).first()).toContainText('Погрузка +12 м³ · 1,1 т');
    await expect(legs(page).first()).toContainText('86%');
    await expect(legs(page).first()).toContainText('69%');
    await expect(legs(page).first()).toContainText('В кузове после точки: 12 м³ · 1,1 т');
    await expect(legs(page).nth(1)).toContainText('Выгрузка −8 м³ · 0,7 т');
    await expect(
      page.getByRole('button', { name: 'Передать в навигатор · интеграция не подключена' }),
    ).toBeDisabled();
  });

  test('карточка Р-208: груз, требования, водитель, машина, маршрут', async ({ app, page }) => {
    await openFleet(app, page);
    await ready(page);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Р-208 · Северный маршрут' }),
    ).toBeVisible();
    await expect(tripValue(page, 'Груз')).toHaveText('Сухой груз · 14 паллет-мест · 1,1 т · 12 м³');
    await expect(tripValue(page, 'Требования')).toHaveText(
      'Кузов от 3 м · без температурного режима',
    );
    await expect(tripValue(page, 'Водитель')).toHaveText('Илья Васильев');
    await expect(tripValue(page, 'Машина')).toHaveText(
      'Выберет водитель при брони или назначит логист',
    );
    await expect(tripValue(page, 'Маршрут')).toHaveText('3 точки · 46 км');
    await expect(page.getByRole('button', { name: 'Найти водителя в пуле' })).toHaveCount(0);
  });

  test('«Назначить на рейс» ГАЗель Next: тост, чип «Назначена на Р-208», вкладка и карточка', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await ready(page);
    await vehicleRow(page, 'ГАЗель Next')
      .getByRole('button', { name: 'Назначить на рейс' })
      .click();
    await expect(toast(page)).toHaveText('Машина назначена на рейс Р-208');
    await expect(vehicleRow(page, 'ГАЗель Next')).toContainText('Назначена на Р-208');
    await expect(
      vehicleRow(page, 'ГАЗель Next').getByRole('button', { name: 'Назначить на рейс' }),
    ).toHaveCount(0);
    await expect(tab(page, /Р-208/)).toContainText('09:00–13:00 · Машина назначена');
    await expect(tripValue(page, 'Машина')).toHaveText('ГАЗель Next · А 412 МР 77');
    await expect(stat(page, 'свободно')).toHaveText('3');
    await expect(stat(page, 'в брони или рейсе')).toHaveText('1');
    await page.reload();
    await ready(page);
    await expect(vehicleRow(page, 'ГАЗель Next')).toContainText('Назначена на Р-208');
  });

  test('конфликт брони: тост role=alert «Конфликт: …», список перечитан, машина «Забронирована»', async ({
    app,
    page,
  }) => {
    const alta = await openFleet(app, page);
    await ready(page);
    await holdBehindTheScreen(page, alta, 'ГАЗель Next');
    await vehicleRow(page, 'ГАЗель Next')
      .getByRole('button', { name: 'Назначить на рейс' })
      .click();
    await expect(toast(page)).toHaveText(
      'Конфликт: Машину только что забронировали. Обновите список.',
    );
    await expect(page.locator('.ox-toast')).toHaveAttribute('role', 'alert');
    await expect(vehicleRow(page, 'ГАЗель Next')).toContainText('Забронирована');
    await expect(
      vehicleRow(page, 'ГАЗель Next').getByRole('button', { name: 'Недоступна' }),
    ).toBeDisabled();
    await expect(tab(page, /Конфликтный/)).toBeVisible();
  });

  test('Р-211: «Водитель» — «Не назначен», «Найти водителя в пуле» ведёт в «Ресурсный пул»; температура', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await ready(page);
    await tab(page, /Р-211/).click();
    await expect(tab(page, /Р-211/)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]trip=/);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Подбор транспорта · Р-211' }),
    ).toBeVisible();
    await expect(tripValue(page, 'Водитель')).toHaveText('Не назначен');
    await expect(tripValue(page, 'Машина')).toHaveText('Не выбрана');
    await expect(tripValue(page, 'Требования')).toHaveText('Кузов от 2,4 м · +2…+6 °C');
    await expect(vehicleRow(page, 'Ford Transit')).toContainText('Температура: -18…+8 °C');
    await expect(vehicleRow(page, 'ГАЗель Next')).toContainText(
      'Температура: без охлаждения (нужно +2…+6 °C)',
    );
    await page.reload();
    await ready(page);
    await expect(tab(page, /Р-211/)).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Найти водителя в пуле' }).click();
    await expect(page).toHaveURL(/\/pool$/);
  });

  test('владелец: «Альта Групп · все подразделения»; «Самара · весь регион» — «В выбранной области нет рейсов»', async ({
    app,
    page,
  }) => {
    await openFleet(app, page, { persona: 'owner' });
    await ready(page);
    await expect(fleet(page).getByText('Альта Групп · все подразделения')).toBeVisible();
    await expect(stat(page, 'свободно')).toHaveText('5');
    await expect(stat(page, 'в брони или рейсе')).toHaveText('1');
    await page.getByLabel('Область просмотра').selectOption({ label: 'Самара · весь регион' });
    await expect(fleet(page).getByText('Регион Самара', { exact: true })).toBeVisible();
    await expect(page.getByText('В выбранной области нет рейсов')).toBeVisible();
    await expect(
      page.getByText(
        'Смените область в верхней панели — рейсы демо запланированы в «Москва / Север Логистик».',
      ),
    ).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
    await expect(stat(page, 'свободно')).toHaveText('0');
    await expect(stat(page, 'в брони или рейсе')).toHaveText('1');
  });

  test('загрузка: скелетон «Загрузка», затем вкладки', async ({ app, page }) => {
    const alta = await openFleet(app, page);
    await ready(page);
    await devScenario(page, { scenario: 'listTripPlans=delay=1500', once: true });
    await page.reload();
    await expect(page.locator('#ox-main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await ready(page);
    expect(alta).toBeTruthy();
  });

  test('ошибка listVehicles: «Не удалось загрузить рабочее место: …» и «Повторить»', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await ready(page);
    await devScenario(page, { scenario: 'listVehicles=rate_limited' });
    await page.reload();
    await expect(page.getByText(/Не удалось загрузить рабочее место/)).toHaveText(
      'Не удалось загрузить рабочее место: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await ready(page);
  });

  test('нет связи: «Назначить на рейс» — тост warn, машина не назначена', async ({ app, page }) => {
    await openFleet(app, page);
    await ready(page);
    await devScenario(page, { scenario: 'assignTripVehicle=offline', once: true });
    await vehicleRow(page, 'ГАЗель Next')
      .getByRole('button', { name: 'Назначить на рейс' })
      .click();
    await expect(toast(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(
      vehicleRow(page, 'ГАЗель Next').getByRole('button', { name: 'Назначить на рейс' }),
    ).toBeEnabled();
  });

  test('модуль отключён с историей: баннер, назначения и планирования нет', async ({
    app,
    page,
  }) => {
    await openFleet(app, page, { persona: 'owner', off: true });
    await ready(page);
    await expect(
      page.getByRole('status').filter({ hasText: 'Модуль «Логистика» отключён.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Назначить на рейс' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Запланировать рейс' })).toHaveCount(0);
    await expect(vehicleRow(page, 'ГАЗель Next')).toContainText('Доступность: Свободна');
  });

  test('клавиатура: Tab доходит до вкладок, фильтров и кнопок строки; фокус виден', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await ready(page);
    const target = tab(page, /Р-211/);
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    const outline = await target.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(target).toHaveAttribute('aria-selected', 'true');
    const all = page
      .getByRole('group', { name: 'Фильтр' })
      .getByRole('button', { name: 'Подходят' });
    reached = false;
    for (let i = 0; i < 20 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await all.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
  });

  test('axe: нет нарушений serious и critical', async ({ app, page, axe }) => {
    await openFleet(app, page);
    await ready(page);
    const r = await axe(page);
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  // Q-W2.20-17 (W2.53): на эталоне колонки — flex-wrap с основой 560 и 320 px (pg.fleet :449, :476), рядом они
  // встают, только когда ширины хватает на обе. На 768 её нет: эталон, как и страница, ставит карточку рейса под
  // подбором. Тест сверяет раскладку с эталоном того же вьюпорта: 390 и 768 — столбик, 1440 — рядом.
  test('раскладка: 390 — без горизонтальной прокрутки, цели ≥ 44 px, колонки в столбик; 768 — столбик, как эталон; 1440 — рядом', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    test.slow();
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await connectLogisticsOnReference(ref.page);
    await openOnReference(ref.page, FLEET_H1, 'Логист');
    const refSide = await ref.page.evaluate(() => {
      // Колонки эталона — по основе flex из разметки (560 и 320 px), без классов.
      const col = (tag: string, basis: string) =>
        [...document.querySelectorAll<HTMLElement>(tag)]
          .find((e) => e.style.flexBasis === basis && e.offsetParent !== null)
          ?.getBoundingClientRect();
      const m = col('div', '560px');
      const a = col('aside', '320px');
      if (!m || !a) throw new Error('эталон: нет колонок подбора и карточки рейса');
      return Math.abs(a.y - m.y) < 2 && a.x > m.x;
    });
    await openFleet(app, page);
    await ready(page);
    expect(await noHorizontalScroll(page)).toBe(true);
    const main = page.locator('.ox-fl-main');
    const aside = page.locator('.ox-fl-aside');
    const [m, a] = [await main.boundingBox(), await aside.boundingBox()];
    expect(sideBySide(m, a), 'колонки рядом — как на эталоне этого вьюпорта').toBe(refSide);
    expect(refSide, `эталон ${testInfo.project.name}`).toBe(
      testInfo.project.name === 'desktop-1440',
    );
    if (!refSide) expect(a?.y ?? 0).toBeGreaterThan((m?.y ?? 0) + (m?.height ?? 0) - 1);
    if (phone(page)) {
      expect(a?.y ?? 0).toBeGreaterThan((m?.y ?? 0) + (m?.height ?? 0) - 1);
      const btn = vehicleRow(page, 'ГАЗель Next').getByRole('button', {
        name: 'Назначить на рейс',
      });
      expect(await hitHeight(btn)).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(
          page.getByRole('group', { name: 'Фильтр' }).getByRole('button', { name: 'Все' }),
        ),
      ).toBeGreaterThanOrEqual(44);
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
  });
});

// W2.53: backend машин, брони и рейсов (W2.02, W2.03) в main — fixme снят. Сид e2e-stand и уборка — logistics.stand.ts.
test.describe('logistics-fleet — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('логист на стенде: рейсы и машины области, назначение машины на свой рейс', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.slow();
    await realClock(page);
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/fleet`, { persona: 'manager' });
    await ready(page);
    // Назначение логиста снять нечем: его бронь без водителя API не отдаёт, а машина после назначения «Забронирована»
    // для любого другого рейса (вопрос W2.53). Поэтому проект берёт свою свободную машину из тех, что не нужны другим
    // строкам (ГАЗель — у водителей), а рейс — лёгкий: подходит любой из них.
    const pick = (await vehicles(page, s.tenant)).find(
      (v) => FLEET_PICK.includes(v.displayName) && v.status === 'available',
    );
    if (!pick) throw new Error(`свободных ${FLEET_PICK.join(', ')} нет — пересоздайте стенд`);
    const trip = await newTrip(page, s, {
      title: `Стенд ${label(testInfo.project.name)}`,
      vehicle: pick.displayName,
      light: true,
    });
    await app(`/t/${s.tenant}/fleet?trip=${trip.id}`, { persona: 'manager' });
    await ready(page);
    // Крошка — фирма права логиста. На стенде listOrgUnits отдаёт фирме вне области родителя parentId: null, и
    // страница подписывает её «Регион Север Логистик» (в mock — «Север Логистик»): вопрос W2.53 владельцу страницы.
    await expect(page.locator('.ox-fl-crumb')).toContainText(UNIT);
    await expect(tab(page, new RegExp(`^${trip.number} · `))).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(tab(page, /^Р-208 · Северный маршрут/)).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: `Подбор транспорта · ${trip.number}` }),
    ).toBeVisible();
    await expect(tripValue(page, 'Водитель')).toHaveText('Не назначен');
    await expect(tripValue(page, 'Требования')).toHaveText(
      'Кузов от 2 м · без температурного режима',
    );
    await expect(
      vehicleRow(page, 'ГАЗон Next').getByRole('button', { name: 'Недоступна' }),
    ).toBeDisabled();
    await vehicleRow(page, pick.displayName)
      .getByRole('button', { name: 'Назначить на рейс' })
      .click();
    await expect(toast(page)).toHaveText(`Машина назначена на рейс ${trip.number}`, {
      timeout: 15_000,
    });
    await expect(vehicleRow(page, pick.displayName)).toContainText(`Назначена на ${trip.number}`);
    await expect(tripValue(page, 'Машина')).toHaveText(
      `${pick.displayName} · ${pick.registrationNumber}`,
    );
    await page.reload();
    await ready(page);
    await expect(vehicleRow(page, pick.displayName)).toContainText(`Назначена на ${trip.number}`);
    const saved = (await plan(page, s.tenant, trip.id)).body as {
      state: string;
      vehicleId?: string;
    };
    expect(saved.state).toBe('assigned');
    expect(saved.vehicleId).toBe(pick.id);
  });
});
