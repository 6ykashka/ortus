import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataColumn } from '../../types';
import { Status } from '../../core/Status';
import { seriousViolations } from '../../test/axe';
import { DataTable } from '../DataTable';

interface Trip {
  id: string;
  car: string;
  driver: string;
  state: 'review' | 'route' | 'done';
  cost: string;
}

// Дизайн-система.dc.html:365–369.
const rows: Trip[] = [
  {
    id: 'TR-000214',
    car: 'А 123 ВС 77',
    driver: 'Илья Васильев',
    state: 'review',
    cost: '4 120 ₽',
  },
  { id: 'TR-000213', car: 'Е 482 КМ 77', driver: 'Олег Белов', state: 'route', cost: '—' },
  { id: 'TR-000211', car: 'М 901 ОР 50', driver: 'Сергей Ким', state: 'done', cost: '2 870 ₽' },
];

const STATE = {
  review: { tone: 'warn', icon: 'pending', text: 'Ожидает приёмки' },
  route: { tone: 'info', icon: 'route', text: 'В рейсе' },
  done: { tone: 'ok', icon: 'verified', text: 'Принят' },
} as const;

const columns: DataColumn<Trip>[] = [
  { key: 'id', header: 'Рейс', mono: true, primary: true, render: (r) => r.id },
  { key: 'car', header: 'Машина', mono: true, render: (r) => r.car },
  { key: 'driver', header: 'Водитель', render: (r) => r.driver },
  {
    key: 'state',
    header: 'Статус',
    render: (r) => (
      <Status tone={STATE[r.state].tone} icon={STATE[r.state].icon}>
        {STATE[r.state].text}
      </Status>
    ),
  },
  { key: 'cost', header: 'Расходы', align: 'right', render: (r) => r.cost },
];

function mockNarrow(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DataTable (Дизайн-система.dc.html:362–380): th scope, сортировка, состояния, карточки < 640', () => {
  it('таблица: заголовки th scope="col", строки и ячейки', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual([
      'Рейс',
      'Машина',
      'Водитель',
      'Статус',
      'Расходы',
    ]);
    for (const th of headers) expect(th).toHaveAttribute('scope', 'col');
    expect(headers[4]).toHaveAttribute('data-align', 'right');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Ожидает приёмки')).toBeVisible();
    expect(within(table).getByText('TR-000214')).toHaveAttribute('data-mono');
  });

  it('сортировка: aria-sort у столбцов, клик по заголовку вызывает onSort', async () => {
    const onSort = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'id', dir: 'desc' }}
        onSort={onSort}
      />,
    );
    const trip = screen.getByRole('columnheader', { name: 'Рейс' });
    expect(trip).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: 'Машина' })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    const user = userEvent.setup();
    await user.click(within(trip).getByRole('button', { name: 'Рейс' }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'id', dir: 'asc' });
    await user.click(screen.getByRole('button', { name: 'Машина' }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'car', dir: 'asc' });
  });

  it('без onSort заголовки — текст, без кнопок и aria-sort', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const trip = screen.getByRole('columnheader', { name: 'Рейс' });
    expect(trip).not.toHaveAttribute('aria-sort');
    expect(within(trip).queryByRole('button')).toBeNull();
  });

  it('onRow: одна кнопка на строку в главной ячейке; клик по строке тоже открывает', async () => {
    const onRow = vi.fn();
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRow={onRow} />);
    const user = userEvent.setup();
    const row = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'TR-000214' }));
    expect(onRow).toHaveBeenLastCalledWith(rows[0]);
    await user.click(screen.getByText('Олег Белов'));
    expect(onRow).toHaveBeenLastCalledWith(rows[1]);
  });

  it('фильтр рисуется над таблицей', () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        filter={<button type="button">Фильтр</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Фильтр' })).toBeInTheDocument();
  });

  it('загрузка: role="status" «Загрузка», aria-busy, таблицы нет', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} state="loading" />);
    const status = screen.getByRole('status', { name: 'Загрузка' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('пусто: EmptyState из пропса empty', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        state="empty"
        empty={{
          icon: 'inbox',
          title: 'Нет смен на проверке',
          text: 'Когда водитель сдаст машину, смена появится здесь.',
        }}
      />,
    );
    expect(screen.getByText('Нет смен на проверке')).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('ошибка: role="alert" с текстом и «Повторить»', async () => {
    const onRetry = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        state="error"
        error={{ text: 'Не удалось загрузить рейсы.', onRetry }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить рейсы.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('< 640 px и mobile="cards": список карточек вместо таблицы, вся карточка — одна кнопка', async () => {
    mockNarrow(true);
    const onRow = vi.fn();
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRow={onRow} />);
    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list');
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    const first = cards[0] as HTMLElement;
    expect(within(first).getAllByRole('button')).toHaveLength(1);
    expect(within(first).getByText('Машина')).toBeInTheDocument();
    expect(within(first).getByText('А 123 ВС 77')).toBeInTheDocument();
    await userEvent.setup().click(within(first).getByRole('button', { name: 'TR-000214' }));
    expect(onRow).toHaveBeenCalledWith(rows[0]);
  });

  it('< 640 px и mobile="scroll": остаётся таблица с прокруткой', () => {
    mockNarrow(true);
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} mobile="scroll" />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('axe: таблица и карточки без нарушений serious/critical', async () => {
    const { container, unmount } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRow={() => undefined}
        onSort={() => undefined}
        sort={{ key: 'id', dir: 'asc' }}
      />,
    );
    expect(await seriousViolations(container)).toEqual([]);
    unmount();
    mockNarrow(true);
    const narrow = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRow={() => undefined} />,
    );
    expect(await seriousViolations(narrow.container)).toEqual([]);
  });
});
