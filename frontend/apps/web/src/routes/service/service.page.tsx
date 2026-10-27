// W7.32 · Страница «Обращения» (`service`, `/t/:tenantId/service`; эталон design-2026-10-19 «Обращения.dc.html», разбор
// docs/plan/v2/analysis/dor/service.md §1.1): очередь с навигацией, «Низкие оценки», «Обращение по звонку», карточка.
// Данные — контракт 0.12.0-stage7 (тег Service); права кнопок — по команде направления и ключам роли (PD-53), сервер
// проверяет с объектом-направлением; нет связи — кнопки заблокированы. Диплинк `?open=<id обращения>` (CRM:2858).
import { ProblemError } from '@ortus/api-client';
import { format } from '@ortus/texts';
import { Banner, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { useApi } from '../../app/api.tsx';
import { useCan, useShell } from '../../shell/context.tsx';
import { problemText } from '../../shell/run.tsx';
import { useToast } from '../../shell/toast.tsx';
import { afterChange, commands, useDirections } from './api.ts';
import { CardView } from './card.tsx';
import { type ErrScope, type ServiceCtx, ServiceContext } from './ctx.tsx';
import { ListView, type ListNav } from './list.tsx';
import { rightsIn, SERVICE_KEYS } from './model.ts';
import { SERVICE_TEXT as T } from './texts.ts';
import { Note } from './ui.tsx';
import './service.css';

const INLINE_CODES = new Set([
  'validation_failed',
  'invalid_transition',
  'forbidden_action',
  'service_assignee_out_of_scope',
  'revision_mismatch',
  'not_found',
]);

/** Текст ошибки команды: сообщение сервера для отказов «Обращений», иначе текст оболочки по коду. */
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

const WIDE_AT = 860;

/** Ширина контейнера страницы (ResizeObserver, О:335): ≥ 860 — боковая навигация, < 860 — чипы. */
function useWide(): [(el: HTMLElement | null) => void, boolean] {
  const [cw, setCw] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro.current = new ResizeObserver((es) => {
        const w = Math.round(es[0]?.contentRect.width ?? 0);
        setCw((cur) => (Math.abs(w - cur) > 8 ? w : cur));
      });
      ro.current.observe(el);
    }
  }, []);
  return [ref, !cw || cw >= WIDE_AT];
}

const HEAD = (
  <div className="ox-sv-head">
    <h1 id="h-service" tabIndex={-1}>
      {T.title}
    </h1>
  </div>
);

export default function ServicePage(): ReactElement {
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
  const [rootRef, wide] = useWide();

  const directions = useDirections(tenantId);
  const [nav, setNav] = useState<ListNav>({
    dir: 'all',
    queue: 'open',
    q: '',
    kind: '',
    channel: '',
  });
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ServiceCtx['err']>(null);
  const [keys] = useState(() => new Map<string, string>());
  const [seenOpen, setSeenOpen] = useState('');
  const [now] = useState(() => Date.now());

  const rawOpen = (location.search as Record<string, unknown>).open;
  const open = typeof rawOpen === 'string' ? rawOpen : '';
  if (open && seenOpen !== open) {
    setSeenOpen(open);
    setSel(open);
  }
  useEffect(() => {
    if (!open) return;
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'service' },
      search: {} as never,
      replace: true,
    });
  }, [open, navigate, tenantId]);

  const cmd = useMemo(() => commands(api, tenantId), [api, tenantId]);
  const keyFor = useCallback(
    (sig: string): string => {
      const k = keys.get(sig) ?? crypto.randomUUID();
      keys.set(sig, k);
      return k;
    },
    [keys],
  );

  const run = useCallback<ServiceCtx['run']>(
    async (sig, scope: ErrScope, fn, ok) => {
      setBusy(true);
      setErr(null);
      try {
        const r = await fn(keyFor(sig));
        keys.delete(sig);
        await afterChange(qc, tenantId);
        const text = typeof ok === 'function' ? ok(r) : ok;
        if (text) toast(text, 'ok');
        return r;
      } catch (e) {
        setErr({ scope, text: errText(e) });
        void afterChange(qc, tenantId);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [qc, tenantId, toast, keyFor, keys],
  );

  const list = directions.data?.items;
  const ctx: ServiceCtx = useMemo(() => {
    const dirs = list ?? [];
    const membershipId = sh.tenant?.membershipId ?? '';
    const meName = sh.me.displayName;
    const keysKnown = can(...SERVICE_KEYS);
    const isMe = (m: { memberId: string; displayName: string }): boolean =>
      m.memberId === membershipId || m.displayName === meName;
    return {
      tenantId,
      directions: dirs,
      types: directions.data?.types ?? [],
      dirOf: (id) => dirs.find((d) => d.id === id),
      rightsOf: (id) =>
        rightsIn(
          dirs.find((d) => d.id === id),
          { owner, isMe, can, keysKnown },
        ),
      canCreate: owner || can('service.requests.create'),
      cmd,
      busy,
      offline,
      now,
      err,
      clearErr: () => setErr(null),
      fail: (scope, text) => setErr({ scope, text }),
      run,
      toast: (text) => toast(text, 'ok'),
      open: (id) => {
        setErr(null);
        setSel(id);
      },
      close: () => {
        setErr(null);
        setSel(null);
      },
    };
    // `can` пересоздаётся на каждый рендер оболочки; права читаются из `sh.nav`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tenantId,
    list,
    directions.data?.types,
    owner,
    sh.nav,
    sh.tenant?.membershipId,
    sh.me.displayName,
    cmd,
    busy,
    offline,
    now,
    err,
    run,
    toast,
  ]);

  if (directions.isPending) {
    return (
      <section aria-labelledby="h-service" className="ox-sv">
        {HEAD}
        <Skeleton lines={5} label={T.loading} />
      </section>
    );
  }
  if (directions.isError) {
    const denied =
      directions.error instanceof ProblemError &&
      (directions.error.code === 'forbidden_action' || directions.error.code === 'forbidden');
    if (denied) {
      return (
        <section aria-labelledby="h-service" className="ox-sv">
          {HEAD}
          <div className="ox-sv-gate">
            <span className="ox-sv-gatebadge">
              <Icon name="lock" size={15} />
              {T.gate.badge}
            </span>
            <h2>{T.gate.title}</h2>
            <span className="ox-sv-gatetext">{T.gate.text}</span>
          </div>
        </section>
      );
    }
    return (
      <section aria-labelledby="h-service" className="ox-sv">
        {HEAD}
        <Banner
          tone="danger"
          role="alert"
          title={format(T.loadFailed, { error: problemText(directions.error) })}
          action={{ label: T.retry, onPress: () => void directions.refetch() }}
        />
      </section>
    );
  }
  if (directions.data.notConfigured || directions.data.items.length === 0) {
    return (
      <section aria-labelledby="h-service" className="ox-sv">
        {HEAD}
        <div className="ox-sv-gate">
          <h2>{T.gate.notConfiguredTitle}</h2>
          <span className="ox-sv-gatetext">{T.gate.notConfiguredText}</span>
        </div>
      </section>
    );
  }

  return (
    <ServiceContext value={ctx}>
      <section aria-labelledby="h-service" className="ox-sv" ref={rootRef}>
        {offline ? (
          <Note tone="warn" icon="cloud_off">
            {T.offline}
          </Note>
        ) : null}
        {sel ? (
          <CardView key={sel} requestId={sel} />
        ) : (
          <ListView nav={nav} wide={wide} setNav={(n) => setNav((cur) => ({ ...cur, ...n }))} />
        )}
      </section>
    </ServiceContext>
  );
}
