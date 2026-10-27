// W6.23 · Правая панель графика: «Сдача объекта» и панель этапа (design/Ремонт и стройка.dc.html :415–507).
import type { components } from '@ortus/api-client';
import type { StageIssue } from '@ortus/domain/schedule';
import { Icon, Status } from '@ortus/ui';
import { type ReactElement, useId, useState } from 'react';

import type { Chip, LogEntry, Summary } from './model.ts';
import { GANTT_TEXT as T } from './texts.ts';
import type { StagePanel } from './vm.ts';

type S = components['schemas'];

export const ChipView = ({ c }: { c: Chip }): ReactElement => (
  <Status tone={c.tone} icon={c.icon}>
    {c.label}
  </Status>
);

const TONE_ICON = { warn: 'warn', danger: 'danger' } as const;

function IssueButton({ i, onOpen }: { i: StageIssue; onOpen: (id: string) => void }): ReactElement {
  return (
    <button type="button" className="ox-gt-issue" onClick={() => onOpen(i.id)}>
      <span className="ox-gt-issue-icon" data-tone={TONE_ICON[i.tone]}>
        <Icon name={i.icon} size={20} />
      </span>
      <span>{i.text}</span>
    </button>
  );
}

export function IssueList({
  issues,
  onOpen,
}: {
  issues: StageIssue[];
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <>
      {issues.map((i) => (
        <IssueButton key={i.id + i.short} i={i} onOpen={onOpen} />
      ))}
    </>
  );
}

/** Форма нового базового плана по допсоглашению (без эталона: Q-W6.23-7). */
function BaselineForm(p: { busy: boolean; onSubmit: (agreementNo: number) => void }): ReactElement {
  const id = useId();
  const [no, setNo] = useState('');
  const n = Number(no);
  const ok = Number.isInteger(n) && n >= 1;
  return (
    <form
      className="ox-gt-baseline"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) p.onSubmit(n);
      }}
    >
      <strong>{T.baseline_form.title}</strong>
      <label htmlFor={id}>{T.baseline_form.label}</label>
      <input
        id={id}
        className="ox-gt-input"
        type="number"
        min={1}
        inputMode="numeric"
        value={no}
        onChange={(e) => setNo(e.target.value)}
      />
      <span className="ox-gt-hint">{T.baseline_form.hint}</span>
      <button type="submit" className="ox-gt-btn" disabled={!ok || p.busy}>
        {T.baseline_form.submit}
      </button>
    </form>
  );
}

export function SummaryPanel(p: {
  sum: Summary;
  fcLate: boolean;
  issues: StageIssue[];
  log: LogEntry[];
  holidays: string[];
  hasElectric: boolean;
  onOpen: (id: string) => void;
  canBaseline: boolean;
  busy: boolean;
  onBaseline: (agreementNo: number) => void;
}): ReactElement {
  const { sum } = p;
  const how = T.how.filter((_, i) => i !== 1 || p.hasElectric);
  return (
    <>
      <div className="ox-gt-card">
        <h3 className="ox-gt-h3">{T.summary.title}</h3>
        <div className="ox-gt-grid2">
          <div className="ox-gt-col">
            <span className="ox-gt-label">{T.summary.due}</span>
            <strong className="ox-gt-big">{sum.due}</strong>
          </div>
          <div className="ox-gt-col">
            <span className="ox-gt-label">{T.summary.forecast}</span>
            <strong className="ox-gt-big" data-late={p.fcLate}>
              {sum.forecast}
            </strong>
          </div>
        </div>
        <span className="ox-gt-self">
          <ChipView c={sum.chip} />
        </span>
        <div className="ox-gt-col">
          <span className="ox-gt-label">{T.summary.critical}</span>
          <span className="ox-gt-text">{sum.critical.join(' → ')}</span>
        </div>
        {sum.late ? (
          <>
            {sum.why ? <p className="ox-gt-text">{sum.why}</p> : null}
            <div className="ox-gt-col">
              <span className="ox-gt-strong">{sum.recoverTitle}</span>
              <div className="ox-gt-pills">
                {sum.recover.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="ox-gt-pill"
                    onClick={() => p.onOpen(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
        {p.canBaseline ? <BaselineForm busy={p.busy} onSubmit={p.onBaseline} /> : null}
      </div>
      {p.issues.length ? (
        <div className="ox-gt-card ox-gt-flush">
          <h3 className="ox-gt-h3 ox-gt-pad">{T.summary.attention}</h3>
          <IssueList issues={p.issues} onOpen={p.onOpen} />
        </div>
      ) : null}
      <div className="ox-gt-card">
        <h3 className="ox-gt-h3">{T.summary.history}</h3>
        <div>
          {p.log.map((e) => (
            <div key={e.id} className="ox-gt-log">
              <span className="ox-gt-label">
                {e.at} · {e.who}
              </span>
              <span>{e.text}</span>
              {e.reason ? (
                <span className="ox-gt-reason">
                  {T.summary.reason.replace('{reason}', e.reason)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="ox-gt-card">
        <h3 className="ox-gt-h3">{T.summary.how}</h3>
        <ul className="ox-gt-how">
          {how.map((t) => (
            <li key={t}>
              {t.replace('{holidays}', p.holidays.map((h) => ', ' + h + ' — выходной').join(''))}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function Stepper(p: {
  label: string;
  value: string;
  minus: { label: string; icon: string; off: boolean; onPress: () => void };
  plus: { label: string; icon: string; onPress: () => void };
  wide?: boolean;
}): ReactElement {
  return (
    <div className="ox-gt-step">
      <span className="ox-gt-step-label">{p.label}</span>
      <div className="ox-gt-step-ctl">
        <button
          type="button"
          className="ox-gt-sq"
          aria-label={p.minus.label}
          disabled={p.minus.off}
          onClick={p.minus.onPress}
        >
          <Icon name={p.minus.icon} size={20} />
        </button>
        <span className="ox-gt-step-val">{p.value}</span>
        <button
          type="button"
          className="ox-gt-sq"
          aria-label={p.plus.label}
          onClick={p.plus.onPress}
        >
          <Icon name={p.plus.icon} size={20} />
        </button>
      </div>
    </div>
  );
}

export function StageView(p: {
  panel: StagePanel;
  canShift: boolean;
  members: readonly S['Member'][];
  estimate: string;
  calc: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onStart: (delta: number) => void;
  onDuration: (delta: number) => void;
  onLag: (fromId: string, toId: string, delta: number) => void;
  onWho: (value: string) => void;
  whoBusy: boolean;
}): ReactElement {
  const { panel: x } = p;
  const whoId = useId();
  const current = p.members.find((m) => m.displayName === x.who);
  const options = [
    { value: '', label: T.stage.noWho },
    ...(x.who && !current ? [{ value: '__keep', label: x.who }] : []),
    ...p.members.map((m) => ({ value: m.id, label: m.displayName })),
  ];
  return (
    <div className="ox-gt-card ox-gt-flush">
      <div className="ox-gt-back">
        <button type="button" className="ox-gt-linkbtn" onClick={p.onClose}>
          <Icon name="arrow_back" size={18} />
          {T.stage.back}
        </button>
      </div>
      <div className="ox-gt-sec ox-gt-sec-top">
        <h3 className="ox-gt-h3 ox-gt-h3-lg">{x.name}</h3>
        <div className="ox-gt-pills">
          {x.chips.map((c) => (
            <ChipView key={c.label} c={c} />
          ))}
        </div>
      </div>
      <div className="ox-gt-sec">
        <span className="ox-gt-cap">{T.stage.terms}</span>
        <div className="ox-gt-col">
          <strong className="ox-gt-num">{x.dates}</strong>
          <span className="ox-gt-label">{x.durText}</span>
        </div>
        <div className="ox-gt-row">
          <span className="ox-gt-num">{x.baseText}</span>
          <ChipView c={x.varChip} />
        </div>
        {x.progText ? <span className="ox-gt-note">{x.progText}</span> : null}
        {x.canStart && p.canShift ? (
          <>
            <Stepper
              label={T.stage.start}
              value={x.startText}
              minus={{
                label: T.stage.startMinus,
                icon: 'chevron_left',
                off: x.startMinusOff,
                onPress: () => p.onStart(-1),
              }}
              plus={{
                label: T.stage.startPlus,
                icon: 'chevron_right',
                onPress: () => p.onStart(1),
              }}
            />
            {x.startHint ? <span className="ox-gt-hint">{x.startHint}</span> : null}
          </>
        ) : null}
        {x.canStart && !p.canShift ? (
          <span className="ox-gt-note">
            {T.stage.start}: {x.startText}
          </span>
        ) : null}
        {x.fixed ? <span className="ox-gt-hint">{x.fixed}</span> : null}
        {x.canDur && p.canShift ? (
          <>
            <Stepper
              label={T.stage.duration}
              value={x.durVal}
              minus={{
                label: T.stage.durMinus,
                icon: 'remove',
                off: x.durMinusOff,
                onPress: () => p.onDuration(-1),
              }}
              plus={{ label: T.stage.durPlus, icon: 'add', onPress: () => p.onDuration(1) }}
            />
            {x.durHint ? <span className="ox-gt-hint">{x.durHint}</span> : null}
          </>
        ) : null}
        {x.ms ? <span className="ox-gt-hint">{T.stage.msHint}</span> : null}
      </div>
      <div className="ox-gt-sec">
        <span className="ox-gt-cap">{T.stage.links}</span>
        {x.preds.map((l) => (
          <div key={l.fromId} className="ox-gt-pred">
            <div className="ox-gt-col ox-gt-grow">
              <button
                type="button"
                className="ox-gt-linkbtn ox-gt-start"
                onClick={() => p.onOpen(l.fromId)}
              >
                {T.stage.after.replace('{name}', l.name)}
              </button>
              <span className="ox-gt-hint">{l.lag}</span>
            </div>
            {l.canEdit && p.canShift ? (
              <div className="ox-gt-pair">
                <button
                  type="button"
                  className="ox-gt-sq ox-gt-sq-sm"
                  aria-label={T.stage.lagMinus}
                  disabled={l.minusOff}
                  onClick={() => p.onLag(l.fromId, l.toId, -1)}
                >
                  <Icon name="remove" size={18} />
                </button>
                <button
                  type="button"
                  className="ox-gt-sq ox-gt-sq-sm"
                  aria-label={T.stage.lagPlus}
                  disabled={l.plusOff}
                  onClick={() => p.onLag(l.fromId, l.toId, 1)}
                >
                  <Icon name="add" size={18} />
                </button>
              </div>
            ) : null}
          </div>
        ))}
        {x.preds.length ? null : <span className="ox-gt-note">{T.stage.first}</span>}
        {x.succs.length ? (
          <div className="ox-gt-row">
            <span className="ox-gt-label">{T.stage.next}</span>
            {x.succs.map((q) => (
              <button
                key={q.id}
                type="button"
                className="ox-gt-pill ox-gt-pill-sm"
                onClick={() => p.onOpen(q.id)}
              >
                {q.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {x.hasWho ? (
        <div className="ox-gt-sec">
          <label htmlFor={whoId} className="ox-gt-cap">
            {T.stage.who}
          </label>
          <select
            id={whoId}
            className="ox-gt-select"
            value={x.who && !current ? '__keep' : (current?.id ?? '')}
            disabled={!p.canShift || p.whoBusy}
            onChange={(e) => p.onWho(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {x.conflict ? (
            <div className="ox-gt-conflict">
              <Icon name="event_busy" size={18} />
              <span>{x.conflict}</span>
            </div>
          ) : null}
          <span className="ox-gt-hint">{x.whoNote || x.needText}</span>
        </div>
      ) : null}
      {x.materials.length ? (
        <div className="ox-gt-sec">
          <span className="ox-gt-cap">{T.stage.mats}</span>
          {x.materials.map((m) => (
            <div key={m} className="ox-gt-col">
              <ChipView
                c={{ label: 'Материала нет на объекте', tone: 'warn', icon: 'inventory_2' }}
              />
              <span className="ox-gt-hint">{m}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="ox-gt-sec ox-gt-sec-last">
        <span className="ox-gt-cap">{T.stage.estimate}</span>
        <span className="ox-gt-text">{p.estimate}</span>
        <span className="ox-gt-hint">{p.calc}</span>
      </div>
    </div>
  );
}
