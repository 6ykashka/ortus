// W4.23 · Вкладка «Ответы» (`forms-responses`; эталон design-2026-10-19 «Формы и опросы.dc.html» dc:411–439, respVM
// dc:986–1011, actsVM dc:907–914; разбор forms.md §1.8): «Сводка» (`getFormResponseSummary`), «Лента» (карточка ответа
// по структуре его версии и «Журнал действий» с «Открыть страницу» и «Повторить» — `retryFormResponseAction`),
// «Таблица», «Выгрузить CSV» (`exportFormResponses`). Выбранный ответ — `&resp=` адреса (переход из задачи и «Данных»,
// dc:530–537). «Принять» / «Отклонить» ответа на проверке — `reviewFormResponse` (no-reference, Q-W4.00-forms-18).
import { format, formsResults as F } from '@ortus/texts';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';

import { commands, useForm, useResponses, useSummary, useVersions } from './api.ts';
import { useOpenKb } from './actions.tsx';
import { Failed, Glyph, Pending, useApi, useCmd } from './ctx.tsx';
import {
  cardNote,
  cardRows,
  countText,
  dayTime,
  emptyText,
  feedTitle,
  type Form,
  journal,
  respColumns,
  type Response,
  statCards,
  tableRow,
  type Version,
} from './model.ts';
import { FR_TEXT } from './texts.ts';
import './results.css';

const R = F.responses;
type View = 'stats' | 'feed' | 'table';

/** Скачать CSV сервера (имя «{форма}.csv»; BOM и «;» — в содержимом, dc:679–683). */
export function downloadCsv(name: string, content: string): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/** «Выгрузить CSV» / «Выгрузить ответы в CSV»: команда с тостом «нет связи» и текстом сервера. */
export function useExportCsv(tenantId: string, formId: string): () => Promise<void> {
  const api = useApi();
  const { cmd } = useCmd(tenantId);
  return async () => {
    const r = await cmd(
      ['export', formId, Date.now()],
      () => commands.exportCsv(api, tenantId, formId),
      null,
    );
    if (r.ok && r.data) downloadCsv(r.data.fileName, r.data.content);
  };
}

const STATUS_TONE = { accepted: 'ok', pending: 'warn', rejected: 'danger' } as const;
const statusText = (r: Response): string =>
  r.reviewStatus === 'accepted'
    ? R.status.accepted
    : r.reviewStatus === 'rejected'
      ? FR_TEXT.status.rejected
      : FR_TEXT.status.pending;

function Stats({ tenantId, formId }: { tenantId: string; formId: string }): ReactElement {
  const q = useSummary(tenantId, formId, true);
  if (q.isPending) return <Pending rows={3} />;
  if (q.isError) return <Failed q={q} />;
  return (
    <div className="ox-fr-stats">
      {statCards(q.data).map((c, i) => (
        <div key={i} className="ox-fr-stat">
          <div className="ox-fr-stat-head">
            <strong>{c.label}</strong>
            <span>{c.meta}</span>
          </div>
          {c.bars.map((b, j) => (
            <div key={j} className="ox-fr-bar">
              <span className="ox-fr-bar-head">
                <span>{b.label}</span>
                <span className="ox-fr-bar-n">{format(R.stats.bar, { n: b.n, pct: b.pct })}</span>
              </span>
              <div className="ox-fr-bar-track">
                <div style={{ width: b.pct }} />
              </div>
            </div>
          ))}
          {c.numText !== null ? <span className="ox-fr-stat-num">{c.numText}</span> : null}
          {c.texts !== null ? (
            <>
              {c.texts.map((t, j) => (
                <span key={j} className="ox-fr-stat-text">
                  {t}
                </span>
              ))}
              {!c.texts.length ? <span className="ox-fr-stat-none">{R.stats.noTexts}</span> : null}
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Feed(p: {
  tenantId: string;
  form: Form;
  list: readonly Response[];
  versions: readonly Version[];
  sel: string | undefined;
  onSel: (id: string) => void;
}): ReactElement {
  const api = useApi();
  const { cmd, busy } = useCmd(p.tenantId);
  const openKb = useOpenKb(p.tenantId);
  const f = p.form;
  const r0 = p.list.find((r) => r.id === p.sel) ?? p.list[0];
  if (!r0) return <></>;
  const ver = p.versions.find((v) => v.number === r0.versionNumber)?.definition;
  const lines = journal(r0, f.my.manage, FR_TEXT.failed);
  const J = R.journal;
  const retry = (ruleId: string, kb: boolean) =>
    void cmd(
      ['retry', r0.id, ruleId],
      (key) => commands.retry(api, p.tenantId, f.id, r0.id, ruleId, key),
      kb ? format(J.retried, { id: r0.number }) : null,
    );
  const review = (status: 'accepted' | 'rejected') =>
    void cmd(
      ['review', r0.id, status],
      (key) => commands.review(api, p.tenantId, f.id, r0, status, key),
      format(status === 'accepted' ? FR_TEXT.accepted : FR_TEXT.rejected, { id: r0.number }),
    );
  return (
    <div className="ox-fr-feedwrap">
      <div className="ox-fr-feed">
        {p.list.map((r, i) => {
          const a = r.id === r0.id;
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={a}
              data-first={i === 0 || undefined}
              onClick={() => p.onSel(r.id)}
            >
              <span className="ox-fr-feed-main">
                <span className="ox-fr-feed-title">{feedTitle(r)}</span>
                <span className="ox-fr-feed-by">
                  {format(R.feed.by, { author: r.author.displayName, at: dayTime(r.submittedAt) })}
                </span>
              </span>
              <span className="ox-fr-ver-chip">
                {format(R.feed.version, { v: r.versionNumber })}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ox-fr-feed-side">
        <div className="ox-fr-resp">
          <div className="ox-fr-resp-head">
            <h3>{feedTitle(r0)}</h3>
            <span className="ox-fr-resp-status" data-tone={STATUS_TONE[r0.reviewStatus]}>
              {statusText(r0)}
            </span>
          </div>
          <span className="ox-fr-resp-note">{cardNote(r0, f)}</span>
          {r0.reviewStatus === 'pending' && r0.my.review ? (
            <div className="ox-fr-resp-review">
              <button
                type="button"
                className="ox-fr-btn"
                data-primary=""
                aria-disabled={busy || undefined}
                onClick={() => !busy && review('accepted')}
              >
                {FR_TEXT.accept}
              </button>
              <button
                type="button"
                className="ox-fr-btn"
                data-plain=""
                aria-disabled={busy || undefined}
                onClick={() => !busy && review('rejected')}
              >
                {FR_TEXT.reject}
              </button>
            </div>
          ) : null}
          <div className="ox-fr-resp-rows">
            {cardRows(r0, ver).map((x, i) => (
              <div key={i} className="ox-fr-resp-row">
                <span>{x.label}</span>
                <span data-muted={x.muted || undefined}>{x.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="ox-fr-journal">
          <h3>{J.title}</h3>
          {lines.map((l, i) => (
            <div key={i} className="ox-fr-jline" data-fail={!l.ok || undefined}>
              <Glyph name={l.icon} size={18} />
              <span className="ox-fr-jtext">{l.text}</span>
              {l.nodeId ? (
                <button
                  type="button"
                  className="ox-fr-btn"
                  data-small=""
                  onClick={() => l.nodeId && void openKb(l.nodeId)}
                >
                  <Glyph name="open_in_new" size={16} />
                  {J.open}
                </button>
              ) : null}
              {l.retry ? (
                <button
                  type="button"
                  className="ox-fr-btn"
                  data-small=""
                  data-danger=""
                  aria-disabled={busy || undefined}
                  onClick={() =>
                    !busy &&
                    retry(l.ruleId, r0.actions.find((a) => a.ruleId === l.ruleId)?.kind === 'kb')
                  }
                >
                  <Glyph name="refresh" size={16} />
                  {J.retry}
                </button>
              ) : null}
            </div>
          ))}
          {!lines.length ? <span className="ox-fr-note">{J.none}</span> : null}
          <span className="ox-fr-jidem">{J.idem}</span>
        </div>
      </div>
    </div>
  );
}

export function ResponsesTab({
  tenantId,
  formId,
}: {
  tenantId: string;
  formId: string;
}): ReactElement {
  const fq = useForm(tenantId, formId);
  const rs = useResponses(tenantId, formId);
  const versions = useVersions(tenantId, formId);
  const csv = useExportCsv(tenantId, formId);
  const navigate = useNavigate();
  const loc = useLocation();
  const search = loc.search as Record<string, unknown>;
  const sel = typeof search.resp === 'string' ? search.resp : undefined;
  const [view, setView] = useState<View>(sel ? 'feed' : 'stats');

  // Ошибка — карточкой, только если данных нет: отказ перечитывания при данных в кэше вкладку не роняет.
  const bad =
    !fq.data && fq.isError
      ? fq
      : !rs.data && rs.isError
        ? rs
        : !versions.data && versions.isError
          ? versions
          : null;
  if (bad || !fq.data || !rs.data || !versions.data)
    return <div className="ox-fr-rs">{bad ? <Failed q={bad} /> : <Pending rows={3} />}</div>;
  const f = fq.data.form;
  const list = rs.data;
  const n = list.length;
  const onSel = (id: string) =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'forms' },
      search: { ...search, resp: id } as never,
      replace: true,
    });
  const cols = respColumns(versions.data, undefined);
  const VIEWS: [View, string][] = [
    ['stats', R.views.stats],
    ['feed', R.views.feed],
    ['table', R.views.table],
  ];

  return (
    <div className="ox-fr-rs">
      <div className="ox-fr-rs-bar">
        <div role="group" aria-label={R.viewsAria} className="ox-fr-seg">
          {VIEWS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>
              {l}
            </button>
          ))}
        </div>
        <span className="ox-fr-rs-count">{countText(n)}</span>
        <button
          type="button"
          className="ox-fr-btn"
          data-h38=""
          disabled={!n}
          onClick={() => void csv()}
        >
          <Glyph name="download" size={18} />
          {R.csv}
        </button>
      </div>
      {!n ? <div className="ox-fr-rs-empty">{emptyText(f)}</div> : null}
      {n > 0 && view === 'stats' ? <Stats tenantId={tenantId} formId={formId} /> : null}
      {n > 0 && view === 'feed' ? (
        <Feed
          tenantId={tenantId}
          form={f}
          list={list}
          versions={versions.data}
          sel={sel}
          onSel={onSel}
        />
      ) : null}
      {n > 0 && view === 'table' ? (
        // tabIndex — прокрутка таблицы с клавиатуры (axe scrollable-region-focusable, PD-28).
        <div className="ox-fr-table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {[
                  R.cols.id,
                  R.cols.at,
                  R.cols.author,
                  R.cols.object,
                  R.cols.version,
                  ...cols.map((c) => c.label),
                ].map((c, i) => (
                  <th key={i} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  {tableRow(r, cols, versions.data).map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
