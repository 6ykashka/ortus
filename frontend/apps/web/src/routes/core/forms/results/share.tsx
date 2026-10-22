// W4.23 · Диалог «Поделиться формой» (`modal-form-share`; эталон design-2026-10-19 «Формы и опросы.dc.html» dc:457–466,
// modalVM dc:1081–1087; разбор forms.md §1.10): черновик — «Ссылка появится после публикации…»; опубликованная —
// «Доступ настраивается во вкладке «Настройки».» и ссылки по режиму доступа — маршруты SPA (Q-W4.00-forms-21):
// «Ссылка для сотрудников», «Публичная ссылка» и «Код для сайта»; «Копировать» → «Скопировано» на 1,8 с; закрытый
// приём — пояснение. Escape и «Закрыть» закрывают, фокус — в диалог и обратно, Tab не выходит наружу.
import { formsResults as F } from '@ortus/texts';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import { EDITOR_H1 } from '../ctx.tsx';
import { useForm } from './api.ts';
import { Failed, Glyph, Pending } from './ctx.tsx';
import { shareLinks } from './model.ts';
import './results.css';

const S = F.share;

const FOCUSABLE =
  'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Ловушка фокуса модального диалога: Tab с последней цели — на первую, Shift+Tab с первой — на последнюю. */
export function trapTab(e: KeyboardEvent, box: HTMLElement): void {
  const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
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

export function ShareDialog(p: {
  tenantId: string;
  formId: string;
  onClose: () => void;
}): ReactElement {
  const fq = useForm(p.tenantId, p.formId);
  const box = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // onClose родителя — новая функция при каждой перерисовке: фокус и Escape привязываются один раз (при открытии).
  const closeRef = useRef(p.onClose);
  useEffect(() => {
    closeRef.current = p.onClose;
  });
  const onClose = () => closeRef.current();

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab' && box.current) trapTab(e, box.current);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(timer.current);
      // Кнопка, открывшая диалог, пропала (шапка перерисована) — фокус на h1 редактора W4.22.
      const to = back?.isConnected ? back : document.getElementById(EDITOR_H1);
      to?.focus?.({ preventScroll: true });
    };
  }, []);

  const f = fq.data?.form;
  const links = f ? shareLinks(f, window.location.origin) : [];
  const copy = (key: string, text: string) => {
    const done = () => {
      setCopied(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1800);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done);
    else done();
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="fm-md-t" className="ox-fr-overlay">
      <div ref={box} tabIndex={-1} className="ox-fr-dialog">
        <div className="ox-fr-dialog-head">
          <h2 id="fm-md-t">{S.title}</h2>
          {f ? <span>{f.publishedVersionNumber ? S.published : S.draft}</span> : null}
        </div>
        {/* Формы ещё нет в кэше (диалог открыт не из шапки) — загрузка или ошибка внутри диалога, фокус уже в нём. */}
        {!f ? fq.isError ? <Failed q={fq} /> : <Pending rows={2} /> : null}
        {f?.publishedVersionNumber && f.status === 'closed' ? (
          <div className="ox-fr-item" data-tone="neutral">
            <Glyph name="block" size={18} />
            <span>{S.closed}</span>
          </div>
        ) : null}
        {links.map((l) => (
          <div key={l.key} className="ox-fr-link-row">
            <span className="ox-fr-link-label">{l.label}</span>
            <div className="ox-fr-link-box">
              <input readOnly value={l.value} aria-label={l.label} />
              <button type="button" className="ox-fr-btn" onClick={() => copy(l.key, l.value)}>
                <Glyph name="content_copy" size={18} />
                {copied === l.key ? S.copied : S.copy}
              </button>
            </div>
            <span className="ox-fr-note">{l.note}</span>
          </div>
        ))}
        <div className="ox-fr-dialog-foot">
          <button type="button" className="ox-fr-btn" data-plain="" onClick={onClose}>
            {S.close}
          </button>
        </div>
      </div>
    </div>
  );
}
