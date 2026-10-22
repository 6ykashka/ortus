// W4.23 · Редактор действия «Сохранить в Базу знаний» (`forms-actions`; эталон design-2026-10-19 «Формы и опросы.dc.html»
// dc:352–400, kbVM dc:931–963): страница (`{раздел} · {страница}` из деревьев пространств W4.04 или «＋ Новая страница»
// с разделом, названием и «Кто видит страницу»), «Строкой в таблицу» / «Записью на страницу», таблица страницы или
// «Новая таблица по вопросам формы», сопоставление «поле ← источник» (FORM_VARS и вопросы черновика), «Новые строки /
// записи», пример по последнему ответу, ссылка после отправки, подтверждение «Понимаю…», сноска о сроке хранения.
import { format, formsResults as F } from '@ortus/texts';
import { type ReactElement, useEffect } from 'react';

import { useKbNode, useKbSpaces, useKbTrees } from './api.ts';
import { Glyph, Pending } from './ctx.tsx';
import {
  type Def,
  type Form,
  type KbField,
  kbDefault,
  kbMap,
  kbMissing,
  kbPageLabel,
  kbSources,
  kbValue,
  moduleName,
  NEW,
  type Response,
  retainText,
  type RuleDraft,
  sampleOf,
  type Version,
} from './model.ts';

const K = F.actions.kb;

export interface KbPage {
  id: string;
  title: string;
  spaceId: string;
  spaceName: string;
  /** Свой доступ «Только выбранные» — записи увидят не все сотрудники. */
  listed: boolean;
}

/** Страницы «Базы знаний», видимые участнику, и права создавать (kbCan, kbOwner dc:929–930). */
export function useKbPages(tenantId: string, enabled: boolean) {
  const spaces = useKbSpaces(tenantId, enabled);
  const list = spaces.data ?? [];
  const trees = useKbTrees(
    tenantId,
    list.map((s) => s.id),
  );
  const pages: KbPage[] = [];
  for (const [i, s] of list.entries()) {
    for (const n of trees[i]?.data?.nodes ?? []) {
      // Страницы и страницы-таблицы (таблицы ответов живут на них); папки, схемы, файлы и ссылки — нет.
      if ((n.kind !== 'page' && n.kind !== 'table') || n.archived) continue;
      pages.push({
        id: n.id,
        title: n.title,
        spaceId: s.id,
        spaceName: s.name,
        listed: n.accessMode === 'listed',
      });
    }
  }
  return {
    spaces: list,
    pages,
    pending: spaces.isPending || trees.some((t) => t.isPending),
    error: spaces.isError ? spaces : trees.find((t) => t.isError),
    canCreate: list.some((s) => s.my.create),
    owner: list.some((s) => s.my.owner),
    /**
     * «Только владелец» новой страницы в разделе: владелец бизнеса, который в нём руководитель
     * (setKnowledgeNodeAccess — knowledge.access.manage). Остальным режим недоступен (kbOwner dc:930).
     */
    canOwnerOnly: (spaceId: string) =>
      list.some((s) => s.id === spaceId && s.my.owner && s.my.lead),
  };
}

type Pages = ReturnType<typeof useKbPages>;

function Seg<T extends string>(p: {
  aria: string;
  value: T;
  items: { key: T; label: string; off?: string }[];
  onPick: (k: T) => void;
  small?: boolean;
}): ReactElement {
  return (
    <div role="group" aria-label={p.aria} className="ox-fr-seg" data-small={p.small || undefined}>
      {p.items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-pressed={p.value === it.key}
          disabled={!!it.off}
          title={it.off || undefined}
          onClick={() => !it.off && p.value !== it.key && p.onPick(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function KbRuleEditor(p: {
  tenantId: string;
  form: Form;
  def: Def | undefined;
  draft: RuleDraft;
  set: (patch: Partial<RuleDraft>) => void;
  /** Правка без действия участника (таблица по загрузке узла): ошибку подвала не снимает. */
  setAuto: (patch: Partial<RuleDraft>) => void;
  kb: Pages;
  responses: readonly Response[];
  versions: readonly Version[];
}): ReactElement {
  const { form: f, def, draft: R, set, kb } = p;
  const isNP = R.page === NEW;
  const page = isNP ? undefined : kb.pages.find((x) => x.id === R.page);
  const node = useKbNode(p.tenantId, page ? page.id : '');
  const tables = node.data?.node.tables ?? [];
  const pub = f.settings.access === 'public';
  const table = R.mode === 'table';
  const isNewTable = table && R.table === NEW;
  const fixed = table && !isNewTable && !!R.table;
  const srcs0 = kbSources(def);
  const missing = kbMissing(R.fields, def);
  const srcs = [
    ...srcs0,
    ...missing.map((m) => ({ value: m.source, label: format(K.missing, { src: m.source }) })),
  ];
  const sample = sampleOf(p.responses);
  const sampleDef = sample
    ? p.versions.find((v) => v.number === sample.versionNumber)?.definition
    : undefined;
  const value = (src: string) =>
    sample
      ? kbValue(f, sample, src, sampleDef) || '—'
      : `‹${srcs.find((o) => o.value === src)?.label ?? src}›`;
  const ownerOnly = isNP ? R.np.access === 'owner' : !!page?.listed;
  const hasPage = isNP || !!page;
  const setF = (i: number, patch: Partial<KbField>) =>
    set({ fields: R.fields.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  const onPage = (v: string) => {
    if (v === NEW) {
      const sp =
        kb.spaces.find((s) => s.my.create && s.name === moduleName(f.moduleKey)) ??
        kb.spaces.find((s) => s.my.create);
      set({
        page: NEW,
        np: {
          space: R.np.space || sp?.id || '',
          title: R.np.title || format(K.pageTitleDefault, { form: f.name }),
          access: R.np.access,
        },
        ...(table
          ? { table: NEW, newTitle: K.newTableDefault, fields: kbDefault(f, def) }
          : { fields: R.fields.length ? R.fields : kbDefault(f, def) }),
        allSee: R.np.access !== 'owner',
      });
      return;
    }
    const pg = kb.pages.find((x) => x.id === v);
    if (!v || !pg) {
      set({ page: '', table: '', fields: table ? [] : R.fields, allSee: false });
      return;
    }
    // Таблица выбирается после загрузки узла (pickTable); до неё — новая таблица по вопросам формы.
    set(
      table
        ? { page: v, table: '', newTitle: '', fields: [], allSee: !pg.listed }
        : { page: v, fields: R.fields.length ? R.fields : kbDefault(f, def), allSee: !pg.listed },
    );
  };

  // Первая таблица страницы после загрузки узла (kbPick dc:903): есть — её столбцы, нет — новая по вопросам формы.
  const first = node.isSuccess ? (tables[0] ?? null) : undefined;
  const needPick = table && !!page && !R.table && first !== undefined;
  const { setAuto } = p;
  useEffect(() => {
    if (!needPick) return;
    setAuto(
      first
        ? { table: first.id, fields: kbMap(first.columns, def) }
        : {
            table: NEW,
            newTitle: format(K.pageTitleDefault, { form: f.name }),
            fields: kbDefault(f, def),
          },
    );
  }, [needPick, first, def, f, setAuto]);

  const onTable = (v: string) => {
    const t = tables.find((x) => x.id === v);
    set(
      t
        ? { table: t.id, fields: kbMap(t.columns, def, R.fields) }
        : {
            table: NEW,
            newTitle: R.newTitle || format(K.pageTitleDefault, { form: f.name }),
            fields: kbDefault(f, def),
          },
    );
  };

  const onMode = (m: 'table' | 'entry') =>
    set(
      m === 'entry'
        ? { mode: 'entry', head: R.head || '$object', fields: kbDefault(f, def) }
        : {
            mode: 'table',
            table: isNP ? NEW : '',
            newTitle: isNP ? K.newTableDefault : '',
            fields: isNP ? kbDefault(f, def) : [],
          },
    );

  const accessText = ownerOnly ? (isNP ? K.accessOwnerNew : K.accessOwner) : K.accessAll;
  const mapTitle = !table ? K.mapEntry : isNewTable ? K.mapNew : K.mapFixed;
  const shownFields = R.fields.filter((m) => m.source);

  return (
    <div className="ox-fr-kb">
      <div className="ox-fr-kb-top">
        <label className="ox-fr-field ox-fr-grow2">
          {K.page}
          <select value={R.page} onChange={(e) => onPage(e.target.value)}>
            <option value="">{K.pick}</option>
            {kb.pages.map((x) => (
              <option key={x.id} value={x.id}>
                {kbPageLabel(x)}
              </option>
            ))}
            <option value={NEW} disabled={!kb.canCreate || !kb.spaces.length}>
              {kb.canCreate ? K.newPage : K.newPageNoRight}
            </option>
          </select>
        </label>
        <Seg
          aria={K.modesAria}
          value={R.mode}
          items={[
            { key: 'table', label: K.modeTable },
            { key: 'entry', label: K.modeEntry },
          ]}
          onPick={onMode}
        />
      </div>
      {kb.pending ? <Pending /> : null}
      {!hasPage ? <span className="ox-fr-kb-hint">{K.noPage}</span> : null}
      {hasPage ? (
        <>
          {isNP ? (
            <div className="ox-fr-np">
              <div className="ox-fr-np-row">
                <label className="ox-fr-field ox-fr-grow1">
                  {K.section}
                  <select
                    value={R.np.space}
                    onChange={(e) => set({ np: { ...R.np, space: e.target.value } })}
                  >
                    {kb.spaces
                      .filter((s) => s.my.create)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="ox-fr-field ox-fr-grow2">
                  {K.pageTitle}
                  <input
                    value={R.np.title}
                    maxLength={120}
                    onChange={(e) => set({ np: { ...R.np, title: e.target.value } })}
                  />
                </label>
              </div>
              <div className="ox-fr-np-row ox-fr-center">
                <span className="ox-fr-kb-label">{K.who}</span>
                <Seg
                  aria={K.who}
                  small
                  value={R.np.access}
                  items={[
                    { key: 'all', label: K.all },
                    { key: 'owner', label: K.owner, ...(kb.owner ? {} : { off: K.ownerWhy }) },
                  ]}
                  onPick={(a) => set({ np: { ...R.np, access: a }, allSee: a !== 'owner' })}
                />
              </div>
              <span className="ox-fr-note">{K.npNote}</span>
            </div>
          ) : null}
          <div className="ox-fr-kb-access">
            <span className="ox-fr-chip" data-tone={ownerOnly ? 'warn' : 'ok'}>
              <Glyph name={ownerOnly ? 'lock' : 'group'} size={15} />
              {ownerOnly ? K.owner : K.all}
            </span>
            <span>{accessText}</span>
          </div>
          {table ? (
            <div className="ox-fr-np-row">
              <label className="ox-fr-field ox-fr-grow1">
                {K.table}
                <select value={R.table} onChange={(e) => onTable(e.target.value)}>
                  {isNP
                    ? null
                    : tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {format(K.tableOpt, { title: t.title, n: t.rows.length })}
                        </option>
                      ))}
                  <option value={NEW}>{K.newTable}</option>
                </select>
              </label>
              {isNewTable ? (
                <label className="ox-fr-field ox-fr-grow1">
                  {K.newTableTitle}
                  <input
                    value={R.newTitle}
                    maxLength={120}
                    onChange={(e) => set({ newTitle: e.target.value })}
                  />
                </label>
              ) : null}
            </div>
          ) : (
            <label className="ox-fr-field ox-fr-kbhead">
              {K.head}
              <select value={R.head} onChange={(e) => set({ head: e.target.value })}>
                {srcs.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="ox-fr-map">
            <span className="ox-fr-map-title">{mapTitle}</span>
            {R.fields.map((m, i) => (
              <div key={`${m.columnId ?? ''}-${i}`} className="ox-fr-map-row">
                {fixed ? (
                  <span className="ox-fr-map-name">{m.name}</span>
                ) : (
                  <input
                    className="ox-fr-map-input"
                    value={m.name}
                    aria-label={K.fieldAria}
                    maxLength={120}
                    onChange={(e) => setF(i, { name: e.target.value })}
                  />
                )}
                <Glyph name="arrow_back" size={18} className="ox-fr-map-arrow" />
                <select
                  className="ox-fr-map-src"
                  data-missing={missing.includes(m) || undefined}
                  value={m.source}
                  aria-label={format(K.srcAria, { name: m.name })}
                  onChange={(e) => setF(i, { source: e.target.value })}
                >
                  <option value="">{K.none}</option>
                  {srcs.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {!fixed && R.fields.length > 1 ? (
                  <button
                    type="button"
                    className="ox-fr-map-del"
                    aria-label={format(K.delField, { name: m.name })}
                    onClick={() => set({ fields: R.fields.filter((_, j) => j !== i) })}
                  >
                    <Glyph name="close" size={18} />
                  </button>
                ) : null}
              </div>
            ))}
            {!fixed ? (
              <button
                type="button"
                className="ox-fr-link"
                onClick={() =>
                  set({
                    fields: [
                      ...R.fields,
                      {
                        name: format(table ? K.colN : K.fieldN, { n: R.fields.length + 1 }),
                        source: '',
                      },
                    ],
                  })
                }
              >
                <Glyph name="add" size={18} />
                {table ? K.addCol : K.addField}
              </button>
            ) : null}
            {missing.length ? (
              <span role="status" className="ox-fr-warn">
                {format(K.warn, { list: missing.map((m) => `«${m.name}»`).join(', ') })}
              </span>
            ) : null}
          </div>
          <div className="ox-fr-np-row ox-fr-center">
            <span className="ox-fr-kb-label">
              {format(K.pos, { noun: table ? K.rows : K.entries })}
            </span>
            <Seg
              aria={K.posAria}
              small
              value={R.position}
              items={[
                { key: 'top', label: K.top },
                { key: 'bottom', label: K.bottom },
              ]}
              onPick={(pos) => set({ position: pos })}
            />
          </div>
          {shownFields.length ? (
            <div className="ox-fr-pv">
              <span className="ox-fr-note">
                {sample
                  ? format(K.pvFrom, {
                      kind: table ? K.pvRow : K.pvEntry,
                      id: sample.number,
                      at: kbValue(f, sample, '$at', sampleDef),
                    })
                  : K.pvNone}
              </span>
              {table ? (
                <div className="ox-fr-pv-scroll" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        {shownFields.map((m, i) => (
                          <th key={i} scope="col">
                            {m.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {shownFields.map((m, i) => (
                          <td key={i}>{value(m.source)}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ox-fr-pv-entry">
                  <strong>{value(R.head || '$object')}</strong>
                  {shownFields.map((m, i) => (
                    <div key={i} className="ox-fr-pv-line">
                      <span>{m.name}</span>
                      <span>{value(m.source)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <label className="ox-fr-check ox-fr-top">
            <input
              type="checkbox"
              checked={R.showLink && !pub}
              disabled={pub}
              onChange={(e) => set({ showLink: e.target.checked })}
            />
            <span className="ox-fr-col">
              <span>{K.showLink}</span>
              <span className="ox-fr-note">{pub ? K.linkPublic : K.linkNote}</span>
            </span>
          </label>
          {!ownerOnly ? (
            <label className="ox-fr-ack">
              <input
                type="checkbox"
                checked={R.ack}
                onChange={(e) => set({ ack: e.target.checked })}
              />
              <span>{K.ack}</span>
            </label>
          ) : null}
          <span className="ox-fr-note">
            {format(K.note, { period: retainText(f.settings.retainResponsesDays) })}
          </span>
        </>
      ) : null}
    </div>
  );
}
