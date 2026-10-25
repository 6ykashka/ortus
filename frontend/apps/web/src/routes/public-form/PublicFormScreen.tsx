// W4.70 · «Публичная форма» гостя (`public-form`, `{origin}/f/{token}`, встраивание `?embed=1` — Q-W4.00-forms-21;
// эталона нет, рендер — вкладка «Предпросмотр» W4.22 без панели, Q-W4.00-forms-19). Без сессии и оболочки: форма
// гостя — `getPublicForm` (без баллов и умолчаний скрытых вопросов, нонс отправки), ответ — `submitPublicForm` по нонсу
// с параметрами адреса для скрытых вопросов (Q-W4.05-26, Q-W4.00-forms-20), файлы — загрузки нонса до проверки.
// Ответ гостя — «На проверке» (Q-W4.00-forms-18). Названия формы контракт гостю не отдаёт — заголовок — название
// первой страницы (Q-W4.70-2).
import { type components, unwrap } from '@ortus/api-client';
import { format, forms as F } from '@ortus/texts';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useParams } from '@tanstack/react-router';
import { type ReactElement, useEffect, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { problemText } from '../../shell/run.tsx';
import { idemKeys } from '../core/forms/api.ts';
import { FileField, FileStore } from '../core/forms/fill/controls.tsx';
import {
  answersOf,
  doneOfReceipt,
  linkParamsOf,
  type Refusal,
  refusalOf,
} from '../core/forms/fill/model.ts';
import { FillAlert, FillFrame, FillLoading, FillState } from '../core/forms/fill/parts.tsx';
import { failedOutcome, refusalView } from '../core/forms/fill/submit.ts';
import { guestUploader } from '../core/forms/fill/upload.ts';
import { type FillHooks, FormRender } from '../core/forms/preview.tsx';

type S = components['schemas'];

const MB = 1024 * 1024;

/** Вид формы гостя (PublicFormPresentation) → настройки рендера; баллы считает сервер. */
function settingsOf(p: S['PublicFormPresentation'] | undefined): S['FormSettings'] {
  return {
    access: 'public',
    acceptUntil: null,
    responseLimit: null,
    onePerMember: false,
    allowEditBeforeReview: false,
    confirmationText: p?.confirmationText ?? '',
    scoring: false,
    passScore: null,
    showScore: p?.showScore ?? false,
    progressBar: p?.progressBar ?? true,
    backButton: p?.backButton ?? true,
    showLogo: Boolean(p?.organizationName),
    retainResponsesDays: 365,
  };
}

function Refused({ r, reopen }: { r: Refusal; reopen: () => void }): ReactElement {
  const v = refusalView(r);
  return (
    <FillState
      icon={v.icon}
      title={v.title}
      {...(v.text ? { text: v.text } : {})}
      {...(v.reopen ? { action: { label: F.fill.reopen, onClick: reopen } } : {})}
    />
  );
}

export default function PublicFormScreen(): ReactElement {
  const { token = '' } = useParams({ strict: false }) as { token?: string };
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const embed = new URLSearchParams(searchStr).get('embed') === '1';
  const api = useApi();
  const [run, setRun] = useState(0);
  const [stop, setStop] = useState<Refusal | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['public-form', token, run],
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/public/forms/{publicToken}', {
          params: { path: { publicToken: token } },
        }),
      ),
  });
  const reopen = () => {
    setStop(null);
    setAlert(null);
    setRun((n) => n + 1);
  };

  let body: ReactElement;
  if (q.isPending) body = <FillLoading />;
  else if (q.isError) {
    const r = refusalOf(q.error);
    body =
      r && r.kind !== 'offline' ? (
        <Refused r={r} reopen={reopen} />
      ) : (
        <FillState
          icon="error"
          title={format(F.fill.loadError, { error: problemText(q.error) })}
          action={{ label: F.fill.retry, onClick: () => void q.refetch() }}
        />
      );
  } else if (stop) body = <Refused r={stop} reopen={reopen} />;
  else if (!q.data.acceptingResponses) body = <Refused r={{ kind: 'closed' }} reopen={reopen} />;
  else {
    body = (
      <>
        <FillAlert text={alert} />
        <GuestRun
          key={q.data.submissionNonce}
          token={token}
          form={q.data}
          search={searchStr}
          onStop={setStop}
          onAlert={setAlert}
        />
      </>
    );
  }
  return <FillFrame embed={embed}>{body}</FillFrame>;
}

/** Одна попытка гостя: нонс, файлы и ключ идемпотентности живут до «Открыть заново». */
function GuestRun(p: {
  token: string;
  form: S['PublicForm'];
  search: string;
  onStop: (r: Refusal) => void;
  onAlert: (t: string | null) => void;
}): ReactElement {
  const api = useApi();
  const f = p.form;
  const [store] = useState(() => {
    const g = guestUploader(api, {
      token: p.token,
      versionId: f.versionId,
      nonce: f.submissionNonce,
    });
    return new FileStore(g.upload, g.status);
  });
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const [keys] = useState(idemKeys);
  const def = f.definition;
  const maxMb = Math.max(1, Math.floor(f.uploadMaxBytes / MB));

  const hooks: FillHooks = {
    control: (x, v, setV, a11y) =>
      x.type === 'photo' ? (
        <FileField
          x={x}
          store={store}
          maxMb={Math.min(x.maxFileMb ?? 20, maxMb)}
          value={v}
          setV={setV}
          a11y={a11y}
        />
      ) : null,
    submit: async (vals) => {
      const pending = store.pending();
      if (pending.length) {
        return {
          kind: 'errors',
          errs: Object.fromEntries(pending.map((k) => [k, F.fill.pending])),
        };
      }
      const all = { ...vals };
      for (const x of def.fields) if (x.type === 'photo') all[x.key] = store.ids(x.key);
      const link = linkParamsOf(def, p.search);
      const body: S['PublicResponseCreate'] = {
        versionId: f.versionId,
        submissionNonce: f.submissionNonce,
        answers: answersOf(def, all),
        ...(Object.keys(link).length ? { linkParams: link } : {}),
      };
      try {
        const r = await unwrap(
          await api.POST('/api/v1/public/forms/{publicToken}/responses', {
            params: {
              path: { publicToken: p.token },
              header: { 'Idempotency-Key': keys.key(body) },
            },
            // NullValue схемы (value: null) и тело запроса openapi-fetch расходятся по типу; ответы строит answersOf.
            body: body as never,
          }),
        );
        keys.settle(body);
        p.onAlert(null);
        return { kind: 'done', ...doneOfReceipt(r.message) };
      } catch (e) {
        const x = failedOutcome(e, def, { stop: p.onStop, alert: p.onAlert });
        if (!x.retry) keys.settle(body);
        return x.outcome;
      }
    },
  };

  return (
    <FormRender
      def={def}
      title={f.presentation?.title ?? def.pages[0]?.title ?? ''}
      settings={settingsOf(f.presentation)}
      tenantName={f.presentation?.organizationName ?? ''}
      kbLink={null}
      device="desktop"
      fill={hooks}
    />
  );
}
