// W4.23 · Вкладка «Действия после ответа» (`forms-actions`; эталон design-2026-10-19 «Формы и опросы.dc.html»
// dc:324–410, actionsVM dc:915–984; разбор forms.md §1.7): карточки правил (`listFormRules`) — «Включено»
// (`updateFormRule {enabled}`), «Открыть страницу», «Перенести прошлые ответы · N» (`backfillFormRule`), «Изменить»,
// «Удалить действие» (`deleteFormRule`), «Не выполнено для N ответов…»; редактор пяти видов (`createFormRule`,
// `updateFormRule` — правило vN+1): задача (проект — no-reference, исполнитель — участники проекта), уведомление
// (сотрудники `listMembers`), письмо, HTTP (пояснения показа — Q-W4.00-forms-15), «в БЗ» (kb-rule.tsx; новая страница
// и таблица — `createKnowledgeNode`, `createKnowledgeTable`, затем правило: «Сохраняем…» в несколько шагов).
import { format, formsResults as F } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';

import {
  commands,
  formsKey,
  useDraft,
  useForm,
  useMembers,
  useProjectMembers,
  useProjects,
  useProjectsMembers,
  useResponses,
  useRules,
  useVersions,
} from './api.ts';
import { Failed, Glyph, Pending, useApi, useCmd } from './ctx.tsx';
import { KbRuleEditor, useKbPages } from './kb-rule.tsx';
import {
  condFields,
  condValues,
  draftOf,
  type Form,
  KIND_ICON,
  KINDS,
  kbOwnerAccess,
  kbSeenByAll,
  labelsByKey,
  NEW,
  newDraft,
  type Rule,
  ruleBody,
  type RuleDraft,
  ruleError,
  ruleMeta,
  ruleText,
} from './model.ts';
import { FR_TEXT } from './texts.ts';
import './results.css';

const A = F.actions;

/** «Изменить»: условие, когда и объект вида — без вида и «Включено» (FormRulePatch). */
const patchOf = (b: ReturnType<typeof ruleBody>): Parameters<typeof commands.updateRule>[4] => ({
  trigger: b.trigger,
  ...(b.condition ? { condition: b.condition } : {}),
  ...(b.task ? { task: b.task } : {}),
  ...(b.notify ? { notify: b.notify } : {}),
  ...(b.email ? { email: b.email } : {}),
  ...(b.http ? { http: b.http } : {}),
  ...(b.kb ? { kb: b.kb } : {}),
});

/** Переход на страницу «Базы знаний» (onNav('kb', pageId) эталона, dc:905): пространство — из узла. */
export function useOpenKb(tenantId: string): (nodeId: string) => Promise<void> {
  const api = useApi();
  const navigate = useNavigate();
  return useCallback(
    async (nodeId: string) => {
      const node = await commands.kbNode(api, tenantId, nodeId);
      await navigate({
        to: '/t/$tenantId/$page',
        params: { tenantId, page: 'knowledge' },
        search: { space: node.spaceId, page: node.id } as never,
      });
    },
    [api, navigate, tenantId],
  );
}

function RuleCard(p: {
  rule: Rule;
  form: Form;
  text: string;
  meta: string;
  ro: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onDel: () => void;
  onOpen: () => void;
  onBackfill: () => void;
}): ReactElement {
  const { rule: r } = p;
  const kb = r.kind === 'kb';
  return (
    <div className="ox-fr-rule">
      <span className="ox-fr-rule-icon" aria-hidden="true">
        <Glyph name={KIND_ICON[r.kind]} size={20} />
      </span>
      <div className="ox-fr-rule-body">
        <strong>{A.kinds[r.kind]}</strong>
        <span className="ox-fr-rule-text">{p.text}</span>
        <span className="ox-fr-rule-meta">{p.meta}</span>
      </div>
      <label className="ox-fr-rule-on">
        <input
          type="checkbox"
          checked={r.enabled}
          disabled={p.ro}
          aria-disabled={p.busy || undefined}
          onChange={(e) => !p.busy && p.onToggle(e.target.checked)}
        />
        {A.card.on}
      </label>
      {kb && r.kb?.node ? (
        <button type="button" className="ox-fr-btn" onClick={p.onOpen}>
          <Glyph name="open_in_new" size={18} />
          {A.card.open}
        </button>
      ) : null}
      {kb && !p.ro && r.enabled && r.pendingBackfillCount > 0 ? (
        <button type="button" className="ox-fr-btn" data-accent="" onClick={p.onBackfill}>
          <Glyph name="history" size={18} />
          {format(A.card.backfill, { n: r.pendingBackfillCount })}
        </button>
      ) : null}
      {!p.ro ? (
        <>
          <button type="button" className="ox-fr-btn" data-plain="" onClick={p.onEdit}>
            {A.card.edit}
          </button>
          <button
            type="button"
            className="ox-fr-icon-btn"
            aria-label={A.card.del}
            onClick={p.onDel}
          >
            <Glyph name="delete" size={18} />
          </button>
        </>
      ) : null}
      {r.failedCount > 0 ? (
        <span role="status" className="ox-fr-rule-fail">
          <Glyph name="error" size={16} />
          {format(A.card.fail, { n: r.failedCount })}
        </span>
      ) : null}
    </div>
  );
}

export function ActionsTab({
  tenantId,
  formId,
}: {
  tenantId: string;
  formId: string;
}): ReactElement {
  const api = useApi();
  const fq = useForm(tenantId, formId);
  const rules = useRules(tenantId, formId);
  const draftQ = useDraft(tenantId, formId);
  const versions = useVersions(tenantId, formId);
  const { cmd, busy } = useCmd(tenantId);
  const [ed, setEd] = useState<(RuleDraft & { err: string; saving: boolean }) | null>(null);
  /** «Включено» сразу на экране до ответа сервера. */
  const [on, setOn] = useState<Record<string, boolean>>({});
  const editing = !!ed;
  const kbOpen = ed?.kind === 'kb';
  const members = useMembers(tenantId, true);
  const ruleProjects = useProjectsMembers(
    tenantId,
    (rules.data ?? []).flatMap((r) => (r.task ? [r.task.projectId] : [])),
  );
  const qc = useQueryClient();
  const projects = useProjects(tenantId, ed?.kind === 'task');
  const projectId = ed?.kind === 'task' ? ed.projectId || projects.data?.[0]?.id || '' : '';
  const pm = useProjectMembers(tenantId, projectId);
  const kb = useKbPages(tenantId, kbOpen);
  const responses = useResponses(tenantId, formId, kbOpen);
  const openKb = useOpenKb(tenantId);
  const set = useCallback(
    (patch: Partial<RuleDraft>) => setEd((e) => (e ? { ...e, ...patch, err: '' } : e)),
    [],
  );
  const setAuto = useCallback(
    (patch: Partial<RuleDraft>) => setEd((e) => (e ? { ...e, ...patch } : e)),
    [],
  );

  // Карточки — после имён сотрудников (без мелькания «без исполнителя»); ошибки справочников карточки не держат.
  // Фокус: редактор открыт — на его заголовке (кнопки «добавить» на это время скрыты, canAdd dc:965); закрыт — на
  // кнопке, которая его открыла, а если её больше нет — на кнопке «добавить» того же вида.
  const opener = useRef<{ el: Element | null; kind: Rule['kind'] } | null>(null);
  const head = useRef<HTMLHeadingElement | null>(null);
  const adds = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (editing) {
      head.current?.focus();
      return;
    }
    const o = opener.current;
    if (!o) return;
    opener.current = null;
    const back =
      o.el instanceof HTMLElement && o.el.isConnected
        ? o.el
        : adds.current?.querySelector<HTMLElement>(`[data-kind="${o.kind}"]`);
    back?.focus();
  }, [editing]);

  // «Удалить действие»: кнопка уходит вместе с карточкой — фокус (если он потерян) на первый элемент карточки, вставшей
  // на её место (или предыдущей), без карточек — на первую кнопку «добавить».
  const box = useRef<HTMLDivElement | null>(null);
  const gone = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    const g = gone.current;
    if (!g || !rules.data || rules.data.some((x) => x.id === g.id)) return;
    gone.current = null;
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected) return;
    const cards = box.current?.querySelectorAll<HTMLElement>('.ox-fr-rule');
    const card = cards?.[g.at] ?? cards?.[g.at - 1];
    const next =
      card?.querySelector<HTMLElement>('input, button') ??
      adds.current?.querySelector<HTMLElement>('button');
    next?.focus();
  }, [rules.data]);

  // Ошибка — карточкой, только если данных нет: отказ перечитывания при данных в кэше вкладку не роняет.
  const namesPending = members.isPending || ruleProjects.some((q) => q.isPending);
  if (!fq.data || !rules.data || namesPending)
    return (
      <div className="ox-fr-ac">
        {!fq.data && fq.isError ? (
          <Failed q={fq} />
        ) : !rules.data && rules.isError ? (
          <Failed q={rules} />
        ) : (
          <Pending rows={3} />
        )}
      </div>
    );
  const f = fq.data.form;
  const ro = !f.my.manage;
  const def = draftQ.data?.draft.definition;
  const qs = labelsByKey([def, ...(versions.data ?? []).map((v) => v.definition)]);
  const names = new Map((members.data ?? []).map((m) => [m.id, m.displayName]));
  // Исполнитель задачи — участник проекта правила: listMembers логиста — только его область (без него самого),
  // а участники проекта (listTaskProjectMembers) знают и его. Чего нет и там — «сотрудник вне вашей области».
  for (const q of ruleProjects)
    for (const m of q.data?.items ?? []) names.set(m.memberId, m.displayName);
  for (const m of pm.data?.items ?? []) names.set(m.memberId, m.displayName);
  const who = (id: string) => names.get(id);
  const active = (members.data ?? []).filter((m) => m.status === 'active');

  const toggle = (r: Rule, v: boolean) => {
    setOn((x) => ({ ...x, [r.id]: v }));
    void cmd(
      ['enable', r.id, v],
      (key) => commands.updateRule(api, tenantId, formId, r, { enabled: v }, key),
      v ? A.toast.on : A.toast.off,
      // Новая ревизия правила — в карточку сразу: следующее переключение до перечитывания — без 412.
      {
        onData: (rule) =>
          qc.setQueryData<Rule[]>([...formsKey(tenantId), 'rules', formId], (list) =>
            list?.map((x) => (x.id === rule.id ? rule : x)),
          ),
      },
    ).finally(() =>
      setOn((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== r.id))),
    );
  };
  const del = (r: Rule) => {
    gone.current = { id: r.id, at: (rules.data ?? []).findIndex((x) => x.id === r.id) };
    void cmd(
      ['delete', r.id],
      (key) => commands.deleteRule(api, tenantId, formId, r, key),
      r.kind === 'kb' ? A.toast.deletedKb : A.toast.deleted,
    ).then((res) => {
      if (!res.ok && gone.current?.id === r.id) gone.current = null;
    });
  };
  const backfill = (r: Rule) =>
    void cmd(
      ['backfill', r.id],
      (key) => commands.backfill(api, tenantId, formId, r.id, key),
      (res) =>
        res.added
          ? format(A.toast.backfilled, { n: res.added }) +
            (res.failed
              ? format(A.toast.backfillPart, { n: res.failed, err: res.error ?? '' })
              : '')
          : res.failed
            ? format(A.toast.backfillFail, { err: res.error ?? '' })
            : A.toast.nothing,
    );
  const edit = (r: Rule) => {
    opener.current = { el: document.activeElement, kind: r.kind };
    setEd({ ...draftOf(r, f), err: '', saving: false });
  };
  const add = (kind: Rule['kind']) => {
    opener.current = { el: document.activeElement, kind };
    const first = active[0]?.id ?? '';
    setEd({ ...newDraft(kind, f, { assignee: '', to: first }), err: '', saving: false });
  };

  const save = async () => {
    if (!ed || ed.saving) return;
    const r = ed;
    // Проект и исполнитель по умолчанию: первый проект и первый участник (assignee эталона — первый сотрудник).
    const projectId = r.projectId || projects.data?.[0]?.id || '';
    const assignee = r.assignee || pm.data?.items[0]?.memberId || '';
    // «Понимаю…» — по доступу страницы на момент сохранения (не по выбору, сделанному до загрузки дерева).
    const draft =
      r.kind === 'task'
        ? { ...r, projectId, assignee }
        : r.kind === 'kb'
          ? { ...r, allSee: kbSeenByAll(r, (id) => kb.pages.find((x) => x.id === id)?.listed) }
          : r;
    const err = ruleError(draft, {
      pageExists: (space, title) =>
        kb.pages.some((x) => x.spaceId === space && x.title.toLowerCase() === title.toLowerCase()),
      canOwnerOnly: kb.canOwnerOnly,
    });
    if (err) {
      setEd({ ...r, err });
      return;
    }
    setEd({ ...r, saving: true, err: '' });
    const fail = (text: string) => setEd((e) => (e ? { ...e, saving: false, err: text } : e));
    const done = (ok: boolean) => {
      if (ok) setEd(null);
      else setEd((e) => (e ? { ...e, saving: false } : e));
    };
    const put = async (
      body: ReturnType<typeof ruleBody>,
      okText: string | null,
      onError = fail,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!r.id) {
        return cmd(
          ['create', body],
          (key) => commands.createRule(api, tenantId, formId, body, key),
          okText ?? A.toast.added,
          { onError },
        );
      }
      const rule = rules.data?.find((y) => y.id === r.id);
      if (!rule) return { ok: false };
      const patch = patchOf(body);
      return cmd(
        ['update', r.id, patch],
        (key) => commands.updateRule(api, tenantId, formId, rule, patch, key),
        (res) => okText ?? format(A.toast.updated, { n: res.version }),
        { onError },
      );
    };
    if (draft.kind !== 'kb') {
      done((await put(ruleBody(draft), null)).ok);
      return;
    }
    const tableMode = draft.mode === 'table';
    const cols = draft.fields.map((m) => ({ name: m.name.trim(), type: 'text' }));
    if (draft.page === NEW) {
      const title = draft.np.title.trim();
      const node = await cmd(
        ['kb-node', draft.np.space, title],
        (key) => commands.createKbNode(api, tenantId, draft.np.space, title, key),
        null,
        { onError: fail },
      );
      if (!node.ok || !node.data) return done(false);
      const nodeId = node.data.id;
      // «Только владелец»: страница создана с доступом пространства — сразу «Только выбранные» без записей. Не вышло —
      // правило не создаётся: страница выбрана как есть (все сотрудники), сохранить можно только с «Понимаю…».
      const access = kbOwnerAccess(draft);
      if (access) {
        const x = await cmd(
          ['kb-access', nodeId],
          (key) => commands.setKbAccess(api, tenantId, nodeId, access, key),
          null,
          { onError: () => undefined },
        );
        if (!x.ok) {
          void qc.invalidateQueries({ queryKey: ['tenant', tenantId, 'knowledge'] });
          setEd((e) =>
            e
              ? {
                  ...e,
                  page: nodeId,
                  table: '',
                  allSee: true,
                  ack: false,
                  saving: false,
                  err: format(FR_TEXT.accessFailed, {
                    err: (x.error ?? '').replace(/\.$/, ''),
                  }),
                }
              : e,
          );
          return;
        }
      }
      let tableId: string | undefined;
      let fields = draft.fields;
      if (tableMode) {
        const t = await cmd(
          ['kb-table', nodeId, draft.newTitle, cols],
          (key) =>
            commands.createKbTable(
              api,
              tenantId,
              nodeId,
              { title: draft.newTitle.trim(), columns: cols },
              key,
            ),
          null,
          { onError: fail },
        );
        if (!t.ok || !t.data) {
          setEd((e) => (e ? { ...e, page: nodeId, saving: false } : e));
          return;
        }
        tableId = t.data.id;
        const tc = t.data.columns;
        fields = draft.fields.map((m, i) => ({ ...m, ...(tc[i] ? { columnId: tc[i].id } : {}) }));
      }
      const ok = tableMode
        ? format(A.toast.pageTable, { page: title, table: draft.newTitle.trim() })
        : format(A.toast.page, { page: title });
      // Правило не сохранилось (любая ошибка, и «нет связи», и 429 — dc:665): страница и таблица уже созданы — они
      // выбраны в редакторе, «Сохраняем…» снят, повтор сохраняет только правило. Тексты QUIET — без тоста оболочки.
      const saved = await put(
        ruleBody(draft, { nodeId, ...(tableId ? { tableId } : {}), fields }),
        ok,
        () => undefined,
      );
      if (saved.ok) {
        setEd(null);
        return;
      }
      void qc.invalidateQueries({ queryKey: ['tenant', tenantId, 'knowledge'] });
      setEd((e) =>
        e
          ? {
              ...e,
              page: nodeId,
              table: tableId ?? '',
              fields,
              saving: false,
              err: format(A.errors.pageOnly, { err: saved.error ?? '' }),
            }
          : e,
      );
      return;
    }
    if (tableMode && draft.table === NEW) {
      const pageTitle = kb.pages.find((x) => x.id === draft.page)?.title ?? '';
      const t = await cmd(
        ['kb-table', draft.page, draft.newTitle, cols],
        (key) =>
          commands.createKbTable(
            api,
            tenantId,
            draft.page,
            { title: draft.newTitle.trim(), columns: cols },
            key,
          ),
        null,
        { onError: fail },
      );
      if (!t.ok || !t.data) return done(false);
      const tc = t.data.columns;
      const fields = draft.fields.map((m, i) => ({
        ...m,
        ...(tc[i] ? { columnId: tc[i].id } : {}),
      }));
      done(
        (
          await put(
            ruleBody(draft, { nodeId: draft.page, tableId: t.data.id, fields }),
            format(A.toast.table, { table: draft.newTitle.trim(), page: pageTitle }),
          )
        ).ok,
      );
      return;
    }
    done((await put(ruleBody(draft), null)).ok);
  };

  const list = rules.data;
  const E = A.editor;
  const pub = f.settings.access === 'public';
  const whenOff = ed?.kind === 'kb' && pub;

  return (
    <div className="ox-fr-ac" ref={box}>
      <p className="ox-fr-intro">{A.intro}</p>
      {list.map((r) => (
        <RuleCard
          key={r.id}
          rule={r.id in on ? { ...r, enabled: on[r.id] ?? r.enabled } : r}
          form={f}
          text={ruleText(r, who)}
          meta={ruleMeta(r, qs)}
          ro={ro}
          busy={busy}
          onToggle={(on) => toggle(r, on)}
          onEdit={() => edit(r)}
          onDel={() => del(r)}
          onOpen={() => r.kb?.node && void openKb(r.kb.node.id)}
          onBackfill={() => backfill(r)}
        />
      ))}
      {!list.length ? <div className="ox-fr-empty">{A.empty}</div> : null}
      {ed ? (
        <div className="ox-fr-red">
          <h3 ref={head} tabIndex={-1}>
            {format(ed.id ? E.titleEdit : E.titleNew, { kind: A.kinds[ed.kind].toLowerCase() })}
          </h3>
          <div className="ox-fr-red-row">
            <label className="ox-fr-field ox-fr-w200">
              {E.when}
              <select
                value={whenOff ? 'accepted' : ed.trigger}
                disabled={whenOff}
                onChange={(e) => set({ trigger: e.target.value as RuleDraft['trigger'] })}
              >
                <option value="submitted">{E.whenSubmitted}</option>
                <option value="accepted">{E.whenAccepted}</option>
              </select>
            </label>
            <label className="ox-fr-field ox-fr-w240">
              {E.only}
              <select
                value={ed.condField}
                onChange={(e) => {
                  const k = e.target.value;
                  set({ condField: k, condValue: k ? (condValues(def, k)[0]?.value ?? '') : '' });
                }}
              >
                <option value="">{E.all}</option>
                {condFields(def).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {ed.condField ? (
              <label className="ox-fr-field ox-fr-w160">
                {E.eq}
                <select value={ed.condValue} onChange={(e) => set({ condValue: e.target.value })}>
                  {condValues(def, ed.condField).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {ed.kind === 'task' ? (
            <>
              <div className="ox-fr-red-row">
                <label className="ox-fr-field ox-fr-w260">
                  {E.taskTitle}
                  <input
                    value={ed.title}
                    maxLength={200}
                    onChange={(e) => set({ title: e.target.value })}
                  />
                </label>
                <label className="ox-fr-field ox-fr-w200">
                  {FR_TEXT.project}
                  <select
                    value={ed.projectId || projects.data?.[0]?.id || ''}
                    onChange={(e) => set({ projectId: e.target.value, assignee: '' })}
                  >
                    {(projects.data ?? []).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ox-fr-field ox-fr-w200">
                  {E.assignee}
                  <select
                    value={ed.assignee || pm.data?.items[0]?.memberId || ''}
                    onChange={(e) => set({ assignee: e.target.value })}
                  >
                    {(pm.data?.items ?? [])
                      .filter((m) => m.memberStatus !== 'suspended')
                      .map((m) => (
                        <option key={m.memberId} value={m.memberId}>
                          {m.displayName}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <span className="ox-fr-note">{E.taskNote}</span>
            </>
          ) : null}
          {ed.kind === 'notify' ? (
            <label className="ox-fr-field">
              {E.to}
              <select value={ed.to} onChange={(e) => set({ to: e.target.value })}>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {ed.kind === 'email' ? (
            <>
              <label className="ox-fr-field">
                {E.address}
                <input
                  type="email"
                  value={ed.to}
                  placeholder={E.emailPh}
                  maxLength={254}
                  onChange={(e) => set({ to: e.target.value })}
                />
              </label>
              <span className="ox-fr-note" data-tone="warn">
                {FR_TEXT.emailNote}
              </span>
            </>
          ) : null}
          {ed.kind === 'http' ? (
            <>
              <label className="ox-fr-field">
                {E.url}
                <input
                  type="url"
                  className="ox-fr-mono"
                  value={ed.url}
                  placeholder={E.urlPh}
                  maxLength={2000}
                  onChange={(e) => set({ url: e.target.value })}
                />
              </label>
              <span className="ox-fr-note" data-tone="warn">
                {FR_TEXT.httpNote}
              </span>
            </>
          ) : null}
          {whenOff ? <span className="ox-fr-note">{E.publicKb}</span> : null}
          {ed.kind === 'kb' ? (
            <KbRuleEditor
              tenantId={tenantId}
              form={f}
              def={def}
              draft={ed}
              set={set}
              setAuto={setAuto}
              kb={kb}
              responses={responses.data ?? []}
              versions={versions.data ?? []}
            />
          ) : null}
          {ed.err ? (
            <span role="alert" className="ox-fr-err">
              {ed.err}
            </span>
          ) : null}
          <div className="ox-fr-red-btns">
            <button
              type="button"
              className="ox-fr-btn"
              data-primary=""
              aria-disabled={ed.saving || undefined}
              aria-busy={ed.saving}
              onClick={() => void save()}
            >
              {ed.saving ? E.saving : E.save}
            </button>
            <button
              type="button"
              className="ox-fr-btn"
              data-plain=""
              disabled={ed.saving}
              onClick={() => !ed.saving && setEd(null)}
            >
              {E.cancel}
            </button>
          </div>
        </div>
      ) : null}
      {!ro && !editing ? (
        <div ref={adds} className="ox-fr-adds">
          {KINDS.map((k) => (
            <button key={k} type="button" data-kind={k} onClick={() => add(k)}>
              <Glyph name={KIND_ICON[k]} size={18} />
              {A.kinds[k]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
