// W4.23 · e2e экрана `forms-settings` — вкладка «Настройки» редактора формы (эталон design-2026-10-19
// «Формы и опросы.dc.html» dc:287–323, settingsVM dc:880–898; разбор forms.md §1.6). Данные — MSW W4.05 поверх домена
// W4.20 (форма «Осмотр машины» «Альты»); backend — W4.21 (режим stand). Обязательные пункты verification-protocol §1.3:
// URL, состояния (загрузка, ошибка, нет связи, только чтение), клавиатура, axe, 390 / 1440.
import { expect, test } from './_stand/fixtures.ts';
import {
  call,
  devScenario,
  dialog,
  editor,
  formsApi,
  noAccess,
  OFFLINE,
  openForm,
  openFromMenu,
  openStandForm,
  openWithoutRight,
  phone,
  reopen,
  serious,
  smallTargets,
  tab,
  toast,
} from './forms-results.helpers.ts';
import { noHorizontalScroll } from './modules.helpers.ts';

const panel = (page: import('@playwright/test').Page) => page.locator('.ox-fr-st');
const radio = (page: import('@playwright/test').Page, name: string | RegExp) =>
  page.getByRole('radiogroup', { name: 'Доступ к форме' }).getByRole('radio', { name });

test.describe('forms-settings — «Настройки» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(90_000);

  test('вкладка по URL: четыре карточки, доступ «Сотрудники организации», область, приём, вид', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'settings' });
    await expect(tab(page, 'settings')).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText([
      'Кто может ответить',
      'Приём ответов',
      'Тест с баллами',
      'Вид формы',
    ]);
    await expect(radio(page, /^Сотрудники организации/)).toHaveAttribute('aria-checked', 'true');
    await expect(radio(page, /^Все, у кого есть ссылка/)).toBeEnabled();
    // «По персональному приглашению» — неактивен (Q-W4.00-forms-10).
    await expect(radio(page, /^По персональному приглашению/)).toBeDisabled();
    await expect(radio(page, /^По персональному приглашению/)).toHaveAttribute(
      'title',
      'Появится позже: персональные приглашения со сроком',
    );
    await expect(page.getByLabel('Область формы')).toHaveValue('');
    await expect(page.getByLabel('Область формы').locator('option')).toContainText([
      'Вся организация',
    ]);
    await expect(panel(page)).toContainText(
      'Форму и ответы видят роли с правами «Формы» в этой области.',
    );
    await expect(page.getByLabel('Не больше ответов всего')).toHaveAttribute(
      'placeholder',
      'без ограничения',
    );
    await expect(page.getByLabel('Хранить ответы')).toHaveValue('365');
    await expect(page.getByLabel('Текст после отправки')).toHaveValue('Спасибо! Ответ отправлен.');
    await expect(page.getByLabel('Логотип и название организации')).toBeChecked();
    await expect(page.getByLabel('Прогресс по страницам')).toBeChecked();
    await expect(page.getByLabel('Кнопка «Назад» между страницами')).toBeChecked();
    await expect(page.getByLabel('Считать баллы за варианты ответа')).not.toBeChecked();
    await expect(panel(page)).toContainText('Баллы задаются у вариантов в конструкторе.');
  });

  test('флажок и список сохраняются сразу, поле — по потере фокуса; после перезагрузки — те же', async ({
    app,
    page,
  }) => {
    const o = await openForm(app, page, { tab: 'settings' });
    await page.getByLabel('Один ответ от сотрудника').check();
    await expect(page.getByLabel('Один ответ от сотрудника')).toBeChecked();
    await page.getByLabel('Хранить ответы').selectOption('90');
    await page.getByLabel('Не больше ответов всего').fill('50');
    await page.getByLabel('Не больше ответов всего').blur();
    await page.getByLabel('Текст после отправки').fill('Благодарим!');
    await page.getByLabel('Текст после отправки').blur();
    await expect
      .poll(async () => {
        const r = await call(page, 'GET', formsApi(o));
        const s = (r.body as { settings: Record<string, unknown> }).settings;
        return [s.onePerMember, s.retainResponsesDays, s.responseLimit, s.confirmationText];
      })
      .toEqual([true, 90, 50, 'Благодарим!']);
    // Заново по адресу через фикстуру `app` (ждёт service worker MSW): голый page.reload изредка уходит мимо MSW.
    await reopen(app, page);
    await expect(page.getByLabel('Один ответ от сотрудника')).toBeChecked();
    await expect(page.getByLabel('Хранить ответы')).toHaveValue('90');
    await expect(page.getByLabel('Не больше ответов всего')).toHaveValue('50');
  });

  test('лимит 0 — ошибка сервера в role=alert; верное значение снимает ошибку', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'settings' });
    await page.getByLabel('Не больше ответов всего').fill('0');
    await page.getByLabel('Не больше ответов всего').blur();
    await expect(panel(page).getByRole('alert')).toHaveText('Лимит ответов — положительное число');
    await page.getByLabel('Не больше ответов всего').fill('10');
    await page.getByLabel('Не больше ответов всего').blur();
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
  });

  test('«Все, у кого есть ссылка» — сразу; «Поделиться» показывает публичную ссылку и код для сайта', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'settings' });
    await radio(page, /^Все, у кого есть ссылка/).click();
    await expect(radio(page, /^Все, у кого есть ссылка/)).toHaveAttribute('aria-checked', 'true');
    await editor(page).getByRole('button', { name: 'Поделиться' }).click();
    await expect(dialog(page).getByLabel('Публичная ссылка')).toHaveValue(
      /\/f\/[A-Za-z0-9_-]{16,}$/,
    );
    await expect(dialog(page).getByLabel('Код для сайта')).toHaveValue(
      /^<iframe src=".+\?embed=1"/,
    );
  });

  test('область формы — фирма; тост «Область формы изменена», мета шапки', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'settings' });
    await page.getByLabel('Область формы').selectOption({ label: 'Север Логистик · фирма' });
    await expect(toast(page)).toHaveText('Область формы изменена');
    await expect(editor(page)).toContainText('область: Север Логистик');
  });

  test('«Считать баллы» — максимум и проходной балл', async ({ app, page }) => {
    await openForm(app, page, { tab: 'settings' });
    await page.getByLabel('Считать баллы за варианты ответа').check();
    await expect(panel(page)).toContainText('Максимум по форме: 0 баллов');
    await expect(page.getByLabel('Проходной балл')).toHaveAttribute('placeholder', 'не задан');
    await expect(page.getByLabel('Показывать результат после отправки')).toBeChecked();
  });

  test('вопрос с данными CRM в черновике — «Все, у кого есть ссылка» недоступен с причиной', async ({
    app,
    page,
  }) => {
    await openForm(app, page, {
      tab: 'settings',
      // Черновик с вопросом «Сотрудник» (данные CRM) — через saveFormDraft, If-Match по ETag черновика.
      before: async (o) => {
        const d = await call(page, 'GET', `${formsApi(o)}/draft`);
        const def = (
          d.body as {
            definition: { pages: { id: string }[]; fields: Record<string, unknown>[] };
          }
        ).definition;
        const fields = [
          ...def.fields,
          {
            key: 'qCrmWho',
            pageId: def.pages[0]?.id,
            type: 'person',
            label: 'Кто принял машину',
            required: false,
          },
        ];
        const r = await call(page, 'PUT', `${formsApi(o)}/draft`, {
          body: { definition: { ...def, fields } },
          ifMatch: d.headers.etag ?? '',
        });
        if (r.status !== 200)
          throw new Error(`saveFormDraft ${r.status}: ${JSON.stringify(r.body)}`);
      },
    });
    await expect(radio(page, /^Все, у кого есть ссылка/)).toBeDisabled();
    await expect(radio(page, /^Все, у кого есть ссылка/)).toContainText(
      'Недоступно: в форме есть вопросы с данными CRM — «Кто принял машину».',
    );
    await expect(radio(page, /^Сотрудники организации/)).toHaveAttribute('aria-checked', 'true');
  });

  test('логист — только просмотр: плашка, поля и режимы недоступны', async ({ app, page }) => {
    await openForm(app, page, { tab: 'settings', persona: 'manager' });
    await expect(editor(page)).toContainText('Только просмотр · нет права «Настраивать» формы');
    await expect(page.getByLabel('Один ответ от сотрудника')).toBeDisabled();
    await expect(page.getByLabel('Область формы')).toBeDisabled();
    await expect(radio(page, /^Все, у кого есть ссылка/)).toBeDisabled();
  });

  test('ошибка загрузки формы — «Повторить»; нет связи при сохранении — тост', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'settings' });
    await devScenario(page, { scenario: 'getForm=rate_limited' });
    await reopen(app, page);
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить данные');
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(panel(page)).toBeVisible();
    await devScenario(page, { scenario: 'updateForm=offline' });
    // click, а не check: без связи флажок сразу возвращается к значению сервера — check() видел бы это как отказ.
    await page.getByLabel('Один ответ от сотрудника').click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(page.getByLabel('Один ответ от сотрудника')).not.toBeChecked();
    await devScenario(page, { scenario: null });
  });

  test('клавиатура: режимы доступа — одна остановка Tab, стрелки выбирают; Tab — к «Области формы»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'settings' });
    await radio(page, /^Сотрудники организации/).focus();
    await page.keyboard.press('ArrowDown');
    await expect(radio(page, /^Все, у кого есть ссылка/)).toBeFocused();
    await expect(radio(page, /^Все, у кого есть ссылка/)).toHaveAttribute('aria-checked', 'true');
    await expect(radio(page, /^Все, у кого есть ссылка/)).toHaveAttribute('tabindex', '0');
    await expect(radio(page, /^Сотрудники организации/)).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Область формы')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(radio(page, /^Все, у кого есть ссылка/)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(radio(page, /^Сотрудники организации/)).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('Один ответ от сотрудника').focus();
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Один ответ от сотрудника')).toBeChecked();
  });

  test('открывается из меню «Формы и опросы»: список → «Осмотр машины» → «Настройки»', async ({
    app,
    page,
  }) => {
    await openFromMenu(app, page, 'settings');
    await expect(tab(page, 'settings')).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page).getByRole('heading', { level: 3 }).first()).toHaveText(
      'Кто может ответить',
    );
  });

  test('нет права: логист без роли в «Формах» — раздел закрыт', async ({ app, page }) => {
    await openWithoutRight(app, page, 'settings');
    await expect(noAccess(page)).toBeVisible({ timeout: 15_000 });
    await expect(panel(page)).toHaveCount(0);
  });

  test('загрузка: прямой URL вкладки — состояние загрузки редактора, затем карточки', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'settings' });
    await devScenario(page, { scenario: 'getForm=loading' });
    await reopen(app, page);
    await expect(page.getByRole('status').filter({ hasText: 'Загрузка форм…' })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await devScenario(page, { scenario: null });
    await reopen(app, page);
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveCount(4);
  });

  test('390 / 1440: без горизонтальной прокрутки, цели 44 px на телефоне, axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    await openForm(app, page, { tab: 'settings' });
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(panel(page))).toEqual([]);
    expect(await serious(page, axe)).toEqual([]);
  });
});

test.describe('forms-settings — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  // W4.73: настройки сида W4.21 — значения по умолчанию (forms/settings.go defaultSettings): доступ «Сотрудники
  // организации», вся организация, хранить 365 дней. Строка только читает: общие настройки формы не меняются.
  test('владелец на стенде: настройки «Осмотра машины»', async ({ app, page }) => {
    await openStandForm(app, page, { tab: 'settings' });
    await expect(tab(page, 'settings')).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText([
      'Кто может ответить',
      'Приём ответов',
      'Тест с баллами',
      'Вид формы',
    ]);
    await expect(radio(page, /^Сотрудники организации/)).toHaveAttribute('aria-checked', 'true');
    await expect(radio(page, /^Все, у кого есть ссылка/)).toBeEnabled();
    await expect(radio(page, /^По персональному приглашению/)).toBeDisabled();
    await expect(page.getByLabel('Область формы')).toHaveValue('');
    await expect(panel(page)).toContainText(
      'Форму и ответы видят роли с правами «Формы» в этой области.',
    );
    await expect(page.getByLabel('Хранить ответы')).toHaveValue('365');
    await expect(page.getByLabel('Текст после отправки')).toHaveValue('Спасибо! Ответ отправлен.');
    await expect(page.getByLabel('Логотип и название организации')).toBeChecked();
    await expect(page.getByLabel('Прогресс по страницам')).toBeChecked();
    await expect(page.getByLabel('Кнопка «Назад» между страницами')).toBeChecked();
    await expect(page.getByLabel('Считать баллы за варианты ответа')).not.toBeChecked();
  });
});
