## 1. Владелец 1440: дерево доступности
- ok — URL / → /t/<id>/home
- ok — регион banner (шапка)
- ok — select «Область просмотра»
- ok — кнопка «Уведомления: 2 новых»
- ok — кнопка «Профиль»
- ok — navigation «Основная навигация»
- ok — skip-link «К содержимому»
- ok — h1 «Главная»
- ok — подпись «Данные других организаций изолированы»
- ok — группа «Обзор»
- ok — группа «Компания»
- ok — группа «Отрасли»
- ok — группа «Общие модули»
- ok — пункт «Главная»
- ok — бренд «ортус», «пространство бизнеса», «Альта Групп»
- ok — aria-current=page у «Главная»
  axe owner-1440: []
- ok — axe owner-1440: нет serious/critical
## 2. Поповер «Уведомления», «Прочитать все»
- ok — dialog «Уведомления»
- ok — кнопка «Прочитать все»
- ok — aria-expanded=true у колокольчика
  axe owner-notif: []
- ok — axe owner-notif: нет serious/critical
- ok — после «Прочитать все» — «Уведомления» без счётчика
- ok — «Прочитать все» недоступна без непрочитанных (эталон — всегда доступна)
- ok — Escape закрывает поповер
## 3. Поповер «Профиль»
- ok — Профиль: имя, «Назначения», строка владельца, «Выйти»
- ok — поповеры исключают друг друга
  фокус после Escape: "Уведомления"
- ok — фокус возвращается на кнопку поповера
## 4. Меню → «Оформление», клавиатура
- ok — переход «Оформление»: h1
- ok — URL …/branding
  Tab: К содержимому | outline solid 2px → Область просмотра | outline solid 2px → Уведомления | outline solid 2px → Профиль | outline solid 2px → homeГлавная | outline solid 2px → extensionМодули и место | outline solid 2px
- ok — первый Tab — «К содержимому»
- ok — фокус виден (outline solid)
## 5. Офлайн
- ok — тост «Нет связи. Черновики сохраняются на устройстве»
- ok — пилюля «Нет связи»
- ok — баннер «Нет связи.» дословно
  axe owner-offline: []
- ok — axe owner-offline: нет serious/critical
- ok — связь вернулась — баннер снят
  console owner: [ERROR] Failed to load resource: net::ERR_FAILED @ http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/39224048-DBC1-4531-9356-85B727B6D47A/from?get&nocache=19ab8&tm=2026-10-15T10%3A48%3A16.156Z:0 / [ERROR] Failed to load resource: net::ERR_FAILED @ http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/39224048-DBC1-4531-9356-85B727B6D47A/from?get&nocache=119f1&tm=2026-10-15T10%3A48%3A16.174Z&second=true:0 / [ERROR] Failed to load resource: net::ERR_FAILED @ http://gc.kis.v2.scr.kaspersky-labs.com/7D8B79A2-8974-4D7B-A76A-F4F29624C06B0qAbzcPi5oO2L
  network owner: хосты gc.kis.v2.scr.kaspersky-labs.com, 127.0.0.1:6102; 4xx/5xx: нет
## 6. Оператор
- ok — оператор → /platform/tenants
- ok — шапка оператора дословно
- ok — без колокольчика
- ok — пункт «Организации»
- ok — пункт «Использование»
- ok — пункт «Заявки на тариф»
- ok — пункт «Пользователи»
- ok — пункт «Тарифная сетка»
- ok — подпись «Без доступа к данным клиентов»
  axe operator-1440: []
- ok — axe operator-1440: нет serious/critical
## 7. Массажист: переключатель бизнеса
- ok — кнопка «Альта Групп — сменить бизнес»
- ok — область «Салон и SPA · мой календарь»
- ok — dialog «Бизнесы»
  axe therapist-switcher: []
- ok — axe therapist-switcher: нет serious/critical
- ok — после выбора — «SPA «Лотос»» в шапке
## 8. Водитель, прораб: меню рабочего места
- ok — водитель: «Сегодня»
- ok — водитель: «Автомобили»
- ok — водитель: «Подотчёт»
- ok — водитель: «Чаты»
- ok — водитель: «База знаний»
- ok — водитель: «Документы»
- ok — область водителя «Мои назначения» (allowlist Q-W1.20-6)
- ok — прораб: «Объекты»
- ok — прораб: «Подотчёт»
- ok — прораб: «Чаты»
- ok — прораб: «Задачи»
- ok — прораб: «База знаний»
- ok — прораб: «Документы»
- ok — область прораба «Назначенные объекты»
- ok — логист: «Область не назначена»
- ok — логист: «Ролей нет — доступ к модулям не выдан»
## 9. 404
- ok — 404 внутри оболочки — с меню
- ok — 404 вне оболочки — карточка и ссылка
  axe notfound-global: []
- ok — axe notfound-global: нет serious/critical
- ok — ссылка ведёт на стартовую страницу
## 10. Ошибка загрузки, загрузка, нет входа
  scenario offline: 200
- ok — alert ошибки загрузки дословно
  axe load-error: ["moderate page-has-heading-one html"]
- ok — axe load-error: нет serious/critical
  scenario reset: 200
  scenario delay: 200
- ok — скелетон «Загрузка», «Загружаем рабочее пространство…»
- ok — после задержки — оболочка
- ok — «Нужен вход» и «Войти»
  axe no-session: ["moderate landmark-one-main html","moderate page-has-heading-one html","moderate region #app"]
- ok — axe no-session: нет serious/critical
## 11. 390×844
- ok — нижняя навигация
- ok — нижняя: «Главная»
- ok — нижняя: «Модули»
- ok — нижняя: «Люди»
- ok — нижняя: «Ещё»
- ok — нет горизонтальной прокрутки (scrollWidth 390)
  axe owner-390: []
- ok — axe owner-390: нет serious/critical
- ok — лист «Все разделы» (dialog aria-labelledby → h2) с «Закрыть»
  axe owner-390-sheet: []
- ok — axe owner-390-sheet: нет serious/critical
- ok — Escape закрывает лист
- FAIL — водитель 390: «Сегодня»
- FAIL — водитель 390: «Автомобили»
- FAIL — водитель 390: «Подотчёт»
- FAIL — водитель 390: «Ещё»
## 12. 768×1024
- FAIL — рейл 68 px (undefined)
  axe owner-768: ["moderate page-has-heading-one html"]
- ok — axe owner-768: нет serious/critical
  console final: нет ошибок и предупреждений
  network final: хосты gc.kis.v2.scr.kaspersky-labs.com, 127.0.0.1:6102; 4xx/5xx: нет
- FAIL — сеть: только 127.0.0.1

Итого провалов: 6
  - водитель 390: «Сегодня»
  - водитель 390: «Автомобили»
  - водитель 390: «Подотчёт»
  - водитель 390: «Ещё»
  - рейл 68 px (undefined)
  - сеть: только 127.0.0.1
