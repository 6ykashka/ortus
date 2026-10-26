// Кейсы контрактного PR этапа 7 (W7.00): «Чаты» (W7.11–W7.13) на сиде домена W7.10 «Альты» (чаты: «Альта · новости»
// — объявления, «Водители · Север Логистик» — по роли в области, рейс Р-208 и объект кв. 42 — чаты записей, два
// личных). Персонажи: владелец (Дарья Зимина — владелец бизнеса), менеджер (Марина Котова — владелец чата водителей,
// создаёт группы в фирме «Север»), водитель (Илья Васильев), массажист (Анна Морозова — вне чатов фирмы), прораб
// (Алексей Соколов — чат объекта по связи «прораб объекта»). Примеры — tools/gen/examples-w700.mjs (снимки
// сценарного сервера, PD-43).
import { expect } from 'vitest';

import type { Reply } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

type Call = (ctx: CaseContext) => Promise<Reply>;
type Body = Record<string, unknown> & { items?: Record<string, unknown>[] };
const body = (r: Reply): Body => r.body as Body;

const C = (ctx: CaseContext, rest = ''): string => `${ctx.alta}/chats${rest}`;
const NOBODY = '00000000-0000-5000-8000-0000000000aa';

const ok = (operationId: string, name: string, title: string, call: Call, status?: number) => ({
  title,
  operationId,
  expect: 'success' as const,
  example: `${operationId}/${name}`,
  run: async (ctx: CaseContext) => {
    ctx.expectExample(await call(ctx), `${operationId}/${name}`, status);
  },
});

const err = (operationId: string, name: string, title: string, call: Call) => ({
  title,
  operationId,
  expect: 'error' as const,
  example: `${operationId}/${name}`,
  run: async (ctx: CaseContext) => {
    ctx.expectExample(await call(ctx), `${operationId}/${name}`);
  },
});

const group = (ctx: CaseContext, extra: Record<string, unknown> = {}) => ({
  kind: 'group',
  title: 'Смена на складе',
  orgUnitId: ctx.A('f-msk-sever'),
  sources: [
    { who: 'role', refId: ctx.A('r-driver'), orgUnitId: ctx.A('f-msk-sever'), role: 'member' },
  ],
  ...extra,
});

/** Сообщение в чате водителей (cm-3 — Котова, cm-4 — Васильев, cm-5 — важное, cm-6 — опрос). */
const drv = (ctx: CaseContext, rest = ''): string => C(ctx, `/${ctx.A('ch-drv')}${rest}`);
const obj = (ctx: CaseContext, rest = ''): string => C(ctx, `/${ctx.A('ch-obj42')}${rest}`);
const msg = (ctx: CaseContext, id: string, rest = ''): string =>
  drv(ctx, `/messages/${ctx.A(id)}${rest}`);

export const chatsCases = cases('chats')([
  ok(
    'listChats',
    'ok',
    'менеджер: рабочие чаты — «Водители» с непрочитанным и ролью владельца',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(`${C(ctx)}?folder=work`);
    },
  ),
  {
    title: 'поиск по названию и последнему сообщению; водитель не видит чат объекта кв. 42',
    operationId: 'listChats',
    expect: 'success',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      const names = (body(await driver.get(C(ctx))).items ?? []).map((c) => c.title);
      expect(names).not.toContain('ЖК Речной · квартира 42');
      const found = body(await driver.get(`${C(ctx)}?q=моечн`));
      expect(found.items?.length).toBeLessThanOrEqual(1);
    },
  },
  err('listChats', 'session_expired', 'без сессии — 401', (ctx) => ctx.anon().get(C(ctx))),

  ok(
    'createChat',
    'created',
    'менеджер создаёт группу в своей фирме — владелец чата, состав из роли «Водитель»',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(C(ctx), group(ctx));
    },
    201,
  ),
  ok('createChat', 'dry-run', 'dryRun — кто войдёт, чат не создаётся', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(C(ctx), group(ctx, { dryRun: true }));
  }),
  err('createChat', 'forbidden_action', 'водитель не создаёт групповые чаты — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.post(C(ctx), group(ctx));
  }),
  err('createChat', 'validation_failed', 'название короче трёх знаков — 422', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(C(ctx), group(ctx, { title: 'Ск' }));
  }),

  ok(
    'createDirectChat',
    'created',
    'менеджер начинает личный чат с прорабом',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(C(ctx, '/direct'), { memberId: ctx.A('m-sokolov') });
    },
    201,
  ),
  ok('createDirectChat', 'existing', 'пара уже есть — тот же чат, 200', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(C(ctx, '/direct'), { memberId: ctx.A('m-vasiliev') });
  }),
  err(
    'createDirectChat',
    'chat_member_out_of_scope',
    'заблокированный сотрудник — вне области, 422',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(C(ctx, '/direct'), { memberId: ctx.A('m-gromov') });
    },
  ),

  ok(
    'getChat',
    'ok',
    'менеджер читает чат водителей: политика, права владельца чата, цепочка доступа',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(drv(ctx));
    },
  ),
  err('getChat', 'not_found', 'массажист вне состава — 404, как отсутствующий', async (ctx) => {
    const s = await ctx.as('therapist');
    return s.get(drv(ctx));
  }),

  ok(
    'updateChat',
    'ok',
    'владелец чата переименовывает чат и меняет режим «при заполнении»',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.patch(
        drv(ctx),
        { title: 'Водители · Север', overrides: { onFull: 'ring' } },
        { ifMatch: 1 },
      );
    },
  ),
  err('updateChat', 'revision_mismatch', 'устаревшая ревизия — 412', async (ctx) => {
    const s = await ctx.as('manager');
    return s.patch(drv(ctx), { title: 'Водители' }, { ifMatch: 7 });
  }),

  ok('archiveChat', 'ok', 'владелец чата переносит чат в архив — только чтение', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(drv(ctx, '/archive'));
  }),
  err('archiveChat', 'forbidden_action', 'водитель — участник, не владелец — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.post(drv(ctx, '/archive'));
  }),

  ok(
    'listChatMessages',
    'ok',
    'лента чата водителей: важное, опрос, служебное сообщение',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(drv(ctx, '/messages'));
    },
  ),
  {
    title: 'afterSeq — только новые сообщения, hasMore ложь',
    operationId: 'listChatMessages',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      const r = await s.get(drv(ctx, '/messages?afterSeq=3'));
      expect((body(r).items ?? []).map((m) => m.seq)).toEqual([4, 5]);
      expect(body(r).hasMore).toBe(false);
    },
  },
  err('listChatMessages', 'not_found', 'прораб вне чата водителей — 404', async (ctx) => {
    const s = await ctx.as('foreman');
    return s.get(drv(ctx, '/messages'));
  }),

  ok('postChatMessage', 'created', 'водитель пишет в чат', async (ctx) => {
    const s = await ctx.as('driver');
    return s.post(drv(ctx, '/messages'), { text: 'Принял, выезжаю в 8:00.' });
  }),
  {
    title: 'опрос: вопрос и три варианта, закрывается через 24 часа',
    operationId: 'postChatMessage',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const r = await s.post(drv(ctx, '/messages'), {
        poll: { question: 'Кто на субботу?', options: ['Я', 'Не могу', 'Подумаю'] },
      });
      expect(r.status).toBe(201);
      expect((body(r).poll as { options: unknown[] }).options).toHaveLength(3);
    },
  },
  err('postChatMessage', 'validation_failed', 'пустое сообщение — 422', async (ctx) => {
    const s = await ctx.as('driver');
    return s.post(drv(ctx, '/messages'), {});
  }),
  err(
    'postChatMessage',
    'chat_ephemeral_disabled',
    'временное сообщение в рабочем чате запрещено политикой — 403',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(drv(ctx, '/messages'), { text: 'Код 4412', ephemeral: { ttlHours: 2 } });
    },
  ),

  ok('editChatMessage', 'ok', 'автор правит своё сообщение в окне правки', async (ctx) => {
    const s = await ctx.as('driver');
    return s.patch(msg(ctx, 'cm-4'), { text: 'Понял. Документы на А 412 МР 77 забрал, выезжаю.' });
  }),
  err(
    'editChatMessage',
    'forbidden_action',
    'чужое сообщение править нельзя — 403',
    async (ctx) => {
      const s = await ctx.as('driver');
      return s.patch(msg(ctx, 'cm-3'), { text: 'Подмена' });
    },
  ),

  ok(
    'deleteChatMessage',
    'ok',
    'автор удаляет своё сообщение — остаётся метка, текст не отдаётся',
    async (ctx) => {
      const s = await ctx.as('driver');
      const r = await s.delete(msg(ctx, 'cm-4'));
      const list = body(await s.get(drv(ctx, '/messages')));
      const gone = (list.items ?? []).find((m) => m.id === ctx.A('cm-4'));
      expect(gone?.text).toBe('');
      expect(gone?.attachments).toEqual([]);
      return r;
    },
  ),
  err('deleteChatMessage', 'validation_failed', 'модератор без причины — 422', async (ctx) => {
    const s = await ctx.as('manager');
    return s.delete(msg(ctx, 'cm-4'));
  }),
  err(
    'deleteChatMessage',
    'chat_on_hold',
    'сообщение под удержанием не удаляется — 409',
    async (ctx) => {
      const s = await ctx.as('owner');
      await s.post(`${ctx.alta}/chat-holds`, {
        scope: 'chat',
        chatId: ctx.A('ch-obj42'),
        reason: 'Претензия по кв. 42',
      });
      return s.delete(obj(ctx, `/messages/${ctx.A('cm-12')}?reason=Дубль`));
    },
  ),

  ok('listChatMessageVersions', 'ok', 'автор видит историю правок', async (ctx) => {
    const s = await ctx.as('driver');
    await s.patch(msg(ctx, 'cm-4'), { text: 'Понял. Документы забрал.' });
    return s.get(msg(ctx, 'cm-4', '/versions'));
  }),
  err('listChatMessageVersions', 'not_found', 'прораб вне чата — 404', async (ctx) => {
    const s = await ctx.as('foreman');
    return s.get(msg(ctx, 'cm-4', '/versions'));
  }),

  ok('markChatRead', 'ok', 'водитель прочёл до 5-го сообщения', async (ctx) => {
    const s = await ctx.as('driver');
    return s.post(drv(ctx, '/read'), { uptoSeq: 5 });
  }),
  err('markChatRead', 'validation_failed', 'отрицательный seq — 422', async (ctx) => {
    const s = await ctx.as('driver');
    return s.post(drv(ctx, '/read'), { uptoSeq: -1 });
  }),

  ok(
    'ackChatMessage',
    'ok',
    'водитель подтверждает важное — «Регламент приёмки смены»',
    async (ctx) => {
      const s = await ctx.as('driver');
      return s.post(msg(ctx, 'cm-5', '/ack'));
    },
  ),
  err('ackChatMessage', 'validation_failed', 'подтверждение не запрошено — 422', async (ctx) => {
    const s = await ctx.as('driver');
    return s.post(msg(ctx, 'cm-3', '/ack'));
  }),

  ok('getChatMessageReceipts', 'ok', 'владелец: режим «галочки» — N из M без имён', async (ctx) => {
    const s = await ctx.as('owner');
    return s.get(msg(ctx, 'cm-3', '/receipts'));
  }),
  err(
    'getChatMessageReceipts',
    'forbidden_action',
    'менеджер без права «Видеть, кто и когда прочитал» — 403',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(msg(ctx, 'cm-3', '/receipts'));
    },
  ),

  ok(
    'revealChatMessagePdn',
    'ok',
    'владелец раскрывает телефон заказчика — действие в журнале чата',
    async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(obj(ctx, `/messages/${ctx.A('cm-13')}/pdn-reveal`));
      const journal = body(await s.get(obj(ctx, '/journal'))).items ?? [];
      expect(journal.some((j) => /раскрыл/.test(String(j.text)))).toBe(true);
      return r;
    },
  ),
  err(
    'revealChatMessagePdn',
    'forbidden_action',
    'менеджер без права «ПДн без маски» — 403',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(msg(ctx, 'cm-3', '/pdn-reveal'));
    },
  ),

  ok('voteChatPoll', 'ok', 'водитель голосует; переголосование заменяет голос', async (ctx) => {
    const s = await ctx.as('driver');
    const url = drv(ctx, `/polls/${ctx.A('cm-6.poll')}/vote`);
    await s.put(url, { optionIds: [ctx.A('cm-6.o2')] });
    return s.put(url, { optionIds: [ctx.A('cm-6.o1')] });
  }),
  err('voteChatPoll', 'validation_failed', 'вариант чужого опроса — 422', async (ctx) => {
    const s = await ctx.as('driver');
    return s.put(drv(ctx, `/polls/${ctx.A('cm-6.poll')}/vote`), { optionIds: [ctx.A('cm-17.o1')] });
  }),

  ok('closeChatPoll', 'ok', 'автор закрывает опрос — служебное сообщение с итогом', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(drv(ctx, `/polls/${ctx.A('cm-6.poll')}/close`));
  }),
  err('closeChatPoll', 'invalid_transition', 'опрос уже закрыт — 409', async (ctx) => {
    const s = await ctx.as('manager');
    const url = drv(ctx, `/polls/${ctx.A('cm-6.poll')}/close`);
    await s.post(url);
    return s.post(url);
  }),

  ok('remindChatPoll', 'ok', 'напоминание тем, кто не проголосовал', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(drv(ctx, `/polls/${ctx.A('cm-6.poll')}/remind`));
  }),
  err(
    'remindChatPoll',
    'invalid_transition',
    'закрытому опросу напоминать нечего — 409',
    async (ctx) => {
      const s = await ctx.as('manager');
      await s.post(drv(ctx, `/polls/${ctx.A('cm-6.poll')}/close`));
      return s.post(drv(ctx, `/polls/${ctx.A('cm-6.poll')}/remind`));
    },
  ),

  ok('pinChatMessage', 'ok', 'модератор закрепляет важное сообщение', async (ctx) => {
    const s = await ctx.as('manager');
    return s.put(drv(ctx, '/pin'), { messageId: ctx.A('cm-5') });
  }),
  err('pinChatMessage', 'forbidden_action', 'водитель закреплять не может — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.put(drv(ctx, '/pin'), { messageId: ctx.A('cm-5') });
  }),

  ok('unpinChatMessage', 'ok', 'модератор снимает закрепление', async (ctx) => {
    const s = await ctx.as('manager');
    await s.put(drv(ctx, '/pin'), { messageId: ctx.A('cm-5') });
    return s.delete(drv(ctx, '/pin'));
  }),
  err('unpinChatMessage', 'forbidden_action', 'водитель — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.delete(drv(ctx, '/pin'));
  }),

  ok(
    'openViewOnceAttachment',
    'ok',
    'прораб открывает одноразовый файл «Пропуск на ноябрь» — ссылка с водяным знаком',
    async (ctx) => {
      const s = await ctx.as('foreman');
      return s.post(obj(ctx, `/attachments/${ctx.A('cm-16.f0')}/view-once`));
    },
  ),
  err('openViewOnceAttachment', 'invalid_transition', 'повторное открытие — 409', async (ctx) => {
    const s = await ctx.as('foreman');
    const url = obj(ctx, `/attachments/${ctx.A('cm-16.f0')}/view-once`);
    await s.post(url);
    return s.post(url);
  }),

  ok(
    'saveChatAttachmentsToRecord',
    'ok',
    'прораб сохраняет три фото стен в запись — место чата освобождается',
    async (ctx) => {
      const s = await ctx.as('foreman');
      return s.post(obj(ctx, `/messages/${ctx.A('cm-12')}/save-to-record`), {});
    },
  ),
  err(
    'saveChatAttachmentsToRecord',
    'validation_failed',
    'файлы уже в записи — 422',
    async (ctx) => {
      const s = await ctx.as('foreman');
      const url = obj(ctx, `/messages/${ctx.A('cm-12')}/save-to-record`);
      await s.post(url, {});
      return s.post(url, {});
    },
  ),

  ok(
    'createTaskFromChatMessage',
    'created',
    'менеджер создаёт задачу из сообщения — со ссылкой на чат',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(msg(ctx, 'cm-3', '/task'), { title: 'Проверить мойку на Складе № 1' });
    },
  ),
  err('createTaskFromChatMessage', 'not_found', 'чата нет — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(C(ctx, `/${NOBODY}/messages/${NOBODY}/task`), { title: 'Задача' });
  }),

  ok(
    'listChatMembers',
    'ok',
    'состав чата водителей: кто в чате, кто по какому источнику',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(drv(ctx, '/members'));
    },
  ),
  err('listChatMembers', 'forbidden_action', 'водитель состав не видит — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.get(drv(ctx, '/members'));
  }),

  ok('getChatSources', 'ok', 'источники состава с ревизией', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(drv(ctx, '/sources'));
  }),
  err('getChatSources', 'forbidden_action', 'водитель — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.get(drv(ctx, '/sources'));
  }),

  ok(
    'replaceChatSources',
    'dry-run',
    'предпросмотр: добавить диспетчеров модераторами — кто получит чат',
    async (ctx) => {
      const s = await ctx.as('manager');
      const cur = body(await s.get(drv(ctx, '/sources'))).items ?? [];
      return s.put(
        drv(ctx, '/sources'),
        {
          sources: [...cur, { who: 'member', refId: ctx.A('m-vasiliev'), role: 'moderator' }],
          dryRun: true,
        },
        { ifMatch: 1 },
      );
    },
  ),
  ok(
    'replaceChatSources',
    'ok',
    'сохранение состава — ревизия растёт, служебное сообщение в чате',
    async (ctx) => {
      const s = await ctx.as('manager');
      const cur = body(await s.get(drv(ctx, '/sources'))).items ?? [];
      return s.put(
        drv(ctx, '/sources'),
        { sources: [...cur, { who: 'member', refId: ctx.A('m-vasiliev'), role: 'moderator' }] },
        { ifMatch: 1 },
      );
    },
  ),
  err('replaceChatSources', 'revision_mismatch', 'устаревшая ревизия — 412', async (ctx) => {
    const s = await ctx.as('manager');
    return s.put(
      drv(ctx, '/sources'),
      { sources: [{ who: 'all', role: 'reader' }] },
      { ifMatch: 9 },
    );
  }),

  ok(
    'getChatAccessExplanation',
    'ok',
    '«Проверить сотрудника»: заблокированный не входит',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(drv(ctx, `/access-explanation?memberId=${ctx.A('m-gromov')}`));
    },
  ),
  err('getChatAccessExplanation', 'not_found', 'нет такого сотрудника — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(drv(ctx, `/access-explanation?memberId=${NOBODY}`));
  }),

  ok('getChatStorage', 'ok', 'хранение чата водителей: корзины по виду и возрасту', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(drv(ctx, '/storage'));
  }),
  err('getChatStorage', 'forbidden_action', 'водитель — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.get(drv(ctx, '/storage'));
  }),

  ok(
    'createChatCleanup',
    'dry-run',
    'предпросмотр очистки: сколько файлов и мегабайт освободится',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(drv(ctx, '/cleanups'), {
        kinds: ['video', 'photo', 'voice', 'doc'],
        dryRun: true,
      });
    },
  ),
  err(
    'createChatCleanup',
    'validation_failed',
    'под фильтр ничего не попало — 422',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.post(C(ctx, `/${ctx.A('ch-news')}/cleanups`), { kinds: ['video'] });
    },
  ),

  ok(
    'listChatJournal',
    'ok',
    'журнал чата объекта: раскрытие ПДн и действия настройщика',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.get(obj(ctx, '/journal'));
    },
  ),
  err('listChatJournal', 'forbidden_action', 'водитель — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.get(drv(ctx, '/journal'));
  }),

  ok('createChatExport', 'accepted', 'выгрузка истории — задание принято', async (ctx) => {
    const s = await ctx.as('owner');
    return s.post(drv(ctx, '/exports'), { format: 'csv' });
  }),
  err('createChatExport', 'forbidden_action', 'менеджер без права выгрузки — 403', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(drv(ctx, '/exports'), { format: 'csv' });
  }),

  ok('getChatExport', 'ok', 'задание выполнено — файл выгрузки', async (ctx) => {
    const s = await ctx.as('owner');
    const made = body(await s.post(drv(ctx, '/exports'), { format: 'json' })).id as string;
    return s.get(drv(ctx, `/exports/${made}`));
  }),
  err('getChatExport', 'not_found', 'выгрузки нет — 404', async (ctx) => {
    const s = await ctx.as('owner');
    return s.get(drv(ctx, `/exports/${NOBODY}`));
  }),

  ok('listChatPolicies', 'ok', 'пять видов чатов: значения и пределы организации', async (ctx) => {
    const s = await ctx.as('owner');
    return s.get(C(ctx).replace('/chats', '/chat-policies'));
  }),
  err(
    'listChatPolicies',
    'forbidden_action',
    'менеджер — 403 (только владелец бизнеса)',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(C(ctx).replace('/chats', '/chat-policies'));
    },
  ),

  ok('updateChatPolicy', 'ok', 'владелец включает «кто и когда» для рабочих групп', async (ctx) => {
    const s = await ctx.as('owner');
    return s.put(`${ctx.alta}/chat-policies/group`, { patch: { receipts: 'who' } });
  }),
  ok(
    'updateChatPolicy',
    'dry-run',
    'предпросмотр: служебные сообщения по чатам вида',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.put(`${ctx.alta}/chat-policies/group`, {
        patch: { receiptsDays: 14 },
        dryRun: true,
      });
    },
  ),
  err(
    'updateChatPolicy',
    'validation_failed',
    'временные сообщения в рабочих группах — 422 (CHAT-04)',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.put(`${ctx.alta}/chat-policies/group`, { patch: { temp: 'allowed' } });
    },
  ),

  ok('listChatHolds', 'ok', 'удержание чата объекта кв. 42', async (ctx) => {
    const s = await ctx.as('owner');
    return s.get(`${ctx.alta}/chat-holds`);
  }),
  err('listChatHolds', 'forbidden_action', 'менеджер — 403', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(`${ctx.alta}/chat-holds`);
  }),

  ok('createChatHold', 'created', 'удержание сообщений сотрудников за период', async (ctx) => {
    const s = await ctx.as('owner');
    return s.post(`${ctx.alta}/chat-holds`, {
      scope: 'member',
      memberIds: [ctx.A('m-vasiliev')],
      reason: 'Проверка по рейсу Р-208',
    });
  }),
  err(
    'createChatHold',
    'validation_failed',
    'удержание сотрудников без сотрудников — 422',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.post(`${ctx.alta}/chat-holds`, { scope: 'member', reason: 'Проверка по рейсу' });
    },
  ),

  ok('releaseChatHold', 'ok', 'владелец снимает удержание чата объекта', async (ctx) => {
    const s = await ctx.as('owner');
    return s.delete(`${ctx.alta}/chat-holds/${ctx.A('ch-obj42.hold')}`);
  }),
  err('releaseChatHold', 'not_found', 'удержания нет — 404', async (ctx) => {
    const s = await ctx.as('owner');
    return s.delete(`${ctx.alta}/chat-holds/${NOBODY}`);
  }),
]);
