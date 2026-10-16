1 клик button «Профиль»
  профиль: - dialog "Профиль" [ref=f10e83]: / - generic [ref=f10e85]: Дарья Зимина / - generic [ref=f10e89]: Владелец бизнеса · Вся организация / - button "Выйти" [ref=f10e90] [cursor=pointer]: / - text: Выйти
  клик button «Выйти»
  url: "/auth/login"
  после logout запросов API: []
  401 в сети: 0
  консоль (ошибки/предупреждения): 
2 клик button «Ещё»
  лист: - button "SPA «Лотос» — сменить бизнес" [ref=f11e13] [cursor=pointer]: / - button "Уведомления" [ref=f11e17] [cursor=pointer]: / - button "Профиль" [ref=f11e19] [cursor=pointer]: АМ / - button "Мой день" [ref=f11e26] [cursor=pointer]: / - button "Чаты" [ref=f11e28] [cursor=pointer]: / - button "Календарь" [ref=f11e30] [cursor=pointer]: / - button "Ещё" [expanded] [ref=f11e32] [cursor=pointer]: / - dialog [ref=f11e35]: / - button "Закрыть" [active] [ref=f11e38] [cursor=pointer]: / - button "Мой день" [ref=f11e41] [cursor=pointer]: / - button "Чаты" [ref=f11e44] [cursor=pointer]: / - button "Кал
  фокус после Escape: "menuЕщё"
3 /cash: - heading "Нет доступа к разделу «Касса»" [level=1] [ref=f13e47] / - paragraph [ref=f13e48]: Ни одна ваша роль не разрешает его просматривать. Владелец бизнеса может добавить действие в роль.
4 клик button «Профиль»
  профиль водителя: - dialog "Профиль" [ref=f14e53]: / - button "Выйти" [ref=f14e57] [cursor=pointer]: / - text: Выйти
  фокус: "Профиль solid"
5 scen loading 200
  загрузка: - navigation "Основная навигация" [ref=f16e15]: / - text: Данные других организаций изолированы / - status "Загрузка" [ref=f16e21]: / - generic [ref=f16e26]: Загружаем рабочее пространство…
  scen offline 200
  ошибка: - button "Профиль" [ref=f17e13] [cursor=pointer] / - alert [ref=f17e21]: "Не удалось загрузить модули прототипа: Нет связи с сервером. Операция не выполнена."
  reset 200
6 storage-full 200
  владелец: - alert [ref=f19e81]: / - strong [ref=f19e84]: Место организации заполнено. / - button "Открыть «Модули и место»" [ref=f19e85] [cursor=pointer]
  массажист: - alert [ref=f20e43]: / - strong [ref=f20e46]: Место организации заполнено.
  reset 200
7 trial-ended 200
  владелец: - status [ref=f22e81]: / - strong [ref=f22e84]: Пробный период завершён.
  reset 200
8 404 в оболочке: - link "К содержимому" [ref=f24e4] [cursor=pointer]: / - heading "Страница не найдена" [level=1] [ref=f24e82]
  чужая организация: - heading "Страница не найдена" [level=1] [ref=f25e5] / - link "На стартовую страницу" [ref=f25e7] [cursor=pointer]:
  неизвестный путь: - heading "Страница не найдена" [level=1] [ref=f26e5] / - link "На стартовую страницу" [ref=f26e7] [cursor=pointer]:
9 без сессии: "/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/home" - paragraph [ref=f28e4]: Нужен вход / - link "Войти" [ref=f28e5] [cursor=pointer]:
10 offline-событие: 
хосты сети: ["127.0.0.1:6101"]
realtime-tickets в сети: 0
