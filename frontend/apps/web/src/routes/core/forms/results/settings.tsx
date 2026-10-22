// W4.23 · Вкладка «Настройки» формы (`forms-settings`; эталон design-2026-10-19 «Формы и опросы.dc.html» dc:287–323,
// settingsVM dc:880–898; разбор forms.md §1.6): «Кто может ответить», «Область формы», «Приём ответов», «Тест с
// баллами», «Вид формы». Флажки и списки сохраняются сразу, поля — по потере фокуса (dc:884) — `updateForm` с
// If-Match по ETag формы. Ошибка сервера — `role=alert` над карточками (dc:289). Без «Настраивать» — только чтение.
import { format, formsResults as F } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  useCallback,
  useRef,
  useState,
} from 'react';

import {
  commands,
  etagOf,
  type FormRead,
  formsKey,
  useDraft,
  ifMatchOf,
  useForm,
  useUnitsQuery,
  useVersions,
} from './api.ts';
import { Failed, Glyph, Pending, useApi, useCmd } from './ctx.tsx';
import {
  type Access,
  accessOptions,
  areaOptions,
  crmQuestions,
  type Form,
  maxScore,
  numOrNull,
  type Unit,
} from './model.ts';
import { FR_TEXT } from './texts.ts';
import './results.css';

type Settings = Form['settings'];

/** Очередь команд: следующая начинается после ответа на предыдущую (ETag — с последнего ответа). */
function useQueue(): (fn: () => Promise<void>) => Promise<void> {
  const chain = useRef<Promise<void>>(Promise.resolve());
  return useCallback((fn: () => Promise<void>) => {
    const next = chain.current.then(fn);
    chain.current = next.catch(() => undefined);
    return next;
  }, []);
}
type Draftable = 'responseLimit' | 'confirmationText' | 'passScore';

/** Стрелки группы радиокнопок: вниз и вправо — следующий режим, вверх и влево — предыдущий. */
const ARROW_STEP: Readonly<Record<string, number>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/** Подразделения «Области формы»: регион — «· регион», остальные — «· фирма» (dc:891). */
export function useUnits(tenantId: string): Unit[] {
  const q = useUnitsQuery(tenantId);
  return (q.data ?? [])
    .filter((u) => u.status === 'active')
    .map((u) => ({ id: u.id, name: u.name, kind: u.kind === 'region' ? 'region' : 'firm' }));
}

export function SettingsTab({
  tenantId,
  formId,
}: {
  tenantId: string;
  formId: string;
}): ReactElement {
  const api = useApi();
  const fq = useForm(tenantId, formId);
  const draft = useDraft(tenantId, formId);
  const versions = useVersions(tenantId, formId);
  const units = useUnits(tenantId);
  const { cmd } = useCmd(tenantId);
  const [err, setErr] = useState('');
  const [text, setText] = useState<Partial<Record<Draftable, string>>>({});
  const [pend, setPend] = useState<Partial<Settings>>({});
  const enqueue = useQueue();
  const qc = useQueryClient();
  const formKey = [...formsKey(tenantId), 'form', formId];

  // Ошибка без данных — карточка ошибки; ошибка перечитывания при данных в кэше вкладку не роняет.
  if (!fq.data)
    return <div className="ox-fr-st">{fq.isError ? <Failed q={fq} /> : <Pending rows={3} />}</div>;
  const f = fq.data.form;
  const etag = ifMatchOf(fq.data);
  // Значения на экране: отправленные, но ещё без ответа сервера, — сразу (как setS эталона).
  const S = { ...f.settings, ...pend } as Settings;
  const ro = !f.my.manage;
  const current = versions.data?.find((v) => v.current)?.definition;
  const crm = crmQuestions([draft.data?.draft.definition, current]);
  const L = F.settings;

  /**
   * Правки идут по очереди (флажок, список и поле подряд): каждая — с ETag последнего ответа сервера, иначе вторая
   * получила бы 412. Значение показывается сразу (`pend`) и сменяется ответом сервера.
   */
  const save = (patch: Parameters<typeof commands.updateForm>[4], ok: string | null = null) => {
    if (ro) return;
    setErr('');
    return enqueue(async () => {
      const read = qc.getQueryData<FormRead>(formKey);
      const cur = read ? ifMatchOf(read) : etag;
      const r = await cmd(
        ['updateForm', patch],
        (key) => commands.updateForm(api, tenantId, formId, cur, patch, key),
        ok,
        // Ответ updateForm — новая форма: она кладётся в кэш ниже; черновик и версии настройки не меняют.
        { onError: setErr, refresh: [[...formsKey(tenantId), 'list']] },
      );
      if (r.ok && r.data)
        qc.setQueryData<FormRead>(formKey, { form: r.data, etag: etagOf(r.data.revision) });
    });
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setPend((x) => ({ ...x, [k]: v }));
    return save({ settings: { [k]: v } as Partial<Settings> })?.finally(() =>
      setPend((x) => Object.fromEntries(Object.entries(x).filter(([y]) => y !== k))),
    );
  };
  const val = (k: Draftable): string => text[k] ?? (S[k] == null ? '' : String(S[k]));
  const draftOf = (k: Draftable) => (e: { target: { value: string } }) =>
    setText((t) => ({ ...t, [k]: e.target.value }));
  const commit = (k: Draftable) => () => {
    const raw = text[k];
    if (raw === undefined) return;
    setText((t) => Object.fromEntries(Object.entries(t).filter(([x]) => x !== k)));
    const v = k === 'confirmationText' ? raw : numOrNull(raw);
    if (String(v ?? '') !== String(S[k] ?? '')) void set(k, v as never);
  };
  const chk =
    (
      k:
        | 'onePerMember'
        | 'allowEditBeforeReview'
        | 'scoring'
        | 'showScore'
        | 'showLogo'
        | 'progressBar'
        | 'backButton',
    ) =>
    (e: { target: { checked: boolean } }) =>
      void set(k, e.target.checked);

  const access = accessOptions(f, crm, ro, FR_TEXT.inviteLater);
  const pick = (a: Access) => {
    if (a === 'invite') return;
    void set('access', a);
  };
  // Шаблон ARIA radiogroup: одна остановка Tab — выбранный режим (нет выбранного доступного — первый доступный),
  // стрелки — следующий доступный режим по кругу, фокус и выбор.
  const stop = access.find((a) => a.sel && !a.off)?.value ?? access.find((a) => !a.off)?.value;
  const onArrow = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_STEP[e.key];
    if (!step) return;
    const on = access.filter((a) => !a.off);
    const at = on.findIndex((a) => a.value === (e.target as HTMLElement).dataset.value);
    const next = on[(Math.max(at, 0) + step + on.length) % on.length];
    if (!next) return;
    e.preventDefault();
    e.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
    if (!next.sel) pick(next.value);
  };
  const max = maxScore(draft.data?.draft.definition ?? current);

  return (
    <div className="ox-fr-st">
      {err ? (
        <div role="alert" className="ox-fr-st-err">
          {err}
        </div>
      ) : null}
      <section className="ox-fr-card">
        <h3>{L.access.title}</h3>
        <div
          role="radiogroup"
          aria-label={L.access.aria}
          className="ox-fr-radios"
          onKeyDown={onArrow}
        >
          {access.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={a.sel}
              data-value={a.value}
              tabIndex={a.value === stop ? 0 : -1}
              disabled={a.off}
              title={a.why}
              className="ox-fr-radio"
              data-sel={a.sel || undefined}
              onClick={() => !a.off && !a.sel && pick(a.value)}
            >
              <Glyph
                name={a.sel ? 'radio_button_checked' : 'radio_button_unchecked'}
                size={20}
                className="ox-fr-radio-dot"
              />
              <span className="ox-fr-radio-body">
                <strong>{a.label}</strong>
                <span>{a.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <label className="ox-fr-field">
          {L.area.label}
          <select
            value={f.orgUnitId ?? ''}
            disabled={ro}
            onChange={(e) => void save({ orgUnitId: e.target.value || null }, L.area.toast)}
          >
            {areaOptions(units).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {f.orgUnitId && !units.some((u) => u.id === f.orgUnitId) ? (
              <option value={f.orgUnitId}>{f.orgUnitId}</option>
            ) : null}
          </select>
        </label>
        <span className="ox-fr-note">{L.area.note}</span>
      </section>
      <section className="ox-fr-card">
        <h3>{L.intake.title}</h3>
        <label className="ox-fr-row">
          <span>{L.intake.until}</span>
          <input
            type="date"
            value={S.acceptUntil ?? ''}
            disabled={ro}
            onChange={(e) => void set('acceptUntil', e.target.value || null)}
          />
        </label>
        <label className="ox-fr-row">
          <span>{L.intake.limit}</span>
          <input
            inputMode="numeric"
            className="ox-fr-num"
            value={val('responseLimit')}
            disabled={ro}
            placeholder={L.intake.limitPh}
            onChange={draftOf('responseLimit')}
            onBlur={commit('responseLimit')}
          />
        </label>
        <label className="ox-fr-check">
          <input
            type="checkbox"
            checked={S.onePerMember}
            disabled={ro}
            onChange={chk('onePerMember')}
          />
          {L.intake.one}
        </label>
        <label className="ox-fr-check">
          <input
            type="checkbox"
            checked={S.allowEditBeforeReview}
            disabled={ro}
            onChange={chk('allowEditBeforeReview')}
          />
          {L.intake.allowEdit}
        </label>
        <label className="ox-fr-field">
          {L.intake.thanks}
          <textarea
            rows={2}
            value={val('confirmationText')}
            disabled={ro}
            onChange={draftOf('confirmationText')}
            onBlur={commit('confirmationText')}
          />
        </label>
        <label className="ox-fr-row">
          <span>{L.intake.retain}</span>
          <select
            value={String(S.retainResponsesDays)}
            disabled={ro}
            onChange={(e) =>
              void set(
                'retainResponsesDays',
                Number(e.target.value) as Settings['retainResponsesDays'],
              )
            }
          >
            <option value="90">{L.intake.d90}</option>
            <option value="365">{L.intake.d365}</option>
            <option value="1095">{L.intake.d1095}</option>
          </select>
        </label>
      </section>
      <section className="ox-fr-card">
        <h3>{L.quiz.title}</h3>
        <label className="ox-fr-check">
          <input type="checkbox" checked={S.scoring} disabled={ro} onChange={chk('scoring')} />
          {L.quiz.on}
        </label>
        {S.scoring ? (
          <>
            <span className="ox-fr-quiz-max">{format(L.quiz.max, { n: max })}</span>
            <label className="ox-fr-row">
              <span>{L.quiz.pass}</span>
              <input
                inputMode="numeric"
                className="ox-fr-num ox-fr-num-sm"
                value={val('passScore')}
                disabled={ro}
                placeholder={L.quiz.passPh}
                onChange={draftOf('passScore')}
                onBlur={commit('passScore')}
              />
            </label>
            <label className="ox-fr-check">
              <input
                type="checkbox"
                checked={S.showScore}
                disabled={ro}
                onChange={chk('showScore')}
              />
              {L.quiz.show}
            </label>
          </>
        ) : null}
        <span className="ox-fr-note">{L.quiz.note}</span>
      </section>
      <section className="ox-fr-card" data-tight="">
        <h3>{L.look.title}</h3>
        <label className="ox-fr-check">
          <input type="checkbox" checked={S.showLogo} disabled={ro} onChange={chk('showLogo')} />
          {L.look.logo}
        </label>
        <label className="ox-fr-check">
          <input
            type="checkbox"
            checked={S.progressBar}
            disabled={ro}
            onChange={chk('progressBar')}
          />
          {L.look.progress}
        </label>
        <label className="ox-fr-check">
          <input
            type="checkbox"
            checked={S.backButton}
            disabled={ro}
            onChange={chk('backButton')}
          />
          {L.look.back}
        </label>
        <span className="ox-fr-note">{L.look.note}</span>
      </section>
    </div>
  );
}
