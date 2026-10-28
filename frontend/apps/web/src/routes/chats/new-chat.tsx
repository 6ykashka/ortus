// W7.13 · Диалог «Новый чат» (D-1, ключ modal-chat-new): вид, название, область, метка, состав из источников и
// предпросмотр «Кто войдёт» (createChat с dryRun). Личный чат «с нуля» — вид «Личный» (createDirectChat), no-reference,
// Q-W4.00-chats-5. Метка «ПДн» не предлагается (Q-W4.00-chats-14). Эталон `Чаты.dc.html` :374–427, nwVM :720–742.
import type { components } from '@ortus/api-client';
import { ProblemError } from '@ortus/api-client';
import { Button, Dialog, Icon } from '@ortus/ui';
import { type ReactElement, useRef, useState } from 'react';

import { createChat, createDirect, usePolicies } from './api.ts';
import type { ChatsCtx } from './ctx.ts';
import { avatarColor, initials, plural, policyNote } from './model.ts';
import { CHAT_TEXT as T } from './texts.ts';

type S = components['schemas'];
type Src = S['ChatSource'];
type NewKind = 'direct' | 'group' | 'area' | 'announce';

const WHO_ICON: Record<Src['who'], string> = {
  all: 'domain',
  group: 'groups',
  role: 'badge',
  member: 'person',
  relation: 'home_work',
  trip_driver: 'local_shipping',
};
const KIND_ICON: Record<NewKind, string> = {
  direct: 'person',
  group: 'groups',
  area: 'badge',
  announce: 'campaign',
};

export interface NewChatProps {
  ctx: ChatsCtx;
  open: boolean;
  /** Область руководителя: id его подразделения (владелец выбирает «Вся организация» или фирму). */
  ownUnit: string | null;
  onClose: () => void;
  onCreated: (chatId: string) => void;
}

export function NewChat({
  ctx,
  open,
  ownUnit,
  onClose,
  onCreated,
}: NewChatProps): ReactElement | null {
  const [kind, setKind] = useState<NewKind>('group');
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState(ownUnit ?? '');
  const [label, setLabel] = useState<'normal' | 'finance'>('normal');
  const [sources, setSources] = useState<Src[]>([]);
  const [who, setWho] = useState<Src['who']>('member');
  const [ref, setRef] = useState('');
  const [role, setRole] = useState<Src['role']>('member');
  const [peer, setPeer] = useState('');
  const [impact, setImpact] = useState<S['ChatMembershipImpact'] | null>(null);
  const [err, setErr] = useState('');
  // Ошибка предпросмотра отдельно от ошибок формы (название, дубль, метка): ответ dryRun не должен стирать чужую ошибку.
  const [previewErr, setPreviewErr] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const policies = usePolicies(ctx.tenantId, open && ctx.owner);
  const { dir } = ctx;
  const isSelf = (m: { id: string; userId?: string | null }): boolean =>
    m.id === ctx.memberId || m.userId === ctx.userId;
  const peerOpts = dir.members.filter((m) => !isSelf(m) && m.status === 'active');
  const peerValue = peer || peerOpts[0]?.id || '';

  const preview = async (next: {
    kind: NewKind;
    unit: string;
    label: 'normal' | 'finance';
    sources: Src[];
  }): Promise<void> => {
    if (next.kind === 'direct') {
      setImpact(null);
      return;
    }
    try {
      const r = await createChat(
        ctx.api,
        ctx.tenantId,
        {
          kind: next.kind,
          // Состав не зависит от названия: для dryRun нужен лишь валидный служебный заголовок (не короче 3 символов).
          title: title.trim().length >= 3 ? title.trim() : T.nw.title,
          orgUnitId: next.unit || null,
          label: next.label,
          sources: next.sources,
          dryRun: true,
        },
        crypto.randomUUID(),
      );
      setPreviewErr('');
      setImpact(r.impact);
    } catch (e) {
      setImpact(null);
      setPreviewErr(e instanceof ProblemError ? (e.problem?.detail ?? '') : '');
    }
  };
  const set = (
    patch: Partial<{ kind: NewKind; unit: string; label: 'normal' | 'finance'; sources: Src[] }>,
  ): void => {
    const next = { kind, unit, label, sources, ...patch };
    if (patch.kind) setKind(patch.kind);
    if (patch.unit !== undefined) setUnit(patch.unit);
    if (patch.label) setLabel(patch.label);
    if (patch.sources) setSources(patch.sources);
    void preview(next);
  };

  const refOpts: { value: string; label: string }[] =
    who === 'member'
      ? dir.members
          .filter((m) => !isSelf(m))
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
        ? dir.groups.map((g) => ({ value: g.id, label: g.name }))
        : who === 'role'
          ? dir.roles.map((r) => ({ value: r.id, label: r.name }))
          : [{ value: '', label: T.nw.wholeOrg }];
  const refValue = ref || refOpts[0]?.value || '';
  const srcLabel = (s: Src): string =>
    s.who === 'all'
      ? T.side.whoOpts.all
      : s.who === 'group'
        ? (dir.groups.find((g) => g.id === s.refId)?.name ?? T.side.src.group)
        : s.who === 'role'
          ? (dir.roles.find((r) => r.id === s.refId)?.name ?? T.side.src.role)
          : (dir.members.find((m) => m.id === s.refId)?.displayName ?? T.side.src.member) +
            T.side.byName;
  const addSource = (): void => {
    const nx: Src = {
      who,
      ...(who === 'all' ? {} : { refId: refValue }),
      ...(who === 'role' && unit ? { orgUnitId: unit } : {}),
      role,
    };
    if (sources.some((x) => x.who === nx.who && (x.refId ?? null) === (nx.refId ?? null))) {
      setErr(T.nw.errDup);
      return;
    }
    set({ sources: [...sources, nx] });
  };

  const create = async (): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      if (kind === 'direct') {
        const c = await createDirect(ctx.api, ctx.tenantId, peerValue);
        await ctx.refresh();
        onCreated(c.id);
        return;
      }
      if (title.trim().length < 3) {
        setErr(T.nw.errTitle);
        return;
      }
      const r = await createChat(
        ctx.api,
        ctx.tenantId,
        { kind, title: title.trim(), orgUnitId: unit || null, label, sources },
        key.current,
      );
      ctx.toast(`${T.nw.created}${title.trim()}${T.nw.createdTail}`, 'ok');
      await ctx.refresh();
      if (r.chat) onCreated(r.chat.id);
    } catch (e) {
      setErr(
        e instanceof ProblemError ? (e.problem?.detail ?? '') || 'Не получилось' : 'Не получилось',
      );
    } finally {
      setBusy(false);
    }
  };

  const joined = impact?.joined ?? [];
  const lines = impact
    ? [
        ...joined.map((p) => ({ p, k: 'in' as const, sub: p.title ?? '' })),
        ...impact.pending.map((p) => ({ p, k: 'pending' as const, sub: T.side.pendingNote })),
        ...impact.skipped.map((s) => ({ p: s.member, k: 'out' as const, sub: s.reason })),
      ]
    : [];
  const kinds: NewKind[] = [
    'direct',
    'group',
    'area',
    ...(ctx.owner ? (['announce'] as const) : []),
  ];
  const pol = policies.data?.items.find((x) => x.kind === kind)?.policy;
  const createLabel =
    kind === 'direct'
      ? T.nw.create
      : `${T.nw.create}${joined.length ? ` · ${plural(joined.length, 'участник', 'участника', 'участников')}` : ''}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={T.nw.title}
      size="lg"
      busy={busy}
      footer={
        <>
          {pol ? (
            <span className="ox-chat-pol-note">{policyNote(T.kind[kind].label, pol)}</span>
          ) : null}
          <Button variant="secondary" onPress={onClose} disabled={busy}>
            {T.nw.cancel}
          </Button>
          <Button onPress={() => void create()} loading={busy}>
            {createLabel}
          </Button>
        </>
      }
    >
      <div className="ox-chat-nw">
        <div className="ox-chat-nw-head">
          <span className="ox-chat-nw-ico" aria-hidden="true">
            <Icon name="group_add" size={22} />
          </span>
          <p className="ox-chat-file-meta ox-chat-grow">
            {ctx.owner ? T.nw.ownerSub : T.nw.otherSub}
          </p>
          <button
            type="button"
            className="ox-chat-icon-btn"
            aria-label={T.nw.close}
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="ox-chat-nw-grid">
          <div className="ox-chat-nw-form">
            <div className="ox-chat-kinds" role="group" aria-label={T.nw.kind}>
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="ox-chat-kind"
                  aria-pressed={kind === k}
                  onClick={() => set({ kind: k })}
                >
                  <Icon name={KIND_ICON[k]} size={22} />
                  <strong>{T.nw.kinds[k][0]}</strong>
                  <span className="ox-chat-file-meta">{T.nw.kinds[k][1]}</span>
                </button>
              ))}
            </div>
            {kind === 'direct' ? (
              <label className="ox-chat-field">
                <span>{T.nw.peer}</span>
                <select
                  className="ox-chat-select"
                  value={peerValue}
                  onChange={(e) => setPeer(e.target.value)}
                >
                  {peerOpts.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <div className="ox-chat-nw-row2">
                  <label className="ox-chat-field">
                    <span>{T.nw.name}</span>
                    <input
                      className="ox-chat-input"
                      value={title}
                      placeholder={T.nw.namePlaceholder}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        setErr('');
                      }}
                      onBlur={() => void preview({ kind, unit, label, sources })}
                    />
                  </label>
                  <label className="ox-chat-field">
                    <span>{T.nw.scope}</span>
                    <select
                      className="ox-chat-select"
                      value={unit}
                      disabled={!ctx.owner}
                      onChange={(e) => set({ unit: e.target.value })}
                    >
                      {ctx.owner ? <option value="">{T.nw.wholeOrg}</option> : null}
                      {(ctx.owner
                        ? dir.units.filter((u) => u.kind === 'company')
                        : dir.units.filter((u) => u.id === ownUnit)
                      ).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                      {!ctx.owner && !ownUnit ? <option value="">{T.nw.yourArea}</option> : null}
                    </select>
                  </label>
                </div>
                <div className="ox-chat-field" role="group" aria-label={T.nw.labelGroup}>
                  <span>{T.nw.label}</span>
                  <span className="ox-chat-seg">
                    {(['normal', 'finance'] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        className="ox-chat-toggle"
                        aria-pressed={label === l}
                        data-off={(l === 'finance' && !ctx.owner) || undefined}
                        onClick={() =>
                          l === 'finance' && !ctx.owner
                            ? setErr(T.nw.errFinance)
                            : set({ label: l })
                        }
                      >
                        {T.nw.labels[l]}
                      </button>
                    ))}
                  </span>
                  <span className="ox-chat-file-meta">{T.nw.labelNote}</span>
                </div>
                <section className="ox-chat-block" aria-label={T.nw.roster}>
                  <h3 className="ox-chat-h">{T.nw.roster}</h3>
                  {sources.map((s, i) => (
                    <div key={`${s.who}-${s.refId ?? i}`} className="ox-chat-src">
                      <Icon name={WHO_ICON[s.who]} size={18} />
                      <span className="ox-chat-src-text">
                        {srcLabel(s)}
                        <span className="ox-chat-file-meta">{T.role[s.role]}</span>
                      </span>
                      <button
                        type="button"
                        className="ox-chat-icon-btn"
                        aria-label={T.nw.remove}
                        onClick={() => set({ sources: sources.filter((_, j) => j !== i) })}
                      >
                        <Icon name="remove_circle" size={18} />
                      </button>
                    </div>
                  ))}
                  <div className="ox-chat-addrow">
                    <select
                      className="ox-chat-select"
                      aria-label={T.side.whom}
                      value={who}
                      onChange={(e) => {
                        setWho(e.target.value as Src['who']);
                        setRef('');
                      }}
                    >
                      {(
                        [
                          'member',
                          'group',
                          'role',
                          ...(ctx.owner ? (['all'] as const) : []),
                        ] as const
                      ).map((k) => (
                        <option key={k} value={k}>
                          {T.side.whoOpts[k]}
                        </option>
                      ))}
                    </select>
                    <select
                      className="ox-chat-select"
                      aria-label={T.side.who}
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
                    <select
                      className="ox-chat-select"
                      aria-label={T.side.chatRole}
                      value={role}
                      onChange={(e) => setRole(e.target.value as Src['role'])}
                    >
                      {(['owner', 'moderator', 'member', 'reader'] as const)
                        .filter((r) => ctx.owner || r !== 'owner')
                        .map((r) => (
                          <option key={r} value={r}>
                            {T.role[r]}
                          </option>
                        ))}
                    </select>
                    <button type="button" className="ox-chat-btn" onClick={addSource}>
                      {T.nw.add}
                    </button>
                  </div>
                </section>
              </>
            )}
            {err || previewErr ? (
              <span className="ox-chat-error" role="alert">
                {err || previewErr}
              </span>
            ) : null}
          </div>
          {kind !== 'direct' ? (
            <aside className="ox-chat-nw-pv" aria-label={T.nw.whoJoins}>
              <h3 className="ox-chat-h">{T.nw.whoJoins}</h3>
              <div className="ox-chat-pv-sum">
                <span data-tone="ok">{`${T.nw.joins}${joined.length}`}</span>
                <span data-tone="info">{`${T.nw.later}${impact?.pending.length ?? 0}`}</span>
                <span data-tone="neutral">{`${T.nw.skipped}${impact?.skipped.length ?? 0}`}</span>
              </div>
              {lines.length ? (
                lines.map(({ p, k, sub }) => (
                  <div key={`${k}-${p.memberId}`} className="ox-chat-person" data-state={k}>
                    <span
                      className="ox-chat-ava"
                      style={k === 'in' ? { background: avatarColor(p.memberId) } : undefined}
                      aria-hidden="true"
                    >
                      {initials(p.displayName)}
                    </span>
                    <span className="ox-chat-person-text">
                      <strong>
                        {p.displayName}
                        {p.memberId === ctx.memberId ? T.nw.you : ''}
                      </strong>
                      <span className="ox-chat-file-meta">{sub}</span>
                    </span>
                    <Icon
                      name={k === 'in' ? 'check_circle' : k === 'pending' ? 'schedule' : 'block'}
                      size={18}
                    />
                  </div>
                ))
              ) : (
                <p className="ox-chat-file-meta">{T.nw.empty}</p>
              )}
              <p className="ox-chat-file-meta">{T.nw.auto}</p>
            </aside>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
