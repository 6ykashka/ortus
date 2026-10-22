// W4.23 · Общее вкладок формы без провайдера (вкладки самостоятельны: оболочку редактора W4.22 подключает их как
// `<SettingsTab tenantId formId />` и т. п.): команда `call` эталона (dc:552 — `run('form:'+m, …, {quiet:
// ['validation']})`): ошибки проверки, права, конфликта, отсутствия и перехода — текстом сервера там, где их показывает
// вкладка (поле `role=alert` «Настроек», подвал редактора правила) или тостом с текстом сервера (`flash(e.message)`
// эталона); «нет связи» и прочее — тост оболочки. Успех — тост и перечитывание данных «Форм». Глиф и загрузка блока.
import { ProblemError } from '@ortus/api-client';
import { shell } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, type ReactElement, useCallback, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../../shell/run.tsx';
import { useToast } from '../../../../shell/toast.tsx';
import { MOD_TEXT, t } from '../../../company/modules/texts.ts';
import { formsKey, idemKeys } from './api.ts';

/** Коды, текст которых — текст сервера (тексты эталона в MSW и Go-хендлерах). */
export const QUIET = [
  'validation_failed',
  'forbidden_action',
  'revision_mismatch',
  'not_found',
  'invalid_transition',
  'module_not_installed',
] as const;

/**
 * Текст ошибки команды: первое нарушение проверки (текст поля — «Лимит ответов — положительное число»), иначе `detail`
 * сервера, иначе текст кода.
 */
export const errorText = (e: unknown): string => {
  if (!(e instanceof ProblemError)) return problemText(e);
  return e.problem?.violations?.[0]?.message ?? e.problem?.detail ?? problemText(e);
};

export interface CmdResult<R> {
  ok: boolean;
  data?: R;
  code?: string;
  error?: string;
}

export interface CmdOptions<R = unknown> {
  onError?: (text: string) => void;
  /**
   * Ответ сервера — сразу в кэш (до тоста и перечитывания): следующая команда по тому же объекту, начатая до конца
   * перечитывания, берёт новую ревизию, а не старую (иначе 412 «Данные изменились…»).
   */
  onData?: (r: R) => void;
  /**
   * Что перечитать после успеха. По умолчанию — все запросы «Форм» и «Базы знаний» (правила пишут туда). «Настройки»
   * кладут ответ updateForm в кэш сами и перечитывают только список форм — без черновика и версий.
   */
  refresh?: readonly (readonly unknown[])[];
}

export type Cmd = <R>(
  fp: unknown,
  fn: (key: string) => Promise<R>,
  okText: string | null | ((r: R) => string | null),
  o?: CmdOptions<R>,
) => Promise<CmdResult<R>>;

/**
 * Команда вкладки: Idempotency-Key по отпечатку `fp` (повтор после «нет связи» — тот же ключ), тост успеха, ошибки
 * QUIET — в `onError` (иначе тост текстом сервера), перечитывание «Форм» (и «Базы знаний», «Задач» — правила пишут туда).
 */
export function useCmd(tenantId: string): { cmd: Cmd; busy: boolean } {
  const run = useRun();
  const qc = useQueryClient();
  const toast = useToast();
  const busy = useBusy('forms');
  const [keys] = useState(idemKeys);
  const cmd = useCallback<Cmd>(
    async (fp, fn, okText, o = {}) => {
      try {
        const data = await run('forms', () => fn(keys.key(fp)), null, { quiet: QUIET });
        keys.settle(fp);
        o.onData?.(data);
        const ok = typeof okText === 'function' ? okText(data) : okText;
        if (ok) toast(ok, 'ok');
        if (o.refresh) {
          await Promise.all(o.refresh.map((queryKey) => qc.invalidateQueries({ queryKey })));
        } else {
          await qc.invalidateQueries({ queryKey: formsKey(tenantId) });
          void qc.invalidateQueries({ queryKey: ['tenant', tenantId, 'knowledge'] });
        }
        return { ok: true, data };
      } catch (e) {
        const code = problemCode(e);
        // Определённый ответ сервера — ключ отработан; «нет связи» — повтор с тем же ключом.
        if (code !== 'offline') keys.settle(fp);
        const text = errorText(e);
        if ((QUIET as readonly string[]).includes(code)) {
          if (o.onError) o.onError(text);
          else toast(text, 'error');
          if (code !== 'validation_failed')
            void qc.invalidateQueries({ queryKey: formsKey(tenantId) });
        }
        return { ok: false, code, error: text };
      }
    },
    [run, keys, qc, tenantId, toast],
  );
  return { cmd, busy };
}

/** Клиент API для команд вкладок. */
export { useApi };

/** Лигатура Material Symbols: с `title` — как значки эталона с подсказкой, иначе скрыта от AT. */
export function Glyph(p: {
  name: string;
  size: number;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  const cls = p.className ? `material-symbols-rounded ${p.className}` : 'material-symbols-rounded';
  return (
    <span className={cls} aria-hidden="true" style={{ fontSize: `${p.size}px`, ...p.style }}>
      {p.name}
    </span>
  );
}

/** Загрузка блока вкладки: полосы скелета с role=status «Загрузка». */
export function Pending({ rows = 2 }: { rows?: number }): ReactElement {
  return (
    <div className="ox-fr-pending" role="status" aria-label={shell.a11y.loading}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

/**
 * Ошибка загрузки блока: текст по коду Problem и «Повторить» (перечитать только этот запрос). Разметка и тексты —
 * как LoadFailed «Модулей» (`ox-mod-alert`, без эталона), стили — свои (results.css): modules.css страница форм не
 * подключает.
 */
export function Failed({ q }: { q: { error: unknown; refetch: () => unknown } }): ReactElement {
  return (
    <div className="ox-fr-failed">
      <Glyph name="error" size={20} />
      <span role="alert" className="ox-fr-failed-text">
        {t(MOD_TEXT.loadFailed, { error: problemText(q.error) })}
      </span>
      <button type="button" className="ox-fr-btn" onClick={() => void q.refetch()}>
        {MOD_TEXT.retry}
      </button>
    </div>
  );
}
