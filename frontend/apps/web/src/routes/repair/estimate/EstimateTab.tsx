// W6.21 · Вкладка «Смета» карточки объекта (`repair-estimate`; эталон design-2026-10-19 «Ремонт и стройка.dc.html»
// :104–276, estVM :1384–1488). «Сметы нет» — выбор шаблона и сборка черновика; дальше версии и сравнение, правка
// черновика, допработы прораба, отправка заказчику, отзыв, допсоглашение. Согласие заказчика даёт публичный кабинет
// (W6.26), кнопок «Демо: заказчик …» нет (Q-W4.00-repair-9). Смета видна с `repairs.finance.read`, правится с
// `repairs.estimates.edit` (Q-W4.00-repair-24).
import type { components } from '@ortus/api-client';
import { Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { repairKey, useMeasurement, useProject } from '../measure/api.ts';
import { measureOf, parseDecimal, quantityString, toDraft } from '../measure/calc.ts';
import { TabFailed, TabSkeleton } from '../measure/states.tsx';
import type { RepairTabLink } from '../measure/types.ts';
import '../measure/tabs.css';
import {
  createFromTemplate,
  createRevision,
  deleteDraft,
  patchDraft,
  recallEstimate,
  rejectOrder,
  saveAsTemplate,
  sendEstimate,
  useChangeOrders,
  useDiff,
  useEstimates,
  usePriceItems,
  useTemplates,
} from './api.ts';
import { ChipView } from './ChipView.tsx';
import { CompareTable } from './CompareTable.tsx';
import { rub, signed } from './format.ts';
import { LinesTable } from './LinesTable.tsx';
import { OrdersBlock } from './OrdersBlock.tsx';
import { pickList } from './picker.ts';
import { PickView } from './PickView.tsx';
import { defaultTemplateId, measureLine, templateTotal } from './templates.ts';
import { ESTIMATE_TEXT as T, t } from './texts.ts';
import { VersionsBar } from './VersionsBar.tsx';
import {
  changeOrdersView,
  compareBase,
  compareView,
  defaultSelected,
  headChip,
  nextAgreementNo,
  reasonLabel,
  sectionsView,
  splitEstimates,
  versionNote,
  versionTiles,
} from './vm.ts';

type S = components['schemas'];

const CMD = 'repair-estimate-cmd';

interface Note {
  text: string;
  link?: boolean;
}

interface Props {
  projectId: string;
  onNavigate?: (tab: RepairTabLink) => void;
}

export function EstimateTab({ projectId, onNavigate }: Props): ReactElement {
  const { tenantId } = useShell();
  const tid = tenantId ?? '';
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy(CMD);
  const can = useCan();
  const canFinance = can('repairs.finance.read');
  const canEdit = canFinance && can('repairs.estimates.edit');
  const canCatalog = canEdit && can('repairs.catalog.manage');

  const project = useProject(tid, projectId);
  const est = useEstimates(tid, projectId, canFinance);
  const orders = useChangeOrders(tid, projectId, canFinance);
  const meas = useMeasurement(tid, projectId);
  const none = est.isSuccess && est.data.items.length === 0;
  const templates = useTemplates(tid, canEdit && none);
  const prices = usePriceItems(tid, canEdit);

  // Команды идут по одной: щелчок сразу после ввода в поле (blur уже запустил сохранение) ждёт его конца.
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const [note, setNote] = useState<Note | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [compareOn, setCompareOn] = useState(false);
  const [showSame, setShowSame] = useState(false);
  const [tplId, setTplId] = useState<string | null>(null);
  const [pickSection, setPickSection] = useState<string | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const [newSection, setNewSection] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState<S['RepairRejectReason']>('already_in_estimate');

  const list = est.data?.items ?? [];
  const selected =
    version !== null && list.some((e) => e.version === version) ? version : defaultSelected(list);
  const { open, current } = splitEstimates(list);
  const base = compareBase(list, selected);
  const sel = list.find((e) => e.version === selected);
  const diff = useDiff(tid, projectId, base?.version ?? 0, selected, compareOn && !!base && !!sel);

  if (!canFinance) {
    return (
      <section aria-labelledby="h-est" data-screen-label={T.title} className="ox-rp-section">
        <h2 id="h-est" className="ox-rp-h2">
          {T.title}
        </h2>
        <p className="ox-rp-hint" role="status">
          {T.noAccess}
        </p>
      </section>
    );
  }
  if (est.isError) {
    return (
      <TabFailed
        text={T.loadFailed}
        error={est.error}
        retry={T.retry}
        onRetry={() => void est.refetch()}
      />
    );
  }
  if (!est.data || !project.data) return <TabSkeleton label={T.title} />;

  const proj = project.data;
  const projectDraft = proj.status === 'draft';
  const orderItems = orders.data?.items ?? [];
  const rooms = toDraft(meas.data?.rooms ?? []);
  const orderNo = (ids: readonly string[]): string[] =>
    ids.flatMap((id) => orderItems.find((c) => c.id === id)?.number ?? []);

  /** Команда: ошибка — тост (useRun), страница перечитывается в любом случае. */
  const exec = <R,>(
    fn: () => Promise<R | undefined>,
    after?: (r: R) => void,
  ): Promise<R | undefined> => {
    const one = async (): Promise<R | undefined> => {
      try {
        const r = await run(CMD, fn);
        if (r === undefined) return undefined;
        after?.(r);
        await qc.invalidateQueries({ queryKey: repairKey(tid, projectId) });
        return r;
      } catch {
        void qc.invalidateQueries({ queryKey: repairKey(tid, projectId) });
        return undefined;
      }
    };
    const job = tail.current.then(one);
    tail.current = job;
    return job;
  };
  /** Черновик версии из кэша на момент выполнения команды: ревизия после предыдущих правок (If-Match). */
  const freshDraft = (version: number): S['Estimate'] | undefined =>
    qc
      .getQueryData<{ items: S['Estimate'][] }>([...repairKey(tid, projectId), 'estimates'])
      ?.items.find((e) => e.version === version && e.state === 'draft');
  const resetUi = (): void => {
    setCompareOn(false);
    setPickSection(null);
    setPickQuery('');
    setRejecting(null);
  };

  // ── команды (после ответа сервера — сразу уведомление и состояние экрана, затем перечитывание) ──
  const create = async (templateId: string): Promise<void> => {
    const tpl = templates.data?.items.find((x) => x.id === templateId);
    await exec(
      () => createFromTemplate(api, tid, projectId, templateId),
      (e) => {
        resetUi();
        setVersion(e.version);
        setNote({
          text: t(T.noteCreated, {
            name: tpl?.name ?? '',
            lines: e.lines.length,
            formulas: e.lines.filter((l) => l.formula && !l.manual).length,
          }),
        });
      },
    );
  };

  const startChange = async (order?: S['ChangeOrder']): Promise<void> => {
    await exec(
      () =>
        createRevision(api, tid, projectId, {
          kind: projectDraft ? 'revision' : 'change',
          ...(order ? { changeOrderIds: [order.id] } : {}),
        }),
      (e) => {
        resetUi();
        setVersion(e.version);
        if (!order) {
          setNote(null);
          return;
        }
        const sec = e.sections.find((s) => s.name === `Допработы · ${order.number}`);
        const filled = !!sec && e.lines.some((l) => l.sectionId === sec.id);
        if (sec && !filled) setPickSection(sec.id);
        setNote({
          text: t(filled ? T.noteOrderFilled : T.noteOrderEmpty, {
            number: order.number,
            title: order.title,
            n: e.version,
          }),
        });
      },
    );
  };

  const patch = async (body: S['EstimateDraftPatch']): Promise<boolean> => {
    if (!open || open.state !== 'draft') return false;
    const v = open.version;
    return !!(await exec(async () => {
      const d = freshDraft(v);
      return d ? patchDraft(api, tid, projectId, d.version, d.revision, body) : undefined;
    }));
  };

  const send = async (): Promise<void> => {
    if (!open) return;
    await exec(
      async () => {
        const d = freshDraft(open.version);
        return d ? sendEstimate(api, tid, projectId, d.version, d.revision) : undefined;
      },
      (e) => {
        resetUi();
        if (e.kind === 'change') {
          const delta = e.total.amountMinor - (current?.total.amountMinor ?? 0);
          setNote({
            text: t(T.noteSentChange, {
              k: e.agreementNo ?? nextAgreementNo(list),
              delta: signed(delta),
            }),
          });
        } else setNote({ text: t(T.noteSentFirst, { n: e.version }) });
      },
    );
  };

  const recall = async (): Promise<void> => {
    if (!open) return;
    await exec(
      () => recallEstimate(api, tid, projectId, open.version, open.revision),
      () => setNote({ text: T.noteRecalled }),
    );
  };

  const drop = async (): Promise<void> => {
    if (!open) return;
    const numbers = orderNo(open.changeOrderIds);
    await exec(
      async () => {
        const d = freshDraft(open.version);
        if (!d) return undefined;
        await deleteDraft(api, tid, projectId, d.version, d.revision);
        return true;
      },
      () => {
        resetUi();
        setVersion(null);
        setNote({
          text: numbers.length
            ? t(T.noteDroppedOrders, { orders: numbers.join(', ') })
            : T.noteDropped,
        });
      },
    );
  };

  const reject = async (id: string): Promise<void> => {
    const order = orderItems.find((c) => c.id === id);
    if (!order) return;
    await exec(
      () => rejectOrder(api, tid, order, reason),
      () => {
        setRejecting(null);
        setNote({ text: t(T.noteRejected, { number: order.number, reason: reasonLabel(reason) }) });
      },
    );
  };

  const saveTemplate = async (): Promise<void> => {
    await exec(
      () => saveAsTemplate(api, tid, projectId, t(T.templateName, { name: proj.name })),
      (tpl) => {
        void qc.invalidateQueries({ queryKey: ['tenant', tid, 'repairs', 'templates'] });
        setNote({
          text: t(T.noteTemplate, { name: tpl.name, lines: tpl.lines.length }),
          link: true,
        });
      },
    );
  };

  const addSection = async (): Promise<void> => {
    const name = newSection.trim();
    if (!name || !open || open.sections.some((s) => s.name === name)) return;
    if (await patch({ addSections: [name] })) {
      setNewSection('');
      setPickQuery('');
    }
  };
  // ── представление ──
  const tpls = templates.data?.items ?? [];
  const chosenTpl = tplId ?? defaultTemplateId(tpls, proj.kind);
  const lead =
    list.length === 0 ? T.leadNone : projectDraft ? T.leadDraftProject : T.leadActiveProject;
  const priceMap = new Map((prices.data ?? []).map((p) => [p.id, p]));
  const isOpen = !!open && sel?.version === open.version;
  const editing = isOpen && open?.state === 'draft' && canEdit;
  const chg = open?.kind === 'change';
  const tiles = versionTiles(list, proj, selected);
  const orderView = changeOrdersView(orderItems, { canEdit, list, selected, projectDraft });
  const tplName = tpls.find((x) => x.id === sel?.templateId)?.name ?? '';
  const cmp =
    compareOn && base && sel && diff.data ? compareView(base, sel, diff.data, showSame) : undefined;
  const sections = sel ? sectionsView(sel, { editable: editing }) : [];
  const sub = sel ? sel.lines.reduce((a, l) => a + l.sum.amountMinor, 0) : 0;
  const baseOfSel =
    isOpen && sel?.baseVersion ? list.find((e) => e.version === sel.baseVersion) : undefined;
  const pickItems = pickSection
    ? pickList(
        prices.data ?? [],
        pickQuery,
        // раздел справочника — по названию раздела сметы
        sel?.sections.find((s) => s.id === pickSection)?.name ?? '',
      )
    : [];

  const pending = tpls.length > 0 && meas.data && prices.data;

  return (
    <section
      aria-labelledby="h-est"
      data-screen-label={T.title}
      className="ox-rp-section"
      aria-busy={busy || undefined}
    >
      <div className="ox-rp-head">
        <div>
          <h2 id="h-est" className="ox-rp-h2">
            {T.title}
          </h2>
          <p className="ox-rp-lead">{lead}</p>
        </div>
        <ChipView chip={headChip(list, projectDraft)} />
      </div>

      {note ? (
        <div role="status" className="ox-rp-note">
          <Icon name="check_circle" size={20} className="ox-rp-ico" />
          <span className="ox-rp-note-text">{note.text}</span>
          {note.link && onNavigate ? (
            <button
              type="button"
              className="ox-rp-btn"
              data-variant="outline"
              data-size="sm"
              onClick={() => onNavigate('catalog')}
            >
              {T.openTemplate}
            </button>
          ) : null}
          <button
            type="button"
            className="ox-rp-iconbtn"
            aria-label={T.hideNote}
            onClick={() => setNote(null)}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : null}

      {list.length === 0 ? (
        canEdit ? (
          pending && chosenTpl ? (
            <PickView
              templates={tpls}
              selectedId={chosenTpl}
              onSelect={setTplId}
              kind={proj.kind}
              measureLine={measureLine(meas.data?.measuredAt, rooms)}
              total={templateTotal(
                tpls.find((x) => x.id === chosenTpl) ?? tpls[0] ?? EMPTY_TEMPLATE,
                priceMap,
                measureOf(rooms),
              )}
              busy={busy}
              onCreate={() => void create(chosenTpl)}
              onNavigate={onNavigate}
            />
          ) : (
            <TabSkeleton label={T.title} />
          )
        ) : (
          <div className="ox-rp-empty">{T.emptyReadOnly}</div>
        )
      ) : (
        <>
          <OrdersBlock
            view={orderView}
            rejecting={rejecting}
            reason={reason}
            busy={busy}
            onPrice={(id) => {
              const o = orderItems.find((c) => c.id === id);
              if (o) void startChange(o);
            }}
            onOpen={() => {
              if (open) setVersion(open.version);
              setCompareOn(false);
            }}
            onRejectStart={(id) => {
              setRejecting(id);
              setReason('already_in_estimate');
            }}
            onReason={setReason}
            onReject={(id) => void reject(id)}
            onRejectCancel={() => setRejecting(null)}
          />

          <VersionsBar
            tiles={tiles}
            note={versionNote(list, proj, selected, {
              template: tplName,
              orders: orderNo(sel?.changeOrderIds ?? []),
            })}
            compareWith={base?.version}
            compareOn={compareOn}
            onPick={(v) => {
              setVersion(v);
              resetUi();
            }}
            onCompare={() => {
              setCompareOn((v) => !v);
              setPickSection(null);
            }}
          />

          {cmp && base && sel ? (
            <CompareTable
              view={cmp}
              a={base.version}
              b={sel.version}
              onToggleSame={() => setShowSame((v) => !v)}
            />
          ) : compareOn && diff.isError ? (
            <TabFailed
              text={T.loadFailed}
              error={diff.error}
              retry={T.retry}
              onRetry={() => void diff.refetch()}
            />
          ) : compareOn ? (
            <TabSkeleton label={T.title} />
          ) : sel ? (
            <LinesTable
              sections={sections}
              edit={editing}
              totalLabel={t(T.totalVersion, { n: sel.version })}
              total={rub(sel.total.amountMinor)}
              discountPct={sel.discountPct}
              discountAmount={`−${rub(sub - sel.total.amountMinor)}`}
              discountInput={String(sel.discountPct)}
              baseText={
                baseOfSel
                  ? t(T.baseText, {
                      n: baseOfSel.version,
                      sum: rub(baseOfSel.total.amountMinor),
                      delta: signed(sel.total.amountMinor - baseOfSel.total.amountMinor),
                    })
                  : undefined
              }
              pick={{ sectionId: pickSection, query: pickQuery, items: pickItems }}
              newSection={newSection}
              onQty={(id, v) => {
                const l = sel.lines.find((x) => x.id === id);
                if (!l || Math.abs(parseDecimal(v) - Number(l.quantity)) < 1e-9) return;
                void patch({ lines: [{ id, quantity: quantityString(parseDecimal(v)) }] });
              }}
              onPrice={(id, v) => {
                const l = sel.lines.find((x) => x.id === id);
                const minor = Math.round(parseDecimal(v) * 100);
                if (!l || minor === l.price.amountMinor || minor < 0) return;
                void patch({
                  lines: [{ id, price: { amountMinor: minor, currency: 'RUB' } }],
                });
              }}
              onReset={(id) => void patch({ resetLineIds: [id] })}
              onRemove={(id) => void patch({ removeLineIds: [id] })}
              onTogglePick={(id) => {
                setPickSection((cur) => (cur === id ? null : id));
                setPickQuery('');
              }}
              onQuery={setPickQuery}
              onAddLine={(sectionId, priceItemId) => {
                setPickSection(null);
                setPickQuery('');
                void patch({ addLines: [{ sectionId, priceItemId }] });
              }}
              onNewSection={setNewSection}
              onAddSection={() => void addSection()}
              onDiscount={(v) => {
                const pct = Math.min(100, Math.max(0, Math.round(parseDecimal(v))));
                if (pct !== sel.discountPct) void patch({ discountPct: pct });
              }}
            />
          ) : null}

          <div className="ox-rp-actions">
            {editing && sel && sel.lines.length > 0 ? (
              <button
                type="button"
                className="ox-rp-btn"
                data-size="lg"
                onClick={() => void send()}
              >
                <Icon name="send" size={18} />
                {chg ? t(T.sendChange, { n: nextAgreementNo(list) }) : T.sendFirst}
              </button>
            ) : null}
            {isOpen && open?.state === 'sent' && canEdit ? (
              <button
                type="button"
                className="ox-rp-btn"
                data-variant="secondary"
                data-size="lg"
                disabled={busy}
                onClick={() => void recall()}
              >
                <Icon name="undo" size={18} />
                {T.recall}
              </button>
            ) : null}
            {canEdit && !open && current && proj.status !== 'handed_over' ? (
              <button
                type="button"
                className="ox-rp-btn"
                data-variant="outline"
                data-size="lg"
                disabled={busy}
                onClick={() => void startChange()}
              >
                <Icon name="edit_note" size={18} />
                {projectDraft ? T.newVersion : T.changeByAgreement}
              </button>
            ) : null}
            {canCatalog && !open && current ? (
              <button
                type="button"
                className="ox-rp-btn"
                data-variant="secondary"
                data-size="lg"
                disabled={busy}
                onClick={() => void saveTemplate()}
              >
                <Icon name="bookmark_add" size={18} />
                {T.saveTemplate}
              </button>
            ) : null}
            {!projectDraft && onNavigate ? (
              <button
                type="button"
                className="ox-rp-btn"
                data-variant="secondary"
                data-size="lg"
                onClick={() => onNavigate('schedule')}
              >
                <Icon name="view_timeline" size={18} />
                {T.toSchedule}
              </button>
            ) : null}
            {editing ? (
              <button
                type="button"
                className="ox-rp-btn"
                data-variant="danger"
                data-size="lg"
                onClick={() => void drop()}
              >
                <Icon name="delete" size={18} />
                {T.dropDraft}
              </button>
            ) : null}
            <button
              type="button"
              className="ox-rp-btn"
              data-variant="secondary"
              data-size="lg"
              disabled
              title={T.pdfHint}
            >
              {T.pdf}
            </button>
          </div>
          {editing ? (
            <span className="ox-rp-hint-inline">
              {chg ? t(T.sendNoteChange, { n: open?.version ?? '' }) : T.sendNoteFirst}
            </span>
          ) : null}
        </>
      )}
    </section>
  );
}

const EMPTY_TEMPLATE: S['Template'] = {
  id: '',
  name: '',
  kind: '',
  source: 'own',
  usedByObjects: 0,
  updatedAt: '',
  lines: [],
  stages: [],
  documents: [],
  checklist: [],
  materials: [],
  warrantyMonths: 24,
  revision: 1,
};
