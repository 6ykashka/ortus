// Кейсы контрактного PR 2 этапа 4 (W4.03, 0.10.0-stage4): «Задачи и проекты» (W4.11–W4.13) на сиде «Альты» 14.10 и
// normProjects W4.10: проект LOG «Логистика · Север» (ограниченный, «С согласованием»), воронка «Заявки · Ремонт»,
// T-65 «Заменить шины на ГАЗон Next (зимние)» ждёт согласования (автор Илья Васильев сам не согласует), T-66 «Подготовить
// парк к зиме» состоит из T-65 и T-58, правила ar-1/ar-2 и журнал. Примеры — tools/gen/examples-w403.mjs.
import { expect } from 'vitest';

import type { Reply } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

interface Task {
  id: string;
  key: string;
  status: string;
  statusName: string;
  revision: number;
  priority: string;
  assigneeMemberId?: string;
  parentTaskId?: string;
  files?: { fileId: string; name: string }[];
  checklist?: { id: string; done: boolean }[];
  approval?: { approvers: { memberId: string; state: string }[]; canApprove: boolean };
  availableTransitions?: { key: string; allowed: boolean; reason?: string; reasonText?: string }[];
}
type Body = Record<string, unknown> & {
  items?: (Task & { name?: string; memberId?: string; text?: string; kind?: string })[];
  code?: string;
  reason?: string;
  detail?: string;
  revision?: number;
};
const body = (r: Reply): Body => r.body as Body;
const task = (r: Reply): Task => r.body as Task;

const at = (ctx: CaseContext, rest: string) => `${ctx.alta}/${rest}`;
const LOG = (ctx: CaseContext) => ctx.A('fleet');
const MISSING = '00000000-0000-5000-8000-0000000000aa';
const SHA = 'b4e2c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d';

/** Процесс LOG v1 (getTaskWorkflow) — черновик с новым статусом «Ждёт запчастей» перед «Готово». */
async function draftWithNewStatus(ctx: CaseContext, persona = 'manager') {
  const s = await ctx.as(persona);
  const wf = body(await s.get(at(ctx, `projects/${LOG(ctx)}/workflow`))) as unknown as {
    statuses: { id: string; name: string; category: string }[];
    transitions: unknown[];
    revision: number;
  };
  const statuses = [...wf.statuses];
  statuses.splice(3, 0, { id: 's6', name: 'Ждёт запчастей', category: 'progress' });
  const r = await s.put(
    at(ctx, `projects/${LOG(ctx)}/workflow/draft`),
    { statuses, transitions: wf.transitions },
    { ifMatch: wf.revision },
  );
  return { s, r, wf };
}

/** Новая задача менеджера в LOG, доведённая до «На проверке» (автор и исполнитель — Марина Котова). */
async function ownTaskOnReview(ctx: CaseContext) {
  const s = await ctx.as('manager');
  let t = task(
    await s.post(at(ctx, 'tasks'), { projectId: LOG(ctx), title: 'Оплатить шиномонтаж' }),
  );
  for (const key of ['t1', 't2']) {
    t = task(
      await s.post(
        at(ctx, `tasks/${t.id}/transitions`),
        { transitionKey: key },
        { ifMatch: t.revision },
      ),
    );
  }
  return { s, t };
}

/** Загрузка файла задачи (purpose task_attachment, владелец tasks/task) — fileId. */
async function upload(ctx: CaseContext, persona: string, taskId: string, name = 'Акт ТО.pdf') {
  const s = await ctx.as(persona);
  const ticket = body(
    await s.post(at(ctx, 'files/uploads'), {
      purpose: 'task_attachment',
      owner: { moduleKey: 'tasks', entityType: 'task', entityId: taskId },
      fileName: name,
      contentType: 'application/pdf',
      sizeBytes: 52000,
      sha256: SHA,
    }),
  ) as unknown as { uploadId: string; fileId: string };
  await s.post(at(ctx, `files/uploads/${ticket.uploadId}/complete`), { sha256: SHA });
  return { s, fileId: ticket.fileId };
}

export const tasksCases = cases('tasks')([
  // ── Проекты ──
  {
    title: 'владелец видит LOG и воронку «Заявки»: уровень, процесс v1, счётчики, системная роль',
    operationId: 'listTaskProjects',
    expect: 'success',
    example: 'listTaskProjects/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(at(ctx, 'projects')), 'listTaskProjects/ok');
    },
  },
  {
    title:
      'прораб (задачи только в области «своё») — 403, страница «Проектов, доступных вам, пока нет»',
    operationId: 'listTaskProjects',
    expect: 'error',
    example: 'listTaskProjects/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('foreman');
      ctx.expectExample(await s.get(at(ctx, 'projects')), 'listTaskProjects/forbidden_action');
    },
  },
  {
    title:
      'руководитель проекта видит LOG («Вы: Руководитель проекта»), закрытый проект владельцу не виден (TP-03)',
    operationId: 'listTaskProjects',
    expect: 'success',
    run: async (ctx) => {
      const m = await ctx.as('manager');
      const keys = (r: Reply) => body(r).items?.map((p) => p.key);
      expect(keys(await m.get(at(ctx, 'projects')))).toContain('LOG');
      const owner = await ctx.as('owner');
      const p = body(await owner.get(at(ctx, `projects/${LOG(ctx)}`)));
      await m.patch(
        at(ctx, `projects/${LOG(ctx)}`),
        { access: 'closed' },
        { ifMatch: p.revision as number },
      );
      expect(keys(await owner.get(at(ctx, 'projects')))).toEqual(['ЗАЯ']);
      expect((await owner.get(at(ctx, `projects/${LOG(ctx)}`))).status).toBe(404);
    },
  },
  {
    title: 'владелец создаёт проект «Ремонт · ЖК Речной» на всю организацию, процесс «Простой»',
    operationId: 'createTaskProject',
    expect: 'success',
    example: 'createTaskProject/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'projects'), {
        name: 'Ремонт · ЖК Речной',
        orgUnitId: null,
        key: 'РЧН',
        workflowKey: 'simple',
        access: 'limited',
      });
      ctx.expectExample(r, 'createTaskProject/created');
      const id = body(r).id as string;
      const wf = body(await s.get(at(ctx, `projects/${id}/workflow`)));
      expect((wf.transitions as { name: string }[]).map((t) => t.name)).toEqual([
        'Взять в работу',
        'На проверку',
        'Принять',
        'Вернуть на доработку',
        'Отменить',
      ]);
    },
  },
  {
    title: 'ключ занят — 422 «Ключ LOG уже занят»',
    operationId: 'createTaskProject',
    expect: 'error',
    example: 'createTaskProject/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.post(at(ctx, 'projects'), {
          name: 'Логистика · Юг',
          orgUnitId: ctx.A('f-msk-sever'),
          key: 'LOG',
          workflowKey: 'approval',
        }),
        'createTaskProject/validation_failed',
      );
    },
  },
  {
    title:
      'копия процесса LOG — правила копируются выключенными; руководитель проекта проект не создаёт (PD-53)',
    operationId: 'createTaskProject',
    expect: 'error',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const copy = body(
        await owner.post(at(ctx, 'projects'), {
          name: 'Логистика · Юг',
          orgUnitId: ctx.A('f-msk-sever'),
          key: 'ЛЮГ',
          workflowKey: 'copy',
          copyFromProjectId: LOG(ctx),
        }),
      );
      const rules = body(await owner.get(at(ctx, `projects/${copy.id as string}/automations`)));
      expect(
        rules.items?.map((x) => [x.name, (x as unknown as { enabled: boolean }).enabled]),
      ).toEqual([
        ['Срочная задача → назначить руководителю проекта', false],
        ['Задача готова → напомнить про путевой лист', false],
      ]);
      const m = await ctx.as('manager');
      const r = await m.post(at(ctx, 'projects'), {
        name: 'Логистика · Запад',
        orgUnitId: null,
        key: 'ЗАП',
        workflowKey: 'simple',
      });
      ctx.expectProblem(r, 'forbidden_action');
    },
  },
  {
    title:
      'проект LOG глазами руководителя проекта: «Вы: Руководитель проекта», «Назначен в проекте»',
    operationId: 'getTaskProject',
    expect: 'success',
    example: 'getTaskProject/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(await s.get(at(ctx, `projects/${LOG(ctx)}`)), 'getTaskProject/ok');
    },
  },
  {
    title: 'нет проекта — 404',
    operationId: 'getTaskProject',
    expect: 'error',
    example: 'getTaskProject/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(at(ctx, `projects/${MISSING}`)), 'getTaskProject/not_found');
    },
  },
  {
    title: 'руководитель проекта открывает проект («Доступ: Открытый»)',
    operationId: 'updateTaskProject',
    expect: 'success',
    example: 'updateTaskProject/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.patch(at(ctx, `projects/${LOG(ctx)}`), { access: 'open' }, { ifMatch: 1 }),
        'updateTaskProject/ok',
      );
    },
  },
  {
    title: 'исполнитель проекта не меняет доступ — 403',
    operationId: 'updateTaskProject',
    expect: 'error',
    example: 'updateTaskProject/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectExample(
        await s.patch(at(ctx, `projects/${LOG(ctx)}`), { access: 'open' }, { ifMatch: 1 }),
        'updateTaskProject/forbidden_action',
      );
    },
  },
  {
    title:
      '«Настроить процесс» у проекта без процесса — v1 из текущих статусов, «все во все» (TP-06)',
    operationId: 'initTaskProjectWorkflow',
    expect: 'success',
    example: 'initTaskProjectWorkflow/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner@t-lotos');
      const salon = ctx.L('salon');
      expect((await s.get(`${ctx.lotos}/projects/${salon}`)).status).toBe(200);
      const org = ctx.server.state().orgs[ctx.P('t-lotos')] as unknown as {
        tasksData: { projects: { proto: string; versions: unknown[] }[] };
      };
      const p = org.tasksData.projects.find((x) => x.proto === 'salon');
      if (p) p.versions = [];
      expect((await s.get(`${ctx.lotos}/projects/${salon}/workflow`)).status).toBe(404);
      ctx.expectExample(
        await s.post(`${ctx.lotos}/projects/${salon}/workflow/init`),
        'initTaskProjectWorkflow/ok',
      );
    },
  },
  {
    title: 'у LOG процесс уже есть — 409 workflow_exists',
    operationId: 'initTaskProjectWorkflow',
    expect: 'error',
    example: 'initTaskProjectWorkflow/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.post(at(ctx, `projects/${LOG(ctx)}/workflow/init`)),
        'initTaskProjectWorkflow/invalid_transition',
      );
    },
  },

  // ── Процесс ──
  {
    title: 'процесс LOG v1 «С согласованием»: статусы, переходы, правила перехода',
    operationId: 'getTaskWorkflow',
    expect: 'success',
    example: 'getTaskWorkflow/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `projects/${LOG(ctx)}/workflow`)),
        'getTaskWorkflow/ok',
      );
    },
  },
  {
    title: 'воронка «Заявки» — фиксированные этапы; черновик воронки — 409 funnel_fixed',
    operationId: 'getTaskWorkflow',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = body(await s.get(at(ctx, `projects/${ctx.A('leads')}/workflow`)));
      expect(r.fixed).toBe(true);
      expect((r.statuses as { name: string }[]).map((x) => x.name)).toEqual([
        'Новая',
        'Замер',
        'Смета',
        'Договор',
        'Объект',
        'Отказ',
      ]);
      const d = await s.put(
        at(ctx, `projects/${ctx.A('leads')}/workflow/draft`),
        { statuses: r.statuses, transitions: [] },
        { ifMatch: 1 },
      );
      ctx.expectProblem(d, 'invalid_transition');
      expect(body(d).reason).toBe('funnel_fixed');
    },
  },
  {
    title: 'нет проекта — 404',
    operationId: 'getTaskWorkflow',
    expect: 'error',
    example: 'getTaskWorkflow/not_found',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `projects/${MISSING}/workflow`)),
        'getTaskWorkflow/not_found',
      );
    },
  },
  {
    title: 'черновик с новым статусом «Ждёт запчастей» — «Черновик · действует v1»',
    operationId: 'saveTaskWorkflowDraft',
    expect: 'success',
    example: 'saveTaskWorkflowDraft/ok',
    run: async (ctx) => {
      const { r } = await draftWithNewStatus(ctx);
      ctx.expectExample(r, 'saveTaskWorkflowDraft/ok');
    },
  },
  {
    title: 'дубль статуса — 422 «Статус «Новая» уже есть»',
    operationId: 'saveTaskWorkflowDraft',
    expect: 'error',
    example: 'saveTaskWorkflowDraft/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const r = await s.put(
        at(ctx, `projects/${LOG(ctx)}/workflow/draft`),
        {
          statuses: [
            { id: 's1', name: 'Новая', category: 'todo' },
            { id: 's7', name: 'новая', category: 'todo' },
            { id: 's4', name: 'Готово', category: 'done' },
          ],
          transitions: [],
        },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'saveTaskWorkflowDraft/validation_failed');
    },
  },
  {
    title: '«Сбросить черновик»',
    operationId: 'discardTaskWorkflowDraft',
    expect: 'success',
    example: 'discardTaskWorkflowDraft/ok',
    run: async (ctx) => {
      const { s } = await draftWithNewStatus(ctx);
      ctx.expectExample(
        await s.delete(at(ctx, `projects/${LOG(ctx)}/workflow/draft`), { ifMatch: 2 }),
        'discardTaskWorkflowDraft/ok',
      );
    },
  },
  {
    title: 'черновика нет — 404',
    operationId: 'discardTaskWorkflowDraft',
    expect: 'error',
    example: 'discardTaskWorkflowDraft/not_found',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.delete(at(ctx, `projects/${LOG(ctx)}/workflow/draft`), { ifMatch: 1 }),
        'discardTaskWorkflowDraft/not_found',
      );
    },
  },
  {
    title: '«Опубликовать v2» — задачи остаются в своих статусах и переходят на v2',
    operationId: 'publishTaskWorkflow',
    expect: 'success',
    example: 'publishTaskWorkflow/ok',
    run: async (ctx) => {
      const { s } = await draftWithNewStatus(ctx);
      ctx.expectExample(
        await s.post(at(ctx, `projects/${LOG(ctx)}/workflow/draft/publish`), undefined, {
          ifMatch: 2,
        }),
        'publishTaskWorkflow/ok',
      );
      const t65 = task(await s.get(at(ctx, `tasks/${ctx.A('T-65')}`)));
      expect([
        t65.statusName,
        (t65 as unknown as { workflowVersion: number }).workflowVersion,
      ]).toEqual(['На проверке', 2]);
    },
  },
  {
    title: 'черновика нет — 422 «Изменений нет»; статус задач удалён — публикация отклонена',
    operationId: 'publishTaskWorkflow',
    expect: 'error',
    example: 'publishTaskWorkflow/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.post(at(ctx, `projects/${LOG(ctx)}/workflow/draft/publish`), undefined, {
          ifMatch: 1,
        }),
        'publishTaskWorkflow/validation_failed',
      );
      const wf = body(await s.get(at(ctx, `projects/${LOG(ctx)}/workflow`)));
      const statuses = (wf.statuses as { id: string }[]).filter((x) => x.id !== 's3');
      const transitions = (wf.transitions as { from: string[]; to: string }[]).filter(
        (x) => x.to !== 's3' && !x.from.includes('s3'),
      );
      await s.put(
        at(ctx, `projects/${LOG(ctx)}/workflow/draft`),
        { statuses, transitions },
        { ifMatch: 1 },
      );
      const r = await s.post(at(ctx, `projects/${LOG(ctx)}/workflow/draft/publish`), undefined, {
        ifMatch: 2,
      });
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).detail).toBe(
        'Есть задачи в статусах, которых нет в новой версии: На проверке. Переведите их или верните статус',
      );
    },
  },

  // ── Участники ──
  {
    title: '«Участники» LOG: назначен в проекте, через группу, владелец; роли проекта',
    operationId: 'listTaskProjectMembers',
    expect: 'success',
    example: 'listTaskProjectMembers/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `projects/${LOG(ctx)}/members`)),
        'listTaskProjectMembers/ok',
      );
    },
  },
  {
    title: 'нет проекта — 404',
    operationId: 'listTaskProjectMembers',
    expect: 'error',
    example: 'listTaskProjectMembers/not_found',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `projects/${MISSING}/members`)),
        'listTaskProjectMembers/not_found',
      );
    },
  },
  {
    // Возврат 1 (сверка доступа MSW с доменом): эталон заблокированных в «Участниках» не показывает и в «Людей» не
    // считает («Задачи и проекты.dc.html»:441 и :360 — m.status !== 'blocked').
    title: 'заблокированный Кирилл Громов — не в «Участниках» LOG и не в «Людей»',
    operationId: 'listTaskProjectMembers',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const items = body(await s.get(at(ctx, `projects/${LOG(ctx)}/members`))).items ?? [];
      expect(items.map((x) => x.memberId)).not.toContain(ctx.A('m-gromov'));
      const p = body(await s.get(at(ctx, `projects/${LOG(ctx)}`)));
      expect((p.counts as { members: number }).members).toBe(3);
    },
  },
  {
    title: 'прорабу — роль «Наблюдатель» в проекте («Роль назначена»)',
    operationId: 'setTaskProjectMemberRole',
    expect: 'success',
    example: 'setTaskProjectMemberRole/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.put(at(ctx, `projects/${LOG(ctx)}/members/${ctx.A('m-sokolov')}`), {
          roleId: ctx.A('r-viewer'),
        }),
        'setTaskProjectMemberRole/ok',
      );
      const foreman = await ctx.as('foreman');
      expect((await foreman.get(at(ctx, `projects/${LOG(ctx)}`))).status).toBe(200);
    },
  },
  {
    title: 'заблокированному — 422 «Кирилл Громов заблокирован — назначить роль нельзя»',
    operationId: 'setTaskProjectMemberRole',
    expect: 'error',
    example: 'setTaskProjectMemberRole/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.put(at(ctx, `projects/${LOG(ctx)}/members/${ctx.A('m-gromov')}`), {
          roleId: ctx.A('r-exec'),
        }),
        'setTaskProjectMemberRole/validation_failed',
      );
    },
  },
  {
    title: 'незнакомому сотруднику — 422 «Выберите сотрудника», как в прототипе',
    operationId: 'setTaskProjectMemberRole',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const r = await s.put(
        at(ctx, `projects/${LOG(ctx)}/members/00000000-0000-4000-8000-0000000000ff`),
        { roleId: ctx.A('r-viewer') },
      );
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).detail).toBe('Выберите сотрудника');
    },
  },
  {
    title: 'исключить из проекта назначенного в проекте — 204',
    operationId: 'removeTaskProjectMember',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const r = await s.delete(at(ctx, `projects/${LOG(ctx)}/members/${ctx.A('m-kotelnikova')}`));
      expect(r.status).toBe(204);
      const items = body(await s.get(at(ctx, `projects/${LOG(ctx)}/members`))).items ?? [];
      expect(items.some((x) => x.memberId === ctx.A('m-kotelnikova'))).toBe(false);
    },
  },
  {
    title: 'доступ через группу меняется только в «Пользователях и ролях» — 409',
    operationId: 'removeTaskProjectMember',
    expect: 'error',
    example: 'removeTaskProjectMember/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.delete(at(ctx, `projects/${LOG(ctx)}/members/${ctx.A('m-vasiliev')}`)),
        'removeTaskProjectMember/invalid_transition',
      );
    },
  },
  {
    title: '«Проверить доступ»: Илья Васильев не может согласовывать',
    operationId: 'checkTaskProjectAccess',
    expect: 'success',
    example: 'checkTaskProjectAccess/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(
          at(
            ctx,
            `projects/${LOG(ctx)}/members/${ctx.A('m-vasiliev')}/access?action=tasks.approve`,
          ),
        ),
        'checkTaskProjectAccess/ok',
      );
      const ok = body(
        await s.get(
          at(
            ctx,
            `projects/${LOG(ctx)}/members/${ctx.A('m-kotelnikova')}/access?action=tasks.approve`,
          ),
        ),
      );
      expect([ok.allowed, ok.roleName, ok.via]).toEqual([
        true,
        'Согласующий',
        'Назначен в проекте',
      ]);
    },
  },
  {
    title: 'водитель «Проверить доступ» не может — 403',
    operationId: 'checkTaskProjectAccess',
    expect: 'error',
    example: 'checkTaskProjectAccess/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectExample(
        await s.get(
          at(ctx, `projects/${LOG(ctx)}/members/${ctx.A('m-kotova')}/access?action=tasks.read`),
        ),
        'checkTaskProjectAccess/forbidden_action',
      );
    },
  },

  // ── Автоматизация ──
  {
    title: 'правила LOG: ar-1 включено, ar-2 выключено',
    operationId: 'listTaskAutomations',
    expect: 'success',
    example: 'listTaskAutomations/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `projects/${LOG(ctx)}/automations`)),
        'listTaskAutomations/ok',
      );
    },
  },
  {
    title: 'нет проекта — 404',
    operationId: 'listTaskAutomations',
    expect: 'error',
    example: 'listTaskAutomations/not_found',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `projects/${MISSING}/automations`)),
        'listTaskAutomations/not_found',
      );
    },
  },
  {
    title: 'новое правило «Срочная → высокий приоритет подзадачам» от имени руководителя проекта',
    operationId: 'createTaskAutomation',
    expect: 'success',
    example: 'createTaskAutomation/created',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.post(at(ctx, `projects/${LOG(ctx)}/automations`), {
          name: 'На проверке → напомнить про счёт',
          trigger: { kind: 'status_entered', statusId: 's3' },
          action: { kind: 'comment', text: 'Приложите счёт поставщика' },
        }),
        'createTaskAutomation/created',
      );
    },
  },
  {
    title: 'триггер «перешла в статус» без статуса — 422 «Выберите статус для триггера»',
    operationId: 'createTaskAutomation',
    expect: 'error',
    example: 'createTaskAutomation/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.post(at(ctx, `projects/${LOG(ctx)}/automations`), {
          name: 'Без статуса',
          trigger: { kind: 'status_entered' },
          action: { kind: 'comment', text: 'x' },
        }),
        'createTaskAutomation/validation_failed',
      );
    },
  },
  {
    title: 'включить ar-2 — версия и автор не меняются',
    operationId: 'updateTaskAutomation',
    expect: 'success',
    example: 'updateTaskAutomation/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.patch(
          at(ctx, `projects/${LOG(ctx)}/automations/${ctx.A('ar-2')}`),
          { enabled: true },
          { ifMatch: 1 },
        ),
        'updateTaskAutomation/ok',
      );
    },
  },
  {
    title: 'устаревшая ревизия правила — 412',
    operationId: 'updateTaskAutomation',
    expect: 'error',
    example: 'updateTaskAutomation/revision_mismatch',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.patch(
          at(ctx, `projects/${LOG(ctx)}/automations/${ctx.A('ar-2')}`),
          { enabled: true },
          { ifMatch: 5 },
        ),
        'updateTaskAutomation/revision_mismatch',
      );
    },
  },
  {
    title: 'удалить правило — 204, журнал хранит его запуски',
    operationId: 'deleteTaskAutomation',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const r = await s.delete(at(ctx, `projects/${LOG(ctx)}/automations/${ctx.A('ar-1')}`), {
        ifMatch: 1,
      });
      expect(r.status).toBe(204);
      const runs = body(await s.get(at(ctx, `projects/${LOG(ctx)}/automation-runs`))).items ?? [];
      expect(runs).toHaveLength(2);
    },
  },
  {
    title: 'нет правила — 404 «Правило не найдено»',
    operationId: 'deleteTaskAutomation',
    expect: 'error',
    example: 'deleteTaskAutomation/not_found',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.delete(at(ctx, `projects/${LOG(ctx)}/automations/${MISSING}`), { ifMatch: 1 }),
        'deleteTaskAutomation/not_found',
      );
    },
  },
  {
    title: 'журнал запусков: ar-1 назначила T-64, условие для T-63 не выполнено',
    operationId: 'listTaskAutomationRuns',
    expect: 'success',
    example: 'listTaskAutomationRuns/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `projects/${LOG(ctx)}/automation-runs`)),
        'listTaskAutomationRuns/ok',
      );
    },
  },
  {
    title: 'нет проекта — 404',
    operationId: 'listTaskAutomationRuns',
    expect: 'error',
    example: 'listTaskAutomationRuns/not_found',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `projects/${MISSING}/automation-runs`)),
        'listTaskAutomationRuns/not_found',
      );
    },
  },

  // ── Задачи ──
  {
    title: '«Состоит из» T-66: T-65 и T-58 (поля карточки доски)',
    operationId: 'listTasks',
    expect: 'success',
    example: 'listTasks/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `tasks?parentTaskId=${ctx.A('T-66')}`)),
        'listTasks/ok',
      );
    },
  },
  {
    // Возврат 1 (ревью): «Задача из проекта, к которому у вас нет доступа» — без id родителя (ни parent.taskId, ни
    // parentTaskId): UUID невидимой задачи не утекает.
    title: 'родитель в закрытом проекте — «Входит в» без id и номера родителя',
    operationId: 'getTask',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const p = body(
        await owner.post(at(ctx, 'projects'), {
          name: 'Ремонт · ЖК Речной',
          key: 'РЧН',
          orgUnitId: null,
          workflowKey: 'simple',
          access: 'closed',
        }),
      );
      const x = task(
        await owner.post(at(ctx, 'tasks'), { projectId: p.id as string, title: 'Смета ремонта' }),
      );
      const y = task(
        await owner.post(at(ctx, 'tasks'), {
          projectId: LOG(ctx),
          title: 'Закупить материалы',
          assigneeMemberId: ctx.A('m-vasiliev'),
          parentTaskId: x.id,
        }),
      );
      expect(y.parentTaskId).toBe(x.id);
      const driver = await ctx.as('driver');
      const r = await driver.get(at(ctx, `tasks/${y.id}`));
      expect(r.status).toBe(200);
      expect(body(r).parent).toEqual({ state: 'hidden' });
      expect(body(r).parentTaskId).toBeUndefined();
      expect(JSON.stringify(r.body)).not.toContain(x.id);
    },
  },
  {
    title: 'фильтры доски: «Мои», «Ждут моего согласия», проект',
    operationId: 'listTasks',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const keys = (r: Reply) => body(r).items?.map((x) => x.key);
      expect(keys(await owner.get(at(ctx, 'tasks?awaitingMyApproval=true')))).toEqual([
        'T-65',
        'T-63',
      ]);
      const driver = await ctx.as('driver');
      expect(keys(await driver.get(at(ctx, 'tasks?awaitingMyApproval=true')))).toEqual([]);
      expect(keys(await driver.get(at(ctx, 'tasks?assignee=me')))).toEqual(['T-65']);
      const board = keys(await owner.get(at(ctx, `tasks?projectId=${ctx.A('leads')}`)));
      expect(board).toEqual(['L-31', 'L-29', 'L-27', 'L-24', 'L-18']);
    },
  },
  {
    title: 'массажисту задачи закрыты — 403',
    operationId: 'listTasks',
    expect: 'error',
    example: 'listTasks/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('therapist');
      ctx.expectExample(await s.get(at(ctx, 'tasks')), 'listTasks/forbidden_action');
    },
  },
  {
    title: 'карточка T-65 владельцу: ждёт согласования, «Согласовать» и «Отменить» доступны',
    operationId: 'getTask',
    expect: 'success',
    example: 'getTask/awaiting_approval',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.get(at(ctx, `tasks/${ctx.A('T-65')}`)),
        'getTask/awaiting_approval',
      );
    },
  },
  {
    title: 'нет задачи — 404',
    operationId: 'getTask',
    expect: 'error',
    example: 'getTask/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(at(ctx, `tasks/${MISSING}`)), 'getTask/not_found');
    },
  },
  {
    title: '«Новая задача» в LOG: номер LOG-101, «Новая», правило ar-1 остановлено условием',
    operationId: 'createTask',
    expect: 'success',
    example: 'createTask/created',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.post(at(ctx, 'tasks'), {
          projectId: LOG(ctx),
          title: 'Проверить тормоза ГАЗели',
          priority: 'high',
          labels: [' Тормоза ', 'тормоза'],
        }),
        'createTask/created',
      );
      const runs = body(await s.get(at(ctx, `projects/${LOG(ctx)}/automation-runs`))).items ?? [];
      expect(runs[0]?.text).toBe('LOG-101: приоритет «Высокий» — условие не выполнено');
    },
  },
  {
    title: 'тема короче 3 символов — 422',
    operationId: 'createTask',
    expect: 'error',
    example: 'createTask/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.post(at(ctx, 'tasks'), { projectId: LOG(ctx), title: 'ок' }),
        'createTask/validation_failed',
      );
    },
  },
  {
    title: 'срочная задача — правило ar-1 назначает её руководителю проекта; подзадача T-66',
    operationId: 'createTask',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const t = task(
        await s.post(at(ctx, 'tasks'), {
          projectId: LOG(ctx),
          title: 'Купить антифриз',
          priority: 'urgent',
          assigneeMemberId: ctx.A('m-vasiliev'),
          parentTaskId: ctx.A('T-66'),
        }),
      );
      expect([t.assigneeMemberId, t.parentTaskId]).toEqual([ctx.A('m-kotova'), ctx.A('T-66')]);
    },
  },
  {
    title: 'приоритет T-58 — «Срочно»',
    operationId: 'updateTask',
    expect: 'success',
    example: 'updateTask/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.patch(at(ctx, `tasks/${ctx.A('T-58')}`), { priority: 'urgent' }, { ifMatch: 1 }),
        'updateTask/ok',
      );
    },
  },
  {
    title: 'устаревшая ревизия задачи — 412',
    operationId: 'updateTask',
    expect: 'error',
    example: 'updateTask/revision_mismatch',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.patch(at(ctx, `tasks/${ctx.A('T-58')}`), { priority: 'urgent' }, { ifMatch: 3 }),
        'updateTask/revision_mismatch',
      );
    },
  },
  {
    title: 'владелец согласует T-65 — «Готово», назначено на автора',
    operationId: 'transitionTask',
    expect: 'success',
    example: 'transitionTask/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.post(
          at(ctx, `tasks/${ctx.A('T-65')}/transitions`),
          { transitionKey: 't3', comment: 'Счёт проверен' },
          { ifMatch: 1 },
        ),
        'transitionTask/ok',
      );
    },
  },
  {
    // Возврат 1 (ревью, major): у «Согласующего» нет «Менять статус» (tasks.transition) — голос проходит шлюз по
    // tasks.approve (x-permissions-mode any), карточка и ответ команды не расходятся.
    title:
      'прораб с ролью «Согласующий» согласует T-65 — шлюз пускает по «Согласовывать», «Готово»',
    operationId: 'transitionTask',
    expect: 'success',
    run: async (ctx) => {
      const m = await ctx.as('manager');
      const role = await m.put(at(ctx, `projects/${LOG(ctx)}/members/${ctx.A('m-sokolov')}`), {
        roleId: ctx.A('r-approver'),
      });
      expect(role.status).toBe(200);
      const f = await ctx.as('foreman');
      const card = task(await f.get(at(ctx, `tasks/${ctx.A('T-65')}`)));
      expect(card.availableTransitions?.find((x) => x.key === 't3')?.allowed).toBe(true);
      const r = await f.post(
        at(ctx, `tasks/${card.id}/transitions`),
        { transitionKey: 't3', comment: 'Счёт проверен' },
        { ifMatch: card.revision },
      );
      expect(r.status).toBe(200);
      expect(task(r).statusName).toBe('Готово');
    },
  },
  {
    title: 'автор T-65 без права «Согласовывать» — 403 с причиной эталона',
    operationId: 'transitionTask',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      const r = await s.post(
        at(ctx, `tasks/${ctx.A('T-65')}/transitions`),
        { transitionKey: 't3' },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'forbidden_action');
      expect(body(r).detail).toBe(
        'Согласует роль с правом «Согласовывать»; у вас роль «Исполнитель» не даёт «Согласовывать»',
      );
    },
  },
  {
    // Возврат 1 (ревью): отказ шлюза берёт detail из примера операции — пример должен быть текстом шлюза, а не
    // причиной хендлера про чужую роль («у вас роль «Исполнитель»…» прорабу без роли в проекте).
    title: 'прораб без «Менять статус» и «Согласовывать» — 403 шлюза с текстом шлюза',
    operationId: 'transitionTask',
    expect: 'error',
    example: 'transitionTask/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('foreman');
      const r = await s.post(
        at(ctx, `tasks/${ctx.A('T-65')}/transitions`),
        { transitionKey: 't3' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'transitionTask/forbidden_action');
      expect(body(r).detail).not.toMatch(/Исполнитель/);
    },
  },
  {
    title: 'чек-лист T-65 открыт — 409 checklist_open (Q-W4.00-tasks-12)',
    operationId: 'transitionTask',
    expect: 'error',
    example: 'transitionTask/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const t = task(
        await s.patch(
          at(ctx, `tasks/${ctx.A('T-65')}/checklist/ch-1`),
          { done: false },
          { ifMatch: 1 },
        ),
      );
      ctx.expectExample(
        await s.post(
          at(ctx, `tasks/${t.id}/transitions`),
          { transitionKey: 't3' },
          { ifMatch: t.revision },
        ),
        'transitionTask/invalid_transition',
      );
    },
  },
  {
    title: 'автор со своим правом согласования — 409 author_forbidden; «нужны все» ждёт остальных',
    operationId: 'transitionTask',
    expect: 'error',
    run: async (ctx) => {
      const { s, t } = await ownTaskOnReview(ctx);
      const card = task(await s.get(at(ctx, `tasks/${t.id}`)));
      const t3 = card.availableTransitions?.find((x) => x.key === 't3');
      expect([t3?.allowed, t3?.reason, t3?.reasonText]).toEqual([
        false,
        'author_forbidden',
        'Вы автор задачи — свою согласовать нельзя',
      ]);
      const r = await s.post(
        at(ctx, `tasks/${t.id}/transitions`),
        { transitionKey: 't3' },
        { ifMatch: t.revision },
      );
      ctx.expectProblem(r, 'invalid_transition');
      expect(body(r).reason).toBe('author_forbidden');
    },
  },
  {
    title: '«Вернуть на доработку» T-65 — «В работе», раунд закрыт',
    operationId: 'rejectTaskApproval',
    expect: 'success',
    example: 'rejectTaskApproval/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.post(
          at(ctx, `tasks/${ctx.A('T-65')}/approvals/t3/reject`),
          { comment: 'Нужен счёт с НДС' },
          { ifMatch: 1 },
        ),
        'rejectTaskApproval/ok',
      );
    },
  },
  {
    title: 'без комментария — 422 «Напишите, что доработать»',
    operationId: 'rejectTaskApproval',
    expect: 'error',
    example: 'rejectTaskApproval/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.post(
          at(ctx, `tasks/${ctx.A('T-65')}/approvals/t3/reject`),
          { comment: '   ' },
          { ifMatch: 1 },
        ),
        'rejectTaskApproval/validation_failed',
      );
    },
  },
  {
    title: 'снять отметку «Счёт приложен» в чек-листе T-65',
    operationId: 'updateTaskChecklistItem',
    expect: 'success',
    example: 'updateTaskChecklistItem/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.patch(
          at(ctx, `tasks/${ctx.A('T-65')}/checklist/ch-1`),
          { done: false },
          { ifMatch: 1 },
        ),
        'updateTaskChecklistItem/ok',
      );
    },
  },
  {
    title: 'нет пункта — 404 «Пункт чек-листа не найден»',
    operationId: 'updateTaskChecklistItem',
    expect: 'error',
    example: 'updateTaskChecklistItem/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.patch(
          at(ctx, `tasks/${ctx.A('T-65')}/checklist/ch-9`),
          { done: true },
          { ifMatch: 1 },
        ),
        'updateTaskChecklistItem/not_found',
      );
    },
  },
  {
    title: '«Исключить из состава» T-58 — связь с T-66 снята',
    operationId: 'setTaskParent',
    expect: 'success',
    example: 'setTaskParent/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.put(
          at(ctx, `tasks/${ctx.A('T-58')}/parent`),
          { parentTaskId: null },
          { ifMatch: 1 },
        ),
        'setTaskParent/ok',
      );
    },
  },
  {
    title: 'T-66 в T-65 — 422 «Получится цикл»',
    operationId: 'setTaskParent',
    expect: 'error',
    example: 'setTaskParent/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.put(
          at(ctx, `tasks/${ctx.A('T-66')}/parent`),
          { parentTaskId: ctx.A('T-65') },
          { ifMatch: 1 },
        ),
        'setTaskParent/validation_failed',
      );
    },
  },
  {
    // Возврат 1 (ревью): текст — как описание setTaskParent (без {id}: родитель в API — UUID, Q-W4.03-9).
    title: 'родителя нет — 422 «Задача не найдена» (поле parentTaskId)',
    operationId: 'setTaskParent',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const r = await s.put(
        at(ctx, `tasks/${ctx.A('T-58')}/parent`),
        { parentTaskId: MISSING },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).detail).toBe('Задача не найдена');
      expect((body(r).violations as { field: string }[])[0]?.field).toBe('parentTaskId');
    },
  },
  {
    title: 'прикрепить «Акт ТО.pdf» к T-58 после загрузки task_attachment',
    operationId: 'attachTaskFiles',
    expect: 'success',
    example: 'attachTaskFiles/ok',
    run: async (ctx) => {
      const { s, fileId } = await upload(ctx, 'manager', ctx.A('T-58'));
      ctx.expectExample(
        await s.post(
          at(ctx, `tasks/${ctx.A('T-58')}/files`),
          { fileIds: [fileId] },
          { ifMatch: 1 },
        ),
        'attachTaskFiles/ok',
      );
    },
  },
  {
    title: 'файл не этой задачи — 422',
    operationId: 'attachTaskFiles',
    expect: 'error',
    example: 'attachTaskFiles/validation_failed',
    run: async (ctx) => {
      const { s, fileId } = await upload(ctx, 'manager', ctx.A('T-66'));
      ctx.expectExample(
        await s.post(
          at(ctx, `tasks/${ctx.A('T-58')}/files`),
          { fileIds: [fileId] },
          { ifMatch: 1 },
        ),
        'attachTaskFiles/validation_failed',
      );
    },
  },
  {
    // Возврат 1 (ревью): загрузку прикрепляет тот, кто её начал (иначе чужой файл становится «своим» и удаляется с
    // tasks.update); владелец загрузки — задача (entityType task); один файл — один раз (в БД — первичный ключ
    // task_files, без проверки был бы 500).
    title:
      'чужая загрузка, не задача-владелец, повтор файла — 422 «Файл не найден или загружен к другой задаче»',
    operationId: 'attachTaskFiles',
    expect: 'error',
    run: async (ctx) => {
      const T58 = ctx.A('T-58');
      const unknown = (r: Reply, i: number) => {
        ctx.expectProblem(r, 'validation_failed');
        expect(body(r).detail).toBe('Файл не найден или загружен к другой задаче');
        expect((body(r).violations as { field: string }[])[0]?.field).toBe(`fileIds[${i}]`);
      };
      const { fileId: theirs } = await upload(ctx, 'manager', T58);
      const owner = await ctx.as('owner');
      unknown(
        await owner.post(at(ctx, `tasks/${T58}/files`), { fileIds: [theirs] }, { ifMatch: 1 }),
        0,
      );
      const { s, fileId } = await upload(ctx, 'manager', T58, 'Счёт.pdf');
      // Тот же id дважды отклоняет схема (uniqueItems, поле fileIds), тот же id в другом регистре — сервер.
      const twice = await s.post(
        at(ctx, `tasks/${T58}/files`),
        { fileIds: [fileId, fileId] },
        { ifMatch: 1 },
      );
      ctx.expectProblem(twice, 'validation_failed');
      expect((body(twice).violations as { field: string }[])[0]?.field).toBe('fileIds');
      unknown(
        await s.post(
          at(ctx, `tasks/${T58}/files`),
          { fileIds: [fileId, fileId.toUpperCase()] },
          { ifMatch: 1 },
        ),
        1,
      );
      const ticket = body(
        await s.post(at(ctx, 'files/uploads'), {
          purpose: 'task_attachment',
          owner: { moduleKey: 'tasks', entityType: 'project', entityId: T58 },
          fileName: 'Смета.pdf',
          contentType: 'application/pdf',
          sizeBytes: 52000,
          sha256: SHA,
        }),
      ) as unknown as { uploadId: string; fileId: string };
      await s.post(at(ctx, `files/uploads/${ticket.uploadId}/complete`), { sha256: SHA });
      unknown(
        await s.post(at(ctx, `tasks/${T58}/files`), { fileIds: [ticket.fileId] }, { ifMatch: 1 }),
        0,
      );
      const t = task(await s.get(at(ctx, `tasks/${T58}`)));
      expect([t.revision, t.files?.length ?? 0]).toEqual([1, 0]);
    },
  },
  {
    title: 'владелец удаляет счёт T-65',
    operationId: 'removeTaskFile',
    expect: 'success',
    example: 'removeTaskFile/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.delete(at(ctx, `tasks/${ctx.A('T-65')}/files/${ctx.A('file:T-65:f-1')}`), {
          ifMatch: 1,
        }),
        'removeTaskFile/ok',
      );
    },
  },
  {
    title: 'исполнитель не удаляет чужой файл — 403 «Удалить можно свой файл…»',
    operationId: 'removeTaskFile',
    expect: 'error',
    example: 'removeTaskFile/forbidden_action',
    run: async (ctx) => {
      const { s, fileId } = await upload(ctx, 'manager', ctx.A('T-58'));
      const t = task(
        await s.post(
          at(ctx, `tasks/${ctx.A('T-58')}/files`),
          { fileIds: [fileId] },
          { ifMatch: 1 },
        ),
      );
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.delete(at(ctx, `tasks/${t.id}/files/${fileId}`), { ifMatch: t.revision }),
        'removeTaskFile/forbidden_action',
      );
    },
  },
  {
    title: 'комментарий в «Истории» T-65',
    operationId: 'commentTask',
    expect: 'success',
    example: 'commentTask/created',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.post(at(ctx, `tasks/${ctx.A('T-65')}/comments`), {
          text: 'Счёт проверила, сумма верна',
        }),
        'commentTask/created',
      );
    },
  },
  {
    title: 'пустой комментарий — 422 «Комментарий пустой»',
    operationId: 'commentTask',
    expect: 'error',
    example: 'commentTask/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.post(at(ctx, `tasks/${ctx.A('T-65')}/comments`), { text: '  ' }),
        'commentTask/validation_failed',
      );
    },
  },
  {
    title: '«История» T-65: комментарий автора',
    operationId: 'listTaskHistory',
    expect: 'success',
    example: 'listTaskHistory/ok',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `tasks/${ctx.A('T-65')}/history`)),
        'listTaskHistory/ok',
      );
    },
  },
  {
    title: 'нет задачи — 404',
    operationId: 'listTaskHistory',
    expect: 'error',
    example: 'listTaskHistory/not_found',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(at(ctx, `tasks/${MISSING}/history`)),
        'listTaskHistory/not_found',
      );
    },
  },
]);
