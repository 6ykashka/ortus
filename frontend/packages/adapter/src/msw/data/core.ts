// W4.80 · Наборы «Данных» модулей ядра этапа 4 (контракт 0.11.1-stage4; эталон design-2026-10-19 «Ортус CRM.dc.html»
// dataVM :4189 — SETS.responses, SETS.tasks): «Ответы на осмотр» (forms.responses) и «Задачи» (tasks). Модули «Формы» и
// «Задачи» не устанавливаются — наборы есть в каждой организации, у участника с правом набора в любой области.
// Строки — как отдают списки модулей: ответы формы «Осмотр машины» (по имени, как ответ осмотра W4.24), которые
// участник читает в «Ответах» (`sees`, Q-W4.00-forms-9; машина — правами «Логистики»), и задачи `listTasks`
// (`visibleTask`: проекты по уровню доступа, свои задачи — «своё»). Описание полей — пример listDatasets/ok
// (tools/gen/examples-w480.mjs).
import type { components } from '@ortus/api-client';

import { grantsOf, type TenantAccess } from '../core/access.ts';
import type { HandlerContext } from '../core/registry.ts';
import { covers, fleetOf, unitsFor } from '../fleet/state.ts';
import { type FormRow, viewOf as formsView } from '../forms/state.ts';
import { statusOf, viewOf as tasksView } from '../tasks/state.ts';
import type { Cell, DatasetDef, DataRow } from './catalog.ts';

type S = components['schemas'];

/** Права наборов модулей ядра (известный набор без права — 403). */
export const CORE_KEYS: Readonly<Record<string, string>> = {
  'forms.responses': 'forms.responses.read',
  tasks: 'tasks.read',
};

/** Форма осмотров «Осмотр машины» (fm-insp сида; RecordInspection W4.24 ищет её по имени). */
const INSPECTION_FORM = 'осмотр машины';
const isInspection = (f: FormRow): boolean => f.name.trim().toLowerCase() === INSPECTION_FORM;

const TEXT_OPS = ['eq', 'ne', 'in', 'contains'] as const;
const DATE_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;

function field(
  key: string,
  label: string,
  valueType: 'text' | 'date',
  nullable = false,
): S['FieldDescriptor'] {
  const ops = valueType === 'text' ? TEXT_OPS : DATE_OPS;
  return {
    key,
    label,
    valueType,
    nullable,
    filterOperators: nullable ? [...ops, 'is_null'] : [...ops],
    sortable: true,
    aggregatable: false,
    sensitivity: 'standard',
  };
}

const NULL: Cell = { value: { type: 'null', value: null }, text: '', num: null };
const text = (v: string | undefined): Cell =>
  v ? { value: { type: 'text', value: v }, text: v, num: null } : NULL;
const date = (v: string | undefined): Cell =>
  v ? { value: { type: 'date', value: v }, text: v, num: null } : NULL;

/** Есть ли у участника право `key` хоть в одной области (владелец — всегда). */
function holds(t: TenantAccess, key: string, now: string): boolean {
  if (t.owner) return true;
  return !!t.member && grantsOf(t.org, t.member.id, now).some((g) => g.keys.includes(key));
}

/** «Срок» — день срока по Москве: срок — конец дня (начало следующих суток), день — на миллисекунду раньше. */
const dueDay = (at: string | undefined): string | undefined =>
  at ? new Date(Date.parse(at) - 1 + 3 * 3600_000).toISOString().slice(0, 10) : undefined;

/** «Топливо» ответа: подпись варианта q-fuel в версии ответа, иначе текст q-fuel или q-fuel-t. */
function fuelOf(f: FormRow, versionNumber: number, answers: S['FieldEntry'][]): string | undefined {
  const value = (key: string) => answers.find((a) => a.fieldKey === key)?.value;
  const fuel = value('q-fuel');
  if (fuel?.type === 'choices') {
    const code = fuel.value[0];
    const q = f.versions
      .find((v) => v.number === versionNumber)
      ?.definition.fields.find((x) => x.key === 'q-fuel');
    const label = q?.options?.find((o) => o.key === code)?.label;
    if (label) return label;
  }
  if (fuel?.type === 'text' && fuel.value) return fuel.value;
  const t = value('q-fuel-t');
  return t?.type === 'text' && t.value ? t.value : undefined;
}

/** Наборы модулей ядра, видимые участнику (после наборов логистики, в порядке эталона). */
export function coreDatasetsFor(
  ctx: HandlerContext,
  base: (
    id: string,
    moduleKey: string,
    name: string,
    permissionKey: string,
    entityType: string,
    fields: S['FieldDescriptor'][],
    defaultSort: S['QuerySort'][],
  ) => S['Dataset'],
): DatasetDef[] {
  const t = ctx.org();
  const now = ctx.now();
  const out: DatasetDef[] = [];

  if (holds(t, 'forms.responses.read', now)) {
    out.push({
      dataset: base(
        'forms.responses',
        'forms',
        'Ответы на осмотр',
        'forms.responses.read',
        'form_response',
        [
          field('response', 'Ответ', 'text'),
          field('object', 'Объект', 'text', true),
          field('author', 'Автор', 'text', true),
          field('version', 'Версия формы', 'text'),
          field('fuel', 'Топливо', 'text', true),
        ],
        [{ fieldKey: 'response', direction: 'asc' }],
      ),
      rows: () => {
        const v = formsView(ctx);
        const fleet = fleetOf(t.org);
        const seen = (r: (typeof v.data.responses)[number], f: FormRow): boolean => {
          if (v.sees(f, r)) return true;
          // Машина ответа — правами «Логистики» (объект ответа, который участник видит; Q-W4.00-forms-9).
          const ref = r.subject?.ref;
          if (ref?.moduleKey !== 'fleet' || ref.entityType !== 'vehicle') return false;
          const car = fleet.vehicles.find((x) => x.id === ref.entityId);
          return !!car && covers(unitsFor(t, 'fleet.vehicles.read', now), car.orgUnitId);
        };
        const rows: DataRow[] = [];
        for (const r of v.data.responses) {
          const f = v.data.forms.find((x) => x.id === r.formId);
          if (!f || !isInspection(f) || !seen(r, f)) continue;
          rows.push({
            recordId: `${f.id}:${r.id}`,
            cells: {
              response: text(r.number),
              object: text(r.subject?.label),
              author: text(r.authorId ? r.authorName : undefined),
              version: text(`v${r.versionNumber}`),
              fuel: text(fuelOf(f, r.versionNumber, r.answers)),
            },
          });
        }
        return rows;
      },
    });
  }

  if (holds(t, 'tasks.read', now)) {
    out.push({
      dataset: base(
        'tasks',
        'tasks',
        'Задачи',
        'tasks.read',
        'task',
        [
          field('task', 'Задача', 'text'),
          field('assignee', 'Исполнитель', 'text', true),
          field('status', 'Статус', 'text'),
          field('due', 'Срок', 'date', true),
        ],
        [{ fieldKey: 'task', direction: 'asc' }],
      ),
      rows: () => {
        const v = tasksView(ctx);
        const rows: DataRow[] = [];
        for (const x of v.data.tasks) {
          const p = v.project(x.projectId);
          if (!p || !v.visibleTask(x)) continue;
          rows.push({
            recordId: x.id,
            cells: {
              task: text(`${x.key} · ${x.title}`),
              assignee: text(v.member(x.assigneeId)?.displayName),
              status: text(statusOf(p, x)?.name ?? x.statusId),
              due: date(dueDay(x.dueAt)),
            },
          });
        }
        return rows;
      },
    });
  }
  return out;
}
