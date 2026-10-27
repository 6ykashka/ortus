// W7.25 · «Поделиться» (modal-doc-share; Д:554–629, shareVM Д:1313–1376): кто вы, добавить, режим «Как у папки и
// свои» / «Только выбранные», записи с уровнями (выше своего — «Выше вашего уровня»), внешняя ссылка (срок ≤ 30 дней,
// PIN, водяной знак, без скачивания), «Что изменится» (setDocShares с dryRun), «Откуда доступ» (my.chain). Права —
// по `my.can` сервера. Правая панель 480 px — стиль `ox-docs-share` поверх Dialog.
import type { components } from '@ortus/api-client';
import { shell } from '@ortus/texts';
import { Button, DateInput, Dialog, Field, Icon, Select, Switch } from '@ortus/ui';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { useRun } from '../../shell/run.tsx';
import { commands, idemKeys, useGroups, useLinks, useMembers, useRoles, useShares } from './api.ts';
import { reasonOf } from './cmd.ts';
import type { DocsCtx } from './ctx.ts';
import {
  endOfDay,
  extExpiry,
  extExpiryError,
  fill,
  impactLines,
  initials,
  levelName,
  type Level,
  plural,
  shareHint,
  todayOf,
} from './model.ts';
import { DOCS_TEXT as T } from './texts.ts';

type S = components['schemas'];
type Entry = S['DocShareEntry'];

const LEVELS: readonly Level[] = ['view', 'comment', 'suggest', 'edit', 'manage'];
const rank = (l: Level | null): number => (l ? LEVELS.indexOf(l) + 1 : 0);

const keyOf = (e: Entry): string => `${e.who}:${e.refId ?? ''}:${e.object?.entityId ?? ''}`;

/** Тело записи для сервера: без подписей и сведений «кем и когда» (их ставит сервер). */
const wire = (e: Entry): Entry => ({
  who: e.who,
  level: e.level,
  ...(e.refId ? { refId: e.refId } : {}),
  ...(e.orgUnitId ? { orgUnitId: e.orgUnitId } : {}),
  ...(e.object ? { object: e.object } : {}),
  ...(e.until ? { until: e.until } : {}),
});

const sameList = (a: readonly Entry[], b: readonly Entry[]): boolean =>
  JSON.stringify(a.map(wire)) === JSON.stringify(b.map(wire));

const CHAIN_ICON: Readonly<Record<S['DocChainStep']['kind'], string>> = {
  ok: 'check_circle',
  no: 'block',
  wait: 'schedule',
  inh: 'subdirectory_arrow_right',
  up: 'filter_alt',
};

function Avatar(p: { name?: string; icon?: string }): ReactElement {
  return p.name ? (
    <span className="ox-docs-avatar" data-person="" aria-hidden="true">
      {initials(p.name)}
    </span>
  ) : (
    <span className="ox-docs-avatar" aria-hidden="true">
      <Icon name={p.icon ?? 'person'} size={20} />
    </span>
  );
}

interface Target {
  value: string;
  label: string;
  entry: Omit<Entry, 'level'>;
}

export function ShareDialog(p: {
  ctx: DocsCtx;
  doc: S['Document'];
  onClose: () => void;
}): ReactElement {
  const { ctx, doc } = p;
  const can = doc.my.can;
  const api = useApi();
  const run = useRun();
  const [keys] = useState(idemKeys);
  const shares = useShares(ctx.tenantId, doc.id, can.share);
  const links = useLinks(ctx.tenantId, doc.id, can.shareExternal);
  const members = useMembers(ctx.tenantId, can.share);
  const roles = useRoles(ctx.tenantId, can.share);
  const groups = useGroups(ctx.tenantId, can.share);

  const server = shares.data?.shares;
  const [mode, setMode] = useState<'inherit' | 'listed' | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const curMode = mode ?? server?.mode ?? doc.mode;
  const cur = entries ?? server?.entries ?? doc.shares;
  const dirty =
    !!server &&
    ((mode !== null && mode !== server.mode) ||
      (entries !== null && !sameList(entries, server.entries)));

  const [who, setWho] = useState('');
  const [level, setLevel] = useState<Level>('view');
  const curKey = JSON.stringify([curMode, cur.map(wire)]);
  const [probe, setProbe] = useState<{
    key: string;
    impact?: S['DocAccessImpact'];
    err?: string;
  } | null>(null);
  const shownProbe = dirty && probe?.key === curKey ? probe : null;
  const impact = shownProbe?.impact ?? null;
  const impactErr = shownProbe?.err;
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | undefined>();
  const seq = useRef(0);

  const max = rank(doc.my.maxGrant);
  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [{ value: 'all', label: T.share.allLabel, entry: { who: 'all' } }];
    for (const m of members.data ?? []) {
      out.push({
        value: `member:${m.id}`,
        label: `${T.share.groups.member} · ${m.displayName}${m.status === 'invited' ? ` · ${T.share.invited}` : ''}`,
        entry: { who: 'member', refId: m.id, label: m.displayName },
      });
    }
    for (const g of groups.data ?? []) {
      out.push({
        value: `group:${g.id}`,
        label: `${T.share.groups.group} · ${g.name}`,
        entry: { who: 'group', refId: g.id, label: `Группа «${g.name}»` },
      });
    }
    for (const r of roles.data ?? []) {
      out.push({
        value: `role:${r.id}`,
        label: `${T.share.groups.role} · ${r.name}`,
        entry: { who: 'role', refId: r.id, label: `Роль «${r.name}»` },
      });
    }
    const obj = doc.links.find((l) => l.object.moduleKey === 'repairs');
    if (obj) {
      out.push({
        value: 'relation',
        label: `${T.share.groups.relation} · ${fill(T.share.relationLabel, { object: obj.label ?? '' })}`,
        entry: {
          who: 'relation',
          object: obj.object,
          label: fill(T.share.relationLabel, { object: obj.label ?? '' }),
        },
      });
    }
    return out;
  }, [members.data, groups.data, roles.data, doc.links]);

  // «Что изменится»: пробное сохранение при каждом изменении списка (сервер считает влияние на доступ).
  useEffect(() => {
    if (!dirty || !server) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      void commands
        .setShares(
          api,
          ctx.tenantId,
          doc.id,
          shares.data?.etag ?? '',
          { mode: curMode, entries: cur.map(wire), dryRun: true },
          crypto.randomUUID(),
        )
        .then((r) => {
          if (n === seq.current) setProbe({ key: curKey, impact: r.impact });
        })
        .catch((e: unknown) => {
          if (n === seq.current) {
            setProbe({ key: curKey, err: reasonOf(e) });
          }
        });
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, curKey]);

  const add = (): void => {
    const t = targets.find((x) => x.value === who);
    if (!t) return;
    const entry: Entry = { ...t.entry, level };
    const next = [...cur.filter((e) => keyOf(e) !== keyOf(entry)), entry];
    setEntries(next);
    setWho('');
  };
  const setLevelOf = (key: string, l: Level): void =>
    setEntries(cur.map((e) => (keyOf(e) === key ? { ...e, level: l } : e)));
  const remove = (key: string): void => setEntries(cur.filter((e) => keyOf(e) !== key));

  const save = async (): Promise<void> => {
    if (!server) return;
    setSaving(true);
    setSaveErr(undefined);
    const body: S['DocSharesSet'] = { mode: curMode, entries: cur.map(wire) };
    try {
      await run(
        'docs.share',
        () =>
          commands.setShares(
            api,
            ctx.tenantId,
            doc.id,
            shares.data?.etag ?? '',
            body,
            keys.key(body),
          ),
        T.share.saved,
        { quiet: ['validation_failed', 'delegation_exceeds_grant'] },
      );
      keys.settle(body);
      await ctx.refresh();
      p.onClose();
    } catch (e) {
      setSaveErr(reasonOf(e));
      void ctx.refresh();
    } finally {
      setSaving(false);
    }
  };

  // Записи папок цепочки (читает тот, кто правит папку) — только для показа.
  const folderRows = useMemo(() => {
    const out: { entry: Entry; folder: string }[] = [];
    let f = ctx.folders.find((x) => x.id === doc.folderId);
    let guard = 0;
    while (f && guard++ < 12) {
      for (const e of f.shares) out.push({ entry: e, folder: f.name });
      const pid: string | null = f.parentId;
      f = pid ? ctx.folders.find((x) => x.id === pid) : undefined;
    }
    return out;
  }, [ctx.folders, doc.folderId]);

  const countOf = (e: Entry, dot = true): string => {
    const g = e.who === 'group' ? groups.data?.find((x) => x.id === e.refId) : undefined;
    if (!g) return '';
    const s = `${g.memberIds.length} ${plural(g.memberIds.length, T.share.staff)}`;
    return dot ? ` · ${s}` : s;
  };

  const lines = impact ? impactLines(impact) : [];
  const levelOptions = (lim: number) =>
    LEVELS.map((l) => ({
      value: l,
      label: rank(l) > lim ? `${levelName(l)} · ${T.share.above}` : levelName(l),
      disabled: rank(l) > lim,
    }));

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={can.share ? T.share.title : T.share.titleView}
      size="lg"
      busy={saving}
      footer={
        <div className="ox-docs-share-foot">
          <span className="ox-docs-hint">
            <Icon name="history" size={16} /> {T.share.journal}
          </span>
          <span className="ox-docs-grow" />
          <Button variant="secondary" onPress={p.onClose} disabled={saving}>
            {T.share.cancel}
          </Button>
          {can.share ? (
            <Button
              variant="primary"
              onPress={() => void save()}
              loading={saving}
              loadingLabel={shell.modal.busy}
              disabled={!dirty || !!impactErr}
            >
              {T.share.save}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="ox-docs-share ox-docs-form">
        <button type="button" className="ox-docs-icon-btn ox-docs-share-close" onClick={p.onClose}>
          <Icon name="close" size={20} />
          <span className="ox-docs-sr">{T.share.close}</span>
        </button>
        <p className="ox-docs-hint ox-docs-share-sub" data-testid="share-sub">
          {fill(T.share.sub, { title: doc.title, folder: doc.path[doc.path.length - 1] ?? '' })}
        </p>
        <p className="ox-docs-who" data-testid="share-who">
          {can.share
            ? shareHint({ owner: can.shareExternal, my: doc.my })
            : fill(T.share.onlyManage, { who: doc.owner.displayName })}
        </p>
        {saveErr ? (
          <div role="alert" className="ox-docs-alert">
            {saveErr}
          </div>
        ) : null}

        {can.share ? (
          <section className="ox-docs-share-sec" aria-label={T.share.add}>
            <strong>{T.share.add}</strong>
            <div className="ox-docs-share-add">
              <Field label={T.share.addWho}>
                <Select
                  value={who}
                  onChange={setWho}
                  placeholder={T.share.addWho}
                  options={targets.map((t) => ({ value: t.value, label: t.label }))}
                />
              </Field>
              <Button variant="secondary" onPress={add} disabled={!who}>
                {T.share.addButton}
              </Button>
            </div>
            <div role="radiogroup" aria-label={T.share.levelGroup} className="ox-docs-seg">
              {LEVELS.map((l) => {
                const over = rank(l) > max;
                return (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={level === l}
                    disabled={over}
                    title={over ? T.share.above : T.share.levelHint[l]}
                    onClick={() => setLevel(l)}
                  >
                    {levelName(l)}
                  </button>
                );
              })}
            </div>
            <span className="ox-docs-hint">
              {T.share.levelHint[level]}
              {max < 5 ? T.share.levelGrant : '.'}
            </span>
          </section>
        ) : null}

        {can.share && can.manage ? (
          <div role="radiogroup" aria-label={T.share.modeGroup} className="ox-docs-modes">
            {(
              [
                ['inherit', T.share.inherit, T.share.modeInheritDesc],
                ['listed', T.share.listed, T.share.modeListedDesc],
              ] as const
            ).map(([k, title, desc]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={curMode === k}
                onClick={() => setMode(k)}
              >
                <strong>{title}</strong>
                <span className="ox-docs-hint">{desc}</span>
              </button>
            ))}
          </div>
        ) : null}

        <section className="ox-docs-share-sec" aria-label={T.share.list}>
          <strong>{T.share.list}</strong>
          <ul className="ox-docs-people">
            <li className="ox-docs-person">
              <Avatar icon="shield_person" />
              <span className="ox-docs-person-text">
                <span>{T.share.bizOwner}</span>
                <span className="ox-docs-hint">{T.share.bizOwnerSub}</span>
              </span>
              <span className="ox-docs-person-level">{T.share.bizOwnerCan}</span>
            </li>
            <li className="ox-docs-person">
              <Avatar name={doc.owner.displayName} />
              <span className="ox-docs-person-text">
                <span>
                  {doc.owner.displayName} <span className="ox-docs-tag">{T.share.authorTag}</span>
                </span>
                <span className="ox-docs-hint">{T.share.owner}</span>
              </span>
              <span className="ox-docs-person-level">{levelName('manage')}</span>
            </li>
            {curMode === 'inherit'
              ? folderRows.map((r, i) => (
                  <li key={`f${i}`} className="ox-docs-person">
                    <Avatar
                      {...(r.entry.who === 'member' ? { name: r.entry.label ?? '' } : {})}
                      icon={r.entry.who === 'all' ? 'groups' : 'badge'}
                    />
                    <span className="ox-docs-person-text">
                      <span>{r.entry.label ?? ''}</span>
                      <span className="ox-docs-hint">
                        {fill(T.share.folderRow, { folder: r.folder })}
                        {countOf(r.entry)}
                      </span>
                    </span>
                    <span className="ox-docs-person-level">{levelName(r.entry.level)}</span>
                  </li>
                ))
              : null}
            {doc.tempGrants.map((g) => (
              <li key={`t${g.member.memberId}`} className="ox-docs-person">
                <Avatar name={g.member.displayName} />
                <span className="ox-docs-person-text">
                  <span>
                    {g.member.displayName} <span className="ox-docs-tag">{T.share.routeTag}</span>
                  </span>
                  <span className="ox-docs-hint">{g.why}</span>
                </span>
                <span className="ox-docs-person-level">{levelName(g.level)}</span>
              </li>
            ))}
            {cur.map((e) => {
              const key = keyOf(e);
              const locked = rank(e.level) > max;
              const fresh = !!server && !server.entries.some((x) => keyOf(x) === key);
              return (
                <li key={key} className="ox-docs-person" data-new={fresh ? '' : undefined}>
                  <Avatar
                    {...(e.who === 'member' ? { name: e.label ?? '' } : {})}
                    icon={e.who === 'all' ? 'groups' : 'badge'}
                  />
                  <span className="ox-docs-person-text">
                    <span>
                      {e.label ?? ''}
                      {fresh ? <span className="ox-docs-tag">{T.share.newTag}</span> : null}
                    </span>
                    <span className="ox-docs-hint">
                      {[e.who === 'member' ? T.share.person : countOf(e, false), T.share.ownList]
                        .filter(Boolean)
                        .join(' · ')}
                      {e.until ? ` · ${fill(T.share.extUntil, { date: e.until })}` : ''}
                    </span>
                  </span>
                  {can.share ? (
                    <>
                      <span className="ox-docs-person-select">
                        <Select
                          value={e.level}
                          onChange={(v) => setLevelOf(key, v as Level)}
                          options={levelOptions(locked ? 5 : max)}
                          disabled={locked}
                          aria-label={fill(T.share.levelOf, { name: e.label ?? '' })}
                        />
                      </span>
                      <button
                        type="button"
                        className="ox-docs-icon-btn"
                        onClick={() => remove(key)}
                      >
                        <Icon name="close" size={18} />
                        <span className="ox-docs-sr">{`${T.share.remove}: ${e.label ?? ''}`}</span>
                      </button>
                    </>
                  ) : (
                    <span className="ox-docs-person-level">{levelName(e.level)}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {!cur.length && can.share ? <p className="ox-docs-hint">{T.share.listEmpty}</p> : null}
        </section>

        {can.share ? (
          <section className="ox-docs-impact" aria-label={T.share.impact} aria-live="polite">
            <strong>{T.share.impact}</strong>
            {impactErr ? (
              <p role="alert">{impactErr}</p>
            ) : !dirty ? (
              <p>{T.share.impactLoseNone}</p>
            ) : impact ? (
              <ul>
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
                {!impact.lose.length ? <li>{T.share.impactLoseNone}</li> : null}
                {!lines.length ? <li>{T.share.impactNone}</li> : null}
              </ul>
            ) : (
              <p>{shell.a11y.loading}…</p>
            )}
          </section>
        ) : null}

        <ExternalLinks
          ctx={ctx}
          doc={doc}
          links={links.data ?? []}
          onChanged={() => void links.refetch()}
        />

        {doc.my.chain?.length ? (
          <section className="ox-docs-share-sec" aria-label={T.share.chain}>
            <strong>{T.share.chain}</strong>
            <ol className="ox-docs-chain">
              {doc.my.chain
                .filter((c) => c.title !== T.share.chainTotal)
                .map((c, i) => (
                  <li key={i} data-kind={c.kind}>
                    <Icon name={CHAIN_ICON[c.kind]} size={18} />
                    <span>
                      <strong>{c.title}</strong>
                      <span className="ox-docs-hint">{c.detail}</span>
                    </span>
                  </li>
                ))}
            </ol>
            <strong className="ox-docs-chain-total" data-testid="share-total">
              {`${T.share.chainTotal}: ${doc.my.level ? `«${levelName(doc.my.level)}»` : T.share.totalNone}${dirty ? T.share.totalUnsaved : ''}`}
            </strong>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

// ───────────────────────────── внешняя ссылка ─────────────────────────────

function ExternalLinks(p: {
  ctx: DocsCtx;
  doc: S['Document'];
  links: readonly S['DocExternalLink'][];
  onChanged: () => void;
}): ReactElement {
  const { ctx, doc } = p;
  const api = useApi();
  const run = useRun();
  const today = todayOf(ctx.now);
  const [until, setUntil] = useState(extExpiry(today));
  const [pin, setPin] = useState(true);
  const [mark, setMark] = useState(true);
  const [download, setDownload] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [secret, setSecret] = useState<S['DocExternalLinkCreated'] | null>(null);
  const [busy, setBusy] = useState(false);
  const can = doc.my.can.shareExternal;

  const create = async (): Promise<void> => {
    const bad = extExpiryError(until, today);
    setErr(bad ?? undefined);
    if (bad) return;
    setBusy(true);
    try {
      const made = await run(
        'docs.link',
        () =>
          commands.createLink(api, ctx.tenantId, doc.id, {
            level: 'view',
            expiresAt: endOfDay(until),
            pin,
            watermark: mark,
            download,
          }),
        T.share.extCreated,
        { quiet: ['validation_failed'] },
      );
      setSecret(made);
      p.onChanged();
    } catch (e) {
      setErr(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    try {
      await run(
        'docs.link',
        () => commands.revokeLink(api, ctx.tenantId, doc.id, id),
        T.share.extRevoked,
      );
      p.onChanged();
    } catch {
      // тост показал `run`
    }
  };

  return (
    <section className="ox-docs-share-sec" aria-label={T.share.ext}>
      <strong>{T.share.ext}</strong>
      <span className="ox-docs-hint">{T.share.extNote}</span>
      <span className="ox-docs-hint">{fill(T.share.extFor, { v: doc.version })}</span>
      {!can ? (
        <p className="ox-docs-hint">{T.share.extOnlyOwner}</p>
      ) : (
        <>
          <ul className="ox-docs-people">
            {p.links.map((l) => (
              <li key={l.id} className="ox-docs-person" data-status={l.status}>
                <Icon name="link" size={18} />
                <span className="ox-docs-person-text">
                  <span>
                    {fill(T.share.extLevel, { v: doc.version })} ·{' '}
                    {fill(T.share.extUntil, {
                      date: l.expiresAt.slice(0, 10).split('-').reverse().join('.'),
                    })}
                  </span>
                  <span className="ox-docs-hint">
                    {[
                      l.pin ? T.share.extPin : null,
                      l.watermark ? T.share.extWatermark : null,
                      l.download ? null : T.share.extNoDownload,
                      fill(T.share.extOpens, { n: l.openCount }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {l.status === 'active' ? (
                  <button
                    type="button"
                    className="ox-docs-link-btn"
                    onClick={() => void revoke(l.id)}
                  >
                    {T.share.extRevoke}
                  </button>
                ) : (
                  <span className="ox-docs-person-level">
                    {l.status === 'revoked' ? 'Отозвана' : 'Истекла'}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!p.links.length ? <p className="ox-docs-hint">{T.share.extNone}</p> : null}
          {secret ? (
            <div className="ox-docs-secret" role="status">
              <strong>{T.share.extSecret}</strong>
              <code>{secret.url}</code>
              {secret.pin ? <code>PIN {secret.pin}</code> : null}
            </div>
          ) : null}
          <div className="ox-docs-share-add">
            <Field label={T.share.extUntilLabel} {...(err ? { error: err } : {})}>
              <DateInput value={until} onChange={setUntil} />
            </Field>
          </div>
          <Switch checked={pin} onChange={setPin} label={T.share.extPin} />
          <Switch checked={mark} onChange={setMark} label={T.share.extWatermark} />
          <Switch
            checked={!download}
            onChange={(v) => setDownload(!v)}
            label={T.share.extNoDownload}
          />
          <Button
            variant="secondary"
            onPress={() => void create()}
            loading={busy}
            loadingLabel={shell.modal.busy}
          >
            {T.share.extCreate}
          </Button>
        </>
      )}
    </section>
  );
}
