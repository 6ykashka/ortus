// W4.12 · «Доска» проекта (`tasks-board`, эталон «Задачи и проекты.dc.html» ЗП:89–142, :388–413): фильтры «Все»,
// «Мои», «Ждут моего согласия · N» (listTasks `assignee=me`, `awaitingMyApproval`), быстрое создание (Enter с текстом
// — createTask, пустое поле — диалог «Новая задача»), колонки статусов процесса с карточками. Вид «Список» — строки по
// разметке старой доски «Ортус CRM.dc.html»:1650–1663 (Р-24, no-reference Q-W4.00-tasks-14).
import type { components } from '@ortus/api-client';
import { format, tasks as T } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import type { BoardFilter } from './api.ts';
import { cardOf, type ColumnVM, columnsOf } from './model.ts';
import { Sym } from './sym.tsx';

type S = components['schemas'];

/** Иконка и подпись статуса строки «Списка» (категория процесса, STATUS_CAT models.js:184). */
const CAT_ICON: Readonly<Record<S['TaskStatusCategory'], string>> = {
  todo: 'radio_button_unchecked',
  progress: 'pending',
  done: 'check_circle',
};
const PRIORITY_ICON: Readonly<Record<S['TaskPriority'], string>> = {
  urgent: 'priority_high',
  high: 'keyboard_double_arrow_up',
  normal: 'remove',
  low: 'keyboard_arrow_down',
};

export interface BoardBarProps {
  filter: BoardFilter;
  approvalCount: number;
  onFilter: (f: BoardFilter) => void;
  canCreate: boolean;
  quick: string;
  onQuick: (v: string) => void;
  onCreate: () => void;
}

/** Фильтры и быстрое создание (:92–96). */
export function BoardBar(p: BoardBarProps): ReactElement {
  const filters: [BoardFilter, string][] = [
    ['all', T.board.filters.all],
    ['mine', T.board.filters.mine],
    ['approval', format(T.board.approvalCount, { n: p.approvalCount })],
  ];
  return (
    <div className="ox-tk-filters">
      {filters.map(([k, label]) => (
        <button
          key={k}
          type="button"
          className="ox-tk-chip ox-tk-hit"
          aria-pressed={p.filter === k ? 'true' : 'false'}
          onClick={() => p.onFilter(k)}
        >
          {label}
        </button>
      ))}
      <span className="ox-tk-spacer" />
      {p.canCreate ? (
        <div className="ox-tk-quick">
          <input
            className="ox-tk-quick-input"
            value={p.quick}
            placeholder={T.board.quickPlaceholder}
            aria-label={T.board.quickAria}
            onChange={(e) => p.onQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') p.onCreate();
            }}
          />
          <button type="button" className="ox-tk-quick-btn ox-tk-hit" onClick={p.onCreate}>
            <Icon name="add" size={18} />
            {T.board.quickButton}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Column({
  c,
  selected,
  onSelect,
}: {
  c: ColumnVM;
  selected: string | null;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <div className="ox-tk-col" data-cat={c.category}>
      <div className="ox-tk-col-head">
        <span className="ox-tk-col-dot" />
        <span className="ox-tk-col-name">{c.name}</span>
        <span className="ox-tk-col-count">{c.count}</span>
      </div>
      {c.cards.map((k) => (
        <button
          key={k.id}
          type="button"
          className="ox-tk-kcard"
          data-selected={selected === k.id ? '' : undefined}
          onClick={() => onSelect(k.id)}
        >
          <span className="ox-tk-kcard-title">{k.title}</span>{' '}
          {k.rel ? <span className="ox-tk-rel">{k.rel}</span> : null}{' '}
          {k.appr ? (
            <span className="ox-tk-apprchip">
              <Sym name="how_to_reg" size={14} />
              <span>{k.appr}</span>
            </span>
          ) : null}{' '}
          <span className="ox-tk-kcard-foot">
            <span className="ox-tk-kcard-id">{k.key}</span>
            <span className="ox-tk-prio" data-priority={k.priority}>
              {k.priorityLabel}
            </span>
            <span className="ox-tk-spacer" />
            <span className="ox-tk-kcard-due">{k.due}</span>
            <span className="ox-tk-ini" title={k.who}>
              {k.initials}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Колонки доски (:127–141). */
export function BoardColumns(p: {
  statuses: readonly S['TaskWorkflowStatus'][];
  tasks: readonly S['Task'][];
  selected: string | null;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <div className="ox-tk-cols">
      {columnsOf(p.statuses, p.tasks).map((c) => (
        <Column key={c.id} c={c} selected={p.selected} onSelect={p.onSelect} />
      ))}
    </div>
  );
}

/** Вид «Список» (no-reference): строки старой доски — номер, тема, статус, исполнитель, приоритет, срок. */
export function TaskList(p: {
  tasks: readonly S['Task'][];
  selected: string | null;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <div className="ox-tk-list">
      {p.tasks.map((t) => {
        const k = cardOf(t);
        const cat = t.statusCategory ?? 'progress';
        return (
          <button
            key={t.id}
            type="button"
            className="ox-tk-lrow"
            aria-pressed={p.selected === t.id ? 'true' : 'false'}
            onClick={() => p.onSelect(t.id)}
          >
            <span className="ox-tk-lrow-id">{k.key}</span>
            <span className="ox-tk-lrow-title">{k.title}</span>
            <span className="ox-tk-lrow-status">
              <span className="ox-tk-stchip" data-cat={cat}>
                <Sym name={CAT_ICON[cat]} size={14} />
                {t.statusName ?? t.status}
              </span>
            </span>
            <span className="ox-tk-lrow-who">{k.who}</span>
            <span className="ox-tk-lrow-prio" data-priority={k.priority}>
              <Icon name={PRIORITY_ICON[k.priority]} size={16} />
              {k.priorityLabel}
            </span>
            <span className="ox-tk-lrow-due">{k.due}</span>
          </button>
        );
      })}
      {p.tasks.length === 0 ? <div className="ox-tk-list-empty">{T.list.empty}</div> : null}
    </div>
  );
}
