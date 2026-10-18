-- W2.52 · tenant 0017 · доказательства осмотра и задача дефекта (контракт 0.6.1-stage2, ответы владельца 17.10).
-- Номер выдал стюард этапа 2 (план v2 §3.5, PD-59).
-- 1. Антифрод фото (модель данных п. 4, W2.43): поиск повтора файла по sha256 среди не отклонённых файлов тенанта;
--    фото осмотра хранит серверное время приёма (completeUpload — files.upload_sessions.completed_at) и
--    предупреждение о повторе на момент отправки осмотра (InspectionPhoto.serverCapturedAt, duplicateWarning).
-- 2. Чек-лист — форма (D-30 комплекта, W2.45): fleet.checklist_versions.definition в формате FormDefinition
--    OpenAPI; существующие версии переносятся функцией fleet.checklist_definition из items и required_photo_roles,
--    вставка без definition получает его тем же правилом (триггер) — писатели W2.04 не меняются.
-- 3. Поля задачи у дефекта в очереди (D-29 комплекта, W2.46): исполнитель, срок, кто и когда назначил; решение —
--    decision 0010.
-- 4. Адрес остановки для ссылки внешнего навигатора (D-11 комплекта, W2.50): fleet.trip_stops.navigation_address.
-- +goose Up
create index files_sha256_idx on files.objects (sha256, created_at)
  where sha256 is not null and state <> 'rejected';

alter table fleet.inspection_photos
  add column server_captured_at      timestamptz,
  add column duplicate_count         integer check (duplicate_count is null or duplicate_count > 0),
  add column duplicate_first_seen_at timestamptz,
  add column duplicate_same_owner    boolean,
  add constraint inspection_photos_duplicate check (
    (duplicate_count is null) = (duplicate_first_seen_at is null)
    and (duplicate_count is null) = (duplicate_same_owner is null));
-- Фото до 0017: серверное время — завершение сессии загрузки файла.
update fleet.inspection_photos p set server_captured_at = s.completed_at
  from files.upload_sessions s
 where s.file_id = p.file_id and s.completed_at is not null;

-- FormDefinition версии чек-листа ($1 — kind, $2 — items [{key,label,required,failureBlocksRelease}], $3 — роли
-- фото tenant 0002): пункты — single_choice pass/fail/not_applicable (InspectionCheck.result), failureBlocksRelease
-- → blockingValues [fail]; роли — поля file photo_<роль контракта> (back → rear; interior вне контракта пропускается).
-- ВРЕМЕННЫЕ подписи до решения Q-W2.52-8 (в эталоне нет): «Исправно», «Неисправно», «Не применимо», «Груз», «Повреждение».
-- +goose StatementBegin
create function fleet.checklist_definition(text, jsonb, text[]) returns jsonb
  language sql immutable parallel safe
as $$
  select jsonb_build_object(
    'title', case $1 when 'departure' then 'Осмотр перед выездом' else 'Осмотр при сдаче' end,
    'description', '',
    'fields', coalesce((
      select jsonb_agg(f.field order by f.ord)
        from (
          select i.ord,
                 jsonb_build_object(
                   'key', i.item->>'key',
                   'label', i.item->>'label',
                   'type', 'single_choice',
                   'required', coalesce((i.item->>'required')::boolean, true),
                   'options', jsonb_build_array(
                     jsonb_build_object('key', 'pass', 'label', 'Исправно'),
                     jsonb_build_object('key', 'fail', 'label', 'Неисправно'),
                     jsonb_build_object('key', 'not_applicable', 'label', 'Не применимо')))
                 || case when coalesce((i.item->>'failureBlocksRelease')::boolean, false)
                         then jsonb_build_object('blockingValues', jsonb_build_array('fail'))
                         else '{}'::jsonb end as field
            from jsonb_array_elements(coalesce($2, '[]'::jsonb)) with ordinality as i(item, ord)
          union all
          select 1000 + r.ord,
                 jsonb_build_object(
                   'key', 'photo_' || r.role,
                   'label', r.label,
                   'type', 'file',
                   'required', true,
                   'maxFiles', 1,
                   'allowedMimeTypes', jsonb_build_array('image/jpeg'),
                   'maxFileBytes', 20971520)
            from (select p.ord,
                         case p.role when 'back' then 'rear' else p.role end as role,
                         case p.role
                           when 'front' then 'Спереди' when 'back' then 'Сзади' when 'rear' then 'Сзади'
                           when 'left' then 'Слева' when 'right' then 'Справа' when 'odometer' then 'Одометр'
                           when 'cargo' then 'Груз' when 'damage' then 'Повреждение'
                         end as label
                    from unnest(coalesce($3, '{}'::text[])) with ordinality as p(role, ord)) r
           where r.label is not null
        ) f), '[]'::jsonb),
    'visibility', '[]'::jsonb,
    'confirmationText', '')
$$;
-- +goose StatementEnd

alter table fleet.checklist_versions add column definition jsonb;
update fleet.checklist_versions set definition = fleet.checklist_definition(kind, items, required_photo_roles);
alter table fleet.checklist_versions
  alter column definition set not null,
  add constraint checklist_versions_definition_form check (
    coalesce(jsonb_typeof(definition->'title'), '') = 'string'
    and coalesce(jsonb_typeof(definition->'fields'), '') = 'array');

-- +goose StatementBegin
create function fleet.checklist_versions_fill_definition() returns trigger
  language plpgsql
as $$
begin
  if new.definition is null then
    new.definition := fleet.checklist_definition(new.kind, new.items, new.required_photo_roles);
  end if;
  return new;
end
$$;
-- +goose StatementEnd
create trigger checklist_versions_definition before insert on fleet.checklist_versions
  for each row execute function fleet.checklist_versions_fill_definition();

alter table fleet.defects
  add column assignee_id uuid references people.person_profiles (id),
  add column due_at      timestamptz,
  add column assigned_by uuid,
  add column assigned_at timestamptz,
  add constraint defects_assignment check (
    (assignee_id is null) = (assigned_at is null) and (assigned_at is null) = (assigned_by is null)),
  add constraint defects_assignment_due check (due_at is null or assignee_id is not null);
-- Очередь исполнителя: его дефекты на проверке по сроку.
create index defects_assignee_idx on fleet.defects (assignee_id, due_at)
  where state = 'in_review' and assignee_id is not null;

alter table fleet.trip_stops
  add column navigation_address text
    check (navigation_address is null or length(btrim(navigation_address)) between 1 and 500);
-- +goose Down
alter table fleet.trip_stops drop column navigation_address;
drop index fleet.defects_assignee_idx;
alter table fleet.defects
  drop constraint defects_assignment_due,
  drop constraint defects_assignment,
  drop column assigned_at,
  drop column assigned_by,
  drop column due_at,
  drop column assignee_id;
drop trigger checklist_versions_definition on fleet.checklist_versions;
drop function fleet.checklist_versions_fill_definition();
alter table fleet.checklist_versions
  drop constraint checklist_versions_definition_form,
  drop column definition;
drop function fleet.checklist_definition(text, jsonb, text[]);
alter table fleet.inspection_photos
  drop constraint inspection_photos_duplicate,
  drop column duplicate_same_owner,
  drop column duplicate_first_seen_at,
  drop column duplicate_count,
  drop column server_captured_at;
drop index files.files_sha256_idx;
