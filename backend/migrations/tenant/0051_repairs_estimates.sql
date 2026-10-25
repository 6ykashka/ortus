-- W6.00 · tenant 0051 · «Ремонт и стройка», замер и сметы (контракт 0.12.0-stage6, W6.12): замер, справочник расценок, шаблоны, версии сметы.
-- Номер выдал стюард контрактного PR этапа 6 (W6.00; план v2 §3.5, PD-59). Разбор repair.md §2.1 (Q-W4.00-repair-5, -17),
-- design/docs/19-construction.md «Смета: кто правит, версии, допработы, шаблоны». Замер — строка на версию (новая версия
-- не меняет отправленные и согласованные версии сметы), помещения — jsonb (длина, ширина, высота, проёмы, «мокрое»).
-- Справочник — работы и материалы с ценой; название уникально без учёта регистра среди действующих позиций (дубликат —
-- validation_failed). Шаблон — шесть частей: строки сметы и материалы (repairs.template_lines, part), технология графика
-- (template_stages), документы, чек-лист приёмки и гарантия (столбцы шаблона); цена в шаблоне не хранится. Версия сметы —
-- (project_id, version), одна открытая (draft или sent) на объект; согласованная и отправленная версии не меняются
-- (логика сервера, estimate_version_locked); строки сопоставляются при сравнении по идентификатору строки.
-- +goose Up
create table repairs.measurements (
  project_id  uuid not null references repairs.projects (id),
  version     integer not null check (version >= 1),
  rooms       jsonb not null default '[]' check (jsonb_typeof(rooms) = 'array'),
  measured_by uuid references people.person_profiles (id),
  measured_at timestamptz not null default now(),
  primary key (project_id, version)
);

create table repairs.price_items (
  id          uuid primary key default gen_random_uuid(),
  section     text not null check (length(btrim(section)) between 1 and 100),
  name        text not null check (length(btrim(name)) between 1 and 200),
  unit        text not null check (unit in ('hour', 'm2', 'm3', 'm', 'piece', 'set', 'trip', 'mesh', 'liter')),
  kind        text not null check (kind in ('work', 'material')),
  price_minor bigint not null check (price_minor between 0 and 9007199254740991),
  currency    char(3) not null default 'RUB',
  archived    boolean not null default false,
  revision    integer not null default 1 check (revision >= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index price_items_name_idx on repairs.price_items (lower(btrim(name))) where not archived;

create table repairs.templates (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) between 1 and 200),
  kind              text not null check (length(kind) between 1 and 100),
  source            text not null check (source in ('ortus', 'own')),
  copied_from       uuid references repairs.templates (id),
  source_project_id uuid references repairs.projects (id),
  documents         text[] not null default '{}',
  checklist         text[] not null default '{}',
  warranty_months   integer not null default 24 check (warranty_months between 1 and 120),
  revision          integer not null default 1 check (revision >= 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index templates_kind_idx on repairs.templates (kind);

create table repairs.template_lines (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references repairs.templates (id),
  part          text not null check (part in ('estimate', 'material')),
  section       text not null check (length(section) <= 100),
  price_item_id uuid not null references repairs.price_items (id),
  quantity      numeric(14, 3) check (quantity is null or quantity >= 0),
  formula       text check (formula is null or formula in ('floor', 'floor_dry', 'walls', 'walls_dry', 'wet', 'perimeter', 'perimeter_dry')),
  coef          numeric(8, 3) check (coef is null or coef > 0),
  sort          integer not null default 0,
  constraint template_lines_volume check ((quantity is null) <> (formula is null))
);
create index template_lines_template_idx on repairs.template_lines (template_id, part, sort);
create index template_lines_item_idx on repairs.template_lines (price_item_id);

create table repairs.template_stages (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references repairs.templates (id),
  name         text not null check (length(btrim(name)) between 1 and 200),
  rate_per_day numeric(14, 3) check (rate_per_day is null or rate_per_day > 0),
  pause_days   integer not null default 0 check (pause_days between -60 and 60),
  sections     text[] not null default '{}',
  sort         integer not null default 0
);
create index template_stages_template_idx on repairs.template_stages (template_id, sort);

create table repairs.estimates (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references repairs.projects (id),
  version           integer not null check (version >= 1),
  kind              text not null check (kind in ('first', 'revision', 'change')),
  state             text not null default 'draft' check (state in ('draft', 'sent', 'approved', 'replaced')),
  base_version      integer check (base_version is null or base_version >= 1),
  template_id       uuid references repairs.templates (id),
  discount_pct      integer not null default 0 check (discount_pct between 0 and 100),
  agreement_no      integer check (agreement_no is null or agreement_no >= 1),
  change_order_ids  uuid[] not null default '{}',
  sent_at           timestamptz,
  approved_at       timestamptz,
  revision          integer not null default 1 check (revision >= 1),
  created_by        uuid references people.person_profiles (id),
  created_at        timestamptz not null default now(),
  constraint estimates_approved check ((state in ('approved', 'replaced')) = (approved_at is not null))
);
create unique index estimates_version_idx on repairs.estimates (project_id, version);
create unique index estimates_open_idx on repairs.estimates (project_id) where state in ('draft', 'sent');

create table repairs.estimate_sections (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references repairs.estimates (id),
  name        text not null check (length(btrim(name)) between 1 and 150),
  sort        integer not null default 0
);
create index estimate_sections_estimate_idx on repairs.estimate_sections (estimate_id, sort);

create table repairs.estimate_lines (
  id            uuid primary key default gen_random_uuid(),
  line_key      uuid not null default gen_random_uuid(),
  estimate_id   uuid not null references repairs.estimates (id),
  section_id    uuid not null references repairs.estimate_sections (id),
  price_item_id uuid references repairs.price_items (id),
  name          text not null check (length(name) between 1 and 300),
  unit          text not null check (unit in ('hour', 'm2', 'm3', 'm', 'piece', 'set', 'trip', 'mesh', 'liter')),
  kind          text not null check (kind in ('work', 'material')),
  price_minor   bigint not null check (price_minor between 0 and 9007199254740991),
  currency      char(3) not null default 'RUB',
  quantity      numeric(14, 3) not null check (quantity >= 0),
  formula       text check (formula is null or length(formula) <= 100),
  coef          numeric(8, 3) check (coef is null or coef > 0),
  manual        boolean not null default false,
  is_new        boolean not null default false,
  sort          integer not null default 0
);
create index estimate_lines_estimate_idx on repairs.estimate_lines (estimate_id, section_id, sort);
create unique index estimate_lines_key_idx on repairs.estimate_lines (estimate_id, line_key);
comment on column repairs.estimate_lines.line_key is 'Стабильный ключ строки между версиями сметы (EstimateLine.id контракта): новая версия копирует строки с тем же ключом, по нему сравниваются версии («Строки сопоставляются по идентификатору строки», design/docs/19); замена позиции справочника — новый ключ (убрано + добавлено).';

alter table repairs.projects add constraint projects_template_fk foreign key (template_id) references repairs.templates (id);
alter table repairs.works add constraint works_estimate_line_fk foreign key (estimate_line_id) references repairs.estimate_lines (id);

-- +goose Down
alter table repairs.works drop constraint works_estimate_line_fk;
alter table repairs.projects drop constraint projects_template_fk;
drop table repairs.estimate_lines;
drop table repairs.estimate_sections;
drop table repairs.estimates;
drop table repairs.template_stages;
drop table repairs.template_lines;
drop table repairs.templates;
drop table repairs.price_items;
drop table repairs.measurements;
