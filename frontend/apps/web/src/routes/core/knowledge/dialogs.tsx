// W4.32 · Диалоги «Базы знаний» (М:294–374, dlgVM М:579–627): каркас (заголовок, подзаголовок, «Закрыть», подвал с
// ошибкой, «Отмена» и OK; Escape закрывает, фокус — в диалог и обратно), «Новое пространство» (шаблоны
// listKnowledgeSpaceTemplates, области listOrgUnits), «Создать в «…»» (затем редактор новой страницы),
// «Переместить «…»» (влияние — moveKnowledgeNode с dryRun).
import type { components } from '@ortus/api-client';
import { format, knowledge as K } from '@ortus/texts';
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { useOrgUnits } from '../../../shell/scope.ts';
import { commands, useMoveImpact, useTemplates } from './api.ts';
import { errorText, useKb } from './ctx.tsx';
import {
  creatable,
  draftOf,
  impactNames,
  KIND_ICON,
  lineLook,
  type Space,
  SPACE_COLORS,
  SPACE_ICONS,
  subtreeIds,
  templateChip,
  toggleTemplateNode,
  type TreeIndex,
  treeOptions,
  unitOptions,
} from './model.ts';
import { Failed, Glyph, Pending } from './parts.tsx';
import { KB_TEXT } from './texts.ts';

type S = components['schemas'];

const FOCUSABLE =
  'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Ловушка фокуса модального диалога: Tab с последней цели — на первую, Shift+Tab с первой — на последнюю. */
function trapTab(e: KeyboardEvent, box: HTMLElement): void {
  const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getAttribute('aria-hidden') !== 'true',
  );
  const first = all[0];
  const last = all.at(-1);
  if (!first || !last) return;
  const at = document.activeElement;
  const inside = at instanceof Node && box.contains(at) && at !== box;
  if (e.shiftKey ? !inside || at === first : !inside || at === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

/** Каркас диалога (М:295–371): фокус в диалог и обратно, Escape, ловушка Tab, ошибка подвала — role=alert. */
export function Frame(p: {
  title: string;
  sub: string;
  width: string;
  children: ReactNode;
  closeLabel?: string;
  ok?: { label: string; off: boolean; onOk: () => void };
}): ReactElement {
  const { closeDialog, dialogErr } = useKb();
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
      }
      if (e.key === 'Tab' && box.current) trapTab(e, box.current);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      back?.focus?.({ preventScroll: true });
    };
  }, [closeDialog]);
  return (
    <div className="ox-kb-overlay">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        tabIndex={-1}
        className="ox-kb-dialog"
        style={{ width: `min(100%, ${p.width})` }}
      >
        <div className="ox-kb-dialog-head">
          <span className="ox-kb-dialog-titles">
            <h2>{p.title}</h2>
            <span>{p.sub}</span>
          </span>
          <button
            type="button"
            className="ox-kb-dialog-x"
            aria-label={K.dialogs.close}
            onClick={closeDialog}
          >
            <Glyph name="close" size={22} />
          </button>
        </div>
        {p.children}
        <div className="ox-kb-dialog-foot">
          {/* Живая область есть заранее — текст ошибки 403/422 объявляется при появлении. */}
          <span className="ox-kb-dialog-err" role="alert">
            {dialogErr}
          </span>
          <button type="button" className="ox-kb-btn" data-size="dlg" onClick={closeDialog}>
            {p.closeLabel ?? K.dialogs.cancel}
          </button>
          {p.ok ? (
            <button
              type="button"
              className="ox-kb-btn"
              data-variant="primary"
              data-size="dlg"
              disabled={p.ok.off}
              onClick={p.ok.onOk}
            >
              {p.ok.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Выбор-«радио» эталона (radio М:387). */
export function RadioCard(p: {
  sel: boolean;
  icon?: string;
  title: string;
  text: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="ox-kb-radio"
      aria-pressed={p.sel ? 'true' : 'false'}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      <Glyph
        name={p.icon ?? (p.sel ? 'radio_button_checked' : 'radio_button_unchecked')}
        size={20}
        className={p.icon ? 'ox-kb-radio-tpl' : 'ox-kb-radio-dot'}
      />
      <span className="ox-kb-radio-text">
        <strong>{p.title}</strong>
        <span>{p.text}</span>
      </span>
    </button>
  );
}

/** «Новое пространство» (М:299–309, 583–598). */
export function SpaceDialog(): ReactElement {
  const api = useApi();
  const { tenantId, cmd, busy, closeDialog, go } = useKb();
  const { audience } = useShell();
  const can = useCan();
  const tpls = useTemplates(tenantId, true);
  const unitsQ = useOrgUnits(tenantId, audience === 'owner' || can('org_units.read'));
  const units = unitsQ.data ?? [];
  const list = tpls.data ?? [];
  const [f, setF] = useState<{
    name: string;
    icon: string;
    color: string;
    unit: string;
    access: S['KnowledgeSpaceCreate']['access'];
    tpl: S['KnowledgeSpaceTemplate']['key'];
    nodes: Set<number> | null;
  }>({
    name: '',
    icon: 'menu_book',
    color: '#2B5479',
    unit: '',
    access: 'open',
    tpl: 'staff',
    nodes: null,
  });
  const tpl = list.find((t) => t.key === f.tpl) ?? list[0];
  const picked = f.nodes ?? new Set((tpl?.nodes ?? []).map((n) => n.index));
  const ok = async (): Promise<void> => {
    if (!tpl) return;
    const body: S['KnowledgeSpaceCreate'] = {
      name: f.name,
      access: f.access,
      icon: f.icon,
      color: f.color,
      orgUnitId: f.unit || null,
      templateKey: tpl.key,
      templateNodes: [...picked].sort((a, b) => a - b),
    };
    const r = await cmd(
      { op: 'space', body },
      (key) => commands.createSpace(api, tenantId, body, key),
      K.toast.spaceCreated,
      { dialog: true },
    );
    if (r.ok && r.data) {
      closeDialog();
      go({ space: r.data.id });
    }
  };
  const d = K.dialogs.space;
  return (
    <Frame
      title={d.title}
      sub={d.sub}
      width="760px"
      ok={{
        label: d.ok,
        // До загрузки шаблонов создать нельзя: иначе уйдёт скрытый шаблон без узлов (пустое пространство).
        off: busy || f.name.trim().length < 2 || !tpl,
        onOk: () => void ok(),
      }}
    >
      <div className="ox-kb-dialog-body">
        <label className="ox-kb-field">
          {d.name}
          <input
            value={f.name}
            maxLength={120}
            placeholder={d.placeholder}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </label>
        <div className="ox-kb-looks">
          <span className="ox-kb-label">{d.icon}</span>
          {SPACE_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              className="ox-kb-look-icon"
              aria-label={format(KB_TEXT.iconAria, { name: KB_TEXT.icons[icon] ?? icon })}
              aria-pressed={f.icon === icon ? 'true' : 'false'}
              style={{ background: f.color }}
              onClick={() => setF({ ...f, icon })}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                {icon}
              </span>
            </button>
          ))}
          <span className="ox-kb-fill" />
          {SPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="ox-kb-look-color"
              aria-label={format(KB_TEXT.colorAria, { name: KB_TEXT.colors[c] ?? d.colorAria })}
              aria-pressed={f.color === c ? 'true' : 'false'}
              style={{ background: c }}
              onClick={() => setF({ ...f, color: c })}
            />
          ))}
        </div>
        <label className="ox-kb-field">
          {d.unit}
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            {unitOptions(units).map((o) => (
              <option key={o.v} value={o.v}>
                {o.kind === 'tenant'
                  ? d.tenant
                  : o.kind === 'region'
                    ? format(d.region, { name: o.name })
                    : format(d.firm, { name: o.name })}
              </option>
            ))}
          </select>
        </label>
        {unitsQ.isError ? <Failed q={unitsQ} /> : null}
        {/* Области грузятся — «Загрузка» под полем (запрос выключен без права читать области — ничего). */}
        {unitsQ.isLoading ? <Pending rows={1} /> : null}
        <div className="ox-kb-radios" data-min="180">
          {(['open', 'limited', 'closed'] as const).map((k) => (
            <RadioCard
              key={k}
              sel={f.access === k}
              title={K.levels[k].label}
              text={K.levels[k].d}
              onClick={() => setF({ ...f, access: k })}
            />
          ))}
        </div>
        <span className="ox-kb-label">{d.template}</span>
        {tpls.isError ? <Failed q={tpls} /> : null}
        {tpls.isPending && !tpls.isError ? <Pending rows={2} /> : null}
        <div className="ox-kb-radios" data-min="200">
          {list.map((t) => (
            <RadioCard
              key={t.key}
              sel={f.tpl === t.key}
              icon={t.icon}
              title={t.name}
              text={t.hint}
              onClick={() =>
                setF({ ...f, tpl: t.key, nodes: null, icon: t.icon === 'draft' ? f.icon : t.icon })
              }
            />
          ))}
        </div>
        {tpl ? (
          <div className="ox-kb-tnodes">
            {tpl.nodes.map((x) => {
              const on = picked.has(x.index);
              const chip = templateChip(x);
              return (
                <button
                  key={x.index}
                  type="button"
                  role="checkbox"
                  aria-checked={on ? 'true' : 'false'}
                  className="ox-kb-tnode"
                  data-on={on ? '' : undefined}
                  style={{ paddingLeft: `${10 + (x.parentIndex !== null ? 24 : 0)}px` }}
                  onClick={() =>
                    setF({ ...f, nodes: toggleTemplateNode(tpl.nodes, picked, x.index) })
                  }
                >
                  <Glyph
                    name={on ? 'check_box' : 'check_box_outline_blank'}
                    size={20}
                    className="ox-kb-tnode-cb"
                  />
                  <Glyph name={KIND_ICON[x.kind]} size={18} className="ox-kb-tnode-kind" />
                  <span className="ox-kb-tnode-title">{x.title}</span>
                  <span
                    className="ox-kb-tnode-chip"
                    data-tone={
                      chip.kind === 'role' ? 'info' : chip.kind === 'ack' ? 'ok' : 'neutral'
                    }
                  >
                    {chip.kind === 'role'
                      ? format(d.chipRole, { role: chip.role })
                      : chip.kind === 'ack'
                        ? d.chipAck
                        : chip.kind === 'parent'
                          ? K.modes.inherit.label
                          : d.chipSpace}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

/** «Создать в «{пространство}»» (М:311–318, 602–611): после создания — редактор новой страницы. */
export function NodeDialog(p: { space: Space; tree: TreeIndex; parent: string }): ReactElement {
  const api = useApi();
  const { tenantId, cmd, busy, closeDialog, go, setDraft } = useKb();
  const { space: sp, tree } = p;
  const [f, setF] = useState<{
    kind: S['KnowledgeNodeCreate']['kind'];
    title: string;
    parent: string;
  }>({
    kind: 'page',
    title: '',
    parent: p.parent,
  });
  const parents = [
    ...(sp.my.create ? [{ v: '', t: K.dialogs.node.top }] : []),
    ...treeOptions(tree, creatable),
  ];
  const par = f.parent && parents.some((o) => o.v === f.parent) ? f.parent : (parents[0]?.v ?? '');
  const pn = par ? tree.byId.get(par) : undefined;
  const kinds = [
    ['page', K.kinds.page, 'description'],
    ['folder', K.kinds.folder, 'folder'],
    ['diagram', K.kinds.diagram, 'schema'],
  ] as const;
  const ok = async (): Promise<void> => {
    const body: S['KnowledgeNodeCreate'] = { parentId: par || null, kind: f.kind, title: f.title };
    const r = await cmd(
      { op: 'node', space: sp.id, body },
      (key) => commands.createNode(api, tenantId, sp.id, body, key),
      K.toast.created,
      { dialog: true },
    );
    if (r.ok && r.data) {
      closeDialog();
      if (r.data.kind !== 'folder') setDraft(draftOf(r.data));
      go({ space: sp.id, page: r.data.id });
    }
  };
  const d = K.dialogs.node;
  return (
    <Frame
      title={format(d.title, { space: sp.name })}
      sub={d.sub}
      width="640px"
      ok={{
        label: d.ok,
        off: busy || f.title.trim().length < 2 || !parents.length,
        onOk: () => void ok(),
      }}
    >
      <div className="ox-kb-dialog-body">
        <div className="ox-kb-kinds">
          {kinds.map(([k, t, icon]) => (
            <button
              key={k}
              type="button"
              className="ox-kb-kind"
              aria-pressed={f.kind === k ? 'true' : 'false'}
              onClick={() => setF({ ...f, kind: k })}
            >
              <Glyph name={icon} size={22} />
              <strong>{t}</strong>
            </button>
          ))}
        </div>
        <label className="ox-kb-field">
          {d.name}
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </label>
        <label className="ox-kb-field">
          {d.where}
          <select value={par} onChange={(e) => setF({ ...f, parent: e.target.value })}>
            {parents.map((o) => (
              <option key={o.v} value={o.v}>
                {o.t}
              </option>
            ))}
          </select>
        </label>
        <span className="ox-kb-dialog-note">
          {pn
            ? format(d.inside, {
                title: pn.title,
                own: pn.accessMode !== 'inherit' ? 'true' : 'false',
              })
            : format(d.atTop, { d: K.levels[sp.access].d.toLowerCase() })}
        </span>
      </div>
    </Frame>
  );
}

/** Строка влияния (move и доступ, М:323, 357). */
export function ImpactRow({ k, text }: { k: string; text: string }): ReactElement {
  const look = lineLook(k);
  return (
    <div className="ox-kb-impact" data-tone={look.tone}>
      <Glyph name={look.icon} size={18} />
      <span>{text}</span>
    </div>
  );
}

/** «Переместить «{страница}»» (М:320–325, 613–626). */
export function MoveDialog(p: {
  space: Space;
  tree: TreeIndex;
  nodeId: string;
}): ReactElement | null {
  const api = useApi();
  const { tenantId, cmd, busy, closeDialog, go, setDialogErr } = useKb();
  const n = p.tree.byId.get(p.nodeId);
  const [parent, setParent] = useState<string>(n?.parentId ?? '');
  const changed = !!n && (parent || '') !== (n.parentId || '');
  const imp = useMoveImpact(tenantId, p.nodeId, changed ? parent || null : undefined);
  useEffect(() => {
    if (imp.isError) setDialogErr(errorText(imp.error));
    else setDialogErr('');
  }, [imp.isError, imp.error, setDialogErr]);
  if (!n) return null;
  const sub = subtreeIds(p.tree, n.id);
  const parents = [
    { v: '', t: K.dialogs.node.top },
    ...treeOptions(p.tree, (x) => !sub.has(x.id) && creatable(x)),
  ];
  const d = K.dialogs.move;
  const data = changed ? imp.data : undefined;
  const ok = async (): Promise<void> => {
    const r = await cmd(
      { op: 'move', node: n.id, parent },
      (key) => commands.move(api, tenantId, n.id, parent || null, key),
      K.toast.moved,
      { dialog: true },
    );
    if (r.ok) {
      closeDialog();
      go({ space: p.space.id, page: n.id });
    }
  };
  return (
    <Frame
      title={format(d.title, { title: n.title })}
      sub={d.sub}
      width="640px"
      ok={{ label: d.ok, off: busy || !changed, onOk: () => void ok() }}
    >
      <div className="ox-kb-dialog-body" data-gap="12">
        <label className="ox-kb-field">
          {d.parent}
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            {parents.map((o) => (
              <option key={o.v} value={o.v}>
                {o.t}
              </option>
            ))}
          </select>
        </label>
        {!data ? (
          <ImpactRow k="pick" text={d.pick} />
        ) : (
          <>
            <ImpactRow k="pages" text={format(d.pages, { n: data.pages })} />
            {data.loseView.length ? (
              <ImpactRow
                k="loseView"
                text={format(K.dialogs.impact.loseView, { names: impactNames(data.loseView) })}
              />
            ) : (
              <ImpactRow k="nobody" text={d.nobody} />
            )}
            {data.gainView.length ? (
              <ImpactRow
                k="gainView"
                text={format(K.dialogs.impact.gainView, { names: impactNames(data.gainView) })}
              />
            ) : null}
          </>
        )}
      </div>
    </Frame>
  );
}
