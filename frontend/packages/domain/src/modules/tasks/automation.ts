// Автоматизация проекта и переход статуса (api.js 14.10:142–165, docs/21 «Автоматизация»).
// Правило выполняется от имени автора с проверкой его права «Менять статус» на каждом запуске.
// Изменения, сделанные правилами, правила не запускают (глубина 1) — циклов нет. Журнал запусков
// хранит последние 30: успех, остановка по условию, ошибка; ошибка ещё и событие владельцам.
import { grants } from '../../core/access/index.ts';
import { hhmm, type Clock } from '../../core/clock.ts';
import { ApiError } from '../../core/errors/index.ts';
import type { Emit } from '../../core/events.ts';
import type { CoreDb } from '../../core/types/index.ts';
import { projCan } from './access.ts';
import { PRIORITY } from './dictionaries.ts';
import type {
  Automation,
  AutomationTrigger,
  Project,
  RunResult,
  Task,
  TaskPriority,
  Transition,
} from './types.ts';

export const RUNS_KEPT = 30;

export interface Automations {
  /** Запускает включённые правила проекта для события задачи (`created` или `status` → `toId`). */
  autoFire(p: Project, t: Task, trigger: AutomationTrigger, toId: string | null): void;
  /** Переводит задачу по переходу и запускает правила «перешла в статус». */
  moveTo(p: Project, t: Task, tr: Transition, me: { name: string } | null, txt: string): void;
}

/** Владельцы бизнеса — получатели событий об ошибках правил (`owners()` эталона). */
export const ownerIds = (db: CoreDb): string[] =>
  db.members.filter((m) => grants(db, m.id).some((g) => g.roleObj.all)).map((m) => m.id);

const priorityLabel = (v: string): string => PRIORITY[v as TaskPriority]?.[0] ?? v;

export function createAutomation(getDb: () => CoreDb, clock: Clock, emit: Emit): Automations {
  let depth = 0;

  function runRule(p: Project, t: Task, r: Automation): void {
    const db = getDb();
    const runs = (p.runs ??= []);
    const log = (res: RunResult, text: string): void => {
      runs.unshift({
        at: hhmm(clock),
        rule: r.id,
        name: r.name,
        rv: r.version || 1,
        res,
        text,
        task: t.id,
      });
      runs.length = Math.min(runs.length, RUNS_KEPT);
    };
    if (r.cond?.priority && t.priority !== r.cond.priority) {
      log(
        'stopped',
        t.id + ': приоритет «' + priorityLabel(t.priority) + '» — условие не выполнено',
      );
      return;
    }
    const c = projCan(db, p, r.byId, 'edit');
    if (!c.ok) {
      emit('Правило «' + r.name + '» не выполнено: ' + c.why, ownerIds(db));
      log('error', 'У автора правила ' + r.by + ' нет права менять задачи: ' + c.why);
      return;
    }
    const v = String(r.action.value || '');
    if (r.action.kind === 'assign') {
      if (!db.members.some((m) => m.name === v && m.status === 'active')) {
        log('error', 'Сотрудник «' + v + '» не найден или неактивен');
        return;
      }
      t.assignee = v;
      log('ok', t.id + ' назначена: ' + v);
    } else if (r.action.kind === 'priority') {
      t.priority = v as TaskPriority;
      log('ok', t.id + ': приоритет «' + priorityLabel(v) + '»');
    } else {
      t.comments.push({ by: 'Автоматизация', at: hhmm(clock), text: v, system: true });
      log('ok', t.id + ': добавлен комментарий');
    }
    t.comments.push({
      by: 'Автоматизация',
      at: hhmm(clock),
      text: 'Правило «' + r.name + '» v' + (r.version || 1),
      system: true,
    });
  }

  const autoFire: Automations['autoFire'] = (p, t, trigger, toId) => {
    if (depth) return;
    depth++;
    try {
      const rules = (p.automations ?? []).filter(
        (r) => r.on && r.trigger === trigger && (trigger !== 'status' || r.to === toId),
      );
      for (const r of rules) runRule(p, t, r);
    } finally {
      depth--;
    }
  };

  const moveTo: Automations['moveTo'] = (p, t, tr, me, txt) => {
    const to = p.wf?.statuses.find((s) => s.id === tr.to);
    if (!to) throw new ApiError('validation', 'Переход удалён из процесса');
    const from = t.status;
    t.status = to.name;
    t.approval = null;
    t.comments.push({
      by: me ? me.name : 'Система',
      at: hhmm(clock),
      text: tr.name + ': ' + from + ' → ' + to.name + (txt ? '. ' + txt : ''),
      system: true,
    });
    if (tr.assignAuthor && t.author) {
      t.assignee = t.author;
      t.comments.push({
        by: 'Процесс',
        at: hhmm(clock),
        text: 'Назначено на автора: ' + t.author,
        system: true,
      });
    }
    autoFire(p, t, 'status', to.id);
  };

  return { autoFire, moveTo };
}
