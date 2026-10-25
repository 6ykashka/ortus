// W4.70 · e2e страницы `public-form` «Публичная форма» гостя — `{origin}/f/{token}` и встраивание `?embed=1`
// (Q-W4.00-forms-21). Эталона нет (no-reference, forms.md §6, Q-W4.00-forms-19): рендер — общий `FormRender` вкладки
// «Предпросмотр» design-2026-10-19 «Формы и опросы.dc.html» dc:114–142. Без входа и оболочки; ответ гостя — «На
// проверке» (Q-W4.00-forms-18); параметры адреса — только для скрытых вопросов (Q-W4.05-26, Q-W4.00-forms-20). Данные —
// MSW тега PublicForms (W4.70) и backend W4.21 (режим stand). Гость в режиме mock — та же вкладка после выхода
// (состояние сценарного сервера живёт во вкладке), в режиме stand — свой контекст браузера без сессии.
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import type { Session } from './_stand/fixtures.ts';
import {
  call,
  devScenario,
  patchForm,
  phone,
  serious,
  smallTargets,
} from './forms-results.helpers.ts';
import { noHorizontalScroll } from './modules.helpers.ts';
import { ALTA, tenantId } from './shell.helpers.ts';

const THANKS = 'Спасибо! Ответ отправлен.';
/** Хост билета загрузки сценарного сервера (adapter/src/msw/files). */
const STORAGE = 'https://storage.example.invalid/**';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const card = (page: Page): Locator => page.locator('.ox-fm-pv-card');
const state = (page: Page): Locator => page.locator('.ox-ff-state');
const send = (page: Page): Locator => card(page).getByRole('button', { name: 'Отправить' });
const alert = (page: Page): Locator => page.locator('.ox-ff-alert');
const stars = (page: Page, label: string, k: number): Locator =>
  card(page)
    .getByRole('radiogroup', { name: label })
    .getByRole('radio', { name: `${k} из 5` });

type Q = Record<string, unknown>;
type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;
interface Made {
  tenant: string;
  form: string;
  token: string;
}

const uniq = (base: string): string => `${base} ${Math.random().toString(36).slice(2, 7)}`;

async function ok<T>(p: Promise<{ status: number; body: unknown }>, what: string): Promise<T> {
  const r = await p;
  if (r.status >= 300) throw new Error(`${what} ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body as T;
}

/**
 * Публичная форма «Альты» через API владельца: шаблон `templateId` («Форма обратной связи» — публичная) или пустая с
 * вопросами `fields`; «Все, у кого есть ссылка», опубликована v1; токен — FormShare.publicToken.
 */
async function makePublic(
  page: Page,
  o: { name: string; templateId?: string; fields?: Q[] },
): Promise<Made> {
  const tenant = await tenantId(page, ALTA);
  const base = `/api/v1/tenants/${tenant}/forms`;
  const f = await ok<{ id: string }>(
    call(page, 'POST', base, {
      body: { name: o.name, orgUnitId: null, templateId: o.templateId ?? 'blank' },
    }),
    'createForm',
  );
  const url = `${base}/${f.id}`;
  if (o.fields) {
    const d = await call(page, 'GET', `${url}/draft`);
    await ok(
      call(page, 'PUT', `${url}/draft`, {
        body: { definition: { pages: [{ id: 'p1', title: 'Заявка' }], fields: o.fields } },
        ifMatch: d.headers.etag ?? '',
      }),
      'saveFormDraft',
    );
  }
  await patchForm(page, { tenant, form: f.id }, { settings: { access: 'public' } });
  await publish(page, url);
  const form = await ok<{ share: { publicToken: string | null } }>(
    call(page, 'GET', url),
    'getForm',
  );
  if (!form.share.publicToken) throw new Error('нет публичной ссылки');
  return { tenant, form: f.id, token: form.share.publicToken };
}

/** Публикация черновика (publishForm, If-Match — ETag формы). */
async function publish(page: Page, url: string): Promise<void> {
  const cur = await call(page, 'GET', url);
  const draft = await ok<{ revision: number }>(call(page, 'GET', `${url}/draft`), 'getFormDraft');
  await ok(
    call(page, 'POST', `${url}/publish`, {
      body: { draftRevision: draft.revision },
      ifMatch: cur.headers.etag ?? '',
    }),
    'publishForm',
  );
}

/** Владелец «Альты» (вход персонажа и service worker MSW). */
async function asOwner(app: AppFn, page: Page): Promise<void> {
  await app('/', { persona: 'owner' });
  await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15_000 })
    .catch(() => undefined);
}

/** Гость по ссылке: mock — та же вкладка после выхода; stand — новый контекст без сессии. */
async function guest(
  x: { mode: string; app: AppFn; page: Page; session: () => Promise<Session> },
  route: string,
): Promise<Page> {
  if (x.mode === 'mock') {
    await call(x.page, 'POST', '/api/v1/dev/logout');
    await x.app(route);
    return x.page;
  }
  const s = await x.session();
  await s.open(route);
  return s.page;
}

/** «Ответы» формы у владельца: верхняя (новая) карточка ленты. */
async function ownerResponses(app: AppFn, page: Page, m: Made): Promise<void> {
  await app(`/t/${m.tenant}/forms?form=${m.form}&tab=responses`, { persona: 'owner' });
  await page
    .getByRole('group', { name: 'Вид ответов' })
    .getByRole('button', { name: 'Лента', exact: true })
    .click();
  await expect(page.locator('.ox-fr-resp')).toBeVisible({ timeout: 20_000 });
}

test.describe('public-form — «Публичная форма» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  });

  test('гость по ссылке без входа и оболочки: «Альта Групп», «Отзыв», ответ → «Спасибо»; владелец — «На проверке», «Гость»', async ({
    app,
    page,
    session,
    harness,
  }) => {
    await asOwner(app, page);
    const m = await makePublic(page, {
      name: uniq('Отзыв о доставке'),
      templateId: 'tpl-feedback',
    });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}`);
    await expect(card(g).locator('.ox-fm-pv-logo')).toHaveText(/Альта Групп/);
    await expect(card(g).getByRole('heading', { level: 2, name: 'Отзыв' })).toBeVisible();
    await expect(g.getByRole('navigation')).toHaveCount(0);
    await stars(g, 'Оцените работу', 5).click();
    await card(g).getByRole('radio', { name: 'Да', exact: true }).click();
    await card(g).getByLabel('Комментарий').fill('Привезли вовремя');
    await send(g).click();
    await expect(card(g)).toContainText(THANKS);
    await expect(card(g).getByRole('button', { name: 'Пройти ещё раз' })).toHaveCount(0);
    await ownerResponses(app, page, m);
    await expect(page.locator('.ox-fr-resp-status')).toHaveText('На проверке');
    await expect(page.locator('.ox-fr-resp-note')).toContainText('Гость');
  });

  test('условие показа: «Нет» → «Что нам улучшить?» обязателен — «Обязательный вопрос»', async ({
    app,
    page,
    session,
    harness,
  }) => {
    await asOwner(app, page);
    const m = await makePublic(page, { name: uniq('Отзыв о сервисе'), templateId: 'tpl-feedback' });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}`);
    await expect(card(g).getByLabel('Что нам улучшить?')).toHaveCount(0);
    await stars(g, 'Оцените работу', 2).click();
    await card(g).getByRole('radio', { name: 'Нет', exact: true }).click();
    await expect(card(g).getByLabel('Что нам улучшить?')).toBeVisible();
    await send(g).click();
    await expect(card(g).getByRole('alert')).toHaveText('Обязательный вопрос');
    await card(g).getByLabel('Что нам улучшить?').fill('Звонить заранее');
    await send(g).click();
    await expect(card(g)).toContainText(THANKS);
  });

  test('скрытый вопрос из параметра ссылки (?q-src=…), лишние параметры не уходят', async ({
    app,
    page,
    session,
    harness,
  }) => {
    await asOwner(app, page);
    const m = await makePublic(page, {
      name: uniq('Заявка с сайта'),
      fields: [
        { key: 'q-text', pageId: 'p1', type: 'longtext', label: 'Ваш вопрос', required: true },
        {
          key: 'q-src',
          pageId: 'p1',
          type: 'text',
          label: 'Источник',
          required: false,
          hidden: true,
          defaultValue: 'сайт',
        },
      ],
    });
    const g = await guest(
      { mode: harness.mode, app, page, session },
      `/f/${m.token}?q-src=email&utm_source=promo`,
    );
    await expect(card(g).getByLabel('Источник')).toHaveCount(0);
    const sent = g.waitForRequest((r) => r.method() === 'POST' && /\/responses$/.test(r.url()));
    await card(g).getByLabel('Ваш вопрос').fill('Есть ли доставка в область?');
    await send(g).click();
    expect((await sent).postDataJSON()).toMatchObject({ linkParams: { 'q-src': 'email' } });
    expect(Object.keys((await sent).postDataJSON().linkParams)).toEqual(['q-src']);
    await expect(card(g)).toContainText(THANKS);
    await asOwner(app, page);
    const r = await call(page, 'GET', `/api/v1/tenants/${m.tenant}/forms/${m.form}/responses`);
    const top = (r.body as { items: { linkParamKeys?: string[]; answers: Q[] }[] }).items[0];
    expect(top?.linkParamKeys).toEqual(['q-src']);
    expect(top?.answers).toContainEqual({
      fieldKey: 'q-src',
      value: { type: 'text', value: 'email' },
    });
  });

  test('встраивание ?embed=1: только форма, без отступов страницы; отправка работает', async ({
    app,
    page,
    session,
    harness,
  }) => {
    await asOwner(app, page);
    const m = await makePublic(page, { name: uniq('Отзыв на сайте'), templateId: 'tpl-feedback' });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}?embed=1`);
    await expect(g.locator('.ox-ff')).toHaveAttribute('data-embed', '');
    await stars(g, 'Оцените работу', 4).click();
    await card(g).getByRole('radio', { name: 'Не знаю' }).click();
    await send(g).click();
    await expect(card(g)).toContainText(THANKS);
  });

  test('файл гостя: загрузка, проверка до «ready», отправка; владелец видит «1 фото»', async ({
    app,
    page,
    session,
    harness,
  }) => {
    await asOwner(app, page);
    const m = await makePublic(page, {
      name: uniq('Заявка на ремонт'),
      fields: [
        { key: 'q-what', pageId: 'p1', type: 'text', label: 'Что случилось', required: true },
        { key: 'q-photo', pageId: 'p1', type: 'photo', label: 'Фото', required: true, maxFiles: 3 },
      ],
    });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}`);
    await card(g).getByLabel('Что случилось').fill('Течёт кран');
    const chooser = g.waitForEvent('filechooser');
    await card(g).getByRole('button', { name: 'Прикрепить файл' }).click();
    await (await chooser).setFiles({ name: 'kran.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(card(g)).toContainText('Проверяем «kran.jpg»…');
    await send(g).click();
    await expect(card(g).getByRole('alert')).toHaveText('Файл ещё проверяется — подождите');
    await call(g, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
    await expect(card(g)).toContainText('1 файл из 3', { timeout: 15_000 });
    await send(g).click();
    await expect(card(g)).toContainText(THANKS);
    await ownerResponses(app, page, m);
    await expect(page.locator('.ox-fr-resp')).toContainText('1 фото');
  });

  test('«Приём ответов закрыт» — закрытая форма', async ({ app, page, session, harness }) => {
    await asOwner(app, page);
    const m = await makePublic(page, { name: uniq('Опрос гостей'), templateId: 'tpl-feedback' });
    await patchForm(page, m, { status: 'closed' });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}`);
    await expect(state(g).getByRole('heading', { level: 1 })).toHaveText('Приём ответов закрыт');
    await expect(card(g)).toHaveCount(0);
  });

  test('новая версия между открытием и отправкой — «Форма обновилась — откройте её заново»', async ({
    app,
    page,
    session,
    harness,
  }) => {
    await asOwner(app, page);
    const m = await makePublic(page, { name: uniq('Отзыв о курьере'), templateId: 'tpl-feedback' });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}`);
    await stars(g, 'Оцените работу', 3).click();
    await card(g).getByRole('radio', { name: 'Да', exact: true }).click();
    // Владелец публикует v2 (в mock — вход в той же вкладке: публичные операции сессию не читают).
    await call(page, 'POST', '/api/v1/dev/login', { body: { persona: 'owner' } });
    const url = `/api/v1/tenants/${m.tenant}/forms/${m.form}`;
    const d = await call(page, 'GET', `${url}/draft`);
    const def = (d.body as { definition: { pages: Q[]; fields: Q[] } }).definition;
    def.fields.push({
      key: 'q-new',
      pageId: def.fields[0]?.pageId,
      type: 'text',
      label: 'Город',
      required: false,
    });
    await ok(
      call(page, 'PUT', `${url}/draft`, {
        body: { definition: def },
        ifMatch: d.headers.etag ?? '',
      }),
      'saveFormDraft',
    );
    await publish(page, url);
    await send(g).click();
    await expect(state(g).getByRole('heading', { level: 1 })).toHaveText(
      'Форма обновилась — откройте её заново',
    );
    await state(g).getByRole('button', { name: 'Открыть заново' }).click();
    await expect(card(g).getByLabel('Город')).toBeVisible();
  });

  test('неизвестная ссылка — «Форма не найдена»; форма больше не публичная — «Ссылка недействительна»', async ({
    app,
    page,
    session,
    harness,
  }) => {
    await asOwner(app, page);
    const m = await makePublic(page, {
      name: uniq('Отзыв о магазине'),
      templateId: 'tpl-feedback',
    });
    await patchForm(page, m, { settings: { access: 'members' } });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}`);
    await expect(state(g).getByRole('heading', { level: 1 })).toHaveText('Ссылка недействительна');
    await app('/f/fUnknownToken000000000000000000');
    await expect(state(g).getByRole('heading', { level: 1 })).toHaveText('Форма не найдена');
  });

  test('нет связи при отправке: ответы на месте, повтор с тем же нонсом — «Спасибо»', async ({
    app,
    page,
    session,
    harness,
  }) => {
    await asOwner(app, page);
    const m = await makePublic(page, { name: uniq('Отзыв о мастере'), templateId: 'tpl-feedback' });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}`);
    await stars(g, 'Оцените работу', 5).click();
    await card(g).getByRole('radio', { name: 'Да', exact: true }).click();
    await devScenario(g, { scenario: 'submitPublicForm=offline' });
    await send(g).click();
    await expect(alert(g)).toHaveText('Нет связи с сервером. Ответ не отправлен — повторите.');
    await devScenario(g, { scenario: null });
    await send(g).click();
    await expect(card(g)).toContainText(THANKS);
  });

  test('клавиатура, axe; 390 — без прокрутки, цели 44 px', async ({
    app,
    page,
    session,
    harness,
    axe,
  }) => {
    await asOwner(app, page);
    const m = await makePublic(page, { name: uniq('Отзыв о звонке'), templateId: 'tpl-feedback' });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}`);
    await stars(g, 'Оцените работу', 1).focus();
    await g.keyboard.press('Enter');
    await expect(stars(g, 'Оцените работу', 1)).toHaveAttribute('aria-checked', 'true');
    await g.keyboard.press('Tab');
    await expect(g.locator(':focus')).toHaveCount(1);
    expect(await serious(g, axe)).toEqual([]);
    expect(await noHorizontalScroll(g)).toBe(true);
    if (phone(g)) expect(await smallTargets(card(g))).toEqual([]);
  });
});

// Backend гостя — W4.21 (в main): публичная ссылка на стенде слота.
test.describe('public-form — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(120_000);

  test('гость отвечает по публичной ссылке; владелец видит ответ «На проверке» в «Ответах»', async ({
    app,
    page,
    session,
    harness,
  }) => {
    await app('/', { persona: 'owner' });
    const m = await makePublic(page, { name: uniq('Отзыв клиента'), templateId: 'tpl-feedback' });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}`);
    await expect(card(g).locator('.ox-fm-pv-logo')).toHaveText(/Альта Групп/);
    await stars(g, 'Оцените работу', 5).click();
    await card(g).getByRole('radio', { name: 'Да', exact: true }).click();
    await card(g).getByLabel('Комментарий').fill('Спасибо за быструю доставку');
    await send(g).click();
    await expect(card(g)).toContainText(THANKS);
    await ownerResponses(app, page, m);
    await expect(page.locator('.ox-fr-resp-status')).toHaveText('На проверке');
    await expect(page.locator('.ox-fr-resp')).toContainText('Спасибо за быструю доставку');
  });

  test('файл гостя на стенде: загрузка по нонсу (MinIO), проверка cmd/worker до ready, ответ с фото', async ({
    app,
    page,
    session,
    harness,
  }) => {
    await app('/', { persona: 'owner' });
    const m = await makePublic(page, {
      name: uniq('Заявка с фото'),
      fields: [
        { key: 'q-what', pageId: 'p1', type: 'text', label: 'Что случилось', required: true },
        { key: 'q-photo', pageId: 'p1', type: 'photo', label: 'Фото', required: true, maxFiles: 3 },
      ],
    });
    const g = await guest({ mode: harness.mode, app, page, session }, `/f/${m.token}`);
    await card(g).getByLabel('Что случилось').fill('Разбито стекло');
    const chooser = g.waitForEvent('filechooser');
    await card(g).getByRole('button', { name: 'Прикрепить файл' }).click();
    await (await chooser).setFiles({ name: 'steklo.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(card(g)).toContainText('1 файл из 3', { timeout: 60_000 });
    await send(g).click();
    await expect(card(g)).toContainText(THANKS);
    await ownerResponses(app, page, m);
    await expect(page.locator('.ox-fr-resp-status')).toHaveText('На проверке');
    await expect(page.locator('.ox-fr-resp')).toContainText('Разбито стекло');
  });
});
