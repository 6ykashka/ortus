// Подпись области назначения: 11 видов (models.js 14.10 `:258–275`). Срезы модулей ядро читает
// структурно: модуль может ещё не быть подключён, тогда подпись строится по id.
import type { CoreDb, Scope } from '../types/index.ts';
import { unit, unitLabel } from './units.ts';

type Row = Record<string, unknown>;

const isRow = (x: unknown): x is Row => !!x && typeof x === 'object';

/** Строка `db[slice][list]` с данным id (или с `key === id`). */
function findRow(db: CoreDb, path: readonly string[], id: string, key = 'id'): Row | undefined {
  let cur: unknown = db;
  for (const p of path) cur = isRow(cur) ? cur[p] : undefined;
  return Array.isArray(cur)
    ? cur.find((x: unknown): x is Row => isRow(x) && x[key] === id)
    : undefined;
}

const text = (row: Row | undefined, field: string): string | undefined => {
  const v = row?.[field];
  return typeof v === 'string' ? v : undefined;
};

export function scopeLabel(db: CoreDb, scope: Scope | undefined): string {
  if (!scope) return 'Область не выбрана';
  switch (scope.type) {
    case 'tenant':
      return 'Вся организация';
    case 'region':
      return 'Регион ' + (unit(db, scope.id)?.name ?? '—');
    case 'firm':
      return unitLabel(db, scope.id);
    case 'self':
      return 'Только назначенное лично';
    case 'project': {
      const p = findRow(db, ['projects'], scope.id);
      if (p) return 'Проект «' + text(p, 'name') + '»';
      const d = findRow(db, ['service', 'directions'], scope.id, 'project');
      if (d) return 'Направление «' + text(d, 'name') + '»';
      return 'Только назначенное лично';
    }
    case 'space':
      return (
        'Пространство «' +
        (text(findRow(db, ['knowledge', 'spaces'], scope.id), 'name') ?? scope.id) +
        '»'
      );
    case 'page':
      return (
        'Страница «' +
        (text(findRow(db, ['knowledge', 'pages'], scope.id), 'title') ?? scope.id) +
        '»'
      );
    case 'folder':
      return (
        'Папка «' + (text(findRow(db, ['docs', 'folders'], scope.id), 'name') ?? scope.id) + '»'
      );
    case 'chat': {
      const c = findRow(db, ['chats', 'items'], scope.id);
      return 'Чат «' + (c ? (text(c, 'title') ?? 'личный') : scope.id) + '»';
    }
    case 'doc':
      return (
        'Документ «' + (text(findRow(db, ['docs', 'items'], scope.id), 'title') ?? scope.id) + '»'
      );
    case 'account':
      return (
        'Касса «' + (text(findRow(db, ['cash', 'accounts'], scope.id), 'name') ?? scope.id) + '»'
      );
  }
}
