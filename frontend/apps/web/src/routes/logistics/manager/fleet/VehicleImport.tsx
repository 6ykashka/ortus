// W2.50 · Экран «Импорт машин» (`logistics-vehicle-import`, no-reference — B-6; D-11 комплекта: заменитель интеграции
// учёта автопарка, ответ владельца 17.10): состояние страницы «Рабочее место логиста» `?import=vehicles` (ADR-0001).
// Образец — импорт людей S1-10: фирма по умолчанию, файл CSV → предпросмотр createVehicleImport (каждая строка
// проверена, данные не изменены) → «Применить» / «Применить без строк с ошибками» (commitVehicleImport по If-Match) →
// итог. Ошибки заголовка (422) и размера (413) — текстом сервера под полем файла.
import { format, shell } from '@ortus/texts';
import { Banner, Button, Field, Icon, Select } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useCallback, useEffect, useId, useRef, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useCan, useShell } from '../../../../shell/context.tsx';
import { useBusy, useRun } from '../../../../shell/run.tsx';
import { useOrgUnits } from '../../../../shell/scope.ts';
import { afterChange, idemKeys } from './api.ts';
import { commitImport, createImport, type Preview, readText } from './import-api.ts';
import {
  applyChoice,
  fileError,
  importUnits,
  isStale,
  MANAGE,
  resultText,
  type RowView,
  splitRows,
  STALE_CODES,
  type Stat,
  stripBom,
  summary,
} from './import-model.ts';
import type { Access } from './model.ts';
import { FLEET_TEXT } from './texts.ts';
import './import.css';

const T = FLEET_TEXT.import;
const APPLY = 'imp:apply';

function Stats({ items }: { items: readonly Stat[] }): ReactElement {
  return (
    <div className="ox-imp-stats">
      {items.map((s) => (
        <div key={s.key} className="ox-imp-stat" data-kind={s.key}>
          <span className="ox-imp-stat-value">{s.value}</span>
          <span className="ox-imp-stat-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function Rows({ label, rows }: { label: string; rows: readonly RowView[] }): ReactElement | null {
  if (!rows.length) return null;
  return (
    <div className="ox-imp-group">
      <h3 className="ox-imp-h3">{label}</h3>
      <ul aria-label={label} className="ox-imp-rows">
        {rows.map((r) => (
          <li key={r.line} className="ox-imp-row" data-tone={r.tone}>
            <div className="ox-imp-row-head">
              <span className="ox-imp-row-title">{r.title}</span>
              <span className="ox-imp-chip" data-tone={r.tone}>
                {r.action}
              </span>
            </div>
            {r.errors.length ? (
              <ul className="ox-imp-errors">
                {r.errors.map((e, i) => (
                  <li key={`${String(i)}-${e}`}>{e}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Кнопки без loading: после ответа они исчезают вместе с шагом, а объявление React Aria о «выполняется»
// (LiveAnnouncer, role=img по aria-labelledby) осталось бы без подписи — axe role-img-alt.

/** Заголовок нового шага получает фокус: экран сменился без перехода по маршруту. */
function useFocus<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (dep) ref.current?.focus();
  }, [dep]);
  return ref;
}

function Flow(p: { tenantId: string; access: Access; onBack: () => void }): ReactElement {
  const { tenantId } = p;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const applying = useBusy(APPLY);
  const fileId = useId();
  // Ключи идемпотентности проверки живут до «Загрузить другой файл» или ошибки применения: повтор «Проверить файл»
  // после «нет связи» не создаёт второй импорт, а тот же файл после применения или 409/412 — новый предпросмотр
  // (иначе сервер повторил бы старый ответ с устаревшим ETag — ревью W2.50-r1).
  const [keyOf, setKeyOf] = useState(idemKeys);
  const [unit, setUnit] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** Предпросмотр получен повторной проверкой после 412/409 на «Применить» — баннер над строками. */
  const [rechecked, setRechecked] = useState(false);
  const [result, setResult] = useState<Preview['imp'] | null>(null);
  const previewHead = useFocus<HTMLHeadingElement>(preview);
  const resultHead = useFocus<HTMLHeadingElement>(result);

  const { options, defaultId } = importUnits(p.access);
  const chosen = unit || defaultId;
  const fixed = options.length === 1 ? options[0]?.label : undefined;

  /** Новые ключи проверки: возвращает их, чтобы повторная проверка в том же обработчике шла уже ими. */
  const freshKeys = (): typeof keyOf => {
    const next = idemKeys();
    setKeyOf(() => next);
    return next;
  };

  const reset = (): void => {
    setPreview(null);
    setRechecked(false);
    setResult(null);
    setFile(null);
    setError(null);
    setInputKey((k) => k + 1);
    freshKeys();
  };

  /** createVehicleImport выбранного файла: предпросмотр или ошибка под полем файла. */
  const verify = async (f: File, keys: typeof keyOf): Promise<Preview> => {
    const csv = stripBom(await readText(f));
    const body = { fileName: f.name, csv, defaultOrgUnitId: chosen };
    return createImport(api, tenantId, body, keys(body));
  };

  const check = async (): Promise<void> => {
    if (checking) return;
    if (!file) {
      setError(T.noFile);
      return;
    }
    setError(null);
    setChecking(true);
    try {
      setPreview(await verify(file, keyOf));
      setRechecked(false);
    } catch (e) {
      setError(fileError(e));
    } finally {
      setChecking(false);
    }
  };

  /**
   * 412/409 на «Применить» — предпросмотр устарел (ревью W2.50-r2): тот же файл проверяется заново новым ключом,
   * баннер объясняет; не удалось — выбор файла и ошибка под полем.
   */
  const recheck = async (): Promise<void> => {
    const keys = freshKeys();
    if (!file) {
      reset();
      return;
    }
    setChecking(true);
    try {
      setPreview(await verify(file, keys));
      setRechecked(true);
    } catch (e) {
      reset();
      setError(fileError(e));
    } finally {
      setChecking(false);
    }
  };

  const apply = async (skipInvalidRows: boolean): Promise<void> => {
    if (!preview || applying || checking) return;
    try {
      const done = await run(
        APPLY,
        () => commitImport(api, tenantId, preview, skipInvalidRows),
        T.applied,
        { quiet: STALE_CODES },
      );
      setResult(done);
      setPreview(null);
      setRechecked(false);
    } catch (e) {
      // Прочие ошибки показал тост run; «нет связи» — повтор «Применить» с тем же ETag.
      if (isStale(e)) await recheck();
    } finally {
      await afterChange(qc, tenantId);
    }
  };

  if (result) {
    return (
      <div className="ox-imp-card">
        <h2 ref={resultHead} tabIndex={-1} className="ox-imp-h2">
          {T.done}
        </h2>
        <p className="ox-imp-p">{resultText(result)}</p>
        <Stats items={summary(result)} />
        <Rows label={T.errorRows} rows={splitRows(result).errors} />
        <div className="ox-imp-actions">
          <Button onPress={p.onBack}>{T.back}</Button>
          <Button variant="secondary" icon="upload_file" onPress={reset}>
            {T.another}
          </Button>
        </div>
      </div>
    );
  }

  if (preview) {
    const imp = preview.imp;
    const rows = splitRows(imp);
    const choice = applyChoice(imp);
    return (
      <div className="ox-imp-card">
        <h2 ref={previewHead} tabIndex={-1} className="ox-imp-h2">
          {format(T.preview, { file: imp.fileName })}
        </h2>
        {rechecked ? <Banner tone="warn" title={T.stale} text={T.staleText} /> : null}
        <p className="ox-imp-p">{T.note}</p>
        <Stats items={summary(imp)} />
        <Rows label={T.errorRows} rows={rows.errors} />
        <Rows label={T.validRows} rows={rows.valid} />
        {choice === 'none' ? <Banner tone="warn" title={T.nothing} /> : null}
        <div className="ox-imp-actions">
          {choice === 'none' ? null : (
            <Button
              icon="done_all"
              disabled={applying || checking}
              onPress={() => void apply(choice === 'skip')}
            >
              {applying ? T.applying : choice === 'skip' ? T.applySkip : T.apply}
            </Button>
          )}
          <Button variant="secondary" icon="upload_file" onPress={reset}>
            {T.another}
          </Button>
          <Button variant="secondary" onPress={p.onBack}>
            {T.back}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ox-imp-card">
      <p className="ox-imp-p ox-imp-columns">{T.columns}</p>
      {options.length > 1 ? (
        <div className="ox-imp-unit">
          <Field label={T.unit} required>
            <Select value={chosen} onChange={setUnit} options={options} />
          </Field>
        </div>
      ) : fixed ? (
        <p className="ox-imp-p">{format(T.unitFixed, { unit: fixed })}</p>
      ) : null}
      <div className="ox-imp-file">
        <label htmlFor={fileId} className="ox-imp-label">
          {T.file}
        </label>
        <div className="ox-imp-picker" data-invalid={error ? '' : undefined}>
          <input
            key={inputKey}
            id={fileId}
            type="file"
            accept=".csv,text/csv"
            className="ox-imp-input"
            aria-describedby={error ? `${fileId}-error` : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
          />
          {/* Видимая часть поля; имя файла и «не выбран» объявляет сам input. */}
          <span className="ox-imp-pick" aria-hidden="true">
            <Icon name="upload_file" size={18} />
            <span>{T.pick}</span>
          </span>
          <span
            className="ox-imp-picked"
            data-empty={file ? undefined : ''}
            aria-hidden="true"
            title={file?.name}
          >
            {file?.name ?? T.noFileChosen}
          </span>
        </div>
        {error ? (
          <div id={`${fileId}-error`} role="alert" className="ox-imp-error">
            <Icon name="error" size={18} />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
      <div className="ox-imp-actions">
        <Button icon="upload_file" disabled={checking} onPress={() => void check()}>
          {checking ? T.checking : T.check}
        </Button>
        <Button variant="secondary" onPress={p.onBack}>
          {T.back}
        </Button>
      </div>
    </div>
  );
}

export function VehicleImport(): ReactElement {
  const { tenantId: id, audience, readOnly, nav } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const owner = audience === 'owner';
  const allowed = owner || can(MANAGE);
  const units = useOrgUnits(tenantId, owner || can('org_units.read')).data ?? [];
  const navigate = useNavigate();
  const back = useCallback(
    () =>
      void navigate({
        to: '/t/$tenantId/$page',
        params: { tenantId, page: 'fleet' },
        search: {} as never,
      }),
    [navigate, tenantId],
  );

  let body: ReactElement;
  if (readOnly || !allowed) {
    body = (
      <>
        <Banner tone={readOnly ? 'neutral' : 'info'} title={readOnly ? T.readOnly : T.noRight} />
        <div className="ox-imp-actions">
          <Button variant="secondary" onPress={back}>
            {T.back}
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <Flow tenantId={tenantId} access={{ owner, caps: nav.capabilities, units }} onBack={back} />
    );
  }

  return (
    <section aria-labelledby="h-imp" className="ox-imp">
      <div className="ox-imp-head">
        <div className="ox-imp-crumb">{shell.nav.items.fleet}</div>
        <h1 id="h-imp" className="ox-imp-title" tabIndex={-1}>
          {T.title}
        </h1>
        <p className="ox-imp-intro">{T.intro}</p>
      </div>
      {body}
    </section>
  );
}
