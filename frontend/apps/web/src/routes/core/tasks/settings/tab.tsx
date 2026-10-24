// W4.13 · Содержимое вкладки проекта по `view` (ADR-0001 `?view=people|workflow|automation`).
import type { ReactElement } from 'react';

import { AutomationTab } from './automation.tsx';
import { PeopleTab } from './people.tsx';
import { WorkflowTab } from './workflow.tsx';
import '../../../company/modules/modules.css';
import './settings.css';

export const SETTINGS_VIEWS = ['people', 'workflow', 'automation'] as const;
export type SettingsView = (typeof SETTINGS_VIEWS)[number];

export const isSettingsView = (v: unknown): v is SettingsView =>
  typeof v === 'string' && (SETTINGS_VIEWS as readonly string[]).includes(v);

export function ProjectSettingsTab(p: {
  tenantId: string;
  projectId: string;
  view: SettingsView;
}): ReactElement {
  if (p.view === 'people') return <PeopleTab tenantId={p.tenantId} projectId={p.projectId} />;
  if (p.view === 'workflow') return <WorkflowTab tenantId={p.tenantId} projectId={p.projectId} />;
  return <AutomationTab tenantId={p.tenantId} projectId={p.projectId} />;
}
