import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GanttProps, GanttStage } from '../../types';
import { Gantt } from './Gantt';

const stage = (o: Partial<GanttStage> & Pick<GanttStage, 'id' | 'title'>): GanttStage => ({
  start: '2026-10-12',
  end: '2026-10-14',
  kind: 'plan',
  ...o,
});

const base = (o: Partial<GanttProps> = {}): GanttProps => ({
  stages: [
    stage({ id: 'a', title: 'Демонтаж', start: '2026-10-05', end: '2026-10-09', kind: 'accepted' }),
    stage({ id: 'b', title: 'Штукатурка стен', canMove: true, canResize: true, critical: true }),
    stage({
      id: 'c',
      title: 'Сдача объекта',
      start: '2026-11-27',
      end: '2026-11-27',
      milestone: true,
    }),
  ],
  links: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ],
  today: '2026-10-20',
  calendar: { weekends: [0, 6], holidays: ['2026-11-04'] },
  zoom: 'day',
  ...o,
});

describe('Gantt', () => {
  it('этап — role="img" с датами и рабочими днями в подписи; веха — одной датой', () => {
    render(<Gantt {...base()} />);
    expect(
      screen.getByRole('img', { name: 'Демонтаж: 05.10, пн – 09.10, пт, 5 раб. дней' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Штукатурка стен: 12.10, пн – 14.10, ср, 3 раб. дня' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Сдача объекта: 27.11, пт' })).toBeInTheDocument();
  });

  it('название этапа — кнопка с aria-pressed; выбор вызывает onSelect', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<Gantt {...base({ onSelect })} />);
    const btn = screen.getByRole('button', { name: /Штукатурка стен/ });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith('b');
    rerender(<Gantt {...base({ onSelect, selected: 'b' })} />);
    expect(screen.getByRole('button', { name: /Штукатурка стен/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('разделы — строки-заголовки с датами; «сегодня» — отметка на шкале', () => {
    render(
      <Gantt
        {...base({
          stages: base().stages.map((s) => ({
            ...s,
            phase: s.id === 'c' ? 'Сдача' : 'Черновые работы',
          })),
        })}
      />,
    );
    expect(screen.getByText('Черновые работы')).toBeInTheDocument();
    expect(screen.getByText('05.10–14.10')).toBeInTheDocument();
    expect(screen.getByText('Сдача')).toBeInTheDocument();
    expect(screen.getByText('сегодня')).toBeInTheDocument();
  });

  it('связи — по одной на пару этапов, режим «Критический путь» гасит остальные', () => {
    const { container, rerender } = render(<Gantt {...base()} />);
    expect(container.querySelectorAll('[data-link]')).toHaveLength(2);
    expect(container.querySelector('[data-link="a>b"]')).toHaveAttribute('data-state', 'normal');
    rerender(<Gantt {...base({ criticalMode: true, selected: 'b' })} />);
    expect(container.querySelector('[data-link="a>b"]')).toHaveAttribute('data-state', 'hot');
    rerender(<Gantt {...base({ criticalMode: true })} />);
    expect(container.querySelector('[data-link="a>b"]')).toHaveAttribute('data-state', 'dim');
    const row = container.querySelector('[data-stage="a"]');
    expect(row).toHaveAttribute('data-dimmed', 'true');
    expect(container.querySelector('[data-stage="b"]')).toHaveAttribute('data-dimmed', 'false');
  });

  it('пауза после этапа — полоса с подписью', () => {
    const stages = base().stages.map((s) =>
      s.id === 'b'
        ? {
            ...s,
            paused: [
              { start: '2026-10-15', end: '2026-10-19', label: 'сушка штукатурки · 5 дней' },
            ],
          }
        : s,
    );
    render(<Gantt {...base({ stages })} />);
    expect(screen.getByText('сушка штукатурки · 5 дней')).toBeInTheDocument();
  });

  it('метка у названия: значок с пояснением; подпись и отклонение под названием', () => {
    const stages = base().stages.map((s) =>
      s.id === 'b'
        ? {
            ...s,
            meta: '12.10–14.10 · 3 дн',
            variance: { text: '+2 дн', tone: 'warn' as const },
            marks: [
              {
                icon: 'person_off',
                label: '«Штукатурка стен»: не назначен исполнитель',
                tone: 'warn' as const,
              },
            ],
          }
        : s,
    );
    render(<Gantt {...base({ stages })} />);
    expect(
      screen.getByRole('img', { name: '«Штукатурка стен»: не назначен исполнитель' }),
    ).toBeInTheDocument();
    expect(screen.getByText('12.10–14.10 · 3 дн')).toBeInTheDocument();
    expect(screen.getByText('+2 дн')).toBeInTheDocument();
  });

  it('«Базовый план»: серая полоса по договору под этапом', () => {
    const stages = base().stages.map((s) =>
      s.id === 'b' ? { ...s, baseline: { start: '2026-10-12', end: '2026-10-13' } } : s,
    );
    const { container, rerender } = render(<Gantt {...base({ stages })} />);
    expect(container.querySelector('[data-baseline="b"]')).toBeNull();
    rerender(<Gantt {...base({ stages, baseline: true })} />);
    expect(container.querySelector('[data-baseline="b"]')).not.toBeNull();
  });

  describe('перетаскивание мышью (масштаб «По дням»: 26 px на день)', () => {
    const drag = (el: Element, dx: number) => {
      fireEvent.pointerDown(el, { clientX: 100, button: 0, pointerId: 1, pointerType: 'mouse' });
      fireEvent.pointerMove(el, { clientX: 100 + dx * 26, pointerId: 1, pointerType: 'mouse' });
      fireEvent.pointerUp(el, { clientX: 100 + dx * 26, pointerId: 1, pointerType: 'mouse' });
    };
    const barOf = (id: string) => screen.getByRole('img', { name: new RegExp(id) });

    it('правый край: окончание на dx дней, на выходной — назад до пятницы, не раньше начала', () => {
      const onPreview = vi.fn();
      render(<Gantt {...base({ onPreview })} />);
      const handle = within(barOf('Штукатурка')).getByTitle(
        'Потяните, чтобы изменить длительность',
      );
      drag(handle, 2);
      expect(onPreview).toHaveBeenLastCalledWith({
        stageId: 'b',
        start: '2026-10-12',
        end: '2026-10-16',
      });
      drag(handle, 4);
      expect(onPreview).toHaveBeenLastCalledWith({
        stageId: 'b',
        start: '2026-10-12',
        end: '2026-10-16',
      });
      drag(handle, -5);
      expect(onPreview).toHaveBeenLastCalledWith({
        stageId: 'b',
        start: '2026-10-12',
        end: '2026-10-12',
      });
    });

    it('полоса: начало на dx дней по рабочим, длительность в рабочих днях сохраняется', () => {
      const onPreview = vi.fn();
      render(<Gantt {...base({ onPreview })} />);
      drag(barOf('Штукатурка'), 1);
      expect(onPreview).toHaveBeenLastCalledWith({
        stageId: 'b',
        start: '2026-10-13',
        end: '2026-10-15',
      });
      drag(barOf('Штукатурка'), 4);
      expect(onPreview).toHaveBeenLastCalledWith({
        stageId: 'b',
        start: '2026-10-16',
        end: '2026-10-20',
      });
    });

    it('без права или на узком экране (dragEnabled=false) ручки нет и перетаскивание не работает', () => {
      const onPreview = vi.fn();
      render(<Gantt {...base({ onPreview, dragEnabled: false })} />);
      expect(screen.queryByTitle('Потяните, чтобы изменить длительность')).toBeNull();
      drag(barOf('Штукатурка'), 2);
      expect(onPreview).not.toHaveBeenCalled();
    });

    it('этап без canMove не двигается, без canResize — ручки нет; касание не тянет', () => {
      const onPreview = vi.fn();
      render(<Gantt {...base({ onPreview })} />);
      drag(barOf('Демонтаж'), 2);
      expect(onPreview).not.toHaveBeenCalled();
      expect(
        within(barOf('Демонтаж')).queryByTitle('Потяните, чтобы изменить длительность'),
      ).toBeNull();
      fireEvent.pointerDown(barOf('Штукатурка'), {
        clientX: 0,
        button: 0,
        pointerId: 2,
        pointerType: 'touch',
      });
      fireEvent.pointerMove(barOf('Штукатурка'), {
        clientX: 52,
        pointerId: 2,
        pointerType: 'touch',
      });
      expect(onPreview).not.toHaveBeenCalled();
    });

    it('нажатие на полосу выбирает этап', () => {
      const onSelect = vi.fn();
      render(<Gantt {...base({ onSelect })} />);
      fireEvent.pointerDown(barOf('Демонтаж'), {
        clientX: 0,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      });
      expect(onSelect).toHaveBeenCalledWith('a');
    });
  });
});
