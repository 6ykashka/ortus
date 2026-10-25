-- W5.00 · tenant 0043 · «Склад и материалы»: склады, номенклатура, партии, остатки, движения, резервы (контракт
-- 0.12.0-stage5, W5.10). Экрана склада в прототипе нет (B-6) — по плану v2 §4 (W5.10) и API 0.1: несколько складов по
-- подразделениям (D-20 комплекта), номенклатура с базовой единицей и учётом партий, партии со сроком годности, FEFO —
-- расход от ранней даты, остаток не уходит в минус, движения неизменяемы (только INSERT для runtime-ролей) и
-- исправляются сторно, резерв удерживает количество без движения (reserved не больше on_hand). Количество — numeric(18, 6),
-- как строка Quantity контракта. Модуль пишет только в свою схему: внешние ключи — на org и себя; источник движения и
-- резерва (визит, закупка) — ссылка без внешнего ключа.
-- +goose Up
create schema if not exists inventory;

create table inventory.warehouses (
  id          uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org.units (id),
  name        text not null check (length(btrim(name)) between 1 and 150),
  code        text check (code is null or length(code) <= 32),
  archived    boolean not null default false,
  revision    integer not null default 1 check (revision >= 1),
  created_at  timestamptz not null default now()
);
create unique index warehouses_name_idx on inventory.warehouses (org_unit_id, lower(btrim(name)));

create table inventory.items (
  id          uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org.units (id),
  name        text not null check (length(btrim(name)) between 1 and 150),
  sku         text not null check (length(sku) between 1 and 64),
  base_unit   text not null check (base_unit in ('ml', 'g', 'piece', 'litre', 'kg')),
  track_lots  boolean not null default false,
  min_level   numeric(18, 6) check (min_level is null or min_level >= 0),
  archived    boolean not null default false,
  revision    integer not null default 1 check (revision >= 1),
  created_at  timestamptz not null default now()
);
create unique index items_sku_idx on inventory.items (org_unit_id, lower(sku));

create table inventory.lots (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references inventory.items (id),
  warehouse_id uuid not null references inventory.warehouses (id),
  lot_code     text check (lot_code is null or length(lot_code) <= 64),
  expires_on   date,
  received_at  timestamptz not null default now()
);
create index lots_fefo_idx on inventory.lots (warehouse_id, item_id, expires_on nulls last, received_at);

create table inventory.balances (
  warehouse_id uuid not null references inventory.warehouses (id),
  item_id      uuid not null references inventory.items (id),
  lot_id       uuid references inventory.lots (id),
  on_hand      numeric(18, 6) not null default 0 check (on_hand >= 0),
  reserved     numeric(18, 6) not null default 0 check (reserved >= 0),
  constraint balances_reserved check (reserved <= on_hand)
);
create unique index balances_key_idx on inventory.balances (warehouse_id, item_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table inventory.movements (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('receipt', 'issue', 'transfer', 'adjustment', 'reversal')),
  warehouse_id         uuid not null references inventory.warehouses (id),
  target_warehouse_id  uuid references inventory.warehouses (id),
  adjustment_direction text check (adjustment_direction is null or adjustment_direction in ('increase', 'decrease')),
  source_module        text check (source_module is null or source_module ~ '^[a-z][a-z0-9_-]{1,49}$'),
  source_type          text check (source_type is null or source_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_id            uuid,
  reverses_movement_id uuid references inventory.movements (id),
  reason               text check (reason is null or length(reason) <= 2000),
  posted_at            timestamptz not null default now(),
  posted_by            uuid not null,
  constraint movements_transfer check ((kind = 'transfer') = (target_warehouse_id is not null)),
  constraint movements_adjustment check ((kind = 'adjustment') = (adjustment_direction is not null)),
  constraint movements_reversal check ((kind = 'reversal') = (reverses_movement_id is not null))
);
create unique index movements_reverses_idx on inventory.movements (reverses_movement_id) where reverses_movement_id is not null;
create index movements_warehouse_idx on inventory.movements (warehouse_id, posted_at desc);
create index movements_source_idx on inventory.movements (source_module, source_type, source_id) where source_id is not null;

create table inventory.movement_lines (
  movement_id uuid not null references inventory.movements (id),
  line_no     integer not null check (line_no >= 1),
  item_id     uuid not null references inventory.items (id),
  lot_id      uuid references inventory.lots (id),
  quantity    numeric(18, 6) not null check (quantity > 0),
  expires_on  date,
  primary key (movement_id, line_no)
);
create index movement_lines_item_idx on inventory.movement_lines (item_id);

create table inventory.reservations (
  id           uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references inventory.warehouses (id),
  source_module text not null check (source_module ~ '^[a-z][a-z0-9_-]{1,49}$'),
  source_type  text not null check (source_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_id    uuid not null,
  status       text not null default 'active' check (status in ('active', 'consumed', 'released')),
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid not null,
  revision     integer not null default 1 check (revision >= 1)
);
create index reservations_status_idx on inventory.reservations (warehouse_id, status);
create unique index reservations_active_source_idx on inventory.reservations (source_module, source_type, source_id, warehouse_id) where status = 'active';

create table inventory.reservation_lines (
  reservation_id uuid not null references inventory.reservations (id),
  line_no        integer not null check (line_no >= 1),
  item_id        uuid not null references inventory.items (id),
  quantity       numeric(18, 6) not null check (quantity > 0),
  primary key (reservation_id, line_no)
);

comment on table inventory.movements is 'Движения неизменяемы: runtime-роли — только INSERT (roles/grants.sql); исправление — движение reversal со ссылкой reverses_movement_id (не больше одного на движение). Расход без lot_id берёт партии в порядке FEFO (lots_fefo_idx); остаток не уходит в минус (balances.on_hand >= 0 → invalid_transition, reason insufficient_stock).';

-- +goose Down
drop table inventory.reservation_lines;
drop table inventory.reservations;
drop table inventory.movement_lines;
drop table inventory.movements;
drop table inventory.balances;
drop table inventory.lots;
drop table inventory.items;
drop table inventory.warehouses;
drop schema inventory;
