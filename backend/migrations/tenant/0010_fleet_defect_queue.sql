-- W2.00 · tenant 0010 · очередь блокирующих дефектов и решение менеджера (S2-17, D-29 комплекта; контракт 0.5.0-stage2).
-- Номер выдал стюард этапа 2 из блока 0010–0019 (план v2 §3.5, PD-59). Операции: listInspectionDefects,
-- getInspectionDefect, decideInspectionDefect (backend — W2.04). До шага 4.1 очередь заменяет задачу менеджеру
-- прототипа; W4.24 превращает дефект в задачу.
-- +goose Up
alter table fleet.defects
  add column trip_id          uuid references fleet.trips(id),
  add column reported_by      uuid,
  add column decision         text check (decision in ('allow_departure','confirm_out_of_service')),
  add column decision_comment text check (decision_comment is null or length(decision_comment) <= 2000),
  add column revision         integer not null default 1;

-- Решение менеджера несёт автора и время (resolved_by, resolved_at 0002) и своё конечное состояние:
-- allow_departure → resolved («признан некритичным»), confirm_out_of_service → confirmed_out_of_service.
-- Дефект в очереди (open, in_review) решения не имеет; resolved без решения — устранён ремонтом.
alter table fleet.defects
  add constraint defects_decision_resolved check (decision is null or (resolved_by is not null and resolved_at is not null)),
  add constraint defects_decision_state check (decision is null or state = case decision
    when 'allow_departure' then 'resolved'
    when 'confirm_out_of_service' then 'confirmed_out_of_service' end),
  add constraint defects_open_undecided check (state not in ('open','in_review') or decision is null),
  -- В очереди менеджера — только блокирующие дефекты (критический при выезде).
  add constraint defects_review_blocking check (state <> 'in_review' or severity = 'blocking');

-- Очередь менеджера: старые первыми; карточка рейса находит свой открытый дефект.
create index defects_review_queue_idx on fleet.defects (created_at, id)
  where state = 'in_review';
create index defects_trip_idx on fleet.defects (trip_id) where trip_id is not null;
-- +goose Down
drop index fleet.defects_trip_idx;
drop index fleet.defects_review_queue_idx;
alter table fleet.defects
  drop constraint defects_review_blocking,
  drop constraint defects_open_undecided,
  drop constraint defects_decision_state,
  drop constraint defects_decision_resolved;
alter table fleet.defects
  drop column revision,
  drop column decision_comment,
  drop column decision,
  drop column reported_by,
  drop column trip_id;
