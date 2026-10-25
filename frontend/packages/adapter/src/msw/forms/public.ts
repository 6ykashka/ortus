// Тег PublicForms сценарного сервера (W4.70; контракт 0.11.0-stage4, W4.05; поведение — backend W4.21 public.go):
// гость по публичной ссылке `{origin}/f/{token}` без сессии. Ссылка — FormShare.publicToken формы «Все, у кого есть
// ссылка» (выдаёт публикация или updateForm, msw/forms/index.ts). Форма гостя — действующая версия без баллов
// вариантов и умолчаний скрытых вопросов; нонс отправки живёт 2 часа и одноразов (повтор тех же ответов — та же
// квитанция, другие ответы — 410 nonce_used); ответ гостя — «На проверке» (Q-W4.00-forms-18), параметры ссылки —
// только для скрытых вопросов (Q-W4.05-26, Q-W4.00-forms-20); файлы — загрузки нонса, к ответу — только проверенные.
import type { components } from '@ortus/api-client';
import { QUOTA_TEXT } from '@ortus/domain/modules';

import type { TenantAccess } from '../core/access.ts';
import { fileDto, quotaBytes } from '../core/dto.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { MembershipRow, Org, UploadRow } from '../core/state.ts';
import { addMs, MINUTE } from '../core/time.ts';
import { STORAGE_ORIGIN } from '../files/storage.ts';
import { accepting, pvCheck, runRules, scoreOf, shown, type Violation } from './engine.ts';
import {
  CRM,
  current,
  type Def,
  type FormRow,
  type FormsData,
  type FormsView,
  type ResponseRow,
  viewOf,
} from './state.ts';

type S = components['schemas'];

/** Нонс отправки гостя: форма, номер версии, срок; ответ, если уже отправлен. */
interface NonceRow {
  formId: string;
  version: number;
  exp: string;
  responseId?: string;
}

/** Загрузка гостя — сессия core.files с владельцем-нонсом. */
type GuestUpload = UploadRow & { nonce?: string };

type GuestOrg = Org & { formsData?: FormsData; publicNonces?: Record<string, NonceRow> };

const NONCE_TTL_MS = 120 * MINUTE;
const UPLOAD_MAX = 10 * 1024 * 1024;
const UPLOAD_FILES = 20;
const TICKET_TTL_MS = 15 * MINUTE;
const SESSION_TTL_MS = 60 * MINUTE;
const GONE = 'Загрузка не найдена или истекла.';

/** Тексты нонса гостя (no-reference, backend public.go). */
const NONCE_EXPIRED = 'Страница формы устарела — откройте ссылку заново';
const NONCE_INVALID = 'Откройте форму по ссылке заново';
const NONCE_USED = 'Ответ с этой страницы уже отправлен';

function invalid(field: string, message: string, code = 'invalid'): never {
  return fail('validation_failed', message, { violations: [{ field, code, message }] });
}

interface Guest {
  org: GuestOrg;
  f: FormRow;
  v: FormsView;
}

/**
 * Ссылка гостя: форма по токену в любой организации (токен не несёт организации — как индекс control
 * `public_form_links`), опубликованная; неизвестный токен — 404; форма больше не публичная — 410.
 */
function guestOf(ctx: HandlerContext): Guest {
  const token = ctx.params.publicToken ?? '';
  for (const raw of Object.values(ctx.s.orgs)) {
    const org = raw as GuestOrg;
    const f = token ? org.formsData?.forms.find((x) => x.publicToken === token) : undefined;
    if (!f) continue;
    const tenant = ctx.s.tenants.find((t) => t.id === org.tenantId);
    if (!tenant || !current(f)) break;
    if (f.settings.access !== 'public') fail('public_token_expired');
    // Вид гостя: участника нет, права пусты; правила формы выполняются от своих авторов.
    const access: TenantAccess = {
      tenant,
      org,
      membership: {
        id: '',
        tenantId: org.tenantId,
        accountId: '',
        status: 'active',
      } as MembershipRow,
      member: undefined,
      owner: false,
      readOnly: false,
    };
    const v = viewOf({ ...ctx, tenant: access, org: () => access });
    return { org, f, v };
  }
  return fail('not_found');
}

const noncesOf = (org: GuestOrg): Record<string, NonceRow> => (org.publicNonces ??= {});

/** Нонс ссылки: подделанный или другой формы — 422, просроченный — 410 nonce_used. */
function nonceOf(ctx: HandlerContext, g: Guest, nonce: string): NonceRow {
  const n = noncesOf(g.org)[nonce];
  if (!n || n.formId !== g.f.id) return invalid('submissionNonce', NONCE_INVALID);
  if (ctx.now() >= n.exp) fail('nonce_used', NONCE_EXPIRED);
  return n;
}

/** Нонс без отправленного ответа (загрузки заканчиваются отправкой) — иначе 410. */
function unused(n: NonceRow): void {
  if (n.responseId) fail('nonce_used', NONCE_USED);
}

/** Версия, которую видел гость, — действующая; иначе 409 form_version_changed. */
function sameVersion(f: FormRow, n: NonceRow, versionId: string): void {
  const cur = current(f);
  if (!cur || n.version !== cur.number || versionId.toLowerCase() !== cur.id) {
    fail('invalid_transition', 'Форма обновилась — откройте её заново', {
      reason: 'form_version_changed',
    });
  }
}

function open(g: Guest): void {
  if (!accepting(g.v, g.f)) {
    fail('invalid_transition', 'Приём ответов закрыт', { reason: 'form_closed' });
  }
}

/** Определение для гостя: без баллов вариантов и значений по умолчанию скрытых вопросов. */
function guestDefinition(d: Def): Def {
  const out = structuredClone(d);
  for (const q of out.fields) {
    if (q.options) q.options = q.options.map(({ key, label }) => ({ key, label }));
    if (q.hidden) delete q.defaultValue;
  }
  return out;
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m = Math.abs(n) % 100;
  const k = m % 10;
  return m > 10 && m < 20 ? many : k > 1 && k < 5 ? few : k === 1 ? one : many;
};

/** Текст после отправки с результатом теста, если форма его показывает (thanks, public.go). */
function thanks(f: FormRow, r: ResponseRow): string {
  const msg = f.settings.confirmationText;
  const sc = r.score;
  if (!sc || !f.settings.showScore) return msg;
  let res = `Результат: ${sc.points} из ${sc.maxPoints} ${plural(sc.maxPoints, 'балла', 'баллов', 'баллов')}`;
  if (sc.passed === true) res += ' · тест пройден';
  else if (sc.passed === false) res += ` · нужно ${f.settings.passScore ?? 0} для зачёта`;
  return msg ? `${msg}\n${res}` : res;
}

const isEmpty = (v: S['FieldValue']): boolean =>
  v.type === 'null' ||
  (v.type === 'text' && v.value.trim() === '') ||
  ((v.type === 'choices' || v.type === 'files') && v.value.length === 0);

/** Повтор нонса — ровно те же ответы гостя (хранимые не скрытые вопросы и присланные непустые). */
function sameAnswers(def: Def, r: ResponseRow, sent: readonly S['FieldEntry'][]): boolean {
  const hidden = new Set(def.fields.filter((q) => q.hidden).map((q) => q.key));
  const stored = new Map(
    r.answers.filter((a) => !hidden.has(a.fieldKey)).map((a) => [a.fieldKey, a.value]),
  );
  const given = sent.filter((a) => !isEmpty(a.value));
  if (given.length !== stored.size) return false;
  return given.every((a) => JSON.stringify(stored.get(a.fieldKey)) === JSON.stringify(a.value));
}

/** Файлы ответа гостя — загрузки его нонса в эту форму, проверенные (ready). */
function guestFiles(g: Guest, nonce: string, ids: readonly string[]): boolean {
  return ids.every((id) => {
    const u = (g.org.uploads as GuestUpload[]).find(
      (x) => x.fileId === id.toLowerCase() && x.nonce === nonce && x.owner.entityId === g.f.id,
    );
    const file = u ? g.org.files.find((x) => x.id === u.fileId) : undefined;
    return file?.status === 'ready';
  });
}

function nextNumber(v: FormsView): string {
  const max = v.data.responses.reduce(
    (m, r) => Math.max(m, Number(r.number.replace(/\D/g, '')) || 0),
    0,
  );
  return `R-${String(max + 1).padStart(4, '0')}`;
}

/** Ответы гостя по версии: проверки ввода, скрытые вопросы, параметры ссылки, файлы нонса. */
function guestAnswers(g: Guest, b: S['PublicResponseCreate']) {
  const def = (current(g.f) as NonNullable<ReturnType<typeof current>>).definition;
  const given = new Map(b.answers.map((a) => [a.fieldKey, a.value]));
  const errs: Violation[] = [];
  for (const key of given.keys()) {
    const q = def.fields.find((x) => x.key === key);
    if (!q) errs.push({ field: key, code: 'unknown', message: 'Вопроса нет в форме' });
    else if (q.hidden) {
      errs.push({
        field: key,
        code: 'hidden',
        message: 'Скрытый вопрос заполняют ссылка и значение по умолчанию',
      });
    }
  }
  const linkKeys: string[] = [];
  for (const [key, val] of Object.entries(b.linkParams ?? {})) {
    const q = def.fields.find((x) => x.key === key);
    if (!q?.hidden || CRM.includes(q.type) || q.type === 'photo') {
      errs.push({
        field: `linkParams.${key}`,
        code: 'not_hidden',
        message: 'Параметр ссылки — только для скрытого вопроса',
      });
      continue;
    }
    given.set(key, { type: 'text', value: val });
    linkKeys.push(key);
  }
  const vals = new Map<string, S['FieldValue']>();
  for (const q of def.fields) {
    if (q.type === 'statement') continue;
    if (q.hidden) {
      const x =
        (linkKeys.includes(q.key) ? given.get(q.key) : undefined) ??
        (q.defaultValue ? { type: 'text' as const, value: q.defaultValue } : undefined);
      if (x) vals.set(q.key, x);
      continue;
    }
    if (!shown(q, vals)) continue;
    const x = given.get(q.key);
    const e = pvCheck(q, x);
    if (e) {
      errs.push({ field: q.key, code: 'invalid', message: e });
      continue;
    }
    if (!x || x.type === 'null') continue;
    if (x.type === 'files' && !guestFiles(g, b.submissionNonce, x.value)) {
      errs.push({ field: q.key, code: 'invalid', message: 'Файл не найден' });
      continue;
    }
    vals.set(q.key, x);
  }
  return { def, vals, linkKeys, errs };
}

function uploadOf(g: Guest, ctx: HandlerContext, nonce: string): GuestUpload {
  const id = (ctx.params.uploadId ?? '').toLowerCase();
  const u = (g.org.uploads as GuestUpload[]).find(
    (x) => x.uploadId === id && x.nonce === nonce && x.owner.entityId === g.f.id,
  );
  return u ?? fail('not_found', GONE);
}

export const publicFormsHandlers: Registry = {
  getPublicForm: (ctx) => {
    const g = guestOf(ctx);
    const cur = current(g.f) as NonNullable<ReturnType<typeof current>>;
    const nonce = `n${ctx.newId(g.org.proto).replaceAll('-', '')}`;
    const exp = addMs(ctx.now(), NONCE_TTL_MS);
    noncesOf(g.org)[nonce] = { formId: g.f.id, version: cur.number, exp };
    const upload = cur.definition.fields.some((q) => q.type === 'photo');
    const s = g.f.settings;
    const out: S['PublicForm'] = {
      formId: g.f.id,
      versionId: cur.id,
      definition: guestDefinition(cur.definition),
      presentation: {
        title: g.f.name,
        organizationName: s.showLogo
          ? (ctx.s.tenants.find((t) => t.id === g.org.tenantId)?.name ?? null)
          : null,
        progressBar: s.progressBar,
        backButton: s.backButton,
        confirmationText: s.confirmationText,
        showScore: s.showScore,
      },
      acceptingResponses: accepting(g.v, g.f),
      uploadAllowed: upload,
      uploadMaxBytes: upload ? UPLOAD_MAX : 0,
      submissionNonce: nonce,
      nonceExpiresAt: exp,
    };
    return { body: out };
  },

  submitPublicForm: (ctx) => {
    const g = guestOf(ctx);
    const b = ctx.body as S['PublicResponseCreate'];
    const n = nonceOf(ctx, g, b.submissionNonce);
    if (n.responseId) {
      const prev = g.v.data.responses.find((x) => x.id === n.responseId);
      const ver = g.f.versions.find((x) => x.number === prev?.versionNumber);
      if (!prev || !ver || !sameAnswers(ver.definition, prev, b.answers)) {
        fail('nonce_used', NONCE_USED);
      }
      const receipt: S['PublicResponseReceipt'] = {
        receiptId: prev.id,
        submittedAt: prev.submittedAt,
        message: thanks(g.f, prev),
      };
      return { status: 201, body: receipt, headers: { 'Idempotency-Replayed': 'true' } };
    }
    sameVersion(g.f, n, b.versionId);
    open(g);
    const { def, vals, linkKeys, errs } = guestAnswers(g, b);
    if (errs.length) fail('validation_failed', errs[0]?.message, { violations: errs });
    const v = g.v;
    const cur = current(g.f) as NonNullable<ReturnType<typeof current>>;
    const number = nextNumber(v);
    const r: ResponseRow = {
      id: v.U(number),
      proto: number,
      formId: g.f.id,
      number,
      versionNumber: cur.number,
      submittedAt: v.now,
      channel: 'public',
      authorId: null,
      authorName: 'Гость',
      answers: def.fields
        .filter((q) => vals.has(q.key))
        .map((q) => ({ fieldKey: q.key, value: vals.get(q.key) as S['FieldValue'] })),
      reviewStatus: 'pending',
      revision: 1,
      actions: [],
      ...(linkKeys.length ? { linkParamKeys: linkKeys } : {}),
    };
    if (g.f.settings.scoring) r.score = scoreOf(def, vals, g.f.settings.passScore);
    v.data.responses.unshift(r);
    n.responseId = r.id;
    runRules(v, g.f, r);
    const receipt: S['PublicResponseReceipt'] = {
      receiptId: r.id,
      submittedAt: r.submittedAt,
      message: thanks(g.f, r),
    };
    return { status: 201, body: receipt };
  },

  initiatePublicUpload: (ctx) => {
    const g = guestOf(ctx);
    const b = ctx.body as S['PublicUploadCreate'];
    const n = nonceOf(ctx, g, b.submissionNonce);
    unused(n);
    sameVersion(g.f, n, b.versionId);
    open(g);
    const cur = current(g.f) as NonNullable<ReturnType<typeof current>>;
    const q = cur.definition.fields.find((x) => x.key === b.fieldKey);
    if (!q || q.type !== 'photo' || q.hidden) invalid('fieldKey', 'Вопрос не найден');
    if (b.sizeBytes > UPLOAD_MAX) fail('payload_too_large', 'Файл больше 10 МБ.');
    const mine = (g.org.uploads as GuestUpload[]).filter((x) => x.nonce === b.submissionNonce);
    const live = mine.filter(
      (x) => g.org.files.find((y) => y.id === x.fileId)?.status !== 'rejected',
    );
    if (live.length >= UPLOAD_FILES) invalid('fieldKey', `Не больше ${UPLOAD_FILES} файлов`);
    const st = ctx.s.tenants.find((t) => t.id === g.org.tenantId);
    if (st && st.storage.committedBytes + st.storage.reservedBytes + b.sizeBytes > quotaBytes(st)) {
      fail('quota_exceeded', QUOTA_TEXT);
    }
    const now = ctx.now();
    const fileId = ctx.newId(g.org.proto);
    const upload: GuestUpload = {
      uploadId: ctx.newId(g.org.proto),
      fileId,
      state: 'issued',
      purpose: 'form_attachment',
      owner: { moduleKey: 'forms', entityType: 'form', entityId: g.f.id },
      sizeBytes: b.sizeBytes,
      reservedBytes: b.sizeBytes,
      ticketExpiresAt: addMs(now, TICKET_TTL_MS),
      sessionExpiresAt: addMs(now, SESSION_TTL_MS),
      fileStatus: 'pending_upload',
      createdAt: now,
      requiredSha256: b.sha256,
      contentType: b.contentType,
      nonce: b.submissionNonce,
    };
    g.org.files.push({
      id: fileId,
      fileName: b.fileName,
      contentType: b.contentType,
      sizeBytes: b.sizeBytes,
      sha256: b.sha256,
      status: 'pending_upload',
      createdAt: now,
    });
    g.org.uploads.push(upload);
    if (st) st.storage.reservedBytes += b.sizeBytes;
    const ticket: S['UploadTicket'] = {
      uploadId: upload.uploadId,
      fileId,
      method: 'PUT',
      uploadUrl: `${STORAGE_ORIGIN}/uploads/${upload.uploadId}`,
      requiredContentType: b.contentType,
      requiredSha256: b.sha256,
      expiresAt: upload.ticketExpiresAt,
      maxBytes: UPLOAD_MAX,
    };
    return { status: 201, body: ticket };
  },

  completePublicUpload: (ctx) => {
    const g = guestOf(ctx);
    const b = ctx.body as S['PublicUploadComplete'];
    unused(nonceOf(ctx, g, b.submissionNonce));
    const u = uploadOf(g, ctx, b.submissionNonce);
    if (u.state === 'completed') fail('invalid_transition', 'Загрузка уже завершена.');
    if (u.state !== 'issued' && u.state !== 'uploaded') fail('not_found', GONE);
    if (b.sha256 !== u.requiredSha256) {
      fail('validation_failed', 'Контрольная сумма не совпадает.', {
        violations: [
          { field: 'sha256', code: 'mismatch', message: 'Файл отличается от заявленного' },
        ],
      });
    }
    const file = g.org.files.find((x) => x.id === u.fileId) ?? fail('not_found', GONE);
    file.status = 'quarantined';
    u.state = 'completed';
    u.fileStatus = 'quarantined';
    u.completedAt = ctx.now();
    const t = ctx.s.tenants.find((x) => x.id === g.org.tenantId);
    if (t) {
      t.storage.reservedBytes -= u.sizeBytes;
      t.storage.committedBytes += u.sizeBytes;
      t.storage.buckets.attachments += u.sizeBytes;
      t.storage.measuredAt = ctx.now();
    }
    return { body: fileDto(file) };
  },

  getPublicUploadStatus: (ctx) => {
    const g = guestOf(ctx);
    const b = ctx.body as S['PublicUploadStatusQuery'];
    nonceOf(ctx, g, b.submissionNonce);
    const u = uploadOf(g, ctx, b.submissionNonce);
    const file = g.org.files.find((x) => x.id === u.fileId) ?? fail('not_found', GONE);
    return { body: fileDto(file) };
  },
};
