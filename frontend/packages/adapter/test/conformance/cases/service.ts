// Кейсы контрактного PR этапа 7 (W7.00): «Обращения» (W7.31–W7.33) на сиде домена W7.30 «Альты»: четыре направления
// (МАС, КОС, ОТД, ГРЗ), восемь обращений («ГРЗ-57» — груз, «МАС-41» — жалоба на массажиста Анну Морозову, «ОТД-11»
// — претензия, «ГРЗ-55» — ждёт клиента, «МАС-39» — благодарность, решена), две низкие оценки. Часы домена — 1 октября
// 16:24 МСК. Персонажи: владелец (Дарья Зимина — все направления, контакты клиентов, настройка), менеджер (Марина
// Котова — «Специалист по обращениям» только в «Грузоперевозках»), водитель (ключей модуля нет — 403 шлюза). Портал
// клиента — личная ссылка на обращение. Примеры — tools/gen/examples-w700.mjs (снимки сценарного сервера, PD-43).
import { expect } from 'vitest';

import type { Reply } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

type Call = (ctx: CaseContext) => Promise<Reply>;
type Body = Record<string, unknown> & { items?: Record<string, unknown>[] };
const body = (r: Reply): Body => r.body as Body;

const SV = (ctx: CaseContext, rest = ''): string => `${ctx.alta}/service${rest}`;
const REQ = (ctx: CaseContext, id: string, rest = ''): string =>
  SV(ctx, `/requests/${ctx.A(id)}${rest}`);
const PUB = '/api/v1/public/service';
const token = (ctx: CaseContext, id: string): string => `tok_${ctx.A(id).replaceAll('-', '')}z`;
const NOBODY = '00000000-0000-5000-8000-0000000000bb';

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

export const serviceCases = cases('service')([
  ok(
    'listServiceDirections',
    'ok',
    'менеджер видит только «Грузоперевозки»: команда, контакты закрыты',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(SV(ctx, '/directions'));
    },
  ),
  ok(
    'listServiceDirections',
    'not_configured',
    'у «Лотоса» направлений нет — «Обращения не настроены»',
    async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      return s.get(`${ctx.lotos}/service/directions`);
    },
  ),
  err(
    'listServiceDirections',
    'forbidden_action',
    'водитель без прав модуля — 403',
    async (ctx) => {
      const s = await ctx.as('driver');
      return s.get(SV(ctx, '/directions'));
    },
  ),

  ok(
    'listServiceRequests',
    'ok',
    'владелец: открытые обращения по срочности, счётчики очередей',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.get(SV(ctx, '/requests'));
    },
  ),
  {
    title: 'менеджер: только «ГРЗ»; жалоба на массажиста и чужие направления не видны',
    operationId: 'listServiceRequests',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const keys = (body(await s.get(SV(ctx, '/requests'))).items ?? []).map((r) => r.key);
      expect(keys.sort()).toEqual(['ГРЗ-55', 'ГРЗ-57']);
    },
  },
  err('listServiceRequests', 'not_found', 'направление не видно — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(`${SV(ctx, '/requests')}?directionId=${NOBODY}`);
  }),

  ok('getServiceQueueCounts', 'ok', 'счётчики очередей навигации', async (ctx) => {
    const s = await ctx.as('owner');
    return s.get(SV(ctx, '/queues'));
  }),
  err('getServiceQueueCounts', 'not_found', 'направление не видно — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(`${SV(ctx, '/queues')}?directionId=${NOBODY}`);
  }),

  ok(
    'getServiceRequest',
    'ok',
    'карточка «ГРЗ-57»: лента, сроки, телефон под маской',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(REQ(ctx, 'r-57'));
    },
  ),
  err('getServiceRequest', 'not_found', 'обращение чужого направления — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(REQ(ctx, 'r-41'));
  }),

  ok(
    'createServiceRequest',
    'created',
    'обращение по звонку: «в работе», исполнитель — автор, сроки по типу',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(SV(ctx, '/requests'), {
        directionId: ctx.A('d-grz'),
        typeId: 'd-grz:question',
        clientName: 'Павел Ершов',
        phone: '+7 916 111-22-33',
        text: 'Где накладная по рейсу Р-196? Водитель сказал, что документы оформлены.',
      });
    },
    201,
  ),
  err(
    'createServiceRequest',
    'validation_failed',
    'телефон — не меньше 10 цифр — 422',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(SV(ctx, '/requests'), {
        directionId: ctx.A('d-grz'),
        typeId: 'd-grz:question',
        clientName: 'Павел Ершов',
        phone: '8 916 12-34',
        text: 'Где накладная по рейсу Р-196?',
      });
    },
  ),

  ok(
    'postServiceMessage',
    'created',
    'ответ клиенту: первый ответ остановлен, «новое» → «в работе»',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(REQ(ctx, 'r-57', '/messages'), {
        kind: 'public',
        text: 'Здравствуйте! Приняли в работу, вернёмся с ответом до 11:00.',
      });
    },
    201,
  ),
  {
    title: 'заметка не останавливает срок первого ответа',
    operationId: 'postServiceMessage',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const r = await s.post(REQ(ctx, 'r-57', '/messages'), {
        kind: 'note',
        text: 'Запросил накладную у диспетчера.',
      });
      expect(r.status).toBe(201);
      const card = body(await s.get(REQ(ctx, 'r-57'))) as {
        status: string;
        sla: { first: { stoppedAt: unknown } };
      };
      expect(card.status).toBe('new');
      expect(card.sla.first.stoppedAt).toBeNull();
    },
  },
  err('postServiceMessage', 'validation_failed', 'ответ без текста — 422', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(REQ(ctx, 'r-57', '/messages'), { kind: 'public', text: ' ' });
  }),
  err(
    'postServiceMessage',
    'invalid_transition',
    'обращение закрыто — писать нельзя, 409',
    async (ctx) => {
      const s = await ctx.as('owner');
      await s.post(REQ(ctx, 'r-39', '/transitions'), { to: 'closed' }, { ifMatch: 1 });
      return s.post(REQ(ctx, 'r-39', '/messages'), { kind: 'note', text: 'Ещё одна заметка' });
    },
  ),

  ok(
    'setServiceCompensation',
    'ok',
    'компенсация «скидка 20 %» — запись в карточке клиента',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(REQ(ctx, 'r-55', '/compensation'), { kind: 'discount20' }, { ifMatch: 1 });
    },
  ),
  err('setServiceCompensation', 'revision_mismatch', 'устаревшая ревизия — 412', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(REQ(ctx, 'r-55', '/compensation'), { kind: 'discount20' }, { ifMatch: 4 });
  }),

  ok(
    'transitionServiceRequest',
    'ok',
    '«Взять в работу»: статус и системная запись',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(REQ(ctx, 'r-57', '/transitions'), { to: 'work' }, { ifMatch: 1 });
    },
  ),
  ok(
    'transitionServiceRequest',
    'resolved',
    '«Решено» с итогом — таймеры остановлены',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(
        REQ(ctx, 'r-55', '/transitions'),
        { to: 'resolved', outcome: 'Устранено' },
        { ifMatch: 1 },
      );
    },
  ),
  err(
    'transitionServiceRequest',
    'invalid_transition',
    'из «Новое» в «Закрыто» нельзя — 409',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(REQ(ctx, 'r-57', '/transitions'), { to: 'closed' }, { ifMatch: 1 });
    },
  ),

  ok(
    'updateServiceRequest',
    'ok',
    '«Назначить меня» — исполнитель по id участника',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.patch(REQ(ctx, 'r-57'), { assigneeId: ctx.A('m-kotova') }, { ifMatch: 1 });
    },
  ),
  err(
    'updateServiceRequest',
    'service_assignee_out_of_scope',
    'массажист не видит «Грузоперевозки» — назначить нельзя, 422',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.patch(REQ(ctx, 'r-57'), { assigneeId: ctx.A('m-morozova') }, { ifMatch: 1 });
    },
  ),

  ok(
    'moveServiceRequest',
    'ok',
    'владелец переносит обращение в «Массаж»: новый номер, старый ведёт сюда',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.post(REQ(ctx, 'r-57', '/move'), { directionId: ctx.A('d-mas') }, { ifMatch: 1 });
    },
  ),
  err(
    'moveServiceRequest',
    'forbidden_action',
    'менеджер без доступа к «Массажу» — 403',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(REQ(ctx, 'r-57', '/move'), { directionId: ctx.A('d-mas') }, { ifMatch: 1 });
    },
  ),

  ok(
    'revealServiceClientPhone',
    'ok',
    'владелец показывает телефон — запись в ленте',
    async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(REQ(ctx, 'r-57', '/client-phone/reveal'));
      const card = body(await s.get(REQ(ctx, 'r-57'))) as {
        client: { phone?: string };
        messages: { text: string }[];
      };
      expect(card.client.phone).toBe('+7 916 204-44-12');
      expect(card.messages.some((m) => /Телефон клиента показан/.test(m.text))).toBe(true);
      return r;
    },
  ),
  err(
    'revealServiceClientPhone',
    'forbidden_action',
    'менеджер без права «Контакты клиентов» — 403',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(REQ(ctx, 'r-57', '/client-phone/reveal'));
    },
  ),

  ok(
    'shareServiceConclusion',
    'ok',
    'вывод сотруднику после решения жалобы — без контактов клиента',
    async (ctx) => {
      const s = await ctx.as('owner');
      await s.post(
        REQ(ctx, 'r-41', '/transitions'),
        { to: 'resolved', outcome: 'Подтвердилась' },
        { ifMatch: 1 },
      );
      return s.post(
        REQ(ctx, 'r-41', '/conclusion'),
        { text: 'Жалоба подтвердилась: обсудим на планёрке, полотенца — по чек-листу.' },
        { ifMatch: 2 },
      );
    },
  ),
  err('shareServiceConclusion', 'validation_failed', 'вывод до решения — 422', async (ctx) => {
    const s = await ctx.as('owner');
    return s.post(
      REQ(ctx, 'r-41', '/conclusion'),
      { text: 'Жалоба подтвердилась, обсудим.' },
      { ifMatch: 1 },
    );
  }),

  ok(
    'createServiceRequestTask',
    'created',
    '«＋ Задача» из обращения — клиент её не видит',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(REQ(ctx, 'r-57', '/tasks'), { title: 'Найти накладную по рейсу' });
    },
    201,
  ),
  err(
    'createServiceRequestTask',
    'validation_failed',
    'тема короче трёх знаков — 422',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(REQ(ctx, 'r-57', '/tasks'), { title: 'ab' });
    },
  ),

  ok('listServiceRatings', 'ok', 'низкие оценки всех направлений', async (ctx) => {
    const s = await ctx.as('owner');
    return s.get(SV(ctx, '/ratings'));
  }),
  err('listServiceRatings', 'forbidden_action', 'водитель — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.get(SV(ctx, '/ratings'));
  }),

  ok(
    'decideServiceRating',
    'seen',
    '«Просмотрено» — оценка закрывается без обращения',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(SV(ctx, `/ratings/${ctx.A('S-305')}/decision`), { action: 'seen' });
    },
  ),
  ok(
    'decideServiceRating',
    'complaint',
    '«Открыть жалобу» — обращение «в работе», приоритет высокий при оценке ≤ 2',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(SV(ctx, `/ratings/${ctx.A('S-305')}/decision`), { action: 'complaint' });
    },
  ),
  err('decideServiceRating', 'not_found', 'оценки нет — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(SV(ctx, `/ratings/${NOBODY}/decision`), { action: 'seen' });
  }),

  ok('listServiceReplyTemplates', 'ok', 'шаблоны ответов направления', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(SV(ctx, `/directions/${ctx.A('d-grz')}/templates`));
  }),
  err('listServiceReplyTemplates', 'not_found', 'чужое направление — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(SV(ctx, `/directions/${ctx.A('d-mas')}/templates`));
  }),

  ok(
    'createServiceDirection',
    'created',
    'новое направление — сервисный проект задач создаётся вместе с ним',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.post(SV(ctx, '/directions'), { name: 'Гарантийный сервис', key: 'ГАР' });
    },
    201,
  ),
  err('createServiceDirection', 'validation_failed', 'ключ «ГРЗ» занят — 422', async (ctx) => {
    const s = await ctx.as('owner');
    return s.post(SV(ctx, '/directions'), { name: 'Второе направление', key: 'ГРЗ' });
  }),

  ok('getServiceDirection', 'ok', 'направление с типами; черновика нет', async (ctx) => {
    const s = await ctx.as('owner');
    return s.get(SV(ctx, `/directions/${ctx.A('d-grz')}`));
  }),
  err('getServiceDirection', 'not_found', 'направления нет — 404', async (ctx) => {
    const s = await ctx.as('owner');
    return s.get(SV(ctx, `/directions/${NOBODY}`));
  }),

  ok('updateServiceDirectionDraft', 'ok', 'черновик: цели «Вопроса» и календарь', async (ctx) => {
    const s = await ctx.as('owner');
    return s.put(
      SV(ctx, `/directions/${ctx.A('d-grz')}/draft`),
      {
        body: {
          name: 'Грузоперевозки',
          color: '#2B5479',
          calendar: {
            days: [1, 2, 3, 4, 5, 6, 7],
            from: '08:00',
            to: '20:00',
            timeZone: 'Europe/Moscow',
          },
          types: [
            {
              id: 'd-grz:question',
              kind: 'question',
              name: 'Вопрос',
              firstMinutes: 90,
              resolveMinutes: 1440,
              priority: 'normal',
            },
          ],
        },
      },
      { ifMatch: 1 },
    );
  }),
  err(
    'updateServiceDirectionDraft',
    'revision_mismatch',
    'устаревшая ревизия — 412',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.put(
        SV(ctx, `/directions/${ctx.A('d-grz')}/draft`),
        {
          body: {
            name: 'Грузоперевозки',
            color: '#2B5479',
            calendar: { days: [1], from: '08:00', to: '20:00', timeZone: 'Europe/Moscow' },
            types: [],
          },
        },
        { ifMatch: 5 },
      );
    },
  ),

  ok(
    'publishServiceDirection',
    'ok',
    'публикация черновика — типы направления заменены',
    async (ctx) => {
      const s = await ctx.as('owner');
      await s.put(
        SV(ctx, `/directions/${ctx.A('d-grz')}/draft`),
        {
          body: {
            name: 'Грузоперевозки',
            color: '#2B5479',
            calendar: {
              days: [1, 2, 3, 4, 5, 6, 7],
              from: '08:00',
              to: '20:00',
              timeZone: 'Europe/Moscow',
            },
            types: [
              {
                id: 'd-grz:question',
                kind: 'question',
                name: 'Вопрос',
                firstMinutes: 90,
                resolveMinutes: 1440,
                priority: 'normal',
              },
            ],
          },
        },
        { ifMatch: 1 },
      );
      return s.post(SV(ctx, `/directions/${ctx.A('d-grz')}/publish`));
    },
  ),
  err('publishServiceDirection', 'invalid_transition', 'черновика нет — 409', async (ctx) => {
    const s = await ctx.as('owner');
    return s.post(SV(ctx, `/directions/${ctx.A('d-grz')}/publish`));
  }),

  ok(
    'getServiceReport',
    'ok',
    'отчёт: по направлениям, причины, недели; сотрудники — владельцу',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.get(SV(ctx, '/report'));
    },
  ),
  err(
    'getServiceReport',
    'forbidden_action',
    'менеджер без «Отчёты по обращениям» — 403',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(SV(ctx, '/report'));
    },
  ),

  // Портал клиента
  ok(
    'getPublicServicePage',
    'ok',
    'страница направления «Грузоперевозки»: типы и часы работы',
    async (ctx) => {
      return ctx.anon().get(`${PUB}/grz`);
    },
  ),
  err('getPublicServicePage', 'not_found', 'нет такой страницы — 404', async (ctx) => {
    return ctx.anon().get(`${PUB}/net-takoj`);
  }),

  ok(
    'submitPublicServiceRequest',
    'created',
    'клиент отправляет вопрос с виджета — личная ссылка выдаётся один раз',
    async (ctx) => {
      return ctx.anon().post(`${PUB}/grz/requests`, {
        typeId: 'd-grz:question',
        text: 'Подскажите, когда привезут груз по накладной Н-1182?',
        clientName: 'Ольга Крылова',
        phone: '+7 916 555-01-02',
        consent: true,
      });
    },
    201,
  ),
  err(
    'submitPublicServiceRequest',
    'validation_failed',
    'без согласия на обработку данных — 422',
    async (ctx) => {
      return ctx
        .anon()
        .post(`${PUB}/grz/requests`, { typeId: 'd-grz:question', text: 'Вопрос', consent: false });
    },
  ),

  ok(
    'getPublicServiceRequest',
    'ok',
    'клиент по ссылке видит статус «Ждём вашего ответа» и переписку без заметок',
    async (ctx) => {
      return ctx.anon().get(`${PUB}/requests/${token(ctx, 'r-55')}`);
    },
  ),
  err('getPublicServiceRequest', 'not_found', 'ссылка не найдена — 404', async (ctx) => {
    return ctx.anon().get(`${PUB}/requests/tok_00000000000000000000000000000000z`);
  }),

  ok(
    'postPublicServiceMessage',
    'created',
    'ответ клиента возвращает обращение из «Ждёт клиента» в работу',
    async (ctx) => {
      const r = await ctx.anon().post(`${PUB}/requests/${token(ctx, 'r-55')}/messages`, {
        text: 'Накладную отправил на почту, проверьте.',
      });
      const owner = await ctx.as('owner');
      expect((body(await owner.get(REQ(ctx, 'r-55'))) as { status: string }).status).toBe('work');
      return r;
    },
    201,
  ),
  err('postPublicServiceMessage', 'not_found', 'ссылка не найдена — 404', async (ctx) => {
    return ctx
      .anon()
      .post(`${PUB}/requests/tok_00000000000000000000000000000000z/messages`, { text: 'Привет' });
  }),

  ok(
    'ratePublicServiceResolution',
    'ok',
    '«Довольны ли решением?» — оценка 5 из 5',
    async (ctx) => {
      return ctx
        .anon()
        .post(`${PUB}/requests/${token(ctx, 'r-39')}/csat`, { score: 5, comment: 'Спасибо!' });
    },
  ),
  err(
    'ratePublicServiceResolution',
    'invalid_transition',
    'оценить можно только решённое — 409',
    async (ctx) => {
      return ctx.anon().post(`${PUB}/requests/${token(ctx, 'r-55')}/csat`, { score: 4 });
    },
  ),

  ok(
    'reopenPublicServiceRequest',
    'ok',
    '«Вопрос не решён» в течение 5 дней — обращение снова в работе',
    async (ctx) => {
      const m = await ctx.as('manager');
      await m.post(
        REQ(ctx, 'r-55', '/transitions'),
        { to: 'resolved', outcome: 'Устранено' },
        { ifMatch: 1 },
      );
      return ctx
        .anon()
        .post(`${PUB}/requests/${token(ctx, 'r-55')}/reopen`, { text: 'Накладная не пришла.' });
    },
  ),
  err(
    'reopenPublicServiceRequest',
    'invalid_transition',
    'обращение не решено — вернуть нечего, 409',
    async (ctx) => {
      return ctx.anon().post(`${PUB}/requests/${token(ctx, 'r-57')}/reopen`, {});
    },
  ),

  ok('optOutPublicSurveys', 'ok', '«СТОП» — опросов больше не будет', async (ctx) => {
    return ctx.anon().post(`${PUB}/requests/${token(ctx, 'r-55')}/opt-out`);
  }),
  err('optOutPublicSurveys', 'not_found', 'ссылка не найдена — 404', async (ctx) => {
    return ctx.anon().post(`${PUB}/requests/tok_00000000000000000000000000000000z/opt-out`);
  }),

  ok(
    'initiatePublicServiceUpload',
    'created',
    'билет загрузки файла клиента — карантин до проверки',
    async (ctx) => {
      return ctx.anon().post(`${PUB}/requests/${token(ctx, 'r-55')}/uploads`, {
        fileName: 'nakladnaya.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 482_000,
        sha256: 'b'.repeat(64),
      });
    },
    201,
  ),
  err(
    'initiatePublicServiceUpload',
    'payload_too_large',
    'файл больше 20 МБ — 413',
    async (ctx) => {
      return ctx.anon().post(`${PUB}/requests/${token(ctx, 'r-55')}/uploads`, {
        fileName: 'video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 30_000_000,
        sha256: 'c'.repeat(64),
      });
    },
  ),

  ok(
    'completePublicServiceUpload',
    'ok',
    'загрузка завершена — файл на проверке, 202',
    async (ctx) => {
      const t = token(ctx, 'r-55');
      const made = body(
        await ctx.anon().post(`${PUB}/requests/${t}/uploads`, {
          fileName: 'n.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 1000,
          sha256: 'd'.repeat(64),
        }),
      ).uploadId as string;
      return ctx
        .anon()
        .post(`${PUB}/requests/${t}/uploads/${made}/complete`, { sha256: 'd'.repeat(64) });
    },
    202,
  ),
  err('completePublicServiceUpload', 'not_found', 'загрузки нет — 404', async (ctx) => {
    return ctx.anon().post(`${PUB}/requests/${token(ctx, 'r-55')}/uploads/${NOBODY}/complete`, {
      sha256: 'e'.repeat(64),
    });
  }),
]);
