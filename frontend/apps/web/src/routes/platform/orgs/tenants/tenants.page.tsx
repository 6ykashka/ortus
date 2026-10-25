// W1.25 · «Организации-клиенты» оператора (pg.tenants «Ортус CRM.dc.html» :1529–1583, opVM :3532–3568): список
// организаций, карточка выбранной (`?org=<tenantId>`, ADR-0001), команды с причиной (S1-04) и «Журнал действий»
// (S1-23). W4.84 (эталон design-2026-10-19): владелец, модули, занятое место (getPlatformUsage), места и участники,
// срок и сумма подписки, «Квота места» (updatePlatformSubscription с причиной) и плашка заявки на тариф.
import './tenants.css';

import { format, platform, screenLabels, shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { problemCode, problemText } from '../../../../shell/run.tsx';
import {
  type CommandKind,
  type SubscriptionState,
  useAudit,
  useCommandSender,
  usePendingRequests,
  useSubscriptions,
  useTenant,
  useTenants,
  useUsage,
} from './api.ts';
import { CommandDialog, COMMANDS, type CommandSpec, quotaCommand } from './CommandDialog.tsx';
import {
  actionsFor,
  auditLine,
  type ChangeRequest,
  type Chip,
  type Fill,
  markLetter,
  membersText,
  modulesText,
  num,
  ownerLine,
  paymentText,
  planText,
  type QuotaOption,
  quotaGb,
  quotaOptions,
  quotaUpdate,
  requestText,
  seatsFill,
  seatsOf,
  seatsText,
  statusChip,
  storageFill,
  type Subscription,
  type Tenant,
  trialText,
  type UsageRow,
  usageText,
  usedGb,
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

/** Полоса заполнения (opVM pW/sW, bar/sBar): ширина и цвет — места или места с входом (W4.84). */
function Bar({ size, fill }: { size: 6 | 8; fill: Fill }): ReactElement {
  return (
    <span className="ox-orgs-bar" data-size={size} data-tone={fill.tone} aria-hidden="true">
      <span className="ox-orgs-bar-fill" style={{ width: fill.width }} />
    </span>
  );
}

/** Строка «Использования» организации и её загрузка (W4.84: владелец, модули, занятое место). */
interface UsageState {
  row: UsageRow | undefined;
  pending: boolean;
}

function OrgRow({
  tenant,
  sub,
  subFailed,
  subPending,
  usage,
  selected,
  now,
  onSelect,
}: {
  tenant: Tenant;
  sub: Subscription | undefined;
  /** Подписка не загрузилась: колонка пробного периода говорит об этом, а не «—» (без эталона, Q-W1.25-20). */
  subFailed: boolean;
  /** Подписка загружается: колонки из неё — скелетон (`data-loading`), а не «—» (Q-W1.25-23). */
  subPending: boolean;
  usage: UsageState;
  selected: boolean;
  now: number;
  onSelect: () => void;
}): ReactElement {
  const subLoading = subPending && !sub;
  const trialLoading = subLoading || undefined;
  // Владелец и занятое место — из «Использования», места и квота — из подписки: скелетон, пока нет обоих.
  const loading = subLoading || (usage.pending && !usage.row) || undefined;
  return (
    <button type="button" className="ox-org-row" aria-pressed={selected} onClick={onSelect}>
      {/* Пробелы между колонками — как в разметке эталона :1840–1853: доступное имя строки читается
          по колонкам (во flex-контейнере пробельный текст не рисуется). */}
      {/* W4.62: знак по оформлению организации (Tenant.brand, :1540–1541) — файл знака или буква короткого имени
          (иначе названия) на акценте организации; интерфейс оператора остаётся в цветах Ортуса. */}
      {tenant.brand?.markUrl ? (
        <span
          className="ox-org-mark"
          data-file="true"
          aria-hidden="true"
          style={{ backgroundImage: `url("${tenant.brand.markUrl}")` }}
        />
      ) : (
        <span
          className="ox-org-mark"
          aria-hidden="true"
          style={tenant.brand ? { background: tenant.brand.accentUsed } : undefined}
        >
          {markLetter(tenant.brand?.shortName || tenant.name)}
        </span>
      )}{' '}
      <span className="ox-org-main">
        <span className="ox-org-name">{tenant.name}</span>
        <span className="ox-org-owner" data-loading={loading}>
          {loading ? <LoadingText /> : ownerLine(usage.row?.ownerName, seatsOf(tenant, sub))}
        </span>
      </span>{' '}
      <span className="ox-org-state">
        <StatusChip chip={statusChip(tenant.status)} />
      </span>{' '}
      <span className="ox-org-storage">
        <span className="ox-org-usage" data-loading={loading} aria-hidden={loading}>
          {loading ? null : usageText(usage.row?.storageUsedBytes, sub)}
        </span>
        <Bar size={6} fill={storageFill(usage.row?.storageUsedBytes, sub)} />
      </span>{' '}
      {subFailed && !sub ? (
        <span className="ox-org-trial" data-failed="true">
          {T.subMissing}
        </span>
      ) : (
        <span className="ox-org-trial" data-loading={trialLoading} aria-hidden={trialLoading}>
          {trialLoading ? null : trialText(sub, now)}
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
  /** «Квота места»: выбранная квота, ГБ (W4.84). */
  gb?: number;
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

/** «Использование» карточки (W4.84): строка организации, загрузка, ошибка и повтор. */
interface CardUsage extends UsageState {
  error: Error | null;
  refetch: () => void;
}

/**
 * «Квота места» + «Применить» (opVM :3565): варианты 25–500 ГБ, текущая выбрана; «Применить» недоступна, пока
 * выбор совпадает с текущей квотой. Выбор живёт до успешной команды (ключ карточки — организация).
 */
function QuotaPicker({
  options,
  current,
  onApply,
}: {
  options: readonly QuotaOption[];
  current: string;
  onApply: (gb: number) => void;
}): ReactElement {
  const id = useId();
  // Выбор помнит квоту, от которой сделан: квота изменилась на сервере (успешная команда, перечитывание) —
  // выбор сбрасывается к ней без эффекта.
  const [choice, setChoice] = useState<{ from: string; value: string } | null>(null);
  const value = choice?.from === current ? choice.value : current;
  return (
    <div className="ox-org-quota">
      <label className="ox-org-quota-label" htmlFor={id}>
        {P.actions.quota}
        <select
          id={id}
          className="ox-org-quota-select"
          data-command="quota"
          value={value}
          onChange={(e) => setChoice({ from: current, value: e.target.value })}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="ox-org-action"
        data-variant="secondary"
        disabled={value === current}
        onClick={() => onApply(Number(value))}
      >
        {P.actions.apply}
      </button>
    </div>
  );
}

/** Плашка заявки на тариф (opVM :3565) и «Открыть заявку» → «Заявки на тариф». */
function RequestPlaque({ request }: { request: ChangeRequest }): ReactElement {
  const navigate = useNavigate();
  return (
    <div className="ox-org-request">
      <Icon name="pending" size={18} />
      <span className="ox-org-request-text">{requestText(request)}</span>
      <button
        type="button"
        className="ox-org-request-open"
        onClick={() => void navigate({ to: '/platform/$page', params: { page: 'requests' } })}
      >
        {P.actions.openRequest}
      </button>
    </div>
  );
}

function OrgCard({
  tenant,
  fresh,
  sub,
  usage,
  request,
  onRetrySubs,
  now,
  onCommand,
}: {
  tenant: Tenant;
  /** Пока ETag организации нет (загрузка, ошибка) — её команды недоступны. */
  fresh: TenantState;
  sub: SubscriptionState | undefined;
  usage: CardUsage;
  /** Заявка на тариф на рассмотрении (W4.84). */
  request: ChangeRequest | undefined;
  /** «Повторить» ошибки подписки: перечитать все неудавшиеся подписки списка. */
  onRetrySubs: () => void;
  now: number;
  onCommand: (p: Pending) => void;
}): ReactElement {
  const headingId = useId();
  const data = sub?.data?.data;
  const subPending = sub?.pending ?? true;
  const usagePending = usage.pending && !usage.row;
  const used = usage.row?.storageUsedBytes;
  const members = tenant.memberCount ?? usage.row?.memberCount;
  const acts = actionsFor(tenant, data);
  const { etag } = fresh;
  const quota = quotaGb(data);
  // Значение; табличные цифры (в эталоне только у «Место», :1556); загружается ли источник значения.
  const fields: [string, string, boolean, boolean][] = [
    [P.fields.owner, usage.row?.ownerName || T.dash, false, usagePending],
    [P.fields.trial, trialText(data, now), false, subPending],
    [P.fields.modules, modulesText(usage.row?.moduleKeys), false, usagePending],
    [P.fields.members, membersText(members), false, members === undefined && usagePending],
    [P.fields.storage, usageText(used, data), true, subPending || usagePending],
    [P.fields.plan, planText(data), false, subPending],
    [P.fields.payment, paymentText(data), false, subPending],
  ];
  const seats = seatsOf(tenant, data);
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
      {usage.error && !usage.row ? (
        <RetryAlert
          className="ox-orgs-error ox-org-alert"
          text={T.card.usageError}
          error={usage.error}
          onRetry={usage.refetch}
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
        {fields.map(([label, value, numeric, busy]) => (
          <div key={label} className="ox-org-field">
            <dt>{label}</dt>
            <dd data-numeric={numeric || undefined} data-loading={busy || undefined}>
              {busy ? <LoadingText /> : value}
            </dd>
          </div>
        ))}
      </dl>
      <Bar size={8} fill={storageFill(used, data)} />
      <div className="ox-org-seats-block">
        <div className="ox-org-seats-row">
          <span className="ox-org-seats-label">{P.fields.seats}</span>
          <span className="ox-org-seats" data-loading={subPending || undefined}>
            {subPending ? <LoadingText /> : seatsText(seats)}
          </span>
        </div>
        <Bar size={8} fill={seatsFill(subPending ? undefined : seats)} />
      </div>
      {request ? <RequestPlaque request={request} /> : null}
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
        {sub?.data && quota !== undefined ? (
          <QuotaPicker
            options={quotaOptions(used, data)}
            current={String(quota)}
            onApply={(gb) =>
              sub.data && onCommand({ kind: 'quota', tenant, etag: sub.data.etag, gb })
            }
          />
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

/**
 * Действие, которое сменяет выполненное: после «Ограничить…» — «Снять ограничение» и наоборот; после «Квоты
 * места» — её выбор («Применить» снова недоступна).
 */
const NEXT_ACTION: Readonly<Record<CommandKind, CommandKind>> = {
  extend: 'extend',
  suspend: 'resume',
  resume: 'suspend',
  quota: 'quota',
};

/**
 * Фокус после команды: модальное окно возвращает его на кнопку-триггер, а если её больше нет (действие сменилось)
 * или она стала недоступна — фокус на body. Тогда — на сменившее её действие карточки или первое действие (после
 * возврата фокуса окном: кадр анимации и задача).
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

/** Текст диалога команды: три команды W1.25 и «Квота места» (занятое место — из «Использования»). */
function specOf(p: Pending, usedBytes: number | undefined): CommandSpec {
  if (p.kind !== 'quota') return COMMANDS[p.kind](p.tenant.name);
  const gb = p.gb ?? 0;
  const used = usedBytes === undefined ? undefined : usedGb(usedBytes);
  return quotaCommand(
    p.tenant.name,
    num(gb),
    used === undefined ? T.dash : num(used),
    used !== undefined && gb < used,
  );
}

/**
 * Диалог команды с отправкой: живёт, пока открыт (ключ — команда и организация), и держит попытку
 * (Idempotency-Key, If-Match, тело квоты) до определённого исхода — useCommandSender.
 */
function PendingCommand({
  pending,
  etag,
  sub,
  usedBytes,
  onClose,
}: {
  pending: Pending;
  /** Текущий ETag ресурса команды (перечитанный после 409/412), иначе — ETag на момент открытия. */
  etag: string;
  /** Текущая подписка: из неё «Квота места» собирает тело (тариф, статус, даты, ручные права). */
  sub: Subscription | undefined;
  usedBytes: number | undefined;
  onClose: () => void;
}): ReactElement {
  const { kind, gb } = pending;
  const quotaFor = useMemo(
    () =>
      kind === 'quota' && sub && gb !== undefined
        ? (reason: string) => quotaUpdate(sub, gb, reason, Date.now())
        : undefined,
    [kind, sub, gb],
  );
  const send = useCommandSender(kind, pending.tenant.id, quotaFor);
  return (
    <CommandDialog
      spec={specOf(pending, usedBytes)}
      onClose={onClose}
      onConfirm={async (reason) => {
        await send(reason, etag);
        focusAfter(kind);
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
  const usage = useUsage();
  const requests = usePendingRequests();
  const selectedId = tenants.some((t) => t.id === search.org)
    ? (search.org as string)
    : tenants[0]?.id;
  const fresh = useTenant(selectedId);
  const listed = tenants.find((t) => t.id === selectedId);
  const selected = fresh.data?.data ?? listed;
  const retrySubs = () => {
    for (const s of subs.values()) if (s.error) s.refetch();
  };
  const usageOf = (id: string): UsageState => ({
    row: usage.data?.get(id),
    pending: usage.isPending,
  });
  /** ETag ресурса команды сейчас: подписки для продления и квоты, организации — для suspend/resume. */
  const currentEtag = (p: Pending): string =>
    (p.kind === 'extend' || p.kind === 'quota'
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
            usage={usageOf(t.id)}
            selected={t.id === selectedId}
            now={now}
            onSelect={() => select(t.id)}
          />
        ))}
      </div>
      {selected ? (
        <OrgCard
          key={selected.id}
          tenant={selected}
          fresh={{
            etag: fresh.data?.etag,
            error: fresh.isError ? fresh.error : null,
            refetch: () => void fresh.refetch(),
          }}
          sub={subs.get(selected.id)}
          usage={{
            ...usageOf(selected.id),
            error: usage.isError ? usage.error : null,
            refetch: () => void usage.refetch(),
          }}
          request={requests.data?.get(selected.id)}
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
          sub={subs.get(pending.tenant.id)?.data?.data}
          usedBytes={usage.data?.get(pending.tenant.id)?.storageUsedBytes}
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
