// W4.12 · «Проекты» (`tasks-projects`, эталон «Задачи и проекты.dc.html» ЗП:24–47, :352–362) и панель «Новый проект»
// (`tasks-project-new`, ЗП:48–71, :356–373). Список — listTaskProjects (403 прораба — пусто, Q-W4.03-8); кнопка
// «Новый проект» — у кого tasks.projects.manage в организации или подразделении (PD-53); создание —
// createTaskProject, ошибки сервера — в форме дословно, после создания открываются «Участники» проекта.
import type { components } from '@ortus/api-client';
import { format, shell, tasks as T } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { createProject } from './api.ts';
import { autoKey, projectRows } from './model.ts';
import { detailOf, useTasksRun } from './run.ts';
import { TASKS_TEXT } from './texts.ts';

type S = components['schemas'];
type Access = S['TaskProjectAccessLevel'];
type Process = 'simple' | 'approval' | 'copy';

/** Подразделение для «Области проекта»: регион — «· регион», остальные — «· фирма» (:366). */
export interface UnitOption {
  id: string;
  name: string;
  region: boolean;
}

const ACCESS: readonly Access[] = ['open', 'limited', 'closed'];
const PROCESSES: readonly Process[] = ['simple', 'approval', 'copy'];
const ORG = 'org';

interface Wizard {
  name: string;
  key: string;
  unit: string;
  access: Access;
  process: Process;
  copyFrom: string;
  err: string | null;
  busy: boolean;
}

const descOf = (a: Access): string => (a === 'closed' ? TASKS_TEXT.closedDesc : T.accessDesc[a]);

/** Панель «Новый проект» (ЗП:48–71). */
function NewProject(p: {
  tenantId: string;
  units: readonly UnitOption[];
  copies: readonly S['Project'][];
  onClose: () => void;
  onCreated: (project: S['Project']) => void;
}): ReactElement {
  const api = useApi();
  const run = useTasksRun();
  const [w, setW] = useState<Wizard>(() => ({
    name: '',
    key: '',
    unit: p.units.find((u) => !u.region)?.id ?? ORG,
    access: 'limited',
    process: 'simple',
    copyFrom: p.copies[0]?.id ?? '',
    err: null,
    busy: false,
  }));
  const set = (o: Partial<Wizard>): void => setW((x) => ({ ...x, ...o, err: null }));

  const create = async (): Promise<void> => {
    setW((x) => ({ ...x, busy: true }));
    const name = w.name.trim();
    try {
      const project = await run(
        'tasks:project',
        () =>
          createProject(api, p.tenantId, {
            name: w.name,
            key: w.key,
            orgUnitId: w.unit === ORG ? null : w.unit,
            access: w.access,
            workflowKey: w.process,
            ...(w.process === 'copy' && w.copyFrom ? { copyFromProjectId: w.copyFrom } : {}),
          }),
        format(T.wizard.created, { name }),
        { inline: true },
      );
      p.onCreated(project);
    } catch (e) {
      setW((x) => ({ ...x, busy: false, err: detailOf(e) }));
    }
  };

  const note = T.wizard.notes[w.process];
  return (
    <div className="ox-tk-wiz">
      <div className="ox-tk-wiz-head">
        <h3 className="ox-tk-wiz-title">{T.projects.create}</h3>
        <span className="ox-tk-spacer" />
        <button
          type="button"
          className="ox-tk-icon-btn ox-tk-hit"
          aria-label={shell.modal.close}
          onClick={p.onClose}
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="ox-tk-wiz-grid">
        <label className="ox-tk-field">
          {T.wizard.name}
          <input
            className="ox-tk-input"
            value={w.name}
            placeholder={T.wizard.namePlaceholder}
            onChange={(e) => {
              const v = e.target.value;
              const auto = !w.key || w.key === autoKey(w.name);
              set({ name: v, ...(auto ? { key: autoKey(v) } : {}) });
            }}
          />
        </label>
        <label className="ox-tk-field">
          {T.wizard.key}
          <input
            className="ox-tk-input ox-tk-keyinput"
            value={w.key}
            maxLength={6}
            onChange={(e) => set({ key: e.target.value.toUpperCase() })}
          />
        </label>
      </div>
      <span className="ox-tk-keyhint">
        {format(T.wizard.keyHint, { key: w.key || T.wizard.keyStub })}
      </span>
      <label className="ox-tk-field">
        {T.wizard.unit}
        <select
          className="ox-tk-select"
          value={w.unit}
          onChange={(e) => set({ unit: e.target.value })}
        >
          <option value={ORG}>{T.projects.wholeOrg}</option>
          {p.units.map((u) => (
            <option key={u.id} value={u.id}>
              {format(u.region ? T.wizard.region : T.wizard.firm, { name: u.name })}
            </option>
          ))}
        </select>
        <span className="ox-tk-field-hint">{T.wizard.unitHint}</span>
      </label>
      <div role="radiogroup" aria-label={T.wizard.who} className="ox-tk-radios">
        <span className="ox-tk-field-label">{T.wizard.who}</span>
        {ACCESS.map((a) => {
          const sel = w.access === a;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={sel ? 'true' : 'false'}
              className="ox-tk-radio"
              onClick={() => set({ access: a })}
            >
              <Icon name={sel ? 'radio_button_checked' : 'radio_button_unchecked'} size={20} />
              <span className="ox-tk-radio-text">
                <strong>{T.access[a]}</strong>
                <span>{descOf(a)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="ox-tk-proc">
        <span className="ox-tk-field-label">{T.wizard.process}</span>
        <div role="group" aria-label={T.wizard.process} className="ox-tk-seg">
          {PROCESSES.map((k) => (
            <button
              key={k}
              type="button"
              className="ox-tk-seg-btn ox-tk-hit"
              aria-pressed={w.process === k ? 'true' : 'false'}
              onClick={() => set({ process: k })}
            >
              {T.wizard.processes[k]}
            </button>
          ))}
        </div>
        {w.process === 'copy' ? (
          <select
            className="ox-tk-select"
            aria-label={T.wizard.copyFrom}
            value={w.copyFrom}
            onChange={(e) => set({ copyFrom: e.target.value })}
          >
            {p.copies.map((x) => (
              <option key={x.id} value={x.id}>
                {format(T.wizard.copyOption, {
                  key: x.key,
                  name: x.name,
                  v: x.workflow?.version ?? 1,
                })}
              </option>
            ))}
          </select>
        ) : null}
        <span className="ox-tk-field-hint">{note}</span>
      </div>
      {w.err ? (
        <span role="alert" className="ox-tk-err">
          {w.err}
        </span>
      ) : null}
      <div className="ox-tk-actions">
        <button type="button" className="ox-tk-btn ox-tk-hit" onClick={p.onClose}>
          {shell.modal.cancel}
        </button>
        <button
          type="button"
          className="ox-tk-primary ox-tk-hit"
          disabled={w.busy}
          onClick={() => void create()}
        >
          {T.wizard.submit}
        </button>
      </div>
      <span className="ox-tk-muted12">{T.wizard.owner}</span>
    </div>
  );
}

/** Список проектов (ЗП:24–47). */
export function ProjectsList(p: {
  tenantId: string;
  projects: readonly S['Project'][];
  /** Загрузка или ошибка списка — вместо таблицы и подсказки. */
  status: ReactElement | null;
  units: ReadonlyMap<string, string>;
  unitOptions: readonly UnitOption[];
  canNew: boolean;
  onOpen: (project: S['Project']) => void;
  onCreated: (project: S['Project']) => void;
}): ReactElement {
  const [wiz, setWiz] = useState(false);
  const newBtn = useRef<HTMLButtonElement>(null);
  const rows = projectRows(p.projects, p.units);
  /** «Отмена» и «Закрыть» панели — фокус обратно на «Новый проект» (PD-29). */
  const closeWiz = (): void => {
    setWiz(false);
    newBtn.current?.focus();
  };
  const copies = p.projects.filter((x) => x.flow !== 'leads' && x.workflow);
  return (
    <>
      <div className="ox-tk-head">
        <h2 id="h-tasks" className="ox-tk-h2" tabIndex={-1}>
          {T.projects.title}
        </h2>
        <span className="ox-tk-note">{T.projects.note}</span>
        <span className="ox-tk-spacer" />
        {p.canNew ? (
          <button
            ref={newBtn}
            type="button"
            className="ox-tk-primary ox-tk-hit"
            data-icon=""
            onClick={() => setWiz(true)}
          >
            <Icon name="add" size={18} />
            {T.projects.create}
          </button>
        ) : null}
      </div>
      <div className="ox-tk-plist">
        <div className="ox-tk-pmain">
          {p.status ?? (
            <>
              {/* Пустой список (прораб) на телефоне прокручивается по шапке, а фокусируемых строк нет — контейнер
                  сам в порядке Tab (axe scrollable-region-focusable); со строками фокус получают строки. */}
              <div
                className="ox-tk-table"
                {...(rows.length
                  ? {}
                  : {
                      role: 'region',
                      'aria-label': TASKS_TEXT.projectsTable,
                      tabIndex: 0,
                      'data-a11y-extra': '',
                    })}
              >
                <div className="ox-tk-thead">
                  <span>{T.projects.cols.project}</span>
                  <span>{T.projects.cols.unit}</span>
                  <span>{T.projects.cols.access}</span>
                  <span>{T.projects.cols.people}</span>
                  <span>{T.projects.cols.open}</span>
                </div>
                {rows.map((r, i) => (
                  <button
                    key={r.id}
                    type="button"
                    className="ox-tk-prow"
                    onClick={() => p.onOpen(p.projects[i] as S['Project'])}
                  >
                    <span className="ox-tk-pname">
                      <span className="ox-tk-key">{r.key}</span>
                      <span className="ox-tk-pname-text">
                        <strong>{r.name}</strong>
                        <span>{r.sub}</span>
                      </span>
                    </span>{' '}
                    <span className="ox-tk-punit">{r.unit}</span>{' '}
                    <span className="ox-tk-acc" data-access={r.access}>
                      <Icon name={r.accessIcon} size={15} />
                      {r.accessLabel}
                    </span>{' '}
                    <span className="ox-tk-num">{r.people}</span>{' '}
                    <span className="ox-tk-num">{r.open}</span>
                  </button>
                ))}
                {rows.length === 0 ? <div className="ox-tk-empty">{T.projects.empty}</div> : null}
              </div>
              <div className="ox-tk-hint">
                <Icon name="info" size={18} />
                <span>{T.projects.hint}</span>
              </div>
            </>
          )}
        </div>
        {wiz ? (
          <NewProject
            tenantId={p.tenantId}
            units={p.unitOptions}
            copies={copies}
            onClose={closeWiz}
            onCreated={(x) => {
              setWiz(false);
              p.onCreated(x);
            }}
          />
        ) : null}
      </div>
    </>
  );
}
