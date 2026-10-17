// W0.14 · Дословность доменов: каждая статическая строка словаря есть в эталоне 14.10,
// шаблоны дают те же строки, что конкатенации эталона.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL,
  banners,
  company,
  format,
  gate,
  home,
  logisticsDriver,
  logisticsManager,
  platform,
  shell,
} from '../src/index.ts';
import { API_JS, MAIN_HTML, MODELS_JS, leaves, readText } from './_util.mjs';

/**
 * Листья, которых нет в эталоне дословно: тексты канонических Problem.code и статусов
 * (написаны по реестру docs/12, бриф §10 п.2), схема и значения data-screen-label по PD-37.
 */
const NOT_FROM_DESIGN = [
  'errors.problem.',
  'errors.client.',
  'errors.http.',
  'screenLabels.byPage.',
  'screenLabels.scheme',
  // W1.54 (Q-W1.54-10): пункт меню экрана «Структура» без эталона (no-reference B-6, S1-08) — имя раздела в гейте.
  'shell.nav.items.structure',
];
const PD37_FROM_DESIGN = ['usage', 'requests', 'accounts', 'plans', 'billing', 'branding'];

describe('каждая статическая строка словаря дословно есть в эталоне', () => {
  const design = [MAIN_HTML, API_JS, MODELS_JS].map(readText).join('\n');
  const all = Object.entries(ALL).flatMap(([ns, tree]) => leaves(tree, ns));
  for (const [path, value] of all) {
    if (value.includes('{')) continue;
    const skip =
      NOT_FROM_DESIGN.some((p) => path.startsWith(p)) &&
      !PD37_FROM_DESIGN.some((k) => path === `screenLabels.byPage.${k}`);
    if (skip) continue;
    it(`${path} «${value}»`, () => assert.ok(design.includes(value), `нет в эталоне: ${value}`));
  }
});

const run = (cases) => {
  for (const [src, msg, values, expected] of cases) {
    it(`${src} → ${expected}`, () => {
      assert.equal(typeof msg, 'string', `${src}: ключ словаря не найден`);
      assert.equal(format(msg, values), expected);
    });
  }
};

describe('shell: шаблоны', () => {
  run([
    [':3039', shell.header.bell, { count: 0 }, 'Уведомления'],
    [':3039', shell.header.bell, { count: 3 }, 'Уведомления: 3 новых'],
    [':3017', shell.header.scopeRegion, { region: 'Москва' }, 'Москва · весь регион'],
    [
      ':3017',
      shell.header.scopeFirm,
      { region: 'Москва', firm: 'Север Логистик' },
      'Москва / Север Логистик',
    ],
    [
      ':192',
      shell.boot.loadError,
      { error: 'сеть' },
      'Не удалось загрузить модули прототипа: сеть',
    ],
  ]);
});

describe('gate: ветки A и B (gateVM :3053–3081)', () => {
  run([
    [
      ':3062',
      gate.a.titleModuleOff,
      { name: 'Ремонт и стройка' },
      '«Ремонт и стройка» не подключён организацией',
    ],
    [':3063', gate.a.titleNoPermission, { name: 'Календарь' }, 'Нет доступа к разделу «Календарь»'],
    [
      ':3074',
      gate.b.titleModuleOff,
      { name: 'Логистика' },
      '«Логистика» не подключена организацией',
    ],
    [
      ':3078',
      gate.b.titleNoRole,
      { name: 'Логистика' },
      'Нет роли с доступом к модулю «Логистика»',
    ],
    [
      ':3079',
      gate.b.textNoPermission,
      { review: true },
      'Модуль подключён, но ни одна ваша роль не разрешает это действие («Проверять»). Владелец бизнеса может назначить роль и область.',
    ],
    [
      ':3079',
      gate.b.textNoPermission,
      { review: false },
      'Модуль подключён, но ни одна ваша роль не разрешает это действие. Владелец бизнеса может назначить роль и область.',
    ],
  ]);
  it('пять причин REASON', () =>
    assert.deepEqual(Object.keys(gate.reason), [
      'moduleOff',
      'moduleReadonly',
      'noPermission',
      'noScope',
      'driverBlock',
    ]));
});

describe('banners: bannersVM :3083–3098', () => {
  run([
    [':3091', banners.moduleReadonly.title, { name: 'Логистика' }, 'Модуль «Логистика» отключён.'],
    [
      ':3094',
      banners.offline.text,
      { queued: 0 },
      'Черновики, фото и расходы сохраняются на устройстве. Бронь, выезд и приёмка требуют подтверждения сервера.',
    ],
    [
      ':3094',
      banners.offline.text,
      { queued: 3 },
      'Черновики, фото и расходы сохраняются на устройстве (ожидают отправки: 3). Бронь, выезд и приёмка требуют подтверждения сервера.',
    ],
  ]);
  it('действие баннера места — ссылка на gate.actions.openModules', () =>
    assert.equal(banners.storageFull.action, gate.actions.openModules));
  it('тексты «только чтение» по модулю', () =>
    assert.deepEqual(Object.keys(banners.moduleReadonly.text), ['logistics', 'spa', 'repair']));
});

describe('company: шаблоны', () => {
  const m = company.modules;
  run([
    [':3106', m.trial.title, { days: 12, date: '13.10.2026' }, 'Осталось 12 дней · до 13.10.2026'],
    [':3106', m.trial.title, { days: 1, date: '13.10.2026' }, 'Осталось 1 день · до 13.10.2026'],
    [':3106', m.trial.title, { days: 3, date: '13.10.2026' }, 'Осталось 3 дня · до 13.10.2026'],
    [':3116', m.industry.roleNoteOn, { n: 1 }, 'Доступ через роли: 1 сотрудник'],
    [':3116', m.industry.roleNoteOn, { n: 0 }, 'Сотрудникам доступ не выдан — назначьте роли'],
    [
      ':3116',
      m.industry.roleNoteOff,
      { n: 2 },
      'Роли с правами модуля есть у: 2 сотрудника. Они заработают после подключения',
    ],
    [':3116', m.industry.roleNoteOff, { n: 0 }, 'Права сотрудникам не выдаются автоматически'],
    [
      ':3122',
      m.core.usedBy,
      { modules: 'Логистика, Салон и SPA' },
      'Использует: Логистика, Салон и SPA',
    ],
    [
      ':3131',
      m.storage.overText,
      { gb: '21,2' },
      'Занято больше лимита на 21,2 ГБ. Новые загрузки заблокированы, файлы не удалены. Освободите место в разделе «Файлы» или увеличьте лимит.',
    ],
    [':3133', m.storage.option, { gb: 25, below: true }, '25 ГБ · меньше занятого'],
    [':3133', m.storage.option, { gb: 100, below: false }, '100 ГБ'],
    [
      ':3162',
      company.users.peopleNote,
      { n: 10, noRole: 6, used: 9, limit: 10 },
      '10 участников · без роли: 6 · мест занято 9 из 10',
    ],
    [':3162', company.users.peopleNote, { n: 10, noRole: 0, used: 9, limit: 0 }, '10 участников'],
    [
      ':3160',
      company.users.roleMeta,
      { all: true, perms: 0, assigned: 1 },
      'Все права · назначена: 1',
    ],
    [
      ':3160',
      company.users.roleMeta,
      { all: false, perms: 22, assigned: 0 },
      '22 разрешений · назначена: 0',
    ],
    [
      ':3156',
      company.users.groupMembers,
      { n: 2, names: 'Илья Васильев, Марина Котова' },
      '2 участника: Илья Васильев, Марина Котова',
    ],
    [':3182', company.users.editor.moduleOn, { on: 2, total: 6 }, '2 из 6 действий'],
    [
      ':3183',
      company.users.editor.switchLabel,
      { name: 'Логистика' },
      'Доступ роли к модулю Логистика',
    ],
    [
      ':3186',
      company.users.editor.expandLabel,
      { open: true, name: 'Логистика' },
      'Свернуть действия: Логистика',
    ],
    [
      ':3186',
      company.users.editor.expandLabel,
      { open: false, name: 'Логистика' },
      'Показать действия: Логистика',
    ],
    [':3208', company.users.editor.holders, { names: 'Марина Котова' }, 'Назначена: Марина Котова'],
    [
      ':3228',
      company.users.check.can,
      { name: 'Марина Котова', action: 'просматривать машины' },
      'Марина Котова может: просматривать машины',
    ],
    [
      ':3232',
      company.users.check.cannot,
      { name: 'Илья Васильев', action: 'принимать смены' },
      'Илья Васильев не может: принимать смены',
    ],
    [
      ':3231',
      company.users.check.object,
      { object: 'Isuzu Elf · Юг Транс' },
      'Объект: Isuzu Elf · Юг Транс.',
    ],
    [':3231', company.users.check.module, { module: 'Логистика' }, 'Модуль: Логистика.'],
    [
      ':3921',
      company.billing.statusTrial,
      { date: '13.10.2026', days: 12 },
      'до 13.10.2026 · осталось 12 дн.',
    ],
    [':3920', company.billing.title, { trial: true, tier: 'Старт' }, 'Пробный период · «Старт»'],
    [':3920', company.billing.title, { trial: false, tier: 'Команда' }, 'Тариф «Команда»'],
    [':3923', company.billing.seatsOf, { used: 9, limit: 10 }, '9 из 10'],
    [
      ':3923',
      company.billing.seatsSub,
      { active: 7, invited: 2, free: 1, unlimited: false },
      '7 активны · 2 приглашения · 1 свободно',
    ],
    [
      ':3923',
      company.billing.seatsSub,
      { active: 1, invited: 5, free: 0, unlimited: true },
      '1 активен · 5 приглашений · без ограничения',
    ],
    [
      ':3925',
      company.billing.pending,
      { id: 'SR-12', tier: 'Бизнес', term: '12 мес', at: '29.09 16:40' },
      'Заявка SR-12 на «Бизнес» · 12 мес отправлена 29.09 16:40. Новый лимит начнёт действовать после подтверждения оператором.',
    ],
    [
      ':4018',
      company.dialogs.invite.seatsText,
      { left: 1, limit: 10 },
      'Свободно мест: 1 из 10 — это последнее',
    ],
    [':4018', company.dialogs.invite.seatsText, { left: 2, limit: 25 }, 'Свободно мест: 2 из 25'],
    [
      ':2236',
      company.dialogs.invite.seatsLine,
      { seats: 'Свободно мест: 2 из 25' },
      'Свободно мест: 2 из 25. Приглашение занимает место сразу, до принятия.',
    ],
    [':2649', company.dialogs.connect.title, { name: 'Логистика' }, 'Подключить «Логистика»?'],
    [
      ':2650',
      company.dialogs.connect.text,
      { tenant: 'Альта Групп' },
      'Модуль станет доступен организации «Альта Групп». Права сотрудникам не выдаются автоматически.',
    ],
    [':2653', company.dialogs.connect.depOn, { name: 'Календарь' }, 'Календарь — уже включён'],
    [
      ':2655',
      company.dialogs.connect.roleTemplates,
      { roles: 'Менеджер логистики, Водитель' },
      'Шаблоны ролей: Менеджер логистики, Водитель. Назначьте их сотрудникам в «Пользователи и роли».',
    ],
    [':2669', company.dialogs.disconnect.title, { name: 'Логистика' }, 'Отключить «Логистика»?'],
    [
      ':2692',
      company.dialogs.quotaBelow.text,
      { used: '46,2', gb: 25, lack: '21,2' },
      'Занято 46,2 ГБ, новый лимит 25 ГБ. Не хватает 21,2 ГБ.',
    ],
    [
      ':2700',
      company.dialogs.quotaBelow.free,
      { lack: '21,2' },
      'Освободите не менее 21,2 ГБ в разделе «Файлы»',
    ],
    [':2707', company.dialogs.quota.title, { gb: 100 }, 'Изменить лимит на 100 ГБ?'],
    [
      ':2707',
      company.dialogs.quota.text,
      { used: '46,2' },
      'Занято 46,2 ГБ. Стоимость не рассчитывается: тарифы не согласованы.',
    ],
    [
      ':4002',
      company.dialogs.assign.summary,
      { role: 'Менеджер логистики', scope: 'Москва / Север Логистик' },
      'Менеджер логистики · Москва / Север Логистик',
    ],
    [
      ':3985',
      company.dialogs.assign.industry,
      { modules: 'Логистика' },
      'Отраслевые модули: Логистика',
    ],
    [
      ':3986',
      company.dialogs.assign.scopeFirm,
      { firm: 'Москва / Север Логистик' },
      'Только Москва / Север Логистик; соседние фирмы скрыты',
    ],
    [
      ':3986',
      company.dialogs.assign.scopeRegion,
      { region: 'Москва' },
      'Все фирмы региона Москва; другие регионы скрыты',
    ],
  ]);
});

describe('home: homeVM :4043–4135', () => {
  run([
    [':4127', home.greeting, { part: 'morning', name: 'Дарья' }, 'Доброе утро, Дарья'],
    [':4127', home.greeting, { part: 'day', name: 'Дарья' }, 'Добрый день, Дарья'],
    [':4127', home.greeting, { part: 'evening', name: 'Дарья' }, 'Добрый вечер, Дарья'],
    [':4128', home.summary, { n: 4 }, 'Требует решения: 4. Сначала то, что блокирует работу.'],
    [':4128', home.summary, { n: 0 }, 'Срочных вопросов нет.'],
    [':4129', home.setup.progress, { done: 1, total: 3 }, '1 из 3'],
    [':4131', home.queue.shown, { shown: 8, total: 12 }, 'показано 8 из 12'],
    [':4124', home.scopeAll, { tenant: 'Альта Групп' }, 'Альта Групп · все подразделения'],
    [':4069', home.queue.trialLeft, { days: 12 }, 'Пробный период: осталось 12 дней'],
    [
      ':4069',
      home.queue.trialLeftText,
      { date: '13.10.2026' },
      'До 13.10.2026. После окончания история останется доступной для чтения',
    ],
    [':4070', home.queue.storageUsed, { pct: 92 }, 'Занято 92% места'],
    [':4072', home.queue.noRole, { n: 3 }, '3 сотрудника без роли'],
    [':4072', home.queue.noRole, { n: 5 }, '5 сотрудников без роли'],
    [
      ':4072',
      home.queue.noRoleText,
      { names: 'Вера Котельникова' },
      'Вера Котельникова — нет доступа к модулям',
    ],
    [':4053', home.queue.criticalDefect, { trip: 'Р-208' }, 'Критический дефект · рейс Р-208'],
    [':4054', home.queue.shiftWaits, { trip: 'Р-208' }, 'Смена Р-208 ждёт приёмки'],
    [
      ':4054',
      home.queue.shiftWaitsText,
      { driver: 'Илья Васильев' },
      'Илья Васильев · машина не вернётся в пул до решения',
    ],
    [':4057', home.queue.tripNoDriver, { trip: 'Р-211' }, 'Рейс Р-211 без водителя'],
    [
      ':4057',
      home.queue.poolRequested,
      { firm: 'Юг Транс' },
      'Запрос в пул отправлен, решение за фирмой Юг Транс',
    ],
    [':4103', home.work.freeOf, { free: 3, total: 7 }, '3 из 7'],
  ]);
});

describe('platform: opConfirm и «Организации»', () => {
  run([
    [
      ':3560',
      platform.tenants.confirm.quotaTitle,
      { name: 'Альта Групп', gb: 50 },
      'Изменить квоту «Альта Групп» на 50 ГБ?',
    ],
    [
      ':3561',
      platform.tenants.confirm.extendTitle,
      { name: 'Альта Групп' },
      'Продлить пробный период «Альта Групп»?',
    ],
    [
      ':3563',
      platform.tenants.confirm.restrictTitle,
      { name: 'Альта Групп' },
      'Ограничить «Альта Групп»?',
    ],
    [
      ':3564',
      platform.tenants.confirm.liftTitle,
      { name: 'Альта Групп' },
      'Снять ограничение «Альта Групп»?',
    ],
    [':1172', platform.plans.prepareVersion, { version: 'v3' }, 'Подготовить версию v3'],
  ]);
  it('opConfirm: секция «Последствия» — общая подпись shell.modal', () =>
    assert.equal(shell.modal.consequences, 'Последствия'));
});

describe('logistics-manager и logistics-driver: шаблоны', () => {
  run([
    [':458', logisticsManager.fleet.pick, { trip: 'Р-208' }, 'Подбор транспорта · Р-208'],
    [':542', logisticsManager.pool.requestFor, { trip: 'Р-211' }, 'Запросить на рейс Р-211'],
    [
      ':544',
      logisticsManager.pool.pending,
      { firm: 'Юг Транс' },
      'Ожидает решения менеджера фирмы Юг Транс. Доступа к водителю пока нет.',
    ],
    [
      ':594',
      logisticsManager.review.critical,
      { vehicle: 'ГАЗель Next' },
      'Критический дефект · ГАЗель Next',
    ],
    [
      ':2767',
      logisticsManager.review.acceptDialog.title,
      { trip: 'Р-208' },
      'Принять смену Р-208?',
    ],
    [
      ':4036',
      logisticsManager.request.approverValue,
      { firm: 'Юг Транс' },
      'Менеджер фирмы Юг Транс',
    ],
    [':735', logisticsDriver.inspection.photos, { n: 3 }, 'Фото · 3 из 5'],
    [
      ':841',
      logisticsDriver.states.left,
      { missing: '2 фото, пробег' },
      'Осталось: 2 фото, пробег',
    ],
    [':704', logisticsDriver.today.reworkFix, { steps: 'Пробег' }, 'Исправить: Пробег'],
    [
      ':710',
      logisticsDriver.today.blockedText,
      { defect: 'Спереди: трещина' },
      'Критический дефект «Спереди: трещина» отправлен менеджеру на проверку. Машина недоступна для выезда.',
    ],
    [':2590', logisticsDriver.finishDialog.title, { trip: 'Р-208' }, 'Завершить рейс Р-208?'],
    [
      ':2592',
      logisticsDriver.finishDialog.stopsMarked,
      { done: 1, total: 3 },
      'Отмечено точек: 1 из 3. Убедитесь, что доставка выполнена.',
    ],
    [
      ':3459',
      logisticsDriver.outbox.sendError,
      { message: 'Нет связи' },
      'Ошибка отправки: Нет связи',
    ],
  ]);
  it('конфликт брони у водителя — подпись флажка демо-панели (одна строка — один файл)', () => {
    assert.equal(logisticsDriver.today.conflictTitle, shell.demo.flags.conflict);
  });
});
