// Демонстрационные данные. Все имена, номера и суммы вымышлены.
import { extraSeed } from './extra-data.js';
export function seed() {
  const s = { ...baseSeed(), ...extraSeed() };
  fillAccounts(s.platform);
  seedBrands(s.platform);
  return s;
}
// Оформление организаций. Хранится в control DB: нужно до входа и оператору (docs/18-branding.md).
export const BRAND_DEFAULT = { short: '', accent: '#1F6B52', logo: null, mark: null, terms: {}, items: {}, order: [], poweredBy: true, version: 1, updatedAt: null, updatedBy: null };
function seedBrands(P) {
  const B = {
    't-alta': { short: '' },
    't-lotos': { short: 'Лотос', accent: '#7A3E79', terms: { visit: { one: 'сеанс', plural: 'сеансы', few: 'сеанса', many: 'сеансов' } }, version: 3, updatedAt: '24.09 12:10', updatedBy: 'Ирина Белова' },
    't-remstroy': { short: 'Ремстрой', accent: '#9A4A1F' },
    't-cargo': { short: 'Карго', accent: '#2B5479', poweredBy: false, version: 2, updatedAt: '02.06 09:40', updatedBy: 'Денис Шишкин' },
  };
  P.tenants.forEach((t) => { t.brand = { ...BRAND_DEFAULT, name: t.name, ...(B[t.id] || {}) }; });
}
// Добираем аккаунты других организаций до числа занятых мест, чтобы каталог оператора был правдоподобным.
function fillAccounts(P) {
  const MF = ['Андрей', 'Максим', 'Роман', 'Егор', 'Никита', 'Артём', 'Глеб', 'Фёдор', 'Олег', 'Виктор', 'Руслан'];
  const ML = ['Ершов', 'Лебедев', 'Карпов', 'Никитин', 'Фролов', 'Зайцев', 'Медведев', 'Тихонов', 'Субботин', 'Голубев', 'Данилов', 'Комаров', 'Белоусов'];
  const FF = ['Елена', 'Ольга', 'Юлия', 'Ксения', 'Наталья', 'Алина', 'Светлана', 'Полина', 'Яна', 'Татьяна'];
  const DOM = { 't-lotos': 'lotos-spa.example', 't-remstroy': 'remstroy.example', 't-cargo': 'cargo.example' };
  let k = 0;
  P.tenants.forEach((t) => {
    if (!DOM[t.id]) return;
    const have = P.accounts.filter((a) => a.memberships.some((m) => m.tenantId === t.id && ['active', 'invited'].includes(m.status))).length;
    for (let i = have; i < t.seatsUsed; i++, k++) {
      const female = k % 2 === 1;
      const name = (female ? FF[k % FF.length] : MF[k % MF.length]) + ' ' + ML[(k * 5) % ML.length] + (female ? 'а' : '');
      const day = t.status === 'suspended' ? '1' + (1 + (k % 7)) + '.09 ' : (k % 4 === 0 ? '30.09 ' : '01.10 ');
      P.accounts.push({ id: 'acc-g' + k, name, email: 'staff' + (i + 1) + '@' + DOM[t.id], status: 'active', mfa: k % 3 === 0,
        lastLogin: day + String(8 + (k % 10)).padStart(2, '0') + ':' + String((k * 7) % 60).padStart(2, '0'),
        memberships: [{ tenantId: t.id, status: 'active' }] });
    }
  });
}
// Вторая организация с собственной «БД»: SPA «Лотос». Общая только платформа (control DB).
// ID участников намеренно совпадают с «Альтой» (m-owner, m-morozova): идентификаторы живут внутри своей БД.
export function seedLotos(platform) {
  const s = { ...baseSeed(), ...extraSeed() };
  const TITLES = ['Массажист', 'Массажист', 'Косметолог', 'Администратор'];
  const staff = platform.accounts.filter((a) => a.memberships.some((m) => m.tenantId === 't-lotos') && !['acc-11', 'acc-4'].includes(a.id))
    .map((a, i) => ({ id: 'm-l' + (i + 1), name: a.name, email: a.email, status: 'active', title: TITLES[i % 4], firm: i % 2 ? 'f-lotos-arb' : 'f-lotos-tver' }));
  const members = [
    { id: 'm-owner', name: 'Ирина Белова', email: 'owner@lotos-spa.example', status: 'active', title: 'Владелец' },
    { id: 'm-morozova', name: 'Анна Морозова', email: 'a.morozova@alta.example', status: 'active', title: 'Массажист · Тверская' },
    ...staff.map(({ firm, ...m }) => m),
  ];
  const vehRes = new Set((s.calendar.resources || []).filter((r) => r.kind === 'vehicle').map((r) => r.id));
  const calendar = Object.fromEntries(Object.entries(s.calendar).map(([k, v]) => [k, Array.isArray(v) ? v.filter((x) => !vehRes.has(x.id) && !Object.values(x).some((y) => vehRes.has(y))) : v]));
  const knowledge = { ...s.knowledge, spaces: s.knowledge.spaces.filter((x) => x.id === 'sp-spa'), pages: s.knowledge.pages.filter((p) => !p.space || p.space === 'sp-spa') };
  return {
    ...s, tenantId: 't-lotos', seq: 500, calendar, knowledge,
    units: [{ id: 'r-msk', type: 'region', name: 'Москва' }, { id: 'f-lotos-tver', type: 'firm', parent: 'r-msk', name: 'Лотос · Тверская' }, { id: 'f-lotos-arb', type: 'firm', parent: 'r-msk', name: 'Лотос · Арбат' }],
    modules: { logistics: { enabled: false }, spa: { enabled: true }, repair: { enabled: false } },
    storage: { breakdown: [['Фото работ и техкарты', 6.2], ['Документы', 3.9], ['Вложения задач и форм', 1.6], ['Прочее', 0.7]] },
    members,
    groups: [{ id: 'g-tver', name: 'Мастера Тверская', members: ['m-morozova', ...staff.filter((x) => x.firm === 'f-lotos-tver' && x.title !== 'Администратор').map((x) => x.id)] }],
    roles: [
      s.roles.find((r) => r.id === 'r-owner'),
      s.roles.find((r) => r.id === 'r-therapist'),
      { id: 'r-admin', name: 'Администратор салона', kind: 'custom', actions: { spa: ['view', 'create', 'edit', 'review'], calendar: ['view', 'create', 'edit'], tasks: ['view', 'create', 'edit'], knowledge: ['view'], files: ['view', 'create'] }, finance: { read: false, manage: false } },
    ],
    assignments: [
      { id: 'la1', member: 'm-owner', role: 'r-owner', scope: { type: 'tenant' } },
      { id: 'la2', member: 'm-morozova', role: 'r-therapist', scope: { type: 'self' } },
      ...staff.map((x, i) => (x.title === 'Администратор' ? { id: 'lb' + i, member: x.id, role: 'r-admin', scope: { type: 'firm', id: x.firm } } : { id: 'lb' + i, member: x.id, role: 'r-therapist', scope: { type: 'self' } })),
    ],
    vehicles: [], trips: [], earnings: [], events: [], pool: { drivers: [], requests: [] }, forms: [], responses: [],
    tasks: [
      { id: 'T-7', title: 'Заказать масло для массажа', assignee: 'Ирина Белова', status: 'В работе', priority: 'normal', due: '03.10', project: 'salon', checklist: [], comments: [], links: [] },
      { id: 'T-8', title: 'График мастеров на ноябрь', assignee: 'Ирина Белова', status: 'Новая', priority: 'high', due: '10.10', project: 'salon', checklist: [], comments: [], links: [] },
    ],
    projects: [{ id: 'salon', key: 'SPA', name: 'Салон · Тверская', unit: 'f-lotos-tver', owner: 'Ирина Белова' }],
    cash: { ...s.cash, accounts: [{ id: 'ca-lotos', name: 'Касса «Лотос»', unit: 'spa' }], ops: [] },
  };
}
function baseSeed() {
  const firms = [
    ['f-msk-sever', 'r-msk', 'Север Логистик'], ['f-msk-yug', 'r-msk', 'Юг Транс'], ['f-msk-vostok', 'r-msk', 'Восток Карго'], ['f-msk-centr', 'r-msk', 'Центр Экспресс'],
    ['f-smr-volga', 'r-smr', 'Волга Логистик'], ['f-smr-truck', 'r-smr', 'Самара Трак'], ['f-smr-zhig', 'r-smr', 'Жигули Карго'], ['f-smr-priv', 'r-smr', 'Приволжье Сервис'],
    ['f-spb-neva', 'r-spb', 'Нева Логистик'], ['f-spb-baltic', 'r-spb', 'Балтик Транс'], ['f-spb-ohta', 'r-spb', 'Охта Карго'], ['f-spb-pulk', 'r-spb', 'Пулково Экспресс'],
  ];
  return {
    tenantId: 't-alta',
    seq: 100,
    platform: {
      tenants: [
        { id: 't-alta', name: 'Альта Групп', owner: 'Дарья Зимина', status: 'trial', trialEnds: '13.10.2026', trialDaysLeft: 12, quotaGb: 100, usedGb: 46.2, members: 10, modules: ['spa'], plan: { tier: 'start', term: 1, paidUntil: null, version: 2 }, seatsLimit: 10, seatsUsed: 9 },
        { id: 't-lotos', name: 'SPA «Лотос»', owner: 'Ирина Белова', status: 'active', trialEnds: null, trialDaysLeft: null, quotaGb: 50, usedGb: 12.4, members: 23, modules: ['spa'], plan: { tier: 'team', term: 12, paidUntil: '31.03.2027', version: 1 }, seatsLimit: 25, seatsUsed: 23 },
        { id: 't-remstroy', name: 'Ремстрой Плюс', owner: 'Павел Орлов', status: 'restricted', trialEnds: '20.09.2026', trialDaysLeft: 0, quotaGb: 25, usedGb: 19.8, members: 5, modules: ['repair'], plan: { tier: 'start', term: 1, paidUntil: null, version: 1 }, seatsLimit: 10, seatsUsed: 5 },
        { id: 't-cargo', name: 'Карго Сити', owner: 'Денис Шишкин', status: 'suspended', trialEnds: null, trialDaysLeft: null, quotaGb: 100, usedGb: 63.0, members: 22, modules: ['logistics'], plan: { tier: 'team', term: 4, paidUntil: '15.09.2026', version: 1 }, seatsLimit: 25, seatsUsed: 22 },
      ],
      // Тарифная сетка: цены — пример для макета, не согласованный тариф.
      priceBook: {
        current: 2,
        versions: [
          { v: 1, from: '01.06.2026', to: '30.09.2026', note: 'Стартовая сетка пилота', by: 'Е. Лаптева',
            tiers: [{ id: 'start', name: 'Старт', seats: 10, month: 3500 }, { id: 'team', name: 'Команда', seats: 25, month: 8500 }, { id: 'biz', name: 'Бизнес', seats: 50, month: 14900 }, { id: 'unl', name: 'Безлимит', seats: null, month: null }],
            terms: [{ months: 1, off: 0 }, { months: 4, off: 5 }, { months: 8, off: 10 }, { months: 12, off: 20 }] },
          { v: 2, from: '01.10.2026', to: null, note: 'Добавлена ступень «Сеть» до 100 мест, пересчитаны цены', by: 'Е. Лаптева',
            tiers: [{ id: 'start', name: 'Старт', seats: 10, month: 3900 }, { id: 'team', name: 'Команда', seats: 25, month: 8900 }, { id: 'biz', name: 'Бизнес', seats: 50, month: 15900 }, { id: 'net', name: 'Сеть', seats: 100, month: 27900 }, { id: 'unl', name: 'Безлимит', seats: null, month: null }],
            terms: [{ months: 1, off: 0 }, { months: 4, off: 5 }, { months: 8, off: 10 }, { months: 12, off: 20 }] },
        ],
      },
      requests: [
        { id: 'SR-12', tenantId: 't-lotos', from: 'team', to: 'biz', term: 12, used: 23, by: 'Ирина Белова', at: '29.09 16:40', status: 'pending', comment: 'Открываем второй салон, нужно ещё 10–12 мест' },
        { id: 'SR-9', tenantId: 't-cargo', from: 'start', to: 'team', term: 4, used: 10, by: 'Денис Шишкин', at: '12.05 11:02', status: 'approved', comment: '', decidedBy: 'Е. Лаптева', decidedAt: '12.05 15:20', decision: 'Оплата по счёту получена' },
      ],
      // Общий каталог аккаунтов: оператор видит участие и вход, но не роли и не данные организаций.
      accounts: [
        { id: 'acc-1', name: 'Дарья Зимина', email: 'd.zimina@alta.example', status: 'active', mfa: true, lastLogin: '01.10 09:12', memberships: [{ tenantId: 't-alta', status: 'active', owner: true }] },
        { id: 'acc-2', name: 'Марина Котова', email: 'm.kotova@alta.example', status: 'active', mfa: true, lastLogin: '01.10 08:40', memberships: [{ tenantId: 't-alta', status: 'active' }, { tenantId: 't-cargo', status: 'ended' }] },
        { id: 'acc-3', name: 'Илья Васильев', email: 'i.vasiliev@alta.example', status: 'active', mfa: false, lastLogin: '01.10 07:55', memberships: [{ tenantId: 't-alta', status: 'active' }] },
        { id: 'acc-4', name: 'Анна Морозова', email: 'a.morozova@alta.example', status: 'active', mfa: false, lastLogin: '30.09 19:05', memberships: [{ tenantId: 't-alta', status: 'active' }, { tenantId: 't-lotos', status: 'active' }] },
        { id: 'acc-5', name: 'Алексей Соколов', email: 'a.sokolov@alta.example', status: 'active', mfa: false, lastLogin: '30.09 17:30', memberships: [{ tenantId: 't-alta', status: 'active' }, { tenantId: 't-remstroy', status: 'active' }] },
        { id: 'acc-6', name: 'Олеся Петрова', email: 'o.petrova@alta.example', status: 'pending', mfa: false, lastLogin: null, memberships: [{ tenantId: 't-alta', status: 'invited' }] },
        { id: 'acc-7', name: 'Кирилл Громов', email: 'k.gromov@alta.example', status: 'active', mfa: false, lastLogin: '14.09 08:02', memberships: [{ tenantId: 't-alta', status: 'suspended' }] },
        { id: 'acc-8', name: 'Вера Котельникова', email: 'v.kotelnikova@alta.example', status: 'active', mfa: true, lastLogin: '01.10 08:58', memberships: [{ tenantId: 't-alta', status: 'active' }] },
        { id: 'acc-9', name: 'Тимур Ахмедов', email: 't.akhmedov@alta.example', status: 'active', mfa: false, lastLogin: '01.10 06:47', memberships: [{ tenantId: 't-alta', status: 'active' }] },
        { id: 'acc-10', name: 'Сергей Ильин', email: 's.ilyin@alta.example', status: 'pending', mfa: false, lastLogin: null, memberships: [{ tenantId: 't-alta', status: 'invited' }] },
        { id: 'acc-11', name: 'Ирина Белова', email: 'owner@lotos-spa.example', status: 'active', mfa: true, lastLogin: '01.10 10:01', memberships: [{ tenantId: 't-lotos', status: 'active', owner: true }] },
        { id: 'acc-12', name: 'Павел Орлов', email: 'p.orlov@remstroy.example', status: 'active', mfa: false, lastLogin: '20.09 12:44', memberships: [{ tenantId: 't-remstroy', status: 'active', owner: true }] },
        { id: 'acc-13', name: 'Денис Шишкин', email: 'd.shishkin@cargo.example', status: 'locked', mfa: true, lastLogin: '18.09 23:51', lockReason: 'Подозрительные входы из разных стран, 18.09', memberships: [{ tenantId: 't-cargo', status: 'active', owner: true }] },
      ],
      // Системная организация платформы: операторы в отдельном realm ortus-operators, не пересекаются с аккаунтами клиентов.
      operators: [
        { id: 'op-1', name: 'Евгения Лаптева', email: 'e.lapteva@ortus.example', role: 'owner', status: 'active', mfa: 'аппаратный ключ', lastLogin: '02.10 09:05', me: true },
        { id: 'op-2', name: 'Михаил Сорокин', email: 'm.sorokin@ortus.example', role: 'owner', status: 'active', mfa: 'приложение', lastLogin: '01.10 18:22' },
        { id: 'op-3', name: 'Алёна Гусева', email: 'a.guseva@ortus.example', role: 'billing', status: 'active', mfa: 'приложение', lastLogin: '02.10 08:40' },
        { id: 'op-4', name: 'Игорь Пахомов', email: 'i.pakhomov@ortus.example', role: 'support', status: 'active', mfa: 'приложение', lastLogin: '02.10 07:58' },
        { id: 'op-5', name: 'Дина Валиева', email: 'd.valieva@ortus.example', role: 'support', status: 'invited', mfa: null, lastLogin: null },
        { id: 'op-6', name: 'Станислав Рябов', email: 's.ryabov@ortus.example', role: 'admin', status: 'disabled', mfa: 'приложение', lastLogin: '12.08 17:10', disabledNote: 'Отключён 15.08: перевод в другой отдел' },
      ],
      audit: [
        { at: '30.09 18:12', text: 'Альта Групп: открыт пробный период на 14 дней, квота 100 ГБ', by: 'Е. Лаптева' },
        { at: '21.09 09:00', text: 'Ремстрой Плюс: пробный период завершён, новые операции ограничены', by: 'Система' },
      ],
    },
    units: [
      { id: 'r-msk', type: 'region', name: 'Москва' }, { id: 'r-smr', type: 'region', name: 'Самара' }, { id: 'r-spb', type: 'region', name: 'Санкт-Петербург' },
      ...firms.map(([id, parent, name]) => ({ id, type: 'firm', parent, name })),
    ],
    modules: { logistics: { enabled: false }, spa: { enabled: true }, repair: { enabled: false } },
    storage: {
      breakdown: [['Фото осмотров и отчётов', 31.4], ['Документы', 9.8], ['Вложения задач и форм', 3.1], ['Прочее', 1.9]],
    },
    members: [
      { id: 'm-owner', name: 'Дарья Зимина', email: 'd.zimina@alta.example', status: 'active', title: 'Владелец' },
      { id: 'm-kotova', name: 'Марина Котова', email: 'm.kotova@alta.example', status: 'active', title: 'Логист' },
      { id: 'm-vasiliev', name: 'Илья Васильев', email: 'i.vasiliev@alta.example', status: 'active', title: 'Водитель', function: 'driver' },
      { id: 'm-morozova', name: 'Анна Морозова', email: 'a.morozova@alta.example', status: 'active', title: 'Массажист' },
      { id: 'm-sokolov', name: 'Алексей Соколов', email: 'a.sokolov@alta.example', status: 'active', title: 'Прораб' },
      { id: 'm-petrova', name: 'Олеся Петрова', email: 'o.petrova@alta.example', status: 'invited', title: 'Диспетчер', invitedNote: 'Приглашение до 06.10' },
      { id: 'm-gromov', name: 'Кирилл Громов', email: 'k.gromov@alta.example', status: 'blocked', title: 'Водитель', function: 'driver' },
      { id: 'm-kotelnikova', name: 'Вера Котельникова', email: 'v.kotelnikova@alta.example', status: 'active', title: 'Диспетчер · Самара' },
      { id: 'm-akhmedov', name: 'Тимур Ахмедов', email: 't.akhmedov@alta.example', status: 'active', title: 'Водитель', function: 'driver' },
      { id: 'm-ilyin', name: 'Сергей Ильин', email: 's.ilyin@alta.example', status: 'invited', title: 'Бухгалтер', invitedNote: 'Приглашение до 07.10' },
    ],
    groups: [
      { id: 'g-disp', name: 'Диспетчеры Север', members: ['m-kotova', 'm-petrova'] },
      { id: 'g-drv', name: 'Водители Север', members: ['m-vasiliev', 'm-gromov'] },
    ],
    roles: [
      { id: 'r-owner', name: 'Владелец бизнеса', kind: 'system', all: true, actions: {}, finance: { read: true, manage: true } },
      { id: 'r-manager', name: 'Менеджер логистики', kind: 'template', actions: { logistics: ['view', 'create', 'edit', 'review', 'export'], calendar: ['view', 'create', 'edit'], tasks: ['view', 'create', 'edit'], forms: ['view', 'review'], data: ['view', 'export'], files: ['view'], knowledge: ['view'] }, finance: { read: true, manage: false } },
      { id: 'r-driver', name: 'Водитель', kind: 'template', professional: 'driver', actions: { logistics: ['view', 'create'], forms: ['view', 'create'], calendar: ['view'], files: ['create'], knowledge: ['view'] }, finance: { read: false, manage: false } },
      { id: 'r-therapist', name: 'Массажист', kind: 'template', actions: { spa: ['view', 'create'], calendar: ['view', 'edit'], knowledge: ['view'] }, finance: { read: false, manage: false } },
      { id: 'r-foreman', name: 'Прораб', kind: 'template', actions: { repair: ['view', 'create'], tasks: ['view', 'create'], files: ['create'], knowledge: ['view'] }, finance: { read: false, manage: false } },
    ],
    assignments: [
      { id: 'a1', member: 'm-owner', role: 'r-owner', scope: { type: 'tenant' } },
      { id: 'a2', member: 'm-vasiliev', role: 'r-driver', scope: { type: 'firm', id: 'f-msk-sever' }, via: 'группа «Водители Север»' },
      { id: 'a3', member: 'm-morozova', role: 'r-therapist', scope: { type: 'self' } },
      { id: 'a4', member: 'm-sokolov', role: 'r-foreman', scope: { type: 'self' } },
    ],
    vehicles: [
      { id: 'v1', unit: 'f-msk-sever', model: 'ГАЗель Next', plate: 'А 412 МР 77', body: 'Тент', payloadT: 1.5, volumeM3: 16, lengthM: 4.2, temp: null, odometer: 84370, state: 'free', depot: 'Склад № 1' },
      { id: 'v6', unit: 'f-msk-sever', model: 'Mercedes Sprinter', plate: 'Т 771 ЕХ 77', body: 'Фургон', payloadT: 1.6, volumeM3: 14, lengthM: 4.3, temp: null, odometer: 120544, state: 'free', depot: 'Склад № 1' },
      { id: 'v2', unit: 'f-msk-sever', model: 'Ford Transit', plate: 'М 608 КТ 77', body: 'Рефрижератор', payloadT: 1.2, volumeM3: 11, lengthM: 3.4, temp: [-18, 8], odometer: 61210, state: 'free', depot: 'Склад № 1' },
      { id: 'v3', unit: 'f-msk-sever', model: 'Hyundai Porter', plate: 'В 233 ОС 77', body: 'Тент', payloadT: 0.9, volumeM3: 9, lengthM: 3.1, temp: null, odometer: 152003, state: 'free', depot: 'Склад № 2' },
      { id: 'v4', unit: 'f-msk-sever', model: 'ГАЗон Next', plate: 'Е 905 НА 77', body: 'Фургон', payloadT: 4.5, volumeM3: 30, lengthM: 5.1, temp: null, odometer: 40112, state: 'unavailable', note: 'Плановое ТО до 03.10', depot: 'Склад № 2' },
      { id: 'v5', unit: 'f-msk-yug', model: 'Isuzu Elf', plate: 'К 120 РУ 77', body: 'Фургон', payloadT: 3.0, volumeM3: 20, lengthM: 4.4, temp: null, odometer: 98320, state: 'free', depot: 'Юг · база' },
      { id: 'v7', unit: 'f-smr-volga', model: 'ГАЗель Бизнес', plate: 'О 318 ХС 163', body: 'Тент', payloadT: 1.5, volumeM3: 14, lengthM: 3.1, temp: null, odometer: 201450, state: 'on_route', depot: 'Самара · склад' },
    ],
    trips: [
      {
        id: 'Р-208', unit: 'f-msk-sever', title: 'Северный маршрут', date: '01.10.2026', window: '09:00–13:00', distanceKm: 46,
        driverId: 'm-vasiliev', driverName: 'Илья Васильев', vehicleId: null, status: 'planned', earnings: 4500,
        cargo: { weightT: 1.1, volumeM3: 12, lengthM: 3.0, temp: null, kind: 'Сухой груз · 14 паллет-мест' },
        stops: [
          { time: '09:00', name: 'Склад № 1, Лобня', op: 'load', w: 1.1, v: 12 },
          { time: '10:15', name: 'Химки, ул. Заводская, 8', op: 'unload', w: 0.7, v: 8 },
          { time: '11:30', name: 'Долгопрудный, Лихачёвский пр., 4', op: 'unload', w: 0.4, v: 4 },
        ],
        dep: null, ret: null, expenses: [], review: null, defect: null,
      },
      {
        id: 'Р-211', unit: 'f-msk-sever', title: 'Охлаждённая продукция', date: '01.10.2026', window: '14:00–18:00', distanceKm: 31,
        driverId: null, driverName: null, vehicleId: null, status: 'planned', earnings: 3800,
        cargo: { weightT: 0.6, volumeM3: 7, lengthM: 2.4, temp: [2, 6], kind: 'Молочная продукция · +2…+6 °C' },
        stops: [
          { time: '14:00', name: 'Склад № 1, Лобня', op: 'load', w: 0.6, v: 7 },
          { time: '15:10', name: 'Мытищи, ул. Колпакова, 2', op: 'unload', w: 0.35, v: 4 },
          { time: '16:20', name: 'Королёв, пр. Космонавтов, 20', op: 'unload', w: 0.25, v: 3 },
        ],
        dep: null, ret: null, expenses: [], review: null, defect: null,
      },
    ],
    pool: {
      drivers: [
        { id: 'd-104', code: 'Водитель #104', qual: 'Кат. C · рефрижератор', home: 'Юг Транс', unit: 'f-msk-yug', window: '13:00–19:00', terms: 'По соглашению фирм группы' },
        { id: 'd-117', code: 'Водитель #117', qual: 'Кат. B', home: 'Восток Карго', unit: 'f-msk-vostok', window: '15:00–20:00', terms: 'По соглашению фирм группы' },
      ],
      requests: [],
    },
    earnings: [],
    events: [],
    forms: [
      {
        id: 'fm-insp', name: 'Осмотр машины', module: 'logistics', owner: 'Дарья Зимина', status: 'published', published: 3,
        versions: [
          { v: 1, at: '02.09.2026', by: 'Дарья Зимина', fields: [
            { id: 'q-photos', label: 'Фото: спереди, сзади, слева, справа', type: 'photo', required: true, section: 'Фото' },
            { id: 'q-odo', label: 'Пробег', type: 'number', required: true, section: 'Показания' },
            { id: 'q-fuel-t', label: 'Уровень топлива', type: 'text', required: false, section: 'Показания' },
          ] },
          { v: 2, at: '10.09.2026', by: 'Дарья Зимина', fields: [
            { id: 'q-photos', label: 'Фото: спереди, сзади, слева, справа, одометр', type: 'photo', required: true, section: 'Фото' },
            { id: 'q-odo', label: 'Пробег по одометру, км', type: 'number', required: true, section: 'Показания' },
            { id: 'q-fuel-t', label: 'Уровень топлива', type: 'text', required: false, section: 'Показания' },
            { id: 'q-checks', label: 'Чек-лист: кузов, шины, документы', type: 'multi', required: true, section: 'Проверка' },
          ] },
          { v: 3, at: '24.09.2026', by: 'Дарья Зимина', fields: [
            { id: 'q-photos', label: 'Фото: спереди, сзади, слева, справа, одометр', type: 'photo', required: true, section: 'Фото' },
            { id: 'q-odo', label: 'Пробег по одометру, км', type: 'number', required: true, section: 'Показания' },
            { id: 'q-fuel', label: 'Уровень топлива', type: 'choice', required: true, section: 'Показания', options: ['¼', '½', '¾', 'Полный'] },
            { id: 'q-checks', label: 'Чек-лист: кузов, шины, документы', type: 'multi', required: true, section: 'Проверка' },
            { id: 'q-defect', label: 'Есть дефекты?', type: 'bool', required: true, section: 'Дефекты' },
            { id: 'q-defect-text', label: 'Описание дефекта', type: 'text', required: true, section: 'Дефекты', showIf: { field: 'q-defect', eq: 'да' } },
            { id: 'q-critical', label: 'Дефект критический', type: 'bool', required: false, section: 'Дефекты', showIf: { field: 'q-defect', eq: 'да' } },
          ] },
        ],
        automations: [{ id: 'au-1', text: 'Ответ принят → задача менеджеру «Проверить осмотр»', version: 1, on: true }],
      },
      {
        id: 'fm-foreman', name: 'Ежедневный отчёт прораба', module: 'repair', owner: 'Дарья Зимина', status: 'draft', published: null,
        versions: [], automations: [],
        draft: [
          { id: 'q-volume', label: 'Выполненный объём, м²', type: 'number', required: true, section: 'Работы' },
          { id: 'q-crew', label: 'Явка бригады', type: 'multi', required: true, section: 'Работы' },
          { id: 'q-photo', label: 'Фотоотчёт', type: 'photo', required: true, section: 'Фото' },
        ],
      },
    ],
    responses: [
      { id: 'R-0988', formId: 'fm-insp', version: 2, at: '18.09 08:41', author: 'Кирилл Громов', object: 'Рейс Р-171', status: 'Принят', values: { 'q-photos': '5 фото', 'q-odo': '83 902', 'q-fuel-t': 'почти полный', 'q-checks': 'кузов, шины, документы' } },
      { id: 'R-1012', formId: 'fm-insp', version: 3, at: '27.09 09:05', author: 'Илья Васильев', object: 'Рейс Р-196', status: 'Принят', values: { 'q-photos': '5 фото', 'q-odo': '84 210', 'q-fuel': '¾', 'q-checks': 'кузов, шины, документы', 'q-defect': 'нет' } },
    ],
    tasks: [
      { id: 'T-61', title: 'Проверить осмотр Р-196', assignee: 'Марина Котова', status: 'Готово', source: 'R-1012', rule: 'au-1 · v1', priority: 'normal', due: '27.09', project: 'fleet', checklist: [{ t: 'Сверить фото с прошлым осмотром', d: true }, { t: 'Проверить пробег', d: true }], comments: [{ by: 'Марина Котова', at: '27.09 10:12', text: 'Замечаний нет.' }], links: [{ kind: 'response', id: 'R-1012', label: 'Ответ R-1012' }, { kind: 'trip', id: 'Р-196', label: 'Рейс Р-196' }] },
      { id: 'T-58', title: 'Записать ГАЗон Next на плановое ТО', assignee: 'Марина Котова', status: 'В работе', priority: 'high', due: '02.10', project: 'fleet', checklist: [{ t: 'Согласовать дату с сервисом', d: true }, { t: 'Перенести рейсы на другие машины', d: false }, { t: 'Отметить недоступность в календаре', d: false }], comments: [], links: [{ kind: 'vehicle', id: 'v4', label: 'ГАЗон Next Е 905 НА 77' }] },
      { id: 'T-63', title: 'Обновить регламент приёмки смены', assignee: 'Дарья Зимина', status: 'На проверке', priority: 'normal', due: '03.10', project: 'fleet', checklist: [{ t: 'Добавить фото одометра', d: true }], comments: [{ by: 'Дарья Зимина', at: '30.09 17:40', text: 'Передаю на проверку Марине.' }], links: [{ kind: 'form', id: 'fm-insp', label: 'Форма «Осмотр машины»' }] },
      { id: 'L-31', title: 'Квартира 64 м², Химки', assignee: 'Дарья Зимина', status: 'Новая', priority: 'high', due: '03.10', project: 'leads', lead: { client: 'Пётр Фомин', source: 'Сайт', sum: null }, checklist: [{ t: 'Перезвонить и назначить замер', d: false }], comments: [], links: [] },
      { id: 'L-29', title: 'Дом 120 м², Истра', assignee: 'Алексей Соколов', status: 'Замер', priority: 'normal', due: '22.10', project: 'leads', lead: { client: 'Сергей Ветров', source: 'Рекомендация', sum: null }, checklist: [{ t: 'Замер 22.10 в 11:00', d: false }], comments: [], links: [] },
      { id: 'L-27', title: 'Квартира 51 м², Люберцы', assignee: 'Дарья Зимина', status: 'Смета', priority: 'normal', due: '10.10', project: 'leads', lead: { client: 'Мария Кравец', source: 'Авито', sum: 980000 }, checklist: [], comments: [], links: [] },
      { id: 'L-24', title: 'Офис 90 м², Сокол', assignee: 'Дарья Зимина', status: 'Договор', priority: 'high', due: '05.10', project: 'leads', lead: { client: 'ООО «Вектор»', source: 'Сайт', sum: 1640000 }, checklist: [], comments: [], links: [] },
      { id: 'L-18', title: 'ЖК Речной · квартира 42', assignee: 'Алексей Соколов', status: 'Объект', priority: 'normal', due: '01.10', project: 'leads', lead: { client: 'Ольга Смирнова', source: 'Сайт', sum: 1186000 }, checklist: [], comments: [], links: [] },
      { id: 'T-64', title: 'Найти водителя на рейс Р-211', assignee: 'Марина Котова', status: 'Новая', priority: 'urgent', due: '01.10', project: 'fleet', checklist: [], comments: [], links: [{ kind: 'trip', id: 'Р-211', label: 'Рейс Р-211' }] },
    ],
    projects: [{ id: 'fleet', key: 'LOG', name: 'Логистика · Север', unit: 'f-msk-sever', owner: 'Марина Котова' }, { id: 'leads', key: 'ЗАЯ', name: 'Заявки · Ремонт', flow: 'leads', unit: 'f-msk-sever', owner: 'Дарья Зимина' }],
  };
}
