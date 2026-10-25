// W4.70 · e2e страницы `form-fill` «Заполнение формы» сотрудником — `{origin}/forms/{id}` (Q-W4.00-forms-21). Эталона
// нет (no-reference, forms.md §6, Q-W4.00-forms-19): рендер — общий `FormRender` вкладки «Предпросмотр»
// design-2026-10-19 «Формы и опросы.dc.html» dc:114–142 без панели предпросмотра. Данные — MSW W4.05 (тег Forms) и
// backend W4.21 (режим stand). Обязательные пункты verification-protocol §1.3: открытие по ссылке «Поделиться формой»
// и по прямому URL, состояния (загрузка, ошибка, нет связи, не найдено, нет доступа, без входа, закрыт, уже отвечали,
// форма обновилась), клавиатура, axe, 390 / 768 / 1440.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  call,
  devScenario,
  dialog,
  editor,
  formsApi,
  INSP,
  openForm,
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
/** Минимальный JPEG (SOI + EOI): хранилище mock содержимое не проверяет. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const card = (page: Page): Locator => page.locator('.ox-fm-pv-card');
const state = (page: Page): Locator => page.locator('.ox-ff-state');
const next = (page: Page): Locator => card(page).getByRole('button', { name: 'Далее' });
const send = (page: Page): Locator => card(page).getByRole('button', { name: 'Отправить' });
const alert = (page: Page): Locator => page.locator('.ox-ff-alert');

type Q = Record<string, unknown>;
interface Made {
  tenant: string;
  form: string;
  name: string;
}

const uniq = (base: string): string => `${base} ${Math.random().toString(36).slice(2, 7)}`;

/** Ответ API или ошибка с телом. */
async function ok<T>(p: Promise<{ status: number; body: unknown }>, what: string): Promise<T> {
  const r = await p;
  if (r.status >= 300) throw new Error(`${what} ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body as T;
}

/**
 * Новая форма «Вся организация» через API владельца (createForm, saveFormDraft, updateForm, publishForm): вопросы
 * `fields` на одной странице, настройки `settings`; опубликована v1.
 */
async function makeForm(
  page: Page,
  o: { name: string; fields: Q[]; settings?: Q; tenant?: string },
): Promise<Made> {
  const tenant = o.tenant ?? (await tenantId(page));
  const base = `/api/v1/tenants/${tenant}/forms`;
  const f = await ok<{ id: string }>(
    call(page, 'POST', base, { body: { name: o.name, orgUnitId: null, templateId: 'blank' } }),
    'createForm',
  );
  const url = `${base}/${f.id}`;
  const d = await call(page, 'GET', `${url}/draft`);
  await ok(
    call(page, 'PUT', `${url}/draft`, {
      body: { definition: { pages: [{ id: 'p1', title: 'Страница 1' }], fields: o.fields } },
      ifMatch: d.headers.etag ?? '',
    }),
    'saveFormDraft',
  );
  if (o.settings) await patchForm(page, { tenant, form: f.id }, { settings: o.settings });
  const cur = await call(page, 'GET', url);
  const draft = await ok<{ revision: number }>(call(page, 'GET', `${url}/draft`), 'getFormDraft');
  await ok(
    call(page, 'POST', `${url}/publish`, {
      body: { draftRevision: draft.revision },
      ifMatch: cur.headers.etag ?? '',
    }),
    'publishForm',
  );
  return { tenant, form: f.id, name: o.name };
}

const TEXT_Q: Q[] = [
  { key: 'q-name', pageId: 'p1', type: 'text', label: 'Как вас зовут', required: true },
  {
    key: 'q-shift',
    pageId: 'p1',
    type: 'choice',
    label: 'Смена',
    required: true,
    options: [
      { key: 'o1', label: 'Утро' },
      { key: 'o2', label: 'Вечер' },
    ],
  },
];

/** Владелец «Альты» с пресетом «Логистика подключена»; затем `route` без повторного пресета. */
async function owner(app: (r: string, o?: { persona?: 'owner' }) => Promise<unknown>, page: Page) {
  await app('/', { persona: 'owner' });
  await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15_000 })
    .catch(() => undefined);
  return tenantId(page, ALTA);
}

test.describe('form-fill — «Заполнение формы» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  });

  test('«Ссылка для сотрудников» диалога «Поделиться формой» открывает форму: логотип и организация, название, «Страница 1 из 4», без меню', async ({
    app,
    page,
  }) => {
    const o = await openForm(app, page, { tab: 'settings' });
    await editor(page).getByRole('button', { name: 'Поделиться' }).click();
    const link = await dialog(page).getByLabel('Ссылка для сотрудников').inputValue();
    expect(link).toMatch(new RegExp(`/forms/${o.form}$`));
    await app(new URL(link).pathname, { persona: 'owner' });
    await expect(card(page).locator('.ox-fm-pv-logo')).toHaveText(/Альта Групп/);
    await expect(card(page).getByRole('heading', { level: 2, name: INSP })).toBeVisible();
    await expect(card(page)).toContainText('Страница 1 из 4');
    await expect(card(page).getByRole('heading', { level: 3, name: 'Фото' })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByText('Предпросмотр черновика. Ответ не сохраняется.')).toHaveCount(0);
  });

  test('сотрудник отвечает на «Осмотр машины» с фото: ответ R-1013 «Принят» в «Ответах», задача и строка БЗ', async ({
    app,
    page,
  }) => {
    const o = await openForm(app, page, { tab: 'settings' });
    await app(`/forms/${o.form}`, { persona: 'owner' });
    await expect(card(page)).toContainText('Страница 1 из 4');
    await next(page).click();
    await expect(card(page).getByRole('alert')).toHaveText('Обязательный вопрос');
    const chooser = page.waitForEvent('filechooser');
    await card(page).getByRole('button', { name: 'Прикрепить файл' }).click();
    await (await chooser).setFiles({ name: 'front.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(card(page)).toContainText('front.jpg');
    await expect(card(page)).toContainText('1 файл из 5');
    await next(page).click();
    await card(page).getByLabel('Пробег по одометру, км').fill('85 120');
    await card(page).getByRole('radio', { name: '¾' }).click();
    await next(page).click();
    for (const c of ['кузов', 'шины', 'документы'])
      await card(page).getByRole('checkbox', { name: c }).click();
    await next(page).click();
    await card(page).getByRole('radio', { name: 'Нет', exact: true }).click();
    await send(page).click();
    await expect(card(page)).toContainText(THANKS);
    await expect(card(page).getByRole('button', { name: 'Пройти ещё раз' })).toHaveCount(0);
    const list = await call(page, 'GET', `${formsApi(o)}/responses`);
    const top = (list.body as { items: { number: string; reviewStatus: string; answers: Q[] }[] })
      .items[0];
    expect(top?.number).toBe('R-1013');
    expect(top?.reviewStatus).toBe('accepted');
    expect(top?.answers).toContainEqual({
      fieldKey: 'q-odo',
      value: { type: 'decimal', value: '85120' },
    });
    await app(`/t/${o.tenant}/forms?form=${o.form}&tab=responses`, { persona: 'owner' });
    await page
      .getByRole('group', { name: 'Вид ответов' })
      .getByRole('button', { name: 'Лента', exact: true })
      .click();
    await expect(page.locator('.ox-fr-resp-status')).toHaveText('Принят');
    await expect(page.locator('.ox-fr-resp h3')).toHaveText('R-1013');
  });

  test('«Спасибо» со ссылкой на страницу БЗ правила (showLink) — переход в «Базу знаний»', async ({
    app,
    page,
  }) => {
    const o = await openForm(app, page, {
      tab: 'settings',
      before: async (x) => {
        const rules = await call(page, 'GET', `${formsApi(x)}/rules`);
        const kb = (
          rules.body as { items: (Q & { id: string; revision: number; kb?: Q })[] }
        ).items.find((r) => r.kind === 'kb');
        if (!kb?.kb) throw new Error('нет правила «в БЗ»');
        // FormRuleKbInput — без проекций node и tableTitle.
        const input = Object.fromEntries(
          Object.entries(kb.kb).filter(([k]) => k !== 'node' && k !== 'tableTitle'),
        );
        await ok(
          call(page, 'PATCH', `${formsApi(x)}/rules/${kb.id}`, {
            body: { kb: { ...input, showLink: true } },
            ifMatch: `"rev-${kb.revision}"`,
          }),
          'updateFormRule',
        );
      },
    });
    await app(`/forms/${o.form}`, { persona: 'owner' });
    const chooser = page.waitForEvent('filechooser');
    await card(page).getByRole('button', { name: 'Прикрепить файл' }).click();
    await (await chooser).setFiles({ name: 'odo.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(card(page)).toContainText('1 файл из 5');
    await next(page).click();
    await card(page).getByLabel('Пробег по одометру, км').fill('85200');
    await card(page).getByRole('radio', { name: 'Полный' }).click();
    await next(page).click();
    await card(page).getByRole('checkbox', { name: 'кузов' }).click();
    await next(page).click();
    await card(page).getByRole('radio', { name: 'Нет', exact: true }).click();
    await send(page).click();
    const link = card(page).getByRole('button', {
      name: 'Ответ появится на странице «Журнал осмотров машин» в Базе знаний',
    });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/knowledge\?/);
    await expect(page.getByRole('heading', { name: 'Журнал осмотров машин' }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('тест с баллами: «Результат: 1 из 1 балла · тест пройден»', async ({ app, page }) => {
    await owner(app, page);
    const m = await makeForm(page, {
      name: uniq('Тест по технике безопасности'),
      settings: { scoring: true, passScore: 1, showScore: true },
      fields: [
        {
          key: 'q-helmet',
          pageId: 'p1',
          type: 'choice',
          label: 'Каска обязательна?',
          required: true,
          options: [
            { key: 'o1', label: 'Да', score: 1 },
            { key: 'o2', label: 'Нет', score: 0 },
          ],
        },
      ],
    });
    await app(`/forms/${m.form}`, { persona: 'owner' });
    await card(page).getByRole('radio', { name: 'Да' }).click();
    await send(page).click();
    await expect(card(page)).toContainText(THANKS);
    await expect(card(page).locator('.ox-fm-pv-score')).toHaveText(
      'Результат: 1 из 1 балла · тест пройден',
    );
  });

  test('вопрос CRM «Сотрудник»: варианты по правам отвечающего (listFormFieldOptions), подпись в ответе', async ({
    app,
    page,
  }) => {
    await owner(app, page);
    const m = await makeForm(page, {
      name: uniq('Кто дежурит'),
      fields: [{ key: 'q-who', pageId: 'p1', type: 'person', label: 'Дежурный', required: true }],
    });
    await app(`/forms/${m.form}`, { persona: 'owner' });
    const sel = card(page).getByRole('combobox', { name: 'Дежурный' });
    await expect(sel.locator('option', { hasText: 'Марина Котова' })).toHaveCount(1);
    await sel.selectOption({ label: 'Марина Котова' });
    await send(page).click();
    await expect(card(page)).toContainText(THANKS);
    const r = await call(page, 'GET', `/api/v1/tenants/${m.tenant}/forms/${m.form}/responses`);
    const a = (r.body as { items: { answers: { value: Q }[] }[] }).items[0]?.answers[0]?.value;
    expect(a).toMatchObject({ type: 'reference', label: 'Марина Котова' });
  });

  test('«Форма обновилась — откройте её заново» (409 form_version_changed) → «Открыть заново»', async ({
    app,
    page,
  }) => {
    await owner(app, page);
    const m = await makeForm(page, { name: uniq('Отметка смены'), fields: TEXT_Q });
    await app(`/forms/${m.form}`, { persona: 'owner' });
    await card(page).getByLabel('Как вас зовут').fill('Дарья');
    await card(page).getByRole('radio', { name: 'Утро' }).click();
    await devScenario(page, { scenario: 'submitFormResponse=invalid_transition', once: true });
    await send(page).click();
    await expect(state(page).getByRole('heading', { level: 1 })).toHaveText(
      'Форма обновилась — откройте её заново',
    );
    await state(page).getByRole('button', { name: 'Открыть заново' }).click();
    await expect(card(page).getByLabel('Как вас зовут')).toHaveValue('');
  });

  test('«Вы уже отвечали на эту форму» («Один ответ от сотрудника»)', async ({ app, page }) => {
    await owner(app, page);
    const m = await makeForm(page, {
      name: uniq('Анкета сотрудника'),
      fields: TEXT_Q,
      settings: { onePerMember: true },
    });
    await app(`/forms/${m.form}`, { persona: 'owner' });
    await card(page).getByLabel('Как вас зовут').fill('Дарья');
    await card(page).getByRole('radio', { name: 'Вечер' }).click();
    await send(page).click();
    await expect(card(page)).toContainText(THANKS);
    await app(`/forms/${m.form}`, { persona: 'owner' });
    await expect(state(page).getByRole('heading', { level: 1 })).toHaveText(
      'Вы уже отвечали на эту форму',
    );
    await expect(card(page)).toHaveCount(0);
  });

  test('«Приём ответов закрыт» — закрытая форма', async ({ app, page }) => {
    await owner(app, page);
    const m = await makeForm(page, { name: uniq('Опрос о столовой'), fields: TEXT_Q });
    await patchForm(page, m, { status: 'closed' });
    await app(`/forms/${m.form}`, { persona: 'owner' });
    await expect(state(page).getByRole('heading', { level: 1 })).toHaveText('Приём ответов закрыт');
  });

  test('нет связи при отправке: ответы на месте; повтор — «Спасибо»', async ({ app, page }) => {
    await owner(app, page);
    const m = await makeForm(page, { name: uniq('Заявка на пропуск'), fields: TEXT_Q });
    await app(`/forms/${m.form}`, { persona: 'owner' });
    await card(page).getByLabel('Как вас зовут').fill('Илья');
    await card(page).getByRole('radio', { name: 'Утро' }).click();
    await devScenario(page, { scenario: 'submitFormResponse=offline' });
    await send(page).click();
    await expect(alert(page)).toHaveText('Нет связи с сервером. Ответ не отправлен — повторите.');
    await expect(card(page).getByLabel('Как вас зовут')).toHaveValue('Илья');
    await devScenario(page, { scenario: null });
    await send(page).click();
    await expect(card(page)).toContainText(THANKS);
    const r = await call(page, 'GET', `/api/v1/tenants/${m.tenant}/forms/${m.form}/responses`);
    expect((r.body as { items: unknown[] }).items).toHaveLength(1);
  });

  test('ошибка загрузки (429) — «Не удалось загрузить форму: …» и «Повторить»', async ({
    app,
    page,
  }) => {
    await owner(app, page);
    const m = await makeForm(page, { name: uniq('Обратная связь по смене'), fields: TEXT_Q });
    await devScenario(page, { scenario: 'getForm=rate_limited', once: true });
    await app(`/forms/${m.form}`, { persona: 'owner' });
    await expect(state(page)).toContainText(
      'Не удалось загрузить форму: Слишком много запросов. Подождите и повторите.',
    );
    await state(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(card(page).getByLabel('Как вас зовут')).toBeVisible();
  });

  test('водитель без права «Видеть формы» — «Нет доступа к форме»; неизвестная форма — «Форма не найдена»', async ({
    app,
    page,
  }) => {
    const id = await owner(app, page);
    const m = await makeForm(page, { name: uniq('Для менеджеров'), fields: TEXT_Q, tenant: id });
    await app(`/forms/${m.form}`, { persona: 'driver' });
    await expect(state(page).getByRole('heading', { level: 1 })).toHaveText('Нет доступа к форме');
    await app('/forms/00000000-0000-5000-8000-0000000000aa', { persona: 'owner' });
    await expect(state(page).getByRole('heading', { level: 1 })).toHaveText('Форма не найдена');
  });

  test('без входа — экран входа с возвратом на форму (?next=)', async ({ app, page }) => {
    const id = await owner(app, page);
    const m = await makeForm(page, { name: uniq('Инструктаж'), fields: TEXT_Q, tenant: id });
    await call(page, 'POST', '/api/v1/dev/logout');
    await app(`/forms/${m.form}`);
    await page.waitForURL(/\/auth\/login\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(`/forms/${m.form}`);
  });

  test('клавиатура: Tab по полям и кнопкам, фокус виден; axe; 390 — без прокрутки, цели 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await owner(app, page);
    const m = await makeForm(page, { name: uniq('Утренний чек'), fields: TEXT_Q });
    await app(`/forms/${m.form}`, { persona: 'owner' });
    const input = card(page).getByLabel('Как вас зовут');
    await input.focus();
    await page.keyboard.type('Дарья');
    await page.keyboard.press('Tab');
    await expect(card(page).getByRole('radio', { name: 'Утро' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card(page).getByRole('radio', { name: 'Утро' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await serious(page, axe)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(card(page))).toEqual([]);
  });
});

// Backend «Форм» — W4.21 (в main): ответ сотрудника на стенде слота.
test.describe('form-fill — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(120_000);

  test('сотрудник отвечает на внутреннюю форму: «Спасибо», ответ «Принят» в «Ответах»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const m = await makeForm(page, { name: uniq('Отметка о смене'), fields: TEXT_Q });
    await app(`/forms/${m.form}`, { persona: 'owner' });
    await expect(card(page).locator('.ox-fm-pv-logo')).toHaveText(/Альта Групп/);
    await card(page).getByLabel('Как вас зовут').fill('Дарья Зимина');
    await card(page).getByRole('radio', { name: 'Вечер' }).click();
    await send(page).click();
    await expect(card(page)).toContainText(THANKS);
    await app(`/t/${m.tenant}/forms?form=${m.form}&tab=responses`, { persona: 'owner' });
    await page
      .getByRole('group', { name: 'Вид ответов' })
      .getByRole('button', { name: 'Лента', exact: true })
      .click();
    await expect(page.locator('.ox-fr-resp-status')).toHaveText('Принят', { timeout: 20_000 });
    await expect(page.locator('.ox-fr-resp')).toContainText('Дарья Зимина');
  });

  test('сотрудник прикладывает фото: загрузка core.files стенда (MinIO), ответ с файлом', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const m = await makeForm(page, {
      name: uniq('Фотоотчёт смены'),
      fields: [
        { key: 'q-what', pageId: 'p1', type: 'text', label: 'Что сделано', required: true },
        { key: 'q-photo', pageId: 'p1', type: 'photo', label: 'Фото', required: true },
      ],
    });
    await app(`/forms/${m.form}`, { persona: 'owner' });
    await card(page).getByLabel('Что сделано').fill('Уборка склада');
    const chooser = page.waitForEvent('filechooser');
    await card(page).getByRole('button', { name: 'Прикрепить файл' }).click();
    await (await chooser).setFiles({ name: 'sklad.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(card(page)).toContainText('1 файл из 5', { timeout: 20_000 });
    await send(page).click();
    await expect(card(page)).toContainText(THANKS);
    const r = await call(page, 'GET', `/api/v1/tenants/${m.tenant}/forms/${m.form}/responses`);
    const top = (r.body as { items: { answers: { fieldKey: string; value: Q }[] }[] }).items[0];
    expect(top?.answers.find((a) => a.fieldKey === 'q-photo')?.value).toMatchObject({
      type: 'files',
    });
  });
});
