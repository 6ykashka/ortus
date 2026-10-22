// W4.22 · Страница «Формы и опросы» (`forms`; эталон design-2026-10-19 «Формы и опросы.dc.html» dc:25–468, в CRM —
// dc-import в section «Формы и опросы» с крошкой «{организация} / Общие модули», crm:1586–1588). Список форм или
// редактор по `?form=` (ADR-0001), вкладка — `&tab=`; предпросмотр и диалоги — состояние редактора. Данные — тег Forms
// (W4.05, backend W4.21).
import { forms as F, shell } from '@ortus/texts';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useShell } from '../../../shell/context.tsx';
import { type FormsSearch, FormsProvider, searchOf, useForms } from './ctx.tsx';
import { Editor } from './editor.tsx';
import { FormsList } from './list.tsx';
import { Glyph, MenuBackdrop } from './parts.tsx';
import './forms.css';

/**
 * Баннер ошибки команды (текст сервера): права, конфликт, отсутствие, проверка вне поля. Новый текст прокручивается
 * в видимую область.
 */
function ErrBanner(): ReactElement | null {
  const { err, setErr } = useForms();
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = box.current;
    if (err && el && typeof el.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'nearest' });
  }, [err]);
  if (!err) return null;
  return (
    <div ref={box} role="alert" className="ox-fm-err">
      <Glyph name="error" size={18} />
      <span className="ox-fm-err-text">{err}</span>
      <button type="button" aria-label={F.builder.hide} onClick={() => setErr('')}>
        <Glyph name="close" size={18} />
      </button>
    </div>
  );
}

function Body(): ReactElement {
  const { search, setMenu } = useForms();
  // Escape закрывает открытое меню страницы (подложка dc:26 — мышью).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setMenu]);
  if (!search.form) return <FormsList />;
  return <Editor key={search.form} formId={search.form} tab={search.tab ?? 'build'} />;
}

/** Ширина корня (ResizeObserver dc:541–545); без наблюдателя — широкий вид. */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(1100);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    ro.current = new ResizeObserver((es) => {
      const next = Math.round(es[0]?.contentRect.width ?? 1100);
      setW((cur) => (Math.abs(next - cur) > 8 ? next : cur));
    });
    ro.current.observe(el);
    setW(Math.round(el.getBoundingClientRect().width) || 1100);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, w];
}

export default function FormsPage(): ReactElement {
  const { tenantId: id, tenant } = useShell();
  const tenantId = id ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const raw = location.search as Record<string, unknown>;
  const search = useMemo(() => searchOf(raw), [raw]);
  const [ref, width] = useWidth();

  const go = useCallback(
    (next: FormsSearch, replace = false) => {
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v));
      void navigate({
        to: '/t/$tenantId/$page',
        params: { tenantId, page: 'forms' },
        search: clean as never,
        replace,
      });
    },
    [navigate, tenantId],
  );

  return (
    <FormsProvider tenantId={tenantId} search={search} go={go} width={width}>
      <section aria-label={shell.nav.items.forms} className="ox-fm-page-wrap">
        <div className="ox-fm-crumb">
          {tenant?.name ?? ''} / {shell.nav.groups.core}
        </div>
        <div ref={ref} className="ox-fm">
          <MenuBackdrop />
          <ErrBanner />
          <Body />
        </div>
      </section>
    </FormsProvider>
  );
}
