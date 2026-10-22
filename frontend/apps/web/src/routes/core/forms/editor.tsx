// W4.22 · Редактор формы: шапка (dc:85–106, editVM dc:782–811) — «Все формы», название с правкой на месте, чип,
// мета, сохранение черновика, «Предпросмотр», «Поделиться», «Ещё действия с формой», «Опубликовать», плашка «Только
// просмотр», вкладки. «Конструктор» и «Предпросмотр» — этот WS; «Настройки», «Действия после ответа», «Ответы»,
// «Версии» и диалог «Поделиться формой» — W4.23 (модуль `./tabs/index.ts` по glob, прецедент W4.12 → W4.13: до
// вливания W4.23 панель вкладки пустая, после — работает без правки страницы).
import type { components } from '@ortus/api-client';
import { format, forms as F } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import {
  type ComponentType,
  lazy,
  type ReactElement,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { useOrgUnits } from '../../../shell/scope.ts';
import { useToast } from '../../../shell/toast.tsx';
import { commands, formsKey, useForm, useRules, useVersions } from './api.ts';
import { Builder, type BuilderState, initialBuilder } from './builder.tsx';
import { EDITOR_H1, type Tab, TABS, useForms } from './ctx.tsx';
import { draftEtag, type DraftEditor, useDraftEditor } from './draft.ts';
import { moduleName } from './list.tsx';
import {
  type Def,
  editorChip,
  issuesOf,
  type Issues,
  normDef,
  type Question,
  sameDef,
  uniqName,
} from './model.ts';
import { Chip, Failed, Glyph, Menu, type MenuItem } from './parts.tsx';
import { Preview } from './preview.tsx';
import { PublishDialog } from './publish.tsx';

type S = components['schemas'];

/** Вкладки W4.23 и диалог «Поделиться формой» (контракт: `{ tenantId, formId, tab }`, `{ tenantId, formId, onClose }`). */
type TabsModule = {
  FormTabPanel: ComponentType<{ tenantId: string; formId: string; tab: Exclude<Tab, 'build'> }>;
  ShareDialog: ComponentType<{ tenantId: string; formId: string; onClose: () => void }>;
};
const TABS_LOADER = Object.values(import.meta.glob<TabsModule>('./tabs/index.ts'))[0];
const TabPanel = TABS_LOADER
  ? lazy(async () => ({ default: (await TABS_LOADER()).FormTabPanel }))
  : null;
const ShareDialog = TABS_LOADER
  ? lazy(async () => ({ default: (await TABS_LOADER()).ShareDialog }))
  : null;

/** Что знает редактор о форме: права, черновик, действующая версия, проблемы. */
export interface EditorModel {
  tenantId: string;
  form: S['Form'];
  formEtag: string | null;
  /** Правка черновика, имени, приёма (`forms.manage`, организация не только для чтения). */
  canEdit: boolean;
  draft: DraftEditor;
  def: Def;
  /** Определение действующей версии; null — форма не публиковалась (или версии ещё грузятся). */
  published: Def | null;
  /** Вопросы действующей версии по ключу (флаги «Новое / Новый тип / Изменено», заметки). */
  prev: ReadonlyMap<string, Question>;
  /** Ключи, которые есть в опубликованных версиях (идентификатор нельзя изменить). */
  inVersions: ReadonlySet<string>;
  issues: Issues;
  dirty: boolean;
}

export function Editor({ formId, tab }: { formId: string; tab: Tab }): ReactElement {
  const { tenantId, go, setErr } = useForms();
  const q = useForm(tenantId, formId);

  // Форма по ссылке не найдена (скрыта, удалена) — баннер текстом сервера и список (Q-W4.32-6, как «База знаний»).
  useEffect(() => {
    if (q.isError && (q.error as { status?: number } | null)?.status === 404) {
      setErr((q.error as { problem?: { detail?: string } }).problem?.detail ?? '');
      go({}, true);
    }
  }, [q.isError, q.error, go, setErr]);

  if (q.isPending) {
    return (
      <div className="ox-fm-loading" role="status">
        {F.loading}
      </div>
    );
  }
  if (q.isError) return <Failed q={q} />;
  return <EditorBody key={formId} read={q.data} tab={tab} />;
}

function EditorBody({
  read,
  tab,
}: {
  read: { form: S['Form']; etag: string | null };
  tab: Tab;
}): ReactElement {
  const { tenantId } = useForms();
  const { readOnly } = useShell();
  const { form } = read;
  const canEdit = form.my.manage && !readOnly;
  const draft = useDraftEditor(tenantId, form.id, canEdit);
  const versions = useVersions(tenantId, form.id, form.versionCount > 0);

  const model = useMemo<EditorModel | null>(() => {
    if (!draft.def) return null;
    const cur = versions.data?.find((v) => v.current) ?? null;
    const published = cur ? normDef(cur.definition) : null;
    const prev = new Map((published?.fields ?? []).map((x) => [x.key, x]));
    const inVersions = new Set(
      (versions.data ?? []).flatMap((v) => v.definition.fields.map((x) => x.key)),
    );
    const dirty = !form.publishedVersionNumber
      ? true
      : published
        ? !sameDef(published, draft.def)
        : form.hasUnpublishedChanges;
    return {
      tenantId,
      form,
      formEtag: read.etag,
      canEdit,
      draft,
      def: draft.def,
      published,
      prev,
      inVersions,
      issues: issuesOf(draft.def, form.settings),
      dirty,
    };
  }, [draft, versions.data, form, read.etag, canEdit, tenantId]);

  if (draft.query.isError) return <Failed q={draft.query} />;
  if (!model) {
    return (
      <div className="ox-fm-loading" role="status">
        {F.loading}
      </div>
    );
  }
  return <EditorView m={model} tab={tab} />;
}

function EditorView({ m, tab }: { m: EditorModel; tab: Tab }): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const { tenant } = useShell();
  const toast = useToast();
  const { tenantId, go, cmd, busy, menu, setMenu } = useForms();
  const { form } = m;
  const units = useOrgUnits(tenantId, !!form.orgUnitId);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState('');
  const [preview, setPreview] = useState(false);
  const [dialog, setDialog] = useState<'publish' | 'share' | null>(null);
  const [bs, setBs] = useState<BuilderState>(initialBuilder);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const skipBlur = useRef(false);

  const rules = useRules(tenantId, form.id, preview || dialog === 'publish');
  const unit = form.orgUnitId ? units.data?.find((u) => u.id === form.orgUnitId) : undefined;
  const v = form.publishedVersionNumber;

  const saveName = async () => {
    const val = nameDraft;
    if (val == null || val.trim() === form.name) {
      setNameDraft(null);
      return;
    }
    const body: S['FormPatch'] = { name: val };
    const r = await cmd(
      { op: 'rename', id: form.id, body },
      (key) => commands.updateForm(api, tenantId, form.id, m.formEtag ?? '', body, key),
      F.toasts.renamed,
      { local: true },
    );
    if (r.ok) {
      setNameDraft(null);
      setNameErr('');
    } else if (r.error) setNameErr(r.error);
  };

  const duplicate = async () => {
    setMenu(null);
    const list = qc.getQueryData<S['Form'][]>([...formsKey(tenantId), 'list', 'all']) ?? [];
    const name = uniqName(
      list.map((f) => f.name).concat(form.name),
      format(F.list.copyName, { name: form.name }),
    );
    const body: S['FormCreate'] = { name, orgUnitId: form.orgUnitId, sourceFormId: form.id };
    await m.draft.flush();
    await cmd(
      { op: 'createForm', body },
      (key) => commands.createForm(api, tenantId, body, key),
      format(F.toasts.copied, { name }),
    );
  };

  const discard = async () => {
    setMenu(null);
    await m.draft.flush();
    const r = await cmd(
      { op: 'discard', id: form.id },
      (key) => commands.discardDraft(api, tenantId, form.id, draftEtag(qc, tenantId, form.id), key),
      format(F.toasts.discarded, { v: v ?? 0 }),
    );
    if (r.ok && r.data) {
      m.draft.reset(r.data.draft, r.data.etag);
      setBs(initialBuilder);
    }
  };

  const toggleClosed = async () => {
    setMenu(null);
    const close = form.status !== 'closed';
    const body: S['FormPatch'] = { status: close ? 'closed' : 'open' };
    await cmd(
      { op: 'status', id: form.id, body },
      (key) => commands.updateForm(api, tenantId, form.id, m.formEtag ?? '', body, key),
      format(close ? F.toasts.closed : F.toasts.reopened, { name: form.name }),
    );
  };

  const csv = async () => {
    setMenu(null);
    if (!form.responseCount) {
      toast(F.toasts.noResponses, 'info');
      return;
    }
    const r = await cmd(
      { op: 'csv', id: form.id, at: Date.now() },
      () => commands.exportCsv(api, tenantId, form.id),
      null,
    );
    if (r.ok && r.data) download(r.data.fileName, r.data.content, r.data.contentType);
  };

  const more: MenuItem[] = [
    ...(form.my.create && m.canEdit
      ? [
          {
            label: F.editor.moreMenu.duplicate,
            icon: 'content_copy',
            onClick: () => void duplicate(),
          },
        ]
      : []),
    ...(m.canEdit && v && m.dirty
      ? [{ label: F.editor.moreMenu.discard, icon: 'undo', onClick: () => void discard() }]
      : []),
    ...(m.canEdit && v
      ? [
          {
            label: form.status === 'closed' ? F.list.menu.reopen : F.list.menu.close,
            icon: form.status === 'closed' ? 'play_circle' : 'block',
            onClick: () => void toggleClosed(),
          },
        ]
      : []),
    { label: F.editor.moreMenu.csv, icon: 'download', onClick: () => void csv() },
  ];

  const s = m.draft.saveState;
  const hasSave = m.canEdit && (s === 'saving' || s === 'error' || (m.dirty && m.draft.edited));
  const saveText =
    s === 'saving'
      ? F.editor.saving
      : s === 'error'
        ? format(F.editor.saveError, { error: m.draft.saveError })
        : F.editor.saved;
  const publishLabel = !v
    ? F.editor.publish
    : m.dirty
      ? format(F.editor.publishV, { v: v + 1 })
      : F.editor.published;
  const meta = [
    moduleName(form.moduleKey),
    unit ? format(F.editor.area, { name: unit.name }) : F.editor.org,
    format(F.editor.owner, { name: form.owner.displayName }),
  ].join(' · ');
  const counts: Record<Tab, number | null> = {
    build: null,
    settings: null,
    actions: form.enabledRuleCount || null,
    responses: form.responseCount,
    versions: form.versionCount,
  };
  const current: Tab | null = preview ? null : tab;

  return (
    <div className="ox-fm-editor">
      {/* Название формы — поле ввода (как у эталона dc:85–90); h1 страницы — то же название, скрыт визуально. */}
      <h1 id={EDITOR_H1} className="ox-fm-sr" tabIndex={-1}>
        {form.name}
      </h1>
      <div className="ox-fm-ed-top">
        <div className="ox-fm-ed-left">
          <button type="button" className="ox-fm-back" onClick={() => go({})}>
            <Glyph name="arrow_back" size={18} />
            {F.editor.back}
          </button>
          <input
            ref={nameRef}
            className="ox-fm-name"
            value={nameDraft ?? form.name}
            maxLength={200}
            disabled={!m.canEdit}
            aria-label={F.editor.nameAria}
            onChange={(e) => {
              skipBlur.current = false;
              setNameDraft(e.target.value);
              setNameErr('');
            }}
            onBlur={() => {
              if (skipBlur.current) {
                skipBlur.current = false;
                return;
              }
              void saveName();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                skipBlur.current = true;
                setNameDraft(null);
                setNameErr('');
                e.currentTarget.blur();
              }
            }}
          />
          <span className="ox-fm-ed-meta">
            <Chip chip={editorChip(form, m.dirty)} className="ox-fm-chip ox-fm-chip-ed" />
            <span className="ox-fm-ed-meta-text">{meta}</span>
            {hasSave ? (
              <span role="status" className="ox-fm-save" data-state={s}>
                <Glyph
                  name={s === 'saving' ? 'sync' : s === 'error' ? 'error' : 'cloud_done'}
                  size={15}
                />
                {saveText}
              </span>
            ) : null}
          </span>
          {nameErr ? (
            <span role="alert" className="ox-fm-name-err">
              {nameErr}
            </span>
          ) : null}
        </div>
        <div className="ox-fm-ed-actions">
          <button
            type="button"
            className="ox-fm-btn ox-fm-preview-btn"
            aria-pressed={preview}
            onClick={() => {
              setMenu(null);
              setBs((b) => ({ ...b, pick: null }));
              setPreview(!preview);
            }}
          >
            <Glyph name="visibility" size={18} />
            {F.editor.preview}
          </button>
          <button
            type="button"
            className="ox-fm-icon-btn"
            data-size="40"
            data-boxed=""
            aria-label={F.editor.share}
            onClick={() => {
              setMenu(null);
              if (ShareDialog) setDialog('share');
            }}
          >
            <Glyph name="share" size={20} />
          </button>
          <div className="ox-fm-anchor">
            <button
              type="button"
              className="ox-fm-icon-btn"
              data-size="40"
              data-boxed=""
              aria-label={F.editor.more}
              aria-expanded={menu === 'more'}
              onClick={() => setMenu(menu === 'more' ? null : 'more')}
            >
              <Glyph name="more_horiz" size={20} />
            </button>
            {menu === 'more' ? (
              <Menu className="ox-fm-menu-more" items={more} onClose={() => setMenu(null)} />
            ) : null}
          </div>
          {form.my.publish && m.canEdit ? (
            <button
              type="button"
              className="ox-fm-btn"
              data-variant="primary"
              data-size="publish"
              disabled={!m.dirty || busy}
              onClick={() => {
                setMenu(null);
                setDialog('publish');
              }}
            >
              <Glyph name="check" size={18} />
              {publishLabel}
            </button>
          ) : null}
        </div>
      </div>
      {!m.canEdit ? (
        <div className="ox-fm-ro">
          <Glyph name="lock" size={15} />
          {F.editor.readOnly}
        </div>
      ) : null}
      <div role="tablist" aria-label={F.editor.tabsAria} className="ox-fm-tabs">
        {TABS.map((t) => {
          const n = counts[t];
          return (
            <button
              key={t}
              type="button"
              role="tab"
              id={`fm-tab-${t}`}
              aria-selected={current === t}
              aria-controls="fm-panel"
              className="ox-fm-tab"
              onClick={() => {
                setPreview(false);
                setMenu(null);
                setBs((b) => ({ ...b, pick: null }));
                go({ form: form.id, ...(t === 'build' ? {} : { tab: t }) });
              }}
            >
              {F.editor.tabs[t]}
              {n !== null ? <span className="ox-fm-tab-count">{n}</span> : null}
            </button>
          );
        })}
      </div>
      <div
        id="fm-panel"
        className="ox-fm-panel"
        {...(current ? { role: 'tabpanel', 'aria-labelledby': `fm-tab-${current}` } : {})}
      >
        {preview ? (
          <Preview
            def={m.def}
            form={form}
            tenantName={tenant?.name ?? ''}
            rules={rules.data ?? []}
            onClose={() => setPreview(false)}
          />
        ) : tab === 'build' ? (
          <Builder m={m} state={bs} setState={setBs} />
        ) : TabPanel ? (
          <Suspense fallback={null}>
            <TabPanel tenantId={tenantId} formId={form.id} tab={tab} />
          </Suspense>
        ) : null}
      </div>
      {dialog === 'publish' ? (
        <PublishDialog
          m={m}
          rules={rules.data ?? []}
          onClose={(toBuilder) => {
            setDialog(null);
            if (toBuilder) {
              setPreview(false);
              go({ form: form.id });
            }
          }}
          onPublished={(d, tag) => {
            m.draft.reset(d, tag);
            setBs((b) => ({ ...b, undo: null }));
          }}
        />
      ) : null}
      {dialog === 'share' && ShareDialog ? (
        <Suspense fallback={null}>
          <ShareDialog tenantId={tenantId} formId={form.id} onClose={() => setDialog(null)} />
        </Suspense>
      ) : null}
    </div>
  );
}

/** Скачать CSV выгрузки (`exportFormResponses`: файл в JSON, как `exportDataset`). */
function download(name: string, content: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
