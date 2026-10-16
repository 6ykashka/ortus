// W1.20 · Область просмотра владельца (select «Область просмотра», :3016–3017) привязана к организации:
// смена организации (selectTenant) возвращает «Все подразделения» — id подразделения прежней организации
// не переносится в новую.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ALL_UNITS, useTenantScope } from './scope.ts';

describe('useTenantScope', () => {
  it('смена организации сбрасывает область на «Все подразделения»', () => {
    const hook = renderHook(({ tenantId }) => useTenantScope(tenantId), {
      initialProps: { tenantId: 't-alta' as string | null },
    });
    expect(hook.result.current[0]).toBe(ALL_UNITS);
    act(() => hook.result.current[1]('u-msk'));
    expect(hook.result.current[0]).toBe('u-msk');
    hook.rerender({ tenantId: 't-lotos' });
    expect(hook.result.current[0]).toBe(ALL_UNITS);
    hook.rerender({ tenantId: 't-alta' });
    expect(hook.result.current[0]).toBe(ALL_UNITS);
  });

  it('в той же организации выбор сохраняется', () => {
    const hook = renderHook(({ tenantId }) => useTenantScope(tenantId), {
      initialProps: { tenantId: 't-alta' as string | null },
    });
    act(() => hook.result.current[1]('u-msk'));
    hook.rerender({ tenantId: 't-alta' });
    expect(hook.result.current[0]).toBe('u-msk');
  });
});
