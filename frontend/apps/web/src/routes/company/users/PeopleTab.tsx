// W1.23 · Вкладка «Люди» (эталон design-stage-1 :296–318, usersVM :3145–3155): строка «{N} участников ·
// без роли · мест занято», «Пригласить», список участников — аватар, имя (открывает карточку, no-reference),
// почта, статус, назначения «{роль} · {область}[ · до …][ · через группу «…»]», «Без роли — нет доступа к
// модулям», функция «Водитель», «Назначить роль» (выключена у заблокированного). Возврат 16.10 №3: listMembers 403 —
// «нет права» (а не пустой список с «Пригласить»); без права members.invite «Пригласить» нет.
import { initials } from '@ortus/domain';
import { company } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useId } from 'react';

import { type AccessData, noRight } from './data.ts';
import {
  grantLine,
  grantsOf,
  isDriver,
  memberChip,
  noRoleCount,
  peopleNote,
  seatsOf,
  type Units,
} from './model.ts';
import { Chip, Hidden } from './parts.tsx';
import { PEOPLE_TEXT } from './texts.ts';

export interface PeopleTabProps {
  data: AccessData;
  units: Units;
  /** Без него (нет права members.invite) кнопки «Пригласить» нет. */
  onInvite?: (() => void) | undefined;
  /** Без него (нет права на роли) кнопки «Назначить роль» нет. */
  onAssign?: ((memberId: string) => void) | undefined;
  onCard: (memberId: string) => void;
}

export function PeopleTab({
  data,
  units,
  onInvite,
  onAssign,
  onCard,
}: PeopleTabProps): ReactElement {
  const listId = useId();
  if (noRight(data.members)) {
    return (
      <div className="ox-users-panel">
        <p className="ox-users-empty">{PEOPLE_TEXT.membersNoRight}</p>
      </div>
    );
  }
  const members = data.members.data ?? [];
  const assignments = data.assignments.data ?? [];
  const groups = data.groups.data ?? [];
  const roles = data.roles.data ?? [];
  // Нет права на назначения (403) — назначения и «без роли» не показываются: их нельзя вычислить.
  const grantsKnown = !noRight(data.assignments);
  const note = peopleNote(
    members.length,
    grantsKnown ? noRoleCount(members, assignments, groups) : 0,
    seatsOf(members, data.subscription.data),
  );
  return (
    <div className="ox-users-panel">
      <div className="ox-users-bar">
        <span className="ox-users-note">{note}</span>
        {onInvite ? (
          <button type="button" className="ox-users-btn" data-primary="" onClick={onInvite}>
            <Icon name="person_add" size={18} />
            {company.users.invite}
          </button>
        ) : null}
      </div>
      <Hidden id={listId}>{PEOPLE_TEXT.a11y.people}</Hidden>
      <ul className="ox-people" aria-labelledby={listId}>
        {members.map((m) => {
          const chip = memberChip(m.status);
          const grants = grantsOf(m.id, assignments, groups, roles);
          return (
            <li key={m.id} className="ox-person" data-member={m.id}>
              <div className="ox-person-who">
                <span className="ox-person-avatar" aria-hidden="true">
                  {initials(m.displayName)}
                </span>
                <div className="ox-person-id">
                  <button type="button" className="ox-person-name" onClick={() => onCard(m.id)}>
                    {m.displayName}
                  </button>
                  <span className="ox-person-email">{m.email ?? ''}</span>
                </div>
              </div>
              <div className="ox-person-state">
                <Chip tone={chip.tone} icon={chip.icon}>
                  {chip.label}
                </Chip>
              </div>
              <div className="ox-person-grants">
                {grants.map((g) => {
                  const line = grantLine(g, units);
                  return (
                    <div key={g.assignment.id} className="ox-grant">
                      <span className="ox-grant-role">{line.role}</span>
                      <span className="ox-grant-muted">· {line.scope}</span>
                      {line.via ? <span className="ox-grant-muted">· {line.via}</span> : null}
                    </div>
                  );
                })}
                {grants.length || !grantsKnown ? null : (
                  <span className="ox-person-norole">
                    <Icon name="info" size={16} />
                    {company.users.noRole}
                  </span>
                )}
                {isDriver(m) ? (
                  <span className="ox-person-driver">{company.users.driverNote}</span>
                ) : null}
              </div>
              {onAssign ? (
                <button
                  type="button"
                  className="ox-users-btn"
                  data-flat=""
                  data-assign=""
                  disabled={m.status === 'suspended'}
                  onClick={() => onAssign(m.id)}
                >
                  {company.users.assignRole}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
