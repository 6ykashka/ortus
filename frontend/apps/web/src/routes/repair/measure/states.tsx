// W6.21 · Состояния вкладок «Замер» и «Смета» (no-reference): скелетон загрузки и ошибка с «Повторить».
import { Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import { problemText } from '../../../shell/run.tsx';

export function TabSkeleton({ label }: { label: string }): ReactElement {
  return (
    <div className="ox-rp-skel" aria-busy="true" aria-label={label}>
      <span className="ox-rp-skel-line" data-w="short" />
      <span className="ox-rp-skel-line" />
      <span className="ox-rp-skel-block" />
    </div>
  );
}

export function TabFailed({
  text,
  error,
  retry,
  onRetry,
}: {
  /** Шаблон «Не удалось загрузить …: {error}». */
  text: string;
  error: unknown;
  retry: string;
  onRetry: () => void;
}): ReactElement {
  return (
    <div className="ox-rp-alert">
      <Icon name="error" size={20} />
      <span role="alert" className="ox-rp-alert-text">
        {text.replace('{error}', problemText(error))}
      </span>
      <button type="button" className="ox-rp-btn" data-variant="secondary" onClick={onRetry}>
        {retry}
      </button>
    </div>
  );
}
