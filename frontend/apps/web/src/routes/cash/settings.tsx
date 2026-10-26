// W5.32 · Вкладка «Настройки» (K:319–342, settingsVM K:820–836): «Кассы и счета» с режимом, лимитами и доступом
// (preview по виду, подразделению и держателю) и «Касса в ролях» (роли с действиями модуля из listRoles).
import { format } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import { useAccessPreview, useRoles } from './api.ts';
import { useCash } from './ctx.tsx';
import { type Account, KIND_INFO, MODE_LABEL, plural, rightsText, rub } from './model.ts';
import { CASH_TEXT as T } from './texts.ts';
import { Button } from './ui.tsx';

function AccountRow(p: { a: Account }): ReactElement {
  const c = useCash();
  const { a } = p;
  const info = KIND_INFO[a.kind];
  const people = useAccessPreview(
    c.tenantId,
    { kind: a.kind, orgUnitId: a.orgUnitId, holderMemberId: a.holderMemberId ?? null },
    true,
  ).data;
  const mode =
    a.kind === 'cash_drawer'
      ? MODE_LABEL[a.shiftMode] + (a.kktMode === 'manual' ? T.settings.modeKkt : '')
      : a.kind === 'advance'
        ? format(T.settings.modeAdv, { name: c.memberName(a.holderMemberId) })
        : a.kind === 'acquiring'
          ? T.settings.modeAcq
          : T.settings.modeNone;
  const limit = a.kind === 'advance' ? a.advanceLimit : a.balanceLimit;
  const limits =
    [
      limit
        ? format(a.kind === 'advance' ? T.settings.limitHands : T.settings.limitOn, {
            sum: rub(limit.amountMinor),
          })
        : '',
      a.kind === 'cash_drawer' && a.floatAmount?.amountMinor
        ? format(T.settings.limitFloat, { sum: rub(a.floatAmount.amountMinor) })
        : '',
      a.kind === 'cash_drawer' && a.tolerance?.amountMinor
        ? format(T.settings.limitTol, { sum: rub(a.tolerance.amountMinor) })
        : '',
    ]
      .filter(Boolean)
      .join(' · ') || T.settings.noLimits;
  const list = people ?? [];
  return (
    <div className="ox-ca-setrow">
      <span className="ox-ca-setcol" data-wide="true">
        <span className="ox-ca-ico">
          <Icon name={info.icon} size={20} />
        </span>
        <span className="ox-ca-setname">
          <strong>{a.name}</strong>
          <small>
            {format(T.settings.kindUnit, { kind: info.label, unit: c.unitTitle(a.orgUnitId) })}
          </small>
        </span>
      </span>
      <span className="ox-ca-setcol">
        <span>{mode}</span>
        <small>{limits}</small>
      </span>
      <span className="ox-ca-setcol">
        <span>{plural(list.length, ...T.settings.people)}</span>
        <small>
          {list
            .slice(0, 3)
            .map((x) => x.name)
            .join(', ')}
          {list.length > 3 ? format(T.settings.more, { n: list.length - 3 }) : ''}
        </small>
      </span>
    </div>
  );
}

export function SettingsTab(): ReactElement {
  const c = useCash();
  const roles = (useRoles(c.tenantId).data ?? []).filter((r) =>
    r.permissions.some((k) => k.startsWith('cash.')),
  );
  return (
    <div className="ox-ca-form">
      <div className="ox-ca-setcard">
        <div className="ox-ca-sethead">
          <span>
            <strong>{T.settings.accsTitle}</strong>
            <span className="ox-ca-help">{T.settings.accsSub}</span>
          </span>
          <Button
            variant="primary"
            icon="add_card"
            disabled={c.offline}
            onClick={() => c.openModal({ kind: 'account' })}
          >
            {T.settings.newAccount}
          </Button>
        </div>
        {c.accounts.map((a) => (
          <AccountRow key={a.id} a={a} />
        ))}
      </div>
      <div className="ox-ca-setcard">
        <div className="ox-ca-sethead">
          <span>
            <strong>{T.settings.rolesTitle}</strong>
            <span className="ox-ca-help">{T.settings.rolesSub}</span>
          </span>
          <Button icon="group" onClick={() => c.go('users')}>
            {T.settings.rolesButton}
          </Button>
        </div>
        {roles.map((r) => (
          <div key={r.id} className="ox-ca-setrow">
            <span className="ox-ca-setcol">
              <strong>{r.name}</strong>
              <small>{r.builtIn ? T.settings.roleSystem : T.settings.roleOwn}</small>
            </span>
            <span className="ox-ca-setcol" data-wide="true">
              {rightsText(r.permissions.filter((k) => k.startsWith('cash.')))}
            </span>
            <span className="ox-ca-setcol">
              {r.permissions.includes('cash.balance.read')
                ? T.settings.seesBalance
                : T.settings.noBalance}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
