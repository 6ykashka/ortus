// W7.26 · Модель блока «Маршрут документа»: чистые функции без часов и запросов. Подписи шагов, «Сейчас», возврат,
// права кнопок по `my.wait` сервера, лист согласования и форма «На согласование» (эталон «Документы.dc.html»
// routeBarVM :970–1005, routeDlgVM :1386–1451; контракт 0.12.0-stage7, тег Docs). Права клиент не пересчитывает:
// кнопки решения показываются по `my.wait`, остальное решает сервер (403).
import type { components } from '@ortus/api-client';

import { ROUTE_TEXT as T } from './texts.ts';

type S = components['schemas'];
export type Route = S['DocRoute'];
export type Step = S['DocRouteStep'];
export type StepKind = Step['kind'];
export type StepMode = Step['mode'];
export type Rules = Route['rules'];

const MSK = 'Europe/Moscow';

// ───────────────────────────── даты ─────────────────────────────

/** «ДД.ММ» из даты `YYYY-MM-DD`. */
export const ddmm = (iso: string | null | undefined): string =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '';

/** «ДД.ММ ЧЧ:ММ» момента в поясе организации (по умолчанию МСК). */
export function dateTime(iso: string, timeZone: string = MSK): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')} ${get('hour')}:${get('minute')}`;
}

/** Дата `YYYY-MM-DD` через `n` рабочих дней (суббота и воскресенье не считаются). */
export function addWorkDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  let left = Math.max(0, Math.trunc(n));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

// ───────────────────────────── полоса маршрута ─────────────────────────────

export const barTitle = (r: Route): string =>
  `${r.status === 'done' ? T.titleDone : T.titleActive} · v${r.version}`;

const okCount = (s: Step): number => s.decisions.filter((d) => d.decision === 'ok').length;
const doneCount = (s: Step): number => s.done?.length ?? 0;

/** Подпись под названием шага (чип): «все сразу · 1 из 2», «Дарья Зимина · ПЭП», «1 из 3», «подписал(а)». */
export function stepSub(s: Step): string {
  switch (s.kind) {
    case 'approve':
      return `${T.mode[s.mode].toLowerCase()} · ${okCount(s)} ${T.sub.of} ${s.mode === 'any' ? 1 : s.who.length}`;
    case 'sign':
      return `${s.who[0]?.displayName ?? ''}${s.status === 'done' ? ` · ${T.sub.pep}` : ''}`;
    case 'ack':
      if (s.status === 'wait') return T.sub.ackWait;
      return s.who.length
        ? `${doneCount(s)} ${T.sub.of} ${s.who.length}`
        : `${T.sub.ackSome}: ${doneCount(s)}`;
    case 'external':
      return s.status === 'done' ? T.sub.externalDone : (s.external?.name ?? '');
  }
}

export interface StepView {
  n: string;
  name: string;
  sub: string;
  icon: 'check_circle' | 'radio_button_checked' | 'undo' | 'radio_button_unchecked';
  state: 'done' | 'active' | 'back' | 'wait';
}

export function stepView(r: Route, i: number): StepView {
  const s = r.steps[i] as Step;
  const base = { n: String(i + 1), name: s.name, sub: stepSub(s) };
  if (r.status === 'done' || s.status === 'done') {
    return { ...base, icon: 'check_circle', state: 'done' };
  }
  if (r.status === 'returned' && i === r.currentStep) {
    return { ...base, icon: 'undo', state: 'back' };
  }
  if (r.status === 'active' && s.status === 'active') {
    return { ...base, icon: 'radio_button_checked', state: 'active' };
  }
  return { ...base, icon: 'radio_button_unchecked', state: 'wait' };
}

/** Кто ещё должен действовать на шаге (имена; заказчик — с пометкой; ознакомление — по аудитории). */
export function waiting(s: Step): string[] {
  if (s.kind === 'external') {
    return s.external?.name ? [`${s.external.name} (${T.now.customer})`] : [];
  }
  if (s.kind === 'ack') {
    if (s.who.length) {
      const done = new Set((s.done ?? []).map((d) => d.member.memberId));
      return s.who.filter((w) => !done.has(w.memberId)).map((w) => w.displayName);
    }
    return (s.audience ?? []).map((e) => e.label ?? '').filter(Boolean);
  }
  const ok = new Set(s.decisions.filter((d) => d.decision === 'ok').map((d) => d.member.memberId));
  return s.who.filter((w) => !ok.has(w.memberId)).map((w) => w.displayName);
}

const lastAt = (r: Route): string => {
  const all = r.steps.flatMap((s) => [
    ...s.decisions.map((d) => d.at),
    ...(s.done ?? []).map((d) => d.at),
  ]);
  return all.sort().at(-1) ?? '';
};

/** Строка «Сейчас» полосы: «Шаг 1 «Согласовать» · до 02.10. Ждут: …» / «Завершён 03.10.». */
export function nowText(r: Route): string {
  if (r.status === 'done') {
    const at = lastAt(r);
    return `${T.now.ended}${at ? ` ${dateTime(at).slice(0, 5)}` : ''}.`;
  }
  if (r.status !== 'active') return '';
  const s = r.steps[r.currentStep];
  if (!s) return '';
  const names = waiting(s);
  const due = s.due ? ` · ${T.now.due} ${ddmm(s.due)}` : '';
  return `${T.now.step} ${r.currentStep + 1} «${s.name}»${due}.${names.length ? ` ${T.now.waiting}: ${names.join(', ')}.` : ''}`;
}

/** Плашка возврата: кто вернул, с чем, что делать автору. */
export function backText(r: Route, author: boolean): string {
  if (!r.back) return '';
  const head = `${r.back.name} ${T.back.returned} v${r.version} ${T.back.toRework}${r.back.comment ? `: «${r.back.comment}»` : ''}. `;
  return (
    head +
    (author
      ? `${T.back.authorHint} «${r.steps[r.currentStep]?.name ?? ''}».`
      : `${T.back.atAuthor}: ${r.startedBy.displayName}.`)
  );
}

/** «Отправить снова» доступна, когда версия документа выросла после возврата. */
export function resumeState(
  docVersion: number,
  r: Route,
): { label: string; disabled: boolean; hint: string } {
  const edited = docVersion > r.version;
  return {
    label: `${T.resume.label} · v${docVersion}`,
    disabled: !edited,
    hint: edited ? '' : T.resume.hint,
  };
}

/** Что ждут от участника на активном маршруте (по `my.wait` сервера; «утвердить» важнее «согласовать»). */
export function myAction(
  wait: readonly S['DocWait'][],
  r: Route,
): 'approve' | 'sign' | 'ack' | null {
  if (r.status !== 'active') return null;
  const kinds = new Set(wait.map((w) => w.kind));
  if (kinds.has('sign')) return 'sign';
  if (kinds.has('approve')) return 'approve';
  if (kinds.has('ack')) return 'ack';
  return null;
}

/**
 * Идентификатор участника для текущего пользователя. Контекст входа отдаёт `membershipId`, а участники документа
 * названы `memberId`; совпадение по имени среди автора, шагов, решений и отметок надёжнее, без совпадения —
 * `membershipId` (Q-W7.26-9: контракту нужен `memberId` в `TenantContext`).
 */
export function meMemberId(
  r: Route | null,
  doc: { owner: S['DocMemberRef']; authors: readonly S['DocMemberRef'][] },
  membershipId: string,
  displayName: string,
): string {
  const refs: S['DocMemberRef'][] = [doc.owner, ...doc.authors];
  if (r) {
    refs.push(r.startedBy);
    for (const s of r.steps) {
      refs.push(
        ...s.who,
        ...s.decisions.map((d) => d.member),
        ...(s.done ?? []).map((d) => d.member),
      );
    }
  }
  return refs.find((x) => x.displayName === displayName)?.memberId ?? membershipId;
}

/** Автор маршрута: запустивший его или управляющий документом (окончательно решает сервер, 403). */
export const isAuthor = (r: Route, memberId: string, canManage: boolean): boolean =>
  r.startedBy.memberId === memberId || canManage;

export interface AuthorAction {
  id: 'closeAck' | 'cancel';
  label: string;
}

export function authorActions(r: Route, author: boolean): AuthorAction[] {
  if (!author) return [];
  const out: AuthorAction[] = [];
  const s = r.steps[r.currentStep];
  if (r.status === 'active' && s?.kind === 'ack' && s.status === 'active') {
    const total = s.who.length;
    out.push({
      id: 'closeAck',
      label: `${T.actions.closeAck} · ${total ? `${doneCount(s)} ${T.sub.of} ${total}` : doneCount(s)}`,
    });
  }
  if (r.status === 'active' || r.status === 'returned') {
    out.push({ id: 'cancel', label: T.actions.cancel });
  }
  return out;
}

export interface AckRecord {
  at: string;
  device: string;
}

/** Отметка «Ознакомлен» участника по любому шагу ознакомления. */
export function ackRecord(r: Route, memberId: string): AckRecord | null {
  for (const s of r.steps) {
    if (s.kind !== 'ack') continue;
    const rec = (s.done ?? []).find((d) => d.member.memberId === memberId);
    if (rec) return { at: rec.at, device: rec.device };
  }
  return null;
}

export const ackDoneText = (rec: AckRecord, version: number): string =>
  `${T.ack.done} ${dateTime(rec.at)} · v${version} · ${rec.device}`;

// ───────────────────────────── лист согласования ─────────────────────────────

export interface SheetRow {
  step: string;
  who: string;
  result: string;
  at: string;
}

/** Строки «Листа согласования»: шаг · участник · решение · время. */
export function sheetRows(r: Route): SheetRow[] {
  return r.steps.flatMap((s, i): SheetRow[] => {
    const step = `${i + 1} · ${s.name}`;
    const pending = s.status === 'wait' && i > 0 ? `${T.sheet.afterStep} ${i}` : T.sheet.waiting;
    if (s.kind === 'ack') {
      const labels = (s.audience ?? []).map((e) => e.label ?? '').filter(Boolean);
      const who = labels.join(', ') || s.who.map((w) => w.displayName).join(', ') || '—';
      const last =
        (s.done ?? [])
          .map((d) => d.at)
          .sort()
          .at(-1) ?? '';
      const result =
        s.status === 'wait'
          ? T.sub.ackWait
          : s.status === 'done'
            ? T.sheet.acked
            : `${T.sub.ackSome}: ${doneCount(s)}`;
      return [{ step, who, result, at: s.status === 'done' && last ? dateTime(last) : '' }];
    }
    if (s.kind === 'external') {
      const rec = s.decisions.find((d) => d.decision === 'ok');
      return [
        {
          step,
          who: s.external?.name ?? '—',
          result: rec ? T.sheet.signedLink : pending,
          at: rec ? dateTime(rec.at) : '',
        },
      ];
    }
    const people = s.who.length ? s.who : [undefined];
    return people.map((w): SheetRow => {
      const rec = w ? s.decisions.find((d) => d.member.memberId === w.memberId) : undefined;
      const result = !rec
        ? pending
        : rec.decision === 'back'
          ? T.sheet.returned
          : rec.method === 'click'
            ? T.sheet.approved
            : T.sheet.signed;
      return { step, who: w?.displayName ?? '—', result, at: rec ? dateTime(rec.at) : '' };
    });
  });
}

// ───────────────────────────── форма «На согласование» ─────────────────────────────

export interface StepDraft {
  kind: StepKind;
  mode: StepMode;
  days: number;
  whoMemberIds: string[];
  audience: S['DocShareEntry'][];
  externalName: string;
  externalPhone: string;
}

export interface RouteDraft {
  /** Название шаблона папки, с которого начали; пусто — «свой маршрут». */
  name: string;
  steps: StepDraft[];
  rules: Rules;
  saveAsFolderTemplate: boolean;
}

const DAYS: Record<StepKind, number> = { approve: 2, sign: 1, ack: 3, external: 3 };

export function newStep(kind: StepKind): StepDraft {
  return {
    kind,
    mode: 'all',
    days: DAYS[kind],
    whoMemberIds: [],
    audience: [],
    externalName: '',
    externalPhone: '',
  };
}

const DEFAULT_RULES: Rules = { lock: true, notAuthor: true, commentOnBack: true, escalate: false };

export function draftFromTemplate(tpl: S['DocRouteTemplate'] | undefined): RouteDraft {
  if (!tpl) {
    return {
      name: '',
      steps: [newStep('approve')],
      rules: { ...DEFAULT_RULES },
      saveAsFolderTemplate: false,
    };
  }
  return {
    name: tpl.name,
    steps: tpl.steps.map((s) => ({
      ...newStep(s.kind),
      ...(s.mode ? { mode: s.mode } : {}),
      days: s.days,
      whoMemberIds: [...(s.whoMemberIds ?? [])],
      audience: [...(s.audience ?? [])],
      externalName: s.externalName ?? '',
      externalPhone: s.externalPhone ?? '',
    })),
    rules: { ...DEFAULT_RULES, ...tpl.rules },
    saveAsFolderTemplate: false,
  };
}

export function moveStepUp(steps: readonly StepDraft[], i: number): StepDraft[] {
  if (i <= 0 || i >= steps.length) return steps as StepDraft[];
  const a = [...steps];
  [a[i - 1], a[i]] = [a[i] as StepDraft, a[i - 1] as StepDraft];
  return a;
}

export const removeStep = (steps: readonly StepDraft[], i: number): StepDraft[] =>
  steps.filter((_, k) => k !== i);

/** Ошибки формы по порядку шагов (тексты эталона). Пусто — можно отправлять. */
export function draftErrors(d: RouteDraft, ctx: { authorId: string; linked: boolean }): string[] {
  const errs: string[] = [];
  d.steps.forEach((s, i) => {
    const author = d.rules.notAuthor && s.whoMemberIds.includes(ctx.authorId);
    if (s.kind === 'approve') {
      if (!s.whoMemberIds.length) errs.push(`${T.now.step} ${i + 1}: ${T.err.stepApprovers}`);
      if (author) errs.push(T.err.authorApprove);
    } else if (s.kind === 'sign') {
      if (!s.whoMemberIds.length) errs.push(T.err.signer);
      if (author) errs.push(T.err.authorSign);
    } else if (s.kind === 'ack') {
      if (!s.audience.length) errs.push(T.err.audience);
    } else if (!ctx.linked) {
      errs.push(T.err.customerLink);
    } else if (!s.externalName.trim() || !s.externalPhone.trim()) {
      errs.push(T.err.customer);
    }
  });
  if (!d.steps.length) errs.push(T.err.noSteps);
  return errs;
}

function stepInput(s: StepDraft): S['DocRouteStepInput'] {
  switch (s.kind) {
    case 'approve':
      return { kind: 'approve', mode: s.mode, whoMemberIds: s.whoMemberIds, days: s.days };
    case 'sign':
      return { kind: 'sign', whoMemberIds: s.whoMemberIds, days: s.days };
    case 'ack':
      return { kind: 'ack', audience: s.audience, days: s.days };
    case 'external':
      return {
        kind: 'external',
        days: s.days,
        externalName: s.externalName.trim(),
        externalPhone: s.externalPhone.trim(),
      };
  }
}

/** Тело `startDocRoute`: флажок шаблона уходит только при праве `docs.templates.manage`. */
export function toStartBody(
  d: RouteDraft,
  o: { canSaveTemplate: boolean; dryRun?: boolean },
): S['DocRouteStart'] {
  return {
    steps: d.steps.map(stepInput),
    rules: { ...d.rules },
    ...(o.canSaveTemplate && d.saveAsFolderTemplate ? { saveAsFolderTemplate: true } : {}),
    ...(o.dryRun ? { dryRun: true } : {}),
  };
}

/** Черновик «Листа согласования» в форме: кто и после чего решает (эталон routeDlgVM, `sheet`). */
export function previewRows(d: RouteDraft, nameOf: (memberId: string) => string): SheetRow[] {
  return d.steps.flatMap((s, i): SheetRow[] => {
    const step = `${i + 1} · ${T.step[s.kind]}`;
    const after = i ? `${T.sheet.afterStep} ${i}` : T.sheet.waiting;
    if (s.kind === 'ack') {
      const who =
        s.audience
          .map((e) => e.label ?? '')
          .filter(Boolean)
          .join(', ') || '—';
      return [{ step, who, result: T.sub.ackWait, at: '' }];
    }
    if (s.kind === 'external') {
      return [{ step, who: s.externalName.trim() || '—', result: after, at: '' }];
    }
    if (!s.whoMemberIds.length) return [{ step, who: '—', result: after, at: '' }];
    return s.whoMemberIds.map((id, j): SheetRow => {
      const result =
        i || j === 0
          ? after
          : s.mode === 'seq'
            ? `${T.sheet.after} ${nameOf(s.whoMemberIds[j - 1] as string).split(' ')[0]}`
            : s.mode === 'any'
              ? T.sheet.orFirst
              : after;
      return { step, who: nameOf(id), result, at: '' };
    });
  });
}

/** Срок каждого шага: рабочие дни нарастающим итогом от `fromIso`, «ДД.ММ». */
export function dueDates(steps: readonly StepDraft[], fromIso: string): string[] {
  let cur = fromIso.slice(0, 10);
  return steps.map((s) => {
    cur = addWorkDays(cur, s.days || 1);
    return ddmm(cur);
  });
}
