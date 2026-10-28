// W7.13 · Общие данные страницы «Чаты» для вкладок и диалогов: кто вошёл, права, справочники имён, выполнение команд.
import type { ApiClient, components } from '@ortus/api-client';

import type { ChatFull } from './model.ts';

type S = components['schemas'];

export interface Directory {
  units: readonly S['OrgUnit'][];
  members: readonly S['Member'][];
  groups: readonly S['Group'][];
  roles: readonly S['Role'][];
}

export interface ChatsCtx {
  api: ApiClient;
  tenantId: string;
  /** Имя вошедшего: сообщения с этим автором — «свои» (в контракте у сообщения нет признака «моё», кроме `authorMemberId`). */
  meName: string;
  memberId: string | null;
  /** Учётная запись вошедшего: в выборе «Сотрудник по имени» себя не предлагаем. */
  userId: string;
  now: number;
  dir: Directory;
  /** Владелец бизнеса (`chat.policy.manage` — owner_only): «Все сотрудники», метка «Финансы», вкладка «Политики». */
  owner: boolean;
  canCreate: boolean;
  /** Выполнить команду: ошибка — в баннер страницы, успех — тост `ok`, затем перечитать данные. */
  exec: <R>(fn: () => Promise<R>, ok?: string) => Promise<R | null>;
  refresh: () => Promise<unknown>;
  /** Показать ошибку в баннере страницы (role=alert, Ч:35). */
  alert: (text: string) => void;
  busy: boolean;
  toast: (text: string, tone?: 'ok' | 'warn' | 'error' | 'info') => void;
  /** Перейти в модуль записи/документов (`fleet`, `repair`, `docs`). */
  nav: (target: string) => void;
}

export interface ChatCtx extends ChatsCtx {
  chat: ChatFull;
  chatId: string;
}

export const unitName = (dir: Directory, id: string | null | undefined): string | null =>
  id ? (dir.units.find((u) => u.id === id)?.name ?? null) : null;
