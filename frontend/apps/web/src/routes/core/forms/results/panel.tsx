// W4.23 · Панель вкладки редактора формы для оболочки W4.22 (`FormTabPanel` модуля `forms/tabs/index.ts`): оболочка
// рисует шапку, вкладки и `role=tabpanel`, панель — содержимое выбранной вкладки (запросы, команды и ошибки внутри).
// Заголовок панели — h2 с названием вкладки только для AT (в эталоне его нет): после h1 редактора W4.22 заголовки
// карточек вкладок (h3, как в эталоне) идут без пропуска уровня (axe heading-order).
import { forms } from '@ortus/texts';
import type { ReactElement } from 'react';

import { ActionsTab } from './actions.tsx';
import { ResponsesTab } from './responses.tsx';
import { SettingsTab } from './settings.tsx';
import { VersionsTab } from './versions.tsx';
import './results.css';

export type FormTab = 'settings' | 'actions' | 'responses' | 'versions';

function Tab(p: { tenantId: string; formId: string; tab: FormTab }): ReactElement {
  const { tenantId, formId } = p;
  if (p.tab === 'settings') return <SettingsTab tenantId={tenantId} formId={formId} />;
  if (p.tab === 'actions') return <ActionsTab tenantId={tenantId} formId={formId} />;
  if (p.tab === 'responses') return <ResponsesTab tenantId={tenantId} formId={formId} />;
  return <VersionsTab tenantId={tenantId} formId={formId} />;
}

export function FormTabPanel(p: { tenantId: string; formId: string; tab: FormTab }): ReactElement {
  return (
    <>
      <h2 className="ox-fr-sr">{forms.editor.tabs[p.tab]}</h2>
      <Tab {...p} />
    </>
  );
}
