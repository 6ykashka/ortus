// W4.61 · «Пользователи платформы» оператора (pg.accounts «Ортус CRM.dc.html» :987–1159, accountsVM :3619–3679;
// design-2026-10-19): организации слева (`?org=` — all, platform или id), поиск и фильтры со счётчиками, шапка
// организации, строки аккаунтов с popover участий (наведение и фокус), «Карточка аккаунта» (`?account=`) с
// блокировкой входа, разблокировкой и сбросом второго фактора; «Ортус · Платформа» — операторы (platform.tsx).
import '../kit/kit.css';
import './accounts.css';

import type { components, ProblemError } from '@ortus/api-client';
import { platform, screenLabels, toast as TOAST } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useId, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { useCommand, violation } from '../kit/api.ts';
import { useConfirm } from '../kit/confirm.tsx';
import {
  AreaSkeleton,
  isForbidden,
  Notice,
  PageHead,
  Pills,
  RetryAlert,
  StatusChip,
} from '../kit/ui.tsx';
import { useUsage } from '../usage/api.ts';
import {
  lockUser,
  resetMfa,
  unlockUser,
  useAllCount,
  useOperators,
  useTenantList,
  useUserCard,
  useUserCards,
  useUsersBase,
  useUsersList,
} from './api.ts';
import {
  accountCard,
  accountRow,
  type Filter,
  filterPills,
  lockSpec,
  mfaSpec,
  orgHead,
  popover,
  realmTenants,
  totalText,
  unlockSpec,
} from './model.ts';
import { PlatformOrg } from './platform.tsx';
import { ACCOUNTS_TEXT as T } from './texts.ts';

type User = components['schemas']['PlatformUser'];

const A = platform.accounts;
const REASON_MIN = 5;
const REASON_MAX = 500;

const LOCK_ERRORS = {
  invalid_transition: T.alreadyLocked,
  validation_failed: (e: ProblemError) => violation(e, 'reason') ?? T.reasonLength,
};
const MFA_ERRORS = { invalid_transition: T.noMfaToReset };

type Search = { org?: string; account?: string };

function useSelection(): {
  org: string;
  account: string | undefined;
  go: (next: Search) => void;
} {
  const navigate = useNavigate();
  const raw = useLocation().search as Readonly<Record<string, unknown>>;
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const org = text(raw.org) ?? 'all';
  const account = text(raw.account);
  const go = (next: Search) => {
    const search: Search = {};
    if (next.org && next.org !== 'all') search.org = next.org;
    if (next.account) search.account = next.account;
    void navigate({ to: '/platform/$page', params: { page: 'accounts' }, search: search as never });
  };
  return { org, account, go };
}

function Realms({ org, onSelect }: { org: string; onSelect: (org: string) => void }): ReactElement {
  const tenants = useTenantList();
  const all = useAllCount();
  const ops = useOperators();
  const platformN = (ops.data?.items ?? []).filter((o) => o.status !== 'disabled').length;
  const items = realmTenants(tenants.data ?? []);
  const isPlatform = org === 'platform';
  return (
    <nav aria-label={T.realm.aria} className="ox-pk-card ox-acc-realms">
      <span className="ox-acc-group">{T.realm.platformGroup}</span>
      <button
        type="button"
        className="ox-acc-realm-platform"
        aria-current={isPlatform ? 'page' : 'false'}
        onClick={() => onSelect('platform')}
      >
        <span className="ox-acc-realm-mark" aria-hidden="true">
          о
        </span>{' '}
        <span className="ox-acc-realm-text">
          <span className="ox-acc-realm-name">{T.realm.platformName}</span>
          <span className="ox-acc-realm-sub">{T.realm.platformSub}</span>
        </span>{' '}
        <span className="ox-acc-realm-n">{ops.data ? platformN : ''}</span>
      </button>
      <span className="ox-acc-group ox-acc-group-clients">{T.realm.clientsGroup}</span>
      <button
        type="button"
        className="ox-acc-realm"
        aria-current={org === 'all' ? 'page' : 'false'}
        onClick={() => onSelect('all')}
      >
        <Icon name="public" size={20} className="ox-acc-realm-icon" />{' '}
        <span className="ox-acc-realm-text">
          <span className="ox-acc-realm-name">{T.realm.all}</span>
          <span className="ox-acc-realm-sub">{T.realm.allSub}</span>
        </span>{' '}
        <span className="ox-acc-realm-n">{all.data ?? ''}</span>
      </button>
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          className="ox-acc-realm"
          aria-current={org === t.id ? 'page' : 'false'}
          onClick={() => onSelect(t.id)}
        >
          <span className="ox-acc-realm-tile" aria-hidden="true" style={{ background: t.tileBg }}>
            {t.letter}
          </span>{' '}
          <span className="ox-acc-realm-text">
            <span className="ox-acc-realm-name">{t.name}</span>
            <span className="ox-acc-realm-sub">{t.sub}</span>
          </span>{' '}
          <span className="ox-acc-realm-n">{t.n}</span>
        </button>
      ))}
    </nav>
  );
}

function OrgHead({ org, onCard }: { org: string; onCard: () => void }): ReactElement | null {
  const tenants = useTenantList();
  const usage = useUsage();
  const t = (tenants.data ?? []).find((x) => x.id === org);
  if (!t) return null;
  const u = usage.data?.tenants.find((x) => x.tenantId === org);
  const h = orgHead(t, {
    ...(u?.ownerName ? { ownerName: u.ownerName } : {}),
    ...(u?.tierName ? { tierName: u.tierName } : {}),
  });
  return (
    <div className="ox-pk-card ox-acc-orghead">
      <span className="ox-acc-orghead-icon" aria-hidden="true">
        <Icon name="domain" size={22} />
      </span>
      <div className="ox-acc-orghead-main">
        <span className="ox-acc-orghead-title">
          <strong>{h.name}</strong>
          <StatusChip chip={h.chip} />
        </span>
        <span className="ox-acc-orghead-line">{h.line}</span>
      </div>
      <button type="button" className="ox-pk-btn" data-size="md" onClick={onCard}>
        <Icon name="open_in_new" size={18} />
        {T.orgCard}
      </button>
    </div>
  );
}

function AccountCard({ user }: { user: User }): ReactElement {
  const api = useApi();
  const toast = useToast();
  const command = useCommand();
  const confirm = useConfirm();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const c = accountCard(user);
  const lock = () => {
    const r = reason.trim();
    if (!r) {
      toast(TOAST.platform.lockReasonRequired, 'warn');
      return;
    }
    if (r.length < REASON_MIN || r.length > REASON_MAX) {
      toast(T.reasonLength, 'warn');
      return;
    }
    confirm.ask(lockSpec(user, r), () =>
      command('lock', () => lockUser(api, user.id, r), undefined, { texts: LOCK_ERRORS }).then(() =>
        setReason(''),
      ),
    );
  };
  return (
    <aside aria-label={T.card.aria} className="ox-pk-card ox-acc-card">
      <div className="ox-acc-card-head">
        <span className="ox-acc-avatar" data-size="44" aria-hidden="true">
          {c.initials}
        </span>
        <div className="ox-acc-card-name">
          <h2>{c.name}</h2>
          <span>{c.email}</span>
        </div>
      </div>
      <StatusChip chip={c.chip} className="ox-acc-card-chip" />
      {c.lockReason ? <div className="ox-acc-lock-reason">{c.lockReason}</div> : null}
      <dl className="ox-acc-card-dl">
        <dt>{T.card.last}</dt>
        <dd>{c.last}</dd> <dt>{T.card.mfa}</dt>
        <dd>{c.mfa}</dd>
      </dl>
      <div className="ox-acc-card-ms">
        <h3>{T.card.memberships}</h3>
        {c.memberships.map((m) => (
          <div key={m.tenantId} className="ox-acc-membership">
            <Icon name="domain" size={18} />
            <span className="ox-acc-membership-org">{m.org}</span>
            {m.owner ? <span className="ox-acc-owner">{T.card.owner}</span> : null}
            <StatusChip chip={m.chip} />
          </div>
        ))}
        {c.multi ? <p className="ox-acc-multi">{c.multi}</p> : null}
      </div>
      <div className="ox-acc-card-actions">
        {c.canLock ? (
          <>
            <label className="ox-pk-label" htmlFor={reasonId}>
              {T.card.reasonLabel}
              <input
                id={reasonId}
                className="ox-pk-input"
                value={reason}
                placeholder={T.card.reasonPlaceholder}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button type="button" className="ox-pk-btn" data-variant="danger" onClick={lock}>
              <Icon name="lock" size={18} />
              {T.card.lock}
            </button>
          </>
        ) : null}
        {c.canUnlock ? (
          <button
            type="button"
            className="ox-pk-btn"
            data-variant="primary"
            onClick={() =>
              confirm.ask(unlockSpec(user.email), () =>
                command('unlock', () => unlockUser(api, user.id)),
              )
            }
          >
            <Icon name="lock_open" size={18} />
            {T.card.unlock}
          </button>
        ) : null}
        {c.canResetMfa ? (
          <button
            type="button"
            className="ox-pk-btn"
            onClick={() =>
              confirm.ask(mfaSpec(user.email), () =>
                command('mfa', () => resetMfa(api, user.id), undefined, { texts: MFA_ERRORS }),
              )
            }
          >
            <Icon name="key" size={18} />
            {T.card.resetMfa}
          </button>
        ) : null}
        <p className="ox-acc-card-note">{T.card.note}</p>
      </div>
      {confirm.node}
    </aside>
  );
}

function AccountRows({
  list,
  org,
  selectedId,
  onSelect,
  onOpenOrg,
}: {
  list: readonly User[];
  org: string;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onOpenOrg: (tenantId: string, accountId: string) => void;
}): ReactElement {
  const [hover, setHover] = useState<string | null>(null);
  const inOrg = org === 'all' ? null : org;
  // Участия строк: в организации — у всех строк (чип участия), иначе — у строки под указателем (popover).
  const ids = inOrg ? list.map((u) => u.id) : hover ? [hover] : [];
  const cards = useUserCards(ids);
  if (list.length === 0) return <div className="ox-acc-empty">{T.empty}</div>;
  return (
    <>
      {list.map((u) => {
        const card = cards.get(u.id);
        const r = accountRow(u, card, inOrg);
        const open = hover === u.id;
        const pop = open && card ? popover(card, inOrg) : null;
        return (
          <div
            key={u.id}
            className="ox-acc-row"
            data-open={open || undefined}
            onMouseEnter={() => setHover(u.id)}
            onMouseLeave={() => setHover((h) => (h === u.id ? null : h))}
            onFocus={() => setHover(u.id)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setHover((h) => (h === u.id ? null : h));
              }
            }}
          >
            <button type="button" aria-pressed={u.id === selectedId} onClick={() => onSelect(u.id)}>
              <span className="ox-acc-avatar" aria-hidden="true">
                {r.initials}
              </span>{' '}
              <div className="ox-acc-who">
                <span className="ox-acc-name">{r.name}</span>
                <span className="ox-acc-email">{r.email}</span>
              </div>{' '}
              <div className="ox-acc-orgs">
                {r.inOrgChip ? <StatusChip chip={r.inOrgChip} className="ox-acc-inorg" /> : null}{' '}
                <span className="ox-acc-count">
                  <Icon name="domain" size={15} />
                  {r.orgCount}
                </span>
              </div>{' '}
              <div className="ox-acc-status">
                <StatusChip chip={r.chip} />{' '}
                <span className="ox-acc-mfa" data-on={r.mfa.on || undefined}>
                  <Icon name={r.mfa.icon} size={16} />
                  {r.mfa.label}
                </span>{' '}
                <span className="ox-acc-last">{r.last}</span>
              </div>
            </button>
            {pop ? (
              <div role="group" aria-label={T.pop.aria} className="ox-acc-pop">
                <span className="ox-acc-pop-title">{pop.title}</span>
                {pop.items.map((m) => (
                  <button
                    key={m.tenantId}
                    type="button"
                    aria-current={m.current ? 'true' : 'false'}
                    onClick={() => {
                      setHover(null);
                      onOpenOrg(m.tenantId, u.id);
                    }}
                  >
                    {/* Пробелы между частями — как разметка эталона :1117–1121 (доступное имя пункта). */}
                    <Icon name="domain" size={18} />{' '}
                    <span className="ox-acc-pop-text">
                      <span className="ox-acc-pop-org">{m.org}</span>
                      <span className="ox-acc-pop-state">{m.state}</span>
                    </span>{' '}
                    {m.owner ? <span className="ox-acc-owner">{T.pop.owner}</span> : null}{' '}
                    <StatusChip chip={m.chip} /> <Icon name="chevron_right" size={18} />
                  </button>
                ))}
                <span className="ox-acc-pop-footer">{T.pop.footer}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function Catalog({
  org,
  account,
  go,
}: {
  org: string;
  account: string | undefined;
  go: (next: Search) => void;
}): ReactElement {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const base = useUsersBase(org);
  const list = useUsersList(org, q, filter);
  const items = list.data?.items ?? [];
  const baseItems = base.data?.items ?? [];
  const selected =
    items.find((u) => u.id === account) ??
    items[0] ??
    baseItems.find((u) => u.id === account) ??
    baseItems[0];
  const card = useUserCard(selected?.id);
  const failed = base.isError ? base : list.isError ? list : null;
  const openCard = (tenantId: string) =>
    void navigate({
      to: '/platform/$page',
      params: { page: 'tenants' },
      search: { org: tenantId } as never,
    });
  const total = base.data?.counts.all ?? 0;
  return (
    <>
      <div className="ox-acc-banner">
        <Icon name="admin_panel_settings" size={20} />
        <span>{A.intro}</span>
      </div>
      <div className="ox-acc-search-row">
        <label className="ox-acc-search">
          <Icon name="search" size={20} />
          <input
            type="search"
            value={q}
            aria-label={A.searchAria}
            placeholder={A.searchPlaceholder}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <span className="ox-acc-total">
          {base.data && list.data ? totalText(org === 'all', total, items.length) : ''}
        </span>
      </div>
      {base.data ? (
        <Pills
          label={A.filterAria}
          items={filterPills(base.data.counts)}
          value={filter}
          onChange={setFilter}
        />
      ) : null}
      <div className="ox-acc-body">
        {/* Организации слева, список и карточка — строки раскладки эталона :1002–1156. */}
        <Realms org={org} onSelect={(next) => go({ org: next })} />
        <div className="ox-acc-center">
          {org !== 'all' ? <OrgHead org={org} onCard={() => openCard(org)} /> : null}
          {failed && isForbidden(failed.error) ? (
            <Notice>{T.forbidden}</Notice>
          ) : failed ? (
            <RetryAlert
              text={T.loadError}
              error={failed.error}
              onRetry={() => {
                void base.refetch();
                void list.refetch();
              }}
            />
          ) : list.data && base.data ? (
            <div className="ox-pk-card ox-acc-list">
              <AccountRows
                list={items}
                org={org}
                selectedId={selected?.id}
                onSelect={(id) => go({ org, account: id })}
                onOpenOrg={(tenantId, accountId) => go({ org: tenantId, account: accountId })}
              />
            </div>
          ) : (
            <AreaSkeleton blocks={1} />
          )}
        </div>
        {/* До ответа getPlatformUser — строка списка (без участий): карточка не прыгает при выборе. */}
        {selected ? <AccountCard key={selected.id} user={card.data ?? selected} /> : null}
      </div>
    </>
  );
}

export default function AccountsPage(): ReactElement {
  const { org, account, go } = useSelection();
  return (
    <section
      className="ox-pk ox-acc"
      aria-labelledby="h-acc"
      data-screen-label={screenLabels.byPage.accounts}
    >
      <PageHead id="h-acc" crumb={platform.crumb} title={A.title} />
      {org === 'platform' ? (
        <div className="ox-acc-body">
          <Realms org={org} onSelect={(next) => go({ org: next })} />
          <div className="ox-acc-center">
            <PlatformOrg />
          </div>
        </div>
      ) : (
        <Catalog org={org} account={account} go={go} />
      )}
    </section>
  );
}
