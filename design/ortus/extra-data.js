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
        { id: 'kb-3', space: 'sp-spa', title: 'Технологические карты процедур', access: 'all', versions: [
          { v: 1, at: '12.09.2026', by: 'Дарья Зимина', body: 'Классический массаж: масло 30 мл. SPA-ритуал: масло 40 мл, крем 20 г. Массаж спины: масло 20 мл. Отклонение от нормы фиксируется при завершении процедуры.' },
        ] },
        { id: 'kb-4', space: 'sp-own', title: 'Политика начислений водителям', access: 'owner', versions: [
          { v: 1, at: '01.09.2026', by: 'Дарья Зимина', body: 'Начисление создаётся после приёмки смены. Ставка зависит от маршрута. Водитель не видит начисления в приложении.' },
        ] },
      ],
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
      object: { id: 'obj-42', name: 'ЖК Речной · квартира 42', address: 'Москва, ул. Речная, 5, кв. 42', stage: 'Черновая отделка', area: '51 м², 2 комнаты', kind: 'капитальный ремонт', contract: 'договор № 42', due: '27.11', client: 'Ольга Смирнова', foreman: 'Алексей Соколов',
        access: [['door_front', 'Подъезд 2, этаж 9, домофон 42К'], ['elevator', 'Грузовой лифт до 20:00, материалы заносить со двора'], ['key', 'Ключи у прораба, запасной комплект в офисе'], ['volume_up', 'Шумные работы: будни 9:00–19:00, перерыв 13:00–15:00']],
        sub: { name: 'ООО «ЭлектроПрофи»', scope: 'электромонтаж', until: '31.10' } },
      works: [
        { id: 'w1', name: 'Подготовка стен', unit: 'м²', plan: 96, fact: 58 },
        { id: 'w2', name: 'Грунтование', unit: 'м²', plan: 96, fact: 24 },
        { id: 'w3', name: 'Монтаж перегородок', unit: 'м²', plan: 18, fact: 18 },
      ],
      crew: [
        { id: 'k1', name: 'Иван Петров', role: 'отделочник', account: false },
        { id: 'k2', name: 'Олег Смирнов', role: 'отделочник', account: false },
        { id: 'k3', name: 'Роман Сергеев', role: 'маляр', account: false },
        { id: 'k4', name: 'Денис Волков', role: 'разнорабочий', account: false },
      ],
      materials: [{ id: 'mt1', name: 'Грунтовка', unit: 'л', qty: 30 }, { id: 'mt2', name: 'Шпаклёвка', unit: 'кг', qty: 120 }],
      logs: [
        { id: 'WL-11', at: '30.09', work: 'w1', volume: 22, crew: ['k1', 'k2'], materials: [['mt2', 40]], photos: 3, status: 'Принят', by: 'Алексей Соколов' },
      ],
    },
  };
}
