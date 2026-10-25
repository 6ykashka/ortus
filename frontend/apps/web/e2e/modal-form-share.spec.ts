// W4.23 · e2e диалога `modal-form-share` «Поделиться формой» (эталон design-2026-10-19 «Формы и опросы.dc.html»
// dc:457–466, modalVM dc:1081–1087; разбор forms.md §1.10). Ссылки — маршруты SPA (Q-W4.00-forms-21):
// `{origin}/forms/{id}`, `{origin}/f/{token}`, iframe `…?embed=1`. Данные — MSW W4.05; backend — W4.21.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  devScenario,
  dialog,
  editor,
  FOREMAN,
  formsApi,
  openForm,
  openStandForm,
  patchForm,
  phone,
  serious,
  smallTargets,
} from './forms-results.helpers.ts';

const share = (page: Page) => editor(page).getByRole('button', { name: 'Поделиться' });

test.describe('modal-form-share — «Поделиться формой» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(90_000);

  test('сотрудники: «Ссылка для сотрудников», «Копировать» → «Скопировано», Escape — фокус на «Поделиться»', async ({
    app,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    const o = await openForm(app, page, { tab: 'settings' });
    await share(page).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('Поделиться формой');
    await expect(d).toContainText('Доступ настраивается во вкладке «Настройки».');
    const link = d.getByLabel('Ссылка для сотрудников');
    await expect(link).toHaveValue(new RegExp(`/forms/${o.form}$`));
    await expect(d).toContainText(
      'Откроется после входа. Ответить могут сотрудники с правом «Формы» в области формы.',
    );
    await d.getByRole('button', { name: 'Копировать' }).click();
    await expect(d.getByRole('button', { name: 'Скопировано' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(d).toHaveCount(0);
    await expect(share(page)).toBeFocused();
  });

  test('публичная форма: «Публичная ссылка» и «Код для сайта»; закрытый приём — пояснение', async ({
    app,
    page,
  }) => {
    await openForm(app, page, {
      tab: 'settings',
      before: async (o) => {
        await patchForm(page, o, { settings: { access: 'public' } });
        await patchForm(page, o, { status: 'closed' });
      },
    });
    await share(page).click();
    const d = dialog(page);
    await expect(d.getByLabel('Публичная ссылка')).toHaveValue(/\/f\/[A-Za-z0-9_-]{16,}$/);
    await expect(d).toContainText('Без входа; гость может только отправить ответ.');
    await expect(d.getByLabel('Код для сайта')).toHaveValue(
      /^<iframe src="http.+\/f\/[A-Za-z0-9_-]+\?embed=1" width="100%" height="640" frameborder="0"><\/iframe>$/,
    );
    await expect(d).toContainText('Вставьте в HTML страницы — форма откроется внутри сайта.');
    await expect(d).toContainText(
      'Приём ответов закрыт: по ссылке откроется сообщение о закрытии.',
    );
    await d.getByRole('button', { name: 'Закрыть' }).click();
    await expect(d).toHaveCount(0);
  });

  test('черновик — «Ссылка появится после публикации: сейчас форма — черновик.»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { name: FOREMAN, tab: 'settings' });
    await share(page).click();
    await expect(dialog(page)).toContainText(
      'Ссылка появится после публикации: сейчас форма — черновик.',
    );
    await expect(dialog(page).getByRole('textbox')).toHaveCount(0);
  });

  // Возврат 3 (ревью modal-form-share): форма уже в кэше редактора — диалог её не перечитывает, отказ getForm (нет
  // связи, 429) не заменяет редактор карточкой ошибки и не закрывает диалог.
  for (const code of ['offline', 'rate_limited'] as const) {
    test(`getForm=${code} после открытия редактора — диалог и редактор на месте, фокус в диалоге`, async ({
      app,
      page,
    }) => {
      const o = await openForm(app, page, { tab: 'settings' });
      await devScenario(page, { scenario: `getForm=${code}` });
      const reads: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'GET' && new URL(r.url()).pathname === formsApi(o)) reads.push(r.url());
      });
      await share(page).click();
      const d = dialog(page);
      await expect(d.getByLabel('Ссылка для сотрудников')).toHaveValue(
        new RegExp(`/forms/${o.form}$`),
      );
      await page.waitForTimeout(2_500);
      expect(reads).toEqual([]);
      await expect(d).toHaveCount(1);
      await expect(d.locator(':focus')).toHaveCount(1);
      await expect(editor(page)).toBeVisible();
      await expect(page.getByText(/Не удалось загрузить данные/)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(share(page)).toBeFocused();
      await devScenario(page, { scenario: null });
    });
  }

  test('клавиатура: фокус в диалоге, Tab не выходит наружу; 390 — цели 44 px; axe', async ({
    app,
    page,
    axe,
  }) => {
    await openForm(app, page, { tab: 'settings' });
    await share(page).click();
    const d = dialog(page);
    await expect(d.locator(':focus')).toHaveCount(1);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      await expect(d.locator(':focus')).toHaveCount(1);
    }
    if (phone(page)) expect(await smallTargets(d)).toEqual([]);
    expect(await serious(page, axe)).toEqual([]);
  });
});

test.describe('modal-form-share — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  // W4.73: «Осмотр машины» сида W4.21 — опубликована, доступ «Сотрудники организации»: ссылка `{origin}/forms/{id}`.
  test('владелец на стенде: ссылка для сотрудников', async ({ app, page }) => {
    const o = await openStandForm(app, page, { tab: 'settings' });
    await share(page).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('Поделиться формой');
    await expect(d).toContainText('Доступ настраивается во вкладке «Настройки».');
    await expect(d.getByLabel('Ссылка для сотрудников')).toHaveValue(
      new RegExp(`/forms/${o.form}$`),
    );
    await expect(d).toContainText(
      'Откроется после входа. Ответить могут сотрудники с правом «Формы» в области формы.',
    );
    await page.keyboard.press('Escape');
    await expect(d).toHaveCount(0);
    await expect(share(page)).toBeFocused();
  });
});
