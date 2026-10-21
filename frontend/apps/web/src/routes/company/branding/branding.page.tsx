// W4.62 · Страница «Оформление» (`company-branding`; эталон design-2026-10-19 «Ортус CRM.dc.html» pg.branding
// :1253–1452, brandingVM :3681–3749; design/docs/18-branding.md). Действующая версия — getTenantBranding,
// сохранение — updateTenantBranding (If-Match), файлы — uploadBrandingAsset. Черновик живёт в странице и
// сбрасывается при смене организации (PD-27); предпросмотр красится цветом черновика, оболочка — сохранённым.
import { buildNav } from '@ortus/domain/nav';
import { Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { navLabel } from '../../../shell/labels.ts';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { afterSave, saveBranding, uploadAsset, useBranding, violationText } from './api.ts';
import { Preview } from './preview.tsx';
import { BR_TEXT, t } from './texts.ts';
import {
  accentView,
  type AssetRef,
  type BaseGroup,
  cantSave,
  type Draft,
  type DraftAction,
  draftErrors,
  draftOf,
  fileProblem,
  FILE_TYPES,
  groupIds,
  identity,
  isDirty,
  menuRows,
  moveItem,
  paletteView,
  reduceDraft,
  termRows,
  type TermForms,
  updateBody,
  versionText,
} from './vm.ts';
import './branding.css';

const ACCEPT = FILE_TYPES.join(',');
const FORMS: readonly (keyof TermForms)[] = ['one', 'plural', 'few', 'many'];

function Head(): ReactElement {
  return (
    <div className="ox-br-head">
      <div className="ox-br-crumb">{BR_TEXT.crumb}</div>
      <h1 id="h-brand" className="ox-br-h1">
        {BR_TEXT.title}
      </h1>
      <p className="ox-br-intro">{BR_TEXT.intro}</p>
    </div>
  );
}

/** Логотип или знак фоном блока (18-branding «Заметки по реализации»: не `<img src>`). */
const bg = (url: string) => ({ backgroundImage: `url("${url}")` });

export default function BrandingPage(): ReactElement {
  const { me, tenantId: id, nav } = useShell();
  const tenantId = id ?? '';
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const busy = useBusy('brand');
  const busyFile = useBusy('brandFile');
  const query = useBranding(tenantId);
  const [state, setState] = useState<{ tenant: string; draft: Draft | null }>({
    tenant: tenantId,
    draft: null,
  });
  const [iconOpen, setIconOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<'app' | 'form' | 'mail'>('app');
  /** Адреса `blob:` файлов, загруженных в этой сессии (показ до перезагрузки, как в эталоне). */
  const [local, setLocal] = useState<Readonly<Record<string, string>>>({});
  const headRef = useRef<HTMLDivElement>(null);

  // Черновик другой организации не переносится (PD-27).
  const draftOwn = state.tenant === tenantId ? state.draft : null;

  const base = useMemo(
    (): BaseGroup[] =>
      buildNav(nav).map((g) => ({
        title: navLabel(g.title),
        items: g.items.map((it) => ({ id: it.key, label: navLabel(it.label), icon: it.icon })),
      })),
    [nav],
  );

  if (query.isPending) {
    return (
      <section
        aria-labelledby="h-brand"
        className="ox-br"
        data-screen-label="Владелец · оформление"
      >
        <Head />
        <div className="ox-br-skel" role="status" aria-label={BR_TEXT.loading}>
          <span />
          <span />
          <span />
        </div>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section
        aria-labelledby="h-brand"
        className="ox-br"
        data-screen-label="Владелец · оформление"
      >
        <Head />
        <div className="ox-br-card ox-br-failed" role="alert">
          <span>{t(BR_TEXT.loadFailed, { error: query.error.message })}</span>
          <button
            type="button"
            className="ox-br-btn"
            onClick={() => {
              void query.refetch();
              headRef.current?.focus();
            }}
          >
            {BR_TEXT.retry}
          </button>
        </div>
      </section>
    );
  }

  const saved = query.data.branding;
  const d = draftOwn ?? draftOf(saved);
  const dirty = isDirty(draftOwn, saved);
  const set = (a: DraftAction) => setState({ tenant: tenantId, draft: reduceDraft(d, a) });
  const acc = accentView(d.accent);
  const who = identity(d);
  const errs = draftErrors(d);
  const blocked = cantSave(dirty, errs, busy);
  const show = (a: AssetRef | null): string | null => (a ? (local[a.id] ?? a.url) : null);
  const logo = show(d.logo);
  const mark = show(d.mark);

  const onFile = async (kind: 'logo' | 'mark', input: HTMLInputElement): Promise<void> => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) {
      toast(problem, 'warn');
      return;
    }
    try {
      const asset = await run('brandFile', () => uploadAsset(api, tenantId, kind, file), null, {
        quiet: ['validation_failed'],
      });
      if (typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(file);
        setLocal((m) => ({ ...m, [asset.id]: url }));
      }
      set({ type: kind, value: { id: asset.id, url: asset.url } });
    } catch (e) {
      const text = violationText(e);
      if (text) toast(text, 'error');
    }
  };

  const onSave = async (): Promise<void> => {
    try {
      const next = await run(
        'brand',
        () => saveBranding(api, tenantId, query.data.etag, updateBody(d)),
        BR_TEXT.saved,
        { quiet: ['revision_mismatch', 'validation_failed'] },
      );
      setState({ tenant: tenantId, draft: null });
      setIconOpen(null);
      await afterSave(qc, tenantId, next);
    } catch (e) {
      // Черновик остаётся (:3745 .catch); 412 — данные перечитываются, 422 — текст нарушения.
      const code = (e as { code?: string }).code;
      if (code === 'revision_mismatch') {
        toast(BR_TEXT.conflict, 'error');
        void query.refetch();
      } else if (code === 'validation_failed') {
        toast(violationText(e) ?? BR_TEXT.errors.name, 'error');
      }
    }
  };

  const ids = groupIds(base, d.order);
  const menu = menuRows(base, d, iconOpen);

  return (
    <section aria-labelledby="h-brand" className="ox-br" data-screen-label="Владелец · оформление">
      <div className="ox-br-head" ref={headRef} tabIndex={-1}>
        <div className="ox-br-crumb">{BR_TEXT.crumb}</div>
        <h1 id="h-brand" className="ox-br-h1">
          {BR_TEXT.title}
        </h1>
        <p className="ox-br-intro">{BR_TEXT.intro}</p>
        <span className="ox-br-version">{versionText(saved, new Date())}</span>
      </div>
      <div className="ox-br-cols">
        <div className="ox-br-main">
          <div className="ox-br-card">
            <h2 className="ox-br-h2">{BR_TEXT.name.title}</h2>
            <label className="ox-br-field">
              {BR_TEXT.name.label}
              <input
                className="ox-br-input"
                value={d.name}
                maxLength={60}
                onChange={(e) => set({ type: 'name', value: e.target.value })}
              />
              <span className="ox-br-hint">{BR_TEXT.name.hint}</span>
            </label>
            <label className="ox-br-field">
              <span className="ox-br-field-top">
                {BR_TEXT.name.short}
                <span className="ox-br-count" data-over={who.over || undefined}>
                  {who.count}
                </span>
              </span>
              <input
                className="ox-br-input"
                value={d.short}
                placeholder={BR_TEXT.name.placeholder}
                onChange={(e) => set({ type: 'short', value: e.target.value })}
              />
              <span className="ox-br-hint">{BR_TEXT.name.shortHint}</span>
            </label>
          </div>

          <div className="ox-br-card">
            <h2 className="ox-br-h2">{BR_TEXT.logo.title}</h2>
            <div className="ox-br-files">
              <div className="ox-br-file">
                <span className="ox-br-label">{BR_TEXT.logo.logo}</span>
                <div className="ox-br-drop" data-kind="logo">
                  {logo ? (
                    <span
                      role="img"
                      aria-label={BR_TEXT.logo.logoImg}
                      className="ox-br-logo"
                      style={bg(logo)}
                    />
                  ) : (
                    <span className="ox-br-drop-empty">{BR_TEXT.logo.logoEmpty}</span>
                  )}
                </div>
                <FileButtons
                  has={!!logo}
                  busy={busyFile}
                  onFile={(el) => void onFile('logo', el)}
                  onRemove={() => set({ type: 'logo', value: null })}
                />
              </div>
              <div className="ox-br-file">
                <span className="ox-br-label">{BR_TEXT.logo.mark}</span>
                <div className="ox-br-drop" data-kind="mark">
                  {mark ? (
                    <span
                      role="img"
                      aria-label={BR_TEXT.logo.markImg}
                      className="ox-br-mark"
                      style={bg(mark)}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="ox-br-letter"
                      style={{ background: acc.vars.accent }}
                    >
                      {who.letter}
                    </span>
                  )}
                  <span className="ox-br-drop-note">{BR_TEXT.logo.markEmpty}</span>
                </div>
                <FileButtons
                  has={!!mark}
                  busy={busyFile}
                  onFile={(el) => void onFile('mark', el)}
                  onRemove={() => set({ type: 'mark', value: null })}
                />
              </div>
            </div>
          </div>

          <div className="ox-br-card">
            <div className="ox-br-titled">
              <h2 className="ox-br-h2">{BR_TEXT.accent.title}</h2>
              <span className="ox-br-sub">{BR_TEXT.accent.hint}</span>
            </div>
            <div role="radiogroup" aria-label={BR_TEXT.accent.palette} className="ox-br-palette">
              {paletteView(d.accent).map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  role="radio"
                  aria-checked={c.selected}
                  title={c.label}
                  className="ox-br-swatch"
                  onClick={() => set({ type: 'accent', value: c.hex })}
                >
                  <span
                    className="ox-br-swatch-color"
                    style={{
                      background: c.hex,
                      boxShadow: c.selected ? `0 0 0 2px #FFFFFF, 0 0 0 4px ${c.hex}` : 'none',
                    }}
                  />
                  <span className="ox-br-swatch-label">{c.label}</span>
                </button>
              ))}
            </div>
            <div className="ox-br-hexrow">
              <label className="ox-br-field ox-br-hexfield">
                {BR_TEXT.accent.hex}
                <span className="ox-br-hexbox">
                  <input
                    className="ox-br-hex"
                    value={d.accent}
                    maxLength={7}
                    spellCheck={false}
                    aria-label={BR_TEXT.accent.hexAria}
                    onChange={(e) => set({ type: 'accent', value: e.target.value })}
                  />
                  <input
                    type="color"
                    className="ox-br-picker"
                    value={acc.picker.toLowerCase()}
                    aria-label={BR_TEXT.accent.picker}
                    onChange={(e) => set({ type: 'accent', value: e.target.value })}
                  />
                </span>
              </label>
            </div>
            {acc.state === 'ok' ? (
              <div role="status" className="ox-br-note" data-tone="ok">
                <Icon name="check_circle" size={18} />
                <span>{acc.text}</span>
              </div>
            ) : acc.state === 'fix' ? (
              <div role="status" className="ox-br-note" data-tone="warn">
                <Icon name="contrast" size={18} />
                <span className="ox-br-note-text">{acc.text}</span>
                <span
                  aria-hidden="true"
                  className="ox-br-fixed"
                  style={{ background: acc.fixed }}
                />
              </div>
            ) : (
              <div role="alert" className="ox-br-note" data-tone="danger">
                <Icon name="error" size={18} />
                <span>{acc.text}</span>
              </div>
            )}
            <div className="ox-br-statuses">
              {BR_TEXT.accent.statuses}
              <span className="ox-br-chip" data-tone="ok">
                <Icon name="check_circle" size={15} />
                {BR_TEXT.accent.accepted}
              </span>
              <span className="ox-br-chip" data-tone="warn">
                <Icon name="pending" size={15} />
                {BR_TEXT.accent.pending}
              </span>
              <span className="ox-br-chip" data-tone="danger">
                <Icon name="block" size={15} />
                {BR_TEXT.accent.blocked}
              </span>
            </div>
          </div>

          <div className="ox-br-card" data-flush="true">
            <div className="ox-br-cardhead">
              <h2 className="ox-br-h2">{BR_TEXT.terms.title}</h2>
              <span className="ox-br-sub">{BR_TEXT.terms.hint}</span>
            </div>
            {termRows(d).map((tm) => (
              <div key={tm.key} className="ox-br-term">
                <div className="ox-br-term-top">
                  <strong className="ox-br-term-label">{tm.label}</strong>
                  <span className="ox-br-term-where">{tm.where}</span>
                  {tm.custom ? (
                    <button
                      type="button"
                      className="ox-br-btn"
                      data-size="sm"
                      onClick={() => set({ type: 'termReset', key: tm.key })}
                    >
                      {BR_TEXT.terms.reset}
                    </button>
                  ) : null}
                </div>
                <div className="ox-br-forms">
                  {FORMS.map((f) => (
                    <TermField
                      key={f}
                      form={f}
                      value={tm[f]}
                      onChange={(value) => set({ type: 'term', key: tm.key, form: f, value })}
                    />
                  ))}
                </div>
                <span className="ox-br-example">{tm.example}</span>
              </div>
            ))}
          </div>

          <div className="ox-br-card" data-flush="true">
            <div className="ox-br-cardhead">
              <h2 className="ox-br-h2">{BR_TEXT.menu.title}</h2>
              <span className="ox-br-sub">{BR_TEXT.menu.hint}</span>
            </div>
            {menu.map((g, gi) => (
              <div key={g.title}>
                <div className="ox-br-group">{g.title}</div>
                {g.rows.map((r, j) => (
                  <div
                    key={r.id}
                    className="ox-br-row"
                    data-first={j === 0 || undefined}
                    data-hidden={r.hidden || undefined}
                  >
                    <div className="ox-br-row-main">
                      <button
                        type="button"
                        className="ox-br-iconbtn"
                        aria-expanded={r.open}
                        aria-label={t(BR_TEXT.menu.iconButton, { def: r.def })}
                        onClick={() => setIconOpen(r.open ? null : r.id)}
                      >
                        <Icon name={r.icon} size={20} className="ox-br-accent-icon" />
                      </button>
                      <input
                        className="ox-br-input ox-br-rowlabel"
                        value={r.label}
                        placeholder={r.def}
                        aria-label={t(BR_TEXT.menu.labelAria, { def: r.def })}
                        onChange={(e) =>
                          set({ type: 'item', id: r.id, patch: { label: e.target.value } })
                        }
                      />
                      <div className="ox-br-moves">
                        <button
                          type="button"
                          className="ox-br-square"
                          disabled={r.cantUp}
                          aria-label={BR_TEXT.menu.up}
                          onClick={() => set({ type: 'order', value: moveItem(ids, gi, j, -1) })}
                        >
                          <Icon name="arrow_upward" size={20} />
                        </button>
                        <button
                          type="button"
                          className="ox-br-square"
                          disabled={r.cantDown}
                          aria-label={BR_TEXT.menu.down}
                          onClick={() => set({ type: 'order', value: moveItem(ids, gi, j, 1) })}
                        >
                          <Icon name="arrow_downward" size={20} />
                        </button>
                      </div>
                      {r.locked ? (
                        <span className="ox-br-locked">
                          <Icon name="lock" size={16} />
                          {BR_TEXT.menu.locked}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="ox-br-vis"
                          aria-pressed={!r.hidden}
                          data-hidden={r.hidden || undefined}
                          onClick={() =>
                            set({ type: 'item', id: r.id, patch: { hidden: !r.hidden } })
                          }
                        >
                          <Icon name={r.hidden ? 'visibility_off' : 'visibility'} size={18} />
                          {r.hidden ? BR_TEXT.menu.hidden : BR_TEXT.menu.shown}
                        </button>
                      )}
                    </div>
                    {r.open ? (
                      <div
                        role="radiogroup"
                        aria-label={BR_TEXT.menu.icons}
                        className="ox-br-icons"
                      >
                        {r.icons.map((ic) => (
                          <button
                            key={ic}
                            type="button"
                            role="radio"
                            aria-checked={ic === r.icon}
                            aria-label={ic}
                            className="ox-br-square"
                            data-selected={ic === r.icon || undefined}
                            onClick={() => {
                              set({ type: 'item', id: r.id, patch: { icon: ic } });
                              setIconOpen(null);
                            }}
                          >
                            <Icon name={ic} size={20} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="ox-br-card" data-gap="12">
            <div className="ox-br-titled">
              <h2 className="ox-br-h2">{BR_TEXT.public.title}</h2>
              <span className="ox-br-sub">{BR_TEXT.public.hint}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={d.poweredBy}
              className="ox-br-switch"
              onClick={() => set({ type: 'powered' })}
            >
              <span className="ox-br-switch-text">
                <span className="ox-br-switch-title">{BR_TEXT.public.powered}</span>
                <span className="ox-br-hint">{BR_TEXT.public.poweredHint}</span>
              </span>
              <span aria-hidden="true" className="ox-br-track" data-on={d.poweredBy || undefined}>
                <span className="ox-br-knob" />
              </span>
            </button>
          </div>
        </div>

        <Preview
          draft={d}
          base={base}
          vars={acc.vars}
          who={who}
          logo={logo}
          mark={mark}
          owner={me.displayName}
          tab={tab}
          onTab={setTab}
        />
      </div>

      <div className="ox-br-panel">
        {errs.length ? (
          <div role="alert" className="ox-br-errs">
            {errs.map((text) => (
              <span key={text}>{t(BR_TEXT.panel.error, { text })}</span>
            ))}
          </div>
        ) : null}
        <div className="ox-br-actions">
          <span className="ox-br-state" data-dirty={dirty || undefined}>
            {dirty ? BR_TEXT.panel.dirty : BR_TEXT.panel.clean}
          </span>
          <button
            type="button"
            className="ox-br-btn"
            data-variant="text"
            onClick={() => set({ type: 'standard' })}
          >
            {BR_TEXT.panel.standard}
          </button>
          <button
            type="button"
            className="ox-br-btn"
            data-size="lg"
            disabled={!dirty}
            onClick={() => {
              setState({ tenant: tenantId, draft: null });
              setIconOpen(null);
            }}
          >
            {BR_TEXT.panel.discard}
          </button>
          <button
            type="button"
            className="ox-br-btn"
            data-variant="primary"
            data-size="lg"
            disabled={blocked}
            onClick={() => void onSave()}
          >
            <Icon name="save" size={18} />
            {BR_TEXT.panel.save}
          </button>
        </div>
      </div>
    </section>
  );
}

function FileButtons(p: {
  has: boolean;
  busy: boolean;
  onFile: (input: HTMLInputElement) => void;
  onRemove: () => void;
}): ReactElement {
  return (
    <div className="ox-br-filebtns">
      <label className="ox-br-btn ox-br-upload" data-busy={p.busy || undefined}>
        <Icon name="upload" size={18} />
        {BR_TEXT.logo.upload}
        <input
          type="file"
          accept={ACCEPT}
          className="ox-br-fileinput"
          disabled={p.busy}
          onChange={(e) => p.onFile(e.currentTarget)}
        />
      </label>
      {p.has ? (
        <button type="button" className="ox-br-btn" data-variant="danger" onClick={p.onRemove}>
          {BR_TEXT.logo.remove}
        </button>
      ) : null}
    </div>
  );
}

const FORM_LABEL: Record<keyof TermForms, string> = {
  one: BR_TEXT.terms.one,
  plural: BR_TEXT.terms.plural,
  few: BR_TEXT.terms.few,
  many: BR_TEXT.terms.many,
};

function TermField(p: {
  form: keyof TermForms;
  value: string;
  onChange: (v: string) => void;
}): ReactElement {
  return (
    <label className="ox-br-termfield">
      {FORM_LABEL[p.form]}
      <input
        className="ox-br-input ox-br-terminput"
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
      />
    </label>
  );
}
