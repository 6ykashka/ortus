-- W4.02 · tenant 0020 · виды областей этапов 4–7 в назначениях ролей (контракт 0.7.0-stage4, контрактный PR 1 этапа 4).
-- Номер выдал стюард контракта этапа 4 (W4.02; план v2 §3.5, PD-59; блок этапа 4 — 0020–0039).
-- ADR-0014 п. 3: виды модулей добавляет контрактный PR этапа; реестр видов остаётся в Go (Q-W1.04-7), в SQL — check.
-- Объектные виды (ровно один объект — scope_ref): space, page (база знаний), folder, doc («Документы»), account
-- (касса), chat, repair_project (объект ремонта, Q-W4.00-repair-2; project — только проект задач, RS-08).
-- relation — вычисляемая связь участника с записью (прораб объекта, водитель рейса, исполнитель задачи): как tenant и
-- self, без scope_ref. Пока оценщик не зарегистрировал вид (W4.01, W5.00, W6.00, W7.00), грант вида не даёт ничего.
-- +goose Up
alter table access.role_assignments
  drop constraint role_assignments_scope_kind_check,
  drop constraint role_assignments_check,
  add constraint role_assignments_scope_kind_check check (scope_kind in ('tenant', 'unit', 'project', 'warehouse', 'resource', 'self', 'space', 'page', 'folder', 'doc', 'account', 'chat', 'relation', 'repair_project')),
  add constraint role_assignments_check check ((scope_kind in ('tenant', 'self', 'relation')) = (scope_ref is null));

-- +goose Down
-- Политика «только вперёд»: Down данные не чистит. Пока в access.role_assignments есть назначения видов этапов 4–7
-- (фикстура изоляции, стенд после W4.01), откат падает 23514 — их снимают отзывом назначений, не этим файлом.
alter table access.role_assignments
  drop constraint role_assignments_scope_kind_check,
  drop constraint role_assignments_check,
  add constraint role_assignments_scope_kind_check check (scope_kind in ('tenant', 'unit', 'project', 'warehouse', 'resource', 'self')),
  add constraint role_assignments_check check ((scope_kind in ('tenant', 'self')) = (scope_ref is null));
