import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LookaheadProps } from '../../types';
import { Lookahead } from './Lookahead';

const props = (o: Partial<LookaheadProps> = {}): LookaheadProps => ({
  weeks: [
    { start: '2026-10-19', label: 'Эта неделя · 19–23 октября' },
    { start: '2026-10-26', label: 'Следующая неделя · 26–30 октября' },
    { start: '2026-11-02', label: 'Через неделю · 2–6 ноября', sub: '4 ноября — выходной' },
  ],
  items: [
    {
      id: 'a',
      title: 'Электрика · черновая',
      week: '2026-10-19',
      when: 'до пт 23.10',
      who: 'ООО «ЭлектроПрофи»',
    },
    { id: 'b', title: 'Плитка в санузле', week: '2026-10-26' },
  ],
  prep: { a: { crew: true, materials: true }, b: { crew: false, materials: true } },
  ...o,
});

describe('Lookahead', () => {
  it('по неделям: заголовок h3, подпись («4 ноября — выходной»), пустая неделя — «Работ по графику нет»', () => {
    render(<Lookahead {...props()} />);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Эта неделя · 19–23 октября' }),
    ).toBeInTheDocument();
    expect(screen.getByText('4 ноября — выходной')).toBeInTheDocument();
    const third = screen
      .getByRole('heading', { level: 3, name: /Через неделю/ })
      .closest('section') as HTMLElement;
    expect(within(third).getByText('Работ по графику нет')).toBeInTheDocument();
  });

  it('этап — кнопка: название, когда, кто; нажатие открывает этап', () => {
    const onOpen = vi.fn();
    render(
      <Lookahead
        {...props({
          items: [
            {
              id: 'a',
              title: 'Электрика · черновая',
              week: '2026-10-19',
              when: 'до пт 23.10',
              who: 'ООО «ЭлектроПрофи»',
              onOpen,
            },
          ],
          prep: {},
        })}
      />,
    );
    const btn = screen.getByRole('button', { name: /Электрика · черновая/ });
    expect(btn).toHaveTextContent('до пт 23.10');
    expect(btn).toHaveTextContent('ООО «ЭлектроПрофи»');
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalled();
  });

  it('готовность по prep: «Исполнитель и материалы готовы» / «Нет исполнителя» / «Материала нет на объекте»', () => {
    render(
      <Lookahead
        {...props({
          prep: { a: { crew: true, materials: true }, b: { crew: false, materials: false } },
        })}
      />,
    );
    expect(screen.getByText('Исполнитель и материалы готовы')).toBeInTheDocument();
    expect(screen.getByText('Нет исполнителя')).toBeInTheDocument();
    expect(screen.getByText('Материала нет на объекте')).toBeInTheDocument();
  });

  it('свои чипы строки заменяют готовность по prep', () => {
    render(
      <Lookahead
        {...props({
          items: [
            {
              id: 'a',
              title: 'Штукатурка',
              week: '2026-10-19',
              chips: [{ label: 'Критический путь', tone: 'neutral', icon: 'priority_high' }],
            },
          ],
          prep: { a: { crew: true, materials: true } },
        })}
      />,
    );
    expect(screen.getByText('Критический путь')).toBeInTheDocument();
    expect(screen.queryByText('Исполнитель и материалы готовы')).toBeNull();
  });
});
