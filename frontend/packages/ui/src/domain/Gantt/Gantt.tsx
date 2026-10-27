import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GanttProps, GanttStage } from '../../types';
import { Icon } from '../../core/Icon';
import { dayNum, ddmmWd, isoOf, workCal, workDays } from './dates';
import { ganttGeo, type StageRowGeo } from './layout';
import styles from './Gantt.module.css';

const px = (v: number): string => `${Math.round(v * 10) / 10}px`;
const DEFAULT_WIDTH = 1000;
const RESIZE_TITLE = 'Потяните, чтобы изменить длительность';

interface Drag {
  id: string;
  mode: 'move' | 'resize';
  x0: number;
  dx: number;
  s: number;
  e: number;
}

function ariaOf(s: GanttStage): string {
  const a = dayNum(s.start);
  if (s.milestone) return s.title + ': ' + ddmmWd(a);
  return s.title + ': ' + ddmmWd(a) + ' – ' + ddmmWd(dayNum(s.end));
}

function Segments({ s }: { s: GanttStage }): ReactElement | null {
  if (s.kind === 'act')
    return <span className={styles.seg} data-kind="act" style={{ width: '100%' }} />;
  if (s.kind === 'accepted') {
    return <span className={styles.seg} data-kind="accepted" style={{ width: '100%' }} />;
  }
  if (s.kind === 'review')
    return <span className={styles.seg} data-kind="review" style={{ width: '100%' }} />;
  if (!s.progress) return null;
  return (
    <>
      <span
        className={styles.seg}
        data-kind="accepted"
        style={{ width: `${s.progress.accepted * 100}%` }}
      />
      <span
        className={styles.seg}
        data-kind="review"
        style={{ width: `${s.progress.review * 100}%` }}
      />
    </>
  );
}

/**
 * Диаграмма Ганта (design/Ремонт и стройка.dc.html :329–390, 1091–1190). Этапы по ISO-датам, разделы, связи-«ступеньки»,
 * паузы, «сегодня», выходные и праздники. Полоса — `role="img"` с датами и рабочими днями в `aria-label`; изменения
 * без мыши делаются кнопками в панели этапа страницы. Перетаскивание (мышь, `dragEnabled`) шлёт `onPreview` с новыми
 * датами по рабочему календарю: сдвиг полосы сохраняет длительность в рабочих днях, правый край — окончание.
 */
export function Gantt(props: GanttProps): ReactElement {
  const { onSelect, onPreview, selected = null, criticalMode = false, dragEnabled = true } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cal = useMemo(
    () => workCal(props.calendar.weekends, props.calendar.holidays),
    [props.calendar.weekends, props.calendar.holidays],
  );
  const holidays = useMemo(
    () => new Set((props.calendar.holidays ?? []).map(dayNum)),
    [props.calendar.holidays],
  );
  const g = useMemo(() => ganttGeo(props, width, holidays), [props, width, holidays]);

  const toToday = props.scrollToToday ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && toToday > 0) el.scrollLeft = Math.max(0, (g.todayIdx - 4) * g.dayW);
    // Прокрутка только по нажатию «К сегодня», не по смене масштаба.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toToday]);

  const down =
    (row: StageRowGeo, mode: Drag['mode']) =>
    (e: ReactPointerEvent<HTMLElement>): void => {
      if (e.button !== 0) return;
      if (mode === 'resize') e.stopPropagation();
      onSelect?.(row.stage.id);
      const ok = mode === 'move' ? row.stage.canMove : row.stage.canResize;
      if (!dragEnabled || g.narrow || e.pointerType !== 'mouse' || !ok) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* без захвата указателя */
      }
      dragRef.current = {
        id: row.stage.id,
        mode,
        x0: e.clientX,
        dx: 0,
        s: dayNum(row.stage.start),
        e: dayNum(row.stage.end),
      };
    };

  const move = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = dragRef.current;
    if (!d) return;
    const dx = Math.round((e.clientX - d.x0) / g.dayW);
    if (dx === d.dx) return;
    d.dx = dx;
    if (d.mode === 'move') {
      const n = Math.max(1, cal.count(d.s, d.e));
      const s = cal.fw(d.s + dx);
      onPreview?.({ stageId: d.id, start: isoOf(s), end: isoOf(cal.addW(s, n)) });
    } else {
      const end = Math.max(cal.pw(d.e + dx), d.s);
      onPreview?.({ stageId: d.id, start: isoOf(d.s), end: isoOf(end) });
    }
  };
  const up = (): void => {
    dragRef.current = null;
  };

  const weekStyle = (d: number): CSSProperties => ({ left: px(d * g.dayW), width: px(g.dayW) });

  return (
    <div className={styles.root} ref={rootRef} data-zoom={props.zoom} data-narrow={g.narrow}>
      <div
        className={styles.scroll}
        ref={scrollRef}
        role="group"
        aria-label={props.ariaLabel ?? 'Диаграмма графика работ'}
      >
        <div className={styles.inner} style={{ width: px(g.innerW) }}>
          <div className={styles.head}>
            <div className={styles.corner} style={{ width: px(g.nameW) }}>
              Этап
            </div>
            <div className={styles.timeline} style={{ width: px(g.tlW), height: 50 }}>
              {g.months.map((m) => (
                <span
                  key={m.key}
                  className={styles.month}
                  data-month=""
                  style={{ left: px(m.left), width: px(m.width) }}
                >
                  {m.label}
                </span>
              ))}
              {g.ticks.map((k) => (
                <span
                  key={k.day}
                  className={styles.tick}
                  title={k.title}
                  data-today={k.today}
                  data-off={!k.workday}
                  data-week={props.zoom === 'fit'}
                  style={{ left: px(k.left), width: px(k.width) }}
                >
                  {k.label}
                </span>
              ))}
              <span className={styles.todayPill} aria-hidden="true" style={{ left: px(g.todayX) }}>
                сегодня
              </span>
            </div>
          </div>

          <div className={styles.body}>
            {g.rows.map((r) =>
              r.kind === 'phase' ? (
                <div key={'p:' + r.label} className={styles.phaseRow}>
                  <div className={styles.phaseName} style={{ width: px(g.nameW) }}>
                    <span className={styles.phaseLabel}>{r.label}</span>
                    <span className={styles.phaseDates}>{r.dates}</span>
                  </div>
                  <div className={styles.timeline} style={{ width: px(g.tlW) }}>
                    <span
                      className={styles.phaseBar}
                      style={{ left: px(r.left), width: px(r.width) }}
                    />
                  </div>
                </div>
              ) : (
                <StageRow
                  key={r.stage.id}
                  r={r}
                  nameW={g.nameW}
                  tlW={g.tlW}
                  narrow={g.narrow}
                  selected={selected === r.stage.id}
                  dimmed={criticalMode && !r.stage.critical}
                  baseline={Boolean(props.baseline)}
                  dragOn={dragEnabled}
                  wd={cal.count(dayNum(r.stage.start), dayNum(r.stage.end))}
                  onSelect={() => onSelect?.(r.stage.id)}
                  down={down}
                  move={move}
                  up={up}
                />
              ),
            )}
            <div
              className={styles.overlay}
              aria-hidden="true"
              style={{ left: px(g.nameW), width: px(g.tlW) }}
            >
              {g.weekendDays.map((d) => (
                <span key={'w' + d} className={styles.weekend} style={weekStyle(d)} />
              ))}
              {g.holidayDays.map((d) => (
                <span key={'h' + d} className={styles.holiday} style={weekStyle(d)} />
              ))}
              {g.pauses.map((p) => (
                <span key={p.key}>
                  <span
                    className={styles.pause}
                    style={{ top: px(p.top), left: px(p.left), width: px(p.width) }}
                  />
                  {p.label ? (
                    <span
                      className={styles.pauseLabel}
                      data-clipped={!p.fits}
                      style={{ top: px(p.labelTop), left: px(p.left) }}
                    >
                      {p.label}
                    </span>
                  ) : null}
                </span>
              ))}
              <svg className={styles.links} width={g.tlW} height={g.height} focusable="false">
                {g.links.map((l) => (
                  <g key={l.key} data-link={l.key} data-state={l.state} className={styles.link}>
                    <path d={l.d} fill="none" strokeWidth={l.width} />
                    <polygon points={l.arrow} />
                  </g>
                ))}
              </svg>
              <span className={styles.todayLine} style={{ left: px(g.todayX) }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StageRow(p: {
  r: StageRowGeo;
  nameW: number;
  tlW: number;
  narrow: boolean;
  selected: boolean;
  dimmed: boolean;
  baseline: boolean;
  dragOn: boolean;
  /** Рабочих дней этапа по календарю. */
  wd: number;
  onSelect: () => void;
  down: (row: StageRowGeo, mode: Drag['mode']) => (e: ReactPointerEvent<HTMLElement>) => void;
  move: (e: ReactPointerEvent<HTMLElement>) => void;
  up: () => void;
}): ReactElement {
  const { r, nameW, tlW } = p;
  const s = r.stage;
  const moves = p.dragOn && !p.narrow && Boolean(s.canMove);
  const showBase = p.baseline && r.hasBase && s.kind !== 'accepted' && s.kind !== 'act';
  return (
    <div
      className={styles.stageRow}
      data-stage={s.id}
      data-selected={p.selected}
      data-dimmed={p.dimmed}
    >
      <button
        type="button"
        className={styles.name}
        style={{ width: px(nameW) }}
        aria-pressed={p.selected}
        onClick={p.onSelect}
      >
        <span className={styles.nameLine}>
          <span className={styles.title}>{s.title}</span>
          {(s.marks ?? []).map((m) => (
            <span
              key={m.icon + m.label}
              className={styles.mark}
              data-tone={m.tone}
              role="img"
              aria-label={m.label}
              title={m.label}
            >
              <Icon name={m.icon} size={16} />
            </span>
          ))}
        </span>{' '}
        {!p.narrow && s.meta ? (
          <span className={styles.meta}>
            {s.meta}
            {s.variance ? (
              <span className={styles.variance} data-tone={s.variance.tone}>
                {' '}
                {s.variance.text}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      <div className={styles.timeline} style={{ width: px(tlW) }}>
        {showBase && !s.milestone ? (
          <span
            className={styles.base}
            data-baseline={s.id}
            title={'По договору: ' + s.baseline?.start + ' – ' + s.baseline?.end}
            style={{ left: px(r.baseLeft), width: px(r.baseWidth) }}
          />
        ) : null}
        {p.baseline && r.hasBase && s.milestone ? (
          <span
            className={styles.baseMs}
            data-baseline={s.id}
            title="По договору"
            style={{ left: px(r.baseMsLeft) }}
          />
        ) : null}
        {s.milestone ? (
          <span
            className={styles.ms}
            role="img"
            aria-label={ariaOf(s)}
            title={ariaOf(s)}
            data-selected={p.selected}
            style={{ left: px(r.msLeft) }}
            onPointerDown={p.down(r, 'move')}
          />
        ) : (
          <div
            className={styles.bar}
            role="img"
            aria-label={ariaOf(s) + ', ' + workDays(Math.max(1, p.wd))}
            title={ariaOf(s)}
            data-kind={s.kind}
            data-changed={Boolean(s.changed)}
            data-selected={p.selected}
            data-movable={moves}
            style={{ left: px(r.left), width: px(r.width) }}
            onPointerDown={p.down(r, 'move')}
            onPointerMove={p.move}
            onPointerUp={p.up}
            onPointerCancel={p.up}
          >
            <Segments s={s} />
            {p.dragOn && !p.narrow && s.canResize ? (
              <span
                className={styles.handle}
                title={RESIZE_TITLE}
                onPointerDown={p.down(r, 'resize')}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
