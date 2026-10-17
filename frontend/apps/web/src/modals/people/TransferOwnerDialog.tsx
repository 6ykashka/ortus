// W1.23 · «Передать владение» (S1-16, AUTH-08; no-reference: design-requests «owner-transfer»): получатель —
// активный участник, подтверждение — его почта, причина (5…500), «Остаться совладельцем» (keepCurrentOwner;
// одношаговая передача — Q-W0.08-3). Команда — transferOwnership; свежий вход старше 10 минут — 401
// session_expired (текст словаря ошибок в диалоге). Ошибки полей — у своего поля (aria-invalid, текст в подписи;
// нарушение сервера по полю `confirmation` или `reason`), прочие отказы — общим блоком (возврат 16.10 №2).
import { ProblemError, unwrap } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Dialog } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { idem } from '../../routes/company/users/data.ts';
import { memberSubtitle } from '../../routes/company/users/model.ts';
import { PEOPLE_TEXT } from '../../routes/company/users/texts.ts';
import { useBusy, useRun } from '../../shell/run.tsx';
import { type PeopleCtx, problemMessage } from './context.ts';
import { DlgButton } from './DlgButton.tsx';

const X = PEOPLE_TEXT.transfer;

type Field = 'confirmation' | 'reason';
type Errs = Partial<Record<Field | 'form', string>>;

/** Поле нарушения сервера (`validation_failed`), если оно есть у формы. */
function fieldOf(e: unknown): Field | null {
  const field = e instanceof ProblemError ? e.problem?.violations?.[0]?.field : undefined;
  return field === 'confirmation' || field === 'reason' ? field : null;
}

export interface TransferOwnerDialogProps {
  ctx: PeopleCtx;
  memberId: string;
  onClose: () => void;
}

export function TransferOwnerDialog({
  ctx,
  memberId,
  onClose,
}: TransferOwnerDialogProps): ReactElement | null {
  const api = useApi();
  const run = useRun();
  const busy = useBusy('transfer');
  const member = (ctx.data.members.data ?? []).find((m) => m.id === memberId);
  const [keep, setKeep] = useState(true);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<Errs>({});
  if (!member) return null;

  const save = async () => {
    if (reason.trim().length < 5) {
      setErrs({ reason: X.reasonShort });
      return;
    }
    try {
      await run(
        'transfer',
        async () =>
          unwrap(
            await api.POST('/api/v1/tenants/{tenantId}/owners/transfers', {
              params: { path: { tenantId: ctx.tenantId }, header: idem() },
              body: {
                toMemberId: member.id,
                keepCurrentOwner: keep,
                confirmation: confirmation.trim(),
                reason: reason.trim(),
              },
            }),
          ),
        format(X.done, { name: member.displayName }),
        { quiet: ['validation_failed', 'invalid_transition', 'session_expired'] },
      );
      await ctx.refresh(['owners', 'members', 'assignments', 'explain', 'me']);
      onClose();
    } catch (e) {
      setErrs({ [fieldOf(e) ?? 'form']: problemMessage(e) });
    }
  };

  const ids = {
    confirm: `${memberId}-confirm`,
    hint: `${memberId}-confirm-hint`,
    confirmErr: `${memberId}-confirm-err`,
    reasonErr: `${memberId}-reason-err`,
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={X.title}
      busy={busy}
      footer={
        <>
          <button type="button" className="ox-dlg-btn" onClick={onClose}>
            {shell.modal.cancel}
          </button>
          <DlgButton primary busy={busy} onPress={() => void save()}>
            {X.title}
          </DlgButton>
        </>
      }
    >
      <div className="ox-dlg">
        <span className="ox-dlg-sub">{memberSubtitle(member)}</span>
        <p className="ox-dlg-text">{format(X.text, { tenant: ctx.tenantName })}</p>
        <label className="ox-dlg-check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>
            <span>{X.keep}</span>
            <span className="ox-dlg-hint">{X.keepNote}</span>
          </span>
        </label>
        <div className="ox-dlg-field">
          <label htmlFor={ids.confirm}>{X.confirm}</label>
          <input
            id={ids.confirm}
            type="email"
            value={confirmation}
            autoComplete="off"
            aria-invalid={errs.confirmation ? 'true' : 'false'}
            aria-describedby={errs.confirmation ? `${ids.hint} ${ids.confirmErr}` : ids.hint}
            data-invalid={errs.confirmation ? '' : undefined}
            onChange={(e) => {
              setConfirmation(e.target.value);
              setErrs({});
            }}
          />
          <span id={ids.hint} className="ox-dlg-hint">
            {X.confirmHint}
          </span>
          {errs.confirmation ? (
            <span id={ids.confirmErr} role="alert" className="ox-dlg-error">
              {errs.confirmation}
            </span>
          ) : null}
        </div>
        <label className="ox-dlg-field">
          {X.reason}
          <input
            value={reason}
            maxLength={500}
            aria-invalid={errs.reason ? 'true' : 'false'}
            aria-describedby={errs.reason ? ids.reasonErr : undefined}
            data-invalid={errs.reason ? '' : undefined}
            onChange={(e) => {
              setReason(e.target.value);
              setErrs({});
            }}
          />
          {errs.reason ? (
            <span id={ids.reasonErr} role="alert" className="ox-dlg-error">
              {errs.reason}
            </span>
          ) : null}
        </label>
        {errs.form ? (
          <div role="alert" className="ox-dlg-alert">
            {errs.form}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
