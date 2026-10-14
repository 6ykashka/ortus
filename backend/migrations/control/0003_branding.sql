-- W0.06 · копия design/docs/db/control_0003_branding.sql · не редактировать (тест TestMirrorDesignSQL)
-- +goose Up
-- Ортус · Control DB · миграция 0003 branding (черновик v0.2, 02.10.2026)
-- Оформление организации. В control DB, потому что нужно до входа (страница логина по адресу
-- организации), оператору (логотипы в списках) и в письмах. Бизнес-данных здесь нет.
-- Документ: docs/18-branding.md.

-- Версия оформления неизменяема; действующая — максимальная версия тенанта.
create table tenant_branding_versions (
  tenant_id     uuid not null references tenants(id),
  version       integer not null check (version > 0),
  display_name  text not null check (length(trim(display_name)) between 1 and 60),
  short_name    text check (short_name is null or length(short_name) <= 16),
  accent_hex    char(7) not null check (accent_hex ~ '^#[0-9A-Fa-f]{6}$'),
  accent_used   char(7) not null check (accent_used ~ '^#[0-9A-Fa-f]{6}$'),  -- после автокоррекции контраста ≥ 4.5:1
  logo_file     uuid,                  -- ссылка на объект хранилища (публичный CDN-путь), не байты
  mark_file     uuid,
  terms         jsonb not null default '{}',   -- {"shift": {"one","plural","few","many"}}
  menu          jsonb not null default '{}',   -- {"items": {"fleet": {"label","icon","hidden"}}, "order": [...]}
  powered_by    boolean not null default true,
  created_by    uuid not null references memberships(id),
  created_at    timestamptz not null default now(),
  primary key (tenant_id, version),
  check (jsonb_typeof(terms) = 'object' and jsonb_typeof(menu) = 'object')
);

create view tenant_branding_current as
  select distinct on (tenant_id) * from tenant_branding_versions order by tenant_id, version desc;

-- Личная тема сотрудника — свойство аккаунта, не организации.
alter table accounts add column ui_theme text not null default 'system' check (ui_theme in ('system','light','dark'));

-- Правила, которые проверяет сервис (не БД):
-- • ключи terms — только из каталога (shift, vehicle, trip, visit, object), все четыре формы непустые, ≤ 40 символов;
-- • menu.items.*.icon — только из набора иконок модуля; hidden игнорируется для home/modules/users/billing/branding;
-- • файлы: PNG/SVG/JPEG/WebP ≤ 1 МБ, SVG санитизируется (без script, foreignObject, внешних ссылок);
-- • при смене display_name обновляется tenants.display_name в той же транзакции.
-- +goose Down
alter table accounts drop column ui_theme;
drop view tenant_branding_current;
drop table tenant_branding_versions;
