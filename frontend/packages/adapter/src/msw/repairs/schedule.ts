// Тег Repairs сценарного сервера, шаг 6.5 (W6.00, контракт 0.12.0-stage6): график по этапам сметы — прямой и обратный
// проход по рабочему календарю, предпросмотр переноса без записи, перенос с причиной и журналом, исполнитель этапа,
// базовый план по допсоглашению. Правила — design/docs/19-construction.md «График работ»; решения Q-W4.00-repair-19, -20.
import type { components } from '@ortus/api-client';

import { fail, type Violation } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import { dayIso, HOLIDAYS, linkKey, type Overrides, type StageCalc, wdIn } from './calc.ts';
import {
  addFeed,
  currentEstimate,
  estimatesOf,
  forecastOf,
  type ProjectRow,
  newRid,
  projectOr404,
  ruDate,
  type ScheduleRow,
  type StageRow,
  type View,
  viewOf,
} from './state.ts';
import { GREASONS_OF } from './data.ts';

type S = components['schemas'];

const invalid = (field: string, code: string, message: string): never =>
  fail('validation_failed', message, {
    violations: [{ field, code, message } satisfies Violation],
  });

const empty = (p: ProjectRow): ScheduleRow => ({
  projectId: p.id,
  stages: [],
  links: [],
  baseline: null,
  changes: [],
  off: {},
  dur: {},
  lag: {},
});

const scheduleOf = (v: View, p: ProjectRow): ScheduleRow =>
  v.rp.schedules.find((s) => s.projectId === p.id) ?? empty(p);

function stageDto(
  st: StageRow,
  sch: ScheduleRow,
  calc: Record<string, StageCalc>,
): S['ScheduleStage'] {
  const c = calc[st.id];
  const dto: S['ScheduleStage'] = {
    id: st.id,
    phase: st.phase,
    name: st.name,
    startOn: dayIso(c?.start ?? 0),
    endOn: dayIso(c?.end ?? 0),
    durationWd: c?.dur ?? st.durationWd,
    offsetWd: sch.off[st.id] ?? 0,
    slackWd: c?.slack ?? 0,
    critical: (c?.slack ?? 0) === 0,
    status: st.status,
  };
  if (st.executorName) dto.executorName = st.executorName;
  if (st.executorMemberId) dto.executorMemberId = st.executorMemberId;
  if (st.sectionId) dto.estimateSectionId = st.sectionId;
  return dto;
}

function scheduleDto(v: View, p: ProjectRow, sch: ScheduleRow): S['Schedule'] {
  const f = forecastOf(sch);
  const stages = sch.stages.map((s) => stageDto(s, sch, f.calc));
  const issues: S['ScheduleIssue'][] = [];
  for (const st of sch.stages) {
    if (!st.executorName && !st.executorMemberId && st.status !== 'done' && !st.milestone) {
      issues.push({ kind: 'no_executor', stageId: st.id, text: 'Нет исполнителя' });
    }
  }
  for (const a of sch.stages) {
    for (const b of sch.stages) {
      if (
        a.id >= b.id ||
        !a.executorName ||
        a.executorName !== b.executorName ||
        a.milestone ||
        b.milestone
      )
        continue;
      const ca = f.calc[a.id];
      const cb = f.calc[b.id];
      if (ca && cb && ca.start <= cb.end && cb.start <= ca.end) {
        issues.push({
          kind: 'executor_busy',
          stageId: b.id,
          text: `Исполнитель занят: «${a.name}» идёт параллельно`,
        });
      }
    }
  }
  return {
    projectId: p.id,
    stages,
    links: sch.links.map((l) => {
      const o: S['ScheduleLink'] = {
        fromStageId: l.from,
        toStageId: l.to,
        lagDays: sch.lag[linkKey(l)] ?? l.lag,
      };
      if (l.note) o.note = l.note;
      return o;
    }),
    baseline: sch.baseline ? structuredClone(sch.baseline) : null,
    forecastDueOn: f.finDay !== null ? dayIso(f.finDay) : null,
    delayWd: f.delayWd,
    holidays: HOLIDAYS.map(dayIso),
    issues,
    changes: sch.changes,
    revision: p.scheduleRevision,
  };
}

type Change = { stageId: string; offsetWd?: number; durationWd?: number; lagDays?: number };

/** Новые переопределения по списку изменений; проверяет этапы и запрет сдвига начавшегося этапа. */
function applyChanges(
  sch: ScheduleRow,
  changes: Change[],
): { next: Overrides; notes: string[]; touched: Set<string> } {
  const f = forecastOf(sch);
  const next: Overrides = { off: { ...sch.off }, dur: { ...sch.dur }, lag: { ...sch.lag } };
  const notes: string[] = [];
  const touched = new Set<string>();
  for (const [i, c] of changes.entries()) {
    const st = sch.stages.find((x) => x.id === c.stageId);
    if (!st) return invalid(`changes[${i}].stageId`, 'unknown', 'Этапа нет в графике.');
    if (
      st.status === 'done' ||
      (st.status === 'started' && (c.offsetWd !== undefined || c.lagDays !== undefined))
    ) {
      fail(
        'invalid_transition',
        'Начавшийся этап не сдвигается: меняется только длительность; выполненный этап не меняется.',
        {
          reason: 'schedule_stage_locked',
        },
      );
    }
    const was = f.calc[st.id];
    if (c.offsetWd !== undefined) {
      next.off[st.id] = c.offsetWd;
      notes.push(`«${st.name}»: начало с запасом ${c.offsetWd} раб. дн.`);
    }
    if (c.durationWd !== undefined) {
      next.dur[st.id] = c.durationWd;
      notes.push(
        `«${st.name}»: длительность ${was?.dur ?? st.durationWd} → ${c.durationWd} раб. дней`,
      );
    }
    if (c.lagDays !== undefined) {
      const bind = was?.bind;
      if (!bind)
        return invalid(`changes[${i}].lagDays`, 'no_predecessor', 'У этапа нет предшественника.');
      next.lag[linkKey({ from: bind, to: st.id })] = c.lagDays;
      notes.push(`«${st.name}»: пауза после предшественника ${c.lagDays} дн.`);
    }
    touched.add(st.id);
  }
  return { next, notes, touched };
}

const KEYWORDS: [RegExp, string][] = [
  [/демонтаж/i, 'Демонтаж'],
  [/электрик/i, 'Электрика'],
  [/штукатур|шпаклёв|обо/i, 'Стены'],
  [/стяжк|плитк|ламинат|плинтус/i, 'Полы'],
  [/сантехник/i, 'Сантехника'],
];

export const scheduleHandlers: Registry = {
  getSchedule: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    return { body: scheduleDto(v, p, scheduleOf(v, p)) };
  },

  createScheduleFromEstimate: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    const n = (ctx.body as { estimateVersion: number }).estimateVersion;
    const est = estimatesOf(v, p).find((e) => e.version === n);
    if (!est) invalid('estimateVersion', 'unknown', 'Версии сметы нет у объекта.');
    if (est?.state !== 'approved') {
      fail('invalid_transition', 'График строится по согласованной версии сметы.', {
        reason: 'repair_estimate_not_approved',
      });
    }
    if (scheduleOf(v, p).stages.length) fail('invalid_transition', 'График уже собран.');
    const tpl = v.rp.templates.find((t) => t.id === p.templateId);
    const sch = empty(p);
    const secOf = (name: string) =>
      est.sections.find((s) => s.name === KEYWORDS.find(([re]) => re.test(name))?.[1]);
    for (const [i, t] of (tpl?.stages ?? []).entries()) {
      const sec = secOf(t.name);
      const vol = sec
        ? est.lines
            .filter((l) => l.sectionId === sec.id && l.kind === 'work')
            .reduce((a, l) => a + l.qty, 0)
        : 0;
      const dur = t.ratePerDay ? Math.min(30, Math.max(1, Math.ceil(vol / t.ratePerDay))) : 1;
      const prev = sch.stages.at(-1);
      const st: StageRow = {
        id: newRid(v, 'stage'),
        phase: i < 3 ? 'Черновые работы' : 'Чистовые работы',
        name: t.name,
        durationWd: dur,
        milestone: false,
        actualStart: null,
        status: 'planned',
        ...(sec ? { sectionId: sec.id } : {}),
      };
      sch.stages.push(st);
      if (prev)
        sch.links.push({
          from: prev.id,
          to: st.id,
          lag: t.pauseDays,
          ...(t.note ? { note: t.note } : {}),
        });
    }
    const last = sch.stages.at(-1);
    const fin: StageRow = {
      id: newRid(v, 'stage'),
      phase: 'Сдача',
      name: 'Сдача объекта',
      durationWd: 1,
      milestone: true,
      actualStart: null,
      status: 'planned',
    };
    sch.stages.push(fin);
    if (last) sch.links.push({ from: last.id, to: fin.id, lag: 0 });
    sch.changes.unshift({
      id: newRid(v, 'gchange'),
      at: ctx.now(),
      authorName: v.t.member?.displayName ?? 'Система',
      text: `График собран по версии ${est.version} сметы и технологии шаблона`,
    });
    v.rp.schedules.push(sch);
    p.scheduleRevision++;
    addFeed(v, p.id, 'собрала график по смете');
    return { status: 201, body: scheduleDto(v, p, sch) };
  },

  previewScheduleChange: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    const sch = scheduleOf(v, p);
    const before = forecastOf(sch);
    const { next, touched } = applyChanges(sch, (ctx.body as { changes: Change[] }).changes);
    const after = forecastOf({ ...sch, ...next });
    const moved = sch.stages
      .filter((s) => (before.calc[s.id]?.start ?? 0) !== (after.calc[s.id]?.start ?? 0))
      .map((s) => ({
        stageId: s.id,
        fromStartOn: dayIso(before.calc[s.id]?.start ?? 0),
        toStartOn: dayIso(after.calc[s.id]?.start ?? 0),
      }));
    const who = new Set<string>();
    for (const s of sch.stages) {
      if (s.executorName && (touched.has(s.id) || moved.some((m) => m.stageId === s.id)))
        who.add(s.executorName);
    }
    if (before.finDay !== after.finDay) who.add('Заказчик');
    return {
      body: {
        moved,
        forecastDueOn: after.finDay !== null ? dayIso(after.finDay) : null,
        delayWd: after.delayWd,
        notifyWho: [...who],
      },
    };
  },

  applyScheduleChange: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    ctx.revision(p.scheduleRevision);
    const sch = scheduleOf(v, p);
    if (!sch.stages.length) fail('not_found', 'График ещё не собран.');
    const b = ctx.body as { changes: Change[]; reason: S['RepairScheduleReason'] };
    const before = forecastOf(sch);
    const { next, notes } = applyChanges(sch, b.changes);
    sch.off = Object.fromEntries(Object.entries(next.off).filter(([, x]) => x > 0));
    sch.dur = Object.fromEntries(
      Object.entries(next.dur).filter(
        ([k, x]) => x !== sch.stages.find((s) => s.id === k)?.durationWd,
      ),
    );
    sch.lag = Object.fromEntries(
      Object.entries(next.lag).filter(
        ([k, x]) => x !== sch.links.find((l) => linkKey(l) === k)?.lag,
      ),
    );
    const after = forecastOf(sch);
    const due =
      before.finDay !== after.finDay && after.finDay !== null
        ? `; сдача ${ruDate(dayIso(before.finDay ?? 0))} → ${ruDate(dayIso(after.finDay))}`
        : '';
    sch.changes.unshift({
      id: newRid(v, 'gchange'),
      at: ctx.now(),
      authorName: v.t.member?.displayName ?? 'Система',
      text: notes.join('; ') + due,
      reason: b.reason,
    });
    p.scheduleRevision++;
    addFeed(v, p.id, `перенесла этапы графика: ${GREASONS_OF[b.reason] ?? b.reason}`);
    return { body: scheduleDto(v, p, sch) };
  },

  setScheduleStageExecutor: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    ctx.revision(p.scheduleRevision);
    const sch = scheduleOf(v, p);
    const st = sch.stages.find((s) => s.id === (ctx.params.stageId ?? '').toLowerCase());
    if (!st) fail('not_found', 'Этап не найден.');
    const stage = st as StageRow;
    const b = ctx.body as { executorMemberId?: string | null; executorName?: string };
    const was = stage.executorName ?? 'не назначен';
    if (b.executorMemberId) {
      const m = v.org.members.find((x) => x.id === b.executorMemberId);
      if (!m) invalid('executorMemberId', 'unknown', 'Сотрудника нет в организации.');
      stage.executorMemberId = b.executorMemberId;
      stage.executorName = m?.displayName;
    } else {
      delete stage.executorMemberId;
      if (b.executorName !== undefined) stage.executorName = b.executorName.trim() || undefined;
      else if (b.executorMemberId === null) delete stage.executorName;
    }
    sch.changes.unshift({
      id: newRid(v, 'gchange'),
      at: ctx.now(),
      authorName: v.t.member?.displayName ?? 'Система',
      text: `«${stage.name}»: исполнитель ${was} → ${stage.executorName ?? 'не назначен'}`,
    });
    p.scheduleRevision++;
    return { body: stageDto(stage, sch, forecastOf(sch).calc) };
  },

  createScheduleBaseline: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    ctx.revision(p.scheduleRevision);
    const sch = scheduleOf(v, p);
    if (!sch.stages.length) fail('not_found', 'График ещё не собран.');
    const agr = (ctx.body as { agreementNo: number }).agreementNo;
    const est = estimatesOf(v, p).find((e) => e.agreementNo === agr && e.state === 'approved');
    if (!est) {
      invalid('agreementNo', 'unknown', 'Нет подписанного допсоглашения с таким номером.');
    }
    const f = forecastOf(sch);
    const dueOn = dayIso(f.finDay ?? 0);
    sch.baseline = {
      version: (sch.baseline?.version ?? 0) + 1,
      dueOn,
      approvedAt: ctx.now(),
      agreementNo: agr,
    };
    p.dueOn = dueOn;
    p.revision++;
    sch.changes.unshift({
      id: newRid(v, 'gchange'),
      at: ctx.now(),
      authorName: v.t.member?.displayName ?? 'Система',
      text: `Базовый план обновлён допсоглашением № ${agr}, сдача ${ruDate(dueOn)}`,
    });
    p.scheduleRevision++;
    void wdIn;
    void currentEstimate;
    return { status: 201, body: scheduleDto(v, p, sch) };
  },
};
