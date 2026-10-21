// W4.62 · Предпросмотр «Оформления» (эталон :1373–1438, brandingVM :3722, :3738–3742): приложение (шапка, первые
// 7 пунктов меню черновика, «Приёмка смен»), публичная форма и письмо. Цвета — из цвета черновика, не из :root.
import type { ReactElement } from 'react';

import { BR_TEXT, t } from './texts.ts';
import { type BaseGroup, type Draft, type IdentityView, previewView } from './vm.ts';

type Tab = 'app' | 'form' | 'mail';
const TABS: readonly (readonly [Tab, string])[] = [
  ['app', BR_TEXT.preview.app],
  ['form', BR_TEXT.preview.form],
  ['mail', BR_TEXT.preview.mail],
];

/** Иконка кегля без токена @ortus/ui (17 и 14 px эталона :1391, :1397). */
function Glyph({ name, size }: { name: string; size: number }): ReactElement {
  return (
    <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: size }}>
      {name}
    </span>
  );
}

const bg = (url: string) => ({ backgroundImage: `url("${url}")` });

export function Preview(p: {
  draft: Draft;
  base: readonly BaseGroup[];
  vars: { accent: string; hover: string; soft: string; tint: string };
  who: IdentityView;
  logo: string | null;
  mark: string | null;
  owner: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
}): ReactElement {
  const P = BR_TEXT.preview;
  const v = previewView(p.base, p.draft);
  const accent = { background: p.vars.accent };
  /** Логотип, иначе буква на цвете и название (форма и письмо, :1410–1411, :1427–1428). */
  const brandLine = (h: number, w: number) =>
    p.logo ? (
      <span
        aria-hidden="true"
        className="ox-pv-logo"
        style={{ ...bg(p.logo), height: h, width: w }}
      />
    ) : (
      <>
        <span
          aria-hidden="true"
          className="ox-pv-letter"
          style={{ ...accent, width: h, height: h }}
        >
          {p.who.letter}
        </span>
        <span className="ox-pv-strong">{p.who.nameText}</span>
      </>
    );
  return (
    <aside aria-label={P.title} className="ox-pv">
      <div className="ox-pv-top">
        <h2 className="ox-pv-h2">{P.title}</h2>
        <div role="group" aria-label={P.group} className="ox-pv-tabs">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="ox-pv-tab"
              aria-pressed={p.tab === k}
              onClick={() => p.onTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {p.tab === 'app' ? (
        <div className="ox-pv-app">
          <div className="ox-pv-bar">
            {p.logo ? (
              <span
                aria-hidden="true"
                className="ox-pv-logo"
                style={{ ...bg(p.logo), height: 28, width: 130 }}
              />
            ) : (
              <>
                {p.mark ? (
                  <span aria-hidden="true" className="ox-pv-mark" style={bg(p.mark)} />
                ) : (
                  <span aria-hidden="true" className="ox-pv-letter" data-size="28" style={accent}>
                    {p.who.letter}
                  </span>
                )}
                <span className="ox-pv-strong">{p.who.shown}</span>
              </>
            )}
            <span className="ox-pv-org">{p.who.nameText}</span>
          </div>
          <div className="ox-pv-body">
            <div className="ox-pv-nav">
              {v.nav.map((n, i) => (
                <div
                  key={n.id}
                  className="ox-pv-item"
                  data-active={i === 0 || undefined}
                  style={i === 0 ? { background: p.vars.soft, color: p.vars.accent } : undefined}
                >
                  <Glyph name={n.icon} size={17} />
                  <span className="ox-pv-item-label">{n.label}</span>
                </div>
              ))}
            </div>
            <div className="ox-pv-content">
              <strong className="ox-pv-title">{v.reviewTitle}</strong>
              <span className="ox-pv-muted">{v.count}</span>
              <div className="ox-pv-card">
                <span className="ox-pv-chip">
                  <Glyph name="pending" size={14} />
                  {BR_TEXT.accent.pending}
                </span>
                <span className="ox-pv-link" style={{ color: p.vars.accent }}>
                  {P.open}
                </span>
              </div>
              <span className="ox-pv-accept" style={accent}>
                {P.accept}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {p.tab === 'form' ? (
        <div className="ox-pv-formwrap" style={{ background: p.vars.tint }}>
          <div className="ox-pv-form">
            <div className="ox-pv-brand">{brandLine(30, 150)}</div>
            <strong className="ox-pv-formtitle">{P.formTitle}</strong>
            <label className="ox-pv-flabel">
              {P.formName}
              <span className="ox-pv-fbox" />
            </label>
            <label className="ox-pv-flabel">
              {P.formPhone}
              <span className="ox-pv-fbox" style={{ border: `2px solid ${p.vars.accent}` }} />
            </label>
            <span className="ox-pv-submit" style={accent}>
              {P.formSubmit}
            </span>
            {p.draft.poweredBy ? <span className="ox-pv-powered">{P.powered}</span> : null}
          </div>
        </div>
      ) : null}

      {p.tab === 'mail' ? (
        <div className="ox-pv-mailwrap">
          <span className="ox-pv-muted">{t(P.mailFrom, { name: p.who.nameText })}</span>
          <div className="ox-pv-mail" style={{ borderTopColor: p.vars.accent }}>
            <div className="ox-pv-brand">{brandLine(28, 150)}</div>
            <span className="ox-pv-mailtext">
              {t(P.mailBody, { owner: p.owner || P.mailOwner, name: p.who.nameText })}
            </span>
            <span className="ox-pv-mailbtn" style={accent}>
              {P.mailAccept}
            </span>
            <span className="ox-pv-small">{P.mailFooter}</span>
            {p.draft.poweredBy ? <span className="ox-pv-small">{P.powered}</span> : null}
          </div>
        </div>
      ) : null}
      <span className="ox-pv-note">{P.note}</span>
    </aside>
  );
}
