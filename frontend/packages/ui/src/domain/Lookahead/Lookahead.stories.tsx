import type { Meta, StoryObj } from '@storybook/react-vite';
import { Lookahead } from './Lookahead';

const noop = () => undefined;

const meta = {
  title: 'Domain/Lookahead',
  component: Lookahead,
  args: {
    weeks: [
      { start: '2026-10-19', label: 'Эта неделя · 19–23 октября' },
      { start: '2026-10-26', label: 'Следующая неделя · 26–30 октября' },
      { start: '2026-11-02', label: 'Через неделю · 2–6 ноября', sub: '4 ноября — выходной' },
    ],
    items: [
      {
        id: 's2',
        title: 'Электрика · черновая',
        week: '2026-10-19',
        when: 'до пт 23.10',
        who: 'ООО «ЭлектроПрофи»',
        onOpen: noop,
      },
      {
        id: 's3',
        title: 'Штукатурка стен',
        week: '2026-10-26',
        when: 'вся неделя, до 03.11',
        who: 'Исполнитель не назначен',
        onOpen: noop,
      },
    ],
    prep: { s2: { crew: true, materials: true }, s3: { crew: false, materials: false } },
  },
} satisfies Meta<typeof Lookahead>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeWeeks: Story = { name: 'Три недели' };

export const AllReady: Story = {
  name: 'Всё готово',
  args: { prep: { s2: { crew: true, materials: true }, s3: { crew: true, materials: true } } },
};
