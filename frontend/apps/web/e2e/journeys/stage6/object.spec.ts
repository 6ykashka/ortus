// W6.90 · Выход этапа 6: «Объект от замера до сдачи» (backend W6.11–W6.15, страницы W6.20–W6.24). Сквозной путь одного
// объекта организации «Альта» на настоящем стенде: объект-черновик (D-17) → замер → смета по шаблону → правка скидки →
// отправка → согласие заказчика по личной ссылке → «В работу» (работы из строк сметы, бюджет) → прораб → отметки прораба
// (объём выше плана и без фото — отказ, возврат с причиной, повтор, приёмка) → допработы (отказ, предложение) →
// допсоглашение с подписью заказчика кодом из SMS → график (из сметы, перенос с причиной, исполнитель, базовый план) →
// снабжение (заявка прораба, закупка, приход по QR, списание) → акт, начисление бригаде, выплата в кассу → доступ
// подрядчика → акт сдачи, подпись заказчика → «Сдать объект» на странице → кабинет закрыт (410), правки закрыты.
// Строки изоляции «Альта / Лотос» к пути — в isolation.spec.ts.
//   @stand — страница проекта (390 / 768 / 1440); объект несёт метку прогона, сид не меняется, выдача роли «Прораб»
//   снимается уборкой. Шов стенда (акты, акт сдачи и подрядчик вставкой в базу, код подписи из журнала API) — stand-db.ts.
import type { Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import { expectStatus, memberByEmail } from '../../_stand/stand.ts';
import { label, realClock } from '../../logistics.stand.ts';
import { noHorizontalScroll, toast } from '../../modules.helpers.ts';
import { section } from '../../repair-money.helpers.ts';
import {
  estimateDraft,
  grantForeman,
  installRepairs,
  measure,
  sendEstimate,
} from '../../repair.stand.ts';
import { call, type Reply, tenantId } from '../../shell.helpers.ts';
import * as J from '../stage2/journey.ts';
import { insertDocument, insertSubcontractor, lastSignCode } from './stand-db.ts';

const body = <T>(r: Reply): T => r.body as T;
const ok = J.expectOk;
const rev = (r: number | string): string => `"rev-${String(r)}"`;
const money = (m?: { amountMinor: number } | null): number => m?.amountMinor ?? 0;
const qty = (v: number): string => String(Math.round(v * 1000) / 1000);

interface Money {
  amountMinor: number;
  currency: string;
}
interface Project {
  id: string;
  status: string;
  revision: number;
  budget?: Money;
  clientPhone?: string;
  foremanMemberId: string | null;
  measured: boolean;
  workers: { id: string; displayName: string }[];
  handedOverOn?: string;
  warrantyUntil?: string;
  readiness: { acceptedPct: number; pendingPct: number; clientPct: number };
}
interface Work {
  id: string;
  name: string;
  unit: string;
  plan: string;
  fact: string;
  pending: string;
}
interface Estimate {
  version: number;
  kind: string;
  state: string;
  revision: number;
  total: Money;
  discountPct: number;
  sections: { id: string; name: string }[];
  lines: { id: string; name: string; kind: string }[];
}
interface WorkLog {
  id: string;
  number?: string;
  status: string;
  revision: number;
  returnReason?: string;
}
interface Change {
  id: string;
  number: string;
  status: string;
  revision: number;
  rejectReason?: string;
}
interface Stage {
  id: string;
  name: string;
  status: string;
  offsetWd: number;
  critical: boolean;
  executorMemberId?: string;
}
interface Schedule {
  stages: Stage[];
  baseline: { version: number } | null;
  forecastDueOn: string | null;
  changes: { text: string; reason?: string }[];
  revision: number;
}
interface Doc {
  id: string;
  kind: string;
  title: string;
  state: string;
  actNo?: number;
}
interface Accrual {
  id: string;
  workerId: string;
  state: string;
  amount: Money;
  actId?: string;
}

/** Дата в Москве (ГГГГ-ММ-ДД) со сдвигом в днях. */
function moscowDate(shiftDays = 0): string {
  const d = new Date(Date.now() + shiftDays * 86_400_000);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
}

/**
 * Готовый файл-фото для отметки и допработы: у ремонта нет своего родителя файлов (Q-W6.90-2), поэтому фото кладётся
 * вложением задачи (purpose task_attachment, владелец tasks/task) — отметка требует только готовый файл организации.
 */
async function readyPhoto(page: Page, tenant: string, tag: string): Promise<string> {
  const base = `/api/v1/tenants/${tenant}`;
  const projects = body<{ items: { id: string }[] }>(
    ok(await call(page, 'GET', `${base}/projects`), 'listTaskProjects'),
  ).items;
  const project = projects[0];
  if (!project) throw new Error('в организации нет проектов задач');
  const task = body<{ id: string }>(
    expectStatus(
      await call(page, 'POST', `${base}/tasks`, {
        body: { projectId: project.id, title: `Фото объекта ${tag}` },
      }),
      201,
      'createTask',
    ),
  );
  const fileId = await page.evaluate(
    async ({ base, taskId, tag }) => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 480;
      const g = c.getContext('2d');
      if (!g) throw new Error('canvas: нет 2d-контекста');
      g.fillStyle = '#7d5a3b';
      g.fillRect(0, 0, 640, 480);
      g.fillStyle = '#ffffff';
      g.font = '36px sans-serif';
      g.fillText(`Ортус · объект · ${tag}`, 30, 250);
      const blob = await new Promise<Blob>((done, fail) =>
        c.toBlob((b) => (b ? done(b) : fail(new Error('toBlob'))), 'image/jpeg', 0.85),
      );
      const bytes = await blob.arrayBuffer();
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const csrf = decodeURIComponent(
        /(?:^|;\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '',
      );
      const post = async (path: string, payload: unknown) => {
        const r = await fetch(path, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
        return r.json() as Promise<Record<string, string>>;
      };
      const t = await post(`${base}/files/uploads`, {
        fileName: 'object.jpg',
        contentType: 'image/jpeg',
        sizeBytes: bytes.byteLength,
        sha256: sha,
        purpose: 'task_attachment',
        owner: { moduleKey: 'tasks', entityType: 'task', entityId: taskId },
      });
      const put = await fetch(t.uploadUrl ?? '', {
        method: 'PUT',
        headers: { 'Content-Type': t.requiredContentType ?? 'image/jpeg' },
        body: bytes,
      });
      if (!put.ok) throw new Error(`PUT ${put.status}`);
      await post(`${base}/files/uploads/${t.uploadId}/complete`, { sha256: sha });
      return t.fileId ?? '';
    },
    { base, taskId: task.id, tag },
  );
  await expect
    .poll(
      async () =>
        (body<{ status?: string }>(await call(page, 'GET', `${base}/files/${fileId}`)) ?? {})
          .status,
      { timeout: 60_000, message: `проверка файла ${fileId} cmd/worker` },
    )
    .toBe('ready');
  return fileId;
}

test.describe('выход этапа 6 — объект от замера до сдачи @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('замер → смета → договор → работы → допсоглашение → график → снабжение → оплата бригады → сдача; страницы объекта', async ({
    app,
    page,
    undo,
    session,
  }, testInfo) => {
    test.setTimeout(900_000);
    await realClock(page);
    const tag = label(testInfo.project.name);
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    const base = `/api/v1/tenants/${tenant}/repairs`;
    const guest = await session();
    await guest.open('/auth/login');

    // 1. Объект-черновик без прораба (D-17): прораба назначают после договора; замера ещё нет.
    // Черновик создаёт заявка на этапе «Замер» (leadTaskId) без прораба: без заявки объект сразу «в работе».
    await installRepairs(page, tenant);
    const sok = await memberByEmail(page, tenant, 'a.sokolov@alta.example');
    const unit = sok.orgUnitIds?.[0] ?? '';
    expect(unit, 'подразделение прораба').toBeTruthy();
    const taskProjects = body<{ items: { id: string }[] }>(
      ok(await call(page, 'GET', `/api/v1/tenants/${tenant}/projects`), 'listTaskProjects'),
    ).items;
    const lead = body<{ id: string }>(
      expectStatus(
        await call(page, 'POST', `/api/v1/tenants/${tenant}/tasks`, {
          body: { projectId: taskProjects[0]?.id, title: `Заявка на ремонт, замер ${tag}` },
        }),
        201,
        'createTask (заявка)',
      ),
    );
    const obj = {
      orgUnitId: unit,
      name: `ЖК Речной · кв. 42 · ${tag}`,
      address: `ул. Речная, 42 · ${tag}`,
      label: tag,
      tenant,
      foremanMemberId: null as string | null,
      id: '',
    };
    obj.id = body<{ id: string }>(
      expectStatus(
        await call(page, 'POST', `${base}/projects`, {
          body: {
            orgUnitId: unit,
            name: obj.name,
            address: obj.address,
            workers: [{ displayName: 'Олег Дронов', trade: 'Отделочник' }],
            clientName: 'Ольга Смирнова',
            clientPhone: '+7 900 000-11-22',
            areaM2: '54',
            rooms: 3,
            kind: 'apartment',
            leadTaskId: lead.id,
          },
        }),
        201,
        'createRepairProject',
      ),
    ).id;
    const pbase = `${base}/projects/${obj.id}`;
    const getProject = async (): Promise<{ p: Project; etag: string }> => {
      const r = ok(await call(page, 'GET', pbase), 'getRepairProject');
      return { p: body<Project>(r), etag: r.headers.etag ?? '' };
    };
    let { p: project } = await getProject();
    expect(project).toMatchObject({ status: 'draft', foremanMemberId: null, measured: false });
    expect(project.workers).toHaveLength(1);

    // 2. Замер: три помещения; итоги считает сервер (пол 35,5 м², мокрая зона 5 м²).
    await measure(page, obj);
    const measurement = body<{ totals: { floorM2: string; wetFloorM2: string } }>(
      ok(await call(page, 'GET', `${pbase}/measurement`), 'getMeasurement'),
    );
    expect(Number(measurement.totals.floorM2)).toBeCloseTo(35.5, 1);
    expect(Number(measurement.totals.wetFloorM2)).toBeCloseTo(5, 1);
    expect((await getProject()).p.measured).toBe(true);

    // 3. Смета по шаблону (версия 1): скидка меняет итог; «В работу» без согласованной сметы — отказ.
    const draft = await estimateDraft(page, obj);
    const est1 = body<Estimate>(
      ok(await call(page, 'GET', `${pbase}/estimates/${draft.version}`), 'getEstimate'),
    );
    expect(est1).toMatchObject({ state: 'draft', kind: 'first' });
    expect(est1.lines.length).toBeGreaterThan(0);
    expect(money(est1.total)).toBeGreaterThan(0);
    const discounted = body<Estimate>(
      ok(
        await call(page, 'PATCH', `${pbase}/estimates/${draft.version}`, {
          body: { discountPct: 5 },
          ifMatch: rev(est1.revision),
        }),
        'updateEstimateDraft',
      ),
    );
    expect(discounted.discountPct).toBe(5);
    expect(money(discounted.total)).toBeLessThan(money(est1.total));
    const early = await call(page, 'POST', `${pbase}/activate`, {
      ifMatch: (await getProject()).etag,
    });
    expect(early.status).toBe(409);
    expect(JSON.stringify(early.body)).toContain('repair_estimate_not_approved');

    // 4. Отправка заказчику; отправленная версия закрыта для правок; согласие — по личной ссылке кабинета.
    await sendEstimate(page, obj, { version: draft.version, revision: discounted.revision });
    const locked = await call(page, 'PATCH', `${pbase}/estimates/${draft.version}`, {
      body: { discountPct: 7 },
      ifMatch: (await call(page, 'GET', `${pbase}/estimates/${draft.version}`)).headers.etag ?? '',
    });
    expect(locked.status).toBe(409);
    const issued = body<{ url: string; link: { active: boolean } }>(
      expectStatus(await call(page, 'POST', `${pbase}/client-link`), 201, 'issueClientLink'),
    );
    expect(issued.link.active).toBe(true);
    const token = issued.url.split('/').pop() ?? '';
    expect(token.length).toBeGreaterThan(10);
    const cab = `/api/v1/public/client/${token}`;
    const before = body<{ projectName: string; estimate?: { state: string } }>(
      ok(await call(guest.page, 'GET', cab), 'getClientCabinet'),
    );
    expect(before.projectName).toBe(obj.name);
    expect(before.estimate?.state).toBe('sent');
    ok(
      await call(guest.page, 'POST', `${cab}/estimates/${draft.version}/approve`),
      'approveEstimateByClient',
    );
    expect(
      body<{ estimate?: { state: string } }>(await call(guest.page, 'GET', cab)).estimate?.state,
    ).toBe('approved');

    // 5. «В работу»: бюджет — итог согласованной сметы, работы — её строки работ; повторная — отказ.
    const activated = body<Project>(
      ok(
        await call(page, 'POST', `${pbase}/activate`, { ifMatch: (await getProject()).etag }),
        'activateRepairProject',
      ),
    );
    expect(activated.status).toBe('active');
    expect(money(activated.budget)).toBe(money(discounted.total));
    const works = body<{ items: Work[] }>(
      ok(await call(page, 'GET', `${pbase}/works`), 'listRepairWorks'),
    ).items;
    expect(works.length).toBeGreaterThan(0);
    for (const w of works) expect(Number(w.plan)).toBeGreaterThan(0);
    const again = await call(page, 'POST', `${pbase}/activate`, {
      ifMatch: (await getProject()).etag,
    });
    expect(again.status).toBe(409);

    // 6. Прораб: назначение (сид даёт роль только по связи «своё» — объекту выдаётся явно), его сессия.
    ok(
      await call(page, 'POST', `${pbase}/foreman`, { body: { foremanMemberId: sok.id } }),
      'assignRepairForeman',
    );
    await grantForeman(page, { ...obj, foremanMemberId: sok.id }, undo);
    const fm = await session();
    await fm.open('/', 'foreman');
    const foremanView = body<Project>(
      ok(await call(fm.page, 'GET', pbase), 'getRepairProject (прораб)'),
    );
    expect(foremanView.foremanMemberId).toBe(sok.id);
    expect(foremanView.budget).toBeUndefined();
    expect(foremanView.clientPhone).toBeUndefined();
    expect((await call(fm.page, 'GET', `${pbase}/finance`)).status).toBe(403);

    // 7. Отметки прораба: объём выше плана на 10 % и отметка без фото — отказ; возврат с причиной; повтор; приёмка.
    const photo = await readyPhoto(page, tenant, tag);
    project = (await getProject()).p;
    const crew = project.workers[0]?.id ?? '';
    const first = works[0] as Work;
    const mark = (q: number, file: string[] = [photo]): Record<string, unknown> => ({
      projectId: obj.id,
      workDate: moscowDate(),
      timeZone: 'Europe/Moscow',
      lines: [{ workId: first.id, quantity: qty(q), unit: first.unit }],
      evidenceFileIds: file,
      crewWorkerIds: [crew],
      note: `Отметка ${tag}`,
    });
    const tooMuch = await call(fm.page, 'POST', `${base}/work-logs`, {
      body: mark(Number(first.plan) * 1.5),
    });
    expect(tooMuch.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(tooMuch.body)).toContain('work_volume_exceeds_plan');
    const noPhoto = await call(fm.page, 'POST', `${base}/work-logs`, { body: mark(1, []) });
    expect(noPhoto.status).toBeGreaterThanOrEqual(400);
    const log1 = body<WorkLog>(
      expectStatus(
        await call(fm.page, 'POST', `${base}/work-logs`, { body: mark(Number(first.plan) / 2) }),
        201,
        'submitWorkLog',
      ),
    );
    expect(log1.status).toBe('submitted');
    expect(
      (
        await call(fm.page, 'POST', `${base}/work-logs/${log1.id}/accept`, {
          ifMatch: rev(log1.revision),
        })
      ).status,
    ).toBe(403);
    const returned = body<WorkLog>(
      ok(
        await call(page, 'POST', `${base}/work-logs/${log1.id}/return`, {
          body: { reason: 'Фото нечёткое, переснимите' },
          ifMatch: rev(log1.revision),
        }),
        'returnWorkLog',
      ),
    );
    expect(returned.status).toBe('rejected');
    const seenByForeman = body<{ items: WorkLog[] }>(
      ok(await call(fm.page, 'GET', `${base}/work-logs?projectId=${obj.id}`), 'listWorkLogs'),
    ).items.find((l) => l.id === log1.id);
    expect(seenByForeman?.returnReason).toBe('Фото нечёткое, переснимите');
    const log2 = body<WorkLog>(
      expectStatus(
        await call(fm.page, 'POST', `${base}/work-logs`, { body: mark(Number(first.plan)) }),
        201,
        'submitWorkLog (повтор)',
      ),
    );
    const mid = body<{ items: Work[] }>(await call(page, 'GET', `${pbase}/works`)).items.find(
      (w) => w.id === first.id,
    );
    expect(Number(mid?.fact)).toBe(0);
    expect(Number(mid?.pending)).toBeCloseTo(Number(first.plan), 2);
    const accepted = body<WorkLog>(
      ok(
        await call(page, 'POST', `${base}/work-logs/${log2.id}/accept`, {
          ifMatch: rev(log2.revision),
        }),
        'acceptWorkLog',
      ),
    );
    expect(accepted.status).toBe('accepted');
    const done = body<{ items: Work[] }>(await call(page, 'GET', `${pbase}/works`)).items.find(
      (w) => w.id === first.id,
    );
    expect(Number(done?.fact)).toBeCloseTo(Number(first.plan), 2);
    expect(Number(done?.pending)).toBe(0);
    expect((await getProject()).p.readiness.acceptedPct).toBeGreaterThan(0);

    // 8. Допработы: прораб предлагает без цен; владелец отклоняет первую с причиной; вторая идёт в допсоглашение.
    const propose = async (title: string): Promise<Change> =>
      body<Change>(
        expectStatus(
          await call(fm.page, 'POST', `${pbase}/change-orders`, {
            body: {
              title,
              quantity: '3',
              unit: 'm2',
              photoFileIds: [photo],
              note: `Допработа ${tag}`,
            },
          }),
          201,
          'proposeChangeOrder',
        ),
      );
    const c1 = await propose(`Выравнивание откосов ${tag}`);
    expect(c1.status).toBe('proposed');
    const rejected = body<Change>(
      ok(
        await call(page, 'POST', `${base}/change-orders/${c1.id}/reject`, {
          body: { reason: 'not_agreed_with_client' },
          ifMatch: rev(c1.revision),
        }),
        'rejectChangeOrder',
      ),
    );
    expect(rejected.status).toBe('rejected');
    const c2 = await propose(`Грунтовка стен в коридоре ${tag}`);

    // 9. Допсоглашение № 1: версия 2 (kind change) с разделом «Допработы», строка из прайса, отправка, подпись SMS.
    const est2 = body<Estimate>(
      expectStatus(
        await call(page, 'POST', `${pbase}/estimates`, {
          body: { kind: 'change', changeOrderIds: [c2.id] },
        }),
        201,
        'createEstimateRevision',
      ),
    );
    const extra = est2.sections.find((s) => s.name.startsWith('Допработы'));
    expect(extra, 'раздел «Допработы · ДР-N» допсоглашения').toBeTruthy();
    const priced = body<{ items: { id: string; kind: string; archived: boolean }[] }>(
      ok(await call(page, 'GET', `${base}/price-items?kind=work&limit=50`), 'listPriceItems'),
    ).items.find((i) => i.kind === 'work' && !i.archived);
    expect(priced, 'работа в прайсе организации').toBeTruthy();
    const est2Lines = body<Estimate>(
      ok(
        await call(page, 'PATCH', `${pbase}/estimates/${est2.version}`, {
          body: { addLines: [{ sectionId: extra?.id, priceItemId: priced?.id, quantity: '3' }] },
          ifMatch: rev(est2.revision),
        }),
        'updateEstimateDraft (допработы)',
      ),
    );
    expect(money(est2Lines.total)).toBeGreaterThan(money(discounted.total));
    await sendEstimate(page, obj, { version: est2.version, revision: est2Lines.revision });
    const docs = (): Promise<Doc[]> =>
      call(page, 'GET', `${pbase}/documents`).then(
        (r) => body<{ items: Doc[] }>(ok(r, 'listRepairDocuments')).items,
      );
    const agreement = (await docs()).find((d) => d.kind === 'agreement');
    expect(agreement?.title).toContain('Допсоглашение № 1');
    expect(agreement?.state).toBe('wait');
    expect(
      (await call(page, 'POST', `${base}/documents/${agreement?.id}/sign-requests`, { body: {} }))
        .status,
    ).toBe(201);
    const wrong = await call(guest.page, 'POST', `${cab}/documents/${agreement?.id}/sign`, {
      body: { smsCode: lastSignCode() === '000000' ? '111111' : '000000' },
    });
    expect(wrong.status).toBe(422);
    ok(
      await call(guest.page, 'POST', `${cab}/documents/${agreement?.id}/sign`, {
        body: { smsCode: lastSignCode() },
      }),
      'signDocumentByClient (допсоглашение)',
    );
    expect((await docs()).find((d) => d.id === agreement?.id)?.state).toBe('signed');
    const est2After = body<Estimate>(
      ok(await call(page, 'GET', `${pbase}/estimates/${est2.version}`), 'getEstimate'),
    );
    expect(est2After.state).toBe('approved');
    const changes = body<{ items: Change[] }>(
      ok(await call(page, 'GET', `${pbase}/change-orders`), 'listChangeOrders'),
    ).items;
    expect(changes.find((c) => c.id === c2.id)?.status).toBe('signed');
    expect(changes.find((c) => c.id === c1.id)?.status).toBe('rejected');
    expect(money((await getProject()).p.budget)).toBeGreaterThan(money(activated.budget));

    // 10. График: из согласованной сметы; перенос без причины не сохранится, с причиной — в журнале; исполнитель; базовый план.
    expectStatus(
      await call(page, 'POST', `${pbase}/schedule/from-estimate`, {
        body: { estimateVersion: est2.version },
      }),
      201,
      'createScheduleFromEstimate',
    );
    const getSchedule = async (): Promise<{ s: Schedule; etag: string }> => {
      const r = ok(await call(page, 'GET', `${pbase}/schedule`), 'getSchedule');
      return { s: body<Schedule>(r), etag: r.headers.etag ?? '' };
    };
    let sch = await getSchedule();
    expect(sch.s.stages.length).toBeGreaterThan(1);
    expect(sch.s.stages.some((s) => s.critical)).toBe(true);
    expect(sch.s.forecastDueOn).toBeTruthy();
    const moving = sch.s.stages.find((s) => s.status === 'planned');
    expect(moving, 'этап, который можно перенести').toBeTruthy();
    const shift = [{ stageId: moving?.id, offsetWd: (moving?.offsetWd ?? 0) + 2 }];
    const preview = body<{ moved: unknown[]; delayWd: number }>(
      ok(
        await call(page, 'POST', `${pbase}/schedule/preview`, { body: { changes: shift } }),
        'previewScheduleChange',
      ),
    );
    expect(preview.moved.length).toBeGreaterThan(0);
    const noReason = await call(page, 'POST', `${pbase}/schedule/changes`, {
      body: { changes: shift },
      ifMatch: sch.etag,
    });
    expect(noReason.status).toBeGreaterThanOrEqual(400);
    ok(
      await call(page, 'POST', `${pbase}/schedule/changes`, {
        body: { changes: shift, reason: 'material_delay' },
        ifMatch: sch.etag,
      }),
      'applyScheduleChange',
    );
    sch = await getSchedule();
    expect(sch.s.changes.length).toBeGreaterThan(0);
    ok(
      await call(page, 'PATCH', `${pbase}/schedule/stages/${moving?.id}`, {
        body: { executorMemberId: sok.id },
        ifMatch: sch.etag,
      }),
      'setScheduleStageExecutor',
    );
    sch = await getSchedule();
    expect(sch.s.stages.find((s) => s.id === moving?.id)?.executorMemberId).toBe(sok.id);
    ok(
      await call(page, 'POST', `${pbase}/schedule/baselines`, {
        body: { agreementNo: 1 },
        ifMatch: sch.etag,
      }),
      'createScheduleBaseline',
    );
    sch = await getSchedule();
    expect(sch.s.baseline?.version).toBeGreaterThanOrEqual(1);

    // 11. Снабжение: заявка прораба на материал, закупка владельца, приход по QR, списание на объект (прораб до прихода — 409).
    const material = body<{ items: { id: string; kind: string; archived: boolean }[] }>(
      ok(await call(page, 'GET', `${base}/price-items?kind=material&limit=50`), 'listPriceItems'),
    ).items.find((i) => i.kind === 'material' && !i.archived);
    expect(material, 'материал в прайсе организации').toBeTruthy();
    const request = body<{ id: string; state: string; revision: number }>(
      expectStatus(
        await call(fm.page, 'POST', `${pbase}/supply-requests`, {
          body: { priceItemId: material?.id, quantity: '10', needBy: moscowDate(2) },
        }),
        201,
        'createSupplyRequest',
      ),
    );
    expect(request.state).toBe('request');
    expect(
      (
        await call(fm.page, 'POST', `${base}/supply-requests/${request.id}/consume`, {
          ifMatch: rev(request.revision),
        })
      ).status,
    ).toBe(409);
    const purchase = body<{ id: string; state: string; revision: number }>(
      expectStatus(
        await call(page, 'POST', `${base}/purchases`, {
          body: {
            supplier: `ООО «Стройбаза» ${tag}`,
            lines: [
              { supplyRequestId: request.id, price: { amountMinor: 15_000, currency: 'RUB' } },
            ],
          },
        }),
        201,
        'createPurchase',
      ),
    );
    expect(purchase.state).toBe('ordered');
    const received = body<{ state: string }>(
      ok(
        await call(page, 'POST', `${base}/purchases/${purchase.id}/receive`, {
          body: { receiptQr: `QR-${tag}` },
          ifMatch: rev(purchase.revision),
        }),
        'receivePurchase',
      ),
    );
    expect(received.state).toBe('received');
    const supply = async (): Promise<{ id: string; state: string; revision: number }> => {
      const items = body<{ items: { id: string; state: string; revision: number }[] }>(
        ok(
          await call(page, 'GET', `${base}/supply-requests?projectId=${obj.id}`),
          'listSupplyRequests',
        ),
      ).items;
      const r = items.find((x) => x.id === request.id);
      if (!r) throw new Error('заявка не найдена в списке');
      return r;
    };
    const bought = await supply();
    expect(bought.state).toBe('bought');
    ok(
      await call(page, 'POST', `${base}/supply-requests/${request.id}/consume`, {
        ifMatch: rev(bought.revision),
      }),
      'consumeSupplyRequest',
    );
    expect((await supply()).state).toBe('used');

    // 12. Акты: вставкой (шов стенда, Q-W6.90-1) — акт № 1 на 40 % договора и акт сдачи. Подпись акта заказчиком кодом из SMS.
    const budget = money((await getProject()).p.budget);
    const actId = insertDocument(tenant, {
      project: obj.id,
      kind: 'act',
      title: `Акт № 1 · отделка ${tag}`,
      actNo: 1,
      amountMinor: Math.round(budget * 0.4),
    });
    const handId = insertDocument(tenant, {
      project: obj.id,
      kind: 'handover_act',
      title: `Акт сдачи объекта ${tag}`,
    });
    const signedBy = async (id: string): Promise<void> => {
      expectStatus(
        await call(page, 'POST', `${base}/documents/${id}/sign-requests`, { body: {} }),
        201,
        'requestDocumentSignature',
      );
      ok(
        await call(guest.page, 'POST', `${cab}/documents/${id}/sign`, {
          body: { smsCode: lastSignCode() },
        }),
        'signDocumentByClient',
      );
    };
    // начисление по неподписанному акту — отказ
    expect((await call(page, 'POST', `${base}/acts/${actId}/accruals`)).status).toBe(409);
    await signedBy(actId);

    // 13. Оплата бригады: начисление по акту (доля бригады 40 % суммы акта, Q-W6.15-1), повтор не множит строки, выплата в кассу.
    const accrued = body<{ items: Accrual[] }>(
      ok(await call(page, 'POST', `${base}/acts/${actId}/accruals`), 'accrueByAct'),
    ).items;
    expect(accrued.length).toBeGreaterThan(0);
    expect(accrued.every((a) => a.state === 'accrued' && a.workerId === crew)).toBe(true);
    const actAmount = Math.round(budget * 0.4);
    expect(accrued.reduce((s, a) => s + money(a.amount), 0)).toBeCloseTo(actAmount * 0.4, -1);
    const repeat = body<{ items: Accrual[] }>(
      ok(await call(page, 'POST', `${base}/acts/${actId}/accruals`), 'accrueByAct (повтор)'),
    ).items;
    expect(repeat).toHaveLength(accrued.length);
    expect(
      (
        await call(fm.page, 'POST', `${base}/accruals/payout`, {
          body: { accrualIds: accrued.map((a) => a.id) },
        })
      ).status,
    ).toBe(403);
    const payout = body<{ proposalId: string; accruals: Accrual[] }>(
      ok(
        await call(page, 'POST', `${base}/accruals/payout`, {
          body: { accrualIds: accrued.map((a) => a.id) },
        }),
        'payoutAccruals',
      ),
    );
    expect(payout.proposalId).toBeTruthy();
    expect(payout.accruals.every((a) => a.state === 'proposed')).toBe(true);
    const listed = body<{ items: Accrual[] }>(
      ok(await call(page, 'GET', `${pbase}/accruals`), 'listCrewAccruals'),
    ).items;
    expect(listed.every((a) => a.state === 'proposed')).toBe(true);

    // 14. Подрядчик: доступ открывается на срок и закрывается; прораб доступ не меняет.
    const subId = insertSubcontractor(tenant, {
      project: obj.id,
      name: `Электромонтаж ${tag}`,
      scope: 'Электрика: щиток и розетки',
      contractMinor: 8_000_000,
    });
    const subs = body<{ items: { id: string; active: boolean }[] }>(
      ok(await call(page, 'GET', `${pbase}/subcontractors`), 'listSubcontractors'),
    ).items;
    expect(subs.find((s) => s.id === subId)?.active).toBe(false);
    expect(
      (
        await call(fm.page, 'PUT', `${pbase}/subcontractors/${subId}`, {
          body: { active: true, until: moscowDate(14) },
        })
      ).status,
    ).toBe(403);
    const opened = body<{ active: boolean; accessUntil?: string }>(
      ok(
        await call(page, 'PUT', `${pbase}/subcontractors/${subId}`, {
          body: { active: true, until: moscowDate(14) },
        }),
        'setSubcontractorAccess',
      ),
    );
    expect(opened).toMatchObject({ active: true, accessUntil: moscowDate(14) });
    ok(
      await call(page, 'PUT', `${pbase}/subcontractors/${subId}`, { body: { active: false } }),
      'setSubcontractorAccess (закрыть)',
    );

    // 15. Финансы: договор = бюджет, расходы включают списанный материал и начисленное бригаде; получено — 0 (счетов нет).
    const fin = body<{
      contract: Money;
      received: Money;
      expenses: Money;
      movements: { kind: string }[];
    }>(ok(await call(page, 'GET', `${pbase}/finance`), 'getProjectFinance'));
    expect(money(fin.contract)).toBe(budget);
    expect(money(fin.received)).toBe(0);
    expect(money(fin.expenses)).toBeGreaterThan(0);
    expect(fin.movements.map((m) => m.kind)).toEqual(
      expect.arrayContaining(['expense', 'accrual']),
    );
    const overview = body<{ money?: unknown; decisions: unknown[] }>(
      ok(await call(page, 'GET', `${pbase}/overview`), 'getRepairProjectOverview'),
    );
    expect(overview.money).toBeTruthy();
    expect((await call(fm.page, 'GET', `${pbase}/overview`)).status).toBe(200);
    expect(
      body<{ money?: unknown }>(await call(fm.page, 'GET', `${pbase}/overview`)).money,
    ).toBeUndefined();

    // 16. Страницы: вкладки денег объекта читают то же, что сделали команды; без горизонтальной прокрутки на любой ширине.
    await signedBy(handId);
    const tab = async (name: string): Promise<void> => {
      await app(`/t/${tenant}/repair?obj=${obj.id}&tab=${name}`, { persona: 'owner' });
      await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 30_000 });
    };
    await tab('finance');
    const finance = section(page, 'Финансы объекта');
    await expect(finance.getByRole('heading', { level: 2, name: 'Финансы объекта' })).toBeVisible({
      timeout: 30_000,
    });
    const cards = finance.getByRole('list', { name: 'Показатели объекта' }).getByRole('listitem');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText('Договор');
    await expect(cards.nth(0)).toContainText('по смете версии 2');
    expect(await noHorizontalScroll(page)).toBe(true);
    await tab('pay');
    await expect(section(page, 'Оплата бригады')).toContainText('Олег Дронов', { timeout: 30_000 });
    expect(await noHorizontalScroll(page)).toBe(true);
    await tab('subs');
    await expect(section(page, 'Подрядчики')).toContainText(`Электромонтаж ${tag}`, {
      timeout: 30_000,
    });
    expect(await noHorizontalScroll(page)).toBe(true);
    await tab('client');
    await expect(section(page, 'Кабинет заказчика')).toBeVisible({ timeout: 30_000 });
    expect(await noHorizontalScroll(page)).toBe(true);

    // 17. «Сдать объект» на странице «Документы»: подтверждение, тост, гарантия; кнопка исчезает.
    await tab('docs');
    const docsSection = section(page, 'Документы');
    await expect(docsSection).toContainText(`Акт сдачи объекта ${tag}`, { timeout: 30_000 });
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.getByRole('button', { name: 'Сдать объект' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: 'Сдать объект заказчику?' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Сдать объект' }).click();
    await expect(toast(page)).toHaveText('Объект сдан заказчику', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Сдать объект' })).toHaveCount(0);
    await expect(page.getByText(/Гарантия до \d\d\.\d\d\.\d{4}\./)).toBeVisible();

    // 18. После сдачи: объект «сдан» с гарантией, кабинет заказчика закрыт (410), правки закрыты (409), прораб объект читает.
    const handed = (await getProject()).p;
    expect(handed.status).toBe('handed_over');
    expect(handed.handedOverOn).toBeTruthy();
    expect(handed.warrantyUntil).toBeTruthy();
    expect(handed.readiness.clientPct).toBe(100);
    const closed = await call(guest.page, 'GET', cab);
    expect(closed.status).toBe(410);
    expect(JSON.stringify(closed.body)).toContain('public_token_expired');
    const late = await call(fm.page, 'POST', `${pbase}/change-orders`, {
      body: { title: `Поздняя допработа ${tag}`, quantity: '1', unit: 'm2', photoFileIds: [photo] },
    });
    expect(late.status).toBe(409);
    const lateSupply = await call(fm.page, 'POST', `${pbase}/supply-requests`, {
      body: { priceItemId: material?.id, quantity: '1', needBy: moscowDate(2) },
    });
    expect(lateSupply.status).toBe(409);
    const secondHandOver = await call(page, 'POST', `${pbase}/hand-over`, {
      body: { actDocumentId: handId },
      ifMatch: (await getProject()).etag,
    });
    expect(secondHandOver.status).toBe(409);
    expect((await call(fm.page, 'GET', pbase)).status).toBe(200);
  });
});
