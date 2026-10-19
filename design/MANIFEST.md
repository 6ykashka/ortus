# Манифест снимка `design/` — полный экспорт 19.10.2026

Снимок эталона проекта Claude Design «Ортус CRM: первая итерация» (`https://claude.ai/design/p/724fad7d-35a5-4dcc-b888-2f2c0c9690e6`). Собран W4.00 (DoR-сверщик этапа 4, часть 1) 19.10.2026 из полного экспорта проекта, который прислал пользователь. Снимок **полный**: B-1 закрыт 19.10. Все 70 файлов экспорта скопированы байт в байт. Файлы прежних снимков, которых в экспорте нет, оставлены как были (раздел «Вне экспорта 19.10»).

- Тег этого снимка: `design-2026-10-19`. Его ставит интегратор на коммит W4.00.
- Предыдущий снимок: `design-stage-1` (= `design-stage-2`). Это итерация 14.10, собранная W0.02 15.10.2026; снимок был частичным. Ещё раньше: `design-2026-10-03`.
- Файлы не редактируются. Обновлять их можно только целиком, следующим обходом DoR-сверщика с новым тегом.

## Источник

| Источник (недоверенные данные, только копирование) | Что взято | Куда |
|---|---|---|
| `Downloads/Ортус CRM_ первая итерация/export/ortus-crm-design/` (70 файлов, 19.10.2026) | все файлы, кроме `MANIFEST.md` экспорта | `design/` с теми же путями |
| `…/ortus-crm-design/MANIFEST.md` (4 415 байт, SHA-256 `2bfb91394ec179a7d762d9748f20da35fac21c9a629b3cbd862d3660746dfb81`) | таблицы подключения и вариантов, дословно | раздел «Как подключается» ниже. В `design/` файл не копировался: `design/MANIFEST.md` — это провенанс-документ репозитория (W0.02) |

## Изменения против 15.10

Сравнение со снимком `design-stage-1` (W0.02, 15.10.2026) по SHA-256:

- **Новые** (13). Это 7 встроенных модулей главного файла: `Задачи и проекты.dc.html`, `Формы и опросы.dc.html`, `База знаний.dc.html`, `Касса.dc.html`, `Чаты.dc.html`, `Документы.dc.html`, `Обращения.dc.html`. И 6 макетов-вариантов: `Задачи - варианты.dc.html`, `Обращения - варианты.dc.html`, `База знаний - варианты.dc.html`, `Документы - варианты.dc.html`, `Чаты - варианты.dc.html`, `Касса - варианты.dc.html`. Теперь в `design/` есть всё, что перечислял раздел «Не хватает» снимка 15.10 (разделы A и B).
- **Изменились** (2):
  - `Ремонт и стройка.dc.html`: 120 163 → 264 530 байт. Это текущая версия дочернего макета: пропсы `obj`, `changes`, `canEdit`, `onChange`; вкладки `catalog` («Шаблоны и расценки») и `stock` («Снабжение»); поля `objEst`, `reqBy`, `hub` в `onStatus`.
  - `README.md`: 29 659 → 70 264 байт. В нём описаны итерации 1–17 и сценарии проверки.
- **Без изменений, подтверждены экспортом** (55): `Ортус CRM.dc.html`, `Документация.dc.html`, `Дизайн-система.dc.html`, `Объекты - варианты.dc.html`, `support.js`, `ortus/*.js` (10 файлов), `docs/**` (40 файлов). Так снят раздел C «Не подтверждено» снимка 15.10: `support.js`, «Дизайн-система» и «Объекты - варианты» совпадают с проектом.
- **Вне экспорта** (74): `uploads/**` (38), `screenshots/**` (34), `Ortus CRM.dc.html`, `.thumbnail`. Они оставлены (раздел ниже).

Главный файл не менялся. Поэтому якоря анализов 01–04 (`:N`) действуют, а страницы этапов 1–2 в эталоне выглядят так же. Это подтверждено попиксельно в разделе «Как проверено», п. 5.

## Вне экспорта 19.10

74 файла (в таблице «Файлы» у них «нет» в столбце «В экспорте 19.10»). Их статус: «из прежнего снимка, в экспорт 19.10 не входит; удалить — по слову пользователя». 68 из них взяты из итерации 14.10, 6 — из снимка 03.10; итерация указана в одноимённом столбце.

| Путь | Итерация | Что это (по манифесту экспорта) |
|---|---|---|
| `uploads/**` (38) | 14.10 | исходные материалы заказчика |
| `screenshots/**` (34) | 14.10 (30), 03.10 (4 `*dbg.png`) | рабочие снимки |
| `Ortus CRM.dc.html` | 03.10 | пустой файл |
| `.thumbnail` | 03.10 | превью проекта, в манифесте экспорта не упомянут |

## Как подключается

Источник — `MANIFEST.md` полного экспорта (`Downloads/Ортус CRM_ первая итерация/export/ortus-crm-design/MANIFEST.md`, SHA-256 `2bfb9139…`), разделы «Главный файл и его зависимости» и «Макеты-варианты». Таблицы перенесены дословно. Номера этапов и WS указаны по плану v2 (`docs/plan/v2/00-parallel-plan.md`).

`Ортус CRM.dc.html` — оболочка, страницы ядра (Главная, Модули и место, Пользователи и роли, Логистика, Салон и SPA, Данные, Файлы, Календарь, Подписка и места, Оформление, оператор платформы). Сам подгружает:

| Файл | Подключается как | Этап плана |
|---|---|---|
| `Задачи и проекты.dc.html` | `dc-import name="Задачи и проекты"` | 4 (W4.12, W4.13) |
| `Формы и опросы.dc.html` | `dc-import name="Формы и опросы"` | 4 (W4.22, W4.23) |
| `База знаний.dc.html` | `dc-import name="База знаний"` | 4 (W4.32) |
| `Касса.dc.html` | `dc-import name="Касса"` | 5 (W5.32, W5.33) |
| `Ремонт и стройка.dc.html` | `dc-import name="Ремонт и стройка"` (внутри карточки объекта) | 6 |
| `Чаты.dc.html` | `dc-import name="Чаты"` | 7 (W7.13) |
| `Документы.dc.html` | `dc-import name="Документы"` | 7 (W7.25, W7.26) |
| `Обращения.dc.html` | `dc-import name="Обращения"` | 7 (W7.32, W7.33) |
| `support.js` | `<script src="./support.js">` — среда выполнения DC, нужна каждому `.dc.html` | — |
| `ortus/api.js`, `models.js`, `roadmap.js`, `service.js` | динамический `import()` при старте | — |
| `ortus/mock-data.js`, `extra-data.js`, `knowledge.js`, `documents.js`, `chats.js`, `cash.js` | импортируются из `api.js` и модулей | — |

`Ремонт и стройка.dc.html` — текущая версия: вкладки объекта (Обзор, Работы, Замер, Смета, График, Документы, Снабжение, Финансы, Оплата бригады, Подрядчики, Кабинет заказчика), разделы «Шаблоны и расценки» (`t.catalog`) и «Снабжение и склады» (`t.stock`: заявки, закупки, остатки, движения), правки объекта и поля снабжения.

Макеты-варианты (выбор, на который ссылаются документы 21–26):

| Файл | Документ |
|---|---|
| `Задачи - варианты.dc.html` | `docs/21-tasks-projects.md` |
| `Обращения - варианты.dc.html` | `docs/22-client-requests.md` |
| `База знаний - варианты.dc.html` | `docs/23-knowledge-spaces.md` |
| `Документы - варианты.dc.html` | `docs/24-documents.md` |
| `Чаты - варианты.dc.html` | `docs/25-chats.md` |
| `Касса - варианты.dc.html` | `docs/26-cash.md` |
| `Объекты - варианты.dc.html` | `docs/19-construction.md` (выбран 1a «Сводка») |

Варианты открываются сами по себе и ничего не импортируют.

## Известные дефекты эталона

Дефекты эталона исправляются в реализации (PD-60). В mock-визуале на них ставится allowlist со ссылкой на PD-60.

| Где | Что видно | Этап |
|---|---|---|
| `Чаты.dc.html:449` `componentDidUpdate(pp, ps)` | Рантайм (`support.js:1013`) передаёт в `componentDidUpdate` только `prevProps`. Поэтому при открытии «Чатов» в консоли одна ошибка `TypeError: Cannot read properties of undefined (reading 'sel')`. Рантайм её перехватывает, модуль рендерится. Остальные модули объявляют `componentDidUpdate()` или `componentDidUpdate(pp)` | 7 (W7.13) |
| `Документация.dc.html` | `404 /{{ frameSrc }}`: атрибут `src` фрейма запрашивается до подстановки шаблона. Это не отсутствующий файл, дефект известен с 15.10 | — |

## Как проверено

1. **Сверка SHA-256 до копирования.** Сверены все 70 файлов экспорта (без `MANIFEST.md`) с `design/` на `main` (`db35eeda`): 55 совпали, 13 новых, 2 изменились (`README.md`, `Ремонт и стройка.dc.html`). Это совпадает со сверкой оркестратора. Скрипты из экспорта не запускались.
2. **Копирование.** Файлы скопированы байт в байт (`.gitattributes`: `design/** -text`). После копирования все 70 файлов совпадают с экспортом по SHA-256. Ни одного файла `design/` не удалено.
3. **Служебные блоки.** Ни в одном `*.html` нет `data-omelette-injected`.
4. **Манифест.** Таблица «Файлы» сгенерирована по содержимому `design/`. Тест `docs/plan/scripts/design-snapshot.test.mjs` проверяет:
   - каждую строку таблицы (размер, SHA-256, отметку экспорта);
   - что все 8 `dc-import`, фреймы `Документации` и 7 вариантов есть в `design/`;
   - что раздела «Не хватает» больше нет;
   - что файлы вне экспорта отмечены;
   - таблицу подключения и раздел «Изменения против 15.10».
5. **Эталон в браузере** (19.10.2026). Chromium через Playwright 1.63.0, 1440×900, `node tools/design-preview.js design 4109 --offline`. Для сравнения тот же сценарий прогнан на `--ref design-stage-1`.
   - **owner, 7 встроенных модулей** (Чаты, Задачи, Обращения, Формы и опросы, База знаний, Документы, Касса): каждый рендерится. На `design-stage-1` слот был пустым. Ошибок `404` и `[dc-runtime] sibling fetch … failed` нет, за всю проходку нет ни одного ответа HTTP ≥ 400. Единственная ошибка консоли — `TypeError … 'sel'` в «Чатах» (см. «Известные дефекты эталона»).
   - **«Ремонт и стройка».** Владелец подключает модуль в «Модулях и месте». В меню появляются «Объекты 3», «Снабжение» и «Шаблоны и расценки». У карточки объекта 11 вкладок: Обзор, Работы, Замер, Смета, График, Документы, Снабжение, Финансы, Оплата бригады, Подрядчики, Кабинет заказчика. Все вкладки открываются без ошибок консоли. «Шаблоны и расценки» и «Снабжение» теперь с содержимым: 3 870 и 1 625 символов текста против 325 и 336 на `design-stage-1`.
   - **Страницы этапов 1–2.** Проверено 18 состояний, каждое с чистой загрузки:
     - owner: Главная, Модули и место, Пользователи и роли, Подписка и места, Оформление, Данные, Файлы, Календарь, а после подключения «Логистики» — Рабочее место логиста, Ресурсный пул, Приёмка смен;
     - логист: Главная, Рабочее место логиста;
     - водитель: Сегодня, Автомобили, Подотчёт (с «Логистикой» и без неё);
     - оператор платформы: Организации.

     Ошибок консоли нет ни в одном состоянии. Скриншоты и текст `#ox-main` попиксельно и посимвольно совпадают с `design-stage-1`. Исключение — «Подотчёт» водителя: вместо пустого слота и двух ошибок `404`/`sibling fetch` там теперь рендерится модуль «Касса» (этап 5).

## Как открыть

Из корня репозитория запустите сервер `tools/design-preview.js` (W0.05). Подробно — `tools/README.md`, раздел «Локальный эталон».

```powershell
node tools/design-preview.js design 4173                                     # как облачная версия (React UMD и шрифты с CDN)
node tools/design-preview.js design 4173 --offline                           # офлайн: React UMD из tools/vendor, шрифты токенов
node tools/design-preview.js design 4174 --offline --ref design-2026-10-19   # этот снимок из git-тега (после тега интегратора)
node tools/design-preview.js design 4174 --offline --ref design-stage-1      # снимок этапов 1–2 (итерация 14.10, = design-stage-2)
# http://127.0.0.1:4173/Ортус%20CRM.dc.html
# http://127.0.0.1:4173/Документация.dc.html
# http://127.0.0.1:4173/Ремонт%20и%20стройка.dc.html, …/Чаты%20-%20варианты.dc.html и т. д. — открываются сами по себе
```

Без флагов файлы отдаются байт в байт, а `--offline` переписывает ответы `.dc.html` только в памяти. Встроенные модули грузятся из соседних файлов `design/` в обоих режимах.

## Файлы

Столбец «Итерация»: `19.10` — файл есть в экспорте 19.10, и содержимое подтверждено экспортом; `14.10` / `03.10` — файл из прежнего снимка, в экспорт 19.10 не входит.

| Путь | Итерация | Байт | SHA-256 | В экспорте 19.10 |
|---|---|---|---|---|
| `.thumbnail` | 03.10 | 37502 | d3baf1e482448fbe5529eb290bd130843ee8c51e4fae8cbf16c07040ccfc0de4 | нет |
| `Ortus CRM.dc.html` | 03.10 | 206 | d3a65cc8ce0e759849eaa1ca985d0fbc49bafb3212f9029731ca08d1bda42293 | нет |
| `README.md` | 19.10 | 70264 | 45e5953ff3888c87855ec488dbc5cc6c29cec8853c95f841c2c5c3ceb02c7d98 | да |
| `docs/10-data-model.md` | 19.10 | 10810 | bd73d5500fede7d3b1efff2d83da4a5b803481ddb0dfd889bb382767ae705f51 | да |
| `docs/11-permissions.yaml` | 19.10 | 27026 | 20117e5cb4bcb5d336b48c69f6956b40834eb31e46dcb70bf44f6954dd2da76c | да |
| `docs/12-errors-and-events.md` | 19.10 | 19500 | 997aeb30fda8036ba6e13e6186b1f805857a8e630a188149e21c70b165fa4725 | да |
| `docs/13-backlog-s0-s2.md` | 19.10 | 12953 | 19baff6efd76e27ca334ff4eb4bd4f5b928dab86a524d8d4be2a5f3f7d6b4ea6 | да |
| `docs/14-engineering.md` | 19.10 | 9538 | d2e5ab67df09401770d13a6a4bf3b24be7574cf537ff09b0f68a833c520b12ef | да |
| `docs/15-quality-security.md` | 19.10 | 9528 | 9d229356cce6161a754d52b08b8404615b06f563fa64efae611955827ca001ce | да |
| `docs/16-raid-glossary.md` | 19.10 | 22386 | a7fe69f8d04fba0692d1621ba311d188ad0d888a7f7a1a11716b398ea03547f0 | да |
| `docs/17-users-and-billing.md` | 19.10 | 22774 | d34eb64f49892639f9c54a03be2933482f137aaaa423994ca876cdb62a019b05 | да |
| `docs/18-branding.md` | 19.10 | 14421 | c5ea3c604248a4decf5b68dce4ca6c5445441c7f992df1260b1efceca479222b | да |
| `docs/19-construction.md` | 19.10 | 53123 | c581958d46b0e79ad5c4d6dfff4b05c590359fbcb53a641e74a22ffd16014737 | да |
| `docs/20-forms.md` | 19.10 | 21346 | 63ea2a93fd6ae2a27160e77a2f2c7f672a0f39abafaa2c6345aa0b9220a27a29 | да |
| `docs/21-tasks-projects.md` | 19.10 | 26009 | 74509536437fa7a946760ac6c012abb5b2ceca599d51034c615b2a3b39fd5e82 | да |
| `docs/22-client-requests.md` | 19.10 | 44056 | b31deb2dc2d82034ae5964b44bbeeacfe57a9bc813adac0f2fa3d6349133e89a | да |
| `docs/23-knowledge-spaces.md` | 19.10 | 28770 | aaccedb973dec3eadb0520da7726660e8349a8cd16e0ab1027f5e201cf65fc47 | да |
| `docs/24-documents.md` | 19.10 | 48250 | 27ca68703d280b812e3636340607b582326d1b44e6c244ad02b9bae5a2d9c71e | да |
| `docs/25-chats.md` | 19.10 | 73429 | 8fbb6ea59a08679416d5972c7a707e5596268bd94357316fc5ea5837ca53d8b9 | да |
| `docs/26-cash.md` | 19.10 | 27697 | 5cf986414b8168a799f172c1e26f8a9b53023962bcf32436c5736bef0aca24ec | да |
| `docs/27-implementation-plan.md` | 19.10 | 20890 | 7d9649eb2a7f99aebf3cf70396cb2b430963e37b8779eed858f0c810d8f6a4b1 | да |
| `docs/README.md` | 19.10 | 11330 | 824122ebe5ffe98e6349ff9e527cd745396c6201f0769eb0f666d964ec218ad6 | да |
| `docs/db/control_0001_init.sql` | 19.10 | 8661 | 3d49c51bf38f7dacdb126bc284aec3820819210beb8b86df15d4c31f46fa4e93 | да |
| `docs/db/control_0002_billing.sql` | 19.10 | 6074 | 8f62f9183a15c9f2f6f0050f243f2d871f95e548d51380e76e5d0ab321267b56 | да |
| `docs/db/control_0003_branding.sql` | 19.10 | 2818 | a3c2d94d82534db5350d537fce7224bbcbf7af273d95a7ecfbedf25ecc4ee569 | да |
| `docs/db/tenant_0001_core.sql` | 19.10 | 14999 | 4bb87c4ca5f611ce49aada26f458beb6f9cafe71c7bc3d742297e796e356cf73 | да |
| `docs/db/tenant_0002_fleet.sql` | 19.10 | 10985 | 7e602e78db1d8c1dc40ddc1540f13151e666424684a1acea9d941caad462e752 | да |
| `docs/design-system/components.md` | 19.10 | 10200 | f7390cb056241df15602229515296bb477b42e4bc09a5138d139405eb01a9958 | да |
| `docs/design-system/tokens.css` | 19.10 | 2032 | 72848b53c4395db1af1f03c869ad901ffcb5867262eb1717d4bcbd54c9fe4404 | да |
| `docs/design-system/tokens.json` | 19.10 | 4842 | 63f59607aab80e39237b21f2b07fc3654d4558369af3917f23e5288aff1e9217 | да |
| `docs/repo-skeleton/.env.example` | 19.10 | 1391 | 12633371066b51b2738d179e1754f7da70688b1ac780bb41b22d3f8700da7794 | да |
| `docs/repo-skeleton/docker-compose.yml` | 19.10 | 1413 | 0c1e70d1c0ed7c45ac54fc478388c1e3fa160d2ccf70ed26127480bff2acfc24 | да |
| `docs/v0.1/01-technical-spec.md` | 19.10 | 59742 | 6505690d60f10a621029af874a1d56190dd66fa060a9542c78f52f25bf57212e | да |
| `docs/v0.1/02-architecture.md` | 19.10 | 85435 | 5801659a1dc3e976471f203fe095662913e1811cc5e8a4443781d43d3eb4441a | да |
| `docs/v0.1/03-api-guide.md` | 19.10 | 27985 | 4a9435cabba579388c4f07e2e1858943b731175b9a686af58a7daa0c25a6c906 | да |
| `docs/v0.1/04-product-research.md` | 19.10 | 29570 | 3bc1b10f4f6e2381eaa6671a84c8d4bb6c54e537169ca0ce5d61972e7e989850 | да |
| `docs/v0.1/05-technology-review.md` | 19.10 | 19615 | 1d5569c79d938c13383f15459f078ac2ead36f648c8fa73669fc249dfeae3107 | да |
| `docs/v0.1/06-team-prompt.md` | 19.10 | 22912 | 196a093ae0daf09e30ece9970494995cf7ffa6b3ffb040b3879808a71692f079 | да |
| `docs/v0.1/07-ux-and-data.md` | 19.10 | 48030 | 662d86f7db2eba40213b1583dffd80bfb76136644cba25a80dbd3ceb64a76921 | да |
| `docs/v0.1/08-domain-scenarios.md` | 19.10 | 74820 | cd2099ba594e337d4714c7e18737f67b7b0fd7eaa45c311b3c5a1589c5ad2f05 | да |
| `docs/v0.1/09-team-session.md` | 19.10 | 10271 | 30906e5a34f59a0825347f4cd431250581567eb73b9ec8c72922504b1dc9d9c5 | да |
| `docs/v0.1/README.md` | 19.10 | 7141 | 3fe67076c845417bd076e11aa76a1f2f94f4647828237ba71a1b6ecdb4993612 | да |
| `docs/v0.1/ortus-openapi-v0.1.yaml` | 19.10 | 364884 | 6fcf271f1800250a8a669d63cca4b798da5ebdc9ed2f6594754b1b0c46ac8e16 | да |
| `ortus/api.js` | 19.10 | 100535 | 726d0f749049c8620aa31a683a1f82e98f15fde71a258507e3a03a8ce0467f79 | да |
| `ortus/cash.js` | 19.10 | 62126 | 5cc29dde151ab8920ed2ab13138739bc12092cd73f9bc605e0f25654d76d76b5 | да |
| `ortus/chats.js` | 19.10 | 58549 | 997cb192d810bb4cd056621adb5531d6788afa32a3b30cf842c23b1b52efc913 | да |
| `ortus/documents.js` | 19.10 | 113467 | b5a2d92ef3c94175eb342c7af3516cb9ec1467c8d5f4c4bef732444347eb1583 | да |
| `ortus/extra-data.js` | 19.10 | 19203 | 71a9b191962fde71419eef950ee5b8ba3c881ffb494de7e29033be9fe4706548 | да |
| `ortus/knowledge.js` | 19.10 | 52193 | 11bb1d8e1295c9dd93b50cb75d566af9f08c73062e0a858dec43eb8a28ec9d29 | да |
| `ortus/mock-data.js` | 19.10 | 34614 | fb9f11468d8e2af3bc8548adbeac33f11fca41c69768b6ee011ed7a79376e418 | да |
| `ortus/models.js` | 19.10 | 43207 | 88027cd966c19bbdfd5280f1f394b2b233dd07c1a1bd1b072462bd81bcddc531 | да |
| `ortus/roadmap.js` | 19.10 | 11545 | 77929a16074e1ec0a69c322c6f813df75f7408ff80bd21b1962a938011e6892b | да |
| `ortus/service.js` | 19.10 | 38325 | 9ec8105222c1d6f8eb6e081447b0e90243a003acd3b38544d95e89b224beb9e0 | да |
| `screenshots/01-cash-check.png` | 14.10 | 44248 | 60bd313e5d5825838c143e3c6ba2a6a15e785d71c72d5b5a8168b1c938060f7f | нет |
| `screenshots/01-crm-cash.png` | 14.10 | 42324 | a528801ca2eae159e91f225cabcdef32e9e65c8ae44dbc2441d78866dad1e336 | нет |
| `screenshots/01-crm-cash2.png` | 14.10 | 44775 | 43c57a13c13c8cfd3929299732066e1f4027e860f4b40760c8926ca61b3c97f7 | нет |
| `screenshots/01-crm-cash5.png` | 14.10 | 33475 | c15c8f41343d27134923fb0eb38f3e786bfe208937eed74a6ef6244a6fab607a | нет |
| `screenshots/01-dbg.png` | 03.10 | 33957 | 97a424f933343ddcd53bc56e225427f8915d696c0826602d54385e495aa40f3e | нет |
| `screenshots/01-svc-check.jpg` | 14.10 | 42798 | c2ff9f2c1cf4c005a48d9f3a434480cfcea3f25cc0c963f2a03f86a3ba503744 | нет |
| `screenshots/01-svc-check2.jpg` | 14.10 | 42798 | f1351acceb62643a9aadec0506f196e4bebd675d72500b2b19524ce85bf63d3c | нет |
| `screenshots/01-svc-check3.jpg` | 14.10 | 33188 | 5b24eaffedb286feb4e68ad51f920105a2ee2e539777f471ef20ce681f1cf306 | нет |
| `screenshots/01-tj-create.jpg` | 14.10 | 32628 | 538b4be4a164a762f7b118f50a02c546d9a469b2c8a3071c84e8d2cffaa1864e | нет |
| `screenshots/02-cash-check.png` | 14.10 | 41673 | 9a625538095e4bb8eece7a3c72d8a0a10fe8d18990c73f78670703536665ad24 | нет |
| `screenshots/02-crm-cash.png` | 14.10 | 42324 | f24f834d33a069db17e87ba00bb816ec48aba97d9e7c18378c0e26d1b24c5368 | нет |
| `screenshots/02-crm-cash2.png` | 14.10 | 44775 | b5842417b42679e730658beec4a095630f254a02cc72fd2d1bd36f9c88904423 | нет |
| `screenshots/02-crm-cash5.png` | 14.10 | 33797 | 52c932c3fd5136d171a0d550978f8f912ce2b8668b4f8aad3575c55de38d95fd | нет |
| `screenshots/02-dbg.png` | 03.10 | 44481 | dbacf825b78b61a7e07cbb5afea59d0795af0b441a1baa40cfce320507b0d58e | нет |
| `screenshots/02-svc-check.jpg` | 14.10 | 42798 | 422f806e915564eeb0fb7f2c2cdb288a5015c905843b9226b9014be1c0c34927 | нет |
| `screenshots/02-svc-check2.jpg` | 14.10 | 33188 | 735d2a6a20cd0186f4d2d37d2ad060fb9805450b8bcacb212b3be6e7708a4023 | нет |
| `screenshots/02-svc-check3.jpg` | 14.10 | 41285 | 8f17be3867d27fc3a1bae8e6e28ef152567d4950e131bc92944892f50cde3fc9 | нет |
| `screenshots/02-tj-create.jpg` | 14.10 | 35773 | eaa3a4de40fb2921c5c70576c4d440acad3b96f680bc2c5a9e4ffa08a1d0d48a | нет |
| `screenshots/03-cash-check.png` | 14.10 | 36425 | 13ce7ad44815cf97cccceedbb880141adc7cb0670d3a18d9559b64759175634d | нет |
| `screenshots/03-crm-cash.png` | 14.10 | 41520 | 2b62085982dde973f70ea232426c73e80ac1a082b3f950209dd6dc2e200d5c7d | нет |
| `screenshots/03-crm-cash5.png` | 14.10 | 33991 | 10c051d5f9e81801b004a9d0f89c8efe06a9f4cdee425b49db1ef31d7133b5d7 | нет |
| `screenshots/03-dbg.png` | 03.10 | 44481 | 48eba45755c9ab1b28a054d4e523f34050b4e4c93a1ff1cc7467a8dc3ed1beaa | нет |
| `screenshots/03-svc-check.jpg` | 14.10 | 42798 | 16b235ee57695ccaa53a459efe4e932f7fdc7cb995fa90951275e74c5c80c559 | нет |
| `screenshots/03-svc-check3.jpg` | 14.10 | 41285 | e44b9f87e0f91733e7a34d0e06616aa67558cc5a7bdd614f9e53758a68e7b641 | нет |
| `screenshots/04-cash-check.png` | 14.10 | 44869 | c4f4e81cf317a563ab8515ad41ff302e18f960bfd9b5f57db370404199e40ab8 | нет |
| `screenshots/04-crm-cash.png` | 14.10 | 41520 | 4c858340499df298d30dc1574c65e15cf9619948e95b9c00b015bab8916b8b4e | нет |
| `screenshots/04-crm-cash5.png` | 14.10 | 34133 | b341370e6bfee9ef9fccdbb09eb99f40bd8a3bd47946e3b2e7103be693ebe397 | нет |
| `screenshots/05-crm-cash5.png` | 14.10 | 34293 | f0249f42069a333e6b153047b79bd97d3447a82f91eb839521b9275c10279a50 | нет |
| `screenshots/06-crm-cash5.png` | 14.10 | 34471 | 0007991115a72da83fb90e5619adcf7c4658b084544f6e04610858fe120a68b2 | нет |
| `screenshots/07-crm-cash5.png` | 14.10 | 34471 | 818306390684f4771ca6d607da9b9e2c443b06bf67fee9a99ab1650f1962c8d8 | нет |
| `screenshots/08-crm-cash5.png` | 14.10 | 42716 | d7507b810cbb3a41b840e0f388946070091b09e0c191a3173925fa5e7f8d5785 | нет |
| `screenshots/crm-cash3.png` | 14.10 | 44775 | 76b4354a944f26c63eade3c41b91a14b44c27be9f5605f07253fc30055627875 | нет |
| `screenshots/crm-cash4.png` | 14.10 | 33022 | be2a21e11ced40f544bf227850d8bf4cba5dcf09ea21dfc3d45f8445e7768fe8 | нет |
| `screenshots/dbg.png` | 03.10 | 40551 | b3029e2b8070934b06e112e02da071b9577606be5a095b075c62a94ee16bd5ec | нет |
| `support.js` | 19.10 | 69150 | 8fe7df74405f3c55f49b7249c74ea1397e65d07dea2b1bd3b4a489bec2e28cbe | да |
| `uploads/claude-design-prompt-360af029.md` | 14.10 | 17819 | 360af029b15dfef97123afa6a6c445614bb459777ae27c1fe972938baaa1b4b3 | нет |
| `uploads/claude-design-prompt.md` | 14.10 | 17819 | 360af029b15dfef97123afa6a6c445614bb459777ae27c1fe972938baaa1b4b3 | нет |
| `uploads/ortus-crm-design-v0.1(1)/01-technical-spec-6505690d.md` | 14.10 | 59742 | 6505690d60f10a621029af874a1d56190dd66fa060a9542c78f52f25bf57212e | нет |
| `uploads/ortus-crm-design-v0.1(1)/01-technical-spec.md` | 14.10 | 59742 | 6505690d60f10a621029af874a1d56190dd66fa060a9542c78f52f25bf57212e | нет |
| `uploads/ortus-crm-design-v0.1(1)/02-architecture-5801659a.md` | 14.10 | 85435 | 5801659a1dc3e976471f203fe095662913e1811cc5e8a4443781d43d3eb4441a | нет |
| `uploads/ortus-crm-design-v0.1(1)/02-architecture.md` | 14.10 | 85435 | 5801659a1dc3e976471f203fe095662913e1811cc5e8a4443781d43d3eb4441a | нет |
| `uploads/ortus-crm-design-v0.1(1)/03-api-guide-4a9435ca.md` | 14.10 | 27985 | 4a9435cabba579388c4f07e2e1858943b731175b9a686af58a7daa0c25a6c906 | нет |
| `uploads/ortus-crm-design-v0.1(1)/03-api-guide.md` | 14.10 | 27985 | 4a9435cabba579388c4f07e2e1858943b731175b9a686af58a7daa0c25a6c906 | нет |
| `uploads/ortus-crm-design-v0.1(1)/04-product-research-3bc1b10f.md` | 14.10 | 29570 | 3bc1b10f4f6e2381eaa6671a84c8d4bb6c54e537169ca0ce5d61972e7e989850 | нет |
| `uploads/ortus-crm-design-v0.1(1)/04-product-research.md` | 14.10 | 29570 | 3bc1b10f4f6e2381eaa6671a84c8d4bb6c54e537169ca0ce5d61972e7e989850 | нет |
| `uploads/ortus-crm-design-v0.1(1)/05-technology-review-1d5569c7.md` | 14.10 | 19615 | 1d5569c79d938c13383f15459f078ac2ead36f648c8fa73669fc249dfeae3107 | нет |
| `uploads/ortus-crm-design-v0.1(1)/05-technology-review.md` | 14.10 | 19615 | 1d5569c79d938c13383f15459f078ac2ead36f648c8fa73669fc249dfeae3107 | нет |
| `uploads/ortus-crm-design-v0.1(1)/06-team-prompt-196a093a.md` | 14.10 | 22912 | 196a093ae0daf09e30ece9970494995cf7ffa6b3ffb040b3879808a71692f079 | нет |
| `uploads/ortus-crm-design-v0.1(1)/06-team-prompt.md` | 14.10 | 22912 | 196a093ae0daf09e30ece9970494995cf7ffa6b3ffb040b3879808a71692f079 | нет |
| `uploads/ortus-crm-design-v0.1(1)/07-ux-and-data-662d86f7.md` | 14.10 | 48030 | 662d86f7db2eba40213b1583dffd80bfb76136644cba25a80dbd3ceb64a76921 | нет |
| `uploads/ortus-crm-design-v0.1(1)/07-ux-and-data.md` | 14.10 | 48030 | 662d86f7db2eba40213b1583dffd80bfb76136644cba25a80dbd3ceb64a76921 | нет |
| `uploads/ortus-crm-design-v0.1(1)/08-domain-scenarios-cd2099ba.md` | 14.10 | 74820 | cd2099ba594e337d4714c7e18737f67b7b0fd7eaa45c311b3c5a1589c5ad2f05 | нет |
| `uploads/ortus-crm-design-v0.1(1)/08-domain-scenarios.md` | 14.10 | 74820 | cd2099ba594e337d4714c7e18737f67b7b0fd7eaa45c311b3c5a1589c5ad2f05 | нет |
| `uploads/ortus-crm-design-v0.1(1)/09-team-session-30906e5a.md` | 14.10 | 10271 | 30906e5a34f59a0825347f4cd431250581567eb73b9ec8c72922504b1dc9d9c5 | нет |
| `uploads/ortus-crm-design-v0.1(1)/09-team-session.md` | 14.10 | 10271 | 30906e5a34f59a0825347f4cd431250581567eb73b9ec8c72922504b1dc9d9c5 | нет |
| `uploads/ortus-crm-design-v0.1(1)/README-3fe67076.md` | 14.10 | 7141 | 3fe67076c845417bd076e11aa76a1f2f94f4647828237ba71a1b6ecdb4993612 | нет |
| `uploads/ortus-crm-design-v0.1(1)/README.md` | 14.10 | 7141 | 3fe67076c845417bd076e11aa76a1f2f94f4647828237ba71a1b6ecdb4993612 | нет |
| `uploads/ortus-crm-design-v0.1(1)/ortus-openapi-v0.1-6fcf271f.yaml` | 14.10 | 364884 | 6fcf271f1800250a8a669d63cca4b798da5ebdc9ed2f6594754b1b0c46ac8e16 | нет |
| `uploads/ortus-crm-design-v0.1(1)/ortus-openapi-v0.1.yaml` | 14.10 | 364884 | 6fcf271f1800250a8a669d63cca4b798da5ebdc9ed2f6594754b1b0c46ac8e16 | нет |
| `uploads/ortus-crm-interface(1)-4b88cfd3.html` | 14.10 | 71718 | 4b88cfd3251db0226bb79a047c277eebe2546ef6cfe01a421f76b00ac2ce52ee | нет |
| `uploads/ortus-crm-interface(1).html` | 14.10 | 71718 | 4b88cfd3251db0226bb79a047c277eebe2546ef6cfe01a421f76b00ac2ce52ee | нет |
| `uploads/pasted-1790968436269-0.png` | 14.10 | 11886 | 029159472bb8adc09cc591bbb5b99a0e559bc1fb387cfbe27ff26d45a983f226 | нет |
| `uploads/pasted-1790971015233-0.png` | 14.10 | 134843 | a630d00f508d4a31a9947ae63f602cfcc8232164362f129316f4ca3c51a0e66a | нет |
| `uploads/pasted-1791314723413-0.png` | 14.10 | 97821 | e23c7c8d334bb069c076169622b37ccedfc34ffbb06456f951e55df375db7a57 | нет |
| `uploads/pasted-1791314736184-0.png` | 14.10 | 108950 | a97e49a059c77fcf8350e97f859b55ff276483a8c849527cb01ba2bd0c683423 | нет |
| `uploads/pasted-1791314759057-0.png` | 14.10 | 102577 | 72ee421a590af0bbb58683f6b24713f168cbd22aa7ca94fdf51b41c785749365 | нет |
| `uploads/pasted-1791314774299-0.png` | 14.10 | 59645 | 604c37848adb1cd347c51ee2c9914a95bba43396d86b0168d94338168dd65a9d | нет |
| `uploads/pasted-1791314796700-0.png` | 14.10 | 108011 | 4111f48b54ad407b28ed9a3db6e88d799ad596fcd94b77e387fba68c9250cb1b | нет |
| `uploads/pasted-1791314817435-0.png` | 14.10 | 116373 | 35c597b861a0d69804345be85c60e7e8cdf18cad2bbfab2245d1b6cf9524e131 | нет |
| `uploads/pasted-1791314851524-0.png` | 14.10 | 112234 | 3b2a07b8949607d4ce54893bf5487907b781b5fa12ccfd068ca62f02f5b14452 | нет |
| `uploads/pasted-1791314868603-0.png` | 14.10 | 83552 | 4f4ac76ec600516660ca82b6264a93f59602617e48ead63d2ffd53980c685830 | нет |
| `uploads/pasted-1791314912923-0.png` | 14.10 | 145135 | 04f9a52ef85896aadebb519b65f2cf6dc26dfc430b3fab80cdf67a677d33ab7b | нет |
| `uploads/pasted-1791477020324-0.png` | 14.10 | 10845 | 711490bd6e12c38b09dbefde48a99e132b50fefebd2275767aa81176323646e1 | нет |
| `База знаний - варианты.dc.html` | 19.10 | 118879 | 50847850f0acbb8dd1cbe784ab97a8105220cb9451b163c8a0fc2e4e9e60f28d | да |
| `База знаний.dc.html` | 19.10 | 117389 | c4e7b3c5afb71d91515198b1ecc8a8836aab535257b60aa39959a7b1f591d987 | да |
| `Дизайн-система.dc.html` | 19.10 | 103267 | 8c4533cb50b8175fa2bcece68399b939c349166ac8a06399178a8dadbb4d3068 | да |
| `Документация.dc.html` | 19.10 | 45274 | a09197a90965fb295c381fed289731404c6ec94ff8cf04cca0da88e4e934cc4a | да |
| `Документы - варианты.dc.html` | 19.10 | 154220 | 9b8b1bf8254aaa3fe2ad8484a08c82be4d8250e3dd33246499c55aa19efc41d4 | да |
| `Документы.dc.html` | 19.10 | 264106 | 402ea17a6758596d27baa37f012902500cf10e4040eed809bab95e1f6f027328 | да |
| `Задачи - варианты.dc.html` | 19.10 | 74740 | b110a6a9a4dbeaed914ec8e1fb4af98cd6e8dd432dec182493dae6dfb193a9a6 | да |
| `Задачи и проекты.dc.html` | 19.10 | 103300 | 305cf6410ba7fb2284143fd31a3cc293162ed05d559a5d9a177360dc7eb4ce30 | да |
| `Касса - варианты.dc.html` | 19.10 | 168943 | a33bd9417b41d094f6a949fb146dd1eecb2d39f7d116b412af00c1e9522c73f4 | да |
| `Касса.dc.html` | 19.10 | 160081 | b562e9d3f179221f14ee4faa78fe4fc4b0a1a3031f8742f8b3a23ec6f1a3661a | да |
| `Обращения - варианты.dc.html` | 19.10 | 159827 | 43e1a679bde409aa73b2fa7cc7bfabb0c8df482bd5a4f5ed65797f2a41abb551 | да |
| `Обращения.dc.html` | 19.10 | 68759 | a0c1a8e9723bbacd384fdffb2c6a6137f48ac692ceecdce89fcabcdd52e4cec2 | да |
| `Объекты - варианты.dc.html` | 19.10 | 108376 | ab435f3589c6eb9cc680f5201fb9ce245beae07412f4114d4aa89cd8886bfa78 | да |
| `Ортус CRM.dc.html` | 19.10 | 610877 | dae8b9e70cce9fffab3e59f29288b85a26bfa7a163bf163d35cc330463099029 | да |
| `Ремонт и стройка.dc.html` | 19.10 | 264530 | 840c00b6c9a76ac88353a8d81de6c02b7ce0266e4f23b11b7ff15dcbe430a13a | да |
| `Формы и опросы.dc.html` | 19.10 | 206917 | c90c5977ee1de18851c9ed8cc530f3a4e429f1d7cd30a787d14a40a5dec2eeac | да |
| `Чаты - варианты.dc.html` | 19.10 | 168844 | b1ae67e13bf162f6682758f1021fab6ac9508841c1d85917b5fcc69cc22a95f8 | да |
| `Чаты.dc.html` | 19.10 | 124784 | bd9438f27438dc7a7f11b361fcab2ef988817e9730c3ef170b179b062d9d7c22 | да |
