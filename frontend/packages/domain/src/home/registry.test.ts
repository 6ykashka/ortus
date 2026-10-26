// W2.25 · Реестр источников «Требует решения» (план v2 §3.5, 01-shell.md §23): генерируется по sources/*.ts,
// общий VM не правится при новом источнике; виды этапа 2 (контракт DecisionItem.kind) покрыты; источники
// этапов 4–7 — allowlist out-of-stage до своих этапов. W4.81: источник задач (этап 4) — sources/tasks.ts.
import { describe, expect, it } from 'vitest';

import { OUT_OF_STAGE } from './out-of-stage.ts';
import { HOME_SOURCES } from './sources.gen.ts';
import source from './sources.gen.ts?raw';
import { renderSources } from './sources-render.ts';

const files = Object.keys(import.meta.glob('./sources/*.ts'))
  .map((f) => f.replace('./sources/', '').replace(/\.ts$/, ''))
  .filter((f) => !f.endsWith('.test'));

/** Виды этапа 2 из описания DecisionItem.kind контракта 0.5.0-stage2. */
const STAGE2_KINDS = [
  'fleet.blocking_defect',
  'fleet.trip_review',
  'fleet.trip_without_driver',
  // W2.71 (0.6.3-stage2, S2-20 1g) → W2.73: машина рейса временного водителя.
  'fleet.vehicle_choice_pending',
  'fleet.trip_without_vehicle',
  'tenant.trial_ended',
  'tenant.trial_ending',
  'tenant.storage_high',
  'access.members_without_role',
  // W4.81 (0.11.1-stage4): задачи участника «Новая» и «На проверке».
  'tasks.task_new',
  'tasks.task_review',
];

describe('реестр источников «Главной»', () => {
  it('sources.gen.ts свежий: совпадает с выводом генератора по sources/*.ts', () => {
    expect(source).toBe(renderSources(files));
  });

  it('id источника совпадает с именем файла', () => {
    expect(HOME_SOURCES.map((s) => s.id)).toEqual([...files].sort());
  });

  it('у каждого вида этапа 2 и задач этапа 4 есть ровно один провайдер', () => {
    const kinds = HOME_SOURCES.flatMap((s) => Object.keys(s.kinds));
    expect([...kinds].sort()).toEqual([...STAGE2_KINDS].sort());
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('вид начинается с префикса своего источника', () => {
    for (const s of HOME_SOURCES) {
      for (const kind of Object.keys(s.kinds)) expect(kind.startsWith(`${s.id}.`), kind).toBe(true);
    }
  });

  it('источники этапов 5–7 (homeVM :4060–4093) — out-of-stage: провайдера нет, этап > 4; задачи — с W4.81', () => {
    expect(OUT_OF_STAGE.map((o) => o.id)).toEqual([
      'spa',
      'repairs',
      'service',
      'docs',
      'chat',
      'cash',
    ]);
    for (const o of OUT_OF_STAGE) {
      expect(o.stage, o.id).toBeGreaterThan(4);
      expect(files, o.id).not.toContain(o.id);
    }
  });
});
