// W1.54 · Диалоги «Структуры» на @ortus/ui Dialog (no-reference B-6, как диалоги W1.25 и W1.23): «Новое
// подразделение» (createOrgUnit), «Переименовать «…»» и «Перенести «…»» (updateOrgUnit с If-Match), перенос — с
// предпросмотром влияния на доступ (previewOrgUnitMove, design-requests «company-structure · перенос»).
// Ошибки (Q-W1.54-6): 422 — под полем (нарушение поля, затем detail, затем словарь); 409, 412 и прочие — тост
// оболочки текстом словаря, диалог остаётся открытым; после 409/412 дерево перечитывается.
import { type components, ProblemError } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Button, Dialog, Field, Select, Skeleton, TextInput } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useEffect, useId, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { problemCode, problemText, useRun } from '../../../shell/run.tsx';
import { afterChange, afterStale, createUnit, idemKeys, updateUnit, usePreview } from './api.ts';
import {
  childKind,
  impactView,
  type Kind,
  kindLabel,
  moveTargets,
  nameError,
  pathOf,
  sameTarget,
} from './model.ts';
import { STRUCTURE_TEXT as T } from './texts.ts';

type OrgUnit = components['schemas']['OrgUnit'];

const KINDS: readonly Kind[] = ['region', 'company', 'branch', 'team'];
/** Отказы, после которых данные на экране устарели: дерево перечитывается. */
const STALE = new Set(['invalid_transition', 'revision_mismatch', 'not_found']);

/** Текст 422 под полем: нарушение поля, затем `detail` ответа, затем словарь (как диалоги W1.23). */
function fieldMessage(e: unknown): string | undefined {
  if (!(e instanceof ProblemError) || e.code !== 'validation_failed') return undefined;
  return e.problem?.violations?.[0]?.message ?? e.problem?.detail ?? problemText(e);
}

/** Команда диалога: тост успеха, 422 под полем без тоста, остальное — тост `run`; устаревшие данные — перечитать. */
function useCommand(tenantId: string) {
  const run = useRun();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [failures, setFailures] = useState(0);
  const exec = async (
    key: string,
    fn: () => Promise<unknown>,
    ok: string,
    moved = false,
  ): Promise<boolean> => {
    setBusy(true);
    setFieldError(undefined);
    try {
      await run(key, fn, ok, { quiet: ['validation_failed'] });
      await afterChange(qc, tenantId, moved);
      return true;
    } catch (e) {
      setFieldError(fieldMessage(e));
      if (STALE.has(problemCode(e))) void afterStale(qc, tenantId);
      setBusy(false);
      setFailures((n) => n + 1);
      return false;
    }
  };
  return { busy, fieldError, setFieldError, failures, exec };
}

function Footer(p: {
  busy: boolean;
  disabled: boolean;
  submit: string;
  onClose: () => void;
  onSubmit: () => void;
}): ReactElement {
  return (
    <>
      <Button variant="secondary" onPress={p.onClose} disabled={p.busy}>
        {shell.modal.cancel}
      </Button>
      <Button
        onPress={p.onSubmit}
        disabled={!p.busy && p.disabled}
        loading={p.busy}
        loadingLabel={shell.modal.busy}
      >
        {p.submit}
      </Button>
    </>
  );
}

/** Фокус на поле при открытии и после отказа (поправить значение). */
function useFieldFocus(id: string, failures: number): void {
  useEffect(() => {
    document.getElementById(id)?.focus();
  }, [id, failures]);
}

export function CreateDialog({
  tenantId,
  parent,
  units,
  onClose,
}: {
  tenantId: string;
  parent: OrgUnit | null;
  units: readonly OrgUnit[];
  onClose: () => void;
}): ReactElement {
  const api = useApi();
  const nameId = useId();
  const [keys] = useState(idemKeys);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>(childKind(parent?.kind ?? null));
  const cmd = useCommand(tenantId);
  useFieldFocus(nameId, cmd.failures);
  const local = name.trim() ? nameError(name) : null;

  const submit = async (): Promise<void> => {
    const body = { parentId: parent?.id ?? null, name: name.trim(), kind };
    const done = await cmd.exec(
      'structure.create',
      () => createUnit(api, tenantId, body, keys(body)),
      format(T.create.done, { name: body.name }),
    );
    if (done) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={T.create.title}
      busy={cmd.busy}
      footer={
        <Footer
          busy={cmd.busy}
          disabled={nameError(name) !== null}
          submit={T.create.submit}
          onClose={onClose}
          onSubmit={() => void submit()}
        />
      }
    >
      <div className="ox-str-dialog">
        <p className="ox-str-where">
          {parent ? format(T.create.where, { path: pathOf(units, parent.id) }) : T.create.top}
        </p>
        <Field
          id={nameId}
          label={T.create.name}
          error={cmd.fieldError ?? local ?? undefined}
          required
          disabled={cmd.busy}
        >
          <TextInput
            value={name}
            onChange={(v) => {
              setName(v);
              cmd.setFieldError(undefined);
            }}
          />
        </Field>
        <Field label={T.create.kind} disabled={cmd.busy}>
          <Select<Kind>
            value={kind}
            onChange={setKind}
            options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
          />
        </Field>
      </div>
    </Dialog>
  );
}

export function RenameDialog({
  tenantId,
  unit,
  onClose,
}: {
  tenantId: string;
  unit: OrgUnit;
  onClose: () => void;
}): ReactElement {
  const api = useApi();
  const nameId = useId();
  const [keys] = useState(idemKeys);
  const [name, setName] = useState(unit.name);
  const cmd = useCommand(tenantId);
  useFieldFocus(nameId, cmd.failures);
  const same = name.trim() === unit.name;

  const submit = async (): Promise<void> => {
    const body = { name: name.trim() };
    const done = await cmd.exec(
      'structure.rename',
      () => updateUnit(api, tenantId, unit.id, body, keys(body)),
      format(T.rename.done, { name: body.name }),
    );
    if (done) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={format(T.rename.title, { name: unit.name })}
      busy={cmd.busy}
      footer={
        <Footer
          busy={cmd.busy}
          disabled={same || nameError(name) !== null}
          submit={T.rename.submit}
          onClose={onClose}
          onSubmit={() => void submit()}
        />
      }
    >
      <div className="ox-str-dialog">
        <Field
          id={nameId}
          label={T.rename.name}
          error={cmd.fieldError ?? nameError(name) ?? undefined}
          required
          disabled={cmd.busy}
        >
          <TextInput
            value={name}
            onChange={(v) => {
              setName(v);
              cmd.setFieldError(undefined);
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function List({ title, items }: { title: string; items: readonly string[] }): ReactNode {
  if (items.length === 0) return null;
  return (
    <div className="ox-str-impact-group">
      <h4 className="ox-str-impact-title">{title}</h4>
      <ul className="ox-str-impact-list">
        {items.map((x, i) => (
          <li key={`${i}-${x}`}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** Ошибка предпросмотра: 422 (цикл, неизвестная цель) — текст ответа, прочее — словарь по коду. */
const previewError = (e: unknown): string =>
  format(T.move.previewFailed, { error: fieldMessage(e) ?? problemText(e) });

export function MoveDialog({
  tenantId,
  unit,
  units,
  roles,
  allowed,
  onClose,
}: {
  tenantId: string;
  unit: OrgUnit;
  units: readonly OrgUnit[];
  roles: ReadonlyMap<string, string>;
  /** Право изменения на узел-цель (новый родитель). */
  allowed: (id: string) => boolean;
  onClose: () => void;
}): ReactElement {
  const api = useApi();
  const targetId = useId();
  const [keys] = useState(idemKeys);
  const [target, setTarget] = useState('');
  const cmd = useCommand(tenantId);
  useFieldFocus(targetId, cmd.failures);
  const preview = usePreview(tenantId, unit.id, target);
  const ready = target !== '' && sameTarget(preview.data, unit.id, target);
  const view = ready && preview.data ? impactView(preview.data, roles) : null;

  const submit = async (): Promise<void> => {
    const body = { parentId: target };
    const done = await cmd.exec(
      'structure.move',
      () => updateUnit(api, tenantId, unit.id, body, keys(body)),
      format(T.move.done, { name: unit.name }),
      true,
    );
    if (done) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={format(T.move.title, { name: unit.name })}
      busy={cmd.busy}
      size="lg"
      footer={
        <Footer
          busy={cmd.busy}
          disabled={!ready}
          submit={T.move.submit}
          onClose={onClose}
          onSubmit={() => void submit()}
        />
      }
    >
      <div className="ox-str-dialog">
        <p className="ox-str-where">{T.move.text}</p>
        <Field id={targetId} label={T.move.target} disabled={cmd.busy}>
          <Select
            value={target}
            onChange={setTarget}
            placeholder={T.move.pick}
            options={moveTargets(units, unit.id, allowed)}
          />
        </Field>
        {target === '' ? null : (
          <section className="ox-str-impact" aria-label={T.move.impact}>
            <h3 className="ox-str-impact-head">{T.move.impact}</h3>
            {preview.isError ? (
              <p className="ox-str-impact-error" role="alert">
                {previewError(preview.error)}
              </p>
            ) : view ? (
              <>
                <ul className="ox-str-facts">
                  {view.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {view.none ? <p className="ox-str-none">{T.move.none}</p> : null}
                <List title={T.move.gains} items={view.gains} />
                <List title={T.move.losses} items={view.losses} />
                {view.hidden ? <p className="ox-str-hidden">{view.hidden}</p> : null}
              </>
            ) : (
              <Skeleton lines={3} label={T.move.counting} />
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
