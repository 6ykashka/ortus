// W7.25 · Общие данные страницы «Документы»: организация, момент открытия, связь, папки, обновление и переходы.
import type { components } from '@ortus/api-client';

type S = components['schemas'];

export interface DocsSearch {
  doc?: string;
  filter?: 'mine' | 'shared' | 'route' | 'archive';
  folder?: string;
  tab?: 'talk' | 'versions' | 'data' | 'tools';
}

export interface DocsCtx {
  tenantId: string;
  /** Момент открытия страницы (мс). */
  now: number;
  online: boolean;
  folders: readonly S['DocFolder'][];
  /** Перечитать список, папки и открытый документ после команды. */
  refresh: () => Promise<unknown>;
  /** Перейти: пустой `doc` — к списку; `replace` — без записи в историю. */
  go: (patch: Partial<Record<keyof DocsSearch, string | undefined>>, replace?: boolean) => void;
}
