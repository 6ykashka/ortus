// W7.33 · `public-service-request` — «Моё обращение» клиента по личной ссылке: `{origin}/r/{token}`. Эталон —
// «Обращения - варианты.dc.html» 1a, экран 4 «Ответ и оценка решения»: номер и статус, «Получили · Ответили · Решено»,
// переписка (только публичные сообщения), «Довольны ли решением?» (одна оценка), «Вопрос не решён — вернуть в
// работу» (окно 5 дней), «Написать» с фото. Клиент видит статусы «Получили», «Отвечаем», «Ждём вашего ответа»,
// «Решено»; заметки и внутренние записи сервер не отдаёт.
import { type components } from '@ortus/api-client';
import { format } from '@ortus/texts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { type ChangeEvent, type FormEvent, type ReactElement, useEffect, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import {
  type Attached,
  attach,
  AttachError,
  getRequest,
  idemKeys,
  MAX_FILES,
  optOut,
  postMessage,
  rateResolution,
  reopenRequest,
} from './api.ts';
import { hhmm, longDay, refusalOf, stepsOf } from './model.ts';
import { Frame, Glyph, Loading, ScaleRadios, StateView } from './parts.tsx';
import { P } from './texts.ts';

type S = components['schemas'];
type Req = S['PublicServiceRequest'];

const POLL_MS = 30_000;

export default function RequestScreen(): ReactElement {
  const { token = '' } = useParams({ strict: false }) as { token?: string };
  const api = useApi();
  const qc = useQueryClient();
  const key = ['public-service-request', token] as const;
  const q = useQuery({
    queryKey: key,
    retry: false,
    refetchInterval: POLL_MS,
    queryFn: () => getRequest(api, token),
  });
  const put = (r: Req): void => {
    qc.setQueryData(key, r);
  };
  useEffect(() => {
    if (q.data) document.title = `${q.data.key} · ${q.data.title}`;
  }, [q.data]);

  if (q.isPending)
    return (
      <Frame>
        <Loading />
      </Frame>
    );
  if (q.isError && !q.data) {
    const r = refusalOf(q.error);
    return (
      <Frame>
        <StateView kind={r ?? 'error'} onRetry={() => void q.refetch()} />
      </Frame>
    );
  }
  const req = q.data as Req;
  return (
    <Frame>
      <header className="ox-sp-reqhead">
        <span className="ox-sp-key">{req.key}</span>
        <span className="ox-sp-chip" data-status={req.status}>
          <Glyph
            name={
              req.status === 'resolved' || req.status === 'closed' ? 'check_circle' : 'schedule'
            }
            size={15}
          />
          {req.statusLabel}
        </span>
      </header>
      <h1 className="ox-sp-reqtitle">{req.title}</h1>
      {req.dueText ? <p className="ox-sp-due">{req.dueText}</p> : null}
      <Steps req={req} />
      <Thread req={req} />
      <Satisfaction token={token} req={req} onChange={put} />
      {req.status === 'closed' ? (
        <p className="ox-sp-note">{P.req.closed}</p>
      ) : (
        <Composer token={token} onSent={() => void getRequest(api, token).then(put)} />
      )}
      <OptOut token={token} />
    </Frame>
  );
}

function Steps({ req }: { req: Req }): ReactElement {
  const steps = stepsOf(req.status, req.messages);
  return (
    <ol className="ox-sp-steps" aria-label={P.req.pageTitle}>
      {steps.map((s) => (
        <li
          key={s.key}
          data-done={s.done ? '' : undefined}
          data-current={s.current ? '' : undefined}
        >
          <Glyph
            name={s.done ? 'check_circle' : 'radio_button_unchecked'}
            size={15}
            fill={s.current}
          />
          <span className="ox-sp-step-text">{s.at ? `${s.label} ${s.at}` : s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Thread({ req }: { req: Req }): ReactElement {
  if (req.messages.length === 0) return <p className="ox-sp-note">{P.req.empty}</p>;
  return (
    <div className="ox-sp-thread">
      {req.messages.map((m) => (
        <article key={m.id} className="ox-sp-msg" data-mine={m.fromClient ? '' : undefined}>
          <span className="ox-sp-meta">
            {m.fromClient ? P.req.you : P.req.team} · {hhmm(m.at)}
          </span>
          <p>{m.text}</p>
          {m.files.length > 0 ? (
            <ul className="ox-sp-files" aria-label={P.req.files}>
              {m.files.map((f) => (
                <li key={f.id}>
                  <Glyph name="attach_file" size={16} />
                  {f.fileName}
                  {f.status === 'quarantined' || f.status === 'pending_upload'
                    ? ` · ${P.form.quarantine}`
                    : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/** «Довольны ли решением?», оценка одна на обращение; «Вопрос не решён» — в течение 5 дней. */
function Satisfaction(p: {
  token: string;
  req: Req;
  onChange: (r: Req) => void;
}): ReactElement | null {
  const api = useApi();
  const [keys] = useState(idemKeys);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const r = p.req;
  if (!r.canRate && !r.canReopen && r.rating == null) return null;

  const run = async (f: () => Promise<Req>): Promise<void> => {
    setBusy(true);
    setFail(null);
    try {
      p.onChange(await f());
      setOpen(false);
      setText('');
    } catch (e) {
      setFail(refusalOf(e) === 'rateLimited' ? P.state.rateLimited.text : P.req.sendFailed);
    } finally {
      setBusy(false);
    }
  };
  const reopen = (): Promise<void> => {
    const body = text.trim();
    return run(async () => {
      const x = await reopenRequest(api, p.token, body, keys.key(body));
      keys.settle(body);
      return x;
    });
  };

  return (
    <section className="ox-sp-sat" aria-labelledby="h-sp-sat">
      {r.canRate ? (
        <>
          <h2 id="h-sp-sat">{P.req.satisfied}</h2>
          <ScaleRadios
            label={P.req.scale}
            value={null}
            disabled={busy}
            onChange={(n) => void run(() => rateResolution(api, p.token, n))}
          />
        </>
      ) : r.rating != null ? (
        <p id="h-sp-sat" className="ox-sp-rated">
          {format(P.req.rated, { n: r.rating })}
        </p>
      ) : null}
      {r.canReopen && !open ? (
        <>
          <button type="button" className="ox-sp-linkbtn" onClick={() => setOpen(true)}>
            {P.req.reopen}
          </button>
          {r.reopenUntil ? (
            <small>{format(P.req.reopenUntil, { date: longDay(r.reopenUntil) })}</small>
          ) : null}
        </>
      ) : null}
      {r.canReopen && open ? (
        <form
          className="ox-sp-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void reopen();
          }}
        >
          <label className="ox-sp-field">
            <span>{P.req.reopenAsk}</span>
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="ox-sp-actions">
            <button type="submit" className="ox-sp-btn" data-variant="primary" disabled={busy}>
              {P.req.reopenSend}
            </button>
            <button type="button" className="ox-sp-btn" onClick={() => setOpen(false)}>
              {P.form.cancel}
            </button>
          </div>
        </form>
      ) : null}
      {fail ? (
        <p className="ox-sp-alert" role="alert">
          {fail}
        </p>
      ) : null}
    </section>
  );
}

/** «Написать» с фото: файлы идут по билету и прикрепляются к сообщению после завершения загрузки. */
function Composer({ token, onSent }: { token: string; onSent: () => void }): ReactElement {
  const api = useApi();
  const [keys] = useState(idemKeys);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attached[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const list = [...(e.target.files ?? [])];
    e.target.value = '';
    setFail(null);
    for (const f of list.slice(0, Math.max(0, MAX_FILES - files.length))) {
      setUploading((n) => n + 1);
      try {
        const a = await attach(api, token, f);
        setFiles((xs) => [...xs, a]);
      } catch (x) {
        setFail(x instanceof AttachError ? P.req.fileTooBig : P.req.fileFailed);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const can = (text.trim() !== '' || files.length > 0) && !busy && uploading === 0;
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!can) return;
    const body: S['PublicServiceMessageCreate'] = {
      text: text.trim() || files.map((f) => f.name).join(', '),
      ...(files.length ? { fileIds: files.map((f) => f.fileId) } : {}),
    };
    setBusy(true);
    setFail(null);
    try {
      await postMessage(api, token, body, keys.key(body));
      keys.settle(body);
      setText('');
      setFiles([]);
      onSent();
    } catch (x) {
      setFail(refusalOf(x) === 'rateLimited' ? P.state.rateLimited.text : P.req.sendFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="ox-sp-composer" onSubmit={(e) => void submit(e)}>
      {files.length > 0 ? (
        <ul className="ox-sp-files" aria-label={P.req.files}>
          {files.map((f) => (
            <li key={f.fileId}>
              <Glyph name="attach_file" size={16} />
              {f.name}
              <button
                type="button"
                className="ox-sp-x"
                aria-label={`${P.form.remove} ${f.name}`}
                onClick={() => setFiles((xs) => xs.filter((x) => x.fileId !== f.fileId))}
              >
                <Glyph name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {fail ? (
        <p className="ox-sp-alert" role="alert">
          {fail}
        </p>
      ) : null}
      <div className="ox-sp-compose">
        <label className="ox-sp-attach">
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="ox-sp-sr"
            aria-label={P.req.attach}
            onChange={(e) => void pick(e)}
          />
          <Glyph name="photo_camera" size={22} />
        </label>
        <textarea
          rows={1}
          aria-label={P.req.writeLabel}
          placeholder={P.req.write}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="ox-sp-btn" data-variant="primary" disabled={!can}>
          {P.req.send}
        </button>
      </div>
    </form>
  );
}

function OptOut({ token }: { token: string }): ReactElement {
  const api = useApi();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (done) return <p className="ox-sp-note">{P.req.stopDone}</p>;
  return (
    <footer className="ox-sp-foot">
      <p className="ox-sp-note">{P.req.stopHint}</p>
      <button
        type="button"
        className="ox-sp-linkbtn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void optOut(api, token)
            .then((ok) => setDone(ok))
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
      >
        {P.req.stop}
      </button>
    </footer>
  );
}
