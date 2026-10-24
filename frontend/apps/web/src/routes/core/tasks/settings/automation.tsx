// W4.13 · Вкладка проекта «Автоматизация» (`tasks-automation`; эталон design-2026-10-19 «Задачи и проекты.dc.html»
// :277–311, логика :478–489): правила (listTaskAutomations) — «Когда … → …», «От имени {автор} · v{N} · запусков: {n}»,
// «Включено» (updateTaskAutomation), удаление (deleteTaskAutomation); «Новое правило» (createTaskAutomation; ошибка —
// в форме текстом сервера); «Журнал запусков» (listTaskAutomationRuns). Статусы триггера — опубликованный процесс
// (сервер сверяет с ним), «Назначить на» — участники проекта. Правка — tasks.automation.manage в проекте.
import type { components } from '@ortus/api-client';
import { Icon } from '@ortus/ui';
import { format } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { LoadFailed } from '../../../company/modules/ui.tsx';
import {
  automationsKey,
  createRule,
  deleteRule,
  idemKeys,
  projectKey,
  updateRule,
  useAutomations,
  useMembers,
  useProject,
  useRuns,
  useWorkflow,
} from './api.ts';
import { type Priority, PRIORITIES, priorityLabel, ruleMeta, ruleText, runLine } from './model.ts';
import { TS } from './texts.ts';
import { Skeleton, useCommand } from './ui.tsx';

type S = components['schemas'];
const A = TS.automation;

interface NewRule {
  name: string;
  trigger: 'created' | 'status';
  to: string;
  prio: Priority | '';
  kind: S['TaskAutomationAction']['kind'];
  value: string;
}

const EMPTY: NewRule = {
  name: '',
  trigger: 'created',
  to: '',
  prio: '',
  kind: 'assign',
  value: '',
};

export function AutomationTab({
  tenantId,
  projectId,
}: {
  tenantId: string;
  projectId: string;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const command = useCommand();
  const [keys] = useState(idemKeys);
  const project = useProject(tenantId, projectId);
  const rulesQ = useAutomations(tenantId, projectId);
  const runsQ = useRuns(tenantId, projectId);
  const wf = useWorkflow(tenantId, projectId);
  const members = useMembers(tenantId, projectId);
  const [n, setN] = useState<NewRule>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  // Время журнала «сегодня — ЧЧ:ММ» — по часам открытия вкладки.
  const [now] = useState(() => Date.now());

  // Участники — часть данных вкладки: без них «Сотрудник» пуст, а текст правила — «назначить на —».
  const failed = [project, rulesQ, runsQ, wf, members].find((q) => q.isError);
  if (failed) {
    return (
      <div className="ox-tset">
        <LoadFailed
          error={failed.error}
          onRetry={() => {
            for (const q of [project, rulesQ, runsQ, wf, members]) if (q.isError) void q.refetch();
          }}
        />
      </div>
    );
  }
  if (!project.data || !rulesQ.data || !runsQ.data || !wf.data || !members.data) {
    return (
      <div className="ox-tset">
        <Skeleton />
      </div>
    );
  }

  const canEdit = (project.data.data.myAccess?.actions ?? []).includes('tasks.automation.manage');
  const statuses = wf.data.data.statuses;
  const people = members.data.items.filter((m) => m.memberStatus !== 'suspended');
  const names = new Map(people.map((m) => [m.memberId, m.displayName]));
  const rules = rulesQ.data;
  const runs = runsQ.data;
  const to = n.to || statuses[0]?.id || '';
  const refresh = () => qc.invalidateQueries({ queryKey: projectKey(tenantId, projectId) });
  const rulesKey = automationsKey(tenantId, projectId);
  const setNew = (patch: Partial<NewRule>) => {
    setN({ ...n, ...patch });
    setErr(null);
  };

  const cmd = async <R,>(
    body: unknown,
    fn: (key: string) => Promise<R>,
    ok: string,
    inline?: (text: string) => void,
  ) => {
    const settle = () => keys.settle(body);
    const r = await command(
      'tasks-automation',
      () => fn(keys.key(body)),
      ok,
      inline ? { inline, settle } : { settle },
    );
    await refresh();
    return r;
  };

  const onToggle = (r: S['TaskAutomation'], on: boolean) =>
    void cmd(
      { toggle: r.id, on, rev: r.revision },
      async (key) => {
        const next = await updateRule(api, tenantId, r, { enabled: on }, key);
        // Ответ — новая ревизия правила: следующая команда («Удалить», повторное «Включено») идёт с ней, не
        // дожидаясь перечитывания списка (иначе If-Match прежней ревизии — 412).
        qc.setQueryData<S['TaskAutomation'][]>(rulesKey, (xs) =>
          xs?.map((x) => (x.id === next.id ? next : x)),
        );
        return next;
      },
      on ? A.on : A.off,
    );
  const onDelete = (r: S['TaskAutomation']) =>
    void cmd(
      { delete: r.id, rev: r.revision },
      (key) => deleteRule(api, tenantId, r, key),
      A.removed,
    );
  const onSave = async () => {
    // Ошибки формы эталона (saveAutomation, api.js :731–733) — до запроса; сервер проверяет то же.
    const local = !n.name.trim()
      ? A.noName
      : n.trigger === 'status' && !to
        ? A.noStatus
        : !n.value.trim()
          ? A.noAction
          : null;
    if (local) {
      setErr(local);
      return;
    }
    const action: S['TaskAutomationAction'] =
      n.kind === 'assign'
        ? { kind: 'assign', ...(n.value ? { memberId: n.value } : {}) }
        : n.kind === 'set_priority'
          ? { kind: 'set_priority', ...(n.value ? { priority: n.value as Priority } : {}) }
          : { kind: 'comment', text: n.value };
    const body: S['TaskAutomationCreate'] = {
      name: n.name,
      trigger:
        n.trigger === 'status' ? { kind: 'status_entered', statusId: to } : { kind: 'created' },
      action,
      enabled: true,
      ...(n.prio ? { condition: { priority: n.prio } } : {}),
    };
    const r = await cmd(
      body,
      (key) => createRule(api, tenantId, projectId, body, key),
      A.added,
      setErr,
    );
    if (r) {
      setN(EMPTY);
      setErr(null);
    }
  };

  return (
    <div className="ox-tset">
      <div className="ox-tset-main" data-basis="520" data-gap="10">
        {rules.map((r) => (
          <div key={r.id} className="ox-tset-rule">
            <span className="ox-tset-rule-text">
              <strong id={`ox-rule-${r.id}`}>{r.name}</strong>
              <span className="ox-tset-rule-when">{ruleText(r, statuses, names)}</span>
              <span className="ox-tset-rule-meta">{ruleMeta(r)}</span>
            </span>
            {/* Имя флажка — «Включено» и название правила: строки различимы для чтения с экрана. */}
            <label className="ox-tset-check-row" data-inline="">
              <input
                type="checkbox"
                checked={r.enabled}
                disabled={!canEdit}
                aria-labelledby={`ox-rule-${r.id}-on ox-rule-${r.id}`}
                onChange={(e) => onToggle(r, e.target.checked)}
              />
              <span id={`ox-rule-${r.id}-on`}>{A.enabled}</span>
            </label>
            {canEdit ? (
              <button
                type="button"
                className="ox-tset-del"
                data-size="32"
                aria-label={format(A.removeAria, { name: r.name })}
                onClick={() => onDelete(r)}
              >
                <Icon name="delete" size={18} />
              </button>
            ) : null}
          </div>
        ))}
        {rules.length ? null : <div className="ox-tset-empty">{A.noRules}</div>}
        {canEdit ? (
          <div className="ox-tset-box ox-tset-newrule" data-gap="10">
            <h3 className="ox-tset-h3">{A.newRule}</h3>
            <input
              className="ox-tset-input"
              data-size="lg"
              value={n.name}
              placeholder={A.name}
              aria-label={A.name}
              onChange={(e) => setNew({ name: e.target.value })}
            />
            <div className="ox-tset-clause">
              <b data-tone="when">{A.when}</b>
              <select
                className="ox-tset-select"
                data-size="sm"
                aria-label={A.whenAria}
                value={n.trigger}
                onChange={(e) => setNew({ trigger: e.target.value as NewRule['trigger'] })}
              >
                <option value="created">{A.created}</option>
                <option value="status">{A.statusEntered}</option>
              </select>
              {n.trigger === 'status' ? (
                <select
                  className="ox-tset-select"
                  data-size="sm"
                  aria-label={A.statusAria}
                  value={to}
                  onChange={(e) => setNew({ to: e.target.value })}
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <div className="ox-tset-clause">
              <b data-tone="if">{A.if}</b>
              <select
                className="ox-tset-select"
                data-size="sm"
                aria-label={A.ifAria}
                value={n.prio}
                onChange={(e) => setNew({ prio: e.target.value as NewRule['prio'] })}
              >
                <option value="">{A.all}</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {format(A.priorityIs, { p: priorityLabel(p) })}
                  </option>
                ))}
              </select>
            </div>
            <div className="ox-tset-clause">
              <b data-tone="then">{A.then}</b>
              <select
                className="ox-tset-select"
                data-size="sm"
                aria-label={A.thenAria}
                value={n.kind}
                onChange={(e) => setNew({ kind: e.target.value as NewRule['kind'], value: '' })}
              >
                <option value="assign">{A.assign}</option>
                <option value="set_priority">{A.setPriority}</option>
                <option value="comment">{A.comment}</option>
              </select>
              {n.kind === 'assign' ? (
                <select
                  className="ox-tset-select"
                  data-size="sm"
                  aria-label={A.member}
                  value={n.value}
                  onChange={(e) => setNew({ value: e.target.value })}
                >
                  <option value="">{A.member}</option>
                  {people.map((m) => (
                    <option key={m.memberId} value={m.memberId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              ) : null}
              {n.kind === 'set_priority' ? (
                <select
                  className="ox-tset-select"
                  data-size="sm"
                  aria-label={A.priority}
                  value={n.value}
                  onChange={(e) => setNew({ value: e.target.value })}
                >
                  <option value="">{A.priority}</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {priorityLabel(p)}
                    </option>
                  ))}
                </select>
              ) : null}
              {n.kind === 'comment' ? (
                <input
                  className="ox-tset-input"
                  data-grow="comment"
                  value={n.value}
                  placeholder={A.commentText}
                  aria-label={A.commentText}
                  onChange={(e) => setNew({ value: e.target.value })}
                />
              ) : null}
            </div>
            <span className="ox-tset-hint">{A.note}</span>
            {err ? (
              <span role="alert" className="ox-tset-err">
                {err}
              </span>
            ) : null}
            <button
              type="button"
              className="ox-tset-primary"
              data-size="md"
              data-self="start"
              onClick={() => void onSave()}
            >
              {A.save}
            </button>
          </div>
        ) : null}
      </div>
      <div className="ox-tset-box ox-tset-runs" data-gap="6">
        <h3 className="ox-tset-h3">{A.runs}</h3>
        {runs.map((x) => {
          const l = runLine(x, now);
          return (
            <div key={x.id} className="ox-tset-run">
              <span
                className={`material-symbols-rounded ox-tset-run-ic ox-tset-tone-${l.tone}`}
                aria-hidden="true"
              >
                {l.icon}
              </span>
              <span className="ox-tset-run-text">
                <span>{l.text}</span>
                <span className="ox-tset-run-meta">{l.meta}</span>
              </span>
            </div>
          );
        })}
        {runs.length ? null : <span className="ox-tset-muted">{A.noRuns}</span>}
      </div>
    </div>
  );
}
