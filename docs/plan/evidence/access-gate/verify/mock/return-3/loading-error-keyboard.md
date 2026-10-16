scenario delay once: 200

loading: status «Загрузка» visible=true text="Загружаем рабочее пространство…" gate=0

after load: gate h1=["«Логистика» не подключена организацией"] status gone=true

scenario error: 200

error: ["Не удалось загрузить модули прототипа: Нет связи с сервером. Операция не выполнена."] gate=0

clear: 200

390 owner action box: {"x":81.90625,"y":359.28125,"width":226.171875,"height":44}

390 Tab steps to action: 5 outline=solid 2px rgb(31, 107, 82)

390 Space → /t/f04f636e-b66d-509e-ae10-9c27a18e3baa/modules

scrollW 390: 390