// Кейсы контрактного PR этапа 7 (W7.00): «Документы» (W7.23–W7.27) на срезе MSW `msw/docs` (папки и документы
// «Альты» эталона: «Север Логистик» — приказы, договоры, финансы; «ЖК Речной · квартира 42» — договор № 42/26 на
// маршруте). Персонажи: владелец (Дарья Зимина — управляет всем), менеджер (Марина Котова — владелец папок фирмы
// «Север», роль «Документы · править и делиться»), водитель (Илья Васильев — только «Читает», финансы закрыты),
// прораб (Алексей Соколов — договор объекта по связи «прораб объекта»). Движка документов нет: правка и тело — в
// движке (D-32), сессия открывается на просмотр. Примеры — tools/gen/examples-w700.mjs (снимки сценарного сервера).
import { expect } from 'vitest';

import type { Reply } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

type Call = (ctx: CaseContext) => Promise<Reply>;
type Body = Record<string, unknown> & { items?: Record<string, unknown>[] };
const body = (r: Reply): Body => r.body as Body;

const D = (ctx: CaseContext, id: string, rest = ''): string =>
  `${ctx.alta}/docs/${ctx.A(id)}${rest}`;
const F = (ctx: CaseContext, id: string, rest = ''): string =>
  `${ctx.alta}/doc-folders/${ctx.A(id)}${rest}`;
const NOBODY = '00000000-0000-5000-8000-0000000000cc';
const DOCS = (ctx: CaseContext): string => `${ctx.alta}/docs`;
const PUB = '/api/v1/public/doc-links';
const CALLBACK = '/api/v1/internal/docs/callback';
/** Ключ версии для сервера документов: тенант, документ, версия (по нему адаптер находит базу тенанта). */
const versionKey = (ctx: CaseContext, id: string, v: number): string =>
  `t${ctx.P('t-alta')}.d${ctx.A(id)}.v${v}`;
const JWT = { Authorization: 'Bearer docserver-test-jwt' };
const inDays = (n: number): string =>
  new Date(Date.parse('2026-10-01T07:30:00Z') + n * 86_400_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');

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

const routeBody = (
  ctx: CaseContext,
  steps: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) => ({ steps, ...extra });
const signStep = (ctx: CaseContext) => ({
  kind: 'sign',
  whoMemberIds: [ctx.A('m-owner')],
  days: 1,
});

/** Менеджер отправляет приказ на подпись владельцу бизнеса (один шаг «Утвердить»). */
async function orderOnSign(ctx: CaseContext) {
  const m = await ctx.as('manager');
  const r = await m.post(D(ctx, 'doc-ord', '/route'), routeBody(ctx, [signStep(ctx)]));
  expect(r.status).toBe(201);
  return m;
}

export const docsCases = cases('docs')([
  ok(
    'listDocuments',
    'ok',
    'менеджер: документы на маршруте и ждущие её — «Ждут меня» и счётчики',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(`${DOCS(ctx)}?filter=all`);
    },
  ),
  {
    title: 'водитель: финансовые документы и недоступные папки не видны, приказ — по роли',
    operationId: 'listDocuments',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      const titles = (body(await s.get(DOCS(ctx))).items ?? []).map((d) => d.title);
      expect(titles).toEqual(['Приказ № 14 · работа 4 ноября']);
    },
  },
  err('listDocuments', 'session_expired', 'без сессии — 401', (ctx) => ctx.anon().get(DOCS(ctx))),

  ok(
    'createDocument',
    'created',
    'менеджер создаёт приказ из шаблона — версия 1, поля шаблона',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(DOCS(ctx), {
        kind: 'text',
        title: 'Приказ № 15 · график на ноябрь',
        folderId: ctx.A('fd-log-ord'),
        templateId: ctx.A('tpl-order'),
      });
    },
    201,
  ),
  {
    title: 'скан: задание распознавания поставлено, документ с ПДн не распознаётся',
    operationId: 'createDocument',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const scan = await s.post(DOCS(ctx), {
        kind: 'pdf',
        title: 'Накладная ТН-5590',
        folderId: ctx.A('fd-log-ctr'),
        scan: true,
      });
      expect((body(scan).ocr as { status: string }).status).toBe('queued');
      const pdn = await s.post(DOCS(ctx), {
        kind: 'pdf',
        title: 'Паспорт водителя',
        folderId: ctx.A('fd-log-ctr'),
        scan: true,
        sensitivity: 'pdn',
      });
      expect(body(pdn).ocr).toBeUndefined();
    },
  },
  err(
    'createDocument',
    'validation_failed',
    'нет файлов для PDF — 422 «Добавьте файлы или фото»',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(DOCS(ctx), { kind: 'pdf', title: 'Накладная', folderId: ctx.A('fd-log-ctr') });
    },
  ),
  err('createDocument', 'forbidden_action', 'водитель создавать не может — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.post(DOCS(ctx), { kind: 'text', title: 'Записка', folderId: ctx.A('fd-log-ord') });
  }),

  ok(
    'getDocument',
    'ok',
    'прораб открывает договор № 42/26: маршрут, временный доступ, поля CRM',
    async (ctx) => {
      const s = await ctx.as('foreman');
      return s.get(D(ctx, 'doc-42'));
    },
  ),
  err(
    'getDocument',
    'not_found',
    'водитель вне документа — 404 «Документ недоступен»',
    async (ctx) => {
      const s = await ctx.as('driver');
      return s.get(D(ctx, 'doc-42'));
    },
  ),
  err(
    'getDocument',
    'function_blocked',
    'финансовый документ закрыт функции «Водитель» — 403',
    async (ctx) => {
      const s = await ctx.as('driver');
      return s.get(D(ctx, 'doc-pay'));
    },
  ),

  ok('updateDocument', 'ok', 'переименование приказа', async (ctx) => {
    const s = await ctx.as('manager');
    return s.patch(D(ctx, 'doc-ord'), { title: 'Приказ № 14 · выходной 4 ноября' }, { ifMatch: 1 });
  }),
  err(
    'updateDocument',
    'document_locked',
    'договор на маршруте — править нельзя, 409',
    async (ctx) => {
      const s = await ctx.as('foreman');
      return s.patch(
        D(ctx, 'doc-42'),
        { title: 'Договор подряда № 42/26 (новая редакция)' },
        { ifMatch: 1 },
      );
    },
  ),
  err('updateDocument', 'revision_mismatch', 'устаревшая ревизия — 412', async (ctx) => {
    const s = await ctx.as('manager');
    return s.patch(D(ctx, 'doc-ord'), { title: 'Приказ' }, { ifMatch: 9 });
  }),

  ok('moveDocument', 'ok', 'регламент переносится в «Договоры»', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-reg', '/move'), { folderId: ctx.A('fd-log-ctr') });
  }),
  ok(
    'moveDocument',
    'dry-run',
    'предпросмотр переноса — кто получит и потеряет доступ',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(D(ctx, 'doc-ord', '/move'), { folderId: ctx.A('fd-log-fin'), dryRun: true });
    },
  ),
  err('moveDocument', 'validation_failed', 'документ уже в этой папке — 422', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-ord', '/move'), { folderId: ctx.A('fd-log-ord') });
  }),
  err(
    'moveDocument',
    'document_locked',
    'договор на маршруте — перенос закрыт, 409',
    async (ctx) => {
      const s = await ctx.as('foreman');
      return s.post(D(ctx, 'doc-42', '/move'), { folderId: ctx.A('fd-rep') });
    },
  ),

  ok('archiveDocument', 'ok', 'документ в архив — фильтр «Архив»', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-reg', '/archive'));
  }),
  err(
    'archiveDocument',
    'invalid_transition',
    'документ на маршруте в архив не уходит — 409',
    async (ctx) => {
      const s = await ctx.as('foreman');
      return s.post(D(ctx, 'doc-42', '/archive'));
    },
  ),

  ok('restoreDocument', 'ok', 'возврат из архива — прежний статус', async (ctx) => {
    const s = await ctx.as('manager');
    await s.post(D(ctx, 'doc-reg', '/archive'));
    return s.post(D(ctx, 'doc-reg', '/restore'));
  }),
  err('restoreDocument', 'invalid_transition', 'документ не в архиве — 409', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-reg', '/restore'));
  }),

  ok('openDocumentSession', 'ok', 'без движка — просмотр: «Редактор подключается»', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(`${D(ctx, 'doc-fuel', '/open')}?mode=edit`);
  }),
  err('openDocumentSession', 'not_found', 'водитель вне документа — 404', async (ctx) => {
    const s = await ctx.as('driver');
    return s.get(D(ctx, 'doc-42', '/open'));
  }),

  ok('listDocVersions', 'ok', 'версии таблицы расхода топлива', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(D(ctx, 'doc-fuel', '/versions'));
  }),
  err('listDocVersions', 'not_found', 'водитель — 404', async (ctx) => {
    const s = await ctx.as('driver');
    return s.get(D(ctx, 'doc-42', '/versions'));
  }),

  ok(
    'saveDocVersion',
    'created',
    'сохранить версию с именем',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(D(ctx, 'doc-reg', '/versions'), { name: 'Перед согласованием' });
    },
    201,
  ),
  err('saveDocVersion', 'document_locked', 'договор на маршруте — 409', async (ctx) => {
    const s = await ctx.as('foreman');
    return s.post(D(ctx, 'doc-42', '/versions'), {});
  }),

  ok('nameDocVersion', 'ok', 'имя версии', async (ctx) => {
    const s = await ctx.as('manager');
    return s.put(D(ctx, 'doc-fuel', '/versions/4/name'), { name: 'Утверждённая' });
  }),
  err('nameDocVersion', 'not_found', 'версии нет — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.put(D(ctx, 'doc-fuel', '/versions/99/name'), { name: 'Нет' });
  }),

  ok(
    'restoreDocVersion',
    'created',
    'восстановление версии 2 — новая версия 5',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(D(ctx, 'doc-fuel', '/versions/2/restore'));
    },
    201,
  ),
  err('restoreDocVersion', 'not_found', 'версии нет — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-fuel', '/versions/99/restore'));
  }),

  ok('listDocComments', 'ok', 'обсуждение договора', async (ctx) => {
    const s = await ctx.as('foreman');
    return s.get(D(ctx, 'doc-42', '/comments'));
  }),
  err('listDocComments', 'not_found', 'водитель — 404', async (ctx) => {
    const s = await ctx.as('driver');
    return s.get(D(ctx, 'doc-42', '/comments'));
  }),

  ok(
    'createDocComment',
    'created',
    'комментарий к ячейке таблицы',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(D(ctx, 'doc-fuel', '/comments'), {
        text: 'Проверьте норму для Sprinter.',
        anchor: { kind: 'cell', ref: 'Октябрь!G4' },
      });
    },
    201,
  ),
  err(
    'createDocComment',
    'validation_failed',
    'пустой комментарий — 422 «Напишите комментарий»',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(D(ctx, 'doc-fuel', '/comments'), {
        text: '   ',
        anchor: { kind: 'cell', ref: 'Октябрь!G4' },
      });
    },
  ),

  ok(
    'replyDocComment',
    'created',
    'ответ прораба в обсуждении',
    async (ctx) => {
      const s = await ctx.as('foreman');
      return s.post(D(ctx, 'doc-42', `/comments/${ctx.A('dc-1')}/replies`), {
        text: 'Исправил: 27 ноября.',
      });
    },
    201,
  ),
  err('replyDocComment', 'not_found', 'комментария нет — 404', async (ctx) => {
    const s = await ctx.as('foreman');
    return s.post(D(ctx, 'doc-42', `/comments/${NOBODY}/replies`), { text: 'Ответ' });
  }),

  ok('resolveDocComment', 'ok', 'автор закрывает своё обсуждение', async (ctx) => {
    const s = await ctx.as('foreman');
    return s.post(D(ctx, 'doc-42', `/comments/${ctx.A('dc-1')}/resolve`));
  }),
  err(
    'resolveDocComment',
    'forbidden_action',
    'читающий с комментарием чужое не закрывает — 403',
    async (ctx) => {
      const m = await ctx.as('manager');
      const g = await m.post(D(ctx, 'doc-reg', '/grants'), {
        memberId: ctx.A('m-vasiliev'),
        level: 'comment',
      });
      expect(g.status).toBe(200);
      const s = await ctx.as('driver');
      return s.post(D(ctx, 'doc-reg', `/comments/${ctx.A('dc-2')}/resolve`));
    },
  ),

  ok(
    'skipDocMentionGrant',
    'ok',
    '«Не выдавать доступ» упомянутому — карточка «упомянули» снимается',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(D(ctx, 'doc-reg', `/comments/${ctx.A('dc-2')}/skip-grant`));
    },
  ),
  err('skipDocMentionGrant', 'not_found', 'комментария нет — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-reg', `/comments/${NOBODY}/skip-grant`));
  }),

  ok('getDocShares', 'ok', 'список доступа регламента', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(D(ctx, 'doc-reg', '/shares'));
  }),
  err('getDocShares', 'forbidden_action', 'водитель без права делиться — 403', async (ctx) => {
    const s = await ctx.as('driver');
    return s.get(D(ctx, 'doc-ord', '/shares'));
  }),

  ok(
    'setDocShares',
    'ok',
    'доступ «Комментирует» водителю — уведомление «Вам открыт доступ»',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.put(
        D(ctx, 'doc-reg', '/shares'),
        {
          mode: 'inherit',
          entries: [{ who: 'member', refId: ctx.A('m-vasiliev'), level: 'comment' }],
        },
        { ifMatch: 1 },
      );
    },
  ),
  ok(
    'setDocShares',
    'dry-run',
    'предпросмотр: «Только выбранные» — кто потеряет доступ',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.put(
        D(ctx, 'doc-reg', '/shares'),
        {
          mode: 'listed',
          entries: [{ who: 'member', refId: ctx.A('m-kotova'), level: 'edit' }],
          dryRun: true,
        },
        { ifMatch: 1 },
      );
    },
  ),
  err(
    'setDocShares',
    'delegation_exceeds_grant',
    'выдать выше своего уровня нельзя — 409',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.put(
        D(ctx, 'doc-reg', '/shares'),
        {
          mode: 'inherit',
          entries: [{ who: 'member', refId: ctx.A('m-vasiliev'), level: 'manage' }],
        },
        { ifMatch: 1 },
      );
    },
  ),
  err('setDocShares', 'revision_mismatch', 'устаревшая ревизия — 412', async (ctx) => {
    const s = await ctx.as('manager');
    return s.put(D(ctx, 'doc-reg', '/shares'), { mode: 'inherit', entries: [] }, { ifMatch: 7 });
  }),

  ok('grantDocAccess', 'ok', 'доступ из упоминания — запись «Комментирует»', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-reg', '/grants'), {
      memberId: ctx.A('m-vasiliev'),
      level: 'comment',
    });
  }),
  err('grantDocAccess', 'validation_failed', 'сотрудника нет — 422', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-reg', '/grants'), { memberId: NOBODY, level: 'view' });
  }),

  ok('listDocLinks', 'ok', 'внешние ссылки документа', async (ctx) => {
    const s = await ctx.as('owner');
    await s.post(D(ctx, 'doc-ord', '/links'), { level: 'view', expiresAt: inDays(14) });
    return s.get(D(ctx, 'doc-ord', '/links'));
  }),
  err('listDocLinks', 'not_found', 'документа нет — 404', async (ctx) => {
    const s = await ctx.as('owner');
    return s.get(`${DOCS(ctx)}/${NOBODY}/links`);
  }),

  ok(
    'createDocLink',
    'created',
    'внешняя ссылка на 14 дней — токен и PIN показываются один раз',
    async (ctx) => {
      const s = await ctx.as('owner');
      return s.post(D(ctx, 'doc-ord', '/links'), { level: 'view', expiresAt: inDays(14) });
    },
    201,
  ),
  err('createDocLink', 'validation_failed', 'срок больше 30 дней — 422', async (ctx) => {
    const s = await ctx.as('owner');
    return s.post(D(ctx, 'doc-ord', '/links'), { level: 'view', expiresAt: inDays(60) });
  }),

  ok('revokeDocLink', 'ok', 'ссылка отозвана — журнал открытий остаётся', async (ctx) => {
    const s = await ctx.as('owner');
    const made = body(
      await s.post(D(ctx, 'doc-ord', '/links'), { level: 'view', expiresAt: inDays(14) }),
    ) as { link: { id: string } };
    return s.delete(D(ctx, 'doc-ord', `/links/${made.link.id}`));
  }),
  err('revokeDocLink', 'not_found', 'ссылки нет — 404', async (ctx) => {
    const s = await ctx.as('owner');
    return s.delete(D(ctx, 'doc-ord', `/links/${NOBODY}`));
  }),

  ok('syncDocDataset', 'ok', 'столбцы «Данных» обновлены — новая версия таблицы', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-fuel', '/dataset-sync'), {});
  }),
  err('syncDocDataset', 'validation_failed', 'в тексте столбцов нет — 422', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-reg', '/dataset-sync'), {});
  }),

  ok(
    'createDocJob',
    'accepted',
    'распознавание скана — задание поставлено, 202',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(`${ctx.alta}/doc-jobs`, { op: 'ocr', docIds: [ctx.A('doc-inv')] });
    },
    202,
  ),
  err('createDocJob', 'validation_failed', '«Это уже PDF» — 422', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(`${ctx.alta}/doc-jobs`, { op: 'to_pdf', docIds: [ctx.A('doc-inv')] });
  }),
  err('createDocJob', 'job_in_progress', 'такое задание уже выполняется — 409', async (ctx) => {
    const s = await ctx.as('manager');
    await s.post(`${ctx.alta}/doc-jobs`, { op: 'ocr', docIds: [ctx.A('doc-inv')] });
    return s.post(`${ctx.alta}/doc-jobs`, { op: 'ocr', docIds: [ctx.A('doc-inv')] });
  }),

  ok('getDocJob', 'ok', 'задание выполнено — версия «после распознавания»', async (ctx) => {
    const s = await ctx.as('manager');
    const job = body(
      await s.post(`${ctx.alta}/doc-jobs`, { op: 'pdfa', docIds: [ctx.A('doc-inv')] }),
    ) as { id: string };
    return s.get(`${ctx.alta}/doc-jobs/${job.id}`);
  }),
  err('getDocJob', 'not_found', 'задания нет — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(`${ctx.alta}/doc-jobs/${NOBODY}`);
  }),

  ok(
    'retryDocJob',
    'accepted',
    'повтор с паролем файла — задание снова в очереди',
    async (ctx) => {
      const s = await ctx.as('manager');
      const job = body(
        await s.post(`${ctx.alta}/doc-jobs`, { op: 'compress', docIds: [ctx.A('doc-prot')] }),
      ) as { id: string; status: string };
      expect(job.status).toBe('failed');
      return s.post(`${ctx.alta}/doc-jobs/${job.id}/retry`, { password: '1234' });
    },
    202,
  ),
  err('retryDocJob', 'file_password_protected', 'неверный пароль файла — 422', async (ctx) => {
    const s = await ctx.as('manager');
    const job = body(
      await s.post(`${ctx.alta}/doc-jobs`, { op: 'compress', docIds: [ctx.A('doc-prot')] }),
    ) as { id: string };
    return s.post(`${ctx.alta}/doc-jobs/${job.id}/retry`, { password: 'нет' });
  }),

  ok('reviewOcrWord', 'ok', 'исправление сомнительного слова', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-inv', `/ocr/words/w1`), { action: 'fix', value: 'ГАЗель' });
  }),
  err('reviewOcrWord', 'not_found', 'слова нет — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-inv', '/ocr/words/w9'), { action: 'accept' });
  }),

  ok(
    'startDocRoute',
    'created',
    'приказ на подпись владельцу — версия «На согласование», задача-зеркало',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(D(ctx, 'doc-ord', '/route'), routeBody(ctx, [signStep(ctx)]));
    },
    201,
  ),
  ok('startDocRoute', 'dry-run', '«Что произойдёт» — без запуска', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-ord', '/route'), routeBody(ctx, [signStep(ctx)], { dryRun: true }));
  }),
  err(
    'startDocRoute',
    'separation_of_duties_conflict',
    'автор утверждает свой документ — 409',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(
        D(ctx, 'doc-ord', '/route'),
        routeBody(ctx, [{ kind: 'sign', whoMemberIds: [ctx.A('m-kotova')], days: 1 }]),
      );
    },
  ),
  err('startDocRoute', 'invalid_transition', 'документ уже на маршруте — 409', async (ctx) => {
    const s = await ctx.as('foreman');
    return s.post(
      D(ctx, 'doc-42', '/route'),
      routeBody(ctx, [{ kind: 'approve', whoMemberIds: [ctx.A('m-sokolov')], days: 1 }]),
    );
  }),

  ok(
    'getDocRoute',
    'ok',
    'маршрут договора: согласование прорабом, подпись заказчика',
    async (ctx) => {
      const s = await ctx.as('foreman');
      return s.get(D(ctx, 'doc-42', '/route'));
    },
  ),
  err('getDocRoute', 'not_found', 'маршрута нет — 404', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(D(ctx, 'doc-fuel', '/route'));
  }),

  ok(
    'decideDocRoute',
    'ok',
    'прораб согласует договор — шаг выполнен, ждём подпись заказчика',
    async (ctx) => {
      const s = await ctx.as('foreman');
      return s.post(D(ctx, 'doc-42', '/route/decisions'), { decision: 'approve' });
    },
  ),
  err(
    'decideDocRoute',
    'validation_failed',
    'возврат без комментария — 422 «Напишите, что доработать»',
    async (ctx) => {
      const s = await ctx.as('foreman');
      return s.post(D(ctx, 'doc-42', '/route/decisions'), { decision: 'return' });
    },
  ),
  err('decideDocRoute', 'forbidden_action', 'решение ждут не от менеджера — 403', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(D(ctx, 'doc-42', '/route/decisions'), { decision: 'approve' });
  }),

  ok(
    'requestDocSignCode',
    'ok',
    'подпись: повторный вход в Ортус (Q-W4.00-documents-2)',
    async (ctx) => {
      await orderOnSign(ctx);
      const s = await ctx.as('owner');
      return s.post(D(ctx, 'doc-ord', '/route/sign/code'), { method: 'pep_login' });
    },
  ),
  err(
    'requestDocSignCode',
    'dependency_unavailable',
    'код по SMS — порт доставки не подключён, 503 (D-31)',
    async (ctx) => {
      await orderOnSign(ctx);
      const s = await ctx.as('owner');
      return s.post(D(ctx, 'doc-ord', '/route/sign/code'), { method: 'pep_sms' });
    },
  ),

  ok(
    'confirmDocSign',
    'ok',
    'владелец подписывает — «Подписан», PDF/A-копия с листом согласования',
    async (ctx) => {
      await orderOnSign(ctx);
      const s = await ctx.as('owner');
      return s.post(D(ctx, 'doc-ord', '/route/sign'), {
        method: 'pep_login',
        password: 'ortus-demo',
      });
    },
  ),
  err('confirmDocSign', 'sign_code_invalid', 'неверное подтверждение — 422', async (ctx) => {
    await orderOnSign(ctx);
    const s = await ctx.as('owner');
    return s.post(D(ctx, 'doc-ord', '/route/sign'), { method: 'pep_login', password: 'неверно' });
  }),

  ok('ackDocument', 'ok', 'водитель ознакомлен — версия, время и устройство', async (ctx) => {
    const m = await ctx.as('manager');
    const started = await m.post(
      D(ctx, 'doc-ord', '/route'),
      routeBody(ctx, [
        {
          kind: 'ack',
          audience: [{ who: 'member', refId: ctx.A('m-vasiliev'), level: 'view' }],
          days: 3,
        },
      ]),
    );
    expect(started.status).toBe(201);
    const s = await ctx.as('driver');
    return s.post(D(ctx, 'doc-ord', '/ack'), { device: 'phone-390' });
  }),
  err('ackDocument', 'validation_failed', 'ознакомление запрошено у других — 422', async (ctx) => {
    const m = await ctx.as('manager');
    await m.post(
      D(ctx, 'doc-ord', '/route'),
      routeBody(ctx, [
        {
          kind: 'ack',
          audience: [{ who: 'member', refId: ctx.A('m-vasiliev'), level: 'view' }],
          days: 3,
        },
      ]),
    );
    return m.post(D(ctx, 'doc-ord', '/ack'), {});
  }),

  ok('closeDocAck', 'ok', 'автор завершает ознакомление досрочно', async (ctx) => {
    const m = await ctx.as('manager');
    await m.post(
      D(ctx, 'doc-ord', '/route'),
      routeBody(ctx, [
        {
          kind: 'ack',
          audience: [{ who: 'member', refId: ctx.A('m-vasiliev'), level: 'view' }],
          days: 3,
        },
      ]),
    );
    return m.post(D(ctx, 'doc-ord', '/route/ack/close'));
  }),
  err('closeDocAck', 'invalid_transition', 'ознакомление не идёт — 409', async (ctx) => {
    await orderOnSign(ctx);
    const m = await ctx.as('manager');
    return m.post(D(ctx, 'doc-ord', '/route/ack/close'));
  }),

  ok('resumeDocRoute', 'ok', 'после возврата автор возобновляет маршрут', async (ctx) => {
    const f = await ctx.as('foreman');
    await f.post(D(ctx, 'doc-42', '/route/decisions'), {
      decision: 'return',
      comment: 'Уточните срок в п. 2.1',
    });
    const o = await ctx.as('owner');
    return o.post(D(ctx, 'doc-42', '/route/resume'));
  }),
  err('resumeDocRoute', 'invalid_transition', 'маршрут не возвращён — 409', async (ctx) => {
    const o = await ctx.as('owner');
    return o.post(D(ctx, 'doc-42', '/route/resume'));
  }),

  ok('cancelDocRoute', 'ok', 'отмена маршрута — задача-зеркало закрывается', async (ctx) => {
    const o = await ctx.as('owner');
    return o.post(D(ctx, 'doc-42', '/route/cancel'));
  }),
  err('cancelDocRoute', 'invalid_transition', 'маршрут уже отменён — 409', async (ctx) => {
    const o = await ctx.as('owner');
    await o.post(D(ctx, 'doc-42', '/route/cancel'));
    return o.post(D(ctx, 'doc-42', '/route/cancel'));
  }),

  ok('listDocActivity', 'ok', 'журнал документа', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(D(ctx, 'doc-fuel', '/activity'));
  }),
  err('listDocActivity', 'not_found', 'водитель — 404', async (ctx) => {
    const s = await ctx.as('driver');
    return s.get(D(ctx, 'doc-42', '/activity'));
  }),

  ok(
    'listDocFolders',
    'ok',
    'папки менеджера: «Финансы» — только выбранные, шаблон маршрута у «Приказов»',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(`${ctx.alta}/doc-folders`);
    },
  ),
  err('listDocFolders', 'session_expired', 'без сессии — 401', (ctx) =>
    ctx.anon().get(`${ctx.alta}/doc-folders`),
  ),

  ok(
    'createDocFolder',
    'created',
    'новая папка «Акты» в «Север Логистик»',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.post(`${ctx.alta}/doc-folders`, { name: 'Акты', parentId: ctx.A('fd-log') });
    },
    201,
  ),
  err('createDocFolder', 'validation_failed', 'папка «Приказы» уже есть — 422', async (ctx) => {
    const s = await ctx.as('manager');
    return s.post(`${ctx.alta}/doc-folders`, { name: 'Приказы', parentId: ctx.A('fd-log') });
  }),

  ok('updateDocFolder', 'ok', 'переименование папки', async (ctx) => {
    const s = await ctx.as('owner');
    return s.patch(F(ctx, 'fd-log-ctr'), { name: 'Договоры 2026' }, { ifMatch: 1 });
  }),
  err('updateDocFolder', 'revision_mismatch', 'устаревшая ревизия — 412', async (ctx) => {
    const s = await ctx.as('owner');
    return s.patch(F(ctx, 'fd-log-ctr'), { name: 'Договоры' }, { ifMatch: 6 });
  }),

  {
    title: 'удаление пустой папки — 204, непустая — отказ',
    operationId: 'deleteDocFolder',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const made = body(
        await s.post(`${ctx.alta}/doc-folders`, { name: 'Черновики', parentId: ctx.A('fd-log') }),
      ) as { id: string };
      const r = await s.delete(`${ctx.alta}/doc-folders/${made.id}`);
      expect(r.status).toBe(204);
    },
  },
  err('deleteDocFolder', 'invalid_transition', 'в папке есть документы — 409', async (ctx) => {
    const s = await ctx.as('owner');
    return s.delete(F(ctx, 'fd-log-ctr'));
  }),

  ok('setDocFolderShares', 'ok', 'доступ папки «Договоры» — диспетчерам «Правит»', async (ctx) => {
    const s = await ctx.as('owner');
    return s.put(F(ctx, 'fd-log-ctr', '/shares'), {
      mode: 'inherit',
      entries: [{ who: 'group', refId: ctx.A('g-disp'), level: 'edit' }],
    });
  }),
  err('setDocFolderShares', 'delegation_exceeds_grant', 'выше своего уровня — 409', async (ctx) => {
    const s = await ctx.as('manager');
    return s.put(F(ctx, 'fd-log-ctr', '/shares'), {
      mode: 'inherit',
      entries: [{ who: 'member', refId: ctx.A('m-vasiliev'), level: 'manage' }],
    });
  }),

  ok('listDocTemplates', 'ok', 'три шаблона эталона', async (ctx) => {
    const s = await ctx.as('manager');
    return s.get(`${ctx.alta}/doc-templates`);
  }),
  err('listDocTemplates', 'session_expired', 'без сессии — 401', (ctx) =>
    ctx.anon().get(`${ctx.alta}/doc-templates`),
  ),

  ok(
    'listDocRouteTemplates',
    'ok',
    'шаблоны маршрутов папок «Приказы» и «ЖК Речной»',
    async (ctx) => {
      const s = await ctx.as('manager');
      return s.get(`${ctx.alta}/doc-route-templates`);
    },
  ),
  err('listDocRouteTemplates', 'session_expired', 'без сессии — 401', (ctx) =>
    ctx.anon().get(`${ctx.alta}/doc-route-templates`),
  ),

  ok(
    'openDocLink',
    'ok',
    'гость открывает документ по ссылке с PIN — просмотр с водяным знаком',
    async (ctx) => {
      const o = await ctx.as('owner');
      const made = body(
        await o.post(D(ctx, 'doc-ord', '/links'), { level: 'view', expiresAt: inDays(14) }),
      ) as { token: string; pin: string };
      return ctx.anon().post(`${PUB}/${made.token}/open`, { pin: made.pin });
    },
  ),
  err('openDocLink', 'public_token_expired', 'ссылка отозвана — 410', async (ctx) => {
    const o = await ctx.as('owner');
    const made = body(
      await o.post(D(ctx, 'doc-ord', '/links'), { level: 'view', expiresAt: inDays(14) }),
    ) as { token: string; link: { id: string } };
    await o.delete(D(ctx, 'doc-ord', `/links/${made.link.id}`));
    return ctx.anon().post(`${PUB}/${made.token}/open`, {});
  }),

  ok('docServerCallback', 'ok', 'сервер документов сохранил версию — {error: 0}', async (ctx) => {
    const r = await ctx.anon().request('POST', CALLBACK, {
      body: {
        key: versionKey(ctx, 'doc-fuel', 4),
        status: 2,
        url: 'https://docs.ortus.invalid/cache/doc-fuel-v5.xlsx',
      },
      headers: JWT,
      origin: false,
    });
    const s = await ctx.as('manager');
    expect(body(await s.get(D(ctx, 'doc-fuel', '/versions'))).items?.[0]?.version).toBe(5);
    return r;
  }),
  // Возврат 1: ключ несёт тенанта (t<тенант>.d<документ>.v<версия>), сессии у сервера документов нет.
  err(
    'docServerCallback',
    'session_expired',
    'подпись сервера не подтверждена — 401',
    async (ctx) => {
      return ctx.anon().request('POST', CALLBACK, {
        body: { key: versionKey(ctx, 'doc-fuel', 4), status: 2 },
        origin: false,
      });
    },
  ),
  err(
    'docServerCallback',
    'not_found',
    'подпись верна, ключа нет — 404, не {error: 1}',
    async (ctx) => {
      return ctx.anon().request('POST', CALLBACK, {
        body: { key: `t${ctx.P('t-alta')}.d${NOBODY}.v1`, status: 2 },
        headers: JWT,
        origin: false,
      });
    },
  ),
  err(
    'docServerCallback',
    'invalid_transition',
    'ключ устарел: версия документа уже новее — 409',
    async (ctx) => {
      return ctx.anon().request('POST', CALLBACK, {
        body: {
          key: versionKey(ctx, 'doc-fuel', 1),
          status: 2,
          url: 'https://docs.ortus.invalid/cache/old.xlsx',
        },
        headers: JWT,
        origin: false,
      });
    },
  ),
  err('docServerCallback', 'validation_failed', 'ключ в старом формате — 422', async (ctx) => {
    return ctx.anon().request('POST', CALLBACK, {
      body: { key: 'doc-fuel:v4', status: 2 },
      headers: JWT,
      origin: false,
    });
  }),
]);
