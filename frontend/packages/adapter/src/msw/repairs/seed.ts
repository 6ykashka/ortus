// Сид «Ремонта и стройки» «Альты» (W6.00): проекция данных эталона (data.ts) в строки схемы repairs. «Сегодня» сценария
// ремонта — 20.10.2026 (Q-W4.00-repair-15; пресет repairs-ready выставляет часы сервера); даты сида — до этого дня.
import { seedUuid } from '@ortus/domain/seed';

import type { Org } from '../core/state.ts';
import {
  ACCRUALS0,
  CAT0,
  CO1_SUGGEST,
  CREW0,
  e42Versions,
  GLK0,
  GREASONS_OF,
  GST0,
  LOGS0,
  OBJECTS0,
  ONOBJ0,
  ROOMS0,
  STOCK0,
  SUPPLY0,
  TPL0,
  WORKS0,
} from './data.ts';
import { buildLines, estimateTotals, measOf } from './calc.ts';
import {
  A,
  type ChangeRow,
  type DocRow,
  type EstimateRow,
  type MeasRow,
  type ProjectRow,
  type RepairsData,
  type ScheduleRow,
  registerSeed,
  type TemplateRow,
  type TplLine,
} from './state.ts';

const at = (day: string, time = '08:00:00'): string => `${day}T${time}Z`;
const UNIT = 'f-msk-sever';

const tplLine = (l: {
  item: string;
  section: string;
  formula: TplLine['formula'] | null;
  coef: number;
  quantity: number;
}): TplLine => ({
  priceItemId: A(l.item),
  section: l.section,
  ...(l.formula ? { formula: l.formula, coef: l.coef } : { quantity: l.quantity }),
});

export function seedRepairs(_org: Org, now: string): RepairsData {
  const rp: RepairsData = {
    projects: [],
    workers: [],
    works: [],
    logs: [],
    changes: [],
    meas: [],
    prices: CAT0.map((c) => ({
      id: A(c.id),
      section: c.cat,
      name: c.name,
      unit: c.unit,
      kind: c.kind,
      priceMinor: c.price * 100,
      archived: false,
      revision: 1,
    })),
    templates: [],
    estimates: [],
    schedules: [],
    docs: [],
    supply: [],
    purchases: [],
    stock: [],
    whStock: [],
    accruals: [],
    subs: [],
    links: [],
    feed: [],
    seq: 100,
  };

  rp.templates = TPL0.map<TemplateRow>((t) => ({
    id: A(t.id),
    proto: t.id,
    name: t.name,
    kind: t.kind,
    source: t.source,
    used: t.used,
    updatedAt: t.updatedAt,
    lines: t.lines.map(tplLine),
    stages: structuredClone(t.tech),
    documents: [...t.docs],
    checklist: [...t.check],
    materials: t.mats.map(tplLine),
    warrantyMonths: t.warrantyMonths,
    revision: 1,
    ...(t.source === 'own' && t.from ? { sourceProjectId: A('obj-27') } : {}),
  }));

  const catPrice = CAT0.map((c) => ({
    id: c.id,
    cat: c.cat,
    name: c.name,
    unit: c.unit,
    kind: c.kind,
    price: c.price,
  }));
  let total42 = 0;

  for (const o of OBJECTS0) {
    const total =
      o.id === 'obj-42'
        ? estimateTotals(buildLines(catPrice, e42Versions().v2, measOf(ROOMS0['obj-42'] ?? [])), 0)
            .total
        : (o.total ?? 0) * 100;
    if (o.id === 'obj-42') total42 = total;
    const p: ProjectRow = {
      id: A(o.id),
      proto: o.id,
      orgUnitId: A(UNIT),
      name: o.name,
      address: o.address,
      status: o.status,
      kind: o.kind,
      stage: o.stage,
      areaM2: o.area,
      rooms: o.rooms,
      ...(o.contractNo ? { contractNo: o.contractNo } : {}),
      ...(o.start ? { startOn: o.start } : {}),
      ...(o.due ? { dueOn: o.due } : {}),
      clientName: o.client,
      clientPhone: '+7 *** *** 12-42',
      foremanId: o.foreman ? A(o.foreman) : null,
      access: structuredClone(o.access),
      ...(o.template ? { templateId: A(o.template) } : {}),
      ...(o.id === 'obj-50' ? { leadTaskId: A('L-29') } : {}),
      ...(o.status !== 'draft' ? { budgetMinor: total } : {}),
      paidMinor: o.id === 'obj-42' ? Math.round((total / 100) * 0.3) * 100 : (o.paid ?? 0) * 100,
      spentMinor: (o.spent ?? 0) * 100,
      ...(o.handedOver ? { handedOverOn: o.handedOver } : {}),
      ...(o.warranty ? { warrantyUntil: o.warranty } : {}),
      revision: 1,
      scheduleRevision: 1,
      createdAt: at('2026-09-20'),
    };
    rp.projects.push(p);
    for (const k of o.crew) {
      const c = CREW0.find((x) => x.id === k);
      if (c) {
        rp.workers.push({
          id: A(`${o.id}:${k}`),
          projectId: p.id,
          displayName: c.name,
          trade: c.role,
          status: 'active',
        });
      }
    }
    const rooms = ROOMS0[o.id] ?? [];
    const m: MeasRow = {
      projectId: p.id,
      version: 1,
      rooms: rooms.map((r, i) => ({
        id: A(`${o.id}:room-${i + 1}`),
        name: r.name,
        l: r.l,
        w: r.w,
        h: r.h,
        o: r.o,
        wet: /^санузел/i.test(r.name),
      })),
      at: o.id === 'obj-50' ? at('2026-10-02', '12:00:00') : at('2026-09-24', '12:00:00'),
    };
    rp.meas.push(m);
  }

  for (const w of WORKS0) {
    rp.works.push({
      id: A(w.id),
      projectId: A(w.obj),
      name: w.name,
      unit: w.unit,
      plan: w.plan,
      fact: w.fact,
    });
  }

  for (const l of LOGS0) {
    rp.logs.push({
      id: A(l.id),
      number: l.id,
      projectId: A(l.obj),
      submittedBy: A('m-sokolov'),
      workDate: l.at,
      timeZone: 'Europe/Moscow',
      status: l.status,
      crew: l.crew.map((k) => A(`${l.obj}:${k}`)),
      materials: l.materials.map(([item, quantity]) => ({ priceItemId: A(item), quantity })),
      evidence: Array.from({ length: l.photos }, (_, i) => A(`${l.id}-p${i + 1}`)),
      lines: [
        {
          workId: A(l.work),
          quantity: l.volume,
          unit: WORKS0.find((w) => w.id === l.work)?.unit ?? 'm2',
        },
      ],
      ...(l.status === 'accepted'
        ? { reviewedBy: A('m-owner'), reviewedAt: at(l.at, '17:00:00') }
        : {}),
      revision: 1,
      createdAt: at(l.at, '15:00:00'),
    });
  }

  const co: ChangeRow = {
    id: A('ДР-1'),
    projectId: A('obj-42'),
    seq: 1,
    title: 'Перенос розеток на кухне',
    quantity: 6,
    unit: 'piece',
    note: 'Заказчик меняет расстановку кухни: 6 розеток перенести, штроба по бетону около 9 м.',
    photos: [A('co1-p1'), A('co1-p2')],
    status: 'proposed',
    createdBy: A('m-sokolov'),
    revision: 1,
    createdAt: at('2026-10-18', '09:00:00'),
    suggest: CO1_SUGGEST.map(([item, n]) => [A(item), n]),
  };
  rp.changes.push(co);

  // Сметы: кв. 42 — версии 1 (заменена) и 2 (действует, основа договора № 42); остальные активные и сданный — одна
  // согласованная версия на сумму договора.
  const m42 = measOf(ROOMS0['obj-42'] ?? []);
  const lineSpecs = e42Versions();
  const sectionsOf = (names: string[], pid: string) =>
    names.map((name, i) => ({ id: A(`${pid}:sec-${i + 1}`), name }));
  const mkEst = (
    pid: string,
    version: number,
    specs: typeof lineSpecs.v1,
    state: EstimateRow['state'],
    when: string,
  ): EstimateRow => {
    const built = buildLines(catPrice, specs, m42);
    const names = [...new Set(built.map((b) => b.section))];
    const sections = sectionsOf(names, `${pid}:v${version}`);
    return {
      id: A(`${pid}:est-${version}`),
      projectId: A(pid),
      version,
      kind: version === 1 ? 'first' : 'revision',
      state,
      ...(version > 1 ? { baseVersion: version - 1 } : {}),
      templateId: A('tpl-cap'),
      sections,
      lines: built.map((b) => ({
        // Идентификатор строки не меняется между версиями: по нему сопоставляется сравнение версий.
        id: A(`${pid}:${b.id}`),
        sectionId: sections.find((s) => s.name === b.section)?.id ?? '',
        priceItemId: A(b.item),
        name: b.name,
        unit: b.unit,
        kind: b.kind,
        price: b.price,
        qty: b.qty,
        ...(b.formula ? { formula: b.formula, coef: b.coef } : {}),
        manual: false,
        isNew: false,
      })),
      discountPct: 0,
      changeOrderIds: [],
      sentAt: at(when),
      approvedAt: at(when, '12:00:00'),
      revision: 1,
    };
  };
  rp.estimates.push(mkEst('obj-42', 1, lineSpecs.v1, 'replaced', '2026-09-25'));
  rp.estimates.push(mkEst('obj-42', 2, lineSpecs.v2, 'approved', '2026-09-29'));
  for (const o of OBJECTS0.filter((x) => x.id !== 'obj-42' && x.id !== 'obj-50')) {
    const sec = { id: A(`${o.id}:sec-1`), name: 'Работы и материалы по договору' };
    rp.estimates.push({
      id: A(`${o.id}:est-1`),
      projectId: A(o.id),
      version: 1,
      kind: 'first',
      state: 'approved',
      sections: [sec],
      lines: [
        {
          id: A(`${o.id}:v1:l1`),
          sectionId: sec.id,
          name: 'Работы и материалы по договору',
          unit: 'set',
          kind: 'work',
          price: o.total ?? 0,
          qty: 1,
          manual: true,
          isNew: false,
        },
      ],
      discountPct: 0,
      changeOrderIds: [],
      sentAt: at('2026-09-10'),
      approvedAt: at('2026-09-12'),
      revision: 1,
    });
  }

  // График кв. 42 (GST, GLK): этап 1 закрыт, этап 2 начат 12.10 и продлён с 8 до 10 рабочих дней (журнал 16.10).
  const sch: ScheduleRow = {
    projectId: A('obj-42'),
    stages: GST0.map((s) => ({
      id: A(`obj-42:${s.id}`),
      phase: ['Черновые работы', 'Чистовые работы', 'Сдача'][s.ph] ?? '',
      name: s.name,
      durationWd: s.dur,
      milestone: Boolean(s.ms),
      actualStart: s.as ?? null,
      status: s.id === 's1' ? 'done' : s.id === 's2' ? 'started' : 'planned',
      ...(s.who ? { executorName: s.who } : {}),
      ...(s.id === 's10' ? { executorMemberId: A('m-sokolov') } : {}),
    })),
    links: GLK0.map(([from, to, lag, note]) => ({
      from: A(`obj-42:${from}`),
      to: A(`obj-42:${to}`),
      lag,
      ...(note ? { note } : {}),
    })),
    baseline: {
      version: 1,
      dueOn: '2026-11-27',
      approvedAt: at('2026-10-01', '09:00:00'),
      agreementNo: undefined,
    },
    changes: [
      {
        id: A('obj-42:gc-2'),
        at: at('2026-10-16', '10:00:00'),
        authorName: 'Алексей Соколов',
        text: '«Электрика · черновая»: длительность 8 → 10 раб. дней, окончание 21.10 → 23.10',
        reason: 'executor_busy',
      },
      {
        id: A('obj-42:gc-1'),
        at: at('2026-10-01', '09:00:00'),
        authorName: 'Дарья Зимина',
        text: 'Базовый план утверждён вместе с договором № 42, сдача объекта 27.11',
      },
    ],
    off: {},
    dur: { [A('obj-42:s2')]: 10 },
    lag: {},
  };
  delete (sch.baseline as { agreementNo?: number }).agreementNo;
  rp.schedules.push(sch);
  void GREASONS_OF;

  // Документы кв. 42 (docs эталона).
  const e42 = rp.estimates.find((e) => e.id === A('obj-42:est-2'));
  const secTotal = (name: string): number =>
    e42
      ? e42.lines
          .filter((l) => e42.sections.find((s) => s.id === l.sectionId)?.name === name)
          .reduce((a, l) => a + Math.round(l.price * 100 * l.qty), 0)
      : 0;
  const doc = (
    id: string,
    kind: DocRow['kind'],
    title: string,
    state: DocRow['state'],
    extra: Partial<DocRow> = {},
  ): DocRow => ({
    id: A(id),
    projectId: A('obj-42'),
    kind,
    title,
    state,
    attempts: 0,
    revision: 1,
    ...extra,
  });
  rp.docs.push(
    doc('doc-42-contract', 'contract', 'Договор подряда № 42', 'signed', {
      estimateVersion: 2,
      amountMinor: total42,
      signedAt: at('2026-10-01', '09:00:00'),
      sentAt: at('2026-09-30'),
    }),
    doc('doc-42-inv1', 'invoice', 'Счёт № 1 · аванс 30%', 'paid', {
      estimateVersion: 2,
      amountMinor: Math.round((total42 / 100) * 0.3) * 100,
      signedAt: at('2026-10-02', '10:00:00'),
    }),
    doc('doc-42-act1', 'act', 'Акт № 1 · демонтаж', 'draft', {
      estimateVersion: 2,
      actNo: 1,
      amountMinor: secTotal('Демонтаж'),
    }),
    doc('doc-42-act2', 'act', 'Акт № 2 · электрика', 'wait', {
      estimateVersion: 2,
      actNo: 2,
      amountMinor: secTotal('Электрика'),
    }),
    doc('doc-42-handover', 'handover_act', 'Акт сдачи объекта', 'draft', { estimateVersion: 2 }),
  );

  // Снабжение: заявки, закупка ЗК-6, остатки складов и объектов.
  for (const r of SUPPLY0) {
    const n = Number(r.id.slice(2));
    rp.supply.push({
      id: A(`sup-${n}`),
      number: r.id,
      projectId: A(r.obj),
      priceItemId: A(r.item),
      quantity: r.qty,
      needBy: r.need,
      state: r.state,
      ...(r.purchase ? { purchaseId: A('ЗК-6') } : {}),
      costMinor: r.sum * 100,
      createdAt: at('2026-10-05'),
      revision: 1,
    });
  }
  rp.purchases.push({
    id: A('ЗК-6'),
    number: 'ЗК-6',
    supplier: 'СтройБаза Север',
    state: 'received',
    lines: [
      {
        supplyRequestId: A('sup-13'),
        projectId: A('obj-42'),
        priceItemId: A('m-cable'),
        quantity: 1,
        priceMinor: 1_320_000,
      },
    ],
    receiptQr: 't=20261014T1010&s=13200.00&fn=9960440300000000&i=1&fp=1&n=1',
    createdAt: at('2026-10-14', '08:00:00'),
    receivedAt: at('2026-10-14', '12:00:00'),
    revision: 2,
  });
  for (const s of ONOBJ0) {
    rp.stock.push({
      projectId: A(s.obj),
      priceItemId: A(s.item),
      quantity: s.qty,
      costMinor: s.qty * s.cost * 100,
    });
  }
  for (const s of STOCK0) {
    rp.whStock.push({
      warehouseId: A(s.wh),
      priceItemId: A(s.item),
      quantity: s.qty,
      reserved: 0,
      avgMinor: s.cost * 100,
    });
  }

  // Начисления бригаде (до подписи акта № 1 — «Ждёт закрытия акта»), подрядчик, ссылка кабинета, лента.
  const pays: [string, number][] = [
    ['k1', 0],
    ['k2', 1],
    ['k4', 2],
  ];
  for (const [k, i] of pays) {
    const a = ACCRUALS0[i];
    const c = CREW0.find((x) => x.id === k);
    if (!a || !c) continue;
    rp.accruals.push({
      id: A(`acc-42-${k}`),
      projectId: A('obj-42'),
      workerId: A(`obj-42:${k}`),
      workerName: c.name,
      role: c.role,
      work: a.work,
      amountMinor: a.sum * 100,
      state: 'pending_act',
      selfEmployed: a.self,
    });
  }
  rp.subs.push({
    id: A('sub-42'),
    projectId: A('obj-42'),
    name: 'ООО «ЭлектроПрофи»',
    scope: 'Электромонтаж: 38 точек, щиток',
    active: true,
    accessUntil: '2026-10-31',
    contractMinor: 4_560_000,
    paidMinor: 2_000_000,
  });
  rp.links.push({
    id: A('cl-42'),
    projectId: A('obj-42'),
    token: `cab-${A('cl-42')}`,
    sentTo: '+7 *** *** 12-42',
    issuedAt: at('2026-10-01', '07:00:00'),
  });
  rp.feed.push(
    {
      projectId: A('obj-50'),
      at: at('2026-10-02', '12:00:00'),
      text: 'внёс замер: 8 помещений, фото и план приложены',
      actorName: 'Замерщик Игорь Белов',
    },
    {
      projectId: A('obj-50'),
      at: at('2026-10-01', '10:00:00'),
      text: 'перевела заявку на этап «Замер», создан объект-черновик',
      actorName: 'Дарья Зимина',
    },
    {
      projectId: A('obj-42'),
      at: at('2026-09-30', '17:00:00'),
      text: 'приняла объём по отметке WL-11: подготовка стен, 22 м²',
      actorName: 'Дарья Зимина',
    },
  );
  void now;
  void seedUuid;
  return rp;
}

registerSeed(seedRepairs);
