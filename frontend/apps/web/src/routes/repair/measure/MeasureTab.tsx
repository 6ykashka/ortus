// W6.21 · Вкладка «Замер» карточки объекта (`repair-measure`; эталон design-2026-10-19 «Ремонт и стройка.dc.html»
// :74–100, логика :1046, :1645–1679). Размеры правятся в таблице и сохраняются новой версией замера (putMeasurement)
// по уходу из поля; «Добавить помещение» сохраняется сразу. Правка — с `repairs.measurements.edit`, пока объект
// не сдан (Q-W4.00-repair-17); «Открыть смету» — только с `repairs.finance.read` (Q-W4.00-repair-24).
import { Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { components } from '@ortus/api-client';
import { type ReactElement, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { repairKey, saveMeasurement, useMeasurement, useProject } from './api.ts';
import {
  fmtNum,
  measureOf,
  newRoom,
  roomFloor,
  roomWalls,
  type RoomDraft,
  toDraft,
  toPut,
} from './calc.ts';
import { TabFailed, TabSkeleton } from './states.tsx';
import { MEASURE_TEXT as T } from './texts.ts';
import type { RepairTabLink } from './types.ts';
import './tabs.css';

const SAVE = 'repair-measure-save';
const subst = (text: string, name: string): string => text.replace('{name}', name);

type S = components['schemas'];
type Field = 'l' | 'w' | 'h' | 'o';

interface Props {
  projectId: string;
  onNavigate?: (tab: RepairTabLink) => void;
}

export function MeasureTab({ projectId, onNavigate }: Props): ReactElement {
  const { tenantId } = useShell();
  const tid = tenantId ?? '';
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const saving = useBusy(SAVE);
  const can = useCan();
  const project = useProject(tid, projectId);
  const meas = useMeasurement(tid, projectId);
  const [draft, setDraftState] = useState<RoomDraft[] | null>(null);
  // Свежий черновик для асинхронных сохранений: поля правят и во время запроса.
  const latest = useRef<RoomDraft[] | null>(null);
  const inflight = useRef(false);
  const again = useRef(false);
  const setDraft = (next: RoomDraft[] | null): void => {
    latest.current = next;
    setDraftState(next);
  };

  if (meas.isError) {
    return (
      <TabFailed
        text={T.loadFailed}
        error={meas.error}
        retry={T.retry}
        onRetry={() => void meas.refetch()}
      />
    );
  }
  if (!meas.data) return <TabSkeleton label={T.title} />;

  const handedOver = project.data?.status === 'handed_over';
  const editable = can('repairs.measurements.edit') && !handedOver;
  const serverRooms = toDraft(meas.data.rooms);
  const rooms = draft ?? serverRooms;
  const totals = measureOf(rooms);
  const measureKey = [...repairKey(tid, projectId), 'measurement'];
  const same = (a: readonly RoomDraft[], b: readonly RoomDraft[]): boolean =>
    JSON.stringify(toPut(a)) === JSON.stringify(toPut(b));

  /**
   * Сохранить замер целиком (новая версия, If-Match — ревизия последнего ответа). Сохранения идут по одному: правка
   * следующего поля во время запроса ждёт его конца и уходит отдельной версией; черновик сбрасывается, только если
   * за время запроса его не меняли. Отказ сервера (конфликт версии, закрытый объект) — данные сервера возвращаются.
   */
  const flush = async (): Promise<void> => {
    if (inflight.current) {
      again.current = true;
      return;
    }
    const next = latest.current;
    const cur = qc.getQueryData<S['Measurement']>(measureKey);
    if (!next || !cur) return;
    if (same(next, toDraft(cur.rooms))) {
      setDraft(null);
      return;
    }
    inflight.current = true;
    try {
      const saved = await run(SAVE, () =>
        saveMeasurement(api, tid, projectId, toPut(next), cur.revision),
      );
      qc.setQueryData(measureKey, saved);
      const now = latest.current;
      if (now && same(now, next)) setDraft(null);
      void qc.invalidateQueries({ queryKey: [...repairKey(tid, projectId), 'estimates'] });
    } catch {
      again.current = false;
      setDraft(null);
      void qc.invalidateQueries({ queryKey: repairKey(tid, projectId) });
    } finally {
      inflight.current = false;
      if (again.current) {
        again.current = false;
        void flush();
      }
    }
  };

  const edit = (i: number, k: Field, value: string): void => {
    setDraft(rooms.map((r, j) => (j === i ? { ...r, [k]: value.replace(',', '.') } : r)));
  };
  const add = (): void => {
    setDraft([...rooms, newRoom()]);
    void flush();
  };
  const cell = (r: RoomDraft, i: number, k: Field, label: string): ReactElement => (
    <td className="ox-rp-td-in">
      {editable ? (
        <input
          className="ox-rp-input"
          inputMode="decimal"
          value={r[k].replace('.', ',')}
          aria-label={subst(label, r.name)}
          onChange={(e) => edit(i, k, e.target.value)}
          onBlur={() => void flush()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      ) : (
        <span className="ox-rp-num">{r[k].replace('.', ',')}</span>
      )}
    </td>
  );

  return (
    <section
      aria-labelledby="h-meas"
      data-screen-label={T.title}
      className="ox-rp-section"
      aria-busy={saving || undefined}
    >
      <div>
        <h2 id="h-meas" className="ox-rp-h2">
          {T.title}
        </h2>
        <p className="ox-rp-lead">{T.intro}</p>
      </div>
      {!editable ? (
        <p className="ox-rp-hint" role="status">
          {handedOver ? T.handedOver : T.readOnly}
        </p>
      ) : null}
      <div className="ox-rp-tablewrap">
        <table className="ox-rp-table" data-min="720" aria-label={T.tableAria}>
          <thead>
            <tr>
              <th scope="col">{T.room}</th>
              <th scope="col">{T.length}</th>
              <th scope="col">{T.width}</th>
              <th scope="col">{T.height}</th>
              <th scope="col">{T.openings}</th>
              <th scope="col" className="ox-rp-right ox-rp-wide">
                {T.floor}
              </th>
              <th scope="col" className="ox-rp-right ox-rp-wide">
                {T.walls}
              </th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r, i) => (
              <tr key={i}>
                <td className="ox-rp-name">{r.name}</td>
                {cell(r, i, 'l', T.lengthOf)}
                {cell(r, i, 'w', T.widthOf)}
                {cell(r, i, 'h', T.heightOf)}
                {cell(r, i, 'o', T.openingsOf)}
                <td className="ox-rp-td-n">{fmtNum(roomFloor(r))}</td>
                <td className="ox-rp-td-n">{fmtNum(roomWalls(r))}</td>
              </tr>
            ))}
            {rooms.length === 0 ? (
              <tr>
                <td colSpan={7} className="ox-rp-muted-cell">
                  {T.empty}
                </td>
              </tr>
            ) : null}
            <tr className="ox-rp-total">
              <td colSpan={5}>{T.total}</td>
              <td className="ox-rp-td-n">{fmtNum(totals.floor)}</td>
              <td className="ox-rp-td-n">{fmtNum(totals.walls)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="ox-rp-actions">
        {editable ? (
          <button
            type="button"
            className="ox-rp-btn"
            data-variant="dashed"
            data-size="lg"
            onClick={add}
          >
            <Icon name="add" size={18} />
            {T.add}
          </button>
        ) : null}
        {can('repairs.finance.read') && onNavigate ? (
          <button
            type="button"
            className="ox-rp-btn"
            data-size="lg"
            onClick={() => onNavigate('estimate')}
          >
            {T.openEstimate}
            <Icon name="arrow_forward" size={18} />
          </button>
        ) : null}
        <span className="ox-rp-hint-inline">{T.files}</span>
      </div>
    </section>
  );
}
