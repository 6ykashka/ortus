// W6.20 · Вкладка «Обзор» (вариант 1a, «Ортус CRM.dc.html» :2007–2069, repairCardVM :4356): «Требует решения» / «Мои вопросы
// по объекту», «Объёмы работ», «Фотоотчёт», «Как попасть на объект», «Люди на объекте», «Деньги» (только с правом
// финансов — сервер без права суммы не отдаёт), «Лента». У объекта-черновика объёмов и фото нет.
import type { components } from '@ortus/api-client';
import { Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import { useBusy } from '../../shell/run.tsx';
import {
  type DecisionView,
  dayMonth,
  decisionView,
  moneyRows,
  peopleRows,
  volumeRows,
} from './model.ts';
import { Meter } from './parts.tsx';
import { REPAIR_TEXT as T } from './texts.ts';
import type { AcceptFn } from './works.tsx';

type S = components['schemas'];

export interface OverviewProps {
  ov: S['RepairProjectOverview'];
  logs: readonly S['WorkLog'][];
  foreman: boolean;
  canFin: boolean;
  readOnly: boolean;
  accept: AcceptFn;
  onTab: (tab: string) => void;
  onSupply: () => void;
  onAssign: () => void;
}

/** Пояснение к пункту приёмки: номер отметки, дата, фото, бригада (эталон: «Отметка WL-12 · …»). */
function logMeta(log: S['WorkLog'] | undefined, crew: readonly S['Worker'][]): string | undefined {
  if (!log) return undefined;
  const names = (log.crewWorkerIds ?? [])
    .map((id) => crew.find((w) => w.id === id)?.displayName)
    .filter(Boolean)
    .join(', ');
  return (
    `Отметка ${log.number ?? ''} · ${dayMonth(log.createdAt)} · фото: ${String(log.evidenceFileIds.length)}` +
    (names ? ` · ${names}` : '')
  );
}

function TodoItem(p: {
  item: DecisionView;
  log: S['WorkLog'] | undefined;
  readOnly: boolean;
  accept: AcceptFn;
  onTab: (tab: string) => void;
  onSupply: () => void;
  onAssign: () => void;
}): ReactElement {
  const { item, log } = p;
  const busy = useBusy(`repair-accept:${log?.id ?? ''}`);
  const a = item.action;
  const press = (): void => {
    if (!a) return;
    if (a.type === 'assign') p.onAssign();
    else if (a.type === 'supply') p.onSupply();
    else if (a.type === 'accept') {
      if (log) void p.accept(log);
      else p.onTab('works');
    } else p.onTab(a.tab);
  };
  const mutating = a?.type === 'assign' || a?.type === 'accept';
  return (
    <div className="ox-rp-item">
      <span className="ox-rp-item-icon" data-tone={item.tone} aria-hidden="true">
        <Icon name={item.icon} size={20} />
      </span>
      <div className="ox-rp-item-body">
        <div className="ox-rp-item-title">
          <span className="ox-rp-item-tag ox-rp-tone" data-tone={item.tone}>
            {item.tag}
          </span>
          <strong style={{ fontWeight: 600 }}>{item.title}</strong>
        </div>
        {item.meta ? <span className="ox-rp-item-meta">{item.meta}</span> : null}
      </div>
      {a ? (
        <button
          type="button"
          className="ox-rp-btn"
          data-variant="outline"
          disabled={busy || (mutating && p.readOnly)}
          onClick={press}
        >
          {a.label}
        </button>
      ) : null}
    </div>
  );
}

export function Overview(p: OverviewProps): ReactElement {
  const { ov } = p;
  const project = ov.project;
  const draft = project.status === 'draft';
  const done = project.status === 'handed_over';
  const items = ov.decisions.map((d) => {
    const log = p.logs.find((l) => l.id === d.refId);
    const meta = d.kind === 'work_log_pending' ? logMeta(log, ov.people.crew) : undefined;
    return {
      d,
      log,
      view: decisionView(d, {
        startOn: project.startOn,
        dueOn: project.dueOn,
        ...(meta ? { meta } : {}),
      }),
    };
  });
  const volumes = volumeRows(ov.works);
  const photos = ov.photos.slice(0, 4);
  const workName = (log: S['WorkLog'] | undefined): string => {
    const id = log?.lines[0]?.workId;
    return (ov.works.find((w) => w.id === id)?.name ?? '').toLowerCase();
  };
  const people = peopleRows(ov.people, project);
  const money = ov.money ? moneyRows(ov.money, done) : [];
  return (
    <div className="ox-rp-ov">
      <div className="ox-rp-ov-main">
        <div className="ox-rp-panel" data-flush>
          <div className="ox-rp-panel-head">
            <h2 className="ox-rp-h2">
              {p.foreman ? T.overview.todoTitleForeman : T.overview.todoTitle}
            </h2>
            {items.length > 0 ? <span className="ox-rp-count">{items.length}</span> : null}
            <span className="ox-rp-grow" />
            <span className="ox-rp-muted">{T.overview.todoNote}</span>
          </div>
          {items.map(({ view, log }) => (
            <TodoItem
              key={view.id}
              item={view}
              log={log}
              readOnly={p.readOnly}
              accept={p.accept}
              onTab={p.onTab}
              onSupply={p.onSupply}
              onAssign={p.onAssign}
            />
          ))}
          {items.length === 0 ? (
            <div className="ox-rp-none">
              <Icon name="check_circle" size={20} />
              {T.noQuestions}
            </div>
          ) : null}
        </div>

        {!draft ? (
          <>
            <div className="ox-rp-panel" data-flush>
              <div className="ox-rp-panel-head" style={{ paddingBottom: 10 }}>
                <h2 className="ox-rp-h2">{T.overview.volumes}</h2>
                <span className="ox-rp-muted" style={{ fontSize: 'var(--ox-fs-sm)' }}>
                  {T.overview.volumesNote}
                </span>
                <span className="ox-rp-grow" />
                <button type="button" className="ox-rp-link" onClick={() => p.onTab('schedule')}>
                  {T.overview.openSchedule}
                </button>
              </div>
              {volumes.map((v) => (
                <div key={v.id} className="ox-rp-vol">
                  <Icon name={v.icon} size={20} />
                  <div className="ox-rp-vol-name">
                    <span>{v.name}</span>
                    <span className="ox-rp-muted">{v.note}</span>
                  </div>
                  <Meter accepted={v.acceptedW} pending={v.pendingW} />
                  <span className="ox-rp-vol-pct">{v.pct}</span>
                </div>
              ))}
            </div>

            <div className="ox-rp-panel" data-pad>
              <div className="ox-rp-panel-head" style={{ padding: 0 }}>
                <h2 className="ox-rp-h2">{T.overview.photos}</h2>
                <span className="ox-rp-muted" style={{ fontSize: 'var(--ox-fs-sm)' }}>
                  {ov.photos.length > 0
                    ? T.overview.photosSome.replace('{n}', String(ov.photos.length))
                    : T.overview.photosNone}
                </span>
              </div>
              {photos.length > 0 ? (
                <div className="ox-rp-photos">
                  {photos.map((ph, i) => {
                    const log = p.logs.find((l) => l.id === ph.workLogId);
                    const ok = ph.status === 'accepted';
                    return (
                      <figure key={`${ph.fileId}-${String(i)}`} className="ox-rp-photo">
                        <div className="ox-rp-photo-box">
                          {T.overview.photoPlaceholder.replace('{work}', workName(log))}
                        </div>
                        <figcaption data-pending={ok ? undefined : ''}>
                          {log?.number ?? ''} · {dayMonth(ph.takenAt)},{' '}
                          <span>{ok ? T.overview.photoAccepted : T.overview.photoPending}</span>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      <div className="ox-rp-ov-side">
        <div className="ox-rp-panel" data-pad>
          <div className="ox-rp-row-head">
            <h2 className="ox-rp-h2">{T.overview.access}</h2>
            <button
              type="button"
              className="ox-rp-btn"
              data-size="sm"
              disabled
              title={T.overview.routeTitle}
            >
              <Icon name="directions" size={18} />
              {T.overview.route}
            </button>
          </div>
          <div className="ox-rp-access">
            <Icon name="location_on" size={18} />
            <span>{project.address}</span>
            {project.access.map((a) => (
              <FragmentRow key={a.text} icon={a.icon} text={a.text} />
            ))}
          </div>
        </div>

        <div className="ox-rp-panel" data-pad style={{ gap: 0, paddingBottom: 8 }}>
          <h2 className="ox-rp-h2" style={{ marginBottom: 6 }}>
            {T.overview.people}
          </h2>
          {people.map((r) => (
            <div key={r.name} className="ox-rp-person">
              <span className="ox-rp-avatar" data-tone={r.tone} aria-hidden="true">
                <Icon name={r.icon} size={18} />
              </span>
              <div className="ox-rp-person-text">
                <span>{r.name}</span>
                <span className="ox-rp-muted">{r.role}</span>
              </div>
            </div>
          ))}
        </div>

        {p.canFin && ov.money ? (
          <div className="ox-rp-panel" data-pad>
            <div className="ox-rp-row-head">
              <h2 className="ox-rp-h2">{T.overview.money}</h2>
              <span className="ox-rp-chip" data-tone="neutral">
                <Icon name="lock" size={15} />
                {T.overview.moneyChip}
              </span>
            </div>
            <div className="ox-rp-money">
              {money.map((m) => (
                <div key={m.label}>
                  <span className="ox-rp-muted">{m.label}</span>
                  <strong>{m.value}</strong>
                  <span className="ox-rp-muted">{m.sub}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="ox-rp-btn"
              data-size="sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => p.onTab('finance')}
            >
              {T.overview.openFinance}
            </button>
          </div>
        ) : null}

        <div className="ox-rp-panel" data-pad style={{ gap: 0, paddingBottom: 8 }}>
          <h2 className="ox-rp-h2" style={{ marginBottom: 6 }}>
            {T.overview.feed}
          </h2>
          {ov.feed.map((e, i) => (
            <div key={`${e.at}-${String(i)}`} className="ox-rp-feed">
              <span>{dayMonth(e.at)}</span>
              <span>
                {e.actorName ? <strong>{e.actorName}</strong> : null} {e.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Строка «иконка + текст» сетки доступа (две ячейки грида). */
function FragmentRow(p: { icon: string; text: string }): ReactElement {
  return (
    <>
      <Icon name={p.icon} size={18} />
      <span>{p.text}</span>
    </>
  );
}
