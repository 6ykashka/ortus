// Проверка перехода процесса (models.js 14.10:217–233): переход из текущего статуса, право роли
// проекта, «Кто может», «не автор», согласование, чек-лист и подзадачи. Недоступный переход
// объясняет причину; переход не из текущего статуса скрыт (`hide`).
import type { CoreDb } from '../../core/types/index.ts';
import { projCan } from './access.ts';
import { WHO_LABEL, WHO_VERB } from './dictionaries.ts';
import type { Project, Task, Transition, TrCheck } from './types.ts';
import { childrenOf, isDone } from './workflow.ts';

type Db = CoreDb & { tasks?: Task[] };

/** Чек-лист и подзадачи — общие проверки обоих видов перехода. */
function gates(db: Db, t: Task, tr: Transition): TrCheck {
  if (tr.checklist && t.checklist.some((x) => !x.d)) {
    return { ok: false, why: 'Сначала закройте чек-лист' };
  }
  if (tr.children) {
    const open = childrenOf(db, t).filter((x) => !isDone(db, x));
    if (open.length) {
      return { ok: false, why: 'Сначала завершите подзадачи: ' + open.map((x) => x.id).join(', ') };
    }
  }
  return { ok: true };
}

/** Переход ведёт из текущего статуса: `'*'` — из любого, кроме целевого. */
function fromHere(tr: Transition, statusId: string): boolean {
  return tr.from.includes('*')
    ? !tr.from.includes(tr.to) && statusId !== tr.to
    : tr.from.includes(statusId);
}

export function trCheck(db: Db, p: Project, t: Task, memberId: string, tr: Transition): TrCheck {
  const st = p.wf?.statuses.find((s) => s.name === t.status);
  if (!st || !fromHere(tr, st.id)) return { ok: false, hide: true };
  if (tr.approval) {
    const c = projCan(db, p, memberId, 'review');
    if (!c.ok) return { ok: false, why: 'Согласует роль с правом «Согласовывать»; у вас ' + c.why };
    if (tr.notAuthor && t.authorId === memberId) {
      return { ok: false, why: 'Вы автор задачи — свою согласовать нельзя' };
    }
    if ((t.approval?.votes ?? []).some((v) => v.by === memberId && v.tr === tr.id)) {
      return { ok: false, why: 'Вы уже согласовали, ждём остальных' };
    }
    return gates(db, t, tr);
  }
  const c = projCan(db, p, memberId, 'edit');
  if (!c.ok) return { ok: false, why: 'Менять статус нельзя: ' + c.why };
  const m = db.members.find((x) => x.id === memberId);
  const fits = (w: Transition['who'][number]): boolean => {
    if (w === 'assignee') return !!m && t.assignee === m.name;
    if (w === 'author') return t.authorId === memberId;
    const verb = WHO_VERB[w];
    return !!verb && c.a.verbs.includes(verb);
  };
  if (tr.who.length && !c.a.owner && !tr.who.some(fits)) {
    return { ok: false, why: 'Доступно: ' + tr.who.map((w) => WHO_LABEL[w] ?? w).join(', ') };
  }
  if (tr.notAuthor && t.authorId === memberId) {
    return { ok: false, why: 'Автор задачи не может выполнить этот переход' };
  }
  return gates(db, t, tr);
}
