// W6.20 · Страница `repair` «Объекты» (`/t/:tenantId/repair`, ADR-0001: `?obj=&tab=&filter=&q=`): список объектов или
// карточка объекта (`?obj=`). Единственный объект открывается сразу, без списка (эталон: `objs.length === 1`,
// «Ортус CRM.dc.html» :4278). Бриф — docs/plan/v2/ws/W6.20.md.
import type { ReactElement } from 'react';

import { useShell } from '../../shell/context.tsx';
import { useProjects } from './api.ts';
import { RepairCard } from './card.tsx';
import { RepairList } from './list.tsx';
import { useRepairSearch } from './parts.tsx';

export default function RepairPage(): ReactElement {
  const { tenantId: id } = useShell();
  const tenantId = id ?? '';
  const search = useRepairSearch();
  const projects = useProjects(tenantId);
  const only = projects.data?.length === 1 ? projects.data[0]?.id : undefined;
  const current = search.obj ?? only;
  if (current) {
    return (
      <RepairCard
        key={current}
        tenantId={tenantId}
        projectId={current}
        tab={search.tab}
        canBack={(projects.data?.length ?? 2) > 1}
      />
    );
  }
  return <RepairList tenantId={tenantId} />;
}
