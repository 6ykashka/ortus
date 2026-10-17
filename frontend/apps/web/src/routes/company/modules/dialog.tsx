// W1.24 · Диалог подтверждения страницы по рендеру эталона (confirm :2176–2201, modalVM :3969–3976; PD-28):
// модальный контейнер оболочки (`.ox-backdrop`, `.ox-dialog` — shell.css, лист снизу на < 640 по контейнеру
// фрейма), круг с иконкой тона, секции последствий, флажок «Понимаю…», «Отмена» и подтверждение («Выполняем…»
// во время команды). ConfirmDialog @ortus/ui следует витрине (кегли, интервалы, круг только info/danger) —
// вопрос владельцу @ortus/ui (Q-W1.24-14). Escape и подложка закрывают (:2380–2384); фокус-ловушка и возврат
// фокуса — PD-29, в том числе после отказа команды (фокус возвращается в диалог, Tab с body — тоже).
import { shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { DialogModel } from './vm.ts';

const FOCUSABLE = 'button:not([disabled]), [href], select, input:not([disabled]), [tabindex="0"]';

export interface ConfirmProps {
  model: DialogModel;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /**
   * Куда вернуть фокус после закрытия, если кнопка-открыватель стала недоступной или исчезла (например,
   * «Изменить лимит» после смены лимита) — иначе браузер уводит фокус на body (PD-29).
   */
  fallbackFocus?: () => HTMLElement | null;
}

function Body({ model, busy, onClose, onConfirm }: ConfirmProps): ReactElement {
  const [ack, setAck] = useState(false);
  const ackId = useId();
  const danger = model.tone === 'danger';
  return (
    <div className="ox-confirm">
      <div className="ox-confirm-head">
        <span className="ox-confirm-chip" data-tone={model.tone}>
          <Icon name={model.icon} size={22} />
        </span>
        <div className="ox-confirm-headtext">
          <h2 id="dlg-title" className="ox-confirm-title">
            {model.title}
          </h2>
          <p className="ox-confirm-text">{model.text}</p>
        </div>
      </div>
      {/* Контейнер секций — всегда, как в эталоне (:2185): и при `sections: []` пустой контейнер даёт ещё один
          gap 16 px перед подвалом («Изменить лимит на {gb} ГБ?»). */}
      <div className="ox-confirm-scroll">
        {model.consequences.map((s) => (
          <div key={s.title} className="ox-confirm-section">
            <span className="ox-confirm-section-title">{s.title}</span>
            <ul className="ox-confirm-items">
              {s.items.map((it) => (
                <li key={it.text} className="ox-confirm-item">
                  <span className="ox-confirm-item-icon" data-tone={it.tone ?? 'neutral'}>
                    <Icon name={it.icon ?? 'arrow_right'} size={18} />
                  </span>
                  <span className="ox-confirm-item-text">{it.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {model.ack ? (
          <label className="ox-confirm-ack" htmlFor={ackId}>
            <input
              id={ackId}
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>{model.ack}</span>
          </label>
        ) : null}
      </div>
      <div className="ox-confirm-foot">
        {/* Во время команды закрыть нельзя ни «Отменой», ни Escape, ни подложкой: команда идёт до ответа. */}
        <button type="button" className="ox-confirm-cancel" disabled={busy} onClick={onClose}>
          {shell.modal.cancel}
        </button>
        <button
          type="button"
          className="ox-confirm-ok"
          data-danger={danger || undefined}
          disabled={busy || (model.ack !== undefined && !ack)}
          onClick={onConfirm}
        >
          {busy ? shell.modal.busy : model.confirmLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Клавиши модального диалога — на документе (фокус может уйти из диалога на body, когда кнопка становится
 * недоступной на время команды): Escape закрывает (`onClose = null` — закрыть нельзя); Tab и Shift+Tab ходят по
 * кругу внутри диалога, а с элемента вне диалога возвращают фокус в него (aria-modal: страница позади
 * недоступна). Общий для диалога подтверждения и «Загрузки файла».
 */
export function useDialogKeys(
  dialog: RefObject<HTMLElement | null>,
  onClose: (() => void) | null,
): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      const d = dialog.current;
      if (e.key !== 'Tab' || !d) return;
      const items = [...d.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0] ?? d;
      const last = items.at(-1) ?? d;
      const active = document.activeElement;
      let next: HTMLElement | null = null;
      if (!d.contains(active)) next = e.shiftKey ? last : first;
      else if (e.shiftKey && (active === first || active === d)) next = last;
      else if (!e.shiftKey && active === last) next = first;
      if (!next) return;
      e.preventDefault();
      next.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [dialog, onClose]);
}

const isDisabled = (el: HTMLElement): boolean =>
  (el instanceof HTMLButtonElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLInputElement) &&
  el.disabled;

/** Диалог в контейнере фрейма оболочки (`.ox-frame`), как модальный контейнер эталона внутри кадра. */
export function ConfirmModal(p: ConfirmProps): ReactElement {
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const { onClose, busy } = p;
  const fallback = useRef(p.fallbackFocus);
  useEffect(() => {
    fallback.current = p.fallbackFocus;
  });

  useEffect(() => {
    opener.current = document.activeElement;
    dialog.current?.focus();
    return () => {
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected && !isDisabled(back)) back.focus();
      else fallback.current?.()?.focus();
    };
  }, []);

  // Команда закончилась (отказ — диалог открыт): кнопка подтверждения была недоступна, и браузер увёл фокус на
  // body. Возвращаем его на подтверждение (последний доступный элемент), иначе — на сам диалог.
  useEffect(() => {
    const d = dialog.current;
    if (busy || !d || d.contains(document.activeElement)) return;
    const items = d.querySelectorAll<HTMLElement>(FOCUSABLE);
    (items[items.length - 1] ?? d).focus();
  }, [busy]);

  useDialogKeys(dialog, busy ? null : onClose);

  const host = document.querySelector('.ox-frame') ?? document.body;
  return createPortal(
    <div
      className="ox-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialog}
        className="ox-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <Body {...p} />
      </div>
    </div>,
    host,
  );
}
