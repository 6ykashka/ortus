-- W2.00 · tenant 0012 · поля плана рейса и карточки машины (Q-45, S2-13; контракт 0.5.0-stage2, TripPlan, Vehicle).
-- Номер выдал стюард этапа 2 (план v2 §3.5, PD-59). Операции: listTripPlans, getTripPlan, createTripPlan,
-- finishTripRoute, listVehicles (backend — W2.02, W2.03, W2.05). Колонки допускают null: строки до 0012
-- заполняет приложение; обязательность полей контракта проверяет сервер при записи.
-- +goose Up
alter table fleet.trips
  add column title              text check (title is null or length(title) between 1 and 200),
  add column cargo_description  text check (cargo_description is null or length(cargo_description) <= 500),
  add column distance_km        numeric(8,1) check (distance_km is null or distance_km >= 0),
  add column route_completed_at timestamptz;
-- «Сдача машины» (returning) — только после «Завершить рейс» (finishTripRoute отмечает время).
alter table fleet.trips
  add constraint trips_route_completed check (state <> 'returning' or route_completed_at is not null);

alter table fleet.vehicles
  add column display_name text check (display_name is null or length(display_name) between 1 and 200),
  add column depot        text check (depot is null or length(depot) <= 200),
  -- Короткая отметка состояния для карточки (Плановое ТО до 03.10); ставит сервер, не водитель.
  add column service_note text check (service_note is null or length(service_note) <= 200);
-- +goose Down
alter table fleet.vehicles
  drop column service_note,
  drop column depot,
  drop column display_name;
alter table fleet.trips drop constraint trips_route_completed;
alter table fleet.trips
  drop column route_completed_at,
  drop column distance_km,
  drop column cargo_description,
  drop column title;
