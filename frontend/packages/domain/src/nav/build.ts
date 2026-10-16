// W1.20 · Меню оболочки по манифестам модулей (navForBase :2950–3003, D-23; 01-shell.md §9.1).
//   владелец — отраслевая группа только у подключённого модуля, отключённый с историей — пункт в последней
//   группе «Отключены · только чтение», не подключавшийся — ничего; модули ядра — все;
//   сотрудники — пункты своего рабочего места по праву «как если бы модуль был включён» (меню сотрудника
//   от состояния модуля не зависит, на странице — AccessGate); модули будущих этапов и пункты профиля
//   рабочего места («Подотчёт» водителя и прораба) — по рабочему месту.
import { canAny, moduleState } from './context.ts';
import { GROUP_ORDER, PAGE_ORDER } from './pages.ts';
import { MANIFESTS } from './registry.gen.ts';
import type {
  GroupKey,
  LabelKey,
  NavBadges,
  NavContext,
  NavGroup,
  NavItem,
  NavManifest,
  NavPlacement,
  PageKey,
  PageManifest,
} from './types.ts';

interface Placed {
  group: GroupKey;
  item: NavItem;
}

const rank = (key: PageKey): number => PAGE_ORDER.indexOf(key);

function visible(ctx: NavContext, m: NavManifest, page: PageManifest, at: NavPlacement): boolean {
  const state = moduleState(ctx, m);
  if (m.kind === 'industry') {
    return ctx.audience === 'owner' ? state === 'on' : canAny(ctx, page.view);
  }
  if (m.kind === 'core') return state !== 'off' && (at.profile === true || canAny(ctx, page.view));
  return true;
}

function item(
  key: PageKey,
  segment: string,
  label: LabelKey,
  icon: string,
  badges: NavBadges,
): NavItem {
  const badge = badges[key];
  return badge && badge > 0 ? { key, segment, label, icon, badge } : { key, segment, label, icon };
}

export function buildNav(ctx: NavContext, o: { badges?: NavBadges } = {}): NavGroup[] {
  const badges = o.badges ?? {};
  const placed: Placed[] = [];
  for (const m of MANIFESTS) {
    if (m.area !== ctx.area) continue;
    for (const page of m.pages) {
      const at = page.nav?.[ctx.audience];
      if (!at || !visible(ctx, m, page, at)) continue;
      placed.push({
        group: at.group,
        item: item(page.key, page.segment, at.label, page.icon, badges),
      });
    }
    if (ctx.audience === 'owner' && m.readonlyItem && moduleState(ctx, m) === 'ro') {
      const ro = m.readonlyItem;
      const segment = m.pages.find((p) => p.key === ro.page)?.segment ?? ro.page;
      placed.push({ group: 'readonly', item: item(ro.page, segment, ro.label, ro.icon, badges) });
    }
  }
  return GROUP_ORDER.map((key) => ({
    key,
    title: `groups.${key}` as const,
    items: placed
      .filter((p) => p.group === key)
      .map((p) => p.item)
      .sort((a, b) => rank(a.key) - rank(b.key)),
  })).filter((g) => g.items.length > 0);
}

/** Стартовая страница — первый пункт меню (DEFAULT_PAGE эталона :2301); без пунктов — «Главная». */
export function defaultPage(groups: readonly NavGroup[]): PageKey {
  return groups[0]?.items[0]?.key ?? 'home';
}

/** Сокращения нижней навигации (:3028). */
const SHORT: Partial<Record<PageKey, LabelKey>> = {
  fleet: 'bottom.fleet',
  users: 'bottom.users',
  modules: 'bottom.modules',
  pool: 'bottom.pool',
  review: 'bottom.review',
};

/** Нижняя навигация телефона: первые три пункта меню с сокращёнными подписями; «Ещё» добавляет оболочка. */
export function bottomItems(groups: readonly NavGroup[]): NavItem[] {
  return groups
    .flatMap((g) => g.items)
    .slice(0, 3)
    .map((it) => {
      const short = SHORT[it.key];
      return short && it.label === `items.${it.key}` ? { ...it, label: short } : it;
    });
}
