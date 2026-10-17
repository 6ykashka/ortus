// W1.24 · Страница «Модули и место» (`company-modules`, S1-17…S1-19; эталон design-stage-1 «Ортус CRM.dc.html»
// :205–281, omVM :3100–3137; 02-company.md §5). Каталог — listModuleCatalog, подключение и отключение —
// setModuleInstallation с диалогами эталона (отключение — «Затронет сейчас» из previewModuleDeactivation, S1-18),
// место — getStorageUsage/getStorageBreakdown, лимит — requestStorageChange. Демо-кнопок нет (PD-54).
import type { components } from '@ortus/api-client';
import { company, shell, toast as TOAST } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useId, useMemo, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import {
  afterModule,
  fetchPreview,
  afterQuota,
  commitStorage,
  quoteStorage,
  setModule,
  useBreakdown,
  useCatalog,
  useHolders,
  useStorageUsage,
} from './api.ts';
import { ConfirmModal } from './dialog.tsx';
import { breakdownRows, changeDoneText, GiB, storageView } from './storage.ts';
import { MOD_TEXT, t } from './texts.ts';
import {
  CardAlert,
  Glyph,
  LoadFailed,
  PageHead,
  PageSkeleton,
  Pill,
  SkeletonLines,
  UsageBar,
  useRetryFocus,
} from './ui.tsx';
import {
  type ApiModuleKey,
  connectDialog,
  coreTiles,
  type DialogModel,
  disconnectDialog,
  type IndustryCard,
  industryCards,
  isRestricted,
  quotaDialog,
  statusCard,
} from './vm.ts';
import './modules.css';

const T = company.modules;
const NO_HOLDERS = { fleet: 0, spa: 0, repairs: 0 } as const;

type Pending =
  | { kind: 'connect'; key: ApiModuleKey; name: string }
  | {
      kind: 'disconnect';
      key: ApiModuleKey;
      name: string;
      preview: components['schemas']['ModuleDeactivationPreview'];
    }
  | { kind: 'quota'; gb: number }
  | null;

function ModuleCardView(p: {
  card: IndustryCard;
  showRoles: boolean;
  onToggle: () => void;
  onNext: () => void;
}): ReactElement {
  const c = p.card;
  return (
    <article className="ox-mod-card">
      <div className="ox-mod-card-top">
        <span className="ox-mod-card-icon">
          <Icon name={c.icon} size={22} />
        </span>
        <Pill chip={c.chip} />
      </div>
      <div className="ox-mod-card-text">
        <h3 className="ox-mod-card-name">{c.name}</h3>
        <p className="ox-mod-card-desc">{c.desc}</p>
      </div>
      <div className="ox-mod-deps">
        <span>{T.industry.uses}</span>
        {c.deps.map((d) => (
          <span key={d} className="ox-mod-dep">
            <Glyph name="check" className="ox-mod-dep-icon" />
            <span className="ox-mod-dep-name">{d}</span>
          </span>
        ))}
      </div>
      {p.showRoles ? (
        <div className="ox-mod-roles">
          <Icon name="badge" size={18} className="ox-mod-roles-icon" />
          <span className="ox-mod-roles-text">{c.roleNote}</span>
        </div>
      ) : null}
      <div className="ox-mod-actions">
        {c.on ? (
          <button
            type="button"
            className="ox-mod-btn"
            data-variant="secondary"
            onClick={p.onToggle}
          >
            {T.industry.disconnect}
          </button>
        ) : (
          <button
            type="button"
            className="ox-mod-btn"
            data-variant="primary"
            disabled={c.locked}
            onClick={p.onToggle}
          >
            {T.industry.connect}
          </button>
        )}
        {c.showNext ? (
          <button type="button" className="ox-mod-btn" data-variant="text" onClick={p.onNext}>
            {T.industry.assignRoles}
            <Icon name="arrow_forward" size={18} />
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function ModulesPage(): ReactElement {
  const { tenant, tenantId: id, go } = useShell();
  const tenantId = id ?? '';
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const busyMod = useBusy('mod');
  const busyQuota = useBusy('quota');
  const catalog = useCatalog(tenantId);
  const usage = useStorageUsage(tenantId);
  const breakdown = useBreakdown(tenantId);
  const holders = useHolders(tenantId);
  const [pick, setPick] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  /** «Лимит места»: фокус после смены лимита, когда «Изменить лимит» становится недоступной (PD-29). */
  const limitId = useId();
  const restricted = isRestricted(tenant?.tenantState);
  const tenantName = tenant?.name ?? '';
  /** «Повторить» после ошибки каталога: каталог загрузился — фокус на заголовке страницы, а не на body. */
  const retryCatalog = useRetryFocus(catalog.isSuccess, () => document.getElementById('h-mod'));

  const dialog = useMemo((): DialogModel | null => {
    if (!pending) return null;
    if (pending.kind === 'connect') return connectDialog(pending.key, tenantName);
    if (pending.kind === 'disconnect') return disconnectDialog(pending.key, pending.preview);
    return usage.data ? quotaDialog(usage.data, pending.gb) : null;
  }, [pending, usage.data, tenantName]);

  /** «Отключить»: сначала «Затронет сейчас» (S1-18), затем диалог; сбой предпросмотра — тост команды. */
  const openDisconnect = async (key: ApiModuleKey, name: string): Promise<void> => {
    try {
      const preview = await run('preview', () => fetchPreview(api, tenantId, key));
      setPending({ kind: 'disconnect', key, name, preview });
    } catch {
      // тост команды
    }
  };

  const head = (
    <PageHead
      id="h-mod"
      crumb={t(company.crumbs.company, { tenant: tenantName })}
      title={shell.nav.items.modules}
      intro={T.intro}
    />
  );
  if (catalog.isPending) {
    return (
      <section aria-labelledby="h-mod" className="ox-mod">
        {head}
        <PageSkeleton />
      </section>
    );
  }
  if (catalog.isError) {
    return (
      <section aria-labelledby="h-mod" className="ox-mod">
        {head}
        <LoadFailed error={catalog.error} onRetry={retryCatalog(() => catalog.refetch())} />
      </section>
    );
  }

  const status = statusCard(tenant?.tenantState, new Date());
  const cards = industryCards(catalog.data.items, holders.data ?? NO_HOLDERS, {
    restricted,
    busy: busyMod,
  });
  const tiles = coreTiles(catalog.data.items);

  const confirm = async (): Promise<void> => {
    if (!pending) return;
    try {
      if (pending.kind === 'quota') {
        const done = await run(
          'quota',
          async () =>
            commitStorage(api, tenantId, await quoteStorage(api, tenantId, pending.gb * GiB)),
          null,
        );
        // `scheduled` (уменьшение вступит позже) не выдаётся за применённый лимит.
        toast(changeDoneText(done), 'ok');
        await afterQuota(qc, tenantId);
        setPick(null);
      } else {
        const on = pending.kind === 'connect';
        await run(
          'mod',
          () => setModule(api, tenantId, pending.key, on),
          on
            ? t(TOAST.company.moduleConnected, { name: pending.name })
            : TOAST.company.moduleDisconnected,
        );
        await afterModule(qc, tenantId);
      }
      setPending(null);
    } catch {
      // Ошибку показал тост команды; диалог остаётся открытым (:2660, :2681).
    }
  };

  return (
    <section aria-labelledby="h-mod" className="ox-mod">
      {head}
      {status ? (
        <div className="ox-mod-status">
          <div className="ox-mod-status-main">
            <span className="ox-mod-status-icon" data-tone={status.chip.tone}>
              <Icon name={status.chip.icon} size={22} />
            </span>
            <div className="ox-mod-status-body">
              <div className="ox-mod-status-line">
                <strong className="ox-mod-status-title">{status.title}</strong>
                <Pill chip={status.chip} />
              </div>
              <span className="ox-mod-status-text">{status.text}</span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="ox-mod-block" data-gap="10">
        <h2 className="ox-mod-h2">{T.industry.title}</h2>
        <div className="ox-mod-grid">
          {cards.map((c) => (
            <ModuleCardView
              key={c.key}
              card={c}
              showRoles={holders.isSuccess}
              onToggle={() => {
                if (c.on) void openDisconnect(c.key, c.name);
                else setPending({ kind: 'connect', key: c.key, name: c.name });
              }}
              onNext={() => go('users')}
            />
          ))}
        </div>
      </div>

      <div className="ox-mod-block" data-gap="10">
        <div className="ox-mod-h2row">
          <h2 className="ox-mod-h2">{T.core.title}</h2>
          <span className="ox-mod-note">{T.core.note}</span>
        </div>
        <div className="ox-mod-core-grid">
          {tiles.map((c) => (
            <div key={c.key} className="ox-mod-core">
              <Icon name={c.icon} size={20} className="ox-mod-core-icon" />
              <div className="ox-mod-core-text">
                <span className="ox-mod-core-name">{c.name}</span>
                <span className="ox-mod-core-used">{c.usedBy}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <StorageCard
        tenantId={tenantId}
        usage={usage}
        breakdown={breakdown}
        pick={pick}
        restricted={restricted}
        onPick={setPick}
        selectId={limitId}
        onApply={(gb) => setPending({ kind: 'quota', gb })}
        onOpenStorage={() => go('storage')}
      />

      {dialog ? (
        <ConfirmModal
          key={dialog.title}
          model={dialog}
          busy={busyMod || busyQuota}
          onClose={() => setPending(null)}
          onConfirm={() => void confirm()}
          {...(pending?.kind === 'quota'
            ? { fallbackFocus: () => document.getElementById(limitId) }
            : {})}
        />
      ) : null}
    </section>
  );
}

function StorageCard(p: {
  tenantId: string;
  usage: ReturnType<typeof useStorageUsage>;
  breakdown: ReturnType<typeof useBreakdown>;
  pick: string | null;
  restricted: boolean;
  selectId: string;
  onPick: (v: string) => void;
  onApply: (gb: number) => void;
  onOpenStorage: () => void;
}): ReactElement | null {
  const S = T.storage;
  const titleId = useId();
  const focusTitle = (): HTMLElement | null => document.getElementById(titleId);
  // «Повторить» места или разбивки: данные пришли — фокус на заголовке карточки (кнопка исчезла).
  const retryUsage = useRetryFocus(p.usage.isSuccess, focusTitle);
  const retryBreakdown = useRetryFocus(p.breakdown.isSuccess, focusTitle);
  const top = (
    <div className="ox-mod-storage-top">
      <div>
        <h2 id={titleId} className="ox-mod-h2" tabIndex={-1}>
          {S.title}
        </h2>
        <span className="ox-mod-note">{S.note}</span>
      </div>
    </div>
  );
  // Ошибка и загрузка места: карточка с заголовком остаётся на своём месте (Q-W1.24-19).
  if (p.usage.isError) {
    return (
      <div className="ox-mod-storage">
        {top}
        <LoadFailed
          error={p.usage.error}
          onRetry={retryUsage(() => p.usage.refetch())}
          describedBy={titleId}
        />
      </div>
    );
  }
  if (!p.usage.data) {
    return (
      <div className="ox-mod-storage" aria-busy="true">
        {top}
        <span className="ox-mod-skel-bar" />
      </div>
    );
  }
  const v = storageView(p.usage.data);
  const value = p.pick ?? String(v.quotaNum);
  const same = Number(value) === v.quotaNum || p.restricted;
  return (
    <div className="ox-mod-storage">
      <div className="ox-mod-storage-top">
        <div>
          <h2 id={titleId} className="ox-mod-h2" tabIndex={-1}>
            {S.title}
          </h2>
          <span className="ox-mod-note">{S.note}</span>
        </div>
        <div className="ox-mod-storage-num">
          {v.used} <span className="ox-mod-storage-of">{t(S.of, { quota: v.quota })}</span>
        </div>
      </div>
      <UsageBar
        pct={v.pct}
        tone={v.tone}
        meter={{ label: S.meter, now: v.usedNum, max: v.quotaNum }}
      />
      {p.breakdown.data ? (
        <div className="ox-mod-breaks">
          {breakdownRows(p.breakdown.data).map((b) => (
            <div key={b.key} className="ox-mod-break">
              <span className="ox-mod-break-label">{b.label}</span>
              <span className="ox-mod-break-gb">{b.gb}</span>
            </div>
          ))}
        </div>
      ) : p.breakdown.isError ? (
        <LoadFailed
          error={p.breakdown.error}
          onRetry={retryBreakdown(() => p.breakdown.refetch())}
          describedBy={titleId}
        />
      ) : (
        <div className="ox-mod-breaks" aria-busy="true">
          <SkeletonLines n={4} className="ox-mod-break-skel" />
        </div>
      )}
      {v.over ? <CardAlert>{v.overText}</CardAlert> : null}
      <div className="ox-mod-limit">
        <label className="ox-mod-field">
          {S.limit}{' '}
          <select
            id={p.selectId}
            value={value}
            onChange={(e) => p.onPick(e.target.value)}
            className="ox-mod-select"
          >
            {v.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ox-mod-btn"
          data-variant="primary"
          data-size="lg"
          disabled={same}
          onClick={() => p.onApply(Number(value))}
        >
          {S.apply}
        </button>
        <span className="ox-mod-cost">{S.costNote}</span>
        <a
          className="ox-mod-link"
          href={`/t/${p.tenantId}/storage`}
          onClick={(e) => {
            e.preventDefault();
            p.onOpenStorage();
          }}
        >
          {MOD_TEXT.storageLink}
          <Icon name="arrow_forward" size={18} />
        </a>
      </div>
    </div>
  );
}
