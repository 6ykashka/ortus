// W1.23 · «Создать группу» и «Состав группы «…»» (S1-13; no-reference: design-requests «group-create», в эталоне
// кнопка «Создать группу · следующая итерация» выключена): название, участники. Команды — createGroup (группа всей
// организации), setGroupMembers (If-Match), deleteGroup (If-Match; группа с назначениями — 409 сервера тостом).
// Подтверждение удаления — поверх диалога, не размонтируя его (фокус возвращается в диалог и затем на кнопку
// «Изменить состав»); создание, прошедшее без состава, переводит диалог в правку созданной группы (повтор не
// создаёт дубль; возврат 16.10 №2).
import { unwrap } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { ConfirmDialog, Dialog } from '@ortus/ui';
import { type ReactElement, useId, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { ensureOk, etagOf, idem } from '../../routes/company/users/data.ts';
import { PEOPLE_TEXT } from '../../routes/company/users/texts.ts';
import { useBusy, useRun } from '../../shell/run.tsx';
import { type PeopleCtx, problemMessage } from './context.ts';
import { DlgButton } from './DlgButton.tsx';

const G = PEOPLE_TEXT.group;
const REFRESH = ['groups', 'explain', 'me'] as const;

export interface GroupDialogProps {
  ctx: PeopleCtx;
  /** Группа для правки состава; без неё — создание. */
  groupId?: string | undefined;
  onClose: () => void;
}

export function GroupDialog({ ctx, groupId, onClose }: GroupDialogProps): ReactElement {
  const api = useApi();
  const run = useRun();
  const busy = useBusy('group');
  const errId = useId();
  // Группа, созданная этим диалогом, если её состав не записался: дальше — правка, а не второе создание.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const editId = groupId ?? createdId ?? undefined;
  const group = (ctx.data.groups.data ?? []).find((g) => g.id === editId);
  const members = ctx.data.members.data ?? [];
  const [name, setName] = useState(group?.name ?? '');
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set(group?.memberIds ?? []));
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const path = { tenantId: ctx.tenantId };

  const setMembers = async (id: string, revision: number, memberIds: string[]) => {
    const gp = { ...path, groupId: id };
    const tag = await etagOf(
      await api.GET('/api/v1/tenants/{tenantId}/groups/{groupId}', { params: { path: gp } }),
      revision,
    );
    return unwrap(
      await api.PUT('/api/v1/tenants/{tenantId}/groups/{groupId}/members', {
        params: { path: gp, header: { ...idem(), 'If-Match': tag } },
        body: { memberIds },
      }),
    );
  };

  const save = async () => {
    if (!group && !name.trim()) {
      setNameErr(G.nameRequired);
      return;
    }
    // Участники группы вне области вошедшего (их нет в listMembers) сохраняются: правка их не снимает.
    const visible = new Set(members.map((m) => m.id));
    const memberIds = [
      ...(group?.memberIds ?? []).filter((id) => !visible.has(id)),
      ...members.filter((m) => ids.has(m.id)).map((m) => m.id),
    ];
    const title = group?.name ?? name.trim();
    try {
      await run(
        'group',
        async () => {
          if (group) return setMembers(group.id, group.revision, memberIds);
          const created = await unwrap(
            await api.POST('/api/v1/tenants/{tenantId}/groups', {
              params: { path, header: idem() },
              body: { name: title, homeUnitId: null },
            }),
          );
          if (!memberIds.length) return created;
          setCreatedId(created.id);
          return setMembers(created.id, created.revision, memberIds);
        },
        format(group ? G.saved : G.created, { name: title }),
        {
          quiet: ['validation_failed', 'separation_of_duties_conflict', 'delegation_exceeds_grant'],
        },
      );
      await ctx.refresh([...REFRESH]);
      onClose();
    } catch (e) {
      setErr(problemMessage(e));
      await ctx.refresh([...REFRESH]);
    }
  };

  const remove = async () => {
    if (!group) return;
    try {
      await run(
        'group',
        async () => {
          const gp = { ...path, groupId: group.id };
          const tag = await etagOf(
            await api.GET('/api/v1/tenants/{tenantId}/groups/{groupId}', { params: { path: gp } }),
            group.revision,
          );
          return ensureOk(
            await api.DELETE('/api/v1/tenants/{tenantId}/groups/{groupId}', {
              params: { path: gp, header: { ...idem(), 'If-Match': tag } },
            }),
          );
        },
        format(G.removed, { name: group.name }),
        { quiet: ['invalid_transition'] },
      );
      await ctx.refresh([...REFRESH]);
      onClose();
    } catch (e) {
      setErr(problemMessage(e));
    }
  };

  const toggle = (id: string) =>
    setIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={group ? format(G.editTitle, { name: group.name }) : PEOPLE_TEXT.createGroup}
      busy={busy}
      footer={
        <>
          {group ? (
            <DlgButton danger busy={busy} onPress={() => setConfirm(true)}>
              {G.remove}
            </DlgButton>
          ) : null}
          <button type="button" className="ox-dlg-btn" onClick={onClose}>
            {shell.modal.cancel}
          </button>
          <DlgButton primary busy={busy} onPress={() => void save()}>
            {group ? G.save : PEOPLE_TEXT.createGroup}
          </DlgButton>
        </>
      }
    >
      <div className="ox-dlg">
        {group ? null : (
          <label className="ox-dlg-field">
            {G.name}
            <input
              value={name}
              aria-invalid={nameErr ? 'true' : 'false'}
              aria-describedby={nameErr ? errId : undefined}
              data-invalid={nameErr ? '' : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setNameErr(null);
                setErr(null);
              }}
            />
            {nameErr ? (
              <span id={errId} role="alert" className="ox-dlg-error">
                {nameErr}
              </span>
            ) : null}
          </label>
        )}
        <fieldset className="ox-dlg-members">
          <legend>{G.members}</legend>
          {members.map((m) => (
            <label key={m.id}>
              <input type="checkbox" checked={ids.has(m.id)} onChange={() => toggle(m.id)} />
              {m.displayName}
            </label>
          ))}
        </fieldset>
        {err ? (
          <div role="alert" className="ox-dlg-alert">
            {err}
          </div>
        ) : null}
      </div>
      {/* «Удалить группу» — с подтверждением (verification-protocol §7); «Отмена» возвращает к составу. */}
      {group ? (
        <ConfirmDialog
          open={confirm}
          tone="danger"
          icon="delete"
          title={format(G.removeTitle, { name: group.name })}
          text={G.removeText}
          confirmLabel={G.remove}
          busy={busy}
          onClose={() => setConfirm(false)}
          onConfirm={() => void remove().finally(() => setConfirm(false))}
        />
      ) : null}
    </Dialog>
  );
}
