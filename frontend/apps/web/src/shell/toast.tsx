// W1.20 · Тост оболочки (toast :2414–2418, toastVM :2885–2891, разметка :2287–2291): один тост, 4200 мс,
// повтор сбрасывает таймер; `role="alert"` у ошибки, иначе `status`; `aria-live="polite"`.
import { Icon } from '@ortus/ui';
import {
  createContext,
  type ReactElement,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type ToastTone = 'ok' | 'warn' | 'error' | 'info';
export const TOAST_MS = 4200;

interface ToastState {
  text: string;
  tone: ToastTone;
}

type Show = (text: string, tone?: ToastTone) => void;

const ShowContext = createContext<Show | null>(null);
const StateContext = createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback<Show>((text, tone = 'ok') => {
    clearTimeout(timer.current);
    setState({ text, tone });
    timer.current = setTimeout(() => setState(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ShowContext value={show}>
      <StateContext value={state}>{children}</StateContext>
    </ShowContext>
  );
}

export function useToast(): Show {
  const show = use(ShowContext);
  if (!show) throw new Error('useToast: нет ToastProvider');
  return show;
}

const ICON: Record<ToastTone, 'check_circle' | 'cloud_off' | 'error' | 'info'> = {
  ok: 'check_circle',
  warn: 'cloud_off',
  error: 'error',
  info: 'info',
};

/** Сам тост: внизу фрейма по центру (76 px над нижней навигацией телефона, иначе 20 px). */
export function ToastHost(): ReactElement | null {
  const state = use(StateContext);
  const icon = useMemo(() => (state ? ICON[state.tone] : null), [state]);
  if (!state || !icon) return null;
  return (
    <div
      className="ox-toast"
      role={state.tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      data-tone={state.tone}
    >
      <Icon name={icon} size={20} className="ox-toast-icon" />
      <span className="ox-toast-text">{state.text}</span>
    </div>
  );
}
