// W4.41 · Страница «Календарь» (`core-calendar`, CAL-01…05; эталон design-2026-10-19 «Ортус CRM.dc.html»
// pg.calendar :1781–1823, calVM :4140–4180; 06 §5). Ресурсы — listCalendarResources (права и область — на сервере:
// машины только с «Логистикой», массажист — свой ресурс и забронированные вместе с ним), брони — listCalendarBookings
// за сутки или неделю в поясе ресурсов. Бронь — `?booking=` (ADR-0001): мета, источник, перенос с проверкой всех
// ресурсов (updateCalendarBooking) и свободные слоты конфликта (findCalendarAvailability), запрет — rescheduleLock.
// Неделя и навигация по датам — `?view=week&date=` (no-reference, Q-W4.06-4).
import { type components, ProblemError } from '@ortus/api-client';
import { calendar as T, format, shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import {
  type CSSProperties,
  Fragment,
  type ReactElement,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useApi } from '../../../app/api.tsx';
import { AccessGate } from '../../../shell/AccessGate.tsx';
import { useShell } from '../../../shell/context.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { LoadFailed, useRetryFocus } from '../../company/modules/ui.tsx';
import {
  calendarKey,
  freeSlots,
  idemKeys,
  reschedule,
  rescheduleBody,
  useBooking,
  useBookings,
  useResources,
} from './api.ts';
import {
  type Block,
  blocksOf,
  bookingDay,
  type Grid,
  gridOf,
  hourMarks,
  type KindFilter,
  kindFilters,
  lockTextOf,
  metaOf,
  moveWindow,
  rowsOf,
  slotsQuery,
  sourceOf,
  startValue,
  timeOptions,
  workdayOf,
} from './model.ts';
import { CAL_TEXT } from './texts.ts';
import {
  addDays,
  cityOf,
  clock,
  dateTitle,
  dayHead,
  dayShort,
  dayStart,
  isIsoDate,
  localDate,
  mondayOf,
  msToNextDay,
  offsetLabel,
  weekTitle,
} from './time.ts';
import '../../company/modules/modules.css';
import './calendar.css';

type S = components['schemas'];
type Resource = S['CalendarResource'];
type Booking = S['Booking'];

/** Отказ сервера в ресурсах календаря — гейт ветки A эталона («Нет доступа к разделу «Календарь»»). */
const NO_PERMISSION = {
  kind: 'deny',
  reason: 'no_permission',
  branch: 'A',
  chip: 'noPermission',
  title: 'noRole',
  domainModule: 'calendar',
  label: null,
  owner: false,
} as const;

/** Пояс по умолчанию — пояс организаций сида и эталона («Москва (UTC+3)»). */
const MSK = 'Europe/Moscow';

interface CalSearch {
  booking?: string;
  view?: 'week';
  date?: string;
}

const searchOf = (raw: Record<string, unknown>): CalSearch => ({
  ...(typeof raw.booking === 'string' && raw.booking ? { booking: raw.booking } : {}),
  ...(raw.view === 'week' ? { view: 'week' as const } : {}),
  ...(isIsoDate(raw.date) ? { date: raw.date } : {}),
});

/** Полоса часов: шаг линии сетки — час (8,333 % дня 08:00–20:00 эталона). */
const hourStep = (g: Grid): string => {
  const n = g.end - g.start;
  return n === 12 ? '8.333%' : `${(100 / n).toFixed(3)}%`;
};

function Skeleton(): ReactElement {
  return (
    <div className="ox-cal-skel" role="status" aria-label={shell.a11y.loading}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="ox-cal-skel-line" />
      ))}
    </div>
  );
}

function Blocks({ list, onPick }: { list: Block[]; onPick: (id: string) => void }): ReactElement {
  return (
    <>
      {list.map((b) => (
        <Fragment key={b.id}>
          <span
            aria-hidden="true"
            className="ox-cal-buf"
            style={{ left: `${b.bufLeft}%`, width: `${b.bufWidth}%` }}
          />
          <button
            type="button"
            className="ox-cal-block"
            data-tone={b.tone}
            data-selected={b.selected ? '' : undefined}
            aria-label={b.aria}
            style={{ left: `${b.left}%`, width: `${b.width}%` }}
            onClick={() => onPick(b.id)}
          >
            <span className="ox-cal-block-text">{b.title}</span>
          </button>
        </Fragment>
      ))}
    </>
  );
}

/** Панель выбранной брони (:1804–1821): мета, источник, перенос или запрет, конфликт со слотами. */
function BookingPanel(p: {
  tenantId: string;
  booking: Booking;
  resources: readonly Resource[];
  tz: string;
  onChanged: () => Promise<unknown>;
  onSource: (page: 'spa' | 'fleet', trip?: string) => void;
}): ReactElement {
  const { booking: b, tz } = p;
  const api = useApi();
  const run = useRun();
  const toast = useToast();
  const busy = useBusy('cal');
  // Команда и перечитывание после неё: до ответа повтор не уходит со старой версией брони.
  const [pending, setPending] = useState(false);
  const [keys] = useState(idemKeys);
  const [move, setMove] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ text: string; slots: S['AvailabilitySlot'][] } | null>(
    null,
  );
  const names = useMemo(() => new Map(p.resources.map((r) => [r.id, r.name])), [p.resources]);
  const lock = lockTextOf(b);
  const src = sourceOf(b);
  const wd = workdayOf(b, p.resources);
  const day = bookingDay(b, tz);
  const value = move ?? startValue(b, tz);

  const doMove = async (window: S['TimeWindow'], okText: string): Promise<void> => {
    const body = rescheduleBody(b, window);
    setPending(true);
    try {
      await run('cal', () => reschedule(api, p.tenantId, b, window, keys.key(body)), okText, {
        quiet: ['resources_unavailable', 'validation_failed'],
      });
      keys.settle(body);
      setConflict(null);
      setMove(null);
      await p.onChanged();
    } catch (e) {
      const code = problemCode(e);
      // Определённый ответ сервера — ключ отработан; «нет связи» — повтор с тем же ключом.
      if (code !== 'offline') keys.settle(body);
      const detail = e instanceof ProblemError ? e.problem?.detail : undefined;
      if (code === 'resources_unavailable') {
        // Конфликт эталона (moveBooking :779) и свободные слоты для всех ресурсов брони (freeSlots).
        // Слоты — подсказка: сбой их запроса не прячет конфликт.
        const slots = await freeSlots(api, p.tenantId, slotsQuery(b, day, wd)).catch(
          (): S['AvailabilitySlot'][] => [],
        );
        setConflict({ text: detail ?? problemText(e), slots });
        return;
      }
      if (code === 'validation_failed') {
        toast(detail ?? problemText(e), 'error');
        return;
      }
      // Запрет, устаревшая версия, бронь исчезла — показать актуальное состояние (тост — у run).
      if (code !== 'offline') await p.onChanged();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="ox-cal-panel">
      <div className="ox-cal-panel-head">
        <div>
          <h2 className="ox-cal-panel-title">{b.title}</h2>
          <span className="ox-cal-meta">{metaOf(b, names, tz)}</span>
        </div>
        {src ? (
          <button
            type="button"
            className="ox-cal-src"
            onClick={() => p.onSource(src.page, src.trip)}
          >
            <Icon name="open_in_new" size={18} />
            {src.label}
          </button>
        ) : null}
      </div>
      {lock ? null : (
        <div className="ox-cal-move">
          <label className="ox-cal-field">
            {T.moveTo}
            <select
              value={value}
              onChange={(e) => {
                setMove(e.target.value);
                setConflict(null);
              }}
            >
              {timeOptions(wd).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ox-cal-primary"
            disabled={busy || pending}
            onClick={() => void doMove(moveWindow(b, day, value), T.moved)}
          >
            {T.move}
          </button>
        </div>
      )}
      {lock ? <span className="ox-cal-lock">{lock}</span> : null}
      {conflict ? (
        <div role="alert" className="ox-cal-conflict">
          <span className="ox-cal-conflict-text">
            <Icon name="event_busy" size={20} />
            <span>{conflict.text}</span>
          </span>
          <div className="ox-cal-slots">
            <span>{T.slots}</span>
            {conflict.slots.map((s) => {
              const time = clock(Date.parse(s.window.startsAt), tz);
              return (
                <button
                  key={s.window.startsAt}
                  type="button"
                  className="ox-cal-slot"
                  disabled={busy || pending}
                  onClick={() =>
                    void doMove(
                      { ...s.window, timeZone: b.window.timeZone },
                      format(T.movedTo, { time }),
                    )
                  }
                >
                  {time}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function CalendarPage(): ReactElement {
  const { tenantId: id } = useShell();
  const tenantId = id ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const search = searchOf(location.search as Record<string, unknown>);
  const [kind, setKind] = useState<KindFilter>('all');
  // Часы страницы («сегодня» и смещение пояса): момент открытия, обновляются в местную полночь, при возврате на
  // вкладку после смены суток и по «Сегодня» (возврат 1 — страница, открытая через полночь).
  const [now, setNow] = useState(() => Date.now());

  const resources = useResources(tenantId);
  const list = useMemo(() => resources.data ?? [], [resources.data]);
  const tz = list[0]?.timeZone ?? MSK;

  useEffect(() => {
    const refresh = (): void =>
      setNow((prev) => {
        const t = Date.now();
        return localDate(t, tz) === localDate(prev, tz) ? prev : t;
      });
    const timer = setTimeout(refresh, msToNextDay(now, tz) + 1000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [now, tz]);
  const week = search.view === 'week';
  const date = search.date ?? localDate(now, tz);
  const first = week ? mondayOf(date) : date;
  const days = week ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(first, i)) : [date];
  const win = resources.isSuccess
    ? { from: dayStart(first, tz), to: dayStart(addDays(first, days.length), tz) }
    : null;
  const bookings = useBookings(tenantId, win);
  const items = useMemo(() => bookings.data ?? [], [bookings.data]);
  const listed = items.find((b) => b.id === search.booking);
  const outside = !!search.booking && bookings.isSuccess && !listed;
  const linked = useBooking(tenantId, search.booking, outside);
  const selected = listed ?? (outside ? linked.data : undefined);
  const retry = useRetryFocus(resources.isSuccess && bookings.isSuccess, () =>
    document.getElementById('h-cal'),
  );

  const go = (patch: Partial<CalSearch>, replace = false): void => {
    const next = { ...search, ...patch };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'calendar' },
      search: clean as never,
      replace,
    });
  };

  // Ссылка на бронь вне окна: перейти на её день; бронь не найдена — убрать её из адреса.
  const linkedDate = linked.data ? localDate(Date.parse(linked.data.window.startsAt), tz) : null;
  useEffect(() => {
    if (!outside) return;
    if (linkedDate && !days.includes(linkedDate)) go({ date: linkedDate }, true);
    else if (linked.isError) go({ booking: undefined }, true);
    // Только по ответу брони-ссылки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outside, linkedDate, linked.isError]);

  const effKind: KindFilter = kind === 'all' || list.some((r) => r.kind === kind) ? kind : 'all';
  const rows = rowsOf(list, effKind);
  const grid = gridOf(list);
  const zone = format(T.dateLine, {
    date: week ? weekTitle(first) : dateTitle(date),
    city: cityOf(tz),
    offset: offsetLabel(tz, win?.from ?? now),
  });
  const trackStyle = { '--ox-cal-hour': hourStep(grid) } as CSSProperties;

  const pick = (bookingId: string): void => go({ booking: bookingId });
  const shift = (n: number): void =>
    go({ date: addDays(date, week ? n * 7 : n), booking: undefined });
  const onChanged = () => qc.invalidateQueries({ queryKey: [...calendarKey(tenantId)] });
  const onSource = (page: 'spa' | 'fleet', trip?: string): void =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page },
      search: (trip ? { trip } : {}) as never,
    });

  const blocksFor = (r: Resource, day: string): Block[] =>
    blocksOf(r.id, items, {
      dayStart: dayStart(day, tz),
      grid,
      tz,
      selected: selected?.id,
      ...(week
        ? {
            aria: (b: Booking, from: string, to: string) =>
              format(CAL_TEXT.weekBlockAria, { title: b.title, day: dayShort(day), from, to }),
          }
        : {}),
    });

  // Гейт оболочки пропускает по любому из ключей манифеста (calendar.availability.read у водителя), а ресурсы
  // календаря сервер отдаёт только с calendar.bookings.read: 403 — та же карточка «Нет доступа к разделу».
  if (resources.isError && problemCode(resources.error) === 'forbidden_action') {
    return <AccessGate access={NO_PERMISSION} />;
  }

  let body: ReactElement | null = null;
  if (resources.isPending || (resources.isSuccess && bookings.isPending)) body = <Skeleton />;
  else if (resources.isError)
    body = <LoadFailed error={resources.error} onRetry={retry(() => resources.refetch())} />;
  else if (bookings.isError)
    body = <LoadFailed error={bookings.error} onRetry={retry(() => bookings.refetch())} />;

  const ready = body === null;

  return (
    <section aria-labelledby="h-cal" className="ox-cal">
      <div className="ox-cal-head">
        <div className="ox-cal-titles">
          <div className="ox-cal-date">{zone}</div>
          <h1 id="h-cal" className="ox-cal-title" tabIndex={-1}>
            {T.title}
          </h1>
        </div>
        <div role="group" aria-label={T.kindAria} className="ox-cal-kinds">
          {kindFilters(list, effKind).map((f) => (
            <button
              key={f.key}
              type="button"
              className="ox-cal-pill"
              aria-pressed={f.pressed ? 'true' : 'false'}
              onClick={() => setKind(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div role="group" aria-label={CAL_TEXT.periodAria} className="ox-cal-period">
        <button
          type="button"
          className="ox-cal-pill"
          data-icon=""
          aria-label={week ? CAL_TEXT.prev.week : CAL_TEXT.prev.day}
          onClick={() => shift(-1)}
        >
          <Icon name="chevron_left" size={20} />
        </button>
        <button
          type="button"
          className="ox-cal-pill"
          onClick={() => {
            setNow(Date.now());
            go({ date: undefined, booking: undefined });
          }}
        >
          {CAL_TEXT.today}
        </button>
        <button
          type="button"
          className="ox-cal-pill"
          data-icon=""
          aria-label={week ? CAL_TEXT.next.week : CAL_TEXT.next.day}
          onClick={() => shift(1)}
        >
          <Icon name="chevron_right" size={20} />
        </button>
        <span className="ox-cal-period-gap" />
        <button
          type="button"
          className="ox-cal-pill"
          aria-pressed={week ? 'false' : 'true'}
          onClick={() => go({ view: undefined, booking: undefined })}
        >
          {CAL_TEXT.day}
        </button>
        <button
          type="button"
          className="ox-cal-pill"
          aria-pressed={week ? 'true' : 'false'}
          onClick={() => go({ view: 'week', booking: undefined })}
        >
          {CAL_TEXT.week}
        </button>
      </div>
      <div className="ox-cal-card">
        <div className="ox-cal-grid" data-view={week ? 'week' : 'day'}>
          <div className="ox-cal-row" data-head="">
            <span className="ox-cal-res-head">{T.resource}</span>
            {week ? (
              <div className="ox-cal-days">
                {days.map((d) => (
                  <span key={d} className="ox-cal-day">
                    {dayHead(d)}
                  </span>
                ))}
              </div>
            ) : (
              <div className="ox-cal-hours">
                {hourMarks(grid).map((h) => (
                  <span key={h.label} style={{ left: `${h.left}%` }}>
                    {h.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          {ready
            ? rows.map((r) => (
                <div key={r.id} className="ox-cal-row">
                  <div className="ox-cal-res">
                    <Icon name={r.icon} size={18} />
                    <span className="ox-cal-name">{r.name}</span>
                  </div>
                  {week ? (
                    <div className="ox-cal-week">
                      {days.map((d) => (
                        <div key={d} className="ox-cal-track" style={trackStyle}>
                          <Blocks list={blocksFor(r, d)} onPick={pick} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="ox-cal-track" style={trackStyle}>
                      <Blocks list={blocksFor(r, date)} onPick={pick} />
                    </div>
                  )}
                </div>
              ))
            : null}
        </div>
        {body}
      </div>
      <div className="ox-cal-legend">
        <span className="ox-cal-legend-item">
          <span className="ox-cal-swatch" />
          {T.legendBuffer}
        </span>
        <span>{T.legendNote}</span>
      </div>
      {selected && ready ? (
        <BookingPanel
          key={selected.id}
          tenantId={tenantId}
          booking={selected}
          resources={list}
          tz={tz}
          onChanged={onChanged}
          onSource={onSource}
        />
      ) : null}
    </section>
  );
}
