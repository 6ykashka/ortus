// W7.32 · Карточка обращения (Обращения.dc.html cardVM, О:157–327): шапка, действия по статусу, панели «Итог решения» и
// «Перенести в другое направление», сроки, лента, поле ответа и заметка, боковая колонка (исполнитель, приоритет, клиент,
// связано, «Кто видит», задачи, «После решения»). Панели — встроенные, не диалоги.
import { format } from '@ortus/texts';
import { Icon, Skeleton } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { useRequest, useTemplates } from './api.ts';
import { useService } from './ctx.tsx';
import {
  afterText,
  cardActions,
  cardMeta,
  COMPENSATION_OPTIONS,
  compensationKind,
  directionText,
  feedItem,
  fillReply,
  isAbout,
  isOpen,
  kindInfo,
  outcomesOf,
  taskError,
  PRIORITIES,
  type Request,
  sendNote,
  SLA_TONE,
  statusInfo,
  typeName,
} from './model.ts';
import { SERVICE_TEXT as T } from './texts.ts';
import { Alert, Button, Chip, LinkButton, Select, SlaBox } from './ui.tsx';
import { svcWhen } from '@ortus/domain/modules';

type Tab = 'reply' | 'note';

function Feed(p: { r: Request }): ReactElement {
  const x = useService();
  return (
    <>
      {p.r.messages.map((m) => {
        const f = feedItem(m, p.r, x.now);
        if (f.system) {
          return (
            <div key={f.id} className="ox-sv-msg" data-bg="system">
              <div className="ox-sv-sys">
                <Icon name="info" size={16} />
                <span className="ox-sv-sys-t">{f.text}</span>
                <span className="ox-sv-sys-at">{f.at}</span>
              </div>
            </div>
          );
        }
        return (
          <div key={f.id} className="ox-sv-msg" data-bg={f.kind === 'note' ? 'note' : undefined}>
            <div className="ox-sv-msgbody">
              <span className="ox-sv-av" data-av={f.avatar}>
                {f.icon ? <Icon name={f.icon} size={20} /> : null}
                {f.initials}
              </span>
              <div className="ox-sv-msgmain">
                <span className="ox-sv-msghead">
                  <strong>{f.by}</strong>
                  <span className="ox-sv-sub">{f.meta}</span>
                  {f.tag ? <Chip label={f.tag.label} tone={f.tag.tone} icon={f.tag.icon} /> : null}
                </span>
                {f.chips.length > 0 ? (
                  <div className="ox-sv-chips-row">
                    {f.chips.map((c) => (
                      <Chip
                        key={c.label}
                        label={c.label}
                        tone={c.tone}
                        {...(c.strong ? { strong: true } : {})}
                      />
                    ))}
                  </div>
                ) : null}
                {f.text ? <span className="ox-sv-text">{f.text}</span> : null}
                {f.files.length > 0 ? (
                  <div className="ox-sv-files">
                    {f.files.map((file) => (
                      <span key={file.name} className="ox-sv-file">
                        <Icon name={file.icon} size={16} />
                        {file.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function CardView(p: { requestId: string }): ReactElement {
  const x = useService();
  const q = useRequest(x.tenantId, p.requestId);
  const r = q.data;
  const d = r ? x.dirOf(r.directionId) : undefined;
  const templates = useTemplates(x.tenantId, r?.directionId);

  const [tab, setTab] = useState<Tab>('reply');
  const [text, setText] = useState('');
  const [comp, setComp] = useState('');
  const [tplOpen, setTplOpen] = useState(false);
  const [outOpen, setOutOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');
  const [local, setLocal] = useState<{ scope: string; text: string } | null>(null);

  const back = (
    <button type="button" className="ox-sv-back" onClick={x.close}>
      <Icon name="arrow_back" size={18} />
      {T.card.back}
    </button>
  );
  if (q.isPending) {
    return (
      <>
        <h1 className="ox-sv-sr" id="h-service" tabIndex={-1}>
          {T.title}
        </h1>
        {back}
        <Skeleton lines={5} label={T.loading} />
      </>
    );
  }
  if (q.isError || !r) {
    return (
      <>
        <h1 className="ox-sv-sr" id="h-service" tabIndex={-1}>
          {T.title}
        </h1>
        {back}
        <Alert>{format(T.loadFailed, { error: 'Обращение не найдено' })}</Alert>
      </>
    );
  }

  const rt = x.rightsOf(r.directionId);
  const open = isOpen(r.status);
  const k = kindInfo(r.kind);
  const st = statusInfo(r.status);
  const about = isAbout(r);
  const acts = cardActions(r.status, rt, x.directions.length, r.key);
  const canReply = rt.reply && r.status !== 'closed';
  const canCompose = r.status !== 'closed';
  const curTab: Tab = canReply ? tab : 'note';
  const isNote = curTab === 'note';
  const sla = (['first', 'resolve', 'legal'] as const).flatMap((key) => {
    const t = r.sla[key];
    return t ? [{ key, ...t }] : [];
  });
  const errOf = (scope: string): string =>
    local?.scope === scope ? local.text : x.err?.scope === scope ? x.err.text : '';
  const clear = (): void => {
    setLocal(null);
    x.clearErr();
  };
  const fail = (scope: string, t: string): void => setLocal({ scope, text: t });
  const team = d?.team ?? [];
  const assigneeOpts = [
    { value: '', label: T.side.unassignedOpt },
    ...team.map((m) => ({ value: m.memberId, label: m.displayName })),
    ...(r.assignee && !team.some((m) => m.memberId === r.assignee?.memberId)
      ? [{ value: r.assignee.memberId, label: r.assignee.displayName }]
      : []),
  ];
  const disabled = x.busy || x.offline;
  const rev = r.revision;

  const patch = (
    body: Parameters<typeof x.cmd.patch>[2],
    ok: string,
    sig: string,
  ): Promise<unknown> => {
    clear();
    return x.run(`${sig}:${r.id}`, 'page', (key) => x.cmd.patch(r.id, rev, body, key), ok);
  };

  const sendReply = async (andResolve: boolean): Promise<void> => {
    clear();
    if (!text.trim()) return fail('reply', isNote ? T.card.needNote : T.card.needReply);
    const kind = isNote ? 'note' : 'public';
    const done = await x.run(
      `msg:${r.id}:${kind}`,
      'reply',
      async (key) => {
        const msg = await x.cmd.postMessage(r.id, { kind, text: text.trim() }, key);
        const compKind = !isNote ? compensationKind(comp) : undefined;
        if (compKind) {
          const fresh = await x.cmd.revisionOf(r.id);
          await x.cmd.setCompensation(r.id, fresh, { kind: compKind }, `${key}:comp`);
        }
        return msg;
      },
      isNote ? T.card.noteSaved : T.card.sent,
    );
    if (done) {
      setText('');
      setComp('');
      setTplOpen(false);
      if (andResolve) {
        setOutOpen(true);
        setOutcome('');
      }
    }
  };

  const doTransition = (a: (typeof acts)[number]): void => {
    clear();
    if (a.id === 'resolve') {
      setOutOpen(true);
      setMoveOpen(false);
      setOutcome('');
      return;
    }
    if (a.id === 'move') {
      setMoveOpen(true);
      setOutOpen(false);
      setMoveTo(x.directions.find((y) => y.id !== r.directionId)?.id ?? '');
      return;
    }
    const to = a.to;
    if (!to) return;
    void x.run(
      `tr:${r.id}:${to}`,
      'page',
      (key) => x.cmd.transition(r.id, rev, { to }, key),
      a.toast,
    );
  };

  const saveOutcome = async (): Promise<void> => {
    clear();
    if (!outcome) return fail('out', T.card.outcomePick);
    const done = await x.run(
      `tr:${r.id}:resolved`,
      'out',
      (key) => x.cmd.transition(r.id, rev, { to: 'resolved', outcome }, key),
      format(T.card.toasts.resolved, { key: r.key }),
    );
    if (done) {
      setOutOpen(false);
      setOutcome('');
    }
  };

  const saveMove = async (): Promise<void> => {
    clear();
    const done = await x.run(
      `mv:${r.id}:${moveTo}`,
      'move',
      (key) => x.cmd.move(r.id, rev, moveTo, key),
      T.card.moved,
    );
    if (done) {
      setMoveOpen(false);
      x.toast(format(T.card.movedKey, { key: done.key }));
    }
  };

  const tpls = templates.data ?? [];
  const sn = sendNote(r, isNote);
  const prioOpts = PRIORITIES.map((o) => ({ value: o.value, label: o.label }));
  const sharedBy = r.shared;
  const canShare = about && !sharedBy && !open && rt.resolve && !shareOpen;
  const myAssignee = !!rt.me && r.assignee?.memberId === rt.me.memberId;
  const canMe = rt.reply && open && !myAssignee && !!rt.me;

  return (
    <>
      <h1 className="ox-sv-sr" id="h-service" tabIndex={-1}>
        {T.title}
      </h1>
      {back}
      {x.err?.scope === 'page' ? <Alert onClose={x.clearErr}>{x.err.text}</Alert> : null}
      <div className="ox-sv-cardbody">
        <div className="ox-sv-cardmain">
          <div className="ox-sv-cardhead">
            <div className="ox-sv-chiprow">
              <span className="ox-sv-key" style={{ color: d?.color }}>
                {r.key}
              </span>
              <Chip label={typeName(x.types, r.directionId, r.kind)} tone="neutral" icon={k.icon} />
              <Chip label={st.label} tone={st.tone} icon={st.icon} />
              {r.priority === 'high' ? (
                <Chip
                  label={
                    T.card.high +
                    (r.fromRating ? format(T.list.rated, { n: String(r.fromRating) }) : '')
                  }
                  tone="warn"
                  icon="priority_high"
                />
              ) : null}
            </div>
            <h2 className="ox-sv-cardtitle">{r.title}</h2>
            <span className="ox-sv-sub">{cardMeta(r, x.now)}</span>
          </div>

          {acts.length > 0 ? (
            <div className="ox-sv-acts">
              {acts.map((a) => (
                <Button
                  key={a.id}
                  icon={a.icon}
                  variant={a.primary ? 'primary' : 'secondary'}
                  disabled={disabled}
                  onClick={() => doTransition(a)}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          ) : null}
          {acts.length === 0 && open ? <span className="ox-sv-sub">{T.card.readOnly}</span> : null}

          {outOpen ? (
            <section className="ox-sv-panel" aria-label={T.card.outcomeTitle}>
              <strong>{T.card.outcomeTitle}</strong>
              <div role="radiogroup" aria-label={T.card.outcomeTitle} className="ox-sv-outcomes">
                {outcomesOf(about).map((o) => (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={outcome === o}
                    className="ox-sv-pill ox-sv-outcome"
                    onClick={() => {
                      setOutcome(o);
                      clear();
                    }}
                  >
                    {o}
                  </button>
                ))}
              </div>
              <span className="ox-sv-hint">
                {about ? T.card.outcomeHintAbout : T.card.outcomeHint}
              </span>
              <div className="ox-sv-actions">
                {errOf('out') ? <Alert>{errOf('out')}</Alert> : null}
                <span className="ox-sv-grow" />
                <Button onClick={() => (setOutOpen(false), clear())}>{T.card.cancel}</Button>
                <Button variant="primary" disabled={disabled} onClick={() => void saveOutcome()}>
                  {T.card.resolve}
                </Button>
              </div>
            </section>
          ) : null}

          {moveOpen ? (
            <section className="ox-sv-panel" aria-label={T.card.moveTitle}>
              <strong>{T.card.moveTitle}</strong>
              <Select
                label={T.card.moveLabel}
                value={moveTo}
                onChange={setMoveTo}
                className="ox-sv-moveselect"
                options={x.directions
                  .filter((y) => y.id !== r.directionId)
                  .map((y) => ({ value: y.id, label: `${y.key} · ${y.name}` }))}
              />
              <span className="ox-sv-hint">{T.card.moveHint}</span>
              <div className="ox-sv-actions">
                {errOf('move') ? <Alert>{errOf('move')}</Alert> : null}
                <span className="ox-sv-grow" />
                <Button onClick={() => (setMoveOpen(false), clear())}>{T.card.cancel}</Button>
                <Button variant="primary" disabled={disabled} onClick={() => void saveMove()}>
                  {T.card.moveSave}
                </Button>
              </div>
            </section>
          ) : null}

          <div className="ox-sv-slarow">
            {sla.length === 0 ? (
              <SlaBox
                tone="soft"
                icon="remove"
                label={T.card.slaNone}
                text={T.card.slaNoneText}
                wide
              />
            ) : (
              sla.map((s) => {
                const tone = SLA_TONE[s.state];
                return (
                  <SlaBox
                    key={s.key}
                    tone={tone.tone}
                    icon={tone.icon}
                    label={s.label + (s.until ? ` · ${s.until}` : '')}
                    text={s.text}
                    wide
                  />
                );
              })
            )}
            {d ? (
              <span className="ox-sv-sub">
                {format(T.card.calendar, { label: d.calendar.label ?? '' })}
              </span>
            ) : null}
          </div>

          <div className="ox-sv-feed">
            <Feed r={r} />
            {canCompose ? (
              <div className="ox-sv-compose">
                <div role="tablist" className="ox-sv-tabs">
                  {canReply ? (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={curTab === 'reply'}
                      className="ox-sv-tab"
                      onClick={() => (setTab('reply'), clear())}
                    >
                      <Icon name="reply" size={16} />
                      {T.card.tabReply}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={curTab === 'note'}
                    className="ox-sv-tab"
                    onClick={() => (setTab('note'), setComp(''), clear())}
                  >
                    <Icon name="lock" size={16} />
                    {T.card.tabNote}
                  </button>
                </div>
                <div className="ox-sv-composebody" data-note={isNote ? 'true' : undefined}>
                  <textarea
                    className="ox-sv-input ox-sv-area ox-sv-reply"
                    rows={4}
                    aria-label={isNote ? T.card.noteLabel : T.card.replyLabel}
                    placeholder={isNote ? T.card.notePh : T.card.replyPh}
                    value={text}
                    onChange={(e) => (setText(e.target.value), clear())}
                  />
                  <div className="ox-sv-tools">
                    <button
                      type="button"
                      className="ox-sv-tool"
                      aria-expanded={tplOpen}
                      onClick={() => setTplOpen(!tplOpen)}
                    >
                      <Icon name="text_snippet" size={16} />
                      {T.card.templates}
                    </button>
                    {!isNote && rt.compensate && open ? (
                      <label className="ox-sv-tool ox-sv-comp">
                        <Icon name="redeem" size={16} />
                        <select
                          aria-label={T.card.compensation}
                          value={comp}
                          onChange={(e) => setComp(e.target.value)}
                        >
                          <option value="">{T.card.noCompensation}</option>
                          {COMPENSATION_OPTIONS.map((o) => (
                            <option key={o.kind} value={o.label}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  {tplOpen ? (
                    <div className="ox-sv-tpls">
                      {tpls.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className="ox-sv-tpl"
                          onClick={() => {
                            setText(fillReply(t.text, r));
                            setTplOpen(false);
                          }}
                        >
                          <strong>{t.name}</strong>
                          <span className="ox-sv-sub">{fillReply(t.text, r)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="ox-sv-actions">
                    <span className="ox-sv-sub ox-sv-channote">
                      <Icon name={sn.icon} size={16} />
                      {sn.text}
                    </span>
                    <span className="ox-sv-grow" />
                    {errOf('reply') && !outOpen && !moveOpen ? (
                      <Alert>{errOf('reply')}</Alert>
                    ) : null}
                    <Button
                      variant={isNote ? 'primary' : 'secondary'}
                      disabled={disabled}
                      onClick={() => void sendReply(false)}
                    >
                      {isNote ? T.card.saveNote : T.card.send}
                    </Button>
                    {!isNote && rt.resolve && open ? (
                      <Button
                        variant="primary"
                        icon="send"
                        disabled={disabled}
                        onClick={() => void sendReply(true)}
                      >
                        {T.card.sendResolve}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {r.status === 'closed' ? <div className="ox-sv-closed">{T.card.closedNote}</div> : null}
          </div>
        </div>

        <aside className="ox-sv-aside">
          <div className="ox-sv-props">
            <span className="ox-sv-label">{T.side.assignee}</span>
            <span className="ox-sv-propval">
              <Select
                label={T.side.assignee}
                value={r.assignee?.memberId ?? ''}
                disabled={!rt.reply || !open || disabled}
                options={assigneeOpts}
                onChange={(v) =>
                  void patch(
                    { assigneeId: v || null },
                    v
                      ? format(T.side.assigneeDone, {
                          name: assigneeOpts.find((o) => o.value === v)?.label ?? '',
                        })
                      : T.side.assigneeCleared,
                    'as',
                  )
                }
              />
              {canMe ? (
                <LinkButton
                  disabled={disabled}
                  onClick={() =>
                    void patch(
                      { assigneeId: rt.me?.memberId ?? null },
                      format(T.list.taken, { key: r.key }),
                      'me',
                    )
                  }
                >
                  {T.side.me}
                </LinkButton>
              ) : null}
            </span>
            <span className="ox-sv-label">{T.side.priority}</span>
            <Select
              label={T.side.priority}
              value={r.priority}
              disabled={!rt.reply || !open || disabled}
              options={prioOpts}
              onChange={(v) =>
                void patch({ priority: v as Request['priority'] }, T.side.priorityDone, 'pr')
              }
            />
            <span className="ox-sv-label">{T.side.direction}</span>
            <span>{directionText(d)}</span>
            <span className="ox-sv-label">{T.side.area}</span>
            <span>{d?.areaLabel ?? ''}</span>
            <span className="ox-sv-label">{T.side.labels}</span>
            <span>{r.labels.join(' · ') || T.side.noLabels}</span>
          </div>

          <div className="ox-sv-block">
            <span className="ox-sv-label">{T.side.client}</span>
            <strong className="ox-sv-client">{r.client.name}</strong>
            {r.client.company ? <span className="ox-sv-text2">{r.client.company}</span> : null}
            <span className="ox-sv-phone">
              <span className="ox-sv-num">{r.client.phone ?? r.client.phoneMasked}</span>
              {!r.client.phone && rt.contacts ? (
                <LinkButton
                  icon="visibility"
                  disabled={disabled}
                  onClick={() =>
                    void x.run(
                      `ph:${r.id}`,
                      'page',
                      (key) => x.cmd.revealPhone(r.id, key),
                      T.side.phoneShown,
                    )
                  }
                >
                  {T.side.show}
                </LinkButton>
              ) : null}
            </span>
            {!r.client.phone && !rt.contacts ? (
              <span className="ox-sv-sub">{T.side.phoneHint}</span>
            ) : null}
            <span className="ox-sv-text2">{r.client.since}</span>
          </div>

          <div className="ox-sv-block">
            <span className="ox-sv-label">{T.side.linked}</span>
            <strong className="ox-sv-linked">{r.link ? r.link.label : T.side.unlinked}</strong>
            {(r.link ? r.link.lines : [T.side.unlinkedHint]).map((l) => (
              <span key={l} className="ox-sv-text2">
                {l}
              </span>
            ))}
          </div>

          {about ? (
            <div className="ox-sv-block">
              <span className="ox-sv-label">{T.side.who}</span>
              <div className="ox-sv-aboutnote">
                <Icon name="shield_person" size={18} />
                <span>
                  {format(T.side.aboutText, {
                    name: r.aboutMember?.displayName ?? T.side.aboutNoName,
                  })}
                </span>
              </div>
              {sharedBy ? (
                <span className="ox-sv-text2">
                  {format(T.side.shared, {
                    when: svcWhen(Date.parse(sharedBy.at), x.now),
                    text: sharedBy.text,
                  })}
                </span>
              ) : null}
              {canShare ? (
                <LinkButton onClick={() => (setShareOpen(true), setShareText(''))}>
                  {T.side.shareOpen}
                </LinkButton>
              ) : null}
              {open ? <span className="ox-sv-sub">{T.side.shareLocked}</span> : null}
              {shareOpen ? (
                <>
                  <textarea
                    className="ox-sv-input ox-sv-area"
                    rows={3}
                    aria-label={T.side.shareLabel}
                    placeholder={T.side.sharePh}
                    value={shareText}
                    onChange={(e) => setShareText(e.target.value)}
                  />
                  <div className="ox-sv-actions ox-sv-end">
                    <Button small onClick={() => setShareOpen(false)}>
                      {T.card.cancel}
                    </Button>
                    <Button
                      small
                      variant="primary"
                      disabled={disabled}
                      onClick={() =>
                        void x
                          .run(
                            `sh:${r.id}`,
                            'page',
                            (key) => x.cmd.shareConclusion(r.id, rev, shareText, key),
                            T.side.shareDone,
                          )
                          .then((done) => {
                            if (done) {
                              setShareOpen(false);
                              setShareText('');
                            }
                          })
                      }
                    >
                      {T.side.shareSend}
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="ox-sv-block">
            <span className="ox-sv-blockhead">
              <span className="ox-sv-label ox-sv-grow">{T.side.tasks}</span>
              {rt.reply && open ? (
                <LinkButton onClick={() => (setTaskOpen(!taskOpen), setTaskTitle(''))}>
                  {T.side.taskAdd}
                </LinkButton>
              ) : null}
            </span>
            {r.tasks.map((t) => (
              <div key={t.id} className="ox-sv-task">
                <span className="ox-sv-taskid">{t.key}</span>
                <span className="ox-sv-taskname">{t.title}</span>
                <Chip label={t.status} tone="info" />
              </div>
            ))}
            {r.tasks.length === 0 && !taskOpen ? (
              <span className="ox-sv-sub">{T.side.noTasks}</span>
            ) : null}
            {taskOpen ? (
              <div className="ox-sv-taskform">
                <input
                  className="ox-sv-input"
                  aria-label={T.side.taskTitle}
                  placeholder={T.side.taskTitle}
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={disabled}
                  onClick={() => {
                    clear();
                    const bad = taskError(taskTitle);
                    if (bad) return fail('task', bad);
                    void x
                      .run(
                        `tk:${r.id}`,
                        'task',
                        (key) => x.cmd.createTask(r.id, taskTitle.trim(), key),
                        T.side.taskDone,
                      )
                      .then((done) => {
                        if (done) {
                          setTaskOpen(false);
                          setTaskTitle('');
                        }
                      });
                  }}
                >
                  {T.side.taskCreate}
                </Button>
              </div>
            ) : null}
            {taskOpen && errOf('task') ? <Alert>{errOf('task')}</Alert> : null}
          </div>

          <div className="ox-sv-block ox-sv-last">
            <span className="ox-sv-label">{T.side.after}</span>
            <span className="ox-sv-text2">{afterText(r)}</span>
          </div>
        </aside>
      </div>
    </>
  );
}
