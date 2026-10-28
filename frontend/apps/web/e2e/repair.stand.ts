// W2.103 · Данные «Ремонта и стройки» для строк @stand: модуль, объект, замер, смета и график создаются командами API
// (Repairs, W6.11–W6.15) из сессии владельца. Объект несёт метку прогона в названии и адресе: три проекта и повторы не
// пересекаются; сида ремонта на стенде нет, стартовые шаблоны и прайс копируются в организацию при подключении модуля.
import type { Page } from '@playwright/test';

import type { Undo } from './_stand/fixtures.ts';
import { assign, expectStatus, revoke, roleId, runLabel } from './_stand/stand.ts';
import { call } from './shell.helpers.ts';

export interface StandObject {
  id: string;
  orgUnitId: string;
  name: string;
  address: string;
  label: string;
  tenant: string;
  foremanMemberId: string | null;
}

const rev = (r: number | string): string => `"rev-${String(r)}"`;

/** Подключает «Ремонт и стройку» организации, если ещё не подключён (setModuleInstallation, If-Match модуля). */
export async function installRepairs(page: Page, tenant: string): Promise<void> {
  const cur = await call(page, 'GET', `/api/v1/tenants/${tenant}/modules/repairs`);
  expectStatus(cur, 200, 'getModuleInstallation');
  if ((cur.body as { state?: string }).state === 'installed') return;
  expectStatus(
    await call(page, 'PUT', `/api/v1/tenants/${tenant}/modules/repairs`, {
      body: { enabled: true },
      ifMatch: cur.headers.etag ?? '',
    }),
    200,
    'setModuleInstallation repairs',
  );
}

/** Участник организации по почте. */
async function member(
  page: Page,
  tenant: string,
  email: string,
): Promise<{ id: string; orgUnitIds: string[] }> {
  const r = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/members?limit=200`),
    200,
    'listMembers',
  );
  const m = (
    r.body as { items: { id: string; email?: string; orgUnitIds?: string[] }[] }
  ).items.find((x) => x.email === email);
  if (!m) throw new Error(`нет участника ${email}`);
  return { id: m.id, orgUnitIds: m.orgUnitIds ?? [] };
}

/** Объект в подразделении прораба Алексея Соколова (createRepairProject); `foreman: false` — без прораба. */
export async function repairObject(
  page: Page,
  tenant: string,
  project: string,
  o: { foreman?: boolean; name?: string; client?: string; label?: string } = {},
): Promise<StandObject> {
  await installRepairs(page, tenant);
  const label = o.label ?? runLabel(project);
  const sok = await member(page, tenant, 'a.sokolov@alta.example');
  const unit = sok.orgUnitIds[0];
  if (!unit) throw new Error('у прораба нет подразделения');
  const name = o.name ?? `ЖК Речной · кв. 42 · ${label}`;
  const address = `ул. Речная, 42 · ${label}`;
  const foremanMemberId = o.foreman === false ? null : sok.id;
  const r = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/repairs/projects`, {
      body: {
        orgUnitId: unit,
        name,
        address,
        workers: [{ displayName: 'Олег Дронов', trade: 'Отделочник' }],
        clientName: o.client ?? 'Ольга Смирнова',
        clientPhone: '+7 900 000-11-22',
        areaM2: '54',
        rooms: 3,
        kind: 'apartment',
        ...(foremanMemberId ? { foremanMemberId } : {}),
      },
    }),
    201,
    'createRepairProject',
  );
  return {
    id: (r.body as { id: string }).id,
    orgUnitId: unit,
    name,
    address,
    label,
    tenant,
    foremanMemberId,
  };
}

/** Замер: три помещения (putRepairMeasurement) — новая версия замера. */
export async function measure(page: Page, o: StandObject): Promise<void> {
  const base = `/api/v1/tenants/${o.tenant}/repairs/projects/${o.id}/measurement`;
  const cur = expectStatus(await call(page, 'GET', base), 200, 'getRepairMeasurement');
  const revision = (cur.body as { revision: number }).revision;
  expectStatus(
    await call(page, 'PUT', base, {
      body: {
        rooms: [
          {
            name: 'Гостиная',
            lengthM: '5',
            widthM: '4',
            heightM: '2.7',
            openingsM2: '4',
            wet: false,
          },
          {
            name: 'Кухня',
            lengthM: '3.5',
            widthM: '3',
            heightM: '2.7',
            openingsM2: '2',
            wet: false,
          },
          {
            name: 'Санузел',
            lengthM: '2.5',
            widthM: '2',
            heightM: '2.7',
            openingsM2: '1.6',
            wet: true,
          },
        ],
      },
      ifMatch: rev(revision),
    }),
    200,
    'putRepairMeasurement',
  );
}

export interface Estimate {
  version: number;
  revision: number;
}

/** Первый шаблон организации (listRepairTemplates). */
export async function firstTemplate(
  page: Page,
  tenant: string,
): Promise<{ id: string; name: string }> {
  const r = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/repairs/templates`),
    200,
    'listRepairTemplates',
  );
  const t = (r.body as { items: { id: string; name: string }[] }).items[0];
  if (!t) throw new Error('в организации нет шаблонов сметы');
  return t;
}

/** Черновик сметы по шаблону (createRepairEstimateDraft). */
export async function estimateDraft(page: Page, o: StandObject): Promise<Estimate> {
  const tpl = await firstTemplate(page, o.tenant);
  const r = expectStatus(
    await call(
      page,
      'POST',
      `/api/v1/tenants/${o.tenant}/repairs/projects/${o.id}/estimate-drafts`,
      {
        body: { templateId: tpl.id },
      },
    ),
    201,
    'createRepairEstimateDraft',
  );
  const e = r.body as { version: number; revision: number };
  return { version: e.version, revision: e.revision };
}

/** Отправка версии сметы заказчику (sendRepairEstimate). */
export async function sendEstimate(page: Page, o: StandObject, e: Estimate): Promise<void> {
  expectStatus(
    await call(
      page,
      'POST',
      `/api/v1/tenants/${o.tenant}/repairs/projects/${o.id}/estimates/${e.version}/send`,
      { ifMatch: rev(e.revision) },
    ),
    200,
    'sendRepairEstimate',
  );
}

/** Заказчик согласует отправленную версию в кабинете по личной ссылке (публичная операция). */
export async function approveByClient(page: Page, o: StandObject, version: number): Promise<void> {
  const link = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${o.tenant}/repairs/projects/${o.id}/client-link`),
    201,
    'issueClientLink',
  );
  const token = (link.body as { url: string }).url.split('/').pop();
  expectStatus(
    await call(page, 'POST', `/api/v1/public/client/${token}/estimates/${version}/approve`),
    200,
    'approveEstimateByClient',
  );
}

/**
 * Прорабу выдаётся роль «Прораб» на подразделение объекта. В сиде она назначена по связи «своё» (`self`), а права
 * ремонта допускают область только «организация», «подразделение» или «объект» — без явной выдачи прораб не видит объектов
 * (listRepairProjects → 403). Выдача снимается после строки (`undo`).
 */
export async function grantForeman(owner: Page, o: StandObject, undo: Undo): Promise<void> {
  const sok = await member(owner, o.tenant, 'a.sokolov@alta.example');
  const role = await roleId(owner, o.tenant, 'Прораб');
  const a = await assign(owner, o.tenant, { memberId: sok.id, roleId: role, unitId: o.orgUnitId });
  undo(`роль «Прораб» на объект ${o.label}`, () => revoke(owner, o.tenant, a.id));
}
/** Согласованная смета: замер, черновик по шаблону, отправка, согласие заказчика — версия 1 действует. */
export async function contractedObject(
  page: Page,
  tenant: string,
  project: string,
  o: { foreman?: boolean; name?: string; label?: string } = {},
): Promise<StandObject> {
  const obj = await repairObject(page, tenant, project, o);
  await measure(page, obj);
  const e = await estimateDraft(page, obj);
  await sendEstimate(page, obj, e);
  await approveByClient(page, obj, e.version);
  return obj;
}

/** График по согласованной смете (buildRepairSchedule): этапы собираются по шаблону. */
export async function buildSchedule(page: Page, o: StandObject, version = 1): Promise<void> {
  expectStatus(
    await call(
      page,
      'POST',
      `/api/v1/tenants/${o.tenant}/repairs/projects/${o.id}/schedule/from-estimate`,
      {
        body: { estimateVersion: version },
      },
    ),
    201,
    'buildRepairSchedule',
  );
}

/** Допсоглашение отправлено заказчику: ревизия «change» после договора, отправка — документ «Допсоглашение № 1». */
export async function agreementSent(page: Page, o: StandObject): Promise<void> {
  const rev = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${o.tenant}/repairs/projects/${o.id}/estimates`, {
      body: { kind: 'change', changeOrderIds: [] },
    }),
    201,
    'createRepairEstimateRevision',
  ).body as { version: number; revision: number };
  await sendEstimate(page, o, { version: rev.version, revision: rev.revision });
}
/** Владелец запрашивает код подписи у заказчика по первому документу объекта (requestDocumentSignature). */
export async function requestSignature(page: Page, o: StandObject): Promise<void> {
  const docs = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${o.tenant}/repairs/projects/${o.id}/documents`),
    200,
    'listRepairDocuments',
  ).body as { items: { id: string }[] };
  const d = docs.items[0];
  if (!d) throw new Error('у объекта нет документов');
  expectStatus(
    await call(
      page,
      'POST',
      `/api/v1/tenants/${o.tenant}/repairs/documents/${d.id}/sign-requests`,
      {
        body: {},
      },
    ),
    201,
    'requestDocumentSignature',
  );
}
/** Другое окно назначает того же прораба раньше (assignRepairForeman): страница ловит отказ сервера. */
export async function foremanAssigned(page: Page, o: StandObject): Promise<void> {
  const sok = await member(page, o.tenant, 'a.sokolov@alta.example');
  const base = `/api/v1/tenants/${o.tenant}/repairs/projects/${o.id}`;
  const cur = expectStatus(await call(page, 'GET', base), 200, 'getRepairProject');
  expectStatus(
    await call(page, 'POST', `${base}/foreman`, {
      body: { foremanMemberId: sok.id },
      ifMatch: cur.headers.etag ?? '',
    }),
    200,
    'assignRepairForeman',
  );
}
