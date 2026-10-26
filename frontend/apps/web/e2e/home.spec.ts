// W2.25 · e2e страницы `home` «Главная» (эталон design-stage-2, «Ортус CRM.dc.html» :1708–1779, homeVM :4043–4137;
// чек-лист docs/plan/analysis/05-home-forms-tasks.md §9.1 п. 1–3, 5–11 без демо-пунктов, PD-54; реестр источников
// 01-shell.md §23; обязательные пункты verification-protocol.md §1.3). Очередь «Требует решения» —
// getMyDecisionQueue (MSW W2.00); источники задач, SPA, ремонта, обращений, документов, чатов, кассы — этапы 4–7
// (allowlist out-of-stage), поэтому у владельца «Альты» в очереди 2 карточки вместо 4 эталона.
import type { AxeResult } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import { card, cards, cardTitles, openHome, patchFleet, queue, tripIds } from './home.helpers.ts';
import { hitHeight, noHorizontalScroll, openPage } from './modules.helpers.ts';
import { devScenario, LOTOS } from './shell.helpers.ts';

const GREETING = /^(Доброе утро|Добрый день|Добрый вечер), /;
const SUMMARY_2 = 'Требует решения: 4. Сначала то, что блокирует работу.';
const EMPTY = 'Решений не требуется. Новые вопросы появятся здесь.';

const home = (page: Page) => page.locator('section[aria-labelledby="h-home"]');
const h2 = (page: Page, name: string) => page.getByRole('heading', { level: 2, name, exact: true });

/** Нарушения axe уровня serious и critical. */
const serious = (r: AxeResult): string[] =>
  r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);

test.describe('home — «Главная» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');

  test('открывается из меню «Главная» и по прямому URL: дата и область, приветствие, сводка', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await expect(page).toHaveURL(/\/home$/);
    const phone = (page.viewportSize()?.width ?? 0) < 640;
    const nav = phone
      ? page.getByRole('navigation', { name: 'Навигация', exact: true })
      : page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('button', { name: 'Главная' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Доброе утро, Дарья');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(GREETING);
    await expect(home(page)).toContainText('Четверг, 1 октября · Альта Групп · все подразделения');
    await expect(home(page).locator('p').first()).toHaveText(SUMMARY_2);
  });

  test('«Начало работы» владельца: «1 из 3», шаг 1 с «Модули и место», шаг 3 выполнен', async ({
    app,
    page,
  }) => {
    await openHome(app, page);
    const setup = page.locator('.ox-home-setup');
    await expect(setup.getByRole('heading', { level: 2 })).toHaveText('Начало работы');
    await expect(setup).toContainText('1 из 3');
    const steps = setup.getByRole('listitem');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText('Подключить отраслевой модуль');
    await expect(steps.nth(0)).toContainText(
      'Например, «Логистика» — машины, рейсы, осмотры и приёмка смен',
    );
    await expect(steps.nth(0).getByRole('button', { name: 'Модули и место' })).toBeVisible();
    await expect(steps.nth(1)).toContainText('Назначить роли с областью');
    await expect(steps.nth(1).getByRole('button', { name: 'Назначить роль' })).toBeVisible();
    await expect(steps.nth(2)).toContainText('Пригласить сотрудников');
    await expect(steps.nth(2).getByRole('button')).toHaveCount(0);
    await steps.nth(0).getByRole('button', { name: 'Модули и место' }).click();
    await expect(page).toHaveURL(/\/modules$/);
  });

  test('очередь владельца: пробный период и сотрудники без роли — тег, текст, кнопка', async ({
    app,
    page,
  }) => {
    await openHome(app, page);
    await expect(h2(page, 'Требует решения')).toBeVisible();
    await expect(cards(page)).toHaveCount(4);
    expect(await cardTitles(page)).toEqual([
      'Пробный период: осталось 12 дней',
      '3 сотрудника без роли',
      'T-63 · Обновить регламент приёмки смены',
      'L-31 · Квартира 64 м², Химки',
    ]);
    const trial = card(page, 'Пробный период: осталось 12 дней');
    await expect(trial).toContainText('Подписка');
    await expect(trial).toContainText(
      'До 13.10.2026. После окончания история останется доступной для чтения',
    );
    await expect(trial.getByRole('button', { name: 'Модули и место' })).toBeVisible();
    const noRole = card(page, '3 сотрудника без роли');
    await expect(noRole).toContainText('Доступ');
    await expect(noRole).toContainText(
      'Марина Котова, Вера Котельникова, Тимур Ахмедов — нет доступа к модулям',
    );
    await noRole.getByRole('button', { name: 'Назначить' }).click();
    await expect(page).toHaveURL(/\/users\?tab=people$/);
  });

  test('«Сегодня в работе» владельца: пунктир «Логистика» и «Ремонт и стройка», «Подключить»', async ({
    app,
    page,
  }) => {
    await openHome(app, page);
    await expect(h2(page, 'Сегодня в работе')).toBeVisible();
    const off = page.locator('.ox-home-off');
    await expect(off).toHaveCount(2);
    await expect(off.nth(0)).toContainText('Логистика');
    await expect(off.nth(0)).toContainText('Модуль не подключён');
    await expect(off.nth(1)).toContainText('Ремонт и стройка');
    await expect(h2(page, 'Рейсы сегодня')).toHaveCount(0);
    await expect(h2(page, 'Последние события')).toBeVisible();
    await off.nth(0).getByRole('button', { name: 'Подключить' }).click();
    await expect(page).toHaveURL(/\/modules$/);
  });

  test('логист без роли: «Область не назначена», «Срочных вопросов нет.», пустая очередь', async ({
    app,
    page,
  }) => {
    await openHome(app, page, { persona: 'manager' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Доброе утро, Марина');
    await expect(home(page)).toContainText('Четверг, 1 октября · Область не назначена');
    // W4.81: срочная задача логиста T-64 — в «Требует решения», карточка «Задачи» — в «Сегодня в работе».
    await expect(home(page).locator('p').first()).toHaveText(
      'Требует решения: 1. Сначала то, что блокирует работу.',
    );
    await expect(cards(page)).toHaveCount(1);
    await expect(card(page, 'T-64 · Найти водителя на рейс Р-211')).toBeVisible();
    await expect(page.locator('.ox-home-setup')).toHaveCount(0);
    await expect(page.locator('.ox-home-work')).toHaveCount(1);
    await expect(page.locator('.ox-home-work')).toContainText('Задачи');
    await expect(home(page)).toContainText('Событий пока нет');
  });

  test('«Логистика» подключена: «Рейс Р-211 без водителя» → «Найти в пуле», «Сегодня в работе», «Рейсы сегодня»', async ({
    app,
    page,
  }) => {
    await openHome(app, page, { persona: 'manager', preset: 'logistics-ready' });
    await expect(home(page)).toContainText('Четверг, 1 октября · Север Логистик');
    await expect(home(page).locator('p').first()).toHaveText(
      'Требует решения: 2. Сначала то, что блокирует работу.',
    );
    const trip = card(page, 'Рейс Р-211 без водителя');
    await expect(trip).toContainText('Сегодня 14:00');
    await expect(trip).toContainText('Охлаждённая продукция · Молочная продукция · +2…+6 °C');
    // Карточка «Задачи» (W4.81) — после логистики.
    await expect(page.locator('.ox-home-work')).toHaveCount(2);
    await expect(page.locator('.ox-home-work').nth(1)).toContainText('Задачи');
    const work = page.locator('.ox-home-work').first();
    await expect(work).toContainText('Логистика');
    for (const line of ['Рейсов сегодня', 'В пути', 'Свободных машин', 'Ждут приёмки']) {
      await expect(work).toContainText(line);
    }
    const trips = page.locator('.ox-home-trips');
    await expect(trips.getByRole('heading', { level: 2 })).toHaveText('Рейсы сегодня');
    await expect(trips.getByRole('button')).toHaveCount(2);
    await expect(trips.getByRole('button').nth(0)).toContainText('Р-208 · Северный маршрут');
    await expect(trips.getByRole('button').nth(1)).toContainText('Р-211 · Охлаждённая продукция');
    await expect(trips.getByRole('button').nth(1)).toContainText('без водителя');
    await expect(trips.getByRole('button').nth(0)).toContainText('Запланирован');
    await trip.getByRole('button', { name: 'Найти в пуле' }).click();
    await expect(page).toHaveURL(/\/pool$/);
  });

  test('блокирующий дефект и смена на приёмке: danger → warn → info, «Решить» → «Приёмка смен» ?trip=', async ({
    app,
    page,
  }) => {
    const alta = await openHome(app, page, { persona: 'manager', preset: 'logistics-ready' });
    await expect(card(page, 'Рейс Р-211 без водителя')).toBeVisible();
    const ids = await tripIds(page, alta);
    await patchFleet(page, alta, ['defect', 'submitted']);
    await page.reload();
    await expect(cards(page)).toHaveCount(4);
    expect(await cardTitles(page)).toEqual([
      'Критический дефект · рейс Р-208',
      'T-64 · Найти водителя на рейс Р-211',
      'Смена Р-205 ждёт приёмки',
      'Рейс Р-211 без водителя',
    ]);
    const defect = card(page, 'Критический дефект · рейс Р-208');
    await expect(defect).toContainText('Блокирует выезд');
    await expect(defect).toContainText('Стёкла: Скол · Илья Васильев');
    const review = card(page, 'Смена Р-205 ждёт приёмки');
    await expect(review).toContainText('Приёмка');
    await expect(review).toContainText('Илья Васильев · машина не вернётся в пул до решения');
    await expect(review.getByRole('button', { name: 'Проверить' })).toBeVisible();
    await defect.getByRole('button', { name: 'Решить' }).click();
    await expect(page).toHaveURL(new RegExp(`/review\\?trip=${ids['Р-208']}$`));
  });

  test('больше 8 карточек: «показано 8 из 11»', async ({ app, page }) => {
    const alta = await openHome(app, page, { persona: 'manager', preset: 'logistics-ready' });
    await expect(card(page, 'Рейс Р-211 без водителя')).toBeVisible();
    await patchFleet(page, alta, ['many-without-driver']);
    await page.reload();
    await expect(queue(page)).toContainText('показано 8 из 11');
    await expect(cards(page)).toHaveCount(8);
    await expect(home(page).locator('p').first()).toHaveText(
      'Требует решения: 11. Сначала то, что блокирует работу.',
    );
  });

  test('ошибка очереди: текст ошибки и «Повторить»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await devScenario(page, { scenario: 'getMyDecisionQueue=rate_limited', once: true });
    await page.reload();
    const err = queue(page).getByRole('alert');
    await expect(err).toBeVisible();
    await err.getByRole('button', { name: 'Повторить' }).click();
    await expect(cards(page)).toHaveCount(4);
  });

  test('загрузка: скелетон очереди до ответа', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await devScenario(page, { scenario: 'getMyDecisionQueue=delay=1500', once: true });
    await page.reload();
    await expect(queue(page).getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(cards(page)).toHaveCount(4);
  });

  test('пробный период завершён: danger «Пробный период завершён» → «Подробнее»', async ({
    app,
    page,
  }) => {
    await openHome(app, page, { preset: 'trial-ended' });
    const ended = card(page, 'Пробный период завершён');
    await expect(cards(page).first()).toContainText('Пробный период завершён');
    await expect(ended).toContainText('Подписка');
    await expect(ended).toContainText('Новые операции ограничены, данные сохранены');
    await ended.getByRole('button', { name: 'Подробнее' }).click();
    await expect(page).toHaveURL(/\/modules$/);
  });

  test('офлайн: баннер «Нет связи», «Главная» остаётся на экране', async ({ app, page }) => {
    await openHome(app, page);
    await expect(cards(page)).toHaveCount(4);
    await page.context().setOffline(true);
    await expect(page.getByText(/^Нет связи\./).first()).toBeVisible();
    await expect(cards(page)).toHaveCount(4);
    await page.context().setOffline(false);
  });

  test('владелец «Лотоса»: область «SPA «Лотос» · все подразделения», «, Ирина»', async ({
    app,
    page,
  }) => {
    await openHome(app, page, { persona: 'owner@t-lotos', tenant: LOTOS });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/, Ирина$/);
    await expect(home(page)).toContainText('SPA «Лотос» · все подразделения');
  });

  test('водитель: стартовая страница — не «Главная», пункта «Главная» в меню нет', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'driver' });
    await expect(page).not.toHaveURL(/\/home$/);
    await expect(page.getByRole('button', { name: 'Главная', exact: true })).toHaveCount(0);
  });

  // Возврат 1 (ревью W2.25, бриф §3): у водителя «Главной» в эталоне нет — прямой URL ведёт на его стартовую страницу,
  // офисная «Главная» (приветствие, «Логистика», «Рейсы сегодня») не показывается.
  test('водитель по прямому URL /t/…/home — на своей стартовой странице, без офисной «Главной»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'driver' });
    await expect(page).not.toHaveURL(/\/home$/);
    const start = new URL(page.url()).pathname;
    await openPage(app, page, 'home', { persona: 'driver' });
    await expect(page).toHaveURL(new RegExp(`${start}$`));
    await expect(home(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: GREETING })).toHaveCount(0);
  });

  test('390: без горизонтальной прокрутки, кнопка карточки — на своей строке, цели ≥ 44 px', async ({
    app,
    page,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 640, 'только телефон');
    await openHome(app, page);
    expect(await noHorizontalScroll(page)).toBe(true);
    const first = cards(page).first();
    const button = first.getByRole('button', { name: 'Модули и место' });
    const [cardBox, buttonBox] = [await first.boundingBox(), await button.boundingBox()];
    expect(buttonBox?.width ?? 0).toBeLessThan(cardBox?.width ?? 0);
    expect(await hitHeight(button)).toBeGreaterThanOrEqual(44);
  });

  // Возврат 1 (ревью W2.25, verification-protocol §1.3, Q-W1.24-21): цель нажатия ≥ 44 px у каждой кнопки «Главной»
  // на телефоне — шаги «Начала работы» (видимая 40 px эталона), карточки очереди, «Подключить», строки «Рейсов сегодня».
  for (const who of [
    { name: 'владелец', persona: 'owner' as const, preset: undefined },
    { name: 'логист с логистикой', persona: 'manager' as const, preset: 'logistics-ready' },
  ]) {
    test(`390: цели ≥ 44 px у всех кнопок «Главной» — ${who.name}`, async ({ app, page }) => {
      test.skip((page.viewportSize()?.width ?? 0) >= 640, 'только телефон');
      await openHome(app, page, {
        persona: who.persona,
        ...(who.preset ? { preset: who.preset } : {}),
      });
      await expect(cards(page).first()).toBeVisible();
      if (who.preset) await expect(page.locator('.ox-home-trip').first()).toBeVisible();
      else await expect(page.locator('.ox-home-step-action').first()).toBeVisible();
      const buttons = home(page).getByRole('button');
      const n = await buttons.count();
      expect(n).toBeGreaterThan(2);
      const low: string[] = [];
      for (let i = 0; i < n; i += 1) {
        const b = buttons.nth(i);
        const h = await hitHeight(b);
        if (h < 44) low.push(`${(await b.innerText()).replace(/\s+/g, ' ').trim()}: ${h}`);
      }
      expect(low).toEqual([]);
    });
  }

  test('клавиатура: Tab доходит до кнопок карточек, фокус виден', async ({ app, page }) => {
    await openHome(app, page);
    const target = card(page, '3 сотрудника без роли').getByRole('button', { name: 'Назначить' });
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press('Tab');
      if (await target.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(target).toBeFocused();
    const outline = await target.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('axe: нет нарушений serious/critical у владельца и логиста', async ({ app, page, axe }) => {
    // W2.81, возврат 1: вход двух персонажей и два прогона axe — под нагрузкой дольше 30 с.
    test.slow();
    await openHome(app, page);
    await expect(cards(page)).toHaveCount(4);
    expect(serious(await axe(page))).toEqual([]);
    await openHome(app, page, { persona: 'manager' });
    await expect(cards(page)).toHaveCount(1);
    expect(serious(await axe(page))).toEqual([]);
  });
});

// W2.80 · Время «Главной» — московское (core/clock TZ), а не пояс браузера: часы e2e — 01.10.2026 10:30 МСК, браузер —
// во Владивостоке (17:30 местного). До исправления — «Добрый день», «Сегодня 21:00».
test.describe('home — браузер в другом часовом поясе @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты — сценарный сервер mock');
  test.use({ timezoneId: 'Asia/Vladivostok' });

  test('логист: приветствие, дата, «Сегодня 14:00» и «Рейсы сегодня» — по Москве', async ({
    app,
    page,
  }) => {
    await openHome(app, page, { persona: 'manager', preset: 'logistics-ready' });
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
      'Asia/Vladivostok',
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Доброе утро, Марина');
    await expect(home(page)).toContainText('Четверг, 1 октября · Север Логистик');
    await expect(card(page, 'Рейс Р-211 без водителя')).toContainText('Сегодня 14:00');
    const trips = page.locator('.ox-home-trips');
    await expect(trips.getByRole('button')).toHaveCount(2);
    await expect(trips.locator('.ox-home-trip-time')).toHaveText(['09:00', '14:00']);
  });
});

test.describe('home — стенд @stand @stand-spec', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  // Возврат 1: W2.09 (modules/home, источник логистики) в main — fixme снят. Источники организации и доступа
  // (`tenant.*`, `access.members_without_role`) на backend отложены после показа 18.10 (отчёт W2.09), поэтому
  // карточек у владельца «Альты» без логистики на стенде нет: проверяется ответ 200 и согласие сводки со счётом.
  test('владелец «Альты»: очередь «Требует решения» по /me/decisions стенда', async ({
    app,
    page,
  }) => {
    const answer = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/me/decisions',
    );
    await app('/', { persona: 'owner' });
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 15_000 });
    const r = await answer;
    expect(r.status()).toBe(200);
    const body = (await r.json()) as { items: { kind: string }[]; total: number };
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(GREETING);
    await expect(h2(page, 'Требует решения')).toBeVisible();
    await expect(queue(page).getByRole('alert')).toHaveCount(0);
    // Виды с провайдером этапа 2 (`sources/<m>.ts`); прочие — out-of-stage, не показываются и не считаются (Q-W2.25-6).
    const known = body.items.filter((i) => /^(fleet|tenant|access|tasks)\./.test(i.kind)).length;
    const total = Math.max(body.total - (body.items.length - known), known);
    await expect(cards(page)).toHaveCount(Math.min(known, 8));
    if (total === 0) {
      await expect(queue(page)).toContainText(EMPTY);
      await expect(home(page).locator('p').first()).toHaveText('Срочных вопросов нет.');
    } else {
      await expect(home(page).locator('p').first()).toHaveText(
        `Требует решения: ${total}. Сначала то, что блокирует работу.`,
      );
    }
  });
});
