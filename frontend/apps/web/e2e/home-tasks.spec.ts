// W4.81 · «Главная»: задачи в «Требует решения», карточка «Задачи» в «Сегодня в работе» и бейдж пункта меню «Задачи»
// (эталон design-2026-10-19 «Ортус CRM.dc.html» homeVM :4081–4084, :4113, меню :2995–2996; DoR tasks.md «Главная», Р-20,
// Р-27). Источник задач — getMyDecisionQueue (`tasks.task_new`, `tasks.task_review`), счётчики и бейдж —
// getMyTaskSummary (контракт 0.11.1-stage4). Сид «Альты» (mock-data.js :276–287, api.js :27–30): у владельца (Дарья
// Зимина) — T-63 «На проверке» и заявка L-31 «Новая»; у логиста (Марина Котова, роль проекта LOG) — T-64 «Новая»,
// срочная.
//   @mock — сценарный сервер на сиде; 390 и 1440.
//   @stand — менеджер видит на «Главной» срочную задачу осмотра (W4.24: блокирующий дефект → ответ «Осмотра машины» →
//            задача Котовой), «Открыть» ведёт в карточку задачи.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { card, cards, cardTitles, openHome } from './home.helpers.ts';
import { hitHeight, noHorizontalScroll } from './modules.helpers.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';
import { card as taskCard, standSuffix, T64 } from './tasks.helpers.ts';

const T63 = 'Обновить регламент приёмки смены';
const L31 = 'Квартира 64 м², Химки';

const home = (page: Page): Locator => page.locator('section[aria-labelledby="h-home"]');
const work = (page: Page, title: string): Locator =>
  home(page)
    .locator('.ox-home-work')
    .filter({ has: page.locator('strong', { hasText: title }) });
const line = (w: Locator, label: string): Locator =>
  w.locator('.ox-home-line').filter({ has: w.page().getByText(label, { exact: true }) });

/** Пункт «Задачи» меню своей ширины: боковая панель (от 640) или «Ещё» → «Все разделы» (390). */
async function tasksItem(page: Page): Promise<Locator> {
  if ((page.viewportSize()?.width ?? 1440) >= 640) {
    return page
      .getByRole('navigation', { name: 'Основная навигация' })
      .locator('.ox-nav-item')
      .filter({ has: page.locator('.ox-nav-label', { hasText: /^Задачи$/ }) });
  }
  await page
    .getByRole('navigation', { name: 'Навигация', exact: true })
    .getByRole('button', { name: 'Ещё' })
    .click();
  return page.getByRole('dialog', { name: 'Все разделы' }).getByRole('button', { name: /^Задачи/ });
}

/** Ответ сотрудника на v3 «Осмотра машины» через API сценарного сервера: правило au-1 ставит задачу Котовой. */
async function inspectionResponse(page: Page, tenant: string): Promise<void> {
  const forms = await call(page, 'GET', `/api/v1/tenants/${tenant}/forms?limit=200`);
  const form = (forms.body as { items: { id: string; name: string }[] }).items.find(
    (f) => f.name === 'Осмотр машины',
  );
  const base = `/api/v1/tenants/${tenant}/forms/${form?.id ?? ''}`;
  const vs = await call(page, 'GET', `${base}/versions`);
  const v3 = (vs.body as { items: { id: string; number: number }[] }).items.find(
    (x) => x.number === 3,
  );
  const r = await call(page, 'POST', `${base}/responses`, {
    body: {
      versionId: v3?.id,
      answers: [
        {
          fieldKey: 'q-photos',
          value: { type: 'files', value: ['0b1f6a3c-1d2e-4f50-8a6b-7c8d9e0f1a2b'] },
        },
        { fieldKey: 'q-odo', value: { type: 'decimal', value: '85000' } },
        { fieldKey: 'q-fuel', value: { type: 'choices', value: ['o4'] } },
        { fieldKey: 'q-checks', value: { type: 'choices', value: ['o1', 'o2', 'o3'] } },
        { fieldKey: 'q-defect', value: { type: 'boolean', value: false } },
      ],
    },
  });
  if (r.status !== 201)
    throw new Error(`submitFormResponse ${r.status}: ${JSON.stringify(r.body)}`);
}

test.describe('home — задачи на «Главной» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сид и сценарии — сценарный сервер mock');

  test('владелец: «На проверке» T-63 и заявка L-31 — чип, «Срок ДД.ММ», «Открыть» → карточка задачи', async ({
    app,
    page,
  }) => {
    await openHome(app, page);
    expect(await cardTitles(page)).toEqual([
      'Пробный период: осталось 12 дней',
      '3 сотрудника без роли',
      `T-63 · ${T63}`,
      `L-31 · ${L31}`,
    ]);
    await expect(home(page).locator('p').first()).toHaveText(
      'Требует решения: 4. Сначала то, что блокирует работу.',
    );
    const review = card(page, `T-63 · ${T63}`);
    await expect(review).toContainText('На проверке');
    await expect(review).toContainText('Срок 03.10');
    await expect(review.locator('.material-symbols-rounded').first()).toHaveText('rate_review');
    const lead = card(page, `L-31 · ${L31}`);
    await expect(lead).toContainText('Задача');
    await expect(lead).toContainText('Срок 03.10');
    await expect(lead.locator('.material-symbols-rounded').first()).toHaveText('task_alt');
    await review.getByRole('button', { name: 'Открыть' }).click();
    await expect(page).toHaveURL(/\/tasks\?.*task=/);
    await expect(taskCard(page).getByRole('heading', { level: 3, name: T63 })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('владелец: заявка воронки «Открыть» → «Заявки» с карточкой заявки', async ({
    app,
    page,
  }) => {
    await openHome(app, page);
    await card(page, `L-31 · ${L31}`).getByRole('button', { name: 'Открыть' }).click();
    await expect(page).toHaveURL(/\/leads\?.*task=/);
    await expect(page.getByText(L31).first()).toBeVisible({ timeout: 15_000 });
  });

  test('логист: срочная T-64 — первая (danger), «Задача», «Срок 01.10», «Открыть» → карточка', async ({
    app,
    page,
  }) => {
    await openHome(app, page, { persona: 'manager' });
    await expect(home(page).locator('p').first()).toHaveText(
      'Требует решения: 1. Сначала то, что блокирует работу.',
    );
    await expect(cards(page)).toHaveCount(1);
    const t = card(page, `T-64 · ${T64}`);
    await expect(t).toContainText('Задача');
    await expect(t).toContainText('Срок 01.10');
    await expect(t).not.toContainText('создана из ответа формы');
    await expect(t).toHaveAttribute('data-tone', 'danger');
    await t.getByRole('button', { name: 'Открыть' }).click();
    await expect(page).toHaveURL(/\/tasks\?.*task=/);
    await expect(taskCard(page).getByRole('heading', { level: 3, name: T64 })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('логист: задача правила формы — « · создана из ответа формы»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await page
      .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15_000 })
      .catch(() => undefined);
    const tenant = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await inspectionResponse(page, tenant);
    await openHome(app, page, { persona: 'manager' });
    const t = card(page, /· Проверить осмотр/);
    await expect(t).toHaveCount(1);
    await expect(t).toContainText('Задача');
    await expect(t).toContainText(/Срок .+ · создана из ответа формы/);
  });

  test('карточка «Задачи» владельца: Новые 2, В работе 2, На проверке 2 → «Задачи»', async ({
    app,
    page,
  }) => {
    await openHome(app, page);
    const w = work(page, 'Задачи');
    await expect(w).toHaveCount(1);
    await expect(line(w, 'Новые')).toContainText('2');
    await expect(line(w, 'В работе')).toContainText('2');
    await expect(line(w, 'На проверке')).toContainText('2');
    // Порядок эталона: карточки работы, затем пунктир неподключённых модулей (:1748–1760).
    const grid = home(page).locator('.ox-home-grid > *');
    await expect(grid.first()).toHaveClass(/ox-home-work/);
    await w.click();
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test('карточка «Задачи» логиста: Новые 1, В работе 2, На проверке 2', async ({ app, page }) => {
    await openHome(app, page, { persona: 'manager' });
    const w = work(page, 'Задачи');
    await expect(line(w, 'Новые')).toContainText('1');
    await expect(line(w, 'В работе')).toContainText('2');
    await expect(line(w, 'На проверке')).toContainText('2');
  });

  test('бейдж «Задачи»: у логиста 1 (T-64 «Новая»), у владельца нет', async ({ app, page }) => {
    await openHome(app, page, { persona: 'manager' });
    const item = await tasksItem(page);
    await expect(item.locator('.ox-nav-badge, .ox-bottom-badge, [class*="badge"]')).toHaveText('1');
    await openHome(app, page);
    const own = await tasksItem(page);
    await expect(own).toBeVisible();
    await expect(own.locator('.ox-nav-badge, .ox-bottom-badge, [class*="badge"]')).toHaveCount(0);
  });

  test('390: без горизонтальной прокрутки, «Открыть» и карточка «Задачи» ≥ 44 px', async ({
    app,
    page,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 640, 'только телефон');
    await openHome(app, page, { persona: 'manager' });
    await expect(card(page, `T-64 · ${T64}`)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const open = card(page, `T-64 · ${T64}`).getByRole('button', { name: 'Открыть' });
    expect(await hitHeight(open)).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(work(page, 'Задачи'))).toBeGreaterThanOrEqual(44);
  });
});

test.describe('home — задачи на «Главной» @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('менеджер: срочная задача осмотра на «Главной» (danger, «Срок»), «Открыть» — карточка задачи; бейдж меню', async ({
    app,
    page,
    undo,
  }) => {
    test.setTimeout(180_000);
    await app('/', { persona: 'manager' });
    const tenant = await tenantId(page);
    const base = `/api/v1/tenants/${tenant}`;
    const ok = (r: { status: number; body: unknown }, op: string): typeof r => {
      if (r.status < 200 || r.status >= 300)
        throw new Error(`${op} ${r.status}: ${JSON.stringify(r.body)}`);
      return r;
    };
    const projects = ok(await call(page, 'GET', `${base}/projects`), 'listTaskProjects').body as {
      items: { id: string; name: string }[];
    };
    const project = projects.items.find((p) => p.name === 'Логистика · Север');
    if (!project) throw new Error('нет проекта «Логистика · Север»');
    const title = `Проверить осмотр W4.81 ${standSuffix()}`;
    // Срочная задача осмотра, как ставит её блокирующий дефект (W4.24): Марина Котова — исполнитель.
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const created = ok(
      await call(page, 'POST', `${base}/tasks`, {
        body: { projectId: project.id, title, priority: 'urgent', dueAt: due },
      }),
      'createTask',
    ).body as { id: string };
    undo(`«${title}» — «Отменена»`, async () => {
      const cur = await call(page, 'GET', `${base}/tasks/${created.id}`);
      const task = cur.body as {
        statusCategory?: string;
        availableTransitions?: { key: string; name: string; allowed: boolean }[];
      };
      if (task.statusCategory === 'done') return;
      const tr = task.availableTransitions?.find((x) => x.name === 'Отменить');
      if (!tr?.allowed) return;
      await call(page, 'POST', `${base}/tasks/${created.id}/transitions`, {
        body: { transitionKey: tr.key, comment: 'Уборка e2e: прогон @stand W4.81.' },
        ifMatch: cur.headers.etag ?? '',
      });
    });

    await openHome(app, page, { persona: 'manager' });
    const t = card(page, new RegExp(`· ${title}$`));
    await expect(t).toHaveCount(1, { timeout: 20_000 });
    await expect(t).toHaveAttribute('data-tone', 'danger');
    await expect(t).toContainText('Задача');
    await expect(t).toContainText('Срок ');
    const badge = (await tasksItem(page)).locator(
      '.ox-nav-badge, .ox-bottom-badge, [class*="badge"]',
    );
    await expect(badge).toHaveText(/^\d+$/);
    // На телефоне tasksItem открыл «Все разделы»: backdrop перехватывает клик по «Открыть» — закрываем.
    const sections = page.getByRole('dialog', { name: 'Все разделы' });
    if (await sections.isVisible()) {
      await page.keyboard.press('Escape');
      await expect(sections).toBeHidden();
    }
    await t.getByRole('button', { name: 'Открыть' }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks\\?.*task=${created.id}`));
    await expect(taskCard(page).getByRole('heading', { level: 3, name: title })).toBeVisible({
      timeout: 15_000,
    });
  });
});
