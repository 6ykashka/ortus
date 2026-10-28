// W7.13 · Модель страницы «Чаты»: подписи, отметки прочтения, опрос, «важное», меню сообщения, поле ввода.
import { describe, expect, it } from 'vitest';

import {
  type ChatCan,
  type ChatMessage,
  type ChatPolicy,
  type ChatSummary,
  chatIcon,
  chatSub,
  composerHint,
  dayLabel,
  importantDue,
  importantNote,
  inEditWindow,
  initials,
  lastLine,
  layoutOf,
  listTime,
  matrixOf,
  menuOf,
  nextTtl,
  pageSub,
  plural,
  policyDiff,
  policyFacts,
  policyNote,
  policyRowSummary,
  pollView,
  quotaState,
  readOnlyReason,
  sizeLabel,
  tickOf,
} from './model.ts';
import { CHAT_TEXT } from './texts.ts';

const NOW = Date.parse('2026-10-01T09:30:00+03:00');
const CAN: ChatCan = {
  write: true,
  files: true,
  polls: true,
  moderate: false,
  pin: false,
  announce: false,
  receipts: false,
  pdn: false,
  ephemeral: false,
  viewOnce: false,
  members: false,
  settings: false,
  saveToRecord: false,
  task: false,
};
const POLICY: ChatPolicy = {
  textYears: 3,
  filesDays: 365,
  voiceDays: 90,
  receipts: 'ticks',
  receiptsDays: 30,
  deletedDays: 30,
  edit: '48h',
  maxFileMb: 200,
  quotaMb: 5000,
  temp: 'off',
  forward: 'internal',
  pdnMask: true,
  onFull: 'block',
};

const msg = (o: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  seq: 1,
  createdAt: '2026-10-01T06:00:00Z',
  authorDisplayName: 'Марина Котова',
  kind: 'text',
  text: 'Привет',
  masked: false,
  attachments: [],
  tasks: [],
  ...o,
});

const summary = (o: Partial<ChatSummary> = {}): ChatSummary => ({
  id: 'c1',
  kind: 'group',
  title: 'Группа',
  status: 'active',
  sensitivity: 'normal',
  my: { role: 'member', unread: 0, ackWaitCount: 0, lastReadSeq: 0 },
  revision: 1,
  ...o,
});

describe('форматы', () => {
  it('plural: число и форма', () => {
    expect(plural(1, 'участник', 'участника', 'участников')).toBe('1 участник');
    expect(plural(3, 'участник', 'участника', 'участников')).toBe('3 участника');
    expect(plural(11, 'участник', 'участника', 'участников')).toBe('11 участников');
    expect(plural(21, 'участник', 'участника', 'участников')).toBe('21 участник');
  });

  it('sizeLabel: МБ и ГБ с запятой', () => {
    expect(sizeLabel(4.2 * 1024 * 1024)).toBe('4,2 МБ');
    expect(sizeLabel(200 * 1024 * 1024)).toBe('200 МБ');
    expect(sizeLabel(4600 * 1024 * 1024)).toBe('4,6 ГБ');
    expect(sizeLabel(5000 * 1024 * 1024)).toBe('5 ГБ');
  });

  it('время в поясе Москвы: список и разделитель дня', () => {
    expect(listTime('2026-10-01T06:12:00Z', NOW)).toBe('09:12');
    expect(listTime('2026-09-30T15:00:00Z', NOW)).toBe('Вчера');
    expect(listTime('2026-09-20T15:00:00Z', NOW)).toBe('20.09');
    expect(dayLabel('2026-10-01T06:12:00Z', NOW)).toBe('Сегодня · 01.10');
    expect(dayLabel('2026-09-30T06:12:00Z', NOW)).toBe('30.09');
  });

  it('инициалы и раскладка по ширине контейнера', () => {
    expect(initials('Илья Васильев')).toBe('ИВ');
    expect(layoutOf(390)).toBe('narrow');
    expect(layoutOf(759)).toBe('narrow');
    expect(layoutOf(760)).toBe('wide');
    expect(layoutOf(1099)).toBe('wide');
    expect(layoutOf(1100)).toBe('three');
  });

  it('срок «важного» — +3 календарных дня', () => {
    expect(importantDue(NOW)).toBe('2026-10-04');
  });
});

describe('список', () => {
  const last = (kind: NonNullable<ChatSummary['lastMessage']>['kind'], text: string, who: string) =>
    ({ seq: 2, at: '2026-10-01T06:00:00Z', authorDisplayName: who, text, kind }) as const;

  it('последняя строка: «Вы», имя, опрос, файл, документ, служебное', () => {
    expect(lastLine(summary(), 'Дарья Зимина')).toBe('Сообщений пока нет');
    expect(
      lastLine(summary({ lastMessage: last('text', 'Принял', 'Дарья Зимина') }), 'Дарья Зимина'),
    ).toBe('Вы: Принял');
    expect(
      lastLine(summary({ lastMessage: last('text', 'Принял', 'Илья Васильев') }), 'Дарья Зимина'),
    ).toBe('Илья: Принял');
    expect(
      lastLine(
        summary({ kind: 'direct', lastMessage: last('text', 'Принял', 'Илья Васильев') }),
        'Дарья Зимина',
      ),
    ).toBe('Принял');
    expect(
      lastLine(summary({ lastMessage: last('poll', 'Кто в субботу?', 'Марина Котова') }), 'Я'),
    ).toBe('Марина: Опрос · Кто в субботу?');
    expect(
      lastLine(summary({ lastMessage: last('file', 'Стена.jpg', 'Марина Котова') }), 'Я'),
    ).toBe('Марина: Файл · Стена.jpg');
    expect(
      lastLine(summary({ lastMessage: last('document', 'Договор', 'Марина Котова') }), 'Я'),
    ).toBe('Марина: Документ · Договор');
    expect(
      lastLine(summary({ lastMessage: last('system', 'Критический дефект', 'Система') }), 'Я'),
    ).toBe('Критический дефект');
  });

  it('подзаголовок страницы: непрочитанные и ожидающие подтверждения', () => {
    const rows = [
      summary({ my: { role: 'member', unread: 2, ackWaitCount: 1, lastReadSeq: 0 } }),
      summary({ my: { role: 'member', unread: 1, ackWaitCount: 0, lastReadSeq: 0 } }),
    ];
    expect(pageSub(rows)).toBe(
      '3 непрочитанных · 1 ждёт подтверждения · состав и права — из «Пользователей и ролей»',
    );
    expect(pageSub([])).toBe('состав и права — из «Пользователей и ролей»');
  });

  it('значок: чат записи — по рейсу или объекту', () => {
    const rec = (entityType: string) =>
      ({
        kind: 'record',
        record: { object: { moduleKey: 'x', entityType, entityId: 'i' }, label: 'Р' },
      }) as Pick<ChatSummary, 'kind' | 'record'>;
    expect(chatIcon(rec('trip'))).toBe('local_shipping');
    expect(chatIcon(rec('project'))).toBe('home_work');
    expect(chatIcon({ kind: 'announce' })).toBe('campaign');
    expect(chatIcon({ kind: 'direct' })).toBe('person');
  });
});

describe('шапка чата', () => {
  it('«Чат записи · N участников · фирма · Финансы»', () => {
    const c = { kind: 'record', memberCount: 5, sensitivity: 'finance' } as never;
    expect(chatSub(c, 'Север Логистик')).toBe(
      'Чат записи · 5 участников · Север Логистик · Финансы',
    );
    expect(
      chatSub({ kind: 'announce', memberCount: 1, sensitivity: 'normal' } as never, null),
    ).toBe('Объявления · 1 участник · вся организация');
  });
});

describe('сообщение', () => {
  it('окно правки: 15 минут, 48 часов, без срока', () => {
    const t = '2026-10-01T06:00:00Z';
    expect(inEditWindow(t, '15m', Date.parse(t) + 14 * 60_000)).toBe(true);
    expect(inEditWindow(t, '15m', Date.parse(t) + 16 * 60_000)).toBe(false);
    expect(inEditWindow(t, '48h', Date.parse(t) + 47 * 3600_000)).toBe(true);
    expect(inEditWindow(t, '48h', Date.parse(t) + 49 * 3600_000)).toBe(false);
    expect(inEditWindow(t, 'none', Date.parse(t) + 9999 * 3600_000)).toBe(true);
  });

  const menu = (o: Partial<Parameters<typeof menuOf>[0]>) =>
    menuOf({
      m: msg(),
      mine: false,
      can: CAN,
      policy: POLICY,
      now: Date.parse('2026-10-01T07:00:00Z'),
      pinnedId: null,
      recordKind: null,
      ...o,
    }).map((i) => i.action);

  it('меню: чужое сообщение — только сведения', () => {
    expect(menu({})).toEqual(['info']);
  });

  it('меню: своё в окне — править и удалить; после окна — только сведения', () => {
    expect(menu({ mine: true })).toEqual(['info', 'edit', 'delete']);
    expect(menu({ mine: true, now: Date.parse('2026-10-05T00:00:00Z') })).toEqual(['info']);
  });

  it('меню: модератор удаляет чужое, закрепляет, сохраняет в запись, создаёт задачу', () => {
    const can = { ...CAN, moderate: true, pin: true, saveToRecord: true, task: true };
    const files = [
      { id: 'a', fileName: 'x.jpg', sizeBytes: 1, kind: 'photo', viewOnce: false, gone: false },
    ] as ChatMessage['attachments'];
    expect(menu({ can, m: msg({ attachments: files }), recordKind: 'trip' })).toEqual([
      'info',
      'deleteMod',
      'pin',
      'save',
      'task',
    ]);
    expect(menu({ can, pinnedId: 'm1' })).toContain('unpin');
    const labels = menuOf({
      m: msg({ attachments: files }),
      mine: false,
      can,
      policy: POLICY,
      now: Date.parse('2026-10-01T07:00:00Z'),
      pinnedId: null,
      recordKind: 'trip',
    }).map((i) => i.label);
    expect(labels).toContain('Сохранить в рейс');
  });

  it('меню: удалённое — только сведения; одноразовые и сохранённые файлы не предлагают сохранение', () => {
    const can = { ...CAN, moderate: true, saveToRecord: true };
    expect(
      menu({
        can,
        m: msg({ deleted: { byDisplayName: 'Я', at: '2026-10-01T06:00:00Z', moderator: false } }),
      }),
    ).toEqual(['info']);
    const once = [
      { id: 'a', fileName: 'x', sizeBytes: 1, kind: 'doc', viewOnce: true, gone: false },
    ] as ChatMessage['attachments'];
    expect(menu({ can, m: msg({ attachments: once }) })).not.toContain('save');
  });

  it('отметка своего сообщения: «Доставлено», «Прочитали N из M», «N из M»', () => {
    const m = msg({ reads: { readCount: 1, totalCount: 3 } });
    expect(tickOf(m, 'off')).toEqual({ icon: 'check', text: 'Доставлено' });
    expect(tickOf(m, 'who')).toEqual({ icon: 'done_all', text: 'Прочитали 1 из 3' });
    expect(tickOf(m, 'ticks')).toEqual({ icon: 'done_all', text: '1 из 3' });
    expect(tickOf(msg({ reads: { readCount: 0, totalCount: 3 } }), 'ticks')?.icon).toBe('check');
    expect(tickOf(msg({ kind: 'system' }), 'ticks')).toBeNull();
  });

  it('«важное»: автор, получатель, подтвердивший, модератор', () => {
    const imp = (mine?: { required: boolean; done: boolean }) =>
      msg({
        important: { dueDate: '2026-10-31', ackCount: 1, totalCount: 4, ...(mine ? { mine } : {}) },
      });
    expect(importantNote(imp(), true, false)).toEqual({
      text: 'Подтвердили 1 из 4',
      canAck: false,
    });
    expect(importantNote(imp({ required: true, done: false }), false, false)).toEqual({
      text: 'Подтвердите, что прочитали',
      canAck: true,
    });
    expect(importantNote(imp({ required: true, done: false }), false, true)?.text).toBe(
      'Подтвердите, что прочитали · подтвердили 1 из 4',
    );
    expect(importantNote(imp({ required: false, done: true }), false, false)).toEqual({
      text: 'Вы подтвердили',
      canAck: false,
    });
    expect(importantNote(msg(), false, false)).toBeNull();
  });

  const poll = (o: Partial<NonNullable<ChatMessage['poll']>> = {}) =>
    msg({
      kind: 'poll',
      poll: {
        id: 'p1',
        question: 'Когда?',
        options: [
          {
            id: 'o1',
            text: 'Утром',
            votes: 2,
            mine: false,
            voters: ['Илья Васильев', 'Вера Котельникова'],
          },
          { id: 'o2', text: 'Вечером', votes: 1, mine: true, voters: ['Дарья Зимина'] },
        ],
        anonymous: false,
        multiple: false,
        closesAt: '2026-10-03T15:00:00Z',
        closed: false,
        totalVoters: 3,
        myVotes: [],
        ...o,
      },
    });

  it('опрос: результаты скрыты до голоса, видны автору, модератору и после закрытия', () => {
    const hidden = pollView(poll(), false, false, 5);
    expect(hidden?.showResults).toBe(false);
    expect(hidden?.options.map((o) => o.value)).toEqual(['', '']);
    expect(pollView(poll({ myVotes: ['o2'] }), false, false, 5)?.options[1]?.value).toBe(
      '1 · 33 %',
    );
    expect(pollView(poll(), true, false, 5)?.showResults).toBe(true);
    expect(pollView(poll(), false, true, 5)?.showResults).toBe(true);
    expect(pollView(poll({ closed: true }), false, false, 5)?.showResults).toBe(true);
  });

  it('опрос: подпись «Открытый · один вариант · закроется … · проголосовали N из M» и закрытие', () => {
    const v = pollView(poll(), true, false, 5);
    expect(v?.meta).toBe(
      'Открытый · один вариант · закроется 03.10 в 18:00 · проголосовали 3 из 5',
    );
    expect(v?.canClose).toBe(true);
    expect(v?.options[0]?.voters).toBe('Илья, Вера');
    expect(pollView(poll(), false, false, 5)?.canClose).toBe(false);
    expect(
      pollView(poll({ closed: true, anonymous: true, multiple: true }), true, false, 5),
    ).toMatchObject({
      canClose: false,
    });
    expect(pollView(poll({ anonymous: true, multiple: true }), true, false, 5)?.meta).toContain(
      'Анонимный · несколько вариантов',
    );
    expect(pollView(poll({ anonymous: true }), true, false, 5)?.options[0]?.voters).toBe('');
  });
});

describe('поле ввода', () => {
  it('подсказка: важное, срок, одноразовый, документ, предел файла', () => {
    expect(
      composerHint({
        important: true,
        ttlHours: 1,
        viewOnce: true,
        docTitle: 'Договор',
        maxFileMb: 200,
      }),
    ).toBe('важное · исчезнет через 1 ч · одноразовый файл · документ: Договор · до 200 МБ');
    expect(
      composerHint({
        important: false,
        ttlHours: 168,
        viewOnce: false,
        docTitle: null,
        maxFileMb: 2000,
      }),
    ).toBe('исчезнет через 7 дн · до 2 ГБ');
  });

  it('срок временного сообщения идёт по кругу', () => {
    expect([0, 1, 24, 168].map(nextTtl)).toEqual([1, 24, 168, 0]);
  });

  it('причина «только чтение»: архив, объявления, читатель', () => {
    const c = (o: object) => ({ status: 'active', kind: 'group', ...o }) as never;
    expect(readOnlyReason(c({ status: 'archived' }))).toBe(
      'Чат в архиве: только чтение, поиск и выгрузка работают',
    );
    expect(readOnlyReason(c({ kind: 'announce' }))).toBe(
      'В объявлениях пишут модераторы. Вы читаете и подтверждаете важное',
    );
    expect(readOnlyReason(c({}))).toBe(
      'У вас роль «Читатель»: можно читать, голосовать и подтверждать',
    );
  });
});

describe('хранение и политики', () => {
  it('порог места: 75 % и 90 % — предупреждение, 100 % — ошибка, без лимита — нет процента', () => {
    expect(quotaState(1000, 5000)).toEqual({ pct: 20, tone: 'ok' });
    expect(quotaState(4600, 5000)).toEqual({ pct: 92, tone: 'warn' });
    expect(quotaState(5000, 5000)).toEqual({ pct: 100, tone: 'danger' });
    expect(quotaState(100, null)).toEqual({ pct: null, tone: 'ok' });
  });

  it('policyDiff оставляет только изменённые поля', () => {
    expect(policyDiff(POLICY, { textYears: 3, filesDays: 90, receipts: 'who' })).toEqual({
      filesDays: 90,
      receipts: 'who',
    });
    expect(policyDiff(POLICY, {})).toEqual({});
  });
});

describe('права и политика вида', () => {
  it('матрица: три группы, замки политики, объявления — писать только модераторам', () => {
    const g = matrixOf(POLICY, 'group');
    expect(g.map((x) => x.title)).toEqual([
      'Сообщения',
      'Участники и модерация',
      'Чтение и защита',
    ]);
    expect(g[0]?.rows[0]).toEqual({
      title: 'Писать сообщения',
      cells: ['y', 'y', 'y', 'n'],
      limit: '',
    });
    expect(g[0]?.rows[1]?.limit).toBe('До 200 МБ · фото сжимаются');
    // прочтение «Галочки» — замок, временные запрещены — замок
    expect(g[2]?.rows[0]?.cells).toEqual(['l', 'l', 'l', 'l']);
    expect(g[2]?.rows[2]?.cells).toEqual(['l', 'l', 'l', 'l']);
    const a = matrixOf({ ...POLICY, receipts: 'who', temp: 'allowed', forward: 'off' }, 'announce');
    expect(a[0]?.rows[0]).toEqual({
      title: 'Писать сообщения',
      cells: ['y', 'y', 'n', 'n'],
      limit: 'В объявлениях пишут модераторы',
    });
    expect(a[2]?.rows[0]?.cells).toEqual(['y', 'y', 'y', 'n']);
    expect(a[2]?.rows[2]?.cells).toEqual(['y', 'y', 'n', 'n']);
    expect(a[2]?.rows[4]?.cells).toEqual(['l', 'l', 'l', 'l']);
  });

  it('политика вида: строки вкладки «Права» и «Политик»', () => {
    const f = policyFacts(POLICY, 'record');
    expect(f[0]).toEqual({ k: 'Текст', v: '3 г. после закрытия записи' });
    expect(f.map((x) => x.k)).toEqual([
      'Текст',
      'Вложения',
      'Голосовые',
      'Прочтение',
      'Правка своих',
      'Файл до',
      'Временные',
      'Пересылка',
    ]);
    expect(policyRowSummary(POLICY)).toEqual([
      'Текст 3 г. · файлы 365 дн.',
      'Файл до 200 МБ · 5 ГБ на чат',
      'Галочки · 30 дн.',
      'Временные: Запрещены',
    ]);
  });
});

describe('подписи эталона (возврат 1)', () => {
  it('policyNote: строка политики подвала «Нового чата» дословно по эталону Чаты.dc.html:739', () => {
    expect(policyNote('Рабочие группы', { ...POLICY, receipts: 'who' })).toBe(
      'Политика вида «Рабочие группы»: текст 3 г., файл до 200 МБ, 5 ГБ на чат, прочтение — «Кто и когда»',
    );
    expect(policyNote('Личные', { ...POLICY, quotaMb: null, receipts: 'ticks' })).toBe(
      'Политика вида «Личные»: текст 3 г., файл до 200 МБ, прочтение — «Галочки»',
    );
  });

  it('nw.auto: подпись под «Кто войдёт» дословно по эталону Чаты.dc.html:417', () => {
    expect(CHAT_TEXT.nw.auto).toBe(
      'Состав по роли и группе дальше меняется сам: новые сотрудники войдут, уволенные и заблокированные выйдут, их сообщения останутся в чате.',
    );
  });

  it('метка чата и кнопка источника — как в эталоне (:393, :220)', () => {
    expect(CHAT_TEXT.nw.label).toBe('Метка');
    expect(CHAT_TEXT.nw.labelGroup).toBe('Метка чата');
    expect(CHAT_TEXT.side.removeSource).toBe('Убрать источник');
    expect(CHAT_TEXT.nw.remove).toBe('Убрать');
    expect(CHAT_TEXT.nw.close).toBe('Закрыть');
    expect(CHAT_TEXT.chat.msgsFailed).toBe('Не удалось загрузить сообщения');
    expect(CHAT_TEXT.chat.msgsForbidden).toContain('нет права');
  });
});
