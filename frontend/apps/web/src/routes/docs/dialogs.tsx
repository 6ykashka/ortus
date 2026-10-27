// W7.25 · Диалоги «Документов» на @ortus/ui Dialog: «Новый документ» (вкладки Текст, Таблица, PDF, Из шаблона, Скан;
// Д:717–739, createVM Д:1462–1495), «Перенести в другую папку» (Д:741–751, dryRun — «Что изменится») и «Новая папка»
// (docs-folders, no-reference B-6, Q-W4.00-documents-8). Ошибки 422 — под полем, успех — тост после ответа сервера.
import type { components } from '@ortus/api-client';
import { shell } from '@ortus/texts';
import { Button, Checkbox, Dialog, Field, Icon, Select, Tabs, TextInput } from '@ortus/ui';
import { type ReactElement, useEffect, useId, useRef, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { useToast } from '../../shell/toast.tsx';
import { commands, idemKeys, uploadDocFile, useLinkOptions, useTemplates } from './api.ts';
import { useCommand } from './cmd.ts';
import type { DocsCtx } from './ctx.ts';
import {
  type CreateKind,
  createErrors,
  fill,
  folderNameError,
  folderOptions,
  impactLines,
} from './model.ts';
import { DOCS_TEXT as T } from './texts.ts';

type S = components['schemas'];

export interface CreateInitial {
  kind: CreateKind;
  title?: string;
  files?: File[];
  csv?: string;
  csvName?: string;
}

function Footer(p: {
  busy: boolean;
  submit: string;
  onClose: () => void;
  onSubmit: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <>
      <Button variant="secondary" onPress={p.onClose} disabled={p.busy}>
        {shell.modal.cancel}
      </Button>
      <Button
        variant="primary"
        onPress={p.onSubmit}
        loading={p.busy}
        loadingLabel={shell.modal.busy}
        disabled={p.disabled ?? false}
      >
        {p.submit}
      </Button>
    </>
  );
}

/** Фокус на первое поле при открытии и после отказа. */
function useFocus(id: string, failures: number): void {
  useEffect(() => {
    document.getElementById(id)?.focus();
  }, [id, failures]);
}

// ───────────────────────────── «Новый документ» ─────────────────────────────

export function CreateDialog(p: {
  ctx: DocsCtx;
  initial: CreateInitial;
  onClose: () => void;
  onCreated: (id: string) => void;
}): ReactElement {
  const { ctx, initial } = p;
  const api = useApi();
  const toast = useToast();
  const id = useId();
  const [keys] = useState(idemKeys);
  const cmd = useCommand(ctx.refresh);
  const [kind, setKind] = useState<CreateKind>(initial.kind);
  const options = folderOptions(ctx.folders, true);
  const [title, setTitle] = useState(initial.title ?? '');
  const [folderId, setFolderId] = useState(options[0]?.id ?? '');
  const [files, setFiles] = useState<File[]>(initial.files ?? []);
  const [csv, setCsv] = useState(initial.csv ?? '');
  const [csvName, setCsvName] = useState(initial.csvName ?? '');
  const [tplId, setTplId] = useState('');
  const [link, setLink] = useState('');
  const [pdn, setPdn] = useState(false);
  const [shown, setShown] = useState(false);
  const templates = useTemplates(ctx.tenantId, kind === 'tpl');
  const tpl = templates.data?.find((t) => t.id === tplId);
  const linkOptions = useLinkOptions(ctx.tenantId, kind === 'tpl' && tpl?.link ? tpl.link : null);
  useFocus(`${id}-first`, cmd.failures);

  const errors = createErrors({
    kind,
    title,
    folderId,
    files: files.length,
    needsLink: !!tpl?.link,
    link,
    template: kind === 'tpl',
  });
  const err = (key: string): string | undefined =>
    (shown ? errors[key] : undefined) ?? cmd.fields[key];

  const pickTemplate = (value: string): void => {
    setTplId(value);
    setLink('');
    const t = templates.data?.find((x) => x.id === value);
    if (!t) return;
    if (!title.trim()) setTitle(t.name);
    if (options.some((o) => o.id === t.folderId)) setFolderId(t.folderId);
  };

  const submit = async (): Promise<void> => {
    setShown(true);
    if (Object.keys(errors).length) return;
    if (kind === 'tpl' && !tpl) return;
    const ref = linkOptions.data?.find((o) => o.id === link)?.ref;
    const apiKind: S['DocCreate']['kind'] =
      kind === 'tpl' ? (tpl?.kind ?? 'text') : kind === 'scan' ? 'pdf' : kind;
    const r = await cmd.exec(
      'docs.create',
      async () => {
        const fileIds: string[] = [];
        for (const f of files) {
          try {
            fileIds.push(await uploadDocFile(api, ctx.tenantId, folderId, f));
          } catch (e) {
            toast(fill(T.create.uploadFailed, { name: f.name }), 'error');
            throw e;
          }
        }
        const body: S['DocCreate'] = {
          kind: apiKind,
          title: title.trim(),
          folderId,
          ...(tpl ? { templateId: tpl.id } : {}),
          ...(ref ? { link: ref } : {}),
          ...(kind === 'sheet' && csv ? { csv } : {}),
          ...(fileIds.length ? { fileIds } : {}),
          ...(kind === 'scan' ? { scan: true } : {}),
          ...(pdn ? { sensitivity: 'pdn' as const } : {}),
        };
        const doc = await commands.createDoc(api, ctx.tenantId, body, keys.key(body));
        keys.settle(body);
        return doc;
      },
      null,
    );
    if (!r.ok) return;
    toast(fill(T.create.done, { title: r.value.title }), 'ok');
    p.onCreated(r.value.id);
  };

  const readCsv = (f: File | undefined): void => {
    if (!f) return;
    setCsvName(f.name);
    void f.text().then(setCsv);
  };

  const hasFolders = options.length > 0;
  const tabs = [
    { id: 'text', label: T.kinds.text.label },
    { id: 'sheet', label: T.kinds.sheet.label },
    { id: 'pdf', label: T.kinds.pdf.label },
    { id: 'tpl', label: T.kinds.tpl.label },
    { id: 'scan', label: T.kinds.scan.label },
  ];

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={T.create.title}
      size="lg"
      busy={cmd.busy}
      footer={
        <Footer
          busy={cmd.busy}
          submit={T.create.submit}
          onClose={p.onClose}
          onSubmit={() => void submit()}
        />
      }
    >
      <div className="ox-docs-form">
        <button
          type="button"
          className="ox-docs-icon-btn ox-docs-dialog-close"
          onClick={p.onClose}
          disabled={cmd.busy}
        >
          <Icon name="close" size={20} />
          <span className="ox-docs-sr">{T.share.close}</span>
        </button>
        <Tabs
          aria-label={T.create.kindsAria}
          value={kind}
          onChange={(v) => {
            setKind(v as CreateKind);
            setShown(false);
            cmd.clear();
          }}
          items={tabs}
        />
        {cmd.general ? (
          <div role="alert" className="ox-docs-alert">
            {cmd.general}
          </div>
        ) : null}
        {kind === 'tpl' ? (
          <Field label={T.create.template} {...(err('tpl') ? { error: err('tpl') as string } : {})}>
            <Select
              value={tplId}
              onChange={pickTemplate}
              placeholder={T.create.template}
              options={(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            />
          </Field>
        ) : null}
        {tpl ? (
          <p className="ox-docs-hint">
            {tpl.hint}{' '}
            {fill(T.create.templateFields, { fields: tpl.fields.map((f) => f.key).join(', ') })}
          </p>
        ) : null}
        {tpl?.link ? (
          <Field label={T.create.link} {...(err('link') ? { error: err('link') as string } : {})}>
            <Select
              value={link}
              onChange={setLink}
              placeholder={T.create.linkNone}
              options={(linkOptions.data ?? []).map((o) => ({ value: o.id, label: o.label }))}
            />
          </Field>
        ) : null}
        <Field
          id={`${id}-first`}
          label={T.create.name}
          required
          {...(err('title') ? { error: err('title') as string } : {})}
        >
          <TextInput value={title} onChange={setTitle} placeholder={T.create.namePlaceholder} />
        </Field>
        <Field
          label={T.create.folder}
          hint={hasFolders ? T.create.folderHint : T.create.folderNone}
          {...(err('folderId') ? { error: err('folderId') as string } : {})}
        >
          <Select
            value={folderId}
            onChange={setFolderId}
            placeholder={T.create.folderPlaceholder}
            options={options.map((o) => ({ value: o.id, label: o.label }))}
          />
        </Field>
        {kind === 'sheet' ? (
          <div className="ox-docs-file">
            <span className="ox-docs-file-label">{T.create.csv}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label={T.create.csv}
              onChange={(e) => readCsv(e.target.files?.[0])}
            />
            {csvName ? (
              <span className="ox-docs-hint">{csvName}</span>
            ) : (
              <span className="ox-docs-hint">{T.create.csvHint}</span>
            )}
          </div>
        ) : null}
        {kind === 'pdf' || kind === 'scan' ? (
          <div className="ox-docs-file" data-invalid={err('files') ? '' : undefined}>
            <span className="ox-docs-file-label">
              {kind === 'scan' ? T.create.scanPhoto : T.create.files}
            </span>
            <input
              type="file"
              multiple
              accept={kind === 'scan' ? 'image/*' : '.pdf,image/*'}
              {...(kind === 'scan' ? { capture: 'environment' as const } : {})}
              aria-label={kind === 'scan' ? T.create.scanPhoto : T.create.files}
              onChange={(e) => setFiles([...(e.target.files ?? [])])}
            />
            <span className="ox-docs-hint">
              {files.length
                ? files.map((f) => f.name).join(', ')
                : kind === 'scan'
                  ? T.create.scanHint
                  : T.create.filesHint}
            </span>
            {err('files') ? (
              <span role="alert" className="ox-docs-field-err">
                {err('files')}
              </span>
            ) : null}
          </div>
        ) : null}
        {kind === 'scan' || kind === 'pdf' ? (
          <Checkbox
            checked={pdn}
            onChange={setPdn}
            label={T.create.pdn}
            description={T.create.pdnHint}
          />
        ) : null}
      </div>
    </Dialog>
  );
}

// ───────────────────────────── «Перенести» ─────────────────────────────

export function MoveDialog(p: {
  ctx: DocsCtx;
  doc: { id: string; title: string; folderId: string };
  onClose: () => void;
}): ReactElement {
  const { ctx, doc } = p;
  const api = useApi();
  const toast = useToast();
  const id = useId();
  const [keys] = useState(idemKeys);
  const cmd = useCommand(ctx.refresh);
  const options = folderOptions(ctx.folders, true).filter((o) => o.id !== doc.folderId);
  const [folderId, setFolderId] = useState('');
  const [impact, setImpact] = useState<S['DocAccessImpact'] | null>(null);
  const [probeErr, setProbeErr] = useState<string | undefined>();
  const seq = useRef(0);
  useFocus(`${id}-first`, cmd.failures);

  const pick = (value: string): void => {
    setFolderId(value);
    setImpact(null);
    setProbeErr(undefined);
    if (!value) return;
    const n = ++seq.current;
    void commands
      .moveDoc(api, ctx.tenantId, doc.id, { folderId: value, dryRun: true }, crypto.randomUUID())
      .then((r) => {
        if (n === seq.current) setImpact(r.impact);
      })
      .catch((e: unknown) => {
        if (n === seq.current) setProbeErr(e instanceof Error ? e.message : '');
      });
  };

  const submit = async (): Promise<void> => {
    if (!folderId) {
      setProbeErr(T.create.errFolder);
      return;
    }
    const body: S['DocMove'] = { folderId };
    const r = await cmd.exec(
      'docs.move',
      () => commands.moveDoc(api, ctx.tenantId, doc.id, body, keys.key(body)),
      null,
    );
    if (!r.ok) return;
    toast(fill(T.move.done, { folder: options.find((o) => o.id === folderId)?.label ?? '' }), 'ok');
    p.onClose();
  };

  const lines = impact ? impactLines(impact) : [];
  return (
    <Dialog
      open
      onClose={p.onClose}
      title={T.move.title}
      busy={cmd.busy}
      footer={
        <Footer
          busy={cmd.busy}
          submit={T.move.submit}
          onClose={p.onClose}
          onSubmit={() => void submit()}
        />
      }
    >
      <div className="ox-docs-form">
        <p className="ox-docs-hint">{doc.title}</p>
        {cmd.general ? (
          <div role="alert" className="ox-docs-alert">
            {cmd.general}
          </div>
        ) : null}
        <Field
          id={`${id}-first`}
          label={T.move.folder}
          hint={T.move.hint}
          {...((cmd.fields.folderId ?? probeErr)
            ? { error: (cmd.fields.folderId ?? probeErr) as string }
            : {})}
        >
          <Select
            value={folderId}
            onChange={pick}
            placeholder={T.create.folderPlaceholder}
            options={options.map((o) => ({ value: o.id, label: o.label }))}
          />
        </Field>
        {impact ? (
          <section className="ox-docs-impact" aria-label={T.move.changes}>
            <strong>{T.move.changes}</strong>
            {lines.length ? (
              <ul>
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : (
              <p>{T.move.noChange}</p>
            )}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

// ───────────────────────────── «Новая папка» ─────────────────────────────

export function FolderDialog(p: { ctx: DocsCtx; onClose: () => void }): ReactElement {
  const { ctx } = p;
  const api = useApi();
  const toast = useToast();
  const id = useId();
  const [keys] = useState(idemKeys);
  const cmd = useCommand(ctx.refresh);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [mode, setMode] = useState<'inherit' | 'listed'>('inherit');
  const [shown, setShown] = useState(false);
  const options = folderOptions(ctx.folders, true);
  useFocus(`${id}-first`, cmd.failures);
  const local = folderNameError(name);

  const submit = async (): Promise<void> => {
    setShown(true);
    if (local) return;
    const body: S['DocFolderCreate'] = {
      name: name.trim(),
      mode,
      ...(parent ? { parentId: parent } : {}),
    };
    const r = await cmd.exec(
      'docs.folder',
      () => commands.createFolder(api, ctx.tenantId, body, keys.key(body)),
      null,
    );
    if (!r.ok) return;
    toast(fill(T.folder.done, { name: name.trim() }), 'ok');
    p.onClose();
  };

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={T.folder.title}
      busy={cmd.busy}
      footer={
        <Footer
          busy={cmd.busy}
          submit={T.folder.submit}
          onClose={p.onClose}
          onSubmit={() => void submit()}
        />
      }
    >
      <div className="ox-docs-form">
        {cmd.general ? (
          <div role="alert" className="ox-docs-alert">
            {cmd.general}
          </div>
        ) : null}
        <Field
          id={`${id}-first`}
          label={T.folder.name}
          required
          {...(((shown ? local : undefined) ?? cmd.fields.name)
            ? { error: ((shown ? local : undefined) ?? cmd.fields.name) as string }
            : {})}
        >
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label={T.folder.parent}>
          <Select
            value={parent}
            onChange={setParent}
            placeholder={T.folder.parentRoot}
            options={options.map((o) => ({ value: o.id, label: o.label }))}
          />
        </Field>
        <Field label={T.folder.mode}>
          <Select
            value={mode}
            onChange={(v) => setMode(v as 'inherit' | 'listed')}
            options={[
              { value: 'inherit', label: T.folder.inherit },
              { value: 'listed', label: T.folder.listed },
            ]}
          />
        </Field>
      </div>
    </Dialog>
  );
}
