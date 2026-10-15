-- W1.00 · tenant 0007 · outbox: dead-letter в модели W1.01 (S1-24, шаг 1.1) · номер выдал стюард (PD-59)
-- +goose Up
-- Модель outbox — та, что реализует W1.01 (backend/internal/platform/events/outbox.go, Q-W1.01-3):
-- аренда — только locked_until (токен аренды, без владельца); dead-letter — published_at is null и
-- available_at = 'infinity', причина — last_error; ручной повтор (команда cmd/worker, запись в audit.events)
-- возвращает available_at и обнуляет attempts. Очередь Claim (published_at is null and available_at <= …)
-- читает outbox_pending_idx tenant 0001 — он остаётся; мёртвые события лежат в его конце и в диапазон
-- очереди не попадают. API по-прежнему только вставляет (grants.sql).
-- Мёртвое событие, записанное до 0007 без причины, получает ту же причину по умолчанию, что Failed W1.01.
update outbox.events set last_error = 'unknown error'
 where published_at is null and available_at = 'infinity' and last_error is null;
alter table outbox.events
  add constraint events_dead_has_error check (available_at <> 'infinity' or last_error is not null);
-- Список dead-letter (DeadLetters W1.01: order by id) и счёт мёртвых событий для эксплуатации.
create index outbox_dead_idx on outbox.events (id)
  where published_at is null and available_at = 'infinity';
-- +goose Down
drop index outbox.outbox_dead_idx;
alter table outbox.events drop constraint events_dead_has_error;