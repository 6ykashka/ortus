// Действие формы «Сохранить в Базу знаний» (api.js 14.10:79–118): строка в таблицу (`table`) или
// запись на страницу (`entry`). Один результат на пару «ответ × правило»; ошибки не бросаются, а
// пишутся в `resp.actions` и событие владельцам. Действие выполняется с правами автора правила.
//
// Отличие от эталона — PD-53 (план v2 §7, ADR 0014): эталон проверяет `can(knowledge, create)` без
// объекта, и роль пространства БЗ даёт право во всех разделах. Здесь роль пространства засчитывается
// только для страниц своего пространства.
import { hhmm, type Clock } from '../../core/clock.ts';
import type { Emit } from '../../core/events.ts';
import type { IdGen } from '../../core/ids.ts';
import { ACCESS, type AccessApi } from '../../core/module.ts';
import type { CoreDb, Member, ObjectRef, TenantDb } from '../../core/types/index.ts';
import { formVal } from './form-val.ts';
import type {
  ActionResult,
  Form,
  FormField,
  FormResponse,
  FormRule,
  FormsKbPage,
  FormsKnowledge,
  KbSrc,
} from './types.ts';

type KbAccess = Pick<AccessApi, 'can' | 'grants'>;

export interface KbEnv {
  db: TenantDb;
  /** Срез Базы знаний организации; нет среза — страниц нет. */
  kb: FormsKnowledge | undefined;
  clock: Clock;
  ids: IdGen;
  emit: Emit;
  access?: KbAccess;
}

/** Участники с ролью «Владелец бизнеса» — адресаты событий организации (api.js:55). */
export const ownersOf = (db: CoreDb, access: KbAccess = ACCESS): string[] =>
  db.members.filter((m) => access.grants(db, m.id).some((g) => g.roleObj.all)).map((m) => m.id);

/** Срабатывает ли действие на ответ: включено, статус по `when`, условие `cond`. */
export function kbFits(x: FormRule, r: FormResponse): boolean {
  if (!x.on) return false;
  if ((x.when ?? 'accepted') === 'accepted' && r.status !== 'Принят') return false;
  const c = x.cond;
  if (c?.field) {
    const v = (r.values ?? {})[c.field];
    const want = String(c.value ?? '').toLowerCase();
    const has = Array.isArray(v)
      ? v.some((y) => y.toLowerCase() === want)
      : (v ?? '').toLowerCase() === want;
    if (!has) return false;
  }
  return true;
}

const spaceOf = (page: FormsKbPage): ObjectRef | undefined =>
  page.space ? { type: 'space', id: page.space } : undefined;

function authorOf(db: CoreDb, x: FormRule): Member | undefined {
  return db.members.find((m) => m.id === x.byId) ?? db.members.find((m) => m.name === x.by);
}

interface RunCtx {
  env: KbEnv;
  f: Form;
  r: FormResponse;
  x: FormRule;
  page: FormsKbPage;
  kb: FormsKnowledge;
  fields: FormField[];
  src: KbSrc;
  at: string;
}

function writeEntry(c: RunCtx): void {
  const { env, f, r, x, page, fields, src, at } = c;
  const list = (c.kb.entries ??= []);
  if (list.some((e) => e.src.resp === r.id && e.src.rule === x.id)) return;
  const lines = (x.fields ?? [])
    .filter((q) => q.src)
    .map((q) => ({ name: q.name, value: formVal(f, r, q.src, fields) }))
    .filter((q) => q.value !== '');
  const e = {
    id: env.ids.next('ke-'),
    page: page.id,
    at,
    head: formVal(f, r, x.head ?? '$object', fields) || r.id,
    lines,
    src,
  };
  if (x.pos === 'bottom') list.push(e);
  else list.unshift(e);
}

/** Строка в таблицу страницы; `null` — таблицы на странице нет. */
function writeRow(c: RunCtx): string | null {
  const { env, f, r, x, page, fields, src, at } = c;
  const t = (c.kb.tables ?? []).find((y) => y.id === x.table && y.page === page.id);
  if (!t) return null;
  if (!t.rows.some((y) => y.src?.resp === r.id && y.src.rule === x.id)) {
    const cells: Record<string, string> = {};
    for (const q of x.fields ?? []) {
      if (q.src && q.col && t.columns.some((col) => col.id === q.col)) {
        cells[q.col] = formVal(f, r, q.src, fields);
      }
    }
    const row = { id: env.ids.next('kr-'), at, src, cells };
    if (x.pos === 'bottom') t.rows.push(row);
    else t.rows.unshift(row);
  }
  return 'Строка в таблице «' + t.title + '» · страница «' + page.title + '»';
}

/** Выполнить действие «в БЗ» по ответу; повтор после успеха возвращает прошлый результат. */
export function kbRun(env: KbEnv, f: Form, r: FormResponse, x: FormRule): ActionResult {
  const done = (r.actions ?? []).find((y) => y.rule === x.id && y.ok);
  if (done) return done;
  const { db, kb, clock } = env;
  const access = env.access ?? ACCESS;
  const page = kb?.pages.find((p) => p.id === x.page);
  const fields = f.versions.find((v) => v.v === r.version)?.fields ?? [];
  const by = authorOf(db, x);
  const rv = x.version || 1;
  const at = hhmm(clock);
  const base = { rule: x.id, rv, kind: 'kb' as const, at, page: x.page };
  const fail = (err: string): ActionResult => ({ ...base, ok: false, err });
  let res: ActionResult;
  if (!kb || !page) res = fail('страница удалена из Базы знаний');
  else if (
    !by ||
    by.status !== 'active' ||
    !access.can(db, by.id, 'knowledge', 'create', null, spaceOf(page)).ok
  ) {
    res = fail(
      'у автора правила' + (by ? ' ' + by.name : '') + ' нет права «Создавать» в Базе знаний',
    );
  } else if (page.access === 'owner' && !access.grants(db, by.id).some((g) => g.roleObj.all)) {
    res = fail('страница «' + page.title + '» доступна только владельцу');
  } else {
    const src: KbSrc = { form: f.id, resp: r.id, fv: r.version, rule: x.id, rv };
    const c: RunCtx = { env, f, r, x, page, kb, fields, src, at };
    if (x.mode === 'entry') {
      writeEntry(c);
      res = { ...base, ok: true, text: 'Запись на странице «' + page.title + '»' };
    } else {
      const text = writeRow(c);
      res = text
        ? { ...base, ok: true, table: x.table as string, text }
        : fail('таблица удалена со страницы «' + page.title + '»');
    }
  }
  r.actions = (r.actions ?? []).filter((y) => y.rule !== x.id).concat([res]);
  if (!res.ok) {
    env.emit(
      'Форма «' + f.name + '»: ответ ' + r.id + ' не сохранён в Базу знаний — ' + String(res.err),
      ownersOf(db, access),
    );
  }
  return res;
}
