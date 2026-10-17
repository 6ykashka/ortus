-- W2.40 · tenant 0013 · категории расходов по ответу на D-12 комплекта и юрлицо рейса (контракт 0.5.1-stage2).
-- Номер выдал стюард этапа 2 (план v2 §3.5, PD-59). Ответ владельца продукта 17.10
-- (docs/plan/v2/po-answers-2026-10-17.md, ADR-0013): + tire_service «Шиномонтаж и мелкий ремонт»; у other
-- комментарий обязателен; штрафы — не расход водителя. Справочник категорий тенанта — после показа (W2.41).
-- legal_entity_id — юрлицо рейса (модель данных п. 1): nullable FK, заполняет приложение юрлицом фирмы (W2.05),
-- UI в этапе 2 нет; строки до 0013 остаются с null.
-- +goose Up
alter table fleet.expenses
  drop constraint expenses_category_check,
  add constraint expenses_category_check
    check (category in ('fuel','wash','parking','toll','tire_service','other')),
  add constraint expenses_other_comment
    check (category <> 'other' or length(btrim(coalesce(comment, ''))) > 0);

alter table fleet.trips
  add column legal_entity_id uuid references org.legal_entities(id);
create index trips_legal_entity_idx on fleet.trips (legal_entity_id) where legal_entity_id is not null;
-- +goose Down
drop index fleet.trips_legal_entity_idx;
alter table fleet.trips drop column legal_entity_id;
alter table fleet.expenses
  drop constraint expenses_other_comment,
  drop constraint expenses_category_check,
  add constraint expenses_category_check
    check (category in ('fuel','wash','parking','toll','other'));
