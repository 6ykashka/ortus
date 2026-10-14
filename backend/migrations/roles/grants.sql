-- W0.06 · гранты runtime-ролям после каждого Up (выполняет ortus_migrator, владелец БД).
-- У API и worker нет DDL (design/docs/14-engineering.md:81): только CONNECT, USAGE схем и DML.
-- CONNECT у PUBLIC отозван: к базам Ортус подключаются только роли с доступом к данным (ortus_provisioner — W1.02).
-- Неизменяемые записи (design/docs/10-data-model.md:38) — только INSERT: аудит, версии ролей и чек-листов,
-- движения квоты; outbox.events меняет только worker (публикация, повторы), API только вставляет.
do $$
declare
  s text;
  t text;
begin
  execute format('revoke connect, temporary on database %I from public', current_database());
  execute format('grant connect on database %I to ortus_api, ortus_worker', current_database());
  revoke create on schema public from public;
  for s in
    select nspname from pg_namespace
     where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and nspname not like 'pg\_temp\_%' and nspname not like 'pg\_toast\_temp\_%'
  loop
    execute format('grant usage on schema %I to ortus_api, ortus_worker', s);
    execute format('grant select, insert, update, delete on all tables in schema %I to ortus_api, ortus_worker', s);
    execute format('grant usage, select on all sequences in schema %I to ortus_api, ortus_worker', s);
  end loop;
  if to_regclass('public.goose_db_version') is not null then
    revoke insert, update, delete, truncate on public.goose_db_version from ortus_api, ortus_worker;
  end if;
  foreach t in array array['public.platform_audit', 'audit.events', 'access.role_versions',
                           'fleet.checklist_versions', 'files.quota_ledger'] loop
    if to_regclass(t) is not null then
      execute format('revoke update, delete, truncate on %s from ortus_api, ortus_worker', to_regclass(t));
    end if;
  end loop;
  if to_regclass('outbox.events') is not null then
    revoke update, delete, truncate on outbox.events from ortus_api;
  end if;
end
$$;
