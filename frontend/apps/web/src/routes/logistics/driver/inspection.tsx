// W2.22 · Блок осмотра (:731–779; S2-04, S2-05, S2-09): пять фото, пробег, топливо, чек-лист по версии сервера,
// дефекты (критический — только перед выездом), комментарий для менеджера при сдаче. Черновик — у страницы.
import { int } from '@ortus/domain';
import { DEFECT_ZONES, FUEL } from '@ortus/domain/modules';
import { format, logisticsDriver as L, shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useId, useState } from 'react';

import {
  type DefectDraft,
  type Draft,
  type FuelKey,
  inspectionSub,
  type InspectionKind,
  odoHint,
  photoCount,
  photoView,
  type SideKey,
  SIDES,
} from './model.ts';
import { PhotoSlot } from './parts.tsx';
import { DRIVER_TEXT as T } from './texts.ts';

const I = L.inspection;

export interface InspectionProps {
  kind: InspectionKind;
  model: string;
  plate: string;
  draft: Draft;
  update: (patch: (d: Draft) => Draft) => void;
  items: readonly { key: string; label: string }[];
  minOdo: number;
  onPhoto: (side: SideKey) => void;
  onRetry: (side: SideKey) => void;
}

function DefectForm({
  kind,
  onCancel,
  onAdd,
}: {
  kind: InspectionKind;
  onCancel: () => void;
  onAdd: (d: DefectDraft) => void;
}): ReactElement {
  const [zone, setZone] = useState(DEFECT_ZONES[0] ?? '');
  const [text, setText] = useState('');
  const [critical, setCritical] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const errId = useId();
  return (
    <div className="ox-dr-form">
      <label className="ox-dr-label">
        {I.where}
        <select
          className="ox-dr-input"
          data-thin
          value={zone}
          onChange={(e) => setZone(e.target.value)}
        >
          {DEFECT_ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
      <label className="ox-dr-label">
        {I.description}
        <textarea
          rows={2}
          className="ox-dr-input ox-dr-textarea"
          value={text}
          aria-invalid={err ? 'true' : 'false'}
          aria-describedby={err ? errId : undefined}
          placeholder={I.descriptionPlaceholder}
          onChange={(e) => {
            setText(e.target.value);
            setErr(null);
          }}
        />
        {err ? (
          <span id={errId} role="alert" className="ox-dr-error">
            {err}
          </span>
        ) : null}
      </label>
      {kind === 'dep' ? (
        <label className="ox-dr-critical-check">
          <input
            type="checkbox"
            checked={critical}
            onChange={(e) => setCritical(e.target.checked)}
          />
          <span>{I.critical}</span>
        </label>
      ) : null}
      <div className="ox-dr-form-actions">
        <button type="button" className="ox-dr-btn" onClick={onCancel}>
          {shell.modal.cancel}
        </button>
        <button
          type="button"
          className="ox-dr-btn"
          data-kind="primary"
          onClick={() => {
            if (!text.trim()) {
              setErr(I.defectRequired);
              return;
            }
            onAdd({ zone, text: text.trim(), critical: kind === 'dep' && critical });
          }}
        >
          {I.add}
        </button>
      </div>
    </div>
  );
}

export function Inspection(p: InspectionProps): ReactElement {
  const { draft: d, update, kind, minOdo } = p;
  const [defectOpen, setDefectOpen] = useState(false);
  const hint = odoHint(d.odometer, kind, minOdo);
  const odoId = useId();
  const sub = inspectionSub(kind, p.model, p.plate);
  return (
    <div className="ox-dr-card ox-dr-insp">
      <div>
        <h2 className="ox-dr-h2">{kind === 'dep' ? I.departure : I.return}</h2>
        <span className="ox-dr-sub">{sub}</span>
      </div>
      <fieldset className="ox-dr-fieldset">
        <legend className="ox-dr-legend">{format(I.photos, { n: String(photoCount(d)) })}</legend>
        <div className="ox-dr-slots">
          {SIDES.map((s) => (
            <PhotoSlot
              key={s.key}
              label={s.label}
              view={photoView(d.photos[s.key], s.label)}
              retryLabel={I.retry}
              onTap={() => p.onPhoto(s.key)}
              onRetry={() => p.onRetry(s.key)}
            />
          ))}
        </div>
        <span className="ox-dr-photo-hint">{T.photoHint}</span>
      </fieldset>
      <div className="ox-dr-fields">
        <label className="ox-dr-label">
          {I.odometer}
          <input
            className="ox-dr-input"
            data-num
            inputMode="numeric"
            value={d.odometer}
            aria-invalid={hint.error ? 'true' : 'false'}
            aria-describedby={odoId}
            placeholder={int(minOdo)}
            onChange={(e) => {
              const odometer = e.target.value.replace(/[^\d\s]/g, '');
              update((x) => ({ ...x, odometer }));
            }}
          />
          <span id={odoId} className="ox-dr-odo-hint" data-error={hint.error || undefined}>
            {hint.text}
          </span>
        </label>
        <fieldset className="ox-dr-fieldset ox-dr-fuel">
          <legend className="ox-dr-legend-sm">{I.fuel}</legend>
          <div className="ox-dr-toggles">
            {FUEL.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className="ox-dr-toggle"
                aria-pressed={d.fuel === k ? 'true' : 'false'}
                onClick={() => update((x) => ({ ...x, fuel: k as FuelKey }))}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <fieldset className="ox-dr-fieldset" style={{ gap: 6 }}>
        <legend className="ox-dr-legend" style={{ marginBottom: 6 }}>
          {I.checklist}
        </legend>
        {p.items.map((c) => {
          const on = !!d.checks[c.key];
          return (
            <label key={c.key} className="ox-dr-check" data-checked={on || undefined}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => {
                  const v = e.target.checked;
                  update((x) => ({ ...x, checks: { ...x.checks, [c.key]: v } }));
                }}
              />
              <span>{c.label}</span>
            </label>
          );
        })}
      </fieldset>
      <div className="ox-dr-col" style={{ gap: 8 }}>
        <div className="ox-dr-defects-head">
          <span style={{ fontWeight: 600 }}>{I.defects}</span>
          {defectOpen ? null : (
            <button type="button" className="ox-dr-add" onClick={() => setDefectOpen(true)}>
              <Icon name="add" size={20} />
              {I.addDefect}
            </button>
          )}
        </div>
        {!d.defects.length && !defectOpen ? <span className="ox-dr-sub">{I.noDefects}</span> : null}
        {d.defects.map((x, i) => (
          <div
            key={`${x.zone}-${x.text}-${String(i)}`}
            className="ox-dr-defect-row"
            data-critical={x.critical || undefined}
          >
            <Icon name={x.critical ? 'report' : 'build'} size={20} />
            <div className="ox-dr-defect-text">
              <div className="ox-dr-defect-zone">{x.zone}</div>
              <div style={{ fontSize: 13, textWrap: 'pretty' }}>{x.text}</div>
              {x.critical ? <span className="ox-dr-critical">{I.criticalChip}</span> : null}
            </div>
            <button
              type="button"
              className="ox-dr-icon-btn"
              aria-label={I.removeDefect}
              onClick={() =>
                update((v) => ({ ...v, defects: v.defects.filter((_, j) => j !== i) }))
              }
            >
              <Icon name="delete" size={20} />
            </button>
          </div>
        ))}
        {defectOpen ? (
          <DefectForm
            kind={kind}
            onCancel={() => setDefectOpen(false)}
            onAdd={(x) => {
              update((v) => ({ ...v, defects: [...v.defects, x] }));
              setDefectOpen(false);
            }}
          />
        ) : null}
      </div>
      {kind === 'ret' ? (
        <label className="ox-dr-label">
          {I.commentForManager}
          <textarea
            rows={2}
            className="ox-dr-input ox-dr-textarea"
            data-thin
            value={d.comment}
            placeholder={shell.form.optional}
            onChange={(e) => {
              const comment = e.target.value;
              update((x) => ({ ...x, comment }));
            }}
          />
        </label>
      ) : null}
    </div>
  );
}
