// Демо-данные модулей следующих итераций: календарь, база знаний, файлы, SPA, касса, ремонт.
export function extraSeed() {
  return {
    calendar: {
      resources: [
        { id: 'res-v1', kind: 'vehicle', name: 'ГАЗель Next · А 412 МР', unit: 'f-msk-sever', ref: 'v1' },
        { id: 'res-v6', kind: 'vehicle', name: 'Mercedes Sprinter · Т 771 ЕХ', unit: 'f-msk-sever', ref: 'v6' },
        { id: 'res-v4', kind: 'vehicle', name: 'ГАЗон Next · Е 905 НА', unit: 'f-msk-sever', ref: 'v4' },
        { id: 'res-iv', kind: 'staff', name: 'Илья Васильев · водитель', unit: 'f-msk-sever' },
        { id: 'res-am', kind: 'staff', name: 'Анна Морозова · массажист', unit: 'spa' },
        { id: 'res-room2', kind: 'room', name: 'Кабинет № 2', unit: 'spa' },
        { id: 'res-room3', kind: 'room', name: 'Кабинет № 3', unit: 'spa' },
        { id: 'res-table', kind: 'equipment', name: 'Стол с подогревом', unit: 'spa' },
      ],
      bookings: [
        { id: 'b-208', title: 'Рейс Р-208', source: { kind: 'trip', id: 'Р-208' }, res: ['res-iv'], start: 9, end: 13, prep: 0, clean: 0 },
        { id: 'b-to', title: 'Плановое ТО', source: { kind: 'vehicle', id: 'v4' }, res: ['res-v4'], start: 8, end: 20, prep: 0, clean: 0 },
        { id: 'b-a1', title: 'Классический массаж · Мария К.', source: { kind: 'appointment', id: 'ap-1' }, res: ['res-am', 'res-room2'], start: 10, end: 11, prep: 0, clean: 0.25 },
        { id: 'b-a2', title: 'SPA-ритуал · Ольга Р.', source: { kind: 'appointment', id: 'ap-2' }, res: ['res-am', 'res-room2', 'res-table'], start: 11.5, end: 13, prep: 0.25, clean: 0.25 },
        { id: 'b-a3', title: 'Массаж спины · Екатерина Л.', source: { kind: 'appointment', id: 'ap-3' }, res: ['res-am', 'res-room2'], start: 14, end: 14.75, prep: 0, clean: 0.25 },
        { id: 'b-br', title: 'Перерыв', source: null, res: ['res-am'], start: 13.25, end: 14, prep: 0, clean: 0 },
      ],
    },
    knowledge: {
      spaces: [{ id: 'sp-log', name: 'Логистика' }, { id: 'sp-spa', name: 'Салон и SPA' }, { id: 'sp-own', name: 'Руководство' }],
      pages: [
        { id: 'kb-1', space: 'sp-log', title: 'Регламент приёмки смены', access: 'all', versions: [
          { v: 1, at: '05.09.2026', by: 'Дарья Зимина', body: 'Менеджер проверяет фото до и после, пробег и расходы. Машина возвращается в пул только после приёмки.' },
          { v: 2, at: '24.09.2026', by: 'Дарья Зимина', body: 'Менеджер проверяет фото до и после (5 ракурсов, включая одометр), пробег и расходы с чеками. При замечаниях смена возвращается водителю с указанием раздела. Машина возвращается в пул только после приёмки.' },
        ] },
        { id: 'kb-2', space: 'sp-log', title: 'Как фотографировать машину при осмотре', access: 'all', versions: [
          { v: 1, at: '10.09.2026', by: 'Марина Котова', body: 'Снимайте при дневном свете с расстояния 3–4 метра. Номер должен читаться на фото спереди и сзади. Одометр — крупно, без бликов.' },
        ] },
        { id: 'kb-5', space: 'sp-log', title: 'Журнал осмотров машин', access: 'all', versions: [
          { v: 1, at: '24.09.2026', by: 'Дарья Зимина', body: 'Сводный журнал осмотров перед выездом и при сдаче машины. Строки добавляет форма «Осмотр машины» после принятия ответа; исправления вносятся через ответ формы. Как снимать машину — на странице «Как фотографировать машину при осмотре».' },
        ] },
        { id: 'kb-3', space: 'sp-spa', title: 'Технологические карты процедур', access: 'all', versions: [
          { v: 1, at: '12.09.2026', by: 'Дарья Зимина', body: 'Классический массаж: масло 30 мл. SPA-ритуал: масло 40 мл, крем 20 г. Массаж спины: масло 20 мл. Отклонение от нормы фиксируется при завершении процедуры.' },
        ] },
        { id: 'kb-4', space: 'sp-own', title: 'Политика начислений водителям', access: 'owner', versions: [
          { v: 1, at: '01.09.2026', by: 'Дарья Зимина', body: 'Начисление создаётся после приёмки смены. Ставка зависит от маршрута. Водитель не видит начисления в приложении.' },
        ] },
      ],
      tables: [
        { id: 'kt-insp', page: 'kb-5', title: 'Осмотры', columns: [
          { id: 'c-at', name: 'Дата', type: 'text' }, { id: 'c-obj', name: 'Рейс', type: 'text' }, { id: 'c-who', name: 'Водитель', type: 'text' },
          { id: 'c-odo', name: 'Пробег, км', type: 'number' }, { id: 'c-fuel', name: 'Топливо', type: 'text' }, { id: 'c-def', name: 'Дефекты', type: 'text' }, { id: 'c-resp', name: 'Ответ', type: 'text' },
        ], rows: [
          { id: 'kr-2', at: '27.09 09:12', src: { form: 'fm-insp', resp: 'R-1012', fv: 3, rule: 'au-2', rv: 1 }, cells: { 'c-at': '27.09 09:05', 'c-obj': 'Рейс Р-196', 'c-who': 'Илья Васильев', 'c-odo': '84 210', 'c-fuel': '¾', 'c-def': 'нет', 'c-resp': 'R-1012' } },
          { id: 'kr-1', at: '24.09 18:20', src: { form: 'fm-insp', resp: 'R-0988', fv: 2, rule: 'au-2', rv: 1 }, cells: { 'c-at': '18.09 08:41', 'c-obj': 'Рейс Р-171', 'c-who': 'Кирилл Громов', 'c-odo': '83 902', 'c-resp': 'R-0988' } },
        ] },
      ],
      entries: [],
    },
    spa: {
      stock: [
        { id: 'oil', name: 'Масло массажное', unit: 'мл', qty: 250 },
        { id: 'cream', name: 'Крем восстанавливающий', unit: 'г', qty: 12 },
      ],
      appointments: [
        { id: 'ap-1', time: '10:00–11:00', client: 'Мария К.', service: 'Классический массаж', room: 'Кабинет № 2', equipment: '—', duration: 60, clean: 15, recipe: [['oil', 30]], status: 'confirmed' },
        { id: 'ap-2', time: '11:30–13:00', client: 'Ольга Р.', service: 'SPA-ритуал', room: 'Кабинет № 2', equipment: 'Стол с подогревом', duration: 90, prep: 15, clean: 15, recipe: [['oil', 40], ['cream', 20]], status: 'confirmed' },
        { id: 'ap-3', time: '14:00–14:45', client: 'Екатерина Л.', service: 'Массаж спины', room: 'Кабинет № 2', equipment: '—', duration: 45, clean: 15, recipe: [['oil', 20]], status: 'confirmed' },
      ],
      movements: [],
      issues: [],
    },
    cash: {
      accounts: [{ id: 'ca-sever', name: 'Касса Север Логистик', unit: 'f-msk-sever' }, { id: 'ca-spa', name: 'Касса SPA', unit: 'spa' }],
      ops: [
        { id: 'K-301', account: 'ca-sever', type: 'in', amount: 50000, basis: 'Подотчёт на топливо, сентябрь', at: '01.09', by: 'Дарья Зимина' },
        { id: 'K-302', account: 'ca-sever', type: 'out', amount: 2500, basis: 'Топливо · рейс Р-196 · чек приложен', at: '27.09', by: 'Марина Котова' },
        { id: 'K-303', account: 'ca-spa', type: 'in', amount: 3200, basis: 'Классический массаж · визит 29.09', at: '29.09', by: 'Анна Морозова' },
        { id: 'K-304', account: 'ca-spa', type: 'refund', amount: 1600, basis: 'Возврат за отменённый визит', at: '30.09', by: 'Дарья Зимина' },
      ],
    },
    repair: {
      // st — сводка разделов объекта (график, документы, снабжение, деньги) в форме onStatus модуля «Ремонт и стройка».
      // У объекта с sections: true сводку присылает сам модуль, разделы заполнены только у него. sections: [...] — модуль показывает только эти разделы.
      // draft: true — объект-черновик до договора: создаётся, когда заявка переходит на этап «Замер».
      objects: [
        { id: 'obj-42', name: 'ЖК Речной · квартира 42', address: 'Москва, ул. Речная, 5, кв. 42', stage: 'Черновая отделка', area: '51 м², 2 комнаты', kind: 'капитальный ремонт', contract: 'договор № 42', due: '27.11', client: 'Ольга Смирнова', foreman: 'Алексей Соколов', crew: ['k1', 'k2', 'k3', 'k4'], sections: true,
          access: [['door_front', 'Подъезд 2, этаж 9, домофон 42К'], ['elevator', 'Грузовой лифт до 20:00, материалы заносить со двора'], ['key', 'Ключи у прораба, запасной комплект в офисе'], ['volume_up', 'Шумные работы: будни 9:00–19:00, перерыв 13:00–15:00']],
          sub: { name: 'ООО «ЭлектроПрофи»', scope: 'электромонтаж', until: '31.10' } },
        { id: 'obj-38', name: 'ЖК Северный парк · квартира 117', address: 'Москва, Дмитровское ш., 107к2, кв. 117', stage: 'Чистовая отделка', area: '74 м², 3 комнаты', kind: 'капитальный ремонт', contract: 'договор № 38', due: '17.10', client: 'Игорь Лебедев', foreman: 'Алексей Соколов', crew: ['k1', 'k3', 'k4'],
          access: [['door_front', 'Подъезд 1, этаж 14, домофон 117В'], ['elevator', 'Грузовой лифт по записи у консьержа'], ['key', 'Ключи у консьержа под подпись'], ['volume_up', 'Шумные работы: будни 10:00–19:00']],
          st: { sched: { due: '17.10', forecast: '17.10', slip: 0 }, req: ['Плинтус МДФ, 42 м'], draft: ['Акт № 3 · чистовая отделка'], sms: [], est: 'approved',
            fin: { total: '1 540 000 ₽', paid: '1 078 000 ₽', spent: '736 400 ₽', margin: '415 800 ₽', subs: ['по смете версии 1', 'аванс и два этапа · 70%', 'материалы и бригада', '27% · факт после закрытия'] } } },
        { id: 'obj-31', name: 'Профсоюзная, 64 · квартира 210', address: 'Москва, Профсоюзная ул., 64к1, кв. 210', stage: 'Чистовая отделка', area: '38 м², 1 комната', kind: 'косметический ремонт', contract: 'договор № 31', due: '09.10', client: 'Наталья Осипова', foreman: 'Алексей Соколов', crew: ['k2', 'k4'],
          access: [['door_front', 'Подъезд 3, этаж 5, код домофона 210'], ['key', 'Ключи у заказчика, встреча по звонку']],
          st: { sched: { due: '09.10', forecast: '09.10', slip: 0 }, req: [], draft: [], sms: [], est: 'approved',
            fin: { total: '486 000 ₽', paid: '340 200 ₽', spent: '298 600 ₽', margin: '131 220 ₽', subs: ['по смете версии 1', 'аванс и этап · 70%', 'материалы и бригада', '27% · факт после закрытия'] } } },
        { id: 'obj-45', name: 'Кофейня на Покровке', address: 'Москва, ул. Покровка, 17, стр. 1', stage: 'Подготовка', area: '64 м², зал и кухня', kind: 'коммерческий ремонт', contract: 'договор № 45', due: '20.12', start: '06.10', client: 'ООО «Зерно»', foreman: null, crew: [],
          access: [['door_front', 'Вход со двора, ворота открывает управляющий'], ['volume_up', 'Шумные работы: будни 9:00–19:00, по согласованию с управляющей компанией']],
          st: { sched: { due: '20.12', forecast: '20.12', slip: 0 }, req: [], draft: [], sms: [], est: 'approved',
            fin: { total: '2 310 000 ₽', paid: '693 000 ₽', spent: '0 ₽', margin: '623 700 ₽', subs: ['по смете версии 3', 'аванс 30%', 'закупок пока нет', '27% · факт после закрытия'] } } },
        { id: 'obj-27', name: 'Дом на Лесной · Мытищи', address: 'Мытищи, ул. Лесная, 14', stage: 'Сдан', handedOver: '12.09', warranty: '12.09.2027', area: '142 м², 2 этажа', kind: 'ремонт под ключ', contract: 'договор № 27', due: '15.09', client: 'Андрей Кузнецов', foreman: 'Алексей Соколов', crew: ['k1', 'k2', 'k3'],
          access: [['key', 'Ключи переданы заказчику 12.09']],
          st: { sched: { due: '15.09', forecast: '12.09', slip: 0 }, req: [], draft: [], sms: [], est: 'approved',
            fin: { total: '1 920 000 ₽', paid: '1 920 000 ₽', spent: '1 344 000 ₽', margin: '576 000 ₽', subs: ['по смете версии 2', 'оплачено полностью', 'материалы и бригада', '30% · по закрытым актам'] } } },
        { id: 'obj-50', name: 'Дом 120 м², Истра', address: 'Истра, ул. Садовая, 8', stage: 'Замер', draft: true, measured: '02.10', area: '120 м², 2 этажа', kind: 'ремонт под ключ', contract: null, due: null, client: 'Сергей Павлов', foreman: null, crew: [], sections: ['measure', 'estimate'],
          access: [['key', 'Ключи у заказчика, выезд по звонку'], ['local_parking', 'Парковка у ворот, въезд для грузовой машины']],
          feed: [{ at: '02.10', who: 'Замерщик Игорь Белов', text: 'внёс замер: 8 помещений, фото и план приложены' }, { at: '01.10', who: 'Дарья Зимина', text: 'перевела заявку на этап «Замер», создан объект-черновик' }],
          st: { est: 'none', req: [], draft: [], sms: [], fin: null } },
      ],
      works: [
        { id: 'w1', obj: 'obj-42', name: 'Подготовка стен', unit: 'м²', plan: 96, fact: 58 },
        { id: 'w2', obj: 'obj-42', name: 'Грунтование', unit: 'м²', plan: 96, fact: 24 },
        { id: 'w3', obj: 'obj-42', name: 'Монтаж перегородок', unit: 'м²', plan: 18, fact: 18 },
        { id: 'w4', obj: 'obj-38', name: 'Шпаклёвка под покраску', unit: 'м²', plan: 186, fact: 186 },
        { id: 'w5', obj: 'obj-38', name: 'Покраска стен', unit: 'м²', plan: 186, fact: 126 },
        { id: 'w6', obj: 'obj-38', name: 'Укладка ламината', unit: 'м²', plan: 58, fact: 40 },
        { id: 'w7', obj: 'obj-31', name: 'Покраска стен', unit: 'м²', plan: 92, fact: 92 },
        { id: 'w8', obj: 'obj-31', name: 'Укладка плитки', unit: 'м²', plan: 24, fact: 24 },
        { id: 'w9', obj: 'obj-31', name: 'Укладка ламината', unit: 'м²', plan: 31, fact: 12 },
        { id: 'w10', obj: 'obj-45', name: 'Демонтаж перегородок', unit: 'м²', plan: 26, fact: 0 },
        { id: 'w11', obj: 'obj-45', name: 'Стяжка пола', unit: 'м²', plan: 64, fact: 0 },
        { id: 'w12', obj: 'obj-27', name: 'Покраска стен', unit: 'м²', plan: 310, fact: 310 },
        { id: 'w13', obj: 'obj-27', name: 'Укладка инженерной доски', unit: 'м²', plan: 118, fact: 118 },
      ],
      crew: [
        { id: 'k1', name: 'Иван Петров', role: 'отделочник', account: false },
        { id: 'k2', name: 'Олег Смирнов', role: 'отделочник', account: false },
        { id: 'k3', name: 'Роман Сергеев', role: 'маляр', account: false },
        { id: 'k4', name: 'Денис Волков', role: 'разнорабочий', account: false },
      ],
      materials: [
        { id: 'mt1', obj: 'obj-42', name: 'Грунтовка', unit: 'л', qty: 30 }, { id: 'mt2', obj: 'obj-42', name: 'Шпаклёвка', unit: 'кг', qty: 120 },
        { id: 'mt3', obj: 'obj-38', name: 'Краска интерьерная', unit: 'л', qty: 36 }, { id: 'mt4', obj: 'obj-38', name: 'Подложка под ламинат', unit: 'м²', qty: 24 },
        { id: 'mt5', obj: 'obj-31', name: 'Подложка под ламинат', unit: 'м²', qty: 20 },
      ],
      // Допработы: прораб предлагает без цен, офис оценивает в смете, заказчик подписывает допсоглашение.
      // suggest — позиции справочника, которые модуль подставит в черновик (демо).
      changes: [
        { id: 'ДР-1', obj: 'obj-42', at: '02.10', by: 'Алексей Соколов', title: 'Перенос розеток на кухне', volume: 6, unit: 'шт', note: 'Заказчик меняет расстановку кухни: 6 розеток перенести, штроба по бетону около 9 м.', photos: 2, status: 'proposed', suggest: [['p-el-move', 6], ['p-chase', 9]] },
      ],
      logs: [
        { id: 'WL-11', obj: 'obj-42', at: '30.09', work: 'w1', volume: 22, crew: ['k1', 'k2'], materials: [['mt2', 40]], photos: 3, status: 'Принят', by: 'Алексей Соколов' },
        { id: 'WL-09', obj: 'obj-38', at: '30.09', work: 'w6', volume: 18, crew: ['k3', 'k4'], materials: [['mt4', 18]], photos: 3, status: 'На проверке', by: 'Алексей Соколов' },
        { id: 'WL-08', obj: 'obj-38', at: '29.09', work: 'w5', volume: 60, crew: ['k1', 'k3'], materials: [['mt3', 12]], photos: 4, status: 'Принят', by: 'Алексей Соколов' },
        { id: 'WL-06', obj: 'obj-31', at: '29.09', work: 'w9', volume: 12, crew: ['k2', 'k4'], materials: [], photos: 2, status: 'Принят', by: 'Алексей Соколов' },
        { id: 'WL-02', obj: 'obj-27', at: '10.09', work: 'w13', volume: 42, crew: ['k1', 'k2'], materials: [], photos: 6, status: 'Принят', by: 'Алексей Соколов' },
      ],
    },
  };
}
