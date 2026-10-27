// W7.33 · e2e страниц портала клиента `public-service-page` (`/s/{slug}`) и `public-service-request` (`/r/{token}`):
// эталон — design-2026-10-19 «Обращения - варианты.dc.html» 1a (экраны 2 «Оценка визита», 3 «Страница направления»,
// 4 «Ответ и оценка решения»). Без входа и оболочки, вход — личная ссылка (Q-W4.00-service-9). Данные — сценарный
// сервер W7.00 (тег PublicService, режим mock); backend портала — W7.31 (в main нет: @stand-spec — fixme).
// Гость в режиме mock — та же вкладка после выхода (состояние сценарного сервера живёт во вкладке).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { call, devScenario, phone, serious, smallTargets } from './forms-results.helpers.ts';
import { noHorizontalScroll } from './modules.helpers.ts';

/** Хост билета загрузки сценарного сервера (adapter/src/msw/files). */
const STORAGE = 'https://storage.example.invalid/**';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

type AppFn = (route: string, o?: { persona?: 'owner' }) => Promise<unknown>;
interface Receipt {
  key: string;
  token: string;
  statusLabel: string;
}

const col = (page: Page): Locator => page.locator('main.ox-sp');
const h1 = (page: Page): Locator => col(page).getByRole('heading', { level: 1 });
const errs = (page: Page): Locator => col(page).locator('.ox-sp-err');
const chip = (page: Page): Locator => col(page).locator('.ox-sp-chip');
const scale = (page: Page, label: string, n: number): Locator =>
  col(page)
    .getByRole('radiogroup', { name: label })
    .getByRole('radio', { name: `${n} из 5` });

/** Клиент создаёт обращение через публичный API (тот же вызов, что делает форма) и получает личную ссылку. */
async function submit(page: Page, typeId: string, text: string): Promise<Receipt> {
  const r = await call(page, 'POST', '/api/v1/public/service/mas/requests', {
    body: { typeId, text, consent: true, clientName: 'Ольга', phone: '+7 900 123-45-67' },
  });
  if (r.status !== 201)
    throw new Error(`submitPublicServiceRequest ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body as Receipt;
}

/** Сотрудник отвечает и ставит «Решено» (владелец «Альты» видит все направления). */
async function resolve(page: Page, app: AppFn, key: string): Promise<void> {
  await app('/', { persona: 'owner' });
  const tenant = (
    (await call(page, 'GET', '/api/v1/me/context')).body as {
      tenants: { name: string; tenantId: string }[];
    }
  ).tenants.find((t) => t.name === 'Альта Групп')?.tenantId;
  if (!tenant) throw new Error('нет организации «Альта Групп»');
  const base = `/api/v1/tenants/${tenant}/service/requests`;
  const list = await call(page, 'GET', base);
  const row = (list.body as { items: { id: string; key: string }[] }).items.find(
    (x) => x.key === key,
  );
  if (!row) throw new Error(`нет обращения ${key} в очереди`);
  const say = await call(page, 'POST', `${base}/${row.id}/messages`, {
    body: { kind: 'public', text: 'Извините, всё исправили.' },
  });
  if (say.status >= 300)
    throw new Error(`postServiceMessage ${say.status}: ${JSON.stringify(say.body)}`);
  const etag = (await call(page, 'GET', `${base}/${row.id}`)).headers.etag ?? '';
  const done = await call(page, 'POST', `${base}/${row.id}/transitions`, {
    body: { to: 'resolved', outcome: 'Разъяснено' },
    ifMatch: etag,
  });
  if (done.status >= 300)
    throw new Error(`transitionServiceRequest ${done.status}: ${JSON.stringify(done.body)}`);
}

/** Клиент открывает страницу без входа: mock — та же вкладка после выхода сотрудника. */
async function guest(page: Page, app: AppFn, route: string): Promise<void> {
  await call(page, 'POST', '/api/v1/dev/logout');
  await app(route);
}

test.describe('service-portal — «Портал клиента» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  });

  test('страница направления: шапка, «Чем помочь?», три группы типов, без оболочки', async ({
    app,
    page,
  }) => {
    await app('/s/mas');
    await expect(h1(page)).toHaveText('Чем помочь?');
    await expect(col(page)).toContainText('Альта Групп');
    await expect(col(page)).toContainText('Массаж');
    await expect(col(page).locator('.ox-sp-group h2')).toHaveText([
      'Оценить и поблагодарить',
      'Если что-то не так',
      'Другое',
    ]);
    for (const n of [
      'Спасибо мастеру',
      'Жалоба',
      'Вернуть деньги за услугу',
      'Вопрос',
      'Предложение',
    ])
      await expect(col(page).getByRole('button', { name: n })).toBeVisible();
    await expect(col(page).getByRole('button', { name: 'Оценить визит' })).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(col(page)).toContainText('Время работы:');
  });

  test('обращение с согласием: ошибки полей, отправка, квитанция с личной ссылкой, «Мои обращения · 1»', async ({
    app,
    page,
  }) => {
    await app('/s/mas');
    await col(page).getByRole('button', { name: 'Жалоба' }).click();
    await expect(h1(page)).toHaveText('Жалоба');
    await col(page).getByRole('button', { name: 'Отправить' }).click();
    await expect(errs(page)).toHaveText([
      'Опишите, что случилось',
      'Нужно согласие на обработку персональных данных',
    ]);
    await col(page).getByLabel('Ваше имя').fill('Ольга');
    await col(page).getByLabel('Телефон').fill('+7 900 12');
    await col(page)
      .getByLabel('Опишите, что случилось')
      .fill('Начали на 15 минут позже, в кабинете холодно');
    await col(page).getByLabel('Согласен на обработку персональных данных').check();
    await col(page).getByRole('button', { name: 'Отправить' }).click();
    await expect(errs(page)).toHaveText(['Телефон — не меньше 10 цифр']);
    await col(page).getByLabel('Телефон').fill('+7 900 123-45-67');
    await col(page).getByRole('button', { name: 'Отправить' }).click();
    await expect(h1(page)).toHaveText('Приняли ваше обращение');
    await expect(col(page).locator('dd').first()).toHaveText(/МАС-\d+/);
    await col(page).getByRole('link', { name: 'Следить за ответом' }).click();
    await expect(page).toHaveURL(/\/r\/tok_/);
    await expect(chip(page)).toContainText('Получили');
    await expect(col(page)).toContainText('Начали на 15 минут позже');
    await page.goBack();
    await expect(col(page).getByRole('button', { name: /Мои обращения · 1/ })).toBeVisible();
  });

  test('оценка визита по ссылке `?w=`: 1–3 с причинами и просьбой связаться → жалоба; 5 → спасибо', async ({
    app,
    page,
  }) => {
    await app('/s/mas?w=work-1');
    await col(page).getByRole('button', { name: 'Оценить визит' }).click();
    await expect(h1(page)).toHaveText('Как вам визит?');
    await expect(col(page)).toContainText('1 · плохо');
    await expect(col(page)).toContainText('5 · отлично');
    await col(page).getByRole('button', { name: 'Отправить' }).click();
    await expect(errs(page)).toHaveText(['Выберите оценку']);
    await scale(page, 'Оценка визита', 2).click();
    await expect(col(page).getByText('Что пошло не так?')).toBeVisible();
    const reason = col(page).getByRole('button', { name: 'Температура в кабинете' });
    await reason.click();
    await expect(reason).toHaveAttribute('aria-pressed', 'true');
    await col(page).getByLabel('Комментарий').fill('Холодно');
    await col(page).getByLabel('Свяжитесь со мной').check();
    await expect(col(page).getByText('Ответим в течение 2 часов')).toBeVisible();
    await col(page).getByLabel('Согласен на обработку персональных данных').check();
    await col(page).getByRole('button', { name: 'Отправить' }).click();
    await expect(errs(page)).toHaveText(['Телефон — не меньше 10 цифр']);
    await col(page).getByLabel('Телефон').fill('+7 900 123-45-67');
    await col(page).getByRole('button', { name: 'Отправить' }).click();
    await expect(h1(page)).toHaveText('Спасибо за оценку!');
    await expect(col(page)).toContainText('Мы открыли обращение');
    // 5 из 5 — без причин и без просьбы связаться.
    await col(page).getByRole('button', { name: 'Вернуться на страницу' }).click();
    await col(page).getByRole('button', { name: 'Оценить визит' }).click();
    await scale(page, 'Оценка визита', 5).click();
    await expect(col(page).getByText('Что пошло не так?')).toHaveCount(0);
    await col(page).getByLabel('Согласен на обработку персональных данных').check();
    await col(page).getByRole('button', { name: 'Отправить' }).click();
    await expect(col(page)).toContainText('Мы передали её команде.');
  });

  test('страница обращения: статус, лента «Получили · Ответили · Решено», переписка, «Написать»', async ({
    app,
    page,
  }) => {
    await app('/s/mas');
    const r = await submit(page, 'd-mas:complaint', 'Начали позже, холодно');
    await app(`/r/${r.token}`);
    await expect(col(page).locator('.ox-sp-key').first()).toHaveText(r.key);
    await expect(chip(page)).toContainText('Получили');
    const steps = col(page).locator('.ox-sp-steps .ox-sp-step-text');
    await expect(steps).toHaveCount(3);
    await expect(steps.first()).toHaveText(/^Получили \d\d:\d\d$/);
    await expect(col(page).getByText('Довольны ли решением?')).toHaveCount(0);
    const send = col(page).getByRole('button', { name: 'Отправить' });
    await expect(send).toBeDisabled();
    await col(page).getByLabel('Сообщение').fill('Жду ответа');
    await send.click();
    await expect(col(page).locator('.ox-sp-msg[data-mine]').last()).toContainText('Жду ответа');
    await expect(col(page).getByLabel('Сообщение')).toHaveValue('');
  });

  test('решённое обращение: «Довольны ли решением?» — одна оценка; «Вопрос не решён» возвращает в работу', async ({
    app,
    page,
  }) => {
    await app('/s/mas');
    const a = await submit(page, 'd-mas:thanks', 'Спасибо Анне');
    const b = await submit(page, 'd-mas:thanks', 'Спасибо Дарье');
    await resolve(page, app, a.key);
    await resolve(page, app, b.key);
    await guest(page, app, `/r/${a.token}`);
    await expect(chip(page)).toContainText('Решено');
    await expect(col(page).getByRole('heading', { name: 'Довольны ли решением?' })).toBeVisible();
    await expect(col(page).locator('.ox-sp-msg:not([data-mine])').first()).toContainText(
      'Извините, всё исправили.',
    );
    await scale(page, 'Оценка решения', 4).click();
    await expect(col(page).getByText('Вы уже оценили: 4 из 5')).toBeVisible();
    await expect(col(page).getByRole('radiogroup', { name: 'Оценка решения' })).toHaveCount(0);
    await app(`/r/${b.token}`);
    await col(page).getByRole('button', { name: 'Вопрос не решён — вернуть в работу' }).click();
    await col(page).getByLabel('Что осталось нерешённым?').fill('Боль вернулась');
    await col(page).getByRole('button', { name: 'Вернуть в работу' }).click();
    await expect(chip(page)).toContainText('Отвечаем');
    await expect(col(page)).toContainText('Боль вернулась');
    await expect(col(page).getByText('Довольны ли решением?')).toHaveCount(0);
  });

  test('вложение клиента: билет загрузки, файл в списке, сообщение уходит', async ({
    app,
    page,
  }) => {
    await app('/s/mas');
    const r = await submit(page, 'd-mas:question', 'Можно ли с ребёнком?');
    await app(`/r/${r.token}`);
    await col(page).getByLabel('Прикрепить фото').setInputFiles({
      name: 'stol.jpg',
      mimeType: 'image/jpeg',
      buffer: JPEG,
    });
    await expect(col(page).getByRole('button', { name: 'Убрать stol.jpg' })).toBeVisible();
    await col(page).getByRole('button', { name: 'Отправить' }).click();
    await expect(col(page).locator('.ox-sp-msg[data-mine]').last()).toBeVisible();
    await expect(col(page).getByRole('button', { name: 'Убрать stol.jpg' })).toHaveCount(0);
  });

  test('«СТОП»: отказ от опросов', async ({ app, page }) => {
    await app('/s/mas');
    const r = await submit(page, 'd-mas:question', 'Вопрос про запись');
    await app(`/r/${r.token}`);
    await expect(col(page)).toContainText('Не хотите опросов — ответьте СТОП');
    await col(page).getByRole('button', { name: 'Не присылать опросы' }).click();
    await expect(col(page)).toContainText('Хорошо, опросы больше не придут.');
  });

  test('состояния: неизвестные slug и токен (404), нет связи с повтором', async ({ app, page }) => {
    await app('/s/nope');
    await expect(h1(page)).toHaveText('Страница не найдена');
    await app('/r/tok_unknown00000000000000000');
    await expect(h1(page)).toHaveText('Страница не найдена');
    await app('/s/mas');
    await devScenario(page, { scenario: 'getPublicServicePage=offline' });
    await app('/s/kos');
    await expect(h1(page)).toHaveText('Нет связи');
    await devScenario(page, { scenario: null });
    await col(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(h1(page)).toHaveText('Чем помочь?');
  });

  test('клавиатура, axe; 390 — без прокрутки, цели 44 px', async ({ app, page, axe }) => {
    await app('/s/mas?w=work-1');
    await expect(h1(page)).toHaveText('Чем помочь?');
    expect(await serious(page, axe)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(col(page))).toEqual([]);
    await col(page).getByRole('button', { name: 'Оценить визит' }).click();
    await scale(page, 'Оценка визита', 1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(scale(page, 'Оценка визита', 2)).toHaveAttribute('aria-checked', 'true');
    await expect(scale(page, 'Оценка визита', 2)).toBeFocused();
    await expect(col(page).getByText('Что пошло не так?')).toBeVisible();
    expect(await serious(page, axe)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(col(page))).toEqual([]);
    await col(page).getByRole('button', { name: 'Назад' }).click();
    const r = await submit(page, 'd-mas:complaint', 'Холодно');
    await app(`/r/${r.token}`);
    await expect(chip(page)).toContainText('Получили');
    expect(await serious(page, axe)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(col(page))).toEqual([]);
  });
});

test.describe('service-portal — стенд @stand-spec', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  // backend портала (W7.31) в main не влит: операций PublicService на стенде нет.
  test.fixme('гость: страница направления → обращение → личная ссылка → оценка решения', async () => {});
});
