// W6.20 · Реестр вкладок карточки объекта. Вкладки «Замер», «Смета», «График», «Документы», «Снабжение», «Финансы»,
// «Оплата бригады», «Подрядчики» и «Кабинет заказчика» — страницы других WS этапа 6 (W6.21–W6.24): владелец вкладки
// кладёт компонент в `TAB_PANELS`. Пока записи нет — заглушка вкладки с пунктами «Требует решения» этой вкладки
// (эталон: «{Вкладка}: в прототипе нет данных этого объекта» + `stubItems`, Q-W6.20-1).
import type { components } from '@ortus/api-client';
import { Icon } from '@ortus/ui';
import type { ComponentType, ReactElement } from 'react';

import { decisionView, type TabId } from './model.ts';
import { REPAIR_TEXT as T } from './texts.ts';

type S = components['schemas'];

export interface TabPanelProps {
  tenantId: string;
  ov: S['RepairProjectOverview'];
  canFin: boolean;
  readOnly: boolean;
}

/** Вкладки других WS: `TAB_PANELS.estimate = EstimateTab` и т. д. (запись по ключу вкладки). */
export const TAB_PANELS: Partial<Record<TabId, ComponentType<TabPanelProps>>> = {};

export function StubTab(p: { tab: TabId; ov: S['RepairProjectOverview'] }): ReactElement {
  const items = p.ov.decisions
    .filter((d) => d.tab === p.tab)
    .map((d) => decisionView(d, { startOn: p.ov.project.startOn, dueOn: p.ov.project.dueOn }));
  return (
    <div className="ox-rp-stub">
      <Icon name="folder_off" size={32} />
      <strong>{T.stub.title.replace('{tab}', T.tabs[p.tab])}</strong>
      <span style={{ maxWidth: 520 }}>{T.stub.text}</span>
      {items.length > 0 ? (
        <div className="ox-rp-stub-items">
          {items.map((i) => (
            <div key={i.id} className="ox-rp-stub-item">
              <Icon name={i.icon} size={20} />
              <span>
                <strong style={{ fontWeight: 600 }}>{i.title}</strong>
                {i.meta ? ` · ${i.meta}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
