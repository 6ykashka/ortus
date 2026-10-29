// W6.22 · «Новая заявка на материал» (`repair-supply-request`, no-reference B-6, Q-W4.00-repair-6): прораб просит
// материал справочника с датой «Нужно к» (createSupplyRequest). Эталон формы не рисовался (design-requests): поля и
// ошибки — по контракту `SupplyRequestCreate` и разбору `dor/repair.md` §2.2.
import { format } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactElement, useId, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { problemText, useBusy, useRun } from '../../../shell/run.tsx';
import { createRequest, refreshSupply, useMaterials } from './api.ts';
import { parsePrice } from './model.ts';
import { SUPPLY_TEXT as T } from './texts.ts';

interface Errors {
  material?: string;
  quantity?: string;
  needBy?: string;
}

export function NewRequestForm(p: {
  tenantId: string;
  projectId: string;
  locked: boolean;
  /** Не раньше этой даты (ISO) можно назначить «Нужно к». */
  minDate: string;
  /** Материалы прежних заявок объекта: список, если справочник прорабу не открыт (Q-W6.22-6); undefined — грузятся. */
  known: readonly { id: string; name: string }[] | undefined;
}): ReactElement {
  const api = useApi();
  const run = useRun();
  const qc = useQueryClient();
  const can = useCan();
  const { audience } = useShell();
  // Справочник расценок открыт владельцу и ведущим каталог или снабжение; прораб берёт материалы из прежних заявок.
  const canReadCatalog =
    audience === 'owner' || can('repairs.catalog.manage', 'repairs.supply.manage');
  const materials = useMaterials(p.tenantId, canReadCatalog);
  const key = `supply:request:${p.projectId}`;
  const busy = useBusy(key);
  const id = useId();
  const options = materials.isSuccess ? materials.data : (p.known ?? []);
  const [material, setMaterial] = useState('');
  const [quantity, setQuantity] = useState('');
  const [needBy, setNeedBy] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const next: Errors = {};
    if (!material) next.material = T.newRequest.errors.material;
    if (!(parsePrice(quantity) > 0)) next.quantity = T.newRequest.errors.quantity;
    if (!needBy) next.needBy = T.newRequest.errors.needBy;
    else if (needBy < p.minDate) next.needBy = T.newRequest.errors.needByPast;
    setErrors(next);
    if (next.material || next.quantity || next.needBy) return;
    try {
      await run(
        key,
        () =>
          createRequest(api, p.tenantId, p.projectId, {
            priceItemId: material,
            quantity: String(parsePrice(quantity)),
            needBy,
          }),
        T.newRequest.done,
      );
      setMaterial('');
      setQuantity('');
      setNeedBy('');
    } catch {
      // Ошибку показал `run` (тост по Problem.code); форма остаётся с введёнными значениями.
    } finally {
      await refreshSupply(qc, p.tenantId);
    }
  };

  return (
    <form className="ox-rps-card-sel" noValidate onSubmit={(e) => void submit(e)}>
      <h3 className="ox-rps-h3">{T.newRequest.title}</h3>
      <div className="ox-rps-grid">
        <label className="ox-rps-field ox-rps-grow">
          {T.newRequest.material}
          <select
            className="ox-rps-select"
            value={material}
            disabled={p.locked || (materials.isPending && !p.known)}
            aria-invalid={errors.material ? 'true' : undefined}
            aria-describedby={errors.material ? `${id}-material` : undefined}
            onChange={(e) => setMaterial(e.target.value)}
          >
            <option value="">{T.newRequest.choose}</option>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ox-rps-field ox-rps-narrow">
          {T.newRequest.quantity}
          <input
            className="ox-rps-input"
            data-num=""
            inputMode="decimal"
            value={quantity}
            disabled={p.locked}
            aria-invalid={errors.quantity ? 'true' : undefined}
            aria-describedby={errors.quantity ? `${id}-quantity` : undefined}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label className="ox-rps-field ox-rps-narrow">
          {T.newRequest.needBy}
          <input
            className="ox-rps-input"
            type="date"
            min={p.minDate}
            value={needBy}
            disabled={p.locked}
            aria-invalid={errors.needBy ? 'true' : undefined}
            aria-describedby={errors.needBy ? `${id}-needBy` : undefined}
            onChange={(e) => setNeedBy(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="ox-rps-btn"
          data-variant="primary"
          data-size="lg"
          disabled={p.locked || busy}
        >
          {T.newRequest.submit}
        </button>
      </div>
      {errors.material ? (
        <span id={`${id}-material`} role="alert" className="ox-rps-alert">
          {errors.material}
        </span>
      ) : null}
      {errors.quantity ? (
        <span id={`${id}-quantity`} role="alert" className="ox-rps-alert">
          {errors.quantity}
        </span>
      ) : null}
      {errors.needBy ? (
        <span id={`${id}-needBy`} role="alert" className="ox-rps-alert">
          {errors.needBy}
        </span>
      ) : null}
      {materials.isError && p.known?.length === 0 ? (
        <span role="alert" className="ox-rps-alert">
          {format(T.newRequest.materialsFailed, { error: problemText(materials.error) })}
        </span>
      ) : null}
    </form>
  );
}
