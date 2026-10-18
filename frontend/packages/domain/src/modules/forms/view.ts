// Проекция форм для участника (api.js 14.10:201, 206–207): формы — все, ответы — тем, кто видит
// логистику фирмы «Север» (проверка как при включённом модуле), остальным — только свои (по ФИО).
import { can } from '../../core/access/index.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { clone } from './clone.ts';
import type { Form, FormResponse } from './types.ts';

export interface FormsView {
  forms: Form[];
  responses: FormResponse[];
}

export function formsView(db: TenantDb, actor: string): FormsView {
  const asOn = { ...db, modules: { ...db.modules, logistics: { enabled: true } } };
  const seesLog = can(asOn, actor, 'logistics', 'view', 'f-msk-sever').ok;
  const me = db.members.find((m) => m.id === actor);
  return {
    forms: clone(db.forms ?? []),
    responses: clone(db.responses ?? []).filter((r) => seesLog || r.author === me?.name),
  };
}
