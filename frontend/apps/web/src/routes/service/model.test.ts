// W7.32 · Таблицы Vitest модели страницы «Обращения»: тона, права кнопок, действия по статусу, лента, подсказки.
import { describe, expect, it } from 'vitest';

import {
  afterText,
  callError,
  callHint,
  callTypes,
  calendarMinutes,
  cardActions,
  cardMeta,
  canTake,
  channelInfo,
  channelLine,
  clientLine,
  compensationKind,
  directionText,
  COMPENSATION_OPTIONS,
  type Direction,
  etag,
  feedItem,
  fileIcon,
  fillReply,
  initials,
  isOpen,
  type Message,
  outcomesOf,
  queueSubtitle,
  type RequestType,
  type Rights,
  rightsIn,
  ratingText,
  sendNote,
  SLA_TONE,
  SERVICE_KEYS,
  statusInfo,
  taskError,
  typeName,
} from './model.ts';

const NOW = Date.parse('2026-10-01T13:24:00Z'); // 1 октября, 16:24 по Москве
const ref = (id: string, name: string) => ({ memberId: id, displayName: name });

const dir: Direction = {
  id: 'd1',
  key: 'ГРЗ',
  name: 'Грузоперевозки',
  color: '#2B5479',
  moduleKey: 'fleet',
  areaLabel: 'Москва, Самара',
  orgUnitId: null,
  projectId: 'p1',
  calendar: { days: [1, 2, 3, 4, 5, 6, 7], from: '08:00', to: '20:00', timeZone: 'Europe/Moscow' },
  lead: ref('m-owner', 'Дарья Зимина'),
  next: 58,
  team: [ref('m-owner', 'Дарья Зимина'), ref('m-kotova', 'Марина Котова')],
  canContacts: false,
  version: 1,
};

const type = (over: Partial<RequestType> = {}): RequestType => ({
  id: 'd1:cargo',
  directionId: 'd1',
  kind: 'cargo',
  name: 'Повреждение или недостача груза',
  firstMinutes: 240,
  resolveMinutes: null,
  legalDays: 30,
  priority: 'high',
  ...over,
});

const allRights = (over: Partial<Rights> = {}): Rights => ({
  reply: true,
  resolve: true,
  create: true,
  compensate: true,
  contacts: true,
  inTeam: true,
  ...over,
});

describe('тона и подписи', () => {
  it('SLA_TONE: семь состояний срока, нарушение — danger, риск — warn, закон — info', () => {
    expect(Object.keys(SLA_TONE).sort()).toEqual([
      'done',
      'late',
      'legal',
      'none',
      'norm',
      'pause',
      'risk',
    ]);
    expect(SLA_TONE.late).toEqual({ tone: 'danger', icon: 'error' });
    expect(SLA_TONE.risk).toEqual({ tone: 'warn', icon: 'schedule' });
    expect(SLA_TONE.legal).toEqual({ tone: 'info', icon: 'gavel' });
    expect(SLA_TONE.pause.icon).toBe('pause_circle');
    expect(SLA_TONE.done.tone).toBe('ok');
  });

  it.each([
    ['new', 'Новое', 'info'],
    ['work', 'В работе', 'neutral'],
    ['wait', 'Ждёт клиента', 'warn'],
    ['resolved', 'Решено', 'ok'],
    ['closed', 'Закрыто', 'neutral'],
  ] as const)('statusInfo(%s) = «%s», тон %s', (s, label, tone) => {
    expect(statusInfo(s)).toMatchObject({ label, tone });
  });

  it('channelInfo: подпись и значок, неизвестный канал — «—»', () => {
    expect(channelInfo('sms')).toEqual({ label: 'SMS', icon: 'sms' });
    expect(channelInfo('phone').label).toBe('Звонок');
    expect(channelInfo('bot').label).toBe('Бот в Telegram');
    expect(channelInfo(null)).toEqual({ label: '—', icon: 'chat' });
    expect(channelInfo('fax')).toEqual({ label: '—', icon: 'chat' });
  });

  it('typeName: тип направления или подпись вида', () => {
    expect(typeName([type()], 'd1', 'cargo')).toBe('Повреждение или недостача груза');
    expect(typeName([type()], 'd2', 'cargo')).toBe('Повреждение или недостача груза');
    expect(typeName([], 'd1', 'complaint')).toBe('Жалоба');
  });

  it('clientLine и channelLine', () => {
    expect(clientLine({ name: 'Наталья Гусева', company: 'ООО «Фермерская лавка»' })).toBe(
      'ООО «Фермерская лавка» · Наталья Гусева',
    );
    expect(clientLine({ name: 'Игорь Чернов' })).toBe('Игорь Чернов');
    expect(channelLine({ channel: 'sms', fromRating: 2 })).toBe('SMS · оценка 2 из 5');
    expect(channelLine({ channel: 'widget' })).toBe('Виджет на сайте');
  });

  it('initials: две буквы, пустое имя — «?»', () => {
    expect(initials('Дарья Зимина')).toBe('ДЗ');
    expect(initials('Анна')).toBe('А');
    expect(initials(' ')).toBe('?');
  });

  it('isOpen: решено и закрыто — не открытые', () => {
    expect(['new', 'work', 'wait'].every((s) => isOpen(s as 'new'))).toBe(true);
    expect(isOpen('resolved')).toBe(false);
    expect(isOpen('closed')).toBe(false);
  });
});

describe('права кнопок', () => {
  const can =
    (...keys: string[]) =>
    (...need: string[]) =>
      need.some((k) => keys.includes(k));
  const who = (name: string) => (m: { displayName: string }) => m.displayName === name;

  it('владелец: всё, кроме показа телефона без canContacts', () => {
    const r = rightsIn(dir, { owner: true, isMe: who('Дарья Зимина'), can: can() });
    expect(r).toMatchObject({
      reply: true,
      resolve: true,
      create: true,
      compensate: true,
      contacts: false,
      inTeam: true,
    });
  });

  it('специалист из команды: ответ и решение по ключам роли, компенсации нет, запись «я» найдена', () => {
    const r = rightsIn(dir, {
      owner: false,
      isMe: who('Марина Котова'),
      can: can('service.requests.reply', 'service.requests.resolve', 'service.requests.create'),
    });
    expect(r).toMatchObject({
      reply: true,
      resolve: true,
      create: true,
      compensate: false,
      inTeam: true,
    });
    expect(r.me).toEqual({ memberId: 'm-kotova', displayName: 'Марина Котова' });
  });

  it('не из команды направления: кнопок ответа и решения нет (PD-53)', () => {
    const r = rightsIn(dir, {
      owner: false,
      isMe: who('Кто-то другой'),
      can: can('service.requests.reply', 'service.requests.resolve'),
    });
    expect(r).toMatchObject({ reply: false, resolve: false, compensate: false, inTeam: false });
    expect(r.me).toBeUndefined();
  });

  it('совпадение по id участника', () => {
    const r = rightsIn(dir, {
      owner: false,
      isMe: (m) => m.memberId === 'm-kotova',
      can: can('service.requests.reply'),
    });
    expect(r).toMatchObject({ reply: true, resolve: false, inTeam: true });
  });

  it('компенсация — ключ service.compensation.manage и «Решать»', () => {
    const r = rightsIn(dir, {
      owner: false,
      isMe: who('Марина Котова'),
      can: can('service.requests.resolve', 'service.compensation.manage'),
    });
    expect(r.compensate).toBe(true);
    const noResolve = rightsIn(dir, {
      owner: false,
      isMe: who('Марина Котова'),
      can: can('service.compensation.manage'),
    });
    expect(noResolve.compensate).toBe(false);
  });

  it('руководитель направления видит телефон по canContacts; без направления — ничего', () => {
    expect(
      rightsIn({ ...dir, canContacts: true }, { owner: false, isMe: () => false, can: can() })
        .contacts,
    ).toBe(true);
    expect(rightsIn(undefined, { owner: true, isMe: () => true, can: can() }).reply).toBe(false);
  });

  it('canTake: открыто, без исполнителя, ответ и команда', () => {
    expect(canTake({ assignee: null, status: 'new' }, allRights())).toBe(true);
    expect(canTake({ assignee: ref('m', 'Имя'), status: 'new' }, allRights())).toBe(false);
    expect(canTake({ assignee: null, status: 'resolved' }, allRights())).toBe(false);
    expect(canTake({ assignee: null, status: 'new' }, allRights({ reply: false }))).toBe(false);
    expect(canTake({ assignee: null, status: 'new' }, allRights({ inTeam: false }))).toBe(false);
  });
});
describe('действия карточки', () => {
  const labels = (s: Parameters<typeof cardActions>[0], rt = allRights(), n = 4) =>
    cardActions(s, rt, n, 'ГРЗ-57').map((a) => `${a.primary ? '*' : ''}${a.label}`);

  it('new: «Взять в работу» главная, ждём клиента, решено, перенос', () => {
    expect(labels('new')).toEqual([
      '*Взять в работу',
      'Ждём клиента',
      'Решено…',
      'В другое направление…',
    ]);
  });

  it('work: «Решено…» главная', () => {
    expect(labels('work')).toEqual(['Ждём клиента', '*Решено…', 'В другое направление…']);
  });

  it('wait: «Вернуть в работу» главная, решено', () => {
    expect(labels('wait')).toEqual(['*Вернуть в работу', 'Решено…']);
  });

  it('resolved: вернуть и закрыть; closed — пусто', () => {
    expect(labels('resolved')).toEqual(['Вернуть в работу', '*Закрыть']);
    expect(labels('closed')).toEqual([]);
  });

  it('одно направление — переноса нет', () => {
    expect(labels('new', allRights(), 1)).toEqual(['*Взять в работу', 'Ждём клиента', 'Решено…']);
  });

  it('без «Решать» нет «Решено…» и «Закрыть», без «Отвечать» — переходов', () => {
    expect(labels('work', allRights({ resolve: false }))).toEqual([
      'Ждём клиента',
      'В другое направление…',
    ]);
    expect(labels('resolved', allRights({ reply: false }))).toEqual(['*Закрыть']);
    expect(labels('new', allRights({ reply: false, resolve: false }))).toEqual([]);
  });

  it('переходы и тосты: статус и текст', () => {
    const a = cardActions('new', allRights(), 4, 'ГРЗ-57');
    expect(a[0]).toMatchObject({ to: 'work', toast: 'ГРЗ-57 в работе' });
    expect(a[1]).toMatchObject({ to: 'wait', toast: 'Срок на паузе: ждём клиента' });
    expect(a[2]?.to).toBeUndefined();
    expect(cardActions('wait', allRights(), 4, 'K')[0]?.toast).toBe('Срок снова идёт');
    const r = cardActions('resolved', allRights(), 4, 'ГРЗ-57');
    expect(r[0]?.toast).toBe('ГРЗ-57 снова в работе');
    expect(r[1]).toMatchObject({ to: 'closed', toast: 'ГРЗ-57 закрыто' });
  });

  it('итоги решения: у жалобы на сотрудника — два', () => {
    expect(outcomesOf(false)).toEqual([
      'Устранено',
      'Разъяснено',
      'Компенсация',
      'Не подтвердилось',
      'Дубль',
    ]);
    expect(outcomesOf(true)).toEqual(['Подтвердилась', 'Не подтвердилась']);
  });
});

describe('компенсация и звонок', () => {
  it('подписи компенсаций → виды контракта', () => {
    expect(COMPENSATION_OPTIONS.map((o) => o.kind)).toEqual([
      'discount20',
      'discount10',
      'repeat_visit',
      'refund',
    ]);
    expect(compensationKind('Скидка 20% на следующий визит')).toBe('discount20');
    expect(compensationKind('Возврат денег — через кассу')).toBe('refund');
    expect(compensationKind('')).toBeUndefined();
  });

  it('calendarMinutes: «08:00»–«20:00», дни ISO → 0–6', () => {
    expect(calendarMinutes(dir.calendar)).toEqual({
      from: 480,
      to: 1200,
      days: [0, 1, 2, 3, 4, 5, 6],
    });
  });

  it('callHint: первый ответ в рабочем времени и срок по закону', () => {
    expect(callHint(type(), dir)).toBe(
      'Канал «звонок», исполнитель — вы. Первый ответ — 4 ч в рабочем времени направления, по закону — 30 дней.',
    );
    expect(callHint(type({ firstMinutes: null, legalDays: null }), dir)).toBe(
      'Канал «звонок», исполнитель — вы. Без срока ответа.',
    );
    expect(callHint(undefined, dir)).toBe('');
    expect(callHint(type(), undefined)).toBe('');
  });

  it('callHint: рабочие дни в сроке при шестидневке', () => {
    const six = {
      ...dir,
      calendar: { ...dir.calendar, days: [1, 2, 3, 4, 5], from: '09:00', to: '19:00' },
    };
    expect(callHint(type({ firstMinutes: 1200, legalDays: null }), six)).toBe(
      'Канал «звонок», исполнитель — вы. Первый ответ — 2 раб. дня в рабочем времени направления.',
    );
  });

  it('callTypes: типы направления без «Благодарности»', () => {
    const list = [
      type(),
      type({ id: 'd1:thanks', kind: 'thanks' }),
      type({ id: 'd2:cargo', directionId: 'd2' }),
    ];
    expect(callTypes(list, 'd1').map((t) => t.kind)).toEqual(['cargo']);
  });
});

describe('лента и боковая колонка', () => {
  const R = {
    channel: 'sms' as const,
    client: { name: 'Ольга Романова', phoneMasked: '+7 ••• •••-••-18', since: '' },
  };
  const msg = (over: Partial<Message>): Message => ({
    id: 'x',
    kind: 'client',
    at: '2026-10-01T12:12:00Z', // 15:12 по Москве
    text: 'Текст',
    files: [],
    ...over,
  });

  it('fileIcon', () => {
    expect(fileIcon('Акт.pdf')).toBe('picture_as_pdf');
    expect(fileIcon('Фото 1.JPG')).toBe('image');
    expect(fileIcon('Таблица.xlsx')).toBe('draft');
  });

  it('системная запись — одна строка с временем', () => {
    const f = feedItem(msg({ kind: 'system', text: 'Заведено по звонку' }), R, NOW);
    expect(f).toMatchObject({ system: true, text: 'Заведено по звонку', at: 'сегодня, 15:12' });
  });

  it('сообщение клиента: имя клиента, канал и время, файлы', () => {
    const f = feedItem(
      msg({ files: [{ id: 'f', fileName: 'Фото 1.jpg', sizeBytes: 1, status: 'ready' }] }),
      R,
      NOW,
    );
    expect(f).toMatchObject({ by: 'Ольга Романова', initials: 'ОР', meta: 'SMS · сегодня, 15:12' });
    expect(f.files).toEqual([{ name: 'Фото 1.jpg', icon: 'image' }]);
  });

  it('ответ клиенту: «Клиент видит»; автоответ — значок молнии', () => {
    const a = feedItem(msg({ kind: 'public', author: ref('m', 'Дарья Зимина') }), R, NOW);
    expect(a).toMatchObject({
      by: 'Дарья Зимина',
      initials: 'ДЗ',
      tag: { label: 'Клиент видит', tone: 'ok' },
    });
    const auto = feedItem(msg({ kind: 'public', auto: true, channel: 'bot' }), R, NOW);
    expect(auto).toMatchObject({
      by: 'Автоответ клиенту',
      icon: 'bolt',
      initials: '',
      meta: 'Бот в Telegram · сегодня, 15:12',
    });
  });

  it('внутренняя заметка: фон заметки и подпись «клиент не видит»', () => {
    const n = feedItem(msg({ kind: 'note', author: ref('m', 'Дарья Зимина') }), R, NOW);
    expect(n).toMatchObject({
      avatar: 'note',
      meta: 'сегодня, 15:12',
      tag: { label: 'Внутренняя заметка · клиент не видит', tone: 'warn' },
    });
  });

  it('оценка: фишки балла, причин и «Просит связаться»; 1–3 — плохая', () => {
    const low = feedItem(
      msg({
        kind: 'rating',
        score: 2,
        reasons: ['Опоздание начала'],
        contact: true,
        text: 'Холодно',
      }),
      R,
      NOW,
    );
    expect(low).toMatchObject({
      icon: 'sentiment_dissatisfied',
      avatar: 'low',
      text: '«Холодно»',
      meta: 'оценка после услуги · сегодня, 15:12',
    });
    expect(low.chips.map((c) => c.label)).toEqual([
      '★ 2 из 5',
      'Опоздание начала',
      'Просит связаться',
    ]);
    expect(low.chips[0]).toMatchObject({ tone: 'danger', strong: true });
    const good = feedItem(msg({ kind: 'rating', score: 5, text: '' }), R, NOW);
    expect(good).toMatchObject({ icon: 'sentiment_satisfied', avatar: 'good', text: '' });
    expect(good.chips[0]?.tone).toBe('ok');
  });

  it('sendNote: канал и маска телефона для SMS и звонка', () => {
    expect(sendNote(R, false)).toEqual({
      icon: 'sms',
      text: 'Уйдёт: SMS на +7 ••• •••-••-18 — канал обращения',
    });
    expect(sendNote({ ...R, channel: 'bot' }, false).text).toBe(
      'Уйдёт: Бот в Telegram — канал обращения',
    );
    expect(sendNote(R, true)).toEqual({ icon: 'lock', text: 'Заметку клиент не увидит' });
  });

  it('cardMeta: создано, канал, прежний номер', () => {
    expect(cardMeta({ createdAt: '2026-10-01T12:12:00Z', channel: 'sms' }, NOW)).toBe(
      'Создано сегодня, 15:12 · SMS',
    );
    expect(
      cardMeta(
        { createdAt: '2026-10-01T12:12:00Z', channel: 'sms', oldKeys: ['МАС-9', 'КОС-2'] },
        NOW,
      ),
    ).toBe('Создано сегодня, 15:12 · SMS · прежний номер МАС-9, КОС-2');
  });

  it('fillReply: имя, номер, срок', () => {
    const r = {
      key: 'МАС-41',
      client: R.client,
      head: { state: 'norm', label: '', text: '', until: 'до 18:24', rank: 0 } as const,
    };
    expect(fillReply('{имя}, приняли {номер}. Ответим {срок}.', r)).toBe(
      'Ольга, приняли МАС-41. Ответим до 18:24.',
    );
    expect(fillReply('Ответим {срок}', { ...r, head: { ...r.head, until: '' } })).toBe(
      'Ответим в течение рабочего дня',
    );
  });

  it('afterText: открытое и решённое, с компенсацией', () => {
    expect(afterText({ status: 'work', key: 'МАС-41' })).toBe(
      'Клиенту придёт вопрос «Довольны ли решением?» — одна оценка на обращение. Возврат денег проводится только кассой с основанием МАС-41.',
    );
    expect(
      afterText({ status: 'work', key: 'МАС-41', compensation: 'Скидка 20% на следующий визит' }),
    ).toContain(' Компенсация: Скидка 20% на следующий визит. Возврат');
    expect(afterText({ status: 'resolved', key: 'K', outcome: 'Устранено' })).toBe(
      'Итог: Устранено. Клиенту отправлен вопрос «Довольны ли решением?». «Не решён» в течение 5 дней вернёт обращение в работу.',
    );
    expect(afterText({ status: 'closed', key: 'K', outcome: null })).toContain('Итог: —.');
  });

  it('ratingText и подзаголовок очереди, etag', () => {
    expect(ratingText({ reasons: ['Опоздание', 'Холодно'], comment: 'Не понравилось' })).toBe(
      'Опоздание, Холодно · «Не понравилось»',
    );
    expect(ratingText({ reasons: [], comment: 'Плохо' })).toBe('«Плохо»');
    expect(ratingText({ reasons: ['Холодно'], comment: '' })).toBe('Холодно');
    expect(queueSubtitle(null, 'Открытые')).toBe(
      'Все мои направления · открытые · сначала самый ранний срок',
    );
    expect(queueSubtitle('Массаж', 'Срок под угрозой')).toBe(
      'Массаж · срок под угрозой · сначала самый ранний срок',
    );
    expect(etag(3)).toBe('"rev-3"');
  });
});

describe('подпись «Направление» в боковой колонке (dirText эталона: «название · модуль»)', () => {
  it('вместо ключа модуля — его название из каталога', () => {
    expect(directionText(dir)).toBe('Грузоперевозки · Логистика');
    expect(directionText({ ...dir, name: 'Массаж', moduleKey: 'spa' })).toBe(
      'Массаж · Салон и SPA',
    );
    expect(directionText({ ...dir, name: 'Ремонт', moduleKey: 'repairs' })).toBe(
      'Ремонт · Ремонт и стройка',
    );
  });

  it('ключ клиенту не показывается: неизвестный модуль — только название направления', () => {
    const text = directionText({ ...dir, moduleKey: 'zzz' });
    expect(text).toBe('Грузоперевозки');
    expect(text).not.toContain('zzz');
    expect(directionText(undefined)).toBe('');
  });
});

describe('проверки до отправки (тексты сервера эталона, service.js 312–317, 346)', () => {
  const ok = {
    directionId: 'd1',
    typeId: 'd1:cargo',
    clientName: 'Пётр Иванов',
    phone: '+7 900 111-22-33',
    text: 'Не доехал груз',
  };

  it('callError: по порядку полей эталона', () => {
    expect(callError(ok)).toBeNull();
    expect(callError({ ...ok, directionId: '' })).toBe('Выберите направление');
    expect(callError({ ...ok, typeId: '' })).toBe('Выберите тип обращения');
    expect(callError({ ...ok, clientName: ' П ' })).toBe('Укажите имя клиента');
    expect(callError({ ...ok, phone: '+7 900 111' })).toBe('Телефон — не меньше 10 цифр');
    expect(callError({ ...ok, text: '   ' })).toBe('Опишите, что случилось');
  });

  it('первая ошибка перекрывает остальные', () => {
    expect(callError({ ...ok, directionId: '', clientName: '', text: '' })).toBe(
      'Выберите направление',
    );
  });

  it('taskError: тема не короче 3 символов', () => {
    expect(taskError('Хм')).toBe('Тема задачи — не короче 3 символов');
    expect(taskError('  Хм  ')).toBe('Тема задачи — не короче 3 символов');
    expect(taskError('Позвонить')).toBeNull();
  });

  it('SERVICE_KEYS: ключи роли «Обращений» контракта', () => {
    expect(SERVICE_KEYS).toEqual([
      'service.requests.read',
      'service.requests.create',
      'service.requests.reply',
      'service.requests.resolve',
      'service.clients.contacts',
      'service.compensation.manage',
    ]);
  });
});

describe('права кнопок: контекст без ключей «Обращений» (Q-W7.32-1)', () => {
  const who = (name: string) => (m: { displayName: string }) => m.displayName === name;

  it('ключи не опубликованы вовсе — «Решать» и «Заводить» по команде направления; сервер проверит', () => {
    const r = rightsIn(dir, {
      owner: false,
      isMe: who('Марина Котова'),
      can: () => false,
      keysKnown: false,
    });
    expect(r).toMatchObject({
      reply: true,
      resolve: true,
      create: true,
      compensate: false,
      inTeam: true,
    });
  });

  it('ключи есть — используются только они', () => {
    const r = rightsIn(dir, {
      owner: false,
      isMe: who('Марина Котова'),
      can: (...k: string[]) => k.includes('service.requests.reply'),
      keysKnown: true,
    });
    expect(r).toMatchObject({ reply: true, resolve: false, create: false });
  });
});
