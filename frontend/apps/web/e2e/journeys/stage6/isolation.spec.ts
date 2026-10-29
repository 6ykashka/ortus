// W6.90 · Выход этапа 6, строки изоляции к пути «Объект от замера до сдачи» на настоящем стенде. Объект «Альты» с
// согласованной сметой и допсоглашением (замер, смета, личная ссылка, документ) читают и пишут:
//   • «Лотос» (другая организация, путь «Альты») — все чтения и записи ремонта 404 `not_found`, объект как несуществующий;
//   • прораб без выдачи на объект — объект скрыт (404), с выдачей — финансы, ссылка, выпуск, смета, закупки и подпись 403;
//   • водитель без роли ремонта — 403 на списке; гость без сессии — 401;
//   • личная ссылка кабинета: неизвестная — 404, отозванная — 410.
// Матрица `backend/test/isolation/repairs_w600*.yaml` не менялась.
//   @stand — страница проекта (390 / 768 / 1440); объект несёт метку прогона.
import { expect, test } from '../../_stand/fixtures.ts';
import { label, realClock } from '../../logistics.stand.ts';
import { agreementSent, contractedObject, grantForeman } from '../../repair.stand.ts';
import { call, LOTOS, type Reply, tenantId } from '../../shell.helpers.ts';
import * as J from '../stage2/journey.ts';

const body = <T>(r: Reply): T => r.body as T;
const ZERO = '00000000-0000-4000-8000-000000000001';

type Row = readonly [method: string, path: string, payload?: unknown];

test.describe('выход этапа 6 — изоляция объекта «Альты» @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('«Лотос» не видит объект (404), прораб без прав — 403, водитель без роли — 403, гость — 401, ссылка кабинета: 404 и 410', async ({
    app,
    page,
    undo,
    session,
  }, testInfo) => {
    test.setTimeout(420_000);
    await realClock(page);
    const tag = label(testInfo.project.name);
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    const base = `/api/v1/tenants/${tenant}/repairs`;
    const obj = await contractedObject(page, tenant, testInfo.project.name, { label: tag });
    await agreementSent(page, obj);
    const pbase = `${base}/projects/${obj.id}`;
    const docs = body<{ items: { id: string }[] }>(
      J.expectOk(await call(page, 'GET', `${pbase}/documents`), 'listRepairDocuments'),
    ).items;
    const doc = docs[0]?.id ?? ZERO;
    // Выпуск заменяет действующую ссылку (одна на объект) и возвращает адрес с токеном один раз.
    const link = body<{ url: string }>(
      J.expectOk(await call(page, 'POST', `${pbase}/client-link`), 'issueClientLink'),
    );
    expect(link.url).toMatch(/\/c\/\S+/);

    // 1. «Лотос» (владелец другой организации) в пути «Альты»: каждая строка — 404 not_found.
    const lotos = await session();
    await lotos.open('/', 'owner@t-lotos');
    await tenantId(lotos.page, LOTOS);
    const foreign: Row[] = [
      ['GET', `${base}/projects`],
      ['GET', pbase],
      ['GET', `${pbase}/overview`],
      ['GET', `${pbase}/works`],
      ['GET', `${base}/work-logs`],
      ['GET', `${pbase}/change-orders`],
      ['GET', `${pbase}/measurement`],
      ['GET', `${pbase}/estimates`],
      ['GET', `${pbase}/estimates/1`],
      ['GET', `${pbase}/schedule`],
      ['GET', `${pbase}/documents`],
      ['GET', `${pbase}/finance`],
      ['GET', `${pbase}/accruals`],
      ['GET', `${pbase}/subcontractors`],
      ['GET', `${pbase}/client-link`],
      ['GET', `${base}/supply-requests`],
      ['GET', `${base}/purchases`],
      ['GET', `${base}/project-stock`],
      ['GET', `${base}/price-items`],
      ['GET', `${base}/templates`],
      ['PATCH', pbase, { name: 'чужое имя' }],
      ['POST', `${pbase}/activate`],
      ['POST', `${pbase}/foreman`, { foremanMemberId: ZERO }],
      ['POST', `${pbase}/hand-over`, { actDocumentId: doc }],
      ['PUT', `${pbase}/measurement`, { rooms: [] }],
      ['POST', `${pbase}/estimates/1/send`],
      ['POST', `${pbase}/schedule/from-estimate`, { estimateVersion: 1 }],
      ['POST', `${base}/documents/${doc}/sign-requests`, {}],
      ['POST', `${pbase}/client-link`],
      ['DELETE', `${pbase}/client-link`],
      [
        'POST',
        `${pbase}/supply-requests`,
        { priceItemId: ZERO, quantity: '1', needBy: '2099-01-01' },
      ],
      ['POST', `${base}/purchases`, { supplier: 'чужой', lines: [{ supplyRequestId: ZERO }] }],
      ['POST', `${base}/acts/${doc}/accruals`],
      ['PUT', `${pbase}/subcontractors/${ZERO}`, { active: false }],
    ];
    const bad: string[] = [];
    for (const [method, path, payload] of foreign) {
      const r = await call(
        lotos.page,
        method,
        path,
        payload === undefined ? {} : { body: payload },
      );
      const code = (r.body as { code?: string } | null)?.code;
      if (r.status !== 404 || code !== 'not_found')
        bad.push(`${method} ${path.replace(base, '')} → ${r.status} ${code ?? ''}`);
    }
    expect(bad, 'строки «Лотос» должны быть 404 not_found').toEqual([]);
    // Данные «Альты» целы: чтения владельца «Альты» не изменились.
    expect(body<{ name: string }>(await call(page, 'GET', pbase)).name).toBe(obj.name);

    // 2. Прораб без выдачи на объект: объект скрыт.
    const fm = await session();
    await fm.open('/', 'foreman');
    const hidden = await call(fm.page, 'GET', pbase);
    expect([403, 404], `прораб без выдачи: ${hidden.status}`).toContain(hidden.status);
    const hiddenList = await call(fm.page, 'GET', `${base}/projects`);
    expect([200, 403]).toContain(hiddenList.status);
    if (hiddenList.status === 200)
      expect(body<{ items: { id: string }[] }>(hiddenList).items.map((p) => p.id)).not.toContain(
        obj.id,
      );

    // 3. Прораб с выдачей на объект: объект читает, деньги, ссылка, смета, закупки и подпись — 403.
    await grantForeman(page, obj, undo);
    expect((await call(fm.page, 'GET', pbase)).status).toBe(200);
    const deniedForeman: Row[] = [
      ['GET', `${pbase}/finance`],
      ['GET', `${pbase}/accruals`],
      ['GET', `${pbase}/subcontractors`],
      ['GET', `${pbase}/client-link`],
      ['POST', `${pbase}/client-link`],
      ['DELETE', `${pbase}/client-link`],
      ['GET', `${pbase}/estimates`],
      ['POST', `${pbase}/activate`],
      ['POST', `${pbase}/hand-over`, { actDocumentId: doc }],
      ['POST', `${base}/documents/${doc}/sign-requests`, {}],
      ['POST', `${base}/acts/${doc}/accruals`],
      ['POST', `${base}/accruals/payout`, { accrualIds: [ZERO] }],
      ['PUT', `${pbase}/subcontractors/${ZERO}`, { active: false }],
      ['POST', `${base}/purchases`, { supplier: 'прораб', lines: [{ supplyRequestId: ZERO }] }],
      ['GET', `${base}/price-items`],
    ];
    const denied: string[] = [];
    for (const [method, path, payload] of deniedForeman) {
      const r = await call(fm.page, method, path, payload === undefined ? {} : { body: payload });
      if (r.status !== 403) denied.push(`${method} ${path.replace(base, '')} → ${r.status}`);
    }
    expect(denied, 'строки прораба без прав должны быть 403').toEqual([]);
    expect(
      body<{ budget?: unknown; clientPhone?: unknown }>(await call(fm.page, 'GET', pbase)).budget,
    ).toBeUndefined();

    // 4. Водитель без роли ремонта: 403 на списке; гость без сессии: 401 на чтении.
    const driver = await session();
    await driver.open('/', 'driver');
    expect((await call(driver.page, 'GET', `${base}/projects`)).status).toBe(403);
    expect([403, 404]).toContain((await call(driver.page, 'GET', pbase)).status);
    const guest = await session();
    await guest.open('/auth/login');
    for (const path of [`${base}/projects`, pbase, `${pbase}/finance`, `${pbase}/documents`]) {
      expect((await call(guest.page, 'GET', path)).status, path).toBe(401);
    }

    // 5. Личная ссылка кабинета: неизвестная — 404, отозванная — 410 (код public_token_expired).
    const token = link.url.split('/').pop() ?? '';
    const unknown = '/api/v1/public/client/' + 'x'.repeat(43);
    expect((await call(guest.page, 'GET', unknown)).status).toBe(404);
    expect((await call(guest.page, 'POST', `${unknown}/estimates/1/approve`)).status).toBe(404);
    expect(
      (
        await call(guest.page, 'POST', `${unknown}/documents/${doc}/sign`, {
          body: { smsCode: '123456' },
        })
      ).status,
    ).toBe(404);
    expect((await call(guest.page, 'GET', `/api/v1/public/client/${token}`)).status).toBe(200);
    J.expectOk(await call(page, 'DELETE', `${pbase}/client-link`), 'revokeClientLink');
    const revoked = await call(guest.page, 'GET', `/api/v1/public/client/${token}`);
    expect(revoked.status).toBe(410);
    expect(JSON.stringify(revoked.body)).toContain('public_token_expired');
    expect(
      (await call(guest.page, 'POST', `/api/v1/public/client/${token}/estimates/1/approve`)).status,
    ).toBe(410);
  });
});
