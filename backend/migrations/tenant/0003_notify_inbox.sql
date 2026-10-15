-- W0.08 · tenant 0003 · входящие уведомления (S1-26, шаг 1.9) · номер выдал стюард контракта (PD-59)
-- +goose Up
-- Входящие (13 S1-26; 02-architecture «Уведомления/realtime»: адресат проверяется при постановке в очередь
-- и при доставке). Строки пишет worker по событиям outbox.events; повторная доставка события не создаёт второе
-- уведомление (unique recipient_person_id + source_event_id). Payload без restricted-полей; право и область
-- объекта хранятся, чтобы перепроверить доступ при выдаче (уведомление о начислении водителю не выдаётся).
create schema if not exists notify;

create table notify.notifications (
  id                  uuid primary key default gen_random_uuid(),
  recipient_person_id uuid not null references people.person_profiles(id),
  kind                text not null check (kind ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'),
  severity            text not null default 'info' check (severity in ('info','warning','critical')),
  title               text not null check (length(title) between 1 and 300),
  body                text check (length(body) <= 2000),
  module_key          text,
  entity_type         text,
  entity_id           uuid,
  link                text check (link ~ '^/([^/\\[:space:][:cntrl:]][^\\[:space:][:cntrl:]]*)?$'
                             and char_length(link) <= 512),  -- как returnTo: без //, \, пробелов (CWE-601)
  unit_id             uuid references org.units(id),           -- область объекта для перепроверки при выдаче
  sensitivity         text not null default 'normal' check (sensitivity in ('normal','sensitive','restricted')),
  required_permission text,                                    -- без этого права уведомление не выдаётся
  source_event_id     uuid,                                    -- outbox.events.event_id; null — системное
  created_at          timestamptz not null default now(),
  read_at             timestamptz,
  archived_at         timestamptz,
  unique (recipient_person_id, source_event_id),
  check ((module_key is null) = (entity_id is null) and (entity_type is null) = (entity_id is null))
);
create index notifications_feed_idx on notify.notifications (recipient_person_id, created_at desc)
  where archived_at is null;
create index notifications_unread_idx on notify.notifications (recipient_person_id)
  where read_at is null and archived_at is null;

-- +goose Down
-- Без cascade: чужой объект в notify (резерв 0007–0009) останавливает откат, а не снимается молча.
drop table notify.notifications;
drop schema notify;
