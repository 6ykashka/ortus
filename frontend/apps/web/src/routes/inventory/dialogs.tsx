// W5.11 · Диалоги «Склада»: новая позиция, правка позиции (название, минимальный уровень, архив) и новый склад.
// Ошибки полей — под полем (пустое — до отправки, дубль артикула и кода — 422 сервера под полем); прочее — тост `run`.
import { format } from '@ortus/texts';
import { Button, Checkbox, Dialog, Field, Select, TextInput } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { useBusy, useRun } from '../../shell/run.tsx';
import { createItem, createWarehouse, refreshInventory, updateItem } from './api.ts';
import { fieldErrors, type Item, parseQuantity, type Unit, unitLabel } from './model.ts';
import { INV_TEXT as T } from './texts.ts';

export interface UnitOption {
  value: string;
  label: string;
}

const UNITS: Unit[] = ['ml', 'g', 'piece', 'litre', 'kg'];
const unitOptions = UNITS.map((u) => ({ value: u, label: T.unitNames[u] }));

function Footer(p: {
  onClose: () => void;
  onSubmit: () => void;
  submit: string;
  busy: boolean;
}): ReactElement {
  return (
    <>
      <Button variant="secondary" onPress={p.onClose} disabled={p.busy}>
        {T.item.cancel}
      </Button>
      <Button onPress={p.onSubmit} loading={p.busy}>
        {p.submit}
      </Button>
    </>
  );
}

/** «Новая позиция»: подразделение, название, артикул, единица, учёт по партиям. */
export function NewItemDialog(p: {
  tenantId: string;
  units: readonly UnitOption[];
  onClose: () => void;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('inv-item-new');
  const [orgUnitId, setOrgUnitId] = useState('');
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [baseUnit, setBaseUnit] = useState<Unit | ''>('');
  const [trackLots, setTrackLots] = useState(true);
  const [err, setErr] = useState<Record<string, string>>({});

  const submit = async (): Promise<void> => {
    const local: Record<string, string> = {};
    if (!orgUnitId) local.orgUnitId = T.item.orgUnitRequired;
    if (!name.trim()) local.name = T.item.nameRequired;
    if (!sku.trim()) local.sku = T.item.skuRequired;
    if (!baseUnit) local.baseUnit = T.item.unitRequired;
    setErr(local);
    if (Object.keys(local).length || !baseUnit) return;
    try {
      await run(
        'inv-item-new',
        () =>
          createItem(api, p.tenantId, {
            orgUnitId,
            name: name.trim(),
            sku: sku.trim(),
            baseUnit,
            trackLots,
          }),
        format(T.item.created, { name: name.trim() }),
        { quiet: ['validation_failed'] },
      );
      await refreshInventory(qc, p.tenantId);
      p.onClose();
    } catch (x) {
      setErr(fieldErrors(x, ['sku', 'name', 'orgUnitId']));
    }
  };

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={T.item.newTitle}
      busy={busy}
      footer={
        <Footer
          onClose={p.onClose}
          onSubmit={() => void submit()}
          submit={T.item.create}
          busy={busy}
        />
      }
    >
      <form
        noValidate
        className="ox-inv-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={T.item.orgUnit} error={err.orgUnitId} required>
          <Select
            value={orgUnitId}
            onChange={setOrgUnitId}
            options={[...p.units]}
            placeholder={T.item.orgUnitPlaceholder}
          />
        </Field>
        <Field label={T.item.name} error={err.name} required>
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label={T.item.sku} error={err.sku} required>
          <TextInput value={sku} onChange={setSku} mono />
        </Field>
        <Field label={T.item.unit} error={err.baseUnit} hint={T.item.unitHint} required>
          <Select
            value={baseUnit}
            onChange={(v) => setBaseUnit(v as Unit | '')}
            options={unitOptions}
            placeholder={T.item.unitPlaceholder}
          />
        </Field>
        <Checkbox checked={trackLots} onChange={setTrackLots} label={T.item.trackLots} />
      </form>
    </Dialog>
  );
}

/** «Позиция «…»»: название и минимальный уровень; архив — отдельным действием. */
export function EditItemDialog(p: {
  tenantId: string;
  item: Item;
  onClose: () => void;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('inv-item-edit');
  const archiving = useBusy('inv-item-archive');
  const { item } = p;
  const [name, setName] = useState(item.name);
  const [min, setMin] = useState(item.minLevel ? item.minLevel.replace('.', ',') : '');
  const [err, setErr] = useState<Record<string, string>>({});

  const submit = async (): Promise<void> => {
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = T.item.nameRequired;
    const minLevel = min.trim() ? parseQuantity(min, { zero: true }) : null;
    if (min.trim() && minLevel === null) local.minLevel = T.item.minInvalid;
    setErr(local);
    if (Object.keys(local).length) return;
    const patch = {
      ...(name.trim() !== item.name ? { name: name.trim() } : {}),
      ...(minLevel !== null && minLevel !== item.minLevel ? { minLevel } : {}),
    };
    if (!Object.keys(patch).length) {
      p.onClose();
      return;
    }
    try {
      await run(
        'inv-item-edit',
        () => updateItem(api, p.tenantId, item, patch),
        format(T.item.saved, { name: name.trim() }),
        { quiet: ['validation_failed'] },
      );
      p.onClose();
    } catch (x) {
      setErr(fieldErrors(x, ['name', 'minLevel']));
    } finally {
      await refreshInventory(qc, p.tenantId);
    }
  };

  const archive = async (): Promise<void> => {
    try {
      await run(
        'inv-item-archive',
        () => updateItem(api, p.tenantId, item, { archived: true }),
        format(T.item.archived, { name: item.name }),
      );
      p.onClose();
    } catch {
      // Тост показал `run`; ревизия устарела — список перечитывается.
    } finally {
      await refreshInventory(qc, p.tenantId);
    }
  };

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={format(T.item.editTitle, { name: item.name })}
      busy={busy || archiving}
      footer={
        <Footer
          onClose={p.onClose}
          onSubmit={() => void submit()}
          submit={T.item.save}
          busy={busy}
        />
      }
    >
      <form
        noValidate
        className="ox-inv-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="ox-inv-note">
          {item.sku} · {unitLabel(item.baseUnit)}. {T.item.unitFixed}.
        </p>
        <Field label={T.item.name} error={err.name || undefined} required>
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field
          label={T.item.min}
          error={err.minLevel || undefined}
          hint={T.item.minHint}
          unit={unitLabel(item.baseUnit)}
        >
          <TextInput value={min} onChange={setMin} inputMode="decimal" />
        </Field>
        <div className="ox-inv-archive">
          <Button variant="danger" onPress={() => void archive()} loading={archiving}>
            {T.item.archive}
          </Button>
          <span className="ox-inv-note">{T.item.archiveHint}</span>
        </div>
      </form>
    </Dialog>
  );
}

/** «Новый склад»: подразделение, название, необязательный код. */
export function WarehouseDialog(p: {
  tenantId: string;
  units: readonly UnitOption[];
  onClose: () => void;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('inv-wh-new');
  const [orgUnitId, setOrgUnitId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});

  const submit = async (): Promise<void> => {
    const local: Record<string, string> = {};
    if (!orgUnitId) local.orgUnitId = T.warehouse.orgUnitRequired;
    if (!name.trim()) local.name = T.warehouse.nameRequired;
    setErr(local);
    if (Object.keys(local).length) return;
    try {
      await run(
        'inv-wh-new',
        () =>
          createWarehouse(api, p.tenantId, {
            orgUnitId,
            name: name.trim(),
            ...(code.trim() ? { code: code.trim() } : {}),
          }),
        format(T.warehouse.created, { name: name.trim() }),
        { quiet: ['validation_failed'] },
      );
      await refreshInventory(qc, p.tenantId);
      p.onClose();
    } catch (x) {
      setErr(fieldErrors(x, ['code', 'name', 'orgUnitId']));
    }
  };

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={T.warehouse.title}
      busy={busy}
      footer={
        <Footer
          onClose={p.onClose}
          onSubmit={() => void submit()}
          submit={T.warehouse.create}
          busy={busy}
        />
      }
    >
      <form
        noValidate
        className="ox-inv-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={T.warehouse.orgUnit} error={err.orgUnitId || undefined} required>
          <Select
            value={orgUnitId}
            onChange={setOrgUnitId}
            options={[...p.units]}
            placeholder={T.warehouse.orgUnitPlaceholder}
          />
        </Field>
        <Field label={T.warehouse.name} error={err.name || undefined} required>
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label={T.warehouse.code} error={err.code || undefined} hint={T.warehouse.codeHint}>
          <TextInput value={code} onChange={setCode} mono />
        </Field>
      </form>
    </Dialog>
  );
}
