// W1.23 · Вкладка «Роли» (S1-12; эталон design-stage-1 :334–398, usersVM :3157–3161, roleEditorVM
// :3168–3216, saveRole :2760–2763): список ролей с видом и «{n} разрешений · назначена: {k}», «Создать роль»,
// RoleEditor (@ortus/ui) над правами роли контракта, «Есть несохранённые изменения», «Отменить»,
// «Сохранить роль» (updateRole с If-Match), «Итоговые права роли». Черновик правки — у страницы (`draft`,
// `onDraft`), как roleDraft эталона: смена вкладки его не теряет; выбор другой роли — сбрасывает.
// Возврат 16.10 №3: «Отменить» и «Сохранить роль» недоступны через aria-disabled (нативный disabled уводит фокус
// на body); после отмены и сохранения фокус — на поле «Название роли». «Итоговые права роли» — в порядке модулей
// (rolePermKeys эталона). Без права roles.manage нет «Создать роль» и подвала.
import { unwrap } from '@ortus/api-client';
import { company, errors, format, shell, toast as T } from '@ortus/texts';
import { Icon, RoleEditor, type RoleDraft } from '@ortus/ui';
import { type ReactElement, useEffect, useId, useRef } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import {
  CASH_BALANCE,
  CASH_SELF,
  cashOn,
  roleCatalog,
  summaryKeys,
  toDraft,
  toPermissions,
  withFlag,
} from './catalog.ts';
import { CashBlock } from './CashBlock.tsx';
import { type AccessData, etagOf, idem, noRight, type Refresh } from './data.ts';
import { grantsOf, isDriver, isDriverRole, type Role, roleKind, roleMeta } from './model.ts';
import { FACT_COLOR, Facts, Hidden, type Tone } from './parts.tsx';
import { PEOPLE_TEXT } from './texts.ts';

const E = company.users.editor;

const KIND: Readonly<Record<ReturnType<typeof roleKind>, { label: string; tone: Tone }>> = {
  system: { label: company.users.roleKinds.system, tone: 'info' },
  template: { label: company.users.roleKinds.template, tone: 'neutral' },
  custom: { label: company.users.roleKinds.custom, tone: 'ok' },
};

/** Несохранённая правка роли `roleId`: имя и права (ключи контракта). */
export interface RoleEdit {
  roleId: string;
  name: string;
  permissions: string[];
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((k) => b.includes(k));

export interface RolesTabProps {
  tenantId: string;
  data: AccessData;
  installed: (moduleKey: string) => boolean;
  selected: string | undefined;
  /** Черновик страницы (живёт дольше вкладки). */
  draft: RoleEdit | null;
  onDraft: (draft: RoleEdit | null) => void;
  onSelect: (roleId: string) => void;
  onCreate: () => void;
  /** Право roles.manage: без него нет «Создать роль» и подвала «Отменить» / «Сохранить роль». */
  canManage?: boolean;
  refresh: Refresh;
}

export function RolesTab({
  tenantId,
  data,
  installed,
  selected,
  draft,
  onDraft: setDraft,
  onSelect,
  onCreate,
  canManage = true,
  refresh,
}: RolesTabProps): ReactElement {
  const api = useApi();
  const run = useRun();
  const toast = useToast();
  const saving = useBusy('srole');
  const editorId = useId();
  const asideId = useId();
  // После «Отменить» и «Сохранить роль» кнопки становятся недоступны — фокус переводится на «Название роли».
  const card = useRef<HTMLElement>(null);
  // Флаг «перевести фокус после следующей отрисовки» (черновик сброшен — страница перерисует вкладку).
  const focusName = useRef(false);
  useEffect(() => {
    if (!focusName.current) return;
    focusName.current = false;
    card.current?.querySelector<HTMLInputElement>('input')?.focus();
  });
  const roles = data.roles.data ?? [];
  const assignments = data.assignments.data ?? [];
  const members = data.members.data ?? [];
  const groups = data.groups.data ?? [];
  const saved: Role | undefined =
    roles.find((r) => r.id === selected) ?? roles.find((r) => !r.builtIn) ?? roles[0];
  const catalog = roleCatalog(installed);

  if (noRight(data.roles)) {
    return (
      <div className="ox-users-panel">
        <p className="ox-users-empty">{PEOPLE_TEXT.rolesNoRight}</p>
      </div>
    );
  }
  if (!saved) {
    return (
      <div className="ox-users-panel">
        <div className="ox-roles-list">
          {canManage ? (
            <button type="button" className="ox-users-btn" data-primary="" onClick={onCreate}>
              <Icon name="add" size={18} />
              {company.users.createRole}
            </button>
          ) : null}
          <p className="ox-users-empty">{PEOPLE_TEXT.rolesEmpty}</p>
        </div>
      </div>
    );
  }

  const mine = draft?.roleId === saved.id ? draft : null;
  const current: Role = mine ? { ...saved, name: mine.name, permissions: mine.permissions } : saved;
  const dirty =
    mine !== null && (mine.name !== saved.name || !sameSet(mine.permissions, saved.permissions));
  const editorRole = toDraft(current, catalog);
  // Кнопки подвала недоступны без правки и на время команды (aria-disabled — фокус остаётся на кнопке).
  const off = !dirty || saving;

  const holders = members.filter((m) =>
    grantsOf(m.id, assignments, groups, roles).some((g) => g.assignment.roleId === saved.id),
  );
  const driverRole = isDriverRole(saved);
  const heldByDriver = holders.some(isDriver);
  const earnings = current.builtIn || current.permissions.includes('fleet.earnings.read');

  const cashNow = cashOn(editorRole);
  const change = (next: RoleDraft) => {
    let permissions = toPermissions(current.permissions, editorRole, next, catalog);
    // Модуль «Касса» выключен — флажки блока уходят с ним; роли с функцией «Водитель» при включении — «Только свой
    // подотчёт» (saveRole эталона, A:439). Только при переключении модуля: правка названия права не трогает.
    const cashNext = cashOn(next);
    if (cashNow && !cashNext) {
      permissions = withFlag(withFlag(permissions, CASH_BALANCE, false), CASH_SELF, false);
    } else if (!cashNow && cashNext && driverRole) {
      permissions = withFlag(permissions, CASH_SELF, true);
    }
    setDraft({ roleId: saved.id, name: next.name, permissions });
  };

  const save = async () => {
    if (!mine) return;
    if (!mine.name.trim()) {
      toast(errors.mock.company.roleNameRequired, 'error');
      return;
    }
    const body: { name?: string; permissions?: string[] } = {};
    if (mine.name !== saved.name) body.name = mine.name.trim();
    if (!sameSet(mine.permissions, saved.permissions)) body.permissions = mine.permissions;
    try {
      await run(
        'srole',
        async () => {
          const path = { tenantId, roleId: saved.id };
          const tag = await etagOf(
            await api.GET('/api/v1/tenants/{tenantId}/roles/{roleId}', { params: { path } }),
            saved.revision,
          );
          return unwrap(
            await api.PATCH('/api/v1/tenants/{tenantId}/roles/{roleId}', {
              params: { path, header: { ...idem(), 'If-Match': tag } },
              body,
            }),
          );
        },
        format(T.company.roleSaved, { role: mine.name.trim() }),
      );
      // Права роли меняют права её держателей (и, возможно, свои): роли, explainAccess, /me/context.
      await refresh(['roles', 'explain', 'me']);
      focusName.current = true;
      setDraft(null);
    } catch {
      await refresh(['roles']);
    }
  };

  const facts = [
    { icon: 'extension', color: FACT_COLOR.info, text: E.facts.moduleNoRights },
    { icon: 'location_on', color: FACT_COLOR.info, text: E.facts.scopeOnAssign },
    earnings
      ? { icon: 'lock_open', color: FACT_COLOR.warn, text: E.facts.earningsVisible }
      : { icon: 'lock', color: FACT_COLOR.muted, text: E.facts.earningsHidden },
    { icon: 'shield', color: FACT_COLOR.accent, text: E.facts.isolation },
  ];

  return (
    <div className="ox-users-panel">
      <div className="ox-roles">
        <div className="ox-roles-list">
          {canManage ? (
            <button type="button" className="ox-users-btn" data-primary="" onClick={onCreate}>
              <Icon name="add" size={18} />
              {company.users.createRole}
            </button>
          ) : null}
          {roles.map((r) => {
            const kind = KIND[roleKind(r)];
            return (
              <button
                key={r.id}
                type="button"
                className="ox-role-btn"
                aria-pressed={r.id === saved.id}
                onClick={() => {
                  setDraft(null);
                  onSelect(r.id);
                }}
              >
                <span className="ox-role-btn-top">
                  <span className="ox-role-btn-name">{r.name}</span>
                  <span className="ox-role-kind ox-users-chip" data-tone={kind.tone}>
                    {kind.label}
                  </span>
                </span>{' '}
                <span className="ox-role-meta">{roleMeta(r, assignments)}</span>
              </button>
            );
          })}
        </div>
        <div className="ox-roles-main">
          <section ref={card} className="ox-role-card" aria-labelledby={editorId}>
            <Hidden id={editorId}>{PEOPLE_TEXT.a11y.editor}</Hidden>
            <RoleEditor
              key={saved.id}
              role={editorRole}
              catalog={catalog}
              initiallyOpen={['logistics']}
              driverBlocked={driverRole || heldByDriver}
              {...(driverRole
                ? { driverReason: 'role' as const }
                : heldByDriver
                  ? { driverReason: 'holder' as const }
                  : {})}
              onChange={change}
            />
            {!saved.builtIn && cashNow ? (
              <CashBlock
                permissions={current.permissions}
                driver={driverRole}
                readOnly={!canManage}
                onChange={(permissions) =>
                  setDraft({ roleId: saved.id, name: current.name, permissions })
                }
              />
            ) : null}
            {saved.builtIn || !canManage ? null : (
              <div className="ox-role-foot">
                {dirty ? <span className="ox-role-dirty">{E.dirty}</span> : null}
                <button
                  type="button"
                  className="ox-users-btn"
                  aria-disabled={off || undefined}
                  onClick={() => {
                    if (off) return;
                    focusName.current = true;
                    setDraft(null);
                  }}
                >
                  {shell.actions.revert}
                </button>
                <button
                  type="button"
                  className="ox-users-btn"
                  data-primary=""
                  aria-disabled={off || undefined}
                  onClick={() => {
                    if (!off) void save();
                  }}
                >
                  {saving ? shell.modal.saving : E.save}
                </button>
              </div>
            )}
          </section>
          <aside className="ox-role-aside" aria-labelledby={asideId}>
            <h3 id={asideId}>{E.summary}</h3>
            <span className="ox-role-holders">
              {holders.length
                ? format(E.holders, { names: holders.map((m) => m.displayName).join(', ') })
                : E.noHolders}
            </span>
            {!current.builtIn && current.permissions.length === 0 ? (
              <div className="ox-role-empty">{E.permsEmpty}</div>
            ) : null}
            <div className="ox-role-keys">
              {(current.builtIn ? ['*'] : summaryKeys(current.permissions, catalog)).map((k) => (
                <code key={k}>{k}</code>
              ))}
            </div>
            <Facts items={facts} />
          </aside>
        </div>
      </div>
    </div>
  );
}
