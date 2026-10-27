// W6.21 · Общее для экранных тестов вкладок «Замер» и «Смета»: идентификаторы сида «Альты» ремонта (MSW W6.00,
// пресет repairs-ready: «сегодня» 20.10.2026) и открытие хоста вкладок на сценарном сервере.
import { seedUuid } from '@ortus/domain/seed';
import { screen } from '@testing-library/react';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../app/testing.tsx';

export const ALTA = seedUuid('platform', 't-alta');
export const A = (id: string): string => seedUuid('t-alta', id);

/** Объекты сида: кв. 42 (действует, сметы v1 и v2), дом в Истре (черновик, сметы нет), дом в Мытищах (сдан). */
export const OBJ42 = A('obj-42');
export const OBJ50 = A('obj-50');
export const OBJ27 = A('obj-27');

export const SLOW = { timeout: 5_000 };

export interface OpenOptions extends MockAppOptions {
  obj?: string;
  tab?: 'measure' | 'estimate';
}

/** Хост вкладок (заглушка repair.page.tsx) на `?obj=&tab=`; персонаж — владелец, пресет repairs-ready. */
export async function openTab(o: OpenOptions = {}): Promise<MockApp> {
  const { obj = OBJ42, tab = 'measure', ...rest } = o;
  const app = await renderMockApp(`/t/${ALTA}/repair?obj=${obj}&tab=${tab}`, {
    persona: 'owner',
    preset: 'repairs-ready',
    ...rest,
  });
  await screen.findByRole('heading', { level: 1, name: 'Объекты' }, SLOW);
  return app;
}

export const sent = (a: MockApp, method: string, suffix: string) =>
  a.responses().filter((r) => r.method === method && r.path.endsWith(suffix));

export const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;

/** Секция вкладки по `aria-labelledby`. */
export const sectionOf = (labelledBy: string): HTMLElement => {
  const s = document.querySelector<HTMLElement>(`section[aria-labelledby="${labelledBy}"]`);
  if (!s) throw new Error(`нет секции ${labelledBy}`);
  return s;
};
