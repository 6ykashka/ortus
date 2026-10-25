// W4.70 · Отказ отправки ответа → итог рендера: состояние вместо формы (409 по причине, 410, 404, 403), «нет связи»
// с тем же Idempotency-Key для повтора, ошибки ввода 422 по вопросам, прочее — сообщение над формой.
import type { components } from '@ortus/api-client';
import { format, forms as F } from '@ortus/texts';

import { problemText } from '../../../../shell/run.tsx';
import type { FillOutcome } from '../preview.tsx';
import { type Refusal, refusalOf, violationsOf } from './model.ts';

type Def = components['schemas']['FormDefinitionV2'];

export interface Failed {
  outcome: FillOutcome;
  /** Нет связи: команда может повториться с тем же ключом идемпотентности. */
  retry: boolean;
}

export function failedOutcome(
  e: unknown,
  def: Def,
  on: { stop: (r: Refusal) => void; alert: (text: string | null) => void },
): Failed {
  const ref = refusalOf(e);
  if (ref?.kind === 'offline') {
    on.alert(F.fill.offline);
    return { outcome: { kind: 'stop' }, retry: true };
  }
  if (ref) {
    on.alert(null);
    on.stop(ref);
    return { outcome: { kind: 'stop' }, retry: false };
  }
  const v = violationsOf(e, def);
  if (v) {
    on.alert(v.rest.length ? v.rest.join(' ') : null);
    return {
      outcome: Object.keys(v.errs).length ? { kind: 'errors', errs: v.errs } : { kind: 'stop' },
      retry: false,
    };
  }
  on.alert(format(F.fill.failed, { error: problemText(e) }));
  return { outcome: { kind: 'stop' }, retry: false };
}

/** Состояние вместо формы по отказу (значок, заголовок, пояснение; «Открыть заново» — у устаревшей версии и нонса). */
export function refusalView(r: Refusal): {
  icon: string;
  title: string;
  text?: string;
  reopen: boolean;
} {
  switch (r.kind) {
    case 'changed':
      return {
        icon: 'sync_problem',
        title: F.fill.changed,
        text: F.fill.changedText,
        reopen: true,
      };
    case 'answered':
      return { icon: 'task_alt', title: F.fill.answered, text: F.fill.answeredText, reopen: false };
    case 'closed':
      return { icon: 'block', title: F.fill.closed, text: F.fill.closedText, reopen: false };
    case 'linkInvalid':
      return {
        icon: 'link_off',
        title: F.fill.linkInvalid,
        text: F.fill.linkInvalidText,
        reopen: false,
      };
    case 'nonce':
      return { icon: 'sync_problem', title: r.text, reopen: true };
    case 'noAccess':
      return { icon: 'lock', title: F.fill.noAccess, text: F.fill.noAccessText, reopen: false };
    case 'offline':
      return { icon: 'cloud_off', title: F.fill.offline, reopen: true };
    default:
      return {
        icon: 'search_off',
        title: F.fill.notFound,
        text: F.fill.notFoundText,
        reopen: false,
      };
  }
}
