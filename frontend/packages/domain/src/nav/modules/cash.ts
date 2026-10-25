// W1.20 · Манифест «Касса» (модуль ядра `cash`; CORE_ITEMS :2964, cashSelf :2968): «Касса» в «Общих модулях»,
// «Подотчёт» на рабочем месте водителя и прораба. Страница модуля — этап 5 (W5.32, W5.33).
// «Подотчёт» водителя и прораба — пункт профиля рабочего места (`profile`): в эталоне он зависит от своего
// подотчётного счёта (cashSelf :2968), а не от права; счетов до этапа 5 нет (Q-W1.20-3, R-2).
// W1.49: «Касса» массажиста — по праву cash.*, как core([…, cash]) эталона (:2964, :3001): в «Альте» эталона
// право даёт роль «Кассир салона» с областью «касса» (cash.js :263–266, этап 5), в «Лотосе» её нет.
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'cash',
  kind: 'core',
  moduleKey: 'cash',
  domainModule: 'cash',
  availability: 'catalog',
  stage: 5,
  area: 'tenant',
  pages: [
    {
      key: 'cashSelf',
      segment: 'cash-self',
      icon: 'account_balance_wallet',
      view: ['cash.post'],
      gate: 'A',
      nav: {
        driver: { group: 'work', label: 'items.advance', profile: true },
        foreman: { group: 'core', label: 'items.advance', profile: true },
      },
    },
    {
      key: 'cash',
      segment: 'cash',
      icon: 'account_balance_wallet',
      view: ['cash.read', 'cash.post', 'cash.accounts.manage'],
      gate: 'A',
      nav: {
        owner: { group: 'core', label: 'items.cash' },
        office: { group: 'core', label: 'items.cash' },
        practitioner: { group: 'work', label: 'items.cash' },
      },
    },
  ],
};
