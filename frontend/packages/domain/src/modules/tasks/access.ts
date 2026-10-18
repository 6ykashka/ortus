// Доступ к проекту задач (models.js 14.10:194–216, docs/21). Участие — назначение роли с областью
// «проект»; роль фирмы или региона наследуется по уровню доступа проекта: открытый — все действия
// роли, ограниченный — только чтение, закрытый — ничего. Движок работает с грантами, как эталон
// (W0.11: модульные движки не проходят через `can`).
//
// Отличие от эталона (TP-03, ответы владельца продукта 17.10): «закрытый значит закрытый» —
// системная роль владельца не открывает закрытый проект; владелец видит его через «Проверить
// доступ» и аудит, а при нужде назначает себя наблюдателем.
import { grants, scopeCovers, unit } from '../../core/access/index.ts';
import type { CoreDb, Member, Verb } from '../../core/types/index.ts';
import { VERB_LABEL } from './dictionaries.ts';
import type { ProjAccess, ProjCanResult, Project, Task, Transition } from './types.ts';

const ALL_VERBS: readonly Verb[] = ['view', 'create', 'edit', 'review', 'settings'];

export function projAccess(db: CoreDb, p: Project, memberId: string): ProjAccess | null {
  const gs = grants(db, memberId);
  if (p.access !== 'closed' && gs.some((g) => g.roleObj.all)) {
    return {
      owner: true,
      verbs: [...ALL_VERBS],
      via: 'Системная роль, вся организация',
      inherited: true,
      roleName: 'Владелец бизнеса',
    };
  }
  const own = gs.find((g) => g.scope.type === 'project' && g.scope.id === p.id);
  if (own) {
    return {
      verbs: [...(own.roleObj.actions.tasks ?? [])],
      via: own.via ? 'Назначен через ' + own.via : 'Назначен в проекте',
      inherited: false,
      role: own.roleObj.id,
      roleName: own.roleObj.name,
      aid: own.id,
    };
  }
  if (p.access === 'closed') return null;
  const inh = gs.filter(
    (g) =>
      g.scope.type !== 'project' &&
      g.scope.type !== 'self' &&
      scopeCovers(db, g.scope, p.unit) &&
      (g.roleObj.actions.tasks ?? []).length > 0,
  );
  const [first] = inh;
  if (!first) return null;
  const all = [...new Set(inh.flatMap((g) => g.roleObj.actions.tasks ?? []))];
  const verbs = p.access === 'open' ? all : all.filter((v) => v === 'view');
  const u = 'id' in first.scope ? unit(db, first.scope.id) : undefined;
  return {
    verbs,
    via: 'Наследуется: «' + first.roleObj.name + '»' + (u ? ' в «' + u.name + '»' : ''),
    inherited: true,
    roleName: first.roleObj.name,
  };
}

export function projCan(db: CoreDb, p: Project, memberId: string, verb: Verb): ProjCanResult {
  const m = db.members.find((x) => x.id === memberId);
  if (!m || m.status === 'blocked') return { ok: false, why: 'сотрудник заблокирован' };
  const a = projAccess(db, p, memberId);
  if (!a) {
    return {
      ok: false,
      why:
        p.access === 'closed'
          ? 'закрытый проект — нужна роль в самом проекте'
          : 'нет роли с правом «Задачи» в области проекта',
    };
  }
  if (a.verbs.includes(verb)) return { ok: true, a };
  return {
    ok: false,
    a,
    why:
      'роль «' +
      a.roleName +
      '» не даёт «' +
      (VERB_LABEL[verb] ?? verb) +
      '»' +
      (a.inherited && p.access === 'limited'
        ? ': в ограниченном проекте унаследованный доступ — только чтение'
        : ''),
  };
}

/** Кто может согласовать переход: активные участники с «Согласовывать», без автора при «не автор». */
export const approversOf = (db: CoreDb, p: Project, t: Task, tr: Transition): Member[] =>
  db.members.filter(
    (m) =>
      m.status === 'active' &&
      projCan(db, p, m.id, 'review').ok &&
      !(tr.notAuthor && t.authorId === m.id),
  );
