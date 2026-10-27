// W7.32 · Очередь «Обращений» (Обращения.dc.html listVM, О:32–155): шапка, панель «Обращение по звонку», навигация по
// направлениям и очередям (≥ 860 — колонка, < 860 — чипы), поиск и фильтры, таблица со сроками, «Низкие оценки».
import { format } from '@ortus/texts';
import { Icon, Skeleton } from '@ortus/ui';
import { problemText } from '../../shell/run.tsx';
import { QUEUES, SVC_CH, SVC_KIND, svcWhen } from '@ortus/domain/modules';
import { type ReactElement, useState } from 'react';

import { useOpenByDirection, useRatings, useRequests } from './api.ts';
import { useService } from './ctx.tsx';
import {
  callError,
  callHint,
  callTypes,
  canTake,
  channelInfo,
  channelLine,
  clientLine,
  type Direction,
  kindInfo,
  type QueueKey,
  queueSubtitle,
  ratingText,
  SLA_TONE,
  statusInfo,
  type Summary,
  typeName,
} from './model.ts';
import { SERVICE_TEXT as T } from './texts.ts';
import { Alert, Button, Chip, Field, Select, SlaBox } from './ui.tsx';

export interface ListNav {
  dir: string;
  queue: QueueKey;
  q: string;
  kind: string;
  channel: string;
}

const QUEUE_TONE = { warn: 'warn', danger: 'danger' } as const;

interface CallForm {
  directionId: string;
  typeId: string;
  clientName: string;
  phone: string;
  company: string;
  link: string;
  text: string;
}

function CallPanel(p: { initialDir: string; onClose: () => void }): ReactElement {
  const x = useService();
  const firstType = (dir: string): string => callTypes(x.types, dir)[0]?.id ?? '';
  const [f, setF] = useState<CallForm>(() => ({
    directionId: p.initialDir,
    typeId: firstType(p.initialDir),
    clientName: '',
    phone: '',
    company: '',
    link: '',
    text: '',
  }));
  const set = (k: keyof CallForm, v: string): void => {
    x.clearErr();
    setF((cur) => ({
      ...cur,
      [k]: v,
      ...(k === 'directionId' ? { typeId: firstType(v) } : {}),
    }));
  };
  const types = callTypes(x.types, f.directionId);
  const type = types.find((t) => t.id === f.typeId);
  const C = T.call;
  const save = async (): Promise<void> => {
    const bad = callError(f);
    if (bad) {
      x.fail('call', bad);
      return;
    }
    const created = await x.run(
      'call',
      'call',
      (key) =>
        x.cmd.createRequest(
          {
            directionId: f.directionId,
            typeId: f.typeId,
            clientName: f.clientName,
            phone: f.phone,
            text: f.text,
            ...(f.company.trim() ? { company: f.company.trim() } : {}),
            ...(f.link.trim() ? { link: { label: f.link.trim() } } : {}),
          },
          key,
        ),
      C.done,
    );
    if (created) {
      p.onClose();
      x.open(created.id);
    }
  };
  return (
    <section className="ox-sv-panel ox-sv-call" aria-label={C.title}>
      <div className="ox-sv-panel-head">
        <h2>{C.title}</h2>
        <button type="button" className="ox-sv-x" aria-label={C.close} onClick={p.onClose}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="ox-sv-call-grid">
        <Field label={C.direction}>
          <Select
            label={C.direction}
            value={f.directionId}
            onChange={(v) => set('directionId', v)}
            options={x.directions.map((d) => ({ value: d.id, label: `${d.key} · ${d.name}` }))}
          />
        </Field>
        <Field label={C.kind}>
          <Select
            label={C.kind}
            value={f.typeId}
            onChange={(v) => set('typeId', v)}
            options={types.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Field>
        <Field label={C.client}>
          <input
            className="ox-sv-input"
            value={f.clientName}
            placeholder={C.clientPh}
            onChange={(e) => set('clientName', e.target.value)}
          />
        </Field>
        <Field label={C.phone}>
          <input
            className="ox-sv-input"
            inputMode="tel"
            value={f.phone}
            placeholder={C.phonePh}
            onChange={(e) => set('phone', e.target.value)}
          />
        </Field>
        <Field label={C.company}>
          <input
            className="ox-sv-input"
            value={f.company}
            placeholder={C.companyPh}
            onChange={(e) => set('company', e.target.value)}
          />
        </Field>
        <Field label={C.link}>
          <input
            className="ox-sv-input"
            value={f.link}
            placeholder={C.linkPh}
            onChange={(e) => set('link', e.target.value)}
          />
        </Field>
      </div>
      <Field label={C.text}>
        <textarea
          className="ox-sv-input ox-sv-area"
          rows={3}
          value={f.text}
          placeholder={C.textPh}
          onChange={(e) => set('text', e.target.value)}
        />
      </Field>
      <div className="ox-sv-actions">
        <span className="ox-sv-hint">{callHint(type, x.dirOf(f.directionId))}</span>
        <span className="ox-sv-grow" />
        {x.err?.scope === 'call' ? <Alert>{x.err.text}</Alert> : null}
        <Button onClick={p.onClose}>{C.cancel}</Button>
        <Button variant="primary" disabled={x.busy || x.offline} onClick={() => void save()}>
          {C.save}
        </Button>
      </div>
    </section>
  );
}

function Nav(p: {
  nav: ListNav;
  wide: boolean;
  setNav: (n: Partial<ListNav>) => void;
  dirCounts: Record<string, number>;
  counts: Record<string, { count: number; tone?: 'warn' | 'danger' }>;
}): ReactElement {
  const x = useService();
  const total = Object.values(p.dirCounts).reduce((a, b) => a + b, 0);
  const dirs: { id: string; name: string; color: string | null; n: number }[] = [
    { id: 'all', name: T.list.allMine, color: null, n: total },
    ...x.directions.map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color,
      n: p.dirCounts[d.id] ?? 0,
    })),
  ];
  const queues = QUEUES.map((q) => {
    const c = p.counts[q.key];
    const n = c?.count ?? 0;
    return { ...q, n, tone: n > 0 && c?.tone ? QUEUE_TONE[c.tone] : undefined };
  });
  if (!p.wide) {
    return (
      <div className="ox-sv-chips">
        <div className="ox-sv-chiprow" role="group" aria-label={T.list.navDirections}>
          {dirs.map((d) => (
            <button
              key={d.id}
              type="button"
              className="ox-sv-pill"
              aria-pressed={p.nav.dir === d.id}
              onClick={() => p.setNav({ dir: d.id })}
            >
              <span className="ox-sv-dot" style={d.color ? { background: d.color } : undefined} />
              {d.name} · {d.n}
            </button>
          ))}
        </div>
        <div className="ox-sv-chiprow" role="group" aria-label={T.list.navQueues}>
          {queues.map((q) => (
            <button
              key={q.key}
              type="button"
              className="ox-sv-pill"
              data-tone={q.tone}
              aria-pressed={p.nav.queue === q.key}
              onClick={() => p.setNav({ queue: q.key })}
            >
              <Icon name={q.icon} size={16} />
              {q.label} · {q.n}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <nav className="ox-sv-nav" aria-label={T.list.navAria}>
      <div className="ox-sv-navgroup">
        <span className="ox-sv-navtitle">{T.list.navDirections}</span>
        {dirs.map((d) => (
          <button
            key={d.id}
            type="button"
            className="ox-sv-navitem"
            aria-pressed={p.nav.dir === d.id}
            onClick={() => p.setNav({ dir: d.id })}
          >
            {d.id === 'all' ? (
              <Icon name="inbox" size={18} />
            ) : (
              <span className="ox-sv-sq" style={{ background: d.color ?? undefined }} />
            )}
            <span className="ox-sv-navname">{d.name}</span>
            <span className="ox-sv-navn">{d.n}</span>
          </button>
        ))}
      </div>
      <div className="ox-sv-navgroup">
        <span className="ox-sv-navtitle">{T.list.navQueues}</span>
        {queues.map((q) => (
          <button
            key={q.key}
            type="button"
            className="ox-sv-navitem"
            data-tone={q.tone}
            aria-pressed={p.nav.queue === q.key}
            onClick={() => p.setNav({ queue: q.key })}
          >
            <Icon name={q.icon} size={18} />
            <span className="ox-sv-navname">{q.label}</span>
            <span className="ox-sv-navbadge">{q.n}</span>
          </button>
        ))}
      </div>
      <span className="ox-sv-navnote">{T.list.navNote}</span>
    </nav>
  );
}

function Row(p: { r: Summary; types: ReturnType<typeof useService>['types'] }): ReactElement {
  const x = useService();
  const { r } = p;
  const d = x.dirOf(r.directionId);
  const k = kindInfo(r.kind);
  const st = statusInfo(r.status);
  const sla = SLA_TONE[r.head.state];
  const ch = channelInfo(r.channel);
  const rt = x.rightsOf(r.directionId);
  const take = canTake(r, rt);
  return (
    <div
      className="ox-sv-row"
      data-late={r.head.state === 'late' ? 'true' : undefined}
      onClick={() => x.open(r.id)}
    >
      <button
        type="button"
        className="ox-sv-key"
        style={{ color: d?.color }}
        onClick={(e) => {
          e.stopPropagation();
          x.open(r.id);
        }}
      >
        {r.key}
      </button>
      <span className="ox-sv-cell">
        <span className="ox-sv-sub">
          <Icon name={k.icon} size={15} />
          {typeName(p.types, r.directionId, r.kind)}
        </span>
        <strong className="ox-sv-title">{r.title}</strong>
        <span className="ox-sv-sub">{clientLine(r.client)}</span>
      </span>
      <span className="ox-sv-cell">
        <span className="ox-sv-obj">{r.link ? r.link.label : T.list.noLink}</span>
        <span className="ox-sv-sub">
          <Icon name={ch.icon} size={15} />
          {channelLine(r)}
        </span>
      </span>
      <span className="ox-sv-cell ox-sv-who">
        <span data-empty={r.assignee ? undefined : 'true'}>
          {r.assignee?.displayName ?? T.list.unassigned}
        </span>
        {take ? (
          <button
            type="button"
            className="ox-sv-take"
            disabled={x.busy || x.offline}
            onClick={(e) => {
              e.stopPropagation();
              const me = rt.me;
              if (!me) return;
              void x.run(
                `take:${r.id}`,
                'page',
                async (key) =>
                  x.cmd.patch(r.id, await x.cmd.revisionOf(r.id), { assigneeId: me.memberId }, key),
                format(T.list.taken, { key: r.key }),
              );
            }}
          >
            {T.list.take}
          </button>
        ) : null}
      </span>
      <Chip label={st.label} tone={st.tone} icon={st.icon} />
      <SlaBox tone={sla.tone} icon={sla.icon} label={r.head.label} text={r.head.text} />
    </div>
  );
}

export function ListView(p: {
  nav: ListNav;
  wide: boolean;
  setNav: (n: Partial<ListNav>) => void;
}): ReactElement {
  const x = useService();
  const { nav } = p;
  const [callOpen, setCallOpen] = useState(false);
  const directionId = nav.dir === 'all' ? undefined : nav.dir;
  const requests = useRequests(
    x.tenantId,
    { directionId, queue: nav.queue, kind: nav.kind, channel: nav.channel, q: nav.q },
    nav.queue !== 'low',
  );
  const ratings = useRatings(x.tenantId, nav.queue === 'low');
  const countsQ = useRequests(
    x.tenantId,
    { directionId, queue: 'open', kind: '', channel: '', q: '' },
    nav.queue === 'low',
  );
  const openBy = useOpenByDirection(x.tenantId, true);
  const counts: Record<string, { count: number; tone?: 'warn' | 'danger' }> = {};
  for (const c of (requests.data ?? countsQ.data)?.counts.items ?? []) {
    counts[c.key] = { count: c.count, ...(c.tone ? { tone: c.tone } : {}) };
  }
  const queue = QUEUES.find((q) => q.key === nav.queue) ?? QUEUES[0];
  const rows = requests.data?.items ?? [];
  const lows = (ratings.data ?? []).filter((r) => !directionId || r.directionId === directionId);
  const kinds = [...new Set(x.types.map((t) => t.kind))];
  const dirName = directionId ? (x.dirOf(directionId)?.name ?? null) : null;
  const dirIdForCall = (): string => {
    const cur = directionId && x.dirOf(directionId) ? directionId : x.directions[0]?.id;
    return (x.directions.find((d: Direction) => d.id === cur) ?? x.directions[0])?.id ?? '';
  };
  const loading = nav.queue === 'low' ? ratings.isPending : requests.isPending;
  const failed = nav.queue === 'low' ? ratings.isError : requests.isError;
  return (
    <>
      <div className="ox-sv-head">
        <h1 id="h-service" tabIndex={-1}>
          {T.title}
        </h1>
        <span className="ox-sv-subtitle">{queueSubtitle(dirName, queue?.label ?? '')}</span>
        <span className="ox-sv-grow" />
        {x.canCreate ? (
          <Button
            icon="call"
            disabled={x.offline}
            onClick={() => {
              x.clearErr();
              setCallOpen(true);
            }}
          >
            {T.list.callButton}
          </Button>
        ) : null}
      </div>
      {x.err?.scope === 'page' ? <Alert onClose={x.clearErr}>{x.err.text}</Alert> : null}
      {callOpen ? (
        <CallPanel initialDir={dirIdForCall()} onClose={() => setCallOpen(false)} />
      ) : null}
      <div className="ox-sv-body">
        <Nav
          nav={nav}
          wide={p.wide}
          setNav={p.setNav}
          dirCounts={openBy.data ?? {}}
          counts={counts}
        />
        <div className="ox-sv-main">
          <div className="ox-sv-filters">
            <label className="ox-sv-search">
              <Icon name="search" size={18} />
              <input
                aria-label={T.list.search}
                placeholder={T.list.searchPlaceholder}
                value={nav.q}
                onChange={(e) => p.setNav({ q: e.target.value })}
              />
            </label>
            <Select
              label={T.list.typeFilter}
              value={nav.kind}
              onChange={(v) => p.setNav({ kind: v })}
              options={[
                { value: '', label: T.list.allTypes },
                ...kinds.map((k) => ({ value: k, label: SVC_KIND[k].label })),
              ]}
            />
            <Select
              label={T.list.channelFilter}
              value={nav.channel}
              onChange={(v) => p.setNav({ channel: v })}
              options={[
                { value: '', label: T.list.allChannels },
                ...Object.entries(SVC_CH).map(([k, v]) => ({ value: k, label: v[0] })),
              ]}
            />
          </div>
          {loading ? <Skeleton lines={4} label={T.loading} /> : null}
          {failed ? (
            <Alert>
              {format(T.loadFailed, {
                error: problemText(nav.queue === 'low' ? ratings.error : requests.error),
              })}
            </Alert>
          ) : null}
          {nav.queue === 'low' && !loading ? (
            <div className="ox-sv-ratings">
              <span className="ox-sv-hint">{T.ratings.hint}</span>
              {lows.map((r) => {
                const d = x.dirOf(r.directionId);
                const rt = x.rightsOf(r.directionId);
                return (
                  <div key={r.id} className="ox-sv-rating">
                    <span className="ox-sv-score">{r.score}</span>
                    <span className="ox-sv-ratingmain">
                      <span className="ox-sv-ratinghead">
                        <span className="ox-sv-key" style={{ color: d?.color }}>
                          {d?.key}
                        </span>
                        <strong>{r.clientName}</strong>
                        <span className="ox-sv-sub">
                          {r.work} · {svcWhen(Date.parse(r.at), x.now)}
                        </span>
                      </span>
                      <span>{ratingText(r)}</span>
                    </span>
                    <span className="ox-sv-ratingbtns">
                      {rt.reply ? (
                        <Button
                          disabled={x.busy || x.offline}
                          onClick={() =>
                            void x.run(
                              `rt:${r.id}:seen`,
                              'page',
                              (key) => x.cmd.decideRating(r.id, 'seen', key),
                              T.ratings.seenDone,
                            )
                          }
                        >
                          {T.ratings.seen}
                        </Button>
                      ) : null}
                      {rt.create ? (
                        <Button
                          variant="primary"
                          disabled={x.busy || x.offline}
                          onClick={() =>
                            void x
                              .run(
                                `rt:${r.id}:complaint`,
                                'page',
                                (key) => x.cmd.decideRating(r.id, 'complaint', key),
                                T.ratings.complaintDone,
                              )
                              .then((res) => {
                                if (res?.request) x.open(res.request.id);
                              })
                          }
                        >
                          {T.ratings.complaint}
                        </Button>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {nav.queue !== 'low' && !loading && !failed ? (
            <div className="ox-sv-tablewrap">
              <div className="ox-sv-table">
                <div className="ox-sv-row ox-sv-thead">
                  {T.list.cols.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                {rows.map((r) => (
                  <Row key={r.id} r={r} types={x.types} />
                ))}
                {rows.length === 0 ? <div className="ox-sv-empty">{T.list.empty}</div> : null}
              </div>
            </div>
          ) : null}
          <span className="ox-sv-hint">{T.list.note}</span>
        </div>
      </div>
    </>
  );
}
