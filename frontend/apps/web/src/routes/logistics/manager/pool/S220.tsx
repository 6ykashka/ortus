// W2.73 · Блоки S2-20 «Машина для временного водителя» (D-35; эталон design-2026-10-19b · «Временный водитель -
// варианты.dc.html»): 1a — группа «Машина» диалога «Запросить водителя» (:152–181), 1f — «Машины рейса» и «Журнал»
// карточки перевода у логиста (:431–460). Модель — vehicle.ts, стили — pool.css (раздел S2-20).
import { format, logisticsManager } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type KeyboardEvent, type ReactElement, useId, useRef } from 'react';

import type { Chip } from './model.ts';
import type { CarBlock, CarView, Mode, SumLine, TransferView } from './vehicle.ts';

const R = logisticsManager.request;
const F = logisticsManager.pool.transfer;

/** Иконка размера эталона вне шкалы Icon @ortus/ui (17 px строки «Подходит рейсу», :161). */
function Glyph({ name, size }: { name: string; size: number }): ReactElement {
  return (
    <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: size }}>
      {name}
    </span>
  );
}

function Mono({ children }: { children: string }): ReactElement {
  return <span className="ox-pl-mono">{children}</span>;
}

export function ChipView({ chip }: { chip: Chip }): ReactElement {
  return (
    <span className="ox-pl-chip" data-tone={chip.tone}>
      <Icon name={chip.icon} size={15} />
      {chip.label}
    </span>
  );
}

function Dot({ on, bad }: { on: boolean; bad?: boolean }): ReactElement {
  return (
    <span className="ox-pl-dot" data-on={on ? '' : undefined} data-bad={bad ? '' : undefined}>
      <span />
    </span>
  );
}

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Группа «Машина» (:152–176): «Едет на своей обычной» / «Ставим нашу машину», галочка «Можно взять свою обычную».
 * Радиогруппа APG: одна Tab-остановка на отмеченном варианте, стрелки переключают вариант и переносят фокус. Клик или
 * выбор в поле машины варианта 2 включает «Ставим нашу машину» (onHost эталона — на весь блок, :165, :562).
 */
export function CarChoice(p: {
  block: CarBlock;
  view: CarView;
  hostId: string | null;
  onMode: (m: Mode) => void;
  onHost: (id: string) => void;
  onChoice: () => void;
}): ReactElement {
  const id = useId();
  const homeRef = useRef<HTMLButtonElement>(null);
  const hostRef = useRef<HTMLButtonElement>(null);
  const { block, view } = p;
  const u = block.usual;
  const host = block.hosts.find((h) => h.id === p.hostId) ?? block.hosts[0];
  const toHost = (): void => {
    if (view.homeOn) p.onMode('host');
  };
  /** Стрелка на варианте: другой вариант отмечен и в фокусе (вариантов два — любая стрелка переключает). */
  const arrow = (e: KeyboardEvent<HTMLButtonElement>, to: Mode): void => {
    if (!u || !ARROWS.has(e.key)) return;
    e.preventDefault();
    if (to === 'home') {
      p.onMode('home');
      homeRef.current?.focus();
    } else {
      toHost();
      hostRef.current?.focus();
    }
  };
  return (
    <div role="radiogroup" aria-labelledby={`${id}-car`} className="ox-pl-cars">
      <span id={`${id}-car`} className="ox-pl-cars-title">
        {R.vehicle}
      </span>
      {u ? (
        <div
          className="ox-pl-car"
          data-on={view.homeOn ? '' : undefined}
          data-bad={view.homeOn && !u.fits ? '' : undefined}
          onClick={() => p.onMode('home')}
        >
          <button
            ref={homeRef}
            type="button"
            role="radio"
            aria-checked={view.homeOn}
            tabIndex={view.homeOn ? 0 : -1}
            className="ox-pl-car-radio"
            onKeyDown={(e) => arrow(e, 'host')}
          >
            <Dot on={view.homeOn} bad={!u.fits} />
            <strong>{R.home}</strong>
          </button>
          <span className="ox-pl-car-line">
            {u.model} · <Mono>{u.plate}</Mono> · {u.firm}
          </span>
          <span className="ox-pl-car-muted">{u.specs}</span>
          <span className="ox-pl-car-fit" data-ok={u.fits ? '' : undefined}>
            <Glyph name={u.fits ? 'check_circle' : 'cancel'} size={17} />
            {u.fitText}
          </span>
          <span className="ox-pl-car-small">{u.approve}</span>
        </div>
      ) : null}
      <div
        className="ox-pl-car ox-pl-car-host"
        data-on={view.hostOn ? '' : undefined}
        onClick={toHost}
      >
        <button
          ref={hostRef}
          type="button"
          role="radio"
          aria-checked={view.hostOn}
          tabIndex={view.homeOn ? -1 : 0}
          id={`${id}-host`}
          className="ox-pl-car-radio"
          onKeyDown={(e) => arrow(e, 'home')}
        >
          <Dot on={view.hostOn} />
          <strong>{R.host}</strong>
        </button>
        {host ? (
          <span className="ox-pl-select">
            <Icon name={host.cold ? 'ac_unit' : 'local_shipping'} size={20} />
            <span className="ox-pl-select-value">
              {host.model} · <Mono>{host.plate}</Mono>
            </span>
            <span className="ox-pl-select-fit">{R.hostFits}</span>
            <Icon name="expand_more" size={20} />
            <select
              aria-labelledby={`${id}-host`}
              value={host.id}
              onChange={(e) => {
                p.onHost(e.target.value);
                toHost();
              }}
            >
              {block.hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {`${h.model} · ${h.plate}`}
                </option>
              ))}
            </select>
          </span>
        ) : null}
        <span className="ox-pl-car-small ox-pl-car-pad">{block.hostHint}</span>
        {u && host ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={view.choiceOn}
            aria-disabled={view.choiceDisabled}
            className="ox-pl-choice"
            onClick={(e) => {
              e.stopPropagation();
              if (!view.choiceDisabled) p.onChoice();
            }}
          >
            <span className="ox-pl-box" data-on={view.choiceOn ? '' : undefined}>
              {view.choiceOn ? <Icon name="check" size={16} /> : null}
            </span>
            <span className="ox-pl-choice-text">
              <span className="ox-pl-choice-title">{R.choice}</span>
              <span className="ox-pl-car-small">{view.choiceHint}</span>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** «Что произойдёт после одобрения» (:178–181). */
export function CarSummary({ lines }: { lines: readonly SumLine[] }): ReactElement {
  return (
    <div className="ox-pl-sum">
      <strong>{R.after}</strong>
      {lines.map((s) => (
        <div key={s.text} className="ox-pl-sum-line" data-danger={s.danger ? '' : undefined}>
          <Icon name={s.icon} size={18} />
          <span>{s.text}</span>
        </div>
      ))}
    </div>
  );
}

/** «Машины рейса», «Журнал», сноска (1f :431–460); «Оставить …» — до выбора (no-reference в 1f, подпись 1g). */
export function TransferBlock(p: {
  view: TransferView;
  onAssign: (() => void) | null;
  onKeep: (() => void) | null;
  busy: boolean;
}): ReactElement {
  const { view } = p;
  return (
    <>
      <dl className="ox-pl-dl">
        <div className="ox-pl-dl-row">
          <dt>{R.trip}</dt>
          <dd>{view.trip}</dd>
        </div>
        <div className="ox-pl-dl-row">
          <dt>{R.access}</dt>
          <dd>{view.access}</dd>
        </div>
      </dl>
      <div className="ox-pl-block">
        <strong className="ox-pl-block-title">{F.vehicles}</strong>
        {view.cars.map((c) => (
          <div key={c.key} className="ox-pl-trip-car">
            <Icon name="ac_unit" size={22} />
            <div className="ox-pl-trip-car-who">
              <span className="ox-pl-trip-car-name">
                {c.name} · <Mono>{c.plate}</Mono>
              </span>
              <span className="ox-pl-car-small">{c.firm}</span>
            </div>
            <ChipView chip={c.chip} />
          </div>
        ))}
        {view.none ? (
          <div className="ox-pl-no-car">
            <Icon name="no_crash" size={22} />
            <span>{view.none}</span>
            {p.onAssign ? (
              <button
                type="button"
                className="ox-pl-btn ox-pl-hit"
                data-variant="primary"
                onClick={p.onAssign}
              >
                {F.assignVehicle}
              </button>
            ) : null}
          </div>
        ) : null}
        {view.keep && p.onKeep ? (
          <button
            type="button"
            className="ox-pl-btn ox-pl-hit ox-pl-keep"
            disabled={p.busy}
            onClick={p.onKeep}
          >
            {view.keep.label}
          </button>
        ) : null}
      </div>
      {view.journal.length ? (
        <div className="ox-pl-block ox-pl-block-tight">
          <strong className="ox-pl-block-title">{F.journal}</strong>
          <ol className="ox-pl-journal">
            {view.journal.map((j, i) => (
              <li key={`${i}-${j.x}`}>
                <span className="ox-pl-mono ox-pl-journal-t">{j.t}</span>
                <span>{j.x}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {view.note ? (
        <div className="ox-pl-dlg-note">
          <Icon name="info" size={18} />
          <span>{view.note}</span>
        </div>
      ) : null}
    </>
  );
}

/** «Олег Тарасов · Водитель #104» (1b :199) — имя видно только фирме водителя. */
export const whoOf = (name: string | undefined, code: string): string =>
  name ? format(logisticsManager.pool.incoming.who, { name, driver: code }) : code;
