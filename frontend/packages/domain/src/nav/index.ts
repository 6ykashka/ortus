// W1.20 · Навигация оболочки (`@ortus/domain/nav`): манифесты модулей, меню D-23, доступ к страницам.
export { moduleBanner, pageAccess } from './access.ts';
export { bottomItems, buildNav, defaultPage } from './build.ts';
export { audienceOf, canAny, moduleState, navContext } from './context.ts';
export { GROUP_ORDER, PAGE_ORDER } from './pages.ts';
export { MANIFESTS } from './registry.gen.ts';
export { PAGES, pageBySegment, pageLabel, segmentOf, type PageEntry } from './registry.ts';
export type * from './types.ts';
