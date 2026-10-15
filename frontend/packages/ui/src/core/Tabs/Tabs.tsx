import type { ReactElement } from 'react';
import { Tab, TabList, TabPanel, Tabs as AriaTabs } from 'react-aria-components';
import type { TabsProps } from '../../types';
import styles from './Tabs.module.css';

/**
 * Вкладки на React Aria (PD-13): `role="tablist"` с именем, ←/→ выбирают соседнюю вкладку, `aria-controls`
 * выбранной вкладки указывает на панель с `children`. Подчёркивание 2 px акцентом, счётчик neutral
 * (Ортус CRM.dc.html:290–294; Q-W0.10-3 — по рендеру прототипа). `cards` — плитки-вкладки (:440–442).
 */
export function Tabs({
  items,
  value,
  onChange,
  'aria-label': ariaLabel,
  variant = 'underline',
  children,
}: TabsProps): ReactElement {
  return (
    <AriaTabs
      className={styles.tabs}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key))}
    >
      <TabList aria-label={ariaLabel} className={styles.list} data-variant={variant}>
        {items.map((item) => (
          <Tab key={item.id} id={item.id} className={styles.tab}>
            {item.label}
            {item.badge !== undefined && item.badge !== '' ? (
              <span className={styles.badge} data-badge="">
                {item.badge}
              </span>
            ) : null}
          </Tab>
        ))}
      </TabList>
      {/* Панель на каждую вкладку: RAC монтирует только выбранную, aria-controls указывает на неё. */}
      {items.map((item) => (
        <TabPanel key={item.id} id={item.id} className={styles.panel}>
          {item.id === value ? children : null}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}
