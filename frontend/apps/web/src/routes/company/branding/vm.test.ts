// W4.62 · Модель «Оформления» (brandingVM :3681–3749 эталона design-2026-10-19; 18-branding.md «Цвет», «Термины»,
// «Меню»): контраст и автокоррекция, буква и имя, ошибки черновика, черновик, термины, строки меню, предпросмотр,
// версия, проверка файла, тело updateTenantBranding.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  accentView,
  type BaseGroup,
  cantSave,
  type Draft,
  draftErrors,
  draftOf,
  fileProblem,
  groupIds,
  identity,
  isDirty,
  menuRows,
  moveItem,
  paletteView,
  previewView,
  reduceDraft,
  termRows,
  updateBody,
  versionText,
} from './vm.ts';

type Branding = components['schemas']['Branding'];

const variants = (accent: string) => ({ accent, hover: accent, soft: accent, tint: accent });

const ALTA: Branding = {
  version: 1,
  displayName: 'Альта Групп',
  shortName: null,
  accentHex: '#1F6B52',
  accentUsed: '#1F6B52',
  accentVariants: variants('#1F6B52'),
  terms: {},
  menu: { items: {}, order: [] },
  poweredBy: true,
};

const LOTOS: Branding = {
  ...ALTA,
  version: 3,
  displayName: 'SPA «Лотос»',
  shortName: 'Лотос',
  accentHex: '#7A3E79',
  accentUsed: '#7A3E79',
  accentVariants: variants('#7A3E79'),
  terms: { visit: { one: 'сеанс', plural: 'сеансы', few: 'сеанса', many: 'сеансов' } },
  updatedAt: '2026-09-24T09:10:00Z',
  updatedBy: { accountId: '00000000-0000-4000-8000-000000000001', displayName: 'Ирина Белова' },
};

/** Меню владельца «Альты» (navForBase :2981–2996 без «Логистики»). */
const BASE: BaseGroup[] = [
  { title: 'Обзор', items: [{ id: 'home', label: 'Главная', icon: 'home' }] },
  {
    title: 'Компания',
    items: [
      { id: 'modules', label: 'Модули и место', icon: 'extension' },
      { id: 'users', label: 'Пользователи и роли', icon: 'group' },
      { id: 'billing', label: 'Подписка и места', icon: 'workspace_premium' },
      { id: 'branding', label: 'Оформление', icon: 'palette' },
    ],
  },
  { title: 'Ремонт и стройка', items: [{ id: 'repair', label: 'Объекты', icon: 'home_work' }] },
  { title: 'Отрасли', items: [{ id: 'spa', label: 'Салон и SPA', icon: 'spa' }] },
  {
    title: 'Общие модули',
    items: [
      { id: 'tasks', label: 'Задачи', icon: 'task_alt' },
      { id: 'forms', label: 'Формы и опросы', icon: 'dynamic_form' },
    ],
  },
];

const alta = (): Draft => draftOf(ALTA);
const NOW = new Date('2026-10-01T07:30:00Z');

describe('акцентный цвет: контраст с белым текстом и автокоррекция (18-branding «Цвет»)', () => {
  it('#1F6B52 — подходит, контраст 6,4:1', () => {
    const v = accentView('#1F6B52');
    expect(v.state).toBe('ok');
    expect(v.text).toBe('Контраст с белым текстом 6,4:1: подходит для кнопок и ссылок.');
    expect(v.vars).toEqual({
      accent: '#1F6B52',
      hover: '#195843',
      soft: '#E0EAE7',
      tint: '#EFF5F3',
    });
    expect(v.picker).toBe('#1F6B52');
  });

  it('строчные буквы HEX — тот же цвет, «Сливовый» 7,5:1', () => {
    const v = accentView('#7a3e79');
    expect(v.acc).toBe('#7A3E79');
    expect(v.text).toBe('Контраст с белым текстом 7,5:1: подходит для кнопок и ссылок.');
  });

  it('#FFD400 — мало для текста: затемнение шагами по 4% до #8A7300 (4,6:1)', () => {
    const v = accentView('#FFD400');
    expect(v.state).toBe('fix');
    expect(v.fixed).toBe('#8A7300');
    expect(v.text).toBe(
      'Контраст с белым текстом 1,4:1 — мало для текста. В интерфейсе будет использован #8A7300 (4,6:1).',
    );
    expect(v.vars).toEqual({
      accent: '#8A7300',
      hover: '#715E00',
      soft: '#EFEBDB',
      tint: '#F7F5ED',
    });
  });

  it('не #RRGGBB — ошибка, предпросмотр и выбор цвета — в цвете Ортуса', () => {
    for (const hex of ['zzz', '', '#12345', '#GGGGGG']) {
      const v = accentView(hex);
      expect(v.state).toBe('bad');
      expect(v.acc).toBe('#1F6B52');
      expect(v.picker).toBe('#1F6B52');
      expect(v.vars.accent).toBe('#1F6B52');
    }
  });

  it('палитра: 8 цветов по порядку, выбран цвет черновика без учёта регистра', () => {
    const p = paletteView('#7a3e79');
    expect(p.map((c) => c.label)).toEqual([
      'Ортус',
      'Морской',
      'Синий',
      'Индиго',
      'Сливовый',
      'Терракота',
      'Олива',
      'Графит',
    ]);
    expect(p.filter((c) => c.selected).map((c) => c.label)).toEqual(['Сливовый']);
    for (const c of p) expect(accentView(c.hex).state).toBe('ok');
  });
});

describe('название, короткое имя, буква', () => {
  it('«Альта Групп» без короткого имени: показано «Альта», буква «А», счётчик 0 / 16', () => {
    expect(identity(alta())).toEqual({
      shown: 'Альта',
      letter: 'А',
      nameText: 'Альта Групп',
      count: '0 / 16',
      over: false,
    });
  });

  it('короткое имя важнее названия; пусто — «ортус», буква «О»; знаки препинания не буква', () => {
    expect(identity({ ...alta(), short: 'Лотос' }).letter).toBe('Л');
    const empty = identity({ ...alta(), name: '', short: '' });
    expect(empty.shown).toBe('ортус');
    expect(empty.letter).toBe('О');
    expect(empty.nameText).toBe('Название организации');
    expect(identity({ ...alta(), name: '«Квадрат» Плюс' }).letter).toBe('К');
  });

  it('короткое имя длиннее 16 — счётчик «17 / 16» красный', () => {
    const v = identity({ ...alta(), short: 'x'.repeat(17) });
    expect(v.count).toBe('17 / 16');
    expect(v.over).toBe(true);
  });
});

describe('ошибки черновика (порядок эталона :3696–3701)', () => {
  it('все ошибки сразу', () => {
    const d: Draft = {
      ...alta(),
      name: ' ',
      short: 'x'.repeat(17),
      accent: 'zzz',
      terms: { shift: { one: 'смена', plural: 'смены', few: 'смены', many: '' } },
    };
    expect(draftErrors(d)).toEqual([
      'Укажите название организации',
      'Короткое имя — до 16 символов',
      'Цвет — в формате #RRGGBB',
      'Термин «Смена»: заполните все четыре формы',
    ]);
    expect(draftErrors({ ...alta(), name: 'x'.repeat(61) })).toEqual(['Название — до 60 символов']);
    expect(draftErrors({ ...alta(), name: '  Альта  ' })).toEqual([]);
  });
});

describe('черновик', () => {
  it('сохранённое → черновик; без правок — изменений нет', () => {
    expect(alta()).toEqual({
      name: 'Альта Групп',
      short: '',
      accent: '#1F6B52',
      logo: null,
      mark: null,
      terms: {},
      items: {},
      order: [],
      poweredBy: true,
    });
    expect(isDirty(null, ALTA)).toBe(false);
    expect(isDirty(alta(), ALTA)).toBe(false);
  });

  it('правка цвета — изменения есть; вернули руками — нет', () => {
    const plum = reduceDraft(alta(), { type: 'accent', value: '#7A3E79' });
    expect(isDirty(plum, ALTA)).toBe(true);
    expect(isDirty(reduceDraft(plum, { type: 'accent', value: '#1F6B52' }), ALTA)).toBe(false);
  });

  it('свой HEX без «#» получает «#»; пробелы снимаются', () => {
    expect(reduceDraft(alta(), { type: 'accent', value: ' 2B5479 ' }).accent).toBe('#2B5479');
    expect(reduceDraft(alta(), { type: 'accent', value: '#2b5479' }).accent).toBe('#2b5479');
  });

  it('термин: первая правка берёт стандартные формы; «Вернуть стандартный» убирает термин', () => {
    const d = reduceDraft(alta(), { type: 'term', key: 'shift', form: 'many', value: 'смен!' });
    expect(d.terms.shift).toEqual({ one: 'смена', plural: 'смены', few: 'смены', many: 'смен!' });
    expect(reduceDraft(d, { type: 'termReset', key: 'shift' }).terms).toEqual({});
  });

  it('меню: подпись, иконка, видимость', () => {
    let d = reduceDraft(alta(), { type: 'item', id: 'billing', patch: { label: 'Тариф' } });
    d = reduceDraft(d, { type: 'item', id: 'home', patch: { icon: 'dashboard' } });
    d = reduceDraft(d, { type: 'item', id: 'spa', patch: { hidden: true } });
    expect(d.items).toEqual({
      billing: { label: 'Тариф' },
      home: { icon: 'dashboard' },
      spa: { hidden: true },
    });
  });

  it('«Работает на Ортус» переключается; «Стандартное оформление» оставляет название', () => {
    const off = reduceDraft(alta(), { type: 'powered' });
    expect(off.poweredBy).toBe(false);
    const lotos = draftOf(LOTOS);
    expect(reduceDraft(lotos, { type: 'standard' })).toEqual({
      ...alta(),
      name: 'SPA «Лотос»',
    });
  });
});

describe('термины (BR_TERMS :2313–2319)', () => {
  it('«Альта» — пять стандартных терминов с примерами', () => {
    const rows = termRows(alta());
    expect(rows.map((r) => [r.label, r.example, r.custom])).toEqual([
      ['Смена', '1 смена · 2 смены · 5 смен', false],
      ['Машина', '1 машина · 2 машины · 5 машин', false],
      ['Рейс', '1 рейс · 2 рейса · 5 рейсов', false],
      ['Визит', '1 визит · 2 визита · 5 визитов', false],
      ['Объект', '1 объект · 2 объекта · 5 объектов', false],
    ]);
    expect(rows[0]?.where).toBe('В макете: меню и заголовок «Приёмка смен»');
  });

  it('«Лотос» — «Визит» переопределён: «сеанс»', () => {
    const visit = termRows(draftOf(LOTOS))[3];
    expect(visit?.custom).toBe(true);
    expect(visit?.example).toBe('1 сеанс · 2 сеанса · 5 сеансов');
  });
});

describe('меню и иконки (:3708–3721)', () => {
  it('порядок внутри группы: сначала перечисленные в order, остальные — на своих местах', () => {
    expect(groupIds(BASE, [])[1]).toEqual(['modules', 'users', 'billing', 'branding']);
    expect(groupIds(BASE, ['users', 'modules'])[1]).toEqual([
      'users',
      'modules',
      'billing',
      'branding',
    ]);
  });

  it('«Ниже» у «Модули и место» — новый общий порядок всех групп', () => {
    const order = moveItem(groupIds(BASE, []), 1, 0, 1);
    expect(order).toEqual([
      'home',
      'users',
      'modules',
      'billing',
      'branding',
      'repair',
      'spa',
      'tasks',
      'forms',
    ]);
  });

  it('разделы управления «всегда виден»; края группы; скрытый пункт; набор иконок пункта', () => {
    const d = reduceDraft(alta(), { type: 'item', id: 'spa', patch: { hidden: true } });
    const groups = menuRows(BASE, d, 'home');
    const home = groups[0]?.rows[0];
    expect(home).toMatchObject({
      def: 'Главная',
      label: '',
      icon: 'home',
      locked: true,
      hidden: false,
      open: true,
      cantUp: true,
      cantDown: true,
    });
    expect(home?.icons).toEqual(['home', 'dashboard', 'space_dashboard']);
    const company = groups[1]?.rows ?? [];
    expect(company.every((r) => r.locked)).toBe(true);
    expect(company.map((r) => [r.cantUp, r.cantDown])).toEqual([
      [true, false],
      [false, false],
      [false, false],
      [false, true],
    ]);
    const spa = groups[3]?.rows[0];
    expect(spa).toMatchObject({ locked: false, hidden: true, open: false });
    expect(spa?.icons).toEqual(['spa', 'self_care', 'content_cut', 'hot_tub', 'health_and_beauty']);
    expect(groups[2]?.rows[0]?.icons).toHaveLength(6);
  });

  it('скрыть пункт управления нельзя: hidden у «Модули и место» не действует', () => {
    const d = reduceDraft(alta(), { type: 'item', id: 'modules', patch: { hidden: true } });
    expect(menuRows(BASE, d, null)[1]?.rows[0]?.hidden).toBe(false);
  });

  it('пункт без набора иконок — только его иконка', () => {
    const base: BaseGroup[] = [
      { title: 'Компания', items: [{ id: 'structure', label: 'Структура', icon: 'account_tree' }] },
    ];
    expect(menuRows(base, alta(), null)[0]?.rows[0]?.icons).toEqual(['account_tree']);
  });
});

describe('предпросмотр (:3722, :3740–3742)', () => {
  it('первые 7 пунктов меню черновика; скрытый пропадает, подпись и иконка — из черновика', () => {
    let d = reduceDraft(alta(), { type: 'item', id: 'spa', patch: { hidden: true } });
    d = reduceDraft(d, { type: 'item', id: 'billing', patch: { label: 'Тариф' } });
    d = reduceDraft(d, { type: 'item', id: 'home', patch: { icon: 'dashboard' } });
    const v = previewView(BASE, d);
    expect(v.nav.map((n) => n.label)).toEqual([
      'Главная',
      'Модули и место',
      'Пользователи и роли',
      'Тариф',
      'Оформление',
      'Объекты',
      'Задачи',
    ]);
    expect(v.nav[0]?.icon).toBe('dashboard');
    expect(v.reviewTitle).toBe('Приёмка смен');
    expect(v.count).toBe('3 смены ждут проверки');
  });

  it('термин «смена» → «Приёмка рейсов», «3 рейса ждут проверки»; своя подпись пункта важнее', () => {
    const d: Draft = {
      ...alta(),
      terms: { shift: { one: 'рейс', plural: 'рейсы', few: 'рейса', many: 'рейсов' } },
    };
    expect(previewView(BASE, d).reviewTitle).toBe('Приёмка рейсов');
    expect(previewView(BASE, d).count).toBe('3 рейса ждут проверки');
    const own = reduceDraft(d, { type: 'item', id: 'review', patch: { label: 'Контроль' } });
    expect(previewView(BASE, own).reviewTitle).toBe('Контроль');
  });
});

describe('версия оформления (:3743)', () => {
  it('стандартное, сохранённое другим днём и сегодня', () => {
    expect(versionText(ALTA, NOW)).toBe('Версия 1 · стандартное оформление');
    expect(versionText(LOTOS, NOW)).toBe('Версия 3 · изменено 24.09 12:10, Ирина Белова');
    expect(
      versionText(
        {
          ...ALTA,
          version: 2,
          updatedAt: '2026-10-01T07:30:00Z',
          updatedBy: { displayName: 'Дарья Зимина' },
        },
        NOW,
      ),
    ).toBe('Версия 2 · изменено 10:30, Дарья Зимина');
  });
});

describe('файл логотипа и знака (:3690–3693)', () => {
  it('тип проверяется раньше размера; до 1 МБ включительно', () => {
    expect(fileProblem({ type: 'image/png', size: 1024 * 1024 })).toBeNull();
    expect(fileProblem({ type: 'image/png', size: 1024 * 1024 + 1 })).toBe('Файл больше 1 МБ');
    expect(fileProblem({ type: 'text/plain', size: 10 ** 7 })).toBe('Нужен PNG, SVG, JPG или WebP');
    expect(fileProblem({ type: 'image/gif', size: 1 })).toBe('Нужен PNG, SVG, JPG или WebP');
    for (const type of ['image/jpeg', 'image/svg+xml', 'image/webp']) {
      expect(fileProblem({ type, size: 1 })).toBeNull();
    }
  });
});

describe('сохранение (:3744–3745)', () => {
  it('тело updateTenantBranding: обрезка, null вместо пустого, выбранный цвет (не исправленный)', () => {
    const d: Draft = {
      ...alta(),
      name: '  Альта Групп ',
      short: ' ',
      accent: '#ffd400',
      logo: { id: 'a1', url: '/brand-assets/a.png' },
      items: { billing: { label: '' }, spa: { hidden: true, label: ' ' } },
      order: ['users', 'modules'],
    };
    expect(updateBody(d)).toEqual({
      displayName: 'Альта Групп',
      shortName: null,
      accentHex: '#FFD400',
      logoAssetId: 'a1',
      markAssetId: null,
      terms: {},
      menu: { items: { spa: { hidden: true } }, order: ['users', 'modules'] },
      poweredBy: true,
    });
  });

  it('«Сохранить для всех» недоступна: без изменений, с ошибками, во время сохранения', () => {
    expect(cantSave(false, [], false)).toBe(true);
    expect(cantSave(true, [], false)).toBe(false);
    expect(cantSave(true, ['x'], false)).toBe(true);
    expect(cantSave(true, [], true)).toBe(true);
  });
});
