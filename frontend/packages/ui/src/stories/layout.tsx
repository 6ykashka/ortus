// Раскладка историй Storybook: только отступы и сетки, цвета — из токенов.
import type { CSSProperties, ReactElement, ReactNode } from 'react';

export function Row({ children, gap = 12 }: { children: ReactNode; gap?: number }): ReactElement {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap }}>{children}</div>
  );
}

export function Stack({ children, gap = 8 }: { children: ReactNode; gap?: number }): ReactElement {
  return <div style={{ display: 'flex', flexDirection: 'column', gap }}>{children}</div>;
}

const panel: CSSProperties = {
  padding: 20,
  border: '1px solid var(--ox-line)',
  borderRadius: 'var(--ox-radius-xl)',
  background: 'var(--ox-card)',
};

/** Белая панель витрины (Дизайн-система.dc.html:159). */
export function Panel({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}): ReactElement {
  return <div style={{ ...panel, ...style }}>{children}</div>;
}

export function Caption({ children }: { children: ReactNode }): ReactElement {
  return (
    <span
      style={{
        fontSize: 'var(--ox-fs-xs)',
        color: 'var(--ox-text-muted)',
        fontFamily: 'var(--ox-font-mono)',
      }}
    >
      {children}
    </span>
  );
}
