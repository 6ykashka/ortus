// W4.70 · Модель заполнения формы сотрудником (`form-fill`) и гостем (`public-form`): значения ответов по типам
// вопросов (FormQuestionType, контракт 0.11.0-stage4), параметры адреса — только для скрытых вопросов (Q-W4.05-26,
// Q-W4.00-forms-20), нарушения 422 по вопросам, отказы сервера (409 по причине, 410, 404, 403, нет связи), состояние
// формы до заполнения (Form.my.respond) и «Спасибо» с результатом теста (Q-W4.00-forms-24).
import { type components, type MeContext, ProblemError } from '@ortus/api-client';
import { format, forms as F } from '@ortus/texts';

import { activeTenants } from '../../../../shell/me.ts';
import { CRM, condOk } from '../model.ts';

type S = components['schemas'];
type Def = S['FormDefinitionV2'];
type Question = S['FormQuestion'];

/** Значения рендера: строка, список (несколько вариантов, файлы) или нет ответа; «Другое» — `{key}__other`. */
export type FillVals = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Экран «Спасибо»: текст и чип результата теста. */
export interface Done {
  text: string;
  score: { text: string; ok: boolean } | null;
}

export type Refusal =
  | {
      kind: 'changed' | 'answered' | 'closed' | 'linkInvalid' | 'notFound' | 'noAccess' | 'offline';
    }
  | { kind: 'nonce'; text: string };

const TEXTS: readonly Question['type'][] = ['text', 'longtext', 'email', 'phone', 'inn', 'url'];
const DECIMALS: readonly Question['type'][] = ['number', 'int', 'scale', 'rating'];

/** Число ввода → Decimal контракта: без пробелов, запятая → точка, без ведущих нулей. */
const decimal = (s: string): string =>
  s
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/^(-?)0+(?=\d)/, '$1');

const str = (v: FillVals[string]): string => (typeof v === 'string' ? v : '');
const list = (v: FillVals[string]): string[] => (Array.isArray(v) ? [...(v as string[])] : []);

function valueOf(
  x: Question,
  v: FillVals[string],
  other: string,
  refs: ReadonlyMap<string, S['ObjectRef']>,
): S['FieldValue'] | null {
  const t = x.type;
  const s = str(v).trim();
  if (TEXTS.includes(t)) return s ? { type: 'text', value: t === 'longtext' ? str(v) : s } : null;
  if (DECIMALS.includes(t)) return s ? { type: 'decimal', value: decimal(s) } : null;
  if (t === 'money') {
    return s
      ? {
          type: 'money',
          value: { amountMinor: Math.round(Number(decimal(s)) * 100), currency: 'RUB' },
        }
      : null;
  }
  if (t === 'bool')
    return s === 'true' || s === 'false' ? { type: 'boolean', value: s === 'true' } : null;
  if (t === 'date') {
    if (!s) return null;
    return x.withTime
      ? { type: 'instant', value: new Date(s).toISOString() }
      : { type: 'date', value: s };
  }
  if (t === 'choice' || t === 'select' || t === 'multi') {
    const keys = t === 'multi' ? list(v) : s ? [s] : [];
    const own = x.otherOption ? other.trim() : '';
    if (own && (t === 'multi' || !keys.length)) {
      return { type: 'choices', value: [...keys, 'other'], otherText: own };
    }
    return keys.length ? { type: 'choices', value: keys } : null;
  }
  if (t === 'photo') {
    const ids = list(v);
    return ids.length ? { type: 'files', value: ids } : null;
  }
  if (CRM.includes(t)) {
    const ref = s ? refs.get(s) : undefined;
    return ref ? { type: 'reference', value: ref } : null;
  }
  return null;
}

/**
 * Ответы для `submitFormResponse` и `submitPublicForm`: показанные вопросы без «Текста без вопроса» и скрытых (их
 * значения — из ссылки и умолчаний, Q-W4.05-26), пустые не отправляются. `refs` — ссылки вариантов CRM по id.
 */
export function answersOf(
  d: Def,
  vals: FillVals,
  refs: ReadonlyMap<string, S['ObjectRef']> = new Map(),
): S['FieldEntry'][] {
  const out: S['FieldEntry'][] = [];
  for (const x of d.fields) {
    if (x.type === 'statement' || x.hidden || !condOk(x.showIf, vals)) continue;
    const value = valueOf(x, vals[x.key], str(vals[`${x.key}__other`]), refs);
    if (value) out.push({ fieldKey: x.key, value });
  }
  return out;
}

const LINK_KEYS = 50;
const LINK_VALUE = 500;

/** Параметры адреса `?{key}=…` — только скрытые вопросы версии, не CRM и не файлы; не больше 50, до 500 символов. */
export function linkParamsOf(d: Def, search: string): Record<string, string> {
  const hidden = new Set(
    d.fields
      .filter((x) => x.hidden && !CRM.includes(x.type) && x.type !== 'photo')
      .map((x) => x.key),
  );
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) {
    if (!hidden.has(k) || k in out || Object.keys(out).length >= LINK_KEYS) continue;
    out[k] = v.slice(0, LINK_VALUE);
  }
  return out;
}

/** 422: нарушения по ключам вопросов версии (первое на вопрос) и прочие тексты; не 422 — null. */
export function violationsOf(
  e: unknown,
  d: Def,
): { errs: Record<string, string>; rest: string[] } | null {
  if (!(e instanceof ProblemError) || e.status !== 422) return null;
  const keys = new Set(d.fields.map((x) => x.key));
  const errs: Record<string, string> = {};
  const rest: string[] = [];
  for (const v of e.problem?.violations ?? []) {
    if (keys.has(v.field)) errs[v.field] ??= v.message;
    else rest.push(v.message);
  }
  if (!Object.keys(errs).length && !rest.length) rest.push(e.problem?.detail ?? e.message);
  return { errs, rest };
}

/** Отказ чтения или отправки, который заменяет форму состоянием (или нет связи); прочее — null. */
export function refusalOf(e: unknown): Refusal | null {
  if (e instanceof TypeError) return { kind: 'offline' };
  if (!(e instanceof ProblemError)) return null;
  const reason = (e.problem as { reason?: string } | undefined)?.reason;
  if (e.status === 409 && reason === 'form_version_changed') return { kind: 'changed' };
  if (e.status === 409 && reason === 'form_already_answered') return { kind: 'answered' };
  if (e.status === 409 && reason === 'form_closed') return { kind: 'closed' };
  if (e.code === 'public_token_expired') return { kind: 'linkInvalid' };
  if (e.code === 'nonce_used') return { kind: 'nonce', text: e.problem?.detail ?? F.fill.reopen };
  if (e.status === 422) {
    const n = e.problem?.violations?.find((v) => v.field === 'submissionNonce');
    if (n) return { kind: 'nonce', text: n.message };
  }
  if (e.status === 404) return { kind: 'notFound' };
  if (e.status === 403) return { kind: 'noAccess' };
  return null;
}

/** «Сегодня» по Москве (ГГГГ-ММ-ДД) — «Принимать до» включительно. */
const mskDay = (now: Date): string =>
  new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Форма до заполнения: черновик — «не найдена» (как 404 отправки); `my.respond` — открыта; иначе закрыта (закрыта,
 * срок, лимит, модуль) или «уже отвечали» («Один ответ от сотрудника» при открытой форме — Q-W4.70-3).
 */
export function gateOf(f: S['Form'], now: Date): 'open' | 'notFound' | 'closed' | 'answered' {
  if (f.status === 'draft' || !f.publishedVersionNumber) return 'notFound';
  if (f.my.respond) return 'open';
  if (f.status === 'closed') return 'closed';
  const until = f.settings.acceptUntil;
  if (until && mskDay(now) > until) return 'closed';
  return f.settings.onePerMember ? 'answered' : 'closed';
}

/** «Спасибо» ответа сотрудника: текст формы и результат теста, если «Показывать результат после отправки». */
export function doneOfResponse(
  score: S['FormResponseScore'] | undefined,
  s: S['FormSettings'],
): Done {
  const text = s.confirmationText || F.preview.thanks;
  if (!score || !s.showScore) return { text, score: null };
  const v = { got: score.points, max: score.maxPoints, p: s.passScore ?? 0 };
  const msg =
    score.passed === null
      ? format(F.preview.score, v)
      : format(score.passed ? F.preview.scorePassed : F.preview.scoreFailed, v);
  return { text, score: { text: msg, ok: score.passed !== false } };
}

const RESULT = F.preview.score.slice(0, F.preview.score.indexOf('{'));
/** Хвост «… для зачёта» — тест не пройден. */
const FAILED = F.preview.scoreFailed.slice(F.preview.scoreFailed.lastIndexOf('{p}') + 3);

/** «Спасибо» гостя по квитанции: строки текста формы и строка «Результат: …» (сервер — thanks, public.go). */
export function doneOfReceipt(message: string): Done {
  const lines = message.split('\n');
  const res = lines.find((l) => l.startsWith(RESULT));
  const text = lines.filter((l) => l !== res && l.trim()).join('\n') || F.preview.thanks;
  return { text, score: res ? { text: res, ok: !res.endsWith(FAILED) } : null };
}

/** Организации для поиска формы: последняя выбранная, затем остальные активные (Q-W4.70-1). */
export function tenantOrder(me: MeContext): string[] {
  const ids = activeTenants(me).map((t) => t.tenantId);
  const last = me.lastTenantId;
  return last && ids.includes(last) ? [last, ...ids.filter((x) => x !== last)] : ids;
}

/** Типы файлов поля (FormQuestion.accept): «Только фото», «Документы: PDF, Word, Excel», «Любые файлы». */
export function acceptOf(q: Question): string | undefined {
  if (q.accept === 'photo') return 'image/*';
  if (q.accept === 'docs') return '.pdf,.doc,.docx,.xls,.xlsx';
  return undefined;
}
