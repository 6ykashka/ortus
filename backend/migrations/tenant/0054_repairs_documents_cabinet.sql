-- W6.00 · tenant 0054 · «Ремонт и стройка», документы и кабинет (контракт 0.12.0-stage6, W6.15, W6.16): документы и код SMS, начисления, подрядчики, ссылки кабинета.
-- Номер выдал стюард контрактного PR этапа 6 (W6.00; план v2 §3.5, PD-59). Разбор repair.md §2.1, Q-W4.00-repair-10 … -13,
-- -21; design/docs/19-construction.md «Правила». Документ (договор, допсоглашение, акт, счёт, акт сдачи, гарантийный
-- паспорт) ссылается на номер версии сметы; подпись — код из SMS на номер заказчика (D-31): в базе только хеш кода,
-- срок и число попыток; номер телефона подписавшего — хеш. Начисление бригаде открывается только по подписанному акту
-- (одна строка на «акт × работник»), выплата — предложение операции в кассу (cash_proposal_id — идентификатор кассы этапа
-- 5, без внешнего ключа). Подрядчик объекта — временный доступ (участник с ролью и сроком, Q-W4.00-repair-13).
-- Ссылка кабинета — только хеш токена «sha256:» + hex (токен возвращается один раз при выпуске); одна действующая на
-- объект; срок — до сдачи объекта; маршрут гостя находит тенант по индексу control 0010 public_client_links.
-- +goose Up
create table repairs.documents (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references repairs.projects (id),
  kind                text not null check (kind in ('contract', 'agreement', 'act', 'invoice', 'handover_act', 'warranty')),
  title               text not null check (length(btrim(title)) between 1 and 300),
  state               text not null default 'draft' check (state in ('draft', 'wait', 'sms', 'signed', 'paid')),
  estimate_version    integer check (estimate_version is null or estimate_version >= 1),
  act_no              integer check (act_no is null or act_no >= 1),
  amount_minor        bigint check (amount_minor is null or amount_minor between 0 and 9007199254740991),
  currency            char(3) not null default 'RUB',
  file_id             uuid,
  sign_code_hash      text,
  sign_code_expires_at timestamptz,
  sign_attempts       smallint not null default 0 check (sign_attempts >= 0),
  signer_phone_hash   text,
  sent_at             timestamptz,
  signed_at           timestamptz,
  revision            integer not null default 1 check (revision >= 1),
  created_at          timestamptz not null default now(),
  constraint documents_signed check ((state in ('signed', 'paid')) = (signed_at is not null)),
  constraint documents_sms check ((state = 'sms') = (sign_code_hash is not null and sign_code_expires_at is not null))
);
create index documents_project_idx on repairs.documents (project_id, kind, created_at);

create table repairs.crew_accruals (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references repairs.projects (id),
  worker_id        uuid not null references repairs.workers (id),
  act_id           uuid references repairs.documents (id),
  work             text check (work is null or length(work) <= 300),
  amount_minor     bigint not null check (amount_minor between 0 and 9007199254740991),
  currency         char(3) not null default 'RUB',
  state            text not null default 'pending_act' check (state in ('pending_act', 'accrued', 'proposed', 'paid')),
  self_employed    boolean not null default false,
  cash_proposal_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint crew_accruals_act check ((state = 'pending_act') = (act_id is null))
);
create unique index crew_accruals_act_idx on repairs.crew_accruals (act_id, worker_id);
create index crew_accruals_project_idx on repairs.crew_accruals (project_id, state);

create table repairs.subcontractors (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references repairs.projects (id),
  member_id      uuid references people.person_profiles (id),
  name           text not null check (length(btrim(name)) between 1 and 150),
  scope          text not null default '' check (length(scope) <= 300),
  active         boolean not null default false,
  access_until   date,
  contract_minor bigint check (contract_minor is null or contract_minor between 0 and 9007199254740991),
  paid_minor     bigint check (paid_minor is null or paid_minor between 0 and 9007199254740991),
  currency       char(3) not null default 'RUB',
  created_at     timestamptz not null default now(),
  constraint subcontractors_active check (not active or access_until is not null)
);
create index subcontractors_project_idx on repairs.subcontractors (project_id);

create table repairs.client_links (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references repairs.projects (id),
  token_digest text not null check (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  key_version  smallint not null default 1 check (key_version >= 1),
  sent_to      text check (sent_to is null or length(sent_to) <= 40),
  issued_by    uuid references people.person_profiles (id),
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz
);
create unique index client_links_digest_idx on repairs.client_links (token_digest);
create unique index client_links_active_idx on repairs.client_links (project_id) where revoked_at is null;

comment on column repairs.client_links.token_digest is 'Токен кабинета заказчика (clientToken тега Repairs) не хранится: при выпуске (issueClientLink) он возвращается один раз в URL. token_digest = ''sha256:'' || hex(SHA-256(token)). Путь гостя /api/v1/public/client/{clientToken} не несёт тенанта (БД у каждого тенанта своя, ADR 0006): тенант находится по тому же дайджесту в индексе control public_client_links (control 0010: token_digest → tenant_id, project_id, link_id = id этой строки); эта строка — источник истины: revoked_at is null и (expires_at is null или expires_at > now()) и объект не сдан — иначе 410 public_token_expired. Выпуск — сначала строка индекса, затем эта; отзыв — сначала эта, затем индекс.';
comment on column repairs.documents.sign_code_hash is 'Код подписи из SMS (D-31, порт доставки кода) не хранится: только хеш (HMAC-SHA256 ключом сервера), срок sign_code_expires_at и число неверных попыток sign_attempts; верный код переводит sms → signed, неверный — validation_failed (sms_code_invalid), просроченный — sms_code_expired.';

-- +goose Down
drop table repairs.client_links;
drop table repairs.subcontractors;
drop table repairs.crew_accruals;
drop table repairs.documents;
