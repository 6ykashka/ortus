// Тег Repairs сценарного сервера, шаги 6.1–6.2 (W6.00, контракт 0.12.0-stage6): объекты (сводка списка, шапка, обзор 1a,
// прораб, активация, правка), работы с планом и принятым фактом, отметки прораба с приёмкой и возвратом (RS-09), допработы.
// Тексты ошибок — эталон (api.js:899–942, assignForeman, acceptWorkLog); разбор docs/plan/v2/analysis/dor/repair.md §1.2, §2.2.
import { page } from '../core/page.ts';
import { fail, type Violation } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { fmtQty } from './calc.ts';
import {
  addFeed,
  can,
  changeDto,
  currentEstimate,
  decisionsOf,
  delta,
  estimatesOf,
  isForeman,
  logDto,
  money,
  newRid,
  nextSeq,
  type ProjectRow,
  projectDto,
  projectOr404,
  qty,
  totalOf,
  unitRu,
  type View,
  viewOf,
  workerDto,
  worksOf,
} from './state.ts';

const invalid = (field: string, code: string, message: string, reason?: string): never =>
  fail('validation_failed', message, {
    violations: [{ field, code, message } satisfies Violation],
    ...(reason ? { reason } : {}),
  });

const memberName = (v: View, id: string | null): string | undefined =>
  id ? v.org.members.find((m) => m.id === id)?.displayName : undefined;

const workDto = (v: View, p: ProjectRow) =>
  worksOf(v, p).map(({ w, pending }) => ({
    id: w.id,
    projectId: w.projectId,
    name: w.name,
    unit: w.unit,
    plan: qty(w.plan),
    fact: qty(w.fact),
    pending: qty(pending),
    ...(w.estimateLineId ? { estimateLineId: w.estimateLineId } : {}),
  }));

function closedGuard(p: ProjectRow): void {
  if (p.status === 'handed_over') {
    fail('invalid_transition', 'Объект сдан: новые отметки не принимаются.', {
      reason: 'project_handed_over',
    });
  }
}

const FILTERS = new Set(['active', 'todo', 'draft', 'done']);

export const projectsHandlers: Registry = {
  listRepairProjects: (ctx) => {
    const v = viewOf(ctx);
    const filter = ctx.query.get('filter');
    if (filter !== null && !FILTERS.has(filter)) fail('malformed_request', 'Неизвестный фильтр.');
    const q = (ctx.query.get('q') ?? '').trim().toLowerCase();
    const items = v.rp.projects
      .filter((p) => v.office || (p.status !== 'draft' && p.foremanId === v.member?.id))
      .map((p) => ({ p, dto: projectDto(v, p) }))
      .filter(({ p, dto }) => {
        if (filter === 'active') return p.status === 'active';
        if (filter === 'draft') return p.status === 'draft';
        if (filter === 'done')
          return p.status === 'handed_over' || p.status === 'completed' || p.status === 'archived';
        if (filter === 'todo') return p.status === 'active' && dto.todoCount > 0;
        return true;
      })
      .filter(({ p }) => {
        if (!q) return true;
        const hay = [p.address, p.name, p.clientName ?? '', memberName(v, p.foremanId) ?? '']
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort(
        (a, b) =>
          Number(b.dto.todoCount > 0) - Number(a.dto.todoCount > 0) ||
          (a.p.dueOn ?? '9999').localeCompare(b.p.dueOn ?? '9999') ||
          a.p.name.localeCompare(b.p.name, 'ru'),
      )
      .map(({ dto }) => dto);
    return { body: page(items, ctx.query) };
  },

  createRepairProject: (ctx) => {
    const v = viewOf(ctx);
    const b = ctx.body as {
      orgUnitId: string;
      name: string;
      address: string;
      workers: { displayName: string; trade: string }[];
      kind?: string;
      areaM2?: string;
      rooms?: number;
      clientName?: string;
      clientPhone?: string;
      leadTaskId?: string;
      access?: { icon: string; text: string }[];
      templateId?: string;
      foremanMemberId?: string | null;
      budget?: { amountMinor: number };
    };
    if (!v.org.units.some((u) => u.id === b.orgUnitId)) {
      invalid('orgUnitId', 'unknown', 'Подразделения нет в организации.');
    }
    if (b.foremanMemberId && !v.org.members.some((m) => m.id === b.foremanMemberId)) {
      invalid('foremanMemberId', 'unknown', 'Сотрудника нет в организации.');
    }
    if (b.templateId && !v.rp.templates.some((t) => t.id === b.templateId)) {
      invalid('templateId', 'unknown', 'Шаблона нет в организации.');
    }
    if (b.leadTaskId && v.rp.projects.some((p) => p.leadTaskId === b.leadTaskId)) {
      fail('invalid_transition', 'По заявке уже есть объект.');
    }
    const draft = Boolean(b.leadTaskId) && !b.foremanMemberId;
    const id = newRid(v, 'project');
    const p: ProjectRow = {
      id,
      proto: id,
      orgUnitId: b.orgUnitId,
      name: b.name.trim(),
      address: b.address,
      status: draft ? 'draft' : 'active',
      ...(b.kind ? { kind: b.kind } : {}),
      stage: draft ? 'Замер' : 'Подготовка',
      ...(b.areaM2 ? { areaM2: Number(b.areaM2) } : {}),
      ...(b.rooms !== undefined ? { rooms: b.rooms } : {}),
      ...(b.clientName ? { clientName: b.clientName } : {}),
      ...(b.clientPhone ? { clientPhone: b.clientPhone } : {}),
      foremanId: b.foremanMemberId ?? null,
      access: b.access ?? [],
      ...(b.templateId ? { templateId: b.templateId } : {}),
      ...(b.leadTaskId ? { leadTaskId: b.leadTaskId } : {}),
      ...(b.budget ? { budgetMinor: b.budget.amountMinor } : {}),
      paidMinor: 0,
      spentMinor: 0,
      revision: 1,
      scheduleRevision: 1,
      createdAt: ctx.now(),
    };
    v.rp.projects.push(p);
    for (const w of b.workers) {
      v.rp.workers.push({
        id: newRid(v, 'worker'),
        projectId: id,
        displayName: w.displayName,
        trade: w.trade,
        status: 'active',
      });
    }
    v.rp.meas.push({ projectId: id, version: 1, rooms: [], at: ctx.now() });
    addFeed(v, id, draft ? 'создан объект-черновик' : 'создан объект');
    return { status: 201, body: projectDto(v, p) };
  },

  getRepairProject: (ctx) => {
    const v = viewOf(ctx);
    return { body: projectDto(v, projectOr404(v, ctx.params.projectId)) };
  },

  updateRepairProject: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    ctx.revision(p.revision);
    closedGuard(p);
    const b = ctx.body as Partial<{
      name: string;
      address: string;
      kind: string;
      areaM2: string;
      rooms: number;
      contractNo: string;
      dueOn: string;
      clientName: string;
      clientPhone: string;
      access: { icon: string; text: string }[];
    }>;
    if (b.name !== undefined) p.name = b.name.trim();
    if (b.address !== undefined) p.address = b.address;
    if (b.kind !== undefined) p.kind = b.kind;
    if (b.areaM2 !== undefined) p.areaM2 = Number(b.areaM2);
    if (b.rooms !== undefined) p.rooms = b.rooms;
    if (b.contractNo !== undefined) p.contractNo = b.contractNo;
    if (b.dueOn !== undefined) p.dueOn = b.dueOn;
    if (b.clientName !== undefined) p.clientName = b.clientName;
    if (b.clientPhone !== undefined) p.clientPhone = b.clientPhone;
    if (b.access !== undefined) p.access = b.access;
    p.revision++;
    return { body: projectDto(v, p) };
  },

  getRepairProjectOverview: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    const logs = v.rp.logs.filter((l) => l.projectId === p.id && l.status !== 'rejected');
    const photos = logs
      .flatMap((l) =>
        l.evidence.map((fileId) => ({
          fileId,
          workLogId: l.id,
          takenAt: l.createdAt,
          status: l.status === 'accepted' ? ('accepted' as const) : ('pending' as const),
        })),
      )
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    const sub = v.rp.subs.find((s) => s.projectId === p.id && s.active);
    const link = v.rp.links.find((l) => l.projectId === p.id && !l.revokedAt);
    const foremanName = memberName(v, p.foremanId);
    const est = currentEstimate(v, p);
    const contract = est ? totalOf(est).amountMinor : (p.budgetMinor ?? 0);
    const body: Record<string, unknown> = {
      project: projectDto(v, p),
      decisions: decisionsOf(v, p),
      works: workDto(v, p),
      photos,
      people: {
        clientName: p.clientName ?? null,
        clientLinkActive: Boolean(link),
        foreman:
          p.foremanId && foremanName ? { memberId: p.foremanId, displayName: foremanName } : null,
        crew: v.rp.workers.filter((w) => w.projectId === p.id).map(workerDto),
        ...(sub ? { subcontractor: { name: sub.name, accessUntil: sub.accessUntil ?? null } } : {}),
      },
      feed: v.rp.feed
        .filter((f) => f.projectId === p.id)
        .slice(0, 20)
        .map((f) => ({
          at: f.at,
          text: f.text,
          ...(f.actorName ? { actorName: f.actorName } : {}),
        })),
    };
    if (v.finance && p.status !== 'draft') {
      body.money = {
        contract: money(contract),
        received: money(p.paidMinor),
        expenses: money(p.spentMinor),
        marginPlan: delta(Math.round(contract * 0.27)),
      };
    }
    return { body };
  },

  assignRepairForeman: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    const b = ctx.body as { foremanMemberId: string };
    const m = v.org.members.find((x) => x.id === b.foremanMemberId);
    if (!m) invalid('foremanMemberId', 'unknown', 'Сотрудника нет в организации.');
    closedGuard(p);
    if (p.status === 'draft') {
      fail('invalid_transition', 'Объект-черновик: прораб назначается после договора.');
    }
    if (p.foremanId) {
      fail('invalid_transition', `Прораб уже назначен: ${memberName(v, p.foremanId) ?? '—'}.`, {
        reason: 'foreman_already_assigned',
      });
    }
    p.foremanId = b.foremanMemberId;
    p.revision++;
    addFeed(v, p.id, `назначила прораба: ${m?.displayName ?? ''}`);
    return { body: projectDto(v, p) };
  },

  activateRepairProject: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    ctx.revision(p.revision);
    if (p.status !== 'draft') {
      fail('invalid_transition', 'Активировать можно только объект-черновик.', {
        reason: 'repair_project_not_draft',
      });
    }
    const est = currentEstimate(v, p);
    if (!est) {
      fail('invalid_transition', 'Нет согласованной версии сметы: объект не активируется.', {
        reason: 'repair_estimate_not_approved',
      });
    }
    p.status = 'active';
    p.stage = 'Подготовка';
    p.budgetMinor = est ? totalOf(est).amountMinor : undefined;
    p.revision++;
    addFeed(v, p.id, 'объект переведён в работу');
    return { body: projectDto(v, p) };
  },

  listRepairWorks: (ctx) => {
    const v = viewOf(ctx);
    return { body: { items: workDto(v, projectOr404(v, ctx.params.projectId)) } };
  },

  // ── отметки ──
  listWorkLogs: (ctx) => {
    const v = viewOf(ctx);
    const projectId = ctx.query.get('projectId')?.toLowerCase();
    const status = ctx.query.get('status');
    if (status !== null && !['submitted', 'accepted', 'rejected'].includes(status)) {
      fail('malformed_request', 'Неизвестный статус отметки.');
    }
    const visible = new Set(
      v.rp.projects
        .filter((p) => v.office || (p.status !== 'draft' && p.foremanId === v.member?.id))
        .map((p) => p.id),
    );
    const items = v.rp.logs
      .filter((l) => visible.has(l.projectId))
      .filter((l) => !projectId || l.projectId === projectId)
      .filter((l) => !status || l.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number))
      .map((l) => logDto(v, l));
    return { body: page(items, ctx.query) };
  },

  submitWorkLog: (ctx) => {
    const v = viewOf(ctx);
    const b = ctx.body as {
      projectId: string;
      workDate: string;
      timeZone: string;
      lines: { workId?: string; quantity: string; unit: string; description?: string }[];
      evidenceFileIds: string[];
      note?: string;
      crewWorkerIds?: string[];
      materials?: { priceItemId: string; quantity: string }[];
    };
    const p = projectOr404(v, b.projectId);
    if (!isForeman(v, p)) fail('forbidden_action', 'Отметку по объекту отправляет его прораб.');
    closedGuard(p);
    const works = worksOf(v, p);
    const lines = b.lines.map((ln, i) => {
      const w = works.find((x) => x.w.id === ln.workId);
      if (!w) return invalid(`lines[${i}].workId`, 'unknown', 'Выберите работу этого объекта.');
      const n = Number(ln.quantity);
      if (!(n > 0))
        return invalid(`lines[${i}].quantity`, 'positive', 'Объём должен быть больше нуля.');
      const left = Math.max(0, w.w.plan - w.w.fact - w.pending);
      if (n > left * 1.1 + 1e-9 && n > w.w.plan * 0.1 - 1e-9 && n > left) {
        return invalid(
          `lines[${i}].quantity`,
          'over_plan',
          `Объём превышает план более чем на 10%: осталось ${fmtQty(left)} ${unitRu(w.w.unit)}.`,
          'work_volume_exceeds_plan',
        );
      }
      return {
        workId: w.w.id,
        quantity: n,
        unit: w.w.unit,
        ...(ln.description ? { description: ln.description } : {}),
      };
    });
    const crew = b.crewWorkerIds ?? [];
    if (
      !crew.length ||
      crew.some((id) => !v.rp.workers.some((w) => w.id === id && w.projectId === p.id))
    ) {
      invalid('crewWorkerIds', 'required', 'Отметьте работников.');
    }
    const materials = (b.materials ?? []).map((m, i) => {
      const item = v.rp.prices.find((x) => x.id === m.priceItemId && x.kind === 'material');
      if (!item)
        return invalid(`materials[${i}].priceItemId`, 'unknown', 'Материала нет в справочнике.');
      return { priceItemId: item.id, quantity: Number(m.quantity) };
    });
    const max = v.rp.logs.reduce((a, l) => Math.max(a, Number(l.number.slice(3)) || 0), 0);
    nextSeq(v);
    const log = {
      id: newRid(v, 'log'),
      number: `WL-${max + 1}`,
      projectId: p.id,
      submittedBy: v.member?.id ?? '',
      workDate: b.workDate,
      timeZone: b.timeZone,
      status: 'submitted' as const,
      ...(b.note ? { note: b.note } : {}),
      crew,
      materials,
      evidence: b.evidenceFileIds,
      lines,
      revision: 1,
      createdAt: ctx.now(),
    };
    v.rp.logs.push(log);
    addFeed(v, p.id, `отправил отметку ${log.number} на приёмку`);
    return { status: 201, body: logDto(v, log) };
  },

  acceptWorkLog: (ctx) => {
    const v = viewOf(ctx);
    const l = logOr404(v, ctx);
    ctx.revision(l.revision);
    if (l.status !== 'submitted') {
      fail('invalid_transition', 'Отметка уже обработана.', {
        reason: 'work_log_already_reviewed',
      });
    }
    for (const ln of l.lines) {
      const w = v.rp.works.find((x) => x.id === ln.workId);
      if (w) w.fact = Math.round((w.fact + ln.quantity) * 1000) / 1000;
    }
    for (const m of l.materials) {
      const s = v.rp.stock.find(
        (x) => x.projectId === l.projectId && x.priceItemId === m.priceItemId,
      );
      if (s) {
        const unit = s.quantity ? s.costMinor / s.quantity : 0;
        s.quantity = Math.max(0, s.quantity - m.quantity);
        s.costMinor = Math.round(unit * s.quantity);
      }
    }
    l.status = 'accepted';
    l.reviewedBy = v.member?.id ?? l.submittedBy;
    l.reviewedAt = ctx.now();
    l.revision++;
    addFeed(v, l.projectId, `приняла объём по отметке ${l.number}`);
    return { body: logDto(v, l) };
  },

  returnWorkLog: (ctx) => {
    const v = viewOf(ctx);
    const l = logOr404(v, ctx);
    ctx.revision(l.revision);
    if (l.status !== 'submitted') {
      fail('invalid_transition', 'Отметка уже обработана.', {
        reason: 'work_log_already_reviewed',
      });
    }
    const b = ctx.body as { reason: string };
    l.status = 'rejected';
    l.reviewedBy = v.member?.id ?? l.submittedBy;
    l.reviewedAt = ctx.now();
    l.returnReason = b.reason.trim();
    l.revision++;
    addFeed(v, l.projectId, `вернула отметку ${l.number} прорабу`);
    return { body: logDto(v, l) };
  },

  // ── допработы ──
  listChangeOrders: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    const items = v.rp.changes
      .filter((c) => c.projectId === p.id)
      .sort((a, b) => a.seq - b.seq)
      .map(changeDto);
    return { body: { items } };
  },

  proposeChangeOrder: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    if (!isForeman(v, p)) fail('forbidden_action', 'Допработу предлагает прораб объекта.');
    if (p.status === 'draft') {
      fail('invalid_transition', 'До договора допработ нет: правки вносятся новой версией сметы.', {
        reason: undefined,
      });
    }
    if (p.status === 'handed_over') {
      fail('invalid_transition', 'Объект сдан: допработы по нему не принимаются.', {
        reason: 'project_handed_over',
      });
    }
    const b = ctx.body as {
      title: string;
      quantity: string;
      unit: string;
      photoFileIds: string[];
      note?: string;
    };
    const title = b.title.trim();
    if (!title) invalid('title', 'required', 'Опишите, что нужно сделать.');
    if (!(Number(b.quantity) > 0)) invalid('quantity', 'positive', 'Укажите объём больше нуля.');
    const seq =
      v.rp.changes.filter((c) => c.projectId === p.id).reduce((a, c) => Math.max(a, c.seq), 0) + 1;
    const row = {
      id: newRid(v, 'change'),
      projectId: p.id,
      seq,
      title,
      quantity: Number(b.quantity),
      unit: b.unit as ProjectRowUnit,
      note: b.note ?? '',
      photos: b.photoFileIds,
      status: 'proposed' as const,
      createdBy: v.member?.id ?? '',
      revision: 1,
      createdAt: ctx.now(),
      suggest: [] as [string, number][],
    };
    v.rp.changes.push(row);
    addFeed(v, p.id, `предложил допработу ДР-${seq}: ${title}`);
    return { status: 201, body: changeDto(row) };
  },

  rejectChangeOrder: (ctx) => {
    const v = viewOf(ctx);
    const c = v.rp.changes.find((x) => x.id === (ctx.params.changeOrderId ?? '').toLowerCase());
    const p = c ? v.rp.projects.find((x) => x.id === c.projectId) : undefined;
    if (!c || !p || !v.office) fail('not_found', 'Допработа не найдена.');
    ctx.revision(c.revision);
    if (c.status === 'signed' || c.status === 'rejected') {
      fail(
        'change_order_closed',
        `Допработа ДР-${c.seq} уже ${c.status === 'signed' ? 'подписана' : 'отклонена'}.`,
      );
    }
    c.status = 'rejected';
    c.rejectReason = (ctx.body as { reason: NonNullable<typeof c.rejectReason> }).reason;
    c.revision++;
    addFeed(v, p.id, `отклонила допработу ДР-${c.seq}`);
    return { body: changeDto(c) };
  },
};

type ProjectRowUnit = import('./data.ts').Unit;

function logOr404(v: View, ctx: HandlerContext) {
  const l = v.rp.logs.find((x) => x.id === (ctx.params.workLogId ?? '').toLowerCase());
  const p = l ? v.rp.projects.find((x) => x.id === l.projectId) : undefined;
  if (!l || !p || !(v.office || isForeman(v, p))) return fail('not_found', 'Отметка не найдена.');
  if (!can(v, 'repairs.work_logs.review'))
    return fail('forbidden_action', 'Нужно право «Принимать объём».');
  return l;
}

export { estimatesOf };
