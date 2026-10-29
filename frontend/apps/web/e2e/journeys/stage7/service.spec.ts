// W7.90 · Выход этапа 7, модуль «Обращения» (backend W7.31, страницы W7.32 и W7.33): обращение клиента от портала до
// оценки. Клиент без входа открывает страницу направления «Массаж» по короткому имени, шлёт обращение (согласие
// обязательно) и получает личную ссылку; сотрудник (владелец «Альты») находит его в очереди, берёт себе, отвечает
// клиенту и пишет заметку (клиент заметку не видит), открывает телефон (запись в аудит), заводит задачу и
// компенсацию, ставит паузу «Ждём клиента» и возвращает в работу, решает с итогом и делится выводом. Клиент по
// ссылке видит ответ, оценивает решение, переоткрывает обращение. Обращение по звонку и перенос в другое направление
// (новый номер, старый ведёт на новый). Очереди и отчёт считают это обращение. Изоляция: «Лотос» не видит обращений
// «Альты» (404), сотрудник без прав «Обращений» — 403, чужая личная ссылка и неизвестная — 404.
//   @stand — страница проекта (390 / 768 / 1440); обращения несут метку прогона, сидовые не меняются.
import { expect, test } from '../../_stand/fixtures.ts';
import { expectStatus } from '../../_stand/stand.ts';
import { label, realClock } from '../../logistics.stand.ts';
import { h1, noHorizontalScroll, openPage } from '../../modules.helpers.ts';
import { call, LOTOS, type Reply, tenantId } from '../../shell.helpers.ts';
import * as J from '../stage2/journey.ts';

const body = <T>(r: Reply): T => r.body as T;

interface Req {
  id: string;
  key: string;
  directionId: string;
  status: string;
  revision: number;
  taskCount: number;
  compensation?: string | null;
  shared?: { text: string } | null;
  assignee?: { displayName?: string; name?: string } | null;
  client: { name: string; phoneMasked: string; phone?: string };
  messages: { kind: string; text: string }[];
  tasks: { key: string }[];
  allowedStatuses: string[];
  oldKeys?: string[];
}
interface PublicReq {
  key: string;
  status: string;
  statusLabel: string;
  messages: { text: string; fromClient: boolean }[];
  canRate: boolean;
  canReopen: boolean;
  rating?: number | null;
}
interface Direction {
  id: string;
  key: string;
  name: string;
}

let seq = 0;
/** Телефон, уникальный на каждый вызов: сервер ограничивает число обращений одного клиента в час. */
const freshPhone = (): string => `+7 9${String(Date.now()).slice(-8)}${String(seq++ % 10)}`;

test.describe('выход этапа 7 — обращения: портал, ответ, срок, решение, оценка, перенос @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('обращение клиента: портал → очередь → ответ → пауза → решение → оценка → повторное открытие → перенос; «Лотос» и сотрудник без прав ничего не видят', async ({
    app,
    page,
    session,
  }, testInfo) => {
    test.setTimeout(420_000);
    await realClock(page);
    const tag = label(testInfo.project.name);
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    const base = `/api/v1/tenants/${tenant}/service`;
    const guest = await session();
    await guest.open('/auth/login');

    // 1. Страница направления «Массаж» — без данных клиентов; без согласия обращение не принимается.
    const pageDto = body<{
      directionName: string;
      types: { id: string; label?: string; name?: string }[];
    }>(
      J.expectOk(
        await call(guest.page, 'GET', '/api/v1/public/service/mas'),
        'getPublicServicePage',
      ),
    );
    expect(pageDto.directionName).toBe('Массаж');
    expect(pageDto.types.length).toBeGreaterThan(0);
    const typeId = pageDto.types[0]?.id ?? '';
    const noConsent = await call(guest.page, 'POST', '/api/v1/public/service/mas/requests', {
      body: {
        typeId,
        text: 'Хочу пожаловаться',
        consent: false,
        clientName: 'Гость',
        phone: freshPhone(),
      },
    });
    expect(noConsent.status).toBe(422);
    expect((await call(guest.page, 'GET', '/api/v1/public/service/nope')).status).toBe(404);

    // 2. Клиент шлёт обращение и получает ссылку.
    const clientName = `Ольга ${tag}`;
    const text = `Массаж закончился раньше времени ${tag}`;
    const receipt = body<{ key: string; token: string; statusLabel: string }>(
      expectStatus(
        await call(guest.page, 'POST', '/api/v1/public/service/mas/requests', {
          body: { typeId, text, consent: true, clientName, phone: freshPhone() },
        }),
        201,
        'submitPublicServiceRequest',
      ),
    );
    expect(receipt.key).toMatch(/^МАС-\d+$/);
    const pub = `/api/v1/public/service/requests/${receipt.token}`;
    const seen = body<PublicReq>(
      J.expectOk(await call(guest.page, 'GET', pub), 'getPublicServiceRequest'),
    );
    expect(seen).toMatchObject({
      key: receipt.key,
      status: 'new',
      canRate: false,
      canReopen: false,
    });
    expect(seen.messages.map((m) => m.text)).toContain(text);

    // 3. Сотрудник: обращение в очереди направления, счётчики растут, клиент — с маской телефона.
    const dirs = body<{ items: Direction[] }>(
      J.expectOk(await call(page, 'GET', `${base}/directions`), 'listServiceDirections'),
    ).items;
    const mas = dirs.find((d) => d.key === 'МАС');
    const grz = dirs.find((d) => d.key === 'ГРЗ');
    expect(mas && grz, 'направления сида МАС и ГРЗ').toBeTruthy();
    const queue = body<{ items: { key: string; client: { name: string } }[] }>(
      J.expectOk(
        await call(
          page,
          'GET',
          `${base}/requests?limit=200&directionId=${mas?.id ?? ''}&q=${encodeURIComponent(clientName)}`,
        ),
        'listServiceRequests',
      ),
    ).items;
    const row = queue.find((r) => r.key === receipt.key);
    expect(row, 'обращение клиента в очереди').toBeTruthy();
    const rbase = `${base}/requests/${(row as unknown as Req).id}`;
    const etag = async (): Promise<string> => (await call(page, 'GET', rbase)).headers.etag ?? '';
    let req = body<Req>(J.expectOk(await call(page, 'GET', rbase), 'getServiceRequest'));
    expect(req.client.name).toBe(clientName);
    expect(req.client.phoneMasked).toMatch(/\*|•|…/);
    expect(req.client.phone ?? '').not.toMatch(/\d{9}/);
    const counts = body<{ items: { id?: string; key?: string; count: number }[] }>(
      J.expectOk(
        await call(page, 'GET', `${base}/queues?directionId=${mas?.id ?? ''}`),
        'getServiceQueueCounts',
      ),
    );
    expect(counts.items.length).toBeGreaterThan(0);

    // 4. Телефон открывается явной командой (запись в аудит).
    const phone = body<{ phone: string }>(
      J.expectOk(
        await call(page, 'POST', `${rbase}/client-phone/reveal`),
        'revealServiceClientPhone',
      ),
    );
    expect(phone.phone.replace(/\D/g, '').length).toBeGreaterThanOrEqual(10);

    // 5. Ответ клиенту виден по ссылке, заметка — нет.
    expectStatus(
      await call(page, 'POST', `${rbase}/messages`, {
        body: { kind: 'public', text: `Приносим извинения ${tag}` },
      }),
      201,
      'postServiceMessage public',
    );
    expectStatus(
      await call(page, 'POST', `${rbase}/messages`, {
        body: { kind: 'note', text: `Внутренняя заметка ${tag}` },
      }),
      201,
      'postServiceMessage note',
    );
    const afterReply = body<PublicReq>(await call(guest.page, 'GET', pub));
    expect(afterReply.messages.map((m) => m.text)).toContain(`Приносим извинения ${tag}`);
    expect(JSON.stringify(afterReply)).not.toContain('Внутренняя заметка');

    // 6. Исполнитель и приоритет — по If-Match (без него отказ); задача и компенсация.
    const noIfMatch = await call(page, 'PATCH', rbase, { body: { priority: 'high' } });
    expect(noIfMatch.status).toBeGreaterThanOrEqual(400);
    req = body<Req>(
      J.expectOk(
        await call(page, 'PATCH', rbase, { body: { priority: 'high' }, ifMatch: await etag() }),
        'updateServiceRequest',
      ),
    );
    expect(req.revision).toBeGreaterThan(0);
    const task = body<{ key: string }>(
      expectStatus(
        await call(page, 'POST', `${rbase}/tasks`, {
          body: { title: `Связаться с клиентом ${tag}` },
        }),
        201,
        'createServiceRequestTask',
      ),
    );
    expect(task.key).toBeTruthy();
    req = body<Req>(
      J.expectOk(
        await call(page, 'POST', `${rbase}/compensation`, {
          body: { kind: 'discount10', text: `Скидка на следующий визит ${tag}` },
          ifMatch: await etag(),
        }),
        'setServiceCompensation',
      ),
    );
    expect(req.compensation).toBeTruthy();
    expect(req.taskCount).toBeGreaterThanOrEqual(1);

    // 7. «Ждём клиента» ставит срок на паузу; ответ клиента возвращает обращение в работу.
    const go = async (to: string, extra: Record<string, unknown> = {}): Promise<Reply> =>
      call(page, 'POST', `${rbase}/transitions`, { body: { to, ...extra }, ifMatch: await etag() });
    req = body<Req>(await call(page, 'GET', rbase));
    if (req.status === 'new') req = body<Req>(J.expectOk(await go('work'), 'transition work'));
    expect(req.status).toBe('work');
    req = body<Req>(J.expectOk(await go('wait'), 'transition wait'));
    expect(req.status).toBe('wait');
    expect(body<PublicReq>(await call(guest.page, 'GET', pub)).statusLabel).toBe(
      'Ждём вашего ответа',
    );
    expectStatus(
      await call(guest.page, 'POST', `${pub}/messages`, {
        body: { text: `Уточняю: вчера в 18:00 ${tag}` },
      }),
      201,
      'postPublicServiceMessage',
    );
    req = body<Req>(await call(page, 'GET', rbase));
    expect(req.status).toBe('work');
    expect(req.messages.some((m) => m.text.includes('вчера в 18:00'))).toBe(true);

    // 8. Решение с итогом, вывод клиенту; закрыть без итога нельзя.
    const noOutcome = await go('resolved');
    expect(noOutcome.status).toBe(422);
    req = body<Req>(
      J.expectOk(await go('resolved', { outcome: 'Устранено' }), 'transition resolved'),
    );
    expect(req.status).toBe('resolved');
    // «Вывод по сотруднику» относится только к обращению о сотруднике; это обращение — нет.
    const notAbout = await call(page, 'POST', `${rbase}/conclusion`, {
      body: { text: `Мастер предупреждён ${tag}` },
      ifMatch: await etag(),
    });
    expect(notAbout.status).toBe(422);
    expect(body<{ detail: string }>(notAbout).detail).toBe('Обращение не касается сотрудника');

    // 9. Клиент оценивает решение; повторная оценка не принимается; клиент переоткрывает обращение.
    const resolved = body<PublicReq>(await call(guest.page, 'GET', pub));
    expect(resolved).toMatchObject({ status: 'resolved', canRate: true, canReopen: true });
    const bad = await call(guest.page, 'POST', `${pub}/csat`, { body: { score: 9 } });
    expect(bad.status).toBe(422);
    const rated = body<PublicReq>(
      J.expectOk(
        await call(guest.page, 'POST', `${pub}/csat`, {
          body: { score: 5, comment: `Спасибо ${tag}` },
        }),
        'ratePublicServiceResolution',
      ),
    );
    expect(rated.rating).toBe(5);
    expect(rated.canRate).toBe(false);
    const again = await call(guest.page, 'POST', `${pub}/csat`, { body: { score: 1 } });
    expect(again.status).toBeGreaterThanOrEqual(400);
    const reopened = body<PublicReq>(
      J.expectOk(
        await call(guest.page, 'POST', `${pub}/reopen`, {
          body: { text: `Проблема повторилась ${tag}` },
        }),
        'reopenPublicServiceRequest',
      ),
    );
    expect(reopened.status).not.toBe('resolved');
    expect(['new', 'work']).toContain(body<Req>(await call(page, 'GET', rbase)).status);

    // 10. Перенос в «Грузоперевозки»: новый номер, старый ведёт на новый.
    req = body<Req>(
      J.expectOk(
        await call(page, 'POST', `${rbase}/move`, {
          body: { directionId: grz?.id },
          ifMatch: await etag(),
        }),
        'moveServiceRequest',
      ),
    );
    expect(req.key).toMatch(/^ГРЗ-\d+$/);
    expect(req.key).not.toBe(receipt.key);
    expect(req.oldKeys ?? []).toContain(receipt.key);
    expect(body<PublicReq>(await call(guest.page, 'GET', pub)).key).toBe(req.key);

    // 11. «Обращение по звонку» своим исполнителем; отчёт и оценки считают это.
    const types = body<{ types: { id: string; directionId?: string }[] }>(
      await call(page, 'GET', `${base}/directions`),
    ).types;
    const called = body<Req>(
      expectStatus(
        await call(page, 'POST', `${base}/requests`, {
          body: {
            directionId: grz?.id,
            typeId: types.find((t) => t.directionId === grz?.id)?.id ?? typeId,
            clientName: `Пётр ${tag}`,
            phone: freshPhone(),
            text: `Не доехал груз ${tag}`,
          },
        }),
        201,
        'createServiceRequest',
      ),
    );
    expect(called.key).toMatch(/^ГРЗ-\d+$/);
    const report = body<{ rows: unknown[] }>(
      J.expectOk(await call(page, 'GET', `${base}/report`), 'getServiceReport'),
    );
    expect(report.rows.length).toBeGreaterThan(0);
    const ratings = body<{ items: unknown[] }>(
      J.expectOk(await call(page, 'GET', `${base}/ratings?limit=50`), 'listServiceRatings'),
    );
    expect(Array.isArray(ratings.items)).toBe(true);

    // 12. Страница «Обращения»: открыта, без горизонтальной прокрутки.
    await openPage(app, page, 'service', { persona: 'owner' });
    await expect(h1(page, 'Обращения')).toBeVisible({ timeout: 30_000 });
    expect(await noHorizontalScroll(page)).toBe(true);

    // 13. Изоляция: «Лотос», сотрудник без прав «Обращений», чужая и неизвестная личная ссылка.
    const lotos = await session();
    await lotos.open('/', 'owner@t-lotos');
    await tenantId(lotos.page, LOTOS);
    for (const [method, path] of [
      ['GET', `${base}/requests`],
      ['GET', rbase],
      ['GET', `${base}/directions`],
      ['GET', `${base}/queues`],
      ['GET', `${base}/report`],
    ] as const) {
      const r = await call(lotos.page, method, path);
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(body<{ code: string }>(r).code).toBe('not_found');
    }
    expect(
      (
        await call(lotos.page, 'POST', `${rbase}/messages`, {
          body: { kind: 'public', text: 'чужой' },
        })
      ).status,
    ).toBe(404);
    const driver = await session();
    await driver.open('/', 'driver');
    const noRights = await call(driver.page, 'GET', `${base}/requests`);
    expect(noRights.status, JSON.stringify(noRights.body)).toBe(403);
    expect(JSON.stringify(noRights.body)).not.toContain(clientName);
    expect(
      (await call(guest.page, 'GET', '/api/v1/public/service/requests/tok_unknown')).status,
    ).toBe(404);
    expect((await call(guest.page, 'GET', `${base}/requests`)).status).toBe(401);
  });
});
