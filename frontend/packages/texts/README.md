# @ortus/texts — словарь текстов интерфейса

Единственный источник пользовательских строк. Этапы 0–2 (W0.14): `shell`, `gate`, `banners`, `toast`, `errors`, `company`, `platform`, `logistics-manager`, `logistics-driver`, `home`, `screen-labels`. Новые домены (задачи, формы, база знаний, документы, чаты, касса, обращения, склад, SPA, ремонт, оформление) добавляют владельцы шагов своих этапов — новым файлом `src/<домен>.ts`.

```ts
import { company, errors, format, gate } from '@ortus/texts';

format(company.modules.trial.title, { days: 12, date: '13.10.2026' }); // «Осталось 12 дней · до 13.10.2026»
format(gate.b.titleModuleOff, { name: 'Логистика' }); // «Логистика» не подключена организацией
errors.problem[problem.code] ?? errors.http[`http${problem.status}`] ?? errors.fallback;
```

## Правила

1. **Дословно из эталона** (`design/`, снимок этапа): «ё», кавычки «», разделители « · » и « — », «…». Данные сида — только аргументами. Захардкоженные в эталоне строки хранятся дословно с комментарием `// захардкожено в эталоне :NNNN`.
2. **Одна строка-литерал — один файл.** Нужна чужая подпись — ссылка на файл-владелец (`home.work.off = gate.chips.moduleOff`). Подпись пункта меню = заголовок страницы: живёт в `shell.nav.items`. Импорты без циклов: `shell`, `gate` ничего не импортируют; `errors` → `gate`; `toast` → `errors`; страницы → базовые файлы.
3. **Сообщения сервера** — только `errors.ts`: `problem` по каноническому `Problem.code` (реестр `docs/12` v0.2 + PD-34, после W0.07 — `api/errors.yaml`), `client` (`offline`, `timeout`, `upload_failed`), `http` (текст статуса для неизвестного кода), `mock` (дословные сообщения mock-адаптера эталона для MSW). Карта «код прототипа ↔ канонический» — в `@ortus/domain` (`core/errors/map.ts`).
4. **Тосты** `run(…)` и прямые `toast('…')` — только `toast.ts`.
5. **Шаблоны — ICU MessageFormat**: `{name}`, `{n, plural, =0 {…} one {…} few {…} many {…} other {…}}` с `#`, `{flag, select, true {…} other {}}`. Аргументы — camelCase; `plural` с любой из форм `one/few/many` содержит все три и `other`; `select` — `other`. ASCII-апострофы и кавычки в тексте запрещены. `format()` бросает ошибку, если аргумент не передан; числа форматируются `Intl.NumberFormat('ru-RU')` (U+00A0 между разрядами), уже отформатированные значения («46,2») передавайте строкой.
6. **Ключи** — ASCII camelCase, без массивов (перечисления — объекты с ключами-идентификаторами эталона). Исключения: `errors.problem.*`, `errors.client.*` (ключ = значение enum API, snake_case), `errors.http.httpNNN`.
7. **Только добавление.** Ключи из `contract/keys.json` не удаляются и не переименовываются. `errors.ts` и `screen-labels.ts` пишет стюард контракта этапа; прочие файлы — владелец страницы или шага (план v2 §3.5).

## Команды

| Команда                                         | Что делает                                        |
| ----------------------------------------------- | ------------------------------------------------- |
| `corepack pnpm --filter @ortus/texts test`      | тесты (`node:test`, `--experimental-strip-types`) |
| `corepack pnpm --filter @ortus/texts typecheck` | `tsc --noEmit`                                    |
| `corepack pnpm --filter @ortus/texts gen`       | перегенерировать `src/index.ts` по файлам доменов |
| `corepack pnpm --filter @ortus/texts gen:keys`  | дописать новые ключи в `contract/keys.json`       |
| `node scripts/gen-index.mjs --check`            | exit 1, если `src/index.ts` устарел               |

Новый домен: создать `src/<домен>.ts` с `export const <camelДомен> = { … } as const satisfies TextTree;`, затем `gen` и `gen:keys`, затем добавить домен в `DOMAINS` теста `test/contract.test.mjs`.

## Тесты-охранники

`icu` (каждая строка — валидный ICU, формы ru), `problem-codes` (текст на каждый `Problem.code`), `api-messages` и `toasts` (сообщения и тосты эталона этапов 0–2 по фикстурам `test/fixtures/*.json`; изменение эталона — осознанная правка фикстуры), `domains` (каждая статическая строка есть в эталоне, шаблоны дают строки эталона), `screen-labels` (PD-37), `guards` (одна строка — один файл, типографика, «ё», U+00A0, ключи), `contract` (индекс, ключи, экспорт, без `dependencies`).
