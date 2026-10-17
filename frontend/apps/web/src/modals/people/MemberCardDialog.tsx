// W1.23 · Карточка сотрудника (S1-09, no-reference: design-requests «member-card»): почта, статус, владелец,
// функции (Member.workProfiles), назначения; «Назначить роль», «Заблокировать» / «Разблокировать» —
// updateMember со статусом (W1.43; себя нельзя — Q-W1.43-2, кнопки нет), «Передать владение» (S1-16).
// Блокировка — с подтверждением (verification-protocol §7). «Заблокировать» и «Разблокировать» — одна кнопка:
// после команды фокус остаётся в карточке (иначе он уходит на body и Escape карточку не закрывает). Подтверждение
// и вложенные диалоги («Назначить роль», «Передать владение» — children) открываются поверх карточки, не
// размонтируя её: иначе карточка монтируется заново и возвращает фокус на body, а не на имя в строке.
// Возврат 16.10 №3: после вложенного диалога кнопки-источника может не быть («Передать владение» исчезает, когда
// получатель стал владельцем) — фокус переводится на «Закрыть» карточки, иначе он на body и Escape не работает.
// Действия без права (members.manage, roles.assign) не показываются.
import { unwrap } from '@ortus/api-client';
import { company, format, shell } from '@ortus/texts';
import { ConfirmDialog, Dialog } from '@ortus/ui';
import { Children, type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { etagOf, idem, noRight } from '../../routes/company/users/data.ts';
import { grantLine, grantsOf, memberChip } from '../../routes/company/users/model.ts';
import { Chip } from '../../routes/company/users/parts.tsx';
import { PEOPLE_TEXT } from '../../routes/company/users/texts.ts';
import { useBusy, useRun } from '../../shell/run.tsx';
import type { PeopleCtx } from './context.ts';
import { refocusInside } from './focus.ts';

const C = PEOPLE_TEXT.card;

export interface MemberCardDialogProps {
  ctx: PeopleCtx;
  memberId: string;
  onClose: () => void;
  onAssign: () => void;
  onTransfer: () => void;
  /** Диалог поверх карточки («Назначить роль», «Передать владение»): карточка остаётся смонтированной. */
  children?: ReactNode;
}

export function MemberCardDialog({
  ctx,
  memberId,
  onClose,
  onAssign,
  onTransfer,
  children,
}: MemberCardDialogProps): ReactElement | null {
  const api = useApi();
  const run = useRun();
  const busy = useBusy('member');
  const [confirm, setConfirm] = useState(false);
  // Вернуть фокус на кнопку статуса, когда карточка снова показана после подтверждения.
  const [refocus, setRefocus] = useState(false);
  const statusBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirm && refocus && statusBtn.current) {
      statusBtn.current.focus();
      setRefocus(false);
    }
  }, [confirm, refocus]);
  // Вложенный диалог закрыт: React Aria возвращает фокус на кнопку-источник в следующем кадре; если её больше нет
  // (или фокус оказался вне карточки) — «Закрыть».
  const closeBtn = useRef<HTMLButtonElement>(null);
  const source = useRef<HTMLElement | null>(null);
  const nested = Children.toArray(children).length > 0;
  const hadNested = useRef(nested);
  useEffect(() => {
    const was = hadNested.current;
    hadNested.current = nested;
    if (!was || nested) return;
    return refocusInside(closeBtn, source.current);
  }, [nested]);

  const { data, units } = ctx;
  const member = (data.members.data ?? []).find((m) => m.id === memberId);
  if (!member) return null;
  const owners = data.owners.data?.items ?? [];
  const owner = owners.some((o) => o.memberId === member.id);
  const self = ctx.me?.id === member.id;
  const grants = grantsOf(
    member.id,
    data.assignments.data ?? [],
    data.groups.data ?? [],
    data.roles.data ?? [],
  );
  const chip = memberChip(member.status);
  const active = member.status === 'active';

  const setStatus = async (status: 'active' | 'suspended') => {
    await run(
      'member',
      async () => {
        const path = { tenantId: ctx.tenantId, memberId: member.id };
        const tag = await etagOf(
          await api.GET('/api/v1/tenants/{tenantId}/members/{memberId}', { params: { path } }),
          member.revision,
        );
        return unwrap(
          await api.PATCH('/api/v1/tenants/{tenantId}/members/{memberId}', {
            params: { path, header: { ...idem(), 'If-Match': tag } },
            body: { status },
          }),
        );
      },
      status === 'suspended' ? C.suspended : C.resumed,
    ).catch(() => undefined);
    await ctx.refresh(['members', 'explain']);
  };

  const canAssign = !noRight(data.roles) && ctx.can('roles.assign');
  const canStatus = !self && member.status !== 'invited' && ctx.can('members.manage');
  const canTransfer =
    ctx.meOwner && !self && !owner && member.status === 'active' && Boolean(member.email);

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={member.displayName}
      footer={
        <button ref={closeBtn} type="button" className="ox-dlg-btn" onClick={onClose}>
          {shell.modal.close}
        </button>
      }
    >
      <div className="ox-dlg">
        {member.email ? <span className="ox-dlg-sub">{member.email}</span> : null}
        <div className="ox-dlg-line">
          <Chip tone={chip.tone} icon={chip.icon}>
            {chip.label}
          </Chip>
          {owner ? <span className="ox-dlg-strong">{C.owner}</span> : null}
        </div>
        <div className="ox-dlg-block">
          <span className="ox-dlg-caps">{C.functions}</span>
          <span>
            {member.workProfiles.length
              ? member.workProfiles.map((f) => C.function[f]).join(', ')
              : C.noFunctions}
          </span>
        </div>
        <div className="ox-dlg-block">
          <span className="ox-dlg-caps">{C.assignments}</span>
          {grants.length ? (
            <ul className="ox-dlg-list">
              {grants.map((g) => {
                const line = grantLine(g, units);
                return (
                  <li key={g.assignment.id}>
                    {[line.role, line.scope, line.via].filter(Boolean).join(' · ')}
                  </li>
                );
              })}
            </ul>
          ) : (
            <span>{company.users.noRole}</span>
          )}
        </div>
        <div className="ox-dlg-actions">
          {canAssign ? (
            <button
              type="button"
              className="ox-dlg-btn"
              disabled={member.status === 'suspended'}
              onClick={(e) => {
                source.current = e.currentTarget;
                onAssign();
              }}
            >
              {company.users.assignRole}
            </button>
          ) : null}
          {canStatus ? (
            // Одна кнопка (не две по условию) и aria-disabled вместо disabled на время команды: фокус не теряется.
            <button
              ref={statusBtn}
              type="button"
              className="ox-dlg-btn"
              data-danger={active ? '' : undefined}
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return;
                if (active) setConfirm(true);
                else void setStatus('active');
              }}
            >
              {active ? C.suspend : C.resume}
            </button>
          ) : null}
          {canTransfer ? (
            <button
              type="button"
              className="ox-dlg-btn"
              onClick={(e) => {
                source.current = e.currentTarget;
                onTransfer();
              }}
            >
              {C.transfer}
            </button>
          ) : null}
        </div>
      </div>
      {/* Подтверждение — потомок карточки: фокус-ловушки вложены, Escape закрывает только верхний диалог. */}
      <ConfirmDialog
        open={confirm}
        tone="danger"
        icon="block"
        title={format(C.suspendTitle, { name: member.displayName })}
        text={C.suspendText}
        confirmLabel={C.suspend}
        busy={busy}
        onClose={() => {
          setRefocus(true);
          setConfirm(false);
        }}
        onConfirm={() =>
          void setStatus('suspended').then(() => {
            setRefocus(true);
            setConfirm(false);
          })
        }
      />
      {children}
    </Dialog>
  );
}
