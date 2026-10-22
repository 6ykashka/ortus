// W4.61 · Системная организация «Ортус · Платформа» на «Пользователях» (pg.accounts «Ортус CRM.dc.html» :1021–1083,
// platformOrgVM :3807–3851; design-2026-10-19): тёмная карточка, предупреждение о единственном владельце, роли,
// операторы (роль, отключение, включение, отзыв приглашения), приглашение оператора, правила. Команды —
// invitePlatformOperator и updatePlatformOperator (W4.07).
import type { components, ProblemError } from '@ortus/api-client';
import { errors, format, toast as TOAST } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useId, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { useCommand, violation } from '../kit/api.ts';
import { useConfirm } from '../kit/confirm.tsx';
import { AreaSkeleton, isForbidden, Notice, RetryAlert, StatusChip } from '../kit/ui.tsx';
import { inviteOperator, updateOperator, useOperators } from './api.ts';
import { disableSpec, inviteError, ownerSpec, platformView } from './model.ts';
import { ACCOUNTS_TEXT as T } from './texts.ts';

type Operator = components['schemas']['PlatformOperator'];
type Role = Operator['role'];

const P = T.platform;
const E = errors.mock.platform;
const ROLES: readonly Role[] = ['owner', 'admin', 'billing', 'support'];

const ROLE_ERRORS = {
  invalid_transition: E.ownRole,
  last_owner_required: E.lastActiveOwner,
  validation_failed: (e: ProblemError) => violation(e, 'role') ?? E.ownerNeedsMfa,
};
const DISABLE_ERRORS = {
  invalid_transition: (e: ProblemError) => e.problem?.detail ?? E.selfDisable,
  last_owner_required: E.lastActiveOwnerDisable,
};
const INVITE_ERRORS = {
  invalid_transition: E.operatorExists,
  validation_failed: (e: ProblemError) =>
    violation(e, 'email') ?? violation(e, 'role') ?? e.problem?.detail,
};

interface Invite {
  name: string;
  email: string;
  role: Exclude<Role, 'owner'>;
}

const EMPTY: Invite = { name: '', email: '', role: 'support' };

function InviteForm(): ReactElement {
  const api = useApi();
  const toast = useToast();
  const command = useCommand();
  const [inv, setInv] = useState<Invite>(EMPTY);
  const ids = { name: useId(), email: useId(), role: useId() };
  const send = () => {
    const err = inviteError(inv);
    if (err) {
      toast(err, 'error');
      return;
    }
    const email = inv.email.trim();
    command(
      'opInvite',
      () => inviteOperator(api, { displayName: inv.name.trim(), email, role: inv.role }),
      format(TOAST.platform.operatorInvited, { email }),
      { texts: INVITE_ERRORS },
    ).then(
      () => setInv(EMPTY),
      () => undefined,
    );
  };
  return (
    <div className="ox-pk-card ox-pf-invite">
      <h2>{P.invite.title}</h2>
      <label className="ox-pk-label" htmlFor={ids.name}>
        {P.invite.name}
        <input
          id={ids.name}
          className="ox-pk-input"
          value={inv.name}
          onChange={(e) => setInv({ ...inv, name: e.target.value })}
        />
      </label>
      <label className="ox-pk-label" htmlFor={ids.email}>
        {P.invite.email}
        <input
          id={ids.email}
          type="email"
          className="ox-pk-input"
          value={inv.email}
          placeholder={P.invite.emailPlaceholder}
          onChange={(e) => setInv({ ...inv, email: e.target.value })}
        />
      </label>
      <label className="ox-pk-label" htmlFor={ids.role}>
        {P.invite.role}
        <select
          id={ids.role}
          className="ox-pk-input"
          value={inv.role}
          onChange={(e) => setInv({ ...inv, role: e.target.value as Invite['role'] })}
        >
          {ROLES.filter((r) => r !== 'owner').map((r) => (
            <option key={r} value={r}>
              {P.roles[r].name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="ox-pk-btn ox-pf-send" data-variant="primary" onClick={send}>
        <Icon name="person_add" size={18} />
        {P.invite.send}
      </button>
    </div>
  );
}

export function PlatformOrg(): ReactElement {
  const api = useApi();
  const command = useCommand();
  const confirm = useConfirm();
  const q = useOperators();
  if (!q.data) {
    if (q.isError && isForbidden(q.error)) return <Notice>{T.operatorsForbidden}</Notice>;
    return q.isError ? (
      <RetryAlert text={T.operatorsError} error={q.error} onRetry={() => void q.refetch()} />
    ) : (
      <AreaSkeleton blocks={2} />
    );
  }
  const ops = q.data.items;
  const v = platformView(ops, q.data.activeOwnerCount);
  const byId = new Map(ops.map((o) => [o.id, o]));
  const setRole = (o: Operator, role: Role) => {
    if (role === o.role) return;
    const go = () =>
      command(
        'opRole',
        () => updateOperator(api, o, { role }),
        role === 'owner'
          ? undefined
          : format(TOAST.platform.operatorRoleChanged, { role: P.roles[role].name }),
        {
          texts: ROLE_ERRORS,
        },
      );
    if (role === 'owner') confirm.ask(ownerSpec(o), go);
    else go().catch(() => undefined);
  };
  return (
    <>
      <div className="ox-pf-head">
        <span className="ox-pf-mark" aria-hidden="true">
          о
        </span>
        <div className="ox-pf-about">
          <span className="ox-pf-title">
            <strong>{T.realm.platformName}</strong>
            <span className="ox-pf-system">
              <Icon name="lock" size={15} />
              {P.system}
            </span>
          </span>
          <span className="ox-pf-text">{P.about}</span>
        </div>
        <span className="ox-pf-count">{v.count}</span>
      </div>
      {v.ownersWarn ? (
        <div role="status" className="ox-pf-warn">
          <Icon name="warning" size={20} />
          <span>{P.ownersWarn}</span>
        </div>
      ) : null}
      <div className="ox-pf-roles">
        {v.roles.map((r) => (
          <div key={r.id} className="ox-pf-role">
            <div className="ox-pf-role-top">
              <Icon name={r.icon} size={20} />
              <strong>{r.name}</strong>
              <span>{r.n}</span>
            </div>{' '}
            <span className="ox-pf-role-text">{r.text}</span>
          </div>
        ))}
      </div>
      <div className="ox-pk-card ox-pf-ops">
        <div className="ox-pf-ops-head">
          <h2>{P.operators}</h2>
        </div>
        {v.rows.map((r) => {
          const o = byId.get(r.id) as Operator;
          return (
            <div key={r.id} className="ox-op-row" data-disabled={r.disabled || undefined}>
              <span className="ox-op-avatar" aria-hidden="true">
                {r.initials}
              </span>
              <div className="ox-op-main">
                <span className="ox-op-name">
                  <span>{r.name}</span>
                  {r.me ? <span className="ox-op-me">{P.me}</span> : null}
                </span>
                <span className="ox-op-line">{r.line}</span>
                {r.note ? <span className="ox-op-note">{r.note}</span> : null}
              </div>
              <label className="ox-op-role">
                <span>{P.roleLabel}</span>
                <select
                  value={r.role}
                  disabled={r.roleDisabled}
                  aria-label={format(P.roleAria, { name: r.name })}
                  onChange={(e) => setRole(o, e.target.value as Role)}
                >
                  {ROLES.map((x) => (
                    <option key={x} value={x}>
                      {P.roles[x].name}
                    </option>
                  ))}
                </select>
                {r.roleHint ? <span>{r.roleHint}</span> : null}
              </label>
              <div className="ox-op-side">
                <StatusChip chip={r.chip} />
                <span className="ox-op-mfa" data-on={r.mfaOn || undefined}>
                  <Icon name={r.mfaOn ? 'verified_user' : 'gpp_maybe'} size={16} />
                  {r.mfa}
                </span>
                {r.canDisable ? (
                  <button
                    type="button"
                    className="ox-pk-btn ox-pk-hit"
                    data-variant="danger"
                    data-size="sm"
                    onClick={() =>
                      confirm.ask(disableSpec(o), () =>
                        command(
                          'opOff',
                          () => updateOperator(api, o, { active: false }),
                          undefined,
                          {
                            texts: DISABLE_ERRORS,
                          },
                        ),
                      )
                    }
                  >
                    {P.disable}
                  </button>
                ) : null}
                {r.canEnable ? (
                  <button
                    type="button"
                    className="ox-pk-btn ox-pk-hit"
                    data-size="sm"
                    onClick={() =>
                      void command(
                        'opOn',
                        () => updateOperator(api, o, { active: true }),
                        TOAST.platform.operatorActivated,
                      ).catch(() => undefined)
                    }
                  >
                    {P.enable}
                  </button>
                ) : null}
                {r.canRevoke ? (
                  <button
                    type="button"
                    className="ox-pk-btn ox-pk-hit"
                    data-size="sm"
                    onClick={() =>
                      void command(
                        'opRevoke',
                        () => updateOperator(api, o, { active: false }),
                        TOAST.platform.operatorInviteRevoked,
                      ).catch(() => undefined)
                    }
                  >
                    {P.revoke}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="ox-pf-bottom">
        {v.iAmOwner ? <InviteForm /> : null}
        <div className="ox-pk-card ox-pf-rules">
          <h2>{P.rulesTitle}</h2>
          <ul>
            {P.rules.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      {confirm.node}
    </>
  );
}
