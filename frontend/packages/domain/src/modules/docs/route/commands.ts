// Команды маршрута документа (documents.js 14.10/19.10:827–933, B §3.3): запуск, решение, подпись
// ПЭП по коду из SMS, ознакомление, возобновление после доработки, отмена. Синхронные функции над
// БД текущей организации; задержку и `view` добавляет адаптер (`cmd` эталона).
//
// Отличия от эталона (решения по умолчанию, бриф W7.22 §4):
// - Q-W7.22-2: `docRouteDecide`, `docSignStart`, `docSign`, `docAck`, `docAckClose`, `docRouteCancel`
//   проверяют, что документ виден участнику (эталон не проверял, B §3.3 «Риски»): не видит — `not_found`;
// - решение должно быть `ok` или `back`: эталон принимал любое значение за «согласовано», и на шаге
//   утверждения пустое решение обходило подпись по коду;
// - Q-W7.22-1: решение «от имени» (`as`) и подпись заказчика (шаг `ext`) оставлены как в эталоне,
//   с пометкой «демо»; в backend (W7.24) их нет;
// - время, «сегодня», события и id — через `ctx` (часы, счётчик, `emit`), задачи — через `TaskPort`.
import { objOf } from '../../../core/entries.ts';
import type { CommandFn, ModuleCtx } from '../../../core/module.ts';
import type { Entry } from '../../../core/types/index.ts';
import { projCan } from '../../tasks/access.ts';
import { projectOf } from '../../tasks/workflow.ts';
import { isDocOwner } from '../core/access.ts';
import { APPROVE_MODES, STEP_KINDS } from '../core/dictionaries.ts';
import { folderOf } from '../core/tree.ts';
import type { RouteTpl, StepKind, StepMode } from '../core/types.ts';
import { stepWaiting } from '../core/waits.ts';
import { createRouteEngine } from './engine.ts';
import type { RDoc, RRoute, RStep, RouteDecideSpec, RouteRules, RouteStartSpec } from './types.ts';

export const ROUTE_METHODS = [
  'docRouteStart',
  'docRouteDecide',
  'docSignStart',
  'docSign',
  'docAck',
  'docAckClose',
  'docRouteResume',
  'docRouteCancel',
] as const;

/** Задержки mock-адаптера, мс (эталон: `cmd(fn, ms)`). */
export const ROUTE_DELAYS: Readonly<Record<(typeof ROUTE_METHODS)[number], number>> = {
  docRouteStart: 420,
  docRouteDecide: 300,
  docSignStart: 400,
  docSign: 420,
  docAck: 300,
  docAckClose: 300,
  docRouteResume: 350,
  docRouteCancel: 300,
};

export interface DocsRouteCommands {
  docRouteStart(id: string, spec?: RouteStartSpec): { task: string; v: number };
  docRouteDecide(id: string, spec?: RouteDecideSpec): { status: RRoute['status'] };
  docSignStart(id: string): { code: string; phone: string };
  docSign(id: string, code: string): { pdfa: string | null };
  docAck(id: string, spec?: { device?: string }): { done: number; of: number };
  docAckClose(id: string): { ok: true };
  docRouteResume(id: string): { v: number };
  docRouteCancel(id: string): { ok: true };
}

const p2 = (n: number): string => String(n).padStart(2, '0');

export function createDocsRouteCommands(
  ctx: ModuleCtx,
): DocsRouteCommands & Record<string, CommandFn> {
  const E = createRouteEngine(ctx);
  const bad = (text: string): never => {
    throw new ctx.ApiError('validation', text);
  };
  const canManageRoute = (r: RRoute): boolean => r.by === E.me() || isDocOwner(E.db(), E.me());

  /** Запись списка доступа аудитории шага «Ознакомить». */
  const checkEntry = (e: Entry | undefined): Entry => {
    const db = E.db();
    if (!e || !['all', 'member', 'group', 'role', 'relation'].includes(e.who)) {
      return bad('Неверная запись в списке доступа');
    }
    if (e.who === 'member' && !db.members.some((m) => m.id === e.ref)) {
      return bad('Сотрудник не найден');
    }
    if (e.who === 'group' && !(db.groups ?? []).some((g) => g.id === e.ref)) {
      return bad('Группа не найдена');
    }
    if (e.who === 'role' && !db.roles.some((r) => r.id === e.ref)) return bad('Роль не найдена');
    if (e.who === 'relation' && !objOf(db, e.obj)) return bad('Объект не найден');
    return {
      who: e.who,
      ...(e.ref ? { ref: e.ref } : {}),
      ...(e.unit ? { unit: e.unit } : {}),
      ...(e.obj ? { obj: e.obj } : {}),
    };
  };

  const onRoute = (d: RDoc): RRoute => {
    const r = d.route;
    if (!r || r.status !== 'active') return bad('Документ не на маршруте');
    return r;
  };

  function buildSteps(d: RDoc, spec: RouteStartSpec, rules: RouteRules): RStep[] {
    const db = E.db();
    const lk = d.links.find((x) => x.kind === 'object');
    const o = lk ? (objOf(db, lk.id) as { client?: string } | undefined) : undefined;
    const steps = (spec.steps ?? []).slice(0, 6);
    return steps.map((st, i) => {
      if (!Object.hasOwn(STEP_KINDS, st.kind)) return bad('Неизвестный шаг');
      const kind = st.kind as StepKind;
      const days = Math.max(1, Math.min(10, Number(st.days) || 1));
      const name = STEP_KINDS[kind][0] as string;
      const n = 'Шаг ' + (i + 1) + ' «' + name + '»: ';
      if (kind === 'approve') {
        const who = [...new Set(st.who ?? [])];
        if (!who.length) return bad(n + 'добавьте согласующих');
        for (const x of who) {
          const m = db.members.find((y) => y.id === x);
          if (!m) return bad(n + 'сотрудник не найден');
          if (m.status === 'blocked') return bad(n + m.name + ' заблокирован');
          if (rules.notAuthor && x === E.me()) {
            return bad(n + 'автор не согласует свой документ. Уберите себя или выключите правило');
          }
        }
        const mode = Object.hasOwn(APPROVE_MODES, st.mode ?? '') ? (st.mode as StepMode) : 'all';
        return { kind, name, mode, who, days, decisions: [], status: 'wait' };
      }
      if (kind === 'sign') {
        const x = (st.who ?? [])[0] ?? '';
        const m = db.members.find((y) => y.id === x);
        if (!m) return bad(n + 'выберите, кто утверждает');
        if (!E.rightsFor(x, d).sign) {
          return bad(
            n +
              m.name +
              ' не может утверждать: нет права «Документы · Утверждать» в области документа',
          );
        }
        if (rules.notAuthor && x === E.me()) {
          return bad(
            n +
              'автор не утверждает свой документ. Выберите другого утверждающего или выключите правило',
          );
        }
        return { kind, name, who: [x], days, decisions: [], status: 'wait' };
      }
      if (kind === 'ack') {
        const audience = (st.audience ?? []).map(checkEntry);
        if (!audience.length) return bad(n + 'добавьте роль, группу или сотрудников');
        return {
          kind,
          name,
          audience,
          people: [],
          done: [],
          days,
          status: 'wait',
        } as unknown as RStep; // у шага `ack` нет `who` и `decisions`, как в эталоне
      }
      const clientName = String(st.ext?.name || o?.client || '').trim();
      if (!clientName) return bad(n + 'укажите заказчика');
      return {
        kind,
        name,
        ext: { name: clientName, phone: st.ext?.phone || '+7 9•• •••-••-42' },
        who: [],
        days,
        decisions: [],
        status: 'wait',
      };
    });
  }

  const cmds: DocsRouteCommands = {
    docRouteStart(id, spec) {
      const db = E.db();
      const d = E.doc(id);
      E.need(d, 4, 'отправлять на согласование');
      if (d.pdfa) bad('PDF/A-копию не отправляют на согласование');
      if (d.route && ['active', 'returned'].includes(d.route.status))
        bad('Документ уже на маршруте');
      const s = spec ?? {};
      const ru = s.rules ?? {};
      if (!(s.steps ?? []).length) bad('Добавьте хотя бы один шаг');
      const rules: RouteRules = {
        lock: ru.lock !== false,
        notAuthor: ru.notAuthor !== false,
        commentOnBack: ru.commentOnBack !== false,
        escalate: !!ru.escalate,
      };
      const out = buildSteps(d, s, rules);
      const p = projectOf(db, s.project ?? '');
      if (!p?.wf) return bad('Выберите проект задач с процессом');
      if (!projCan(db, p, E.me(), 'create').ok) {
        throw new ctx.ApiError(
          'forbidden',
          'Нет права создавать задачи в проекте «' + p.name + '»',
        );
      }
      if (d.dirty) E.cut(d, { name: 'На согласование', source: 'edit' });
      else {
        const last = d.versions[d.versions.length - 1];
        if (last && !last.name) last.name = 'На согласование';
      }
      if (d.route) (d.routeLog ??= []).unshift(d.route);
      d.route = {
        id: ctx.ids.next('rt-'),
        v: d.v,
        by: E.me(),
        at: E.stamp(),
        status: 'active',
        cur: 0,
        steps: out,
        rules,
        project: p.id,
        task: null,
      };
      d.status = 'draft';
      d.frozen = null;
      const statuses = p.wf.statuses;
      const first =
        statuses.find((x) => x.name === 'На проверке') ??
        statuses.find((x) => x.cat === 'progress') ??
        statuses[0];
      const t = ctx.tasks.create({
        project: p.id,
        title: 'Согласовать: ' + d.title,
        description:
          'Маршрут документа «' +
          d.title +
          '» v' +
          d.v +
          ': ' +
          out.map((x) => x.name).join(' → ') +
          '. Решения принимаются в «Документах», статус задачи меняет маршрут.',
        labels: ['документ'],
        assignee: E.meName(),
        author: E.meName(),
        authorId: E.me(),
        status: first?.name,
        priority: 'high',
        due: '—',
        comments: [{ by: E.meName(), at: E.hm(), text: 'Маршрут запущен: v' + d.v, system: true }],
        idPrefix: p.key + '-',
        idBase: 100,
      });
      d.route.task = t.id;
      if (s.saveTpl) {
        const f = folderOf(db, d.folder);
        if (f) {
          f.routeTpl = {
            name: 'Шаблон папки «' + f.name + '»',
            project: p.id,
            steps: structuredClone((s.steps ?? []).slice(0, 6)),
            rules,
          } as RouteTpl;
        }
      }
      E.hist(
        d,
        'Отправлен на согласование: v' +
          d.v +
          ' · ' +
          out.map((x) => x.name).join(' → ') +
          ' · задача ' +
          t.id,
      );
      E.activate(d, 0);
      return { task: t.id, v: d.v };
    },

    docRouteDecide(id, spec) {
      const d = E.doc(id);
      E.seen(d);
      const r = onRoute(d);
      const s = spec ?? {};
      if (s.decision !== 'ok' && s.decision !== 'back') {
        return bad('Выберите решение: согласовать или вернуть на доработку');
      }
      const st = r.steps[r.cur];
      if (!st) return bad('Документ не на маршруте');
      const wait = stepWaiting(st);
      let who = E.me();
      let demo = false;
      if (s.as && s.as !== E.me()) {
        if (!wait.includes(s.as)) bad('Решение этого участника сейчас не ждут');
        who = s.as;
        demo = true;
      } else if (!wait.includes(who)) {
        throw new ctx.ApiError(
          'forbidden',
          wait.length
            ? 'Сейчас решение ждут: ' +
                wait.map((x) => (x === 'ext' ? (st.ext?.name ?? '') : E.nm(x))).join(', ')
            : 'Сейчас ваше решение не нужно',
        );
      }
      if (st.kind === 'ack') bad('Ознакомление подтверждает сам сотрудник');
      if (st.kind === 'sign' && s.decision === 'ok' && !demo) {
        bad('Утверждение — подписью по коду из SMS');
      }
      const comment = String(s.comment ?? '')
        .trim()
        .slice(0, 1000);
      const whoName = who === 'ext' ? (st.ext?.name ?? '') : E.nm(who);
      if (s.decision === 'back') {
        if (r.rules.commentOnBack && !comment) bad('Напишите, что доработать');
        st.decisions.push({ member: who, decision: 'back', at: E.stamp(), comment, demo });
        r.status = 'returned';
        r.back = { step: r.cur, by: who, name: whoName, comment, at: E.stamp() };
        d.tmp = d.tmp.filter((t) => !(t.route === r.id && !t.keep));
        E.hist(d, whoName + ' вернул(а) на доработку: ' + (comment || 'без комментария'));
        E.taskNote(
          d,
          whoName +
            ': вернул(а) на доработку v' +
            r.v +
            (comment ? ' — ' + comment : '') +
            (demo ? ' (демо)' : ''),
        );
        ctx.emit('«' + d.title + '» вернули на доработку: ' + (comment || 'без комментария'), [
          r.by,
        ]);
        E.syncTask(d);
        return { status: 'returned' };
      }
      st.decisions.push({
        member: who,
        decision: 'ok',
        at: E.stamp(),
        comment,
        method: st.kind === 'ext' ? 'sms_link' : st.kind === 'sign' ? 'pep_sms' : 'click',
        demo,
      });
      E.taskNote(
        d,
        whoName +
          ': ' +
          (st.kind === 'ext'
            ? 'подписал(а) по коду из SMS'
            : st.kind === 'sign'
              ? 'утвердил(а)'
              : 'согласовал(а)') +
          ' v' +
          r.v +
          (comment ? ' — ' + comment : '') +
          (demo ? ' (демо)' : ''),
      );
      if (!stepWaiting(st).length) E.advance(d);
      else {
        const w2 = stepWaiting(st);
        if (st.mode === 'seq') ctx.emit('Согласуйте «' + d.title + '» v' + r.v, w2.slice(0, 1));
        E.syncTask(d);
      }
      return { status: r.status };
    },

    docSignStart(id) {
      const d = E.doc(id);
      E.seen(d);
      const r = onRoute(d);
      const st = r.steps[r.cur];
      if (st?.kind !== 'sign' || !stepWaiting(st).includes(E.me())) {
        throw new ctx.ApiError('forbidden', 'Сейчас ваша подпись не нужна');
      }
      const n = Number(ctx.ids.next(''));
      const code = String(1000 + ((n * 7919) % 9000));
      r.sms = { code, member: E.me(), tries: 0, at: E.hm() };
      return { code, phone: '+7 9•• •••-••-' + p2((ctx.ids.peek() * 37) % 100) };
    },

    docSign(id, code) {
      const d = E.doc(id);
      E.seen(d);
      const r = onRoute(d);
      if (!r.sms || r.sms.member !== E.me()) bad('Сначала запросите код');
      const sms = r.sms;
      if (sms && sms.tries >= 3) bad('Попытки закончились — запросите новый код');
      if (sms && String(code ?? '').trim() !== sms.code) {
        sms.tries++;
        bad('Код не подходит. Осталось попыток: ' + (3 - sms.tries));
      }
      r.steps[r.cur]?.decisions.push({
        member: E.me(),
        decision: 'ok',
        at: E.stamp(),
        method: 'pep_sms',
      });
      r.sms = null;
      E.taskNote(d, E.meName() + ': утвердил(а) v' + r.v + ' · ПЭП, код из SMS');
      E.hist(d, 'Утверждён: ' + E.meName() + ' · ПЭП');
      E.advance(d);
      return { pdfa: d.pdfaId ?? null };
    },

    docAck(id, spec) {
      const d = E.doc(id);
      E.seen(d);
      const r = d.route;
      const st = r?.steps[r.cur];
      if (!r || r.status !== 'active' || st?.kind !== 'ack') bad('Ознакомление не запрошено');
      if (!r || !st) return { done: 0, of: 0 };
      const people = st.people ?? [];
      if (!people.includes(E.me())) bad('Ознакомление запрошено у других сотрудников');
      const done = (st.done ??= []);
      if (!done.some((x) => x.member === E.me())) {
        done.push({
          member: E.me(),
          at: E.stamp(),
          v: r.v,
          device: spec?.device || 'компьютер',
        });
        E.taskNote(d, E.meName() + ': ознакомлен(а) с v' + r.v);
      }
      if (!stepWaiting(st).length) E.advance(d);
      else E.syncTask(d);
      return { done: done.length, of: people.length };
    },

    docAckClose(id) {
      const d = E.doc(id);
      E.seen(d);
      const r = d.route;
      const st = r?.steps[r.cur];
      if (!r || r.status !== 'active' || st?.kind !== 'ack') return bad('Ознакомление не идёт');
      if (!st) return bad('Ознакомление не идёт');
      if (!canManageRoute(r)) {
        throw new ctx.ApiError(
          'forbidden',
          'Завершить ознакомление может автор маршрута или владелец бизнеса',
        );
      }
      st.closed = { at: E.stamp(), by: E.me(), left: stepWaiting(st) };
      E.hist(
        d,
        'Ознакомление завершено: ' + (st.done ?? []).length + ' из ' + (st.people ?? []).length,
      );
      E.advance(d);
      return { ok: true };
    },

    docRouteResume(id) {
      const d = E.doc(id);
      E.need(d, 4, 'отправлять снова');
      const r = d.route;
      if (!r || r.status !== 'returned') return bad('Документ не на доработке');
      if (!canManageRoute(r)) {
        throw new ctx.ApiError('forbidden', 'Отправить снова может автор маршрута');
      }
      if (!d.dirty && d.v === r.v) bad('Сначала внесите правки: согласуют новую версию');
      if (d.dirty) E.cut(d, { name: 'После доработки', source: 'edit' });
      const i = r.back?.step ?? r.cur;
      const st = r.steps[i];
      if (!st) return bad('Документ не на доработке');
      r.v = d.v;
      r.status = 'active';
      st.decisions = [];
      st.status = 'wait';
      r.back = { name: '', ...r.back, resolved: true };
      E.hist(d, 'Снова на согласовании: v' + d.v + ' с шага «' + st.name + '»');
      E.taskNote(d, 'После доработки: v' + d.v + ', маршрут продолжен с шага «' + st.name + '»');
      E.activate(d, i);
      return { v: d.v };
    },

    docRouteCancel(id) {
      const d = E.doc(id);
      E.seen(d);
      const r = d.route;
      if (!r || !['active', 'returned'].includes(r.status)) return bad('Маршрут уже завершён');
      if (!canManageRoute(r)) {
        throw new ctx.ApiError('forbidden', 'Отменить маршрут может автор или владелец бизнеса');
      }
      r.status = 'cancelled';
      r.end = E.stamp();
      d.tmp = d.tmp.filter((t) => !(t.route === r.id && !t.keep));
      E.hist(d, 'Маршрут отменён');
      E.taskNote(d, E.meName() + ': маршрут отменён');
      E.syncTask(d);
      return { ok: true };
    },
  };
  return cmds as DocsRouteCommands & Record<string, CommandFn>;
}
