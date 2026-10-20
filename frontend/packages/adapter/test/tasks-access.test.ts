// Доступ к проекту сценарного сервера «Задач и проектов» (W4.03, возврат 1) совпадает с доменом W4.10: accessOf и
// canIn MSW (поверх грантов MSW) и projAccess домена (models.js 14.10:194–216 с TP-03) дают одно и то же каждому
// сотруднику «Альты» в каждом проекте с процессом при любом уровне доступа — есть ли доступ, роль, «Откуда доступ» и
// что можно (глаголы эталона ↔ действия каталога). Воронка «Заявки» (flow leads) — объявленное отличие MSW: её видят
// роли области с tasks.read со всеми действиями (описание listTaskProjects), в домене воронка — отдельный экран.
import {
  normProjects,
  projAccess,
  type Project,
  type ProjectAccessLevel,
  tasksSeed,
} from '@ortus/domain/modules';
import { createAlta, createPlatform, seedUuid } from '@ortus/domain/seed';
import { describe, expect, it } from 'vitest';

import { createScenarioState, orgOf, SEED_NOW } from '../src/msw/core/state.ts';
import { accessOf, tasksDataOf } from '../src/msw/tasks/state.ts';

/** Глагол эталона ↔ действие каталога, по которому MSW его проверяет. */
const VERB_KEY = {
  view: 'tasks.read',
  create: 'tasks.create',
  edit: 'tasks.update',
  review: 'tasks.approve',
  settings: 'tasks.workflow.manage',
} as const;
const verbsOf = (actions: readonly string[]): string[] =>
  Object.entries(VERB_KEY)
    .filter(([, k]) => actions.includes(k))
    .map(([v]) => v)
    .sort();

describe('доступ к проекту: MSW = домен W4.10 (projAccess, TP-03)', () => {
  const LEVELS: ProjectAccessLevel[] = ['open', 'limited', 'closed'];

  it('каждый сотрудник «Альты» в каждом проекте с процессом при каждом уровне доступа', () => {
    const db = createAlta(createPlatform());
    const raw = tasksSeed('t-alta');
    normProjects(raw);
    const projects = (raw.projects as Project[]).filter((p) => p.flow !== 'leads');
    Object.assign(db, { projects, tasks: raw.tasks });

    const s = createScenarioState();
    const org = orgOf(s, seedUuid('platform', 't-alta'));
    const data = tasksDataOf(org);
    const active = db.members.filter((x) => x.status === 'active');
    const diffs: string[] = [];
    let compared = 0;
    for (const dp of projects) {
      const row = data.projects.find((x) => x.proto === dp.id);
      if (!row) {
        diffs.push(`${dp.id}: нет в MSW`);
        continue;
      }
      for (const level of LEVELS) {
        dp.access = level;
        row.access = level;
        // Заблокированных эталон в «Участниках» и «Людей» не показывает (status !== 'blocked'), canIn и projCan им
        // отказывают одинаково («сотрудник заблокирован»); группу MSW назначает группе, а сид эталона — её активным
        // участникам (via), поэтому сравниваются активные.
        for (const m of active) {
          const mm = org.members.find((x) => x.proto === m.id);
          if (!mm) {
            diffs.push(`${m.id}: нет в MSW`);
            continue;
          }
          const d = projAccess(db, dp, m.id);
          const w = accessOf(s, org, row, mm.id, SEED_NOW);
          compared++;
          const want = d && { role: d.roleName, via: d.via, verbs: [...d.verbs].sort() };
          const got = w && { role: w.roleName, via: w.via, verbs: verbsOf(w.actions) };
          if (JSON.stringify(want) !== JSON.stringify(got)) {
            diffs.push(
              `${dp.id}/${level}/${m.id}: домен ${JSON.stringify(want)} ≠ MSW ${JSON.stringify(got)}`,
            );
          }
        }
      }
    }
    expect(diffs).toEqual([]);
    expect(projects.length).toBeGreaterThan(0);
    expect(compared).toBe(projects.length * LEVELS.length * active.length);
  });
});
