-- W4.03 · tenant 0025 · «Задачи и проекты» (контракт 0.10.0-stage4, W4.11): схема tasks.
-- Номер выдал стюард контрактного PR 2 этапа 4 (W4.03; план v2 §3.5, PD-59); при вливании после других PR этапа 4
-- (W4.04, W2.71) файл переименовывается в следующий свободный номер (интегратор).
-- Разбор docs/plan/v2/analysis/dor/tasks.md §2.5 (Р-5, Р-6, Р-8, Q-W4.00-tasks-9, -16). Модуль пишет только в свою
-- схему (10-data-model). Проект: ключ уникален в тенанте (кириллица, 2–6), org_unit_id null — вся организация,
-- уровень доступа (у воронки «Заявки» его нет), счётчик номеров задач с 101, опубликованная версия процесса и ревизия
-- процесса (ETag getTaskWorkflow). Версии процесса неизменяемы (project_id, version); черновик — одна строка на проект.
-- Задача хранит status_id и версию процесса (переименование статуса не трогает задач), номер в проекте (сидовые T-NN —
-- legacy_key), родителя (до трёх уровней — проверка сервера), чек-лист, связи и мягкое удаление («{id} · удалена»).
-- История — строки task_events (только добавление). Согласование — раунд на вход в статус перехода (состав
-- согласующих «нужны все» фиксируется, версия процесса запоминается) и голоса. Вложения — файлы core.files
-- (purpose task_attachment), файл принадлежит одной задаче. Правило автоматизации — с версией и автором (от его имени),
-- журнал запусков переживает удаление правила (automation_id — id удалённого правила, без внешнего ключа). Назначения ролей проекта — access.role_assignments
-- (scope_kind project, scope_ref = tasks.projects.id), без новой таблицы.
-- +goose Up
create schema if not exists tasks;

create table tasks.projects (
  id                uuid primary key default gen_random_uuid(),
  key               text not null check (key ~ '^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]{1,5}$'),
  name              text not null check (length(btrim(name)) between 1 and 150),
  org_unit_id       uuid references org.units (id),
  access            text check (access in ('open', 'limited', 'closed')),
  flow              text not null default 'tasks' check (flow in ('tasks', 'leads')),
  workflow_key      text not null check (workflow_key in ('simple', 'approval', 'copy', 'leads', 'initial')),
  owner_id          uuid not null references people.person_profiles (id),
  current_version   integer check (current_version >= 1),
  workflow_revision integer not null default 1 check (workflow_revision >= 1),
  task_seq          integer not null default 100 check (task_seq >= 0),
  status            text not null default 'active' check (status in ('active', 'archived')),
  revision          integer not null default 1 check (revision >= 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint projects_funnel check ((flow = 'leads') = (access is null)),
  constraint projects_funnel_version check (flow = 'tasks' or current_version is null)
);
create unique index projects_key_idx on tasks.projects (key);
create index projects_unit_idx on tasks.projects (org_unit_id) where status = 'active';

create table tasks.workflow_versions (
  project_id   uuid not null references tasks.projects (id),
  version      integer not null check (version >= 1),
  statuses     jsonb not null
    check (jsonb_typeof(statuses) = 'array' and jsonb_array_length(statuses) between 1 and 30),
  transitions  jsonb not null
    check (jsonb_typeof(transitions) = 'array' and jsonb_array_length(transitions) <= 60),
  published_at timestamptz not null default now(),
  published_by uuid references people.person_profiles (id),
  primary key (project_id, version)
);

create table tasks.workflow_drafts (
  project_id   uuid primary key references tasks.projects (id),
  base_version integer not null check (base_version >= 1),
  statuses     jsonb not null
    check (jsonb_typeof(statuses) = 'array' and jsonb_array_length(statuses) <= 30),
  transitions  jsonb not null
    check (jsonb_typeof(transitions) = 'array' and jsonb_array_length(transitions) <= 60),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references people.person_profiles (id)
);

create table tasks.tasks (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references tasks.projects (id),
  number           integer not null check (number >= 1),
  legacy_key       text check (legacy_key ~ '^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]{0,5}-[0-9]{1,9}$'),
  title            text not null check (length(btrim(title)) between 1 and 200),
  description      text not null default '' check (length(description) <= 50000),
  status_id        text not null check (status_id ~ '^[a-z][a-z0-9_-]{0,31}$'),
  workflow_version integer check (workflow_version >= 1),
  priority         text not null default 'normal' check (priority in ('urgent', 'high', 'normal', 'low')),
  labels           text[] not null default '{}' check (cardinality(labels) <= 10),
  assignee_id      uuid references people.person_profiles (id),
  author_id        uuid references people.person_profiles (id),
  due_at           timestamptz,
  parent_task_id   uuid references tasks.tasks (id),
  checklist        jsonb not null default '[]' check (jsonb_typeof(checklist) = 'array'),
  related_objects  jsonb not null default '[]' check (jsonb_typeof(related_objects) = 'array'),
  custom_fields    jsonb not null default '[]' check (jsonb_typeof(custom_fields) = 'array'),
  source_module    text check (source_module is null or source_module ~ '^[a-z][a-z0-9_-]{1,49}$'),
  source_type      text,
  source_id        uuid,
  doc_route        jsonb check (doc_route is null or jsonb_typeof(doc_route) = 'object'),
  revision         integer not null default 1 check (revision >= 1),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint tasks_not_own_parent check (parent_task_id is null or parent_task_id <> id),
  constraint tasks_source check ((source_module is null) = (source_id is null) and (source_module is null) = (source_type is null))
);
create unique index tasks_number_idx on tasks.tasks (project_id, number);
create unique index tasks_legacy_key_idx on tasks.tasks (legacy_key) where legacy_key is not null;
create index tasks_board_idx on tasks.tasks (project_id, status_id) where deleted_at is null;
create index tasks_assignee_idx on tasks.tasks (assignee_id) where deleted_at is null;
create index tasks_parent_idx on tasks.tasks (parent_task_id) where parent_task_id is not null;
create index tasks_source_idx on tasks.tasks (source_module, source_type, source_id) where source_id is not null;

create table tasks.task_events (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references tasks.tasks (id),
  at             timestamptz not null default now(),
  kind           text not null check (kind in ('created', 'comment', 'transition', 'approval_vote',
    'approval_rejected', 'assignment', 'field', 'checklist', 'parent', 'child', 'files', 'automation')),
  actor_id       uuid references people.person_profiles (id),
  actor_label    text check (actor_label in ('system', 'process', 'automation')),
  text           text not null check (length(text) between 1 and 5000),
  transition_key text check (transition_key is null or transition_key ~ '^[a-z][a-z0-9_-]{0,31}$'),
  automation_id  uuid,
  constraint task_events_actor check ((actor_id is null) <> (actor_label is null)),
  constraint task_events_comment check (kind <> 'comment' or actor_id is not null)
);
create index task_events_task_idx on tasks.task_events (task_id, at desc, id desc);

create table tasks.approval_rounds (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references tasks.tasks (id),
  transition_key   text not null check (transition_key ~ '^[a-z][a-z0-9_-]{0,31}$'),
  workflow_version integer not null check (workflow_version >= 1),
  mode             text not null check (mode in ('any', 'all')),
  approver_ids     uuid[] not null default '{}',
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  outcome          text check (outcome in ('approved', 'rejected', 'cancelled')),
  constraint approval_rounds_closed check ((closed_at is null) = (outcome is null))
);
create unique index approval_rounds_open_idx on tasks.approval_rounds (task_id) where closed_at is null;

create table tasks.approval_votes (
  round_id   uuid not null references tasks.approval_rounds (id),
  member_id  uuid not null references people.person_profiles (id),
  decision   text not null check (decision in ('approve', 'reject')),
  decided_at timestamptz not null default now(),
  comment    text check (comment is null or length(comment) <= 5000),
  primary key (round_id, member_id),
  constraint approval_votes_reject_comment check (decision <> 'reject' or length(btrim(coalesce(comment, ''))) > 0)
);

create table tasks.task_files (
  task_id     uuid not null references tasks.tasks (id),
  file_id     uuid not null references files.objects (id),
  attached_by uuid not null references people.person_profiles (id),
  attached_at timestamptz not null default now(),
  primary key (task_id, file_id)
);
create unique index task_files_file_idx on tasks.task_files (file_id);

create table tasks.automations (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references tasks.projects (id),
  name               text not null check (length(btrim(name)) between 1 and 120),
  trigger_kind       text not null check (trigger_kind in ('created', 'status_entered')),
  trigger_status_id  text check (trigger_status_id is null or trigger_status_id ~ '^[a-z][a-z0-9_-]{0,31}$'),
  condition_priority text check (condition_priority in ('urgent', 'high', 'normal', 'low')),
  action_kind        text not null check (action_kind in ('assign', 'set_priority', 'comment')),
  action_member_id   uuid references people.person_profiles (id),
  action_priority    text check (action_priority in ('urgent', 'high', 'normal', 'low')),
  action_text        text check (action_text is null or length(action_text) <= 2000),
  enabled            boolean not null default true,
  version            integer not null default 1 check (version >= 1),
  author_id          uuid not null references people.person_profiles (id),
  run_count          integer not null default 0 check (run_count >= 0),
  revision           integer not null default 1 check (revision >= 1),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint automations_trigger check ((trigger_kind = 'status_entered') = (trigger_status_id is not null)),
  constraint automations_action check (
    (action_kind = 'assign' and action_member_id is not null)
    or (action_kind = 'set_priority' and action_priority is not null)
    or (action_kind = 'comment' and length(btrim(coalesce(action_text, ''))) > 0))
);
create index automations_project_idx on tasks.automations (project_id, created_at, id);

create table tasks.automation_runs (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references tasks.projects (id),
  automation_id      uuid not null,
  automation_name    text not null check (length(automation_name) between 1 and 120),
  automation_version integer not null check (automation_version >= 1),
  result             text not null check (result in ('ok', 'stopped', 'error')),
  text               text not null check (length(text) between 1 and 2000),
  task_id            uuid references tasks.tasks (id),
  at                 timestamptz not null default now()
);
create index automation_runs_project_idx on tasks.automation_runs (project_id, at desc, id desc);

-- +goose Down
drop table tasks.automation_runs;
drop table tasks.automations;
drop table tasks.task_files;
drop table tasks.approval_votes;
drop table tasks.approval_rounds;
drop table tasks.task_events;
drop table tasks.tasks;
drop table tasks.workflow_drafts;
drop table tasks.workflow_versions;
drop table tasks.projects;
drop schema tasks;
