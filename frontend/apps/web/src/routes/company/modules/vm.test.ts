// W1.24 · Модель «Модули и место»: формулировки — эталон design-stage-1 (omVM :3100–3137, toggleModule
// :2644–2683, applyQuota :2684–2709) и решения брифа §10 (Q-W1.24-1, -5, -6, -7).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  connectDialog,
  coreTiles,
  disconnectDialog,
  industryCards,
  isRestricted,
  moduleHolders,
  quotaDialog,
  statusCard,
} from './vm.ts';

type S = components['schemas'];

const manifest = (moduleKey: string, state: S['ModuleManifest']['state']): S['ModuleManifest'] => ({
  moduleKey,
  version: '1.0.0',
  name: moduleKey,
  dependencies: [],
  permissions: [],
  datasets: [],
  state,
  revision: 1,
});

const SEED = [
  manifest('fleet', 'uninstalled'),
  manifest('spa', 'active'),
  manifest('repairs', 'uninstalled'),
];

const NOW = new Date('2026-10-01T07:30:00Z');

describe('карточка статуса подписки (omVM :3102–3107, Q-W1.24-1)', () => {
  it('пробный период: «Осталось 12 дней · до 13.10.2026» (конец — полночь МСК)', () => {
    const c = statusCard(
      { status: 'trial', trialEndsAt: '2026-10-13T21:00:00Z', storageWriteStatus: 'allowed' },
      NOW,
    );
    expect(c).toEqual({
      chip: { label: 'Пробный период', tone: 'info', icon: 'hourglass_top' },
      title: 'Осталось 12 дней · до 13.10.2026',
      text: 'После окончания история останется доступной для чтения, новые операции будут ограничены. Данные не удаляются.',
      restricted: false,
    });
  });

  it('склонение дней: 1 день, 3 дня', () => {
    const one = statusCard(
      { status: 'trial', trialEndsAt: '2026-10-02T21:00:00Z', storageWriteStatus: 'allowed' },
      NOW,
    );
    expect(one?.title).toBe('Осталось 1 день · до 02.10.2026');
    const three = statusCard(
      { status: 'trial', trialEndsAt: '2026-10-04T21:00:00Z', storageWriteStatus: 'allowed' },
      NOW,
    );
    expect(three?.title).toBe('Осталось 3 дня · до 04.10.2026');
  });

  it('grace, read_only, suspended — «Пробный период завершён», «Ограничен»', () => {
    for (const status of ['grace', 'read_only', 'suspended'] as const) {
      const c = statusCard({ status, storageWriteStatus: 'allowed' }, NOW);
      expect(c?.chip).toEqual({ label: 'Ограничен', tone: 'warn', icon: 'lock_clock' });
      expect(c?.title).toBe('Пробный период завершён');
      expect(c?.text).toBe(
        'Новые операции ограничены. История доступна для чтения и выгрузки, данные не удаляются. Продление выполняет оператор платформы.',
      );
      expect(c?.restricted).toBe(true);
      expect(isRestricted({ status, storageWriteStatus: 'allowed' })).toBe(true);
    }
  });

  it('действует — «Подписка действует»; без tenantState карточки нет', () => {
    const c = statusCard({ status: 'active', storageWriteStatus: 'allowed' }, NOW);
    expect(c?.chip).toEqual({ label: 'Действует', tone: 'ok', icon: 'check_circle' });
    expect(c?.title).toBe('Подписка действует');
    expect(c?.text).toBe('Условия подписки задаёт оператор платформы.');
    expect(statusCard(undefined, NOW)).toBeNull();
    expect(isRestricted(undefined)).toBe(false);
    expect(isRestricted({ status: 'trial', storageWriteStatus: 'allowed' })).toBe(false);
  });
});

describe('число сотрудников с правами модуля (holders :3109, Q-W1.24-7)', () => {
  const role = (id: string, permissions: string[], builtIn = false): S['Role'] => ({
    id,
    name: id,
    description: id,
    builtIn,
    permissions,
    revision: 1,
  });
  const assign = (
    id: string,
    principalType: 'member' | 'group',
    principalId: string,
    roleId: string,
    state: S['Assignment']['state'] = 'active',
  ) =>
    ({
      id,
      principalType,
      principalId,
      roleId,
      scope: { kind: 'tenant', resourceIds: [], includeDescendants: true },
      state,
    }) as S['Assignment'];
  const group: S['Group'] = {
    id: 'g-drivers',
    name: 'Водители Север',
    description: '',
    homeUnitId: null,
    memberIds: ['m-vasiliev'],
    hiddenMemberCount: 0,
    assignmentCount: 1,
    revision: 1,
    createdAt: '2026-09-01T00:00:00Z',
  };

  it('через группу и прямо — один сотрудник; встроенная роль и снятое назначение не считаются', () => {
    const roles = [
      role('r-owner', ['fleet.trips.read', 'spa.appointments.read'], true),
      role('r-driver', ['fleet.trips.read', 'fleet.trips.start']),
      role('r-therapist', ['spa.appointments.read']),
      role('r-pm', ['tasks.read']),
    ];
    const assignments = [
      assign('a1', 'member', 'm-owner', 'r-owner'),
      assign('a2', 'group', 'g-drivers', 'r-driver'),
      assign('a3', 'member', 'm-vasiliev', 'r-driver'),
      assign('a4', 'member', 'm-morozova', 'r-therapist'),
      assign('a5', 'member', 'm-old', 'r-therapist', 'expired'),
      assign('a6', 'member', 'm-kotova', 'r-pm'),
    ];
    expect(moduleHolders(roles, assignments, [group])).toEqual({ fleet: 1, spa: 1, repairs: 0 });
  });

  it('заблокированный участник группы не считается (эталон разворачивает группу на действующих)', () => {
    const roles = [role('r-driver', ['fleet.trips.read'])];
    const assignments = [assign('a2', 'group', 'g-drivers', 'r-driver')];
    const groups = [{ ...group, memberIds: ['m-vasiliev', 'm-gromov'] }];
    const member = (id: string, status: S['Member']['status']): S['Member'] => ({
      id,
      displayName: id,
      status,
      orgUnitIds: [],
      revision: 1,
      workProfiles: [],
    });
    const members = [member('m-vasiliev', 'active'), member('m-gromov', 'suspended')];
    expect(moduleHolders(roles, assignments, groups).fleet).toBe(2);
    expect(moduleHolders(roles, assignments, groups, members).fleet).toBe(1);
  });
});

describe('карточки отраслевых модулей (:3110–3120, Q-W1.24-5)', () => {
  const holders = { fleet: 1, spa: 2, repairs: 0 };

  it('сид «Альты»: порядок, имена, описания, зависимости, чипы, строка о ролях', () => {
    const cards = industryCards(SEED, holders, { restricted: false, busy: false });
    expect(cards.map((c) => c.name)).toEqual(['Логистика', 'Салон и SPA', 'Ремонт и стройка']);
    const [fleet, spa, repairs] = cards;
    expect(fleet).toMatchObject({
      key: 'fleet',
      icon: 'local_shipping',
      desc: 'Машины, рейсы, осмотры, расходы в пути и приёмка смен.',
      deps: ['Календарь', 'Файлы', 'Формы'],
      chip: { label: 'Не подключён', tone: 'neutral', icon: 'radio_button_unchecked' },
      roleNote: 'Роли с правами модуля есть у: 1 сотрудник. Они заработают после подключения',
      on: false,
      locked: false,
      showNext: false,
    });
    expect(spa).toMatchObject({
      chip: { label: 'Подключён', tone: 'ok', icon: 'check_circle' },
      roleNote: 'Доступ через роли: 2 сотрудника',
      on: true,
      showNext: false,
    });
    expect(repairs?.roleNote).toBe('Права сотрудникам не выдаются автоматически');
    expect(repairs?.deps).toEqual(['Задачи', 'Склад и материалы', 'Файлы']);
  });

  it('подключённая «Логистика» без ролей: «Сотрудникам доступ не выдан…» и «Назначить роли»', () => {
    const cards = industryCards(
      [manifest('fleet', 'active'), manifest('spa', 'active')],
      { fleet: 0, spa: 0, repairs: 0 },
      { restricted: false, busy: false },
    );
    expect(cards[0]).toMatchObject({
      roleNote: 'Сотрудникам доступ не выдан — назначьте роли',
      showNext: true,
      on: true,
    });
    expect(cards[2]?.chip.label).toBe('Не подключён');
  });

  it('read_only и draining — «Отключён · только чтение»; disabled — «Не подключён»', () => {
    for (const state of ['read_only', 'draining'] as const) {
      const [fleet] = industryCards([manifest('fleet', state)], holders, {
        restricted: false,
        busy: false,
      });
      expect(fleet?.chip).toEqual({
        label: 'Отключён · только чтение',
        tone: 'neutral',
        icon: 'history',
      });
      expect(fleet?.on).toBe(false);
    }
    const [off] = industryCards([manifest('fleet', 'disabled')], holders, {
      restricted: false,
      busy: false,
    });
    expect(off?.chip.label).toBe('Не подключён');
  });

  it('ограниченная организация или идущая команда блокирует «Подключить»', () => {
    expect(industryCards(SEED, holders, { restricted: true, busy: false })[0]?.locked).toBe(true);
    expect(industryCards(SEED, holders, { restricted: false, busy: true })[0]?.locked).toBe(true);
  });
});

describe('плитки базовых модулей (:3121–3122)', () => {
  it('12 плиток в порядке эталона; «Использует: …» по подключённым отраслевым модулям', () => {
    const tiles = coreTiles(SEED);
    expect(tiles.map((t) => t.name)).toEqual([
      'Календарь',
      'Задачи',
      'База знаний',
      'Документы',
      'Формы',
      'Данные',
      'Файлы',
      'Склад и материалы',
      'Касса',
      'Обращения',
      'Чаты',
      'Уведомления',
    ]);
    const by = Object.fromEntries(tiles.map((t) => [t.name, t.usedBy]));
    expect(by['Календарь']).toBe('Использует: Салон и SPA');
    expect(by['Задачи']).toBe('Общий модуль ядра');
    expect(by['Касса']).toBe('Использует: Салон и SPA');
    expect(by['Файлы']).toBe('Общий модуль ядра');
    expect(tiles[0]?.icon).toBe('calendar_month');
  });

  it('подключённая «Логистика» добавляется первой; отключённая с историей не считается', () => {
    const on = coreTiles([manifest('fleet', 'active'), manifest('spa', 'active')]);
    expect(on.find((t) => t.name === 'Календарь')?.usedBy).toBe(
      'Использует: Логистика, Салон и SPA',
    );
    expect(on.find((t) => t.name === 'Файлы')?.usedBy).toBe('Использует: Логистика');
    const ro = coreTiles([manifest('fleet', 'read_only'), manifest('spa', 'active')]);
    expect(ro.find((t) => t.name === 'Файлы')?.usedBy).toBe('Общий модуль ядра');
  });
});

describe('диалог «Подключить «{name}»?» (:2647–2662)', () => {
  it('«Логистика»: что появится, зависимости, шаблоны ролей и пробный период', () => {
    expect(connectDialog('fleet', 'Альта Групп')).toEqual({
      title: 'Подключить «Логистика»?',
      text: 'Модуль станет доступен организации «Альта Групп». Права сотрудникам не выдаются автоматически.',
      icon: 'local_shipping',
      tone: 'ok',
      consequences: [
        {
          title: 'Что появится',
          items: [
            'Рабочее место логиста',
            'Мобильная смена водителя',
            'Осмотры с обязательными фото',
            'Приёмка смен',
          ].map((text) => ({ icon: 'add_circle', tone: 'ok', text })),
        },
        {
          title: 'Зависимости',
          items: ['Календарь — уже включён', 'Файлы — уже включён', 'Формы — уже включён'].map(
            (text) => ({ icon: 'check_circle', tone: 'ok', text }),
          ),
        },
        {
          title: 'Важно',
          items: [
            {
              icon: 'badge',
              tone: 'info',
              text: 'Шаблоны ролей: Менеджер логистики, Водитель. Назначьте их сотрудникам в «Пользователи и роли».',
            },
            {
              icon: 'hourglass_top',
              tone: 'neutral',
              text: 'Подключается в рамках пробного периода. Стоимость не рассчитывается: тарифы не согласованы.',
            },
          ],
        },
      ],
      confirmLabel: 'Подключить',
    });
  });
});

describe('диалог «Отключить «{name}»?» (:2664–2682, S1-18, Q-W1.24-6)', () => {
  const preview = (
    moduleKey: string,
    activeItems: S['ModuleDeactivationItem'][] = [],
    hiddenCount = 0,
  ): S['ModuleDeactivationPreview'] => ({
    moduleKey,
    retainedAccess: 'history_read',
    activeItems,
    hiddenCount,
    generatedAt: '2026-10-01T07:30:00Z',
  });

  it('«Логистика» без процессов: «Активных процессов нет», тексты модуля, пункт меню D-23, флажок', () => {
    expect(disconnectDialog('fleet', preview('fleet'))).toEqual({
      title: 'Отключить «Логистика»?',
      text: 'Данные не удаляются. Модуль перейдёт в режим чтения истории.',
      icon: 'extension_off',
      tone: 'danger',
      consequences: [
        {
          title: 'Затронет сейчас',
          items: [{ icon: 'check', tone: 'ok', text: 'Активных процессов нет' }],
        },
        {
          title: 'Что произойдёт',
          items: [
            { icon: 'block', tone: 'danger', text: 'Новые брони, рейсы и осмотры будут закрыты' },
            {
              icon: 'task_alt',
              tone: 'ok',
              text: 'Начатые смены можно безопасно завершить и принять',
            },
            {
              icon: 'history',
              tone: 'neutral',
              text: 'История, назначения ролей и файлы сохраняются',
            },
            {
              icon: 'menu_open',
              tone: 'neutral',
              text: 'Группа модуля уйдёт из меню, останется один пункт в «Отключены · только чтение»',
            },
          ],
        },
      ],
      ack: 'Понимаю последствия для текущей работы',
      confirmLabel: 'Отключить модуль',
    });
  });

  it('«Салон и SPA» и «Ремонт и стройка»: свои тексты, без пункта о начатых сменах', () => {
    const spa = disconnectDialog('spa', preview('spa'));
    expect(spa.title).toBe('Отключить «Салон и SPA»?');
    expect(spa.consequences[1]?.items.map((i) => i.text)).toEqual([
      'Новые записи, визиты и списания будут закрыты',
      'История, назначения ролей и файлы сохраняются',
      'Группа модуля уйдёт из меню, останется один пункт в «Отключены · только чтение»',
    ]);
    const repair = disconnectDialog('repairs', preview('repairs'));
    expect(repair.consequences[1]?.items[0]?.text).toBe(
      'Новые отметки, сметы, допработы и закупки будут закрыты',
    );
  });

  it('«Затронет сейчас» из activeItems: рейс со статусом и водителем, форма, автоматизация, «И ещё»', () => {
    const d = disconnectDialog(
      'fleet',
      preview(
        'fleet',
        [
          {
            kind: 'active_process',
            object: { moduleKey: 'fleet', entityType: 'fleet.trip', entityId: 't1' },
            title: 'Рейс Р-208',
            state: 'on_route',
            assigneeName: 'Илья Васильев',
            effect: 'finish_allowed',
          },
          {
            kind: 'active_process',
            object: { moduleKey: 'fleet', entityType: 'fleet.trip', entityId: 't2' },
            title: 'Рейс Р-211',
            state: 'loading_bay',
            effect: 'closed',
          },
          {
            kind: 'form_intake',
            object: { moduleKey: 'forms', entityType: 'form', entityId: 'f1' },
            title: 'Осмотр машины',
            state: 'published',
            effect: 'paused',
          },
          {
            kind: 'automation',
            object: { moduleKey: 'forms', entityType: 'automation', entityId: 'r1' },
            title: 'Ответ осмотра → задача менеджеру',
            state: 'enabled',
            effect: 'paused',
          },
        ],
        3,
      ),
    );
    expect(d.consequences[0]?.items).toEqual([
      { icon: 'route', tone: 'warn', text: 'Рейс Р-208 · В рейсе · Илья Васильев' },
      // Состояние без подписи (код API) пользователю не показывается — только заголовок объекта.
      { icon: 'route', tone: 'warn', text: 'Рейс Р-211' },
      {
        icon: 'dynamic_form',
        tone: 'neutral',
        text: 'Форма «Осмотр машины» — приём новых ответов остановится',
      },
      {
        icon: 'bolt',
        tone: 'neutral',
        text: 'Автоматизация «Ответ осмотра → задача менеджеру» будет приостановлена',
      },
      { icon: 'more_horiz', tone: 'neutral', text: 'И ещё 3' },
    ]);
  });
});

describe('диалоги лимита (:2684–2709, Q-W1.24-2)', () => {
  const usage: S['StorageUsage'] = {
    quotaBytes: 107374182400,
    committedBytes: 49606872269,
    reservedBytes: 0,
    buckets: [],
    measuredAt: '2026-10-01T07:30:00Z',
    consistency: 'estimated',
    writeStatus: 'allowed',
  };

  it('меньше занятого: «Новый лимит меньше занятого места», нехватка, флажок', () => {
    expect(quotaDialog(usage, 25)).toEqual({
      title: 'Новый лимит меньше занятого места',
      text: 'Занято 46,2 ГБ, новый лимит 25 ГБ. Не хватает 21,2 ГБ.',
      icon: 'storage',
      tone: 'danger',
      consequences: [
        {
          title: 'Что произойдёт',
          items: [
            {
              icon: 'block',
              tone: 'danger',
              text: 'Новые загрузки фото и вложений будут заблокированы',
            },
            {
              icon: 'inventory_2',
              tone: 'ok',
              text: 'Существующие файлы не удаляются автоматически',
            },
            {
              icon: 'task_alt',
              tone: 'ok',
              text: 'Фото уже начатых смен загружаются в пределах временного резерва',
            },
          ],
        },
        {
          title: 'Что сделать',
          items: [
            {
              icon: 'folder_open',
              tone: 'info',
              text: 'Освободите не менее 21,2 ГБ в разделе «Файлы»',
            },
            { icon: 'tune', tone: 'info', text: 'или выберите лимит от 50 ГБ' },
          ],
        },
      ],
      ack: 'Понимаю: новые загрузки будут недоступны',
      confirmLabel: 'Всё равно применить',
    });
  });

  it('не меньше занятого: «Изменить лимит на 250 ГБ?» без секций и флажка', () => {
    expect(quotaDialog(usage, 250)).toEqual({
      title: 'Изменить лимит на 250 ГБ?',
      text: 'Занято 46,2 ГБ. Стоимость не рассчитывается: тарифы не согласованы.',
      icon: 'storage',
      tone: 'ok',
      consequences: [],
      confirmLabel: 'Изменить',
    });
  });
});
