// W4.22 · Запросы и команды «Форм и опросов» (контракт 0.11.0-stage4, тег Forms; W4.05, backend — W4.21): список,
// шаблоны, группы, форма (ETag — If-Match `updateForm` и `publishForm`), черновик (ETag — If-Match `saveFormDraft` и
// `discardFormDraft`), версии (структура действующей версии), правила (диалог публикации, ссылка на БЗ), выгрузка CSV.
// Команды — с Idempotency-Key (повтор после «нет связи» — тот же ключ, соглашение W2.23).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';

type S = components['schemas'];

export const formsKey = (tenantId: string) => ['tenant', tenantId, 'forms'] as const;

const P = '/api/v1/tenants/{tenantId}' as const;

/** Предел страницы контракта (`Limit`) и число страниц списка. */
const LIMIT = 200;
const PAGES = 20;

/**
 * Формы участника (все страницы по курсору). Поиск и статус — на клиенте, как listVM эталона; «Мои формы» — фильтр
 * сервера owner=me (владелец формы — участник организации, а не имя, как у эталона).
 */
export function useForms(tenantId: string, mine = false, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'list', mine ? 'mine' : 'all'],
    enabled,
    queryFn: async () => {
      const out: S['Form'][] = [];
      let cursor: string | undefined;
      for (let i = 0; i < PAGES; i++) {
        const p = await unwrap(
          await api.GET(`${P}/forms`, {
            params: {
              path: { tenantId },
              query: {
                limit: LIMIT,
                ...(mine ? { owner: 'me' as const } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
          }),
        );
        out.push(...p.items);
        if (!p.nextCursor) break;
        cursor = p.nextCursor;
      }
      return out;
    },
  });
}

export function useTemplates(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'templates'],
    enabled,
    queryFn: async () =>
      (await unwrap(await api.GET(`${P}/form-templates`, { params: { path: { tenantId } } })))
        .items,
  });
}

export function useGroups(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'groups'],
    queryFn: async () =>
      (await unwrap(await api.GET(`${P}/form-groups`, { params: { path: { tenantId } } }))).items,
  });
}

export interface FormRead {
  form: S['Form'];
  /** ETag формы — If-Match переименования, приёма, публикации. */
  etag: string | null;
}

export function useForm(tenantId: string, formId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'form', formId],
    retry: false,
    queryFn: async (): Promise<FormRead> => {
      const r = await api.GET(`${P}/forms/{formId}`, { params: { path: { tenantId, formId } } });
      return { form: await unwrap(r), etag: r.response.headers.get('ETag') };
    },
  });
}

export interface DraftRead {
  draft: S['FormDraft'];
  /** ETag черновика — If-Match автосохранения и отмены изменений. */
  etag: string | null;
}

export function useDraft(tenantId: string, formId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'draft', formId],
    retry: false,
    // Черновик правит только эта вкладка: перечитывание при фокусе окна затёрло бы несохранённую правку.
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<DraftRead> => {
      const r = await api.GET(`${P}/forms/{formId}/draft`, {
        params: { path: { tenantId, formId } },
      });
      return { draft: await unwrap(r), etag: r.response.headers.get('ETag') };
    },
  });
}

/** Версии формы (новые первыми): действующая — структура для флагов, заметок и диалога публикации. */
export function useVersions(tenantId: string, formId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'versions', formId],
    enabled,
    queryFn: async () => {
      const out: S['FormVersion'][] = [];
      let cursor: string | undefined;
      for (let i = 0; i < PAGES; i++) {
        const p = await unwrap(
          await api.GET(`${P}/forms/{formId}/versions`, {
            params: {
              path: { tenantId, formId },
              query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
            },
          }),
        );
        out.push(...p.items);
        if (!p.nextCursor) break;
        cursor = p.nextCursor;
      }
      return out;
    },
  });
}

export function useRules(tenantId: string, formId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'rules', formId],
    enabled,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET(`${P}/forms/{formId}/rules`, { params: { path: { tenantId, formId } } }),
        )
      ).items,
  });
}

// ---------------------------------------------------------------------------------------------
// Команды: (api, tenantId, …, key) → ответ сервера.

type Key = string;
const hdr = (key: Key) => ({ 'Idempotency-Key': key });

export const commands = {
  createForm: async (api: ApiClient, tenantId: string, body: S['FormCreate'], key: Key) =>
    unwrap(
      await api.POST(`${P}/forms`, { params: { path: { tenantId }, header: hdr(key) }, body }),
    ),
  updateForm: async (
    api: ApiClient,
    tenantId: string,
    formId: string,
    etag: string,
    body: S['FormPatch'],
    key: Key,
  ) => {
    const r = await api.PATCH(`${P}/forms/{formId}`, {
      params: { path: { tenantId, formId }, header: { ...hdr(key), 'If-Match': etag } },
      body,
    });
    return { form: await unwrap(r), etag: r.response.headers.get('ETag') };
  },
  saveDraft: async (
    api: ApiClient,
    tenantId: string,
    formId: string,
    etag: string,
    definition: S['FormDefinitionV2'],
    key: Key,
  ) => {
    const r = await api.PUT(`${P}/forms/{formId}/draft`, {
      params: { path: { tenantId, formId }, header: { ...hdr(key), 'If-Match': etag } },
      body: { definition },
    });
    return { draft: await unwrap(r), etag: r.response.headers.get('ETag') };
  },
  discardDraft: async (
    api: ApiClient,
    tenantId: string,
    formId: string,
    etag: string,
    key: Key,
  ) => {
    const r = await api.DELETE(`${P}/forms/{formId}/draft`, {
      params: { path: { tenantId, formId }, header: { ...hdr(key), 'If-Match': etag } },
    });
    return { draft: await unwrap(r), etag: r.response.headers.get('ETag') };
  },
  publish: async (
    api: ApiClient,
    tenantId: string,
    formId: string,
    etag: string,
    draftRevision: number,
    key: Key,
  ) =>
    unwrap(
      await api.POST(`${P}/forms/{formId}/publish`, {
        params: { path: { tenantId, formId }, header: { ...hdr(key), 'If-Match': etag } },
        body: { draftRevision },
      }),
    ),
  createGroup: async (api: ApiClient, tenantId: string, name: string, key: Key) =>
    unwrap(
      await api.POST(`${P}/form-groups`, {
        params: { path: { tenantId }, header: hdr(key) },
        body: { name },
      }),
    ),
  deleteGroup: async (api: ApiClient, tenantId: string, groupId: string, key: Key) => {
    const r = await api.DELETE(`${P}/form-groups/{groupId}`, {
      params: { path: { tenantId, groupId }, header: hdr(key) },
    });
    // 204 без тела — успех; иначе Problem.
    if (!r.response.ok) await unwrap(r);
    return true;
  },
  exportCsv: async (api: ApiClient, tenantId: string, formId: string) =>
    unwrap(await api.GET(`${P}/forms/{formId}/export`, { params: { path: { tenantId, formId } } })),
};

/** Свежий ETag формы для команды из списка (строка не хранит ETag). */
export async function formEtag(api: ApiClient, tenantId: string, formId: string): Promise<string> {
  const r = await api.GET(`${P}/forms/{formId}`, { params: { path: { tenantId, formId } } });
  await unwrap(r);
  return r.response.headers.get('ETag') ?? '';
}

/**
 * Ключи идемпотентности команд (соглашение W2.23, Q-W2.22-9): та же команда с тем же телом — тот же
 * `Idempotency-Key` до определённого ответа сервера (повтор после «нет связи» сервер узнаёт), другое тело — новый.
 */
export function idemKeys(): { key: (fp: unknown) => string; settle: (fp: unknown) => void } {
  const keys = new Map<string, string>();
  const id = (fp: unknown) => JSON.stringify(fp ?? null);
  return {
    key: (fp) => {
      let k = keys.get(id(fp));
      if (!k) {
        k = crypto.randomUUID();
        keys.set(id(fp), k);
      }
      return k;
    },
    settle: (fp) => void keys.delete(id(fp)),
  };
}
