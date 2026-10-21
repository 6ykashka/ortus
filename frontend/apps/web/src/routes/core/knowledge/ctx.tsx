// W4.32 · Общее состояние «Базы знаний»: адрес (`?space=&page=&tab=`, ADR-0001), ширина контейнера (narrow < 860,
// М:487), баннер ошибки команды (М:25–27), диалог, черновик правки и команда с ключом идемпотентности
// (`call` эталона М:410: ошибка проверки, права, конфликта, отсутствия — текстом сервера в баннере или в подвале
// диалога, остальное — тост оболочки; успех — тост и перечитывание данных БЗ).
import { ProblemError } from '@ortus/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactElement,
  type ReactNode,
  use,
  useCallback,
  useMemo,
  useState,
} from 'react';

import { problemCode, problemText, useBusy, useRun } from '../../../shell/run.tsx';
import { idemKeys, kbKey } from './api.ts';
import type { Draft } from './model.ts';

export interface KbSearch {
  space?: string;
  page?: string;
  tab?: string;
}

export const searchOf = (raw: Record<string, unknown>): KbSearch => {
  const s = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : undefined);
  const out: KbSearch = {};
  const space = s('space');
  const page = s('page');
  const tab = s('tab');
  if (space) out.space = space;
  if (space && page) out.page = page;
  if (space && tab) out.tab = tab;
  return out;
};

export type Dialog =
  | { kind: 'space' }
  | { kind: 'node'; parent: string }
  | { kind: 'move'; nodeId: string }
  | { kind: 'access'; nodeId: string };

/** Коды, которые показывает сама страница (quiet `kb2.onApi` CRM :2871). */
const QUIET = [
  'validation_failed',
  'forbidden_action',
  'revision_mismatch',
  'request_pending',
  'not_found',
  'delegation_exceeds_grant',
  'invalid_transition',
] as const;

/** Текст ошибки команды: `detail` сервера (тексты домена) или текст кода. */
export const errorText = (e: unknown): string =>
  (e instanceof ProblemError ? e.problem?.detail : undefined) ?? problemText(e);

export interface CmdResult<R> {
  ok: boolean;
  data?: R;
  code?: string;
}

export type Cmd = <R>(
  fp: unknown,
  fn: (key: string) => Promise<R>,
  okText: string | null,
  o?: { dialog?: boolean },
) => Promise<CmdResult<R>>;

export interface KbValue {
  tenantId: string;
  search: KbSearch;
  /** Адрес на момент вызова (после ответа команды — не значение замыкания клика). */
  now: () => KbSearch;
  go: (next: KbSearch, replace?: boolean) => void;
  narrow: boolean;
  busy: boolean;
  cmd: Cmd;
  err: string;
  setErr: (t: string) => void;
  dialog: Dialog | null;
  dialogErr: string;
  setDialogErr: (t: string) => void;
  openDialog: (d: Dialog) => void;
  closeDialog: () => void;
  draft: (Draft & { etag?: string | null }) | null;
  setDraft: (d: (Draft & { etag?: string | null }) | null) => void;
}

const Ctx = createContext<KbValue | null>(null);

export function useKb(): KbValue {
  const v = use(Ctx);
  if (!v) throw new Error('useKb: вне страницы «База знаний»');
  return v;
}

export function KbProvider(p: {
  tenantId: string;
  search: KbSearch;
  now: () => KbSearch;
  go: (next: KbSearch, replace?: boolean) => void;
  narrow: boolean;
  children: ReactNode;
}): ReactElement {
  const run = useRun();
  const qc = useQueryClient();
  const busy = useBusy('kb');
  const [keys] = useState(idemKeys);
  const [err, setErr] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogErr, setDialogErr] = useState('');
  const [draft, setDraft] = useState<KbValue['draft']>(null);
  const { tenantId } = p;

  const cmd = useCallback<Cmd>(
    async (fp, fn, okText, o = {}) => {
      setErr('');
      setDialogErr('');
      try {
        const data = await run('kb', () => fn(keys.key(fp)), okText, { quiet: QUIET });
        keys.settle(fp);
        await qc.invalidateQueries({ queryKey: kbKey(tenantId) });
        return { ok: true, data };
      } catch (e) {
        const code = problemCode(e);
        // Определённый ответ сервера — ключ отработан; «нет связи» — повтор с тем же ключом.
        if (code !== 'offline') keys.settle(fp);
        if ((QUIET as readonly string[]).includes(code)) {
          if (o.dialog) setDialogErr(errorText(e));
          else setErr(errorText(e));
          // Права или данные изменились — показать актуальное состояние.
          if (code !== 'validation_failed')
            void qc.invalidateQueries({ queryKey: kbKey(tenantId) });
        }
        return { ok: false, code };
      }
    },
    [run, keys, qc, tenantId],
  );

  const openDialog = useCallback((d: Dialog) => {
    setDialogErr('');
    setDialog(d);
  }, []);
  const closeDialog = useCallback(() => {
    setDialogErr('');
    setDialog(null);
  }, []);

  const value = useMemo<KbValue>(
    () => ({
      tenantId,
      search: p.search,
      now: p.now,
      go: p.go,
      narrow: p.narrow,
      busy,
      cmd,
      err,
      setErr,
      dialog,
      dialogErr,
      setDialogErr,
      openDialog,
      closeDialog,
      draft,
      setDraft,
    }),
    [
      tenantId,
      p.search,
      p.now,
      p.go,
      p.narrow,
      busy,
      cmd,
      err,
      dialog,
      dialogErr,
      openDialog,
      closeDialog,
      draft,
    ],
  );
  return <Ctx value={value}>{p.children}</Ctx>;
}
