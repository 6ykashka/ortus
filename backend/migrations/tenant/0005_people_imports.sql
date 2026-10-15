-- W0.08 · tenant 0005 · импорт CSV людей (S1-10, шаг 1.5) · номер выдал стюард контракта (PD-59)
-- +goose Up
-- Импорт сотрудников из CSV с предпросмотром и ошибками строк (13 S1-10). Исходный файл не хранится:
-- только разобранные значения строк. Предпросмотр живёт сутки; уборщик удаляет просроченные импорты
-- вместе со строками (персональные данные не хранятся дольше нужного). У применённого импорта строки
-- (ФИО, почта, телефон) живут 30 дней для экрана результата (Q-W0.08-5, 152-ФЗ): уборщик W1.05 удаляет
-- people.import_rows и ставит rows_purged_at; заголовок с итогами и аудит остаются.
create table people.imports (
  id              uuid primary key default gen_random_uuid(),
  state           text not null default 'previewed' check (state in ('previewed','committed','expired')),
  file_name       text not null check (length(file_name) between 1 and 255),
  file_sha256     bytea,
  default_unit_id uuid not null references org.units(id),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  committed_by    uuid,
  committed_at    timestamptz,
  totals          jsonb not null default '{}',
  rows_purged_at  timestamptz,                            -- строки удалены уборщиком (PeopleImport.rowsPurgedAt)
  revision        integer not null default 1,
  check ((state = 'committed') = (committed_at is not null)),
  check (rows_purged_at is null or state = 'committed')
);
create index imports_expiry_idx on people.imports (expires_at) where state = 'previewed';
create index imports_purge_idx on people.imports (committed_at)
  where state = 'committed' and rows_purged_at is null;

create table people.import_rows (
  import_id uuid not null references people.imports(id) on delete cascade,
  line      integer not null check (line >= 2),             -- строка файла; 1 — заголовок
  action    text not null check (action in ('create','update','skip','error')),
  data      jsonb not null,                                 -- ФИО, почта, телефон, подразделение, функция
  errors    jsonb not null default '[]',
  person_id uuid references people.person_profiles(id),     -- созданный или обновлённый профиль
  primary key (import_id, line)
);

-- +goose Down
drop table people.import_rows;
drop table people.imports;
