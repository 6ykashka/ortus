// W4.22 · Черновик формы в редакторе (edit dc:562–569): локальная копия определения — источник правды сессии;
// правка сохраняется сама через 700 мс (`saveFormDraft`, If-Match — ETag черновика). Пока идёт сохранение, следующая
// правка ждёт его ответа и уходит с новым ETag. Состояние «Сохраняем черновик…», «Черновик сохранён», «Черновик не
// сохранён: {ошибка}» (412 двух редакторов — «Черновик изменил другой редактор — обновите страницу»). Отмена изменений
// и публикация сначала дожидаются сохранения (`flush`).
import type { components } from '@ortus/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { commands, formsKey, idemKeys, useDraft } from './api.ts';
import { errorText } from './ctx.tsx';
import { cleanDef, type Def, normDef } from './model.ts';

type S = components['schemas'];

/** Задержка автосохранения (dc:568). */
export const SAVE_DELAY = 700;

export type SaveState = 'saved' | 'saving' | 'error';

export interface DraftEditor {
  /** Определение черновика (локальное); null — ещё не загружено. */
  def: Def | null;
  revision: number;
  /** Правили в этой сессии (показ «До публикации исправьте» и статуса, dc:795, 837). */
  edited: boolean;
  saveState: SaveState;
  saveError: string;
  query: ReturnType<typeof useDraft>;
  edit: (fn: (d: Def) => Def) => void;
  /** Дождаться сохранения правок (до отмены и публикации); false — сохранить не удалось. */
  flush: () => Promise<boolean>;
  /** Черновик сервера после отмены или публикации — заменить локальный. */
  reset: (d: S['FormDraft'], etag: string | null) => void;
}

export function useDraftEditor(tenantId: string, formId: string, canEdit: boolean): DraftEditor {
  const api = useApi();
  const qc = useQueryClient();
  const query = useDraft(tenantId, formId);
  const [def, setDef] = useState<Def | null>(null);
  const [revision, setRevision] = useState(0);
  const [edited, setEdited] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState('');
  const [keys] = useState(idemKeys);
  const etag = useRef<string | null>(null);
  const pending = useRef<Def | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const seeded = useRef(false);

  // Первый ответ сервера — исходный черновик; дальше локальная копия не перезаписывается чтением.
  useEffect(() => {
    if (seeded.current || !query.data) return;
    seeded.current = true;
    setDef(normDef(query.data.draft.definition));
    setRevision(query.data.draft.revision);
    etag.current = query.data.etag;
  }, [query.data]);

  const send = useCallback(async (): Promise<boolean> => {
    const d = pending.current;
    if (!d) return true;
    pending.current = null;
    const body = cleanDef(d);
    const fp = { formId, body };
    try {
      const r = await commands.saveDraft(
        api,
        tenantId,
        formId,
        etag.current ?? '',
        body,
        keys.key(fp),
      );
      keys.settle(fp);
      etag.current = r.etag;
      setRevision(r.draft.revision);
      qc.setQueryData([...formsKey(tenantId), 'draft', formId], { draft: r.draft, etag: r.etag });
      if (pending.current) return send();
      setSaveState('saved');
      setSaveError('');
      return true;
    } catch (e) {
      if (!(e instanceof TypeError)) keys.settle(fp);
      // Не сохранённое — вернуть в очередь: следующая правка или публикация повторит.
      pending.current ??= d;
      setSaveState('error');
      setSaveError(errorText(e));
      return false;
    }
  }, [api, keys, qc, tenantId, formId]);

  const start = useCallback((): Promise<boolean> => {
    if (inflight.current) return inflight.current;
    const p = send().finally(() => {
      inflight.current = null;
    });
    inflight.current = p;
    return p;
  }, [send]);

  const edit = useCallback(
    (fn: (d: Def) => Def) => {
      if (!canEdit) return;
      setDef((cur) => {
        if (!cur) return cur;
        const next = normDef(fn(cur));
        pending.current = next;
        return next;
      });
      setEdited(true);
      setSaveState('saving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void (async () => {
          // Идущее сохранение закончится, затем уйдёт последняя правка.
          if (inflight.current) await inflight.current;
          await start();
        })();
      }, SAVE_DELAY);
    },
    [canEdit, start],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) await inflight.current;
    if (!pending.current) return saveState !== 'error';
    return start();
  }, [start, saveState]);

  const reset = useCallback(
    (d: S['FormDraft'], tag: string | null) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      etag.current = tag;
      setDef(normDef(d.definition));
      setRevision(d.revision);
      setEdited(false);
      setSaveState('saved');
      setSaveError('');
      qc.setQueryData([...formsKey(tenantId), 'draft', formId], { draft: d, etag: tag });
    },
    [qc, tenantId, formId],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { def, revision, edited, saveState, saveError, query, edit, flush, reset };
}

/** Текущий ETag черновика для отмены изменений (после `flush`). */
export function draftEtag(
  qc: ReturnType<typeof useQueryClient>,
  tenantId: string,
  formId: string,
): string {
  const d = qc.getQueryData<{ etag: string | null }>([...formsKey(tenantId), 'draft', formId]);
  return d?.etag ?? '';
}
