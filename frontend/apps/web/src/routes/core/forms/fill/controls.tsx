// W4.70 · Поля заполнения формы вместо демонстрационных полей предпросмотра: «Файл или фото» (загрузка с ходом и
// проверкой, «Убрать», лимиты вопроса) и вопросы CRM «Сотрудник», «Регион или фирма», «Объект CRM» (варианты
// `listFormFieldOptions` по правам отвечающего, поиск при усечённом списке — Q-W4.00-forms-23). Файлы держит
// хранилище страницы (`FileStore`): поле на странице формы может размонтироваться, загрузка и проверка — нет.
import { type components, unwrap } from '@ortus/api-client';
import { format, forms as F } from '@ortus/texts';
import { useQuery } from '@tanstack/react-query';
import { type ReactElement, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { problemText } from '../../../../shell/run.tsx';
import { formsKey } from '../api.ts';
import { Glyph } from '../parts.tsx';
import type { FieldA11y } from '../preview.tsx';
import { acceptOf } from './model.ts';
import type { StatusOf, Uploader } from './upload.ts';

type S = components['schemas'];
type Question = S['FormQuestion'];

/** Файл поля: передаётся, проверяется, готов, не загрузился, отклонён проверкой. */
export interface FileItem {
  id: number;
  name: string;
  phase: 'uploading' | 'scanning' | 'ready' | 'failed' | 'rejected';
  fileId?: string;
  error?: string;
}

const POLL_MS = 1500;
const POLL_MAX = 200;

/** Файлы ответа по вопросам: загрузка и опрос проверки живут дольше поля на странице формы. */
export class FileStore {
  private items = new Map<string, FileItem[]>();
  private listeners = new Set<() => void>();
  private seq = 0;
  private version = 0;
  private alive = true;

  constructor(
    private readonly upload: Uploader,
    private readonly status?: StatusOf,
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = (): number => this.version;

  get(key: string): readonly FileItem[] {
    return this.items.get(key) ?? [];
  }

  /** Файлы, которые уходят с ответом: переданные (у сотрудника — сразу, у гостя проверку ждёт отправка). */
  ids(key: string): string[] {
    return this.get(key).flatMap((x) =>
      (x.phase === 'ready' || x.phase === 'scanning') && x.fileId ? [x.fileId] : [],
    );
  }

  /** Вопросы, у которых файл ещё передаётся или проверяется. */
  pending(): string[] {
    return [...this.items]
      .filter(([, xs]) => xs.some((x) => x.phase === 'uploading' || x.phase === 'scanning'))
      .map(([k]) => k);
  }

  /** Страница на месте (StrictMode монтирует эффекты дважды: остановка и снова старт). */
  start(): void {
    this.alive = true;
  }

  stop(): void {
    this.alive = false;
  }

  add(key: string, file: File): void {
    const item: FileItem = { id: ++this.seq, name: file.name, phase: 'uploading' };
    this.set(key, [...this.get(key), item]);
    this.upload(file, key).then(
      (r) => {
        const scan = Boolean(this.status) && r.status !== 'ready';
        this.patch(key, item.id, { fileId: r.fileId, phase: scan ? 'scanning' : 'ready' });
        if (scan) this.poll(key, item.id, r.fileId, 0);
      },
      (e: unknown) => this.patch(key, item.id, { phase: 'failed', error: problemText(e) }),
    );
  }

  remove(key: string, id: number): void {
    this.set(
      key,
      this.get(key).filter((x) => x.id !== id),
    );
  }

  private poll(key: string, id: number, fileId: string, n: number): void {
    if (!this.alive || n >= POLL_MAX || !this.status) return;
    setTimeout(() => {
      if (!this.alive || !this.get(key).some((x) => x.id === id)) return;
      this.status?.(fileId).then(
        (s) => {
          if (s === 'ready') this.patch(key, id, { phase: 'ready' });
          else if (s === 'rejected') this.patch(key, id, { phase: 'rejected' });
          else this.poll(key, id, fileId, n + 1);
        },
        () => this.poll(key, id, fileId, n + 1),
      );
    }, POLL_MS);
  }

  private patch(key: string, id: number, x: Partial<FileItem>): void {
    this.set(
      key,
      this.get(key).map((y) => (y.id === id ? { ...y, ...x } : y)),
    );
  }

  private set(key: string, xs: FileItem[]): void {
    this.items.set(key, xs);
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

const itemText = (x: FileItem): string => {
  if (x.phase === 'uploading') return format(F.fill.uploading, { name: x.name });
  if (x.phase === 'scanning') return format(F.fill.scanning, { name: x.name });
  if (x.phase === 'failed')
    return format(F.fill.uploadFailed, { name: x.name, error: x.error ?? '' });
  if (x.phase === 'rejected') return format(F.fill.rejected, { name: x.name });
  return x.name;
};

/** «Файл или фото»: выбор файлов, ход загрузки и проверки, «Убрать»; не больше N файлов, до M МБ. */
export function FileField(p: {
  x: Question;
  store: FileStore;
  maxMb: number;
  value: string | string[] | undefined;
  setV: (v: string[]) => void;
  a11y: FieldA11y;
}): ReactElement {
  const { x, store } = p;
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const items = store.get(x.key);
  const max = x.maxFiles ?? 5;
  const ready = items.filter((i) => i.phase === 'ready').length;
  // Значение рендера (обязательность вопроса) — переданные файлы хранилища; setV рендера новый на каждом кадре.
  const sync = useRef({ setV: p.setV, value: p.value });
  useEffect(() => {
    sync.current = { setV: p.setV, value: p.value };
  });
  const joined = store.ids(x.key).join(',');
  useEffect(() => {
    const cur = sync.current.value;
    if ((Array.isArray(cur) ? cur.join(',') : '') !== joined) {
      sync.current.setV(joined ? joined.split(',') : []);
    }
  }, [joined]);

  const choose = (files: FileList | null) => {
    setNote('');
    const list = [...(files ?? [])];
    const live = items.filter((i) => i.phase !== 'failed' && i.phase !== 'rejected').length;
    if (live + list.length > max) {
      setNote(format(F.fill.tooMany, { n: max }));
      return;
    }
    const big = list.find((f) => f.size > p.maxMb * 1024 * 1024);
    if (big) {
      setNote(format(F.fill.tooBig, { mb: p.maxMb }));
      return;
    }
    for (const f of list) store.add(x.key, f);
    if (input.current) input.current.value = '';
  };

  return (
    <div className="ox-fm-pv-file ox-ff-files">
      <button
        type="button"
        className="ox-fm-pv-attach"
        aria-describedby={p.a11y.describedBy}
        onClick={() => input.current?.click()}
      >
        <Glyph name="attach_file" size={18} />
        {F.fill.attach}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple={max > 1}
        accept={acceptOf(x)}
        aria-label={F.fill.attach}
        onChange={(e) => choose(e.currentTarget.files)}
      />
      <span>
        {ready
          ? format(F.preview.files, { n: ready, max })
          : format(F.preview.filesNone, { max, mb: p.maxMb })}
      </span>
      {items.length ? (
        <ul className="ox-ff-file-list">
          {items.map((i) => (
            <li key={i.id} data-phase={i.phase}>
              <span>{itemText(i)}</span>
              <button
                type="button"
                className="ox-ff-file-remove"
                aria-label={format(F.fill.remove, { name: i.name })}
                onClick={() => store.remove(x.key, i.id)}
              >
                <Glyph name="close" size={18} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {note ? (
        <span className="ox-fm-pv-err" role="status">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** Вопрос CRM: варианты по правам отвечающего; выбранная ссылка — в `refs` страницы (значение ответа — id). */
export function CrmSelect(p: {
  x: Question;
  tenantId: string;
  formId: string;
  value: string;
  setV: (v: string) => void;
  refs: Map<string, S['ObjectRef']>;
  a11y: FieldA11y;
}): ReactElement {
  const api = useApi();
  const [q, setQ] = useState('');
  const { x, tenantId, formId } = p;
  const opts = useQuery({
    queryKey: [...formsKey(tenantId), 'field-options', formId, x.key, q],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/forms/{formId}/fields/{fieldKey}/options', {
          params: { path: { tenantId, formId, fieldKey: x.key }, query: q ? { q } : {} },
        }),
      ),
  });
  const items = opts.data?.items ?? [];
  for (const o of items) p.refs.set(o.ref.entityId, o.ref);
  const search = Boolean(opts.data?.truncated) || q !== '';
  return (
    <>
      {search ? (
        <input
          type="search"
          className="ox-fm-pv-input"
          value={q}
          aria-label={format(F.fill.searchAria, { label: x.label })}
          onChange={(e) => setQ(e.target.value.slice(0, 100))}
        />
      ) : null}
      <select
        className="ox-fm-pv-select"
        value={p.value}
        aria-label={x.label}
        aria-invalid={p.a11y.invalid || undefined}
        aria-describedby={p.a11y.describedBy}
        data-error={p.a11y.invalid ? '' : undefined}
        onChange={(e) => p.setV(e.target.value)}
      >
        <option value="">{F.preview.choose}</option>
        {items.map((o) => (
          <option key={o.ref.entityId} value={o.ref.entityId}>
            {o.hint ? `${o.label} · ${o.hint}` : o.label}
          </option>
        ))}
      </select>
      {opts.data?.truncated ? <span className="ox-fm-pv-hint">{F.fill.truncated}</span> : null}
      {opts.data && !items.length ? (
        <span className="ox-fm-pv-hint">{F.fill.noOptions}</span>
      ) : null}
    </>
  );
}
