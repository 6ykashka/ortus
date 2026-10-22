// W4.61 · Диалог подтверждения opConfirm эталона (confirm :2180–2203, opConfirm :2800–2802, modalVM :3970–3981):
// круг 42 px с иконкой тона, заголовок `#dlg-title`, текст, секция «Последствия», «Отмена» и действие («Выполняем…»
// во время команды; опасное — #A13A33). Контейнер — модальный слой оболочки (`.ox-backdrop`, `.ox-dialog`,
// shell.css; лист снизу на < 640 по контейнеру фрейма), портал во фрейм `.ox-frame`. Escape и подложка закрывают
// (:2380–2384), фокус-ловушка и возврат фокуса на открывшую кнопку (PD-29); при отказе команды диалог открыт.
import { shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ChipTone } from './format.ts';

const FOCUSABLE = 'button:not([disabled]), [href], select, input:not([disabled]), textarea';

export interface ConfirmItem {
  icon: string;
  tone: ChipTone;
  text: string;
}

export interface ConfirmSpec {
  title: string;
  text: string;
  items: readonly ConfirmItem[];
  confirmLabel: string;
  /** Тон круга и кнопки: danger — красная кнопка (modalVM :3981); по умолчанию info. */
  tone?: ChipTone;
  /** Иконка круга: opConfirm — admin_panel_settings. */
  icon?: string;
}

function ConfirmDialog({
  spec,
  busy,
  onClose,
  onConfirm,
}: {
  spec: ConfirmSpec;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): ReactElement {
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const tone = spec.tone ?? 'info';

  useEffect(() => {
    opener.current = document.activeElement;
    dialog.current?.focus();
    return () => {
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  // Команда закончилась отказом (диалог открыт), а фокус ушёл на body — вернуть его на действие.
  useEffect(() => {
    const d = dialog.current;
    if (busy || !d || d.contains(document.activeElement)) return;
    const items = d.querySelectorAll<HTMLElement>(FOCUSABLE);
    (items[items.length - 1] ?? d).focus();
  }, [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!busy) onClose();
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
  }, [busy, onClose]);

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
        className="ox-dialog ox-pk-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <div className="ox-pk-confirm-body">
          <div className="ox-pk-confirm-head">
            <span className="ox-pk-confirm-chip" data-tone={tone}>
              <Icon name={spec.icon ?? 'admin_panel_settings'} size={22} />
            </span>
            <div className="ox-pk-confirm-headtext">
              <h2 id="dlg-title">{spec.title}</h2>
              <p>{spec.text}</p>
            </div>
          </div>
          <div className="ox-pk-confirm-scroll">
            <div className="ox-pk-confirm-section">
              <span className="ox-pk-confirm-section-title">{shell.modal.consequences}</span>
              <ul>
                {spec.items.map((it) => (
                  <li key={it.text}>
                    <span className="ox-pk-confirm-item-icon" data-tone={it.tone}>
                      <Icon name={it.icon} size={18} />
                    </span>
                    <span className="ox-pk-confirm-item-text">{it.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="ox-pk-confirm-foot">
            <button
              type="button"
              className="ox-pk-confirm-cancel"
              disabled={busy}
              onClick={onClose}
            >
              {shell.modal.cancel}
            </button>
            <button
              type="button"
              className="ox-pk-confirm-ok"
              data-danger={tone === 'danger' || undefined}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? shell.modal.busy : spec.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    host,
  );
}

interface Pending {
  spec: ConfirmSpec;
  action: () => Promise<unknown>;
}

/**
 * Подтверждение команды: `ask(spec, action)` открывает диалог; действие — команда через `run` оболочки (тосты).
 * Успех закрывает диалог, отказ (исключение) оставляет его открытым (opConfirm :2801).
 */
export function useConfirm(): {
  ask: (spec: ConfirmSpec, action: () => Promise<unknown>) => void;
  node: ReactElement | null;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useCallback((spec: ConfirmSpec, action: () => Promise<unknown>) => {
    setPending({ spec, action });
  }, []);
  const close = useCallback(() => setPending(null), []);
  const node = pending ? (
    <ConfirmDialog
      spec={pending.spec}
      busy={busy}
      onClose={close}
      onConfirm={() => {
        setBusy(true);
        pending
          .action()
          .then(
            () => setPending(null),
            () => undefined,
          )
          .finally(() => setBusy(false));
      }}
    />
  ) : null;
  return { ask, node };
}
