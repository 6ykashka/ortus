-- W6.00 · tenant 0053 · «Ремонт и стройка», снабжение (контракт 0.12.0-stage6, W6.13): заявки, закупки, остатки на объектах.
-- Номер выдал стюард контрактного PR этапа 6 (W6.00; план v2 §3.5, PD-59). Разбор repair.md §2.1, Q-W4.00-repair-6, -7,
-- -18, -23; design/docs/19-construction.md «Снабжение по всем объектам и склады». Заявка прораба: request → reserved →
-- issued или request → ordered → bought, затем used; номер З-n из последовательности тенанта; склад — идентификатор
-- модуля «Склад» (этап 5) без внешнего ключа. Закупка — на несколько объектов: строка хранит объект и заявку (одна заявка
-- — одна строка), после получения (receipt_qr) сумма разносится по объектам. Остаток на объекте — количество и
-- стоимость по позиции справочника; движения пишет модуль «Склад» (use, issue, buy) в той же транзакции.
-- +goose Up
create sequence repairs.supply_request_number_seq;

create table repairs.supply_requests (
  id            uuid primary key default gen_random_uuid(),
  number        text not null,
  project_id    uuid not null references repairs.projects (id),
  price_item_id uuid not null references repairs.price_items (id),
  quantity      numeric(14, 3) not null check (quantity > 0),
  need_by       date not null,
  state         text not null default 'request' check (state in ('request', 'reserved', 'issued', 'ordered', 'bought', 'used')),
  warehouse_id  uuid,
  purchase_id   uuid,
  cost_minor    bigint check (cost_minor is null or cost_minor between 0 and 9007199254740991),
  currency      char(3) not null default 'RUB',
  created_by    uuid not null references people.person_profiles (id),
  revision      integer not null default 1 check (revision >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint supply_requests_stock check ((state in ('reserved', 'issued')) = (warehouse_id is not null) or state = 'used'),
  constraint supply_requests_purchase check ((state in ('ordered', 'bought')) = (purchase_id is not null) or state = 'used')
);
create unique index supply_requests_number_idx on repairs.supply_requests (number);
create index supply_requests_project_idx on repairs.supply_requests (project_id, state);
create index supply_requests_state_idx on repairs.supply_requests (state, need_by);

create table repairs.purchases (
  id          uuid primary key default gen_random_uuid(),
  number      text not null check (length(number) between 1 and 20),
  supplier    text not null check (length(btrim(supplier)) between 1 and 150),
  state       text not null default 'ordered' check (state in ('ordered', 'received')),
  receipt_qr  text check (receipt_qr is null or length(receipt_qr) <= 500),
  created_by  uuid not null references people.person_profiles (id),
  revision    integer not null default 1 check (revision >= 1),
  created_at  timestamptz not null default now(),
  received_at timestamptz,
  constraint purchases_received check ((state = 'received') = (received_at is not null))
);
create unique index purchases_number_idx on repairs.purchases (number);

create table repairs.purchase_lines (
  id                uuid primary key default gen_random_uuid(),
  purchase_id       uuid not null references repairs.purchases (id),
  supply_request_id uuid not null references repairs.supply_requests (id),
  project_id        uuid not null references repairs.projects (id),
  price_item_id     uuid not null references repairs.price_items (id),
  quantity          numeric(14, 3) not null check (quantity > 0),
  price_minor       bigint not null check (price_minor between 0 and 9007199254740991),
  currency          char(3) not null default 'RUB'
);
create unique index purchase_lines_request_idx on repairs.purchase_lines (supply_request_id);
create index purchase_lines_purchase_idx on repairs.purchase_lines (purchase_id);

alter table repairs.supply_requests add constraint supply_requests_purchase_fk foreign key (purchase_id) references repairs.purchases (id);

create table repairs.project_stock (
  project_id    uuid not null references repairs.projects (id),
  price_item_id uuid not null references repairs.price_items (id),
  quantity      numeric(14, 3) not null default 0 check (quantity >= 0),
  cost_minor    bigint not null default 0 check (cost_minor between 0 and 9007199254740991),
  currency      char(3) not null default 'RUB',
  updated_at    timestamptz not null default now(),
  primary key (project_id, price_item_id)
);

-- +goose Down
drop table repairs.project_stock;
alter table repairs.supply_requests drop constraint supply_requests_purchase_fk;
drop table repairs.purchase_lines;
drop table repairs.purchases;
drop table repairs.supply_requests;
drop sequence repairs.supply_request_number_seq;
