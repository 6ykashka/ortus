// W6.20 · Вкладка «Работы» («Ортус CRM.dc.html» :2081–2123, repairCardVM :4356): «Объёмы работ», форма «Отметка за сегодня»
// (прораб своего объекта), список отметок с «Принять объём» (`repairs.work_logs.review`) и «Допработы» (форма прораба,
// чипы статусов, «Оценить в смете» офису). Факт — только принятые отметки; фото — файлы `repair_evidence`.
import type { components } from '@ortus/api-client';
import { CHANGE_UNITS } from '@ortus/domain/modules';
import { Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useRef, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { problemText, useBusy, useRun } from '../../shell/run.tsx';
import { useToast } from '../../shell/toast.tsx';
import {
  acceptWorkLog,
  afterRepairChange,
  proposeChange,
  submitWorkLog,
  uploadEvidence,
  useChangeOrders,
  useProjectStock,
} from './api.ts';
import {
  type Chip,
  dayMonth,
  parseQty,
  qtyText,
  unitLabel,
  validateChange,
  validateWorkLog,
} from './model.ts';
import { ChipView, serverText, todayIso } from './parts.tsx';
import { REPAIR_TEXT as T } from './texts.ts';

type S = components['schemas'];

export type AcceptFn = (log: Pick<S['WorkLog'], 'id' | 'revision'>) => Promise<void>;

/** Приёмка объёма: тост успеха; «Отметка уже обработана» (409) — текстом сервера; данные перечитываются. */
export function useAccept(tenantId: string): AcceptFn {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  return async (log) => {
    try {
      await run(
        `repair-accept:${log.id}`,
        () => acceptWorkLog(api, tenantId, log),
        T.works.accepted,
        { quiet: ['invalid_transition'] },
      );
    } catch (e) {
      const text = serverText(e);
      if (text) toast(text, 'error');
    } finally {
      await afterRepairChange(qc, tenantId);
    }
  };
}

const QUIET: readonly string[] = ['validation_failed', 'invalid_transition', 'forbidden_action'];

const LOG_CHIP: Record<S['WorkLog']['status'], Chip> = {
  accepted: { label: T.works.logChips.accepted, tone: 'ok', icon: 'check_circle' },
  submitted: { label: T.works.logChips.submitted, tone: 'warn', icon: 'pending' },
  rejected: { label: T.works.logChips.rejected, tone: 'neutral', icon: 'undo' },
};

const CHANGE_CHIP: Record<S['ChangeOrder']['status'], Chip> = {
  proposed: { label: 'Ждёт оценки офиса', tone: 'warn', icon: 'pending' },
  priced: { label: 'Оценивается в смете', tone: 'info', icon: 'edit_note' },
  sent: { label: 'Допсоглашение у заказчика', tone: 'warn', icon: 'sms' },
  signed: { label: 'Подписано заказчиком', tone: 'ok', icon: 'verified' },
  rejected: { label: 'Отклонено', tone: 'neutral', icon: 'block' },
};

const UNIT_OF_LABEL: Record<string, S['RepairUnit']> = {
  шт: 'piece',
  м: 'm',
  'м²': 'm2',
  компл: 'set',
};

/** Выбор фото: id загруженных файлов; ход загрузки и ошибка — в тексте формы. */
function usePhotos(tenantId: string, projectId: string) {
  const api = useApi();
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const id = await uploadEvidence(api, tenantId, projectId, file);
      setIds((v) => [...v, id]);
    } catch (e) {
      setError(T.works.photoFailed.replace('{error}', serverText(e) ?? problemText(e)));
    } finally {
      setBusy(false);
    }
  };
  return { ids, busy, error, add, reset: () => setIds([]) };
}

function PhotoButton(p: {
  label: string;
  note: string;
  busy: boolean;
  disabled: boolean;
  onFile: (f: File | undefined) => void;
}): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="ox-rp-photo-row">
      <button
        type="button"
        className="ox-rp-btn"
        disabled={p.disabled || p.busy}
        onClick={() => input.current?.click()}
      >
        <Icon name="add_a_photo" size={18} />
        {p.label}
      </button>
      <input
        ref={input}
        className="ox-rp-file"
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          p.onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <span>{p.busy ? T.works.uploading : p.note}</span>
    </div>
  );
}

interface FormProps {
  tenantId: string;
  ov: S['RepairProjectOverview'];
  canStock: boolean;
  readOnly: boolean;
}

function WorkLogForm({ tenantId, ov, canStock, readOnly }: FormProps): ReactElement {
  const project = ov.project;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const stock = useProjectStock(tenantId, project.id, canStock);
  const photos = usePhotos(tenantId, project.id);
  const first = (ov.works.find((w) => Number(w.fact) < Number(w.plan)) ?? ov.works[0])?.id ?? '';
  const [work, setWork] = useState('');
  const [volume, setVolume] = useState('');
  const [material, setMaterial] = useState('');
  const [matQty, setMatQty] = useState('');
  const [crew, setCrew] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const workId = ov.works.some((w) => w.id === work) ? work : first;
  const key = `repair-log:${project.id}`;
  const busy = useBusy(key);
  const workers = ov.people.crew.filter((w) => w.status === 'active');
  const materials = stock.data ?? [];

  const submit = async (): Promise<void> => {
    const draft = {
      work: workId,
      volume,
      crew,
      photos: photos.ids.length,
      material,
      materialQty: matQty,
    };
    const problem = validateWorkLog(draft);
    if (problem) {
      setErr(problem);
      return;
    }
    const w = ov.works.find((x) => x.id === workId);
    if (!w) return;
    setErr(null);
    const qty = parseQty(matQty);
    try {
      await run(
        key,
        () =>
          submitWorkLog(api, tenantId, {
            projectId: project.id,
            workDate: todayIso(),
            timeZone: 'Europe/Moscow',
            lines: [{ workId: w.id, quantity: String(parseQty(volume)), unit: w.unit }],
            evidenceFileIds: photos.ids,
            crewWorkerIds: crew,
            ...(material && qty > 0
              ? { materials: [{ priceItemId: material, quantity: String(qty) }] }
              : {}),
          }),
        T.works.submitted,
        { quiet: QUIET },
      );
      setWork('');
      setVolume('');
      setMaterial('');
      setMatQty('');
      setCrew([]);
      photos.reset();
    } catch (e) {
      setErr(serverText(e) ?? problemText(e));
    } finally {
      await afterRepairChange(qc, tenantId);
    }
  };

  return (
    <div className="ox-rp-panel ox-rp-form">
      <h2 className="ox-rp-h2">{T.works.formTitle}</h2>
      <div className="ox-rp-fields">
        <label className="ox-rp-field" data-grow="2">
          {T.works.work}
          <select value={workId} onChange={(e) => setWork(e.target.value)}>
            {ov.works.map((w) => (
              <option key={w.id} value={w.id}>
                {T.works.workLeft
                  .replace('{name}', w.name)
                  .replace('{left}', qtyText(Math.max(0, Number(w.plan) - Number(w.fact))))
                  .replace('{unit}', unitLabel(w.unit))}
              </option>
            ))}
          </select>
        </label>
        <label className="ox-rp-field">
          {T.works.volume}
          <input inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} />
        </label>
        <label className="ox-rp-field">
          {T.works.material}
          <select value={material} onChange={(e) => setMaterial(e.target.value)}>
            <option value="">{T.works.noMaterial}</option>
            {materials.map((m) => (
              <option key={m.priceItemId} value={m.priceItemId}>
                {T.works.materialLabel
                  .replace('{name}', m.name)
                  .replace('{qty}', qtyText(m.quantity))
                  .replace('{unit}', unitLabel(m.unit))}
              </option>
            ))}
          </select>
        </label>
        {material ? (
          <label className="ox-rp-field">
            {T.works.materialQty}
            <input inputMode="decimal" value={matQty} onChange={(e) => setMatQty(e.target.value)} />
          </label>
        ) : null}
      </div>
      <fieldset className="ox-rp-crew">
        <legend>{T.works.crew}</legend>
        <div className="ox-rp-crew-list">
          {workers.map((w) => {
            const on = crew.includes(w.id);
            return (
              <label key={w.id} className="ox-rp-crew-item" data-on={on ? '' : undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setCrew((c) => (on ? c.filter((x) => x !== w.id) : [...c, w.id]))}
                />
                {w.displayName} <small>{w.trade}</small>
              </label>
            );
          })}
        </div>
      </fieldset>
      <PhotoButton
        label={T.works.addPhoto}
        note={T.works.photos.replace('{n}', String(photos.ids.length))}
        busy={photos.busy}
        disabled={readOnly}
        onFile={(f) => void photos.add(f)}
      />
      {photos.error ? (
        <span role="alert" className="ox-rp-error">
          {photos.error}
        </span>
      ) : null}
      {err ? (
        <span role="alert" className="ox-rp-error">
          {err}
        </span>
      ) : null}
      <button
        type="button"
        className="ox-rp-btn"
        data-variant="primary"
        data-size="lg"
        disabled={busy || readOnly || photos.busy}
        onClick={() => void submit()}
      >
        {T.works.submit}
      </button>
    </div>
  );
}

function LogRow(p: {
  log: S['WorkLog'];
  ov: S['RepairProjectOverview'];
  stock: readonly S['ProjectStockItem'][];
  canReview: boolean;
  readOnly: boolean;
  accept: AcceptFn;
}): ReactElement {
  const { log, ov } = p;
  const busy = useBusy(`repair-accept:${log.id}`);
  const line = log.lines[0];
  const work = ov.works.find((w) => w.id === line?.workId);
  const crew = (log.crewWorkerIds ?? [])
    .map((id) => ov.people.crew.find((w) => w.id === id)?.displayName)
    .filter(Boolean)
    .join(', ');
  const mats = (log.materials ?? [])
    .map((m) => {
      const s = p.stock.find((x) => x.priceItemId === m.priceItemId);
      return s ? `${s.name} ${qtyText(m.quantity)} ${unitLabel(s.unit)}` : '';
    })
    .filter(Boolean)
    .join(', ');
  const text = [
    `${dayMonth(log.createdAt)} · ${work?.name ?? ''} ${qtyText(line?.quantity ?? 0)} ${line ? unitLabel(line.unit) : ''}`.trim(),
    crew,
    mats,
    `фото: ${String(log.evidenceFileIds.length)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="ox-rp-log">
      <span className="ox-rp-log-id">{log.number}</span>
      <span className="ox-rp-log-text">{text}</span>
      <ChipView chip={LOG_CHIP[log.status]} />
      {p.canReview && log.status === 'submitted' ? (
        <button
          type="button"
          className="ox-rp-btn"
          data-variant="outline"
          data-size="sm"
          disabled={busy || p.readOnly}
          onClick={() => void p.accept(log)}
        >
          {T.works.accept}
        </button>
      ) : null}
    </div>
  );
}

function ChangeForm({ tenantId, ov, readOnly }: Omit<FormProps, 'canStock'>): ReactElement {
  const project = ov.project;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const photos = usePhotos(tenantId, project.id);
  const [title, setTitle] = useState('');
  const [volume, setVolume] = useState('');
  const [unit, setUnit] = useState('шт');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const key = `repair-change:${project.id}`;
  const busy = useBusy(key);

  const submit = async (): Promise<void> => {
    const problem = validateChange({ title, volume, photos: photos.ids.length });
    if (problem) {
      setErr(problem);
      return;
    }
    setErr(null);
    try {
      await run(
        key,
        () =>
          proposeChange(api, tenantId, project.id, {
            title: title.trim(),
            quantity: String(parseQty(volume)),
            unit: UNIT_OF_LABEL[unit] ?? 'piece',
            photoFileIds: photos.ids,
            ...(note.trim() ? { note: note.trim() } : {}),
          }),
        T.changes.submitted,
        { quiet: QUIET },
      );
      setTitle('');
      setVolume('');
      setNote('');
      photos.reset();
    } catch (e) {
      setErr(serverText(e) ?? problemText(e));
    } finally {
      await afterRepairChange(qc, tenantId);
    }
  };

  return (
    <div className="ox-rp-co-form">
      <div className="ox-rp-fields">
        <label className="ox-rp-field" data-grow="3">
          {T.changes.what}
          <input
            value={title}
            placeholder={T.changes.whatPlaceholder}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="ox-rp-field">
          {T.changes.volume}
          <input inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} />
        </label>
        <label className="ox-rp-field">
          {T.changes.unit}
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {CHANGE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="ox-rp-field">
        {T.changes.note}
        <textarea
          rows={2}
          value={note}
          placeholder={T.changes.notePlaceholder}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <PhotoButton
        label={T.changes.addPhoto}
        note={T.changes.photos.replace('{n}', String(photos.ids.length))}
        busy={photos.busy}
        disabled={readOnly}
        onFile={(f) => void photos.add(f)}
      />
      {photos.error ? (
        <span role="alert" className="ox-rp-error">
          {photos.error}
        </span>
      ) : null}
      {err ? (
        <span role="alert" className="ox-rp-error">
          {err}
        </span>
      ) : null}
      <button
        type="button"
        className="ox-rp-btn"
        data-variant="primary"
        data-size="lg"
        disabled={busy || readOnly || photos.busy}
        onClick={() => void submit()}
      >
        {T.changes.submit}
      </button>
    </div>
  );
}

export interface WorksTabProps {
  tenantId: string;
  ov: S['RepairProjectOverview'];
  logs: readonly S['WorkLog'][];
  foreman: boolean;
  canReview: boolean;
  canEstimate: boolean;
  /** repairs.supply.manage: остатки на объекте читает только снабжение (Q-W6.20-3). */
  canSupply: boolean;
  readOnly: boolean;
  accept: AcceptFn;
  onTab: (tab: string) => void;
}

export function WorksTab(p: WorksTabProps): ReactElement {
  const { tenantId, ov } = p;
  const project = ov.project;
  const changes = useChangeOrders(tenantId, project.id);
  const open = project.status === 'active' || project.status === 'planned';
  const canLog = p.foreman && open;
  const stock = useProjectStock(tenantId, project.id, p.canSupply);
  const list = changes.data ?? [];
  return (
    <>
      <div className="ox-rp-panel ox-rp-works">
        <h2 className="ox-rp-h2">{T.works.title}</h2>
        {ov.works.map((w) => {
          const plan = Number(w.plan);
          const pct = plan > 0 ? Math.min(100, (Number(w.fact) / plan) * 100) : 0;
          return (
            <div key={w.id} className="ox-rp-work">
              <div className="ox-rp-work-head">
                <span>{w.name}</span>
                <span>
                  {T.works.ofPlan
                    .replace('{fact}', qtyText(w.fact))
                    .replace('{plan}', qtyText(w.plan))
                    .replace('{unit}', unitLabel(w.unit))}
                </span>
              </div>
              <Meterbar pct={pct} />
            </div>
          );
        })}
        <span className="ox-rp-note">{T.works.note}</span>
      </div>
      {canLog ? (
        <WorkLogForm tenantId={tenantId} ov={ov} canStock={p.canSupply} readOnly={p.readOnly} />
      ) : null}
      <div className="ox-rp-list">
        {p.logs.length === 0 ? <div className="ox-rp-none">{T.works.logsEmpty}</div> : null}
        {p.logs.map((l) => (
          <LogRow
            key={l.id}
            log={l}
            ov={ov}
            stock={stock.data ?? []}
            canReview={p.canReview}
            readOnly={p.readOnly}
            accept={p.accept}
          />
        ))}
      </div>
      <div className="ox-rp-panel ox-rp-form">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 className="ox-rp-h2">{T.changes.title}</h2>
          <span className="ox-rp-lead">
            {p.foreman ? T.changes.leadForeman : T.changes.leadOffice}
          </span>
        </div>
        {canLog ? <ChangeForm tenantId={tenantId} ov={ov} readOnly={p.readOnly} /> : null}
        {list.length > 0 ? (
          <div className="ox-rp-co">
            {list.map((c) => (
              <ChangeRow key={c.id} c={c} canPrice={p.canEstimate && !p.foreman} onTab={p.onTab} />
            ))}
          </div>
        ) : (
          <span className="ox-rp-lead">{T.changes.none}</span>
        )}
      </div>
    </>
  );
}

function Meterbar({ pct }: { pct: number }): ReactElement {
  return (
    <span className="ox-rp-meter" aria-hidden="true">
      <span className="ox-rp-meter-done" style={{ width: `${pct}%` }} />
    </span>
  );
}

function ChangeRow(p: {
  c: S['ChangeOrder'];
  canPrice: boolean;
  onTab: (tab: string) => void;
}): ReactElement {
  const { c } = p;
  const text = [
    `${c.title} · ${qtyText(c.quantity)} ${unitLabel(c.unit)} · ${dayMonth(c.createdAt)} · фото: ${String(c.photoFileIds.length)}`,
    c.agreementNo ? T.changes.agreement.replace('{n}', String(c.agreementNo)) : '',
    c.status === 'rejected' && c.rejectReason
      ? T.changes.reason.replace('{reason}', T.changes.reasons[c.rejectReason])
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="ox-rp-log">
      <span className="ox-rp-log-id" style={{ flexBasis: 44 }}>
        {c.number}
      </span>
      <span className="ox-rp-log-text">{text}</span>
      <ChipView chip={CHANGE_CHIP[c.status]} />
      {p.canPrice && c.status === 'proposed' ? (
        <button
          type="button"
          className="ox-rp-btn"
          data-variant="outline"
          data-size="sm"
          onClick={() => p.onTab('estimate')}
        >
          {T.changes.price}
        </button>
      ) : null}
    </div>
  );
}
