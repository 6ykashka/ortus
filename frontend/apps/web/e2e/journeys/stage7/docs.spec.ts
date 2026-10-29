// W7.90 · Выход этапа 7, модуль «Документы» (backend W7.23 и W7.24, страницы W7.25 и W7.26): документ от создания до
// утверждения. Владелец «Альты» — единственный, у кого на стенде открыт раздел (Q-W7.11-21 для ролей), поэтому он же
// автор, согласующий и адресат ознакомления (правило «автор не согласует» в маршруте выключено). Путь: текстовый
// документ в папке сида, переименование (If-Match), версии (именованная, восстановление), комментарий с якорем,
// доступ списком («Что изменится», затем запись), внешняя ссылка с ПИН-кодом (открытие без сессии, неверный ПИН,
// отзыв), задание PDF; маршрут «Согласовать → Ознакомить»: запуск, возврат без комментария — отказ, возврат с причиной,
// повторный запуск, согласование, ознакомление; архив. Изоляция: «Лотос» не видит ничего из этого (404 как у
// несуществующего), сотрудник без роли документов — 403, чужая ссылка не открывает чужой документ.
//   @stand — страница проекта (390 / 768 / 1440); документ несёт метку прогона. Подпись (ПЭП) на стенде недоступна:
//            dev-вход не даёт повторного входа, backend отвечает 503 — проверено страницей docs-route.
import { expect, test } from '../../_stand/fixtures.ts';
import { expectStatus, memberByEmail } from '../../_stand/stand.ts';
import { memberIdByEmail, textDoc } from '../../docs.stand.ts';
import { label, realClock } from '../../logistics.stand.ts';
import { h1, noHorizontalScroll, openPage } from '../../modules.helpers.ts';
import { call, LOTOS, type Reply, tenantId } from '../../shell.helpers.ts';
import * as J from '../stage2/journey.ts';

const body = <T>(r: Reply): T => r.body as T;
const OWNER = 'd.zimina@alta.example';
const KOTOVA = 'm.kotova@alta.example';

interface Doc {
  id: string;
  title: string;
  status: string;
  version: number;
  revision: number;
  commentCount: number;
  my: { level: string };
  route?: { status: string } | null;
}
interface RouteDto {
  id: string;
  status: string;
  currentStep: number;
  steps: { kind: string; state?: string; status?: string }[];
  back?: { name: string; comment?: string } | null;
}

test.describe('выход этапа 7 — документы: версии, доступ, ссылка, маршрут, архив @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('документ «Альты»: от черновика до согласования и ознакомления; «Лотос» и сотрудник без роли ничего не видят', async ({
    app,
    page,
    session,
  }, testInfo) => {
    test.setTimeout(420_000);
    await realClock(page);
    const tag = label(testInfo.project.name);
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    const base = `/api/v1/tenants/${tenant}`;
    const owner = await memberIdByEmail(page, tenant, OWNER);
    const kotova = (await memberByEmail(page, tenant, KOTOVA)).id;

    // 1. Черновик в папке сида; название несёт метку прогона.
    const made = await textDoc(page, tenant, testInfo.project.name, { prefix: 'Договор W7.90' });
    const dbase = `${base}/docs/${made.id}`;
    const get = async (): Promise<Reply> => call(page, 'GET', dbase);
    const first = body<Doc>(J.expectOk(await get(), 'getDocument'));
    expect(first).toMatchObject({ title: made.title, status: 'draft' });
    expect(first.version).toBeGreaterThanOrEqual(1);

    // 2. Переименование — по If-Match; без него отказ.
    const noMatch = await call(page, 'PATCH', dbase, { body: { title: 'Без If-Match' } });
    expect(noMatch.status).toBeGreaterThanOrEqual(400);
    const renamed = `${made.title} · редакция`;
    const patched = body<Doc>(
      J.expectOk(
        await call(page, 'PATCH', dbase, {
          body: { title: renamed },
          ifMatch: (await get()).headers.etag ?? '',
        }),
        'updateDocument',
      ),
    );
    expect(patched.title).toBe(renamed);

    // 3. Версии: именованная точка и восстановление создают новые версии.
    const v0 = body<{ items: { version: number }[] }>(
      J.expectOk(await call(page, 'GET', `${dbase}/versions`), 'listDocVersions'),
    ).items.length;
    const named = body<{ version: number; name: string }>(
      expectStatus(
        await call(page, 'POST', `${dbase}/versions`, {
          body: { name: `Для согласования ${tag}` },
        }),
        201,
        'saveDocVersion',
      ),
    );
    expect(named.name).toBe(`Для согласования ${tag}`);
    const vlist = body<{ items: { version: number; name?: string | null }[] }>(
      await call(page, 'GET', `${dbase}/versions`),
    ).items;
    expect(vlist.length).toBeGreaterThanOrEqual(v0);
    expect(vlist.some((v) => v.name === named.name)).toBe(true);
    const restored = expectStatus(
      await call(
        page,
        'POST',
        `${dbase}/versions/${vlist[vlist.length - 1]?.version ?? 1}/restore`,
      ),
      201,
      'restoreDocVersion',
    );
    expect(body<{ source: string }>(restored).source).toBe('restore');

    // 4. Комментарий с якорем увеличивает счётчик документа.
    expectStatus(
      await call(page, 'POST', `${dbase}/comments`, {
        body: {
          text: `Проверьте срок ${tag}`,
          anchor: { kind: 'block', ref: 'p1', quote: 'Срок' },
          mention: kotova,
        },
      }),
      201,
      'createDocComment',
    );
    expect(body<Doc>(await get()).commentCount).toBe(1);

    // 5. Доступ списком: «Что изменится» ничего не пишет, запись — по If-Match; логист получает «просмотр».
    const shares = body<{ mode: string; revision: number; entries: unknown[] }>(
      J.expectOk(await call(page, 'GET', `${dbase}/shares`), 'getDocShares'),
    );
    const sharesEtag = (await call(page, 'GET', `${dbase}/shares`)).headers.etag ?? '';
    const entry = { who: 'member', refId: kotova, level: 'view' };
    const dry = body<{ applied: boolean }>(
      J.expectOk(
        await call(page, 'PUT', `${dbase}/shares`, {
          body: { mode: 'listed', entries: [entry], dryRun: true },
          ifMatch: sharesEtag,
        }),
        'setDocShares dryRun',
      ),
    );
    expect(dry.applied).toBe(false);
    expect(body<{ mode: string }>(await call(page, 'GET', `${dbase}/shares`)).mode).toBe(
      shares.mode,
    );
    const set = J.expectOk(
      await call(page, 'PUT', `${dbase}/shares`, {
        body: { mode: 'listed', entries: [entry] },
        ifMatch: (await call(page, 'GET', `${dbase}/shares`)).headers.etag ?? '',
      }),
      'setDocShares',
    );
    expect(body<{ applied: boolean }>(set).applied).toBe(true);
    expect(body<{ mode: string }>(await call(page, 'GET', `${dbase}/shares`)).mode).toBe('listed');

    // 6. Внешняя ссылка с ПИН-кодом: без сессии открывается только с верным ПИН, после отзыва — нет.
    const exp = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const link = body<{ link: { id: string }; token: string; pin?: string }>(
      expectStatus(
        await call(page, 'POST', `${dbase}/links`, {
          body: { level: 'view', expiresAt: exp, pin: true, watermark: true, download: false },
        }),
        201,
        'createDocLink',
      ),
    );
    expect(link.pin).toBeTruthy();
    const guest = await session();
    await guest.open('/auth/login');
    const open = `/api/v1/public/doc-links/${link.token}/open`;
    const bad = await call(guest.page, 'POST', open, { body: { pin: '0000' } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const good = J.expectOk(
      await call(guest.page, 'POST', open, { body: { pin: link.pin } }),
      'openDocLink',
    );
    expect(body<{ title: string }>(good).title).toBe(renamed);
    expect((await call(page, 'DELETE', `${dbase}/links/${link.link.id}`)).status).toBe(200);
    const revoked = await call(guest.page, 'POST', open, { body: { pin: link.pin } });
    expect(revoked.status).toBeGreaterThanOrEqual(400);
    const unknown = await call(guest.page, 'POST', '/api/v1/public/doc-links/nope-token/open', {
      body: {},
    });
    expect(unknown.status).toBeGreaterThanOrEqual(400);

    // 7. Задание PDF встаёт в очередь (исполняет сервер документов, на стенде его нет — итог не ждём).
    const job = body<{ id: string; status: string }>(
      expectStatus(
        await call(page, 'POST', `${base}/doc-jobs`, { body: { op: 'to_pdf', docIds: [made.id] } }),
        202,
        'createDocJob',
      ),
    );
    expect(['queued', 'running', 'done', 'failed']).toContain(job.status);
    expect(body<{ id: string }>(await call(page, 'GET', `${base}/doc-jobs/${job.id}`)).id).toBe(
      job.id,
    );

    // 8. Маршрут «Согласовать → Ознакомить»: «Что изменится» → запуск → возврат → повтор → согласование → ознакомление.
    const steps = [
      { kind: 'approve', name: 'Согласовать', mode: 'all', whoMemberIds: [owner], days: 5 },
      {
        kind: 'ack',
        name: 'Ознакомить',
        mode: 'all',
        audience: [{ who: 'member', refId: owner, level: 'view' }],
        days: 5,
      },
    ];
    const rules = { lock: false, notAuthor: false, commentOnBack: true, escalate: false };
    const dryRoute = body<{ applied: boolean }>(
      J.expectOk(
        await call(page, 'POST', `${dbase}/route`, { body: { steps, rules, dryRun: true } }),
        'startDocRoute dryRun',
      ),
    );
    expect(dryRoute.applied).toBe(false);
    expect((await call(page, 'GET', `${dbase}/route`)).status).toBe(404);
    expectStatus(
      await call(page, 'POST', `${dbase}/route`, { body: { steps, rules } }),
      201,
      'startDocRoute',
    );
    let route = body<RouteDto>(
      J.expectOk(await call(page, 'GET', `${dbase}/route`), 'getDocRoute'),
    );
    expect(route.status).toBe('active');
    expect(route.steps).toHaveLength(2);
    expect(body<Doc>(await get()).status).toBe('in_route');
    const noComment = await call(page, 'POST', `${dbase}/route/decisions`, {
      body: { decision: 'return' },
    });
    expect(noComment.status).toBe(422);
    route = body<RouteDto>(
      J.expectOk(
        await call(page, 'POST', `${dbase}/route/decisions`, {
          body: { decision: 'return', comment: 'Срок окончания — 27 ноября' },
        }),
        'decideDocRoute return',
      ),
    );
    expect(route.status).toBe('returned');
    expect(route.back?.comment).toBe('Срок окончания — 27 ноября');
    expect(body<Doc>(await get()).status).toBe('returned');
    const cancel = await call(page, 'POST', `${dbase}/route/cancel`);
    expect(cancel.status, JSON.stringify(cancel.body)).toBeLessThan(300);
    expect(body<RouteDto>(await call(page, 'GET', `${dbase}/route`)).status).toBe('cancelled');
    expectStatus(
      await call(page, 'POST', `${dbase}/route`, { body: { steps, rules } }),
      201,
      'startDocRoute 2',
    );
    route = body<RouteDto>(
      J.expectOk(
        await call(page, 'POST', `${dbase}/route/decisions`, { body: { decision: 'approve' } }),
        'decideDocRoute approve',
      ),
    );
    // Автор в адресатах «Ознакомить» не ждёт сам себя: шаг закрывается сразу, маршрут завершён.
    expect(route.status, JSON.stringify(route)).toBe('done');
    expect(route.steps.map((s) => s.status)).toEqual(['done', 'done']);
    const noAsk = await call(page, 'POST', `${dbase}/ack`, { body: { device: 'e2e' } });
    expect(noAsk.status).toBe(422);
    expect(body<{ detail: string }>(noAsk).detail).toBe('Ознакомление не запрошено');
    route = body<RouteDto>(await call(page, 'GET', `${dbase}/route`));
    expect(route.status).toBe('done');
    expect(['agreed', 'approved', 'signed']).toContain(body<Doc>(await get()).status);
    // Подпись на стенде недоступна: запрос кода без повторного входа — отказ зависимости, не 2xx.
    const sign = await call(page, 'POST', `${dbase}/route/sign/code`, {
      body: { method: 'pep_login' },
    });
    expect(sign.status).toBeGreaterThanOrEqual(400);
    const activity = body<{ items: unknown[] }>(
      J.expectOk(await call(page, 'GET', `${dbase}/activity?limit=50`), 'listDocActivity'),
    );
    expect(activity.items.length).toBeGreaterThanOrEqual(5);

    // 9. Страница документа и списка.
    await openPage(app, page, `docs?doc=${made.id}`, { persona: 'owner' });
    await expect(h1(page, renamed)).toBeVisible({ timeout: 30_000 });
    expect(await noHorizontalScroll(page)).toBe(true);

    // 10. Изоляция: «Лотос» и сотрудник без роли документов.
    const lotos = await session();
    await lotos.open('/', 'owner@t-lotos');
    const lotosTenant = await tenantId(lotos.page, LOTOS);
    for (const [method, path] of [
      ['GET', `${base}/docs`],
      ['GET', dbase],
      ['GET', `${dbase}/versions`],
      ['GET', `${dbase}/route`],
      ['GET', `${dbase}/shares`],
      ['GET', `${base}/doc-folders`],
    ] as const) {
      const r = await call(lotos.page, method, path);
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(body<{ code: string }>(r).code).toBe('not_found');
    }
    expect(
      (
        await call(lotos.page, 'POST', `${dbase}/links`, {
          body: { level: 'view', expiresAt: exp },
        })
      ).status,
    ).toBe(404);
    const crossDoc = await call(
      lotos.page,
      'GET',
      `/api/v1/tenants/${lotosTenant}/docs/${made.id}`,
    );
    expect(crossDoc.status).toBe(404);
    expect(
      JSON.stringify(body(await call(lotos.page, 'GET', `/api/v1/tenants/${lotosTenant}/docs`))),
    ).not.toContain(renamed);

    const manager = await session();
    await manager.open('/', 'manager');
    const noRole = await call(manager.page, 'GET', `${base}/docs`);
    expect(noRole.status, JSON.stringify(noRole.body)).toBe(403);
    expect(JSON.stringify(noRole.body)).not.toContain(renamed);

    // 11. Архив: документ уходит из рабочего списка.
    const arch = body<Doc>(
      J.expectOk(await call(page, 'POST', `${dbase}/archive`), 'archiveDocument'),
    );
    expect(arch.status).toBe('archived');
  });
});
