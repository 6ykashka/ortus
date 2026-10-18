// W1.24 · `modal-upload` «Загрузка файла» (S1-20, no-reference B-6; Q-W1.24-15): сессия загрузки контракта —
// initiateUpload (резерв места, билет PUT) → PUT по билету с полосой прогресса → completeUpload (сверка
// SHA-256) → проверка файла (getFile: quarantined → ready | rejected; состояние проверки — у файла, а не у
// сессии, поэтому опрос getFile, а не getUploadSession); «Отменить загрузку» — abortUpload (резерв
// освобождается), «Повторить» — новая сессия того же файла (только после сбоя передачи, сети, сервера; сессия
// после отказа completeUpload отменяется — Q-W1.24-27); после отказа и отклонения проверкой — «Выбрать файл».
// Диалог в модальном контейнере оболочки, разметка — диалог
// подтверждения эталона (:2179–2201). Места монтирования в этапе 1 нет: у «Файлов» загрузки нет, контракт требует родителя; первый
// потребитель — фото осмотра (W2.04).
import { type components, ProblemError, unwrap } from '@ortus/api-client';
import { shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useApi } from '../../../../app/api.tsx';
import { problemText } from '../../../../shell/run.tsx';
import { useDialogKeys } from '../../../company/modules/dialog.tsx';
import { FILES_TEXT, t } from '../texts.ts';
import { stripFileMetadata } from './metadata.ts';
import '../../../company/modules/modules.css';
import '../files.css';

type S = components['schemas'];

export type UploadPhase =
  'idle' | 'uploading' | 'scanning' | 'ready' | 'rejected' | 'failed' | 'aborted';

/**
 * PUT файла по билету (подменяется в тестах: MSW не обслуживает ссылку хранилища). signal — «Отменить
 * загрузку», закрытие диалога или новый файл прерывают передачу; onProgress — ход передачи (байты).
 */
export type PutObject = (
  url: string,
  file: Blob,
  contentType: string,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void,
) => Promise<void>;

export interface UploadDialogProps {
  tenantId: string;
  purpose: S['UploadCreate']['purpose'];
  owner: S['ObjectRef'];
  onClose: () => void;
  onDone?: (file: S['File']) => void;
  put?: PutObject;
  /** Период опроса проверки файла, мс. */
  pollMs?: number;
  /** Число опросов проверки; дольше — подсказка «Проверка занимает больше обычного…». */
  pollMax?: number;
}

const U = FILES_TEXT.upload;
const POLL_MS = 2000;
const POLL_MAX = 150;

const aborted = (): DOMException => new DOMException('Передача прервана', 'AbortError');

/**
 * PUT по presigned-ссылке: тип — подписанный заголовок билета, тело — файл как есть. XMLHttpRequest, а не
 * fetch: ход передачи (`upload.onprogress`) для полосы прогресса. Ответ не 2xx и сбой сети — TypeError
 * (сбой передачи: доступен «Повторить»), отмена — AbortError.
 */
export const putObject: PutObject = (url, file, contentType, signal, onProgress) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = (): void => xhr.abort();
    const settle = (): void => signal?.removeEventListener('abort', onAbort);
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new TypeError(`PUT ${xhr.status}`));
    };
    xhr.onerror = () => {
      settle();
      reject(new TypeError('PUT: нет связи с хранилищем'));
    };
    xhr.onabort = () => {
      settle();
      reject(aborted());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(file);
  });

/** SHA-256 содержимого в hex (UploadCreate.sha256, сверка при completeUpload). */
async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/** Попытка загрузки одного файла. */
interface Attempt {
  cancelled: boolean;
  /**
   * Сессия начата и не завершена: её можно и нужно отменить (abortUpload освобождает резерв места). Пока
   * completeUpload в пути, файл передан — флаг снят; отказ completeUpload возвращает его: сессия осталась
   * issued/uploaded с резервом, «Повторить», новый файл и закрытие её отменяют.
   */
  open: boolean;
  session: { uploadId: string; fileId: string } | null;
  /** Прерывает PUT этой попытки. */
  ctrl: AbortController;
}

/** Фазы, в которых можно выбрать файл: до загрузки, после отмены, отказа и отклонения проверкой. */
const PICK = new Set<UploadPhase>(['idle', 'aborted', 'failed', 'rejected']);

const STATUS: Partial<Record<UploadPhase, string>> = {
  uploading: U.uploading,
  scanning: U.scanning,
  ready: U.ready,
  rejected: U.rejected,
  aborted: U.aborted,
};

export function UploadDialog(p: UploadDialogProps): ReactElement {
  const api = useApi();
  const put = p.put ?? putObject;
  const pollMs = p.pollMs ?? POLL_MS;
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  /** Отказ, который исправит повтор того же файла (сбой передачи, сети, сервера) — иначе только другой файл. */
  const [retryable, setRetryable] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  /** Ход передачи PUT, 0–100 %. */
  const [progress, setProgress] = useState(0);
  /**
   * Текущая попытка загрузки. У каждой попытки свой флаг отмены и своя сессия: попытка, отменённая до ответа
   * initiateUpload, остаётся отменённой и после выбора нового файла — её ответ не запустит PUT старого файла.
   */
  const attempt = useRef<Attempt | null>(null);
  const alive = useRef(true);
  const dialog = useRef<HTMLDivElement>(null);
  const [slow, setSlow] = useState(false);
  const { tenantId, purpose, owner, onDone, onClose } = p;
  const pollMax = p.pollMax ?? POLL_MAX;

  /**
   * Отменяет попытку: флаг и abortUpload начатой сессии (резерв освобождается). Без сессии — только флаг:
   * `start` этой попытки отменит сессию сам, когда initiateUpload ответит.
   */
  const cancelAttempt = useCallback(
    async (a: Attempt | null): Promise<void> => {
      if (!a) return;
      a.cancelled = true;
      a.ctrl.abort();
      const s = a.session;
      if (!a.open || !s) return;
      a.open = false;
      await api
        .DELETE('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}', {
          params: { path: { tenantId, uploadId: s.uploadId }, header: idem() },
        })
        .catch(() => undefined);
    },
    [api, tenantId],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Диалог закрыт во время загрузки: сессия не должна висеть с резервом места.
      void cancelAttempt(attempt.current);
    };
  }, [cancelAttempt]);

  // Фокус в диалог при открытии; при закрытии — обратно на открыватель (как у диалога подтверждения, PD-29).
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Смена фазы убирает элемент в фокусе (поле выбора, «Отменить загрузку», «Повторить») — браузер уводит фокус
  // на body; возвращаем его в диалог.
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.contains(document.activeElement)) d.focus();
  }, [phase]);

  /** «Закрыть», Escape, подложка: начатая загрузка отменяется. */
  const close = useCallback((): void => {
    void cancelAttempt(attempt.current);
    onClose();
  }, [cancelAttempt, onClose]);

  useDialogKeys(dialog, close);

  /** Попытка ещё актуальна: не отменена, диалог открыт. */
  const live = (a: Attempt): boolean => !a.cancelled && alive.current;

  /** Опрос проверки файла: карантин → готов или отклонён; дольше лимита — подсказка, файл появится позже. */
  const watch = async (a: Attempt, fileId: string): Promise<void> => {
    for (let i = 0; i < pollMax && live(a); i++) {
      await new Promise((r) => setTimeout(r, pollMs));
      const r = await api.GET('/api/v1/tenants/{tenantId}/files/{fileId}', {
        params: { path: { tenantId, fileId } },
      });
      if (!live(a) || !r.data) continue;
      if (r.data.status === 'ready' || r.data.status === 'rejected') {
        setPhase(r.data.status);
        if (r.data.status === 'ready') onDone?.(r.data);
        return;
      }
    }
    if (live(a)) setSlow(true);
  };

  const start = async (f: File): Promise<void> => {
    // Прежняя попытка (отменённая или сбойная) больше не управляет диалогом.
    void cancelAttempt(attempt.current);
    const a: Attempt = {
      cancelled: false,
      open: false,
      session: null,
      ctrl: new AbortController(),
    };
    attempt.current = a;
    setPicked(f);
    setError(null);
    setRetryable(false);
    setSlow(false);
    setProgress(0);
    setPhase('uploading');
    let transfer = false;
    let completing = false;
    try {
      // Фото уходит без геоданных (W2.44, ПДн §6); остальные файлы — как есть.
      const body = await stripFileMetadata(f);
      const sum = await sha256(body);
      const ticket = await unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/files/uploads', {
          params: { path: { tenantId }, header: idem() },
          body: {
            fileName: f.name,
            contentType: f.type || 'application/octet-stream',
            sizeBytes: body.size,
            sha256: sum,
            purpose,
            owner,
          },
        }),
      );
      a.session = { uploadId: ticket.uploadId, fileId: ticket.fileId };
      a.open = true;
      // «Отменить загрузку», закрытие или новый файл до ответа initiateUpload: сессию отменяем, PUT не выполняем.
      if (a.cancelled) {
        await cancelAttempt(a);
        return;
      }
      transfer = true;
      await put(
        ticket.uploadUrl,
        body,
        ticket.requiredContentType,
        a.ctrl.signal,
        (loaded, total) => {
          if (live(a) && total > 0) setProgress(Math.min(100, Math.floor((loaded / total) * 100)));
        },
      );
      transfer = false;
      if (a.cancelled) return;
      // Файл передан: «Отменить загрузку» скрывается, закрытие не отменяет сессию, пока сервер сверяет файл.
      a.open = false;
      setPhase('scanning');
      completing = true;
      const done = await unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}/complete', {
          params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
          body: { sha256: sum },
        }),
      );
      completing = false;
      if (!live(a)) return;
      if (done.status === 'ready') {
        setPhase('ready');
        onDone?.(done);
        return;
      }
      setPhase('scanning');
      await watch(a, ticket.fileId);
    } catch (e) {
      if (completing) {
        // completeUpload отказал (сеть, сервер, сверка): сессия осталась с резервом места — снова отменяемая.
        // Диалог уже закрыт или выбран другой файл — отменяем сразу (409 на DELETE глушится).
        a.open = true;
        if (!live(a)) {
          await cancelAttempt(a);
          return;
        }
      }
      if (!live(a)) return;
      setPhase('failed');
      const problem = e instanceof ProblemError && !transfer;
      // Нет связи с API — тот же текст, что на других экранах (errors.client.offline); сбой PUT — свой текст.
      const offline = e instanceof TypeError && !transfer;
      setError(problem || offline ? problemText(e) : U.failed);
      // Повтор того же файла — после сбоя передачи, сети или сервера; отказ по существу (payload_too_large,
      // quota_exceeded, validation_failed…) он не исправит — остаётся выбрать другой файл.
      setRetryable(!problem || e.status >= 500 || e.problem?.retryable === true);
    }
  };

  const abort = async (): Promise<void> => {
    await cancelAttempt(attempt.current);
    if (alive.current) setPhase('aborted');
  };

  const status = STATUS[phase];
  const host = document.querySelector('.ox-frame') ?? document.body;
  return createPortal(
    <div
      className="ox-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        className="ox-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        tabIndex={-1}
      >
        <div className="ox-confirm">
          <div className="ox-confirm-head">
            <span className="ox-confirm-chip" data-tone="info">
              <Icon name="upload" size={22} />
            </span>
            <div className="ox-confirm-headtext">
              <h2 id="upload-title" className="ox-confirm-title">
                {U.title}
              </h2>
              {picked ? <p className="ox-confirm-text ox-up-name">{picked.name}</p> : null}
            </div>
          </div>
          {PICK.has(phase) ? (
            <label className="ox-up-pick">
              <Icon name="attach_file" size={20} />
              {U.pick}
              <input
                type="file"
                className="ox-up-input"
                aria-label={U.pick}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void start(f);
                }}
              />
            </label>
          ) : null}
          {status ? (
            <p className="ox-up-status" role="status">
              {status}
            </p>
          ) : null}
          {phase === 'uploading' ? (
            <div className="ox-up-progress">
              <div
                className="ox-mod-bar"
                role="progressbar"
                aria-label={U.uploading}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-valuetext={t(U.percent, { n: progress })}
              >
                <div className="ox-mod-bar-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="ox-up-percent" aria-hidden="true">
                {t(U.percent, { n: progress })}
              </span>
            </div>
          ) : null}
          {slow && phase === 'scanning' ? <p className="ox-up-note">{U.slow}</p> : null}
          {error ? (
            <p className="ox-st-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="ox-confirm-foot">
            {phase === 'uploading' ? (
              <button type="button" className="ox-confirm-cancel" onClick={() => void abort()}>
                {U.cancel}
              </button>
            ) : null}
            {phase === 'failed' && retryable && picked ? (
              <button
                type="button"
                className="ox-confirm-cancel"
                onClick={() => void start(picked)}
              >
                {U.retry}
              </button>
            ) : null}
            <button type="button" className="ox-confirm-ok" onClick={close}>
              {shell.modal.close}
            </button>
          </div>
        </div>
      </div>
    </div>,
    host,
  );
}
