// W7.33 · Общие части портала клиента: каркас страницы без оболочки, шапка направления, состояния вместо страницы,
// шкала оценки (radiogroup с клавиатурой), поле с ошибкой. Вид — `Обращения - варианты.dc.html` 1a, мобильный первым.
import './portal.css';

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useId,
  useRef,
} from 'react';

import { type Refusal, SCALE } from './model.ts';
import { P } from './texts.ts';

export function Glyph({
  name,
  size = 20,
  fill = false,
}: {
  name: string;
  size?: number;
  fill?: boolean;
}): ReactElement {
  const style: CSSProperties = {
    fontSize: `${size}px`,
    ...(fill ? { fontVariationSettings: "'FILL' 1" } : {}),
  };
  return (
    <span className="material-symbols-rounded" aria-hidden="true" style={style}>
      {name}
    </span>
  );
}

/** Страница без оболочки и меню: колонка 480 px по центру (на телефоне — на всю ширину). */
export function Frame({ children }: { children: ReactNode }): ReactElement {
  return (
    <main className="ox-sp">
      <div className="ox-sp-col">{children}</div>
    </main>
  );
}

export function Loading(): ReactElement {
  return (
    <p className="ox-sp-loading" role="status">
      {P.loading}
    </p>
  );
}

/** Шапка: значок бренда в цвете направления, бренд, направление, действие справа. */
export function Head(p: {
  color: string;
  brand: string;
  direction: string;
  right?: ReactNode;
}): ReactElement {
  return (
    <header className="ox-sp-head">
      <span className="ox-sp-badge" style={{ background: p.color }} aria-hidden="true">
        {p.brand.slice(0, 1)}
      </span>
      <span className="ox-sp-who">
        <strong>{p.brand}</strong>
        <span>{p.direction}</span>
      </span>
      {p.right}
    </header>
  );
}

/** Состояние вместо страницы: не найдено, ссылка устарела, частые попытки, нет связи, ошибка. */
export function StateView({
  kind,
  onRetry,
}: {
  kind: Refusal | 'error';
  onRetry?: () => void;
}): ReactElement {
  const s = P.state[kind];
  const icon = {
    notFound: 'search_off',
    expired: 'link_off',
    rateLimited: 'timer',
    offline: 'wifi_off',
    error: 'error',
  }[kind];
  return (
    <section className="ox-sp-state" aria-labelledby="h-sp-state">
      <Glyph name={icon} size={40} />
      <h1 id="h-sp-state">{s.title}</h1>
      <p>{s.text}</p>
      {onRetry && (kind === 'offline' || kind === 'error') ? (
        <button type="button" className="ox-sp-btn" data-variant="primary" onClick={onRetry}>
          {P.retry}
        </button>
      ) : null}
    </section>
  );
}

export function Err({ id, text }: { id: string; text: string | undefined }): ReactElement | null {
  return text ? (
    <p className="ox-sp-err" id={id}>
      {text}
    </p>
  ) : null;
}

/** Поле с подписью и ошибкой: ошибка вне подписи, чтобы имя поля не менялось. */
export function Field(p: {
  label: string;
  error?: string | undefined;
  children: (a: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}): ReactElement {
  const id = useId();
  const eid = `${id}-e`;
  return (
    <div className="ox-sp-field">
      <label htmlFor={id}>{p.label}</label>
      {p.children({
        id,
        ...(p.error ? { 'aria-invalid': true as const, 'aria-describedby': eid } : {}),
      })}
      <Err id={eid} text={p.error} />
    </div>
  );
}

/** Шкала из пяти значков: radiogroup, стрелки двигают выбор, Tab входит одной остановкой. */
export function ScaleRadios(p: {
  label: string;
  value: number | null;
  onChange: (score: number) => void;
  disabled?: boolean;
}): ReactElement {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusable = p.value ?? 1;
  const onKey = (e: KeyboardEvent, i: number): void => {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + SCALE.length) % SCALE.length;
    refs.current[n]?.focus();
    p.onChange(n + 1);
  };
  return (
    <div className="ox-sp-scale" role="radiogroup" aria-label={p.label}>
      {SCALE.map((s, i) => {
        const on = p.value === s.score;
        return (
          <button
            key={s.score}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={s.label}
            tabIndex={s.score === focusable ? 0 : -1}
            disabled={p.disabled}
            data-on={on ? '' : undefined}
            data-low={s.score <= 3 ? '' : undefined}
            onClick={() => p.onChange(s.score)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <Glyph name={s.icon} size={24} fill={on} />
          </button>
        );
      })}
    </div>
  );
}
