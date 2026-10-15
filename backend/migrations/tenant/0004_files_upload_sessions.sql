-- W0.08 · tenant 0004 · сессии загрузки (S1-20, шаг 1.8) · номер выдал стюард контракта (PD-59)
-- +goose Up
-- Сессия загрузки: резерв квоты → presigned PUT → complete → scan → ready/rejected (13 S1-20; FILE-01/02).
-- Одна сессия на объект files.objects; видит её только начавший (actor_id). Уборщик закрывает просроченные
-- сессии (expired) и освобождает резерв files.usage.reserved_bytes в той же транзакции (запись files.quota_ledger).
-- Назначение файла — files.objects.purpose, значение UploadCreate.purpose контракта один к одному (inspection,
-- expense_receipt, …; UploadSession.purpose); точечные примеры в комментарии 0001 до контракта не используются.
create table files.upload_sessions (
  id                 uuid primary key default gen_random_uuid(),
  file_id            uuid not null unique references files.objects(id),
  actor_id           uuid not null,                         -- person_profiles.id начавшего загрузку
  state              text not null check (state in ('issued','uploaded','completed','expired','aborted')),
  reserved_bytes     bigint not null check (reserved_bytes >= 0),
  ticket_expires_at  timestamptz not null,                  -- срок presigned PUT (15 минут)
  session_expires_at timestamptz not null,                  -- после него резерв освобождается
  attempts           integer not null default 0 check (attempts >= 0),
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  closed_at          timestamptz,                           -- expired или aborted: резерв освобождён
  revision           integer not null default 1,
  check (ticket_expires_at <= session_expires_at),
  check ((state = 'completed') = (completed_at is not null)),
  check ((state in ('expired','aborted')) = (closed_at is not null))
);
create index upload_sessions_sweep_idx on files.upload_sessions (session_expires_at)
  where state in ('issued','uploaded');
create index upload_sessions_actor_idx on files.upload_sessions (actor_id, created_at desc);

-- +goose Down
drop table files.upload_sessions;
