// W1.30 · Приёмочные строки выхода этапа 1: AC-01, AC-02, AC-07, AC-10, AC-11 (design/docs/15-quality-security.md)
// сквозь стек стенда: браузер → Vite → cmd/api → tenant DB, сессия — cookie dev-входа. Бриф docs/plan/v2/ws/W1.30.md
// §1 п. 2, §10 п. 3–5. Сотрудник с областью «фирма» — логист Марина Котова (`manager`): на время строки владелец
// назначает ей роль «Менеджер логистики» в области «Москва / Север Логистик»; уборка `undo` снимает назначение.
import type { Page } from '@playwright/test';

import { expect, type Session, test, type Undo } from '../../_stand/fixtures.ts';
import {
  type Assignment,
  assign,
  changeSubscription,
  expectStatus,
  listMembers,
  listUnits,
  type Member,
  memberByEmail,
  platformSubscription,
  revoke,
  roleId,
  runLabel,
} from '../../_stand/stand.ts';
import { dialog, openUsers } from '../../people.helpers.ts';
import { platformTenantId } from '../../platform-orgs.helpers.ts';
import { ALTA, call, LOTOS, type Reply, tenantId } from '../../shell.helpers.ts';

const TEMPLATE = 'Менеджер логистики';
const FIRM = 'Север Логистик';
const MARINA = 'm.kotova@alta.example';
/** Id, которого нет ни в одной организации. */
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
/** Текст словаря для 403 tenant_read_only (@ortus/texts errors.tenant_read_only). */
const READ_ONLY_TEXT =
  'Организация в режиме чтения: новые операции недоступны. Чтение и выгрузка доступны.';

type AppFn = (route: string, o?: { persona?: 'owner' | 'owner@t-lotos' }) => Promise<unknown>;

/** Тело Problem без полей конкретного запроса: ответы сравниваются по сути. */
function problemShape(r: Reply): Record<string, unknown> {
  const b = { ...(r.body as Record<string, unknown>) };
  delete b.instance;
  delete b.requestId;
  delete b.traceId;
  return b;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Время ответа GET из страницы (performance.now — монотонные часы браузера). */
async function timed(page: Page, path: string): Promise<{ status: number; ms: number }> {
  return page.evaluate(async (p) => {
    const t = performance.now();
    const r = await fetch(p, { credentials: 'include' });
    await r.text();
    return { status: r.status, ms: performance.now() - t };
  }, path);
}

/** Владелец «Альты» вошёл; id «Альты». */
async function ownerOfAlta(app: AppFn, page: Page): Promise<string> {
  await app('/', { persona: 'owner' });
  await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 15_000 });
  return tenantId(page);
}

interface Scoped {
  alta: string;
  marina: Member;
  grant: Assignment;
  manager: Session;
}

/** Владелец назначает Марине роль в области фирмы (снятие — в `undo`); её сессия — отдельный контекст. */
async function firmManager(
  app: AppFn,
  page: Page,
  session: () => Promise<Session>,
  undo: Undo,
): Promise<Scoped> {
  const alta = await ownerOfAlta(app, page);
  const marina = await memberByEmail(page, alta, MARINA);
  const firm = (await listUnits(page, alta)).find((u) => u.name === FIRM);
  if (!firm) throw new Error(`нет фирмы «${FIRM}»`);
  const grant = await assign(page, alta, {
    memberId: marina.id,
    roleId: await roleId(page, alta, TEMPLATE),
    unitId: firm.id,
  });
  undo('снять роль логиста', () => revoke(page, alta, grant.id));
  const manager = await session();
  await manager.open('/', 'manager');
  await expect(manager.page.getByRole('banner')).toContainText(ALTA, { timeout: 15_000 });
  return { alta, marina, grant, manager };
}

test.describe('выход этапа 1 — приёмка AC @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('AC-01: участник чужой фирмы — 404 как у несуществующего, время не различается', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const { alta, marina, manager } = await firmManager(app, page, session, undo);
    // Владелец видит всех; логист в области «Север Логистик» — только людей своей фирмы.
    const all = (
      expectStatus(await listMembers(page, alta), 200, 'listMembers владельца').body as {
        items: Member[];
      }
    ).items;
    const mine = (
      expectStatus(await listMembers(manager.page, alta), 200, 'listMembers логиста').body as {
        items: Member[];
      }
    ).items;
    const mineIds = new Set(mine.map((m) => m.id));
    expect(mineIds.has(marina.id)).toBe(true);
    expect(mine.length).toBeLessThan(all.length);
    const foreign = all.find((m) => !mineIds.has(m.id) && m.status === 'active');
    if (!foreign) throw new Error('в сиде «Альты» нет участника вне области логиста');

    const member = (id: string) => `/api/v1/tenants/${alta}/members/${id}`;
    expect((await call(manager.page, 'GET', member(marina.id))).status).toBe(200);
    const hidden = await call(manager.page, 'GET', member(foreign.id));
    const missing = await call(manager.page, 'GET', member(UNKNOWN));
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect((hidden.body as { code?: string }).code).toBe('not_found');
    expect(problemShape(hidden)).toEqual(problemShape(missing));
    expect(JSON.stringify(hidden.body)).not.toContain(foreign.displayName);

    // Время: запросы чужого и несуществующего id чередуются, сравниваются медианы (AC-01, matrix.Timing W1.04).
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 15; i++) {
      const x = await timed(manager.page, member(foreign.id));
      const y = await timed(manager.page, member(UNKNOWN));
      expect([x.status, y.status]).toEqual([404, 404]);
      a.push(x.ms);
      b.push(y.ms);
    }
    const [ma, mb] = [median(a), median(b)];
    test.info().annotations.push({
      type: 'AC-01',
      description: `медиана 404: чужой ${ma.toFixed(1)} мс, несуществующий ${mb.toFixed(1)} мс`,
    });
    expect(Math.abs(ma - mb), `медианы ${ma.toFixed(1)} и ${mb.toFixed(1)} мс`).toBeLessThanOrEqual(
      Math.max(25, 0.5 * Math.max(ma, mb)),
    );
  });

  test('AC-02: сессия «Альты» с tenantId «Лотоса» — 404, данных «Лотоса» нет', async ({
    app,
    page,
    session,
  }) => {
    test.slow();
    const operator = await session();
    await operator.open('/platform/tenants', 'operator');
    const lotos = await platformTenantId(operator.page, LOTOS);
    const alta = await ownerOfAlta(app, page);
    expect(lotos).not.toBe(alta);
    for (const path of ['members', 'org-units', 'roles']) {
      const foreign = await call(page, 'GET', `/api/v1/tenants/${lotos}/${path}`);
      const missing = await call(page, 'GET', `/api/v1/tenants/${UNKNOWN}/${path}`);
      expect(foreign.status, path).toBe(404);
      expect(missing.status, path).toBe(404);
      expect(problemShape(foreign), path).toEqual(problemShape(missing));
    }
    const write = await call(page, 'POST', `/api/v1/tenants/${lotos}/org-units`, {
      body: { parentId: null, name: 'Чужая', kind: 'region' },
    });
    expect(write.status).toBe(404);
    // Браузер: адрес «Лотоса» в сессии владельца «Альты» — «Страница не найдена», людей «Лотоса» нет.
    await page.goto(`/t/${lotos}/users`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Страница не найдена', {
      timeout: 15_000,
    });
    await expect(page.getByText('Адрес устарел или раздел вам недоступен.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Участники' })).toHaveCount(0);
    await expect(page.locator('#app')).not.toContainText('Ирина Белова');
  });

  test('AC-07: 100 повторов createOrgUnit с одним Idempotency-Key — один эффект', async ({
    app,
    page,
  }, testInfo) => {
    test.slow();
    const alta = await ownerOfAlta(app, page);
    const firm = (await listUnits(page, alta)).find((u) => u.name === FIRM);
    const name = `Бригада ${runLabel(testInfo.project.name)}`;
    const replies = await page.evaluate(
      async ({ path, body }) => {
        const key = crypto.randomUUID();
        const csrf = decodeURIComponent(
          /(?:^|;\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '',
        );
        const out: { status: number; id: string; replayed: string | null }[] = [];
        for (let i = 0; i < 100; i++) {
          const r = await fetch(path, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': key,
              'X-CSRF-Token': csrf,
            },
            body: JSON.stringify(body),
          });
          const j = (await r.json()) as { id?: string };
          out.push({
            status: r.status,
            id: j.id ?? '',
            replayed: r.headers.get('Idempotency-Replayed'),
          });
        }
        return out;
      },
      {
        path: `/api/v1/tenants/${alta}/org-units`,
        body: { parentId: firm?.id ?? null, name, kind: 'team' },
      },
    );
    expect(replies).toHaveLength(100);
    expect([...new Set(replies.map((r) => r.status))]).toEqual([201]);
    expect(new Set(replies.map((r) => r.id)).size).toBe(1);
    expect(replies[0]?.replayed ?? 'false').toBe('false');
    expect(replies.slice(1).filter((r) => r.replayed !== 'true')).toEqual([]);
    const units = (await listUnits(page, alta)).filter((u) => u.name === name);
    expect(units.map((u) => u.id)).toEqual([replies[0]?.id]);
  });

  test('AC-10: отзыв роли во время чтения — следующая выдача 403', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const { alta, grant, manager } = await firmManager(app, page, session, undo);
    // «Длинная операция»: логист читает список людей подряд; владелец снимает роль посреди чтения.
    const reads: { at: number; status: number }[] = [];
    let stop = false;
    const loop = (async () => {
      while (!stop) {
        const at = Date.now();
        const r = await call(manager.page, 'GET', `/api/v1/tenants/${alta}/members`);
        reads.push({ at, status: r.status });
      }
    })();
    try {
      await expect.poll(() => reads.filter((r) => r.status === 200).length).toBeGreaterThan(2);
      expect(await revoke(page, alta, grant.id)).toBe(204);
      const revokedAt = Date.now();
      await expect
        .poll(() => reads.filter((r) => r.at > revokedAt).length, { timeout: 10_000 })
        .toBeGreaterThan(3);
      stop = true;
      await loop;
      // Каждая выдача, начатая после отзыва, — 403: права проверяются на каждом запросе, без окна кеша.
      const after = reads.filter((r) => r.at > revokedAt);
      expect(after.filter((r) => r.status !== 403)).toEqual([]);
      expect(reads.filter((r) => r.at < revokedAt).some((r) => r.status === 200)).toBe(true);
    } finally {
      stop = true;
      await loop;
    }
  });

  test('AC-11: read_only — баннер, чтение работает, создание 403 tenant_read_only', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const operator = await session();
    await operator.open('/platform/tenants', 'operator');
    const lotos = await platformTenantId(operator.page, LOTOS);
    // Оператор переводит «SPA «Лотос»» в read_only (updatePlatformSubscription); уборка возвращает подписку.
    const restore = await changeSubscription(
      operator.page,
      lotos,
      (cur) => ({ ...cur, status: 'read_only' }),
      undo,
    );

    await openUsers(app, page, { persona: 'owner@t-lotos', tenant: LOTOS, query: 'tab=roles' });
    await expect(
      page.getByRole('status').filter({ hasText: 'Пробный период завершён.' }),
    ).toContainText('Новые операции ограничены.');
    // Чтение работает: роли и люди «Лотоса».
    await expect(page.getByRole('button', { name: /^Массажист/ })).toBeVisible();
    expect((await listMembers(page, lotos)).status).toBe(200);
    // Создание закрыто: команда интерфейса и API — 403 tenant_read_only с текстом словаря.
    await page.getByRole('button', { name: 'Создать роль' }).click();
    const dlg = dialog(page, 'Создать роль');
    await dlg.getByLabel('Название').fill('Роль в режиме чтения');
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/tenants/${lotos}/roles`),
    );
    await dlg.getByRole('button', { name: 'Создать и настроить' }).click();
    const res = await created;
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe('tenant_read_only');
    await expect(page.getByText(READ_ONLY_TEXT).first()).toBeVisible();
    const write = await call(page, 'POST', `/api/v1/tenants/${lotos}/org-units`, {
      body: { parentId: null, name: 'Новый регион', kind: 'region' },
    });
    expect(write.status).toBe(403);
    expect((write.body as { code?: string }).code).toBe('tenant_read_only');

    await restore();
    expect((await platformSubscription(operator.page, lotos)).sub.status).toBe('active');
  });
});
