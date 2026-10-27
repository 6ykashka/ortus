import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleChangePreviewProps } from '../../types';
import { ScheduleChangePreview } from './ScheduleChangePreview';

const props = (o: Partial<ScheduleChangePreviewProps> = {}): ScheduleChangePreviewProps => ({
  changes: [
    {
      stageId: 'b',
      title: 'Штукатурка стен',
      start: '2026-10-13',
      end: '2026-10-15',
      from: { start: '2026-10-12', end: '2026-10-14' },
    },
  ],
  moved: 2,
  finish: { from: '2026-12-01', to: '2026-12-03' },
  notify: ['Бригада О. Дронова', 'Заказчик'],
  reasons: [
    { value: 'executor_busy', label: 'Задержка подрядчика' },
    { value: 'client_request', label: 'Решение заказчика' },
  ],
  onApply: () => undefined,
  onCancel: () => undefined,
  ...o,
});

describe('ScheduleChangePreview', () => {
  it('регион «Несохранённое изменение графика» с заголовком предпросмотра', () => {
    render(<ScheduleChangePreview {...props()} />);
    const region = screen.getByRole('region', { name: 'Несохранённое изменение графика' });
    expect(region).toHaveTextContent('Предпросмотр изменения — ещё не сохранено');
  });

  it('тексты по умолчанию из пропсов: строки изменений, сдвинутые этапы, сдача, кого уведомим', () => {
    render(<ScheduleChangePreview {...props()} />);
    expect(screen.getByText('«Штукатурка стен»: начало 12.10 → 13.10')).toBeInTheDocument();
    expect(screen.getByText('Сдвинутся следом: 2.')).toBeInTheDocument();
    expect(screen.getByText('Сдача: 01.12 → 03.12.')).toBeInTheDocument();
    expect(screen.getByText('Уведомим: Бригада О. Дронова, Заказчик.')).toBeInTheDocument();
  });

  it('готовые тексты страницы заменяют собранные', () => {
    render(
      <ScheduleChangePreview
        {...props({
          texts: {
            lines: '«Штукатурка стен»: длительность 10 → 11 раб. дней.',
            moved: 'Другие этапы не сдвигаются.',
            finish: 'Дата сдачи не меняется: 01.12, вт.',
            notify: 'Уведомим: исполнителей нет.',
          },
        })}
      />,
    );
    expect(
      screen.getByText('«Штукатурка стен»: длительность 10 → 11 раб. дней.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Дата сдачи не меняется: 01.12, вт.')).toBeInTheDocument();
    expect(screen.queryByText('Сдвинутся следом: 2.')).toBeNull();
  });

  it('без причины «Сохранить и уведомить» неактивна и есть подсказка; с причиной — onApply(value)', () => {
    const onApply = vi.fn();
    render(<ScheduleChangePreview {...props({ onApply })} />);
    const save = screen.getByRole('button', { name: 'Сохранить и уведомить' });
    expect(save).toBeDisabled();
    expect(
      screen.getByText('Причина попадёт в историю графика и в уведомления.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Причина'), { target: { value: 'client_request' } });
    expect(save).toBeEnabled();
    expect(screen.queryByText('Причина попадёт в историю графика и в уведомления.')).toBeNull();
    fireEvent.click(save);
    expect(onApply).toHaveBeenCalledWith('client_request');
  });

  it('список причин: «Выберите причину» и подписи', () => {
    render(<ScheduleChangePreview {...props()} />);
    const select = screen.getByLabelText('Причина') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual([
      'Выберите причину',
      'Задержка подрядчика',
      'Решение заказчика',
    ]);
  });

  it('«Отменить» вызывает onCancel; во время сохранения кнопки неактивны', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<ScheduleChangePreview {...props({ onCancel })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(onCancel).toHaveBeenCalled();
    rerender(<ScheduleChangePreview {...props({ onCancel, busy: true })} />);
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Сохранить и уведомить' })).toBeDisabled();
  });

  it('сдача позже договора помечена (data-late)', () => {
    render(<ScheduleChangePreview {...props({ late: true })} />);
    expect(screen.getByText('Сдача: 01.12 → 03.12.')).toHaveAttribute('data-late', 'true');
  });
});
