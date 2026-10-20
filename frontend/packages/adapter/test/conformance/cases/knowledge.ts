// Кейсы контрактного PR 3 этапа 4 (W4.04): «База знаний» (W4.31, W4.32) на сиде домена W4.30 «Альты» (стадия сида
// `knowledge`: «Логистика» — ограниченное пространство фирмы «Север Логистик», руководитель Марина Котова; «Салон и
// SPA», «Руководство» (закрытое), «Ремонт и стройка», «Общее»). Персонажи: владелец (Дарья Зимина), менеджер (Котова —
// руководитель «Логистики»), водитель (Илья Васильев — «Водителям», финансовые страницы закрыты), массажист (Анна
// Морозова — «Логистика» скрыта), прораб (Алексей Соколов — раздел объекта по связи «прораб объекта»). Примеры —
// tools/gen/examples-w404.mjs (снимки сценарного сервера, PD-43).
import { expect } from 'vitest';

import type { Reply } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

type Body = Record<string, unknown> & {
  items?: Record<string, unknown>[];
  nodes?: { title: string; id: string }[];
};
const body = (r: Reply): Body => r.body as Body;

const kb = (ctx: CaseContext, rest: string) => `${ctx.alta}/knowledge/${rest}`;
const titles = (r: Reply) => body(r).nodes?.map((n) => n.title);

/** Запрос права правки водителя на «Памятку водителя» (kb-drv-1). */
async function driverRequest(ctx: CaseContext): Promise<Reply> {
  const driver = await ctx.as('driver');
  return driver.post(kb(ctx, `nodes/${ctx.A('kb-drv-1')}/requests`), { can: 'edit' });
}

/** Руководитель «Логистики» одобряет запрос правки водителя на «Памятку водителя» — запись «правит» на узле. */
async function driverMayEdit(ctx: CaseContext): Promise<void> {
  const req = (await driverRequest(ctx)).body as { id: string };
  const manager = await ctx.as('manager');
  const r = await manager.post(kb(ctx, `requests/${req.id}/decision`), { decision: 'approve' });
  expect(r.status).toBe(200);
}

export const knowledgeCases = cases('knowledge')([
  // Пространства
  {
    title:
      'пространства менеджера: «Логистика» — руководитель, «Общее» — редактор, открытые — по уровню',
    operationId: 'listKnowledgeSpaces',
    expect: 'success',
    example: 'listKnowledgeSpaces/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(await manager.get(kb(ctx, 'spaces')), 'listKnowledgeSpaces/ok');
    },
  },
  {
    title: 'массажист не видит «Логистику» (область фирмы) и «Руководство» (закрытое)',
    operationId: 'listKnowledgeSpaces',
    expect: 'success',
    run: async (ctx) => {
      const therapist = await ctx.as('therapist');
      const names = (body(await therapist.get(kb(ctx, 'spaces'))).items ?? []).map((s) => s.name);
      expect(names).toEqual(['Салон и SPA', 'Ремонт и стройка', 'Общее']);
    },
  },
  {
    title: 'без сессии — 401',
    operationId: 'listKnowledgeSpaces',
    expect: 'error',
    example: 'listKnowledgeSpaces/session_expired',
    run: async (ctx) => {
      ctx.expectExample(
        await ctx.anon().get(kb(ctx, 'spaces')),
        'listKnowledgeSpaces/session_expired',
      );
    },
  },
  {
    title: 'владелец создаёт «Охрану труда» из пустого шаблона — пространство с главной страницей',
    operationId: 'createKnowledgeSpace',
    expect: 'success',
    example: 'createKnowledgeSpace/created',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.post(kb(ctx, 'spaces'), {
        name: 'Охрана труда',
        access: 'open',
        icon: 'health_and_safety',
        color: '#A13A33',
        templateKey: 'blank',
      });
      ctx.expectExample(r, 'createKnowledgeSpace/created');
    },
  },
  {
    title: 'имя занято — 422 «Пространство «Логистика» уже есть»',
    operationId: 'createKnowledgeSpace',
    expect: 'error',
    example: 'createKnowledgeSpace/validation_failed',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.post(kb(ctx, 'spaces'), { name: 'логистика', access: 'open' });
      ctx.expectExample(r, 'createKnowledgeSpace/validation_failed');
    },
  },
  {
    title: 'менеджер без «База знаний · Настраивать» — 403',
    operationId: 'createKnowledgeSpace',
    expect: 'error',
    example: 'createKnowledgeSpace/forbidden_action',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      const r = await manager.post(kb(ctx, 'spaces'), { name: 'Склад', access: 'open' });
      ctx.expectExample(r, 'createKnowledgeSpace/forbidden_action');
    },
  },
  {
    title: 'шаблоны пространств — четыре стартовых, папки функций с ролью читателей',
    operationId: 'listKnowledgeSpaceTemplates',
    expect: 'success',
    example: 'listKnowledgeSpaceTemplates/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.get(kb(ctx, 'space-templates')),
        'listKnowledgeSpaceTemplates/ok',
      );
    },
  },
  {
    title: 'шаблоны — только с правом создавать пространства',
    operationId: 'listKnowledgeSpaceTemplates',
    expect: 'error',
    example: 'listKnowledgeSpaceTemplates/forbidden_action',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(kb(ctx, 'space-templates')),
        'listKnowledgeSpaceTemplates/forbidden_action',
      );
    },
  },
  {
    title: 'правка уровня «Руководства» с dryRun — влияние без записи, ревизия прежняя',
    operationId: 'updateKnowledgeSpace',
    expect: 'success',
    example: 'updateKnowledgeSpace/dry-run',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const url = kb(ctx, `spaces/${ctx.A('sp-own')}`);
      const r = await owner.patch(url, { access: 'limited', dryRun: true }, { ifMatch: 1 });
      ctx.expectExample(r, 'updateKnowledgeSpace/dry-run');
      const applied = await owner.patch(url, { name: 'Руководство и финансы' }, { ifMatch: 1 });
      expect(applied.status).toBe(200);
      expect((applied.body as { space: { revision: number } }).space.revision).toBe(2);
    },
  },
  {
    title: 'устаревшая ревизия пространства — 412',
    operationId: 'updateKnowledgeSpace',
    expect: 'error',
    example: 'updateKnowledgeSpace/revision_mismatch',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.patch(
        kb(ctx, `spaces/${ctx.A('sp-own')}`),
        { access: 'limited' },
        { ifMatch: 7 },
      );
      ctx.expectExample(r, 'updateKnowledgeSpace/revision_mismatch');
    },
  },

  // Дерево, поиск, узел
  {
    title: 'дерево «Логистики» водителя: «Тарифы и начисления» закрыты функцией',
    operationId: 'getKnowledgeSpaceTree',
    expect: 'success',
    example: 'getKnowledgeSpaceTree/ok',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      const r = await driver.get(kb(ctx, `spaces/${ctx.A('sp-log')}/tree`));
      ctx.expectExample(r, 'getKnowledgeSpaceTree/ok');
      expect(titles(r)).not.toContain('Тарифы и начисления');
      const manager = await ctx.as('manager');
      const lead = await manager.get(kb(ctx, `spaces/${ctx.A('sp-log')}/tree`));
      expect(titles(lead)).toContain('Тарифы и начисления');
    },
  },
  {
    title: 'скрытое пространство — 404, как отсутствующее',
    operationId: 'getKnowledgeSpaceTree',
    expect: 'error',
    example: 'getKnowledgeSpaceTree/not_found',
    run: async (ctx) => {
      const therapist = await ctx.as('therapist');
      ctx.expectExample(
        await therapist.get(kb(ctx, `spaces/${ctx.A('sp-log')}/tree`)),
        'getKnowledgeSpaceTree/not_found',
      );
    },
  },
  {
    title: 'поиск водителя «одометр» — только видимые страницы, путь и выдержка',
    operationId: 'searchKnowledge',
    expect: 'success',
    example: 'searchKnowledge/ok',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `search?q=${encodeURIComponent('одометр')}`)),
        'searchKnowledge/ok',
      );
    },
  },
  {
    title: 'поиск короче 2 символов — 422',
    operationId: 'searchKnowledge',
    expect: 'error',
    example: 'searchKnowledge/validation_failed',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `search?q=${encodeURIComponent(' ф ')}`)),
        'searchKnowledge/validation_failed',
      );
    },
  },
  {
    title: 'страница водителя: версия, ознакомление запрошено у него',
    operationId: 'getKnowledgeNode',
    expect: 'success',
    example: 'getKnowledgeNode/ok',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      const r = await driver.get(kb(ctx, `nodes/${ctx.A('kb-1')}`));
      ctx.expectExample(r, 'getKnowledgeNode/ok');
      expect(r.headers.get('ETag')).toBe('"rev-2"');
    },
  },
  {
    title:
      'финансовая страница водителю — 404 «Страница не найдена или недоступна», не function_blocked',
    operationId: 'getKnowledgeNode',
    expect: 'error',
    example: 'getKnowledgeNode/not_found',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `nodes/${ctx.A('kb-fin')}`)),
        'getKnowledgeNode/not_found',
      );
    },
  },
  {
    title: 'старая версия регламента — v1',
    operationId: 'getKnowledgeNodeVersion',
    expect: 'success',
    example: 'getKnowledgeNodeVersion/ok',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `nodes/${ctx.A('kb-1')}/versions/1`)),
        'getKnowledgeNodeVersion/ok',
      );
    },
  },
  {
    title: 'неизвестная версия — 404',
    operationId: 'getKnowledgeNodeVersion',
    expect: 'error',
    example: 'getKnowledgeNodeVersion/not_found',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `nodes/${ctx.A('kb-1')}/versions/9`)),
        'getKnowledgeNodeVersion/not_found',
      );
    },
  },

  // Команды узла
  {
    title: 'руководитель создаёт страницу в «Регламентах» — черновик v1, доступ родителя',
    operationId: 'createKnowledgeNode',
    expect: 'success',
    example: 'createKnowledgeNode/created',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      const r = await manager.post(kb(ctx, `spaces/${ctx.A('sp-log')}/nodes`), {
        parentId: ctx.A('kb-f-reg'),
        kind: 'page',
        title: 'Выезд в непогоду',
      });
      ctx.expectExample(r, 'createKnowledgeNode/created');
    },
  },
  {
    title: 'водитель без «Создавать» — 403',
    operationId: 'createKnowledgeNode',
    expect: 'error',
    example: 'createKnowledgeNode/forbidden_action',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      const r = await driver.post(kb(ctx, `spaces/${ctx.A('sp-log')}/nodes`), {
        kind: 'page',
        title: 'Моя страница',
      });
      ctx.expectExample(r, 'createKnowledgeNode/forbidden_action');
    },
  },
  {
    title: 'файл не создаётся из интерфейса — 422 «Выберите тип: страница, папка или схема»',
    operationId: 'createKnowledgeNode',
    expect: 'error',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      const r = await manager.post(kb(ctx, `spaces/${ctx.A('sp-log')}/nodes`), {
        kind: 'diagram',
        title: 'С',
      });
      ctx.expectProblem(r, 'validation_failed');
    },
  },
  {
    title: 'публикация v3 регламента с просьбой ознакомиться — аудитория уведомлена',
    operationId: 'publishKnowledgeNodeVersion',
    expect: 'success',
    example: 'publishKnowledgeNodeVersion/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      const r = await manager.post(
        kb(ctx, `nodes/${ctx.A('kb-1')}/versions`),
        {
          body: 'Менеджер проверяет фото до и после (5 ракурсов, включая одометр), пробег и расходы с чеками.\n\nМашина возвращается в пул только после приёмки.',
          requestAck: true,
        },
        { ifMatch: 2 },
      );
      ctx.expectExample(r, 'publishKnowledgeNodeVersion/ok');
      expect(r.headers.get('ETag')).toBe('"rev-3"');
    },
  },
  {
    title: 'правка устаревшей версии — 412 «Страницу уже изменили (v2)…»',
    operationId: 'publishKnowledgeNodeVersion',
    expect: 'error',
    example: 'publishKnowledgeNodeVersion/revision_mismatch',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      const r = await manager.post(
        kb(ctx, `nodes/${ctx.A('kb-1')}/versions`),
        { body: 'Старый текст.' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'publishKnowledgeNodeVersion/revision_mismatch');
    },
  },
  // Возврат 1 (ревью): правку и создание даёт цепочка доступа узла — шлюз пускает читающего, право проверяет модуль.
  {
    title: 'одобренный запрос правки: водитель без «Редактировать» публикует v2 «Памятки водителя»',
    operationId: 'publishKnowledgeNodeVersion',
    expect: 'success',
    run: async (ctx) => {
      await driverMayEdit(ctx);
      const driver = await ctx.as('driver');
      const r = await driver.post(
        kb(ctx, `nodes/${ctx.A('kb-drv-1')}/versions`),
        { body: 'Перед сменой — осмотр машины в приложении: пять фото и пробег.' },
        { ifMatch: 1 },
      );
      expect(r.status).toBe(201);
      expect((r.body as { version: number }).version).toBe(2);
      expect(r.headers.get('ETag')).toBe('"rev-2"');
    },
  },
  {
    title: 'прораб правит «Как попасть на объект» по связи «прораб объекта» (KB-01)',
    operationId: 'publishKnowledgeNodeVersion',
    expect: 'success',
    run: async (ctx) => {
      const foreman = await ctx.as('foreman');
      const url = kb(ctx, `nodes/${ctx.A('kb-o-obj-42-2')}`);
      expect(((await foreman.get(url)).body as { my: { edit: boolean } }).my.edit).toBe(true);
      const r = await foreman.post(
        `${url}/versions`,
        { body: 'Подъезд 2, этаж 9, домофон 42К.\n\nКлючи у прораба.' },
        { ifMatch: 1 },
      );
      expect(r.status).toBe(201);
      expect((r.body as { version: number }).version).toBe(2);
    },
  },
  {
    title:
      '«Читают все, правят выбранные» с ролью «Водитель»: роль без «Редактировать» правит страницу',
    operationId: 'publishKnowledgeNodeVersion',
    expect: 'success',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      const url = kb(ctx, `nodes/${ctx.A('kb-drv-2')}`);
      const saved = await manager.put(
        `${url}/access`,
        {
          mode: 'edit_listed',
          entries: [
            {
              who: 'role',
              refId: ctx.A('r-driver'),
              orgUnitId: ctx.A('f-msk-sever'),
              can: 'edit',
            },
          ],
        },
        { ifMatch: 1 },
      );
      expect((saved.body as { applied: boolean }).applied).toBe(true);
      const driver = await ctx.as('driver');
      const r = await driver.post(
        `${url}/versions`,
        { body: 'Остановитесь в безопасном месте и включите аварийную сигнализацию.' },
        { ifMatch: 1 },
      );
      expect(r.status).toBe(201);
    },
  },
  {
    title:
      'страницу без записи «правит» водитель не публикует — 403 модуля «Нет права править «…»»',
    operationId: 'publishKnowledgeNodeVersion',
    expect: 'error',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      const r = await driver.post(
        kb(ctx, `nodes/${ctx.A('kb-drv-3')}/versions`),
        { body: 'Новый текст.' },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'forbidden_action');
      expect((r.body as { detail?: string }).detail).toBe(
        'Нет права править «Контакты диспетчеров»',
      );
    },
  },
  {
    title: 'одобренный запрос правки: водитель создаёт подстраницу «Памятки водителя»',
    operationId: 'createKnowledgeNode',
    expect: 'success',
    run: async (ctx) => {
      await driverMayEdit(ctx);
      const driver = await ctx.as('driver');
      const r = await driver.post(kb(ctx, `spaces/${ctx.A('sp-log')}/nodes`), {
        parentId: ctx.A('kb-drv-1'),
        kind: 'page',
        title: 'Зимняя памятка',
      });
      expect(r.status).toBe(201);
      expect((r.body as { parentId: string }).parentId).toBe(ctx.A('kb-drv-1'));
    },
  },
  {
    title: 'одобренный запрос правки: водитель добавляет таблицу на «Памятку водителя»',
    operationId: 'createKnowledgeTable',
    expect: 'success',
    run: async (ctx) => {
      await driverMayEdit(ctx);
      const driver = await ctx.as('driver');
      const r = await driver.post(kb(ctx, `nodes/${ctx.A('kb-drv-1')}/tables`), {
        title: 'Пробеги',
        columns: [{ name: 'Дата' }],
      });
      expect(r.status).toBe(201);
    },
  },
  {
    title: 'руководитель утверждает «Выезд при критическом дефекте»',
    operationId: 'setKnowledgeNodeStatus',
    expect: 'success',
    example: 'setKnowledgeNodeStatus/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.post(kb(ctx, `nodes/${ctx.A('kb-6')}/status`), { status: 'active' }),
        'setKnowledgeNodeStatus/ok',
      );
    },
  },
  {
    title: 'водитель не утверждает — 403',
    operationId: 'setKnowledgeNodeStatus',
    expect: 'error',
    example: 'setKnowledgeNodeStatus/forbidden_action',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.post(kb(ctx, `nodes/${ctx.A('kb-6')}/status`), { status: 'active' }),
        'setKnowledgeNodeStatus/forbidden_action',
      );
    },
  },
  {
    title:
      'перенос «Памятки водителя» на верхний уровень с dryRun — кто получит чтение, без записи',
    operationId: 'moveKnowledgeNode',
    expect: 'success',
    example: 'moveKnowledgeNode/dry-run',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      const url = kb(ctx, `nodes/${ctx.A('kb-drv-1')}/move`);
      ctx.expectExample(
        await manager.post(url, { parentId: null, dryRun: true }),
        'moveKnowledgeNode/dry-run',
      );
      const node = await manager.get(kb(ctx, `nodes/${ctx.A('kb-drv-1')}`));
      expect((node.body as { parentId: string }).parentId).toBe(ctx.A('kb-f-drv'));
      const moved = await manager.post(url, { parentId: null });
      expect((moved.body as { applied: boolean }).applied).toBe(true);
    },
  },
  {
    title: 'перенос внутрь своей подстраницы — 422',
    operationId: 'moveKnowledgeNode',
    expect: 'error',
    example: 'moveKnowledgeNode/validation_failed',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.post(kb(ctx, `nodes/${ctx.A('kb-f-reg')}/move`), {
          parentId: ctx.A('kb-1'),
        }),
        'moveKnowledgeNode/validation_failed',
      );
    },
  },
  {
    title: 'в архив «Типовые замечания» — ветка исчезает из дерева',
    operationId: 'archiveKnowledgeNode',
    expect: 'success',
    example: 'archiveKnowledgeNode/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.post(kb(ctx, `nodes/${ctx.A('kb-1b')}/archive`)),
        'archiveKnowledgeNode/ok',
      );
      const tree = await manager.get(kb(ctx, `spaces/${ctx.A('sp-log')}/tree`));
      expect(titles(tree)).not.toContain('Типовые замечания');
    },
  },
  {
    title: 'главную страницу не архивируют — 422',
    operationId: 'archiveKnowledgeNode',
    expect: 'error',
    example: 'archiveKnowledgeNode/validation_failed',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.post(kb(ctx, `nodes/${ctx.A('kb-log-home')}/archive`)),
        'archiveKnowledgeNode/validation_failed',
      );
    },
  },
  {
    title: 'архив «Логистики» и восстановление ветки на прежнее место',
    operationId: 'listKnowledgeArchive',
    expect: 'success',
    example: 'listKnowledgeArchive/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      await manager.post(kb(ctx, `nodes/${ctx.A('kb-1b')}/archive`));
      ctx.expectExample(
        await manager.get(kb(ctx, `spaces/${ctx.A('sp-log')}/archive`)),
        'listKnowledgeArchive/ok',
      );
    },
  },
  {
    title: 'архив водителю закрыт — 403',
    operationId: 'listKnowledgeArchive',
    expect: 'error',
    example: 'listKnowledgeArchive/forbidden_action',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `spaces/${ctx.A('sp-log')}/archive`)),
        'listKnowledgeArchive/forbidden_action',
      );
    },
  },
  {
    title: 'восстановление «Типовых замечаний» из архива',
    operationId: 'restoreKnowledgeNode',
    expect: 'success',
    example: 'restoreKnowledgeNode/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      await manager.post(kb(ctx, `nodes/${ctx.A('kb-1b')}/archive`));
      ctx.expectExample(
        await manager.post(kb(ctx, `nodes/${ctx.A('kb-1b')}/restore`)),
        'restoreKnowledgeNode/ok',
      );
      const tree = await manager.get(kb(ctx, `spaces/${ctx.A('sp-log')}/tree`));
      expect(titles(tree)).toContain('Типовые замечания');
    },
  },
  {
    title: 'водитель не восстанавливает — 403',
    operationId: 'restoreKnowledgeNode',
    expect: 'error',
    example: 'restoreKnowledgeNode/forbidden_action',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.post(kb(ctx, `nodes/${ctx.A('kb-1')}/restore`)),
        'restoreKnowledgeNode/forbidden_action',
      );
    },
  },
  {
    title: 'водитель отмечает «Ознакомлен» с регламентом v2',
    operationId: 'ackKnowledgeNode',
    expect: 'success',
    example: 'ackKnowledgeNode/ok',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.post(kb(ctx, `nodes/${ctx.A('kb-1')}/ack`), { version: 2 }),
        'ackKnowledgeNode/ok',
      );
    },
  },
  {
    title: 'ознакомление запрошено у другой роли — 422',
    operationId: 'ackKnowledgeNode',
    expect: 'error',
    example: 'ackKnowledgeNode/validation_failed',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.post(kb(ctx, `nodes/${ctx.A('kb-1')}/ack`), { version: 2 }),
        'ackKnowledgeNode/validation_failed',
      );
    },
  },

  // Доступ узла
  {
    title: 'доступ «Водителям» глазами водителя — список без охвата и запросов',
    operationId: 'getKnowledgeNodeAccess',
    expect: 'success',
    example: 'getKnowledgeNodeAccess/ok',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `nodes/${ctx.A('kb-f-drv')}/access`)),
        'getKnowledgeNodeAccess/ok',
      );
    },
  },
  {
    title: 'доступ «Водителям» руководителю — охват записей',
    operationId: 'getKnowledgeNodeAccess',
    expect: 'success',
    example: 'getKnowledgeNodeAccess/lead',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(kb(ctx, `nodes/${ctx.A('kb-f-drv')}/access`)),
        'getKnowledgeNodeAccess/lead',
      );
    },
  },
  {
    title: 'доступ скрытой страницы — 404',
    operationId: 'getKnowledgeNodeAccess',
    expect: 'error',
    example: 'getKnowledgeNodeAccess/not_found',
    run: async (ctx) => {
      const therapist = await ctx.as('therapist');
      ctx.expectExample(
        await therapist.get(kb(ctx, `nodes/${ctx.A('kb-f-drv')}/access`)),
        'getKnowledgeNodeAccess/not_found',
      );
    },
  },
  {
    title: 'кандидаты «Кого добавить» в «Водителям» — роли, группы, сотрудники с охватом',
    operationId: 'listKnowledgeAccessCandidates',
    expect: 'success',
    example: 'listKnowledgeAccessCandidates/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(kb(ctx, `nodes/${ctx.A('kb-f-drv')}/access/candidates`)),
        'listKnowledgeAccessCandidates/ok',
      );
    },
  },
  {
    title: 'кандидаты — только руководителю, водителю 403',
    operationId: 'listKnowledgeAccessCandidates',
    expect: 'error',
    example: 'listKnowledgeAccessCandidates/forbidden_action',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `nodes/${ctx.A('kb-f-drv')}/access/candidates`)),
        'listKnowledgeAccessCandidates/forbidden_action',
      );
    },
  },
  {
    title: '«Как фотографировать машину»: «Только выбранные» с dryRun — кто потеряет чтение',
    operationId: 'setKnowledgeNodeAccess',
    expect: 'success',
    example: 'setKnowledgeNodeAccess/dry-run',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      const url = kb(ctx, `nodes/${ctx.A('kb-2')}/access`);
      const change = {
        mode: 'listed',
        entries: [
          { who: 'role', refId: ctx.A('r-kb-editor'), can: 'edit' },
          { who: 'member', refId: ctx.A('m-vasiliev'), can: 'view' },
        ],
      };
      ctx.expectExample(
        await manager.put(url, { ...change, dryRun: true }, { ifMatch: 1 }),
        'setKnowledgeNodeAccess/dry-run',
      );
      const saved = await manager.put(url, change, { ifMatch: 1 });
      expect((saved.body as { applied: boolean }).applied).toBe(true);
      expect(saved.headers.get('ETag')).toBe('"rev-2"');
    },
  },
  {
    title: 'связь «прораб объекта» вне раздела — 422 (KB-01)',
    operationId: 'setKnowledgeNodeAccess',
    expect: 'error',
    example: 'setKnowledgeNodeAccess/validation_failed',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      const r = await manager.put(
        kb(ctx, `nodes/${ctx.A('kb-2')}/access`),
        {
          mode: 'edit_listed',
          entries: [
            {
              who: 'relation',
              relation: 'foreman',
              object: { moduleKey: 'repairs', entityType: 'project', entityId: ctx.A('obj-42') },
              can: 'edit',
            },
          ],
        },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'setKnowledgeNodeAccess/validation_failed');
    },
  },
  {
    title: 'карта доступа «Логистики»: страницы × сотрудники, «Функция» у водителей',
    operationId: 'getKnowledgeAccessMap',
    expect: 'success',
    example: 'getKnowledgeAccessMap/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(kb(ctx, `spaces/${ctx.A('sp-log')}/access-map`)),
        'getKnowledgeAccessMap/ok',
      );
    },
  },
  {
    title: 'карта — только руководителю, водителю 403',
    operationId: 'getKnowledgeAccessMap',
    expect: 'error',
    example: 'getKnowledgeAccessMap/forbidden_action',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `spaces/${ctx.A('sp-log')}/access-map`)),
        'getKnowledgeAccessMap/forbidden_action',
      );
    },
  },
  {
    title: '«Проверить сотрудника»: водитель и «Тарифы и начисления» — закрыто функцией',
    operationId: 'explainKnowledgeAccess',
    expect: 'success',
    example: 'explainKnowledgeAccess/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(
          kb(ctx, `nodes/${ctx.A('kb-fin')}/explain?memberId=${ctx.A('m-vasiliev')}`),
        ),
        'explainKnowledgeAccess/ok',
      );
    },
  },
  {
    title: 'неизвестный сотрудник — 404',
    operationId: 'explainKnowledgeAccess',
    expect: 'error',
    example: 'explainKnowledgeAccess/not_found',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(
          kb(ctx, `nodes/${ctx.A('kb-fin')}/explain?memberId=${ctx.A('m-nobody')}`),
        ),
        'explainKnowledgeAccess/not_found',
      );
    },
  },

  // Запросы доступа
  {
    title: 'водитель просит право правки «Памятки водителя»',
    operationId: 'createKnowledgeAccessRequest',
    expect: 'success',
    example: 'createKnowledgeAccessRequest/created',
    run: async (ctx) => {
      ctx.expectExample(await driverRequest(ctx), 'createKnowledgeAccessRequest/created');
    },
  },
  {
    title: 'повторный запрос — 409 request_pending «Запрос уже отправлен»',
    operationId: 'createKnowledgeAccessRequest',
    expect: 'error',
    example: 'createKnowledgeAccessRequest/request_pending',
    run: async (ctx) => {
      await driverRequest(ctx);
      ctx.expectExample(await driverRequest(ctx), 'createKnowledgeAccessRequest/request_pending');
    },
  },
  {
    title: 'руководитель одобряет запрос — водитель правит страницу',
    operationId: 'decideKnowledgeAccessRequest',
    expect: 'success',
    example: 'decideKnowledgeAccessRequest/approved',
    run: async (ctx) => {
      const req = (await driverRequest(ctx)).body as { id: string };
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.post(kb(ctx, `requests/${req.id}/decision`), { decision: 'approve' }),
        'decideKnowledgeAccessRequest/approved',
      );
      const driver = await ctx.as('driver');
      const node = await driver.get(kb(ctx, `nodes/${ctx.A('kb-drv-1')}`));
      expect((node.body as { my: { edit: boolean } }).my.edit).toBe(true);
    },
  },
  {
    title: 'решённый или неизвестный запрос — 404',
    operationId: 'decideKnowledgeAccessRequest',
    expect: 'error',
    example: 'decideKnowledgeAccessRequest/not_found',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.post(kb(ctx, `requests/${ctx.A('kq-missing')}/decision`), {
          decision: 'deny',
        }),
        'decideKnowledgeAccessRequest/not_found',
      );
    },
  },
  {
    title: 'запросы «Логистики» руководителю',
    operationId: 'listKnowledgeAccessRequests',
    expect: 'success',
    example: 'listKnowledgeAccessRequests/ok',
    run: async (ctx) => {
      await driverRequest(ctx);
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(kb(ctx, `spaces/${ctx.A('sp-log')}/requests`)),
        'listKnowledgeAccessRequests/ok',
      );
    },
  },
  {
    title: 'запросы — только руководителю, водителю 403',
    operationId: 'listKnowledgeAccessRequests',
    expect: 'error',
    example: 'listKnowledgeAccessRequests/forbidden_action',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `spaces/${ctx.A('sp-log')}/requests`)),
        'listKnowledgeAccessRequests/forbidden_action',
      );
    },
  },

  // Участники
  {
    title: 'участники «Логистики» глазами водителя — только карточки ролей',
    operationId: 'listKnowledgeSpaceMembers',
    expect: 'success',
    example: 'listKnowledgeSpaceMembers/ok',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `spaces/${ctx.A('sp-log')}/members`)),
        'listKnowledgeSpaceMembers/ok',
      );
    },
  },
  {
    title: 'участники «Логистики» руководителю — «По уровню» и назначения на страницы',
    operationId: 'listKnowledgeSpaceMembers',
    expect: 'success',
    example: 'listKnowledgeSpaceMembers/lead',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(kb(ctx, `spaces/${ctx.A('sp-log')}/members`)),
        'listKnowledgeSpaceMembers/lead',
      );
    },
  },
  {
    title: 'участники скрытого пространства — 404',
    operationId: 'listKnowledgeSpaceMembers',
    expect: 'error',
    example: 'listKnowledgeSpaceMembers/not_found',
    run: async (ctx) => {
      const therapist = await ctx.as('therapist');
      ctx.expectExample(
        await therapist.get(kb(ctx, `spaces/${ctx.A('sp-log')}/members`)),
        'listKnowledgeSpaceMembers/not_found',
      );
    },
  },
  {
    title: 'руководитель добавляет Тимура Ахмедова читателем',
    operationId: 'setKnowledgeSpaceMember',
    expect: 'success',
    example: 'setKnowledgeSpaceMember/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.put(kb(ctx, `spaces/${ctx.A('sp-log')}/members/${ctx.A('m-akhmedov')}`), {
          role: 'kb_space_reader',
        }),
        'setKnowledgeSpaceMember/ok',
      );
    },
  },
  {
    title: 'свою роль руководителя снимает владелец бизнеса — 422',
    operationId: 'setKnowledgeSpaceMember',
    expect: 'error',
    example: 'setKnowledgeSpaceMember/validation_failed',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.put(kb(ctx, `spaces/${ctx.A('sp-log')}/members/${ctx.A('m-kotova')}`), {
          role: null,
        }),
        'setKnowledgeSpaceMember/validation_failed',
      );
    },
  },
  {
    title: 'роли пространств не попадают в listRoles access API (Q-W4.00-knowledge-21)',
    operationId: 'listRoles',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const roles = body(await owner.get(`${ctx.alta}/roles`)).items ?? [];
      expect(roles.map((r) => r.name)).not.toContain('Руководитель пространства');
    },
  },

  // Автоматизация
  {
    title: 'правила «Логистики»',
    operationId: 'listKnowledgeRules',
    expect: 'success',
    example: 'listKnowledgeRules/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(kb(ctx, `spaces/${ctx.A('sp-log')}/rules`)),
        'listKnowledgeRules/ok',
      );
    },
  },
  {
    title: 'правила — только руководителю, водителю 403',
    operationId: 'listKnowledgeRules',
    expect: 'error',
    example: 'listKnowledgeRules/forbidden_action',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `spaces/${ctx.A('sp-log')}/rules`)),
        'listKnowledgeRules/forbidden_action',
      );
    },
  },
  {
    title: 'руководитель выключает «Пора пересмотреть»',
    operationId: 'setKnowledgeRuleEnabled',
    expect: 'success',
    example: 'setKnowledgeRuleEnabled/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.patch(kb(ctx, `rules/${ctx.A('kr-2')}`), { enabled: false }),
        'setKnowledgeRuleEnabled/ok',
      );
    },
  },
  {
    title: 'правило водителю — 403, скрытого пространства и неизвестное — 404',
    operationId: 'setKnowledgeRuleEnabled',
    expect: 'error',
    example: 'setKnowledgeRuleEnabled/not_found',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectProblem(
        await driver.patch(kb(ctx, `rules/${ctx.A('kr-1')}`), { enabled: false }),
        'forbidden_action',
      );
      const manager = await ctx.as('manager');
      ctx.expectProblem(
        await manager.patch(kb(ctx, `rules/${ctx.A('kr-3')}`), { enabled: false }),
        'not_found',
      );
      ctx.expectExample(
        await manager.patch(kb(ctx, `rules/${ctx.A('kr-missing')}`), { enabled: false }),
        'setKnowledgeRuleEnabled/not_found',
      );
    },
  },
  {
    title: '«Проверить сроки сейчас»: «Как фотографировать машину» — пора пересмотреть',
    operationId: 'runKnowledgeReviewCheck',
    expect: 'success',
    example: 'runKnowledgeReviewCheck/ok',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.post(kb(ctx, `spaces/${ctx.A('sp-log')}/review-check`)),
        'runKnowledgeReviewCheck/ok',
      );
    },
  },
  {
    title: 'правило «Пора пересмотреть» выключено — 422',
    operationId: 'runKnowledgeReviewCheck',
    expect: 'error',
    example: 'runKnowledgeReviewCheck/validation_failed',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.post(kb(ctx, `spaces/${ctx.A('sp-rep')}/review-check`)),
        'runKnowledgeReviewCheck/validation_failed',
      );
    },
  },
  {
    title: '«Создать раздел» объекта «Кофейня на Покровке» — прораб не назначен, предупреждение',
    operationId: 'runKnowledgeSection',
    expect: 'success',
    example: 'runKnowledgeSection/created',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.post(kb(ctx, `spaces/${ctx.A('sp-rep')}/sections`), {
          projectId: ctx.A('obj-45'),
        }),
        'runKnowledgeSection/created',
      );
      const again = await owner.post(kb(ctx, `spaces/${ctx.A('sp-rep')}/sections`), {
        projectId: ctx.A('obj-45'),
      });
      expect((again.body as { created: boolean }).created).toBe(false);
    },
  },
  {
    title: 'неизвестный объект — 404 «Объект не найден»',
    operationId: 'runKnowledgeSection',
    expect: 'error',
    example: 'runKnowledgeSection/not_found',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.post(kb(ctx, `spaces/${ctx.A('sp-rep')}/sections`), {
          projectId: ctx.A('obj-99'),
        }),
        'runKnowledgeSection/not_found',
      );
    },
  },
  {
    title: 'журнал запусков «Ремонта и стройки»',
    operationId: 'listKnowledgeRuns',
    expect: 'success',
    example: 'listKnowledgeRuns/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.get(kb(ctx, `spaces/${ctx.A('sp-rep')}/runs`)),
        'listKnowledgeRuns/ok',
      );
    },
  },
  {
    title: 'журнал — только руководителю, водителю 403',
    operationId: 'listKnowledgeRuns',
    expect: 'error',
    example: 'listKnowledgeRuns/forbidden_action',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(kb(ctx, `spaces/${ctx.A('sp-log')}/runs`)),
        'listKnowledgeRuns/forbidden_action',
      );
    },
  },

  // Таблица страницы (ядро «Форм»)
  {
    title: 'таблица «Расходы в пути» на «Журнале осмотров машин»',
    operationId: 'createKnowledgeTable',
    expect: 'success',
    example: 'createKnowledgeTable/created',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.post(kb(ctx, `nodes/${ctx.A('kb-5')}/tables`), {
          title: 'Расходы в пути',
          columns: [{ name: 'Дата' }, { name: 'Сумма, ₽', type: 'number' }],
        }),
        'createKnowledgeTable/created',
      );
    },
  },
  {
    title: 'таблица без столбцов — 422 «Добавьте хотя бы один столбец»',
    operationId: 'createKnowledgeTable',
    expect: 'error',
    example: 'createKnowledgeTable/validation_failed',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.post(kb(ctx, `nodes/${ctx.A('kb-5')}/tables`), {
          title: 'Пробеги',
          columns: [],
        }),
        'createKnowledgeTable/validation_failed',
      );
    },
  },

  // Прораб и связь «прораб объекта» (KB-01)
  {
    title: 'прораб видит раздел «ЖК Речной · квартира 42» по связи, «Гарантию» — нет',
    operationId: 'getKnowledgeSpaceTree',
    expect: 'success',
    run: async (ctx) => {
      const foreman = await ctx.as('foreman');
      const r = await foreman.get(kb(ctx, `spaces/${ctx.A('sp-rep')}/tree`));
      expect(titles(r)).toContain('ЖК Речной · квартира 42');
      expect(titles(r)).toContain('Как попасть на объект');
      expect(titles(r)).not.toContain('Гарантия');
    },
  },
]);
