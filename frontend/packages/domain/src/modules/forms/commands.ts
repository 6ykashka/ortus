// Команды форм 14.10 по контракту `ModuleCtx` ядра: `publishForm` (api.js:554–573),
// `backfillKbRule` (846–855), `retryFormAction` (856–864). Guard — как у эталона: подписка
// активна (`assertActive`) и право «Формы · Настраивать». Задержки mock-адаптера — `FORMS_DELAYS`.
// `saveFormDraft`, `discardFormDraft`, `createForm`, `updateForm` — после контракта W4.00 (W4.21).
import { ddmm, ddmmyyyy } from '../../core/clock.ts';
import type { ModuleCtx } from '../../core/module.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { kbFits, kbRun, ownersOf, type KbEnv } from './kb-actions.ts';
import { clone } from './clone.ts';
import type {
  ActionResult,
  Form,
  FormDef,
  FormField,
  FormResponse,
  FormsKnowledge,
} from './types.ts';
import { nextVersionFields, normalizeDef, validatePublish } from './validate-publish.ts';

export interface FormsOptions {
  /** Срез Базы знаний организации (по умолчанию `db.knowledge`; срез объявляет W4.30). */
  knowledge?: (db: TenantDb) => FormsKnowledge | undefined;
}

export interface BackfillResult {
  added: number;
  failed: number;
  err: string | null;
}

export const FORMS_METHODS = ['publishForm', 'backfillKbRule', 'retryFormAction'] as const;
export type FormsMethod = (typeof FORMS_METHODS)[number];

/** Задержки mock-адаптера эталона, мс. */
export const FORMS_DELAYS: Readonly<Record<FormsMethod, number>> = {
  publishForm: 500,
  backfillKbRule: 450,
  retryFormAction: 300,
};

export const defaultKnowledge = (db: TenantDb): FormsKnowledge | undefined =>
  (db as unknown as { knowledge?: FormsKnowledge }).knowledge;

const RESTRICTED =
  'Пробный период завершён: новые операции недоступны. История доступна для чтения.';

/** Номер ответа для сортировки переноса: цифры id (`R-1012` → 1012), без цифр — 0. */
const respNo = (r: FormResponse): number => Number(r.id.replace(/\D/g, '')) || 0;

export interface FormsCommands {
  publishForm(formId: string, def: FormDef | FormField[] | null | undefined): number;
  backfillKbRule(formId: string, ruleId: string): BackfillResult;
  retryFormAction(respId: string, ruleId: string): ActionResult;
}

export function createFormsCommands(ctx: ModuleCtx, opts: FormsOptions = {}): FormsCommands {
  const kbOf = opts.knowledge ?? defaultKnowledge;
  const { ApiError } = ctx;

  function guard(): TenantDb {
    const db = ctx.getDb();
    const t = db.platform?.tenants.find((x) => x.id === db.tenantId);
    if (t && (t.status === 'restricted' || t.status === 'suspended')) {
      throw new ApiError('subscription_restricted', RESTRICTED);
    }
    ctx.can.assertCan(db, ctx.getActor() ?? '', 'forms', 'settings');
    return db;
  }

  function formOf(db: TenantDb, formId: string): Form {
    const f = (db.forms ?? []).find((x) => x.id === formId);
    if (!f) throw new ApiError('not_found', 'Форма не найдена');
    return f;
  }

  const env = (db: TenantDb): KbEnv => ({
    db,
    kb: kbOf(db),
    clock: ctx.clock,
    ids: ctx.ids,
    emit: ctx.emit,
    access: ctx.can,
  });

  return {
    // Черновик → новая неизменяемая версия. def = { pages, fields }; старый формат — массив полей.
    publishForm(formId, def) {
      const db = guard();
      const f = formOf(db, formId);
      const d = normalizeDef(def);
      const fields = validatePublish(d, f.settings ?? {});
      const prev = f.published ? (f.versions.find((x) => x.v === f.published)?.fields ?? []) : [];
      const v = (f.published ?? 0) + 1;
      const me = db.members.find((m) => m.id === ctx.getActor());
      f.versions.push({
        v,
        at: ddmmyyyy(ctx.clock),
        by: me ? me.name : '—',
        fields: nextVersionFields(fields, prev, v),
        pages: d.pages ? clone(d.pages) : null,
      });
      f.published = v;
      f.status = 'published';
      f.updated = ddmm(ctx.clock);
      delete f.draft;
      ctx.emit(
        'Опубликована форма «' +
          f.name +
          '» v' +
          String(v) +
          '. Старые ответы сохраняют свои версии',
        ownersOf(db, ctx.can),
      );
      return v;
    },

    // Перенос прошлых ответов в Базу знаний по включённому действию «в БЗ», по номеру ответа.
    backfillKbRule(formId, ruleId) {
      const db = guard();
      const f = formOf(db, formId);
      const x = f.automations.find((y) => y.id === ruleId && y.kind === 'kb');
      if (!x) throw new ApiError('not_found', 'Действие не найдено');
      if (!x.on) {
        throw new ApiError(
          'validation',
          'Действие выключено — включите его, чтобы перенести ответы',
        );
      }
      const out: BackfillResult = { added: 0, failed: 0, err: null };
      const e = env(db);
      (db.responses ?? [])
        .filter(
          (r) =>
            r.formId === f.id &&
            kbFits(x, r) &&
            !(r.actions ?? []).some((y) => y.rule === x.id && y.ok),
        )
        .sort((p, q) => respNo(p) - respNo(q))
        .forEach((r) => {
          const res = kbRun(e, f, r, x);
          if (res.ok) out.added++;
          else {
            out.failed++;
            out.err = res.err ?? null;
          }
        });
      return out;
    },

    // Повтор действия по одному ответу из журнала действий.
    retryFormAction(respId, ruleId) {
      const db = guard();
      const r = (db.responses ?? []).find((x) => x.id === respId);
      if (!r) throw new ApiError('not_found', 'Ответ не найден');
      const f = (db.forms ?? []).find((x) => x.id === r.formId);
      const x = f?.automations.find((y) => y.id === ruleId);
      if (!f || !x)
        throw new ApiError('validation', 'Действие удалено из формы — повторить нельзя');
      const res = kbRun(env(db), f, r, x);
      if (!res.ok) throw new ApiError('validation', 'Не выполнено: ' + String(res.err));
      return res;
    },
  };
}
