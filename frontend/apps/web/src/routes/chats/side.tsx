// W7.13 · Панель «Сведения» (C-10): «Участники» (состав из источников, «Что изменится», откуда доступ), «Сообщение»
// (прочтение и подтверждения), «Права» (матрица роль × действие, политика вида), «Хранение» (место, пороги, очистка,
// удержание, журнал). Эталон `Чаты.dc.html` :204–338, sideVM :656–718. Демо-кнопка «прошло 24 часа» не переносится.
import type { components } from '@ortus/api-client';
import { Icon } from '@ortus/ui';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import {
  cleanup,
  patchChat,
  replaceSources,
  useJournal,
  useMembers,
  useReceipts,
  useSources,
  useStorage,
} from './api.ts';
import type { ChatCtx } from './ctx.ts';
import {
  avatarColor,
  type ChatMessage,
  initials,
  matrixOf,
  plural,
  policyFacts,
  quotaState,
  sizeLabel,
  timeOf,
  dayOf,
} from './model.ts';
import { CHAT_TEXT as T } from './texts.ts';

type S = components['schemas'];
type Src = S['ChatSource'];
export type Side = 'info' | 'msg' | 'rights' | 'store';
export const SIDES: readonly Side[] = ['info', 'msg', 'rights', 'store'];

export interface SideProps {
  ctx: ChatCtx;
  side: Side;
  message: ChatMessage | null;
  onSide: (s: Side) => void;
  onClose: () => void;
}

const ROLE_OPTS = ['owner', 'moderator', 'member', 'reader'] as const;
const WHO_ICON: Record<Src['who'], string> = {
  all: 'domain',
  group: 'groups',
  role: 'badge',
  member: 'person',
  relation: 'home_work',
  trip_driver: 'local_shipping',
};

function sourceLabel(s: Src, ctx: ChatCtx): string {
  const d = ctx.dir;
  if (s.who === 'all') return T.side.whoOpts.all;
  if (s.who === 'group')
    return `${T.side.src.group} «${d.groups.find((g) => g.id === s.refId)?.name ?? '—'}»`;
  if (s.who === 'role') {
    const unit = d.units.find((u) => u.id === s.orgUnitId)?.name;
    return `${T.side.src.roleOf} «${d.roles.find((r) => r.id === s.refId)?.name ?? '—'}»${unit ? ` · ${unit}` : ''}`;
  }
  if (s.who === 'member') {
    return d.members.find((m) => m.id === s.refId)?.displayName ?? T.side.src.member;
  }
  return s.who === 'relation' ? T.side.src.relation : T.side.src.trip_driver;
}

const Row = ({ k, v }: { k: string; v: string }): ReactElement => (
  <div className="ox-chat-kv">
    <span>{k}</span>
    <strong>{v}</strong>
  </div>
);

function Members({ ctx }: { ctx: ChatCtx }): ReactElement {
  const chat = ctx.chat;
  const can = chat.my.can;
  const direct = chat.kind === 'direct';
  const sources = useSources(ctx.tenantId, ctx.chatId, !direct);
  const members = useMembers(ctx.tenantId, ctx.chatId, true);
  const [who, setWho] = useState<Src['who']>('member');
  const [ref, setRef] = useState('');
  const [role, setRole] = useState<Src['role']>('member');
  const [preview, setPreview] = useState<{ next: Src[]; impact: S['ChatMembershipImpact'] } | null>(
    null,
  );
  const [dup, setDup] = useState(false);
  const cur = sources.data?.items ?? [];
  const c = { api: ctx.api, tenantId: ctx.tenantId, chatId: ctx.chatId };

  const refOpts: { value: string; label: string }[] =
    who === 'member'
      ? ctx.dir.members
          .filter((m) => m.id !== ctx.memberId && m.userId !== ctx.userId)
          .map((m) => ({
            value: m.id,
            label:
              m.displayName +
              (m.status === 'invited'
                ? ' · приглашён'
                : m.status === 'suspended'
                  ? ' · заблокирован'
                  : ''),
          }))
      : who === 'group'
        ? ctx.dir.groups.map((g) => ({ value: g.id, label: g.name }))
        : who === 'role'
          ? ctx.dir.roles
              .filter((r) => !r.builtIn || r.id)
              .map((r) => ({ value: r.id, label: r.name }))
          : [{ value: '', label: T.nw.wholeOrg }];
  const refValue = ref || refOpts[0]?.value || '';

  const check = async (next: Src[]): Promise<void> => {
    const r = await ctx.exec(() =>
      replaceSources(c, { sources: next, dryRun: true }, sources.data?.etag ?? null),
    );
    if (r) setPreview({ next, impact: r.impact });
  };
  const add = (): void => {
    const nx: Src = {
      who,
      ...(who === 'all' ? {} : { refId: refValue }),
      ...(who === 'role' && chat.orgUnitId ? { orgUnitId: chat.orgUnitId } : {}),
      role,
    };
    if (cur.some((x) => x.who === nx.who && (x.refId ?? null) === (nx.refId ?? null))) {
      setDup(true);
      return;
    }
    setDup(false);
    void check([...cur, nx]);
  };
  const save = async (): Promise<void> => {
    if (!preview) return;
    const r = await ctx.exec(
      () => replaceSources(c, { sources: preview.next, dryRun: false }, sources.data?.etag ?? null),
      T.side.rosterSaved,
    );
    if (r) {
      setPreview(null);
      void sources.refetch();
    }
  };

  const lines: { icon: string; tone: string; text: string }[] = preview
    ? [
        ...preview.impact.joined.map((p) => ({
          icon: 'add_circle',
          tone: 'ok',
          text: `${T.side.willJoin}${p.displayName}`,
        })),
        ...preview.impact.lose.map((p) => ({
          icon: 'do_not_disturb_on',
          tone: 'danger',
          text: `${T.side.willLeave}${p.displayName}`,
        })),
        ...preview.impact.pending.map((p) => ({
          icon: 'schedule',
          tone: 'info',
          text: `${p.displayName}: ${T.side.pendingNote}`,
        })),
        ...preview.impact.skipped.map((p) => ({
          icon: 'block',
          tone: 'warn',
          text: `${p.member.displayName}: ${p.reason}`,
        })),
      ]
    : [];
  if (preview && !lines.length)
    lines.push({ icon: 'check_circle', tone: 'neutral', text: T.side.noChange });

  const people = members.data?.items ?? [];
  const inCount = members.data?.counts.in ?? people.filter((p) => p.state === 'in').length;

  return (
    <div className="ox-chat-pane">
      {!direct ? (
        <section className="ox-chat-block" aria-label={T.side.source}>
          <h2 className="ox-chat-h ox-chat-h-caps">{T.side.source}</h2>
          {cur.map((s, i) => (
            <div key={`${s.who}-${s.refId ?? i}`} className="ox-chat-src">
              <Icon name={WHO_ICON[s.who]} size={18} />
              <span className="ox-chat-src-text">
                {sourceLabel(s, ctx)}
                {s.who === 'member' ? T.side.byName : ''}
                <span className="ox-chat-file-meta">{T.role[s.role]}</span>
              </span>
              {can?.members && !(s.who === 'all' && !ctx.owner) ? (
                <button
                  type="button"
                  className="ox-chat-icon-btn"
                  aria-label={`${T.side.removeSource}: ${sourceLabel(s, ctx)}`}
                  onClick={() => void check(cur.filter((_, j) => j !== i))}
                >
                  <Icon name="remove_circle" size={18} />
                </button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {!direct && can?.members ? (
        <section className="ox-chat-block" aria-label={T.side.addToRoster}>
          <h2 className="ox-chat-h">{T.side.addToRoster}</h2>
          <label className="ox-chat-field">
            <span>{T.side.whom}</span>
            <select
              className="ox-chat-select"
              value={who}
              onChange={(e) => {
                setWho(e.target.value as Src['who']);
                setRef('');
              }}
            >
              {(['member', 'group', 'role', ...(ctx.owner ? (['all'] as const) : [])] as const).map(
                (k) => (
                  <option key={k} value={k}>
                    {T.side.whoOpts[k]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="ox-chat-field">
            <span>{T.side.chatRole}</span>
            <select
              className="ox-chat-select"
              value={role}
              onChange={(e) => setRole(e.target.value as Src['role'])}
            >
              {ROLE_OPTS.filter((r) => ctx.owner || r !== 'owner').map((r) => (
                <option key={r} value={r}>
                  {T.role[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="ox-chat-field">
            <span>{T.side.who}</span>
            <select
              className="ox-chat-select"
              value={refValue}
              disabled={who === 'all'}
              onChange={(e) => setRef(e.target.value)}
            >
              {refOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {dup ? (
            <span className="ox-chat-error" role="alert">
              {T.side.dup}
            </span>
          ) : null}
          <button type="button" className="ox-chat-btn" onClick={add}>
            {T.side.check}
          </button>
        </section>
      ) : null}
      {preview ? (
        <section className="ox-chat-block ox-chat-preview" aria-label={T.side.whatChanges}>
          <h2 className="ox-chat-h">{T.side.whatChanges}</h2>
          {lines.map((l) => (
            <span key={l.text} className="ox-chat-pv-line" data-tone={l.tone}>
              <Icon name={l.icon} size={16} />
              {l.text}
            </span>
          ))}
          <span className="ox-chat-pv-actions">
            <button type="button" className="ox-chat-btn" onClick={() => setPreview(null)}>
              {T.msg.cancel}
            </button>
            <button
              type="button"
              className="ox-chat-btn ox-chat-btn-primary"
              onClick={() => void save()}
            >
              {T.side.saveRoster}
            </button>
          </span>
        </section>
      ) : null}
      <section className="ox-chat-block" aria-label={`${T.side.members}${inCount}`}>
        <h2 className="ox-chat-h ox-chat-h-caps">
          {T.side.members}
          {inCount}
        </h2>
        {people.map((p) => (
          <div key={p.member.memberId} className="ox-chat-person" data-state={p.state}>
            <span
              className="ox-chat-ava"
              style={p.state === 'in' ? { background: avatarColor(p.member.memberId) } : undefined}
              aria-hidden="true"
            >
              {initials(p.member.displayName)}
            </span>
            <span className="ox-chat-person-text">
              <strong>{p.member.displayName}</strong>
              <span className="ox-chat-file-meta">
                {p.state === 'in' && p.role
                  ? `${T.role[p.role]}${p.via ? ` · ${p.via}` : ''}`
                  : (p.why ?? '')}
              </span>
            </span>
            <Icon
              name={
                p.state === 'in' ? 'check_circle' : p.state === 'pending' ? 'schedule' : 'block'
              }
              size={18}
            />
          </div>
        ))}
      </section>
      {chat.my.chain?.length ? (
        <section className="ox-chat-block" aria-label={T.side.whereAccess}>
          <h2 className="ox-chat-h">{T.side.whereAccess}</h2>
          {chat.my.chain.map((s) => (
            <div key={s.title} className="ox-chat-chain" data-ok={s.ok}>
              <Icon name={s.ok ? 'check_circle' : 'cancel'} size={18} />
              <span>
                <strong>{s.title}</strong>
                <span className="ox-chat-file-meta">{s.detail}</span>
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function MessagePane({ ctx, m }: { ctx: ChatCtx; m: ChatMessage | null }): ReactElement {
  const P = ctx.chat.policy;
  const mine = m ? m.authorDisplayName === ctx.meName || m.authorMemberId === ctx.memberId : false;
  const mod = ctx.chat.my.can?.moderate ?? false;
  const mineOrMod = mine || mod;
  const rec = useReceipts(
    ctx.tenantId,
    ctx.chatId,
    m?.id ?? null,
    P.receipts === 'who' && mineOrMod,
  );
  if (!m) return <p className="ox-chat-pane ox-chat-file-meta">{T.side.msgEmpty}</p>;
  const quote = `${mine ? T.msg.you : m.authorDisplayName}: «${(m.text || m.poll?.question || T.chat.attachment).slice(0, 90)}» · ${timeOf(m.createdAt)}`;
  const items = rec.data?.items ?? [];
  const read = items.filter((i) => i.readAt);
  const left = items.filter((i) => !i.readAt);
  return (
    <div className="ox-chat-pane">
      <blockquote className="ox-chat-quote">{quote}</blockquote>
      <Row k={T.side.receipts} v={T.rcpt[P.receipts]} />
      {P.receipts === 'who' && mineOrMod ? (
        <>
          <h2 className="ox-chat-h">
            {T.side.readBy}
            {read.length}
          </h2>
          {read.map((i) => (
            <Row
              key={i.member.memberId}
              k={i.member.displayName}
              v={i.readAt ? `${dayOf(i.readAt)} ${timeOf(i.readAt)}` : ''}
            />
          ))}
          {left.length ? (
            <>
              <h2 className="ox-chat-h">
                {T.side.notRead}
                {left.length}
              </h2>
              <p className="ox-chat-file-meta">
                {left.map((i) => i.member.displayName).join(', ')}
              </p>
            </>
          ) : null}
        </>
      ) : null}
      {P.receipts === 'who' && !mineOrMod ? (
        <p className="ox-chat-file-meta">{T.side.whoNote}</p>
      ) : null}
      {P.receipts === 'ticks' ? (
        <p className="ox-chat-file-meta">
          {`Прочитали ${m.reads?.readCount ?? 0} из ${m.reads?.totalCount ?? 0}. ${T.side.ticksNote}`}
        </p>
      ) : null}
      {P.receipts === 'off' ? <p className="ox-chat-file-meta">{T.side.offNote}</p> : null}
      {m.important && mineOrMod ? (
        <Row
          k={`${T.side.ackList}${m.important.ackCount}${T.msg.of}${m.important.totalCount}`}
          v={m.important.ackCount ? '' : T.side.nobody}
        />
      ) : null}
      <p className="ox-chat-file-meta">
        {T.side.retention}
        {P.receiptsDays}
        {T.side.retentionTail}
      </p>
    </div>
  );
}

function RightsPane({ ctx }: { ctx: ChatCtx }): ReactElement {
  const chat = ctx.chat;
  const groups = matrixOf(chat.policy, chat.kind);
  const cellIcon = {
    y: ['check_circle', T.side.yes],
    n: ['remove', T.side.no],
    l: ['lock', T.side.lock],
  } as const;
  return (
    <div className="ox-chat-pane">
      <p className="ox-chat-file-meta">
        {T.side.rightsNote}
        {T.kind[chat.kind].label}».
      </p>
      <table className="ox-chat-matrix">
        <thead>
          <tr>
            <th scope="col">{T.side.policyOfKind}</th>
            {T.side.matrixCols.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.title}>
            <tr>
              <th colSpan={5} scope="colgroup" className="ox-chat-matrix-group">
                {g.title}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.title}>
                <th scope="row">
                  {r.title}
                  {r.limit ? <span className="ox-chat-file-meta">{r.limit}</span> : null}
                </th>
                {r.cells.map((x, i) => (
                  <td key={T.side.matrixCols[i]} data-cell={x}>
                    <span title={cellIcon[x][1]} role="img" aria-label={cellIcon[x][1]}>
                      <Icon name={cellIcon[x][0]} size={18} />
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <h2 className="ox-chat-h">{T.side.policyOfKind}</h2>
      {policyFacts(chat.policy, chat.kind).map((f) => (
        <Row key={f.k} k={f.k} v={f.v} />
      ))}
    </div>
  );
}

const FILTERS = [
  ['video90', 'video', 90],
  ['photo180', 'photo', 180],
  ['voice30', 'voice', 30],
  ['docs30', 'doc', 30],
] as const;

function StoragePane({ ctx }: { ctx: ChatCtx }): ReactElement {
  const chat = ctx.chat;
  const can = chat.my.can;
  const P = chat.policy;
  const st = useStorage(ctx.tenantId, ctx.chatId, true);
  const journal = useJournal(ctx.tenantId, ctx.chatId, true);
  const [picked, setPicked] = useState<readonly (typeof FILTERS)[number][0][]>([
    'video90',
    'photo180',
  ]);
  const [pv, setPv] = useState<S['ChatCleanupResult'] | null>(null);
  const c = { api: ctx.api, tenantId: ctx.tenantId, chatId: ctx.chatId };
  const s = st.data;
  const used = s?.usedBytes ?? chat.usedBytes;
  const quota = s ? s.quotaBytes : chat.policy.quotaMb ? chat.policy.quotaMb * 1024 * 1024 : null;
  const q = quotaState(used, quota);

  const bodyOf = (ids: readonly string[], dryRun: boolean): S['ChatCleanupCreate'] => {
    const rows = FILTERS.filter(([id]) => ids.includes(id));
    return {
      kinds: [...new Set(rows.map(([, k]) => k))],
      olderThanDays: Math.min(...rows.map(([, , d]) => d)),
      excludeSaved: true,
      dryRun,
    };
  };
  const preview = async (ids: readonly string[]): Promise<void> => {
    if (!ids.length) {
      setPv(null);
      return;
    }
    const r = await ctx.exec(() => cleanup(c, bodyOf(ids, true)));
    if (r) setPv(r);
  };
  const toggle = (id: (typeof FILTERS)[number][0]): void => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    setPv(null);
    void preview(next);
  };
  const started = useRef(false);
  const ready = Boolean(can?.settings && s);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void preview(picked);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- первичный предпросмотр один раз, когда данные хранения загружены
  }, [ready]);

  return (
    <div className="ox-chat-pane">
      {quota ? (
        <>
          <div className="ox-chat-quota">
            <strong>{sizeLabel(used)}</strong>
            <span className="ox-chat-file-meta">
              {T.side.storage.of}
              {sizeLabel(quota)}
            </span>
            <span className="ox-chat-pill" data-tone={q.tone}>
              {q.pct} %
            </span>
          </div>
          <div
            className="ox-chat-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, q.pct ?? 0)}
            aria-label={`${T.side.storage.attachments}${sizeLabel(used)}`}
          >
            <span
              style={{ width: `${Math.min(100, q.pct ?? 0)}%` }}
              data-warn={(q.pct ?? 0) >= 90 || undefined}
            />
          </div>
        </>
      ) : (
        <p className="ox-chat-file-meta">
          {T.side.storage.attachments}
          {sizeLabel(used)}. {T.side.storage.noLimit}
        </p>
      )}
      <p className="ox-chat-file-meta">
        {s && s.savedBytes
          ? `Ещё ${sizeLabel(s.savedBytes)} сохранено в запись — это место записи. `
          : ''}
        {s && s.archivedBytes ? `В архиве: ${sizeLabel(s.archivedBytes)}. ` : ''}
        {T.side.storage.thresholds}
        {T.full[P.onFull]}
        {T.side.storage.thresholdsTail}
      </p>
      {can?.settings && s?.buckets.length ? (
        <ul className="ox-chat-buckets">
          {s.buckets.map((b) => (
            <li key={b.id}>
              <Icon
                name={
                  b.hold
                    ? 'gavel'
                    : { photo: 'photo', video: 'videocam', voice: 'mic', doc: 'description' }[
                        b.kind
                      ]
                }
                size={18}
              />
              <span>
                {b.label} · {b.ageDays ? `старше ${b.ageDays} дн.` : 'новые'} · {b.files}
                {b.compressed ? ' · сжато' : ''}
              </span>
              <strong>{sizeLabel(b.bytes)}</strong>
            </li>
          ))}
        </ul>
      ) : null}
      {can?.settings ? (
        <section className="ox-chat-block" aria-label={T.side.storage.onFull}>
          <h2 className="ox-chat-h">{T.side.storage.onFull}</h2>
          {(['block', 'ring', 'compress'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="ox-chat-option"
              aria-pressed={P.onFull === k}
              onClick={() =>
                void ctx.exec(
                  () => patchChat(c, { overrides: { onFull: k } }),
                  `${T.side.storage.onFullSet}${T.full[k]}`,
                )
              }
            >
              <strong>{T.full[k]}</strong>
              <span className="ox-chat-file-meta">{T.fullHint[k]}</span>
            </button>
          ))}
        </section>
      ) : null}
      {can?.settings ? (
        <section className="ox-chat-block" aria-label={T.side.storage.free}>
          <h2 className="ox-chat-h">{T.side.storage.free}</h2>
          {FILTERS.map(([id]) => (
            <button
              key={id}
              type="button"
              className="ox-chat-check"
              aria-pressed={picked.includes(id)}
              onClick={() => toggle(id)}
            >
              <Icon
                name={picked.includes(id) ? 'check_box' : 'check_box_outline_blank'}
                size={18}
              />
              {T.side.storage.filters[id]}
            </button>
          ))}
          {pv ? (
            <div className="ox-chat-cleanup">
              <span>
                {T.side.storage.willDelete}
                {plural(pv.files, 'файл', 'файла', 'файлов')} · {sizeLabel(pv.bytes)}
              </span>
              <span>
                {T.side.storage.after}
                {sizeLabel(pv.afterBytes)}
                {quota
                  ? ` из ${sizeLabel(quota)} · ${Math.round((pv.afterBytes / quota) * 100)} %`
                  : ''}
              </span>
              <span className="ox-chat-file-meta">
                {T.side.storage.kept}
                {pv.kept.saved
                  ? `${plural(pv.kept.saved, 'файл', 'файла', 'файлов')} сохранено в запись · `
                  : ''}
                {pv.kept.held
                  ? `${plural(pv.kept.held, 'файл', 'файла', 'файлов')} под удержанием · `
                  : ''}
                {T.side.storage.keptTail}
              </span>
            </div>
          ) : null}
          <button
            type="button"
            className="ox-chat-btn ox-chat-btn-primary"
            disabled={!pv || !pv.files}
            onClick={() =>
              void ctx
                .exec(
                  () => cleanup(c, bodyOf(picked, false)),
                  `${T.side.storage.cleaned}${pv ? sizeLabel(pv.bytes) : ''}`,
                )
                .then(() => {
                  setPv(null);
                  void st.refetch();
                  void preview(picked);
                })
            }
          >
            {pv && pv.files
              ? `${T.side.storage.del}${plural(pv.files, 'файл', 'файла', 'файлов')}`
              : T.side.storage.pick}
          </button>
          <span className="ox-chat-file-meta">{T.side.storage.irreversible}</span>
        </section>
      ) : null}
      {chat.hold ? (
        <section className="ox-chat-block ox-chat-hold" aria-label={T.side.storage.hold}>
          <h2 className="ox-chat-h">
            <Icon name="gavel" size={18} />
            {T.side.storage.hold}
            {chat.hold.until ? chat.hold.until.split('-').reverse().slice(0, 2).join('.') : ''}
          </h2>
          <p>
            {chat.hold.reason}: {chat.hold.period}. Эти сообщения не удаляются ни по сроку, ни
            очисткой, ни автором. Снимает владелец бизнеса.
          </p>
        </section>
      ) : null}
      <section className="ox-chat-block" aria-label={T.side.storage.retention}>
        <h2 className="ox-chat-h">{T.side.storage.retention}</h2>
        <Row
          k="Текст"
          v={`${P.textYears} г.${chat.kind === 'record' ? ' после закрытия записи' : ''}`}
        />
        <Row k="Вложения" v={`${P.filesDays} дн., затем превью`} />
        <Row k="Голосовые" v={`${P.voiceDays} дн.`} />
        <Row k="Отметки прочтения" v={`${P.receiptsDays} дн.`} />
        <Row k="Удалённые в журнале" v={`${P.deletedDays} дн.`} />
      </section>
      {journal.data?.items.length ? (
        <section className="ox-chat-block" aria-label={T.side.storage.journal}>
          <h2 className="ox-chat-h">{T.side.storage.journal}</h2>
          {journal.data.items.map((j) => (
            <div key={j.id} className="ox-chat-kv">
              <span>{`${dayOf(j.at)} ${timeOf(j.at)}`}</span>
              <strong>{j.text}</strong>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function SidePanel({ ctx, side, message, onSide, onClose }: SideProps): ReactElement {
  const direct = ctx.chat.kind === 'direct';
  const tabs = SIDES.filter((s) => !(direct && s === 'store'));
  return (
    <aside className="ox-chat-side" aria-label={T.side.aria}>
      <div className="ox-chat-side-head">
        <div className="ox-chat-side-tabs" role="tablist" aria-label={T.side.tabsAria}>
          {tabs.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={side === s}
              className="ox-chat-side-tab"
              onClick={() => onSide(s)}
            >
              {T.side.tabs[s]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ox-chat-icon-btn"
          aria-label={T.side.close}
          onClick={onClose}
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      <div
        role="tabpanel"
        tabIndex={0}
        aria-label={T.side.tabs[side]}
        className="ox-chat-side-body"
      >
        {side === 'info' ? <Members ctx={ctx} /> : null}
        {side === 'msg' ? <MessagePane ctx={ctx} m={message} /> : null}
        {side === 'rights' ? <RightsPane ctx={ctx} /> : null}
        {side === 'store' && !direct ? <StoragePane ctx={ctx} /> : null}
      </div>
    </aside>
  );
}
