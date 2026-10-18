-- W2.51 · tenant 0014 · индекс комплекта брони и пул водителей (контракт 0.6.0-stage2).
-- Номер выдал стюард этапа 2 (план v2 §3.5, PD-59).
-- Q-W2.02-14: на sched.reservations (bundle_id) опираются transition, Release, Consume и lock с Replaces (W2.02).
-- Пул (S2-14, AUTH-06/07, AC-06): публикация — псевдоним «Водитель #N», условия, ревизия, снятие с автором; окна
-- активных публикаций водителя не пересекаются. Запрос — комментарий, комментарий решения, момент завершения; один
-- открытый (requested) запрос на публикацию (эталон api.js:544); решённый — с автором и временем; одобренный и
-- завершённый — только с временным назначением (access.role_assignments, source transfer); completed и revoked —
-- с моментом завершения. Индексы автозавершения: истечение открытых запросов по началу окна, завершение одобренных
-- по концу окна (W2.07). Снятие хранит автора и комментарий (DriverPoolWithdrawal.comment), отзыв — автора отдельно от
-- одобрившего (decided_by не меняется). Исключение пересечения держат все неснятые публикации — и истёкшие: «истекла»
-- — это upper(available) <= now(), в предикате индекса now() недопустим; MSW проверяет то же (state != withdrawn).
-- Пересечение одобренных запросов одного водителя ограничением не закрыто (у запроса нет person_id): W2.07
-- сериализует одобрение (lock публикаций водителя или advisory lock по person_id).
-- +goose Up
create index reservations_bundle_idx on sched.reservations (bundle_id);

alter table fleet.pool_publications
  add column display_name text,
  add column terms text check (terms is null or length(terms) <= 500),
  add column revision integer not null default 1,
  add column withdrawn_by uuid,
  add column withdrawal_comment text,
  add constraint pool_publications_window check (not isempty(available) and not lower_inf(available) and not upper_inf(available)),
  add constraint pool_publications_withdrawn check ((withdrawn_at is null) = (withdrawn_by is null)),
  add constraint pool_publications_withdrawal_comment check (withdrawal_comment is null or (withdrawn_at is not null and length(withdrawal_comment) <= 2000)),
  add constraint pool_publications_no_overlap
    exclude using gist (person_id with =, available with &&)
    where (withdrawn_at is null);
create unique index pool_publications_display_name_uq on fleet.pool_publications (display_name)
  where display_name is not null;

alter table fleet.driver_transfers
  add column reason text check (reason is null or length(reason) <= 2000),
  add column decision_comment text check (decision_comment is null or length(decision_comment) <= 2000),
  add column completed_at timestamptz,
  add column revoked_by uuid,
  add constraint driver_transfers_revoked check ((state = 'revoked') = (revoked_by is not null)),
  add constraint driver_transfers_period check (not isempty(period) and not lower_inf(period) and not upper_inf(period)),
  add constraint driver_transfers_decided check (state in ('requested','expired') or (decided_by is not null and decided_at is not null)),
  add constraint driver_transfers_grant check (state not in ('approved','completed') or assignment_id is not null),
  add constraint driver_transfers_completed check ((state in ('completed','revoked')) = (completed_at is not null));
create unique index driver_transfers_open_uq on fleet.driver_transfers (publication_id)
  where state = 'requested';
create index driver_transfers_approved_end_idx on fleet.driver_transfers (upper(period))
  where state = 'approved';
create index driver_transfers_requested_start_idx on fleet.driver_transfers (lower(period))
  where state = 'requested';
create index driver_transfers_trip_idx on fleet.driver_transfers (trip_id) where trip_id is not null;
-- +goose Down
drop index fleet.driver_transfers_trip_idx;
drop index fleet.driver_transfers_requested_start_idx;
drop index fleet.driver_transfers_approved_end_idx;
drop index fleet.driver_transfers_open_uq;
alter table fleet.driver_transfers
  drop constraint driver_transfers_completed,
  drop constraint driver_transfers_grant,
  drop constraint driver_transfers_decided,
  drop constraint driver_transfers_period,
  drop constraint driver_transfers_revoked,
  drop column revoked_by,
  drop column completed_at,
  drop column decision_comment,
  drop column reason;

drop index fleet.pool_publications_display_name_uq;
alter table fleet.pool_publications
  drop constraint pool_publications_no_overlap,
  drop constraint pool_publications_withdrawal_comment,
  drop constraint pool_publications_withdrawn,
  drop constraint pool_publications_window,
  drop column withdrawal_comment,
  drop column withdrawn_by,
  drop column revision,
  drop column terms,
  drop column display_name;

drop index sched.reservations_bundle_idx;
