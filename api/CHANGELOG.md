# Журнал контракта Ортус

Каждое отличие бандла `api/dist/ortus.bundle.yaml` от OpenAPI 0.1 (`design/docs/v0.1/ortus-openapi-v0.1.yaml`) объявлено в `api/openapi/source-delta.yaml` и записано здесь. После W0.07 контракт меняется только аддитивно (контрактный PR шага, стюард этапа).

## 0.2.0-stage0 — W0.07 (шаг 0.2 плана 27)

Раскладка (PD-56): `api/openapi/ortus.yaml`, `paths/<tag>.yaml` (18), `components/<группа>/<вид>.yaml`. Бандл собирается `node tools/gen/contract.mjs`; операции, пути, теги и схемы 0.1 не менялись, кроме строк ниже.

| Указатель                                           | Изменение                                                                                                                                                                  | Источник                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `/info/version`                                     | `0.1.0-design` → `0.2.0-stage0`                                                                                                                                            | PD-56                         |
| `/components/schemas/Tenant/properties/status/enum` | `provisioning, active, suspended, closing` → `provisioning, trial, active, grace, read_only, suspended, closing, closed`; `restricted` прототипа = `grace` или `read_only` | PLAT-02, PD-35                |
| `/components/schemas/ProblemCode`                   | новая схема: `enum` из 52 кодов `api/errors.yaml` (48 — реестр 12 версии 14.10, 4 — PD-34)                                                                                 | 12 «Реестр кодов», PD-34      |
| `/components/schemas/Problem/properties/code`       | `type: string` → `$ref: ProblemCode`                                                                                                                                       | 12, README v0.2 «Расхождения» |
| `/components/schemas/Problem/properties/retryable`  | новое необязательное `boolean`                                                                                                                                             | 12 «Формат ошибки»            |

Вне бандла (каталог прав и правила; на `api/dist/` не влияют):

| Файл               | Изменение                                                                                                                                                                                        | Источник                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `permissions.yaml` | 108 ключей 11 (14.10) + 14 `inventory.*`, `spa.*`, `cash.*` из `x-permissions` 0.1 + `forms.responses.assign` из `x-field-permissions` 0.1 (`reviewFormResponse`) = 123; все добавления PROPOSED | C, факт 3; G-21; ревью W0.07       |
| `.spectral.yaml`   | правила `ortus-*` (13): в т. ч. `ortus-x-field-permissions-in-catalog`, `ortus-x-permissions-empty`, `ortus-public-security`                                                                     | 12 «Линтер контракта»; ревью W0.07 |
