-- W0.08 · tenant 0006 · группы: ревизия, домашнее подразделение, архив (S1-16, шаг 1.6) · номер выдал стюард (PD-59)
-- +goose Up
-- CRUD групп (03 «Группы и владельцы»): If-Match по revision, управляющие домашнего подразделения
-- (home_unit_id; null — группа всей организации), архив вместо удаления. Имя уникально среди активных групп.
alter table access.groups
  add column description  text not null default '' check (length(description) <= 1000),
  add column home_unit_id uuid references org.units(id),
  add column revision     integer not null default 1,
  add column archived_at  timestamptz,
  add column updated_at   timestamptz not null default now();
create unique index groups_name_uq on access.groups (lower(name)) where archived_at is null;

alter table access.group_members
  add column added_at timestamptz not null default now(),
  add column added_by uuid;

-- +goose Down
drop index access.groups_name_uq;
alter table access.group_members
  drop column added_by,
  drop column added_at;
alter table access.groups
  drop column updated_at,
  drop column archived_at,
  drop column revision,
  drop column home_unit_id,
  drop column description;
