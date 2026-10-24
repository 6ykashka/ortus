// W4.13 · Старая доска «Заявки» (`tasks-leads`, `/t/:tenantId/leads` — ADR-0001; эталон design-2026-10-19
// «Ортус CRM.dc.html» :1600–1705, tasksVM :4443–4504). Судьба доски — Q-W4.00-tasks-15 по умолчанию: переносится как
// есть на API воронки (проект `flow: leads`, этапы фиксированы): «Канбан / Список», «Все исполнители / Мои задачи»,
// форма «Задача», карточка заявки («Перевести» — availableTransitions сервера, чек-лист, «История и комментарии»).
// Переход «Объект» отдаёт сервер (создание объекта в «Ремонте и стройке» — этап 6). Карточка — `?task=` (no-reference
// адреса), воронка — `?project=` при нескольких воронках.
import type { components } from '@ortus/api-client';
import { PRIORITY, WORKFLOWS } from '@ortus/domain/modules';
import { format } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { LoadFailed } from '../../company/modules/ui.tsx';
import { idemKeys, usePeople } from '../tasks/settings/api.ts';
import { Skeleton, useCommand, useMeMember } from '../tasks/settings/ui.tsx';
import {
  checkItem,
  comment,
  createLead,
  dueAtOf,
  type LeadCreate,
  leadsKey,
  moveLead,
  useAssignees,
  useHistory,
  useLead,
  useLeads,
  useProjects,
  useStages,
} from './api.ts';
import { cardOf, chipOf, columnsOf, historyLines, movesOf, prioOf } from './model.ts';
import { TL } from './texts.ts';
import '../../company/modules/modules.css';
import '../tasks/settings/settings.css';
import './leads.css';

type S = components['schemas'];
type Priority = S['TaskPriority'];
const PRIOS = Object.keys(PRIORITY) as Priority[];

interface NewTask {
  title: string;
  assignee: string;
  priority: Priority;
  due: string;
  err: string | null;
}

interface LeadsSearch {
  project?: string;
  task?: string;
}

const searchOf = (raw: Record<string, unknown>): LeadsSearch => ({
  ...(typeof raw.project === 'string' && raw.project ? { project: raw.project } : {}),
  ...(typeof raw.task === 'string' && raw.task ? { task: raw.task } : {}),
});

/** Значок Material Symbols любого размера эталона (14, 17 px — их нет в размерах Icon). */
function Glyph(p: { name: string; size: number; color?: string }): ReactElement {
  const { name, size } = p;
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden="true"
      style={{ fontSize: `${String(size)}px`, ...(p.color ? { color: p.color } : {}) }}
    >
      {name}
    </span>
  );
}

function Chip({ name }: { name: string }): ReactElement {
  const c = chipOf(name);
  return (
    <span className="ox-leads-chip" style={{ background: c.bg, color: c.fg }}>
      <Glyph name={c.icon} size={14} />
      {c.label}
    </span>
  );
}

/** Карточка заявки (aside :1667–1699). */
function LeadCard(p: {
  tenantId: string;
  taskId: string;
  projectKey: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}): ReactElement | null {
  const api = useApi();
  const command = useCommand();
  const [keys] = useState(idemKeys);
  const [draft, setDraft] = useState('');
  const [now] = useState(() => Date.now());
  const lead = useLead(p.tenantId, p.taskId);
  const history = useHistory(p.tenantId, p.taskId);
  const t = lead.data;
  const close = (
    <button type="button" className="ox-leads-close" aria-label={TL.close} onClick={p.onClose}>
      <Icon name="close" size={20} />
    </button>
  );
  if (!t) {
    // Загрузка — скелетон, сбой (в т. ч. устаревший `?task=`) — ошибка и «Повторить»; закрыть можно всегда.
    return (
      <aside aria-label={TL.cardAria} className="ox-leads-aside">
        <div className="ox-leads-ahead">
          <span />
          {close}
        </div>
        {lead.isError ? (
          <LoadFailed error={lead.error} onRetry={() => void lead.refetch()} />
        ) : (
          <Skeleton />
        )}
      </aside>
    );
  }
  const c = cardOf(t.data, now);
  const moves = movesOf(t.data, { canEdit: p.canEdit });
  const list = t.data.checklist ?? [];
  const lines = historyLines(history.data ?? [], now);
  const run = async <R,>(body: unknown, fn: (key: string) => Promise<R>, ok?: string) => {
    const r = await command('tasks-leads', () => fn(keys.key(body)), ok ?? null, {
      settle: () => keys.settle(body),
    });
    await p.onChanged();
    return r;
  };
  const move = (key: string, to: string) =>
    void run(
      { move: key, rev: t.data.revision },
      (k) => moveLead(api, p.tenantId, t, key, k),
      format(TL.moved, { id: c.key, to }),
    );
  const toggle = (id: string, done: boolean) =>
    void run({ check: id, done, rev: t.data.revision }, (k) =>
      checkItem(api, p.tenantId, t, id, done, k),
    );
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    const r = await run({ comment: text, task: t.data.id }, (k) =>
      comment(api, p.tenantId, t.data.id, text, k),
    );
    if (r) setDraft('');
  };
  return (
    <aside aria-label={TL.cardAria} className="ox-leads-aside">
      <div className="ox-leads-ahead">
        <div className="ox-leads-atitle">
          <span className="ox-leads-sid">
            {format(TL.meta, { id: c.key, project: p.projectKey })}
          </span>
          <h2>{t.data.title}</h2>
        </div>
        {close}
      </div>
      <div className="ox-leads-props">
        <span className="ox-leads-plabel">{TL.status}</span>
        <span>
          <Chip name={t.data.statusName ?? ''} />
        </span>
        <span className="ox-leads-plabel">{TL.assignee}</span>
        <span>{c.assignee}</span>
        <span className="ox-leads-plabel">{TL.priority}</span>
        <span style={{ color: c.prio.fg }}>{c.prio.label}</span>
        <span className="ox-leads-plabel">{TL.dueLabel}</span>
        <span className="ox-leads-due" data-overdue={c.overdue ? '' : undefined}>
          {c.due}
        </span>
      </div>
      <div className="ox-leads-sec">
        <span className="ox-leads-stitle">{TL.move}</span>
        <div className="ox-leads-moves">
          {moves.map((m) => (
            <button
              key={m.key}
              type="button"
              className="ox-leads-move"
              data-fwd={m.fwd ? '' : undefined}
              disabled={m.disabled}
              onClick={() => move(m.key, m.to)}
            >
              <Glyph name={m.icon} size={17} />
              {m.label}
            </button>
          ))}
        </div>
        {p.canEdit ? null : <span className="ox-leads-ro">{TL.readOnly}</span>}
      </div>
      {list.length ? (
        <div className="ox-leads-sec" data-gap="4">
          <span className="ox-leads-stitle">
            {format(TL.checklist, { done: list.filter((x) => x.done).length, total: list.length })}
          </span>
          {list.map((x) => (
            <label key={x.id} className="ox-leads-check">
              <input
                type="checkbox"
                checked={x.done}
                disabled={!p.canEdit}
                onChange={(e) => toggle(x.id, e.target.checked)}
              />
              <span data-done={x.done ? '' : undefined}>{x.text}</span>
            </label>
          ))}
        </div>
      ) : null}
      <div className="ox-leads-sec ox-leads-hist">
        <span className="ox-leads-stitle">{TL.history}</span>
        {lines.map((h) => (
          <div key={h.id} className="ox-leads-hline" data-system={h.system ? '' : undefined}>
            <span>{h.text}</span>
            <span className="ox-leads-hmeta">{h.meta}</span>
          </div>
        ))}
        {lines.length ? null : <span className="ox-leads-hempty">{TL.noHistory}</span>}
        <div className="ox-leads-cmt">
          <input
            value={draft}
            aria-label={TL.comment}
            placeholder={TL.comment}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            aria-label={TL.send}
            disabled={!draft.trim()}
            onClick={() => void send()}
          >
            <Icon name="send" size={20} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function LeadsPage(): ReactElement {
  const { tenantId: id } = useShell();
  const can = useCan();
  const tenantId = id ?? '';
  const api = useApi();
  const qc = useQueryClient();
  const command = useCommand();
  const navigate = useNavigate();
  const location = useLocation();
  const search = searchOf(location.search as Record<string, unknown>);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [who, setWho] = useState<'all' | 'me'>('all');
  const [nt, setNt] = useState<NewTask | null>(null);
  const [keys] = useState(idemKeys);
  const [now] = useState(() => Date.now());

  const projects = useProjects(tenantId);
  const funnels = (projects.data ?? []).filter((p) => p.flow === 'leads');
  const proj = funnels.find((p) => p.id === search.project) ?? funnels[0];
  const stages = useStages(tenantId, proj?.id);
  const leads = useLeads(tenantId, proj?.id, who === 'me');
  const members = useAssignees(tenantId, proj?.id);
  const staff = usePeople(tenantId, can('members.read'));

  const go = (patch: Partial<LeadsSearch>) => {
    const next = { ...search, ...patch };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'leads' },
      search: clean as never,
    });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: leadsKey(tenantId) });

  const actions = proj?.myAccess?.actions ?? [];
  const canCreate = !!proj && actions.includes('tasks.create');
  const canEdit = actions.includes('tasks.transition');
  const people = (members.data ?? []).filter((m) => !(m.functionNotes ?? []).length);
  // «Я» среди участников воронки: по userId в списке сотрудников (members.read), иначе — по имени входа.
  const meId = useMeMember(staff.data, members.data ?? []) ?? '';
  const failed = [projects, stages, leads].find((q) => q.isError);
  const ready = projects.isSuccess && (!proj || (stages.isSuccess && leads.isSuccess));
  const noProjects = projects.isSuccess && !proj;
  const tasks = leads.data ?? [];
  const sel = search.task;

  const save = async () => {
    if (!nt || !proj) return;
    const title = nt.title.trim();
    if (!title) {
      setNt({ ...nt, err: TL.form.required });
      return;
    }
    const due = dueAtOf(nt.due);
    const body: LeadCreate = {
      projectId: proj.id,
      title,
      priority: nt.priority,
      ...(nt.assignee || meId ? { assigneeMemberId: nt.assignee || meId } : {}),
      ...(due ? { dueAt: due } : {}),
    };
    const r = await command(
      'tasks-leads',
      () => createLead(api, tenantId, body, keys.key(body)),
      TL.created,
      { inline: (err) => setNt({ ...nt, err }), settle: () => keys.settle(body) },
    );
    if (r) {
      setNt(null);
      go({ task: r.id });
    }
    await refresh();
  };

  let body: ReactElement | null = null;
  if (failed) {
    body = (
      <LoadFailed
        error={failed.error}
        onRetry={() => {
          for (const q of [projects, stages, leads]) if (q.isError) void q.refetch();
        }}
      />
    );
  } else if (!ready) body = <Skeleton />;

  const cols = columnsOf(stages.data?.statuses ?? [], tasks);
  const open = (taskId: string) => go({ task: taskId });

  return (
    <section aria-labelledby="h-tasks" className="ox-leads">
      <button
        type="button"
        className="ox-leads-back"
        onClick={() =>
          void navigate({ to: '/t/$tenantId/$page', params: { tenantId, page: 'tasks' } })
        }
      >
        <Icon name="arrow_back" size={18} />
        {TL.back}
      </button>
      <div className="ox-leads-head">
        <div className="ox-leads-titles">
          <div className="ox-leads-crumb">
            {proj ? format(TL.crumb, { key: proj.key, name: proj.name }) : TL.whoMe}
          </div>
          {/* Без проекта эталон берёт процесс «Задачи» (FL = WORKFLOWS.tasks, :4448): h1 «Задачи». */}
          <h1 id="h-tasks" className="ox-leads-h1">
            {noProjects ? WORKFLOWS.tasks.items : WORKFLOWS.leads.items}
          </h1>
          {proj && (projects.data ?? []).length > 1 ? (
            <div role="group" aria-label={TL.projectsAria} className="ox-leads-projs">
              {funnels.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={f.id === proj.id ? 'true' : 'false'}
                  onClick={() => go({ project: f.id, task: undefined })}
                >
                  <Icon name="filter_alt" size={16} />
                  {f.name}
                </button>
              ))}
            </div>
          ) : null}
          {proj ? <p className="ox-leads-note">{TL.note}</p> : null}
        </div>
        <div className="ox-leads-tools">
          <div role="group" aria-label={TL.viewAria} className="ox-leads-views">
            {(
              [
                ['board', TL.board, 'view_kanban'],
                ['list', TL.list, 'list'],
              ] as const
            ).map(([k, label, icon]) => (
              <button
                key={k}
                type="button"
                aria-pressed={view === k ? 'true' : 'false'}
                onClick={() => setView(k)}
              >
                <Icon name={icon} size={18} />
                {label}
              </button>
            ))}
          </div>
          <select
            aria-label={TL.whoAria}
            className="ox-leads-who"
            value={who}
            onChange={(e) => setWho(e.target.value as 'all' | 'me')}
          >
            <option value="all">{TL.whoAll}</option>
            <option value="me">{TL.whoMe}</option>
          </select>
          {canCreate ? (
            <button
              type="button"
              className="ox-leads-new"
              onClick={() =>
                setNt({ title: '', assignee: meId, priority: 'normal', due: '', err: null })
              }
            >
              <Icon name="add" size={18} />
              {TL.newTask}
            </button>
          ) : null}
        </div>
      </div>
      {noProjects ? (
        <div className="ox-leads-empty">
          <Icon name="folder_off" size={32} />
          <strong>{TL.noProjects}</strong>
          <span>{TL.noProjectsText}</span>
        </div>
      ) : null}
      {nt ? (
        <div className="ox-leads-form">
          <label data-grow="title">
            {TL.form.title}
            <input
              value={nt.title}
              placeholder={TL.form.placeholder}
              data-err={nt.err ? '' : undefined}
              onChange={(e) => setNt({ ...nt, title: e.target.value, err: null })}
            />
          </label>
          <label data-grow="assignee">
            {TL.form.assignee}
            <select
              value={nt.assignee}
              onChange={(e) => setNt({ ...nt, assignee: e.target.value })}
            >
              {people.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
          <label data-grow="priority">
            {TL.form.priority}
            <select
              value={nt.priority}
              onChange={(e) => setNt({ ...nt, priority: e.target.value as Priority })}
            >
              {PRIOS.map((p) => (
                <option key={p} value={p}>
                  {prioOf(p).label}
                </option>
              ))}
            </select>
          </label>
          <label data-grow="due">
            {TL.form.due}
            <input
              type="date"
              value={nt.due}
              onChange={(e) => setNt({ ...nt, due: e.target.value })}
            />
          </label>
          <div className="ox-leads-form-actions">
            <button type="button" data-variant="secondary" onClick={() => setNt(null)}>
              {TL.form.cancel}
            </button>
            <button type="button" data-variant="primary" onClick={() => void save()}>
              {TL.form.save}
            </button>
          </div>
          {nt.err ? (
            <span role="alert" className="ox-leads-err">
              {nt.err}
            </span>
          ) : null}
        </div>
      ) : null}
      {body}
      {ready && proj ? (
        <div className="ox-leads-content">
          <div className="ox-leads-main">
            {view === 'board' ? (
              <div className="ox-leads-board">
                {cols.map((col) => (
                  <div key={col.name} className="ox-leads-col">
                    <div className="ox-leads-colhead">
                      <span className="ox-leads-colhl">
                        <Glyph name={col.icon} size={17} color={col.fg} />
                        <span className="ox-leads-colname">{col.name}</span>
                      </span>
                      <span className="ox-leads-count">{col.count}</span>
                    </div>
                    {col.cards.map((t) => {
                      const c = cardOf(t, now);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className="ox-leads-card"
                          aria-pressed={sel === t.id ? 'true' : 'false'}
                          onClick={() => open(t.id)}
                        >
                          <span className="ox-leads-ctop">
                            <span className="ox-leads-id">{c.key}</span>
                            <span className="ox-leads-prio" style={{ color: c.prio.fg }}>
                              <Icon name={c.prio.icon} size={15} />
                              {c.prio.label}
                            </span>
                          </span>{' '}
                          <span className="ox-leads-ctitle">{c.title}</span>{' '}
                          <span className="ox-leads-cmeta">
                            <span>{c.assignee}</span>
                            <span data-overdue={c.overdue ? '' : undefined}>
                              {format(TL.due, { due: c.due })}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                    {col.empty ? <span className="ox-leads-colempty">{TL.empty}</span> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="ox-leads-list">
                {tasks.map((t) => {
                  const c = cardOf(t, now);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="ox-leads-row"
                      aria-pressed={sel === t.id ? 'true' : 'false'}
                      onClick={() => open(t.id)}
                    >
                      <span className="ox-leads-id">{c.key}</span>
                      <span className="ox-leads-rtitle">{c.title}</span>
                      <span className="ox-leads-rchip">
                        <Chip name={t.statusName ?? ''} />
                      </span>
                      <span className="ox-leads-rwho">{c.assignee}</span>
                      <span className="ox-leads-rprio" style={{ color: c.prio.fg }}>
                        <Icon name={c.prio.icon} size={16} />
                        {c.prio.label}
                      </span>
                      <span className="ox-leads-rdue" data-overdue={c.overdue ? '' : undefined}>
                        {c.due}
                      </span>
                    </button>
                  );
                })}
                {tasks.length ? null : <div className="ox-leads-noitems">{TL.noTasks}</div>}
              </div>
            )}
          </div>
          {sel ? (
            <LeadCard
              key={sel}
              tenantId={tenantId}
              taskId={sel}
              projectKey={proj.key}
              canEdit={canEdit}
              onClose={() => go({ task: undefined })}
              onChanged={refresh}
            />
          ) : null}
        </div>
      ) : null}
      <p className="ox-leads-foot">{TL.footer}</p>
    </section>
  );
}
