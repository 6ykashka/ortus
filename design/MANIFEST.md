# Манифест снимка `design/` — итерация 14.10.2026

Снимок эталона проекта Claude Design «Ортус CRM: первая итерация» (`https://claude.ai/design/p/724fad7d-35a5-4dcc-b888-2f2c0c9690e6`) для этапов 1–2 плана v2. Собран W0.02 15.10.2026 из присланных пользователем файлов итерации 14.10. Полного экспорта проекта (блокер B-1) пока нет, поэтому снимок **частичный**: всё, что прислано в 14.10, заменено целиком; всё остальное оставлено байт в байт от снимка 03.10 (тег `design-2026-10-03`).

- Тег этого снимка: `design-stage-1` (ставит интегратор на squash-коммит W0.02, PD-57).
- Предыдущий снимок: `design-2026-10-03` (`8152ef5`).
- Файлы не редактируются. Обновление — только целиком, следующим обходом DoR-сверщика с новым тегом.

## Источники

| Источник (недоверенные данные, только копирование) | Что взято | Куда |
|---|---|---|
| `Downloads/Ортус CRM.dc.html` (610 877 байт, 14.10.2026 23:04) | главный файл прототипа | `Ортус CRM.dc.html` |
| `Downloads/Документация.dc.html` (45 274 байт) | просмотрщик документации | `Документация.dc.html` |
| `Downloads/Ортус CRM_ первая итерация.zip` (40 файлов) | `docs/**` | `docs/` |
| `Downloads/Ортус CRM_ первая итерация (1).zip` (10 файлов) | `ortus/*.js` | `ortus/` |
| `Downloads/Ортус CRM_ первая итерация (2).zip` (30 файлов) | `screenshots/*` | `screenshots/` |
| `Downloads/Ортус CRM_ первая итерация (3).zip` (38 файлов) | `uploads/**` | `uploads/` |

## Что из 14.10

120 файлов из 131 (столбец «Итерация» = 14.10 в таблице «Файлы»):

- **Изменились** (15): `Ортус CRM.dc.html` (601 806 → 610 877 байт, 4537 → 4512 строк; 8 встроенных модулей `<dc-import>`), `Документация.dc.html` (документы 20–27 и три записи по «Чатам»), `ortus/api.js`, `ortus/models.js`, `ortus/mock-data.js`, `ortus/extra-data.js`, `docs/README.md`, `docs/11-permissions.yaml`, `docs/12-errors-and-events.md`, `docs/13-backlog-s0-s2.md`, `docs/16-raid-glossary.md` (D-01…D-28), `docs/19-construction.md`, `docs/design-system/components.md`, `uploads/ortus-crm-interface(1).html` и `uploads/ortus-crm-interface(1)-4b88cfd3.html` (в 03.10 был лишний перевод строки после `<head>` — след снятия служебного блока; версия 14.10 совпадает с исходным файлом пользователя от 01.10).
- **Новые** (53): `docs/20-forms.md` … `docs/27-implementation-plan.md` (8), `ortus/cash.js`, `ortus/chats.js`, `ortus/documents.js`, `ortus/knowledge.js`, `ortus/service.js` (5), `screenshots/*` (30: проверочные снимки «Кассы», «Обращений», «Задач и проектов»), `uploads/pasted-1791314…-0.png` и `uploads/pasted-1791477020324-0.png` (10: референсы Яндекс Форм и фрагмент `<select>`).
- **Без изменений, подтверждены 14.10** (52): остальные `docs/**` (v0.1, SQL, токены, `repo-skeleton`), `ortus/roadmap.js`, `uploads/**` прежнего состава.

## Что оставлено от 03.10

11 файлов, которых нет в присланной итерации 14.10 (столбец «Итерация» = 03.10): `support.js`, `README.md`, `Дизайн-система.dc.html`, `Объекты - варианты.dc.html`, `Ремонт и стройка.dc.html`, `Ortus CRM.dc.html`, `.thumbnail`, `screenshots/01-dbg.png`, `screenshots/02-dbg.png`, `screenshots/03-dbg.png`, `screenshots/dbg.png`. Совпадают ли они с проектом 14.10 — не подтверждено (раздел «Не хватает», C).

## Не хватает

Нужен полный экспорт проекта 14.10 (B-1, процедура `tools/README.md`). До него визуальная сверка модулей этапов 4–7 невозможна; этапам 1–2 эти файлы не нужны.

### A. Встроенные модули главного файла (`<dc-import>`): без них слот модуля пуст

| Файл | Где в главном файле | Что видно в эталоне |
|---|---|---|
| `Формы и опросы.dc.html` | `Ортус CRM.dc.html:1588` | пункт «Формы и опросы»: пустой слот, в консоли `sibling fetch … returned 404` |
| `Обращения.dc.html` | `:1593` | то же, пункт «Обращения» |
| `Задачи и проекты.dc.html` | `:1598` | то же, пункт «Задачи» (легаси-канбан «Заявки» `:1600+` работает) |
| `База знаний.dc.html` | `:1826` | то же, пункт «База знаний» |
| `Документы.dc.html` | `:1830` | то же, пункт «Документы» |
| `Чаты.dc.html` | `:1834` | то же, пункт «Чаты»; ещё фрейм «Чаты: модуль в прототипе» в Документации |
| `Касса.dc.html` | `:1898` | то же, пункт «Касса» / «Подотчёт» |
| `Ремонт и стройка.dc.html` | `:2121` | файл есть, но это версия 03.10: нет пропсов `obj`, `changes`, `canEdit`, `onChange`, вкладок `catalog`/`stock`, полей `objEst`/`reqBy`/`hub` в `onStatus`. Нужна свежая версия |

### B. Макеты «… - варианты» (упоминаются в Документации и `docs/21…26`)

- `Чаты - варианты.dc.html` — фрейм «Чаты: пять макетов настроек» в `Документация.dc.html`;
- `Задачи - варианты.dc.html` (`docs/21-tasks-projects.md`);
- `Обращения - варианты.dc.html` (`docs/22-client-requests.md`);
- `База знаний - варианты.dc.html` (`docs/23-knowledge-spaces.md`);
- `Документы - варианты.dc.html` (`docs/24-documents.md`);
- `Касса - варианты.dc.html` (`docs/26-cash.md`).

### C. Не подтверждено, что не менялись

`README.md` (в `docs/` упоминаются итерации 13/15/17, в README их нет), `support.js` (рантайм должен совпадать с модулями), `Дизайн-система.dc.html` (`docs/design-system/components.md` вырос с 8,6 до 10,2 КБ), `Объекты - варианты.dc.html`, `.thumbnail`, `Ortus CRM.dc.html`, `screenshots/*dbg.png` (в архиве 14.10 их нет — возможно, удалены из проекта).

## Как проверено

1. **Распаковка.** Четыре архива распакованы заново во временный каталог и сверены по SHA-256 с ранее распакованной копией (`nd/`, анализ `A`): 118 файлов, расхождений нет. Скрипты из архивов не запускались.
2. **Копирование.** Файлы скопированы байт в байт (`.gitattributes`: `design/** -text`). Повторная сверка «источник 14.10 ↔ `design/`»: все 120 файлов 14.10 совпадают по SHA-256, 11 файлов 03.10 не тронуты.
3. **Служебные блоки.** Ни в одном `*.html` нет `data-omelette-injected`: файлы 14.10 получены экспортом, а не через `GetFile`, и `tools/design-strip-injected.js` не понадобился.
4. **Манифест.** Таблица «Файлы» сгенерирована по содержимому `design/`. Тест `docs/plan/scripts/design-snapshot.test.mjs` сверяет каждую строку (размер, SHA-256), состав 14.10 (8 `dc-import`, 10 `ortus/*.js`, `docs/20…27`), ссылки `Документации` на `docs/…` и полноту раздела «Не хватает».
5. **Эталон в браузере** (15.10.2026, Chromium 151 через Playwright 1.62.1, 1440×900, сервер `tools/design-preview.js` из W0.05 с путём `design`: порт 4104 без флагов и порт 4105 с `--offline`; результаты в обоих режимах одинаковы):
   - owner — «Доброе утро, Дарья», «Требует решения: 12», меню: Обзор, Компания, Отрасли (Салон и SPA), Общие модули (10 пунктов с бейджами); ошибок консоли нет;
   - manager — «Доброе утро, Марина», меню: Обзор, Логистика («Рабочее место логиста»), Общие модули (Чаты, Задачи, Обращения, База знаний, Документы); ошибок консоли нет;
   - driver — гейт «„Логистика“ не подключена организацией» (в сиде модуль не подключён), меню: Сегодня, Автомобили, Подотчёт, Чаты, База знаний, Документы; ошибок консоли нет;
   - owner, страницы встроенных модулей (Чаты, Задачи, Обращения, Формы и опросы, База знаний, Документы, Касса): у каждой ровно две ошибки консоли — `404` на `<модуль>.dc.html` и `[dc-runtime] sibling fetch for "<модуль>" failed … the reference renders as an empty placeholder`; других ошибок нет;
   - `Документация.dc.html` — документы 20–27 в навигации; одна ошибка `404 /{{ frameSrc }}` (атрибут `src` фрейма до подстановки шаблона, недостающим файлом не является).

## Как открыть

Из корня репозитория (сервер `tools/design-preview.js`, W0.05; подробно — `tools/README.md`, раздел «Локальный эталон»):

```powershell
node tools/design-preview.js design 4173                                 # как облачная версия (React UMD и шрифты с CDN)
node tools/design-preview.js design 4173 --offline                       # офлайн: React UMD из tools/vendor, шрифты токенов
node tools/design-preview.js design 4174 --offline --ref design-stage-1  # этот снимок из git-тега, а не из рабочей копии
# http://127.0.0.1:4173/Ортус%20CRM.dc.html
# http://127.0.0.1:4173/Документация.dc.html
```

Без флагов файлы отдаются байт в байт; `--offline` переписывает ответы `.dc.html` только в памяти. Встроенные модули из раздела «Не хватает», A, в обоих режимах дают пустой слот и две ошибки консоли (404 и `sibling fetch`).

## Файлы

| Путь | Итерация | Байт | SHA-256 |
|---|---|---|---|
| `.thumbnail` | 03.10 | 37502 | d3baf1e482448fbe5529eb290bd130843ee8c51e4fae8cbf16c07040ccfc0de4 |
| `Ortus CRM.dc.html` | 03.10 | 206 | d3a65cc8ce0e759849eaa1ca985d0fbc49bafb3212f9029731ca08d1bda42293 |
| `README.md` | 03.10 | 29659 | 17de6de55a42c9af88b25901a87accda78337854360aed42674712f1fa07c902 |
| `docs/10-data-model.md` | 14.10 | 10810 | bd73d5500fede7d3b1efff2d83da4a5b803481ddb0dfd889bb382767ae705f51 |
| `docs/11-permissions.yaml` | 14.10 | 27026 | 20117e5cb4bcb5d336b48c69f6956b40834eb31e46dcb70bf44f6954dd2da76c |
| `docs/12-errors-and-events.md` | 14.10 | 19500 | 997aeb30fda8036ba6e13e6186b1f805857a8e630a188149e21c70b165fa4725 |
| `docs/13-backlog-s0-s2.md` | 14.10 | 12953 | 19baff6efd76e27ca334ff4eb4bd4f5b928dab86a524d8d4be2a5f3f7d6b4ea6 |
| `docs/14-engineering.md` | 14.10 | 9538 | d2e5ab67df09401770d13a6a4bf3b24be7574cf537ff09b0f68a833c520b12ef |
| `docs/15-quality-security.md` | 14.10 | 9528 | 9d229356cce6161a754d52b08b8404615b06f563fa64efae611955827ca001ce |
| `docs/16-raid-glossary.md` | 14.10 | 22386 | a7fe69f8d04fba0692d1621ba311d188ad0d888a7f7a1a11716b398ea03547f0 |
| `docs/17-users-and-billing.md` | 14.10 | 22774 | d34eb64f49892639f9c54a03be2933482f137aaaa423994ca876cdb62a019b05 |
| `docs/18-branding.md` | 14.10 | 14421 | c5ea3c604248a4decf5b68dce4ca6c5445441c7f992df1260b1efceca479222b |
| `docs/19-construction.md` | 14.10 | 53123 | c581958d46b0e79ad5c4d6dfff4b05c590359fbcb53a641e74a22ffd16014737 |
| `docs/20-forms.md` | 14.10 | 21346 | 63ea2a93fd6ae2a27160e77a2f2c7f672a0f39abafaa2c6345aa0b9220a27a29 |
| `docs/21-tasks-projects.md` | 14.10 | 26009 | 74509536437fa7a946760ac6c012abb5b2ceca599d51034c615b2a3b39fd5e82 |
| `docs/22-client-requests.md` | 14.10 | 44056 | b31deb2dc2d82034ae5964b44bbeeacfe57a9bc813adac0f2fa3d6349133e89a |
| `docs/23-knowledge-spaces.md` | 14.10 | 28770 | aaccedb973dec3eadb0520da7726660e8349a8cd16e0ab1027f5e201cf65fc47 |
| `docs/24-documents.md` | 14.10 | 48250 | 27ca68703d280b812e3636340607b582326d1b44e6c244ad02b9bae5a2d9c71e |
| `docs/25-chats.md` | 14.10 | 73429 | 8fbb6ea59a08679416d5972c7a707e5596268bd94357316fc5ea5837ca53d8b9 |
| `docs/26-cash.md` | 14.10 | 27697 | 5cf986414b8168a799f172c1e26f8a9b53023962bcf32436c5736bef0aca24ec |
| `docs/27-implementation-plan.md` | 14.10 | 20890 | 7d9649eb2a7f99aebf3cf70396cb2b430963e37b8779eed858f0c810d8f6a4b1 |
| `docs/README.md` | 14.10 | 11330 | 824122ebe5ffe98e6349ff9e527cd745396c6201f0769eb0f666d964ec218ad6 |
| `docs/db/control_0001_init.sql` | 14.10 | 8661 | 3d49c51bf38f7dacdb126bc284aec3820819210beb8b86df15d4c31f46fa4e93 |
| `docs/db/control_0002_billing.sql` | 14.10 | 6074 | 8f62f9183a15c9f2f6f0050f243f2d871f95e548d51380e76e5d0ab321267b56 |
| `docs/db/control_0003_branding.sql` | 14.10 | 2818 | a3c2d94d82534db5350d537fce7224bbcbf7af273d95a7ecfbedf25ecc4ee569 |
| `docs/db/tenant_0001_core.sql` | 14.10 | 14999 | 4bb87c4ca5f611ce49aada26f458beb6f9cafe71c7bc3d742297e796e356cf73 |
| `docs/db/tenant_0002_fleet.sql` | 14.10 | 10985 | 7e602e78db1d8c1dc40ddc1540f13151e666424684a1acea9d941caad462e752 |
| `docs/design-system/components.md` | 14.10 | 10200 | f7390cb056241df15602229515296bb477b42e4bc09a5138d139405eb01a9958 |
| `docs/design-system/tokens.css` | 14.10 | 2032 | 72848b53c4395db1af1f03c869ad901ffcb5867262eb1717d4bcbd54c9fe4404 |
| `docs/design-system/tokens.json` | 14.10 | 4842 | 63f59607aab80e39237b21f2b07fc3654d4558369af3917f23e5288aff1e9217 |
| `docs/repo-skeleton/.env.example` | 14.10 | 1391 | 12633371066b51b2738d179e1754f7da70688b1ac780bb41b22d3f8700da7794 |
| `docs/repo-skeleton/docker-compose.yml` | 14.10 | 1413 | 0c1e70d1c0ed7c45ac54fc478388c1e3fa160d2ccf70ed26127480bff2acfc24 |
| `docs/v0.1/01-technical-spec.md` | 14.10 | 59742 | 6505690d60f10a621029af874a1d56190dd66fa060a9542c78f52f25bf57212e |
| `docs/v0.1/02-architecture.md` | 14.10 | 85435 | 5801659a1dc3e976471f203fe095662913e1811cc5e8a4443781d43d3eb4441a |
| `docs/v0.1/03-api-guide.md` | 14.10 | 27985 | 4a9435cabba579388c4f07e2e1858943b731175b9a686af58a7daa0c25a6c906 |
| `docs/v0.1/04-product-research.md` | 14.10 | 29570 | 3bc1b10f4f6e2381eaa6671a84c8d4bb6c54e537169ca0ce5d61972e7e989850 |
| `docs/v0.1/05-technology-review.md` | 14.10 | 19615 | 1d5569c79d938c13383f15459f078ac2ead36f648c8fa73669fc249dfeae3107 |
| `docs/v0.1/06-team-prompt.md` | 14.10 | 22912 | 196a093ae0daf09e30ece9970494995cf7ffa6b3ffb040b3879808a71692f079 |
| `docs/v0.1/07-ux-and-data.md` | 14.10 | 48030 | 662d86f7db2eba40213b1583dffd80bfb76136644cba25a80dbd3ceb64a76921 |
| `docs/v0.1/08-domain-scenarios.md` | 14.10 | 74820 | cd2099ba594e337d4714c7e18737f67b7b0fd7eaa45c311b3c5a1589c5ad2f05 |
| `docs/v0.1/09-team-session.md` | 14.10 | 10271 | 30906e5a34f59a0825347f4cd431250581567eb73b9ec8c72922504b1dc9d9c5 |
| `docs/v0.1/README.md` | 14.10 | 7141 | 3fe67076c845417bd076e11aa76a1f2f94f4647828237ba71a1b6ecdb4993612 |
| `docs/v0.1/ortus-openapi-v0.1.yaml` | 14.10 | 364884 | 6fcf271f1800250a8a669d63cca4b798da5ebdc9ed2f6594754b1b0c46ac8e16 |
| `ortus/api.js` | 14.10 | 100535 | 726d0f749049c8620aa31a683a1f82e98f15fde71a258507e3a03a8ce0467f79 |
| `ortus/cash.js` | 14.10 | 62126 | 5cc29dde151ab8920ed2ab13138739bc12092cd73f9bc605e0f25654d76d76b5 |
| `ortus/chats.js` | 14.10 | 58549 | 997cb192d810bb4cd056621adb5531d6788afa32a3b30cf842c23b1b52efc913 |
| `ortus/documents.js` | 14.10 | 113467 | b5a2d92ef3c94175eb342c7af3516cb9ec1467c8d5f4c4bef732444347eb1583 |
| `ortus/extra-data.js` | 14.10 | 19203 | 71a9b191962fde71419eef950ee5b8ba3c881ffb494de7e29033be9fe4706548 |
| `ortus/knowledge.js` | 14.10 | 52193 | 11bb1d8e1295c9dd93b50cb75d566af9f08c73062e0a858dec43eb8a28ec9d29 |
| `ortus/mock-data.js` | 14.10 | 34614 | fb9f11468d8e2af3bc8548adbeac33f11fca41c69768b6ee011ed7a79376e418 |
| `ortus/models.js` | 14.10 | 43207 | 88027cd966c19bbdfd5280f1f394b2b233dd07c1a1bd1b072462bd81bcddc531 |
| `ortus/roadmap.js` | 14.10 | 11545 | 77929a16074e1ec0a69c322c6f813df75f7408ff80bd21b1962a938011e6892b |
| `ortus/service.js` | 14.10 | 38325 | 9ec8105222c1d6f8eb6e081447b0e90243a003acd3b38544d95e89b224beb9e0 |
| `screenshots/01-cash-check.png` | 14.10 | 44248 | 60bd313e5d5825838c143e3c6ba2a6a15e785d71c72d5b5a8168b1c938060f7f |
| `screenshots/01-crm-cash.png` | 14.10 | 42324 | a528801ca2eae159e91f225cabcdef32e9e65c8ae44dbc2441d78866dad1e336 |
| `screenshots/01-crm-cash2.png` | 14.10 | 44775 | 43c57a13c13c8cfd3929299732066e1f4027e860f4b40760c8926ca61b3c97f7 |
| `screenshots/01-crm-cash5.png` | 14.10 | 33475 | c15c8f41343d27134923fb0eb38f3e786bfe208937eed74a6ef6244a6fab607a |
| `screenshots/01-dbg.png` | 03.10 | 33957 | 97a424f933343ddcd53bc56e225427f8915d696c0826602d54385e495aa40f3e |
| `screenshots/01-svc-check.jpg` | 14.10 | 42798 | c2ff9f2c1cf4c005a48d9f3a434480cfcea3f25cc0c963f2a03f86a3ba503744 |
| `screenshots/01-svc-check2.jpg` | 14.10 | 42798 | f1351acceb62643a9aadec0506f196e4bebd675d72500b2b19524ce85bf63d3c |
| `screenshots/01-svc-check3.jpg` | 14.10 | 33188 | 5b24eaffedb286feb4e68ad51f920105a2ee2e539777f471ef20ce681f1cf306 |
| `screenshots/01-tj-create.jpg` | 14.10 | 32628 | 538b4be4a164a762f7b118f50a02c546d9a469b2c8a3071c84e8d2cffaa1864e |
| `screenshots/02-cash-check.png` | 14.10 | 41673 | 9a625538095e4bb8eece7a3c72d8a0a10fe8d18990c73f78670703536665ad24 |
| `screenshots/02-crm-cash.png` | 14.10 | 42324 | f24f834d33a069db17e87ba00bb816ec48aba97d9e7c18378c0e26d1b24c5368 |
| `screenshots/02-crm-cash2.png` | 14.10 | 44775 | b5842417b42679e730658beec4a095630f254a02cc72fd2d1bd36f9c88904423 |
| `screenshots/02-crm-cash5.png` | 14.10 | 33797 | 52c932c3fd5136d171a0d550978f8f912ce2b8668b4f8aad3575c55de38d95fd |
| `screenshots/02-dbg.png` | 03.10 | 44481 | dbacf825b78b61a7e07cbb5afea59d0795af0b441a1baa40cfce320507b0d58e |
| `screenshots/02-svc-check.jpg` | 14.10 | 42798 | 422f806e915564eeb0fb7f2c2cdb288a5015c905843b9226b9014be1c0c34927 |
| `screenshots/02-svc-check2.jpg` | 14.10 | 33188 | 735d2a6a20cd0186f4d2d37d2ad060fb9805450b8bcacb212b3be6e7708a4023 |
| `screenshots/02-svc-check3.jpg` | 14.10 | 41285 | 8f17be3867d27fc3a1bae8e6e28ef152567d4950e131bc92944892f50cde3fc9 |
| `screenshots/02-tj-create.jpg` | 14.10 | 35773 | eaa3a4de40fb2921c5c70576c4d440acad3b96f680bc2c5a9e4ffa08a1d0d48a |
| `screenshots/03-cash-check.png` | 14.10 | 36425 | 13ce7ad44815cf97cccceedbb880141adc7cb0670d3a18d9559b64759175634d |
| `screenshots/03-crm-cash.png` | 14.10 | 41520 | 2b62085982dde973f70ea232426c73e80ac1a082b3f950209dd6dc2e200d5c7d |
| `screenshots/03-crm-cash5.png` | 14.10 | 33991 | 10c051d5f9e81801b004a9d0f89c8efe06a9f4cdee425b49db1ef31d7133b5d7 |
| `screenshots/03-dbg.png` | 03.10 | 44481 | 48eba45755c9ab1b28a054d4e523f34050b4e4c93a1ff1cc7467a8dc3ed1beaa |
| `screenshots/03-svc-check.jpg` | 14.10 | 42798 | 16b235ee57695ccaa53a459efe4e932f7fdc7cb995fa90951275e74c5c80c559 |
| `screenshots/03-svc-check3.jpg` | 14.10 | 41285 | e44b9f87e0f91733e7a34d0e06616aa67558cc5a7bdd614f9e53758a68e7b641 |
| `screenshots/04-cash-check.png` | 14.10 | 44869 | c4f4e81cf317a563ab8515ad41ff302e18f960bfd9b5f57db370404199e40ab8 |
| `screenshots/04-crm-cash.png` | 14.10 | 41520 | 4c858340499df298d30dc1574c65e15cf9619948e95b9c00b015bab8916b8b4e |
| `screenshots/04-crm-cash5.png` | 14.10 | 34133 | b341370e6bfee9ef9fccdbb09eb99f40bd8a3bd47946e3b2e7103be693ebe397 |
| `screenshots/05-crm-cash5.png` | 14.10 | 34293 | f0249f42069a333e6b153047b79bd97d3447a82f91eb839521b9275c10279a50 |
| `screenshots/06-crm-cash5.png` | 14.10 | 34471 | 0007991115a72da83fb90e5619adcf7c4658b084544f6e04610858fe120a68b2 |
| `screenshots/07-crm-cash5.png` | 14.10 | 34471 | 818306390684f4771ca6d607da9b9e2c443b06bf67fee9a99ab1650f1962c8d8 |
| `screenshots/08-crm-cash5.png` | 14.10 | 42716 | d7507b810cbb3a41b840e0f388946070091b09e0c191a3173925fa5e7f8d5785 |
| `screenshots/crm-cash3.png` | 14.10 | 44775 | 76b4354a944f26c63eade3c41b91a14b44c27be9f5605f07253fc30055627875 |
| `screenshots/crm-cash4.png` | 14.10 | 33022 | be2a21e11ced40f544bf227850d8bf4cba5dcf09ea21dfc3d45f8445e7768fe8 |
| `screenshots/dbg.png` | 03.10 | 40551 | b3029e2b8070934b06e112e02da071b9577606be5a095b075c62a94ee16bd5ec |
| `support.js` | 03.10 | 69150 | 8fe7df74405f3c55f49b7249c74ea1397e65d07dea2b1bd3b4a489bec2e28cbe |
| `uploads/claude-design-prompt-360af029.md` | 14.10 | 17819 | 360af029b15dfef97123afa6a6c445614bb459777ae27c1fe972938baaa1b4b3 |
| `uploads/claude-design-prompt.md` | 14.10 | 17819 | 360af029b15dfef97123afa6a6c445614bb459777ae27c1fe972938baaa1b4b3 |
| `uploads/ortus-crm-design-v0.1(1)/01-technical-spec-6505690d.md` | 14.10 | 59742 | 6505690d60f10a621029af874a1d56190dd66fa060a9542c78f52f25bf57212e |
| `uploads/ortus-crm-design-v0.1(1)/01-technical-spec.md` | 14.10 | 59742 | 6505690d60f10a621029af874a1d56190dd66fa060a9542c78f52f25bf57212e |
| `uploads/ortus-crm-design-v0.1(1)/02-architecture-5801659a.md` | 14.10 | 85435 | 5801659a1dc3e976471f203fe095662913e1811cc5e8a4443781d43d3eb4441a |
| `uploads/ortus-crm-design-v0.1(1)/02-architecture.md` | 14.10 | 85435 | 5801659a1dc3e976471f203fe095662913e1811cc5e8a4443781d43d3eb4441a |
| `uploads/ortus-crm-design-v0.1(1)/03-api-guide-4a9435ca.md` | 14.10 | 27985 | 4a9435cabba579388c4f07e2e1858943b731175b9a686af58a7daa0c25a6c906 |
| `uploads/ortus-crm-design-v0.1(1)/03-api-guide.md` | 14.10 | 27985 | 4a9435cabba579388c4f07e2e1858943b731175b9a686af58a7daa0c25a6c906 |
| `uploads/ortus-crm-design-v0.1(1)/04-product-research-3bc1b10f.md` | 14.10 | 29570 | 3bc1b10f4f6e2381eaa6671a84c8d4bb6c54e537169ca0ce5d61972e7e989850 |
| `uploads/ortus-crm-design-v0.1(1)/04-product-research.md` | 14.10 | 29570 | 3bc1b10f4f6e2381eaa6671a84c8d4bb6c54e537169ca0ce5d61972e7e989850 |
| `uploads/ortus-crm-design-v0.1(1)/05-technology-review-1d5569c7.md` | 14.10 | 19615 | 1d5569c79d938c13383f15459f078ac2ead36f648c8fa73669fc249dfeae3107 |
| `uploads/ortus-crm-design-v0.1(1)/05-technology-review.md` | 14.10 | 19615 | 1d5569c79d938c13383f15459f078ac2ead36f648c8fa73669fc249dfeae3107 |
| `uploads/ortus-crm-design-v0.1(1)/06-team-prompt-196a093a.md` | 14.10 | 22912 | 196a093ae0daf09e30ece9970494995cf7ffa6b3ffb040b3879808a71692f079 |
| `uploads/ortus-crm-design-v0.1(1)/06-team-prompt.md` | 14.10 | 22912 | 196a093ae0daf09e30ece9970494995cf7ffa6b3ffb040b3879808a71692f079 |
| `uploads/ortus-crm-design-v0.1(1)/07-ux-and-data-662d86f7.md` | 14.10 | 48030 | 662d86f7db2eba40213b1583dffd80bfb76136644cba25a80dbd3ceb64a76921 |
| `uploads/ortus-crm-design-v0.1(1)/07-ux-and-data.md` | 14.10 | 48030 | 662d86f7db2eba40213b1583dffd80bfb76136644cba25a80dbd3ceb64a76921 |
| `uploads/ortus-crm-design-v0.1(1)/08-domain-scenarios-cd2099ba.md` | 14.10 | 74820 | cd2099ba594e337d4714c7e18737f67b7b0fd7eaa45c311b3c5a1589c5ad2f05 |
| `uploads/ortus-crm-design-v0.1(1)/08-domain-scenarios.md` | 14.10 | 74820 | cd2099ba594e337d4714c7e18737f67b7b0fd7eaa45c311b3c5a1589c5ad2f05 |
| `uploads/ortus-crm-design-v0.1(1)/09-team-session-30906e5a.md` | 14.10 | 10271 | 30906e5a34f59a0825347f4cd431250581567eb73b9ec8c72922504b1dc9d9c5 |
| `uploads/ortus-crm-design-v0.1(1)/09-team-session.md` | 14.10 | 10271 | 30906e5a34f59a0825347f4cd431250581567eb73b9ec8c72922504b1dc9d9c5 |
| `uploads/ortus-crm-design-v0.1(1)/README-3fe67076.md` | 14.10 | 7141 | 3fe67076c845417bd076e11aa76a1f2f94f4647828237ba71a1b6ecdb4993612 |
| `uploads/ortus-crm-design-v0.1(1)/README.md` | 14.10 | 7141 | 3fe67076c845417bd076e11aa76a1f2f94f4647828237ba71a1b6ecdb4993612 |
| `uploads/ortus-crm-design-v0.1(1)/ortus-openapi-v0.1-6fcf271f.yaml` | 14.10 | 364884 | 6fcf271f1800250a8a669d63cca4b798da5ebdc9ed2f6594754b1b0c46ac8e16 |
| `uploads/ortus-crm-design-v0.1(1)/ortus-openapi-v0.1.yaml` | 14.10 | 364884 | 6fcf271f1800250a8a669d63cca4b798da5ebdc9ed2f6594754b1b0c46ac8e16 |
| `uploads/ortus-crm-interface(1)-4b88cfd3.html` | 14.10 | 71718 | 4b88cfd3251db0226bb79a047c277eebe2546ef6cfe01a421f76b00ac2ce52ee |
| `uploads/ortus-crm-interface(1).html` | 14.10 | 71718 | 4b88cfd3251db0226bb79a047c277eebe2546ef6cfe01a421f76b00ac2ce52ee |
| `uploads/pasted-1790968436269-0.png` | 14.10 | 11886 | 029159472bb8adc09cc591bbb5b99a0e559bc1fb387cfbe27ff26d45a983f226 |
| `uploads/pasted-1790971015233-0.png` | 14.10 | 134843 | a630d00f508d4a31a9947ae63f602cfcc8232164362f129316f4ca3c51a0e66a |
| `uploads/pasted-1791314723413-0.png` | 14.10 | 97821 | e23c7c8d334bb069c076169622b37ccedfc34ffbb06456f951e55df375db7a57 |
| `uploads/pasted-1791314736184-0.png` | 14.10 | 108950 | a97e49a059c77fcf8350e97f859b55ff276483a8c849527cb01ba2bd0c683423 |
| `uploads/pasted-1791314759057-0.png` | 14.10 | 102577 | 72ee421a590af0bbb58683f6b24713f168cbd22aa7ca94fdf51b41c785749365 |
| `uploads/pasted-1791314774299-0.png` | 14.10 | 59645 | 604c37848adb1cd347c51ee2c9914a95bba43396d86b0168d94338168dd65a9d |
| `uploads/pasted-1791314796700-0.png` | 14.10 | 108011 | 4111f48b54ad407b28ed9a3db6e88d799ad596fcd94b77e387fba68c9250cb1b |
| `uploads/pasted-1791314817435-0.png` | 14.10 | 116373 | 35c597b861a0d69804345be85c60e7e8cdf18cad2bbfab2245d1b6cf9524e131 |
| `uploads/pasted-1791314851524-0.png` | 14.10 | 112234 | 3b2a07b8949607d4ce54893bf5487907b781b5fa12ccfd068ca62f02f5b14452 |
| `uploads/pasted-1791314868603-0.png` | 14.10 | 83552 | 4f4ac76ec600516660ca82b6264a93f59602617e48ead63d2ffd53980c685830 |
| `uploads/pasted-1791314912923-0.png` | 14.10 | 145135 | 04f9a52ef85896aadebb519b65f2cf6dc26dfc430b3fab80cdf67a677d33ab7b |
| `uploads/pasted-1791477020324-0.png` | 14.10 | 10845 | 711490bd6e12c38b09dbefde48a99e132b50fefebd2275767aa81176323646e1 |
| `Дизайн-система.dc.html` | 03.10 | 103267 | 8c4533cb50b8175fa2bcece68399b939c349166ac8a06399178a8dadbb4d3068 |
| `Документация.dc.html` | 14.10 | 45274 | a09197a90965fb295c381fed289731404c6ec94ff8cf04cca0da88e4e934cc4a |
| `Объекты - варианты.dc.html` | 03.10 | 108376 | ab435f3589c6eb9cc680f5201fb9ce245beae07412f4114d4aa89cd8886bfa78 |
| `Ортус CRM.dc.html` | 14.10 | 610877 | dae8b9e70cce9fffab3e59f29288b85a26bfa7a163bf163d35cc330463099029 |
| `Ремонт и стройка.dc.html` | 03.10 | 120163 | bdc19ad5b01c013414eb0f4e3e05cd34bfcef66b9f97878bd342efa820e7bc1c |
