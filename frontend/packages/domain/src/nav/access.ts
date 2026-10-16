// W1.20 · Доступ к странице (AccessGate, gateVM :3053–3081) и баннер отключённого модуля (bannersVM :3089–3091).
//   ветка A — страницы модулей (PAGE_MOD): «„{имя}“ не подключён организацией» / «Нет доступа к разделу…»;
//   ветка B — логистика и рабочие места: «„{имя}“ не подключена организацией» / «Нет роли…» / «Нет права
//   на приёмку смен»; отключённый с историей модуль при праве «как если бы включён» — только чтение.
// Отказ «вне области» (no_scope) — для объекта: его показывает страница компонентом AccessGate оболочки.
import { canAny, moduleState } from './context.ts';
import { PAGES, pageLabel } from './registry.ts';
import type { NavContext, PageAccess, PageKey } from './types.ts';

export function pageAccess(ctx: NavContext, page: PageKey): PageAccess {
  const p = PAGES.get(page);
  if (!p || p.area !== ctx.area) return { kind: 'not_found' };
  const allow = (readOnly = false): PageAccess => ({
    kind: 'allow',
    readOnly: readOnly || ctx.tenantReadOnly,
  });
  if (p.gate === 'none') return allow();
  const owner = ctx.audience === 'owner';
  const label = pageLabel(page);
  if (p.gate === 'owner') {
    if (owner || canAny(ctx, p.view)) return allow();
    return {
      kind: 'deny',
      reason: 'no_permission',
      branch: 'A',
      chip: 'noPermission',
      title: 'noPermission',
      domainModule: null,
      label,
      owner,
    };
  }
  const branch = p.gate;
  const domainModule = p.manifest.domainModule ?? null;
  const state = moduleState(ctx, p.manifest);
  // Пункт профиля своего рабочего места открыт без права (заглушка до этапа модуля, NavPlacement.profile).
  const can = p.nav?.[ctx.audience]?.profile === true || canAny(ctx, p.view);
  const deny = (reason: 'module_off' | 'module_readonly' | 'no_permission'): PageAccess => {
    const off = reason !== 'no_permission';
    return {
      kind: 'deny',
      reason,
      branch,
      chip: !off
        ? 'noPermission'
        : reason === 'module_readonly' && branch === 'B'
          ? 'moduleDisabled'
          : 'moduleOff',
      title: off
        ? 'moduleOff'
        : branch === 'A'
          ? 'noPermission'
          : p.denyTitle === 'review'
            ? 'noReview'
            : 'noRole',
      domainModule,
      label,
      owner,
    };
  };
  if (state === 'off') return deny('module_off');
  if (state === 'ro') return can ? allow(true) : deny('module_readonly');
  return can ? allow() : deny('no_permission');
}

/** Модуль домена для баннера «Модуль «…» отключён.» на странице отключённого с историей модуля. */
export function moduleBanner(ctx: NavContext, page: PageKey): string | null {
  const p = PAGES.get(page);
  if (!p || p.manifest.kind !== 'industry' || p.area !== ctx.area) return null;
  return moduleState(ctx, p.manifest) === 'ro' ? (p.manifest.domainModule ?? null) : null;
}
