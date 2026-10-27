// W1.23 · Диалог «Назначить роль» (S1-13; эталон design-stage-1 :2203–2225, modalVM :3978–4005, saveAssign
// :2728–2737; 02-company §6.9): роль, область «Вся организация / Регион / Фирма» (области «Касса» и «Проект» —
// out-of-stage, §6.12), «Действует до», итог с фактами, текущие назначения и «Снять». Команды —
// createAssignment (срок D-10) и revokeAssignment; отказы сервера SoD и валидации — внутри диалога.
import { unwrap } from '@ortus/api-client';
import { INDUSTRY } from '@ortus/domain';
import { company, errors, format, shell, toast as T } from '@ortus/texts';
import { Dialog, Icon } from '@ortus/ui';
import { type ReactElement, useId, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { industryOf } from '../../routes/company/users/catalog.ts';
import { ensureOk, idem } from '../../routes/company/users/data.ts';
import {
  type AreaType,
  grantLine,
  grantsOf,
  isDriver,
  memberSubtitle,
  scopeLabel,
  scopeOf,
  unitLabel,
  untilInstant,
} from '../../routes/company/users/model.ts';
import { type Fact, FACT_COLOR, Facts } from '../../routes/company/users/parts.tsx';
import { PEOPLE_TEXT } from '../../routes/company/users/texts.ts';
import { useBusy, useRun } from '../../shell/run.tsx';
import { useToast } from '../../shell/toast.tsx';
import { codeOf, type PeopleCtx, problemMessage } from './context.ts';
import { DlgButton } from './DlgButton.tsx';

const D = company.dialogs.assign;
const QUIET = ['separation_of_duties_conflict', 'validation_failed', 'delegation_exceeds_grant'];
/** Назначение меняет права участника (и, возможно, свои) — назначения, explainAccess и /me/context. */
const ASSIGN_REFRESH = ['assignments', 'explain', 'me'] as const;

const MODULE_NAME: Readonly<Record<string, string>> = {
  fleet: INDUSTRY.logistics.name,
  spa: INDUSTRY.spa.name,
  repairs: INDUSTRY.repair.name,
};

export interface AssignRoleDialogProps {
  ctx: PeopleCtx;
  memberId: string;
  roleId?: string | undefined;
  onClose: () => void;
}

export function AssignRoleDialog({
  ctx,
  memberId,
  roleId: initialRole,
  onClose,
}: AssignRoleDialogProps): ReactElement | null {
  const api = useApi();
  const run = useRun();
  const toast = useToast();
  const busy = useBusy('assign');
  const factsId = useId();
  const { units, data } = ctx;
  const members = data.members.data ?? [];
  const roles = data.roles.data ?? [];
  const member = members.find((m) => m.id === memberId);
  const firm = units.firstFirm();
  // Роль из адреса — только из опций поля «Роль» (организации, не системная).
  const [roleId, setRoleId] = useState(() =>
    roles.some((r) => r.id === initialRole && !r.builtIn) ? (initialRole ?? '') : '',
  );
  const [type, setType] = useState<AreaType>('firm');
  const [region, setRegion] = useState(firm?.parentId ?? units.regions[0]?.id ?? '');
  const [firmId, setFirmId] = useState(firm?.id ?? '');
  const [account, setAccount] = useState(units.desks[0]?.id ?? '');
  const [until, setUntil] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const role = roles.find((r) => r.id === roleId);
  // Область «Касса» — только роли с модулем «Касса» (:4003); при смене роли на другую область возвращается к фирме.
  const hasCash = !!role && !role.builtIn && role.permissions.some((k) => k.startsWith('cash.'));
  const area: AreaType = type === 'account' && !hasCash ? 'firm' : type;
  const deskId = units.desks.some((d) => d.id === account) ? account : (units.desks[0]?.id ?? '');
  const scope = scopeOf(area, region, firmId, deskId);
  const existing = grantsOf(memberId, data.assignments.data ?? [], data.groups.data ?? [], roles);
  if (!member) return null;

  const facts: Fact[] = [];
  if (role) {
    const mods = role.builtIn
      ? [D.allModules]
      : industryOf(role.permissions).map((k) =>
          ctx.installed(k)
            ? (MODULE_NAME[k] ?? k)
            : format(D.moduleNotConnected, { name: MODULE_NAME[k] ?? k }),
        );
    facts.push({
      icon: 'extension',
      color: FACT_COLOR.info,
      text: mods.length ? format(D.industry, { modules: mods.join(', ') }) : D.coreOnly,
    });
    const unit = units.byId.get(area === 'region' ? region : firmId);
    facts.push({
      icon: 'location_on',
      color: FACT_COLOR.info,
      text:
        area === 'tenant'
          ? D.scopeTenant
          : area === 'account'
            ? format(PEOPLE_TEXT.assignCash.fact, { name: units.accounts.get(deskId) ?? '—' })
            : area === 'region'
              ? format(D.scopeRegion, { region: unit?.name ?? '—' })
              : format(D.scopeFirm, { firm: unit ? unitLabel(unit, units) : '—' }),
    });
    const earnings = role.builtIn || role.permissions.includes('fleet.earnings.read');
    if (isDriver(member) && earnings) {
      facts.push({ icon: 'block', color: FACT_COLOR.danger, text: D.driverConflict });
    } else {
      facts.push({
        icon: earnings ? 'lock_open' : 'lock',
        color: earnings ? FACT_COLOR.warn : FACT_COLOR.muted,
        text: earnings ? D.earningsVisible : D.earningsHidden,
      });
    }
  } else {
    facts.push({ icon: 'info', color: FACT_COLOR.muted, text: D.pickRole });
  }

  const save = async () => {
    if (!role) {
      setErr(errors.mock.company.roleRequired);
      return;
    }
    const body = {
      principalType: 'member' as const,
      principalId: member.id,
      roleId: role.id,
      scope,
      ...(until ? { validUntil: untilInstant(until) } : {}),
    };
    try {
      await run(
        'assign',
        async () =>
          unwrap(
            await api.POST('/api/v1/tenants/{tenantId}/assignments', {
              params: { path: { tenantId: ctx.tenantId }, header: idem() },
              body,
            }),
          ),
        format(T.company.roleAssigned, { role: role.name }),
        { quiet: QUIET },
      );
      await ctx.refresh(ASSIGN_REFRESH);
      onClose();
    } catch (e) {
      setErr(problemMessage(e));
    }
  };

  const remove = async (assignmentId: string) => {
    try {
      await run(
        'unassign',
        async () =>
          ensureOk(
            await api.DELETE('/api/v1/tenants/{tenantId}/assignments/{assignmentId}', {
              params: { path: { tenantId: ctx.tenantId, assignmentId }, header: idem() },
            }),
          ),
        T.company.assignmentRemoved,
        { quiet: ['last_owner_required'] },
      );
      await ctx.refresh(ASSIGN_REFRESH);
    } catch (e) {
      if (codeOf(e) === 'last_owner_required') toast(errors.mock.company.lastOwner, 'error');
    }
  };

  const pick = (k: AreaType) => {
    setType(k);
    setErr(null);
  };
  const types: [AreaType, string][] = [
    ['tenant', D.types.tenant],
    ['region', D.types.region],
    ['firm', D.types.firm],
    ...(hasCash ? ([['account', PEOPLE_TEXT.assignCash.type]] as [AreaType, string][]) : []),
  ];
  const summary = format(D.summary, {
    role: role ? role.name : D.noRole,
    scope: scopeLabel(scope, units),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={company.users.assignRole}
      size="lg"
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
        <span className="ox-dlg-sub">{memberSubtitle(member)}</span>
        {existing.length ? (
          <div className="ox-dlg-existing">
            <span className="ox-dlg-strong">{D.current}</span>
            <ul>
              {existing.map((g) => {
                const line = grantLine(g, units);
                const text = [line.role, line.scope, line.via].filter(Boolean).join(' · ');
                return (
                  <li key={g.assignment.id}>
                    <span>{text}</span>
                    <button type="button" onClick={() => void remove(g.assignment.id)}>
                      {D.remove}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <label className="ox-dlg-field">
          {D.role}
          <select
            value={roleId}
            onChange={(e) => {
              setRoleId(e.target.value);
              setErr(null);
            }}
          >
            <option value="">{PEOPLE_TEXT.pickRole}</option>
            {roles
              .filter((r) => !r.builtIn)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        <fieldset className="ox-dlg-area">
          <legend>{D.scope}</legend>
          <div>
            {types.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={area === k} onClick={() => pick(k)}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="ox-dlg-row">
          {area !== 'tenant' && area !== 'account' ? (
            <label className="ox-dlg-field" data-grow="170">
              {D.types.region}
              <select
                value={region}
                onChange={(e) => {
                  setRegion(e.target.value);
                  setFirmId(units.firmsOf(e.target.value)[0]?.id ?? '');
                }}
              >
                {units.regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {area === 'account' ? (
            <label className="ox-dlg-field" data-grow="170">
              {PEOPLE_TEXT.assignCash.field}
              <select value={deskId} onChange={(e) => setAccount(e.target.value)}>
                {units.desks.length ? null : (
                  <option value="">{PEOPLE_TEXT.assignCash.none}</option>
                )}
                {units.desks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {area === 'firm' ? (
            <label className="ox-dlg-field" data-grow="170">
              {D.types.firm}
              <select value={firmId} onChange={(e) => setFirmId(e.target.value)}>
                {units.firmsOf(region).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="ox-dlg-field" data-grow="150">
            {D.until}
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            <span className="ox-dlg-hint">{shell.form.optional}</span>
          </label>
        </div>
        <div className="ox-dlg-summary">
          <span className="ox-dlg-caps" id={factsId}>
            {D.result}
          </span>
          <strong>{summary}</strong>
          <Facts items={facts} labelledBy={factsId} />
        </div>
        {err ? (
          <div role="alert" className="ox-dlg-alert">
            <Icon name="error" size={18} />
            {err}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
