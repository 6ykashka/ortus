// Тег Repairs сценарного сервера, шаг 6.6 (W6.00, контракт 0.12.0-stage6): документы объекта и подпись по коду SMS
// (порт доставки кода — заглушка, код фиксирован: «0000»+номер, D-31 плана — кандидат), сдача объекта и гарантия,
// финансы, начисления бригаде и выплата предложением в кассу, подрядчики, ссылка и публичный кабинет заказчика
// (`/public/client/{clientToken}`: просмотр, согласование сметы, подпись документа). Правила — design/docs/19-construction.md
// «Правила», решения Q-W4.00-repair-10 … -13, -21.
import { fail, type Violation } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import {
  A,
  addFeed,
  type DocRow,
  currentEstimate,
  delta,
  docDto,
  type LinkRow,
  money,
  needFinance,
  newRid,
  type ProjectRow,
  projectDto,
  projectOr404,
  repairsOf,
  type RepairsData,
  totalOf,
  type View,
  viewOf,
  estimatesOf,
} from './state.ts';

const invalid = (field: string, code: string, message: string, reason?: string): never =>
  fail('validation_failed', message, {
    violations: [{ field, code, message } satisfies Violation],
    ...(reason ? { reason } : {}),
  });

/** Код подписи заглушки порта доставки (на стенде настоящий код пишется во входящие разработчика). */
export const SIGN_CODE = '482910';
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

const docOr404 = (v: View, id: string | undefined): DocRow => {
  const d = v.rp.docs.find((x) => x.id === (id ?? '').toLowerCase());
  const p = d ? v.rp.projects.find((x) => x.id === d.projectId) : undefined;
  if (!d || !p || !v.office) return fail('not_found', 'Документ не найден.');
  return d;
};

const addMonths = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

const maskPhone = (p: ProjectRow): string => p.clientPhone ?? '+7 *** *** 00-00';

const linkOf = (v: View, p: ProjectRow): LinkRow | undefined =>
  [...v.rp.links].reverse().find((l) => l.projectId === p.id);

const linkDto = (l: LinkRow | undefined) => {
  if (!l) return { active: false };
  const dto: Record<string, unknown> = {
    active: !l.revokedAt && (!l.expiresAt || l.expiresAt > l.issuedAt),
  };
  dto.sentAt = l.issuedAt;
  if (l.expiresAt) dto.expiresAt = l.expiresAt;
  if (l.revokedAt) dto.revokedAt = l.revokedAt;
  if (l.sentTo) dto.sentTo = l.sentTo;
  return dto;
};

/** Применение подписанного допсоглашения: версия начинает действовать, допработы — подписаны, работы — прорабу. */
function approveEstimate(v: View, p: ProjectRow, version: number, now: string): void {
  const est = estimatesOf(v, p).find((e) => e.version === version);
  if (!est) return;
  for (const e of estimatesOf(v, p)) if (e.state === 'approved') e.state = 'replaced';
  est.state = 'approved';
  est.approvedAt = now;
  est.revision++;
  p.budgetMinor = totalOf(est).amountMinor;
  p.revision++;
  for (const c of v.rp.changes.filter((x) => est.changeOrderIds.includes(x.id))) {
    c.status = 'signed';
    c.estimateVersion = version;
    c.revision++;
    v.rp.works.push({
      id: newRid(v, 'work'),
      projectId: p.id,
      name: c.title,
      unit: c.unit,
      plan: c.quantity,
      fact: 0,
    });
  }
}

/** Публичный контур: организация и ссылка по токену (тенант находится по дайджесту токена — здесь по самому токену). */
function byToken(ctx: HandlerContext): { v: View; rp: RepairsData; p: ProjectRow; link: LinkRow } {
  const token = ctx.params.clientToken ?? '';
  for (const org of Object.values(ctx.s.orgs)) {
    if (org.proto !== 't-alta') continue;
    const rp = repairsOf(org, ctx.now());
    const link = rp.links.find((l) => l.token === token);
    if (!link) continue;
    const p = rp.projects.find((x) => x.id === link.projectId);
    if (!p) continue;
    if (
      link.revokedAt ||
      (link.expiresAt && link.expiresAt <= ctx.now()) ||
      p.status === 'handed_over'
    ) {
      fail('public_token_expired', 'Ссылка недействительна: обратитесь в компанию за новой.');
    }
    const v = {
      t: undefined as never,
      org,
      rp,
      keys: new Set<string>(),
      owner: false,
      member: undefined,
      finance: true,
      office: false,
      now: ctx.now(),
      s: ctx.s,
    } satisfies View;
    return { v, rp, p, link };
  }
  return fail('not_found', 'Ссылка не найдена.');
}

export const cabinetHandlers: Registry = {
  // ── документы и сдача ──
  listRepairDocuments: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    return {
      body: { items: v.rp.docs.filter((d) => d.projectId === p.id).map((d) => docDto(v, d)) },
    };
  },

  requestDocumentSignature: (ctx) => {
    const v = viewOf(ctx);
    const d = docOr404(v, ctx.params.documentId);
    if (d.state !== 'draft' && d.state !== 'wait') {
      fail('invalid_transition', 'Документ не в том состоянии для запроса подписи.', {
        reason: 'repair_document_state',
      });
    }
    const p = v.rp.projects.find((x) => x.id === d.projectId) as ProjectRow;
    d.state = 'sms';
    d.signCode = SIGN_CODE;
    d.codeExpiresAt = new Date(Date.parse(ctx.now()) + CODE_TTL_MS)
      .toISOString()
      .replace('.000Z', 'Z');
    d.attempts = 0;
    d.sentAt = ctx.now();
    d.revision++;
    addFeed(v, p.id, `отправила на подпись: ${d.title}`);
    return {
      status: 201,
      body: { document: docDto(v, d), codeExpiresAt: d.codeExpiresAt, deliveredTo: maskPhone(p) },
    };
  },

  handOverRepairProject: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    ctx.revision(p.revision);
    if (p.status === 'handed_over')
      fail('invalid_transition', 'Объект уже сдан.', { reason: 'project_handed_over' });
    if (p.status !== 'active') fail('invalid_transition', 'Сдать можно только объект в работе.');
    const b = ctx.body as { actDocumentId: string; warrantyMonths?: number };
    const act = v.rp.docs.find((d) => d.id === b.actDocumentId && d.projectId === p.id);
    if (!act) invalid('actDocumentId', 'unknown', 'Документа нет у объекта.');
    if (act?.kind !== 'handover_act' || (act.state !== 'signed' && act.state !== 'paid')) {
      fail('invalid_transition', 'Акт сдачи объекта ещё не подписан заказчиком.', {
        reason: 'repair_act_not_signed',
      });
    }
    const tpl = v.rp.templates.find((t) => t.id === p.templateId);
    const months = b.warrantyMonths ?? tpl?.warrantyMonths ?? 24;
    const today = ctx.now().slice(0, 10);
    p.status = 'handed_over';
    p.stage = 'Сдан';
    p.handedOverOn = today;
    p.warrantyUntil = addMonths(today, months);
    p.revision++;
    for (const l of v.rp.links.filter((x) => x.projectId === p.id && !x.revokedAt))
      l.revokedAt = ctx.now();
    addFeed(v, p.id, 'объект сдан заказчику');
    return { body: projectDto(v, p) };
  },

  // ── финансы, бригада, подрядчики ──
  getProjectFinance: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    const est = currentEstimate(v, p);
    const contract = est ? totalOf(est).amountMinor : (p.budgetMinor ?? 0);
    const movements = [
      ...v.rp.docs
        .filter((d) => d.projectId === p.id && d.kind === 'invoice' && d.state === 'paid')
        .map((d) => ({
          at: d.signedAt ?? d.sentAt ?? p.createdAt,
          kind: 'payment' as const,
          text: d.title,
          amount: delta(d.amountMinor ?? 0),
        })),
      ...v.rp.supply
        .filter(
          (r) =>
            r.projectId === p.id && ['issued', 'bought', 'used'].includes(r.state) && r.costMinor,
        )
        .map((r) => ({
          at: r.createdAt,
          kind: 'expense' as const,
          text: `Материалы по заявке ${r.number}`,
          amount: delta(-(r.costMinor ?? 0)),
        })),
      ...v.rp.accruals
        .filter(
          (a) =>
            a.projectId === p.id &&
            (a.state === 'accrued' || a.state === 'paid' || a.state === 'proposed'),
        )
        .map((a) => ({
          at: p.createdAt,
          kind: 'accrual' as const,
          text: `Оплата бригады: ${a.workerName}`,
          amount: delta(-a.amountMinor),
        })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const dto: Record<string, unknown> = {
      projectId: p.id,
      contract: money(contract),
      received: money(p.paidMinor),
      expenses: money(p.spentMinor),
      marginPlan: delta(Math.round(contract * 0.27)),
      movements,
    };
    if (est) dto.estimateVersion = est.version;
    return { body: dto };
  },

  listCrewAccruals: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    return { body: { items: v.rp.accruals.filter((a) => a.projectId === p.id).map(accrualDto) } };
  },

  accrueByAct: (ctx) => {
    const v = viewOf(ctx);
    const act = docOr404(v, ctx.params.documentId);
    if (act.kind !== 'act') fail('not_found', 'Акт не найден.');
    if (act.state !== 'signed' && act.state !== 'paid') {
      fail(
        'invalid_transition',
        `Начисление откроется после подписания акта № ${act.actNo ?? ''} заказчиком.`
          .replace('№ ', '№ ')
          .trim(),
        {
          reason: 'repair_act_not_signed',
        },
      );
    }
    const title = act.title.toLowerCase();
    const out = v.rp.accruals.filter(
      (a) =>
        a.projectId === act.projectId &&
        (a.actId === act.id || (a.state === 'pending_act' && title.includes(a.work.toLowerCase()))),
    );
    for (const a of out) {
      if (a.state === 'pending_act') {
        a.state = 'accrued';
        a.actId = act.id;
      }
    }
    return { status: 201, body: { items: out.map(accrualDto) } };
  },

  payoutAccruals: (ctx) => {
    const v = viewOf(ctx);
    const ids = (ctx.body as { accrualIds: string[] }).accrualIds;
    const rows = ids.map((id, i) => {
      const a = v.rp.accruals.find((x) => x.id === id);
      if (!a) return invalid(`accrualIds[${i}]`, 'unknown', 'Начисления нет в организации.');
      if (a.state !== 'accrued') {
        return fail('invalid_transition', 'К выплате принимаются только начисленные суммы.');
      }
      return a;
    });
    const proposalId = newRid(v, 'cash-proposal');
    for (const a of rows) a.state = 'proposed';
    return { body: { proposalId, accruals: rows.map(accrualDto) } };
  },

  listSubcontractors: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    return { body: { items: v.rp.subs.filter((s) => s.projectId === p.id).map(subDto) } };
  },

  setSubcontractorAccess: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    const s = v.rp.subs.find(
      (x) => x.id === (ctx.params.subcontractorId ?? '').toLowerCase() && x.projectId === p.id,
    );
    if (!s) fail('not_found', 'Подрядчик не найден.');
    const sub = s as NonNullable<typeof s>;
    const b = ctx.body as { active: boolean; until?: string };
    if (b.active) {
      if (!b.until) invalid('until', 'required', 'Укажите срок доступа.');
      if ((b.until ?? '') < ctx.now().slice(0, 10))
        invalid('until', 'past', 'Срок доступа не может быть в прошлом.');
      sub.active = true;
      sub.accessUntil = b.until;
    } else {
      sub.active = false;
    }
    return { body: subDto(sub) };
  },

  // ── ссылка кабинета ──
  getClientLink: (ctx) => {
    const v = viewOf(ctx);
    return { body: linkDto(linkOf(v, projectOr404(v, ctx.params.projectId))) };
  },

  issueClientLink: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    if (p.status === 'handed_over')
      fail('invalid_transition', 'Объект сдан: кабинет закрыт.', { reason: 'project_handed_over' });
    for (const l of v.rp.links.filter((x) => x.projectId === p.id && !x.revokedAt))
      l.revokedAt = ctx.now();
    const id = newRid(v, 'link');
    const row: LinkRow = {
      id,
      projectId: p.id,
      token: `cab-${id}`,
      sentTo: maskPhone(p),
      issuedAt: ctx.now(),
    };
    v.rp.links.push(row);
    addFeed(v, p.id, 'выпустила ссылку кабинета заказчика');
    return {
      status: 201,
      body: { link: linkDto(row), url: `https://crm.ortus.example/c/${row.token}` },
    };
  },

  revokeClientLink: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    const l = v.rp.links.find((x) => x.projectId === p.id && !x.revokedAt);
    if (!l) fail('not_found', 'Действующей ссылки нет.');
    (l as LinkRow).revokedAt = ctx.now();
    addFeed(v, p.id, 'отозвала ссылку кабинета заказчика');
    return { status: 204 };
  },

  // ── публичный кабинет заказчика ──
  getClientCabinet: (ctx) => {
    const { v, rp, p } = byToken(ctx);
    const sch = rp.schedules.find((s) => s.projectId === p.id);
    const est = [...estimatesOf(v, p)]
      .reverse()
      .find((e) => e.state === 'sent' || e.state === 'approved');
    const accepted = rp.logs
      .filter((l) => l.projectId === p.id && l.status === 'accepted')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const done = rp.docs.filter(
      (d) =>
        d.projectId === p.id && d.kind === 'act' && (d.state === 'signed' || d.state === 'paid'),
    ).length;
    const acts = rp.docs.filter((d) => d.projectId === p.id && d.kind === 'act').length;
    const dto: Record<string, unknown> = {
      projectName: p.name,
      address: p.address,
      clientName: p.clientName ?? '',
      readinessPct: acts ? Math.round((done / acts) * 100) : 0,
      stages: (sch?.stages ?? [])
        .filter((s) => !s.milestone)
        .map((s) => ({
          name: s.name,
          state: s.status === 'done' ? 'done' : s.status === 'started' ? 'started' : 'planned',
        })),
      photos: accepted
        .flatMap((l) => l.evidence.map((fileId) => ({ fileId, date: l.workDate })))
        .slice(0, 12),
      documents: rp.docs
        .filter((d) => d.projectId === p.id && d.state !== 'draft')
        .map((d) => docDto({ ...v, finance: true }, d)),
      paid: money(p.paidMinor),
      contract: money(est ? totalOf(est).amountMinor : (p.budgetMinor ?? 0)),
    };
    if (est) dto.estimate = { version: est.version, state: est.state, total: totalOf(est) };
    return { body: dto };
  },

  approveEstimateByClient: (ctx) => {
    const { v, p } = byToken(ctx);
    const n = Number(ctx.params.version);
    const est = estimatesOf(v, p).find((e) => e.version === n);
    if (!est) fail('not_found', 'Версия сметы не найдена.');
    const e = est as NonNullable<typeof est>;
    if (e.state !== 'sent' || e.kind === 'change') {
      fail(
        'invalid_transition',
        'Версию нельзя согласовать: она не отправлена заказчику или это допсоглашение (его подписывают кодом из SMS).',
      );
    }
    approveEstimate(v, p, e.version, ctx.now());
    return { body: { version: e.version, state: e.state } };
  },

  signDocumentByClient: (ctx) => {
    const { v, p } = byToken(ctx);
    const d = v.rp.docs.find(
      (x) => x.id === (ctx.params.documentId ?? '').toLowerCase() && x.projectId === p.id,
    );
    if (!d) fail('not_found', 'Документ не найден.');
    const doc = d as DocRow;
    if (doc.state !== 'sms') {
      fail('invalid_transition', 'Документ не ждёт подписи по коду.', {
        reason: 'repair_document_state',
      });
    }
    if (doc.codeExpiresAt && doc.codeExpiresAt <= ctx.now()) {
      invalid('smsCode', 'expired', 'Срок кода истёк — запросите новый.', 'sms_code_expired');
    }
    if ((ctx.body as { smsCode: string }).smsCode !== doc.signCode) {
      doc.attempts++;
      if (doc.attempts >= MAX_ATTEMPTS)
        invalid(
          'smsCode',
          'expired',
          'Слишком много попыток — запросите новый код.',
          'sms_code_expired',
        );
      invalid('smsCode', 'invalid', 'Код не совпал.', 'sms_code_invalid');
    }
    doc.state = 'signed';
    doc.signedAt = ctx.now();
    delete doc.signCode;
    delete doc.codeExpiresAt;
    doc.revision++;
    if (doc.kind === 'agreement' && doc.estimateVersion)
      approveEstimate(v, p, doc.estimateVersion, ctx.now());
    addFeed(v, p.id, `подписал: ${doc.title}`, 'Заказчик');
    return { body: docDto(v, doc) };
  },
};

const accrualDto = (a: RepairsData['accruals'][number]) => ({
  id: a.id,
  projectId: a.projectId,
  workerId: a.workerId,
  workerName: a.workerName,
  role: a.role,
  amount: money(a.amountMinor),
  state: a.state,
  selfEmployed: a.selfEmployed,
  ...(a.actId ? { actId: a.actId } : {}),
  work: a.work,
});

const subDto = (s: RepairsData['subs'][number]) => ({
  id: s.id,
  name: s.name,
  scope: s.scope,
  active: s.active,
  ...(s.accessUntil ? { accessUntil: s.accessUntil } : {}),
  ...(s.contractMinor !== undefined ? { contract: money(s.contractMinor) } : {}),
  ...(s.paidMinor !== undefined ? { paid: money(s.paidMinor) } : {}),
});

void A;
