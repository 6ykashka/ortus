# W1.20 · возврат 2 · проходка Playwright MCP

@playwright/mcp (.mcp.json, stdio), Vite --mode e2e 127.0.0.1:5204 (mock), эталон design-stage-1 на 127.0.0.1:4104.

| # | Проверка | Итог | Детали |
|---|---|---|---|
| 1 | «Нет связи.» 390: стиль текста и высота как в эталоне | ok | эталон "{\"role\":\"status\",\"height\":107,\"body\":{\"font-size\":\"14px\",\"line-height\":\"20.3px\",\"text-wrap-style\":\"pretty\",\"flex-basis\":\"240px\"},\"button\":null,\"border\":\"rgb(235, 215, 168)\"}"; реализация "{\"role\":\"status\",\"height\":107,\"body\":{\"font-size\":\"14px\",\"line-height\":\"20.3px\",\"text-wrap-style\":\"pretty\",\"flex-basis\":\"240px\"},\"button\":null,\"border\":\"rgb(235, 215, 168)\"}" |
| 2 | «Место организации заполнено.» 1440: alert, кнопка без фона, 14 px (:178) | ok | "{\"role\":\"alert\",\"height\":67,\"body\":{\"font-size\":\"14px\",\"line-height\":\"20.3px\",\"text-wrap-style\":\"pretty\",\"flex-basis\":\"240px\"},\"button\":{\"background-color\":\"rgba(0, 0, 0, 0)\",\"font-size\":\"14px\",\"font-weight\":\"500\"},\"border\":\"rgb(240, 201, 195)\"}" |
| 3 | кнопка баннера ведёт в «Модули и место» | ok | "/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/modules" |
| 4 | водитель без событий: «Прочитать все» активна (:126) | ok | - button "Прочитать все" [ref=f4e56] [cursor=pointer] |
| 5 | «Прочитать все»: цвет акцента #1F6B52, курсор pointer | ok | "{\"disabled\":false,\"color\":\"rgb(31, 107, 82)\",\"opacity\":\"1\",\"cursor\":\"pointer\"}" |
| 6 | владелец: граница строки события #F0F2EE (:129) | ok | "rgb(240, 242, 238)" |
| 7 | консоль: нет ошибок приложения | ok | 0 ошибок |
