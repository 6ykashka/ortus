// W4.22 · Список форм (`forms-list`, dc:28–84, listVM dc:748–780): «Создание формы» (плитки и «Все шаблоны»),
// «Формы и группы» (создание группы, фильтры, «По группам»), строки форм с чипом, ответами и меню, пустые состояния.
// Группы — общие для организации на сервере (FM-03, Q-W4.00-forms-7), фильтры — на клиенте, как у эталона.
import type { components } from '@ortus/api-client';
import { format, forms as F, shell } from '@ortus/texts';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { commands, formEtag, useForms as useFormList, useGroups, useTemplates } from './api.ts';
import { useForms } from './ctx.tsx';
import { chipOf, dayMonth, templateMeta, TCOL, uniqName } from './model.ts';
import { Chip, Failed, Glyph, Menu, type MenuItem } from './parts.tsx';

type S = components['schemas'];

/** Плитки «Создание формы» (TILES dc:489). */
const TILES = ['blank', 'tpl-profile', 'tpl-feedback', 'tpl-request', 'tpl-event'];
/** Разделы «Все шаблоны» (TCAT dc:488). */
const CATS: readonly S['FormTemplate']['category'][] = [
  'basic',
  'survey',
  'people',
  'quiz',
  'industry',
];

/** Отраслевой модуль формы или шаблона: имя и значок (INDUSTRY models.js:24–60; «Общая» — dynamic_form). */
const MODULES: Readonly<Record<string, { name: string; icon: string }>> = {
  fleet: { name: F.list.modules.fleet, icon: 'local_shipping' },
  spa: { name: F.list.modules.spa, icon: 'spa' },
  repairs: { name: F.list.modules.repairs, icon: 'construction' },
};
export const moduleName = (k: string | null | undefined): string =>
  (k && MODULES[k]?.name) || F.list.general;
export const moduleIcon = (k: string | null | undefined): string =>
  (k && MODULES[k]?.icon) || 'dynamic_form';

/** Цвет плитки шаблона (tile dc:752): отраслевой — CRM, пустая — «Выбор», опросы и тесты — «Другие». */
function tileColor(t: S['FormTemplate']): readonly [string, string] {
  if (t.moduleKey) return TCOL.crm;
  if (t.id === 'blank') return TCOL.choice;
  if (t.category === 'survey' || t.category === 'quiz') return TCOL.other;
  return TCOL.text;
}

type Owner = 'all' | 'mine';
type Status = 'all' | 'draft' | 'open' | 'closed';

const stKey = (f: S['Form']): Exclude<Status, 'all'> =>
  f.status === 'draft' || !f.publishedVersionNumber
    ? 'draft'
    : f.status === 'closed'
      ? 'closed'
      : 'open';

export function FormsList(): ReactElement {
  const api = useApi();
  const { tenantId, go, cmd, busy, menu, setMenu } = useForms();
  const can = useCan();
  // Организация только для чтения (подписка, модуль): создание и группы закрыты, как правка формы.
  const { readOnly } = useShell();
  const canCreate = can('forms.create') && !readOnly;
  const canManage = can('forms.manage') && !readOnly;
  const list = useFormList(tenantId);
  const [owner, setOwner] = useState<Owner>('all');
  const mine = useFormList(tenantId, true, owner === 'mine');
  const groups = useGroups(tenantId);
  const templates = useTemplates(tenantId, canCreate);
  const [tplQ, setTplQ] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [byGroup, setByGroup] = useState(false);
  const [gNew, setGNew] = useState<{ name: string; err: string } | null>(null);

  const forms = list.data ?? [];
  const names = forms.map((f) => f.name);
  const tplOpen = menu === 'tpl';

  const create = async (t: S['FormTemplate']) => {
    if (busy || !t.available) return;
    setMenu(null);
    setTplQ('');
    const name = uniqName(names, t.id === 'blank' ? F.list.newName : t.name);
    const body: S['FormCreate'] = { name, orgUnitId: null, templateId: t.id };
    const r = await cmd(
      { op: 'createForm', body },
      (key) => commands.createForm(api, tenantId, body, key),
      format(F.toasts.created, { name }),
    );
    if (r.ok && r.data) go({ form: r.data.id });
  };

  const duplicate = async (f: S['Form']) => {
    if (busy) return;
    setMenu(null);
    const name = uniqName(names, format(F.list.copyName, { name: f.name }));
    const body: S['FormCreate'] = { name, orgUnitId: f.orgUnitId, sourceFormId: f.id };
    await cmd(
      { op: 'createForm', body },
      (key) => commands.createForm(api, tenantId, body, key),
      format(F.toasts.copied, { name }),
    );
  };

  const patch = async (f: S['Form'], body: S['FormPatch'], ok: string | null) => {
    if (busy) return;
    setMenu(null);
    await cmd(
      { op: 'updateForm', id: f.id, body },
      async (key) =>
        commands.updateForm(api, tenantId, f.id, await formEtag(api, tenantId, f.id), body, key),
      ok,
    );
  };

  const toggleClosed = (f: S['Form']) => {
    const close = f.status !== 'closed';
    void patch(
      f,
      { status: close ? 'closed' : 'open' },
      format(close ? F.toasts.closed : F.toasts.reopened, { name: f.name }),
    );
  };

  const saveGroup = async () => {
    if (!gNew || busy) return;
    const nm = gNew.name.trim();
    if (nm.length < 2) return setGNew({ ...gNew, err: F.list.groupShort });
    if ((groups.data ?? []).some((g) => g.name.toLowerCase() === nm.toLowerCase()))
      return setGNew({ ...gNew, err: F.list.groupTaken });
    const r = await cmd(
      { op: 'createFormGroup', name: nm },
      (key) => commands.createGroup(api, tenantId, nm, key),
      format(F.list.groupCreated, { name: nm }),
      { local: true },
    );
    if (r.ok) {
      setGNew(null);
      setByGroup(true);
    } else if (r.code === 'validation_failed') setGNew({ ...gNew, err: r.error ?? '' });
  };

  const deleteGroup = async (g: S['FormGroup']) => {
    if (busy) return;
    await cmd(
      { op: 'deleteFormGroup', id: g.id },
      (key) => commands.deleteGroup(api, tenantId, g.id, key),
      null,
    );
  };

  // Фильтры (fl dc:756): поиск по имени, «Мои формы», статус.
  const term = q.trim().toLowerCase();
  const source = owner === 'mine' ? (mine.data ?? []) : forms;
  const fl = source.filter(
    (f) =>
      (!term || f.name.toLowerCase().includes(term)) && (status === 'all' || stKey(f) === status),
  );
  const gs = groups.data ?? [];
  const groupOf = (f: S['Form']) => gs.find((g) => g.id === f.groupId);

  const row = (f: S['Form'], i: number) => {
    const g = groupOf(f);
    const moving = menu === `move:${f.id}`;
    const open = menu === `row:${f.id}` || moving;
    const n = f.responseCount;
    const items: MenuItem[] = moving
      ? [
          {
            label: F.list.noGroup,
            icon: g ? 'folder_off' : 'check',
            onClick: () => void patch(f, { groupId: null }, null),
          },
          ...gs.map((x) => ({
            label: x.name,
            icon: g?.id === x.id ? 'check' : 'folder',
            onClick: () => void patch(f, { groupId: x.id }, null),
          })),
        ]
      : [
          { label: F.list.menu.open, icon: 'edit', onClick: () => go({ form: f.id }) },
          {
            label: format(F.list.menu.responses, { n }),
            icon: 'inbox',
            onClick: () => go({ form: f.id, tab: 'responses' }),
          },
          ...(f.my.manage && !readOnly
            ? [
                ...(f.my.create
                  ? [
                      {
                        label: F.list.menu.duplicate,
                        icon: 'content_copy',
                        onClick: () => void duplicate(f),
                      },
                    ]
                  : []),
                {
                  label: F.list.menu.move,
                  icon: 'drive_file_move',
                  onClick: () => setMenu(`move:${f.id}`),
                },
                ...(f.publishedVersionNumber
                  ? [
                      {
                        label: f.status === 'closed' ? F.list.menu.reopen : F.list.menu.close,
                        icon: f.status === 'closed' ? 'play_circle' : 'block',
                        onClick: () => toggleClosed(f),
                      },
                    ]
                  : []),
              ]
            : []),
        ];
    const meta = [
      moduleName(f.moduleKey),
      g && !byGroup ? format(F.list.group, { name: g.name }) : '',
      f.owner.displayName,
      format(F.list.updated, { date: dayMonth(f.updatedAt) }),
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div key={f.id} className="ox-fm-row" data-first={i === 0 ? '' : undefined}>
        <button type="button" className="ox-fm-row-open" onClick={() => go({ form: f.id })}>
          <span className="ox-fm-row-icon" aria-hidden="true">
            <Glyph name={moduleIcon(f.moduleKey)} size={20} />
          </span>
          <span className="ox-fm-row-text">
            <strong>{f.name}</strong>
            <span>{meta}</span>
          </span>
        </button>
        <Chip chip={chipOf(f)} />
        <span className="ox-fm-row-resp">{format(F.list.responses, { n })}</span>
        <div className="ox-fm-anchor">
          <button
            type="button"
            className="ox-fm-icon-btn"
            data-size="36"
            aria-label={format(F.list.rowMenu, { name: f.name })}
            aria-expanded={open}
            onClick={() => setMenu(open ? null : `row:${f.id}`)}
          >
            <Glyph name="more_horiz" size={20} />
          </button>
          {open ? (
            <Menu
              className="ox-fm-menu-row"
              items={items}
              {...(moving ? { title: F.list.moveTitle } : {})}
              onClose={() => setMenu(null)}
            />
          ) : null}
        </div>
      </div>
    );
  };

  type Block = {
    key: string;
    title?: string;
    count?: number;
    del?: S['FormGroup'];
    rows: S['Form'][];
  };
  let blocks: Block[] = [];
  if (byGroup) {
    blocks = [
      ...gs.map((g) => ({
        key: g.id,
        title: g.name,
        rows: fl.filter((f) => f.groupId === g.id),
        ...(canManage && !forms.some((f) => f.groupId === g.id) ? { del: g } : {}),
      })),
      {
        key: '',
        title: F.list.noGroup,
        rows: fl.filter((f) => !gs.some((g) => g.id === f.groupId)),
      },
    ].map((b) => ({ ...b, count: b.rows.length }));
  } else if (fl.length) blocks = [{ key: 'all', rows: fl }];

  const none = !forms.length;
  const empty = !byGroup && !fl.length;
  const blank = templates.data?.find((t) => t.id === 'blank');
  const tq = tplQ.trim().toLowerCase();
  const tplGroups = CATS.map((c) => ({
    cat: c,
    items: (templates.data ?? []).filter(
      (t) => t.category === c && (!tq || t.name.toLowerCase().includes(tq)),
    ),
  })).filter((g) => g.items.length);

  return (
    <div className="ox-fm-list">
      <div className="ox-fm-titles">
        <h1 id="fm-h" className="ox-fm-h1" tabIndex={-1}>
          {shell.nav.items.forms}
        </h1>
        <p className="ox-fm-sub">{F.list.subtitle}</p>
      </div>
      {canCreate ? (
        <section aria-labelledby="fm-h-new" className="ox-fm-new">
          <h2 id="fm-h-new" className="ox-fm-h2">
            {F.list.create}
          </h2>
          {templates.isError ? (
            <Failed q={templates} />
          ) : (
            <div className="ox-fm-tiles">
              {TILES.map((id) => templates.data?.find((t) => t.id === id))
                .filter((t): t is S['FormTemplate'] => !!t)
                .map((t) => {
                  const [bg, fg] = tileColor(t);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="ox-fm-tile"
                      disabled={!t.available}
                      title={
                        t.available
                          ? undefined
                          : format(F.list.moduleOff, { name: moduleName(t.moduleKey) })
                      }
                      onClick={() => void create(t)}
                    >
                      <span
                        className="ox-fm-tile-icon"
                        aria-hidden="true"
                        style={{ background: bg, color: fg }}
                      >
                        <Glyph name={t.icon} size={20} />
                      </span>
                      <span className="ox-fm-tile-name">
                        {t.id === 'blank' ? F.list.blank : t.name}
                      </span>
                    </button>
                  );
                })}
              {templates.data ? (
                <div className="ox-fm-anchor ox-fm-tpl">
                  <button
                    type="button"
                    className="ox-fm-tpl-btn"
                    aria-expanded={tplOpen}
                    onClick={() => setMenu(tplOpen ? null : 'tpl')}
                  >
                    {format(F.list.allTemplates, { n: templates.data.length })}
                    <Glyph name="expand_more" size={20} />
                  </button>
                  {tplOpen ? (
                    <div className="ox-fm-tpl-pop">
                      <input
                        type="search"
                        value={tplQ}
                        onChange={(e) => setTplQ(e.target.value)}
                        placeholder={F.list.tplSearch}
                        aria-label={F.list.tplSearchAria}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setMenu(null);
                        }}
                      />
                      {tplGroups.map((g) => (
                        <div key={g.cat} className="ox-fm-tpl-group">
                          <span className="ox-fm-tpl-cat">{F.list.tplCats[g.cat]}</span>
                          {g.items.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              className="ox-fm-tpl-item"
                              disabled={!t.available}
                              onClick={() => void create(t)}
                            >
                              <Glyph name={t.icon} size={20} style={{ color: tileColor(t)[1] }} />
                              <span className="ox-fm-tpl-text">
                                <span className="ox-fm-tpl-name">
                                  {t.id === 'blank' ? F.list.blank : t.name}
                                </span>
                                <span className="ox-fm-tpl-meta">
                                  {templateMeta(t, t.moduleKey ? moduleName(t.moduleKey) : null)}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                      {!tplGroups.length ? (
                        <span className="ox-fm-tpl-none">{F.list.tplNone}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
      <section aria-labelledby="fm-h-list" className="ox-fm-forms">
        <div className="ox-fm-forms-head">
          <h2 id="fm-h-list" className="ox-fm-h2">
            {F.list.groups}
          </h2>
          {canManage ? (
            <button
              type="button"
              className="ox-fm-btn"
              data-size="38"
              onClick={() => setGNew({ name: '', err: '' })}
            >
              <Glyph name="create_new_folder" size={18} />
              {F.list.groupNew}
            </button>
          ) : null}
        </div>
        {gNew ? (
          <div className="ox-fm-gnew">
            <input
              value={gNew.name}
              maxLength={80}
              onChange={(e) => setGNew({ name: e.target.value, err: '' })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveGroup();
                if (e.key === 'Escape') setGNew(null);
              }}
              placeholder={F.list.groupPlaceholder}
              aria-label={F.list.groupAria}
              autoFocus
            />
            <button
              type="button"
              className="ox-fm-btn"
              data-variant="primary"
              onClick={() => void saveGroup()}
            >
              {F.list.groupCreate}
            </button>
            <button type="button" className="ox-fm-btn" data-plain="" onClick={() => setGNew(null)}>
              {F.list.cancel}
            </button>
            {gNew.err ? (
              <span role="alert" className="ox-fm-gnew-err">
                {gNew.err}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="ox-fm-filters">
          <label className="ox-fm-search">
            <Glyph name="search" size={18} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={F.list.search}
              aria-label={F.list.searchAria}
            />
          </label>
          <select
            className="ox-fm-select"
            value={owner}
            onChange={(e) => setOwner(e.target.value as Owner)}
            aria-label={F.list.ownerAria}
          >
            <option value="all">{F.list.owners.all}</option>
            <option value="mine">{F.list.owners.mine}</option>
          </select>
          <select
            className="ox-fm-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            aria-label={F.list.statusAria}
          >
            <option value="all">{F.list.statuses.all}</option>
            <option value="draft">{F.list.statuses.draft}</option>
            <option value="open">{F.list.statuses.open}</option>
            <option value="closed">{F.list.statuses.closed}</option>
          </select>
          <button
            type="button"
            className="ox-fm-btn ox-fm-bygroup"
            aria-pressed={byGroup}
            onClick={() => setByGroup(!byGroup)}
          >
            <Glyph name="folder_copy" size={18} />
            {F.list.byGroup}
          </button>
        </div>
        {list.isPending || (owner === 'mine' && mine.isPending) ? (
          <div className="ox-fm-loading" role="status">
            {F.loading}
          </div>
        ) : list.isError ? (
          <Failed q={list} />
        ) : owner === 'mine' && mine.isError ? (
          <Failed q={mine} />
        ) : (
          <>
            {empty ? (
              <div className="ox-fm-empty">
                <Glyph name="dynamic_form" size={36} />
                <strong>{none ? F.list.empty.noneTitle : F.list.empty.title}</strong>
                <span>{none ? F.list.empty.noneText : F.list.empty.text}</span>
                {none ? (
                  canCreate && blank ? (
                    <button type="button" className="ox-fm-btn" onClick={() => void create(blank)}>
                      {F.list.blank}
                    </button>
                  ) : null
                ) : (
                  <button
                    type="button"
                    className="ox-fm-btn"
                    onClick={() => {
                      setQ('');
                      setOwner('all');
                      setStatus('all');
                    }}
                  >
                    {F.list.empty.reset}
                  </button>
                )}
              </div>
            ) : null}
            {blocks.map((b) => (
              <div key={b.key} className="ox-fm-block">
                {b.title !== undefined ? (
                  <div className="ox-fm-block-head">
                    <Glyph name="folder" size={20} />
                    <strong>{b.title}</strong>
                    <span>{b.count}</span>
                    {b.del ? (
                      <button
                        type="button"
                        className="ox-fm-icon-btn"
                        data-size="30"
                        data-danger=""
                        aria-label={F.list.deleteGroup}
                        onClick={() => void deleteGroup(b.del as S['FormGroup'])}
                      >
                        <Glyph name="delete" size={18} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="ox-fm-rows">
                  {b.rows.map(row)}
                  {!b.rows.length ? (
                    <div className="ox-fm-rows-empty">{F.list.groupEmpty}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
