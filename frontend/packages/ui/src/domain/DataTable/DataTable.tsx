import type { ReactElement, ReactNode } from 'react';
import { labels } from '../../core/_internal/labels';
import { useMediaQuery } from '../../core/_internal/useMediaQuery';
import { Banner } from '../../core/Banner';
import { EmptyState } from '../../core/EmptyState';
import { Icon } from '../../core/Icon';
import { Skeleton } from '../../core/Skeleton';
import type { DataColumn, DataTableProps } from '../../types';
import styles from './DataTable.module.css';

type Sort = NonNullable<DataTableProps<unknown>['sort']>;

/** Ширина, на которой таблица становится списком карточек (components.md: < 640px). */
const NARROW = '(max-width: 639px)';

function cell<Row>(column: DataColumn<Row>, row: Row): ReactNode {
  if (column.render) return column.render(row);
  return (row as Record<string, ReactNode>)[column.key] ?? null;
}

function ariaSort(column: DataColumn<unknown>, sort?: Sort): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== column.key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

function nextSort(key: string, sort?: Sort): Sort {
  if (sort?.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

/**
 * Таблица данных (Дизайн-система.dc.html:362–380): `th scope="col"`, `aria-sort` и кнопка сортировки
 * в заголовке (состояние сортировки и фильтров держит страница — в URL); `onRow` — одна кнопка в главной
 * ячейке и клик по строке. Состояния: загрузка (скелетон), пусто (`EmptyState`), ошибка (`Banner` danger
 * с «Повторить»). На < 640 px при `mobile="cards"` (по умолчанию, Q-W0.10-2) — список карточек: главное
 * поле наверху, остальные — «подпись: значение», вся карточка — одна кнопка; `scroll` — прокрутка.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  filter,
  onRow,
  state = 'ready',
  empty,
  error,
  mobile = 'cards',
  minWidth = 640,
}: DataTableProps<Row>): ReactElement {
  const narrow = useMediaQuery(NARROW);
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);

  let body: ReactNode;
  if (state === 'loading') {
    body = (
      <div className={styles.state} role="status" aria-label={labels.loading} aria-busy="true">
        <Skeleton lines={3} />
      </div>
    );
  } else if (state === 'error') {
    body = (
      <Banner
        tone="danger"
        icon="sync_problem"
        role="alert"
        title={error?.text ?? ''}
        action={error?.onRetry ? { label: labels.retry, onPress: error.onRetry } : undefined}
      />
    );
  } else if (empty && (state === 'empty' || rows.length === 0)) {
    body = <EmptyState {...empty} />;
  } else if (narrow && mobile === 'cards') {
    body = (
      <ul className={styles.cards}>
        {rows.map((row) => {
          const title = primary ? cell(primary, row) : null;
          return (
            <li key={rowKey(row)} className={styles.card} data-clickable={onRow ? '' : undefined}>
              <span className={styles.cardTitle} data-mono={primary?.mono ? '' : undefined}>
                {onRow ? (
                  <button type="button" className={styles.cardButton} onClick={() => onRow(row)}>
                    {title}
                  </button>
                ) : (
                  title
                )}
              </span>
              {rest.length > 0 ? (
                <dl className={styles.fields}>
                  {rest.map((column) => (
                    <div key={column.key} className={styles.field}>
                      <dt>{column.header}</dt>
                      <dd data-mono={column.mono ? '' : undefined}>{cell(column, row)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  } else {
    body = (
      <div className={styles.frame}>
        <div className={styles.scroll}>
          <table className={styles.table} style={{ minWidth }}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    data-align={column.align}
                    aria-sort={onSort ? ariaSort(column as DataColumn<unknown>, sort) : undefined}
                    style={column.width ? { width: column.width } : undefined}
                  >
                    {onSort ? (
                      <button
                        type="button"
                        className={styles.sort}
                        onClick={() => onSort(nextSort(column.key, sort))}
                      >
                        {column.header}
                        <Icon
                          name={
                            sort?.key === column.key
                              ? sort.dir === 'asc'
                                ? 'arrow_upward'
                                : 'arrow_downward'
                              : 'unfold_more'
                          }
                          size={16}
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  data-clickable={onRow ? '' : undefined}
                  onClick={onRow ? () => onRow(row) : undefined}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      data-align={column.align}
                      data-mono={column.mono ? '' : undefined}
                    >
                      {onRow && column === primary ? (
                        <button
                          type="button"
                          className={styles.rowButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRow(row);
                          }}
                        >
                          {cell(column, row)}
                        </button>
                      ) : (
                        cell(column, row)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {filter ? <div className={styles.toolbar}>{filter}</div> : null}
      {body}
    </div>
  );
}
