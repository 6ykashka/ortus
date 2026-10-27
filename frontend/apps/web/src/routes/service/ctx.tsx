// W7.32 · Контекст страницы «Обращения»: направления и типы, права по направлению, команды и единая обёртка
// (`run`: занято → команда → перечитывание → тост успеха или ошибка в своей панели).
import { createContext, use } from 'react';

import type { Commands } from './api.ts';
import type { Direction, RequestType, Rights } from './model.ts';

/** Где показать ошибку команды: в открытой панели (звонок, итог, перенос, ответ) или над содержимым. */
export type ErrScope = 'page' | 'call' | 'out' | 'move' | 'reply' | 'task';

export interface ServiceCtx {
  tenantId: string;
  directions: Direction[];
  types: RequestType[];
  dirOf: (id: string) => Direction | undefined;
  rightsOf: (directionId: string) => Rights;
  /** Право «Заводить» (кнопка «Обращение по звонку»). */
  canCreate: boolean;
  cmd: Commands;
  busy: boolean;
  offline: boolean;
  /** «Сейчас» для подписей времени ленты и шапки. */
  now: number;
  err: { scope: ErrScope; text: string } | null;
  clearErr: () => void;
  /** Ошибка проверки до отправки — в панели scope. */
  fail: (scope: ErrScope, text: string) => void;
  /** Команда: `sig` — подпись попытки (тот же ключ идемпотентности при повторе), `ok` — тост успеха. */
  run: <T>(
    sig: string,
    scope: ErrScope,
    fn: (key: string) => Promise<T>,
    ok?: string | ((r: T) => string),
  ) => Promise<T | null>;
  toast: (text: string) => void;
  open: (requestId: string) => void;
  close: () => void;
}

export const ServiceContext = createContext<ServiceCtx | null>(null);

export function useService(): ServiceCtx {
  const v = use(ServiceContext);
  if (!v) throw new Error('useService: компонент вне страницы «Обращения»');
  return v;
}
