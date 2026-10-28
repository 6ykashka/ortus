-- W7.31 · tenant 0063 · «Обращения клиентов»: три правки схемы service, без которых сид эталона не ложится в таблицы 0062.
-- Номер взят из резерва блока этапа 7 (0063–0069) по возврату 1 W7.31: 0062 выдал стюард W7.00 и она уже накатана на стендах,
-- править её на месте нельзя (контрольная сумма, расхождение схем). Стюарду — подтвердить номер или заменить своим (Q-W7.31-1).
--   1. Ключ направления — буквы эталона МАС, КОС, ОТД, ГРЗ (как ключ проекта «Задач»), а не только латиница.
--   2. Автоответ клиенту (auto) пишется без автора: у notes и public автор нужен, если сообщение не автоответ.
--   3. service.messages.seq — порядок записи ленты при равных моментах.
-- +goose Up
alter table service.directions drop constraint directions_key_check;
alter table service.directions
  add constraint directions_key_check check (key ~ '^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]{1,5}$');

alter table service.messages drop constraint messages_note_author;
alter table service.messages
  add constraint messages_note_author check (kind not in ('note', 'public') or author_id is not null or auto);

alter table service.messages add column seq bigint generated always as identity;

-- +goose Down
alter table service.messages drop column seq;

alter table service.messages drop constraint messages_note_author;
alter table service.messages
  add constraint messages_note_author check (kind not in ('note', 'public') or author_id is not null);

alter table service.directions drop constraint directions_key_check;
alter table service.directions
  add constraint directions_key_check check (key ~ '^[A-Z][A-Z0-9]{1,5}$');
