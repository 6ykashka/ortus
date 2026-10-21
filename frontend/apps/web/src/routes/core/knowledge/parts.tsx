// W4.32 · Общие кусочки разметки «Базы знаний»: скелет загрузки (М:22–24) и загрузка или ошибка блока вкладки
// (Q-W4.32-7: role=status «Загрузка», общий LoadFailed с «Повторить»), значок с подсказкой (М:92–93 — у значков
// «Финансовая страница» и «Свой доступ» эталона есть title и нет aria-hidden).
import { shell } from '@ortus/texts';
import type { CSSProperties, ReactElement } from 'react';

import { LoadFailed } from '../../company/modules/ui.tsx';

/** Скелет загрузки (М:22–24). */
export function Skeleton(): ReactElement {
  return (
    <div className="ox-kb-skel" role="status" aria-label={shell.a11y.loading}>
      <span className="ox-kb-skel-title" />
      <div className="ox-kb-skel-grid">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

/** Загрузка блока вкладки (правила, журнал, архив, участники, карта): полосы скелета с role=status. */
export function Pending({ rows = 2 }: { rows?: number }): ReactElement {
  return (
    <div className="ox-kb-pending" role="status" aria-label={shell.a11y.loading}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

/** Ошибка загрузки блока: текст по коду Problem и «Повторить» (перечитать только этот запрос). */
export function Failed({ q }: { q: { error: unknown; refetch: () => unknown } }): ReactElement {
  return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
}

/** Лигатура Material Symbols: с `title` — как значки эталона с подсказкой, иначе скрыта от AT. */
export function Glyph(p: {
  name: string;
  size: number;
  className?: string;
  title?: string;
  style?: CSSProperties;
}): ReactElement {
  const cls = p.className ? `material-symbols-rounded ${p.className}` : 'material-symbols-rounded';
  const style = { fontSize: `${p.size}px`, ...p.style };
  return p.title ? (
    <span className={cls} title={p.title} style={style}>
      {p.name}
    </span>
  ) : (
    <span className={cls} aria-hidden="true" style={style}>
      {p.name}
    </span>
  );
}
