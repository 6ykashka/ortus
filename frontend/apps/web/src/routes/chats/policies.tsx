// W7.13 · Вкладка «Политики» (C-11, ключ chats-policies): значения по умолчанию по видам чатов, только владелец бизнеса
// (`chat.policy.manage`, owner_only). Эталон `Чаты.dc.html` :343–371, polVM :744–771. По DoR: «Удалённые в журнале» —
// ровно 30 дней, поле не показывается (Q-W4.00-chats-17); «Переносить в архив» скрыт (Q-16); временные в рабочих видах
// под замком (Q-4). Пределы организации — из `bounds` ответа.
import type { components } from '@ortus/api-client';
import { Icon, Skeleton } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { problemCode } from '../../shell/run.tsx';
import { updatePolicy, usePolicies } from './api.ts';
import type { ChatsCtx } from './ctx.ts';
import { plural, policyDiff, policyRowSummary } from './model.ts';
import { CHAT_TEXT as T } from './texts.ts';

type S = components['schemas'];
type Kind = S['ChatKindPolicy']['kind'];
type Policy = S['ChatPolicy'];

const KINDS: readonly Kind[] = ['direct', 'group', 'area', 'record', 'announce'];
const LOCKED_TEMP: readonly Kind[] = ['group', 'area', 'announce'];

interface FieldDef {
  key: keyof Policy;
  options: readonly [string, string][];
  num: boolean;
}

const entries = (o: Record<string, string>): [string, string][] => Object.entries(o);

const FIELDS: readonly FieldDef[] = [
  { key: 'textYears', options: entries(T.pol.textYears), num: true },
  { key: 'filesDays', options: entries(T.pol.filesDays), num: true },
  { key: 'voiceDays', options: entries(T.pol.voiceDays), num: true },
  { key: 'receipts', options: entries(T.rcpt), num: false },
  { key: 'receiptsDays', options: entries(T.pol.receiptsDays), num: true },
  { key: 'edit', options: entries(T.edit), num: false },
  { key: 'maxFileMb', options: entries(T.pol.maxFileMb), num: true },
  { key: 'temp', options: entries(T.temp), num: false },
  { key: 'forward', options: entries(T.fwd), num: false },
  {
    key: 'onFull',
    options: entries({ block: T.full.block, ring: T.full.ring, compress: T.full.compress }),
    num: false,
  },
];

export interface PoliciesProps {
  ctx: ChatsCtx;
  /** Чаты вида в списке владельца. */
  counts: Readonly<Record<Kind, number>>;
}

export function Policies({ ctx, counts }: PoliciesProps): ReactElement {
  const q = usePolicies(ctx.tenantId, true);
  const [kind, setKind] = useState<Kind>('area');
  const [draft, setDraft] = useState<Partial<Policy>>({});
  const [notes, setNotes] = useState<string[] | null>(null);
  const rows = q.data?.items ?? [];
  const row = rows.find((r) => r.kind === kind);

  if (q.isPending) return <Skeleton lines={5} label={T.loading} />;
  if (q.isError || !row) {
    // 403 api.ts превращает в пустой ответ (null) — для политик это «нет права», а не успех.
    const forbidden = q.data === null || (q.isError && problemCode(q.error) === 'forbidden_action');
    return (
      <div role="alert" className="ox-chat-feed-note">
        <Icon name={forbidden ? 'lock' : 'error'} size={20} />
        <span>{forbidden ? T.pol.forbidden : T.pol.loadFailed}</span>
        {forbidden ? null : (
          <button type="button" className="ox-chat-link" onClick={() => void q.refetch()}>
            {T.retry}
          </button>
        )}
      </div>
    );
  }

  const cur = row.policy;
  const merged = { ...cur, ...draft } as Policy;
  const diff = policyDiff(cur, draft);
  const changed = Object.keys(diff).length > 0;
  const onKind = (k: Kind): void => {
    setKind(k);
    setDraft({});
    setNotes(null);
  };

  const check = async (): Promise<void> => {
    if (!changed) return;
    const r = await ctx.exec(() => updatePolicy(ctx.api, ctx.tenantId, row, diff, true));
    if (r) setNotes(r.notes.length ? r.notes : [T.pol.noChange]);
  };
  const save = async (): Promise<void> => {
    if (!changed) return;
    const r = await ctx.exec(
      () => updatePolicy(ctx.api, ctx.tenantId, row, diff, false),
      `${T.pol.saved}${T.kind[kind].label}${T.pol.savedTail}`,
    );
    if (r) {
      setDraft({});
      setNotes(r.notes);
      void q.refetch();
    }
  };

  return (
    <div className="ox-chat-pol">
      <p className="ox-chat-pol-intro">
        <Icon name="account_tree" size={20} />
        <span>{T.pol.intro}</span>
      </p>
      <div className="ox-chat-pol-rows" role="group" aria-label={T.pol.rowsAria}>
        {KINDS.map((k) => {
          const r = rows.find((x) => x.kind === k);
          return (
            <button
              key={k}
              type="button"
              className="ox-chat-pol-row"
              aria-pressed={kind === k}
              onClick={() => onKind(k)}
            >
              <span className="ox-chat-pol-row-head">
                <span className="ox-chat-pol-ico">
                  <Icon name={T.kind[k].icon} size={20} />
                </span>
                <span className="ox-chat-pol-name">
                  <strong>{T.kind[k].label}</strong>
                  <span className="ox-chat-file-meta">
                    {plural(counts[k], 'чат', 'чата', 'чатов')}
                    {T.pol.count}
                  </span>
                </span>
              </span>
              {r
                ? policyRowSummary(r.policy).map((v) => (
                    <span key={v} className="ox-chat-pol-val">
                      {v}
                    </span>
                  ))
                : null}
            </button>
          );
        })}
      </div>
      <section className="ox-chat-pol-card" aria-label={`${T.kind[kind].label}${T.pol.defaults}`}>
        <h2 className="ox-chat-pol-title">
          «{T.kind[kind].label}»{T.pol.defaults}
        </h2>
        <div className="ox-chat-pol-fields">
          {FIELDS.map((f) => {
            const [label, hint] = T.pol.fields[f.key as keyof typeof T.pol.fields];
            const locked = f.key === 'temp' && LOCKED_TEMP.includes(kind);
            const value = String(merged[f.key] ?? '');
            // Значение, которого нет в списке (например, 3 дня хранения старого сида), остаётся выбранным.
            const opts = f.options.some(([v]) => v === value)
              ? f.options
              : [...f.options, [value, value] as [string, string]];
            return (
              <label
                key={f.key}
                className="ox-chat-field"
                data-changed={String(diff[f.key] !== undefined)}
              >
                <span>
                  {label}
                  {locked ? <Icon name="lock" size={15} /> : null}
                </span>
                <select
                  className="ox-chat-select"
                  value={value}
                  disabled={locked}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      [f.key]: f.num ? Number(e.target.value) : e.target.value,
                    });
                    setNotes(null);
                  }}
                >
                  {opts.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className="ox-chat-file-meta">{hint}</span>
              </label>
            );
          })}
        </div>
        {notes ? (
          <div className="ox-chat-notes" role="status" aria-label={T.pol.changes}>
            <h3 className="ox-chat-h">{T.pol.changes}</h3>
            {notes.map((n) => (
              <span key={n} className="ox-chat-pv-line" data-tone="info">
                <Icon name="info" size={16} />
                {n}
              </span>
            ))}
          </div>
        ) : null}
        <div className="ox-chat-pol-actions">
          <button
            type="button"
            className="ox-chat-btn"
            disabled={!changed}
            onClick={() => {
              setDraft({});
              setNotes(null);
            }}
          >
            {T.pol.reset}
          </button>
          <button
            type="button"
            className="ox-chat-btn"
            disabled={!changed}
            onClick={() => void check()}
          >
            {T.pol.check}
          </button>
          <button
            type="button"
            className="ox-chat-btn ox-chat-btn-primary"
            disabled={!changed || ctx.busy}
            onClick={() => void save()}
          >
            {T.pol.save}
          </button>
        </div>
      </section>
    </div>
  );
}
