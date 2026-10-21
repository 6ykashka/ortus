// W4.12 · Страница «Задачи» (`tasks`; экраны `tasks-projects`, `tasks-project-new`, `tasks-board`, `modal-new-task`,
// `tasks-card`; эталон design-2026-10-19 «Задачи и проекты.dc.html», dc-import на pg.tasks «Ортус CRM.dc.html»:1596).
// Адрес (ADR-0001): `?project=&view=board|list&task=&mine=1`, `approval=1` — «Ждут моего согласия»; вкладки
// «Участники», «Процесс», «Автоматизация» (`view=people|workflow|automation`) — W4.13, `settings/index.ts`.
// Ссылка `?task=` без проекта открывает проект задачи и её карточку (Р-20).
import type { components } from '@ortus/api-client';
import { format, shell, tasks as T } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ComponentType, lazy, type ReactElement, Suspense, useEffect, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { problemCode } from '../../../shell/run.tsx';
import { useOrgUnits } from '../../../shell/scope.ts';
import { LoadFailed, useRetryFocus } from '../../company/modules/ui.tsx';
import {
  type BoardFilter,
  createTask,
  initWorkflow,
  tasksKey,
  type TaskWithTag,
  useProject,
  useProjects,
  useTask,
  useTasks,
  useWorkflow,
} from './api.ts';
import { BoardBar, BoardColumns, TaskList } from './board.tsx';
import { TaskCard } from './card.tsx';
import { parentOptions, projectSub, projectUnit } from './model.ts';
import { NewTaskDialog, type NewTaskPrefill } from './new-task.tsx';
import { ProjectsList, type UnitOption } from './projects.tsx';
import { useTasksRun } from './run.ts';
import { TASKS_TEXT } from './texts.ts';
import '../../company/modules/modules.css';
import './tasks.css';

type S = components['schemas'];

type View = 'board' | 'list' | 'people' | 'workflow' | 'automation';
const VIEWS: readonly View[] = ['board', 'list', 'people', 'workflow', 'automation'];

interface TasksSearch {
  project?: string;
  view?: View;
  task?: string;
  mine?: 1;
  approval?: 1;
}

const searchOf = (raw: Record<string, unknown>): TasksSearch => ({
  ...(typeof raw.project === 'string' && raw.project ? { project: raw.project } : {}),
  ...(typeof raw.view === 'string' && (VIEWS as readonly string[]).includes(raw.view)
    ? { view: raw.view as View }
    : {}),
  ...(typeof raw.task === 'string' && raw.task ? { task: raw.task } : {}),
  ...(raw.mine === '1' || raw.mine === 1 ? { mine: 1 as const } : {}),
  ...(raw.approval === '1' || raw.approval === 1 ? { approval: 1 as const } : {}),
});

/**
 * Нет такого объекта или нет доступа к нему: 404 (TP-03) или 403 по праву. Ссылка на него ведёт туда же, куда
 * ведёт «нет доступа» без ссылки: проект — в список проектов, задача — убирается из адреса.
 */
const gone = (e: unknown): boolean => {
  const code = problemCode(e);
  return code === 'not_found' || code === 'forbidden_action';
};

/**
 * Вкладки проекта W4.13 («Участники», «Процесс», «Автоматизация»): `ProjectSettingsTab` из `./settings/index.ts`
 * (контракт W4.13: `{ tenantId, projectId, view }`). Модуль подключается по glob — до вливания W4.13 его нет, и панель
 * вкладки пустая; после — вкладки работают без правки страницы.
 */
type SettingsView = 'people' | 'workflow' | 'automation';
type SettingsModule = {
  ProjectSettingsTab: ComponentType<{ tenantId: string; projectId: string; view: SettingsView }>;
};
const SETTINGS_LOADER = Object.values(import.meta.glob<SettingsModule>('./settings/index.ts'))[0];
const SettingsTab = SETTINGS_LOADER
  ? lazy(async () => ({ default: (await SETTINGS_LOADER()).ProjectSettingsTab }))
  : null;

/** Права «Новый проект»: tasks.projects.manage в организации или подразделении (PD-53, роль проекта не даёт). */
function canCreateProjects(caps: readonly S['ScopedCapability'][]): boolean {
  return caps.some(
    (c) =>
      c.permission === 'tasks.projects.manage' &&
      (c.scope.kind === 'tenant' || c.scope.kind === 'org_unit'),
  );
}

function Skeleton(): ReactElement {
  return (
    <div className="ox-tk-skel" role="status" aria-label={shell.a11y.loading}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="ox-tk-skel-line" />
      ))}
    </div>
  );
}

/** Место карточки, пока задача грузится или не загрузилась: «← К доске» (телефон), «Закрыть задачу», состояние. */
function CardState({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactElement;
}): ReactElement {
  return (
    <aside className="ox-tk-card">
      <div className="ox-tk-card-head">
        <button type="button" className="ox-tk-back-board ox-tk-hit" data-icon="" onClick={onClose}>
          <Icon name="arrow_back" size={18} />
          {TASKS_TEXT.backToBoard}
        </button>
        <div className="ox-tk-card-top">
          <span className="ox-tk-spacer" />
          <button
            type="button"
            className="ox-tk-icon-btn ox-tk-close30 ox-tk-hit"
            aria-label={T.card.close}
            onClick={onClose}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        {children}
      </div>
    </aside>
  );
}

export default function TasksPage(): ReactElement {
  const { tenantId: id, tenant, me, audience } = useShell();
  const tenantId = id ?? '';
  const api = useApi();
  const run = useTasksRun();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const search = searchOf(location.search as Record<string, unknown>);
  const caps = tenant?.capabilities ?? [];
  const canReadUnits = audience === 'owner' || caps.some((c) => c.permission === 'org_units.read');
  const orgUnits = useOrgUnits(tenantId, canReadUnits).data ?? [];
  const units = new Map(orgUnits.map((u) => [u.id, u.name]));
  const unitOptions: UnitOption[] = orgUnits
    .filter((u) => u.status === 'active')
    .map((u) => ({ id: u.id, name: u.name, region: u.kind === 'region' }));
  const [quick, setQuick] = useState('');
  const [nf, setNf] = useState<NewTaskPrefill | null>(null);
  const [now] = useState(() => Date.now());

  const go = (patch: Partial<TasksSearch>, replace = false): void => {
    const next = { ...search, ...patch };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'tasks' },
      search: clean as never,
      replace,
    });
  };

  const projects = useProjects(tenantId);
  const projectQ = useProject(tenantId, search.project);
  const project = projectQ.data?.data;
  const hasWf = !!project && project.flow !== 'leads' && !!project.workflow;
  const workflow = useWorkflow(tenantId, search.project, hasWf);
  const filter: BoardFilter = search.approval ? 'approval' : search.mine ? 'mine' : 'all';
  const board = useTasks(tenantId, { projectId: search.project, filter }, hasWf);
  const awaiting = useTasks(tenantId, { projectId: search.project, filter: 'approval' }, hasWf);
  const linked = useTask(tenantId, search.task);
  const allTasks = useTasks(tenantId, {}, !!search.task || !!nf);

  // Ссылка на задачу без проекта — проект задачи (Р-20); задачи нет — убрать её из адреса.
  useEffect(() => {
    if (!search.task) return;
    if (linked.data && linked.data.task.projectId !== search.project) {
      go({ project: linked.data.task.projectId, task: search.task }, true);
    } else if (linked.isError && gone(linked.error)) {
      go({ task: undefined }, true);
    }
    // Только по ответу задачи-ссылки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked.data, linked.isError]);

  // Проекта нет или нет доступа (404, 403) — список проектов; воронка — старая доска «Заявки» (W4.13).
  useEffect(() => {
    if (projectQ.isError && gone(projectQ.error)) {
      go({ project: undefined, task: undefined, view: undefined }, true);
    } else if (project?.flow === 'leads') {
      void navigate({ to: '/t/$tenantId/$page', params: { tenantId, page: 'leads' } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectQ.isError, project?.flow]);

  const retryList = useRetryFocus(projects.isSuccess, () => document.getElementById('h-tasks'));

  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: [...tasksKey(tenantId)] });

  const meName = me.displayName;
  // Кандидаты связей — задачи проектов с процессом, которые участник видит (visTasks эталона :493): без воронки.
  const wfIds = new Set(
    (projects.data ?? []).filter((x) => x.flow !== 'leads' && x.workflow).map((x) => x.id),
  );
  const linkable = (allTasks.data ?? []).filter((x) => wfIds.has(x.projectId));
  const createable = (projects.data ?? []).filter(
    (x) => x.flow !== 'leads' && x.workflow && x.myAccess?.actions.includes('tasks.create'),
  );

  const openTask = (taskId: string): void => {
    const x = (allTasks.data ?? []).find((y) => y.id === taskId);
    go(
      x && x.projectId !== search.project
        ? { project: x.projectId, task: taskId, view: undefined }
        : { task: taskId },
    );
  };

  const onCreated = (t: TaskWithTag, more: boolean): void => {
    qc.setQueryData([...tasksKey(tenantId), 'task', t.task.id], t);
    void refresh();
    if (more) return;
    setNf(null);
    go({
      project: t.task.projectId,
      task: t.task.id,
      mine: undefined,
      approval: undefined,
      ...(t.task.projectId !== search.project ? { view: undefined } : {}),
    });
  };

  const quickCreate = async (p: S['Project']): Promise<void> => {
    const title = quick.trim();
    if (!title) {
      setNf({ projectId: p.id });
      return;
    }
    try {
      const t = await run(
        'tasks:quick',
        () => createTask(api, tenantId, { projectId: p.id, title, priority: 'normal' }),
        T.board.created,
      );
      setQuick('');
      qc.setQueryData([...tasksKey(tenantId), 'task', t.task.id], t);
      void refresh();
      go({ task: t.task.id, mine: undefined, approval: undefined });
    } catch {
      // тост — у run
    }
  };

  const dialog = nf ? (
    <NewTaskDialog
      key={`${nf.projectId}:${nf.parentId ?? ''}`}
      tenantId={tenantId}
      prefill={nf}
      projects={createable.length ? createable : project ? [project] : []}
      parentOptions={parentOptions(linkable, null)}
      meName={meName}
      onClose={() => setNf(null)}
      onCreated={onCreated}
    />
  ) : null;

  // ── Список проектов ──
  if (!search.project) {
    let status: ReactElement | null = null;
    if (search.task && linked.isError && !gone(linked.error))
      status = <LoadFailed error={linked.error} onRetry={() => void linked.refetch()} />;
    else if (search.task || projects.isPending) status = <Skeleton />;
    else if (projects.isError)
      status = <LoadFailed error={projects.error} onRetry={retryList(() => projects.refetch())} />;
    return (
      <section className="ox-tasks" aria-labelledby="h-tasks">
        <ProjectsList
          tenantId={tenantId}
          projects={projects.data ?? []}
          status={status}
          units={units}
          unitOptions={unitOptions}
          canNew={canCreateProjects(caps)}
          onOpen={(x) =>
            x.flow === 'leads'
              ? void navigate({ to: '/t/$tenantId/$page', params: { tenantId, page: 'leads' } })
              : go({ project: x.id, view: undefined, task: undefined })
          }
          onCreated={(x) => {
            void refresh();
            go({ project: x.id, view: 'people', task: undefined });
          }}
        />
      </section>
    );
  }

  // ── Проект ──
  if (!project) {
    return (
      <section className="ox-tasks" aria-label={T.projects.title}>
        {projectQ.isError && !gone(projectQ.error) ? (
          <LoadFailed error={projectQ.error} onRetry={() => void projectQ.refetch()} />
        ) : (
          <Skeleton />
        )}
      </section>
    );
  }

  const view: View = search.view ?? 'board';
  const my = project.myAccess;
  const canCreate = !!my?.actions.includes('tasks.create');
  const tabLabels: [View, string][] = [
    ['board', T.project.tabs.board],
    ['list', TASKS_TEXT.listTab],
    ['people', T.project.tabs.people],
    ['workflow', T.project.tabs.workflow],
    ['automation', T.project.tabs.automation],
  ];
  const selected = search.task && linked.data?.task.projectId === project.id ? linked.data : null;
  const statuses = workflow.data?.statuses ?? [];
  const closeTask = (): void => go({ task: undefined });

  // Карточка по `?task=`: задача, загрузка (скелетон) или ошибка с «Повторить» (бриф §1 п. 7); задачи нет или нет
  // доступа — эффект выше убирает её из адреса.
  let cardArea: ReactElement | null = null;
  if (selected) {
    cardArea = (
      <TaskCard
        key={selected.task.id}
        tenantId={tenantId}
        data={selected}
        project={project}
        allTasks={linkable}
        meName={meName}
        now={now}
        onClose={closeTask}
        onOpenTask={openTask}
        onSubtask={(t) =>
          setNf({
            projectId: t.projectId,
            parentId: t.id,
            ...(t.assigneeMemberId ? { assigneeId: t.assigneeMemberId } : {}),
            ...(t.priority ? { priority: t.priority } : {}),
          })
        }
        onDoc={() =>
          void navigate({ to: '/t/$tenantId/$page', params: { tenantId, page: 'docs' } })
        }
      />
    );
  } else if (search.task && !(linked.isError && gone(linked.error))) {
    cardArea = (
      <CardState onClose={closeTask}>
        {linked.isError ? (
          <LoadFailed error={linked.error} onRetry={() => void linked.refetch()} />
        ) : (
          <Skeleton />
        )}
      </CardState>
    );
  }

  let content: ReactElement;
  if (!project.workflow) {
    content = (
      <div className="ox-tk-nowf">
        <span className="ox-tk-nowf-text">{T.project.noWf}</span>
        <button
          type="button"
          className="ox-tk-primary ox-tk-hit"
          onClick={() =>
            void run('tasks:wf', () => initWorkflow(api, tenantId, project.id), T.project.wfCreated)
              .then(refresh)
              .catch(() => undefined)
          }
        >
          {T.project.initWf}
        </button>
      </div>
    );
  } else if (view === 'board' || view === 'list') {
    let inner: ReactElement;
    if (board.isError || workflow.isError) {
      const error = board.error ?? workflow.error;
      inner = (
        <LoadFailed
          error={error}
          onRetry={() => {
            void board.refetch();
            void workflow.refetch();
          }}
        />
      );
    } else if (board.isPending || workflow.isPending) inner = <Skeleton />;
    else if (view === 'board')
      inner = (
        <BoardColumns
          statuses={statuses}
          tasks={board.data}
          selected={search.task ?? null}
          onSelect={(taskId) => go({ task: taskId })}
        />
      );
    else
      inner = (
        <TaskList
          tasks={board.data}
          selected={search.task ?? null}
          onSelect={(taskId) => go({ task: taskId })}
        />
      );
    content = (
      <div className="ox-tk-boardwrap" data-card={cardArea ? '' : undefined}>
        <div className="ox-tk-board">
          <BoardBar
            filter={filter}
            approvalCount={awaiting.data?.length ?? 0}
            onFilter={(f) =>
              go({
                mine: f === 'mine' ? 1 : undefined,
                approval: f === 'approval' ? 1 : undefined,
              })
            }
            canCreate={canCreate}
            quick={quick}
            onQuick={setQuick}
            onCreate={() => void quickCreate(project)}
          />
          {inner}
        </div>
        {cardArea}
      </div>
    );
  } else {
    content = SettingsTab ? (
      <Suspense fallback={<Skeleton />}>
        <SettingsTab tenantId={tenantId} projectId={project.id} view={view} />
      </Suspense>
    ) : (
      <div role="tabpanel" className="ox-tk-tabpanel" />
    );
  }

  return (
    <section className="ox-tasks" aria-labelledby="h-tasks-project">
      <div className="ox-tk-proj">
        <div className="ox-tk-phead">
          <button
            type="button"
            className="ox-tk-back ox-tk-hit"
            data-icon=""
            onClick={() =>
              go({
                project: undefined,
                task: undefined,
                view: undefined,
                mine: undefined,
                approval: undefined,
              })
            }
          >
            <Icon name="arrow_back" size={18} />
            {T.projects.title}
          </button>
          <span className="ox-tk-key ox-tk-key34">{project.key}</span>
          <span className="ox-tk-pname-text ox-tk-ptitle">
            <strong id="h-tasks-project">{project.name}</strong>
            <span>{projectSub(project, projectUnit(project, units))}</span>
          </span>
          <span className="ox-tk-spacer" />
          <span className="ox-tk-me" data-ok={my ? '' : undefined}>
            <Icon name="badge" size={15} />
            {my ? format(T.project.me, { role: my.roleName }) : T.project.noAccess}
          </span>
        </div>
        <div role="tablist" aria-label={T.project.tabsAria} className="ox-tk-tabs">
          {tabLabels.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k ? 'true' : 'false'}
              className="ox-tk-tab"
              onClick={() =>
                go({
                  view: k === 'board' ? undefined : k,
                  ...(k === 'board' || k === 'list' ? {} : { task: undefined }),
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
        {content}
      </div>
      {dialog}
    </section>
  );
}
