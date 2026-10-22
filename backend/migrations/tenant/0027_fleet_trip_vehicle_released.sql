-- W2.78 · tenant 0027 · машина рейса отпущена до приёмки (Q-W2.72-1; S2-20 правило 6, Q-W2.70-9; D-35).
-- Номер — следующий свободный блока этапа 4 (резерв 0027–0039, как 0023 у W2.71); стюард контракта подтверждает его в
-- api/README.md. Контракт не меняется: отметка — внутреннее поле, в DTO не выходит.
-- Обычная машина временного водителя (машина домашней фирмы, одобренная с запросом рейса: driver_transfers.home_vehicle_id,
-- vehicle_decision = 'approved') возвращается своей фирме, когда отправлен осмотр сдачи (W2.72 закрывает её бронь);
-- приёмки смены фирмой рейса она не ждёт. Рейс помнит этот момент (vehicle_released_at), и trips_active_vehicle_uq
-- (CAL-06, tenant 0002) больше не держит отпущенную машину за рейсом в returning/submitted/rework: другой рейс её
-- фирмы переходит по ней в inspection. Машина фирмы рейса и машина другой фирмы без одобренного перевода отметки не
-- получают и держатся до приёмки, как прежде (AC-05, S2-10, Q-W2.72-13). При блокирующем дефекте выезда решение фирмы
-- машины снимает её с рейса (planned, vehicle_id = null) — отметка не нужна.
-- Заполнение: рейсы, уже ждущие приёмки после осмотра сдачи на такой машине, получают момент осмотра сдачи.
-- +goose Up
alter table fleet.trips
  add column vehicle_released_at timestamptz,
  add constraint trips_vehicle_released check (vehicle_released_at is null or vehicle_id is not null);

update fleet.trips t
   set vehicle_released_at = i.submitted_at
  from fleet.inspections i
 where i.id = t.return_inspection_id and i.vehicle_id = t.vehicle_id
   and t.state in ('returning', 'submitted', 'rework')
   and exists (select 1 from fleet.driver_transfers x
                where x.trip_id = t.id and x.home_vehicle_id = t.vehicle_id and x.vehicle_decision = 'approved');

-- Фактическая занятость (CAL-06): машина в одном активном рейсе, кроме рейса, отпустившего её до приёмки.
drop index fleet.trips_active_vehicle_uq;
create unique index trips_active_vehicle_uq on fleet.trips (vehicle_id)
  where state in ('inspection', 'defect_review', 'on_route', 'returning', 'submitted', 'rework')
    and vehicle_released_at is null;

-- +goose Down
drop index fleet.trips_active_vehicle_uq;
create unique index trips_active_vehicle_uq on fleet.trips (vehicle_id)
  where state in ('inspection','defect_review','on_route','returning','submitted','rework');
alter table fleet.trips
  drop constraint trips_vehicle_released,
  drop column vehicle_released_at;
