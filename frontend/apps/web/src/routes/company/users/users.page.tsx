// W1.23 · Страница «Пользователи и роли» (`/t/:tenantId/users`, ключ `users`; эталон design-stage-1
// «Ортус CRM.dc.html» :283–427, usersVM :3139–3166; 02-company §6): крошка, заголовок, вкладки «Люди»,
// «Группы», «Роли», «Проверка доступа» (вкладка и роль — в адресе: `?tab=…&role=…`), диалоги
// `src/modals/people`. Вход «Назначить роли» с других страниц — `?tab=people&assign=<участник>[&role=<роль>]`.
// Черновик роли — в состоянии страницы, как roleDraft эталона: смена вкладки его не теряет (возврат 16.10 №2).
// «Назначить роль» и «Передать владение» из карточки открываются поверх неё (фокус возвращается в карточку).
// Возврат 16.10 №3: если кнопки, открывшей диалог, больше нет (группа удалена, диалог открыт по адресу), фокус после
// закрытия — на «Создать группу», «Назначить роль» в строке участника или выбранную вкладку, а не на body; действия
// без права (members.invite, members.manage, roles.assign, roles.manage) не показываются.
import './users.css';

import { company, format, screenLabels, shell as shellTexts } from '@ortus/texts';
import { Tabs } from '@ortus/ui';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useCallback, useMemo, useRef, useState } from 'react';

import {
  AssignRoleDialog,
  CreateRoleDialog,
  GroupDialog,
  InviteDialog,
  MemberCardDialog,
  type PeopleCtx,
  TransferOwnerDialog,
} from '../../../modals/people/index.ts';
import { refocusIfLost } from '../../../modals/people/focus.ts';
import { useCan, useShell } from '../../../shell/context.tsx';
import { problemText } from '../../../shell/run.tsx';
import { BootSkeleton } from '../../../shell/states.tsx';
import { CheckTab } from './CheckTab.tsx';
import { noRight, useAccessData, useRefresh } from './data.ts';
import { GroupsTab } from './GroupsTab.tsx';
import { unitsOf } from './model.ts';
import { PeopleTab } from './PeopleTab.tsx';
import { type RoleEdit, RolesTab } from './RolesTab.tsx';
import { PEOPLE_TEXT } from './texts.ts';

type Tab = 'people' | 'groups' | 'roles' | 'check';
const TABS: readonly Tab[] = ['people', 'groups', 'roles', 'check'];

type Dialog =
  | { kind: 'assign'; memberId: string; roleId?: string | undefined }
  | { kind: 'invite' }
  | { kind: 'createRole' }
  | { kind: 'card'; memberId: string; over?: 'assign' | 'transfer' }
  | { kind: 'group'; groupId?: string | undefined };

type Search = Partial<Record<'tab' | 'role' | 'assign' | 'invite', string>>;

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export default function UsersPage(): ReactElement {
  const shell = useShell();
  const can = useCan();
  const tenantId = shell.tenantId ?? '';
  const root = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const raw = location.search as Record<string, unknown>;
  const search: Search = {
    tab: text(raw.tab),
    role: text(raw.role),
    assign: text(raw.assign),
    // Роутер разбирает ?invite=1 как число: значение — строкой.
    invite: raw.invite === undefined ? undefined : String(raw.invite),
  };
  const tab: Tab = TABS.includes(search.tab as Tab) ? (search.tab as Tab) : 'people';
  const data = useAccessData(tenantId);
  const refresh = useRefresh(tenantId);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [roleDraft, setRoleDraft] = useState<RoleEdit | null>(null);

  const go = useCallback(
    (next: Search) =>
      void navigate({
        to: '/t/$tenantId/$page',
        params: { tenantId, page: 'users' },
        search: Object.fromEntries(
          Object.entries(next).filter(([, v]) => v !== undefined),
        ) as never,
      }),
    [navigate, tenantId],
  );

  const me = (data.members.data ?? []).find((m) => m.userId === shell.me.userId);
  const home = me?.orgUnitIds;
  const projectNames = useMemo(
    () => new Map((data.projects.data ?? []).map((p) => [p.id, p.name])),
    [data.projects.data],
  );
  const units = useMemo(
    () => unitsOf(data.units.data ?? [], home, projectNames, data.cashAccounts.data ?? []),
    [data.units.data, home, projectNames, data.cashAccounts.data],
  );
  const modules = shell.tenant?.modules;
  const installed = useCallback(
    (key: string) =>
      (modules ?? []).some(
        (m) => m.moduleKey === key && (m.state === 'active' || m.state === 'draining'),
      ),
    [modules],
  );
  const ctx: PeopleCtx = {
    tenantId,
    tenantName: shell.tenant?.name ?? '',
    data,
    units,
    installed,
    me,
    meOwner: (data.owners.data?.items ?? []).some((o) => o.memberId === me?.id),
    refresh,
    can: (permission) => can(permission),
  };
  const canInvite = can('members.invite');
  const canGroups = can('members.manage');
  const canAssign = can('roles.assign') && !noRight(data.roles);

  // Отказ по праву (403) — раздел без данных, а не сбой страницы: гейт пускает с members.read или roles.read,
  // и у участника может не быть права на часть списков (бриф §1). Сбой — любая другая ошибка.
  const core = [data.members, data.roles, data.assignments, data.groups, data.units];
  const failed = core.find((q) => q.isError && !noRight(q));
  const loading = core.some((q) => q.isPending);
  const ready = !failed && !loading;
  // Вход «Назначить роль» по адресу: диалог из адреса, пока он не закрыт (закрытие очищает адрес). Участник —
  // из списка и не заблокирован (как кнопка строки); роль — только из опций диалога (не системная).
  const target = (data.members.data ?? []).find((m) => m.id === search.assign);
  const urlRole = (data.roles.data ?? []).some((r) => r.id === search.role && !r.builtIn)
    ? search.role
    : undefined;
  // W4.61: «Пригласить» со страницы «Подписка и места» (billingVM :3955) — ?invite=1 открывает приглашение.
  const fromUrl: Dialog | null =
    ready && target && target.status !== 'suspended' && canAssign
      ? { kind: 'assign', memberId: target.id, roleId: urlRole }
      : ready && search.invite === '1' && canInvite
        ? { kind: 'invite' }
        : null;
  const shown = dialog ?? fromUrl;

  const tabs = [
    { id: 'people', label: company.users.tabs.people, badge: data.members.data?.length ?? '' },
    { id: 'groups', label: company.users.tabs.groups, badge: data.groups.data?.length ?? '' },
    { id: 'roles', label: company.users.tabs.roles, badge: data.roles.data?.length ?? '' },
    { id: 'check', label: company.users.tabs.check },
  ];

  let content: ReactElement;
  if (failed) {
    content = (
      <div role="alert" className="ox-users-error">
        <span>{format(PEOPLE_TEXT.loadError, { error: problemText(failed.error) })}</span>
        <button type="button" className="ox-users-btn" onClick={() => void refresh()}>
          {PEOPLE_TEXT.retry}
        </button>
      </div>
    );
  } else if (loading) {
    content = <BootSkeleton />;
  } else if (tab === 'groups') {
    content = (
      <GroupsTab
        data={data}
        units={units}
        onCreate={canGroups ? () => setDialog({ kind: 'group' }) : undefined}
        onEdit={canGroups ? (groupId) => setDialog({ kind: 'group', groupId }) : undefined}
      />
    );
  } else if (tab === 'roles') {
    content = (
      <RolesTab
        tenantId={tenantId}
        data={data}
        installed={installed}
        selected={search.role}
        draft={roleDraft}
        onDraft={setRoleDraft}
        onSelect={(role) => go({ tab: 'roles', role })}
        onCreate={() => setDialog({ kind: 'createRole' })}
        canManage={can('roles.manage')}
        refresh={refresh}
      />
    );
  } else if (tab === 'check') {
    content = <CheckTab tenantId={tenantId} data={data} units={units} />;
  } else {
    content = (
      <PeopleTab
        data={data}
        units={units}
        onInvite={canInvite ? () => setDialog({ kind: 'invite' }) : undefined}
        onAssign={canAssign ? (memberId) => setDialog({ kind: 'assign', memberId }) : undefined}
        onCard={(memberId) => setDialog({ kind: 'card', memberId })}
      />
    );
  }

  // Запасная цель фокуса, если кнопки-источника нет: «Назначить роль» в строке участника (диалог по адресу),
  // «Создать группу» (группа удалена), иначе выбранная вкладка.
  const fallback = (was: Dialog | null) => (): HTMLElement | null | undefined => {
    const el = root.current;
    if (!el) return null;
    const pick =
      was?.kind === 'assign'
        ? el.querySelector<HTMLElement>(`[data-member="${was.memberId}"] [data-assign]`)
        : was?.kind === 'group'
          ? el.querySelector<HTMLElement>('.ox-users-create-group')
          : null;
    return pick ?? el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  };

  const close = () => {
    const was = shown;
    setDialog(null);
    if (search.assign || search.invite) go({ tab: 'people' });
    refocusIfLost(fallback(was));
  };

  return (
    <section
      ref={root}
      aria-labelledby="h-users"
      className="ox-users"
      data-screen-label={screenLabels.byPage.users}
    >
      <div className="ox-users-head">
        <div className="ox-users-crumb">
          {format(company.crumbs.access, { tenant: shell.tenant?.name ?? '' })}
        </div>
        <h1 id="h-users" className="ox-users-title">
          {shellTexts.nav.items.users}
        </h1>
        <p className="ox-users-intro">{company.users.intro}</p>
      </div>
      <Tabs
        items={tabs}
        value={tab}
        onChange={(id) => go({ tab: id })}
        aria-label={company.users.tabsAria}
      >
        {content}
      </Tabs>
      {shown?.kind === 'assign' ? (
        <AssignRoleDialog
          ctx={ctx}
          memberId={shown.memberId}
          roleId={shown.roleId}
          onClose={close}
        />
      ) : null}
      {shown?.kind === 'invite' ? (
        <InviteDialog
          ctx={ctx}
          onClose={close}
          onBilling={() => {
            close();
            shell.go('billing');
          }}
        />
      ) : null}
      {shown?.kind === 'createRole' ? (
        <CreateRoleDialog
          ctx={ctx}
          onClose={close}
          onCreated={(role) => {
            close();
            go({ tab: 'roles', role });
          }}
        />
      ) : null}
      {shown?.kind === 'card' ? (
        <MemberCardDialog
          ctx={ctx}
          memberId={shown.memberId}
          onClose={close}
          onAssign={() => setDialog({ ...shown, over: 'assign' })}
          onTransfer={() => setDialog({ ...shown, over: 'transfer' })}
        >
          {shown.over === 'assign' ? (
            <AssignRoleDialog
              ctx={ctx}
              memberId={shown.memberId}
              onClose={() => setDialog({ kind: 'card', memberId: shown.memberId })}
            />
          ) : null}
          {shown.over === 'transfer' ? (
            <TransferOwnerDialog
              ctx={ctx}
              memberId={shown.memberId}
              onClose={() => setDialog({ kind: 'card', memberId: shown.memberId })}
            />
          ) : null}
        </MemberCardDialog>
      ) : null}
      {shown?.kind === 'group' ? (
        <GroupDialog ctx={ctx} groupId={shown.groupId} onClose={close} />
      ) : null}
    </section>
  );
}
