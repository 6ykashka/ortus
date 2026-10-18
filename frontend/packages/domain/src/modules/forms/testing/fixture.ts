// Фикстура тестов модуля форм: «Альта» из сида пилота + срез форм + Базы знаний глазами форм
// (extra-data.js 14.10:24–54: kb-1…kb-5, таблица «Осмотры»). Срез БЗ v2 — W4.30; здесь только то,
// что читает `kbRun`. Каждый вызов — новые объекты. В точку входа модуля не входит.
import { DEMO, fixedClock, type Clock } from '../../../core/clock.ts';
import { createEmitter } from '../../../core/events.ts';
import { createIdGen } from '../../../core/ids.ts';
import { createModuleCtx, type ModuleCtx } from '../../../core/module.ts';
import { createFakeTaskPort } from '../../../core/testing/fake-task-port.ts';
import type { DomainEvent, Role, TenantDb } from '../../../core/types/index.ts';
import { createSeed } from '../../../seed/compose.ts';
import type { KbEnv } from '../kb-actions.ts';
import { formsSeed } from '../seed.ts';
import type { Form, FormResponse, FormsKnowledge } from '../types.ts';

export type FormsDb = TenantDb & {
  events: DomainEvent[];
  forms: Form[];
  responses: FormResponse[];
  knowledge: FormsKnowledge;
};

export function kbFixture(): FormsKnowledge {
  return {
    pages: [
      { id: 'kb-1', space: 'sp-log', title: 'Регламент приёмки смены', access: 'all' },
      {
        id: 'kb-2',
        space: 'sp-log',
        title: 'Как фотографировать машину при осмотре',
        access: 'all',
      },
      { id: 'kb-5', space: 'sp-log', title: 'Журнал осмотров машин', access: 'all' },
      { id: 'kb-3', space: 'sp-spa', title: 'Технологические карты процедур', access: 'all' },
      { id: 'kb-4', space: 'sp-own', title: 'Политика начислений водителям', access: 'owner' },
    ],
    tables: [
      {
        id: 'kt-insp',
        page: 'kb-5',
        title: 'Осмотры',
        columns: [
          { id: 'c-at', name: 'Дата', type: 'text' },
          { id: 'c-obj', name: 'Рейс', type: 'text' },
          { id: 'c-who', name: 'Водитель', type: 'text' },
          { id: 'c-odo', name: 'Пробег, км', type: 'number' },
          { id: 'c-fuel', name: 'Топливо', type: 'text' },
          { id: 'c-def', name: 'Дефекты', type: 'text' },
          { id: 'c-resp', name: 'Ответ', type: 'text' },
        ],
        rows: [
          {
            id: 'kr-2',
            at: '27.09 09:12',
            src: { form: 'fm-insp', resp: 'R-1012', fv: 3, rule: 'au-2', rv: 1 },
            cells: {
              'c-at': '27.09 09:05',
              'c-obj': 'Рейс Р-196',
              'c-who': 'Илья Васильев',
              'c-odo': '84 210',
              'c-fuel': '¾',
              'c-def': 'нет',
              'c-resp': 'R-1012',
            },
          },
          {
            id: 'kr-1',
            at: '24.09 18:20',
            src: { form: 'fm-insp', resp: 'R-0988', fv: 2, rule: 'au-2', rv: 1 },
            cells: {
              'c-at': '18.09 08:41',
              'c-obj': 'Рейс Р-171',
              'c-who': 'Кирилл Громов',
              'c-odo': '83 902',
              'c-resp': 'R-0988',
            },
          },
        ],
      },
    ],
    entries: [],
  };
}

/** Роль «Редактор» пространства БЗ (knowledge.js:14) — объектная роль, область `space`. */
export const KB_EDITOR: Role = {
  id: 'r-kb-editor',
  name: 'Редактор',
  kind: 'template',
  space: true,
  actions: { knowledge: ['view', 'create', 'edit', 'review'] },
  finance: { read: false, manage: false },
};

/** Назначение `akb-2` эталона (knowledge.js:286): Котельникова — редактор пространства. */
export function withKbEditor(db: FormsDb, space = 'sp-log', member = 'm-kotelnikova'): FormsDb {
  if (!db.roles.some((r) => r.id === KB_EDITOR.id)) db.roles.push({ ...KB_EDITOR });
  db.assignments.push({
    id: 'akb-' + space,
    member,
    role: KB_EDITOR.id,
    scope: { type: 'space', id: space },
  });
  return db;
}

export function formsFixture(): FormsDb {
  const db = createSeed().dbs['t-alta'] as unknown as FormsDb;
  Object.assign(db, formsSeed('t-alta'));
  db.knowledge = kbFixture();
  return db;
}

export const demo: Clock = fixedClock(DEMO.now);

export function kbEnv(db: FormsDb, clock: Clock = demo): KbEnv {
  const ids = createIdGen(db);
  return { db, kb: db.knowledge, clock, ids, emit: createEmitter(() => db, clock, ids) };
}

export function formsCtx(db: TenantDb, actor: string | null = 'm-owner'): ModuleCtx {
  return createModuleCtx({
    getDb: () => db,
    getActor: () => actor,
    clock: demo,
    tasks: createFakeTaskPort(),
  });
}

/** Новый принятый ответ «Осмотра машины» v3 (как `recordInspection`). */
export function inspResponse(id: string, x: Partial<FormResponse> = {}): FormResponse {
  return {
    id,
    formId: 'fm-insp',
    version: 3,
    at: '01.10 10:05',
    author: 'Илья Васильев',
    object: 'Рейс Р-208 · выезд',
    status: 'Принят',
    values: {
      'q-photos': '5 фото',
      'q-odo': '84 590',
      'q-fuel': '½',
      'q-checks': 'все пункты',
      'q-defect': 'нет',
    },
    ...x,
  };
}
