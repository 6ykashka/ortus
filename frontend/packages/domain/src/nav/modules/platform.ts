// W1.20 · Манифест контура оператора платформы (navForBase :2971–2974): группа «Платформа», без гейтов и
// баннеров (01-shell.md §19 п. 5). Страницы — W1.25, W4.61.
import type { NavManifest } from '../types.ts';

const operator = (label: `items.${string}`) =>
  ({
    operator: { group: 'platform', label },
  }) as const;

export const manifest: NavManifest = {
  id: 'platform',
  kind: 'platform',
  moduleKey: null,
  availability: 'catalog',
  stage: 1,
  area: 'platform',
  pages: [
    {
      key: 'tenants',
      segment: 'tenants',
      icon: 'domain',
      view: [],
      gate: 'none',
      nav: operator('items.tenants'),
    },
    {
      key: 'usage',
      segment: 'usage',
      icon: 'monitoring',
      view: [],
      gate: 'none',
      nav: operator('items.usage'),
    },
    {
      key: 'requests',
      segment: 'requests',
      icon: 'move_up',
      view: [],
      gate: 'none',
      nav: operator('items.requests'),
    },
    {
      key: 'accounts',
      segment: 'accounts',
      icon: 'badge',
      view: [],
      gate: 'none',
      nav: operator('items.accounts'),
    },
    {
      key: 'plans',
      segment: 'plans',
      icon: 'sell',
      view: [],
      gate: 'none',
      nav: operator('items.plans'),
    },
  ],
};
