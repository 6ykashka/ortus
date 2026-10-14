import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Button } from '../Button';
import { Card } from '../Card';

describe('Card: обычная, выбранная, недоступная (с причиной)', () => {
  it('статичная карточка: заголовок h3, мета и содержимое, без кнопок', () => {
    render(
      <Card title="Логистика" meta="Подключён · 12 мест">
        Автопарк, рейсы, осмотры.
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Логистика' })).toBeInTheDocument();
    expect(screen.getByText('Подключён · 12 мест')).toBeVisible();
    expect(screen.getByText('Автопарк, рейсы, осмотры.')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('кликабельная карточка — ровно одна кнопка: заголовок; действия не вложены в неё', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <Card
        title="TR-000214"
        meta="А 123 ВС 77 · Илья Васильев"
        onOpen={onOpen}
        actions={<Button variant="secondary">Принять смену</Button>}
      />,
    );
    const open = screen.getByRole('button', { name: 'TR-000214' });
    const heading = screen.getByRole('heading', { name: 'TR-000214' });
    expect(within(heading).getByRole('button')).toBe(open);
    expect(within(open).queryByRole('button', { name: 'Принять смену' })).toBeNull();
    await user.click(open);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('href — ссылка вместо кнопки', () => {
    render(<Card title="Отчёт по рейсам" href="/data/trips" />);
    expect(screen.getByRole('link', { name: 'Отчёт по рейсам' })).toHaveAttribute(
      'href',
      '/data/trips',
    );
  });

  it('выбранная: aria-current и data-selected', () => {
    const { container } = render(<Card title="Москва-1" onOpen={() => undefined} selected />);
    expect(screen.getByRole('button', { name: 'Москва-1' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(container.firstElementChild).toHaveAttribute('data-selected');
  });

  it('недоступная: кнопка disabled, причина текстом и в описании', () => {
    render(
      <Card
        title="Склад"
        onOpen={() => undefined}
        disabled
        disabledReason="Модуль не подключён"
        dashed
        headingLevel={2}
      />,
    );
    const open = screen.getByRole('button', { name: 'Склад' });
    expect(open).toBeDisabled();
    expect(open).toHaveAccessibleDescription('Модуль не подключён');
    expect(screen.getByText('Модуль не подключён')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Склад' })).toBeInTheDocument();
  });

  it('axe: 0 нарушений serious/critical', async () => {
    const { container } = render(
      <div>
        <Card title="Логистика" meta="Подключён">
          Автопарк, рейсы.
        </Card>
        <Card title="Москва-1" onOpen={() => undefined} selected />
        <Card title="Отчёт" href="/data" />
        <Card title="Склад" onOpen={() => undefined} disabled disabledReason="Не подключён" />
      </div>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
