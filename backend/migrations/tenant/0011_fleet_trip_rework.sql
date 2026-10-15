-- W2.00 · tenant 0011 · повторная сдача после доработки и решения приёмки по разделам (S2-10, Q-51; контракт 0.5.0-stage2).
-- Номер выдал стюард этапа 2 (план v2 §3.5, PD-59). Операции: submitInspection (attempt), reviewTrip
-- (decision rework + steps), getTripPlan.lastReview (backend — W2.05, W2.06).
-- +goose Up
-- Осмотр того же вида повторяется после доработки (return) и после снятия машины с рейса (departure):
-- уникальна попытка, а не вид. Рейс ссылается на последнюю попытку (departure/return_inspection_id 0002).
alter table fleet.inspections
  add column attempt integer not null default 1 check (attempt > 0),
  add column comment text check (comment is null or length(comment) <= 1000);
alter table fleet.inspections drop constraint inspections_trip_id_kind_key;
alter table fleet.inspections add constraint inspections_trip_kind_attempt_key unique (trip_id, kind, attempt);

-- Решения приёмки по раундам. steps — разделы доработки (REV_STEPS прототипа): photos — «Фото при сдаче»,
-- odometer — «Пробег», expenses — «Расходы», checklist — «Чек-лист и дефекты».
create table fleet.trip_reviews (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references fleet.trips(id),
  attempt     integer not null check (attempt > 0),
  decision    text not null check (decision in ('approve','reject','maintenance_required','rework')),
  comment     text check (comment is null or length(comment) <= 5000),
  steps       text[] not null default '{}' check (steps <@ array['photos','odometer','expenses','checklist']::text[]),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  unique (trip_id, attempt),
  -- Доработка: непустой комментарий и хотя бы один раздел (тексты 422 — контракт); разделы — только у доработки.
  check (decision <> 'rework' or (length(btrim(coalesce(comment, ''))) > 0 and cardinality(steps) > 0)),
  check (decision = 'rework' or cardinality(steps) = 0)
);
-- +goose Down
-- Down без потери данных: при второй попытке осмотра того же вида возврат уникальности (trip_id, kind) падает.
drop table fleet.trip_reviews;
alter table fleet.inspections drop constraint inspections_trip_kind_attempt_key;
alter table fleet.inspections add constraint inspections_trip_id_kind_key unique (trip_id, kind);
alter table fleet.inspections
  drop column comment,
  drop column attempt;
