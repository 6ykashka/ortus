-- W2.52 · tenant 0016 · история принадлежности машины фирмам и импорт CSV машин (контракт 0.6.1-stage2).
-- Номер выдал стюард этапа 2 (план v2 §3.5, PD-59). Ответ владельца 17.10: модель данных п. 2 — таблица
-- vehicle_assignments (valid_from/valid_to) для запроса «кто владел машиной на дату» (изоляция, отчёты; W2.42,
-- операции listVehicleAssignments, moveVehicle); D-11 комплекта — импорт CSV машин (W2.50, операции
-- createVehicleImport, getVehicleImport, commitVehicleImport) по образцу импорта людей (tenant 0005).
-- Открытый период машины совпадает с fleet.vehicles.unit_id: перемещение закрывает его и открывает новый в той же
-- транзакции, что меняет unit_id (приложение, W2.42); база сверяет это при фиксации. Первый период новой машины
-- открывает база (триггер после вставки) — createVehicle (W2.02) и применение импорта (W2.50) его не пишут.
-- История удаляется вместе с машиной (машины не удаляются, только очистка тестов). Строки импорта машин не содержат
-- персональных данных: уборщик удаляет только просроченные предпросмотры.
-- +goose Up
create table fleet.vehicle_assignments (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references fleet.vehicles (id) on delete cascade,
  unit_id     uuid not null references org.units (id),
  valid_from  timestamptz not null,
  valid_to    timestamptz,
  reason      text check (reason is null or length(btrim(reason)) between 1 and 500),
  assigned_by uuid,
  created_at  timestamptz not null default now(),
  constraint vehicle_assignments_period check (valid_to is null or valid_from < valid_to),
  constraint vehicle_assignments_no_overlap exclude using gist
    (vehicle_id with =, tstzrange(valid_from, valid_to) with &&)
);
create unique index vehicle_assignments_open_uq on fleet.vehicle_assignments (vehicle_id)
  where valid_to is null;
create index vehicle_assignments_unit_idx on fleet.vehicle_assignments (unit_id, valid_from);
-- Перенос: текущая фирма каждой машины — открытый период с момента регистрации.
insert into fleet.vehicle_assignments (vehicle_id, unit_id, valid_from)
  select id, unit_id, created_at from fleet.vehicles;

-- Новая машина — открытый период фирмы регистрации с момента регистрации.
-- +goose StatementBegin
create function fleet.vehicles_open_assignment() returns trigger
  language plpgsql
as $$
begin
  insert into fleet.vehicle_assignments (vehicle_id, unit_id, valid_from)
    values (new.id, new.unit_id, new.created_at);
  return null;
end
$$;
-- +goose StatementEnd
create trigger vehicles_open_assignment after insert on fleet.vehicles
  for each row execute function fleet.vehicles_open_assignment();

-- Сверка при фиксации: у существующей машины ровно один открытый период, и он в её фирме (fleet.vehicles.unit_id).
-- +goose StatementBegin
create function fleet.vehicle_assignment_check() returns trigger
  language plpgsql
as $$
declare
  vid uuid;
begin
  if tg_table_name = 'vehicles' then
    vid := new.id;
  else
    vid := new.vehicle_id;
  end if;
  if exists (select 1 from fleet.vehicles v where v.id = vid) and not exists (
    select 1 from fleet.vehicles v
      join fleet.vehicle_assignments a on a.vehicle_id = v.id and a.valid_to is null and a.unit_id = v.unit_id
     where v.id = vid) then
    raise exception 'open period of vehicle % does not match fleet.vehicles.unit_id', vid
      using errcode = 'check_violation', constraint = 'vehicle_assignments_open_unit';
  end if;
  return null;
end
$$;
-- +goose StatementEnd
create constraint trigger vehicles_assignment_check after update of unit_id on fleet.vehicles
  deferrable initially deferred
  for each row execute function fleet.vehicle_assignment_check();
create constraint trigger vehicle_assignments_check after insert or update on fleet.vehicle_assignments
  deferrable initially deferred
  for each row execute function fleet.vehicle_assignment_check();

create table fleet.vehicle_imports (
  id              uuid primary key default gen_random_uuid(),
  state           text not null default 'previewed' check (state in ('previewed','committed','expired')),
  file_name       text not null check (length(file_name) between 1 and 255),
  file_sha256     bytea,
  default_unit_id uuid not null references org.units (id),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  committed_by    uuid,
  committed_at    timestamptz,
  totals          jsonb not null default '{}',
  revision        integer not null default 1,
  constraint vehicle_imports_committed check ((state = 'committed') = (committed_at is not null)),
  constraint vehicle_imports_committed_by check ((committed_at is null) = (committed_by is null))
);
create index vehicle_imports_expiry_idx on fleet.vehicle_imports (expires_at) where state = 'previewed';

create table fleet.vehicle_import_rows (
  import_id  uuid not null references fleet.vehicle_imports (id) on delete cascade,
  line       integer not null check (line >= 2),             -- строка файла; 1 — заголовок
  action     text not null check (action in ('create','update','skip','error')),
  data       jsonb not null,                                 -- разобранные значения строки
  errors     jsonb not null default '[]',
  vehicle_id uuid references fleet.vehicles (id),            -- найденная или созданная машина
  primary key (import_id, line)
);
-- +goose Down
drop table fleet.vehicle_import_rows;
drop table fleet.vehicle_imports;
drop trigger vehicles_assignment_check on fleet.vehicles;
drop trigger vehicles_open_assignment on fleet.vehicles;
drop table fleet.vehicle_assignments;
drop function fleet.vehicle_assignment_check();
drop function fleet.vehicles_open_assignment();
