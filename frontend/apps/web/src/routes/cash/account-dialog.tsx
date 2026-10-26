// W5.32 · Мастер «Новая касса» (K:473–506, modalVM K:926–942): вид, название, подразделение, режим смен и лимиты,
// справа «Кто получит доступ» (previewCashAccountAccess по виду, подразделению и держателю). Касса создаётся с нулём;
// начальный остаток — операция «Ввод остатка» (Q-W4.00-cash-8).
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';
import { Dialog, Icon } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { createAccount, useAccessPreview } from './api.ts';
import { useCash } from './ctx.tsx';
import {
  type AccountKind,
  KIND_INFO,
  MODE_LABEL,
  money,
  parseRub,
  rightsText,
  WIZARD_KINDS,
} from './model.ts';
import { CASH_TEXT as T } from './texts.ts';
import { Alert, Button, SelectField, Seg, TextField } from './ui.tsx';

type S = components['schemas'];
const A = T.dialogs.account;

const initials = (name: string): string =>
  name
    .split(' ')
    .map((x) => x[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function AccountDialog(): ReactElement {
  const c = useCash();
  const [kind, setKind] = useState<AccountKind>('cash_drawer');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [member, setMember] = useState('');
  const [mode, setMode] = useState<S['CashAccount']['shiftMode']>('blind');
  const [kkt, setKkt] = useState<S['CashAccount']['kktMode']>('manual');
  const [limit, setLimit] = useState('30000');
  const [float, setFloat] = useState('5000');
  const [tol, setTol] = useState('100');
  const [resp, setResp] = useState('');
  const [drawer, setDrawer] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const drawers = c.accounts.filter((a) => a.kind === 'cash_drawer');
  const drawerId = drawers.some((a) => a.id === drawer) ? drawer : (drawers[0]?.id ?? '');
  const units = [
    { value: '', label: T.unitOrg },
    ...c.units.filter((u) => u.kind !== 'region').map((u) => ({ value: u.id, label: u.name })),
  ];
  const members = c.members.map((m) => ({ value: m.id, label: m.displayName }));
  const preview = useAccessPreview(
    c.tenantId,
    { kind, orgUnitId: unit || null, holderMemberId: kind === 'advance' && member ? member : null },
    true,
  );
  const people = preview.data ?? [];
  const yes = people.length;
  const total = c.members.filter((m) => m.status === 'active').length;
  const no = Math.max(0, total - yes);

  const submit = async (): Promise<void> => {
    if (!name.trim()) return setErr(A.nameRequired);
    const m = (v: string): S['Money'] | null => {
      const n = parseRub(v);
      return n === null ? null : money(n);
    };
    const body: S['CashAccountCreate'] = {
      orgUnitId: unit || null,
      name: name.trim(),
      currency: 'RUB',
      kind,
      ...(kind === 'cash_drawer'
        ? {
            shiftMode: mode,
            kktMode: kkt,
            balanceLimit: m(limit),
            floatAmount: m(float),
            tolerance: m(tol),
          }
        : {}),
      ...(kind === 'advance' ? { holderMemberId: member || null, advanceLimit: m(limit) } : {}),
      ...(kind === 'acquiring' ? { drawerAccountId: drawerId || null } : {}),
      ...(resp ? { responsibleMemberId: resp } : {}),
    };
    setBusy(true);
    setErr('');
    const r = await c.submit(
      `account:${name.trim()}`,
      (key) => createAccount(c.api, c.tenantId, body, key),
      A.ok,
    );
    setBusy(false);
    if (r.ok) {
      c.closeModal();
      c.show({ tab: 'desk', account: r.data.id });
    } else setErr(r.error);
  };

  return (
    <Dialog
      open
      onClose={c.closeModal}
      busy={busy}
      size="lg"
      title={A.title}
      footer={
        <div className="ox-ca-dfoot">
          {err ? <Alert>{err}</Alert> : null}
          <div className="ox-ca-dbtns">
            <Button onClick={c.closeModal} disabled={busy}>
              {T.dialogs.cancel}
            </Button>
            <Button variant="primary" disabled={busy || c.offline} onClick={() => void submit()}>
              {A.submit}
            </Button>
          </div>
        </div>
      }
    >
      <div className="ox-ca-form ox-ca-w980">
        <p className="ox-ca-dsub">{KIND_INFO[kind].label}</p>
        <div className="ox-ca-wizard">
          <div className="ox-ca-wcol">
            <div className="ox-ca-stack">
              <span className="ox-ca-label">{A.kind}</span>
              <div className="ox-ca-kinds" role="radiogroup" aria-label={A.kind}>
                {WIZARD_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={k === kind}
                    className="ox-ca-kind"
                    onClick={() => setKind(k)}
                  >
                    <Icon
                      name={k === kind ? 'radio_button_checked' : 'radio_button_unchecked'}
                      size={20}
                    />
                    <Icon name={KIND_INFO[k].icon} size={20} />
                    <span className="ox-ca-kindtext">
                      <strong>{KIND_INFO[k].label}</strong>
                      <span>{KIND_INFO[k].hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <TextField
              label={A.name}
              value={name}
              placeholder={A.namePh[kind]}
              onChange={setName}
            />
            <SelectField
              label={A.unit}
              value={unit}
              onChange={setUnit}
              options={units}
              hint={A.unitHint}
            />
            {kind === 'advance' ? (
              <SelectField
                label={A.member}
                value={member}
                onChange={setMember}
                options={members}
                hint={A.memberHint}
              >
                <option value="">{A.memberPick}</option>
              </SelectField>
            ) : null}
            {kind === 'acquiring' ? (
              <SelectField
                label={A.drawer}
                value={drawerId}
                onChange={setDrawer}
                options={drawers.map((a) => ({ value: a.id, label: a.name }))}
                hint={A.drawerHint}
              />
            ) : null}
            {kind === 'cash_drawer' ? (
              <>
                <div className="ox-ca-stack">
                  <span className="ox-ca-label">{A.kkt}</span>
                  <Seg
                    label={A.kkt}
                    value={kkt}
                    options={[
                      ['none', A.kktOptions.none],
                      ['manual', A.kktOptions.manual],
                    ]}
                    onChange={setKkt}
                    fill
                  />
                  <span className="ox-ca-help">{A.kktHint}</span>
                </div>
                <div className="ox-ca-stack">
                  <span className="ox-ca-label">{A.modes}</span>
                  <Seg
                    label={A.modes}
                    value={mode}
                    options={(['none', 'open', 'blind'] as const).map(
                      (k) => [k, MODE_LABEL[k]] as const,
                    )}
                    onChange={setMode}
                    fill
                  />
                  <span className="ox-ca-help">{A.modeNotes[mode]}</span>
                </div>
                <div className="ox-ca-grid3">
                  <TextField
                    label={A.limit}
                    small
                    inputMode="decimal"
                    value={limit}
                    onChange={setLimit}
                  />
                  <TextField
                    label={A.float}
                    small
                    inputMode="decimal"
                    value={float}
                    onChange={setFloat}
                  />
                  <TextField
                    label={A.tol}
                    small
                    inputMode="decimal"
                    value={tol}
                    onChange={setTol}
                  />
                </div>
              </>
            ) : null}
            {kind === 'advance' ? (
              <TextField label={A.advLimit} inputMode="decimal" value={limit} onChange={setLimit} />
            ) : null}
            <SelectField label={A.resp} value={resp} onChange={setResp} options={members}>
              <option value="">{A.respNone}</option>
            </SelectField>
          </div>
          <div className="ox-ca-who">
            <span className="ox-ca-whohead">
              <strong>{A.who}</strong>
              <span>{format(A.whoSub, { counts: format(A.whoCounts, { yes, no }) })}</span>
            </span>
            {people.length === 0 ? <span className="ox-ca-help">{A.whoEmpty}</span> : null}
            {people.map((x) => (
              <div key={x.memberId} className="ox-ca-person">
                <span className="ox-ca-ava">{initials(x.name)}</span>
                <span className="ox-ca-pmain">
                  <strong>{x.name}</strong>
                  <span>
                    {T.via[x.via]} — {rightsText(x.rights)}
                  </span>
                  {x.conflicts.map((cf) => (
                    <span key={cf} className="ox-ca-pconf">
                      <Icon name="warning" size={15} />
                      {cf}
                    </span>
                  ))}
                </span>
              </div>
            ))}
            <span className="ox-ca-help">{A.foot}</span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
