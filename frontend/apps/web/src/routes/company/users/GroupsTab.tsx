// W1.23 · Вкладка «Группы» (эталон design-stage-1 :320–332, usersVM :3156): пояснение, карточки групп
// («{n} участника: имена», «Роли через группу: …» / «Роли через группу не назначены»). Создание группы и
// состав — диалоги без эталона (S1-13): в эталоне кнопка «Создать группу · следующая итерация» выключена.
// Возврат 16.10 №3: listGroups 403 — «нет права»; без members.manage кнопок «Создать группу» и «Изменить состав»
// нет; роль без listRoles — «Роль не видна…»; участники вне области названы числом.
import { company, format } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import { type AccessData, noRight } from './data.ts';
import { groupMembersLine, scopeLabel, type Units } from './model.ts';
import { PEOPLE_TEXT } from './texts.ts';

export interface GroupsTabProps {
  data: AccessData;
  units: Units;
  /** Без них (нет права members.manage) кнопок создания и смены состава нет. */
  onCreate?: (() => void) | undefined;
  onEdit?: ((groupId: string) => void) | undefined;
}

export function GroupsTab({ data, units, onCreate, onEdit }: GroupsTabProps): ReactElement {
  if (noRight(data.groups)) {
    return (
      <div className="ox-users-panel">
        <p className="ox-users-empty">{PEOPLE_TEXT.groupsNoRight}</p>
      </div>
    );
  }
  const members = new Map((data.members.data ?? []).map((m) => [m.id, m.displayName]));
  const roles = new Map((data.roles.data ?? []).map((r) => [r.id, r.name]));
  const assignments = data.assignments.data ?? [];
  return (
    <div className="ox-users-panel">
      <p className="ox-users-text">{company.users.groupsIntro}</p>
      <div className="ox-groups">
        {(data.groups.data ?? []).map((g) => {
          const via = assignments.filter(
            (a) => a.principalType === 'group' && a.principalId === g.id && a.state !== 'expired',
          );
          return (
            <article key={g.id} className="ox-group">
              <div className="ox-group-head">
                <Icon name="groups" size={22} />
                <h3>{g.name}</h3>
              </div>
              <span className="ox-group-members">{groupMembersLine(g.memberIds, members)}</span>
              <span className="ox-group-roles">
                {via.length
                  ? format(company.users.groupRoles, {
                      roles: via
                        .map(
                          (a) =>
                            `${roles.get(a.roleId) ?? PEOPLE_TEXT.roleHidden} · ${scopeLabel(a.scope, units)}`,
                        )
                        .join('; '),
                    })
                  : company.users.groupNoRoles}
              </span>
              {onEdit ? (
                <button type="button" className="ox-users-btn" onClick={() => onEdit(g.id)}>
                  {PEOPLE_TEXT.group.edit}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      {onCreate ? (
        <button type="button" className="ox-users-btn ox-users-create-group" onClick={onCreate}>
          {PEOPLE_TEXT.createGroup}
        </button>
      ) : null}
    </div>
  );
}
