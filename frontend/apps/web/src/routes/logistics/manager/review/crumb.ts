// W2.21 · Крошка страниц логиста (reviewVM :3333): владелец — «{организация} · все подразделения», сотрудник —
// подразделение области права страницы. «{регион} / {фирма}» («Москва / Север Логистик», как в эталоне) — только
// если listOrgUnits вернул и регион; логисту сида с областью фирмы регион не виден — «Север Логистик» (как W2.20,
// Q-W2.20-3; allowlist/logistics-review.md). Без подразделения области — «Область не назначена».
import { useCan, useShell } from '../../../../shell/context.tsx';
import { unitLabel, useOrgUnits } from '../../../../shell/scope.ts';
import { crumb } from './model.ts';

export function useCrumb(permission: string): string {
  const { tenant, tenantId, audience, nav } = useShell();
  const can = useCan();
  const owner = audience === 'owner';
  const units = useOrgUnits(tenantId ?? '', owner || can('org_units.read')).data ?? [];
  const unit = nav.capabilities.find(
    (c) => c.permission === permission && c.scope.kind === 'org_unit',
  )?.scope.resourceIds[0];
  return crumb({
    owner,
    tenant: tenant?.name ?? '',
    unit: unit ? unitLabel(units, unit) : undefined,
  });
}
