import type { Preview } from '@storybook/react-vite';
import '@ortus/tokens/tokens.css';
import '@ortus/tokens/fonts.css';
import '@ortus/tokens/base.css';
import './preview.css';

const viewport = (name: string, width: number, height: number) => ({
  name,
  styles: { width: `${width}px`, height: `${height}px` },
  type: width < 640 ? 'mobile' : width < 1080 ? 'tablet' : 'desktop',
});

const preview: Preview = {
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    viewport: {
      options: {
        'mobile-390': viewport('Телефон 390', 390, 844),
        'tablet-768': viewport('Планшет 768', 768, 1024),
        'desktop-1440': viewport('Десктоп 1440', 1440, 900),
      },
    },
  },
};

export default preview;
