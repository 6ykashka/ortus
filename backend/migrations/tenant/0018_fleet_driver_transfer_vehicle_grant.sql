-- W2.57 · tenant 0018 · назначение на машину рейса у запроса пула водителей (контракт 0.6.2-stage2, решение Q-W2.07-1).
-- Номер выдал стюард дельты 0.6.2-stage2 (W2.57; план v2 §3.5, PD-59).
-- Временный водитель «только рейс»: основное назначение запроса (assignment_id) — роль «Временный водитель» в области
-- self на окно перевода; машина рейса — вторая строка той же роли в области resource (fleet.vehicles.read), которую
-- создаёт бронь рейса и закрывает конец окна, отзыв или завершение. Строка машины бывает только у запроса с основным
-- назначением.
-- +goose Up
alter table fleet.driver_transfers
  add column vehicle_assignment_id uuid references access.role_assignments (id),
  add constraint driver_transfers_vehicle_grant check (vehicle_assignment_id is null or assignment_id is not null);

-- +goose Down
alter table fleet.driver_transfers
  drop constraint driver_transfers_vehicle_grant,
  drop column vehicle_assignment_id;