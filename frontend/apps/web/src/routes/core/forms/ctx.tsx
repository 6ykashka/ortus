// W4.22 · Общее состояние «Форм и опросов»: адрес (`?form=&tab=`, ADR-0001), ширина корня (навигация конструктора
// sticky от 780 px, dc:837), баннер ошибки команды, открытое меню (одно на страницу, подложка «Закрыть меню» dc:26)
// и команда с ключом идемпотентности (`call` эталона dc:552: ошибки проверки, права, конфликта, отсутствия —
// текстом сервера в баннере или у поля, остальное — тост оболочки; успех — тост и перечитывание данных форм).
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
import { formsKey, idemKeys } from './api.ts';

/** id заголовка h1 редактора (скрыт визуально): цель фокуса, когда кнопка, открывшая диалог, недоступна. */
export const EDITOR_H1 = 'fm-ed-h';

export type Tab = 'build' | 'settings' | 'actions' | 'responses' | 'versions';
export const TABS: readonly Tab[] = ['build', 'settings', 'actions', 'responses', 'versions'];

export interface FormsSearch {
  form?: string;
  tab?: Tab;
}

export const searchOf = (raw: Record<string, unknown>): FormsSearch => {
  const s = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : undefined);
  const out: FormsSearch = {};
  const form = s('form');
  const tab = s('tab');
  if (form) out.form = form;
  if (form && tab && (TABS as readonly string[]).includes(tab)) out.tab = tab as Tab;
  return out;
};

/** Коды, которые показывает сама страница (quiet `onApi` CRM: validation и отказы — у места действия). */
export const QUIET = [
  'validation_failed',
  'forbidden_action',
  'revision_mismatch',
  'not_found',
  'invalid_transition',
  'module_not_installed',
] as const;

/** Текст ошибки команды: `detail` сервера (тексты эталона в MSW) или текст кода. */
export const errorText = (e: unknown): string => {
  if (e instanceof ProblemError) {
    const v = e.problem?.violations?.[0]?.message;
    return e.problem?.detail ?? v ?? problemText(e);
  }
  return problemText(e);
};

export interface CmdResult<R> {
  ok: boolean;
  data?: R;
  code?: string;
  /** Текст ошибки (для показа у поля или в диалоге). */
  error?: string;
}

export type Cmd = <R>(
  fp: unknown,
  fn: (key: string) => Promise<R>,
  okText: string | null,
  o?: { /** Ошибку показывает вызывающий (поле, диалог) — не баннер. */ local?: boolean },
) => Promise<CmdResult<R>>;

export interface FormsValue {
  tenantId: string;
  search: FormsSearch;
  go: (next: FormsSearch, replace?: boolean) => void;
  /** Ширина корня страницы. */
  width: number;
  busy: boolean;
  cmd: Cmd;
  err: string;
  setErr: (t: string) => void;
  /** Открытое меню: `tpl`, `row:<id>`, `move:<id>`, `more`, `page:<id>`, `q`. */
  menu: string | null;
  setMenu: (m: string | null) => void;
}

const Ctx = createContext<FormsValue | null>(null);

export function useForms(): FormsValue {
  const v = use(Ctx);
  if (!v) throw new Error('useForms: вне страницы «Формы и опросы»');
  return v;
}

export function FormsProvider(p: {
  tenantId: string;
  search: FormsSearch;
  go: (next: FormsSearch, replace?: boolean) => void;
  width: number;
  children: ReactNode;
}): ReactElement {
  const run = useRun();
  const qc = useQueryClient();
  const busy = useBusy('forms');
  const [keys] = useState(idemKeys);
  const [err, setErr] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const { tenantId, go: navigate } = p;

  // Переход по адресу закрывает открытое меню (open() эталона dc:624 — `menu: null`): иначе подложка «Закрыть меню»
  // остаётся поверх редактора и забирает первый клик.
  const go = useCallback(
    (next: FormsSearch, replace?: boolean) => {
      setMenu(null);
      navigate(next, replace);
    },
    [navigate],
  );

  const cmd = useCallback<Cmd>(
    async (fp, fn, okText, o = {}) => {
      setErr('');
      try {
        const data = await run('forms', () => fn(keys.key(fp)), okText, { quiet: QUIET });
        keys.settle(fp);
        await qc.invalidateQueries({ queryKey: formsKey(tenantId) });
        return { ok: true, data };
      } catch (e) {
        const code = problemCode(e);
        // Определённый ответ сервера — ключ отработан; «нет связи» — повтор с тем же ключом.
        if (code !== 'offline') keys.settle(fp);
        const error = errorText(e);
        if ((QUIET as readonly string[]).includes(code)) {
          if (!o.local) setErr(error);
          // Права или данные изменились — показать актуальное состояние.
          if (code !== 'validation_failed')
            void qc.invalidateQueries({ queryKey: formsKey(tenantId) });
        }
        return { ok: false, code, error };
      }
    },
    [run, keys, qc, tenantId],
  );

  const value = useMemo<FormsValue>(
    () => ({
      tenantId,
      search: p.search,
      go,
      width: p.width,
      busy,
      cmd,
      err,
      setErr,
      menu,
      setMenu,
    }),
    [tenantId, p.search, go, p.width, busy, cmd, err, menu],
  );
  return <Ctx value={value}>{p.children}</Ctx>;
}
