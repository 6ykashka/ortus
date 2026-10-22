// W4.22 · «Предпросмотр» (`forms-preview`, dc:107–142, previewVM dc:1021–1059): «Телефон / Компьютер» (390 / 720
// px), «Предпросмотр черновика. Ответ не сохраняется.», «Заново», «Закрыть предпросмотр»; рендер формы — общий
// компонент `FormRender` (заполнение сотрудником и гостем — W4.28, Q-W4.00-forms-19): логотип и организация,
// название, «Страница i из n» и полоса, вопросы всех типов, проверки ввода (pvCheck), условия и перемешивание,
// «Назад / Далее / Отправить», «Спасибо…», ссылка на страницу БЗ правила, результат теста, «Пройти ещё раз».
import type { components } from '@ortus/api-client';
import { format, forms as F } from '@ortus/texts';
import { type ReactElement, useState } from 'react';

import {
  type Def,
  ordered,
  previewDefaults,
  pvCheck,
  pvPages,
  type Question,
  scoreOf,
  type Vals,
} from './model.ts';
import { Glyph } from './parts.tsx';

type S = components['schemas'];

const rnd = (): string => Math.random().toString(36).slice(2, 6);

/** Тип поля и клавиатура (IN dc:1028), подсказки (PH dc:1029). */
const IN: Partial<Record<Question['type'], readonly [type: string, mode: string]>> = {
  text: ['text', 'text'],
  email: ['email', 'email'],
  phone: ['tel', 'tel'],
  inn: ['text', 'numeric'],
  url: ['url', 'url'],
  number: ['text', 'decimal'],
  int: ['text', 'numeric'],
  money: ['text', 'decimal'],
};
const PH: Partial<Record<Question['type'], string>> = F.preview.placeholders;

type Device = 'phone' | 'desktop';

export function Preview(p: {
  def: Def;
  form: S['Form'];
  tenantName: string;
  rules: readonly S['FormRule'][];
  onClose: () => void;
}): ReactElement {
  const [device, setDevice] = useState<Device>('phone');
  const [run, setRun] = useState(() => rnd());
  const kb = p.rules.find((r) => r.kind === 'kb' && r.enabled && r.kb?.showLink && r.kb.node);
  const kbLink =
    kb?.kb?.node && p.form.settings.access !== 'public'
      ? format(F.preview.kbLink, { title: kb.kb.node.title })
      : null;
  return (
    <div className="ox-fm-pv">
      <div className="ox-fm-pv-bar">
        <div role="group" aria-label={F.preview.devicesAria} className="ox-fm-seg ox-fm-pv-devices">
          {(
            [
              ['phone', 'smartphone'],
              ['desktop', 'desktop_windows'],
            ] as const
          ).map(([k, icon]) => (
            <button key={k} type="button" aria-pressed={device === k} onClick={() => setDevice(k)}>
              <Glyph name={icon} size={18} />
              {F.preview.devices[k]}
            </button>
          ))}
        </div>
        <span className="ox-fm-pv-note">{F.preview.note}</span>
        <div className="ox-fm-pv-actions">
          <button type="button" className="ox-fm-btn" data-size="38" onClick={() => setRun(rnd())}>
            <Glyph name="restart_alt" size={18} />
            {F.preview.restart}
          </button>
          <button type="button" className="ox-fm-btn" data-size="38" onClick={p.onClose}>
            {F.preview.close}
          </button>
        </div>
      </div>
      <FormRender
        key={run}
        def={p.def}
        title={p.form.name}
        settings={p.form.settings}
        tenantName={p.tenantName}
        kbLink={kbLink}
        device={device}
        onRestart={() => setRun(rnd())}
      />
    </div>
  );
}

interface RenderState {
  page: number;
  vals: Record<string, string | string[]>;
  errs: Record<string, string>;
  done: boolean;
}

/**
 * Рендер формы (dc:114–140): ответ в памяти; «Отправить» после проверок показывает «Спасибо». `onSubmit` (W4.28) —
 * отправка ответа вместо демонстрационного завершения.
 */
export function FormRender(p: {
  def: Def;
  title: string;
  settings: S['FormSettings'];
  tenantName: string;
  kbLink: string | null;
  device: Device;
  onRestart: () => void;
}): ReactElement {
  const [seed] = useState(rnd);
  const [st, setSt] = useState<RenderState>(() => ({
    page: 0,
    vals: previewDefaults(p.def),
    errs: {},
    done: false,
  }));
  const S = p.settings;
  const vals: Vals = st.vals;
  const pages = pvPages(p.def, vals, seed);
  const pi = Math.min(st.page, Math.max(0, pages.length - 1));
  const cur = pages[pi];
  const last = pi >= pages.length - 1;
  const tenant = p.tenantName || F.preview.org;
  const setV = (id: string, v: string | string[]) =>
    setSt((s) => ({
      ...s,
      vals: { ...s.vals, [id]: v },
      errs: Object.fromEntries(Object.entries(s.errs).filter(([k]) => k !== id)),
    }));

  const next = () => {
    const errs: Record<string, string> = {};
    for (const x of cur?.qs ?? []) {
      const e = pvCheck(x, vals[x.key]);
      if (e) errs[x.key] = e;
    }
    if (Object.keys(errs).length) {
      setSt((s) => ({ ...s, errs }));
      return;
    }
    setSt((s) => (last ? { ...s, errs: {}, done: true } : { ...s, errs: {}, page: s.page + 1 }));
  };

  const sc = st.done && S.scoring ? scoreOf(p.def, vals) : null;
  const pass = S.passScore;
  const passed = sc && pass !== null ? sc.got >= pass : true;
  const scoreText = sc
    ? pass === null
      ? format(F.preview.score, { got: sc.got, max: sc.max })
      : format(passed ? F.preview.scorePassed : F.preview.scoreFailed, {
          got: sc.got,
          max: sc.max,
          p: pass,
        })
    : '';

  return (
    <div className="ox-fm-pv-card" data-device={p.device}>
      {S.showLogo ? (
        <div className="ox-fm-pv-logo">
          <span aria-hidden="true">{tenant.trim().charAt(0).toUpperCase()}</span>
          {tenant}
        </div>
      ) : null}
      <h2 className="ox-fm-pv-title">{p.title}</h2>
      {S.progressBar && !st.done && pages.length > 1 ? (
        <div className="ox-fm-pv-progress">
          <span>{format(F.preview.progress, { i: pi + 1, n: pages.length })}</span>
          <div className="ox-fm-pv-bar-track">
            <div
              style={{ width: `${Math.round(((pi + 1) / Math.max(1, pages.length)) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
      {st.done ? (
        <div className="ox-fm-pv-done">
          <Glyph name="task_alt" size={44} />
          <strong>{S.confirmationText || F.preview.thanks}</strong>
          {p.kbLink ? (
            <span className="ox-fm-pv-kb">
              <Glyph name="menu_book" size={18} />
              {p.kbLink}
            </span>
          ) : null}
          {sc && S.showScore ? (
            <span className="ox-fm-pv-score" data-tone={passed ? 'ok' : 'warn'}>
              {scoreText}
            </span>
          ) : null}
          <button type="button" className="ox-fm-btn" onClick={p.onRestart}>
            {F.preview.again}
          </button>
        </div>
      ) : (
        <>
          {cur && pages.length > 1 && cur.page.title ? (
            <h3 className="ox-fm-pv-page">{cur.page.title}</h3>
          ) : null}
          {(cur?.qs ?? []).map((x) => (
            <Field key={x.key} x={x} vals={st.vals} err={st.errs[x.key]} seed={seed} setV={setV} />
          ))}
          {!cur ? <p className="ox-fm-pv-empty">{F.preview.empty}</p> : null}
          <div className="ox-fm-pv-nav">
            {pi > 0 && S.backButton ? (
              <button
                type="button"
                className="ox-fm-btn"
                data-size="44"
                onClick={() => setSt((s) => ({ ...s, page: Math.max(0, pi - 1), errs: {} }))}
              >
                {F.preview.back}
              </button>
            ) : null}
            <span className="ox-fm-fill" />
            <button
              type="button"
              className="ox-fm-btn"
              data-variant="primary"
              data-size="next"
              onClick={next}
            >
              {last ? F.preview.submit : F.preview.next}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  x,
  vals,
  err,
  seed,
  setV,
}: {
  x: Question;
  vals: RenderState['vals'];
  err: string | undefined;
  seed: string;
  setV: (id: string, v: string | string[]) => void;
}): ReactElement {
  const t = x.type;
  const v = vals[x.key];
  const errId = `fm-pv-err-${x.key}`;
  if (t === 'statement') {
    return (
      <div className="ox-fm-pv-q">
        <p className="ox-fm-pv-statement">{x.label}</p>
      </div>
    );
  }
  const desc = err ? { 'aria-invalid': true as const, 'aria-describedby': errId } : {};
  let control: ReactElement | null = null;
  const inp = IN[t];
  if (inp || t === 'date') {
    control = (
      <input
        className="ox-fm-pv-input"
        type={t === 'date' ? (x.withTime ? 'datetime-local' : 'date') : inp?.[0]}
        inputMode={
          (t === 'date' ? 'none' : inp?.[1]) as React.HTMLAttributes<HTMLInputElement>['inputMode']
        }
        value={typeof v === 'string' ? v : ''}
        placeholder={PH[t] ?? ''}
        aria-label={x.label}
        data-error={err ? '' : undefined}
        onChange={(e) => setV(x.key, e.target.value)}
        {...desc}
      />
    );
  } else if (t === 'longtext') {
    control = (
      <textarea
        className="ox-fm-pv-area"
        rows={3}
        value={typeof v === 'string' ? v : ''}
        aria-label={x.label}
        data-error={err ? '' : undefined}
        onChange={(e) => setV(x.key, e.target.value)}
        {...desc}
      />
    );
  } else if (t === 'choice' || t === 'multi' || t === 'bool') {
    const multi = t === 'multi';
    const list: [string, string][] =
      t === 'bool'
        ? [
            ['true', F.builder.card.bool.yes],
            ['false', F.builder.card.bool.no],
          ]
        : ordered(x.options ?? [], x.optionOrder, seed).map((o) => [o.key, o.label]);
    const cv = multi ? (Array.isArray(v) ? v : []) : v;
    const flex =
      x.optionView === 'tiles' ? 'tiles' : x.optionView === 'row' || t === 'bool' ? 'row' : 'list';
    control = (
      <>
        <div
          role={multi ? 'group' : 'radiogroup'}
          aria-label={x.label}
          className="ox-fm-pv-opts"
          {...desc}
        >
          {list.map(([val, l]) => {
            const a = multi ? (cv as string[]).includes(val) : cv === val;
            return (
              <button
                key={val}
                type="button"
                role={multi ? 'checkbox' : 'radio'}
                aria-checked={a}
                className="ox-fm-pv-opt"
                data-flex={flex}
                data-on={a ? '' : undefined}
                onClick={() =>
                  setV(
                    x.key,
                    multi
                      ? a
                        ? (cv as string[]).filter((k) => k !== val)
                        : [...(cv as string[]), val]
                      : val,
                  )
                }
              >
                <Glyph
                  name={
                    multi
                      ? a
                        ? 'check_box'
                        : 'check_box_outline_blank'
                      : a
                        ? 'radio_button_checked'
                        : 'radio_button_unchecked'
                  }
                  size={20}
                />
                {l}
              </button>
            );
          })}
        </div>
        {x.otherOption ? (
          <input
            className="ox-fm-pv-other"
            value={
              typeof vals[`${x.key}__other`] === 'string' ? (vals[`${x.key}__other`] as string) : ''
            }
            placeholder={F.preview.other}
            aria-label={F.preview.otherAria}
            onChange={(e) => setV(`${x.key}__other`, e.target.value)}
          />
        ) : null}
      </>
    );
  } else if (t === 'select' || t === 'person' || t === 'unit' || t === 'ref') {
    const choices = t === 'select' ? ordered(x.options ?? [], x.optionOrder, seed) : [];
    control = (
      <select
        className="ox-fm-pv-select"
        value={typeof v === 'string' ? v : ''}
        aria-label={x.label}
        data-error={err ? '' : undefined}
        onChange={(e) => setV(x.key, e.target.value)}
        {...desc}
      >
        <option value="">{F.preview.choose}</option>
        {choices.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (t === 'scale' || t === 'rating') {
    const stars = t === 'rating';
    const a0 = stars ? 1 : (x.scaleMin ?? 1);
    const a1 = stars ? 5 : (x.scaleMax ?? 5);
    const cv = Number(v);
    const arr: number[] = [];
    for (let k = a0; k <= a1; k++) arr.push(k);
    control = (
      <>
        <div role="radiogroup" aria-label={x.label} className="ox-fm-pv-scale" {...desc}>
          {arr.map((k) => {
            const on = v !== undefined && v !== '' && (stars ? cv >= k : cv === k);
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={v !== undefined && v !== '' && cv === k}
                aria-label={stars ? format(F.preview.star, { k }) : String(k)}
                className="ox-fm-pv-scale-btn"
                data-stars={stars ? '' : undefined}
                data-on={on ? '' : undefined}
                onClick={() => setV(x.key, String(k))}
              >
                {stars ? (
                  <span
                    className="material-symbols-rounded"
                    aria-hidden="true"
                    style={{ fontSize: '28px', fontVariationSettings: `'FILL' ${on ? 1 : 0}` }}
                  >
                    star
                  </span>
                ) : (
                  k
                )}
              </button>
            );
          })}
        </div>
        {!stars && (x.scaleLeftLabel || x.scaleRightLabel) ? (
          <div className="ox-fm-pv-ends">
            <span>{x.scaleLeftLabel ?? ''}</span>
            <span>{x.scaleRightLabel ?? ''}</span>
          </div>
        ) : null}
      </>
    );
  } else if (t === 'photo') {
    const n = Number(v) || 0;
    const mx = x.maxFiles ?? 5;
    control = (
      <div className="ox-fm-pv-file">
        <button
          type="button"
          className="ox-fm-pv-attach"
          onClick={() => setV(x.key, n >= mx ? String(mx) : String(n + 1))}
        >
          <Glyph name="attach_file" size={18} />
          {F.preview.attach}
        </button>
        <span>
          {n
            ? format(F.preview.files, { n, max: mx })
            : format(F.preview.filesNone, { max: mx, mb: x.maxFileMb ?? 20 })}
        </span>
      </div>
    );
  }
  return (
    <div className="ox-fm-pv-q">
      <span className="ox-fm-pv-label">
        {x.label}
        {x.required ? <span className="ox-fm-req"> *</span> : null}
      </span>
      {x.hint?.trim() ? <span className="ox-fm-pv-hint">{x.hint}</span> : null}
      {control}
      {err ? (
        <span role="alert" id={errId} className="ox-fm-pv-err">
          {err}
        </span>
      ) : null}
    </div>
  );
}
