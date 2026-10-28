// W2.103 · Данные «Документов» для строк @stand: документы создаются командами API (Docs, W7.23/W7.24) из сессии
// владельца в папках сида «Альты»; название несёт метку прогона, поэтому три проекта и повторы не пересекаются.
import type { Page } from '@playwright/test';

import { expectStatus, runLabel } from './_stand/stand.ts';
import { call } from './shell.helpers.ts';

export interface StandDoc {
  id: string;
  title: string;
  folder: string;
  label: string;
}

interface Folder {
  id: string;
  name: string;
}

/** Id папки сида по названию (listDocFolders). */
export async function docFolderId(page: Page, tenant: string, name: string): Promise<string> {
  const r = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/doc-folders?limit=200`),
    200,
    'listDocFolders',
  );
  const f = (r.body as { items: Folder[] }).items.find((x) => x.name === name);
  if (!f) throw new Error(`нет папки «${name}»`);
  return f.id;
}

/** Текстовый документ в папке сида (docCreate): `Приказ № <метка>`. */
export async function textDoc(
  page: Page,
  tenant: string,
  project: string,
  o: { folder?: string; prefix?: string } = {},
): Promise<StandDoc> {
  const label = runLabel(project);
  const folder = o.folder ?? 'Приказы';
  const title = `${o.prefix ?? 'Приказ'} ${label}`;
  const r = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/docs`, {
      body: { kind: 'text', title, folderId: await docFolderId(page, tenant, folder) },
    }),
    201,
    'docCreate',
  );
  return { id: (r.body as { id: string }).id, title, folder, label };
}

/** Участник организации по почте (listMembers) — id для шагов маршрута и доступа. */
export async function memberIdByEmail(page: Page, tenant: string, email: string): Promise<string> {
  const r = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/members?limit=200`),
    200,
    'listMembers',
  );
  const m = (r.body as { items: { id: string; email?: string }[] }).items.find(
    (x) => x.email === email,
  );
  if (!m) throw new Error(`нет участника ${email}`);
  return m.id;
}

export interface RouteStep {
  kind: 'approve' | 'sign' | 'ack';
  name: string;
  /** Участники шага «Согласовать» и «Утвердить». */
  who?: string[];
  /** Адресаты шага «Ознакомить» — участники организации. */
  audience?: string[];
  days?: number;
}

/** Запуск маршрута (startDocRoute): шаги «все сразу», срок — `days` суток. */
export async function startRoute(
  page: Page,
  tenant: string,
  docId: string,
  steps: RouteStep[],
): Promise<void> {
  expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/docs/${docId}/route`, {
      body: {
        steps: steps.map((s) => ({
          kind: s.kind,
          name: s.name,
          mode: 'all',
          ...(s.who ? { whoMemberIds: s.who } : {}),
          ...(s.audience
            ? { audience: s.audience.map((id) => ({ who: 'member', refId: id, level: 'view' })) }
            : {}),
          days: s.days ?? 5,
        })),
        rules: { lock: true, notAuthor: false, commentOnBack: true, escalate: false },
      },
    }),
    201,
    'startDocRoute',
  );
}
