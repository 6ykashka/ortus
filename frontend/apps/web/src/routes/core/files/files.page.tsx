// W1.24 · Страница «Файлы» (`core-files`, S1-20, S1-21; эталон design-stage-1 «Ортус CRM.dc.html» :1858–1868,
// filesVM :4219–4231; 06 §8). Список — listFiles (файл без доступа к родителю сервер не отдаёт), «Открыть» —
// короткая ссылка getFileDownload (проверка родителя и ready на сервере, Q-W1.24-9), место — getStorageUsage
// только при billing.read (Q-W1.24-11), «Показать ещё» по курсору (Q-W1.24-12).
import { unwrap } from '@ortus/api-client';
import { company, shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type ReactElement, useEffect, useId, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { useRun } from '../../../shell/run.tsx';
import { useStorageUsage } from '../../company/modules/api.ts';
import { Glyph, LoadFailed, UsageBar, useRetryFocus } from '../../company/modules/ui.tsx';
import { FILES_TEXT } from './texts.ts';
import { type FileRow, fileRow, filesUsage, safeDownloadUrl } from './vm.ts';
import '../../company/modules/modules.css';
import './files.css';

const filesKey = (tenantId: string) => ['tenant', tenantId, 'files'] as const;

function useFiles(tenantId: string) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: filesKey(tenantId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/files', {
          params: { path: { tenantId }, query: pageParam ? { cursor: pageParam } : {} },
        }),
      ),
  });
}

/**
 * Место организации владельца (:1861); без billing.read карточки нет. Пока идёт запрос, карточка уже занимает
 * своё место (заголовок и пустая полоса, aria-busy) — список под ней не сдвигается; ошибка — alert по коду и
 * «Повторить» в карточке.
 */
function Usage({ tenantId }: { tenantId: string }): ReactElement {
  const usage = useStorageUsage(tenantId);
  const titleId = useId();
  // «Повторить»: место пришло — фокус на заголовке карточки (кнопка исчезла вместе с ошибкой), а не на body.
  const retry = useRetryFocus(usage.isSuccess, () => document.getElementById(titleId));
  const title = (
    <strong id={titleId} className="ox-files-usage-title" tabIndex={-1}>
      {company.modules.storage.title}
    </strong>
  );
  if (usage.isError) {
    // Заголовок карточки остаётся; «Повторить» описан им (что именно повторяется).
    return (
      <div className="ox-files-usage">
        <div className="ox-files-usage-top">{title}</div>
        <LoadFailed
          error={usage.error}
          onRetry={retry(() => usage.refetch())}
          describedBy={titleId}
        />
      </div>
    );
  }
  if (!usage.data) {
    return (
      <div className="ox-files-usage" aria-busy="true">
        <div className="ox-files-usage-top">{title}</div>
        <span className="ox-files-usage-skel" />
      </div>
    );
  }
  const v = filesUsage(usage.data);
  return (
    <div className="ox-files-usage">
      <div className="ox-files-usage-top">
        {title}
        <span className="ox-files-usage-text">{v.text}</span>
      </div>
      <UsageBar pct={v.pct} tone={v.tone} />
    </div>
  );
}

/** Скелетон списка (без подписи оболочки «Загружаем рабочее пространство…»). */
function ListSkeleton(): ReactElement {
  return (
    <div className="ox-files-list" role="status" aria-label={shell.a11y.loading}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="ox-files-skel-row" data-first={i === 0 || undefined}>
          <span className="ox-files-skel" data-size="icon" />
          <span className="ox-files-skel" data-size="name" />
        </div>
      ))}
    </div>
  );
}

function Row({ row, first, onOpen }: { row: FileRow; first: boolean; onOpen: () => void }) {
  const nameId = `file-${row.id}`;
  return (
    <div className="ox-files-row" data-first={first || undefined} tabIndex={-1}>
      <Icon name={row.icon} size={22} className="ox-files-icon" />
      <div className="ox-files-main">
        <div className="ox-files-name" id={nameId}>
          {row.name}
        </div>
        <div className="ox-files-parent">{row.parent}</div>
      </div>
      <span className="ox-files-state">
        <span className="ox-files-chip" data-tone={row.chip.tone}>
          <Glyph name={row.chip.icon} className="ox-files-chip-icon" />
          {row.chip.label}
        </span>
      </span>
      <span className="ox-files-size">{row.size}</span>
      <button
        type="button"
        className="ox-files-open"
        disabled={!row.ready}
        aria-describedby={nameId}
        onClick={onOpen}
      >
        {FILES_TEXT.open}
      </button>
    </div>
  );
}

export default function FilesPage(): ReactElement {
  const { tenantId: id } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const api = useApi();
  const run = useRun();
  const files = useFiles(tenantId);
  const list = useRef<HTMLDivElement>(null);
  /** Индекс строки, которая получит фокус, когда догрузится следующая страница. */
  const focusRow = useRef<number | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // «Повторить» списка: список пришёл — фокус на заголовке страницы, как у «Модулей и места» и «Хранилища».
  const retryList = useRetryFocus(files.isSuccess, () => document.getElementById('h-files'));

  /**
   * Вкладка открывается синхронно в жесте пользователя (иначе Safari и Firefox блокируют её как всплывающее
   * окно), адрес подставляется после короткой ссылки; отказ сервера закрывает пустую вкладку. Если браузер
   * вкладку не дал — ссылка открывается после ответа.
   */
  const open = (fileId: string): void => {
    const tab = window.open('', '_blank');
    void run('download', async () => {
      const t = await unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/files/{fileId}/download', {
          params: { path: { tenantId, fileId } },
        }),
      );
      // Только http(s): иначе тост «Ошибка» команды, пустая вкладка закрывается.
      const url = safeDownloadUrl(t.downloadUrl);
      if (!url) throw new Error('downloadUrl: схема не http(s)');
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }).catch(() => tab?.close());
  };

  const rows = (files.data?.pages ?? []).flatMap((p) => p.items.map(fileRow));

  // «Показать ещё» недоступна на время запроса и исчезает после последней страницы — фокус не на body:
  // на первую догруженную строку; следующая страница пустая — на последнюю строку; отказ — на «Показать ещё».
  // Запрос короткий, и «идёт запрос» с «готово» могут прийти одним рендером, поэтому фокус ставится по
  // завершению fetchNextPage (`moreDone`), а не по смене состояния запроса.
  const [moreDone, setMoreDone] = useState(0);
  useEffect(() => {
    const from = focusRow.current;
    if (from === null) return;
    focusRow.current = null;
    if (files.isFetchNextPageError && moreRef.current) {
      moreRef.current.focus();
      return;
    }
    const all = list.current?.querySelectorAll<HTMLElement>('.ox-files-row');
    if (!all || all.length === 0) return;
    (all[from] ?? all[all.length - 1])?.focus();
    // Только по завершению «Показать ещё»; состояние запроса читается на этом рендере.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreDone]);

  const more = (): void => {
    focusRow.current = rows.length;
    void files.fetchNextPage().finally(() => setMoreDone((n) => n + 1));
  };
  return (
    <section aria-labelledby="h-files" className="ox-files">
      <div>
        <h1 id="h-files" className="ox-files-title" tabIndex={-1}>
          {shell.nav.items.files}
        </h1>
        <p className="ox-files-intro">{FILES_TEXT.intro}</p>
      </div>
      {can('billing.read') ? <Usage tenantId={tenantId} /> : null}
      {files.isPending ? (
        <ListSkeleton />
      ) : files.isError ? (
        <LoadFailed error={files.error} onRetry={retryList(() => files.refetch())} />
      ) : (
        <div ref={list} className="ox-files-list">
          {rows.map((r, i) => (
            <Row key={r.id} row={r} first={i === 0} onOpen={() => open(r.id)} />
          ))}
          {rows.length === 0 ? <div className="ox-files-empty">{FILES_TEXT.empty}</div> : null}
        </div>
      )}
      {files.hasNextPage ? (
        <button
          ref={moreRef}
          type="button"
          className="ox-mod-btn"
          data-variant="secondary"
          disabled={files.isFetchingNextPage}
          onClick={more}
        >
          {FILES_TEXT.more}
        </button>
      ) : null}
      <p className="ox-files-note">{FILES_TEXT.states}</p>
    </section>
  );
}
