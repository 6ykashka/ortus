// W1.23 · Диалог «Пригласить участника» (S1-06; эталон design-stage-1 :2227–2246, modalVM :4006–4021,
// saveInvite :2738–2746; 02-company §6.10): имя, почта, роль, область, места («Приглашение занимает место
// сразу, до принятия.»), «Все места тарифа заняты.» с переходом в «Подписка и места». Команда — inviteMember
// (письмо отправляет W1.41): подпись «Письмо в демо не отправляется…» эталона не переносится (PD-54).
import { unwrap } from '@ortus/api-client';
import { emailOk } from '@ortus/domain';
import { company, errors, format, shell } from '@ortus/texts';
import { Dialog, Icon } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { type AccessData, idem, noRight } from '../../routes/company/users/data.ts';
import { scopeOf, seatsOf, type Units } from '../../routes/company/users/model.ts';
import { PEOPLE_TEXT } from '../../routes/company/users/texts.ts';
import { problemText, useBusy, useRun } from '../../shell/run.tsx';
import { type PeopleCtx, problemMessage } from './context.ts';
import { DlgButton } from './DlgButton.tsx';

const D = company.dialogs.invite;
const TENANT = 'tenant';

/** Варианты «Области» (:4008–4009): организация, «{Регион} · весь регион», «{Регион} / {Фирма}». */
function scopeOptions(units: Units): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [
    { value: TENANT, label: company.dialogs.assign.types.tenant },
  ];
  for (const r of units.regions) {
    out.push({ value: r.id, label: format(PEOPLE_TEXT.scope.regionAll, { region: r.name }) });
    for (const f of units.firmsOf(r.id)) {
      out.push({
        value: f.id,
        label: format(PEOPLE_TEXT.scope.regionFirm, { region: r.name, firm: f.name }),
      });
    }
  }
  return out;
}

export interface InviteDialogProps {
  ctx: PeopleCtx;
  onClose: () => void;
  /** «Подписка и места» (:4019): закрыть диалог и перейти на страницу. */
  onBilling: () => void;
}

interface Errs {
  name?: string;
  email?: string;
}

function check(name: string, email: string): Errs {
  const out: Errs = {};
  if (!name.trim()) out.name = errors.mock.company.nameRequired;
  if (!email.trim()) out.email = D.emailRequired;
  else if (!emailOk(email)) out.email = D.emailLooksWrong;
  return out;
}

type SeatsLine =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'ok'; text: string; last: boolean; full: boolean };

/**
 * Места диалога (modalVM :4012–4019): «Мест без ограничения» — только у тарифа без права `seats`; пока подписка
 * грузится или не загрузилась — свои состояния (возврат 16.10 №1); без права на подписку — строка без числа.
 */
function seatsLine(data: AccessData): SeatsLine {
  const sub = data.subscription;
  if (noRight(sub))
    return { kind: 'ok', text: PEOPLE_TEXT.seats.noRight, last: false, full: false };
  if (sub.isError && !sub.isFetching) return { kind: 'error', error: sub.error };
  const seats = seatsOf(data.members.data ?? [], sub.data);
  if (seats.limit === undefined) return { kind: 'loading' };
  if (seats.limit === null) {
    return {
      kind: 'ok',
      text: format(D.seatsLine, { seats: D.seatsUnlimited }),
      last: false,
      full: false,
    };
  }
  const left = Math.max(0, seats.limit - seats.used);
  return {
    kind: 'ok',
    text: format(D.seatsLine, { seats: format(D.seatsText, { left, limit: seats.limit }) }),
    last: left === 1,
    full: seats.used >= seats.limit,
  };
}

export function InviteDialog({ ctx, onClose, onBilling }: InviteDialogProps): ReactElement {
  const api = useApi();
  const run = useRun();
  const busy = useBusy('invite');
  const { units, data } = ctx;
  const roles = (data.roles.data ?? []).filter((r) => !r.builtIn);
  const firm = units.firstFirm();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState(firm?.id ?? TENANT);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const errs = tried ? check(name, email) : {};
  const seats = seatsLine(data);

  const save = async () => {
    setTried(true);
    if (Object.keys(check(name, email)).length) return;
    const unit = units.byId.get(scope);
    const sc =
      scope === TENANT || !unit
        ? scopeOf('tenant', '', '')
        : scopeOf(unit.kind === 'region' ? 'region' : 'firm', unit.id, unit.id);
    const home = unit?.id ?? firm?.id;
    try {
      await run(
        'invite',
        async () =>
          unwrap(
            await api.POST('/api/v1/tenants/{tenantId}/invitations', {
              params: { path: { tenantId: ctx.tenantId }, header: idem() },
              body: {
                email: email.trim(),
                displayName: name.trim(),
                orgUnitIds: home ? [home] : [],
                roleAssignments: roleId ? [{ roleId, scope: sc }] : [],
              },
            }),
          ),
        format(PEOPLE_TEXT.inviteSent, { email: email.trim() }),
        { quiet: ['validation_failed'] },
      );
      await ctx.refresh(['members', 'assignments']);
      onClose();
    } catch (e) {
      setErr(problemMessage(e));
    }
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    error: string | undefined,
    extra: { type?: string; placeholder?: string } = {},
  ) => (
    <label className="ox-dlg-field">
      {label}
      <input
        value={value}
        type={extra.type ?? 'text'}
        placeholder={extra.placeholder}
        autoComplete="off"
        aria-invalid={error ? 'true' : 'false'}
        data-invalid={error ? '' : undefined}
        onChange={(e) => {
          set(e.target.value);
          setErr(null);
        }}
      />
      {error ? (
        <span role="alert" className="ox-dlg-error">
          {error}
        </span>
      ) : null}
    </label>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={D.title}
      footer={
        <>
          <button type="button" className="ox-dlg-btn" onClick={onClose}>
            {shell.modal.cancel}
          </button>
          <DlgButton
            primary
            busy={busy}
            disabled={seats.kind !== 'ok' || seats.full}
            onPress={() => void save()}
          >
            {company.users.invite}
          </DlgButton>
        </>
      }
    >
      <div className="ox-dlg">
        <span className="ox-dlg-sub" data-size="sm">
          {PEOPLE_TEXT.inviteNote}
        </span>
        {field(D.name, name, setName, errs.name)}
        {field(D.email, email, setEmail, errs.email, {
          type: 'email',
          placeholder: D.emailPlaceholder,
        })}
        <div className="ox-dlg-row">
          <label className="ox-dlg-field" data-grow="180">
            {company.dialogs.assign.role}
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">{D.noRole}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ox-dlg-field" data-grow="180">
            {D.scope}
            <select value={scope} disabled={!roleId} onChange={(e) => setScope(e.target.value)}>
              {scopeOptions(units).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {seats.kind === 'loading' ? (
          <div className="ox-dlg-seats" aria-busy="true">
            <Icon name="event_seat" size={18} />
            <span role="status">{PEOPLE_TEXT.seats.loading}</span>
          </div>
        ) : seats.kind === 'error' ? (
          <div role="alert" className="ox-dlg-alert ox-dlg-retry">
            <span>{format(PEOPLE_TEXT.seats.error, { error: problemText(seats.error) })}</span>
            <button
              type="button"
              className="ox-dlg-btn"
              onClick={() => void data.subscription.refetch()}
            >
              {PEOPLE_TEXT.retry}
            </button>
          </div>
        ) : seats.full ? (
          <div role="alert" className="ox-dlg-full">
            <div>
              <Icon name="no_accounts" size={20} />
              <span>
                <strong>{D.seatsFullTitle}</strong> {D.seatsFullText}
              </span>
            </div>
            <button type="button" onClick={onBilling}>
              <Icon name="workspace_premium" size={18} />
              {shell.nav.items.billing}
            </button>
          </div>
        ) : (
          <div className="ox-dlg-seats" data-last={seats.last ? '' : undefined}>
            <Icon name="event_seat" size={18} />
            <span>{seats.text}</span>
          </div>
        )}
        {err ? (
          <div role="alert" className="ox-dlg-alert">
            {err}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
