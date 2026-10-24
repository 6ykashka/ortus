// W4.13 · Вкладка проекта «Участники» (`tasks-people`; эталон design-2026-10-19 «Задачи и проекты.dc.html» :197–231,
// логика :439–455): «Кто видит проект» (updateTaskProject, If-Match — ETag проекта), добавление и смена роли
// (setTaskProjectMemberRole), исключение (removeTaskProjectMember), таблица «Сотрудник / Роль в проекте / Откуда
// доступ / Что может», «Проверить доступ» (checkTaskProjectAccess — у кого «Настраивать» в проекте или members.read,
// Q-W4.00-tasks-7), «Роли проекта». Правка — tasks.members.manage в проекте; без него — только чтение.
import { Icon } from '@ortus/ui';
import { format } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useCan } from '../../../../shell/context.tsx';
import { LoadFailed } from '../../../company/modules/ui.tsx';
import {
  idemKeys,
  projectKey,
  refreshAfter,
  removeMember,
  setAccess,
  setRole,
  useAccessCheck,
  useMembers,
  usePeople,
  useProject,
} from './api.ts';
import {
  accessDesc,
  accessLabel,
  candidates,
  CHECK_ACTION,
  checkPeople,
  checkText,
  defaultCheckMember,
  defaultRole,
  LEVELS,
  memberRows,
  roleCaps,
  type Verb,
  verbLabel,
  VERBS,
} from './model.ts';
import { TS } from './texts.ts';
import { Skeleton, useCommand, useMeMember } from './ui.tsx';

const P = TS.people;

export function PeopleTab({
  tenantId,
  projectId,
}: {
  tenantId: string;
  projectId: string;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const command = useCommand();
  const can = useCan();
  const [keys] = useState(idemKeys);
  const project = useProject(tenantId, projectId);
  const members = useMembers(tenantId, projectId);
  const mine = project.data?.data.myAccess?.actions ?? [];
  const canEdit = mine.includes('tasks.members.manage');
  const mayCheck = canEdit || can('members.read');
  const people = usePeople(tenantId, can('members.read'));
  const rows = members.data?.items ?? [];
  const roles = members.data?.roles ?? [];
  const meId = useMeMember(people.data, rows);
  const [addM, setAddM] = useState('');
  const [addR, setAddR] = useState<string | null>(null);
  const [chkM, setChkM] = useState<string | null>(null);
  const [chkV, setChkV] = useState<Verb>('review');
  const checkMember = chkM ?? defaultCheckMember(rows);
  const checked = useAccessCheck(
    tenantId,
    projectId,
    checkMember,
    CHECK_ACTION[chkV],
    mayCheck && members.isSuccess,
  );

  // Проект, затем участники с проверкой доступа и данные хоста (список проектов смонтирован всё время: после
  // «← Проекты» столбцы «Доступ» и «Люди» — новые, как в эталоне). Доступ потерян — только проект (сигнал хосту).
  const refresh = () => refreshAfter(qc, tenantId, projectId);

  if (project.isError || members.isError) {
    const error = project.isError ? project.error : members.error;
    return (
      <div className="ox-tset">
        <LoadFailed
          error={error}
          onRetry={() => {
            void project.refetch();
            void members.refetch();
          }}
        />
      </div>
    );
  }
  if (!project.data || !members.data) {
    return (
      <div className="ox-tset">
        <Skeleton />
      </div>
    );
  }

  const level = project.data.data.access ?? 'limited';
  const role = addR ?? defaultRole(roles) ?? '';
  const cands = candidates(people.data ?? null, rows);
  const pool = checkPeople(people.data ?? null, rows);
  const checkName = pool.find((o) => o.value === checkMember)?.label ?? '';

  const cmd = async <R,>(body: unknown, fn: (key: string) => Promise<R>, ok: string) => {
    const r = await command('tasks-people', () => fn(keys.key(body)), ok, {
      settle: () => keys.settle(body),
    });
    await refresh();
    return r;
  };

  const onLevel = (l: typeof level) => {
    const cur = project.data;
    if (!cur || l === level) return;
    void cmd(
      { access: l },
      async (key) => {
        const next = await setAccess(api, tenantId, cur, l, key);
        // Ответ — новый ETag проекта (ключ общий с шапкой хоста W4.12): следующий уровень идёт с ним, не дожидаясь
        // перечитывания проекта (иначе If-Match прежнего ответа — 412).
        qc.setQueryData(projectKey(tenantId, projectId), next);
        return next;
      },
      format(TS.access.toast, { level: accessLabel(l).toLowerCase() }),
    );
  };
  const onAdd = async () => {
    if (!addM || !role) return;
    const r = await cmd(
      { add: addM, role },
      (key) => setRole(api, tenantId, projectId, addM, role, key),
      P.assigned,
    );
    if (r) setAddM('');
  };
  const onRole = (memberId: string, roleId: string) =>
    void cmd(
      { set: memberId, roleId },
      (key) => setRole(api, tenantId, projectId, memberId, roleId, key),
      P.changed,
    );
  const onRemove = (memberId: string, name: string) =>
    void cmd(
      { remove: memberId },
      (key) => removeMember(api, tenantId, projectId, memberId, key),
      format(P.removed, { name }),
    );

  const res = checked.data;
  return (
    <div className="ox-tset">
      <div className="ox-tset-main">
        <div className="ox-tset-acc">
          <span className="ox-tset-acc-text">
            <strong>{TS.access.title}</strong>
            <span>{accessDesc(level)}</span>
          </span>
          <div role="group" aria-label={TS.access.group} className="ox-tset-seg">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={l === level ? 'true' : 'false'}
                disabled={!canEdit}
                onClick={() => onLevel(l)}
              >
                {accessLabel(l)}
              </button>
            ))}
          </div>
        </div>
        {canEdit ? (
          <div className="ox-tset-add">
            <select
              aria-label={P.member}
              className="ox-tset-select"
              data-grow="member"
              value={addM}
              onChange={(e) => setAddM(e.target.value)}
            >
              <option value="">{P.member}</option>
              {cands.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              aria-label={P.role}
              className="ox-tset-select"
              data-grow="role"
              value={role}
              onChange={(e) => setAddR(e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.roleId} value={r.roleId}>
                  {r.name}
                </option>
              ))}
            </select>
            <button type="button" className="ox-tset-primary" onClick={() => void onAdd()}>
              {P.add}
            </button>
          </div>
        ) : null}
        {/* На телефоне таблица прокручивается вбок: область с фокусом — столбцы справа доступны с клавиатуры и
            без полей в строках (только чтение; axe scrollable-region-focusable). */}
        <div className="ox-tset-table" role="region" aria-label={TS.tabs.people} tabIndex={0}>
          <div className="ox-tset-mhead">
            <span>{P.headMember}</span>
            <span>{P.headRole}</span>
            <span>{P.headSource}</span>
            <span>{P.headCaps}</span>
            <span />
          </div>
          {memberRows(rows, { canEdit, meId }).map((m) => (
            <div key={m.id} className="ox-tset-mrow">
              <span className="ox-tset-who">
                <span className="ox-tset-ava" aria-hidden="true">
                  {m.ini}
                </span>
                <span className="ox-tset-names">
                  <strong className="ox-tset-mname">{m.name}</strong>
                </span>
              </span>
              {m.editable ? (
                <select
                  aria-label={format(P.roleAria, { name: m.name })}
                  className="ox-tset-rolesel"
                  value={m.roleId}
                  onChange={(e) => onRole(m.id, e.target.value)}
                >
                  {roles.map((r) => (
                    <option key={r.roleId} value={r.roleId}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="ox-tset-lock">
                  <Icon name="lock" size={16} />
                  {m.roleName}
                </span>
              )}
              <span className="ox-tset-src" data-muted={m.muted ? '' : undefined}>
                {m.via}
              </span>
              <span className="ox-tset-caps">
                {m.caps.map((c) => (
                  <span key={c} className="ox-tset-cap">
                    {c}
                  </span>
                ))}
              </span>
              {m.canDel ? (
                <button
                  type="button"
                  className="ox-tset-del"
                  aria-label={format(P.removeAria, { name: m.name })}
                  onClick={() => onRemove(m.id, m.name)}
                >
                  <Icon name="person_remove" size={18} />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        <span className="ox-tset-hint">{P.note}</span>
      </div>
      <aside className="ox-tset-side">
        {mayCheck ? (
          <div className="ox-tset-box ox-tset-check">
            <h3 className="ox-tset-h3" data-icon="">
              <Icon name="policy" size={20} />
              {P.checkTitle}
            </h3>
            <select
              aria-label={P.member}
              className="ox-tset-select"
              data-size="check"
              value={checkMember ?? ''}
              onChange={(e) => setChkM(e.target.value)}
            >
              {pool.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              aria-label={P.checkAction}
              className="ox-tset-select"
              data-size="check"
              value={chkV}
              onChange={(e) => setChkV(e.target.value as Verb)}
            >
              {VERBS.map((v) => (
                <option key={v} value={v}>
                  {verbLabel(v)}
                </option>
              ))}
            </select>
            {checked.isError ? (
              <LoadFailed error={checked.error} onRetry={() => void checked.refetch()} />
            ) : (
              <div
                className="ox-tset-chk"
                data-ok={res ? (res.allowed ? 'true' : 'false') : undefined}
              >
                <Icon name={res && !res.allowed ? 'block' : 'check_circle'} size={18} />
                <span className="ox-tset-chk-text">{res ? checkText(checkName, res) : ''}</span>
              </div>
            )}
          </div>
        ) : null}
        <div className="ox-tset-box ox-tset-roles" data-gap="8">
          <h3 className="ox-tset-h3">{P.rolesTitle}</h3>
          {roles.map((r) => (
            <div key={r.roleId} className="ox-tset-role">
              <strong>{r.name}</strong>
              <span>{roleCaps(r)}</span>
            </div>
          ))}
          <span className="ox-tset-hint">{P.rolesNote}</span>
        </div>
      </aside>
    </div>
  );
}
