import type { StorybookConfig } from '@storybook/react-vite';

// Storybook @ortus/ui (W0.10). Порт исполнителя — 7200 + слот: `corepack pnpm --filter @ortus/ui storybook -p 7209`.
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  core: { disableTelemetry: true },
};

export default config;
