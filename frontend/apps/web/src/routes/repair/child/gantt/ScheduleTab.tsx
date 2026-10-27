// W6.23 · «График» объекта (`repair-schedule`, S6 шаг 6.5): диаграмма Ганта, «Ближайшие 3 недели», сводка «Сдача объекта»,
// панель этапа, предпросмотр переноса с причиной. Эталон — design-2026-10-19 · «Ремонт и стройка.dc.html» :279–511 (разметка),
// :936–1311 (логика). Диаграмму, перетаскивание и предпросмотр считает клиент по библиотеке графика W6.10, сохранение и
// прогноз — сервер (getSchedule, previewScheduleChange, applyScheduleChange, setScheduleStageExecutor).
// Компонент встраивается во вкладку карточки объекта (W6.20) или открывается страницей `ScheduleScreen`.
import { type components, ProblemError } from '@ortus/api-client';
import {
  bumpDuration,
  bumpLag,
  bumpOffset,
  dragMinEnd,
  dragMove,
  dragResize,
  draftAfter,
  type Plan,
} from '@ortus/domain/schedule';
import { EmptyState, Icon, Lookahead, ScheduleChangePreview, Skeleton, Gantt } from '@ortus/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../../shell/run.tsx';
import { useToast } from '../../../../shell/toast.tsx';
import {
  applyChange,
  buildFromEstimate,
  fixBaseline,
  isStale,
  previewChange,
  refreshSchedule,
  scheduleKey,
  setExecutor,
  useAssignees,
  useProject,
  useSchedule,
} from './api.ts';
import {
  attentionOf,
  buildView,
  changesOf,
  chip,
  dayOf,
  headChips,
  isoOf,
  logOf,
  previewOf,
  REASONS,
  type ScheduleView,
  summaryOf,
  timingsOf,
  upcomingOf,
} from './model.ts';
import { notifyText } from './notify.ts';
import { ChipView, IssueList, StageView, SummaryPanel } from './panels.tsx';
import { GANTT_TEXT as T } from './texts.ts';
import { CRIT, ganttStagesOf, stagePanelOf } from './vm.ts';
import './gantt.css';

type S = components['schemas'];

const NARROW = 640;
const SIDE = 980;

/** Ширина контейнера: узкий экран — «Ближайшие 3 недели» по умолчанию и без перетаскивания (эталон :1094). */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1000 : window.innerWidth));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width || window.innerWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((e) => {
      const next = e[0]?.contentRect.width;
      if (next) setW(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface ScheduleTabProps {
  tenantId: string;
  projectId: string;
  /** Право в любой области (в оболочке — `useCan()`). */
  can: (...permissions: string[]) => boolean;
  /** Организация или модуль только для чтения: правка закрыта. */
  readOnly?: boolean;
  /** `1` — страница (`ScheduleScreen`), `2` — вкладка карточки объекта. */
  headingLevel?: 1 | 2;
}

const SEG = (on: boolean): { 'aria-pressed': boolean; 'data-on': boolean } => ({
  'aria-pressed': on,
  'data-on': on,
});

const KEEP = new Set(['__keep']);

export function ScheduleTab(p: ScheduleTabProps): ReactElement {
  const { tenantId, projectId } = p;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const q = useSchedule(tenantId, projectId);
  const project = useProject(tenantId, projectId);
  const canShift = p.can('repairs.schedule.shift') && !p.readOnly;
  const canBaseline = p.can('repairs.schedule.baseline') && !p.readOnly;
  const members = useAssignees(tenantId, canShift);
  const busyApply = useBusy('schedule:apply');
  const busyExec = useBusy('schedule:executor');
  const busyBase = useBusy('schedule:baseline');
  const [ref, width] = useWidth();
  const narrow = width < NARROW;
  const side = width >= SIDE;
  const [now] = useState(() => new Date());

  const [mode, setMode] = useState<'chart' | 'list' | null>(null);
  const [zoom, setZoom] = useState<'fit' | 'day'>('fit');
  const [base, setBase] = useState(true);
  const [crit, setCrit] = useState(false);
  const [draft, setDraft] = useState<Plan | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toToday, setToToday] = useState(0);
  const mode_ = mode ?? (narrow ? 'list' : 'chart');

  const data = q.data;
  const built = useMemo((): { v: ScheduleView } | { error: string } | null => {
    if (!data || !data.schedule.stages.length) return null;
    try {
      return { v: buildView(data.schedule, now) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [data, now]);
  const v = built && 'v' in built ? built.v : null;
  const drawn: Plan | null = v ? (draft ?? v.plan) : null;

  const changes = useMemo(() => (v && draft ? changesOf(v, draft) : []), [v, draft]);
  const server = useQuery({
    queryKey: [...scheduleKey(tenantId, projectId), 'preview', JSON.stringify(changes)],
    enabled: Boolean(v && draft && changes.length),
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => previewChange(api, tenantId, projectId, changes),
  });

  // Выбранный этап пропал из графика (перечитывание) — сводка.
  const selId = v && sel && v.model.stages.some((s) => s.id === sel) ? sel : null;

  const header = (children: ReactElement | null): ReactElement => {
    const H = p.headingLevel === 1 ? 'h1' : 'h2';
    return (
      <section ref={ref} aria-labelledby="h-gantt" data-screen-label="График" className="ox-gt">
        <div className="ox-gt-head">
          <div className="ox-gt-titles">
            <H id="h-gantt" className="ox-gt-title" data-level={p.headingLevel ?? 2}>
              {T.title}
            </H>
            {v ? (
              <p className="ox-gt-intro">
                {T.intro
                  .replace(
                    '{contract}',
                    project.data?.contractNo
                      ? project.data.contractNo.replace(/^договор/i, 'договором')
                      : 'договором',
                  )
                  .replace('{today}', v.cal.dayMonth(v.cal.cfg.today))}
              </p>
            ) : null}
          </div>
          {v ? (
            <div className="ox-gt-chips">
              {headChips(v).map((c) => (
                <ChipView key={c.label} c={c} />
              ))}
            </div>
          ) : null}
        </div>
        {children}
      </section>
    );
  };

  if (q.isPending) {
    return header(<Skeleton lines={4} label="Загрузка" />);
  }
  if (q.isError) {
    return header(
      <div className="ox-gt-error" role="alert">
        <span>{T.loadError.replace('{error}', problemText(q.error))}</span>
        <button type="button" className="ox-gt-btn" onClick={() => void q.refetch()}>
          {T.retry}
        </button>
      </div>,
    );
  }
  if (!data) return header(null);
  if (built && 'error' in built) {
    return header(
      <div className="ox-gt-error" role="alert">
        <span>{T.loadError.replace('{error}', built.error)}</span>
      </div>,
    );
  }
  if (!v || !drawn) {
    const build = async (): Promise<void> => {
      try {
        const next = await run(
          'schedule:build',
          () => buildFromEstimate(api, tenantId, projectId),
          T.empty.built,
          {
            quiet: ['invalid_transition', 'validation_failed'],
          },
        );
        qc.setQueryData(scheduleKey(tenantId, projectId), next);
        void refreshSchedule(qc, tenantId, projectId);
      } catch (e) {
        const code = problemCode(e);
        if (code === 'invalid_transition' || code === 'validation_failed') {
          toast(
            (e as { problem?: { detail?: string } }).problem?.detail ?? problemText(e),
            'error',
          );
        }
      }
    };
    return header(
      <EmptyState
        icon="calendar_month"
        title={T.empty.title}
        text={canShift ? T.empty.text : T.empty.readOnly}
        {...(canShift ? { action: { label: T.empty.build, onPress: () => void build() } } : {})}
      />,
    );
  }

  const { cal } = v;
  const R = timingsOf(v, drawn);
  const hasDraft = draft !== null;
  const pv = hasDraft ? previewOf(v, drawn) : null;
  const stages = ganttStagesOf(v, drawn, { draft: hasDraft, canShift });
  const attention = attentionOf(v, drawn);
  const windows = upcomingOf(v, drawn);
  const lastTo = windows.at(-1)?.to ?? 0;
  const prep = attention.filter((i) => i.start > lastTo);
  const sum = summaryOf(v);
  const panel = selId ? stagePanelOf(v, drawn, selId) : null;
  const nameOf = (id: string): string => v.model.stages.find((s) => s.id === id)?.name ?? '';

  const edit = (fn: (plan: Plan) => Plan): void => {
    setDraft(draftAfter(v.model, v.plan, fn(drawn)));
    setNotice(null);
  };

  const onPreview = (c: { stageId: string; start: string; end: string }): void => {
    const s = v.model.stages.find((x) => x.id === c.stageId);
    const t = R[c.stageId];
    if (!s || !t) return;
    const started = s.as != null;
    const moved = dayOf(cal, c.start) !== t.start;
    const next = moved
      ? dragMove(cal, drawn, s.id, t, dayOf(cal, c.start) - t.start)
      : dragResize(
          cal,
          drawn,
          s.id,
          t,
          dayOf(cal, c.end) - t.end,
          dragMinEnd(cal, started, t.start, cal.cfg.today),
        );
    setDraft(draftAfter(v.model, v.plan, next));
    setNotice(null);
  };

  const onApply = async (reason: string): Promise<void> => {
    if (!draft || !data) return;
    const who = [...(pv?.notifyWho ?? []), ...(pv?.endChanged ? ['заказчик'] : [])];
    try {
      const next = await run(
        'schedule:apply',
        () =>
          applyChange(api, tenantId, projectId, data, {
            changes: changesOf(v, draft),
            reason: reason as S['RepairScheduleReason'],
          }),
        null,
        { quiet: ['revision_mismatch', 'invalid_transition', 'validation_failed'] },
      );
      qc.setQueryData(scheduleKey(tenantId, projectId), next);
      setDraft(null);
      setNotice(
        T.summary.saved + (who.length ? T.summary.notified.replace('{who}', who.join(', ')) : ''),
      );
      void qc.invalidateQueries({ queryKey: [...scheduleKey(tenantId, projectId), 'preview'] });
    } catch (e) {
      if (isStale(e)) {
        toast(T.stale, 'warn');
        setDraft(null);
        await refreshSchedule(qc, tenantId, projectId);
      } else if (e instanceof ProblemError) {
        toast((e as { problem?: { detail?: string } }).problem?.detail ?? problemText(e), 'error');
        setDraft(null);
        await refreshSchedule(qc, tenantId, projectId);
      }
    }
  };

  const onWho = async (value: string): Promise<void> => {
    if (!selId || value === '__keep' || KEEP.has(value)) return;
    const m = members.data?.find((x) => x.id === value);
    try {
      await run(
        'schedule:executor',
        () =>
          setExecutor(api, tenantId, projectId, data, selId, {
            executorMemberId: value ? (m?.id ?? value) : null,
          }),
        T.executorSaved,
        { quiet: ['revision_mismatch'] },
      );
      await refreshSchedule(qc, tenantId, projectId);
    } catch (e) {
      if (isStale(e)) {
        toast(T.stale, 'warn');
        await refreshSchedule(qc, tenantId, projectId);
      }
    }
  };

  const onBaseline = async (agreementNo: number): Promise<void> => {
    try {
      const next = await run(
        'schedule:baseline',
        () => fixBaseline(api, tenantId, projectId, data, agreementNo),
        T.baseline_form.done,
        { quiet: ['revision_mismatch', 'validation_failed'] },
      );
      qc.setQueryData(scheduleKey(tenantId, projectId), next);
      void refreshSchedule(qc, tenantId, projectId);
    } catch (e) {
      if (isStale(e)) {
        toast(T.stale, 'warn');
        await refreshSchedule(qc, tenantId, projectId);
      } else if (problemCode(e) === 'validation_failed') {
        toast((e as { problem?: { detail?: string } }).problem?.detail ?? problemText(e), 'error');
      }
    }
  };

  const pick = (id: string): void => setSel(id);

  // «Уведомим…» дословно эталона: список сервера (при изменении даты сдачи в нём есть «Заказчик»), иначе расчёт клиента.
  const notifyLine = pv
    ? notifyText(
        server.data && changes.length
          ? server.data.notifyWho
          : [...pv.notifyWho, ...(pv.endChanged ? ['Заказчик'] : [])],
        project.data?.clientName ?? '',
      )
    : '';

  const items = windows.flatMap((w) =>
    w.items.map((it) => {
      const chips = [
        ...(it.progress
          ? [
              chip(
                it.progress.accepted > 0
                  ? T.upcoming.progress.replace('{n}', String(it.progress.accepted)) +
                      (it.progress.pending ? ', на приёмке ' + it.progress.pending + '%' : '')
                  : 'В работе',
                'info',
                'progress_activity',
              ),
            ]
          : []),
        ...(it.parallelWith
          ? [
              chip(
                T.upcoming.parallel.replace('{name}', nameOf(it.parallelWith)),
                'neutral',
                'call_split',
              ),
            ]
          : []),
        ...it.issues.map((i) => chip(i.short, i.tone, i.icon)),
        ...(it.ready ? [chip('Исполнитель и материалы готовы', 'ok', 'check_circle')] : []),
        ...(it.critical ? [CRIT] : []),
      ];
      return {
        id: it.id,
        title: it.name,
        week: String(w.from),
        when: it.when,
        who: it.who,
        chips,
        onOpen: () => pick(it.id),
      };
    }),
  );

  // Предпросмотр для `ScheduleChangePreview`: правленные и сдвинутые следом этапы, сдача было → стало.
  const edited = new Set(changes.map((c) => c.stageId));
  const shifted = v.model.stages.filter((s) => {
    const a = v.P[s.id];
    const b = R[s.id];
    return a && b && (a.start !== b.start || a.end !== b.end);
  });
  const previewChanges = shifted
    .filter((s) => edited.has(s.id))
    .map((s) => ({
      stageId: s.id,
      title: s.name,
      start: isoOf(cal, R[s.id]?.start ?? 0),
      end: isoOf(cal, R[s.id]?.end ?? 0),
      from: { start: isoOf(cal, v.P[s.id]?.start ?? 0), end: isoOf(cal, v.P[s.id]?.end ?? 0) },
    }));
  const finish = {
    from: isoOf(cal, v.P[v.fin]?.end ?? 0),
    to: isoOf(cal, R[v.fin]?.end ?? 0),
  };

  return header(
    <>
      <div role="toolbar" aria-label={T.toolbar} className="ox-gt-toolbar">
        <div className="ox-gt-seg">
          {(['chart', 'list'] as const).map((id) => (
            <button key={id} type="button" {...SEG(mode_ === id)} onClick={() => setMode(id)}>
              <Icon name={id === 'chart' ? 'view_timeline' : 'event_upcoming'} size={18} />
              {T.views[id]}
            </button>
          ))}
        </div>
        {mode_ === 'chart' ? (
          <>
            <div className="ox-gt-seg">
              {(['fit', 'day'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  {...SEG(zoom === id)}
                  onClick={() => {
                    setZoom(id);
                    if (id === 'day') setToToday((n) => n + 1);
                  }}
                >
                  {T.zoom[id]}
                </button>
              ))}
            </div>
            <label className="ox-gt-check">
              <input type="checkbox" checked={base} onChange={(e) => setBase(e.target.checked)} />
              {T.baseline}
            </label>
            <label className="ox-gt-check">
              <input type="checkbox" checked={crit} onChange={(e) => setCrit(e.target.checked)} />
              {T.critical}
            </label>
            {zoom === 'day' ? (
              <button type="button" className="ox-gt-btn" onClick={() => setToToday((n) => n + 1)}>
                <Icon name="today" size={18} />
                {T.today}
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {pv ? (
        <ScheduleChangePreview
          changes={previewChanges}
          moved={shifted.filter((s) => !edited.has(s.id)).length}
          finish={finish}
          notify={server.data?.notifyWho ?? pv.notifyWho}
          reasons={REASONS.map((r) => ({ value: r.value, label: r.label }))}
          texts={{
            lines: pv.lines,
            moved: pv.moved,
            finish: pv.endTxt,
            notify: notifyLine,
          }}
          late={pv.late}
          busy={busyApply}
          onApply={(r) => void onApply(r)}
          onCancel={() => setDraft(null)}
        />
      ) : null}

      <div className="ox-gt-layout" data-side={side}>
        <div className="ox-gt-main">
          {mode_ === 'chart' ? (
            <div className="ox-gt-chart">
              <Gantt
                stages={stages}
                links={v.model.links.map((l) => ({ from: l.from, to: l.to }))}
                baseline={base}
                today={isoOf(cal, cal.cfg.today)}
                calendar={{ weekends: [0, 6], holidays: v.api.holidays }}
                zoom={zoom}
                selected={selId}
                criticalMode={crit}
                dragEnabled={canShift && !narrow}
                scrollToToday={toToday}
                onSelect={pick}
                onPreview={onPreview}
              />
              <div className="ox-gt-legend">
                <Legend />
                <span className="ox-gt-legend-hint">{narrow ? T.hint.narrow : T.hint.wide}</span>
              </div>
            </div>
          ) : (
            <>
              <Lookahead
                weeks={windows.map((w) => ({
                  start: String(w.from),
                  label: w.title,
                  ...(w.sub ? { sub: w.sub } : {}),
                }))}
                items={items}
                prep={{}}
              />
              {prep.length ? (
                <div className="ox-gt-card ox-gt-flush">
                  <div className="ox-gt-prep-head">
                    <h3 className="ox-gt-h3">{T.upcoming.prepTitle}</h3>
                    <span className="ox-gt-label">{T.upcoming.prepSub}</span>
                  </div>
                  <IssueList issues={prep} onOpen={pick} />
                </div>
              ) : null}
            </>
          )}
        </div>
        <aside aria-label={T.aside} className="ox-gt-aside" data-side={side}>
          {notice ? (
            <div role="status" className="ox-gt-notice">
              <Icon name="check_circle" size={18} />
              <span>{notice}</span>
            </div>
          ) : null}
          {panel ? (
            <StageView
              panel={panel}
              canShift={canShift}
              members={members.data ?? []}
              estimate={panel.hasEstimate ? 'Собран из раздела сметы.' : 'Вне сметы, без стоимости'}
              calc={panel.ms ? 'Веха: дата сдачи по договору' : ''}
              onClose={() => setSel(null)}
              onOpen={pick}
              onStart={(d) => edit((pl) => bumpOffset(pl, panel.stage.id, d))}
              onDuration={(d) => edit((pl) => bumpDuration(pl, panel.stage, panel.min, d))}
              onLag={(from, to, d) => {
                const l = v.model.links.find((x) => x.from === from && x.to === to);
                if (l) edit((pl) => bumpLag(pl, l, d));
              }}
              onWho={(val) => void onWho(val)}
              whoBusy={busyExec}
            />
          ) : (
            <SummaryPanel
              sum={sum}
              fcLate={v.delayWd > 0}
              issues={attention}
              log={logOf(v)}
              holidays={v.api.holidays.map((h) => cal.dayMonth(dayOf(cal, h)))}
              hasElectric={v.model.stages.some((s) => s.name === 'Электрика · черновая')}
              onOpen={pick}
              canBaseline={canBaseline}
              busy={busyBase}
              onBaseline={(n) => void onBaseline(n)}
            />
          )}
        </aside>
      </div>
    </>,
  );
}

function Legend(): ReactElement {
  const L = T.legend;
  return (
    <>
      <span className="ox-gt-lg" data-k="act">
        {L.act}
      </span>
      <span className="ox-gt-lg" data-k="accepted">
        {L.accepted}
      </span>
      <span className="ox-gt-lg" data-k="review">
        {L.review}
      </span>
      <span className="ox-gt-lg" data-k="plan">
        {L.plan}
      </span>
      <span className="ox-gt-lg" data-k="base">
        {L.base}
      </span>
      <span className="ox-gt-lg" data-k="pause">
        {L.pause}
      </span>
      <span className="ox-gt-lg" data-k="today">
        {L.today}
      </span>
    </>
  );
}
