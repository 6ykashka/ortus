// Тег Repairs сценарного сервера, шаг 6.3 (W6.00, контракт 0.12.0-stage6): замер, версии сметы (черновик из шаблона,
// правка пакетом, отправка, отзыв, допсоглашение, сравнение по идентификатору строки), справочник расценок и шаблоны.
// Правила — design/docs/19-construction.md «Смета: кто правит, версии, допработы, шаблоны»; тексты — эталон
// «Ремонт и стройка.dc.html» (:1490–1542 справочник, :1330–1371 версии).
import { page } from '../core/page.ts';
import { fail, type Violation } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import { estimateTotals, measOf } from './calc.ts';
import type { Formula } from './data.ts';
import {
  addFeed,
  currentEstimate,
  delta,
  type DocRow,
  type EstLine,
  type EstimateRow,
  estimateDto,
  estimatesOf,
  linesFromTemplate,
  liveQty,
  measDto,
  measOfProject,
  needFinance,
  newRid,
  type PriceRow,
  type ProjectRow,
  priceDto,
  projectOr404,
  money,
  type TemplateRow,
  templateDto,
  type TplLine,
  totalOf,
  type View,
  viewOf,
} from './state.ts';

const invalid = (field: string, code: string, message: string, reason?: string): never =>
  fail('validation_failed', message, {
    violations: [{ field, code, message } satisfies Violation],
    ...(reason ? { reason } : {}),
  });

function guardOpen(p: ProjectRow): void {
  if (p.status === 'handed_over') {
    fail('invalid_transition', 'Объект сдан: правки закрыты.', { reason: 'project_handed_over' });
  }
}

function estimateOr404(v: View, p: ProjectRow, version: string | undefined): EstimateRow {
  const n = Number(version);
  const e = estimatesOf(v, p).find((x) => x.version === n);
  if (!e) return fail('not_found', 'Версия сметы не найдена.');
  return e;
}

const cloneLine = (l: EstLine): EstLine => ({ ...l, isNew: false });

/** Допсоглашение № k: следующий номер среди версий объекта. */
const nextAgreement = (v: View, p: ProjectRow): number =>
  estimatesOf(v, p).reduce((a, e) => Math.max(a, e.agreementNo ?? 0), 0) + 1;

function tplLinesIn(v: View, lines: TplLine[] | undefined, field: string): TplLine[] {
  return (lines ?? []).map((l, i) => {
    if (!v.rp.prices.some((p) => p.id === l.priceItemId)) {
      invalid(`${field}[${i}].priceItemId`, 'unknown', 'Позиции нет в справочнике.');
    }
    if ((l.quantity === undefined) === (l.formula === undefined)) {
      invalid(`${field}[${i}]`, 'volume', 'Укажите количество или формулу из замера.');
    }
    const out: TplLine = { priceItemId: l.priceItemId, section: l.section };
    if (l.quantity !== undefined) out.quantity = Number(l.quantity);
    if (l.formula !== undefined) {
      out.formula = l.formula as Formula;
      out.coef = l.coef !== undefined ? Number(l.coef) : 1;
    }
    return out;
  });
}

function duplicateName(v: View, name: string, except?: string): boolean {
  const n = name.trim().toLowerCase();
  return v.rp.prices.some(
    (p) => !p.archived && p.id !== except && p.name.trim().toLowerCase() === n,
  );
}

const SECTIONS = ['Демонтаж', 'Электрика', 'Стены', 'Полы', 'Сантехника', 'Материалы'];

export const estimatesHandlers: Registry = {
  getMeasurement: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    return { body: measDto(measOfProject(v, p).row) };
  },

  putMeasurement: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    guardOpen(p);
    const cur = measOfProject(v, p).row;
    ctx.revision(cur.version);
    const b = ctx.body as {
      rooms: {
        name: string;
        lengthM: string;
        widthM: string;
        heightM: string;
        openingsM2: string;
        wet?: boolean;
      }[];
    };
    const rooms = b.rooms.map((r) => ({
      id: newRid(v, 'room'),
      name: r.name.trim(),
      l: Number(r.lengthM),
      w: Number(r.widthM),
      h: Number(r.heightM),
      o: Number(r.openingsM2),
      wet: r.wet ?? /^санузел/i.test(r.name),
    }));
    const row = {
      projectId: p.id,
      version: cur.version + 1,
      rooms,
      by: v.member?.id,
      at: ctx.now(),
    };
    v.rp.meas.push(row);
    // Черновик пересчитывается по замеру («из замера»), отправленные и согласованные версии не меняются.
    const draft = estimatesOf(v, p).find((e) => e.state === 'draft');
    if (draft) {
      const m = measOf(rooms);
      for (const l of draft.lines) l.qty = liveQty(l, m);
      draft.revision++;
    }
    addFeed(v, p.id, `внёс замер: ${rooms.length} помещений`);
    return { body: measDto(row) };
  },

  listEstimates: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    return { body: { items: estimatesOf(v, p).map(estimateDto) } };
  },

  getEstimate: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    return { body: estimateDto(estimateOr404(v, p, ctx.params.version)) };
  },

  createEstimateFromTemplate: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    guardOpen(p);
    const tpl = v.rp.templates.find(
      (t) => t.id === (ctx.body as { templateId: string }).templateId,
    );
    if (!tpl) invalid('templateId', 'unknown', 'Шаблона нет в организации.');
    const all = estimatesOf(v, p);
    if (all.some((e) => e.state === 'draft' || e.state === 'sent')) {
      fail('estimate_draft_exists', 'У объекта уже есть черновик или отправленная версия сметы.');
    }
    if (all.length)
      fail('invalid_transition', 'Смета уже собрана: новая версия — через «Новую версию сметы».');
    const { m } = measOfProject(v, p);
    const { lines, sections } = linesFromTemplate(v, tpl as TemplateRow, m);
    const row: EstimateRow = {
      id: newRid(v, 'estimate'),
      projectId: p.id,
      version: 1,
      kind: 'first',
      state: 'draft',
      templateId: tpl?.id,
      sections,
      lines,
      discountPct: 0,
      changeOrderIds: [],
      revision: 1,
    };
    v.rp.estimates.push(row);
    p.templateId = tpl?.id;
    p.revision++;
    addFeed(v, p.id, `собрала черновик сметы по шаблону «${tpl?.name ?? ''}»`);
    return { status: 201, body: estimateDto(row) };
  },

  createEstimateRevision: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    guardOpen(p);
    const b = ctx.body as { kind: 'revision' | 'change'; changeOrderIds?: string[] };
    const all = estimatesOf(v, p);
    const open = all.find((e) => e.state === 'draft' || e.state === 'sent');
    if (open?.state === 'sent' && open.kind === 'change') {
      fail('agreement_pending', 'Допсоглашение у заказчика: дождитесь подписи или отзовите его.');
    }
    if (open)
      fail('estimate_draft_exists', 'У объекта уже есть черновик или отправленная версия сметы.');
    const cur = currentEstimate(v, p);
    if (!cur) {
      fail('invalid_transition', 'Нет согласованной версии сметы.', {
        reason: 'repair_estimate_not_approved',
      });
    }
    const expected = p.status === 'draft' ? 'revision' : 'change';
    if (b.kind !== expected) {
      invalid(
        'kind',
        'kind',
        expected === 'revision'
          ? 'До договора правка — новая версия сметы.'
          : 'После договора правка — только допсоглашение.',
      );
    }
    const orders = (b.changeOrderIds ?? []).map((id, i) => {
      const c = v.rp.changes.find((x) => x.id === id && x.projectId === p.id);
      if (!c) return invalid(`changeOrderIds[${i}]`, 'unknown', 'Допработы нет у объекта.');
      if (c.status === 'signed' || c.status === 'rejected') {
        return fail(
          'change_order_closed',
          `Допработа ДР-${c.seq} уже ${c.status === 'signed' ? 'подписана' : 'отклонена'}.`,
        );
      }
      return c;
    });
    const sections =
      cur?.sections.map((s) => ({ id: newRid(v, 'sec'), name: s.name, from: s.id })) ?? [];
    const lines: EstLine[] = (cur?.lines ?? []).map((l) => ({
      ...cloneLine(l),
      sectionId: sections.find((s) => s.from === l.sectionId)?.id ?? l.sectionId,
    }));
    for (const c of orders) {
      const name = `Допработы · ДР-${c.seq}`;
      const sec = { id: newRid(v, 'sec'), name, from: '' };
      sections.push(sec);
      for (const [item, n] of c.suggest) {
        const it = v.rp.prices.find((x) => x.id === item);
        if (!it) continue;
        lines.push({
          id: newRid(v, 'line'),
          sectionId: sec.id,
          priceItemId: it.id,
          name: it.name,
          unit: it.unit,
          kind: it.kind,
          price: it.priceMinor / 100,
          qty: n,
          manual: false,
          isNew: true,
        });
      }
      c.status = 'priced';
      c.revision++;
    }
    const row: EstimateRow = {
      id: newRid(v, 'estimate'),
      projectId: p.id,
      version: all.reduce((a, e) => Math.max(a, e.version), 0) + 1,
      kind: b.kind,
      state: 'draft',
      baseVersion: cur?.version,
      templateId: cur?.templateId,
      sections: sections.map(({ id, name }) => ({ id, name })),
      lines,
      discountPct: cur?.discountPct ?? 0,
      changeOrderIds: orders.map((c) => c.id),
      revision: 1,
    };
    v.rp.estimates.push(row);
    addFeed(
      v,
      p.id,
      `начала ${b.kind === 'change' ? 'допсоглашение' : 'новую версию сметы'}: версия ${row.version}`,
    );
    return { status: 201, body: estimateDto(row) };
  },

  updateEstimateDraft: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    const e = estimateOr404(v, p, ctx.params.version);
    ctx.revision(e.revision);
    if (e.state !== 'draft') {
      fail(
        'estimate_version_locked',
        'Версия отправлена или согласована: отозвите отправку или изменяйте через допсоглашение.',
      );
    }
    const b = ctx.body as {
      addSections?: string[];
      addLines?: { sectionId: string; priceItemId: string; quantity?: string }[];
      lines?: { id: string; quantity?: string; price?: { amountMinor: number } }[];
      removeLineIds?: string[];
      resetLineIds?: string[];
      discountPct?: number;
    };
    const { m } = measOfProject(v, p);
    for (const name of b.addSections ?? [])
      e.sections.push({ id: newRid(v, 'sec'), name: name.trim() });
    for (const [i, a] of (b.addLines ?? []).entries()) {
      if (!e.sections.some((s) => s.id === a.sectionId))
        invalid(`addLines[${i}].sectionId`, 'unknown', 'Раздела нет в смете.');
      const it = v.rp.prices.find((x) => x.id === a.priceItemId && !x.archived);
      if (!it) invalid(`addLines[${i}].priceItemId`, 'unknown', 'Позиции нет в справочнике.');
      const q = a.quantity !== undefined ? Number(a.quantity) : 1;
      e.lines.push({
        id: newRid(v, 'line'),
        sectionId: a.sectionId,
        priceItemId: it?.id,
        name: it?.name ?? '',
        unit: it?.unit ?? 'piece',
        kind: it?.kind ?? 'work',
        price: (it?.priceMinor ?? 0) / 100,
        qty: q,
        manual: false,
        isNew: true,
      });
    }
    for (const [i, u] of (b.lines ?? []).entries()) {
      const l = e.lines.find((x) => x.id === u.id);
      if (!l) invalid(`lines[${i}].id`, 'unknown', 'Строки нет в смете.');
      if (l && u.quantity !== undefined) {
        l.qty = Number(u.quantity);
        l.manual = true;
      }
      if (l && u.price) l.price = u.price.amountMinor / 100;
    }
    if (b.removeLineIds?.length) {
      const drop = new Set(b.removeLineIds);
      e.lines = e.lines.filter((l) => !drop.has(l.id));
    }
    for (const id of b.resetLineIds ?? []) {
      const l = e.lines.find((x) => x.id === id);
      if (l) {
        l.manual = false;
        l.qty = liveQty(l, m);
      }
    }
    if (b.discountPct !== undefined) e.discountPct = b.discountPct;
    e.revision++;
    return { body: estimateDto(e) };
  },

  sendEstimate: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    const e = estimateOr404(v, p, ctx.params.version);
    ctx.revision(e.revision);
    if (e.state !== 'draft') {
      fail('estimate_version_locked', 'Версия уже отправлена или согласована.');
    }
    const { m } = measOfProject(v, p);
    for (const l of e.lines) l.qty = liveQty(l, m);
    e.state = 'sent';
    e.sentAt = ctx.now();
    if (e.kind === 'change') {
      e.agreementNo = nextAgreement(v, p);
      for (const c of v.rp.changes.filter((x) => e.changeOrderIds.includes(x.id))) {
        c.status = 'sent';
        c.agreementNo = e.agreementNo;
        c.revision++;
      }
      const prev = currentEstimate(v, p);
      const diff = totalOf(e).amountMinor - (prev ? totalOf(prev).amountMinor : 0);
      const doc: DocRow = {
        id: newRid(v, 'doc'),
        projectId: p.id,
        kind: 'agreement',
        title: `Допсоглашение № ${e.agreementNo}${
          e.changeOrderIds.length
            ? ` · ${v.rp.changes
                .filter((c) => e.changeOrderIds.includes(c.id))
                .map((c) => `ДР-${c.seq}`)
                .join(', ')}`
            : ''
        }`,
        state: 'wait',
        estimateVersion: e.version,
        amountMinor: diff,
        sentAt: ctx.now(),
        attempts: 0,
        revision: 1,
      };
      v.rp.docs.push(doc);
    }
    e.revision++;
    addFeed(v, p.id, `отправила версию ${e.version} сметы заказчику`);
    return { body: estimateDto(e) };
  },

  recallEstimate: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    const e = estimateOr404(v, p, ctx.params.version);
    ctx.revision(e.revision);
    if (e.state !== 'sent') {
      fail(
        'estimate_version_locked',
        'Версия согласована или не отправлялась: отозвать отправку нельзя.',
      );
    }
    e.state = 'draft';
    delete e.sentAt;
    if (e.kind === 'change') {
      for (const c of v.rp.changes.filter((x) => e.changeOrderIds.includes(x.id))) {
        c.status = 'priced';
        delete c.agreementNo;
        c.revision++;
      }
      v.rp.docs = v.rp.docs.filter(
        (d) =>
          !(
            d.projectId === p.id &&
            d.kind === 'agreement' &&
            d.estimateVersion === e.version &&
            d.state !== 'signed'
          ),
      );
      delete e.agreementNo;
    }
    e.revision++;
    addFeed(v, p.id, `отозвала отправку версии ${e.version}`);
    return { body: estimateDto(e) };
  },

  deleteEstimateDraft: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    const e = estimateOr404(v, p, ctx.params.version);
    ctx.revision(e.revision);
    if (e.state !== 'draft') fail('estimate_version_locked', 'Удалить можно только черновик.');
    for (const c of v.rp.changes.filter((x) => e.changeOrderIds.includes(x.id))) {
      c.status = 'proposed';
      c.revision++;
    }
    v.rp.estimates = v.rp.estimates.filter((x) => x !== e);
    return { status: 204 };
  },

  diffEstimates: (ctx) => {
    const v = viewOf(ctx);
    needFinance(v);
    const p = projectOr404(v, ctx.params.projectId);
    const a = estimateOr404(v, p, ctx.params.version);
    const b = estimateOr404(v, p, ctx.query.get('to') ?? '');
    const sum = (l: EstLine | undefined) => (l ? Math.round(l.price * 100 * l.qty) : 0);
    const rows = [
      ...a.lines.map((la) => ({ la, lb: b.lines.find((x) => x.id === la.id) })),
      ...b.lines
        .filter((lb) => !a.lines.some((x) => x.id === lb.id))
        .map((lb) => ({ la: undefined, lb })),
    ].map(({ la, lb }) => {
      const change = !la
        ? 'added'
        : !lb
          ? 'removed'
          : la.qty !== lb.qty || la.price !== lb.price
            ? 'changed'
            : 'same';
      const src = lb ?? la;
      return {
        change,
        name: src?.name ?? '',
        lineId: src?.id,
        ...(la ? { quantityA: String(la.qty), priceA: money(la.price * 100) } : {}),
        ...(lb ? { quantityB: String(lb.qty), priceB: money(lb.price * 100) } : {}),
        delta: delta(sum(lb) - sum(la)),
      };
    });
    const ta = totalOf(a).amountMinor;
    const tb = totalOf(b).amountMinor;
    void estimateTotals;
    return {
      body: {
        projectId: p.id,
        from: a.version,
        to: b.version,
        rows,
        totalFrom: money(ta),
        totalTo: money(tb),
        delta: delta(tb - ta),
      },
    };
  },

  saveProjectAsTemplate: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    const cur = currentEstimate(v, p);
    if (!cur) {
      fail('invalid_transition', 'Нет действующей версии сметы.', {
        reason: 'repair_estimate_not_approved',
      });
    }
    const src = v.rp.templates.find((t) => t.id === p.templateId);
    const b = (ctx.body ?? {}) as { name?: string };
    const row: TemplateRow = {
      id: newRid(v, 'template'),
      proto: '',
      name: (b.name ?? p.name).trim(),
      kind: p.kind ?? src?.kind ?? 'ремонт',
      source: 'own',
      sourceProjectId: p.id,
      used: 0,
      updatedAt: ctx.now(),
      lines: (cur?.lines ?? [])
        .map((l) => ({
          priceItemId: l.priceItemId ?? '',
          section: cur?.sections.find((s) => s.id === l.sectionId)?.name ?? '',
          ...(l.formula ? { formula: l.formula, coef: l.coef ?? 1 } : { quantity: l.qty }),
        }))
        .filter((l) => l.priceItemId),
      stages: structuredClone(src?.stages ?? []),
      documents: [...(src?.documents ?? [])],
      checklist: [...(src?.checklist ?? [])],
      materials: structuredClone(src?.materials ?? []),
      warrantyMonths: src?.warrantyMonths ?? 24,
      revision: 1,
    };
    v.rp.templates.push(row);
    return { status: 201, body: templateDto(v, row) };
  },

  // ── справочник ──
  listPriceItems: (ctx) => {
    const v = viewOf(ctx);
    const kind = ctx.query.get('kind');
    if (kind !== null && kind !== 'work' && kind !== 'material')
      fail('malformed_request', 'Неизвестный вид позиции.');
    const q = (ctx.query.get('q') ?? '').trim().toLowerCase();
    const items = v.rp.prices
      .filter((p) => !p.archived)
      .filter((p) => !kind || p.kind === kind)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          (SECTIONS.indexOf(a.section) + 1 || 99) - (SECTIONS.indexOf(b.section) + 1 || 99) ||
          a.name.localeCompare(b.name, 'ru'),
      )
      .map((p) => priceDto(v, p));
    return { body: page(items, ctx.query) };
  },

  createPriceItem: (ctx) => {
    const v = viewOf(ctx);
    const b = ctx.body as {
      section: string;
      name: string;
      unit: PriceRow['unit'];
      kind: PriceRow['kind'];
      price: { amountMinor: number };
    };
    const name = b.name.trim();
    if (!name) invalid('name', 'required', 'Укажите название позиции.');
    if (!(b.price.amountMinor > 0)) invalid('price', 'positive', 'Укажите цену больше нуля.');
    if (duplicateName(v, name)) {
      invalid('name', 'duplicate', 'Такая позиция уже есть в справочнике.', 'price_item_duplicate');
    }
    const row: PriceRow = {
      id: newRid(v, 'price'),
      section: b.section.trim(),
      name,
      unit: b.unit,
      kind: b.kind,
      priceMinor: b.price.amountMinor,
      archived: false,
      revision: 1,
    };
    v.rp.prices.push(row);
    return { status: 201, body: priceDto(v, row) };
  },

  updatePriceItem: (ctx) => {
    const v = viewOf(ctx);
    const row = v.rp.prices.find((x) => x.id === (ctx.params.priceItemId ?? '').toLowerCase());
    if (!row) fail('not_found', 'Позиция справочника не найдена.');
    const it = row as PriceRow;
    ctx.revision(it.revision);
    const b = ctx.body as Partial<{
      section: string;
      name: string;
      unit: PriceRow['unit'];
      price: { amountMinor: number };
      archived: boolean;
    }>;
    if (b.name !== undefined) {
      const name = b.name.trim();
      if (!name) invalid('name', 'required', 'Укажите название позиции.');
      if (duplicateName(v, name, it.id))
        invalid(
          'name',
          'duplicate',
          'Такая позиция уже есть в справочнике.',
          'price_item_duplicate',
        );
      it.name = name;
    }
    if (b.price !== undefined) {
      if (!(b.price.amountMinor > 0)) invalid('price', 'positive', 'Укажите цену больше нуля.');
      it.priceMinor = b.price.amountMinor;
    }
    if (b.section !== undefined) it.section = b.section.trim();
    if (b.unit !== undefined) it.unit = b.unit;
    if (b.archived !== undefined) it.archived = b.archived;
    it.revision++;
    return { body: priceDto(v, it) };
  },

  // ── шаблоны ──
  listTemplates: (ctx) => {
    const v = viewOf(ctx);
    return { body: { items: v.rp.templates.map((t) => templateDto(v, t)) } };
  },

  getTemplate: (ctx) => {
    const v = viewOf(ctx);
    return { body: templateDto(v, templateOr404(v, ctx.params.templateId)) };
  },

  updateTemplate: (ctx) => {
    const v = viewOf(ctx);
    const t = templateOr404(v, ctx.params.templateId);
    ctx.revision(t.revision);
    const b = ctx.body as Partial<{
      name: string;
      lines: TplLine[];
      stages: { name: string; ratePerDay?: string; pauseDays?: number; sections?: string[] }[];
      documents: TemplateRow['documents'];
      checklist: string[];
      materials: TplLine[];
      warrantyMonths: number;
    }>;
    if (b.name !== undefined) t.name = b.name.trim();
    if (b.lines !== undefined) t.lines = tplLinesIn(v, b.lines, 'lines');
    if (b.materials !== undefined) t.materials = tplLinesIn(v, b.materials, 'materials');
    if (b.stages !== undefined) {
      t.stages = b.stages.map((s) => ({
        name: s.name,
        ratePerDay: s.ratePerDay ? Number(s.ratePerDay) : null,
        pauseDays: s.pauseDays ?? 0,
        note: '',
      }));
    }
    if (b.documents !== undefined) t.documents = b.documents;
    if (b.checklist !== undefined) t.checklist = b.checklist;
    if (b.warrantyMonths !== undefined) t.warrantyMonths = b.warrantyMonths;
    t.updatedAt = ctx.now();
    t.revision++;
    return { body: templateDto(v, t) };
  },

  copyTemplate: (ctx) => {
    const v = viewOf(ctx);
    const t = templateOr404(v, ctx.params.templateId);
    const b = (ctx.body ?? {}) as { name?: string };
    const row: TemplateRow = {
      ...structuredClone(t),
      id: newRid(v, 'template'),
      proto: '',
      name: (b.name ?? `${t.name} (копия)`).trim(),
      source: 'own',
      copiedFrom: t.id,
      used: 0,
      updatedAt: ctx.now(),
      revision: 1,
    };
    delete row.sourceProjectId;
    v.rp.templates.push(row);
    return { status: 201, body: templateDto(v, row) };
  },
};

function templateOr404(v: View, id: string | undefined): TemplateRow {
  const t = v.rp.templates.find((x) => x.id === (id ?? '').toLowerCase());
  if (!t) return fail('not_found', 'Шаблон не найден.');
  return t;
}
