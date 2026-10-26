// W5.32 · Страница «Касса» (`cash`, `/t/:tenantId/cash`; эталон design-2026-10-19 «Касса.dc.html», разбор
// docs/plan/v2/analysis/dor/cash.md §1): вкладки «Кассы», «Входящие», «Смены», «Настройки», диалоги модуля.
// Вкладка «Подотчёт» выдающего и страница «Мой подотчёт» — W5.33: компонент `./advances/tab.tsx` подхватывается, если он есть.
// Данные — контракт 0.12.0-stage5 (тег Cash), права кнопок — `account.my`, деньги — копейки; нет связи — кнопки заблокированы
// (Q-W4.00-cash-18); диплинк `?open=inbox|pr:<ключ>|rq:<id>|tr:<id>|sh:<id>|adv:<id>|acc:<id>` (K:552).
import { ProblemError } from '@ortus/api-client';
import { format, shell as shellTexts } from '@ortus/texts';
import { Banner, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import {
  type ComponentType,
  lazy,
  type ReactElement,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import { useApi } from '../../app/api.tsx';
import { useCan, useShell } from '../../shell/context.tsx';
import { problemText } from '../../shell/run.tsx';
import { useOrgUnits } from '../../shell/scope.ts';
import { useToast } from '../../shell/toast.tsx';
import { AccountDialog } from './account-dialog.tsx';
import {
  afterChange,
  useAccounts,
  useCategories,
  useMemberNames,
  useOperations,
  useProposals,
  useRequests,
  useShifts,
  useTransfers,
} from './api.ts';
import { type CashCtx, CashContext, type Modal, type Tab } from './ctx.tsx';
import {
  CloseShiftDialog,
  OpDialog,
  OpenShiftDialog,
  ReasonDialog,
  TransferDialog,
} from './dialogs.tsx';
import { DeskTab, isSelfAdvance } from './desk.tsx';
import { InboxTab } from './inbox.tsx';
import { canAcceptTransfer, canDecideRequest, hasRight, plural } from './model.ts';
import { SettingsTab } from './settings.tsx';
import { ShiftsTab } from './shifts.tsx';
import { CASH_TEXT as T } from './texts.ts';
import { Alert, Button, Note } from './ui.tsx';
import './cash.css';

const advanceFiles = import.meta.glob<{ default: ComponentType<{ tenantId: string }> }>(
  './advances/tab.tsx',
);
const AdvancesTab = advanceFiles['./advances/tab.tsx']
  ? lazy(advanceFiles['./advances/tab.tsx'])
  : null;

const INLINE_CODES = new Set([
  'validation_failed',
  'shift_closed',
  'duplicate_source',
  'duplicate_receipt',
  'self_approval',
  'insufficient_funds',
  'invalid_transition',
  'forbidden_action',
  'refund_exceeds_payment',
]);

/** Текст ошибки команды: сообщение сервера для отказов кассы, иначе текст оболочки по коду. */
export function errText(e: unknown): string {
  if (e instanceof ProblemError && INLINE_CODES.has(e.code)) {
    return e.problem?.violations?.[0]?.message || e.problem?.detail || problemText(e);
  }
  return problemText(e);
}

const subscribe = (cb: () => void): (() => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};
const useOffline = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );

interface Nav {
  tab: Tab;
  acc: string | undefined;
  ib: string | undefined;
  sh: string | undefined;
}

function parseOpen(open: string): Partial<Nav> | null {
  const i = open.indexOf(':');
  const k = i < 0 ? open : open.slice(0, i);
  const id = i < 0 ? '' : open.slice(i + 1);
  if (k === 'inbox') return { tab: 'inbox' };
  if (k === 'pr' || k === 'rq' || k === 'tr') return { tab: 'inbox', ib: open };
  if (k === 'sh') return { tab: 'shifts', sh: id };
  if (k === 'adv') return { tab: 'adv' };
  if (k === 'acc') return { tab: 'desk', acc: id };
  return null;
}

export default function CashPage(): ReactElement {
  const sh = useShell();
  const tenantId = sh.tenantId ?? '';
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const navigate = useNavigate();
  const location = useLocation();
  const owner = sh.audience === 'owner';
  const offline = useOffline();

  const accounts = useAccounts(tenantId);
  const list = useMemo(() => accounts.data ?? [], [accounts.data]);
  const loaded = accounts.isSuccess && list.length > 0;
  const ops = useOperations(tenantId, loaded);
  const shifts = useShifts(tenantId, loaded);
  const transfers = useTransfers(tenantId, loaded);
  const proposals = useProposals(tenantId, loaded);
  const requests = useRequests(tenantId, loaded);
  const categories = useCategories(tenantId);
  const members = useMemberNames(tenantId, owner || can('members.read'));
  const units = useOrgUnits(tenantId, owner || can('org_units.read'));

  const [nav, setNav] = useState<Nav>({
    tab: 'desk',
    acc: undefined,
    ib: undefined,
    sh: undefined,
  });
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [keys] = useState(() => new Map<string, string>());
  const [seenOpen, setSeenOpen] = useState('');

  const rawOpen = (location.search as Record<string, unknown>).open;
  const open = typeof rawOpen === 'string' ? rawOpen : '';
  if (open && loaded && seenOpen !== open) {
    setSeenOpen(open);
    const p = parseOpen(open);
    if (p) setNav((n) => ({ ...n, ...p }));
  }
  useEffect(() => {
    if (!open || !loaded) return;
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'cash' },
      search: {} as never,
      replace: true,
    });
  }, [open, loaded, navigate, tenantId]);

  const keyFor = useCallback(
    (sig: string): string => {
      const k = keys.get(sig) ?? crypto.randomUUID();
      keys.set(sig, k);
      return k;
    },
    [keys],
  );

  const call = useCallback<CashCtx['call']>(
    async (sig, fn, ok) => {
      setBusy(true);
      setErr('');
      try {
        const r = await fn(keyFor(sig));
        keys.delete(sig);
        await afterChange(qc, tenantId);
        const text = typeof ok === 'function' ? ok(r) : ok;
        if (text) toast(text, 'ok');
        return r;
      } catch (e) {
        setErr(errText(e));
        void afterChange(qc, tenantId);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [qc, tenantId, toast, keyFor, keys],
  );

  const submit = useCallback<CashCtx['submit']>(
    async (sig, fn, ok) => {
      try {
        const r = await fn(keyFor(sig));
        keys.delete(sig);
        await afterChange(qc, tenantId);
        toast(typeof ok === 'function' ? ok(r) : ok, 'ok');
        return { ok: true, data: r };
      } catch (e) {
        void afterChange(qc, tenantId);
        return { ok: false, error: errText(e) };
      }
    },
    [qc, tenantId, toast, keyFor, keys],
  );

  const memberList = useMemo(() => members.data ?? [], [members.data]);
  const unitList = useMemo(() => units.data ?? [], [units.data]);
  const ctx: CashCtx = useMemo(
    () => ({
      tenantId,
      api,
      meId: memberList.find((m) => m.userId === sh.me.userId)?.id ?? sh.tenant?.membershipId ?? '',
      accounts: list,
      accountOf: (id) => list.find((a) => a.id === id),
      ops: ops.data ?? [],
      shifts: shifts.data ?? [],
      transfers: transfers.data ?? [],
      proposals: proposals.data ?? [],
      requests: requests.data ?? [],
      categories: categories.data ?? [],
      members: memberList,
      memberName: (id) =>
        memberList.find((m) => m.id === id)?.displayName ?? T.journal.unknownMember,
      units: unitList,
      unitTitle: (id) =>
        id === null ? T.unitOrg : (unitList.find((u) => u.id === id)?.name ?? T.unitFallback),
      busy,
      offline,
      call,
      submit,
      openModal: setModal,
      closeModal: () => setModal(null),
      go: sh.go,
      show: (n) =>
        setNav((cur) => ({
          ...cur,
          ...(n.tab ? { tab: n.tab } : {}),
          ...(n.shift ? { sh: n.shift } : {}),
          ...(n.account ? { acc: n.account } : {}),
        })),
      now: new Date(),
    }),
    [
      tenantId,
      api,
      sh.tenant?.membershipId,
      sh.me.userId,
      sh.go,
      list,
      ops.data,
      shifts.data,
      transfers.data,
      proposals.data,
      requests.data,
      categories.data,
      memberList,
      unitList,
      busy,
      offline,
      call,
      submit,
    ],
  );

  const head = (sub: string, tabs?: ReactElement, action?: ReactElement): ReactElement => (
    <div className="ox-ca-head">
      <div className="ox-ca-title">
        <h1 id="h-cash" tabIndex={-1}>
          {T.title}
        </h1>
        <span className="ox-ca-sub">{sub}</span>
      </div>
      {tabs ? (
        <div className="ox-ca-tabs">
          {tabs}
          {action}
        </div>
      ) : null}
    </div>
  );

  if (accounts.isPending) {
    return (
      <section aria-labelledby="h-cash" className="ox-ca">
        {head('')}
        <Skeleton lines={5} label={T.loading} />
      </section>
    );
  }
  if (accounts.isError) {
    return (
      <section aria-labelledby="h-cash" className="ox-ca">
        {head('')}
        <Banner
          tone="danger"
          role="alert"
          title={format(T.loadFailed, { error: problemText(accounts.error) })}
          action={{ label: T.retry, onPress: () => void accounts.refetch() }}
        />
      </section>
    );
  }
  if (list.length === 0) {
    return (
      <section aria-labelledby="h-cash" className="ox-ca">
        {head(T.noneSub)}
        <div className="ox-ca-none">
          <span className="material-symbols-rounded" aria-hidden="true">
            lock
          </span>
          <span>{T.none}</span>
        </div>
      </section>
    );
  }
  if (list.every(isSelfAdvance)) {
    return (
      <section aria-labelledby="h-cash" className="ox-ca">
        {head(T.noneSub)}
        <Note tone="info" icon="badge">
          {T.selfOnly}
        </Note>
        <div>
          <Button variant="primary" onClick={() => sh.go('cashSelf')}>
            {T.selfOnlyOpen}
          </Button>
        </div>
      </section>
    );
  }

  const inboxN =
    ctx.proposals.length +
    ctx.requests.filter((q) => canDecideRequest(q, ctx.accountOf(q.accountId), ctx.meId)).length +
    ctx.transfers.filter((t) => canAcceptTransfer(t, ctx.accountOf(t.toAccountId))).length;
  const hasShifts = list.some((a) => a.kind === 'cash_drawer' && a.shiftMode !== 'none');
  const revN = ctx.shifts.filter(
    (s) =>
      s.status === 'review' &&
      hasRight(ctx.accountOf(s.accountId), 'cash.reconcile') &&
      s.closedByMemberId !== ctx.meId,
  ).length;
  const advIssuer =
    AdvancesTab !== null &&
    list.some(
      (a) => a.kind === 'advance' && !isSelfAdvance(a) && hasRight(a, 'cash.advance.issue'),
    );
  const defs: [Tab, string, number][] = [
    ['desk', T.tabs.desk, 0],
    ['inbox', T.tabs.inbox, inboxN],
    ...(hasShifts ? ([['shifts', T.tabs.shifts, revN]] as [Tab, string, number][]) : []),
    ...(advIssuer ? ([['adv', T.tabs.adv, 0]] as [Tab, string, number][]) : []),
    ...(can('cash.accounts.manage')
      ? ([['settings', T.tabs.settings, 0]] as [Tab, string, number][])
      : []),
  ];
  const tab: Tab = defs.some((d) => d[0] === nav.tab) ? nav.tab : 'desk';

  const opAccs = list.filter(
    (a) => hasRight(a, 'cash.post') && a.kind !== 'advance' && !isSelfAdvance(a),
  );
  const sub =
    plural(list.length, ...T.inScope) +
    T.inScopeTail +
    (list.some((a) => a.balance === null) ? T.hiddenBalances : '');

  const tabs = (
    <>
      {defs.map(([k, label, n]) => (
        <button
          key={k}
          type="button"
          className="ox-ca-tab"
          aria-pressed={k === tab}
          onClick={() => {
            setNav((cur) => ({ ...cur, tab: k }));
            setErr('');
          }}
        >
          {label}
          {n > 0 ? <span className="ox-ca-count">{n}</span> : null}
        </button>
      ))}
    </>
  );
  const newOp =
    opAccs.length > 0 ? (
      <Button
        variant="primary"
        icon="add"
        disabled={offline}
        onClick={() =>
          setModal({
            kind: 'op',
            accountId: opAccs.some((a) => a.id === nav.acc) ? nav.acc : opAccs[0]?.id,
          })
        }
      >
        {T.newOperation}
      </Button>
    ) : undefined;

  return (
    <CashContext value={ctx}>
      <section aria-labelledby="h-cash" className="ox-ca">
        {head(sub, tabs, newOp)}
        {tab === 'desk' && list.some((a) => a.kktMode === 'manual') ? (
          <div className="ox-ca-banner">
            <span className="material-symbols-rounded" aria-hidden="true">
              info
            </span>
            <span>{T.kkt}</span>
          </div>
        ) : null}
        {offline ? (
          <Note tone="warn" icon="cloud_off">
            {T.offline}
          </Note>
        ) : null}
        {err ? <Alert onClose={() => setErr('')}>{err}</Alert> : null}
        {tab === 'desk' ? (
          <DeskTab selected={nav.acc} onSelect={(id) => setNav((n) => ({ ...n, acc: id }))} />
        ) : null}
        {tab === 'inbox' ? (
          <InboxTab selected={nav.ib} onSelect={(k) => setNav((n) => ({ ...n, ib: k }))} />
        ) : null}
        {tab === 'shifts' ? (
          <ShiftsTab selected={nav.sh} onSelect={(id) => setNav((n) => ({ ...n, sh: id }))} />
        ) : null}
        {tab === 'adv' && AdvancesTab ? (
          <Suspense fallback={<Skeleton lines={4} label={shellTexts.a11y.loading} />}>
            <AdvancesTab tenantId={tenantId} />
          </Suspense>
        ) : null}
        {tab === 'settings' ? <SettingsTab /> : null}
        {modal?.kind === 'op' ? <OpDialog modal={modal} /> : null}
        {modal?.kind === 'openShift' ? <OpenShiftDialog modal={modal} /> : null}
        {modal?.kind === 'closeShift' ? <CloseShiftDialog modal={modal} /> : null}
        {modal?.kind === 'transfer' ? <TransferDialog modal={modal} /> : null}
        {modal?.kind === 'reason' ? <ReasonDialog modal={modal} /> : null}
        {modal?.kind === 'account' ? <AccountDialog /> : null}
      </section>
    </CashContext>
  );
}
