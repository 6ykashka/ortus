-- W2.52 · tenant 0015 · справочник категорий расходов тенанта (D-12 комплекта, ответ владельца 17.10; контракт 0.6.1-stage2).
-- Номер выдал стюард этапа 2 (план v2 §3.5, PD-59). Операции: listExpenseCategories, createExpenseCategory,
-- archiveExpenseCategory, createTripExpense (backend — W2.41). Посев — шесть кодов W2.40 (tenant 0013): коды
-- остаются валидными, fleet.expenses.category ссылается на справочник. У «прочее» комментарий обязателен всегда
-- (expenses_other_comment 0013 остаётся); у категорий владельца — по comment_required (проверяет приложение).
-- Архивная категория остаётся у расходов, которые её несут; новый расход её не берёт (проверяет приложение).
-- Штрафы — не расход водителя и не категория.
-- +goose Up
create table fleet.expense_categories (
  code             text primary key check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  label            text not null check (length(btrim(label)) between 1 and 100),
  comment_required boolean not null default false,
  seeded           boolean not null default false,
  sort_order       integer not null,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid,
  revision         integer not null default 1,
  constraint expense_categories_archived check ((archived_at is null) = (archived_by is null)),
  constraint expense_categories_other check (code <> 'other' or (comment_required and archived_at is null)),
  constraint expense_categories_created check (seeded or created_by is not null)
);
-- Подпись активной категории уникальна без учёта регистра и крайних пробелов (422 duplicate контракта).
create unique index expense_categories_label_uq on fleet.expense_categories (lower(btrim(label)))
  where archived_at is null;
create index expense_categories_order_idx on fleet.expense_categories (sort_order, code);

insert into fleet.expense_categories (code, label, comment_required, seeded, sort_order) values
  ('fuel', 'Топливо', false, true, 10),
  ('wash', 'Мойка', false, true, 20),
  ('parking', 'Парковка', false, true, 30),
  ('toll', 'Платная дорога', false, true, 40),
  ('tire_service', 'Шиномонтаж и мелкий ремонт', false, true, 50),
  ('other', 'Прочее', true, true, 60);

alter table fleet.expenses
  drop constraint expenses_category_check,
  add constraint expenses_category_fk foreign key (category) references fleet.expense_categories (code);
-- +goose Down
-- Down возвращает CHECK 0013 из шести кодов; расход с кодом категории владельца не даст его вернуть (данные
-- не теряются молча).
alter table fleet.expenses
  drop constraint expenses_category_fk,
  add constraint expenses_category_check
    check (category in ('fuel','wash','parking','toll','tire_service','other'));
drop table fleet.expense_categories;
