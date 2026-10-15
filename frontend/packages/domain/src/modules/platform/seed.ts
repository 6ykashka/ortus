// Сид control DB (mock-data.js 14.10:9–39, 92–144). Имена, номера и суммы вымышлены;
// цены тарифной сетки — пример для макета, не согласованный тариф.
import { BRAND_DEFAULT } from './dictionaries.ts';
import type { Account, Brand, Platform, PriceVersion, Tenant, Term } from './types.ts';

const TERMS = (): Term[] => [
  { months: 1, off: 0 },
  { months: 4, off: 5 },
  { months: 8, off: 10 },
  { months: 12, off: 20 },
];

const tenants = (): Tenant[] => [
  {
    id: 't-alta',
    name: 'Альта Групп',
    owner: 'Дарья Зимина',
    status: 'trial',
    trialEnds: '13.10.2026',
    trialDaysLeft: 12,
    quotaGb: 100,
    usedGb: 46.2,
    members: 10,
    modules: ['spa'],
    plan: { tier: 'start', term: 1, paidUntil: null, version: 2 },
    seatsLimit: 10,
    seatsUsed: 9,
  },
  {
    id: 't-lotos',
    name: 'SPA «Лотос»',
    owner: 'Ирина Белова',
    status: 'active',
    trialEnds: null,
    trialDaysLeft: null,
    quotaGb: 50,
    usedGb: 12.4,
    members: 23,
    modules: ['spa'],
    plan: { tier: 'team', term: 12, paidUntil: '31.03.2027', version: 1 },
    seatsLimit: 25,
    seatsUsed: 23,
  },
  {
    id: 't-remstroy',
    name: 'Ремстрой Плюс',
    owner: 'Павел Орлов',
    status: 'restricted',
    trialEnds: '20.09.2026',
    trialDaysLeft: 0,
    quotaGb: 25,
    usedGb: 19.8,
    members: 5,
    modules: ['repair'],
    plan: { tier: 'start', term: 1, paidUntil: null, version: 1 },
    seatsLimit: 10,
    seatsUsed: 5,
  },
  {
    id: 't-cargo',
    name: 'Карго Сити',
    owner: 'Денис Шишкин',
    status: 'suspended',
    trialEnds: null,
    trialDaysLeft: null,
    quotaGb: 100,
    usedGb: 63.0,
    members: 22,
    modules: ['logistics'],
    plan: { tier: 'team', term: 4, paidUntil: '15.09.2026', version: 1 },
    seatsLimit: 25,
    seatsUsed: 22,
  },
];

const priceVersions = (): PriceVersion[] => [
  {
    v: 1,
    from: '01.06.2026',
    to: '30.09.2026',
    note: 'Стартовая сетка пилота',
    by: 'Е. Лаптева',
    tiers: [
      { id: 'start', name: 'Старт', seats: 10, month: 3500 },
      { id: 'team', name: 'Команда', seats: 25, month: 8500 },
      { id: 'biz', name: 'Бизнес', seats: 50, month: 14900 },
      { id: 'unl', name: 'Безлимит', seats: null, month: null },
    ],
    terms: TERMS(),
  },
  {
    v: 2,
    from: '01.10.2026',
    to: null,
    note: 'Добавлена ступень «Сеть» до 100 мест, пересчитаны цены',
    by: 'Е. Лаптева',
    tiers: [
      { id: 'start', name: 'Старт', seats: 10, month: 3900 },
      { id: 'team', name: 'Команда', seats: 25, month: 8900 },
      { id: 'biz', name: 'Бизнес', seats: 50, month: 15900 },
      { id: 'net', name: 'Сеть', seats: 100, month: 27900 },
      { id: 'unl', name: 'Безлимит', seats: null, month: null },
    ],
    terms: TERMS(),
  },
];

type AccountRow = [
  id: string,
  name: string,
  email: string,
  status: Account['status'],
  mfa: boolean,
  lastLogin: string | null,
  memberships: Account['memberships'],
];

const ACCOUNTS: readonly AccountRow[] = [
  [
    'acc-1',
    'Дарья Зимина',
    'd.zimina@alta.example',
    'active',
    true,
    '01.10 09:12',
    [{ tenantId: 't-alta', status: 'active', owner: true }],
  ],
  [
    'acc-2',
    'Марина Котова',
    'm.kotova@alta.example',
    'active',
    true,
    '01.10 08:40',
    [
      { tenantId: 't-alta', status: 'active' },
      { tenantId: 't-cargo', status: 'ended' },
    ],
  ],
  [
    'acc-3',
    'Илья Васильев',
    'i.vasiliev@alta.example',
    'active',
    false,
    '01.10 07:55',
    [{ tenantId: 't-alta', status: 'active' }],
  ],
  [
    'acc-4',
    'Анна Морозова',
    'a.morozova@alta.example',
    'active',
    false,
    '30.09 19:05',
    [
      { tenantId: 't-alta', status: 'active' },
      { tenantId: 't-lotos', status: 'active' },
    ],
  ],
  [
    'acc-5',
    'Алексей Соколов',
    'a.sokolov@alta.example',
    'active',
    false,
    '30.09 17:30',
    [
      { tenantId: 't-alta', status: 'active' },
      { tenantId: 't-remstroy', status: 'active' },
    ],
  ],
  [
    'acc-6',
    'Олеся Петрова',
    'o.petrova@alta.example',
    'pending',
    false,
    null,
    [{ tenantId: 't-alta', status: 'invited' }],
  ],
  [
    'acc-7',
    'Кирилл Громов',
    'k.gromov@alta.example',
    'active',
    false,
    '14.09 08:02',
    [{ tenantId: 't-alta', status: 'suspended' }],
  ],
  [
    'acc-8',
    'Вера Котельникова',
    'v.kotelnikova@alta.example',
    'active',
    true,
    '01.10 08:58',
    [{ tenantId: 't-alta', status: 'active' }],
  ],
  [
    'acc-9',
    'Тимур Ахмедов',
    't.akhmedov@alta.example',
    'active',
    false,
    '01.10 06:47',
    [{ tenantId: 't-alta', status: 'active' }],
  ],
  [
    'acc-10',
    'Сергей Ильин',
    's.ilyin@alta.example',
    'pending',
    false,
    null,
    [{ tenantId: 't-alta', status: 'invited' }],
  ],
  [
    'acc-11',
    'Ирина Белова',
    'owner@lotos-spa.example',
    'active',
    true,
    '01.10 10:01',
    [{ tenantId: 't-lotos', status: 'active', owner: true }],
  ],
  [
    'acc-12',
    'Павел Орлов',
    'p.orlov@remstroy.example',
    'active',
    false,
    '20.09 12:44',
    [{ tenantId: 't-remstroy', status: 'active', owner: true }],
  ],
  [
    'acc-13',
    'Денис Шишкин',
    'd.shishkin@cargo.example',
    'locked',
    true,
    '18.09 23:51',
    [{ tenantId: 't-cargo', status: 'active', owner: true }],
  ],
];

const accounts = (): Account[] =>
  ACCOUNTS.map(([id, name, email, status, mfa, lastLogin, memberships]) => {
    const a: Account = { id, name, email, status, mfa, lastLogin, memberships: [] };
    if (id === 'acc-13') a.lockReason = 'Подозрительные входы из разных стран, 18.09';
    a.memberships = memberships.map((m) => ({ ...m }));
    return a;
  });

/** Control DB без добора аккаунтов и оформления (`baseSeed().platform`). */
export function platformSeed(): Platform {
  return {
    tenants: tenants(),
    priceBook: { current: 2, versions: priceVersions() },
    requests: [
      {
        id: 'SR-12',
        tenantId: 't-lotos',
        from: 'team',
        to: 'biz',
        term: 12,
        used: 23,
        by: 'Ирина Белова',
        at: '29.09 16:40',
        status: 'pending',
        comment: 'Открываем второй салон, нужно ещё 10–12 мест',
      },
      {
        id: 'SR-9',
        tenantId: 't-cargo',
        from: 'start',
        to: 'team',
        term: 4,
        used: 10,
        by: 'Денис Шишкин',
        at: '12.05 11:02',
        status: 'approved',
        comment: '',
        decidedBy: 'Е. Лаптева',
        decidedAt: '12.05 15:20',
        decision: 'Оплата по счёту получена',
      },
    ],
    accounts: accounts(),
    // Операторы — отдельный realm ortus-operators, с аккаунтами клиентов не пересекаются.
    operators: [
      {
        id: 'op-1',
        name: 'Евгения Лаптева',
        email: 'e.lapteva@ortus.example',
        role: 'owner',
        status: 'active',
        mfa: 'аппаратный ключ',
        lastLogin: '02.10 09:05',
        me: true,
      },
      {
        id: 'op-2',
        name: 'Михаил Сорокин',
        email: 'm.sorokin@ortus.example',
        role: 'owner',
        status: 'active',
        mfa: 'приложение',
        lastLogin: '01.10 18:22',
      },
      {
        id: 'op-3',
        name: 'Алёна Гусева',
        email: 'a.guseva@ortus.example',
        role: 'billing',
        status: 'active',
        mfa: 'приложение',
        lastLogin: '02.10 08:40',
      },
      {
        id: 'op-4',
        name: 'Игорь Пахомов',
        email: 'i.pakhomov@ortus.example',
        role: 'support',
        status: 'active',
        mfa: 'приложение',
        lastLogin: '02.10 07:58',
      },
      {
        id: 'op-5',
        name: 'Дина Валиева',
        email: 'd.valieva@ortus.example',
        role: 'support',
        status: 'invited',
        mfa: null,
        lastLogin: null,
      },
      {
        id: 'op-6',
        name: 'Станислав Рябов',
        email: 's.ryabov@ortus.example',
        role: 'admin',
        status: 'disabled',
        mfa: 'приложение',
        lastLogin: '12.08 17:10',
        disabledNote: 'Отключён 15.08: перевод в другой отдел',
      },
    ],
    audit: [
      {
        at: '30.09 18:12',
        text: 'Альта Групп: открыт пробный период на 14 дней, квота 100 ГБ',
        by: 'Е. Лаптева',
      },
      {
        at: '21.09 09:00',
        text: 'Ремстрой Плюс: пробный период завершён, новые операции ограничены',
        by: 'Система',
      },
    ],
  };
}

const MF = [
  'Андрей',
  'Максим',
  'Роман',
  'Егор',
  'Никита',
  'Артём',
  'Глеб',
  'Фёдор',
  'Олег',
  'Виктор',
  'Руслан',
];
const ML = [
  'Ершов',
  'Лебедев',
  'Карпов',
  'Никитин',
  'Фролов',
  'Зайцев',
  'Медведев',
  'Тихонов',
  'Субботин',
  'Голубев',
  'Данилов',
  'Комаров',
  'Белоусов',
];
const FF = [
  'Елена',
  'Ольга',
  'Юлия',
  'Ксения',
  'Наталья',
  'Алина',
  'Светлана',
  'Полина',
  'Яна',
  'Татьяна',
];
const DOMAIN: Readonly<Record<string, string>> = {
  't-lotos': 'lotos-spa.example',
  't-remstroy': 'remstroy.example',
  't-cargo': 'cargo.example',
};
const pick = (list: readonly string[], i: number): string => list[i % list.length] ?? '';
const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Добирает каталог аккаунтов до числа занятых мест других организаций, чтобы каталог оператора
 * был правдоподобным (`fillAccounts`, mock-data.js:21–39). Детерминирован: `acc-g<k>`.
 */
export function fillAccounts(P: Platform): void {
  let k = 0;
  for (const t of P.tenants) {
    const domain = DOMAIN[t.id];
    if (!domain) continue;
    const have = P.accounts.filter((a) =>
      a.memberships.some(
        (m) => m.tenantId === t.id && (m.status === 'active' || m.status === 'invited'),
      ),
    ).length;
    for (let i = have; i < t.seatsUsed; i++, k++) {
      const female = k % 2 === 1;
      const name =
        (female ? pick(FF, k) : pick(MF, k)) + ' ' + pick(ML, k * 5) + (female ? 'а' : '');
      const day =
        t.status === 'suspended' ? '1' + (1 + (k % 7)) + '.09 ' : k % 4 === 0 ? '30.09 ' : '01.10 ';
      P.accounts.push({
        id: 'acc-g' + k,
        name,
        email: 'staff' + (i + 1) + '@' + domain,
        status: 'active',
        mfa: k % 3 === 0,
        lastLogin: day + pad2(8 + (k % 10)) + ':' + pad2((k * 7) % 60),
        memberships: [{ tenantId: t.id, status: 'active' }],
      });
    }
  }
}

const BRANDS: Readonly<Record<string, Partial<Brand>>> = {
  't-alta': { short: '' },
  't-lotos': {
    short: 'Лотос',
    accent: '#7A3E79',
    terms: { visit: { one: 'сеанс', plural: 'сеансы', few: 'сеанса', many: 'сеансов' } },
    version: 3,
    updatedAt: '24.09 12:10',
    updatedBy: 'Ирина Белова',
  },
  't-remstroy': { short: 'Ремстрой', accent: '#9A4A1F' },
  't-cargo': {
    short: 'Карго',
    accent: '#2B5479',
    poweredBy: false,
    version: 2,
    updatedAt: '02.06 09:40',
    updatedBy: 'Денис Шишкин',
  },
};

/** Оформление организаций (`seedBrands`, mock-data.js:11–19): `BRAND_DEFAULT` + имя + своё. */
export function applyBrands(P: Platform): void {
  for (const t of P.tenants) {
    t.brand = structuredClone({ ...BRAND_DEFAULT, name: t.name, ...(BRANDS[t.id] ?? {}) });
  }
}
