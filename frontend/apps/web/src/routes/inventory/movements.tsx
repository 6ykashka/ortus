// W5.11 · «Движения склада»: журнал (неизменяемый), окно «Новое движение» (приход, расход, перемещение, корректировка)
// и «Сторно». Расход без названной партии идёт по FEFO на сервере; отказы 409 — «не хватает» и «срок годности истёк» —
// показываются в окне, остаток не меняется. Направления корректировки и сторно в ответе контракта нет (Q-W5.11-6).
import { format } from '@ortus/texts';
import {
  Button,
  DateInput,
  Dialog,
  EmptyState,
  Field,
  Select,
  TextInput,
  Textarea,
} from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { problemText, useBusy, useRun } from '../../shell/run.tsx';
import { postMovement, refreshInventory, useBalances } from './api.ts';
import {
  canReverse,
  dateRu,
  dateTimeRu,
  fieldErrors,
  type Item,
  lotLabel,
  type Movement,
  moveKindLabel,
  moveSign,
  parseQuantity,
  qty,
  reasonOf,
  sourceLabel,
  todayMsk,
  type Warehouse,
} from './model.ts';
import { INV_TEXT as T } from './texts.ts';

const TONE = {
  receipt: 'ok',
  issue: 'neutral',
  transfer: 'info',
  adjustment: 'warn',
  reversal: 'warn',
} as const;

export function MovementList({
  movements,
  items,
  warehouses,
  canPost,
  onReverse,
}: {
  movements: readonly Movement[];
  items: readonly Item[];
  warehouses: readonly Warehouse[];
  canPost: boolean;
  onReverse: (m: Movement) => void;
}): ReactElement {
  if (!movements.length) {
    return <EmptyState icon="swap_vert" title={T.move.empty} text={T.move.emptyText} />;
  }
  const name = (id: string | undefined): string => warehouses.find((w) => w.id === id)?.name ?? '';
  return (
    <ul className="ox-inv-list" aria-label={T.move.listAria}>
      {movements.map((m) => {
        const sign = moveSign(m.kind);
        const source = sourceLabel(m.source);
        return (
          <li key={m.id} className="ox-inv-row" data-kind="move">
            <div className="ox-inv-main">
              <span className="ox-inv-chip" data-tone={TONE[m.kind]}>
                {moveKindLabel(m.kind)}
              </span>
              <span className="ox-inv-name ox-inv-where">
                {m.kind === 'transfer' && m.targetWarehouseId
                  ? `${name(m.warehouseId)} → ${name(m.targetWarehouseId)}`
                  : name(m.warehouseId)}
              </span>
              <span className="ox-inv-when">{dateTimeRu(m.postedAt)}</span>
              {source ? <span className="ox-inv-sub">{source}</span> : null}
            </div>
            <div className="ox-inv-acts">
              {canPost && canReverse(m) ? (
                <button
                  type="button"
                  className="ox-inv-link"
                  aria-label={format(T.actions.reverseNamed, { at: dateTimeRu(m.postedAt) })}
                  onClick={() => onReverse(m)}
                >
                  {T.actions.reverse}
                </button>
              ) : null}
            </div>
            <div className="ox-inv-lines">
              {m.lines.map((l, i) => {
                const item = items.find((x) => x.id === l.itemId);
                return (
                  <div key={`${l.itemId}-${l.lotId ?? i}-${i}`} className="ox-inv-line">
                    <span>{item?.name ?? T.move.unknownItem}</span>
                    <strong>
                      {sign}
                      {item ? qty(l.quantity, item.baseUnit) : l.quantity}
                    </strong>
                    {l.expiresOn ? (
                      <span className="ox-inv-sub">
                        {format(T.stock.expiresOn, { date: dateRu(l.expiresOn) })}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type Kind = 'receipt' | 'issue' | 'transfer' | 'adjustment';
type Direction = 'increase' | 'decrease';

interface FormLine {
  id: number;
  itemId: string;
  quantity: string;
  expiresOn: string;
  lotId: string;
}

const KIND_OPTIONS = (['receipt', 'issue', 'transfer', 'adjustment'] as const).map((k) => ({
  value: k,
  label: T.kinds[k],
}));

const DIRECTION_OPTIONS = [
  { value: 'increase', label: T.move.directionIncrease },
  { value: 'decrease', label: T.move.directionDecrease },
];

function LineFields(p: {
  n: number;
  line: FormLine;
  items: readonly Item[];
  kind: Kind;
  direction: Direction | '';
  warehouseId: string;
  tenantId: string;
  today: string;
  errors: Record<string, string>;
  canRemove: boolean;
  onChange: (patch: Partial<FormLine>) => void;
  onRemove: () => void;
}): ReactElement {
  const item = p.items.find((i) => i.id === p.line.itemId);
  const adds = p.kind === 'receipt' || (p.kind === 'adjustment' && p.direction === 'increase');
  const takes = !adds;
  const showLot = takes && !!item?.trackLots && !!p.warehouseId;
  const balances = useBalances(
    p.tenantId,
    { warehouseId: p.warehouseId, itemId: p.line.itemId },
    showLot && !!p.line.itemId,
  );
  const lots = (balances.data ?? [])[0]?.lots.filter((l) => l.lotId) ?? [];
  const key = (field: string): string => p.errors[`line${String(p.n)}.${field}`] ?? '';
  return (
    <div className="ox-inv-form-line">
      {p.canRemove ? (
        <div className="ox-inv-form-line-head">
          <strong>{format(T.move.lineTitle, { n: p.n + 1 })}</strong>
          <Button
            variant="ghost"
            icon="close"
            onPress={p.onRemove}
            aria-label={format(T.move.removeLine, { n: p.n + 1 })}
          >
            {T.move.removeLineShort}
          </Button>
        </div>
      ) : null}
      <Field
        label={format(T.move.item, { n: p.n + 1 })}
        error={key('itemId') || undefined}
        required
      >
        <Select
          value={p.line.itemId}
          onChange={(v) => p.onChange({ itemId: v, lotId: '' })}
          options={p.items.map((i) => ({ value: i.id, label: i.name }))}
          placeholder={T.move.itemPlaceholder}
        />
      </Field>
      <Field
        label={format(T.move.quantity, { n: p.n + 1 })}
        error={key('quantity') || undefined}
        unit={item ? T.units[item.baseUnit] : undefined}
        required
      >
        <TextInput
          value={p.line.quantity}
          onChange={(v) => p.onChange({ quantity: v })}
          inputMode="decimal"
        />
      </Field>
      {adds && item?.trackLots ? (
        <Field label={format(T.move.expiresOn, { n: p.n + 1 })} hint={T.move.expiresHint}>
          <DateInput value={p.line.expiresOn} onChange={(v) => p.onChange({ expiresOn: v })} />
        </Field>
      ) : null}
      {showLot ? (
        <Field label={format(T.move.lot, { n: p.n + 1 })} hint={T.move.lotHint}>
          <Select
            value={p.line.lotId}
            onChange={(v) => p.onChange({ lotId: v })}
            placeholder={T.move.lotAuto}
            options={lots.map((l) => ({
              value: l.lotId ?? '',
              label: `${lotLabel(l.expiresOn, p.today).text} · ${qty(l.onHand, item?.baseUnit ?? 'piece')}`,
            }))}
          />
        </Field>
      ) : null}
    </div>
  );
}

/** «Новое движение»: вид, склад (откуда и куда), позиции с партиями, у корректировки — направление и причина. */
export function MovementDialog(p: {
  tenantId: string;
  items: readonly Item[];
  warehouses: readonly Warehouse[];
  onClose: () => void;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('inv-move');
  const [kind, setKind] = useState<Kind>('receipt');
  const [warehouseId, setWarehouseId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [direction, setDirection] = useState<Direction | ''>('');
  const [reason, setReason] = useState('');
  const [seq, setSeq] = useState(1);
  const [lines, setLines] = useState<FormLine[]>([
    { id: 0, itemId: '', quantity: '', expiresOn: '', lotId: '' },
  ]);
  const [err, setErr] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [today] = useState(() => todayMsk(Date.now()));
  const options = p.warehouses
    .filter((w) => !w.archived)
    .map((w) => ({ value: w.id, label: w.name }));

  const patchLine = (id: number, patch: Partial<FormLine>): void =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const submit = async (): Promise<void> => {
    const local: Record<string, string> = {};
    if (!warehouseId) local.warehouseId = T.move.warehouseRequired;
    if (kind === 'transfer') {
      if (!targetId) local.targetWarehouseId = T.move.targetRequired;
      else if (targetId === warehouseId) local.targetWarehouseId = T.move.targetSame;
    }
    if (kind === 'adjustment') {
      if (!direction) local.adjustmentDirection = T.move.directionRequired;
      if (!reason.trim()) local.reason = T.move.reasonRequired;
    }
    const parsed = lines.map((l, n) => {
      if (!l.itemId) local[`line${String(n)}.itemId`] = T.move.itemRequired;
      const quantity = parseQuantity(l.quantity);
      if (!quantity) local[`line${String(n)}.quantity`] = T.move.quantityInvalid;
      return { l, quantity };
    });
    setErr(local);
    setFailure(null);
    if (Object.keys(local).length) return;
    const adds = kind === 'receipt' || (kind === 'adjustment' && direction === 'increase');
    try {
      await run(
        'inv-move',
        () =>
          postMovement(api, p.tenantId, {
            kind,
            warehouseId,
            ...(kind === 'transfer' ? { targetWarehouseId: targetId } : {}),
            ...(kind === 'adjustment'
              ? { adjustmentDirection: direction as Direction, reason: reason.trim() }
              : {}),
            lines: parsed.map(({ l, quantity }) => {
              const item = p.items.find((i) => i.id === l.itemId);
              return {
                itemId: l.itemId,
                quantity: quantity ?? '0',
                ...(!adds && item?.trackLots && l.lotId ? { lotId: l.lotId } : {}),
                ...(adds && item?.trackLots && l.expiresOn.trim()
                  ? { expiresOn: l.expiresOn.trim() }
                  : {}),
              };
            }),
          }),
        T.move.posted,
        { quiet: ['invalid_transition', 'validation_failed'] },
      );
      await refreshInventory(qc, p.tenantId);
      p.onClose();
    } catch (x) {
      const reasonKey = reasonOf(x);
      if (reasonKey) {
        setFailure(T.reasons[reasonKey]);
      } else {
        const names = [
          'warehouseId',
          'targetWarehouseId',
          'adjustmentDirection',
          'reason',
          ...lines.flatMap((_, n) => [
            `lines[${String(n)}].itemId`,
            `lines[${String(n)}].quantity`,
          ]),
        ];
        const f = fieldErrors(x, names);
        if (Object.keys(f).length) {
          setErr(
            Object.fromEntries(
              Object.entries(f).map(([k, v]) => [
                k.replace(/^lines\[(\d+)\]\.(\w+)$/, 'line$1.$2'),
                v,
              ]),
            ),
          );
        } else {
          setFailure(problemText(x));
        }
      }
      await refreshInventory(qc, p.tenantId);
    }
  };

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={T.move.dialogTitle}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onPress={p.onClose} disabled={busy}>
            {T.move.cancel}
          </Button>
          <Button onPress={() => void submit()} loading={busy}>
            {T.move.submit}
          </Button>
        </>
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
        {failure ? (
          <div role="alert" className="ox-inv-error">
            {failure}
          </div>
        ) : null}
        <Field label={T.move.kind}>
          <Select
            value={kind}
            onChange={(v) => {
              setKind(v);
              setErr({});
              setFailure(null);
            }}
            options={KIND_OPTIONS}
          />
        </Field>
        <Field
          label={kind === 'transfer' ? T.move.warehouseFrom : T.move.warehouse}
          error={err.warehouseId}
          required
        >
          <Select
            value={warehouseId}
            onChange={setWarehouseId}
            options={options}
            placeholder={T.move.warehousePlaceholder}
          />
        </Field>
        {kind === 'transfer' ? (
          <Field label={T.move.targetWarehouse} error={err.targetWarehouseId} required>
            <Select
              value={targetId}
              onChange={setTargetId}
              options={options}
              placeholder={T.move.warehousePlaceholder}
            />
          </Field>
        ) : null}
        {kind === 'adjustment' ? (
          <>
            <Field label={T.move.direction} error={err.adjustmentDirection} required>
              <Select
                value={direction}
                onChange={(v) => setDirection(v as Direction | '')}
                options={DIRECTION_OPTIONS}
                placeholder={T.move.warehousePlaceholder}
              />
            </Field>
            <Field label={T.move.reason} error={err.reason} hint={T.move.reasonHint} required>
              <TextInput value={reason} onChange={setReason} />
            </Field>
          </>
        ) : null}
        {lines.map((l, n) => (
          <LineFields
            key={l.id}
            n={n}
            line={l}
            items={p.items}
            kind={kind}
            direction={direction}
            warehouseId={warehouseId}
            tenantId={p.tenantId}
            today={today}
            errors={err}
            canRemove={lines.length > 1}
            onChange={(patch) => patchLine(l.id, patch)}
            onRemove={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
          />
        ))}
        <div>
          <Button
            variant="secondary"
            icon="add"
            onPress={() => {
              setLines((ls) => [
                ...ls,
                { id: seq, itemId: '', quantity: '', expiresOn: '', lotId: '' },
              ]);
              setSeq((s) => s + 1);
            }}
          >
            {T.move.addLine}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** «Сторно движения»: причина обязательна; строки и склад сервер берёт из исходного движения. */
export function ReversalDialog(p: {
  tenantId: string;
  movement: Movement;
  onClose: () => void;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('inv-reverse');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!reason.trim()) {
      setErr(T.move.reversalReasonRequired);
      return;
    }
    setErr(null);
    try {
      await run(
        'inv-reverse',
        () =>
          postMovement(api, p.tenantId, {
            kind: 'reversal',
            warehouseId: p.movement.warehouseId,
            reversesMovementId: p.movement.id,
            reason: reason.trim(),
            lines: p.movement.lines,
          }),
        T.move.reversalPosted,
        { quiet: ['validation_failed'] },
      );
      p.onClose();
    } catch (x) {
      const f = fieldErrors(x, ['reason']);
      if (f.reason) setErr(f.reason);
      else p.onClose();
    } finally {
      await refreshInventory(qc, p.tenantId);
    }
  };

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={T.move.reversalDialogTitle}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onPress={p.onClose} disabled={busy}>
            {T.move.cancel}
          </Button>
          <Button variant="danger" onPress={() => void submit()} loading={busy}>
            {T.move.reversalSubmit}
          </Button>
        </>
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
        <p className="ox-inv-note">{T.move.reversalText}</p>
        <Field
          label={T.move.reversalReason}
          error={err ?? undefined}
          hint={T.move.reversalReasonHint}
          required
        >
          <Textarea value={reason} onChange={setReason} rows={3} />
        </Field>
      </form>
    </Dialog>
  );
}
