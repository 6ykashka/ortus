// Движок маршрута документа (documents.js 14.10:545–605): `activate`, `advance`, `syncTask`,
// `makePdfA`, запись в историю и в задачу. Работает над БД текущей организации; задачи — только
// через `TaskPort` (B §5.1), без импорта модуля задач.
//
// Отличия от эталона (бриф W7.22 §4): «сегодня», штамп и время берутся из `ctx.clock`, а не из
// `DOC_TODAY` и `new Date()`; id — из общего счётчика `ctx.ids`; события — `ctx.emit`.
import { ddmmHHMM, ddmmyyyy, hhmm } from '../../../core/clock.ts';
import { entryHas } from '../../../core/entries.ts';
import type { ModuleCtx } from '../../../core/module.ts';
import type { StatusCat } from '../../../core/task-port.ts';
import { docRights } from '../core/access.ts';
import { DOC_LEVELS } from '../core/dictionaries.ts';
import { fieldVals } from '../core/fields.ts';
import type { DocItem, DocOpts, DocRightsResult, DocsTenantDb } from '../core/types.ts';
import { addWorkDays } from '../core/util.ts';
import { stepWaiting } from '../core/waits.ts';
import { gridOf } from '../sheet/index.ts';
import { routeSheet } from './sheet.ts';
import type { RDoc, RVersion } from './types.ts';

const clone = <T>(x: T): T => structuredClone(x);
const asItem = (d: RDoc): DocItem => d as unknown as DocItem;

export interface RouteEngine {
  db(): DocsTenantDb;
  me(): string;
  meName(): string;
  nm(id: string): string;
  opts(): DocOpts;
  /** Документ по id; нет модуля или документа — `not_found`. */
  doc(id: string): RDoc;
  rights(d: RDoc): DocRightsResult;
  /** Права другого участника на документ (право «Утверждать» у утверждающего). */
  rightsFor(mid: string, d: RDoc): DocRightsResult;
  /** Документ виден участнику (Q-W7.22-2): иначе `not_found`. */
  seen(d: RDoc): DocRightsResult;
  /** Нужен уровень `lv`: нет доступа — `not_found`, мало — `forbidden`. */
  need(d: RDoc, lv: number, what: string): DocRightsResult;
  stamp(): string;
  hm(): string;
  hist(d: RDoc, text: string): void;
  taskNote(d: RDoc, text: string): void;
  syncTask(d: RDoc): void;
  /** Новая версия документа (`cut` эталона): слепок содержимого, `v` растёт. */
  cut(d: RDoc, o: { name: string; source: string }): number;
  makePdfA(d: RDoc): RDoc;
  activate(d: RDoc, i: number): void;
  advance(d: RDoc): void;
}

export function createRouteEngine(ctx: ModuleCtx): RouteEngine {
  const db = (): DocsTenantDb => ctx.getDb() as DocsTenantDb;
  const me = (): string => ctx.getActor() ?? '';
  const nm = (id: string): string => db().members.find((m) => m.id === id)?.name || id;
  const meName = (): string => db().members.find((m) => m.id === me())?.name || '—';
  const opts = (): DocOpts => ({ today: ddmmyyyy(ctx.clock) });
  const hm = (): string => hhmm(ctx.clock);
  const stamp = (): string => ddmmHHMM(ctx.clock);
  const nid = (p: string): string => ctx.ids.next(p);

  function doc(id: string): RDoc {
    const x = db().docs;
    if (!x) throw new ctx.ApiError('not_found', 'Модуль «Документы» не подключён');
    const d = x.items.find((y) => y.id === id);
    if (!d) throw new ctx.ApiError('not_found', 'Документ не найден или недоступен');
    return d as unknown as RDoc;
  }
  const rights = (d: RDoc): DocRightsResult => docRights(db(), me(), asItem(d), opts());
  const rightsFor = (mid: string, d: RDoc): DocRightsResult =>
    docRights(db(), mid, asItem(d), opts());
  const seen = (d: RDoc): DocRightsResult => {
    const r = rights(d);
    if (!r.L) throw new ctx.ApiError('not_found', 'Документ не найден или недоступен');
    return r;
  };
  const need = (d: RDoc, lv: number, what: string): DocRightsResult => {
    const r = seen(d);
    if (r.L < lv) {
      throw new ctx.ApiError(
        'forbidden',
        'Чтобы ' +
          what +
          ', нужен уровень «' +
          DOC_LEVELS[lv] +
          '». У вас — «' +
          DOC_LEVELS[r.L] +
          '»',
      );
    }
    return r;
  };

  const hist = (d: RDoc, text: string): void => {
    d.history.unshift({ at: stamp(), by: meName(), text });
    if (d.history.length > 30) d.history.length = 30;
  };
  const taskNote = (d: RDoc, text: string): void => {
    const id = d.route?.task;
    if (id && ctx.tasks.get(id)) {
      ctx.tasks.comment(id, { by: meName(), at: hm(), text, system: true });
    }
  };

  const snap = (d: RDoc): Partial<RVersion> =>
    d.kind === 'text'
      ? { body: clone(d.body ?? []) }
      : d.kind === 'sheet'
        ? { sheets: clone(d.sheets ?? []) }
        : { pages: clone(d.pages ?? []), annots: clone(d.annots ?? []) };

  function cut(d: RDoc, o: { name: string; source: string }): number {
    const v = d.v + 1;
    const by = (d.authors.length ? d.authors : [me()]).map(nm).join(', ');
    d.versions.push({ v, at: stamp(), by, name: o.name, source: o.source, ...snap(d) });
    d.v = v;
    d.dirty = false;
    d.authors = [];
    d.saved = { at: hm(), by: me() };
    return v;
  }

  function syncTask(d: RDoc): void {
    const r = d.route;
    if (!r?.task) return;
    const t = ctx.tasks.get(r.task);
    if (!t) return;
    const st = r.steps[r.cur];
    const wait = r.status === 'active' ? stepWaiting(st) : [];
    const who = (id: string): string =>
      id === 'ext' ? (st?.ext?.name ?? '') + ' · заказчик' : nm(id);
    const S2 = (cat: StatusCat, name: string): string => ctx.tasks.statusName(t.project, cat, name);
    const first = wait[0];
    ctx.tasks.update(r.task, {
      docRoute: {
        doc: d.id,
        title: d.title,
        route: r.id,
        v: r.v,
        status: r.status,
        step: st ? st.name : '',
        n: r.cur + 1,
        of: r.steps.length,
        waiting: wait.filter((x) => x !== 'ext'),
        names: wait.map(who),
      },
      status:
        r.status === 'active'
          ? S2('progress', 'На проверке')
          : r.status === 'returned'
            ? S2('progress', 'В работе')
            : r.status === 'done'
              ? S2('done', 'Готово')
              : S2('done', 'Отменена'),
      assignee:
        r.status === 'returned' || first === 'ext'
          ? nm(r.by)
          : first !== undefined
            ? nm(first)
            : t.assignee,
      ...(st?.due ? { due: st.due.slice(0, 5) } : {}),
    });
  }

  /** Заготовка документа (`base` + `blank` эталона). */
  function blank(kind: DocItem['kind'], title: string, folder: string, by: string): RDoc {
    return {
      status: 'draft',
      mode: 'inherit',
      share: [],
      links: [],
      dirty: false,
      authors: [],
      presence: [],
      comments: [],
      suggestions: [],
      history: [],
      jobs: [],
      tmp: [],
      annots: [],
      id: nid('doc-'),
      kind,
      title,
      folder,
      owner: by,
      v: 1,
      versions: [],
      saved: { at: hm(), by },
      upd: { at: stamp(), by },
    };
  }

  function makePdfA(d: RDoc): RDoc {
    const r = d.route;
    if (!r) throw new Error('Нет маршрута для PDF/A');
    const ver0: Partial<RVersion> = d.versions.find((x) => x.v === r.v) ?? {};
    const sh = routeSheet(db(), d, r, true);
    const firstSheet = (ver0.sheets ?? d.sheets)?.[0];
    const pages: unknown[] =
      d.kind === 'pdf'
        ? clone(ver0.pages ?? d.pages ?? [])
        : [
            {
              id: nid('pg-'),
              art: 'from',
              kind: d.kind,
              title: d.title,
              body: d.kind === 'text' ? clone(ver0.body ?? d.body) : null,
              grid: d.kind === 'sheet' && firstSheet ? gridOf(firstSheet) : null,
              fields: fieldVals(db(), asItem(d)),
              rot: 0,
            },
          ];
    pages.push({
      id: nid('pg-'),
      art: 'approval',
      title: d.title,
      rows: sh.rows,
      v: r.v,
      sha: sh.sha,
      rot: 0,
    });
    const nd = blank('pdf', d.title + ' · PDF/A', d.folder, r.by);
    Object.assign(nd, {
      pages,
      size: 0.6,
      pdfa: true,
      status: 'signed',
      src: { doc: d.id, v: r.v, op: 'route' },
      textLayer: true,
      mode: d.mode,
      share: clone(d.share),
      links: clone(d.links),
      ...(d.sensitivity ? { sensitivity: d.sensitivity } : {}),
    });
    nd.versions = [
      {
        v: 1,
        at: stamp(),
        by: nm(nd.owner),
        name: 'Подписанная копия v' + r.v,
        source: 'route',
        pages: clone(nd.pages ?? []),
        annots: clone(nd.annots ?? []),
      },
    ];
    db().docs?.items.unshift(asItem(nd));
    d.pdfaId = nd.id;
    return nd;
  }

  function activate(d: RDoc, i: number): void {
    const r = d.route;
    const st = r?.steps[i];
    if (!r || !st) return;
    r.cur = i;
    st.status = 'active';
    st.due = addWorkDays(opts().today, st.days);
    st.from = stamp();
    if (st.kind === 'approve') {
      for (const x of st.who) {
        if (docRights(db(), x, asItem(d), opts()).L < 2) {
          d.tmp.push({
            member: x,
            level: 'comment',
            why: 'Согласующий на время шага «' + st.name + '»',
            route: r.id,
            step: i,
          });
        }
      }
    }
    if (st.kind === 'ack') {
      const aud = st.audience ?? [];
      st.people = db()
        .members.filter(
          (m) =>
            m.status !== 'blocked' && m.id !== r.by && aud.some((e) => entryHas(db(), m.id, e)),
        )
        .map((m) => m.id);
      for (const x of st.people) {
        if (docRights(db(), x, asItem(d), opts()).L < 1) {
          d.tmp.push({
            member: x,
            level: 'view',
            v: r.v,
            why: 'Ознакомление с утверждённой v' + r.v,
            route: r.id,
            step: i,
            keep: true,
          });
        }
      }
    }
    const wait = stepWaiting(st).filter((x) => x !== 'ext');
    if (wait.length) {
      ctx.emit(
        st.kind === 'ack'
          ? 'Ознакомьтесь с «' + d.title + '» v' + r.v + ' до ' + (st.due ?? '')
          : st.kind === 'sign'
            ? 'Утвердите «' + d.title + '» v' + r.v + ': подпись по коду из SMS'
            : 'Согласуйте «' + d.title + '» v' + r.v + ' до ' + (st.due ?? ''),
        st.kind === 'approve' && st.mode === 'seq' ? wait.slice(0, 1) : wait,
      );
    }
    if (st.kind === 'ack' && !(st.people ?? []).length) {
      advance(d);
      return;
    }
    syncTask(d);
  }

  function advance(d: RDoc): void {
    const r = d.route;
    const st = r?.steps[r.cur];
    if (!r || !st) return;
    st.status = 'done';
    st.end = stamp();
    d.tmp = d.tmp.filter((t) => !(t.route === r.id && t.step === r.cur && !t.keep));
    if (st.kind === 'sign' || st.kind === 'ext') {
      d.status = st.kind === 'sign' ? 'approved' : 'signed';
      d.frozen = fieldVals(db(), asItem(d));
      makePdfA(d);
    }
    if (r.cur + 1 < r.steps.length) {
      activate(d, r.cur + 1);
      return;
    }
    r.status = 'done';
    r.end = stamp();
    if (d.status === 'draft') d.status = 'agreed';
    hist(d, 'Маршрут завершён');
    taskNote(d, 'Маршрут завершён');
    ctx.emit('Маршрут «' + d.title + '» завершён', [r.by]);
    syncTask(d);
  }

  return {
    db,
    me,
    meName,
    nm,
    opts,
    doc,
    rights,
    rightsFor,
    seen,
    need,
    stamp,
    hm,
    hist,
    taskNote,
    syncTask,
    cut,
    makePdfA,
    activate,
    advance,
  };
}
