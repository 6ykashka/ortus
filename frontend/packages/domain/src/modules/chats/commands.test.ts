// Команды сообщений чатов (chats.js 14.10:378–499): успех, каждая ошибка дословно, события,
// проверки до изменений. Исправления PD-60: удалённое не оживает, удержание защищает, один разбор
// `@все`, упоминание — только участнику чата, задача из сообщения через `TaskPort`.
import { describe, expect, it } from 'vitest';
import { chatOf } from './fixture.test-util.ts';
import { apiErr } from './fixture.test-util.ts';
import { CHAT_DELAYS, CHAT_METHODS } from './commands.ts';
import { harness } from './harness.test-util.ts';
import { ALL_RE } from './storage.ts';

const TITLE_DRV = 'Водители · Север Логистик';
const forbidden = (message: string) => ({ code: 'forbidden', message });
const invalid = (message: string) => ({ code: 'validation', message });
const missing = { code: 'not_found', message: 'Чат не найден или недоступен' };

describe('реестр методов и задержки', () => {
  it('17 команд сообщений и настроек; chatTick (демо-часы) не переносится', () => {
    expect(CHAT_METHODS).toEqual([
      'chatOpen',
      'chatSend',
      'chatEdit',
      'chatDelete',
      'chatAck',
      'chatVote',
      'chatPollClose',
      'chatPin',
      'chatReveal',
      'chatOpenOnce',
      'chatSaveTo',
      'chatToTask',
      'chatCreate',
      'chatSources',
      'chatSetFull',
      'chatCleanup',
      'chatPolicySet',
    ]);
    expect(CHAT_METHODS).not.toContain('chatTick');
  });

  it('задержки эталона, chatOpen — без сети', () => {
    expect(CHAT_DELAYS).toEqual({
      chatOpen: 0,
      chatSend: 240,
      chatEdit: 200,
      chatDelete: 220,
      chatAck: 220,
      chatVote: 200,
      chatPollClose: 220,
      chatPin: 180,
      chatReveal: 200,
      chatOpenOnce: 260,
      chatSaveTo: 260,
      chatToTask: 300,
      chatCreate: 300,
      chatSources: 300,
      chatSetFull: 200,
      chatCleanup: 320,
      chatPolicySet: 300,
    });
  });
});

describe('поиск чата и права доступа', () => {
  it('модуль не подключён; чат не найден; чат недоступен', () => {
    const h = harness('m-owner');
    expect(apiErr(() => h.api.chatOpen('ch-zzz'))).toEqual({
      code: 'not_found',
      message: 'Чат не найден',
    });
    h.as('m-sokolov');
    expect(apiErr(() => h.api.chatOpen('ch-drv'))).toEqual(missing);
    h.as(null);
    expect(apiErr(() => h.api.chatOpen('ch-drv'))).toEqual(missing);
    delete h.db.chats;
    expect(apiErr(() => h.api.chatOpen('ch-drv'))).toEqual({
      code: 'not_found',
      message: 'Модуль «Чаты» не подключён',
    });
  });

  it('сообщение чужого чата неотличимо от несуществующего', () => {
    const h = harness('m-sokolov');
    const nf = { code: 'not_found', message: 'Сообщение не найдено' };
    expect(apiErr(() => h.api.chatEdit('cm-4', 'x'))).toEqual(nf);
    expect(apiErr(() => h.api.chatEdit('cm-zzz', 'x'))).toEqual(nf);
    expect(apiErr(() => h.api.chatAck('cm-5'))).toEqual(nf);
  });
});

describe('chatOpen', () => {
  it('отмечает чужие сообщения прочитанными и сдвигает lastRead', () => {
    const h = harness('m-vasiliev');
    expect(h.api.chatOpen('ch-drv')).toEqual({ ok: true });
    const c = h.chat('ch-drv');
    expect(c.lastRead['m-vasiliev']).toBe(5);
    expect(h.msg('ch-drv', 'cm-5').reads['m-vasiliev']).toBe(665);
    expect(h.msg('ch-drv', 'cm-4').reads['m-vasiliev']).toBe(h.msg('ch-drv', 'cm-4').ts);
    expect(h.msg('ch-drv', 'cm-7').reads['m-vasiliev']).toBeUndefined();
    expect(h.msg('ch-drv', 'cm-3').reads['m-vasiliev']).toBeLessThan(665);
  });
});

describe('chatSend: успех', () => {
  it('текст: сообщение, прочтение автором, lastRead, время демо идёт вперёд', () => {
    const h = harness('m-vasiliev');
    const seq = h.db.seq;
    const { id } = h.api.chatSend('ch-drv', { text: '  Выезжаю  ' });
    expect(id).toBe('cm-' + String(seq));
    const m = h.msg('ch-drv', id);
    expect(m).toMatchObject({ by: 'm-vasiliev', text: 'Выезжаю', seq: 6, ts: 666 });
    expect(m.reads).toEqual({ 'm-vasiliev': 666 });
    expect(h.chat('ch-drv')).toMatchObject({ seq: 6, last: 666 });
    expect(h.chat('ch-drv').lastRead['m-vasiliev']).toBe(6);
    expect(h.now()).toBe(666);
    expect(m.files).toBeNull();
    expect(m.important).toBeNull();
    expect(m.temp).toBeNull();
    expect(m.spoiler).toBeNull();
    expect(m.doc).toBeNull();
    expect(m.topic).toBeNull();
  });

  it('тема чата записи по умолчанию — первая; своя тема — как задана', () => {
    const h = harness('m-owner');
    const a = h.api.chatSend('ch-obj42', { text: 'раз' }).id;
    const b = h.api.chatSend('ch-obj42', { text: 'два', topic: 'Приёмка' }).id;
    expect(h.msg('ch-obj42', a).topic).toBe('Общее');
    expect(h.msg('ch-obj42', b).topic).toBe('Приёмка');
  });

  it('ссылка на документ, спойлер ≤ 300, временное сообщение', () => {
    const h = harness('m-kotova');
    const d = h.api.chatSend('ch-dkv', {
      text: 'код',
      spoiler: 'x'.repeat(400),
      temp: 1,
      doc: { ref: 'doc-42', title: 'Договор', sub: 'v2' },
    }).id;
    const m = h.msg('ch-dkv', d);
    expect(m.spoiler).toHaveLength(300);
    expect(m.temp).toEqual({ exp: 665 + 60, h: 1 });
    expect(m.doc).toEqual({ kind: 'doc', ref: 'doc-42', title: 'Договор', sub: 'v2' });
  });

  it('опрос: варианты без пустых, срок в часах с границами, подпись срока', () => {
    const h = harness('m-kotova');
    const a = h.api.chatSend('ch-drv', {
      poll: { q: ' Когда? ', opts: ['а', ' ', 'б'], hours: 2 },
    }).id;
    const m = h.msg('ch-drv', a);
    expect(m.kind).toBe('poll');
    expect(m.poll).toMatchObject({
      q: 'Когда?',
      opts: [
        { id: 'o1', t: 'а' },
        { id: 'o2', t: 'б' },
      ],
      votes: {},
      anon: false,
      multi: false,
      closes: 665 + 120,
      closesLabel: '01.10 в 13:05',
      closed: false,
    });
    const long = h.msg(
      'ch-drv',
      h.api.chatSend('ch-drv', { poll: { q: 'q', opts: ['а', 'б'], hours: 500 } }).id,
    );
    expect(long.poll?.closes).toBe(h.now() - 1 + 168 * 60);
    const dflt = h.msg(
      'ch-drv',
      h.api.chatSend('ch-drv', { poll: { q: 'q', opts: ['а', 'б'], anon: true, multi: true } }).id,
    );
    expect(dflt.poll).toMatchObject({ anon: true, multi: true });
    expect((dflt.poll?.closes ?? 0) - (h.now() - 1)).toBe(24 * 60);
  });

  it('«важное» с подтверждением: срок и ожидание; без срока — «—»', () => {
    const h = harness('m-kotova');
    const a = h.msg(
      'ch-drv',
      h.api.chatSend('ch-drv', { text: 'Важно', important: true, due: '05.10' }).id,
    );
    expect(a.important).toEqual({ due: '05.10', acks: [] });
    const b = h.msg('ch-drv', h.api.chatSend('ch-drv', { text: 'Важно 2', important: true }).id);
    expect(b.important?.due).toBe('—');
  });

  it('одноразовый файл модератора в чате записи', () => {
    const h = harness('m-owner');
    const id = h.api.chatSend('ch-obj42', {
      files: [{ name: 'Пропуск.pdf', mb: 0.3, kind: 'doc' }],
      viewOnce: true,
    }).id;
    expect(h.msg('ch-obj42', id).files).toEqual([
      { name: 'Пропуск.pdf', mb: 0.3, kind: 'doc', viewOnce: true, opened: {} },
    ]);
  });
});

describe('chatSend: события', () => {
  it('«важное» и @все — участникам чата, кроме автора; текст обрезан до 60 знаков', () => {
    const h = harness('m-kotova');
    h.api.chatSend('ch-drv', { text: 'Всем @все смотреть сюда', important: true });
    const [ev] = h.events();
    expect(ev?.text).toBe('Важное в «' + TITLE_DRV + '»: Всем @все смотреть сюда');
    expect([...(ev?.to ?? [])].sort()).toEqual(['m-kotelnikova', 'm-owner', 'm-vasiliev']);
    h.api.chatSend('ch-drv', { text: 'Эй, @все, ' + 'я'.repeat(80) });
    expect(h.events()[0]?.text).toBe(
      'Вас упомянули в «' + TITLE_DRV + '»: ' + ('Эй, @все, ' + 'я'.repeat(80)).slice(0, 60),
    );
  });

  it('разбор @все один: «@всех» и «тут@все» не рассылаются и права не требуют', () => {
    expect(ALL_RE.test('@всех')).toBe(false);
    const h = harness('m-vasiliev');
    const n = h.events().length;
    h.api.chatSend('ch-drv', { text: 'привет @всех' });
    h.api.chatSend('ch-drv', { text: 'тут@все' });
    expect(h.events()).toHaveLength(n);
  });

  it('@Имя — только участнику этого чата', () => {
    const h = harness('m-kotova');
    h.api.chatSend('ch-drv', { text: '@Илья глянь, и @Алексей тоже' });
    expect(h.events()).toHaveLength(1);
    expect(h.events()[0]).toMatchObject({
      text: 'Марина Котова упомянул(а) вас в «' + TITLE_DRV + '»',
      to: ['m-vasiliev'],
    });
  });

  it('личный чат: событие собеседнику с текстом или «файл»', () => {
    const h = harness('m-kotova');
    h.api.chatSend('ch-dkv', { text: 'привет' });
    expect(h.events()[0]).toMatchObject({ text: 'Марина Котова: привет', to: ['m-vasiliev'] });
    h.api.chatSend('ch-dkv', { files: [{ name: 'a.jpg', mb: 1, kind: 'photo' }] });
    expect(h.events()[0]?.text).toBe('Марина Котова: файл');
  });
});

describe('chatSend: ошибки', () => {
  const as = (actor: string) => harness(actor);

  it('пустое и слишком длинное', () => {
    const h = as('m-vasiliev');
    expect(apiErr(() => h.api.chatSend('ch-drv', { text: '  ' }))).toEqual(
      invalid('Напишите сообщение или прикрепите файл'),
    );
    expect(apiErr(() => h.api.chatSend('ch-drv', undefined as never))).toEqual(
      invalid('Напишите сообщение или прикрепите файл'),
    );
    expect(apiErr(() => h.api.chatSend('ch-drv', { text: 'я'.repeat(4001) }))).toEqual(
      invalid('Больше 4000 знаков: длинный текст удобнее оформить страницей Базы знаний'),
    );
    expect(h.api.chatSend('ch-drv', { text: 'я'.repeat(4000) }).id).toBeTruthy();
  });

  it('нельзя писать: читатель, объявления, архив', () => {
    const reader = as('m-kotelnikova');
    expect(apiErr(() => reader.api.chatSend('ch-drv', { text: 'x' }))).toEqual(
      forbidden('У вас роль «Читатель»: можно читать, голосовать и подтверждать'),
    );
    const ann = as('m-kotova');
    expect(apiErr(() => ann.api.chatSend('ch-news', { text: 'x' }))).toEqual(
      forbidden('В объявлениях пишут модераторы'),
    );
    const arch = as('m-kotova');
    arch.chat('ch-drv').status = 'archived';
    expect(apiErr(() => arch.api.chatSend('ch-drv', { text: 'x' }))).toEqual(
      forbidden('Чат в архиве: только чтение'),
    );
    expect(apiErr(() => as('m-sokolov').api.chatSend('ch-drv', { text: 'x' }))).toEqual(missing);
  });

  it('«важное», @все, временные и одноразовые — только по праву и политике', () => {
    const h = as('m-vasiliev');
    expect(apiErr(() => h.api.chatSend('ch-drv', { text: 'x', important: true }))).toEqual(
      forbidden('Важное с подтверждением отправляют модераторы с правом «Чаты · Решать»'),
    );
    expect(apiErr(() => h.api.chatSend('ch-drv', { text: 'эй @все' }))).toEqual(
      forbidden('@все — только у модераторов с правом «Чаты · Решать»'),
    );
    expect(apiErr(() => h.api.chatSend('ch-drv', { text: 'x', temp: 1 }))).toEqual(
      forbidden('Временные сообщения в этом чате запрещены политикой вида «По роли в области»'),
    );
    expect(
      apiErr(() => h.api.chatSend('ch-drv', { files: [{ name: 'a', mb: 1 }], viewOnce: true })),
    ).toEqual(forbidden('Одноразовые файлы отправляют модераторы, если это разрешает политика'));
    const owner = as('m-owner');
    expect(apiErr(() => owner.api.chatSend('ch-obj42', { text: 'x', viewOnce: true }))).toEqual(
      invalid('Прикрепите файл для одноразового просмотра'),
    );
  });

  it('опрос: вопрос, 2–10 вариантов', () => {
    const h = as('m-kotova');
    const send = (poll: { q: string; opts: string[] }) =>
      apiErr(() => h.api.chatSend('ch-drv', { poll }));
    expect(send({ q: ' ', opts: ['а', 'б'] })).toEqual(invalid('Напишите вопрос опроса'));
    expect(send({ q: 'q', opts: ['а', ' '] })).toEqual(invalid('Нужно минимум два варианта'));
    expect(send({ q: 'q', opts: Array.from({ length: 11 }, (_, i) => 'в' + String(i)) })).toEqual(
      invalid('Не больше 10 вариантов'),
    );
  });

  it('файл больше предела политики вида', () => {
    const h = as('m-vasiliev');
    expect(
      apiErr(() =>
        h.api.chatSend('ch-drv', { files: [{ name: 'Big.mov', mb: 150, kind: 'video' }] }),
      ),
    ).toEqual(invalid('«Big.mov» больше 100 МБ — предел политики вида «По роли в области»'));
  });
});

describe('chatSend: вложения и место', () => {
  it('файлы растят занятое место и корзины возраста 0', () => {
    const h = harness('m-vasiliev');
    h.api.chatSend('ch-drv', { files: [{ name: 'a.jpg', mb: 4.2, kind: 'photo' }] });
    h.api.chatSend('ch-drv', { files: [{ name: 'b.jpg', mb: 1, kind: 'photo' }] });
    h.api.chatSend('ch-drv', { files: [{ name: 'c.pdf', mb: 1, kind: 'zzz' as never }] });
    const c = h.chat('ch-drv');
    expect(c.usedMb).toBeCloseTo(846.2, 5);
    expect(c.buckets?.map((b) => [b.kind, b.label, b.ageD, b.n])).toEqual([
      ['photo', 'Фото', 0, 2],
      ['doc', 'Документы', 0, 1],
    ]);
    expect(c.buckets?.[0]?.mb).toBeCloseTo(5.2, 5);
  });

  it('«Запретить новые файлы»: ошибка и чат не изменился совсем', () => {
    const h = harness('m-owner');
    const before = JSON.stringify(h.db.chats);
    const seq = h.db.seq;
    expect(
      apiErr(() =>
        h.api.chatSend('ch-obj42', {
          text: 'x',
          files: [{ name: 'F.mov', mb: 500, kind: 'video' }],
        }),
      ),
    ).toEqual(
      invalid(
        'Место чата заполнено: 4,6 ГБ из 5 ГБ. Файлы не отправляются — текст, опросы и подтверждения работают. Освободите место в «Сведения › Хранение»',
      ),
    );
    expect(JSON.stringify(h.db.chats)).toBe(before);
    expect(h.db.seq).toBe(seq);
  });

  it('«Удалять старые вложения»: служебная заметка до сообщения, корзины применены', () => {
    const h = harness('m-owner');
    h.chat('ch-obj42').over = { onFull: 'ring' };
    const id = h.api.chatSend('ch-obj42', {
      text: 'x',
      files: [{ name: 'F.mov', mb: 500, kind: 'video' }],
    }).id;
    const c = h.chat('ch-obj42');
    const last = c.msgs.slice(-2);
    expect(last[0]?.by).toBe('sys');
    expect(last[0]?.sys).toMatchObject({
      mod: 'Чаты',
      title: 'Удалены старые вложения: место чата',
      icon: 'autorenew',
      tone: 'neutral',
    });
    expect(last[1]?.id).toBe(id);
    expect(c.usedMb).toBe(5000);
    expect(c.buckets?.find((b) => b.id === 'b2')?.mb).toBe(400);
    expect(c.buckets?.find((b) => b.kind === 'video' && b.ageD === 0)?.mb).toBe(500);
  });

  it('«Переносить в архив» и «Сжимать медиа»', () => {
    const a = harness('m-owner');
    a.chat('ch-obj42').over = { onFull: 'archive' };
    a.api.chatSend('ch-obj42', { files: [{ name: 'F.mov', mb: 500, kind: 'video' }] });
    expect(a.chat('ch-obj42').archivedMb).toBe(100);
    const c = harness('m-owner');
    c.chat('ch-obj42').over = { onFull: 'compress' };
    c.api.chatSend('ch-obj42', { files: [{ name: 'F.mov', mb: 500, kind: 'video' }] });
    expect(c.chat('ch-obj42').usedMb).toBe(4140);
    expect(c.chat('ch-obj42').msgs.some((m) => m.sys?.icon === 'compress')).toBe(true);
  });
});

describe('chatEdit', () => {
  it('правка своего: прежний текст в историю, время идёт; тот же текст — без эффекта', () => {
    const h = harness('m-vasiliev');
    expect(h.api.chatEdit('cm-4', ' Понял, забрал ')).toEqual({ ok: true });
    const m = h.msg('ch-drv', 'cm-4');
    expect(m.text).toBe('Понял, забрал');
    expect(m.edits).toEqual([{ text: 'Понял. Документы на А 412 МР 77 забрал.', ts: 665 }]);
    expect(h.now()).toBe(666);
    expect(h.api.chatEdit('cm-4', 'Понял, забрал')).toEqual({ same: true });
    expect(m.edits).toHaveLength(1);
  });

  it('ошибки: чужое, удалённое, пустое, окно закрыто', () => {
    const h = harness('m-vasiliev');
    expect(apiErr(() => h.api.chatEdit('cm-3', 'x'))).toEqual(
      forbidden('Править можно только свои сообщения'),
    );
    expect(apiErr(() => h.api.chatEdit('cm-4', ' '))).toEqual(
      invalid('Текст не может быть пустым — удалите сообщение'),
    );
    expect(apiErr(() => h.api.chatEdit('cm-4', undefined as never))).toEqual(
      invalid('Текст не может быть пустым — удалите сообщение'),
    );
    h.chat('ch-drv').over = { edit: '15m' };
    expect(apiErr(() => h.api.chatEdit('cm-4', 'x'))).toEqual(
      invalid('Окно правки закрыто: 15 минут по политике вида «По роли в области»'),
    );
    h.chat('ch-drv').over = { edit: 'none' };
    expect(h.api.chatEdit('cm-4', 'x')).toEqual({ ok: true });
    h.msg('ch-drv', 'cm-4').deleted = {
      by: 'm-vasiliev',
      ts: 1,
      mod: false,
      reason: '',
      keepUntil: 2,
    };
    expect(apiErr(() => h.api.chatEdit('cm-4', 'y'))).toEqual(invalid('Сообщение удалено'));
  });
});

describe('chatDelete', () => {
  it('автор удаляет своё: метка, срок хранения в журнале 30 дней, запись в журнал чата', () => {
    const h = harness('m-vasiliev');
    expect(h.api.chatDelete('cm-4')).toEqual({ ok: true });
    expect(h.msg('ch-drv', 'cm-4').deleted).toEqual({
      by: 'm-vasiliev',
      ts: 665,
      mod: false,
      reason: '',
      keepUntil: 665 + 30 * 1440,
    });
    expect(h.chat('ch-drv').journal).toEqual([
      { ts: 665, by: 'm-vasiliev', text: 'Удалено автором · сообщение от 30.09 18:24' },
    ]);
    expect(apiErr(() => h.api.chatDelete('cm-4'))).toEqual(invalid('Сообщение уже удалено'));
  });

  it('модератор удаляет чужое только с причиной', () => {
    const h = harness('m-kotova');
    expect(apiErr(() => h.api.chatDelete('cm-4'))).toEqual(
      invalid('Укажите причину — её увидят участники'),
    );
    expect(apiErr(() => h.api.chatDelete('cm-4', '  '))).toEqual(
      invalid('Укажите причину — её увидят участники'),
    );
    h.api.chatDelete('cm-4', 'Спам');
    expect(h.msg('ch-drv', 'cm-4').deleted).toMatchObject({ mod: true, reason: 'Спам' });
    expect(h.chat('ch-drv').journal[0]?.text).toBe(
      'Удалено модератором: Спам · сообщение от 30.09 18:24',
    );
  });

  it('участник чужое не удаляет; окно удаления своего ограничено политикой', () => {
    const h = harness('m-vasiliev');
    expect(apiErr(() => h.api.chatDelete('cm-3'))).toEqual(
      forbidden('Чужие сообщения удаляют модераторы'),
    );
    h.chat('ch-drv').over = { edit: '15m' };
    expect(apiErr(() => h.api.chatDelete('cm-4'))).toEqual(
      forbidden('Окно удаления закрыто: 15 минут. Попросите модератора'),
    );
    h.as('m-kotova');
    expect(apiErr(() => h.api.chatDelete('cm-4'))).toEqual(
      invalid('Укажите причину — её увидят участники'),
    );
  });

  it('удержание защищает сообщения (в эталоне не защищало)', () => {
    const h = harness('m-owner');
    const sokolov = h.chat('ch-obj42').msgs.find((m) => m.by === 'm-sokolov');
    if (!sokolov) throw new Error('нет сообщения');
    expect(h.api.chatDelete(sokolov.id, 'можно')).toEqual({ ok: true });
    const other = h.chat('ch-obj42').msgs.find((m) => m.by === 'm-owner');
    if (!other) throw new Error('нет сообщения');
    other.ts = -20 * 1440;
    expect(apiErr(() => h.api.chatDelete(other.id, 'x'))).toEqual(
      invalid('Нельзя удалить: удержание «Претензия по кв. 42» до 01.12'),
    );
    expect(other.deleted).toBeUndefined();
  });
});

describe('chatAck', () => {
  const TEXT =
    'Регламент приёмки смены обновлён: фото одометра при сдаче обязательно. Подтвердите до 03.10.';

  it('подтверждение, остаток, повтор; последнему — событие автору', () => {
    const h = harness('m-vasiliev');
    expect(h.api.chatAck('cm-5')).toEqual({ left: 2 });
    expect(h.msg('ch-drv', 'cm-5').important?.acks).toEqual([{ member: 'm-vasiliev', ts: 666 }]);
    expect(h.msg('ch-drv', 'cm-5').reads['m-vasiliev']).toBeDefined();
    expect(h.api.chatAck('cm-5')).toEqual({ already: true });
    h.as('m-kotelnikova');
    expect(h.api.chatAck('cm-5')).toEqual({ left: 1 });
    expect(h.events()).toHaveLength(0);
    h.as('m-owner');
    expect(h.api.chatAck('cm-5')).toEqual({ left: 0 });
    expect(h.events()[0]).toMatchObject({
      text: 'Все подтвердили «' + TEXT.slice(0, 50) + '»',
      to: ['m-kotova'],
    });
  });

  it('ошибки', () => {
    const h = harness('m-vasiliev');
    expect(apiErr(() => h.api.chatAck('cm-4'))).toEqual(invalid('Подтверждение не запрошено'));
    h.as('m-kotova');
    expect(apiErr(() => h.api.chatAck('cm-5'))).toEqual(
      invalid('Своё сообщение подтверждать не нужно'),
    );
    h.msg('ch-drv', 'cm-5').deleted = {
      by: 'm-kotova',
      ts: 1,
      mod: false,
      reason: '',
      keepUntil: 2,
    };
    h.as('m-vasiliev');
    expect(apiErr(() => h.api.chatAck('cm-5'))).toEqual(invalid('Сообщение удалено'));
  });
});

describe('опросы: chatVote и chatPollClose', () => {
  const POLL = 'cm-6';

  it('голос и переголосование', () => {
    const h = harness('m-vasiliev');
    expect(h.api.chatVote(POLL, ['o1'])).toEqual({ ok: true });
    expect(h.msg('ch-drv', POLL).poll?.votes).toEqual({ o1: ['m-vasiliev'] });
    h.api.chatVote(POLL, ['o2', 'zzz']);
    expect(h.msg('ch-drv', POLL).poll?.votes).toEqual({ o1: [], o2: ['m-vasiliev'] });
  });

  it('ошибки голосования', () => {
    const h = harness('m-vasiliev');
    expect(apiErr(() => h.api.chatVote('cm-4', ['o1']))).toEqual(invalid('Это не опрос'));
    expect(apiErr(() => h.api.chatVote(POLL, ['zzz']))).toEqual(invalid('Выберите вариант'));
    expect(apiErr(() => h.api.chatVote(POLL, undefined as never))).toEqual(
      invalid('Выберите вариант'),
    );
    expect(apiErr(() => h.api.chatVote(POLL, ['o1', 'o2']))).toEqual(
      invalid('В этом опросе один вариант'),
    );
    const p = h.msg('ch-drv', POLL).poll;
    if (!p) throw new Error('нет опроса');
    p.multi = true;
    expect(h.api.chatVote(POLL, ['o1', 'o2'])).toEqual({ ok: true });
    p.closed = true;
    expect(apiErr(() => h.api.chatVote(POLL, ['o1']))).toEqual(
      invalid('Опрос закрыт 03.10 в 18:00'),
    );
    p.closed = false;
    p.closes = h.now();
    expect(apiErr(() => h.api.chatVote(POLL, ['o1']))).toEqual(
      invalid('Опрос закрыт 03.10 в 18:00'),
    );
  });

  it('закрытие: итог служебным сообщением', () => {
    const h = harness('m-kotova');
    const poll = h.msg('ch-drv', POLL).poll;
    if (!poll) throw new Error('нет опроса');
    poll.votes = { o1: ['m-vasiliev', 'm-owner'], o2: ['m-kotova'] };
    expect(h.api.chatPollClose(POLL)).toEqual({ ok: true });
    expect(h.msg('ch-drv', POLL).poll?.closed).toBe(true);
    const sys = h.chat('ch-drv').msgs.at(-1)?.sys;
    expect(sys).toMatchObject({
      title: 'Опрос закрыт: «Кто может выйти в субботу 04.10 на рейс Р-215?»',
      text: 'Больше всего голосов: Могу утром · 2',
      icon: 'ballot',
      tone: 'ok',
    });
  });

  it('без голосов — «Голосов нет»; повторное закрытие и чужой опрос — ошибки', () => {
    const h = harness('m-kotova');
    h.api.chatPollClose(POLL);
    expect(h.chat('ch-drv').msgs.at(-1)?.sys?.text).toBe('Голосов нет');
    expect(apiErr(() => h.api.chatPollClose(POLL))).toEqual(invalid('Опрос уже закрыт'));
    expect(apiErr(() => h.api.chatPollClose('cm-4'))).toEqual(invalid('Это не опрос'));
    const v = harness('m-vasiliev');
    expect(apiErr(() => v.api.chatPollClose(POLL))).toEqual(
      forbidden('Закрыть опрос может автор или модератор'),
    );
  });
});

describe('chatPin и chatReveal', () => {
  it('закрепление переключается; участнику нельзя', () => {
    const h = harness('m-kotova');
    expect(h.api.chatPin('cm-4')).toEqual({ pinned: 'cm-4' });
    expect(h.api.chatPin('cm-4')).toEqual({ pinned: null });
    h.as('m-vasiliev');
    expect(apiErr(() => h.api.chatPin('cm-4'))).toEqual(forbidden('Закрепляют модераторы'));
  });

  it('раскрытие ПДн: владелец бизнеса, запись в журнал; остальным — отказ', () => {
    const h = harness('m-owner');
    const phone = h.chat('ch-obj42').msgs.find((m) => m.text.includes('+7 916'));
    if (!phone) throw new Error('нет сообщения');
    expect(h.api.chatReveal(phone.id)).toEqual({ ok: true });
    expect(phone.revealed).toEqual(['m-owner']);
    expect(h.chat('ch-obj42').journal[0]?.text).toBe(
      'Дарья Зимина раскрыл(а) ПДн в сообщении от 10:47',
    );
    h.api.chatReveal(phone.id);
    expect(phone.revealed).toEqual(['m-owner']);
    h.as('m-sokolov');
    expect(apiErr(() => h.api.chatReveal(phone.id))).toEqual(
      forbidden('Номер скрыт: нужно право «ПДн без маски»'),
    );
  });
});

describe('chatOpenOnce и chatSaveTo', () => {
  const passId = (h: ReturnType<typeof harness>): string => {
    const m = h.chat('ch-obj42').msgs.find((x) => x.files?.[0]?.viewOnce);
    if (!m) throw new Error('нет сообщения');
    return m.id;
  };

  it('одноразовый файл открывается один раз получателем', () => {
    const h = harness('m-sokolov');
    const id = passId(h);
    expect(h.api.chatOpenOnce(id)).toEqual({ name: 'Пропуск в ЖК · Соколов А.pdf' });
    expect(h.msg('ch-obj42', id).files?.[0]?.opened).toEqual({ 'm-sokolov': 665 });
    expect(h.chat('ch-obj42').journal[0]?.text).toBe(
      'Алексей Соколов открыл(а) одноразовый файл «Пропуск в ЖК · Соколов А.pdf»',
    );
    expect(apiErr(() => h.api.chatOpenOnce(id))).toEqual(
      invalid('Вы уже открыли этот файл — он больше не откроется'),
    );
  });

  it('ошибки: не одноразовый, автор, файл уже удалён', () => {
    const h = harness('m-sokolov');
    const plain = h.chat('ch-obj42').msgs.find((x) => x.files?.[0] && !x.files[0].viewOnce);
    expect(apiErr(() => h.api.chatOpenOnce(plain?.id ?? ''))).toEqual(
      invalid('Файл не одноразовый'),
    );
    const id = passId(h);
    h.as('m-owner');
    expect(apiErr(() => h.api.chatOpenOnce(id))).toEqual(
      invalid('Автор одноразового файла его не открывает: файл видят только получатели'),
    );
    const f = h.msg('ch-obj42', id).files?.[0];
    if (f) f.gone = true;
    h.as('m-sokolov');
    expect(apiErr(() => h.api.chatOpenOnce(id))).toEqual(
      invalid('Файл удалён: прошло 24 часа после первого открытия'),
    );
  });

  it('«Сохранить в запись»: файлы помечены, место чата освобождено, запись в журнал', () => {
    const h = harness('m-sokolov');
    const photos = h.chat('ch-obj42').msgs.find((x) => x.files?.[0]?.kind === 'photo');
    const id = photos?.id ?? '';
    const r = h.api.chatSaveTo(id);
    expect(r.n).toBe(3);
    expect(r.mb).toBeCloseTo(11.1, 5);
    expect(h.msg('ch-obj42', id).files?.every((f) => f.savedTo === 'Объект')).toBe(true);
    expect(h.chat('ch-obj42').usedMb).toBeCloseTo(4588.9, 5);
    expect(h.chat('ch-obj42').savedMb).toBeCloseTo(1111.1, 5);
    expect(h.chat('ch-obj42').journal[0]?.text).toBe(
      'Алексей Соколов сохранил(а) 3 файла в запись · 11,1 МБ',
    );
    expect(apiErr(() => h.api.chatSaveTo(id))).toEqual(
      invalid('Нечего сохранять: файлы уже в записи'),
    );
  });

  it('«Сохранить в запись»: нужен чат записи и право писать; одноразовые не сохраняются', () => {
    const h = harness('m-sokolov');
    expect(apiErr(() => h.api.chatSaveTo(passId(h)))).toEqual(
      invalid('Нечего сохранять: файлы уже в записи'),
    );
    const v = harness('m-vasiliev');
    expect(apiErr(() => v.api.chatSaveTo('cm-4'))).toEqual(
      forbidden('Сохранять в запись могут участники чата записи'),
    );
  });

  it('сохранение уменьшает корзину сегодняшних фото', () => {
    const h = harness('m-sokolov');
    const c = h.chat('ch-obj42');
    c.buckets?.push({ id: 'bt', kind: 'photo', label: 'Фото', ageD: 0, n: 5, mb: 20 });
    const photos = c.msgs.find((x) => x.files?.[0]?.kind === 'photo');
    h.api.chatSaveTo(photos?.id ?? '');
    expect(c.buckets?.find((b) => b.id === 'bt')).toMatchObject({ n: 2 });
    expect(c.buckets?.find((b) => b.id === 'bt')?.mb).toBeCloseTo(8.9, 5);
  });
});

describe('chatToTask: задача из сообщения через TaskPort', () => {
  it('проект области чата, заголовок, ссылка на чат, комментарий; id выдаёт порт', () => {
    const h = harness('m-kotova');
    const { id } = h.api.chatToTask('cm-3');
    expect(id).toBe('T-1');
    const t = h.tasks.get(id);
    expect(t).toMatchObject({
      project: 'fleet',
      title: 'Завтра с 8:00 мойка на Складе № 1 закрыта — заправляемся и моемся у МКАД.',
      assignee: 'Марина Котова',
      links: [{ kind: 'chat', id: 'ch-drv', label: 'Чат «' + TITLE_DRV + '»' }],
    });
    expect(t?.comments).toEqual([
      { by: 'Марина Котова', at: '11:05', text: 'Из чата «' + TITLE_DRV + '»' },
    ]);
    expect(h.msg('ch-drv', 'cm-3').tasks).toEqual([id]);
  });

  it('явный проект; заголовок опроса; сжатие пробелов и обрезка до 80', () => {
    const h = harness('m-kotova');
    const a = h.tasks.get(h.api.chatToTask('cm-6', 'leads').id);
    expect(a).toMatchObject({
      project: 'leads',
      title: 'Кто может выйти в субботу 04.10 на рейс Р-215?',
    });
    const long = h.api.chatSend('ch-drv', { text: 'а   б\n' + 'я'.repeat(100) }).id;
    expect(h.tasks.get(h.api.chatToTask(long).id)?.title).toHaveLength(80);
    expect(h.tasks.get(h.api.chatToTask(long).id)?.title.startsWith('а б я')).toBe(true);
  });

  it('служебная карточка без текста — «Сообщение из чата»', () => {
    const h = harness('m-kotova');
    expect(h.tasks.get(h.api.chatToTask('cm-7').id)?.title).toBe('Сообщение из чата');
  });

  it('без подразделения — первый проект не-воронка', () => {
    const h = harness('m-owner');
    expect(h.tasks.get(h.api.chatToTask('cm-2').id)?.project).toBe('fleet');
  });

  it('ошибки: нет права, нет проекта', () => {
    const h = harness('m-kotelnikova');
    expect(apiErr(() => h.api.chatToTask('cm-3'))).toEqual(
      forbidden('Создавать задачи может роль с правом «Задачи · Создавать»'),
    );
    const k = harness('m-kotova');
    expect(apiErr(() => k.api.chatToTask('cm-3', 'zzz'))).toEqual({
      code: 'not_found',
      message: 'Проект не найден',
    });
    const none = harness('m-kotova', { projects: false });
    expect(apiErr(() => none.api.chatToTask('cm-3'))).toEqual(
      invalid('Нет проекта для задачи: создайте проект или выберите существующий'),
    );
    expect(chatOf(none.db, 'ch-drv').msgs.find((m) => m.id === 'cm-3')?.tasks).toBeUndefined();
  });
});
