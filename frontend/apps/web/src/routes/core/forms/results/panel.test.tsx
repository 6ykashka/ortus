// W4.23 · Вкладки в оболочке редактора W4.22: модуль `forms/tabs/index.ts` (glob в editor.tsx W4.22) отдаёт
// FormTabPanel и ShareDialog; панель вкладки — внутри `role=tabpanel` оболочки, подписанной своей вкладкой.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const INSP = seedUuid('t-alta', 'fm-insp');
const SLOW = { timeout: 8_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

describe('модуль вкладок для оболочки W4.22', () => {
  it('forms/tabs/index.ts: FormTabPanel и ShareDialog', async () => {
    const mods = Object.values(import.meta.glob<Record<string, unknown>>('../tabs/index.ts'));
    expect(mods).toHaveLength(1);
    const m = await (mods[0] as () => Promise<Record<string, unknown>>)();
    expect(typeof m.FormTabPanel).toBe('function');
    expect(typeof m.ShareDialog).toBe('function');
  });

  it.each([
    ['settings', 'Настройки', '.ox-fr-st'],
    ['actions', 'Действия после ответа', '.ox-fr-ac'],
    ['responses', 'Ответы', '.ox-fr-rs'],
    ['versions', 'Версии', '.ox-fr-vs'],
  ])('&tab=%s — панель W4.23 в tabpanel «%s»', async (tab, label, cls) => {
    app = await renderMockApp(`/t/${ALTA}/forms?form=${INSP}&tab=${tab}`, { persona: 'owner' });
    const panel = await screen.findByRole('tabpanel', {}, SLOW);
    expect(within(screen.getByRole('tablist')).getByRole('tab', { selected: true }).id).toBe(
      panel.getAttribute('aria-labelledby'),
    );
    expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(
      new RegExp(`^${label}`),
    );
    await waitFor(() => expect(panel.querySelector(cls)).toBeTruthy(), SLOW);
    // Порядок заголовков (axe heading-order): h1 редактора W4.22 → h2 панели (название вкладки, только для AT) → h3.
    await waitFor(() => expect(panel.querySelector('h2')).toBeTruthy(), SLOW);
    const heads = [...panel.querySelectorAll('h1, h2, h3, h4')];
    expect(heads[0]?.tagName).toBe('H2');
    expect(heads[0]?.textContent).toBe(label);
    expect(panel.querySelectorAll('h2')).toHaveLength(1);
  });

  it.each(['offline', 'rate_limited'])(
    'getForm=%s после открытия редактора — переход на вкладку не перечитывает форму и не роняет редактор',
    async (code) => {
      app = await renderMockApp(`/t/${ALTA}/forms?form=${INSP}`, { persona: 'owner' });
      await screen.findByRole('tablist', { name: 'Разделы формы' }, SLOW);
      const reads = () =>
        app?.responses().filter((r) => r.method === 'GET' && r.path.endsWith(`/forms/${INSP}`))
          .length;
      const before = reads();
      app.scenario.setScenario(`getForm=${code}`);
      fireEvent.click(screen.getByRole('tab', { name: /^Настройки/ }));
      const panel = await screen.findByRole('tabpanel', {}, SLOW);
      await waitFor(() => expect(panel.querySelector('.ox-fr-st h3')).toBeTruthy(), SLOW);
      await new Promise((r) => setTimeout(r, 2500));
      expect(reads()).toBe(before);
      expect(screen.queryByText(/Не удалось загрузить данные/)).toBeNull();
      expect(screen.getByRole('tablist', { name: 'Разделы формы' })).toBeTruthy();
    },
  );

  it('«Поделиться» шапки W4.22 открывает диалог W4.23', async () => {
    app = await renderMockApp(`/t/${ALTA}/forms?form=${INSP}`, { persona: 'owner' });
    fireEvent.click(await screen.findByRole('button', { name: 'Поделиться' }, SLOW));
    const d = await screen.findByRole('dialog', {}, SLOW);
    expect(within(d).getByRole('heading', { level: 2 }).textContent).toBe('Поделиться формой');
  });
});
