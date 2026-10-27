// W7.25 · Боковая панель карточки: «Обсуждение» (Д:397–425, talkVM Д:1249–1296), «Версии» и журнал (Д:440–452,
// versVM Д:1298–1310), «Данные» таблицы (Д:454–476) и «Распознавание» / «Инструменты» PDF (Д:478–530). Правка блоков —
// движок (D-32), поэтому комментарий привязывается ко всему документу, ячейке или странице, а не к абзацу.
import type { components } from '@ortus/api-client';
import { shell } from '@ortus/texts';
import { Button, Icon, Select, Skeleton, Textarea, TextInput } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { useRun } from '../../shell/run.tsx';
import { useToast } from '../../shell/toast.tsx';
import { LoadFailed } from '../company/modules/ui.tsx';
import {
  commands,
  docsKey,
  idemKeys,
  useActivity,
  useComments,
  useJob,
  useMembers,
  useVersions,
} from './api.ts';
import { reasonOf } from './cmd.ts';
import type { DocsCtx } from './ctx.ts';
import { anchorText, fill, initials, stampOf, versionSource, wordsText } from './model.ts';
import { DOCS_TEXT as T } from './texts.ts';

type S = components['schemas'];

function Pending(): ReactElement {
  return (
    <div role="status" aria-label={shell.a11y.loading} className="ox-docs-skel">
      <Skeleton shape="block" />
    </div>
  );
}

// ───────────────────────────── Обсуждение ─────────────────────────────

function Thread(p: {
  ctx: DocsCtx;
  doc: S['Document'];
  c: S['DocComment'];
  people: ReadonlyMap<string, S['Member']>;
  onChanged: () => void;
}): ReactElement {
  const { ctx, doc, c } = p;
  const api = useApi();
  const run = useRun();
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const known = new Set<string>([
    doc.owner.memberId,
    ...doc.authors.map((a) => a.memberId),
    ...doc.shares.filter((s) => s.who === 'member' && s.refId).map((s) => s.refId as string),
    ...doc.tempGrants.map((g) => g.member.memberId),
  ]);
  const unseen = c.mention && !c.resolved && !known.has(c.mention.memberId);

  const act = async (fn: () => Promise<unknown>, ok: string | null): Promise<void> => {
    setBusy(true);
    setErr(undefined);
    try {
      await run('docs.talk', fn, ok, { quiet: ['validation_failed'] });
      p.onChanged();
    } catch (e) {
      setErr(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const mentionName = c.mention?.displayName ?? '';
  return (
    <li className="ox-docs-thread" data-resolved={c.resolved ? '' : undefined}>
      <div className="ox-docs-thread-head">
        <span className="ox-docs-avatar" aria-hidden="true">
          {initials(c.author.displayName)}
        </span>
        <span className="ox-docs-thread-meta">
          <strong>{c.author.displayName}</strong>
          <span className="ox-docs-hint">{stampOf(c.createdAt)}</span>
        </span>
      </div>
      <span className="ox-docs-anchor">{anchorText(c.anchor)}</span>
      <p className="ox-docs-thread-text">{c.text}</p>
      {c.mention ? (
        <span className="ox-docs-mention">
          <Icon name="alternate_email" size={15} />
          {mentionName}
        </span>
      ) : null}
      {unseen ? (
        <div
          className="ox-docs-warn"
          role="group"
          aria-label={fill(T.talk.needGrant, { name: mentionName })}
        >
          <span>{fill(T.talk.needGrant, { name: mentionName })}</span>
          {doc.my.can.share ? (
            <span className="ox-docs-warn-actions">
              <button
                type="button"
                className="ox-docs-link-btn"
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      commands.grant(api, ctx.tenantId, doc.id, {
                        memberId: c.mention?.memberId ?? '',
                        level: 'comment',
                      }),
                    T.talk.granted,
                  )
                }
              >
                {T.talk.grant}
              </button>
              <button
                type="button"
                className="ox-docs-link-btn"
                disabled={busy}
                onClick={() =>
                  void act(() => commands.skipGrant(api, ctx.tenantId, doc.id, c.id), null)
                }
              >
                {T.talk.skip}
              </button>
            </span>
          ) : (
            <span className="ox-docs-hint">{T.talk.onlyOwnerGrant}</span>
          )}
        </div>
      ) : null}
      {c.replies.length ? (
        <ul className="ox-docs-replies">
          {c.replies.map((r) => (
            <li key={r.id}>
              <strong>{r.author.displayName}</strong>{' '}
              <span className="ox-docs-hint">{stampOf(r.at)}</span>
              <p>{r.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {err ? (
        <span role="alert" className="ox-docs-field-err">
          {err}
        </span>
      ) : null}
      {c.resolved ? (
        <span className="ox-docs-hint">
          {fill(T.talk.closed, { name: c.resolvedBy?.displayName ?? '' })}
        </span>
      ) : doc.my.can.comment ? (
        <div className="ox-docs-thread-actions">
          {reply === null ? (
            <button type="button" className="ox-docs-link-btn" onClick={() => setReply('')}>
              {T.talk.reply}
            </button>
          ) : (
            <div className="ox-docs-reply-form">
              <TextInput
                value={reply}
                onChange={setReply}
                placeholder={T.talk.replyPlaceholder}
                aria-label={T.talk.replyAria}
              />
              <Button
                variant="secondary"
                size="compact"
                disabled={busy || !reply.trim()}
                onPress={() =>
                  void act(async () => {
                    await commands.reply(api, ctx.tenantId, doc.id, c.id, { text: reply });
                    setReply(null);
                  }, T.talk.replied)
                }
              >
                {T.talk.send}
              </Button>
            </div>
          )}
          <button
            type="button"
            className="ox-docs-link-btn"
            disabled={busy}
            onClick={() =>
              void act(() => commands.resolve(api, ctx.tenantId, doc.id, c.id), T.talk.resolved)
            }
          >
            {T.talk.close}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function TalkTab(p: { ctx: DocsCtx; doc: S['Document'] }): ReactElement {
  const { ctx, doc } = p;
  const api = useApi();
  const run = useRun();
  const hidden = !!doc.my.onlyVersion;
  const comments = useComments(ctx.tenantId, doc.id, !hidden);
  const members = useMembers(ctx.tenantId, !hidden && doc.my.can.comment);
  const [text, setText] = useState('');
  const [mention, setMention] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const byId = new Map((members.data ?? []).map((m) => [m.id, m]));

  if (hidden) return <p className="ox-docs-hint">{T.talk.hidden}</p>;

  const reload = (): void => {
    void comments.refetch();
    void ctx.refresh();
  };

  const send = async (): Promise<void> => {
    if (!text.trim()) {
      setErr(T.talk.errText);
      return;
    }
    setErr(undefined);
    setBusy(true);
    const anchor: S['DocCommentCreate']['anchor'] =
      doc.kind === 'sheet' && ref.trim()
        ? { kind: 'cell', ref: ref.trim().toUpperCase() }
        : doc.kind === 'pdf' && ref.trim()
          ? { kind: 'page', ref: ref.trim() }
          : { kind: 'block', ref: 'doc' };
    try {
      await run(
        'docs.talk',
        () =>
          commands.comment(api, ctx.tenantId, doc.id, {
            text,
            anchor,
            ...(mention ? { mention } : {}),
          }),
        T.talk.sent,
        { quiet: ['validation_failed'] },
      );
      setText('');
      setMention('');
      setRef('');
      reload();
    } catch (e) {
      setErr(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const items = comments.data ?? [];
  return (
    <div className="ox-docs-talk">
      {comments.isError ? (
        <LoadFailed error={comments.error} onRetry={() => void comments.refetch()} />
      ) : !comments.data ? (
        <Pending />
      ) : items.length ? (
        <ul className="ox-docs-threads">
          {items.map((c) => (
            <Thread key={c.id} ctx={ctx} doc={doc} c={c} people={byId} onChanged={reload} />
          ))}
        </ul>
      ) : (
        <p className="ox-docs-hint">{T.talk.empty}</p>
      )}
      {doc.my.can.comment ? (
        <div className="ox-docs-composer">
          <span className="ox-docs-hint">
            {doc.kind === 'sheet'
              ? 'К ячейке (необязательно, например G5)'
              : doc.kind === 'pdf'
                ? 'К странице (необязательно)'
                : T.talk.anchorDoc}
          </span>
          {doc.kind !== 'text' ? (
            <TextInput
              value={ref}
              onChange={setRef}
              aria-label={doc.kind === 'sheet' ? 'Ячейка' : 'Страница'}
              placeholder={doc.kind === 'sheet' ? 'G5' : '1'}
            />
          ) : null}
          <Textarea
            value={text}
            onChange={setText}
            rows={3}
            aria-label={T.talk.input}
            placeholder={T.talk.input}
          />
          {err ? (
            <span role="alert" className="ox-docs-field-err">
              {err}
            </span>
          ) : null}
          <div className="ox-docs-composer-row">
            <Select
              value={mention}
              onChange={setMention}
              placeholder={T.talk.mention}
              aria-label={T.talk.mention}
              options={(members.data ?? []).map((m) => ({
                value: m.id,
                label:
                  m.status === 'invited'
                    ? fill(T.talk.mentionInvited, { name: m.displayName })
                    : m.displayName,
              }))}
            />
            <Button
              variant="primary"
              size="compact"
              loading={busy}
              loadingLabel={shell.modal.busy}
              onPress={() => void send()}
            >
              {T.talk.send}
            </Button>
          </div>
        </div>
      ) : (
        <p className="ox-docs-hint">{T.talk.noComment}</p>
      )}
    </div>
  );
}

// ───────────────────────────── Версии ─────────────────────────────

export function VersionsTab(p: { ctx: DocsCtx; doc: S['Document'] }): ReactElement {
  const { ctx, doc } = p;
  const api = useApi();
  const run = useRun();
  const versions = useVersions(ctx.tenantId, doc.id, true);
  const activity = useActivity(ctx.tenantId, doc.id, !doc.my.onlyVersion);
  const [name, setName] = useState('');
  const [naming, setNaming] = useState<{ v: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = doc.my.can.edit && ctx.online;

  const act = async (fn: () => Promise<unknown>, ok: string | null): Promise<boolean> => {
    setBusy(true);
    try {
      await run('docs.vers', fn, ok);
      await Promise.all([versions.refetch(), activity.refetch(), ctx.refresh()]);
      return true;
    } catch {
      void ctx.refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const items = versions.data ?? [];
  return (
    <div className="ox-docs-vers">
      {canEdit ? (
        <div className="ox-docs-vers-form">
          <TextInput
            value={name}
            onChange={setName}
            placeholder={T.vers.namePlaceholder}
            aria-label={T.vers.nameAria}
          />
          <Button
            variant="secondary"
            size="compact"
            loading={busy}
            loadingLabel={shell.modal.busy}
            onPress={() =>
              void act(
                () => commands.saveVersion(api, ctx.tenantId, doc.id, name.trim() || undefined),
                T.vers.saved,
              ).then((ok) => {
                if (ok) setName('');
              })
            }
          >
            {T.vers.save}
          </Button>
        </div>
      ) : null}
      <p className="ox-docs-hint">{T.vers.note}</p>
      {versions.isError ? (
        <LoadFailed error={versions.error} onRetry={() => void versions.refetch()} />
      ) : !versions.data ? (
        <Pending />
      ) : (
        <ul className="ox-docs-version-list">
          {items.map((v) => {
            const current = v.version === doc.version;
            return (
              <li
                key={v.version}
                className="ox-docs-version"
                data-current={current ? '' : undefined}
              >
                <span className="ox-docs-version-line">
                  <strong>{`v${v.version}`}</strong>
                  {' · '}
                  {stampOf(v.createdAt)}
                  {' · '}
                  {v.authors.map((a) => a.displayName).join(', ')}
                  {' · '}
                  {versionSource(v.source)}
                  {v.name ? ` · «${v.name}»` : ''}
                  {current ? ` · ${fill(T.vers.current, { v: v.version })}` : ''}
                </span>
                {naming?.v === v.version ? (
                  <span className="ox-docs-vers-form">
                    <TextInput
                      value={naming.text}
                      onChange={(text) => setNaming({ v: v.version, text })}
                      aria-label={fill(T.vers.renamePrompt, { v: v.version })}
                    />
                    <Button
                      variant="secondary"
                      size="compact"
                      disabled={!naming.text.trim() || busy}
                      onPress={() =>
                        void act(
                          () =>
                            commands.nameVersion(
                              api,
                              ctx.tenantId,
                              doc.id,
                              v.version,
                              naming.text.trim(),
                            ),
                          T.vers.named,
                        ).then((ok) => {
                          if (ok) setNaming(null);
                        })
                      }
                    >
                      {T.vers.rename}
                    </Button>
                  </span>
                ) : canEdit ? (
                  <span className="ox-docs-version-actions">
                    <button
                      type="button"
                      className="ox-docs-link-btn"
                      onClick={() => setNaming({ v: v.version, text: v.name ?? '' })}
                    >
                      {`${T.vers.rename} v${v.version}`}
                    </button>
                    {!current ? (
                      <button
                        type="button"
                        className="ox-docs-link-btn"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            async () => {
                              const made = await commands.restoreVersion(
                                api,
                                ctx.tenantId,
                                doc.id,
                                v.version,
                              );
                              return made;
                            },
                            fill(T.vers.restored, { from: v.version, to: doc.version + 1 }),
                          )
                        }
                      >
                        {`${T.vers.restore} v${v.version}`}
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <JobsList ctx={ctx} doc={doc} />
      {!doc.my.onlyVersion ? (
        <section className="ox-docs-journal" aria-label={T.vers.journal}>
          <strong>{T.vers.journal}</strong>
          {activity.data?.length ? (
            <ul>
              {activity.data.map((a) => (
                <li key={a.id}>
                  <span className="ox-docs-hint">{stampOf(a.at)}</span> {a.by.displayName}:{' '}
                  {a.details}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ox-docs-hint">{T.vers.journalEmpty}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Задания ─────────────────────────────

function JobRow(p: {
  ctx: DocsCtx;
  docId: string;
  job: S['DocJob'];
  onOpen: (id: string) => void;
}): ReactElement {
  const { ctx, job } = p;
  const api = useApi();
  const run = useRun();
  const qc = useQueryClient();
  const running = job.status === 'queued' || job.status === 'running';
  const live = useJob(ctx.tenantId, job.id, running);
  const j = live.data ?? job;
  const done = useRef(j.status);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | undefined>();

  useEffect(() => {
    if (done.current !== j.status && (j.status === 'done' || j.status === 'failed')) {
      void qc.invalidateQueries({ queryKey: [...docsKey(ctx.tenantId)] });
    }
    done.current = j.status;
  }, [j.status, qc, ctx.tenantId]);

  const protectedFile = j.status === 'failed' && /парол/i.test(j.error ?? '');
  const retry = async (body: S['DocJobRetry']): Promise<void> => {
    setErr(undefined);
    try {
      await run('docs.job', () => commands.retryJob(api, ctx.tenantId, j.id, body), null, {
        quiet: ['file_password_protected'],
      });
      void live.refetch();
      void qc.invalidateQueries({ queryKey: [...docsKey(ctx.tenantId)] });
    } catch (e) {
      setErr(reasonOf(e));
    }
  };

  return (
    <li className="ox-docs-job" data-status={j.status}>
      <span>
        <Icon
          name={
            j.status === 'done' ? 'check_circle' : j.status === 'failed' ? 'error' : 'hourglass_top'
          }
          size={18}
        />
        <strong>{j.name}</strong>
        {' · '}
        {j.status === 'done'
          ? fill(T.pdf.done, { name: stampOf(j.finishedAt ?? j.createdAt) })
          : j.status === 'failed'
            ? fill(T.pdf.failed, { error: j.error ?? '' })
            : fill(T.pdf.running, { pct: `${j.progress ?? 0} %` })}
      </span>
      {j.status === 'done' && j.resultDocumentId ? (
        <button
          type="button"
          className="ox-docs-link-btn"
          onClick={() => p.onOpen(j.resultDocumentId as string)}
        >
          {T.pdf.openResult}
        </button>
      ) : null}
      {j.status === 'failed' ? (
        protectedFile ? (
          <span className="ox-docs-vers-form">
            <TextInput
              value={pw}
              onChange={setPw}
              aria-label={T.pdf.password}
              placeholder={T.pdf.password}
            />
            <Button variant="secondary" size="compact" onPress={() => void retry({ password: pw })}>
              {T.pdf.passwordRetry}
            </Button>
            <button
              type="button"
              className="ox-docs-link-btn"
              onClick={() => void retry({ dropLocked: true })}
            >
              {T.pdf.dropFile}
            </button>
          </span>
        ) : (
          <button type="button" className="ox-docs-link-btn" onClick={() => void retry({})}>
            {T.pdf.retry}
          </button>
        )
      ) : null}
      {err ? (
        <span role="alert" className="ox-docs-field-err">
          {err}
        </span>
      ) : null}
    </li>
  );
}

export function JobsList(p: { ctx: DocsCtx; doc: S['Document'] }): ReactElement | null {
  if (!p.doc.jobs.length) return null;
  return (
    <section className="ox-docs-jobs" aria-label={T.pdf.jobs}>
      <strong>{T.pdf.jobs}</strong>
      <ul>
        {p.doc.jobs.map((j) => (
          <JobRow
            key={j.id}
            ctx={p.ctx}
            docId={p.doc.id}
            job={j}
            onOpen={(id) => p.ctx.go({ doc: id })}
          />
        ))}
      </ul>
    </section>
  );
}

// ───────────────────────────── Данные (таблица) ─────────────────────────────

export function DataTab(p: { ctx: DocsCtx; doc: S['Document'] }): ReactElement {
  const { ctx, doc } = p;
  const api = useApi();
  const run = useRun();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canSync = doc.my.can.edit && ctx.online;

  const sync = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await run('docs.data', () => commands.syncDataset(api, ctx.tenantId, doc.id), null);
      const note = r.updatedCells ? fill(T.data.syncedN, { n: r.updatedCells }) : T.data.syncedNone;
      await ctx.refresh();
      toast(fill(T.data.synced, { n: note }), 'ok');
    } catch {
      // тост показал `run`
    } finally {
      setBusy(false);
    }
  };

  const who = (r: S['DocProtectedRange']): string =>
    r.who
      .map((e) => e.label ?? '')
      .filter(Boolean)
      .join(', ');
  return (
    <div className="ox-docs-data">
      <section aria-label={T.data.title}>
        <strong>{T.data.title}</strong>
        <p className="ox-docs-hint">{T.data.note}</p>
        <Button
          variant="secondary"
          size="compact"
          icon="sync"
          disabled={!canSync}
          disabledReason={canSync ? undefined : T.menu.needEdit}
          loading={busy}
          loadingLabel={shell.modal.busy}
          onPress={() => void sync()}
        >
          {T.data.sync}
        </Button>
      </section>
      <section aria-label={T.data.ranges}>
        <strong>{T.data.ranges}</strong>
        {doc.protectedRanges.length ? (
          <ul className="ox-docs-ranges">
            {doc.protectedRanges.map((r) => (
              <li key={r.id}>
                <Icon name="lock" size={16} />
                <span>
                  <strong>
                    {fill(T.data.rangeRow, { name: r.name, sheet: r.sheet, range: r.range })}
                  </strong>
                  <span className="ox-docs-hint">{fill(T.data.rangeWho, { who: who(r) })}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ox-docs-hint">{T.data.rangesNone}</p>
        )}
        <p className="ox-docs-hint">{T.data.rangesNote}</p>
      </section>
    </div>
  );
}

// ───────────────────────────── PDF: распознавание и инструменты ─────────────────────────────

export function ToolsTab(p: { ctx: DocsCtx; doc: S['Document'] }): ReactElement {
  const { ctx, doc } = p;
  const api = useApi();
  const run = useRun();
  const [keys] = useState(idemKeys);
  const [busy, setBusy] = useState(false);
  const ocr = doc.ocr;
  const canConvert = doc.my.can.convert && ctx.online && !doc.my.can.locked;
  const pdn = doc.sensitivity === 'pdn';
  const needOcr = !!doc.scan && ocr?.status !== 'done';

  const start = async (op: S['DocJobCreate']['op']): Promise<void> => {
    const body: S['DocJobCreate'] = { op, docIds: [doc.id] };
    setBusy(true);
    try {
      await run(
        'docs.job',
        () => commands.createJob(api, ctx.tenantId, body, keys.key(body)),
        T.pdf.started,
      );
      keys.settle(body);
    } catch {
      // тост показал `run`
    } finally {
      setBusy(false);
      await ctx.refresh();
    }
  };

  const pct = ocr?.confidence !== undefined ? `${Math.round(ocr.confidence * 100)} %` : '';
  return (
    <div className="ox-docs-tools">
      {doc.scan || ocr ? (
        <section aria-label={T.pdf.ocrTitle}>
          <strong>{T.pdf.ocrTitle}</strong>
          <p>
            {pdn
              ? T.pdf.ocrPdn
              : !ocr || ocr.status === 'none'
                ? T.pdf.ocrNone
                : ocr.status === 'queued' || ocr.status === 'running'
                  ? T.pdf.ocrRunning
                  : ocr.status === 'failed'
                    ? T.pdf.ocrFailed
                    : fill(T.pdf.ocrDone, { pct })}
          </p>
          {ocr?.status === 'done' && ocr.doubtful ? (
            <p className="ox-docs-hint">
              {fill(T.pdf.doubtful, { n: wordsText(ocr.doubtful) })}. {T.pdf.reviewLater}
            </p>
          ) : null}
          {ocr?.status === 'done' && !ocr.doubtful ? (
            <p className="ox-docs-hint">{T.pdf.allChecked}</p>
          ) : null}
          {(!ocr || ocr.status === 'none' || ocr.status === 'failed') && doc.scan && !pdn ? (
            <Button
              variant="secondary"
              size="compact"
              icon="document_scanner"
              disabled={!canConvert || busy}
              onPress={() => void start('ocr')}
            >
              {T.pdf.run}
            </Button>
          ) : null}
          <p className="ox-docs-hint">{T.pdf.ocrHint}</p>
        </section>
      ) : null}
      <section aria-label={T.pdf.convert}>
        <strong>{T.pdf.convert}</strong>
        <div className="ox-docs-tool-grid">
          <Button
            variant="secondary"
            size="compact"
            disabled={!canConvert || busy || needOcr}
            disabledReason={needOcr ? T.pdf.needOcr : undefined}
            onPress={() => void start('to_docx')}
          >
            {T.pdf.toDocx}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            disabled={!canConvert || busy || doc.pdfaCopy === true}
            onPress={() => void start('pdfa')}
          >
            {T.pdf.pdfa}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            disabled={!canConvert || busy}
            onPress={() => void start('compress')}
          >
            {T.pdf.compress}
          </Button>
        </div>
        <p className="ox-docs-hint">{T.pdf.convertNote}</p>
      </section>
      <JobsList ctx={ctx} doc={doc} />
    </div>
  );
}
