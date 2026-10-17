// W1.25 · «Организации-клиенты» оператора (pg.tenants «Ортус CRM.dc.html» :1529–1583, opVM :3532–3568; снимок
// design-stage-1): список организаций, карточка выбранной (`?org=<tenantId>`, ADR-0001), команды с причиной
// (S1-04) и «Журнал действий» (S1-23). Данные — контракт 0.4.0-stage1; чего в нём нет — «—» (бриф W1.25 §10).
import './tenants.css';

import { format, platform, screenLabels, shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { type ReactElement, type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { problemCode, problemText } from '../../../../shell/run.tsx';
import {
  type CommandKind,
  type SubscriptionState,
  useAudit,
  useCommandSender,
  useSubscriptions,
  useTenant,
  useTenants,
} from './api.ts';
import { CommandDialog, COMMANDS } from './CommandDialog.tsx';
import {
  actionsFor,
  auditLine,
  type Chip,
  markLetter,
  ownerLine,
  paymentText,
  planText,
  seatsText,
  statusChip,
  type Subscription,
  type Tenant,
  trialText,
  usageText,
} from './model.ts';
import { ORGS_TEXT as T } from './texts.ts';

const P = platform.tenants;

/**
 * Текст ошибки чтения: нет связи — свой текст (общий текст offline оболочки «…Операция не выполнена.» написан
 * для команд, Q-W1.25-25), прочие коды — как у команд.
 */
function readProblemText(e: unknown): string {
  return problemCode(e) === 'offline' ? T.offlineRead : problemText(e);
}

/**
 * Значение, которое ещё загружается: скелетон рисует сам элемент с `data-loading` (без текста — axe
 * color-contrast), внутри — скрытое «Загрузка» для чтения с экрана, а не «—» как данные (возврат доделки №2).
 */
function LoadingText(): ReactElement {
  return <span className="ox-sr">{shell.a11y.loading}</span>;
}

function StatusChip({ chip }: { chip: Chip }): ReactElement {
  return (
    <span className="ox-chip" data-tone={chip.tone}>
      <Icon name={chip.icon} size={15} />
      <span className="ox-chip-label">{chip.label}</span>
    </span>
  );
}

/** Полоса заполнения: занятое место и места — этап 4 (контракт оператора их не отдаёт), заливки нет. */
function Bar({ size }: { size: 6 | 8 }): ReactElement {
  return (
    <span className="ox-orgs-bar" data-size={size} aria-hidden="true">
      <span className="ox-orgs-bar-fill" />
    </span>
  );
}

function OrgRow({
  tenant,
  sub,
  subFailed,
  subPending,
  selected,
  now,
  onSelect,
}: {
  tenant: Tenant;
  sub: Subscription | undefined;
  /** Подписка не загрузилась: колонка пробного периода говорит об этом, а не «—» (без эталона, Q-W1.25-20). */
  subFailed: boolean;
  /** Подписка загружается: колонки из неё — скелетон (`data-loading`), а не «—» этапа 4 (Q-W1.25-23). */
  subPending: boolean;
  selected: boolean;
  now: number;
  onSelect: () => void;
}): ReactElement {
  const loading = (subPending && !sub) || undefined;
  return (
    <button type="button" className="ox-org-row" aria-pressed={selected} onClick={onSelect}>
      {/* Пробелы между колонками — как в разметке эталона :1840–1853: доступное имя строки читается
          по колонкам (во flex-контейнере пробельный текст не рисуется). */}
      <span className="ox-org-mark" aria-hidden="true">
        {markLetter(tenant.name)}
      </span>{' '}
      <span className="ox-org-main">
        <span className="ox-org-name">{tenant.name}</span>
        <span className="ox-org-owner" data-loading={loading}>
          {loading ? <LoadingText /> : ownerLine(sub)}
        </span>
      </span>{' '}
      <span className="ox-org-state">
        <StatusChip chip={statusChip(tenant.status)} />
      </span>{' '}
      <span className="ox-org-storage">
        <span className="ox-org-usage" data-loading={loading} aria-hidden={loading}>
          {loading ? null : usageText(sub)}
        </span>
        <Bar size={6} />
      </span>{' '}
      {subFailed && !sub ? (
        <span className="ox-org-trial" data-failed="true">
          {T.subMissing}
        </span>
      ) : (
        <span className="ox-org-trial" data-loading={loading} aria-hidden={loading}>
          {loading ? null : trialText(sub, now)}
        </span>
      )}
    </button>
  );
}

/**
 * Загрузка списка (без эталона): скелетон строк в рамке списка, статус «Загрузка» — для чтения с экрана. Рядом —
 * подложка карточки (aria-hidden): скелетон занимает колонку списка, раскладка после ответа не перестраивается.
 */
function ListSkeleton(): ReactElement {
  return (
    <div className="ox-orgs-body">
      <div className="ox-orgs-list ox-orgs-skeleton" role="status" aria-label={shell.a11y.loading}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ox-orgs-skeleton-row">
            <span className="ox-orgs-skeleton-mark" />
            <span className="ox-orgs-skeleton-lines">
              <span className="ox-skeleton-bar" />
              <span className="ox-skeleton-bar" data-size="sub" />
            </span>
          </div>
        ))}
      </div>
      <div className="ox-org-card ox-org-card-skeleton" aria-hidden="true">
        <span className="ox-skeleton-bar" />
        <span className="ox-skeleton-bar" data-size="sub" />
        <span className="ox-skeleton-bar" data-size="sub" />
        <span className="ox-skeleton-bar" data-size="sub" />
      </div>
    </div>
  );
}

interface Pending {
  kind: CommandKind;
  tenant: Tenant;
  etag: string;
}

/** Ошибка загрузки (без эталона): текст по коду ошибки и «Повторить». */
function RetryAlert({
  text,
  error,
  onRetry,
  className = 'ox-orgs-error',
}: {
  text: string;
  error: unknown;
  onRetry: () => void;
  className?: string;
}): ReactElement {
  return (
    <div className={className} role="alert">
      <span>{format(text, { error: readProblemText(error) })}</span>
      <button type="button" className="ox-org-action" data-variant="secondary" onClick={onRetry}>
        {T.retry}
      </button>
    </div>
  );
}

/**
 * Загрузка части карточки: статус «Загрузка» со скелетоном; без скелетона — только для чтения с экрана
 * (значения карточки сами показаны скелетоном, `data-loading`).
 */
function Loading({ children }: { children?: ReactNode }): ReactElement {
  return (
    <div
      role="status"
      aria-label={shell.a11y.loading}
      className={children ? 'ox-org-loading' : 'ox-sr'}
    >
      {children}
    </div>
  );
}

/** «Журнал действий»: загрузка — скелетон, ошибка — alert с «Повторить», пусто — текст (без эталона). */
function AuditLog(): ReactElement {
  const audit = useAudit();
  let body: ReactNode;
  if (audit.data) {
    body =
      audit.data.length > 0 ? (
        audit.data.map((e) => {
          const line = auditLine(e);
          return (
            <div key={e.id} className="ox-audit-row">
              <span className="ox-audit-text">{line.text}</span>
              {line.reason ? <span className="ox-audit-reason">{line.reason}</span> : null}
              <span className="ox-audit-meta">{line.meta}</span>
            </div>
          );
        })
      ) : (
        <p className="ox-audit-empty">{T.card.auditEmpty}</p>
      );
  } else if (audit.isError) {
    body = (
      <RetryAlert
        className="ox-orgs-error ox-org-alert"
        text={T.card.auditError}
        error={audit.error}
        onRetry={() => void audit.refetch()}
      />
    );
  } else {
    body = (
      <Loading>
        <span className="ox-skeleton-bar ox-audit-skeleton" />
        <span className="ox-skeleton-bar ox-audit-skeleton" />
      </Loading>
    );
  }
  return (
    <div className="ox-audit">
      <h3>{P.audit}</h3>
      {body}
    </div>
  );
}

/** Организация из getPlatformTenant: ETag команд suspend/resume, ошибка и повтор. */
interface TenantState {
  etag: string | undefined;
  error: Error | null;
  refetch: () => void;
}

function OrgCard({
  tenant,
  fresh,
  sub,
  onRetrySubs,
  now,
  onCommand,
}: {
  tenant: Tenant;
  /** Пока ETag организации нет (загрузка, ошибка) — её команды недоступны. */
  fresh: TenantState;
  sub: SubscriptionState | undefined;
  /** «Повторить» ошибки подписки: перечитать все неудавшиеся подписки списка. */
  onRetrySubs: () => void;
  now: number;
  onCommand: (p: Pending) => void;
}): ReactElement {
  const headingId = useId();
  const data = sub?.data?.data;
  const subPending = sub?.pending ?? true;
  const acts = actionsFor(tenant, data);
  const { etag } = fresh;
  // Второй элемент — значение; третий — табличные цифры (в эталоне только у «Место», :1556), четвёртый —
  // значение из подписки (скелетон, пока она загружается).
  const fields: [string, string, boolean, boolean][] = [
    [P.fields.owner, T.dash, false, false],
    [P.fields.trial, trialText(data, now), false, true],
    [P.fields.modules, T.dash, false, false],
    [P.fields.members, T.dash, false, false],
    [P.fields.storage, usageText(data), true, true],
    [P.fields.plan, planText(data), false, true],
    [P.fields.payment, paymentText(data), false, true],
  ];
  const loading = (fromSub: boolean) => (fromSub && subPending) || undefined;
  return (
    <aside className="ox-org-card" aria-labelledby={headingId} aria-busy={subPending || undefined}>
      <div className="ox-org-card-head">
        <h2 id={headingId}>{tenant.name}</h2>
        <StatusChip chip={statusChip(tenant.status)} />
      </div>
      {subPending ? <Loading /> : null}
      {sub?.error ? (
        <RetryAlert
          className="ox-orgs-error ox-org-alert"
          text={T.card.subError}
          error={sub.error}
          onRetry={onRetrySubs}
        />
      ) : null}
      {fresh.error ? (
        <RetryAlert
          className="ox-orgs-error ox-org-alert"
          text={T.card.tenantError}
          error={fresh.error}
          onRetry={fresh.refetch}
        />
      ) : null}
      <dl className="ox-org-fields">
        {fields.map(([label, value, numeric, fromSub]) => (
          <div key={label} className="ox-org-field">
            <dt>{label}</dt>
            <dd data-numeric={numeric || undefined} data-loading={loading(fromSub)}>
              {loading(fromSub) ? <LoadingText /> : value}
            </dd>
          </div>
        ))}
      </dl>
      <Bar size={8} />
      <div className="ox-org-seats-block">
        <div className="ox-org-seats-row">
          <span className="ox-org-seats-label">{P.fields.seats}</span>
          <span className="ox-org-seats" data-loading={loading(true)}>
            {loading(true) ? <LoadingText /> : seatsText(data)}
          </span>
        </div>
        <Bar size={8} />
      </div>
      <div className="ox-org-actions">
        {acts.extend && sub?.data ? (
          <button
            type="button"
            className="ox-org-action"
            data-variant="primary"
            data-command="extend"
            onClick={() => sub.data && onCommand({ kind: 'extend', tenant, etag: sub.data.etag })}
          >
            <Icon name="more_time" size={18} />
            {P.actions.extend}
          </button>
        ) : null}
        {acts.suspend ? (
          <button
            type="button"
            className="ox-org-action"
            data-variant="danger"
            data-command="suspend"
            disabled={!etag}
            onClick={() => etag && onCommand({ kind: 'suspend', tenant, etag })}
          >
            <Icon name="lock_clock" size={18} />
            {P.actions.restrict}
          </button>
        ) : null}
        {acts.resume ? (
          <button
            type="button"
            className="ox-org-action"
            data-variant="secondary"
            data-command="resume"
            disabled={!etag}
            onClick={() => etag && onCommand({ kind: 'resume', tenant, etag })}
          >
            <Icon name="lock_open" size={18} />
            {P.actions.lift}
          </button>
        ) : null}
      </div>
      <p className="ox-org-note">{P.note}</p>
      <AuditLog />
    </aside>
  );
}

/** Действие, которое сменяет выполненное: после «Ограничить…» — «Снять ограничение» и наоборот. */
const NEXT_ACTION: Readonly<Record<CommandKind, CommandKind>> = {
  extend: 'extend',
  suspend: 'resume',
  resume: 'suspend',
};

/**
 * Фокус после команды: модальное окно возвращает его на кнопку-триггер, а если её больше нет (действие сменилось)
 * — фокус на body. Тогда — на сменившее её действие карточки или первое действие (после возврата фокуса окном:
 * кадр анимации и задача).
 */
function focusAfter(kind: CommandKind): void {
  requestAnimationFrame(() =>
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const card = document.querySelector('.ox-org-card');
      const next =
        card?.querySelector<HTMLElement>(`[data-command="${NEXT_ACTION[kind]}"]`) ??
        card?.querySelector<HTMLElement>('.ox-org-action');
      next?.focus();
    }, 0),
  );
}

/**
 * Диалог команды с отправкой: живёт, пока открыт (ключ — команда и организация), и держит попытку
 * (Idempotency-Key, If-Match) до определённого исхода — useCommandSender.
 */
function PendingCommand({
  pending,
  etag,
  onClose,
}: {
  pending: Pending;
  /** Текущий ETag ресурса команды (перечитанный после 409/412), иначе — ETag на момент открытия. */
  etag: string;
  onClose: () => void;
}): ReactElement {
  const send = useCommandSender(pending.kind, pending.tenant.id);
  return (
    <CommandDialog
      spec={COMMANDS[pending.kind](pending.tenant.name)}
      onClose={onClose}
      onConfirm={async (reason) => {
        await send(reason, etag);
        focusAfter(pending.kind);
      }}
    />
  );
}

function Body({ tenants }: { tenants: readonly Tenant[] }): ReactElement {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Readonly<Record<string, unknown>>;
  const [now] = useState(() => Date.now());
  const [pending, setPending] = useState<Pending | null>(null);
  const subs = useSubscriptions(tenants.map((t) => t.id));
  const selectedId = tenants.some((t) => t.id === search.org)
    ? (search.org as string)
    : tenants[0]?.id;
  const fresh = useTenant(selectedId);
  const listed = tenants.find((t) => t.id === selectedId);
  const selected = fresh.data?.data ?? listed;
  const retrySubs = () => {
    for (const s of subs.values()) if (s.error) s.refetch();
  };
  /** ETag ресурса команды сейчас: подписки для продления, организации — для suspend/resume. */
  const currentEtag = (p: Pending): string =>
    (p.kind === 'extend'
      ? subs.get(p.tenant.id)?.data?.etag
      : fresh.data?.data.id === p.tenant.id
        ? fresh.data.etag
        : undefined) ?? p.etag;

  const select = (id: string) =>
    void navigate({
      to: '/platform/$page',
      params: { page: 'tenants' },
      search: { org: id } as never,
    });

  return (
    <div className="ox-orgs-body">
      <div className="ox-orgs-list">
        {tenants.map((t) => (
          <OrgRow
            key={t.id}
            tenant={t}
            sub={subs.get(t.id)?.data?.data}
            subFailed={Boolean(subs.get(t.id)?.error)}
            subPending={subs.get(t.id)?.pending ?? true}
            selected={t.id === selectedId}
            now={now}
            onSelect={() => select(t.id)}
          />
        ))}
      </div>
      {selected ? (
        <OrgCard
          tenant={selected}
          fresh={{
            etag: fresh.data?.etag,
            error: fresh.isError ? fresh.error : null,
            refetch: () => void fresh.refetch(),
          }}
          sub={subs.get(selected.id)}
          onRetrySubs={retrySubs}
          now={now}
          onCommand={setPending}
        />
      ) : null}
      {pending ? (
        <PendingCommand
          key={`${pending.kind}:${pending.tenant.id}`}
          pending={pending}
          etag={currentEtag(pending)}
          onClose={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}

export default function TenantsPage(): ReactElement {
  const list = useTenants();
  const sectionRef = useRef<HTMLElement>(null);
  /** «Повторить» ошибки списка: после ответа alert с кнопкой исчезает — фокус на выбранную строку (или h1). */
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current || !list.data) return;
    refocus.current = false;
    const root = sectionRef.current;
    const target =
      root?.querySelector<HTMLElement>('.ox-org-row[aria-pressed="true"]') ??
      root?.querySelector<HTMLElement>('h1');
    target?.focus();
  }, [list.data]);
  let content: ReactElement;
  if (list.data) {
    content =
      list.data.length > 0 ? (
        <Body tenants={list.data} />
      ) : (
        <p className="ox-orgs-empty">{T.empty}</p>
      );
  } else if (list.isError) {
    content = (
      <RetryAlert
        text={T.loadError}
        error={list.error}
        onRetry={() => {
          refocus.current = true;
          void list.refetch();
        }}
      />
    );
  } else {
    content = <ListSkeleton />;
  }
  return (
    <section
      ref={sectionRef}
      className="ox-orgs"
      aria-labelledby="h-ten"
      data-screen-label={screenLabels.byPage.tenants}
    >
      <div className="ox-orgs-head">
        <div className="ox-orgs-crumb">{platform.crumb}</div>
        <h1 id="h-ten" tabIndex={-1}>
          {P.title}
        </h1>
      </div>
      <div className="ox-orgs-intro">
        <Icon name="admin_panel_settings" size={20} />
        <span>{P.intro}</span>
      </div>
      {content}
    </section>
  );
}
