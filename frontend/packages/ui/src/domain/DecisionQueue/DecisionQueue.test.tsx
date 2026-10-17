import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import type { DecisionItem } from '../../types';
import { DecisionQueue } from '../DecisionQueue';

// Ортус CRM.dc.html :1733–1744 (pg.home «Требует решения»), homeVM :4068–4072.
const items: DecisionItem[] = [
  {
    id: 'trial',
    tone: 'neutral',
    icon: 'hourglass_top',
    tag: 'Подписка',
    title: 'Пробный период: осталось 12 дней',
    meta: 'До 13.10.2026. После окончания история останется доступной для чтения',
    action: { label: 'Модули и место', onPress: () => undefined },
  },
  {
    id: 'defect',
    tone: 'danger',
    icon: 'report',
    tag: 'Блокирует выезд',
    title: 'Критический дефект · рейс Р-208',
    meta: 'Стёкла: Скол · Илья Васильев',
    action: { label: 'Решить', onPress: () => undefined },
  },
];

describe('DecisionQueue', () => {
  it('область с заголовком h2 и подписью-счётчиком', () => {
    render(<DecisionQueue title="Требует решения" items={items} count="2" />);
    const region = screen.getByRole('region', { name: 'Требует решения' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Требует решения' })).toBeTruthy();
    expect(within(region).getByText('2')).toBeTruthy();
  });

  it('пункты в порядке VM: заголовок, тег, текст, одна кнопка со стрелкой', () => {
    render(<DecisionQueue title="Требует решения" items={items} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const first = rows[0] as HTMLElement;
    expect(within(first).getByText('Пробный период: осталось 12 дней').tagName).toBe('STRONG');
    expect(within(first).getByText('Подписка')).toBeTruthy();
    expect(
      within(first).getByText(
        'До 13.10.2026. После окончания история останется доступной для чтения',
      ),
    ).toBeTruthy();
    expect(within(first).getAllByRole('button')).toHaveLength(1);
    expect(within(first).getByRole('button', { name: 'Модули и место' })).toBeTruthy();
    expect(first.getAttribute('data-tone')).toBe('neutral');
    expect((rows[1] as HTMLElement).getAttribute('data-tone')).toBe('danger');
  });

  it('кнопка вызывает действие пункта', async () => {
    const onPress = vi.fn();
    const first = items[0] as DecisionItem;
    render(
      <DecisionQueue
        title="Требует решения"
        items={[{ ...first, action: { label: 'Модули и место', onPress } }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Модули и место' }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('max — не больше N пунктов', () => {
    render(<DecisionQueue title="Требует решения" items={items} max={1} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('пусто — текст по умолчанию «Решений не требуется. Новые вопросы появятся здесь.»', () => {
    render(<DecisionQueue title="Требует решения" items={[]} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('Решений не требуется. Новые вопросы появятся здесь.')).toBeTruthy();
  });

  it('загрузка — скелетон «Загрузка» вместо списка', () => {
    render(<DecisionQueue title="Требует решения" items={[]} state="loading" />);
    expect(screen.getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    expect(screen.queryByText('Решений не требуется. Новые вопросы появятся здесь.')).toBeNull();
  });

  it('ошибка — баннер с повтором', async () => {
    const onRetry = vi.fn();
    render(
      <DecisionQueue
        title="Требует решения"
        items={[]}
        state="error"
        error={{ text: 'Слишком много запросов', onRetry, retryLabel: 'Повторить' }}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Слишком много запросов')).toBeTruthy();
    await userEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('axe: нет нарушений serious/critical', async () => {
    const { container } = render(<DecisionQueue title="Требует решения" items={items} count="2" />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
