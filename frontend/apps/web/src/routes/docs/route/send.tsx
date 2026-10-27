// W7.26 · Диалог «На согласование» (эталон «Документы.dc.html» :631–701, openRoute :1377–1385, routeDlgVM :1386–1451;
// `startDocRoute`, `listDocRouteTemplates`). Шаги (до 6): «Согласовать» (порядок, участники), «Утвердить», «Ознакомить»
// (аудитория), «Подпись заказчика» (только у документа со связью с объектом); правила; «Что произойдёт» — ответ
// `startDocRoute` с `dryRun`; черновик «Листа согласования». Проект задачи сервер берёт сам (Q-W7.26-3).
import { type components } from '@ortus/api-client';
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  Icon,
  Select,
  Skeleton,
  Switch,
  TextInput,
} from '@ortus/ui';
import { type ReactElement, useEffect, useMemo, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { idemKeys, startRoute, useGroups, useMembers, useRoles, useRouteTemplates } from './api.ts';
import { DIALOG_CODES, errorText, useCommand } from './cmd.ts';
import {
  draftErrors,
  draftFromTemplate,
  dueDates,
  moveStepUp,
  newStep,
  previewRows,
  removeStep,
  type RouteDraft,
  type StepDraft,
  toStartBody,
} from './model.ts';
import { ROUTE_TEXT as T } from './texts.ts';

type S = components['schemas'];
type Kind = StepDraft['kind'];

/** Срок «сегодня» для предпросмотра сроков шагов (сервер считает сам). */
const todayIso = (): string => new Date().toISOString().slice(0, 10);

interface Person {
  id: string;
  name: string;
  invited: boolean;
}

export function SendDialog(p: {
  tenantId: string;
  doc: S['Document'];
  onClose: () => void;
}): ReactElement {
  const templates = useRouteTemplates(p.tenantId, true);
  const members = useMembers(p.tenantId, true);
  const roles = useRoles(p.tenantId, true);
  const groups = useGroups(p.tenantId, true);
  const ready = !templates.isPending && !members.isPending && !roles.isPending && !groups.isPending;
  if (!ready) {
    return (
      <Dialog open onClose={p.onClose} title={T.send.title} size="lg">
        <Skeleton lines={4} label={T.state.loading} />
      </Dialog>
    );
  }
  const tpl = (templates.data ?? []).find((t) => t.folderId === p.doc.folderId);
  return (
    <SendForm
      tenantId={p.tenantId}
      doc={p.doc}
      tpl={tpl}
      members={members.data ?? []}
      roles={roles.data ?? []}
      groups={groups.data ?? []}
      onClose={p.onClose}
    />
  );
}

function SendForm(p: {
  tenantId: string;
  doc: S['Document'];
  tpl: S['DocRouteTemplate'] | undefined;
  members: readonly S['Member'][];
  roles: readonly S['Role'][];
  groups: readonly S['Group'][];
  onClose: () => void;
}): ReactElement {
  const { doc } = p;
  const api = useApi();
  const can = useCan();
  const { me } = useShell();
  // Автор — владелец документа: правило «автор не согласует и не утверждает» сервер проверяет по нему.
  const author = doc.owner.memberId;
  const authorName =
    doc.owner.displayName === me.displayName
      ? `${T.send.you}, ${doc.owner.displayName}`
      : doc.owner.displayName;
  const cmd = useCommand(p.tenantId);
  const [keys] = useState(idemKeys);
  const [draft, setDraft] = useState<RouteDraft>(() => draftFromTemplate(p.tpl));
  const [dry, setDry] = useState<{ key: string; items: string[]; failed: boolean } | null>(null);
  const canSaveTemplate = can('docs.templates.manage');
  const linked = doc.links.length > 0;

  const people: Person[] = useMemo(
    () =>
      p.members
        .filter((m) => m.status !== 'suspended')
        .map((m) => ({ id: m.id, name: m.displayName, invited: m.status === 'invited' })),
    [p.members],
  );
  const nameOf = (id: string): string =>
    people.find((x) => x.id === id)?.name ?? T.send.unknownPerson;

  const errors = draftErrors(draft, { authorId: author, linked });
  const bodyKey = JSON.stringify(toStartBody(draft, { canSaveTemplate, dryRun: true }));
  // Ответ dryRun показывается, только пока он относится к текущей форме и форма без ошибок.
  const fresh = !errors.length && dry?.key === bodyKey ? dry : null;
  const conseq = fresh?.items ?? [];
  const dryFailed = fresh?.failed ?? false;

  // «Что произойдёт»: dryRun на каждое изменение формы (после паузы), пока форма без ошибок.
  useEffect(() => {
    if (errors.length) return;
    let alive = true;
    const t = setTimeout(() => {
      const body = toStartBody(draft, { canSaveTemplate, dryRun: true });
      startRoute({ api, tenantId: p.tenantId, docId: doc.id, key: crypto.randomUUID() }, body).then(
        (r) => {
          if (alive) setDry({ key: bodyKey, items: r.consequences, failed: false });
        },
        (e) => {
          if (!alive) return;
          setDry({ key: bodyKey, items: [], failed: true });
          cmd.setError(errorText(e));
        },
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- форма целиком — в bodyKey
  }, [bodyKey, errors.length]);

  const set = (patch: Partial<RouteDraft>): void => {
    cmd.setError(undefined);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setStep = (i: number, patch: Partial<StepDraft>): void =>
    set({ steps: draft.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  const due = dueDates(draft.steps, todayIso());
  const full = draft.steps.length >= 6;

  const submit = async (): Promise<void> => {
    if (errors.length) return;
    const body = toStartBody(draft, { canSaveTemplate });
    const done = await cmd.exec(
      'docs.route.start',
      () => startRoute({ api, tenantId: p.tenantId, docId: doc.id, key: keys.key(body) }, body),
      T.send.sent,
      DIALOG_CODES,
    );
    if (done) p.onClose();
    else keys.settle(body);
  };

  const busy = cmd.busy === 'docs.route.start';
  const nextVersion = doc.version + 1;
  const shownError = cmd.error ?? errors[0];
  const addKinds: Kind[] = ['approve', 'sign', 'ack', ...(linked ? (['external'] as const) : [])];
  const audienceOptions = [
    ...p.roles.map((r) => ({ value: `role:${r.id}`, label: `Роль «${r.name}»` })),
    ...p.groups.map((g) => ({ value: `group:${g.id}`, label: `Группа «${g.name}»` })),
    ...people.map((m) => ({ value: `member:${m.id}`, label: m.name })),
  ];
  const audienceEntry = (v: string): S['DocShareEntry'] | undefined => {
    const label = audienceOptions.find((o) => o.value === v)?.label;
    const [who, ref] = v.split(':');
    if (!label || !ref || (who !== 'role' && who !== 'group' && who !== 'member')) return undefined;
    return { who, refId: ref, level: 'view', label };
  };

  const rows = previewRows(draft, nameOf);

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={T.send.title}
      size="lg"
      busy={busy}
      footer={
        <>
          {canSaveTemplate ? (
            <div className="ox-rt-footer-check">
              <Checkbox
                checked={draft.saveAsFolderTemplate}
                onChange={(v) => set({ saveAsFolderTemplate: v })}
                label={`${T.send.saveTemplate} «${doc.folderName}»`}
              />
            </div>
          ) : null}
          <Button variant="secondary" onPress={p.onClose} disabled={busy}>
            {T.send.cancel}
          </Button>
          <Button
            icon="send"
            onPress={() => void submit()}
            disabled={errors.length > 0 || busy}
          >
            {T.send.submit}
          </Button>
        </>
      }
    >
      <div className="ox-rt-dlg">
        <div className="ox-rt-dlg-head">
          <span className="ox-rt-dlg-ic" aria-hidden="true">
            <Icon name="description" size={22} />
          </span>
          <p className="ox-rt-dlg-sub">{`${doc.title} · ${doc.path.join(' › ') || doc.folderName} · ${T.send.author} ${authorName}`}</p>
          <span className="ox-rt-lock">
            <Icon name="lock" size={15} />
            {`${T.send.locks} v${nextVersion}`}
          </span>
          <button
            type="button"
            className="ox-rt-ibtn"
            data-bare="true"
            aria-label={T.send.close}
            disabled={busy}
            onClick={p.onClose}
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="ox-rt-cols">
        <div className="ox-rt-main">
        <div className="ox-rt-route-name">
          <strong>{T.send.route}</strong>
          <span>{draft.name ? `${T.send.templatePrefix} «${draft.name}»` : T.send.ownRoute}</span>
        </div>

        {draft.steps.map((s, i) => (
          <StepCard
            key={i}
            i={i}
            s={s}
            due={due[i] ?? ''}
            people={people}
            author={author}
            notAuthor={draft.rules.notAuthor}
            audienceOptions={audienceOptions}
            onChange={(patch) => setStep(i, patch)}
            onUp={() => set({ steps: moveStepUp(draft.steps, i) })}
            onRemove={() => set({ steps: removeStep(draft.steps, i) })}
            audienceEntry={audienceEntry}
          />
        ))}

        <div className="ox-rt-add" role="group" aria-label={T.send.plus}>
          <span className="ox-rt-add-label">
            <Icon name="add" size={18} />
            {T.send.plus}
          </span>
          {addKinds.map((k) => (
            <button
              key={k}
              type="button"
              className="ox-rt-add-btn"
              disabled={full}
              onClick={() => set({ steps: [...draft.steps, newStep(k)] })}
            >
              {T.stepAdd[k]}
            </button>
          ))}
        </div>

        <div className="ox-rt-rules">
          {(['lock', 'notAuthor', 'commentOnBack', 'escalate'] as const).map((k) => (
            <Switch
              key={k}
              checked={draft.rules[k]}
              onChange={(v) => set({ rules: { ...draft.rules, [k]: v } })}
              label={T.send.rules[k][0]}
              description={T.send.rules[k][1]}
            />
          ))}
        </div>

        <div className="ox-rt-project">
          <Icon name="view_kanban" size={20} />
          <span>{T.send.project}</span>
          <strong>{T.send.projectValue}</strong>
        </div>

        </div>
        <aside className="ox-rt-aside" aria-label={T.send.what}>
          <h3 className="ox-rt-aside-title">{T.send.what}</h3>
          {dryFailed ? <p className="ox-rt-note">{T.send.whatFail}</p> : null}
          <ul className="ox-rt-conseq-list">
            {conseq.map((c, i) => (
              <li key={i} className="ox-rt-conseq">
                <Icon name="info" size={18} />
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <div className="ox-rt-sheet" role="group" aria-label={T.send.sheetPreview}>
            <div className="ox-rt-sheet-foot">
              <Icon name="fact_check" size={18} />
              <strong>{T.send.sheetPreview}</strong>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="ox-rt-sheet-row">
                <span>{r.step}</span>
                <span>{r.who}</span>
                <span>{r.result}</span>
              </div>
            ))}
            <div className="ox-rt-sheet-foot">
              <span className="ox-rt-sha">{`v${nextVersion}`}</span>
            </div>
          </div>
          <span className="ox-rt-note">{T.send.sidebarHint}</span>
        </aside>
        </div>

        {shownError ? (
          <div role="alert" className="ox-rt-alert">
            <Icon name="error" size={18} />
            <span>{shownError}</span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function StepCard(p: {
  i: number;
  s: StepDraft;
  due: string;
  people: readonly Person[];
  author: string;
  notAuthor: boolean;
  audienceOptions: readonly { value: string; label: string }[];
  audienceEntry: (v: string) => S['DocShareEntry'] | undefined;
  onChange: (patch: Partial<StepDraft>) => void;
  onUp: () => void;
  onRemove: () => void;
}): ReactElement {
  const { s, i } = p;
  const name = T.step[s.kind];
  const byId = (id: string): Person | undefined => p.people.find((x) => x.id === id);
  const candidates = p.people.filter(
    (m) => !s.whoMemberIds.includes(m.id) && !(p.notAuthor && m.id === p.author),
  );
  const audienceTaken = new Set(s.audience.map((e) => `${e.who}:${e.refId ?? ''}`));
  return (
    <section
      className="ox-rt-card"
      data-first={i === 0 ? 'true' : 'false'}
      aria-label={`${T.send.stepAria} ${i + 1} · ${name}`}
    >
      <div className="ox-rt-card-head">
        <span className="ox-rt-num" aria-hidden="true">
          {i + 1}
        </span>
        <h3 className="ox-rt-card-name">{name}</h3>
        <label className="ox-rt-days">
          {T.send.days}
          <select
            value={String(s.days)}
            aria-label={T.send.daysAria}
            onChange={(e) => p.onChange({ days: Number(e.target.value) })}
          >
            {T.send.daysOptions.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {`${T.send.until} ${p.due}`}
        </label>
        <span className="ox-rt-grow" />
        {s.kind === 'sign' || s.kind === 'external' ? (
          <span className="ox-rt-chip">
            <Icon name="verified" size={15} />
            {s.kind === 'sign' ? T.send.chipSign : T.send.chipExternal}
          </span>
        ) : null}
        <button
          type="button"
          className="ox-rt-ibtn"
          aria-label={T.send.up}
          disabled={i === 0}
          onClick={p.onUp}
        >
          <Icon name="arrow_upward" size={16} />
        </button>
        <button
          type="button"
          className="ox-rt-ibtn"
          aria-label={T.send.remove}
          onClick={p.onRemove}
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      {s.kind === 'approve' ? (
        <div role="radiogroup" aria-label={T.modeAria} className="ox-rt-modes">
          {(['all', 'seq', 'any'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={s.mode === m}
              className="ox-rt-mode"
              onClick={() => p.onChange({ mode: m })}
            >
              {T.mode[m]}
            </button>
          ))}
        </div>
      ) : null}

      {(s.kind === 'approve' || s.kind === 'sign') &&
        s.whoMemberIds.map((id, j) => {
          const m = byId(id);
          return (
            <div key={id} className="ox-rt-person">
              {s.kind === 'approve' && s.mode === 'seq' ? (
                <span className="ox-rt-ord">{j + 1}</span>
              ) : null}
              <span className="ox-rt-person-main">
                <strong>{m?.name ?? T.send.unknownPerson}</strong>
                {s.kind === 'sign' ? <span>{T.send.signerHint}</span> : null}
              </span>
              {m?.invited ? (
                <span className="ox-rt-warn">
                  <Icon name="schedule" size={15} />
                  {T.send.invited}
                </span>
              ) : null}
              <button
                type="button"
                className="ox-rt-ibtn"
                data-bare="true"
                aria-label={`${T.send.removePerson}: ${m?.name ?? T.send.unknownPerson}`}
                onClick={() => p.onChange({ whoMemberIds: s.whoMemberIds.filter((x) => x !== id) })}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          );
        })}

      {s.kind === 'approve' || s.kind === 'sign' ? (
        candidates.length ? (
          <Select
            value=""
            aria-label={
              s.kind === 'approve'
                ? T.send.addApprover
                : s.whoMemberIds.length
                  ? T.send.replaceSigner
                  : T.send.pickSigner
            }
            placeholder={
              s.kind === 'approve'
                ? T.send.addApprover
                : s.whoMemberIds.length
                  ? T.send.replaceSigner
                  : T.send.pickSigner
            }
            options={candidates.map((m) => ({ value: m.id, label: m.name }))}
            onChange={(v) => {
              if (!v) return;
              p.onChange({ whoMemberIds: s.kind === 'approve' ? [...s.whoMemberIds, v] : [v] });
            }}
          />
        ) : (
          <span className="ox-rt-note">{T.send.noPeople}</span>
        )
      ) : null}

      {s.kind === 'ack' ? (
        <>
          {s.audience.map((e, j) => (
            <div key={`${e.who}:${e.refId ?? j}`} className="ox-rt-person">
              <span className="ox-rt-person-main">
                <strong>{e.label ?? e.who}</strong>
              </span>
              <button
                type="button"
                className="ox-rt-ibtn"
                data-bare="true"
                aria-label={`${T.send.removePerson}: ${e.label ?? e.who}`}
                onClick={() => p.onChange({ audience: s.audience.filter((_, k) => k !== j) })}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
          <Select
            value=""
            aria-label={T.send.addAudience}
            placeholder={T.send.addAudience}
            options={p.audienceOptions.filter((o) => !audienceTaken.has(o.value))}
            onChange={(v) => {
              const e = p.audienceEntry(v);
              if (e) p.onChange({ audience: [...s.audience, e] });
            }}
          />
          <span className="ox-rt-noteline">
            <Icon name="info" size={16} />
            {T.send.audienceNote}
          </span>
        </>
      ) : null}

      {s.kind === 'external' ? (
        <>
          <Field label={T.send.customerName}>
            <TextInput value={s.externalName} onChange={(v) => p.onChange({ externalName: v })} />
          </Field>
          <Field label={T.send.customerPhone}>
            <TextInput
              value={s.externalPhone}
              inputMode="tel"
              onChange={(v) => p.onChange({ externalPhone: v })}
            />
          </Field>
          <span className="ox-rt-noteline">
            <Icon name="info" size={16} />
            {T.send.customerHint}
          </span>
        </>
      ) : null}

      {s.kind === 'approve'
        ? s.whoMemberIds
            .filter((id) => byId(id) && (byId(id) as Person).invited)
            .slice(0, 1)
            .map((id) => (
              <span key={id} className="ox-rt-noteline">
                <Icon name="info" size={16} />
                {T.send.invitedNote}
              </span>
            ))
        : null}
    </section>
  );
}
