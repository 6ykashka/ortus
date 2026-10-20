-- W2.71 · tenant 0023 · машина для временного водителя (контракт 0.7.1-stage4, в ветке 0.6.3-stage2; S2-20; решение владельца 19.10 по Q-W2.32-1).
-- В ветке — 0019 (последний номер блока этапа 2); при вливании после W4.02 (0020) и W4.06 (0021–0022) интегратор
-- перенумеровал в 0023 — goose без WithAllowOutofOrder (api/README.md, «Порядок вливания номеров ниже применённого»).
-- Обычная машина водителя — машина домашней фирмы, опубликованная вместе с ним (правило 1, TD-01). Запрос водителя
-- хранит режим машины (home — своя обычная, host — машина фирмы рейса, host_or_home — на выбор водителя), обе машины,
-- решение фирмы водителя по обычной машине и группу броней, созданную одобрением. Брони предложения — альтернативы
-- одного рейса (offer_group_id): кто выбирает (offered_to), вид машины, срок выбора; hold предложения держится до
-- срока выбора (hold_expires_at = choose_until); подтверждается ровно одна бронь группы (частичный уникальный индекс),
-- остальные снимаются с причиной. Exclusion constraint reservations_no_overlap не меняется: брони одной группы — на
-- разные машины, каждая занимает свою машину только на окно рейса (правило 3).
-- +goose Up
alter table fleet.pool_publications
  add column usual_vehicle_id uuid references fleet.vehicles (id);

alter table fleet.driver_transfers
  add column vehicle_mode text,
  add column home_vehicle_id uuid references fleet.vehicles (id),
  add column host_vehicle_id uuid references fleet.vehicles (id),
  add column vehicle_decision text,
  add column offer_group_id uuid,
  add constraint driver_transfers_vehicle_mode check (vehicle_mode is null or vehicle_mode in ('home', 'host', 'host_or_home')),
  add constraint driver_transfers_vehicle_decision check (vehicle_decision is null or vehicle_decision in ('approved', 'declined')),
  add constraint driver_transfers_vehicle_set check (
    vehicle_mode is not null
    or (home_vehicle_id is null and host_vehicle_id is null and vehicle_decision is null and offer_group_id is null)),
  add constraint driver_transfers_host_vehicle check (vehicle_mode is null or (vehicle_mode = 'home') = (host_vehicle_id is null)),
  add constraint driver_transfers_home_vehicle check (vehicle_mode is null or (vehicle_mode = 'host') = (home_vehicle_id is null)),
  add constraint driver_transfers_home_decision check (vehicle_decision is null or home_vehicle_id is not null);

alter table sched.reservations
  add column offer_group_id uuid,
  add column offered_to uuid references people.person_profiles (id),
  add column offer_kind text,
  add column choose_until timestamptz,
  add column chosen_at timestamptz,
  add column released_at timestamptz,
  add column release_reason text,
  add constraint reservations_offer check ((offer_group_id is null) = (offered_to is null)),
  add constraint reservations_offer_kind check (offer_kind is null or (offer_group_id is not null and offer_kind in ('host', 'usual'))),
  add constraint reservations_choose_until check (choose_until is null or offer_group_id is not null),
  add constraint reservations_offer_hold check (state <> 'hold' or choose_until is null or hold_expires_at = choose_until),
  add constraint reservations_chosen check (chosen_at is null or (offer_group_id is not null and state in ('confirmed', 'consumed'))),
  add constraint reservations_released check (released_at is null or state = 'released'),
  add constraint reservations_release_reason check (
    release_reason is null or (state = 'released' and release_reason in ('chosen', 'deadline', 'manager', 'transfer_ended')));
create unique index reservations_offer_chosen_uq on sched.reservations (offer_group_id)
  where offer_group_id is not null and state in ('confirmed', 'consumed');
create index reservations_offer_group_idx on sched.reservations (offer_group_id) where offer_group_id is not null;
-- Срок выбора: воркер (W2.72) закрывает предложения, у которых срок прошёл.
create index reservations_choose_until_idx on sched.reservations (choose_until)
  where state = 'hold' and choose_until is not null;

-- +goose Down
drop index sched.reservations_choose_until_idx;
drop index sched.reservations_offer_group_idx;
drop index sched.reservations_offer_chosen_uq;
alter table sched.reservations
  drop constraint reservations_release_reason,
  drop constraint reservations_released,
  drop constraint reservations_chosen,
  drop constraint reservations_offer_hold,
  drop constraint reservations_choose_until,
  drop constraint reservations_offer_kind,
  drop constraint reservations_offer,
  drop column release_reason,
  drop column released_at,
  drop column chosen_at,
  drop column choose_until,
  drop column offer_kind,
  drop column offered_to,
  drop column offer_group_id;

alter table fleet.driver_transfers
  drop constraint driver_transfers_home_decision,
  drop constraint driver_transfers_home_vehicle,
  drop constraint driver_transfers_host_vehicle,
  drop constraint driver_transfers_vehicle_set,
  drop constraint driver_transfers_vehicle_decision,
  drop constraint driver_transfers_vehicle_mode,
  drop column offer_group_id,
  drop column vehicle_decision,
  drop column host_vehicle_id,
  drop column home_vehicle_id,
  drop column vehicle_mode;

alter table fleet.pool_publications
  drop column usual_vehicle_id;
