// W1.20 · Область в шапке (shellVM :3010–3017; 01-shell.md §10.2): у владельца — select «Область просмотра»
// («Все подразделения», «{регион} · весь регион», «{регион} / {фирма}»), у сотрудников — текст по рабочему
// месту. Названия подразделений — listOrgUnits (право org_units.read); без права — текст без названия.
import { type components, unwrap } from '@ortus/api-client';
import type { Audience, ScopedCapabilityLike } from '@ortus/domain/nav';
import { format, shell } from '@ortus/texts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useApi } from '../app/api.tsx';
import { SHELL_TEXT } from './texts.ts';

type OrgUnit = components['schemas']['OrgUnit'];

export interface ScopeOption {
  value: string;
  label: string;
}

export type ScopeView = { kind: 'select'; options: ScopeOption[] } | { kind: 'text'; text: string };

export const ALL_UNITS = 'all';

/**
 * Выбранная область владельца, привязанная к организации: смена организации (selectTenant, прямой URL)
 * возвращает «Все подразделения» — id подразделения прежней организации в новую не переносится.
 */
export function useTenantScope(tenantId: string | null): [string, (value: string) => void] {
  const [s, set] = useState({ tenantId, value: ALL_UNITS });
  if (s.tenantId !== tenantId) set({ tenantId, value: ALL_UNITS });
  const setScope = useCallback((value: string) => set({ tenantId, value }), [tenantId]);
  return [s.tenantId === tenantId ? s.value : ALL_UNITS, setScope];
}

/** Опции владельца: «Все подразделения», затем на каждый регион — регион и его фирмы (:3016–3017). */
export function ownerScopeOptions(units: readonly OrgUnit[]): ScopeOption[] {
  const out: ScopeOption[] = [{ value: ALL_UNITS, label: shell.header.scopeAll }];
  const active = units.filter((u) => u.status === 'active');
  for (const region of active.filter((u) => u.kind === 'region')) {
    out.push({
      value: region.id,
      label: format(shell.header.scopeRegion, { region: region.name }),
    });
    for (const firm of active.filter((u) => u.parentId === region.id && u.kind !== 'region')) {
      out.push({
        value: firm.id,
        label: format(shell.header.scopeFirm, { region: region.name, firm: firm.name }),
      });
    }
  }
  return out;
}

/** Подпись подразделения «{регион} / {фирма}» или название региона. */
export function unitLabel(units: readonly OrgUnit[], id: string): string | undefined {
  const u = units.find((x) => x.id === id);
  if (!u) return undefined;
  const parent = u.parentId ? units.find((x) => x.id === u.parentId) : undefined;
  return parent ? format(shell.header.scopeFirm, { region: parent.name, firm: u.name }) : u.name;
}

const fleetUnit = (caps: readonly ScopedCapabilityLike[]): string | undefined =>
  caps.find((c) => c.permission.startsWith('fleet.') && c.scope.kind === 'org_unit')?.scope
    .resourceIds[0];

export function useOrgUnits(tenantId: string | undefined, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'org-units'],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const page = await unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/org-units', {
          params: { path: { tenantId: tenantId ?? '' }, query: { limit: 200 } },
        }),
      );
      return page.items;
    },
  });
}

/** Область шапки по рабочему месту; оператору — «Отдельный вход · без доступа к данным клиентов». */
export function useScopeView(
  audience: Audience,
  tenantId: string | undefined,
  caps: readonly ScopedCapabilityLike[],
): ScopeView {
  const canReadUnits = audience === 'owner' || caps.some((c) => c.permission === 'org_units.read');
  const units = useOrgUnits(tenantId, canReadUnits && audience !== 'operator').data ?? [];
  switch (audience) {
    case 'operator':
      return { kind: 'text', text: shell.header.operatorScope };
    case 'owner':
      return { kind: 'select', options: ownerScopeOptions(units) };
    case 'practitioner':
      return { kind: 'text', text: shell.header.therapistScope };
    case 'foreman':
      return { kind: 'text', text: shell.header.foremanScope };
    case 'driver': {
      const id = fleetUnit(caps);
      const name = id ? unitLabel(units, id) : undefined;
      return {
        kind: 'text',
        text: name ? format(shell.header.driverScope, { scope: name }) : SHELL_TEXT.myAssignments,
      };
    }
    default: {
      const id = fleetUnit(caps);
      const name = id ? unitLabel(units, id) : undefined;
      return { kind: 'text', text: name ?? shell.header.noScope };
    }
  }
}
