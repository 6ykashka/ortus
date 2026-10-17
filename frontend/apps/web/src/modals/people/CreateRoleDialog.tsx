// W1.23 · Диалог «Создать роль» (S1-12; эталон design-stage-1 :2248–2262, modalVM :4022–4034, saveCreateRole
// :2747–2753; 02-company §6.11): название, основа «Пустая роль / Из шаблона / Скопировать существующую».
// Команда — createRole с правами основы; после создания — вкладка «Роли» с новой ролью в редакторе.
import { unwrap } from '@ortus/api-client';
import { company, errors, shell, toast as T } from '@ortus/texts';
import { Dialog } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { idem } from '../../routes/company/users/data.ts';
import { roleKind } from '../../routes/company/users/model.ts';
import { useBusy, useRun } from '../../shell/run.tsx';
import { type PeopleCtx, problemMessage } from './context.ts';
import { DlgButton } from './DlgButton.tsx';

const D = company.dialogs.createRole;

type Mode = 'empty' | 'template' | 'copy';

export interface CreateRoleDialogProps {
  ctx: PeopleCtx;
  onClose: () => void;
  /** Роль создана: id новой роли (страница выбирает её на вкладке «Роли»). */
  onCreated: (roleId: string) => void;
}

export function CreateRoleDialog({ ctx, onClose, onCreated }: CreateRoleDialogProps): ReactElement {
  const api = useApi();
  const run = useRun();
  const busy = useBusy('crole');
  const roles = ctx.data.roles.data ?? [];
  const templates = roles.filter((r) => roleKind(r) === 'template');
  const copies = roles.filter((r) => !r.builtIn);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode>('empty');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [copyId, setCopyId] = useState(copies[0]?.id ?? '');
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setErr(errors.mock.company.roleNameRequired);
      return;
    }
    const source = roles.find((r) => r.id === (mode === 'template' ? templateId : copyId));
    const permissions = mode === 'empty' || !source ? [] : [...source.permissions];
    try {
      const role = await run(
        'crole',
        async () =>
          unwrap(
            await api.POST('/api/v1/tenants/{tenantId}/roles', {
              params: { path: { tenantId: ctx.tenantId }, header: idem() },
              body: { name: name.trim(), permissions },
            }),
          ),
        T.company.roleCreated,
        { quiet: ['validation_failed'] },
      );
      await ctx.refresh(['roles']);
      onCreated(role.id);
    } catch (e) {
      setErr(problemMessage(e));
    }
  };

  const modes: { k: Mode; label: string; text: string }[] = [
    { k: 'empty', label: D.modes.empty, text: D.modes.emptyText },
    { k: 'template', label: D.modes.template, text: D.modes.templateText },
    { k: 'copy', label: D.modes.copy, text: D.modes.copyText },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={company.users.createRole}
      footer={
        <>
          <button type="button" className="ox-dlg-btn" onClick={onClose}>
            {shell.modal.cancel}
          </button>
          <DlgButton primary busy={busy} onPress={() => void save()}>
            {D.submit}
          </DlgButton>
        </>
      }
    >
      <div className="ox-dlg">
        <label className="ox-dlg-field">
          {D.name}
          <input
            value={name}
            placeholder={D.namePlaceholder}
            data-invalid={err ? '' : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setErr(null);
            }}
          />
          {err ? (
            <span role="alert" className="ox-dlg-error">
              {err}
            </span>
          ) : null}
        </label>
        <div role="radiogroup" aria-label={D.basisAria} className="ox-dlg-modes">
          {modes.map((m) => {
            const on = mode === m.k;
            const select =
              m.k === 'template'
                ? { value: templateId, set: setTemplateId, list: templates }
                : m.k === 'copy'
                  ? { value: copyId, set: setCopyId, list: copies }
                  : null;
            return (
              <div key={m.k} className="ox-dlg-mode" data-on={on ? '' : undefined}>
                <label>
                  <input type="radio" name="role-mode" checked={on} onChange={() => setMode(m.k)} />
                  <span>
                    <span className="ox-dlg-mode-label">{m.label}</span>
                    <span className="ox-dlg-mode-text">{m.text}</span>
                  </span>
                </label>
                {on && select ? (
                  <select
                    aria-label={m.label}
                    value={select.value}
                    onChange={(e) => select.set(e.target.value)}
                  >
                    {select.list.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
