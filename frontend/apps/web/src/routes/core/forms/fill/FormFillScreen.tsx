// W4.70 · «Заполнение формы» сотрудником (`form-fill`, `{origin}/forms/{id}` — Q-W4.00-forms-21; эталона нет, рендер —
// вкладка «Предпросмотр» W4.22 без панели, шапка — логотип и название организации, Q-W4.00-forms-19). Организация —
// из сессии: последняя выбранная, затем другие активные (Q-W4.70-1); без сессии — вход с возвратом (`?next=`).
// Действующая версия — `listFormVersions`, отправка — `submitFormResponse` с Idempotency-Key (повтор после «нет связи» —
// тот же ключ), файлы — core.files, варианты CRM — `listFormFieldOptions`. «Спасибо» — баллы сервера и ссылка на
// страницу «Базы знаний» правила со `showLink`.
import { type components, ProblemError, unwrap } from '@ortus/api-client';
import { format, forms as F } from '@ortus/texts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useMe } from '../../../../shell/me.ts';
import { problemText } from '../../../../shell/run.tsx';
import { formsKey, idemKeys, useRules, useVersions } from '../api.ts';
import { CRM } from '../model.ts';
import { type FillHooks, FormRender } from '../preview.tsx';
import { useOpenKb } from '../results/actions.tsx';
import { CrmSelect, FileField, FileStore } from './controls.tsx';
import {
  answersOf,
  doneOfResponse,
  gateOf,
  linkParamsOf,
  type Refusal,
  refusalOf,
  tenantOrder,
} from './model.ts';
import { FillAlert, FillFrame, FillLoading, FillState } from './parts.tsx';
import { failedOutcome, refusalView } from './submit.ts';
import { memberUploader } from './upload.ts';

type S = components['schemas'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Состояние отказа вместо формы; «Открыть заново» — `reopen`. */
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

/** Ошибка загрузки: отказ (не найдена, нет доступа) или «Не удалось загрузить форму: …» с «Повторить». */
function LoadFailed({ e, retry }: { e: unknown; retry: () => void }): ReactElement {
  const r = refusalOf(e);
  if (r && r.kind !== 'offline') return <Refused r={r} reopen={retry} />;
  return (
    <FillState
      icon="error"
      title={format(F.fill.loadError, { error: problemText(e) })}
      action={{ label: F.fill.retry, onClick: retry }}
    />
  );
}

export default function FormFillScreen(): ReactElement {
  const { formId = '' } = useParams({ strict: false }) as { formId?: string };
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const navigate = useNavigate();
  const api = useApi();
  const me = useMe();
  const unauth = me.error instanceof ProblemError && me.error.status === 401;
  const order = me.data ? tenantOrder(me.data) : [];
  const found = useQuery({
    queryKey: ['form-fill', formId, ...order],
    enabled: Boolean(me.data) && UUID.test(formId),
    retry: false,
    queryFn: async () => {
      let denied = false;
      for (const tenantId of order) {
        const r = await api.GET('/api/v1/tenants/{tenantId}/forms/{formId}', {
          params: { path: { tenantId, formId } },
        });
        if (r.response.ok && r.data) return { tenantId, form: r.data };
        if (r.response.status === 404) continue;
        if (r.response.status === 403) {
          denied = true;
          continue;
        }
        await unwrap(r);
      }
      throw new ProblemError(denied ? 403 : 404);
    },
  });
  const lost = unauth || (found.error instanceof ProblemError && found.error.status === 401);
  // Адрес возврата — тот, с которым открыли форму: пока грузится экран входа, адрес уже его (`?next=`).
  const [back] = useState(() => `/forms/${formId}${searchStr}`);
  const left = useRef(false);
  useEffect(() => {
    if (!lost || left.current) return;
    left.current = true;
    void navigate({ to: '/auth/login', search: { next: back } as never, replace: true });
  }, [lost, navigate, back]);

  let body: ReactNode;
  if (lost || me.isPending) body = <FillLoading />;
  else if (me.isError) body = <LoadFailed e={me.error} retry={() => void me.refetch()} />;
  else if (!UUID.test(formId)) body = <Refused r={{ kind: 'notFound' }} reopen={() => undefined} />;
  else if (found.isPending) body = <FillLoading />;
  else if (found.isError) body = <LoadFailed e={found.error} retry={() => void found.refetch()} />;
  else {
    const t = found.data;
    body = (
      <Fill
        tenantId={t.tenantId}
        form={t.form}
        tenantName={me.data.tenants.find((x) => x.tenantId === t.tenantId)?.name ?? ''}
        search={searchStr}
        reload={() => void found.refetch()}
      />
    );
  }
  return <FillFrame>{body}</FillFrame>;
}

function Fill(p: {
  tenantId: string;
  form: S['Form'];
  tenantName: string;
  search: string;
  reload: () => void;
}): ReactElement {
  const qc = useQueryClient();
  const f = p.form;
  const gate = gateOf(f, new Date());
  const open = gate === 'open';
  const versions = useVersions(p.tenantId, f.id, open);
  const rules = useRules(p.tenantId, f.id, open && f.settings.access !== 'public');
  const openKb = useOpenKb(p.tenantId);
  const [stop, setStop] = useState<Refusal | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  const reopen = () => {
    setStop(null);
    setAlert(null);
    void qc.invalidateQueries({ queryKey: formsKey(p.tenantId) });
    p.reload();
    setRun((n) => n + 1);
  };

  if (gate !== 'open') return <Refused r={{ kind: gate }} reopen={reopen} />;
  if (stop) return <Refused r={stop} reopen={reopen} />;
  if (versions.isPending) return <FillLoading />;
  if (versions.isError)
    return <LoadFailed e={versions.error} retry={() => void versions.refetch()} />;
  const version =
    versions.data.find((v) => v.current) ??
    versions.data.find((v) => v.id === f.publishedVersionId);
  if (!version) return <Refused r={{ kind: 'notFound' }} reopen={reopen} />;
  const kb = rules.data?.find((r) => r.kind === 'kb' && r.enabled && r.kb?.showLink && r.kb.node);
  const node = kb?.kb?.node;
  const kbLink = node ? (
    <button
      type="button"
      className="ox-ff-kb"
      onClick={() => void openKb(node.id).catch(() => undefined)}
    >
      {format(F.preview.kbLink, { title: node.title })}
    </button>
  ) : null;
  return (
    <>
      <FillAlert text={alert} />
      <FillRun
        key={`${version.id}:${run}`}
        tenantId={p.tenantId}
        form={f}
        version={version}
        tenantName={p.tenantName}
        search={p.search}
        kbLink={kbLink}
        onStop={setStop}
        onAlert={setAlert}
      />
    </>
  );
}

/** Рендер одной попытки заполнения: файлы, варианты CRM и ключи идемпотентности живут до «Открыть заново». */
function FillRun(p: {
  tenantId: string;
  form: S['Form'];
  version: S['FormVersion'];
  tenantName: string;
  search: string;
  kbLink: ReactNode;
  onStop: (r: Refusal) => void;
  onAlert: (t: string | null) => void;
}): ReactElement {
  const api = useApi();
  const { tenantId, form, version } = p;
  const [store] = useState(() => new FileStore(memberUploader(api, tenantId, form.id)));
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const [keys] = useState(idemKeys);
  const [refs] = useState(() => new Map<string, S['ObjectRef']>());
  const def = version.definition;

  const hooks: FillHooks = {
    control: (x, v, setV, a11y) => {
      if (x.type === 'photo') {
        return (
          <FileField
            x={x}
            store={store}
            maxMb={x.maxFileMb ?? 20}
            value={v}
            setV={setV}
            a11y={a11y}
          />
        );
      }
      if (CRM.includes(x.type)) {
        return (
          <CrmSelect
            x={x}
            tenantId={tenantId}
            formId={form.id}
            value={typeof v === 'string' ? v : ''}
            setV={setV}
            refs={refs}
            a11y={a11y}
          />
        );
      }
      return null;
    },
    submit: async (vals) => {
      const pending = store.pending();
      if (pending.length) {
        return {
          kind: 'errors',
          errs: Object.fromEntries(pending.map((k) => [k, F.fill.pending])),
        };
      }
      const all = { ...vals };
      for (const q of def.fields) if (q.type === 'photo') all[q.key] = store.ids(q.key);
      const link = linkParamsOf(def, p.search);
      const body: S['FormResponseCreate'] = {
        versionId: version.id,
        answers: answersOf(def, all, refs),
        ...(Object.keys(link).length ? { linkParams: link } : {}),
      };
      try {
        const r = await unwrap(
          await api.POST('/api/v1/tenants/{tenantId}/forms/{formId}/responses', {
            params: {
              path: { tenantId, formId: form.id },
              header: { 'Idempotency-Key': keys.key(body) },
            },
            // NullValue схемы (value: null) и тело запроса openapi-fetch расходятся по типу; ответы строит answersOf.
            body: body as never,
          }),
        );
        keys.settle(body);
        p.onAlert(null);
        return { kind: 'done', ...doneOfResponse(r.score, form.settings) };
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
      title={form.name}
      settings={form.settings}
      tenantName={p.tenantName}
      kbLink={p.kbLink}
      device="desktop"
      fill={hooks}
    />
  );
}
