// W7.26 · Блок «Маршрут документа» (ключ `docs-route`; эталон design-2026-10-19 «Документы.dc.html» полоса маршрута
// :145–189, routeBarVM :970–1005). Встраивается в карточку документа (W7.25): `DocRoutePanel` сам читает документ и
// маршрут, показывает шаги, «Сейчас», возврат, моё решение, ознакомление (компьютер и телефон), действия автора и
// «Лист согласования»; «На согласование» и «Утвердить · ПЭП» — диалоги этого блока. Кнопки решения — по `my.wait`
// сервера, права автора — по запустившему и `my.can.manage`; отказ (403) сервер выдаёт текстом «Сейчас решение ждут: …».
import { type components, ProblemError } from '@ortus/api-client';
import { Banner, Button, Icon, Skeleton } from '@ortus/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useEffect, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { LoadFailed } from '../../company/modules/ui.tsx';
import {
  ackDocument,
  cancelRoute,
  closeAck,
  decideRoute,
  idemKeys,
  resumeRoute,
  useRoute,
  useSendLookups,
  useRouteDoc,
} from './api.ts';
import { DIALOG_CODES, useCommand } from './cmd.ts';
import {
  ackDoneText,
  ackRecord,
  authorActions,
  backText,
  barTitle,
  ddmm,
  isAuthor,
  meMemberId,
  myAction,
  nowText,
  resumeState,
  sheetRows,
  stepView,
} from './model.ts';
import { SendDialog } from './send.tsx';
import { SignDialog } from './sign.tsx';
import { ROUTE_TEXT as T } from './texts.ts';
import '../../company/modules/modules.css';
import './route.css';

type S = components['schemas'];

const PHONE = '(max-width: 639.98px)';

function usePhone(): boolean {
  const [on, setOn] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const sync = (): void => setOn(mq.matches);
    mq.addEventListener('change', sync);
    sync();
    return () => mq.removeEventListener('change', sync);
  }, []);
  return on;
}

function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const sync = (): void => setOn(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  return on;
}

/** «Дочитал до конца»: прокрутка области страницы дошла до низа (нет прокрутки — дочитано). */
function useReadToEnd(enabled: boolean): boolean {
  const [end, setEnd] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const check = (): void => {
      const main = document.querySelector('#ox-main');
      const el =
        main && main.scrollHeight > main.clientHeight + 1 ? main : document.scrollingElement;
      if (!el) return;
      const reached = el.scrollTop + el.clientHeight >= el.scrollHeight - 32;
      if (reached) setEnd(true);
    };
    check();
    document.addEventListener('scroll', check, true);
    window.addEventListener('resize', check);
    return () => {
      document.removeEventListener('scroll', check, true);
      window.removeEventListener('resize', check);
    };
  }, [enabled]);
  return end;
}

export interface DocRoutePanelProps {
  tenantId: string;
  docId: string;
  /** Прочитан ли документ до конца (телефон): без него панель следит за прокруткой страницы. */
  readEnd?: boolean;
  /** Открыть PDF/A-копию (карточка документа W7.25 знает её адрес). */
  onOpenPdfa?: () => void;
}

export function DocRoutePanel(p: DocRoutePanelProps): ReactElement {
  const { tenantId, docId } = p;
  const api = useApi();
  const { tenant, me: user } = useShell();
  const navigate = useNavigate();
  const doc = useRouteDoc(tenantId, docId);
  const rq = useRoute(tenantId, docId);
  const lookups = useSendLookups(tenantId, doc.data?.my.can.route === true);
  const cmd = useCommand(tenantId);
  const [keys] = useState(idemKeys);
  const phone = usePhone();
  const online = useOnline();
  const scrolled = useReadToEnd(phone);
  const readEnd = p.readEnd ?? scrolled;
  const [comment, setComment] = useState('');
  const [local, setLocal] = useState<string | undefined>();
  const [dialog, setDialog] = useState<'send' | 'sign' | null>(null);

  if (doc.isPending || rq.isPending) {
    return (
      <section className="ox-rt" aria-label={T.region} aria-busy="true">
        <Skeleton lines={2} label={T.state.loading} />
      </section>
    );
  }
  const failure = doc.error ?? rq.error;
  if (failure || !doc.data) {
    const status = failure instanceof ProblemError ? failure.status : 0;
    const retry = (): void => void Promise.all([doc.refetch(), rq.refetch()]);
    return (
      <section className="ox-rt" aria-label={T.region}>
        {status === 403 || status === 404 ? (
          <p className="ox-rt-empty">{T.err.loadFailed}</p>
        ) : (
          <LoadFailed error={failure} onRetry={retry} />
        )}
      </section>
    );
  }

  const d = doc.data;
  const found = rq.data ?? null;
  const route = found && found.status !== 'cancelled' ? found : null;
  const me = meMemberId(route, d, tenant?.membershipId ?? '', user.displayName);
  const author = route ? isAuthor(route, me, d.my.can.manage) : false;
  const action = route ? myAction(d.my.wait, route) : null;
  const canSend = d.my.can.route && (!route || route.status === 'done');
  const off = !online;

  const c = (op: string, body?: unknown) => ({
    api,
    tenantId,
    docId,
    key: keys.key({ op, body }),
  });
  const done = (op: string, body?: unknown): void => keys.settle({ op, body });

  const approve = async (): Promise<void> => {
    setLocal(undefined);
    const body: S['DocRouteDecide'] = {
      decision: 'approve',
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
    if (
      await cmd.exec(
        'docs.route.approve',
        () => decideRoute(c('approve', body), body),
        T.decision.approved,
        DIALOG_CODES,
      )
    ) {
      done('approve', body);
      setComment('');
    }
  };
  const giveBack = async (): Promise<void> => {
    if (route?.rules.commentOnBack && !comment.trim()) {
      setLocal(T.decision.needComment);
      return;
    }
    setLocal(undefined);
    const body: S['DocRouteDecide'] = {
      decision: 'return',
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
    if (
      await cmd.exec(
        'docs.route.return',
        () => decideRoute(c('return', body), body),
        T.decision.returned,
        DIALOG_CODES,
      )
    ) {
      done('return', body);
      setComment('');
    }
  };
  const ack = async (): Promise<void> => {
    const body: S['DocAck'] = { device: phone ? T.ack.devicePhone : T.ack.deviceDesktop };
    if (
      await cmd.exec(
        'docs.ack',
        () => ackDocument(c('ack', body), body),
        T.ack.marked,
        DIALOG_CODES,
      )
    ) {
      done('ack', body);
    }
  };
  const act = async (id: 'closeAck' | 'cancel'): Promise<void> => {
    if (id === 'closeAck') {
      await cmd.exec(
        'docs.ack.close',
        () => closeAck(c('close')),
        T.actions.ackClosed,
        DIALOG_CODES,
      );
    } else {
      await cmd.exec(
        'docs.route.cancel',
        () => cancelRoute(c('cancel')),
        T.actions.cancelled,
        DIALOG_CODES,
      );
    }
  };
  const resume = async (): Promise<void> => {
    await cmd.exec(
      'docs.route.resume',
      () => resumeRoute(c('resume')),
      T.resume.done,
      DIALOG_CODES,
    );
  };

  const sendButton = canSend ? (
    <Button
      variant={route ? 'secondary' : 'primary'}
      icon="send"
      disabled={off || !lookups.ready}
      onPress={() => setDialog('send')}
    >
      {T.send.open}
    </Button>
  ) : null;

  let body: ReactElement;
  if (!route) {
    body = (
      <div className="ox-rt-empty">
        <span className="ox-rt-empty-text">
          {T.empty.none} {canSend ? T.empty.noneHint : ''}
        </span>
        {sendButton}
      </div>
    );
  } else {
    const rec = ackRecord(route, me);
    const now = nowText(route);
    const acts = authorActions(route, author);
    const resumeSt = resumeState(d.version, route);
    const showSheet =
      route.status === 'done' ||
      route.steps.some((s) => (s.kind === 'sign' || s.kind === 'external') && s.status === 'done');
    const rows = showSheet ? sheetRows(route) : [];
    const sha = d.file?.sha256;
    body = (
      <>
        <div className="ox-rt-head">
          <h2 className="ox-rt-title">{barTitle(route)}</h2>
          <ol className="ox-rt-steps" aria-label={barTitle(route)}>
            {route.steps.map((_, i) => {
              const v = stepView(route, i);
              return (
                <li key={i} className="ox-rt-step-wrap">
                  <span className="ox-rt-step" data-state={v.state}>
                    <span className="ox-rt-step-ic">
                      <Icon name={v.icon} size={18} />
                    </span>
                    <strong className="ox-rt-step-name">{`${v.n} · ${v.name}`}</strong>
                    <span className="ox-rt-step-sub">{v.sub}</span>
                  </span>
                  {i < route.steps.length - 1 ? (
                    <span className="ox-rt-arrow" aria-hidden="true">
                      <Icon name="arrow_forward" size={16} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <span className="ox-rt-grow" />
          {route.task ? (
            <button
              type="button"
              className="ox-rt-link"
              onClick={() =>
                void navigate({ to: '/t/$tenantId/$page', params: { tenantId, page: 'tasks' } })
              }
            >
              <Icon name="view_kanban" size={18} />
              {`${T.task} ${T.taskIn}`}
            </button>
          ) : null}
        </div>

        {now ? <p className="ox-rt-now">{now}</p> : null}

        {route.status === 'returned' ? (
          <div className="ox-rt-back" role="status">
            <Icon name="undo" size={18} />
            <span className="ox-rt-back-text">{backText(route, author)}</span>
            {author ? (
              <Button
                size="compact"
                disabled={resumeSt.disabled || off || Boolean(cmd.busy)}
                disabledReason={resumeSt.disabled ? resumeSt.hint : undefined}
                onPress={() => void resume()}
              >
                {resumeSt.label}
              </Button>
            ) : null}
          </div>
        ) : null}

        {action === 'approve' || action === 'sign' ? (
          <div className="ox-rt-decide">
            <div className="ox-rt-comment-wrap">
              <textarea
                className="ox-rt-comment"
                rows={1}
                value={comment}
                aria-label={T.decision.commentAria}
                placeholder={
                  route.rules.commentOnBack ? T.decision.commentRequired : T.decision.comment
                }
                aria-invalid={local ? true : undefined}
                aria-describedby={local ? 'ox-rt-local-err' : undefined}
                onChange={(e) => {
                  setComment(e.target.value);
                  setLocal(undefined);
                }}
              />
              {local ? (
                <p id="ox-rt-local-err" role="alert" className="ox-rt-err">
                  {local}
                </p>
              ) : null}
            </div>
            {action === 'approve' ? (
              <Button
                icon="how_to_reg"
                disabled={off || Boolean(cmd.busy)}
                onPress={() => void approve()}
              >
                {`${T.decision.approve} v${route.version}`}
              </Button>
            ) : (
              <Button icon="signature" disabled={off || Boolean(cmd.busy)} onPress={() => setDialog('sign')}>
                {T.decision.sign}
              </Button>
            )}
            <Button
              variant="secondary"
              icon="undo"
              disabled={off || Boolean(cmd.busy)}
              onPress={() => void giveBack()}
            >
              {T.decision.back}
            </Button>
          </div>
        ) : null}

        {action === 'ack' && !phone ? (
          <div className="ox-rt-ack">
            <Button
              icon="task_alt"
              disabled={off || Boolean(cmd.busy)}
              onPress={() => void ack()}
            >
              {T.ack.button}
            </Button>
            <span className="ox-rt-note">
              {`${T.ack.note1} v${route.version}${T.ack.note2} ${ddmm(route.steps[route.currentStep]?.due)}.`}
            </span>
          </div>
        ) : null}

        {rec && action !== 'ack' ? (
          <span className="ox-rt-done">
            <Icon name="check_circle" size={18} />
            {ackDoneText(rec, route.version)}
          </span>
        ) : null}

        {cmd.error ? (
          <p role="alert" className="ox-rt-err">
            {cmd.error}
          </p>
        ) : null}

        {off ? <Banner tone="warn" title={T.state.offline} icon="cloud_off" /> : null}

        {acts.length || sendButton ? (
          <div className="ox-rt-acts">
            {acts.map((a) => (
              <Button
                key={a.id}
                variant={a.id === 'cancel' ? 'danger' : 'secondary'}
                size="compact"
                icon={a.id === 'cancel' ? 'cancel' : 'done_all'}
                disabled={off || Boolean(cmd.busy)}
                onPress={() => void act(a.id)}
              >
                {a.label}
              </Button>
            ))}
            {sendButton}
          </div>
        ) : null}

        {showSheet ? (
          <details className="ox-rt-sheet">
            <summary>
              <Icon name="fact_check" size={18} />
              {`${T.sheet.title} · v${route.version}`}
            </summary>
            {rows.map((r, i) => (
              <div key={i} className="ox-rt-sheet-row">
                <span>{r.step}</span>
                <span>{`${r.who} · ${r.result}`}</span>
                <span>{r.at}</span>
              </div>
            ))}
            <div className="ox-rt-sheet-foot">
              <span className="ox-rt-sha">{`v${route.version}${sha ? ` · ${T.sheet.sha} ${sha}` : ''}`}</span>
              <span className="ox-rt-grow" />
              {d.pdfaCopy && p.onOpenPdfa ? (
                <button type="button" className="ox-rt-link" onClick={p.onOpenPdfa}>
                  {T.sheet.pdfa}
                </button>
              ) : null}
            </div>
          </details>
        ) : null}

        {action === 'ack' && phone ? (
          <div className="ox-rt-sticky" role="group" aria-label={T.ack.bar}>
            <span className="ox-rt-sticky-read" data-on={readEnd ? 'true' : 'false'}>
              <Icon name={readEnd ? 'check_circle' : 'swipe_up'} size={18} />
              {readEnd ? T.ack.readEnd : T.ack.readMore}
            </span>
            <button
              type="button"
              className="ox-rt-sticky-btn"
              disabled={!readEnd || off || cmd.busy === 'docs.ack'}
              onClick={() => void ack()}
            >
              {T.ack.button}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <section className="ox-rt" aria-label={T.region}>
        {body}
      </section>
      {dialog === 'send' ? (
        <SendDialog tenantId={tenantId} doc={d} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'sign' && route ? (
        <SignDialog tenantId={tenantId} doc={d} route={route} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}
