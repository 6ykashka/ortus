// W7.33 · `public-service-page` — страница направления для клиента без входа: `{origin}/s/{slug}`, `?w=` — токен
// работы (визит, рейс, акт; ссылка из SMS). Эталон — «Обращения - варианты.dc.html» 1a, экраны 2 «Оценка визита»
// и 3 «Страница направления». Вход — только личная ссылка (Q-W4.00-service-9). Оценка визита уходит обращением
// (Q-W7.33-1), вложения клиент прикрепляет к обращению по личной ссылке (билеты загрузки выдаются по токену).
import { type components } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from '@tanstack/react-router';
import { type FormEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { getPage, idemKeys, submitRequest } from './api.ts';
import {
  addMine,
  groupTypes,
  type Mine,
  readMine,
  refusalOf,
  type SubmitErrors,
  type TypeItem,
  validateSubmit,
  visitSubmission,
  VISIT_REASONS,
} from './model.ts';
import { Err, Field, Frame, Glyph, Head, Loading, ScaleRadios, StateView } from './parts.tsx';
import { P } from './texts.ts';

type S = components['schemas'];
type Page = S['PublicServicePage'];

type View =
  | { k: 'list' }
  | { k: 'mine' }
  | { k: 'form'; type: TypeItem }
  | { k: 'visit' }
  | { k: 'receipt'; receipt: S['PublicServiceReceipt'] }
  | { k: 'visitDone'; contact: boolean };

export default function PageScreen(): ReactElement {
  const { slug = '' } = useParams({ strict: false }) as { slug?: string };
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const work = new URLSearchParams(searchStr).get('w') ?? '';
  const api = useApi();
  const q = useQuery({
    queryKey: ['public-service-page', slug],
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: () => getPage(api, slug),
  });
  const [view, setView] = useState<View>({ k: 'list' });
  const [mine, setMine] = useState<Mine[]>(() => readMine(slug));
  const page = q.data;
  useEffect(() => {
    if (page) document.title = `${page.directionName} · ${page.brandName}`;
  }, [page]);

  if (q.isPending)
    return (
      <Frame>
        <Loading />
      </Frame>
    );
  if (q.isError) {
    const r = refusalOf(q.error);
    return (
      <Frame>
        <StateView kind={r ?? 'error'} onRetry={() => void q.refetch()} />
      </Frame>
    );
  }
  const data = q.data;
  const toList = () => setView({ k: 'list' });
  const remember = (m: Mine) => {
    addMine(slug, m);
    setMine(readMine(slug));
  };
  const right =
    mine.length > 0 && view.k !== 'mine' ? (
      <button type="button" className="ox-sp-linkbtn" onClick={() => setView({ k: 'mine' })}>
        {P.page.mine} · {mine.length}
      </button>
    ) : null;

  return (
    <Frame>
      <Head
        color={data.color}
        brand={data.brandName}
        direction={data.directionName}
        right={right}
      />
      {view.k === 'list' ? (
        <TypeList
          page={data}
          work={work}
          onType={(t) => setView({ k: 'form', type: t })}
          onVisit={() => setView({ k: 'visit' })}
        />
      ) : null}
      {view.k === 'mine' ? <MineList items={mine} onBack={toList} /> : null}
      {view.k === 'form' ? (
        <RequestForm
          key={view.type.id}
          slug={slug}
          work={work}
          type={view.type}
          onBack={toList}
          onDone={(receipt, title) => {
            remember({ key: receipt.key, title, token: receipt.token });
            setView({ k: 'receipt', receipt });
          }}
        />
      ) : null}
      {view.k === 'visit' ? (
        <VisitForm
          slug={slug}
          work={work}
          page={data}
          onBack={toList}
          onDone={(receipt, title, contact) => {
            remember({ key: receipt.key, title, token: receipt.token });
            setView({ k: 'visitDone', contact });
          }}
        />
      ) : null}
      {view.k === 'receipt' ? <Receipt receipt={view.receipt} onMore={toList} /> : null}
      {view.k === 'visitDone' ? <VisitDone contact={view.contact} onBack={toList} /> : null}
    </Frame>
  );
}

function TypeList(p: {
  page: Page;
  work: string;
  onType: (t: TypeItem) => void;
  onVisit: () => void;
}): ReactElement {
  const groups = groupTypes(p.page.types);
  return (
    <>
      <h1 className="ox-sp-h1">{P.page.title}</h1>
      {groups.map((g) => (
        <section key={g.key} className="ox-sp-group" aria-labelledby={`h-sp-${g.key}`}>
          <h2 id={`h-sp-${g.key}`}>{g.title}</h2>
          {g.key === 'rate' && p.work ? (
            <button type="button" className="ox-sp-row" onClick={p.onVisit}>
              <Glyph name="star" />
              <span>{P.page.rateVisit}</span>
            </button>
          ) : null}
          {g.items.map((t) => (
            <button key={t.id} type="button" className="ox-sp-row" onClick={() => p.onType(t)}>
              <Glyph name={t.icon} />
              <span>{t.name}</span>
            </button>
          ))}
        </section>
      ))}
      {groups.every((g) => g.key !== 'rate') && p.work ? (
        <section className="ox-sp-group" aria-labelledby="h-sp-rate">
          <h2 id="h-sp-rate">{P.page.groups.rate}</h2>
          <button type="button" className="ox-sp-row" onClick={p.onVisit}>
            <Glyph name="star" />
            <span>{P.page.rateVisit}</span>
          </button>
        </section>
      ) : null}
      <p className="ox-sp-note">
        {P.page.workHours}: {p.page.workHours}
      </p>
    </>
  );
}

function MineList({ items, onBack }: { items: Mine[]; onBack: () => void }): ReactElement {
  return (
    <>
      <h1 className="ox-sp-h1">{P.page.mine}</h1>
      <ul className="ox-sp-mine">
        {items.map((m) => (
          <li key={m.token}>
            <Link to="/r/$token" params={{ token: m.token }} className="ox-sp-row">
              <Glyph name="forum" />
              <span>
                <strong className="ox-sp-key">{m.key}</strong> {m.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" className="ox-sp-btn" onClick={onBack}>
        {P.page.back}
      </button>
    </>
  );
}

/** Общие поля формы: имя, телефон. */
function Contact(p: {
  name: string;
  phone: string;
  setName: (v: string) => void;
  setPhone: (v: string) => void;
  err: SubmitErrors;
}): ReactElement {
  return (
    <>
      <Field label={P.form.name}>
        {(a) => (
          <input
            {...a}
            type="text"
            autoComplete="name"
            value={p.name}
            onChange={(e) => p.setName(e.target.value)}
          />
        )}
      </Field>
      <Field label={P.form.phone} error={p.err.phone}>
        {(a) => (
          <input
            {...a}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={p.phone}
            onChange={(e) => p.setPhone(e.target.value)}
          />
        )}
      </Field>
    </>
  );
}

function Consent(p: {
  value: boolean;
  set: (v: boolean) => void;
  err: string | undefined;
}): ReactElement {
  return (
    <div className="ox-sp-consent">
      <label className="ox-sp-check">
        <input
          type="checkbox"
          checked={p.value}
          aria-invalid={p.err ? true : undefined}
          aria-describedby={p.err ? 'e-sp-consent' : undefined}
          onChange={(e) => p.set(e.target.checked)}
        />
        <span>{P.form.consent}</span>
      </label>
      <Err id="e-sp-consent" text={p.err} />
    </div>
  );
}

/** Отправка обращения с ключом идемпотентности и нонсом на попытку. */
function useSender(slug: string) {
  const api = useApi();
  const [keys] = useState(idemKeys);
  const nonce = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const send = async (
    body: Omit<S['PublicServiceSubmit'], 'submissionNonce'>,
  ): Promise<S['PublicServiceReceipt'] | null> => {
    const full: S['PublicServiceSubmit'] = { ...body, submissionNonce: nonce.current };
    setBusy(true);
    setFail(null);
    try {
      const r = await submitRequest(api, slug, full, keys.key(full));
      keys.settle(full);
      return r;
    } catch (e) {
      setFail(refusalOf(e) === 'rateLimited' ? P.state.rateLimited.text : P.form.sendFailed);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { send, busy, fail };
}

const clean = (s: string): string | undefined => s.trim() || undefined;

function RequestForm(p: {
  slug: string;
  work: string;
  type: TypeItem;
  onBack: () => void;
  onDone: (r: S['PublicServiceReceipt'], title: string) => void;
}): ReactElement {
  const { send, busy, fail } = useSender(p.slug);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<SubmitErrors>({});
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const bad = validateSubmit({ text, consent, phone, needPhone: false });
    setErr(bad);
    if (Object.keys(bad).length) return;
    const r = await send({
      typeId: p.type.id,
      text: text.trim(),
      consent: true,
      ...(clean(name) ? { clientName: clean(name) as string } : {}),
      ...(clean(phone) ? { phone: clean(phone) as string } : {}),
      ...(p.work ? { workToken: p.work } : {}),
    });
    if (r) p.onDone(r, p.type.name);
  };
  return (
    <form className="ox-sp-form" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="ox-sp-h1">{p.type.name}</h1>
      <Field label={p.type.kind === 'thanks' ? P.form.textThanks : P.form.text} error={err.text}>
        {(a) => <textarea {...a} rows={5} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <Contact name={name} phone={phone} setName={setName} setPhone={setPhone} err={err} />
      <Consent value={consent} set={setConsent} err={err.consent} />
      {fail ? (
        <p className="ox-sp-alert" role="alert">
          {fail}
        </p>
      ) : null}
      <div className="ox-sp-actions">
        <button type="submit" className="ox-sp-btn" data-variant="primary" disabled={busy}>
          {busy ? P.form.sending : P.form.send}
        </button>
        <button type="button" className="ox-sp-btn" onClick={p.onBack}>
          {P.page.back}
        </button>
      </div>
    </form>
  );
}

function Receipt({
  receipt,
  onMore,
}: {
  receipt: S['PublicServiceReceipt'];
  onMore: () => void;
}): ReactElement {
  return (
    <section className="ox-sp-done" aria-labelledby="h-sp-receipt">
      <Glyph name="check_circle" size={40} fill />
      <h1 id="h-sp-receipt">{P.receipt.title}</h1>
      <dl className="ox-sp-facts">
        <div>
          <dt>{P.receipt.number}</dt>
          <dd className="ox-sp-key">{receipt.key}</dd>
        </div>
        <div>
          <dt>{P.receipt.status}</dt>
          <dd>{receipt.statusLabel}</dd>
        </div>
      </dl>
      <p>{P.receipt.keep}</p>
      <Link
        to="/r/$token"
        params={{ token: receipt.token }}
        className="ox-sp-btn"
        data-variant="primary"
      >
        {P.receipt.link}
      </Link>
      <button type="button" className="ox-sp-btn" onClick={onMore}>
        {P.receipt.more}
      </button>
    </section>
  );
}

function VisitForm(p: {
  slug: string;
  work: string;
  page: Page;
  onBack: () => void;
  onDone: (r: S['PublicServiceReceipt'], title: string, contact: boolean) => void;
}): ReactElement {
  const { send, busy, fail } = useSender(p.slug);
  const [score, setScore] = useState<number | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [contact, setContact] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<SubmitErrors & { score?: string }>({});
  const low = score !== null && score <= 3;
  const toggle = (r: string) =>
    setReasons((xs) => (xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]));
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (score === null) {
      setErr({ score: P.visit.pickScore });
      return;
    }
    const v = visitSubmission({ score, reasons, comment, contact: low && contact });
    const bad = validateSubmit({ text: v.text, consent, phone, needPhone: low && contact });
    setErr(bad);
    if (Object.keys(bad).length) return;
    const type = p.page.types.find((t) => t.kind === v.kind) ?? p.page.types[0];
    if (!type) return;
    const r = await send({
      typeId: type.id,
      text: v.text,
      consent: true,
      ...(clean(name) ? { clientName: clean(name) as string } : {}),
      ...(clean(phone) ? { phone: clean(phone) as string } : {}),
      workToken: p.work,
    });
    if (r) p.onDone(r, `${P.visit.score}: ${score} из 5`, low && contact);
  };
  return (
    <form className="ox-sp-form" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="ox-sp-h1">{P.visit.title}</h1>
      <div className="ox-sp-scalebox">
        <ScaleRadios
          label={P.visit.score}
          value={score}
          onChange={(n) => {
            setScore(n);
            setErr({});
          }}
        />
        <div className="ox-sp-scalecap">
          <span>{P.visit.worst}</span>
          <span>{P.visit.best}</span>
        </div>
        <Err id="e-sp-score" text={err.score} />
      </div>
      {low ? (
        <fieldset className="ox-sp-reasons">
          <legend>{P.visit.what}</legend>
          <div>
            {VISIT_REASONS.map((r) => {
              const on = reasons.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  className="ox-sp-chipbtn"
                  aria-pressed={on}
                  onClick={() => toggle(r)}
                >
                  {on ? <Glyph name="check" size={15} /> : null}
                  {r}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      {score !== null ? (
        <label className="ox-sp-field">
          <span>{P.visit.comment}</span>
          <textarea
            rows={3}
            value={comment}
            placeholder={P.visit.commentPlaceholder}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
      ) : null}
      {low ? (
        <>
          <label className="ox-sp-check ox-sp-contact">
            <input
              type="checkbox"
              checked={contact}
              aria-label={P.visit.contact}
              aria-describedby="h-sp-contact"
              onChange={(e) => setContact(e.target.checked)}
            />
            <span>
              <strong>{P.visit.contact}</strong>
              <small id="h-sp-contact">{P.visit.contactHint}</small>
            </span>
          </label>
          {contact ? (
            <Contact name={name} phone={phone} setName={setName} setPhone={setPhone} err={err} />
          ) : null}
        </>
      ) : null}
      <Consent value={consent} set={setConsent} err={err.consent} />
      {fail ? (
        <p className="ox-sp-alert" role="alert">
          {fail}
        </p>
      ) : null}
      <div className="ox-sp-actions">
        <button type="submit" className="ox-sp-btn" data-variant="primary" disabled={busy}>
          {busy ? P.form.sending : P.visit.send}
        </button>
        <button type="button" className="ox-sp-btn" onClick={p.onBack}>
          {P.page.back}
        </button>
      </div>
    </form>
  );
}

function VisitDone({ contact, onBack }: { contact: boolean; onBack: () => void }): ReactElement {
  return (
    <section className="ox-sp-done" aria-labelledby="h-sp-visit-done">
      <Glyph name="favorite" size={40} fill />
      <h1 id="h-sp-visit-done">{P.visit.thanks}</h1>
      <p>{contact ? P.visit.complaintText : P.visit.thanksText}</p>
      <button type="button" className="ox-sp-btn" onClick={onBack}>
        {P.visit.again}
      </button>
    </section>
  );
}
