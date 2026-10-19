// W2.41 · Страница «Категории расходов» (`company-expense-categories`, S2-08; ответ владельца 17.10 на D-12 комплекта,
// ADR-0013): справочник категорий расходов тенанта — шесть категорий посева и свои, добавление, архивация с
// подтверждением, архив. Экрана в эталоне нет (no-reference, Q-W2.40-3): страница «Логистики» вне меню, вход —
// «Связанные разделы» «Приёмки смен» (Q-W2.41-2); право — `modules.settings.manage` (гейт оболочки и сервер).
// Переименования и возврата из архива нет (Q-W2.52-2), «Прочее» не архивируется (Q-W2.52-3).
import { format, logisticsManager, shell, toast } from '@ortus/texts';
import { Banner, ConfirmDialog, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactElement, useId, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { problemText, useBusy, useRun } from '../../../shell/run.tsx';
import { useCrumb } from '../manager/review/crumb.ts';
import { archiveCategory, createCategory, refreshCategories, useExpenseCategories } from './api.ts';
import {
  archivedSince,
  canArchive,
  type Category,
  nameError,
  serverFieldError,
  split,
} from './model.ts';
import '../manager/review/review.css';
import './categories.css';

const T = logisticsManager.expenseCategories;
const H1_ID = 'h-expense-categories';

function Tags({ c }: { c: Category }): ReactElement | null {
  if (!c.commentRequired && !c.seeded) return null;
  return (
    <span className="ox-ec-tags">
      {c.commentRequired ? (
        <span className="ox-rv-chip" data-tone="warn">
          <Icon name="edit_note" size={16} />
          {T.commentRequired}
        </span>
      ) : null}
      {c.seeded ? <span className="ox-rv-chip">{T.seeded}</span> : null}
    </span>
  );
}

/** Форма «Новая категория»: название (пусто — ошибка поля, дубль — ошибка сервера под полем), флажок. */
function AddForm({ tenantId }: { tenantId: string }): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('ec-add');
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [commentRequired, setCommentRequired] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const local = nameError(label);
    setErr(local);
    if (local) {
      input.current?.focus();
      return;
    }
    const name = label.trim();
    try {
      await run(
        'ec-add',
        () => createCategory(api, tenantId, { label: name, commentRequired }),
        format(toast.manager.categoryAdded, { label: name }),
        { quiet: ['validation_failed'] },
      );
      setLabel('');
      setCommentRequired(false);
    } catch (x) {
      // 422 (дубль) — под полем; прочее (нет связи, 429) — тост `run`, введённое остаётся.
      const field = serverFieldError(x);
      if (field) {
        setErr(field);
        input.current?.focus();
      }
    } finally {
      await refreshCategories(qc, tenantId);
    }
  };

  return (
    <form
      className="ox-rv-card ox-ec-form"
      aria-labelledby={`${id}-title`}
      noValidate
      onSubmit={(e) => void submit(e)}
    >
      <h2 id={`${id}-title`} className="ox-rv-h3">
        {T.form.title}
      </h2>
      <div className="ox-ec-fields">
        <label className="ox-rv-label ox-ec-name-field" htmlFor={`${id}-name`}>
          {T.form.name}
        </label>
        <input
          ref={input}
          id={`${id}-name`}
          className="ox-ec-input"
          value={label}
          maxLength={100}
          autoComplete="off"
          placeholder={T.form.namePlaceholder}
          aria-invalid={err ? 'true' : undefined}
          aria-describedby={err ? `${id}-err` : undefined}
          onChange={(e) => {
            setLabel(e.target.value);
            setErr(null);
          }}
        />
        {err ? (
          <div id={`${id}-err`} role="alert" className="ox-rv-error">
            {err}
          </div>
        ) : null}
        <label className="ox-ec-check">
          <input
            type="checkbox"
            checked={commentRequired}
            aria-describedby={`${id}-hint`}
            onChange={(e) => setCommentRequired(e.target.checked)}
          />
          {T.form.commentRequired}
        </label>
        <span id={`${id}-hint`} className="ox-rv-sub ox-rv-sub-sm">
          {T.form.commentHint}
        </span>
      </div>
      <div className="ox-rv-actions">
        <button
          type="submit"
          className="ox-rv-btn ox-rv-btn-lg"
          data-variant="primary"
          disabled={busy}
        >
          <Icon name="add" size={20} />
          {T.form.add}
        </button>
      </div>
    </form>
  );
}

export default function ExpenseCategoriesPage(): ReactElement {
  const { tenantId: tid, audience, readOnly } = useShell();
  const tenantId = tid ?? '';
  const can = useCan();
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('ec-archive');
  const crumbText = useCrumb('modules.settings.manage');
  const categories = useExpenseCategories(tenantId);
  const [confirm, setConfirm] = useState<Category | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const canManage = !readOnly && (audience === 'owner' || can('modules.settings.manage'));
  const { active, archived } = split(categories.data ?? []);

  const archive = async (c: Category): Promise<void> => {
    try {
      await run(
        'ec-archive',
        () => archiveCategory(api, tenantId, c),
        format(toast.manager.categoryArchived, { label: c.label }),
      );
    } catch {
      // Ошибку показал тост `run`; справочник перечитывается (412 — строка устарела).
    } finally {
      setConfirm(null);
      await refreshCategories(qc, tenantId);
    }
  };

  let body: ReactElement;
  if (categories.isPending) {
    body = <Skeleton lines={6} label={shell.a11y.loading} />;
  } else if (categories.isError) {
    body = (
      <Banner
        tone="danger"
        role="alert"
        title={format(T.loadFailed, { error: problemText(categories.error) })}
        action={{ label: T.retry, onPress: () => void categories.refetch() }}
      />
    );
  } else {
    body = (
      <>
        <div className="ox-rv-card ox-ec-card">
          <ul aria-label={T.activeAria} className="ox-ec-list">
            {active.map((c) => (
              <li key={c.code} className="ox-ec-row">
                <span className="ox-ec-icon" aria-hidden="true">
                  <Icon name="receipt_long" size={20} />
                </span>
                <span className="ox-ec-main">
                  <strong className="ox-ec-name">{c.label}</strong>
                  <Tags c={c} />
                </span>
                {c.code === 'other' ? (
                  <span className="ox-rv-sub ox-rv-sub-sm ox-ec-fixed">{T.notArchivable}</span>
                ) : canManage && canArchive(c) ? (
                  <button
                    type="button"
                    className="ox-rv-btn ox-rv-hit"
                    aria-label={format(T.archiveNamed, { label: c.label })}
                    onClick={() => setConfirm(c)}
                  >
                    <Icon name="inventory_2" size={18} />
                    {T.archive}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        {canManage ? (
          <AddForm tenantId={tenantId} />
        ) : readOnly ? (
          <p className="ox-rv-note">{T.readOnly}</p>
        ) : null}
        <div className="ox-ec-archive">
          <button
            type="button"
            className="ox-rv-link"
            aria-expanded={showArchive}
            onClick={() => setShowArchive((v) => !v)}
          >
            <Icon name={showArchive ? 'expand_less' : 'inventory_2'} size={18} />
            {showArchive ? T.hideArchive : format(T.showArchive, { n: archived.length })}
          </button>
          {showArchive && archived.length === 0 ? (
            <p className="ox-rv-note">{T.archiveEmpty}</p>
          ) : null}
          {showArchive && archived.length > 0 ? (
            <div className="ox-rv-card ox-ec-card">
              <ul aria-label={T.archivedAria} className="ox-ec-list">
                {archived.map((c) => (
                  <li key={c.code} className="ox-ec-row" data-archived="">
                    <span className="ox-ec-icon" aria-hidden="true">
                      <Icon name="inventory_2" size={20} />
                    </span>
                    <span className="ox-ec-main">
                      <strong className="ox-ec-name">{c.label}</strong>
                      <span className="ox-rv-sub ox-rv-sub-sm">{archivedSince(c)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby={H1_ID} className="ox-rv ox-ec">
      <div className="ox-rv-top">
        <div className="ox-rv-crumb">{crumbText}</div>
        <h1 id={H1_ID} className="ox-rv-title" tabIndex={-1}>
          {shell.nav.items.expenseCategories}
        </h1>
        <p className="ox-rv-intro">{T.intro}</p>
      </div>
      {body}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void archive(confirm);
        }}
        icon="inventory_2"
        title={format(T.archiveDialog.title, { label: confirm?.label ?? '' })}
        text={T.archiveDialog.text}
        confirmLabel={T.archiveDialog.confirm}
        busy={busy}
      />
    </section>
  );
}
